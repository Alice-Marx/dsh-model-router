/**
 * Deterministic assignment over retained candidate actions, not actual answer quality.
 * Small spaces enumerate exactly; larger spaces use safe boundary-state dominance
 * and future-aware bounded frontier retention without a global optimality claim.
 */
const EPSILON = 1e-12
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0

const choiceSignature = option => {
  if (option.actionId === undefined && option.effort === undefined && option.reasoningEffort === undefined) return option.route
  return JSON.stringify([option.actionId ?? option.route, option.effort ?? option.reasoningEffort ?? null])
}

const signature = state => JSON.stringify(state.choices.map(choiceSignature))

const compareQuality = (left, right) =>
  left.relaxedCount - right.relaxedCount || left.qualityShortfall - right.qualityShortfall

function compareStates(left, right, minimizeCost = false) {
  return left.relaxedCount - right.relaxedCount
    || left.qualityShortfall - right.qualityShortfall
    || (minimizeCost ? left.cost - right.cost : right.score - left.score)
    || (minimizeCost ? right.score - left.score : left.cost - right.cost)
    || left.switches - right.switches
    || compareText(signature(left), signature(right))
}

// Safe DP dominance for states with the same future dependency boundary.
// Quality is lexicographic and always precedes cost/score in compareStates.
// Cost/score are Pareto compared, then switches and the deterministic signature
// break exact ties. Comparisons are strict; no epsilon is used here.
const dominates = (left, right) => {
  if (left.cost > right.cost) return false
  const quality = compareQuality(left, right)
  if (quality < 0) return true
  if (quality > 0) return false
  if (left.score > right.score) return true
  if (left.score < right.score) return false
  if (left.cost < right.cost) return true
  if (left.cost > right.cost) return false
  if (left.switches !== right.switches) return left.switches < right.switches
  return compareText(signature(left), signature(right)) < 0
}

const dominanceOrder = (left, right) =>
  left.cost - right.cost
  || compareQuality(left, right)
  || right.score - left.score
  || left.switches - right.switches
  || compareText(signature(left), signature(right))

