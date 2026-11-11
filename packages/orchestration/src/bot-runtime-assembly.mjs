/**
 * Assemble the independent runtime from pieces the Host already owns.
 *
 * The plugin's apply() should not learn how a session store, a loop, a switch and a dispatch fit
 * together. It hands this module its directories and two factories, and gets back one object with
 * `turn`, `move`, `describe` and `close`. Nothing here reaches into the Harness: the integration
 * handler is whatever the caller passes, so the product keeps working exactly as before until a
 * Bot is moved.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createBotLoop, botRequestReceipt } from './bot-loop.mjs'
import { openBotSessionStore } from './bot-session-store.mjs'
import { createBotDispatch } from './bot-runtime-dispatch.mjs'
import { openRuntimeSwitch } from './bot-runtime-switch.mjs'
import { createBotServing } from './bot-serving.mjs'
import { contextView, contextRequestOk, independentContextId, retirementConfirmed } from './independent-context-state.mjs'

const fail = code => { const error = new Error(code); error.code = code; throw error }

/**
 * @param {{
 *   dir: string,
 *   integration: (request: object) => Promise<object>,
 *   providerFor: (botId: string) => ((request: object) => Promise<object>) | null,
 *   toolsFor?: (botId: string) => { names?: string[], schemas?: () => object[] | null, isReadonly?: (name: string) => boolean, call: (name: string, args: object, context: { botId: string, signal?: AbortSignal, turnId: string, callId: string }) => Promise<unknown> } | null,
 *   isBusy?: (botId: string) => boolean | Promise<boolean>,
 *   serving?: object | null,
 *   assertTurn?: (botId: string) => void,
 *   now?: () => number,
 *   maxSteps?: number,
 * }} options
 */
