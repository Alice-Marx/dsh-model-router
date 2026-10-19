import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyTask } from '../.dsh-plugin/shared/router.mjs'
import { createPlanFromRoutes } from '../.dsh-plugin/shared/harness-plan.mjs'
import { buildRoutingEvidence } from '../.dsh-plugin/shared/routing-evidence.mjs'

// These objective-labelled observations and runs are synthetic fixtures, never
// measurements of provider quality or cost. No provider or CLI is invoked.
const NOW = 1_800_000_000_000
const TASK = 'Fix code parser exception'
const PROVIDER = 'openai'
const MODEL = 'fixture-model'
const HIGH_OUTPUTS = [100, 200, 300, 400, 500, 600, 700, 800]

function apiRoute(model = MODEL) {
  return { provider: PROVIDER, model, execution: 'api', quality: 0.9,
    reasoningKnown: true, reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low',
    inputModalities: ['text', 'image'], pricing: { input: 1, output: 20, currency: 'USD' } }
}

function fixtures({ lowQuality = 0.4, highQuality = 0.95, models = [MODEL] } = {}) {
  const observations = [], runs = []
  for (const model of models) for (const effort of ['low', 'high']) for (let i = 0; i < 8; i++) {
    const id = `${model}-${effort}-${i}`
    observations.push({ id: `observation-${id}`, groupId: `group-${id}`, text: TASK, type: 'code',
      provider: PROVIDER, model, reasoningEffort: effort, channel: 'harness-llm',
      quality: effort === 'low' ? lowQuality : highQuality, split: 'train', timestamp: NOW - 500,
      synthetic: true, provenance: { kind: 'objective', source: 'fixture', reference: 'routing-query-effort' } })
    runs.push({ id: `run-${id}`, task: TASK, synthetic: true, createdAt: NOW - 1000, finishedAt: NOW - 500,
      packages: [{ id: 'execution', provider: PROVIDER, model, type: 'code', purpose: 'execution',
        channel: 'harness-llm', ran: true, ok: true, finishedAt: NOW - 500,
        requestedReasoningEffort: effort, reasoningEffortStatus: 'requested',
        usage: { inputTokens: TASK.length * 2, outputTokens: effort === 'low' ? 80 : HIGH_OUTPUTS[i] },
        inputChars: TASK.length, durationMs: 1000 + i * 100 }] })
  }
  return { observations, runs }
}

function evidence(options) {
  return buildRoutingEvidence({ now: NOW, allowSynthetic: true, ...fixtures(options) })
}

function plan(routes = [apiRoute()], options = {}) {
  return createPlanFromRoutes(TASK, routes, { mode: 'single', ...options })
}

function decision(value) {
  return { selected: value.selected, subtasks: value.subtasks, costBreakdown: value.costBreakdown,
    estimatedCost: value.estimatedCost, workPackages: value.team.workPackages }
}

test('explanation prefixes preserve specialized routing and short translation compatibility', () => {
  for (const [text, type] of [
    ['解释这段代码为什么报错，并给出修复', 'code'],
    ['这段代码为什么报错，并给出修复', 'code'],
    ['解释这张截图中的异常', 'vision'],
    ['请把这句话翻译成英文', 'general'],
    ['请简要解释什么是缓存', 'general'],
  ]) {
    assert.equal(classifyTask(text), type, text)
    const routed = createPlanFromRoutes(text, [apiRoute()], { mode: 'single' })
    assert.equal(routed.taskType, type, text)
    assert.ok(routed.selected, text)
  }
})

test('empty evidence retains the legacy nearest effort, packages and heuristic cost', () => {
  const omitted = plan()
  const empty = plan([apiRoute()], { routingEvidence: buildRoutingEvidence({ now: NOW }) })
  assert.deepEqual(decision(empty), decision(omitted))
  assert.equal(empty.selected.reasoningEffort, 'low')
  assert.equal(empty.costBreakdown[0].outputTokens, 837)
  assert.equal(empty.costBreakdown[0].estimateSource, 'heuristic')
  assert.equal(empty.selected.qualitySource, 'route')
})

test('task quality evidence excludes a failing low effort and selects the supported high action', () => {
  const observed = evidence()
  assert.equal(observed.stats.qualityAccepted, 16)
  assert.equal(observed.stats.resourceAccepted, 16)
  const routed = plan([apiRoute()], { routingEvidence: observed })
  assert.equal(routed.selected.reasoningEffort, 'high')
  assert.equal(routed.selected.qualitySource, 'recorded-query-evidence')
  assert.ok(routed.subtasks.every(item => item.recommendedReasoningEffort === 'high'))
  assert.ok(routed.team.workPackages.every(item => item.recommendedReasoningEffort === 'high'))
  assert.equal(routed.costBreakdown[0].quality, 0.95)
  assert.equal(routed.costBreakdown[0].queryEvidenceCount, 8)
})

test('a low effort with adequate measured quality and fewer output tokens can win', () => {
  const routed = plan([apiRoute()], { routingEvidence: evidence({ lowQuality: 0.95, highQuality: 0.93 }) })
  assert.equal(routed.selected.reasoningEffort, 'low')
  assert.equal(routed.selected.qualitySource, 'recorded-query-evidence')
  assert.equal(routed.costBreakdown[0].quality, 0.95)
  assert.equal(routed.costBreakdown[0].outputTokens, 80)
  assert.ok(routed.costBreakdown[0].quality >= routed.subtasks[0].qualityFloor)
})

