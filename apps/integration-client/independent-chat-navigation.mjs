export const INDEPENDENT_CHAT_PANEL = 'bot-product-independentChat'
const scopes = new WeakMap()
export function independentChatNavigation(api) {
  if (scopes.has(api)) return scopes.get(api)
  let snapshot = null, version = 0
  const listeners = new Set()
  const navigation = Object.freeze({
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => snapshot,
    select(botId) {
      if (typeof botId !== 'string' || !/^[-A-Za-z0-9_.]{1,128}$/.test(botId)) throw new TypeError('CHAT_BOT_REQUIRED')
      snapshot = Object.freeze({ botId, version: ++version })
      for (const listener of listeners) listener()
    },
  })
  scopes.set(api, navigation); return navigation
}
export function openIndependentChat(api, openPanel, botId) {
  independentChatNavigation(api).select(botId)
  return openPanel?.(INDEPENDENT_CHAT_PANEL)
}
