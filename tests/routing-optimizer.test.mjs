import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan } from '../.dsh-plugin/shared/router.mjs'
import { solveCandidateAssignments } from '../.dsh-plugin/shared/assignment-solver.mjs'
import { normalizeLiveBenchPayload } from '../.dsh-plugin/shared/livebench.mjs'

const architecture = '请设计一个复杂工程架构并实现代码'

test('normalized category averages and legacy category snapshots do not imply cross-task evidence', () => {
  const normalized = normalizeLiveBenchPayload({ models: [{ model: 'Bench Only', code: 98 }] }, 1)
  assert.equal(normalized.models.benchonly.overallSource, 'derived')
  assert.equal(normalized.models.benchonly.overall, 0.98)
  for (const liveBench of [normalized, { models: { benchonly: { overall: 0.98, scores: { code: 0.98 } } } }]) {
    const plan = buildPlan({ text: architecture, available: [{ provider: 'p', model: 'Bench Only', pricing: { input: 1, output: 1 } }], liveBench })
    assert.equal(plan.subtasks.find(task => task.type === 'code').qualitySource, 'livebench')
    assert.equal(plan.subtasks.find(task => task.type === 'reasoning').qualitySource, 'unknown')
    assert.equal(plan.optimization.qualityEvidenceComplete, false)
    assert.equal(plan.optimization.estimatedSavings, null)
  }
  assert.equal(normalizeLiveBenchPayload({ models: [{ model: 'm', overall: 90, code: 98 }] }).models.m.overallSource, 'explicit')
  assert.deepEqual(normalizeLiveBenchPayload({ models: [{ model: 'm', overall: '', code: '' }] }).models, {})
})

test('a savings baseline excludes an image-ineligible text-only route', () => {
  const plan = buildPlan({ text: '请分析图片中的内容', available: [
    { provider: 'p', model: 'Text Only', quality: 0.99, inputModalities: ['text'], pricing: { input: 100, output: 100 } },
    { provider: 'p', model: 'Vision', quality: 0.9, inputModalities: ['text', 'image'], pricing: { input: 1, output: 1 } },
  ] })
  assert.equal(plan.selected.model, 'Vision')
  assert.equal(plan.optimization.baselineAllStrongCost, plan.estimatedCost)
  assert.equal(plan.optimization.estimatedSavings, 0)
})

test('budget gates use unrounded totals rather than rounded display line items', () => {
  const budgetUsd = 0.0009967
  const plan = buildPlan({ text: '请简要解释缓存', budgetUsd,
    available: [{ provider: 'p', model: 'm', quality: 0.9, pricing: { input: 1.0006, output: 1.0006 } }] })
  assert.equal(plan.costBreakdown[0].estimatedCost, 0.000997)
  assert.ok(plan.estimatedCost < budgetUsd)
  assert.equal(plan.optimization.budgetFeasible, true)
  assert.equal(plan.optimization.budgetExceeded, false)
})

test('task-specific benchmark evidence does not become evidence for an unrelated stage', () => {
  const plan = buildPlan({ text: architecture, available: [{ provider: 'p', model: 'm', pricing: { input: 1, output: 1 } }],
    liveBench: { models: { m: { scores: { code: 0.9 } } } } })
  assert.equal(plan.subtasks[0].type, 'reasoning')
  assert.equal(plan.subtasks[0].qualitySource, 'unknown')
  assert.equal(plan.costBreakdown[0].quality, null)
  assert.equal(plan.optimization.qualityEvidenceComplete, false)
  assert.equal(plan.optimization.estimatedSavings, null)
})

test('solver rejects non-topological or unknown dependencies rather than ignoring them', () => {
  const pools = [[option('A', 1, 1)], [option('B', 1, 1)]]
  assert.throws(() => solveCandidateAssignments({ tasks: [{ id: 'a', dependsOn: ['b'] }, { id: 'b' }], pools }), /topological/)
  assert.throws(() => solveCandidateAssignments({ tasks: [{ id: 'a' }, { id: 'a' }], pools }), /unique/)
})

