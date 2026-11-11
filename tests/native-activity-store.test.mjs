import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createActivityStore } from '../packages/orchestration/src/native-activity-store.mjs'

const require = createRequire(new URL('../package.json', import.meta.url))
const Database = require('better-sqlite3')
const root = fileURLToPath(new URL('../tmp/integration/activity-backend/', import.meta.url))
mkdirSync(root, { recursive: true })
const fresh = () => join(mkdtempSync(join(root, 'store-')), 'activity.sqlite')
const identity = patch => ({ botId: 'a', mode: 'independent', conversationId: 'context-a', contextId: 'context-a', processGeneration: 'native-instance-one', turnId: 'turn-1', ...patch })
const query = patch => ({ botId: 'a', mode: 'independent', conversationId: 'context-a', contextId: 'context-a', ...patch })
const started = (id = 'call-1') => ({ phase: 'started', id, name: 'read_notes' })
const completed = (id = 'call-1', ok = true) => ({ phase: 'completed', id, ok })
const must = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result }

test('actual SQLite persists one call across duplicate events and a clean close/reopen', () => {
  const file = fresh(), store = createActivityStore({ Database, file })
  const scope = identity()
  must(store.openTurn(scope)); must(store.recordToolEvent(scope, started()))
  must(store.recordToolEvent(scope, started())); must(store.recordToolEvent(scope, completed()))
  must(store.recordToolEvent(scope, completed('call-1', false))); must(store.closeTurn(scope, { outcome: 'succeeded' }))
  const [row] = store.page(query()).items
  assert.equal(row.state, 'cli-ok'); assert.equal(row.duplicateStarts, 1); assert.equal(row.duplicateCompletions, 1)
  store.close()
  const reopened = createActivityStore({ Database, file })
  try { assert.deepEqual(reopened.page(query()).items, [row]); assert.equal(reopened.stats().calls, 1) } finally { reopened.close() }
  assert.throws(() => store.recordToolEvent(scope, completed()), { code: 'ACTIVITY_STORE_CLOSED' })
})

test('late returns after cancellation preserve unknown, cancel and stop independently', () => {
  const store = createActivityStore({ Database, file: fresh() }), scope = identity()
  try {
    must(store.openTurn(scope)); must(store.requestCancel(scope)); must(store.recordToolEvent(scope, started()))
    let row = store.page(query()).items[0]
    assert.equal(row.cancelRequested, true); assert.equal(row.stopConfirmed, false)
    must(store.closeTurn(scope, { outcome: 'unknown' })); must(store.confirmStop(scope)); must(store.recordToolEvent(scope, completed()))
    row = store.page(query()).items[0]
    assert.equal(row.state, 'turn-unconfirmed'); assert.equal(row.cliOk, null); assert.equal(row.lateCliReturn, true); assert.equal(row.stopConfirmed, true)
    assert.equal(store.openTurn(scope).code, 'ACTIVITY_TURN_ALREADY_CLOSED')
  } finally { store.close() }
})

test('namespace, Bot, context, turn and random generation isolate identical CLI ids', () => {
  const file = fresh(), store = createActivityStore({ Database, file, namespace: 'first' })
  const scopes = [identity(), identity({ botId: 'b' }), identity({ contextId: 'context-b', conversationId: 'context-b' }), identity({ turnId: 'turn-2' }), identity({ processGeneration: 'native-second-instance' })]
  for (const scope of scopes) { must(store.openTurn(scope)); must(store.recordToolEvent(scope, started())); must(store.closeTurn(scope, { outcome: 'unknown' })) }
  const second = createActivityStore({ Database, file, namespace: 'second' })
  try {
    assert.equal(store.page(query()).items.length, 3)
    assert.equal(store.page(query({ botId: 'b' })).items.length, 1)
    assert.equal(second.page(query()).items.length, 0)
    assert.equal(new Set(store.page(query()).items.map(row => row.callKey)).size, 3)
  } finally { second.close(); store.close() }
})

test('read cursors are scope-bound and exclude new rows even at an identical timestamp', () => {
  const store = createActivityStore({ Database, file: fresh(), now: () => 100 })
  const scope = identity()
  try {
    must(store.openTurn(scope))
    for (let index = 0; index < 4; index++) must(store.recordToolEvent(scope, started(`call-${index}`)))
    const first = store.page(query({ limit: 2 }))
    must(store.recordToolEvent(scope, started('a-new-call')))
    const second = store.page(query({ limit: 2, cursor: first.nextCursor }))
    assert.equal(new Set([...first.items, ...second.items].map(row => row.callKey)).size, 4)
    assert.equal([...first.items, ...second.items].some(row => row.callId === 'a-new-call'), false)
    assert.throws(() => store.page(query({ botId: 'b', cursor: first.nextCursor })), { code: 'ACTIVITY_CURSOR_INVALID' })
  } finally { store.close() }
})

