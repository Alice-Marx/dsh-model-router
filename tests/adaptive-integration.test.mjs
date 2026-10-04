import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createWorkspacePlan } from '../.dsh-plugin/client/catalog.mjs'
import { liveBenchRow } from '../.dsh-plugin/shared/livebench.mjs'

// Isolated fixture state and memory-only public sources. No real home, network,
// CLI or provider API is read or called. Prices/scores/answers are synthetic.
const integrationHome = mkdtempSync(join(tmpdir(), 'model-router-adaptive-integration-'))
process.env.DSH_HOME = integrationHome
const host = await import('../.dsh-plugin/index.mjs')
after(async () => {
  assert.equal(dirname(resolve(integrationHome)), resolve(tmpdir()))
  assert.ok(integrationHome.includes('model-router-adaptive-integration-'))
  await rm(integrationHome, { recursive: true, force: true })
})

const models = ['route-low', 'route-high']
const catalog = { routableProviders: ['demo'], groups: [{ id: 'demo', models: models.map(id => ({ id })) }] }
const task = '请编写 Python 代码，用函数返回两个数字之和。'
const baseOptions = { skipToolProbe: true, installedToolIds: [], runnableToolIds: [] }
const benchEndpoint = 'https://bench.example.org/scores.json'
const pricingEndpoint = 'https://prices.example.org/rates.json'
const fixedNow = 1_791_065_600_000

