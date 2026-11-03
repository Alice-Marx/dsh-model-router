import test from 'node:test'
import assert from 'node:assert/strict'
import { needsBotPolicy } from '../modules/bot-runtime/policy-scope.mjs'

test('bot policy: only Bot sessions and admitted frames are policed', () => {
  const bots = new Set(['session-bot', 'room-1'])
  const isBotSession = id => bots.has(id)
  // A plain Harness session must pass through: it has no committed Bot grant, and demanding one
  // refused the user's own chat with UNKNOWN_SUBJECT.
  assert.equal(needsBotPolicy({ admitted: false, isBotSession, sessionId: 'session-user' }), false)
  assert.equal(needsBotPolicy({ admitted: false, isBotSession, sessionId: undefined }), false)
  // A Bot chat and a group Session are the product's own work.
  assert.equal(needsBotPolicy({ admitted: false, isBotSession, sessionId: 'session-bot' }), true)
  assert.equal(needsBotPolicy({ admitted: false, isBotSession, sessionId: 'room-1' }), true)
  // An admitted MR frame stays policed even when it carries no Session of its own.
  assert.equal(needsBotPolicy({ admitted: true, isBotSession, sessionId: undefined }), true)
  // A runtime without the helper cannot claim a session, so the call is not policed by accident.
  assert.equal(needsBotPolicy({ admitted: false, isBotSession: undefined, sessionId: 'session-bot' }), false)
})
