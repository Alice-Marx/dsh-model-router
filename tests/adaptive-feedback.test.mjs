import assert from 'node:assert/strict'
import test from 'node:test'
import { applyFeedbackProfile, buildFeedbackProfile, FEEDBACK_POLICY_VERSION } from '../.dsh-plugin/shared/adaptive-feedback.mjs'

const DAY = 86_400_000
const NOW = 2_000 * DAY
const opts = { now: NOW }
const item = (changes = {}) => ({ id: 'package', provider: 'p', model: 'm-v1', type: 'code', rating: 1,
  ran: true, ok: true, status: 'succeeded', channel: 'harness-llm', finishedAt: NOW, ...changes })
const run = (changes = {}, packageChanges = {}) => ({ id: 'run', createdAt: NOW, finishedAt: NOW,
  packages: [item(packageChanges)], ...changes })
const bias = (profile, model = 'm-v1', domain = 'code') => profile.adjustments[`p\0${model}`]?.[domain]
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)

test('one local explicit feedback is shrunk and separately labelled subjective utility', () => {
  const profile = buildFeedbackProfile([run()], opts)
  close(bias(profile), 0.01)
  assert.equal(profile.policyVersion, FEEDBACK_POLICY_VERSION)
  assert.equal(profile.scope, 'local-dsh-home')
  assert.equal(profile.window, 'last-200-runs')
  assert.equal(profile.feedbackCount, 1)
  assert.equal(profile.ignoredCount, 0)
  assert.equal(profile.effectiveWeight, 1)
  assert.equal(profile.updatedAt, NOW)
  assert.match(profile.revision, /^subjective-utility-v1:[a-f0-9]{8}$/)
})

test('opposing evidence cancels, many ratings remain bounded, caller data stays unchanged', () => {
  const runs = [run({}, { rating: 1 }), run({ id: 'run2' }, { rating: -1 })]
  const copy = structuredClone(runs)
  close(bias(buildFeedbackProfile(runs, opts)), 0)
  assert.deepEqual(runs, copy)
  const many = Array.from({ length: 200 }, (_, index) => run({ id: `r${index}` }))
  const profile = buildFeedbackProfile(many, { ...opts, maxAdjustment: 0.1, priorWeight: 1 })
  assert.ok(bias(profile) > 0 && bias(profile) < 0.1)
})

test('task domains and exact model versions are isolated, missing type is general', () => {
  const profile = buildFeedbackProfile([
    run(), run({ id: 'write' }, { type: 'writing', rating: -1 }),
    run({ id: 'version' }, { model: 'm-v2', rating: -1 }),
    run({ id: 'missing' }, { type: undefined }),
  ], opts)
  close(bias(profile), 0.01)
  close(bias(profile, 'm-v1', 'writing'), -0.01)
  close(bias(profile, 'm-v2'), -0.01)
  close(bias(profile, 'm-v1', 'general'), 0.01)
  assert.equal(bias(profile, 'm-v1', 'math'), undefined)
  assert.equal(bias(profile, 'm-v3'), undefined)
})

test('a half-life halves effective weight, not the shrunk bias; age uses completion', () => {
  const profile = buildFeedbackProfile([run({}, { finishedAt: NOW - 30 * DAY, ratedAt: NOW })], opts)
  close(profile.effectiveWeight, 0.5)
  close(bias(profile), 0.04 * 0.5 / 3.5)
  assert.equal(profile.updatedAt, NOW)
  assert.ok(bias(profile) < 0.01)
  const later = buildFeedbackProfile([run({}, { finishedAt: NOW - 60 * DAY })], opts)
  close(later.effectiveWeight, 0.25)
  assert.ok(bias(later) < bias(profile))
})

test('clear and absent ratings are not negative feedback; reviews are excluded', () => {
  const profile = buildFeedbackProfile([
    run({}, { rating: null, review: { score: 1 } }),
    run({ id: 'zero' }, { rating: 0 }),
    run({ id: 'absent' }, { rating: undefined }),
    run({ id: 'review' }, { rating: 1, review: { score: 1 } }),
  ], opts)
  assert.equal(profile.feedbackCount, 1)
  assert.equal(profile.ignoredCount, 3)
  close(bias(profile), 0.01)
})

for (const changes of [{ ran: false }, { ran: undefined }, { ok: false }, { ok: undefined },
  { blocked: true }, { waiting: true }, { paused: true }, { cancelled: true },
  { status: 'failed' }, { status: 'waiting' }, { status: 'pending' }, { status: 'timed-out' }, { status: 'model-mismatch' }]) {
  test(`unexecuted or non-successful result is ignored: ${JSON.stringify(changes)}`, () => {
    const profile = buildFeedbackProfile([run({}, changes)], opts)
    assert.equal(profile.feedbackCount, 0)
    assert.equal(profile.ignoredCount, 1)
    assert.deepEqual(profile.adjustments, {})
  })
}