export function solveCandidateAssignments({ tasks = [], pools = [], budget = Infinity, beamWidth = 256, exactLimit = 4096, handoffPenalty = 0.015, minimizeCost = false } = {}) {
  if (!tasks.length || tasks.length !== pools.length) return null
  const taskCount = tasks.length
  const taskIndexById = new Map()
  const preceding = new Set()
  for (let index = 0; index < taskCount; index++) {
    const task = tasks[index]
    if (!task || !task.id || preceding.has(task.id) || (task.dependsOn ?? []).some(id => !preceding.has(id))) {
      throw new RangeError('Assignment tasks must have unique ids and known dependencies in topological order')
    }
    preceding.add(task.id)
    taskIndexById.set(task.id, index)
  }

  const constrained = Number.isFinite(budget)
  const options = pools.map(pool => (Array.isArray(pool) ? pool : []).filter(option =>
    option && Number.isFinite(option.cost) && option.cost >= 0 && Number.isFinite(option.score)
    && (!constrained || option.pricingKnown === true)))
  if (options.some(pool => pool.length === 0)) return null

  const handoffRoutes = options.map(pool => pool.map(option => option.handoffRoute ?? option.route))
  const maximumScores = options.map(pool => pool.reduce((best, option) => Math.max(best, option.score), -Infinity))
  const dependencyIndexes = tasks.map(task => (task.dependsOn ?? []).map(id => taskIndexById.get(id)))
  const lastUse = new Array(taskCount).fill(-1)
  for (let index = 0; index < taskCount; index++) {
    for (const depIndex of dependencyIndexes[index]) {
      if (index > lastUse[depIndex]) lastUse[depIndex] = index
    }
  }

  const suffixMinimum = new Array(taskCount + 1).fill(0)
  const futureRelaxedLower = new Array(taskCount + 1).fill(0)
  const futureShortfallLower = new Array(taskCount + 1).fill(0)
  let searchSpace = 1
  let searchSpaceCapped = false
  for (let index = taskCount - 1; index >= 0; index--) {
    let minCost = Infinity
    let minRelaxedFlag = 1
    let minShortfallAtFlag = Infinity
    for (const option of options[index]) {
      if (option.cost < minCost) minCost = option.cost
      const shortfall = Math.max(0, Number(option.qualityShortfall) || 0)
      const relaxedFlag = shortfall > 0 ? 1 : 0
      if (relaxedFlag < minRelaxedFlag || (relaxedFlag === minRelaxedFlag && shortfall < minShortfallAtFlag)) {
        minRelaxedFlag = relaxedFlag
        minShortfallAtFlag = shortfall
      }
    }
    suffixMinimum[index] = suffixMinimum[index + 1] + minCost
    futureRelaxedLower[index] = futureRelaxedLower[index + 1] + minRelaxedFlag
    futureShortfallLower[index] = futureShortfallLower[index + 1] + minShortfallAtFlag
    const product = searchSpace * options[index].length
    if (product > Number.MAX_SAFE_INTEGER) searchSpaceCapped = true
    searchSpace = Math.min(Number.MAX_SAFE_INTEGER, product)
  }

  if (constrained && suffixMinimum[0] > budget + EPSILON) return null
  const parsedExactLimit = Number(exactLimit)
  const exactThreshold = Number.isFinite(parsedExactLimit)
    ? Math.max(1, parsedExactLimit)
    : exactLimit === Infinity ? Number.MAX_SAFE_INTEGER : 4096
  const parsedBeamWidth = Number(beamWidth)
  const width = Number.isFinite(parsedBeamWidth) ? Math.max(1, Math.floor(parsedBeamWidth) || 256) : 256
  const exact = !searchSpaceCapped && searchSpace <= exactThreshold

  const search = {
    method: exact ? 'exact' : 'beam',
    exact,
    strategy: exact ? 'exact-enumeration' : 'boundary-frontier-lookahead',
    searchSpace,
    searchSpaceCapped,
    expandedStates: 0,
    beamPruned: 0,
    dominancePruned: 0,
    peakFrontier: 0,
    retainedStates: 0,
    beamWidth: width,
    approximate: !exact,
    optimalityScope: 'retained input candidate Cartesian space',
    boundCertified: exact
  }

  // Negative handoff penalties historically increase score for mismatches, so an
  // optimistic lookahead must include the maximum possible unassigned reward.
  const unassignedReward = handoffPenalty < 0 ? -handoffPenalty : 0
  let states = [{ choices: [], routesByTask: new Map(), score: 0, cost: 0, switches: 0, relaxedCount: 0, qualityShortfall: 0 }]

  for (let index = 0; index < taskCount; index++) {
    const expanded = []
    for (const state of states) {
      for (let optionIndex = 0; optionIndex < options[index].length; optionIndex++) {
        const option = options[index][optionIndex]
        const cost = state.cost + option.cost
        if (constrained && cost + suffixMinimum[index + 1] > budget + EPSILON) continue
        let switches = 0
        for (const depIndex of dependencyIndexes[index]) {
          const route = state.routesByTask.get(tasks[depIndex].id)
          if (route !== undefined && route !== handoffRoutes[index][optionIndex]) switches++
        }
        const penalty = switches * handoffPenalty
        const shortfall = Math.max(0, Number(option.qualityShortfall) || 0)
        const routesByTask = new Map(state.routesByTask)
        routesByTask.set(tasks[index].id, handoffRoutes[index][optionIndex])
        expanded.push({
          choices: [...state.choices, { ...option, handoffPenalty: penalty }],
          routesByTask,
          score: state.score + option.score - penalty,
          cost,
          switches: state.switches + switches,
          relaxedCount: state.relaxedCount + (shortfall > 0 ? 1 : 0),
          qualityShortfall: state.qualityShortfall + shortfall
        })
        search.expandedStates++
      }
    }
    if (!expanded.length) return null

    if (exact) {
      expanded.sort((left, right) => compareStates(left, right, minimizeCost))
      states = expanded
    } else {
      // Group by the only information future transitions can observe: handoff
      // routes of already assigned tasks that still have a future dependent.
      const groups = new Map()
      for (const state of expanded) {
        const boundary = []
        for (let prev = 0; prev <= index; prev++) {
          if (lastUse[prev] > index) boundary.push([tasks[prev].id, state.routesByTask.get(tasks[prev].id)])
        }
        const key = JSON.stringify(boundary)
        const group = groups.get(key)
        if (group) group.push(state)
        else groups.set(key, [state])
      }

      const compressed = []
      for (const group of groups.values()) {
        group.sort(dominanceOrder)
        const retained = []
        for (const candidate of group) {
          let dominated = false
          for (const keeper of retained) {
            if (dominates(keeper, candidate)) {
              dominated = true
              break
            }
          }
          if (dominated) search.dominancePruned++
          else retained.push(candidate)
        }
        for (const state of retained) compressed.push(state)
      }

      const scoreUpperCache = new Map()
      const optimisticScore = state => {
        if (scoreUpperCache.has(state)) return scoreUpperCache.get(state)
        let total = state.score
        for (let future = index + 1; future < taskCount; future++) {
          const deps = dependencyIndexes[future]
          let unassignedDeps = 0
          let assignedCount = 0
          const assignedRoutes = new Map()
          for (const depIndex of deps) {
            if (depIndex > index) unassignedDeps++
            else {
              const route = state.routesByTask.get(tasks[depIndex].id)
              if (route !== undefined) {
                assignedCount++
                assignedRoutes.set(route, (assignedRoutes.get(route) ?? 0) + 1)
              }
            }
          }
          // Count predecessor routes once, rather than rescanning every edge
          // for every future action. Independent future tasks need no scan.
          if (!assignedCount || handoffPenalty === 0) {
            total += maximumScores[future] + unassignedReward * unassignedDeps
            continue
          }
          let best = -Infinity
          for (let optionIndex = 0; optionIndex < options[future].length; optionIndex++) {
            const option = options[future][optionIndex]
            const matches = assignedRoutes.get(handoffRoutes[future][optionIndex]) ?? 0
            let value = option.score - handoffPenalty * (assignedCount - matches)
            if (unassignedDeps && unassignedReward) value += unassignedReward * unassignedDeps
            if (value > best) best = value
          }
          total += best
        }
        scoreUpperCache.set(state, total)
        return total
      }

      // Lookahead is a sorting heuristic only. Future quality is a per-task lower
      // bound and ignores future handoff interactions, so it cannot certify optimality.
      compressed.sort((left, right) => {
        const leftRelaxed = left.relaxedCount + futureRelaxedLower[index + 1]
        const rightRelaxed = right.relaxedCount + futureRelaxedLower[index + 1]
        if (leftRelaxed !== rightRelaxed) return leftRelaxed - rightRelaxed
        const leftShortfall = left.qualityShortfall + futureShortfallLower[index + 1]
        const rightShortfall = right.qualityShortfall + futureShortfallLower[index + 1]
        if (leftShortfall !== rightShortfall) return leftShortfall - rightShortfall
        const leftScore = optimisticScore(left)
        const rightScore = optimisticScore(right)
        const leftCost = left.cost + suffixMinimum[index + 1]
        const rightCost = right.cost + suffixMinimum[index + 1]
        if (minimizeCost) {
          if (leftCost !== rightCost) return leftCost - rightCost
          if (leftScore !== rightScore) return rightScore - leftScore
        } else {
          if (leftScore !== rightScore) return rightScore - leftScore
          if (leftCost !== rightCost) return leftCost - rightCost
        }
        return compareStates(left, right, minimizeCost)
      })

      if (compressed.length > width) {
        states = compressed.slice(0, width)
        search.beamPruned += compressed.length - states.length
        if (constrained && index < taskCount - 1) {
          let cheapest = compressed[0]
          for (const state of compressed) if (compareStates(state, cheapest, true) < 0) cheapest = state
          if (!states.includes(cheapest)) states[width - 1] = cheapest
        }
      } else states = compressed
    }

    if (states.length > search.peakFrontier) search.peakFrontier = states.length
  }

  states.sort((left, right) => compareStates(left, right, minimizeCost))
  search.retainedStates = states.length
  const best = states[0]
  const { routesByTask, ...result } = best
  return { ...result, minimumCostLowerBound: suffixMinimum[0], search }
}
