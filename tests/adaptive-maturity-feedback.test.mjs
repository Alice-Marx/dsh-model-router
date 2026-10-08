import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFeedbackProfile, applyFeedbackProfile, FEEDBACK_DECAY_REFRESH_MS } from '../.dsh-plugin/shared/adaptive-feedback.mjs'
import { actualCost, spending, buildRunRecord, mergeRerun } from '../.dsh-plugin/shared/run-ledger.mjs'
import { buildPlan } from '../.dsh-plugin/shared/router.mjs'

const NOW = Date.parse('2026-10-07T04:00:00.000Z')
const DAY = 86_400_000
const key = 'provider\0model-v1'
const item = changes => ({ id: 'step', provider: 'provider', model: 'model-v1', type: 'code', ran: true, ok: true,
  status: 'succeeded', channel: 'harness-llm', rating: 1, finishedAt: NOW, ...changes })
const run = (id = 'run', changes = {}) => ({ id, createdAt: NOW, packages: [item(changes)] })
const profile = (runs, options = {}) => buildFeedbackProfile(runs, { now: NOW, ...options })
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)

test('empty, disabled and zero-amplitude decision identities do not drift with wall clock', () => {
  assert.equal(profile([]).revision, profile([], { now: NOW + 100 * DAY }).revision)
  for (const options of [{ enabled: false }, { maxAdjustment: 0 }]) {
    assert.equal(profile([run()], options).revision, profile([run()], { ...options, now: NOW + 100 * DAY }).revision)
    assert.equal(profile([run()], options).decayEpoch, null)
  }
})

test('active evidence uses hourly decision identity but continuously computes exact decay', () => {
  const initial = profile([run()])
  const oneSecond = profile([run()], { now: NOW + 1000 })
  const nextEpoch = profile([run()], { now: NOW + FEEDBACK_DECAY_REFRESH_MS })
  assert.equal(initial.revision, oneSecond.revision)
  assert.equal(initial.evidenceRevision, nextEpoch.evidenceRevision)
  assert.notEqual(initial.revision, nextEpoch.revision)
  assert.equal(oneSecond.evaluatedAt, NOW + 1000)
  assert.equal(initial.decayRefreshMs, FEEDBACK_DECAY_REFRESH_MS)
  assert.ok(initial.effectiveWeight > oneSecond.effectiveWeight)
  assert.ok(oneSecond.effectiveWeight > nextEpoch.effectiveWeight)
  assert.match(initial.revisionSemantics, /cache-identity-not-security-hash/)
})

test('same-rating audit updates are idempotent cache identities, actual re-rating invalidates', () => {
  const first = profile([run('r', { ratedAt: NOW })], { now: NOW + 2000 })
  const audited = profile([run('r', { ratedAt: NOW + 1000 })], { now: NOW + 2000 })
  assert.equal(first.revision, audited.revision)
  assert.equal(audited.updatedAt, NOW + 1000)
  assert.notEqual(first.revision, profile([run('r', { rating: -1 })], { now: NOW + 2000 }).revision)
})

test('domain diagnostics describe only observed labels and have stable weighted ESS', () => {
  const result = profile([run('new', { rating: 1 }), run('old', { rating: -1, finishedAt: NOW - 30 * DAY })])
  const cell = result.cellStats[key].code
  assert.equal(cell.feedbackCount, 2)
  assert.equal(cell.positiveCount, 1)
  assert.equal(cell.negativeCount, 1)
  close(cell.effectiveWeight, 1.5)
  close(cell.weightSquaredSum, 1.25)
  close(cell.effectiveSampleSize, 1.8)
  close(cell.shrinkage, 1.5 / 4.5)
  close(cell.adjustment, 0.04 * 0.5 / 4.5)
  close(cell.adjustment, result.adjustments[key].code)
  assert.match(cell.semantics, /not-confidence-or-correctness/)
  assert.equal(result.cellStats[key].math, undefined)
})

test('Kish ESS does not underflow just because equally old weights are tiny', () => {
  const result = profile([run('old1', { finishedAt: NOW - 700 * DAY }), run('old2', { finishedAt: NOW - 700 * DAY })], { halfLifeDays: 1 })
  assert.ok(result.effectiveWeight > 0)
  assert.equal(result.cellStats[key].code.weightSquaredSum, 0)
  close(result.cellStats[key].code.effectiveSampleSize, 2)
})

