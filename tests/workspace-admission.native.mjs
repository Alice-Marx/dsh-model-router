import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
await import('../remote-computer-agent/build.mjs')
const { Store, WorkspacePin } = await import('../remote-computer-agent/dist/index.mjs')
const { loadWorkspaceAdmissions } = await import('./fixtures/workspace-admission-build.mjs')
const { WorkspaceAdmissions } = await loadWorkspaceAdmissions()
const { identityOf, makeAlias, syntheticTree } = await import('./fixtures/workspace-admission-roots.mjs')

const parent = resolve('tmp/integration/step-workspace-admission'); await mkdir(parent, { recursive: true })
const ceiling = { botIds: ['bot-a', 'bot-b'], roots: ['project'], tools: ['fs_write', 'shell_exec'] }
const grantInput = (botId = 'bot-a') => ({ botId, taskId: 'task-a', attemptId: 'attempt-a', roots: ['project'], tools: ['fs_write', 'shell_exec'] })
const busy = code => e => e instanceof Error && e.code === code
const rows = (store, sql, ...args) => store.db.prepare(sql).all(...args)

async function fixture(t) {
  const dir = await mkdtemp(join(parent, 'case-')), tree = syntheticTree(dir)
  const store = new Store(join(dir, 'data'), Database), pair = store.pair('host', ceiling)
  const context = store.grant(store.issue(store.client(pair.token), grantInput()).grantToken)
  const f = { dir, dataDir: join(dir, 'data'), tree, store, pair, context, admissions: new WorkspaceAdmissions(store), operation: (id, tool = 'fs_write', args = {}) => store.admit(id, context, tool, args) }
  t.after(() => store.close())
  return f
}
const admin = dataDir => { const store = new Store(dataDir, Database, { admin: true }); return { store, admissions: new WorkspaceAdmissions(store) } }

test('workspace admission/native: independent physical roots are admitted together and a shared ancestor never serializes them', async t => {
  const f = await fixture(t)
  f.operation('op-other'); f.operation('op-sibling')
  const other = f.admissions.admit('op-other', f.context, identityOf(f.tree.other)), sibling = f.admissions.admit('op-sibling', f.context, identityOf(f.tree.sibling))
  assert.equal(other.fresh, true); assert.equal(sibling.fresh, true)
  assert.equal(f.admissions.list().length, 2)
  assert.deepEqual(f.admissions.list().map(a => a.operationId).sort(), ['op-other', 'op-sibling'])
  assert.equal(rows(f.store, 'SELECT count(*) n FROM workspace_admissions a JOIN operations o ON o.id=a.operation_id')[0].n, 2)
  assert.deepEqual(f.admissions.list(f.context).map(a => a.operationId).sort(), ['op-other', 'op-sibling'])
  assert.equal(f.admissions.list({ ...f.context, botId: 'bot-b' }).length, 0)
  const held = f.admissions.list().find(a => a.operationId === 'op-other')
  assert.equal(held.rootKey, identityOf(f.tree.other).key); assert.equal(held.path, f.tree.other); assert.equal(held.platform, process.platform); assert.equal(held.tool, 'fs_write')
  assert.ok(held.ancestors.includes(identityOf(f.tree.roots).key))
})

test('workspace admission/native: an aliased path for the same physical root conflicts and read checks see the held root', async t => {
  const f = await fixture(t)
  f.operation('op-parent'); f.admissions.admit('op-parent', f.context, identityOf(f.tree.parent))
  const alias = join(f.tree.roots, 'alias'), aliased = makeAlias(f.tree.parent, alias)
  assert.equal(identityOf(aliased).key, identityOf(f.tree.parent).key)
  f.operation('op-alias')
  assert.throws(() => f.admissions.admit('op-alias', f.context, identityOf(aliased)), busy('WORKSPACE_BUSY'))
  assert.throws(() => f.admissions.assertAvailable(identityOf(aliased)), busy('WORKSPACE_BUSY'))
  assert.throws(() => f.admissions.admit('op-alias', f.context, identityOf(aliased)), busy('WORKSPACE_BUSY'))
  f.admissions.assertAvailable(identityOf(aliased), 'op-parent')
  f.admissions.assertAvailable(identityOf(f.tree.other))
  assert.equal(f.admissions.list().length, 1)
})

