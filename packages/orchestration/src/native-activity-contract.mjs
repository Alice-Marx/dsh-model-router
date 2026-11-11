// Display-only contract for the native tool-activity surface.
//
// Production module. Nothing here requires SQLite, opens a file, loads a native
// binding or executes anything: it is pure validation, pure projection and pure
// causal record rules. The durable store (native-activity-store.mjs) and the
// owner-facing service (native-activity-service.mjs) build on it.
//
// What the ACTUAL engine publishes today (packages/bot-engines/src/claude-engine.mjs):
//
//   events.emit('tool', { phase: 'started',   id, name })            // line 447
//   events.emit('tool', { phase: 'completed', id, ok })              // line 451
//
// That is the whole event. There is no `input`, no result body, no text, no
// screenshot and no error text on it, so this contract never claims any of
// those. `ok` is the CLI's own `is_error !== true`: it reports what the CLI
// said about the call, and nothing about whether a remote operation finished,
// was stopped, or was even started.
//
// Four rules this file exists to enforce:
//
//   1. Identity is Host-selected, never derived from the event or from model
//      arguments. The Host mints an opaque, restart-safe `processGeneration`
//      string per native engine instance plus launch; a tool id may be reused
//      by the CLI across turns and process generations, so it is never a key
//      on its own.
//   2. The projection is display-only. It emits no SDK executable tool-call
//      chunk, never touches model messages, receipts, funding or tool
//      dispatch, and carries no raw parameters, results, pixels or Host paths.
//   3. Uncertainty stays uncertainty. A call with no CLI return is not green, a
//      cancel request is not a confirmed stop, and a duplicate or late event is
//      counted rather than silently rewritten.
//   4. A read is a read. Every function here either validates input or derives
//      output from the record it was given; none of them writes, prunes,
//      recovers, executes or resends.

import { createHash } from 'node:crypto'

export const ACTIVITY_SCHEMA_VERSION = 1

/** The two chat runtimes that may report activity. */
export const ACTIVITY_MODES = Object.freeze(['integration', 'independent'])

/** The only two phases the real engine emits today. Nothing else is invented. */
export const ACTIVITY_EVENT_PHASES = Object.freeze(['started', 'completed'])

/** Display states. `turn-unconfirmed` is the honest terminal state of an unreturned call. */
export const ACTIVITY_STATES = Object.freeze(['running', 'cli-ok', 'cli-error', 'turn-unconfirmed'])

/** Turn outcomes the Host may report. The store never derives one. */
export const ACTIVITY_TURN_OUTCOMES = Object.freeze(['succeeded', 'failed', 'cancelled', 'unknown', 'refused', 'host-closed', 'host-lost'])

/** Sentinel for a fact the event did not carry. Never rendered as a success. */
export const ACTIVITY_UNRECORDED = 'unrecorded'

export const ACTIVITY_LIMITS = Object.freeze({
  maxToolNameChars: 128,
  maxCallIdChars: 256,
  maxIdentityChars: 128,
  maxProcessGenerationChars: 128,
  maxSessionIdChars: 256,
  maxRecentVisible: 4,
  defaultPageSize: 20,
  maxPageSize: 50,
  maxCallsPerTurn: 64,
  maxTurnsPerConversation: 512,
  maxRecords: 20_000,
  maxUnprojectedNames: 8,
})

/**
 * Fields a tool event may carry that this contract refuses to project. A richer future
 * engine event is projected by whitelist, and anything on this list is reported as
 * `unprojected` instead of being smuggled into a display row.
 */
export const ACTIVITY_UNPROJECTED_FIELDS = Object.freeze([
  'input', 'inputs', 'args', 'arguments', 'params', 'result', 'results', 'content', 'output',
  'text', 'body', 'stdout', 'stderr', 'diff', 'error', 'errorText', 'errors', 'screenshot',
  'image', 'images', 'pixels', 'base64', 'dataUri', 'path', 'paths', 'command', 'cmd', 'url',
  'endpoint', 'token', 'credential', 'secret', 'env', 'usage', 'cost', 'costUsd', 'session',
  'messageId', 'message', 'messages', 'toolCall', 'toolCalls',
])

