import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { apiPlanEstimate, formatUsageTokens, packageEstimateText, packageStatus, subscriptionEstimateText, subscriptionUsageSummary, subscriptionUsageText } from '../.dsh-plugin/client/insights-state.mjs'

const period = extra => ({ calls: 2, knownUsageCalls: 1, unknownUsageCalls: 1,
  inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: null, ...extra })
const ledger = extra => ({ spent: { today: 0.2, month: 2, subscriptionToday: 99, subscriptionMonth: 999,
  subscriptionRunsMonth: 2 }, budget: { dailyLimitUsd: 1, monthlyLimitUsd: 10 },
  reserved: { today: 0.4, month: 0.4 }, subscriptionUsage: { today: period(), month: period({ calls: 8 }), byRoute: [
    { provider: 'openai', toolId: 'codex', model: 'gpt-demo', today: period(), month: period({ calls: 8 }) },
  ] }, ...extra })
const settingsScope = { getSnapshot: () => ({ status: 'ready', writable: true,
  value: { dailyBudgetUsd: 1, monthlyBudgetUsd: 10 } }), subscribe: () => () => {}, mutate: async () => true }
const components = new Map()
async function render(name, props, entry = 'router-insights.jsx') {
  if (!components.has(entry)) components.set(entry, build({ entryPoints: [fileURLToPath(new URL(`../.dsh-plugin/client/${entry}`, import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], loader: { '.css': 'text' }, logLevel: 'silent' }).then(result => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
    return module.exports
  }))
  return renderToStaticMarkup(React.createElement((await components.get(entry))[name], props))
}

test('subscription view preserves reported zero, partial counters and unknown fields without price conversion', () => {
  assert.equal(formatUsageTokens(0), '0')
  assert.equal(formatUsageTokens(1200), '1,200')
  for (const missing of [null, undefined, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '1200']) assert.equal(formatUsageTokens(missing), '未报告')
  const text = subscriptionUsageText(period({ knownUsageCalls: 0, unknownUsageCalls: 2, inputTokens: null, outputTokens: 10 }))
  assert.match(text, /输入 未报告 \/ 输出 10 tokens/)
  assert.match(text, /缓存读取 0 \/ 写入 未报告/)
  assert.match(text, /2 次调用用量不完整或未知/)
  assert.doesNotMatch(text, /\$|USD|价格|剩余/)
})

test('missing or invalid Host subscription summaries remain unavailable instead of becoming a zero balance', () => {
  for (const value of [null, ledger({ subscriptionUsage: undefined }), ledger({ subscriptionUsage: { today: {}, month: {} } })]) {
    const summary = subscriptionUsageSummary(value)
    assert.equal(summary.available, false)
    assert.equal(summary.today, null)
    assert.equal(summary.month, null)
    assert.deepEqual(summary.byRoute, [])
  }
  assert.equal(subscriptionUsageSummary(ledger()).available, true)
})

test('subscription card displays period quantities and route groups, never reference dollars or quota percentages', async () => {
  const html = await render('SubscriptionUsageCard', { ledger: ledger() })
  assert.match(html, /今日订阅用量/)
  assert.match(html, /本月订阅用量/)
  assert.match(html, /2 次调用/)
  assert.match(html, /8 次调用/)
  assert.match(html, /1,200 \/ 输出 300 tokens/)
  assert.match(html, /缓存读取 0 \/ 写入 未报告 tokens/)
  assert.match(html, /openai/)
  assert.match(html, /codex · gpt-demo/)
  assert.match(html, /不代表订阅总额度或剩余额度/)
  assert.doesNotMatch(html, /\$99|\$999|订阅参考费用|role="progressbar"/)
})

test('legacy Host card explains that dollar references cannot restore token usage', async () => {
  const html = await render('SubscriptionUsageCard', { ledger: ledger({ subscriptionUsage: undefined }) })
  assert.match(html, /订阅用量摘要不可用/)
  assert.match(html, /不能从该金额还原 token 用量/)
  assert.doesNotMatch(html, /0 次调用|输入 0|输出 0|\$999/)
})

test('API budget card shows only API charges and holds even when old subscription-dollar fields exist', async () => {
  const html = await render('CostControlCard', { ledger: ledger(), settingsScope })
  assert.match(html, /今日 API 预算占用/)
  assert.match(html, /已发生 \$0\.2000 · 预占 \$0\.4000/)
  assert.match(html, /订阅调用单独统计用量/)
  assert.doesNotMatch(html, /订阅参考费用|\$99|\$999/)
})

test('subscription reservation rows describe usage reconciliation without a dollar estimate', async () => {
  const html = await render('CostControlCard', { ledger: ledger({ reservations: [{ id: 'sub-only', runId: 'sub-only',
    billing: 'subscription', status: 'interrupted', remainingEstimateUsd: 0 }] }), settingsScope })
  assert.match(html, /sub-only<\/code> · 订阅执行中断，用量待核对/)
  assert.doesNotMatch(html, /sub-only<\/code>[^<]*\$/)
})

test('split plan estimates keep missing API prices unknown and never borrow a subscription reference price', () => {
  const plan = { estimatedCost: 999, accounting: { apiEstimatedCostUsd: null, packages: [
    { id: 'sub', billing: 'subscription', apiEstimatedCostUsd: 0, estimatedUsage: { inputTokens: 100, outputTokens: null } },
    { id: 'api', billing: 'api', apiEstimatedCostUsd: null },
  ] } }
  assert.equal(apiPlanEstimate(plan), null)
  assert.equal(apiPlanEstimate({ ...plan, accounting: { ...plan.accounting, apiEstimatedCostUsd: 0 } }), 0)
  assert.match(subscriptionEstimateText(plan), /订阅工作包 1 个 · 预估输入 100 \/ 输出 待估算 tokens/)
  assert.equal(packageEstimateText(plan, { id: 'sub', estimatedCost: 999 }), '订阅预估输入 100 / 输出 待估算 tokens')
  assert.equal(packageEstimateText(plan, { id: 'api', estimatedCost: 999 }), 'API 预估费用 待核验')
})

test('local plan rendering separates subscription estimates from API prices and suppresses the old reference estimate', async () => {
  const plan = { selected: { provider: 'openai', model: 'gpt-fixture' }, estimatedCost: 999,
    mode: 'single', preset: 'balanced', complexity: { band: 'simple', value: 0.2 }, optimization: {},
    accounting: { apiEstimatedCostUsd: 0, packages: [{ id: 'sub', billing: 'subscription', apiEstimatedCostUsd: 0,
      estimatedUsage: { inputTokens: 100, outputTokens: 20 } }] },
    team: { workPackages: [{ id: 'sub', name: '订阅工作包', recommendedProvider: 'openai', recommendedModel: 'gpt-fixture',
      dependsOn: [], estimatedCost: 999, verificationChecklist: [] }] } }
  const html = await render('PlanResults', { plan }, 'router-main.jsx')
  assert.match(html, /API 预估费用/)
  assert.match(html, /\$0\.0000/)
  assert.match(html, /订阅工作包 1 个 · 预估输入 100 \/ 输出 20 tokens/)
  assert.match(html, /订阅预估输入 100 \/ 输出 20 tokens/)
  assert.doesNotMatch(html, /\$999/)
  const unverified = await render('PlanResults', { plan: { ...plan, accounting: undefined } }, 'router-main.jsx')
  assert.match(unverified, /以执行预览为准/)
  assert.doesNotMatch(unverified, /\$999/)
})

const run = packages => ({ id: 'split', kind: 'assign', status: 'completed', createdAt: Date.now(), task: 'offline fixture',
  preset: 'balanced', packages, reviews: [], decision: { estimatedCost: 99 } })
const item = extra => ({ id: 'a', name: '第一步', provider: 'openai', model: 'gpt-fixture',
  status: 'succeeded', ok: true, ran: true, dependsOn: [], answer: 'saved fixture', finishedAt: Date.now(), ...extra })

test('subscription history nodes and run totals show observed tokens without API-equivalent prices', async () => {
  const current = run([item({ billing: 'subscription', channel: 'official-cli', toolId: 'codex',
    estimatedCost: 99, referenceCostUsd: 999, usage: { inputTokens: 100, outputTokens: 40 } })])
  const html = await render('RunHistoryCard', { ledger: ledger({ runs: [current] }), routes: [] })
  assert.match(html, /订阅用量单独统计 · 不占 API 预算/)
  assert.match(html, /输入 100 \/ 输出 40 tokens/)
  assert.doesNotMatch(html, /\$99|\$999|订阅参考费用/)
  assert.equal(packageStatus({ billing: 'subscription', channel: 'harness-llm', status: 'succeeded' }).label, '订阅调用完成')
  assert.equal(packageStatus({ billing: 'subscription', status: 'interrupted' }).label, '执行中断，用量待核对')
})

test('a mixed subscription-to-API history node displays both ledgers without combining their units', async () => {
  const current = run([item({ billing: 'api', channel: 'harness-llm', costUsd: 0.5, estimatedCost: 0.6,
    subscriptionAttempts: [{ provider: 'openai', model: 'gpt-fixture', toolId: 'codex', ran: true,
      finishedAt: Date.now(), usage: { inputTokens: 100, outputTokens: 40 } }] })])
  const html = await render('RunHistoryCard', { ledger: ledger({ runs: [current] }), routes: [] })
  assert.match(html, /API 预估 \$0\.6000 · 实际 \$0\.5000/)
  assert.match(html, /订阅调用 1 次 · 已报告输入 100 \/ 输出 40 tokens/)
  assert.doesNotMatch(html, /订阅参考费用|\$999/)
})