test('missing price evidence is not sufficient for a finite budget', () => {
  assert.equal(solveCandidateAssignments({ tasks: [{ id: 'a' }], pools: [[{ route: 'A', score: 1, cost: 0 }]], budget: 1 }), null)
})

test('beam final layer keeps its best complete solution instead of its cost anchor', () => {
  const tasks = [{ id: 'a' }, { id: 'b' }]
  const pools = tasks.map(() => [option('A', 1, 2), option('B', 0, 1)])
  const unconstrained = solveCandidateAssignments({ tasks, pools, beamWidth: 1, exactLimit: 1 })
  assert.deepEqual(unconstrained.choices.map(item => item.route), ['A', 'A'])
  const constrained = solveCandidateAssignments({ tasks, pools, beamWidth: 1, exactLimit: 1, budget: 10 })
  assert.equal(constrained.choices.at(-1).route, 'A')
})

function crowdedRoutes() {
  return [
    ...Array.from({ length: 12 }, (_, index) => ({
      provider: 'p', model: `High-${index}`,
      quality: 0.98 + index * 0.001, latency: 0.01 + index * 0.001,
      risk: 0, specialties: ['code', 'reasoning'],
      pricing: { input: 1, output: 1 },
    })),
    {
      provider: 'p', model: 'Cheap', quality: 0.85, latency: 1,
      risk: 1, specialties: [], pricing: { input: 0.01, output: 0.01 },
    },
  ]
}

function handoffOptions() {
  return {
    text: architecture,
    available: [
      { provider: 'p', model: 'A', quality: 0.9, latency: 0.5, risk: 0.2, pricing: { input: 0.999, output: 0.999 }, specialties: ['reasoning', 'code'] },
      { provider: 'p', model: 'B', quality: 0.9, latency: 0.5, risk: 0.2, pricing: { input: 1, output: 1 }, specialties: ['reasoning', 'code'] },
    ],
    liveBench: {
      source: 'test-fixture', fetchedAt: 1,
      models: {
        a: { scores: { reasoning: 0.77, code: 0.9001 }, overall: 0.9 },
        b: { scores: { reasoning: 0.9, code: 0.9 }, overall: 0.9 },
      },
    },
  }
}

test('a cheap quality-feasible route survives a pool containing twelve higher-utility routes', () => {
  const available = crowdedRoutes()
  const reference = buildPlan({ text: architecture, available: available.slice(-1), budgetUsd: 0.001 })
  assert.equal(reference.optimization.budgetFeasible, true)

  const plan = buildPlan({ text: architecture, available, budgetUsd: 0.001 })
  assert.equal(plan.optimization.budgetFeasible, true)
  assert.equal(plan.optimization.budgetExceeded, false)
  assert.equal(plan.optimization.constraintRelaxed, false)
  assert.ok(plan.estimatedCost <= 0.001)
  assert.ok(plan.optimization.minimumFeasibleCost <= reference.estimatedCost + 0.000002)
})

test('local dominance cannot discard a route that avoids dependency handoffs', () => {
  const plan = buildPlan(handoffOptions())
  assert.deepEqual(plan.subtasks.map(item => item.recommended), ['B', 'B', 'B'])
  assert.equal(plan.optimization.handoffCount, 0)
  assert.equal(plan.optimization.constraintRelaxed, false)
})

test('configured-route input order does not change assignments or budget feasibility', () => {
  for (const options of [
    { text: architecture, available: crowdedRoutes(), budgetUsd: 0.001 },
    handoffOptions(),
  ]) {
    const project = plan => ({
      selected: plan.selected,
      subtasks: plan.subtasks,
      costBreakdown: plan.costBreakdown,
      estimatedCost: plan.estimatedCost,
      optimization: plan.optimization,
    })
    const expected = project(buildPlan(options))
    for (const available of [options.available.toReversed(), [...options.available.slice(1), options.available[0]]]) {
      assert.deepEqual(project(buildPlan({ ...options, available })), expected)
    }
  }
})

