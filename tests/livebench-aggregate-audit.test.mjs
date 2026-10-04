import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { auditLiveBenchAggregates, parseAggregateCsv, PINNED_LIVEBENCH_SOURCE, runCli } from '../scripts/livebench-aggregate-audit.mjs'

const categories = { Reasoning: ['a', 'b'], Coding: ['c'] }
const scoreHeaders = ['model', 'a', 'b', 'c']
const costHeaders = ['model', 'a', 'b', 'c', 'nq_a', 'nq_b', 'nq_c']
const csv = (headers, rows) => `${[headers, ...rows].map(row => row.map(value => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}).join(',')).join('\r\n')}\r\n`
const audit = (scoreRows, costRows, categoryMap = categories) => auditLiveBenchAggregates({ scoresCsv: csv(scoreHeaders, scoreRows), costsCsv: csv(costHeaders, costRows), categories: categoryMap })
const byModel = (result, model) => result.models.find(row => row.model === model)
const costRow = (model, values = [1, 2, 3], counts = [10, 10, 10]) => [model, ...values, ...counts]

test('scores use equal category weighting, full precision, and display-only rounding', () => {
  const result = audit([['m', 0, 100, 100 / 3]], [costRow('m')])
  const row = byModel(result, 'm')
  assert.equal(row.domains.Reasoning.scorePct, 50)
  assert.equal(row.overallScorePct, (50 + 100 / 3) / 2)
  assert.equal(row.overallScoreDisplay, '41.67')
  assert.equal(result.evidenceLevel, 'model-by-task-aggregates-only')
  assert.equal(result.latestQuestionMatrixAvailable, false)
  assert.equal(result.pairedInferenceAvailable, false)
  assert.equal(result.routingBenefitClaimSupported, false)
})

test('zero score is observed; blank score stays null and excludes a partial profile', () => {
  const result = audit([['zero', 0, 0, 0], ['partial', 0, null, 100]], [costRow('zero'), costRow('partial')])
  assert.equal(byModel(result, 'zero').overallScorePct, 0)
  assert.equal(byModel(result, 'zero').commonCompleteEligible, true)
  const partial = byModel(result, 'partial')
  assert.equal(partial.taskScores.b, null)
  assert.equal(partial.domains.Reasoning.scorePct, 0)
  assert.equal(partial.domains.Reasoning.scoreComplete, false)
  assert.equal(partial.overallScorePct, null)
  assert.equal(partial.coverage.scoredTasks, 2)
  assert.deepEqual(partial.coverage.missingScores, ['b'])
  assert.ok(partial.ineligibilityReasons.includes('incomplete-task-scores'))
})

test('missing costs are never free; an explicit zero cost is valid', () => {
  const result = audit([['missing', 50, 50, 50], ['free', 50, 50, 50]], [costRow('missing', [1, null, 3]), costRow('free', [0, 0, 0])])
  const missing = byModel(result, 'missing')
  assert.equal(missing.taskCosts.b.totalCostUsd, null)
  assert.equal(missing.costPerQuestionUsd, null)
  assert.equal(missing.domains.Reasoning.costPerQuestionUsd, null)
  assert.equal(missing.commonCompleteEligible, false)
  assert.equal(byModel(result, 'free').costPerQuestionUsd, 0)
  assert.equal(byModel(result, 'free').reportedAllTaskCostsZero, true)
  assert.deepEqual(byModel(result, 'free').coverage.zeroCostTasks, ['a', 'b', 'c'])
  assert.equal(result.coverage.modelsWithAllTaskCostsReportedZero, 1)
  assert.equal(byModel(result, 'free').commonCompleteEligible, true)
  assert.equal(byModel(result, 'free').pricedComparableEligible, false)
  assert.deepEqual(byModel(result, 'free').pricedIneligibilityReasons, ['zeroReportedCostNotVerifiedFree'])
  assert.deepEqual(result.reportedZeroCosts.commonCompleteModelsExcludedFromPricedFrontier, ['free'])
  assert.deepEqual(result.descriptiveStaticFrontier.map(row => row.model), [])
})

test('uneven nq uses sum of task total costs / sum of counts, not category means', () => {
  const result = audit([['m', 80, 80, 80]], [costRow('m', [100, 100, 100], [100, 100, 1])])
  const row = byModel(result, 'm')
  assert.equal(row.domains.Reasoning.costPerQuestionUsd, 1)
  assert.equal(row.domains.Coding.costPerQuestionUsd, 100)
  assert.equal(row.costPerQuestionUsd, 300 / 201)
  assert.notEqual(row.costPerQuestionUsd, (1 + 100) / 2)
})

