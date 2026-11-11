/**
 * The durable Host service behind the private MCP browser and desktop tool families.
 *
 * One Bot conversation reaches a paired remote computer through this module and nothing else:
 *
 * ```
 * ctx.provide('botNativeRemoteActions', openNativeRemoteActions({
 *   Database, file, directory, authority, machines: () => machines, now,
 * }))
 * const view = actions.forConversation(botId, conversationId)
 * view.schemas()                                          // what this conversation may see now
 * await view.call(name, args, { turnId, callId, signal })  // one durable operation
 * ```
 *
 * Six rules are load-bearing, and each one is a rule the model cannot argue with:
 *
 * 1. **Every identity is Host-owned.** The machine, the root, the Agent `taskId`/`attemptId`, the
 *    `operationId` and the request key are derived from the Bot, the conversation and the turn/call
 *    identity the loop hands over. A reply may name one of its own bound machines or roots, and may
 *    reference a browser session, a screenshot or an operation the Host already issued; it can never
 *    mint one, and it is never accepted as an actor, an endpoint or a credential.
 * 2. **A request key is reserved before a byte leaves the process.** The reservation is one
 *    synchronous immediate transaction that also carries the input digest, so a repeated call reads
 *    its original record instead of dispatching a second effect, and the same key with different
 *    content is a refusal rather than a silent overwrite.
 * 3. **An unknown outcome is reconciled, never replayed.** A mutation whose dispatch may have
 *    happened answers `unknown` with its original operation identity and a next action; only an
 *    actual Agent operation record settles it. A pending or unknown mutation fences every further
 *    mutation of the same Bot, conversation, machine and root until it is reconciled.
 * 4. **A browser session and a screenshot belong to the context that produced them.** The Agent
 *    owns single-use and expiry of both; this module only records that a session or a capture was
 *    really issued to this Bot, conversation and target, and refuses anything else before dispatch.
 *    It never invents acceptance and never bypasses the Agent's own freshness checks.
 * 5. **Authority is re-decided, not cached.** Committed grants and paired scopes are read live
 *    before the reservation and again after every await, so a grant withdrawn mid-call cannot be
 *    turned into a delivered result.
 * 6. **No second ledger.** There is no money accounting and no Task submission here: the paired
 *    machine directory, the capability authority and the Agent's own operation journal are the only
 *    authorities, and a screenshot's pixels are delivered once and never persisted.
 */

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SCHEMA_VERSION = 1
/** The largest screenshot this Host hands back, whatever the remote artifact claims. */
const IMAGE_LIMIT_BYTES = 6 * 1024 * 1024
/** Ephemeral registries: a browser session and a desktop capture are per-conversation lookups. */
const SESSION_LIMIT = 4096
const CAPTURE_LIMIT = 4096
const ID_LIMIT_BYTES = 256

const fail = (code, extra) => { throw Object.assign(new Error(code), { code, ...(extra ?? {}) }) }
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const ref = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(value)
const hex = value => createHash('sha256').update(value).digest('hex')
const derived = (prefix, parts) => `${prefix}-${hex(JSON.stringify(parts)).slice(0, 32)}`

/** What the Agent's own journal says. A status outside this set is not a status. */
const AGENT_STATUS = new Set(['admitted', 'running', 'cancel_pending', 'succeeded', 'failed', 'cancelled', 'unknown'])
/** Local, pre-dispatch states: nothing has been proven either way yet. */
const PENDING_STATUS = new Set(['reserved', 'dispatched'])
/** Everything that fences a later mutation of the same Bot, conversation, machine and root. */
const BLOCKING_STATUS = new Set(['reserved', 'dispatched', 'admitted', 'running', 'cancel_pending', 'unknown'])
const TERMINAL_STATUS = new Set(['succeeded', 'failed', 'cancelled'])

const NEXT_ACTION = 'Reconcile this original operation with bot_remote_operation_status using the returned operationId before taking any further action. An unknown remote effect is never replayed.'

const familyOf = entry => entry.machineTool.startsWith('browser_') ? 'browser'
  : entry.machineTool.startsWith('desktop_') ? 'desktop' : 'operation'
const isObservation = entry => entry.machineTool === 'operation_status' || entry.machineTool === 'operation_cancel'
/**
 * A desktop action also needs the artifact and operation tools: the screenshot is delivered through
 * `machines.download`, and an unknown desktop effect can only be reconciled through
 * `operation_status`/`operation_cancel`. A pairing without them cannot run the family at all, so the
 * tools are not offered rather than offered and failed.
 */
const ARTIFACT_TOOLS = Object.freeze(['artifact_stat', 'artifact_read', 'operation_status', 'operation_cancel'])
const requirementsOf = entry => familyOf(entry) === 'desktop'
  ? Object.freeze([entry.capability, ...ARTIFACT_TOOLS.map(tool => `remote/${tool}`)])
  : Object.freeze([entry.capability])
const pairedToolsOf = entry => familyOf(entry) === 'desktop'
  ? Object.freeze([entry.machineTool, ...ARTIFACT_TOOLS])
  : Object.freeze([entry.machineTool])
/** A cancel is a stop request, not a workspace effect: a read-only pairing may hold it. */
const requiresWrite = entry => entry.mutating && !isObservation(entry)

const TARGET_KEYS = Object.freeze({
  machineId: { type: 'string', description: 'One of this Bot\'s paired machines; omit to let the Host choose.' },
  rootId: { type: 'string', description: 'One of the roots granted to this Bot on that machine; omit to let the Host choose.' },
})

const objectSchema = (properties, required = []) => Object.freeze({
  type: 'object',
  properties: Object.freeze(properties),
  required: Object.freeze(required),
  additionalProperties: false,
})

const text = description => ({ type: 'string', description })
const count = description => ({ type: 'integer', description })

