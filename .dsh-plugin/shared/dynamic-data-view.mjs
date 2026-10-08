/** Public, browser-safe projections of dynamic benchmark/pricing snapshots. */
const DEFAULT_TTL_MS = 86_400_000
const currentTime = value => typeof value === 'function' ? value() : value ?? Date.now()
const exactRouteKey = route => `${String(route?.provider ?? '')}\0${String(route?.model ?? '')}`
const publicErrors = new Set(['snapshot-rollback-rejected', 'refresh-failed', 'storage-failed', 'refresh-interrupted'])
const publicError = value => publicErrors.has(value) ? value : value ? 'refresh-failed' : ''

/** Same public URL contract on Host and Client; validates syntax, not DNS routing. */
export function publicDynamicEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('invalid-public-url')
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.port && url.port !== '443') || host.startsWith('[')
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(host)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/u.test(host)) throw new Error('invalid-public-url')
  return url.toString()
}

const publicEndpointMetadata = value => { try { return publicDynamicEndpoint(value) } catch { return null } }

/** Mask stopped or unmatched sources; an old A snapshot must never impersonate new B. */
export function projectDynamicData(data, { enabled = false, liveBenchEndpoint = 'https://livebench.ai', pricingSnapshotEndpoint = '' } = {}) {
  if (enabled !== true) return { liveBench: null, pricing: null, status: {}, revision: '' }
  const result = { liveBench: data?.liveBench ?? null, pricing: data?.pricing ?? null,
    status: { ...(data?.status ?? {}) }, revision: String(data?.revision ?? '') }
  for (const [kind, raw] of [['liveBench', liveBenchEndpoint], ['pricing', pricingSnapshotEndpoint]]) {
    if (typeof raw === 'string' && raw.trim() === '') {
      result[kind] = null
      result.status[kind] = { disabled: true, endpoint: '', error: '' }
      continue
    }
    let endpoint
    try { endpoint = publicDynamicEndpoint(raw) }
    catch {
      result[kind] = null
      result.status[kind] = { endpoint: '', error: 'refresh-failed' }
      continue
    }
    const snapshot = result[kind]
    const status = result.status[kind]
    if (snapshot && snapshot.endpoint !== endpoint) {
      result[kind] = null
      result.status[kind] = { ...(status?.endpoint === endpoint ? status : {}), endpoint,
        lastGoodEndpoint: publicEndpointMetadata(snapshot.endpoint), error: status?.endpoint === endpoint ? publicError(status?.error) : '' }
    } else if (status?.endpoint !== endpoint) {
      result.status[kind] = { endpoint, error: '' }
    }
  }
  return result
}

/** Explicit user prices override the curated public feed, including stale last-good data. */
export function applyPricingSnapshot(routes, snapshot) {
  if (snapshot?.kind !== 'pricing' || !snapshot.prices || typeof snapshot.prices !== 'object') return routes
  return (Array.isArray(routes) ? routes : []).map(route => {
    if (route?.pricingSource === 'user') return route
    const entry = snapshot.prices[exactRouteKey(route)]
    if (!entry) return route
    return {
      ...route,
      pricing: { input: entry.input, output: entry.output, currency: 'USD',
        ...(entry.cacheRead === undefined ? {} : { cacheRead: entry.cacheRead }),
        ...(entry.cacheWrite === undefined ? {} : { cacheWrite: entry.cacheWrite }) },
      pricingSource: 'dynamic', pricingVersion: snapshot.version, snapshotAsOf: entry.asOf,
    }
  })
}

function sourceSummary(data, kind, enabled, ttlMs, at) {
  const snapshot = enabled ? data?.[kind] : null
  const status = enabled ? data?.status?.[kind] : null
  const verifiedAt = Number.isFinite(snapshot?.verifiedAt) ? snapshot.verifiedAt : null
  const expired = verifiedAt !== null && (verifiedAt > at + 60_000 || at - verifiedAt > ttlMs)
  const deadline = Number.isFinite(status?.requestDeadlineAt) ? status.requestDeadlineAt
    : Number.isFinite(status?.lastAttemptAt) ? status.lastAttemptAt + 13_000 : null
  const interrupted = Boolean(status?.requestId) && deadline !== null && at >= deadline
  const pending = Boolean(status?.requestId) && !interrupted
  const error = interrupted ? 'refresh-interrupted' : publicError(status?.error)
  return {
    status: !enabled || status?.disabled ? 'disabled' : !snapshot ? (error ? 'error' : 'missing')
      : expired || error ? 'stale' : 'fresh',
    verifiedAt, publishedAt: snapshot?.publishedAt ?? null,
    version: snapshot?.version ?? null, source: snapshot?.source ?? null,
    endpoint: publicEndpointMetadata(snapshot?.endpoint), configuredEndpoint: publicEndpointMetadata(status?.endpoint),
    error: enabled ? error : '',
    refreshing: enabled && pending, pending: enabled && pending,
    lastAttemptAt: Number.isFinite(status?.lastAttemptAt) ? status.lastAttemptAt : null,
    lastSuccessAt: Number.isFinite(status?.lastSuccessAt) ? status.lastSuccessAt : null,
    requestDeadlineAt: pending ? deadline : null,
    lastGoodEndpoint: publicEndpointMetadata(status?.lastGoodEndpoint),
    ...(kind === 'liveBench' ? { modelCount: Object.keys(snapshot?.models ?? {}).length }
      : { rowCount: Object.keys(snapshot?.prices ?? {}).length }),
  }
}

/** Age means source verification age, not the most recent attempted download. */
export function dynamicDataSummary(data, { enabled = false, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const at = currentTime(now)
  const ttl = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : DEFAULT_TTL_MS
  return {
    enabled: enabled === true,
    liveBench: sourceSummary(data, 'liveBench', enabled === true, ttl, at),
    pricing: sourceSummary(data, 'pricing', enabled === true, ttl, at),
    revision: enabled === true ? String(data?.revision ?? '') : '',
  }
}

/** No prompts, credentials, private endpoints, raw errors or price fetching enter the Client. */
export function routingData(data, enabled = false) {
  return {
    liveBench: enabled === true ? data?.liveBench ?? null : null,
    liveBenchError: enabled === true ? publicError(data?.status?.liveBench?.error) : '',
    dataVersions: {
      liveBench: enabled === true ? data?.liveBench?.version ?? null : null,
      pricing: enabled === true ? data?.pricing?.version ?? null : null,
      revision: enabled === true ? String(data?.revision ?? '') : '',
    },
  }
}
