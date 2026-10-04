import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { replayChoices, validateReplayInput } from '../docs/experiments/20261004-selftest/replay-choices.mjs'
import { analyzePaired } from '../docs/experiments/20261004-selftest/analyze-paired.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const REPLAY_CLI = join(ROOT, 'docs/experiments/20261004-selftest/replay-choices.mjs')
const ANALYZE_CLI = join(ROOT, 'docs/experiments/20261004-selftest/analyze-paired.mjs')
const SCOPE = 'first-stage-fixed-generation-model-choice-projection'
const HASH = 'a'.repeat(64)

function replayInput() {
  return { schemaVersion: 1, protocolId: 'offline-synthetic-selftest', queries: [
    { id: 'simple', groupId: 'simple-family', domain: 'explanation', text: '请简要解释缓存' },
    { id: 'complex', groupId: 'complex-family', domain: 'code', text: '请设计一个复杂工程架构并实现代码，最后测试和验证。' },
  ], plannerInput: {
    available: [{ provider: 'fixture-provider', model: 'fixture-model', quality: 0.99, latency: 0.1, risk: 0,
      reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium', reasoningKnown: true,
      specialties: ['reasoning', 'code'], inputModalities: ['text'], pricing: { input: 1, output: 2, currency: 'USD' } }],
    mode: 'single', preset: 'balanced', pricing: {}, liveBench: null, budgetUsd: 0, cacheReadRatio: 0, cacheWriteRatio: 0,
  } }
}
function protocol() {
  return { schemaVersion: 1, protocolId: 'offline-synthetic-selftest', status: 'draft', experimentScope: SCOPE,
    comparisons: [{ strategy: 'current', reference: 'baseline' }, { strategy: 'current', reference: 'best-single' }],
    statistics: { seed: 42, resamples: 100, alpha: 0.05, nonInferiorityMargin: 0.05 } }
}
function pairedInput() {
  return { schemaVersion: 1, protocolId: 'offline-synthetic-selftest', stage: 'pilot', provenance: 'synthetic', costBasis: 'synthetic',
    choicesSha256: null, rows: [
      { id: 'a', groupId: 'ga', domain: 'math', outcomes: {
        current: { quality: 0.25, costUsd: 1 }, baseline: { quality: 0.2, costUsd: 2 }, 'best-single': { quality: 0.2, costUsd: 2 },
      } },
      { id: 'b', groupId: 'gb', domain: 'math', outcomes: {
        current: { quality: 0.75, costUsd: 1 }, baseline: { quality: 0.7, costUsd: 2 }, 'best-single': { quality: 0.7, costUsd: 2 },
      } },
    ] }
}
function withTemp(run) {
  const directory = mkdtempSync(join(tmpdir(), 'routing-selftest-tools-'))
  const cleanup = () => {
    // Delete only this exact test-created directory directly inside OS temp.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.match(directory, /routing-selftest-tools-/)
    rmSync(directory, { recursive: true, force: true })
  }
  try {
    const result = run(directory)
    if (result && typeof result.then === 'function') return result.finally(cleanup)
    cleanup()
    return result
  } catch (error) { cleanup(); throw error }
}
const cli = (path, args) => spawnSync(process.execPath, [path, ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 10_000_000 })

test('official-rule usage pricing metadata preserves structured accounting and does not require an invoice', () => {
  const p = protocol()
  const template = JSON.parse(readFileSync(join(ROOT, 'docs/experiments/20261004-selftest/protocol.template.json'), 'utf8'))
  p.costAccounting = structuredClone(template.costAccounting)
  const input = pairedInput()
  // These numbers are fabricated test fixtures, not real collected outcomes.
  // Simulate declared recorded/usage-priced inputs only to test the interface.
  input.provenance = 'recorded'
  input.costBasis = 'usage-priced'
  const result = analyzePaired(input, p)
  assert.equal(result.costBasis, 'usage-priced')
  assert.equal(result.protocol.costAccounting.invoiceRequired, false)
  assert.equal(result.protocol.costAccounting.basis, 'usage-priced')
  assert.deepEqual(result.protocol.costAccounting, template.costAccounting)
  assert.deepEqual(result.protocol.costAccounting.perActionPricingSnapshots, [])
  assert.equal(result.formalAnalysisPrerequisitesPresent, false)
  assert.match(result.costNotice, /not invoices/)
  p.costAccounting.invoiceRequired = true
  assert.equal(result.protocol.costAccounting.invoiceRequired, false)
})

