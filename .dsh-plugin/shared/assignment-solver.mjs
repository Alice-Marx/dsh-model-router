/**
 * Deterministic budget-constrained DAG assignment, independent of model names.
 * Exact enumeration is bounded by the retained Cartesian candidate space;
 * larger spaces use a beam with a protected least-cost feasible prefix.
 * Optimality concerns this surrogate objective, never actual answer quality.
 */
const EPSILON = 1e-12
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0
const signature = state => JSON.stringify(state.choices.map(option => option.route))

function compareStates(left, right, minimizeCost = false) {
  return left.relaxedCount - right.relaxedCount
    || left.qualityShortfall - right.qualityShortfall
    || (minimizeCost ? left.cost - right.cost : right.score - left.score)
    || (minimizeCost ? right.score - left.score : left.cost - right.cost)
    || left.switches - right.switches
    || compareText(signature(left), signature(right))
}

export function solveCandidateAssignments({ tasks = [], pools = [], budget = Infinity, beamWidth = 256, exactLimit = 4096, handoffPenalty = 0.015, minimizeCost = false } = {}) {
  if (!tasks.length || tasks.length !== pools.length) return null
  const preceding = new Set()
  for (const task of tasks) {
    if (!task.id || preceding.has(task.id) || (task.dependsOn ?? []).some(id => !preceding.has(id))) {
      throw new RangeError('Assignment tasks must have unique ids and known dependencies in topological order')
    }
    preceding.add(task.id)
  }
  const constrained = Number.isFinite(budget)
  const options = pools.map(pool => (Array.isArray(pool) ? pool : []).filter(option =>
    Number.isFinite(option.cost) && option.cost >= 0 && Number.isFinite(option.score)
    && (!constrained || option.pricingKnown === true)))
  if (options.some(pool => pool.length === 0)) return null
  const suffixMinimum = Array(tasks.length + 1).fill(0)
  let searchSpace = 1
  let searchSpaceCapped = false
  for (let index = tasks.length - 1; index >= 0; index--) {
    suffixMinimum[index] = suffixMinimum[index + 1] + Math.min(...options[index].map(option => option.cost))
    const product = searchSpace * options[index].length
    if (product > Number.MAX_SAFE_INTEGER) searchSpaceCapped = true
    searchSpace = Math.min(Number.MAX_SAFE_INTEGER, product)
  }
  if (constrained && suffixMinimum[0] > budget + EPSILON) return null
  const exact = !searchSpaceCapped && searchSpace <= Math.max(1, exactLimit)
  const width = Math.max(1, Math.floor(beamWidth) || 256)
  const search = { method: exact ? 'exact' : 'beam', exact, searchSpace, searchSpaceCapped, expandedStates: 0, beamPruned: 0 }
  let states = [{ choices: [], routesByTask: new Map(), score: 0, cost: 0, switches: 0, relaxedCount: 0, qualityShortfall: 0 }]
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]
    const expanded = []
    for (const state of states) {
      for (const option of options[index]) {
        const cost = state.cost + option.cost
        if (constrained && cost + suffixMinimum[index + 1] > budget + EPSILON) continue
        const switches = (task.dependsOn ?? []).reduce((count, dependency) => {
          const route = state.routesByTask.get(dependency)
          return count + (route !== undefined && route !== option.route ? 1 : 0)
        }, 0)
        const penalty = switches * handoffPenalty
        const shortfall = Math.max(0, Number(option.qualityShortfall) || 0)
        const routesByTask = new Map(state.routesByTask)
        routesByTask.set(task.id, option.route)
        expanded.push({ choices: [...state.choices, { ...option, handoffPenalty: penalty }], routesByTask,
          score: state.score + option.score - penalty, cost, switches: state.switches + switches,
          relaxedCount: state.relaxedCount + (shortfall > 0 ? 1 : 0), qualityShortfall: state.qualityShortfall + shortfall })
        search.expandedStates++
      }
    }
    if (!expanded.length) return null
    expanded.sort((left, right) => compareStates(left, right, minimizeCost))
    if (!exact && expanded.length > width) {
      // A high-utility prefix must not crowd out every affordable completion.
      // This also works at width=1; quality relaxation remains lexicographic.
      states = expanded.slice(0, width)
      if (constrained && index < tasks.length - 1) {
        const cheapest = expanded.reduce((best, state) => compareStates(state, best, true) < 0 ? state : best)
        if (!states.includes(cheapest)) states[width - 1] = cheapest
      }
      search.beamPruned += expanded.length - states.length
    } else states = expanded
  }
  states.sort((left, right) => compareStates(left, right, minimizeCost))
  const best = states[0]
  const { routesByTask, ...result } = best
  return { ...result, minimumCostLowerBound: suffixMinimum[0], search }
}