/** Closed key set of a projected event. `assertDisplayOnly` enforces exactly this. */
const EVENT_KEYS = Object.freeze([
  'schemaVersion', 'phase', 'callId', 'callIdRecorded', 'toolName', 'toolNameRecorded',
  'toolNameTruncated', 'redacted', 'ok', 'unprojected', 'unprojectedCount',
])

/** Closed key set of a projected display record. */
const RECORD_KEYS = Object.freeze([
  'schemaVersion', 'callKey', 'botId', 'mode', 'conversationId', 'contextId',
  'processGeneration', 'turnId', 'callId', 'callIdRecorded', 'toolName',
  'toolNameRecorded', 'toolNameTruncated', 'redacted', 'state', 'cliOk', 'startedAt',
  'endedAt', 'updatedAt', 'turnSettled', 'turnOutcome', 'cancelRequested',
  'cancelRequestedAt', 'stopConfirmed', 'stopConfirmedAt', 'lateCliReturn', 'lateCliOk',
  'duplicateStarts', 'duplicateCompletions',
])

/** Closed key set of a turn summary. */
const SUMMARY_KEYS = Object.freeze(['schemaVersion', 'turnKey', 'turnOpen', 'calls', 'byState', 'current', 'recent', 'recentTruncated'])

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/
const BOT_ID = /^[A-Za-z0-9_.-]{1,128}$/
const PROCESS_GENERATION = /^[A-Za-z0-9_.:-]{1,128}$/
const SESSION_ID = /^[^\s\u0000-\u001f\u007f]{1,256}$/
const HOST_CONVERSATION = /^host-[a-f0-9]{64}$/
const CONTROL = /[\u0000-\u001f\u007f]/
const IDENTITY_FIELDS = Object.freeze(['botId', 'mode', 'conversationId', 'contextId', 'processGeneration', 'turnId'])

const coded = (code, detail) => Object.assign(new TypeError(detail === undefined ? code : `${code}: ${detail}`), { code })
const fail = code => { throw coded(code) }
const boundedString = (value, pattern, code) => {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code)
  return value
}
const digest = (...parts) => createHash('sha256').update(parts.join('\u001f')).digest('hex')

/** What each display state proves and what it explicitly does not prove. */
export const ACTIVITY_STATE_LABELS = Object.freeze({
  running: Object.freeze({
    zh: '进行中', en: 'running',
    proves: 'CLI 已开始这个调用', provesEn: 'the CLI started this call',
    notProves: '没有结果，也不代表远端操作已开始', notProvesEn: 'no result yet, and no proof a remote operation started',
  }),
  'cli-ok': Object.freeze({
    zh: 'CLI 报告成功', en: 'CLI reported ok',
    proves: 'CLI 的 tool_result 未标记错误', provesEn: 'the CLI tool_result was not an error',
    notProves: '不证明远端操作完成或已停止', notProvesEn: 'no proof the remote operation finished or stopped',
  }),
  'cli-error': Object.freeze({
    zh: 'CLI 报告失败', en: 'CLI reported error',
    proves: 'CLI 的 tool_result 标记了错误', provesEn: 'the CLI tool_result was an error',
    notProves: '不证明远端操作已停止或未开始', notProvesEn: 'no proof the remote operation stopped or never started',
  }),
  'turn-unconfirmed': Object.freeze({
    zh: '本回合未确认', en: 'turn unconfirmed',
    proves: '回合已结束而该调用没有 CLI 返回', provesEn: 'the turn ended with no CLI return for this call',
    notProves: '不推断成功或失败', notProvesEn: 'no success or failure is inferred',
  }),
})

/** The honest statements every reader of this contract must keep. */
export const ACTIVITY_DISCLAIMERS = Object.freeze({
  noDetail: '当前引擎工具事件只有 id/name/phase/ok；没有参数、结果正文、错误文本或截图，本契约不展示任何这些内容。',
  noDetailEn: 'the engine tool event carries only id/name/phase/ok; no parameters, result body, error text or screenshot is projected',
  cancelIsNotStop: '取消请求不是已停止确认；停止只由宿主真实的停止证据确认。',
  cancelIsNotStopEn: 'a cancel request is not a confirmed stop; only real Host stop evidence confirms one',
  duplicates: '重复的开始/完成事件不重复行，只计数；先到的 CLI 返回保留，不声称哪一个更权威。',
  duplicatesEn: 'duplicate start/complete events are counted, never duplicated; the first CLI return is kept and neither is claimed authoritative',
  lateEvents: '回合结束后的迟到事件只作为迟到证据记录，不改变该回合已确定的终态。',
  lateEventsEn: 'an event arriving after the turn ended is recorded as late evidence and does not change that turn terminal state',
  displayOnly: '只供展示；不产生 SDK 可执行工具调用块，不改写模型消息、收据、资金或工具派发。',
  displayOnlyEn: 'display only; no SDK executable tool-call chunk, no change to model messages, receipts, funding or tool dispatch',
  generation: 'processGeneration 是宿主为每次引擎实例随机铸造的不透明串；重启后旧代次的待确认行不会被新事件回答。',
  generationEn: 'processGeneration is an opaque per-engine-instance string the Host mints at random; after a restart a pending row from an older generation is never answered by a newer one',
})

