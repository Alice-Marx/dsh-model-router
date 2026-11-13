// The generic ACP adapter the Host composition can wire.
//
// Ported and re-grounded from OpenMausBot server/drivers/acp/core.ts at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
// Upstream's ACP driver is embedded in a product server; this module is the
// same protocol core with every product decision pushed out to trusted Host
// state: authority, binding, entry, argv, environment, model routes, hooks.
//
// Product composition wires this core through bot-engines/acp-chat-engine.mjs.
// Driver-specific owner pinning and account provisioning live in that layer;
// offline protocol fixtures do not certify real vendor account inference.
//
// Authority and money boundaries, matching packages/bot-engines:
//   - a turn payload may carry `text` and nothing else;
//   - model, tool, executable, endpoint and credential authority comes from the
//     committed Host authority object, re-asserted every turn;
//   - usage/cost figures the agent does not report stay null/unknown — this
//     adapter keeps no second ledger and never estimates a dollar amount;
//   - permission decisions come only from the Host handler against committed
//     Tool/Task/operation grants;
//   - a cancel request is recorded separately from a confirmed process stop.
//
// Turn-fence invariants this module enforces (see packages/bot-acp/README.md):
//   - one turn slot per adapter, reserved synchronously before the first await,
//     so a same-tick second submit is refused with zero extra admission, launch
//     or prompt and no turn can be overwritten;
//   - a turn is settled exactly once, and the durable Host settlement hook runs
//     before the success is published or the slot released;
//   - "nothing was dispatched" (not-run) and "it may have been dispatched"
//     (unknown) are different answers and never merged;
//   - `turnsDispatched` counts dispatches, never completions;
//   - the session and the model identity a turn runs under cannot be changed
//     while that turn is pending: a new binding means a new adapter.

import { EventEmitter } from 'node:events'
import { createPrivateProfileHome } from '../../cli-runtime/src/native-process.mjs'
import { randomBytes } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { ACP_METHODS } from './rpc-codec.mjs'
import { createChildPipe, createStdioRpc } from './stdio-rpc.mjs'
import { createAcpHost } from './acp-host.mjs'
import { createAcpSession } from './session-core.mjs'
import { createClientMethodGuard } from './permission-policy.mjs'
import { DEFAULT_LAUNCHER, acpProcessHome, createSupervisorPipe, launchAcpProcess, pinAcpEntry } from './native-launch.mjs'

export const DEFAULT_ADAPTER_LIMITS = Object.freeze({
  deadlineMs: 120_000,
  cancelTimeoutMs: 30_000,
  stopGraceMs: 8_000,
  guardIntervalMs: 100,
  ttlMs: 600_000,
  permissionTimeoutMs: 15 * 60_000,
})

const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const BILLING_KINDS = ['subscription', 'api', 'unknown']
/** Same prompt bound the session core enforces; decided before a slot is taken. */
const MAX_TURN_BYTES = 64_000
/** Transport refusals that provably never wrote a request to the peer. */
const PROVABLY_UNSENT = ['acpNotDispatched', 'acpInvalidRequest', 'acpPendingLimit', 'acpFrameLimit', 'acpBacklogLimit']
const provablyUnsent = error => PROVABLY_UNSENT.some(marker => error?.[marker] === true)

/**
 * @param {object} options every value is trusted Host state.
 * @param {{describe: Function, assertModel: Function, assertTool?: Function}} options.authority
 * @param {object} options.subject registered authority subject
 * @param {{taskId: string, attemptId: string, machineId: string, workspaceId: string, location: 'local'|'remote'}} options.binding
 * @param {string} options.operationId durable operation identity
 * @param {{executable: string, sha256: string, version: string, script?: string, scriptSha256?: string}} options.entry pinned native entry
 * @param {string[]} [options.spawnArgs] Host-constructed argv after the executable (e.g. ['acp'])
 * @param {string[]} [options.versionArgs] Host-owned version probe args (default ['--version'])
 * @param {string} options.runtimeRoot isolated absolute runtime root
 * @param {string} options.workspace absolute conversation workspace (agent cwd)
 * @param {{catalogProvider?: string, catalogModel: string}} [options.model]
 * @param {string} [options.billing]
 * @param {number} [options.deadlineMs] bounded lifetime for the whole adapter
 * @param {AbortSignal} [options.signal]
 * @param {{onBeforeRequest?: Function, onObserve?: Function, onSettle?: Function, onClose?: Function}} [options.hooks] the only funding/ledger recipients
 * @param {Function} [options.onPermissionRequest] Host permission callback; absent denies every ask
 * @param {(identity: object) => string|null} [options.operationTool] maps an ask onto a committed tool name
 * @param {{fileSystem?: boolean, terminal?: boolean, roots?: string[], readTextFile?: Function, writeTextFile?: Function}} [options.clientCapabilities]
 * @param {{pickMethod?: Function, onAuthFailure?: 'fail'|'continue'}} [options.auth]
 * @param {string} [options.resumeSessionId] resume only when the agent advertises loadSession
 * @param {{probe?: Function, protect?: Function, supervise?: Function}} [options.launcher] process-launcher seam (tests may substitute)
 */
