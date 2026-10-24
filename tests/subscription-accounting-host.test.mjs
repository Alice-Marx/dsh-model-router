import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { budgetCheck, spending } from '../.dsh-plugin/shared/run-ledger.mjs'
import { createBudgetReservations, reservationSpending } from '../.dsh-plugin/shared/budget-reservations.mjs'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { createQuotaTracker } from '../.dsh-plugin/shared/subscription-billing.mjs'
import { subscriptionUsage } from '../.dsh-plugin/shared/subscription-usage.mjs'
import { healthCache } from '../.dsh-plugin/shared/tool-health.mjs'

// These are synthetic routes, tokens and prices. No real model, CLI, bill,
// credential, installation or network request is used by the Host fixtures.
const home = await mkdtemp(join(tmpdir(), 'router-sub-accounting-host-'))
const previousHome = process.env.DSH_HOME, previousFetch = globalThis.fetch
const keyNames = ['OPENAI_API_KEY', 'CODEX_API_KEY']
const originalKeys = new Map(keyNames.map(key => [key, process.env[key]]))
process.env.DSH_HOME = home
globalThis.fetch = async () => { throw new Error('Unexpected network in subscription accounting fixture') }
const host = await import('../.dsh-plugin/index.mjs')
const store = host.routerStateStore()
const subscription = { provider: 'fixture-plan', model: 'gpt-plan', subscription: 'plan-key',
  apiRoute: { provider: 'fixture-api', model: 'gpt-api' } }
