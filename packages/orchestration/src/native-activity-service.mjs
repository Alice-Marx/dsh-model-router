/** Host-only writer and authenticated-owner read projection for native activity. */
import { createActivityStore } from './native-activity-store.mjs'
import { activityIdentity, hostConversationId, ACTIVITY_LIMITS, ACTIVITY_TURN_OUTCOMES } from './native-activity-contract.mjs'

const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const fail = code => { throw Object.assign(new Error(code), { code }) }
const boundedId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)
const botIdOk = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
const safeCode = (error, fallback) => /^ACTIVITY_[A-Z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : fallback

export function createNativeActivityService(options = {}) {
  const allowed = ['Database', 'file', 'namespace', 'committedBot', 'nativeRouteForBot', 'redactToolName', 'now', 'ownerId', 'ownerPid', 'isProcessAlive', 'limits']
  if (!plain(options) || Object.keys(options).some(key => !allowed.includes(key))) fail('ACTIVITY_SERVICE_OPTIONS_INVALID')
  const { committedBot, nativeRouteForBot = () => false, ...storeOptions } = options
  if (typeof committedBot !== 'function' || typeof nativeRouteForBot !== 'function') fail('ACTIVITY_SERVICE_LIFECYCLE_REQUIRED')
  let store = null, closed = false, failures = 0, lastCode = null
  const note = code => { failures++; lastCode = code; return { ok: false, code } }
  try { store = createActivityStore(storeOptions) }
  catch (error) { note(safeCode(error, 'ACTIVITY_STORE_UNAVAILABLE')) }
  const assertOpen = () => { if (closed) fail('ACTIVITY_SERVICE_CLOSED') }
  const lookup = botId => {
    let bot
    try { bot = committedBot(botId) } catch { fail('ACTIVITY_BOT_LOOKUP_FAILED') }
    if (!bot || bot.id !== botId) fail('ACTIVITY_BOT_NOT_FOUND')
    return bot
  }
  const recording = () => {
    const health = store?.health()
    const count = Math.max(failures, health?.failures ?? 0)
    const code = lastCode ?? health?.lastCode
    return Object.freeze({ status: count || !store ? 'degraded' : 'ready', failures: count,
      ...(code ? { code } : {}) })
  }
  const observe = event => {
    assertOpen()
    try {
      if (!plain(event) || !['turn-open', 'tool', 'turn-close', 'cancel-requested', 'stop-confirmed'].includes(event.kind)) fail('ACTIVITY_OBSERVATION_INVALID')
      const keys = event.kind === 'tool' ? ['kind', 'identity', 'tool'] : event.kind === 'turn-close' ? ['kind', 'identity', 'outcome'] : ['kind', 'identity']
      if (Object.keys(event).some(key => !keys.includes(key))) fail('ACTIVITY_OBSERVATION_UNKNOWN_FIELD')
      const identity = activityIdentity(event.identity)
      // A deleted Bot may still finish an already-observed turn. It cannot open
      // new work or contribute new tool calls after leaving committed state.
      if (event.kind === 'turn-open' || event.kind === 'tool') lookup(identity.botId)
      if (!store) fail('ACTIVITY_STORE_UNAVAILABLE')
      let result
      switch (event.kind) {
        case 'turn-open': result = store.openTurn(identity); break
        case 'tool': result = store.recordToolEvent(identity, event.tool); break
        case 'turn-close':
          if (!ACTIVITY_TURN_OUTCOMES.includes(event.outcome)) fail('ACTIVITY_TURN_OUTCOME_INVALID')
          result = store.closeTurn(identity, { outcome: event.outcome }); break
        case 'cancel-requested': result = store.requestCancel(identity); break
        case 'stop-confirmed': result = store.confirmStop(identity); break
      }
      return result?.ok === true ? result : note(safeCode(result, 'ACTIVITY_OBSERVATION_FAILED'))
    } catch (error) { return note(safeCode(error, 'ACTIVITY_OBSERVATION_FAILED')) }
  }
  const list = (payload, context) => {
    assertOpen()
    if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED')
    context.signal?.throwIfAborted()
    if (!plain(payload) || Object.keys(payload).some(key => !['botId', 'mode', 'sessionId', 'contextId', 'cursor', 'limit'].includes(key))) fail('ACTIVITY_LIST_PAYLOAD_INVALID')
    if (!botIdOk(payload.botId)) fail('ACTIVITY_BOT_ID_INVALID')
    if (!['integration', 'independent'].includes(payload.mode)) fail('ACTIVITY_MODE_INVALID')
    const limit = payload.limit ?? ACTIVITY_LIMITS.defaultPageSize
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > ACTIVITY_LIMITS.maxPageSize) fail('ACTIVITY_QUERY_LIMIT_INVALID')
    let conversationId, contextId
    if (payload.mode === 'integration') {
      if (Object.hasOwn(payload, 'contextId')) fail('ACTIVITY_INTEGRATION_CONTEXT_REFUSED')
      conversationId = hostConversationId(payload.sessionId)
      contextId = null
    } else {
      if (Object.hasOwn(payload, 'sessionId') || !boundedId(payload.contextId)) fail('ACTIVITY_INDEPENDENT_CONTEXT_INVALID')
      conversationId = contextId = payload.contextId
    }
    lookup(payload.botId)
    const scope = Object.freeze({ botId: payload.botId, mode: payload.mode, conversationId, contextId,
      sessionId: payload.mode === 'integration' ? payload.sessionId : null })
    try {
      if (!store) fail('ACTIVITY_STORE_UNAVAILABLE')
      const nativeRoute = nativeRouteForBot(payload.botId)
      if (typeof nativeRoute !== 'boolean') fail('ACTIVITY_ROUTE_STATE_INVALID')
      const page = store.page({ botId: scope.botId, mode: scope.mode, conversationId, contextId, cursor: payload.cursor ?? null,
        limit: Math.min(limit, options.limits?.maxPageSize ?? ACTIVITY_LIMITS.maxPageSize) })
      if (page.items.some(row => row.botId !== scope.botId || row.mode !== scope.mode || row.conversationId !== conversationId || row.contextId !== contextId)) fail('ACTIVITY_PAGE_SCOPE_MISMATCH')
      context.signal?.throwIfAborted()
      return Object.freeze({ schemaVersion: 1, scope, items: page.items, nextCursor: page.nextCursor, nativeRoute, recording: recording() })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      const code = safeCode(error, 'ACTIVITY_LIST_FAILED')
      fail(code)
    }
  }
  const close = () => {
    if (closed) return { closed: true, alreadyClosed: true }
    closed = true
    const result = store?.close()
    if (result?.failures) note('ACTIVITY_STORE_CLOSE_FAILED')
    return { closed: true, recording: recording() }
  }
  return Object.freeze({ observe, list, close, health: recording })
}
