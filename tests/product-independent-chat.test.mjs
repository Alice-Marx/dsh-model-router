import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { createIndependentChatService } from '../packages/orchestration/src/independent-chat-service.mjs'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const owner = { kind: 'owner' }
const request = (suffix = 'one', input = 'hello') => ({ botId: 'a', requestKey: `request-key-${suffix}-123456`, input })
const identity = value => ({ botId: value.botId, requestKey: value.requestKey })
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fixture(t, options = {}) {
  const root = resolve('tmp/integration/independent-chat')
  mkdirSync(root, { recursive: true })
  const file = join(mkdtempSync(join(root, 'case-')), 'state.sqlite')
  const calls = [], finish = gate()
  const runtime = { modeOf: () => 'independent', busyBots: () => [], turn: async value => { calls.push(value); return finish.promise } }
  const settings = { Database, file, lifecycle: { committedBot: botId => botId === 'a' || botId === 'b' ? { id: botId } : null }, runtime: () => runtime, ...options }
  const service = createIndependentChatService(settings)
  t.after(() => service.close())
  return { service, settings, runtime, calls, finish }
}

test('a retry returns its durable owner request and never sends another model turn', async t => {
  const f = fixture(t), input = request()
  const accepted = f.service.send(input, owner)
  assert.equal(accepted.state, 'accepted')
  assert.equal(accepted.durableInput, true, 'the input is committed before acceptance is returned')
  assert.equal(f.service.send(input, owner).state, 'accepted')
  await Promise.resolve()
  assert.equal(f.calls.length, 1)
  assert.throws(() => f.service.send({ ...input, input: 'different body' }, owner), { code: 'INDEPENDENT_CHAT_REQUEST_CONFLICT' })
  f.finish.resolve({ answer: 'done', steps: 1, toolCalls: [], turns: 1 })
  await f.service.whenIdle()
  const final = f.service.send(input, owner)
  assert.equal(final.state, 'succeeded')
  assert.equal(final.result.answerPreview, 'done')
  assert.equal(f.calls.length, 1)
})

test('a different request for a busy Bot is refused while another Bot remains independent', async t => {
  const f = fixture(t)
  f.service.send(request('first'), owner)
  assert.throws(() => f.service.send(request('second'), owner), { code: 'INDEPENDENT_CHAT_PENDING_RECONCILIATION' })
  f.service.send({ ...request('other-bot'), botId: 'b' }, owner)
  await Promise.resolve()
  assert.deepEqual(f.calls.map(row => row.botId), ['a', 'b'])
  f.finish.resolve({ answer: 'ok' })
  await f.service.whenIdle()
})

test('close and reopen retain unknown outcomes and never replay the old request', async t => {
  const f = fixture(t), input = request('unknown')
  f.service.send(input, owner)
  await Promise.resolve()
  f.service.close()
  assert.equal(f.calls[0].signal.aborted, true)
  const reopened = createIndependentChatService(f.settings)
  t.after(() => reopened.close())
  const uncertain = reopened.send(input, owner)
  assert.equal(uncertain.state, 'unknown')
  assert.equal(uncertain.recoveryInput, input.input, 'interrupted delivery retains the exact input for explicit recovery')
  f.finish.resolve({ answer: 'late answer' })
  await f.service.whenIdle()
  assert.equal(reopened.inspect(identity(input), owner).state, 'unknown', 'a retired callback cannot publish a late success')
  assert.equal(f.calls.length, 1)
})

test('cancel is a request and does not replace a later committed answer with a false stop', async t => {
  const f = fixture(t), input = request('cancel')
  f.service.send(input, owner)
  await Promise.resolve()
  const stopping = f.service.cancel(identity(input), owner)
  assert.equal(stopping.cancelRequested, true)
  assert.equal(stopping.finished, false)
  assert.equal(stopping.stopConfirmed, false)
  assert.equal(f.calls[0].signal.aborted, true)
  f.finish.resolve({ answer: 'already committed near the cancel request' })
  await f.service.whenIdle()
  const final = f.service.inspect(identity(input), owner)
  assert.equal(final.state, 'succeeded')
  assert.equal(final.cancelRequested, true)
  assert.equal(final.stopConfirmed, false)
})

test('owner admission, committed mode and bounded input precede every new dispatch', async t => {
  const f = fixture(t), input = request('owner')
  assert.throws(() => f.service.send(input, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  assert.throws(() => f.service.send({ ...input, botId: 'missing' }, owner), { code: 'BOT_NOT_COMMITTED' })
  f.runtime.modeOf = () => 'integration'
  assert.throws(() => f.service.send(input, owner), { code: 'RUNTIME_MODE_MISMATCH' })
  f.runtime.modeOf = () => 'independent'
  assert.throws(() => f.service.send({ ...input, input: '字'.repeat(22_000) }, owner), { code: 'INDEPENDENT_CHAT_INPUT_LIMIT' })
  assert.deepEqual(f.calls, [])
})

test('another live owner cannot steal or restart a pending request', async t => {
  const f = fixture(t), input = request('live-owner')
  f.service.send(input, owner)
  await Promise.resolve()
  const other = createIndependentChatService({ ...f.settings, isProcessAlive: () => true })
  t.after(() => other.close())
  const inspected = other.send(input, owner)
  assert.equal(inspected.state, 'unknown')
  assert.equal(inspected.pending, true)
  assert.throws(() => other.send(request('new-owner-request'), owner), { code: 'INDEPENDENT_CHAT_PENDING_RECONCILIATION' })
  assert.equal(f.calls.length, 1)
  f.finish.resolve({ answer: 'original result' })
  await f.service.whenIdle()
  assert.equal(other.inspect(identity(input), owner).state, 'succeeded')
})

test('the real composition SDK and SQLite receive one call for an owner transport retry', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, storageFile, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const service = createIndependentChatService({ Database, file: storageFile, lifecycle: product.lifecycle, runtime: () => runtime })
    try {
      const input = request('sdk')
      service.send(input, owner)
      service.send(input, owner)
      await service.whenIdle()
      assert.equal(service.inspect(identity(input), owner).state, 'succeeded')
      assert.equal(service.send(input, owner).state, 'succeeded')
      assert.equal(ctx.upstream.length, 1)
      assert.equal(readRows('router_model_calls').length, 1)
    } finally { service.close() }
  }, { nativeLlm: true })
})
