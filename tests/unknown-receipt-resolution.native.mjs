import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import Database from 'better-sqlite3'
import { openSqliteRouterState } from '../packages/orchestration/src/sqlite-router-state.mjs'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { reservationSpending } from '../.dsh-plugin/shared/budget-reservations.mjs'

const CLI_MODEL = { provider: 'integration-gpt-fixture', model: 'gpt-fixture' }

/** One retained run whose single CLI package dispatched but reported no price. */
async function fixture(t, { botId = 'bot-a', hold = null } = {}) {
  await mkdir(resolve('tmp/integration/unknown-receipt'), { recursive: true })
  const dir = await mkdtemp(join(resolve('tmp/integration/unknown-receipt'), 'case-'))
  const file = join(dir, 'ledger.sqlite'), legacyFile = join(dir, 'state.json')
  await createRouterState({ file: legacyFile }).saveHealth(null)
  const store = await openSqliteRouterState({ Database, file, legacyFile, lockStaleMs: 1 })
  t.after(() => store.close())
  // The funding projection buckets by the package's own calendar day, so the
  // fixture must finish inside the current day and month.
  const at = Date.now()
  const runId = 'cli-operation-1'
  const run = { id: runId, kind: 'cli-task', createdAt: at - 2_000, status: 'interrupted', finishedAt: at - 1_000,
    managedExecution: { schemaVersion: 1, taskId: 'task-1', attemptId: 'attempt-1', operationId: 'operation-1', targetHash: 'a'.repeat(64) },
    cliExecution: { schemaVersion: 1, botId, requestedModel: 'gpt-fixture', entrySha256: 'b'.repeat(64), entryVersion: '0.163.0',
      requestHash: 'c'.repeat(64), receiptId: 'receipt-operation-1', stopConfirmed: true },
    packages: [{ id: 'cli', provider: CLI_MODEL.provider, model: CLI_MODEL.model, toolId: 'codex', channel: 'official-cli',
      billing: 'api', ran: true, ok: false, status: 'interrupted', usage: { inputTokens: 11, outputTokens: 5 },
      usageIncomplete: false, finishedAt: at - 1_000, pricingSnapshot: { input: 0.000001, output: 0.000002 },
      costUsd: null, costSource: 'cli-actual-price-unreported', actualModel: null }],
    reviews: [] }
  await store.update(state => { state.runs.push(run) }, { retrySafe: true })
  if (hold) {
    const { createBudgetReservations } = await import('../.dsh-plugin/shared/budget-reservations.mjs')
    const manager = createBudgetReservations({ state: store })
    const admitted = await manager.beginExecution({ run, packageEstimates: [{ id: 'cli', billing: 'api', estimatedCostUsd: 0.001 }] })
    assert.equal(admitted.accepted, true)
    // The CLI facade marks its package started at the dispatch boundary, exactly
    // as onBeforeRequest does, so an interrupted hold keeps its unknown count.
    await manager.checkpointExecution({ reservationId: admitted.reservationId, ownerToken: admitted.ownerToken, run, startedIds: ['cli'] })
    if (hold === 'interrupted') await manager.interruptExecution({ reservationId: admitted.reservationId, ownerToken: admitted.ownerToken, run })
  }
  return { store, runId }
}

test('unknown receipt/native: an unconfirmed package keeps its Bot and scope fail-closed', async t => {
  const { store } = await fixture(t)
  assert.equal(store.fundingTotals({ botId: 'bot-a' }).unknownToday, 1)
  assert.equal(store.fundingTotals().unknownToday, 1)
  const rows = (await store.modelCalls({ botId: 'bot-a' })).items
  assert.equal(rows.length, 0, 'a CLI run without a settled receipt writes no source receipt row')
})