/**
 * The offered surface. `capability` is the exact authority name a call needs; `parameters` is a flat
 * JSON object schema with `additionalProperties:false`, so a model cannot smuggle an identity, an
 * endpoint or a credential past the parser.
 */
const CATALOG = Object.freeze([
  Object.freeze({
    name: 'bot_browser_open', machineTool: 'browser_open', capability: 'remote/browser_open', mutating: true,
    description: 'Open a page in this Bot\'s granted remote browser. The browser session stays owned by this Bot conversation; later browser calls reuse it and never name a task id.',
    parameters: objectSchema({ ...TARGET_KEYS, url: text('Absolute http(s) URL inside the origins this Bot is granted to reach.'), profileId: text('Optional Host-declared persistent browser profile on that machine.') }, ['url']),
  }),
  Object.freeze({
    name: 'bot_browser_snapshot', machineTool: 'browser_snapshot', capability: 'remote/browser_snapshot', mutating: false,
    description: 'Read the current page of this Bot\'s browser session: its URL, its text and the interactive nodes with the ref ids later clicks and typing use. Read-only, so it carries no operation envelope.',
    parameters: objectSchema({ ...TARGET_KEYS, browserSessionId: text('The browserSessionId a successful bot_browser_open returned.') }, ['browserSessionId']),
  }),
  Object.freeze({
    name: 'bot_browser_click', machineTool: 'browser_click', capability: 'remote/browser_click', mutating: true,
    description: 'Click one node of the current snapshot in this Bot\'s browser session. The snapshotId and ref must come from the most recent bot_browser_snapshot.',
    parameters: objectSchema({ ...TARGET_KEYS, browserSessionId: text('The browserSessionId a successful bot_browser_open returned.'), snapshotId: text('The snapshotId the most recent bot_browser_snapshot returned.'), ref: text('The ref of one node in that snapshot.') }, ['browserSessionId', 'snapshotId', 'ref']),
  }),
  Object.freeze({
    name: 'bot_browser_type', machineTool: 'browser_type', capability: 'remote/browser_type', mutating: true,
    description: 'Type text into one node of the current snapshot in this Bot\'s browser session. Unicode is sent directly, never through the clipboard.',
    parameters: objectSchema({ ...TARGET_KEYS, browserSessionId: text('The browserSessionId a successful bot_browser_open returned.'), snapshotId: text('The snapshotId the most recent bot_browser_snapshot returned.'), ref: text('The ref of one node in that snapshot.'), text: text('The text to enter into that node.') }, ['browserSessionId', 'snapshotId', 'ref', 'text']),
  }),
  Object.freeze({
    name: 'bot_browser_close', machineTool: 'browser_close', capability: 'remote/browser_close', mutating: true,
    description: 'Close this Bot\'s browser session. It cannot be used afterwards; take a new bot_browser_open instead.',
    parameters: objectSchema({ ...TARGET_KEYS, browserSessionId: text('The browserSessionId a successful bot_browser_open returned.') }, ['browserSessionId']),
  }),
  Object.freeze({
    name: 'bot_desktop_screenshot', machineTool: 'desktop_screenshot', capability: 'remote/desktop_screenshot', mutating: true,
    description: 'Capture the granted remote desktop and return it as an image. The screenshotId is single-use and expires 15 seconds after the capture; take a new screenshot after any use, any failure and any window change.',
    parameters: objectSchema({ ...TARGET_KEYS }),
  }),
  Object.freeze({
    name: 'bot_desktop_click', machineTool: 'desktop_click', capability: 'remote/desktop_click', mutating: true,
    description: 'Click on the granted remote desktop. x and y are pixels of the screenshot named by screenshotId, never scaled by DPI.',
    parameters: objectSchema({ ...TARGET_KEYS, screenshotId: text('The screenshotId the most recent bot_desktop_screenshot returned.'), x: count('Horizontal pixel inside that screenshot.'), y: count('Vertical pixel inside that screenshot.'), button: text('Which mouse button to press.'), clickCount: count('How many clicks to send, 1 to 3.') }, ['screenshotId', 'x', 'y']),
  }),
  Object.freeze({
    name: 'bot_desktop_type', machineTool: 'desktop_type', capability: 'remote/desktop_type', mutating: true,
    description: 'Type text into the granted remote desktop. Unicode is sent directly, never through the clipboard; newline and tab become Enter and Tab.',
    parameters: objectSchema({ ...TARGET_KEYS, screenshotId: text('The screenshotId the most recent bot_desktop_screenshot returned.'), text: text('The text to type.') }, ['screenshotId', 'text']),
  }),
  Object.freeze({
    name: 'bot_desktop_key', machineTool: 'desktop_key', capability: 'remote/desktop_key', mutating: true,
    description: 'Press one key on the granted remote desktop, optionally with modifiers held.',
    parameters: objectSchema({ ...TARGET_KEYS, screenshotId: text('The screenshotId the most recent bot_desktop_screenshot returned.'), key: text('Which key to press.'), modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys to hold while the key is pressed.' } }, ['screenshotId', 'key']),
  }),
  Object.freeze({
    name: 'bot_desktop_scroll', machineTool: 'desktop_scroll', capability: 'remote/desktop_scroll', mutating: true,
    description: 'Scroll the granted remote desktop. 120 is one notch and positive scrolls up; x and y move the pointer onto the target first.',
    parameters: objectSchema({ ...TARGET_KEYS, screenshotId: text('The screenshotId the most recent bot_desktop_screenshot returned.'), delta: count('Wheel delta in notches of 120; positive scrolls up.'), x: count('Optional horizontal pixel to move the pointer to first.'), y: count('Optional vertical pixel to move the pointer to first.') }, ['screenshotId', 'delta']),
  }),
  Object.freeze({
    name: 'bot_remote_operation_status', machineTool: 'operation_status', capability: 'remote/operation_status', mutating: false,
    description: 'Read the current state of one operation this Host issued for this Bot conversation. The operationId must come from an earlier tool result; an unknown or still running operation is reported as such and never as a success.',
    parameters: objectSchema({ operationId: text('The operationId an earlier tool result returned.') }, ['operationId']),
  }),
  Object.freeze({
    name: 'bot_remote_operation_cancel', machineTool: 'operation_cancel', capability: 'remote/operation_cancel', mutating: true,
    description: 'Ask to stop one operation this Host issued for this Bot conversation. This is a stop request, not a confirmation: an already applied effect is not rolled back, and only stopConfirmed:true proves the action stopped.',
    parameters: objectSchema({ operationId: text('The operationId an earlier tool result returned.') }, ['operationId']),
  }),
])

export const NATIVE_REMOTE_TOOLS = CATALOG

const BY_NAME = new Map(CATALOG.map(entry => [entry.name, entry]))

/** One offered entry, or null. Frozen, so a caller cannot widen a schema at runtime. */
export const nativeRemoteToolEntry = name => BY_NAME.get(name) ?? null

const KEYS = Object.freeze(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
const BUTTONS = Object.freeze(['left', 'right', 'middle'])
const MODIFIERS = Object.freeze(['ctrl', 'alt', 'shift'])

/**
 * Bounds the schema deliberately does not carry. The installed SDK's schema validator is narrower
 * than JSON Schema, so numeric ranges stay here instead of in `parameters`, and this parser is the
 * only place a business argument is accepted.
 */
const LIMITS = Object.freeze({
  url: { maxLength: 2048, control: false },
  profileId: { pattern: /^[-A-Za-z0-9_.]{1,128}$/ },
  browserSessionId: { pattern: /^[-A-Za-z0-9_.]{1,128}$/ },
  snapshotId: { pattern: /^[-A-Za-z0-9_.]{1,128}$/ },
  ref: { pattern: /^\d{1,3}$/ },
  screenshotId: { pattern: /^[-A-Za-z0-9_.]{1,128}$/ },
  operationId: { pattern: /^[-A-Za-z0-9_.]{1,128}$/ },
  machineId: { pattern: /^[-A-Za-z0-9_.]{1,128}$/ },
  rootId: { pattern: /^[-A-Za-z0-9_.]{1,128}$/ },
  text: { maxLength: 65536, control: true },
  x: { min: 0, max: 100000 },
  y: { min: 0, max: 100000 },
  delta: { min: -1200, max: 1200 },
  clickCount: { min: 1, max: 3 },
  button: { enum: BUTTONS },
  key: { enum: KEYS },
  modifiers: { maxItems: 3, unique: true, items: { enum: MODIFIERS } },
})

/** Strict, offline argument parsing: no unknown key, no missing required key, no loose type. */
function parseToolArgs(entry, args) {
  const refuse = () => fail('INVALID_TOOL_ARGS', { tool: entry.name })
  if (!plain(args)) refuse()
  const { properties, required } = entry.parameters
  if (Object.keys(args).some(key => !Object.hasOwn(properties, key))) refuse()
  for (const key of required) if (!Object.hasOwn(args, key)) refuse()
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key], limit = LIMITS[key] ?? {}
    const types = [schema.type].flat()
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const integer = types.includes('integer') && Number.isSafeInteger(value)
    if (!types.includes(kind) && !integer) refuse()
    if (limit.enum && !limit.enum.includes(value)) refuse()
    if (typeof value === 'string') {
      if (limit.pattern && !limit.pattern.test(value)) refuse()
      if (limit.maxLength !== undefined && Buffer.byteLength(value) > limit.maxLength) refuse()
      // Control characters are only ever business content inside typed text.
      if (limit.control !== true && /[\u0000-\u001f\u007f]/.test(value)) refuse()
    }
    if (integer && (limit.min !== undefined && value < limit.min || limit.max !== undefined && value > limit.max)) refuse()
    if (schema.items) {
      if (!Array.isArray(value) || value.some(item => typeof item !== schema.items.type)) refuse()
      if (limit.maxItems !== undefined && value.length > limit.maxItems) refuse()
      if (limit.unique === true && new Set(value).size !== value.length) refuse()
      if (limit.items?.enum && value.some(item => !limit.items.enum.includes(item))) refuse()
    }
  }
  return args
}

const boundedId = (value, code) => {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > ID_LIMIT_BYTES || /[\u0000-\u001f\u007f]/.test(value)) fail(code)
  return value
}

