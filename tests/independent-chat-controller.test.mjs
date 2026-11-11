import test from 'node:test'
import assert from 'node:assert/strict'
import { createIndependentChatController, independentChatStorageKey, validateChatPage, validateChatRequest } from '../apps/integration-client/independent-chat-controller.mjs'

const hostId = 'host-0123456789abcdef', botId = 'bot-a', requestKey = 'request-key-controller-123456'
const flush = async () => { for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve)) }
const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done }), resolve: value => resolve(value) } }
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data } }
const result = patch => ({ schemaVersion: 1, botId, requestKey, state: 'accepted', pending: true, finished: false, stopConfirmed: false, durableInput: true, cancelRequested: false, ...patch })
function fixture(t, overrides = {}) {
  const memory = overrides.storage ?? storage(), calls = [], handlers = {
    'ui.namespace': () => ({ schemaVersion: 1, hostId }),
    'independentChat.view': () => ({ schemaVersion: 1, botId, mode: 'independent', available: true, pendingRequest: null, latestRequest: null }),
    'independentChat.messages': () => ({ schemaVersion: 1, botId, items: [], nextCursor: null }),
    'independentChat.send': () => result(), 'independentChat.inspect': () => result(), 'independentChat.cancel': () => result({ cancelRequested: true }), ...overrides.handlers,
  }
  const api = { dispatch: async (action, payload, signal) => { calls.push({ action, payload, signal }); return handlers[action](payload) } }
  const controller = createIndependentChatController({ api, hostId, botId, storage: memory, pollMs: 100_000, timeoutMs: 1000, nonce: () => requestKey })
  t.after(() => controller.dispose()); controller.start()
  return { controller, calls, handlers, memory }
}

test('a synchronous intent lock persists one nonce before send, and durable acceptance clears only its draft', async t => {
  const ack = gate(), f = fixture(t, { handlers: { 'independentChat.send': () => {
    const saved = JSON.parse(f.memory.getItem(independentChatStorageKey(hostId, botId)))
    assert.equal(saved.pending.requestKey, requestKey); assert.equal(saved.pending.input, 'hello')
    return ack.promise
  } } })
  await flush(); f.controller.setDraft('hello')
  const first = f.controller.send(), second = f.controller.send()
  await flush(); assert.equal(f.calls.filter(row => row.action.endsWith('.send')).length, 1)
  f.controller.setDraft('the next unsent draft')
  ack.resolve(result()); await Promise.all([first, second])
  assert.equal(f.controller.getSnapshot().draft, 'the next unsent draft')
  assert.equal(f.controller.getSnapshot().pending.requestKey, requestKey)
})

test('reload inspects the original uncertain key without another send; explicit restore only fills the composer', async t => {
  const memory = storage()
  memory.setItem(independentChatStorageKey(hostId, botId), JSON.stringify({ schemaVersion: 1, hostId, botId, draft: 'hello', pending: { requestKey, input: 'hello', accepted: false } }))
  const f = fixture(t, { storage: memory, handlers: { 'independentChat.inspect': () => result({ state: 'unknown', pending: false, finished: true, recoveryInput: 'hello' }) } })
  await flush()
  assert.equal(f.calls.some(row => row.action === 'independentChat.send'), false)
  assert.equal(f.controller.getSnapshot().draft, '')
  f.controller.restore()
  assert.equal(f.controller.getSnapshot().draft, 'hello'); assert.equal(f.controller.getSnapshot().pending, null)
  await flush(); assert.equal(f.calls.some(row => row.action === 'independentChat.send'), false)
})

test('retiring a Host ignores late acknowledgements and cannot write into another Host draft', async t => {
  const ack = gate(), f = fixture(t, { handlers: { 'independentChat.send': () => ack.promise } })
  await flush(); f.controller.setDraft('original host draft'); const send = f.controller.send(); await flush()
  const key = independentChatStorageKey(hostId, botId), before = f.memory.getItem(key)
  f.controller.dispose(); ack.resolve(result({ state: 'succeeded', pending: false, finished: true })); await send
  assert.equal(f.memory.getItem(key), before)
  assert.ok(f.calls.filter(row => row.action !== 'ui.namespace').every(row => row.payload.botId === botId))
})

