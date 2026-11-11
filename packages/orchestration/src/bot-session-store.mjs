/**
 * A Bot-owned conversation store.
 *
 * The product used to keep every Bot conversation inside the Harness session service. This store
 * is the first piece of an independent runtime: it owns the transcript, the turn counter and the
 * tool calls a Bot made, and it depends on nothing but a directory. It is additive — nothing
 * mounts it unless the independent loop is enabled — so the existing integration keeps working.
 *
 * Design rules, intentionally strict:
 * - One file per Bot, written atomically (temp file + rename); a crash never leaves half a turn.
 * - Bounded: message text and message count are capped, and old turns are dropped oldest-first
 *   with a marker so a reader can tell the transcript was truncated.
 * - Versioned: a store written by a newer schema is refused instead of guessed at.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { LEGACY_CONTEXT, MAX_CONTEXTS, contextIdOk, contextRequestOk, contextFields, contextView } from './independent-context-state.mjs'

export const BOT_SESSION_SCHEMA = 1
export const MAX_MESSAGES = 2_000
export const MAX_MESSAGE_CHARS = 200_000
export const ROLES = Object.freeze(['system', 'user', 'assistant', 'tool'])

const fail = code => { const error = new Error(code); error.code = code; throw error }

const text = value => (typeof value === 'string' ? value : '')

const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value)

function emptySession(botId, now) {
  return { schemaVersion: BOT_SESSION_SCHEMA, botId, createdAt: now, updatedAt: now, turns: 0, messages: [], truncated: false,
    ...contextFields({ createdAt: 0 }) }
}

function bounded(message) {
  const content = text(message.content)
  const model = message.modelSource
  if (model !== undefined && (!model || model.kind !== 'model' ||
    ![model.provider, model.model].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value)))) fail('INVALID_BOT_MESSAGE_SOURCE')
  if (message.toolCallId !== undefined && (typeof message.toolCallId !== 'string' || !message.toolCallId || message.toolCallId.length > 256)) fail('INVALID_BOT_TOOL_CALL_ID')
  const calls = message.toolCalls
  if (calls !== undefined && (!Array.isArray(calls) || calls.length > 8 || calls.some(call =>
    !call || typeof call.id !== 'string' || !call.id || call.id.length > 256 || typeof call.name !== 'string' || !call.name || call.name.length > 128 ||
    !call.args || typeof call.args !== 'object' || Array.isArray(call.args) || JSON.stringify(call.args).length > MAX_MESSAGE_CHARS) ||
    new Set(calls.map(call => call.id)).size !== calls.length)) fail('INVALID_BOT_TOOL_CALLS')
  return {
    contextId: message.contextId ?? LEGACY_CONTEXT,
    role: ROLES.includes(message.role) ? message.role : 'user',
    content: content.length > MAX_MESSAGE_CHARS ? `${content.slice(0, MAX_MESSAGE_CHARS)}\n[truncated]` : content,
    at: Number.isSafeInteger(message.at) ? message.at : 0,
    ...(typeof message.name === 'string' && message.name ? { name: message.name.slice(0, 128) } : {}),
    ...(message.toolCall ? { toolCall: message.toolCall } : {}),
    ...(typeof message.messageId === 'string' && message.messageId ? { messageId: message.messageId.slice(0, 256) } : {}),
    ...(model ? { modelSource: { kind: 'model', provider: model.provider, model: model.model } } : {}),
    ...(calls ? { toolCalls: structuredClone(calls) } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.isError === true ? { isError: true } : {}),
  }
}

/** Validate a transcript read from disk; a newer schema is refused, never reinterpreted. */
export function parseSession(value, botId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_BOT_SESSION')
  if (value.schemaVersion !== BOT_SESSION_SCHEMA) fail(value.schemaVersion > BOT_SESSION_SCHEMA ? 'BOT_SESSION_SCHEMA_NEWER' : 'INVALID_BOT_SESSION')
  if (value.botId !== botId) fail('BOT_SESSION_MISMATCH')
  if (!Array.isArray(value.messages)) fail('INVALID_BOT_SESSION')
  if (value.messages.some(message => message.contextId !== undefined && !contextIdOk(message.contextId))) fail('INVALID_BOT_CONTEXT')
  return {
    schemaVersion: BOT_SESSION_SCHEMA,
    botId,
    createdAt: Number.isSafeInteger(value.createdAt) ? value.createdAt : 0,
    updatedAt: Number.isSafeInteger(value.updatedAt) ? value.updatedAt : 0,
    turns: Number.isSafeInteger(value.turns) && value.turns >= 0 ? value.turns : 0,
    truncated: value.truncated === true,
    ...contextFields(value),
    messages: value.messages.map((message, index) => bounded({ ...message,
      messageId: message.messageId ?? `legacy-${createHash('sha256').update(JSON.stringify([botId, index, message])).digest('hex')}` })),
  }
}

/**
 * @param {{ dir: string, now?: () => number, maxMessages?: number }} options
 */
