import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlanFromRoutes } from '../.dsh-plugin/shared/harness-plan.mjs'
import { estimateAssignedPackage } from '../.dsh-plugin/shared/router.mjs'
import { applyManualPackagePlan } from '../.dsh-plugin/shared/manual-plan.mjs'
import { packagePlanKey } from '../.dsh-plugin/shared/package-assignments.mjs'

// Synthetic catalog fixtures only: these tests never invoke a provider or CLI.
const TASK = '先检索模型路由相关论文，再实现 TypeScript 路由代码并运行测试，最后汇总结果。'
const route = (model = 'modelA', changes = {}) => ({ provider: 'fixture', model, quality: 0.9,
  execution: 'api', subscription: 'none', inputModalities: ['text', 'image'],
  reasoningKnown: true, reasoningEfforts: ['low', 'high'],
  pricing: { input: model === 'modelA' ? 1 : 5, output: model === 'modelA' ? 20 : 50, currency: 'USD' }, ...changes })
const ROUTES = [route(), route('modelB')]
const plan = (task = TASK, routes = ROUTES, options = {}) => createPlanFromRoutes(task, routes, { mode: 'team', ...options })
function bindings(value, target = { kind: 'api', provider: 'fixture', model: 'modelB' }) {
  return Object.fromEntries(value.team.workPackages.map(item => [item.id, { ...target }]))
}
function project(value, assignments = bindings(value), options = {}) {
  return applyManualPackagePlan(value, { task: TASK, packageAssignments: assignments,
    packagePlanKey: packagePlanKey(value, TASK), ...options }, options.routes ?? ROUTES, options.dataOptions ?? {})
}
const structure = value => value.team.workPackages.map(item => ({ id: item.id, name: item.name,
  objective: item.objective, type: item.type, purpose: item.purpose, dependsOn: item.dependsOn }))

test('manual projection keeps decomposition and dependencies, without mutating its inputs', () => {
  const initial = plan(), before = structuredClone(initial), map = bindings(initial), mapBefore = structuredClone(map)
  assert.ok(initial.team.workPackages.length > 1)
  const result = project(initial, map)
  assert.deepEqual(structure(result), structure(initial))
  assert.deepEqual(initial, before)
  assert.deepEqual(map, mapBefore)
  assert.equal(result.assignmentMode, 'manual')
  assert.deepEqual(result.manualAssignments, map)
  for (let index = 0; index < result.team.workPackages.length; index++) {
    const pkg = result.team.workPackages[index], old = initial.team.workPackages[index]
    assert.equal(pkg.recommendedProvider, 'fixture')
    assert.equal(pkg.recommendedModel, 'modelB')
    assert.equal(result.subtasks[index].recommended, 'modelB')
    assert.equal(pkg.executionChannel, 'harness-llm')
    assert.deepEqual(pkg.algorithmRecommendation, { provider: old.recommendedProvider,
      model: old.recommendedModel, channel: old.executionChannel })
    assert.equal(pkg.selectionSource, 'manual')
  }
})

test('package identity ignores route/price changes but binds the original task and decomposition', () => {
  const initial = plan()
  const repriced = plan(TASK, [route('modelB', { pricing: { input: 100, output: 100, currency: 'USD' } })])
  assert.equal(packagePlanKey(initial, TASK), packagePlanKey(repriced, TASK))
  assert.notEqual(packagePlanKey(initial, TASK), packagePlanKey(initial, `${TASK} extra`))
  const changed = structuredClone(initial)
  changed.team.workPackages[0].dependsOn.push('changed')
  assert.notEqual(packagePlanKey(initial, TASK), packagePlanKey(changed, TASK))
  assert.throws(() => project(changed, bindings(changed), { packagePlanKey: packagePlanKey(initial, TASK) }), /变化/)
})

test('missing or stale package key and missing assignment map fail closed', () => {
  const initial = plan()
  for (const key of [undefined, '', 'stale']) assert.throws(() => project(initial, bindings(initial), { packagePlanKey: key }), /变化/)
  assert.throws(() => applyManualPackagePlan(initial, { task: TASK, packagePlanKey: packagePlanKey(initial, TASK) }, ROUTES), /全部工作包/)
})

