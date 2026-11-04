/**
 * The single dispatch point for a Bot turn.
 *
 * Exactly one runtime serves a turn. The switch decides which, this module enforces it, and the
 * result says which one answered — so a log or a panel never has to infer it. A caller that asks
 * for the other runtime is refused rather than quietly served by the wrong path.
 */

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

/**
 * @param {{
 *   switchApi: { modeOf: (botId: string) => 'integration'|'independent' },
 *   integration: (request: object) => Promise<object>,
 *   independent: (request: object) => Promise<object>,
 *   now?: () => number,
 * }} options
 */
export function createBotDispatch({ switchApi, integration, independent, now = Date.now } = {}) {
  if (typeof switchApi?.modeOf !== 'function') throw new TypeError('DISPATCH_REQUIRES_SWITCH')
  if (typeof integration !== 'function') throw new TypeError('DISPATCH_REQUIRES_INTEGRATION')
  if (typeof independent !== 'function') throw new TypeError('DISPATCH_REQUIRES_INDEPENDENT')
  const handlers = { integration, independent }

  return Object.freeze({
    modeOf: botId => switchApi.modeOf(botId),

    /**
     * Serve one turn on the committed runtime.
     * @param {{ botId: string, runtime?: 'integration'|'independent', [key: string]: unknown }} request
     */
    async turn(request = {}) {
      const botId = request.botId
      if (typeof botId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(botId)) fail('INVALID_BOT_ID')
      const committed = switchApi.modeOf(botId)
      // A caller that pinned the other runtime is stale: refuse instead of serving it anyway.
      if (request.runtime !== undefined && request.runtime !== committed) {
        fail('RUNTIME_MODE_MISMATCH', `运行时已切换：${botId} 当前由 ${committed} 提供服务，本次 ${request.runtime} 请求被拒绝。`)
      }
      const startedAt = now()
      const value = await handlers[committed]({ ...request, runtime: committed })
      return { ...value, runtime: committed, botId, startedAt, finishedAt: now() }
    },

    /** What the panel shows: the committed runtime for a Bot, and nothing else. */
    describe(botId) {
      if (typeof botId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(botId)) fail('INVALID_BOT_ID')
      return { botId, runtime: switchApi.modeOf(botId) }
    },
  })
}
