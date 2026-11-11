// Bounded JSON-RPC transport over a stdio-shaped pipe, and the pipe itself.
//
// Ported and re-grounded from OpenMausBot server/drivers/acp/host.ts at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
// The upstream host frames a child's stdout, maps request ids to pending
// promises, and fails every pending entry when the process ends. This module
// keeps that shape and makes every bound explicit: pending count, write
// backlog, per-request deadline and idle deadline are hard limits, and a
// duplicate, unknown or late response is counted rather than replayed.

import { EventEmitter } from 'node:events'

import {
  DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_MAX_BACKLOG_BYTES, DEFAULT_MAX_FRAME_BYTES, DEFAULT_MAX_PENDING,
  DEFAULT_REQUEST_TIMEOUT_MS, MAX_LOG_PREVIEW, classifyMessage, createFrameDecoder, errorFromWire,
  isValidMessageId, parseFrame, previewMessage,
} from './rpc-codec.mjs'

const SETTLED_ID_MEMORY = 4096

/**
 * A child process (or the native supervisor's stdio relay) as one pipe.
 * `exit` resolves with `{ code, signal }` when the peer is really gone.
 */
export function createChildPipe({ stdin, stdout, exit, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES, maxBacklogBytes = DEFAULT_MAX_BACKLOG_BYTES, log } = {}) {
  if (!stdin || typeof stdin.write !== 'function') throw new TypeError('ACP_PIPE_STDIN_REQUIRED')
  if (!stdout || typeof stdout.on !== 'function') throw new TypeError('ACP_PIPE_STDOUT_REQUIRED')
  const events = new EventEmitter()
  let closed = false
  let queued = 0
  let writes = 0, dropped = 0, writeErrors = 0
  const decoder = createFrameDecoder({
    maxFrameBytes,
    onFrame: line => {
      const message = parseFrame(line)
      if (!message) {
        events.emit('malformed', { reason: 'unparseable', preview: line.slice(0, MAX_LOG_PREVIEW) })
        return
      }
      const classified = classifyMessage(message)
      if (classified.kind === 'invalid') {
        events.emit('malformed', { reason: classified.reason, preview: previewMessage(message) })
        return
      }
      events.emit('message', classified)
    },
    onError: error => {
      log?.({ event: 'acp.frame-limit', message: error.message })
      events.emit('malformed', { reason: error.message, preview: '' })
    },
  })
  stdout.on('data', chunk => decoder.write(chunk))
  stdout.on('end', () => decoder.end())
  stdout.on('error', error => { writeErrors++; events.emit('failure', error) })
  stdin.on('error', () => { writeErrors++ })
  const finish = (code = null, signal = null) => {
    if (closed) return
    closed = true
    events.emit('closed', { code, signal })
  }
  if (typeof exit?.then === 'function') exit.then(value => finish(value?.code ?? null, value?.signal ?? null), () => finish(null, null))
  const write = value => new Promise((resolve, reject) => {
    const wire = `${JSON.stringify(value)}\n`
    const bytes = Buffer.byteLength(wire)
    // The frame bound is a local validation: an oversized value is refused
    // whether or not the peer is still connected.
    if (bytes > maxFrameBytes) { dropped++; reject(Object.assign(new Error('ACP_FRAME_LIMIT'), { acpFrameLimit: true })); return }
    if (closed) { reject(Object.assign(new Error('ACP_PIPE_CLOSED'), { acpPipeClosed: true })); return }
    queued += bytes
    if (queued > maxBacklogBytes) {
      queued -= bytes
      dropped++
      const error = Object.assign(new Error('ACP_BACKLOG_LIMIT'), { acpBacklogLimit: true })
      events.emit('failure', error)
      finish(null, null)
      reject(error)
      return
    }
    writes++
    stdin.write(wire, error => {
      queued -= bytes
      if (error) { writeErrors++; reject(error); return }
      resolve()
    })
  })
  /** Fire-and-forget send: a refusal is counted, never thrown into protocol code. */
  const send = value => { void write(value).catch(() => {}) }
  return Object.freeze({
    events,
    write,
    send,
    end: () => { try { stdin.end() } catch {} },
    get closed() { return closed },
    get stats() { return Object.freeze({ ...decoder.stats, writes, dropped, writeErrors, queuedBytes: queued }) },
  })
}