test('all packages must be covered exactly once with no extra package ids', () => {
  const initial = plan(), missing = bindings(initial), extra = bindings(initial)
  delete missing[initial.team.workPackages[0].id]
  extra.extra = { kind: 'tool', toolId: 'codex' }
  assert.throws(() => project(initial, missing), /全部工作包/)
  assert.throws(() => project(initial, extra), /全部工作包/)
  const duplicate = structuredClone(initial)
  duplicate.team.workPackages[1].id = duplicate.team.workPackages[0].id
  assert.throws(() => project(duplicate, bindings(duplicate)), /重复/)
})

test('direct and empty plans cannot be converted into manual work package plans', () => {
  const initial = plan()
  for (const bad of [{ ...initial, mode: 'direct' }, { ...initial, routingBypassed: true },
    { ...initial, team: { workPackages: [] } }]) {
    assert.throws(() => project(bad, bindings(initial)), /工作包计划/)
  }
})

test('API identity is an exact unique catalog match and targets have strict fields', () => {
  const initial = plan()
  assert.throws(() => project(initial, bindings(initial, { kind: 'api', provider: 'missing', model: 'modelB' })), /目录/)
  assert.throws(() => project(initial, bindings(initial), { routes: [...ROUTES, route('modelB')] }), /目录/)
  assert.throws(() => project(initial, bindings(initial, { kind: 'tool', toolId: 'not-a-tool' })), /tool/i)
  assert.throws(() => project(initial, bindings(initial, { kind: 'api', provider: 'fixture', model: 'modelB', command: 'bad' })), /fields/)
})

test('subscription-only, direct plan-key, and reverse plan-key API associations are rejected', () => {
  const initial = plan(), map = bindings(initial)
  const catalogs = [
    [route('modelB', { billing: 'subscription-only' })],
    [route('modelB', { subscription: 'plan-key', billing: 'api-only', apiRoute: { provider: 'other', model: 'other' } })],
    [route('modelB'), { provider: 'coding-plan', model: 'plan', subscription: 'plan-key',
      billing: 'subscription-first', apiRoute: { provider: 'fixture', model: 'modelB' } }],
  ]
  for (const routes of catalogs) assert.throws(() => project(initial, map, { routes }), /订阅/)
})

test('explicit API choice may select an API behind a CLI-login subscription-first profile', () => {
  const initial = plan(), target = { kind: 'api', provider: 'openai', model: 'fixture' }
  const routes = [{ ...route('fixture'), provider: 'openai', subscription: 'cli-login', billing: 'subscription-first' }]
  const result = project(initial, bindings(initial, target), { routes })
  assert.ok(result.team.workPackages.every(item => item.executionChannel === 'harness-llm'))
})

test('manual API prices are recomputed per unchanged package using adapter default effort', () => {
  const initial = plan(), customPricing = { 'fixture/modelB': { input: 7, output: 9, currency: 'USD' } }
  const result = project(initial, bindings(initial), { dataOptions: { pricing: customPricing } })
  const expected = initial.team.workPackages.map(item => estimateAssignedPackage(ROUTES[1], item, TASK,
    initial.complexity.band, { pricing: customPricing }))
  assert.deepEqual(result.costBreakdown.map(item => item.estimatedCost), expected.map(item => item.estimatedCost))
  assert.equal(result.estimatedCost, expected.reduce((sum, item) => sum + item.estimatedCost, 0))
  assert.equal(result.selected.estimatedCost, expected[0].estimatedCost)
  assert.equal(result.synthesizer.model, 'modelB')
  assert.equal(result.optimization.pricingComplete, true)
})

test('manual estimates preserve empirical resource data options for the chosen package', () => {
  const initial = plan()
  const result = project(initial, bindings(initial), { dataOptions: { cacheReadRatio: 0.4, cacheWriteRatio: 0.1 } })
  assert.ok(result.costBreakdown.every(item => item.cacheReadTokens > 0 && item.cacheWriteTokens > 0))
  assert.ok(result.costBreakdown.every(item => item.quality === null && item.qualitySource === 'manual-selection'))
})

