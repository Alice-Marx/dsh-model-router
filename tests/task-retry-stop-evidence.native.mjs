import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { taskHash } from '../packages/orchestration/src/task-contract.mjs'
import { createRemoteWriteBackend } from '../packages/orchestration/src/remote-execution.mjs'
import { createCliReadBackend } from '../packages/orchestration/src/cli-execution.mjs'
import { createTaskService } from '../packages/orchestration/src/task-service.mjs'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { openSqliteRouterState } from '../packages/orchestration/src/sqlite-router-state.mjs'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'

async function dir() {
  const root = resolve('tmp/integration/task-retry-stop-evidence')
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, 'case-'))
}

async function journalFixture(t) {
  const path = join(await dir(), 'journal.sqlite')
  let journal = openTaskJournal(Database, path), runner = journal.claimRunner('runner', 1000, 0)
  const reopen = () => { journal.release(runner, 20); journal.close(); journal = openTaskJournal(Database, path); runner = journal.claimRunner('runner-next', 1000, 21) }
  t.after(() => journal.close())
  const submit = (backend, key) => {const target=backend==='remote-write'?{effect:'workspace-write',location:'remote',machineId:'machine',workspaceId:'workspace'}:{};return journal.submit(runner, 'bot-a', key, key, { backend, input: {rootId:'root'}, target, targetHash:taskHash(target) }, 900, 1)}
  return { path, get j() { return journal }, get f() { return runner }, submit, reopen }
}

function linkProof(f,task,source){
  const marker={schemaVersion:1,taskId:task.taskId,attemptId:task.attemptId,operationId:task.operationId,targetHash:task.input.targetHash}
  const reference=task.input.backend==='remote-write'?{kind:'remote-operation',machineId:'machine',rootId:'root',tool:'fs_write',operationId:task.operationId,marker}:{kind:'cli-run',runId:'run-'+task.operationId,marker}
  f.j.linkExecution(f.f,'bot-a',task.taskId,task.attemptId,reference,2)
  return {stopConfirmed:true,stopEvidence:source,stopProof:{...marker,source,referenceHash:taskHash(reference),evidenceHash:taskHash({fixture:'source-stop',reference})}}
}

test('journal requires original strict stop evidence for started CLI and remote attempts', async t => {
  for (const backend of ['remote-write', 'codex-read']) {
    for (const [index, result] of [null, {}, { summary: { stopConfirmed: false } },
      { summary: { stopConfirmed: 'true', stopEvidence: 'native-tree' } },
      { summary: { stopConfirmed: 1, stopEvidence: 'agent-stop-receipt' } },
      { summary: { stopConfirmed: true } }, { summary: { notStarted: 'true' } },
      { summary: { notStarted: 1 } }, { notStarted: true }, { notDispatched: true },
      { summary: { notStarted: true } }, { summary: { stopConfirmed: true, stopEvidence: 'native-tree' } },
      { summary: { stopConfirmed: true, stopEvidence: 'agent-stop-receipt' } }].entries()) {
      const f = await journalFixture(t)
      const task = f.submit(backend, `${backend}-${index}`)
      f.j.claim(f.f, 'bot-a', task.taskId, 2)
      const settled = f.j.finish(f.f, 'bot-a', task.taskId, task.attemptId, 'failed', result, 3)
      assert.equal(settled.state, 'needs-reconciliation', `${backend} ${index}`)
      assert.throws(() => f.j.retry(f.f, 'bot-a', task.taskId, `retry-${backend}-${index}`, 'hash', 4), /TASK_RECONCILIATION_REQUIRED/)
      assert.throws(() => f.j.retry(f.f, 'bot-b', task.taskId, 'stolen', 'hash', 4), /TASK_NOT_FOUND/)
    }
  }
})

