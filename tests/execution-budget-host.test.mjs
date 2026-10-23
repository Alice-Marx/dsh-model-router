import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { buildRunRecord, budgetCheck, sanitizeArchivedSpending, spending } from '../.dsh-plugin/shared/run-ledger.mjs'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { reservationSpending } from '../.dsh-plugin/shared/budget-reservations.mjs'

// Real Host execution and on-disk transactions; every paid call is an inert
// stream fixture. A network or vendor CLI invocation is always a test failure.
const home = await mkdtemp(join(tmpdir(), 'router-execution-budget-host-'))
const previousHome = process.env.DSH_HOME
const previousFetch = globalThis.fetch
process.env.DSH_HOME = home
globalThis.fetch = async () => { throw new Error('Unexpected network in execution budget fixture') }
const host = await import('../.dsh-plugin/index.mjs')
const store = host.routerStateStore()
const originalUpdate = store.update

after(async () => {
  store.update = originalUpdate
  globalThis.fetch = previousFetch
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  assert.equal(dirname(resolve(home)), resolve(tmpdir()))
  assert.ok(basename(home).startsWith('router-execution-budget-host-'))
  await rm(home, { recursive: true, force: true })
})
beforeEach(async () => {
  store.update = originalUpdate
  await store.update(state => {
    state.runs = []; state.archivedSpending = {}; state.budgetReservations = {}
    state.quota = {}; state.authFailures = {}; state.historyIncomplete = false
    state.dynamicData = { liveBench: null, pricing: null, status: {}, revision: '' }
  })
})

const task = '分析代码，提出修复方案，再验证方案。'
const provider = 'fixture'
const model = 'gpt-budget-fixture'
const route = { provider, model, quality: 95, execution: 'api', billing: 'api-only', subscription: 'none',
  pricing: { input: 1, output: 2 } }
