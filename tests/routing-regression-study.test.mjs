import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegressionCases, runRoutingRegressionStudy } from '../scripts/routing-regression-study.mjs'

const CLI = fileURLToPath(new URL('../scripts/routing-regression-study.mjs', import.meta.url))
const CASE_NAMES = ['budget-candidate-retention', 'dependency-handoff', 'irrelevant-price-outlier',
  'task-specific-quality-evidence', 'normalized-category-evidence', 'image-ineligible-baseline', 'budget-rounding-boundary']
const FIXTURE_ROUTER = `export function buildPlan(input) {
  return {
    fixtureBaseline: true,
    receivedInput: input,
    subtasks: [{ recommended: 'fixture/old-route', qualitySource: 'synthetic' }],
    estimatedCost: 123,
    optimization: { budgetFeasible: false, budgetExceeded: true, handoffCount: 7,
      baselineAllStrongCost: 124, estimatedSavings: 1, qualityEvidenceComplete: false }
  }
}
`

function fixtureDirectory(version = '0.15.0', source = FIXTURE_ROUTER) {
  const root = mkdtempSync(join(tmpdir(), 'routing-regression-study-test-'))
  const baseline = join(root, 'source fixture with spaces')
  const shared = join(baseline, '.dsh-plugin', 'shared')
  mkdirSync(shared, { recursive: true })
  writeFileSync(join(baseline, 'package.json'), JSON.stringify({ name: 'local-test-fixture', version, type: 'module' }))
  writeFileSync(join(shared, 'router.mjs'), source)
  return { root, baseline }
}

function removeFixture(root) {
  // Remove only the exact resolved directory created for this test under temp.
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}

test('seven fixed inputs retain all regression controls and normalized input provenance', () => {
  const cases = createRegressionCases()
  assert.deepEqual(cases.map(item => item.name), CASE_NAMES)
  assert.equal(cases[0].input.available.length, 13)
  assert.equal(cases[0].input.budgetUsd, 0.001)
  assert.equal(cases[1].input.liveBench.models.a.scores.reasoning, 0.77)
  assert.equal(cases[2].input.available.at(-1).pricing.input, 10000)
  assert.deepEqual(cases[3].input.liveBench.models.m.scores, { code: 0.9 })
  assert.equal(cases[4].input.liveBench.models.m.overallSource, 'derived')
  assert.deepEqual(cases[5].input.available[0].inputModalities, ['text'])
  assert.equal(cases[6].input.budgetUsd, 0.0009967)
  cases[0].input.available[0].quality = -1
  assert.notEqual(createRegressionCases()[0].input.available[0].quality, -1)
})

test('local fixture baseline preserves full inputs and both outputs, with actual package version and byte hashes', async () => {
  const { root, baseline } = fixtureDirectory()
  try {
    const report = await runRoutingRegressionStudy({ baselineDirectory: baseline })
    assert.equal(report.baselineVersion, '0.15.0')
    const sourcePackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal(report.sourceVersion, sourcePackage.version)
    assert.equal(report.provenance, 'synthetic')
    assert.equal(report.claimScope, 'seven-fixed-synthetic-counterexamples-only')
    assert.deepEqual(report.cases.map(item => item.name), CASE_NAMES)
    for (const item of report.cases) {
      assert.equal(item.originalOutput.fixtureBaseline, true)
      assert.deepEqual(item.originalOutput.receivedInput, item.input)
      assert.deepEqual(item.original.assignments, ['fixture/old-route'])
      assert.ok(item.updatedOutput.subtasks.length > 0)
      assert.equal(typeof item.updatedOutput.generatedAt, 'string')
      assert.ok(Number.isFinite(Date.parse(item.updatedOutput.generatedAt)))
      assert.deepEqual(item.updated.assignments, item.updatedOutput.subtasks.map(task => task.recommended))
      assert.equal(item.updated.estimatedCost, item.updatedOutput.estimatedCost)
    }
    assert.match(report.sourceSHA256.baseline, /^[0-9a-f]{64}$/)
    assert.match(report.sourceSHA256.current, /^[0-9a-f]{64}$/)
    assert.equal(report.sourceManifests.baseline.sha256, report.sourceSHA256.baseline)
    const entry = report.sourceManifests.baseline.files.find(file => file.path === '.dsh-plugin/shared/router.mjs')
    assert.equal(entry.sha256, createHash('sha256').update(FIXTURE_ROUTER).digest('hex'))
    assert.equal(entry.bytes, Buffer.byteLength(FIXTURE_ROUTER))
    assert.deepEqual(report.sourceManifests.baseline.files.map(file => file.path), ['.dsh-plugin/shared/router.mjs', 'package.json'])
    const currentPaths = report.sourceManifests.current.files.map(file => file.path)
    for (const path of ['.dsh-plugin/shared/router.mjs', '.dsh-plugin/shared/livebench.mjs', '.dsh-plugin/shared/assignment-solver.mjs', 'package.json']) {
      assert.ok(currentPaths.includes(path), path)
    }
    const packagePath = join(baseline, 'package.json')
    writeFileSync(packagePath, `${readFileSync(packagePath, 'utf8')}\n`)
    const changed = await runRoutingRegressionStudy({ baselineDirectory: baseline })
    assert.notEqual(changed.sourceSHA256.baseline, report.sourceSHA256.baseline)
    assert.equal(changed.sourceSHA256.current, report.sourceSHA256.current)
    assert.ok(report.limitations.some(text => /not answer correctness/.test(text)))
    assert.ok(report.limitations.some(text => /comparing two normalization pipelines/.test(text)))
  } finally {
    removeFixture(root)
  }
})

