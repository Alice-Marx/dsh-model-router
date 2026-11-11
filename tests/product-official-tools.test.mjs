import test from 'node:test'
import assert from 'node:assert/strict'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { executeBotOfficialTool, installRouterStateStore } from '../.dsh-plugin/router-core.mjs'
import { runOfficialTask } from '../.dsh-plugin/shared/official-team-runtime.mjs'

const owner = { kind: 'owner', peer: { principal: { kind: 'owner' } } }
const card = view => view.record.catalog.tools.find(row => row.toolId === 'codex')
const offline = () => {
  const state = { login: 'logged-in', installed: true, launches: [] }
  return { state, service: {
    probeHealth: async () => ({ tools: [{ id: 'codex', installed: state.installed, login: { state: state.login } }] }),
    probeCapabilities: () => [{ id: 'codex', supported: true, modes: ['read-only'] }],
    probeReadiness: async () => ({ ready: true, readyModes: ['read-only'] }),
  } }
}

test('real SQLite composition saves cross-provider CLI defaults, revokes only CLI grants and restores them after recheck', { timeout: 60000 }, async () => {
  const f = offline()
  await withProductIndependent(async ({ ctx, product, runtime, dispatch, bind }) => {
    await bind('b', 'beta', 'vendor/two')
    let view = await dispatch('binding.inspect', { botId: 'b', refreshOfficialTools: true })
    assert.equal(card(view).status, 'ready')
    assert.deepEqual(card(view).identities.map(item => item.model), ['vendor-default'])
    const saved = await dispatch('binding.save', { botId: 'b', expectedRevision: view.record.revision,
      settings: { ...view.record.settings, officialTools: [{ toolId: 'codex', cliModel: 'vendor-default', mode: 'read-only' }] } })
    assert.equal(saved.status, 'available')
    assert.equal(saved.settings.model.provider, 'beta')
    assert.ok(saved.grant.tools.includes('tool/model_router_tool_run'))
    assert.ok(!saved.grant.tools.includes('cli/codex'))
    await runtime.move('b', 'independent')
    f.service.invoke = args => ctx.get('botOfficialTools').authorize({ toolId: args.tool, mode: args.mode })
    const tools = ctx.get('botIndependentToolHost').forBot('b')
    const call = tool => tools.call('model_router_tool_run', { tool, task: 'Read offline fixture', mode: 'read-only' },
      { turnId: 'turn-official', callId: 'call-official', signal: new AbortController().signal })
    assert.deepEqual(await call('codex'), { cliModel: 'vendor-default' })
    await assert.rejects(call('claude-code'), { code: 'OFFICIAL_TOOL_NOT_GRANTED' })
    f.state.login = 'logged-out'
    view = await dispatch('binding.inspect', { botId: 'b', refreshOfficialTools: true })
    assert.equal(card(view).status, 'logged-out')
    assert.equal(view.record.status, 'available', 'a CLI logout must not disable the chat binding')
    assert.ok(view.record.grant.tools.includes('model/infer'))
    assert.ok(!view.record.grant.tools.includes('tool/model_router_tool_run'))
    await assert.rejects(dispatch('binding.save', { botId: 'b', expectedRevision: view.record.revision, settings: view.record.settings }), { code: 'BOT_SETTINGS_SCOPE_DENIED' })
    f.state.login = 'logged-in'
    view = await dispatch('binding.inspect', { botId: 'b', refreshOfficialTools: true })
    assert.ok(view.record.grant.tools.includes('tool/model_router_tool_run'))
    await dispatch('binding.save', { botId: 'b', expectedRevision: view.record.revision, settings: { ...view.record.settings, officialTools: [] } })
    assert.ok(!product.lifecycle.committedGrant('b').tools.includes('tool/model_router_tool_run'))
  }, { officialTools: f.service })
})

test('official CLI executes through real funded SQLite with a subscription chat binding and independent durable accounting', { timeout: 60000 }, async () => {
  const f = offline()
  await withProductIndependent(async ({ ctx, runtime, dispatch, bind, home, readRows }) => {
    await bind('b', 'beta', 'vendor/two')
    let view = await dispatch('binding.inspect', { botId: 'b', refreshOfficialTools: true })
    await dispatch('binding.save', { botId: 'b', expectedRevision: view.record.revision, settings: { ...view.record.settings,
      officialTools: [{ toolId: 'codex', cliModel: 'vendor-default', mode: 'read-only' }],
      funding: { mode: 'subscription', scopeId: view.record.settings.funding.scopeId, pricing: null, request: null,
        dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: { dailyCalls: 1, monthlyCalls: 1 } } } })
    // The production deferred store resolves to createFundedRouterState, not a bare store.
    const deferred = ctx.get('botOfficialTestState')
    assert.equal(typeof deferred.prepareExecutionFunding, 'function')
    installRouterStateStore(deferred)
    ctx.sandbox = { confine() { throw new Error('The offline adapter must never spawn a CLI') } }
    f.service.invoke = (args, execution) => executeBotOfficialTool(ctx, {}, args,
      { ...execution,
        runTask: request => runOfficialTask({ ...request, runtime: { readiness: async id => ({ id, ready: true, readyModes: ['read-only'] }),
          runTool: async request => { f.state.launches.push(request); return { status: 'succeeded', finalText: 'offline CLI proof',
            requestedModel: null, reportedModel: 'fixture-cli-model', billing: 'subscription', usage: { inputTokens: 2, outputTokens: 3 }, exitCode: 0 } } } }) })
    await runtime.move('b', 'independent')
    const result = await ctx.get('botIndependentToolHost').forBot('b').call('model_router_tool_run',
      { tool: 'codex', task: 'Read the offline workspace', cliModel: 'vendor-default', mode: 'read-only' },
      { turnId: 'turn-real-official', callId: 'call-real-official', signal: new AbortController().signal })
    assert.equal(result.status, 'succeeded', JSON.stringify(result))
    assert.equal(f.state.launches.length, 1)
    assert.equal(f.state.launches[0].modelId, null)
    assert.equal(readRows('router_model_calls').length, 0, 'no chat API invoice is invented')
    const run = readRows('router_runs').find(row => row.id === result.runId)
    assert.equal(run.fundingExecution.source, 'official-cli')
    assert.equal(run.fundingExecution.botId, 'b')
    assert.equal(run.fundingExecution.fundingScopeId, 'official-cli-codex')
    assert.equal(run.toolRun.cliModel, 'vendor-default')
    assert.equal(run.packages[0].requestedCliModel, null)
    assert.equal(deferred.fundingSubscriptionUsage({ botId: 'b' }).today.calls, 0, 'CLI subscription does not consume chat quota')
    const all = deferred.fundingSubscriptionUsage({})
    assert.ok(all.today.calls >= 1, 'the same durable store retains actual CLI subscription use')
    assert.equal(deferred.fundingTotals({ botId: 'b' }).unknownToday, 0)
  }, { officialTools: f.service, productModules: {
    startBotProduct: (ctx, options) => {
      ctx.provide('botOfficialTestState', options.deferredRouterState.state)
      return importStart(ctx, options)
    },
  } })
})

import { startBotProduct as importStart } from '../packages/orchestration/src/product-composition.mjs'
