/**
 * Bridges for the independent Bot loop.
 *
 * The loop itself knows nothing about money, grants or memory. These three adapters connect it to
 * the product's existing rules without giving it new authority:
 *
 * - `createBudgetedProvider` prices every model call before it runs, reserves, then settles the
 *   real amount. An unpriced route is refused instead of being called for free.
 * - `createGrantedTools` exposes only the tools the Bot's committed grant names; anything else is
 *   refused before the tool is touched.
 * - `createMemoryRecall` reads the Bot's own transcript and returns bounded excerpts. It never
 *   sends the whole transcript to a provider to "remember".
 */

const fail = code => { const error = new Error(code); error.code = code; throw error }

/**
 * @param {{
 *   route: { provider: string, model: string },
 *   priceFor: (route: { provider: string, model: string }) => { inputPerMTokUsd: number, outputPerMTokUsd: number } | null,
 *   call: (request: { route: object, messages: object[] }) => Promise<{ text?: string, toolCalls?: object[], usage?: { inputTokens?: number, outputTokens?: number } }>,
 *   budget?: { reserve?: (usd: number, route: object) => unknown, settle?: (usd: number, route: object, usage: object) => unknown, release?: () => unknown } | null,
 *   estimateTokens?: (messages: object[]) => number,
 * }} options
 */
export function createBudgetedProvider({ route, priceFor, call, budget = null, estimateTokens = null } = {}) {
  if (!route || typeof route.provider !== 'string' || typeof route.model !== 'string') throw new TypeError('BUDGETED_PROVIDER_REQUIRES_ROUTE')
  if (typeof priceFor !== 'function' || typeof call !== 'function') throw new TypeError('BUDGETED_PROVIDER_REQUIRES_PRICE_AND_CALL')
  const estimate = (messages) => typeof estimateTokens === 'function'
    ? estimateTokens(messages)
    : messages.reduce((sum, message) => sum + Math.ceil(String(message?.content ?? '').length / 4), 0)

  return async function provider({ messages } = {}) {
    if (!Array.isArray(messages)) fail('BUDGETED_PROVIDER_MESSAGES')
    const price = priceFor(route)
    // An unpriced route is unknown, not free: refuse instead of producing a silent zero-cost call.
    if (!price || !Number.isFinite(price.inputPerMTokUsd) || !Number.isFinite(price.outputPerMTokUsd)) fail('ROUTE_UNPRICED')
    const estimateUsd = (estimate(messages) * price.inputPerMTokUsd) / 1_000_000
    const reserved = budget?.reserve ? await budget.reserve(estimateUsd, route) : null
    let reply
    try {
      reply = await call({ route, messages })
    } catch (error) {
      if (budget?.release) await budget.release()
      throw error
    }
    const usage = reply?.usage ?? {}
    const inputTokens = Number.isFinite(usage.inputTokens) ? usage.inputTokens : estimate(messages)
    const outputTokens = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0
    const actualUsd = (inputTokens * price.inputPerMTokUsd + outputTokens * price.outputPerMTokUsd) / 1_000_000
    if (budget?.settle) await budget.settle(actualUsd, route, { inputTokens, outputTokens, estimateUsd, reserved })
    return { ...reply, cost: { estimatedUsd: estimateUsd, actualUsd, route: `${route.provider}/${route.model}` } }
  }
}

/**
 * @param {{
 *   granted: string[],
 *   catalog: Record<string, (args: object, context: { botId: string }) => Promise<unknown>>,
 * }} options
 */
export function createGrantedTools({ granted = [], catalog = {} } = {}) {
  if (!Array.isArray(granted)) throw new TypeError('GRANTED_TOOLS_REQUIRE_LIST')
  if (!catalog || typeof catalog !== 'object') throw new TypeError('GRANTED_TOOLS_REQUIRE_CATALOG')
  const allowed = new Set(granted.filter(name => typeof name === 'string' && Object.hasOwn(catalog, name)))
  return Object.freeze({
    /** Names the Bot may actually call; a grant entry without an implementation is not offered. */
    names: [...allowed].sort(),
    async call(name, args = {}, context = {}) {
      if (typeof name !== 'string' || !name) fail('INVALID_TOOL_NAME')
      if (!allowed.has(name)) fail('TOOL_NOT_GRANTED')
      if (!args || typeof args !== 'object' || Array.isArray(args)) fail('INVALID_TOOL_ARGS')
      return catalog[name](args, context)
    },
  })
}

/**
 * Bounded recall over the Bot's own transcript.
 *
 * @param {{ store: { get: (botId: string) => { messages: object[] } }, maxChars?: number }} options
 */
export function createMemoryRecall({ store, maxChars = 4_000 } = {}) {
  if (!store || typeof store.get !== 'function') throw new TypeError('MEMORY_REQUIRES_STORE')
  if (!Number.isSafeInteger(maxChars) || maxChars < 200 || maxChars > 200_000) throw new TypeError('INVALID_MEMORY_LIMIT')
  return Object.freeze({
    /** The most recent lines that contain the query, newest first, joined and bounded. */
    recall(botId, query = '') {
      const needle = String(query ?? '').trim().toLowerCase()
      if (!needle) return ''
      const messages = store.get(botId).messages
      const hits = []
      for (let index = messages.length - 1; index >= 0 && hits.length < 20; index -= 1) {
        const content = String(messages[index]?.content ?? '')
        if (!content) continue
        if (!content.toLowerCase().includes(needle)) continue
        hits.push(content.length > 600 ? `${content.slice(0, 600)}…` : content)
      }
      return hits.join('\n---\n').slice(0, maxChars)
    },
  })
}
