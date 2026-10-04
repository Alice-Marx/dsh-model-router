/** Public, browser-safe projections of dynamic benchmark/pricing snapshots. */
const DEFAULT_TTL_MS = 86_400_000
const currentTime = value => typeof value === 'function' ? value() : value ?? Date.now()
const exactRouteKey = route => `${String(route?.provider ?? '')}\0${String(route?.model ?? '')}`
const publicError = value => value === 'snapshot-rollback-rejected' ? value : value ? 'refresh-failed' : ''

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
  const expired = verifiedAt !== null && at - verifiedAt > ttlMs
  const error = publicError(status?.error)
  return {
    status: !enabled || status?.disabled ? 'disabled' : !snapshot ? (error ? 'error' : 'missing')
      : expired || error ? 'stale' : 'fresh',
    verifiedAt, publishedAt: snapshot?.publishedAt ?? null,
    version: snapshot?.version ?? null, source: snapshot?.source ?? null,
    endpoint: snapshot?.endpoint ?? null, configuredEndpoint: status?.endpoint ?? null,
    error: enabled ? error : '',
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
