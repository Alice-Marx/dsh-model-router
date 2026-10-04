import test from 'node:test'
import assert from 'node:assert/strict'
import { createDynamicDataRefresher, applyPricingSnapshot, dynamicDataSummary, routingData } from '../.dsh-plugin/shared/dynamic-data.mjs'
import * as browserView from '../.dsh-plugin/shared/dynamic-data-view.mjs'

const AT = Date.UTC(2026, 9, 4, 0)
const DAY = 86_400_000
const ENDPOINT = 'https://prices.example.com/snapshot.json'
const OPTIONS = { enabled: true, liveBenchEndpoint: '', pricingSnapshotEndpoint: ENDPOINT, ttlMs: DAY }

function memoryStore(initial = {}) {
  let value = structuredClone(initial)
  let chain = Promise.resolve()
  return {
    read: async () => structuredClone(value),
    update(change) {
      const next = chain.then(async () => {
        const fresh = structuredClone(value)
        const result = await change(fresh)
        value = fresh
        return result
      })
      chain = next.catch(() => {})
      return next
    },
  }
}

function prices(overrides = {}) {
  return { schemaVersion: 1, kind: 'pricing', version: 'v1', publishedAt: AT - 1000,
    rows: [{ provider: 'provider-a', model: 'model-a', input: 2, output: 10,
      cacheRead: 0.2, currency: 'USD', unit: 'per-million-tokens', asOf: AT - 2000,
      sourceUrl: 'https://api.vendor.example.com/pricing' }], ...overrides }
}

function benchmark(source = 'livebench:2026-06-25', overrides = {}) {
  return { source, fetchedAt: AT, models: { modela: {
    model: 'model-a', overall: 0.8, overallSource: 'derived', scores: { code: 0.85, math: 0.75 },
  } }, ...overrides }
}

function response(payload, overrides = {}) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload), ...overrides }
}

async function loadPricing(payload = prices(), options = {}) {
  const store = memoryStore()
  const refresh = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => response(payload), ...options })
  const data = await refresh.refresh(OPTIONS)
  return { store, refresh, data }
}

test('disabled dynamic data neither reads storage nor performs public fetches', async () => {
  const store = { read: () => assert.fail('disabled read'), update: () => assert.fail('disabled update') }
  const refresher = createDynamicDataRefresher({ store, fetchImpl: () => assert.fail('network') })
  assert.deepEqual(await refresher.refresh(), { liveBench: null, pricing: null, status: {}, revision: '' })
})

test('pricing validates exact routes, preserves provenance, and uses source verification age', async () => {
  const { data } = await loadPricing()
  assert.equal(data.pricing.prices['provider-a\0model-a'].input, 2)
  assert.equal(data.pricing.source, 'curated-pricing-json')
  assert.equal(data.pricing.verifiedAt, AT - 2000)
  assert.equal(data.pricing.publishedAt, AT - 1000)
  assert.match(data.pricing.hash, /^[a-f0-9]{64}$/u)
  assert.match(data.revision, /^[a-f0-9]{64}$/u)
})

test('public GET has no credentials, authorization or redirects', async () => {
  await loadPricing(prices(), { fetchImpl: async (url, options) => {
    assert.equal(url, ENDPOINT)
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.authorization, undefined)
    return response(prices())
  } })
})

for (const endpoint of ['http://prices.example.com/a', 'https://localhost/a', 'https://127.0.0.1/a',
  'https://[::1]/a', 'https://service.local/a', 'https://user:secret@prices.example.com/a',
  'https://prices.example.com/a?token=secret', 'https://prices.example.com/a#secret', 'https://prices.example.com:8443/a']) {
  test(`rejects unsafe endpoint without network: ${endpoint.split('@').at(-1)}`, async () => {
    const store = memoryStore()
    const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: () => assert.fail('unsafe fetch') })
    const data = await refresher.refresh({ ...OPTIONS, pricingSnapshotEndpoint: endpoint })
    assert.equal(data.pricing, null)
    assert.equal(data.status.pricing.error, 'refresh-failed')
    assert.ok(!data.status.pricing.error.includes('secret'))
    assert.ok(!JSON.stringify(await store.read()).includes('secret'))
    assert.equal(data.status.pricing.endpoint, '')
  })
}

