import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { createTaskService } from '../packages/orchestration/src/task-service.mjs'
import { createBotRoutingService } from '../packages/orchestration/src/bot-routing-service.mjs'
import { registerBotRoutingTools } from '../packages/orchestration/src/bot-routing-tools.mjs'

/**
 * Routing end to end, against real local state.
 *
 * A real SQLite task journal, a real task service and a real runner do the work; the only fake is
 * the read backend, which stands in for a model call and records which Bot actually ran it. No paid
 * model, no network, no machine: the point is that a routed task reaches a worker, that worker runs
 * it, and the result — or the failure — comes back with durable identity attached.
 */

const TOOLS = ['task/submit', 'task/execute', 'task/read', 'task/cancel', 'task/retry', 'task/reconcile', 'mock/read', 'mock/write', 'mock/operation_status']
const MACHINE_CEILING = ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'shell_exec', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read']

const sleep_ = async check => {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    const value = await check()
    if (value) return value
    await sleep(10)
  }
  throw new Error('routed task did not settle')
}

async function fixture(t, { settings = {}, routing = { enabled: true, preset: 'balanced' }, failTask = '', mainBotIds = ['main'], submitPlan = null, deliver = null } = {}) {
  await mkdir(resolve('tmp/integration/routing-end-to-end'), { recursive: true })
  const dir = await mkdtemp(resolve('tmp/integration/routing-end-to-end/case-'))
  await mkdir(join(dir, 'writes'), { recursive: true })
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  for (const botId of ['main', 'worker', 'writer']) directory.register(botId, { tools: TOOLS, modelRoutes: [] })
  const agents = Object.fromEntries(['main', 'worker', 'writer'].map(botId => [botId, { id: `session-${botId}`, session: { id: `session-${botId}` } }]))
  for (const [botId, agent] of Object.entries(agents)) directory.bind(botId, agent)
  const committed = {
    main: { enabled: true, model: { provider: 'deepseek', model: 'chat' }, grant: { tools: [] }, machineGrants: [], capabilities: [], routing: null },
    worker: { enabled: true, model: { provider: 'step', model: 'step-3' }, grant: { tools: [] }, capabilities: [],
      machineGrants: [
        { machineId: 'm1', capabilities: MACHINE_CEILING },
        { machineId: 'm2', capabilities: ['machine_ping', 'fs_read', 'fs_write', 'shell_exec', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read'] },
      ] },
    writer: { enabled: true, model: { provider: 'step', model: 'step-3' }, grant: { tools: [] }, machineGrants: [], capabilities: [] },
    ...settings,
  }
  const bots = () => Object.keys(committed).map(id => ({ id, name: id, main: id === 'main' }))
  const settingsFor = botId => committed[botId] ?? null
  const machineHealth = machineId => (machineId === 'm1' || machineId === 'm2' ? { online: true } : { online: false })
  const priceFor = model => (model.model === 'chat' ? 2.5 : 1.2)
  const qualityFor = botId => (botId === 'main' ? 0.6 : 0.8)

  const runs = []
  const writes = []
  let taskSeq = 0
  const read = {
    id: 'mock-read', version: 'mock-read-v1', effect: 'read', machineId: 'local-host', workspaceId: 'local-workspace', location: 'local',
    capability: 'mock/read', retryCapability: 'mock/read',
    parse: input => ({ task: String(input?.task ?? '') }),
    run: async context => {
      runs.push({ ownerBotId: context.ownerBotId, objective: context.input.task, taskId: context.binding.taskId, attemptId: context.binding.attemptId, operationId: context.operationId })
      if (failTask !== '' && context.input.task.includes(failTask)) return { outcome: 'failed', summary: { code: 'MOCK_WORKER_REFUSED' } }
      // The worker answers from its own committed binding, which is what proves the routed work ran
      // on the Bot routing chose rather than on the Bot that asked.
      return { outcome: 'succeeded', summary: { code: null, ranOnBotId: context.ownerBotId, model: committed[context.ownerBotId]?.model ?? null } }
    },
  }
  // A workspace-write package needs a write backend; this one stands in for a remote file write with
  // no machine attached, so a routed write task can be executed and observed locally.
  const write = {
    id: 'mock-write', version: 'mock-write-v1', effect: 'workspace-write', machineId: 'local-host', workspaceId: 'local-workspace',
    location: 'remote', writeContract: 'scoped-remote-file-v1', capability: 'mock/write', retryCapability: 'mock/write', reconcileCapability: 'mock/operation_status',    parse: input => ({ task: String(input?.task ?? '') }),
    targetFor: () => ({ machineId: 'local-host', workspaceId: 'local-workspace', remoteMachineRevision: 1, remoteBindingRevision: 1 }),
    canObserve: () => true,
    reconcile: () => ({ outcome: 'unknown', reason: 'MOCK_RECONCILE' }),
    run: async context => {
      writes.push({ ownerBotId: context.ownerBotId, objective: context.input.task, taskId: context.binding.taskId })
      await writeFile(join(dir, 'writes', `${context.binding.taskId}.txt`), `${context.ownerBotId}:${context.input.task}`)
      return { outcome: 'succeeded', summary: { code: null, wroteOnBotId: context.ownerBotId } }
    },
  }

  const journal = openTaskJournal(Database, join(dir, 'tasks.sqlite'))
  const service = createTaskService({
    journal, authority, directory, backends: [read, write], concurrencyFor: () => 2, planTargetsFor: () => ['main', 'worker', 'writer'],
  })
  service.start()
  const subjectFor = botId => directory.forBot(botId)
  const bound = []
  const bindings = new Map()
  const botRouting = createBotRoutingService({
    bots, settingsFor, machineHealth, priceFor, qualityFor, routing, mainBotIds,
    submitPlan: submitPlan ?? ((subject, request, caller) => service.submitPlan(subject, request, caller)),
    subjectFor,
    bindWorker: (binding, context) => { if (!context.grantAllowed) throw new Error('BOT_ROUTING_WORKER_GRANT_REQUIRED'); bound.push(binding); bindings.set(`${binding.botId}/${binding.machineId}`, binding); return { confirmed: true, applied: true } },
    newTaskId: () => `task-${++taskSeq}`,
    settle: report => settle(report), deliver,
  })
  const settle = async report => sleep_(async () => {
    try {
      const plan = service.getPlan(subjectFor(report.originBotId), { planId: report.planId })
      return ['succeeded', 'failed', 'cancelled', 'blocked'].includes(plan.state) ? plan : null
    } catch { return null }
  })
  t.after(async () => { await service.close(); authority.dispose() })
  return { authority, directory, service, journal, dir, subjectFor, bots, settingsFor, botRouting, runs, writes, bound, bindings, settle, committed, agents }
}

test('routing end to end: a routed task reaches the worker, runs there, and its result comes back', async t => {
  const delivered = []
  const f = await fixture(t, { deliver: value => { delivered.push(value) } })
  const report = await f.botRouting.dispatch({
    text: '整理上周的发布记录', requesterBotId: 'main', requestKey: 'route-1',
    settle: f.settle, deliver: value => { delivered.push(value) },
  }, { kind: 'owner' })

  // Plan admission: the journal created a real package with durable identity.
  assert.equal(report.dispatched, true)
  assert.equal(report.accepted, true)
  assert.equal(report.botId, 'worker')
  assert.equal(report.originBotId, 'main')
  assert.equal(report.effectClass, 'read')
  assert.match(report.planId, /^route_/u)
  const item = report.packages[0]
  assert.equal(item.targetBotId, 'worker')
  assert.notEqual(item.taskId, '')
  assert.notEqual(item.attemptId, '')
  assert.notEqual(item.operationId, '')

  // Actual worker execution: the task is owned by the worker and the worker's own binding ran it.
  assert.equal(f.runs.length, 1)
  assert.equal(f.runs[0].ownerBotId, 'worker')
  assert.equal(f.runs[0].objective, '整理上周的发布记录')
  assert.equal(f.runs[0].taskId, item.taskId)
  const task = f.service.get(f.subjectFor('worker'), { taskId: item.taskId })
  assert.equal(task.ownerBotId, 'worker')
  assert.equal(task.attemptId, item.attemptId)
  assert.equal(task.state, 'succeeded')
  assert.equal(task.result.summary.ranOnBotId, 'worker')
  assert.deepEqual(task.result.summary.model, { provider: 'step', model: 'step-3' })

  // Result delivery: the report names the outcome and the requester receives it.
  assert.equal(report.settled, true)
  assert.equal(report.outcome, 'succeeded')
  assert.equal(report.packages[0].result.summary.ranOnBotId, 'worker')
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].planId, report.planId)
  // The plan is owned by the Bot that asked, not by the worker that ran it.
  assert.equal(f.service.getPlan(f.subjectFor('main'), { planId: report.planId }).ownerBotId, 'main')
})

