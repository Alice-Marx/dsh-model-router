#!/usr/bin/env node
/** Aggregate the three preselected seeds from raw fixed-pool experiment rows. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { summarizeSearchRecords } from './routing-search-experiment.mjs'

const SOURCE_DIRECTORY = fileURLToPath(new URL('../', import.meta.url))
const INPUTS = Object.freeze([
  { seed: 1701, directory: 'seed-1701' },
  { seed: 20261003, directory: '' },
  { seed: 20261004, directory: 'seed-20261004' },
])
const METHODS = Object.freeze(['auto-exact-4096', 'beam-1', 'beam-4', 'beam-16', 'beam-64', 'beam-256'])
const SOURCE_FILES = Object.freeze(['.dsh-plugin/shared/assignment-solver.mjs', 'package.json',
  'scripts/routing-search-experiment.mjs', 'scripts/summarize-routing-search.mjs'])
const EPSILON = 1e-12
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => JSON.stringify(canonicalValue(value))
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]))
  return value
}
const fail = message => { throw new TypeError(message) }
const integer = value => Number.isInteger(value) && value >= 0
const finite = value => Number.isFinite(value)
const conditionKey = (id, budgetMode) => JSON.stringify([id, budgetMode])
const rowKey = row => JSON.stringify([row.instanceId, row.budgetMode, row.method])
const close = (left, right) => Math.abs(left - right) <= EPSILON

function validateReport(report, expectedSeed) {
  if (!report || report.schemaVersion !== 1) fail(`Seed ${expectedSeed}: unsupported schemaVersion; expected 1`)
  if (report.provenance !== 'synthetic' || report.claimScope !== 'fixed-pool-surrogate-search-only') {
    fail(`Seed ${expectedSeed}: expected synthetic fixed-pool-surrogate-search-only scope`)
  }
  const config = report.config
  if (!config || config.seed !== expectedSeed) fail(`Expected seed ${expectedSeed}; received ${String(config?.seed)}`)
  if (config.exactLimit !== 4096 || canonical(config.beamWidths) !== canonical([1, 4, 16, 64, 256])
    || config.qualityShortfall !== 0 || !finite(config.handoffPenalty) || config.handoffPenalty < 0
    || !integer(config.randomInstanceCount) || !integer(config.totalInstances)
    || config.costUnit !== 'synthetic-arbitrary-unit' || !['disabled', 'diagnostic-only'].includes(config.runtimeTiming)
    || !['seeded-generator', 'supplied-instances'].includes(config.source)) fail(`Seed ${expectedSeed}: unsupported search configuration`)
  if (!Array.isArray(report.instances) || !Array.isArray(report.oracleCases) || !Array.isArray(report.records)) {
    fail(`Seed ${expectedSeed}: instances, oracleCases, and records must be arrays`)
  }
  const instances = new Map()
  const conditions = new Map()
  for (const instance of report.instances) {
    if (!instance || typeof instance.id !== 'string' || !instance.id.length || instances.has(instance.id)) {
      fail(`Seed ${expectedSeed}: duplicate or invalid instance id`)
    }
    if (!['seeded', 'adversarial'].includes(instance.kind) || !integer(instance.searchSpace)
      || instance.searchSpace <= 1 || instance.searchSpace > 4096 || !Array.isArray(instance.tasks) || !instance.tasks.length
      || !Array.isArray(instance.pools) || instance.pools.length !== instance.tasks.length
      || instance.pools.some(pool => !Array.isArray(pool) || !pool.length)
      || instance.pools.reduce((product, pool) => product * pool.length, 1) !== instance.searchSpace
      || !Array.isArray(instance.budgets) || !instance.budgets.length) fail(`Seed ${expectedSeed}: invalid instance inputs`)
    if (instance.pools.flat().some(option => !option || option.qualityShortfall !== 0 || option.pricingKnown !== true
      || !finite(option.score) || !finite(option.cost) || option.cost < 0)) fail(`Seed ${expectedSeed}: candidate evidence does not match experiment scope`)
    instances.set(instance.id, instance)
    for (const budget of instance.budgets) {
      if (!budget || typeof budget.mode !== 'string' || !budget.mode.length
        || !(budget.value === null || finite(budget.value) && budget.value >= 0)) fail(`Seed ${expectedSeed}: invalid budget`)
      const key = conditionKey(instance.id, budget.mode)
      if (conditions.has(key)) fail(`Seed ${expectedSeed}: duplicate instance condition`)
      conditions.set(key, { instance, budget: budget.value, mode: budget.mode })
    }
  }
  if (config.totalInstances !== instances.size
    || config.randomInstanceCount !== [...instances.values()].filter(instance => instance.kind === 'seeded').length) {
    fail(`Seed ${expectedSeed}: configured instance counts do not match inputs`)
  }
  const oracles = new Map()
  for (const oracle of report.oracleCases) {
    const key = conditionKey(oracle?.instanceId, oracle?.budgetMode)
    if (oracles.has(key)) fail(`Seed ${expectedSeed}: duplicate oracle instance condition`)
    const condition = conditions.get(key)
    if (!condition || oracle.instanceKind !== condition.instance.kind || oracle.budget !== condition.budget
      || typeof oracle.feasible !== 'boolean' || oracle.completeAssignments !== condition.instance.searchSpace
      || !integer(oracle.feasibleAssignments) || oracle.feasibleAssignments > oracle.completeAssignments
      || !integer(oracle.expandedStates) || oracle.feasible !== (oracle.feasibleAssignments > 0)) fail(`Seed ${expectedSeed}: invalid oracle condition`)
    if (oracle.feasible) {
      if (!oracle.best || !finite(oracle.best.utility) || !finite(oracle.best.cost) || oracle.best.cost < 0
        || !integer(oracle.best.handoffs) || !Array.isArray(oracle.best.choiceRoutes)
        || oracle.best.choiceRoutes.length !== condition.instance.tasks.length) fail(`Seed ${expectedSeed}: invalid feasible oracle output`)
    } else if (oracle.best !== null) fail(`Seed ${expectedSeed}: infeasible oracle output must be null`)
    oracles.set(key, oracle)
  }
  if (oracles.size !== conditions.size) fail(`Seed ${expectedSeed}: incomplete oracle condition matrix`)
  const seen = new Set()
  for (const row of report.records) {
    const key = rowKey(row ?? {})
    if (seen.has(key)) fail(`Seed ${expectedSeed}: duplicate instance condition/method record`)
    seen.add(key)
    const condition = conditions.get(conditionKey(row?.instanceId, row?.budgetMode))
    const oracle = oracles.get(conditionKey(row?.instanceId, row?.budgetMode))
    if (!condition || !METHODS.includes(row.method) || row.instanceKind !== condition.instance.kind
      || row.budget !== condition.budget || row.searchSpace !== condition.instance.searchSpace
      || typeof row.oracleFeasible !== 'boolean' || row.oracleFeasible !== oracle.feasible
      || typeof row.solverFeasible !== 'boolean' || typeof row.feasibilityConsistent !== 'boolean'
      || row.feasibilityConsistent !== (row.oracleFeasible === row.solverFeasible)
      || typeof row.budgetViolation !== 'boolean') fail(`Seed ${expectedSeed}: invalid search record metadata`)
    const isAuto = row.method === METHODS[0]
    if (row.configuredExactLimit !== (isAuto ? 4096 : 1)
      || row.configuredBeamWidth !== (isAuto ? 256 : Number(row.method.slice(5)))
      || row.oracleCompleteAssignments !== oracle.completeAssignments || row.oracleExpandedStates !== oracle.expandedStates) {
      fail(`Seed ${expectedSeed}: record search configuration or oracle counts differ`)
    }
    if (row.oracleFeasible) {
      if (row.oracleUtility !== oracle.best.utility || row.oracleCost !== oracle.best.cost
        || row.oracleHandoffs !== oracle.best.handoffs) fail(`Seed ${expectedSeed}: oracle record values differ`)
    } else if (row.oracleUtility !== null || row.oracleCost !== null || row.oracleHandoffs !== null) {
      fail(`Seed ${expectedSeed}: infeasible oracle record metrics must be null`)
    }
    if (row.solverFeasible) {
      if (!finite(row.solverUtility) || !finite(row.solverCost) || row.solverCost < 0 || !integer(row.solverHandoffs)
        || !integer(row.expandedStates) || !integer(row.beamPruned) || row.searchMethod !== (isAuto ? 'exact' : 'beam')) {
        fail(`Seed ${expectedSeed}: invalid feasible solver metrics`)
      }
    } else if (row.solverUtility !== null || row.solverCost !== null || row.solverHandoffs !== null
      || row.expandedStates !== null || row.beamPruned !== null || row.searchMethod !== null) {
      fail(`Seed ${expectedSeed}: infeasible solver metrics must be null`)
    }
    const violated = row.solverFeasible && row.budget !== null && row.solverCost > row.budget + EPSILON
    if (row.budgetViolation !== violated) fail(`Seed ${expectedSeed}: budget violation flag differs from costs`)
    if (row.oracleFeasible && row.solverFeasible) {
      const difference = row.oracleUtility - row.solverUtility
      const gap = Math.abs(difference) <= EPSILON ? 0 : difference
      if (!finite(row.utilityGap) || !close(row.utilityGap, gap) || typeof row.utilityOptimal !== 'boolean'
        || row.utilityOptimal !== (Math.abs(gap) <= EPSILON)) fail(`Seed ${expectedSeed}: invalid feasible utility gap or optimality flag`)
    } else if (row.utilityGap !== null || row.utilityOptimal !== null) fail(`Seed ${expectedSeed}: non-comparable utility metrics must be null`)
  }
  if (seen.size !== conditions.size * METHODS.length) fail(`Seed ${expectedSeed}: incomplete condition/method record matrix`)
  return { instances, conditions }
}

function withoutTiming(summary) {
  if (Array.isArray(summary)) return summary.map(withoutTiming)
  if (!summary || typeof summary !== 'object') return summary
  return Object.fromEntries(Object.entries(summary).filter(([key]) => !/timing|runtimeMs|timestamp/i.test(key))
    .map(([key, value]) => [key, withoutTiming(value)]))
}

function groupedSummary(rows, instances) {
  const uniqueConditions = new Set(rows.map(row => JSON.stringify([row.seed, row.instanceId, row.budgetMode])))
  // Recompute denominators and gaps from raw rows. Stored report.summary values
  // never enter this function; seed-level averages are never averaged again.
  const summary = summarizeSearchRecords(rows.map(row => ({ ...row, solverRuntimeMs: null })), METHODS)
  return { instanceCount: instances.length, conditionCount: uniqueConditions.size, solverRuns: rows.length, ...withoutTiming(summary) }
}

/** Read only the three named experiment locations and return a deterministic study. */
export async function summarizeRoutingSearchStudy({ directory } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Required directory containing the three named seed reports')
  const root = resolve(directory)
  const loaded = await Promise.all(INPUTS.map(async input => {
    const relativeJSON = `${input.directory ? `${input.directory}/` : ''}search-experiment.json`
    const relativeCSV = `${input.directory ? `${input.directory}/` : ''}search-experiment.csv`
    const [json, csv] = await Promise.all([readFile(join(root, relativeJSON)), readFile(join(root, relativeCSV))])
    const report = JSON.parse(json.toString('utf8').replace(/^\uFEFF/, ''))
    const validated = validateReport(report, input.seed)
    return { seed: input.seed, report, validated,
      files: { json: { path: relativeJSON, bytes: json.length, sha256: sha256(json) },
        csv: { path: relativeCSV, bytes: csv.length, sha256: sha256(csv) } } }
  }))
  const commonConfig = Object.fromEntries(Object.entries(loaded[0].report.config).filter(([key]) => key !== 'seed'))
  for (const source of loaded.slice(1)) {
    const config = Object.fromEntries(Object.entries(source.report.config).filter(([key]) => key !== 'seed'))
    if (canonical(config) !== canonical(commonConfig)) fail(`Seed ${source.seed}: configuration must match other reports except seed`)
  }
  const globalRows = new Set()
  const rows = []
  const allInstances = []
  const perSeed = {}
  const adversarialDefinitions = new Map()
  for (const source of loaded) {
    const seedRows = source.report.records.map(row => ({ ...row, seed: source.seed }))
    for (const row of seedRows) {
      const key = JSON.stringify([source.seed, row.instanceId, row.budgetMode, row.method])
      if (globalRows.has(key)) fail('Duplicate seed/instance condition/method across input files')
      globalRows.add(key)
      rows.push(row)
    }
    const seedInstances = [...source.validated.instances.values()].map(instance => ({ ...instance, seed: source.seed }))
    allInstances.push(...seedInstances)
    const adversarial = seedInstances.filter(instance => instance.kind === 'adversarial')
    for (const instance of adversarial) {
      const { seed, ...definition } = instance
      if (adversarialDefinitions.has(instance.id) && adversarialDefinitions.get(instance.id) !== canonical(definition)) {
        fail('Adversarial construction must be identical across the three seed reports')
      }
      adversarialDefinitions.set(instance.id, canonical(definition))
    }
    perSeed[source.seed] = {
      seeded: groupedSummary(seedRows.filter(row => row.instanceKind === 'seeded'), seedInstances.filter(instance => instance.kind === 'seeded')),
      adversarial: groupedSummary(seedRows.filter(row => row.instanceKind === 'adversarial'), adversarial),
    }
  }
  const sourceFiles = await Promise.all(SOURCE_FILES.map(async path => {
    const bytes = await readFile(join(SOURCE_DIRECTORY, path))
    return { path, bytes: bytes.length, sha256: sha256(bytes) }
  }))
  const sourceSHA256 = sha256(Buffer.from(sourceFiles.map(file => `${file.path}\0${file.sha256}\n`).join('')))
  const sourceVersion = JSON.parse((await readFile(join(SOURCE_DIRECTORY, 'package.json'), 'utf8')).replace(/^\uFEFF/, '')).version
  const adversarialRows = rows.filter(row => row.instanceKind === 'adversarial')
  const independentConditions = new Set(adversarialRows.map(row => conditionKey(row.instanceId, row.budgetMode))).size
  return {
    schemaVersion: 1, provenance: 'synthetic', claimScope: 'fixed-pool-surrogate-search-only',
    study: 'three-preselected-seed-search-controls', seeds: INPUTS.map(input => input.seed),
    config: withoutTiming(commonConfig), sourceVersion,
    environment: { node: process.versions.node, platform: process.platform, architecture: process.arch },
    sourceManifest: { algorithm: 'SHA-256', sha256: sourceSHA256, files: sourceFiles },
    inputFiles: loaded.map(source => ({ seed: source.seed, ...source.files })),
    combined: {
      seeded: groupedSummary(rows.filter(row => row.instanceKind === 'seeded'), allInstances.filter(instance => instance.kind === 'seeded')),
      adversarial: {
        independentConstructedInstances: adversarialDefinitions.size, independentConstructedConditions: independentConditions,
        seedRepetitions: INPUTS.length, notIndependentSamples: true,
        interpretation: 'The same adversarial construction is repeated for verification across seeds; these are not independent samples.',
        ...groupedSummary(adversarialRows, allInstances.filter(instance => instance.kind === 'adversarial')),
      },
    },
    perSeed,
    limitations: [
      'All counts, utility gaps, and denominators are recomputed from validated raw records; stored per-run summaries and their averages are ignored.',
      'Seeded and adversarial results remain separate. The three adversarial runs repeat the same construction and do not increase the independent constructed sample count.',
      'Only jointly feasible oracle/solver conditions enter utility-gap and optimality denominators; infeasible gaps and empty denominators remain null.',
      'Generated candidate scores and costs do not measure real answer correctness, model quality, workload frequency, or spending.',
      'Timing fields are intentionally excluded; expansion counts are search diagnostics and imply no measured speedup.',
      'Source hashes identify the four named files present when this summary is built; they do not retroactively attest to the code loaded during prior experiment generation.',
    ],
  }
}

