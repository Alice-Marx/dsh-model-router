import test from 'node:test'
import assert from 'node:assert/strict'
import { routeTaskToBot } from '../packages/orchestration/src/bot-routing-dispatch.mjs'

const worker = (over = {}) => ({ botId: 'worker', enabled: true, model: { provider: 'p', model: 'm' }, quality: 0.6, pricePerMTokUsd: 1, tools: [], machineOnline: true, load: 0, capabilities: [], machine: { machineId: 'm1', ceiling: ['machine_ping', 'fs_read', 'fs_write', 'shell_exec', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read', 'desktop_screenshot'] }, ...over })
const on = { enabled: true, preset: 'balanced' }

test('dispatch: routing off refuses before any candidate is read', async () => {
  let read = false
  await assert.rejects(routeTaskToBot({ routing: { enabled: false }, task: { text: 'x' }, candidatesFor: () => { read = true; return [] } }), /BOT_ROUTING_DISABLED/)
  assert.equal(read, false)
})

test('dispatch: the Main Bot is never re-granted or narrowed', async () => {
  const result = await routeTaskToBot({
    routing: on, mainBotIds: ['main'], requesterBotId: 'main',
    task: { text: '整理文档' },
    candidatesFor: () => [worker({ botId: 'main', pricePerMTokUsd: 0.1, quality: 0.9 })],
  })
  assert.equal(result.botId, 'main')
  assert.equal(result.mainBot, true)
  assert.equal(result.binding, null)
})

test('dispatch: a machine task grants the worker exactly what it touches', async () => {
  const bound = []
  const result = await routeTaskToBot({
    routing: on, mainBotIds: ['main'], requesterBotId: 'main',
    task: { text: '把日志读出来', requiresMachine: true, machineId: 'm1' },
    candidatesFor: () => [worker()],
    bindWorker: binding => { bound.push(binding) },
  })
  assert.equal(result.botId, 'worker')
  assert.equal(result.binding.mode, 'read-only')
  assert.equal(result.binding.tools.includes('shell_exec'), false)
  assert.equal(bound.length, 1)
})

test('dispatch: auto-grant off still returns the binding, but the Host is not asked to apply it', async () => {
  const bound = []
  const result = await routeTaskToBot({
    routing: { enabled: true, preset: 'balanced', autoGrant: { machineTools: false } }, mainBotIds: ['main'],
    task: { text: '读日志', requiresMachine: true, machineId: 'm1' },
    candidatesFor: () => [worker()], bindWorker: binding => { bound.push(binding) },
  })
  assert.equal(bound.length, 0)
  assert.equal(result.granted, false)
  assert.equal(result.binding.mode, 'read-only')
})

test('dispatch: a pinned Bot is honoured, and an ineligible pin names why', async () => {
  const ok = await routeTaskToBot({ routing: on, task: { text: 'x' }, candidatesFor: () => [worker(), worker({ botId: 'second', pricePerMTokUsd: 9 })], pinnedBotId: 'second' })
  assert.equal(ok.botId, 'second')
  assert.equal(ok.pinned, true)
  await assert.rejects(routeTaskToBot({ routing: on, task: { text: 'x' }, candidatesFor: () => [worker()], pinnedBotId: 'ghost' }), /BOT_ROUTING_PINNED_INELIGIBLE:ghost/)
})

test('dispatch: no eligible Bot names the refusals instead of picking one', async () => {
  await assert.rejects(routeTaskToBot({ routing: on, task: { text: 'x' }, candidatesFor: () => [worker({ enabled: false })] }), /BOT_ROUTING_NO_ELIGIBLE:BOT_DISABLED/)
  await assert.rejects(routeTaskToBot({ routing: on, task: { text: '  ' }, candidatesFor: () => [worker()] }), /ROUTING_REQUIRES_TASK/)
})

test('dispatch: a decision becomes one plan package aimed at the chosen Bot', async () => {
  const { buildRoutedPlan } = await import('../packages/orchestration/src/bot-routing-dispatch.mjs')
  const plan = buildRoutedPlan({ decision: { chosen: { botId: 'worker' } }, text: '  整理日志  ', taskId: 'task-1', requesterBotId: 'main' })
  assert.equal(plan.taskId, 'task-1')
  assert.equal(plan.origin.botId, 'main')
  assert.equal(plan.packages.length, 1)
  assert.equal(plan.packages[0].targetBotId, 'worker')
  assert.equal(plan.packages[0].objective, '整理日志')
  assert.deepEqual(plan.packages[0].acceptance, [])
  assert.equal(plan.packages[0].effectClass, 'read')
  assert.throws(() => buildRoutedPlan({ decision: null, text: 'x', taskId: 't' }), /ROUTING_DECISION_REQUIRED/)
  assert.throws(() => buildRoutedPlan({ decision: { chosen: { botId: 'w' } }, text: 'x', taskId: 't', effectClass: 'danger' }), /ROUTING_INVALID_EFFECT_CLASS/)
})
