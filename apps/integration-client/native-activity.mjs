// Native tool activity: the honest observation surface.
//
// The Host records what a native engine actually did — a tool started, a tool
// returned, a turn closed, a stop was requested, a stop was confirmed. This
// module turns those observations into display records and nothing else:
// it never sends, stops, retries, settles or re-runs anything, and it has no
// access to a tool's parameters or its result, so it never invents one.
//
// The controller is read-only and epoch-guarded. One scope (API instance, Bot,
// mode, session/context) owns one controller; a reply that does not answer that
// scope is discarded instead of displayed, and retiring a controller aborts its
// in-flight read and stops its timer.

const failure = (code, message = code) => Object.assign(new Error(message), { code })
const BOT = /^[-A-Za-z0-9_.]{1,128}$/
// Session, context and call keys are Host-minted and opaque, so they are bounded
// by length and shape only: a format this module invents would refuse real records.
const ID = /^[^\s\u0000-\u001f\u007f]{1,128}$/
const KEY = /^[^\s\u0000-\u001f\u007f]{1,256}$/
const CONTROL = /[\u0000-\u001f\u007f]/
const OUTCOMES = new Set(['succeeded', 'failed', 'cancelled', 'unknown', 'refused', 'host-closed', 'host-lost'])
/** The owner action this surface is allowed to call. Nothing else exists here. */
export const NATIVE_ACTIVITY_ACTION = 'nativeActivity.list'
export const NATIVE_ACTIVITY_LIMIT_MAX = 50
export const NATIVE_ACTIVITY_LIMIT_DEFAULT = 20
/** A loaded page never grows without bound: older rows stop loading, they are never dropped silently. */
const LOADED_MAX = 200
const REQUEST_MS = 8000

/** The four states the interface is allowed to show. Nothing else is invented. */
export const NATIVE_ACTIVITY_STATES = Object.freeze(['running', 'cli-ok', 'cli-error', 'turn-unconfirmed'])
export const NATIVE_ACTIVITY_LABELS = Object.freeze({
  running: '进行中',
  'cli-ok': '已返回',
  'cli-error': '返回错误',
  'turn-unconfirmed': '待核对',
})
const OUTCOME_WORDS = Object.freeze({
  succeeded: '已成功返回',
  failed: '返回失败',
  cancelled: '已取消',
  unknown: '结果未知',
  refused: '被拒绝',
  'host-closed': '宿主已关闭',
  'host-lost': '宿主未保留结果',
})

// Friendly names for the tools a native engine reports. A name the Host did not
// report stays unreported: the row says "工具调用" and the expanded detail says
// the name is missing, rather than guessing one.
const TOOL_WORDS = Object.freeze([
  { match: /^(?:read|readfile|fileread|view)$/i, label: '读取文件', icon: 'file' },
  { match: /^(?:write|createfile|filewrite)$/i, label: '写入文件', icon: 'file' },
  { match: /^(?:edit|multiedit|notebookedit|replace)$/i, label: '修改文件', icon: 'file' },
  { match: /^(?:bash|shell|command|run|exec|terminal)$/i, label: '运行命令', icon: 'computer' },
  { match: /^(?:glob|ls|list|find)$/i, label: '查找文件', icon: 'search' },
  { match: /^(?:grep|search|ripgrep)$/i, label: '搜索内容', icon: 'search' },
  { match: /^(?:task|agent|subagent)$/i, label: '安排子任务', icon: 'team' },
  { match: /^(?:todowrite|todos|plan)$/i, label: '更新任务清单', icon: 'tasks' },
  { match: /^(?:webfetch|fetch|download)$/i, label: '读取网页', icon: 'arrow' },
  { match: /^(?:websearch|searchweb)$/i, label: '搜索网页', icon: 'search' },
  { match: /^(?:lsp|diagnostics|typecheck)$/i, label: '检查代码', icon: 'check' },
])

