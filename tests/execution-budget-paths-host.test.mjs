import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { buildToolRunRecord, budgetCheck, spending } from '../.dsh-plugin/shared/run-ledger.mjs'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { reservationSpending } from '../.dsh-plugin/shared/budget-reservations.mjs'
import { createPlanFromRoutes } from '../.dsh-plugin/shared/harness-plan.mjs'
import { createQuotaTracker } from '../.dsh-plugin/shared/subscription-billing.mjs'
import { healthCache } from '../.dsh-plugin/shared/tool-health.mjs'

// Exercise public Host entry points and real durable state. Streams and official
// runners are inert fixtures; accidentally reaching a vendor is a test failure.
const home = await mkdtemp(join(tmpdir(), 'router-budget-paths-host-'))
const previousHome = process.env.DSH_HOME
const previousFetch = globalThis.fetch
process.env.DSH_HOME = home
globalThis.fetch = async () => { throw new Error('Unexpected network in budget path fixture') }
const host = await import('../.dsh-plugin/index.mjs')
const store = host.routerStateStore()
const originalUpdate = store.update
after(async () => {
  store.update = originalUpdate
  globalThis.fetch = previousFetch
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  assert.equal(dirname(resolve(home)), resolve(tmpdir()))
  assert.ok(basename(home).startsWith('router-budget-paths-host-'))
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

const task = '分析代码中的问题，提出可核验的修复建议。'
const route = { provider: 'fixture', model: 'gpt-small-fixture', quality: 80,
  execution: 'api', billing: 'api-only', subscription: 'none', pricing: { input: 1, output: 2 } }
const stronger = { ...route, model: 'gpt-strong-fixture', quality: 99, pricing: { input: 10, output: 20 } }
const settings = extra => ({ dynamicDataEnabled: false, reviewMode: 'off', overBudgetAction: 'pause',
  modelProfilesJson: JSON.stringify([route, stronger]), ...extra })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} versus ${b}`)
const deferred = () => {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}
async function until(read, accepts) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const value = await read()
    if (accepts(value)) return value
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('Fixture did not reach the expected durable state')
}
async function disk() {
  const raw = JSON.parse(await readFile(store.file, 'utf8'))
  const independentlyRead = await createRouterState({ file: store.file }).read()
  assert.deepEqual(raw.budgetReservations, independentlyRead.budgetReservations)
  return independentlyRead
}
function context({ hold = () => false, answer = index => `receipt ${index + 1}`,
  usage = () => ({ inputTokens: 100, outputTokens: 20 }), release = deferred() } = {}) {
  const calls = []
  return { calls, release, sandbox: { confine() { throw new Error('No vendor CLI may run') } }, llm: {
    listProviders: () => [route.provider],
    listModels: async () => [route, stronger].map(item => ({ id: item.model })),
    resolveModelInfo: async (provider, model) => ({ id: model }),
    stream(request) {
      const index = calls.length
      calls.push(request)
      return (async function* () {
        if (hold(index)) await release.promise
        yield { type: 'text-delta', index: 0, text: answer(index) }
        yield { type: 'usage', usage: usage(index) }
        yield { type: 'finish', reason: { kind: request.signal?.aborted ? 'aborted' : 'stop' } }
      })()
    },
  } }
}
function plan(estimates = [0.1]) {
  const workPackages = estimates.map((estimatedCost, index) => ({ id: `step-${index + 1}`, name: `步骤 ${index + 1}`,
    objective: `完成步骤 ${index + 1}`, dependsOn: index ? [`step-${index}`] : [], type: 'code', purpose: 'execution',
    recommendedProvider: route.provider, recommendedModel: route.model, estimatedCost }))
  return { mode: 'team', preset: 'balanced', selected: route, availableRoutes: [route, stronger],
    team: { workPackages }, estimatedCost: estimates.reduce((sum, value) => sum + value, 0),
    costBreakdown: workPackages.map(item => ({ id: item.id, estimatedCost: item.estimatedCost })), optimization: {} }
}
function prepared(value = plan(), routes = [route, stronger]) {
  return { taskText: task, direct: false, plan: value, routes, preset: 'balanced',
    budget: { ...budgetCheck({ estimateUsd: value.estimatedCost }), action: 'pause' } }
}
function assignment(ctx, config, value = prepared()) {
  return host.executeConfiguredAssignment(ctx, task, config, { workspace: home, billing: false,
    installedToolIds: [], skipToolProbe: true, preparedAssignment: value })
}
function failFirstStartedWrite() {
  let injected = false
  store.update = change => originalUpdate(async state => {
    const result = await change(state)
    if (!injected && Object.values(state.budgetReservations ?? {}).some(hold => hold.packages.some(item => item.started))) {
      injected = true
      throw new Error('fixture dispatch checkpoint failed')
    }
    return result
  })
  return () => injected
}

test('independent consultation reserves before dispatch and releases after its receipt is durable', async t => {
  const ctx = context({ hold: () => true })
  const running = host.executeBudgetedConsult(ctx, route, task, settings({ dailyBudgetUsd: 1 }))
  t.after(async () => { ctx.release.resolve(); await Promise.allSettled([running]) })
  await until(() => ctx.calls.length, value => value === 1)
  const during = await disk()
  assert.equal(during.runs.length, 1)
  assert.equal(during.runs[0].status, 'running')
  assert.equal(during.runs[0].packages[0].ran, false)
  const hold = Object.values(during.budgetReservations)[0]
  assert.equal(hold.packages[0].id, 'direct')
  assert.equal(hold.packages[0].started, true)
  assert.ok(reservationSpending(during).today > 0)
  ctx.release.resolve()
  const result = await running
  const final = await disk()
  assert.equal(final.runs[0].id, result.runId)
  assert.equal(final.runs[0].packages[0].answer, 'receipt 1')
  assert.deepEqual(final.budgetReservations, {})
  near(spending(final.runs).today, 0.00014)
})

test('independent consultation never calls the model when its dispatch checkpoint fails', async t => {
  const injected = failFirstStartedWrite()
  t.after(() => { store.update = originalUpdate })
  const ctx = context()
  await assert.rejects(host.executeBudgetedConsult(ctx, route, task, settings({ dailyBudgetUsd: 1 })), /检查点保存失败/)
  assert.equal(injected(), true)
  assert.equal(ctx.calls.length, 0)
  const saved = await disk()
  assert.equal(saved.runs[0].status, 'interrupted')
  assert.equal(Object.values(saved.budgetReservations)[0].status, 'interrupted')
})

function officialPlan(provider = route.provider) {
  const value = plan([0.4])
  value.team.workPackages[0].recommendedProvider = provider
  return { status: 'planned', mode: 'read-only', executionEnvironment: 'harness', workspace: home,
    taskText: task, plan: value, routes: [{ ...route, provider }], installed: ['codex'], cliModels: {} }
}
function cliReceipt(id = 'step-1') {
  return { id, status: 'succeeded', provider: route.provider, recommendedModel: route.model,
    toolId: 'codex', finalText: 'inert official receipt', reportedCostUsd: 0.02 }
}
test('official team admission rechecks concurrent reservations before calling the runner', async t => {
  const previousHealth = healthCache.report()
  healthCache.remember({ checkedAt: Date.now(), tools: [{ id: 'codex', installed: true,
    login: { state: 'logged-in', billing: 'api-key', accountLogin: false } }] })
  t.after(() => healthCache.remember(previousHealth ?? { checkedAt: Date.now(), tools: [] }))
  const release = deferred(), calls = [], completed = []
  const runTeam = async hooks => {
    await hooks.onWorkspace({ workspace: home, baseCommit: 'fixture-base' })
    await hooks.onCheckpointStart({ id: 'step-1', provider: route.provider, model: route.model, channel: 'official-cli', toolId: 'codex' })
    calls.push(hooks)
    await release.promise
    const result = cliReceipt()
    await hooks.onCheckpointResult(result)
    return { status: 'completed', workspace: home, results: [result] }
  }
  const ctx = context(), config = settings({ dailyBudgetUsd: 0.5 })
  const pending = [1, 2].map(() => host.executeOfficialTeamPlan(ctx, config, officialPlan('openai'), { runTeam }))
    .map(call => call.then(value => { completed.push(value); return value }))
  t.after(async () => { release.resolve(); await Promise.allSettled(pending) })
  await until(() => ({ calls, completed }), value => value.calls.length === 1 && value.completed.length === 1)
  assert.equal(completed[0].status, 'paused-budget')
  const during = await disk()
  assert.equal(during.runs.length, 1)
  near(reservationSpending(during).today, 0.4)
  release.resolve()
  const results = await Promise.all(pending)
  assert.equal(results.filter(value => value.status === 'completed').length, 1)
  const final = await disk()
  assert.deepEqual(final.budgetReservations, {})
  assert.equal(final.runs[0].packages[0].answer, 'inert official receipt')
})

test('official team stops before paid runner work if the mandatory start write fails', async t => {
  const injected = failFirstStartedWrite()
  t.after(() => { store.update = originalUpdate })
  let paid = 0
  const runTeam = async hooks => {
    await hooks.onCheckpointStart({ id: 'step-1', channel: 'official-cli', toolId: 'codex' })
    paid++
    return { status: 'completed', results: [cliReceipt()] }
  }
  await assert.rejects(host.executeOfficialTeamPlan(context(), settings({ dailyBudgetUsd: 1 }), officialPlan(), { runTeam }), /检查点保存失败/)
  assert.equal(injected(), true)
  assert.equal(paid, 0)
  assert.equal(Object.values((await disk()).budgetReservations)[0].status, 'interrupted')
})

async function toolRetryFixture() {
  const run = buildToolRunRecord({ id: 'original-tool-attempt', createdAt: Date.now(), finishedAt: Date.now(),
    task, toolId: 'codex', provider: route.provider, model: route.model, mode: 'read-only', workspace: home,
    result: { status: 'failed', notStarted: true }, estimatedCost: 0.4 })
  await store.appendRun(run)
  const planned = { toolId: 'codex', tool: { label: 'Codex' }, taskText: task, mode: 'read-only',
    modelId: route.model, provider: route.provider, model: route.model, cliModel: null, routes: [route],
    estimate: 0.4, budget: { ...budgetCheck({ estimateUsd: 0.4 }), action: 'pause' } }
  return { run, planned }
}
function toolRetry(ctx, config, fixture, runTask) {
  return host.rerunRecordedStep(ctx, config, { runId: fixture.run.id, packageId: 'direct', workspace: home,
    planToolRun: async () => structuredClone(fixture.planned), runTask })
}
test('single official tool reruns share the durable budget boundary and link one settled attempt', async t => {
  const fixture = await toolRetryFixture(), release = deferred(), completed = []
  let paid = 0
  const runTask = async hooks => {
    await hooks.onWorkspace({ workspace: home })
    await hooks.onCheckpointStart({ id: 'direct', channel: 'official-cli', toolId: 'codex' })
    paid++
    await release.promise
    const result = { ...cliReceipt('direct'), finalText: 'single tool receipt' }
    await hooks.onCheckpointResult(result)
    return result
  }
  const pending = [1, 2].map(() => toolRetry(context(), settings({ dailyBudgetUsd: 0.5 }), fixture, runTask))
    .map(call => call.then(value => { completed.push(value); return value }))
  t.after(async () => { release.resolve(); await Promise.allSettled(pending) })
  await until(() => ({ paid, completed }), value => value.paid === 1 && value.completed.length === 1)
  assert.equal(completed[0].execution.raw.status, 'paused-budget')
  const during = await disk()
  assert.equal(during.runs.length, 2, 'one old attempt plus one admitted retry')
  near(reservationSpending(during).today, 0.4)
  release.resolve()
  const results = await Promise.all(pending)
  const finished = results.find(value => value.newRunId)
  assert.ok(finished.newRunId)
  const final = await disk()
  assert.deepEqual(final.budgetReservations, {})
  const retry = final.runs.find(item => item.id === finished.newRunId)
  assert.equal(retry.rerunOf, fixture.run.id)
  assert.equal(retry.packages[0].answer, 'single tool receipt')
})

test('single official tool never reaches paid work if its dispatch checkpoint fails', async t => {
  const fixture = await toolRetryFixture(), injected = failFirstStartedWrite()
  t.after(() => { store.update = originalUpdate })
  let paid = 0
  const runTask = async hooks => {
    await hooks.onCheckpointStart({ id: 'direct', channel: 'official-cli', toolId: 'codex' })
    paid++
    return cliReceipt('direct')
  }
  await assert.rejects(toolRetry(context(), settings({ dailyBudgetUsd: 1 }), fixture, runTask), /检查点保存失败/)
  assert.equal(injected(), true)
  assert.equal(paid, 0)
  assert.equal(Object.values((await disk()).budgetReservations)[0].status, 'interrupted')
})

test('optional reviewer is skipped when the completed receipt plus other holds exhaust its incremental budget', async t => {
  const other = context({ hold: () => true })
  const otherRun = assignment(other, settings({ dailyBudgetUsd: 0.5 }), prepared(plan([0.49])))
  t.after(async () => { other.release.resolve(); await Promise.allSettled([otherRun]) })
  await until(() => other.calls.length, value => value === 1)
  const reviewer = { ...stronger, pricing: { input: 10_000, output: 20_000 } }
  const ctx = context()
  const result = await assignment(ctx, settings({ dailyBudgetUsd: 0.5, reviewMode: 'always' }),
    prepared(plan([0.001]), [route, reviewer]))
  assert.equal(ctx.calls.length, 1, 'the extra reviewer must not consume an unreserved paid call')
  assert.equal(result.run.reviews.length, 0)
  assert.match(result.run.packages[0].review.summary, /预算.*跳过/)
  const during = await disk()
  near(reservationSpending(during).today, 0.49)
  near(spending(during.runs).today, 0.00014)
  other.release.resolve()
  await otherRun
})

test('an in-flight quality upgrade durably retains the first cost and the second unknown attempt', async t => {
  const ctx = context({ hold: index => index === 1, answer: index => index ? '{"answer":"verified"}' : '{}' })
  const config = settings({ dailyBudgetUsd: 2, qualityEscalationEnabled: true,
    qualityGateJson: JSON.stringify({ kind: 'json-object', requiredKeys: ['answer'] }) })
  const running = assignment(ctx, config, prepared(plan([0.1])))
  t.after(async () => { ctx.release.resolve(); await Promise.allSettled([running]) })
  await until(() => ctx.calls.length, value => value === 2)
  const raw = JSON.parse(await readFile(store.file, 'utf8'))
  const item = raw.runs[0].packages[0]
  assert.equal(item.qualityAttempts.length, 2)
  assert.equal(item.costUsd, null)
  near(item.knownCostUsd, 0.00014)
  assert.equal(item.unknownAttemptCount, 1)
  assert.equal(item.inFlight, true)
  const hold = Object.values(raw.budgetReservations)[0]
  assert.equal(hold.packages[0].id, 'step-1')
  assert.ok(hold.packages[0].estimatedCostUsd > 0)
  const upgradeTask = ctx.calls[1].messages[0].content[0].text.split('\n\nTask:\n')[1]
  const upgradeEstimate = createPlanFromRoutes(upgradeTask, [stronger], {
    mode: 'direct', directProvider: stronger.provider, directModel: stronger.model,
  }).estimatedCost
  near(hold.packages[0].estimatedCostUsd, upgradeEstimate)
  assert.equal(hold.packages[0].started, true)
  ctx.release.resolve()
  const result = await running
  assert.equal(result.execution.packages[0].ok, true)
  const final = await disk()
  assert.deepEqual(final.budgetReservations, {})
  near(spending(final.runs).today, 0.00154)
})

for (const apiPrice of ['expensive', 'unknown']) {
  test(`a subscription quota fallback cannot start an ${apiPrice} API route against a finite budget`, async () => {
    const calls = []
    const subscription = { provider: 'glm-coding-plan', model: 'gpt-plan-fixture', subscription: 'plan-key',
      apiRoute: { provider: 'zhipu', model: 'gpt-api-fixture' }, pricing: { input: 0, output: 0 } }
    const api = { provider: 'zhipu', model: 'gpt-api-fixture', quality: 95,
      ...(apiPrice === 'expensive' ? { pricing: { input: 100_000, output: 200_000 } } : {}) }
    const ctx = { sandbox: { confine() { throw new Error('No vendor CLI may run') } }, llm: {
      listProviders: () => [subscription.provider, api.provider],
      listModels: async provider => [{ id: provider === subscription.provider ? subscription.model : api.model }],
      resolveModelInfo: async (provider, model) => ({ provider, id: model }),
      stream(request) {
        calls.push(request.provider)
        return (async function* () {
          if (request.provider === subscription.provider) throw new Error('429 {"error":{"code":"1308","message":"Usage limit reached for 5 hour"}}')
          assert.fail('The unconfirmed paid API route must never start')
        })()
      },
    } }
    const result = await host.executeConfiguredAssignment(ctx, task, settings({ dailyBudgetUsd: 0.001,
      modelProfilesJson: JSON.stringify([subscription, api]) }), { workspace: home, skipToolProbe: true,
      installedToolIds: [], runnableToolIds: [], provider: subscription.provider, model: subscription.model,
      billing: { quota: createQuotaTracker() } })
    assert.deepEqual(calls, [subscription.provider])
    assert.equal(result.execution.packages[0].ok, false)
    assert.equal(result.execution.packages[0].notStarted, true)
    assert.match(result.execution.packages[0].error, /实际 API 路线预算未确认/)
    const saved = await disk()
    assert.deepEqual(saved.budgetReservations, {})
    assert.equal(saved.runs.length, 1)
    assert.equal(saved.runs[0].packages[0].ran, false)
    assert.equal(spending(saved.runs).today, 0)
    assert.equal(spending(saved.runs).unknownToday, 0)
  })
}

test('a larger actual first receipt pauses downstream dispatch and releases only the unstarted holds', async () => {
  const ctx = context({ usage: () => ({ inputTokens: 2_000_000, outputTokens: 0 }) })
  let failure
  await assert.rejects(assignment(ctx, settings({ dailyBudgetUsd: 1 }), prepared(plan([0.4, 0.3]))), error => {
    failure = error
    return error.cause?.code === 'ROUTER_BUDGET_CHANGED'
  })
  assert.equal(ctx.calls.length, 1)
  const saved = await disk()
  assert.equal(saved.runs.length, 1)
  const run = saved.runs[0]
  assert.equal(run.id, failure.runId)
  assert.equal(run.status, 'paused-budget')
  assert.equal(run.packages[0].answer, 'receipt 1')
  near(run.packages[0].costUsd, 2)
  assert.equal(run.packages[1].ran, false)
  assert.deepEqual(saved.budgetReservations, {})
  near(spending(saved.runs).today, 2)
  assert.equal(spending(saved.runs).unknownToday, 0)
})
