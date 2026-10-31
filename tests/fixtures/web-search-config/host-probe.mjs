export const name = 'web-search-config-probe'
export const inject = ['web', 'connection', 'tools', 'sessionController']

// Only installed in a generated offline profile. This provider cannot reach a
// model or the network; a query proves WebRuntime honors the chosen provider.
export function apply(ctx) {
  let fixtureSearchCalls = 0
  ctx.web.registerSearchProvider({ id: 'fixture-search', available: () => true,
    async search() { fixtureSearchCalls++; return { sources: [] } } })
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/web-search-config-probe', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const input = await request.json()
      if (input.remember) {
        const {agent}=await ctx.sessionController.resolveAgent(input.remember.sessionId)
        const result=await ctx.tools.execute({agent,name:'remember',arguments:{text:input.remember.topic?'Offline topic detail survives migration':'Offline fixture preference survives migration',...(input.remember.topic?{topic:'fixture-topic'}:{})},callId:'migration-memory-fixture',signal:AbortSignal.timeout(10000)})
        if(result.isError)throw new Error('Offline memory fixture tool refused')
      }
      if (input.search === true) await ctx.web.search({ query: 'offline fixture', maxResults: 1 })
      const entries = [...ctx.root.get('loader').entries()]
      const router = entries.find(entry => entry.options.id === 'model-router-galgame')
      const value = value => typeof value?.get === 'function' ? value.get() : value
      return Response.json({ autoRegistered: ctx.web.searchProviders.has('auto'), fixtureSearchCalls,
        searchProvider: value(ctx.web.config.searchProvider), fetchProvider: value(ctx.web.config.fetchProvider),
        routerEntries: entries.filter(entry => entry.options.name === '@ljwei-stak/dsh-model-router').length,
        legacyBotEntries: entries.filter(entry => entry.options.name === 'ds-bot').length,
        legacySearchEntries: entries.filter(entry => entry.options.name === 'ds-bot/web-search').length,
        runtimeHome: router?.fiber?.config.botRuntime?.home,
        futureOption: router?.fiber?.config.botRuntime?.futureOption,
        modelProfilesJson: value(router?.fiber?.config.modelProfilesJson),
        dailyBudgetUsd: value(router?.fiber?.config.dailyBudgetUsd), monthlyBudgetUsd: value(router?.fiber?.config.monthlyBudgetUsd) })
    },
  }), 'web-search-config-probe: offline diagnostics')
}