test('official tools use vendor default identity and unknown price/quality, without stale model estimates', () => {
  const initial = plan(), map = bindings(initial)
  map[initial.team.workPackages[1].id] = { kind: 'tool', toolId: 'codex' }
  const result = project(initial, map), pkg = result.team.workPackages[1], cost = result.costBreakdown[1]
  assert.equal(pkg.recommendedProvider, 'official-tool')
  assert.equal(pkg.recommendedModel, 'codex')
  assert.equal(pkg.channelTool, 'codex')
  assert.equal(pkg.executionChannel, 'official-cli')
  assert.match(pkg.channelDetail, /默认模型/)
  assert.equal(cost.estimatedCost, null)
  assert.equal(cost.quality, null)
  assert.equal(cost.pricingSource, 'unknown')
  assert.equal('inputTokens' in cost, false)
  assert.equal(result.estimatedCost, null)
  assert.equal(result.optimization.budgetFeasible, null)
  assert.equal(result.optimization.qualityEvidenceComplete, false)
})

test('manual API with no current price remains unknown rather than carrying the original cost', () => {
  const initial = plan(), routes = [route('modelB', { pricing: undefined })]
  const result = project(initial, bindings(initial), { routes })
  assert.equal(result.estimatedCost, null)
  assert.ok(result.costBreakdown.every(item => item.estimatedCost === null))
})

test('no old algorithm reasoning choice survives on manual allocation surfaces', () => {
  const initial = plan()
  for (const item of [initial, initial.selected, initial.synthesizer, ...initial.subtasks,
    ...initial.team.workPackages, ...initial.costBreakdown]) {
    Object.assign(item, { recommendedReasoningEffort: 'high', preferredReasoningEffort: 'high',
      reasoningEffort: 'high', plannedReasoningEffort: 'high', reasoningFit: 1,
      channelTool: 'claude-code', channelLabel: 'old', loginRequired: true })
  }
  const result = project(initial)
  for (const item of [result, result.selected, result.synthesizer, ...result.subtasks,
    ...result.team.workPackages, ...result.costBreakdown]) {
    for (const field of ['recommendedReasoningEffort', 'preferredReasoningEffort', 'reasoningEffort', 'plannedReasoningEffort', 'reasoningFit', 'channelTool', 'loginRequired']) {
      assert.equal(field in item, false, field)
    }
  }
  assert.equal(result.optimization.jointEffortCandidates, 0)
})

test('manual target is retained when its new estimate exceeds budget', () => {
  const initial = plan(TASK, ROUTES, { budgetUsd: 0.00000001 })
  const result = project(initial)
  assert.equal(result.optimization.budgetExceeded, true)
  assert.equal(result.optimization.budgetFeasible, false)
  assert.ok(result.team.workPackages.every(item => item.recommendedModel === 'modelB'))
  assert.equal(result.optimization.search, null)
  assert.equal(result.optimization.estimatedSavings, null)
  assert.equal(result.optimization.minimumFeasibleCost, null)
})

test('vision package rejects known text-only API; other packages may use text-only API in mixed plan', () => {
  const task = '先分析图片，再写总结', initial = plan(task)
  const textRoute = route('text-only', { inputModalities: ['text'] }), routes = [...ROUTES, textRoute]
  const allText = bindings(initial, { kind: 'api', provider: 'fixture', model: 'text-only' })
  const options = { task, packagePlanKey: packagePlanKey(initial, task), routes }
  assert.throws(() => project(initial, allText, options), /图像/)
  const map = bindings(initial, { kind: 'api', provider: 'fixture', model: 'text-only' })
  for (const item of initial.team.workPackages) if (item.type === 'vision') map[item.id] = { kind: 'tool', toolId: 'codex' }
  const result = project(initial, map, options)
  assert.deepEqual(structure(result), structure(initial))
  assert.ok(result.team.workPackages.filter(item => item.type !== 'vision').every(item => item.recommendedModel === 'text-only'))
})
