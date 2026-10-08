import test from 'node:test'
import assert from 'node:assert/strict'
import { createDynamicDataRefresher, dynamicDataSummary, projectDynamicData, publicDynamicEndpoint } from '../.dsh-plugin/shared/dynamic-data.mjs'
import * as browserView from '../.dsh-plugin/shared/dynamic-data-view.mjs'

const AT = Date.UTC(2026, 9, 7)
const DAY = 86_400_000
const A = 'https://a.example.com/pricing.json'
const B = 'https://b.example.com/pricing.json'
const OPTIONS = { enabled: true, liveBenchEndpoint: '', pricingSnapshotEndpoint: A, ttlMs: DAY }

function memoryStore(initial = {}) {
  let value = structuredClone(initial)
  let chain = Promise.resolve()
  return {
    read: async () => { await chain; return structuredClone(value) },
    update(change) {
      const result = chain.then(async () => {
        const fresh = structuredClone(value)
        const returned = await change(fresh)
        value = fresh
        return returned
      })
      chain = result.catch(() => {})
      return result
    },
  }
}

function price(version = 'v1', at = AT) {
  return { schemaVersion: 1, kind: 'pricing', version, publishedAt: at - 1000,
    rows: [{ provider: 'p', model: 'm', input: 1, output: 2, currency: 'USD', unit: 'per-million-tokens',
      asOf: at - 2000, sourceUrl: 'https://vendor.example.com/pricing' }] }
}
const response = (payload, extra = {}) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload), ...extra })
function deferred() {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}
async function seed(store = memoryStore()) {
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => response(price()) })
  const data = await refresher.refresh(OPTIONS)
  return { store, data }
}

test('maturity: interrupted reservations recover after their lease instead of waiting a day', async () => {
  const { store } = await seed()
  await store.update(state => {
    state.dynamicData.status.pricing = { endpoint: A, lastAttemptAt: AT, requestId: 'crashed-old-process', error: '' }
  })
  let calls = 0
  const refresher = createDynamicDataRefresher({ store, now: () => AT + 60_000,
    fetchImpl: async () => { calls += 1; return response(price('v2', AT + 60_000)) } })
  const data = await refresher.refresh(OPTIONS)
  assert.equal(calls, 1)
  assert.equal(data.pricing.version, 'v2')
  assert.equal(data.status.pricing.requestId, undefined)
})

test('maturity: another process respects a healthy reservation and reports pending verification', async () => {
  const store = memoryStore()
  const started = deferred()
  const release = deferred()
  const first = createDynamicDataRefresher({ store, now: () => AT,
    fetchImpl: async () => { started.resolve(); return release.promise } })
  const pending = first.refresh(OPTIONS)
  await started.promise
  const second = createDynamicDataRefresher({ store, now: () => AT + 1000, fetchImpl: () => assert.fail('duplicate pending fetch') })
  const observed = await second.refresh(OPTIONS)
  const summary = dynamicDataSummary(observed, { enabled: true, now: AT + 1000 })
  assert.equal(summary.pricing.pending, true)
  assert.equal(summary.pricing.refreshing, true)
  assert.equal(summary.pricing.lastAttemptAt, AT)
  release.resolve(response(price()))
  await pending
})

test('maturity: pending retry preserves the previous failure until a new success is actually verified', async () => {
  const { store } = await seed()
  await store.update(state => { state.dynamicData.status.pricing.error = 'refresh-failed' })
  const started = deferred()
  const release = deferred()
  const refresher = createDynamicDataRefresher({ store, now: () => AT,
    fetchImpl: async () => { started.resolve(); return release.promise } })
  const pending = refresher.refresh({ ...OPTIONS, force: true })
  await started.promise
  const summary = dynamicDataSummary((await store.read()).dynamicData, { enabled: true, now: AT })
  assert.equal(summary.pricing.status, 'stale')
  assert.equal(summary.pricing.error, 'refresh-failed')
  assert.equal(summary.pricing.refreshing, true)
  release.resolve(response(price()))
  assert.equal((await pending).status.pricing.error, '')
})

test('maturity: clock corrections cannot freeze a future-dated attempt for 24 hours', async () => {
  const { store } = await seed()
  await store.update(state => { state.dynamicData.status.pricing.lastAttemptAt = AT + DAY })
  let calls = 0
  const refresher = createDynamicDataRefresher({ store, now: () => AT,
    fetchImpl: async () => { calls += 1; return response(price()) } })
  await refresher.refresh(OPTIONS)
  assert.equal(calls, 1)
})

