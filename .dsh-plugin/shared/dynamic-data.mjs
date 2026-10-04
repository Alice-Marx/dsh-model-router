/**
 * Opt-in public-data refresh, never an API/model call. Pricing is a user-chosen
 * curated JSON feed with official documentation citations, NOT a universal
 * scraper or an independently authenticated official price service.
 *
 * Whole snapshots are validated before atomic promotion; a request reservation
 * prevents late responses from replacing another process's newer request.
 * Domain-name checks are not DNS-rebinding isolation: deployments must apply
 * their own outbound network policy if untrusted users can configure endpoints.
 */
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { fetchLiveBenchSnapshot } from './livebench.mjs'
export { applyPricingSnapshot, dynamicDataSummary, routingData } from './dynamic-data-view.mjs'

const DEFAULT_TTL_MS = 86_400_000
const TIMEOUT_MS = 8000
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
const MAX_ROWS = 2000
const MAX_CLOCK_SKEW_MS = 60_000
const ROW_FIELDS = new Set(['provider', 'model', 'input', 'output', 'cacheRead', 'cacheWrite', 'currency', 'unit', 'asOf', 'sourceUrl'])
const PRICE_FIELDS = new Set(['schemaVersion', 'kind', 'version', 'publishedAt', 'rows'])
const SCORE_FIELDS = new Set(['reasoning', 'code', 'math', 'research', 'writing', 'vision', 'summarization', 'classification'])
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value)
const emptyData = () => ({ liveBench: null, pricing: null, status: {}, revision: '' })

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (object(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

const hash = value => createHash('sha256').update(stable(value)).digest('hex')
function dataOf(state) {
  const data = state?.dynamicData
  return object(data) ? { liveBench: data.liveBench ?? null, pricing: data.pricing ?? null,
    status: object(data.status) ? { ...data.status } : {}, revision: String(data.revision ?? '') } : emptyData()
}

function revisionOf(data) {
  return hash({ liveBench: data.liveBench?.hash ?? null, pricing: data.pricing?.hash ?? null, status: data.status })
}

function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('invalid-public-url')
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.port && url.port !== '443') || isIP(host) || host.startsWith('[')
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(host)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/u.test(host)) throw new Error('invalid-public-url')
  return url.toString()
}

function identifier(value, max = 240) {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('invalid-identifier')
  return value
}

function timestamp(value, at) {
  if (!Number.isSafeInteger(value) || value < Date.UTC(2000, 0, 1)
    || value > at + MAX_CLOCK_SKEW_MS) throw new Error('invalid-timestamp')
  return value
}

function boundedPrice(value) {
  if (!finite(value) || value < 0 || value > 1_000_000) throw new Error('invalid-price')
  return value
}

function pricingSnapshot(payload, endpoint, at) {
  if (!object(payload) || Object.keys(payload).some(key => !PRICE_FIELDS.has(key))
    || payload.schemaVersion !== 1 || payload.kind !== 'pricing'
    || !Array.isArray(payload.rows) || payload.rows.length === 0 || payload.rows.length > MAX_ROWS) throw new Error('invalid-price-snapshot')
  const version = identifier(payload.version, 160)
  const publishedAt = timestamp(payload.publishedAt, at)
  const prices = {}
  let verifiedAt = Number.POSITIVE_INFINITY
  for (const row of payload.rows) {
    if (!object(row) || Object.keys(row).some(key => !ROW_FIELDS.has(key))
      || row.currency !== 'USD' || row.unit !== 'per-million-tokens') throw new Error('unsupported-price-schema')
    const provider = identifier(row.provider, 160)
    const model = identifier(row.model)
    const key = `${provider}\0${model}`
    if (Object.hasOwn(prices, key)) throw new Error('duplicate-route')
    const asOf = timestamp(row.asOf, at)
    if (asOf > publishedAt) throw new Error('verification-after-publication')
    verifiedAt = Math.min(verifiedAt, asOf)
    prices[key] = { provider, model, input: boundedPrice(row.input), output: boundedPrice(row.output),
      ...(row.cacheRead === undefined ? {} : { cacheRead: boundedPrice(row.cacheRead) }),
      ...(row.cacheWrite === undefined ? {} : { cacheWrite: boundedPrice(row.cacheWrite) }),
      currency: 'USD', unit: 'per-million-tokens', asOf, sourceUrl: publicUrl(row.sourceUrl) }
  }
  const snapshot = { kind: 'pricing', source: 'curated-pricing-json', endpoint, verifiedAt, publishedAt, version, prices }
  return { ...snapshot, hash: hash({ kind: snapshot.kind, version, publishedAt, prices }) }
}