/**
 * Validate a Host-selected activity identity. The field set is closed: an identity that
 * arrives with an extra field is refused rather than partially trusted. A caller can only
 * reach this function with values the Host itself chose.
 *
 * `processGeneration` is an OPAQUE Host-minted string, never a counter: the parent mints a
 * random engine id plus launch identity, so a restart or a second engine instance can never
 * reuse a generation, and a resettable integer could silently merge two engines' turns.
 *
 * @param {{botId:string, mode:string, conversationId:string, contextId?:string|null,
 *          processGeneration:string, turnId:string}} value
 */
export function activityIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ACTIVITY_IDENTITY_REQUIRED')
  const extra = Object.keys(value).filter(key => !IDENTITY_FIELDS.includes(key))
  if (extra.length) fail('ACTIVITY_IDENTITY_UNKNOWN_FIELD')
  const botId = boundedString(value.botId, BOT_ID, 'ACTIVITY_BOT_ID_INVALID')
  if (!ACTIVITY_MODES.includes(value.mode)) fail('ACTIVITY_MODE_INVALID')
  const conversationId = boundedString(value.conversationId, IDENTIFIER, 'ACTIVITY_CONVERSATION_ID_INVALID')
  const contextId = value.contextId === undefined || value.contextId === null
    ? null
    : boundedString(value.contextId, IDENTIFIER, 'ACTIVITY_CONTEXT_ID_INVALID')
  // Integration mode has no independent context, and its conversation is the Host's own
  // hash of the owner-selected sessionId. Independent mode's conversation IS the context.
  if (value.mode === 'integration') {
    if (contextId !== null) fail('ACTIVITY_INTEGRATION_CONTEXT_REFUSED')
    if (!HOST_CONVERSATION.test(conversationId)) fail('ACTIVITY_CONVERSATION_ID_INVALID')
  }
  if (value.mode === 'independent' && (contextId === null || contextId !== conversationId)) fail('ACTIVITY_INDEPENDENT_CONTEXT_INVALID')
  const processGeneration = boundedString(value.processGeneration, PROCESS_GENERATION, 'ACTIVITY_PROCESS_GENERATION_INVALID')
  const turnId = boundedString(value.turnId, IDENTIFIER, 'ACTIVITY_TURN_ID_INVALID')
  return Object.freeze({ botId, mode: value.mode, conversationId, contextId, processGeneration, turnId })
}

/** The durable turn key: the same closed tuple as the call key, minus the call id. */
export function activityTurnKey(identity) {
  return `turn1-${digest('dsh-native-activity-turn-v1', identity.mode, identity.botId, identity.conversationId, identity.contextId ?? '-', identity.processGeneration, identity.turnId)}`
}

/**
 * The durable per-call key. The CLI call id is only ever one component: the same id in
 * another turn, another conversation or another native process generation hashes to a
 * different key, so it cannot collide with or overwrite this one.
 */
export function activityCallKey(identity, callId) {
  const id = boundedString(callId, /^[^\s\u0000-\u001f\u007f]{1,256}$/, 'ACTIVITY_CALL_ID_INVALID')
  return `call1-${digest('dsh-native-activity-call-v1', identity.mode, identity.botId, identity.conversationId, identity.contextId ?? '-', identity.processGeneration, identity.turnId, id)}`
}

/** The integration-mode conversation id: the Host's own hash of the owner-selected sessionId. */
export const hostConversationId = sessionId => {
  boundedString(sessionId, SESSION_ID, 'ACTIVITY_SESSION_ID_INVALID')
  return `host-${createHash('sha256').update(sessionId).digest('hex')}`
}

