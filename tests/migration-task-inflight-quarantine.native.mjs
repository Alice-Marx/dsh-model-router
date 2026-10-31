import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { taskHash } from '../packages/orchestration/src/task-contract.mjs'
import { createRemoteWriteBackend } from '../packages/orchestration/src/remote-execution.mjs'
import { launchMigrationProcessTree as launch } from '../packages/orchestration/src/migration-os-quarantine.mjs'

const enabled = process.platform === 'win32'
const real = (name, fn) => test(name, { skip: !enabled, timeout: 60000 }, fn)
const writer = resolve('tests/fixtures/migration-task-inflight-writer.mjs')
const parent = resolve('tmp/integration/migration-task-inflight-quarantine')
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
    await sleep(50)
  }
  throw new Error('Executing Task fixture did not reach the expected state')
}
const dead = pid => { try { process.kill(pid, 0); return false } catch (error) { return error.code === 'ESRCH' } }
const rows = db => ({
  outbox: db.prepare('SELECT count(*) AS n FROM task_outbox').get().n,
  attempts: db.prepare('SELECT count(*) AS n FROM attempts').get().n,
  events: db.prepare('SELECT coalesce(max(seq),0) AS n FROM task_events').get().n,
})
async function snapshot(file) {
  const db = new Database(file, { readonly: true })
  try {
    return { ...rows(db), states: db.prepare('SELECT a.id,a.state,a.result,a.finished_ms,o.state AS operation,o.finished_ms AS operation_finished FROM attempts a JOIN operations o ON o.attempt_id=a.id ORDER BY a.id').all() }
  } finally { db.close() }
}
// One connection pinned open across the quiet window: SQLite bumps data_version only when some
// other connection commits, so a stable value plus stable rows is an independent "no commit" check.
function observer(file) {
  const db = new Database(file, { readonly: true })
  return { read: () => ({ dataVersion: db.pragma('data_version', { simple: true }), ...rows(db), states: db.prepare('SELECT a.id,a.state,a.result,a.finished_ms FROM attempts a ORDER BY a.id').all() }), close: () => db.close() }
}

test('migration in-flight Task quarantine: non-Windows platforms are explicitly unsupported', { skip: enabled }, async () => {
  await assert.rejects(launch({ operationId: 'op-unsupported' }), { code: 'MIGRATION_OS_QUARANTINE_UNSUPPORTED' })
})

