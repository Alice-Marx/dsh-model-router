import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { beginExecutionLifecycle } from '../.dsh-plugin/shared/execution-lifecycle.mjs'
import { buildRunRecord, buildTeamRunRecord, buildToolRunRecord, spending } from '../.dsh-plugin/shared/run-ledger.mjs'

const firstAt = new Date(2026, 9, 31, 23, 59, 59).getTime()
const secondAt = new Date(2026, 10, 1, 0, 0, 1).getTime()
const finalizedAt = new Date(2026, 10, 2, 12).getTime()
const route = { provider: 'fixture', model: 'gpt-receipt-time' }
const plan = { mode: 'team', team: { workPackages: ['a', 'b'].map(id => ({ id, name: id, objective: id,
  dependsOn: [], recommendedProvider: route.provider, recommendedModel: route.model, estimatedCost: 0.2 })) } }
const apiReceipt = (id, reportedCostUsd, finishedAt) => ({ id, ...route, channel: 'harness-llm', billing: 'api',
  ok: true, answer: id, reportedCostUsd, ...(finishedAt !== undefined ? { finishedAt } : {}) })
const record = (execution, finishedAt) => buildRunRecord({ id: 'times', createdAt: firstAt,
  task: 'a then b', plan, execution, finishedAt })
const assertPeriods = run => {
  assert.equal(run.packages[0].finishedAt, firstAt)
  assert.equal(run.packages[1].finishedAt, secondAt)
  assert.equal(spending([run], firstAt).today, 1)
  assert.equal(spending([run], firstAt).month, 1)
  assert.equal(spending([run], secondAt).today, 2)
  assert.equal(spending([run], secondAt).month, 2)
  assert.equal(spending([run], finalizedAt).today, 0)
}

async function stateFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'router-receipt-time-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return createRouterState({ file: join(directory, 'state.json') })
}

test('later checkpoints and final settlement retain each API receipt’s observed day and month', async t => {
  let clock = firstAt
  t.mock.method(Date, 'now', () => clock)
  const state = await stateFixture(t)
  const life = await beginExecutionLifecycle({ state,
    packageEstimates: [{ id: 'a', estimatedCostUsd: 0.2 }, { id: 'b', estimatedCostUsd: 0.2 }],
    buildRun: ({ status, results }) => record({ status, packages: results }, Date.now()) })
  const a = apiReceipt('a', 1), b = apiReceipt('b', 2)
  await life.onCheckpointStart({ id: 'a' })
  await life.onCheckpointResult(a)
  assert.equal(a.finishedAt, firstAt, 'the actual executor receipt is stamped, not just a ledger copy')
  clock = secondAt
  await life.onCheckpointStart({ id: 'b' })
  assert.equal((await state.read()).runs[0].packages[0].finishedAt, firstAt)
  await life.onCheckpointResult(b)
  assert.equal(b.finishedAt, secondAt)
  clock = finalizedAt
  const final = record({ status: 'completed', packages: [a, b] }, clock)
  await life.finish(final)
  assertPeriods((await state.read()).runs[0])
})

test('explicit valid receipt times survive delayed ledger conversion and invalid times fall back safely', () => {
  assertPeriods(record({ status: 'completed', packages: [apiReceipt('a', 1, firstAt), apiReceipt('b', 2, secondAt)] }, finalizedAt))
  for (const invalid of [-1, Infinity, NaN, null, 9e20]) {
    const run = record({ status: 'completed', packages: [apiReceipt('a', 1, invalid)] }, finalizedAt)
    assert.equal(run.packages[0].finishedAt, finalizedAt)
  }
})

test('team conversion forwards per-package CLI receipt times across a month boundary', () => {
  const run = buildTeamRunRecord({ id: 'team-times', task: 'a then b', createdAt: firstAt, finishedAt: finalizedAt, plan,
    execution: { status: 'cli-completed', results: [
      { id: 'a', status: 'succeeded', provider: route.provider, recommendedModel: route.model, finalText: 'a', reportedCostUsd: 1, finishedAt: firstAt },
      { id: 'b', status: 'succeeded', provider: route.provider, recommendedModel: route.model, finalText: 'b', reportedCostUsd: 2, finishedAt: secondAt },
    ] }, billingFor: () => 'api' })
  assertPeriods(run)
})

test('single-tool conversion forwards its receipt time instead of the later integration time', () => {
  const run = buildToolRunRecord({ id: 'tool-times', task: 'a', createdAt: firstAt, finishedAt: finalizedAt,
    toolId: 'codex', provider: route.provider, model: route.model, billingFor: () => 'api',
    result: { status: 'succeeded', finalText: 'a', reportedCostUsd: 1, finishedAt: firstAt } })
  assert.equal(run.packages[0].finishedAt, firstAt)
  assert.equal(spending([run], firstAt).today, 1)
  assert.equal(spending([run], secondAt).month, 0)
})

test('single-tool final copies retain the timestamp from the earlier checkpoint receipt', async t => {
  let clock = firstAt
  t.mock.method(Date, 'now', () => clock)
  const state = await stateFixture(t)
  const build = result => buildToolRunRecord({ id: 'tool-checkpoint-time', task: 'a', createdAt: firstAt, finishedAt: Date.now(),
    toolId: 'codex', provider: route.provider, model: route.model, billingFor: () => 'api', result })
  const life = await beginExecutionLifecycle({ state, packageEstimates: [{ id: 'direct', estimatedCostUsd: 0.2 }],
    buildRun: ({ status, results }) => build(results[0] ?? { status, notStarted: true }) })
  await life.onCheckpointStart({ id: 'direct' })
  const raw = { status: 'succeeded', finalText: 'a', reportedCostUsd: 1 }
  await life.onCheckpointResult({ ...raw, id: 'direct' })
  clock = finalizedAt
  const final = build(raw)
  assert.equal(final.packages[0].finishedAt, finalizedAt, 'the returned runtime object can be a separate receipt copy')
  await life.finish(final)
  const saved = (await state.read()).runs[0]
  assert.equal(saved.packages[0].finishedAt, firstAt)
  assert.equal(spending([saved], firstAt).today, 1)
  assert.equal(spending([saved], secondAt).month, 0)
})

test('quality partial receipts keep their supplied observation time while another attempt is pending', async t => {
  t.mock.method(Date, 'now', () => secondAt)
  const state = await stateFixture(t)
  const life = await beginExecutionLifecycle({ state,
    packageEstimates: [{ id: 'a', estimatedCostUsd: 0.2 }, { id: 'b', estimatedCostUsd: 0.2 }],
    buildRun: ({ status, results }) => record({ status, packages: results }, Date.now()) })
  await life.onCheckpointStart({ id: 'a' })
  const partial = { ...apiReceipt('a', 1, firstAt), qualityAttempts: [{ ...apiReceipt('a', 1, firstAt), pricingSnapshot: null }] }
  await life.partialResult(partial)
  assert.equal(partial.finishedAt, firstAt)
  const stored = (await state.read()).runs[0].packages[0]
  assert.equal(stored.finishedAt, firstAt)
  assert.equal(stored.qualityAttempts[0].finishedAt, firstAt)
  assert.equal(spending([(await state.read()).runs[0]], firstAt).today, 1)
})
