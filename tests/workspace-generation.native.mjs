import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import Database from 'better-sqlite3'
await import('../remote-computer-agent/build.mjs')
const { Agent, WorkspacePin, rootsGeneration } = await import('../remote-computer-agent/dist/index.mjs')

const parent = resolve('tmp/integration/workspace-generation'); await mkdir(parent, { recursive: true })
const tools = ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel']
let clientSeq = 0
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
/** Agent failures resolve as {status:'failed',error:{code}}; rejections carry .code directly. */
const outcome = promise => promise.then(value => ({ status: value?.status ?? 'succeeded', code: value?.error?.code, value }), error => ({ status: 'failed', code: error?.code }))

/**
 * Real sqlite + real filesystem per case. `admitThroughPin` leaves an
 * operation admitted-but-never-dispatched with a live physical admission,
 * which is exactly the state a restart turns into a surviving unknown.
 */
async function fixture(t, { roots, dataDir } = {}) {
  const dir = await mkdtemp(join(parent, 'case-'))
  const tree = { alpha: join(dir, 'alpha'), other: join(dir, 'other') }
  await mkdir(tree.alpha); await mkdir(tree.other)
  await writeFile(join(tree.alpha, 'read.txt'), 'generation probe')
  const config = { dataDir: dataDir ?? join(dir, 'agent'), roots: roots ?? { alpha: tree.alpha, other: tree.other } }
  const agent = new Agent(config, Database)
  const rootIds = Object.keys(config.roots)
  const pair = agent.store.pair(`host-${++clientSeq}`, { botIds: ['bot-a'], roots: rootIds, tools })
  const context = agent.store.grant(agent.store.issue(agent.store.client(pair.token), { botId: 'bot-a', taskId: 'task-a', attemptId: 'attempt-a', roots: rootIds, tools }).grantToken)
  const write = (id, rootId, relativePath) => agent.call('fs_write', { rootId, relativePath, content: 'scoped write', expectedHash: null }, context, id)
  return { dir, tree, config, agent, context, write, admitThroughPin: async id => { agent.store.admit(id, context, 'fs_write', { probe: id }); await agent.workspaces.admit(id, context, (await WorkspacePin.capture(tree.alpha)).identity) } }
}
const openReadonly = (dataDir, sql, ...args) => { const db = new Database(join(dataDir, 'agent.sqlite'), { readonly: true }); try { return db.prepare(sql).get(...args) } finally { db.close() } }
const meta = (dataDir, key) => openReadonly(dataDir, 'SELECT value FROM meta WHERE key=?', key)?.value ?? null

test('workspace generation/native: a same-roots restart keeps surviving admissions meaningful and fences nothing', async t => {
  const first = await fixture(t)
  const dataDir = first.config.dataDir
  await first.admitThroughPin('op-old')
  await first.agent.close()

  const second = await fixture(t, { roots: first.config.roots, dataDir })
  t.after(() => second.agent.close())
  const same = await outcome(second.write('op-same-root', 'alpha', 'blocked.txt'))
  assert.equal(same.status, 'failed'); assert.equal(same.code, 'WORKSPACE_BUSY', 'the surviving unknown admission still owns its physical root')
  const other = await outcome(second.write('op-other-root', 'other', 'fresh.txt'))
  assert.equal(other.status, 'succeeded', 'no generation fence may exist when the roots configuration is unchanged')
  assert.equal(meta(dataDir, 'workspaceRootsGeneration'), rootsGeneration(first.config.roots))
  assert.equal(openReadonly(dataDir, "SELECT count(*) n FROM audit WHERE code='WORKSPACE_ROOTS_GENERATION_CHANGED'").n, 0)
})

