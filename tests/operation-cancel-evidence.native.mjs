import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'

await import('../remote-computer-agent/build.mjs')
const { Agent, WorkspacePin } = await import('../remote-computer-agent/dist/index.mjs')

async function fixture(t) {
  const base = resolve('tmp/integration/operation-cancel-evidence')
  await mkdir(base, { recursive: true })
  const dir = await mkdtemp(join(base, 'case-')), root = join(dir, 'root')
  await mkdir(root)
  const agent = new Agent({ dataDir: join(dir, 'agent'), roots: { project: root } }, Database)
  const tools = ['operation_cancel', 'operation_status', 'shell_exec', 'fs_write', 'desktop_click', 'worktree_create', 'browser_click']
  const pair = agent.store.pair('fixture', { botIds: ['bot-a', 'bot-b'], roots: ['project'], tools })
  const grant = botId => agent.store.grant(agent.store.issue(agent.store.client(pair.token), {
    botId, taskId: `task-${botId}`, attemptId: 'attempt', roots: ['project'], tools
  }).grantToken)
  const owner = grant('bot-a'), other = grant('bot-b')
  t.after(async () => agent.close())
  const record = (id, tool, status, result) => {
    agent.store.admit(id, owner, tool, {})
    agent.store.finish(id, status, result, status === 'failed' ? 'FIXTURE' : null)
  }
  const cancel = id => agent.call('operation_cancel', { operationId: id }, owner)
  return { agent, owner, other, root, record, cancel }
}

test('shell cancel requires terminal status and a strict boolean original stop receipt', async t => {
  const f = await fixture(t)
  const cases = [
    ['null', 'failed', null, false],
    ['empty', 'succeeded', {}, false],
    ['native-legacy', 'cancelled', { exitCode: 0, signal: null }, false],
    ['false', 'failed', { stopConfirmed: false }, false],
    ['string', 'failed', { stopConfirmed: 'true' }, false],
    ['number', 'failed', { stopConfirmed: 1 }, false],
    ['not-started-string', 'failed', { notStarted: 'true' }, false],
    ['not-started-number', 'failed', { notStarted: 1 }, false],
    ['nested', 'failed', { result: { stopConfirmed: true } }, false],
    ['stop-true', 'succeeded', { stopConfirmed: true }, true],
    ['not-started-true', 'failed', { notStarted: true }, true],
    ['cancelled-true', 'cancelled', { stopConfirmed: true }, true],
    ['admitted', 'admitted', { stopConfirmed: true }, false],
    ['running', 'running', { stopConfirmed: true }, false],
    ['cancel-pending', 'cancel_pending', { stopConfirmed: true }, false],
    ['unknown', 'unknown', { stopConfirmed: true }, false],
    ['invalid-status', 'invented', { stopConfirmed: true }, false]
  ]
  for (const [id, status, result, expected] of cases) {
    f.record(id, 'shell_exec', status, result)
    const before = f.agent.store.status(id, f.owner)
    const response = await f.cancel(id)
    assert.equal(response.stopConfirmed, expected, id)
    assert.equal(response.cancelRequested, false, id)
    assert.deepEqual(response.operation, before, id)
    assert.deepEqual(f.agent.store.status(id, f.owner), before, id)
  }
})

test('cancel rejects a different operation owner without mutating the original receipt', async t => {
  const f = await fixture(t)
  f.record('owned', 'shell_exec', 'succeeded', { stopConfirmed: true })
  const before = f.agent.store.status('owned', f.owner)
  await assert.rejects(f.agent.call('operation_cancel', { operationId: 'owned' }, f.other), { code: 'SCOPE_DENIED' })
  assert.deepEqual(f.agent.store.status('owned', f.owner), before)
})

test('uncertain shell cancellation neither rewrites the receipt nor releases its workspace admission', async t => {
  const f = await fixture(t)
  f.agent.store.admit('locked', f.owner, 'shell_exec', {})
  const pin = await WorkspacePin.capture(f.root)
  try { f.agent.workspaces.admit('locked', f.owner, pin.identity) } finally { await pin.close() }
  f.agent.store.finish('locked', 'failed', null, 'FIXTURE')
  assert.equal(f.agent.workspaces.list().length, 1)
  const before = f.agent.store.status('locked', f.owner)
  assert.equal((await f.cancel('locked')).stopConfirmed, false)
  assert.deepEqual(f.agent.store.status('locked', f.owner), before)
  assert.equal(f.agent.workspaces.list().length, 1)
})