export function createIndependentRuntime({
  dir, integration, providerFor, toolsFor = () => null, isBusy = () => false, serving = null, assertTurn = null, now = Date.now, maxSteps,
  retireConversation = null,
} = {}) {
  if (typeof dir !== 'string' || dir === '') throw new TypeError('RUNTIME_DIR_REQUIRED')
  if (typeof integration !== 'function') throw new TypeError('RUNTIME_REQUIRES_INTEGRATION')
  if (typeof providerFor !== 'function') throw new TypeError('RUNTIME_REQUIRES_PROVIDER_FACTORY')
  if (assertTurn !== null && typeof assertTurn !== 'function') throw new TypeError('RUNTIME_ASSERT_TURN_INVALID')
  if (retireConversation !== null && typeof retireConversation !== 'function') throw new TypeError('RUNTIME_RETIRE_CONVERSATION_INVALID')
  if (serving !== null && (typeof serving !== 'object' || typeof serving.enter !== 'function' || typeof serving.assertMode !== 'function')) {
    throw new TypeError('RUNTIME_SERVING_ADMISSION_INVALID')
  }
  mkdirSync(dir, { recursive: true })
  const store = openBotSessionStore({ dir: join(dir, 'sessions'), now })
  const switchApi = openRuntimeSwitch({ file: join(dir, 'runtime-switch.json'), now })
  const loops = new Map()
  const controllers = new Set(), resetLeases = new Map()
  let closed = false
  const assertOpen = () => { if (closed) fail('INDEPENDENT_RUNTIME_CLOSED') }
  const controlled = signal => {
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    controllers.add(controller)
    return { controller, release() { controllers.delete(controller); signal?.removeEventListener('abort', abort) } }
  }
  // The shared Host admission: the same lease the integrated stream holds, so a move sees a Bot
  // this path is serving exactly as it sees one the Harness is serving. It is an admission only —
  // the committed switch still decides which runtime answers, and the policy still decides what
  // the answer may do.
  const guard = serving ?? createBotServing({ modeOf: botId => switchApi.modeOf(botId), now })
  // One re-decision per checkpoint, from committed state only: which runtime serves this Bot, and
  // whether the Bot still stands at all. The loop asks before every transcript write, every
  // provider step and every tool call, so a Bot moved, deleted or revoked mid-turn stops at the
  // next checkpoint instead of finishing on a state that no longer stands.
  const turnGuard = botId => {
    assertOpen()
    if (guard) guard.assertMode(botId, 'independent')
    if (assertTurn) assertTurn(botId)
    if (store.get(botId).contextReset) fail('INDEPENDENT_CONTEXT_PENDING_RECONCILIATION')
  }

  /**
   * The tool surface, resolved per step and per call rather than once per Bot.
   *
   * A loop is cached per Bot so a turn does not rebuild it, but the tools behind it are Host state:
   * `schemas()` is asked again for every request, and `call()` resolves the Host's own service
   * again for every call. A grant that changed, or a Host tool service that went away, therefore
   * stops the next call instead of being frozen into a loop somebody cached.
   */
  const toolServiceFor = botId => Object.freeze({
    schemas: () => {
      const tools = toolsFor(botId)
      return tools && typeof tools.schemas === 'function' ? tools.schemas() : null
    },
    isReadonly: name => {
      const tools = toolsFor(botId)
      return Boolean(tools && typeof tools.isReadonly === 'function' && tools.isReadonly(name))
    },
    call: (name, args, context) => {
      const tools = toolsFor(botId)
      if (!tools) fail('BOT_LOOP_TOOLS_UNAVAILABLE')
      return tools.call(name, args, context)
    },
  })

  // One loop per Bot: it holds no state beyond the store, but caching keeps a
  // provider factory from being called twice in one turn.
  const loopFor = botId => {
    const existing = loops.get(botId)
    if (existing) return existing
    const provider = providerFor(botId)
    if (typeof provider !== 'function') fail('RUNTIME_PROVIDER_UNAVAILABLE')
    // Every step re-reads the committed mode: a Bot moved mid-turn stops at the next step
    // instead of finishing on a runtime that no longer owns it.
    const guarded = request => { turnGuard(request.botId); return provider(request) }
    const loop = createBotLoop({ store, provider: guarded,
      tools: typeof toolsFor === 'function' ? toolServiceFor(botId) : null, guard: turnGuard, now, ...(maxSteps ? { maxSteps } : {}) })
    loops.set(botId, loop)
    return loop
  }

  const dispatch = createBotDispatch({
    switchApi,
    integration,
    independent: async request => {
      if (!guard) return loopFor(request.botId).run({ botId: request.botId, input: request.input, signal: request.signal, onProgress: request.onProgress })
      // The whole turn, tools included, under the one lease: a second turn, or a move, is refused
      // while this one runs, and the lease is released on answer, cancel, failure or throw.
      guard.assertMode(request.botId, 'independent')
      const lease = guard.acquire(request.botId)
      try {
        const result = await loopFor(request.botId).run({ botId: request.botId, input: request.input, signal: request.signal, onProgress: request.onProgress })
        return { answer: result.answer, steps: result.steps, toolCalls: result.toolCalls, turns: result.turns }
      } finally {
        lease.release()
      }
    },
    now,
  })

  const contextCheck = botId => {
    assertOpen()
    guard.assertMode(botId, 'independent')
    if (assertTurn) assertTurn(botId)
  }
  const reset = async (botId, { requestKey, expectedContextId, signal, retirementEvidence } = {}, reconcile = false) => {
    contextCheck(botId)
    if (!contextRequestOk(requestKey)) fail('INVALID_BOT_CONTEXT_RESET')
    if (!reconcile && !retireConversation) throw Object.assign(new Error('INDEPENDENT_CONTEXT_RETIREMENT_UNAVAILABLE'), { code: 'INDEPENDENT_CONTEXT_RETIREMENT_UNAVAILABLE', outcome: 'refused' })
    const contextId = independentContextId(botId, requestKey)
    if (store.contextCommitted(botId, requestKey, contextId)) return contextView(store.get(botId))
    const previous = store.get(botId)
    if (previous.contextReset && (!reconcile || previous.contextReset.requestKey !== requestKey || previous.contextReset.contextId !== contextId)) fail('INDEPENDENT_CONTEXT_PENDING_RECONCILIATION')
    if (reconcile && !retirementConfirmed(retirementEvidence)) fail('INDEPENDENT_CONTEXT_RETIREMENT_UNCONFIRMED')
    // Acquire synchronously before the first await. A turn or move in this tick cannot enter.
    const lease = resetLeases.get(botId) ?? guard.acquire(botId)
    resetLeases.set(botId, lease)
    const scope = controlled(signal)
    let intentWritten = Boolean(previous.contextReset), confirmed = false
    const checkpoint = () => { scope.controller.signal.throwIfAborted(); contextCheck(botId) }
    try {
      checkpoint()
      if (!reconcile) {
        store.beginContext(botId, { requestKey, contextId, expectedContextId })
        intentWritten = true
        const evidence = await retireConversation(botId, { reason: 'new-conversation', signal: scope.controller.signal })
        if (!retirementConfirmed(evidence)) fail('INDEPENDENT_CONTEXT_RETIREMENT_UNCONFIRMED')
      }
      confirmed = true
      checkpoint()
      const session = store.commitContext(botId, { requestKey, contextId })
      loops.delete(botId)
      return contextView(session)
    } catch (error) {
      // A post-rename read error may still have committed the intended context.
      let observed
      try {
        if (store.contextCommitted(botId, requestKey, contextId)) { loops.delete(botId); return contextView(store.get(botId)) }
        if (intentWritten && !confirmed && error.outcome === 'refused') store.abortContext(botId, { requestKey, contextId })
        observed = store.get(botId)
      } catch { /* Preserve uncertainty and its durable admission fence. */ }
      error.outcome = !observed || observed.contextReset?.requestKey === requestKey ? 'unknown' : error.outcome ?? 'refused'
      throw error
    } finally {
      scope.release()
      // Unknown retirement keeps the lease and durable intent. Only explicit trusted
      // reconciliation with stop evidence can release it; inspect never retries it.
      let pending = true
      try { pending = store.get(botId).contextReset?.requestKey === requestKey } catch { /* fail closed */ }
      if (!pending) { resetLeases.delete(botId); lease.release() }
    }
  }

  // ---- trusted work-thread turns (teammate coordination) ------------------------------
  // A work-thread is a REAL, distinct conversation history for one (target Bot, work
  // thread): its own session-store file under work-threads/<id>, run through the same
  // guarded loop, the same single-writer lease and the target's own provider/tools/grants
  // as its default conversation — never a label on the default transcript. The Host-only
  // requestId correlation and the persisted user/answer pair make a replay a read, and an
  // unconfirmed answer a fence, never a second dispatch.
  const workThreadIdOk = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
  const workThreadStores = new Map()
  const workThreadStoreFor = (workThreadId, botId) => {
    if (!workThreadIdOk(workThreadId)) fail('INVALID_WORK_THREAD_ID')
    if (!workThreadIdOk(botId)) fail('INVALID_BOT_ID')
    const key = createHash('sha256').update(JSON.stringify([botId, workThreadId])).digest('hex')
    let store = workThreadStores.get(key)
    if (!store) { store = openBotSessionStore({ dir: join(dir, 'work-threads', key), now }); workThreadStores.set(key, store) }
    return store
  }
  // The loop addresses one transcript by botId; a work-thread keeps the target's identity
  // for provider/guard but its own store key, so this view pins the key and ignores the arg.
  const workThreadStoreView = (store, workThreadId) => Object.freeze({
    get: () => store.get(workThreadId),
    append: (_botId, messages, options) => store.append(workThreadId, messages, options),
  })
  // A work-thread turn re-decides the committed runtime and Bot per checkpoint, but never
  // the default conversation's context reset: the work-thread has its own linear store.
  const workThreadGuard = botId => { assertOpen(); if (guard) guard.assertMode(botId, 'independent'); if (assertTurn) assertTurn(botId) }
  const captureTeamOrigin = ({ botId, conversationId = null, workThreadId = null } = {}) => {
    workThreadGuard(botId)
    // workThreadId is supplied only by the Host's durable assignment lookup.
    if (conversationId?.startsWith('teamwt-')) {
      if (!workThreadId) fail('TEAM_ORIGIN_UNCONFIRMED')
      return { mode: 'independent', conversationId, workThreadId, contextId: workThreadStoreFor(workThreadId, botId).get(workThreadId).contextId }
    }
    const current = store.get(botId)
    if (current.contextReset || conversationId && conversationId !== current.contextId) fail('TEAM_ORIGIN_RETIRED')
    return { mode: 'independent', conversationId: current.contextId, contextId: current.contextId, workThreadId: null }
  }
  const teamOriginCurrent = (botId, origin) => {
    try { workThreadGuard(botId); const current = origin.workThreadId ? workThreadStoreFor(origin.workThreadId, botId).get(origin.workThreadId) : store.get(botId); return !current.contextReset && current.contextId === origin.contextId }
    catch { return false }
  }
  const runTeamTurn = async ({ botId, workThreadId = null, input, requestId, signal, conversationId, consult = false, validate = () => {}, origin = null }) => {
    assertOpen()
    // Validate all identifiers and open the transcript before acquiring admission.
    const transcript = workThreadId ? workThreadStoreFor(workThreadId, botId) : store
    const key = workThreadId ?? botId
    botRequestReceipt(transcript.get(key), requestId)
    const checkpoint = () => { workThreadGuard(botId); validate(); if (origin && !teamOriginCurrent(botId, origin)) fail('TEAM_ORIGIN_RETIRED') }
    checkpoint()
    const lease = guard.acquire(botId), scope = controlled(signal)
    try {
      const provider = providerFor(botId)
      if (typeof provider !== 'function') fail('RUNTIME_PROVIDER_UNAVAILABLE')
      const guarded = request => { checkpoint(); return provider({ ...request, botId, conversationId }) }
      const loop = createBotLoop({ store: workThreadId ? workThreadStoreView(transcript, workThreadId) : transcript, provider: guarded,
        tools: consult ? null : toolServiceFor(botId), guard: checkpoint, now, ...(maxSteps ? { maxSteps } : {}) })
      return await loop.run({ botId, input, requestId, conversationId, signal: scope.controller.signal })
    } finally { scope.release(); lease.release() }
  }

  return Object.freeze({
    /** Serve one turn on the committed runtime. */
    async turn(request = {}) {
      assertOpen()
      if (store.get(request.botId).contextReset) fail('INDEPENDENT_CONTEXT_PENDING_RECONCILIATION')
      const scope = controlled(request.signal)
      try { return await dispatch.turn({ ...request, signal: scope.controller.signal }) }
      finally { scope.release() }
    },
    /** Trusted Host context token; never a Harness/session directory identity. */
    contextOf: botId => store.contextOf(botId),
    newConversation: (botId, options) => reset(botId, options),
    /** Explicit Host evidence recovery only. Owner requests cannot supply evidence. */
    reconcileConversation: (botId, options) => reset(botId, options, true),
    /** Which runtime a Bot is on. */
    describe: botId => dispatch.describe(botId),
    /** Move a Bot between runtimes; refused while it is busy. */
    move: async (botId, mode) => {
      assertOpen()
      if (store.get(botId).contextReset) fail('INDEPENDENT_CONTEXT_PENDING_RECONCILIATION')
      const before = store.list([botId])[0] ?? null
      const result = await switchApi.move(botId, mode, {
        isBusy,
        // The synchronous re-check at the commit boundary: the await above can lose the race to
        // a turn this Host admitted while it was in flight.
        ...(guard ? { assertIdle: () => guard.assertIdle(botId) } : {}),
        snapshot: before ? { turns: before.turns, messages: before.messages, at: now() } : null,
      })
      // A moved Bot must not keep a loop remembering an older provider or grant.
      loops.delete(botId)
      return result
    },
    /** Which Bots were moved, in the switch's own words. */
    list: () => switchApi.list(),
    /** Which Bots this Host is serving right now, by either path. */
    busyBots: () => (guard && typeof guard.busyBots === 'function' ? guard.busyBots() : []),
    captureTeamOrigin,
    teamOriginCurrent,
    async resumeTeamTurn({ botId, origin, requestId, input, signal, validate } = {}) {
      if (!origin || !teamOriginCurrent(botId, origin)) return { started: false, retired: true }
      const result = await runTeamTurn({ botId, origin, workThreadId: origin.workThreadId, conversationId: origin.conversationId, requestId, input, signal, validate })
      return { ...result, resumed: true }
    },

    /**
     * Run ONE real turn in a work-thread's own transcript, under the Bot's single-writer
     * lease and its own provider/tools/grants. The trusted per-work-thread `conversationId`
     * is injected into the provider request so the target's policy frame and native identity
     * carry it; nothing else about the caller crosses the boundary. This always dispatches —
     * dedupe, replay and unknown-fencing are the caller's (the assignment journal's) job.
     */
    workThreadTurn: request => runTeamTurn(request),

    /**
     * Reconcile a work-thread's last exchange from its durable transcript: whether a brief
     * was written and whether a confirmed model answer follows it. A brief with no confirmed
     * answer is a fence (the turn may have run), never a re-dispatch; an empty transcript is
     * a request that was never written. Bodies never leave the runtime beyond this bounded
     * answer string the assignment journal stores.
     */
    workThreadRead(botId, workThreadId, requestId) {
      assertOpen()
      const transcript = workThreadStoreFor(workThreadId, botId)
      return { ...botRequestReceipt(transcript.get(workThreadId), requestId), turns: transcript.get(workThreadId).turns }
    },

    /**
     * A bounded, redacted view of one Bot transcript: role, time, size and a short preview.
     * Bodies never leave this module; a caller shows previews instead of the full text.
     */
    history(botId, { limit = 20, previewChars = 120 } = {}) {
      const messages = store.get(botId).messages
      const take = Math.min(Math.max(1, limit), 100)
      const chars = Math.min(Math.max(0, previewChars), 400)
      return messages.slice(-take).map(message => {
        const body = String(message.content ?? '')
        return {
          role: message.role,
          contextId: message.contextId,
          at: message.at ?? null,
          chars: body.length,
          preview: chars === 0 ? '' : body.slice(0, chars),
          ...(message.name ? { name: message.name } : {}),
        }
      })
    },

    /**
     * One message's full text, by position from the end (0 = newest).
     * The store has no opinion about who may ask: the Host gates this behind an explicit switch.
     */
    readMessage(botId, index = 0) {
      const messages = store.get(botId).messages
      if (!Number.isSafeInteger(index) || index < 0 || index >= messages.length) fail('MESSAGE_NOT_FOUND')
      const message = messages[messages.length - 1 - index]
      return {
        role: message.role,
        contextId: message.contextId,
        at: message.at ?? null,
        chars: String(message.content ?? '').length,
        content: String(message.content ?? ''),
        ...(message.name ? { name: message.name } : {}),
        ...(message.toolCall ? { toolCall: message.toolCall } : {}),
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.modelSource ? { modelSource: message.modelSource } : {}),
        ...(message.messageId ? { messageId: message.messageId } : {}),
      }
    },

    /** Inventory for a panel: runtime plus transcript size, never message bodies. */
    inventory: botIds => {
      const rows = store.list(Array.isArray(botIds) ? botIds : [])
      return rows.map(row => ({ ...row, ...dispatch.describe(row.botId) }))
    },
    /** Drop cached loops when the plugin unloads. */
    close() {
      if (closed) return
      closed = true
      for (const controller of controllers) controller.abort(Object.assign(new Error('INDEPENDENT_RUNTIME_CLOSED'), { code: 'BOT_LOOP_CANCELLED' }))
      loops.clear()
      workThreadStores.clear()
    },
  })
}