test('reads perform no SQLite changes and clean-close pending calls become host-closed', () => {
  const file = fresh(), store = createActivityStore({ Database, file }), scope = identity()
  must(store.openTurn(scope)); must(store.recordToolEvent(scope, started()))
  const inspector = new Database(file)
  try {
    const version = inspector.pragma('data_version', { simple: true })
    const rows = inspector.prepare('SELECT COUNT(*) AS n FROM native_activity_calls').get().n
    for (let index = 0; index < 5; index++) { store.page(query()); store.stats(); store.health() }
    assert.equal(inspector.pragma('data_version', { simple: true }), version)
    assert.equal(inspector.prepare('SELECT COUNT(*) AS n FROM native_activity_calls').get().n, rows)
  } finally { inspector.close(); store.close() }
  const next = createActivityStore({ Database, file })
  try { const row = next.page(query()).items[0]; assert.equal(row.state, 'turn-unconfirmed'); assert.equal(row.turnOutcome, 'host-closed') } finally { next.close() }
})

test('a live Host conflicts, dead-owner adoption fences every old instance operation', () => {
  const file = fresh(), first = createActivityStore({ Database, file, ownerId: 'old', ownerPid: 910001 })
  must(first.openTurn(identity())); must(first.recordToolEvent(identity(), started()))
  assert.throws(() => createActivityStore({ Database, file, ownerId: 'new', isProcessAlive: () => true }), { code: 'ACTIVITY_STORE_HOST_CONFLICT' })
  const next = createActivityStore({ Database, file, ownerId: 'new', isProcessAlive: () => false })
  try {
    assert.equal(next.adopted, true); assert.equal(next.strandedTurns, 1)
    const old = next.page(query()).items[0]
    assert.equal(old.turnOutcome, 'host-lost'); assert.equal(old.state, 'turn-unconfirmed')
    assert.equal(first.recordToolEvent(identity(), completed()).code, 'ACTIVITY_STORE_OWNER_LOST')
    assert.throws(() => first.page(query()), { code: 'ACTIVITY_STORE_OWNER_LOST' })
    first.close()
    const newScope = identity({ turnId: 'turn-new' })
    must(next.openTurn(newScope)); must(next.recordToolEvent(newScope, started()))
    assert.equal(next.stats().calls, 2)
  } finally { first.close(); next.close() }
})

test('hard storage bounds evict closed history but never delete a live call on refusal', () => {
  const store = createActivityStore({ Database, file: fresh(), limits: { maxRecords: 2, maxTurnsPerConversation: 2, maxCallsPerTurn: 1 } })
  try {
    const first = identity(), second = identity({ turnId: 'turn-2' }), third = identity({ turnId: 'turn-3' })
    must(store.openTurn(first)); must(store.recordToolEvent(first, started()))
    assert.equal(store.recordToolEvent(first, started('call-over-limit')).code, 'ACTIVITY_TURN_CALL_LIMIT')
    must(store.openTurn(second)); must(store.recordToolEvent(second, started()))
    assert.equal(store.openTurn(third).code, 'ACTIVITY_CONVERSATION_TURN_LIMIT')
    assert.equal(store.stats().calls, 2); assert.equal(store.stats().turns, 2)
    must(store.closeTurn(first, { outcome: 'succeeded' }))
    must(store.openTurn(third)); must(store.recordToolEvent(third, started()))
    assert.equal(store.stats().calls, 2); assert.equal(store.stats().turns, 2)
    assert.equal(store.page(query()).items.some(row => row.turnId === 'turn-1'), false)
  } finally { store.close() }
})

test('a real SQLite write failure returns a bounded code without a phantom row', () => {
  let raw
  function CapturedDatabase(file) { raw = new Database(file); return raw }
  const store = createActivityStore({ Database: CapturedDatabase, file: fresh() })
  try {
    must(store.openTurn(identity()))
    raw.exec("CREATE TRIGGER fail_activity BEFORE INSERT ON native_activity_calls BEGIN SELECT RAISE(FAIL, 'private-host-path'); END")
    const result = store.recordToolEvent(identity(), started())
    assert.equal(result.ok, false); assert.equal(result.code, 'ACTIVITY_EVENT_WRITE_FAILED')
    assert.equal(JSON.stringify(result).includes('private-host-path'), false)
    assert.equal(store.page(query()).items.length, 0)
    assert.equal(store.health().failures, 1)
  } finally { store.close() }
})

test('empty turns across distinct conversations also obey the global retention bound', () => {
  const store = createActivityStore({ Database, file: fresh(), limits: { maxRecords: 2 } })
  try {
    for (let index = 0; index < 8; index++) {
      const scope = identity({ conversationId: `context-${index}`, contextId: `context-${index}` })
      must(store.openTurn(scope)); must(store.closeTurn(scope, { outcome: 'succeeded' }))
      assert.ok(store.stats().turns <= 2)
    }
    assert.equal(store.stats().calls, 0)
  } finally { store.close() }
})
