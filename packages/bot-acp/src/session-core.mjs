// Multi-turn ACP session over one agent process.
//
// Ported and re-grounded from OpenMausBot server/drivers/acp/core.ts,
// turn-state.ts, session-model-controls.ts and session-reports.ts at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
//
// Upstream invariants kept here: there is no turn/completed notification — the
// session/prompt result (stopReason plus usage) is the completion; session/load
// replays history as ordinary session/update notifications, so nothing is
// emitted before the prompt is sent; a Stop the agent answers with end_turn is
// the person's stop; and a model is only switched through an option the agent
// actually advertised.
//
// Boundaries this port adds: turns are strictly serial with an explicit busy
// refusal; a refused or unsupported resume never silently opens a new session
// and replays the old turn; an unknown stop reason is reported verbatim and is
// never presented as success; model, config and mode changes run only when the
// agent advertised them and the Host authorized the selection; the dispatch
// moment is reported to the caller through `onDispatched`, and every refusal
// raised before it is tagged `acpNotDispatched` so a caller can tell "nothing
// was sent" from "the peer may have acted".

import {
  ACP_METHODS, ACP_PROTOCOL_VERSION, clientCapabilities, readAgentCapabilities,
} from './rpc-codec.mjs'
import { createPermissionPolicy } from './permission-policy.mjs'

export const DEFAULT_LIMITS = Object.freeze({
  initTimeoutMs: 300_000,
  sessionTimeoutMs: 300_000,
  loadTimeoutMs: 120_000,
  promptTimeoutMs: 600_000,
  promptIdleMs: 180_000,
  /** A resident process runs a bounded number of turns before it is retired. */
  maxTurns: 256,
  /** An unanswered permission ask denies after this long. */
  permissionTimeoutMs: 15 * 60_000,
})

const MAX_PROMPT_BYTES = 64_000

export const STOP_REASONS = Object.freeze({
  endTurn: 'end_turn',
  cancelled: 'cancelled',
  refusal: 'refusal',
  maxTurn: 'max_turn_requests',
})

/** Merge one session/update into the running turn. Unknown updates count, they never invent text. */
export function mergeSessionUpdate(state, update, sessionId) {
  const kind = update?.sessionUpdate
  const entry = { kind, sessionId: sessionId ?? null }
  switch (kind) {
    case 'agent_message_chunk': {
      const content = update.content
      if (content?.type === 'text' && typeof content.text === 'string' && content.text) {
        if (typeof update.messageId === 'string' && update.messageId) state.textMessageId = update.messageId
        state.text += content.text
        state.repliedText = true
        entry.text = content.text
      } else if (content?.type === 'image' && typeof content.data === 'string' && content.data) {
        state.producedItem = true
        entry.image = true
      } else {
        entry.ignored = true
      }
      break
    }
    case 'agent_thought_chunk': {
      const content = update.content
      if (content?.type === 'text' && typeof content.text === 'string' && content.text) {
        entry.text = content.text
        state.producedItem = true
      } else entry.ignored = true
      break
    }
    case 'tool_call':
    case 'tool_call_update': {
      const id = typeof update.toolCallId === 'string' && update.toolCallId ? update.toolCallId : null
      const status = update.status ?? (kind === 'tool_call' ? 'pending' : undefined)
      if (id) {
        if (status === 'completed' || status === 'failed') state.runningTools.delete(id)
        else if (status === 'pending' || status === 'in_progress') state.runningTools.add(id)
      }
      state.producedItem = true
      entry.toolCallId = id
      entry.status = status ?? null
      break
    }
    case 'usage_update': {
      const used = update.used ?? update.usage?.used
      if (typeof used === 'number' && Number.isFinite(used) && used > 0) {
        if (state.usagePeak !== null && used < state.usagePeak * 0.6) state.usageCompacted = true
        if (state.usagePeak === null || used > state.usagePeak) state.usagePeak = used
        state.usageLast = used
        entry.contextTokens = used
        if (typeof (update.size ?? update.usage?.size) === 'number') entry.contextWindow = update.size ?? update.usage?.size
      } else entry.ignored = true
      break
    }
    default:
      entry.ignored = true
  }
  return entry
}