const config = extra => ({ dynamicDataEnabled: false, reviewMode: 'off', overBudgetAction: 'pause',
  dailyBudgetUsd: 1, modelProfilesJson: JSON.stringify([route]), ...extra })
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`)
const costPerCall = 0.00014 // 100 input / 20 output tokens at the fixture's frozen rates.
const deferred = () => {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}
async function until(read, accepts, message = 'Fixture did not reach the expected execution state') {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const value = await read()
    if (accepts(value)) return value
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail(message)
}
function plan(estimates = [0.4]) {
  const workPackages = estimates.map((estimatedCost, index) => ({ id: `step-${index + 1}`, name: `步骤 ${index + 1}`,
    objective: `完成步骤 ${index + 1}`, type: 'code', purpose: 'execution',
    dependsOn: index ? [`step-${index}`] : [], recommendedProvider: provider, recommendedModel: model, estimatedCost }))
  return { mode: 'team', preset: 'balanced', selected: route, availableRoutes: [route],
    team: { workPackages }, estimatedCost: estimates.reduce((sum, value) => sum + value, 0),
    costBreakdown: workPackages.map(item => ({ id: item.id, estimatedCost: item.estimatedCost })), optimization: {} }
}
function prepared(estimates = [0.4], limits = {}) {
  const value = plan(estimates)
  return { taskText: task, direct: false, plan: value, routes: [route], preset: 'balanced',
    budget: { ...budgetCheck({ estimateUsd: value.estimatedCost, ...limits }), action: 'pause' } }
}
function context({ hold = () => false, failure = () => false, release = deferred() } = {}) {
  const calls = []
  return { calls, release, sandbox: { confine() { throw new Error('No vendor CLI may run') } }, llm: {
    listProviders: () => [provider], listModels: async () => [{ id: model }], resolveModelInfo: async () => ({ id: model }),
    stream(request) {
      const index = calls.length
      calls.push(request)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: `offline receipt ${index + 1}` }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
        if (hold(index)) await release.promise
        if (failure(index)) throw new Error('fixture API failed after reporting usage')
        yield { type: 'finish', reason: { kind: request.signal?.aborted ? 'aborted' : 'stop' } }
      })()
    },
  } }
}
function execute(ctx, settings, assignment) {
  return host.executeConfiguredAssignment(ctx, task, settings, { workspace: home, billing: false,
    installedToolIds: [], skipToolProbe: true, preparedAssignment: assignment })
}
async function fromDisk() {
  // Independent state reader plus the raw file: neither assertion can be
  // satisfied merely by a mutable Host cache or the eventual final save.
  const saved = await createRouterState({ file: store.file }).read()
  const raw = JSON.parse(await readFile(store.file, 'utf8'))
  assert.deepEqual(raw.budgetReservations, saved.budgetReservations)
  return saved
}

test('two concurrent stale plans cannot both start paid work against the same remaining budget', async t => {
  const ctx = context({ hold: () => true })
  const completed = []
  const settings = config({ dailyBudgetUsd: 0.5 })
  const assignment = prepared([0.4])
  // Both callers approved against the same empty-ledger preview. The durable
  // admission transaction, rather than that preview, must decide the race.
  const calls = [execute(ctx, settings, assignment), execute(ctx, settings, assignment)]
  const pending = calls.map(call => call.then(value => { completed.push(value); return value }))
  t.after(async () => { ctx.release.resolve(); await Promise.allSettled(pending) })
  await until(() => ({ paid: ctx.calls.length, completed }), value => value.paid === 1 && value.completed.length === 1)
  assert.equal(completed[0].paused, true)
  assert.ok(completed[0].budget.exceeded)
  const during = await fromDisk()
  assert.equal(Object.keys(during.budgetReservations).length, 1)
  close(reservationSpending(during).today, 0.4)
  assert.equal(during.runs.length, 1)
  assert.equal(ctx.calls.length, 1)
  ctx.release.resolve()
  const results = await Promise.all(pending)
  assert.equal(results.filter(value => value.execution !== null).length, 1)
  const final = await fromDisk()
  assert.equal(final.runs.length, 1)
  assert.deepEqual(final.budgetReservations, {})
  close(spending(final.runs, undefined, final.archivedSpending).today, costPerCall)
})

test('two concurrent plans that fit the budget both run and settle their own holds', async t => {
  const ctx = context({ hold: () => true })
  const pending = [execute(ctx, config(), prepared([0.4])), execute(ctx, config(), prepared([0.4]))]
  t.after(async () => { ctx.release.resolve(); await Promise.allSettled(pending) })
  await until(() => ctx.calls.length, value => value === 2)
  const during = await fromDisk()
  assert.equal(Object.keys(during.budgetReservations).length, 2)
  close(reservationSpending(during).today, 0.8)
  ctx.release.resolve()
  const results = await Promise.all(pending)
  assert.ok(results.every(value => value.stored === true && value.execution.status === 'completed'))
  assert.equal(new Set(results.map(value => value.runId)).size, 2)
  const final = await fromDisk()
  assert.equal(final.runs.length, 2)
  assert.deepEqual(final.budgetReservations, {})
  close(spending(final.runs, undefined, final.archivedSpending).today, costPerCall * 2)
})

test('a completed package is durable and its estimate is released while the next package is still held', async t => {
  const ctx = context({ hold: index => index === 1 })
  const running = execute(ctx, config({ dailyBudgetUsd: 2 }), prepared([0.4, 0.3]))
  t.after(async () => { ctx.release.resolve(); await Promise.allSettled([running]) })
  await until(() => ctx.calls.length, value => value === 2)
  const saved = await fromDisk()
  assert.equal(saved.runs.length, 1)
  const run = saved.runs[0]
  assert.equal(run.status, 'running')
  assert.equal(run.finishedAt, null)
  assert.equal(run.packages[0].answer, 'offline receipt 1')
  assert.equal(run.packages[0].ok, true)
  assert.ok(['succeeded', 'fallback'].includes(run.packages[0].status))
  assert.equal(run.packages[0].usage.inputTokens, 100)
  close(run.packages[0].costUsd, costPerCall)
  assert.equal(run.packages[1].status, 'running')
  const hold = Object.values(saved.budgetReservations)[0]
  assert.equal(hold.runId, run.id)
  assert.deepEqual(hold.completedIds, ['step-1'])
  assert.deepEqual(hold.packages.map(item => item.id), ['step-2'])
  close(reservationSpending(saved).today, 0.3)
  close(spending(saved.runs, undefined, saved.archivedSpending).today, costPerCall)
  ctx.release.resolve()
  const result = await running
  const final = await fromDisk()
  assert.equal(final.runs.length, 1)
  assert.equal(final.runs[0].id, result.runId)
  assert.ok(final.runs[0].packages.every(item => item.ok))
  assert.deepEqual(final.budgetReservations, {})
  close(spending(final.runs, undefined, final.archivedSpending).today, costPerCall * 2)
})

test('failure to persist the dispatch checkpoint prevents even the first paid call', async t => {
  let injected = false
  store.update = change => originalUpdate(async state => {
    const result = await change(state)
    if (!injected && Object.values(state.budgetReservations ?? {}).some(entry => entry.packages.some(item => item.started))) {
      injected = true
      throw new Error('fixture dispatch checkpoint write failed')
    }
    return result
  })
  t.after(() => { store.update = originalUpdate })
  const ctx = context()
  await assert.rejects(execute(ctx, config(), prepared([0.4, 0.3])), /检查点保存失败/)
  assert.equal(injected, true)
  assert.equal(ctx.calls.length, 0)
  const saved = await fromDisk()
  assert.equal(saved.runs.length, 1)
  assert.equal(saved.runs[0].status, 'interrupted')
  assert.equal(Object.values(saved.budgetReservations)[0].status, 'interrupted')
})

test('failure to persist a paid receipt stops downstream dispatch and retains the receipt without duplicate runs', async t => {
  let injected = false
  store.update = change => originalUpdate(async state => {
    const result = await change(state)
    if (!injected && state.runs.some(run => run.packages?.some(item => item.answer === 'offline receipt 1'))) {
      injected = true
      throw new Error('fixture receipt checkpoint write failed')
    }
    return result
  })
  t.after(() => { store.update = originalUpdate })
  const ctx = context()
  await assert.rejects(execute(ctx, config(), prepared([0.4, 0.3])), /检查点保存失败/)
  assert.equal(injected, true)
  assert.equal(ctx.calls.length, 1)
  const saved = await fromDisk()
  assert.equal(saved.runs.length, 1)
  assert.equal(saved.runs[0].status, 'interrupted')
  assert.equal(saved.runs[0].packages[0].answer, 'offline receipt 1')
  close(saved.runs[0].packages[0].costUsd, costPerCall)
  assert.equal(saved.runs[0].packages[1].ran, false)
  assert.equal(Object.values(saved.budgetReservations)[0].status, 'interrupted')
  close(spending(saved.runs, undefined, saved.archivedSpending).today, costPerCall)
})

test('retry checkpoints and final settlement archive the replaced attempt exactly once', async t => {
  const value = plan([0.1, 0.1, 0.1])
  const run = buildRunRecord({ id: 'prior-cost-run', task, workspace: home, createdAt: Date.now(), finishedAt: Date.now(),
    plan: value, execution: { status: 'partial', packages: [
      { id: 'step-1', provider, model, channel: 'harness-llm', billing: 'api', ok: true, answer: 'kept upstream', reportedCostUsd: 0.2 },
      { id: 'step-2', provider, model, channel: 'harness-llm', billing: 'api', ok: false, error: 'old failure', reportedCostUsd: 0.3 },
      { id: 'step-3', provider, model, channel: 'harness-llm', billing: 'api', ok: false, blocked: true, error: 'blocked by step-2' },
    ] } })
  await store.appendRun(run)
  const ctx = context({ hold: index => index === 1 })
  const running = host.rerunRecordedStep(ctx, config({ dailyBudgetUsd: 2 }), {
    runId: run.id, packageId: 'step-2', workspace: home, billing: false, installedToolIds: [], skipToolProbe: true,
  })
  t.after(async () => { ctx.release.resolve(); await Promise.allSettled([running]) })
  await until(() => ctx.calls.length, value => value === 2)
  const during = await fromDisk()
  assert.equal(during.runs.length, 1)
  assert.equal(during.runs[0].id, run.id)
  assert.equal(during.runs[0].packages[0].answer, 'kept upstream')
  assert.equal(during.runs[0].packages[1].answer, 'offline receipt 1', 'the new paid retry receipt is saved before its downstream finishes')
  const archivedDuring = Object.values(sanitizeArchivedSpending(during.runs[0].priorAttemptSpending).months)
    .reduce((sum, period) => sum + period.costUsd, 0)
  close(archivedDuring, 0.3)
  close(spending(during.runs, undefined, during.archivedSpending).today, 0.5 + costPerCall)
  ctx.release.resolve()
  const result = await running
  assert.equal(result.run.id, run.id)
  const final = await fromDisk()
  assert.equal(final.runs.length, 1)
  assert.equal(final.runs[0].packages[0].answer, 'kept upstream')
  const archived = Object.values(sanitizeArchivedSpending(final.runs[0].priorAttemptSpending).months)
    .reduce((sum, period) => sum + period.costUsd, 0)
  close(archived, 0.3)
  close(spending(final.runs, undefined, final.archivedSpending).today, 0.5 + costPerCall * 2)
  assert.deepEqual(final.budgetReservations, {})
})