test('routing end to end: a worker that refuses is reported as a failure, never as a submitted success', async t => {
  const delivered = []
  const f = await fixture(t, { failTask: 'BOOM', deliver: value => { delivered.push(value) } })
  const report = await f.botRouting.dispatch({
    text: 'BOOM 会失败的整理', requesterBotId: 'main', requestKey: 'route-fail',
    settle: f.settle, deliver: value => { delivered.push(value) },
  }, { kind: 'owner' })
  assert.equal(report.dispatched, true)
  assert.equal(report.accepted, true)
  assert.equal(report.settled, true)
  assert.equal(report.outcome, 'failed')
  assert.equal(report.reason, 'MOCK_WORKER_REFUSED')
  assert.equal(f.runs.length, 1)
  assert.equal(f.runs[0].ownerBotId, 'worker')
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].outcome, 'failed')
  assert.equal(f.service.get(f.subjectFor('worker'), { taskId: report.packages[0].taskId }).state, 'failed')
})

test('routing end to end: a preview dispatches nothing, binds nothing and submits nothing', async t => {
  const f = await fixture(t)
  const decision = f.botRouting.decide({ text: '读远程日志', requiresMachine: true, machineId: 'm1', requesterBotId: 'main' })
  assert.equal(decision.chosen.botId, 'worker')
  assert.equal(decision.binding.machineId, 'm1')
  f.botRouting.inspect()
  assert.equal(f.bound.length, 0)
  assert.equal(f.runs.length, 0)
  assert.equal(f.service.listPlans(f.subjectFor('main')).length, 0)
})