const HELP = `Usage: node scripts/summarize-routing-search.mjs --directory DIR

Read fixed synthetic search reports and companion CSVs at:
  DIR/search-experiment.json                         (seed 20261003)
  DIR/seed-1701/search-experiment.json                (seed 1701)
  DIR/seed-20261004/search-experiment.json            (seed 20261004)

Validate input scope, schema, configuration, seeds, and unique condition/method
rows; recompute aggregates from raw records. Write DIR/study-summary.json with
separate seeded and repeated adversarial results, per-seed aggregates, Node and
platform identifiers, and SHA-256 source/input manifests. No timing fields,
network access, account credentials, model execution, or answer-quality claims.

Options:
  --directory DIR  Required experiment directory
  -h, --help       Show this help
`

async function main(args) {
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) { process.stdout.write(HELP); return }
  if (args.length !== 2 || args[0] !== '--directory' || !args[1] || args[1].startsWith('--')) {
    throw new Error('Required --directory DIR; use --help')
  }
  const directory = resolve(args[1])
  const report = await summarizeRoutingSearchStudy({ directory })
  const path = join(directory, 'study-summary.json')
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  for (const kind of ['seeded', 'adversarial']) {
    process.stdout.write(`${kind}${kind === 'adversarial' ? ' (same construction repeated; not independent samples)' : ''}\n`)
    for (const [method, summary] of Object.entries(report.combined[kind].byMethod)) {
      process.stdout.write(`${method}: cases ${summary.cases}; feasible ${summary.comparableFeasibleCases}; optimal ${summary.optimalFeasibleCases}; mean gap ${summary.meanFeasibleUtilityGap ?? 'n/a'}; max gap ${summary.maxFeasibleUtilityGap ?? 'n/a'}; expanded ${summary.totalExpandedStates ?? 'n/a'}.\n`)
    }
  }
  process.stdout.write(`JSON: ${path}\nReproduce: node scripts/summarize-routing-search.mjs --directory "${directory}"\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`Search summary failed: ${error.message}\n`); process.exitCode = 1 })
}
