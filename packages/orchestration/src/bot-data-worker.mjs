/**
 * The fixed data worker: a plain Node child process that owns one Bot's SQLite
 * database and runs its statements. The engine forks THIS module path — never
 * a path a model supplies — and it is the only place better-sqlite3 loads.
 *
 * Protocol (child_process IPC):
 *  - `open { dbPath }`, then requests `{ id, op, ... }`; each replies
 *    `{ id, ok:true, value }` or `{ id, ok:false, error }`.
 *  - The SQL gate lives on the Host side; here a statement is a single prepared
 *    statement (better-sqlite3 refuses multi-statement strings), extension
 *    loading is never enabled, and every read is bounded by maxRows/maxBytes.
 *  - The execution layer re-checks what it is asked to run: a read must be a
 *    statement better-sqlite3 reports as a reader (`stmt.reader`), and a write
 *    must still classify as `CREATE … AS`. A `WITH … DELETE` cannot pass either
 *    check.
 *  - Row and character caps alone do not bound SQLite, so `open` also sets
 *    `max_page_count` and the soft/hard native heap limits: an oversized
 *    allocation or database is refused by SQLite itself (SQLITE_FULL /
 *    SQLITE_NOMEM) inside this child, never by the Host.
 *  - A statement that never returns is cancelled by the Host SIGKILLing this
 *    process; an unknown outcome is never replayed. SQLite recovers the file
 *    from its WAL on the next open.
 *
 * The database path arrives only in the `open` message and is computed by the
 * Host from a validated Bot id — this worker accepts no path from any model.
 * The handler is attached only when this file is the forked entry (MB_DATA_WORKER),
 * so the functions below can be imported and unit-tested in-process.
 */

import { createRequire } from 'node:module'
import { DATA_ERROR_CODES, DATA_LIMITS, DataFailure, dataError, sanitizeDataMessage, quoteIdent } from './bot-data-surface.mjs'
import { gateSql } from './bot-data-sql.mjs'

const require = createRequire(import.meta.url)
const CELL_CHARS_MAX = 4000

/** Import better-sqlite3 lazily so importing this module for tests never loads the native binding. */
let Database = null
const loadDatabase = () => { Database ??= require('better-sqlite3'); return Database }

export const cellOf = value => {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return `<blob ${value.length} bytes>`
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && value.length > CELL_CHARS_MAX) return `${value.slice(0, CELL_CHARS_MAX)}…`
  return value
}

const typeName = (type, sample) => {
  if (type) return String(type).toUpperCase()
  if (typeof sample === 'number') return Number.isInteger(sample) ? 'INTEGER' : 'REAL'
  if (typeof sample === 'boolean') return 'BOOLEAN'
  if (sample === null || sample === undefined) return 'ANY'
  return 'TEXT'
}

const columnsOf = stmt => stmt.columns().map(column => ({ name: column.name, type: String(column.type ?? 'ANY').toUpperCase() }))

export const openDb = (dbPath, limits = {}) => {
  const db = loadDatabase()(dbPath)
  // One writer per Bot; WAL so an abrupt kill recovers; bounded busy wait.
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = OFF')
  // Query sort/group intermediates must share the native heap ceiling instead
  // of spilling into an unbounded temporary database on the Host disk.
  db.pragma('temp_store = MEMORY')
  // Native and file bounds. Row/character caps alone do not bound SQLite: one
  // statement can allocate native memory or grow the file without returning many
  // rows, so SQLite itself refuses (SQLITE_FULL / SQLITE_NOMEM) and the child
  // dies alone instead of the Host.
  const maxPageCount = Math.max(1024, Math.trunc(limits.maxPageCount ?? DATA_LIMITS.dbMaxPageCount))
  const hardHeap = Math.max(8 * 1024 * 1024, Math.trunc(limits.hardHeapLimitBytes ?? DATA_LIMITS.dbHardHeapLimitBytes))
  const softHeap = Math.min(hardHeap, Math.max(1024 * 1024, Math.trunc(limits.softHeapLimitBytes ?? DATA_LIMITS.dbSoftHeapLimitBytes)))
  db.pragma(`max_page_count = ${maxPageCount}`)
  db.pragma(`hard_heap_limit = ${hardHeap}`)
  db.pragma(`soft_heap_limit = ${softHeap}`)
  return db
}