/** Usage evidence. A figure the agent never reported stays null, never estimated. */
export function usageEvidence(state) {
  return {
    contextTokens: typeof state.usageLast === 'number' ? state.usageLast : null,
    contextPeakTokens: typeof state.usagePeak === 'number' ? state.usagePeak : null,
    compacted: state.usageCompacted === true,
    inputTokens: null, outputTokens: null, cachedInputTokens: null,
    reported: false,
    status: 'unknown',
  }
}

const emptyTurnState = () => ({
  settled: false, promptSent: false, text: '', textMessageId: null,
  producedItem: false, repliedText: false, stopped: false, cancelling: false,
  usagePeak: null, usageLast: null, usageCompacted: false,
  runningTools: new Set(), updates: [],
})

/**
 * @param {object} options
 * @param {object} options.host result of createAcpHost
 * @param {object} options.link one host link (one session)
 * @param {string} options.cwd Host-owned absolute workspace
 * @param {{name: string, version: string}} options.clientInfo
 * @param {{fileSystem?: boolean, terminal?: boolean, meta?: object}} [options.capabilities]
 * @param {{pickMethod?: Function, onAuthFailure?: 'fail'|'continue'}} [options.auth]
 * @param {(entry: object) => void} [options.onUpdate] merged stream, item by item
 * @param {Function} [options.onPermissionRequest] trusted Host permission handler
 * @param {{describe: Function, assertTool: Function}} [options.authority]
 * @param {object} [options.subject]
 * @param {(identity: object) => string|null} [options.operationTool]
 * @param {(modelId: string) => void} [options.assertModelAuthorized] Host model authorization
 * @param {Function} [options.log]
 */
