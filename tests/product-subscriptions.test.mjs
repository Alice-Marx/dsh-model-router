import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { subscriptionFixture, pendingSubscription } from './helpers/subscription-account-fixture.mjs'

test('native subscription routes bind both Bot runtimes and use their own quota and ledger',
  { skip: process.platform !== 'win32' }, async () => {
    const fixture = await subscriptionFixture(await mkdtemp(join(tmpdir(), 'dsh-product-sub-')))
    let actual
    await withProductIndependent(async ({ ctx, product, bind, dispatch, runtime, readRows }) => {
      const readModel = ctx.get('botProductReadModel')
      await assert.rejects(readModel.dispatch({ action: 'subscriptions.list', payload: {} }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
      const login = await pendingSubscription((name, payload) => dispatch('subscriptions.' + name, payload))
      await fixture.complete(login.loginId)
      const result = await dispatch('subscriptions.loginStatus', { loginId: login.loginId })
      assert.equal(result.status, 'complete')
      const [account] = result.view.accounts
      const [{ id: model, provider }] = account.models
      const initial = await dispatch('binding.inspect', { botId: 'a' })
      const offered = initial.record.catalog.models.find(item => item.provider === provider && item.model === model)
      assert.deepEqual(offered.fundingModes, ['subscription'])
      assert.equal(offered.source, 'plugin')
      await bind('a', provider, model)
      const binding = await dispatch('binding.inspect', { botId: 'a' })
      await dispatch('binding.save', { botId: 'a', expectedRevision: binding.record.revision, settings: { ...binding.record.settings,
        funding: { ...binding.record.settings.funding, subscription: { dailyCalls: 1, monthlyCalls: 10 } } } })
      const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider, model },
        setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
      try {
        handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'subscription test' }], source: { kind: 'user' } }), 'next-turn', true)
        await handle.agent.whenIdle()
        assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant'
          && message.content.some(block => block.text?.startsWith('turn-1: subscription test'))))
        handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'over allowance' }], source: { kind: 'user' } }), 'next-turn', true)
        await handle.agent.whenIdle()
        assert.equal(readRows('router_model_calls').filter(row => row.state === 'settled' && row.outcome === 'succeeded').length, 1)
      } finally { await handle.dispose() }
      await bind('b', provider, model)
      await runtime.move('b', 'independent')
      assert.match((await runtime.turn({ botId: 'b', input: 'independent subscription test' })).answer, /^turn-1: independent subscription test/)
      const receipts = readRows('router_model_calls').filter(row => row.state === 'settled' && row.outcome === 'succeeded')
      assert.equal(receipts.length, 2)
      assert.ok(receipts.every(row => row.funding === 'subscription' && row.provider === provider && row.pricing === null))
      const runIds = new Set(receipts.map(row => row.runId))
      const runs = readRows('router_runs').filter(row => runIds.has(row.id))
      assert.equal(runs.length, 2)
      assert.ok(runs.every(row => row.packages.some(item => item.billing === 'subscription' && item.costUsd === 0 && item.costSource === 'subscription')))
      const quota = await dispatch('usage.subscriptionQuota', { refreshAccounts: true })
      assert.equal(quota.accountQuotas.find(item => item.id === account.id).reading.windows[0].remainingPercent, 65)
      assert.equal(quota.bots.find(item => item.id === 'a').windows.find(item => item.id === 'day').remaining, 0)
      assert.equal((await dispatch('subscriptions.list', {})).accounts[0].state, 'ready')
      await assert.rejects(dispatch('subscriptions.remove', { id: account.id, expectedRevision: account.revision }), { code: 'SUBSCRIPTION_IN_USE' })
      assert.equal(product.lifecycle.committedBot('a').model, provider + '/' + model)
    }, { subscriptionBackend: fixture.backend, beforeProduct: async ({ ctx }) => {
      actual = await attachActualAgentLoop(ctx)
      return () => actual.close()
    } })
  })
