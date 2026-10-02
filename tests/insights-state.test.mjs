import test from 'node:test'
import assert from 'node:assert/strict'
import {
  packageStatus, dagLayers, healthSummary, budgetMeter, planBudget, biasForRoute, unwrapRemote, formatUsd,
} from '../.dsh-plugin/client/insights-state.mjs'
import { createWorkspacePlan } from '../.dsh-plugin/client/catalog.mjs'

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

test('healthSummary counts installed, ready, logged-out and outdated tools', () => {
  const summary = healthSummary([
    { installed: true, login: { state: 'logged-in' }, versionStatus: 'ok' },
    { installed: true, login: { state: 'logged-out' }, versionStatus: 'older' },
    { installed: true, login: { state: 'unknown' } },
    { installed: false, login: { state: 'logged-out' } },
  ])
  assert.deepEqual(summary, { total: 4, installed: 3, ready: 1, loggedOut: 1, unknown: 1, older: 1 })
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
