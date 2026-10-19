import test from 'node:test'
import assert from 'node:assert/strict'
import { solveCandidateAssignments as solve } from '../.dsh-plugin/shared/assignment-solver.mjs'

const option = (route, score, cost = 1, qualityShortfall = 0, extra = {}) =>
  ({ route, score, cost, pricingKnown: true, qualityShortfall, ...extra })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} versus ${expected}`)
const identity = choice => [choice.actionId ?? choice.route, choice.effort ?? choice.reasoningEffort ?? null]
const choices = result => result.choices.map(identity)

// Independent complete-assignment enumeration: no production frontier, bounds,
// partial comparison, or dominance rules are reused by the oracle.
function oracle({ tasks, pools, budget = Infinity, handoffPenalty = 0.015, minimizeCost = false }) {
  const feasible = []
  function visit(index, selected) {
    if (index < tasks.length) {
      for (const item of pools[index]) visit(index + 1, [...selected, item])
      return
    }
    if (Number.isFinite(budget) && selected.some(item => item.pricingKnown !== true)) return
    const cost = selected.reduce((sum, item) => sum + item.cost, 0)
    if (cost > budget + 1e-12) return
    const assigned = new Map(tasks.map((task, i) => [task.id, selected[i].handoffRoute ?? selected[i].route]))
    let switches = 0
    tasks.forEach((task, i) => {
      for (const dependency of task.dependsOn ?? []) {
        if (assigned.get(dependency) !== assigned.get(task.id)) switches++
      }
    })
    feasible.push({ choices: selected, cost, switches,
      score: selected.reduce((sum, item) => sum + item.score, 0) - switches * handoffPenalty,
      relaxedCount: selected.filter(item => item.qualityShortfall > 0).length,
      qualityShortfall: selected.reduce((sum, item) => sum + (item.qualityShortfall || 0), 0),
    })
  }
  visit(0, [])
  feasible.sort((a, b) => a.relaxedCount - b.relaxedCount || a.qualityShortfall - b.qualityShortfall
    || (minimizeCost ? a.cost - b.cost : b.score - a.score)
    || (minimizeCost ? b.score - a.score : a.cost - b.cost) || a.switches - b.switches)
  return feasible[0] ?? null
}

function matches(actual, expected) {
  if (!expected) return assert.equal(actual, null)
  assert.ok(actual)
  for (const field of ['score', 'cost', 'qualityShortfall']) near(actual[field], expected[field])
  assert.equal(actual.relaxedCount, expected.relaxedCount)
  assert.equal(actual.switches, expected.switches)
}

function forcedJoin() {
  const pool = Array.from({ length: 9 }, (_, i) => option(`r${i}`, 1 - i * 0.0001))
  const tasks = [...Array.from({ length: 4 }, (_, i) => ({ id: `x${i}` })),
    { id: 'final', dependsOn: ['x0', 'x1', 'x2', 'x3'] }]
  return { tasks, pools: [pool, pool, pool, pool, [pool[8]]] }
}

test('future-aware width 256 retains the required model in the 6561-action forced join', () => {
  const actual = solve(forcedJoin())
  assert.deepEqual(actual.choices.map(item => item.route), Array(5).fill('r8'))
  near(actual.score, 4.996)
  assert.equal(actual.switches, 0)
  assert.equal(actual.search.searchSpace, 6561)
  assert.equal(actual.search.method, 'beam')
  assert.equal(actual.search.strategy, 'boundary-frontier-lookahead')
  assert.equal(actual.search.boundCertified, false)
  assert.equal(actual.search.approximate, true)
  assert.ok(actual.search.beamPruned > 0)
  assert.ok(actual.search.peakFrontier <= 256)
})

test('boundary state survives every future dependent, including after an earlier use', () => {
  const tasks = [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c' },
    { id: 'd', dependsOn: ['a'] }, { id: 'e', dependsOn: ['a'] }]
  const pools = [[option('A', 1), option('B', 0.99)], [option('A', 0)],
    [option('C', 0)], [option('B', 0)], [option('B', 0)]]
  const request = { tasks, pools, exactLimit: 1 }
  const actual = solve(request)
  matches(actual, oracle(request))
  assert.equal(actual.choices[0].route, 'B')
  assert.equal(actual.switches, 1)
})

test('same-boundary dominance compresses dead prefixes without removing cost/quality tradeoffs', () => {
  const tasks = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}` }))
  const pools = tasks.map(() => [option('strong', 0.9, 3), option('cheap', 0.6, 1),
    option('dominated', 0.5, 2), option('relaxed', 1, 1, 0.02)])
  for (const budget of [Infinity, 7, 5]) for (const minimizeCost of [false, true]) {
    const request = { tasks, pools, budget, minimizeCost, exactLimit: 1, beamWidth: 256 }
    const actual = solve(request)
    matches(actual, oracle(request))
    assert.ok(actual.search.dominancePruned > 0)
    assert.equal(actual.relaxedCount, 0)
  }
})

