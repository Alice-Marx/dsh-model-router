/**
 * Bounded, local subjective-utility personalization. This is not a learned
 * answer-correctness probability, a bandit policy, or an unbiased evaluation.
 * Only explicit human feedback on an executed, successful result is evidence.
 * Model reviews and missing feedback are deliberately not user satisfaction.
 */
export const FEEDBACK_POLICY_VERSION = 'subjective-utility-v1'
export const FEEDBACK_RUN_WINDOW = 200
/** Cache invalidation cadence; weights themselves still use exact evaluatedAt. */
export const FEEDBACK_DECAY_REFRESH_MS = 3_600_000

const DAY_MS = 86_400_000
const finite = value => typeof value === 'number' && Number.isFinite(value)
const clean = value => typeof value === 'string' ? value.trim() : ''
const routeKey = (provider, model) => `${provider}\u0000${model}`
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => record(value) && Object.hasOwn(value, key) ? value[key] : undefined
// Code-unit ordering avoids machine/browser locale changing cache identity.
const compare = (left, right) => left === right ? 0 : left < right ? -1 : 1

function boundedOption(options, key, fallback, minimum, maximum = Infinity) {
  const value = options[key] === undefined ? fallback : options[key]
  if (!finite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${key} must be a finite number in [${minimum}, ${maximum}]`)
  }
  return value
}

function normalizedOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object')
  const enabled = options.enabled === undefined ? true : options.enabled
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean')
  return {
    enabled,
    now: boundedOption(options, 'now', Date.now(), 0),
    halfLifeDays: boundedOption(options, 'halfLifeDays', 30, 1, 3650),
    priorWeight: boundedOption(options, 'priorWeight', 3, 1, 1_000_000),
    maxAdjustment: boundedOption(options, 'maxAdjustment', 0.04, 0, 0.1),
    resetAt: boundedOption(options, 'resetAt', 0, 0),
  }
}

/** FNV-1a over JS UTF-16 code units: a short cache identity, NOT a security hash. */
function cacheRevision(value) {
  const serialized = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < serialized.length; index += 1) {
    hash = Math.imul(hash ^ serialized.charCodeAt(index), 0x01000193) >>> 0
  }
  return `${FEEDBACK_POLICY_VERSION}:${hash.toString(16).padStart(8, '0')}`
}

function completedAt(run, item) {
  // Stored packages have their own completion time. A historical run may have
  // only a run-level completion timestamp, then its creation timestamp.
  // Invalid explicitly supplied timestamps are not repaired by a fallback.
  for (const candidate of [own(item, 'finishedAt'), own(run, 'finishedAt'), own(run, 'createdAt')]) {
    if (candidate === undefined || candidate === null) continue
    return finite(candidate) && candidate >= 0 ? candidate : null
  }
  return null
}

function evidenceOf(run, item, options) {
  const reject = reason => ({ event: null, reason })
  const provider = clean(own(item, 'provider'))
  const model = clean(own(item, 'model'))
  if (!provider || !model || provider.includes('\u0000') || model.includes('\u0000')) return reject('invalid-route')
  if (own(item, 'ran') !== true || own(item, 'ok') !== true
    || item.blocked === true || item.waiting === true || item.paused === true
    || item.cancelled === true || (item.status !== undefined && !['succeeded', 'fallback'].includes(item.status))) return reject('not-successful')
  const rating = own(item, 'rating')
  if (rating !== 1 && rating !== -1) return reject(rating === undefined || rating === null || rating === 0 ? 'unrated' : 'invalid-rating')
  // A CLI default or a different actual model must not train the recommended
  // model. Aliases are not silently equated; a future verified adapter may do so.
  if (item.channel === 'official-cli' && clean(own(item, 'actualModel')) !== model) return reject('cli-model-unverified')
  const finishedAt = completedAt(run, item)
  if (finishedAt === null) return reject('invalid-time')
  if (finishedAt > options.now) return reject('future-time')
  if (finishedAt <= options.resetAt) return reject('before-reset')
  const suppliedRatedAt = own(item, 'ratedAt')
  if (suppliedRatedAt !== undefined && suppliedRatedAt !== null) {
    if (!finite(suppliedRatedAt) || suppliedRatedAt < finishedAt) return reject('invalid-time')
    if (suppliedRatedAt > options.now) return reject('future-time')
  }
  return { reason: null, event: {
    runId: own(run, 'id'),
    packageId: own(item, 'id'),
    provider,
    model,
    domain: clean(own(item, 'type')) || 'general',
    rating,
    finishedAt,
    ratedAt: suppliedRatedAt ?? finishedAt,
  } }
}

/**
 * Build a pure profile from the newest 200 runs under one local DSH home.
 * Last occurrence of the same run/package replaces earlier occurrences BEFORE
 * validation: a clear, retry, or invalid latest result removes old evidence.
 * Existing metadata without ran/ok/identifiers/timestamps is not guessed.
 *
 * In one exact provider/model/domain cell:
 *   w_i = 2 ** (-(now - completedAt_i) / halfLifeMs)
 *   bias = maxAdjustment * sum(w_i * rating_i) / (priorWeight + sum(w_i))
 * Ratings are revised in place, never extra independent observations. Decay
 * uses result completion, so re-rating an old result cannot refresh its age or
 * bypass resetAt. No cross-domain/model-version/user backoff is performed.
 */
export function buildFeedbackProfile(runs, options = {}) {
  const settings = normalizedOptions(options)
  const profile = {
    enabled: settings.enabled,
    scope: 'local-dsh-home',
    policyVersion: FEEDBACK_POLICY_VERSION,
    feedbackCount: 0,
    ignoredCount: 0,
    effectiveWeight: 0,
    updatedAt: null,
    halfLifeDays: settings.halfLifeDays,
    priorWeight: settings.priorWeight,
    maxAdjustment: settings.maxAdjustment,
    resetAt: settings.resetAt,
    window: 'last-200-runs',
    adjustments: {},
    cellStats: {},
    exclusionReasons: {},
    evaluatedAt: settings.now,
    decayRefreshMs: FEEDBACK_DECAY_REFRESH_MS,
    decayEpoch: null,
    evidenceRevision: '',
    revisionSemantics: 'evidence-settings-and-hourly-decay-cache-identity-not-security-hash',
    revision: '',
  }
  const exclude = reason => {
    profile.ignoredCount += 1
    profile.exclusionReasons[reason] = (profile.exclusionReasons[reason] ?? 0) + 1
  }
  const latest = new Map()
  if (settings.enabled) {
    for (const run of (Array.isArray(runs) ? runs : []).slice(-FEEDBACK_RUN_WINDOW)) {
      if (!record(run) || (run.packages !== undefined && !Array.isArray(own(run, 'packages')))) {
        exclude('invalid-record')
        continue
      }
      for (const item of Array.isArray(own(run, 'packages')) ? run.packages : []) {
        if (!record(item)) {
          exclude('invalid-record')
          continue
        }
        if (!clean(own(run, 'id')) || !clean(own(item, 'id'))) {
          exclude('missing-identity')
          continue
        }
        const identity = JSON.stringify([run.id, item.id])
        if (latest.has(identity)) exclude('superseded')
        latest.set(identity, { run, item })
      }
    }
  }
  const events = []
  for (const { run, item } of latest.values()) {
    const result = evidenceOf(run, item, settings)
    if (result.event) events.push(result.event)
    else exclude(result.reason)
  }
  events.sort((left, right) => compare(JSON.stringify([left.runId, left.packageId]), JSON.stringify([right.runId, right.packageId])))
  const cells = new Map()
  for (const event of events) {
    const weight = 2 ** (-(settings.now - event.finishedAt) / (settings.halfLifeDays * DAY_MS))
    const key = routeKey(event.provider, event.model)
    const domains = cells.get(key) ?? new Map()
    const cell = domains.get(event.domain) ?? { sum: 0, weight: 0, count: 0, positive: 0, negative: 0,
      weightSquaredSum: 0, maxWeight: 0, scaledWeightSum: 0, scaledWeightSquares: 0 }
    cell.sum += weight * event.rating
    cell.weight += weight
    cell.count += 1
    if (event.rating === 1) cell.positive += 1
    else cell.negative += 1
    cell.weightSquaredSum += weight * weight
    // Rescaling prevents old tiny weights squared from underflowing Kish ESS.
    if (weight > cell.maxWeight) {
      const scale = cell.maxWeight / weight
      cell.scaledWeightSum = cell.scaledWeightSum * scale + 1
      cell.scaledWeightSquares = cell.scaledWeightSquares * scale * scale + 1
      cell.maxWeight = weight
    } else if (weight > 0) {
      const scaled = weight / cell.maxWeight
      cell.scaledWeightSum += scaled
      cell.scaledWeightSquares += scaled * scaled
    }
    domains.set(event.domain, cell)
    cells.set(key, domains)
    profile.feedbackCount += 1
    profile.effectiveWeight += weight
    profile.updatedAt = Math.max(profile.updatedAt ?? 0, event.ratedAt)
  }
  // Object.fromEntries safely creates own keys even for opaque identifiers
  // such as '__proto__'; no task text or answer is copied into this profile.
  const sortedCells = [...cells.entries()].sort(([left], [right]) => compare(left, right))
    .map(([key, domains]) => [key, [...domains.entries()].sort(([left], [right]) => compare(left, right))])
  const adjustment = cell => Math.max(-settings.maxAdjustment, Math.min(settings.maxAdjustment,
    settings.maxAdjustment * cell.sum / (settings.priorWeight + cell.weight)))
  profile.adjustments = Object.fromEntries(sortedCells.map(([key, domains]) => [key,
    Object.fromEntries(domains.map(([domain, cell]) => [domain, adjustment(cell)]))]))
  profile.cellStats = Object.fromEntries(sortedCells.map(([key, domains]) => [key,
    Object.fromEntries(domains.map(([domain, cell]) => [domain, {
      feedbackCount: cell.count, positiveCount: cell.positive, negativeCount: cell.negative,
      weightedRatingSum: cell.sum, effectiveWeight: cell.weight, weightSquaredSum: cell.weightSquaredSum,
      // Keep machine output within the mathematical bound despite ULP rounding.
      effectiveSampleSize: cell.scaledWeightSquares > 0
        ? Math.min(cell.count, Math.max(0, cell.scaledWeightSum ** 2 / cell.scaledWeightSquares)) : 0,
      shrinkage: cell.weight / (settings.priorWeight + cell.weight), adjustment: adjustment(cell),
      semantics: 'observed-feedback-weight-diagnostics-not-confidence-or-correctness',
    }]))]))
  const { now: evaluatedAt, ...evidenceSettings } = settings
  const identityEvents = events.map(({ ratedAt, ...event }) => event)
  profile.evidenceRevision = cacheRevision({ settings: evidenceSettings, events: identityEvents })
  profile.decayEpoch = events.length > 0 && settings.maxAdjustment > 0
    ? Math.floor(evaluatedAt / FEEDBACK_DECAY_REFRESH_MS) : null
  // A decision cache identity, intentionally not the hash of every continuously
  // changing weight. Empty evidence and audit-only re-rating do not erase plans;
  // active preferences invalidate once/hour so long-term decay keeps updating.
  profile.revision = cacheRevision({ evidenceRevision: profile.evidenceRevision, decayEpoch: profile.decayEpoch })
  return profile
}

/**
 * Add separate preference metadata; never overwrite benchmark quality/source.
 * Unknown/catalog quality remains unknown/catalog evidence after applying this
 * profile. The planner must consume the domain-specific adjustment explicitly.
 */
export function applyFeedbackProfile(routes, profile) {
  if (!Array.isArray(routes) || !record(profile) || typeof profile.enabled !== 'boolean') return routes
  return routes.map(route => {
    if (!record(route)) return route
    let base = route
    if (Object.hasOwn(route, 'preferenceAdjustments') || Object.hasOwn(route, 'preferenceAdjustmentMeta')) {
      base = { ...route }
      delete base.preferenceAdjustments
      delete base.preferenceAdjustmentMeta
    }
    if (profile.enabled !== true || !record(profile.adjustments)) return base
    const key = routeKey(clean(route.provider), clean(route.model))
    if (!Object.hasOwn(profile.adjustments, key)) return base
    const value = profile.adjustments[key]
    if (!record(value)) return base
    const limit = finite(profile.maxAdjustment) && profile.maxAdjustment >= 0 && profile.maxAdjustment <= 0.1 ? profile.maxAdjustment : 0.1
    const adjustments = Object.fromEntries(Object.entries(value).filter(([, bias]) => finite(bias) && Math.abs(bias) <= limit))
    if (!Object.keys(adjustments).length) return base
    return {
      ...base,
      preferenceAdjustments: adjustments,
      preferenceAdjustmentMeta: {
        policyVersion: profile.policyVersion,
        revision: profile.revision,
        scope: profile.scope,
        feedbackCount: profile.feedbackCount,
        effectiveWeight: profile.effectiveWeight,
        updatedAt: profile.updatedAt,
        halfLifeDays: profile.halfLifeDays,
        maxAdjustment: profile.maxAdjustment,
        window: profile.window,
        cellStats: Object.hasOwn(profile.cellStats ?? {}, key) ? profile.cellStats[key] : {},
        evaluatedAt: profile.evaluatedAt,
        decayRefreshMs: profile.decayRefreshMs,
        revisionSemantics: profile.revisionSemantics,
      },
    }
  })
}