/** Peer-exit and abort errors carry the evidence a caller needs to settle honestly. */
const peerExitError = (code, signal) => Object.assign(
  new Error(`ACP agent process exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`),
  { acpPeerExit: true, exitCode: code, exitSignal: signal },
)

/**
 * The RPC layer: id-mapped requests, notifications and responses, with pending,
 * deadline, idle and abort limits. Inbound requests and notifications are
 * emitted for the session layer to answer; this layer never decides policy.
 */
export function createStdioRpc({ pipe, maxPending = DEFAULT_MAX_PENDING, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, signal, route, log } = {}) {
  if (!pipe || typeof pipe.write !== 'function' || !pipe.events) throw new TypeError('ACP_RPC_PIPE_REQUIRED')
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) throw new TypeError('ACP_PENDING_LIMIT_INVALID')
  const pending = new Map()
  const settled = new Set()
  let nextId = 1
  let closed = false
  let lastInboundAt = null
  const stats = { requests: 0, responses: 0, notifications: 0, inboundRequests: 0, inboundNotifications: 0, unknownResponses: 0, duplicateResponses: 0, lateResponses: 0, malformed: 0, timeouts: 0, idleTimeouts: 0, aborted: 0, pendingLimitRefusals: 0, peerExits: 0 }

  const remember = id => {
    settled.add(id)
    if (settled.size > SETTLED_ID_MEMORY) settled.delete(settled.values().next().value)
  }

  const clearTimers = entry => {
    if (entry.timer) clearTimeout(entry.timer)
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
  }

  const settleEntry = (entry, error) => {
    if (!pending.delete(entry.id)) return false
    clearTimers(entry)
    remember(entry.id)
    entry.reject(error)
    return true
  }

  const touch = (owner = null) => {
    lastInboundAt = Date.now()
    for (const entry of pending.values()) {
      // A session's own traffic restarts only its own deadlines; a process-level
      // request (issued before any session exists) restarts on any traffic.
      if (entry.owner === null || entry.owner === owner) entry.armIdle()
    }
  }

  const failAll = (error, cause) => {
    for (const entry of [...pending.values()]) {
      if (!pending.delete(entry.id)) continue
      clearTimers(entry)
      remember(entry.id)
      entry.reject(error)
    }
    if (cause === 'peer-exit') stats.peerExits++
  }

  /** Reject every pending request owned by one session; other sessions go on. */
  const failOwner = (owner, error) => {
    if (typeof owner !== 'string' || !owner) return 0
    let failed = 0
    for (const entry of [...pending.values()]) {
      if (entry.owner !== owner) continue
      if (!pending.delete(entry.id)) continue
      clearTimers(entry)
      remember(entry.id)
      entry.reject(error)
      failed++
    }
    return failed
  }

  const close = (reason = 'closed') => {
    if (closed) return
    closed = true
    failAll(Object.assign(new Error(`ACP connection ${reason}`), { acpClosed: true }), 'close')
    pipe.events.off('message', onMessage)
    pipe.events.off('malformed', onMalformed)
    pipe.events.off('failure', onFailure)
    pipe.events.off('closed', onClosed)
    pipe.end()
  }

  function onMessage(classified) {
    touch(typeof route === 'function' ? route(classified) ?? null : null)
    if (classified.kind === 'response') {
      stats.responses++
      const entry = pending.get(classified.id)
      if (!entry) {
        // A response for an id this side never issued, or already settled.
        if (settled.has(classified.id)) { stats.duplicateResponses++; stats.lateResponses++ } else stats.unknownResponses++
        return
      }
      pending.delete(classified.id)
      clearTimers(entry)
      remember(classified.id)
      if (classified.error !== undefined) {
        entry.reject(errorFromWire(classified.error, entry.method))
        return
      }
      entry.onReceive?.(classified.result)
      entry.resolve(classified.result)
      return
    }
    if (classified.kind === 'request') {
      stats.inboundRequests++
      pipe.events.emit('rpc-request', classified)
      return
    }
    stats.inboundNotifications++
    pipe.events.emit('rpc-notification', classified)
  }

  function onMalformed(detail) {
    stats.malformed++
    log?.({ event: 'acp.malformed', reason: detail?.reason ?? 'unknown' })
  }

  function onFailure(error) {
    log?.({ event: 'acp.pipe-failure', message: error?.message ?? String(error) })
    failAll(error instanceof Error ? error : new Error(String(error)), 'failure')
  }

  function onClosed(detail) {
    if (closed) return
    closed = true
    failAll(peerExitError(detail?.code ?? null, detail?.signal ?? null), 'peer-exit')
    pipe.events.off('message', onMessage)
    pipe.events.off('malformed', onMalformed)
    pipe.events.off('failure', onFailure)
    pipe.events.off('closed', onClosed)
  }

  pipe.events.on('message', onMessage)
  pipe.events.on('malformed', onMalformed)
  pipe.events.on('failure', onFailure)
  pipe.events.on('closed', onClosed)

  const onAbort = () => close('aborted')
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()

  return Object.freeze({
    /** Peer-exit and abort errors carry the evidence a caller needs to settle honestly. */
    /** The inbound event bus: `rpc-request`, `rpc-notification`, `malformed`, `failure`, `closed`. */
    events: pipe.events,
    request(method, params, options = {}) {
      if (closed) return Promise.reject(Object.assign(new Error('ACP connection closed'), { acpClosed: true }))
      if (typeof method !== 'string' || !method) return Promise.reject(Object.assign(new TypeError('ACP_METHOD_REQUIRED'), { acpInvalidRequest: true }))
      if (pending.size >= maxPending) {
        stats.pendingLimitRefusals++
        return Promise.reject(Object.assign(new Error(`ACP pending limit reached (${maxPending})`), { acpPendingLimit: true }))
      }
      if (options.signal?.aborted) return Promise.reject(Object.assign(new Error('ACP request aborted'), { acpAborted: true }))
      const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : requestTimeoutMs
      const idleMs = Number.isSafeInteger(options.idleMs) && options.idleMs > 0 ? options.idleMs : idleTimeoutMs
      const id = nextId++
      return new Promise((resolve, reject) => {
        const entry = {
          id, method, resolve, reject,
          owner: typeof options.owner === 'string' && options.owner ? options.owner : null,
          onReceive: typeof options.onReceive === 'function' ? options.onReceive : null,
          timer: null, idleTimer: null, idleMs,
          armIdle: () => {
            if (!(entry.idleMs > 0)) return
            if (entry.idleTimer) clearTimeout(entry.idleTimer)
            entry.idleTimer = setTimeout(() => {
              if (!pending.delete(id)) return
              remember(id)
              stats.idleTimeouts++
              reject(Object.assign(new Error(`${method} stopped responding`), { acpIdleTimeout: true }))
            }, entry.idleMs)
            entry.idleTimer.unref?.()
          },
        }
        entry.timer = setTimeout(() => {
          if (!pending.delete(id)) return
          remember(id)
          stats.timeouts++
          reject(Object.assign(new Error(`${method} timed out after ${timeoutMs}ms`), { acpRequestTimeout: true }))
        }, timeoutMs)
        entry.timer.unref?.()
        entry.armIdle()
        pending.set(id, entry)
        stats.requests++
        const onRequestAbort = () => {
          if (!pending.delete(id)) return
          clearTimers(entry)
          remember(id)
          stats.aborted++
          reject(Object.assign(new Error(`${method} aborted`), { acpAborted: true }))
        }
        if (options.signal) {
          entry.onAbort = onRequestAbort
          options.signal.addEventListener('abort', onRequestAbort, { once: true })
        }
        pipe.write({ jsonrpc: '2.0', id, method, params: params === undefined ? {} : params }).catch(error => {
          if (!pending.delete(id)) return
          clearTimers(entry)
          remember(id)
          if (options.signal) options.signal.removeEventListener?.('abort', onRequestAbort)
          reject(error)
        })
      })
    },
    /** A notification: no id, no reply expected. */
    notify(method, params) {
      if (closed || typeof method !== 'string' || !method) return false
      stats.notifications++
      pipe.send({ jsonrpc: '2.0', method, params: params === undefined ? {} : params })
      return true
    },
    /** Answer a server request. Unknown ids are the peer's problem, not ours. */
    respond(id, result) {
      if (closed || !isValidMessageId(id)) return false
      pipe.send({ jsonrpc: '2.0', id, result: result === undefined ? {} : result })
      return true
    },
    respondError(id, code, message, data) {
      if (closed || !isValidMessageId(id)) return false
      pipe.send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } })
      return true
    },
    get pendingCount() { return pending.size },
    failOwner,
    get closed() { return closed },
    get lastInboundAt() { return lastInboundAt },
    get stats() { return Object.freeze({ ...stats, pending: pending.size }) },
    close,
  })
}
