import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'

export const DESKTOP_PROXY_PATH = '/bot-product/desktop/v1/socket'
export const DESKTOP_PROXY_LIMITS = Object.freeze({ maxConnections: 16, maxTickets: 32, authTimeoutMs: 5000,
  maxPayload: 9 * 1024 * 1024, maxBufferedBytes: 12 * 1024 * 1024, maxQueuedFrames: 64, maxTicketMs: 300_000 })
export const DESKTOP_PROXY_UPSTREAM_OPTIONS = Object.freeze({ autoPong: false, perMessageDeflate: false, maxPayload: DESKTOP_PROXY_LIMITS.maxPayload })

const fail = code => { throw Object.assign(new Error(code), { code }) }
const identifier = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/u.test(value)
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value)
const digest = value => createHash('sha256').update(value).digest()
const matches = (value, expected) => token(value) && timingSafeEqual(digest(value), expected)
const isSignal = signal => signal && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function'
const owner = peer => peer?.principal?.kind === 'owner' && isSignal(peer.signal) && !peer.signal.aborted
const originOf = value => {
  if (typeof value !== 'string') fail('DESKTOP_PROXY_ORIGIN_DENIED')
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) fail('DESKTOP_PROXY_ORIGIN_DENIED')
    return value
  } catch { fail('DESKTOP_PROXY_ORIGIN_DENIED') }
}
const synchronous = value => {
  if (value && typeof value.then === 'function') {
    Promise.resolve(value).catch(() => {})
    fail('DESKTOP_PROXY_AUTHORITY_INVALID')
  }
  return value
}
const bufferOf = data => Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)

export function desktopTicketMetadata(ticket) {
  const result = { sessionId: ticket.sessionId, expiresAt: ticket.expiresAt }
  for (const key of ['taskId', 'attemptId', 'displayId', 'coordinateSpace']) {
    if (typeof ticket[key] === 'string' && ticket[key].length <= 256 && !/[\u0000-\u001f]/u.test(ticket[key])) result[key] = ticket[key]
  }
  if (['watch', 'control'].includes(ticket.mode)) result.mode = ticket.mode
  for (const key of ['canControl', 'controlAllowed']) if (typeof ticket[key] === 'boolean') result[key] = ticket[key]
  for (const key of ['width', 'height', 'fps']) if (Number.isSafeInteger(ticket[key]) && ticket[key] > 0) result[key] = ticket[key]
  if (Array.isArray(ticket.displays)) result.displays = Object.freeze(ticket.displays.slice(0, 32).map(display => {
    const row = {}
    for (const key of ['id', 'name']) if (typeof display?.[key] === 'string' && display[key].length <= 256 && !/[\u0000-\u001f]/u.test(display[key])) row[key] = display[key]
    for (const key of ['width', 'height', 'x', 'y', 'dpi', 'scaleFactor']) if (Number.isFinite(display?.[key])) row[key] = display[key]
    if (typeof display?.primary === 'boolean') row.primary = display.primary
    return Object.freeze(row)
  }))
  return result
}

/**
 * Host-only desktop carrier. validate is synchronous and closes over committed authority;
 * connect creates a paired upstream Node ws with DESKTOP_PROXY_UPSTREAM_OPTIONS.
 * ownerPeer must be the exact Peer admitted for the ticket's originating owner action.
 */
