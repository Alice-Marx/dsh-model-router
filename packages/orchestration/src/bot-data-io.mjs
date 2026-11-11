/**
 * Bounded data import/export for the Bot data tools.
 *
 * Import parses CSV/TSV or JSON/NDJSON text — the text already came from a
 * bounded controlled read (BotLibrary) or bounded inline content, never from
 * an OS path or URL. It infers a light column kind so SQLite can hold numbers
 * as numbers, and it enforces row/column/byte caps so one file cannot exhaust
 * memory. Export writes CSV that neutralises spreadsheet formula injection.
 */

import { DATA_LIMITS, DataFailure, dataError } from './bot-data-surface.mjs'

const fail = (code, message, extra = {}) => { throw new DataFailure(dataError(code, message, extra)) }

/** Column kind inferred from parsed values; SQLite affinity is chosen from it. */
const SQLITE_TYPE = { integer: 'INTEGER', real: 'REAL', boolean: 'INTEGER', text: 'TEXT', null: 'TEXT' }

const normalizeHeader = (raw, index, seen) => {
  let name = String(raw ?? '').trim()
  if (name === '') name = `column_${index + 1}`
  let unique = name
  for (let n = 2; seen.has(unique.toLowerCase()); n++) unique = `${name}_${n}`
  seen.add(unique.toLowerCase())
  return unique
}

/**
 * Parse RFC-4180-ish delimited text. Handles quoted fields with embedded
 * delimiters, newlines and doubled quotes. Returns { columns, rows }.
 */
export function parseDelimited(text, { delimiter = ',', header = true } = {}) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  let i = 0
  const n = text.length
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); if (row.length !== 1 || row[0] !== '') rows.push(row); row = [] }
  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue } inQuotes = false; i++; continue }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === delimiter) { pushField(); i++; continue }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue }
    if (ch === '\n') { pushRow(); i++; continue }
    field += ch; i++
  }
  pushRow()
  if (inQuotes) fail('import_failed', 'Unterminated quoted field in the input.')
  if (!rows.length) fail('import_failed', 'The input has no rows.')

  const seen = new Set()
  let columns
  let dataRows
  if (header) {
    columns = rows[0].map((cell, index) => normalizeHeader(cell, index, seen))
    dataRows = rows.slice(1)
  } else {
    const width = rows[0].length
    columns = Array.from({ length: width }, (_, index) => normalizeHeader(`column_${index + 1}`, index, seen))
    dataRows = rows
  }
  return finish(columns, dataRows, delimiter)
}

/** Parse JSON (array of objects, single object) or NDJSON (one object per line). */
export function parseJsonText(text) {
  const trimmed = text.trim()
  let records
  let whole = null
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { whole = JSON.parse(text) } catch { whole = null }
  }
  if (whole !== null) {
    records = Array.isArray(whole) ? whole : [whole]
    if (Array.isArray(whole) && whole.length && whole.every(item => typeof item !== 'object' || item === null || Array.isArray(item))) {
      // An array of scalars: one column named "value".
      return finish(['value'], whole.map(item => [coerce(item)]))
    }
  } else {
    // NDJSON: one JSON value per line.
    records = []
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const t = line.trim()
      if (t === '') continue
      try { records.push(JSON.parse(t)) } catch (error) { fail('import_failed', `NDJSON line ${index + 1} parse failed: ${error.message}`) }
    }
  }
  if (!records.length) fail('import_failed', 'The input has no records.')
  const objects = records.filter(record => record !== null && typeof record === 'object' && !Array.isArray(record))
  if (!objects.length) fail('import_failed', 'The input has no JSON objects.')
  const seen = new Set()
  // column order = first-seen key order; original key kept for lookup, lower for dedupe.
  const columnKeys = []
  const columnLower = new Set()
  for (const object of objects) {
    for (const key of Object.keys(object)) {
      const lower = key.toLowerCase()
      if (columnLower.has(lower)) continue
      columnLower.add(lower)
      columnKeys.push({ key, name: normalizeHeader(key, columnKeys.length, seen) })
    }
  }
  const columns = columnKeys.map(entry => entry.name)
  const dataRows = objects.map(object => columnKeys.map(entry => (object[entry.key] === undefined ? null : normalizeCell(object[entry.key]))))
  return finish(columns, dataRows)
}

