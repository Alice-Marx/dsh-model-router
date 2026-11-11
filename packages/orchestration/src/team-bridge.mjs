import { createHash, randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { TEAM_CODES, parseTeamToolArgs, projectCoordinateArgs } from './team-tool-contract.mjs'
import { createTeamAssignmentStore, computeBriefHash, standingThreadKey, workThreadConversationKey, assertNoCycle, assertDepth } from './team-assignment-store.mjs'
import { createTeamScheduler } from './team-scheduler.mjs'

const fail = (code, extra = {}) => { throw Object.assign(new Error(code), { code, ...extra }) }
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const textOf = content => Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') : ''
const composeBrief = row => `[Team assignment from ${row.parentBot}; mode ${row.mode}]\n${row.doneWhen ? `Done when: ${row.doneWhen}\n` : ''}${row.brief}`
const composeResult = row => `[Team result from ${row.targetBot}; assignment ${row.assignmentId}; ${row.outcome}${row.resultCode ? ` (${row.resultCode})` : ''}]\n${row.resultText || '(no result text)'}`
const unknown = code => ({ outcome: 'unknown', code })

/** Fold installed SDK events, requiring the exact identified user message in one
 * balanced turn. A later assignment, an injected extra user, or an unterminated
 * request cannot supply this request's answer.
 */
export function teamReceiptFromEvents(events, requestId, role = 'assign-task') {
  let turn = null, active = false, mixed = false, text = '', result = null, matches = 0
  for (const event of events) {
    if (event.type === 'turn/start') { turn = event.data?.turn; active = false; mixed = false; text = '' }
    if (event.type === 'user/message') {
      const source = event.data?.source
      if (source?.kind === 'bot' && source.role === role && source.exchangeId === requestId) { matches++; active = true }
      else if (active && !['snapshot', 'recall'].includes(source?.form)) mixed = true
    }
    if (event.type === 'assistant/message' && active) {
      const content = event.data?.message?.content
      if (!content?.some(block => block.type === 'tool-call')) text = textOf(content)
    }
    if (event.type === 'turn/end' && active && event.data?.turn === turn) {
      const reason = event.data.reason
      result = mixed ? unknown('TEAM_TARGET_MIXED_INPUT') : reason?.kind === 'completed' ? { outcome: 'succeeded', text } : reason?.kind === 'aborted' ? { outcome: 'cancelled', code: 'TEAM_TARGET_CANCELLED' } : { outcome: 'failed', code: 'TEAM_TARGET_FAILED' }
      active = false
    }
  }
  return matches === 1 && result ? result : unknown(matches > 1 ? 'TEAM_TARGET_DUPLICATE_REQUEST' : 'TEAM_TARGET_NOT_TERMINAL')
}

export function createIntegratedTeamBridge({ rt, directory, authority, lifecycle, flush, threadHost = () => null, cancelWaitMs = 10000 } = {}) {
  if (!rt || !directory || !authority || !lifecycle || typeof flush !== 'function') throw new TypeError('TEAM_BRIDGE_DEPENDENCIES_REQUIRED')
  if (!Number.isSafeInteger(cancelWaitMs) || cancelWaitMs < 10 || cancelWaitMs > 60000) throw new TypeError('TEAM_CANCEL_WAIT_INVALID')
  const subjectBot = agent => authority.describe(directory.forAgent(agent)).botId
  const eventsFor = async (sessionId, signal) => {
    if (typeof rt.eventsBackwards !== 'function') fail('TEAM_TARGET_HISTORY_UNAVAILABLE')
    const events = []
    for await (const event of rt.eventsBackwards(sessionId, signal)) { events.push(event); if (events.length > 16384) fail('TEAM_TARGET_HISTORY_LIMIT') }
    return events.reverse()
  }
  const owns = (botId, sessionId) => {
    const bot = lifecycle.committedBot(botId)
    if (!bot) return false
    if ((bot.sessionId ?? bot.id) === sessionId) return true
    if (bot.threads?.some(thread => thread.sessionId === sessionId && !thread.archivedAt) !== true) return false
    const host = threadHost()
    if (host) {
      try {
        const found = host.service.threadBySession(sessionId)
        const gate = found?.botId === botId ? host.service.probeSendable({ botId, threadId: found.threadId }) : null
        return gate?.ok === true && gate.sessionId === sessionId
      } catch { return false }
    }
    return true
  }
  const readTarget = async row => {
    if (!row.targetRef?.sessionId || !row.requestId && !row.targetRequestId || !owns(row.targetBot, row.targetRef.sessionId)) return unknown('TEAM_TARGET_REFERENCE_UNCONFIRMED')
    try { return teamReceiptFromEvents(await eventsFor(row.targetRef.sessionId, row.signal), row.requestId ?? row.targetRequestId) }
    catch { return unknown('TEAM_TARGET_HISTORY_UNCONFIRMED') }
  }
  const resolve = async (botId, sessionId) => {
    await rt.load(); await rt.ensureCapabilities?.(sessionId)
    if (!owns(botId, sessionId)) fail('TEAM_SESSION_RETIRED', { started: false, retired: true })
    const agent = await rt.resolveAgent(sessionId)
    if (subjectBot(agent) !== botId) fail('TEAM_TARGET_SUBJECT_MISMATCH', { started: false })
    if (typeof agent.whenIdle !== 'function') fail('TEAM_AGENT_API_UNAVAILABLE', { started: false })
    return agent
  }
  const submit = async (row, sessionId, role, requestId, text) => {
    // Followup is the actual public SDK admission. No owner RPC, fake Agent or
    // arbitrary two-second completion timer. whenIdle is followed by a flush and
    // exact request scan; quiescence alone is not a receipt.
    let off = () => {}, agent, submitted = false, finished = false, receipt = null, failure = null
    try {
      agent = await resolve(role === 'assign-task' ? row.targetBot : row.parentBot, sessionId)
      row.validate?.(); row.signal?.throwIfAborted()
      if (agent.status !== 'idle' || rt.live?.get(sessionId)?.turn !== undefined) return { started: false, code: TEAM_CODES.TARGET_BUSY }
      const prior = await eventsFor(sessionId, row.signal)
      const existing = prior.some(event => event.type === 'user/message' && event.data?.source?.kind === 'bot' && event.data.source.exchangeId === requestId && event.data.source.role === role)
      if (existing) return role === 'assign-task' ? { started: true, ...teamReceiptFromEvents(prior, requestId, role), executionFinished: true } : { resumed: true, replayed: true, executionFinished: true }
      row.validate?.(); row.signal?.throwIfAborted()
      const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'bot', form: 'relay', role, exchangeId: requestId, senderName: 'Team coordinator' } })
      const aborted = new Promise(resolve => {
        const stop = () => { try { agent.cancel({ kind: 'hook', reason: 'team-assignment-cancelled' }) } catch {}; resolve('aborted') }
        row.signal?.addEventListener('abort', stop, { once: true }); off = () => row.signal?.removeEventListener('abort', stop)
      })
      submitted = true // conservative if public followup throws after acceptance
      agent.followup(message)
      if (await flush(agent.session) === false) fail('TEAM_SESSION_DURABILITY_UNAVAILABLE')
      const state = await Promise.race([agent.whenIdle().then(() => 'idle'), aborted])
      finished = state === 'idle'
      if (await flush(agent.session) === false) fail('TEAM_SESSION_DURABILITY_UNAVAILABLE')
      receipt = role === 'assign-result' ? { resumed: true, executionFinished: finished } : { started: true, ...(finished ? await readTarget({ ...row, requestId }) : unknown('TEAM_TARGET_STOP_UNCONFIRMED')), executionFinished: finished }
      return receipt
    } catch (error) { failure = error; if (!submitted) error.started = false; error.executionFinished = !submitted || finished; throw error }
    finally {
      // A result keeps its durable ancestry frame for the real resumed turn.
      // Cancellation has a bounded convergence wait; a missing idle receipt
      // preserves an uncertain execution fence instead of freeing that frame.
      if (submitted && !finished) {
        try { agent.cancel({ kind: 'hook', reason: 'team-assignment-cancelled' }) } catch {}
        let timer
        try { finished = await Promise.race([agent.whenIdle().then(() => true, () => false), new Promise(resolve => { timer = setTimeout(() => resolve(false), cancelWaitMs) })]) }
        finally { clearTimeout(timer) }
      }
      if (receipt) receipt.executionFinished = finished
      if (failure) failure.executionFinished = !submitted || finished
      off()
    }
  }
  return Object.freeze({
    hooks: { createSession: typeof rt.createSession === 'function', addThreadSession: typeof rt.addThreadSession === 'function' },
    async resolveTargetRef(row) {
      const bot = lifecycle.committedBot(row.targetBot)
      if (!bot) fail(TEAM_CODES.TARGET_NOT_COMMITTED)
      const host = threadHost()
      if (host?.service?.create && host?.service?.ensureSession) {
        const { thread } = host.service.create({ botId: row.targetBot, name: `Team: ${row.parentBot} → ${row.targetBot}`, requestKey: `team-${digest(row.workThreadKey).slice(0, 64)}` })
        await host.service.ensureSession({ botId: row.targetBot, threadId: thread.threadId })
        const gate = await host.sendGate({ botId: row.targetBot, threadId: thread.threadId })
        if (!gate?.ok || !owns(row.targetBot, gate.sessionId)) fail(gate?.code ?? 'TEAM_SESSION_COMMIT_UNCONFIRMED')
        return { mode: 'integration', sessionId: gate.sessionId, workThreadKey: row.workThreadKey, catalogThreadId: thread.threadId }
      }
      const prior = bot.threads?.find(thread => thread.threadId === row.workThreadKey && !thread.archivedAt)
      if (prior) return { mode: 'integration', sessionId: prior.sessionId, workThreadKey: row.workThreadKey }
      if (!rt.createSession || !rt.addThreadSession) fail('TEAM_SESSION_FACTORY_REQUIRED')
      const title = `Team: ${row.parentBot} → ${row.targetBot}`
      const sessionId = await rt.createSession(title, { dir: bot.workDir })
      await rt.addThreadSession(row.targetBot, row.workThreadKey, sessionId, { name: title })
      if (!owns(row.targetBot, sessionId)) fail('TEAM_SESSION_COMMIT_UNCONFIRMED')
      return { mode: 'integration', sessionId, workThreadKey: row.workThreadKey }
    },
    dispatchTarget: row => submit(row, row.targetRef.sessionId, 'assign-task', row.requestId, composeBrief(row)),
    readTarget,
    captureOrigin({ callerBotId, sessionId }) { if (!owns(callerBotId, sessionId)) fail('TEAM_ORIGIN_UNCONFIRMED'); return { mode: 'integration', sessionId } },
    originCurrent: (botId, origin) => origin.mode === 'integration' && owns(botId, origin.sessionId),
    resumeSender(row) { if (!owns(row.parentBot, row.origin?.sessionId)) return { started: false, retired: true }; return submit(row, row.origin.sessionId, 'assign-result', `team-result-${row.assignmentId}`, composeResult(row)) },
    async cancelTarget(row) { if (row.targetRef?.sessionId) { const agent = await resolve(row.targetBot, row.targetRef.sessionId); agent.cancel({ kind: 'hook', reason: 'team-assignment-cancelled' }) } },
    isBusy: botId => rt.live?.get(rt.chatOf(botId))?.turn !== undefined,
  })
}

