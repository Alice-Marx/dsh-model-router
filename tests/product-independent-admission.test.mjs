import test from 'node:test'
import assert from 'node:assert/strict'
import { bootIndependentHost, seed } from './fixtures/bot-independent-boot.mjs'
import { routeOf } from '../packages/orchestration/src/bot-independent-execution.mjs'

test('a committed namespaced model retains every character after the first separator', () => {
  assert.deepEqual(routeOf('openrouter/anthropic/claude-sonnet'), { provider: 'openrouter', model: 'anthropic/claude-sonnet' })
})

test('the actual Host stream preserves a namespaced committed model in its receipt', async t => {
  const team = seed()
  team.bots.a.model = 'alpha/vendor/one'
  const host = await bootIndependentHost(t, { seed: team, funding: { a: {} } })
  await host.move('a', 'independent')
  host.directory.replaceGrant('a', { tools: ['model/infer'], modelRoutes: [{ provider: 'alpha', model: 'vendor/one' }] })
  await host.turn('a', 'use the exact saved model')
  assert.equal(host.upstream.length, 1)
  assert.equal(host.upstream[0].model, 'vendor/one')
  const [receipt] = await host.money.receipts('a')
  assert.equal(receipt.model, 'vendor/one')
})

test('a revoked Bot cannot append user input before its model is refused', async t => {
  const host = await bootIndependentHost(t, { seed: seed(), funding: { a: {} } })
  await host.move('a', 'independent')
  host.directory.replaceGrant('a', { tools: [], modelRoutes: [] })
  await assert.rejects(() => host.turn('a', 'revoked input must not be stored'))
  assert.deepEqual(host.upstream, [])
  assert.deepEqual(host.transcript('a'), [], 'admission must precede user transcript persistence')
})

test('a model context cannot switch an active non-owner Bot to another Bot', async t => {
  const host = await bootIndependentHost(t, { seed: seed(), funding: { a: {}, b: {} } })
  const first = host.directory.forBot('a'), second = host.directory.forBot('b')
  assert.throws(() => host.policy.modelContext(first, undefined, () =>
    host.policy.modelContext(second, undefined, () => 'borrowed context', { botId: 'b' }), { botId: 'a' }),
  error => error.code === 'SUBJECT_MISMATCH')
})

test('nested model context retains the active financial binding of the same subject', async t => {
  const host = await bootIndependentHost(t, { seed: seed(), funding: { a: {} } })
  const subject = host.directory.forBot('a')
  host.policy.modelContext(subject, undefined, () => {
    host.policy.bindFinancialRun({ active: () => true, packageId: () => 'p', runId: 'existing-run' })
    host.policy.modelContext(subject, undefined, () => {
      assert.equal(host.policy.financialRunActive(), true)
      assert.equal(host.policy.financialRun().runId, 'existing-run')
    }, { botId: 'a' })
  }, { botId: 'a' })
})

test('nested model context retains the same subject parent cancellation', async t => {
  const host = await bootIndependentHost(t, { seed: seed(), funding: { a: {} } })
  await host.move('a', 'independent')
  const subject = host.directory.forBot('a'), controller = new AbortController()
  await assert.rejects(() => host.policy.modelContext(subject, controller.signal, async () => {
    controller.abort(new Error('PARENT_TURN_CANCELLED'))
    await host.policy.modelContext(subject, undefined, async () => {
      for await (const _chunk of host.rawStream({ provider: 'alpha', model: 'one', messages: [] })) { /* must never enter */ }
    }, { botId: 'a' })
  }, { botId: 'a' }), /PARENT_TURN_CANCELLED/)
  assert.deepEqual(host.upstream, [], 'cancelling the parent must prevent nested dispatch')
})

test('the independent facade rejects extra model configuration before dispatch', async t => {
  const host = await bootIndependentHost(t, { seed: seed(), funding: { a: {} } })
  await host.move('a', 'independent')
  const execution = host.ctx.get('botIndependentExecution')
  await assert.rejects(() => execution.complete({
    botId: 'a', provider: 'alpha', model: 'one', messages: [],
    providerConfig: { endpoint: 'https://invalid.example.test/should-not-forward' },
  }), error => error.code === 'INDEPENDENT_REQUEST_UNKNOWN_FIELD')
  assert.deepEqual(host.upstream, [])
})