test('workspace admission/native: a captured physical pin is admitted, its alias conflicts and its child branch is excluded', async t => {
  const f = await fixture(t)
  const pin = await WorkspacePin.capture(f.tree.parent)
  t.after(() => pin.close())
  f.operation('op-pin')
  const held = f.admissions.admit('op-pin', f.context, pin.identity)
  assert.equal(held.fresh, true)
  assert.equal(held.admission.rootKey, pin.identity.key)
  assert.deepEqual(held.admission.ancestors, [...pin.identity.ancestors])
  const alias = makeAlias(f.tree.parent, join(f.tree.roots, 'alias-pin')), aliasPin = await WorkspacePin.capture(alias)
  t.after(() => aliasPin.close())
  assert.deepEqual(aliasPin.identity, pin.identity)
  f.operation('op-pin-alias')
  assert.throws(() => f.admissions.admit('op-pin-alias', f.context, aliasPin.identity), busy('WORKSPACE_BUSY'))
  const childPin = await WorkspacePin.capture(f.tree.child)
  t.after(() => childPin.close())
  assert.ok(childPin.identity.ancestors.includes(pin.identity.key))
  f.operation('op-pin-child')
  assert.throws(() => f.admissions.admit('op-pin-child', f.context, childPin.identity), busy('WORKSPACE_BUSY'))
  f.admissions.assertAvailable(childPin.identity, 'op-pin')
  f.store.finish('op-pin', 'succeeded', { sha256: '0'.repeat(64), size: 1 })
  assert.deepEqual(f.admissions.list(), [])
  f.operation('op-pin-child-2')
  assert.equal(f.admissions.admit('op-pin-child-2', f.context, childPin.identity).fresh, true)
})

test('workspace admission/native: a parent admission excludes its child branch, siblings stay independent, and the receipt frees the branch', async t => {
  const f = await fixture(t)
  f.operation('op-parent'); f.admissions.admit('op-parent', f.context, identityOf(f.tree.parent))
  f.operation('op-child')
  assert.throws(() => f.admissions.admit('op-child', f.context, identityOf(f.tree.child)), busy('WORKSPACE_BUSY'))
  assert.throws(() => f.admissions.assertAvailable(identityOf(f.tree.child)), busy('WORKSPACE_BUSY'))
  assert.equal(f.admissions.list().length, 1)
  f.store.finish('op-parent', 'succeeded', { sha256: '0'.repeat(64), size: 1 })
  assert.deepEqual(f.admissions.list(), [])
  assert.equal(f.admissions.admit('op-child', f.context, identityOf(f.tree.child)).fresh, true)
  f.operation('op-sibling')
  assert.equal(f.admissions.admit('op-sibling', f.context, identityOf(f.tree.sibling)).fresh, true)
  assert.equal(f.admissions.list().length, 2)
  f.operation('op-parent-2')
  assert.throws(() => f.admissions.admit('op-parent-2', f.context, identityOf(f.tree.parent)), busy('WORKSPACE_BUSY'))
})

test('workspace admission/native: replay is idempotent while an altered snapshot or another subject never steals the held root', async t => {
  const f = await fixture(t)
  f.operation('op-one')
  const first = f.admissions.admit('op-one', f.context, identityOf(f.tree.parent))
  const replay = f.admissions.admit('op-one', f.context, identityOf(f.tree.parent))
  assert.equal(first.fresh, true); assert.equal(replay.fresh, false); assert.deepEqual(replay.admission, first.admission)
  assert.equal(f.admissions.list().length, 1)
  f.operation('op-one')
  assert.throws(() => f.admissions.admit('op-one', f.context, identityOf(f.tree.child)), busy('WORKSPACE_CONFLICT'))
  const stranger = f.store.grant(f.store.issue(f.store.client(f.pair.token), grantInput('bot-b')).grantToken)
  assert.throws(() => f.admissions.admit('op-one', stranger, identityOf(f.tree.parent)), busy('SCOPE_DENIED'))
  const attempt = f.store.grant(f.store.issue(f.store.client(f.pair.token), { ...grantInput(), attemptId: 'attempt-b' }).grantToken)
  assert.throws(() => f.admissions.admit('op-one', attempt, identityOf(f.tree.parent)), busy('SCOPE_DENIED'))
  assert.equal(f.admissions.list().length, 1)
  assert.equal(f.admissions.list()[0].operationId, 'op-one')
})

