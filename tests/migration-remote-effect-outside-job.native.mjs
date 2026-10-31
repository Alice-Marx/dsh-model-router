import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { launchMigrationProcessTree as launch } from '../packages/orchestration/src/migration-os-quarantine.mjs'

await import('../remote-computer-agent/build.mjs')
const enabled = process.platform === 'win32'
const real = (name, fn) => test(name, { skip: !enabled, timeout: 90000 }, fn)
const writer = resolve('tests/fixtures/migration-remote-effect-writer.mjs')
const agentFixture = resolve('tests/fixtures/migration-remote-effect-agent.mjs')
const outsideWriter = resolve('tests/fixtures/migration-remote-effect-outside-writer.mjs')
const parent = resolve('tmp/integration/migration-remote-effect-outside-job')
await mkdir(parent, { recursive: true })
let build
async function compiled() {
  if (build) return build
  const dir = await mkdtemp(join(parent, 'build-'))
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const runner = join(dir, 'process-job.exe')
  execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', '/out:' + runner, '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll', resolve('native/windows-desktop/ProcessJob.cs')], { windowsHide: true })
  build = { runner }
  return build
}
const readJson = path => readFile(path, 'utf8').then(value => value.trim() ? JSON.parse(value) : null).catch(() => null)
async function wait(fn, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('Outside Job effect fixture did not reach the expected state')
}
const dead = pid => { try { process.kill(pid, 0); return false } catch (error) { return error.code === 'ESRCH' } }
async function fileFingerprint(project) {
  const hash = createHash('sha256'), files = (await readdir(project)).sort()
  for (const name of files) {
    hash.update(name).update('\0').update(await readFile(join(project, name))).update('\0')
  }
  return { files, sha256: hash.digest('hex') }
}
async function agentSnapshot(dir) {
  const scratch = await mkdtemp(join(dir, 'store-')), source = join(dir, 'agent')
  for (const name of ['agent.sqlite', 'agent.sqlite-wal']) {
    try { await copyFile(join(source, name), join(scratch, name)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const db = new Database(join(scratch, 'agent.sqlite'))
  try {
    return { operations: db.prepare('SELECT id,status,result,error,finished FROM operations ORDER BY id').all() }
  } finally { db.close() }
}
const writes = snapshot => snapshot.operations.filter(operation => operation.status === 'succeeded').length

real('migration remote effect outside job: the Job stop leaves an out-of-Job Agent alive and a later Host still commits a real effect', async t => {
  const { runner } = await compiled(), dir = await mkdtemp(join(parent, 'case-')), project = join(dir, 'project')
  await mkdir(project)
  const agentReady = join(dir, 'agent-ready.json'), ready = join(dir, 'ready.json'), activeFile = join(dir, 'active.json')
  await writeFile(join(dir, 'migration-gate.json'), JSON.stringify({ schemaVersion: 1, kind: 'profile-migration-gate', phase: 'maintenance' }))
  const agent = spawn(process.execPath, [agentFixture, dir, agentReady], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(agent.pid)) { try { process.kill(agent.pid) } catch {} } })
  const agentStarted = await wait(() => readJson(agentReady))
  const handle = await launch({ runner, executable: process.execPath, args: [writer, dir, ready, agentReady], cwd: dir, operationId: 'op-remote-effect-outside' })
  t.after(async () => { if (!handle.snapshot().wrapperClosed) await handle.stop().catch(() => {}) })
  const started = await wait(() => readJson(ready))
  assert.equal(started.agentPid, agentStarted.pid, 'the Job Host attaches to the Agent that runs outside the Job')
  assert.notEqual(started.agentPid, started.pid)
  assert.equal(dead(agentStarted.pid), false)
  const grown = await wait(async () => {
    const heartbeat = await readJson(join(dir, 'heartbeat.json')), active = await readJson(activeFile), held = await readJson(join(dir, 'reply-held.json'))
    return heartbeat?.tick === 3 && active?.phase === 'running' && held?.tick === 4 ? { heartbeat, active, held } : null
  })
  assert.equal(await readJson(join(dir, 'writer-error.json')), null)
  const beforeStop = await fileFingerprint(project), agentBeforeStop = await agentSnapshot(dir)
  assert.equal(beforeStop.files.length, 4)
  assert.equal(writes(agentBeforeStop), 4, 'the real Agent committed four fs_write operations, not just Host journal rows')
  t.diagnostic(`outside Agent ${agentStarted.pid} served four real writes to Job Host ${started.pid} before the stop`)

  const result = await handle.stop()
  assert.equal(result.treeStopped, true)
  assert.equal(result.stopEvidence, 'windows-job-close')
  assert.equal(result.stopWriteProvable, false, 'the product itself does not claim a write-level proof')
  await wait(() => dead(started.pid))
  assert.equal(dead(started.pid), true, 'the Job reaps the Host it started')
  assert.equal(dead(agentStarted.pid), false, 'the Agent is outside the Job and survives its close')
  t.diagnostic(`Host PID ${started.pid} is gone while outside Agent PID ${agentStarted.pid} is still alive`)

  const outsideDir = join(dir, 'outside'), receiptFile = join(dir, 'outside-receipt.json')
  const outside = spawn(process.execPath, [outsideWriter, outsideDir, agentReady, receiptFile, 'outside-effect.txt', 'outside effect\n'], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(outside.pid)) { try { process.kill(outside.pid) } catch {} } })
  const receipt = await wait(async () => {
    const failure = await readJson(join(outsideDir, 'outside-writer-error.json'))
    if (failure) throw new Error('OUTSIDE_WRITER_FAILED: ' + failure)
    return readJson(receiptFile)
  })
  assert.equal(receipt.state, 'succeeded', 'a Host that never shared the Job is still admitted and still commits a real effect')
  assert.equal(receipt.agentPid, agentStarted.pid)
  assert.equal(await readFile(join(project, 'outside-effect.txt'), 'utf8'), 'outside effect\n')

  const afterStop = await fileFingerprint(project), agentAfterStop = await agentSnapshot(dir)
  assert.deepEqual(afterStop.files, [...beforeStop.files, 'outside-effect.txt'].sort())
  assert.notEqual(afterStop.sha256, beforeStop.sha256, 'the project does change after the stop: a Job-scoped stop is not an all-writer fence')
  assert.equal(writes(agentAfterStop), 5, 'the later write is a fifth real Agent receipt, not a Host-only row')
  assert.ok(agentAfterStop.operations.some(operation => operation.id === receipt.operationId && operation.status === 'succeeded'))
  assert.equal(dead(started.pid), true)
  assert.equal(dead(agentStarted.pid), false)
  t.diagnostic(`the outside Host ${receipt.hostPid} committed ${receipt.operationId} after the Job close`)

  const journal = openTaskJournal(Database, join(dir, 'tasks.sqlite'))
  t.after(() => journal.close())
  const recoveryTime = Date.now() + 60000
  const cold = journal.claimRunner('cold-outside-observer', 60000, recoveryTime)
  assert.ok(journal.recover(cold, recoveryTime + 1) >= 1)
  const recovered = journal.get('bot-a', grown.active.taskId)
  assert.equal(recovered.state, 'needs-reconciliation')
  assert.equal(recovered.result.outcome, 'unknown')
  assert.equal(recovered.result.code, 'HOST_INTERRUPTED')
  assert.notEqual(recovered.executionRef.operationId, receipt.operationId, 'the later effect never resolves the interrupted attempt')
})