test('maturity: summary detects an expired legacy reservation and invalid future verification age', () => {
  const data = { pricing: { verifiedAt: AT + DAY, prices: {} }, status: { pricing: { requestId: 'old', lastAttemptAt: AT - 60_000 } } }
  const summary = dynamicDataSummary(data, { enabled: true, now: AT })
  assert.equal(summary.pricing.status, 'stale')
  assert.equal(summary.pricing.error, 'refresh-interrupted')
  assert.equal(summary.pricing.pending, false)
})

test('maturity: new source B failure does not use A prices or delete their recoverable disk snapshot', async () => {
  const { store, data: previous } = await seed()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => { throw new Error('unavailable') } })
  const current = await refresher.refresh({ ...OPTIONS, pricingSnapshotEndpoint: B })
  assert.equal(current.pricing, null)
  assert.equal((await store.read()).dynamicData.pricing.hash, previous.pricing.hash)
  const summary = dynamicDataSummary(current, { enabled: true, now: AT })
  assert.equal(summary.pricing.error, 'refresh-failed')
  assert.equal(summary.pricing.configuredEndpoint, B)
  assert.equal(summary.pricing.lastGoodEndpoint, A)
})

test('maturity: enabled source cancellation revokes an old response and aborts its network signal', async () => {
  const { store, data: previous } = await seed()
  const started = deferred()
  const release = deferred()
  let signal
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async (_url, options) => {
    signal = options.signal
    started.resolve()
    return release.promise
  } })
  const pending = refresher.refresh({ ...OPTIONS, force: true })
  await started.promise
  const disabled = await refresher.refresh({ ...OPTIONS, pricingSnapshotEndpoint: '' })
  assert.equal(disabled.pricing, null)
  assert.equal(signal.aborted, true)
  release.resolve(response(price('v2', AT + 1)))
  await pending
  const stored = (await store.read()).dynamicData
  assert.equal(stored.pricing.hash, previous.pricing.hash)
  assert.equal(stored.status.pricing.disabled, true)
  assert.equal(stored.status.pricing.requestId, undefined)
})

test('maturity: global disable can cancel this process pending work without contacting any new source', async () => {
  const { store, data: previous } = await seed()
  const started = deferred()
  const release = deferred()
  let signal
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async (_url, options) => {
    signal = options.signal; started.resolve(); return release.promise
  } })
  const pending = refresher.refresh({ ...OPTIONS, force: true })
  await started.promise
  const disabled = await refresher.refresh({ enabled: false })
  assert.equal(disabled.pricing, null)
  assert.equal(signal.aborted, true)
  release.resolve(response(price('v2', AT + 1)))
  await pending
  assert.equal((await store.read()).dynamicData.pricing.hash, previous.pricing.hash)
})

test('maturity: same-process source switches discard late A and only apply successful B', async () => {
  const store = memoryStore()
  const started = deferred()
  const release = deferred()
  let oldSignal
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async (url, options) => {
    if (url === A) { oldSignal = options.signal; started.resolve(); return release.promise }
    return response(price('b-version'))
  } })
  const pending = refresher.refresh(OPTIONS)
  await started.promise
  const latest = await refresher.refresh({ ...OPTIONS, pricingSnapshotEndpoint: B })
  assert.equal(oldSignal.aborted, true)
  assert.equal(latest.pricing.endpoint, B)
  release.resolve(response(price()))
  const staleCaller = await pending
  assert.equal(staleCaller.pricing, null)
  assert.equal((await store.read()).dynamicData.pricing.version, 'b-version')
})

test('maturity: changing price source does not cancel an unchanged benchmark source refresh', async () => {
  const store = memoryStore()
  const started = deferred()
  const release = deferred()
  let benchmarkSignal
  const refresher = createDynamicDataRefresher({ store, now: () => AT,
    fetchImpl: async () => response(price()), fetchBenchmark: async ({ signal }) => {
      benchmarkSignal = signal; started.resolve(); await release.promise
      return { source: 'livebench:2026-09-25', models: { m: { model: 'm', overall: 0.8, overallSource: 'explicit', scores: { code: 0.8 } } } }
    } })
  const firstOptions = { ...OPTIONS, liveBenchEndpoint: 'https://bench.example.com/' }
  const pending = refresher.refresh(firstOptions)
  await started.promise
  await refresher.refresh({ ...firstOptions, pricingSnapshotEndpoint: B })
  assert.equal(benchmarkSignal.aborted, false)
  release.resolve()
  await pending
  assert.equal((await store.read()).dynamicData.liveBench.version, '2026-09-25')
})