/**
 * Bound a CLI tool name for display. A name the event did not carry becomes the
 * `unrecorded` sentinel with `recorded:false`; it is never replaced by a guess.
 */
export function boundedToolName(value) {
  if (typeof value !== 'string') return { name: ACTIVITY_UNRECORDED, recorded: false, truncated: false, redacted: false }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!cleaned) return { name: ACTIVITY_UNRECORDED, recorded: false, truncated: false, redacted: value.length > 0 }
  const truncated = cleaned.length > ACTIVITY_LIMITS.maxToolNameChars
  const name = truncated ? cleaned.slice(0, ACTIVITY_LIMITS.maxToolNameChars) : cleaned
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(name)) return { name: ACTIVITY_UNRECORDED, recorded: false, truncated, redacted: true }
  return { name, recorded: true, truncated, redacted: name !== value }
}

/**
 * Project one raw engine tool event. Whitelist-only: nothing outside `phase`, `id`,
 * `name` and `ok` survives, and every refused field is reported back to the caller so a
 * richer future event cannot quietly widen what a display row claims.
 *
 * @param {{phase:string, id?:unknown, name?:unknown, ok?:unknown}} event
 * @param {{redactToolName?:(name:string)=>string|null}} [policy] trusted Host redaction
 */
export function toolEventProjection(event, policy = null) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail('ACTIVITY_EVENT_REQUIRED')
  if (!ACTIVITY_EVENT_PHASES.includes(event.phase)) fail('ACTIVITY_EVENT_PHASE_UNKNOWN')
  const unprojected = Object.keys(event).filter(key => !['phase', 'id', 'name', 'ok'].includes(key) && ACTIVITY_UNPROJECTED_FIELDS.includes(key))
  const unprojectedCount = unprojected.length
  const listed = unprojected.slice(0, ACTIVITY_LIMITS.maxUnprojectedNames)
  if (event.phase === 'completed' && typeof event.ok !== 'boolean') fail('ACTIVITY_EVENT_OK_REQUIRED')
  const callIdRecorded = typeof event.id === 'string' && event.id.length > 0
  const callId = callIdRecorded && /^[^\s\u0000-\u001f\u007f]{1,256}$/.test(event.id) ? event.id : null
  const bounded = boundedToolName(event.phase === 'started' ? event.name : undefined)
  let toolName = bounded.name
  let redacted = bounded.redacted
  if (bounded.recorded && typeof policy?.redactToolName === 'function') {
    const replacement = policy.redactToolName(bounded.name)
    if (typeof replacement === 'string') {
      const rebounded = boundedToolName(replacement)
      toolName = rebounded.name
      redacted = redacted || replacement !== bounded.name || rebounded.redacted
    } else if (replacement === null) {
      toolName = ACTIVITY_UNRECORDED
      redacted = true
    } else fail('ACTIVITY_REDACTION_INVALID')
  }
  return Object.freeze({
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    phase: event.phase,
    callId,
    callIdRecorded,
    toolName,
    toolNameRecorded: bounded.recorded && toolName !== ACTIVITY_UNRECORDED,
    toolNameTruncated: bounded.truncated,
    redacted,
    ok: event.phase === 'completed' ? event.ok : null,
    unprojected: Object.freeze(listed),
    unprojectedCount,
  })
}

/** The initial record of an observed call. Always `running`: a start is not a result. */
export function activityRecordFromEvent(identity, projection, at) {
  if (!Number.isSafeInteger(at)) fail('ACTIVITY_TIME_REQUIRED')
  if (projection.callId === null) fail('ACTIVITY_CALL_ID_MISSING')
  return Object.freeze({
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    callKey: activityCallKey(identity, projection.callId),
    botId: identity.botId, mode: identity.mode, conversationId: identity.conversationId,
    contextId: identity.contextId, processGeneration: identity.processGeneration, turnId: identity.turnId,
    callId: projection.callId, callIdRecorded: projection.callIdRecorded,
    toolName: projection.toolName, toolNameRecorded: projection.toolNameRecorded,
    toolNameTruncated: projection.toolNameTruncated, redacted: projection.redacted,
    state: 'running', cliOk: null, startedAt: at, endedAt: null, updatedAt: at,
    turnSettled: false, turnOutcome: null, cancelRequested: false, cancelRequestedAt: null,
    stopConfirmed: false, stopConfirmedAt: null, lateCliReturn: false, lateCliOk: null,
    duplicateStarts: 0, duplicateCompletions: 0,
  })
}