/** The label and icon one record shows, using only what the Host reported. */
export function nativeActivityTool(record) {
  const raw = record?.toolNameRecorded !== false && typeof record?.toolName === 'string' ? record.toolName.trim() : ''
  const name = raw.startsWith('mcp__') ? raw.split('__').at(-1) : raw
  const family = {
    data_load: ['导入数据', 'chart'], data_describe: ['查看数据结构', 'chart'], data_sql: ['查询数据', 'chart'],
    data_show: ['展示数据', 'chart'], data_export: ['导出数据', 'chart'],
    bot_file_read: ['读取文件', 'file'], bot_file_write: ['写入文件', 'file'],
    browser_open: ['打开网页', 'computer'], browser_screenshot: ['网页截图', 'computer'],
    desktop_screenshot: ['查看桌面', 'computer'], coordinate_bots: ['安排队友工作', 'team'],
  }[name]
  if (family) return { label: family[0], icon: family[1], reported: raw }
  const known = TOOL_WORDS.find(row => row.match.test(name))
  if (known) return { label: known.label, icon: known.icon, reported: raw }
  return { label: raw === '' ? '工具调用' : raw, icon: 'bot', reported: raw }
}

/**
 * The honest state of one observation.
 *
 * A CLI return is not an operation result: `cli-ok` only means the tool answered.
 * An unknown outcome stays unknown even when a late CLI return arrived, so a late
 * return can never paint an uncertain row green.
 */
export function nativeActivityState(record = {}) {
  return NATIVE_ACTIVITY_STATES.includes(record?.state) ? record.state : 'turn-unconfirmed'
}

/** A bounded, readable payload for exactly one scope. */
export function nativeActivityScope({ botId, mode, sessionId, contextId } = {}) {
  const hasSession = typeof sessionId === 'string' && sessionId !== ''
  const hasContext = typeof contextId === 'string' && contextId !== ''
  if (mode === 'integration') {
    if (!BOT.test(botId ?? '') || !hasSession || !KEY.test(sessionId) || hasContext) throw failure('NATIVE_ACTIVITY_SCOPE_INVALID', '集成会话缺少有效的 Bot 或会话标识。')
    return { botId, mode: 'integration', sessionId, contextId: null }
  }
  if (mode === 'independent') {
    if (!BOT.test(botId ?? '') || !hasContext || !ID.test(contextId) || hasSession) throw failure('NATIVE_ACTIVITY_SCOPE_INVALID', '独立会话缺少有效的 Bot 或对话标识。')
    return { botId, mode: 'independent', sessionId: null, contextId }
  }
  throw failure('NATIVE_ACTIVITY_SCOPE_INVALID', '工具记录读取模式无效。')
}

/** The stable identity of one scope: a change here is an epoch boundary. */
export function nativeActivityScopeKey({ botId, mode, sessionId, contextId } = {}) {
  const scope = nativeActivityScope({ botId, mode, sessionId, contextId })
  return `${scope.mode}:${scope.botId}:${scope.sessionId ?? ''}:${scope.contextId ?? ''}`
}

const payloadOf = (scope, cursor, limit) => ({
  botId: scope.botId,
  mode: scope.mode,
  ...(scope.mode === 'integration' ? { sessionId: scope.sessionId } : { contextId: scope.contextId }),
  limit,
  ...(cursor ? { cursor } : {}),
})

const text = (value, max) => typeof value === 'string' && value !== '' && value.length <= max && !CONTROL.test(value) ? value : null
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null

/** One display record. A field the Host did not send stays null; nothing is filled in. */
function readRecord(value, scope) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) return null
  const callKey = text(value.callKey, 128), callId = text(value.callId, 256)
  if (callKey === null || !KEY.test(callKey) || callId === null || !KEY.test(callId)
    || text(value.turnId, 128) === null || text(value.processGeneration, 128) === null
    || !NATIVE_ACTIVITY_STATES.includes(value.state) || count(value.startedAt) === null || count(value.updatedAt) === null
    || value.endedAt !== null && count(value.endedAt) === null
    || value.cliOk !== null && typeof value.cliOk !== 'boolean'
    || value.turnOutcome !== null && !OUTCOMES.has(value.turnOutcome)) return null
  if (['toolNameRecorded', 'turnSettled', 'cancelRequested', 'stopConfirmed', 'lateCliReturn'].some(key => typeof value[key] !== 'boolean')
    || value.state === 'cli-ok' && value.cliOk !== true || value.state === 'cli-error' && value.cliOk !== false
    || ['running', 'turn-unconfirmed'].includes(value.state) && value.cliOk !== null) return null
  if (value.botId !== scope.botId || value.mode !== scope.mode || value.conversationId !== scope.conversationId
    || value.contextId !== scope.contextId) throw failure('NATIVE_ACTIVITY_SCOPE_MISMATCH', '工具记录属于其他会话。')
  const record = {
    schemaVersion: 1, callKey, callId,
    botId: value.botId, mode: value.mode, conversationId: value.conversationId, contextId: value.contextId,
    processGeneration: value.processGeneration, turnId: value.turnId,
    toolName: value.toolNameRecorded === false ? null : text(value.toolName, 128),
    toolNameRecorded: value.toolNameRecorded === true,
    state: value.state, cliOk: value.cliOk, turnOutcome: value.turnOutcome, turnSettled: value.turnSettled === true,
    startedAt: value.startedAt, endedAt: value.endedAt, updatedAt: value.updatedAt,
    cancelRequested: value.cancelRequested === true,
    stopConfirmed: value.stopConfirmed === true,
    lateCliReturn: value.lateCliReturn === true,
    lateCliOk: value.lateCliOk === true ? true : value.lateCliOk === false ? false : null,
    duplicateStarts: count(value.duplicateStarts) ?? 0, duplicateCompletions: count(value.duplicateCompletions) ?? 0,
  }
  return record
}

