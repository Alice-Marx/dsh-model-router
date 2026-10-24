/** Subscription quantities are evidence of use, never API dollars or remaining quota. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const counter = value => Number.isSafeInteger(value) && value >= 0
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isFinite(new Date(value).getTime())
const clean = value => typeof value === 'string' && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null
const TOKENS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
const COUNTS = ['calls', 'knownUsageCalls', 'unknownUsageCalls']
const pad = value => String(value).padStart(2, '0')
const dayKey = at => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const monthKey = at => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const DAYS = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u
const MONTHS = /^\d{4}-(?:0[1-9]|1[0-2])$/u
export const MAX_SUBSCRIPTION_USAGE_ROUTES = 256

export const emptySubscriptionUsage = () => ({ calls: 0, knownUsageCalls: 0, unknownUsageCalls: 0,
  inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null })
const period = value => ({ ...Object.fromEntries(COUNTS.map(field => [field, counter(value?.[field]) ? value[field] : 0])),
  ...Object.fromEntries(TOKENS.map(field => [field, counter(value?.[field]) ? value[field] : null])) })
const identity = value => ({ provider: clean(value?.provider) || '未知供应商', toolId: clean(value?.toolId), model: clean(value?.model) })
const keyOf = value => JSON.stringify([value.provider, value.toolId, value.model])
const emptyBucket = () => ({ total: emptySubscriptionUsage(), byRoute: {} })
const overflowRoute = { provider: '其他（已合并）', toolId: null, model: null }

function addPeriod(target, source) {
  for (const field of COUNTS) target[field] += source[field]
  for (const field of TOKENS) {
    if (source[field] === null) continue
    const total = (target[field] ?? 0) + source[field]
    // A quantity that cannot be represented exactly is not a reported zero.
    target[field] = counter(total) ? total : null
  }
  return target
}

function addRoute(bucket, route, value) {
  let id = keyOf(route)
  if (!Object.hasOwn(bucket.byRoute, id) && Object.keys(bucket.byRoute).length >= MAX_SUBSCRIPTION_USAGE_ROUTES - 1) {
    route = overflowRoute; id = keyOf(route)
  }
  const row = bucket.byRoute[id] ??= { ...route, usage: emptySubscriptionUsage() }
  addPeriod(row.usage, value)
}

function addBucket(target, source) {
  addPeriod(target.total, source.total)
  for (const row of Object.values(source.byRoute)) addRoute(target, identity(row), row.usage)
}

/** Legacy calendar records kept counts, but discarded every token quantity. */
function legacyArchive(spending) {
  const result = { days: {}, months: {} }
  for (const [kind, pattern] of [['days', DAYS], ['months', MONTHS]]) {
    for (const [key, value] of Object.entries(record(spending?.[kind]) ? spending[kind] : {})) {
      if (!pattern.test(key) || !counter(value?.subscriptionRuns) || value.subscriptionRuns === 0) continue
      const usage = { ...emptySubscriptionUsage(), calls: value.subscriptionRuns, unknownUsageCalls: value.subscriptionRuns }
      const bucket = result[kind][key] = { total: usage, byRoute: {} }
      addRoute(bucket, { provider: '历史订阅（用量未保存）', toolId: null, model: null }, usage)
    }
  }
  return result
}

/** Bounded quantities and route identifiers only; no answers, prompts, prices or credentials. */
export function sanitizeArchivedSubscriptionUsage(value, { legacySpending } = {}) {
  if (value === undefined || value === null) value = legacyArchive(legacySpending)
  const result = { days: {}, months: {} }
  for (const [kind, pattern, limit] of [['days', DAYS, 90], ['months', MONTHS, 24]]) {
    const entries = Object.entries(record(value?.[kind]) ? value[kind] : {}).filter(([key, bucket]) => pattern.test(key) && record(bucket))
      .sort(([a], [b]) => a.localeCompare(b)).slice(-limit)
    for (const [key, bucket] of entries) {
      const next = result[kind][key] = { total: period(bucket.total), byRoute: {} }
      for (const row of Object.values(record(bucket.byRoute) ? bucket.byRoute : {})) {
        if (!record(row)) continue
        addRoute(next, identity(row), period(row.usage))
      }
    }
  }
  return result
}

export function invalidArchivedSubscriptionUsage(value) {
  if (value === undefined) return false
  if (!record(value)) return true
  const invalidPeriod = value => !record(value)
    || COUNTS.some(field => !counter(value[field]))
    || TOKENS.some(field => value[field] !== null && !counter(value[field]))
    || value.knownUsageCalls + value.unknownUsageCalls !== value.calls
  for (const [kind, pattern] of [['days', DAYS], ['months', MONTHS]]) {
    if (!record(value[kind])) return true
    for (const [key, bucket] of Object.entries(value[kind])) {
      if (!pattern.test(key) || !record(bucket) || invalidPeriod(bucket.total) || !record(bucket.byRoute)) return true
      for (const row of Object.values(bucket.byRoute)) {
        if (!record(row) || !clean(row.provider) || (row.toolId !== null && !clean(row.toolId))
          || (row.model !== null && !clean(row.model)) || invalidPeriod(row.usage)) return true
      }
    }
  }
  return false
}