real('migration in-flight Task quarantine: executing attempts keep committing, then the Job stop is proven by observation and the interrupted effect stays unknown', async t => {
  const { runner } = await compiled(), dir = await mkdtemp(join(parent, 'case-'))
  const ready = join(dir, 'ready.json'), file = join(dir, 'journal.sqlite'), beat = join(dir, 'heartbeat.json')
  await writeFile(join(dir, 'migration-gate.json'), JSON.stringify({ schemaVersion: 1, kind: 'profile-migration-gate', phase: 'maintenance' }))
  const handle = await launch({ runner, executable: process.execPath, args: [writer, dir, ready], cwd: dir, operationId: 'op-task-inflight' })
  t.after(async () => { if (!handle.snapshot().wrapperClosed) await handle.stop().catch(() => {}) })
  const started = await wait(() => readJson(ready))
  const first = await wait(async () => { const current = await snapshot(file); return current.outbox >= 1 ? current : null })
  const grown = await wait(async () => { const current = await snapshot(file); return current.attempts >= first.attempts + 3 && current.outbox >= first.outbox + 3 && current.events > first.events ? current : null }, 12000)
  assert.equal(await readJson(join(dir, 'writer-error.json')), null, 'the fixture commits without a journal error')
  assert.equal(grown.states.find(row => row.id === started.attemptId).state, 'running', 'the rows grow while the subject attempt is still executing')
  const beatTick = (await readJson(beat)).tick
  t.diagnostic(`under a pending gate: attempts ${first.attempts}->${grown.attempts}, outbox ${first.outbox}->${grown.outbox}, task_events max seq ${first.events}->${grown.events}`)

  const result = await handle.stop()
  assert.equal(result.treeStopped, true)
  assert.equal(result.stopEvidence, 'windows-job-close')
  assert.equal(result.runnerNotStarted, false)
  assert.equal(handle.snapshot().wrapperClosed, true)
  assert.equal(result.stopWriteProvable, false, 'the Job receipt does not claim write-level proof')
  await wait(() => dead(started.pid))
  assert.equal(dead(started.pid), true, 'the executing writer process is gone, observed through the OS')

  const stopped = await snapshot(file)
  const subject = stopped.states.find(row => row.id === started.attemptId)
  assert.equal(subject.state, 'running')
  assert.equal(subject.result, null)
  assert.equal(subject.finished_ms, null)
  assert.equal(subject.operation, 'running')
  assert.equal(subject.operation_finished, null, 'the stop is proven while no terminal row exists to read it from')
  for (const terminal of ['succeeded', 'failed', 'cancelled']) assert.notEqual(subject.state, terminal, `the stop is never read from a ${terminal} row`)
  assert.ok(stopped.attempts > first.attempts, 'the stopped rows are the rows that were growing')

  const pinned = observer(file)
  t.after(() => pinned.close())
  const before = pinned.read(), beatBefore = await readJson(beat), beatStat = await stat(beat)
  assert.ok(before.attempts >= stopped.attempts)
  await sleep(500)
  const after = pinned.read()
  assert.deepEqual(after, before, 'no attempt, operation, outbox or event row and no state transition appears in the 500ms window')
  assert.equal(after.dataVersion, before.dataVersion, 'no other connection committed in the 500ms window')
  assert.deepEqual(await readJson(beat), beatBefore, 'the fixture process itself stopped writing its heartbeat')
  assert.equal((await stat(beat)).mtimeMs, beatStat.mtimeMs)
  assert.ok(beatTick > 0)

  const journal = openTaskJournal(Database, file)
  t.after(() => journal.close())
  const cold = journal.claimRunner('cold-observer', 60000, 10_000_000)
  assert.ok(journal.recover(cold, 10_000_001) >= 1)
  const recovered = journal.get('bot-a', started.taskId)
  assert.equal(recovered.state, 'needs-reconciliation')
  assert.equal(recovered.result.outcome, 'unknown')
  assert.equal(recovered.result.code, 'HOST_INTERRUPTED')
  assert.equal(recovered.result.cancelRequested, false)
  assert.equal(recovered.result.possiblyApplied, undefined, 'nothing claims the effect did not happen')
  assert.equal(recovered.result.notStarted, undefined, 'the attempt had entered dispatch')
  assert.equal(recovered.result.possiblyApplied !== false, true)
  assert.equal(recovered.result.summary, undefined)
  assert.equal(['succeeded', 'failed', 'cancelled'].includes(recovered.state), false)
  assert.equal(recovered.executionRef.kind, 'remote-operation')

  const referenceHash = taskHash(recovered.executionRef)
  const success = journal.reconcile(cold, 'bot-a', recovered.taskId, recovered.attemptId, 'inflight-success', 'hash-success', { outcome: 'succeeded', referenceHash, evidenceHash: 'c'.repeat(64), summary: { status: 'succeeded', stopConfirmed: true, stopEvidence: 'agent-stop-receipt' } }, 10_000_002)
  assert.equal(success.state, 'needs-reconciliation')
  assert.equal(success.reconciliation.outcome, 'unknown')
  assert.equal(success.reconciliation.evidence.reason, 'TASK_STOP_UNCONFIRMED')
  assert.equal(success.result.outcome, 'unknown')
  const cancel = journal.reconcile(cold, 'bot-a', recovered.taskId, recovered.attemptId, 'inflight-cancel', 'hash-cancel', { outcome: 'cancelled', referenceHash, evidenceHash: 'd'.repeat(64) }, 10_000_003)
  assert.equal(cancel.state, 'needs-reconciliation')
  assert.equal(cancel.reconciliation.outcome, 'unknown')
  assert.equal(cancel.result.cancelRequested, false)
})

test('migration in-flight Task quarantine: an interrupted dispatch keeps possiblyApplied, a dispatch that was never sent clears it', async () => {
  const input = { machineId: 'machine-a', rootId: 'root', relativePath: 'inflight.txt', content: 'inflight', expectedHash: null }
  const subject = {}, targetValue = { machineId: 'machine-a', rootId: 'root', remoteMachineRevision: 1, remoteBindingRevision: 1 }
  const run = async (call, beforeRequest = () => {}) => {
    const backend = createRemoteWriteBackend({ machines: () => ({ taskTarget: () => targetValue, call }), directory: { forBot: () => subject }, pollMs: 5 })
    return backend.run({ input, target: backend.targetFor(subject, input), ownerBotId: 'bot-a', binding: { taskId: 'task', attemptId: 'attempt' }, operationId: 'op', targetHash: 'a'.repeat(64), signal: new AbortController().signal, checkpoint: async () => {}, beforeRequest })
  }
  const interrupted = await run(async () => { throw Object.assign(new Error('JOB_STOPPED_MID_FLIGHT'), { code: 'JOB_STOPPED_MID_FLIGHT' }) })
  assert.equal(interrupted.outcome, 'unknown')
  assert.equal(interrupted.summary.stopConfirmed, false)
  assert.equal(interrupted.summary.possiblyApplied, true, 'a stopped process is not a rolled back effect')
  assert.notEqual(interrupted.outcome, 'succeeded')
  const neverSent = await run(async () => { throw Object.assign(new Error('DISPATCH_NOT_SENT'), { code: 'DISPATCH_NOT_SENT' }) }, () => { throw Object.assign(new Error('DISPATCH_NOT_SENT'), { code: 'DISPATCH_NOT_SENT' }) })
  assert.equal(neverSent.summary.notStarted, true)
  assert.equal(neverSent.summary.possiblyApplied, false, 'an attempt that never reached the effect is not possibly applied')
})
