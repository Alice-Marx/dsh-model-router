import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { createBudgetReservations, reservationSpending } from '../.dsh-plugin/shared/budget-reservations.mjs'
import { beginExecutionLifecycle } from '../.dsh-plugin/shared/execution-lifecycle.mjs'
import { accountingEstimates, attachPlanAccounting, initialFunding } from '../.dsh-plugin/shared/execution-accounting.mjs'
import { buildRunRecord, spending } from '../.dsh-plugin/shared/run-ledger.mjs'
import { subscriptionUsage } from '../.dsh-plugin/shared/subscription-usage.mjs'

const AT = new Date(2026, 9, 24, 12).getTime()
const pending = (id, billing = 'subscription') => ({ id, status: 'running', createdAt: AT,
  packages: [{ id: 'a', status: 'running', inFlight: true, billing, ran: false, costUsd: null }], reviews: [] })
const estimate = (billing, amount = null) => [{ id: 'a', billing, estimatedCostUsd: amount }]
const paid = amount => ({ id: 'paid', createdAt: AT, packages: [
  { id: 'paid', billing: 'api', ran: true, costUsd: amount, finishedAt: AT },
] })
const route = { provider: 'openai', model: 'gpt-subscription-fixture', billing: 'subscription-first',
  subscription: 'cli-login', pricing: { input: 10, output: 20 } }
const plan = { mode: 'team', team: { workPackages: [{ id: 'a', name: 'a', objective: 'a', dependsOn: [],
  recommendedProvider: route.provider, recommendedModel: route.model, estimatedCost: 0.4 }] },
  costBreakdown: [{ id: 'a', inputTokens: 100, outputTokens: 20 }], complexity: { band: 'balanced' } }
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'router-subscription-holds-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const state = createRouterState({ file: join(directory, 'state.json'), now: () => AT })
  return { state, manager: createBudgetReservations({ state, now: () => AT }) }
}

test('a pure subscription admission and dispatch ignore a full API budget and preserve subscription use', async t => {
  const { state, manager } = await fixture(t)
  await state.appendRun(paid(2))
  const begin = await manager.beginExecution({ run: pending('sub'), packageEstimates: estimate('subscription'),
    dailyLimitUsd: 1, monthlyLimitUsd: 1, ownerToken: 'sub-owner' })
  assert.equal(begin.accepted, true)
  assert.equal(begin.budget.apiExposure, false)
  assert.equal(begin.budget.exceeded, null)
  assert.equal(reservationSpending(await state.read()).reservedUsd, 0)
  const started = await manager.checkpointExecution({ reservationId: 'sub', ownerToken: 'sub-owner', run: pending('sub'),
    startedIds: ['a'], checkBudget: true, dailyLimitUsd: 1, monthlyLimitUsd: 1 })
  assert.equal(started.accepted, true)
  const completed = pending('sub')
  completed.packages[0] = { ...completed.packages[0], ran: true, inFlight: false, status: 'succeeded',
    usage: { inputTokens: 100, outputTokens: 20 }, finishedAt: AT }
  await manager.finishExecution({ reservationId: 'sub', ownerToken: 'sub-owner', run: completed })
  const saved = await state.read()
  assert.equal(spending(saved.runs, AT, saved.archivedSpending).today, 2)
  assert.equal(subscriptionUsage(saved.runs, AT, saved.archivedSubscriptionUsage).today.inputTokens, 100)
})

