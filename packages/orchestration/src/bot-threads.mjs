import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// Per-Bot conversation threads: several independent contexts under one committed
// Bot, each with its own Host Session identity.
//
// What this module is: the durable thread catalog — create, name, switch,
// archive — plus the gate every send must pass before any policy decision. It
// holds no Agent objects and never drives a turn, so a retired Bot cannot be
// written through a stale handle here: identity is re-read from the committed
// lifecycle and re-verified against the Host on every call.
//
// Two owners, one fact each. The Host owns identity and authority: a thread
// Session is created through the product runtime, recorded in the Bot's
// committed state, compiled into ownership by the lifecycle, and only then is
// it sendable. This catalog owns the label, the selection and the request
// keys. Nothing is written twice, so the two can never drift into a state where
// a catalog entry claims an authority the Host does not confirm.
//
// What it is not: a second execution authority. Create/switch/rename/archive
// touch no model, send no greeting or instruction and start no Task. A Session
// is made lazily by `ensureSession` through an injected trusted facade, with
// its working directory taken from the committed Bot record and never from
// thread or client arguments. Every RPC-shaped entry point takes a closed set
// of fields: a thread parameter can carry no model, route, folder, credential,
// endpoint or authorization.
//
// State is one small JSON file per Host, written atomically. Concurrent
// processes are not supported, exactly like the sibling stores
// (bot-session-store.mjs, bot-routine-store.mjs): the Host composes one.

export const BOT_THREAD_SCHEMA = 2
export const THREAD_STATES = Object.freeze(['open', 'archived'])
export const SESSION_STATES = Object.freeze(['none', 'pending', 'unbound', 'owned', 'missing', 'unknown'])
export const MAX_THREADS_PER_BOT = 64
export const MAX_THREADS = 4096
export const MAX_NAME = 80
export const MAX_REQUEST_KEYS = 512
export const DEFAULT_THREAD_NAME = '新线程'

const fail = (code, message) => { const error = new Error(message); error.code = code; throw error }
const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const keyOk = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)
const finite = value => Number.isSafeInteger(value) && value >= 0
const isArchivedAt = value => value !== undefined && value !== null
const stateOf = record => (isArchivedAt(record.archivedAt) ? 'archived' : 'open')

/** A stored name is a label, never an instruction: bounded, trimmed, defaulted. */
const nameOf = value => {
  if (value === undefined || value === null) return DEFAULT_THREAD_NAME
  if (typeof value !== 'string') fail('INVALID_THREAD_NAME', '线程名称必须是字符串。')
  return value.trim().slice(0, MAX_NAME) || DEFAULT_THREAD_NAME
}

/** An RPC-shaped call takes exactly its own fields; anything else is refused. */
const closed = (value, keys, code = 'INVALID_THREAD_REQUEST') => {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) fail(code, '请求格式无效。')
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(code, `不支持的字段：${key}`)
  return value
}

function parseThread(value, botId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('BOT_THREADS_INVALID')
  for (const key of ['threadId', 'name', 'createdAt', 'updatedAt']) if (!(key in value)) fail('BOT_THREADS_INVALID')
  if (!idOk(value.threadId)) fail('BOT_THREADS_INVALID')
  if (typeof value.name !== 'string' || value.name.length > MAX_NAME) fail('BOT_THREADS_INVALID')
  if (!finite(value.createdAt) || !finite(value.updatedAt)) fail('BOT_THREADS_INVALID')
  if (value.archivedAt !== undefined && value.archivedAt !== null && !finite(value.archivedAt)) fail('BOT_THREADS_INVALID')
  if (value.sessionId !== undefined && value.sessionId !== null && !idOk(value.sessionId)) fail('BOT_THREADS_INVALID')
  if (!SESSION_STATES.includes(value.sessionState ?? 'none')) fail('BOT_THREADS_INVALID')
  if (value.requestKey !== undefined && value.requestKey !== null && !keyOk(value.requestKey)) fail('BOT_THREADS_INVALID')
  if (value.operationKey !== undefined && value.operationKey !== null && !keyOk(value.operationKey)) fail('BOT_THREADS_INVALID')
  const sessionState = value.sessionId ? (value.sessionState ?? 'unbound') : 'none'
  return {
    threadId: value.threadId,
    botId,
    name: value.name,
    sessionId: value.sessionId ?? null,
    // A record with no Session reads as 'none' — except for a durable create
    // intent: 'pending' with no Session yet is exactly the marker a restart
    // needs in order to ask the Host what became of the operation.
    sessionState: value.sessionId ? sessionState : (value.sessionState === 'pending' ? 'pending' : 'none'),
    operationKey: value.operationKey ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    archivedAt: value.archivedAt ?? null,
    requestKey: value.requestKey ?? null,
  }
}