export function createAcpSession({
  host,
  link,
  cwd,
  clientInfo,
  capabilities = {},
  auth = {},
  onUpdate,
  onPermissionRequest,
  onServerRequest = null,
  authority = null,
  subject = null,
  operationTool = null,
  assertModelAuthorized = null,
  limits = {},
  signal,
  log,
} = {}) {
  if (!host || typeof host.once !== 'function') throw new TypeError('ACP_SESSION_HOST_REQUIRED')
  if (!link || typeof link.request !== 'function') throw new TypeError('ACP_SESSION_LINK_REQUIRED')
  if (typeof cwd !== 'string' || !cwd) throw new TypeError('ACP_SESSION_CWD_REQUIRED')
  const bounds = { ...DEFAULT_LIMITS, ...limits }
  if (typeof clientInfo?.name !== 'string' || !clientInfo.name) throw new TypeError('ACP_SESSION_CLIENT_INFO_REQUIRED')

  const permissions = createPermissionPolicy({
    onPermissionRequest, authority, subject, operationTool, timeoutMs: bounds.permissionTimeoutMs, signal, log,
  })
  let agentCapabilities = null
  let initResult = null
  let authenticated = false
  let sessionId = null
  let sessionConfigResult = null
  let current = null
  let turns = 0
  let closed = false
  let closingReason = null
  let cancelRequestedAt = null

  const sessionBusy = () => current !== null && !current.state.settled

  const emitUpdate = entry => {
    current?.state.updates.push(entry)
    if (typeof onUpdate === 'function') {
      try { onUpdate(entry) } catch (error) { log?.({ event: 'acp.update-listener-failed', message: error?.message ?? String(error) }) }
    }
  }

  // ---- inbound ---------------------------------------------------------------
  link.inbound = {
    request: classified => {
      // A Host-installed guard (fs/terminal) answers first; anything it does not
      // own falls through to the fail-closed paths below.
      if (typeof onServerRequest === 'function') {
        const reply = onServerRequest(classified)
        if (reply !== null && reply !== undefined) {
          if (typeof reply?.then === 'function') {
            void reply.then(value => link.respond(classified.id, value?.result ?? value), error => link.respondError(classified.id, -32602, error?.message ?? String(error)))
          } else {
            link.respond(classified.id, reply?.result ?? reply)
          }
          return
        }
      }
      if (classified.method === ACP_METHODS.sessionRequestPermission) {
        // Only while a turn is running: between turns nothing is brokered.
        if (!sessionBusy()) {
          link.respond(classified.id, { outcome: { outcome: 'cancelled' } })
          return
        }
        void permissions.decide(classified).then(decision => {
          link.respond(classified.id, decision.behavior === 'allow' && decision.optionId
            ? { outcome: { outcome: 'selected', optionId: decision.optionId } }
            : { outcome: { outcome: 'cancelled' } })
          emitUpdate({ kind: 'permission-resolved', behavior: decision.behavior, source: decision.source, reason: decision.reason, toolCallId: classified.params?.toolCall?.toolCallId ?? null })
        })
        return
      }
      // fs/* and terminal/* are refused by the guard upstream of this point; any
      // other server request is answered fail-closed rather than blocking the agent.
      link.respondError(classified.id, -32601, 'method not found')
    },
    notification: classified => {
      if (classified.method !== ACP_METHODS.sessionUpdate) return
      const params = classified.params ?? {}
      if (params._meta?.isReplay === true) return
      if (sessionId !== null && params.sessionId !== sessionId) return
      const update = params.update ?? {}
      if (!current || !current.state.promptSent) return
      const entry = mergeSessionUpdate(current.state, update, sessionId)
      emitUpdate(entry)
    },
  }

  // ---- handshake -------------------------------------------------------------
  const initialize = () => host.once('initialize', async () => {
    const result = await link.request(ACP_METHODS.initialize, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo,
      clientCapabilities: clientCapabilities(capabilities),
    }, { timeoutMs: bounds.initTimeoutMs })
    if (!result || typeof result !== 'object') throw new Error('ACP initialize returned no result')
    agentCapabilities = readAgentCapabilities(result)
    if (agentCapabilities.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new Error(`ACP protocol version mismatch: agent reports ${agentCapabilities.protocolVersion ?? 'nothing'}, client speaks ${ACP_PROTOCOL_VERSION}`)
    }
    initResult = result
    log?.({ event: 'acp.initialize', agent: agentCapabilities.agentName, version: agentCapabilities.agentVersion, loadSession: agentCapabilities.loadSession })
    return agentCapabilities
  })

  const authenticate = () => host.once('authenticate', async () => {
    if (authenticated) return true
    const methods = Array.isArray(initResult?.authMethods) ? initResult.authMethods : []
    const methodId = typeof auth.pickMethod === 'function' ? auth.pickMethod(methods) : null
    if (typeof methodId !== 'string' || !methodId) {
      if (auth.onAuthFailure === 'fail') throw new Error('ACP agent requires authentication')
      return false
    }
    try {
      await link.request(ACP_METHODS.authenticate, { methodId }, { timeoutMs: bounds.initTimeoutMs })
      authenticated = true
      return true
    } catch (error) {
      if (auth.onAuthFailure === 'fail') throw error
      return false
    }
  })

  const handshake = async () => {
    await initialize()
    await authenticate()
    return agentCapabilities
  }

  // ---- session lifecycle -----------------------------------------------------
  /** Open a session. `resumeSessionId` is only honoured when the agent advertised loadSession. */
  const openSession = async ({ resumeSessionId = null } = {}) => {
    await handshake()
    if (resumeSessionId !== null) {
      if (!agentCapabilities.loadSession) {
        return { ok: false, stopReason: 'resume-unsupported', reason: 'agent does not advertise loadSession' }
      }
      try {
        const result = await link.request(
          ACP_METHODS.sessionLoad,
          { sessionId: resumeSessionId, cwd, mcpServers: [] },
          { timeoutMs: bounds.loadTimeoutMs, owner: link.threadId },
        )
        const loaded = typeof result?.sessionId === 'string' && result.sessionId ? result.sessionId : resumeSessionId
        sessionId = loaded
        // The host routes by sessionId, so the link learns it too.
        link.sessionId = loaded
        sessionConfigResult = result ?? null
        log?.({ event: 'acp.session-loaded', sessionId })
        return { ok: true, sessionId, resumed: true }
      } catch (error) {
        // A refused resume is never papered over with a new session: the caller
        // decides, and the old turn is not replayed into a fresh one.
        log?.({ event: 'acp.session-load-refused', message: error?.message ?? String(error) })
        return { ok: false, stopReason: 'resume-refused', reason: error?.message ?? String(error), error }
      }
    }
    const result = await link.request(
      ACP_METHODS.sessionNew,
      { cwd, mcpServers: [] },
      { timeoutMs: bounds.sessionTimeoutMs, owner: link.threadId },
    )
    if (typeof result?.sessionId !== 'string' || !result.sessionId) {
      throw new Error('ACP session/new returned no sessionId')
    }
    sessionId = result.sessionId
    link.sessionId = result.sessionId
    sessionConfigResult = result ?? null
    turns = 0
    log?.({ event: 'acp.session-new', sessionId })
    return { ok: true, sessionId, resumed: false }
  }

  /** Host-explicit fresh session. Replaying an earlier turn is the caller's decision, never ours. */
  const resetSession = () => {
    sessionId = null
    link.sessionId = null
    sessionConfigResult = null
    turns = 0
  }
  // ---- model / config / mode -------------------------------------------------
  const advertisedConfigOption = configId => {
    const options = Array.isArray(sessionConfigResult?.configOptions) ? sessionConfigResult.configOptions : []
    return options.find(option => option && typeof option === 'object' && option.id === configId && option.type === 'select') ?? null
  }

  const advertisedLegacyModels = () => {
    const models = sessionConfigResult?.models
    return models && Array.isArray(models.availableModels) ? models : null
  }

  /**
   * Switch the session model. Only an advertised model is ever requested, the
   * switch must be confirmed by the agent, and the Host authorizes the model
   * before anything is sent. No prompt is sent on a refused switch.
   */
  const selectModel = async modelId => {
    if (typeof modelId !== 'string' || !modelId) throw new TypeError('ACP_MODEL_REQUIRED')
    if (sessionId === null) throw new Error('ACP_NO_SESSION')
    if (typeof assertModelAuthorized === 'function') assertModelAuthorized(modelId)
    const option = advertisedConfigOption('model')
    if (option) {
      const offered = (Array.isArray(option.options) ? option.options : []).map(entry => entry?.value).filter(value => typeof value === 'string')
      if (!offered.includes(modelId)) throw new Error(`ACP_MODEL_NOT_ADVERTISED: ${modelId}`)
      const result = await link.request(
        ACP_METHODS.sessionSetConfigOption,
        { sessionId, configId: option.id, value: modelId },
        { timeoutMs: bounds.sessionTimeoutMs },
      )
      const confirmed = Array.isArray(result?.configOptions)
        ? result.configOptions.find(entry => entry?.id === option.id)?.currentValue
        : result?.currentValue
      if (confirmed !== undefined && confirmed !== modelId) {
        throw new Error(`ACP_MODEL_NOT_CONFIRMED: asked ${modelId}, agent kept ${String(confirmed)}`)
      }
      sessionConfigResult = result && typeof result === 'object' ? { ...sessionConfigResult, ...result } : sessionConfigResult
      return { modelId, confirmed: confirmed === modelId || confirmed === undefined }
    }
    const legacy = advertisedLegacyModels()
    if (legacy) {
      const offered = legacy.availableModels.map(entry => entry?.modelId).filter(value => typeof value === 'string')
      if (!offered.includes(modelId)) throw new Error(`ACP_MODEL_NOT_ADVERTISED: ${modelId}`)
      await link.request(ACP_METHODS.sessionSetModel, { sessionId, modelId }, { timeoutMs: bounds.sessionTimeoutMs })
      sessionConfigResult = { ...sessionConfigResult, models: { ...legacy, currentModelId: modelId } }
      return { modelId, confirmed: true }
    }
    throw new Error('ACP_MODEL_SELECTION_UNAVAILABLE: agent advertises no model option')
  }

  /** Set a session mode only when the agent advertised that exact mode. */
  const setMode = async modeId => {
    if (typeof modeId !== 'string' || !modeId) throw new TypeError('ACP_MODE_REQUIRED')
    if (sessionId === null) throw new Error('ACP_NO_SESSION')
    const modes = Array.isArray(sessionConfigResult?.modes) ? sessionConfigResult.modes : []
    const offered = modes.map(mode => mode?.id).filter(value => typeof value === 'string')
    if (!offered.includes(modeId)) throw new Error(`ACP_MODE_NOT_ADVERTISED: ${modeId}`)
    await link.request(ACP_METHODS.sessionSetMode, { sessionId, modeId }, { timeoutMs: bounds.sessionTimeoutMs })
    return { modeId }
  }

  // ---- turns -----------------------------------------------------------------
  /** Ask the agent to stop. This is a request, never a stop confirmation. */
  const cancel = () => {
    if (!current || current.state.settled) return false
    current.state.stopped = true
    cancelRequestedAt = Date.now()
    if (sessionId !== null) link.notify(ACP_METHODS.sessionCancel, { sessionId })
    log?.({ event: 'acp.cancel-requested', sessionId })
    return true
  }

  /**
   * Run one turn. Text only: a turn payload can never carry a subject,
   * executable or credential. The session/prompt result is the completion; an
   * unknown stop reason is reported, never treated as success.
   *
   * `onDispatched` is called at the moment the request is issued — before any
   * answer exists — so a caller can record dispatch evidence instead of counting
   * completions. Every refusal raised before that point is tagged
   * `acpNotDispatched`, which is the only honest proof that nothing was written
   * to the peer.
   */
  const prompt = async (input, { onDispatched } = {}) => {
    const notDispatched = error => { throw Object.assign(error, { acpNotDispatched: true }) }
    if (closed) notDispatched(new Error('ACP_SESSION_CLOSED'))
    if (sessionId === null) notDispatched(new Error('ACP_NO_SESSION'))
    if (sessionBusy()) notDispatched(new Error('ACP_SESSION_BUSY'))
    if (turns >= bounds.maxTurns) notDispatched(new Error('ACP_SESSION_TURN_LIMIT'))
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'text')) {
      notDispatched(new TypeError('ACP_TURN_INPUT: only { text } is accepted'))
    }
    const promptText = input.text
    if (typeof promptText !== 'string' || !promptText.trim() || promptText.includes('\u0000') || Buffer.byteLength(promptText) > MAX_PROMPT_BYTES) {
      notDispatched(new TypeError('ACP_TURN_TEXT_INVALID'))
    }
    try { signal?.throwIfAborted() } catch (error) { notDispatched(error) }

    const state = emptyTurnState()
    const turn = { state, startedAt: Date.now() }
    current = turn
    turns++

    try {
      state.promptSent = true
      // The request is issued here. This is the dispatch moment, recorded before
      // any result exists.
      if (typeof onDispatched === 'function') onDispatched()
      // The abort race guarantees the turn settles even if the transport ignores
      // the signal: a cancelled turn is never left waiting on the agent.
      let onAbortRace = null
      const abortRace = new Promise((resolve, reject) => {
        onAbortRace = () => {
          state.stopped = true
          reject(Object.assign(new Error('ACP turn aborted'), { acpAborted: true }))
        }
        if (signal) signal.addEventListener('abort', onAbortRace, { once: true })
        if (signal?.aborted) onAbortRace()
      })
      try {
        const result = await Promise.race([
          link.request(
            ACP_METHODS.sessionPrompt,
            { sessionId, prompt: [{ type: 'text', text: promptText }] },
            {
              timeoutMs: bounds.promptTimeoutMs,
              idleMs: bounds.promptIdleMs,
              signal,
              onReceive: value => {
                // The agent may stream a final update before this continuation runs.
                if (value && typeof value === 'object') turn.result = value
              },
            },
          ),
          abortRace,
        ])
        return settleTurn(turn, result, null)
      } finally {
        if (onAbortRace) signal?.removeEventListener?.('abort', onAbortRace)
      }
    } catch (error) {
      return settleTurn(turn, turn.result ?? null, error)
    } finally {
      current = null
    }
  }

  const settleTurn = (turn, result, error) => {
    const state = turn.state
    state.settled = true
    const usage = usageEvidence(state)
    const rawUsage = result?.usage ?? result?._meta ?? null
    if (rawUsage && typeof rawUsage === 'object') {
      const input = typeof rawUsage.inputTokens === 'number' ? rawUsage.inputTokens : null
      const output = typeof rawUsage.outputTokens === 'number' ? rawUsage.outputTokens : null
      const cached = typeof rawUsage.cachedReadTokens === 'number' ? rawUsage.cachedReadTokens : null
      usage.inputTokens = input
      usage.outputTokens = output
      usage.cachedInputTokens = cached
      usage.reported = input !== null || output !== null
      usage.status = usage.reported ? 'reported' : 'unknown'
    }
    const stopReason = typeof result?.stopReason === 'string' ? result.stopReason : null
    const outcome = {
      ok: false,
      stopReason,
      outcome: 'failed',
      sessionId,
      text: state.text,
      producedItem: state.producedItem,
      updates: state.updates.length,
      usage,
      // ACP reports no dollar figure: cost stays null/unknown here and flows to
      // the Host ledger as evidence, never as an estimate made up in this adapter.
      costUsd: null,
      costStatus: 'unknown',
      elapsedMs: Date.now() - turn.startedAt,
      cancelRequestedAt,
      errorText: null,
    }
    if (error) {
      const aborted = error?.acpAborted === true || signal?.aborted === true || state.stopped === true
      outcome.outcome = aborted ? 'cancelled' : 'failed'
      outcome.stopReason = aborted ? 'cancelled' : (outcome.stopReason ?? 'rpc-error')
      outcome.errorText = error?.message ?? String(error)
      if (state.text || state.producedItem) outcome.partial = true
      log?.({ event: 'acp.turn-failed', message: outcome.errorText })
      return outcome
    }
    if (state.stopped || stopReason === STOP_REASONS.cancelled) {
      outcome.ok = true
      outcome.outcome = 'cancelled'
      outcome.stopReason = 'cancelled'
      return outcome
    }
    if (stopReason === STOP_REASONS.endTurn) {
      if (!state.repliedText && !state.producedItem) {
        // end_turn with nothing to show is a lost turn, not a success.
        outcome.stopReason = 'empty_turn'
        outcome.errorText = 'ACP agent ended the turn without producing any output'
        return outcome
      }
      outcome.ok = true
      outcome.outcome = 'succeeded'
      return outcome
    }
    // refusal, max_turn_requests or a reason this client does not know: report it.
    outcome.errorText = `ACP agent stopped with ${stopReason ?? 'no stopReason'}`
    if (stopReason === null) outcome.stopReason = 'unknown'
    log?.({ event: 'acp.turn-unfinished', stopReason })
    return outcome
  }

  const close = (reason = 'closed') => {
    if (closed) return
    closed = true
    closingReason = reason
    permissions.close(reason)
    if (current && !current.state.settled) {
      current.state.settled = true
      current = null
    }
    log?.({ event: 'acp.session-closed', reason })
  }

  signal?.addEventListener('abort', () => close('aborted'), { once: true })
  if (signal?.aborted) close('aborted')

  return Object.freeze({
    initialize,
    handshake,
    authenticate,
    openSession,
    resetSession,
    prompt,
    cancel,
    selectModel,
    setMode,
    close,
    permissions,
    get sessionId() { return sessionId },
    get agentCapabilities() { return agentCapabilities },
    get busy() { return sessionBusy() },
    get closed() { return closed },
    get closingReason() { return closingReason },
    get turns() { return turns },
    get stats() {
      return Object.freeze({
        turns, sessionId, closed, cancelRequestedAt,
        agent: agentCapabilities ? { name: agentCapabilities.agentName, version: agentCapabilities.agentVersion, loadSession: agentCapabilities.loadSession } : null,
        permissions: permissions.stats,
        limits: { ...bounds },
      })
    },
  })
}