test('missing arguments and incorrect baseline version fail before baseline execution or output creation', async () => {
  const { root, baseline } = fixtureDirectory('0.14.0', "throw new Error('BASELINE_EXECUTED_BEFORE_VALIDATION')\n")
  try {
    await assert.rejects(runRoutingRegressionStudy(), /Required baselineDirectory/)
    await assert.rejects(runRoutingRegressionStudy({ baselineDirectory: baseline }), /Baseline must declare version 0\.15\.0; received 0\.14\.0/)
    const destination = join(root, 'should-not-be-created')
    const invalid = spawnSync(process.execPath, [CLI, '--baseline', baseline, '--output', destination], { encoding: 'utf8' })
    assert.equal(invalid.status, 1)
    assert.equal(invalid.stdout, '')
    assert.match(invalid.stderr, /Baseline must declare version 0\.15\.0/)
    assert.doesNotMatch(invalid.stderr, /BASELINE_EXECUTED_BEFORE_VALIDATION/)
    assert.equal(existsSync(destination), false)
    for (const args of [[], ['--baseline', baseline], ['--output', destination], ['--baseline']]) {
      const missing = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
      assert.equal(missing.status, 1)
      assert.match(missing.stderr, /Required --baseline DIR and --output DIR|Missing value for --baseline/)
      assert.equal(existsSync(destination), false)
    }
  } finally {
    removeFixture(root)
  }
})

test('local dependency fingerprinting follows modules and refuses traversal outside source', async () => {
  const { root, baseline } = fixtureDirectory('0.15.0', `import { fixtureValue } from './fixture-value.mjs'\n${FIXTURE_ROUTER}`)
  try {
    const dependency = join(baseline, '.dsh-plugin', 'shared', 'fixture-value.mjs')
    writeFileSync(dependency, 'export const fixtureValue = 1\n')
    const first = await runRoutingRegressionStudy({ baselineDirectory: baseline })
    assert.ok(first.sourceManifests.baseline.files.some(file => file.path === '.dsh-plugin/shared/fixture-value.mjs'))
    writeFileSync(dependency, 'export const fixtureValue = 2\n')
    const changed = await runRoutingRegressionStudy({ baselineDirectory: baseline })
    assert.notEqual(changed.sourceSHA256.baseline, first.sourceSHA256.baseline)
    writeFileSync(join(baseline, '.dsh-plugin', 'shared', 'router.mjs'), "import '../../../outside-source.mjs'\n")
    await assert.rejects(runRoutingRegressionStudy({ baselineDirectory: baseline }), /escapes.*source directory/)
  } finally {
    removeFixture(root)
  }
})

test('CLI handles directory spaces, saves seven full comparisons, and prints reproducibility identifiers', () => {
  const { root, baseline } = fixtureDirectory()
  try {
    const destination = join(root, 'output with spaces')
    const result = spawnSync(process.execPath, [CLI, '--baseline', baseline, '--output', destination], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, /Saved 7 synthetic regression cases: 0\.15\.0 ->/)
    assert.match(result.stdout, /Current source SHA256: [0-9a-f]{64}/)
    assert.match(result.stdout, /Reproduce: node scripts\/routing-regression-study.mjs --baseline/)
    const report = JSON.parse(readFileSync(join(destination, 'routing-regressions.json'), 'utf8'))
    assert.deepEqual(report.cases.map(item => item.name), CASE_NAMES)
    assert.ok(report.cases.every(item => item.input && item.originalOutput && item.updatedOutput))
    assert.ok(report.cases.every(item => JSON.stringify(item.input) === JSON.stringify(item.originalOutput.receivedInput)))
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' })
    assert.equal(help.status, 0)
    assert.match(help.stdout, /No model calls/)
  } finally {
    removeFixture(root)
  }
})
