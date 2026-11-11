import test from 'node:test'
import assert from 'node:assert/strict'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { offlineModelInfo } from './helpers/product-native-llm.mjs'

const hostPrice = { input: 3, output: 4, cacheRead: 0.5 }
const productConfig = { modelProfilesJson: JSON.stringify([{ provider: 'beta', model: 'vendor/two', pricing: hostPrice }]) }
const asProfile = ({ model, funding }) => ({
  ...model, enabled: true,
  funding: { mode: funding.mode, scopeId: funding.scopeId, pricing: funding.pricing, request: funding.request },
})

async function configure({ bind, dispatch }) {
  await bind('a', 'alpha', 'one')
  await bind('b', 'beta', 'vendor/two')
  const main = await dispatch('binding.inspect', { botId: 'a' })
  const beta = main.accounts.items.find(account => account.provider === 'beta')
  const primary = asProfile(main.record.settings)
  primary.funding.request.maxOutputTokens = 40
  const extra = { provider: 'beta', model: 'vendor/two', enabled: true,
    funding: { mode: 'api', scopeId: beta.id, pricing: null, request: { maxInputTokens: 2048, maxOutputTokens: 30 } } }
  const settings = { ...main.record.settings,
    mainRoutes: { schemaVersion: 1, routes: [primary, extra], limits: { api: { dailyBudgetUsd: 1, monthlyBudgetUsd: 10 }, subscription: null } } }
  const save = (settings, expectedRevision) => dispatch('binding.save', { botId: 'a', expectedRevision, settings })
  const saved = await save(settings, main.record.revision)
  return { saved, save, beta }
}

async function withLoop(run) {
  let actual
  await withProductIndependent(async fixture => {
    const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'alpha', model: 'one' } })
    const send = async text => {
      handle.agent.send(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), 'next-turn', true)
      await handle.agent.whenIdle()
    }
    try { await run({ ...fixture, handle, send }) }
    finally { await handle.dispose() }
  }, { productConfig, runtimeConfig: { memoryReview: false }, beforeProduct: async ({ ctx }) => {
    actual = await attachActualAgentLoop(ctx)
    return () => actual.close()
  } })
}

test('Main uses two saved API routes in the actual AgentLoop and shares the Bot budget', async () => {
  await withLoop(async fixture => {
    const { ctx, product, dispatch, readRows, send } = fixture
    const { saved, save, beta } = await configure(fixture)
    const requests = []
    ctx.on('llm/stream', (request, next) => { requests.push(request); return next() })
    assert.deepEqual(saved.settings.mainRoutes.routes[1].funding.pricing, hostPrice)
    assert.deepEqual(saved.settings.model, { provider: 'alpha', model: 'one' })
    assert.equal(readRows('router_model_calls').length, 0)
    const worker = await dispatch('binding.inspect', { botId: 'b' })
    await assert.rejects(dispatch('binding.save', { botId: 'b', expectedRevision: worker.record.revision,
      settings: { ...worker.record.settings, mainRoutes: saved.settings.mainRoutes } }), { code: 'MAIN_ROUTES_ROLE_REQUIRED' })
    const wrongScope = structuredClone(saved.settings)
    wrongScope.mainRoutes.routes[1].funding.scopeId = wrongScope.funding.scopeId
    await assert.rejects(save(wrongScope, saved.revision), { code: 'MAIN_ROUTE_FUNDING_UNAVAILABLE' })
    const legacy = { ...saved.settings, model: { provider: 'beta', model: 'vendor/two' } }
    delete legacy.mainRoutes
    await assert.rejects(save(legacy, saved.revision), { code: 'MAIN_ROUTES_RELOAD_REQUIRED' })
    assert.equal((await dispatch('binding.inspect', { botId: 'a' })).record.revision, saved.revision)

    await send('Use the saved alpha route')
    await ctx.sessionController.selectModel({ sessionId: 'a', provider: 'beta', model: 'vendor/two' })
    await send('Use the saved beta route')
    const receipts = readRows('router_model_calls')
    assert.deepEqual(receipts.map(row => [row.provider, row.model, row.fundingScopeId, row.pricing.input, row.state]), [
      ['alpha', 'one', saved.settings.funding.scopeId, 1, 'settled'],
      ['beta', 'vendor/two', beta.id, 3, 'settled'],
    ])
    assert.deepEqual(requests.map(request => request.maxTokens), [40, 30])
    assert.equal(ctx.upstream.length, 2)
    assert.equal(product.lifecycle.committedBot('a').model, 'alpha/one', 'session selection does not overwrite the default')

    const limited = structuredClone(saved.settings)
    // Beta reserves 0.006264 USD. Either prior route alone fits with that
    // reservation, but the two real settled calls together exceed 0.00633.
    limited.mainRoutes.limits.api.dailyBudgetUsd = 0.00633
    await save(limited, saved.revision)
    await send('This call would exceed the combined Bot limit')
    assert.equal(ctx.upstream.length, 2)
    assert.equal(readRows('router_model_calls').length, 2)
    assert.match(JSON.stringify(fixture.handle.agent.session.log.filter(event => event.type === 'turn/end').at(-1)), /MODEL_WAITING_BUDGET/)
  })
})

test('a Main binding edit inside actual SDK preparation refuses the old call before provider or receipt', async () => {
  await withLoop(async fixture => {
    const { ctx, readRows, send } = fixture
    const { saved, save } = await configure(fixture)
    let prepared = 0
    let dispatched = 0
    class EditingAdapter extends LlmAdapter {
      async listModels(provider) { return [offlineModelInfo(provider, provider === 'alpha' ? 'one' : 'vendor/two')] }
      async resolveModel(provider, model) { return offlineModelInfo(provider, model) }
      async prepareCall(provider, model) {
        prepared++
        const changed = structuredClone(saved.settings)
        changed.mainRoutes.routes[0].funding.pricing.output = 3
        await save(changed, saved.revision)
        return { model: offlineModelInfo(provider, model), stream: options => this.stream(options) }
      }
      async *stream() { dispatched++; yield { type: 'finish', reason: { kind: 'stop' } } }
    }
    ctx.replaceOfflineLlmAdapter(new EditingAdapter())
    await send('The prepared funding revision has changed')
    assert.equal(prepared, 1)
    assert.equal(dispatched, 0)
    assert.deepEqual(readRows('router_model_calls'), [])
    assert.deepEqual(readRows('router_runs'), [])
    assert.match(JSON.stringify(fixture.handle.agent.session.log.filter(event => event.type === 'turn/end').at(-1)), /MODEL_FUNDING_CHANGED/)
  })
})
