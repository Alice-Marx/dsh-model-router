/**
 * The Bot data engine: one SQLite database per Bot, run in a fixed child
 * process, addressed only by a validated Bot id. It is the single place the
 * tools and the panel's actions meet SQLite, and the single place every bound
 * and every cancellation is enforced.
 *
 * Isolation and authority:
 *  - A Bot's database path is computed by the Host (`dbPathFor(botId)`) from a
 *    validated id; the engine never accepts a path, a target Bot, an endpoint
 *    or a program from a caller. The model's tool call derives its Bot id from
 *    the live session (botIdFor); the panel's owner action names the Bot the
 *    signed-in person selected.
 *  - Data enters only through a bounded controlled read (`libraryReader`) or
 *    bounded inline content. No OS paths, URLs, DB connection strings.
 *  - Every statement is gated (bot-data-sql) before it reaches the child; the
 *    child runs a single prepared statement with extension loading disabled.
 *  - A query that exceeds its wall clock is cancelled by SIGKILLing the child;
 *    an unknown outcome is never replayed and the next call reopens the DB.
 *  - Replacing a table (load, materialise) is ONE transaction, so a failed
 *    replace leaves the previous table in place instead of a half-written one.
 *  - Only DATA_LIMITS.activeWorkersMax Bot workers are resident AT ANY MOMENT,
 *    counting workers that are starting or going away but have not confirmed
 *    their exit. A Bot without a free slot is refused with engine_unavailable
 *    (retryable) — nothing is queued and no write is replayed. An idle slot may
 *    be handed over, but only once that worker's exit is CONFIRMED.
 *  - A worker that was asked to exit and never confirmed it keeps its slot and
 *    this Bot refuses to open another one until the exit really happens;
 *    closeAll reports such a Bot as unconfirmed instead of claiming success.
 *  - Steps that write the database or the sheet metadata are serialized per Bot,
 *    so concurrent steps cannot interleave and lose a source entry or a card.
 *  - Only DATA_LIMITS.activeWorkersMax Bot workers stay resident; the least
 *    recently used IDLE worker is closed, and a closed/killed worker is awaited
 *    to a real exit before a new one opens the same file.
 *
 * The engine is created with injected Host services, so it is testable against
 * an isolated tmp directory and the real better-sqlite3 without any user data.
 */

import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  DATA_LIMITS, DataFailure, IDENT, assertBotId, dataError, quoteIdent, sanitizeDataMessage, tableNameFrom,
} from './bot-data-surface.mjs'
import { boundRows, gateSql } from './bot-data-sql.mjs'
import { parseDelimited, parseJsonText, toCsv, boundExport } from './bot-data-io.mjs'
import { compileChart, shapeChart } from './bot-data-chart.mjs'

const WORKER_URL = fileURLToPath(new URL('./bot-data-worker.mjs', import.meta.url))
const OPEN_TIMEOUT_MS = DATA_LIMITS.openTimeoutMs
const IDENTIFIER_LIKE = /^\s*("[^"]+"|[A-Za-z_][\w$]*)(\.("[^"]+"|[A-Za-z_][\w$]*)){0,2}\s*$/
// SQLite has no user schemas, so internal result/card tables live in `main` under a
// prefix `tableNameFrom` can never produce (it strips leading underscores). Loaded
// tables therefore never collide with, and never leak as, internal result tables.
const INTERNAL_PREFIX = '__mb_'
const cardTable = cardId => `${INTERNAL_PREFIX}card_${cardId}`
const namedTable = name => `${INTERNAL_PREFIX}q_${tableNameFrom(name)}`
const isInternal = name => name.startsWith(INTERNAL_PREFIX)

/**
 * The fixed worker's environment: the smallest set a plain Node child needs on
 * every platform, plus the marker that makes this file the worker entry. Nothing
 * from the Host's environment (credentials, endpoints, NODE_OPTIONS) crosses
 * over, so the child cannot be re-pointed by the environment it inherits.
 */
const WORKER_ENV_KEYS = Object.freeze([
  'Path', 'PATH', 'SYSTEMROOT', 'SystemRoot', 'windir', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL',
])
const workerEnv = () => {
  const env = { MB_DATA_WORKER: '1' }
  for (const key of WORKER_ENV_KEYS) if (typeof process.env[key] === 'string' && process.env[key] !== '') env[key] = process.env[key]
  return env
}

const fail = (code, message, extra = {}) => { throw new DataFailure(dataError(code, message, extra)) }
const KNOWN_CODES = new Set(['invalid_input', 'source_not_found', 'source_unsupported', 'sql_error', 'write_refused', 'table_not_found', 'spec_invalid', 'card_not_found', 'output_too_large', 'timeout', 'cancelled', 'engine_unavailable', 'import_failed', 'dataset_conflict', 'unauthorized'])
const workerFailure = (error, secrets = []) => {
  const code = KNOWN_CODES.has(error?.code) ? error.code : 'sql_error'
  return new DataFailure(dataError(code, sanitizeDataMessage(error?.message ?? error, secrets)))
}
const settle = (promise, timeoutMs) => Promise.race([
  promise.then(() => 'exited', () => 'exited'),
  new Promise(resolve => { const timer = setTimeout(() => resolve('timeout'), timeoutMs); timer.unref?.() }),
])
/** A per-key serial queue: the next job runs only after the previous one settles. */
const serialize = (locks, key, work) => {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.then(work, work)
  const settled = next.then(() => {}, () => {})
  locks.set(key, settled)
  settled.then(() => { if (locks.get(key) === settled) locks.delete(key) })
  return next
}

