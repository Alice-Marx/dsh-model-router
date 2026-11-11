/** Isolated owner responses for the identity panel. No model, no Host, no network. */
export function botProfileFixture(bots = [
  { id: 'research', name: '研究伙伴', role: '整理资料', instructions: '先给结论，再给依据；不确定时说明还缺什么。' },
  { id: 'writer', name: '写作伙伴', role: '写会议记录', instructions: '保留原始数据，不改写结论。' },
]) {
  const calls = []
  const store = { bots: Object.fromEntries(bots.map(bot => [bot.id, { ...bot }])), revision: 3, delayMs: 0 }
  const clone = value => structuredClone(value)
  const view = bot => ({ id: bot.id, name: bot.name ?? '', role: bot.role ?? '', instructions: bot.instructions ?? '' })
  const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms) })
  return {
    calls, store,
    list: () => Object.values(store.bots).map(view),
    /** Another window edited this Bot: the committed revision moves with it. */
    editElsewhere(botId, patch) {
      const bot = store.bots[botId]
      if (!bot) return null
      for (const [field, value] of Object.entries(patch)) bot[field] = String(value)
      store.revision += 1
      return view(bot)
    },
    setDelay(ms) { store.delayMs = ms },
    dispatch: async (action, payload) => {
      calls.push({ action, payload: clone(payload) })
      if (store.delayMs > 0) await sleep(store.delayMs)
      const unknown = () => Object.assign(new Error('这个 Bot 不在已提交的宿主目录中。'), { code: 'BOT_PROFILE_UNKNOWN_BOT' })
      if (action === 'botProfile.inspect') {
        const bot = store.bots[payload?.botId]
        if (!bot) throw unknown()
        return { schemaVersion: 1, bot: view(bot), revision: store.revision, limits: { name: 40, role: 24, instructions: 4000 }, availableActions: ['botProfile.save'] }
      }
      if (action === 'botProfile.save') {
        const bot = store.bots[payload?.botId]
        if (!bot) throw unknown()
        // The fence the wiring service applies: the committed revision moved and
        // this Bot's own field no longer holds the value the editor read.
        if (payload.expectedRevision !== store.revision) {
          for (const [field, value] of Object.entries(payload.profile ?? {})) {
            const base = payload.base?.[field]
            if (typeof base === 'string' && (bot[field] ?? '') !== base) {
              throw Object.assign(new Error('这个 Bot 的身份在别处已更新，请重新读取后再保存。'), { code: 'BOT_PROFILE_CONFLICT', details: { field, current: bot[field] ?? '' } })
            }
          }
        }
        const saved = []
        for (const [field, value] of Object.entries(payload.profile ?? {})) {
          const next = String(value).trim()
          if ((bot[field] ?? '') !== next) { bot[field] = next; saved.push(field) }
        }
        store.revision += 1
        return { schemaVersion: 1, botId: bot.id, bot: view(bot), revision: store.revision, saved, notices: [] }
      }
      throw new Error('离线夹具不执行此操作')
    },
  }
}