test('recorded p90 resources replace heuristic effort multipliers and leave unknown prices unknown', () => {
  const observed = evidence()
  const routed = plan([apiRoute()], { routingEvidence: observed })
  const row = routed.costBreakdown[0]
  assert.equal(row.estimateSource, 'recorded-resource-evidence')
  assert.equal(row.resourceSampleCount, 8)
  assert.equal(row.empiricalQuantile, 0.9)
  assert.equal(row.inputTokens, TASK.length * 2)
  assert.equal(row.outputTokens, 730, 'the empirical p90 is 730; its median is 450')
  assert.equal(row.estimatedLatencyMs, 1630)
  assert.equal(row.estimatedCost, 0.01465)
  const unknownRoute = apiRoute()
  delete unknownRoute.pricing
  const unknown = plan([unknownRoute], { routingEvidence: observed })
  assert.equal(unknown.costBreakdown[0].estimateSource, 'recorded-resource-evidence')
  assert.equal(unknown.costBreakdown[0].outputTokens, 730)
  assert.equal(unknown.costBreakdown[0].estimatedCost, null)
  assert.equal(unknown.selected.estimatedCost, null)
  assert.equal(unknown.estimatedCost, null)
})

test('an installed runnable CLI uses its default effort and cannot borrow API observations', () => {
  const route = { ...apiRoute(), execution: 'official' }
  const routed = plan([route], { routingEvidence: evidence(), installedToolIds: ['codex'], runnableToolIds: ['codex'] })
  assert.equal(routed.executionChannel, 'official-cli')
  assert.equal(routed.selected.reasoningEffort, undefined)
  assert.notEqual(routed.selected.qualitySource, 'recorded-query-evidence')
  assert.ok(routed.team.workPackages.every(item => item.executionChannel === 'official-cli'
    && item.recommendedReasoningEffort === undefined))
  assert.ok(routed.costBreakdown.every(item => item.reasoningEffort === undefined
    && item.estimateSource === 'heuristic' && item.resourceSampleCount === 0))
  assert.equal(routed.costBreakdown[0].outputTokens, 900)
})

test('a direct plan keeps the exact requested model and leaves effort to its adapter default', () => {
  const routes = [apiRoute(), apiRoute('fixture-direct')]
  const routed = plan(routes, { routingEvidence: evidence({ models: [MODEL, 'fixture-direct'] }),
    mode: 'direct', directProvider: PROVIDER, directModel: 'fixture-direct' })
  assert.equal(routed.routingBypassed, true)
  assert.deepEqual(routed.directRoute, { provider: PROVIDER, model: 'fixture-direct' })
  assert.equal(routed.selected.provider, PROVIDER)
  assert.equal(routed.selected.model, 'fixture-direct')
  assert.equal(routed.selected.reasoningEffort, undefined)
  assert.ok(routed.team.workPackages.every(item => item.recommendedModel === 'fixture-direct'
    && item.recommendedReasoningEffort === undefined))
  assert.ok(routed.costBreakdown.every(item => item.reasoningEffort === undefined
    && item.estimateSource === 'heuristic'))
})

test('explicit official teams use CLI evidence and default effort despite API preference or logged-out probe', () => {
  const route = apiRoute()
  const options = { mode: 'team', routingEvidence: evidence(), installedToolIds: ['codex'],
    runnableToolIds: ['codex'], loggedOutToolIds: ['codex'] }
  const automatic = plan([route], options)
  assert.equal(automatic.executionChannel, 'harness-llm', 'ordinary team mode honors API preference')
  assert.equal(automatic.selected.reasoningEffort, 'high')
  const official = plan([route], { ...options, forceOfficialCli: true })
  assert.equal(official.executionChannel, 'official-cli')
  assert.equal(official.selected.reasoningEffort, undefined)
  assert.notEqual(official.selected.qualitySource, 'recorded-query-evidence')
  assert.ok(official.team.workPackages.every(item => item.executionChannel === 'official-cli'
    && item.recommendedReasoningEffort === undefined))
  assert.ok(official.costBreakdown.every(item => item.estimateSource === 'heuristic'
    && item.resourceSampleCount === 0))
  assert.deepEqual(official.availableRoutes, [route], 'execution retains the original route metadata')
})

test('reordering routes and independent evidence groups leaves selected actions and costs stable', () => {
  const routes = [apiRoute(), apiRoute('fixture-model-b')]
  const source = fixtures({ models: [MODEL, 'fixture-model-b'], lowQuality: 0.95, highQuality: 0.93 })
  const first = buildRoutingEvidence({ now: NOW, allowSynthetic: true, ...source })
  const reversed = buildRoutingEvidence({ now: NOW, allowSynthetic: true,
    observations: [...source.observations].reverse(), runs: [...source.runs].reverse() })
  assert.equal(first.revision, reversed.revision)
  const originalPlan = plan(routes, { routingEvidence: first })
  const reorderedPlan = plan([...routes].reverse(), { routingEvidence: reversed })
  assert.deepEqual(decision(reorderedPlan), decision(originalPlan))
})