test('different full nq vector excludes a model even when total count matches', () => {
  const result = audit([['a', 50, 50, 50], ['b', 60, 60, 60], ['outlier', 100, 100, 100]], [costRow('a'), costRow('b'), costRow('outlier', [0, 0, 0], [9, 11, 10])])
  const outlier = byModel(result, 'outlier')
  assert.equal(outlier.questionCount, 30)
  assert.equal(outlier.completeStaticProfile, true)
  assert.equal(outlier.commonCompleteEligible, false)
  assert.deepEqual(outlier.ineligibilityReasons, ['different-question-count-vector'])
  assert.equal(result.coverage.differentCountVectorModels, 1)
  assert.equal(result.commonCompleteCohort.questionIdentityEstablished, false)
  assert.deepEqual(result.descriptiveStaticFrontier.map(row => row.model), ['b'])
})

test('count cohort selection is metadata-only and deterministically tie-broken', () => {
  const result = audit([['higher', 100, 100, 100], ['partial', null, null, null]], [costRow('higher', [1, 1, 1], [20, 20, 20]), costRow('partial', [null, null, null], [10, 10, 10])])
  assert.deepEqual(result.commonCompleteCohort.questionCounts, [10, 10, 10])
  assert.equal(result.coverage.commonCompleteEligibleModels, 0)
  assert.equal(byModel(result, 'higher').commonCompleteEligible, false)
})

test('equal-cost lower quality is dominated, and identical frontier ties are retained', () => {
  const result = audit([['weak', 50, 50, 50], ['best', 80, 80, 80], ['best-tie', 80, 80, 80], ['costly', 70, 70, 70]], [costRow('weak'), costRow('best'), costRow('best-tie'), costRow('costly', [2, 4, 6])])
  assert.deepEqual(result.descriptiveStaticFrontier.map(row => row.model), ['best', 'best-tie'])
  assert.equal(result.coverage.frontierModels, 2)
})

test('equal score and cost multisets retain both frontier ties despite summation order', () => {
  const result = audit([['a', 0.1, 0.2, 0.3], ['b', 0.3, 0.2, 0.1]], [costRow('a', [0.1, 0.2, 0.3]), costRow('b', [0.3, 0.2, 0.1])], { R: ['a', 'b', 'c'] })
  assert.equal(byModel(result, 'a').overallScorePct, byModel(result, 'b').overallScorePct)
  assert.equal(byModel(result, 'a').costPerQuestionUsd, byModel(result, 'b').costPerQuestionUsd)
  assert.deepEqual(result.descriptiveStaticFrontier.map(row => row.model), ['a', 'b'])
})

