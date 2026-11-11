import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { openBotSessionStore } from '../packages/orchestration/src/bot-session-store.mjs'
import { createIndependentConversationReader } from '../packages/orchestration/src/independent-chat-page.mjs'

const setup = () => {
  const root = resolve('tmp/integration/independent-chat-pages')
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, 'case-')), sessions = join(dir, 'sessions')
  return { dir, sessions, store: openBotSessionStore({ dir: sessions }), read: createIndependentConversationReader({ dir }) }
}

test('a page cursor keeps its exact message boundary when new messages arrive', () => {
  const { store, read } = setup()
  store.append('a', Array.from({ length: 12 }, (_, n) => ({ role: 'user', content: `message ${n}` })))
  const latest = read('a', { limit: 3 })
  assert.deepEqual(latest.items.map(row => row.content), ['message 9', 'message 10', 'message 11'])
  store.append('a', [{ role: 'assistant', content: 'new answer' }])
  const earlier = read('a', { cursor: latest.nextCursor, limit: 3 })
  assert.deepEqual(earlier.items.map(row => row.content), ['message 6', 'message 7', 'message 8'])
  assert.notEqual(latest.snapshotId, read('a', { limit: 3 }).snapshotId)
})

test('legacy message ids are stable across reading and the next persisted append', () => {
  const { dir, sessions, store, read } = setup()
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(sessions, 'a.json'), JSON.stringify({ schemaVersion: 1, botId: 'a', createdAt: 1, updatedAt: 1, turns: 1,
    messages: [{ role: 'user', content: 'old', at: 1 }, { role: 'assistant', content: 'old answer', at: 1 }] }))
  const first = read('a')
  assert.deepEqual(read('a').items, first.items)
  store.append('a', [{ role: 'user', content: 'new' }])
  assert.deepEqual(createIndependentConversationReader({ dir })('a').items.slice(0, 2), first.items)
})

test('a trimmed or foreign cursor is refused instead of opening another message', () => {
  const { dir, sessions, read } = setup(), store = openBotSessionStore({ dir: sessions, maxMessages: 10 })
  store.append('a', Array.from({ length: 10 }, (_, n) => ({ role: 'user', content: `old ${n}` })))
  const cursor = read('a').items[0].messageId
  store.append('a', [{ role: 'user', content: 'trim first' }])
  assert.throws(() => read('a', { cursor }), { code: 'INDEPENDENT_CHAT_CURSOR_EXPIRED' })
  assert.throws(() => createIndependentConversationReader({ dir })('b', { cursor }), { code: 'INDEPENDENT_CHAT_CURSOR_EXPIRED' })
})

test('page output has a byte budget and never silently truncates a message', () => {
  const { dir, store } = setup()
  store.append('a', [{ role: 'user', content: '字'.repeat(100) }, { role: 'assistant', content: 'small' }])
  const read = createIndependentConversationReader({ dir, maxBytes: 256 })
  const first = read('a')
  assert.deepEqual(first.items.map(row => row.content), ['small'])
  assert.ok(first.nextCursor)
  assert.throws(() => read('a', { cursor: first.nextCursor }), { code: 'INDEPENDENT_CHAT_MESSAGE_TOO_LARGE' })
})
