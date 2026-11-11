/**
 * The Data surface for the model-router Bot runtime: what the tools, the
 * engine, the fixed worker and the panel agree on. One SQLite database per
 * Bot, addressed only by a validated Bot id the Host derives from committed
 * state — never from a model argument.
 *
 * This mirrors OpenMausBot's `shared/data-surface.ts` shape (commit 1bc4749)
 * so the parent session can later swap the SQLite engine for DuckDB without
 * changing the tool contract. It is intentionally smaller: no DuckDB-only
 * readers, no external files/URLs — data enters only through a bounded
 * controlled read or bounded inline content.
 */

/** The five tools a Bot gets. */
export const DATA_TOOL_NAMES = Object.freeze(['data_load', 'data_describe', 'data_sql', 'data_show', 'data_export'])

/** Bounds. Every result is capped by rows AND bytes; the cap is the contract, not a plan. */
export const DATA_LIMITS = Object.freeze({
  /** data_sql rows returned to the model by default, and at most. */
  sqlRowsDefault: 100,
  sqlRowsMax: 1000,
  /** Bytes of rows data_sql returns to the model. */
  sqlBytesMax: 256 * 1024,
  /** data_describe result bytes; beyond describeColumnsMax columns, types only. */
  describeBytesMax: 32 * 1024,
  describeColumnsMax: 100,
  /** Sample values per column, each at most sampleChars characters. */
  sampleValues: 3,
  sampleChars: 60,
  /** Rows per page the panel's grid asks for. */
  pageSize: 200,
  pageLimitMax: 2000,
  /** Marks a chart may render after its SQL reduction. */
  chartMaxMarks: 5000,
  /** Rows data_show kind:"table" keeps for the panel. */
  showTableRowsMax: 100_000,
  /** One statement's wall clock before the child is killed. */
  sqlTimeoutMs: 30_000,
  /** Cards a sheet holds; the oldest unpinned card goes first. */
  sheetCardsMax: 100,
  /** Inline content / library read byte cap for a single data_load. */
  loadMaxBytes: 8 * 1024 * 1024,
  /** Rows a single data_load may materialise. */
  loadMaxRows: 200_000,
  /** Columns a single data_load may materialise. */
  loadMaxCols: 512,
  /** A single cell's text length before it is truncated for display. */
  cellCharsMax: 4000,
  /** Exported CSV/JSON byte cap. */
  exportMaxBytes: 16 * 1024 * 1024,
  /**
   * Native/database bounds enforced INSIDE the fixed worker. Row/character caps
   * alone do not bound SQLite: a single statement can allocate native memory or
   * grow the database file without returning many rows, so the worker sets these
   * at open time and SQLite itself refuses (SQLITE_FULL / SQLITE_NOMEM) instead
   * of the Host growing without limit.
   */
  /** Pages one Bot's database file may hold (SQLITE_FULL beyond it). */
  dbMaxPageCount: 32_768,
  /** Native heap SQLite refuses to exceed (SQLITE_NOMEM beyond it). */
  dbHardHeapLimitBytes: 96 * 1024 * 1024,
  /** Native heap SQLite starts reclaiming at. */
  dbSoftHeapLimitBytes: 48 * 1024 * 1024,
  /** The worker child's V8 old space; a runaway JS allocation dies, not the Host. */
  workerHeapMb: 256,
  /** Bot databases resident at once; the least recently used worker is closed. */
  activeWorkersMax: 4,
  /** How long close() waits for a child's real exit before reporting it. */
  workerExitTimeoutMs: 10_000,
  /** Wall clock for opening a database in a fresh child. */
  openTimeoutMs: 15_000,
})

/** Where materialised card results live inside a Bot's database. */
export const DATA_RESULTS_SCHEMA = 'mb_data_results'

export const DATA_ERROR_CODES = Object.freeze([
  'invalid_input', 'source_not_found', 'source_unsupported', 'sql_error', 'write_refused',
  'table_not_found', 'spec_invalid', 'card_not_found', 'output_too_large', 'timeout', 'cancelled',
  'engine_unavailable', 'import_failed', 'dataset_conflict', 'unauthorized',
])

/**
 * Bound an engine/worker message so a failure never leaks the Host's layout or
 * secrets: absolute paths are collapsed, stack frames are dropped and the text
 * is capped. `secrets` are literal strings (a data directory, a temp directory)
 * that must never reach the model or the panel.
 */
export function sanitizeDataMessage(message, secrets = [], maxChars = 400) {
  let text = String(message ?? '')
  text = text.replace(/(?:\r?\n)+\s*at\s+[^\r\n]*/g, '')      // stack frames
  text = text.replace(/[A-Za-z]:[\\/][^\s'"`,;)]*/g, '<path>')  // Windows absolute paths
  text = text.replace(/(^|[\s'"=(,])\/(?:[^\s'"`,;)]{2,})/g, '$1<path>') // POSIX absolute paths
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 3) continue
    text = text.split(secret).join('<redacted>')
  }
  text = text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/** A structured failure every tool and route returns. `message` is the engine's own text. */
export function dataError(code, message, extra = {}) {
  if (!DATA_ERROR_CODES.includes(code)) throw new RangeError(`unknown data error code: ${code}`)
  return { code, message, ...extra }
}

/** The throwable failure used inside the pure modules. */
export class DataFailure extends Error {
  constructor(error) {
    super(error.message)
    this.name = 'DataFailure'
    this.error = error
  }
}

/** A table name accepted as a load target / result name. */
export const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
/** A Bot id, matching the Host's principal directory rules. */
export const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

/** Quote a SQL identifier for SQLite. */
export const quoteIdent = name => `"${String(name).replace(/"/g, '""')}"`
/** Quote a SQL string literal for SQLite. */
export const quoteLiteral = value => `'${String(value).replace(/'/g, "''")}'`

/**
 * Derive a safe table name from an arbitrary stem (file name, dataset label).
 * Always returns a plain identifier safe to embed as a quoted SQL identifier.
 */
export function tableNameFrom(stem) {
  let name = String(stem ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 63)
  if (!name) name = 'data'
  if (!/^[a-z_]/.test(name)) name = `t_${name}`.slice(0, 63)
  return name
}

/** Validate a Bot id, throwing a DataFailure otherwise. */
export function assertBotId(botId) {
  if (typeof botId !== 'string' || !BOT_ID.test(botId) || /[. ]$/.test(botId)) {
    throw new DataFailure(dataError('invalid_input', 'A valid Bot id is required; it comes from the Host, never from an argument.'))
  }
  return botId
}