const withRecord = (record, patch) => Object.freeze({ ...record, ...patch, updatedAt: patch.updatedAt ?? record.updatedAt })

/**
 * Apply one projected event to one record. Pure: the input record is never mutated.
 *
 * Causal rules, each of which a caller can assert on:
 *   - a second `started` for the same call is counted, never a second row;
 *   - the first CLI return wins and later returns are counted, because this contract
 *     cannot tell which of two returns the CLI meant;
 *   - a return that arrives after the turn already ended is late evidence: it is recorded
 *     beside the call and the turn's terminal state is left alone;
 *   - nothing here ever turns `running` into a success.
 *
 * @param {object} record
 * @param {object} projection from {@link toolEventProjection}
 * @param {{turnOpen:boolean, at:number}} context
 * @returns {{record:object, changed:boolean, reason:string}}
 */
export function applyToolEvent(record, projection, { turnOpen, at }) {
  if (!record || typeof record !== 'object') fail('ACTIVITY_RECORD_REQUIRED')
  if (!Number.isSafeInteger(at)) fail('ACTIVITY_TIME_REQUIRED')
  if (projection.phase === 'started') {
    if (record.state !== 'running') {
      return { record, changed: false, reason: 'late-start-after-terminal' }
    }
    return { record: withRecord(record, { duplicateStarts: record.duplicateStarts + 1 }), changed: false, reason: 'duplicate-start' }
  }
  if (record.cliOk !== null) {
    return { record: withRecord(record, { duplicateCompletions: record.duplicateCompletions + 1 }), changed: false, reason: 'duplicate-completion' }
  }
  if (turnOpen !== true || record.turnSettled === true) {
    return {
      record: withRecord(record, { lateCliReturn: true, lateCliOk: projection.ok, updatedAt: at }),
      changed: true,
      reason: 'late-completion-after-turn-end',
    }
  }
  return {
    record: withRecord(record, {
      cliOk: projection.ok,
      state: projection.ok ? 'cli-ok' : 'cli-error',
      endedAt: at,
      updatedAt: at,
    }),
    changed: true,
    reason: projection.ok ? 'cli-completed-ok' : 'cli-completed-error',
  }
}

/**
 * Close a turn. A call that never received a CLI return becomes `turn-unconfirmed`; it is
 * never painted green by the turn ending. `cancelRequested` and `stopConfirmed` are only
 * ever set from Host facts, and neither is derived from the other.
 */
export function closeTurnRecord(record, { outcome, cancelRequested = false, stopConfirmed = false, at }) {
  if (!record || typeof record !== 'object') fail('ACTIVITY_RECORD_REQUIRED')
  if (!ACTIVITY_TURN_OUTCOMES.includes(outcome)) fail('ACTIVITY_TURN_OUTCOME_INVALID')
  if (!Number.isSafeInteger(at)) fail('ACTIVITY_TIME_REQUIRED')
  const patch = {
    turnSettled: true, turnOutcome: outcome,
    cancelRequested: record.cancelRequested || cancelRequested === true,
    stopConfirmed: record.stopConfirmed || stopConfirmed === true,
    updatedAt: at,
  }
  if (record.state === 'running') {
    patch.state = 'turn-unconfirmed'
    patch.endedAt = at
  }
  return withRecord(record, patch)
}

/** A cancel request. Deliberately does not touch `stopConfirmed`. */
export function requestCancelRecord(record, at) {
  if (!record || typeof record !== 'object') fail('ACTIVITY_RECORD_REQUIRED')
  if (!Number.isSafeInteger(at)) fail('ACTIVITY_TIME_REQUIRED')
  if (record.cancelRequested) return { record, changed: false, reason: 'cancel-already-requested' }
  return { record: withRecord(record, { cancelRequested: true, cancelRequestedAt: at, updatedAt: at }), changed: true, reason: 'cancel-requested' }
}