test('workspace admission/native: the held root is visible to another connection and a concurrent writer cannot pass', async t => {
  const f = await fixture(t)
  f.operation('op-held'); f.admissions.admit('op-held', f.context, identityOf(f.tree.parent))
  const other = admin(f.dataDir)
  t.after(() => other.store.close())
  f.operation('op-cross')
  assert.throws(() => other.admissions.admit('op-cross', f.context, identityOf(f.tree.parent)), busy('WORKSPACE_BUSY'))
  assert.throws(() => other.admissions.admit('op-cross', f.context, identityOf(f.tree.child)), busy('WORKSPACE_BUSY'))
  assert.throws(() => other.admissions.assertAvailable(identityOf(f.tree.parent)), busy('WORKSPACE_BUSY'))
  assert.equal(other.admissions.list().length, 1)
  assert.equal(other.admissions.list()[0].operationId, 'op-held')
  other.store.db.pragma('busy_timeout = 200'); f.store.db.pragma('busy_timeout = 200')
  f.operation('op-race')
  other.store.db.exec('BEGIN IMMEDIATE')
  assert.throws(() => f.admissions.admit('op-race', f.context, identityOf(f.tree.other)), busy('DATABASE_BUSY'))
  assert.equal(rows(f.store, 'SELECT count(*) n FROM workspace_admissions WHERE operation_id=?', 'op-race')[0].n, 0)
  other.store.db.exec('ROLLBACK')
  assert.equal(f.admissions.admit('op-race', f.context, identityOf(f.tree.other)).fresh, true)
})

test('workspace admission/native: an unknown lock survives controller close and restart without stealing', async t => {
  const f = await fixture(t)
  f.operation('op-restart'); f.admissions.admit('op-restart', f.context, identityOf(f.tree.parent))
  f.store.close()
  const reopened = new Store(f.dataDir, Database), admissions = new WorkspaceAdmissions(reopened)
  t.after(() => reopened.close())
  assert.equal(rows(reopened, 'SELECT status FROM operations WHERE id=?', 'op-restart')[0].status, 'unknown')
  assert.equal(admissions.list().length, 1)
  assert.equal(admissions.list()[0].rootKey, identityOf(f.tree.parent).key)
  assert.throws(() => admissions.assertAvailable(identityOf(f.tree.parent)), busy('WORKSPACE_BUSY'))
  const pair = reopened.pair('host-next', ceiling), context = reopened.grant(reopened.issue(reopened.client(pair.token), grantInput()).grantToken)
  reopened.admit('op-after-restart', context, 'fs_write', {})
  assert.throws(() => admissions.admit('op-after-restart', context, identityOf(f.tree.parent)), busy('WORKSPACE_BUSY'))
  assert.throws(() => admissions.admit('op-restart', context, identityOf(f.tree.parent)), busy('SCOPE_DENIED'))
  assert.equal(admissions.list().length, 1)
})

test('workspace admission/native: an interrupted original operation cannot re-acquire the root it still holds', async t => {
  const f = await fixture(t)
  f.operation('op-unknown'); f.admissions.admit('op-unknown', f.context, identityOf(f.tree.parent))
  f.store.db.prepare("UPDATE operations SET status='unknown',error='OUTCOME_UNKNOWN' WHERE id=?").run('op-unknown')
  assert.throws(() => f.admissions.admit('op-unknown', f.context, identityOf(f.tree.parent)), busy('OPERATION_CONFLICT'))
  const retained = f.admissions.releaseIfTerminal('op-unknown', f.context)
  assert.equal(retained.released, false); assert.equal(retained.reason, 'NON_TERMINAL'); assert.equal(retained.status, 'unknown')
  assert.equal(f.admissions.list().length, 1)
})

test('workspace admission/native: a released lock is never re-acquired by the finished original operation', async t => {
  const f = await fixture(t)
  f.operation('op-done'); f.admissions.admit('op-done', f.context, identityOf(f.tree.parent))
  f.store.finish('op-done', 'succeeded', { sha256: '0'.repeat(64), size: 2 })
  assert.deepEqual(f.admissions.list(), [])
  assert.throws(() => f.admissions.admit('op-done', f.context, identityOf(f.tree.parent)), busy('OPERATION_CONFLICT'))
  f.operation('op-successor')
  assert.equal(f.admissions.admit('op-successor', f.context, identityOf(f.tree.parent)).fresh, true)
})

