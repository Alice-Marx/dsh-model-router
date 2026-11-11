import test from 'node:test'
import assert from 'node:assert/strict'
import { createComposerDraftBinding } from '../apps/integration-client/composer-draft-binding.mjs'
import { threadKeyFromRoster } from '../apps/integration-client/composer-draft.mjs'

const source = value => {
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const fn of [...listeners]) fn() }, count: () => listeners.size }
}
function fixture() {
  const session = source({ pendingSubmissions: [] }), eventSource = source({ entries: [] }), inbox = source(undefined)
  session.projections = { faceOf: key => { assert.equal(key, 'inbox'); return inbox } }
  return { session, eventSource, inbox, control: createComposerDraftBinding({ session, eventSource }) }
}
const event = id => ({ type: 'event', event: { type: 'user/message', data: { source: { kind: 'user', rpcId: id } } } })

test('draft binding retains synchronous echoes and confirms only exact public admission evidence', () => {
  const f = fixture(), off = f.control.subscribe(() => {})
  f.session.set({ pendingSubmissions: [{ requestId: 'old', text: '一样', time: 1 }] })
  f.eventSource.set({ entries: [event('old')] })
  f.session.set({ pendingSubmissions: [] })
  f.session.set({ pendingSubmissions: [{ requestId: 'new', text: '一样', time: 2 }], promptError: { op: 'send' } })
  f.session.set({ pendingSubmissions: [], promptError: { op: 'send' } })
  assert.equal(f.control.getSnapshot().pendingSubmissions.length, 2, 'fast retirement before a React render keeps the new identity')
  assert.equal(f.control.outcome({ requestId: 'old' }), 'accepted')
  assert.equal(f.control.outcome({ requestId: 'new' }), undefined, 'old acceptance and an uncorrelated error cannot clear the new send')
  f.eventSource.set({ entries: [event('old'), event('new')] })
  assert.equal(f.control.outcome({ requestId: 'new' }), 'accepted')
  off()
  assert.deepEqual([f.session.count(), f.eventSource.count(), f.inbox.count()], [0, 0, 0])
})

test('draft binding accepts the exact inbox identity and rejects unrelated event shapes', () => {
  const f = fixture(), off = f.control.subscribe(() => {})
  f.eventSource.set({ entries: [{ type: 'transient', event: event('x').event },
    { type: 'event', event: { type: 'assistant/message', data: { source: { kind: 'user', rpcId: 'x' } } } }] })
  assert.equal(f.control.outcome({ requestId: 'x' }), undefined)
  f.inbox.set({ 'next-turn': [{ source: { kind: 'user', rpcId: 'x' } }], 'next-step': [] })
  assert.equal(f.control.outcome({ requestId: 'x' }), 'accepted')
  off()
  const second = f.control.subscribe(() => {})
  assert.equal(f.session.count(), 1, 'StrictMode resubscription still observes the face')
  second()
})

test('draft binding requires the public faces and thread keys come from the Host roster', () => {
  assert.equal(createComposerDraftBinding({ session: {} }), null)
  const roster = { byId: { 'session-a': { id: 'bot-a' } }, threadsById: { 'session-a': { botId: 'bot-a', threadId: 'thread-1' } } }
  assert.equal(threadKeyFromRoster('session-a', roster), 'bot:bot-a:thread:thread-1')
  assert.equal(threadKeyFromRoster('unknown', roster), '')
})
