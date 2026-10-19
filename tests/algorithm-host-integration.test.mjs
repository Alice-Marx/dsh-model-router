import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { createWorkspacePlan } from '../.dsh-plugin/client/catalog.mjs'
import { buildRoutingEvidence } from '../.dsh-plugin/shared/routing-evidence.mjs'
import { actualCost, buildRunRecord } from '../.dsh-plugin/shared/run-ledger.mjs'

// Synthetic test catalog, answers, scores and prices only. No real CLI, model,
// credentials, network or user's DSH home is accessed by this fixture.
const home = await mkdtemp(join(tmpdir(), 'router-algorithm-host-'))
const previousHome = process.env.DSH_HOME
const previousFetch = globalThis.fetch
process.env.DSH_HOME = home
globalThis.fetch = async () => { throw new Error('Unexpected network access in offline Host fixture') }
const host = await import('../.dsh-plugin/index.mjs')
after(async () => {
  globalThis.fetch = previousFetch
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  const target = resolve(home)
  assert.equal(dirname(target), resolve(tmpdir()), 'recursive cleanup must remain inside the named temporary parent')
  assert.ok(basename(target).startsWith('router-algorithm-host-'))
  await rm(target, { recursive: true, force: true })
})

const provider = 'algorithm-fixture'
const models = ['economy', 'strong']
const task = '请编写 Python 代码，用函数返回两个数字之和。'
const reasoning = { efforts: ['low', 'high'], defaultEffort: 'low' }
const catalog = { routableProviders: [provider], groups: [{ id: provider,
  models: models.map(id => ({ id, reasoning })) }] }
