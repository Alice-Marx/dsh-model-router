/**
 * The SQL gate: what a Bot may run against its own database.
 *
 * This is a tokenizer-based statement classifier, NOT a keyword regex. It walks
 * the statement once, masking string literals, comments and quoted identifiers
 * so a keyword inside a string can never change the verdict, and it reads the
 * verb after a WITH clause so a `WITH … DELETE` never passes as a read. The
 * defence-in-depth (extension loading disabled, no readfile/writefile, ATTACH
 * refused here) is proven by execution in tests/security-negative, not asserted.
 *
 * Only SELECT-like reads, and — when the caller allows it — `CREATE … AS`
 * (TABLE|VIEW), run. Everything else (INSERT/UPDATE/DELETE/DROP/ALTER/ATTACH/
 * DETACH/PRAGMA/VACUUM/BEGIN/…) is refused. One statement per call.
 *
 * Ported and narrowed from OpenMausBot server/data/tools.ts (commit 1bc4749)
 * for SQLite: no dollar-quoting, no non-nesting block comments, no E-strings.
 */

import { DataFailure, dataError } from './bot-data-surface.mjs'

const fail = (code, message, extra = {}) => { throw new DataFailure(dataError(code, message, extra)) }

const READ_VERBS = new Set(['SELECT', 'WITH', 'VALUES', 'EXPLAIN'])
const MATERIALISABLE = new Set(['SELECT', 'WITH', 'VALUES'])

/** A token: word (upper-cased text), ident (quoted), block (parenthesised), punct. */
const tokenize = sql => {
  const tokens = []
  let statements = 1
  let ended = false
  let depth = 0
  let i = 0
  const n = sql.length
  const push = (kind, raw, text = raw) => { if (depth === 0) tokens.push({ kind, raw, text }) }
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') { const end = sql.slice(i).search(/[\n\r]/); i = end === -1 ? n : i + end + 1; continue }
    if (ch === '/' && next === '*') { i = blockCommentEnd(sql, i); continue }
    if (ch === ';') { ended = true; i++; continue }
    if (ended && /\S/.test(ch)) { statements++; ended = false }
    if (ch === "'") { push('word', "'…'"); i = literalEnd(sql, i); continue }
    if (ch === '"' || ch === '`') { const j = quotedEnd(sql, i, ch); push('ident', sql.slice(i, j)); i = j; continue }
    if (ch === '[') { const j = bracketEnd(sql, i); push('ident', sql.slice(i, j)); i = j; continue }
    if (ch === '(') { push('block', '(…)'); depth++; i++; continue }
    if (ch === ')') { depth = Math.max(0, depth - 1); i++; continue }
    if (/[A-Za-z_]/.test(ch)) { let j = i + 1; while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++; push('word', sql.slice(i, j), sql.slice(i, j).toUpperCase()); i = j; continue }
    if (ch === ',') { push('punct', ','); i++; continue }
    i++
  }
  return { tokens, statements }
}

/** SQLite block comments do not nest. */
const blockCommentEnd = (sql, start) => {
  const end = sql.indexOf('*/', start + 2)
  if (end === -1) fail('invalid_input', 'Unterminated comment.')
  return end + 2
}

/** A single-quoted literal: '' escapes a quote. */
const literalEnd = (sql, quote) => {
  for (let j = quote + 1; j < sql.length; j++) {
    if (sql[j] !== "'") continue
    if (sql[j + 1] === "'") { j++; continue }
    return j + 1
  }
  fail('invalid_input', 'Unterminated string literal.')
}

/** A double-quoted or backtick identifier; the quote character doubles to escape. */
const quotedEnd = (sql, start, quote) => {
  for (let j = start + 1; j < sql.length; j++) {
    if (sql[j] !== quote) continue
    if (sql[j + 1] === quote) { j++; continue }
    return j + 1
  }
  fail('invalid_input', 'Unterminated quoted identifier.')
}

/** A [bracketed] identifier (SQLite/MSSQL style); ]] escapes a bracket. */
const bracketEnd = (sql, start) => {
  for (let j = start + 1; j < sql.length; j++) {
    if (sql[j] === ']') { if (sql[j + 1] === ']') { j++; continue } return j + 1 }
  }
  fail('invalid_input', 'Unterminated bracketed identifier.')
}

export const classifySql = sql => {
  if (typeof sql !== 'string' || sql.trim() === '') fail('invalid_input', 'The statement is empty.')
  const { tokens, statements } = tokenize(sql)
  if (statements > 1) fail('invalid_input', 'One statement per call.', { hint: 'Send each statement in its own data_sql call.' })
  if (!tokens.length || tokens[0].kind !== 'word') fail('invalid_input', 'The statement is empty.')
  return classifyTokens(tokens)
}

