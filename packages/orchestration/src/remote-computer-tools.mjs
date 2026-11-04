import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { replayRoutine } from './bot-routine.mjs'

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

export function registerRemoteComputerTools(ctx, { runtime, directory, machines, taskService, remoteCliBackend = null, operatorSubject = null, botRouting = null, routineStore = null, botIdFor = null }) {
  // A session that is not a Bot (the operator's own agent) is otherwise refused as
  // UNKNOWN_SUBJECT. When passthrough is enabled the Host supplies the Main Bot's subject, so the
  // call carries that Bot's grants and audit trail instead of a second permission set.
  const subject = exec => directory.forAgent(exec.agent) ?? (typeof operatorSubject === 'function' ? operatorSubject() : null)
  const register = (name, description, parameters, execute, output = JSON_OUTPUT) => ctx.tools.register(defineTool({ name, description, parameters, output, execute }))
  const call = async (exec, args, tool, business, identity = {}) => {
    await runtime.load()
    const session = remoteSessionIdentity(exec)
    const taskId = identity.taskId ?? session.taskId
    const attemptId = identity.attemptId ?? session.attemptId
    const operationId = identity.operationId ?? `operation-${randomUUID()}`
    const record = await machines.call(subject(exec), { machineId: args.machineId, rootId: args.rootId, taskId, attemptId, operationId,
      tool, args: business, ...(identity.operationId || tool.startsWith('desktop_') || tool.startsWith('browser_') ? { operationId } : {}) }, { signal: exec.signal })
    const { value, status } = operationOutcome(record, tool)
    return { value, record, status, taskId, attemptId, operationId }
  }
  const target = {
    machineId: { type: 'string', required: true },
    rootId: { type: 'string', required: true },
  }

  // The Main Bot consults routing before it hands work out. This reads the same decision the
  // workbench shows: it dispatches nothing, binds nothing and spends nothing, so a Bot cannot
  // widen its own reach by asking who should do something.
  if (botRouting && typeof botRouting.decide === 'function') {
    register('bot_route_task', 'Decide which Bot should take a task, and why. A preview only: it dispatches nothing and grants nothing.', {
      text: { type: 'string', required: true },
      pinnedBotId: { type: 'string' },
      requiresMachine: { type: 'boolean' },
      machineId: { type: 'string' },
      requiredTools: { type: 'array', items: { type: 'string' } },
    }, async args => json(botRouting.decide({
      text: args.text,
      pinnedBotId: args.pinnedBotId ?? '',
      requiresMachine: args.requiresMachine === true,
      machineId: args.machineId ?? '',
      requiredTools: Array.isArray(args.requiredTools) ? args.requiredTools : [],
    })))
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
    async (args, exec) => { await runtime.load(); const { requestKey, ...input } = args; return taskService.submit(subject(exec), { requestKey, backend: 'remote-write', input }) })

  if (taskService) register('remote_computer_command', 'Run an owner-approved argv command in the remote container profile as a tracked Task. No shell string, executable path or automatic retry is accepted.',
    { requestKey: { type: 'string', required: true }, ...target, workspaceRelativePath: { type: 'string', required: true }, argv: { type: 'array', required: true }, timeoutMs: { type: 'integer' } },
    async (args, exec) => { await runtime.load(); const { requestKey, ...input } = args; return taskService.submit(subject(exec), { requestKey, backend: 'remote-command', input }) })

  register('remote_computer_browser', 'Use the current Bot\'s granted remote browser. All browser actions of one Bot chat share one browser session; never ask for a task id.',
    { ...target, tool: { type: 'string', required: true, enum: ['browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_script', 'browser_upload', 'browser_download', 'browser_close'] }, args: { type: 'json', required: true } },
    async (args, exec) => {
      const { value, status, taskId, attemptId, operationId } = await call(exec, args, args.tool, args.args)
      return { ...json(value), taskId, attemptId, operationId, ...(status && status !== 'succeeded' ? { operationStatus: status } : {}) }
    })

  // Routines a Bot can keep and run again. The store owns ids and validation; this surface only
  // moves a saved routine onto one machine, stopping at the first failed step.
  if (routineStore) {
    const botFor = args => {
      const asked = typeof args?.botId === 'string' && args.botId !== '' ? args.botId : null
      return asked ?? (typeof botIdFor === 'function' ? botIdFor(exec => exec) : null)
    }
    register('bot_routine_list', 'List the routines saved for one Bot. Steps are not returned — use run or inspect.', {
      botId: { type: 'string', required: true },
    }, async args => json(routineStore.inspect(args.botId)))

    register('bot_routine_save', 'Save a recorded routine for one Bot. Steps are validated before they are stored.', {
      botId: { type: 'string', required: true },
      name: { type: 'string', required: true },
      steps: { type: 'array', required: true, items: { type: 'object' } },
    }, async args => json(routineStore.save(args.botId, { name: args.name, steps: args.steps })))

    register('bot_routine_run', 'Run one saved routine against a machine. Stops at the first failed step and reports where.', {
      botId: { type: 'string', required: true },
      routineId: { type: 'string', required: true },
      machineId: { type: 'string', required: true },
      rootId: { type: 'string', required: true },
    }, async (args, exec) => {
      const routine = routineStore.get(args.botId, args.routineId)
      const result = await replayRoutine(routine, {
        signal: exec.signal,
        act: async step => {
          const mapped = routineStepToTool(step)
          if (!mapped) { await new Promise(resolve => setTimeout(resolve, step.ms)); return }
          await call(exec, { machineId: args.machineId, rootId: args.rootId }, mapped.tool, mapped.args)
        },
      })
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
