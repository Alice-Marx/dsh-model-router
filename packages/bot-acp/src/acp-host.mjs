// ACP host: one agent process, the sessions that run in it, and the routing
// between them.
//
// Ported and re-grounded from OpenMausBot server/drivers/acp/host.ts at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
// Upstream keys every session request and update by sessionId, so a sharing
// driver links many threads to one host and every other driver links exactly
// one. That keying is also the security boundary: one session's traffic is
// never handed to another thread, and a request no session holds is answered
// fail-closed by the unrouted handler instead of blocking the agent.

import { EventEmitter } from 'node:events'

export const DEFAULT_MAX_SESSIONS = 6
export const DEFAULT_LIFETIME_SESSIONS = 12

/**
 * @param {object} options
 * @param {object} options.rpc connection from createStdioRpc
 * @param {string|null} [options.key] process-sharing key; null means never shared
 * @param {string} [options.source] native-log label
 * @param {number} [options.maxSessions] live sessions allowed at once
 * @param {number} [options.lifetimeSessions] sessions ever opened on this process
 * @param {(msg: object, send: Function) => void} [options.onUnrouted] fail-closed answer for unheld requests
 */
export function createAcpHost({
  rpc,
  key = null,
  source = 'acp',
  maxSessions = DEFAULT_MAX_SESSIONS,
  lifetimeSessions = DEFAULT_LIFETIME_SESSIONS,
  onUnrouted,
  log,
} = {}) {
  if (!rpc || typeof rpc.request !== 'function') throw new TypeError('ACP_HOST_RPC_REQUIRED')
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) throw new TypeError('ACP_HOST_SESSION_LIMIT_INVALID')
  const links = new Set()
  /** The folder each thread owns for this process's life. */
  const folders = new Map()
  const once = new Map()
  const events = new EventEmitter()
  let opened = 0
  let lastOut = null
  let draining = false

  const refuseUnrouted = (msg, send) => {
    if (typeof onUnrouted === 'function') { onUnrouted(msg, send); return }
    // Default deny: an unanswered server request blocks the agent, so the
    // answer is always a refusal, never silence.
    if (typeof msg?.id === 'number' || typeof msg?.id === 'string') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })
    }
  }

  const route = classified => {
    const sessionId = classified?.params?.sessionId
    if (typeof sessionId === 'string') {
      for (const link of links) if (link.sessionId === sessionId) return link.threadId
      // A closed session's late update never reaches another thread.
      return null
    }
    // Pre-session and client-side traffic (fs/terminal carry no sessionId):
    // only unambiguous when exactly one session is linked.
    return links.size === 1 ? links.values().next().value.threadId : null
  }

  const linkFor = classified => {
    const owner = route(classified)
    if (owner === null) return null
    for (const link of links) if (link.threadId === owner) return link
    return null
  }

  rpc.events?.on('rpc-request', classified => {
    const link = linkFor(classified)
    if (link && !link.closed && link.inbound) { link.inbound.request(classified); return }
    refuseUnrouted(classified.raw, obj => rpc.respond(classified.id, obj?.result ?? obj))
  })
  rpc.events?.on('rpc-notification', classified => {
    const link = linkFor(classified)
    if (link && !link.closed && link.inbound) link.inbound.notification(classified)
  })

  const listening = () => (lastOut ? [...links, lastOut] : [...links])

  const link = {
    get size() { return links.size },
    get opened() { return opened },
    get draining() { return draining },
    set draining(value) { draining = value === true },
    get dead() { return rpc.closed },
    /** Room for one more session: alive, not draining, under both session caps. */
    accepts(threadId, folder) {
      const owner = folders.get(folder)
      return !rpc.closed && !draining && links.size < maxSessions && opened < lifetimeSessions
        && (owner === undefined || owner === threadId)
    },
    /** Create a link. `folder` binds one workspace to one thread for the process's life. */
    open(threadId, folder = threadId) {
      if (typeof threadId !== 'string' || !threadId) throw new TypeError('ACP_HOST_THREAD_REQUIRED')
      if (!this.accepts(threadId, folder)) throw new Error('ACP_HOST_REFUSES_SESSION')
      folders.set(folder, threadId)
      opened++
      const entry = {
        threadId,
        sessionId: null,
        inbound: null,
        closed: false,
        request: (method, params, options) => rpc.request(method, params, { ...options, owner: threadId }),
        notify: (method, params) => rpc.notify(method, params),
        respond: (id, result) => rpc.respond(id, result),
        respondError: (id, code, message, data) => rpc.respondError(id, code, message, data),
        close: () => {
          if (entry.closed) return
          entry.closed = true
          rpc.failOwner?.(threadId, Object.assign(new Error('ACP session closed'), { acpSessionClosed: true }))
          links.delete(entry)
          if (!links.size) lastOut = entry
        },
      }
      links.add(entry)
      log?.({ event: 'acp.session-linked', source, threadId })
      return entry
    },
    /** The last thread to leave still hears the process end, so its turn settles. */
    listening,
    /** Runs `start` once per process (initialize, authenticate); a failure lets the next try. */
    once(name, start) {
      let running = once.get(name)
      if (!running) {
        running = Promise.resolve().then(start)
        once.set(name, running)
        running.catch(() => { if (once.get(name) === running) once.delete(name) })
      }
      return running
    },
    close(error) {
      draining = true
      for (const entry of [...links]) entry.close()
      rpc.close?.(error?.message ?? 'host-closed')
    },
    events,
    rpc,
    key,
    source,
  }
  return link
}
