import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeAssignmentPlan, executeRouteWithBilling, usageFromOutput } from '../.dsh-plugin/shared/task-executors.mjs'
import { createQuotaTracker } from '../.dsh-plugin/shared/subscription-billing.mjs'
import { runOfficialTeam } from '../.dsh-plugin/shared/official-team-runtime.mjs'

const at = new Date(2026, 9, 24, 12).getTime()
const subscription = { provider: 'fixture-plan', model: 'gpt-plan', subscription: 'plan-key',
  apiRoute: { provider: 'fixture-api', model: 'gpt-api' } }
const api = { provider: 'fixture-api', model: 'gpt-api' }
const subUsage = { inputTokens: 30, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 2 }
const apiUsage = { inputTokens: 100, outputTokens: 15 }
const billing = extra => ({ quota: createQuotaTracker({ now: () => at }), now: () => at,
  loginBillingFor: () => 'subscription', routes: [subscription, api], ...extra })
const invoke = options => executeRouteWithBilling({ route: subscription, task: 'Offline billing fixture', billing: billing(), ...options })
const quotaFailure = usage => ({ ok: false, error: '429 quota exceeded', usage })

async function directory(t) {
  const value = await mkdtemp(join(tmpdir(), 'router-sub-receipts-'))
  t.after(() => rm(value, { recursive: true, force: true }))
  return value
}

test('a subscription receipt is checkpointed before API fallback and keeps independent token usage', async () => {
  const order = []
  const result = await invoke({
    onSubscriptionResult(event) {
      order.push('subscription-saved')
      assert.deepEqual(event.usage, subUsage)
      assert.equal(event.billing, 'subscription')
      assert.equal(event.subscriptionAttempts.length, 1)
      assert.equal(JSON.stringify(event).includes('fixture-private-value'), false)
      assert.equal(event.reportedCostUsd, undefined)
      event.usage.inputTokens = 999 // callbacks receive snapshots, not retained evidence
    },
    apiFallback(request) {
      if (request.subscription) return { ...quotaFailure(subUsage), reportedCostUsd: 42,
        apiKey: 'fixture-private-value', answer: 'fixture-private-value', usage: { ...subUsage, apiKey: 'fixture-private-value' } }
      assert.deepEqual(order, ['subscription-saved'])
      order.push('api-started')
      return { ok: true, answer: 'API result', usage: apiUsage }
    },
  })
  assert.equal(result.billing, 'api')
  assert.deepEqual(result.usage, apiUsage)
  assert.deepEqual(result.subscriptionAttempts, [{ provider: subscription.provider, model: subscription.model,
    toolId: null, channel: 'harness-llm', usage: subUsage, finishedAt: at }])
  assert.deepEqual(order, ['subscription-saved', 'api-started'])
})

test('a failed subscription stays subscription usage when the user is asked, including partial counters', async () => {
  let apiCalls = 0
  const result = await invoke({ apiFallback(request) {
    if (!request.subscription) apiCalls += 1
    return { ok: false, error: 'temporary unavailable', usage: { inputTokens: 12 }, usageIncomplete: true }
  } })
  assert.equal(apiCalls, 0)
  assert.equal(result.paused, true)
  assert.equal(result.billing, 'subscription')
  assert.deepEqual(result.subscriptionAttempts[0].usage, { inputTokens: 12 })
  assert.equal(result.subscriptionAttempts[0].usageIncomplete, true)
  assert.equal(result.subscriptionAttempts[0].usage.outputTokens, undefined)
})

test('cancellation after a subscription receipt preserves its usage and does not start API fallback', async () => {
  const controller = new AbortController()
  let calls = 0
  const result = await invoke({ signal: controller.signal,
    onSubscriptionResult() { controller.abort() },
    apiFallback() { calls += 1; return quotaFailure(subUsage) },
  })
  assert.equal(calls, 1)
  assert.equal(result.cancelled, true)
  assert.equal(result.billing, 'subscription')
  assert.deepEqual(result.subscriptionAttempts[0].usage, subUsage)
})