test('tiny arithmetic differences are frontier ties with separate quality and cost scales', () => {
  const quality = audit([['a', 50, 50, 50], ['b', 50 + 1e-13, 50 + 1e-13, 50 + 1e-13]], [costRow('a'), costRow('b')])
  assert.notEqual(byModel(quality, 'a').overallScorePct, byModel(quality, 'b').overallScorePct)
  assert.deepEqual(quality.descriptiveStaticFrontier.map(row => row.model).sort(), ['a', 'b'])
  const cost = audit([['a', 50, 50, 50], ['b', 50, 50, 50]], [costRow('a'), costRow('b', [1, 2, 3 * (1 + 2 * Number.EPSILON)])])
  assert.notEqual(byModel(cost, 'a').costPerQuestionUsd, byModel(cost, 'b').costPerQuestionUsd)
  assert.deepEqual(cost.descriptiveStaticFrontier.map(row => row.model), ['a', 'b'])
  assert.match(cost.numericPolicy.frontierQualityTolerance, /max\(1/u)
  assert.match(cost.numericPolicy.frontierCostTolerance, /no absolute USD floor/u)
})

test('cost tolerance has no absolute USD floor that could erase a genuine tiny-cost improvement', () => {
  const result = audit([['cheaper', 50, 50, 50], ['dearer', 50, 50, 50]], [costRow('cheaper', [1e-20, 1e-20, 1e-20]), costRow('dearer', [2e-20, 2e-20, 2e-20])])
  assert.deepEqual(result.descriptiveStaticFrontier.map(row => row.model), ['cheaper'])
})

test('frontier comparisons do not collapse scores that display identically', () => {
  const result = audit([['cheaper', 81.10970238095238, 81.10970238095238, 81.10970238095238], ['higher', 81.11019047619048, 81.11019047619048, 81.11019047619048]], [costRow('cheaper'), costRow('higher', [2, 4, 6])])
  assert.equal(byModel(result, 'cheaper').overallScoreDisplay, '81.11')
  assert.equal(byModel(result, 'higher').overallScoreDisplay, '81.11')
  assert.deepEqual(result.descriptiveStaticFrontier.map(row => row.model), ['cheaper', 'higher'])
})

test('published zero-cost profile remains complete but cannot dominate the priced frontier', () => {
  const result = audit([['zero', 100, 100, 100], ['priced', 50, 50, 50]], [costRow('zero', [0, 0, 0]), costRow('priced')])
  assert.equal(result.coverage.completeStaticProfiles, 2)
  assert.equal(result.coverage.commonCompleteEligibleModels, 2)
  assert.equal(result.coverage.pricedComparableEligibleModels, 1)
  assert.equal(byModel(result, 'zero').totalCostUsd, 0)
  assert.equal(byModel(result, 'zero').costPerQuestionUsd, 0)
  assert.deepEqual(byModel(result, 'zero').ineligibilityReasons, [])
  assert.deepEqual(result.descriptiveStaticFrontier.map(row => row.model), ['priced'])
})

test('exact model effort variants stay distinct and inputs are not mutated', () => {
  const categoryMap = { Reasoning: ['a', 'b'], Coding: ['c'] }
  const before = JSON.stringify(categoryMap)
  const models = ['claude-thinking-high-effort', 'claude-thinking-low-effort', 'model,quoted', 'model"quoted']
  const scoresCsv = csv(scoreHeaders, models.map(model => [model, 50, 50, 50]))
  const costsCsv = csv(costHeaders, models.map(model => costRow(model)))
  const result = auditLiveBenchAggregates({ scoresCsv, costsCsv, categories: categoryMap })
  assert.deepEqual(result.models.map(row => row.model), [...models].sort())
  assert.equal(result.coverage.models, 4)
  assert.equal(result.descriptiveStaticFrontier.length, 4)
  assert.equal(JSON.stringify(categoryMap), before)
  assert.equal(scoresCsv, csv(scoreHeaders, models.map(model => [model, 50, 50, 50])))
})

test('missing rows, columns, and count cells remain incomplete', () => {
  const result = audit([['score-only', 20, 20, 20], ['no-count', 20, 20, 20]], [costRow('cost-only'), costRow('no-count', [1, 2, 3], [10, null, 10])])
  assert.equal(result.coverage.scoreOnlyModels, 1)
  assert.equal(result.coverage.costOnlyModels, 1)
  assert.equal(result.coverage.incompleteProfiles, 3)
  assert.ok(byModel(result, 'score-only').ineligibilityReasons.includes('missing-cost-row'))
  assert.ok(byModel(result, 'cost-only').ineligibilityReasons.includes('missing-score-row'))
  assert.equal(byModel(result, 'no-count').questionCountVector, null)
  assert.equal(byModel(result, 'no-count').costPerQuestionUsd, null)
  const missingColumn = auditLiveBenchAggregates({ scoresCsv: 'model,a,b\nm,10,20\n', costsCsv: csv(costHeaders, [costRow('m')]), categories })
  assert.equal(byModel(missingColumn, 'm').taskScores.c, null)
  assert.equal(missingColumn.coverage.commonCompleteEligibleModels, 0)
})

test('score values must be finite decimals bounded on 0..100', () => {
  for (const invalid of ['NaN', 'Infinity', '-Infinity', -1, 100.001, '100.00000000000000001', '10000000000000000001e-17', '1e-999', '-1e-999', '5garbage', '0x10', '1e999', 'null']) {
    assert.throws(() => audit([['m', invalid, 50, 50]], [costRow('m')]), /finite decimal|invalid score/u, String(invalid))
  }
})

test('costs must be finite nonnegative and nq must be positive safe integers', () => {
  for (const invalid of ['NaN', 'Infinity', -1, '1e999', '1e-999', '-1e-999']) assert.throws(() => audit([['m', 50, 50, 50]], [costRow('m', [invalid, 2, 3])]), /finite decimal|invalid cost/u)
  for (const invalid of [0, -1, 1.5, 'NaN', 'Infinity', '9007199254740992', '9007199254740990.1', '9007199254740991.1', '1.0000000000000001', '1e-999']) assert.throws(() => audit([['m', 50, 50, 50]], [costRow('m', [1, 2, 3], [invalid, 10, 10])]), /finite decimal|invalid count/u)
  assert.throws(() => audit([['m', 50, 50, 50]], [costRow('m', [1e308, 1e308, 1e308])]), /overflow/u)
})

test('exact decimal validation accepts integer exponent notation and zero without exponent expansion', () => {
  const result = audit([['m', '1e2', '100.000', '0e999999999999999999999999']], [costRow('m', ['0e999999999999999999999999', 2, 3], ['10.0', '1e1', '100e-1'])])
  assert.equal(byModel(result, 'm').questionCount, 30)
  assert.equal(byModel(result, 'm').taskScores.a, 100)
  assert.equal(byModel(result, 'm').taskScores.c, 0)
  assert.equal(byModel(result, 'm').taskCosts.a.totalCostUsd, 0)
  const maximum = auditLiveBenchAggregates({ scoresCsv: 'model,a\nm,50\n', costsCsv: 'model,a,nq_a\nm,1,90071992547409910e-1\n', categories: { R: ['a'] } })
  assert.equal(byModel(maximum, 'm').questionCount, Number.MAX_SAFE_INTEGER)
})

test('strict CSV rejects duplicate headers, models, malformed fields, and padded IDs', () => {
  for (const invalid of ['model,a,a\nm,1,2\n', 'model,a\nm,1\nm,2\n', 'model,a\nm,1,2\n', 'model,a\n"m,1\n', 'model,a\n"m"x,1\n', 'model,a\nm"x,1\n', 'model,a\n m,1\n']) {
    assert.throws(() => parseAggregateCsv(invalid), /duplicate|fields|quote|invalid exact/u)
  }
  assert.throws(() => audit([['m', 50, 50, 50]], [costRow('m'), costRow('m')]), /duplicate model/u)
  assert.throws(() => audit([['m', 50, 50, 50], ['m', 60, 60, 60]], [costRow('m')]), /duplicate model/u)
  assert.throws(() => audit([], [], { R: ['a'], C: ['a'] }), /duplicate category task/u)
})

test('CSV supports BOM, escaped quotes, quoted newlines, CRLF, and final rows', () => {
  const parsed = parseAggregateCsv('\uFEFFmodel,note\r\n"a,b","quoted ""text""\nnext"\r\nlast,ok')
  assert.deepEqual(parsed.headers, ['model', 'note'])
  assert.equal(parsed.models.get('a,b').note, 'quoted "text"\nnext')
  assert.equal(parsed.models.get('last').note, 'ok')
  assert.throws(() => parseAggregateCsv('model,a\nm,\0'), /NUL/u)
})

async function fixtureDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'livebench-aggregate-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const input = path.join(root, 'input')
  await mkdir(input)
  const contents = {
    scores: csv(scoreHeaders, [['m', 70, 80, 90]]),
    costs: csv(costHeaders, [costRow('m')]),
    categories: JSON.stringify(categories)
  }
  for (const [kind, text] of Object.entries(contents)) await writeFile(path.join(input, PINNED_LIVEBENCH_SOURCE.files[kind].name), text)
  return { root, input, contents }
}