for (const [label, modify] of [
  ['duplicate routes', payload => payload.rows.push({ ...payload.rows[0] })],
  ['negative price', payload => { payload.rows[0].input = -1 }],
  ['non-finite price', payload => { payload.rows[0].output = null }],
  ['missing source', payload => { delete payload.rows[0].sourceUrl }],
  ['wrong unit', payload => { payload.rows[0].unit = 'per-token' }],
  ['wrong currency', payload => { payload.rows[0].currency = 'CNY' }],
  ['future publication', payload => { payload.publishedAt = AT + DAY }],
  ['future verification', payload => { payload.rows[0].asOf = AT + DAY }],
  ['seconds instead of milliseconds', payload => { payload.rows[0].asOf = Math.floor(AT / 1000) }],
  ['verification after publication', payload => { payload.rows[0].asOf = AT }],
  ['complex tiers', payload => { payload.rows[0].tiers = [] }],
  ['empty rows', payload => { payload.rows = [] }],
  ['unsupported root fields', payload => { payload.credentials = 'do-not-accept' }],
]) {
  test(`rejects whole pricing snapshot: ${label}`, async () => {
    const payload = prices()
    modify(payload)
    const { data } = await loadPricing(payload)
    assert.equal(data.pricing, null)
    assert.equal(data.status.pricing.error, 'refresh-failed')
  })
}

test('one invalid row cannot promote the valid portion', async () => {
  const payload = prices()
  payload.rows.push({ ...payload.rows[0], model: 'model-b', output: -1 })
  const { data } = await loadPricing(payload)
  assert.equal(data.pricing, null)
})

test('concurrent identical refreshes are single-flight and TTL suppresses repeated downloads', async () => {
  let calls = 0
  let at = AT
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => at,
    fetchImpl: async () => { calls += 1; return response(prices()) } })
  const [left, right] = await Promise.all([refresher.refresh(OPTIONS), refresher.refresh(OPTIONS)])
  assert.equal(calls, 1)
  assert.equal(left.pricing.hash, right.pricing.hash)
  await refresher.refresh(OPTIONS)
  assert.equal(calls, 1)
  at += DAY
  await refresher.refresh(OPTIONS)
  assert.equal(calls, 2)
})

test('failure keeps last-good data and uses bounded retry backoff', async () => {
  let calls = 0
  let at = AT
  let broken = false
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => at, fetchImpl: async () => {
    calls += 1
    if (broken) throw new Error('private upstream detail')
    return response(prices())
  } })
  const first = await refresher.refresh(OPTIONS)
  broken = true
  at += DAY
  const failed = await refresher.refresh(OPTIONS)
  assert.equal(failed.pricing.hash, first.pricing.hash)
  assert.equal(failed.status.pricing.error, 'refresh-failed')
  assert.equal(dynamicDataSummary(failed, { enabled: true, now: at }).pricing.status, 'stale')
  await refresher.refresh(OPTIONS)
  assert.equal(calls, 2)
  at += 300_000
  await refresher.refresh(OPTIONS)
  assert.equal(calls, 3)
})

test('a newly downloaded old price is stale even when the refresh succeeded', async () => {
  const payload = prices()
  payload.rows[0].asOf = AT - 3 * DAY
  const { data } = await loadPricing(payload)
  assert.equal(data.status.pricing.error, '')
  assert.equal(dynamicDataSummary(data, { enabled: true, now: AT }).pricing.status, 'stale')
})

test('published versions and verification timestamps cannot roll backward', async () => {
  let payload = prices()
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => response(payload) })
  const first = await refresher.refresh(OPTIONS)
  payload = prices({ version: 'v0', publishedAt: AT - 3000 })
  payload.rows[0].asOf = AT - 4000
  const older = await refresher.refresh({ ...OPTIONS, force: true })
  assert.equal(older.pricing.hash, first.pricing.hash)
  assert.equal(older.status.pricing.error, 'snapshot-rollback-rejected')
  payload = prices({ version: 'v2', publishedAt: AT })
  payload.rows[0].asOf = AT - 3000
  const oldVerification = await refresher.refresh({ ...OPTIONS, force: true })
  assert.equal(oldVerification.pricing.hash, first.pricing.hash)
})

test('same immutable price version cannot silently change its contents', async () => {
  let payload = prices()
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => response(payload) })
  const first = await refresher.refresh(OPTIONS)
  payload.rows[0].input = 3
  const changed = await refresher.refresh({ ...OPTIONS, force: true })
  assert.equal(changed.pricing.hash, first.pricing.hash)
  assert.equal(changed.status.pricing.error, 'snapshot-rollback-rejected')
})

