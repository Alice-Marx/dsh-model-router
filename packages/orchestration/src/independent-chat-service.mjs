import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { independentContextId } from './independent-context-state.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const ref = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(value)
const requestRef = value => typeof value === 'string' && /^[-A-Za-z0-9_]{16,128}$/.test(value)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED') }
const keys = (value, allowed) => { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INDEPENDENT_CHAT_INVALID_REQUEST') }
const hash = input => createHash('sha256').update(input).digest('hex')
const alive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

/**
 * Owner chat admission and durable request outcomes, not a second money ledger.
 * A transport retry reads the original request. It never starts another model
 * turn, including after restart or an unknown result. Actual messages remain in
 * the Bot transcript; this journal retains only bounded outcome summaries.
 */
export function createIndependentChatService({ Database, file, lifecycle, runtime, now = Date.now,
  maxRequests = 4096, maxActive = 32, isProcessAlive = alive } = {}) {
  if (typeof Database !== 'function' || typeof file !== 'string' || !file || typeof lifecycle?.committedBot !== 'function' || typeof runtime !== 'function') fail('INDEPENDENT_CHAT_HOST_REQUIRED')
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || !Number.isSafeInteger(maxActive) || maxActive < 1) fail('INDEPENDENT_CHAT_INVALID_LIMIT')
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file), ownerId = randomUUID(), active = new Map()
  let closed = false
  try {
    db.pragma('busy_timeout=5000'); db.pragma('synchronous=FULL')
    if (file !== ':memory:' && db.pragma('journal_mode=WAL', { simple: true }) !== 'wal') fail('INDEPENDENT_CHAT_WAL_REQUIRED')
    db.exec(`CREATE TABLE IF NOT EXISTS bot_independent_chat_requests (
      bot_id TEXT NOT NULL, request_key TEXT NOT NULL, schema_version INTEGER NOT NULL,
      input_hash TEXT NOT NULL, state TEXT NOT NULL, owner_id TEXT NOT NULL, owner_pid INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cancel_requested_at INTEGER,
      result TEXT, error_code TEXT, PRIMARY KEY(bot_id, request_key));
      CREATE UNIQUE INDEX IF NOT EXISTS bot_independent_chat_pending_bot
      ON bot_independent_chat_requests(bot_id) WHERE state IN ('accepted','running');`)
    if (!db.pragma('table_info(bot_independent_chat_requests)').some(column => column.name === 'input_text')) {
      db.exec('ALTER TABLE bot_independent_chat_requests ADD COLUMN input_text TEXT')
    }
    for (const [name, definition] of [['operation_kind', "TEXT NOT NULL DEFAULT 'send'"], ['context_id', 'TEXT'], ['base_context_id', 'TEXT']]) {
      if (!db.pragma('table_info(bot_independent_chat_requests)').some(column => column.name === name)) db.exec(`ALTER TABLE bot_independent_chat_requests ADD COLUMN ${name} ${definition}`)
    }
    if (db.prepare('SELECT 1 FROM bot_independent_chat_requests WHERE schema_version != 1').get()) fail('INDEPENDENT_CHAT_SCHEMA_UNSUPPORTED')
    if (db.prepare("SELECT 1 FROM bot_independent_chat_requests WHERE operation_kind NOT IN ('send','new-conversation')").get()) fail('INDEPENDENT_CHAT_SCHEMA_UNSUPPORTED')
  } catch (error) { db.close(); throw error }
  const read = (botId, requestKey) => db.prepare('SELECT * FROM bot_independent_chat_requests WHERE bot_id=? AND request_key=?').get(botId, requestKey)
  const assertOpen = () => { if (closed) fail('INDEPENDENT_CHAT_CLOSED') }
  const identity = payload => {
    if (!ref(payload.botId) || !requestRef(payload.requestKey)) fail('INDEPENDENT_CHAT_INVALID_REQUEST')
  }
  const entryKey = (botId, requestKey) => `${botId}\0${requestKey}`
  const pending = row => row && ['accepted', 'running'].includes(row.state)
  const recover = (row, readOnly = false) => {
    // FS and SQLite are separate commits. Only the exact Host-derived context
    // token reconciles a reset whose journal acknowledgement was lost. Reading
    // it never retries retirement, starts a native process, or dispatches a turn.
    if (row?.operation_kind === 'new-conversation' && ['accepted', 'running', 'unknown'].includes(row.state)) {
      const adapter = runtime()
      const context = typeof adapter?.contextOf === 'function' ? adapter.contextOf(row.bot_id) : null
      if (context && context.contextId === row.context_id && !context.resetPending) {
        const result = JSON.stringify({ contextId: context.contextId, sequence: context.sequence, createdAt: context.createdAt })
        if (readOnly) return { ...row, state: 'succeeded', result, error_code: null }
        db.prepare("UPDATE bot_independent_chat_requests SET state='succeeded',result=?,error_code=NULL,updated_at=? WHERE bot_id=? AND request_key=? AND operation_kind='new-conversation' AND state IN ('accepted','running','unknown')")
          .run(result, now(), row.bot_id, row.request_key)
        return read(row.bot_id, row.request_key)
      }
    }
    // An OS process that is gone cannot resume its local loop. An alive or
    // uninspectable owner stays pending; expiry alone is never stop evidence.
    if (!readOnly && pending(row) && row.owner_id !== ownerId && !isProcessAlive(row.owner_pid)) {
      db.prepare("UPDATE bot_independent_chat_requests SET state='unknown',error_code='INDEPENDENT_CHAT_HOST_LOST',updated_at=? WHERE bot_id=? AND request_key=? AND owner_id=? AND state IN ('accepted','running')")
        .run(now(), row.bot_id, row.request_key, row.owner_id)
      return read(row.bot_id, row.request_key)
    }
    return row
  }
  const project = row => {
    if (!row) fail('INDEPENDENT_CHAT_REQUEST_NOT_FOUND')
    const uncertain = pending(row) && (row.owner_id !== ownerId || !active.has(entryKey(row.bot_id, row.request_key)))
    // A live preview is observation, never a transcript or a durable answer.
    // It disappears on settlement, lost ownership or restart. Reloading the
    // browser can inspect it without dispatching another model request.
    const progress = !uncertain && pending(row) ? active.get(entryKey(row.bot_id, row.request_key))?.progress : null
    return { schemaVersion: 1, botId: row.bot_id, requestKey: row.request_key,
      operationKind: row.operation_kind ?? 'send',
      ...(row.operation_kind === 'new-conversation' ? { contextId: row.context_id } : {}),
      state: uncertain ? 'unknown' : row.state, pending: pending(row), finished: !pending(row),
      createdAt: row.created_at, updatedAt: row.updated_at,
      cancelRequested: row.cancel_requested_at !== null, cancelRequestedAt: row.cancel_requested_at,
      stopConfirmed: false, result: row.result ? JSON.parse(row.result) : null,
      progress: progress ? { ...progress } : null,
      durableInput: row.operation_kind !== 'new-conversation' && (row.input_text !== null || row.state === 'succeeded'),
      ...(row.operation_kind !== 'new-conversation' && ['unknown', 'refused', 'cancelled'].includes(uncertain ? 'unknown' : row.state) && row.input_text !== null ? { recoveryInput: row.input_text } : {}),
      errorCode: uncertain ? row.owner_id === ownerId ? 'INDEPENDENT_CHAT_OUTCOME_NOT_COMMITTED' : 'INDEPENDENT_CHAT_OTHER_OWNER_PENDING' : row.error_code }
  }
  const current = botId => {
    if (!lifecycle.committedBot(botId)) fail('BOT_NOT_COMMITTED')
    const adapter = runtime()
    if (typeof adapter?.turn !== 'function') fail('INDEPENDENT_CHAT_UNAVAILABLE')
    const mode = typeof adapter.modeOf === 'function' ? adapter.modeOf(botId) : adapter.describe?.(botId)?.runtime
    if (mode !== 'independent') fail('RUNTIME_MODE_MISMATCH')
    return adapter
  }
  const summary = value => {
    if (!plain(value) || typeof value.answer !== 'string') fail('INDEPENDENT_CHAT_RESULT_INVALID')
    const calls = Array.isArray(value.toolCalls) ? value.toolCalls : []
    return { answerChars: value.answer.length, answerPreview: value.answer.slice(0, 256),
      ...(Number.isSafeInteger(value.steps) ? { steps: value.steps } : {}),
      ...(Number.isSafeInteger(value.turns) ? { turns: value.turns } : {}),
      toolCallCount: calls.length, toolCallsTruncated: calls.length > 32,
      toolCalls: calls.slice(0, 32).map(call => ({ id: String(call.id ?? '').slice(0, 256), name: String(call.name ?? '').slice(0, 128) })) }
  }
  const assertNoPending = botId => {
    const other = db.prepare("SELECT * FROM bot_independent_chat_requests WHERE bot_id=? AND state IN ('accepted','running')").get(botId)
    if (pending(recover(other))) fail('INDEPENDENT_CHAT_PENDING_RECONCILIATION')
    // An uncertain reset fences future sends across Host restarts as well as
    // within the original runtime. Its original nonce remains inspectable.
    const resets = db.prepare("SELECT * FROM bot_independent_chat_requests WHERE bot_id=? AND operation_kind='new-conversation' AND state='unknown'").all(botId)
    if (resets.some(row => recover(row).state === 'unknown')) fail('INDEPENDENT_CONTEXT_PENDING_RECONCILIATION')
  }
  const settle = (row, state, result, errorCode) => {
    if (closed) return
    db.prepare("UPDATE bot_independent_chat_requests SET state=?,updated_at=?,result=?,error_code=?,input_text=CASE WHEN ?='succeeded' THEN NULL ELSE input_text END WHERE bot_id=? AND request_key=? AND owner_id=? AND state IN ('accepted','running')")
      .run(state, now(), result ? JSON.stringify(result) : null, errorCode, state, row.bot_id, row.request_key, ownerId)
  }
  const run = async (row, input, entry) => {
    let invoked = false
    try {
      if (closed) return
      const adapter = current(row.bot_id)
      entry.controller.signal.throwIfAborted()
      db.prepare("UPDATE bot_independent_chat_requests SET state='running',updated_at=? WHERE bot_id=? AND request_key=? AND owner_id=? AND state='accepted'")
        .run(now(), row.bot_id, row.request_key, ownerId)
      invoked = true
      const result = await adapter.turn({ botId: row.bot_id, input, signal: entry.controller.signal,
        onProgress(value) {
          if (closed || entry.controller.signal.aborted || active.get(entryKey(row.bot_id, row.request_key)) !== entry) return
          if (!plain(value) || !Number.isSafeInteger(value.step) || value.step < 1 || value.step > 64 || typeof value.text !== 'string') fail('INDEPENDENT_CHAT_PROGRESS_INVALID')
          if (entry.progress && value.step < entry.progress.step) fail('INDEPENDENT_CHAT_PROGRESS_INVALID')
          let text = value.text.slice(0, 64000)
          if (text.length < value.text.length && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1)
          entry.progress = { step: value.step, sequence: (entry.progress?.sequence ?? 0) + 1,
            text, truncated: text.length < value.text.length }
        } })
      // A late cancel does not undo an already committed answer. Keep both facts.
      settle(row, 'succeeded', summary(result), null)
    } catch (error) {
      const cancelled = entry.controller.signal.aborted && (error?.name === 'AbortError' || error?.code === 'BOT_LOOP_CANCELLED')
      const code = /^[A-Z][A-Z0-9_:-]{0,95}$/.test(error?.code ?? '') ? error.code : 'INDEPENDENT_CHAT_OUTCOME_UNKNOWN'
      settle(row, cancelled ? 'cancelled' : invoked ? 'unknown' : 'refused', null, code)
    } finally { active.delete(entryKey(row.bot_id, row.request_key)) }
  }
  const runReset = async (row, entry) => {
    let invoked = false
    try {
      if (closed) return
      const adapter = current(row.bot_id)
      if (typeof adapter.newConversation !== 'function') fail('INDEPENDENT_CONTEXT_UNAVAILABLE')
      entry.controller.signal.throwIfAborted()
      db.prepare("UPDATE bot_independent_chat_requests SET state='running',updated_at=? WHERE bot_id=? AND request_key=? AND owner_id=? AND state='accepted'")
        .run(now(), row.bot_id, row.request_key, ownerId)
      invoked = true
      const result = await adapter.newConversation(row.bot_id, { requestKey: row.request_key,
        expectedContextId: row.base_context_id, signal: entry.controller.signal })
      if (!plain(result) || result.contextId !== row.context_id || result.resetPending) fail('INDEPENDENT_CONTEXT_RESULT_INVALID')
      settle(row, 'succeeded', { contextId: result.contextId, sequence: result.sequence, createdAt: result.createdAt }, null)
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_:-]{0,95}$/.test(error?.code ?? '') ? error.code : 'INDEPENDENT_CONTEXT_OUTCOME_UNKNOWN'
      settle(row, invoked && error?.outcome !== 'refused' ? 'unknown' : 'refused', null, code)
    } finally { active.delete(entryKey(row.bot_id, row.request_key)) }
  }
  return Object.freeze({
    ready: true,
    view(payload, context) {
      owner(context); assertOpen(); keys(payload, ['botId'])
      if (!ref(payload.botId)) fail('INDEPENDENT_CHAT_INVALID_REQUEST')
      context.signal?.throwIfAborted()
      if (!lifecycle.committedBot(payload.botId)) fail('BOT_NOT_COMMITTED')
      const adapter = runtime()
      const mode = typeof adapter?.modeOf === 'function' ? adapter.modeOf(payload.botId) : adapter?.describe?.(payload.botId)?.runtime ?? null
      const readOnly = context.readOnly === true
      const available = !readOnly && mode === 'independent' && typeof adapter?.turn === 'function' && typeof adapter?.conversationPage === 'function'
      const pendingRow = recover(db.prepare("SELECT * FROM bot_independent_chat_requests WHERE bot_id=? AND state IN ('accepted','running') ORDER BY created_at DESC LIMIT 1").get(payload.botId), readOnly)
      const latest = recover(db.prepare('SELECT * FROM bot_independent_chat_requests WHERE bot_id=? ORDER BY created_at DESC,request_key DESC LIMIT 1').get(payload.botId), readOnly)
      const conversationContext = typeof adapter?.contextOf === 'function' ? adapter.contextOf(payload.botId) : null
      return { schemaVersion: 1, botId: payload.botId, mode, available, readOnly,
        reason: readOnly ? 'PRODUCT_READ_ONLY' : available ? null : mode === 'integration' ? 'RUNTIME_MODE_MISMATCH' : 'INDEPENDENT_CHAT_UNAVAILABLE',
        pendingRequest: pending(pendingRow) ? project(pendingRow) : null,
        latestRequest: latest ? project(latest) : null,
        context: conversationContext,
        newConversationAvailable: !readOnly && mode === 'independent' && Boolean(conversationContext) && !conversationContext.resetPending && !pending(pendingRow) &&
          !adapter.busyBots?.().includes(payload.botId) && typeof adapter?.newConversation === 'function' }
    },
    messages(payload, context) {
      owner(context); assertOpen(); keys(payload, ['botId', 'cursor', 'limit'])
      if (!ref(payload.botId) || (payload.cursor !== undefined && (typeof payload.cursor !== 'string' || payload.cursor.length > 4096))
        || (payload.limit !== undefined && (!Number.isSafeInteger(payload.limit) || payload.limit < 1 || payload.limit > 100))) fail('INDEPENDENT_CHAT_INVALID_REQUEST')
      context.signal?.throwIfAborted()
      if (!lifecycle.committedBot(payload.botId)) fail('BOT_NOT_COMMITTED')
      const adapter = runtime()
      if (typeof adapter?.conversationPage !== 'function') fail('INDEPENDENT_CHAT_UNAVAILABLE')
      // One adapter call owns one immutable transcript snapshot. Never turn a
      // preview position into a second read of a moving transcript.
      return adapter.conversationPage(payload.botId, { ...(payload.cursor === undefined ? {} : { cursor: payload.cursor }), limit: payload.limit ?? 40 })
    },
    send(payload, context) {
      owner(context); assertOpen(); keys(payload, ['botId', 'requestKey', 'input']); identity(payload)
      if (context.readOnly === true) fail('PRODUCT_READ_ONLY')
      if (typeof payload.input !== 'string' || !payload.input.trim() || Buffer.byteLength(payload.input) > 64_000) fail('INDEPENDENT_CHAT_INPUT_LIMIT')
      context.signal?.throwIfAborted()
      const inputHash = hash(payload.input)
      const previous = read(payload.botId, payload.requestKey)
      if (previous) {
        if (previous.operation_kind !== 'send' || previous.input_hash !== inputHash) fail('INDEPENDENT_CHAT_REQUEST_CONFLICT')
        return project(recover(previous))
      }
      const adapter = current(payload.botId)
      if (active.size >= maxActive) fail('INDEPENDENT_CHAT_CONCURRENCY_LIMIT')
      if (adapter.busyBots?.().includes(payload.botId)) fail('BOT_BUSY')
      const inserted = db.transaction(() => {
        const raced = read(payload.botId, payload.requestKey)
        if (raced) {
          if (raced.operation_kind !== 'send' || raced.input_hash !== inputHash) fail('INDEPENDENT_CHAT_REQUEST_CONFLICT')
          return false
        }
        assertNoPending(payload.botId)
        if (db.prepare('SELECT count(*) AS n FROM bot_independent_chat_requests').get().n >= maxRequests) fail('INDEPENDENT_CHAT_HISTORY_LIMIT')
        context.signal?.throwIfAborted()
        db.prepare("INSERT INTO bot_independent_chat_requests(bot_id,request_key,schema_version,input_hash,state,owner_id,owner_pid,created_at,updated_at,cancel_requested_at,result,error_code,input_text) VALUES(?,?,1,?,'accepted',?,?,?,?,NULL,NULL,NULL,?)")
          .run(payload.botId, payload.requestKey, inputHash, ownerId, process.pid, now(), now(), payload.input)
        return true
      }).immediate()
      if (!inserted) return project(recover(read(payload.botId, payload.requestKey)))
      const row = read(payload.botId, payload.requestKey), entry = { controller: new AbortController(), done: null }
      active.set(entryKey(payload.botId, payload.requestKey), entry)
      entry.done = Promise.resolve().then(() => run(row, payload.input, entry))
      entry.done.catch(() => {})
      return project(row)
    },
    newConversation(payload, context) {
      owner(context); assertOpen(); keys(payload, ['botId', 'requestKey']); identity(payload)
      if (context.readOnly === true) fail('PRODUCT_READ_ONLY')
      context.signal?.throwIfAborted()
      const previous = read(payload.botId, payload.requestKey)
      if (previous) {
        if (previous.operation_kind !== 'new-conversation') fail('INDEPENDENT_CHAT_REQUEST_CONFLICT')
        return project(recover(previous))
      }
      const adapter = current(payload.botId)
      if (typeof adapter.newConversation !== 'function' || typeof adapter.contextOf !== 'function') fail('INDEPENDENT_CONTEXT_UNAVAILABLE')
      if (active.size >= maxActive) fail('INDEPENDENT_CHAT_CONCURRENCY_LIMIT')
      if (adapter.busyBots?.().includes(payload.botId)) fail('BOT_BUSY')
      const base = adapter.contextOf(payload.botId)
      if (base.resetPending) fail('INDEPENDENT_CONTEXT_PENDING_RECONCILIATION')
      const contextId = independentContextId(payload.botId, payload.requestKey)
      const inserted = db.transaction(() => {
        const raced = read(payload.botId, payload.requestKey)
        if (raced) {
          if (raced.operation_kind !== 'new-conversation') fail('INDEPENDENT_CHAT_REQUEST_CONFLICT')
          return false
        }
        assertNoPending(payload.botId)
        if (db.prepare('SELECT count(*) AS n FROM bot_independent_chat_requests').get().n >= maxRequests) fail('INDEPENDENT_CHAT_HISTORY_LIMIT')
        context.signal?.throwIfAborted()
        db.prepare("INSERT INTO bot_independent_chat_requests(bot_id,request_key,schema_version,input_hash,state,owner_id,owner_pid,created_at,updated_at,cancel_requested_at,result,error_code,input_text,operation_kind,context_id,base_context_id) VALUES(?,?,1,?,'accepted',?,?,?,?,NULL,NULL,NULL,NULL,'new-conversation',?,?)")
          .run(payload.botId, payload.requestKey, hash('new-conversation'), ownerId, process.pid, now(), now(), contextId, base.contextId)
        return true
      }).immediate()
      if (!inserted) return project(recover(read(payload.botId, payload.requestKey)))
      const row = read(payload.botId, payload.requestKey), entry = { controller: new AbortController(), done: null }
      active.set(entryKey(payload.botId, payload.requestKey), entry)
      entry.done = Promise.resolve().then(() => runReset(row, entry))
      entry.done.catch(() => {})
      return project(row)
    },
    inspect(payload, context) {
      owner(context); assertOpen(); keys(payload, ['botId', 'requestKey']); identity(payload)
      context.signal?.throwIfAborted()
      return project(recover(read(payload.botId, payload.requestKey), context.readOnly === true))
    },
    cancel(payload, context) {
      owner(context); assertOpen(); keys(payload, ['botId', 'requestKey']); identity(payload)
      if (context.readOnly === true) fail('PRODUCT_READ_ONLY')
      context.signal?.throwIfAborted()
      const row = read(payload.botId, payload.requestKey)
      if (!row) fail('INDEPENDENT_CHAT_REQUEST_NOT_FOUND')
      const entry = active.get(entryKey(payload.botId, payload.requestKey))
      if (pending(row) && entry) {
        db.prepare('UPDATE bot_independent_chat_requests SET cancel_requested_at=coalesce(cancel_requested_at,?),updated_at=? WHERE bot_id=? AND request_key=? AND owner_id=?')
          .run(now(), now(), payload.botId, payload.requestKey, ownerId)
        entry.controller.abort(Object.assign(new Error('INDEPENDENT_CHAT_CANCEL_REQUESTED'), { code: 'BOT_LOOP_CANCELLED' }))
      }
      return project(recover(read(payload.botId, payload.requestKey)))
    },
    async whenIdle() { await Promise.allSettled([...active.values()].map(entry => entry.done)) },
    close() {
      if (closed) return
      closed = true
      for (const entry of active.values()) entry.controller.abort(Object.assign(new Error('INDEPENDENT_CHAT_CLOSED'), { code: 'BOT_LOOP_CANCELLED' }))
      try {
        db.prepare("UPDATE bot_independent_chat_requests SET state='unknown',error_code='INDEPENDENT_CHAT_CLOSED',updated_at=? WHERE owner_id=? AND state IN ('accepted','running')").run(now(), ownerId)
      } finally { db.close() }
    },
  })
}
