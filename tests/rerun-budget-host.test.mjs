import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { buildRunRecord } from '../.dsh-plugin/shared/run-ledger.mjs'
import { estimateAssignedPackage } from '../.dsh-plugin/shared/router.mjs'
import { healthCache } from '../.dsh-plugin/shared/tool-health.mjs'

// Isolated receipts and inert streams/runners only: no network, CLI or model account.
const home = await mkdtemp(join(tmpdir(), 'router-rerun-budget-'))
const previousHome = process.env.DSH_HOME
const previousFetch = globalThis.fetch
process.env.DSH_HOME = home
globalThis.fetch = async () => { throw new Error('Unexpected network access in retry budget fixture') }
const host = await import('../.dsh-plugin/index.mjs')
after(async () => {
  globalThis.fetch = previousFetch
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  assert.equal(dirname(resolve(home)), resolve(tmpdir()))
  assert.ok(basename(home).startsWith('router-rerun-budget-'))
  await rm(home, { recursive: true, force: true })
})
beforeEach(() => host.routerStateStore().update(state => {
  state.runs = []; state.archivedSpending = {}; state.quota = {}; state.authFailures = {}
  state.dynamicData = { liveBench: null, pricing: null, status: {}, revision: '' }
}))

const provider = 'openai'
const models = ['economy-fixture', 'strong-fixture', 'unknown-fixture']
const task = '分析代码并提出修复方案，最后核验方案。'
const profiles = models.map((model, index) => ({ provider, model, quality: 90,
  execution: 'api', billing: 'api-only', subscription: 'none', cliModel: `${model}-cli`,
  ...(index < 2 ? { pricing: { input: index ? 100 : 1, output: index ? 100 : 1 } } : {}) }))
const settings = extra => ({ dynamicDataEnabled: false, reviewMode: 'off', overBudgetAction: 'pause',
  dailyBudgetUsd: 0.5, modelProfilesJson: JSON.stringify(profiles), ...extra })