test('newer minimum verification age cannot hide a rollback for another exact route', async () => {
  let payload = prices()
  payload.rows.push({ ...payload.rows[0], model: 'model-b', asOf: AT - 1500 })
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => response(payload) })
  const first = await refresher.refresh(OPTIONS)
  payload = prices({ version: 'v2', publishedAt: AT })
  payload.rows[0].asOf = AT - 1000
  payload.rows.push({ ...payload.rows[0], model: 'model-b', asOf: AT - 1800 })
  const rollback = await refresher.refresh({ ...OPTIONS, force: true })
  assert.equal(rollback.pricing.hash, first.pricing.hash)
  assert.equal(rollback.status.pricing.error, 'snapshot-rollback-rejected')
})

test('new version updates all rates atomically', async () => {
  let payload = prices()
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => response(payload) })
  const first = await refresher.refresh(OPTIONS)
  payload = prices({ version: 'v2', publishedAt: AT })
  payload.rows[0].input = 1
  payload.rows[0].asOf = AT - 1000
  const updated = await refresher.refresh({ ...OPTIONS, force: true })
  assert.equal(updated.pricing.version, 'v2')
  assert.equal(updated.pricing.prices['provider-a\0model-a'].input, 1)
  assert.notEqual(updated.pricing.hash, first.pricing.hash)
})

test('cross-process reservation stops a late old endpoint response overwriting a new source', async () => {
  const store = memoryStore()
  let resolveOld
  let startedOld
  const oldStarted = new Promise(resolve => { startedOld = resolve })
  const oldRefresh = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => {
    startedOld()
    return new Promise(resolve => { resolveOld = resolve })
  } })
  const oldPending = oldRefresh.refresh(OPTIONS)
  await oldStarted
  const newRefresh = createDynamicDataRefresher({ store, now: () => AT + 1,
    fetchImpl: async () => response(prices({ version: 'new-source' })) })
  const newer = await newRefresh.refresh({ ...OPTIONS, pricingSnapshotEndpoint: 'https://new.example.com/prices.json' })
  resolveOld(response(prices()))
  await oldPending
  assert.equal((await store.read()).dynamicData.pricing.hash, newer.pricing.hash)
  assert.equal((await store.read()).dynamicData.pricing.version, 'new-source')
})

test('clearing pricing source disables returned data but keeps recoverable stored last-good', async () => {
  const { store, refresh, data } = await loadPricing()
  const cleared = await refresh.refresh({ ...OPTIONS, pricingSnapshotEndpoint: '' })
  assert.equal(cleared.pricing, null)
  assert.equal(dynamicDataSummary(cleared, { enabled: true, now: AT }).pricing.status, 'disabled')
  assert.equal((await store.read()).dynamicData.pricing.hash, data.pricing.hash)
})

test('pricing applies only to exact provider/model and never overrides manual prices', async () => {
  const { data } = await loadPricing()
  const manual = { provider: 'provider-a', model: 'model-a', pricing: { input: 99, output: 99 }, pricingSource: 'user' }
  const otherProvider = { provider: 'provider-b', model: 'model-a' }
  const otherVersion = { provider: 'provider-a', model: 'model-a-max' }
  const matching = { provider: 'provider-a', model: 'model-a' }
  const results = applyPricingSnapshot([manual, otherProvider, otherVersion, matching], data.pricing)
  assert.equal(results[0], manual)
  assert.equal(results[1], otherProvider)
  assert.equal(results[2], otherVersion)
  assert.equal(results[3].pricing.input, 2)
  assert.equal(results[3].pricingSource, 'dynamic')
  assert.equal(results[3].pricingVersion, 'v1')
})

test('benchmark snapshot preserves exact raw model identity and release/version hash', async () => {
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchBenchmark: async () => benchmark() })
  const data = await refresher.refresh({ enabled: true })
  assert.equal(data.liveBench.models.modela.model, 'model-a')
  assert.equal(data.liveBench.exactModelMatch, true)
  assert.equal(data.liveBench.version, '2026-06-25')
  assert.equal(data.liveBench.verifiedAt, AT)
  assert.equal(data.liveBench.publishedAt, Date.UTC(2026, 5, 25))
})