export function openBotSessionStore({ dir, now = Date.now, maxMessages = MAX_MESSAGES } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new TypeError('BOT_SESSION_DIR_REQUIRED')
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 10 || maxMessages > MAX_MESSAGES) throw new TypeError('INVALID_BOT_SESSION_LIMIT')
  const fileOf = botId => {
    if (!idOk(botId)) fail('INVALID_BOT_ID')
    return join(dir, `${botId}.json`)
  }
  const read = botId => {
    try { return parseSession(JSON.parse(readFileSync(fileOf(botId), 'utf8')), botId) }
    catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return emptySession(botId, now())
      throw error
    }
  }
  const write = session => {
    mkdirSync(dirname(fileOf(session.botId)), { recursive: true })
    const target = fileOf(session.botId)
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
    let descriptor, renamed = false
    try {
      descriptor = openSync(temp, 'wx', 0o600)
      writeFileSync(descriptor, JSON.stringify(session)); fsyncSync(descriptor)
      closeSync(descriptor); descriptor = undefined
      renameSync(temp, target); renamed = true
      const verified = read(session.botId)
      if (JSON.stringify(verified) !== JSON.stringify(parseSession(session, session.botId))) fail('BOT_SESSION_WRITE_NOT_CONFIRMED')
      return verified
    } catch (error) {
      // Do not overwrite a possibly committed file with an old snapshot.
      error.outcome = renamed ? 'unknown' : 'refused'
      throw error
    } finally { if (descriptor !== undefined) closeSync(descriptor) }
  }
  // Exclusive filesystem admission covers the read-modify-rename in every process.
  // A stale lock is refused; guessing that its owner died could overwrite a live writer.
  const mutate = (botId, change) => {
    const target = fileOf(botId)
    mkdirSync(dirname(target), { recursive: true })
    let lock
    try { lock = openSync(`${target}.lock`, 'wx', 0o600) }
    catch (error) { if (error.code === 'EEXIST') fail('BOT_SESSION_WRITE_BUSY'); throw error }
    try { return change(read(botId)) }
    finally { closeSync(lock); unlinkSync(`${target}.lock`) }
  }

  return Object.freeze({
    /** Read one transcript without creating it. */
    get(botId) {
      return read(botId)
    },
    /** Append messages and advance the turn counter atomically. */
    append(botId, messages, { turn = false } = {}) {
      if (!Array.isArray(messages) || messages.length === 0) fail('INVALID_BOT_SESSION_APPEND')
      return mutate(botId, session => {
      if (session.contextReset) fail('INDEPENDENT_CONTEXT_PENDING_RECONCILIATION')
      for (const message of messages) session.messages.push(bounded({ ...message,
        contextId: session.contextId,
        ...(!message.messageId ? { messageId: randomUUID() } : {}),
        at: Number.isSafeInteger(message.at) ? message.at : now() }))
      if (session.messages.length > maxMessages) {
        session.messages.splice(0, session.messages.length - maxMessages)
        session.truncated = true
      }
      if (turn) session.turns += 1
      session.updatedAt = now()
      return write(session)
      })
    },
    contextOf: botId => contextView(read(botId)),
    beginContext(botId, { requestKey, contextId, expectedContextId } = {}) {
      if (!contextRequestOk(requestKey) || !contextIdOk(contextId)) fail('INVALID_BOT_CONTEXT_RESET')
      return mutate(botId, session => {
        const existing = session.contexts.find(row => row.requestKey === requestKey)
        if (existing) {
          if (existing.contextId !== contextId) fail('INDEPENDENT_CONTEXT_REQUEST_CONFLICT')
          return session
        }
        if (session.contextReset) fail('INDEPENDENT_CONTEXT_PENDING_RECONCILIATION')
        if (contextId === session.contextId || session.messages.some(row => row.contextId === contextId)) fail('INDEPENDENT_CONTEXT_REQUEST_CONFLICT')
        if (expectedContextId !== undefined && session.contextId !== expectedContextId) fail('INDEPENDENT_CONTEXT_STALE')
        session.contextReset = { requestKey, contextId, previousContextId: session.contextId, createdAt: now() }
        session.updatedAt = now()
        return write(session)
      })
    },
    commitContext(botId, { requestKey, contextId } = {}) {
      return mutate(botId, session => {
        const existing = session.contexts.find(row => row.requestKey === requestKey)
        if (existing) {
          if (existing.contextId !== contextId) fail('INDEPENDENT_CONTEXT_REQUEST_CONFLICT')
          return session
        }
        const intent = session.contextReset
        if (!intent || intent.requestKey !== requestKey || intent.contextId !== contextId) fail('INDEPENDENT_CONTEXT_REQUEST_CONFLICT')
        const sequence = Math.max(...session.contexts.map(row => row.sequence)) + 1
        if (!Number.isSafeInteger(sequence)) fail('INDEPENDENT_CONTEXT_HISTORY_LIMIT')
        session.contexts.push({ ...intent, sequence, createdAt: now() })
        if (session.contexts.length > MAX_CONTEXTS) { session.contexts = session.contexts.slice(-MAX_CONTEXTS); session.contextsTruncated = true }
        session.contextId = contextId
        delete session.contextReset
        session.updatedAt = now()
        return write(session)
      })
    },
    abortContext(botId, { requestKey, contextId } = {}) {
      return mutate(botId, session => {
        if (!session.contextReset || session.contextReset.requestKey !== requestKey || session.contextReset.contextId !== contextId) fail('INDEPENDENT_CONTEXT_REQUEST_CONFLICT')
        delete session.contextReset
        session.updatedAt = now()
        return write(session)
      })
    },
    contextCommitted(botId, requestKey, contextId) {
      const session = read(botId)
      return session.contexts.some(row => row.requestKey === requestKey && row.contextId === contextId)
    },
    /** Forget one Bot's transcript (used when a Bot is deleted, never on a transient error). */
    remove(botId) {
      const target = fileOf(botId)
      try { renameSync(target, `${target}.deleted`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
      return { removed: true }
    },
    /** Cheap inventory for a panel: one row per Bot, no message bodies. */
    list(botIds = []) {
      return (Array.isArray(botIds) ? botIds : []).map(botId => {
        const session = read(botId)
        return { botId, turns: session.turns, messages: session.messages.length, updatedAt: session.updatedAt, truncated: session.truncated }
      })
    },
  })
}