test('official CLI requires an exact reported actual model; defaults and aliases do not train it', () => {
  const profile = buildFeedbackProfile([
    run({}, { channel: 'official-cli', actualModel: null }),
    run({ id: 'different' }, { channel: 'official-cli', actualModel: 'm-v2' }),
    run({ id: 'alias' }, { channel: 'official-cli', actualModel: 'm' }),
    run({ id: 'same' }, { channel: 'official-cli', actualModel: 'm-v1' }),
  ], opts)
  assert.equal(profile.feedbackCount, 1)
  assert.equal(profile.ignoredCount, 3)
  close(bias(profile), 0.01)
})

test('future, missing, nonfinite or malformed timestamps are not repaired into evidence', () => {
  const runs = [
    run({}, { finishedAt: NOW + 1 }),
    run({ id: 'future-rating' }, { ratedAt: NOW + 1 }),
    run({ id: 'missing', createdAt: undefined, finishedAt: undefined }, { finishedAt: undefined }),
    run({ id: 'nan' }, { finishedAt: NaN }),
    run({ id: 'string' }, { finishedAt: String(NOW) }),
    run({ id: 'negative' }, { finishedAt: -1 }),
  ]
  const profile = buildFeedbackProfile(runs, opts)
  assert.equal(profile.feedbackCount, 0)
  assert.equal(profile.ignoredCount, runs.length)
})

test('valid run completion or creation can supply an absent package timestamp', () => {
  const profile = buildFeedbackProfile([
    run({}, { finishedAt: undefined }),
    run({ id: 'creation', finishedAt: undefined }, { finishedAt: undefined }),
  ], opts)
  assert.equal(profile.feedbackCount, 2)
  close(bias(profile), 0.04 * 2 / 5)
})

test('reset excludes completion at or before its boundary, even a new rating of an old result', () => {
  const profile = buildFeedbackProfile([
    run({}, { finishedAt: NOW - 1, ratedAt: NOW }),
    run({ id: 'equal' }, { finishedAt: NOW, ratedAt: NOW }),
  ], { ...opts, resetAt: NOW })
  assert.equal(profile.feedbackCount, 0)
  assert.equal(profile.ignoredCount, 2)
  assert.deepEqual(profile.adjustments, {})
})

test('last run/package occurrence wins; changed and cleared feedback are idempotent', () => {
  const up = run()
  const down = run({}, { rating: -1 })
  const cleared = run({}, { rating: null })
  const changed = buildFeedbackProfile([up, down], opts)
  close(bias(changed), -0.01)
  assert.equal(changed.feedbackCount, 1)
  assert.equal(changed.ignoredCount, 1)
  assert.equal(changed.revision, buildFeedbackProfile([down], opts).revision)
  const erased = buildFeedbackProfile([up, down, cleared], opts)
  assert.equal(erased.feedbackCount, 0)
  assert.equal(erased.ignoredCount, 3)
  assert.deepEqual(erased.adjustments, {})
  const retried = buildFeedbackProfile([up, run({}, { ok: false, status: 'failed' })], opts)
  assert.equal(retried.feedbackCount, 0)
})

test('duplicate package IDs inside one run do not create independent observations', () => {
  const profile = buildFeedbackProfile([run({ packages: [item(), item({ rating: -1 })] })], opts)
  assert.equal(profile.feedbackCount, 1)
  assert.equal(profile.ignoredCount, 1)
  close(bias(profile), -0.01)
})

test('window contains only the last 200 runs; missing identities are ignored', () => {
  const runs = Array.from({ length: 201 }, (_, index) => run({ id: `r${index}` }, { rating: index === 0 ? -1 : 1 }))
  const profile = buildFeedbackProfile(runs, opts)
  assert.equal(profile.feedbackCount, 200)
  assert.equal(profile.effectiveWeight, 200)
  const missing = buildFeedbackProfile([run({ id: undefined }), run({ id: 'r' }, { id: undefined })], opts)
  assert.equal(missing.feedbackCount, 0)
  assert.equal(missing.ignoredCount, 2)
})

test('disabled and zero adjustment policies preserve evidence semantics without changing quality', () => {
  const disabled = buildFeedbackProfile([run()], { ...opts, enabled: false })
  assert.equal(disabled.feedbackCount, 0)
  assert.deepEqual(disabled.adjustments, {})
  const zero = buildFeedbackProfile([run()], { ...opts, maxAdjustment: 0 })
  assert.equal(zero.feedbackCount, 1)
  assert.equal(bias(zero), 0)
  const routes = [{ provider: 'p', model: 'm-v1', quality: 0.5, qualitySource: 'unknown' }]
  assert.deepEqual(applyFeedbackProfile(routes, disabled), routes)
})