test('subscription receipt write failure blocks the paid fallback and exposes observed evidence', async () => {
  let calls = 0
  await assert.rejects(invoke({
    onSubscriptionResult() { throw new Error('fixture storage unavailable') },
    apiFallback() { calls += 1; return quotaFailure(subUsage) },
  }), error => {
    assert.equal(error.code, 'ROUTER_CHECKPOINT_FAILED')
    assert.equal(error.checkpointStage, 'subscription-result')
    assert.deepEqual(error.execution.packages[0].subscriptionAttempts[0].usage, subUsage)
    return true
  })
  assert.equal(calls, 1)
})

test('an API budget boundary error is propagated instead of becoming an uncertain API receipt', async () => {
  let calls = 0
  const changed = Object.assign(new Error('fixture API budget changed'), { code: 'ROUTER_BUDGET_CHANGED' })
  await assert.rejects(invoke({ apiFallback(request) {
    if (request.subscription) return quotaFailure(subUsage)
    calls += 1
    throw changed
  } }), error => error === changed)
  assert.equal(calls, 1)
})

test('API-only and an exhausted subscription do not fabricate a subscription attempt', async () => {
  for (const mode of ['api-only', 'exhausted']) {
    const context = billing({ ...(mode === 'api-only' ? { choice: 'api' } : {}) })
    if (mode === 'exhausted') context.quota.mark('plan:fixture-plan', { kind: 'quota', resetAt: at + 60_000 })
    const result = await invoke({ billing: context, onSubscriptionResult() { assert.fail('No subscription ran') },
      apiFallback(request) { assert.equal(request.subscription, undefined); return { ok: true, answer: 'API only', usage: apiUsage } } })
    assert.equal(result.billing, 'api')
    assert.equal(result.subscriptionAttempts, undefined)
    assert.deepEqual(result.usage, apiUsage)
  }
})

test('an explicitly unstarted plan request is retained without claiming consumed subscription usage', async () => {
  const result = await invoke({ billing: billing({ routes: [{ ...subscription, billing: 'subscription-only' }, api] }),
    apiFallback() { return { ok: false, notStarted: true, error: 'fixture request rejected before dispatch' } },
  })
  assert.equal(result.subscriptionAttempts[0].notStarted, true)
  assert.equal(result.subscriptionAttempts[0].usage, null)
  assert.equal(result.billing, 'subscription')
})

test('CLI quota fallback retains the parsed subscription usage and stops on receipt persistence failure', async t => {
  const workspace = await directory(t)
  const route = { provider: 'openai', model: 'gpt-cli', execution: 'official' }
  let apiCalls = 0
  const options = { route, task: 'Offline CLI fixture', workspace, billing: billing({ routes: [route] }),
    runVerified: async () => ({ status: 'failed', error: 'usage_limit_reached', usage: subUsage, reportedCostUsd: 999 }),
    apiFallback() { apiCalls += 1; return { ok: true, answer: 'API', usage: apiUsage } } }
  const result = await executeRouteWithBilling(options)
  assert.equal(apiCalls, 1)
  assert.equal(result.billing, 'api')
  assert.deepEqual(result.subscriptionAttempts[0].usage, subUsage)
  assert.equal(result.subscriptionAttempts[0].toolId, 'codex')
  assert.equal(result.subscriptionAttempts[0].reportedCostUsd, undefined)
  apiCalls = 0
  await assert.rejects(executeRouteWithBilling({ ...options, billing: billing({ routes: [route] }),
    onSubscriptionResult() { throw new Error('fixture storage unavailable') },
  }), { code: 'ROUTER_CHECKPOINT_FAILED' })
  assert.equal(apiCalls, 0)
})

