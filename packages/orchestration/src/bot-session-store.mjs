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

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const BOT_SESSION_SCHEMA = 1
export const MAX_MESSAGES = 2_000
export const MAX_MESSAGE_CHARS = 200_000
export const ROLES = Object.freeze(['system', 'user', 'assistant', 'tool'])

const fail = code => { const error = new Error(code); error.code = code; throw error }

const text = value => (typeof value === 'string' ? value : '')

const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value)

function emptySession(botId, now) {
  return { schemaVersion: BOT_SESSION_SCHEMA, botId, createdAt: now, updatedAt: now, turns: 0, messages: [], truncated: false }
}

function bounded(message) {
  const content = text(message.content)
  return {
    role: ROLES.includes(message.role) ? message.role : 'user',
    content: content.length > MAX_MESSAGE_CHARS ? `${content.slice(0, MAX_MESSAGE_CHARS)}\n[truncated]` : content,
    at: Number.isSafeInteger(message.at) ? message.at : 0,
    ...(typeof message.name === 'string' && message.name ? { name: message.name.slice(0, 128) } : {}),
    ...(message.toolCall ? { toolCall: message.toolCall } : {}),
  }
}

/** Validate a transcript read from disk; a newer schema is refused, never reinterpreted. */
export function parseSession(value, botId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_BOT_SESSION')
  if (value.schemaVersion !== BOT_SESSION_SCHEMA) fail(value.schemaVersion > BOT_SESSION_SCHEMA ? 'BOT_SESSION_SCHEMA_NEWER' : 'INVALID_BOT_SESSION')
  if (value.botId !== botId) fail('BOT_SESSION_MISMATCH')
  if (!Array.isArray(value.messages)) fail('INVALID_BOT_SESSION')
  return {
    schemaVersion: BOT_SESSION_SCHEMA,
    botId,
    createdAt: Number.isSafeInteger(value.createdAt) ? value.createdAt : 0,
    updatedAt: Number.isSafeInteger(value.updatedAt) ? value.updatedAt : 0,
    turns: Number.isSafeInteger(value.turns) && value.turns >= 0 ? value.turns : 0,
    truncated: value.truncated === true,
    messages: value.messages.map(bounded),
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
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(session))
    renameSync(temp, target)
    return session
  }

  return Object.freeze({
    /** Read one transcript without creating it. */
    get(botId) {
      return read(botId)
    },
    /** Append messages and advance the turn counter atomically. */
    append(botId, messages, { turn = false } = {}) {
      if (!Array.isArray(messages) || messages.length === 0) fail('INVALID_BOT_SESSION_APPEND')
      const session = read(botId)
      for (const message of messages) session.messages.push(bounded({ ...message, at: Number.isSafeInteger(message.at) ? message.at : now() }))
      if (session.messages.length > maxMessages) {
        session.messages.splice(0, session.messages.length - maxMessages)
        session.truncated = true
      }
      if (turn) session.turns += 1
      session.updatedAt = now()
      return write(session)
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
