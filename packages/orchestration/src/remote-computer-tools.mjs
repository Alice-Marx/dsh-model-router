import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerBotRoutingTools } from './bot-routing-tools.mjs'
import { taskHash } from './task-contract.mjs'
import { createRemoteWriteBackend } from './remote-execution.mjs'
import { createRemoteCommandBackend } from './remote-command-execution.mjs'

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}
const DESKTOP_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => {
    if (value?.attachment) return [{ type: 'text', text: value.text }, { type: 'image', attachment: value.attachment }]
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  },
}
const json = value => JSON.parse(JSON.stringify(value))

// One durable identity per Bot chat. Every remote action of the same Session shares it, so the
// Agent's native desktop lease, browser context and operation ledger see one owner instead of a
// fresh stranger per tool call. It is derived here, never taken from model arguments.
export function remoteSessionIdentity(exec) {
  const raw = exec?.agent?.id ?? exec?.sessionId ?? ''
  const key = typeof raw === 'string' ? raw.replace(/[^A-Za-z0-9_.-]/gu, '') : ''
  if (!key) throw Object.assign(new Error('REMOTE_SESSION_IDENTITY_REQUIRED'), { code: 'REMOTE_SESSION_IDENTITY_REQUIRED' })
  return { taskId: `remote-task-${key}`, attemptId: `remote-attempt-${key}` }
}

// A mutating Agent tool answers with its operation record; a read-only one answers with the
// value itself. The product tools expose what the tool produced, plus the identity that can be
// read or cancelled, and surface a failed operation as an error instead of an empty result.
function operationOutcome(record, tool) {
  if (!record || typeof record !== 'object' || record.tool !== tool || typeof record.operationId !== 'string') return { value: record, status: null }
  if (record.status === 'succeeded') return { value: record.result ?? {}, status: record.status }
  return { value: { ...(record.result ?? {}), operationStatus: record.status, ...(record.error ? { error: record.error } : {}) }, status: record.status }
}

/**
 * A recorded routine step as the desktop tool that performs it.
 *
 * `wait` has no tool: it is a pause, and pretending it is a machine action would put it in the
 * operation log where nothing happened.
 */
export function routineStepToTool(step) {
  if (!step || typeof step !== 'object') throw Object.assign(new Error('ROUTINE_STEP_INVALID'), { code: 'ROUTINE_STEP_INVALID' })
  switch (step.action) {
    case 'click': return { tool: 'desktop_click', args: { x: step.x, y: step.y, ...(step.button === 'right' ? { button: 'right' } : {}) } }
    case 'type': return { tool: 'desktop_type', args: { text: step.text } }
    case 'key': return { tool: 'desktop_key', args: { key: step.key, ...(step.modifiers?.length ? { modifiers: step.modifiers } : {}) } }
    case 'scroll': return { tool: 'desktop_scroll', args: { delta: step.delta } }
    case 'wait': return null
    default: throw Object.assign(new Error(`ROUTINE_ACTION_UNKNOWN:${String(step.action)}`), { code: 'ROUTINE_ACTION_UNKNOWN' })
  }
}