test('other external tools require stop evidence; successful in-process writes retain their existing meaning', async t => {
  const f = await fixture(t)
  for (const tool of ['desktop_click', 'worktree_create', 'browser_click']) {
    f.record(`no-${tool}`, tool, 'succeeded', { completed: true })
    assert.equal((await f.cancel(`no-${tool}`)).stopConfirmed, false, tool)
    f.record(`false-${tool}`, tool, 'failed', { stopConfirmed: false })
    assert.equal((await f.cancel(`false-${tool}`)).stopConfirmed, false, tool)
    f.record(`yes-${tool}`, tool, 'cancelled', { stopConfirmed: true })
    assert.equal((await f.cancel(`yes-${tool}`)).stopConfirmed, true, tool)
  }
  const success = await f.agent.call('fs_write', { rootId: 'project', relativePath: 'ok.txt', content: 'fixture', expectedHash: null }, f.owner, 'write-success')
  assert.equal(success.status, 'succeeded')
  assert.equal((await f.cancel('write-success')).stopConfirmed, true)
  const failed = await f.agent.call('fs_write', { rootId: 'project', relativePath: 'bad.txt', content: 'fixture' }, f.owner, 'write-failed')
  assert.equal(failed.status, 'failed')
  assert.equal((await f.cancel('write-failed')).stopConfirmed, true,'settled in-process failure has independent stop receipt, not rollback proof')
  assert.equal(failed.stopProof.source,'in-process-write')
  assert.equal(failed.result.possiblyApplied,true)
})

test('raw write flags and copied or stale independent receipts cannot manufacture stop provenance',async t=>{
  const f=await fixture(t)
  for(const [i,result] of [{stopConfirmed:true},{notStarted:true},{summary:{notStarted:true}},null].entries()){
    const id='raw-write-'+i;f.record(id,'fs_write','failed',result)
    assert.equal((await f.cancel(id)).stopConfirmed,false)
    assert.equal((await f.agent.call('operation_status',{operationId:id},f.owner)).stopProof,undefined)
  }
  const args={rootId:'project',relativePath:'proof.txt',content:'fixture',expectedHash:null}
  const written=await f.agent.call('fs_write',args,f.owner,'proof-write')
  assert.ok(written.stopProof);assert.deepEqual((await f.agent.call('fs_write',args,f.owner,'proof-write')).stopProof,written.stopProof)
  const original=written.stopProof
  for(const key of ['taskId','attemptId','operationId','receiptHash','status','machineId']){
    f.agent.store.db.prepare('UPDATE agent_stop_receipts SET proof=? WHERE operation_id=?').run(JSON.stringify({...original,[key]:'wrong'}),'proof-write')
    assert.equal((await f.cancel('proof-write')).stopConfirmed,false,key)
  }
  f.agent.store.db.prepare('UPDATE agent_stop_receipts SET proof=? WHERE operation_id=?').run(JSON.stringify(original),'proof-write')
  assert.equal((await f.cancel('proof-write')).stopConfirmed,true)
  f.agent.store.finish('proof-write','failed',{stopConfirmed:true},'FIXTURE')
  assert.equal((await f.cancel('proof-write')).stopConfirmed,false,'a rewritten raw receipt invalidates the original hash')
})

test('a forged successful write row cannot confirm stopping while the original write is in flight', async t => {
  const f = await fixture(t)
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const original = f.agent.write.bind(f.agent)
  f.agent.write = async (...args) => { entered(); await gate; return original(...args) }
  const job = f.agent.call('fs_write', { rootId: 'project', relativePath: 'held.txt', content: 'fixture', expectedHash: null }, f.owner, 'held-write')
  try {
    await started
    f.agent.store.finish('held-write', 'succeeded', { size: 0 })
    const receipt = await f.cancel('held-write')
    assert.equal(receipt.cancelRequested, true)
    assert.equal(receipt.stopConfirmed, false)
  } finally { release() }
  assert.equal((await job).status, 'cancelled')
})
