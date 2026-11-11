import test from 'node:test'
import assert from 'node:assert/strict'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'

test('real composition owner binding admits two Bot models and settles one funded receipt per call', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await bind('b', 'beta', 'vendor/two')
    await runtime.move('a', 'independent')
    await runtime.move('b', 'independent')
    assert.equal((await runtime.turn({ botId: 'a', input: 'first funded turn' })).answer, 'model answer')
    assert.equal((await runtime.turn({ botId: 'b', input: 'second funded turn' })).answer, 'model answer')
    const receipts = readRows('router_model_calls')
    assert.deepEqual(receipts.map(row => [row.botId, row.provider, row.model, row.source, row.state, row.outcome]), [
      ['a', 'alpha', 'one', 'bot', 'settled', 'succeeded'], ['b', 'beta', 'vendor/two', 'bot', 'settled', 'succeeded'],
    ])
    const runs = readRows('router_runs')
    assert.equal(runs.length, 2)
    for (const run of runs) {
      assert.equal(run.status, 'completed')
      assert.ok(Math.abs(run.packages[0].costUsd - 0.000025) < 1e-12)
    }
    assert.deepEqual(ctx.upstream.map(row => `${row.provider}/${row.model}`), ['alpha/one', 'beta/vendor/two'])
  })
})

test('production construction before composition readiness can use the later published execution service', async () => {
  await withProductIndependent(async ({ runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    assert.equal((await runtime.turn({ botId: 'a', input: 'after startup' })).answer, 'model answer')
    assert.equal(readRows('router_model_calls').length, 1)
  }, { beforeBoot: async ({ ctx }) => { assert.equal(ctx.get('botIndependentExecution'), undefined) } })
})

test('the real secrets rewrite reaches the SDK adapter once and records one receipt', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const fixtureValue = 'offline-fixture-value-never-a-real-credential-19281'
    await product.rt.secretEndpoint('secret-set', { name: 'FIXTURE_REDACTION', value: fixtureValue, scope: ['a'] })
    await runtime.turn({ botId: 'a', input: `Please redact ${fixtureValue} before sending` })
    assert.equal(ctx.upstream.length, 1)
    const sent = JSON.stringify(ctx.upstream[0].messages)
    assert.equal(sent.includes(fixtureValue), false)
    assert.match(sent, /\[secret:FIXTURE_REDACTION\]/)
    assert.equal(readRows('router_model_calls').length, 1)
    assert.equal(readRows('router_runs').length, 1)
  }, { nativeLlm: true })
})

test('two identical logical requests remain two receipts after the secrets rewrite', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const fixtureValue = 'offline-repeat-fixture-value-not-a-credential-19282'
    await product.rt.secretEndpoint('secret-set', { name: 'FIXTURE_REPEAT', value: fixtureValue, scope: ['a'] })
    const execution = ctx.get('botIndependentExecution')
    const request = () => ({ botId: 'a', provider: 'alpha', model: 'one', messages: [{ role: 'user', content: [{ type: 'text', text: fixtureValue }] }] })
    await execution.complete(request())
    await execution.complete(request())
    const rows = readRows('router_model_calls')
    assert.equal(ctx.upstream.length, 2)
    assert.equal(rows.length, 2)
    assert.notEqual(rows[0].id, rows[1].id)
    assert.notEqual(rows[0].runId, rows[1].runId)
    assert.equal(JSON.stringify(ctx.upstream).includes(fixtureValue), false)
  }, { nativeLlm: true })
})
