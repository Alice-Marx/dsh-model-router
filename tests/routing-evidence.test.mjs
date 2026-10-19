import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildRoutingEvidence, predictResources, predictQuality, parseRoutingEvidenceJson } from '../.dsh-plugin/shared/routing-evidence.mjs'

const NOW = 1_800_000_000_000
const AGE = 15_552_000_000
const route = { provider: 'p', model: 'm', reasoningEffort: 'high', channel: 'harness-llm' }
const domainA = 'javascript parser exception repair code'
const domainB = 'chinese poem imagery rhyme verse'
const observation = (i = 0, extra = {}) => ({ id: `o-${i}`, groupId: `g-${i}`, text: domainA,
  type: 'general', ...route, quality: 0.9, split: 'train', timestamp: NOW - 500,
  provenance: { kind: 'objective', source: 'unit-tests', reference: 'audit/run-1' }, ...extra })
const observations = (count = 8, extra = {}) => Array.from({ length: count }, (_, i) => observation(i, extra))
const run = (i = 0, extra = {}) => ({ id: `r-${i}`, task: 'original task', createdAt: NOW - 1000,
  finishedAt: NOW - 500, packages: [{ id: 'pkg', provider: 'p', model: 'm', type: 'code', purpose: 'implement',
    channel: 'harness-llm', ran: true, ok: true, finishedAt: NOW - 500,
    usage: { inputTokens: 200, outputTokens: 400 }, inputChars: 1000, durationMs: 1000,
    requestedReasoningEffort: 'high', reasoningEffortStatus: 'requested', ...extra }] })
const runs = (count = 8, extra = {}) => Array.from({ length: count }, (_, i) => run(i, extra))
const build = args => buildRoutingEvidence({ now: NOW, ...args })
const resource = (e, extra = {}) => predictResources(e, { ...route, type: 'code', purpose: 'implement', ...extra })
const quality = (e, extra = {}) => predictQuality(e, { ...route, text: domainA, type: 'general', ...extra })

test('cold start keeps unseen resources and quality unknown', () => {
  const evidence = build({})
  assert.deepEqual(evidence.resourceGroups, [])
  assert.deepEqual(evidence.qualitySamples, [])
  assert.equal(resource(evidence), null)
  assert.equal(quality(evidence), null)
  assert.equal(parseRoutingEvidenceJson(JSON.stringify(evidence), { now: NOW }).revision, evidence.revision)
})

test('resource medians, tail, minimum samples and missing dimensions remain auditable', () => {
  assert.equal(resource(build({ runs: runs(7) })), null)
  const estimate = resource(build({ runs: runs() }))
  assert.equal(estimate.inputTokenRatio, 0.2)
  assert.equal(estimate.outputTokens, 400)
  assert.equal(estimate.durationMs, 1000)
  assert.equal(estimate.sampleCount, 8)
  assert.equal(estimate.source, 'recorded-resource-evidence')
  assert.ok(estimate.promptCharRatio > 1)
  const tail = runs()
  tail[7].packages[0].usage.outputTokens = 4000
  assert.ok(resource(build({ runs: tail })).p90.outputTokens > estimate.outputTokens)
  const missing = resource(build({ runs: runs(8, { durationMs: undefined }) }))
  assert.equal(missing.durationMs, null)
  assert.equal(missing.p90.durationMs, null)
  assert.equal(resource(build({ runs: runs(2), minSamples: 2 })).sampleCount, 2)
})

test('invalid, incomplete, failed, duplicated and multi-attempt resources never inflate evidence', () => {
  for (const usage of [{ inputTokens: -1, outputTokens: 2 }, { inputTokens: 1, outputTokens: -2 },
    { inputTokens: '200', outputTokens: 2 }, { inputTokens: Infinity, outputTokens: 2 },
    { inputTokens: 1, outputTokens: 2, cacheReadTokens: -1 }, { inputTokens: 1, outputTokens: 2, cacheWriteTokens: NaN }]) {
    assert.equal(resource(build({ runs: runs(8, { usage }) })), null)
  }
  for (const extra of [{ usageIncomplete: true }, { ran: false }, { ok: false }, { inputChars: -1 },
    { qualityAttempts: [{}, {}] }]) assert.equal(resource(build({ runs: runs(8, extra) })), null)
  assert.equal(resource(build({ runs: Array(8).fill(run()) })), null)
  const zero = resource(build({ runs: runs(8, { usage: { inputTokens: 0, outputTokens: 0 } }) }))
  assert.equal(zero.outputTokens, 0)
  assert.equal(zero.inputTokenRatio, 0)
})