export function createDesktopProxy({ webServer, connection, now = Date.now }) {
  if (typeof webServer?.registerUpgrade !== 'function' || !['http:', 'https:'].includes(webServer.protocol)
    || typeof connection?.admitConnection !== 'function' || typeof connection?.admit !== 'function' || typeof now !== 'function') fail('DESKTOP_PROXY_REQUIRES_HOST')
  const limits = DESKTOP_PROXY_LIMITS, rows = new Map(), states = new Set(), signalWatches = new Map(), releases = new Set()
  const sockets = new WebSocketServer({ noServer: true, autoPong: false, perMessageDeflate: false,
    maxPayload: limits.maxPayload, maxFragments: 1024, maxBufferedChunks: 1024 })
  sockets.on('error', () => {})
  let closing = false, closed

  const watch = (signal, callback) => {
    if (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function') fail('DESKTOP_PROXY_AUTHORITY_INVALID')
    let entry = signalWatches.get(signal)
    if (!entry) {
      entry = { callbacks: new Set(), abort: () => { for (const fn of [...entry.callbacks]) fn() } }
      signalWatches.set(signal, entry); signal.addEventListener('abort', entry.abort, { once: true })
    }
    entry.callbacks.add(callback)
    return () => {
      entry.callbacks.delete(callback)
      if (!entry.callbacks.size) { signal.removeEventListener('abort', entry.abort); signalWatches.delete(signal) }
    }
  }
  const release = state => {
    if (!state.admission || state.released) return
    state.released = true
    let result
    try { result = state.admission.release() } catch { return }
    const pending = Promise.resolve(result).catch(() => {})
    releases.add(pending); void pending.finally(() => releases.delete(pending))
  }
  const endRow = row => {
    if (row.ended) return
    row.ended = true; row.secret = null; row.connect = null; row.validate = null; row.active = null
    for (const off of row.unwatch) off()
    row.unwatch = []
  }
  const rejectHttp = (state, status) => {
    if (state.raw.destroyed) return
    const reason = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 409: 'Conflict', 429: 'Too Many Requests', 503: 'Service Unavailable' }[status] ?? 'Forbidden'
    const text = `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    const timer = setTimeout(() => state.raw.destroy(), 250); timer.unref()
    state.raw.once('close', () => clearTimeout(timer))
    try { state.raw.end(text, () => state.raw.destroy()) } catch { state.raw.destroy() }
  }
  const stop = (state, code = 'DESKTOP_PROXY_DISCONNECTED', closeCode = 1008, httpStatus) => {
    if (state.ended) return
    state.ended = true; states.delete(state); clearTimeout(state.timer); state.controller.abort()
    state.unwatch?.(); state.unwatch = null
    if (state.row) endRow(state.row)
    for (const channel of [state.toBrowser, state.toAgent]) { channel.queue = []; channel.bytes = 0; channel.count = 0 }
    if (state.upstream) {
      try { state.upstream.terminate() } catch {}
    }
    if (state.browser) {
      const ws = state.browser
      if (ws.readyState === 1) {
        try {
          if (ws.bufferedAmount <= 2048) ws.send(JSON.stringify({ type: 'error', code }), { compress: false }, () => {})
          ws.close(closeCode, code)
        } catch { ws.terminate() }
      } else if (ws.readyState !== 3) ws.terminate()
      if (ws.readyState !== 3) { const timer = setTimeout(() => ws.terminate(), 250); timer.unref(); ws.once('close', () => clearTimeout(timer)) }
    } else if (httpStatus) rejectHttp(state, httpStatus)
    else state.raw.destroy()
    release(state)
  }
  const checkRow = row => {
    if (closing || row.ended || !owner(row.ownerPeer) || row.signal?.aborted || row.expiresAt <= now()) fail('DESKTOP_PROXY_REVOKED')
    if (synchronous(row.validate({ sessionId: row.sessionId, ownerPeer: row.ownerPeer })) === false) fail('DESKTOP_PROXY_REVOKED')
  }
  const check = state => {
    if (state.ended || closing || !owner(state.admission?.peer) || state.deadline !== null && state.deadline <= now()) fail('DESKTOP_PROXY_REVOKED')
    const admission = synchronous(connection.admit(state.request))
    if (!admission || 'rejection' in admission || admission.peer !== state.admission.peer || !owner(admission.peer)) fail('DESKTOP_PROXY_REVOKED')
    if (state.row) checkRow(state.row)
  }
  const channelOf = () => ({ target: null, queue: [], bytes: 0, count: 0, sending: false })
  const pump = (state, channel) => {
    if (state.ended || channel.sending || channel.target?.readyState !== 1 || !channel.queue.length) return
    try { check(state) } catch { stop(state, 'DESKTOP_PROXY_REVOKED'); return }
    const item = channel.queue.shift(), target = channel.target
    channel.sending = true
    const done = error => {
      if (state.ended) return
      channel.sending = false; channel.bytes -= item.data.length; channel.count -= 1
      if (error) stop(state, 'DESKTOP_PROXY_DISCONNECTED', 1011)
      else pump(state, channel)
    }
    try {
      if (item.kind === 'message') target.send(item.data, { binary: item.binary, compress: false }, done)
      else target[item.kind](item.data, undefined, done)
    } catch { stop(state, 'DESKTOP_PROXY_DISCONNECTED', 1011) }
  }
  const enqueue = (state, channel, kind, data, binary = false) => {
    if (state.ended) return
    try {
      check(state)
      const bytes = bufferOf(data), size = bytes.length, buffered = channel.target?.bufferedAmount ?? 0
      if (size > limits.maxPayload || kind !== 'message' && size > 125 || kind === 'message' && !binary && size > 65536) {
        stop(state, 'DESKTOP_PROXY_MESSAGE_LIMIT', 1009); return
      }
      if (!Number.isFinite(buffered) || Math.max(channel.bytes, buffered) + size > limits.maxBufferedBytes || channel.count >= limits.maxQueuedFrames) {
        stop(state, 'DESKTOP_PROXY_BACKPRESSURE', 1013); return
      }
      channel.queue.push({ kind, data: bytes, binary }); channel.bytes += size; channel.count += 1
      pump(state, channel)
    } catch { stop(state, 'DESKTOP_PROXY_REVOKED') }
  }
  const attachUpstream = (state, upstream) => {
    if (!upstream || typeof upstream.on !== 'function' || typeof upstream.terminate !== 'function') fail('DESKTOP_PROXY_UNAVAILABLE')
    upstream.on('error', () => stop(state, 'DESKTOP_PROXY_DISCONNECTED', 1011))
    if (state.ended) { upstream.terminate(); return }
    state.upstream = upstream
    if (![0, 1].includes(upstream.readyState) || ['send', 'ping', 'pong'].some(name => typeof upstream[name] !== 'function')) fail('DESKTOP_PROXY_UNAVAILABLE')
    upstream.once('close', () => stop(state, 'DESKTOP_PROXY_DISCONNECTED', 1011))
    upstream.on('message', (data, binary) => enqueue(state, state.toBrowser, 'message', data, binary))
    // DS Desktop uses the pong after a JPEG as its receipt. Neither proxy leg may auto-pong.
    upstream.on('ping', data => enqueue(state, state.toBrowser, 'ping', data))
    upstream.on('pong', data => enqueue(state, state.toBrowser, 'pong', data))
    let opened = false
    const open = () => {
      if (opened || state.ended) return
      opened = true
      try { check(state) } catch { stop(state, 'DESKTOP_PROXY_REVOKED'); return }
      clearTimeout(state.timer); state.deadline = null; state.phase = 'forwarding'
      state.toAgent.target = upstream; pump(state, state.toAgent)
    }
    upstream.once('open', open)
    if (upstream.readyState === 1) open()
  }
  const authenticate = (state, data, binary) => {
    let row
    try {
      if (binary || bufferOf(data).length > 2048) fail('DESKTOP_PROXY_AUTH_INVALID')
      const value = JSON.parse(bufferOf(data).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['type', 'sessionId', 'token'].includes(key))
        || value.type !== 'auth' || !identifier(value.sessionId) || !token(value.token)) fail('DESKTOP_PROXY_AUTH_INVALID')
      row = rows.get(value.sessionId)
      if (!row || row.used || row.ended || row.ownerPeer !== state.admission.peer || row.clientOrigin !== state.origin || !matches(value.token, row.proxyDigest)) fail('DESKTOP_PROXY_AUTH_INVALID')
      check(state); checkRow(row)
    } catch { stop(state, 'DESKTOP_PROXY_AUTH_INVALID'); return }
    row.used = true; row.active = state; state.row = row; state.phase = 'connecting'
    clearTimeout(state.timer); state.deadline = now() + limits.authTimeoutMs
    state.timer = setTimeout(() => stop(state, 'DESKTOP_PROXY_CONNECT_TIMEOUT', 1011), limits.authTimeoutMs); state.timer.unref()
    const connect = row.connect, auth = Buffer.from(JSON.stringify({ type: 'auth', sessionId: row.sessionId, token: row.secret }))
    row.secret = null
    enqueue(state, state.toAgent, 'message', auth)
    if (state.ended) return
    try {
      Promise.resolve(connect({ signal: state.controller.signal, sessionId: row.sessionId, webSocketOptions: DESKTOP_PROXY_UPSTREAM_OPTIONS }))
        .then(upstream => { try { attachUpstream(state, upstream) } catch { stop(state, 'DESKTOP_PROXY_UNAVAILABLE', 1011) } }, () => stop(state, 'DESKTOP_PROXY_UNAVAILABLE', 1011))
    } catch { stop(state, 'DESKTOP_PROXY_UNAVAILABLE', 1011) }
  }
  const accept = (state, browser) => {
    if (state.ended) { browser.on('error', () => {}); browser.terminate(); return }
    state.browser = browser; state.toBrowser.target = browser
    browser.on('error', () => stop(state, 'DESKTOP_PROXY_DISCONNECTED', 1011))
    browser.once('close', () => stop(state, 'DESKTOP_PROXY_DISCONNECTED', 1011))
    browser.on('message', (data, binary) => state.phase === 'auth' ? authenticate(state, data, binary) : enqueue(state, state.toAgent, 'message', data, binary))
    for (const kind of ['ping', 'pong']) browser.on(kind, data => {
      if (state.phase === 'auth') stop(state, 'DESKTOP_PROXY_AUTH_INVALID')
      else enqueue(state, state.toAgent, kind, data)
    })
    state.raw.resume()
  }
  const handleUpgrade = async (request, raw, head) => {
    const state = { raw, browser: null, upstream: null, row: null, ended: false, released: false, admission: null,
      phase: 'auth', controller: new AbortController(), toBrowser: channelOf(), toAgent: channelOf(), deadline: now() + limits.authTimeoutMs }
    raw.on('error', () => stop(state, 'DESKTOP_PROXY_DISCONNECTED', 1011))
    raw.once('close', () => stop(state, 'DESKTOP_PROXY_DISCONNECTED', 1011))
    raw.pause()
    state.timer = setTimeout(() => stop(state, 'DESKTOP_PROXY_AUTH_REQUIRED', 1008, 401), limits.authTimeoutMs); state.timer.unref()
    if (closing || states.size >= limits.maxConnections) { stop(state, 'DESKTOP_PROXY_CONNECTION_LIMIT', 1013, closing ? 503 : 429); return }
    states.add(state)
    try {
      if (request.url !== DESKTOP_PROXY_PATH || head.length > 8192 || request.headers['sec-websocket-protocol'] !== undefined) { stop(state, 'DESKTOP_PROXY_REQUEST_INVALID', 1008, 400); return }
      state.origin = originOf(request.headers.origin)
      const host = request.headers.host
      if (typeof host !== 'string' || new URL(`${webServer.protocol}//${host}`).origin !== state.origin) { stop(state, 'DESKTOP_PROXY_ORIGIN_DENIED', 1008, 403); return }
      state.request = { headers: Object.freeze(Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? Object.freeze([...value]) : value]))) }
      const admission = await connection.admitConnection(state.request)
      if (admission && !('rejection' in admission) && typeof admission.release === 'function') state.admission = admission
      if (state.ended) { release(state); return }
      if (!state.admission || !owner(admission.peer)) { stop(state, 'DESKTOP_PROXY_AUTH_INVALID', 1008, admission?.rejection === 401 ? 401 : admission?.rejection === 409 ? 409 : 403); return }
      check(state)
      state.unwatch = watch(admission.peer.signal, () => stop(state, 'DESKTOP_PROXY_REVOKED'))
      if (admission.peer.signal.aborted || state.ended) { stop(state, 'DESKTOP_PROXY_REVOKED', 1008, 403); return }
      sockets.handleUpgrade(request, raw, head, browser => accept(state, browser))
    } catch { stop(state, 'DESKTOP_PROXY_AUTH_INVALID', 1008, 403) }
  }
  const unregister = webServer.registerUpgrade({ path: DESKTOP_PROXY_PATH, handler: handleUpgrade })
  const sweep = setInterval(() => {
    for (const state of [...states]) {
      if (state.deadline !== null && state.deadline <= now()) { stop(state, state.phase === 'auth' ? 'DESKTOP_PROXY_AUTH_REQUIRED' : 'DESKTOP_PROXY_CONNECT_TIMEOUT', 1008, state.browser ? undefined : 401); continue }
      if (state.admission) try { check(state) } catch { stop(state, 'DESKTOP_PROXY_REVOKED') }
    }
    for (const [key, row] of rows) {
      if (row.expiresAt <= now()) { if (row.active) stop(row.active, 'DESKTOP_PROXY_EXPIRED'); endRow(row); rows.delete(key) }
      else if (!row.ended) try { checkRow(row) } catch { if (row.active) stop(row.active, 'DESKTOP_PROXY_REVOKED'); endRow(row) }
    }
  }, 100)
  sweep.unref()

  return Object.freeze({
    wrapTicket(ticket, { ownerPeer, clientOrigin, connect, validate, signal } = {}) {
      if (closing) fail('DESKTOP_PROXY_CLOSED')
      if (!ticket || !identifier(ticket.sessionId) || !token(ticket.token) || !Number.isSafeInteger(ticket.expiresAt)
        || ticket.expiresAt <= now() || ticket.expiresAt > now() + limits.maxTicketMs
        || typeof connect !== 'function' || typeof validate !== 'function' || !owner(ownerPeer) || signal !== undefined && (!isSignal(signal) || signal.aborted)) fail('DESKTOP_PROXY_TICKET_INVALID')
      const origin = originOf(clientOrigin), sourceDigest = digest(ticket.token), previous = rows.get(ticket.sessionId)
      if (previous) {
        if (previous.ended || previous.expiresAt <= now() || previous.ownerPeer !== ownerPeer || previous.clientOrigin !== origin
          || !timingSafeEqual(previous.sourceDigest, sourceDigest)) fail('DESKTOP_PROXY_TICKET_INVALID')
        const candidate = { ...previous, expiresAt: ticket.expiresAt, connect, validate, signal }
        checkRow(candidate)
        previous.expiresAt = ticket.expiresAt; previous.connect = connect; previous.validate = validate
        if (signal !== previous.signal) {
          for (const off of previous.unwatch) off()
          previous.signal = signal
          previous.unwatch = [watch(ownerPeer.signal, () => { if (previous.active) stop(previous.active, 'DESKTOP_PROXY_REVOKED'); endRow(previous) })]
          if (signal) previous.unwatch.push(watch(signal, () => { if (previous.active) stop(previous.active, 'DESKTOP_PROXY_REVOKED'); endRow(previous) }))
        }
        return Object.freeze({ ...desktopTicketMetadata(ticket), websocketPath: DESKTOP_PROXY_PATH, token: previous.proxyToken })
      }
      for (const [key, row] of rows) if (row.expiresAt <= now()) { if (row.active) stop(row.active, 'DESKTOP_PROXY_EXPIRED'); endRow(row); rows.delete(key) }
      if (rows.size >= limits.maxTickets) fail('DESKTOP_PROXY_TICKET_LIMIT')
      const proxyToken = randomBytes(32).toString('base64url')
      const row = { sessionId: ticket.sessionId, expiresAt: ticket.expiresAt, ownerPeer, clientOrigin: origin, connect, validate, signal,
        secret: ticket.token, sourceDigest, proxyToken, proxyDigest: digest(proxyToken), used: false, ended: false, active: null, unwatch: [] }
      checkRow(row)
      const revoke = () => { if (row.active) stop(row.active, 'DESKTOP_PROXY_REVOKED'); endRow(row) }
      row.unwatch.push(watch(ownerPeer.signal, revoke))
      if (signal) row.unwatch.push(watch(signal, revoke))
      rows.set(row.sessionId, row)
      if (ownerPeer.signal.aborted || signal?.aborted) { revoke(); fail('DESKTOP_PROXY_REVOKED') }
      return Object.freeze({ ...desktopTicketMetadata(ticket), websocketPath: DESKTOP_PROXY_PATH, token: proxyToken })
    },
    revoke(sessionId) {
      const row = rows.get(sessionId)
      if (!row) return false
      if (row.active) stop(row.active, 'DESKTOP_PROXY_REVOKED')
      endRow(row)
      return true
    },
    close() {
      if (closed) return closed
      closing = true; clearInterval(sweep)
      try { unregister?.() } catch {}
      for (const state of [...states]) stop(state, 'DESKTOP_PROXY_CLOSED', 1001)
      for (const row of rows.values()) endRow(row)
      rows.clear()
      closed = Promise.allSettled([...releases, new Promise(resolve => sockets.close(() => resolve()))]).then(() => undefined)
      return closed
    },
  })
}