test('an interrupted unknown subscription hold cannot turn into unknown API spending or occupy money', async t => {
  const { state } = await fixture(t)
  const manager = createBudgetReservations({ state, now: () => AT, pid: 999999, isProcessAlive: () => false })
  await manager.beginExecution({ run: pending('dead-sub'), packageEstimates: estimate('subscription'), ownerToken: 'owner' })
  await manager.checkpointExecution({ reservationId: 'dead-sub', ownerToken: 'owner', run: pending('dead-sub'), startedIds: ['a'] })
  await manager.recoverInterruptedExecutions()
  const saved = await state.read()
  assert.equal(saved.runs[0].packages[0].billing, 'subscription')
  assert.equal(saved.runs[0].packages[0].ran, true)
  assert.equal(spending(saved.runs, AT).unknownToday, 0)
  assert.equal(subscriptionUsage(saved.runs, AT).today.unknownUsageCalls, 1)
  assert.equal(reservationSpending(saved).unknownReservations, 0)
  assert.equal(reservationSpending(saved).reservedUsd, 0)
  const api = await manager.beginExecution({ run: pending('next-api', 'api'), packageEstimates: estimate('api', 0.4),
    dailyLimitUsd: 0.5, ownerToken: 'next-owner' })
  assert.equal(api.accepted, true)
})

test('financial history uncertainty blocks API but not a subscription-only run or its start checkpoint', async t => {
  const { state, manager } = await fixture(t)
  await state.update(value => { value.historyIncomplete = true })
  const sub = await manager.beginExecution({ run: pending('sub'), packageEstimates: estimate('subscription'), dailyLimitUsd: 1, ownerToken: 'sub' })
  assert.equal(sub.accepted, true)
  const start = await manager.checkpointExecution({ reservationId: 'sub', ownerToken: 'sub', run: pending('sub'),
    startedIds: ['a'], checkBudget: true, dailyLimitUsd: 1 })
  assert.equal(start.accepted, true)
  const api = await manager.beginExecution({ run: pending('api', 'api'), packageEstimates: estimate('api', 0.1),
    dailyLimitUsd: 1, ownerToken: 'api', confirmOverBudget: true })
  assert.equal(api.accepted, false)
  assert.equal(api.reason, 'history-incomplete')
})

test('an earlier API receipt exceeding its estimate does not stop later subscription-only steps', async t => {
  const { state } = await fixture(t)
  const planned = structuredClone(plan)
  planned.team.workPackages.push({ ...planned.team.workPackages[0], id: 'b' })
  const life = await beginExecutionLifecycle({ state, packageEstimates: [{ id: 'a', billing: 'api', estimatedCostUsd: 0.4 },
    { id: 'b', billing: 'subscription', estimatedCostUsd: null }], settings: { dailyLimitUsd: 1 },
    buildRun: ({ status, results }) => buildRunRecord({ id: 'api-then-sub', createdAt: Date.now(), task: 'fixture', plan: planned,
      execution: { status, packages: results }, pricingFor: () => route.pricing }) })
  assert.equal(life.accepted, true)
  await life.onCheckpointStart({ id: 'a' })
  await life.onCheckpointResult({ id: 'a', billing: 'api', channel: 'harness-llm', ok: true, answer: 'paid', reportedCostUsd: 2 })
  await life.onCheckpointStart({ id: 'b' })
  await life.onCheckpointResult({ id: 'b', billing: 'subscription', channel: 'official-cli', ok: true,
    answer: 'subscription', usage: { inputTokens: 3, outputTokens: 1 } })
  await life.finish(life.current('completed'))
  const saved = await state.read()
  assert.equal(spending(saved.runs).today, 2)
  assert.equal(subscriptionUsage(saved.runs).today.inputTokens, 3)
  assert.deepEqual(saved.budgetReservations, {})
})

