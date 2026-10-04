import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSearchExperiments } from '../scripts/routing-search-experiment.mjs'
import { summarizeRoutingSearchStudy } from '../scripts/summarize-routing-search.mjs'

const CLI = fileURLToPath(new URL('../scripts/summarize-routing-search.mjs', import.meta.url))
const EXPERIMENT_CLI = fileURLToPath(new URL('../scripts/routing-search-experiment.mjs', import.meta.url))
const INPUTS = [{ seed: 1701, directory: 'seed-1701' }, { seed: 20261003, directory: '' }, { seed: 20261004, directory: 'seed-20261004' }]
const candidate = (route, score, cost) => ({ route, score, cost, qualityShortfall: 0, pricingKnown: true })
const jsonPath = (root, input) => join(root, input.directory, 'search-experiment.json')

function createGeneratedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'routing-search-summary-test-'))
  for (const input of INPUTS) {
    const result = spawnSync(process.execPath, [EXPERIMENT_CLI, '--output', join(root, input.directory), '--seed', String(input.seed), '--instances', '2', '--no-timing'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  return root
}
function removeFixture(root) {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
function changeReport(root, input, mutate) {
  const path = jsonPath(root, input)
  const original = readFileSync(path, 'utf8')
  const report = JSON.parse(original)
  mutate(report)
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  return () => writeFileSync(path, original)
}
function assertNoTimeFields(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /time|timing/i)
    assertNoTimeFields(child)
  }
}

test('three actual generated seed fixtures aggregate raw counts and preserve null infeasible denominators', async () => {
  const root = createGeneratedFixture()
  try {
    const first = await summarizeRoutingSearchStudy({ directory: root })
    assert.deepEqual(first, await summarizeRoutingSearchStudy({ directory: root }))
    assert.deepEqual(first.seeds, [1701, 20261003, 20261004])
    assert.equal(first.combined.seeded.instanceCount, 6)
    assert.equal(first.combined.seeded.conditionCount, 18)
    assert.equal(first.combined.seeded.solverRuns, 108)
    const exact = first.combined.seeded.byMethod['auto-exact-4096']
    assert.equal(exact.cases, 18)
    assert.equal(exact.comparableFeasibleCases, 12)
    assert.equal(exact.optimalFeasibleCases, 12)
    assert.equal(exact.meanFeasibleUtilityGap, 0)
    assert.equal(exact.budgetViolations, 0)
    for (const summary of Object.values(first.combined.seeded.byBudgetMode.infeasible)) {
      assert.equal(summary.cases, 6)
      assert.equal(summary.comparableFeasibleCases, 0)
      assert.equal(summary.feasibleOptimalityRate, null)
      assert.equal(summary.meanFeasibleUtilityGap, null)
      assert.equal(summary.maxFeasibleUtilityGap, null)
      assert.equal(summary.totalExpandedStates, null)
    }
    const adversarial = first.combined.adversarial
    assert.equal(adversarial.independentConstructedInstances, 1)
    assert.equal(adversarial.independentConstructedConditions, 3)
    assert.equal(adversarial.instanceCount, 3)
    assert.equal(adversarial.conditionCount, 9)
    assert.equal(adversarial.notIndependentSamples, true)
    assert.match(adversarial.interpretation, /not independent samples/)
    assert.equal(adversarial.byMethod['beam-256'].comparableFeasibleCases, 6)
    assert.equal(adversarial.byMethod['beam-256'].optimalFeasibleCases, 0)
    for (const input of INPUTS) {
      assert.equal(first.perSeed[input.seed].seeded.byMethod['auto-exact-4096'].cases, 6)
    }
    assert.equal(first.environment.node, process.versions.node)
    assert.equal(first.environment.platform, process.platform)
    assertNoTimeFields(first)
    const restore = changeReport(root, INPUTS[0], report => { report.summary = { corruptedStoredAverage: 99999 } })
    const ignoredStoredSummary = await summarizeRoutingSearchStudy({ directory: root })
    assert.deepEqual(ignoredStoredSummary.combined, first.combined)
    assert.notEqual(ignoredStoredSummary.inputFiles[0].json.sha256, first.inputFiles[0].json.sha256)
    restore()
  } finally { removeFixture(root) }
})

test('unequal feasible denominators use pooled raw rows rather than mean-of-seed-means', async () => {
  const root = mkdtempSync(join(tmpdir(), 'routing-search-summary-test-'))
  try {
    for (const [index, input] of INPUTS.entries()) {
      const instances = Array.from({ length: 2 }, (_, fixture) => ({ id: `seeded-${fixture}`, kind: 'seeded',
        tasks: [{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }],
        pools: [[candidate('A', 1, 2), candidate('B', index === 1 ? 0.5 : 0.7, 1)], [candidate('A', 1, 1), candidate('B', 0.4, 2)]],
        budgets: index === 0 || index === 2 && fixture === 0
          ? [{ mode: 'infeasible', value: 0 }]
          : [{ mode: 'tight', value: 3 }, { mode: 'infeasible', value: 0 }],
      }))
      const report = runSearchExperiments({ seed: input.seed, instances, measureRuntime: false })
      report.summary = { maliciousAverage: 99999 }
      const directory = join(root, input.directory)
      mkdirSync(directory, { recursive: true })
      writeFileSync(jsonPath(root, input), JSON.stringify(report))
      writeFileSync(join(directory, 'search-experiment.csv'), 'fixture csv hash input\n')
    }
    const report = await summarizeRoutingSearchStudy({ directory: root })
    const beam = report.combined.seeded.byMethod['beam-1']
    assert.equal(beam.comparableFeasibleCases, 3)
    assert.equal(beam.cases, 9)
    assert.ok(Math.abs(beam.meanFeasibleUtilityGap - (0.515 * 2 + 0.315) / 3) < 1e-12)
    assert.equal(report.perSeed[1701].seeded.byMethod['beam-1'].meanFeasibleUtilityGap, null)
    assert.equal(report.perSeed[1701].seeded.byMethod['beam-1'].feasibleOptimalityRate, null)
    assert.equal(report.combined.adversarial.independentConstructedInstances, 0)
    assert.equal(report.combined.adversarial.byMethod['beam-1'].meanFeasibleUtilityGap, null)
    assertNoTimeFields(report)
  } finally { removeFixture(root) }
})

test('seed, schema, provenance, configuration, duplicate and incomplete conditions safely reject', async () => {
  const root = createGeneratedFixture()
  try {
    const cases = [
      [report => { report.config.seed = 123 }, /Expected seed 1701/],
      [report => { report.schemaVersion = 999 }, /unsupported schemaVersion/],
      [report => { report.provenance = 'recorded' }, /synthetic fixed-pool/],
      [report => { report.claimScope = 'answer-quality' }, /synthetic fixed-pool/],
      [report => { report.config.handoffPenalty = 0.025 }, /configuration must match/],
      [report => { report.instances.push(report.instances[0]) }, /duplicate.*instance id/],
      [report => { report.instances[0].budgets.push(report.instances[0].budgets[0]) }, /duplicate instance condition/],
      [report => { report.oracleCases.push(report.oracleCases[0]) }, /duplicate oracle instance condition/],
      [report => { report.records.push(report.records[0]) }, /duplicate instance condition\/method/],
      [report => { report.records.pop() }, /incomplete condition\/method/],
      [report => { report.records.find(row => !row.oracleFeasible).utilityGap = 0 }, /non-comparable utility metrics must be null/],
    ]
    for (const [mutate, expected] of cases) {
      const restore = changeReport(root, INPUTS[0], mutate)
      await assert.rejects(summarizeRoutingSearchStudy({ directory: root }), expected)
      restore()
    }
    const csvPath = join(root, 'seed-20261004', 'search-experiment.csv')
    const csv = readFileSync(csvPath)
    rmSync(csvPath)
    await assert.rejects(summarizeRoutingSearchStudy({ directory: root }), /ENOENT/)
    writeFileSync(csvPath, csv)
    const json = readFileSync(jsonPath(root, INPUTS[2]))
    rmSync(jsonPath(root, INPUTS[2]))
    await assert.rejects(summarizeRoutingSearchStudy({ directory: root }), /ENOENT/)
    writeFileSync(jsonPath(root, INPUTS[2]), json)
    await assert.rejects(summarizeRoutingSearchStudy(), /Required directory/)
  } finally { removeFixture(root) }
})

test('source and input manifests hash actual file bytes and identify the required source files', async () => {
  const root = createGeneratedFixture()
  try {
    const report = await summarizeRoutingSearchStudy({ directory: root })
    assert.equal(report.sourceManifest.algorithm, 'SHA-256')
    assert.match(report.sourceManifest.sha256, /^[0-9a-f]{64}$/)
    assert.deepEqual(report.sourceManifest.files.map(file => file.path), ['.dsh-plugin/shared/assignment-solver.mjs', 'package.json',
      'scripts/routing-search-experiment.mjs', 'scripts/summarize-routing-search.mjs'])
    for (const file of report.sourceManifest.files) {
      const bytes = readFileSync(new URL(`../${file.path}`, import.meta.url))
      assert.equal(file.bytes, bytes.length)
      assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'))
    }
    for (const source of report.inputFiles) {
      for (const file of [source.json, source.csv]) {
        const bytes = readFileSync(join(root, file.path))
        assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'))
      }
    }
  } finally { removeFixture(root) }
})

test('CLI writes byte-reproducible study summary, prints six methods, and rejects missing directory', () => {
  const root = createGeneratedFixture()
  try {
    const first = spawnSync(process.execPath, [CLI, '--directory', root], { encoding: 'utf8' })
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /seeded\n/)
    assert.match(first.stdout, /auto-exact-4096: cases 18; feasible 12; optimal 12/)
    assert.match(first.stdout, /same construction repeated; not independent samples/)
    assert.match(first.stdout, /Reproduce: node scripts\/summarize-routing-search.mjs/)
    const path = join(root, 'study-summary.json')
    const original = readFileSync(path, 'utf8')
    assertNoTimeFields(JSON.parse(original))
    const second = spawnSync(process.execPath, [CLI, '--directory', root], { encoding: 'utf8' })
    assert.equal(second.status, 0, second.stderr)
    assert.equal(readFileSync(path, 'utf8'), original)
    assert.equal(second.stdout, first.stdout)
    const noArgs = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
    assert.equal(noArgs.status, 1)
    assert.match(noArgs.stderr, /Required --directory DIR/)
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' })
    assert.equal(help.status, 0)
    assert.match(help.stdout, /No timing fields/)
    const restore = changeReport(root, INPUTS[0], report => { report.schemaVersion = 2 })
    rmSync(path)
    const rejected = spawnSync(process.execPath, [CLI, '--directory', root], { encoding: 'utf8' })
    assert.equal(rejected.status, 1)
    assert.equal(existsSync(path), false)
    restore()
  } finally { removeFixture(root) }
})
