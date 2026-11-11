// Fail-closed ACP permission policy.
//
// Ported and re-grounded from OpenMausBot server/drivers/acp/core.ts (the
// session/request_permission branch) at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
//
// Upstream approves only an `allow`-kind option, never by option order, and
// answers `cancelled` when it cannot name one. This port keeps that and makes
// the authority side explicit: a permission request is decided by committed
// Tool/Task/operation authority held by the Host, never by anything the request
// JSON claims about botId, owner or configuration. Every unknown, duplicate,
// expired, revoked, timed-out or closing case denies.

import { RPC_INVALID_PARAMS, RPC_METHOD_NOT_FOUND } from './rpc-codec.mjs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const PERMISSION_TIMEOUT_MS = 15 * 60_000
export const MAX_OPEN_ASKS = 64
export const CLIENT_FILE_MAX_BYTES = 8 * 1024 * 1024

/** ACP permission option kinds. `cancelled` is the fail-closed reply. */
const ALLOW_KINDS = new Set(['allow_once', 'allow_always'])
const REJECT_KINDS = new Set(['reject_once', 'reject_always'])

const record = value => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null)

export function permissionOptions(params) {
  const options = Array.isArray(params?.options) ? params.options : []
  return options.flatMap(option => {
    const entry = record(option)
    if (!entry || typeof entry.optionId !== 'string' || !entry.optionId) return []
    return [{ optionId: entry.optionId, kind: typeof entry.kind === 'string' ? entry.kind : '', name: typeof entry.name === 'string' ? entry.name : '' }]
  })
}

export const cancelledOutcome = () => ({ outcome: { outcome: 'cancelled' } })

/**
 * The tool identity an ask maps onto, for the committed-grant check. Only the
 * Host's own mapping is consulted; a toolCall title or rawInput is evidence,
 * never authority.
 */
export function toolCallIdentity(params) {
  const toolCall = record(params?.toolCall)
  return {
    toolCallId: typeof toolCall?.toolCallId === 'string' ? toolCall.toolCallId : null,
    title: typeof toolCall?.title === 'string' ? toolCall.title : null,
    kind: typeof toolCall?.kind === 'string' ? toolCall.kind : null,
    rawInput: toolCall?.rawInput ?? null,
    sessionId: typeof params?.sessionId === 'string' ? params.sessionId : null,
  }
}

/**
 * @param {object} options
 * @param {(ask: object) => ({behavior: 'allow'|'deny', message?: string}|Promise<{behavior: 'allow'|'deny', message?: string}>)|null} [options.onPermissionRequest] trusted Host handler; absent denies everything
 * @param {{describe: Function, assertTool: Function}} [options.authority] committed-grant authority
 * @param {object} [options.subject] registered authority subject
 * @param {(identity: object) => string|null} [options.operationTool] maps an ask onto a committed tool name
 * @param {number} [options.timeoutMs] Host answer deadline
 * @param {AbortSignal} [options.signal] Host cancellation
 * @param {Function} [options.log]
 */