test('random small DAGs match complete enumeration with budgets, quality relaxation, and both objectives', () => {
  let seed = 1801
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  for (let fixture = 0; fixture < 18; fixture++) {
    const tasks = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`,
      dependsOn: Array.from({ length: i }, (_, j) => `t${j}`).filter(() => random() < 0.5) }))
    const pools = tasks.map(() => Array.from({ length: 3 }, (_, i) => option(`r${i}`,
      random(), 1 + Math.floor(random() * 3), random() < 0.35 ? 0.01 + Math.floor(random() * 3) * 0.01 : 0)))
    for (const budget of [Infinity, 9, 6, 1]) for (const minimizeCost of [false, true]) {
      const request = { tasks, pools, budget, minimizeCost, handoffPenalty: fixture % 4 ? 0.015 : -0.015 }
      const expected = oracle(request)
      matches(solve({ ...request, exactLimit: 1, beamWidth: 256 }), expected)
      const exact = solve({ ...request, exactLimit: 4096, beamWidth: 1 })
      matches(exact, expected)
      if (exact) {
        assert.equal(exact.search.exact, true)
        assert.equal(exact.search.boundCertified, true)
        assert.equal(exact.search.approximate, false)
      }
    }
  }
})

test('pool reordering leaves bounded assignments and effort ties deterministic', () => {
  const fixture = forcedJoin()
  const expected = solve(fixture)
  for (const pools of [fixture.pools.map(pool => pool.toReversed()),
    fixture.pools.map(pool => [...pool.slice(1), pool[0]])]) {
    const actual = solve({ ...fixture, pools })
    assert.deepEqual(choices(actual), choices(expected))
    near(actual.score, expected.score)
  }
  const tasks = [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }]
  const pool = ['high', 'low'].map(effort => option('model', 1, 1, 0, { effort }))
  const first = solve({ tasks, pools: [pool, pool], exactLimit: 1 })
  const reversed = solve({ tasks, pools: [pool.toReversed(), pool.toReversed()], exactLimit: 1 })
  assert.deepEqual(choices(first), choices(reversed))
})

test('effort actions use the underlying model for handoffs', () => {
  const actual = solve({ tasks: [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }], pools: [
    [option('model#low', 0.8, 1, 0, { actionId: 'low', handoffRoute: 'model', effort: 'low' })],
    [option('model#high', 1, 1, 0, { actionId: 'high', handoffRoute: 'model', effort: 'high' })],
  ] })
  near(actual.score, 1.8)
  assert.equal(actual.switches, 0)
  assert.equal(actual.choices[1].handoffPenalty, 0)
})

test('width one preserves a feasible budget prefix and finite budgets reject unknown prices', () => {
  const tasks = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}` }))
  const pools = tasks.map(() => [option('premium', 1, 4), option('cheap', 0.1, 1),
    option('unknown', 2, 0, 0, { pricingKnown: false })])
  const actual = solve({ tasks, pools, budget: 9, beamWidth: 1, exactLimit: 1 })
  assert.ok(actual)
  assert.ok(actual.cost <= 9 + 1e-12)
  assert.equal(actual.choices.length, 7)
  assert.ok(actual.choices.every(item => item.pricingKnown))
  assert.equal(solve({ tasks: [{ id: 'a' }], pools: [[pools[0][2]]], budget: 9 }), null)
})