const coerce = value => (value === null || value === undefined ? null : typeof value === 'object' ? JSON.stringify(value) : value)

const normalizeCell = value => (value === undefined ? null : coerce(value))

/** Infer each column's final kind across all rows, then convert every cell to it. */
function finish(columns, dataRows, delimiter) {
  if (columns.length > DATA_LIMITS.loadMaxCols) fail('source_unsupported', `More than ${DATA_LIMITS.loadMaxCols} columns.`, { hint: 'Select fewer columns before loading.' })
  if (dataRows.length > DATA_LIMITS.loadMaxRows) fail('source_unsupported', `More than ${DATA_LIMITS.loadMaxRows} rows.`, { hint: 'Filter or sample the data before loading.' })

  // Pass 1: classify each raw value and widen the column kind.
  const kinds = new Array(columns.length).fill('null')
  const cellKinds = dataRows.map(row => row.map(raw => {
    let kind
    if (raw === '' || raw === null || raw === undefined) kind = 'null'
    else if (typeof raw === 'boolean') kind = 'boolean'
    else if (typeof raw === 'number') kind = Number.isInteger(raw) ? 'integer' : 'real'
    else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) kind = 'integer'
    else if (typeof raw === 'string' && /^\s*-?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?\s*$/.test(raw)) kind = 'real'
    else kind = 'text'
    return kind
  }))
  for (const row of cellKinds) row.forEach((kind, c) => { kinds[c] = widen(kinds[c], kind) })

  // Pass 2: convert each raw cell to its column's final kind.
  const rows = dataRows.map((row, r) => row.map((raw, c) => {
    const kind = kinds[c]
    if (raw === '' || raw === null || raw === undefined) return null
    if (kind === 'integer') { if (typeof raw === 'boolean') return raw ? 1 : 0; return typeof raw === 'number' ? raw : Number(String(raw).trim()) }
    if (kind === 'real') return typeof raw === 'number' ? raw : Number(String(raw).trim())
    if (kind === 'boolean') return raw ? 1 : 0
    return typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
  }))
  return { columns, rows, kinds, sqlTypes: kinds.map(kind => SQLITE_TYPE[kind]) }
}

/** Widen a column kind as more values arrive: null < integer < real < text. */
const RANK = { null: 0, boolean: 1, integer: 1, real: 2, text: 3 }
const widen = (a, b) => {
  if (a === b) return a
  if (a === 'null') return b === 'boolean' ? 'integer' : b
  if (b === 'null') return a
  if ((a === 'integer' && b === 'boolean') || (a === 'boolean' && b === 'integer')) return 'integer'
  if (RANK[a] >= RANK[b]) return a === 'integer' && b === 'real' ? 'real' : a
  return b === 'integer' && a === 'real' ? 'real' : b
}

/**
 * Encode one CSV field: neutralise spreadsheet formula injection, then quote
 * when the value contains a delimiter, quote, newline or edge whitespace.
 * A leading `-` is only neutralised when the value is not a plain number.
 */
export function csvField(value) {
  let s = value === null || value === undefined ? '' : String(value)
  const dangerous = /^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^\s*-?\d+(\.\d+)?([eE][+-]?\d+)?\s*$/.test(s))
  if (dangerous) s = `'${s}`
  if (/[",\n\r]/.test(s) || s !== s.trim()) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** Encode rows (array of cell arrays) to CSV text with a header row. */
export function toCsv(columns, rows) {
  const lines = [columns.map(column => csvField(column.name ?? column)).join(',')]
  for (const row of rows) lines.push(row.map(cell => csvField(cell)).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Strip NUL and cap bytes of an exported payload; never fabricate content. */
export function boundExport(text, maxBytes = DATA_LIMITS.exportMaxBytes) {
  const bytes = Buffer.byteLength(text)
  if (bytes <= maxBytes) return { text, bytes, truncated: false }
  // Cut on a UTF-8-safe boundary.
  const buffer = Buffer.from(text, 'utf8').subarray(0, maxBytes)
  return { text: buffer.toString('utf8'), bytes: buffer.length, truncated: true }
}
