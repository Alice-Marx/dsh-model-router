import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLiveBenchPriorStudy, runPriorStudyCli } from '../scripts/livebench-prior-study.mjs'
import { PINNED_LIVEBENCH_SOURCE } from '../scripts/livebench-aggregate-audit.mjs'

const CLI = fileURLToPath(new URL('../scripts/livebench-prior-study.mjs', import.meta.url))
const quote = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value)
function fixture(models, categories = { Large: ['a', 'b'], Small: ['c'] }) {
  const tasks = Object.values(categories).flat()
  const scoresCsv = [['model', ...tasks], ...models.map(model => [model.id, ...model.scores])]
    .map(row => row.map(value => value === null ? '' : quote(value)).join(',')).join('\n') + '\n'
  const costsCsv = [['model', ...tasks, ...tasks.map(task => `nq_${task}`)], ...models.map(model => [model.id,
    ...(model.costs ?? tasks.map(() => 1)), ...(model.counts ?? tasks.map((_, index) => index === 1 ? 1000 : 1))])]
    .map(row => row.map(value => value === null ? '' : quote(value)).join(',')).join('\n') + '\n'
  return { scoresCsv, costsCsv, categories }
}
function withTemp(run) {
  const root = mkdtempSync(join(tmpdir(), 'livebench-prior-study-'))
  const cleanup = () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.match(root, /livebench-prior-study-/)
    rmSync(root, { recursive: true, force: true })
  }
  try {
    const result = run(root)
    if (result && typeof result.then === 'function') return result.finally(cleanup)
    cleanup()
    return result
  } catch (error) { cleanup(); throw error }
}
function writeInputs(root, input) {
  const directory = join(root, 'input')
  mkdirSync(directory)
  for (const [kind, file] of Object.entries(PINNED_LIVEBENCH_SOURCE.files)) {
    const value = kind === 'scores' ? input.scoresCsv : kind === 'costs' ? input.costsCsv : JSON.stringify(input.categories)
    writeFileSync(join(directory, file.name), value)
  }
  return directory
}
function inputHashes(directory) {
  return Object.fromEntries(readdirSync(directory).map(name => [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')]))
}

test('equal-task domain means then equal-domain means are neither flat-task nor question-count weighted', () => {
  const input = fixture([{ id: 'A', scores: [100, 0, 100] }, { id: 'B', scores: [90, 90, 50] }])
  const before = structuredClone(input)
  const result = buildLiveBenchPriorStudy(input)
  assert.deepEqual(input, before)
  assert.deepEqual(result.qualityProfiles[0].domainScoresPct, { Large: 50, Small: 100 })
  assert.equal(result.qualityProfiles[0].equalDomainMeanScorePct, 75)
  assert.equal(result.bestSingle.model, 'A')
  assert.equal(result.bestSingle.equalDomainMeanScorePct, 75)
  assert.equal(result.domainWiseEmpiricalUpperEnvelope.equalDomainMeanScorePct, 95)
  assert.equal(result.differencePercentagePoints, 20)
  assert.deepEqual(result.domainWiseEmpiricalUpperEnvelope.selectedModelsByDomain, { Large: 'B', Small: 'A' })
  assert.deepEqual(result.byDomain.map(row => row.differencePercentagePoints), [40, 0])
  assert.deepEqual(result.protocol.domainWeights, { Large: 0.5, Small: 0.5 })
  assert.deepEqual(result.protocol.withinDomainTaskWeights, { Large: { a: 0.5, b: 0.5 }, Small: { c: 1 } })
})

test('exact model/effort identities and exact numerical ties use stable non-locale lexicographic ordering', () => {
  const models = ['model-high-v2', 'model-low-v2', 'Model-high-v2', 'model-high-v1', '__proto__']
    .map(id => ({ id, scores: [70, 70, 70] }))
  const first = buildLiveBenchPriorStudy(fixture(models))
  const reversed = buildLiveBenchPriorStudy(fixture([...models].reverse()))
  assert.deepEqual(first, reversed)
  assert.equal(first.coverage.commonCompleteEligibleModels, 5)
  assert.equal(first.bestSingle.model, 'Model-high-v2')
  assert.deepEqual(first.bestSingle.tiedModels, ['Model-high-v2', '__proto__', 'model-high-v1', 'model-high-v2', 'model-low-v2'])
  assert.equal(first.protocol.numericPolicy.tieTolerance, 0)
  assert.equal(first.differencePercentagePoints, 0)
})

test('display-equal scores differing by an ULP are not converted into numerical ties', () => {
  const higher = 80 + Number.EPSILON * 80
  assert.ok(higher > 80)
  assert.equal(higher.toFixed(2), (80).toFixed(2))
  const result = buildLiveBenchPriorStudy(fixture([{ id: 'a', scores: [80, 80, 80] }, { id: 'z', scores: [higher, higher, higher] }]))
  assert.equal(result.bestSingle.model, 'z')
  assert.deepEqual(result.bestSingle.tiedModels, ['z'])
  assert.ok(result.byDomain.every(row => row.domainMaximumModel === 'z'))
})

test('equal score multisets retain compensated means regardless of their source task order', () => {
  const categories = { Same: ['a', 'b', 'c'] }
  const result = buildLiveBenchPriorStudy(fixture([{ id: 'a', scores: [0.1, 0.2, 0.3] }, { id: 'z', scores: [0.3, 0.1, 0.2] }], categories))
  assert.equal(result.qualityProfiles[0].domainScoresPct.Same, result.qualityProfiles[1].domainScoresPct.Same)
  assert.equal(result.bestSingle.model, 'a')
  assert.equal(result.differencePercentagePoints, 0)
})

test('quality pool uses commonCompleteEligible, keeps zero-cost models and excludes missing/nonmodal profiles', () => {
  const result = buildLiveBenchPriorStudy(fixture([
    { id: 'A', scores: [10, 10, 10] }, { id: 'B', scores: [20, 20, 20] },
    { id: 'Zero', scores: [90, 90, 90], costs: [0, 0, 0] },
    { id: 'Different', scores: [100, 100, 100], counts: [2, 1000, 1] },
    { id: 'Incomplete', scores: [100, 100, 100], costs: [null, 1, 1] },
  ]))
  assert.equal(result.bestSingle.model, 'Zero')
  assert.deepEqual(result.qualityProfiles.map(profile => profile.model), ['A', 'B', 'Zero'])
  assert.equal(result.coverage.commonCompleteEligibleModels, 3)
  assert.ok(result.coverage.excludedModels.find(model => model.model === 'Different').reasons.includes('different-question-count-vector'))
  assert.ok(result.coverage.excludedModels.find(model => model.model === 'Incomplete').reasons.includes('incomplete-task-costs'))
  assert.equal(Object.hasOwn(result.qualityProfiles[0], 'taskCosts'), false)
  assert.equal(Object.hasOwn(result.qualityProfiles[0], 'costPerQuestionUsd'), false)
})

test('released monetary amounts cannot change this quality-only result when eligibility/counts are unchanged', () => {
  const positive = fixture([{ id: 'a', scores: [50, 50, 80], costs: [1, 10, 100] }, { id: 'b', scores: [80, 80, 50], costs: [100, 10, 1] }])
  const zero = fixture([{ id: 'a', scores: [50, 50, 80], costs: [0, 0, 0] }, { id: 'b', scores: [80, 80, 50], costs: [0, 0, 0] }])
  assert.deepEqual(buildLiveBenchPriorStudy(positive), buildLiveBenchPriorStudy(zero))
})

test('a single model and real zero scores yield a zero gap, not missingness', () => {
  const result = buildLiveBenchPriorStudy(fixture([{ id: 'only', scores: [0, 0, 0] }]))
  assert.equal(result.bestSingle.equalDomainMeanScorePct, 0)
  assert.equal(result.differencePercentagePoints, 0)
  assert.equal(result.domainWiseEmpiricalUpperEnvelope.equalDomainMeanScorePct, 0)
})

test('empty eligible cohorts, duplicate IDs and malformed score/count inputs remain visible errors', () => {
  const input = fixture([{ id: 'a', scores: [10, 10, 10] }])
  input.costsCsv = input.costsCsv.replace('a,1,1,1,', 'different,1,1,1,')
  assert.throws(() => buildLiveBenchPriorStudy(input), /No commonCompleteEligible/)
  assert.throws(() => buildLiveBenchPriorStudy(fixture([{ id: 'same', scores: [10, 10, 10] }, { id: 'same', scores: [20, 20, 20] }])), /duplicate model/)
  assert.throws(() => buildLiveBenchPriorStudy(fixture([{ id: 'a', scores: [100.1, 10, 10] }])), /invalid score/)
  assert.throws(() => buildLiveBenchPriorStudy(fixture([{ id: 'a', scores: [10, 10, 10], counts: [0, 1000, 1] }])), /invalid count/)
})

test('domain dictionary keys remain safe and formulas are descriptive rather than inferential', () => {
  const categories = JSON.parse('{"__proto__":["a"],"constructor":["b","c"]}')
  const result = buildLiveBenchPriorStudy(fixture([{ id: '__proto__', scores: [20, 40, 60] }], categories))
  assert.equal(result.qualityProfiles[0].domainScoresPct.__proto__, 20)
  assert.equal(result.qualityProfiles[0].domainScoresPct.constructor, 50)
  for (const key of ['independentTest', 'sameQuestionIdentityEstablished', 'queryAdaptiveRoutingEvaluated',
    'deployedLearnedClassifierEvaluated', 'costsUsedInSelectionOrResults', 'qualityCostBenefitClaimSupported', 'significanceInferenceAvailable', 'pairedInferenceAvailable']) {
    assert.equal(result[key], false)
  }
  assert.ok(result.protocol.scoreInterpretation.includes('not a probability'))
})

test('CLI writes a deterministic report only in a fresh output directory and leaves sources unchanged', async () => withTemp(async root => {
  const inputDir = writeInputs(root, fixture([{ id: 'a', scores: [50, 50, 80] }, { id: 'b', scores: [80, 80, 50] }]))
  const before = inputHashes(inputDir)
  const outputA = join(root, 'output-a'), outputB = join(root, 'output-b')
  const first = await runPriorStudyCli(['--input-dir', inputDir, '--output-dir', outputA])
  await runPriorStudyCli(['--input-dir', inputDir, '--output-dir', outputB])
  assert.deepEqual(readFileSync(join(outputA, 'aggregate-prior-study.json')), readFileSync(join(outputB, 'aggregate-prior-study.json')))
  assert.deepEqual(inputHashes(inputDir), before)
  assert.equal(first.source.verifiedPinnedOfficialInputHashes, false)
  assert.match(first.implementation.sha256, /^[a-f0-9]{64}$/)
  await assert.rejects(runPriorStudyCli(['--input-dir', inputDir, '--output-dir', outputA]), /EEXIST/)
  assert.deepEqual(readdirSync(outputA), ['aggregate-prior-study.json'])
}))

test('CLI refuses direct and symlink-resolved output inside input, before writing any source files', async t => withTemp(async root => {
  const inputDir = writeInputs(root, fixture([{ id: 'a', scores: [50, 50, 50] }]))
  const before = inputHashes(inputDir)
  for (const outputDir of [inputDir, join(inputDir, 'nested', 'result')]) {
    await assert.rejects(runPriorStudyCli(['--input-dir', inputDir, '--output-dir', outputDir]), /Refusing output inside input/)
  }
  const alias = join(root, 'input-alias')
  try { symlinkSync(inputDir, alias, 'junction') } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error
    t.diagnostic(`Symlink-resolved guard could not be exercised: ${error.code}`)
    assert.deepEqual(inputHashes(inputDir), before)
    return
  }
  await assert.rejects(runPriorStudyCli(['--input-dir', inputDir, '--output-dir', join(alias, 'result')]), /Refusing output inside input/)
  assert.deepEqual(inputHashes(inputDir), before)
}))

test('real CLI help and errors use bounded stdout/stderr without performing a data run', () => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(help.status, 0, help.stderr)
  assert.equal(help.stderr, '')
  assert.match(help.stdout, /in-sample/)
  const missing = spawnSync(process.execPath, [CLI], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(missing.status, 1)
  assert.equal(missing.stdout, '')
  assert.match(missing.stderr, /Required --input-dir/)
})
