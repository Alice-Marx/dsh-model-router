/**
 * Saved routines: the ones a Bot can run again without being shown again.
 *
 * The store keeps one JSON document per Host and writes it atomically, so a crash mid-save leaves
 * the previous file intact rather than a half-written list. Everything it hands out has already
 * been validated by the routine format, and it refuses to grow without bound: a Bot may keep a
 * handful of routines, each of them already bounded.
 */

import { readFileSync, renameSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeRoutine, MAX_ROUTINE_STEPS } from './bot-routine.mjs'

export const BOT_ROUTINE_SCHEMA = 1
export const MAX_ROUTINES_PER_BOT = 50

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }
const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

const empty = () => ({ schemaVersion: BOT_ROUTINE_SCHEMA, bots: {} })

export function createBotRoutineStore({ dir, now = Date.now, file = null } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new TypeError('ROUTINE_STORE_REQUIRE_DIR')
  const path = file ?? join(dir, 'routines.json')

  const read = () => {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (!parsed || parsed.schemaVersion !== BOT_ROUTINE_SCHEMA || typeof parsed.bots !== 'object' || parsed.bots === null) return empty()
      return parsed
    } catch {
      // A missing or unreadable file is an empty store, never a crash: routines are convenience.
      return empty()
    }
  }

  const write = state => {
    const target = path
    const temp = `${target}.${process.pid}.${now()}.tmp`
    try { mkdirSync(dirname(target), { recursive: true }) } catch { /* already there */ }
    writeFileSync(temp, JSON.stringify(state))
    renameSync(temp, target)
  }

  const botKey = botId => {
    if (typeof botId !== 'string' || !BOT_ID.test(botId)) fail('ROUTINE_BOT_ID_INVALID')
    return botId
  }

  return Object.freeze({
    file: path,

    /** Every saved routine for one Bot, newest last. Steps are returned as stored. */
    list(botId) {
      const state = read()
      const rows = state.bots[botKey(botId)] ?? []
      return Array.isArray(rows) ? rows.map(row => ({ ...row, steps: row.steps.map(step => ({ ...step })) })) : []
    },

    /** Save a validated routine; the id is minted here so a caller cannot pick one. */
    save(botId, routine) {
      const key = botKey(botId)
      const value = normalizeRoutine(routine)
      const state = read()
      const rows = Array.isArray(state.bots[key]) ? state.bots[key] : []
      if (rows.length >= MAX_ROUTINES_PER_BOT) fail('ROUTINE_LIMIT', `每个 Bot 最多保存 ${MAX_ROUTINES_PER_BOT} 个 routine。`)
      const record = { id: `routine-${randomUUID()}`, name: value.name, ...(value.description ? { description: value.description } : {}), steps: value.steps, createdAt: now() }
      state.bots[key] = [...rows, record]
      write(state)
      return { ...record, steps: record.steps.map(step => ({ ...step })) }
    },

    /** One routine by id, or a refusal that names the id rather than an empty object. */
    get(botId, id) {
      const rows = this.list(botId)
      const found = rows.find(row => row.id === id)
      if (!found) fail('ROUTINE_NOT_FOUND', `没有这个 routine：${String(id)}`)
      return found
    },

    remove(botId, id) {
      const key = botKey(botId)
      const state = read()
      const rows = Array.isArray(state.bots[key]) ? state.bots[key] : []
      const next = rows.filter(row => row.id !== id)
      if (next.length === rows.length) fail('ROUTINE_NOT_FOUND', `没有这个 routine：${String(id)}`)
      state.bots[key] = next
      write(state)
      return { removed: true }
    },

    /** Steps in storage always satisfy the routine format; this proves it to a caller. */
    inspect(botId) {
      return this.list(botId).map(row => ({ id: row.id, name: row.name, steps: row.steps.length, valid: (() => {
        try { normalizeRoutine({ name: row.name, steps: row.steps }); return true } catch { return false }
      })(), withinLimit: row.steps.length <= MAX_ROUTINE_STEPS, createdAt: row.createdAt }))
    },
  })
}

/** The store lives beside the Bot libraries unless the caller says otherwise. */
export function routineStoreDir(stateDir) {
  return join(stateDir, 'routines')
}

export { existsSync }