test('a cancellation request keeps the unconfirmed fact when a late answer succeeds', async t => {
  const f = fixture(t)
  await flush(); f.controller.setDraft('hello'); await f.controller.send(); await flush()
  await f.controller.cancel()
  assert.equal(f.controller.getSnapshot().pending.status.cancelRequested, true)
  assert.equal(f.controller.getSnapshot().pending.status.stopConfirmed, false)
  f.handlers['independentChat.inspect'] = () => result({ state: 'succeeded', pending: false, finished: true, cancelRequested: true })
  f.controller.inspect(); await flush()
  assert.equal(f.controller.getSnapshot().pending, null)
  assert.equal(f.controller.getSnapshot().lastRequest.cancelRequested, true)
})

test('unavailable storage blocks the first network send and unknown Host mode never enables the composer', async t => {
  const f = fixture(t, { storage: { getItem: () => null, setItem: () => { throw new Error('quota') } } })
  await flush(); f.controller.setDraft('hello'); await f.controller.send()
  assert.equal(f.calls.some(row => row.action.endsWith('.send')), false)
  assert.match(f.controller.getSnapshot().storageError, /无法保存/)
  f.handlers['independentChat.view'] = () => ({ schemaVersion: 1, botId, mode: 'unknown', available: true })
  f.controller.inspect(); await flush(); assert.match(f.controller.getSnapshot().error, /状态无效/)
})

test('a journal not-found can release text explicitly, while transport failures cannot release it', async t => {
  const memory = storage()
  memory.setItem(independentChatStorageKey(hostId, botId), JSON.stringify({ schemaVersion: 1, hostId, botId, draft: 'hello', pending: { requestKey, input: 'hello' } }))
  const f = fixture(t, { storage: memory, handlers: { 'independentChat.inspect': () => { throw Object.assign(new Error('missing'), { code: 'INDEPENDENT_CHAT_REQUEST_NOT_FOUND' }) } } })
  await flush(); assert.equal(f.controller.getSnapshot().pending.notFound, true)
  f.controller.releaseNotFound(); assert.equal(f.controller.getSnapshot().pending, null); assert.equal(f.controller.getSnapshot().draft, 'hello')
  assert.equal(f.calls.some(row => row.action.endsWith('.send')), false)
})

test('message pages require one stable identity per full message, never preview indexes', () => {
  const page = { schemaVersion: 1, botId, items: [{ messageId: 'm-1', role: 'user', content: 'full text' }], nextCursor: null }
  assert.equal(validateChatPage(page, botId), page)
  assert.throws(() => validateChatPage({ ...page, items: [{ role: 'user', content: 'preview' }] }, botId), { code: 'CHAT_PAGE_INVALID' })
  assert.throws(() => validateChatPage({ ...page, items: [...page.items, ...page.items] }, botId), { code: 'CHAT_PAGE_INVALID' })
  assert.throws(() => validateChatPage(page, 'bot-b'), { code: 'CHAT_PAGE_INVALID' })
})

test('restoring an unknown request preserves a newer unsent draft and its pending identity', async t => {
  const status = result({ state: 'unknown', pending: false, finished: true, recoveryInput: 'old uncertain input' })
  const f = fixture(t, { handlers: {
    'independentChat.view': () => ({ schemaVersion: 1, botId, mode: 'independent', available: true, pendingRequest: null, latestRequest: status }),
  } })
  await flush()
  f.controller.setDraft('new text I have not sent')
  assert.equal(f.controller.restore(), false)
  assert.equal(f.controller.getSnapshot().draft, 'new text I have not sent')
  assert.equal(f.controller.getSnapshot().pending.requestKey, requestKey)
  assert.match(f.controller.getSnapshot().error, /已有未发送文字/)
  assert.equal(f.calls.some(row => row.action === 'independentChat.send'), false)
})

test('releasing a not-found request also preserves a newer draft', async t => {
  const memory = storage()
  memory.setItem(independentChatStorageKey(hostId, botId), JSON.stringify({ schemaVersion: 1, hostId, botId, draft: '',
    pending: { requestKey, input: 'original uncertain text', accepted: false } }))
  const f = fixture(t, { storage: memory, handlers: { 'independentChat.inspect': () => { throw Object.assign(new Error('not found'), { code: 'INDEPENDENT_CHAT_REQUEST_NOT_FOUND' }) } } })
  await flush()
  f.controller.setDraft('newer draft')
  assert.equal(f.controller.releaseNotFound(), false)
  assert.equal(f.controller.getSnapshot().draft, 'newer draft')
  assert.equal(f.controller.getSnapshot().pending.requestKey, requestKey)
})