const baseOptions = { skipToolProbe: true, installedToolIds: [], runnableToolIds: [], workspace: home, billing: false }
const gate = JSON.stringify({ kind: 'json-object', requiredKeys: ['answer'], fieldTypes: { answer: 'number' } })
const usage = { inputTokens: 1000, outputTokens: 100 }
const firstCost = 0.0012
const upgradeCost = 0.012
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should equal ${expected}`)

function config(extra = {}, profileChanges = {}) {
  return { reviewMode: 'off', dynamicDataEnabled: false,
    modelProfilesJson: JSON.stringify(models.map((model, index) => ({ provider, model,
      quality: index ? 95 : 80, execution: 'api', billing: 'api-only', subscription: 'none',
      pricing: { input: index ? 10 : 1, output: index ? 20 : 2 },
      ...(profileChanges[model] ?? {}),
    }))), ...extra }
}

function context(scripts = [], controller = null, directory = { [provider]: models }) {
  const calls = []
  return { calls, llm: {
    listProviders: () => Object.keys(directory),
    listModels: async routeProvider => (directory[routeProvider] ?? []).map(id => ({ id })),
    resolveModelInfo: async (_, model) => ({ id: model, reasoning }),
    stream(options) {
      const index = calls.length
      calls.push(options)
      const script = scripts[index] ?? { answer: '{"answer":3}' }
      return (async function* () {
        if (script.abort) {
          controller.abort(new Error('fixture cancellation after second API request began'))
          throw Object.assign(new Error('fixture abort'), { name: 'AbortError' })
        }
        if (script.throw) throw new Error('fixture request failed without usage')
        yield { type: 'text-delta', index: 0, text: script.answer ?? '{"answer":3}' }
        if (script.usage !== false) yield { type: 'usage', usage: script.usage ?? usage }
        yield { type: 'finish', reason: script.error
          ? { kind: 'error', failure: { message: 'fixture API error' } } : { kind: 'stop' } }
      })()
    },
  } }
}

async function reset() {
  await host.routerStateStore().update(state => {
    state.runs = []
    state.archivedSpending = {}
    state.quota = {}
    state.authFailures = {}
    state.dynamicData = { liveBench: null, pricing: null, status: {}, revision: '' }
  })
}
beforeEach(reset)
const firstPackage = result => {
  assert.ok(result.run, 'execution must retain a run record')
  assert.equal(result.run.packages.length, 1)
  return result.run.packages[0]
}
const recordedAttempts = item => {
  assert.ok(Array.isArray(item.qualityAttempts), 'quality-gated API execution must record each attempted request')
  return item.qualityAttempts
}

function objectiveArtifact(count = 8) {
  const now = Date.now()
  const observations = []
  for (let i = 0; i < count; i++) for (const [effort, quality] of [['low', 0.3], ['high', 0.9]]) {
    observations.push({ id: `${effort}-${i}`, groupId: `fixture-task-${i}`, text: task, type: 'code',
      provider, model: 'economy', reasoningEffort: effort, channel: 'harness-llm', quality,
      split: 'train', timestamp: now - 1000,
      provenance: { kind: 'objective', source: 'unit-tests', reference: 'fixture/not-production-evidence' } })
  }
  // Offline minSamples=1 is deliberately overridden by Host's production floor 8.
  return buildRoutingEvidence({ observations, now, minSamples: 1 })
}

test('Host evidence import and resource learning match the client snapshot and retain production minimum eight', async () => {
  const now = Date.now()
  const history = Array.from({ length: 8 }, (_, index) => buildRunRecord({
    id: `history-${index}`, createdAt: now - 2000, finishedAt: now - 1000, task,
    plan: { team: { workPackages: [{ id: 'execution', name: 'fixture', objective: task, type: 'code',
      purpose: 'execution', recommendedProvider: provider, recommendedModel: 'economy', recommendedReasoningEffort: 'high' }] } },
    execution: { status: 'completed', packages: [{ id: 'execution', provider, model: 'economy',
      ok: true, ran: true, channel: 'harness-llm', answer: '{"answer":3}',
      usage: { inputTokens: 150, outputTokens: 70 }, inputChars: task.length * 2, durationMs: 100,
      plannedReasoningEffort: 'high', requestedReasoningEffort: 'high', reasoningEffortStatus: 'requested' }] },
    pricingFor: () => ({ input: 1, output: 2 }),
  }))
  await host.routerStateStore().update(state => { state.runs = history })
  const settings = config({ routingEvidenceJson: JSON.stringify(objectiveArtifact()) })
  const ctx = context()
  const plan = await host.createRoutePlan(ctx, task, settings, baseOptions)
  const summary = await host.ledgerSummary(settings)
  const client = createWorkspacePlan(task, catalog, { ...summary.routingData,
    routingEvidence: summary.routingEvidence, learning: summary.learning,
    modelProfilesJson: settings.modelProfilesJson, installedToolIds: [], runnableToolIds: [] })
  assert.equal(ctx.calls.length, 0, 'planning and artifact import must not call a model')
  assert.equal(plan.selected.reasoningEffort, 'high')
  assert.equal(plan.costBreakdown[0].estimateSource, 'recorded-resource-evidence')
  assert.equal(plan.costBreakdown[0].outputTokens, 70, 'observed output must not receive a second effort multiplier')
  assert.equal(summary.routingEvidence.minSamples, 8)
  assert.equal(plan.optimization.evidenceRevision, summary.routingEvidence.revision)
  assert.deepEqual(client.selected, plan.selected)
  assert.deepEqual(client.costBreakdown, plan.costBreakdown)
  assert.equal(client.optimization.evidenceRevision, plan.optimization.evidenceRevision)
  const disabled = await host.ledgerSummary({ ...settings, resourceLearningEnabled: false })
  assert.deepEqual(disabled.routingEvidence.resourceGroups, [])
  assert.equal(disabled.routingEvidence.qualitySamples.length, summary.routingEvidence.qualitySamples.length)
  const sparse = await host.createRoutePlan(ctx, task, config({ routingEvidenceJson: JSON.stringify(objectiveArtifact(1)) }), baseOptions)
  assert.notEqual(sparse.selected.qualitySource, 'recorded-query-evidence')
})

test('no quality gate retains the legacy single API call and usage bill', async () => {
  const ctx = context([{ answer: 'legacy free-form output' }])
  const result = await host.executeConfiguredAssignment(ctx, task, config(), baseOptions)
  const item = firstPackage(result)
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.calls[0].model, 'economy')
  assert.equal(item.ok, true)
  close(item.costUsd, firstCost)
  close((await host.ledgerSummary(config())).spent.today, firstCost)
})

test('gate failure defaults to one call, records first charge, and missing usage remains unknown', async () => {
  const settings = config({ qualityGateJson: gate })
  const ctx = context([{ answer: '{"wrong":true}' }])
  const result = await host.executeConfiguredAssignment(ctx, task, settings, baseOptions)
  const item = firstPackage(result)
  assert.equal(ctx.calls.length, 1)
  assert.equal(item.ok, false)
  assert.equal(item.qualityValidation.ok, false)
  assert.equal(recordedAttempts(item).length, 1)
  close(item.costUsd, firstCost)
  await reset()
  const unknown = context([{ answer: 'not JSON', usage: false }])
  const missing = firstPackage(await host.executeConfiguredAssignment(unknown, task, settings, baseOptions))
  assert.equal(missing.costUsd, null)
  const ledger = await host.ledgerSummary(settings)
  assert.ok(ledger.spent.unknownToday >= 1)
  assert.equal(ledger.spent.today, 0)
})

test('explicit quality escalation makes at most two API calls and sums each exact model price', async () => {
  const settings = config({ qualityGateJson: gate, qualityEscalationEnabled: true })
  const ctx = context([{ answer: '{"wrong":true}' }, { answer: '{"answer":3}' }])
  const result = await host.executeConfiguredAssignment(ctx, task, settings, baseOptions)
  const item = firstPackage(result)
  assert.deepEqual(ctx.calls.map(call => call.model), ['economy', 'strong'])
  assert.equal(item.ok, true)
  assert.equal(item.qualityValidation.escalated, true)
  const attempts = recordedAttempts(item)
  assert.deepEqual(attempts.map(attempt => attempt.model), ['economy', 'strong'])
  close(actualCost(attempts[0], attempts[0].pricingSnapshot).costUsd, firstCost)
  close(actualCost(attempts[1], attempts[1].pricingSnapshot).costUsd, upgradeCost)
  close(item.costUsd, firstCost + upgradeCost)
  close((await host.ledgerSummary(settings)).spent.today, firstCost + upgradeCost)
})

test('per-run, daily and monthly budgets independently refuse the extra quality API request', async () => {
  for (const scope of ['run', 'daily', 'monthly']) {
    await reset()
    const settings = config({ qualityGateJson: gate, qualityEscalationEnabled: true,
      ...(scope === 'daily' ? { dailyBudgetUsd: 0.004 } : {}),
      ...(scope === 'monthly' ? { monthlyBudgetUsd: 0.004 } : {}) })
    const ctx = context([{ answer: '{"wrong":true}' }, { answer: '{"answer":3}' }])
    const result = await host.executeConfiguredAssignment(ctx, task, settings,
      { ...baseOptions, ...(scope === 'run' ? { budgetUsd: 0.004 } : {}) })
    assert.equal(ctx.calls.length, 1, `${scope} budget must allow initial request and block the upgrade`)
    const item = firstPackage(result)
    assert.equal(item.ok, false)
    assert.equal(recordedAttempts(item).length, 1)
    close(item.costUsd, firstCost)
  }
})

test('second request failure or cancellation retains known first spend plus unknown second spend', async () => {
  for (const cancelled of [false, true]) {
    await reset()
    const controller = new AbortController()
    const settings = config({ qualityGateJson: gate, qualityEscalationEnabled: true })
    const ctx = context([{ answer: '{"wrong":true}' }, cancelled ? { abort: true } : { throw: true }], controller)
    let result
    try {
      result = await host.executeConfiguredAssignment(ctx, task, settings, { ...baseOptions, signal: controller.signal })
    } catch (error) {
      assert.ok(error.runId, 'cancellation after paid work must identify its stored run')
      result = { run: (await host.ledgerSummary(settings)).runs.find(run => run.id === error.runId) }
    }
    assert.equal(ctx.calls.length, 2)
    const item = firstPackage(result)
    assert.equal(item.ok, false)
    const attempts = recordedAttempts(item)
    assert.equal(attempts.length, 2)
    close(actualCost(attempts[0], attempts[0].pricingSnapshot).costUsd, firstCost)
    assert.equal(actualCost(attempts[1], attempts[1].pricingSnapshot).costUsd, null)
    assert.equal(item.costUsd, null, 'unknown total must never become a complete first-only bill')
    close(item.knownCostUsd, firstCost)
    assert.equal(item.unknownAttemptCount, 1)
    const summary = await host.ledgerSummary(settings)
    assert.ok(summary.spent.today >= firstCost - 1e-12, 'known paid attempt must remain counted')
    assert.ok(summary.spent.unknownToday >= 1, 'unreported second request must remain an unknown expense')
  }
})

test('direct model selection and subscription-only billing never permit quality escalation to another API model', async () => {
  const settings = config({ qualityGateJson: gate, qualityEscalationEnabled: true })
  const direct = context([{ answer: 'not JSON' }])
  const result = await host.executeConfiguredAssignment(direct, task, settings,
    { ...baseOptions, mode: 'direct', provider, model: 'economy' })
  assert.equal(direct.calls.length, 1)
  assert.equal(firstPackage(result).model, 'economy')
  assert.equal(result.plan.routingBypassed, true)
  await reset()
  const only = config({ qualityGateJson: gate, qualityEscalationEnabled: true },
    { economy: { billing: 'subscription-only', subscription: 'plan-key' } })
  const ctx = context([{ answer: 'not JSON' }, { answer: '{"answer":3}' }])
  const options = { ...baseOptions }
  delete options.billing
  const subscription = await host.executeConfiguredAssignment(ctx, task, only, options)
  assert.equal(ctx.calls.length, 1, 'subscription-only must not silently add an API charge')
  assert.equal(firstPackage(subscription).billing, 'subscription')
})

test('explicit subscription-first on either source or alternative never authorizes a quality API upgrade', async () => {
  for (const model of models) {
    await reset()
    const settings = config({ qualityGateJson: gate, qualityEscalationEnabled: true },
      { [model]: { billing: 'subscription-first' } })
    const ctx = context([{ answer: 'not JSON' }, { answer: '{"answer":3}' }])
    const result = await host.executeConfiguredAssignment(ctx, task, settings, baseOptions)
    assert.equal(ctx.calls.length, 1, `explicit subscription-first ${model} must not add an API request`)
    assert.equal(ctx.calls[0].model, 'economy')
    assert.equal(firstPackage(result).ok, false)
  }
})

test('an official-only source with no matching tool may fall back to API but cannot trigger quality escalation', async () => {
  const settings = config({ qualityGateJson: gate, qualityEscalationEnabled: true },
    { economy: { execution: 'official' } })
  const ctx = context([{ answer: 'not JSON' }, { answer: '{"answer":3}' }])
  const result = await host.executeConfiguredAssignment(ctx, task, settings, baseOptions)
  assert.equal(ctx.calls.length, 1, 'fallback API execution is not permission to upgrade an official-only source')
  assert.equal(ctx.calls[0].provider, provider)
  assert.equal(ctx.calls[0].model, 'economy')
  assert.equal(firstPackage(result).ok, false)
})

test('implicit coding-plan and token-plan routes cannot serve as ordinary quality-upgrade API sources or targets', async () => {
  for (const hinted of ['fixture-coding-plan', 'fixture-token-plan']) {
    for (const model of models) {
      await reset()
      const profiles = JSON.parse(config().modelProfilesJson)
      const changed = profiles.find(profile => profile.model === model)
      changed.provider = hinted
      delete changed.subscription // Exercise provider-name inference, not an explicit subscription field.
      const directory = { [provider]: models.filter(id => id !== model), [hinted]: [model] }
      const settings = config({ qualityGateJson: gate, qualityEscalationEnabled: true,
        modelProfilesJson: JSON.stringify(profiles) })
      const ctx = context([{ answer: 'not JSON' }, { answer: '{"answer":3}' }], null, directory)
      const result = await host.executeConfiguredAssignment(ctx, task, settings, baseOptions)
      assert.equal(ctx.calls.length, 1, `${hinted}/${model} must be excluded by effective billing policy`)
      assert.equal(ctx.calls[0].model, 'economy')
      assert.equal(ctx.calls[0].provider, model === 'economy' ? hinted : provider)
      assert.equal(firstPackage(result).ok, false)
    }
  }
})

test('a linked plan apiRoute excludes its effective API source or alternative from quality upgrades', async () => {
  for (const model of models) {
    await reset()
    const planProvider = 'fixture-coding-plan'
    const profiles = [...JSON.parse(config().modelProfilesJson), {
      provider: planProvider, model: 'linked-plan', quality: 1, execution: 'api',
      billing: 'subscription-first', subscription: 'plan-key', apiRoute: { provider, model },
      pricing: { input: 1000, output: 2000 },
    }]
    const settings = config({ qualityGateJson: gate, qualityEscalationEnabled: true,
      modelProfilesJson: JSON.stringify(profiles) })
    const ctx = context([{ answer: 'not JSON' }, { answer: '{"answer":3}' }], null,
      { [provider]: models, [planProvider]: ['linked-plan'] })
    const result = await host.executeConfiguredAssignment(ctx, task, settings, baseOptions)
    assert.equal(ctx.calls.length, 1, `linked subscription for ${model} must exclude the effective API route`)
    assert.equal(ctx.calls[0].model, 'economy')
    assert.equal(firstPackage(result).ok, false)
  }
})

test('rerunning the failed original route retains the exact requested effort and route identity', async () => {
  const settings = config()
  const ctx = context([{ answer: 'partial', error: true }, { answer: '{"answer":3}' }])
  const initial = await host.executeConfiguredAssignment(ctx, task, settings, baseOptions)
  const item = firstPackage(initial)
  assert.equal(item.ok, false)
  assert.ok(ctx.calls[0].reasoningEffort, 'initial assignment should carry its allowed SDK effort')
  const retried = await host.rerunRecordedStep(ctx, settings,
    { ...baseOptions, runId: initial.runId, packageId: item.id })
  assert.equal(ctx.calls.length, 2)
  assert.equal(ctx.calls[1].provider, ctx.calls[0].provider)
  assert.equal(ctx.calls[1].model, ctx.calls[0].model)
  assert.equal(ctx.calls[1].reasoningEffort, ctx.calls[0].reasoningEffort)
  assert.equal(retried.run.packages[0].requestedReasoningEffort, ctx.calls[0].reasoningEffort)
  assert.equal(retried.run.packages[0].ok, true)
  assert.equal(retried.run.packages[0].type, item.type)
  assert.equal(retried.run.packages[0].purpose, item.purpose)
  const reassigned = await host.rerunRecordedStep(ctx, settings,
    { ...baseOptions, runId: initial.runId, packageId: item.id, provider, model: 'strong' })
  assert.equal(ctx.calls.length, 3)
  assert.equal(ctx.calls[2].model, 'strong')
  assert.equal(Object.hasOwn(ctx.calls[2], 'reasoningEffort'), false,
    'manual cross-model reassignment cannot reuse the previous model effort intent')
  assert.equal(reassigned.run.packages[0].reasoningEffortStatus, 'unapplied')
})