/**
 * A closed page for exactly this scope. A page that cannot be read completely is
 * refused instead of shown partially, so a gap can never look like finished work.
 */
export function readNativeActivityPage(value, scope) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) throw failure('NATIVE_ACTIVITY_INVALID', '宿主返回的工具记录格式无效。')
  const reply = value.scope
  if (!reply || typeof reply !== 'object' || reply.botId !== scope.botId || reply.mode !== scope.mode) throw failure('NATIVE_ACTIVITY_SCOPE_MISMATCH', '宿主回答的不是当前会话。')
  if (scope.mode === 'integration') {
    if (reply.sessionId !== scope.sessionId || text(reply.conversationId, 128) === null || reply.contextId !== null) throw failure('NATIVE_ACTIVITY_SCOPE_MISMATCH', '宿主回答的不是当前集成会话。')
  } else if (reply.sessionId !== null || reply.contextId !== scope.contextId || reply.conversationId !== scope.contextId) throw failure('NATIVE_ACTIVITY_SCOPE_MISMATCH', '宿主回答的不是当前对话。')
  if (!Array.isArray(value.items) || value.items.length > NATIVE_ACTIVITY_LIMIT_MAX) throw failure('NATIVE_ACTIVITY_INVALID', '宿主返回的工具记录数量无效。')
  const items = []
  for (const row of value.items) {
    const record = readRecord(row, reply)
    if (record === null) throw failure('NATIVE_ACTIVITY_INVALID', '宿主返回的工具记录缺少稳定编号。')
    items.push(record)
  }
  if (new Set(items.map(row => row.callKey)).size !== items.length) throw failure('NATIVE_ACTIVITY_INVALID', '宿主返回的工具记录编号重复。')
  if (typeof value.nativeRoute !== 'boolean') throw failure('NATIVE_ACTIVITY_INVALID', '宿主没有说明这一会话是否记录工具活动。')
  const recording = value.recording
  if (!recording || typeof recording !== 'object' || !['ready', 'degraded'].includes(recording.status)
    || count(recording.failures) === null) throw failure('NATIVE_ACTIVITY_INVALID', '宿主没有说明工具记录写入状态。')
  const nextCursor = value.nextCursor === null ? null : text(value.nextCursor, 4096)
  if (value.nextCursor !== null && nextCursor === null) throw failure('NATIVE_ACTIVITY_INVALID', '宿主返回的记录页码无效。')
  return {
    conversationId: text(reply.conversationId, 128),
    contextId: scope.mode === 'independent' ? scope.contextId : null,
    items,
    nextCursor,
    nativeRoute: value.nativeRoute,
    recording: { status: recording.status, failures: count(recording.failures), code: text(recording.code, 64) },
  }
}

// Newest first, then by call key, exactly the order the Host commits to. The
// order is display only: every record keeps the identity it arrived with.
const compareRecords = (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)
  || (a.callKey < b.callKey ? 1 : a.callKey > b.callKey ? -1 : 0)

/**
 * The reported result is stable, while later cancellation, stop and settlement
 * facts still arrive. Unknown never becomes green, and an older page cannot
 * overwrite a newer observation.
 */
