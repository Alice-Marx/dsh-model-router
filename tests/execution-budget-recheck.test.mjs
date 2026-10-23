import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { beginExecutionLifecycle } from '../.dsh-plugin/shared/execution-lifecycle.mjs'
import { createBudgetReservations } from '../.dsh-plugin/shared/budget-reservations.mjs'
import { buildRunRecord, spending } from '../.dsh-plugin/shared/run-ledger.mjs'
import { executeAssignmentPlan } from '../.dsh-plugin/shared/task-executors.mjs'

const route = { provider: 'fixture', model: 'gpt-budget-recheck', execution: 'api', billing: 'api-only',
  pricing: { input: 1, output: 1 } }
const plan = {
  mode: 'team', estimatedCost: 0.4, availableRoutes: [route],
  team: { workPackages: ['first', 'second'].map((id, index) => ({ id, name: id, objective: id,
    dependsOn: index ? ['first'] : [], recommendedProvider: route.provider, recommendedModel: route.model, estimatedCost: 0.2 })) },
}

async function fixture(t, { confirmOverBudget = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'router-budget-recheck-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const state = createRouterState({ file: join(directory, 'state.json') })
  const build = ({ status, results }) => buildRunRecord({ id: 'recheck-run', task: 'Complete both steps', plan,
    createdAt: Date.now(), finishedAt: Date.now(), execution: { status, packages: results }, pricingFor: () => route.pricing })
  const life = await beginExecutionLifecycle({ state, buildRun: build, confirmOverBudget,
    packageEstimates: [{ id: 'first', estimatedCostUsd: 0.2 }, { id: 'second', estimatedCostUsd: 0.2 }],
    settings: { dailyLimitUsd: 0.8 } })
  assert.equal(life.accepted, true)
  return { state, life }
}

async function execute(life, { unknown = false, costUsd = 1, onPackage } = {}) {
  let calls = 0
  const running = executeAssignmentPlan({ plan, task: 'Complete both steps', routes: [route], billing: null,
    onCheckpointStart: item => life.onCheckpointStart(item), onCheckpointResult: item => life.onCheckpointResult(item),
    onPackage,
    apiFallback: async () => {
      calls += 1
      return { ok: true, answer: `receipt ${calls}`, ...(unknown ? {} : { usage: { inputTokens: costUsd * 1_000_000, outputTokens: 0 } }) }
    },
  })
  return { outcome: await running.then(value => ({ value }), error => ({ error })), calls }
}

test('observed fees above the original estimate stop the next actual API dispatch', async t => {
  const { state, life } = await fixture(t)
  const { outcome, calls } = await execute(life)
  assert.equal(calls, 1)
  assert.equal(outcome.error.code, 'ROUTER_BUDGET_CHANGED')
  assert.equal(outcome.error.runId, life.id)
  assert.equal(outcome.error.budget.exceeded, 'daily')
  assert.equal(outcome.error.checkpointStage, 'start')
  assert.equal(outcome.error.execution.packages[0].answer, 'receipt 1')
  assert.doesNotMatch(outcome.error.message, /检查点保存失败/)
  const saved = await state.read()
  assert.equal(spending(saved.runs).today, 1)
  assert.equal(saved.budgetReservations[life.id].packages[0].started, false)
  assert.equal(life.current('paused-budget').packages[1].ran, false, 'a budget refusal must roll back the tentative start')
  // A budget decision is not a poisoned persistence sink: Host may settle the
  // observed receipt and release work that was never dispatched.
  await life.finish(life.current('paused-budget'))
  assert.deepEqual((await state.read()).budgetReservations, {})
  assert.equal((await state.read()).runs[0].status, 'paused-budget')
})

test('a successful answer with unknown actual usage pauses downstream paid work', async t => {
  const { state, life } = await fixture(t)
  const { outcome, calls } = await execute(life, { unknown: true })
  assert.equal(calls, 1)
  assert.equal(outcome.error.code, 'ROUTER_BUDGET_CHANGED')
  assert.equal(outcome.error.reason, 'budget-unknown')
  assert.equal(outcome.error.budget.exceeded, 'unknown')
  const saved = await state.read()
  assert.equal(spending(saved.runs).unknownToday, 1)
  assert.equal(saved.budgetReservations[life.id].packages[0].started, false)
  await life.finish(life.current('paused-budget'))
  assert.equal(spending((await state.read()).runs).unknownToday, 1)
})

test('an explicitly confirmed execution can continue after actual fees exceed the preview', async t => {
  const { state, life } = await fixture(t, { confirmOverBudget: true })
  const { outcome, calls } = await execute(life)
  assert.equal(outcome.error, undefined)
  assert.equal(calls, 2)
  await life.finish(life.current(outcome.value.status))
  const saved = await state.read()
  assert.equal(spending(saved.runs).today, 2)
  assert.deepEqual(saved.budgetReservations, {})
})

test('dispatch rechecks a different execution’s newly settled actual fee', async t => {
  const { state, life } = await fixture(t)
  const { outcome, calls } = await execute(life, { costUsd: 0.1, onPackage: async () => {
    await state.appendRun({ id: 'other', createdAt: Date.now(), packages: [
      { id: 'other', ran: true, billing: 'api', costUsd: 0.6, finishedAt: Date.now() },
    ] })
  } })
  assert.equal(calls, 1)
  assert.equal(outcome.error.code, 'ROUTER_BUDGET_CHANGED')
  assert.equal(spending((await state.read()).runs).today, 0.7)
})

test('an atomic refused dispatch leaves the held package and run bytes unchanged', async t => {
  const { state, life } = await fixture(t)
  const manager = createBudgetReservations({ state })
  await state.appendRun({ id: 'settled', createdAt: Date.now(), packages: [
    { id: 'paid', ran: true, billing: 'api', costUsd: 1, finishedAt: Date.now() },
  ] })
  const before = await readFile(state.file, 'utf8')
  const saved = await state.read()
  const hold = saved.budgetReservations[life.id]
  const rejected = await manager.checkpointExecution({ reservationId: life.id, ownerToken: hold.ownerToken,
    run: { ...saved.runs[0], status: 'running' }, startedIds: ['first'], checkBudget: true, dailyLimitUsd: 0.8 })
  assert.equal(rejected.accepted, false)
  assert.equal(rejected.reason, 'budget')
  assert.equal(await readFile(state.file, 'utf8'), before)
  assert.equal((await state.read()).budgetReservations[life.id].packages[0].started, false)
})

test('extra spend requires its own confirmation even when the initial execution was confirmed', async t => {
  const { state, life } = await fixture(t, { confirmOverBudget: true })
  const refused = await life.reserveExtra('first', 2)
  assert.equal(refused.accepted, false)
  assert.equal((await state.read()).budgetReservations[life.id].packages[0].estimatedCostUsd, 0.2)
  const confirmed = await life.reserveExtra('first', 2, { confirmOverBudget: true })
  assert.equal(confirmed.accepted, true)
  assert.equal((await state.read()).budgetReservations[life.id].packages[0].estimatedCostUsd, 2)
})

const firstQualityReceipt = () => ({ id: 'first', ok: false, answer: 'invalid structure', qualityAttempts: [
  { provider: route.provider, model: route.model, channel: 'harness-llm', ok: true,
    usage: { inputTokens: 100_000, outputTokens: 0 }, pricingSnapshot: route.pricing },
] })
const pendingUpgrade = first => ({ ...first, qualityAttempts: [...first.qualityAttempts,
  { provider: route.provider, model: 'gpt-upgrade', channel: 'harness-llm', ok: false,
    usageIncomplete: true, pricingSnapshot: route.pricing },
] })

test('a quality upgrade atomically authorizes its hold before storing its own pending unknown attempt', async t => {
  const { state, life } = await fixture(t)
  await life.onCheckpointStart({ id: 'first' })
  const first = firstQualityReceipt()
  await life.partialResult(first)
  assert.equal((await life.reserveExtra('first', 0.25)).accepted, true)
  await life.partialResult(pendingUpgrade(first), { checkBudget: true })
  const saved = await state.read()
  assert.equal(saved.runs[0].packages[0].costUsd, null)
  assert.equal(saved.runs[0].packages[0].knownCostUsd, 0.1)
  assert.equal(saved.runs[0].packages[0].qualityAttempts.length, 2)
  assert.equal(saved.budgetReservations[life.id].packages[0].estimatedCostUsd, 0.25)
})

test('a quality upgrade stops when another actual fee settles after its estimate reservation', async t => {
  const { state, life } = await fixture(t, { confirmOverBudget: true })
  await life.onCheckpointStart({ id: 'first' })
  const first = firstQualityReceipt()
  await life.partialResult(first)
  assert.equal((await life.reserveExtra('first', 0.25)).accepted, true)
  await state.appendRun({ id: 'late-fee', createdAt: Date.now(), packages: [
    { id: 'late', ran: true, billing: 'api', costUsd: 0.4, finishedAt: Date.now() },
  ] })
  const before = await readFile(state.file, 'utf8')
  await assert.rejects(life.partialResult(pendingUpgrade(first), { checkBudget: true }), { code: 'ROUTER_BUDGET_CHANGED' })
  assert.equal(await readFile(state.file, 'utf8'), before)
  assert.equal(life.results()[0].qualityAttempts.length, 1, 'denied attempts cannot survive in the receipt map')
  assert.equal(life.current('paused-budget').packages[0].costUsd, 0.1)
  await life.finish(life.current('paused-budget'))
  assert.equal(spending((await state.read()).runs).today, 0.5)
})

test('an extra review dispatch rechecks fresh actual fees and rolls back its tentative maps', async t => {
  const { state, life } = await fixture(t, { confirmOverBudget: true })
  await life.onCheckpointStart({ id: 'first' })
  await life.onCheckpointResult({ id: 'first', ok: true, answer: 'receipt', usage: { inputTokens: 100_000, outputTokens: 0 } })
  assert.equal((await life.reserveExtra('review:first', 0.2)).accepted, true)
  await state.appendRun({ id: 'review-race-fee', createdAt: Date.now(), packages: [
    { id: 'late', ran: true, billing: 'api', costUsd: 0.7, finishedAt: Date.now() },
  ] })
  const run = life.current()
  run.reviews.push({ id: 'review:first', status: 'running', inFlight: true, ran: false, billing: 'api', costUsd: null })
  const before = await readFile(state.file, 'utf8')
  await assert.rejects(life.saveRun(run, { startedIds: ['review:first'], completedIds: ['second'] }), { code: 'ROUTER_BUDGET_CHANGED' })
  assert.equal(await readFile(state.file, 'utf8'), before)
  assert.deepEqual(life.current().checkpoint.startedIds, ['first'])
  assert.deepEqual(life.current().checkpoint.completedIds, ['first'])
  await life.finish(life.current('paused-budget'))
  assert.deepEqual((await state.read()).budgetReservations, {})
})