function benchmarkSnapshot(payload, endpoint, at) {
  if (!object(payload) || !object(payload.models) || Object.keys(payload.models).length === 0
    || Object.keys(payload.models).length > MAX_ROWS) throw new Error('empty-benchmark')
  const models = {}
  for (const [id, row] of Object.entries(payload.models)) {
    // The existing adapter supplies normalized model ids, not provider aliases.
    if (!/^[a-z0-9]{1,240}$/u.test(id) || !object(row) || !object(row.scores)
      || !finite(row.overall) || row.overall < 0 || row.overall > 1) throw new Error('invalid-benchmark-row')
    const model = identifier(row.model)
    if (model.toLowerCase().replace(/[^a-z0-9]+/gu, '') !== id) throw new Error('invalid-benchmark-model-id')
    const scores = {}
    for (const [task, score] of Object.entries(row.scores)) {
      if (!SCORE_FIELDS.has(task) || !finite(score) || score < 0 || score > 1) throw new Error('invalid-benchmark-score')
      scores[task] = score
    }
    if (row.overallSource !== 'explicit' && row.overallSource !== 'derived') throw new Error('invalid-benchmark-provenance')
    if (row.rank !== undefined && (!finite(row.rank) || row.rank < 0)) throw new Error('invalid-benchmark-rank')
    models[id] = { model, overall: row.overall, overallSource: row.overallSource, scores,
      ...(row.rank === undefined ? {} : { rank: row.rank }) }
  }
  const source = identifier(payload.source ?? 'livebench-json-mirror', 160)
  const release = /^livebench:(20\d{2}-\d{2}-\d{2})$/u.exec(source)?.[1]
  let publishedAt = null
  if (release) {
    publishedAt = Date.parse(`${release}T00:00:00.000Z`)
    if (!Number.isSafeInteger(publishedAt) || new Date(publishedAt).toISOString().slice(0, 10) !== release
      || publishedAt > at + MAX_CLOCK_SKEW_MS) throw new Error('invalid-benchmark-release')
  } else if (payload.publishedAt !== undefined) {
    publishedAt = timestamp(payload.publishedAt, at)
  }
  const contentHash = hash({ source, publishedAt, models })
  return { kind: 'liveBench', source, endpoint, verifiedAt: at, publishedAt, exactModelMatch: true,
    version: release ?? contentHash, hash: contentHash, models }
}

function mayPromote(previous, candidate) {
  if (!previous) return true
  // If the feed supplies no publication metadata, hash identity is NOT time order.
  if (finite(previous.publishedAt) && finite(candidate.publishedAt) && candidate.publishedAt < previous.publishedAt) return false
  if (candidate.kind === 'pricing') {
    if (finite(previous.verifiedAt) && candidate.verifiedAt < previous.verifiedAt) return false
    for (const [key, entry] of Object.entries(candidate.prices)) {
      if (finite(previous.prices?.[key]?.asOf) && entry.asOf < previous.prices[key].asOf) return false
    }
    if (previous.publishedAt === candidate.publishedAt && previous.hash !== candidate.hash) return false
    if (previous.version === candidate.version && previous.hash !== candidate.hash) return false
  }
  return true
}

async function limitedText(response) {
  const length = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(length) && length > MAX_PAYLOAD_BYTES) throw new Error('payload-too-large')
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('payload-too-large')
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return text + decoder.decode()
      size += chunk.value.byteLength
      if (size > MAX_PAYLOAD_BYTES) throw new Error('payload-too-large')
      text += decoder.decode(chunk.value, { stream: true })
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
}

function publicFetch(fetchImpl) {
  return async (input, options = {}) => {
    const endpoint = publicUrl(String(input))
    const response = await fetchImpl(endpoint, {
      method: 'GET', headers: { accept: 'application/json,text/csv,text/html' },
      credentials: 'omit', redirect: 'error', signal: options.signal,
    })
    if (!response?.ok || response.redirected) throw new Error('public-fetch-failed')
    if (response.url && publicUrl(response.url) !== endpoint) throw new Error('public-fetch-redirected')
    return { ok: true, status: response.status, headers: response.headers,
      text: () => limitedText(response) }
  }
}

async function withTimeout(run) {
  const controller = new AbortController()
  let timer
  let rejectTimeout
  const timeout = new Promise((_, reject) => { rejectTimeout = reject })
  timer = setTimeout(() => { controller.abort(); rejectTimeout(new Error('refresh-timeout')) }, TIMEOUT_MS)
  try { return await Promise.race([run(controller.signal), timeout]) }
  finally { clearTimeout(timer) }
}

