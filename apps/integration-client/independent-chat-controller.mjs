const failure = (code, message = code) => Object.assign(new Error(message), { code })
const BOT = /^[-A-Za-z0-9_.]{1,128}$/
const HOST = /^host-[0-9a-f]{16}$/
const KEY = /^[-A-Za-z0-9_]{16,128}$/
const STATES = new Set(['accepted', 'running', 'succeeded', 'unknown', 'refused', 'cancelled'])
const withoutProgress = status => {
  if (!status) return status
  const { progress, ...stored } = status
  return stored
}
export const independentChatStorageKey = (hostId, botId) => `bot-product:independent-chat:1:${hostId}:${botId}`
export const independentChatNonce = () => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw failure('CHAT_NONCE_UNAVAILABLE', '浏览器无法生成安全请求编号。')
  return globalThis.crypto.randomUUID()
}
export function validateChatRequest(value, botId, requestKey) {
  if (value?.schemaVersion !== 1 || value.botId !== botId || !KEY.test(value.requestKey ?? '') || (requestKey && value.requestKey !== requestKey)
    || !STATES.has(value.state) || typeof value.pending !== 'boolean' || typeof value.finished !== 'boolean' || value.stopConfirmed !== false) throw failure('CHAT_IDENTITY_MISMATCH', '宿主返回的请求身份或状态无效，请保留原编号核对。')
  const progress = value.progress
  if (value.operationKind !== undefined && !['send', 'new-conversation'].includes(value.operationKind)) throw failure('CHAT_IDENTITY_MISMATCH')
  if (progress != null && (value.operationKind === 'new-conversation' || !value.pending || !['accepted', 'running'].includes(value.state) || !Number.isSafeInteger(progress.step) || progress.step < 1 || progress.step > 64
    || !Number.isSafeInteger(progress.sequence) || progress.sequence < 1 || typeof progress.text !== 'string' || progress.text.length > 64000 || typeof progress.truncated !== 'boolean')) throw failure('CHAT_PROGRESS_INVALID', '宿主返回的生成预览格式无效。')
  return value
}
export function validateChatPage(value, botId) {
  if (value?.schemaVersion !== 1 || value.botId !== botId || !Array.isArray(value.items) || value.items.length > 100
    || (value.nextCursor !== null && typeof value.nextCursor !== 'string')
    || value.items.some(row => !row || typeof row.messageId !== 'string' || !row.messageId || typeof row.content !== 'string'
      || !['user', 'assistant', 'tool', 'system'].includes(row.role) || row.contextId !== undefined && (typeof row.contextId !== 'string' || !row.contextId || row.contextId.length > 128))
    || new Set(value.items.map(row => row.messageId)).size !== value.items.length) throw failure('CHAT_PAGE_INVALID', '会话页缺少稳定消息编号，已拒绝显示可能错位的内容。')
  return value
}

/** One mounted, validated Host/Bot. This metadata never authenticates an owner.
 * A persisted uncertain key is inspected only. send() is reachable solely from
 * the owner's explicit submit, after its nonce and exact text are durable.
 */