export function createPermissionPolicy({
  onPermissionRequest,
  authority = null,
  subject = null,
  operationTool = null,
  timeoutMs = PERMISSION_TIMEOUT_MS,
  signal,
  log,
} = {}) {
  if (onPermissionRequest !== undefined && onPermissionRequest !== null && typeof onPermissionRequest !== 'function') {
    throw new TypeError('ACP_PERMISSION_HANDLER_REQUIRED_FUNCTION')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) throw new TypeError('ACP_PERMISSION_TIMEOUT_INVALID')
  const open = new Map()
  const askedIds = new Set()
  const stats = { asks: 0, allowed: 0, denied: 0, hostAnswered: 0, noHandler: 0, unknownOption: 0, duplicate: 0, timeouts: 0, closed: 0, toolDenied: 0, grantDenied: 0 }
  let closed = false

  const deny = (reason, message) => {
    stats.denied++
    log?.({ event: 'acp.permission-denied', reason, message: message ?? null })
    return { behavior: 'deny', optionId: null, source: 'policy', reason, message: message ?? null }
  }

  /** Re-assert the committed grant at decision time: a revoked or changed grant denies. */
  const assertAuthority = identity => {
    if (!authority || !subject) return null
    let described
    try {
      described = authority.describe(subject)
    } catch (error) {
      stats.grantDenied++
      return error instanceof Error ? error.message : String(error)
    }
    if (typeof operationTool !== 'function') return null
    const tool = operationTool(identity)
    if (typeof tool !== 'string' || !tool) {
      stats.toolDenied++
      return 'ask maps to no committed tool'
    }
    try {
      authority.assertTool(subject, tool)
    } catch (error) {
      stats.toolDenied++
      return error instanceof Error ? error.message : String(error)
    }
    return null
  }

  const settle = (id, decision) => {
    const entry = open.get(id)
    if (!entry) return null
    open.delete(id)
    if (entry.timer) clearTimeout(entry.timer)
    if (entry.onAbort) entry.signal?.removeEventListener?.('abort', entry.onAbort)
    const behavior = decision?.behavior === 'allow' ? 'allow' : 'deny'
    if (behavior === 'allow') stats.allowed++; else stats.denied++
    log?.({ event: 'acp.permission-resolved', id, behavior, source: decision?.source ?? 'host', reason: decision?.reason ?? null })
    const final = { ...decision, behavior, optionId: behavior === 'allow' ? entry.allowOptionId : null }
    // Every path that settles an ask also settles its promise, so a caller can
    // never be left waiting on a decision that was already made.
    entry.resolve(final)
    return final
  }

  /**
   * Decide one session/request_permission message. The reply is always a
   * selected option the agent itself offered, or `cancelled`.
   */
  const decide = msg => {
    const id = msg?.id
    if (closed) return Promise.resolve(deny('closed'))
    if ((typeof id !== 'string' && typeof id !== 'number') || open.has(id) || askedIds.has(id)) {
      stats.duplicate++
      return Promise.resolve(deny('duplicate-ask'))
    }
    if (open.size >= MAX_OPEN_ASKS) return Promise.resolve(deny('ask-limit'))
    const identity = toolCallIdentity(msg?.params)
    const options = permissionOptions(msg?.params)
    const allowOption = options.find(option => ALLOW_KINDS.has(option.kind))
    const rejectOption = options.find(option => REJECT_KINDS.has(option.kind))
    if (!allowOption || !rejectOption) {
      // An option set without a recognizable allow/reject pair is not answerable.
      stats.unknownOption++
      return Promise.resolve(deny('unknown-option'))
    }
    if (!onPermissionRequest) {
      stats.noHandler++
      return Promise.resolve(deny('no-handler'))
    }
    const grantFailure = assertAuthority(identity)
    if (grantFailure) return Promise.resolve(deny('authority', grantFailure))
    stats.asks++
    askedIds.add(id)
    if (askedIds.size > MAX_OPEN_ASKS * 64) askedIds.clear()
    return new Promise(resolve => {
      const onAbort = () => settle(id, deny('aborted'))
      const entry = {
        allowOptionId: allowOption.optionId,
        signal,
        onAbort,
        resolve,
        timer: setTimeout(() => {
          stats.timeouts++
          settle(id, deny('timeout'))
        }, timeoutMs),
      }
      entry.timer.unref?.()
      open.set(id, entry)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve()
        .then(() => onPermissionRequest({
          id,
          toolCallId: identity.toolCallId,
          title: identity.title,
          kind: identity.kind,
          sessionId: identity.sessionId,
          options: options.map(option => ({ optionId: option.optionId, kind: option.kind, name: option.name })),
          tool: typeof operationTool === 'function' ? operationTool(identity) : null,
        }))
        .then(decision => {
          if (!decision || typeof decision !== 'object') throw new TypeError('ACP_PERMISSION_DECISION_INVALID')
          if (decision.behavior !== 'allow' && decision.behavior !== 'deny') throw new TypeError('ACP_PERMISSION_BEHAVIOR_INVALID')
          stats.hostAnswered++
          settle(id, { behavior: decision.behavior, source: 'host', reason: typeof decision.message === 'string' ? decision.message : null })
        })
        .catch(error => {
          // A handler that throws or answers late is a denial, never an approval.
          settle(id, deny('handler-failed', error instanceof Error ? error.message : String(error)))
        })
    })
  }

  const close = (reason = 'closed') => {
    if (closed) return
    closed = true
    stats.closed += open.size
    for (const id of [...open.keys()]) settle(id, deny(reason))
  }
  signal?.addEventListener('abort', () => close('aborted'), { once: true })
  if (signal?.aborted) close('aborted')

  return Object.freeze({
    decide,
    close,
    get pendingCount() { return open.size },
    get closed() { return closed },
    get stats() { return Object.freeze({ ...stats, pending: open.size }) },
  })
}