test('old unproven terminal rows remain fenced on cold recovery, including true without provenance', async t => {
  const f = await journalFixture(t), task = f.submit('remote-write', 'old-terminal')
  f.j.claim(f.f, 'bot-a', task.taskId, 2)
  f.j.finish(f.f, 'bot-a', task.taskId, task.attemptId, 'failed', { summary: { stopConfirmed: false } }, 3)
  const db = new Database(f.path)
  db.prepare("UPDATE tasks SET state='failed' WHERE id=?").run(task.taskId)
  db.prepare("UPDATE packages SET state='failed' WHERE id=?").run(task.packageId)
  db.prepare("UPDATE attempts SET state='failed',result=? WHERE id=?").run(JSON.stringify({ summary: { status: 'failed', stopConfirmed: true } }), task.attemptId)
  db.prepare("UPDATE operations SET state='failed' WHERE id=?").run(task.operationId)
  db.close(); f.reopen()
  assert.equal(f.j.get('bot-a', task.taskId).state, 'failed')
  assert.throws(() => f.j.retry(f.f, 'bot-a', task.taskId, 'old-retry', 'hash', 22), /TASK_RECONCILIATION_REQUIRED/)
  assert.equal(f.j.get('bot-a', task.taskId).attempts.length, 1)
})

test('an absent reference and missing start time do not override a delivered outbox', async t => {
  const f = await journalFixture(t), task = f.submit('remote-write', 'missing-reference')
  f.j.claim(f.f, 'bot-a', task.taskId, 2)
  f.j.finish(f.f, 'bot-a', task.taskId, task.attemptId, 'failed', null, 3)
  const db = new Database(f.path)
  db.prepare("UPDATE tasks SET state='failed' WHERE id=?").run(task.taskId)
  db.prepare("UPDATE packages SET state='failed' WHERE id=?").run(task.packageId)
  db.prepare("UPDATE attempts SET state='failed',started_ms=NULL,result=NULL WHERE id=?").run(task.attemptId)
  db.prepare("UPDATE operations SET state='failed' WHERE id=?").run(task.operationId)
  db.close()
  assert.equal(f.j.get('bot-a', task.taskId).executionRef, null)
  assert.throws(() => f.j.retry(f.f, 'bot-a', task.taskId, 'retry', 'hash', 4), /TASK_RECONCILIATION_REQUIRED/)
})

test('an already queued legacy retry is fenced before dispatch if its parent proof is missing', async t => {
  const f = await journalFixture(t), task = f.submit('codex-read', 'queued-old')
  f.j.claim(f.f, 'bot-a', task.taskId, 2)
  f.j.finish(f.f, 'bot-a', task.taskId, task.attemptId, 'failed', { summary: linkProof(f,task,'native-tree') }, 3)
  const next = f.j.retry(f.f, 'bot-a', task.taskId, 'retry', 'hash', 4)
  const db = new Database(f.path)
  db.prepare('UPDATE attempts SET result=? WHERE id=?').run(JSON.stringify({ summary: { stopConfirmed: true } }), task.attemptId)
  db.close(); f.reopen()
  assert.equal(f.j.claim(f.f, 'bot-a', task.taskId, 22), null)
  const fenced = f.j.get('bot-a', task.taskId)
  assert.equal(fenced.state, 'needs-reconciliation')
  assert.equal(fenced.attemptId, next.attemptId)
  assert.equal(fenced.result.code, 'PREVIOUS_ATTEMPT_STOP_UNCONFIRMED')
})

test('verified stop and proven pre-dispatch preserve explicit idempotent retry', async t => {
  for (const [backend, source] of [
    ['remote-write', 'agent-stop-receipt'],
    ['codex-read', 'native-tree'],
    ['remote-write', null],
    ['codex-read', null]
  ]) {
    const f = await journalFixture(t), task = f.submit(backend, 'valid')
    f.j.claim(f.f, 'bot-a', task.taskId, 2)
    let result
    if(source)result={summary:linkProof(f,task,source)}
    else {assert.equal(f.j.closeDispatch(f.f,'bot-a',task.taskId,task.attemptId,2),true);assert.throws(()=>f.j.beginDispatch(f.f,'bot-a',task.taskId,task.attemptId,2),/TASK_DISPATCH_CLOSED/);result={code:'HOST_CALLBACK_NOT_ENTERED'}}
    assert.equal(f.j.finish(f.f, 'bot-a', task.taskId, task.attemptId, 'failed', result, 3).state, 'failed')
    const next = f.j.retry(f.f, 'bot-a', task.taskId, 'retry', 'hash', 4)
    assert.notEqual(next.operationId, task.operationId)
    assert.equal(f.j.retry(f.f, 'bot-a', task.taskId, 'retry', 'hash', 5).acceptedAttemptId, next.attemptId)
    assert.equal(f.j.claim(f.f, 'bot-a', task.taskId, 6).state, 'running')
  }
})