test('new conversation persists one nonce, preserves the unsent draft and never submits a message', async t => {
  const ack = gate()
  const f = fixture(t, { handlers: {
    'independentChat.view': () => ({ schemaVersion: 1, botId, mode: 'independent', available: true, newConversationAvailable: true }),
    'independentChat.newConversation': () => ack.promise,
  } })
  await flush(); f.controller.setDraft('unsent text for the next conversation')
  const first = f.controller.newConversation(), second = f.controller.newConversation()
  await flush()
  const saved = JSON.parse(f.memory.getItem(independentChatStorageKey(hostId, botId)))
  assert.equal(saved.pending.operationKind, 'new-conversation')
  assert.equal(saved.draft, 'unsent text for the next conversation')
  assert.equal(f.calls.filter(row => row.action === 'independentChat.newConversation').length, 1)
  assert.equal(f.calls.some(row => row.action === 'independentChat.send'), false)
  ack.resolve(result({ operationKind: 'new-conversation', durableInput: false, state: 'succeeded', pending: false, finished: true }))
  await Promise.all([first, second])
  assert.equal(f.controller.getSnapshot().pending, null)
  assert.equal(f.controller.getSnapshot().draft, 'unsent text for the next conversation')
})

test('a new-conversation unknown cannot restore empty text over a newer draft or resend the operation', async t => {
  const memory = storage(), unknown = result({ operationKind: 'new-conversation', durableInput: false, state: 'unknown', pending: false, finished: true })
  memory.setItem(independentChatStorageKey(hostId, botId), JSON.stringify({ schemaVersion: 1, hostId, botId, draft: 'keep my next message',
    pending: { requestKey, input: '', operationKind: 'new-conversation' } }))
  const f = fixture(t, { storage: memory, handlers: { 'independentChat.inspect': () => unknown } })
  await flush()
  assert.equal(f.controller.restore(), false)
  assert.equal(f.controller.getSnapshot().draft, 'keep my next message')
  assert.equal(f.controller.getSnapshot().pending.operationKind, 'new-conversation')
  assert.equal(f.calls.some(row => ['independentChat.send', 'independentChat.newConversation'].includes(row.action)), false)
})

test('live progress is validated and displayed in memory but never saved as a browser draft', async t => {
  const progress = { step: 1, sequence: 2, text: 'uncommitted generated preview', truncated: false }
  const status = result({ state: 'running', progress })
  const f = fixture(t, { handlers: {
    'independentChat.view': () => ({ schemaVersion: 1, botId, mode: 'independent', available: true, pendingRequest: status, latestRequest: status }),
    'independentChat.inspect': () => status,
  } })
  await flush()
  assert.equal(f.controller.getSnapshot().pending.status.progress.text, progress.text)
  assert.equal(f.memory.getItem(independentChatStorageKey(hostId, botId)).includes(progress.text), false)
  assert.equal(f.calls.some(row => row.action === 'independentChat.send'), false)
})

test('a stored stale preview cannot appear before the current Host confirms a pending request', t => {
  const memory = storage()
  memory.setItem(independentChatStorageKey(hostId, botId), JSON.stringify({ schemaVersion: 1, hostId, botId, draft: '',
    pending: { requestKey, input: 'my original input', status: result({ state: 'running', progress: { step: 1, sequence: 2, text: 'stale generated text', truncated: false } }) } }))
  const f = fixture(t, { storage: memory })
  assert.equal(f.controller.getSnapshot().pending.status.progress, undefined)
})

test('partial progress cannot claim a completed answer or exceed the bounded response shape', () => {
  const progress = { step: 1, sequence: 2, text: 'partial', truncated: false }
  assert.equal(validateChatRequest(result({ state: 'running', progress }), botId).progress, progress)
  for (const patch of [{ text: 'x'.repeat(64001) }, { sequence: 0 }, { step: 0 }, { truncated: 'false' }]) {
    assert.throws(() => validateChatRequest(result({ state: 'running', progress: { ...progress, ...patch } }), botId), { code: 'CHAT_PROGRESS_INVALID' })
  }
  assert.throws(() => validateChatRequest(result({ state: 'succeeded', pending: false, finished: true, progress }), botId), { code: 'CHAT_PROGRESS_INVALID' })
})

test('the same API object changing Host namespace blocks sending before admission and retires its controller', async t => {
  let changed = 0
  const f = fixture(t)
  await flush(); f.controller.setDraft('original namespace text')
  f.handlers['ui.namespace'] = () => ({ schemaVersion: 1, hostId: 'host-fedcba9876543210' })
  const send = f.controller.send(); await send
  assert.equal(f.calls.some(row => row.action === 'independentChat.send'), false)
  assert.equal(f.controller.getSnapshot().view, null)
  assert.equal(JSON.parse(f.memory.getItem(independentChatStorageKey(hostId, botId))).draft, 'original namespace text')
})
