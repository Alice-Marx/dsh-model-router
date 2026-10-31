import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { launchMigrationProcessTree as launch } from '../packages/orchestration/src/migration-os-quarantine.mjs'

await import('../remote-computer-agent/build.mjs')
const enabled = process.platform === 'win32'
const real = (name, fn) => test(name, { skip: !enabled, timeout: 60000 }, fn)
const writer = resolve('tests/fixtures/migration-remote-effect-writer.mjs')
const parent = resolve('tmp/integration/migration-remote-effect-quarantine')
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
async function wait(fn, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('Remote effect quarantine fixture did not reach the expected state')
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
    return { dataVersion: db.pragma('data_version', { simple: true }), operations: db.prepare('SELECT id,tool,status,result,error,finished FROM operations ORDER BY id').all() }
  } finally { db.close() }
}
async function agentFingerprint(dir) {
  const source = join(dir, 'agent'), names = (await readdir(source)).filter(name => name.startsWith('agent')).sort(), hash = createHash('sha256')
  for (const name of names) hash.update(name).update('\0').update(await readFile(join(source, name))).update('\0')
  return { names, sha256: hash.digest('hex') }
}

real('migration remote effect quarantine: independent Host and Agent processes stop in one Job with no later file or Agent operation commit', async t => {
  const { runner } = await compiled(), dir = await mkdtemp(join(parent, 'case-')), project = join(dir, 'project')
  await mkdir(project)
  const ready = join(dir, 'ready.json'), activeFile = join(dir, 'active.json')
  await writeFile(join(dir, 'migration-gate.json'), JSON.stringify({ schemaVersion: 1, kind: 'profile-migration-gate', phase: 'maintenance' }))
  const handle = await launch({ runner, executable: process.execPath, args: [writer, dir, ready], cwd: dir, operationId: 'op-remote-effect' })
  t.after(async () => { if (!handle.snapshot().wrapperClosed) await handle.stop().catch(() => {}) })
  const started = await wait(() => readJson(ready))
  assert.notEqual(started.agentPid, started.pid)
  assert.equal(dead(started.pid), false)
  assert.equal(dead(started.agentPid), false, 'the real Agent is a separate live OS process before the stop')
  const grown = await wait(async () => {
    const heartbeat = await readJson(join(dir, 'heartbeat.json')), active = await readJson(activeFile), held = await readJson(join(dir, 'reply-held.json'))
    return heartbeat?.tick === 3 && active?.phase === 'running' && held?.tick === 4 ? { heartbeat, active, held } : null
  })
  assert.equal(await readJson(join(dir, 'writer-error.json')), null)
  const beforeStop = await fileFingerprint(project)
  assert.equal(beforeStop.files.length, 4)
  assert.equal(await readFile(join(project, 'effect-1.txt'), 'utf8'), 'remote effect 1\n')
  assert.equal(await readFile(join(project, 'effect-4.txt'), 'utf8'), 'remote effect 4\n', 'the fourth real effect exists while its Host reply is held')
  const agentBeforeStop = await agentSnapshot(dir)
  const successfulBeforeStop = agentBeforeStop.operations.filter(operation => operation.tool === 'fs_write' && operation.status === 'succeeded').length
  assert.equal(successfulBeforeStop, 4, 'the real Agent committed four fs_write operations, not just Host journal rows')
  t.diagnostic(`pending gate: ${grown.heartbeat.tick} acknowledged writes plus one real unacknowledged effect; active attempt ${grown.active.attemptId} is running`)

  const result = await handle.stop()
  assert.equal(result.treeStopped, true)
  assert.equal(result.stopEvidence, 'windows-job-close')
  assert.equal(result.stopWriteProvable, false)
  await wait(() => dead(started.pid) && dead(started.agentPid))
  assert.equal(dead(started.pid), true)
  assert.equal(dead(started.agentPid), true, 'the Job also reaps the independent Agent descendant')
  t.diagnostic(`Host PID ${started.pid} and Agent PID ${started.agentPid} are both gone`)

  const filesStopped = await fileFingerprint(project), agentStopped = await agentFingerprint(dir)
  const remoteStopped = await agentSnapshot(dir), heartbeatStopped = await readFile(join(dir, 'heartbeat.json'), 'utf8'), activeStopped = await readFile(activeFile, 'utf8')
  const heartbeatStat = await stat(join(dir, 'heartbeat.json')), activeStat = await stat(activeFile)
  t.diagnostic(`stopped Agent store: ${agentStopped.names.join(', ')} at ${agentStopped.sha256.slice(0, 12)}, ${remoteStopped.operations.length} operation receipts`)
  await sleep(500)
  assert.deepEqual(await fileFingerprint(project), filesStopped, 'no remote file is created, removed or modified after the Job stop')
  assert.deepEqual(await agentFingerprint(dir), agentStopped, 'no Agent store, WAL or instance byte changes after the Job stop')
  assert.deepEqual((await agentSnapshot(dir)).operations, remoteStopped.operations, 'no Agent operation status or receipt commits after the stop')
  assert.equal(await readFile(join(dir, 'heartbeat.json'), 'utf8'), heartbeatStopped)
  assert.equal(await readFile(activeFile, 'utf8'), activeStopped)
  assert.equal((await stat(join(dir, 'heartbeat.json'))).mtimeMs, heartbeatStat.mtimeMs)
  assert.equal((await stat(activeFile)).mtimeMs, activeStat.mtimeMs)

  const journal = openTaskJournal(Database, join(dir, 'tasks.sqlite'))
  t.after(() => journal.close())
  const recoveryTime = Date.now() + 60000
  const cold = journal.claimRunner('cold-remote-effect-observer', 60000, recoveryTime)
  assert.ok(journal.recover(cold, recoveryTime + 1) >= 1)
  const recovered = journal.get('bot-a', grown.active.taskId)
  assert.equal(recovered.state, 'needs-reconciliation')
  assert.equal(recovered.result.outcome, 'unknown')
  assert.equal(recovered.result.code, 'HOST_INTERRUPTED')
  assert.equal(recovered.result.possiblyApplied !== false, true, 'an interrupted real write is never rolled back by killing its Host')
  assert.equal(recovered.executionRef.operationId, grown.active.operationId)
})