test('journal rejects stale or mismatched bound proof and cannot hide it in waiting-budget or success',async t=>{
  for(const backend of ['codex-read','remote-write'])for(const field of ['taskId','attemptId','operationId','targetHash','referenceHash','source','schemaVersion','evidenceHash']){
    const f=await journalFixture(t),task=f.submit(backend,'mismatch');f.j.claim(f.f,'bot-a',task.taskId,2)
    const summary=linkProof(f,task,backend==='codex-read'?'native-tree':'agent-stop-receipt')
    summary.stopProof[field]=field==='schemaVersion'?2:'wrong'
    assert.equal(f.j.finish(f.f,'bot-a',task.taskId,task.attemptId,'failed',{summary},3).state,'needs-reconciliation',field)
    assert.equal(f.j.get('bot-a',task.taskId).result.summary.stopConfirmed,false)
  }
  for(const outcome of ['waiting-budget','succeeded']){
    const f=await journalFixture(t),task=f.submit('codex-read',outcome);f.j.claim(f.f,'bot-a',task.taskId,2)
    assert.equal(f.j.finish(f.f,'bot-a',task.taskId,task.attemptId,outcome,{notDispatched:true,summary:{notStarted:true}},3).state,'needs-reconciliation')
  }
})

test('a terminal reconciliation verdict without original stop evidence does not release the task', async t => {
  const f = await journalFixture(t), targetHash = 'a'.repeat(64)
  const task = f.j.submit(f.f, 'bot-a', 'observe', 'hash', { backend: 'codex-read', input: {}, target: {}, targetHash }, 900, 1)
  f.j.claim(f.f, 'bot-a', task.taskId, 2)
  const reference = { kind: 'cli-run', runId: 'run-fixture', marker: { schemaVersion: 1, taskId: task.taskId, attemptId: task.attemptId, operationId: task.operationId, targetHash } }
  f.j.linkExecution(f.f, 'bot-a', task.taskId, task.attemptId, reference, 3)
  f.j.finish(f.f, 'bot-a', task.taskId, task.attemptId, 'unknown', { code: 'FIXTURE' }, 4)
  const result = f.j.reconcile(f.f, 'bot-a', task.taskId, task.attemptId, 'observation', 'hash', { outcome: 'failed', referenceHash: taskHash(reference), evidenceHash: 'b'.repeat(64), summary: { stopConfirmed: false } }, 5)
  assert.equal(result.state, 'needs-reconciliation')
  assert.equal(result.reconciliation.outcome, 'unknown')
  assert.throws(() => f.j.retry(f.f, 'bot-a', task.taskId, 'retry', 'hash', 6), /TASK_RECONCILIATION_REQUIRED/)
})

