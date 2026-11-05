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
export const MAX_ROUTINE_RUNS_PER_BOT = 200

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }
const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

const empty = () => ({ schemaVersion: BOT_ROUTINE_SCHEMA, bots: {} })
const copy = value => JSON.parse(JSON.stringify(value))

export function createBotRoutineStore({ dir, now = Date.now, file = null } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new TypeError('ROUTINE_STORE_REQUIRE_DIR')
  const path = file ?? join(dir, 'routines.json')
  const executionsFile = join(dir, 'routine-executions.json')

  const read = () => {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (!parsed || parsed.schemaVersion !== BOT_ROUTINE_SCHEMA || typeof parsed.bots !== 'object' || parsed.bots === null || Array.isArray(parsed.bots)) return empty()
      return parsed
    } catch {
      // A missing or unreadable file is an empty store, never a crash: routines are convenience.
      return empty()
    }
  }

  const write = state => {
    const target = path
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
    try { mkdirSync(dirname(target), { recursive: true }) } catch { /* already there */ }
    writeFileSync(temp, JSON.stringify(state))
    renameSync(temp, target)
  }

  const botKey = botId => {
    if (typeof botId !== 'string' || !BOT_ID.test(botId)) fail('ROUTINE_BOT_ID_INVALID')
    return botId
  }

  // Execution uncertainty is authority, unlike an optional routine draft. Never repair this
  // journal as empty: doing so could repeat inputs which the remote computer already applied.
  const readRuns = () => {
    if (!existsSync(executionsFile)) return { schemaVersion: 1, bots: {} }
    let state
    try { state = JSON.parse(readFileSync(executionsFile, 'utf8')) } catch { fail('ROUTINE_RUN_STORE_CORRUPT') }
    if (!state || state.schemaVersion !== 1 || !state.bots || Array.isArray(state.bots) || typeof state.bots !== 'object') fail('ROUTINE_RUN_STORE_CORRUPT')
    for (const [botId, rows] of Object.entries(state.bots)) {
      if (!BOT_ID.test(botId) || !Array.isArray(rows) || rows.some(row => !row || !BOT_ID.test(row.runId ?? '') || !Array.isArray(row.evidence)
        || !['running', 'succeeded', 'failed', 'cancelled', 'unknown'].includes(row.status))) fail('ROUTINE_RUN_STORE_CORRUPT')
    }
    return state
  }
  const writeRuns = state => {
    mkdirSync(dirname(executionsFile), { recursive: true })
    const temp = `${executionsFile}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(state)); renameSync(temp, executionsFile)
  }
  const changeRun = (botId, runId, change) => {
    const state = readRuns(), key = botKey(botId), rows = Object.hasOwn(state.bots, key) ? state.bots[key] : [], row = rows.find(value => value.runId === runId)
    if (!row) fail('ROUTINE_RUN_NOT_FOUND')
    change(row); row.updatedAt = now(); writeRuns(state); return copy(row)
  }

  return Object.freeze({
    file: path,
    executionsFile,

    /** Every saved routine for one Bot, newest last. Steps are returned as stored. */
    list(botId) {
      const state = read()
      const key = botKey(botId), rows = Object.hasOwn(state.bots, key) ? state.bots[key] : []
      return Array.isArray(rows) ? rows.flatMap(row => {
        try { return typeof row.id === 'string' && BOT_ID.test(row.id) ? [{ ...normalizeRoutine(row), id: row.id, createdAt: row.createdAt }] : [] } catch { return [] }
      }).map(copy) : []
    },

    /** Save a validated routine; the id is minted here so a caller cannot pick one. */
    save(botId, routine) {
      const key = botKey(botId)
      const value = normalizeRoutine(routine)
      const state = read()
      const rows = Object.hasOwn(state.bots, key) && Array.isArray(state.bots[key]) ? state.bots[key] : []
      if (rows.length >= MAX_ROUTINES_PER_BOT) fail('ROUTINE_LIMIT', `每个 Bot 最多保存 ${MAX_ROUTINES_PER_BOT} 个 routine。`)
      const record = { ...value, id: `routine-${randomUUID()}`, createdAt: now() }
      state.bots[key] = [...rows, record]
      write(state)
      return copy(record)
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
      const rows = Object.hasOwn(state.bots, key) && Array.isArray(state.bots[key]) ? state.bots[key] : []
      const next = rows.filter(row => row.id !== id)
      if (next.length === rows.length) fail('ROUTINE_NOT_FOUND', `没有这个 routine：${String(id)}`)
      state.bots[key] = next
      write(state)
      return { removed: true }
    },

    /** Steps in storage always satisfy the routine format; this proves it to a caller. */
    inspect(botId) {
      return this.list(botId).map(row => ({ id: row.id, name: row.name, steps: row.steps.length, valid: (() => {
        try { normalizeRoutine(row); return true } catch { return false }
      })(), withinLimit: row.steps.length <= MAX_ROUTINE_STEPS, createdAt: row.createdAt,
      demonstrated: row.recording?.source === 'desktop-session', display: row.recording?.display ?? null }))
    },

    beginRun(botId, { routineId, machineId, rootId }) {
      const key = botKey(botId), state = readRuns(), rows = Object.hasOwn(state.bots, key) ? state.bots[key] : []
      if (![routineId, machineId, rootId].every(value => typeof value === 'string' && BOT_ID.test(value))) fail('ROUTINE_RUN_INVALID')
      if (rows.some(row => row.machineId === machineId && (row.status === 'running' || row.status === 'unknown' && !row.resolvedAt))) fail('ROUTINE_RECONCILIATION_REQUIRED')
      while (rows.length >= MAX_ROUTINE_RUNS_PER_BOT) {
        const removable = rows.findIndex(row => row.status !== 'running' && (row.status !== 'unknown' || row.resolvedAt))
        if (removable < 0) fail('ROUTINE_RUN_LIMIT')
        rows.splice(removable, 1)
      }
      const row = { runId: `routine-run-${randomUUID()}`, taskId: `routine-task-${randomUUID()}`, attemptId: `attempt-${randomUUID()}`,
        botId: key, routineId, machineId, rootId, status: 'running', steps: [], stoppedAt: 0, evidence: [], startedAt: now(), updatedAt: now() }
      state.bots[key] = [...rows, row]; writeRuns(state); return copy(row)
    },
    updateRun(botId, runId, patch) {
      const allowed = ['status', 'steps', 'stoppedAt', 'code', 'error', 'sessionId', 'display', 'cleanup', 'finishedAt']
      if (!patch || Object.keys(patch).some(key => !allowed.includes(key))
        || patch.status !== undefined && !['running', 'succeeded', 'failed', 'cancelled', 'unknown'].includes(patch.status)) fail('ROUTINE_RUN_INVALID')
      return changeRun(botId, runId, row => Object.assign(row, copy(patch)))
    },
    inputSent(botId, runId, { id, stepIndex, sessionId, sentAt, eventType }) {
      return changeRun(botId, runId, row => {
        if (row.status !== 'running' || row.evidence.some(item => item.inputId === id)) fail('ROUTINE_INPUT_ID_REUSED')
        row.evidence.push({ operationId: `operation-${randomUUID()}`, inputId: id, stepIndex, sessionId, sentAt, eventType, status: 'sending' })
      })
    },
    inputOutcome(botId, runId, { id, status, acknowledgedAt, code }) {
      return changeRun(botId, runId, row => {
        const item = row.evidence.find(value => value.inputId === id)
        if (!item || !['acknowledged', 'failed', 'cancelled', 'unknown'].includes(status)) fail('ROUTINE_RUN_INVALID')
        Object.assign(item, { status, ...(acknowledgedAt !== undefined ? { acknowledgedAt } : {}), ...(code ? { code } : {}) })
      })
    },
    listRuns(botId) { const state = readRuns(), key = botKey(botId); return copy(Object.hasOwn(state.bots, key) ? state.bots[key] : []) },
    getRun(botId, runId) {
      const row = this.listRuns(botId).find(value => value.runId === runId)
      if (!row) fail('ROUTINE_RUN_NOT_FOUND')
      return row
    },
    recoverInterruptedRuns() {
      const state = readRuns(); let changed = false
      for (const rows of Object.values(state.bots)) for (const row of rows) if (row.status === 'running') {
        row.status = 'unknown'; row.code = 'ROUTINE_HOST_INTERRUPTED'; row.error = '宿主中断，必须检查电脑上的实际结果。'
        row.finishedAt = now(); row.updatedAt = now()
        for (const item of row.evidence) if (item.status === 'sending') item.status = 'unknown'
        changed = true
      }
      if (changed) writeRuns(state)
    },
    resolveRun(botId, runId, note) {
      if (typeof note !== 'string' || !note.trim() || note.length > 1_000) fail('ROUTINE_RESOLUTION_NOTE_REQUIRED')
      return changeRun(botId, runId, row => {
        if (row.status !== 'unknown') fail('ROUTINE_RESOLUTION_NOT_REQUIRED')
        row.resolvedAt = now(); row.resolution = { kind: 'owner-inspected', note: note.trim() }
      })
    },
  })
}

/** The store lives beside the Bot libraries unless the caller says otherwise. */
export function routineStoreDir(stateDir) {
  return join(stateDir, 'routines')
}

export { existsSync }