const mergeRecord = (held, next) => {
  for (const key of ['botId', 'mode', 'conversationId', 'contextId', 'processGeneration', 'turnId', 'callId', 'startedAt']) {
    if (held[key] !== next[key]) throw failure('NATIVE_ACTIVITY_SCOPE_MISMATCH', '工具记录的原始身份发生变化。')
  }
  return { ...next,
    state: held.state === 'running' ? next.state : held.state,
    cliOk: held.state === 'running' ? next.cliOk : held.cliOk,
    toolName: held.toolNameRecorded ? held.toolName : next.toolName,
    toolNameRecorded: held.toolNameRecorded || next.toolNameRecorded,
    endedAt: held.endedAt ?? next.endedAt,
    turnOutcome: held.turnSettled ? held.turnOutcome : next.turnOutcome,
    turnSettled: held.turnSettled || next.turnSettled,
    cancelRequested: held.cancelRequested || next.cancelRequested,
    stopConfirmed: held.stopConfirmed || next.stopConfirmed,
    lateCliReturn: held.lateCliReturn || next.lateCliReturn,
    lateCliOk: held.lateCliReturn ? held.lateCliOk : next.lateCliOk,
    duplicateStarts: Math.max(held.duplicateStarts, next.duplicateStarts),
    duplicateCompletions: Math.max(held.duplicateCompletions, next.duplicateCompletions),
    updatedAt: Math.max(held.updatedAt, next.updatedAt),
  }
}

function mergeRecords(previous, incoming) {
  const byKey = new Map(previous.map(row => [row.callKey, row]))
  for (const row of incoming) {
    const held = byKey.get(row.callKey)
    byKey.set(row.callKey, held === undefined ? row : mergeRecord(held, row))
  }
  const items = [...byKey.values()].sort(compareRecords)
  return { items: items.length > LOADED_MAX ? items.slice(0, LOADED_MAX) : items, truncated: items.length > LOADED_MAX }
}

/** The view crop. Paging reads the original records; this only chooses how many are shown. */
export const nativeActivityLatest = (items, count = 4) => items.slice(0, count)

/** What the compact surface says, using only loaded records. */
export function nativeActivitySummary(items) {
  const rows = Array.isArray(items) ? items : []
  const running = rows.find(row => row.state === 'running')
  if (running) {
    const tool = nativeActivityTool(running)
    return { state: 'running', text: `正在进行：${tool.label}`, icon: tool.icon, record: running }
  }
  const first = rows[0]
  if (!first) return null
  const tool = nativeActivityTool(first)
  return { state: first.state, text: `最近：${tool.label} · ${NATIVE_ACTIVITY_LABELS[first.state]}`, icon: tool.icon, record: first }
}

export const nativeActivityOutcomeWord = outcome => (outcome && OUTCOME_WORDS[outcome]) || '宿主未记录结果'

/** A read failure in the owner's words. Raw transport detail never reaches the screen. */
export function nativeActivityNote(error) {
  switch (error?.code) {
    case 'NATIVE_ACTIVITY_SCOPE_INVALID': return '当前会话的工具记录范围无效，已停止读取。'
    case 'NATIVE_ACTIVITY_SCOPE_MISMATCH': return '宿主切换了这一会话的工具记录范围，已停止显示之前的内容。'
    case 'NATIVE_ACTIVITY_INVALID': return '宿主返回的工具记录无法核对，这一页已拒绝显示。'
    case 'NATIVE_ACTIVITY_ABORTED': return '宿主没有在约定时间内回答，已保留上一次读到的记录。'
    case 'NATIVE_ACTIVITY_UNAVAILABLE': return '当前宿主暂不支持读取工具记录。'
    default: return '读取工具记录失败，已保留上一次读到的记录。'
  }
}

export const nativeActivityRecordingNote = recording => recording?.status === 'degraded'
  ? '工具记录写入异常，下面只显示已经记下的部分，可能不完整。'
  : ''

/** `14:20` today, `11-09 14:20` otherwise; an unrecorded time says so. */
export function formatActivityAt(value, now = Date.now()) {
  if (!Number.isSafeInteger(value) || value <= 0) return '时间未记录'
  const at = new Date(value), today = new Date(now)
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  return sameDay ? clock : `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${clock}`
}

/**
 * One mounted, read-only observation of one scope.
 *
 * Polling exists only while this controller is live and only for this scope:
 * dispose() clears the timer and aborts the in-flight read, and every reply is
 * checked against the epoch that asked for it, so a late answer for a retired
 * Host, API, Bot, session or context is dropped instead of displayed.
 */
