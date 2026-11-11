import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createNativeActivityService } from '../packages/orchestration/src/native-activity-service.mjs'
import { hostConversationId } from '../packages/orchestration/src/native-activity-contract.mjs'

const require = createRequire(new URL('../package.json', import.meta.url)), Database = require('better-sqlite3')
const root = fileURLToPath(new URL('../tmp/integration/activity-backend/', import.meta.url))
mkdirSync(root, { recursive: true })
const fresh = () => join(mkdtempSync(join(root, 'service-')), 'activity.sqlite')
const owner = { kind: 'owner' }
const identity = mode => ({ botId: 'a', mode, conversationId: mode === 'integration' ? hostConversationId('session-a') : 'context-a', contextId: mode === 'integration' ? null : 'context-a', processGeneration: 'native-random-generation', turnId: 'turn-1' })
const payload = mode => ({ botId: 'a', mode, ...(mode === 'integration' ? { sessionId: 'session-a' } : { contextId: 'context-a' }) })
const observe = (service, event) => { const result = service.observe(event); assert.equal(result.ok, true, JSON.stringify(result)); return result }

for (const mode of ['integration', 'independent']) test(`owner ${mode} reads exact scope and genuine reported facts`, () => {
  let committed = true
  const service = createNativeActivityService({ Database, file: fresh(), namespace: 'host-one', committedBot: id => committed && id === 'a' ? { id } : null, nativeRouteForBot: () => true })
  const scope = identity(mode)
  try {
    observe(service, { kind: 'turn-open', identity: scope })
    observe(service, { kind: 'tool', identity: scope, tool: { phase: 'started', id: 'call-1', name: 'read_notes', input: { secret: 'must-not-appear' } } })
    observe(service, { kind: 'tool', identity: scope, tool: { phase: 'completed', id: 'call-1', ok: true, result: 'must-not-appear' } })
    observe(service, { kind: 'turn-close', identity: scope, outcome: 'succeeded' })
    const result = service.list(payload(mode), owner)
    assert.equal(result.scope.sessionId, mode === 'integration' ? 'session-a' : null)
    assert.equal(result.scope.conversationId, scope.conversationId)
    assert.equal(result.items.length, 1)
    assert.ok(result.items.every(row => row.botId === result.scope.botId && row.mode === result.scope.mode && row.conversationId === result.scope.conversationId && row.contextId === result.scope.contextId))
    assert.equal(result.recording.status, 'ready'); assert.equal(result.items[0].state, 'cli-ok')
    assert.equal(JSON.stringify(result).includes('must-not-appear'), false)
    assert.throws(() => service.list(payload(mode), { kind: 'bot', botId: 'a' }), { code: 'REMOTE_OWNER_REQUIRED' })
    assert.throws(() => service.list({ ...payload(mode), subject: {} }, owner), { code: 'ACTIVITY_LIST_PAYLOAD_INVALID' })
    assert.throws(() => service.list({ ...payload(mode), limit: 51 }, owner), { code: 'ACTIVITY_QUERY_LIMIT_INVALID' })
    committed = false
    assert.throws(() => service.list(payload(mode), owner), { code: 'ACTIVITY_BOT_NOT_FOUND' })
  } finally { service.close() }
})

test('read-only owner reads neither write nor reconcile pending activity', () => {
  const file = fresh(), service = createNativeActivityService({ Database, file, committedBot: id => ({ id }), nativeRouteForBot: () => true })
  observe(service, { kind: 'turn-open', identity: identity('independent') })
  observe(service, { kind: 'tool', identity: identity('independent'), tool: { phase: 'started', id: 'call-1', name: 'read_notes' } })
  const inspector = new Database(file)
  try {
    const before = inspector.pragma('data_version', { simple: true }), health = service.health()
    for (let index = 0; index < 3; index++) assert.equal(service.list(payload('independent'), { ...owner, readOnly: true }).items[0].state, 'running')
    assert.equal(inspector.pragma('data_version', { simple: true }), before)
    assert.deepEqual(service.health(), health)
  } finally { inspector.close(); service.close() }
})