test('workspace admission/native: a persisted synchronous write receipt releases the root in the same transaction', async t => {
  const f = await fixture(t)
  f.operation('op-write'); f.admissions.admit('op-write', f.context, identityOf(f.tree.parent))
  assert.throws(() => f.store.db.transaction(() => { f.store.finish('op-write', 'succeeded', { sha256: '0'.repeat(64) }); throw Error('FIXTURE_RECEIPT_ROLLBACK') })(), /FIXTURE_RECEIPT_ROLLBACK/)
  assert.equal(f.admissions.list().length, 1)
  f.store.db.transaction(() => { f.store.finish('op-write', 'succeeded', { sha256: '0'.repeat(64) }); assert.deepEqual(f.admissions.list(), []) })()
  assert.deepEqual(f.admissions.list(), [])
  assert.equal(f.admissions.releaseIfTerminal('op-write', f.context).released, true)
  assert.equal(f.admissions.releaseIfTerminal('op-write', f.context).reason, 'ALREADY_RELEASED')
  for (const status of ['failed', 'cancelled']) {
    const id = `op-${status}`; f.operation(id); f.admissions.admit(id, f.context, identityOf(f.tree.parent))
    f.store.finish(id, status, null, 'FIXTURE_TERMINAL')
    assert.deepEqual(f.admissions.list(), [])
    assert.equal(f.admissions.releaseIfTerminal(id, f.context).released, true)
  }
  f.operation('op-again')
  assert.equal(f.admissions.admit('op-again', f.context, identityOf(f.tree.parent)).fresh, true)
})

test('workspace admission/native: a terminal shell without stop evidence keeps the root until the stop is proven', async t => {
  const f = await fixture(t)
  f.operation('op-shell', 'shell_exec', { workspaceRef: { kind: 'remote' } }); f.admissions.admit('op-shell', f.context, identityOf(f.tree.parent))
  f.store.finish('op-shell', 'failed', { exitCode: 1 }, 'PROCESS_EXIT_NONZERO')
  assert.equal(f.admissions.list().length, 1)
  const retained = f.admissions.releaseIfTerminal('op-shell', f.context)
  assert.equal(retained.released, false); assert.equal(retained.reason, 'STOP_UNCONFIRMED'); assert.equal(retained.status, 'failed')
  f.operation('op-next')
  assert.throws(() => f.admissions.admit('op-next', f.context, identityOf(f.tree.parent)), busy('WORKSPACE_BUSY'))
  f.store.finish('op-shell', 'unknown', { kind: 'container-command', stopConfirmed: false, possiblyApplied: true }, 'OUTCOME_UNKNOWN')
  assert.equal(f.admissions.list().length, 1)
  assert.equal(f.admissions.releaseIfTerminal('op-shell', f.context).reason, 'NON_TERMINAL')
  f.operation('op-shell-2', 'shell_exec', {}); f.admissions.admit('op-shell-2', f.context, identityOf(f.tree.other))
  f.store.finish('op-shell-2', 'succeeded', { kind: 'container-command', containerId: 'c', exitCode: 0, stopConfirmed: true }, null)
  assert.deepEqual(f.admissions.list().map(a => a.operationId), ['op-shell'])
  f.store.finish('op-shell', 'cancelled', { kind: 'container-command', notStarted: true, stopConfirmed: true, possiblyApplied: false }, 'HOST_INTERRUPTED_BEFORE_START')
  assert.deepEqual(f.admissions.list(), [])
})

test('workspace admission/native: a revoked grant refuses admission and retains the held root', async t => {
  const f = await fixture(t)
  const revoked = f.store.grant(f.store.issue(f.store.client(f.pair.token), grantInput()).grantToken)
  f.store.revokeGrants(f.store.client(f.pair.token), { botId: 'bot-a' })
  f.operation('op-revoked')
  assert.throws(() => f.admissions.admit('op-revoked', revoked, identityOf(f.tree.parent)), busy('GRANT_REVOKED'))
  assert.deepEqual(f.admissions.list(), [])
  f.admissions.assertAvailable(identityOf(f.tree.parent), 'op-revoked')
  const fresh = f.store.grant(f.store.issue(f.store.client(f.pair.token), grantInput()).grantToken)
  f.operation('op-held')
  assert.throws(() => f.admissions.admit('op-held', revoked, identityOf(f.tree.parent)), busy('GRANT_REVOKED'))
  assert.equal(f.admissions.admit('op-held', fresh, identityOf(f.tree.parent)).fresh, true)
  f.store.revokeGrants(f.store.client(f.pair.token), { botId: 'bot-a' })
  assert.throws(() => f.admissions.releaseIfTerminal('op-held', fresh), busy('GRANT_REVOKED'))
  assert.equal(f.admissions.list().length, 1)
  assert.throws(() => f.admissions.list(fresh), busy('GRANT_REVOKED'))
})

