/** Durable display observations. Database and all identity come from the Host. */
import { mkdirSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { dirname } from 'node:path'
import {
  ACTIVITY_LIMITS, ACTIVITY_STATES, activityIdentity, activityTurnKey, activityCallKey,
  toolEventProjection, activityRecordFromEvent, applyToolEvent, closeTurnRecord,
  requestCancelRecord, confirmStopRecord, projectActivityRecord, assertDisplayOnly, compareActivityRecords,
} from './native-activity-contract.mjs'

export const ACTIVITY_STORE_SCHEMA_VERSION = 1
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const fail = code => { throw Object.assign(new Error(code), { code }) }
const optionsKeys = ['Database', 'file', 'namespace', 'now', 'ownerId', 'ownerPid', 'isProcessAlive', 'redactToolName', 'limits']
const label = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)
const liveProcess = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'ESRCH' ? false : null }
}
const schema = `
CREATE TABLE IF NOT EXISTS native_activity_meta(namespace TEXT PRIMARY KEY,version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS native_activity_hosts(namespace TEXT PRIMARY KEY,owner_id TEXT NOT NULL,owner_pid INTEGER NOT NULL,lease_token TEXT NOT NULL,acquired_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS native_activity_turns(namespace TEXT NOT NULL,turn_key TEXT NOT NULL,bot_id TEXT NOT NULL,mode TEXT NOT NULL,conversation_id TEXT NOT NULL,context_id TEXT,identity_json TEXT NOT NULL,host_opened INTEGER NOT NULL,open INTEGER NOT NULL,outcome TEXT,cancel_at INTEGER,stop_at INTEGER,opened_at INTEGER NOT NULL,closed_at INTEGER,PRIMARY KEY(namespace,turn_key));
CREATE TABLE IF NOT EXISTS native_activity_calls(seq INTEGER PRIMARY KEY AUTOINCREMENT,namespace TEXT NOT NULL,call_key TEXT NOT NULL,turn_key TEXT NOT NULL,bot_id TEXT NOT NULL,mode TEXT NOT NULL,conversation_id TEXT NOT NULL,context_id TEXT,started_at INTEGER NOT NULL,record_json TEXT NOT NULL,UNIQUE(namespace,call_key));
CREATE INDEX IF NOT EXISTS native_activity_turns_scope ON native_activity_turns(namespace,bot_id,mode,conversation_id,context_id,opened_at,turn_key);
CREATE INDEX IF NOT EXISTS native_activity_calls_scope ON native_activity_calls(namespace,bot_id,mode,conversation_id,context_id,started_at DESC,call_key DESC);
CREATE INDEX IF NOT EXISTS native_activity_calls_turn ON native_activity_calls(namespace,turn_key);
`

