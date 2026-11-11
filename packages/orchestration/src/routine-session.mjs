import { normalizeRoutineInput } from './bot-routine.mjs'

const error = (code, status = 'failed', detail = {}) => Object.assign(new Error(code), { code, status, ...detail })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  promise.catch(() => {})
  return { promise, resolve, reject }
}

/** ACK-serialized desktop transport. It never reconnects or retries a packet after sending it. */
export function createRoutineDesktopSession({ ticket, WebSocketImpl = globalThis.WebSocket, renewTicket, closeTicket,
  signal, ackTimeoutMs = 5_000, renewEveryMs = 45_000, now = Date.now,
  onFrame, onMetadata, onState, onBeforeInput, onAcknowledgedInput, onInputFailure } = {}) {
  if (!ticket?.sessionId || !ticket?.token || (typeof ticket.openWebSocket!=='function'&&(!ticket.websocketUrl||typeof WebSocketImpl!=='function'))) throw error('ROUTINE_DESKTOP_UNAVAILABLE')
  if (!Number.isSafeInteger(ackTimeoutMs) || ackTimeoutMs < 1 || ackTimeoutMs > 60_000) throw error('ROUTINE_ACK_TIMEOUT_INVALID')
  let socket
  const ready = deferred(), pending = new Map()
  let mode = 'watch', metadata = null, nextId = 0, queue = Promise.resolve(), closed = false, fatal = null
  let renewTimer, currentTicket = ticket
  const emit = value => { try { onState?.(value) } catch { /* UI observation must not change execution. */ } }
  const stopPending = failure => {
    for (const waiter of [...pending.values()]) waiter.fail(error(failure.code, waiter.sent ? 'unknown' : 'failed', { possiblyApplied: waiter.sent && waiter.type === 'input', inputId: waiter.id }))
    ready.reject(failure)
  }
  const breakConnection = code => {
    if (closed) return
    fatal ??= error(code)
    clearTimeout(renewTimer); stopPending(fatal); mode = 'watch'
    emit({ status: 'error', mode, code })
  }
  const send = value => {
    if (closed || socket?.readyState !== 1) throw error('ROUTINE_DESKTOP_DISCONNECTED')
    socket.send(JSON.stringify(value))
  }
  const request = (packet, type, id, operationSignal) => {
    if (operationSignal?.aborted) return Promise.reject(error('ROUTINE_CANCELLED', 'cancelled'))
    if (closed || socket?.readyState !== 1) return Promise.reject(error('ROUTINE_DESKTOP_DISCONNECTED'))
    const key = `${type}:${id ?? ''}`, result = deferred()
    const waiter = { ...result, type, id, sent: false, fail: null, finish: null }
    const clear = () => { clearTimeout(timer); operationSignal?.removeEventListener?.('abort', abort); pending.delete(key) }
    waiter.fail = failure => { clear(); result.reject(failure) }
    waiter.finish = value => { clear(); result.resolve(value) }
    const abort = () => waiter.fail(error('ROUTINE_CANCELLED', waiter.sent ? 'unknown' : 'cancelled', { possiblyApplied: waiter.sent && type === 'input', inputId: id }))
    const timer = setTimeout(() => waiter.fail(error('ROUTINE_ACK_LOST', 'unknown', { possiblyApplied: type === 'input', inputId: id })), ackTimeoutMs)
    pending.set(key, waiter); operationSignal?.addEventListener?.('abort', abort, { once: true })
    try { waiter.sent = true; send(packet) }
    catch (failure) { waiter.fail(error(failure.code ?? 'ROUTINE_SEND_FAILED', 'unknown', { possiblyApplied: type === 'input', inputId: id })) }
    return result.promise
  }
  const scheduleRenew = () => {
    if (closed || !renewTicket) return
    const untilExpiry = Number.isFinite(currentTicket.expiresAt) ? currentTicket.expiresAt - now() - 10_000 : renewEveryMs
    renewTimer = setTimeout(async () => {
      try {
        const renewed = await renewTicket(currentTicket.sessionId)
        if (closed) return
        if (!renewed || renewed.sessionId !== ticket.sessionId || !Number.isFinite(renewed.expiresAt) || renewed.expiresAt <= now()) throw error('ROUTINE_RENEW_INVALID')
        currentTicket = renewed; scheduleRenew()
      } catch { breakConnection('ROUTINE_AUTHORIZATION_LOST'); try { socket?.close() } catch {} }
    }, Math.max(1, Math.min(renewEveryMs, untilExpiry)))
    renewTimer.unref?.()
  }
  const onOpen = () => {
    try { send({ type: 'auth', sessionId: ticket.sessionId, token: ticket.token }); emit({ status: 'authenticating', mode }) }
    catch (failure) { breakConnection(failure.code ?? 'ROUTINE_AUTH_FAILED') }
  }
  const readyTimer = setTimeout(() => { breakConnection('ROUTINE_READY_TIMEOUT'); try { socket?.close() } catch {} }, ackTimeoutMs)
  ready.promise.finally(() => clearTimeout(readyTimer)).catch(() => {})
  const onMessage = message => {
    if (closed) return
    if (typeof message.data !== 'string') { onFrame?.(message.data); return }
    let value
    try { value = JSON.parse(message.data) } catch { breakConnection('ROUTINE_PROTOCOL_INVALID'); return }
    if (value.type === 'ready') {
      metadata = value; mode = value.mode === 'control' ? 'control' : 'watch'
      ready.resolve(value); onMetadata?.(value); emit({ status: 'connected', mode }); scheduleRenew(); return
    }
    if (value.type === 'frame' || value.type === 'displays') {
      if (value.width && value.height) metadata = { ...metadata, ...value }
      onMetadata?.(value); return
    }
    if (value.type === 'control' || value.type === 'mode') {
      mode = value.mode === 'control' ? 'control' : 'watch'
      const waiter = pending.get('control:')
      if (waiter) {
        if (value.ok === false) waiter.fail(error(value.code ?? 'ROUTINE_CONTROL_DENIED', 'failed', { possiblyApplied: false }))
        else waiter.finish(value)
      }
      emit({ status: 'connected', mode }); return
    }
    if (value.type === 'input' || value.type === 'release-input') {
      const waiter = pending.get(`${value.type}:${value.id ?? ''}`)
      if (!waiter) return
      if (value.ok === true) waiter.finish(value)
      else if (value.ok === false) waiter.fail(error(value.code ?? 'ROUTINE_INPUT_FAILED', value.possiblyApplied === false ? 'failed' : 'unknown',
        { possiblyApplied: value.possiblyApplied !== false, inputId: value.id }))
      else waiter.fail(error('ROUTINE_PROTOCOL_INVALID', 'unknown', { possiblyApplied: value.type === 'input', inputId: value.id }))
      return
    }
    if (value.type === 'error') breakConnection(value.code ?? 'ROUTINE_DESKTOP_ERROR')
  }
  const attach = value => {
    value.onerror=()=>breakConnection('ROUTINE_DESKTOP_DISCONNECTED')
    if(closed||fatal){value.close();return}
    socket=value;socket.binaryType='arraybuffer';socket.onopen=onOpen;socket.onmessage=onMessage
    socket.onclose=()=>breakConnection('ROUTINE_DESKTOP_DISCONNECTED')
    if(socket.readyState===1)onOpen()
  }
  if(typeof ticket.openWebSocket==='function')Promise.resolve().then(()=>ticket.openWebSocket()).then(attach,()=>breakConnection('ROUTINE_DESKTOP_UNAVAILABLE'))
  else attach(new WebSocketImpl(ticket.websocketUrl))
  const serialize = (work, cleanup = false) => {
    const result = queue.then(async () => {
      if (!cleanup && fatal) throw fatal
      try { return await work() }
      catch (failure) { if (!cleanup) fatal = failure; throw failure }
    })
    queue = result.catch(() => {})
    return result
  }
  return Object.freeze({
    ready: ready.promise,
    get metadata() { return metadata ? { ...metadata } : null },
    get mode() { return mode },
    acquire() { return serialize(async () => {
      await ready.promise
      if (ticket.canControl !== true) throw error('ROUTINE_CONTROL_DENIED')
      const value = await request({ type: 'control', action: 'acquire' }, 'control', null, signal)
      if (value.mode !== 'control') throw error('ROUTINE_CONTROL_DENIED')
      return value
    }) },
    input(raw, { stepIndex = null, signal: inputSignal = signal } = {}) { return serialize(async () => {
      await ready.promise
      if (mode !== 'control') throw error('ROUTINE_CONTROL_REQUIRED')
      const event = normalizeRoutineInput(raw), id = ++nextId, sentAt = now()
      if (metadata?.width && event.type === 'pointer' && (event.x >= metadata.width || event.y >= metadata.height)) throw error('ROUTINE_POINT_OUTSIDE_DISPLAY')
      const meta = { id, sessionId: ticket.sessionId, sentAt, stepIndex }
      await onBeforeInput?.(event, meta)
      try {
        const ack = await request({ type: 'input', id, event }, 'input', id, inputSignal)
        const result = { ...meta, acknowledgedAt: now(), acknowledgement: ack }
        try { await onAcknowledgedInput?.(event, result) }
        catch { throw error('ROUTINE_ACK_JOURNAL_FAILED', 'unknown', { possiblyApplied: true, inputId: id }) }
        return result
      } catch (failure) { await onInputFailure?.(event, { ...meta, failure }); throw failure }
    }) },
    drain() { return queue },
    releaseInput() { return serialize(() => request({ type: 'release-input', id: ++nextId }, 'release-input', nextId), true) },
    releaseControl() { return serialize(async () => {
      const value = await request({ type: 'control', action: 'release' }, 'control')
      if (value.mode !== 'watch') throw error('ROUTINE_CONTROL_RELEASE_UNCONFIRMED', 'unknown')
      return value
    }, true) },
    async close() {
      if (closed) return { stopConfirmed: false, code: 'ROUTINE_ALREADY_CLOSED' }
      clearTimeout(renewTimer)
      try { if (socket?.readyState === 1) send({ type: 'close' }) } catch {}
      closed = true; mode = 'watch'; stopPending(error('ROUTINE_DESKTOP_CLOSED'))
      try { socket?.close() } catch {}
      try { return await closeTicket?.(ticket.sessionId) ?? { stopConfirmed: false } }
      catch (failure) { return { stopConfirmed: false, code: failure.code ?? 'ROUTINE_STOP_UNCONFIRMED' } }
    },
  })
}
