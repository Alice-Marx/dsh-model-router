import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateRouting } from '../scripts/routing-evaluation.mjs'

const models = ['p/one', 'p/two', 'p/three', 'p/four', 'p/five']
const costs = [0.1, 0.2, 0.05, 0.04, 0.03]
function outcomes(correctModels, rowCosts = costs) {
  return Object.fromEntries(models.map((model, index) => [model, {
    correct: correctModels.includes(model), costUsd: rowCosts[index],
  }]))
}

function fixture() {
  return {
    provenance: 'synthetic', models: [...models],
    validation: [
      { id: 'v1', domain: 'common', results: outcomes(['p/one', 'p/two']) },
      { id: 'v2', domain: 'common', results: outcomes(['p/one', 'p/two']) },
      { id: 'v3', domain: 'common', results: outcomes(['p/one']) },
      { id: 'v4', domain: 'rare', results: outcomes(['p/two']) },
    ],
    test: [
      { id: 't1', domain: 'math', selected: 'p/one', routingCostUsd: 0.01, results: outcomes(['p/one']) },
      { id: 't2', domain: 'math', selected: 'p/one', routingCostUsd: 0.02, results: outcomes(['p/two', 'p/three']) },
      { id: 't3', domain: 'code', selected: 'p/three', routingCostUsd: 0.03, results: outcomes(['p/one', 'p/two', 'p/three']) },
      { id: 't4', domain: 'code', selected: 'p/four', routingCostUsd: 0.04, results: outcomes(['p/one', 'p/two', 'p/three', 'p/four']) },
      { id: 't5', domain: 'code', selected: 'p/five', routingCostUsd: 0.05, results: outcomes([]) },
    ],
  }
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} versus ${expected}`)
}

test('hand-counted outcomes distinguish macro accuracy, micro accuracy, costs, and expert recall', () => {
  const report = evaluateRouting(fixture())
  assert.equal(report.baselineSelection.bestSingle.model, 'p/two')
  near(report.baselineSelection.bestSingle.macroDomainAccuracy, 5 / 6)
  assert.equal(report.baselineSelection.cheapestSingle.model, 'p/five')
  const router = report.strategies['recorded-router']
  assert.equal(router.examples, 5)
  assert.equal(router.correct, 3)
  near(router.accuracy, 3 / 5)
  near(router.macroDomainAccuracy, 7 / 12)
  near(router.meanModelCostUsd, 0.064)
  near(router.meanRoutingCostUsd, 0.03)
  near(router.meanCostUsd, 0.094)
  near(router.oracleGap, 0.2)
  near(router.macroDomainOracleGap, 0.25)
  assert.deepEqual(router.expertRecallByCorrectModelCount, {
    '1': { examples: 1, correctSelections: 1, recall: 1 },
    '2-3': { examples: 2, correctSelections: 1, recall: 0.5 },
    '4+': { examples: 1, correctSelections: 1, recall: 1 },
  })
  assert.equal(router.noCorrectModelExamples, 1)
  near(report.strategies.oracle.accuracy, 4 / 5)
  near(report.strategies.oracle.meanCostUsd, 0.054)
  near(report.strategies['best-single'].accuracy, 3 / 5)
  near(report.strategies['best-single'].meanCostUsd, 0.2)
  assert.equal(report.strategies['cheapest-single'].accuracy, 0)
  assert.equal(report.strategies['cheapest-single'].meanCostUsd, 0.03)
})

test('test labels and costs cannot select validation baselines or influence fixed random choices', () => {
  const original = evaluateRouting(fixture())
  const changed = fixture()
  for (const row of changed.test) {
    for (const model of models) row.results[model] = { correct: model === 'p/five', costUsd: model === 'p/one' ? 0 : 100 }
  }
  const report = evaluateRouting(changed)
  assert.deepEqual(report.baselineSelection, original.baselineSelection)
  assert.deepEqual(report.strategies.random.selectedModelCounts, original.strategies.random.selectedModelCounts)
  assert.equal(report.baselineSelection.bestSingle.selectedOn, 'validation')
  assert.equal(report.baselineSelection.oracle.deployable, false)
})

test('model order and row order do not change evaluation or seeded random selection', () => {
  const changed = fixture()
  changed.models.reverse()
  changed.validation.reverse()
  changed.test.reverse()
  for (const row of [...changed.validation, ...changed.test]) row.results = Object.fromEntries(Object.entries(row.results).reverse())
  assert.deepEqual(evaluateRouting(changed), evaluateRouting(fixture()))
})

test('best-single uses domain macro accuracy rather than an imbalanced micro score', () => {
  const data = fixture()
  data.validation[1].results['p/two'].correct = false
  const report = evaluateRouting(data)
  // p/one is 3/4 correct but macro=1/2. p/two is 2/4 but macro=2/3.
  assert.equal(report.baselineSelection.bestSingle.model, 'p/two')
  near(report.baselineSelection.bestSingle.accuracy, 0.5)
  near(report.baselineSelection.bestSingle.macroDomainAccuracy, 2 / 3)
})

test('single-model ties use recorded costs and stable model IDs', () => {
  const data = fixture()
  for (const row of data.validation) {
    row.results = outcomes(models, [1, 1, 2, 3, 4])
  }
  assert.equal(evaluateRouting(data).baselineSelection.bestSingle.model, 'p/one')
  assert.equal(evaluateRouting(data).baselineSelection.cheapestSingle.model, 'p/one')
  for (const row of data.validation) row.results['p/two'].costUsd = 0.5
  assert.equal(evaluateRouting(data).baselineSelection.bestSingle.model, 'p/two')
  assert.equal(evaluateRouting(data).baselineSelection.cheapestSingle.model, 'p/two')
})

test('optional routing overhead defaults to zero and affects only the recorded router', () => {
  const before = evaluateRouting(fixture())
  const data = fixture()
  for (const row of data.test) delete row.routingCostUsd
  const after = evaluateRouting(data)
  assert.equal(after.strategies['recorded-router'].meanRoutingCostUsd, 0)
  near(after.strategies['recorded-router'].meanCostUsd, 0.064)
  assert.equal(after.strategies['recorded-router'].accuracy, before.strategies['recorded-router'].accuracy)
  for (const name of ['best-single', 'cheapest-single', 'random', 'oracle']) {
    assert.deepEqual(after.strategies[name], before.strategies[name])
  }
})

test('empty recall buckets are null and domains with object-property names remain safe', () => {
  const data = fixture()
  data.test = [data.test[4]]
  data.test[0].domain = '__proto__'
  const report = evaluateRouting(data)
  assert.equal(report.strategies.oracle.accuracy, 0)
  assert.equal(report.strategies.oracle.oracleGap, 0)
  assert.equal(report.strategies.oracle.noCorrectModelExamples, 1)
  for (const bucket of Object.values(report.strategies.oracle.expertRecallByCorrectModelCount)) {
    assert.deepEqual(bucket, { examples: 0, correctSelections: 0, recall: null })
  }
  assert.equal(Object.hasOwn(report.strategies.oracle.domainMetrics, '__proto__'), true)
  assert.equal(report.strategies.oracle.domainMetrics.__proto__.accuracy, 0)
})

test('input validation rejects split overlap, incomplete matrices, coercions, and invalid costs', async t => {
  const cases = [
    ['unknown provenance', data => { data.provenance = 'live' }, /provenance/],
    ['empty model pool', data => { data.models = [] }, /models/],
    ['duplicate models', data => { data.models.push(data.models[0]) }, /duplicate model/],
    ['model without provider', data => { data.models[0] = 'one' }, /provider\/model/],
    ['empty validation', data => { data.validation = [] }, /validation/],
    ['empty test', data => { data.test = [] }, /test/],
    ['sparse validation rows', data => { delete data.validation[0] }, /validation\[0\].*plain object/],
    ['duplicate validation ID', data => { data.validation[1].id = data.validation[0].id }, /unique.*overlapping/],
    ['overlapping split ID', data => { data.test[0].id = data.validation[0].id }, /unique.*overlapping/],
    ['empty domain', data => { data.test[0].domain = '  ' }, /domain/],
    ['missing model result', data => { delete data.test[0].results['p/one'] }, /fixed model pool/],
    ['extra model result', data => { data.test[0].results['other/model'] = { correct: true, costUsd: 0 } }, /fixed model pool/],
    ['unknown selected model', data => { data.test[0].selected = 'other/model' }, /selected/],
    ['missing selected model', data => { delete data.test[0].selected }, /selected/],
    ['string boolean', data => { data.validation[0].results['p/one'].correct = 'true' }, /correct.*boolean/],
    ['number boolean', data => { data.test[0].results['p/one'].correct = 1 }, /correct.*boolean/],
    ['missing boolean', data => { delete data.test[0].results['p/one'].correct }, /correct.*boolean/],
    ['missing cost', data => { delete data.test[0].results['p/one'].costUsd }, /costUsd.*missing recorded cost/],
    ['negative model cost', data => { data.validation[0].results['p/one'].costUsd = -1 }, /costUsd.*finite/],
    ['infinite model cost', data => { data.test[0].results['p/one'].costUsd = Infinity }, /costUsd.*finite/],
    ['NaN model cost', data => { data.test[0].results['p/one'].costUsd = NaN }, /costUsd.*finite/],
    ['string model cost', data => { data.test[0].results['p/one'].costUsd = '1' }, /costUsd.*finite/],
    ['negative routing cost', data => { data.test[0].routingCostUsd = -1 }, /routingCostUsd.*finite/],
    ['NaN routing cost', data => { data.test[0].routingCostUsd = NaN }, /routingCostUsd.*finite/],
    ['explicit undefined routing cost', data => { data.test[0].routingCostUsd = undefined }, /routingCostUsd.*finite/],
    ['overflowing combined cost', data => { data.test[0].results['p/one'].costUsd = Number.MAX_VALUE; data.test[0].routingCostUsd = Number.MAX_VALUE }, /plus routing cost.*finite/],
  ]
  for (const [name, mutate, expected] of cases) {
    await t.test(name, () => {
      const data = fixture()
      mutate(data)
      assert.throws(() => evaluateRouting(data), expected)
    })
  }
  assert.throws(() => evaluateRouting(null), /plain object/)
  assert.throws(() => evaluateRouting([]), /plain object/)
})

test('finite extreme supplied costs remain finite when averaged', () => {
  const data = fixture()
  for (const row of [...data.validation, ...data.test]) {
    for (const result of Object.values(row.results)) result.costUsd = Number.MAX_VALUE
  }
  for (const row of data.test) row.routingCostUsd = 0
  const report = evaluateRouting(data)
  for (const strategy of Object.values(report.strategies)) assert.equal(strategy.meanCostUsd, Number.MAX_VALUE)
})

test('synthetic and recorded reports state their evidence limits explicitly', () => {
  const data = fixture()
  const synthetic = evaluateRouting(data)
  assert.equal(synthetic.claimScope, 'synthetic-only-no-real-world-gain')
  assert.ok(synthetic.limitations.some(text => /does not demonstrate real-world/.test(text)))
  data.provenance = 'recorded'
  const recorded = evaluateRouting(data)
  assert.equal(recorded.claimScope, 'supplied-recorded-dataset-only')
  assert.ok(recorded.limitations.some(text => /independence from test labels cannot be audited/.test(text)))
})

test('CLI help, JSON output, and invalid-input exit status work without model calls', () => {
  const cli = fileURLToPath(new URL('../scripts/evaluate-routing.mjs', import.meta.url))
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage: node scripts\/evaluate-routing.mjs/)
  assert.equal(help.stderr, '')
  const directory = mkdtempSync(join(tmpdir(), 'routing-evaluation-test-'))
  try {
    const path = join(directory, 'dataset.json')
    writeFileSync(path, JSON.stringify(fixture()))
    const output = spawnSync(process.execPath, [cli, path], { encoding: 'utf8' })
    assert.equal(output.status, 0, output.stderr)
    assert.equal(output.stderr, '')
    assert.deepEqual(JSON.parse(output.stdout), evaluateRouting(fixture()))
    writeFileSync(path, JSON.stringify({ ...fixture(), validation: [] }))
    const invalid = spawnSync(process.execPath, [cli, path], { encoding: 'utf8' })
    assert.equal(invalid.status, 1)
    assert.equal(invalid.stdout, '')
    assert.match(invalid.stderr, /Routing evaluation failed: dataset.validation/)
    const noArgs = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
    assert.equal(noArgs.status, 1)
    assert.match(noArgs.stderr, /--help/)
  } finally {
    // Only remove the exact directory created for this test inside the OS temp directory.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    rmSync(directory, { recursive: true, force: true })
  }
})
