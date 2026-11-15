import test from 'node:test'
import assert from 'node:assert/strict'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { subscriptionFixture } from './helpers/subscription-proxy-fixture.mjs'

test('OAuth subscription routes serve actual integrated and independent Bots, enforce call quota and settle a separate subscription ledger', async () => {
  const gateway = await subscriptionFixture(); gateway.addAccount(); let actual
  try {
    await withProductIndependent(async ({ ctx, product, bind, dispatch, runtime, readRows }) => {
      const readModel = ctx.get('botProductReadModel')
      await assert.rejects(readModel.dispatch({ action: 'subscriptions.list', payload: {} }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
      const account = (await dispatch('subscriptions.refresh', {})).accounts[0], model = account.models[0].id
      const initial = await dispatch('binding.inspect', { botId: 'a' })
      const offered = initial.record.catalog.models.find(item => item.provider === account.provider && item.model === model)
      assert.deepEqual(offered.fundingModes, ['subscription']); assert.equal(offered.source, 'plugin')
      assert.ok(initial.record.catalog.fundingScopes.filter(item => item.models.some(m => m.provider === account.provider)).every(item => item.modes.length === 1 && item.modes[0] === 'subscription'))
      await bind('a', account.provider, model)
      let binding = await dispatch('binding.inspect', { botId: 'a' })
      await dispatch('binding.save', { botId: 'a', expectedRevision: binding.record.revision, settings: { ...binding.record.settings, funding: { ...binding.record.settings.funding, subscription: { dailyCalls: 1, monthlyCalls: 10 } } } })
      const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: account.provider, model }, setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
      try {
        handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'Use the subscription account.' }], source: { kind: 'user' } }), 'next-turn', true)
        await handle.agent.whenIdle()
        assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant' && message.content.some(block => block.text === 'SUBSCRIPTION-OK')))
        assert.equal(handle.agent.session.requestHeader().config.maxTokens, 64)
        assert.equal(gateway.requests.length, 1)
        handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'This must wait for a new quota.' }], source: { kind: 'user' } }), 'next-turn', true)
        await handle.agent.whenIdle()
        assert.equal(gateway.requests.length, 1, 'quota exhaustion must not dispatch or fall back to an API key')
      } finally { await handle.dispose() }
      await bind('b', account.provider, model); await runtime.move('b', 'independent')
      assert.equal((await runtime.turn({ botId: 'b', input: 'Use the same subscription through the independent Bot.' })).answer, 'SUBSCRIPTION-OK')
      const receipts = readRows('router_model_calls').filter(row => row.state === 'settled')
      assert.equal(receipts.length, 2)
      assert.ok(receipts.every(row => row.funding === 'subscription' && row.provider === account.provider && row.pricing === null && row.outcome === 'succeeded'))
      const runIds = new Set(receipts.map(row => row.runId))
      const runs = readRows('router_runs').filter(row => runIds.has(row.id))
      assert.equal(runs.length, 2)
      assert.ok(runs.every(row => row.packages.length === 1 && row.packages[0].billing === 'subscription' && row.packages[0].costUsd === 0 && row.packages[0].costSource === 'subscription'))
      assert.equal(gateway.requests.length, 2)
      assert.ok(gateway.requests.every(request => request.authorization === 'Bearer ' + gateway.key && (request.body.max_tokens ?? request.body.max_completion_tokens) === 64))
      await assert.rejects(dispatch('subscriptions.remove', { id: account.id, expectedRevision: account.revision }), { code: 'SUBSCRIPTION_IN_USE' })
      const beforeStop = gateway.requests.length
      await dispatch('subscriptions.stop', {})
      binding = await dispatch('binding.inspect', { botId: 'b' })
      assert.ok(!binding.record.catalog.models.some(item => item.provider === account.provider))
      await runtime.turn({ botId: 'b', input: 'This stopped account must not dispatch.' }).catch(() => {})
      assert.equal(gateway.requests.length, beforeStop)
      assert.ok(product.lifecycle.committedBot('a').model.startsWith(account.provider + '/'))
    }, { subscriptionRuntime: gateway.runtime, beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
  } finally { await gateway.close() }
})