test('both real CLIs have offline --help and reject incomplete arguments without stdout JSON', () => {
  for (const path of [REPLAY_CLI, ANALYZE_CLI]) {
    const help = cli(path, ['--help'])
    assert.equal(help.status, 0, help.stderr)
    assert.equal(help.stderr, '')
    assert.match(help.stdout, /Usage:/)
    assert.match(help.stdout, /No model calls/)
    const missing = cli(path, [])
    assert.equal(missing.status, 1)
    assert.equal(missing.stdout, '')
    assert.match(missing.stderr, /Required.*use --help/)
    assert.equal(cli(path, ['--help', 'extra']).status, 1)
  }
})

test('same-directory replay is a synthetic interface smoke test, not a true old-release comparison', async () => {
  const input = replayInput()
  const before = structuredClone(input)
  const result = await replayChoices(input, ROOT)
  assert.deepEqual(input, before)
  assert.equal(result.experimentScope, SCOPE)
  assert.equal(result.sourceVersions.baseline, result.sourceVersions.current)
  assert.equal(result.sourceManifests.baseline.sha256, result.sourceManifests.current.sha256)
  assert.match(result.inputSha256, /^[0-9a-f]{64}$/)
  assert.ok(result.limitations.some(value => /interface smoke test/.test(value)))
  for (const row of result.queries) {
    const baseline = structuredClone(row.baseline.plan)
    const current = structuredClone(row.current.plan)
    delete baseline.generatedAt
    delete current.generatedAt
    assert.deepEqual(baseline, current)
    assert.deepEqual(row.current.selected, { provider: 'fixture-provider', model: 'fixture-model' })
    assert.equal(row.current.nodeCount, row.current.plan.subtasks.length)
    assert.equal(row.current.executionNodeCount, row.current.plan.subtasks.filter(item => item.purpose === 'execution').length)
  }
  assert.ok(result.queries[1].current.nodeCount > 1, 'single mode must not be presented as single-node execution')
  assert.equal(result.queries[1].current.plan.subtasks[0].purpose, 'analysis')
})

test('each router receives a distinct clone and source manifests fingerprint regular shared modules', async () => withTemp(async directory => {
  const shared = join(directory, '.dsh-plugin', 'shared')
  mkdirSync(shared, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: 'synthetic-fixture', type: 'module' }))
  writeFileSync(join(shared, 'extra.mjs'), 'export const synthetic = true\n')
  const source = `export function buildPlan(input) {
    input.available[0].provider = 'mutated-only-in-baseline';
    return { selected: input.available[0], subtasks: [{purpose:'analysis'}], receivedInput: input };
  }\n`
  writeFileSync(join(shared, 'router.mjs'), source)
  const input = replayInput()
  const before = structuredClone(input)
  const result = await replayChoices(input, directory)
  assert.deepEqual(input, before)
  assert.equal(result.queries[0].baseline.selected.provider, 'mutated-only-in-baseline')
  assert.equal(result.queries[0].current.selected.provider, 'fixture-provider')
  assert.deepEqual(result.replayInput, before)
  assert.deepEqual(result.sourceManifests.baseline.files.map(item => item.path), [
    '.dsh-plugin/shared/extra.mjs', '.dsh-plugin/shared/router.mjs', 'package.json',
  ])
  assert.equal(result.sourceManifests.baseline.files[1].sha256, createHash('sha256').update(source).digest('hex'))
}))

