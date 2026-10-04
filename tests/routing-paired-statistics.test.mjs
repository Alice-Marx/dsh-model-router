import test from 'node:test'
import assert from 'node:assert/strict'
import { pairedRoutingComparison } from '../scripts/routing-paired-statistics.mjs'

const options = { strategy: 'new', reference: 'old', resamples: 256 }

function row(id, groupId, domain, strategyCorrect, referenceCorrect, strategyCost = 1, referenceCost = 2) {
  return { id, groupId, domain, outcomes: {
    new: { correct: strategyCorrect, costUsd: strategyCost },
    old: { correct: referenceCorrect, costUsd: referenceCost },
  } }
}

function qualityRow(id, groupId, domain, strategyQuality, referenceQuality, strategyCost = 1, referenceCost = 2) {
  return { id, groupId, domain, outcomes: {
    new: { quality: strategyQuality, costUsd: strategyCost },
    old: { quality: referenceQuality, costUsd: referenceCost },
  } }
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} versus ${expected}`)
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

test('hand-counted points retain row weights within groups and distinguish macro quality', () => {
  const data = [
    row('a1', 'a-pair', 'common', true, false, 1, 2),
    row('a2', 'a-pair', 'common', false, false, 1, 4),
    row('a3', 'a-single', 'common', false, true, 1, 2),
    row('b1', 'b-single', 'rare', true, false, 1, 4),
  ]
  const result = pairedRoutingComparison(data, options)
  near(result.point.microQualityDifference, 1 / 4)
  near(result.point.macroQualityDifference, 1 / 2)
  near(result.point.meanCostDifferenceUsd, -2)
  near(result.point.relativeSavings, 2 / 3)
  assert.deepEqual(result.sample, {
    examples: 4, groups: 3, domains: 2,
    domainCounts: { common: { examples: 3, groups: 2 }, rare: { examples: 1, groups: 1 } },
  })
})

test('continuous partial credit is preserved in micro and macro paired quality', () => {
  const data = deepFreeze([
    qualityRow('a1', 'common-pair', 'common', 0.5, 0.25),
    qualityRow('a2', 'common-pair', 'common', 0.75, 0.75),
    qualityRow('b1', 'rare-single', 'rare', 0.9, 0.5),
  ])
  const result = pairedRoutingComparison(data, options)
  near(result.point.microQualityDifference, 0.65 / 3)
  near(result.point.macroQualityDifference, (0.125 + 0.4) / 2)
  near(result.point.meanCostDifferenceUsd, -1)
  near(result.point.relativeSavings, 0.5)
  near(result.twoSidedPercentile.metrics.microQualityDifference.lower, 0.65 / 3)
  near(result.twoSidedPercentile.metrics.microQualityDifference.upper, 0.65 / 3)
  assert.equal(result.conclusion.qualityCostBenefit, true)
})

test('partial-credit losses fail zero-margin non-inferiority and respect a declared margin', () => {
  const data = [
    qualityRow('a', 'a', 'math', 0.49, 0.5),
    qualityRow('b', 'b', 'math', 0.49, 0.5),
  ]
  const strict = pairedRoutingComparison(data, options)
  near(strict.point.microQualityDifference, -0.01)
  assert.equal(strict.conclusion.qualityNonInferior, false)
  assert.equal(strict.conclusion.costLower, true)
  assert.equal(strict.conclusion.qualityCostBenefit, false)
  const allowed = pairedRoutingComparison(data, { ...options, nonInferiorityMargin: 0.011 })
  assert.equal(allowed.conclusion.qualityCostBenefit, true)
})

test('explicit quality endpoints agree with legacy boolean outcomes', () => {
  const legacy = [
    row('a', 'a', 'math', true, false),
    row('b', 'b', 'math', false, true),
  ]
  const numeric = legacy.map(item => ({ ...item, outcomes: Object.fromEntries(Object.entries(item.outcomes)
    .map(([name, outcome]) => [name, { quality: Number(outcome.correct), costUsd: outcome.costUsd }])) }))
  const both = legacy.map(item => ({ ...item, outcomes: Object.fromEntries(Object.entries(item.outcomes)
    .map(([name, outcome]) => [name, { ...outcome, quality: Number(outcome.correct) }])) }))
  assert.deepEqual(pairedRoutingComparison(numeric, options), pairedRoutingComparison(legacy, options))
  assert.deepEqual(pairedRoutingComparison(both, options), pairedRoutingComparison(legacy, options))
})

test('whole-group pairing never separates correlated rows', () => {
  const result = pairedRoutingComparison([
    row('a', 'inseparable', 'only', true, false, 1, 2),
    row('b', 'inseparable', 'only', false, true, 2, 1),
  ], options)
  assert.deepEqual(result.point, {
    microQualityDifference: 0, macroQualityDifference: 0, meanCostDifferenceUsd: 0, relativeSavings: 0,
  })
  for (const interval of Object.values(result.twoSidedPercentile.metrics)) {
    assert.deepEqual(interval, { lower: 0, upper: 0 })
  }
  assert.deepEqual(result.bootstrap.domainsWithFewerThanTwoGroups, ['only'])
})

test('domain stratification preserves a rare domain in every replicate', () => {
  const result = pairedRoutingComparison([
    row('a1', 'common-family', 'common', true, false),
    row('a2', 'common-family', 'common', true, false),
    row('a3', 'common-family', 'common', true, false),
    row('b', 'rare-family', 'rare', false, true),
  ], options)
  near(result.point.microQualityDifference, 0.5)
  near(result.point.macroQualityDifference, 0)
  assert.deepEqual(result.twoSidedPercentile.metrics.microQualityDifference, { lower: 0.5, upper: 0.5 })
  assert.deepEqual(result.twoSidedPercentile.metrics.macroQualityDifference, { lower: 0, upper: 0 })
})

test('fixed seeds and ordering produce deterministic results without mutating frozen input', () => {
  const data = deepFreeze([
    row('b', 'b', 'math', false, true, 2, 1),
    row('a', 'a', 'math', true, false, 1, 3),
    row('c', 'c', 'code', true, true, 2, 4),
  ])
  const before = JSON.stringify(data)
  const original = pairedRoutingComparison(data, options)
  assert.deepEqual(pairedRoutingComparison(data, options), original)
  assert.deepEqual(pairedRoutingComparison([...data].reverse(), options), original)
  assert.equal(JSON.stringify(data), before)
  assert.equal(original.oneSidedBonferroni.tailProbability, 0.05 / 6)
  assert.equal(original.oneSidedBonferroni.familyEndpoints, 6)
})

test('strictly better quality and lower cost satisfy the preregistered benefit rule', () => {
  const result = pairedRoutingComparison([
    row('a', 'a', 'math', true, false),
    row('b', 'b', 'math', true, false),
    row('c', 'c', 'code', true, false),
  ], options)
  assert.equal(result.oneSidedBonferroni.qualityLowerBound, 1)
  assert.equal(result.oneSidedBonferroni.costUpperBoundUsd, -1)
  assert.equal(result.conclusion.qualityNonInferior, true)
  assert.equal(result.conclusion.costLower, true)
  assert.equal(result.conclusion.qualityCostBenefit, true)
})

test('lower quality cannot pass a zero-margin claim even when costs fall', () => {
  const result = pairedRoutingComparison([
    row('a', 'a', 'math', false, true),
    row('b', 'b', 'math', false, true),
  ], options)
  assert.equal(result.conclusion.qualityNonInferior, false)
  assert.equal(result.conclusion.costLower, true)
  assert.equal(result.conclusion.qualityCostBenefit, false)
})

test('equivalent ordinary-range cost multisets cannot produce a floating-point savings claim', () => {
  const data = Array.from({ length: 2 }, (_, groupIndex) => [0, 1, 2].map(index => qualityRow(
    `g${groupIndex}-r${index}`, `g${groupIndex}`, 'd', 1, 1,
    [0.0001, 0.0001, 1][index], [1, 0.0001, 0.0001][index],
  ))).flat()
  const result = pairedRoutingComparison(data, { ...options, resamples: 4000 })
  near(result.point.meanCostDifferenceUsd, 0)
  assert.equal(result.point.meanCostDifferenceUsd, 0)
  assert.equal(result.oneSidedBonferroni.costUpperBoundUsd, 0)
  assert.equal(result.conclusion.costLower, false)
  assert.equal(result.conclusion.qualityCostBenefit, false)
  near(result.numerics.costMeanScaleUsd, 1.0002 / 3)
  assert.equal(result.numerics.costSignToleranceUsd, 32 * Number.EPSILON * result.numerics.costMeanScaleUsd)
})

test('the cost guard scales with tiny real fees instead of using an absolute-dollar floor', () => {
  const data = [
    qualityRow('a', 'a', 'd', 1, 1, 5e-25, 1e-24),
    qualityRow('b', 'b', 'd', 1, 1, 5e-25, 1e-24),
  ]
  const result = pairedRoutingComparison(data, options)
  assert.equal(result.point.meanCostDifferenceUsd, -5e-25)
  assert.ok(result.numerics.costSignToleranceUsd > 0)
  assert.ok(result.numerics.costSignToleranceUsd < 1e-37)
  assert.equal(result.conclusion.qualityNonInferior, true)
  assert.equal(result.conclusion.costLower, true)
  assert.equal(result.conclusion.qualityCostBenefit, true)
})

test('ULP-sized apparent savings alone cannot establish a lower-cost claim', () => {
  const result = pairedRoutingComparison([
    qualityRow('a', 'a', 'd', 1, 1, 1 - Number.EPSILON, 1),
    qualityRow('b', 'b', 'd', 1, 1, 1 - Number.EPSILON, 1),
  ], options)
  assert.ok(result.oneSidedBonferroni.costUpperBoundUsd < 0)
  assert.ok(result.oneSidedBonferroni.costUpperBoundUsd >= -result.numerics.costSignToleranceUsd)
  assert.equal(result.conclusion.costLower, false)
  assert.equal(result.conclusion.qualityCostBenefit, false)
})

test('tiny genuine quality losses are not cancelled by separate strategy totals', () => {
  const data = Array.from({ length: 2 }, (_, groupIndex) => [0, 1, 2].map(index => qualityRow(
    `g${groupIndex}-r${index}`, `g${groupIndex}`, 'd',
    [1, 1, 0.5][index], [1, 1, 0.5000000000000001][index],
  ))).flat()
  const result = pairedRoutingComparison(data, { ...options, resamples: 4000 })
  assert.ok(result.point.microQualityDifference < 0)
  assert.ok(result.oneSidedBonferroni.qualityLowerBound < 0)
  assert.ok(result.oneSidedBonferroni.qualityMarginLowerBound < 0)
  assert.equal(result.conclusion.qualityNonInferior, false)
  assert.equal(result.conclusion.costLower, true)
  assert.equal(result.conclusion.qualityCostBenefit, false)
})

test('near-margin quality losses do not become non-inferior after summation rounding', () => {
  const data = Array.from({ length: 2 }, (_, groupIndex) => [0, 1, 2].map(index => qualityRow(
    `g${groupIndex}-r${index}`, `g${groupIndex}`, 'd', [1, 1, 0.4999999999999999][index], 1,
  ))).flat()
  const result = pairedRoutingComparison(data, { ...options, nonInferiorityMargin: 1 / 6 })
  assert.ok(result.oneSidedBonferroni.qualityMarginLowerBound < 0)
  assert.equal(result.conclusion.qualityNonInferior, false)
  assert.equal(result.conclusion.qualityCostBenefit, false)
})

test('quality underflow cannot turn a nonzero loss into a non-inferiority claim', () => {
  const data = Array.from({ length: 2 }, (_, groupIndex) => [0, 1].map(index => qualityRow(
    `g${groupIndex}-r${index}`, `g${groupIndex}`, 'd', 0, index === 0 ? Number.MIN_VALUE : 0,
  ))).flat()
  const result = pairedRoutingComparison(data, options)
  assert.ok(result.point.microQualityDifference === 0)
  assert.equal(result.oneSidedBonferroni.qualityMarginLowerBound, null)
  assert.equal(result.conclusion.qualityNonInferior, false)
  assert.equal(result.conclusion.costLower, true)
  assert.equal(result.conclusion.qualityCostBenefit, false)
  assert.ok(result.limitations.some(text => /underflow.*non-inferiority/.test(text)))
})

test('a quality bound rounded onto the margin still fails its compensated boundary guard', () => {
  const result = pairedRoutingComparison([
    qualityRow('a', 'family', 'd', 0, 0.5),
    qualityRow('b', 'family', 'd', 0, 0.5),
    qualityRow('c', 'family', 'd', 0, 0.5000000000000001),
  ], { ...options, nonInferiorityMargin: 0.5 })
  assert.equal(result.oneSidedBonferroni.qualityLowerBound, -0.5)
  assert.ok(result.oneSidedBonferroni.qualityMarginLowerBound < 0)
  assert.equal(result.conclusion.qualityNonInferior, false)
  assert.equal(result.conclusion.qualityCostBenefit, false)
})

test('non-inferiority includes the declared margin but savings require a strict cost decrease', () => {
  const data = [
    row('a', 'family', 'math', false, true),
    row('b', 'family', 'math', true, true),
  ]
  const accepted = pairedRoutingComparison(data, { ...options, nonInferiorityMargin: 0.5 })
  assert.equal(accepted.oneSidedBonferroni.qualityLowerBound, -0.5)
  assert.equal(accepted.conclusion.qualityCostBenefit, true)
  const equalCost = data.map(item => ({ ...item, outcomes: {
    new: { ...item.outcomes.new, costUsd: item.outcomes.old.costUsd }, old: item.outcomes.old,
  } }))
  const rejected = pairedRoutingComparison(equalCost, { ...options, nonInferiorityMargin: 0.5 })
  assert.equal(rejected.conclusion.qualityNonInferior, true)
  assert.equal(rejected.conclusion.costLower, false)
  assert.equal(rejected.conclusion.qualityCostBenefit, false)
})

test('zero costs keep absolute differences zero and relative savings undefined', () => {
  const result = pairedRoutingComparison([
    row('a', 'a', 'math', true, true, 0, 0),
    row('b', 'b', 'math', false, false, 0, 0),
  ], options)
  assert.deepEqual(result.point, {
    microQualityDifference: 0, macroQualityDifference: 0, meanCostDifferenceUsd: 0, relativeSavings: null,
  })
  for (const metric of ['microQualityDifference', 'macroQualityDifference', 'meanCostDifferenceUsd']) {
    assert.deepEqual(result.twoSidedPercentile.metrics[metric], { lower: 0, upper: 0 })
  }
  assert.deepEqual(result.twoSidedPercentile.metrics.relativeSavings, { lower: null, upper: null })
  assert.equal(result.bootstrap.relativeSavingsDefinedResamples, 0)
  assert.equal(result.conclusion.qualityCostBenefit, false)
})

test('undefined bootstrap ratios are not silently discarded from savings intervals', () => {
  const result = pairedRoutingComparison([
    row('zero', 'zero', 'math', true, true, 0, 0),
    row('paid', 'paid', 'math', true, true, 1, 2),
  ], options)
  near(result.point.relativeSavings, 0.5)
  assert.ok(result.bootstrap.relativeSavingsDefinedResamples > 0)
  assert.ok(result.bootstrap.relativeSavingsDefinedResamples < options.resamples)
  assert.deepEqual(result.twoSidedPercentile.metrics.relativeSavings, { lower: null, upper: null })
  assert.notEqual(result.twoSidedPercentile.metrics.meanCostDifferenceUsd.lower, null)
})

test('empty data returns unavailable estimates and cannot support a benefit claim', () => {
  const result = pairedRoutingComparison([], options)
  assert.deepEqual(result.sample, { examples: 0, groups: 0, domains: 0, domainCounts: {} })
  assert.deepEqual(result.point, {
    microQualityDifference: null, macroQualityDifference: null, meanCostDifferenceUsd: null, relativeSavings: null,
  })
  for (const interval of Object.values(result.twoSidedPercentile.metrics)) {
    assert.deepEqual(interval, { lower: null, upper: null })
  }
  assert.equal(result.oneSidedBonferroni.qualityLowerBound, null)
  assert.equal(result.oneSidedBonferroni.costUpperBoundUsd, null)
  assert.equal(result.bootstrap.completedResamples, 0)
  assert.equal(result.conclusion.qualityCostBenefit, false)
  assert.ok(result.limitations.some(text => /genuinely paired question outcomes/.test(text)))
  assert.ok(result.limitations.some(text => /task or category means cannot/.test(text)))
})

test('the same strategy compares to itself with zero differences', () => {
  const result = pairedRoutingComparison([
    row('a', 'a', 'math', true, false, 2, 3),
    row('b', 'b', 'math', false, true, 4, 1),
  ], { ...options, reference: 'new' })
  assert.deepEqual(result.point, {
    microQualityDifference: 0, macroQualityDifference: 0, meanCostDifferenceUsd: 0, relativeSavings: 0,
  })
  assert.equal(result.conclusion.costLower, false)
})

test('extreme finite costs do not overflow means or emit non-finite savings', () => {
  const same = pairedRoutingComparison([
    row('a', 'a', 'math', true, true, Number.MAX_VALUE, Number.MAX_VALUE),
    row('b', 'b', 'math', false, false, Number.MAX_VALUE, Number.MAX_VALUE),
  ], options)
  assert.equal(same.point.meanCostDifferenceUsd, 0)
  assert.equal(same.point.relativeSavings, 0)
  const extremeRatio = pairedRoutingComparison([
    row('a', 'a', 'math', true, true, Number.MAX_VALUE, Number.MIN_VALUE),
  ], options)
  assert.equal(extremeRatio.point.meanCostDifferenceUsd, Number.MAX_VALUE)
  assert.equal(extremeRatio.point.relativeSavings, null)
  assert.equal(extremeRatio.numerics.originalMeanStrategyCostUsd, Number.MAX_VALUE)
  assert.equal(extremeRatio.numerics.originalMeanReferenceCostUsd, Number.MIN_VALUE)
  assert.deepEqual(extremeRatio.twoSidedPercentile.metrics.relativeSavings, { lower: null, upper: null })
})

test('object-property names remain safe in domain and outcome dictionaries', () => {
  const item = row('a', 'a', '__proto__', true, true)
  Object.defineProperty(item.outcomes, '__proto__', { value: { correct: true, costUsd: 1 }, enumerable: true })
  const result = pairedRoutingComparison([item], { ...options, strategy: '__proto__' })
  assert.deepEqual(result.sample.domainCounts.__proto__, { examples: 1, groups: 1 })
  assert.equal(Object.hasOwn(result.sample.domainCounts, '__proto__'), true)
  assert.equal(result.point.meanCostDifferenceUsd, -1)
})

test('validation rejects duplicate IDs, cross-domain groups, malformed outcomes, and unsafe options', async t => {
  const cases = [
    ['null rows', () => pairedRoutingComparison(null, options), /rows: must be an array/],
    ['duplicate IDs', () => pairedRoutingComparison([row('a', 'a', 'math', true, true), row('a', 'b', 'math', true, true)], options), /duplicate IDs/],
    ['cross-domain group', () => pairedRoutingComparison([row('a', 'same', 'math', true, true), row('b', 'same', 'code', true, true)], options), /cannot span domains/],
    ['empty group ID', () => pairedRoutingComparison([{ ...row('a', 'a', 'math', true, true), groupId: '' }], options), /groupId/],
    ['numeric correctness', () => pairedRoutingComparison([row('a', 'a', 'math', 1, true)], options), /correct.*boolean/],
    ['negative quality', () => pairedRoutingComparison([qualityRow('a', 'a', 'math', -0.1, 0.5)], options), /quality.*between 0 and 1/],
    ['excessive quality', () => pairedRoutingComparison([qualityRow('a', 'a', 'math', 1.1, 0.5)], options), /quality.*between 0 and 1/],
    ['NaN quality', () => pairedRoutingComparison([qualityRow('a', 'a', 'math', NaN, 0.5)], options), /quality/],
    ['infinite quality', () => pairedRoutingComparison([qualityRow('a', 'a', 'math', Infinity, 0.5)], options), /quality/],
    ['string quality', () => pairedRoutingComparison([qualityRow('a', 'a', 'math', '0.5', 0.5)], options), /quality/],
    ['missing quality and correctness', () => pairedRoutingComparison([{ ...row('a', 'a', 'math', true, true), outcomes: { new: { costUsd: 1 }, old: { quality: 1, costUsd: 2 } } }], options), /must provide quality or correct/],
    ['conflicting quality and correctness', () => pairedRoutingComparison([{ ...qualityRow('a', 'a', 'math', 0.5, 1), outcomes: { new: { quality: 0.5, correct: true, costUsd: 1 }, old: { quality: 1, costUsd: 2 } } }], options), /conflicting quality and correct/],
    ['malformed correctness alongside quality', () => pairedRoutingComparison([{ ...qualityRow('a', 'a', 'math', 1, 1), outcomes: { new: { quality: 1, correct: 1, costUsd: 1 }, old: { quality: 1, costUsd: 2 } } }], options), /correct.*boolean/],
    ['missing strategy', () => pairedRoutingComparison([row('a', 'a', 'math', true, true)], { ...options, strategy: 'missing' }), /missing strategy outcome/],
    ['missing cost', () => pairedRoutingComparison([{ ...row('a', 'a', 'math', true, true), outcomes: { new: { correct: true }, old: { correct: true, costUsd: 1 } } }], options), /costUsd/],
    ['negative cost', () => pairedRoutingComparison([row('a', 'a', 'math', true, true, -1, 2)], options), /costUsd/],
    ['infinite cost', () => pairedRoutingComparison([row('a', 'a', 'math', true, true, Infinity, 2)], options), /costUsd/],
    ['NaN cost', () => pairedRoutingComparison([row('a', 'a', 'math', true, true, NaN, 2)], options), /costUsd/],
    ['zero resamples', () => pairedRoutingComparison([], { ...options, resamples: 0 }), /resamples/],
    ['fractional resamples', () => pairedRoutingComparison([], { ...options, resamples: 1.5 }), /resamples/],
    ['negative seed', () => pairedRoutingComparison([], { ...options, seed: -1 }), /seed/],
    ['unsafe seed', () => pairedRoutingComparison([], { ...options, seed: 2 ** 32 }), /seed/],
    ['zero alpha', () => pairedRoutingComparison([], { ...options, alpha: 0 }), /alpha/],
    ['unit alpha', () => pairedRoutingComparison([], { ...options, alpha: 1 }), /alpha/],
    ['zero claims', () => pairedRoutingComparison([], { ...options, claims: 0 }), /claims/],
    ['negative margin', () => pairedRoutingComparison([], { ...options, nonInferiorityMargin: -0.01 }), /nonInferiorityMargin/],
    ['excessive margin', () => pairedRoutingComparison([], { ...options, nonInferiorityMargin: 1.1 }), /nonInferiorityMargin/],
    ['unrepresentable tail', () => pairedRoutingComparison([], { ...options, alpha: Number.MIN_VALUE }), /tail probability/],
  ]
  for (const [name, run, pattern] of cases) await t.test(name, () => assert.throws(run, pattern))
})