/** One Bot's child process and its request/timeout bookkeeping. */
class BotProcess {
  constructor(botId, dbPath, { forkImpl = fork, execPath = process.execPath, now = Date.now, limits = null }) {
    this.botId = botId
    this.dbPath = dbPath
    this.fork = forkImpl
    this.execPath = execPath
    this.now = now
    this.limits = limits
    this.child = null
    this.pending = new Map()
    this.nextId = 1
    this.lastUsed = 0
    this.exitPromise = null
    this.starting = null
    /** The current child's exit event has fired. */
    this.exited = false
    /** A child was asked to exit and never confirmed it: the slot stays taken. */
    this.exitUnconfirmed = false
    /** This worker is being retired or closed: it must not start another child. */
    this.retiring = false
  }

  /**
   * A fresh child only starts once the previous one has REALLY exited. If the
   * exit is not confirmed within the budget the old child keeps this Bot's slot
   * and no replacement is forked — a half-dead worker must never be doubled.
   */
  async spawn() {
    // The first dataset is allowed before any previous data or sheet exists.
    // This directory is Host-derived; no model supplies this filesystem path.
    try { await mkdir(dirname(this.dbPath), { recursive: true }) }
    catch { throw new DataFailure(dataError('engine_unavailable', 'The data storage directory could not be prepared. Check the Host storage settings.')) }
    if (this.exitUnconfirmed || this.retiring) {
      throw new DataFailure(dataError('engine_unavailable', 'This Bot is giving up its data worker, so no new worker is started for it.', { retryable: true, hint: 'The previous worker has not confirmed its exit; try again shortly.' }))
    }
    if (this.exitPromise) {
      const outcome = await settle(this.exitPromise, DATA_LIMITS.workerExitTimeoutMs)
      if (outcome !== 'exited') {
        this.exitUnconfirmed = true
        throw new DataFailure(dataError('engine_unavailable', 'The previous data worker never confirmed its exit, so no new worker is started for this Bot.', { retryable: true, hint: 'The worker is still going away; try again once it has exited.' }))
      }
      this.exitPromise = null
    }
    // Re-checked after the await: this Bot's slot may have been handed to
    // another Bot while we waited for the exit.
    if (this.retiring || this.exitUnconfirmed) {
      throw new DataFailure(dataError('engine_unavailable', 'This Bot is giving up its data worker, so no new worker is started for it.', { retryable: true, hint: 'The previous worker has not confirmed its exit; try again shortly.' }))
    }
    this.exited = false
    const pending = new Map()
    this.pending = pending
    this.nextId = 1
    const child = this.fork(WORKER_URL, [], {
      env: workerEnv(),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execPath: this.execPath,
      // A hidden window on Windows; the marker env var is what makes THIS file
      // the worker entry, never a path or a program from a caller.
      windowsHide: true,
      // The child's own JS heap is capped, so a runaway allocation dies in the
      // child instead of growing the Host.
      execArgv: [`--max-old-space-size=${DATA_LIMITS.workerHeapMb}`],
    })
    this.child = child
    this.lastUsed = this.now()
    this.exitPromise = new Promise(resolve => { child.on('exit', () => resolve('exited')) })
    // Each child's handlers close over THIS child's pending map, so a killed
    // child's exit never rejects the next child's in-flight request.
    child.on('message', message => {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.ok) entry.resolve(message.value)
      else entry.reject(workerFailure(message.error, [this.dbPath]))
    })
    const died = cause => {
      // Nothing in flight is ever replayed: every pending request fails with the
      // cause, and the next call opens a fresh database from the WAL.
      for (const [, entry] of pending) { clearTimeout(entry.timer); entry.reject(cause) }
      pending.clear()
      if (this.child === child) { this.child = null; this.pending = new Map() }
    }
    child.on('error', error => died(new DataFailure(dataError('engine_unavailable', `Data worker error: ${sanitizeDataMessage(error.message, [this.dbPath])}`))))
    child.on('exit', code => {
      // A real exit is the only thing that frees this Bot to start again.
      this.exited = true
      this.exitUnconfirmed = false
      died(new DataFailure(dataError('engine_unavailable', `Data worker exited unexpectedly (${code ?? 'signal'}).`)))
    })
    try {
      await this.request('open', { dbPath: this.dbPath, limits: this.limits }, OPEN_TIMEOUT_MS)
    } catch (error) {
      // A child that cannot open the database is not left connected: kill it so
      // the next call starts a fresh one.
      if (this.child === child) this.kill()
      throw error
    }
  }

  ensure() {
    this.lastUsed = this.now()
    if (this.child && this.child.connected) return Promise.resolve()
    if (this.starting) return this.starting
    const attempt = this.spawn()
    this.starting = attempt
    const forget = () => { if (this.starting === attempt) this.starting = null }
    attempt.then(forget, forget)
    return attempt
  }

  request(op, message, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.connected) return reject(new DataFailure(dataError('engine_unavailable', 'The data worker is not connected.')))
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // SIGKILL interrupts the native SQLite call a worker thread could not.
        this.kill()
        reject(new DataFailure(dataError('timeout', `The statement was cancelled after ${timeoutMs} ms.`, { retryable: true, hint: 'Narrow the query or aggregate first.' })))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      try { this.child.send({ id, op, ...message }) } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(workerFailure(error, [this.dbPath])) }
    })
  }

  /** Cancel everything in flight by killing the child; the next call reopens. */
  kill() {
    if (this.child) { try { this.child.kill('SIGKILL') } catch { /* already gone */ } }
    const cause = new DataFailure(dataError('cancelled', 'The statement was cancelled.'))
    for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(cause) }
    this.pending.clear()
    this.child = null
  }

  /**
   * May this Bot's slot be handed to another Bot? Only when it holds no
   * statement, is not starting, retiring or going away, and — if its worker is
   * gone — the exit was confirmed.
   */
  reclaimable() {
    if (this.starting !== null || this.retiring || this.exitUnconfirmed || this.pending.size > 0) return false
    return this.child === null ? this.exited === true : this.child.connected === true
  }

  /**
   * Give this Bot's slot up, but only once the child's exit is CONFIRMED.
   * Returns false when the exit is not confirmed, and then the slot stays taken
   * and this Bot refuses to reopen.
   */
  async retire() {
    this.retiring = true
    if (this.child === null) {
      if (this.exited !== true) this.exitUnconfirmed = true
      return this.exited === true
    }
    const exited = this.exitPromise ?? Promise.resolve('exited')
    this.kill()
    const confirmed = (await settle(exited, DATA_LIMITS.workerExitTimeoutMs)) === 'exited'
    if (!confirmed) {
      // The exit was not confirmed: this Bot keeps its slot and refuses to
      // reopen until the exit really happens.
      this.exitUnconfirmed = true
      this.retiring = false
    }
    return confirmed
  }

  /** Resolve only after the child process has actually exited; throw otherwise. */
  async close() {
    if (this.child === null && this.exitPromise === null) return
    this.retiring = true
    const exited = this.exitPromise ?? Promise.resolve('exited')
    this.kill()
    const outcome = await settle(exited, DATA_LIMITS.workerExitTimeoutMs)
    if (outcome !== 'exited') {
      // Not closed. The process keeps its slot and this Bot refuses to reopen
      // until the exit really happens.
      this.exitUnconfirmed = true
      this.retiring = false
      throw new DataFailure(dataError('engine_unavailable', 'The data worker did not confirm its exit, so this Bot is not reported as closed.', { retryable: true }))
    }
    this.exitPromise = null
  }
}