/**
 * Client-side fs/terminal guard. Unless the Host turns a capability on AND
 * supplies the root and the IO callbacks, every such method is refused with
 * method-not-found. A hand-written instruction in a prompt is never the
 * boundary: the advertised capability and the method refusal agree.
 */
export function createClientMethodGuard({
  fileSystem = false,
  terminal = false,
  roots = [],
  readTextFile = null,
  writeTextFile = null,
  maxBytes = CLIENT_FILE_MAX_BYTES,
  log,
} = {}) {
  const allowedRoots = (Array.isArray(roots) ? roots : []).filter(root => typeof root === 'string' && root)
  const capabilities = { fileSystem: fileSystem === true && allowedRoots.length > 0, terminal: terminal === true }
  const deny = (id, message, code = RPC_METHOD_NOT_FOUND) => ({ jsonrpc: '2.0', id, error: { code, message } })

  const containedPath = (requested) => {
    if (typeof requested !== 'string' || !requested) return null
    if (!isAbsolute(requested)) return null
    const target = resolve(requested)
    for (const root of allowedRoots) {
      const rel = relative(resolve(root), target)
      if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) return target
    }
    return null
  }

  return Object.freeze({
    capabilities,
    /** Answer one inbound client method. Returns null when it is not ours. */
    handle(classified) {
      const method = classified?.method
      const id = classified?.id
      if (typeof method !== 'string' || (typeof id !== 'string' && typeof id !== 'number')) return null
      const isFile = method === 'fs/read_text_file' || method === 'fs/write_text_file'
      const isTerminal = method.startsWith('terminal/')
      if (!isFile && !isTerminal) return null
      if (isTerminal) {
        log?.({ event: 'acp.client-method-denied', method })
        return deny(id, 'terminal access is not available to this client')
      }
      if (!capabilities.fileSystem) {
        log?.({ event: 'acp.client-method-denied', method })
        return deny(id, 'client file access is disabled')
      }
      const target = containedPath(classified.params?.path)
      if (!target) return deny(id, 'path is outside the Host-submitted roots', RPC_INVALID_PARAMS)
      if (method === 'fs/read_text_file') {
        if (typeof readTextFile !== 'function') return deny(id, 'client file access is disabled')
        return Promise.resolve()
          .then(() => readTextFile(target, { line: classified.params?.line, limit: classified.params?.limit, maxBytes }))
          .then(content => ({ jsonrpc: '2.0', id, result: { content } }))
          .catch(error => ({ jsonrpc: '2.0', id, error: { code: -32602, message: error instanceof Error ? error.message : String(error) } }))
      }
      if (typeof writeTextFile !== 'function') return deny(id, 'client file access is disabled')
      const content = classified.params?.content
      if (typeof content !== 'string' || Buffer.byteLength(content) > maxBytes) {
        return deny(id, `client writes are limited to ${maxBytes} bytes of text`)
      }
      return Promise.resolve()
        .then(() => writeTextFile(target, content))
        .then(() => ({ jsonrpc: '2.0', id, result: {} }))
        .catch(error => ({ jsonrpc: '2.0', id, error: { code: -32602, message: error instanceof Error ? error.message : String(error) } }))
    },
  })
}