test('changing a started subscription to API is an atomic money reservation, rejected without modifying the receipt', async t => {
  const { state, manager } = await fixture(t)
  await state.appendRun(paid(0.8))
  const subRun = pending('sub')
  subRun.packages[0].ran = true
  subRun.packages[0].usage = { inputTokens: 7, outputTokens: 2 }
  await manager.beginExecution({ run: subRun, packageEstimates: estimate('subscription'), dailyLimitUsd: 1, ownerToken: 'sub' })
  await manager.checkpointExecution({ reservationId: 'sub', ownerToken: 'sub', run: subRun, startedIds: ['a'] })
  const before = await readFile(state.file, 'utf8')
  const changed = await manager.resizeExecution({ reservationId: 'sub', ownerToken: 'sub', packageEstimates: estimate('api', 0.3), dailyLimitUsd: 1 })
  assert.equal(changed.accepted, false)
  assert.equal(changed.reason, 'budget')
  assert.equal(await readFile(state.file, 'utf8'), before)
  assert.equal(subscriptionUsage((await state.read()).runs, AT).today.inputTokens, 7)
  assert.equal((await state.read()).budgetReservations.sub.packages[0].billing, 'subscription')
})

test('an API pending checkpoint retains the subscription receipt and a crash records only the API charge as unknown', async t => {
  const { state } = await fixture(t)
  const planned = structuredClone(plan)
  const life = await beginExecutionLifecycle({ state, packageEstimates: estimate('subscription'), settings: { dailyLimitUsd: 1 },
    buildRun: ({ status, results }) => buildRunRecord({ id: 'sub-to-api', createdAt: Date.now(), task: 'fixture', plan: planned,
      execution: { status, packages: results }, pricingFor: () => route.pricing }) })
  await life.onCheckpointStart({ id: 'a', provider: route.provider, model: route.model })
  const subAttempt = { provider: route.provider, model: route.model, toolId: 'codex',
    usage: { inputTokens: 11, outputTokens: 3 }, finishedAt: Date.now() }
  await life.partialResult({ id: 'a', ...route, billing: 'subscription', ok: false, usage: subAttempt.usage,
    subscriptionAttempts: [subAttempt] })
  assert.equal((await life.reserveExtra('a', 0.4)).accepted, true)
  await life.partialResult({ id: 'a', ...route, billing: 'api', channel: 'harness-llm', ok: false, notStarted: true,
    usage: null, subscriptionAttempts: [subAttempt] }, { checkBudget: true })
  let saved = await state.read()
  assert.equal(subscriptionUsage(saved.runs).today.inputTokens, 11)
  assert.equal(spending(saved.runs).unknownToday, 0, 'the pre-dispatch placeholder itself is not an invoice')
  assert.equal(saved.budgetReservations[life.id].packages[0].billing, 'api')
  assert.equal(saved.budgetReservations[life.id].packages[0].estimatedCostUsd, 0.4)
  await life.interrupt(life.current('interrupted'))
  saved = await state.read()
  assert.equal(spending(saved.runs).unknownToday, 1)
  assert.equal(subscriptionUsage(saved.runs).today.calls, 1)
  assert.equal(subscriptionUsage(saved.runs).today.inputTokens, 11)
  assert.equal(reservationSpending(saved).unknownReservations, 1)
})

test('a concurrent API resize cannot admit two fallbacks against the same remaining money', async t => {
  const { state, manager } = await fixture(t)
  for (const id of ['first', 'second']) await manager.beginExecution({ run: pending(id),
    packageEstimates: estimate('subscription'), dailyLimitUsd: 1, ownerToken: id })
  const results = await Promise.all(['first', 'second'].map(id => manager.resizeExecution({ reservationId: id,
    ownerToken: id, packageEstimates: estimate('api', 0.6), dailyLimitUsd: 1 })))
  assert.equal(results.filter(value => value.accepted).length, 1)
  assert.equal(results.filter(value => value.reason === 'budget').length, 1)
  assert.equal(reservationSpending(await state.read()).reservedUsd, 0.6)
})

