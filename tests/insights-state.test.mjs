import test from 'node:test'
import assert from 'node:assert/strict'
import {
  packageStatus, dagLayers, healthSummary, versionLine, UNTESTED_VERSION_NOTE, budgetMeter, planBudget, biasForRoute, unwrapRemote, formatUsd,
  priorAttemptTotals, runTotals,
} from '../.dsh-plugin/client/insights-state.mjs'
import { createWorkspacePlan } from '../.dsh-plugin/client/catalog.mjs'
import { archiveSpending, mergeRerun, spending } from '../.dsh-plugin/shared/run-ledger.mjs'

test('dagLayers orders packages by dependency depth and tolerates cycles and unknown ids', () => {
  const layers = dagLayers([
    { id: 'c', dependsOn: ['a', 'b'] },
    { id: 'a' },
    { id: 'b', dependsOn: ['a'] },
    { id: 'x', dependsOn: ['missing'] },
    { id: 'p', dependsOn: ['q'] },
    { id: 'q', dependsOn: ['p'] },
  ])
  const ids = layers.map(layer => layer.map(item => item.id).sort())
  assert.deepEqual(ids[0].filter(id => ['a', 'x'].includes(id)), ['a', 'x'])
  assert.ok(ids[1].includes('b'))
  assert.ok(ids[2].includes('c'))
  assert.equal(layers.flat().length, 6)
  assert.deepEqual(dagLayers(null), [])
})

test('packageStatus distinguishes CLI, API and fallback results', () => {
  assert.equal(packageStatus({ status: 'succeeded', channel: 'official-cli' }).tone, 'ok')
  assert.equal(packageStatus({ status: 'succeeded', channel: 'harness-llm' }).label, 'API 完成')
  assert.equal(packageStatus({ status: 'fallback' }).tone, 'warn')
  assert.equal(packageStatus({ status: 'weird' }).label, '待执行')
})

test('healthSummary counts installed, ready, logged-out tools and available updates', () => {
  const summary = healthSummary([
    { installed: true, login: { state: 'logged-in' }, versionStatus: 'latest' },
    { installed: true, login: { state: 'logged-out' }, versionStatus: 'update-available' },
    { installed: true, login: { state: 'unknown' } },
    { installed: false, login: { state: 'logged-out' } },
  ])
  assert.deepEqual(summary, { total: 4, installed: 3, ready: 1, loggedOut: 1, unknown: 1, updates: 1 })
})

test('versionLine shows the installed version and, when known, the latest one', () => {
  assert.equal(versionLine({ installed: false }), '')
  assert.equal(versionLine({ installed: true, version: '0.157.1', latestVersion: '0.160.0', versionStatus: 'update-available' }),
    '已安装 0.157.1 · 最新 0.160.0（有新版本，可在下方更新）')
  assert.equal(versionLine({ installed: true, version: '0.160.0', latestVersion: '0.160.0', versionStatus: 'latest' }), '已安装 0.160.0 · 已是最新版')
  assert.equal(versionLine({ installed: true, version: '3.14.4', latestVersion: null, versionStatus: 'unknown' }), '已安装 3.14.4 · 最新版本未知')
  assert.match(UNTESTED_VERSION_NOTE, /未经插件测试/)
})

test('budgetMeter and planBudget reflect configured limits', () => {
  assert.equal(budgetMeter(1, 0).limited, false)
  const meter = budgetMeter(3, 2)
  assert.equal(meter.over, true)
  assert.equal(meter.share, 1)
  assert.equal(formatUsd(0.5), '$0.5000')
  assert.equal(planBudget(null, 1), null)
  const check = planBudget({ spent: { today: 0.9, month: 0.9 }, budget: { dailyLimitUsd: 1, monthlyLimitUsd: 0 } }, 0.2)
  assert.equal(check.exceeded, 'daily')
})