export function createIndependentChatController({ api, hostId, botId, storage = globalThis.localStorage, pollMs = 1500, timeoutMs = 8000,
  nonce = independentChatNonce, onHostChanged } = {}) {
  if (!HOST.test(hostId ?? '') || !BOT.test(botId ?? '') || typeof api?.dispatch !== 'function') throw failure('CHAT_SCOPE_INVALID')
  const key = independentChatStorageKey(hostId, botId), listeners = new Set(), calls = new Set()
  let live = false, retired = false, timer, polling = false, lock = false, pageLock = false, revision = 0, pageLoaded = false, exhausted = false
  let nextNonce = nonce()
  if (!KEY.test(nextNonce ?? '')) throw failure('CHAT_NONCE_INVALID')
  let state = { hostId, botId, draft: '', pending: null, lastRequest: null, view: null, items: [], nextCursor: null,
    loading: true, sending: false, loadingOlder: false, error: '', storageError: '', acknowledgedRequestKey: null }
  const publish = patch => { if (retired) return; state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const persist = patch => {
    const next = { ...state, ...patch }
    try {
      const pending = next.pending ? { ...next.pending, status: withoutProgress(next.pending.status) } : null
      storage.setItem(key, JSON.stringify({ schemaVersion: 1, hostId, botId, draft: next.draft, pending, acknowledgedRequestKey: next.acknowledgedRequestKey }))
      publish({ ...patch, storageError: '' }); return true
    } catch { publish({ storageError: '无法保存本机草稿与请求编号，请恢复浏览器存储后再发送。' }); return false }
  }
  try {
    const saved = JSON.parse(storage.getItem(key) ?? 'null')
    if (saved?.schemaVersion === 1 && saved.hostId === hostId && saved.botId === botId) {
      const pending = saved.pending && KEY.test(saved.pending.requestKey ?? '') && typeof saved.pending.input === 'string' && saved.pending.input.length <= 64000
        ? { ...saved.pending, status: withoutProgress(saved.pending.status) } : null
      state = { ...state, draft: typeof saved.draft === 'string' ? saved.draft.slice(0, 64000) : '', pending, acknowledgedRequestKey: KEY.test(saved.acknowledgedRequestKey ?? '') ? saved.acknowledgedRequestKey : null }
    }
  } catch { state.storageError = '无法读取本机草稿与请求编号；请修复浏览器存储后再发送。' }
  const call = async (action, payload) => {
    const controller = new AbortController(); calls.add(controller)
    let alarm, abort
    const stopped = new Promise((_, reject) => {
      abort = () => reject(failure('CHAT_TRANSPORT_UNKNOWN', '连接中断，发送结果尚未确认；只核对原请求，不会自动重发。'))
      controller.signal.addEventListener('abort', abort, { once: true })
      alarm = setTimeout(() => controller.abort(), timeoutMs)
    })
    try { return await Promise.race([Promise.resolve().then(() => api.dispatch(action, payload, controller.signal)), stopped]) }
    finally { clearTimeout(alarm); calls.delete(controller); controller.signal.removeEventListener('abort', abort) }
  }
  const assertHost = async () => {
    const namespace = await call('ui.namespace', {})
    if (!live) throw failure('CHAT_SCOPE_RETIRED')
    if (namespace?.schemaVersion !== 1 || !HOST.test(namespace.hostId ?? '')) throw failure('CHAT_SCOPE_INVALID', '宿主没有确认界面存储标识。')
    if (namespace.hostId !== hostId) {
      publish({ view: null, error: '宿主连接已切换，正在重新读取联系人与草稿。' })
      live = false; revision++; clearTimeout(timer)
      for (const controller of calls) controller.abort()
      onHostChanged?.()
      throw failure('CHAT_SCOPE_RETIRED')
    }
  }
  const applyRequest = (value, requestKey) => {
    const request = validateChatRequest(value, botId, requestKey)
    const held = state.pending
    if (held && held.requestKey !== request.requestKey) return
    const operationKind = request.operationKind ?? held?.operationKind ?? 'send'
    if (held?.operationKind && held.operationKind !== operationKind) throw failure('CHAT_IDENTITY_MISMATCH')
    const pending = request.state === 'succeeded' ? null : { requestKey: request.requestKey,
      operationKind, input: held?.input ?? request.recoveryInput ?? '', accepted: request.durableInput === true, status: request }
    const clearDraft = operationKind === 'send' && request.durableInput === true && held && state.draft === held.input
    persist({ pending, ...(clearDraft ? { draft: '' } : {}), lastRequest: request,
      ...(request.state === 'succeeded' ? { acknowledgedRequestKey: request.requestKey } : {}) })
    if (request.state === 'succeeded') nextNonce = nonce()
  }
  const loadMessages = async (cursor, older = false) => {
    const page = validateChatPage(await call('independentChat.messages', { botId, limit: 40, ...(cursor ? { cursor } : {}) }), botId)
    if (!live) return
    const seen = new Set()
    const combined = older ? [...page.items, ...state.items] : [...state.items.filter(row => !page.items.some(next => next.messageId === row.messageId)), ...page.items]
    publish({ items: combined.filter(row => { if (seen.has(row.messageId)) return false; seen.add(row.messageId); return true }),
      ...((older || !pageLoaded) ? { nextCursor: exhausted ? null : page.nextCursor } : {}) })
    pageLoaded = true
    if (older && page.nextCursor === null) exhausted = true
  }
  const refresh = async () => {
    if (!live || polling || lock) return
    polling = true
    const mine = revision
    try {
      await assertHost()
      if (!live || mine !== revision) return
      const view = await call('independentChat.view', { botId })
      if (!live || mine !== revision) return
      if (view?.schemaVersion !== 1 || view.botId !== botId || !['independent', 'integration', null].includes(view.mode) || typeof view.available !== 'boolean') throw failure('CHAT_VIEW_INVALID', '宿主聊天状态无效。')
      publish({ view, error: '' })
      if (state.pending) {
        const requestKey = state.pending.requestKey
        try {
          const value = await call('independentChat.inspect', { botId, requestKey })
          if (!live || mine !== revision) return
          applyRequest(value, requestKey)
        } catch (error) {
          if (live && mine === revision && error?.code === 'INDEPENDENT_CHAT_REQUEST_NOT_FOUND' && state.pending?.requestKey === requestKey) persist({ pending: { ...state.pending, notFound: true } })
          throw error
        }
      } else if (view.pendingRequest || (view.latestRequest && view.latestRequest.requestKey !== state.acknowledgedRequestKey)) {
        applyRequest(view.pendingRequest ?? view.latestRequest)
      }
      if (live && mine === revision) await loadMessages()
      if (live && mine === revision) publish({ loading: false })
    } catch (error) { if (live && mine === revision) publish({ loading: false, view: null, error: String(error?.message ?? error) }) }
    finally {
      polling = false
      if (live) { clearTimeout(timer); timer = setTimeout(refresh, pollMs) }
    }
  }
  return Object.freeze({
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => state,
    start() { if (retired || live) return; live = true; void refresh() },
    dispose() { live = false; retired = true; revision++; clearTimeout(timer); for (const controller of calls) controller.abort(); listeners.clear() },
    setDraft(text) { if (!retired && typeof text === 'string') persist({ draft: text.slice(0, 64000) }) },
    async send() {
      if (!live || lock || state.pending || !state.view?.available || !state.draft.trim()) return
      if (new TextEncoder().encode(state.draft).length > 64000) { publish({ error: '消息超过 64,000 字节，请缩短后发送。' }); return }
      lock = true; revision++
      let requestKey
      try {
        await assertHost()
        if (!live) return
        requestKey = nextNonce
        if (!KEY.test(requestKey)) throw failure('CHAT_NONCE_INVALID')
        const pending = { requestKey, input: state.draft, accepted: false, status: null }
        // Must complete before the first network send. Double click and Enter
        // share this synchronous lock and this one durable nonce.
        if (!persist({ pending, sending: true, error: '' })) return
        const value = await call('independentChat.send', { botId, requestKey, input: pending.input })
        if (live) applyRequest(value, requestKey)
      } catch (error) { if (live) publish({ error: String(error?.message ?? error) }) }
      finally { lock = false; if (live) { publish({ sending: false }); clearTimeout(timer); timer = setTimeout(refresh, 0) } }
    },
    async cancel() {
      if (!live || lock || !state.pending) return
      lock = true; revision++
      const requestKey = state.pending.requestKey
      try { await assertHost(); if (!live) return; const value = await call('independentChat.cancel', { botId, requestKey }); if (live) applyRequest(value, requestKey) }
      catch (error) { if (live) publish({ error: String(error?.message ?? error) }) }
      finally { lock = false; if (live) { clearTimeout(timer); timer = setTimeout(refresh, 0) } }
    },
    async newConversation() {
      if (!live || lock || state.pending || !state.view?.newConversationAvailable || state.storageError) return
      lock = true; revision++
      try {
        await assertHost()
        if (!live) return
        const requestKey = nextNonce
        if (!KEY.test(requestKey)) throw failure('CHAT_NONCE_INVALID')
        if (!persist({ pending: { requestKey, input: '', operationKind: 'new-conversation', accepted: false, status: null }, sending: true, error: '' })) return
        const value = await call('independentChat.newConversation', { botId, requestKey })
        if (live) applyRequest(value, requestKey)
      } catch (error) { if (live) publish({ error: String(error?.message ?? error) }) }
      finally { lock = false; if (live) { publish({ sending: false }); clearTimeout(timer); timer = setTimeout(refresh, 0) } }
    },
    inspect() { clearTimeout(timer); void refresh() },
    restore() {
      const held = state.pending
      if (!live || lock || !held || held.status?.pending !== false || held.status?.finished !== true) return
      if (held.operationKind === 'new-conversation') return false
      const recovered = held.status.recoveryInput ?? held.input
      if (state.draft && state.draft !== recovered) {
        publish({ error: '输入框已有未发送文字，请先复制或清空，再恢复原消息。' })
        return false
      }
      // Restore is a human choice. It only fills the composer. The next send
      // is a new explicit intent, after the old outcome is shown to the owner.
      persist({ draft: recovered, pending: null, lastRequest: held.status, acknowledgedRequestKey: held.requestKey })
      nextNonce = nonce()
    },
    releaseNotFound() {
      // An unacknowledged transport request can be explicitly released only
      // after the authoritative journal answers not-found, never on a timeout.
      if (state.pending?.notFound === true) {
        if (state.pending.operationKind === 'new-conversation') return false
        if (state.draft && state.draft !== state.pending.input) {
          publish({ error: '输入框已有未发送文字，请先复制或清空，再恢复原消息。' })
          return false
        }
        persist({ draft: state.pending.input, pending: null, acknowledgedRequestKey: state.pending.requestKey }); nextNonce = nonce()
      }
    },
    async older() {
      if (!live || pageLock || !state.nextCursor) return
      pageLock = true; publish({ loadingOlder: true })
      try { await loadMessages(state.nextCursor, true) } catch (error) { if (live) publish({ error: String(error?.message ?? error) }) }
      finally { pageLock = false; if (live) publish({ loadingOlder: false }) }
    },
    reloadMessages() { pageLoaded = false; exhausted = false; publish({ items: [], nextCursor: null }); clearTimeout(timer); void refresh() },
  })
}
