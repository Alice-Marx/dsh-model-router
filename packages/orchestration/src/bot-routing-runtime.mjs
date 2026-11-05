import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { canonicalTaskJson, taskHash, taskRef } from './task-contract.mjs'
import { markTaskModelRequest, managedModelRequest, taskModelRequest } from './model-receipt.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const textOf = content => (Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n') : '')
const digest = value => createHash('sha256').update(value).digest('hex')
const UNKNOWN = code => ({ outcome: 'unknown', summary: { code, stopConfirmed: false } })
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
const READ_TOOLS = new Set(['read', 'glob', 'grep', 'read_file', 'file_read', 'file_list', 'file_search', 'list_directory', 'view_image',
  'bot_library_list', 'bot_library_read', 'bot_library_search', 'bot_task_status', 'bot_task_plan_status', 'list_bots', 'recall',
  'remote_computer_ping', 'remote_computer_list', 'remote_computer_read',
  'model_router_routes', 'model_router_plan', 'model_router_consult', 'model_router_health', 'model_router_tools'])
const UNTRACKED_DELEGATION = new Set(['message_bot', 'post_to_group', 'subagent', 'bot_route_task', 'bot_dispatch', 'bot_handoff_task', 'bot_task_start', 'bot_task_plan_start'])

/** Only task text crosses this boundary; worker/model/machine identity comes from Host state. */
export function parseBotTurnInput(input) {
  const value = JSON.parse(canonicalTaskJson(input))
  if (!value || Object.keys(value).some(key => !['task', 'machineId', 'rootId'].includes(key)) || typeof value.task !== 'string' || !value.task.trim() || Buffer.byteLength(value.task) > 4000) fail('INVALID_BOT_TURN_INPUT')
  for (const key of ['machineId', 'rootId']) if (value[key] !== undefined) taskRef(value[key])
  return { task: value.task.trim(), ...(value.machineId ? { machineId: value.machineId } : {}), ...(value.rootId ? { rootId: value.rootId } : {}) }
}

/**
 * A managed task is a real turn of the selected Bot, with its existing session tools, policy and
 * per-Bot accounting. Delivery is intent, never completion. The journal reference is recorded
 * before followup; only the turn that reads that exact source may produce a terminal receipt.
 * A lost or interrupted worker is observed from durable receipts, never automatically resent.
 */