test('workspace generation/native: a changed roots configuration fences unsettled admissions fail closed', async t => {
  const first = await fixture(t)
  const dataDir = first.config.dataDir
  await first.admitThroughPin('op-old')
  await first.agent.close()

  const changedRoots = { ...first.config.roots, added: join(first.dir, 'added') }
  await mkdir(changedRoots.added)
  const second = await fixture(t, { roots: changedRoots, dataDir })
  t.after(() => second.agent.close())
  const read = await second.agent.call('fs_read', { rootId: 'alpha', relativePath: 'read.txt' }, second.context)
  assert.equal(Buffer.from(read.content, 'base64').toString(), 'generation probe', 'plain reads never take the fence')
  for (const rootId of ['alpha', 'other', 'added']) {
    const denied = await outcome(second.write(`op-${rootId}`, rootId, 'fenced.txt'))
    assert.equal(denied.status, 'failed'); assert.equal(denied.code, 'WORKSPACE_RECOVERY_REQUIRED', `${rootId} must be fenced until the old generation settles`)
  }
  assert.equal(meta(dataDir, 'workspaceRootsGeneration'), rootsGeneration(changedRoots), 'the new generation is persisted')
  assert.equal(openReadonly(dataDir, "SELECT count(*) n FROM audit WHERE code='WORKSPACE_ROOTS_GENERATION_CHANGED'").n, 1)
})

test('workspace generation/native: settling the fenced operation makes the fence inert without rollback', async t => {
  const first = await fixture(t)
  const dataDir = first.config.dataDir
  await first.admitThroughPin('op-old')
  await first.agent.close()

  const changedRoots = { ...first.config.roots, added: join(first.dir, 'added') }
  await mkdir(changedRoots.added)
  const second = await fixture(t, { roots: changedRoots, dataDir })
  const fenced = await outcome(second.write('op-fenced', 'other', 'fenced.txt'))
  assert.equal(fenced.code, 'WORKSPACE_RECOVERY_REQUIRED')
  // Admin recovery settles the unknown operation; the terminal update also
  // releases its admission through the existing trigger. The fence row stays
  // but is inert for settled operations.
  const admin = new Database(join(dataDir, 'agent.sqlite')); try { admin.prepare("UPDATE operations SET status='failed',error='ADMIN_RECOVERED',finished=? WHERE id='op-old'").run(Date.now()) } finally { admin.close() }
  const after = await outcome(second.write('op-after', 'other', 'after-settle.txt'))
  assert.equal(after.status, 'succeeded', 'a settled fenced operation no longer blocks new writes')
  t.after(() => second.agent.close())
})

test('workspace generation/native: the digest is exposed by ping, order-stable and config-sensitive', async t => {
  const a = await fixture(t); t.after(() => a.agent.close())
  const ping = await a.agent.call('machine_ping', {}, a.context)
  assert.match(ping.rootsGeneration, /^[a-f0-9]{64}$/); assert.equal(ping.rootsGeneration, rootsGeneration(a.config.roots))

  const reordered = await fixture(t, { roots: { other: a.tree.other, alpha: a.tree.alpha } }); t.after(() => reordered.agent.close())
  assert.equal((await reordered.agent.call('machine_ping', {}, reordered.context)).rootsGeneration, ping.rootsGeneration, 'key insertion order must not change the generation')

  const changed = await fixture(t, { roots: { alpha: a.tree.alpha, other: a.tree.other, extra: join(a.dir, 'extra') } }); t.after(() => changed.agent.close())
  assert.notEqual((await changed.agent.call('machine_ping', {}, changed.context)).rootsGeneration, ping.rootsGeneration, 'a different roots mapping must change the generation')
})

test('workspace generation/native: a live admission records the generation it was admitted under', async t => {
  const f = await fixture(t); t.after(() => f.agent.close())
  const entered = deferred(), gate = deferred(), original = f.agent.write.bind(f.agent)
  f.agent.write = async (a, c, signal) => { if (a.relativePath === 'hold.txt') { entered.resolve(); await gate.promise } return original(a, c, signal) }
  const job = f.write('op-held', 'alpha', 'hold.txt')
  await entered.promise
  assert.equal(openReadonly(f.config.dataDir, "SELECT roots_generation g FROM workspace_admissions WHERE operation_id='op-held'").g, rootsGeneration(f.config.roots), 'the live admission carries the current digest for audit')
  gate.resolve()
  assert.equal((await outcome(job)).status, 'succeeded')
})