test('workspace admission/native: an injected insert failure rolls back without leaving a half lock', async t => {
  const dir = await mkdtemp(join(parent, 'case-')), tree = syntheticTree(dir)
  class FailingAdmission extends Database {
    prepare(sql) {
      const statement = super.prepare(sql)
      if (!String(sql).includes('INSERT INTO workspace_admissions')) return statement
      return new Proxy(statement, { get(target, prop) { if (prop === 'run') return () => { throw new Error('FIXTURE_ADMISSION_INSERT_FAILED') }; const value = Reflect.get(target, prop, target); return typeof value === 'function' ? value.bind(target) : value } })
    }
  }
  const store = new Store(join(dir, 'data'), FailingAdmission), admissions = new WorkspaceAdmissions(store)
  t.after(() => store.close())
  const pair = store.pair('host', ceiling), context = store.grant(store.issue(store.client(pair.token), grantInput()).grantToken)
  store.admit('op-half', context, 'fs_write', {})
  assert.throws(() => admissions.admit('op-half', context, identityOf(tree.parent)), /FIXTURE_ADMISSION_INSERT_FAILED/)
  assert.equal(store.db.inTransaction, false)
  assert.deepEqual(admissions.list(), [])
  assert.equal(rows(store, 'SELECT count(*) n FROM workspace_admissions')[0].n, 0)
  assert.equal(store.status('op-half', context).status, 'admitted')
  const other = admin(join(dir, 'data')); t.after(() => other.store.close())
  assert.equal(other.admissions.admit('op-half', context, identityOf(tree.parent)).fresh, true)
})

test('workspace admission/native: malformed identities, unknown operations and unsupported tools are rejected without a row', async t => {
  const f = await fixture(t)
  const good = identityOf(f.tree.parent), hex = 'a'.repeat(64)
  const malformed = [null, 'identity', [], {}, { ancestors: [hex], path: f.tree.parent, platform: process.platform },
    { key: hex, ancestors: [hex], path: f.tree.parent }, { key: hex, ancestors: [hex], path: f.tree.parent, platform: process.platform, extra: 1 },
    { key: 'zz', ancestors: [hex], path: f.tree.parent, platform: process.platform },
    { key: hex, ancestors: [], path: f.tree.parent, platform: process.platform },
    { key: hex, ancestors: ['b'.repeat(64)], path: f.tree.parent, platform: process.platform },
    { key: hex, ancestors: [hex], path: 'relative/path', platform: process.platform },
    { key: hex, ancestors: [hex], path: f.tree.parent, platform: 'darwin' },
    { key: hex, ancestors: [hex, 7], path: f.tree.parent, platform: process.platform },
    { key: hex, ancestors: Array.from({ length: 129 }, () => hex), path: f.tree.parent, platform: process.platform }]
  f.operation('op-bad')
  for (const identity of malformed) assert.throws(() => f.admissions.admit('op-bad', f.context, identity), busy('INVALID_WORKSPACE_IDENTITY'))
  assert.throws(() => f.admissions.assertAvailable(malformed[0]), busy('INVALID_WORKSPACE_IDENTITY'))
  assert.throws(() => f.admissions.admit('op-missing', f.context, good), busy('OPERATION_NOT_FOUND'))
  f.operation('op-read', 'fs_read', { rootId: 'project' })
  assert.throws(() => f.admissions.admit('op-read', f.context, good), busy('WORKSPACE_TOOL_NOT_SUPPORTED'))
  assert.deepEqual(f.admissions.list(), [])
  f.admissions.assertAvailable(good)
  assert.equal(f.admissions.admit('op-bad', f.context, good).fresh, true)
  assert.equal(f.admissions.list().length, 1)
})