/** Validate a saved catalog strictly: a newer or malformed file fails loudly. */
export function parseBotThreads(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('BOT_THREADS_INVALID')
  // A file that exists must declare its schema: silently resetting the catalog
  // would lose every thread record, so only a missing file reads as an empty
  // one (see readState).
  if (value.schemaVersion === undefined) fail('BOT_THREADS_INVALID')
  if (value.schemaVersion > BOT_THREAD_SCHEMA) fail('BOT_THREAD_SCHEMA_NEWER', '线程目录由更新版本写入，请先升级宿主。')
  // Schema 1 carried no operation key; it loads as a legacy catalog.
  if (value.schemaVersion !== BOT_THREAD_SCHEMA && value.schemaVersion !== 1) fail('BOT_THREAD_SCHEMA')
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('BOT_THREADS_INVALID')
  if (!value.bots || typeof value.bots !== 'object' || Array.isArray(value.bots)) fail('BOT_THREADS_INVALID')
  const seenThreads = new Set(), seenSessions = new Map(), bots = {}
  for (const [botId, entry] of Object.entries(value.bots)) {
    if (!idOk(botId) || !entry || typeof entry !== 'object' || Array.isArray(entry)) fail('BOT_THREADS_INVALID')
    if (!Array.isArray(entry.threads) || entry.threads.length > MAX_THREADS_PER_BOT) fail('BOT_THREADS_INVALID')
    if (entry.activeThreadId !== undefined && entry.activeThreadId !== null && !idOk(entry.activeThreadId)) fail('BOT_THREADS_INVALID')
    if (entry.requestKeys !== undefined && (!entry.requestKeys || typeof entry.requestKeys !== 'object')) fail('BOT_THREADS_INVALID')
    const threads = entry.threads.map(thread => {
      const record = parseThread(thread, botId)
      // One identity per thread and one thread per Session, across every Bot:
      // a duplicated claim is a corrupted catalog, never a silent merge.
      if (seenThreads.has(record.threadId)) fail('AMBIGUOUS_THREAD_OWNER')
      seenThreads.add(record.threadId)
      if (record.sessionId) {
        if (seenSessions.has(record.sessionId)) fail('AMBIGUOUS_THREAD_SESSION')
        seenSessions.set(record.sessionId, botId)
      }
      return record
    })
    if (seenThreads.size > MAX_THREADS) fail('BOT_THREADS_LIMIT')
    bots[botId] = { activeThreadId: entry.activeThreadId ?? null, threads, requestKeys: { ...(entry.requestKeys ?? {}) } }
  }
  return { schemaVersion: BOT_THREAD_SCHEMA, revision: value.revision, bots }
}