const api = { provider: 'fixture-api', model: 'gpt-api', execution: 'api', pricing: { input: 1, output: 2 } }
const subUsage = { inputTokens: 30, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 2 }
const apiUsage = { inputTokens: 100, outputTokens: 20 }
const task = '分析离线测试中的问题并给出结果。'
const settings = (routes = [subscription, api], extra = {}) => ({ dynamicDataEnabled: false, reviewMode: 'off',
  overBudgetAction: 'pause', dailyBudgetUsd: 1, modelProfilesJson: JSON.stringify(routes), ...extra })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} should equal ${b}`)

after(async () => {
  globalThis.fetch = previousFetch
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  for (const [key, value] of originalKeys) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  assert.equal(dirname(resolve(home)), resolve(tmpdir()))
  assert.ok(basename(home).startsWith('router-sub-accounting-host-'))
  await rm(home, { recursive: true, force: true })
})
beforeEach(async () => {
  for (const key of keyNames) delete process.env[key]
  const health = { checkedAt: Date.now(), tools: [{ id: 'codex', installed: true,
    login: { state: 'logged-in', billing: 'subscription', accountLogin: true } }] }
  healthCache.remember(health)
  await store.update(state => {
    state.runs = []; state.archivedSpending = {}; state.archivedSubscriptionUsage = {}; state.budgetReservations = {}
    state.quota = {}; state.authFailures = {}; state.historyIncomplete = false; state.subscriptionUsageIncomplete = false
    state.health = health; state.dynamicData = { liveBench: null, pricing: null, status: {}, revision: '' }
  })
})
async function disk() {
  const raw = JSON.parse(await readFile(store.file, 'utf8'))
  const fresh = await createRouterState({ file: store.file }).read()
  assert.deepEqual(raw.budgetReservations, fresh.budgetReservations)
  return fresh
}
const quantities = saved => subscriptionUsage(saved.runs, Date.now(), saved.archivedSubscriptionUsage).today
function prepared(routes = [subscription, api], selected = routes[0], estimate = null) {
  return { taskText: task, direct: true, routes, preset: 'balanced',
    plan: { mode: 'single', routingBypassed: true, selected, directRoute: selected, availableRoutes: routes,
      estimatedCost: estimate, costBreakdown: [{ id: 'direct', estimatedCost: estimate }], optimization: {} },
    budget: { ...budgetCheck({ estimateUsd: estimate }), action: 'pause' } }
}
function context({ routes = [subscription, api], failSubscription = false, holdSubscription = null, onApi = null } = {}) {
  const calls = []
  return { calls, sandbox: { confine() { throw new Error('No vendor CLI may run in this fixture') } }, llm: {
    listProviders: () => [...new Set(routes.map(route => route.provider))],
    listModels: async provider => routes.filter(route => route.provider === provider).map(route => ({ id: route.model })),
    resolveModelInfo: async (provider, model) => ({ provider, id: model }),
    stream(request) {
      calls.push(request)
      return (async function* () {
        const subscribed = request.provider === subscription.provider
        if (subscribed && holdSubscription) await holdSubscription.promise
        if (!subscribed && onApi) await onApi(request)
        yield { type: 'text-delta', index: 0, text: subscribed ? 'subscription receipt' : 'API receipt' }
        yield { type: 'usage', usage: subscribed ? subUsage : apiUsage }
        yield { type: 'finish', reason: subscribed && failSubscription
          ? { kind: 'error', failure: { message: '429 quota exceeded' } } : { kind: 'stop' } }
      })()
    },
  } }
}
function execute(ctx, config = settings(), plan = prepared(), extra = {}) {
  return host.executeConfiguredAssignment(ctx, task, config, { workspace: home, installedToolIds: [],
    skipToolProbe: true, preparedAssignment: plan, billing: { quota: createQuotaTracker() }, ...extra })
}
async function until(read, check) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const value = await read()
    if (check(value)) return value
    await new Promise(done => setTimeout(done, 5))
  }
  assert.fail('Fixture did not reach its expected durable state')
}
async function apiHistory(costUsd) {
  await store.appendRun({ id: 'old-api', createdAt: Date.now(), packages: [
    { id: 'old', ran: true, billing: 'api', costUsd, finishedAt: Date.now() },
  ] })
}

for (const prior of ['full', 'unknown']) {
  test(`a subscription with no prices runs despite ${prior} API history and reserves no API dollars`, async t => {
    await apiHistory(prior === 'full' ? 1 : null)
    const held = deferred(), ctx = context({ holdSubscription: held })
    const pending = execute(ctx)
    t.after(async () => { held.resolve(); await Promise.allSettled([pending]) })
    await until(() => ctx.calls.length, count => count === 1)
    const during = await disk()
    const hold = Object.values(during.budgetReservations)[0].packages[0]
    assert.equal(hold.billing, 'subscription')
    assert.equal(hold.estimatedCostUsd, 0)
    assert.equal(reservationSpending(during).today, 0)
    assert.equal(reservationSpending(during).unknownToday, 0)
    held.resolve()
    const result = await pending
    assert.equal(result.paused, undefined)
    assert.equal(result.run.packages[0].billing, 'subscription')
    assert.equal(result.run.packages[0].costUsd, null)
    assert.deepEqual(result.run.packages[0].usage, subUsage)
    const saved = await disk()
    assert.equal(quantities(saved).calls, 1)
    assert.equal(quantities(saved).inputTokens, 30)
    assert.equal(quantities(saved).outputTokens, 5)
    assert.equal(quantities(saved).unknownUsageCalls, 0)
    near(spending(saved.runs).today, prior === 'full' ? 1 : 0)
    assert.equal(spending(saved.runs).unknownToday, prior === 'unknown' ? 1 : 0)
    assert.deepEqual(saved.budgetReservations, {})
  })
}

test('an over-budget fallback keeps durable subscription usage and makes zero API calls', async () => {
  const expensive = { ...api, pricing: { input: 100_000, output: 200_000 } }
  const routes = [subscription, expensive], ctx = context({ routes, failSubscription: true })
  const result = await execute(ctx, settings(routes, { dailyBudgetUsd: 0.001 }), prepared(routes))
  assert.deepEqual(ctx.calls.map(call => call.provider), [subscription.provider])
  assert.equal(result.execution.packages[0].notStarted, true)
  assert.match(result.execution.packages[0].error, /实际 API 路线预算未确认/)
  const saved = await disk()
  assert.equal(quantities(saved).calls, 1)
  assert.equal(quantities(saved).inputTokens, 30)
  assert.equal(quantities(saved).unknownUsageCalls, 0)
  assert.equal(spending(saved.runs).today, 0)
  assert.equal(spending(saved.runs).unknownToday, 0)
  assert.deepEqual(saved.budgetReservations, {})
})

test('an admitted fallback saves its subscription receipt before API dispatch and charges only API usage', async () => {
  const ctx = context({ failSubscription: true, onApi: async () => {
    const saved = await disk()
    assert.equal(quantities(saved).calls, 1)
    assert.equal(quantities(saved).inputTokens, 30)
    const item = saved.runs[0].packages[0]
    assert.equal(item.billing, 'api')
    assert.equal(item.subscriptionAttempts.length, 1)
    assert.equal(item.subscriptionAttempts[0].usage.outputTokens, 5)
    const held = Object.values(saved.budgetReservations)[0].packages[0]
    assert.equal(held.billing, 'api')
    assert.ok(held.estimatedCostUsd > 0)
  } })
  const result = await execute(ctx)
  assert.deepEqual(ctx.calls.map(call => call.provider), [subscription.provider, api.provider])
  assert.equal(result.run.packages[0].billing, 'api')
  assert.equal(result.run.packages[0].ok, true, result.run.packages[0].error)
  const saved = await disk()
  near(spending(saved.runs).today, 0.00014)
  assert.equal(quantities(saved).calls, 1)
  assert.equal(quantities(saved).inputTokens, 30)
  assert.equal(quantities(saved).outputTokens, 5)
  assert.deepEqual(saved.budgetReservations, {})
})

test('explicit API-only billing cannot borrow a subscription zero-dollar hold', async () => {
  const routes = [{ ...subscription, billing: 'api-only' }, { ...api, pricing: { input: 100_000, output: 200_000 } }]
  const ctx = context({ routes })
  const result = await execute(ctx, settings(routes, { dailyBudgetUsd: 0.001 }), prepared(routes))
  assert.equal(result.paused, true)
  assert.equal(result.plan.accounting.packages[0].billing, 'api')
  assert.ok(result.budget.estimateUsd > 0.001)
  assert.equal(ctx.calls.length, 0)
  assert.equal(quantities(await disk()).calls, 0)
})

test('a manually pinned API package is monetary even when its route is linked to a subscription', async () => {
  const routes = [subscription, api], ctx = context({ routes })
  const plan = prepared(routes)
  plan.direct = false
  plan.plan = { mode: 'team', availableRoutes: routes, estimatedCost: 0.8,
    team: { workPackages: [{ id: 'manual', name: 'manual', objective: 'Inspect fixture', dependsOn: [],
      recommendedProvider: api.provider, recommendedModel: api.model, estimatedCost: 0.8,
      manualAssignment: { kind: 'api', provider: api.provider, model: api.model }, selectionSource: 'manual' }] },
    costBreakdown: [{ id: 'manual', estimatedCost: 0.8 }], optimization: {} }
  const result = await execute(ctx, settings(routes, { dailyBudgetUsd: 0.1 }), plan)
  assert.equal(result.paused, true)
  assert.equal(result.plan.accounting.packages[0].billing, 'api')
  assert.equal(ctx.calls.length, 0)
  assert.equal(quantities(await disk()).calls, 0)
})

function officialPlan(route = { provider: 'openai', model: 'gpt-cli', execution: 'official' }, estimate = null) {
  return { status: 'planned', mode: 'read-only', executionEnvironment: 'harness', workspace: home,
    taskText: task, routes: [route], installed: ['codex'], cliModels: {},
    plan: { mode: 'team', availableRoutes: [route], estimatedCost: estimate,
      team: { workPackages: [{ id: 'one', name: 'one', objective: 'Inspect fixture', dependsOn: [],
        recommendedProvider: route.provider, recommendedModel: route.model, estimatedCost: estimate }] },
      costBreakdown: [{ id: 'one', estimatedCost: estimate }], optimization: {} } }
}

test('an official CLI subscription with no prices ignores API money limits and records tokens', async () => {
  await apiHistory(1)
  let calls = 0
  const result = await host.executeOfficialTeamPlan(context(), settings(), officialPlan(), { runTeam: async hooks => {
    await hooks.onCheckpointStart({ id: 'one', toolId: 'codex', channel: 'official-cli' })
    calls += 1
    const current = await disk(), hold = Object.values(current.budgetReservations)[0].packages[0]
    assert.equal(hold.billing, 'subscription')
    assert.equal(hold.estimatedCostUsd, 0)
    assert.equal(reservationSpending(current).today, 0)
    const receipt = { id: 'one', status: 'succeeded', toolId: 'codex', provider: 'openai',
      recommendedModel: 'gpt-cli', finalText: 'CLI fixture', credentialSource: 'cli-session', usage: subUsage }
    await hooks.onCheckpointResult(receipt)
    return { status: 'cli-completed', workspace: home, results: [receipt] }
  } })
  assert.equal(calls, 1)
  assert.equal(result.status, 'cli-completed')
  const saved = await disk()
  assert.equal(quantities(saved).calls, 1)
  assert.equal(quantities(saved).inputTokens, 30)
  near(spending(saved.runs).today, 1)
  assert.equal(spending(saved.runs).unknownToday, 0)
})

test('an API-key CLI is checked against monetary budgets before its runner starts', async () => {
  process.env.OPENAI_API_KEY = 'offline-fixture-no-real-credential'
  let calls = 0
  const result = await host.executeOfficialTeamPlan(context(), settings(undefined, { dailyBudgetUsd: 0.1 }),
    officialPlan(undefined, 0.4), { runTeam: async () => { calls += 1; assert.fail('The paid runner must not start') } })
  assert.equal(result.status, 'paused-budget')
  assert.equal(result.plan.accounting.packages[0].billing, 'api')
  assert.equal(calls, 0)
  assert.equal(quantities(await disk()).calls, 0)
})

test('a killed API fallback retains subscription tokens and an unknown API charge independently', { timeout: 15_000 }, async t => {
  const moduleUrl = new URL('../.dsh-plugin/index.mjs', import.meta.url).href
  const quotaUrl = new URL('../.dsh-plugin/shared/subscription-billing.mjs', import.meta.url).href
  const source = `
    globalThis.fetch=async()=>{throw new Error('No network in crash fixture')};
    const host=await import(${JSON.stringify(moduleUrl)});
    const {createQuotaTracker}=await import(${JSON.stringify(quotaUrl)});
    const routes=${JSON.stringify([subscription, api])};
    const usage=${JSON.stringify(subUsage)};
    const ctx={sandbox:{confine(){throw new Error('No CLI')}},llm:{
      listProviders:()=>routes.map(r=>r.provider),listModels:async p=>routes.filter(r=>r.provider===p).map(r=>({id:r.model})),
      resolveModelInfo:async(p,m)=>({provider:p,id:m}),
      stream(request){return(async function*(){
        if(request.provider===routes[0].provider){
          yield{type:'usage',usage};yield{type:'finish',reason:{kind:'error',failure:{message:'429 quota exceeded'}}};return;
        }
        process.send({apiStarted:true});await new Promise(()=>{});
      })();}}};
    setInterval(()=>{},1000);
    host.executeConfiguredAssignment(ctx,${JSON.stringify(task)},${JSON.stringify(settings())},{workspace:process.env.DSH_HOME,
      provider:routes[0].provider,model:routes[0].model,skipToolProbe:true,installedToolIds:[],runnableToolIds:[],
      billing:{quota:createQuotaTracker()}}).then(result=>process.send({ended:result.paused??result.status??result.execution?.status,
        budget:result.budget,error:result.execution?.packages?.[0]?.error})).catch(error=>{process.send({error:error.stack});process.exitCode=1;});
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  const message = (await once(child, 'message'))[0]
  assert.equal(message.error, undefined, message.error ?? stderr)
  assert.equal(message.apiStarted, true)
  const before = await disk()
  assert.equal(quantities(before).calls, 1)
  assert.equal(quantities(before).inputTokens, 30)
  assert.equal(before.runs[0].packages[0].billing, 'api')
  assert.equal(before.runs[0].packages[0].subscriptionAttempts.length, 1)
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  await createBudgetReservations({ state: store }).recoverInterruptedExecutions()
  const saved = await disk(), item = saved.runs[0].packages[0]
  assert.equal(item.status, 'interrupted')
  assert.equal(item.billing, 'api')
  assert.equal(item.ran, true)
  assert.equal(item.costUsd, null)
  assert.equal(spending(saved.runs).unknownToday, 1)
  assert.equal(quantities(saved).calls, 1)
  assert.equal(quantities(saved).inputTokens, 30)
  assert.equal(quantities(saved).unknownUsageCalls, 0)
  assert.equal(Object.values(saved.budgetReservations)[0].status, 'interrupted')
})


