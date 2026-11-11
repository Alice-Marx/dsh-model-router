import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPOSER_DRAFT_KEY,
  COMPOSER_DRAFT_HOST_KEY,
  COMPOSER_DRAFT_LIMITS,
  composerDraftKey,
  conversationKey,
  createComposerDraftStore,
  ownerKeyFromRoster,
  resolveHostId,
  textBytes,
  threadKeyFromRoster,
} from '../apps/integration-client/composer-draft.mjs'

const HOST = 'host-0123456789abcdef'

/** The key split the React binding uses, so a test names the same conversation. */
const partsOfKey = key => {
  const thread = key.indexOf(':thread:')
  if (thread !== -1) {
    const kind = key.slice(0, key.indexOf(':'))
    return { kind, ownerId: key.slice(kind.length + 1, thread), threadId: key.slice(thread + ':thread:'.length) }
  }
  const colon = key.indexOf(':')
  return colon === -1 ? null : { kind: key.slice(0, colon), ownerId: key.slice(colon + 1) }
}

/** A storage that records what was written, and can be told to refuse writes. */
function fakeStorage({ failWrites = false } = {}) {
  const map = new Map()
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { if (failWrites) throw new Error('quota'); map.set(key, String(value)) },
    removeItem: key => map.delete(key),
  }
}

const store = (options = {}) => createComposerDraftStore({
  storage: fakeStorage(),
  hostId: HOST,
  now: () => 1700000000000,
  schedule: run => run(),
  ...options,
})

const served = (store, kind, ownerId, sessionId) => store.see({ kind, ownerId, sessionId })

test('composer drafts: a saved draft reads back as the same text and nothing else', () => {
  const drafts = store()
  assert.equal(served(drafts, 'bot', 'bot-a', 'part-1'), true)
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a' }), null)
  assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'bot-a', sessionId: 'part-1', text: '你好，明天把报告发我', revision: 1 }), { ok: true })
  const record = drafts.read({ kind: 'bot', ownerId: 'bot-a' })
  assert.equal(record.text, '你好，明天把报告发我')
  assert.equal(record.revision, 1)
  assert.equal(record.sessionId, 'part-1')
  // Text only: no attachment, path or credential field exists to persist.
  assert.deepEqual(Object.keys(record).sort(), ['bytes', 'key', 'pendingAt', 'pendingRequestId', 'revision', 'sessionId', 'text', 'updatedAt'])
  assert.equal(record.pendingAt, 0)
})

test('composer drafts: an empty composer is never written over a saved draft', () => {
  const drafts = store()
  served(drafts, 'bot', 'bot-a', 'part-1')
  drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'keep me', revision: 1 })
  assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'bot-a', text: '', revision: 2 }), { ok: false, reason: 'empty-draft' })
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a' }).text, 'keep me')
})

test('composer drafts: a conversation the Host never served is unreachable', () => {
  const drafts = store()
  // A foreign key cannot be written, and a read of one finds nothing.
  assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'ghost', text: 'hello', revision: 1 }), { ok: false, reason: 'unknown-conversation' })
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'ghost' }), null)
  assert.deepEqual(drafts.clear({ kind: 'bot', ownerId: 'ghost', revision: 9 }), { ok: false, reason: 'unknown-conversation' })
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'ghost' }), null)
  // Neither can a Bot and a group that share an id, nor a malformed identity.
  served(drafts, 'bot', 'shared', 's')
  drafts.save({ kind: 'bot', ownerId: 'shared', text: 'bot text', revision: 1 })
  assert.equal(drafts.read({ kind: 'room', ownerId: 'shared' }), null)
  assert.equal(conversationKey({ kind: 'agent', ownerId: 'x' }), '')
  assert.equal(conversationKey({ kind: 'bot', ownerId: 'a:b' }), '')
  assert.equal(conversationKey({ kind: 'bot', ownerId: '' }), '')
})

test('composer drafts: a stale or replayed revision never overwrites a newer draft', () => {
  const drafts = store()
  served(drafts, 'bot', 'bot-a', 'part-1')
  drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'first', revision: 1 })
  drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'second', revision: 2 })
  // The same revision again, an older one, and a non-integer are all refused.
  for (const revision of [2, 1, 0, -1, 1.5, undefined, '2']) {
    assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'stale', revision }), { ok: false, reason: 'stale-revision' }, String(revision))
  }
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a' }).text, 'second')
  // A clear needs the same freshness.
  assert.deepEqual(drafts.clear({ kind: 'bot', ownerId: 'bot-a', revision: 2 }), { ok: false, reason: 'stale-revision' })
  assert.deepEqual(drafts.clear({ kind: 'bot', ownerId: 'bot-a', revision: 3 }), { ok: true })
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a' }), null)
  // Clearing what is already gone is not an error.
  assert.deepEqual(drafts.clear({ kind: 'bot', ownerId: 'bot-a', revision: 4 }), { ok: true })
})