test('maturity: disabling cancels every overlapping forced request, not only the newest token', async () => {
  const store = memoryStore()
  const firstStarted = deferred()
  const secondStarted = deferred()
  const release = deferred()
  const signals = []
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async (_url, options) => {
    signals.push(options.signal)
    if (signals.length === 1) firstStarted.resolve()
    else secondStarted.resolve()
    return release.promise
  } })
  const first = refresher.refresh(OPTIONS)
  await firstStarted.promise
  const second = refresher.refresh({ ...OPTIONS, force: true })
  await secondStarted.promise
  await refresher.refresh({ enabled: false })
  assert.equal(signals.length, 2)
  assert.equal(signals.every(signal => signal.aborted), true)
  release.resolve(response(price()))
  await Promise.all([first, second])
  assert.equal((await store.read()).dynamicData.pricing, null)
})

test('maturity: outer benchmark timeout reaches public fetch even when the adapter ignores its own timeout', async () => {
  const store = memoryStore()
  let networkSignal
  let cancelled = false
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}) } })
  const refresher = createDynamicDataRefresher({ store, now: () => AT, timeoutMs: 20,
    fetchImpl: async (_url, options) => { networkSignal = options.signal; return response({}, { body }) },
    fetchBenchmark: async ({ fetchImpl }) => {
      const result = await fetchImpl('https://bench.example.com/hanging')
      return JSON.parse(await result.text())
    } })
  const data = await refresher.refresh({ enabled: true })
  assert.equal(data.liveBench, null)
  assert.equal(data.status.liveBench.error, 'refresh-failed')
  assert.equal(networkSignal.aborted, true)
  assert.equal(cancelled, true)
})

test('maturity: huge Content-Length and rejected redirect cancel unused bodies', async () => {
  for (const extra of [{ headers: { get: () => String(5 * 1024 * 1024) } }, { redirected: true }]) {
    let cancelled = false
    const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}) } })
    const store = memoryStore()
    const refresher = createDynamicDataRefresher({ store, now: () => AT,
      fetchImpl: async () => response(price(), { ...extra, body }) })
    const data = await refresher.refresh(OPTIONS)
    assert.equal(data.pricing, null)
    assert.equal(cancelled, true)
  }
})

test('maturity: an unsafe response URL also cancels its unused body and never persists the URL', async () => {
  let cancelled = false
  const body = new ReadableStream({ cancel() { cancelled = true } })
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT,
    fetchImpl: async () => response(price(), { body, url: 'https://user:private@a.example.com/pricing.json' }) })
  const data = await refresher.refresh(OPTIONS)
  assert.equal(data.pricing, null)
  assert.equal(cancelled, true)
  assert.ok(!JSON.stringify(await store.read()).includes('private'))
})

test('maturity: bad stream cancellation cannot turn the 4 MiB rejection into an 8 second wait', async () => {
  let signal
  let cancelled = false
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)) },
    cancel() { cancelled = true; return new Promise(() => {}) } })
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, timeoutMs: 500,
    fetchImpl: async (_url, options) => { signal = options.signal; return response(price(), { body }) } })
  const data = await refresher.refresh(OPTIONS)
  assert.equal(data.pricing, null)
  assert.equal(cancelled, true)
  assert.equal(signal.aborted, false, 'size rejection should finish without waiting for timeout')
})

test('maturity: malformed UTF-8 is rejected rather than silently changing a model identity', async () => {
  const prefix = new TextEncoder().encode(JSON.stringify(price()).replace('"model":"m"', '"model":"mPLACEHOLDER"'))
  const offset = new TextDecoder().decode(prefix).indexOf('PLACEHOLDER')
  const bytes = new Uint8Array([...prefix.slice(0, offset), 0xff, ...prefix.slice(offset + 'PLACEHOLDER'.length)])
  const body = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
  const store = memoryStore()
  const refresher = createDynamicDataRefresher({ store, now: () => AT, fetchImpl: async () => response(price(), { body }) })
  assert.equal((await refresher.refresh(OPTIONS)).pricing, null)
})

