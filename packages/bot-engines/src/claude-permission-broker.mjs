// Host-side permission/question broker for the Claude conversation engine.
//
// Adapted from OpenMausBot server/drivers/claude.ts createPermissionBroker at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
// Wire protocol (newline-delimited JSON on a local pipe, engine side is the server):
//   child -> {t:'ask', id, kind:'permission'|'question', tool, input}
//   host  -> {t:'answer', id, behavior:'allow'|'deny'|'answer', message, source, always?}
// Duplicate ask ids, asks after close and unanswered permission asks all fail CLOSED.

import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { chmod, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBrokerAsk, brokerAnswer } from './claude-protocol.mjs'

const DENY_TIMEOUT_NOTE = 'Host: nobody answered this permission request in time. Skip this action and finish what you can without it.'
const DUPLICATE_ASK_ID_NOTE = 'Host: duplicate ask id — skipping this request.'
const SYSTEM_ENDED_QUESTION = 'Host: the turn is ending — wrap up.'
const SYSTEM_ENDED_DENY = 'Host: the turn ended'

export function brokerPipeCandidates(home) {
  if (process.platform === 'win32') {
    const base = `\\\\.\\pipe\\dsh-claude-${randomBytes(9).toString('hex')}`
    return [base, `${base}-r`]
  }
  return [join(home, 'tmp', `broker-${randomBytes(6).toString('hex')}.sock`)]
}

/**
 * @param {object} options
 * @param {string[]} options.pipeCandidates bind order
 * @param {(ask: {id, kind, tool, input}) => void} options.onAsk
 * @param {(resolved: {id, kind, tool, behavior, source}) => void} options.onResolve
 * @param {() => boolean} [options.isActive] late asks fail closed when false
 * @param {number} [options.timeoutMs] unanswered permission asks deny after this
 */
export async function createPermissionBroker({ pipeCandidates, onAsk, onResolve, isActive, timeoutMs = 15 * 60_000 }) {
  if (!Array.isArray(pipeCandidates) || !pipeCandidates.length) throw new TypeError('BROKER_PIPES_REQUIRED')
  const pending = new Map()
  let closed = false
  let boundPath = null
  let server = null
  const connections = new Set()

  const connectionHandler = connection => {
    connections.add(connection)
    connection.on('error', () => {})
    connection.setEncoding('utf8')
    let buffer = ''
    connection.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        let message
        try { message = JSON.parse(line) } catch { continue }
        const ask = parseBrokerAsk(message)
        if (!ask) continue
        const reply = value => { try { connection.write(`${JSON.stringify(value)}\n`) } catch {} }
        if (closed) { reply(brokerAnswer(ask.id, ask.kind === 'question' ? 'answer' : 'deny', ask.kind === 'question' ? SYSTEM_ENDED_QUESTION : SYSTEM_ENDED_DENY, 'system')); continue }
        if (isActive && !isActive()) { reply(brokerAnswer(ask.id, ask.kind === 'question' ? 'answer' : 'deny', ask.kind === 'question' ? SYSTEM_ENDED_QUESTION : SYSTEM_ENDED_DENY, 'system')); continue }
        if (pending.has(ask.id)) { reply(brokerAnswer(ask.id, 'deny', DUPLICATE_ASK_ID_NOTE, 'system')); continue }
        const finish = (behavior, message, source, always = false) => {
          if (!pending.delete(ask.id)) return
          if (timer) clearTimeout(timer)
          reply(brokerAnswer(ask.id, behavior, message, source, always))
          onResolve({ ...ask, behavior, source })
        }
        const timer = ask.kind === 'question' ? null : setTimeout(() => finish('deny', DENY_TIMEOUT_NOTE, 'timeout'), timeoutMs)
        timer?.unref()
        pending.set(ask.id, { ask, finish })
        onAsk(ask)
      }
    })
    connection.on('close', () => connections.delete(connection))
  }

  for (const candidate of pipeCandidates) {
    const attempt = createServer(connectionHandler)
    await unlink(candidate).catch(() => {})
    const outcome = await new Promise(resolve => {
      attempt.once('listening', () => resolve('listening'))
      attempt.once('error', error => resolve(error))
      attempt.listen(candidate)
    })
    if (outcome === 'listening' && process.platform !== 'win32') {
      try { await chmod(candidate, 0o600) } catch (error) {
        attempt.close()
        await unlink(candidate).catch(() => {})
        if (candidate === pipeCandidates[pipeCandidates.length - 1]) { server = null; boundPath = null; break }
        continue
      }
    }
    if (outcome === 'listening') { server = attempt; boundPath = candidate; break }
    if (candidate === pipeCandidates[pipeCandidates.length - 1]) break
  }
  // Fail closed: an unbound broker must never look usable.
  if (!server) throw new Error('PERMISSION_BROKER_UNBOUND')

  const drain = () => {
    for (const value of Array.from(pending.values())) {
      const { ask } = value
      value.finish(ask.kind === 'question' ? 'answer' : 'deny', ask.kind === 'question' ? SYSTEM_ENDED_QUESTION : SYSTEM_ENDED_DENY, 'system')
    }
  }

  return Object.freeze({
    pipePath: boundPath,
    /** Host-side decision. Returns false when the ask is unknown or the behavior does not fit its kind. */
    answer(askId, behavior, message, always = false) {
      const value = pending.get(askId)
      if (!value) return false
      if (value.ask.kind === 'question' ? behavior !== 'answer' : behavior === 'answer') return false
      value.finish(behavior, message, 'user', always && behavior === 'allow')
      return true
    },
    pause() { drain() },
    close() {
      if (closed) return
      closed = true
      drain()
      for (const connection of connections) connection.destroy()
      try { server.close() } catch {}
      if (process.platform !== 'win32') void unlink(boundPath).catch(() => {})
    },
    get pendingCount() { return pending.size },
    get closed() { return closed },
  })
}