export function createNativeActivityController({
  api, botId, mode, sessionId, contextId,
  pollMs = 1500, limit = NATIVE_ACTIVITY_LIMIT_DEFAULT, timeoutMs = REQUEST_MS,
} = {}) {
  const scope = nativeActivityScope({ botId, mode, sessionId, contextId })
  const readLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(1, limit), NATIVE_ACTIVITY_LIMIT_MAX) : NATIVE_ACTIVITY_LIMIT_DEFAULT
  if (typeof api?.dispatch !== 'function') throw failure('NATIVE_ACTIVITY_UNAVAILABLE', '宿主没有提供只读工具记录接口。')
  const listeners = new Set(), inflight = new Set()
  let live = false, retired = false, fenced = false, reading = false, paging = false, timer
  let pollEpoch = 0, pageEpoch = 0, pagingStarted = false
  let state = {
    scope, conversationId: null, items: [], latest: [], nextCursor: null,
    loading: true, loadingOlder: false, error: '', code: null, truncated: false, loaded: false,
    nativeRoute: null, recording: { status: null, failures: 0, code: null }, revision: 0,
  }
  const publish = patch => {
    if (retired) return
    state = { ...state, ...patch, latest: nativeActivityLatest((patch.items ?? state.items)) , revision: state.revision + 1 }
    for (const listener of listeners) listener()
  }
  const list = async (cursor, signal) => {
    let cancel
    const interrupted = new Promise((_resolve, reject) => {
      cancel = () => reject(failure('NATIVE_ACTIVITY_ABORTED', '读取已中断。'))
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
    try { return await Promise.race([Promise.resolve().then(() => api.dispatch(NATIVE_ACTIVITY_ACTION, payloadOf(scope, cursor, readLimit), signal)), interrupted]) }
    finally { signal.removeEventListener('abort', cancel) }
  }
  const fail = error => {
    const mismatched = error?.code === 'NATIVE_ACTIVITY_SCOPE_MISMATCH'
    if (mismatched) fenced = true
    publish({ loading: false, error: nativeActivityNote(error), code: typeof error?.code === 'string' ? error.code : null,
      ...(mismatched ? { items: [], nextCursor: null, loaded: false } : {}) })
  }
  const applyPage = (page, olderPage = false) => {
    if (state.conversationId !== null && page.conversationId !== state.conversationId) {
      fenced = true
      fail(failure('NATIVE_ACTIVITY_SCOPE_MISMATCH'))
      return
    }
    const merged = mergeRecords(state.items, page.items)
    const truncated = state.truncated || merged.truncated
    publish({
      items: merged.items, truncated, nextCursor: truncated ? null : olderPage || !pagingStarted ? page.nextCursor : state.nextCursor,
      conversationId: page.conversationId, nativeRoute: page.nativeRoute, recording: page.recording,
      loading: false, loaded: true, error: '', code: null,
    })
  }
  const refresh = async () => {
    if (!live || fenced) return
    if (reading || paging) { clearTimeout(timer); timer = setTimeout(refresh, pollMs); return }
    reading = true
    publish({ loading: true })
    const mine = ++pollEpoch
    const controller = new AbortController()
    inflight.add(controller)
    const alarm = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const page = readNativeActivityPage(await list(null, controller.signal), scope)
      if (!live || mine !== pollEpoch || controller.signal.aborted) return
      applyPage(page)
    } catch (error) { if (live && mine === pollEpoch) fail(error) }
    finally {
      clearTimeout(alarm); reading = false; inflight.delete(controller)
      if (live && !fenced) { clearTimeout(timer); timer = setTimeout(refresh, pollMs) }
    }
  }
  const older = async () => {
    if (!live || paging || reading || fenced || state.truncated || state.nextCursor === null) return
    pagingStarted = true
    paging = true
    publish({ loadingOlder: true })
    const mine = ++pageEpoch
    const cursor = state.nextCursor
    const controller = new AbortController()
    inflight.add(controller)
    const alarm = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const page = readNativeActivityPage(await list(cursor, controller.signal), scope)
      if (!live || mine !== pageEpoch || controller.signal.aborted) return
      applyPage(page, true)
    } catch (error) { if (live && mine === pageEpoch) fail(error) }
    finally { clearTimeout(alarm); paging = false; inflight.delete(controller); if (live) publish({ loadingOlder: false }) }
  }
  return Object.freeze({
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => state,
    start() { if (retired || live || fenced) return; live = true; void refresh() },
    inspect() { clearTimeout(timer); void refresh() },
    older,
    dispose() {
      live = false; retired = true; fenced = true; clearTimeout(timer)
      for (const controller of inflight) controller.abort()
      inflight.clear(); listeners.clear()
    },
  })
}