const options = { workspace: home, billing: false }
function context() {
  const calls = []
  return { calls, llm: {
    listProviders: () => [provider], listModels: async () => models.map(id => ({ id })),
    resolveModelInfo: async (_, model) => ({ id: model }),
    stream(request) {
      calls.push(request)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: 'offline retry answer' }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  } }
}
function item(id, estimatedCost, dependsOn = [], status = 'blocked') {
  return { id, name: `包 ${id}`, objective: `完成 ${id}`, type: 'code', purpose: 'execution', dependsOn,
    recommendedProvider: provider, recommendedModel: models[0], estimatedCost, status }
}
async function stored(packages, { kind = 'assign' } = {}) {
  const now = Date.now()
  const run = buildRunRecord({ id: `retry-${kind}`, createdAt: now, finishedAt: now, task, workspace: home,
    kind, plan: { mode: 'team', team: { workPackages: packages } }, execution: { status: 'failed',
      packages: packages.map(entry => ({ id: entry.id, provider, model: models[0], channel: 'harness-llm',
        ok: entry.status === 'succeeded', answer: entry.status === 'succeeded' ? `kept ${entry.id}` : '',
        ...(entry.status === 'blocked' ? { blocked: true } : { reportedCostUsd: 0 }), error: 'offline fixture' })) } })
  await host.routerStateStore().appendRun(run)
  return run
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should equal ${expected}`)

test('a retry pauses before any call when the target plus unfinished downstream exceeds the daily budget', async () => {
  const run = await stored([item('a', 0.2, [], 'failed'), item('b', 0.4, ['a'])])
  const ctx = context()
  const result = await host.rerunRecordedStep(ctx, settings(), { ...options, runId: run.id, packageId: 'a' })
  assert.equal(result.paused, true)
  assert.equal(result.budget.exceeded, 'daily')
  close(result.budget.estimateUsd, 0.6)
  assert.equal(ctx.calls.length, 0)
  assert.deepEqual(result.run.packages.map(entry => entry.status), ['failed', 'blocked'])
})

test('explicit over-budget confirmation executes the same complete retry set and records its estimate', async () => {
  const run = await stored([item('a', 0.2, [], 'failed'), item('b', 0.4, ['a'])])
  const ctx = context()
  const result = await host.rerunRecordedStep(ctx, settings(), {
    ...options, runId: run.id, packageId: 'a', confirmOverBudget: true,
  })
  assert.equal(result.paused, undefined)
  close(result.budget.estimateUsd, 0.6)
  assert.equal(ctx.calls.length, 2)
  assert.deepEqual(result.execution.ranIds, ['a', 'b'])
  assert.ok(result.run.packages.every(entry => entry.ok))
  assert.deepEqual(result.run.packages.map(entry => entry.estimatedCost), [0.2, 0.4])
})

test('successful downstream and unrelated failed packages are excluded from both retry spend and execution', async () => {
  const run = await stored([item('a', 0.2, [], 'failed'), item('b', 10, ['a'], 'succeeded'), item('c', 10, [], 'failed')])
  const ctx = context()
  const result = await host.rerunRecordedStep(ctx, settings(), { ...options, runId: run.id, packageId: 'a' })
  assert.equal(result.paused, undefined)
  close(result.budget.estimateUsd, 0.2)
  assert.equal(ctx.calls.length, 1)
  assert.deepEqual(result.execution.ranIds, ['a'])
  assert.equal(result.run.packages[1].answer, 'kept b')
  assert.equal(result.run.packages[2].status, 'failed')
})

test('failed and transitively blocked downstream packages both count against the monthly budget', async () => {
  const run = await stored([item('a', 0.2, [], 'failed'), item('b', 0.2, ['a'], 'failed'), item('c', 0.2, ['b'])])
  const ctx = context()
  const result = await host.rerunRecordedStep(ctx, settings({ dailyBudgetUsd: 0, monthlyBudgetUsd: 0.5 }), {
    ...options, runId: run.id, packageId: 'a',
  })
  assert.equal(result.paused, true)
  assert.equal(result.budget.exceeded, 'monthly')
  close(result.budget.estimateUsd, 0.6)
  assert.equal(ctx.calls.length, 0)
})

test('an unknown downstream estimate requires explicit confirmation under a finite budget', async () => {
  const run = await stored([item('a', 0.2, [], 'failed'), item('b', null, ['a'])])
  const ctx = context()
  const result = await host.rerunRecordedStep(ctx, settings(), { ...options, runId: run.id, packageId: 'a' })
  assert.equal(result.budget.estimateKnown, false)
  assert.equal(result.budget.estimateUsd, null)
  assert.equal(result.budget.exceeded, 'unknown')
  assert.equal(result.paused, true)
  assert.equal(ctx.calls.length, 0)
  const confirmed = await host.rerunRecordedStep(ctx, settings(), { ...options, runId: run.id, packageId: 'a', confirmOverBudget: true })
  assert.equal(confirmed.budget.estimateUsd, null)
  assert.equal(ctx.calls.length, 2)
})

test('an unknown retry total still pauses when recorded spending already reaches the budget', async () => {
  const run = await stored([item('a', 0.2, [], 'failed'), item('b', null, ['a'])])
  await host.routerStateStore().update(state => { state.runs[0].packages[0].costUsd = 0.5 })
  const ctx = context()
  const result = await host.rerunRecordedStep(ctx, settings(), { ...options, runId: run.id, packageId: 'a' })
  assert.equal(result.paused, true)
  assert.equal(result.budget.estimateUsd, null)
  assert.equal(result.budget.exceeded, 'daily')
  assert.equal(ctx.calls.length, 0)
})

test('reassignment estimates the selected current route before checking the entire retry group', async () => {
  const packages = [item('a', 0.000001, [], 'failed'), item('b', 0.1, ['a'])]
  const run = await stored(packages)
  const ctx = context()
  const expected = estimateAssignedPackage(profiles[1], packages[0], task, 'balanced').estimatedCost
  assert.ok(expected > packages[0].estimatedCost)
  const result = await host.rerunRecordedStep(ctx, settings({ dailyBudgetUsd: expected + 0.05 }), {
    ...options, runId: run.id, packageId: 'a', provider, model: models[1],
  })
  assert.equal(result.paused, true)
  close(result.budget.estimateUsd, expected + 0.1)
  assert.equal(ctx.calls.length, 0)

  const confirmed = await host.rerunRecordedStep(ctx, settings({ dailyBudgetUsd: expected + 0.05 }), {
    ...options, runId: run.id, packageId: 'a', provider, model: models[1], confirmOverBudget: true,
  })
  assert.equal(ctx.calls.length, 2)
  assert.equal(ctx.calls[0].model, models[1])
  assert.equal(ctx.calls[1].model, models[0])
  close(confirmed.run.packages[0].estimatedCost, expected)
})

test('reassignment to an unpriced route does not reuse the old route estimate', async () => {
  const run = await stored([item('a', 0.2, [], 'failed')])
  const ctx = context()
  const result = await host.rerunRecordedStep(ctx, settings(), {
    ...options, runId: run.id, packageId: 'a', provider, model: models[2],
  })
  assert.equal(result.budget.estimateKnown, false)
  assert.equal(result.budget.estimateUsd, null)
  assert.equal(result.paused, true)
  assert.equal(result.budget.exceeded, 'unknown')
  assert.equal(ctx.calls.length, 0)
  const confirmed = await host.rerunRecordedStep(ctx, settings(), {
    ...options, runId: run.id, packageId: 'a', provider, model: models[2], confirmOverBudget: true,
  })
  assert.equal(confirmed.run.packages[0].estimatedCost, null)
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.calls[0].model, models[2])
})

test('an explicit same-route retry retains the estimate for its planned reasoning effort', async () => {
  const run = await stored([{ ...item('a', 1, [], 'failed'), recommendedReasoningEffort: 'high' }])
  const ctx = context()
  const result = await host.rerunRecordedStep(ctx, settings(), {
    ...options, runId: run.id, packageId: 'a', provider, model: models[0],
  })
  assert.equal(result.paused, true)
  assert.equal(result.budget.estimateUsd, 1)
  assert.equal(ctx.calls.length, 0)
})

test('official team retries share the aggregate budget gate and the exact execution ids', async t => {
  const previousHealth = healthCache.report()
  healthCache.remember({ checkedAt: Date.now(), tools: [{ id: 'codex', installed: true,
    login: { state: 'logged-in', billing: 'api-key', accountLogin: false } }] })
  t.after(() => healthCache.remember(previousHealth ?? { checkedAt: Date.now(), tools: [] }))
  const run = await stored([item('a', 0.2, [], 'failed'), item('b', 0.4, ['a']), item('c', 10, ['a'], 'succeeded')], { kind: 'team' })
  const ctx = context()
  const calls = []
  const request = { ...options, runId: run.id, packageId: 'a', installedToolIds: ['codex'], runTeam: async input => {
    calls.push(input)
    return { status: 'cli-completed', results: input.plan.team.workPackages.map(entry => ({ id: entry.id,
      provider, recommendedModel: entry.recommendedModel, toolId: 'codex', status: 'succeeded', finalText: 'offline team answer' })) }
  } }
  const paused = await host.rerunRecordedStep(ctx, settings(), request)
  assert.equal(paused.paused, true)
  close(paused.budget.estimateUsd, 0.6)
  assert.equal(calls.length, 0)
  const confirmed = await host.rerunRecordedStep(ctx, settings(), { ...request, confirmOverBudget: true })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].onlyIds, ['a', 'b'])
  assert.deepEqual(calls[0].plan.team.workPackages.map(entry => entry.id), ['a', 'b'])
  assert.equal(confirmed.run.packages[2].answer, 'kept c')
  assert.equal(ctx.calls.length, 0)
})

test('official team reassignment passes and retains the new estimate for a later retry', async t => {
  const previousHealth = healthCache.report()
  healthCache.remember({ checkedAt: Date.now(), tools: [{ id: 'codex', installed: true,
    login: { state: 'logged-in', billing: 'api-key', accountLogin: false } }] })
  t.after(() => healthCache.remember(previousHealth ?? { checkedAt: Date.now(), tools: [] }))
  const packages = [item('a', 0.000001, [], 'failed')]
  const run = await stored(packages, { kind: 'team' })
  const ctx = context()
  const expected = estimateAssignedPackage(profiles[1], packages[0], task, 'balanced').estimatedCost
  const calls = []
  const request = { ...options, runId: run.id, packageId: 'a', installedToolIds: ['codex'], runTeam: async input => {
    calls.push(input)
    return { status: 'incomplete', results: [{ id: 'a', provider, recommendedModel: input.plan.team.workPackages[0].recommendedModel,
      toolId: 'codex', status: 'failed', error: 'offline fixture', reportedCostUsd: 0 }] }
  } }
  const assigned = await host.rerunRecordedStep(ctx, settings({ dailyBudgetUsd: expected * 2 }), {
    ...request, provider, model: models[1],
  })
  close(assigned.budget.estimateUsd, expected)
  close(calls[0].plan.team.workPackages[0].estimatedCost, expected)
  close(assigned.run.packages[0].estimatedCost, expected)
  assert.equal(assigned.run.packages[0].recommendedModel, models[1])
  const paused = await host.rerunRecordedStep(ctx, settings({ dailyBudgetUsd: expected / 2 }), request)
  assert.equal(paused.paused, true)
  close(paused.budget.estimateUsd, expected)
  assert.equal(calls.length, 1)
  assert.equal(ctx.calls.length, 0)
})