test('unknown receipt/native: a waive records the resolution on the run and clears the unknown', async t => {
  const { store, runId } = await fixture(t)
  const resolved = await store.resolveUnknownPackage({ botId: 'bot-a', runId, packageId: 'cli',
    kind: 'waive', note: '离线测试：厂商账单未核对，按零费用放行。' })
  assert.deepEqual(resolved, { runId, packageId: 'cli', botId: 'bot-a', kind: 'waive', costUsd: 0, resolvedAt: resolved.resolvedAt, holdSettled: false })
  assert.ok(Number.isSafeInteger(resolved.resolvedAt))
  const run = (await store.read()).runs.find(item => item.id === runId)
  const item = run.packages[0]
  assert.equal(item.costUsd, 0)
  assert.equal(item.costSource, 'owner-waived')
  assert.equal(item.ownerResolution.kind, 'waive')
  assert.equal(item.ownerResolution.botId, 'bot-a')
  assert.match(item.ownerResolution.note, /离线测试/)
  assert.equal(store.fundingTotals({ botId: 'bot-a' }).unknownToday, 0)
  assert.equal(store.fundingTotals().unknownToday, 0)
  assert.equal(store.fundingTotals({ botId: 'bot-a' }).today, 0)
})

test('unknown receipt/native: an attest carries the owner-confirmed amount into the spend total', async t => {
  const { store, runId } = await fixture(t)
  await store.resolveUnknownPackage({ botId: 'bot-a', runId, packageId: 'cli', kind: 'attest', costUsd: 0.000042, note: '厂商账单 11/5 tokens。' })
  const run = (await store.read()).runs.find(item => item.id === runId)
  assert.equal(run.packages[0].costUsd, 0.000042)
  assert.equal(run.packages[0].costSource, 'owner-attested')
  assert.equal(store.fundingTotals({ botId: 'bot-a' }).unknownToday, 0)
  assert.ok(Math.abs(store.fundingTotals({ botId: 'bot-a' }).today - 0.000042) < 1e-12)
})

test('unknown receipt/native: only the owning Bot, an unresolved hold and one resolution per package are accepted', async t => {
  const { store, runId } = await fixture(t)
  for (const broken of [
    { botId: 'bot-b', runId, packageId: 'cli', kind: 'waive', note: '越权解决。' },
    { botId: 'bot-a', runId: 'missing-run', packageId: 'cli', kind: 'waive', note: '运行不存在。' },
    { botId: 'bot-a', runId, packageId: 'missing-package', kind: 'waive', note: '包不存在。' },
    { botId: 'bot-a', runId, packageId: 'cli', kind: 'guess', note: '未知类型。' },
    { botId: 'bot-a', runId, packageId: 'cli', kind: 'attest', note: '缺少金额。' },
    { botId: 'bot-a', runId, packageId: 'cli', kind: 'attest', costUsd: -1, note: '负金额。' },
    { botId: 'bot-a', runId, packageId: 'cli', kind: 'waive', note: '   ' },
    { botId: 'bot-a', runId, packageId: 'cli', kind: 'waive' },
  ]) {
    await assert.rejects(async () => store.resolveUnknownPackage(broken), error => {
      assert.ok(['ROUTER_RUN_OWNER_MISMATCH', 'ROUTER_RUN_NOT_FOUND', 'ROUTER_PACKAGE_NOT_FOUND', 'INVALID_RESOLUTION_KIND',
        'RESOLUTION_AMOUNT_REQUIRED', 'RESOLUTION_NOTE_REQUIRED', 'INVALID_TASK_REFERENCE'].includes(error.code), error.code)
      return true
    }, JSON.stringify(broken))
  }
  await store.resolveUnknownPackage({ botId: 'bot-a', runId, packageId: 'cli', kind: 'waive', note: '首次解决。' })
  await assert.rejects(async () => store.resolveUnknownPackage({ botId: 'bot-a', runId, packageId: 'cli', kind: 'waive', note: '重复解决。' }), /ROUTER_PACKAGE_ALREADY_RESOLVED/)
})