test('user-injected confidence/weight diagnostics do not increase training weights or affect ranking', () => {
  const baseline = profile([run()])
  const injected = profile([run('run', { weight: 1e30, confidence: 1, effectiveWeight: 1e30,
    effectiveSampleSize: 1e30, cellStats: { effectiveWeight: 1e30 }, review: { score: 5 } })])
  assert.deepEqual(injected.cellStats, baseline.cellStats)
  assert.deepEqual(injected.adjustments, baseline.adjustments)
  const routes = ['model-v1', 'model-v2'].map(model => ({ provider: 'provider', model,
    quality: 0.9, pricing: { input: 1, output: 1 }, specialties: ['code'] }))
  const alteredDiagnostics = { ...baseline, cellStats: { [key]: { code: { effectiveSampleSize: 1e30, effectiveWeight: 1e30 } } } }
  const actual = buildPlan({ text: '请写一行代码', available: applyFeedbackProfile(routes, baseline), mode: 'single' })
  const forged = buildPlan({ text: '请写一行代码', available: applyFeedbackProfile(routes, alteredDiagnostics), mode: 'single' })
  assert.deepEqual(forged.selected, actual.selected)
  assert.deepEqual(forged.candidates, actual.candidates)
})

test('exclusion reasons partition ignored records; duplicates and clear add no labels', () => {
  const result = profile([
    run('duplicate'), run('duplicate', { rating: null }),
    run('missing-id', { id: undefined }), run('bad-route', { provider: '' }),
    run('failed', { ok: false }), run('bad-rating', { rating: 'up' }),
    run('cli', { channel: 'official-cli', actualModel: 'other' }),
    run('bad-time', { finishedAt: NaN }), run('future', { finishedAt: NOW + 1 }),
    run('reset', { finishedAt: 0 }), run('before-answer', { ratedAt: NOW - 1 }),
    { id: 'malformed', packages: [null] },
  ])
  assert.equal(result.feedbackCount, 0)
  assert.equal(result.ignoredCount, 12)
  assert.equal(Object.values(result.exclusionReasons).reduce((sum, value) => sum + value, 0), result.ignoredCount)
  assert.equal(result.exclusionReasons.superseded, 1)
  assert.equal(result.exclusionReasons.unrated, 1)
  assert.equal(result.exclusionReasons['invalid-time'], 2)
})

test('inherited execution/identity fields cannot manufacture explicit feedback', () => {
  const forged = Object.assign(Object.create(item()), { id: 'step' })
  const result = profile([{ id: 'r', createdAt: NOW, packages: [forged] }])
  assert.equal(result.feedbackCount, 0)
  assert.equal(result.exclusionReasons['invalid-route'], 1)
  const missing = profile([{ ...run(), id: undefined }])
  assert.equal(missing.feedbackCount, 0)
})

test('clear, reset, disabled and changed route profiles remove previously attached preferences', () => {
  const base = [{ provider: 'provider', model: 'model-v1', quality: 0.8, qualitySource: 'user' }]
  const attached = applyFeedbackProfile(base, profile([run()]))
  assert.ok(attached[0].preferenceAdjustments.code > 0)
  for (const next of [profile([]), profile([run()], { enabled: false }), profile([run()], { resetAt: NOW }),
    profile([run('different', { model: 'model-v2' })])]) {
    const cleared = applyFeedbackProfile(attached, next)
    assert.deepEqual(cleared, base)
    assert.equal(Object.hasOwn(cleared[0], 'preferenceAdjustments'), false)
    assert.ok(attached[0].preferenceAdjustments.code > 0, 'previous immutable projection stays intact')
  }
})

test('untrusted adjustments cannot exceed declared profile amplitude', () => {
  const routes = [{ provider: 'provider', model: 'model-v1' }]
  const result = applyFeedbackProfile(routes, { enabled: true, maxAdjustment: 0.04,
    adjustments: { [key]: { code: 0.1, writing: 0.02 } } })
  assert.deepEqual(result[0].preferenceAdjustments, { writing: 0.02 })
})