test('routing end to end: the grant comes from the committed ceiling of the machine the task names', async t => {
  const f = await fixture(t)
  const readOnly = f.botRouting.decide({ text: '读日志', requiresMachine: true, machineId: 'm1', needs: {} })
  assert.equal(readOnly.binding.machineId, 'm1')
  assert.equal(readOnly.binding.mode, 'read-only')
  assert.equal(readOnly.binding.tools.includes('fs_write'), false)
  const writing = f.botRouting.decide({ text: '写日志', requiresMachine: true, machineId: 'm2', needs: { write: true, shell: true } })
  assert.equal(writing.binding.machineId, 'm2')
  assert.equal(writing.binding.mode, 'workspace-write')
  assert.equal(writing.binding.tools.includes('fs_write'), true)
  assert.equal(writing.binding.tools.includes('shell_exec'), true)
  // A machine this Bot holds no grant for is refused instead of being answered with another one.
  assert.throws(() => f.botRouting.decide({ text: '读', requiresMachine: true, machineId: 'm9', pinnedBotId: 'worker' }), /BOT_ROUTING_PINNED_INELIGIBLE:worker:BOT_ROUTING_WORKER_MACHINE_NOT_GRANTED:m9/u)
  // A machine no Bot holds a grant for leaves nothing eligible, and says so.
  const none = f.botRouting.decide({ text: '读', requiresMachine: true, machineId: 'm9' })
  assert.equal(none.chosen, null)
  assert.equal(none.reason, 'NO_BOT_ELIGIBLE')
  assert.deepEqual(none.rejected.map(row => row.reason), ['BOT_MACHINE_OFFLINE', 'BOT_MACHINE_OFFLINE', 'BOT_MACHINE_OFFLINE'])
})

test('routing end to end: a pinned Bot passes the same hard requirements as an automatic pick', async t => {
  const f = await fixture(t, { settings: { idle: { enabled: false, model: { provider: 'step', model: 'step-3' }, grant: { tools: [] }, machineGrants: [], capabilities: [] } } })
  assert.throws(() => f.botRouting.decide({ text: '读', requiresMachine: true, machineId: 'm1', pinnedBotId: 'idle' }), /BOT_ROUTING_PINNED_INELIGIBLE:idle:BOT_DISABLED/u)
  // The writer holds no machine grant at all, so pinning it for machine work is refused by name.
  assert.throws(() => f.botRouting.decide({ text: '读', requiresMachine: true, machineId: 'm1', pinnedBotId: 'writer' }), /BOT_ROUTING_PINNED_INELIGIBLE:writer:BOT_ROUTING_WORKER_MACHINE_NOT_GRANTED:m1/u)
  const pinned = await f.botRouting.dispatch({ text: '读日志', requiresMachine: true, machineId: 'm2', pinnedBotId: 'worker', requesterBotId: 'main', settle: f.settle }, { kind: 'owner' })
  assert.equal(pinned.botId, 'worker')
  assert.equal(pinned.pinned, true)
  assert.equal(pinned.binding.machineId, 'm2')
  assert.equal(f.runs.length, 1)
})

test('routing end to end: a machine task is not dispatched while its grant was never committed', async t => {
  const f = await fixture(t, { routing: { enabled: true, preset: 'balanced', autoGrant: { machineTools: false } } })
  await assert.rejects(f.botRouting.dispatch({ text: '读日志', requiresMachine: true, machineId: 'm1', requesterBotId: 'main' }, { kind: 'owner' }), /BOT_ROUTING_WORKER_GRANT_REQUIRED/u)
  assert.equal(f.bound.length, 0)
  assert.equal(f.runs.length, 0)
  assert.equal(f.service.listPlans(f.subjectFor('main')).length, 0)
})

