/**
 * Bounded, local subjective-utility personalization. This is not a learned
 * answer-correctness probability, a bandit policy, or an unbiased evaluation.
 * Only explicit human feedback on an executed, successful result is evidence.
 * Model reviews and missing feedback are deliberately not user satisfaction.
 */
export const FEEDBACK_POLICY_VERSION = 'subjective-utility-v1'
export const FEEDBACK_RUN_WINDOW = 200

const DAY_MS = 86_400_000
const finite = value => typeof value === 'number' && Number.isFinite(value)
const clean = value => typeof value === 'string' ? value.trim() : ''
const routeKey = (provider, model) => `${provider}\u0000${model}`
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
  for (const candidate of [item.finishedAt, run.finishedAt, run.createdAt]) {
    if (candidate === undefined || candidate === null) continue
    return finite(candidate) && candidate >= 0 ? candidate : null
  }
  return null
}

function evidenceOf(run, item, options) {
  const provider = clean(item.provider)
  const model = clean(item.model)
  if (!provider || !model || provider.includes('\u0000') || model.includes('\u0000') || item.ran !== true || item.ok !== true
    || item.blocked === true || item.waiting === true || item.paused === true
    || item.cancelled === true || (item.status !== undefined && !['succeeded', 'fallback'].includes(item.status))) return null
  if (item.rating !== 1 && item.rating !== -1) return null
  // A CLI default or a different actual model must not train the recommended
  // model. Aliases are not silently equated; a future verified adapter may do so.
  if (item.channel === 'official-cli' && clean(item.actualModel) !== model) return null
  const finishedAt = completedAt(run, item)
  if (finishedAt === null || finishedAt > options.now || finishedAt <= options.resetAt) return null
  if (item.ratedAt !== undefined && item.ratedAt !== null
    && (!finite(item.ratedAt) || item.ratedAt < 0 || item.ratedAt > options.now)) return null
  return {
    runId: run.id,
    packageId: item.id,
    provider,
    model,
    domain: clean(item.type) || 'general',
    rating: item.rating,
    finishedAt,
    ratedAt: item.ratedAt ?? finishedAt,
  }
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
    revision: '',
  }
  const latest = new Map()
  if (settings.enabled) {
    for (const run of (Array.isArray(runs) ? runs : []).slice(-FEEDBACK_RUN_WINDOW)) {
      for (const item of Array.isArray(run?.packages) ? run.packages : []) {
        if (!item || typeof item !== 'object' || !clean(run?.id) || !clean(item.id)) {
          profile.ignoredCount += 1
          continue
        }
        const identity = JSON.stringify([run.id, item.id])
        if (latest.has(identity)) profile.ignoredCount += 1
        latest.set(identity, { run, item })
      }
    }
  }
  const events = [...latest.values()].map(({ run, item }) => evidenceOf(run, item, settings))
    .filter(event => {
      if (!event) profile.ignoredCount += 1
      return event !== null
    }).sort((left, right) => compare(JSON.stringify([left.runId, left.packageId]), JSON.stringify([right.runId, right.packageId])))
  const cells = new Map()
  for (const event of events) {
    const weight = 2 ** (-(settings.now - event.finishedAt) / (settings.halfLifeDays * DAY_MS))
    const key = routeKey(event.provider, event.model)
    const domains = cells.get(key) ?? new Map()
    const cell = domains.get(event.domain) ?? { sum: 0, weight: 0 }
    cell.sum += weight * event.rating
    cell.weight += weight
    domains.set(event.domain, cell)
    cells.set(key, domains)
    profile.feedbackCount += 1
    profile.effectiveWeight += weight
    profile.updatedAt = Math.max(profile.updatedAt ?? 0, event.ratedAt)
  }
  // Object.fromEntries safely creates own keys even for opaque identifiers
  // such as '__proto__'; no task text or answer is copied into this profile.
  profile.adjustments = Object.fromEntries([...cells.entries()].sort(([left], [right]) => compare(left, right))
    .map(([key, domains]) => [key, Object.fromEntries([...domains.entries()].sort(([left], [right]) => compare(left, right))
      .map(([domain, cell]) => [domain, Math.max(-settings.maxAdjustment, Math.min(settings.maxAdjustment,
        settings.maxAdjustment * cell.sum / (settings.priorWeight + cell.weight)))]))]))
  profile.revision = cacheRevision({ settings, events })
  return profile
}

/**
 * Add separate preference metadata; never overwrite benchmark quality/source.
 * Unknown/catalog quality remains unknown/catalog evidence after applying this
 * profile. The planner must consume the domain-specific adjustment explicitly.
 */
export function applyFeedbackProfile(routes, profile) {
  if (!Array.isArray(routes) || profile?.enabled !== true || !profile.adjustments
    || typeof profile.adjustments !== 'object' || Array.isArray(profile.adjustments)) return routes
  return routes.map(route => {
    if (!route || typeof route !== 'object') return route
    const key = routeKey(clean(route.provider), clean(route.model))
    if (!Object.hasOwn(profile.adjustments, key)) return route
    const value = profile.adjustments[key]
    if (!value || typeof value !== 'object' || Array.isArray(value)) return route
    const adjustments = Object.fromEntries(Object.entries(value).filter(([, bias]) => finite(bias) && Math.abs(bias) <= 0.1))
    if (!Object.keys(adjustments).length) return route
    return {
      ...route,
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
      },
    }
  })
}