export function createBotTurnBackends({ ctx, runtime, directory, authority, Database, storeFile, bindingFor, machines = null, readPlan = null, now = Date.now, cancelWaitMs = 1000 }) {
  if (typeof Database !== 'function' || typeof storeFile !== 'string' || !storeFile || typeof bindingFor !== 'function' || typeof ctx?.on !== 'function') fail('BOT_TURN_HOST_SERVICES_REQUIRED')
  if (storeFile !== ':memory:') mkdirSync(dirname(storeFile), { recursive: true })
  const db = new Database(storeFile)
  db.pragma('busy_timeout=5000'); db.pragma('synchronous=FULL')
  if (storeFile !== ':memory:') db.pragma('journal_mode=WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS bot_routed_turns(
    run_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL, reference_json TEXT NOT NULL,
    input_hash TEXT NOT NULL, state TEXT NOT NULL, result_json TEXT, turn_json TEXT, operations_json TEXT NOT NULL DEFAULT '[]', created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bot_routed_deliveries(plan_id TEXT PRIMARY KEY, origin_bot TEXT NOT NULL, report_json TEXT NOT NULL, state TEXT NOT NULL, updated_ms INTEGER NOT NULL);`)
  const rt = () => typeof runtime === 'function' ? runtime() : runtime
  const machineStore = () => typeof machines === 'function' ? machines() : machines
  const waiting = new Map()
  const active = new Map()
  const turns = new Map()
  const watchers = new Map()
  let closed = false
  const get = id => db.prepare('SELECT * FROM bot_routed_turns WHERE run_id=?').get(id)
  const settings = botId => {
    const row = bindingFor(botId)
    if (!row || row.status !== 'available' || !row.settings?.enabled || !row.settings.model || !row.settings.workspaceRef) fail('BOT_TURN_BINDING_UNAVAILABLE')
    return row
  }
  const describe = agent => {
    try { return authority.describe(directory.forAgent(agent)).botId } catch { return null }
  }
  const activeFor = sessionId => {
    const id = active.get(sessionId)
    return id ? waiting.get(id) : null
  }
  const referenceFor = (context, sessionId) => ({ kind: 'bot-turn', runId: `botturn_${digest(context.operationId).slice(0, 48)}`, sessionId,
    marker: { schemaVersion: 1, taskId: context.binding.taskId, attemptId: context.binding.attemptId, operationId: context.operationId, targetHash: context.targetHash } })
  const proofFor = (reference, event, source = 'bot-turn-ended') => ({ schemaVersion: 1, taskId: reference.marker.taskId, attemptId: reference.marker.attemptId, operationId: reference.marker.operationId,
    targetHash: reference.marker.targetHash, referenceHash: taskHash(reference), source, evidenceHash: taskHash({ sessionId: reference.sessionId, turn: event.data?.turn ?? null, kind: event.data?.reason?.kind ?? 'unknown', code: event.data?.reason?.error?.code ?? null, at: event.time ?? now() }) })
  const saveResult = (entry, result, event) => {
    const summary = { ...(result.summary ?? {}), botId: entry.botId, sessionId: entry.sessionId, runId: entry.reference.runId,
      ...(result.outcome === 'unknown' ? {} : { stopConfirmed: true, stopEvidence: result.summary?.notStarted ? 'bot-turn-not-sent' : 'bot-turn-ended', stopProof: proofFor(entry.reference, event, result.summary?.notStarted ? 'bot-turn-not-sent' : 'bot-turn-ended') }) }
    const final = { ...result, summary }
    // The journal has a bounded JSON contract. Keep the full operation evidence in our own table
    // and shorten only the returned view, never the work or its execution budget.
    let encoded
    for (;;) {
      try { encoded = canonicalTaskJson(final); break }
      catch (error) {
        if (error.code !== 'TASK_INPUT_LIMIT') throw error
        if (summary.text?.length > 256) { summary.text = summary.text.slice(0, Math.floor(summary.text.length / 2)); summary.truncated = true; continue }
        if (summary.operations?.length > 1) { summary.operationsTotal = entry.operations.length; summary.operations = summary.operations.slice(0, Math.floor(summary.operations.length / 2)); summary.operationsTruncated = true; continue }
        throw error
      }
    }
    db.prepare('UPDATE bot_routed_turns SET state=?,result_json=?,updated_ms=? WHERE run_id=?').run(result.outcome, encoded, now(), entry.reference.runId)
    entry.resolve(final)
    entry.releaseTools?.()
    waiting.delete(entry.reference.runId)
    if (active.get(entry.sessionId) === entry.reference.runId) active.delete(entry.sessionId)
    return final
  }
  const finish = (entry, event) => {
    const reason = event.data?.reason
    if (!reason || !['completed', 'error', 'aborted'].includes(reason.kind)) return
    const unfinished = entry.operations.filter(operation => !['succeeded', 'failed', 'cancelled'].includes(operation.status))
    if (unfinished.length || entry.unconfirmed || entry.contaminated) return saveResult(entry, UNKNOWN(entry.contaminated ? 'BOT_TURN_MIXED_INPUT' : 'BOT_TURN_REMOTE_OUTCOME_UNKNOWN'), event)
    const outcome = reason.kind === 'completed' ? 'succeeded' : reason.kind === 'aborted' ? 'cancelled' : 'failed'
    const remoteFailed = entry.operations.some(operation => operation.status === 'failed')
    const text = entry.texts.join('\n\n').trim()
    // An empty completed turn proves that the loop stopped, but not that it answered the task.
    const finalOutcome = outcome === 'succeeded' && (!text || remoteFailed) ? 'failed' : outcome
    const code = finalOutcome === 'succeeded' ? null : remoteFailed ? 'BOT_TURN_REMOTE_OPERATION_FAILED' : outcome === 'succeeded' ? 'BOT_TURN_EMPTY_RESULT'
      : reason.kind === 'error' ? String(reason.error?.code ?? 'BOT_TURN_FAILED').slice(0, 128) : 'BOT_TURN_CANCELLED'
    return saveResult(entry, { outcome: finalOutcome, summary: { code, text: text.slice(0, 12000), truncated: text.length > 12000, toolCalls: entry.toolCalls, operations: entry.operations } }, event)
  }
  const offEvent = ctx.on('session/event', (session, event) => {
    if (closed || typeof session?.id !== 'string') return
    if (event.type === 'turn/start') turns.set(session.id, event.data?.turn ?? null)
    if (event.type === 'user/message') {
      const source = event.data?.source
      if (source?.kind !== 'bot' || source.role !== 'routed-task') {
        const running = activeFor(session.id)
        if (running?.read && source?.kind !== 'subagent-settled') running.contaminated = true
        return
      }
      const entry = waiting.get(source.exchangeId)
      if (!entry || entry.sessionId !== session.id || taskHash(source.routedTask ?? null) !== taskHash(entry.reference.marker)) return
      const previous = activeFor(session.id)
      if (previous && previous !== entry) { saveResult(entry, UNKNOWN('BOT_TURN_MIXED_INPUT'), event); return }
      active.set(session.id, entry.reference.runId)
      entry.read = true
      entry.turn = turns.get(session.id) ?? null
      db.prepare('UPDATE bot_routed_turns SET state=?,updated_ms=? WHERE run_id=?').run('running', now(), entry.reference.runId)
      return
    }
    const entry = activeFor(session.id)
    if (!entry?.read) return
    if (event.type === 'turn/start') entry.turn = event.data?.turn ?? null
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') entry.toolCalls += 1
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      if (!content?.some?.(block => block?.type === 'tool-call')) {
        const text = textOf(content)
        if (text) entry.texts = [text]
      }
    }
    if (event.type === 'turn/end') {
      if (entry.turn !== null && entry.turn !== undefined && event.data?.turn !== undefined && taskHash(entry.turn) !== taskHash(event.data.turn)) return
      // A switch/steer continuation is still open; the next marked turn owns the conclusion.
      if (rt()?.switchJobs?.()?.some?.(job => job.botId === entry.botId)) return
      if (entry.ending) return
      entry.ending = true
      void (async () => {
        try { await ctx.sessions.flush(session); if (!closed && waiting.has(entry.reference.runId)) finish(entry, event) }
        catch { if (!closed && waiting.has(entry.reference.runId)) saveResult(entry, UNKNOWN('BOT_TURN_FLUSH_UNCONFIRMED'), event) }
      })()
    }
  })
  const currentIdentity = exec => {
    const sessionId = exec?.agent?.session?.id ?? exec?.agent?.id
    const entry = activeFor(sessionId)
    if (!entry || describe(exec?.agent) !== entry.botId) return null
    return { ...entry.reference.marker, botId: entry.botId, sessionId, runId: entry.reference.runId, machineId: entry.workspace.machineId, rootId: entry.workspace.rootId }
  }
  const offTools = ctx.on('tools/result', (execution, result) => {
    if (closed) return
    const identity = currentIdentity(execution)
    const entry = identity ? waiting.get(identity.runId) : null
    if (!entry) return
    const value = result?.value
    if (value?.status === 'unknown' || value?.outcome === 'unknown' || value?.operationStatus === 'unknown' || value?.status === 'cancel_pending' || value?.status === 'needs-reconciliation') entry.unconfirmed = true
  })
  const tagModelRequest = options => {
    const entry = activeFor(options?.sessionId)
    if (!entry || managedModelRequest(options) || taskModelRequest(options)) return
    // Existing accounting still owns every amount and admission. This only links its receipt to
    // the already admitted task; unknown price/usage stays unknown in that accounting service.
    markTaskModelRequest(options, { ...entry.reference.marker, botId: entry.botId, provider: options.provider, model: options.model })
  }
  const recordOperation = (identity, operation) => {
    if (!identity?.runId) return
    const entry = waiting.get(identity.runId)
    if (!entry || entry.reference.marker.attemptId !== identity.attemptId) fail('BOT_TURN_OPERATION_IDENTITY_MISMATCH')
    const value = { machineId: operation.machineId, rootId: operation.rootId, operationId: operation.operationId, tool: operation.tool, status: operation.status ?? 'unknown',
      ...(operation.reference ? { reference: operation.reference } : {}), ...(operation.stopConfirmed !== undefined ? { stopConfirmed: operation.stopConfirmed === true } : {}) }
    const index = entry.operations.findIndex(item => item.operationId === value.operationId)
    if (index < 0) entry.operations.push(value)
    else entry.operations[index] = value
    db.prepare('UPDATE bot_routed_turns SET operations_json=?,updated_ms=? WHERE run_id=?').run(JSON.stringify(entry.operations), now(), identity.runId)
  }
  const assertOperationReady = (identity, tool) => {
    const entry = waiting.get(identity?.runId)
    if (!entry) fail('BOT_TURN_OPERATION_IDENTITY_MISMATCH')
    if (['machine_ping', 'fs_list', 'fs_read', 'artifact_stat', 'artifact_read', 'operation_status', 'operation_cancel', 'desktop_screenshot', 'browser_snapshot', 'browser_close'].includes(tool)) return
    if (entry.operations.some(operation => !['succeeded', 'failed', 'cancelled'].includes(operation.status))) fail('BOT_TURN_REMOTE_RECONCILIATION_REQUIRED')
  }
  const workspaceFor = (botId, input = {}) => {
    const row = settings(botId)
    const saved = row.settings.workspaceRef
    const machineId = input.machineId ?? saved.machineId
    const grant = row.settings.machineGrants?.find(item => item.machineId === machineId && (!input.rootId || item.rootId === input.rootId))
    const rootId = input.rootId ?? (machineId === saved.machineId ? saved.rootId : grant?.rootId)
    if (machineId === saved.machineId && rootId === saved.rootId) return { ...saved }
    if (!grant || grant.rootId !== rootId) fail('BOT_TURN_MACHINE_BINDING_UNAVAILABLE')
    const remote = machineStore()?.readModel().items.some(item => (item.id ?? item.machineId) === machineId)
    if (!remote && machineId !== saved.machineId) fail('BOT_TURN_MACHINE_BINDING_UNAVAILABLE')
    return { kind: remote ? 'remote' : saved.kind, machineId, rootId }
  }
  const targetFor = (subject, input = {}) => {
    const botId = authority.describe(subject).botId
    const row = settings(botId)
    const workspace = workspaceFor(botId, input)
    let machineRevision = row.revision ?? 1, bindingRevision = row.revision ?? 1
    if (workspace.kind === 'remote') {
      const machine = machineStore()?.readModel().items.find(item => (item.id ?? item.machineId) === workspace.machineId)
      const grant = machine?.bindings?.find(item => item.botId === botId && !item.revoked && item.roots?.includes(workspace.rootId))
      if (!machine || machine.status === 'revoked' || !grant) fail('BOT_TURN_MACHINE_BINDING_UNAVAILABLE')
      machineRevision = machine.revision; bindingRevision = grant.revision
    }
    return { machineId: workspace.machineId, workspaceId: `bot_workspace_${digest(`${workspace.machineId}/${workspace.rootId}`).slice(0, 48)}`, location: workspace.kind,
      remoteMachineRevision: Math.max(1, machineRevision), remoteBindingRevision: Math.max(1, bindingRevision) }
  }
  const recoverReceipt = async (row, reference, signal) => {
    const history = rt()?.eventsBackwards
    if (typeof history !== 'function' || waiting.has(reference.runId) || row.result_json) return
    let terminal = null, texts = [], toolCalls = 0, matched = false, otherInputs = 0
    for await (const event of history.call(rt(), reference.sessionId, signal)) {
      signal?.throwIfAborted()
      if (event.type === 'turn/end') { terminal = event; texts = []; toolCalls = 0; matched = false; otherInputs = 0 }
      else if (event.type === 'assistant/message' && terminal && texts.length === 0) {
        const content = event.data?.message?.content
        if (!content?.some?.(block => block?.type === 'tool-call')) { const text = textOf(content); if (text) texts = [text] }
      } else if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') toolCalls++
      else if (event.type === 'user/message') {
        const source = event.data?.source
        if (source?.kind === 'bot' && source.role === 'routed-task' && source.exchangeId === reference.runId && taskHash(source.routedTask ?? null) === taskHash(reference.marker)) matched = true
        else otherInputs++
      } else if (event.type === 'turn/start') {
        if (matched) {
          if (!terminal || terminal.data?.turn !== event.data?.turn) return
          const entry = { reference, botId: row.bot_id, sessionId: row.session_id, resolve: () => {}, operations: JSON.parse(row.operations_json), texts, toolCalls, contaminated: otherInputs > 0 }
          finish(entry, terminal)
          return
        }
        terminal = null; texts = []; toolCalls = 0; matched = false; otherInputs = 0
      }
    }
  }
  const observe = async ({ task, reference, signal }) => {
    if (reference?.kind !== 'bot-turn') return { outcome: 'unknown', reason: 'BOT_TURN_REFERENCE_MISSING' }
    const expected = { schemaVersion: 1, taskId: task.taskId, attemptId: task.attemptId, operationId: task.operationId, targetHash: task.input.targetHash }
    if (taskHash(reference.marker) !== taskHash(expected)) return { outcome: 'unknown', reason: 'BOT_TURN_REFERENCE_MISMATCH' }
    let row = get(reference.runId)
    if (!row || row.reference_json !== canonicalTaskJson(reference) || row.session_id !== reference.sessionId) return { outcome: 'unknown', reason: 'BOT_TURN_RECEIPT_MISSING' }
    if (!TERMINAL.has(row.state) || !row.result_json) {
      try { await recoverReceipt(row, reference, signal); row = get(reference.runId) } catch { return { outcome: 'unknown', reason: 'BOT_TURN_HISTORY_UNCONFIRMED' } }
      if (!TERMINAL.has(row.state) || !row.result_json) return { outcome: 'unknown', reason: 'BOT_TURN_NOT_TERMINAL' }
    }
    const result = JSON.parse(row.result_json)
    return { outcome: result.outcome, reason: result.summary.code ?? 'BOT_TURN_ENDED', summary: result.summary, referenceHash: taskHash(reference), evidenceHash: taskHash(result) }
  }
  const run = async (context, effect) => {
    if (closed) return { outcome: 'failed', summary: { code: 'BOT_TURN_CLOSED', notStarted: true } }
    const host = rt()
    let reference, entry, abort
    try {
      context.signal.throwIfAborted()
      settings(context.ownerBotId)
      await host.load()
      const sessionId = host.chatOf(context.ownerBotId)
      taskRef(sessionId)
      await host.ensureCapabilities?.(sessionId)
      const agent = await host.resolveAgent(sessionId)
      if (describe(agent) !== context.ownerBotId) fail('BOT_TURN_SUBJECT_MISMATCH')
      if ([...waiting.values()].some(value => value.sessionId === sessionId) || host.live?.get(sessionId)?.turn !== undefined) fail('BOT_TURN_BUSY')
      reference = referenceFor(context, sessionId)
      const old = get(reference.runId)
      if (old) {
        if (old.reference_json !== canonicalTaskJson(reference) || old.input_hash !== taskHash(context.input)) fail('BOT_TURN_REQUEST_CONFLICT')
        return old.result_json ? JSON.parse(old.result_json) : UNKNOWN('BOT_TURN_PREVIOUS_DISPATCH_UNCONFIRMED')
      }
      db.prepare('INSERT INTO bot_routed_turns(run_id,bot_id,session_id,reference_json,input_hash,state,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?)').run(reference.runId, context.ownerBotId, sessionId, canonicalTaskJson(reference), taskHash(context.input), 'prepared', now(), now())
      context.checkpoint(reference)
      let resolve
      const done = new Promise(r => { resolve = r })
      const workspace = workspaceFor(context.ownerBotId, context.input)
      entry = { reference, botId: context.ownerBotId, sessionId, workspace, resolve, read: false, turn: null, texts: [], toolCalls: 0, operations: [], callNumber: 0 }
      const tools = agent.ctx?.get?.('tools')
      if (typeof tools?.guard !== 'function') fail('BOT_TURN_TOOL_SCOPE_UNAVAILABLE')
      entry.releaseTools = tools.guard(execution => {
        if (UNTRACKED_DELEGATION.has(execution.name)) return 'BOT_TURN_NESTED_EXECUTION_UNTRACKED'
        return effect === 'read' && !READ_TOOLS.has(execution.name) ? 'BOT_TURN_READ_ONLY' : undefined
      })
      waiting.set(reference.runId, entry)
      const cancelled = new Promise(resolveCancel => {
        abort = () => {
          // A cancel request is never stop proof. Give the matching turn a chance to acknowledge;
          // otherwise keep the receipt uncertain and let a later terminal event be reconciled.
          if (active.get(sessionId) === reference.runId) {
            try { agent.cancel({ kind: 'hook', reason: 'bot-routing/task-cancelled' }) } catch {}
          }
          const timer = setTimeout(() => resolveCancel(UNKNOWN('BOT_TURN_STOP_UNCONFIRMED')), cancelWaitMs)
          done.finally(() => clearTimeout(timer)).catch(() => {})
        }
        context.signal.addEventListener('abort', abort, { once: true })
      })
      context.beforeRequest()
      context.signal.throwIfAborted()
      const message = createUserMessage({ content: [{ type: 'text', text: `[Assigned workspace: machineId=${workspace.machineId}, rootId=${workspace.rootId}. Use your committed permissions for this task.]\n${context.input.task}` }], source: { kind: 'bot', form: 'relay', role: 'routed-task', exchangeId: reference.runId, senderName: 'Task router', routedTask: reference.marker } })
      entry.dispatched = true
      agent.followup(message)
      await ctx.sessions.flush(agent.session)
      const result = await Promise.race([done, cancelled])
      return result
    } catch (error) {
      if (entry && !entry.dispatched) return saveResult(entry, { outcome: context.signal.aborted ? 'cancelled' : 'failed', summary: { code: error.code ?? 'BOT_TURN_NOT_STARTED', notStarted: true } }, { data: { reason: { kind: 'not-sent' } } })
      if (reference) return UNKNOWN(error.code ?? 'BOT_TURN_DELIVERY_UNCONFIRMED')
      return { outcome: context.signal.aborted ? 'cancelled' : 'failed', summary: { code: error.code ?? 'BOT_TURN_NOT_STARTED', notStarted: true } }
    } finally { if (abort) context.signal.removeEventListener('abort', abort) }
  }
  const backend = effect => Object.freeze({ id: effect === 'read' ? 'bot-turn-read' : 'bot-turn-write', version: 'bot-turn-v1', effect, location: 'local', machineId: 'bot-host', workspaceId: 'bot-workspace',
    capability: 'execution/bot-turn', retryCapability: 'execution/bot-turn-retry', reconcileCapability: 'execution/bot-turn-observe', requiresExecutionInput: true,
    ...(effect === 'workspace-write' ? { writeContract: 'tracked-bot-turn-v1' } : {}),
    canObserve: (subject, target, input) => { try { return taskHash(targetFor(subject, input)) === taskHash({ machineId: target.machineId, workspaceId: target.workspaceId, location: target.location, remoteMachineRevision: target.remoteMachineRevision, remoteBindingRevision: target.remoteBindingRevision }) } catch { return false } },
    parse: parseBotTurnInput, targetFor, run: context => run(context, effect), reconcile: observe })

  const watchPlan = report => {
    if (typeof readPlan !== 'function' || !report?.planId) return
    const previousDelivery = db.prepare('SELECT state FROM bot_routed_deliveries WHERE plan_id=?').get(report.planId)?.state
    if (previousDelivery && previousDelivery !== 'waiting') return
    db.prepare('INSERT OR IGNORE INTO bot_routed_deliveries VALUES(?,?,?,?,?)').run(report.planId, report.originBotId, canonicalTaskJson(report), 'waiting', now())
    if (watchers.has(report.planId)) return
    let busy = false
    const poll = async () => {
      if (closed || busy) return
      busy = true
      try {
        const view = await readPlan(report)
        if (!view || !['succeeded', 'failed', 'cancelled', 'blocked', 'needs-reconciliation'].includes(view.state)) return
        const pieces = view.packages.map(item => `${item.targetBotId}: ${item.state}${item.result?.summary?.text ? `\n${item.result.summary.text}` : ''}${item.result?.code ?? item.result?.summary?.code ? `\n${item.result?.code ?? item.result?.summary?.code}` : ''}`)
        // Mark before dispatch: a crash after enqueue cannot cause a duplicate replay to the Bot.
        db.prepare('UPDATE bot_routed_deliveries SET state=?,updated_ms=? WHERE plan_id=?').run('sending', now(), report.planId)
        await rt().deliver({ fromId: report.botId, toId: report.originBotId, role: 'routed-result', exchangeId: `route_result_${digest(report.planId).slice(0, 40)}`, text: `Routed task ${report.planId}: ${view.state}\n${pieces.join('\n\n')}` })
        db.prepare('UPDATE bot_routed_deliveries SET state=?,updated_ms=? WHERE plan_id=?').run('delivered', now(), report.planId)
        clearInterval(watchers.get(report.planId)); watchers.delete(report.planId)
      } catch {
        // An enqueued reply with an uncertain flush is never blindly replayed.
        if (!closed && db.prepare('SELECT state FROM bot_routed_deliveries WHERE plan_id=?').get(report.planId)?.state === 'sending') {
          db.prepare('UPDATE bot_routed_deliveries SET state=?,updated_ms=? WHERE plan_id=?').run('uncertain', now(), report.planId)
          clearInterval(watchers.get(report.planId)); watchers.delete(report.planId)
        }
      }
      finally { busy = false }
    }
    const timer = setInterval(() => { void poll() }, 200); timer.unref()
    watchers.set(report.planId, timer)
    void poll()
  }
  for (const row of db.prepare("SELECT report_json FROM bot_routed_deliveries WHERE state='waiting'").all()) watchPlan(JSON.parse(row.report_json))
  return Object.freeze({ backends: Object.freeze([backend('read'), backend('workspace-write')]), currentIdentity, tagModelRequest, recordOperation, assertOperationReady, observe, watchPlan,
    close() { if (closed) return; closed = true; offEvent?.(); offTools?.(); for (const timer of watchers.values()) clearInterval(timer); watchers.clear(); for (const entry of waiting.values()) entry.resolve(UNKNOWN('BOT_TURN_HOST_CLOSED')); waiting.clear(); active.clear(); db.close() } })
}