test('cached categories count toward prompt size without forecasting cache hits', () => {
  const e = build({ runs: runs(8, { usage: { inputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 20, outputTokens: 400 } }) })
  assert.equal(resource(e).inputTokenRatio, 0.2)
})

test('temporal boundaries reject future and expired rows but include exact cutoff', () => {
  assert.equal(resource(build({ runs: runs(8, { finishedAt: NOW + 1 }) })), null)
  assert.equal(quality(build({ observations: observations(8, { timestamp: NOW + 1 }) })), null)
  assert.equal(quality(build({ observations: observations(8, { timestamp: NOW - AGE - 1 }) })), null)
  assert.ok(quality(build({ observations: observations(8, { timestamp: NOW - AGE }) })))
  const oldRuns = runs().map(r => ({ ...r, createdAt: NOW - AGE - 100,
    finishedAt: NOW - AGE, packages: r.packages.map(p => ({ ...p, finishedAt: NOW - AGE })) }))
  assert.ok(resource(build({ runs: oldRuns })))
})

test('CLI actual identity, channels and API model mismatch are isolated', () => {
  assert.equal(resource(build({ runs: runs(8, { channel: 'official-cli' }) }), { channel: 'official-cli' }), null)
  assert.equal(resource(build({ runs: runs(8, { channel: 'official-cli', actualModel: 'other' }) }), { channel: 'official-cli' }), null)
  const e = build({ runs: runs(8, { channel: 'official-cli', actualModel: 'p/m' }) })
  assert.ok(resource(e, { channel: 'official-cli' }))
  assert.equal(resource(e), null)
  assert.equal(resource(build({ runs: runs(8, { actualModel: 'other' }) })), null)
  assert.ok(resource(build({ runs: runs(8, { channel: 'api' }) })))
})

test('requested effort never mixes with unsupported, unapplied or another effort', () => {
  const e = build({ runs: [...runs(), ...runs().map(r => ({ ...r, id: `${r.id}-unknown`,
    packages: r.packages.map(p => ({ ...p, reasoningEffortStatus: 'unsupported', usage: { inputTokens: 300, outputTokens: 900 } })) }))] })
  assert.equal(resource(e).outputTokens, 400)
  assert.equal(resource(e, { reasoningEffort: '' }).outputTokens, 900)
  assert.equal(resource(e, { reasoningEffort: 'low' }), null)
  assert.equal(resource(build({ runs: runs(8, { reasoningEffortStatus: 'unapplied' }) })), null)
  assert.equal(resource(e, { purpose: 'other' }), null)
  assert.equal(resource(e, { type: 'general' }), null)
})

test('task-conditioned nearest neighbors reverse quality ordering without counterfactual labels', () => {
  const data = []
  for (let i = 0; i < 8; i++) for (const [model, text, score] of [
    ['mA', domainA, 0.95], ['mA', domainB, 0.1], ['mB', domainA, 0.1], ['mB', domainB, 0.95],
  ]) data.push(observation(`${model}-${text === domainA ? 'a' : 'b'}-${i}`, { model, text, quality: score }))
  const e = build({ observations: data })
  assert.ok(quality(e, { model: 'mA' }).quality > quality(e, { model: 'mB' }).quality)
  assert.ok(quality(e, { model: 'mA', text: domainB }).quality < quality(e, { model: 'mB', text: domainB }).quality)
  const prediction = quality(e, { model: 'mA' })
  assert.equal(prediction.source, 'recorded-query-evidence')
  assert.equal(prediction.uncertainty.calibrated, false)
  assert.equal(prediction.sampleCount, 8)
  assert.equal(quality(e, { model: 'unobserved' }), null)
  assert.equal(quality(e, { model: 'mA', reasoningEffort: 'low' }), null)
  assert.equal(quality(e, { model: 'mA', channel: 'official-cli' }), null)
  assert.equal(quality(e, { model: 'mA', text: 'xyzzy quartz ziggurat' }), null)
})