test('workspace admission/native: a shell receipt releases the root only on a real JSON boolean stop confirmation', async t => {
  const f = await fixture(t)
  const shell = { kind: 'container-command', containerId: 'c' }
  const cases = [
    ['numeric', { ...shell, stopConfirmed: 1 }],
    ['float-one', { ...shell, stopConfirmed: 1.0 }],
    ['string-true', { ...shell, stopConfirmed: 'true' }],
    ['nested-object', { ...shell, stopConfirmed: { stopConfirmed: true } }],
    ['not-started-numeric', { ...shell, notStarted: 1 }]]
  for (const [index, [label, result]] of cases.entries()) {
    const root = join(f.dir, `root-${label}`); mkdirSync(root, { recursive: true })
    const id = `op-stop-${label}`; f.operation(id, 'shell_exec', {}); f.admissions.admit(id, f.context, identityOf(root))
    f.store.finish(id, 'failed', result, 'FIXTURE_STOP_EVIDENCE')
    assert.equal(f.admissions.list().length, index + 1, `${label}: the physical root lock must be retained`)
    const release = f.admissions.releaseIfTerminal(id, f.context)
    assert.equal(release.released, false, label)
    assert.equal(release.reason, 'STOP_UNCONFIRMED', label)
    assert.equal(release.status, 'failed', label)
  }
  const malformedRoot = join(f.dir, 'root-malformed'); mkdirSync(malformedRoot, { recursive: true })
  f.operation('op-stop-malformed', 'shell_exec', {}); f.admissions.admit('op-stop-malformed', f.context, identityOf(malformedRoot))
  f.store.db.prepare("UPDATE operations SET status='failed',result='not json at all',error='FIXTURE_MALFORMED_RECEIPT' WHERE id=?").run('op-stop-malformed')
  assert.equal(f.admissions.list().length, cases.length + 1, 'a malformed stored receipt must not release the lock')
  assert.equal(f.admissions.releaseIfTerminal('op-stop-malformed', f.context).reason, 'STOP_UNCONFIRMED')
  f.operation('op-stop-true', 'shell_exec', {}); f.admissions.admit('op-stop-true', f.context, identityOf(f.tree.other))
  f.store.finish('op-stop-true', 'succeeded', { ...shell, stopConfirmed: true }, null)
  assert.equal(f.admissions.list().length, cases.length + 1, 'a real stopConfirmed boolean still releases in the same transaction')
  f.operation('op-stop-notstarted', 'shell_exec', {}); f.admissions.admit('op-stop-notstarted', f.context, identityOf(f.tree.other))
  f.store.finish('op-stop-notstarted', 'cancelled', { ...shell, notStarted: true }, 'HOST_INTERRUPTED_BEFORE_START')
  assert.equal(f.admissions.list().length, cases.length + 1, 'a real notStarted boolean still releases in the same transaction')
  assert.throws(() => f.admissions.admit('op-stop-true', f.context, identityOf(f.tree.other)), busy('OPERATION_CONFLICT'))
})

test('workspace admission/native: a snapshot with a different platform is not the same admission', async t => {
  const f = await fixture(t)
  f.operation('op-platform')
  const first = f.admissions.admit('op-platform', f.context, identityOf(f.tree.parent))
  assert.equal(first.fresh, true)
  assert.equal(first.admission.platform, process.platform)
  const shifted = process.platform === 'win32' ? 'linux' : 'win32'
  const moved = { ...identityOf(f.tree.parent), platform: shifted }
  assert.throws(() => f.admissions.admit('op-platform', f.context, moved), busy('WORKSPACE_CONFLICT'))
  assert.throws(() => f.admissions.admit('op-platform', f.context, { ...moved, ancestors: moved.ancestors }), busy('WORKSPACE_CONFLICT'))
  assert.equal(f.admissions.list().length, 1)
  assert.equal(f.admissions.list()[0].platform, process.platform)
  assert.equal(f.admissions.admit('op-platform', f.context, identityOf(f.tree.parent)).fresh, false)
  assert.equal(f.admissions.admit('op-platform', f.context, { ...identityOf(f.tree.parent), platform: process.platform }).fresh, false)
})

