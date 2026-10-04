#!/usr/bin/env node
/**
 * Offline search control experiment. Candidate scores and costs are generated
 * numbers, not measured model quality or spending. The complete-assignment
 * oracle deliberately shares no production comparator, bounds, or pruning.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { solveCandidateAssignments } from '../.dsh-plugin/shared/assignment-solver.mjs'

export const DEFAULT_SEARCH_SEED = 20261003
export const DEFAULT_BEAM_WIDTHS = Object.freeze([1, 4, 16, 64, 256])
const EXACT_LIMIT = 4096
const TOLERANCE = 1e-12
const mean = values => values.length ? values.reduce((sum, value) => sum + value / values.length, 0) : null
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null
const rounded = value => Math.round(value * 1e6) / 1e6

function randomSource(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be an unsigned 32-bit integer')
}

function validateInstance(instance) {
  if (!instance || typeof instance.id !== 'string' || !instance.id.length) throw new TypeError('Every instance needs a non-empty id')
  const { tasks, pools } = instance
  if (!Array.isArray(tasks) || !tasks.length || !Array.isArray(pools) || pools.length !== tasks.length) {
    throw new TypeError(`Instance ${instance.id} needs non-empty aligned tasks and pools`)
  }
  const preceding = new Set()
  let combinations = 1
  for (const [index, task] of tasks.entries()) {
    if (!task || typeof task.id !== 'string' || !task.id.length || preceding.has(task.id)
      || !Array.isArray(task.dependsOn ?? []) || (task.dependsOn ?? []).some(id => !preceding.has(id))
      || new Set(task.dependsOn ?? []).size !== (task.dependsOn ?? []).length) {
      throw new RangeError(`Instance ${instance.id} requires a topological DAG with unique task ids and dependency edges`)
    }
    preceding.add(task.id)
    const pool = pools[index]
    if (!Array.isArray(pool) || !pool.length) throw new TypeError(`Instance ${instance.id} needs non-empty candidate pools`)
    const routes = new Set()
    for (const candidate of pool) {
      if (!candidate || typeof candidate.route !== 'string' || !candidate.route.length || routes.has(candidate.route)
        || !Number.isFinite(candidate.score) || !Number.isFinite(candidate.cost) || candidate.cost < 0
        || candidate.pricingKnown !== true || candidate.qualityShortfall !== 0) {
        throw new TypeError(`Instance ${instance.id} candidates require unique routes, finite scores, non-negative costs, known prices, and qualityShortfall=0`)
      }
      routes.add(candidate.route)
    }
    combinations *= pool.length
  }
  if (combinations > EXACT_LIMIT) throw new RangeError(`Instance ${instance.id} exceeds the ${EXACT_LIMIT}-combination control limit`)
  return combinations
}

function generatedBudgets(pools) {
  const minimum = pools.reduce((sum, pool) => sum + Math.min(...pool.map(option => option.cost)), 0)
  const maximum = pools.reduce((sum, pool) => sum + Math.max(...pool.map(option => option.cost)), 0)
  return [
    { mode: 'unconstrained', value: Infinity },
    { mode: 'tight', value: minimum + Math.floor((maximum - minimum) * 0.25) },
    // Zero is feasible for a zero-cost completion; do not mislabel it infeasible.
    ...(minimum > TOLERANCE ? [{ mode: 'infeasible', value: Math.max(0, minimum - 0.5) }] : []),
  ]
}

/** Generate 48 seeded instances by default, plus a named adversarial instance. */
export function generateSearchInstances({ seed = DEFAULT_SEARCH_SEED, instanceCount = 48, includeAdversarial = true } = {}) {
  validateSeed(seed)
  if (!Number.isInteger(instanceCount) || instanceCount < 0 || instanceCount > 1000) {
    throw new RangeError('instanceCount must be an integer from 0 to 1000')
  }
  const random = randomSource(seed)
  const instances = []
  for (let fixture = 0; fixture < instanceCount; fixture++) {
    const taskCount = 3 + fixture % 4
    const candidateCount = 2 + fixture % 3
    const topology = ['chain', 'fan-out-join', 'dense', 'random-dag'][fixture % 4]
    const tasks = Array.from({ length: taskCount }, (_, index) => {
      let dependsOn
      if (topology === 'chain') dependsOn = index ? [`t${index - 1}`] : []
      else if (topology === 'fan-out-join') dependsOn = index === taskCount - 1
        ? Array.from({ length: index }, (_, dependency) => `t${dependency}`)
        : index ? ['t0'] : []
      else if (topology === 'dense') dependsOn = Array.from({ length: index }, (_, dependency) => `t${dependency}`)
      else dependsOn = Array.from({ length: index }, (_, dependency) => dependency)
        .filter(() => random() < 0.5).map(dependency => `t${dependency}`)
      return { id: `t${index}`, dependsOn }
    })
    const pools = tasks.map(() => Array.from({ length: candidateCount }, (_, index) => {
      const cost = 1 + Math.floor(random() * 9)
      const score = fixture % 3 === 0 ? 0.45 + random() * 0.2
        : fixture % 3 === 1 ? 0.48 + cost * 0.025 + random() * 0.02
          : 0.6 + random() * 0.04
      return { route: `R${index}`, score: rounded(score), cost, pricingKnown: true, qualityShortfall: 0 }
    }))
    instances.push({ id: `seeded-${String(fixture).padStart(3, '0')}`, kind: 'seeded', topology, tasks, pools, budgets: generatedBudgets(pools) })
  }
  if (includeAdversarial) {
    const pool = [
      { route: 'B', score: 0.6, cost: 1, pricingKnown: true, qualityShortfall: 0 },
      ...Array.from({ length: 11 }, (_, index) => ({
        route: `A${String(index).padStart(2, '0')}`, score: rounded(0.601 + index * 0.00001), cost: 1,
        pricingKnown: true, qualityShortfall: 0,
      })),
    ]
    const tasks = [
      { id: 'x0', dependsOn: [] }, { id: 'x1', dependsOn: [] }, { id: 'x2', dependsOn: [] },
      { id: 'final', dependsOn: ['x0', 'x1', 'x2'] },
    ]
    const pools = [structuredClone(pool), structuredClone(pool), structuredClone(pool), [structuredClone(pool[0])]]
    instances.push({ id: 'forced-B-final-1728', kind: 'adversarial', topology: 'forced-final-join', tasks, pools, budgets: generatedBudgets(pools) })
  }
  return instances
}