test('maturity: failed reservation keeps saved prices but cannot report a successful re-verification', async () => {
  const { store, data: previous } = await seed()
  const failedStore = { read: store.read, update: async () => { throw new Error('private disk path') } }
  const refresher = createDynamicDataRefresher({ store: failedStore, now: () => AT,
    fetchImpl: () => assert.fail('cannot fetch without a durable reservation') })
  const data = await refresher.refresh({ ...OPTIONS, force: true })
  assert.equal(data.pricing.hash, previous.pricing.hash)
  assert.equal(data.status.pricing.error, 'storage-failed')
  assert.equal(dynamicDataSummary(data, { enabled: true, now: AT }).pricing.status, 'stale')
  assert.equal((await store.read()).dynamicData.status.pricing.error, '')
})

test('maturity: failed final persistence cannot promote a candidate or delete the last-good snapshot', async () => {
  const { store, data: previous } = await seed()
  let writes = 0
  const faultyStore = { read: store.read, update(change) {
    writes += 1
    if (writes === 2) return Promise.reject(new Error('disk unavailable'))
    return store.update(change)
  } }
  const refresher = createDynamicDataRefresher({ store: faultyStore, now: () => AT + 3000,
    fetchImpl: async () => response(price('v2', AT + 3000)) })
  const data = await refresher.refresh({ ...OPTIONS, force: true })
  assert.equal(data.pricing.hash, previous.pricing.hash)
  assert.equal(data.status.pricing.error, 'storage-failed')
  assert.equal(data.status.pricing.requestId, undefined)
  assert.equal((await store.read()).dynamicData.pricing.version, 'v1')
})

test('maturity: failed new-source persistence returns an error, not old-source prices or a silent missing state', async () => {
  const { store } = await seed()
  const faultyStore = { read: store.read, update: async () => { throw new Error('write denied') } }
  const refresher = createDynamicDataRefresher({ store: faultyStore, now: () => AT, fetchImpl: () => assert.fail('unreserved network') })
  const data = await refresher.refresh({ ...OPTIONS, pricingSnapshotEndpoint: B })
  assert.equal(data.pricing, null)
  assert.equal(data.status.pricing.error, 'storage-failed')
  assert.equal(data.status.pricing.lastGoodEndpoint, A)
})

test('maturity: completely unreadable storage still rejects instead of inventing a saved snapshot', async () => {
  const refresher = createDynamicDataRefresher({ store: { read: async () => { throw new Error('cannot read') }, update: () => assert.fail('write') },
    fetchImpl: () => assert.fail('fetch') })
  await assert.rejects(refresher.refresh(OPTIONS), /cannot read/u)
})

test('maturity: public browser projection masks cancelled and unrelated sources consistently with Host', async () => {
  const { data } = await seed()
  assert.deepEqual(browserView.projectDynamicData(data, { ...OPTIONS, pricingSnapshotEndpoint: B }),
    projectDynamicData(data, { ...OPTIONS, pricingSnapshotEndpoint: B }))
  assert.equal(projectDynamicData(data, { ...OPTIONS, pricingSnapshotEndpoint: B }).pricing, null)
  assert.equal(projectDynamicData(data, { enabled: false }).pricing, null)
  assert.equal(projectDynamicData(data, { ...OPTIONS, pricingSnapshotEndpoint: 'https://user:private@a.example.com/' }).pricing, null)
  assert.equal(publicDynamicEndpoint(A), A)
  for (const invalid of ['https://2130706433/', 'https://0x7f000001/', 'https://[::1]/', 'https://service.lan/']) {
    assert.throws(() => publicDynamicEndpoint(invalid))
  }
})

test('maturity: legacy credential URLs cannot leak through last-good or status endpoint metadata', async () => {
  const { data } = await seed()
  data.pricing.endpoint = 'https://user:private@a.example.com/pricing.json'
  data.status.pricing.endpoint = 'https://a.example.com/pricing.json?token=private'
  data.status.pricing.lastGoodEndpoint = 'http://localhost/private'
  data.status.pricing.error = 'private upstream message'
  const projected = projectDynamicData(data, { ...OPTIONS, pricingSnapshotEndpoint: B })
  assert.equal(projected.pricing, null)
  assert.equal(projected.status.pricing.lastGoodEndpoint, null)
  assert.ok(!JSON.stringify(dynamicDataSummary(data, { enabled: true, now: AT })).includes('private'))
  assert.ok(!JSON.stringify(projected).includes('private'))
})

test('maturity: injected timeouts are finite bounded integers and never increase production network duration', () => {
  for (const timeoutMs of [0, -1, 8001, 1.5, NaN, Infinity, '20']) {
    assert.throws(() => createDynamicDataRefresher({ store: memoryStore(), timeoutMs }), /invalid-refresh-timeout/u)
  }
})
