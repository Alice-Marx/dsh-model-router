import assert from 'node:assert/strict'
import test from 'node:test'
import { projectSubscriptionQuota } from '../packages/orchestration/src/subscription-quota.mjs'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'

test('local quota windows retain unknown history and omit expired tool limits and private output', () => {
  const at = new Date(2026, 11, 31, 23, 55).getTime()
  const reset = new Date(2027, 0, 1).getTime()
  const quota = {
    'cli:codex': { kind: 'quota', until: reset, resetReported: true, detail: 'private vendor output' },
    'plan:kimi': { kind: 'rate-limit', until: at + 60_000 },
    'cli:gemini': { kind: 'quota', until: at },
  }
  const plans = [{ botId: 'main', name: 'Main', dailyCalls: 1, monthlyCalls: 0 }]
  const usageFor = query => {
    assert.deepEqual(query, { botId: 'main', at })
    return { today: { calls: 2 }, month: { calls: 2 } }
  }
  const value = projectSubscriptionQuota({ ledger: { quota }, plans, usageFor, at })
  assert.deepEqual(value.bots[0].windows, [
    { id: 'day', limit: 1, used: 2, remaining: 0, resetAt: reset },
    { id: 'month', limit: 0, used: 2, remaining: 0, resetAt: reset },
  ])
  assert.deepEqual(value.channelLimits.map(({ id, kind, resetReported }) => [id, kind, resetReported]), [
    ['plan:kimi', 'rate-limit', false], ['cli:codex', 'quota', true],
  ])
  assert.doesNotMatch(JSON.stringify(value), /private vendor output/)
  const incomplete = projectSubscriptionQuota({ ledger: { quota, subscriptionUsageIncomplete: true }, plans, usageFor, at })
  assert.equal(incomplete.historyIncomplete, true)
  assert.ok(incomplete.bots[0].windows.every(window => window.remaining === null))
})

test('DS Bot quota shares the committed Main allowance and changes with real subscription admissions', async () => {
  await withProductIndependent(async ({ ctx, bind, dispatch, runtime, readRows }) => {
    const action = 'usage.subscriptionQuota'
    const readModel = ctx.get('botProductReadModel')
    await assert.rejects(readModel.dispatch({ action }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
    assert.deepEqual((await dispatch(action)).bots, [])
    await bind('a', 'alpha', 'one')
    await bind('b', 'beta', 'vendor/two')
    const { accounts, record } = await dispatch('binding.inspect', { botId: 'a' })
    const subscription = { dailyCalls: 1, monthlyCalls: 5 }
    const scoped = provider => accounts.items.find(account => account.provider === provider).id
    const route = (provider, model) => ({ provider, model, enabled: true,
      funding: { mode: 'subscription', scopeId: scoped(provider), pricing: null, request: null } })
    const first = route('alpha', 'one')
    await dispatch('binding.save', { botId: 'a', expectedRevision: record.revision, settings: {
      ...record.settings,
      funding: { ...first.funding, subscription, dailyBudgetUsd: null, monthlyBudgetUsd: null },
      mainRoutes: { schemaVersion: 1, limits: { api: null, subscription }, routes: [first, route('beta', 'vendor/two')] },
    } })
    const remaining = async () => (await dispatch(action)).bots.map(bot => [bot.id, ...bot.windows.map(window => window.remaining)])
    assert.deepEqual(await remaining(), [['a', 1, 5]])
    await runtime.move('a', 'independent')
    assert.equal((await runtime.turn({ botId: 'a', input: 'offline quota check' })).answer, 'model answer')
    assert.deepEqual(await remaining(), [['a', 0, 4]])
    assert.equal(readRows('router_model_calls')[0].funding, 'subscription')
    await assert.rejects(() => runtime.turn({ botId: 'a', input: 'blocked by the same quota' }), { code: 'MODEL_SUBSCRIPTION_LIMIT' })
    assert.equal(ctx.upstream.length, 1)
  }, { runtimeConfig: { memoryReview: false } })
})