/**
 * Independently enumerate EVERY complete assignment before testing its budget.
 * Only the experiment's qualityShortfall=0 objective is supported: maximum
 * score minus dependency handoffs, then cost, handoff count, and route ID order.
 * No partial-state sorting, suffix bounds, dominance checks, or beam are used.
 */
export function enumerateSearchOracle({ tasks, pools, budget = Infinity, handoffPenalty = 0.015 } = {}) {
  validateInstance({ id: 'oracle', tasks, pools })
  if (!(budget === Infinity || Number.isFinite(budget) && budget >= 0)) throw new RangeError('budget must be non-negative or Infinity')
  if (!Number.isFinite(handoffPenalty) || handoffPenalty < 0) throw new RangeError('handoffPenalty must be finite and non-negative')
  let best = null
  let completeAssignments = 0
  let feasibleAssignments = 0
  let expandedStates = 0
  const choices = Array(tasks.length)
  const enumerate = index => {
    if (index < tasks.length) {
      for (const candidate of pools[index]) {
        choices[index] = candidate
        expandedStates++
        enumerate(index + 1)
      }
      return
    }
    completeAssignments++
    const cost = choices.reduce((sum, candidate) => sum + candidate.cost, 0)
    if (cost > budget + TOLERANCE) return
    feasibleAssignments++
    const routeFor = new Map(tasks.map((task, taskIndex) => [task.id, choices[taskIndex].route]))
    let handoffs = 0
    for (const [taskIndex, task] of tasks.entries()) {
      for (const dependency of task.dependsOn ?? []) {
        if (routeFor.get(dependency) !== choices[taskIndex].route) handoffs++
      }
    }
    const utility = choices.reduce((sum, candidate) => sum + candidate.score, 0) - handoffs * handoffPenalty
    const choiceRoutes = choices.map(candidate => candidate.route)
    const routeOrder = JSON.stringify(choiceRoutes)
    // Compare only completed assignments, written independently of the solver.
    const wins = best === null || utility > best.utility
      || utility === best.utility && (cost < best.cost
        || cost === best.cost && (handoffs < best.handoffs
          || handoffs === best.handoffs && routeOrder < best.routeOrder))
    if (wins) best = { utility, cost, handoffs, choiceRoutes, routeOrder }
  }
  enumerate(0)
  if (best) delete best.routeOrder
  return { feasible: best !== null, best, completeAssignments, feasibleAssignments, expandedStates }
}