/** Run a read statement, collecting up to maxRows rows and maxBytes of JSON. */
export const runRead = (db, sql, maxRows, maxBytes) => {
  const stmt = db.prepare(sql)
  // A statement that returns no data is not a read, whatever the caller labelled
  // it: better-sqlite3 exposes this per statement, so the execution layer — not a
  // regex — decides. The gate on the Host side is the first line, this is the second.
  if (stmt.reader !== true) throw new DataFailure(dataError('write_refused', 'Only statements that return data may run as a read.'))
  const columns = stmt.columns().map(column => ({ name: column.name, type: String(column.type ?? 'ANY').toUpperCase() }))
  const rows = []
  let bytes = 2
  let truncated = false
  for (const raw of stmt.raw().iterate()) {
    const row = raw.map(cellOf)
    rows.push(row)
    bytes += Buffer.byteLength(JSON.stringify(row)) + 1
    if (rows.length >= maxRows) { truncated = true; break }
    if (bytes > maxBytes) { truncated = true; break }
  }
  const first = rows[0]
  if (first) columns.forEach((column, index) => { if (column.type === 'ANY') column.type = typeName(undefined, first[index]) })
  return { columns, rows, rowCount: rows.length, truncated }
}

/** Run a non-read statement (CREATE … AS); return the affected-row count. */
export const runWrite = (db, sql) => {
  // The gate is re-checked where the statement is executed: a WITH … DELETE is
  // not a CREATE, and only CREATE … AS may run here.
  const kind = gateSql(sql, { allowCreate: true })
  if (kind.kind !== 'create') throw new DataFailure(dataError('write_refused', `${kind.verb ?? 'That statement'} is not allowed here.`))
  const info = db.prepare(sql).run()
  return { changes: info.changes ?? 0 }
}

/** Describe a table/view/result relation: exact row count, columns, few samples. */
export const describeRelation = (db, target) => {
  const columns = columnsOf(db.prepare(`SELECT * FROM ${target} LIMIT 0`))
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${target}`).get()
  columns.forEach(column => {
    const quoted = quoteIdent(column.name)
    let sample = []
    try { sample = db.prepare(`SELECT DISTINCT ${quoted} AS v FROM ${target} WHERE ${quoted} IS NOT NULL LIMIT 3`).all().map(row => String(row.v)) } catch { /* unorderable column */ }
    column.sample = sample
  })
  return { rowCount: Number(count.n), columns }
}

/** List user tables and views with their columns (no row scan). */
export const listTables = db => db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => {
  const quoted = quoteIdent(row.name)
  let columns = []
  try { columns = columnsOf(db.prepare(`SELECT * FROM ${quoted} LIMIT 0`)) } catch { /* empty view */ }
  return { name: row.name, sqlName: quoted, columns }
})

/** A bounded page for the grid; filter uses a bound parameter, never concatenation. */
export const pageRelation = (db, { target, offset, limit, sort, filter, filterColumn }) => {
  const columns = columnsOf(db.prepare(`SELECT * FROM ${target} LIMIT 0`))
  const names = columns.map(column => column.name)
  const where = []
  const binds = []
  if (filter) {
    const pattern = `%${filter.replace(/[\\%_]/g, char => `\\${char}`)}%`
    const hit = name => `CAST(${quoteIdent(name)} AS TEXT) LIKE ? ESCAPE '\\'`
    if (filterColumn && names.includes(filterColumn)) { where.push(hit(filterColumn)); binds.push(pattern) }
    else { where.push(`(${names.map(hit).join(' OR ')})`); for (let i = 0; i < names.length; i++) binds.push(pattern) }
  }
  let orderBy = ''
  if (sort && names.includes(sort.column) && ['asc', 'desc'].includes(sort.direction)) orderBy = ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${target}${whereSql}`).get(...binds)
  const rows = db.prepare(`SELECT * FROM ${target}${whereSql}${orderBy} LIMIT ? OFFSET ?`).raw().all(...binds, limit, offset).map(raw => raw.map(cellOf))
  return { columns, rows, rowCount: Number(total.n), offset }
}