export function createIndependentTeamBridge({ runtime } = {}) {
  if (typeof runtime !== 'function') throw new TypeError('TEAM_BRIDGE_REQUIRES_RUNTIME')
  const api = () => { const adapter = runtime(); if (!adapter?.workThreadTurn || !adapter?.resumeTeamTurn) fail('TEAM_WORKTHREAD_UNAVAILABLE'); return adapter }
  const readTarget = row => {
    const receipt = api().workThreadRead(row.targetBot, row.targetRef.workThreadKey, row.requestId ?? row.targetRequestId)
    return receipt.hasConfirmedAnswer ? { outcome: 'succeeded', text: receipt.answer } : unknown(receipt.hasBrief ? 'TEAM_TARGET_ANSWER_UNCONFIRMED' : 'TEAM_TARGET_REQUEST_UNCONFIRMED')
  }
  return Object.freeze({
    resolveTargetRef: row => ({ mode: 'independent', workThreadKey: row.workThreadKey, conversationId: `teamwt-${workThreadConversationKey(row.targetBot, row.workThreadKey)}` }),
    async dispatchTarget(row) {
      row.validate?.()
      try { const result = await api().workThreadTurn({ botId: row.targetBot, workThreadId: row.targetRef.workThreadKey, conversationId: row.targetRef.conversationId, input: composeBrief(row), requestId: row.requestId, signal: row.signal, consult: row.mode === 'consult', validate: row.validate }); return { started: true, outcome: 'succeeded', text: result.answer } }
      catch (error) { if (error.code === 'BOT_BUSY') return { started: false, code: TEAM_CODES.TARGET_BUSY }; return { started: true, ...readTarget(row), executionFinished: true } }
    },
    readTarget,
    captureOrigin: row => api().captureTeamOrigin({ botId: row.callerBotId, conversationId: row.conversationId, workThreadId: row.workThreadId }),
    originCurrent: (botId, origin) => api().teamOriginCurrent(botId, origin),
    async resumeSender(row) {
      try { return { ...await api().resumeTeamTurn({ botId: row.parentBot, origin: row.origin, requestId: `team-result-${row.assignmentId}`, input: composeResult(row), signal: row.signal, validate: row.validate }), executionFinished: true } }
      catch (error) { error.executionFinished = true; throw error }
    },
    cancelTarget() {},
    isBusy: botId => api().busyBots?.().includes(botId) === true,
  })
}

