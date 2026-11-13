// The public LlmAdapter bridge for the Claude retained conversation engine.
//
// One Bot conversation keeps ONE native CLI session (packages/bot-engines/src/claude-engine.mjs)
// and speaks to the installed SDK through the public `LlmAdapter` surface, so the Host's own
// `llm/stream` waterfall — the same one an integrated turn goes through — applies the Bot
// policy, re-decides the route and records the ONE receipt. This bridge holds no money and
// issues no receipt of its own.
//
// Trust boundary. Only a Host constructs this adapter, and only a Host supplies the trusted
// state it dispatches on:
//   - `entry` / `entryFor()` — the pinned installation reference (executable, digest, version,
//     optional pinned interpreter script). Never read from a request.
//   - `identityFor({provider, model, sessionId, purpose})` — the committed Bot identity:
//     the authority subject, the committed route's authority object, the durable binding and
//     the Host-confirmed persona. It reads committed Host state; a request can never name a
//     Bot, a path, a command, a credential or an engine configuration, and a request carrying
//     any field outside the accepted set is refused.
//   - `funding` / `fundingFor()` — the committed funding of this route. Only an explicitly
//     configured Claude **subscription** chat route is open: an API-funded CLI route cannot
//     prove a strict per-call cost or output bound here, so it is refused rather than priced
//     by guesswork.
//   - `engineFactory` — the retained-session engine seam. The default is the real
//     `createClaudeEngine`; a Host (or a test) may inject another, and the injection is the
//     only way the engine configuration is ever chosen.
//
// What a turn is. `stream(options)` is one conversation turn: the new user text is projected
// out of the request history (the retained CLI already holds everything before it), dispatched
// on the one native session, and mapped onto the SDK chunk vocabulary. Turns are serial: the
// engine's own single-turn fence refuses a concurrent second turn, and that refusal is
// surfaced, never queued silently. Cancellation belongs to the turn that asked for it — the
// session is never bound to the first turn's short-lived signal — and it really stops the
// native tree and waits for the engine's own settlement before the stream finishes.
//
// What is never done here: no second chat surface, no second ledger, no fabricated
// contextWindow / defaultMaxTokens / price / response-backend proof, no blind replay of a
// turn whose outcome is unknown, and no re-execution of the engine's own internal tools as
// loop tool calls.

import { randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'

import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'

import { createClaudeEngine } from './claude-engine.mjs'
import {
  CLAUDE_LLM_CAPABILITIES, assertRouteRequest, emptyTurnState, finishReasonFromTurn,
  projectRetainedTurn, seedTurnState, sessionKeyOf, turnFacts, usageChunkFromTurn,
} from './claude-llm-turn.mjs'

/** The one funding kind this route opens. Everything else is refused with a reason. */
export const CLAUDE_LLM_FUNDING = 'subscription'

const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const text = value => typeof value === 'string' && value.trim() ? value : null
const coded = (code, message) => Object.assign(new Error(message), { code })
/** A construction refusal carries its machine code beside the message, so a Host can assert on it. */
const badOptions = (message) => { const [code, ...rest] = String(message).split(': '); return Object.assign(new TypeError(message), { code, detail: rest.join(': ') }) }

/** Two pinned entries are the same installation only when every recorded fact agrees. */
const entryEquals = (left, right) => Boolean(left) && Boolean(right)
  && left.executable === right.executable && left.sha256 === right.sha256
  && left.version === right.version && (left.script ?? null) === (right.script ?? null)
  && (left.scriptSha256 ?? null) === (right.scriptSha256 ?? null)

/** Turn refusal → one terminal SDK failure, so no consumer has to guess an outcome. */
const failureOf = error => {
  const code = typeof error?.code === 'string' && error.code ? error.code : codeOfMessage(error?.message)
  return { code, message: String(error?.message ?? error ?? 'claude route failed') }
}

/** The engine refuses with plain Errors whose code leads the message; keep it machine-readable. */
const codeOfMessage = message => {
  const match = /^([A-Z][A-Z0-9_]{2,})(?::[ \n]|$)/.exec(typeof message === 'string' ? message : '')
  return match ? match[1] : 'CLAUDE_TURN_FAILED'
}

const finishChunk = (kind, failure) => ({ type: 'finish', reason: { kind, failure } })

/** A native pid that no longer exists. */
const pidAlive = pid => { try { process.kill(pid, 0); return true } catch { return false } }

/**
 * Wait, bounded, for the engine to notice that its retained process is gone.
 *
 * A process that exits right after its `result` frame is only noticed when the supervisor
 * reports the stop, which can land after the turn promise already resolved. Dispatching the
 * next prompt into that dead pipe loses the turn without any outcome, so the bridge gives
 * the engine a moment to retire it and relaunch with `--resume`. A live process, or no
 * process at all, returns immediately; the wait never blocks a healthy turn.
 */
async function awaitRetiredProcessNotice(engine, timeoutMs = 5_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const retained = engine.snapshot?.().process ?? null
    if (!retained || !Number.isInteger(retained.pid) || retained.pid <= 0 || pidAlive(retained.pid)) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
/**
 * Native stop reasons after which the retained session cannot be continued: the upstream
 * conversation is gone, the identity failed, the grant was revoked, the process died
 * mid-turn or the turn timed out. Each of them ends the native session, so the bridge
 * retires it and the Host is told to open a new one instead of silently starting a fresh
 * session that has lost the conversation.
 */
const RETIRING_STOP_REASONS = Object.freeze([
  'resume-refused', 'model-identity-mismatch', 'grant-revoked', 'engine-stopped',
  'turn-timeout', 'exit-before-result',
])

/**
 * The Claude retained-session route as a public `LlmAdapter`.
 *
 * Register with the installed runtime exactly like any other adapter:
 * `ctx.llm.registerAdapter([provider], createClaudeLlmAdapter(hostOptions))`.
 */
export class ClaudeLlmAdapter extends LlmAdapter {
  #provider
  #model
  #name
  #funding
  #fundingFor
  #entry
  #entryFor
  #runtimeRoot
  #workspaceFor
  #workspace
  #identityFor
  #requestFor
  #persona
  #hooks
  #onPermissionRequest
  #provisionCredentials
  #tools
  #handlers
  #toolsFor
  #onActivity
  #activityObserverFailures = 0
  #permissionMode
  #deadlineMs
  #launcher
  #python
  #engineFactory
  #nativeSession
  #generation = 1
  #closed = false
  #sessions = new Map()
  #creations = new Set()
  #engines = new Set()

  /**
   * @param {object} options every value is trusted Host state.
   * @param {string} options.provider the one provider route id this adapter serves
   * @param {string} options.model the one exact committed model id
   * @param {string} [options.name] display name for selectors and diagnostics
   * @param {string} [options.funding='subscription'] committed funding kind; only `subscription` opens the route
   * @param {Function} [options.fundingFor] `({provider, model}) => funding` trusted committed-funding read, re-checked per prepared call
   * @param {{executable:string, sha256:string, version:string, script?:string, scriptSha256?:string}} [options.entry] pinned installation reference
   * @param {Function} [options.entryFor] `() => entry|Promise<entry>` trusted pinned-installation read; a changed pin refuses the captured generation
   * @param {string} options.runtimeRoot isolated absolute runtime root the engine creates its private homes under
   * @param {Function} [options.workspaceFor] `({botId, sessionId}) => absolute workspace` trusted per-conversation workspace
   * @param {string} [options.workspace] default absolute conversation workspace
   * @param {Function} options.identityFor `({provider, model, sessionId, purpose}) => identity` — see the module header
   * @param {string} [options.persona] Host-confirmed persona, when it is not per-Bot identity state
   * @param {{onBeforeRequest?:Function, onObserve?:Function, onSettle?:Function, onClose?:Function}} [options.hooks] engine hooks; the money authority stays the SDK waterfall
   * @param {Function} [options.onPermissionRequest] Host permission callback; absent denies every ask
   * @param {Function} [options.provisionCredentials] `(home, identity) => Promise` writes subscription credentials into the isolated home
   * @param {Function} [options.requestFor] Host-only canonical request projection; never supplied by model arguments
   * @param {string[]} [options.tools] committed-grant tool names bridged into the engine over MCP
   * @param {Array<{definition:{name}, parse:Function, execute:Function}>} [options.handlers] bridge handlers for `tools`
   * @param {string} [options.permissionMode='default'] engine permission mode (bypassPermissions is refused by the engine)
   * @param {number} [options.deadlineMs=120000] bounded lifetime of one engine
   * @param {{probe?:Function, protect?:Function, supervise?:Function}} [options.launcher] process-launcher seam
   * @param {string} [options.python] native-peer interpreter selection
   * @param {Function} [options.engineFactory] `(config) => Promise<engine>` retained-session seam; the default is the real `createClaudeEngine`
   * @param {boolean} [options.nativeSession=false] use generic native-session display text for another registered driver
   */
  constructor(options = {}) {
    super()
    const {
      provider, model, name, funding = CLAUDE_LLM_FUNDING, fundingFor = null,
      entry = null, entryFor = null, runtimeRoot, workspace = null, workspaceFor = null,
      identityFor, requestFor = null, persona = null, hooks = {}, onPermissionRequest = null, provisionCredentials = null,
      tools = [], handlers = [], toolsFor = null, onActivity = null, permissionMode = 'default', deadlineMs = 120_000,
      launcher = null, python, engineFactory = null, nativeSession = false,
    } = options ?? {}
    if (!identifier(provider)) throw badOptions('CLAUDE_ROUTE_PROVIDER_REQUIRED')
    if (typeof nativeSession !== 'boolean') throw badOptions('CLAUDE_ROUTE_METADATA_INVALID')
    if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(model)) throw badOptions('CLAUDE_ROUTE_MODEL_REQUIRED')
    if (funding !== CLAUDE_LLM_FUNDING) {
      throw badOptions(`CLAUDE_ROUTE_FUNDING_REFUSED: this bridge only opens an explicitly configured Claude subscription chat route, not ${JSON.stringify(funding)}`)
    }
    if (fundingFor !== null && typeof fundingFor !== 'function') throw badOptions('CLAUDE_ROUTE_FUNDING_READER_REQUIRED_FUNCTION')
    if ((entry === null) === (entryFor === null)) throw badOptions('CLAUDE_ROUTE_ENTRY_REQUIRED: provide exactly one of entry / entryFor')
    if (entry !== null && (!entry.executable || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || typeof entry.version !== 'string')) throw badOptions('CLAUDE_ROUTE_ENTRY_INVALID')
    if (entryFor !== null && typeof entryFor !== 'function') throw badOptions('CLAUDE_ROUTE_ENTRY_READER_REQUIRED_FUNCTION')
    if (!isAbsolute(runtimeRoot ?? '')) throw badOptions('CLAUDE_ROUTE_RUNTIME_ROOT_REQUIRED')
    if (workspace !== null && !isAbsolute(workspace)) throw badOptions('CLAUDE_ROUTE_WORKSPACE_REQUIRED_ABSOLUTE')
    if (workspaceFor !== null && typeof workspaceFor !== 'function') throw badOptions('CLAUDE_ROUTE_WORKSPACE_READER_REQUIRED_FUNCTION')
    if (workspace === null && workspaceFor === null) throw badOptions('CLAUDE_ROUTE_WORKSPACE_REQUIRED')
    if (typeof identityFor !== 'function') throw badOptions('CLAUDE_ROUTE_IDENTITY_RESOLVER_REQUIRED')
    if (requestFor !== null && typeof requestFor !== 'function') throw badOptions('CLAUDE_ROUTE_REQUEST_PROJECTOR_REQUIRED_FUNCTION')
    if (persona !== null && typeof persona !== 'string') throw badOptions('CLAUDE_ROUTE_PERSONA_REQUIRED_STRING')
    for (const key of ['onBeforeRequest', 'onObserve', 'onSettle', 'onClose']) {
      if (hooks[key] !== undefined && typeof hooks[key] !== 'function') throw badOptions(`CLAUDE_ROUTE_HOOK_${key.toUpperCase()}_REQUIRED_FUNCTION`)
    }
    if (onPermissionRequest !== null && typeof onPermissionRequest !== 'function') throw badOptions('CLAUDE_ROUTE_PERMISSION_CALLBACK_REQUIRED_FUNCTION')
    if (provisionCredentials !== null && typeof provisionCredentials !== 'function') throw badOptions('CLAUDE_ROUTE_CREDENTIAL_PROVIDER_REQUIRED_FUNCTION')
    if (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(tool))) throw badOptions('CLAUDE_ROUTE_TOOLS_INVALID')
    if (!Array.isArray(handlers) || handlers.some(handler => !handler?.definition?.name || typeof handler.parse !== 'function' || typeof handler.execute !== 'function')) throw badOptions('CLAUDE_ROUTE_HANDLERS_INVALID')
    if (toolsFor !== null && typeof toolsFor !== 'function') throw badOptions('CLAUDE_ROUTE_TOOLS_PROVIDER_REQUIRED_FUNCTION')
    if (onActivity !== null && typeof onActivity !== 'function') throw badOptions('CLAUDE_ROUTE_ACTIVITY_CALLBACK_REQUIRED_FUNCTION')
    if (engineFactory !== null && typeof engineFactory !== 'function') throw badOptions('CLAUDE_ROUTE_ENGINE_FACTORY_REQUIRED_FUNCTION')
    if (launcher !== null && (typeof launcher !== 'object' || typeof launcher.probe !== 'function' || typeof launcher.protect !== 'function' || typeof launcher.supervise !== 'function')) throw badOptions('CLAUDE_ROUTE_LAUNCHER_INVALID')

    this.#provider = provider
    this.#model = model
    this.#name = typeof name === 'string' && name.trim() ? name.trim() : `${provider} (Claude session)`
    this.#funding = funding
    this.#fundingFor = fundingFor
    this.#entry = entry === null ? null : Object.freeze({ ...entry })
    this.#entryFor = entryFor
    this.#runtimeRoot = runtimeRoot
    this.#workspaceFor = workspaceFor
    this.#workspace = workspace
    this.#identityFor = identityFor
    this.#requestFor = requestFor
    this.#persona = persona
    this.#hooks = hooks
    this.#onPermissionRequest = onPermissionRequest
    this.#provisionCredentials = provisionCredentials
    this.#tools = [...tools]
    this.#handlers = [...handlers]
    this.#toolsFor = toolsFor
    this.#onActivity = onActivity
    this.#permissionMode = permissionMode
    this.#deadlineMs = Number.isSafeInteger(deadlineMs) && deadlineMs >= 1000 && deadlineMs <= 7_200_000 ? deadlineMs : 120_000
    this.#launcher = launcher
    this.#python = python
    this.#engineFactory = engineFactory ?? (config => createClaudeEngine(config))
    this.#nativeSession = nativeSession
  }

  /** Display metadata for the one route this registration holds. */
  providerInfo(provider) {
    if (provider !== this.#provider) throw new LlmError(`this adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    return Object.freeze({ id: this.#provider, name: this.#name })
  }

  /** The one committed model this route serves; nothing is advertised that is not committed. */
  async listModels(provider) {
    if (provider !== this.#provider) return []
    return [Object.freeze({
      provider: this.#provider, id: this.#model, name: this.#model,
      description: `${this.#nativeSession ? '原生' : 'Claude '}订阅会话路由：一次一条新的用户文本，保留一个原生 CLI 会话。`,
      inputModalities: Object.freeze(['text']),
    })]
  }

  /**
   * Exact-route metadata. Deliberately absent: `context` (no context window is known for a
   * subscription CLI session, so none is invented), `defaultMaxTokens` (the route cannot
   * bound output tokens, so it declares no cap to materialize), and `reasoning` (no
   * selectable efforts are exposed).
   */
  async resolveModel(provider, model, signal) {
    if (provider !== this.#provider || model !== this.#model) {
      throw new LlmError(`this route serves only ${this.#provider}/${this.#model}`, 'CLAUDE_MODEL_NOT_CONFIGURED')
    }
    signal?.throwIfAborted()
    return Object.freeze({
      provider: this.#provider, id: this.#model, name: this.#model,
      description: `${this.#nativeSession ? '原生' : 'Claude '}订阅会话路由：仅文本，上下文窗口与输出上界未知（不伪造）。`,
      inputModalities: Object.freeze(['text']),
    })
  }

  /**
   * Bind this call to one immutable route generation: the exact model metadata, the funding
   * the Host has committed right now, and the pinned installation reference as it stands at
   * preparation time. A later Host re-pin (`replaceRoute`) refuses the captured generation
   * instead of mixing one generation's route with another's entry or funding.
   */
  async prepareCall(provider, model, signal) {
    const generation = await this.#capture(provider, model, signal)
    return Object.freeze({
      model: generation.resolved,
      stream: options => this.#streamGeneration(generation, options),
    })
  }

  /** The unprepared entry point the SDK's `stream()` reaches through the waterfall. */
  async *stream(options) {
    const prepared = await this.prepareCall(options?.provider, options?.model, options?.signal)
    yield* prepared.stream(options)
  }

  // ---- Host-only route control ------------------------------------------------

  /**
   * Re-pin this registration's route: a changed committed model, funding, entry or persona.
   * The swap is atomic and bumps the generation, so a call prepared against the previous
   * generation is refused rather than dispatched on mixed state. Sessions bound to the old
   * route are retired without creating any engine. Host-only: a request can never call this.
   *
   * @param {{model?:string, funding?:string, entry?:object, persona?:string|null, name?:string}} next
   */
  replaceRoute(next = {}) {
    if (this.#closed) throw new LlmError('this registration has been released', 'REGISTRATION_DISPOSED')
    if (!next || typeof next !== 'object') throw badOptions('CLAUDE_ROUTE_REPLACEMENT_REQUIRED')
    const model = next.model ?? this.#model
    if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(model)) throw badOptions('CLAUDE_ROUTE_MODEL_REQUIRED')
    const funding = next.funding ?? this.#funding
    if (funding !== CLAUDE_LLM_FUNDING) throw badOptions(`CLAUDE_ROUTE_FUNDING_REFUSED: ${JSON.stringify(funding)}`)
    const entry = next.entry === undefined ? this.#entry : Object.freeze({ ...next.entry })
    if (entry !== null && (!entry.executable || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || typeof entry.version !== 'string')) throw badOptions('CLAUDE_ROUTE_ENTRY_INVALID')
    const persona = next.persona === undefined ? this.#persona : next.persona
    if (persona !== null && typeof persona !== 'string') throw badOptions('CLAUDE_ROUTE_PERSONA_REQUIRED_STRING')
    this.#model = model
    this.#funding = funding
    this.#entry = entry
    this.#persona = persona
    if (typeof next.name === 'string' && next.name.trim()) this.#name = next.name.trim()
    this.#generation++
    // Every session was bound to the previous route facts: retire them now, and create
    // nothing. A later call on a retired session is refused, never silently re-bound.
    for (const session of [...this.#sessions.values()]) void this.#retire(session, 'route-replaced', false)
    return Object.freeze({ provider: this.#provider, model: this.#model, generation: this.#generation })
  }

  /**
   * Release the registration: refuse every further call, wait for an engine that is still
   * being created, and stop every live native tree with real settlement. Creates nothing.
   */
  async invalidateBot(botId, reason = 'host-state-changed') {
    const sessions = [...this.#sessions.values()].filter(session => session.botId === botId)
    const creating = sessions.map(session => session.creation).filter(Boolean)
    const evidence = await Promise.all(sessions.map(session => this.#retire(session, reason, false)))
    await Promise.allSettled(creating)
    return Object.freeze({ retired: sessions.length, evidence: sessions.map((session, index) => session.evidence ?? evidence[index]) })
  }

  async close() {
    this.#closed = true
    const creations = [...this.#creations]
    this.#creations.clear()
    // Wait for a creation that is still in flight before stopping anything: a tree that is
    // being launched right now is exactly the one disposal must not orphan.
    await Promise.allSettled(creations)
    const stopped = []
    for (const session of [...this.#sessions.values()]) {
      if (session.engine) stopped.push(this.#retire(session, 'adapter-closed', false))
      else session.retired = Object.freeze({ reason: 'adapter-closed', resumable: false, at: Date.now() })
    }
    this.#sessions.clear()
    await Promise.allSettled(stopped)
    return Object.freeze({ closed: true, sessions: stopped.length })
  }

  /** Observable route state: no money, no credentials, no message content. */
  snapshot() {
    return Object.freeze({
      schemaVersion: 1, driver: 'claude', provider: this.#provider, model: this.#model,
      name: this.#name, funding: this.#funding, generation: this.#generation, closed: this.#closed,
      activityObserverFailures: this.#activityObserverFailures,
      capabilities: CLAUDE_LLM_CAPABILITIES,
      sessions: Object.freeze([...this.#sessions.values()].map(session => Object.freeze({
        key: session.key, botId: session.botId, sessionId: session.sessionId,
        turns: session.turns, retired: session.retired, lastSessionId: session.lastSessionId,
        engineClosed: session.engine ? session.engine.closed : null,
        pid: session.engine?.snapshot?.().process?.pid ?? null,
        usageStatus: session.usageStatus, stopEvidence: session.evidence,
      }))),
    })
  }

  // ---- internals ---------------------------------------------------------------

  /** One immutable route generation: model, funding and pinned entry as of preparation. */
  async #capture(provider, model, signal) {
    if (this.#closed) throw new LlmError('this registration has been released', 'REGISTRATION_DISPOSED')
    if (provider !== this.#provider || model !== this.#model) {
      throw new LlmError(`this route serves only ${this.#provider}/${this.#model}`, 'CLAUDE_MODEL_NOT_CONFIGURED')
    }
    signal?.throwIfAborted()
    const funding = this.#fundingFor === null ? this.#funding : await this.#fundingFor({ provider, model })
    if (funding !== CLAUDE_LLM_FUNDING) {
      throw new LlmError(
        `this bridge only opens an explicitly configured Claude subscription chat route; committed funding is ${JSON.stringify(funding)} and an API-funded CLI route cannot prove a strict per-call cost or output bound here`,
        'CLAUDE_ROUTE_FUNDING_REFUSED')
    }
    const entry = this.#entryFor === null ? this.#entry : await this.#entryFor()
    if (!entry || !entry.executable || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
      throw new LlmError('the Host pinned installation reference is missing or invalid', 'CLAUDE_ROUTE_ENTRY_INVALID')
    }
    const resolved = await this.resolveModel(provider, model, signal)
    return Object.freeze({
      generation: this.#generation, provider, model, funding, entry: Object.freeze({ ...entry }), resolved,
    })
  }

  /** The stream of one captured generation. Every refusal here is a terminal chunk. */
  async *#streamGeneration(generation, options) {
    if (this.#closed) { yield finishChunk('error', { code: 'CLAUDE_ADAPTER_CLOSED', message: '本路由已释放。' }); return }
    if (generation.generation !== this.#generation) {
      yield finishChunk('error', {
        code: 'CLAUDE_ROUTE_GENERATION_CHANGED',
        message: '宿主在准备之后重新登记了本路由（模型/资金/入口/人格代际已变），这次调用被拒绝而不是混代投递。',
      })
      return
    }
    let gate
    let bootstrap = null
    let identity
    try {
      identity = await this.#identityFor({
        provider: generation.provider, model: generation.model,
        sessionId: options.sessionId ?? null, purpose: null,
      })
    } catch (error) { yield finishChunk('error', { code: 'CLAUDE_IDENTITY_UNRESOLVED', message: String(error?.message ?? error) }); return }
    const invalid = this.#validateIdentity(identity)
    if (invalid) { yield finishChunk('error', { code: invalid, message: '宿主未提供可信的已提交 Bot 身份。' }); return }

    // The persona this call is measured against comes from committed Host identity state,
    // so a request's own system message can only ever be compared with it — never trusted.
    const persona = identity.persona ?? this.#persona ?? null
    try {
      const projected = this.#requestFor ? await this.#requestFor(options, identity) : null
      if (projected?.request) bootstrap = projected.bootstrap ?? null
      gate = assertRouteRequest(projected?.request ?? projected ?? options, { provider: generation.provider, model: generation.model, persona })
    } catch (error) { yield finishChunk('error', failureOf(error)); return }

    const key = sessionKeyOf(identity.botId, identity.conversationId ?? options.sessionId ?? null)
    let session = this.#sessions.get(key) ?? null
    let fingerprint
    try {
      fingerprint = this.#fingerprint(generation, identity)
    } catch (error) { yield finishChunk('error', { code: 'CLAUDE_IDENTITY_UNRESOLVED', message: String(error?.message ?? error) }); return }
    if (session !== null && session.fingerprint !== fingerprint) {
      // A different Bot, model, persona or grant revision on one conversation key is a new
      // binding, not a continuation: retire the old session and refuse this call.
      await this.#retire(session, 'binding-changed', false)
      yield finishChunk('error', { code: 'CLAUDE_SESSION_BINDING_CHANGED', message: '本次调用与已保留会话的 Bot/模型/人格/授权代际不一致，已退休旧会话并拒绝。' })
      return
    }
    const newSession = (prompt = persona, state = emptyTurnState()) => ({
        key, botId: identity.botId, sessionId: options.sessionId ?? null, fingerprint,
        persona: prompt, state,
        engine: null, creation: null, turns: 0, retired: null, lastSessionId: null,
        evidence: null, usageStatus: 'unknown',
    })
    if (session === null) {
      session = newSession()
      this.#sessions.set(key, session)
    } else if (session.retired) {
      // A retired conversation key cannot be continued: the native session is gone and an
      // unknown-outcome process is never replayed into a fresh one. The Host opens a new session.
      yield finishChunk('error', {
        code: 'CLAUDE_SESSION_RETIRED',
        message: `本会话已退休（${session.retired.reason}）：不为未知结果自动新开会话，请开启新会话。`,
      })
      return
    }
    let projection
    try {
      projection = projectRetainedTurn({
        messages: gate.messages, provider: generation.provider, model: generation.model, state: session.state,
      })
    } catch (error) {
      if (error.code === 'CLAUDE_SESSION_HISTORY_UNSEEN' && bootstrap && bootstrap.prefixLength >= session.state.sent.length) {
        try {
          if (session.creation || session.engine?.snapshot?.().turn) throw coded('CLAUDE_TURN_BUSY', '上一轮仍在处理，不能切换原生上下文。')
          const state = seedTurnState(gate.messages, bootstrap.prefixLength)
          projection = projectRetainedTurn({ messages: gate.messages, provider: generation.provider, model: generation.model, state })
          const prompt = `${persona ?? ''}${bootstrap.context}`
          if (Buffer.byteLength(prompt) > 32_000 || prompt.includes('\0')) throw coded('CLAUDE_HOST_ROUTE_CONTEXT_LIMIT', '完整文本上下文超过原生会话可接收的上限。')
          if (session.engine) {
            const evidence = await this.#retire(session, 'host-route-switch', false)
            if (!evidence?.treeStopped || evidence.status === 'unknown' || evidence.possiblyApplied === true) throw coded('CLAUDE_HOST_ROUTE_STOP_UNCONFIRMED', '旧原生进程尚未确认停止。')
          }
          options.signal?.throwIfAborted()
          session = newSession(prompt, state)
          this.#sessions.set(key, session)
        } catch (failure) { yield finishChunk('error', failureOf(failure)); return }
      } else {
        // Retire only a session that was actually used. A rejected first request
        // leaves its key available for the Host to supply valid history.
        if (['CLAUDE_SESSION_HISTORY_CHANGED', 'CLAUDE_SESSION_HISTORY_UNSEEN'].includes(error.code)
          && (session.engine !== null || session.turns > 0)) {
          await this.#retire(session, 'history-changed', false)
        }
        yield finishChunk('error', failureOf(error))
        return
      }
    }

    let engine
    try {
      engine = await this.#ensureEngine(session, identity, generation)
    } catch (error) {
      yield finishChunk('error', failureOf(error))
      return
    }

    yield* this.#runTurn(session, engine, generation, projection, options)
  }

  /** Trusted identity shape check; the values themselves are Host state, never request state. */
  #validateIdentity(identity) {
    if (!identity || typeof identity !== 'object') return 'CLAUDE_IDENTITY_UNRESOLVED'
    if (typeof identity.botId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(identity.botId)) return 'CLAUDE_IDENTITY_BOT_REQUIRED'
    if (!identity.subject || typeof identity.subject !== 'object') return 'CLAUDE_IDENTITY_SUBJECT_REQUIRED'
    if (!identity.authority || typeof identity.authority.assertModel !== 'function' || typeof identity.authority.describe !== 'function') return 'CLAUDE_IDENTITY_AUTHORITY_REQUIRED'
    const binding = identity.binding
    if (!binding || typeof binding !== 'object' || !identifier(binding.taskId) || !identifier(binding.attemptId)
      || typeof binding.machineId !== 'string' || !binding.machineId || typeof binding.workspaceId !== 'string' || !binding.workspaceId
      || !['local', 'remote'].includes(binding.location)) return 'CLAUDE_IDENTITY_BINDING_REQUIRED'
    if (identity.persona !== undefined && identity.persona !== null && typeof identity.persona !== 'string') return 'CLAUDE_IDENTITY_PERSONA_INVALID'
    if (identity.conversationId !== undefined && (typeof identity.conversationId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.conversationId))) return 'CLAUDE_IDENTITY_CONVERSATION_INVALID'
    return null
  }

  /** The binding one conversation key may not change underneath a retained session. */
  #fingerprint(generation, identity) {
    const revision = identity.authority.describe(identity.subject).revision
    return JSON.stringify([
      generation.provider, generation.model, identity.botId,
      identity.conversationId ?? null,
      identity.persona ?? this.#persona ?? null, revision,
    ])
  }
  /**
   * The one engine of this session, created lazily. A creation already in flight is shared,
   * so a concurrent second turn meets the engine's own single-turn fence rather than a
   * second process. Disposal waits on these creations; nothing is created after close.
   */
  async #ensureEngine(session, identity, generation) {
    if (this.#closed) throw coded('CLAUDE_ADAPTER_CLOSED', '本路由已释放。')
    if (session.engine && !session.engine.closed) return session.engine
    if (session.creation) return session.creation
    if (session.retired) {
      throw coded('CLAUDE_SESSION_RETIRED',
        `本会话的原生引擎已退休（${session.retired.reason}）：结果未知的进程不会自动开新会话重放，请开启新会话。`)
    }
    // The pinned entry is re-read at creation: a Host re-pin that did not go through
    // replaceRoute still refuses this generation instead of launching a different binary.
    const current = this.#entryFor === null ? this.#entry : await this.#entryFor()
    if (!entryEquals(current, generation.entry)) {
      throw coded('CLAUDE_ROUTE_ENTRY_CHANGED', '宿主固定的安装引用在准备之后发生变化，这次调用被拒绝。')
    }
    const workspace = this.#workspaceFor === null
      ? this.#workspace
      : await this.#workspaceFor({ botId: identity.botId, sessionId: session.sessionId })
    if (typeof workspace !== 'string' || !isAbsolute(workspace)) throw coded('CLAUDE_ROUTE_WORKSPACE_REQUIRED', '宿主未提供绝对的工作区路径。')
    const nativeTools = this.#toolsFor ? await this.#toolsFor(identity) : { tools: this.#tools, handlers: this.#handlers }
    const config = {
      authority: identity.authority,
      subject: identity.subject,
      binding: identity.binding,
      operationId: `op-${randomBytes(8).toString('hex')}`,
      entry: generation.entry,
      runtimeRoot: this.#runtimeRoot,
      workspace,
      model: { catalogProvider: generation.provider, catalogModel: generation.model },
      permissionMode: this.#permissionMode,
      billing: generation.funding,
      tools: nativeTools.tools,
      handlers: nativeTools.handlers,
      deadlineMs: this.#deadlineMs,
      hooks: this.#hooks,
      ...(this.#onPermissionRequest ? { onPermissionRequest: this.#onPermissionRequest } : {}),
      ...(this.#provisionCredentials ? { provisionCredentials: home => this.#provisionCredentials(home, identity) } : {}),
      ...(this.#launcher ? { launcher: this.#launcher } : {}),
      ...(this.#python ? { python: this.#python } : {}),
      // The persona travels to the engine as a Host-confirmed value. The current engine
      // ignores unknown options; the engine system-prompt seam is the parent's wiring
      // decision (see the bridge report's wiring.patch). It is never re-sent as turn text.
      ...(session.persona ? { systemPrompt: session.persona } : {}),
    }
    const creation = (async () => {
      const engine = await this.#engineFactory(config)
      this.#engines.add(engine)
      engine.events.on('session', value => { if (value?.sessionId) session.lastSessionId = value.sessionId })
      engine.events.on('tree-stopped', value => { session.evidence = value })
      let activeActivity = null
      const observe = value => {
        if (!this.#onActivity) return
        try {
          if (!value || !['turn-open', 'tool', 'turn-close', 'stop-confirmed', 'cancel-requested'].includes(value.kind)
            || typeof value.turnId !== 'string' || typeof value.processGeneration !== 'string'
            || typeof identity.conversationId !== 'string') throw new Error('CLAUDE_ACTIVITY_IDENTITY_MISSING')
          const scope = Object.freeze({ botId: identity.botId, mode: identity.independent ? 'independent' : 'integration',
            conversationId: identity.conversationId, contextId: identity.independent ? identity.conversationId : null,
            processGeneration: value.processGeneration, turnId: value.turnId })
          if (value.kind === 'turn-open') activeActivity = { turnId: value.turnId, processGeneration: value.processGeneration }
          const result = this.#onActivity(Object.freeze({ kind: value.kind, identity: scope,
            ...(value.kind === 'tool' ? { tool: Object.freeze({ phase: value.tool?.phase, id: value.tool?.id,
              ...(value.tool?.phase === 'started' ? { name: value.tool?.name } : { ok: value.tool?.ok }) }) } : {}),
            ...(value.kind === 'turn-close' ? { outcome: value.outcome } : {}) }))
          if (result?.then) { result.catch?.(() => {}); throw new Error('CLAUDE_ACTIVITY_CALLBACK_MUST_BE_SYNCHRONOUS') }
        } catch { this.#activityObserverFailures++ }
      }
      engine.events.on('activity', observe)
      // Only the adapter's own current request signal asks for cancellation.
      // The actual engine supplies separate supervisor-confirmed stop evidence.
      session.requestActivityCancel = () => {
        if (activeActivity && engine.snapshot?.().turn?.turnId === activeActivity.turnId) observe({ kind: 'cancel-requested', ...activeActivity })
      }
      return engine
    })()
    const tracked = creation.then(engine => {
      this.#creations.delete(tracked)
      session.creation = null
      if (session.retired) {
        // The session was retired while this engine was being created (a route re-pin, a
        // binding change or a disposal). Stop what was just launched instead of storing an
        // engine nobody may dispatch into.
        this.#engines.delete(engine)
        return engine.stop(`bridge-retire:${session.retired.reason}`).then(() => engine, () => engine)
      }
      session.engine = engine
      return engine
    }, error => { this.#creations.delete(tracked); session.creation = null; throw error })
    this.#creations.add(tracked)
    session.creation = tracked
    return tracked
  }

  /** Stop one session's native tree and record why; the engine's own settlement is awaited. */
  async #retire(session, reason, resumable) {
    const engine = session.engine
    session.retired = Object.freeze({ reason, resumable: resumable === true, at: Date.now() })
    session.engine = null
    session.creation = null
    if (!engine) return session.evidence ?? null
    this.#engines.delete(engine)
    try {
      const proof = await engine.stop(`bridge-retire:${reason}`)
      session.evidence = proof ?? { status: 'unknown', treeStopped: false }
      if (engine.snapshot?.().launches === 0 && proof?.status === 'no-process' && !(proof.interruptedLaunches > 0)) {
        session.evidence = { ...proof, notStarted: true, possiblyApplied: false }
      }
      return session.evidence
    } catch (error) {
      session.evidence = { status: 'unknown', treeStopped: false, reason: 'native-stop-failed' }
      throw error
    }
  }

  /**
   * One turn: dispatch the projected new user text, stream the native answer as SDK chunks,
   * and finish exactly once — after the engine's own Host settlement has completed.
   */
  async *#runTurn(session, engine, generation, projection, options) {
    const queue = []
    const started = { text: false, reasoning: false }
    const facts = { text: '', reasoning: '', toolCalls: 0, assistantText: null }
    let wake = null
    const wakeUp = () => { if (wake) { const resolve = wake; wake = null; resolve() } }
    const push = chunk => { queue.push(chunk); wakeUp() }
    const onDelta = value => {
      if (value?.streamKind === 'assistant_text' && typeof value.delta === 'string') {
        if (!started.text) { started.text = true; push({ type: 'block-start', index: 0, blockType: 'text' }) }
        facts.text += value.delta
        push({ type: 'text-delta', index: 0, text: value.delta })
        return
      }
      if (value?.streamKind === 'reasoning_text' && typeof value.delta === 'string') {
        if (!started.reasoning) { started.reasoning = true; push({ type: 'block-start', index: 1, blockType: 'reasoning' }) }
        facts.reasoning += value.delta
        push({ type: 'reasoning-delta', index: 1, text: value.delta })
      }
    }
    const onAssistant = value => {
      // A CLI that emits no partial messages still publishes its whole assistant message:
      // use it only when no delta arrived, so text is never counted twice.
      if (facts.text === '' && typeof value?.text === 'string' && value.text) facts.assistantText = value.text
    }
    const onTool = value => { if (value?.phase === 'started') facts.toolCalls++ }
    engine.events.on('delta', onDelta)
    engine.events.on('assistant', onAssistant)
    engine.events.on('tool', onTool)

    // The retained process may have exited while the previous turn was settling, before the
    // supervisor reported it. Writing the prompt into that pipe loses the turn silently, so
    // wait (bounded) for the engine to notice before dispatching. A live process, or none at
    // all, dispatches immediately.
    await awaitRetiredProcessNotice(engine)

    let outcome = null
    const submission = engine.submitTurn({ text: projection.text }).then(
      result => { outcome = { result }; wakeUp() },
      error => { outcome = { error }; wakeUp() },
    )
    submission.catch(() => {})
    // A retained process that exits after its result is only noticed when the supervisor
    // reports the stop, which can land after the turn promise already resolved. If the
    // engine never settles this dispatched turn because of that death, the prompt is lost
    // without any outcome — so watch for it and stop the tree, which settles the turn as the
    // unknown outcome it really is instead of waiting for the turn timer.
    const launchMark = engine.snapshot?.().launches ?? null
    let processLost = false
    const watcher = setInterval(() => {
      const snap = engine.snapshot?.()
      if (!snap || processLost) return
      if (snap.process !== null || snap.launches !== launchMark) return
      const turn = snap.turn
      if (!turn || turn.settled === true || turn.dispatched !== true) return
      processLost = true
      void engine.stop('bridge-process-lost')
    }, 100)
    watcher.unref?.()
    const onAbort = () => { if (!outcome) { session.requestActivityCancel?.(); outcome = { aborted: true }; wakeUp() } }
    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      while (queue.length || outcome === null) {
        while (queue.length) yield queue.shift()
        if (outcome !== null) break
        await new Promise(resolve => { wake = resolve })
      }
      while (queue.length) yield queue.shift()

      if (outcome.aborted === true) {
        // Cancellation stops the native tree first and waits for the engine's own
        // settlement, so the turn's outcome is observed — never a guessed success.
        const evidence = await engine.stop('turn-cancelled')
        await submission
        await this.#retire(session, 'turn-cancelled', false)
        yield finishChunk('aborted', {
          code: 'CLAUDE_TURN_CANCELLED',
          message: `本轮已取消，原生进程树已停止（${evidence?.status ?? 'unknown'}）。`,
        })
        return
      }
      if (outcome.error) {
        // A submit refusal (busy, stopped) is surfaced as it is; only a stopped engine
        // makes the session itself unusable.
        if (engine.closed) await this.#retire(session, 'engine-stopped', false)
        yield finishChunk('error', failureOf(outcome.error))
        return
      }
      const result = outcome.result
      // Only a turn the engine proves it wrote to the CLI's stdin advances the session's
      // delivered history: a provably undelivered turn is offered again by the next call.
      if (result?.dispatched === true) session.state = projection.state
      session.turns++
      session.usageStatus = result?.usageStatus ?? 'unknown'
      if (result?.ok !== true && (engine.closed || RETIRING_STOP_REASONS.includes(result.stopReason))) {
        // The native session cannot continue after this outcome; retiring it here keeps the
        // next call from silently opening a fresh session that lost the conversation.
        await this.#retire(session, `native-${result.stopReason ?? 'failed'}`, false)
      }
      if (started.reasoning) {
        yield { type: 'block-end', index: 1, block: { type: 'reasoning', text: facts.reasoning } }
      }
      if (!started.text && typeof facts.assistantText === 'string') {
        // No partial messages from this CLI: publish the whole assistant message as one
        // block instead of dropping the answer.
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: facts.assistantText }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: facts.assistantText } }
        facts.text = facts.assistantText
      } else if (started.text) {
        yield { type: 'block-end', index: 0, block: { type: 'text', text: facts.text } }
      }
      const usage = usageChunkFromTurn(result)
      if (usage) yield { type: 'usage', usage }
      const reason = finishReasonFromTurn(result, { textChars: facts.text.length })
      if (processLost && reason.kind !== 'stop') {
        reason.failure = {
          code: 'CLAUDE_SESSION_PROCESS_LOST',
          message: '保留会话的原生进程在本轮投递之后消失且没有结算：本轮结果未知，进程树已停止、会话已退休。',
        }
      }
      yield {
        type: 'finish',
        reason,
        replayState: { response: Object.freeze({
          ...turnFacts(result), sessionId: session.lastSessionId, provider: generation.provider, model: generation.model,
          toolCallsObserved: facts.toolCalls, reasoningChars: facts.reasoning.length,
          provenance: 'the CLI init frame names the configured model; the protocol does not prove the response backend',
        }) },
      }
    } finally {
      clearInterval(watcher)
      engine.events.off('delta', onDelta)
      engine.events.off('assistant', onAssistant)
      engine.events.off('tool', onTool)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
    }
  }
}

/** Host-facing constructor. See {@link ClaudeLlmAdapter} for the trusted option set. */
export function createClaudeLlmAdapter(options) {
  return new ClaudeLlmAdapter(options)
}