test('adding an extremely expensive dominated route cannot rescale the existing routes', () => {
  const text = '请简要解释缓存'
  const available = [
    { provider: 'p', model: 'Cheap', quality: 0.8, latency: 0.5, risk: 0.2, pricing: { input: 0.1, output: 0.2 } },
    { provider: 'p', model: 'Expensive', quality: 0.9, latency: 0.5, risk: 0.2, pricing: { input: 1, output: 2 } },
  ]
  const before = buildPlan({ text, available })
  const after = buildPlan({ text, available: [...available, {
    provider: 'p', model: 'Dominated', quality: 0.75, latency: 1,
    risk: 1, pricing: { input: 10000, output: 10000 },
  }] })
  assert.equal(before.selected.model, 'Cheap')
  assert.equal(after.selected.model, 'Cheap')
  assert.deepEqual(after.selected, before.selected)
  for (const model of ['Cheap', 'Expensive']) {
    assert.equal(after.candidates.find(item => item.model === model).score,
      before.candidates.find(item => item.model === model).score)
  }
})

test('an unknown model receives a quality bias once without inventing quality evidence', () => {
  const route = { provider: 'p', model: 'Unlisted Model', pricing: { input: 0.1, output: 0.2 } }
  const options = { text: '请简要解释缓存' }
  const biased = buildPlan({ ...options, available: [{ ...route, qualityBias: 0.05 }] })
  const reference = buildPlan({ ...options, available: [{ ...route, quality: 0.05 }] })
  assert.equal(biased.candidates[0].score, reference.candidates[0].score)
  assert.equal(biased.candidates[0].quality, null)
  assert.equal(biased.candidates[0].qualitySource, 'unknown')
  assert.equal(biased.optimization.qualityEvidenceComplete, false)
  assert.equal(biased.optimization.constraintRelaxed, true)
})

function option(route, score, cost, qualityShortfall = 0, pricingKnown = true) {
  return { route, score, cost, qualityShortfall, pricingKnown, payload: { route } }
}

// Enumerate complete assignments without sharing the production solver's
// pruning, bounds, frontier construction, or partial-state comparison.
function enumerateAssignments(tasks, pools, budget = Infinity, handoffPenalty = 0.015) {
  const complete = []
  const visit = (index, choices) => {
    if (index < tasks.length) {
      for (const candidate of pools[index]) visit(index + 1, [...choices, candidate])
      return
    }
    if (Number.isFinite(budget) && choices.some(item => !item.pricingKnown)) return
    const cost = choices.reduce((sum, item) => sum + item.cost, 0)
    if (cost > budget + 1e-12) return
    const routes = new Map(tasks.map((task, i) => [task.id, choices[i].route]))
    const switches = tasks.reduce((sum, task, i) => sum + (task.dependsOn ?? [])
      .filter(dependency => routes.has(dependency) && routes.get(dependency) !== choices[i].route).length, 0)
    complete.push({
      choices, cost, switches,
      score: choices.reduce((sum, item) => sum + item.score, 0) - switches * handoffPenalty,
      relaxedCount: choices.filter(item => item.qualityShortfall > 0).length,
      qualityShortfall: choices.reduce((sum, item) => sum + item.qualityShortfall, 0),
    })
  }
  visit(0, [])
  complete.sort((left, right) => left.relaxedCount - right.relaxedCount
    || left.qualityShortfall - right.qualityShortfall
    || right.score - left.score || left.cost - right.cost || left.switches - right.switches)
  return complete[0] ?? null
}

