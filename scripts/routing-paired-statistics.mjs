// Offline paired summaries only. Callers must freeze strategies before joining
// outcomes and state whether their supplied costs are recorded or estimated.

const METRICS = ['microQualityDifference', 'macroQualityDifference', 'meanCostDifferenceUsd', 'relativeSavings']
const COST_SIGN_ULPS = 32

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`)
}

function requireRecord(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(path, 'must be a plain object')
  }
}

function requireText(value, path) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    fail(path, 'must be a non-empty string without surrounding whitespace')
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function validateOptions(options) {
  requireRecord(options, 'options')
  const {
    strategy, reference, seed = 20261003, resamples = 4000,
    alpha = 0.05, claims = 3, nonInferiorityMargin = 0,
  } = options
  requireText(strategy, 'options.strategy')
  requireText(reference, 'options.reference')
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    fail('options.seed', 'must be an unsigned 32-bit integer')
  }
  if (!Number.isSafeInteger(resamples) || resamples < 1) {
    fail('options.resamples', 'must be a positive safe integer')
  }
  if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    fail('options.alpha', 'must be between 0 and 1, exclusively')
  }
  if (!Number.isSafeInteger(claims) || claims < 1) {
    fail('options.claims', 'must be a positive safe integer')
  }
  if (typeof nonInferiorityMargin !== 'number' || !Number.isFinite(nonInferiorityMargin)
      || nonInferiorityMargin < 0 || nonInferiorityMargin > 1) {
    fail('options.nonInferiorityMargin', 'must be a finite number between 0 and 1')
  }
  const tailProbability = alpha / (2 * claims)
  if (tailProbability <= 0 || 1 - tailProbability === 1) {
    fail('options.alpha', 'adjusted tail probability must be representable between 0 and 1')
  }
  return { strategy, reference, seed, resamples, alpha, claims, nonInferiorityMargin, tailProbability }
}

function validateRows(rows, strategy, reference) {
  if (!Array.isArray(rows)) fail('rows', 'must be an array')
  const ids = new Set()
  const groupDomains = new Map()
  const normalized = []
  for (const [index, row] of rows.entries()) {
    const path = `rows[${index}]`
    requireRecord(row, path)
    for (const name of ['id', 'groupId', 'domain']) requireText(row[name], `${path}.${name}`)
    if (ids.has(row.id)) fail(`${path}.id`, 'duplicate IDs are prohibited')
    ids.add(row.id)
    if (groupDomains.has(row.groupId) && groupDomains.get(row.groupId) !== row.domain) {
      fail(`${path}.groupId`, 'a group cannot span domains in a domain-stratified bootstrap')
    }
    groupDomains.set(row.groupId, row.domain)
    requireRecord(row.outcomes, `${path}.outcomes`)
    const outcomes = {}
    for (const name of new Set([strategy, reference])) {
      const outcomePath = `${path}.outcomes[${JSON.stringify(name)}]`
      if (!Object.hasOwn(row.outcomes, name)) fail(outcomePath, 'missing strategy outcome')
      const outcome = row.outcomes[name]
      requireRecord(outcome, outcomePath)
      const hasQuality = Object.hasOwn(outcome, 'quality')
      const hasCorrect = Object.hasOwn(outcome, 'correct')
      if (!hasQuality && !hasCorrect) fail(outcomePath, 'must provide quality or correct')
      if (hasCorrect && typeof outcome.correct !== 'boolean') fail(`${outcomePath}.correct`, 'must be a boolean')
      if (hasQuality && (typeof outcome.quality !== 'number' || !Number.isFinite(outcome.quality)
          || outcome.quality < 0 || outcome.quality > 1)) {
        fail(`${outcomePath}.quality`, 'must be a finite number between 0 and 1')
      }
      if (hasQuality && hasCorrect && outcome.quality !== Number(outcome.correct)) {
        fail(outcomePath, 'conflicting quality and correct values')
      }
      if (typeof outcome.costUsd !== 'number' || !Number.isFinite(outcome.costUsd) || outcome.costUsd < 0) {
        fail(`${outcomePath}.costUsd`, 'must be a finite, non-negative number')
      }
      const quality = hasQuality ? outcome.quality : Number(outcome.correct)
      Object.defineProperty(outcomes, name, { value: { quality, costUsd: outcome.costUsd }, enumerable: true })
    }
    normalized.push({ id: row.id, groupId: row.groupId, domain: row.domain, outcomes })
  }
  return normalized.sort((left, right) => compareText(left.domain, right.domain)
    || compareText(left.groupId, right.groupId) || compareText(left.id, right.id))
}

function emptySum() {
  return { sum: 0, correction: 0 }
}

function addCompensated(target, value) {
  const sum = target.sum + value
  target.correction += Math.abs(target.sum) >= Math.abs(value)
    ? (target.sum - sum) + value : (value - sum) + target.sum
  target.sum = sum
}

// Error-free transform of a + b, where the bounded/scaled operands cannot
// overflow. Retain subtraction rounding as well as later summation rounding.
function addPairDifference(target, left, right) {
  const sum = left - right
  const rightVirtual = sum - left
  const leftVirtual = sum - rightVirtual
  const error = (left - leftVirtual) + (-right - rightVirtual)
  addCompensated(target, sum)
  addCompensated(target, error)
}

function sumMean(total, count) {
  return total.sum / count + total.correction / count
}

function emptyAggregate() {
  return {
    count: 0, qualityDifference: emptySum(), costDifference: emptySum(),
    strategyCost: emptySum(), referenceCost: emptySum(),
  }
}

// Costs are divided by the original maximum cost before summation, avoiding
// overflow even at Number.MAX_VALUE. Row counts retain each group's row weight.
function mergeAggregate(target, source) {
  target.count += source.count
  for (const name of ['qualityDifference', 'costDifference', 'strategyCost', 'referenceCost']) {
    addCompensated(target[name], source[name].sum)
    addCompensated(target[name], source[name].correction)
  }
}

function groupRows(rows, strategy, reference, costScale) {
  const domains = new Map()
  for (const row of rows) {
    if (!domains.has(row.domain)) domains.set(row.domain, new Map())
    const groups = domains.get(row.domain)
    if (!groups.has(row.groupId)) groups.set(row.groupId, emptyAggregate())
    const selected = row.outcomes[strategy]
    const baseline = row.outcomes[reference]
    const group = groups.get(row.groupId)
    group.count += 1
    addPairDifference(group.qualityDifference, selected.quality, baseline.quality)
    const strategyCost = costScale === 0 ? 0 : selected.costUsd / costScale
    const referenceCost = costScale === 0 ? 0 : baseline.costUsd / costScale
    addCompensated(group.strategyCost, strategyCost)
    addCompensated(group.referenceCost, referenceCost)
    addPairDifference(group.costDifference, strategyCost, referenceCost)
  }
  return [...domains.entries()].map(([domain, groups]) => ({
    domain, groups: [...groups.values()], examples: [...groups.values()].reduce((count, group) => count + group.count, 0),
  }))
}

function seededRandom(initialSeed) {
  let seed = initialSeed
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

// The original-unit scale used only for the numerical sign guard must retain
// tiny means even when dividing by the global maximum would underflow them.
// Non-negative finite inputs keep these incremental means from overflowing.
function originalCostMeans(rows, strategy, reference) {
  if (rows.length === 0) return { strategy: null, reference: null }
  let strategyMean = 0
  let referenceMean = 0
  for (const [index, row] of rows.entries()) {
    strategyMean += (row.outcomes[strategy].costUsd - strategyMean) / (index + 1)
    referenceMean += (row.outcomes[reference].costUsd - referenceMean) / (index + 1)
  }
  return { strategy: strategyMean, reference: referenceMean }
}

// Dekker's product residual preserves the rounding of margin * row count. Both
// operands are bounded by 1 and an array-derived count, so splitting is finite.
function productParts(left, right) {
  const product = left * right
  const leftSplit = 134217729 * left
  const leftHigh = leftSplit - (leftSplit - left)
  const leftLow = left - leftHigh
  const rightSplit = 134217729 * right
  const rightHigh = rightSplit - (rightSplit - right)
  const rightLow = right - rightHigh
  const error = ((leftHigh * rightHigh - product) + leftHigh * rightLow + leftLow * rightHigh) + leftLow * rightLow
  return { product, error }
}

function marginAdjustedQuality(total, margin) {
  const shifted = { ...total.qualityDifference }
  const { product, error } = productParts(margin, total.count)
  addCompensated(shifted, product)
  addCompensated(shifted, error)
  const mean = sumMean(shifted, total.count)
  const numerator = shifted.sum + shifted.correction
  // Division can erase a nonzero subnormal difference. An unavailable guard
  // cannot establish non-inferiority, and does not broaden the declared margin.
  return mean === 0 && numerator !== 0 ? null : mean
}

function summarizeDomains(domains, costScale, margin, random = null) {
  if (domains.length === 0) return {
    metrics: Object.fromEntries(METRICS.map(metric => [metric, null])),
    qualityMarginDifference: null,
  }
  const total = emptyAggregate()
  const macro = emptySum()
  for (const domain of domains) {
    const sampled = emptyAggregate()
    for (const group of domain.groups) {
      const selected = random === null ? group : domain.groups[Math.floor(random() * domain.groups.length)]
      mergeAggregate(sampled, selected)
    }
    addCompensated(macro, sumMean(sampled.qualityDifference, sampled.count))
    mergeAggregate(total, sampled)
  }
  const normalizedCostDifference = sumMean(total.costDifference, total.count)
  const normalizedReferenceCost = sumMean(total.referenceCost, total.count)
  // Algebraically 1 - mean(strategy) / mean(reference), with paired differences
  // retained so equivalent cost multisets do not acquire cancellation noise.
  const relativeSavings = normalizedReferenceCost === 0 ? null : -normalizedCostDifference / normalizedReferenceCost
  return {
    metrics: {
      microQualityDifference: sumMean(total.qualityDifference, total.count),
      macroQualityDifference: sumMean(macro, domains.length),
      meanCostDifferenceUsd: normalizedCostDifference * costScale,
      relativeSavings: Number.isFinite(relativeSavings) ? (relativeSavings === 0 ? 0 : relativeSavings) : null,
    },
    qualityMarginDifference: marginAdjustedQuality(total, margin),
  }
}

function percentile(sorted, probability) {
  const position = (sorted.length - 1) * probability
  const left = sorted[Math.floor(position)]
  const right = sorted[Math.ceil(position)]
  const fraction = position - Math.floor(position)
  return left === right ? left : left * (1 - fraction) + right * fraction
}

function bounds(values, lowerProbability, upperProbability) {
  // A ratio undefined in any replicate does not have an unconditional percentile
  // interval. Do not quietly condition on replicates with a nonzero denominator.
  if (values.length === 0 || values.some(value => value === null)) return { lower: null, upper: null }
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  return { lower: percentile(sorted, lowerProbability), upper: percentile(sorted, upperProbability) }
}

/**
 * Paired percentile bootstrap of frozen routing strategies on question outcomes.
 * Quality is a bounded [0, 1] score, with boolean correct as a legacy fallback.
 * If both are supplied, quality must equal Number(correct). Groups are declared
 * independent units nested within domains. Each replicate draws the original
 * number of groups in every domain, with replacement, and retains every row of
 * each drawn group. Micro and cost metrics weight rows; macro weights domains.
 * Empty data and undefined savings return null rather than invented zero values.
 * Percentile intervals are approximate, not finite-sample risk certification.
 */
export function pairedRoutingComparison(rows, options = {}) {
  const settings = validateOptions(options)
  const { strategy, reference, seed, resamples, alpha, claims, nonInferiorityMargin, tailProbability } = settings
  const normalized = validateRows(rows, strategy, reference)
  const costScale = normalized.reduce((scale, row) => Math.max(scale, row.outcomes[strategy].costUsd, row.outcomes[reference].costUsd), 0)
  const domains = groupRows(normalized, strategy, reference, costScale)
  const original = summarizeDomains(domains, costScale, nonInferiorityMargin)
  const point = original.metrics
  const originalMeans = originalCostMeans(normalized, strategy, reference)
  const costMeanScaleUsd = normalized.length === 0 ? null : Math.max(originalMeans.strategy, originalMeans.reference)
  const costSignToleranceUsd = costMeanScaleUsd === null ? null : COST_SIGN_ULPS * Number.EPSILON * costMeanScaleUsd
  const samples = Object.fromEntries(METRICS.map(metric => [metric, []]))
  const qualityMarginSamples = []
  const random = seededRandom(seed)
  if (normalized.length > 0) {
    for (let index = 0; index < resamples; index += 1) {
      const sampled = summarizeDomains(domains, costScale, nonInferiorityMargin, random)
      for (const metric of METRICS) samples[metric].push(sampled.metrics[metric])
      qualityMarginSamples.push(sampled.qualityMarginDifference)
    }
  }
  const metrics = Object.fromEntries(METRICS.map(metric => [metric, bounds(samples[metric], alpha / 2, 1 - alpha / 2)]))
  const qualityLowerBound = bounds(samples.microQualityDifference, tailProbability, 1 - tailProbability).lower
  const qualityMarginLowerBound = bounds(qualityMarginSamples, tailProbability, 1 - tailProbability).lower
  const costUpperBoundUsd = bounds(samples.meanCostDifferenceUsd, tailProbability, 1 - tailProbability).upper
  const qualityNonInferior = qualityLowerBound !== null && qualityLowerBound >= -nonInferiorityMargin
    && qualityMarginLowerBound !== null && qualityMarginLowerBound >= 0
  const costLower = costUpperBoundUsd !== null && costSignToleranceUsd !== null && costUpperBoundUsd < -costSignToleranceUsd
  return {
    schemaVersion: 1,
    strategy,
    reference,
    sample: {
      examples: normalized.length,
      groups: domains.reduce((count, domain) => count + domain.groups.length, 0),
      domains: domains.length,
      domainCounts: Object.fromEntries(domains.map(domain => [domain.domain, { examples: domain.examples, groups: domain.groups.length }])),
    },
    settings: { seed, resamples, alpha, claims, nonInferiorityMargin, primaryQualityMetric: 'microQualityDifference' },
    point,
    twoSidedPercentile: { confidenceLevel: 1 - alpha, metrics },
    oneSidedBonferroni: { tailProbability, qualityLowerBound, qualityMarginLowerBound, costUpperBoundUsd, familyEndpoints: 2 * claims },
    numerics: {
      aggregation: 'compensated paired differences with original maximum-cost normalization',
      originalMeanStrategyCostUsd: originalMeans.strategy,
      originalMeanReferenceCostUsd: originalMeans.reference,
      costMeanScaleUsd,
      costSignToleranceUsd,
      costToleranceMultiplier: COST_SIGN_ULPS,
      costToleranceFormula: '32 * Number.EPSILON * max(originalMeanStrategyCostUsd, originalMeanReferenceCostUsd)',
      qualityBoundaryCheck: 'Compensated margin-adjusted quality lower bound must also be non-negative; no epsilon is added to the business margin.',
    },
    bootstrap: {
      method: 'paired-domain-stratified-group-percentile',
      completedResamples: samples.microQualityDifference.length,
      relativeSavingsDefinedResamples: samples.relativeSavings.filter(value => value !== null).length,
      domainsWithFewerThanTwoGroups: domains.filter(domain => domain.groups.length < 2).map(domain => domain.domain),
    },
    conclusion: {
      qualityNonInferior,
      costLower,
      qualityCostBenefit: qualityNonInferior && costLower,
      rule: 'qualityLowerBound >= -nonInferiorityMargin and qualityMarginLowerBound >= 0 and costUpperBoundUsd < -costSignToleranceUsd',
    },
    metricDefinitions: {
      microQualityDifference: 'Strategy minus reference quality score in [0, 1], averaged over question rows; boolean correct is converted to 0 or 1 only when quality is absent.',
      macroQualityDifference: 'Unweighted mean of domain quality differences, recomputed in every replicate.',
      meanCostDifferenceUsd: 'Mean supplied paired strategy-minus-reference cost; a cost benefit additionally requires the upper bound to be below the disclosed numerical sign tolerance.',
      relativeSavings: '1 - mean strategy cost / mean reference cost; null for a zero denominator or an unrepresentable ratio.',
    },
    limitations: [
      'Percentile bootstrap bounds are approximate and do not provide finite-sample risk certification.',
      'The cost-sign tolerance is a scale-aware floating-point guard, separate from the business non-inferiority margin; smaller cost differences do not support a savings claim.',
      'Quality boundary comparisons retain compensated paired differences and the margin product residual; reported floating-point bounds may round onto a boundary without passing that guard.',
      'If a nonzero margin-adjusted quality numerator underflows to zero when averaged, the boundary guard is unavailable and cannot support non-inferiority.',
      'Rows must be genuinely paired question outcomes with their declared groups; task or category means cannot establish per-question routing benefit.',
      'Strategies, grouping, quality metric, margin, and the complete comparison family must be fixed before examining test outcomes.',
      'Independence between supplied groups and representativeness of the supplied domains are assumptions, not verified properties.',
      'A domain with one group has no estimable between-group variation; small group counts can make bootstrap bounds unreliable.',
      'Quality and cost provenance are caller-supplied. Estimated or historical nominal costs do not establish actual or current billed savings.',
      'Supplied costs must already include the chosen overhead accounting; this module does not infer missing costs or routing fees.',
      'Relative-savings intervals are null if any replicate has an undefined ratio; undefined replicates are not silently discarded.',
      'Bootstrap resampling preserves the supplied domains and does not measure performance on new domains or future model versions.',
    ],
  }
}