test('an unverified CLI account is not treated as a free subscription or a settled API invoice', async () => {
  const unknownHealth = { checkedAt: Date.now(), tools: [] }
  healthCache.remember(unknownHealth)
  await store.update(state => { state.health = unknownHealth })
  const planned = await host.planToolRun(context(), settings(), { tool: 'codex', task })
  assert.equal(planned.funding, 'api')
  assert.equal(planned.budget.exceeded, 'unknown')
  const run = await host.recordToolRun({ toolId: 'codex', task, startedAt: Date.now(),
    result: { status: 'succeeded', reportedCostUsd: 999, usage: subUsage } })
  assert.equal(run.packages[0].billing, 'unknown')
  assert.equal(run.packages[0].costUsd, null)
  assert.equal(run.packages[0].referenceCostUsd, null)
  const saved = await disk()
  assert.equal(quantities(saved).calls, 0)
  assert.equal(spending(saved.runs).today, 0)
  assert.equal(spending(saved.runs).unknownToday, 1)
})

test('an independent consultation to a coding plan records quantities despite a full API budget', async () => {
  await apiHistory(1)
  const ctx = context()
  const result = await host.executeBudgetedConsult(ctx, subscription, task, settings(), { routes: [subscription, api] })
  assert.equal(result.billing, 'subscription')
  assert.equal(result.ok, true)
  const saved = await disk()
  near(spending(saved.runs).today, 1)
  assert.equal(quantities(saved).calls, 1)
  assert.equal(quantities(saved).inputTokens, 30)
  assert.deepEqual(saved.budgetReservations, {})
})