export function createTeamBridge({ integrated, independent, serving }) {
  const forBot = botId => { const bridge = serving.readMode(botId) === 'integration' ? integrated : serving.readMode(botId) === 'independent' ? independent : null; if (!bridge) fail('TEAM_BRIDGE_UNAVAILABLE'); return bridge }
  // Recovery uses the recorded mode: moving a Bot cannot reinterpret an old receipt.
  const forRef = ref => ref?.mode === 'integration' ? integrated : ref?.mode === 'independent' ? independent : null
  return Object.freeze({
    resolveTargetRef: row => forBot(row.targetBot).resolveTargetRef(row),
    dispatchTarget: row => forRef(row.targetRef).dispatchTarget(row),
    readTarget: row => forRef(row.targetRef)?.readTarget(row) ?? unknown('TEAM_BRIDGE_UNAVAILABLE'),
    resumeSender: row => forRef(row.origin).resumeSender(row),
    cancelTarget: row => forRef(row.targetRef)?.cancelTarget(row),
    captureOrigin: row => forBot(row.callerBotId).captureOrigin(row),
    originCurrent: (botId, origin) => serving.readMode(botId) === origin?.mode && forRef(origin)?.originCurrent(botId, origin) === true,
    isBusy: botId => typeof serving.busy === 'function' ? serving.busy(botId) : forBot(botId).isBusy(botId),
  })
}