test('remote backend preserves successful write and rejects unconfirmed terminal receipts', async () => {
  const input = { machineId: 'machine', rootId: 'root', relativePath: 'fixture.txt', content: 'offline', expectedHash: null }
  const subject = {}, targetValue = { machineId: 'machine', rootId: 'root', remoteMachineRevision: 1, remoteBindingRevision: 1 }
  let response
  const service = { taskTarget: () => targetValue, call: async () => response }
  const backend = createRemoteWriteBackend({ machines: () => service, directory: { forBot: () => subject }, pollMs: 5 })
  const target = backend.targetFor(subject, input)
  const run = async (value,proof=false) => {
    response = { schemaVersion: 1, machineId: 'machine', operationId: 'op', tool: 'fs_write', ...value }
    if(proof)response.stopProof={schemaVersion:1,kind:'agent-stop-receipt',source:'in-process-write',machineId:'machine',taskId:'task',attemptId:'attempt',operationId:'op',tool:'fs_write',status:response.status,receiptHash:taskHash(response),...(proof===true?{}:proof)}
    return backend.run({ input, target, ownerBotId: 'bot-a', binding: { taskId: 'task', attemptId: 'attempt' }, operationId: 'op', targetHash: 'a'.repeat(64), signal: new AbortController().signal, checkpoint: async () => {}, beforeRequest: () => {} })
  }
  const hash = createHash('sha256').update(input.content).digest('hex')
  assert.equal((await run({status:'succeeded',result:{sha256:hash,size:Buffer.byteLength(input.content)}})).outcome,'unknown')
  const success = await run({ status: 'succeeded', result: { sha256: hash, size: Buffer.byteLength(input.content) } },true)
  assert.equal(success.outcome, 'succeeded'); assert.equal(success.summary.stopEvidence, 'agent-write-completed')
  for (const result of [null, {}, { stopConfirmed: false }, { stopConfirmed: 'true' }, { stopConfirmed: 1 }, { notStarted: 'true' }, { stopConfirmed: true }, { notStarted: true }, { summary: { notStarted: true } }]) {
    const value = await run({ status: 'failed', result })
    assert.equal(value.outcome, 'unknown'); assert.equal(value.summary.stopConfirmed, false)
  }
  assert.equal((await run({ status: 'cancelled', result: null })).outcome, 'unknown')
  assert.equal((await run({ status: 'cancelled', result: { stopConfirmed: true } })).outcome, 'unknown')
  for(const field of ['taskId','attemptId','operationId','machineId','tool','status','receiptHash','source'])assert.equal((await run({status:'failed',result:{stopConfirmed:true}},{[field]:'mismatch'})).outcome,'unknown',field)
  const stopped=await run({status:'failed',result:{stopConfirmed:true,possiblyApplied:true}},true)
  assert.equal(stopped.outcome,'failed');assert.equal(stopped.summary.stopProof.referenceHash.length,64)
  const noEffects=await run({status:'cancelled',result:{stopConfirmed:true,possiblyApplied:false}},true)
  assert.equal(noEffects.outcome,'cancelled');assert.equal(noEffects.summary.stopConfirmed,true);assert.equal(noEffects.summary.possiblyApplied,false);assert.equal(noEffects.summary.stopEvidence,'agent-stop-receipt')
  const bareNoEffects=await run({status:'cancelled',result:{stopConfirmed:true,possiblyApplied:false}})
  assert.equal(bareNoEffects.outcome,'unknown');assert.equal(bareNoEffects.summary.stopConfirmed,false);assert.equal(bareNoEffects.summary.possiblyApplied,true)
  const notSent = await backend.run({ input, target, ownerBotId: 'bot-a', binding: { taskId: 'task', attemptId: 'attempt' }, operationId: 'op', targetHash: 'a'.repeat(64), signal: new AbortController().signal, checkpoint: async () => {}, beforeRequest: () => { throw new Error('no dispatch') } })
  assert.equal(notSent.outcome, 'failed'); assert.equal(notSent.summary.notStarted, true)
})

test('CLI without inference still needs original process-tree stop evidence', async t => {
  for (const mode of ['close-false', 'factory-throws', 'close-true']) {
    const root = await dir(), file = join(root, 'router.sqlite'), legacyFile = join(root, 'state.json')
    await createRouterState({ file: legacyFile }).saveHealth(null)
    const store = await openSqliteRouterState({ Database, file, legacyFile, lockStaleMs: 1 })
    const authority = createAuthority(), directory = createPrincipalDirectory(authority), model = { provider: 'fixture', model: 'gpt-exact' }
    const tools = ['task/submit', 'task/execute', 'task/read', 'task/retry', 'task/reconcile', 'cli/codex', 'cli/read', 'cli/retry']
    directory.register('bot-a', { tools, modelRoutes: [model] }); const subject = directory.forBot('bot-a')
    const sessionFactory = async () => {
      if (mode === 'factory-throws') throw new Error('fixture failure after hypothetical spawn')
      return { run: async () => { throw new Error('before inference') }, close: async () => ({ treeStopped: mode === 'close-true' }), snapshot: () => ({ cliTurnRequestsDispatched: 0 }) }
    }
    const backend = createCliReadBackend({ store, authority, directory, model, requestedModel: 'gpt-exact', machineId: 'machine', workspaceId: 'workspace', workspace: root, runtimeRoot: root, entry: { executable: process.execPath, sha256: 'a'.repeat(64), version: 'fixture' }, billing: 'subscription', subscriptionMaxCalls: 10, sessionFactory })
    const journal = openTaskJournal(Database, file), service = createTaskService({ journal, authority, directory, backends: [backend], runnerTtlMs: 1000, taskTtlMs: 5000 })
    service.start()
    try {
      const task = service.submit(subject, { requestKey: 'submit', backend: 'codex-read', input: { task: 'offline' } })
      let result
      for (let i = 0; i < 300; i++) { result = service.get(subject, { taskId: task.taskId }); if (['failed', 'needs-reconciliation'].includes(result.state)) break; await sleep(10) }
      assert.equal(result.state, mode === 'close-true' ? 'failed' : 'needs-reconciliation', mode)
      assert.equal(result.result.summary.stopConfirmed, mode === 'close-true')
      if (mode !== 'close-true') assert.throws(() => service.retry(subject, { taskId: task.taskId, requestKey: 'retry' }), /TASK_RECONCILIATION_REQUIRED/)
    } finally { await service.close(); await backend.facade.close(); await store.close(); authority.dispose() }
  }
})

