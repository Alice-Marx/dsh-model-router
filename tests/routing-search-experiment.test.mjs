import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SEARCH_SEED, enumerateSearchOracle, generateSearchInstances,
  runSearchExperiments, summarizeSearchRecords } from '../scripts/routing-search-experiment.mjs'

const candidate = (route, score, cost) => ({ route, score, cost, qualityShortfall: 0, pricingKnown: true })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} versus ${expected}`)

function handCountedInstance() {
  return { id: 'hand-counted', kind: 'supplied',
    tasks: [{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }],
    pools: [[candidate('A', 0.7, 3), candidate('B', 0.68, 1)],
      [candidate('A', 0.4, 1), candidate('B', 0.69, 2)]],
  }
}

test('independent complete oracle matches hand-counted utility, costs, handoffs, and enumeration counts', () => {
  const instance = handCountedInstance()
  // AA=(1.1,4,0); AB=(1.29,5,1); BA=(0.98,2,1); BB=(1.37,3,0).
  const unrestricted = enumerateSearchOracle({ ...instance, handoffPenalty: 0.1 })
  assert.equal(unrestricted.feasible, true)
  assert.deepEqual(unrestricted.best.choiceRoutes, ['B', 'B'])
  near(unrestricted.best.utility, 1.37)
  assert.equal(unrestricted.best.cost, 3)
  assert.equal(unrestricted.best.handoffs, 0)
  assert.equal(unrestricted.completeAssignments, 4)
  assert.equal(unrestricted.feasibleAssignments, 4)
  assert.equal(unrestricted.expandedStates, 6)
  const tight = enumerateSearchOracle({ ...instance, handoffPenalty: 0.1, budget: 2 })
  assert.deepEqual(tight.best.choiceRoutes, ['B', 'A'])
  near(tight.best.utility, 0.98)
  assert.equal(tight.best.cost, 2)
  assert.equal(tight.best.handoffs, 1)
  assert.equal(tight.feasibleAssignments, 1)
  assert.equal(tight.completeAssignments, 4)
  const infeasible = enumerateSearchOracle({ ...instance, budget: 1.5 })
  assert.equal(infeasible.feasible, false)
  assert.equal(infeasible.best, null)
  assert.equal(infeasible.feasibleAssignments, 0)
  // An independent complete enumerator must still visit every complete choice.
  assert.equal(infeasible.completeAssignments, 4)
  assert.equal(infeasible.expandedStates, 6)
})

test('fixed seed reproduces inputs and all non-timing results without mutating supplied instances', () => {
  const instances = generateSearchInstances({ seed: 12345, instanceCount: 5 })
  assert.deepEqual(instances, generateSearchInstances({ seed: 12345, instanceCount: 5 }))
  assert.notDeepEqual(instances[0].pools, generateSearchInstances({ seed: 12346, instanceCount: 5 })[0].pools)
  const before = structuredClone(instances)
  const first = runSearchExperiments({ seed: 12345, instances, measureRuntime: false })
  const second = runSearchExperiments({ seed: 12345, instances, measureRuntime: false })
  assert.deepEqual(first, second)
  assert.deepEqual(instances, before)
  assert.equal(first.config.runtimeTiming, 'disabled')
  assert.ok(first.records.every(row => row.solverRuntimeMs === null && row.oracleRuntimeMs === null))
})

test('default controls share 49 fixed spaces across three budgets and six methods', () => {
  const report = runSearchExperiments({ measureRuntime: false })
  assert.equal(report.config.seed, DEFAULT_SEARCH_SEED)
  assert.equal(report.config.randomInstanceCount, 48)
  assert.equal(report.instances.length, 49)
  assert.equal(report.oracleCases.length, 147)
  assert.equal(report.records.length, 882)
  assert.equal(report.summary.oracle.feasibleCases, 98)
  assert.equal(report.summary.oracle.infeasibleCases, 49)
  assert.deepEqual(Object.keys(report.summary.byMethod), ['auto-exact-4096', 'beam-1', 'beam-4', 'beam-16', 'beam-64', 'beam-256'])
  for (const instance of report.instances) {
    assert.ok(instance.searchSpace > 1 && instance.searchSpace <= 4096)
    assert.equal(instance.budgets[0].value, null)
    assert.ok(instance.pools.flat().every(option => option.qualityShortfall === 0 && option.pricingKnown === true))
  }
  for (const row of report.records) {
    assert.equal(row.feasibilityConsistent, true)
    assert.equal(row.budgetViolation, false)
    if (!row.oracleFeasible) {
      assert.equal(row.utilityGap, null)
      assert.equal(row.utilityOptimal, null)
      assert.equal(row.solverCost, null)
      assert.equal(row.expandedStates, null)
    } else {
      assert.ok(row.utilityGap >= 0)
      assert.ok(row.solverCost <= (row.budget ?? Infinity) + 1e-12)
      assert.ok(row.expandedStates > 0)
      assert.equal(row.searchMethod, row.method === 'auto-exact-4096' ? 'exact' : 'beam')
    }
  }
  const exact = report.summary.byMethod['auto-exact-4096']
  assert.equal(exact.feasibleOptimalityRate, 1)
  assert.equal(exact.meanFeasibleUtilityGap, 0)
  assert.equal(exact.comparableFeasibleCases, 98)
  assert.equal(exact.casesWithExpansionCount, 98)
  for (const summary of Object.values(report.summary.byBudgetMode.infeasible)) {
    assert.equal(summary.cases, 49)
    assert.equal(summary.comparableFeasibleCases, 0)
    assert.equal(summary.meanFeasibleUtilityGap, null)
    assert.equal(summary.maxFeasibleUtilityGap, null)
    assert.equal(summary.feasibleOptimalityRate, null)
  }
  assert.equal(report.summary.byInstanceKind.seeded.byMethod['auto-exact-4096'].cases, 144)
  assert.equal(report.summary.byInstanceKind.adversarial.byMethod['auto-exact-4096'].cases, 3)
})

test('named 1728-combination adversarial join exposes forced-beam path loss separately', () => {
  const report = runSearchExperiments({ instanceCount: 0, measureRuntime: false })
  assert.equal(report.instances[0].searchSpace, 1728)
  const records = report.records.filter(row => row.budgetMode === 'unconstrained')
  const exact = records.find(row => row.method === 'auto-exact-4096')
  assert.deepEqual(exact.oracleChoiceRoutes, ['B', 'B', 'B', 'B'])
  assert.deepEqual(exact.solverChoiceRoutes, exact.oracleChoiceRoutes)
  assert.equal(exact.solverHandoffs, 0)
  near(exact.solverUtility, 2.4)
  for (const row of records.filter(row => row.method.startsWith('beam-'))) {
    assert.ok(row.utilityGap > 0, row.method)
    assert.ok(row.solverHandoffs > 0, row.method)
    assert.equal(row.oracleHandoffs, 0)
    assert.ok(row.beamPruned > 0)
  }
})

test('empty and all-infeasible summaries have explicit null denominators and gaps', () => {
  const empty = runSearchExperiments({ instances: [], measureRuntime: false })
  assert.equal(empty.records.length, 0)
  assert.equal(empty.summary.oracle.cases, 0)
  assert.equal(empty.summary.oracle.meanCompleteAssignments, null)
  for (const summary of Object.values(empty.summary.byMethod)) {
    assert.equal(summary.cases, 0)
    assert.equal(summary.feasibilityConsistencyRate, null)
    assert.equal(summary.feasibleOptimalityRate, null)
    assert.equal(summary.meanFeasibleUtilityGap, null)
    assert.equal(summary.meanReturnedHandoffs, null)
  }
  assert.deepEqual(summarizeSearchRecords([]), { byMethod: {}, byBudgetMode: {} })
  const supplied = handCountedInstance()
  supplied.budgets = [{ mode: 'infeasible', value: 0 }]
  const impossible = runSearchExperiments({ instances: [supplied], measureRuntime: false })
  for (const row of impossible.records) assert.equal(row.utilityGap, null)
  for (const summary of Object.values(impossible.summary.byMethod)) {
    assert.equal(summary.oracleInfeasibleCases, 1)
    assert.equal(summary.feasibilityConsistencyRate, 1)
    assert.equal(summary.meanFeasibleUtilityGap, null)
    assert.equal(summary.casesWithExpansionCount, 0)
    assert.equal(summary.meanExpandedStates, null)
    assert.equal(summary.totalExpandedStates, null)
  }
})

test('zero-cost automatic budgets are not mislabeled infeasible', () => {
  const supplied = handCountedInstance()
  for (const pool of supplied.pools) for (const option of pool) option.cost = 0
  const report = runSearchExperiments({ instances: [supplied], measureRuntime: false })
  assert.deepEqual(report.instances[0].budgets.map(item => item.mode), ['unconstrained', 'tight'])
  assert.equal(report.summary.oracle.infeasibleCases, 0)
  assert.ok(report.records.every(row => row.oracleFeasible && row.solverFeasible))
})

test('scope and input validation prevent unintended quality-relaxation or oversized controls', () => {
  const instance = handCountedInstance()
  instance.pools[0][0].qualityShortfall = 0.01
  assert.throws(() => enumerateSearchOracle(instance), /qualityShortfall=0/)
  assert.throws(() => generateSearchInstances({ seed: -1 }), /seed/)
  assert.throws(() => generateSearchInstances({ instanceCount: 0.5 }), /instanceCount/)
  assert.throws(() => runSearchExperiments({ beamWidths: [1, 1] }), /beamWidths/)
  const nonDag = handCountedInstance()
  nonDag.tasks[0].dependsOn = ['b']
  assert.throws(() => enumerateSearchOracle(nonDag), /topological DAG/)
  const tooLarge = { id: 'too-large', tasks: Array.from({ length: 7 }, (_, index) => ({ id: `t${index}`, dependsOn: [] })),
    pools: Array.from({ length: 7 }, () => Array.from({ length: 4 }, (_, index) => candidate(`R${index}`, 0.6, 1))) }
  assert.throws(() => runSearchExperiments({ instances: [tooLarge] }), /4096-combination/)
  const report = runSearchExperiments({ instances: [], measureRuntime: false })
  assert.equal(report.claimScope, 'fixed-pool-surrogate-search-only')
  assert.ok(report.limitations.some(text => /do not measure model answer quality/.test(text)))
  assert.ok(report.limitations.some(text => /does not isolate cost-anchor/.test(text)))
  assert.ok(report.limitations.some(text => /anchor is not necessary/.test(text)))
  assert.ok(report.limitations.some(text => /quality relaxation before cost/.test(text)))
  assert.ok(report.limitations.some(text => /no speedup claim/.test(text)))
})

test('CLI creates documented JSON and CSV structures, prints summary, and rejects invalid arguments', () => {
  const cli = fileURLToPath(new URL('../scripts/routing-search-experiment.mjs', import.meta.url))
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage: node scripts\/routing-search-experiment.mjs/)
  assert.match(help.stdout, /no network, model calls, fees, or credentials/)
  const directory = mkdtempSync(join(tmpdir(), 'routing-search-experiment-test-'))
  try {
    const output = spawnSync(process.execPath, [cli, '--output', directory, '--seed', '42', '--instances', '2', '--no-timing'], { encoding: 'utf8' })
    assert.equal(output.status, 0, output.stderr)
    assert.equal(output.stderr, '')
    assert.match(output.stdout, /3 instances, 9 budget conditions, 54 solver runs/)
    assert.match(output.stdout, /Reproduce: node scripts\/routing-search-experiment.mjs/)
    const report = JSON.parse(readFileSync(join(directory, 'search-experiment.json'), 'utf8'))
    assert.deepEqual(report, runSearchExperiments({ seed: 42, instanceCount: 2, measureRuntime: false }))
    const csv = readFileSync(join(directory, 'search-experiment.csv'), 'utf8').trimEnd().split('\n')
    assert.equal(csv.length, report.records.length + 1)
    const fields = csv[0].split(',')
    assert.ok(fields.includes('utilityGap'))
    assert.ok(fields.includes('expandedStates'))
    assert.ok(fields.includes('solverRuntimeMs'))
    const infeasible = csv.slice(1).find(row => row.split(',')[fields.indexOf('budgetMode')] === 'infeasible').split(',')
    assert.equal(infeasible[fields.indexOf('utilityGap')], '')
    const invalid = spawnSync(process.execPath, [cli, '--output', directory, '--seed', '-1'], { encoding: 'utf8' })
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /requires an integer/)
    const noOutput = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
    assert.equal(noOutput.status, 1)
    assert.match(noOutput.stderr, /Required --output DIR/)
  } finally {
    // Delete only the resolved directory just created under the OS temp folder.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    rmSync(directory, { recursive: true, force: true })
  }
})