/** A confirmed process stop, from real Host stop evidence only. */
export function confirmStopRecord(record, at) {
  if (!record || typeof record !== 'object') fail('ACTIVITY_RECORD_REQUIRED')
  if (!Number.isSafeInteger(at)) fail('ACTIVITY_TIME_REQUIRED')
  if (record.stopConfirmed) return { record, changed: false, reason: 'stop-already-confirmed' }
  return { record: withRecord(record, { stopConfirmed: true, stopConfirmedAt: at, updatedAt: at }), changed: true, reason: 'stop-confirmed' }
}

/**
 * The closed display projection of a stored record. Exactly {@link RECORD_KEYS}, every
 * value a primitive, no nested object, no parameters, no results, no pixels.
 */
export function projectActivityRecord(record) {
  if (!record || typeof record !== 'object') fail('ACTIVITY_RECORD_REQUIRED')
  const projected = {
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    callKey: record.callKey,
    botId: record.botId, mode: record.mode, conversationId: record.conversationId,
    contextId: record.contextId ?? null,
    processGeneration: record.processGeneration, turnId: record.turnId,
    callId: record.callId, callIdRecorded: record.callIdRecorded === true,
    toolName: record.toolName, toolNameRecorded: record.toolNameRecorded === true,
    toolNameTruncated: record.toolNameTruncated === true, redacted: record.redacted === true,
    state: record.state,
    cliOk: record.cliOk === undefined ? null : record.cliOk,
    startedAt: record.startedAt, endedAt: record.endedAt ?? null, updatedAt: record.updatedAt,
    turnSettled: record.turnSettled === true, turnOutcome: record.turnOutcome ?? null,
    cancelRequested: record.cancelRequested === true, cancelRequestedAt: record.cancelRequestedAt ?? null,
    stopConfirmed: record.stopConfirmed === true, stopConfirmedAt: record.stopConfirmedAt ?? null,
    lateCliReturn: record.lateCliReturn === true, lateCliOk: record.lateCliOk ?? null,
    duplicateStarts: Number.isSafeInteger(record.duplicateStarts) ? record.duplicateStarts : 0,
    duplicateCompletions: Number.isSafeInteger(record.duplicateCompletions) ? record.duplicateCompletions : 0,
  }
  assertDisplayOnly(projected)
  return Object.freeze(projected)
}

/**
 * Fail closed if a value is not a closed display projection. Used by the store on every
 * read path and by the tests, so a widened row is a loud failure instead of a leak.
 */
export function assertDisplayOnly(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ACTIVITY_DISPLAY_SCHEMA_UNKNOWN')
  const keys = Object.keys(value)
  const allowed = value.schemaVersion === ACTIVITY_SCHEMA_VERSION ? (Object.hasOwn(value, 'callKey') ? RECORD_KEYS : Object.hasOwn(value, 'phase') ? EVENT_KEYS : null) : null
  if (!allowed) fail('ACTIVITY_DISPLAY_SCHEMA_UNKNOWN')
  const extra = keys.filter(key => !allowed.includes(key))
  if (extra.length || keys.length !== allowed.length) fail('ACTIVITY_DISPLAY_FIELD_REFUSED')
  for (const key of keys) {
    const item = value[key]
    if (item === null) continue
    if (Array.isArray(item)) {
      if (item.some(entry => typeof entry !== 'string')) fail('ACTIVITY_DISPLAY_FIELD_REFUSED')
      continue
    }
    if (!['string', 'number', 'boolean'].includes(typeof item) || typeof item === 'number' && !Number.isSafeInteger(item)) fail('ACTIVITY_DISPLAY_FIELD_REFUSED')
    if (typeof item === 'string' && (CONTROL.test(item) || item.length > 4096)) fail('ACTIVITY_DISPLAY_FIELD_REFUSED')
  }
  if (allowed === RECORD_KEYS) {
    const identity = activityIdentity({ botId: value.botId, mode: value.mode, conversationId: value.conversationId,
      contextId: value.contextId, processGeneration: value.processGeneration, turnId: value.turnId })
    if (activityCallKey(identity, value.callId) !== value.callKey || !ACTIVITY_STATES.includes(value.state)) fail('ACTIVITY_DISPLAY_RECORD_INVALID')
    for (const key of ['callIdRecorded', 'toolNameRecorded', 'toolNameTruncated', 'redacted', 'turnSettled', 'cancelRequested', 'stopConfirmed', 'lateCliReturn']) if (typeof value[key] !== 'boolean') fail('ACTIVITY_DISPLAY_RECORD_INVALID')
    for (const key of ['startedAt', 'updatedAt', 'duplicateStarts', 'duplicateCompletions']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) fail('ACTIVITY_DISPLAY_RECORD_INVALID')
    for (const key of ['endedAt', 'cancelRequestedAt', 'stopConfirmedAt']) if (value[key] !== null && (!Number.isSafeInteger(value[key]) || value[key] < 0)) fail('ACTIVITY_DISPLAY_RECORD_INVALID')
    if (typeof value.toolName !== 'string' || !value.toolName || value.toolName.length > ACTIVITY_LIMITS.maxToolNameChars) fail('ACTIVITY_DISPLAY_RECORD_INVALID')
    if (value.cliOk !== null && typeof value.cliOk !== 'boolean' || value.lateCliOk !== null && typeof value.lateCliOk !== 'boolean') fail('ACTIVITY_DISPLAY_RECORD_INVALID')
    if (value.state === 'cli-ok' && value.cliOk !== true || value.state === 'cli-error' && value.cliOk !== false || ['running', 'turn-unconfirmed'].includes(value.state) && value.cliOk !== null) fail('ACTIVITY_DISPLAY_RECORD_INVALID')
    if (value.turnSettled ? !ACTIVITY_TURN_OUTCOMES.includes(value.turnOutcome) : value.turnOutcome !== null) fail('ACTIVITY_DISPLAY_RECORD_INVALID')
    if (value.cancelRequested !== (value.cancelRequestedAt !== null) || value.stopConfirmed !== (value.stopConfirmedAt !== null)) fail('ACTIVITY_DISPLAY_RECORD_INVALID')
  } else {
    if (!ACTIVITY_EVENT_PHASES.includes(value.phase) || !Array.isArray(value.unprojected) || value.unprojected.length > ACTIVITY_LIMITS.maxUnprojectedNames || value.unprojected.some(key => !ACTIVITY_UNPROJECTED_FIELDS.includes(key))) fail('ACTIVITY_DISPLAY_EVENT_INVALID')
  }
  return true
}