function readState(file) {
  let text
  try { text = readFileSync(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { schemaVersion: BOT_THREAD_SCHEMA, revision: 0, bots: {} }
    throw error
  }
  let value
  try { value = JSON.parse(text) } catch { fail('BOT_THREADS_INVALID', '线程目录文件损坏。') }
  return parseBotThreads(value)
}

/**
 * The thread catalog for every committed Bot.
 *
 * Injected facades are trusted host code, mirroring the composition seams the
 * product already uses (lifecycle, principal directory, authority, runtime):
 *   committedBot(botId)            -> saved Bot record | null     (lifecycle.committedBot)
 *   lifecycleStatus()              -> { healthy, closed, … } | null (lifecycle.status)
 *   botAuthorized(botId)           -> true | false | null         (authority probe)
 *   ownsSession(botId, sessionId)  -> boolean                     (principal directory)
 *   committedThreads(botId)        -> [{threadId, sessionId, archivedAt}] (Host's own record)
 *   createSession({botId, threadId, title, dir}) -> sessionId     (runtime factory + Host record)
 *   setThreadArchived({botId, threadId, archivedAt}) -> record | null (Host record)
 *   renameThread({botId, threadId, name})          -> record | null (Host thread title)
 *   inspectSession(sessionId)      -> boolean | null              (optional, Host inspect)
 *   runtimeMode(botId)             -> 'integration' | 'independent' | null
 */
export function createBotThreads({
  file,
  committedBot,
  lifecycleStatus = null,
  botAuthorized = null,
  ownsSession = null,
  committedThreads = null,
  createSession = null,
  setThreadArchived = null,
  renameThread = null,
  inspectSession = null,
  runtimeMode = null,
  now = Date.now,
} = {}) {
  if (typeof file !== 'string' || file === '') throw new TypeError('BOT_THREADS_FILE_REQUIRED')
  if (typeof committedBot !== 'function') throw new TypeError('BOT_THREADS_LIFECYCLE_REQUIRED')
  for (const [name, facade] of [['lifecycleStatus', lifecycleStatus], ['botAuthorized', botAuthorized], ['ownsSession', ownsSession], ['committedThreads', committedThreads], ['createSession', createSession], ['setThreadArchived', setThreadArchived], ['renameThread', renameThread], ['inspectSession', inspectSession], ['runtimeMode', runtimeMode]]) {
    if (facade !== null && typeof facade !== 'function') throw new TypeError(`BOT_THREADS_${name.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_INVALID`)
  }
  let state = readState(file)
  let closed_ = false
  let storageFailed = false
  let durableState = structuredClone(state)
  const assertCatalog = () => {
    if (closed_) fail('BOT_THREADS_CLOSED', '线程目录已关闭。')
    if (storageFailed) fail('BOT_THREADS_STORAGE_FAILED', '线程目录无法读取，暂不能确认会话归属。请修复存储后重启宿主。')
  }
  // Preserve existing record identities: an admitted Session factory may be
  // awaiting its Host while a different local catalog commit fails.
  const restore = snapshot => {
    state.revision = snapshot.revision
    for (const botId of Object.keys(state.bots)) if (!snapshot.bots[botId]) delete state.bots[botId]
    for (const [botId, saved] of Object.entries(snapshot.bots)) {
      const entry = state.bots[botId] ??= { threads: [], requestKeys: {}, activeThreadId: null }
      const records = new Map(entry.threads.map(row => [row.threadId, row]))
      entry.threads = saved.threads.map(row => {
        const record = records.get(row.threadId) ?? {}
        for (const key of Object.keys(record)) if (!Object.hasOwn(row, key)) delete record[key]
        return Object.assign(record, structuredClone(row))
      })
      entry.requestKeys = { ...saved.requestKeys }
      entry.activeThreadId = saved.activeThreadId
    }
  }
  // One create per thread at a time. Two callers asking for the same thread's
  // Session share one outcome, so a double click can never make two Sessions.
  const flights = new Map()

  // An atomic replace: the bytes are written beside the file and moved over it,
  // so a reader never sees a half-written catalog. On Windows the move can meet
  // a momentary sharing violation (an indexer or a scanner touching the file it
  // is replacing); the content is already complete at that point, so a short
  // bounded retry finishes the same write instead of failing a thread write the
  // Host had already confirmed. This is a retry of one local commit — never a
  // replay of anything the Host did.
  const replace = (from, to) => {
    for (let attempt = 0; ; attempt += 1) {
      try { renameSync(from, to); return } catch (error) {
        if (attempt >= 4 || (error?.code !== 'EPERM' && error?.code !== 'EBUSY')) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2 * (attempt + 1))
      }
    }
  }

  const save = () => {
    assertCatalog()
    try {
      state.revision += 1
      mkdirSync(dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, JSON.stringify(state))
      replace(temp, file)
      durableState = structuredClone(state)
    } catch (error) {
      restore(durableState)
      try {
        const disk = readState(file)
        if (disk.revision < durableState.revision) throw new Error('CATALOG_ROLLED_BACK')
        restore(disk)
        durableState = structuredClone(state)
      } catch {
        // Never turn an unreadable catalog into an "unbound" Session. Its
        // historical identities may be the only thing preventing a Bot bypass.
        storageFailed = true
      }
      throw error
    }
  }
  const entryOf = botId => state.bots[botId]
  const ensureEntry = botId => {
    if (!state.bots[botId]) state.bots[botId] = { activeThreadId: null, threads: [], requestKeys: {} }
    return state.bots[botId]
  }
  const publicThread = record => ({
    threadId: record.threadId,
    botId: record.botId,
    name: record.name,
    state: stateOf(record),
    archivedAt: record.archivedAt,
    sessionId: record.sessionId,
    // A hint for the interface only: authority is decided by the live Host
    // check in assertSendable, never by this field. A durable create intent
    // shows as 'pending' before the Session exists, and an outcome the Host
    // cannot confirm as 'unknown'; both can outlive a Session-less record.
    sessionState: record.sessionId ? record.sessionState
      : (record.sessionState === 'pending' || record.sessionState === 'unknown' ? record.sessionState : 'none'),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    active: (entryOf(record.botId)?.activeThreadId ?? null) === record.threadId,
  })
  const located = threadId => {
    for (const [botId, entry] of Object.entries(state.bots)) {
      const record = entry.threads.find(thread => thread.threadId === threadId)
      if (record) return { botId, entry, record }
    }
    return null
  }
  const sessionHolder = sessionId => {
    for (const [botId, entry] of Object.entries(state.bots)) {
      const record = entry.threads.find(thread => thread.sessionId === sessionId)
      if (record) return { botId, entry, record }
    }
    return null
  }
  const hostThreads = botId => (typeof committedThreads === 'function' ? committedThreads(botId) : null) ?? []

  // Fail closed on every host-side doubt: an unhealthy lifecycle has already
  // emptied every grant (suspend()), and an unknown Bot is a deleted or
  // migrated-away one. Neither may accept a thread write.
  const assertHealthy = () => {
    assertCatalog()
    if (typeof lifecycleStatus !== 'function') return
    const status = lifecycleStatus()
    if (status && (status.healthy === false || status.closed === true)) {
      fail('LIFECYCLE_UNHEALTHY', '宿主生命周期未就绪，线程暂不可写入。')
    }
  }
  const assertBot = botId => {
    if (!idOk(botId)) fail('INVALID_BOT_ID', 'Bot 标识无效。')
    const bot = committedBot(botId)
    if (!bot) fail('BOT_NOT_COMMITTED', '该 Bot 不在已提交状态：可能已停用、删除或迁往其他运行时。')
    return bot
  }
  // A suspended or disabled Bot has an empty committed grant: the Host probe
  // says so, and an unanswerable probe is refused rather than assumed. The
  // grant is the only authority a thread turn inherits, so a doubt here must
  // stop the send.
  const assertGrant = botId => {
    if (typeof botAuthorized !== 'function') return { verified: false }
    const verdict = botAuthorized(botId)
    if (verdict === null || verdict === undefined) fail('BOT_GRANT_UNKNOWN', '无法核实该 Bot 的已提交授权，线程暂不可写入。')
    if (verdict === false) fail('BOT_GRANT_EMPTY', '该 Bot 的授权已被撤销或停用，线程暂不可写入。')
    return { verified: true }
  }
  // A Bot is served by exactly one runtime. A Bot moved to the independent
  // loop must not also gain a Host Session here: two writers over one Bot is
  // the failure mode the runtime switch exists to prevent.
  const assertServing = botId => {
    if (typeof runtimeMode !== 'function') return
    const mode = runtimeMode(botId)
    if (mode !== undefined && mode !== null && mode !== 'integration') {
      fail('RUNTIME_MODE_MISMATCH', `运行时已切换：${botId} 当前由 ${mode} 提供服务，集成路径拒绝为其建立线程会话。`)
    }
  }
  // The Host's own record of a thread, or null when the Host has none. The
  // Host is the authority for identity: this catalog only mirrors it.
  const hostThread = (botId, threadId) => hostThreads(botId).find(thread => thread.threadId === threadId) ?? null
  // Live ownership, asked of the Host every time. A revoked mapping can never
  // be used just because this catalog still says 'owned'.
  const hostOwns = (botId, sessionId) => typeof ownsSession === 'function' && ownsSession(botId, sessionId) === true
  // Cross-Bot is answered by ownership lookup, never by a caller-supplied pair:
  // a thread id that lives under another Bot is refused by name.
  const resolveThread = (botId, threadId) => {
    if (!idOk(threadId)) fail('INVALID_THREAD_ID', '线程标识无效。')
    const found = located(threadId)
    if (!found) fail('THREAD_NOT_FOUND', '没有这个线程。')
    if (found.botId !== botId) fail('THREAD_FOREIGN_BOT', '该线程属于另一个 Bot，不能在此使用。')
    return found
  }
  const rememberRequestKey = (entry, requestKey, threadId) => {
    if (!requestKey) return
    entry.requestKeys[requestKey] = threadId
    const keys = Object.keys(entry.requestKeys)
    while (keys.length > MAX_REQUEST_KEYS) delete entry.requestKeys[keys.shift()]
  }
  const nextOpenThread = entry => entry.threads
    .filter(thread => stateOf(thread) === 'open')
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null

  const list = botId => {
    assertCatalog()
    if (!idOk(botId)) fail('INVALID_BOT_ID', 'Bot 标识无效。')
    const entry = entryOf(botId)
    if (!entry) return { botId, activeThreadId: null, threads: [] }
    const threads = entry.threads.map(publicThread)
      .sort((left, right) => {
        if (left.active !== right.active) return left.active ? -1 : 1
        if (left.state !== right.state) return left.state === 'open' ? -1 : 1
        return right.updatedAt - left.updatedAt
      })
    return { botId, activeThreadId: entry.activeThreadId, threads }
  }

  // Creating a thread is a local catalog write. It creates no Session, calls
  // no model, sends no greeting and starts no Task; the new thread only becomes
  // the selection, which is why a duplicate requestKey is answered with the
  // thread it already made instead of a second one.
  const create = (input = {}) => {
    const { botId, name, requestKey } = closed(input, ['botId', 'name', 'requestKey'])
    assertHealthy()
    assertBot(botId)
    if (requestKey !== undefined && requestKey !== null && !keyOk(requestKey)) fail('INVALID_REQUEST_KEY', '请求键格式无效。')
    const entry = ensureEntry(botId)
    if (requestKey && entry.requestKeys[requestKey]) {
      const record = entry.threads.find(thread => thread.threadId === entry.requestKeys[requestKey])
      if (record) return { thread: publicThread(record), created: false }
    }
    if (entry.threads.length >= MAX_THREADS_PER_BOT) fail('THREAD_LIMIT', `每个 Bot 最多 ${MAX_THREADS_PER_BOT} 条线程，请先归档。`)
    if (Object.keys(state.bots).reduce((total, key) => total + state.bots[key].threads.length, 0) >= MAX_THREADS) fail('THREAD_LIMIT', '线程总数已达上限。')
    const at = now()
    const record = {
      threadId: randomUUID(),
      botId,
      name: nameOf(name),
      sessionId: null,
      sessionState: 'none',
      operationKey: null,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      requestKey: requestKey ?? null,
    }
    entry.threads.push(record)
    rememberRequestKey(entry, requestKey ?? null, record.threadId)
    entry.activeThreadId = record.threadId
    save()
    return { thread: publicThread(record), created: true }
  }

  // A thread's title is the Host's fact, exactly like its Session identity: the
  // write lands in the committed state first, and only a reply that confirms
  // the name asked for moves this catalog. A lost reply, or one that confirms a
  // different title, leaves the old name standing — a rename that was never
  // confirmed must never read as a rename that succeeded.
  const rename = async (input = {}) => {
    const { botId, threadId, name } = closed(input, ['botId', 'threadId', 'name'])
    assertHealthy()
    assertBot(botId)
    const { record } = resolveThread(botId, threadId)
    const next = nameOf(name)
    if (typeof renameThread === 'function') {
      let written
      try {
        written = await renameThread({ botId, threadId, name: next })
      } catch (error) {
        // A thread the Host has no record for has no Host title to write: its
        // name travels with the record when the Session is made. Anything else
        // the Host refuses is a refusal, not a rename.
        if (error?.code !== 'BOT_THREAD_UNKNOWN') throw error
        written = null
      }
      if (written !== null && (typeof written.name !== 'string' || written.name !== next)) {
        fail('THREAD_RENAME_UNCONFIRMED', '宿主没有确认这次重命名，线程名称保持不变。')
      }
    }
    record.name = next
    record.updatedAt = now()
    save()
    return publicThread(record)
  }

  // Switching only moves the selection: no Session is created or touched, no
  // model is called, no Task starts. An archived thread may be selected — it
  // stays archived until the owner says otherwise — so a Bot always has a
  // well-defined active thread.
  const switchThread = (input = {}) => {
    const { botId, threadId } = closed(input, ['botId', 'threadId'])
    assertHealthy()
    assertBot(botId)
    const { entry } = resolveThread(botId, threadId)
    entry.activeThreadId = threadId
    save()
    return { botId, activeThreadId: threadId }
  }

  // Archive hides, it never deletes: the Session identity is kept so the thread
  // can be restored with its context intact. The Host records the archive in
  // the same breath, because dropping a thread's authority is the Host's fact
  // to own; only after the Host confirms does this catalog follow.
  const archive = async (input = {}) => {
    const { botId, threadId } = closed(input, ['botId', 'threadId'])
    assertHealthy()
    assertBot(botId)
    const { entry, record } = resolveThread(botId, threadId)
    if (stateOf(record) === 'archived') return { thread: publicThread(record), activeThreadId: entry.activeThreadId, changed: false }
    const at = now()
    if (typeof setThreadArchived === 'function') await setThreadArchived({ botId, threadId, archivedAt: at })
    record.archivedAt = at
    record.updatedAt = at
    if (entry.activeThreadId === threadId) {
      const next = nextOpenThread(entry)
      entry.activeThreadId = next ? next.threadId : null
    }
    save()
    return { thread: publicThread(record), activeThreadId: entry.activeThreadId, changed: true }
  }

  const unarchive = async (input = {}) => {
    const { botId, threadId } = closed(input, ['botId', 'threadId'])
    assertHealthy()
    assertBot(botId)
    const { record } = resolveThread(botId, threadId)
    if (stateOf(record) === 'open') return publicThread(record)
    if (typeof setThreadArchived === 'function') await setThreadArchived({ botId, threadId, archivedAt: null })
    record.archivedAt = null
    record.updatedAt = now()
    save()
    return publicThread(record)
  }

  const resolve = (input = {}) => {
    const { botId, threadId } = closed(input, ['botId', 'threadId'])
    assertCatalog()
    if (!idOk(botId)) fail('INVALID_BOT_ID', 'Bot 标识无效。')
    return publicThread(resolveThread(botId, threadId).record)
  }

  const threadBySession = sessionId => {
    assertCatalog()
    if (!idOk(sessionId)) return null
    const found = sessionHolder(sessionId)
    return found ? { botId: found.botId, threadId: found.record.threadId } : null
  }

  // The pre-policy gate. Everything a send needs is decided here, before any
  // model or tool call: the Bot is committed and healthy, its grant still
  // stands, the thread is open, and the Host itself confirms — right now, not
  // from a cached flag — that this Session belongs to this Bot.
  //
  // It is written once, as a probe that answers with a result, because the
  // shape a caller must branch on is the one that used to be unreachable: a
  // caller that read a field after the throwing form had already refused never
  // learned why. `assertSendable` throws the very same answer, so the two can
  // never drift apart.
  const probeSendable = (input = {}) => {
    const { botId, threadId } = closed(input, ['botId', 'threadId'])
    const refuse = (code, message, sessionState = null) => ({ ok: false, botId, threadId, code, message, sessionState })
    try {
      assertHealthy()
      const bot = assertBot(botId)
      assertServing(botId)
      const { record } = resolveThread(botId, threadId)
      if (stateOf(record) === 'archived') return refuse('THREAD_ARCHIVED', '该线程已归档，恢复后再继续对话。', record.sessionState)
      const grant = assertGrant(botId)
      // An operation whose outcome the Host never confirmed is unknown, whether or
      // not a Session id was ever written down: it is answered before anything
      // else about the Session, and it is never answered by making a new one.
      if (record.sessionState === 'pending' || record.sessionState === 'unknown') {
        return refuse('SESSION_UNKNOWN', '该线程的会话建立结果未知，请先由所有者核对恢复。', record.sessionState)
      }
      if (!record.sessionId) return refuse('SESSION_MISSING', '该线程尚未建立会话，请稍后重试。', record.sessionState)
      if (record.sessionState === 'missing') return refuse('SESSION_MISSING', '该线程的宿主会话已不存在，需要重新建立。', record.sessionState)
      if (!hostOwns(botId, record.sessionId)) {
        // The Host withdrew or never confirmed this mapping: the catalog follows
        // the Host at once, and the send is refused rather than allowed on a
        // revoked identity.
        record.sessionState = record.sessionId ? 'unbound' : 'none'
        save()
        return refuse('SESSION_NOT_OWNED', '宿主未确认该线程会话的归属，线程暂不可写入。', record.sessionState)
      }
      if (record.sessionState !== 'owned') { record.sessionState = 'owned'; save() }
      return { ok: true, botId, threadId, sessionId: record.sessionId, sessionState: record.sessionState, bot, grantVerified: grant.verified }
    } catch (error) {
      return refuse(error?.code ?? 'THREAD_CHECK_FAILED', error?.message ?? String(error))
    }
  }

  const assertSendable = (input = {}) => {
    const probe = probeSendable(input)
    if (probe.ok) return probe
    const error = new Error(probe.message)
    error.code = probe.code
    throw error
  }

  // Where a thread's Session comes from, and how an interrupted create is
  // answered. The durable 'pending' marker is written before the factory runs,
  // so a crash between "Session made" and "record saved" is visible on the next
  // call: the Host's own committed record is consulted, an identity it confirms
  // is adopted, and an identity it cannot confirm stays 'unknown' — never
  // silently replayed, because a second Session would orphan the first.
  const resolvePending = (botId, record) => {
    const host = hostThread(botId, record.threadId)
    if (host?.sessionId) {
      const holder = sessionHolder(host.sessionId)
      if (holder && holder.record.threadId !== record.threadId) fail('THREAD_SESSION_CONFLICT', '该会话已绑定到另一条线程。')
      record.sessionId = host.sessionId
      record.operationKey = null
      record.sessionState = hostOwns(botId, host.sessionId) ? 'owned' : 'unbound'
      save()
      return record.sessionState
    }
    record.sessionState = 'unknown'
    save()
    return 'unknown'
  }

  const runEnsure = async (botId, record, { recover }) => {
    assertHealthy()
    assertBot(botId)
    assertServing(botId)
    if (stateOf(record) === 'archived') fail('THREAD_ARCHIVED', '该线程已归档，恢复后再继续对话。')
    assertGrant(botId)
    if (typeof createSession !== 'function') fail('SESSION_FACTORY_REQUIRED', '宿主未提供会话工厂，线程暂无法建立会话。')
    if (typeof ownsSession !== 'function') fail('SESSION_OWNERSHIP_UNVERIFIABLE', '宿主未提供会话归属核实，线程暂无法建立会话。')
    if (record.sessionId && record.sessionState === 'owned' && hostOwns(botId, record.sessionId)) {
      return { sessionId: record.sessionId, state: 'owned', created: false }
    }
    if (record.sessionId && record.sessionState === 'unbound') {
      // A Session the Host has not confirmed is kept, never duplicated: making
      // a second one would orphan the first and hide the missing hook.
      if (hostOwns(botId, record.sessionId)) {
        record.sessionState = 'owned'
        save()
        return { sessionId: record.sessionId, state: 'owned', created: false }
      }
      fail('SESSION_NOT_OWNED', '宿主未确认该线程会话的归属：请先在 Host 记录该线程会话后重试。')
    }
    if (record.sessionState === 'pending') {
      // A previous run got as far as the factory and its outcome was never
      // recorded. The Host's committed record decides, not a guess. The marker
      // stands whether or not a Session id was ever written down.
      const settled = resolvePending(botId, record)
      if (settled === 'owned') return { sessionId: record.sessionId, state: 'owned', created: false }
      if (settled === 'unbound') fail('SESSION_NOT_OWNED', '宿主未确认该线程会话的归属：请先在 Host 记录该线程会话后重试。')
      if (recover !== true) fail('SESSION_UNKNOWN', '该线程上一次建立会话的结果未知：可能已创建但未能记录。请核对后由所有者确认恢复，不要自动重放。')
    }
    if (record.sessionState === 'unknown' && recover !== true) {
      fail('SESSION_UNKNOWN', '该线程上一次建立会话的结果未知：可能已创建但未能记录。请核对后由所有者确认恢复，不要自动重放。')
    }
    if (record.sessionId && record.sessionState === 'missing') {
      // The Host no longer has this Session, so a fresh one is the only answer.
      record.sessionId = null
      record.sessionState = 'none'
      record.operationKey = null
      save()
    }
    const bot = committedBot(botId)
    // The durable intent comes first: whatever happens next, the next call
    // finds this thread mid-operation and resolves it from the Host's record.
    const operationKey = randomUUID()
    record.operationKey = operationKey
    record.sessionState = 'pending'
    save()
    let sessionId
    try {
      sessionId = await createSession({ botId, threadId: record.threadId, title: record.name, dir: typeof bot?.workDir === 'string' ? bot.workDir : undefined, operationKey })
    } catch (error) {
      // A trusted refusal that names no Session (read-only host, unknown Bot)
      // clears the intent: nothing was made. Any other outcome is unknown.
      if (error?.outcome === 'refused') {
        record.sessionState = record.sessionId ? 'unbound' : 'none'
        record.operationKey = null
        save()
      }
      throw error
    }
    if (!idOk(sessionId)) fail('SESSION_INVALID', '宿主返回的会话标识无效。')
    const holder = sessionHolder(sessionId)
    if (holder) fail('THREAD_SESSION_CONFLICT', '该会话已绑定到另一条线程。')
    record.sessionId = sessionId
    record.operationKey = null
    record.sessionState = 'none'
    save()
    if (!hostOwns(botId, sessionId)) {
      record.sessionState = 'unbound'
      save()
      fail('SESSION_NOT_OWNED', '宿主未确认该线程会话的归属：请先在 Host 记录该线程会话后重试。')
    }
    record.sessionState = 'owned'
    save()
    return { sessionId, state: 'owned', created: true }
  }

  const ensureSession = (input = {}) => {
    const { botId, threadId, recover } = closed(input, ['botId', 'threadId', 'recover'])
    if (closed_) fail('BOT_THREADS_CLOSED', '线程目录已关闭。')
    if (!idOk(botId) || !idOk(threadId)) fail('INVALID_THREAD_ID', '线程标识无效。')
    const { record } = resolveThread(botId, threadId)
    const flight = `${botId}\u0000${threadId}`
    const running = flights.get(flight)
    // Single flight: the second caller waits for the first outcome instead of
    // making a Session of its own.
    if (running) return running
    const work = runEnsure(botId, record, { recover: recover === true }).finally(() => flights.delete(flight))
    flights.set(flight, work)
    return work
  }

  // The navigation contract. Opening a thread moves the selection and reports
  // the real Session identity; it delivers nothing. With `create` the caller
  // explicitly asks for the Session to exist (still no model call), which is
  // the only path that makes one.
  const openThread = (input = {}) => {
    const { botId, threadId, create } = closed(input, ['botId', 'threadId', 'create'])
    assertHealthy()
    assertBot(botId)
    assertServing(botId)
    const { entry, record } = resolveThread(botId, threadId)
    entry.activeThreadId = threadId
    save()
    if (create !== true) {
      return { botId, threadId, activeThreadId: threadId, sessionId: record.sessionId, sessionState: record.sessionId ? record.sessionState : 'none', created: false, needsSession: record.sessionId === null }
    }
    return ensureSession({ botId, threadId }).then(result => ({
      botId, threadId, activeThreadId: threadId, sessionId: result.sessionId, sessionState: 'owned', created: result.created, needsSession: false,
    }))
  }

  // Re-read the Host's own view after a restart or a grant refresh. A Session
  // the Host no longer has is reported, never dropped: archive hides threads,
  // and only an explicit delete removes a real conversation. A create that was
  // interrupted is settled here — adopted when the Host confirms it, otherwise
  // left 'unknown' for an owner to review.
  const reconcile = () => {
    if (closed_) fail('BOT_THREADS_CLOSED', '线程目录已关闭。')
    const result = { checked: 0, owned: 0, unbound: 0, missing: 0, unknown: 0, adopted: 0, pending: 0 }
    for (const [botId, entry] of Object.entries(state.bots)) {
      for (const record of entry.threads) {
        const host = hostThread(botId, record.threadId)
        if (host === null && record.sessionId === null && record.sessionState === 'none') continue
        result.checked += 1
        if (record.sessionState === 'pending') {
          resolvePending(botId, record)
          result.pending += 1
        }
        if (host !== null && host.sessionId && record.sessionId !== host.sessionId) {
          record.sessionId = host.sessionId
          result.adopted += 1
        }
        // The Host's archive is the authority: a thread it archived is archived.
        if (host !== null && isArchivedAt(host.archivedAt) && !isArchivedAt(record.archivedAt)) {
          record.archivedAt = host.archivedAt
          if (entry.activeThreadId === record.threadId) entry.activeThreadId = nextOpenThread(entry)?.threadId ?? null
        }
        if (!record.sessionId) continue
        if (hostOwns(botId, record.sessionId)) { record.sessionState = 'owned'; result.owned += 1; continue }
        const exists = typeof inspectSession === 'function' ? inspectSession(record.sessionId) : null
        record.sessionState = exists === false ? 'missing' : (record.sessionState === 'unknown' ? 'unknown' : 'unbound')
        result[record.sessionState] += 1
      }
    }
    if (result.checked > 0) save()
    return result
  }

  // The owner's explicit recovery for a thread whose create outcome is unknown.
  // It adopts the identity the Host confirms, and only when the Host confirms
  // nothing does it make a fresh Session — as a recorded, reviewable act.
  const recover = (input = {}) => {
    const { botId, threadId } = closed(input, ['botId', 'threadId'])
    return ensureSession({ botId, threadId, recover: true })
  }

  // The Bot-delete path calls this after the Host has retired the Bot. It
  // refuses while the Bot is still committed, so a live Bot can never lose its
  // threads to a stray call.
  const purgeBot = botId => {
    assertHealthy()
    if (!idOk(botId)) fail('INVALID_BOT_ID', 'Bot 标识无效。')
    if (committedBot(botId)) fail('BOT_STILL_COMMITTED', '该 Bot 仍在已提交状态，不能清除其线程。')
    if (!state.bots[botId]) return { botId, removed: 0 }
    const removed = state.bots[botId].threads.length
    delete state.bots[botId]
    save()
    return { botId, removed }
  }

  const readModel = (input = {}) => {
    const { botId } = closed(input, ['botId'])
    if (closed_) return { status: 'blocked', reason: '线程目录已关闭。', nextAction: '重启宿主后重试。', items: [], activeThreadId: null }
    if (storageFailed) return { status: 'blocked', reason: '线程目录无法读取，暂不能确认会话归属。', nextAction: '修复存储后重启宿主；不会自动重放会话创建。', items: [], activeThreadId: null }
    if (!idOk(botId)) return { status: 'blocked', reason: 'Bot 标识无效。', nextAction: '从 Bot 列表重新进入。', items: [], activeThreadId: null }
    const status = typeof lifecycleStatus === 'function' ? lifecycleStatus() : null
    if (status && (status.healthy === false || status.closed === true)) {
      return { status: 'blocked', reason: '宿主生命周期未就绪，线程暂时不可用。', nextAction: '修复宿主状态后刷新；线程目录已保留。', items: [], activeThreadId: null }
    }
    const bot = committedBot(botId)
    if (!bot) {
      return { status: 'blocked', reason: '该 Bot 已不在已提交状态。', nextAction: '停用或删除 Bot 后，其线程不再接受写入。', items: [], activeThreadId: null }
    }
    const mode = typeof runtimeMode === 'function' ? runtimeMode(botId) : null
    if (mode !== undefined && mode !== null && mode !== 'integration') {
      return { status: 'blocked', reason: `该 Bot 当前由 ${mode} 运行时提供服务。`, nextAction: '线程会话只在集成运行时可用；移动回集成运行时后恢复。', items: [], activeThreadId: null }
    }
    const view = list(botId)
    return {
      status: 'available',
      reason: '',
      nextAction: '',
      items: view.threads,
      activeThreadId: view.activeThreadId,
      sessionBinding: typeof ownsSession === 'function' ? 'host-confirmed' : 'pending-host-hook',
      archiveAuthority: typeof setThreadArchived === 'function' ? 'host' : 'catalog',
      renameAuthority: typeof renameThread === 'function' ? 'host' : 'catalog',
      identityAuthority: typeof committedThreads === 'function' ? 'host' : 'catalog',
    }
  }

  const close = () => { closed_ = true; for (const flight of flights.values()) flight.catch(() => {}) }

  return Object.freeze({
    BOT_THREAD_SCHEMA,
    THREAD_STATES,
    SESSION_STATES,
    list,
    create,
    rename,
    switchThread,
    archive,
    unarchive,
    resolve,
    openThread,
    assertSendable,
    probeSendable,
    ensureSession,
    recover,
    reconcile,
    purgeBot,
    readModel,
    threadBySession,
    revision: () => state.revision,
    close,
  })
}
