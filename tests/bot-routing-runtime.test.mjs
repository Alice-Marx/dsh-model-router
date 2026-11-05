import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createBotLibrary } from '../packages/orchestration/src/bot-library.mjs'
import { registerLibraryTools } from '../.dsh-plugin/shared/library-tools.mjs'
import { createBotTurnBackends } from '../packages/orchestration/src/bot-routing-runtime.mjs'
import { taskModelRequest } from '../packages/orchestration/src/model-receipt.mjs'
import { taskHash } from '../packages/orchestration/src/task-contract.mjs'
import { createHash } from 'node:crypto'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { createTaskService } from '../packages/orchestration/src/task-service.mjs'
import { createBotRoutingService } from '../packages/orchestration/src/bot-routing-service.mjs'
import { registerRemoteComputerTools } from '../packages/orchestration/src/remote-computer-tools.mjs'

// This fixture exercises the Host protocol, real SQLite Task runner, production routing tools,
// scoped library tools, durable turn receipts and machine facade. The Session driver/model is an
// offline fixture; it is not a full DSH AgentLoop or browser/UI acceptance test.
async function until(check) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await sleep(10) }
  throw new Error('routed turn did not reach the required state')
}

async function hostFixture(t, { hold = false, ignoreCancel = false, unknownMachine = false, routingEnabled = true, remoteWorkspace = false, contextMessages = [] } = {}) {
  await mkdir(resolve('tmp/integration/routed-worker-turns'), { recursive: true })
  const dir = await mkdtemp(resolve('tmp/integration/routed-worker-turns/case-'))
  const file = join(dir, 'host.sqlite')
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  const toolNames = ['bot_route_task', 'bot_dispatch', 'bot_library_list', 'bot_library_read', 'bot_library_write', 'remote_computer_write']
  const grant = { tools: ['task/execute', 'task/submit', 'task/read', 'task/cancel', 'task/retry', 'task/reconcile', 'execution/bot-turn', 'execution/bot-turn-retry', 'execution/bot-turn-observe', 'model/infer', ...toolNames.map(name => `tool/${name}`)], modelRoutes: [{ provider: 'offline', model: 'worker-model' }] }
  const tools = new Map(), listeners = new Map(), deliveries = [], messages = [], calls = [], modelIdentities = [], guards = new Map(), remoteCalls = []
  const on = (name, handler) => { const set = listeners.get(name) ?? new Set(); set.add(handler); listeners.set(name, set); return () => set.delete(handler) }
  const emit = (name, ...args) => {
    if (name === 'session/event') fs.appendFileSync(join(dir, `${args[0].id}.jsonl`), JSON.stringify(args[1]) + '\n')
    for (const handler of listeners.get(name) ?? []) handler(...args)
  }
  const botIdFor = exec => authority.describe(directory.forAgent(exec?.agent)).botId
  const ctx = { on, sessions: { flush: async () => {} }, tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    get: name => name === 'botIdForAgent' ? agent => botIdFor({ agent }) : undefined }
  const library = createBotLibrary({ root: join(dir, 'libraries'), fs })
  library.write('worker', 'source.txt', 'worker private input')
  registerLibraryTools({ ctx, config: { operatorPassthrough: { enabled: false } }, defineTool, library, jsonOutput: { schema: { type: 'json' } }, jsonValue: value => value,
    registerPolicyTool: (_ctx, _config, tool) => ctx.tools.register({ ...tool, execute: (args, exec) => { authority.assertTool(directory.forAgent(exec.agent), `tool/${tool.name}`); return tool.execute(args, exec) } }) })
  let backend, service, turnSequence = 0
  const agents = {}
  const live = new Map()
  const finish = (botId, reason = { kind: 'completed' }, text = 'worker fixture result') => {
    const agent = agents[botId]
    if (text) emit('session/event', agent.session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
    const turn = live.get(agent.session.id)?.turn
    live.delete(agent.session.id)
    emit('session/event', agent.session, { type: 'turn/end', data: { turn, reason } })
  }
  const execute = async (botId, name, args) => {
    const agent = agents[botId]
    const execution = { agent, name, arguments: args, signal: new AbortController().signal }
    for (const guard of guards.get(botId) ?? []) { const denied = guard(execution); if (denied) throw Object.assign(new Error(denied), { code: denied }) }
    authority.assertTool(directory.forAgent(agent), `tool/${name}`)
    emit('session/event', agent.session, { type: 'tool/call', data: { name, callId: `call-${calls.length}` } })
    const result = await tools.get(name).execute(args, execution)
    calls.push({ botId, name, result })
    emit('tools/result', execution, { value: result, isError: false })
    return result
  }
  for (const botId of ['main', 'worker']) {
    directory.register(botId, grant)
    const session = { id: `session-${botId}` }
    const ownGuards = new Set(); guards.set(botId, ownGuards)
    const agent = { id: session.id, session, ctx: { get: name => name === 'tools' ? { guard: fn => { ownGuards.add(fn); return () => ownGuards.delete(fn) } } : null },
      cancel: () => { if (!ignoreCancel) queueMicrotask(() => finish(botId, { kind: 'aborted', reason: { kind: 'hook', reason: 'fixture-cancelled' } }, '')) },
      followup(message) {
        messages.push({ botId, message })
        queueMicrotask(async () => {
          const turn = ++turnSequence
          live.set(session.id, { turn })
          emit('session/event', session, { type: 'turn/start', data: { turn } })
          emit('session/event', session, { type: 'user/message', data: message })
          for (const source of contextMessages) emit('session/event', session, { type: 'user/message', data: { source, content: [{ type: 'text', text: 'additional turn context' }] } })
          const options = { sessionId: session.id, provider: 'offline', model: 'worker-model' }
          backend.tagModelRequest(options); modelIdentities.push(taskModelRequest(options))
          if (hold) return
          const objective = message.content[0].text
          try {
            if (objective.includes('FAIL')) throw Object.assign(new Error('offline model failed'), { code: 'OFFLINE_WORKER_FAILURE' })
            let result
            if (objective.includes('REMOTE')) {
              const target = backend.currentIdentity({ agent })
              result = await execute(botId, 'remote_computer_write', { requestKey: 'ignored-child-task-key', machineId: target.machineId, rootId: target.rootId, relativePath: 'output.txt', content: 'written by selected worker', expectedHash: null })
            }
            else if (objective.includes('WRITE')) result = await execute(botId, 'bot_library_write', { botId, relativePath: 'result.txt', content: `${botId}:real production library tool` })
            else result = await execute(botId, 'bot_library_read', { botId, relativePath: 'source.txt' })
            finish(botId, { kind: 'completed' }, JSON.stringify(result))
          } catch (error) { finish(botId, { kind: 'error', error: { code: error.code ?? 'FIXTURE_TOOL_FAILURE' } }, '') }
        })
      } }
    agents[botId] = agent; directory.bind(botId, agent)
  }
  const machineTools = ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read']
  const saved = botId => ({ revision: 1, status: 'available', settings: { enabled: true, model: { provider: 'offline', model: 'worker-model' },
    workspaceRef: { kind: remoteWorkspace ? 'remote' : 'local', machineId: remoteWorkspace ? 'm1' : 'local-fixture', rootId: 'project' },
    machineGrants: botId === 'worker' ? ['m1', 'm2'].map(machineId => ({ machineId, rootId: 'project', capabilities: machineTools, mode: 'workspace-write' })) : [], grant } })
  const runtime = { load: async () => {}, ensureCapabilities: async () => {}, live, chatOf: id => `session-${id}`, resolveAgent: async id => Object.values(agents).find(agent => agent.session.id === id), deliver: async value => { deliveries.push(value); return value.exchangeId },
    async *eventsBackwards(sessionId) { const events = fs.readFileSync(join(dir, `${sessionId}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line)); yield* events.reverse() } }
  const machines = { readModel: () => ({ items: ['m1', 'm2'].map(id => ({ id, status: 'online', revision: 1, bindings: [{ botId: 'worker', roots: ['project'], tools: machineTools, mode: 'workspace-write', revision: 1, revoked: false }] })) }),
    taskTarget: (_subject, input) => ({ machineId: input.machineId, rootId: input.rootId, remoteMachineRevision: 1, remoteBindingRevision: 1 }), call: async (subject, input) => {
    assert.equal(authority.describe(subject).botId, 'worker'); remoteCalls.push(input)
    if (!unknownMachine) await fs.promises.writeFile(join(dir, 'remote-output.txt'), input.args.content)
    assert.equal(Object.hasOwn(input.args, 'machineId'), false)
    const record = { schemaVersion: 1, machineId: input.machineId, tool: input.tool, operationId: input.operationId, status: unknownMachine ? 'unknown' : 'succeeded',
      result: { possiblyApplied: unknownMachine, sha256: createHash('sha256').update(input.args.content).digest('hex'), size: Buffer.byteLength(input.args.content) }, error: null }
    return { ...record, ...(!unknownMachine ? { stopProof: { schemaVersion: 1, kind: 'agent-stop-receipt', source: 'in-process-write', machineId: input.machineId, taskId: input.taskId, attemptId: input.attemptId, operationId: input.operationId, tool: input.tool, status: record.status, receiptHash: taskHash(record) } } : {}) }
  } }
  backend = createBotTurnBackends({ ctx, runtime, directory, authority, Database, storeFile: file, bindingFor: saved, machines, cancelWaitMs: 20,
    readPlan: report => service.getPlan(directory.forBot(report.originBotId), { planId: report.planId }) })
  service = createTaskService({ authority, directory, journal: openTaskJournal(Database, file), backends: [...backend.backends], planTargetsFor: () => ['main', 'worker'] })
  service.start()
  const routing = createBotRoutingService({ bots: () => [{ id: 'main', main: true }, { id: 'worker' }], settingsFor: id => ({ ...saved(id).settings, status: 'available', grant }), routing: { enabled: routingEnabled }, mainBotIds: ['main'],
    priceFor: () => null, qualityFor: id => id === 'worker' ? 0.9 : 0.2, subjectFor: id => directory.forBot(id), submitPlan: (...args) => service.submitPlan(...args),
    machineHealth: () => ({ online: true }), bindWorker: () => ({ confirmed: true, applied: false }),
    executionBackendFor: effect => effect === 'read' ? 'bot-turn-read' : 'bot-turn-write', onAccepted: report => backend.watchPlan(report) })
  registerRemoteComputerTools(ctx, { runtime, directory, machines, taskService: service, botRouting: routing, routingBotIds: ['main'], routedExecution: backend, botIdFor })
  const task = report => service.get(directory.forBot('worker'), { taskId: report.packages[0].taskId })
  t.after(async () => { backend.close(); await service.close(); authority.dispose() })
  return { dir, tools, service, routing, agents, backend, calls, deliveries, messages, guards, execute, finish, task, modelIdentities, remoteCalls, directory, authority, file, saved, runtime, ctx, machines }
}

test('worker turn: registered bot_route_task creates a real task, executes a private library tool and delivers its result', async t => {
  const f = await hostFixture(t)
  const report = await f.tools.get('bot_route_task').execute({ text: 'WRITE a result', requiredTools: ['bot_library_write'], requestKey: 'model-route' }, { agent: f.agents.main })
  assert.equal(report.accepted, true); assert.equal(report.botId, 'worker')
  const task = await until(() => { const row = f.task(report); return row.state === 'succeeded' ? row : null })
  assert.equal(task.input.backend, 'bot-turn-write')
  assert.equal(task.executionRef.kind, 'bot-turn')
  assert.equal(task.result.summary.stopConfirmed, true)
  assert.equal(task.result.summary.toolCalls, 1)
  assert.equal(await readFile(join(f.dir, 'libraries/worker/result.txt'), 'utf8'), 'worker:real production library tool')
  assert.equal(fs.existsSync(join(f.dir, 'libraries/main/result.txt')), false)
  const identity = f.modelIdentities[0]
  assert.equal(identity.botId, 'worker'); assert.equal(identity.taskId, task.taskId); assert.equal(identity.attemptId, task.attemptId); assert.equal(identity.operationId, task.operationId)
  assert.equal(Object.hasOwn(identity, 'costUsd'), false)
  await until(() => f.deliveries.length === 1)
  assert.equal(f.deliveries[0].toId, 'main'); assert.match(f.deliveries[0].text, /succeeded/u)
  assert.equal(f.guards.get('worker').size, 0)
})

test('worker turn: a read turn executes read tools while write attempts fail under its task scope', async t => {
  const f = await hostFixture(t)
  const good = await f.routing.dispatch({ text: 'READ private file' }, { kind: 'owner' })
  await until(() => f.task(good).state === 'succeeded')
  assert.match(f.task(good).result.summary.text, /worker private input/u)
  const denied = await f.routing.dispatch({ text: 'WRITE while claiming read' }, { kind: 'owner' })
  await until(() => f.task(denied).state === 'failed')
  assert.equal(f.task(denied).result.summary.code, 'BOT_TURN_READ_ONLY')
  assert.equal(fs.existsSync(join(f.dir, 'libraries/worker/result.txt')), false)
  assert.equal(f.guards.get('worker').size, 0)
})

test('worker turn: preview and disabled routing never enqueue a worker turn or create a task', async t => {
  const f = await hostFixture(t)
  const preview = await f.tools.get('bot_route_task').execute({ text: 'READ', preview: true }, { agent: f.agents.main })
  assert.equal(preview.preview, true); assert.equal(preview.dispatched, false)
  assert.equal(f.messages.length, 0)
  const disabled = await hostFixture(t, { routingEnabled: false })
  await assert.rejects(disabled.routing.dispatch({ text: 'READ', pinnedBotId: 'worker' }, { kind: 'owner' }), /BOT_ROUTING_DISABLED/u)
  assert.equal(disabled.messages.length, 0)
})

test('worker turn: the actual Agent binding defeats forged requester/session/owner arguments', async t => {
  const f = await hostFixture(t)
  const denied = await f.tools.get('bot_dispatch').execute({ text: 'READ', requesterBotId: 'main', caller: { owner: true } }, { agent: f.agents.worker })
  assert.equal(denied.dispatched, false)
  const forged = await f.tools.get('bot_route_task').execute({ text: 'READ' }, { agent: { id: 'session-main', session: { id: 'session-main' }, botId: 'main' } })
  assert.equal(forged.reason, 'BOT_ROUTING_DISPATCH_UNKNOWN_SUBJECT')
  assert.equal(f.messages.length, 0)
  await assert.rejects(f.routing.dispatch({ text: 'READ', requesterBotId: 'main' }), /BOT_ROUTING_AUTHENTICATED_CALLER_REQUIRED/u)
})

test('worker turn: worker/model failure is durable and the reply reports failure', async t => {
  const f = await hostFixture(t)
  const report = await f.routing.dispatch({ text: 'FAIL worker task' }, { kind: 'owner' })
  await until(() => f.task(report).state === 'failed')
  assert.equal(f.task(report).result.summary.code, 'OFFLINE_WORKER_FAILURE')
  assert.equal(f.task(report).result.summary.stopConfirmed, true)
  await until(() => f.deliveries.length === 1)
  assert.match(f.deliveries[0].text, /failed/u)
})

test('worker turn: Host context snapshots do not turn a completed assignment into mixed input', async t => {
  const contextMessages = ['runtime-context', 'time-context', 'ds-bot-time-context'].map(kind => ({ kind, form: 'snapshot' }))
  const f = await hostFixture(t, { contextMessages })
  const report = await f.routing.dispatch({ text: 'READ with Host context' }, { kind: 'owner' })
  await until(() => f.task(report).state === 'succeeded')
  assert.equal(f.task(report).result.summary.stopConfirmed, true)
  assert.match(f.task(report).result.summary.text, /worker private input/u)
})

test('worker turn: genuine additional input still refuses a success receipt', async t => {
  for (const source of [{ kind: 'user' }, { kind: 'bot', form: 'relay', role: 'post' },
    { kind: 'unknown-context', form: 'snapshot' }, { kind: 'time-context', form: 'relay' }]) {
    const f = await hostFixture(t, { contextMessages: [source] })
    const report = await f.routing.dispatch({ text: 'READ with another input' }, { kind: 'owner' })
    await until(() => f.task(report).state === 'needs-reconciliation')
    assert.equal(f.task(report).result.summary.code, 'BOT_TURN_MIXED_INPUT')
    assert.equal(f.task(report).result.summary.stopConfirmed, false)
  }
})

test('worker turn: remote writes use the parent task/attempt and unknown operations cannot become success', async t => {
  const f = await hostFixture(t, { remoteWorkspace: true })
  const report = await f.routing.dispatch({ text: 'REMOTE write', needs: { write: true } }, { kind: 'owner' })
  await until(() => f.task(report).state === 'succeeded')
  const operation = f.remoteCalls[0]
  assert.equal(operation.taskId, f.task(report).taskId); assert.equal(operation.attemptId, f.task(report).attemptId)
  assert.notEqual(operation.operationId, f.task(report).operationId)
  assert.equal(await readFile(join(f.dir, 'remote-output.txt'), 'utf8'), 'written by selected worker')
  const uncertain = await hostFixture(t, { unknownMachine: true, remoteWorkspace: true })
  const other = await uncertain.routing.dispatch({ text: 'REMOTE write', needs: { write: true } }, { kind: 'owner' })
  await until(() => uncertain.task(other).state === 'needs-reconciliation')
  assert.equal(uncertain.task(other).result.summary.code, 'BOT_TURN_REMOTE_OUTCOME_UNKNOWN')
  assert.equal(uncertain.task(other).result.summary.stopConfirmed, false)
})

test('worker turn: an explicitly selected second machine is committed into the plan, execution target and worker input', async t => {
  const f = await hostFixture(t)
  const report = await f.routing.dispatch({ text: 'REMOTE write on the second machine', requiresMachine: true, machineId: 'm2', rootId: 'project', needs: { write: true } }, { kind: 'owner' })
  await until(() => f.task(report).state === 'succeeded')
  const task = f.task(report)
  assert.equal(task.input.input.machineId, 'm2'); assert.equal(task.input.input.rootId, 'project')
  assert.equal(task.input.target.machineId, 'm2'); assert.equal(task.input.target.location, 'remote')
  assert.equal(f.remoteCalls[0].machineId, 'm2')
  assert.match(f.messages[0].message.content[0].text, /machineId=m2, rootId=project/u)
})

test('worker turn: cancel is uncertain until the exact worker turn ends, then reconciliation uses its original receipt', async t => {
  const f = await hostFixture(t, { hold: true, ignoreCancel: true })
  const report = await f.routing.dispatch({ text: 'READ and hold' }, { kind: 'owner' })
  await until(() => f.modelIdentities.length === 1)
  const before = f.task(report)
  f.service.cancel(f.directory.forBot('worker'), { taskId: before.taskId })
  await until(() => f.task(report).state === 'needs-reconciliation')
  assert.equal(f.task(report).result.summary.stopConfirmed, false)
  assert.throws(() => f.service.retry(f.directory.forBot('worker'), { taskId: before.taskId, requestKey: 'no-blind-replay' }), /TASK_RECONCILIATION_REQUIRED/u)
  f.finish('worker', { kind: 'aborted', reason: { kind: 'hook', reason: 'confirmed-stop' } }, '')
  await until(() => f.guards.get('worker').size === 0)
  const reconciled = await f.service.reconcile(f.directory.forBot('worker'), { taskId: before.taskId, requestKey: 'observe-original' })
  assert.equal(reconciled.state, 'cancelled'); assert.equal(reconciled.operationId, before.operationId); assert.equal(reconciled.attempts.length, 1)
  assert.equal(f.messages.length, 1)
})

test('worker turn: repeated request keys retain the original task/attempt/operation and never enqueue the work twice', async t => {
  const f = await hostFixture(t)
  const first = await f.tools.get('bot_route_task').execute({ text: 'READ once', requestKey: 'once-only' }, { agent: f.agents.main })
  await until(() => f.task(first).state === 'succeeded')
  const replay = await f.tools.get('bot_route_task').execute({ text: 'READ once', requestKey: 'once-only' }, { agent: f.agents.main })
  assert.equal(replay.replayed, true); assert.equal(replay.dispatched, false)
  assert.equal(replay.planId, first.planId); assert.equal(replay.packages[0].operationId, first.packages[0].operationId)
  assert.equal(f.messages.length, 1)
  await assert.rejects(f.tools.get('bot_route_task').execute({ text: 'different task', requestKey: 'once-only' }, { agent: f.agents.main }), /TASK_REQUEST_CONFLICT/u)
  assert.equal(f.messages.length, 1)
})

test('worker turn: a fresh observer reconciles the exact persisted turn with Host context after receipt interruption, without redelivering it', async t => {
  const f = await hostFixture(t, { hold: true, ignoreCancel: true, contextMessages: ['runtime-context', 'time-context', 'ds-bot-time-context'].map(kind => ({ kind, form: 'snapshot' })) })
  const report = await f.routing.dispatch({ text: 'READ before interruption' }, { kind: 'owner' })
  await until(() => f.modelIdentities.length === 1)
  const original = f.task(report)
  f.backend.close(); await f.service.close()
  // Simulate the Session checkpoint that survived a Host death before its routing receipt saved.
  f.finish('worker', { kind: 'completed' }, 'persisted exact worker answer')
  const restoredBackend = createBotTurnBackends({ ctx: f.ctx, runtime: f.runtime, directory: f.directory, authority: f.authority, Database, storeFile: f.file, bindingFor: f.saved, machines: f.machines })
  const restoredService = createTaskService({ authority: f.authority, directory: f.directory, journal: openTaskJournal(Database, f.file), backends: [...restoredBackend.backends] })
  restoredService.start()
  t.after(async () => { restoredBackend.close(); await restoredService.close() })
  const worker = f.directory.forBot('worker')
  assert.equal(restoredService.get(worker, { taskId: original.taskId }).state, 'needs-reconciliation')
  const observed = await restoredService.reconcile(worker, { taskId: original.taskId, requestKey: 'recover-original-turn' })
  assert.equal(observed.state, 'succeeded'); assert.equal(observed.operationId, original.operationId); assert.equal(observed.attempts.length, 1)
  assert.equal(observed.result.summary.text, 'persisted exact worker answer')
  assert.equal(f.messages.length, 1)
})

test('worker turn: a historical mixed-input receipt is rechecked without replay, and real extra input stays unknown', async t => {
  for (const contaminated of [false, true]) {
    const contextMessages = [{ kind: 'time-context', form: 'snapshot' }, ...(contaminated ? [{ kind: 'user' }] : [])]
    const f = await hostFixture(t, { hold: true, ignoreCancel: true, contextMessages })
    const report = await f.routing.dispatch({ text: 'READ original assignment' }, { kind: 'owner' })
    await until(() => f.modelIdentities.length === 1)
    const original = f.task(report)
    f.backend.close(); await f.service.close()
    f.finish('worker', { kind: 'completed' }, 'original result, not a repeated run')
    // Model the legacy receipt already saved by 0.63.1; only this isolated fixture DB is written.
    const fixtureDb = new Database(f.file)
    fixtureDb.prepare('UPDATE bot_routed_turns SET state=?,result_json=? WHERE run_id=?').run('unknown', JSON.stringify({ outcome: 'unknown', summary: { code: 'BOT_TURN_MIXED_INPUT', stopConfirmed: false } }), original.executionRef.runId)
    fixtureDb.close()
    const backend = createBotTurnBackends({ ctx: f.ctx, runtime: f.runtime, directory: f.directory, authority: f.authority, Database, storeFile: f.file, bindingFor: f.saved, machines: f.machines })
    const service = createTaskService({ authority: f.authority, directory: f.directory, journal: openTaskJournal(Database, f.file), backends: [...backend.backends] })
    service.start()
    t.after(async () => { backend.close(); await service.close() })
    const observed = await service.reconcile(f.directory.forBot('worker'), { taskId: original.taskId, requestKey: 'recheck-legacy-clock' })
    assert.equal(observed.state, contaminated ? 'needs-reconciliation' : 'succeeded')
    assert.equal(observed.operationId, original.operationId)
    assert.equal(observed.attempts.length, 1)
    assert.equal(f.messages.length, 1)
    if (!contaminated) assert.equal(observed.result.summary.text, 'original result, not a repeated run')
  }
})
