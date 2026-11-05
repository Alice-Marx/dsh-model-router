import test from 'node:test'
import assert from 'node:assert/strict'
import { routeTaskToBot, dispatchRoutedTask, assertPlanAccepted, routedOutcome, routedEffectClass, workerMachineGrant, workerGrantFact, buildRoutedPlan } from '../packages/orchestration/src/bot-routing-dispatch.mjs'

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
    bindWorker: binding => { bound.push(binding); return { confirmed: true, applied: true } },
  })
  assert.equal(result.botId, 'worker')
  assert.equal(result.binding.mode, 'read-only')
  assert.equal(result.binding.tools.includes('shell_exec'), false)
  assert.equal(bound.length, 1)
})

test('dispatch: auto-grant off verifies an existing binding without allowing an expansion', async () => {
  const bound = []
  const result = await routeTaskToBot({
    routing: { enabled: true, preset: 'balanced', autoGrant: { machineTools: false } }, mainBotIds: ['main'],
    task: { text: '读日志', requiresMachine: true, machineId: 'm1' },
    candidatesFor: () => [worker()], bindWorker: (_binding, context) => { assert.equal(context.grantAllowed, false); return { confirmed: true, applied: false } },
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
  // A pin is not a bypass: the same hard requirements apply, so a disabled or unreachable Bot is
  // refused with the reason the router would have given.
  await assert.rejects(routeTaskToBot({ routing: on, task: { text: 'x' }, candidatesFor: () => [worker({ enabled: false })], pinnedBotId: 'worker' }), /BOT_ROUTING_PINNED_INELIGIBLE:worker:BOT_DISABLED/)
  await assert.rejects(routeTaskToBot({ routing: on, task: { text: 'x', requiresMachine: true }, candidatesFor: () => [worker({ machineOnline: false })], pinnedBotId: 'worker' }), /BOT_ROUTING_PINNED_INELIGIBLE:worker:BOT_ROUTING_WORKER_MACHINE_OFFLINE/)
  await assert.rejects(routeTaskToBot({ routing: on, task: { text: 'x', requiredTools: ['shell_exec'] }, candidatesFor: () => [worker()], pinnedBotId: 'worker' }), /BOT_ROUTING_PINNED_INELIGIBLE:worker:BOT_MISSING_TOOL:shell_exec/)
})

test('dispatch: a pinned machine task grants the worker like an automatic pick', async () => {
  const bound = []
  const result = await routeTaskToBot({
    routing: on, task: { text: '读日志', requiresMachine: true, machineId: 'm1' },
    candidatesFor: () => [worker()], bindWorker: binding => { bound.push(binding); return { confirmed: true, applied: true } }, pinnedBotId: 'worker',
  })
  assert.equal(result.binding.machineId, 'm1')
  assert.equal(result.granted, true)
  assert.equal(bound.length, 1)
})

test('dispatch: the machine ceiling comes from the grant for the machine the task names', async () => {
  const many = worker({ machineGrants: [
    { machineId: 'm1', ceiling: ['machine_ping', 'fs_read'] },
    { machineId: 'm2', ceiling: ['machine_ping', 'fs_read', 'fs_write', 'shell_exec'] },
  ] })
  assert.deepEqual(workerMachineGrant(many, { requiresMachine: true, machineId: 'm2' }).ceiling, ['machine_ping', 'fs_read', 'fs_write', 'shell_exec'])
  assert.equal(workerMachineGrant(many, { requiresMachine: true, machineId: 'm9' }).refused, 'BOT_ROUTING_WORKER_MACHINE_NOT_GRANTED:m9')
  assert.equal(workerMachineGrant(many, { requiresMachine: true }).machineId, 'm1')
  assert.equal(workerMachineGrant(many, { requiresMachine: false }), null)
  // The scored fact is the machine the task is about, not the Bot's first grant.
  const offlineSecond = worker({ machineGrants: [
    { machineId: 'm1', ceiling: ['machine_ping', 'fs_read'] },
    { machineId: 'm2', ceiling: ['machine_ping', 'fs_read'] },
  ], machineOnlineFor: id => id === 'm2' })
  const picked = await routeTaskToBot({ routing: on, task: { text: '读', requiresMachine: true, machineId: 'm2' }, candidatesFor: () => [offlineSecond], bindWorker: () => ({ confirmed: true, applied: true }) })
  assert.equal(picked.botId, 'worker')
})

test('dispatch: the effect class follows the work, never the grant toggle', () => {
  assert.equal(routedEffectClass({ needs: {} }), 'read')
  assert.equal(routedEffectClass({ needs: { write: true } }), 'workspace-write')
  assert.equal(routedEffectClass({ needs: { desktop: true } }), 'workspace-write')
  assert.equal(routedEffectClass({ needs: { write: true }, effectClass: 'read' }), 'workspace-write')
  const binding = { machineId: 'm1', botId: 'worker', tools: ['fs_read'], mode: 'read-only' }
  assert.deepEqual(workerGrantFact(binding, true), { required: true, applied: false, autoGrant: true, reason: null })
  assert.equal(workerGrantFact(binding, true, true).applied, true)
  assert.deepEqual(workerGrantFact(binding, false), { required: true, applied: false, autoGrant: false, reason: 'BOT_ROUTING_AUTO_GRANT_OFF' })
  assert.equal(workerGrantFact(null, true), null)
})

test('dispatch: a plan the journal did not accept is a refusal, not a submitted task', async () => {
  const accepted = { planId: 'plan-1', state: 'ready', packages: [{ id: 'p1', targetBotId: 'worker', taskId: 'task-1', packageId: 'package-1', attemptId: 'attempt-1', operationId: 'operation-1', state: 'ready', result: null }] }
  assert.deepEqual(assertPlanAccepted(accepted).packages[0].taskId, 'task-1')
  assert.throws(() => assertPlanAccepted({ planId: 'plan-1', state: 'ready', packages: [] }), /ROUTING_PLAN_NOT_ACCEPTED/)
  assert.throws(() => assertPlanAccepted({ planId: 'plan-1', state: 'ready', packages: [{ id: 'p1', targetBotId: 'w', taskId: '', attemptId: '', state: 'ready' }] }), /ROUTING_PLAN_NOT_ACCEPTED/)
  assert.throws(() => assertPlanAccepted({ planId: 'plan-1', state: 'ready', packages: [{ id: 'p1', targetBotId: 'w', taskId: 't', attemptId: 'a', operationId: 'o', state: 'blocked' }] }), /ROUTING_TASK_NOT_ACCEPTED:t:blocked/)
  assert.equal(routedOutcome(accepted).outcome, 'running')
  assert.equal(routedOutcome({ packages: [{ state: 'succeeded' }, { state: 'succeeded' }] }).outcome, 'succeeded')
  assert.equal(routedOutcome({ packages: [{ state: 'failed', result: { summary: { code: 'MOCK_REFUSED' } } }] }).reason, 'MOCK_REFUSED')
})

test('dispatch: a machine task is not submitted while its grant was never committed', async () => {
  let submitted = 0
  const task = { text: '读日志', requiresMachine: true, machineId: 'm1' }
  await assert.rejects(dispatchRoutedTask({
    routing: { enabled: true, preset: 'balanced', autoGrant: { machineTools: false } },
    task, candidatesFor: () => [worker()], bindWorker: (_binding, context) => { assert.equal(context.grantAllowed, false); throw new Error('BOT_ROUTING_WORKER_GRANT_REQUIRED') },
    submitPlan: () => { submitted += 1; return { planId: 'p', packages: [] } },
    subjectFor: () => ({}),
  }), /BOT_ROUTING_WORKER_GRANT_REQUIRED/)
  assert.equal(submitted, 0)
  await assert.rejects(dispatchRoutedTask({ routing: on, task, candidatesFor: () => [worker()] }), /ROUTING_REQUIRES_SUBMIT/)
  await assert.rejects(dispatchRoutedTask({ routing: on, task: { text: 'x' }, candidatesFor: () => [worker()], submitPlan: () => ({}) }), /ROUTING_REQUIRES_SUBJECT/)
})

test('dispatch: a routed task is submitted by the Bot that asked and proves it was accepted', async () => {
  const seen = []
  const report = await dispatchRoutedTask({
    routing: on, requesterBotId: 'main', task: { text: '整理日志', acceptance: ['核对'] },
    candidatesFor: () => [worker()], newTaskId: () => 'task-42',
    subjectFor: botId => ({ botId }),
    submitPlan: (subject, request) => {
      seen.push({ botId: subject.botId, request })
      return { planId: request.plan.taskId, ownerBotId: subject.botId, state: 'ready',
        packages: [{ id: 'p1', targetBotId: 'worker', taskId: 'task-42', packageId: 'package-42', attemptId: 'attempt-42', operationId: 'operation-42', state: 'ready', result: null }] }
    },
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].botId, 'main')
  assert.equal(seen[0].request.plan.origin.botId, 'main')
  assert.equal(seen[0].request.plan.packages[0].targetBotId, 'worker')
  assert.deepEqual(seen[0].request.plan.packages[0].acceptance, ['核对'])
  assert.equal(report.botId, 'worker')
  assert.equal(report.originBotId, 'main')
  assert.equal(report.accepted, true)
  assert.equal(report.settled, false)
  assert.equal(report.outcome, 'running')
  assert.equal(report.packages[0].taskId, 'task-42')
  assert.equal(report.packages[0].operationId, 'operation-42')
})

test('dispatch: a settled task delivers its outcome, and the origin Bot owns the plan', async () => {
  const delivered = []
  const report = await dispatchRoutedTask({
    routing: on, requesterBotId: 'main', task: { text: '整理日志' }, newTaskId: () => 'task-7',
    candidatesFor: () => [worker()], subjectFor: botId => ({ botId }),
    submitPlan: () => ({ planId: 'task-7', ownerBotId: 'main', state: 'running', packages: [{ id: 'p1', targetBotId: 'worker', taskId: 'task-7', attemptId: 'a', operationId: 'o', state: 'running', result: null }] }),
    settle: () => ({ planId: 'task-7', ownerBotId: 'main', state: 'succeeded', packages: [{ id: 'p1', targetBotId: 'worker', taskId: 'task-7', attemptId: 'a', operationId: 'o', state: 'succeeded', result: { summary: { ranOnBotId: 'worker' } } }] }),
    deliver: value => { delivered.push(value) },
  })
  assert.equal(report.settled, true)
  assert.equal(report.outcome, 'succeeded')
  assert.equal(report.packages[0].result.summary.ranOnBotId, 'worker')
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].planId, 'task-7')
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
  // The origin is the Bot that asked, because the journal refuses a plan whose origin is not its
  // submitter; the target Bot is authorised separately by the Host's own target policy.
  const origin = buildRoutedPlan({ decision: { chosen: { botId: 'worker' } }, text: '读', taskId: 't', requesterBotId: 'main', sessionId: 'session-1' })
  assert.equal(origin.origin.botId, 'main')
  assert.equal(origin.origin.sessionId, 'session-1')
  assert.equal(origin.packages[0].targetBotId, 'worker')
  assert.equal(buildRoutedPlan({ decision: { chosen: { botId: 'w' } }, text: 'x', taskId: 't' }).origin.botId, 'w')
})