test('composer drafts: per-conversation and per-Host budgets refuse instead of truncating', () => {
  let stamp = 1700000000000
  const drafts = store({ now: () => (stamp += 1000), limits: { maxTextChars: 12, maxTextBytes: 12, maxTotalBytes: 20, maxSessions: 2 } })
  for (const owner of ['a', 'b', 'c']) served(drafts, 'bot', owner, 's')
  assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'a', text: 'abcdefghijklm', revision: 1 }), { ok: false, reason: 'too-long' })
  assert.equal(textBytes('一二三四五'), 15)
  assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'a', text: '一二三四五', revision: 1 }), { ok: false, reason: 'too-large' })
  assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'a', text: 'short', revision: 1 }), { ok: true })
  assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'b', text: 'also short', revision: 1 }), { ok: true })
  assert.deepEqual(drafts.save({ kind: 'bot', ownerId: 'c', text: 'third one', revision: 1 }), { ok: false, reason: 'over-budget' })
  // The oldest draft is what a full store gives up, never the newest one.
  drafts.save({ kind: 'bot', ownerId: 'b', text: ' renewed ', revision: 2 })
  drafts.save({ kind: 'bot', ownerId: 'c', text: 'newest', revision: 1 })
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'a' }), null)
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'b' }).text, ' renewed ')
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'c' }).text, 'newest')
})

test('composer drafts: two threads of one Bot never share a draft', () => {
  const drafts = store()
  const roster = {
    byId: { 'bot-a': { id: 'bot-a' }, 'bot-a:t1': { id: 'bot-a' }, 'bot-a:t2': { id: 'bot-a' }, 'bot-a:root': { id: 'bot-a' } },
    roomsById: {},
  }
  // The Host directory maps each thread's Session to its stable threadId.
  const threads = { 'bot-a:t1': 't-1', 'bot-a:t2': 't-2' }
  const keyOf = sessionId => threadKeyFromRoster(sessionId, roster, id => threads[id])
  assert.equal(keyOf('bot-a:root'), 'bot:bot-a')
  assert.equal(keyOf('bot-a:t1'), 'bot:bot-a:thread:t-1')
  assert.equal(keyOf('bot-a:t2'), 'bot:bot-a:thread:t-2')
  // A threadId the Host directory would never mint gives no draft at all: an
  // unusable identity must not fall back to the Bot's default conversation,
  // which would mix two conversations' unsent text.
  assert.equal(threadKeyFromRoster('bot-a:t1', roster, () => 'not a thread id'), '')
  assert.equal(conversationKey({ kind: 'bot', ownerId: 'bot-a', threadId: 'bad id' }), '')
  for (const [sessionId, text] of [['bot-a:root', '默认会话的一段'], ['bot-a:t1', '线程一的一段'], ['bot-a:t2', '线程二的一段']]) {
    const parts = partsOfKey(keyOf(sessionId))
    drafts.see({ ...parts, sessionId })
    drafts.save({ ...parts, sessionId, text, revision: 1 })
  }
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a' }).text, '默认会话的一段')
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a', threadId: 't-1' }).text, '线程一的一段')
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a', threadId: 't-2' }).text, '线程二的一段')
  // A room stays its own conversation, thread or no thread.
  drafts.see({ kind: 'room', ownerId: 'room-x', sessionId: 'room-x' })
  drafts.save({ kind: 'room', ownerId: 'room-x', sessionId: 'room-x', text: '群里的一段', revision: 1 })
  assert.equal(drafts.read({ kind: 'room', ownerId: 'room-x' }).text, '群里的一段')
  assert.equal(drafts.read({ kind: 'room', ownerId: 'room-x', threadId: 't-1' }), null)
})