test('replay CLI accepts UTF-8 BOM and writes only its stdout report', () => withTemp(directory => {
  const path = join(directory, 'input with spaces.json')
  const bytes = Buffer.from(`\uFEFF${JSON.stringify(replayInput())}`)
  writeFileSync(path, bytes)
  const before = readdirSync(directory)
  const result = cli(REPLAY_CLI, [path, ROOT])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const output = JSON.parse(result.stdout)
  assert.equal(output.queries.length, 2)
  assert.equal(output.inputSha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(readdirSync(directory), before)
  assert.deepEqual(readFileSync(path), bytes)
}))

test('replay forbids labels, extra fields, duplicate identities, unknown modes, and numeric coercion', async t => {
  const cases = [
    ['labels', input => { input.queries[0].labels = [1] }, /labels.*unexpected field/],
    ['results', input => { input.queries[0].results = {} }, /results.*unexpected field/],
    ['outcomes', input => { input.queries[0].outcomes = {} }, /outcomes.*unexpected field/],
    ['cost', input => { input.queries[0].cost = 0 }, /cost.*unexpected field/],
    ['nested metadata', input => { input.queries[0].metadata = { results: 1 } }, /metadata.*unexpected field/],
    ['extra top-level labels', input => { input.labels = [] }, /labels.*unexpected field/],
    ['duplicate query', input => { input.queries.push(structuredClone(input.queries[0])) }, /duplicate IDs/],
    ['cross-domain group', input => { input.queries[1].groupId = input.queries[0].groupId }, /cannot span domains/],
    ['empty pool', input => { input.plannerInput.available = [] }, /non-empty model pool/],
    ['duplicate model different efforts', input => { input.plannerInput.available.push({ ...input.plannerInput.available[0], reasoningEfforts: ['xhigh'], defaultReasoningEffort: 'xhigh' }) }, /duplicate provider\/model/],
    ['empty ID', input => { input.queries[0].id = '' }, /id/],
    ['whitespace model', input => { input.plannerInput.available[0].model = ' m ' }, /model/],
    ['invalid effort default', input => { input.plannerInput.available[0].defaultReasoningEffort = 'xhigh' }, /must occur in reasoningEfforts/],
    ['negative budget', input => { input.plannerInput.budgetUsd = -1 }, /budgetUsd/],
    ['infinite budget', input => { input.plannerInput.budgetUsd = Infinity }, /budgetUsd/],
    ['string budget', input => { input.plannerInput.budgetUsd = '0' }, /budgetUsd/],
    ['negative pricing', input => { input.plannerInput.available[0].pricing.input = -1 }, /pricing.input/],
    ['unknown pricing number', input => { input.plannerInput.available[0].pricing.input = null }, /pricing.input/],
    ['score above one', input => { input.plannerInput.available[0].quality = 90 }, /quality/],
    ['cache overflow', input => { input.plannerInput.cacheReadRatio = 0.7; input.plannerInput.cacheWriteRatio = 0.7 }, /must not exceed 1/],
    ['cache above one', input => { input.plannerInput.cacheReadRatio = 1.1 }, /cacheReadRatio/],
    ['unknown preset', input => { input.plannerInput.preset = 'cheap' }, /preset/],
    ['unknown mode', input => { input.plannerInput.mode = 'direct' }, /mode/],
    ['test evidence injection', input => { input.plannerInput.liveBench = { models: {} } }, /liveBench.*must be null/],
    ['string schema', input => { input.schemaVersion = '1' }, /schemaVersion/],
  ]
  for (const [name, mutate, pattern] of cases) await t.test(name, () => {
    const input = replayInput()
    mutate(input)
    assert.throws(() => validateReplayInput(input), pattern)
  })
  const input = replayInput()
  input.queries[0].text = '  Explain the cost of caching.\n'
  assert.equal(validateReplayInput(input).queries[0].text, input.queries[0].text)
})

test('invalid replay inputs fail before a baseline source directory is read or imported', async () => {
  const input = replayInput()
  input.queries[0].labels = true
  await assert.rejects(replayChoices(input, join(ROOT, 'does-not-exist-baseline')), /labels.*unexpected field/)
})

test('continuous synthetic pilot statistics retain partial scores and full comparison-family claims', () => {
  const input = pairedInput()
  const p = protocol()
  const before = structuredClone({ input, p })
  const result = analyzePaired(input, p)
  assert.deepEqual({ input, p }, before)
  assert.equal(result.experimentScope, SCOPE)
  assert.equal(result.formalAnalysisPrerequisitesPresent, false)
  assert.equal(result.claims, 2)
  assert.equal(result.comparisons.length, 2)
  for (const comparison of result.comparisons) {
    assert.ok(Math.abs(comparison.point.microQualityDifference - 0.05) < 1e-14)
    assert.equal(comparison.point.meanCostDifferenceUsd, -1)
    assert.equal(comparison.settings.claims, 2)
    assert.equal(comparison.formalAnalysisPrerequisitesPresent, false)
    assert.equal(comparison.conclusion.qualityCostBenefit, true)
  }
  assert.match(result.costNotice, /Synthetic.*no formal/)
  assert.ok(result.limitations.some(value => /checks fields only/.test(value)))
})

test('recorded frozen test checks only prerequisites and distinguishes estimated costs from invoices', () => {
  const input = pairedInput()
  const p = protocol()
  Object.assign(input, { stage: 'test', provenance: 'recorded', costBasis: 'usage-priced', choicesSha256: HASH })
  p.status = 'frozen'
  const estimated = analyzePaired(input, p)
  assert.equal(estimated.formalAnalysisPrerequisitesPresent, true)
  assert.match(estimated.costNotice, /estimates.*not invoices/)
  assert.ok(estimated.limitations.some(value => /format only/.test(value)))
  assert.ok(estimated.limitations.some(value => /actual calls/.test(value)))
  input.costBasis = 'invoiced'
  assert.match(analyzePaired(input, p).costNotice, /caller-supplied.*does not authenticate/)
  input.provenance = 'synthetic'
  input.costBasis = 'synthetic'
  assert.equal(analyzePaired(input, p).formalAnalysisPrerequisitesPresent, false)
})

test('the supplied full protocol template is accepted after matching outcomes without certifying draft metadata', () => {
  const template = JSON.parse(readFileSync(join(ROOT, 'docs/experiments/20261004-selftest/protocol.template.json'), 'utf8').replace(/^\uFEFF/, ''))
  const input = pairedInput()
  input.protocolId = template.protocolId
  const names = [...new Set(template.comparisons.flatMap(item => [item.strategy, item.reference]))]
  for (const row of input.rows) {
    row.outcomes = Object.fromEntries(names.map(name => [name, { quality: 0.25, costUsd: 1 }]))
  }
  const result = analyzePaired(input, template)
  assert.equal(result.protocolStatus, 'draft')
  assert.equal(result.formalAnalysisPrerequisitesPresent, false)
  assert.equal(result.claims, template.comparisons.length)
  assert.deepEqual(result.protocol, template)
  assert.equal(result.protocol.maximumCollectionBudgetUsd, null)
  assert.ok(result.limitations.some(value => /metadata.*not certified/.test(value)))
  const completed = structuredClone(template)
  Object.assign(completed, { dataset: 'synthetic-test-fixture-only', maximumCollectionBudgetUsd: 1,
    actions: [{ provider: 'fixture', model: 'fixture', fixedGeneration: true }],
    generationAndFailurePolicy: 'fixed synthetic fixtures only', gradingPolicy: 'synthetic continuous scores',
    costAccounting: 'synthetic costs only', sampleSizeRationale: 'interface test, not a power claim',
    formalPlannedQuestions: 2, currentSourceManifest: { sha256: HASH }, protocolFrozenAt: null })
  assert.deepEqual(analyzePaired(input, completed).protocol, completed)
})

test('paired analysis rejects invalid protocols, duplicate IDs/pairs, incomplete outcomes, and unknown costs', async t => {
  const cases = [
    ['duplicate comparison', (_input, p) => { p.comparisons.push(structuredClone(p.comparisons[0])) }, /duplicate comparison/],
    ['empty comparison family', (_input, p) => { p.comparisons = [] }, /non-empty complete comparison family/],
    ['self comparison', (_input, p) => { p.comparisons[0].reference = 'current' }, /must differ/],
    ['duplicate IDs', input => { input.rows.push(structuredClone(input.rows[0])) }, /duplicate IDs/],
    ['cross-domain groups', input => { input.rows[1].groupId = input.rows[0].groupId; input.rows[1].domain = 'code' }, /cannot span domains/],
    ['missing outcome', input => { delete input.rows[0].outcomes['best-single'] }, /missing strategy outcome/],
    ['missing cost', input => { delete input.rows[0].outcomes.current.costUsd }, /costUsd.*missing/],
    ['null cost', input => { input.rows[0].outcomes.current.costUsd = null }, /costUsd/],
    ['string cost', input => { input.rows[0].outcomes.current.costUsd = '0' }, /costUsd/],
    ['negative cost', input => { input.rows[0].outcomes.current.costUsd = -1 }, /costUsd/],
    ['infinite cost', input => { input.rows[0].outcomes.current.costUsd = Infinity }, /costUsd/],
    ['unknown unused cost', input => { input.rows[0].outcomes.uncompared = { quality: 0.5, costUsd: null } }, /costUsd/],
    ['conflicting correct', input => { input.rows[0].outcomes.current.correct = true }, /conflicting quality/],
    ['quality above one', input => { input.rows[0].outcomes.current.quality = 1.1 }, /quality/],
    ['string quality', input => { input.rows[0].outcomes.current.quality = '0.25' }, /quality/],
    ['empty rows', input => { input.rows = [] }, /non-empty array/],
    ['wrong protocol ID', input => { input.protocolId = 'different' }, /must match/],
    ['wrong scope', (_input, p) => { p.experimentScope = 'DAG' }, /experimentScope/],
    ['negative seed', (_input, p) => { p.statistics.seed = -1 }, /seed/],
    ['zero resamples', (_input, p) => { p.statistics.resamples = 0 }, /resamples/],
    ['fractional resamples', (_input, p) => { p.statistics.resamples = 1.1 }, /resamples/],
    ['excessive resamples', (_input, p) => { p.statistics.resamples = 1_000_001 }, /resamples/],
    ['zero alpha', (_input, p) => { p.statistics.alpha = 0 }, /alpha/],
    ['margin above one', (_input, p) => { p.statistics.nonInferiorityMargin = 1.1 }, /nonInferiorityMargin/],
    ['caller claims override', (_input, p) => { p.statistics.claims = 1 }, /claims.*unexpected field/],
    ['recorded synthetic costs', input => { input.provenance = 'recorded' }, /recorded provenance requires/],
    ['synthetic invoiced costs', input => { input.costBasis = 'invoiced' }, /synthetic provenance requires/],
    ['invalid provided pilot hash', input => { input.choicesSha256 = 'invalid' }, /choicesSha256/],
  ]
  for (const [name, mutate, pattern] of cases) await t.test(name, () => {
    const input = pairedInput()
    const p = protocol()
    mutate(input, p)
    assert.throws(() => analyzePaired(input, p), pattern)
  })
})

test('test analysis refuses draft protocols, missing hashes, or invalid hashes, including synthetic test data', () => {
  const input = pairedInput()
  input.stage = 'test'
  input.choicesSha256 = HASH
  const p = protocol()
  assert.throws(() => analyzePaired(input, p), /requires a frozen protocol/)
  p.status = 'frozen'
  for (const hash of [undefined, null, '', 'a'.repeat(63), 'z'.repeat(64)]) {
    input.choicesSha256 = hash
    assert.throws(() => analyzePaired(input, p), /choicesSha256/)
  }
  input.choicesSha256 = HASH.toUpperCase()
  assert.equal(analyzePaired(input, p).formalAnalysisPrerequisitesPresent, false)
})

test('paired CLI accepts BOM, preserves user input files, and leaves no outputs on validation failure', () => withTemp(directory => {
  const inputPath = join(directory, 'paired input.json')
  const protocolPath = join(directory, 'protocol.json')
  const inputBytes = Buffer.from(`\uFEFF${JSON.stringify(pairedInput())}`)
  const protocolBytes = Buffer.from(`\uFEFF${JSON.stringify(protocol())}`)
  writeFileSync(inputPath, inputBytes)
  writeFileSync(protocolPath, protocolBytes)
  const before = readdirSync(directory)
  const result = cli(ANALYZE_CLI, [inputPath, protocolPath])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(JSON.parse(result.stdout).comparisons.length, 2)
  assert.deepEqual(readdirSync(directory), before)
  assert.deepEqual(readFileSync(inputPath), inputBytes)
  assert.deepEqual(readFileSync(protocolPath), protocolBytes)
  const invalid = pairedInput()
  invalid.rows[0].outcomes.current.costUsd = null
  writeFileSync(inputPath, JSON.stringify(invalid))
  const rejected = cli(ANALYZE_CLI, [inputPath, protocolPath])
  assert.equal(rejected.status, 1)
  assert.equal(rejected.stdout, '')
  assert.match(rejected.stderr, /costUsd/)
  assert.deepEqual(readdirSync(directory), before)
}))