/** Only these fields from a subscription receipt can enter the durable ledger. */
export function sanitizeSubscriptionAttempts(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return [{ usage: null, usageIncomplete: true, unknownEvidence: true }]
  const attempts = value.slice(0, 16).map(item => {
    if (!record(item)) return { usage: null, usageIncomplete: true, unknownEvidence: true }
    return { ...Object.fromEntries(['provider', 'toolId', 'model'].filter(field => Object.hasOwn(item, field))
      .map(field => [field, clean(item[field])])),
    usage: record(item.usage)
      ? Object.fromEntries(TOKENS.filter(field => Object.hasOwn(item.usage, field)).map(field => [field,
        counter(item.usage[field]) ? item.usage[field] : null])) : null,
    ...(item.ran === false ? { ran: false } : {}), ...(item.notStarted === true ? { notStarted: true } : {}),
    ...(item.blocked === true ? { blocked: true } : {}),
    ...(item.usageIncomplete === true || record(item.usage) && TOKENS.some(field => item.usage[field] !== undefined
      && item.usage[field] !== null && !counter(item.usage[field])) ? { usageIncomplete: true } : {}),
    ...(timestamp(item.finishedAt) ? { finishedAt: item.finishedAt } : {}),
    ...(item.unknownEvidence === true ? { unknownEvidence: true } : {}) }
  })
  if (value.length > 16) attempts.push({ usage: null, usageIncomplete: true, unknownEvidence: true })
  return attempts
}

export function invalidSubscriptionAttempts(value) {
  if (value === undefined) return false
  return !Array.isArray(value) || value.length > 16 || value.some(item => !record(item) || item.unknownEvidence === true
    || (item.usage !== undefined && item.usage !== null && (!record(item.usage)
      || TOKENS.some(field => item.usage[field] !== undefined && item.usage[field] !== null && !counter(item.usage[field])))))
}

function began(item) {
  const contradictory = record(item.usage) && TOKENS.some(field => item.usage[field] !== undefined
    && item.usage[field] !== null && item.usage[field] !== 0)
  return contradictory || !(item.ran === false || item.notStarted === true || item.blocked === true)
}

function* packageEntries(item, fallbackAt) {
  if (!record(item)) return
  // An explicit vector is authoritative: an API result can still include its
  // earlier subscription attempt; [] means no subscription was attempted.
  const attempts = Object.hasOwn(item, 'subscriptionAttempts') ? sanitizeSubscriptionAttempts(item.subscriptionAttempts)
    : item.billing === 'subscription' && item.ran === true ? [item] : []
  for (const attempt of attempts) {
    if (!began(attempt)) continue
    const usage = record(attempt.usage) ? attempt.usage : null
    const complete = attempt.usageIncomplete !== true && attempt.unknownEvidence !== true
      && counter(usage?.inputTokens) && counter(usage?.outputTokens)
      && TOKENS.every(field => usage[field] === undefined || usage[field] === null || counter(usage[field]))
    const value = { ...emptySubscriptionUsage(), calls: 1, knownUsageCalls: complete ? 1 : 0, unknownUsageCalls: complete ? 0 : 1 }
    for (const field of TOKENS) if (counter(usage?.[field])) value[field] = usage[field]
    const when = timestamp(attempt.finishedAt) ? attempt.finishedAt : timestamp(item.finishedAt) ? item.finishedAt : fallbackAt
    yield { when, route: identity(Object.fromEntries(['provider', 'toolId', 'model'].map(field => [field,
      Object.hasOwn(attempt, field) ? attempt[field] : item[field]]))), usage: value }
  }
}

function* usageEntries(runs) {
  for (const run of Array.isArray(runs) ? runs : []) {
    for (const item of [...(Array.isArray(run?.packages) ? run.packages : []), ...(Array.isArray(run?.reviews) ? run.reviews : [])]) {
      yield* packageEntries(item, run?.createdAt)
    }
  }
}

function addArchive(target, source) {
  for (const kind of ['days', 'months']) {
    for (const [key, bucket] of Object.entries(source[kind])) addBucket(target[kind][key] ??= emptyBucket(), bucket)
  }
}

function priorArchive(run) {
  return sanitizeArchivedSubscriptionUsage(run?.priorAttemptSubscriptionUsage, { legacySpending: run?.priorAttemptSpending })
}

/** Fold only evicted/replaced records. Retained records remain live. */
export function archiveSubscriptionUsage(runs, archived) {
  const result = sanitizeArchivedSubscriptionUsage(archived)
  for (const run of Array.isArray(runs) ? runs : []) addArchive(result, priorArchive(run))
  for (const { when, route, usage } of usageEntries(runs)) {
    if (!timestamp(when)) continue
    for (const [kind, key] of [['days', dayKey(when)], ['months', monthKey(when)]]) {
      const bucket = result[kind][key] ??= emptyBucket()
      addPeriod(bucket.total, usage); addRoute(bucket, route, usage)
    }
  }
  return sanitizeArchivedSubscriptionUsage(result)
}

/** Known quantities only. Missing usage remains explicit instead of becoming zero. */
export function subscriptionUsage(runs, at = Date.now(), archived = null) {
  const all = archiveSubscriptionUsage(runs, archived)
  const daily = all.days[dayKey(at)] ?? emptyBucket(), monthly = all.months[monthKey(at)] ?? emptyBucket()
  const keys = new Set([...Object.keys(daily.byRoute), ...Object.keys(monthly.byRoute)])
  return { today: period(daily.total), month: period(monthly.total),
    byRoute: [...keys].map(key => ({ ...identity(monthly.byRoute[key] ?? daily.byRoute[key]),
      today: period(daily.byRoute[key]?.usage), month: period(monthly.byRoute[key]?.usage) })) }
}

export function subscriptionUsageForPackage(item) {
  const result = emptySubscriptionUsage()
  for (const { usage } of packageEntries(item)) addPeriod(result, usage)
  return result
}

/** Includes prior retry attempts, without summing both daily and monthly copies. */
export function subscriptionUsageForRun(run) {
  const result = emptySubscriptionUsage()
  for (const bucket of Object.values(priorArchive(run).months)) addPeriod(result, bucket.total)
  for (const { usage } of usageEntries([run])) addPeriod(result, usage)
  return result
}
