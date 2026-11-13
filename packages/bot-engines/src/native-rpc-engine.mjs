import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { DEFAULT_LAUNCHER, launchAcpProcess, pinAcpEntry } from '../../bot-acp/src/native-launch.mjs'
import { createPrivateProfileHome } from '../../cli-runtime/src/native-process.mjs'

const fail = code => Object.assign(new Error(code), { code })
const token = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)
const validText = value => typeof value === 'string' && value.trim() && !value.includes('\0') && Buffer.byteLength(value) <= 64_000
const usageCount = value => Number.isSafeInteger(value) && value >= 0

/** Retained text-only native RPC sessions. Only the native supervisor can prove a tree stop.
 * Protocol modules own their wire vocabulary; this core owns turn/admission/exit fences.
 */
export async function createNativeRpcEngine(options, protocol) {
  const { authority, subject, binding, operationId, entry, runtimeRoot, workspace,
    model = {}, provisionCredentials, hooks = {}, deadlineMs = 120_000,
    launcher = DEFAULT_LAUNCHER, python, tools = [], handlers = [] } = options ?? {}
  if (!authority || typeof authority.describe !== 'function' || typeof authority.assertModel !== 'function'
    || !subject || !binding || !token(operationId) || !isAbsolute(runtimeRoot ?? '') || !isAbsolute(workspace ?? '')
    || !token(protocol?.id) || typeof protocol.start !== 'function' || typeof protocol.dispatch !== 'function'
    || typeof protocol.response !== 'function' || typeof protocol.onMessage !== 'function') throw fail('NATIVE_CHAT_CONFIG_INVALID')
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 7_200_000) throw fail('NATIVE_CHAT_DEADLINE_INVALID')
  if (!Array.isArray(tools) || !Array.isArray(handlers) || tools.length || handlers.length) throw fail('NATIVE_CHAT_HOST_TOOLS_UNSUPPORTED')
  if (!['subscription', 'unknown', undefined].includes(options.billing)) throw fail('NATIVE_CHAT_API_BILLING_UNBOUNDED')
  for (const key of ['onBeforeRequest', 'onObserve', 'onSettle', 'onClose']) if (hooks[key] !== undefined && typeof hooks[key] !== 'function') throw fail('NATIVE_CHAT_HOOK_INVALID')
  const catalogProvider = model.catalogProvider, catalogModel = model.catalogModel
  const requestedModel = model.cliModel ?? catalogModel
  if (typeof requestedModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,239}$/.test(requestedModel)) throw fail('NATIVE_CHAT_MODEL_INVALID')
  authority.assertModel(subject, catalogProvider, catalogModel)
  const descriptor = authority.describe(subject), revision = descriptor.revision, botId = descriptor.botId
  const cwd = await realpath(workspace)
  if (!(await stat(cwd)).isDirectory()) throw fail('NATIVE_CHAT_WORKSPACE_INVALID')
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
  const home = await createPrivateProfileHome(runtimeRoot, `native-${operationId}-${randomUUID()}`)
  for (const folder of ['tmp', 'cache', 'config', 'data', 'appdata', 'local']) await mkdir(join(home, folder), { mode: 0o700 })
  const events = new EventEmitter(), pending = new Map()
  let currentTurn = null, session = null, closed = false, poisoned = false, fatalCode = null
  let supervisor = null, processInfo = null, stoppedEvidence = null, launchPromise = null, stopPromise = null
  let pin = null, requestSequence = 0, turns = 0, settled = 0, dispatched = 0, messages = 0, bytes = 0, stray = 0, observeFailures = 0
  const startedAt = Date.now()
  const assertAuthorized = () => {
    if (closed) throw fail('NATIVE_CHAT_CLOSED')
    authority.assertModel(subject, catalogProvider, catalogModel)
    if (authority.describe(subject).revision !== revision) throw fail('NATIVE_CHAT_GRANT_CHANGED')
  }
  const observe = value => {
    try { const result = hooks.onObserve?.(value); result?.catch?.(() => { observeFailures++ }) }
    catch { observeFailures++ }
  }
  const rejectPending = code => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(fail(code)) } pending.clear() }
  const send = async frame => {
    if (closed || !supervisor || supervisor.closed) throw fail('NATIVE_CHAT_CLOSED')
    if (Buffer.byteLength(JSON.stringify(frame)) > 262_144) throw fail('NATIVE_CHAT_FRAME_LIMIT')
    if (currentTurn?.dispatched && !currentTurn.dispatchCounted) { currentTurn.dispatchCounted = true; dispatched++ }
    await supervisor.send(frame)
  }
  const request = (method, params = {}) => {
    if (closed || !supervisor || pending.size >= 32) return Promise.reject(fail(closed ? 'NATIVE_CHAT_CLOSED' : 'NATIVE_CHAT_PENDING_LIMIT'))
    const id = `chat-${++requestSequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(fail('NATIVE_CHAT_RPC_TIMEOUT')) }, Math.min(30_000, deadlineMs))
      timer.unref?.()
      pending.set(id, { method, resolve, reject, timer })
      let frame
      try { frame = protocol.encodeRequest?.({ id, method, params }) ?? { id, method, params } }
      catch { clearTimeout(timer); pending.delete(id); reject(fail('NATIVE_CHAT_REQUEST_INVALID')); return }
      void send(frame).catch(() => { const item = pending.get(id); if (item) { clearTimeout(item.timer); pending.delete(id); item.reject(fail('NATIVE_CHAT_WRITE_FAILED')) } })
    })
  }
  const notify = (method, params = {}) => send(protocol.encodeNotify?.({ method, params }) ?? { method, params })
  const complete = (result, turn = currentTurn) => {
    if (!turn) return Promise.resolve(null)
    if (turn.settlement) return turn.settlement
    turn.settling = true; clearTimeout(turn.timer)
    const reportedUsage = result.usage && usageCount(result.usage.input) && usageCount(result.usage.output)
      ? { input: result.usage.input, output: result.usage.output,
        ...(usageCount(result.usage.cachedInput) ? { cachedInput: result.usage.cachedInput } : {}) } : null
    const succeeded = result.ok === true && result.outcome !== 'unknown' && turn.dispatched && session?.model === requestedModel
    const evidence = Object.freeze({ schemaVersion: 1, source: 'engine', driver: protocol.id, botId,
      ...binding, operationId, turnId: turn.turnId, nativeTurnId: turn.nativeTurnId ?? null,
      sessionId: session?.id ?? null, ok: succeeded, outcome: succeeded ? 'succeeded' : result.outcome ?? (turn.dispatched ? 'unknown' : 'not-run'),
      stopReason: result.stopReason ?? (succeeded ? 'completed' : 'failed'), dispatched: turn.dispatched,
      text: turn.text, usage: reportedUsage, usageStatus: reportedUsage ? 'reported' : 'unknown', costUsd: null, costStatus: 'unknown',
      cancelled: result.cancelled === true, billing: options.billing ?? 'subscription', elapsedMs: Date.now() - turn.startedAt,
      model: { catalogProvider, catalogModel, reportedModel: session?.model ?? null, verification: session?.model === requestedModel ? 'agent-reported' : 'unreported' },
      ...(result.errorCode ? { errorText: result.errorCode } : {}) })
    turn.settlement = (async () => {
      try {
        if (turn.admitted) await hooks.onSettle?.(evidence)
        settled++; turn.result = evidence
        if (currentTurn === turn) currentTurn = null
        events.emit('turn', evidence); turn.resolve(evidence)
        return evidence
      } catch {
        poisoned = true; fatalCode = 'NATIVE_CHAT_SETTLEMENT_FAILED'
        const error = Object.assign(fail(fatalCode), { turnResult: evidence })
        if (currentTurn === turn) currentTurn = null
        turn.reject(error); void stop('settlement-failed'); throw error
      }
    })()
    // A caller may be observing only submitTurn; do not create a second unhandled rejection.
    void turn.settlement.catch(() => {})
    return turn.settlement
  }
  const delta = (kind, value) => {
    const turn = currentTurn
    if (!turn || turn.settling || !turn.dispatched || !['assistant_text', 'reasoning_text'].includes(kind) || typeof value !== 'string') return
    if (Buffer.byteLength(turn.text) + Buffer.byteLength(value) > 64_000) { void stop('output-limit'); return }
    if (kind === 'assistant_text') turn.text += value
    events.emit('delta', { streamKind: kind, delta: value })
  }
  const ctx = Object.freeze({ options: Object.freeze({ ...options, requestedModel }), home, workspace: cwd,
    request, notify, send, delta, complete, fail: code => { fatalCode = /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'NATIVE_CHAT_PROTOCOL_FAILED'; void stop('protocol-failed') },
    get turn() { return currentTurn }, get session() { return session } })
  function onMessage(frame) {
    if (closed) return
    try {
      messages++; bytes += Buffer.byteLength(JSON.stringify(frame))
      if (bytes > 32_000_000 || Buffer.byteLength(JSON.stringify(frame)) > 262_144) throw fail('NATIVE_CHAT_OUTPUT_LIMIT')
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw fail('NATIVE_CHAT_FRAME_INVALID')
      const response = protocol.response(frame)
      if (response) {
        const item = pending.get(response.id)
        if (!item) { stray++; return }
        if (response.method !== undefined && response.method !== item.method) throw fail('NATIVE_CHAT_RESPONSE_MISMATCH')
        pending.delete(response.id); clearTimeout(item.timer)
        if (response.error) item.reject(fail('NATIVE_CHAT_RPC_REFUSED')); else item.resolve(response.result)
        return
      }
      const result = protocol.onMessage(ctx, frame)
      result?.catch?.(() => ctx.fail('NATIVE_CHAT_PROTOCOL_FAILED'))
    } catch { ctx.fail('NATIVE_CHAT_PROTOCOL_FAILED') }
  }
  const ensureStarted = () => {
    if (session && !closed) return Promise.resolve(session)
    if (launchPromise) return launchPromise
    launchPromise = (async () => {
      assertAuthorized()
      const probe = await launcher.probe({ home, python })
      if (!probe?.available) throw fail('NATIVE_CHAT_SUPERVISOR_UNAVAILABLE')
      await launcher.protect(probe.helper, home); assertAuthorized()
      pin = await pinAcpEntry(entry, home, { versionArgs: options.versionArgs ?? ['--version'] }); assertAuthorized()
      const provisioned = provisionCredentials ? await provisionCredentials(home) : null
      const environment = provisioned?.env ?? {}
      const allowedEnv = protocol.allowedCredentialEnvNames ?? []
      for (const [key, value] of Object.entries(environment)) {
        if (!allowedEnv.includes(key) || typeof value !== 'string' || value.includes('\0') || value.length > 128_000) throw fail('NATIVE_CHAT_CREDENTIAL_ENV_INVALID')
        if (/(?:_DIR|_HOME)$/.test(key) && (!isAbsolute(value) || relative(home, value).split(/[\\/]/).includes('..'))) throw fail('NATIVE_CHAT_CREDENTIAL_ROOT_INVALID')
      }
      assertAuthorized()
      await protocol.prepareHome?.({ home, workspace: cwd, options: ctx.options }); assertAuthorized()
      const args = protocol.args(ctx.options)
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw fail('NATIVE_CHAT_ARGV_INVALID')
      const launched = await launchAcpProcess({ entry: pin, args, cwd, home, ttlMs: deadlineMs, launcher, python, probe, environment })
      supervisor = launched.supervisor; processInfo = launched.rootProcess
      supervisor.events.on('message', onMessage)
      supervisor.events.on('failure', () => ctx.fail('NATIVE_CHAT_PROCESS_FAILED'))
      supervisor.events.on('control', value => { if (value.control === 'stopped') stoppedEvidence = value })
      supervisor.events.once('closed', () => {
        rejectPending('NATIVE_CHAT_PROCESS_EXITED')
        if (!closed) { fatalCode = 'NATIVE_CHAT_PROCESS_EXITED'; void stop('exit-before-result') }
      })
      if (closed) { supervisor.end(); throw fail('NATIVE_CHAT_CLOSED') }
      assertAuthorized()
      const opened = await protocol.start(ctx)
      assertAuthorized()
      if (!opened || typeof opened.sessionId !== 'string' || !opened.sessionId || opened.sessionId.length > 4096 || opened.model !== requestedModel) throw fail('NATIVE_CHAT_MODEL_IDENTITY_MISMATCH')
      session = Object.freeze({ id: opened.sessionId, model: opened.model })
      events.emit('session', { sessionId: session.id, model: session.model, resumed: false })
      observe({ kind: 'session-confirmed', sessionId: session.id, model: session.model, driver: protocol.id })
      return session
    })()
    void launchPromise.catch(() => {})
    return launchPromise
  }
  function stop(reason = 'engine-stopped') {
    if (stopPromise) return stopPromise
    closed = true; clearInterval(guard); clearTimeout(lifetime); rejectPending('NATIVE_CHAT_STOPPING')
    // End the real process immediately, before any arbitrary settlement hook can stall.
    supervisor?.end()
    stopPromise = (async () => {
      await launchPromise?.catch(() => {})
      if (supervisor) {
        supervisor.end()
        const exit = await Promise.race([supervisor.exit, new Promise(resolve => { const timeout = setTimeout(() => resolve(null), 15_000); timeout.unref?.() })])
        if (!exit) {
          // Stopping a supervisor is not proof that its whole process tree ended.
          supervisor.child?.kill?.(); await supervisor.exit.catch(() => {})
        }
      }
      const proof = stoppedEvidence?.treeStopped === true ? { ...stoppedEvidence, status: 'confirmed' }
        : supervisor ? { status: 'unknown', treeStopped: false, stopRequestedIsNotConfirmation: true }
          : { notStarted: true, possiblyApplied: false }
      stoppedEvidence = proof; events.emit('tree-stopped', proof)
      if (currentTurn) await complete({ ok: false, stopReason: reason,
        outcome: currentTurn.dispatched ? 'unknown' : 'not-run', cancelled: /cancel|abort/.test(reason), errorCode: fatalCode ?? 'NATIVE_CHAT_STOPPED' }).catch(() => {})
      await hooks.onClose?.({ operationId, driver: protocol.id, stopEvidence: proof })
      return proof
    })()
    void stopPromise.catch(() => {})
    return stopPromise
  }
  const guard = setInterval(() => { try { assertAuthorized() } catch { fatalCode = 'NATIVE_CHAT_GRANT_REVOKED'; void stop('grant-revoked') } }, 100)
  guard.unref?.()
  const lifetime = setTimeout(() => { fatalCode = 'NATIVE_CHAT_DEADLINE'; void stop('turn-timeout') }, deadlineMs)
  lifetime.unref?.()
  return Object.freeze({ driver: protocol.id, events,
    submitTurn(input) {
      if (!input || Object.keys(input).length !== 1 || !validText(input.text)) return Promise.reject(fail('NATIVE_CHAT_TEXT_ONLY'))
      if (closed || poisoned) return Promise.reject(fail('NATIVE_CHAT_CLOSED'))
      if (currentTurn) return Promise.reject(fail('NATIVE_CHAT_TURN_IN_PROGRESS'))
      const turn = { turnId: `turn-${++turns}-${randomUUID()}`, nativeTurnId: null, dispatched: false,
        admitted: false, text: '', usage: null, startedAt: Date.now(), settling: false, settlement: null }
      currentTurn = turn
      const result = new Promise((resolve, reject) => { turn.resolve = resolve; turn.reject = reject })
      void (async () => {
        try {
          assertAuthorized()
          await hooks.onBeforeRequest?.({ turnId: turn.turnId, botId, ...binding, operationId, source: 'engine', driver: protocol.id, requestedModel: catalogModel })
          turn.admitted = true
          assertAuthorized(); if (turn.settling || currentTurn !== turn) return
          await ensureStarted(); assertAuthorized(); if (turn.settling || currentTurn !== turn) return
          turn.timer = setTimeout(() => { fatalCode = 'NATIVE_CHAT_TURN_TIMEOUT'; void stop('turn-timeout') }, Math.min(deadlineMs, 1_800_000)); turn.timer.unref?.()
          events.emit('turn-started', { turnId: turn.turnId, sessionId: session.id })
          await protocol.dispatch(ctx, turn, input.text)
        } catch (error) {
          if (turn.settling) return
          if (!turn.admitted) { if (currentTurn === turn) currentTurn = null; turn.reject(fail(error?.code ?? 'NATIVE_CHAT_ADMISSION_REFUSED')); return }
          fatalCode = /^[A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'NATIVE_CHAT_PROTOCOL_FAILED'
          await stop(turn.dispatched ? 'dispatch-failed' : 'launch-failed')
        }
      })().catch(() => { if (!turn.settling) { if (currentTurn === turn) currentTurn = null; turn.reject(fail('NATIVE_CHAT_FAILED')) } })
      return result
    },
    cancel: () => stop('cancelled'), stop, close: stop,
    snapshot: () => ({ driver: protocol.id, closed, busy: currentTurn !== null, poisoned, fatalCode, sessionId: session?.id ?? null,
      process: supervisor && !supervisor.closed ? processInfo : null, stopEvidence: stoppedEvidence,
      turnsSubmitted: turns, turnsDispatched: dispatched, turnsSettled: settled,
      turn: currentTurn ? { turnId: currentTurn.turnId, dispatched: currentTurn.dispatched, settlementPending: currentTurn.settling } : null,
      wire: { messages, bytes, pending: pending.size, stray }, observeHookFailures: observeFailures, elapsedMs: Date.now() - startedAt,
      limitation: 'Text-only native chat; no Host tools and no new OS sandbox proof.' }),
    get closed() { return closed }, get busy() { return currentTurn !== null },
  })
}