/** Materialise a SELECT into a results table; return its columns and row count. */
export const materialise = (db, { sql, table }) => {
  const body = sql.trim().replace(/;+\s*$/, '')
  // SQLite has no CREATE OR REPLACE TABLE, and DDL is transactional here: the
  // drop, the create and the row count all happen in ONE transaction, so a
  // CREATE … AS that hits a bound (SQLITE_FULL/SQLITE_NOMEM) or a syntax error
  // rolls the whole replacement back and the previous table survives intact.
  // `changes` is 0 for CREATE … AS, so count the materialised rows explicitly.
  const replace = db.transaction(() => {
    db.prepare(`DROP TABLE IF EXISTS ${table}`).run()
    db.prepare(`CREATE TABLE ${table} AS ${body}`).run()
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
  })
  const rowCount = replace()
  return { columns: columnsOf(db.prepare(`SELECT * FROM ${table} LIMIT 0`)), rowCount }
}

/** Insert parsed rows into a freshly created table (data_load); replace drops first. */
export const loadRows = (db, { table, columns, sqlTypes, rows }) => {
  // One transaction for drop + create + every insert: a load that fails halfway
  // (a bound, a type error) leaves the previous table in place instead of a
  // half-written replacement.
  const replace = db.transaction(() => {
    db.prepare(`DROP TABLE IF EXISTS ${table}`).run()
    db.prepare(`CREATE TABLE ${table} (${columns.map((name, index) => `${quoteIdent(name)} ${sqlTypes[index]}`).join(', ')})`).run()
    const insert = db.prepare(`INSERT INTO ${table} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    const insertMany = db.transaction(batch => { for (const row of batch) insert.run(...row) })
    insertMany(rows)
    return rows.length
  })
  return { rowCount: replace() }
}

const buildHandlers = () => {
  let db = null
  let dbPath = ''
  return {
    open: message => { dbPath = String(message?.dbPath ?? ''); db = openDb(dbPath, message?.limits ?? {}); return {} },
    close: () => { if (db) { db.close(); db = null } return {} },
    run: message => (message.mode === 'write' ? runWrite(db, message.sql) : runRead(db, message.sql, message.maxRows, message.maxBytes)),
    describe: message => describeRelation(db, message.target),
    listTables: () => listTables(db),
    page: message => pageRelation(db, message),
    materialise: message => materialise(db, message),
    load: message => loadRows(db, message),
    // Internal bookkeeping drop: the target is always an identifier the Host
    // quoted itself (a card/result table), never a statement from a caller.
    drop: message => { db.prepare(`DROP TABLE IF EXISTS ${message.target}`).run(); return { dropped: true } },
    // The database path never leaves this child except redacted out of a message.
    secrets: () => (dbPath.length >= 3 ? [dbPath] : []),
  }
}

/** Attach the IPC handler only when forked as the fixed worker entry. */
if (process.env.MB_DATA_WORKER === '1' && typeof process.send === 'function') {
  const handlers = buildHandlers()
  process.on('message', message => {
    const { id, op } = message
    try {
      const handler = handlers[op]
      if (!handler) throw Object.assign(new Error(`Unknown op ${op}`), { code: 'invalid_input' })
      process.send({ id, ok: true, value: handler(message) })
    } catch (error) {
      // The model and the panel see a bounded message: no Host paths, no stack,
      // no credentials — only what the statement itself said.
      const code = error?.error?.code ?? error?.code
      process.send({ id, ok: false, error: { message: sanitizeDataMessage(error instanceof Error ? error.message : String(error), handlers.secrets()), code: DATA_ERROR_CODES.includes(code) ? code : 'sql_error' } })
    }
  })
  process.on('disconnect', () => { try { handlers.close() } catch { /* already gone */ } process.exit(0) })
}

export { buildHandlers }