for (const [label, payload] of [
  ['empty models', benchmark(undefined, { models: {} })],
  ['score out of range', benchmark(undefined, { models: { modela: { model: 'model-a', overall: 0.8, overallSource: 'explicit', scores: { code: 8 } } } })],
  ['missing raw model', benchmark(undefined, { models: { modela: { overall: 0.8, overallSource: 'explicit', scores: {} } } })],
  ['mismatched raw identity', benchmark(undefined, { models: { modela: { model: 'model-b', overall: 0.8, overallSource: 'explicit', scores: {} } } })],
  ['future release', benchmark('livebench:2027-01-01')],
]) {
  test(`rejects benchmark: ${label}`, async () => {
    const store = memoryStore()
    const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchBenchmark: async () => payload })
    const data = await refresher.refresh({ enabled: true })
    assert.equal(data.liveBench, null)
    assert.equal(data.status.liveBench.error, 'refresh-failed')
  })
}

test('official release fallback cannot replace a newer last-good benchmark', async () => {
  let payload = benchmark('livebench:2026-09-25')
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchBenchmark: async () => payload })
  const first = await refresher.refresh({ enabled: true })
  payload = benchmark()
  const older = await refresher.refresh({ enabled: true, force: true })
  assert.equal(older.liveBench.hash, first.liveBench.hash)
  assert.equal(older.status.liveBench.error, 'snapshot-rollback-rejected')
})

test('benchmark content hash ignores download timestamp', async () => {
  let at = AT
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => at, fetchBenchmark: async () => benchmark(undefined, { fetchedAt: at }) })
  const first = await refresher.refresh({ enabled: true })
  at += DAY
  const second = await refresher.refresh({ enabled: true })
  assert.equal(first.liveBench.hash, second.liveBench.hash)
  assert.notEqual(first.liveBench.verifiedAt, second.liveBench.verifiedAt)
})

test('unversioned benchmark mirrors get a content identity, not a fake ordered release', async () => {
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchBenchmark: async () => benchmark('livebench-json-mirror') })
  const data = await refresher.refresh({ enabled: true })
  assert.match(data.liveBench.version, /^[a-f0-9]{64}$/u)
  assert.equal(data.liveBench.publishedAt, null)
})

test('oversized and redirected responses are rejected without storing their bodies', async () => {
  for (const badResponse of [response(prices(), { redirected: true }),
    response(prices(), { headers: { get: () => String(5 * 1024 * 1024) }, text: () => assert.fail('oversized text') })]) {
    const { data } = await loadPricing(prices(), { fetchImpl: async () => badResponse })
    assert.equal(data.pricing, null)
    assert.equal(data.status.pricing.error, 'refresh-failed')
  }
})

test('streamed JSON is decoded without whole-response text buffering', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(prices()))
  const chunks = [bytes.slice(0, 12), bytes.slice(12)]
  const body = new ReadableStream({ pull(controller) {
    if (chunks.length) controller.enqueue(chunks.shift())
    else controller.close()
  } })
  const { data } = await loadPricing(prices(), { fetchImpl: async () => response(prices(), {
    body, text: () => assert.fail('stream should be bounded in chunks'),
  }) })
  assert.equal(data.pricing.version, 'v1')
})

test('oversized stream is cancelled and cannot promote a partial JSON snapshot', async () => {
  let cancelled = false
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)) },
    cancel() { cancelled = true } })
  const { data } = await loadPricing(prices(), { fetchImpl: async () => response(prices(), { body }) })
  assert.equal(data.pricing, null)
  assert.equal(cancelled, true)
})

test('browser-safe public view exports match Host projections, including disable and version data', async () => {
  const { data } = await loadPricing()
  assert.deepEqual(browserView.dynamicDataSummary(data, { enabled: true, now: AT }), dynamicDataSummary(data, { enabled: true, now: AT }))
  assert.deepEqual(routingData(data, false), { liveBench: null, liveBenchError: '', dataVersions: { liveBench: null, pricing: null, revision: '' } })
  assert.equal(routingData(data, true).dataVersions.pricing, 'v1')
  assert.equal(dynamicDataSummary(data).pricing.status, 'disabled')
  assert.equal(dynamicDataSummary(data, { enabled: true, now: AT }).pricing.status, 'fresh')
  assert.equal(dynamicDataSummary({ status: { pricing: { error: 'https://private:secret@example.com' } } }, { enabled: true }).pricing.error, 'refresh-failed')
})