function summarizeMethod(rows) {
  const comparable = rows.filter(row => row.oracleFeasible && row.solverFeasible)
  const feasible = rows.filter(row => row.solverFeasible)
  const expanded = rows.filter(row => row.expandedStates !== null)
  const measured = rows.filter(row => row.solverRuntimeMs !== null)
  const consistent = rows.filter(row => row.feasibilityConsistent).length
  return {
    cases: rows.length,
    oracleFeasibleCases: rows.filter(row => row.oracleFeasible).length,
    oracleInfeasibleCases: rows.filter(row => !row.oracleFeasible).length,
    solverFeasibleCases: feasible.length,
    feasibilityConsistentCases: consistent,
    feasibilityConsistencyRate: ratio(consistent, rows.length),
    missedFeasibleCases: rows.filter(row => row.oracleFeasible && !row.solverFeasible).length,
    unexpectedFeasibleCases: rows.filter(row => !row.oracleFeasible && row.solverFeasible).length,
    budgetViolations: rows.filter(row => row.budgetViolation).length,
    comparableFeasibleCases: comparable.length,
    optimalFeasibleCases: comparable.filter(row => row.utilityOptimal).length,
    feasibleOptimalityRate: ratio(comparable.filter(row => row.utilityOptimal).length, comparable.length),
    meanFeasibleUtilityGap: mean(comparable.map(row => row.utilityGap)),
    maxFeasibleUtilityGap: comparable.length ? Math.max(...comparable.map(row => row.utilityGap)) : null,
    meanReturnedHandoffs: mean(feasible.map(row => row.solverHandoffs)),
    casesWithExpansionCount: expanded.length,
    meanExpandedStates: mean(expanded.map(row => row.expandedStates)),
    totalExpandedStates: expanded.length ? expanded.reduce((sum, row) => sum + row.expandedStates, 0) : null,
    casesWithTiming: measured.length,
    meanSolverRuntimeMs: mean(measured.map(row => row.solverRuntimeMs)),
  }
}

/** Null means an undefined metric, not a zero loss on an infeasible problem. */
export function summarizeSearchRecords(records, methodNames = []) {
  const names = [...new Set([...methodNames, ...records.map(row => row.method)])]
  const byMethod = Object.fromEntries(names.map(name => [name, summarizeMethod(records.filter(row => row.method === name))]))
  const budgetModes = [...new Set(records.map(row => row.budgetMode))]
  const byBudgetMode = Object.fromEntries(budgetModes.map(mode => [mode, Object.fromEntries(names.map(name => [name,
    summarizeMethod(records.filter(row => row.method === name && row.budgetMode === mode)),
  ]))]))
  return { byMethod, byBudgetMode }
}

