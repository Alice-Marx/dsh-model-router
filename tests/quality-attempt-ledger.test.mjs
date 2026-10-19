import test from 'node:test'
import assert from 'node:assert/strict'
import { runQualityCascade } from '../.dsh-plugin/shared/quality-gates.mjs'
import { actualCost, archiveSpending, budgetCheck, buildRunRecord,
  hasStartedQualityAttempts, spending } from '../.dsh-plugin/shared/run-ledger.mjs'

const route = { provider: 'p', model: 'first', pricing: { input: 1, output: 1 } }
const upgrade = { provider: 'p', model: 'next', pricing: { input: 10, output: 10 } }
const gate = { kind: 'json-object', requiredKeys: ['answer'] }
const firstCost = 0.0011
const paid = () => ({ ok: true, provider: 'p', model: 'first', answer: '{}', usage: { inputTokens: 1000, outputTokens: 100 } })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} versus ${b}`)

async function cascadeResult(first, second) {
  let calls = 0
  const cascade = await runQualityCascade({ route, task: 'fixture', gate, alternatives: [upgrade],
    approveUpgrade: () => true, call: async () => ++calls === 1 ? first : second })
  return { ...cascade.result, id: 'step', channel: 'harness-llm', qualityAttempts: cascade.attempts }
}

function record(result) {
  const now = Date.now()
  return buildRunRecord({ id: 'fixture', createdAt: now - 10, finishedAt: now, task: 'fixture',
    plan: { team: { workPackages: [{ id: 'step', name: 'step', recommendedProvider: 'p', recommendedModel: 'first' }] } },
    execution: { status: 'failed', packages: [result] }, pricingFor: () => upgrade.pricing })
}

test('a second not-started or blocked attempt cannot erase the first paid request', async () => {
  for (const marker of ['notStarted', 'blocked']) {
    const result = await cascadeResult(paid(), { ok: false, provider: 'p', model: 'next', answer: '', [marker]: true })
    assert.equal(hasStartedQualityAttempts(result), true)
    near(actualCost(result).costUsd, firstCost)
    const run = record(result)
    const item = run.packages[0]
    assert.equal(item.ran, true)
    near(item.costUsd, firstCost)
    assert.equal(item.costSource, 'quality-attempts')
    assert.equal(item.qualityAttempts[1][marker], true, 'stored evidence must retain the per-attempt stop marker')
    near(actualCost(item).costUsd, firstCost, 'recomputing saved evidence must keep the same bill')
    const spent = spending([run])
    near(spent.today, firstCost)
    assert.equal(spent.unknownToday, 0)
    assert.equal(budgetCheck({ estimateUsd: 0.0001, spent, dailyLimitUsd: firstCost }).exceeded, 'daily')
    near(spending([], undefined, archiveSpending([run])).today, firstCost)
  }
})

test('an unknown first request stays unknown when the second request never starts', async () => {
  const result = await cascadeResult({ ok: true, provider: 'p', model: 'first', answer: '{}' },
    { ok: false, provider: 'p', model: 'next', notStarted: true })
  const cost = actualCost(result)
  assert.equal(cost.costUsd, null)
  assert.equal(cost.knownCostUsd, 0)
  assert.equal(cost.unknownAttemptCount, 1)
  const run = record(result)
  assert.equal(run.packages[0].ran, true)
  assert.equal(run.packages[0].costUsd, null)
  assert.equal(spending([run]).unknownToday, 1)
})

test('a genuinely unknown second execution keeps the known first spend and an unknown remainder', async () => {
  const result = await cascadeResult(paid(), { ok: false, provider: 'p', model: 'next', error: 'transport uncertain' })
  const run = record(result)
  assert.equal(run.packages[0].costUsd, null)
  near(run.packages[0].knownCostUsd, firstCost)
  assert.equal(run.packages[0].unknownAttemptCount, 1)
  near(spending([run]).today, firstCost)
  assert.equal(spending([run]).unknownToday, 1)
})

test('an entirely unstarted cascade creates no spend or unknown expense', async () => {
  for (const marker of ['notStarted', 'blocked']) {
    const result = await cascadeResult({ ok: false, provider: 'p', model: 'first', [marker]: true }, null)
    assert.equal(result.qualityAttempts.length, 1)
    assert.equal(hasStartedQualityAttempts(result), false)
    assert.equal(actualCost(result).costUsd, 0)
    const run = record(result)
    assert.equal(run.packages[0].ran, false)
    assert.equal(run.packages[0].costSource, 'not-run')
    assert.equal(spending([run]).today, 0)
    assert.equal(spending([run]).unknownToday, 0)
  }
})

test('positive usage or reported charges override a contradictory not-started marker', async () => {
  const result = await cascadeResult(paid(), { ok: false, provider: 'p', model: 'next', notStarted: true,
    usage: { inputTokens: 100, outputTokens: 10 } })
  near(actualCost(result).costUsd, firstCost + 0.0011)
  near(record(result).packages[0].costUsd, firstCost + 0.0011)
  const reported = await cascadeResult({ ...paid(), reportedCostUsd: 0.007 },
    { ok: false, provider: 'p', model: 'next', notStarted: true, reportedCostUsd: 0.003 })
  near(actualCost(reported).costUsd, 0.01)
  near(record(reported).packages[0].costUsd, 0.01)
})

test('malformed attempt vectors cannot suppress an uncertain charge using a top-level stop marker', () => {
  for (const qualityAttempts of [[], null, [null], [{ qualityAttempts: [] }]]) {
    const result = { id: 'step', ok: false, notStarted: true, qualityAttempts }
    assert.equal(hasStartedQualityAttempts(result), true)
    assert.equal(actualCost(result).costUsd, null)
    const run = record(result)
    assert.equal(run.packages[0].ran, true)
    assert.equal(spending([run]).unknownToday, 1)
  }
})
