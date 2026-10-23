import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { budgetOccupancyMeter, packageStatus, planBudget, rerunConfirmations, rerunSupport, reservationSummary, RUN_STATUS_LABEL } from '../.dsh-plugin/client/insights-state.mjs'

const ledger = (overrides = {}) => ({ spent: { today: 0.2, month: 2 },
  budget: { dailyLimitUsd: 1, monthlyLimitUsd: 10, remainingUsd: 0.2 },
  reserved: { today: 0.6, month: 0.6, unknownToday: 0, unknownMonth: 0, activeCount: 1, interruptedCount: 0 },
  reservations: [{ id: 'hold-one', runId: 'run-one', status: 'active', remainingEstimateUsd: 0.6, unknown: false }], ...overrides })
const run = (overrides = {}) => ({ id: 'run-one', kind: 'assign', status: 'partial', createdAt: 1_700_000_000_000,
  preset: 'balanced', task: 'fixture task', packages: [{ id: 'one', name: '第一步', status: 'failed', provider: 'p', model: 'm',
    estimatedCost: 0.3, costUsd: null, ran: true, ok: false, dependsOn: [] }], ...overrides })

let components
async function render(name, props) {
  components ??= build({ entryPoints: [fileURLToPath(new URL('../.dsh-plugin/client/router-insights.jsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' }).then(result => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
    return module.exports
  })
  return renderToStaticMarkup(React.createElement((await components)[name], props))
}
const settingsScope = { getSnapshot: () => ({ status: 'ready', writable: true, value: { dailyBudgetUsd: 1, monthlyBudgetUsd: 10 } }),
  subscribe: () => () => {}, mutate: async () => true }

test('local plan and retry budget checks include concurrent reservations without mutating actual spending', () => {
  const value = ledger()
  const before = JSON.stringify(value)
  const check = planBudget(value, 0.3)
  assert.equal(check.exceeded, 'daily')
  assert.ok(Math.abs(check.remainingUsd - 0.2) < 1e-10)
  assert.match(check.message, /已发生 \$0\.2000，预占 \$0\.6000/)
  const reasons = rerunConfirmations({ run: run({ id: 'another-run' }), item: { estimatedCost: 0.3 }, ledger: value })
  assert.deepEqual(reasons.map(item => item.code), ['over-budget'])
  assert.match(reasons[0].text, /预占 \$0\.6000/)
  assert.equal(JSON.stringify(value), before)
})

test('reservation meters show separate actual and held amounts and retain old ledger compatibility', () => {
  const meter = budgetOccupancyMeter(0.2, 1, 0.6)
  assert.equal(meter.share, 0.8)
  assert.equal(meter.over, false)
  assert.equal(meter.text, '已发生 $0.2000 · 预占 $0.6000 / 上限 $1.0000')
  const legacy = ledger({ reserved: undefined, reservations: undefined })
  assert.deepEqual(reservationSummary(legacy), { today: 0, month: 0, unknownToday: 0, unknownMonth: 0, activeCount: 0, interruptedCount: 0 })
  assert.equal(planBudget(legacy, 0.3).exceeded, null)
  assert.equal(budgetOccupancyMeter(0.2, 0).text, '已发生 $0.2000 · 预占 $0.0000（未设上限）')
})

test('running, interrupted and unresolved reservation runs cannot be directly rerun or reassigned', () => {
  for (const current of [run({ status: 'running' }), run({ status: 'interrupted' })]) {
    assert.equal(rerunSupport(current).supported, false)
    assert.equal(rerunSupport(current).reassign, false)
  }
  for (const status of ['active', 'interrupted']) {
    const value = ledger({ reservations: [{ runId: 'run-one', status }] })
    assert.equal(rerunSupport(run(), value).supported, false)
    assert.deepEqual(rerunConfirmations({ run: run(), item: { estimatedCost: 2 }, ledger: value }), [], 'no payment confirmation can authorize an unresolved old task')
    assert.equal(rerunSupport(run({ id: 'unrelated' }), value).supported, true)
  }
  assert.equal(rerunSupport(run(), ledger({ reservations: [{ runId: 'run-one', status: 'settled' }] })).supported, true)
  assert.equal(packageStatus({ status: 'running' }).label, '执行中')
  assert.equal(packageStatus({ status: 'interrupted' }).label, '执行中断，费用待核对')
  assert.equal(RUN_STATUS_LABEL.interrupted, '执行中断，费用待核对')
})

test('budget card distinguishes estimated holds, unknown amounts and interrupted reconciliation evidence', async () => {
  const value = ledger({ reserved: { today: 0.6, month: 0.6, unknownToday: 1, unknownMonth: 1, activeCount: 0, interruptedCount: 1 },
    reservations: [{ id: 'hold-one', runId: 'run-one', status: 'interrupted', remainingEstimateUsd: null, unknown: true, updatedAt: 1_700_000_000_000 }] })
  const html = await render('CostControlCard', { ledger: value, settingsScope })
  assert.match(html, /已发生 \$0\.2000 · 预占 \$0\.6000/)
  assert.match(html, /预占是尚未结算的费用估算，不是实际账单/)
  assert.match(html, /待核对中断 1 项/)
  assert.match(html, /不能视为零费用/)
  assert.match(html, /保留原始状态文件和已保存结果/)
  assert.match(html, /当前界面不支持手动结算或自动付费恢复/)
  assert.match(html, /run-one/)
  assert.match(html, /剩余预占 金额未知/)
})

test('history suppresses direct and reassigned retry for an interrupted run with saved results', async () => {
  const current = run({ status: 'interrupted', packages: [{ ...run().packages[0], status: 'interrupted', answer: '已保存的部分结果' }] })
  const html = await render('RunHistoryCard', { ledger: { ...ledger(), runs: [current] }, routes: [{ provider: 'other', model: 'strong' }] })
  assert.match(html, /执行中断，费用待核对/)
  assert.match(html, /先核对旧任务与厂商账单/)
  assert.match(html, /已保存的部分结果/)
  assert.doesNotMatch(html, />重跑此步<|>改派并重跑<|>在新工作区续跑</)
})

test('paused subscription recovery buttons are disabled while an unresolved hold remains', async () => {
  const current = run({ packages: [{ ...run().packages[0], status: 'paused', pause: { reason: 'fixture subscription failure' } }] })
  const html = await render('RunHistoryCard', { ledger: { ...ledger(), runs: [current] }, routes: [] })
  for (const label of ['改用 API 重试', '重试订阅', '取消']) {
    assert.match(html, new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`))
  }
  assert.match(html, /任务仍在执行或保留预算预占/)
})

test('an unresolved reservation remains visible even when the saved run already looks completed', async () => {
  const current = run({ status: 'completed', packages: [{ ...run().packages[0], status: 'succeeded', ok: true, costUsd: 0.2 }] })
  const value = { ...ledger(), reservations: [{ id: 'unsettled', runId: current.id, status: 'interrupted' }], runs: [current] }
  const html = await render('RunHistoryCard', { ledger: value, routes: [{ provider: 'other', model: 'strong' }] })
  assert.match(html, /执行中断，费用待核对，不能直接重跑/)
  assert.doesNotMatch(html, />改派并重跑</)
})

test('legacy run history keeps retry controls and budget cards render without reservation fields', async () => {
  const value = ledger({ reserved: undefined, reservations: undefined, runs: [run()] })
  const html = await render('RunHistoryCard', { ledger: value, routes: [{ provider: 'other', model: 'strong' }] })
  assert.match(html, />重跑此步</)
  assert.match(html, />改派并重跑</)
  const card = await render('CostControlCard', { ledger: value, settingsScope })
  assert.match(card, /预占 \$0\.0000/)
  assert.doesNotMatch(card, /NaN|undefined|有中断任务尚未核对/)
})