test('workspace admission/native: the active admission capacity is explicit, bounded and never deletes an old lock', async t => {
  const f = await fixture(t)
  const capacity = f.admissions.MAX_ACTIVE_ADMISSIONS
  assert.equal(capacity, 4096)
  f.operation('op-capacity'); f.admissions.admit('op-capacity', f.context, identityOf(f.tree.parent))
  const insert = f.store.db.prepare('INSERT INTO workspace_admissions(operation_id,tool,root_key,path,platform,ancestors,ancestor_count,context,acquired_at) VALUES (?,?,?,?,?,?,?,?,?)')
  const synthetic = f.store.db.transaction(() => {
    const operation = f.store.db.prepare('INSERT INTO operations(id,digest,context,tool,status,started) VALUES (?,?,?,?,?,?)')
    for (let index = 0; index < capacity - 1; index++) {
      const key = index.toString(16).padStart(64, '0')
      operation.run(`synthetic-${index}`, 'f'.repeat(64), JSON.stringify(f.context), 'fs_write', 'running', index)
      insert.run(`synthetic-${index}`, 'fs_write', key, `${f.tree.other}\\synthetic-${index}`, process.platform, JSON.stringify([key]), 1, JSON.stringify(f.context), index)
    }
  })
  synthetic()
  assert.equal(f.admissions.list().length, capacity)
  const free = join(f.dir, 'root-free'); mkdirSync(free, { recursive: true })
  f.operation('op-at-limit')
  assert.throws(() => f.admissions.admit('op-at-limit', f.context, identityOf(free)), busy('WORKSPACE_ADMISSION_LIMIT'))
  assert.equal(rows(f.store, 'SELECT count(*) n FROM workspace_admissions')[0].n, capacity, 'a refused admission must not delete an old lock')
  assert.equal(f.admissions.admit('op-capacity', f.context, identityOf(f.tree.parent)).fresh, false, 'an idempotent replay must still succeed at the limit')
  f.admissions.assertAvailable(identityOf(free), 'op-at-limit')
  f.store.finish('op-capacity', 'succeeded', { sha256: '0'.repeat(64), size: 1 })
  assert.equal(f.admissions.list().length, capacity - 1)
  assert.equal(f.admissions.admit('op-at-limit', f.context, identityOf(free)).fresh, true)
})

test('workspace admission/native: releaseIfTerminal never reveals another subject operation state', async t => {
  const f = await fixture(t)
  const stranger = f.store.grant(f.store.issue(f.store.client(f.pair.token), grantInput('bot-b')).grantToken)
  const attempt = f.store.grant(f.store.issue(f.store.client(f.pair.token), { ...grantInput(), attemptId: 'attempt-b' }).grantToken)
  f.operation('op-secret'); f.admissions.admit('op-secret', f.context, identityOf(f.tree.parent))
  assert.throws(() => f.admissions.releaseIfTerminal('op-secret', stranger), busy('SCOPE_DENIED'))
  assert.throws(() => f.admissions.releaseIfTerminal('op-secret', attempt), busy('SCOPE_DENIED'))
  assert.equal(f.admissions.list().length, 1)
  f.store.finish('op-secret', 'succeeded', { sha256: '0'.repeat(64), size: 1 })
  assert.deepEqual(f.admissions.list(), [])
  assert.throws(() => f.admissions.releaseIfTerminal('op-secret', stranger), busy('SCOPE_DENIED'))
  assert.throws(() => f.admissions.releaseIfTerminal('op-secret', attempt), busy('SCOPE_DENIED'))
  const own = f.admissions.releaseIfTerminal('op-secret', f.context)
  assert.equal(own.released, true); assert.equal(own.reason, 'ALREADY_RELEASED'); assert.equal(own.status, 'succeeded')
  f.operation('op-secret-2', 'shell_exec', {}); f.admissions.admit('op-secret-2', f.context, identityOf(f.tree.other))
  f.store.finish('op-secret-2', 'failed', { exitCode: 1 }, 'PROCESS_EXIT_NONZERO')
  assert.throws(() => f.admissions.releaseIfTerminal('op-secret-2', stranger), busy('SCOPE_DENIED'))
  const retained = f.admissions.releaseIfTerminal('op-secret-2', f.context)
  assert.equal(retained.released, false); assert.equal(retained.reason, 'STOP_UNCONFIRMED')
  assert.equal(f.admissions.releaseIfTerminal('op-unknown-to-anyone', f.context).reason, 'OPERATION_NOT_FOUND')
  assert.equal(f.admissions.releaseIfTerminal('op-unknown-to-anyone', stranger).reason, 'OPERATION_NOT_FOUND')
})