test('package-level mandatory subscription checkpoint names the package and retains earlier results', async t => {
  const workspace = await directory(t)
  const first = { id: 'first', name: 'first', recommendedProvider: api.provider, recommendedModel: api.model }
  const second = { id: 'second', name: 'second', recommendedProvider: subscription.provider, recommendedModel: subscription.model }
  let secondApi = 0
  await assert.rejects(executeAssignmentPlan({ task: 'Offline plan', workspace,
    plan: { team: { workPackages: [first, second] } }, routes: [{ ...api, execution: 'api', subscription: 'none' }, subscription],
    billing: billing({ routes: [{ ...api, execution: 'api', billing: 'api-only', subscription: 'none' }, subscription] }), apiFallback(request) {
      if (request.subscription) return quotaFailure(subUsage)
      if (request.route.provider === subscription.provider) secondApi += 1
      return { ok: true, answer: 'first result', usage: apiUsage }
    },
    onSubscriptionResult(event) { assert.equal(event.id, 'second'); throw new Error('fixture storage unavailable') },
  }), error => {
    assert.equal(error.code, 'ROUTER_CHECKPOINT_FAILED')
    assert.deepEqual(error.execution.packages.map(item => item.id), ['first', 'second'])
    assert.equal(error.execution.packages[0].answer, 'first result')
    assert.deepEqual(error.execution.packages[1].subscriptionAttempts[0].usage, subUsage)
    return true
  })
  assert.equal(secondApi, 0)
})

test('incomplete CLI usage remains incomplete instead of turning missing required counters into zero', () => {
  for (const [format, output] of [
    ['claude-json', JSON.stringify({ usage: { input_tokens: 9 } })],
    ['codex-jsonl', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 9 } })],
    ['gemini-json', JSON.stringify({ stats: { models: { fixture: { tokens: { prompt: 9 } } } } })],
  ]) {
    const result = usageFromOutput(format, output)
    assert.equal(result.usageIncomplete, true, format)
    assert.equal(result.usage.inputTokens, 9)
    assert.equal(result.usage.outputTokens, undefined)
  }
  assert.equal(usageFromOutput('gemini-json', JSON.stringify({ stats: { models: {} } })), null)
})

test('official teams preserve an adapter’s explicit no-dispatch and billing evidence', async t => {
  const workspace = await directory(t)
  const result = await runOfficialTeam({ task: 'Offline official team', workspace,
    plan: { team: { workPackages: [{ id: 'one', name: 'one', objective: 'Inspect fixture', dependsOn: [], recommendedProvider: 'openai', recommendedModel: 'gpt-cli' }] } },
    installedIds: ['codex'], sandbox: { confine() { assert.fail('The offline runner must not invoke a sandbox') } }, runtime: {
      capabilities: [{ id: 'codex', supported: true, modes: ['read-only'] }],
      readiness: async () => ({ ready: true, readyModes: ['read-only'] }),
      runTool: async () => ({ status: 'unsupported', notStarted: true, billing: 'api', credentialSource: 'configured-api-key' }),
    },
  })
  assert.equal(result.results[0].notStarted, true)
  assert.equal(result.results[0].billing, 'api')
  assert.equal(result.results[0].credentialSource, 'configured-api-key')
})


test('an unknown CLI account pauses after a failure without guessing subscription usage or starting API', async t => {
  let apiCalls = 0
  const result = await executeRouteWithBilling({ route: { provider: 'openai', model: 'gpt-cli', execution: 'official' },
    task: 'Offline unknown billing', workspace: await directory(t),
    billing: billing({ loginBillingFor: () => 'unknown' }),
    runVerified: async () => ({ status: 'failed', error: 'usage_limit_reached', usage: subUsage, reportedCostUsd: 999 }),
    apiFallback() { apiCalls += 1; return { ok: true, answer: 'must not run' } },
  })
  assert.equal(apiCalls, 0)
  assert.equal(result.paused, true)
  assert.equal(result.billing, 'unknown')
  assert.equal(result.subscriptionAttempts, undefined)
})