test('unknown receipt/native: a still-held run cannot be resolved before its hold is reconciled', async t => {
  const { store, runId } = await fixture(t, { hold: 'active' })
  assert.equal(store.fundingTotals({ botId: 'bot-a' }).unknownToday, 1)
  await assert.rejects(async () => store.resolveUnknownPackage({ botId: 'bot-a', runId, packageId: 'cli', kind: 'waive', note: '持有中解决。' }), /ROUTER_RESERVATION_ACTIVE/)
  assert.equal(store.fundingTotals({ botId: 'bot-a' }).unknownToday, 1)
  assert.deepEqual((await store.read()).budgetReservations[runId].status, 'active')
})

test('unknown receipt/native: the review settles the interrupted hold and clears both unknown counts', async t => {
  const { store, runId } = await fixture(t, { hold: 'interrupted' })
  const held = await store.read()
  assert.equal(held.budgetReservations[runId].status, 'interrupted')
  assert.equal(store.fundingTotals({ botId: 'bot-a' }).unknownToday, 1)
  const reserved = reservationSpending(held)
  assert.ok(reserved.reservedUsd > 0 && reserved.unknownReservations > 0, JSON.stringify(reserved))
  const resolved = await store.resolveUnknownPackage({ botId: 'bot-a', runId, packageId: 'cli', kind: 'waive', note: '中断执行，按零费用放行。' })
  assert.equal(resolved.holdSettled, true)
  const after = await store.read()
  assert.equal(Object.hasOwn(after.budgetReservations, runId), false)
  assert.equal(after.runs.find(item => item.id === runId).packages[0].ownerResolution.holdSettled, true)
  assert.equal(store.fundingTotals({ botId: 'bot-a' }).unknownToday, 0)
  assert.equal(reservationSpending(after).reservedUsd, 0)
  assert.equal(reservationSpending(after).unknownReservations, 0)
})

test('unknown receipt/native: the resolution survives a fresh connection and the commit digest chain', async t => {
  const dir = await mkdtemp(join(resolve('tmp/integration/unknown-receipt'), 'case-'))
  const file = join(dir, 'ledger.sqlite'), legacyFile = join(dir, 'state.json')
  await mkdir(dir, { recursive: true })
  await createRouterState({ file: legacyFile }).saveHealth(null)
  const store = await openSqliteRouterState({ Database, file, legacyFile, lockStaleMs: 1 })
  t.after(() => store.close())
  const at = Date.now()
  await store.update(state => { state.runs.push({ id: 'cli-run-2', kind: 'cli-task', createdAt: at - 2_000, status: 'interrupted', finishedAt: at - 1_000,
    cliExecution: { schemaVersion: 1, botId: 'bot-a', requestedModel: 'gpt-fixture', entrySha256: 'b'.repeat(64), entryVersion: '0.163.0', requestHash: 'c'.repeat(64), receiptId: 'receipt-2' },
    packages: [{ id: 'cli', provider: CLI_MODEL.provider, model: CLI_MODEL.model, toolId: 'codex', channel: 'official-cli', billing: 'api',
      ran: true, ok: false, status: 'interrupted', usage: { inputTokens: 11, outputTokens: 5 }, usageIncomplete: false, finishedAt: at - 1_000,
      pricingSnapshot: { input: 0.000001, output: 0.000002 }, costUsd: null, costSource: 'cli-actual-price-unreported' }], reviews: [] }) }, { retrySafe: true })
  await store.resolveUnknownPackage({ botId: 'bot-a', runId: 'cli-run-2', packageId: 'cli', kind: 'attest', costUsd: 0.5, note: '跨连接持久化。' })
  const status = store.status()
  await store.close()
  const reopened = await openSqliteRouterState({ Database, file, legacyFile, lockStaleMs: 1 })
  t.after(() => reopened.close())
  const run = (await reopened.read()).runs.find(item => item.id === 'cli-run-2')
  assert.equal(run.packages[0].costUsd, 0.5)
  assert.equal(run.packages[0].ownerResolution.note, '跨连接持久化。')
  assert.equal(reopened.fundingTotals({ botId: 'bot-a' }).unknownToday, 0)
  assert.equal(reopened.status().revision, status.revision)
})
