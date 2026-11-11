/** Isolated owner responses for real chat UI components. No model or Host calls. */
export function chatSettingsFixture(bot) {
  const calls = []
  const profile = { id: bot.id, name: bot.name, role: '整理资料', instructions: '先给结论，再给依据。' }
  let profileRevision = 7
  const state = { schemaVersion: 1, bot: { ...bot }, record: { botId: bot.id, revision: 1, status: 'blocked',
    settings: { schemaVersion: 1, enabled: false, model: { provider: 'fixture', model: 'research-model' }, officialTools: [], machineGrants: [], capabilities: [], workspaceRef: null, maxConcurrentTasks: 1, routing: null,
      funding: { mode: 'api', scopeId: null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null } },
    catalog: { models: [{ provider: 'fixture', model: 'research-model', label: '研究模型 · 合成目录', cliModels: [] }, { provider: 'fixture', model: 'writing-model', label: '写作模型 · 合成目录', cliModels: [] }],
      tools: [], machines: [], capabilities: [], fundingScopes: [] } }, accounts: { status: 'available', items: [] }, availableActions: ['binding.save'] }
  return { calls, dispatch: async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'botProfile.inspect' && payload.botId === bot.id) return { schemaVersion: 1, bot: structuredClone(profile), revision: profileRevision }
    if (action === 'botProfile.save' && payload.botId === bot.id) {
      for (const field of Object.keys(payload.profile)) if (profile[field] !== payload.base[field]) throw Object.assign(new Error('Fixture profile conflict'), { code: 'BOT_PROFILE_CONFLICT' })
      const saved = Object.keys(payload.profile)
      for (const field of saved) profile[field] = payload.profile[field].trim()
      profileRevision++; state.bot.name = profile.name; state.bot.role = profile.role
      return { schemaVersion: 1, botId: bot.id, bot: structuredClone(profile), revision: profileRevision, saved }
    }
    if (action === 'binding.inspect' && payload.botId === bot.id) return structuredClone(state)
    if (action === 'binding.save' && payload.botId === bot.id) { state.record.settings = payload.settings; state.record.revision++; return { botId: bot.id, revision: state.record.revision } }
    throw new Error('离线夹具不执行此操作')
  } }
}
