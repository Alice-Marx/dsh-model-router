import test from 'node:test'
import assert from 'node:assert/strict'
import { teamReceiptFromEvents, createIntegratedTeamBridge } from '../packages/orchestration/src/team-bridge.mjs'

// Pure folding cases. Actual SDK event-envelope/Agent execution is covered by
// product-team-runtime.test.mjs, with an installed public AgentLoop and storage.
const turn = (number, request, text = 'answer', reason = { kind: 'completed' }) => [
  { type: 'turn/start', data: { turn: number } },
  { type: 'user/message', data: { source: { kind: 'bot', role: 'assign-task', exchangeId: request } } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } },
  { type: 'turn/end', data: { turn: number, reason } },
]
test('exact request is correlated to its own turn, never the latest assignment', () => {
  const events = [...turn(1, 'old', 'old answer'), ...turn(2, 'new', 'new answer')]
  assert.equal(teamReceiptFromEvents(events, 'old').text, 'old answer')
  assert.equal(teamReceiptFromEvents(events, 'new').text, 'new answer')
  assert.equal(teamReceiptFromEvents(events, 'missing').outcome, 'unknown')
})
test('an interrupted old request cannot borrow a later success; duplicate identified inputs are unknown', () => {
  const events = [...turn(1, 'old').slice(0, 2), ...turn(2, 'new')]
  assert.equal(teamReceiptFromEvents(events, 'old').outcome, 'unknown')
  assert.equal(teamReceiptFromEvents([...turn(1, 'same'), ...turn(2, 'same')], 'same').code, 'TEAM_TARGET_DUPLICATE_REQUEST')
})
test('Host snapshots are context; another interactive input makes a result ambiguous', () => {
  const events = turn(1, 'request')
  events.splice(2, 0, { type: 'user/message', data: { source: { kind: 'ds-bot-time-context', form: 'snapshot' } } })
  assert.equal(teamReceiptFromEvents(events, 'request').outcome, 'succeeded')
  events.splice(3, 0, { type: 'user/message', data: { source: { kind: 'user' } } })
  assert.equal(teamReceiptFromEvents(events, 'request').code, 'TEAM_TARGET_MIXED_INPUT')
})
test('cancellation is confirmed only by the exact turn closer', () => {
  assert.equal(teamReceiptFromEvents(turn(1, 'request', '', { kind: 'aborted', reason: { kind: 'user' } }), 'request').outcome, 'cancelled')
  assert.equal(teamReceiptFromEvents(turn(1, 'request').slice(0, -1), 'request').outcome, 'unknown')
})
test('integrated origin checks the live thread catalog as well as committed ownership', () => {
  let open = true
  const bridge = createIntegratedTeamBridge({ rt: {}, directory: {}, authority: {}, lifecycle: { committedBot: () => ({ id: 'bot', sessionId: 'default', threads: [{ sessionId: 'thread-session', threadId: 'thread' }] }) }, flush: async () => true, threadHost: () => ({ service: { threadBySession: () => ({ botId: 'bot', threadId: 'thread' }), probeSendable: () => ({ ok: open, sessionId: 'thread-session' }) } }) })
  assert.equal(bridge.originCurrent('bot', { mode: 'integration', sessionId: 'thread-session' }), true)
  open = false
  assert.equal(bridge.originCurrent('bot', { mode: 'integration', sessionId: 'thread-session' }), false)
})

test('only a cancellation path has a deadline; unconfirmed SDK idleness retains an execution fence', async () => {
  const controller = new AbortController()
  let cancels = 0
  // A deliberately nonconverging driver stub tests the bounded-wait branch;
  // actual SDK normal turn lifetime is verified by product-team-runtime.
  const agent = { status: 'idle', session: { id: 'worker' }, followup() { this.status = 'running'; queueMicrotask(() => controller.abort()) }, cancel() { cancels++ }, whenIdle: () => new Promise(() => {}) }
  const bridge = createIntegratedTeamBridge({ rt: { load: async () => {}, resolveAgent: async () => agent, eventsBackwards: async function* () {} }, directory: { forAgent: () => ({}) }, authority: { describe: () => ({ botId: 'worker' }) }, lifecycle: { committedBot: () => ({ id: 'worker' }) }, flush: async () => true, cancelWaitMs: 10 })
  const receipt = await bridge.dispatchTarget({ parentBot: 'main', targetBot: 'worker', targetRef: { sessionId: 'worker' }, requestId: 'request', brief: 'work', mode: 'work', signal: controller.signal })
  assert.equal(receipt.outcome, 'unknown')
  assert.equal(receipt.executionFinished, false)
  assert.ok(cancels >= 1)
})