test('composer drafts: an unanswered send is remembered so the next mount asks', () => {
  const drafts = store()
  served(drafts, 'bot', 'bot-a', 'part-1')
  drafts.save({ kind: 'bot', ownerId: 'bot-a', sessionId: 'part-1', text: '发出去还没回音', revision: 1, pendingAt: 1700000005000 })
  const record = drafts.read({ kind: 'bot', ownerId: 'bot-a' })
  assert.equal(record.pendingAt, 1700000005000)
  // A later save without a pending send clears the mark again.
  drafts.save({ kind: 'bot', ownerId: 'bot-a', sessionId: 'part-1', text: '又打了一句', revision: 2 })
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a' }).pendingAt, 0)
})

test('composer drafts: a part rotation keeps the conversation key and drops nothing', () => {  const roster = { byId: { 'bot-a': { id: 'bot-a' }, 'bot-a:p2': { id: 'bot-a' } }, roomsById: {} }
  assert.equal(ownerKeyFromRoster('bot-a', roster), 'bot:bot-a')
  assert.equal(ownerKeyFromRoster('bot-a:p2', roster), 'bot:bot-a')
  assert.equal(ownerKeyFromRoster('room-x', { byId: {}, roomsById: { 'room-x': { id: 'room-x' } } }), 'room:room-x')
  assert.equal(ownerKeyFromRoster('unknown', { byId: {}, roomsById: {} }), '')
  assert.equal(ownerKeyFromRoster('unknown', undefined), '')
  const drafts = store()
  served(drafts, 'bot', 'bot-a', 'bot-a')
  drafts.save({ kind: 'bot', ownerId: 'bot-a', sessionId: 'bot-a', text: 'carried over', revision: 1 })
  // The fresh part is the same conversation, so its draft is still there.
  served(drafts, 'bot', 'bot-a', 'bot-a:p2')
  const record = drafts.read({ kind: 'bot', ownerId: 'bot-a' })
  assert.equal(record.text, 'carried over')
  assert.equal(drafts.snapshot().directory['bot:bot-a'].sessionId, 'bot-a:p2')
})

test('composer drafts: another Host namespace can neither read nor adopt the blob', () => {
  const storage = fakeStorage()
  const first = createComposerDraftStore({ storage, hostId: HOST, schedule: run => run() })
  first.see({ kind: 'bot', ownerId: 'bot-a', sessionId: 's' })
  first.save({ kind: 'bot', ownerId: 'bot-a', text: 'only mine', revision: 1 })
  const other = createComposerDraftStore({ storage, hostId: 'host-fedcba9876543210', schedule: run => run() })
  assert.equal(other.read({ kind: 'bot', ownerId: 'bot-a' }), null)
  assert.deepEqual(other.save({ kind: 'bot', ownerId: 'bot-a', text: 'not mine', revision: 1 }), { ok: false, reason: 'unknown-conversation' })
  assert.equal(storage.map.get(composerDraftKey(HOST)).includes('only mine'), true)
  // The same Host, reopened, reads its own blob back.
  const again = createComposerDraftStore({ storage, hostId: HOST, schedule: run => run() })
  assert.equal(again.read({ kind: 'bot', ownerId: 'bot-a' }).text, 'only mine')
})

test('composer drafts: a blob rolled back under a live store is not adopted', () => {
  const storage = fakeStorage()
  const drafts = createComposerDraftStore({ storage, hostId: HOST, schedule: run => run() })
  drafts.see({ kind: 'bot', ownerId: 'bot-a', sessionId: 's' })
  drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'first', revision: 1 })
  drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'newest text', revision: 4 })
  const epoch = drafts.snapshot().epoch
  // A backup taken before the last write comes back to the same storage.
  const rolled = JSON.parse(storage.map.get(composerDraftKey(HOST)))
  rolled.epoch = epoch - 1
  rolled.sessions['bot:bot-a'].text = 'older text'
  rolled.sessions['bot:bot-a'].revision = 2
  storage.map.set(composerDraftKey(HOST), JSON.stringify(rolled))
  // The live store keeps what it wrote, and its next write is ahead of the rollback.
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a' }).text, 'newest text')
  drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'after rollback', revision: 5 })
  assert.equal(JSON.parse(storage.map.get(composerDraftKey(HOST))).sessions['bot:bot-a'].text, 'after rollback')
  assert.equal(JSON.parse(storage.map.get(composerDraftKey(HOST))).epoch > epoch, true)
})