const classifyTokens = tokens => {
  let i = 0
  let verb = tokens[0].text
  const withClause = verb === 'WITH'
  if (withClause) {
    // WITH [RECURSIVE] name [(cols)] AS (body) [, …] <verb>
    i = 1
    if (tokens[i]?.text === 'RECURSIVE') i++
    for (;;) {
      while (i < tokens.length && tokens[i].kind !== 'block') i++
      i++
      if (tokens[i]?.text === 'AS') { while (i < tokens.length && tokens[i].kind !== 'block') i++; i++ }
      if (tokens[i]?.kind === 'punct') { i++; continue }
      break
    }
    verb = tokens[i]?.kind === 'word' ? tokens[i].text : ''
    if (!verb) fail('invalid_input', 'A WITH clause needs a statement after it.')
    if (verb === 'WITH') return { kind: 'refused', verb }
  }
  if (verb === 'EXPLAIN') {
    // EXPLAIN shows the plan; EXPLAIN QUERY PLAN too. Neither runs the statement.
    return { kind: 'read', materialisable: false }
  }
  if (READ_VERBS.has(verb)) return { kind: 'read', materialisable: withClause || MATERIALISABLE.has(verb) }
  if (verb === 'CREATE') {
    let j = i + 1
    if (tokens[j]?.text === 'TEMP' || tokens[j]?.text === 'TEMPORARY') j++
    // CREATE [TEMP] [OR REPLACE] TABLE|VIEW [IF NOT EXISTS] name AS select
    const orReplace = tokens[j]?.text === 'OR' && tokens[j + 1]?.text === 'REPLACE'
    if (orReplace) j += 2
    const object = tokens[j]?.text
    if (object !== 'TABLE' && object !== 'VIEW') return { kind: 'refused', verb: `CREATE ${object ?? ''}`.trim() }
    j++
    if (tokens[j]?.text === 'IF' && tokens[j + 1]?.text === 'NOT' && tokens[j + 2]?.text === 'EXISTS') j += 3
    const nameParts = []
    while (j < tokens.length && tokens[j].kind !== 'block' && tokens[j].text !== 'AS') { nameParts.push(tokens[j].raw.replace(/\.$/, '')); j++ }
    if (tokens[j]?.kind === 'block') j++
    if (tokens[j]?.text !== 'AS' || !nameParts.length) return { kind: 'refused', verb: `CREATE ${object}` }
    return { kind: 'create', target: nameParts.join('.'), object: object.toLowerCase(), orReplace }
  }
  return { kind: 'refused', verb }
}

/** Throws write_refused for anything but a read (and, when allowed, a CREATE … AS). */
export const gateSql = (sql, { allowCreate = false } = {}) => {
  const kind = classifySql(sql)
  if (kind.kind === 'refused') {
    throw new DataFailure(dataError('write_refused', `${kind.verb} is not allowed here.`, {
      sql,
      hint: allowCreate
        ? 'Only SELECT-like statements and CREATE [OR REPLACE] TABLE|VIEW … AS … run here. Load data with data_load; export with data_export.'
        : 'Only SELECT-like statements run here.',
    }))
  }
  if (kind.kind === 'create' && !allowCreate) {
    throw new DataFailure(dataError('write_refused', 'CREATE is not allowed here.', { sql, hint: 'Run CREATE TABLE … AS with data_sql, then show or export the table.' }))
  }
  return kind
}

const CELL_CHARS_MAX = 4000

/** Trim a cell's text and bound the result by rows and bytes. */
export function boundRows(rows, maxRows, maxBytes) {
  let truncated = rows.length > maxRows
  let kept = rows.slice(0, maxRows).map(row => row.map(cell => (typeof cell === 'string' && cell.length > CELL_CHARS_MAX ? `${cell.slice(0, CELL_CHARS_MAX)}…` : cell)))
  while (kept.length && Buffer.byteLength(JSON.stringify(kept)) > maxBytes) {
    kept = kept.slice(0, Math.max(0, kept.length - Math.max(1, Math.ceil(kept.length / 10))))
    truncated = true
  }
  return { rows: kept, truncated }
}

const trimSample = sample => sample?.slice(0, 3).map(value => (value.length > 60 ? `${value.slice(0, 60)}…` : value))

/** Bound a column list by count and bytes, degrading to name+type under pressure. */
export function boundColumns(columns, maxBytes, columnsMax = 100) {
  let truncated = columns.length > columnsMax
  let kept = truncated
    ? columns.map(({ name, type }) => ({ name, type }))
    : columns.map(column => ({ ...column, ...(column.sample ? { sample: trimSample(column.sample) } : {}) }))
  const size = () => Buffer.byteLength(JSON.stringify(kept))
  if (size() > maxBytes) { kept = kept.map(({ sample: _sample, ...rest }) => rest); truncated = true }
  if (size() > maxBytes) kept = kept.map(({ min: _min, max: _max, ...rest }) => rest)
  if (size() > maxBytes) kept = kept.map(({ name, type }) => ({ name, type }))
  while (kept.length && size() > maxBytes) kept = kept.slice(0, Math.max(0, kept.length - Math.max(1, Math.ceil(kept.length / 10))))
  return { columns: kept, truncated }
}

/** Map an engine error to a structured DataError; a killed child reads as cancelled/timeout. */
export function toDataError(error, sql, { aborted = false } = {}) {
  if (error instanceof DataFailure) return { ...error.error, ...(sql && !error.error.sql ? { sql } : {}) }
  const message = error instanceof Error ? error.message : String(error)
  if (aborted) return { code: 'cancelled', message: 'The statement was cancelled.', ...(sql ? { sql } : {}) }
  if (/timed out|timeout|SIGKILL|killed/i.test(message)) return { code: 'timeout', message, retryable: true, ...(sql ? { sql } : {}) }
  if (/interrupt/i.test(message)) return { code: 'cancelled', message: 'The statement was cancelled.', ...(sql ? { sql } : {}) }
  const line = /\bLINE (\d+):/.exec(message)
  return { code: 'sql_error', message, ...(sql ? { sql } : {}), ...(line ? { line: Number(line[1]) } : {}) }
}