test('manual API and explicit API-key CLI funding cannot borrow subscription zero-dollar admission', () => {
  assert.equal(initialFunding(route, { forceApi: true }).billing, 'api')
  assert.equal(initialFunding(route, { officialCli: true, apiKeyFor: () => true,
    loginBillingFor: () => 'subscription' }).billing, 'api')
  assert.equal(initialFunding(route, { officialCli: true, loginBillingFor: () => 'api-key' }).billing, 'api')
  assert.equal(initialFunding(route, { officialCli: true, loginBillingFor: () => 'subscription' }).billing, 'subscription')
  const manual = structuredClone(plan)
  manual.team.workPackages[0].manualAssignment = { kind: 'api', provider: route.provider, model: route.model }
  const accounting = attachPlanAccounting(manual, 'fixture', [route], { billing: { routes: [route] },
    loginBillingFor: () => 'subscription' })
  assert.equal(accounting.apiExposure, true)
  assert.equal(accounting.apiEstimatedCostUsd, 0.4)
  assert.equal(accountingEstimates(manual)[0].billing, 'api')
})

test('mixed API/subscription plans reserve only API money and retain independent estimated quantities', () => {
  const mixed = structuredClone(plan)
  mixed.team.workPackages.push({ ...mixed.team.workPackages[0], id: 'b', recommendedProvider: 'api-fixture', recommendedModel: 'gpt-api', estimatedCost: 0.2 })
  const routes = [route, { provider: 'api-fixture', model: 'gpt-api', billing: 'api-only', subscription: 'none' }]
  const accounting = attachPlanAccounting(mixed, 'fixture', routes, { billing: { routes, loginBillingFor: () => 'subscription' } })
  assert.equal(accounting.apiExposure, true)
  assert.equal(accounting.apiEstimatedCostUsd, 0.2)
  assert.deepEqual(accountingEstimates(mixed), [{ id: 'a', billing: 'subscription', estimatedCostUsd: 0 },
    { id: 'b', billing: 'api', estimatedCostUsd: 0.2 }])
  assert.equal(accounting.packages[0].estimatedUsage.inputTokens, 100)
})


test('a started API reservation cannot be relabelled as subscription to free money', async t => {
  const { manager, state } = await fixture(t)
  await manager.beginExecution({ run: pending('api', 'api'), packageEstimates: estimate('api', 0.4), ownerToken: 'owner' })
  await manager.checkpointExecution({ reservationId: 'api', ownerToken: 'owner', run: pending('api', 'api'), startedIds: ['a'] })
  await assert.rejects(manager.resizeExecution({ reservationId: 'api', ownerToken: 'owner', packageEstimates: estimate('subscription') }), /不能通过改为订阅/)
  assert.equal(reservationSpending(await state.read()).today, 0.4)
})


test('a subscription step remains runnable after an API overrun even with another API step still pending', async t => {
  const { manager, state } = await fixture(t)
  const packages = [{ id: 'api-first', billing: 'api', estimatedCostUsd: 0.2 },
    { id: 'sub', billing: 'subscription', estimatedCostUsd: 0 }, { id: 'api-last', billing: 'api', estimatedCostUsd: 0.2 }]
  const run = { id: 'mixed-order', createdAt: AT, status: 'running', packages: [], reviews: [] }
  await manager.beginExecution({ run, packageEstimates: packages, ownerToken: 'owner', dailyLimitUsd: 1 })
  run.packages.push({ id: 'api-first', billing: 'api', ran: true, costUsd: 2, finishedAt: AT })
  await manager.checkpointExecution({ reservationId: run.id, ownerToken: 'owner', run, completedIds: ['api-first'] })
  const sub = await manager.checkpointExecution({ reservationId: run.id, ownerToken: 'owner', run,
    startedIds: ['sub'], checkBudget: true, dailyLimitUsd: 1 })
  assert.equal(sub.accepted, true)
  const next = await manager.checkpointExecution({ reservationId: run.id, ownerToken: 'owner', run,
    startedIds: ['sub', 'api-last'], checkBudget: true, dailyLimitUsd: 1 })
  assert.equal(next.accepted, false)
  assert.equal((await state.read()).budgetReservations[run.id].packages.find(item => item.id === 'api-last').started, false)
})