/** Run auto exact/beam and forced beams on identical inputs for every condition. */
export function runSearchExperiments({ seed = DEFAULT_SEARCH_SEED, instanceCount = 48, includeAdversarial = true,
  instances, beamWidths = DEFAULT_BEAM_WIDTHS, handoffPenalty = 0.015, measureRuntime = true } = {}) {
  validateSeed(seed)
  if (!Array.isArray(beamWidths) || !beamWidths.length || beamWidths.some(width => !Number.isInteger(width) || width < 1)
    || new Set(beamWidths).size !== beamWidths.length) throw new RangeError('beamWidths must be distinct positive integers')
  if (!Number.isFinite(handoffPenalty) || handoffPenalty < 0) throw new RangeError('handoffPenalty must be finite and non-negative')
  if (typeof measureRuntime !== 'boolean') throw new TypeError('measureRuntime must be boolean')
  const source = instances ?? generateSearchInstances({ seed, instanceCount, includeAdversarial })
  if (!Array.isArray(source)) throw new TypeError('instances must be an array')
  const input = structuredClone(source)
  const ids = new Set()
  const strategies = [
    { name: 'auto-exact-4096', exactLimit: EXACT_LIMIT, beamWidth: 256 },
    ...beamWidths.map(width => ({ name: `beam-${width}`, exactLimit: 1, beamWidth: width })),
  ]
  const records = []
  const oracleCases = []
  const serializedInstances = []
  for (const instance of input) {
    const searchSpace = validateInstance(instance)
    if (ids.has(instance.id)) throw new RangeError('Instance ids must be unique')
    ids.add(instance.id)
    // Forced beam needs more than one complete assignment: exactLimit has a
    // production lower bound of one, so a singleton cannot be forced to beam.
    if (searchSpace <= 1) throw new RangeError(`Instance ${instance.id} needs at least two combinations to force beam search`)
    const budgets = instance.budgets ?? generatedBudgets(instance.pools)
    if (!Array.isArray(budgets) || !budgets.length) throw new TypeError(`Instance ${instance.id} needs non-empty budgets`)
    const modes = new Set()
    for (const budget of budgets) {
      if (!budget || typeof budget.mode !== 'string' || !budget.mode.length || modes.has(budget.mode)
        || !(budget.value === Infinity || Number.isFinite(budget.value) && budget.value >= 0)) {
        throw new TypeError(`Instance ${instance.id} needs unique budget modes with non-negative values or Infinity`)
      }
      modes.add(budget.mode)
    }
    serializedInstances.push({ ...instance, searchSpace, budgets: budgets.map(item => ({ ...item, value: Number.isFinite(item.value) ? item.value : null })) })
    for (const { mode: budgetMode, value: budget } of budgets) {
      const oracleStart = measureRuntime ? performance.now() : 0
      const oracle = enumerateSearchOracle({ tasks: instance.tasks, pools: instance.pools, budget, handoffPenalty })
      const oracleRuntimeMs = measureRuntime ? performance.now() - oracleStart : null
      oracleCases.push({ instanceId: instance.id, instanceKind: instance.kind ?? 'supplied', budgetMode,
        budget: Number.isFinite(budget) ? budget : null, ...oracle, runtimeMs: oracleRuntimeMs })
      for (const strategy of strategies) {
        const start = measureRuntime ? performance.now() : 0
        const actual = solveCandidateAssignments({ tasks: instance.tasks, pools: instance.pools, budget,
          exactLimit: strategy.exactLimit, beamWidth: strategy.beamWidth, handoffPenalty })
        const solverRuntimeMs = measureRuntime ? performance.now() - start : null
        const comparable = oracle.feasible && actual !== null
        const rawGap = comparable ? oracle.best.utility - actual.score : null
        const utilityGap = rawGap === null ? null : Math.abs(rawGap) <= TOLERANCE ? 0 : rawGap
        records.push({ instanceId: instance.id, instanceKind: instance.kind ?? 'supplied', budgetMode,
          budget: Number.isFinite(budget) ? budget : null, method: strategy.name,
          configuredExactLimit: strategy.exactLimit, configuredBeamWidth: strategy.beamWidth,
          searchSpace, searchMethod: actual?.search.method ?? null, oracleFeasible: oracle.feasible,
          solverFeasible: actual !== null, feasibilityConsistent: oracle.feasible === (actual !== null),
          budgetViolation: actual !== null && Number.isFinite(budget) && actual.cost > budget + TOLERANCE,
          utilityGap, utilityOptimal: comparable ? Math.abs(utilityGap) <= TOLERANCE : null,
          oracleUtility: oracle.best?.utility ?? null, solverUtility: actual?.score ?? null,
          oracleCost: oracle.best?.cost ?? null, solverCost: actual?.cost ?? null,
          oracleHandoffs: oracle.best?.handoffs ?? null, solverHandoffs: actual?.switches ?? null,
          oracleChoiceRoutes: oracle.best?.choiceRoutes ?? null, solverChoiceRoutes: actual?.choices.map(option => option.route) ?? null,
          expandedStates: actual?.search.expandedStates ?? null, beamPruned: actual?.search.beamPruned ?? null,
          oracleExpandedStates: oracle.expandedStates, oracleCompleteAssignments: oracle.completeAssignments,
          oracleRuntimeMs, solverRuntimeMs,
        })
      }
    }
  }
  const summary = summarizeSearchRecords(records, strategies.map(strategy => strategy.name))
  summary.byInstanceKind = Object.fromEntries([...new Set(records.map(row => row.instanceKind))].map(kind => [kind,
    summarizeSearchRecords(records.filter(row => row.instanceKind === kind), strategies.map(strategy => strategy.name)),
  ]))
  summary.oracle = {
    cases: oracleCases.length, feasibleCases: oracleCases.filter(item => item.feasible).length,
    infeasibleCases: oracleCases.filter(item => !item.feasible).length,
    meanCompleteAssignments: mean(oracleCases.map(item => item.completeAssignments)),
    totalCompleteAssignments: oracleCases.reduce((sum, item) => sum + item.completeAssignments, 0),
    meanRuntimeMs: mean(oracleCases.filter(item => item.runtimeMs !== null).map(item => item.runtimeMs)),
  }
  return {
    schemaVersion: 1, provenance: 'synthetic', claimScope: 'fixed-pool-surrogate-search-only',
    config: { seed, randomInstanceCount: input.filter(instance => instance.kind === 'seeded').length,
      totalInstances: input.length, exactLimit: EXACT_LIMIT, beamWidths: [...beamWidths], handoffPenalty,
      qualityShortfall: 0, costUnit: 'synthetic-arbitrary-unit', runtimeTiming: measureRuntime ? 'diagnostic-only' : 'disabled',
      source: instances === undefined ? 'seeded-generator' : 'supplied-instances' },
    limitations: [
      'Generated scores and costs test the fixed-pool surrogate search objective; they do not measure model answer quality, correctness, or real spending.',
      'All candidates have known prices and qualityShortfall=0; quality relaxation, pool construction, calibration, and model execution are outside this experiment.',
      'This intervention changes only exact versus beam search on identical pools, DAGs, and budgets; it does not isolate cost-anchor or candidate-truncation effects.',
      'For independent candidate pools and additive costs, a prefix passing the suffix-minimum budget bound has a feasible completion; a special least-cost anchor is not necessary to establish that feasibility.',
      'The production cost-anchor comparator prioritizes quality relaxation before cost; with qualityShortfall=0 here, its selected anchor is a minimum-cost prefix.',
      'The exhaustive oracle evaluates complete assignments independently and is practical only for these spaces of at most 4096 combinations.',
      'Utility gaps and optimality rates include only conditions where both the oracle and solver return feasible assignments; infeasible gaps are null.',
      'A null budget in JSON, or an empty budget cell in CSV, represents the unconstrained Infinity budget; null metric values represent unavailable or undefined measurements.',
      'Solver expansion counts are null when its API returns no assignment and no search diagnostics; zero is not inferred.',
      'Runtime is a serial, single-process diagnostic affected by JIT, garbage collection, order, and host load; these timings support no speedup claim.',
      'The forced-final-route instance is deliberately adversarial and should be reported separately from seeded random instances.',
    ],
    instances: serializedInstances, oracleCases, records, summary,
  }
}