/**
 * @param {{
 *   Database: Function,
 *   file: string,
 *   directory: { forBot: (botId: string) => unknown },
 *   authority: { assertTool: (subject: unknown, name: string) => void },
 *   machines: object | (() => object | null),
 *   now?: () => number,
 * }} options
 */
export function openNativeRemoteActions({ Database, file, directory, authority, machines, now = Date.now } = {}) {
  if (typeof Database !== 'function' || typeof file !== 'string' || !file) throw new TypeError('NATIVE_REMOTE_SERVICES_REQUIRED')
  if (!directory || typeof directory.forBot !== 'function') throw new TypeError('NATIVE_REMOTE_SERVICES_REQUIRED')
  if (!authority || typeof authority.assertTool !== 'function') throw new TypeError('NATIVE_REMOTE_SERVICES_REQUIRED')
  if (machines === undefined || machines === null) throw new TypeError('NATIVE_REMOTE_SERVICES_REQUIRED')
  if (typeof now !== 'function') throw new TypeError('NATIVE_REMOTE_SERVICES_REQUIRED')

  // The same orchestration SQLite file every other component uses, under this module's own prefix.
  const path = file === ':memory:' ? file : resolve(file)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('busy_timeout=5000')
  // WAL is a property of the file, already set by whoever opened it first; this connection only
  // refuses to run where it is unavailable, and keeps its own commits durable.
  if (path !== ':memory:' && db.pragma('journal_mode=WAL', { simple: true }) !== 'wal') { db.close(); fail('NATIVE_REMOTE_WAL_REQUIRED') }
  db.pragma('synchronous=FULL')
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS native_remote_component(component TEXT PRIMARY KEY,version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS native_remote_requests(request_key TEXT PRIMARY KEY,bot_id TEXT NOT NULL,conversation_id TEXT NOT NULL,turn_id TEXT NOT NULL,call_id TEXT NOT NULL,
          role TEXT NOT NULL,name TEXT NOT NULL,input_digest TEXT NOT NULL,machine_tool TEXT NOT NULL,operation_id TEXT,
          task_id TEXT NOT NULL,attempt_id TEXT NOT NULL,machine_id TEXT NOT NULL,root_id TEXT NOT NULL,status TEXT NOT NULL,value TEXT,error TEXT,artifact_id TEXT,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS native_remote_browser_sessions(browser_session_id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,conversation_id TEXT NOT NULL,machine_id TEXT NOT NULL,root_id TEXT NOT NULL,
          task_id TEXT NOT NULL,attempt_id TEXT NOT NULL,operation_id TEXT,request_key TEXT NOT NULL,status TEXT NOT NULL,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS native_remote_desktop_captures(screenshot_id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,conversation_id TEXT NOT NULL,machine_id TEXT NOT NULL,root_id TEXT NOT NULL,
          task_id TEXT NOT NULL,attempt_id TEXT NOT NULL,operation_id TEXT,artifact_id TEXT NOT NULL,sha256 TEXT,size INTEGER,media_type TEXT,request_key TEXT NOT NULL,created_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS native_remote_request_refs(request_key TEXT PRIMARY KEY,browser_session_id TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS native_remote_requests_scope ON native_remote_requests(bot_id,conversation_id,machine_id,root_id,status,created_ms);
        CREATE INDEX IF NOT EXISTS native_remote_requests_operation ON native_remote_requests(operation_id,role);
        CREATE INDEX IF NOT EXISTS native_remote_browser_sessions_owner ON native_remote_browser_sessions(bot_id,conversation_id,created_ms);
        CREATE INDEX IF NOT EXISTS native_remote_desktop_captures_owner ON native_remote_desktop_captures(bot_id,conversation_id,created_ms);`)
      const row = db.prepare('SELECT version FROM native_remote_component WHERE component=?').get('native-remote-actions')
      if (row && row.version !== SCHEMA_VERSION) fail('NATIVE_REMOTE_SCHEMA_UNSUPPORTED')
      db.prepare('INSERT OR IGNORE INTO native_remote_component VALUES(?,?)').run('native-remote-actions', SCHEMA_VERSION)
    }).immediate()
  } catch (error) { db.close(); throw error }

  let closed = false
  const alive = () => { if (closed) fail('NATIVE_REMOTE_JOURNAL_CLOSED') }
  const stmt = sql => { alive(); return db.prepare(sql) }
  const fenceStatuses = [...BLOCKING_STATUS]
  const q = {
    getRequest: stmt('SELECT * FROM native_remote_requests WHERE request_key=?'),
    findOperation: stmt("SELECT * FROM native_remote_requests WHERE operation_id=? AND bot_id=? AND conversation_id=? AND role='action'"),
    reserve: stmt(`INSERT INTO native_remote_requests(request_key,bot_id,conversation_id,turn_id,call_id,role,name,input_digest,machine_tool,operation_id,
      task_id,attempt_id,machine_id,root_id,status,value,error,artifact_id,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'reserved',NULL,NULL,NULL,?,?)`),
    dispatched: stmt("UPDATE native_remote_requests SET status='dispatched',updated_ms=? WHERE request_key=? AND status='reserved'"),
    settle: stmt('UPDATE native_remote_requests SET status=?,value=?,error=?,updated_ms=? WHERE request_key=?'),
    settleArtifact: stmt('UPDATE native_remote_requests SET status=?,value=?,error=?,artifact_id=?,updated_ms=? WHERE request_key=?'),
    fence: stmt(`SELECT operation_id,status,name,machine_tool FROM native_remote_requests WHERE bot_id=? AND conversation_id=? AND machine_id=? AND root_id=? AND role='action'
      AND operation_id IS NOT NULL AND request_key<>? AND status IN (${fenceStatuses.map(() => '?').join(',')}) ORDER BY created_ms,rowid LIMIT 1`),
    requestRef: stmt('SELECT browser_session_id FROM native_remote_request_refs WHERE request_key=?'),
    reserveRef: stmt('INSERT INTO native_remote_request_refs VALUES(?,?)'),
    session: stmt("SELECT * FROM native_remote_browser_sessions WHERE browser_session_id=? AND status='open'"),
    anySession: stmt('SELECT * FROM native_remote_browser_sessions WHERE browser_session_id=?'),
    openSession: stmt('INSERT INTO native_remote_browser_sessions(browser_session_id,bot_id,conversation_id,machine_id,root_id,task_id,attempt_id,operation_id,request_key,status,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,\'open\',?,?)'),
    closeSession: stmt("UPDATE native_remote_browser_sessions SET status='closed',updated_ms=? WHERE browser_session_id=? AND status='open'"),
    capture: stmt('SELECT * FROM native_remote_desktop_captures WHERE screenshot_id=?'),
    openCapture: stmt('INSERT INTO native_remote_desktop_captures(screenshot_id,bot_id,conversation_id,machine_id,root_id,task_id,attempt_id,operation_id,artifact_id,sha256,size,media_type,request_key,created_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    sessionCount: stmt('SELECT count(*) AS total FROM native_remote_browser_sessions'),
    captureCount: stmt('SELECT count(*) AS total FROM native_remote_desktop_captures'),
    sweepSessions: stmt(`DELETE FROM native_remote_browser_sessions WHERE browser_session_id NOT IN (SELECT browser_session_id FROM native_remote_browser_sessions ORDER BY created_ms DESC LIMIT ${SESSION_LIMIT})`),
    sweepCaptures: stmt(`DELETE FROM native_remote_desktop_captures WHERE screenshot_id NOT IN (SELECT screenshot_id FROM native_remote_desktop_captures ORDER BY created_ms DESC LIMIT ${CAPTURE_LIMIT})`),
  }

  /** In-process dispatches, so a concurrent duplicate waits for the original instead of repeating it. */
  const inflight = new Map()

  /** The machine directory, resolved per call: a Host may publish it late or replace it. */
  const machineStore = () => {
    const value = typeof machines === 'function' ? machines() : machines
    if (!value || typeof value.call !== 'function') fail('MACHINE_DIRECTORY_UNAVAILABLE')
    return value
  }

  const statusOf = value => value && typeof value.status === 'string' && AGENT_STATUS.has(value.status) ? value.status : null
  const codeOf = error => { const code = error?.code; return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,80}$/.test(code) ? code : 'NATIVE_REMOTE_TOOL_FAILED' }

  /**
   * One Agent answer, normalised. A mutating tool answers with its operation record; a read-only one
   * answers with the value itself, and that is not an operation envelope.
   */
  const normalizeRecord = (entry, record, target, operationId, original) => {
    const invalid = { status: 'unknown', value: null, result: null, error: 'NATIVE_REMOTE_PROTOCOL_INVALID' }
    if (!plain(record)) return invalid
    if (!entry.mutating && !isObservation(entry)) return { status: 'succeeded', value: record, result: record, error: null }
    const operation = entry.machineTool === 'operation_cancel' ? record.operation : record
    const expectedTool = original?.machine_tool ?? entry.machineTool
    if (!plain(operation) || operation.schemaVersion !== 1 || operation.machineId !== target.machineId
      || operation.operationId !== operationId || operation.tool !== expectedTool || !statusOf(operation)) return invalid
    return { status: operation.status, result: operation.result ?? null,
      value: entry.machineTool === 'operation_cancel' ? record : operation.result ?? null, error: operation.error?.code ?? null }
  }

  const validateImage = image => {
    if (!plain(image) || typeof image.content !== 'string' || !image.content) fail('NATIVE_REMOTE_IMAGE_INVALID')
    if (image.mediaType !== 'image/png') fail('NATIVE_REMOTE_IMAGE_INVALID', { mediaType: image.mediaType ?? null })
    const bytes = Buffer.from(image.content, 'base64')
    if (!bytes.length || bytes.toString('base64') !== image.content) fail('NATIVE_REMOTE_IMAGE_INVALID')
    if (bytes.length > IMAGE_LIMIT_BYTES) fail('NATIVE_REMOTE_IMAGE_LIMIT', { size: bytes.length })
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail('NATIVE_REMOTE_IMAGE_INVALID')
    return Object.freeze({ mimeType: 'image/png', data: image.content })
  }

  const view = (botId, conversationId) => {
    /** Live committed bindings for one Bot, straight from the machine directory. */
    const scopesFor = () => {
      const store = machineStore()
      const rows = typeof store.scopes === 'function' ? store.scopes(botId)
        : typeof store.bindingsFor === 'function' ? store.bindingsFor(botId) : []
      if (!Array.isArray(rows)) fail('MACHINE_DIRECTORY_UNREADABLE')
      return rows.filter(scope => scope && typeof scope.machineId === 'string' && Array.isArray(scope.tools) && Array.isArray(scope.roots))
    }

    /** The one live binding that can still run this entry against this exact machine and root. */
    const liveScopeFor = (entry, target) => scopesFor().some(scope => scope.machineId === target.machineId
      && scope.roots.includes(target.rootId)
      && pairedToolsOf(entry).every(tool => scope.tools.includes(tool))
      && (!requiresWrite(entry) || scope.mode === 'workspace-write'))

    /**
     * Live authority and live scope, both re-read. `soft` turns a refusal into `false` for the
     * post-await re-check, where the effect is already durable and must not be invented away.
     */
    const assertLive = (entry, target, { soft = false } = {}) => {
      try {
        const subject = directory.forBot(botId)
        for (const capability of requirementsOf(entry)) authority.assertTool(subject, capability)
        if (!liveScopeFor(entry, target)) fail('MACHINE_BOT_DENIED')
        return true
      } catch (error) {
        if (soft) return false
        throw error
      }
    }

    /** The target this call runs on: an explicitly named, still granted one, or the first live match. */
    const resolveTarget = (entry, args) => {
      const scopes = scopesFor()
      const usable = scopes.filter(scope => scope.roots.length && pairedToolsOf(entry).every(tool => scope.tools.includes(tool))
        && (!requiresWrite(entry) || scope.mode === 'workspace-write'))
      let chosen = usable
      if (args.machineId !== undefined) {
        if (!scopes.some(scope => scope.machineId === args.machineId)) fail('MACHINE_NOT_BOUND', { tool: entry.name })
        chosen = usable.filter(scope => scope.machineId === args.machineId)
        if (!chosen.length) fail('MACHINE_BOT_DENIED', { tool: entry.name, machineTool: entry.machineTool })
      }
      const scope = chosen[0]
      if (!scope) fail('MACHINE_NOT_BOUND', { tool: entry.name })
      if (args.rootId !== undefined && (typeof args.rootId !== 'string' || !scope.roots.includes(args.rootId))) fail('MACHINE_ROOT_NOT_BOUND', { tool: entry.name })
      const rootId = args.rootId ?? scope.roots[0]
      if (typeof rootId !== 'string' || !rootId) fail('MACHINE_ROOT_NOT_BOUND', { tool: entry.name })
      return { machineId: scope.machineId, rootId }
    }

    /** Only declared business keys cross the boundary; identity keys never do. */
    const businessArgs = (entry, parsed) => {
      const business = {}
      for (const key of Object.keys(entry.parameters.properties)) {
        if (key === 'machineId' || key === 'rootId') continue
        if (Object.hasOwn(parsed, key)) business[key] = parsed[key]
      }
      return business
    }

    /**
     * A continuation that names a target must name the one its own session or capture belongs to. A
     * machine this Bot was never paired with is refused as such; a granted one that disagrees with the
     * session is a mismatch, because the Agent bound that session to one task, attempt and root.
     */
    const namedTarget = (entry, parsed, target) => {
      if (parsed.machineId !== undefined && parsed.machineId !== target.machineId) {
        if (!scopesFor().some(scope => scope.machineId === parsed.machineId)) fail('MACHINE_NOT_BOUND', { tool: entry.name })
        fail('NATIVE_REMOTE_TARGET_MISMATCH', { machineId: parsed.machineId, bound: target.machineId })
      }
      if (parsed.rootId !== undefined && parsed.rootId !== target.rootId) fail('NATIVE_REMOTE_TARGET_MISMATCH', { rootId: parsed.rootId, bound: target.rootId })
    }

    const recordOf = row => ({
      operationId: row.operation_id ?? null,
      taskId: row.task_id,
      attemptId: row.attempt_id,
      status: row.status,
      value: row.value === null || row.value === undefined ? null : JSON.parse(row.value),
    })

    /** A dispatch this Host can no longer prove under the current grant: the record stays, the value does not travel. */
    const undelivered = (row, error) => ({
      operationId: row.operation_id ?? null, taskId: row.task_id, attemptId: row.attempt_id,
      status: row.status, value: null, error, nextAction: NEXT_ACTION,
    })

    const persist = (requestKey, status, value, error, artifactId) => {
      const encoded = value === null || value === undefined ? null : JSON.stringify(value)
      try {
        if (artifactId === undefined) q.settle.run(status, encoded, error ?? null, now(), requestKey)
        else q.settleArtifact.run(status, encoded, error ?? null, artifactId, now(), requestKey)
      } catch { /* a closed journal keeps its reservation; the Host reconciles it */ }
    }

    /** A successful open or capture is the only thing that may authorise a later continuation. */
    const register = (entry, requestKey, target, taskId, attemptId, operationId, value, sessionId) => {
      if (entry.machineTool === 'browser_open') {
        if (!ref(value?.browserSessionId)) fail('NATIVE_REMOTE_PROTOCOL_INVALID', { tool: entry.name })
        const existing = q.anySession.get(value.browserSessionId)
        if (existing) {
          if (existing.bot_id !== botId || existing.conversation_id !== conversationId || existing.request_key !== requestKey) fail('NATIVE_REMOTE_PROTOCOL_INVALID')
          return
        }
        q.openSession.run(value.browserSessionId, botId, conversationId, target.machineId, target.rootId, taskId, attemptId, operationId, requestKey, now(), now())
        if (q.sessionCount.get().total > SESSION_LIMIT) q.sweepSessions.run()
        return
      }
      if (entry.machineTool === 'browser_close') {
        if (ref(sessionId)) q.closeSession.run(now(), sessionId)
        return
      }
      if (entry.machineTool === 'desktop_screenshot') {
        if (!ref(value?.screenshotId) || !ref(value?.artifactId)) fail('NATIVE_REMOTE_PROTOCOL_INVALID', { tool: entry.name })
        const existing = q.capture.get(value.screenshotId)
        if (existing) {
          if (existing.bot_id !== botId || existing.conversation_id !== conversationId || existing.request_key !== requestKey || existing.artifact_id !== value.artifactId) fail('NATIVE_REMOTE_PROTOCOL_INVALID')
          return
        }
        q.openCapture.run(value.screenshotId, botId, conversationId, target.machineId, target.rootId, taskId, attemptId, operationId,
          value.artifactId, value.sha256 ?? null, Number.isSafeInteger(value.size) ? value.size : null, value.mediaType ?? null, requestKey, now())
        if (q.captureCount.get().total > CAPTURE_LIMIT) q.sweepCaptures.run()
      }
    }

    /** The original artifact of a completed capture, over the context it was captured under. */
    const downloadImage = async (row, signal) => {
      const downloaded = await machineStore().download(directory.forBot(botId), {
        machineId: row.machine_id, rootId: row.root_id, taskId: row.task_id, attemptId: row.attempt_id,
        operationId: row.operation_id, artifactId: row.artifact_id,
      }, { signal })
      const image = validateImage(downloaded)
      if (downloaded.artifactId !== row.artifact_id) fail('NATIVE_REMOTE_IMAGE_INVALID')
      if (row.sha256 && downloaded.sha256 !== row.sha256) fail('NATIVE_REMOTE_IMAGE_INVALID')
      if (row.size !== null && row.size !== undefined && downloaded.size !== row.size) fail('NATIVE_REMOTE_IMAGE_INVALID')
      return image
    }

    /**
     * What a finished row delivers now. A completed screenshot may download its original artifact
     * again; it is never recaptured, and the pixels are never persisted.
     */
    const deliver = async (row, signal) => {
      const entry = nativeRemoteToolEntry(row.name)
      const target = { machineId: row.machine_id, rootId: row.root_id }
      if (!assertLive(entry, target, { soft: true })) return undelivered(row, 'NATIVE_REMOTE_AUTHORITY_LOST')
      const record = recordOf(row)
      if (record.status !== 'succeeded') {
        return { ...record, ...(row.error ? { error: row.error } : {}), ...(BLOCKING_STATUS.has(record.status) ? { nextAction: NEXT_ACTION } : {}) }
      }
      if (entry.machineTool === 'desktop_screenshot' && row.artifact_id) {
        const image = await downloadImage(row, signal)
        if (!assertLive(entry, target, { soft: true })) return undelivered(row, 'NATIVE_REMOTE_AUTHORITY_LOST')
        return { ...record, image }
      }
      return record
    }

    /**
     * One tool call. Pre-dispatch refusals throw with the operation identity attached; anything that
     * may already have been dispatched is returned as a record, never as a success it is not.
     */
    const call = async (name, args = {}, context = {}) => {
      alive()
      const entry = nativeRemoteToolEntry(name)
      if (!entry) fail('TOOL_NOT_GRANTED', { tool: String(name) })
      const parsed = parseToolArgs(entry, args)
      const turnId = boundedId(context.turnId, 'NATIVE_REMOTE_TURN_REQUIRED')
      const callId = boundedId(context.callId, 'NATIVE_REMOTE_TURN_REQUIRED')
      const signal = context.signal ?? null
      try { signal?.throwIfAborted() } catch { fail('NATIVE_REMOTE_CANCELLED') }
      // The Bot itself is a Host fact, resolved here rather than inside the dispatch, so an unknown
      // or retired Bot is refused before a request key is reserved at all.
      const subject = directory.forBot(botId)
      const business = businessArgs(entry, parsed)
      const observation = isObservation(entry)
      const family = familyOf(entry)

      // The target, and with it the Agent identity this call runs under. A browser continuation or a
      // desktop action runs on the target its own session or capture was issued on; anything else
      // chooses from the live bindings. A named machine or root that disagrees is a refusal, not a
      // silent retarget.
      let original = null, target, taskId, attemptId, operationId = null, role = 'action'
      if (observation) {
        original = q.findOperation.get(parsed.operationId, botId, conversationId)
        if (!original) fail('NATIVE_REMOTE_OPERATION_UNKNOWN', { operationId: parsed.operationId })
        target = { machineId: original.machine_id, rootId: original.root_id }
        taskId = original.task_id
        attemptId = original.attempt_id
        operationId = original.operation_id
        role = 'observation'
        assertLive(entry, target)
      } else if (family === 'browser' && entry.machineTool !== 'browser_open') {
        const session = q.session.get(parsed.browserSessionId)
        if (!session || session.bot_id !== botId || session.conversation_id !== conversationId) {
          fail('NATIVE_REMOTE_BROWSER_SESSION_UNKNOWN', { browserSessionId: parsed.browserSessionId })
        }
        target = { machineId: session.machine_id, rootId: session.root_id }
        namedTarget(entry, parsed, target)
        taskId = session.task_id
        attemptId = session.attempt_id
        if (entry.mutating) operationId = derived('nro', [botId, conversationId, turnId, callId])
        assertLive(entry, target)
      } else if (family === 'desktop' && entry.machineTool !== 'desktop_screenshot') {
        const capture = q.capture.get(parsed.screenshotId)
        if (!capture || capture.bot_id !== botId || capture.conversation_id !== conversationId) {
          fail('NATIVE_REMOTE_SCREENSHOT_UNKNOWN', { screenshotId: parsed.screenshotId })
        }
        target = { machineId: capture.machine_id, rootId: capture.root_id }
        namedTarget(entry, parsed, target)
        taskId = capture.task_id
        attemptId = capture.attempt_id
        if (entry.mutating) operationId = derived('nro', [botId, conversationId, turnId, callId])
        assertLive(entry, target)
      } else {
        target = resolveTarget(entry, parsed)
        taskId = derived('nrt', [botId, conversationId, target.machineId, target.rootId])
        attemptId = derived('nra', [botId, conversationId, target.machineId, target.rootId])
        // A read-only snapshot of a page carries no Agent operation envelope at all.
        if (entry.mutating) operationId = derived('nro', [botId, conversationId, turnId, callId])
      }
      assertLive(entry, target)

      const requestKey = derived('nrq', [botId, conversationId, turnId, callId])
      const digest = hex(JSON.stringify([entry.name, target.machineId, target.rootId, business]))

      // An unsettled mutation of this very context fences the next one: the Agent, not this Host,
      // decides what happened to the first.
      const reserved = db.transaction(() => {
        const existing = q.getRequest.get(requestKey)
        if (existing) return existing
        if (requiresWrite(entry)) {
          const fenced = q.fence.get(botId, conversationId, target.machineId, target.rootId, requestKey, ...fenceStatuses)
          if (fenced) fail('NATIVE_REMOTE_OPERATION_PENDING', {
            operationId: fenced.operation_id, status: fenced.status, tool: fenced.name, machineTool: fenced.machine_tool, nextAction: NEXT_ACTION,
          })
        }
        q.reserve.run(requestKey, botId, conversationId, turnId, callId, role, entry.name, digest, entry.machineTool, operationId,
          taskId, attemptId, target.machineId, target.rootId, now(), now())
        if (parsed.browserSessionId) q.reserveRef.run(requestKey, parsed.browserSessionId)
        return null
      }).immediate()

      if (reserved) {
        if (reserved.name !== entry.name || reserved.input_digest !== digest) {
          fail('NATIVE_REMOTE_REQUEST_CONFLICT', { requestKey, name: reserved.name, tool: entry.name })
        }
        if (reserved.role === 'observation') {
          const record = recordOf(reserved)
          return { ...record, ...(reserved.error ? { error: reserved.error } : {}), ...(BLOCKING_STATUS.has(record.status) ? { nextAction: NEXT_ACTION } : {}) }
        }
        // Identical request: the original record is the answer, and nothing is dispatched again.
        if (TERMINAL_STATUS.has(reserved.status)) return await deliver(reserved, signal)
        const running = inflight.get(reserved.request_key)
        if (running) return await running
        const record = recordOf(reserved)
        const unsettled = PENDING_STATUS.has(record.status)
        return {
          ...record, status: unsettled ? 'unknown' : record.status, value: unsettled ? null : record.value,
          error: reserved.error ?? 'NATIVE_REMOTE_OUTCOME_UNKNOWN', nextAction: NEXT_ACTION,
        }
      }

      const work = async () => {
        let record = null, thrown = null
        // The directory is resolved before anything is marked dispatched, so a Host that lost it is a
        // pre-dispatch refusal rather than an unknown outcome.
        const store = machineStore()
        try {
          q.dispatched.run(now(), requestKey)
          // A turn cancelled before dispatch never reached the machine: that is provable here, in
          // this process, and it is the only kind of failure that may be called failed.
          try { signal?.throwIfAborted() } catch (error) {
            const code = codeOf(error)
            persist(requestKey, 'failed', null, code, undefined)
            return { operationId, taskId, attemptId, status: 'failed', value: null, error: code }
          }
          record = await store.call(subject, {
            machineId: target.machineId, rootId: target.rootId, taskId, attemptId, tool: entry.machineTool, args: business,
            ...(operationId ? { operationId } : {}),
          }, { signal })
        } catch (error) { thrown = error }
        if (thrown) {
          const notSent = thrown?.remoteDispatchNotSent === true
          const code = codeOf(thrown)
          const settled = notSent || !operationId
          const status = settled ? 'failed' : 'unknown'
          persist(requestKey, status, null, code, undefined)
          return { operationId, taskId, attemptId, status, value: null, error: code, ...(settled ? {} : { nextAction: NEXT_ACTION }) }
        }
        const outcome = normalizeRecord(entry, record, target, operationId, original)
        const issuedKey = observation ? original.request_key : requestKey
        const issuedEntry = observation ? nativeRemoteToolEntry(original.name) : entry
        if (outcome.status === 'succeeded') {
          try {
            register(issuedEntry, issuedKey, target, taskId, attemptId, operationId, outcome.result,
              observation ? q.requestRef.get(issuedKey)?.browser_session_id : parsed.browserSessionId)
          } catch {
            outcome.status = 'unknown'; outcome.value = outcome.result = null; outcome.error = 'NATIVE_REMOTE_PROTOCOL_INVALID'
          }
        }
        persist(issuedKey, outcome.status, outcome.result,
          outcome.status === 'succeeded' ? null : outcome.error, outcome.result?.artifactId)
        if (observation) persist(requestKey, outcome.status, outcome.value, outcome.status === 'succeeded' ? null : outcome.error, undefined)
        const row = q.getRequest.get(observation ? original.request_key : requestKey)
        if (!assertLive(entry, target, { soft: true })) return undelivered(row, 'NATIVE_REMOTE_AUTHORITY_LOST')
        const base = {
          operationId, taskId, attemptId, status: outcome.status, value: outcome.value,
          ...(outcome.status === 'succeeded' ? {} : { error: outcome.error ?? 'NATIVE_REMOTE_TOOL_FAILED' }),
        }
        // A status the Agent itself reports as unsettled is not a terminal answer: the operation keeps
        // its identity and the caller is told to reconcile it rather than to repeat it.
        if (BLOCKING_STATUS.has(outcome.status)) base.nextAction = NEXT_ACTION
        if (issuedEntry.machineTool === 'desktop_screenshot' && outcome.status === 'succeeded' && row.artifact_id) {
          if (!assertLive(issuedEntry, target, { soft: true })) return undelivered(row, 'NATIVE_REMOTE_AUTHORITY_LOST')
          const image = await downloadImage(row, signal)
          if (!assertLive(issuedEntry, target, { soft: true })) return undelivered(row, 'NATIVE_REMOTE_AUTHORITY_LOST')
          return { ...base, image }
        }
        return base
      }

      const pending = work()
      inflight.set(requestKey, pending)
      try { return await pending } finally { inflight.delete(requestKey) }
    }

    return Object.freeze({
      botId,
      conversationId,
      /** The schemas this conversation may see right now, re-decided from committed state. */
      schemas() {
        alive()
        // A grant the authority no longer holds removes the tool from the request, so a withdrawn
        // capability is never something the model discovers one refusal at a time.
        const granted = entry => {
          let subject = null
          try { subject = directory.forBot(botId) } catch { return false }
          return requirementsOf(entry).every(capability => {
            try { authority.assertTool(subject, capability); return true } catch { return false }
          })
        }
        const offered = []
        for (const entry of CATALOG) {
          const scopes = scopesFor()
          if (isObservation(entry)) {
            // Reconciliation is mounted from committed grants alone. It has to be available before
            // the first operation is issued, or a model could not read the one it is about to create.
            if (!scopes.some(scope => scope.tools.includes(entry.machineTool)) || !granted(entry)) continue
            offered.push(entry)
            continue
          }
          if (!scopes.some(scope => scope.roots.length && pairedToolsOf(entry).every(tool => scope.tools.includes(tool))
            && (!requiresWrite(entry) || scope.mode === 'workspace-write')) || !granted(entry)) continue
          offered.push(entry)
        }
        return offered.map(entry => Object.freeze({ name: entry.name, description: entry.description, parameters: entry.parameters }))
      },
      call,
    })
  }

  return Object.freeze({
    /**
     * One conversation's live surface. Both methods re-read committed grants, so a cached view can
     * never freeze an older grant into a turn.
     */
    forConversation(botId, conversationId) {
      const bot = boundedId(botId, 'NATIVE_REMOTE_BOT_REQUIRED')
      const conversation = boundedId(conversationId, 'NATIVE_REMOTE_CONVERSATION_REQUIRED')
      return view(bot, conversation)
    },
    /**
     * Dispose this service. Nothing remote is stopped and nothing is replayed: an operation still in
     * flight keeps its identity and its evidence, and the Host reconciles it.
     */
    close() {
      if (closed) return
      closed = true
      inflight.clear()
      try { db.close() } catch { /* already closed */ }
    },
  })
}