function ctxFixture() {
  const streamCalls = []
  return {
    streamCalls,
    llm: {
      listProviders: () => ['demo'],
      listModels: async () => models.map(id => ({ id })),
      resolveModelInfo: async (provider, model) => ({ id: model }),
      stream(options) {
        streamCalls.push(options)
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: 'Synthetic answer, not a real model result.' }
          yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 100 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  }
}

function configFixture({ dynamicDataEnabled = true, manualPricing = false } = {}) {
  return {
    dynamicDataEnabled, liveBenchEndpoint: benchEndpoint, pricingSnapshotEndpoint: pricingEndpoint,
    dynamicDataTtlMinutes: 1440, reviewMode: 'off', feedbackHalfLifeDays: 30,
    modelProfilesJson: JSON.stringify([
      { provider: 'demo', model: 'route-low', benchmarkModel: 'benchmark-low', quality: 80,
        ...(manualPricing ? { pricing: { input: 7, output: 9 } } : {}) },
      { provider: 'demo', model: 'route-high', benchmarkModel: 'benchmark-high-max', quality: 80 },
    ]),
  }
}

function publicFixture(t) {
  const previousFetch = globalThis.fetch
  const previousNow = Date.now
  const publicCalls = []
  Date.now = () => fixedNow
  globalThis.fetch = async (url, options) => {
    publicCalls.push({ url, options })
    let payload
    if (url === benchEndpoint) payload = { scoreScale: 100, models: [
      { model: 'benchmark-low', overall: 80, scores: { code: 80 } },
      { model: 'benchmark-high-max', overall: 90, scores: { code: 90 } },
    ] }
    else if (url === pricingEndpoint) payload = { schemaVersion: 1, kind: 'pricing', version: 'fixture-price-v1', publishedAt: fixedNow,
      rows: models.map((model, index) => ({ provider: 'demo', model, input: index ? 3 : 1, output: index ? 6 : 2,
        currency: 'USD', unit: 'per-million-tokens', asOf: fixedNow,
        sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/' })) }
    else throw new Error('Unexpected network access was blocked by the fixture')
    return { ok: true, status: 200, url, headers: { get: name => name === 'content-type' ? 'application/json' : null },
      text: async () => JSON.stringify(payload) }
  }
  t.after(() => { globalThis.fetch = previousFetch; Date.now = previousNow })
  return publicCalls
}

async function clearFixtureState() {
  await host.routerStateStore().update(state => {
    state.runs = []
    state.dynamicData = { liveBench: null, pricing: null, status: {}, revision: '' }
    state.archivedSpending = {}
  })
}

function planningProjection(plan) {
  return {
    selected: plan.selected, candidates: plan.candidates, subtasks: plan.subtasks,
    costBreakdown: plan.costBreakdown, estimatedCost: plan.estimatedCost,
    dataVersions: plan.optimization.dataVersions, personalization: plan.optimization.personalization,
  }
}

test('Host dynamic source opt-in refreshes real planning and matches the client snapshot projection', async t => {
  const publicCalls = publicFixture(t)
  await clearFixtureState()
  const ctx = ctxFixture()
  const config = configFixture()
  const plan = await host.createRoutePlan(ctx, task, config, baseOptions)
  assert.equal(publicCalls.length, 2, 'enabled Host planning must actually invoke the public refresher')
  assert.equal(ctx.streamCalls.length, 0, 'data refresh is not a model probe')
  assert.equal(plan.taskType, 'code')
  const ledger = await host.ledgerSummary(config)
  assert.equal(publicCalls.length, 2, 'fresh cached sources are not downloaded again')
  assert.ok(ledger.routingData.liveBench)
  assert.ok(ledger.routingData.pricingSnapshot)
  assert.equal(plan.candidates.find(item => item.model === 'route-high').quality, 0.9)
  assert.equal(plan.candidates.find(item => item.model === 'route-low').inputPrice, 1)
  assert.equal(plan.candidates.find(item => item.model === 'route-low').pricingSource, 'dynamic')
  assert.equal(plan.optimization.dataVersions.pricing, 'fixture-price-v1')
  const clientPlan = createWorkspacePlan(task, catalog, { ...ledger.routingData, learning: ledger.learning,
    modelProfilesJson: config.modelProfilesJson, installedToolIds: [], runnableToolIds: [] })
  assert.deepEqual(planningProjection(clientPlan), planningProjection(plan))
})

test('dynamic data stays off by default and manually supplied prices override the public feed', async t => {
  const publicCalls = publicFixture(t)
  await clearFixtureState()
  const ctx = ctxFixture()
  const off = await host.createRoutePlan(ctx, task, { modelProfilesJson: configFixture().modelProfilesJson }, baseOptions)
  assert.equal(publicCalls.length, 0)
  assert.equal(off.candidates.find(item => item.model === 'route-low').inputPrice, null)
  const disabledLedger = await host.ledgerSummary({})
  assert.equal(disabledLedger.routingData.liveBench, null)
  assert.equal(disabledLedger.routingData.pricingSnapshot, null)
  const config = configFixture({ manualPricing: true })
  const plan = await host.createRoutePlan(ctx, task, config, baseOptions)
  assert.equal(plan.candidates.find(item => item.model === 'route-low').inputPrice, 7)
  assert.equal(plan.candidates.find(item => item.model === 'route-low').outputPrice, 9)
  assert.equal(plan.candidates.find(item => item.model === 'route-low').pricingSource, 'user')
})

test('clearing a pricing source disables cached dynamic prices in both Host and client without deleting last-good disk data', async t => {
  publicFixture(t)
  await clearFixtureState()
  const config = configFixture()
  await host.createRoutePlan(ctxFixture(), task, config, baseOptions)
  const clearedConfig = { ...config, pricingSnapshotEndpoint: '' }
  const ledger = await host.ledgerSummary(clearedConfig)
  assert.equal(ledger.routingData.pricingSnapshot, null)
  assert.equal(ledger.dynamicData.pricing.status, 'disabled')
  const plan = await host.createRoutePlan(ctxFixture(), task, clearedConfig, baseOptions)
  assert.equal(plan.candidates.find(item => item.model === 'route-low').inputPrice, null)
  const clientPlan = createWorkspacePlan(task, catalog, { ...ledger.routingData, learning: ledger.learning,
    modelProfilesJson: clearedConfig.modelProfilesJson })
  assert.equal(clientPlan.candidates.find(item => item.model === 'route-low').inputPrice, null)
  assert.ok((await host.routerStateStore().read()).dynamicData.pricing, 'last-good disk snapshot remains recoverable')
})

test('dynamic benchmark identity does not transfer max-effort scores to normalized low-effort aliases', async t => {
  publicFixture(t)
  await clearFixtureState()
  const ledger = await host.ledgerSummary(configFixture())
  const snapshot = ledger.routingData.liveBench
  assert.ok(snapshot)
  assert.equal(snapshot.exactModelMatch, true)
  assert.ok(liveBenchRow(snapshot, 'benchmark-high-max'))
  assert.equal(liveBenchRow(snapshot, 'benchmarkhighmax'), null, 'normalization alone does not establish the actual model/effort identity')
  assert.equal(liveBenchRow(snapshot, 'benchmark-high'), null)
  const withoutMaxMapping = { ...configFixture(), modelProfilesJson: JSON.stringify([
    { provider: 'demo', model: 'route-low', quality: 80 },
    { provider: 'demo', model: 'route-high', quality: 80 },
  ]) }
  const plainPlan = await host.createRoutePlan(ctxFixture(), task, withoutMaxMapping, baseOptions)
  assert.equal(plainPlan.candidates.find(item => item.model === 'route-high').qualitySource, 'user')
  assert.equal(plainPlan.candidates.find(item => item.model === 'route-high').quality, 0.8)
})

test('Host execution freezes dynamic price provenance, and stale feedback cannot rate a replaced result', async t => {
  publicFixture(t)
  await clearFixtureState()
  const ctx = ctxFixture()
  const config = configFixture()
  const result = await host.executeConfiguredAssignment(ctx, task, config, baseOptions)
  assert.ok(ctx.streamCalls.length > 0, 'only synthetic in-memory streams were used')
  const item = result.run.packages[0]
  assert.equal(item.pricingSnapshot.source, 'dynamic')
  assert.equal(item.pricingSnapshot.version, 'fixture-price-v1')
  assert.ok(item.costUsd > 0)
  await host.rateRecordedResult({ runId: result.run.id, packageId: item.id, rating: 'up', expectedFinishedAt: item.finishedAt })
  const before = await host.ledgerSummary(config)
  assert.equal(before.learning.feedbackCount, 1)
  const candidateBefore = (await host.createRoutePlan(ctx, task, config, baseOptions)).candidates.find(row => row.model === item.model)
  assert.equal(candidateBefore.quality, result.plan.candidates.find(row => row.model === item.model).quality, 'subjective feedback never raises the objective score')
  await host.routerStateStore().updateRun(result.run.id, run => {
    const replaced = run.packages.find(entry => entry.id === item.id)
    replaced.finishedAt = item.finishedAt + 1
    replaced.rating = null
    replaced.ratedAt = null
  })
  await assert.rejects(() => host.rateRecordedResult({ runId: result.run.id, packageId: item.id,
    rating: 'down', expectedFinishedAt: item.finishedAt }), /结果已更新/)
  const unchanged = await host.ledgerSummary(config)
  assert.equal(unchanged.runs.find(run => run.id === result.run.id).packages.find(entry => entry.id === item.id).rating, null)
})

test('task-specific explicit feedback changes the real Host/client policy without changing quality or learning from model review', async t => {
  const publicCalls = publicFixture(t)
  await clearFixtureState()
  const config = { dynamicDataEnabled: false, feedbackPriorWeight: 1, feedbackMaxAdjustment: 0.1,
    modelProfilesJson: JSON.stringify(models.map(model => ({ provider: 'demo', model, quality: 80,
      pricing: { input: 1, output: 2 } }))) }
  const ctx = ctxFixture()
  const plain = await host.createRoutePlan(ctx, task, config, baseOptions)
  const preferredModel = models.find(model => model !== plain.selected.model)
  await host.routerStateStore().update(state => {
    state.runs = Array.from({ length: 20 }, (_, index) => ({ id: `feedback-${index}`, createdAt: fixedNow - 1,
      finishedAt: fixedNow - 1, task: 'Synthetic local feedback fixture.', packages: [{ id: 'result', type: 'code',
        provider: 'demo', model: preferredModel, channel: 'harness-llm', ran: true, ok: true, status: 'succeeded',
        finishedAt: fixedNow - 1, ratedAt: fixedNow - 1, rating: 1, answer: '' }] }))
    state.runs.push({ id: 'review-only', createdAt: fixedNow - 1, task: 'Synthetic review fixture.', packages: [{ id: 'reviewed',
      provider: 'demo', model: plain.selected.model, type: 'code', ran: true, ok: true, channel: 'harness-llm', status: 'succeeded',
      finishedAt: fixedNow - 1, review: { score: 5 }, answer: '' }] })
  })
  const personalized = await host.createRoutePlan(ctx, task, config, baseOptions)
  assert.equal(personalized.selected.model, preferredModel)
  assert.deepEqual(personalized.candidates.map(row => [row.model, row.quality]).sort(), plain.candidates.map(row => [row.model, row.quality]).sort())
  const ledger = await host.ledgerSummary(config)
  assert.equal(ledger.learning.feedbackCount, 20, 'model review alone is not subjective feedback')
  assert.ok(ledger.learning.adjustments[`demo\0${preferredModel}`].code > 0)
  assert.equal(ledger.learning.adjustments[`demo\0${preferredModel}`].math, undefined, 'there is no cross-task transfer')
  const client = createWorkspacePlan(task, catalog, { ...ledger.routingData, learning: ledger.learning,
    modelProfilesJson: config.modelProfilesJson })
  assert.deepEqual(planningProjection(client), planningProjection(personalized))
  const reset = await host.createRoutePlan(ctx, task, { ...config, feedbackResetAt: fixedNow }, baseOptions)
  assert.equal(reset.selected.model, plain.selected.model)
  assert.equal((await host.routerStateStore().read()).runs.length, 21, 'reset never deletes stored runs')
  assert.equal(publicCalls.length, 0)
  assert.equal(ctx.streamCalls.length, 0)
})

test('registered model-facing rating requires approval and feedback origins are audit labels, not authentication', async t => {
  const publicCalls = publicFixture(t)
  await clearFixtureState()
  const ctx = ctxFixture()
  const hooks = new Map()
  const tools = new Map()
  host.apply({ ...ctx, typert: null, commands: { register() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    on(name, handler) { hooks.set(name, handler) } }, {})
  const preExecute = hooks.get('tools/pre-execute')
  assert.equal(typeof preExecute, 'function')
  const rateDecision = await preExecute({ name: 'model_router_rate', arguments: {} }, async () => ({ kind: 'allow' }))
  assert.equal(rateDecision.kind, 'ask')
  assert.match(rateDecision.reason, /must not self-rate/)
  assert.deepEqual(await preExecute({ name: 'model_router_plan', arguments: {} }, async () => ({ kind: 'allow' })), { kind: 'allow' })
  const upstreamDenied = { kind: 'deny', reason: 'Synthetic upstream denial.' }
  assert.deepEqual(await preExecute({ name: 'model_router_rate', arguments: {} }, async () => upstreamDenied), upstreamDenied)
  await host.routerStateStore().appendRun({ id: 'origin-fixture', createdAt: fixedNow - 1, finishedAt: fixedNow - 1,
    task: 'Synthetic feedback origin fixture.', packages: [{ id: 'result', provider: 'demo', model: 'route-low', type: 'code',
      channel: 'harness-llm', ran: true, ok: true, status: 'succeeded', finishedAt: fixedNow - 1, answer: '' }] })
  const request = { runId: 'origin-fixture', packageId: 'result', rating: 'up', expectedFinishedAt: fixedNow - 1,
    origin: 'approved-tool', feedbackOrigin: 'approved-tool' }
  await host.routerRemoteServices(ctx, {}).rate(request)
  let item = (await host.routerStateStore().read()).runs.find(run => run.id === request.runId).packages[0]
  assert.equal(item.feedbackOrigin, 'desktop-ui', 'request fields cannot select the Desktop server-side origin')
  const rateTool = tools.get('model_router_rate')
  assert.equal(typeof rateTool?.execute, 'function')
  // Direct execution here simulates approval already granted by the runtime;
  // the pre-execute ask above is tested separately, not bypassed in production.
  await rateTool.execute({ ...request, rating: 'down', origin: 'desktop-ui' })
  item = (await host.routerStateStore().read()).runs.find(run => run.id === request.runId).packages[0]
  assert.equal(item.feedbackOrigin, 'approved-tool')
  assert.equal(item.rating, -1)
  assert.equal(item.verifiedUserId, undefined, 'origin is an audit path, not proof of a person or multi-user identity')
  assert.equal(publicCalls.length, 0)
  assert.equal(ctx.streamCalls.length, 0)
})