export function registerRemoteComputerTools(ctx, { runtime, directory, machines, taskService, remoteCliBackend = null, operatorSubject = null, botRouting = null, routingBotIds = [], routedExecution = null, routineStore = null, routineExecution = null, botIdFor = null, handoffTask = null }) {
  // A session that is not a Bot (the operator's own agent) is otherwise refused as
  // UNKNOWN_SUBJECT. When passthrough is enabled the Host supplies the Main Bot's subject, so the
  // call carries that Bot's grants and audit trail instead of a second permission set.
  const subject = exec => {
    try { return directory.forAgent(exec?.agent) }
    catch (error) {
      if (error?.code !== 'UNKNOWN_SUBJECT') throw error
      const principal = typeof operatorSubject === 'function' ? operatorSubject() : null
      if (!principal) throw error
      return principal
    }
  }
  // Routing/routines act only as a live bound Bot, even when ordinary operator tools support an
  // explicitly configured Main passthrough. Agent string fields are never an identity lookup.
  const callerBot = exec => {
    directory.forAgent(exec?.agent)
    const id = typeof botIdFor === 'function' ? botIdFor(exec) : ctx.get?.('botIdForAgent')?.(exec?.agent)
    if (typeof id !== 'string' || !id) throw Object.assign(new Error('UNKNOWN_SUBJECT'), { code: 'UNKNOWN_SUBJECT' })
    return id
  }
  const register = (name, description, parameters, execute, output = JSON_OUTPUT) => ctx.tools.register(defineTool({ name, description, parameters, output, execute }))
  const call = async (exec, args, tool, business, identity = {}) => {
    await runtime.load()
    const routed = routedExecution?.currentIdentity(exec)
    if (routed && (routed.machineId !== args.machineId || routed.rootId !== args.rootId)) throw Object.assign(new Error('BOT_TURN_MACHINE_TARGET_MISMATCH'), { code: 'BOT_TURN_MACHINE_TARGET_MISMATCH' })
    if (routed) routedExecution.assertOperationReady(routed, tool)
    const session = routed ?? remoteSessionIdentity(exec)
    const taskId = identity.taskId ?? session.taskId
    const attemptId = identity.attemptId ?? session.attemptId
    const operationId = identity.operationId ?? `operation-${randomUUID()}`
    const note = status => { if (routed) routedExecution.recordOperation(routed, { machineId: args.machineId, rootId: args.rootId, operationId, tool, status }) }
    note('dispatching')
    let record
    try {
      record = await machines.call(subject(exec), { machineId: args.machineId, rootId: args.rootId, taskId, attemptId, operationId,
        tool, args: business }, { signal: exec.signal })
    } catch (error) { note('unknown'); throw error }
    const { value, status } = operationOutcome(record, tool)
    note(status ?? 'succeeded')
    return { value, record, status, taskId, attemptId, operationId }
  }
  const target = {
    machineId: { type: 'string', required: true },
    rootId: { type: 'string', required: true },
  }
  let routedWrites, routedCommands
  const routedMachineTask = async (exec, args, backend, tool) => {
    const identity = routedExecution.currentIdentity(exec)
    if (identity.machineId !== args.machineId || identity.rootId !== args.rootId) throw Object.assign(new Error('BOT_TURN_MACHINE_TARGET_MISMATCH'), { code: 'BOT_TURN_MACHINE_TARGET_MISMATCH' })
    routedExecution.assertOperationReady(identity, tool)
    const input = backend.parse(args), principal = subject(exec), descriptor = backend.targetFor(principal, input)
    const target = { backend: backend.id, version: backend.version, effect: backend.effect, location: backend.location, ...descriptor }
    const operationId = `operation-${randomUUID()}`
    let reference
    const note = (status, extra = {}) => routedExecution.recordOperation(identity, { machineId: input.machineId, rootId: input.rootId, operationId, tool, status, ...extra })
    note('prepared')
    const result = await backend.run({ input, target, ownerBotId: identity.botId, binding: { taskId: identity.taskId, attemptId: identity.attemptId, ...descriptor, location: 'remote' }, operationId,
      targetHash: taskHash(target), signal: exec.signal ?? new AbortController().signal, attemptNumber: 1, legacyRunIds: [],
      checkpoint: value => { reference = value; note('dispatching', { reference }) }, beforeRequest: () => exec.signal?.throwIfAborted() })
    note(result.outcome, { ...(reference ? { reference } : {}), stopConfirmed: result.summary?.stopConfirmed === true })
    return json({ ...result, taskId: identity.taskId, attemptId: identity.attemptId, operationId, status: result.outcome })
  }

  // Passing work to another Bot: the rules live in bot-handoff, the Host applies them, and this
  // surface only asks. A refusal names why instead of quietly doing nothing.
  if (typeof handoffTask === 'function') {
    register('bot_handoff_task', 'Hand a task to another Bot. Refused on a self-handoff, a cycle, or a chain that is too deep.', {
      taskId: { type: 'string', required: true },
      toBotId: { type: 'string', required: true },
      objective: { type: 'string', required: true },
    }, async (args, exec) => {
      await runtime.load()
      const fromBotId = callerBot(exec)
      const mains = typeof routingBotIds === 'function' ? routingBotIds() : routingBotIds
      if (!mains.includes(fromBotId)) throw Object.assign(new Error('BOT_ROUTING_HANDOFF_DENIED'), { code: 'BOT_ROUTING_HANDOFF_DENIED' })
      return json(await handoffTask({ taskId: args.taskId, fromBotId, toBotId: args.toBotId, objective: args.objective }, { kind: 'bot', botId: fromBotId, sessionId: exec.agent.session.id, signal: exec.signal }))
    })
  }

  if (botRouting && typeof botRouting.dispatch === 'function') {
    registerBotRoutingTools(ctx, { routing: botRouting, allowedBotIds: routingBotIds, botIdFor: callerBot, beforeCall: () => runtime.load() })
  }

  register('remote_computer_ping', 'Check an explicitly paired remote computer and its desktop/browser capabilities.', target,
    async (args, exec) => json((await call(exec, args, 'machine_ping', {})).value))
  register('remote_computer_list', 'List one granted root directory on an explicitly paired remote computer.',
    { ...target, relativePath: { type: 'string' } }, async (args, exec) => json((await call(exec, args, 'fs_list', { rootId: args.rootId, relativePath: args.relativePath ?? '', limit: 100 })).value))
  register('remote_computer_read', 'Read a bounded UTF-8 file from one granted root on an explicitly paired remote computer.',
    { ...target, relativePath: { type: 'string', required: true } }, async (args, exec) => json((await call(exec, args, 'fs_read', { rootId: args.rootId, relativePath: args.relativePath, length: 65536 })).value))

  if (remoteCliBackend) register('remote_computer_cli_probe', 'Probe the Host-declared Codex profile only on the selected paired Agent/root.',
    { ...target, workspaceRelativePath: { type: 'string', required: true } }, async (args, exec) => { await runtime.load(); return remoteCliBackend.probe(subject(exec), args) })

  if (taskService) register('remote_computer_write', 'Submit a tracked UTF-8 file-write Task, at most 8192 bytes, with an expected current SHA256 or null for a new file.',
    { requestKey: { type: 'string', required: true }, ...target, relativePath: { type: 'string', required: true }, content: { type: 'string', required: true }, expectedHash: { type: 'json', required: true } },
    async (args, exec) => {
      await runtime.load(); const { requestKey, ...input } = args
      // A routed turn already owns its managed task. Nested machine effects use that task/attempt
      // and the Agent's durable operation ledger instead of queuing a child Task behind itself.
      if (routedExecution?.currentIdentity(exec)) return routedMachineTask(exec, input, routedWrites ??= createRemoteWriteBackend({ machines: () => machines, directory }), 'fs_write')
      return taskService.submit(subject(exec), { requestKey, backend: 'remote-write', input })
    })

  if (taskService) register('remote_computer_command', 'Run an owner-approved argv command in the remote container profile as a tracked Task. No shell string, executable path or automatic retry is accepted.',
    { requestKey: { type: 'string', required: true }, ...target, workspaceRelativePath: { type: 'string', required: true }, argv: { type: 'array', required: true }, timeoutMs: { type: 'integer' } },
    async (args, exec) => {
      await runtime.load(); const { requestKey, ...input } = args
      if (routedExecution?.currentIdentity(exec)) return routedMachineTask(exec, { ...input, timeoutMs: input.timeoutMs ?? 60000 }, routedCommands ??= createRemoteCommandBackend({ machines: () => machines, directory }), 'container_command_v1')
      return taskService.submit(subject(exec), { requestKey, backend: 'remote-command', input })
    })

  register('remote_computer_browser', 'Use the current Bot\'s granted remote browser. All browser actions of one Bot chat share one browser session; never ask for a task id.',
    { ...target, tool: { type: 'string', required: true, enum: ['browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_script', 'browser_upload', 'browser_download', 'browser_close'] }, args: { type: 'json', required: true } },
    async (args, exec) => {
      const { value, status, taskId, attemptId, operationId } = await call(exec, args, args.tool, args.args)
      return { ...json(value), taskId, attemptId, operationId, ...(status && status !== 'succeeded' ? { operationStatus: status } : {}) }
    })

  // Routines a Bot can keep and run again. The store owns ids and validation; this surface only
  // moves a saved routine onto one machine, stopping at the first failed step.
  if (routineStore) {
    const botFor = (args, exec) => {
      const actual = callerBot(exec)
      if (args?.botId && args.botId !== actual) throw Object.assign(new Error('BOT_ROUTINE_PRIVATE'), { code: 'BOT_ROUTINE_PRIVATE' })
      return actual
    }
    register('bot_routine_list', 'List the routines saved for one Bot. Steps are not returned — use run or inspect.', {
      botId: { type: 'string' },
    }, async (args, exec) => { await runtime.load(); return json(routineStore.inspect(botFor(args, exec))) })

    register('bot_routine_save', 'Save a recorded routine for one Bot. Steps are validated before they are stored.', {
      botId: { type: 'string' },
      name: { type: 'string', required: true },
      steps: { type: 'array', required: true, items: { type: 'object', properties: {}, additionalProperties: true } },
    }, async (args, exec) => { await runtime.load(); return json(routineStore.save(botFor(args, exec), { name: args.name, steps: args.steps })) })

    register('bot_routine_run', 'Run one saved routine against a machine. Stops at the first failed step and reports where.', {
      botId: { type: 'string' },
      routineId: { type: 'string', required: true },
      machineId: { type: 'string', required: true },
      rootId: { type: 'string', required: true },
    }, async (args, exec) => {
      await runtime.load()
      if (typeof routineExecution?.run !== 'function') throw Object.assign(new Error('ROUTINE_EXECUTION_UNAVAILABLE'), { code: 'ROUTINE_EXECUTION_UNAVAILABLE' })
      const botId = botFor(args, exec)
      const result = await routineExecution.run({ subject: directory.forAgent(exec.agent), botId, routineId: args.routineId, machineId: args.machineId, rootId: args.rootId, context: exec, signal: exec.signal })
      return json(result)
    })
  }

  register('remote_computer_desktop', [
    'See and operate the explicitly granted logged-in Windows desktop.',
    'Screenshot: tool "desktop_screenshot"; the PNG comes back as an image attachment and every later action needs its screenshotId.',
    'Click: tool "desktop_click" with {screenshotId, x, y[, button][, clickCount]}; x/y are pixels in that screenshot (window-local, never scaled by DPI).',
    'Type: tool "desktop_type" with {screenshotId, text}: Unicode is sent directly, never through the clipboard; newline and tab become Enter and Tab.',
    'Keys: tool "desktop_key" with {screenshotId, key[, modifiers]}; keys are Enter, Tab, Escape, Backspace, Delete, ArrowLeft/Right/Up/Down, Home, End, PageUp, PageDown and modifiers ctrl, alt, shift.',
    'Scroll: tool "desktop_scroll" with {screenshotId, delta, x?, y?}; 120 is one notch, positive scrolls up; x/y move the pointer onto the target first.',
    'A screenshotId is single-use and expires 15 seconds after the capture; take a new screenshot after it is used, after any failure and after the window changes.',
  ].join(' '),
    { ...target, tool: { type: 'string', required: true, enum: ['desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll'] }, args: { type: 'json', required: true } },
    async (args, exec) => {
      const { value, status, taskId, attemptId, operationId } = await call(exec, args, args.tool, args.args)
      const result = { ...json(value), taskId, attemptId, operationId, ...(status && status !== 'succeeded' ? { operationStatus: status } : {}) }
      if (args.tool !== 'desktop_screenshot' || value?.mediaType !== 'image/png' || !value.artifactId) return result
      const image = await machines.download(subject(exec), { machineId: args.machineId, rootId: args.rootId, taskId, attemptId, operationId, artifactId: value.artifactId }, { signal: exec.signal })
      const attachments = ctx.get?.('attachments')
      if (typeof attachments?.saveImage !== 'function') return { ...result, attachmentError: 'The Host cannot attach screenshots; artifact metadata is returned instead.' }
      const attachment = await attachments.saveImage({ mediaType: 'image/png', data: Buffer.from(image.content, 'base64'), name: `Remote desktop ${value.screenshotId ?? value.artifactId}` })
      const { artifactId, ...metadata } = result
      return { text: JSON.stringify({ ...metadata, screenshotArtifactId: artifactId, coordinateSpace: 'screenshot-pixels', screenshotSingleUse: true, screenshotLifetimeMs: 15000 }, null, 2), attachment }
    }, DESKTOP_OUTPUT)

  register('remote_computer_operation', 'Read or cancel one original remote operation of this Bot chat. Cancellation never replays the operation or rolls back an already applied effect; only stopConfirmed:true proves the action stopped.',
    { ...target, action: { type: 'string', required: true, enum: ['status', 'cancel'] }, operationId: { type: 'string', required: true } },
    async (args, exec) => json((await call(exec, args, args.action === 'status' ? 'operation_status' : 'operation_cancel', { operationId: args.operationId }, { operationId: args.operationId })).value))
}
