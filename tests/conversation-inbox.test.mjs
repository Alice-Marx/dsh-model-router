import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationInbox } from '../apps/integration-client/conversation-inbox.mjs'

const roster = {
  ready: true,
  bots: [
    { id: 'bot', sessionId: 'current', name: 'Research', threads: [
      { sessionId: 'thread', name: 'Experiment' },
      { sessionId: 'archived', name: 'Archived', archivedAt: 123 },
    ] },
    { id: 'hidden', name: 'Hidden', hidden: true },
  ],
  rooms: [{ id: 'room', sessionId: 'room-current', name: 'Team' }],
  questions: { current: { question: 'private text' }, 'deleted-session': {} },
}

test('combines committed approvals and native session signals by visible conversation', () => {
  const work = { approvals: [
    { roomId: 'room', botId: 'bot', sessionId: 'hidden-member', reason: 'private command' },
    { roomId: 'room', botId: 'bot', sessionId: 'another-member' },
    { sessionId: 'thread' },
    { sessionId: 'deleted-session' },
  ] }
  const status = new Map([
    ['thread', { pendingInteraction: { kind: 'approval' }, completionUnread: true }],
    ['room-current', { pendingInteraction: { kind: 'question' } }],
    ['archived', { completionUnread: true }],
    ['hidden', { completionUnread: true }],
  ])
  const inbox = conversationInbox(roster, work, { bot: true, hidden: true }, status)
  assert.equal(inbox.known, true)
  assert.deepEqual(inbox.rows.map(row => [row.id, row.sessionId, row.stages]), [
    ['thread', 'thread', ['approve', 'unread']],
    ['room', 'room-current', ['approve', 'question']],
    ['bot', 'current', ['question', 'unread']],
  ])
  assert.doesNotMatch(JSON.stringify(inbox), /private text|private command|hidden-member/)
})

test('an active conversation clears its unread contribution but keeps pending interaction', () => {
  const sessions = { byId: { current: { retainedBy: { mainView: 1 } } } }
  const status = new Map([['current', { completionUnread: true }]])
  assert.deepEqual(conversationInbox(roster, null, { bot: true }, status, sessions).rows.map(row => row.stages), [['question']])
  assert.deepEqual(conversationInbox({ ...roster, ready: false }), { known: false, rows: [] })
})

test('native plan reviews appear among approvals while unrelated interactions stay out', () => {
  const status = new Map([
    ['thread', { pendingInteraction: { kind: 'plan-review' } }],
    ['room-current', { pendingInteraction: { kind: 'secret' } }],
  ])
  assert.deepEqual(conversationInbox({ ...roster, questions: {} }, null, {}, status).rows.map(row => [row.id, row.stages]), [
    ['thread', ['approve']],
  ])
})
