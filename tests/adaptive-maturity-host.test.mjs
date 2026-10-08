import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Isolated fake catalog, synthetic prices and fixed clock: no real model API,
// CLI, credentials or user DSH home are accessed.
const home = await mkdtemp(join(tmpdir(), 'router-maturity-host-'))
process.env.DSH_HOME = home
const host = await import('../.dsh-plugin/index.mjs')
after(async () => {
  assert.equal(dirname(resolve(home)), resolve(tmpdir()))
  await rm(home, { recursive: true, force: true })
})
const at = Date.UTC(2026, 9, 7, 8)
const options = { skipToolProbe: true, installedToolIds: [], runnableToolIds: [] }
const endpointA = 'https://prices.example.org/a.json'
const endpointB = 'https://prices.example.org/b.json'
const gate = () => {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}
function context() {
  return { calls: [], llm: {
    listProviders: () => ['synthetic'],
    listModels: async () => [{ id: 'model-v1' }],
    resolveModelInfo: async () => ({ id: 'model-v1' }),
    stream() { throw new Error('This fixture must not execute a model') },
  } }
}
function config() {
  return { dynamicDataEnabled: true, liveBenchEndpoint: '', pricingSnapshotEndpoint: endpointA,
    modelProfilesJson: JSON.stringify([{ provider: 'synthetic', model: 'model-v1', quality: 90 }]) }
}
async function reset() {
  await host.routerStateStore().update(state => {
    state.runs = []
    state.dynamicData = { liveBench: null, pricing: null, status: {}, revision: '' }
    state.archivedSpending = {}
  })
}
let activeWait = null
const syntheticPublicFetch = async url => {
  assert.equal(url, endpointA, 'unexpected public network access')
  if (activeWait) { activeWait.entered.resolve(); await activeWait.release.promise }
  return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => JSON.stringify({
    schemaVersion: 1, kind: 'pricing', version: 'synthetic-a', publishedAt: at,
    rows: [{ provider: 'synthetic', model: 'model-v1', input: 1, output: 2,
      currency: 'USD', unit: 'per-million-tokens', asOf: at,
      sourceUrl: 'https://docs.example.org/pricing' }],
  }) }
}
function publicFixture(t, wait = null) {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  Date.now = () => at
  // Host captures fetch when constructing its singleton refresher. Keep one
  // delegate identity and change only the test gate, not the function object.
  activeWait = wait
  globalThis.fetch = syntheticPublicFetch
  t.after(() => { activeWait = null; globalThis.fetch = originalFetch; Date.now = originalNow })
}

test('Host rechecks current source after an in-flight settings switch; old A is retained only on disk', async t => {
  await reset()
  const wait = { entered: gate(), release: gate() }
  publicFixture(t, wait)
  const settings = config()
  const planning = host.createRoutePlan(context(), '请写代码计算两个数字的和', settings, options)
  await wait.entered.promise
  settings.pricingSnapshotEndpoint = endpointB
  wait.release.resolve()
  const plan = await planning
  assert.equal(plan.candidates[0].inputPrice, null)
  assert.notEqual(plan.candidates[0].pricingSource, 'dynamic')
  assert.equal(plan.optimization.dataVersions.pricing, null)
  assert.equal((await host.routerStateStore().read()).dynamicData.pricing.endpoint, endpointA)
})

test('Host disabling public data during a request immediately excludes the late response from planning', async t => {
  await reset()
  const wait = { entered: gate(), release: gate() }
  publicFixture(t, wait)
  const settings = config()
  const planning = host.createRoutePlan(context(), '请写代码计算两个数字的和', settings, options)
  await wait.entered.promise
  settings.dynamicDataEnabled = false
  wait.release.resolve()
  const plan = await planning
  assert.equal(plan.candidates[0].inputPrice, null)
  assert.equal(plan.optimization.dataVersions.pricing, null)
})

test('unavailable ledger storage is explicit and does not turn unknown history into verified zero spending', async t => {
  await reset()
  const store = host.routerStateStore()
  const original = store.read
  store.read = async () => { throw new Error('Synthetic private storage diagnostic must not leak') }
  t.after(() => { store.read = original })
  const summary = await host.ledgerSummary({})
  assert.equal(summary.storageAvailable, false)
  assert.equal(summary.budget.historyVerified, false)
  assert.match(summary.storageNotice, /不能当作零花费/)
  assert.ok(!JSON.stringify(summary).includes('private storage diagnostic'))
  await assert.rejects(host.executeConfiguredAssignment(context(), '请写代码计算两个数字的和', {
    dailyBudgetUsd: 1,
    modelProfilesJson: JSON.stringify([{ provider: 'synthetic', model: 'model-v1', quality: 90,
      pricing: { input: 1, output: 2 } }]),
  }, options), /无法读取费用历史/)
})

test('reloading an unchanged empty feedback profile does not invalidate the generated recommendation', async t => {
  await reset()
  const originalNow = Date.now
  t.after(() => { Date.now = originalNow })
  Date.now = () => at
  const first = await host.ledgerSummary({})
  Date.now = () => at + 1
  const second = await host.ledgerSummary({})
  assert.equal(first.learning.revision, second.learning.revision)
  assert.equal(first.learning.evidenceRevision, second.learning.evidenceRevision)
})

test('corrupt recovery does not certify missing historical charges or allow a budget-limited paid call', async t => {
  await reset()
  publicFixture(t)
  await writeFile(host.routerStateStore().file, '{broken synthetic charge history')
  const summary = await host.ledgerSummary({})
  assert.equal(summary.storageAvailable, true, 'new records can be read after backup')
  assert.equal(summary.budget.historyVerified, false, 'historical totals are still unknown')
  assert.match(summary.storageNotice, /费用历史/)
  await assert.rejects(host.executeConfiguredAssignment(context(), '请写代码计算两个数字的和', {
    monthlyBudgetUsd: 1,
    modelProfilesJson: JSON.stringify([{ provider: 'synthetic', model: 'model-v1', quality: 90,
      pricing: { input: 1, output: 2 } }]),
  }, options), /无法读取费用历史/)
})

test('nested damaged fee history stays visible as incomplete and cannot pass a configured budget', async t => {
  await reset()
  publicFixture(t)
  await writeFile(host.routerStateStore().file, JSON.stringify({ version: 1,
    runs: [{ id: 'damaged', createdAt: at, task: 'Synthetic malformed record', packages: 'damaged' }],
    archivedSpending: { months: { '2026-10': { costUsd: 'damaged' } } },
  }))
  const summary = await host.ledgerSummary({})
  assert.equal(summary.budget.historyVerified, false)
  assert.match(summary.storageNotice, /不完整/)
  await assert.rejects(host.executeConfiguredAssignment(context(), '请写代码', { dailyBudgetUsd: 1 }, options), /无法读取费用历史/)
})