test('composer drafts: reconcile keeps only the conversations the Host still lists', () => {
  const drafts = store()
  for (const owner of ['a', 'b', 'c']) {
    served(drafts, 'bot', owner, 's')
    drafts.save({ kind: 'bot', ownerId: owner, text: `text ${owner}`, revision: 1 })
  }
  assert.equal(drafts.reconcile(['bot:a', 'bot:c']), 2)
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'b' }), null)
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'a' }).text, 'text a')
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'c' }).text, 'text c')
  assert.deepEqual(Object.keys(drafts.snapshot().directory).sort(), ['bot:a', 'bot:c'])
})

test('composer drafts: a blocked storage keeps the drafts for this window', () => {
  const drafts = store({ storage: fakeStorage({ failWrites: true }) })
  served(drafts, 'bot', 'bot-a', 's')
  assert.equal(drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'still here', revision: 1 }).ok, true)
  assert.equal(drafts.read({ kind: 'bot', ownerId: 'bot-a' }).text, 'still here')
  // A broken blob reads as empty rather than throwing.
  const storage = fakeStorage()
  storage.map.set(composerDraftKey(HOST), '{not json')
  const broken = createComposerDraftStore({ storage, hostId: HOST, schedule: run => run() })
  broken.see({ kind: 'bot', ownerId: 'bot-a', sessionId: 's' })
  assert.equal(broken.read({ kind: 'bot', ownerId: 'bot-a' }), null)
})

test('composer drafts: a debounced write lands on flush and not before', () => {
  const waiting = []
  const storage = fakeStorage()
  const drafts = createComposerDraftStore({ storage, hostId: HOST, schedule: run => waiting.push(run) })
  drafts.see({ kind: 'bot', ownerId: 'bot-a', sessionId: 's' })
  drafts.save({ kind: 'bot', ownerId: 'bot-a', text: 'typed', revision: 1 })
  // Both changes share one scheduled write, and nothing reached storage yet.
  assert.equal(waiting.length, 1)
  assert.equal(storage.map.has(composerDraftKey(HOST)), false)
  waiting.shift()()
  assert.equal(storage.map.has(composerDraftKey(HOST)), true)
  // Nothing changed since, so a second flush writes nothing new.
  const before = storage.map.get(composerDraftKey(HOST))
  drafts.flush()
  assert.equal(storage.map.get(composerDraftKey(HOST)), before)
  // A reopened store sees the debounced text and schedules its own next write.
  const pending = createComposerDraftStore({ storage, hostId: HOST, schedule: run => waiting.push(run) })
  pending.see({ kind: 'bot', ownerId: 'bot-b', sessionId: 's' })
  assert.equal(waiting.length, 1)
  waiting.shift()()
  assert.equal(JSON.parse(storage.map.get(composerDraftKey(HOST))).directory['bot:bot-b'].sessionId, 's')
})

test('composer drafts: the namespace helper is a fixture helper and never a production path', () => {
  const storage = fakeStorage()
  let seed = 0
  const random = () => (seed += 1).toString(16).padStart(16, '0')
  assert.equal(resolveHostId({ storage, random }), 'host-0000000000000001')
  assert.equal(storage.map.get(COMPOSER_DRAFT_HOST_KEY), 'host-0000000000000001')
  assert.equal(resolveHostId({ storage, random }), 'host-0000000000000001')
  // A namespace that cannot be minted fails loudly instead of colliding.
  assert.throws(() => resolveHostId({ storage: fakeStorage(), random: () => 'short' }), /16 hex characters/)
  // A blocked storage still yields this window's namespace.
  assert.equal(resolveHostId({ storage: fakeStorage({ failWrites: true }), random: () => 'abcdefabcdefabcd' }), 'host-abcdefabcdefabcd')
  // Two Hosts in one origin would mint the same value here, which is exactly why
  // the production namespace comes from the Host's ui.namespace read instead.
  assert.equal(resolveHostId({ storage: fakeStorage(), random: () => 'abcdefabcdefabcd' }), 'host-abcdefabcdefabcd')
  // No time-based clearing exists any more: an unobserved outcome keeps the text.
  assert.equal('confirmDelayMs' in COMPOSER_DRAFT_LIMITS, false)
  assert.equal('clearOnUnknown' in COMPOSER_DRAFT_LIMITS, false)
})

test('composer drafts: a store without a persisted Host namespace refuses to exist', () => {
  assert.throws(() => createComposerDraftStore({ storage: fakeStorage(), hostId: 'nope' }), /persisted Host namespace/)
  assert.throws(() => createComposerDraftStore({ storage: fakeStorage() }), /persisted Host namespace/)
})
