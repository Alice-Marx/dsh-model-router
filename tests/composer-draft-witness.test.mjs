import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SUBMISSION_MATCH_WINDOW_MS,
  matchSubmission,
  newQueueRows,
  observedRequestIds,
  queuedUserRows,
  readSendOutcome,
  sendFailed,
} from '../apps/integration-client/composer-draft-witness.mjs'

// Shapes taken from the installed session contract, not invented:
//   snapshot.pendingSubmissions: [{ requestId, placement, time, text, attachments }]
//   a durable user message echoes its prompt identity as source.rpcId
//   snapshot.promptError: { op: 'send' | 'stop', error }
const echo = (requestId, text, time) => ({ requestId, placement: 'transcript', time, text, attachments: [] })
const userMessage = rpcId => ({ type: 'user/message', data: { source: { kind: 'user', rpcId } } })
const botReply = () => ({ kind: 'assistant-step', source: { kind: 'assistant' } })

test('composer drafts: the echo of this send is found by its own identity', () => {
  const submissions = [echo('rpc-1', '昨天的一句', 1000), echo('rpc-2', '今天的一句', 5000)]
  const found = matchSubmission(submissions, { text: '今天的一句', at: 5000 })
  assert.deepEqual(found, { requestId: 'rpc-2', text: '今天的一句', time: 5000 })
  // The same text sent earlier is a different send, and the earlier echo is not
  // mistaken for this one.
  const again = matchSubmission(submissions, { text: '今天的一句', at: 5000 + SUBMISSION_MATCH_WINDOW_MS + 1 })
  assert.equal(again, null)
  // No echo at all: a history message with the same text proves nothing.
  assert.equal(matchSubmission([], { text: '今天的一句', at: 5000 }), null)
  assert.equal(matchSubmission(undefined, { text: '今天的一句', at: 5000 }), null)
  assert.equal(matchSubmission([echo('rpc-3', '别的', 5000)], { text: '今天的一句', at: 5000 }), null)
  // An echo without an identity cannot be correlated, so it is not a match.
  assert.equal(matchSubmission([{ text: '今天的一句', time: 5000 }], { text: '今天的一句', at: 5000 }), null)
})

test('composer drafts: acceptance is the requestId in a durable user message', () => {
  const events = [botReply(), userMessage('rpc-9')]
  assert.deepEqual([...observedRequestIds(events)], ['rpc-9'])
  // A Bot reply carries no rpcId, so it can never stand in for the send.
  assert.equal(observedRequestIds([botReply()]).size, 0)
  assert.equal(observedRequestIds(undefined).size, 0)

  const pending = { requestId: 'rpc-9', text: '这一句', at: 10 }
  assert.equal(readSendOutcome({ pending, events }), 'accepted')
  // The same text as a historical message does not match a different identity.
  assert.equal(readSendOutcome({ pending: { requestId: 'rpc-1' }, events }), undefined)
  // Nothing observed yet: unknown, which keeps the draft.
  assert.equal(readSendOutcome({ pending, events: [botReply()] }), undefined)
  assert.equal(readSendOutcome({ pending }), undefined)
  assert.equal(readSendOutcome({}), undefined)
})

test('composer drafts: a published send failure is a failure, and nothing else is', () => {
  const pending = { requestId: 'rpc-4', text: '没发出去的一句', at: 10 }
  assert.equal(sendFailed({ op: 'send', error: { code: 'offline' } }), true)
  assert.equal(sendFailed({ op: 'stop', error: {} }), false)
  assert.equal(sendFailed(null), false)
  assert.equal(readSendOutcome({ pending, promptError: { op: 'send', error: {} } }), undefined)
  assert.equal(readSendOutcome({ pending, failedRequestIds: ['rpc-4'] }), 'failed')
  // An acceptance observed next to a stale error still wins: the durable message
  // for this identity is the stronger evidence.
  assert.equal(readSendOutcome({ pending, events: [userMessage('rpc-4')], promptError: { op: 'send', error: {} } }), 'accepted')
  // A stop failure is not a send failure.
  assert.equal(readSendOutcome({ pending, promptError: { op: 'stop', error: {} } }), undefined)
})

test('composer drafts: old or ambiguous equal-text echoes cannot identify a new send', () => {
  const submissions = [echo('old', '相同内容', 5000), echo('new', '相同内容', 5001)]
  assert.equal(matchSubmission(submissions, { text: '相同内容', at: 5001 }), null)
  assert.equal(matchSubmission(submissions, { text: '相同内容', at: 5001, before: ['old'] }).requestId, 'new')
  assert.equal(matchSubmission([submissions[0]], { text: '相同内容', at: 5001, before: ['old'] }), null)
  assert.equal(readSendOutcome({ pending: { requestId: 'new' }, events: [userMessage('old')] }), undefined)
  assert.equal(observedRequestIds([
    { type: 'assistant/message', data: { source: { kind: 'user', rpcId: 'new' } } },
    { type: 'user/message', data: { source: { kind: 'bot', rpcId: 'new' } } },
    { kind: 'user/message', source: { kind: 'user', rpcId: 'new' } },
  ]).size, 0)
})

test('composer drafts: a new queue row only marks a send in flight, never acceptance', () => {
  assert.deepEqual(queuedUserRows([{ id: 'm1', source: { kind: 'user' } }, { id: 'm2', source: { kind: 'bot' } }]).map(row => row.id), ['m1'])
  assert.deepEqual(queuedUserRows(undefined), [])
  assert.deepEqual(newQueueRows(['m2'], ['m1']), ['m2'])
  assert.deepEqual(newQueueRows(['m1'], ['m1']), [])
  assert.deepEqual(newQueueRows([], ['m1']), [])
  assert.deepEqual(newQueueRows(undefined, undefined), [])
})