test('a delayed Host callback cannot start a backend after proven pre-dispatch cancellation', async t => {
  const path = join(await dir(), 'journal.sqlite'), journal = openTaskJournal(Database, path)
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  directory.register('bot-a', { tools: ['task/submit', 'task/execute', 'task/read', 'task/retry', 'fixture/run'] })
  const subject = directory.forBot('bot-a'); let deferred, starts = 0
  const backend = { id: 'codex-read', version: 'fixture', effect: 'read', location: 'local', machineId: 'machine', workspaceId: 'workspace', capability: 'fixture/run', retryCapability: 'fixture/run', parse: input => input, run: async () => { starts++; return { outcome: 'succeeded' } } }
  const service = createTaskService({ journal, authority, directory, backends: [backend], runnerTtlMs: 1000, taskTtlMs: 5000, within: (_subject, _signal, work) => { deferred = work; throw new Error('before dispatch') } })
  service.start()
  try {
    const task = service.submit(subject, { requestKey: 'submit', backend: 'codex-read', input: {} })
    let result
    for (let i = 0; i < 300; i++) { result = service.get(subject, { taskId: task.taskId }); if (result.state === 'failed') break; await sleep(10) }
    assert.equal(result.state, 'failed'); assert.equal(result.result.notStarted, true); assert.equal(starts, 0)
    await assert.rejects(deferred(), /TASK_DISPATCH_CLOSED/)
    assert.equal(starts, 0)
    assert.notEqual(service.retry(subject, { taskId: task.taskId, requestKey: 'retry' }).operationId, task.operationId)
  } finally { await service.close(); authority.dispose() }
})

test('a backend exception after checkpoint remains unknown and is never marked notStarted', async t => {
  const path = join(await dir(), 'journal.sqlite'), journal = openTaskJournal(Database, path)
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  directory.register('bot-a', { tools: ['task/submit', 'task/execute', 'task/read', 'task/retry', 'fixture/run'] })
  const subject = directory.forBot('bot-a')
  const backend = { id: 'codex-read', version: 'fixture', effect: 'read', location: 'local', machineId: 'machine', workspaceId: 'workspace', capability: 'fixture/run', retryCapability: 'fixture/run', parse: input => input,
    async run(c) { await c.checkpoint({ kind: 'cli-run', runId: 'fixture-run', marker: { schemaVersion: 1, taskId: c.binding.taskId, attemptId: c.binding.attemptId, operationId: c.operationId, targetHash: c.targetHash } }); throw new Error('after checkpoint') } }
  const service = createTaskService({ journal, authority, directory, backends: [backend], runnerTtlMs: 1000, taskTtlMs: 5000 }); service.start()
  try {
    const task = service.submit(subject, { requestKey: 'submit', backend: 'codex-read', input: {} })
    let result
    for (let i = 0; i < 300; i++) { result = service.get(subject, { taskId: task.taskId }); if (result.state === 'needs-reconciliation') break; await sleep(10) }
    assert.equal(result.state, 'needs-reconciliation'); assert.equal(result.result.notStarted, undefined); assert.equal(result.executionRef.kind, 'cli-run')
    assert.throws(() => service.retry(subject, { taskId: task.taskId, requestKey: 'retry' }), /TASK_RECONCILIATION_REQUIRED/)
  } finally { await service.close(); authority.dispose() }
})