test('unwrapRemote unwraps client and Host envelopes and surfaces errors', () => {
  assert.deepEqual(unwrapRemote({ ok: true, value: { ok: true, value: { a: 1 } } }), { a: 1 })
  assert.equal(unwrapRemote({ ok: true, value: 5 }), 5)
  assert.throws(() => unwrapRemote({ ok: true, value: { ok: false, error: '坏了' } }, 'x'), /坏了/)
  assert.throws(() => unwrapRemote({ ok: false, error: { message: '' } }, '默认错误'), /默认错误/)
})

test('workspace plan applies learned quality biases from ratings', () => {
  const catalog = { routableProviders: ['p'], groups: [{ id: 'p', models: [{ id: 'cheap' }, { id: 'strong' }] }] }
  const key = 'p\u0000cheap'
  assert.equal(biasForRoute({ biases: { [key]: 0.03 } }, { provider: 'p', model: 'cheap' }), 0.03)
  assert.equal(biasForRoute(null, { provider: 'p', model: 'cheap' }), 0)
  const plain = createWorkspacePlan('写一个函数', catalog)
  const biased = createWorkspacePlan('写一个函数', catalog, { qualityBiases: { [key]: 0.04 } })
  const quality = (plan, model) => plan.availableRoutes.find(route => route.model === model)?.qualityBias ?? 0
  assert.equal(quality(plain, 'cheap'), 0)
  assert.equal(quality(biased, 'cheap'), 0.04)
})

test('run totals count previous retry attempts once and agree with the monthly budget ledger', () => {
  const at = new Date(2026, 9, 3, 12).getTime()
  const previousDay = new Date(2026, 9, 2, 12).getTime()
  const run = { createdAt: previousDay, packages: [
    { id: 'api', name: 'API', ran: true, billing: 'api', costUsd: 1.5, finishedAt: previousDay },
    { id: 'subscription', name: 'Subscription', ran: true, billing: 'subscription', referenceCostUsd: 2, finishedAt: previousDay },
    { id: 'unknown', name: 'Unknown', ran: true, billing: 'api', costUsd: null, finishedAt: previousDay },
  ], reviews: [{ ran: true, billing: 'api', costUsd: 0.5, finishedAt: at }] }
  mergeRerun(run, { status: 'completed', packages: [
    { id: 'api', ok: true, channel: 'harness-llm', billing: 'api', reportedCostUsd: 3, answer: 'done' },
    { id: 'subscription', ok: true, channel: 'harness-llm', billing: 'api', reportedCostUsd: 4, answer: 'done' },
    { id: 'unknown', ok: true, channel: 'official-cli', billing: 'subscription', answer: 'done' },
  ] }, { rerunIds: ['api', 'subscription', 'unknown'], finishedAt: at })
  assert.deepEqual(priorAttemptTotals(run), { budgetUsd: 1.5, referenceUsd: 2, unknownCalls: 1, subscriptionRuns: 1 })
  assert.deepEqual(runTotals(run), { budgetUsd: 9, referenceUsd: 2, subscription: true })
  const spent = spending([run], at)
  assert.equal(runTotals(run).budgetUsd, spent.month)
  assert.equal(runTotals(run).referenceUsd, spent.subscriptionMonth)
  const pruned = spending([], at, archiveSpending([run]))
  assert.deepEqual(pruned, spent, 'the same retry totals survive history eviction')
})

test('previous attempts keep subscription status even when the latest call uses an API key', () => {
  const at = new Date(2026, 9, 3, 12).getTime()
  const run = {
    packages: [{ ran: true, billing: 'api', costUsd: 1 }], reviews: [],
    priorAttemptSpending: archiveSpending([{ createdAt: at,
      packages: [{ ran: true, billing: 'subscription', referenceCostUsd: null }] }]),
  }
  assert.deepEqual(runTotals(run), { budgetUsd: 1, referenceUsd: 0, subscription: true })
  assert.deepEqual(priorAttemptTotals(null), { budgetUsd: 0, referenceUsd: 0, unknownCalls: 0, subscriptionRuns: 0 })
  assert.deepEqual(runTotals(null), { budgetUsd: 0, referenceUsd: 0, subscription: false })
})