test('subjective ratings, wrong splits, duplicate groups and synthetic data cannot masquerade as objective training', () => {
  assert.equal(quality(build({ runs: runs().map(r => ({ ...r, rating: 5, packages: r.packages.map(p => ({ ...p, rating: 5, review: { ok: true } })) })) })), null)
  for (const source of ['rating', 'self-eval', 'model judge', 'manual-opinion']) {
    assert.equal(quality(build({ observations: observations(8, { provenance: { kind: 'objective', source, reference: 'x' } }) })), null)
  }
  for (const split of ['test', 'validation', 'calibration']) assert.equal(quality(build({ observations: observations(8, { split }) })), null)
  assert.equal(quality(build({ observations: observations(8, { groupId: 'same' }) })), null)
  assert.equal(quality(build({ observations: Array(8).fill(observation()) })), null)
  assert.equal(quality(build({ observations: observations(8, { synthetic: true }) })), null)
  assert.ok(quality(build({ observations: observations(8, { synthetic: true }), allowSynthetic: true })))
  const contaminated = [...observations(), observation('heldout', { groupId: 'g-0', split: 'test' })]
  assert.equal(quality(build({ observations: contaminated })), null)
})

test('artifact projection preserves hash evidence and rejects malformed imports', () => {
  const e = build({ observations: observations(), runs: runs() })
  const json = JSON.stringify(e)
  assert.equal(json.includes(domainA), false)
  assert.equal(json.includes('original task'), false)
  const parsed = parseRoutingEvidenceJson(json, { now: NOW })
  assert.ok(quality(build({ qualityEvidence: parsed })))
  assert.deepEqual(build({ qualityEvidence: parsed }).resourceGroups, [])
  for (const mutate of [a => { a.generatedAt = NOW + 1 }, a => { a.qualitySamples[0].quality = -1 },
    a => { a.qualitySamples[0].split = 'test' }, a => { a.qualitySamples[0].text = domainA },
    a => { a.qualitySamples[0].features = [[-1, 1]] }, a => { a.resourceGroups[0].p90.outputTokens = -1 },
    a => { a.qualitySamples[0].synthetic = true }]) {
    const modified = JSON.parse(json); mutate(modified)
    assert.throws(() => parseRoutingEvidenceJson(JSON.stringify(modified), { now: NOW }))
  }
  const held = build({ qualityEvidence: parsed, observations: [observation('test', { groupId: 'g-0', split: 'test' })] })
  assert.equal(quality(held), null)
})

test('revision follows valid content, independent of clock and record ordering', () => {
  const data = observations()
  const history = runs()
  const a = build({ observations: data, runs: history })
  const b = buildRoutingEvidence({ now: NOW + 100, observations: [...data].reverse(), runs: [...history].reverse() })
  assert.equal(a.revision, b.revision)
  assert.notEqual(a.generatedAt, b.generatedAt)
  assert.notEqual(a.revision, build({ observations: data.map((o, i) => i ? o : { ...o, quality: 0.2 }), runs: history }).revision)
  assert.notEqual(a.revision, build({ observations: data, runs: history, minSamples: 7 }).revision)
})

test('offline CLI builds explicit train observations and matrices and refuses unsafe imports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'routing-evidence-'))
  const script = fileURLToPath(new URL('../scripts/build-routing-evidence.mjs', import.meta.url))
  const input = join(dir, 'input.json'), output = join(dir, 'artifact.json')
  const invoke = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  try {
    assert.match(invoke('--help').stdout, /Offline only/)
    assert.equal(invoke('--unknown').status, 1)
    const args = ['--input', input, '--output', output, '--now', String(NOW)]
    await writeFile(input, JSON.stringify({ observations: observations() }))
    const valid = invoke(...args)
    assert.equal(valid.status, 0, valid.stderr)
    assert.equal(valid.stdout.includes(domainA), false)
    assert.equal(parseRoutingEvidenceJson(await readFile(output, 'utf8'), { now: NOW }).qualitySamples.length, 8)
    await rm(output)
    await writeFile(input, JSON.stringify({ observations: observations(8, { split: 'test' }) }))
    assert.equal(invoke(...args).status, 1)
    await assert.rejects(readFile(output))
    assert.equal(invoke('--input', input, '--output', input).status, 1)
    const matrix = { split: 'train', tasks: observations().map(o => ({ id: o.id, groupId: o.groupId,
      text: o.text, type: o.type, timestamp: o.timestamp,
      results: [{ action: route, quality: o.quality, provenance: o.provenance }] })) }
    await writeFile(input, JSON.stringify({ matrix }))
    assert.equal(invoke(...args).status, 0)
    matrix.tasks[0].results[0].action = { provider: 'p', model: 'm' }
    await writeFile(input, JSON.stringify({ matrix }))
    assert.equal(invoke(...args).status, 1)
    await writeFile(input, JSON.stringify({ observations: observations(8, { provenance: null }) }))
    assert.equal(invoke(...args).status, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