/** Atomic JSON write for a Bot's sheet (cards + sources metadata). */
async function writeSheet(file, sheet) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(sheet)}\n`, 'utf8')
  await rename(temp, file)
}

export function createDataEngine(options = {}) {
  const {
    dataDir,
    dbPathFor = botId => join(dataDir, `${botId}.sqlite`),
    sheetPathFor = botId => join(dataDir, `${botId}.sheet.json`),
    libraryReader = null,
    libraryWriter = null,
    forkImpl = fork,
    execPath = process.execPath,
    sqlTimeoutMs = DATA_LIMITS.sqlTimeoutMs,
    now = Date.now,
    limits = null,
  } = options
  if (typeof dataDir !== 'string' || dataDir === '') throw new TypeError('DATA_ENGINE_REQUIRE_DATA_DIR')

  const processes = new Map()
  const dbLocks = new Map()
  const sheetLocks = new Map()
  const workerLimits = { maxPageCount: DATA_LIMITS.dbMaxPageCount, hardHeapLimitBytes: DATA_LIMITS.dbHardHeapLimitBytes, softHeapLimitBytes: DATA_LIMITS.dbSoftHeapLimitBytes, ...(limits ?? {}) }
  // Admissions run one at a time, so two Bots asking for the last free slot at the
  // same moment cannot both take it.
  let admissionQueue = Promise.resolve()
  const enqueueAdmission = work => {
    const next = admissionQueue.then(work, work)
    admissionQueue = next.then(() => {}, () => {})
    return next
  }
  const busy = botId => new DataFailure(dataError('engine_unavailable', `Every data worker slot is in use (${DATA_LIMITS.activeWorkersMax} at most), so this Bot cannot start one now.`, { retryable: true, hint: 'Another Bot is using a worker; retry when one is free.' }))

  /**
   * Hand one Bot's slot to another, but only once that worker has CONFIRMED its
   * exit. A slot whose worker is still going away stays taken.
   */
  const reclaimOne = async keepBotId => {
    const victims = [...processes.values()]
      .filter(entry => entry.botId !== keepBotId && entry.reclaimable() && !dbLocks.has(entry.botId))
      .sort((left, right) => left.lastUsed - right.lastUsed)
    for (const victim of victims) {
      if (await victim.retire()) {
        // The exit is confirmed and the entry is gone from the map, so the slot
        // is genuinely free — only now may another Bot be admitted into it.
        if (processes.get(victim.botId) === victim) processes.delete(victim.botId)
        victim.retiring = false
        return true
      }
      // The exit was not confirmed: this Bot keeps its slot and refuses to
      // reopen, so try the next candidate.
    }
    return false
  }

  /**
   * Get this Bot's worker, admitting it under the STRICT global cap. A Bot that
   * already holds a slot reuses it (its own respawn never needs a new one); a
   * Bot without one either gets a free slot, reclaims an idle one, or is refused
   * with engine_unavailable — nothing is queued and no write is replayed.
   */
  const admit = botId => {
    assertBotId(botId)
    return enqueueAdmission(async () => {
      const existing = processes.get(botId)
      if (existing) return existing
      while (processes.size >= DATA_LIMITS.activeWorkersMax) {
        if (!(await reclaimOne(botId))) throw busy(botId)
      }
      const entry = new BotProcess(botId, dbPathFor(botId), { forkImpl, execPath, now, limits: workerLimits })
      processes.set(botId, entry)
      return entry
    })
  }

  /** The Bot's worker if it already holds a slot; never admits one. */
  const residentProcess = botId => { assertBotId(botId); return processes.get(botId) ?? null }

  const processFor = botId => {
    assertBotId(botId)
    let entry = processes.get(botId)
    if (!entry) { entry = new BotProcess(botId, dbPathFor(botId), { forkImpl, execPath, now, limits: workerLimits }); processes.set(botId, entry) }
    enforceWorkerCap(botId)
    return entry
  }

  /**
   * Keep at most DATA_LIMITS.activeWorkersMax Bot databases resident. Only idle
   * workers are evicted (least recently used first): a worker with a statement
   * in flight is never cancelled by the cap, so the cap can be exceeded
   * temporarily rather than cancelling real work.
   */
  const enforceWorkerCap = keepBotId => {
    if (processes.size <= DATA_LIMITS.activeWorkersMax) return
    const idle = [...processes.values()].filter(entry => entry.botId !== keepBotId && entry.pending.size === 0)
      .sort((left, right) => left.lastUsed - right.lastUsed)
    for (const victim of idle.slice(0, processes.size - DATA_LIMITS.activeWorkersMax)) {
      processes.delete(victim.botId)
      void victim.close().catch(() => {})
    }
  }

  const readSheet = async botId => {
    try { return JSON.parse(await readFile(sheetPathFor(botId), 'utf8')) } catch { return { version: 1, botId, cards: [], sources: [], updatedAt: null } }
  }
  /**
   * Read-modify-write a Bot's sheet under that Bot's lock. Two concurrent steps
   * for the same Bot used to overwrite each other's metadata (a lost source
   * entry, or a dropped card); now they are serialized, so the last write still
   * contains every earlier one.
   */
  const saveSheet = (botId, mutate) => serialize(sheetLocks, botId, async () => {
    const sheet = await readSheet(botId)
    const result = mutate(sheet)
    sheet.updatedAt = new Date(now()).toISOString()
    await writeSheet(sheetPathFor(botId), sheet)
    return result
  })

  /** Resolve a user table name to a catalog relation (quoted) or throw table_not_found. */
  const resolveTable = async (run, name) => {
    const tables = (await run('listTables', {})).filter(table => !isInternal(table.name))
    const wanted = String(name).trim().replace(/^"|"$/g, '')
    const last = wanted.split('.').pop()
    const match = tables.find(table => table.name === wanted) ?? tables.find(table => table.name === last)
      ?? tables.find(table => table.name.toLowerCase() === last.toLowerCase())
    if (!match) {
      const names = tables.map(table => table.name)
      const close = names.filter(candidate => candidate.toLowerCase().includes(last.toLowerCase())).slice(0, 5)
      throw new DataFailure(dataError('table_not_found', `Table ${wanted} does not exist.`, close.length ? { candidates: close } : {}))
    }
    return match.sqlName
  }

  const forBot = (botId, { signal } = {}) => {
    assertBotId(botId)
    const checkSignal = () => {
      if (signal?.aborted) throw new DataFailure(dataError('cancelled', 'The data call was cancelled. Changes already committed may still be present; inspect the data before repeating a write.'))
    }
    const run = async (op, message, timeoutMs = sqlTimeoutMs) => {
      checkSignal()
      const process = await admit(botId)
      checkSignal()
      const abort = () => process.kill()
      signal?.addEventListener('abort', abort, { once: true })
      try {
        checkSignal()
        await process.ensure()
        checkSignal()
        const result = await process.request(op, message, timeoutMs)
        checkSignal()
        return result
      } catch (error) { checkSignal(); throw error }
      finally { signal?.removeEventListener('abort', abort) }
    }
    const guardedRun = (sql, { mode, maxRows, maxBytes, timeoutMs } = {}) => {
      const kind = gateSql(sql, { allowCreate: true })
      return run('run', { sql, mode: mode ?? (kind.kind === 'read' ? 'read' : 'write'), maxRows, maxBytes }, timeoutMs).catch(error => { throw error instanceof DataFailure ? error : workerFailure(error) })
    }
    /**
     * Every step that writes the database or the sheet metadata runs under this
     * Bot's lock: a multi-step load/show/sql sequence cannot interleave with
     * another one for the same Bot, so a same-named table is never replaced
     * twice and no card or source entry is lost.
     */
    const write = work => {
      checkSignal()
      return serialize(dbLocks, botId, () => { checkSignal(); return work() })
    }

    /**
     * Re-open a SAVED card by its id. This is a precise read, not a re-run of
     * whatever the caller feels like: the sheet says what the card was, and the
     * result is rebuilt from that — the persisted card table when it still
     * exists, otherwise the card's own stored query. Nothing is invented, and a
     * card whose source is gone fails with a real error instead of an empty grid.
     */
    const reopenCard = async (cardId, input = {}) => {
      const started = now()
      if (!IDENT.test(cardId)) fail('invalid_input', 'A card id is required.')
      const sheet = await readSheet(botId)
      const saved = sheet.cards.find(card => card.id === cardId)
      if (!saved) fail('card_not_found', `Card ${cardId} is not saved for this Bot.`)
      const kind = saved.kind === 'chart' ? 'chart' : 'table'
      const table = quoteIdent(cardTable(cardId))
      const resident = (await run('listTables', {})).some(entry => entry.name === cardTable(cardId))
      const title = input.title ?? saved.title ?? cardId

      if (kind === 'chart') {
        const sql = typeof saved.sql === 'string' ? saved.sql.trim() : ''
        const spec = saved.chart
        if (!sql || !spec || typeof spec !== 'object' || typeof spec.type !== 'string' || typeof spec.x !== 'string') {
          fail('card_not_found', `Card ${cardId} has no saved chart spec to re-render.`)
        }
        gateSql(sql)
        // Recompute the series from the live database through the card's own
        // compiled aggregation, then restore the card table if it is missing.
        const bounded = await run('run', { sql, mode: 'read', maxRows: DATA_LIMITS.chartMaxMarks, maxBytes: DATA_LIMITS.sqlBytesMax })
        const chart = shapeChart(bounded, spec)
        let columns = bounded.columns
        let rowCount = bounded.rowCount
        if (!resident) {
          const materialised = await run('materialise', { sql, table })
          columns = materialised.columns
          rowCount = materialised.rowCount
        }
        return { id: cardId, kind, title, chart, rowCount, truncated: chart.truncated, columns, elapsedMs: now() - started }
      }

      if (resident) {
        const described = await run('describe', { target: table })
        const firstPage = await run('page', { target: table, offset: 0, limit: DATA_LIMITS.pageSize })
        return { id: cardId, kind, title, columns: described.columns, rowCount: described.rowCount, rows: firstPage.rows, truncated: described.rowCount > firstPage.rows.length, elapsedMs: now() - started }
      }
      // The card table is gone; rebuild it from the table or query it was made of.
      let materialiseSql = null
      if (typeof saved.sql === 'string' && saved.sql.trim() !== '') materialiseSql = saved.sql
      else if (typeof saved.table === 'string' && saved.table.trim() !== '') materialiseSql = `SELECT * FROM ${await resolveTable(run, saved.table)} LIMIT ${DATA_LIMITS.showTableRowsMax}`
      if (!materialiseSql) fail('card_not_found', `Card ${cardId} has no saved source to rebuild from.`)
      gateSql(materialiseSql)
      const materialised = await run('materialise', { sql: materialiseSql, table })
      const firstPage = await run('page', { target: table, offset: 0, limit: DATA_LIMITS.pageSize })
      return { id: cardId, kind, title, columns: materialised.columns, rowCount: materialised.rowCount, rows: firstPage.rows, truncated: materialised.rowCount > firstPage.rows.length, elapsedMs: now() - started }
    }

    const api = {
      botId,

      async load(input = {}) {
        const started = now()
        let text
        let sourceLabel
        if (input.from === 'content') {
          text = String(input.content ?? '')
          sourceLabel = 'inline'
          if (Buffer.byteLength(text) > DATA_LIMITS.loadMaxBytes) fail('source_unsupported', `Inline content exceeds ${DATA_LIMITS.loadMaxBytes} bytes.`)
        } else if (input.from === 'library') {
          if (typeof libraryReader !== 'function') fail('source_unsupported', 'Library import is not wired on this Host.')
          if (typeof input.path !== 'string' || input.path === '') fail('invalid_input', 'A library path is required.')
          try { text = await libraryReader(botId, input.path) } catch (error) { throw new DataFailure(dataError('source_not_found', String(error?.message ?? error))) }
          sourceLabel = `library:${input.path}`
          if (Buffer.byteLength(text) > DATA_LIMITS.loadMaxBytes) fail('source_unsupported', `The library file exceeds ${DATA_LIMITS.loadMaxBytes} bytes.`)
        } else {
          fail('invalid_input', 'data_load needs from: "library" (with a path) or "content" (with the text). No OS paths or URLs.')
        }

        const format = input.format ?? (input.from === 'library' ? guessFormat(input.path) : 'csv')
        let parsed
        try {
          parsed = format === 'json' ? parseJsonText(text) : parseDelimited(text, { delimiter: format === 'tsv' ? '\t' : (input.delimiter ?? ','), header: input.header !== false })
        } catch (error) { throw error instanceof DataFailure ? error : new DataFailure(dataError('import_failed', String(error?.message ?? error))) }

        const replace = input.replace !== false
        const existing = new Set((await run('listTables', {})).filter(table => !isInternal(table.name)).map(table => table.name.toLowerCase()))
        const base = tableNameFrom(input.name ?? (input.from === 'library' ? stripExt(input.path) : 'dataset'))
        let name = base
        for (let n = 2; !replace && existing.has(name.toLowerCase()); n++) name = `${base.slice(0, 62 - String(n).length)}_${n}`
        existing.add(name.toLowerCase())

        const result = await run('load', { table: quoteIdent(name), columns: parsed.columns, sqlTypes: parsed.sqlTypes, rows: parsed.rows })
        const described = await run('describe', { target: quoteIdent(name) })
        const columns = described.columns.map(column => ({ name: column.name, type: column.type }))
        await saveSheet(botId, sheet => {
          sheet.sources = [{ name, kind: format === 'json' ? 'json' : 'csv', source: sourceLabel, rowCount: result.rowCount, columns, loadedAt: new Date(now()).toISOString() }, ...sheet.sources.filter(entry => entry.name !== name)].slice(0, 200)
        })
        return { tables: [{ name, rowCount: result.rowCount, columns, source: sourceLabel }], warnings: [], elapsedMs: now() - started }
      },

      async describe(target) {
        const started = now()
        if (target === undefined || target === null || target === '') {
          const tables = (await run('listTables', {})).filter(table => !isInternal(table.name))
          const sheet = await readSheet(botId)
          return { rowCount: 0, columns: [], tables: tables.map(table => ({ name: table.name, columns: table.columns })), cards: sheet.cards.map(card => ({ id: card.id, title: card.title, kind: card.kind, rowCount: card.rowCount })), elapsedMs: now() - started }
        }
        if (typeof target !== 'string') fail('invalid_input', 'data_describe takes a table name or a SELECT.')
        if (IDENTIFIER_LIKE.test(target)) {
          const relation = await resolveTable(run, target.trim())
          const described = await run('describe', { target: relation })
          return { name: target.trim(), rowCount: described.rowCount, columns: described.columns, elapsedMs: now() - started }
        }
        const kind = gateSql(target)
        if (kind.kind !== 'read') fail('invalid_input', 'data_describe takes a table name or a SELECT.', { sql: target })
        const bounded = await run('run', { sql: target, mode: 'read', maxRows: DATA_LIMITS.sqlRowsDefault, maxBytes: DATA_LIMITS.describeBytesMax })
        return { sql: target, rowCount: bounded.rowCount, columns: bounded.columns, truncated: bounded.truncated, elapsedMs: now() - started }
      },

      async sql(input = {}) {
        const started = now()
        if (typeof input.sql !== 'string' || input.sql.trim() === '') fail('invalid_input', 'data_sql needs a sql string.')
        const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? DATA_LIMITS.sqlRowsDefault)), DATA_LIMITS.sqlRowsMax)
        const kind = gateSql(input.sql, { allowCreate: true })
        if (kind.kind === 'create') {
          const target = kind.target.split('.').pop()
          if (!IDENT.test(target)) fail('invalid_input', 'A CREATE target must be a plain table or view name in your own database.')
          const relation = quoteIdent(target)
          if (kind.object === 'view') {
            await run('run', { sql: input.sql, mode: 'write' })
          } else {
            // SQLite has no CREATE OR REPLACE TABLE; a replace drops first.
            if (kind.orReplace) await run('drop', { target: relation })
            await run('run', { sql: input.sql.replace(/CREATE\s+(TEMP(?:ORARY)?\s+)?OR\s+REPLACE\s+TABLE/i, 'CREATE $1TABLE'), mode: 'write' })
          }
          const described = await run('describe', { target: relation })
          return { table: target, columns: described.columns, rowCount: described.rowCount, rows: [], truncated: false, elapsedMs: now() - started }
        }
        if (kind.kind === 'read' && input.name) {
          const name = tableNameFrom(input.name)
          const relation = quoteIdent(namedTable(input.name))
          const materialised = await run('materialise', { sql: input.sql, table: relation })
          const page = await run('run', { sql: `SELECT * FROM ${relation} LIMIT ${limit + 1}`, mode: 'read', maxRows: limit + 1, maxBytes: DATA_LIMITS.sqlBytesMax })
          const bounded = boundRows(page.rows, limit, DATA_LIMITS.sqlBytesMax)
          return { table: name, columns: materialised.columns, rowCount: materialised.rowCount, rows: bounded.rows, truncated: bounded.truncated, elapsedMs: now() - started }
        }
        const page = await run('run', { sql: input.sql, mode: 'read', maxRows: limit + 1, maxBytes: DATA_LIMITS.sqlBytesMax })
        const bounded = boundRows(page.rows, limit, DATA_LIMITS.sqlBytesMax)
        return { table: null, columns: page.columns, rowCount: page.rowCount, rows: bounded.rows, truncated: bounded.truncated || page.rowCount > bounded.rows.length, elapsedMs: now() - started }
      },

      async show(input = {}) {
        const started = now()
        if (input.cardId !== undefined) return reopenCard(input.cardId, input)
        const kind = input.kind === 'chart' ? 'chart' : 'table'
        let relation
        let sql
        if (input.table !== undefined) {
          relation = await resolveTable(run, input.table)
        } else if (typeof input.sql === 'string' && input.sql.trim() !== '') {
          gateSql(input.sql)
          sql = input.sql
        } else {
          fail('invalid_input', 'data_show needs a table name or a SELECT.')
        }

        const cardId = `c_${nextCardId(now, botId)}`
        const cardResult = quoteIdent(cardTable(cardId))
        let columns
        let rowCount
        let result = { id: cardId, kind, title: input.title ?? (input.table ?? 'Query'), rowCount: 0, truncated: false }

        if (kind === 'chart') {
          const source = relation ?? `(${sql})`
          const described = relation ? await run('describe', { target: relation }) : await run('run', { sql: input.sql, mode: 'read', maxRows: 1, maxBytes: DATA_LIMITS.describeBytesMax })
          const columnNames = described.columns.map(column => column.name)
          let compiled
          try { compiled = compileChart(input.chart, columnNames, relation ?? `(${input.sql})`) } catch (error) { throw error instanceof DataFailure ? error : workerFailure(error) }
          const bounded = await run('run', { sql: compiled.sql, mode: 'read', maxRows: DATA_LIMITS.chartMaxMarks, maxBytes: DATA_LIMITS.sqlBytesMax })
          const chart = shapeChart(bounded, input.chart)
          const materialised = await run('materialise', { sql: compiled.sql, table: cardResult })
          columns = materialised.columns
          rowCount = materialised.rowCount
          result = { ...result, chart, rowCount, truncated: chart.truncated, columns }
          await saveSheet(botId, sheet => { sheet.cards = [{ id: cardId, kind, title: result.title, sql: compiled.sql, chart: input.chart, columns, rowCount, by: 'bot', createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() }, ...sheet.cards].slice(0, DATA_LIMITS.sheetCardsMax) })
          return { ...result, elapsedMs: now() - started }
        }

        // Table card: materialise a bounded copy so it can be paged and exported.
        const materialiseSql = relation ? `SELECT * FROM ${relation} LIMIT ${DATA_LIMITS.showTableRowsMax}` : input.sql
        const materialised = await run('materialise', { sql: materialiseSql, table: cardResult })
        columns = materialised.columns
        rowCount = materialised.rowCount
        const firstPage = await run('page', { target: cardResult, offset: 0, limit: DATA_LIMITS.pageSize })
        result = { ...result, columns, rowCount, rows: firstPage.rows, truncated: rowCount > firstPage.rows.length }
        await saveSheet(botId, sheet => { sheet.cards = [{ id: cardId, kind, title: result.title, sql: relation ? undefined : input.sql, table: relation ? input.table : undefined, columns, rowCount, by: 'bot', createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() }, ...sheet.cards].slice(0, DATA_LIMITS.sheetCardsMax) })
        return { ...result, elapsedMs: now() - started }
      },

      async page(input = {}) {
        let target
        if (input.cardId) {
          if (!IDENT.test(input.cardId)) fail('invalid_input', 'A card id is required.')
          target = quoteIdent(cardTable(input.cardId))
        } else if (input.table) {
          target = await resolveTable(run, input.table)
        } else {
          fail('invalid_input', 'data page needs a table or cardId.')
        }
        const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? DATA_LIMITS.pageSize)), DATA_LIMITS.pageLimitMax)
        return run('page', { target, offset: Math.max(0, Math.trunc(input.offset ?? 0)), limit, sort: input.sort, filter: input.filter, filterColumn: input.filterColumn })
      },

      async exportCsv(input = {}) {
        const started = now()
        let relation
        if (input.cardId !== undefined) {
          if (!IDENT.test(input.cardId)) fail('invalid_input', 'A card id is required.')
          relation = quoteIdent(cardTable(input.cardId))
        } else if (input.table) relation = await resolveTable(run, input.table)
        else if (typeof input.sql === 'string' && input.sql.trim() !== '') { gateSql(input.sql); relation = `(${input.sql})` }
        else fail('invalid_input', 'data_export needs a table, a cardId or a SELECT.')
        const described = await run('describe', { target: relation })
        const rows = await run('run', { sql: `SELECT * FROM ${relation} LIMIT ${DATA_LIMITS.showTableRowsMax}`, mode: 'read', maxRows: DATA_LIMITS.showTableRowsMax + 1, maxBytes: DATA_LIMITS.exportMaxBytes })
        const csv = boundExport(toCsv(described.columns, rows.rows))
        const relPath = `exports/${tableNameFrom(input.filename ?? 'export')}.csv`
        // The row counts are two different facts and both are reported: the
        // source's total, and the rows this export actually encoded.
        const exportedRows = rows.rows.length
        const result = {
          format: 'csv',
          sourceRowCount: described.rowCount,
          rowCount: exportedRows,
          bytes: csv.bytes,
          truncated: csv.truncated || rows.truncated || exportedRows < described.rowCount,
          elapsedMs: now() - started,
        }
        if (typeof libraryWriter !== 'function') return { ...result, content: csv.text.slice(0, DATA_LIMITS.exportMaxBytes) }
        // A failed library write is a FAILED export: no path is reported and the
        // caller must not tell the user the file exists.
        checkSignal()
        try {
          const written = await libraryWriter(botId, relPath, csv.text)
          return { ...result, path: relPath, written: { bytes: written?.bytes ?? csv.bytes } }
        } catch (error) {
          const message = sanitizeDataMessage(error?.message ?? error)
          // The Host names the reason when it has a code; otherwise the message
          // decides. Both are reported, so a size limit is never a mystery.
          const code = String(error?.code ?? '')
          const tooLarge = code === 'LIBRARY_FILE_TOO_LARGE' || /too.?large|exceed|字节|超过/i.test(message)
          throw new DataFailure(dataError(tooLarge ? 'output_too_large' : 'write_refused',
            tooLarge
              ? `The export (${csv.bytes} bytes) did not fit the library's single-file limit: ${message}`
              : `The library write failed, so nothing was exported: ${message}`,
            { bytes: csv.bytes, attemptedPath: relPath, sourceRowCount: described.rowCount, rowCount: exportedRows, truncated: result.truncated }))
        }
      },

      async remove(input = {}) {
        if (input.cardId !== undefined) {
          if (!IDENT.test(input.cardId)) fail('invalid_input', 'A card id is required.')
          await run('drop', { target: quoteIdent(cardTable(input.cardId)) })
          await saveSheet(botId, sheet => { sheet.cards = sheet.cards.filter(card => card.id !== input.cardId) })
          return { removed: 'card', id: input.cardId }
        }
        if (typeof input.table !== 'string' || input.table.trim() === '') fail('invalid_input', 'data remove needs a table name or a cardId.')
        const relation = await resolveTable(run, input.table)
        await run('drop', { target: relation })
        const removed = input.table.trim().replace(/^"|"$/g, '')
        await saveSheet(botId, sheet => { sheet.sources = sheet.sources.filter(entry => entry.name !== removed) })
        return { removed: 'table', name: removed }
      },

      async listTables() {
        const tables = (await run('listTables', {})).filter(table => !isInternal(table.name))
        return tables.map(table => ({ name: table.name, columns: table.columns }))
      },

      async catalog() {
        const tables = (await run('listTables', {})).filter(table => !isInternal(table.name))
        const sheet = await readSheet(botId)
        return { tables: tables.map(table => ({ name: table.name, columns: table.columns })), sources: sheet.sources, cards: sheet.cards.map(card => ({ id: card.id, title: card.title, kind: card.kind, rowCount: card.rowCount, updatedAt: card.updatedAt })) }
      },

      cancel() {
        // A stop request never admits a worker just to kill one.
        residentProcess(botId)?.kill()
        return { cancelled: true }
      },
    }

    // Reads stay unlocked; every step that writes the database or the sheet
    // metadata runs under this Bot's lock, so two concurrent steps for the same
    // Bot can never interleave (no double replace, no lost card or source entry).
    return Object.freeze({
      botId,
      load: input => write(() => api.load(input)),
      sql: input => write(() => api.sql(input)),
      show: input => write(() => api.show(input)),
      remove: input => write(() => api.remove(input)),
      describe: api.describe,
      page: api.page,
      exportCsv: api.exportCsv,
      listTables: api.listTables,
      catalog: api.catalog,
      cancel: api.cancel,
    })
  }

  return Object.freeze({
    forBot,
    async deleteBot(botId) {
      const entry = processes.get(botId)
      if (!entry) return { botId, closed: true }
      try {
        await entry.close()
      } catch (error) {
        // The worker never confirmed its exit, so the slot is NOT released.
        return { botId, closed: false, error: error?.error ?? { code: 'engine_unavailable', message: String(error?.message ?? error) } }
      }
      if (processes.get(botId) === entry) processes.delete(botId)
      entry.retiring = false
      return { botId, closed: true }
    },
    /**
     * Close every worker and report the truth: a Bot whose child never confirmed
     * its exit is listed in `unconfirmed`, keeps its slot, and is NOT reported as
     * closed. Nothing here claims a close that did not happen.
     */
    async closeAll() {
      const entries = [...processes.values()]
      const report = await Promise.all(entries.map(async entry => {
        try {
          await entry.close()
          // The slot is only released once the exit is confirmed.
          if (processes.get(entry.botId) === entry) processes.delete(entry.botId)
          entry.retiring = false
          return { botId: entry.botId, closed: true }
        } catch (error) {
          return { botId: entry.botId, closed: false, error: error?.error ?? { code: 'engine_unavailable', message: String(error?.message ?? error) } }
        }
      }))
      return Object.freeze({ closed: report.filter(row => row.closed).map(row => row.botId), unconfirmed: report.filter(row => !row.closed) })
    },
  })
}

let cardCounter = 0
const nextCardId = (nowFn, botId) => `${nowFn().toString(36)}_${(cardCounter++).toString(36)}`

const guessFormat = path => (/\.(json|ndjson|jsonl)$/i.test(path) ? 'json' : /\.tsv$|\.tab$/i.test(path) ? 'tsv' : 'csv')
const stripExt = path => String(path).replace(/\.[^./\\]+$/, '').split(/[\\/]/).pop() ?? 'dataset'