export function createActivityStore(options = {}) {
  if (!plain(options) || Object.keys(options).some(key => !optionsKeys.includes(key))) fail('ACTIVITY_STORE_OPTIONS_INVALID')
  const { Database, file, namespace = 'default', now = Date.now, ownerId = `host-${randomUUID()}`,
    ownerPid = process.pid, isProcessAlive = liveProcess, redactToolName = null, limits = {} } = options
  if (typeof Database !== 'function') fail('ACTIVITY_STORE_DATABASE_REQUIRED')
  if (typeof file !== 'string' || !file) fail('ACTIVITY_STORE_FILE_REQUIRED')
  if (!label(namespace) || !label(ownerId)) fail('ACTIVITY_STORE_OWNER_INVALID')
  if (!Number.isSafeInteger(ownerPid) || ownerPid < 1 || typeof isProcessAlive !== 'function') fail('ACTIVITY_STORE_LIVENESS_INVALID')
  if (typeof now !== 'function' || redactToolName !== null && typeof redactToolName !== 'function') fail('ACTIVITY_STORE_POLICY_INVALID')
  if (!plain(limits)) fail('ACTIVITY_STORE_LIMITS_INVALID')
  const bound = { ...ACTIVITY_LIMITS }
  for (const [key, value] of Object.entries(limits)) {
    if (!['maxRecords', 'maxTurnsPerConversation', 'maxCallsPerTurn', 'defaultPageSize', 'maxPageSize'].includes(key) || !Number.isSafeInteger(value) || value < 1 || value > ACTIVITY_LIMITS[key]) fail('ACTIVITY_STORE_LIMIT_INVALID')
    bound[key] = value
  }
  bound.defaultPageSize = Math.min(bound.defaultPageSize, bound.maxPageSize)
  const time = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0) fail('ACTIVITY_TIME_REQUIRED'); return value }
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file), leaseToken = randomUUID()
  let closed = false, failureCount = 0, lastCode = null, lastAt = null
  const note = code => { failureCount++; lastCode = code; lastAt = time(); return { ok: false, code } }
  const tx = work => {
    db.exec('BEGIN IMMEDIATE')
    try { const value = work(); db.exec('COMMIT'); return value }
    catch (error) { try { db.exec('ROLLBACK') } catch {}; throw error }
  }
  const readTurn = key => db.prepare('SELECT * FROM native_activity_turns WHERE namespace=? AND turn_key=?').get(namespace, key)
  const readCall = key => db.prepare('SELECT * FROM native_activity_calls WHERE namespace=? AND call_key=?').get(namespace, key)
  const recordOf = row => {
    let value
    try { value = JSON.parse(row.record_json) } catch { fail('ACTIVITY_RECORD_CORRUPT') }
    assertDisplayOnly(value)
    const identity = activityIdentity({ botId: value.botId, mode: value.mode, conversationId: value.conversationId,
      contextId: value.contextId, processGeneration: value.processGeneration, turnId: value.turnId })
    if (activityCallKey(identity, value.callId) !== row.call_key || activityTurnKey(identity) !== row.turn_key || value.startedAt !== row.started_at
      || value.botId !== row.bot_id || value.mode !== row.mode || value.conversationId !== row.conversation_id || value.contextId !== row.context_id) fail('ACTIVITY_RECORD_CORRUPT')
    return projectActivityRecord(value)
  }
  const saveRecord = record => db.prepare('UPDATE native_activity_calls SET record_json=? WHERE namespace=? AND call_key=?')
    .run(JSON.stringify(projectActivityRecord(record)), namespace, record.callKey)
  const settleRows = (turnKey, outcome, at) => {
    const rows = db.prepare('SELECT * FROM native_activity_calls WHERE namespace=? AND turn_key=?').all(namespace, turnKey)
    for (const row of rows) saveRecord(closeTurnRecord(recordOf(row), { outcome, at }))
    db.prepare('UPDATE native_activity_turns SET open=0,outcome=?,closed_at=? WHERE namespace=? AND turn_key=?').run(outcome, at, namespace, turnKey)
    return rows.length
  }
  let ownership
  try {
    db.pragma('busy_timeout = 5000')
    db.pragma('synchronous = FULL')
    if (file !== ':memory:' && db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') fail('ACTIVITY_STORE_WAL_REQUIRED')
    db.exec(schema)
    ownership = tx(() => {
      const version = db.prepare('SELECT version FROM native_activity_meta WHERE namespace=?').get(namespace)?.version
      if (version !== undefined && version !== ACTIVITY_STORE_SCHEMA_VERSION) fail('ACTIVITY_STORE_SCHEMA_UNSUPPORTED')
      const previous = db.prepare('SELECT * FROM native_activity_hosts WHERE namespace=?').get(namespace)
      if (previous) {
        let alive
        try { alive = isProcessAlive(previous.owner_pid) } catch { alive = null }
        if (alive !== false) fail('ACTIVITY_STORE_HOST_CONFLICT')
      }
      const at = time(), pending = db.prepare('SELECT turn_key FROM native_activity_turns WHERE namespace=? AND open=1').all(namespace)
      for (const row of pending) settleRows(row.turn_key, 'host-lost', at)
      db.prepare('INSERT OR IGNORE INTO native_activity_meta(namespace,version) VALUES(?,?)').run(namespace, ACTIVITY_STORE_SCHEMA_VERSION)
      db.prepare('INSERT INTO native_activity_hosts(namespace,owner_id,owner_pid,lease_token,acquired_at) VALUES(?,?,?,?,?) ON CONFLICT(namespace) DO UPDATE SET owner_id=excluded.owner_id,owner_pid=excluded.owner_pid,lease_token=excluded.lease_token,acquired_at=excluded.acquired_at')
        .run(namespace, ownerId, ownerPid, leaseToken, at)
      return { adopted: Boolean(previous), strandedTurns: pending.length }
    })
  } catch (error) { try { db.close() } catch {}; throw error }
  const assertOpen = () => { if (closed) fail('ACTIVITY_STORE_CLOSED') }
  const assertLease = () => {
    const current = db.prepare('SELECT lease_token FROM native_activity_hosts WHERE namespace=?').get(namespace)
    if (current?.lease_token !== leaseToken) fail('ACTIVITY_STORE_OWNER_LOST')
  }
  const write = (failureCode, operation) => {
    assertOpen()
    try { return tx(() => { assertLease(); return operation(time()) }) }
    catch (error) { return note(typeof error?.code === 'string' && error.code.startsWith('ACTIVITY_') ? error.code : failureCode) }
  }
  const deleteTurn = key => {
    db.prepare('DELETE FROM native_activity_calls WHERE namespace=? AND turn_key=?').run(namespace, key)
    db.prepare('DELETE FROM native_activity_turns WHERE namespace=? AND turn_key=?').run(namespace, key)
  }
  const reserveTurn = identity => {
    const key = activityTurnKey(identity)
    while (db.prepare('SELECT COUNT(*) AS n FROM native_activity_turns WHERE namespace=? AND bot_id=? AND mode=? AND conversation_id=? AND context_id IS ?').get(namespace, identity.botId, identity.mode, identity.conversationId, identity.contextId).n >= bound.maxTurnsPerConversation) {
      const victim = db.prepare('SELECT turn_key FROM native_activity_turns WHERE namespace=? AND bot_id=? AND mode=? AND conversation_id=? AND context_id IS ? AND open=0 AND turn_key<>? ORDER BY opened_at,turn_key LIMIT 1').get(namespace, identity.botId, identity.mode, identity.conversationId, identity.contextId, key)
      if (!victim) fail('ACTIVITY_CONVERSATION_TURN_LIMIT')
      deleteTurn(victim.turn_key)
    }
    // Also bound empty turns across distinct conversations, not only call rows.
    while (db.prepare('SELECT COUNT(*) AS n FROM native_activity_turns WHERE namespace=?').get(namespace).n >= bound.maxRecords) {
      const victim = db.prepare('SELECT turn_key FROM native_activity_turns WHERE namespace=? AND open=0 AND turn_key<>? ORDER BY opened_at,turn_key LIMIT 1').get(namespace, key)
      if (!victim) fail('ACTIVITY_RECORD_LIMIT')
      deleteTurn(victim.turn_key)
    }
  }
  const reserveCall = turnKey => {
    if (db.prepare('SELECT COUNT(*) AS n FROM native_activity_calls WHERE namespace=? AND turn_key=?').get(namespace, turnKey).n >= bound.maxCallsPerTurn) fail('ACTIVITY_TURN_CALL_LIMIT')
    while (db.prepare('SELECT COUNT(*) AS n FROM native_activity_calls WHERE namespace=?').get(namespace).n >= bound.maxRecords) {
      const victim = db.prepare('SELECT c.call_key FROM native_activity_calls c JOIN native_activity_turns t ON t.namespace=c.namespace AND t.turn_key=c.turn_key WHERE c.namespace=? AND t.open=0 ORDER BY c.started_at,c.call_key LIMIT 1').get(namespace)
      if (!victim) fail('ACTIVITY_RECORD_LIMIT')
      db.prepare('DELETE FROM native_activity_calls WHERE namespace=? AND call_key=?').run(namespace, victim.call_key)
    }
  }
  const insertTurn = (identity, at, hostOpened) => {
    reserveTurn(identity)
    db.prepare('INSERT INTO native_activity_turns(namespace,turn_key,bot_id,mode,conversation_id,context_id,identity_json,host_opened,open,outcome,cancel_at,stop_at,opened_at,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(namespace, activityTurnKey(identity), identity.botId, identity.mode, identity.conversationId, identity.contextId, JSON.stringify(identity), hostOpened ? 1 : 0, hostOpened ? 1 : 0, hostOpened ? null : 'unknown', null, null, at, hostOpened ? null : at)
  }
  const openTurn = value => {
    assertOpen(); const identity = activityIdentity(value), key = activityTurnKey(identity)
    return write('ACTIVITY_TURN_OPEN_FAILED', at => {
      const previous = readTurn(key)
      if (previous) return previous.open ? { ok: true, turnKey: key, alreadyOpen: true } : { ok: false, code: 'ACTIVITY_TURN_ALREADY_CLOSED' }
      insertTurn(identity, at, true)
      return { ok: true, turnKey: key, alreadyOpen: false }
    })
  }
  const closeTurn = (value, report = {}) => {
    assertOpen(); const identity = activityIdentity(value), key = activityTurnKey(identity)
    if (!plain(report) || Object.keys(report).some(key => key !== 'outcome') || !['succeeded', 'failed', 'cancelled', 'unknown', 'refused', 'host-closed', 'host-lost'].includes(report.outcome)) fail('ACTIVITY_TURN_OUTCOME_INVALID')
    return write('ACTIVITY_TURN_CLOSE_FAILED', at => {
      const turn = readTurn(key)
      if (!turn) return { ok: false, code: 'ACTIVITY_TURN_NOT_FOUND' }
      if (!turn.open) return turn.outcome === report.outcome ? { ok: true, turnKey: key, alreadyClosed: true } : { ok: false, code: 'ACTIVITY_TURN_OUTCOME_CONFLICT' }
      const settled = settleRows(key, report.outcome, at)
      return { ok: true, turnKey: key, settled }
    })
  }
  const recordToolEvent = (value, event) => {
    assertOpen(); const identity = activityIdentity(value), projection = toolEventProjection(event, redactToolName ? { redactToolName } : null)
    if (projection.callId === null) return note('ACTIVITY_CALL_ID_MISSING')
    const callKey = activityCallKey(identity, projection.callId), turnKey = activityTurnKey(identity)
    return write('ACTIVITY_EVENT_WRITE_FAILED', at => {
      let turn = readTurn(turnKey)
      if (!turn) { insertTurn(identity, at, false); turn = readTurn(turnKey) }
      const previous = readCall(callKey), turnOpen = turn.open === 1 && turn.host_opened === 1
      if (previous) {
        const applied = applyToolEvent(recordOf(previous), projection, { turnOpen, at })
        saveRecord(applied.record)
        return { ok: true, created: false, reason: applied.reason, call: projectActivityRecord(applied.record) }
      }
      reserveCall(turnKey)
      let record = activityRecordFromEvent(identity, projection, at)
      if (turn.cancel_at !== null) record = requestCancelRecord(record, turn.cancel_at).record
      if (turn.stop_at !== null) record = confirmStopRecord(record, turn.stop_at).record
      if (!turnOpen) record = closeTurnRecord(record, { outcome: turn.outcome ?? 'unknown', at })
      if (projection.phase === 'completed') record = applyToolEvent(record, projection, { turnOpen, at }).record
      record = projectActivityRecord(record)
      db.prepare('INSERT INTO native_activity_calls(namespace,call_key,turn_key,bot_id,mode,conversation_id,context_id,started_at,record_json) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(namespace, callKey, turnKey, identity.botId, identity.mode, identity.conversationId, identity.contextId, record.startedAt, JSON.stringify(record))
      return { ok: true, created: true, reason: 'recorded', call: record }
    })
  }
  const fact = (value, callId, kind) => {
    assertOpen(); const identity = activityIdentity(value), key = activityTurnKey(identity)
    const selected = callId === undefined || callId === null ? null : activityCallKey(identity, callId)
    return write(kind === 'cancel' ? 'ACTIVITY_CANCEL_FAILED' : 'ACTIVITY_STOP_FAILED', at => {
      const turn = readTurn(key)
      if (!turn) return { ok: false, code: 'ACTIVITY_TURN_NOT_FOUND' }
      const rows = selected ? [readCall(selected)].filter(Boolean) : db.prepare('SELECT * FROM native_activity_calls WHERE namespace=? AND turn_key=?').all(namespace, key)
      if (selected && !rows.length) return { ok: false, code: 'ACTIVITY_CALL_NOT_FOUND' }
      for (const row of rows) saveRecord((kind === 'cancel' ? requestCancelRecord : confirmStopRecord)(recordOf(row), at).record)
      if (!selected) db.prepare(`UPDATE native_activity_turns SET ${kind === 'cancel' ? 'cancel_at' : 'stop_at'}=COALESCE(${kind === 'cancel' ? 'cancel_at' : 'stop_at'},?) WHERE namespace=? AND turn_key=?`).run(at, namespace, key)
      return { ok: true, updated: rows.length }
    })
  }
  const scopeHash = scope => createHash('sha256').update(JSON.stringify([namespace, scope.botId, scope.mode, scope.conversationId, scope.contextId])).digest('hex')
  const page = (query = {}) => {
    assertOpen(); assertLease()
    if (!plain(query) || Object.keys(query).some(key => !['botId', 'mode', 'conversationId', 'contextId', 'cursor', 'limit'].includes(key))) fail('ACTIVITY_QUERY_INVALID')
    const { botId, mode, conversationId, contextId = null, cursor = null, limit = bound.defaultPageSize } = query
    activityIdentity({ botId, mode, conversationId, contextId, processGeneration: 'scope-validation', turnId: 'scope-validation' })
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > bound.maxPageSize) fail('ACTIVITY_QUERY_LIMIT_INVALID')
    const scope = { botId, mode, conversationId, contextId }, hash = scopeHash(scope)
    let boundary = null
    if (cursor !== null) {
      if (typeof cursor !== 'string' || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) fail('ACTIVITY_CURSOR_INVALID')
      try { boundary = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) } catch { fail('ACTIVITY_CURSOR_INVALID') }
      if (!plain(boundary) || Object.keys(boundary).sort().join(',') !== 'at,f,k,s,v' || boundary.v !== 2 || boundary.s !== hash || !Number.isSafeInteger(boundary.at) || boundary.at < 0 || !Number.isSafeInteger(boundary.f) || boundary.f < 0 || !/^call1-[a-f0-9]{64}$/.test(boundary.k ?? '') || Buffer.from(JSON.stringify(boundary)).toString('base64url') !== cursor) fail('ACTIVITY_CURSOR_INVALID')
    }
    const fence = boundary?.f ?? db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM native_activity_calls WHERE namespace=?').get(namespace).n
    const args = [namespace, botId, mode, conversationId, contextId, fence]
    let sql = 'SELECT * FROM native_activity_calls WHERE namespace=? AND bot_id=? AND mode=? AND conversation_id=? AND context_id IS ? AND seq<=?'
    if (boundary) { sql += ' AND (started_at<? OR (started_at=? AND call_key<?))'; args.push(boundary.at, boundary.at, boundary.k) }
    sql += ' ORDER BY started_at DESC,call_key DESC LIMIT ?'; args.push(limit + 1)
    const rows = db.prepare(sql).all(...args), hasMore = rows.length > limit, items = rows.slice(0, limit).map(recordOf), last = items.at(-1)
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ v: 2, at: last.startedAt, k: last.callKey, f: fence, s: hash })).toString('base64url') : null
    return Object.freeze({ schemaVersion: 1, items: Object.freeze(items), nextCursor, limit })
  }
  const health = () => Object.freeze({ failures: failureCount, lastCode, lastAt, closed })
  const stats = () => {
    assertOpen(); assertLease()
    const byState = Object.fromEntries(ACTIVITY_STATES.map(state => [state, 0]))
    for (const row of db.prepare('SELECT record_json FROM native_activity_calls WHERE namespace=?').all(namespace)) {
      const value = JSON.parse(row.record_json); if (!Object.hasOwn(byState, value.state)) fail('ACTIVITY_RECORD_CORRUPT'); byState[value.state]++
    }
    return Object.freeze({ namespace, ownerId, ...ownership, calls: Object.values(byState).reduce((a, b) => a + b, 0),
      turns: db.prepare('SELECT COUNT(*) AS n FROM native_activity_turns WHERE namespace=?').get(namespace).n,
      openTurns: db.prepare('SELECT COUNT(*) AS n FROM native_activity_turns WHERE namespace=? AND open=1').get(namespace).n,
      byState: Object.freeze(byState), limits: Object.freeze({ ...bound }), failures: failureCount })
  }
  const close = () => {
    if (closed) return { closed: true, alreadyClosed: true }
    try {
      tx(() => {
        const lease = db.prepare('SELECT lease_token FROM native_activity_hosts WHERE namespace=?').get(namespace)
        if (lease?.lease_token !== leaseToken) return
        const at = time()
        for (const turn of db.prepare('SELECT turn_key FROM native_activity_turns WHERE namespace=? AND open=1').all(namespace)) settleRows(turn.turn_key, 'host-closed', at)
        db.prepare('DELETE FROM native_activity_hosts WHERE namespace=? AND lease_token=?').run(namespace, leaseToken)
      })
    } catch { note('ACTIVITY_STORE_RELEASE_FAILED') }
    finally { closed = true; try { db.close() } catch { note('ACTIVITY_STORE_CLOSE_FAILED') } }
    return { closed: true, failures: failureCount }
  }
  return Object.freeze({ schemaVersion: 1, namespace, ownerId, ...ownership, openTurn, closeTurn, recordToolEvent,
    requestCancel: (identity, id) => fact(identity, id, 'cancel'), confirmStop: (identity, id) => fact(identity, id, 'stop'), page, stats, health, close })
}
export { ACTIVITY_LIMITS as ACTIVITY_STORE_LIMITS, compareActivityRecords }