test('CLI records byte hashes, writes outside source, and leaves every input unchanged', async t => {
  const { root, input, contents } = await fixtureDirectory(t)
  const output = path.join(root, 'output', 'audit.json')
  const result = await runCli(['--input-dir', input, '--output', output])
  const saved = JSON.parse(await readFile(output, 'utf8'))
  assert.deepEqual(saved, result)
  assert.equal(saved.source.verifiedPinnedOfficialInputHashes, false)
  assert.equal(saved.source.release, null)
  for (const [kind, text] of Object.entries(contents)) {
    assert.equal(await readFile(path.join(input, PINNED_LIVEBENCH_SOURCE.files[kind].name), 'utf8'), text)
    assert.equal(saved.source.inputs[kind].sha256, createHash('sha256').update(text).digest('hex'))
    assert.equal(saved.source.inputs[kind].bytes, Buffer.byteLength(text))
  }
  await assert.rejects(() => runCli(['--input-dir', input, '--output', output]), /EEXIST/u)
})

test('CLI refuses outputs in the input tree, duplicate flags, and missing flags', async t => {
  const { root, input, contents } = await fixtureDirectory(t)
  for (const output of [path.join(input, 'audit.json'), path.join(input, 'nested', 'audit.json'), path.join(input, PINNED_LIVEBENCH_SOURCE.files.scores.name)]) {
    await assert.rejects(() => runCli(['--input-dir', input, '--output', output]), /Refusing output inside/u)
  }
  await assert.rejects(() => runCli(['--input-dir', input]), /required/u)
  await assert.rejects(() => runCli(['--input-dir', input, '--input-dir', input, '--output', path.join(root, 'x')]), /Usage/u)
  assert.equal(await readFile(path.join(input, PINNED_LIVEBENCH_SOURCE.files.scores.name), 'utf8'), contents.scores)
})