test('actualCost fails closed for missing/negative/nonfinite token and price inputs', () => {
  const prices = { input: 1, output: 1 }
  for (const usage of [{}, { inputTokens: 1 }, { outputTokens: 1 }, { inputTokens: null, outputTokens: 1 }]) {
    assert.deepEqual(actualCost({ usage }, prices), { costUsd: null, costSource: 'usage-missing' })
  }
  for (const usage of [{ inputTokens: -1, outputTokens: 0 }, { inputTokens: 1, outputTokens: NaN },
    { inputTokens: 1, outputTokens: Infinity }, { inputTokens: '1', outputTokens: 0 },
    { inputTokens: 1, outputTokens: 0, cacheReadTokens: -1 }, { inputTokens: 1, outputTokens: 0, cacheWriteTokens: null }]) {
    assert.deepEqual(actualCost({ usage }, prices), { costUsd: null, costSource: 'usage-invalid' })
  }
  for (const pricing of [{ input: -1, output: 1 }, { input: Infinity, output: 1 }, { input: 1, output: NaN },
    { input: 1, output: 1, cacheRead: -1 }, { input: 1, output: 1, cacheWrite: null }]) {
    assert.deepEqual(actualCost({ usage: { inputTokens: 1, outputTokens: 0 } }, pricing), { costUsd: null, costSource: 'price-invalid' })
  }
})

test('explicit zero usage and genuine zero-price rates remain billable known zero; valid CLI cost wins', () => {
  assert.deepEqual(actualCost({ usage: { inputTokens: 0, outputTokens: 0 } }, { input: 1, output: 1 }), { costUsd: 0, costSource: 'usage' })
  assert.deepEqual(actualCost({ usage: { inputTokens: 100, outputTokens: 50 } }, { input: 0, output: 0 }), { costUsd: 0, costSource: 'usage' })
  assert.deepEqual(actualCost({ reportedCostUsd: 0.2, usage: {} }, null), { costUsd: 0.2, costSource: 'cli-reported' })
  assert.deepEqual(actualCost({ reportedCostUsd: 0, usage: {} }, null), { costUsd: 0, costSource: 'cli-reported' })
})

test('inherited usage/rates/reported cost cannot manufacture a zero-cost result', () => {
  const pricing = { input: 1, output: 1 }
  assert.deepEqual(actualCost({ usage: Object.create({ inputTokens: 0, outputTokens: 0 }) }, pricing), { costUsd: null, costSource: 'usage-missing' })
  assert.deepEqual(actualCost({ usage: { inputTokens: 1, outputTokens: 0 } }, Object.create({ input: 0, output: 0 })), { costUsd: null, costSource: 'price-missing' })
  assert.deepEqual(actualCost(Object.create({ reportedCostUsd: 0 }), pricing), { costUsd: null, costSource: 'usage-missing' })
})

test('finite cost avoids intermediate overflow; unrepresentable cost is unknown', () => {
  assert.equal(actualCost({ usage: { inputTokens: 1e308, outputTokens: 0 } }, { input: 1, output: 1 }).costUsd, 1e302)
  assert.deepEqual(actualCost({ usage: { inputTokens: 1e308, outputTokens: 1e308 } }, { input: 1e308, output: 1e308 }), { costUsd: null, costSource: 'cost-invalid' })
})

test('new incomplete usage is recorded as unknown spend; retry preserves historical charge and clears evidence', () => {
  const plan = { team: { workPackages: [{ id: 'step', recommendedProvider: 'provider', recommendedModel: 'model-v1', type: 'code' }] } }
  const record = buildRunRecord({ id: 'new', createdAt: NOW, finishedAt: NOW, plan,
    execution: { packages: [{ id: 'step', ok: true, provider: 'provider', model: 'model-v1', usage: {} }] },
    pricingFor: () => ({ input: 1, output: 1 }) })
  assert.equal(record.packages[0].costUsd, null)
  assert.equal(spending([record], NOW).unknownToday, 1)
  const old = { ...run(), packages: [{ ...item(), costUsd: 0.25, billing: 'api', ratedAt: NOW }] }
  mergeRerun(old, { status: 'completed', packages: [{ id: 'step', ok: true, provider: 'provider', model: 'model-v1', reportedCostUsd: 0.1 }] },
    { rerunIds: ['step'], finishedAt: NOW + 1 })
  close(spending([old], NOW + 1).today, 0.35)
  assert.equal(profile([old], { now: NOW + 1 }).feedbackCount, 0)
  assert.equal(old.packages[0].rating, null)
})