/** Both doors supply Host-resolved origin/turn/call metadata, never model args. */
export function createTeamCoordination({ Database, file, rt = null, directory, authority, lifecycle, serving, runtime = () => null, policy = null, sessionEvents = null, flush = null, integrated = null, independent = null, threadHost = () => null, now = Date.now, limits = {} } = {}) {
  const maxDepth = limits.maxDepth ?? 4
  const store = createTeamAssignmentStore({ Database, file, now })
  const bridge = createTeamBridge({ integrated: integrated ?? (rt && flush ? createIntegratedTeamBridge({ rt, directory, authority, lifecycle, sessionEvents, flush, threadHost }) : null), independent: independent ?? createIndependentTeamBridge({ runtime }), serving })
  const isMain = id => lifecycle.committedMainBotIds().includes(id)
  const canUse = id => { try { if (!lifecycle.committedBot(id)) return false; authority.assertTool(directory.forBot(id), 'tool/team'); return true } catch { return false } }
  const requireCaller = id => { if (!lifecycle.committedBot(id)) fail(TEAM_CODES.CALLER_NOT_COMMITTED); if (!canUse(id)) fail(TEAM_CODES.CALLER_NOT_AUTHORIZED) }
  const reachable = (fromId, targetId) => {
    const from = lifecycle.committedBot(fromId), target = lifecycle.committedBot(targetId)
    if (!from || !target || fromId === targetId) return false
    if (isMain(fromId)) return true
    if (target.hidden || target.private || target.archivedAt || target.visibility !== undefined && target.visibility !== null && target.visibility !== 'everyone') return false
    if (from.peers !== undefined && (!Array.isArray(from.peers) || !from.peers.includes(targetId))) return false
    // A restricted sender may not disclose its brief into a broader audience.
    if (from.visibility !== undefined && from.visibility !== null && from.visibility !== 'everyone') return false
    return true
  }
  const accessAllowed = row => {
    if (!canUse(row.parentBot) || !reachable(row.parentBot, row.targetBot)) return false
    if (row.parentAssignmentId) { const parent = store.get(row.parentAssignmentId); if (!parent || parent.cancelRequestedAt !== null || parent.state === 'cancelled') return false }
    try { authority.assertTool(directory.forBot(row.targetBot), 'model/infer'); return true } catch { return false }
  }
  const assertCanAct = (botId, { sessionId = null, conversationId = null } = {}) => {
    const active = store.activeFor(botId, { sessionId, conversationId })
    if (active?.mode === 'consult') fail('TEAM_CONSULT_READ_ONLY')
    const resumed = active?.resumeAssignmentId ? store.get(active.resumeAssignmentId) : null
    if (active && (active.cancelRequestedAt !== null || active.assignmentId && !accessAllowed(active) || resumed && !accessAllowed(resumed))) fail('TEAM_ACCESS_CHANGED')
  }
  const scheduler = createTeamScheduler({ store, bridge, checks: { committedBot: id => lifecycle.committedBot(id), accessAllowed, originAllowed: row => bridge.originCurrent(row.parentBot, row.origin) }, policy })
  const scope = input => {
    requireCaller(input.callerBotId)
    const active = store.activeFor(input.callerBotId, { sessionId: input.sessionId, conversationId: input.conversationId })
    const origin = bridge.captureOrigin({ ...input, workThreadId: active?.targetRef?.workThreadKey })
    return { origin, originKey: digest(origin), active }
  }
  const shape = row => ({ assignmentId: row.assignmentId, requestKey: row.requestKey, targetBot: row.targetBot, workThreadKey: row.workThreadKey, threadId: row.workThreadKey, mode: row.mode, reply: row.reply, state: row.state, outcome: row.outcome, resultCode: row.resultCode, result: row.outcome === 'succeeded' ? row.resultText : null, resumeState: row.resumeState, reworkOf: row.reworkOf, depth: row.depth, cancelRequested: row.cancelRequestedAt !== null, ...(row.duplicate ? { duplicate: true } : {}) })
  const coordinateBots = input => {
    const { callerBotId, turnId, callId } = input
    const { origin, originKey, active } = scope(input)
    assertCanAct(callerBotId, input)
    if (!turnId || !callId) fail('TEAM_HOST_TURN_REQUIRED')
    const args = input.args
    // Re-validate at the service door too; callers cannot bypass the shared parser.
    parseTeamToolArgs('coordinate_bots', { bot_ids: args.targets, message: args.message, thread: args.thread ?? 'standing', reply: args.reply ?? 'resume', consult: args.consult ?? false, rework: args.rework ?? false, ...(args.doneWhen !== undefined && args.doneWhen !== null ? { done_when: args.doneWhen } : {}), ...(args.requestKey !== undefined ? { request_key: args.requestKey } : {}) })
    const requestKey = args.requestKey ?? `call-${digest([turnId, callId]).slice(0, 60)}`
    const mode = args.consult ? 'consult' : args.reply === 'none' ? 'notice' : 'work'
    const lineage = active?.lineage ?? [callerBotId]
    assertDepth(lineage, maxDepth)
    const specs = args.targets.map(targetBot => {
      if (targetBot === callerBotId) fail(TEAM_CODES.SELF_TARGET)
      // A missing/private target produces the same refusal, without a name leak.
      if (!reachable(callerBotId, targetBot)) fail(TEAM_CODES.CALLER_NOT_AUTHORIZED)
      assertNoCycle(lineage, targetBot)
      const requestedThread = args.thread ?? 'standing'
      const workThreadKey = requestedThread === 'standing' ? standingThreadKey(callerBotId, targetBot, originKey) : requestedThread === 'new' ? `wt-${randomUUID()}` : requestedThread
      if (!['new', 'standing'].includes(requestedThread) && !store.listByParent(callerBotId, { includeTerminal: true, originKey }).some(row => row.targetBot === targetBot && row.workThreadKey === workThreadKey)) fail(TEAM_CODES.THREAD_NOT_OWNED)
      const spec = { parentBot: callerBotId, targetBot, requestedThread, workThreadKey, origin, originKey, mode, reply: args.reply ?? 'resume', brief: args.message, doneWhen: args.doneWhen ?? null, briefHash: computeBriefHash(mode, args.message, args.doneWhen, args.consult), rework: args.rework === true, lineage: [...lineage, targetBot], depth: lineage.length, rootBot: active?.rootBot ?? callerBotId, rootAssignmentId: active?.rootAssignmentId ?? active?.assignmentId ?? null, parentAssignmentId: active?.assignmentId ?? null, parentRequestId: active?.targetRequestId ?? null, createdByTurn: turnId, createdByCall: callId }
      if (!accessAllowed(spec)) fail(TEAM_CODES.ACCESS_CHANGED)
      return spec
    })
    const decision = store.createBatch(specs, { parentBot: callerBotId, originKey, requestKey, payloadHash: digest([args.targets, args.message, args.thread ?? 'standing', args.reply ?? 'resume', args.consult ?? false, args.rework ?? false, args.doneWhen ?? null]) })
    if (decision.status === 'conflict') fail(TEAM_CODES.REQUEST_CONFLICT)
    return { assignments: decision.assignments.map(row => ({ ...shape(row), ...(decision.status === 'replayed' ? { replayed: true } : {}) })) }
  }
  const rowsFor = input => { const scoped = scope(input); return store.listByParent(input.callerBotId, { includeTerminal: true, originKey: scoped.originKey }).filter(accessAllowed) }
  return Object.freeze({
    ready: true, canUse, assertCanAct, coordinateBots,
    validateResult(input, value) {
      requireCaller(input.callerBotId)
      if (input.sessionId || input.conversationId) scope(input)
      const targets = [...(value.assignments ?? []), ...(value.assignment ? [value.assignment] : []), ...(value.threads ?? [])].map(row => row.targetBot)
      targets.push(...(value.bots ?? []).map(row => row.id))
      if (targets.some(id => !reachable(input.callerBotId, id))) fail(TEAM_CODES.ACCESS_CHANGED)
    },
    assignmentStatus(input) {
      const rows = rowsFor(input), args = input.args ?? {}
      if (rows.some(row => row.createdByTurn === input.turnId)) fail('TEAM_STATUS_SAME_TURN')
      if (args.id) { const row = rows.find(row => row.assignmentId === args.id); if (!row) fail(TEAM_CODES.ASSIGNMENT_NOT_FOUND); return { assignment: shape(row) } }
      return { assignments: rows.filter(row => !['settled', 'unknown', 'cancelled'].includes(row.state)).map(shape) }
    },
    listBots({ callerBotId }) { requireCaller(callerBotId); return { bots: lifecycle.committedBots().filter(bot => reachable(callerBotId, bot.id)).map(bot => ({ id: bot.id, name: bot.name ?? bot.id, main: isMain(bot.id), model: bot.model ?? null, mode: serving.readMode(bot.id) })).sort((a, b) => a.id.localeCompare(b.id)) } },
    listThreads(input) { const rows = rowsFor(input), seen = new Set(); return { threads: rows.reverse().filter(row => { if (seen.has(row.workThreadKey)) return false; seen.add(row.workThreadKey); return true }).map(row => ({ threadId: row.workThreadKey, targetBot: row.targetBot, title: row.brief.slice(0, 80), state: row.state, assignmentId: row.assignmentId, updatedAt: row.updatedAt })) } },
    stop: botId => scheduler.stop(botId), store, scheduler,
    start(options) { scheduler.start(options); return this }, tick: () => scheduler.tick(), whenIdle: () => scheduler.whenIdle(),
    async drain(rounds = 24) { for (let index = 0; index < rounds; index++) { scheduler.tick(); await scheduler.whenIdle(); if (!store.dispatchable().length && !store.rowsForReconcile().length && !store.resumeDue().length) break }; return this },
    close() { scheduler.close(); store.close() },
  })
}