/** Stable order for paging and for the recent-items crop: start time, then key. */
export function compareActivityRecords(a, b) {
  if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt
  return a.callKey < b.callKey ? -1 : a.callKey > b.callKey ? 1 : 0
}

/** Bounded, display-only summary of one turn or one page of calls. */
export function summarizeActivity(records, { turnKey = null, turnOpen = false } = {}) {
  const list = (Array.isArray(records) ? records : []).map(record => projectActivityRecord(record))
  list.sort(compareActivityRecords)
  const byState = {}
  for (const state of ACTIVITY_STATES) byState[state] = 0
  for (const record of list) byState[record.state] += 1
  const current = list.find(record => record.state === 'running') ?? null
  const recent = list.slice(-ACTIVITY_LIMITS.maxRecentVisible).reverse()
  const summary = {
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    turnKey,
    turnOpen: turnOpen === true,
    calls: list.length,
    byState: Object.freeze(byState),
    current,
    recent: Object.freeze(recent),
    recentTruncated: list.length > ACTIVITY_LIMITS.maxRecentVisible,
  }
  return Object.freeze(summary)
}

/** Opaque cursor: the boundary of the last returned row. */
export function activityCursor(at, callKey, direction = 'desc') {
  if (!Number.isSafeInteger(at) || typeof callKey !== 'string' || !['asc', 'desc'].includes(direction)) fail('ACTIVITY_CURSOR_INVALID')
  return Buffer.from(JSON.stringify({ v: 1, at, k: callKey, d: direction }), 'utf8').toString('base64url')
}

export function parseActivityCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length > 4096) fail('ACTIVITY_CURSOR_INVALID')
  let parsed
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) } catch { fail('ACTIVITY_CURSOR_INVALID') }
  if (!parsed || parsed.v !== 1 || !Number.isSafeInteger(parsed.at) || typeof parsed.k !== 'string' || !['asc', 'desc'].includes(parsed.d)) fail('ACTIVITY_CURSOR_INVALID')
  return Object.freeze({ at: parsed.at, callKey: parsed.k, direction: parsed.d })
}

export const ACTIVITY_EVENT_KEYS = EVENT_KEYS
export const ACTIVITY_RECORD_KEYS = RECORD_KEYS
export const ACTIVITY_SUMMARY_KEYS = SUMMARY_KEYS