function due(data, kind, endpoint, ttlMs, at, force) {
  const status = data.status?.[kind]
  if (force || status?.endpoint !== endpoint || !finite(status?.lastAttemptAt)) return true
  const delay = status.error ? Math.min(ttlMs, 300_000) : ttlMs
  return at - status.lastAttemptAt >= delay
}

/**
 * Store API: read() -> state, update(change) -> change's return value; change
 * mutates the fresh state under the caller's interprocess/atomic write lock.
 */
export function createDynamicDataRefresher({ store, fetchImpl = globalThis.fetch, now = Date.now,
  fetchBenchmark = fetchLiveBenchSnapshot } = {}) {
  if (typeof store?.read !== 'function' || typeof store?.update !== 'function') throw new Error('dynamic-data-store-required')
  const flights = new Map()
  const refresh = async (options = {}) => {
    if (options.enabled !== true) return emptyData()
    const ttlMs = finite(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : DEFAULT_TTL_MS
    const liveBenchEndpoint = options.liveBenchEndpoint ?? 'https://livebench.ai'
    const pricingSnapshotEndpoint = options.pricingSnapshotEndpoint ?? ''
    // Never reserve, persist, hash or return an unchecked raw endpoint: a bad
    // URL can contain credentials even though no network request is made.
    const sources = [['liveBench', liveBenchEndpoint], ['pricing', pricingSnapshotEndpoint]].map(([kind, raw]) => {
      if (typeof raw === 'string' && raw.trim() === '') return { kind, endpoint: '', disabled: true, invalid: false }
      try { return { kind, endpoint: publicUrl(raw), disabled: false, invalid: false } }
      catch { return { kind, endpoint: '', disabled: false, invalid: true } }
    })
    const key = stable([sources, ttlMs, options.force === true])
    if (flights.has(key)) return flights.get(key)
    const operation = (async () => {
      const initial = dataOf(await store.read())
      const requests = sources.filter(source => !source.disabled)
        .filter(({ kind, endpoint }) => due(initial, kind, endpoint, ttlMs, now(), options.force === true))
      await Promise.all(requests.map(async ({ kind, endpoint, invalid }) => {
        const at = now()
        const requestId = randomUUID()
        // Reserve before network I/O. Another process or source change wins by
        // replacing this token; a late completion then cannot mutate its data.
        const reserved = await store.update(state => {
          const data = dataOf(state)
          if (!due(data, kind, endpoint, ttlMs, at, options.force === true)) return false
          data.status[kind] = { ...(data.status[kind] ?? {}), endpoint,
            lastAttemptAt: at, requestId, error: '' }
          data.revision = revisionOf(data)
          state.dynamicData = data
          return true
        })
        if (!reserved) return
        let candidate
        let error = ''
        try {
          if (invalid) throw new Error('invalid-public-url')
          if (typeof fetchImpl !== 'function') throw new Error('fetch-unavailable')
          const fetchPublic = publicFetch(fetchImpl)
          candidate = await withTimeout(async signal => {
            if (kind === 'liveBench') {
              const payload = await fetchBenchmark({ endpoint, fetchImpl: fetchPublic, timeoutMs: TIMEOUT_MS, strict: true })
              return benchmarkSnapshot(payload, endpoint, now())
            }
            const response = await fetchPublic(endpoint, { signal })
            return pricingSnapshot(JSON.parse(await response.text()), endpoint, now())
          })
        } catch { error = 'refresh-failed' }
        await store.update(state => {
          const data = dataOf(state)
          if (data.status[kind]?.requestId !== requestId) return false
          if (candidate && !mayPromote(data[kind], candidate)) error = 'snapshot-rollback-rejected'
          if (candidate && !error) data[kind] = candidate
          data.status[kind] = { ...data.status[kind], error,
            ...(candidate && !error ? { lastSuccessAt: now() } : {}) }
          delete data.status[kind].requestId
          data.revision = revisionOf(data)
          state.dynamicData = data
          return true
        })
      }))
      const result = dataOf(await store.read())
      // A user clearing a source disables its use immediately, without erasing
      // recoverable last-good snapshots from disk.
      for (const { kind, disabled } of sources) {
        if (disabled) {
          result[kind] = null
          result.status[kind] = { disabled: true, endpoint: '', error: '' }
        }
      }
      result.revision = revisionOf(result)
      return result
    })()
    flights.set(key, operation)
    try { return await operation }
    finally { if (flights.get(key) === operation) flights.delete(key) }
  }
  return { refresh }
}