test('persistence failures degrade the owner view, while failed reads cannot look empty-success', () => {
  let raw
  function CapturedDatabase(file) { raw = new Database(file); return raw }
  const service = createNativeActivityService({ Database: CapturedDatabase, file: fresh(), committedBot: id => ({ id }), nativeRouteForBot: () => true })
  try {
    observe(service, { kind: 'turn-open', identity: identity('independent') })
    raw.exec("CREATE TRIGGER fail_activity BEFORE INSERT ON native_activity_calls BEGIN SELECT RAISE(FAIL, 'private-path'); END")
    const failed = service.observe({ kind: 'tool', identity: identity('independent'), tool: { phase: 'started', id: 'call-1', name: 'read_notes' } })
    assert.equal(failed.ok, false)
    const result = service.list(payload('independent'), owner)
    assert.equal(result.recording.status, 'degraded'); assert.ok(result.recording.failures > 0)
    assert.equal(JSON.stringify(result).includes('private-path'), false)
    raw.exec('DROP TABLE native_activity_calls')
    assert.throws(() => service.list(payload('independent'), owner), { code: 'ACTIVITY_LIST_FAILED' })
  } finally { service.close() }
})

test('unavailable display storage stays explicit and closing fences every late event', () => {
  function UnavailableDatabase() { throw new Error('private-installation-path') }
  const service = createNativeActivityService({ Database: UnavailableDatabase, file: fresh(), committedBot: id => ({ id }), nativeRouteForBot: () => false })
  assert.equal(service.health().status, 'degraded')
  assert.throws(() => service.list(payload('independent'), owner), { code: 'ACTIVITY_STORE_UNAVAILABLE' })
  assert.equal(service.observe({ kind: 'turn-open', identity: identity('independent') }).ok, false)
  service.close(); service.close()
  assert.throws(() => service.observe({ kind: 'turn-close', identity: identity('independent'), outcome: 'unknown' }), { code: 'ACTIVITY_SERVICE_CLOSED' })
  assert.throws(() => service.list(payload('independent'), owner), { code: 'ACTIVITY_SERVICE_CLOSED' })
})

test('cancel request and stop-confirmed remain independent through the service', () => {
  const service = createNativeActivityService({ Database, file: fresh(), committedBot: id => ({ id }), nativeRouteForBot: () => true })
  try {
    const scope = identity('independent')
    observe(service, { kind: 'turn-open', identity: scope })
    observe(service, { kind: 'tool', identity: scope, tool: { phase: 'started', id: 'call-1', name: 'read_notes' } })
    observe(service, { kind: 'cancel-requested', identity: scope })
    let row = service.list(payload('independent'), owner).items[0]
    assert.equal(row.cancelRequested, true); assert.equal(row.stopConfirmed, false)
    observe(service, { kind: 'turn-close', identity: scope, outcome: 'unknown' })
    observe(service, { kind: 'stop-confirmed', identity: scope })
    row = service.list(payload('independent'), owner).items[0]
    assert.equal(row.state, 'turn-unconfirmed'); assert.equal(row.stopConfirmed, true); assert.equal(row.cliOk, null)
  } finally { service.close() }
})

test('a smaller trusted Host page bound remains usable through the public owner limit', () => {
  const service = createNativeActivityService({ Database, file: fresh(), limits: { maxPageSize: 2 }, committedBot: id => ({ id }), nativeRouteForBot: () => true })
  try {
    const scope = identity('independent')
    observe(service, { kind: 'turn-open', identity: scope })
    for (let index = 0; index < 3; index++) observe(service, { kind: 'tool', identity: scope, tool: { phase: 'started', id: `call-${index}`, name: 'read_notes' } })
    const result = service.list({ ...payload('independent'), limit: 20 }, owner)
    assert.equal(result.items.length, 2)
    assert.equal(typeof result.nextCursor, 'string')
    assert.equal(result.recording.status, 'ready')
  } finally { service.close() }
})