function assertMatchesOracle(actual, expected) {
  if (expected === null) {
    assert.equal(actual, null)
    return
  }
  assert.ok(actual)
  assert.ok(Math.abs(actual.score - expected.score) < 1e-10, `score ${actual.score} versus ${expected.score}`)
  assert.ok(Math.abs(actual.cost - expected.cost) < 1e-10, `cost ${actual.cost} versus ${expected.cost}`)
  assert.equal(actual.switches, expected.switches)
  assert.equal(actual.relaxedCount, expected.relaxedCount)
  assert.ok(Math.abs(actual.qualityShortfall - expected.qualityShortfall) < 1e-10)
}

test('small candidate spaces match an independent exhaustive oracle under several budgets', () => {
  let seed = 1701
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let fixture = 0; fixture < 16; fixture += 1) {
    const tasks = Array.from({ length: 4 }, (_, index) => ({
      id: `t${index}`,
      dependsOn: index === 0 ? [] : index === 3 ? ['t0', 't1', 't2'] : [`t${index - 1}`],
    }))
    const pools = tasks.map(() => Array.from({ length: 3 }, (_, index) => option(
      `r${index}`, 0.45 + random() * 0.2, 0.001 + Math.floor(random() * 5) * 0.001,
      fixture % 3 === 0 && index === 0 ? 0.02 : 0,
    )))
    for (const budget of [Infinity, 0.012, 0.006, 0.0001]) {
      const actual = solveCandidateAssignments({ tasks, pools, budget, exactLimit: 4096, beamWidth: 2 })
      assertMatchesOracle(actual, enumerateAssignments(tasks, pools, budget))
      if (actual !== null) {
        assert.equal(actual.search.exact, true)
        assert.equal(actual.search.method, 'exact')
        assert.ok(actual.cost <= budget + 1e-12)
      }
    }
  }
})

test('exact search retains a lower-score prefix that avoids a forced final-route handoff', () => {
  const tasks = [
    { id: 'x0', dependsOn: [] }, { id: 'x1', dependsOn: [] }, { id: 'x2', dependsOn: [] },
    { id: 'final', dependsOn: ['x0', 'x1', 'x2'] },
  ]
  const pool = [option('B', 0.6, 0.001), ...Array.from({ length: 11 }, (_, index) => option(`A${index}`, 0.601 + index * 0.00001, 0.001))]
  const pools = [pool, pool, pool, [option('B', 0.6, 0.001)]]
  const actual = solveCandidateAssignments({ tasks, pools, exactLimit: 4096, beamWidth: 256 })
  assertMatchesOracle(actual, enumerateAssignments(tasks, pools))
  assert.equal(actual.switches, 0)
  assert.equal(actual.search.exact, true)
  assert.equal(actual.search.searchSpace, 1728)
})

test('beam search keeps a budget-feasible completion in a large candidate space', () => {
  const tasks = Array.from({ length: 7 }, (_, index) => ({ id: `t${index}`, dependsOn: [] }))
  const pools = tasks.map(() => [
    option('premium', 1, 4), option('middle', 0.9, 3), option('small', 0.8, 2), option('cheap', 0.1, 1),
  ])
  const actual = solveCandidateAssignments({ tasks, pools, budget: 9, beamWidth: 1, exactLimit: 32 })
  assert.ok(actual)
  assert.ok(actual.cost <= 9)
  assert.equal(actual.choices.length, tasks.length)
  assert.equal(actual.search.method, 'beam')
  assert.equal(actual.search.exact, false)
  assert.equal(actual.search.searchSpace, 16384)
})

test('an unknown price cannot establish finite-budget feasibility', () => {
  const tasks = [{ id: 'a', dependsOn: [] }]
  const unknown = option('unknown', 1, 0, 0, false)
  const known = option('known', 0.5, 0.002)
  assert.equal(solveCandidateAssignments({ tasks, pools: [[unknown]], budget: 0.001 }), null)
  assert.equal(solveCandidateAssignments({ tasks, pools: [[unknown, known]], budget: 0.001 }), null)
  const affordable = solveCandidateAssignments({ tasks, pools: [[unknown, known]], budget: 0.003 })
  assert.ok(affordable)
  assert.equal(affordable.cost, 0.002)
})
