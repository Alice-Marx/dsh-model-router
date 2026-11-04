import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_HANDOFF_DEPTH, assertHandoffAllowed, buildHandoff, createHandoffLedger } from '../packages/orchestration/src/bot-handoff.mjs'

const code = expected => error => { assert.equal(error.code, expected, error.message); return true }

test('handoff: a Bot cannot hand work to itself', () => {
  const ledger = createHandoffLedger()
  assert.throws(() => assertHandoffAllowed({ taskId: 't', fromBotId: 'a', toBotId: 'a', ledger }), code('HANDOFF_SELF'))
})

test('handoff: passing a task back to a Bot that already held it is a cycle', () => {
  const ledger = createHandoffLedger()
  ledger.held('t', 'a')
  ledger.held('t', 'b')
  assert.throws(() => assertHandoffAllowed({ taskId: 't', fromBotId: 'b', toBotId: 'a', ledger }), code('HANDOFF_CYCLE'))
  const fresh = assertHandoffAllowed({ taskId: 't', fromBotId: 'b', toBotId: 'c', ledger })
  assert.deepEqual(fresh.chain, ['a', 'b', 'c'])
})

test('handoff: a chain cannot be built past the depth limit', () => {
  const ledger = createHandoffLedger()
  ledger.held('t', 'a')
  ledger.held('t', 'b')
  ledger.held('t', 'c')
  assert.throws(() => assertHandoffAllowed({ taskId: 't', fromBotId: 'c', toBotId: 'd', ledger }), code('HANDOFF_TOO_DEEP'))
  assert.equal(MAX_HANDOFF_DEPTH, 3)
})

test('handoff: recording a holder twice in a row does not grow the chain', () => {
  const ledger = createHandoffLedger()
  ledger.held('t', 'a')
  ledger.held('t', 'a')
  assert.deepEqual(ledger.chainOf('t'), ['a'])
  ledger.forget('t')
  assert.deepEqual(ledger.chainOf('t'), [])
  assert.equal(ledger.size, 0)
})

test('handoff: a bad id or task is refused before the ledger is consulted', () => {
  const ledger = createHandoffLedger()
  assert.throws(() => assertHandoffAllowed({ taskId: '', fromBotId: 'a', toBotId: 'b', ledger }), code('HANDOFF_TASK_INVALID'))
  assert.throws(() => assertHandoffAllowed({ taskId: 't', fromBotId: '../x', toBotId: 'b', ledger }), code('HANDOFF_BOT_INVALID'))
  assert.throws(() => assertHandoffAllowed({ taskId: 't', fromBotId: 'a', toBotId: 'b', ledger, maxDepth: 0 }), code('HANDOFF_DEPTH_INVALID'))
})

test('handoff: the package names the sender as origin and keeps the wording', () => {
  const { plan } = buildHandoff({ taskId: 't-1', fromBotId: 'chief', toBotId: 'writer', objective: '  写周报  ' })
  assert.equal(plan.origin.kind, 'handoff')
  assert.equal(plan.origin.botId, 'chief')
  assert.equal(plan.packages[0].targetBotId, 'writer')
  assert.equal(plan.packages[0].objective, '写周报')
  assert.throws(() => buildHandoff({ taskId: 't', fromBotId: 'a', toBotId: 'b', objective: '  ' }), code('HANDOFF_OBJECTIVE_INVALID'))
})