export async function createAcpAdapter(options = {}) {
  const {
    authority, subject, binding, operationId,
    entry, spawnArgs = [], versionArgs = ['--version'],
    runtimeRoot, workspace,
    model = {}, billing = 'subscription',
    deadlineMs = DEFAULT_ADAPTER_LIMITS.deadlineMs,
    signal, hooks = {}, onPermissionRequest, operationTool = null,
    clientCapabilities = {}, auth = {}, resumeSessionId = null, expectedModelId = null, requireModelSelection = false,
    launcher = DEFAULT_LAUNCHER, python, provisionCredentials = null,
  } = options
  const limits = { ...DEFAULT_ADAPTER_LIMITS, ...(options.limits ?? {}) }

  if (!authority || typeof authority.describe !== 'function' || typeof authority.assertModel !== 'function') throw new TypeError('ACP_AUTHORITY_REQUIRED')
  if (!subject || typeof subject !== 'object') throw new TypeError('ACP_SUBJECT_REQUIRED')
  if (!identifier(operationId)) throw new TypeError('INVALID_ACP_OPERATION')
  if (!isAbsolute(runtimeRoot ?? '') || !isAbsolute(workspace ?? '')) throw new TypeError('INVALID_ACP_PATHS')
  const catalogProvider = model.catalogProvider ?? 'unknown'
  const catalogModel = model.catalogModel
  if (typeof catalogProvider !== 'string' || !catalogProvider || typeof catalogModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(catalogModel)) throw new TypeError('INVALID_ACP_MODEL')
  if (!BILLING_KINDS.includes(billing)) throw new TypeError('INVALID_ACP_BILLING')
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 7_200_000) throw new TypeError('INVALID_ACP_DEADLINE')
  for (const key of ['onBeforeRequest', 'onObserve', 'onSettle', 'onClose']) {
    if (hooks[key] !== undefined && typeof hooks[key] !== 'function') throw new TypeError(`ACP_HOOK_${key.toUpperCase()}_REQUIRED_FUNCTION`)
  }
  if (onPermissionRequest !== undefined && typeof onPermissionRequest !== 'function') throw new TypeError('ACP_PERMISSION_CALLBACK_REQUIRED_FUNCTION')
  if (!Array.isArray(spawnArgs) || spawnArgs.some(arg => typeof arg !== 'string')) throw new TypeError('INVALID_ACP_SPAWN_ARGS')

  const events = new EventEmitter()
  const log = detail => events.emit('log', detail)
  signal?.throwIfAborted()

  const cwd = await realpath(workspace)
  if (!(await stat(cwd)).isDirectory()) throw new Error('INVALID_ACP_WORKSPACE')
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
  const root = await realpath(runtimeRoot)
  const home = await createPrivateProfileHome(root, `acp-${operationId}`, { recursive: true })
  for (const folder of ['tmp', 'cache', 'config', 'data', 'appdata', 'local']) await mkdir(join(home, folder), { recursive: true, mode: 0o700 })
  const probe = await launcher.probe({ home, python })
  if (!probe?.available) throw new Error(`NATIVE_PEER_UNAVAILABLE: ${probe?.reason ?? 'unknown'}`)
  await launcher.protect(probe.helper, home)
  if (provisionCredentials !== null && typeof provisionCredentials !== 'function') throw new TypeError('ACP_CREDENTIAL_PROVIDER_INVALID')
  const provisioned = await provisionCredentials?.(home)
  const environment = provisioned?.env ?? {}
  const pinned = await pinAcpEntry(entry, home, { versionArgs })
  const deadlineEnd = Date.now() + deadlineMs
  const { botId, revision } = authority.describe(subject)

  let rpc = null, host = null, session = null, pipe = null
  let currentProcess = null, stopPromise = null, stopped = false, fatalError = null
  let stopRequestedAt = null, launches = 0, turnsDispatched = 0, turnsAdmitted = 0, turnsSettled = 0, resumeRefused = false
  let sessionId = null, reportedModel = null, modelMismatch = false, modelSelectionConfirmed = false
  // One generation per launch: a retired process never answers for the turn
  // that replaced it, and a stop never leaves a late spawn behind.
  let generation = 0, launchPromise = null, retiredSpawn = null
  let guardTimer = null, deadlineTimer = null, cancelTimer = null
  let currentTurn = null
  let stopEvidenceValue = null

  const clientGuard = createClientMethodGuard({
    fileSystem: clientCapabilities.fileSystem === true,
    terminal: clientCapabilities.terminal === true,
    roots: Array.isArray(clientCapabilities.roots) ? clientCapabilities.roots : [],
    readTextFile: clientCapabilities.readTextFile ?? null,
    writeTextFile: clientCapabilities.writeTextFile ?? null,
    log,
  })

  const assertModelAuthorized = modelId => {
    if (typeof modelId !== 'string' || !modelId) throw new TypeError('ACP_MODEL_REQUIRED')
    // A model switch is a Host decision on committed state, never a turn input.
    authority.assertModel(subject, catalogProvider, modelId)
  }

  const fatal = (error, reason) => {
    if (stopped) return
    fatalError = error
    void stop(reason ?? 'adapter-fatal')
  }

  // ---- turn settlement ------------------------------------------------------
  // Settlement is two steps in a fixed order: the durable Host settlement hook
  // first, and only then the published answer and the released slot. A slow hook
  // keeps the turn observably pending (`busy === true`); a hook that refuses
  // refuses the success — the caller receives the original native result with
  // its unknown funding evidence, never a fabricated ok — and the adapter
  // retires rather than let a new request run on a turn the ledger never
  // recorded. Nothing here is caught and swallowed into a success.
  let settleTail = Promise.resolve()
  let settleInFlight = 0
  let settleDrain = null
  let settleDrainRelease = null

  /** Resolves once no settlement is in flight. `stop` waits on this, never on a
   *  settlement that is itself waiting for the stop to finish. */
  const settlementIdle = () => {
    if (settleInFlight === 0) return Promise.resolve()
    settleDrain ??= new Promise(resolve => { settleDrainRelease = resolve })
    return settleDrain
  }

  const releaseSettlement = () => {
    settleInFlight--
    if (settleInFlight === 0 && settleDrainRelease) {
      const release = settleDrainRelease
      settleDrainRelease = null
      settleDrain = null
      release()
    }
  }

  const recordSettlement = async (turn, evidence) => {
    let hookError = null
    try {
      await hooks.onSettle?.(evidence)
    } catch (error) { hookError = error }
    // The durable record is in: the slot is released and the answer published.
    if (currentTurn === turn) currentTurn = null
    turn.settlement = evidence
    if (hookError) {
      fatalError = hookError
      turn.reject(Object.assign(
        new Error(`ACP_SETTLEMENT_FAILED: ${hookError?.message ?? String(hookError)}`),
        { evidence, cause: hookError, acpSettlementFailed: true },
      ))
      events.emit('turn-settlement-failed', { turnId: turn.turnId, error: String(hookError?.message ?? hookError), evidence })
      return 'settle-hook-failed'
    }
    events.emit('turn', evidence)
    turn.resolve(evidence)
    return null
  }

  const settleTurn = (native, hostCause) => {
    const turn = currentTurn
    if (!turn || turn.settled) return
    turn.settled = true
    clearTimeout(turn.timer)
    if (cancelTimer) { clearTimeout(cancelTimer); cancelTimer = null }
    turnsSettled++
    let ok = native.ok
    let stopReason = native.stopReason
    let outcome = native.outcome
    if (hostCause) { ok = false; stopReason = hostCause.stopReason; outcome = hostCause.outcome }
    const evidence = {
      schemaVersion: 1, source: 'acp', driver: 'acp', botId, ...binding, operationId,
      turnId: turn.turnId, ok, outcome, stopReason,
      // Whether the prompt really reached the agent: a completion count is
      // never used as dispatch evidence.
      dispatched: turn.dispatched === true,
      sessionId: sessionId ?? native.sessionId ?? null,
      model: { catalogProvider, catalogModel, reportedModel, verification: modelMismatch ? 'mismatch' : reportedModel ? 'agent-reported' : 'unreported' },
      usage: native.usage ?? null,
      usageStatus: native.usage?.reported === true ? 'reported' : 'unknown',
      // ACP reports no dollar figure. Nothing is estimated here; the Host ledger
      // receives this evidence and remains the only place money is recorded.
      costUsd: null, costStatus: 'unknown',
      billing,
      elapsedMs: native.elapsedMs ?? null,
      cancelRequestedAt: native.cancelRequestedAt ?? null,
      updates: native.updates ?? null,
      text: typeof native.text === 'string' ? native.text.slice(0, 64_000) : null,
      errorText: native.errorText ?? null,
      entry: { path: pinned.path, sha256: pinned.sha256, version: pinned.version, script: pinned.script, scriptSha256: pinned.scriptSha256 },
    }
    settleInFlight++
    const run = settleTail.then(() => recordSettlement(turn, evidence))
    // The chain itself never rejects: one refused settlement must not cancel the
    // settlements queued behind it.
    settleTail = run.then(() => undefined, () => undefined)
    void run.then(retireReason => {
      releaseSettlement()
      if (retireReason) void stop(retireReason)
    }, error => {
      releaseSettlement()
      // A settlement that crashed still ends the turn: the caller is told, with
      // the evidence that was built, instead of being left waiting on it.
      turn.reject(Object.assign(new Error(`ACP_SETTLEMENT_CRASHED: ${error?.message ?? String(error)}`), { evidence }))
      events.emit('turn-settlement-failed', { turnId: turn.turnId, error: String(error?.message ?? error), evidence })
      void stop('settlement-crashed')
    })
  }

  const assertDispatchAuthorization = () => {
    signal?.throwIfAborted()
    // Every turn re-reads the Host's current authorization for this model.
    authority.assertModel(subject, catalogProvider, catalogModel)
    if (authority.describe(subject).revision !== revision) throw new Error('ACP_GRANT_CHANGED')
    if (stopped) throw new Error(fatalError ? `ACP_STOPPED: ${fatalError.message}` : 'ACP_STOPPED')
  }

  // ---- process --------------------------------------------------------------
  const launch = async () => {
    if (stopped) throw new Error(fatalError ? `ACP_STOPPED: ${fatalError.message}` : 'ACP_STOPPED')
    const remaining = deadlineEnd - Date.now()
    if (remaining <= 1000) throw new Error('ACP_DEADLINE')
    const own = ++generation
    modelSelectionConfirmed = false
    let started = null
    try {
      started = await launchAcpProcess({
        entry: pinned, args: spawnArgs, cwd, home, ttlMs: Math.min(remaining, limits.ttlMs), launcher, python, probe, environment,
      })
    } catch (error) {
      if (stopped) throw new Error(`ACP_STOPPED: ${fatalError?.message ?? 'stopped during launch'}`)
      throw error
    }
    const { supervisor, rootProcess } = started
    if (stopped) {
      // A stop raced this launch: the process must not outlive the stop, and the
      // stop evidence has to name it instead of claiming there was no process.
      const retired = { supervisor, rootProcess, dead: false, stopEvidence: null, exitInfo: null }
      const onStopped = value => {
        retired.stopEvidence = value
        retired.dead = true
        retired.exitInfo = { exitCode: value.exitCode, reason: value.reason }
      }
      supervisor.events.on('control', onStopped)
      supervisor.events.once('closed', () => { retired.dead = true })
      retiredSpawn = retired
      supervisor.end()
      await supervisor.exit.catch(() => {})
      throw new Error(`ACP_STOPPED: ${fatalError?.message ?? 'stopped during launch'}`)
    }
    launches++
    const state = { supervisor, rootProcess, dead: false, stopEvidence: null, exitInfo: null }
    const relay = createSupervisorPipe(supervisor)
    // One link owns this process, so any traffic is this session's traffic; a
    // message naming another session is attributed to nobody.
    const connection = createStdioRpc({
      pipe: relay,
      signal,
      route: classified => {
        const named = classified?.params?.sessionId
        if (typeof named === 'string') return named === sessionInstance.sessionId ? operationId : null
        return operationId
      },
      log,
    })
    const hostLink = createAcpHost({ rpc: connection, key: null, source: 'acp', onUnrouted: refuseUnrouted, log })
    const acpLink = hostLink.open(operationId, cwd)
    const sessionInstance = createAcpSession({
      host: hostLink,
      link: acpLink,
      cwd,
      clientInfo: { name: 'dsh-model-router', version: pinned.version },
      capabilities: { fileSystem: clientGuard.capabilities.fileSystem, terminal: clientGuard.capabilities.terminal, meta: clientCapabilities.meta },
      auth,
      onUpdate: entry => {
        if (entry.kind === 'agent_message_chunk' && typeof entry.text === 'string') {
          events.emit('delta', { streamKind: 'assistant_text', delta: entry.text })
        } else if (entry.kind === 'agent_thought_chunk' && typeof entry.text === 'string') {
          events.emit('delta', { streamKind: 'reasoning_text', delta: entry.text })
        }
        events.emit('update', entry)
      },
      onPermissionRequest: ask => {
        events.emit('permission-ask', ask)
        if (!onPermissionRequest) return { behavior: 'deny' }
        return Promise.resolve(onPermissionRequest(ask)).then(decision => {
          if (!decision || typeof decision !== 'object') throw new TypeError('ACP_PERMISSION_DECISION_INVALID')
          if (decision.behavior !== 'allow' && decision.behavior !== 'deny') throw new TypeError('ACP_PERMISSION_BEHAVIOR_INVALID')
          return decision
        })
      },
      onServerRequest: classified => {
        if (classified.method === ACP_METHODS.fsReadTextFile || classified.method === ACP_METHODS.fsWriteTextFile || classified.method.startsWith('terminal/')) {
          return clientGuard.handle(classified)
        }
        return null
      },
      authority, subject, operationTool,
      assertModelAuthorized,
      limits: {
        initTimeoutMs: limits.initTimeoutMs,
        sessionTimeoutMs: limits.sessionTimeoutMs,
        loadTimeoutMs: limits.loadTimeoutMs,
        promptTimeoutMs: limits.promptTimeoutMs,
        promptIdleMs: limits.promptIdleMs,
        maxTurns: limits.maxTurns,
        permissionTimeoutMs: limits.permissionTimeoutMs,
      },
      signal,
      log,
    })
    const onControl = value => {
      if (value.control === 'spawned') state.rootProcess = value
      if (value.control === 'stopped') { state.stopEvidence = value; markDead(value) }
    }
    const markDead = stoppedControl => {
      if (state.dead) return
      state.dead = true
      state.exitInfo = stoppedControl ? { exitCode: stoppedControl.exitCode, reason: stoppedControl.reason } : null
      supervisor.events.off('control', onControl)
      supervisor.events.off('message', onMessage)
      const live = currentProcess === state
      if (live) currentProcess = null
      if (sessionInstance && !sessionInstance.closed) sessionInstance.close('agent-exit')
      // Only the live generation settles a turn: a late exit, error or response
      // from a process the adapter already retired never answers for the turn
      // that replaced it.
      if (live && !stopped && currentTurn && !currentTurn.settled && currentTurn.generation === own) {
        if (resumeRefused) settleTurn({ ok: false, stopReason: 'resume-refused', outcome: 'unknown', usage: null, elapsedMs: null, cancelRequestedAt: null }, { stopReason: 'resume-refused', outcome: 'unknown' })
        else settleTurn({ ok: false, stopReason: 'exit-before-result', outcome: 'unknown', usage: null, elapsedMs: null, cancelRequestedAt: null }, { stopReason: 'exit-before-result', outcome: 'unknown' })
      }
    }
    const onMessage = frame => {
      // A retired process reports nothing: its late traffic is not evidence
      // about the session that replaced it.
      if (currentProcess !== state) return
      // Session-level model confirmation: the agent names the model it runs.
      let reported = null
      if (frame?.method === ACP_METHODS.sessionUpdate) {
        const update = frame.params?.update ?? {}
        if (update.sessionUpdate === 'current_model_update' && typeof update.currentModelId === 'string') reported = update.currentModelId
      }
      if (frame?.id !== undefined && frame.method === undefined) {
        const params = frame.result ?? {}
        if (typeof params.modelId === 'string') reported = params.modelId
        if (typeof params.currentModelId === 'string') reported = params.currentModelId
        if (typeof params.models?.currentModelId === 'string') reported = params.models.currentModelId
      }
      if (typeof reported === 'string' && reported) {
        reportedModel = reported
        // Only a Host-declared expectation can make a report a mismatch.
        if (typeof expectedModelId === 'string' && expectedModelId && reported !== expectedModelId) {
          modelMismatch = true
          if (modelSelectionConfirmed) fatal(new Error('ACP_MODEL_IDENTITY_MISMATCH'), 'model-identity-mismatch')
        }
      }
    }
    supervisor.events.on('control', onControl)
    supervisor.events.on('message', onMessage)
    supervisor.events.once('failure', error => { if (!state.dead) fatal(error, 'native-failure'); markDead(null) })
    supervisor.events.once('closed', () => markDead(null))
    rpc = connection
    host = hostLink
    session = sessionInstance
    pipe = relay
    currentProcess = state
    return state
  }

  /** Fail-closed answer for a request no session holds: never silence. */
  const refuseUnrouted = (msg, send) => {
    if (typeof msg?.id === 'number' || typeof msg?.id === 'string') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })
    }
  }

  const launchOnce = () => {
    if (!launchPromise) {
      launchPromise = launch()
      // A finished launch clears the slot: the next session starts a new one.
      launchPromise.then(() => { launchPromise = null }, () => { launchPromise = null })
    }
    return launchPromise
  }

  const ensureSession = async () => {
    if (!session || session.closed) await launchOnce()
    return session
  }

  // ---- stop -----------------------------------------------------------------
  /**
   * Real process stop plus evidence. A pending turn is settled first — before
   * the tree is touched — with the honest split between "nothing was dispatched"
   * (not-run) and "it may have been dispatched" (unknown). The native tree is
   * then actually stopped, and only afterwards is a slow settlement hook waited
   * on, so `onClose` never reports a stop whose turn the ledger has not recorded.
   * A launch that raced this stop is awaited first: no late spawn outlives it.
   */
  const stop = (reason = 'host-stop') => {
    if (stopPromise) return stopPromise
    stopRequestedAt = Date.now()
    stopped = true
    if (guardTimer) clearInterval(guardTimer)
    if (deadlineTimer) clearTimeout(deadlineTimer)
    if (cancelTimer) { clearTimeout(cancelTimer); cancelTimer = null }
    if (currentTurn && !currentTurn.settled) {
      const turn = currentTurn
      const cancelled = reason === 'interrupt' || reason === 'cancel-timeout' || signal?.aborted === true
      const outcome = turn.dispatched ? (cancelled ? 'cancelled' : 'unknown') : 'not-run'
      settleTurn({ ok: false, stopReason: reason, outcome, usage: null, elapsedMs: Date.now() - turn.startedAt, cancelRequestedAt: turn.cancelRequestedAt }, { stopReason: reason, outcome })
    }
    stopPromise = (async () => {
      if (launchPromise) { try { await launchPromise } catch {} }
      // A spawn that raced this stop is reported as the process the stop ended.
      const state = currentProcess ?? retiredSpawn
      retiredSpawn = null
      currentProcess = null
      let forcedKill = false
      if (state && !state.dead) {
        state.supervisor.end()
        const exited = await Promise.race([
          state.supervisor.exit.then(() => true),
          new Promise(resolve => { const timer = setTimeout(() => resolve(false), limits.stopGraceMs); timer.unref() }),
        ])
        if (!exited) {
          forcedKill = true
          state.supervisor.child.kill()
          await state.supervisor.exit
        }
      }
      const native = state?.stopEvidence ?? null
      session?.close(reason)
      host?.close(reason)
      // The tree is really stopped; now the durable turn records are waited for.
      await settlementIdle()
      const stopEvidence = {
        stopRequestedAt, stoppedAt: Date.now(), reason,
        pid: state?.rootProcess?.pid ?? native?.pid ?? null,
        exitCode: native?.exitCode ?? state?.exitInfo?.exitCode ?? null,
        nativeStopReason: native?.reason ?? state?.exitInfo?.reason ?? (state ? 'no-stopped-control' : 'no-process'),
        containment: native?.containment ?? probe.supervisor ?? null,
        // Only the launcher's own accounting (Windows job object) confirms a tree stop.
        treeStopped: native?.treeStopped === true,
        status: native?.treeStopped === true ? 'confirmed' : state ? 'unconfirmed' : 'no-process',
        forcedKill,
        // A cancel request was sent; this record is the confirmation, kept apart from it.
        stopRequestedIsNotConfirmation: true,
        cancelRequestedAt: session?.stats?.cancelRequestedAt ?? null,
        turns: { admitted: turnsAdmitted, dispatched: turnsDispatched, settled: turnsSettled },
      }
      await hooks.onClose?.(stopEvidence)
      stopEvidenceValue = stopEvidence
      return stopEvidence
    })()
    return stopPromise
  }
  // ---- guards ---------------------------------------------------------------
  guardTimer = setInterval(() => {
    try {
      if (stopped) return
      authority.assertModel(subject, catalogProvider, catalogModel)
      if (authority.describe(subject).revision !== revision) throw new Error('ACP_GRANT_CHANGED')
    } catch (error) {
      if (currentTurn && !currentTurn.settled) {
        settleTurn({ ok: false, stopReason: 'grant-revoked', outcome: 'unknown', usage: null, elapsedMs: null, cancelRequestedAt: null }, { stopReason: 'grant-revoked', outcome: 'unknown' })
      }
      fatal(error instanceof Error ? error : new Error(String(error)), 'grant-revoked')
    }
  }, limits.guardIntervalMs)
  guardTimer.unref()
  deadlineTimer = setTimeout(() => fatal(new Error('ACP_DEADLINE'), 'deadline'), deadlineMs)
  deadlineTimer.unref()
  const onAbort = () => fatal(new Error('ACP_CANCELLED'), 'cancelled')
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()

  // ---- public surface -------------------------------------------------------
  /**
   * Start (or resume) the agent session. Resume is only attempted when the
   * agent advertises loadSession; a refusal is reported and never replayed —
   * the Host must call startFresh() for a new conversation on purpose.
   * A pending turn fences this: the session a turn runs under is not replaced
   * underneath it.
   */
  const assertNoPendingTurn = action => {
    if (currentTurn) throw new Error(`ACP_TURN_IN_PROGRESS: ${action} would change the session or model identity while a turn is pending`)
  }

  const beginSession = async ({ fresh = false } = {}) => {
    if (stopped) throw new Error(fatalError ? `ACP_STOPPED: ${fatalError.message}` : 'ACP_STOPPED')
    if (resumeRefused && !fresh) {
      throw new Error('ACP_RESUME_REFUSED: the agent refused the resume; call startFresh() for a new conversation, never a replay')
    }
    const live = await ensureSession()
    const opened = await live.openSession({ resumeSessionId: fresh ? null : resumeSessionId })
    if (!opened.ok) {
      resumeRefused = true
      sessionId = null
      events.emit('session', { sessionId: null, resumed: false, refused: true, reason: opened.reason, stopReason: opened.stopReason })
      return opened
    }
    resumeRefused = false
    sessionId = opened.sessionId
    if (requireModelSelection) {
      assertDispatchAuthorization()
      await live.selectModel(catalogModel)
      assertDispatchAuthorization()
      reportedModel = catalogModel
      modelMismatch = false
      modelSelectionConfirmed = true
    }
    events.emit('session', { sessionId: sessionId, resumed: opened.resumed === true, refused: false })
    // Diagnostic only: this reports that a session exists. It is never a
    // settlement and never carries money — settlement is `onSettle` alone.
    await hooks.onObserve?.({ kind: 'session-confirmed', sessionId, model: catalogModel, resumed: opened.resumed === true, agent: live.agentCapabilities?.agentName ?? null })
    return opened
  }

  const start = async ({ fresh = false } = {}) => {
    assertNoPendingTurn('start')
    return beginSession({ fresh })
  }

  /** A new conversation, explicitly: never a silent substitute for a refused resume. */
  const startFresh = async () => {
    assertNoPendingTurn('startFresh')
    return beginSession({ fresh: true })
  }

  /**
   * Submit one conversation turn. The payload may carry `text` and nothing else.
   *
   * The turn slot is reserved synchronously, before the first await, so a second
   * call in the same tick is refused with `ACP_TURN_IN_PROGRESS` and performs no
   * admission, no launch and no prompt. Everything that follows the reservation
   * — admission, session start, dispatch, the peer's result and the Host
   * settlement — belongs to that one slot, and the Host grant is re-judged after
   * every asynchronous boundary.
   */
  const submitTurn = async input => {
    if (stopped) throw new Error(fatalError ? `ACP_STOPPED: ${fatalError.message}` : 'ACP_STOPPED')
    // The payload shape is decided before anything is reserved: a malformed turn
    // never occupies the slot.
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'text')) {
      throw new TypeError('INVALID_ACP_TURN_INPUT: only { text } is accepted')
    }
    const promptText = input.text
    if (typeof promptText !== 'string' || !promptText.trim() || promptText.includes('\u0000') || Buffer.byteLength(promptText) > MAX_TURN_BYTES) {
      // Same code the session core uses, so a caller sees one stable error
      // whichever layer catches the malformed text first.
      throw new TypeError('ACP_TURN_TEXT_INVALID')
    }
    if (currentTurn) throw new Error('ACP_TURN_IN_PROGRESS')
    const turnId = `t-${randomBytes(8).toString('hex')}`
    let resolveTurn, rejectTurn
    const promise = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject })
    const timer = setTimeout(() => {
      settleTurn({ ok: false, stopReason: 'turn-timeout', outcome: 'unknown', usage: null, elapsedMs: null, cancelRequestedAt: null }, { stopReason: 'turn-timeout', outcome: 'unknown' })
      fatal(new Error('ACP_TURN_TIMEOUT'), 'turn-timeout')
    }, Math.max(1000, deadlineEnd - Date.now()))
    timer.unref()
    const turn = {
      turnId, settled: false, dispatched: false, generation: 0,
      resolve: resolveTurn, reject: rejectTurn, timer, startedAt: Date.now(), cancelRequestedAt: null,
    }
    currentTurn = turn
    promise.catch(() => {})
    events.emit('turn-started', { turnId, sessionId })
    // A turn that was settled underneath us (cancel, stop, revocation, peer exit)
    // is never resumed: no late continuation dispatches a new prompt for it.
    const assertTurnLive = () => {
      if (turn.settled) {
        throw new Error(`ACP_TURN_NOT_DISPATCHED: the turn was settled as ${turn.settlement?.stopReason ?? 'settled'} before dispatch`)
      }
      assertDispatchAuthorization()
    }
    try {
      // Host admission first: a refusal here proves nothing was dispatched.
      await hooks.onBeforeRequest?.({ turnId, botId, ...binding, operationId, source: 'acp', driver: 'acp', requestedModel: catalogModel, entry: { path: pinned.path, sha256: pinned.sha256, version: pinned.version } })
    } catch (error) {
      // The Host refused this request. The slot is released so the caller may
      // call again, and the Host's own error is reported. Nothing was dispatched,
      // so there is no settlement to record for it.
      clearTimeout(turn.timer)
      if (currentTurn === turn) currentTurn = null
      events.emit('turn-refused', { turnId, reason: error?.message ?? String(error) })
      throw error
    }
    turnsAdmitted++
    try {
      // The grant is re-judged across the admission boundary.
      assertTurnLive()
      // The session this turn runs under. Starting one may launch a new process,
      // so the live session is read back afterwards.
      if (!session || session.closed || session.sessionId === null) await beginSession({ fresh: false })
      const live = session
      if (!live || typeof live.prompt !== 'function') {
        throw Object.assign(new Error('ACP_SESSION_UNAVAILABLE'), { acpNotDispatched: true })
      }
      assertTurnLive()
      const result = await live.prompt(input, {
        // Marked at the moment the request is issued, never at its completion.
        onDispatched: () => { turn.dispatched = true; turn.generation = generation; turnsDispatched++ },
      })
      if (turn.settled) return promise
      // A transport failure on a prompt that was issued is unknown: the frame may
      // have reached the agent, so it is never reported as not-run and never
      // replayed automatically.
      if (result?.ok === false && result.outcome === 'failed' && result.stopReason === 'rpc-error') {
        settleTurn({ ...result, stopReason: 'dispatch-unknown', outcome: 'unknown' }, { stopReason: 'dispatch-unknown', outcome: 'unknown' })
      } else {
        settleTurn(result)
      }
    } catch (error) {
      if (currentTurn !== turn || turn.settled) throw error
      // One terminal settlement. The dispatch marker decides: a prompt that was
      // never issued is not-run, a prompt whose write provably never left is
      // not-run too, and anything else is unknown — never replayed.
      const notRun = turn.dispatched !== true || provablyUnsent(error)
      const stopReason = notRun ? 'not-dispatched' : 'dispatch-unknown'
      const outcome = notRun ? 'not-run' : 'unknown'
      settleTurn({
        ok: false, stopReason, outcome, usage: null,
        elapsedMs: Date.now() - turn.startedAt, cancelRequestedAt: turn.cancelRequestedAt,
        errorText: error?.message ?? String(error),
      }, { stopReason, outcome })
      throw error
    }
    return promise
  }

  /**
   * Ask the agent to stop the running turn. This records a cancel request; the
   * turn settles on the agent's own answer, and an unanswered cancel ends in a
   * real process stop whose evidence is reported separately.
   *
   * It works at every stage of a turn: while admission or a launch is still
   * pending there is no prompt to cancel, so the reservation itself is settled
   * as not-run — no prompt is ever sent for a cancelled turn.
   */
  const cancel = () => {
    const turn = currentTurn
    if (!turn || turn.settled) return false
    if (!turn.dispatched) {
      turn.cancelRequestedAt = Date.now()
      settleTurn({
        ok: false, stopReason: 'cancelled-before-dispatch', outcome: 'not-run', usage: null,
        elapsedMs: Date.now() - turn.startedAt, cancelRequestedAt: turn.cancelRequestedAt,
      }, { stopReason: 'cancelled-before-dispatch', outcome: 'not-run' })
      return true
    }
    if (!session || !session.busy) return false
    const requested = session.cancel()
    if (!requested) return false
    turn.cancelRequestedAt = session.stats.cancelRequestedAt
    events.emit('cancel-requested', { sessionId, at: session.stats.cancelRequestedAt })
    if (cancelTimer) clearTimeout(cancelTimer)
    cancelTimer = setTimeout(() => { void stop('cancel-timeout') }, limits.cancelTimeoutMs)
    cancelTimer.unref()
    return true
  }

  /**
   * Switch the session model. The model a turn runs under is the Host-committed
   * `catalogModel`: a peer advertising another model is not authority, and
   * selecting one anyway would make the turn evidence and the funded grant
   * disagree. A different binding needs a rebuilt, re-authorized adapter — never
   * a silent live switch, and never owner or permission data smuggled in through
   * request JSON.
   */
  const selectModel = async modelId => {
    assertNoPendingTurn('selectModel')
    if (typeof modelId !== 'string' || modelId !== catalogModel) {
      throw new Error(`ACP_MODEL_BINDING_CHANGED: this adapter is committed to ${catalogModel}; a different model binding requires a rebuilt, re-authorized adapter`)
    }
    const live = await ensureSession()
    // Re-judged across the launch boundary.
    assertNoPendingTurn('selectModel')
    assertModelAuthorized(modelId)
    const selected = await live.selectModel(modelId)
    reportedModel = modelId
    events.emit('model-selected', { modelId, sessionId: live.sessionId })
    return selected
  }

  const setMode = async modeId => {
    assertNoPendingTurn('setMode')
    const live = await ensureSession()
    // Re-judged across the launch boundary.
    assertNoPendingTurn('setMode')
    return live.setMode(modeId)
  }

  const snapshot = () => Object.freeze({
    schemaVersion: 1, source: 'acp', driver: 'acp', botId, ...binding, operationId,
    entry: { path: pinned.path, sha256: pinned.sha256, version: pinned.version, versionOutput: pinned.versionOutput, script: pinned.script, scriptSha256: pinned.scriptSha256 },
    spawnArgs: [...spawnArgs],
    model: { catalogProvider, catalogModel, reportedModel, verification: modelMismatch ? 'mismatch' : reportedModel ? 'agent-reported' : 'unreported', mismatch: modelMismatch },
    identity: { botId, operationId, taskId: binding.taskId, attemptId: binding.attemptId },
    sessionId,
    resumeRefused,
    turnsAdmitted, turnsDispatched, turnsSettled, launches,
    turn: currentTurn ? {
      turnId: currentTurn.turnId, dispatched: currentTurn.dispatched, settled: currentTurn.settled,
      cancelRequestedAt: currentTurn.cancelRequestedAt, elapsedMs: Date.now() - currentTurn.startedAt,
    } : null,
    settlement: { inFlight: settleInFlight },
    generation,
    session: session ? session.stats : null,
    process: currentProcess ? { pid: currentProcess.rootProcess?.pid ?? null, dead: currentProcess.dead } : null,
    permissions: session ? session.permissions.stats : null,
    transport: { rpc: rpc?.stats ?? null, pipe: pipe?.stats ?? null },
    clientCapabilities: clientGuard.capabilities,
    billing: { kind: billing, amountUsd: null, amountStatus: 'unknown', note: 'ACP reports no dollar figure; cost evidence flows only to the Host ledger and is never estimated here' },
    stopRequestedAt,
    stopEvidence: stopEvidenceValue,
    fatalError: fatalError ? String(fatalError.message) : null,
    closed: stopped,
    limitations: [
      'product availability requires an explicitly registered supported driver and owner-pinned entry',
      'offline protocol coverage does not certify real vendor account login or paid inference',
      'session-scoped "allow always" approvals are deliberately not implemented: every ask is decided by the Host',
      'ACP reports token/context usage and no dollar amount, so cost stays null/unknown',
      'a live model switch away from the committed catalogModel is refused: a different binding needs a rebuilt, re-authorized adapter',
      'this adapter proves no OS sandbox for a generic ACP CLI: the boundary here is the session/turn fence, not process isolation',
    ],
  })

  return Object.freeze({
    driver: 'acp',
    events,
    start,
    startFresh,
    submitTurn,
    cancel,
    selectModel,
    setMode,
    stop,
    close: stop,
    snapshot,
    get sessionId() { return sessionId },
    get busy() { return currentTurn !== null },
    get closed() { return stopped },
    get agentCapabilities() { return session?.agentCapabilities ?? null },
    get permissions() { return session?.permissions ?? null },
  })
}

export { acpProcessHome, createChildPipe, createStdioRpc, createAcpHost, createAcpSession, createSupervisorPipe, pinAcpEntry, launchAcpProcess, DEFAULT_LAUNCHER }