test('revision is deterministic, short, sensitive to policy/time/events and excludes task contents', () => {
  const first = run({ task: 'secret prompt' }, { answer: 'secret answer' })
  const second = run({ id: 'other' }, { rating: -1, type: 'writing' })
  const profile = buildFeedbackProfile([first, second], opts)
  assert.equal(profile.revision, buildFeedbackProfile([second, first], opts).revision)
  assert.equal(profile.revision, buildFeedbackProfile([run({ task: 'different prompt' }, { answer: 'different answer' }), second], opts).revision)
  assert.equal(profile.revision, buildFeedbackProfile([first, second], { ...opts, now: NOW + 1 }).revision)
  assert.notEqual(profile.revision, buildFeedbackProfile([first, second], { ...opts, now: NOW + 3_600_000 }).revision)
  assert.notEqual(profile.revision, buildFeedbackProfile([first, second], { ...opts, priorWeight: 4 }).revision)
  assert.notEqual(profile.revision, buildFeedbackProfile([first], opts).revision)
  assert.equal(JSON.stringify(profile).includes('secret'), false)
})

test('apply attaches only exact route domain preferences and metadata, without mutating baseline quality', () => {
  const profile = buildFeedbackProfile([run()], opts)
  const routes = [
    { provider: 'p', model: 'm-v1', quality: 0.8, qualitySource: 'livebench', qualityBias: 0.02 },
    { provider: 'p', model: 'm-v2', qualitySource: 'unknown' },
  ]
  const copy = structuredClone(routes)
  const applied = applyFeedbackProfile(routes, profile)
  assert.deepEqual(routes, copy)
  assert.equal(applied[0].quality, 0.8)
  assert.equal(applied[0].qualitySource, 'livebench')
  assert.equal(applied[0].qualityBias, 0.02)
  close(applied[0].preferenceAdjustments.code, 0.01)
  assert.equal(applied[0].preferenceAdjustments.math, undefined)
  assert.equal(applied[0].preferenceAdjustmentMeta.revision, profile.revision)
  assert.equal(applied[1], routes[1])
})

test('opaque identifier keys are safe and untrusted adjustment numbers are not attached', () => {
  const profile = buildFeedbackProfile([run({}, { type: '__proto__' })], opts)
  assert.equal(Object.hasOwn(profile.adjustments['p\0m-v1'], '__proto__'), true)
  const routes = [{ provider: 'p', model: 'm-v1', qualitySource: 'unknown' }]
  const applied = applyFeedbackProfile(routes, { enabled: true, adjustments: { 'p\0m-v1': { code: 1, math: NaN } } })
  assert.equal(applied[0], routes[0])
  assert.equal(Object.prototype.polluted, undefined)
})

test('provider/model NUL separators cannot create a cross-route key collision', () => {
  const profile = buildFeedbackProfile([
    run({}, { provider: 'p\0alias', model: 'm-v1' }),
    run({ id: 'collision' }, { provider: 'p', model: 'alias\0m-v1' }),
  ], opts)
  assert.equal(profile.feedbackCount, 0)
  assert.equal(profile.ignoredCount, 2)
  assert.deepEqual(profile.adjustments, {})
})

for (const [key, invalid] of Object.entries({
  now: [-1, NaN, Infinity, '1'],
  halfLifeDays: [0, 3651, NaN, '30'],
  priorWeight: [0, 1_000_001, Infinity, '3'],
  maxAdjustment: [-0.1, 0.10001, Infinity, '0.04'],
  resetAt: [-1, NaN, '1'],
})) {
  test(`strict numeric bounds for ${key}`, () => {
    for (const value of invalid) assert.throws(() => buildFeedbackProfile([], { ...opts, [key]: value }), RangeError)
  })
}

test('inclusive option boundaries and fractional half-life are allowed', () => {
  const lower = buildFeedbackProfile([run()], { ...opts, halfLifeDays: 1, priorWeight: 1, maxAdjustment: 0, resetAt: 0 })
  assert.equal(lower.feedbackCount, 1)
  const upper = buildFeedbackProfile([run()], { ...opts, halfLifeDays: 3650, priorWeight: 1_000_000, maxAdjustment: 0.1 })
  assert.equal(upper.feedbackCount, 1)
  assert.doesNotThrow(() => buildFeedbackProfile([], { ...opts, halfLifeDays: 1.5 }))
  assert.throws(() => buildFeedbackProfile([], { ...opts, enabled: 1 }), TypeError)
  assert.throws(() => buildFeedbackProfile([], null), TypeError)
})