const CSV_FIELDS = [
  'instanceId', 'instanceKind', 'budgetMode', 'budget', 'method', 'configuredExactLimit', 'configuredBeamWidth',
  'searchSpace', 'searchMethod', 'oracleFeasible', 'solverFeasible', 'feasibilityConsistent', 'budgetViolation',
  'utilityGap', 'utilityOptimal', 'oracleUtility', 'solverUtility', 'oracleCost', 'solverCost', 'oracleHandoffs',
  'solverHandoffs', 'expandedStates', 'beamPruned', 'oracleExpandedStates', 'oracleCompleteAssignments',
  'oracleRuntimeMs', 'solverRuntimeMs',
]
const csvCell = value => value === null || value === undefined ? '' : /[",\n\r]/.test(String(value))
  ? `"${String(value).replaceAll('"', '""')}"` : String(value)

const HELP = `Usage: node scripts/routing-search-experiment.mjs --output DIR [options]

Run offline fixed-pool search controls and write search-experiment.json and
search-experiment.csv. Node >=22; no network, model calls, fees, or credentials.

Options:
  --output DIR        Directory for generated JSON inputs/results and CSV rows
  --seed INTEGER      Unsigned 32-bit seed (default ${DEFAULT_SEARCH_SEED})
  --instances INTEGER Seeded random instances, 0..1000 (default 48)
  --no-adversarial    Omit the named 1728-combination forced-final-route instance
  --no-timing         Disable diagnostic timings for byte-reproducible files
  -h, --help          Show this help

Infeasible gaps remain null/empty. Costs and utilities are synthetic arbitrary
units. Report the adversarial example separately; no answer-quality or speedup
claim follows from this experiment.
`

async function main(args) {
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    process.stdout.write(HELP)
    return
  }
  const options = {}
  let output
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--no-timing') options.measureRuntime = false
    else if (flag === '--no-adversarial') options.includeAdversarial = false
    else if (['--output', '--seed', '--instances'].includes(flag)) {
      const value = args[++index]
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
      if (flag === '--output') output = resolve(value)
      else {
        if (!/^\d+$/.test(value)) throw new Error(`${flag} requires an integer`)
        options[flag === '--seed' ? 'seed' : 'instanceCount'] = Number(value)
      }
    } else throw new Error(`Unknown option ${flag}; use --help`)
  }
  if (!output) throw new Error('Required --output DIR; use --help')
  const report = runSearchExperiments(options)
  await mkdir(output, { recursive: true })
  const jsonPath = join(output, 'search-experiment.json')
  const csvPath = join(output, 'search-experiment.csv')
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  const csvRows = [CSV_FIELDS.join(','), ...report.records.map(row => CSV_FIELDS.map(field => csvCell(row[field])).join(','))]
  await writeFile(csvPath, `${csvRows.join('\n')}\n`, 'utf8')
  process.stdout.write(`Synthetic search controls: ${report.config.totalInstances} instances, ${report.oracleCases.length} budget conditions, ${report.records.length} solver runs.\n`)
  for (const [kind, grouped] of Object.entries(report.summary.byInstanceKind)) {
    process.stdout.write(`Instance kind: ${kind}\n`)
    for (const [name, summary] of Object.entries(grouped.byMethod)) {
      process.stdout.write(`${name}: consistency ${summary.feasibilityConsistentCases}/${summary.cases}; budget violations ${summary.budgetViolations}; comparable feasible ${summary.comparableFeasibleCases}; mean utility gap ${summary.meanFeasibleUtilityGap ?? 'n/a'}.\n`)
    }
  }
  process.stdout.write(`JSON: ${jsonPath}\nCSV: ${csvPath}\n`)
  const noAdversarial = options.includeAdversarial === false ? ' --no-adversarial' : ''
  const noTiming = options.measureRuntime === false ? ' --no-timing' : ''
  process.stdout.write(`Reproduce: node scripts/routing-search-experiment.mjs --output "${output}" --seed ${report.config.seed} --instances ${options.instanceCount ?? 48}${noAdversarial}${noTiming}\n`)
  process.stdout.write('Timing is diagnostic only. Generated utility is not measured answer quality.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Search experiment failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
