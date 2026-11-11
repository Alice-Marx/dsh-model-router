/** The viewer never receives a pairing secret. Its ticket belongs to one authenticated desktop session. */
export function connectDesktopStream({ ticket, botId, transport, onFrame, onState, onMetadata, onBeforeInput, onInputAcknowledged, onInputFailure,onBeforeRelease,onReleaseAcknowledged,onReleaseFailure,
  WebSocketImpl = globalThis.WebSocket, ackTimeoutMs = 10000, now = Date.now }) {
  let websocketUrl=ticket?.websocketUrl
  if(ticket?.websocketPath){
    if(ticket.websocketPath!=='/bot-product/desktop/v1/socket'||!['http:','https:'].includes(globalThis.location?.protocol))throw new Error('此桌面连接需要已登录的网页宿主。')
    const endpoint=new URL(ticket.websocketPath,globalThis.location.href);endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';websocketUrl=endpoint.href
  }
  if (ticket?.carrier!=='owner-http'&&(!websocketUrl || typeof WebSocketImpl !== 'function')) throw new Error('桌面连接不可用。')
  if(ticket?.carrier==='owner-http'&&typeof transport!=='function')throw new Error('宿主桌面数据通道尚未就绪。')
  const socket = ticket?.carrier==='owner-http'?createOwnerDesktopSocket({ticket,botId,dispatch:transport}):new WebSocketImpl(websocketUrl)
  socket.binaryType = 'arraybuffer'
  let closed = false, mode = 'watch', desiredMode = ticket.mode === 'control' ? 'control' : 'watch', nextId = 0
  let lastError = ''
  const reportError = (error, extra = {}) => {
    lastError ||= error
    onState?.({ status: 'error', mode, error: lastError, ...extra })
  }
  let frameMetadata
  const pending = new Map()
  const send = value => {
    if (closed || socket.readyState !== 1) return false
    socket.send(JSON.stringify(value)); return true
  }
  const failed = (row, failure) => {
    if (!pending.delete(row.id)) return
    clearTimeout(row.timer)
    if (row.event) onInputFailure?.(row.event, { ...row.meta, failure })
    else onReleaseFailure?.({...row.meta,failure})
    row.reject(Object.assign(new Error(failure.code), failure))
  }
  const failPending = code => { for (const row of [...pending.values()]) failed(row, { code, possiblyApplied: true }) }
  const enqueue = (type, event) => {
    const id = ++nextId, meta = { id, sessionId: ticket.sessionId, sentAt: now() }
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    promise.catch(() => {})
    const row = { id, event, meta, promise, resolve, reject }
    row.timer = setTimeout(() => {
      failed(row, { code: 'DESKTOP_INPUT_ACK_LOST', possiblyApplied: true })
      mode = 'watch'; reportError('远端未确认输入，已断开以释放控制。请检查电脑后重新连接。'); socket.close()
    }, ackTimeoutMs)
    pending.set(id, row)
    try {
      if (event) onBeforeInput?.(event, meta)
      else onBeforeRelease?.(meta)
      if (!send({ type, id, ...(event ? { event } : {}) })) throw Object.assign(new Error('DESKTOP_DISCONNECTED'), { code: 'DESKTOP_DISCONNECTED' })
    } catch (error) { failed(row, { code: error.code ?? 'DESKTOP_DISCONNECTED', possiblyApplied: false }); return null }
    return promise
  }
  socket.onopen = () => { send({ type: 'auth', sessionId: ticket.sessionId, token: ticket.token }); onState?.({ status: 'authenticating', mode }) }
  socket.onmessage = event => {
    if (closed) return
    if (typeof event.data !== 'string') { onFrame?.(event.data, frameMetadata); return }
    let value
    try { value = JSON.parse(event.data) } catch { reportError('桌面消息格式无效。'); return }
    if (value.type === 'input' || value.type === 'release-input') {
      const row = pending.get(value.id)
      if (!row || value.type !== (row.event ? 'input' : 'release-input')) return
      if (value.ok !== true) {
        failed(row, { code: value.code ?? 'DESKTOP_INPUT_REJECTED', possiblyApplied: value.possiblyApplied === true })
        mode = 'watch'; reportError(value.code ?? '远端拒绝了输入。'); socket.close(); return
      }
      pending.delete(row.id); clearTimeout(row.timer)
      if (row.event) onInputAcknowledged?.(row.event, { ...row.meta, acknowledgedAt: now() })
      else onReleaseAcknowledged?.({...row.meta,acknowledgedAt:now(),ok:true})
      row.resolve({ ok: true, id: row.id }); return
    }
    if (value.type === 'ready') {
      mode = value.mode === 'control' && desiredMode === 'control' ? 'control' : 'watch'
      onMetadata?.(value); onState?.({ ...value, status: 'connected', mode })
    } else if (value.type === 'control' || value.type === 'mode') {
      mode = value.mode === 'control' && desiredMode === 'control' ? 'control' : 'watch'
      onState?.({ ...value, status: value.mode === 'control' && desiredMode === 'watch' ? 'releasing' : 'connected', mode })
    } else if (value.type === 'frame' || value.type === 'displays') { if (value.type === 'frame') frameMetadata = value; onMetadata?.(value) }
    else if (value.type === 'error') reportError(value.message ?? value.code ?? '桌面操作失败。')
    else if (value.type === 'status') { if (value.mode) mode = value.mode; onState?.({ ...value, mode }) }
  }
  socket.onerror = () => reportError('桌面传输连接失败，请检查远程 Agent 的连接地址和桌面会话。', { mode: 'watch' })
  socket.onclose = event => { failPending('DESKTOP_DISCONNECTED'); mode = 'watch'; if (!closed) onState?.({ status: lastError ? 'error' : 'disconnected', mode, error: lastError || event.reason || '' }) }
  return Object.freeze({
    setMode(next) {
      if (!['watch', 'control'].includes(next)) return false
      desiredMode = next
      if (next === 'watch') { mode = 'watch'; onState?.({ status: 'releasing', mode }) }
      return send({ type: 'control', action: next === 'control' ? 'acquire' : 'release' })
    },
    input(event) {
      if (mode !== 'control' || closed || socket.readyState !== 1) return false
      if (pending.size >= 64) { mode = 'watch'; reportError('输入确认积压，连接已停止。请检查远程电脑。'); socket.close(); return false }
      return enqueue('input', event) !== null
    },
    drain: () => Promise.all([...pending.values()].map(row => row.promise)),
    releaseInput() { return enqueue('release-input') ?? Promise.resolve({ ok: false, code: 'DESKTOP_DISCONNECTED' }) },
    close() { if (closed) return; send({ type: 'close' }); closed = true; mode = 'watch'; failPending('DESKTOP_DISCONNECTED'); socket.close() },
  })
}
import { createOwnerDesktopSocket } from './desktop-http-socket.mjs'