test('routing end to end: a machine task commits the binding before the plan is submitted', async t => {
  const f = await fixture(t)
  const report = await f.botRouting.dispatch({ text: '读日志', requiresMachine: true, machineId: 'm1', needs: { write: true }, requesterBotId: 'main', settle: f.settle }, { kind: 'owner' })
  const item = report.packages[0]
  assert.equal(report.granted, true)
  assert.equal(report.binding.machineId, 'm1')
  assert.equal(report.effectClass, 'workspace-write')
  assert.equal(f.bound.length, 1)
  assert.deepEqual(f.bound[0], { machineId: 'm1', botId: 'worker', mode: 'workspace-write', tools: report.binding.tools })
  assert.equal(f.bindings.get('worker/m1').mode, 'workspace-write')
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].ownerBotId, 'worker')
  // The write itself lands on the worker, under the task the journal created.
  assert.equal(await readFile(join(f.dir, 'writes', `${item.taskId}.txt`), 'utf8'), 'worker:读日志')
})

test('routing end to end: a plan id with no accepted task is a refusal, not a success', async t => {
  const refused = { planId: 'task-empty', state: 'ready', packages: [{ id: 'p1', targetBotId: 'worker', taskId: 'task-blocked', packageId: 'package-blocked', attemptId: 'attempt-blocked', operationId: 'operation-blocked', state: 'blocked', result: { code: 'TASK_RECONCILIATION_REQUIRED' } }] }
  const f = await fixture(t, { submitPlan: () => refused })
  await assert.rejects(f.botRouting.dispatch({ text: '读日志', requesterBotId: 'main' }, { kind: 'owner' }), /ROUTING_TASK_NOT_ACCEPTED:.*blocked/u)
  assert.equal(f.runs.length, 0)
  assert.equal(f.bound.length, 0)
})
test('routing end to end: the model path dispatches for an allowed Bot and refuses the others', async t => {
  const f = await fixture(t)
  const tools = new Map()
  const ctx = { tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } }
  registerBotRoutingTools(ctx, { routing: f.botRouting, allowedBotIds: ['main'], botIdFor: exec => { try { return f.authority.describe(f.directory.forAgent(exec?.agent)).botId } catch { return null } } })
  assert.deepEqual([...tools.keys()], ['bot_route_task', 'bot_dispatch'])

  const ok = await tools.get('bot_dispatch').execute({ text: '整理记录', requestKey: 'tool-1' }, { agent: f.agents.main })
  assert.equal(ok.dispatched, true)
  assert.equal(ok.botId, 'worker')
  assert.equal(f.runs.length, 1)

  const denied = await tools.get('bot_dispatch').execute({ text: '整理记录' }, { agent: f.agents.worker })
  assert.equal(denied.dispatched, false)
  assert.equal(denied.reason, 'BOT_ROUTING_DISPATCH_DENIED:worker')
  const anonymous = await tools.get('bot_dispatch').execute({ text: '整理记录' }, { agent: {} })
  assert.equal(anonymous.reason, 'BOT_ROUTING_DISPATCH_UNKNOWN_SUBJECT')
  // Neither refusal created work.
  assert.equal(f.runs.length, 1)
  assert.equal(f.service.listPlans(f.subjectFor('main')).length, 1)
})

test('routing end to end: the Main Bot keeps its own access and is never narrowed by routing', async t => {
  const off = { enabled: false, model: { provider: 'step', model: 'step-3' }, grant: { tools: [] }, machineGrants: [], capabilities: [] }
  const f = await fixture(t, { settings: {
    main: { enabled: true, model: { provider: 'deepseek', model: 'chat' }, grant: { tools: [] }, machineGrants: [{ machineId: 'm1', capabilities: MACHINE_CEILING }], capabilities: [] },
    worker: off,
    writer: off,
  } })
  // The automatic pick and a person's pin both land on the Main Bot, and neither re-grants it.
  const automatic = await f.botRouting.dispatch({ text: '主 Bot 自己读日志', requiresMachine: true, machineId: 'm1', requesterBotId: 'main', settle: f.settle }, { kind: 'owner' })
  assert.equal(automatic.botId, 'main')
  assert.equal(automatic.mainBot, true)
  assert.equal(automatic.binding, null)
  assert.equal(automatic.granted, false)
  const pinned = await f.botRouting.dispatch({ text: '主 Bot 再读日志', requiresMachine: true, machineId: 'm1', pinnedBotId: 'main', requesterBotId: 'main', settle: f.settle }, { kind: 'owner' })
  assert.equal(pinned.botId, 'main')
  assert.equal(pinned.mainBot, true)
  assert.equal(pinned.binding, null)
  assert.equal(f.bound.length, 0)
  assert.equal(f.runs.length, 2)
  assert.deepEqual(f.runs.map(row => row.ownerBotId), ['main', 'main'])
})
