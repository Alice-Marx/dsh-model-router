import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import { withRequestOutputDefault } from '../packages/orchestration/src/model-request-bounds.mjs'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

test('historical authentication failures cannot borrow a newly selected provider or key editor', async () => {
  const bundle = await build({ stdin: { contents: "export { failureProvider } from './modules/bot-runtime/vendor/ds-bot/src/client/turn-error.js'", resolveDir: process.cwd() },
    bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: () => ({}) })
  const { failureProvider } = module.exports
  assert.equal(failureProvider({ code: 'AUTH' }, undefined), undefined)
  assert.equal(failureProvider({ code: 'AUTH' }, { provider: 'failed-provider' }), 'failed-provider')
  assert.equal(failureProvider({ code: 'AUTH', provider: 'original-provider' }, { provider: 'other-provider' }), 'original-provider')
})

test('request defaults preserve explicit controls and unknown context without inventing capacity', () => {
  for (const maxTokens of [null, 0, 37, 4096]) {
    const config = { maxTokens }
    assert.equal(withRequestOutputDefault(config, { contextWindow: 4096 }), config)
  }
  const config = {}
  assert.equal(withRequestOutputDefault(config, {}), config)
  assert.equal(withRequestOutputDefault(config, { contextWindow: 4096, defaultMaxTokens: 64 }), config)
  assert.equal(withRequestOutputDefault(config, { contextWindow: 1048576 }).maxTokens, 8192)
  assert.equal(withRequestOutputDefault(config, { contextWindow: 4096, defaultMaxTokens: 4096 }).maxTokens, 1024)
})

class Adapter extends LlmAdapter {
  constructor(cap, calls) { super(); this.cap = cap; this.calls = calls }
  async listModels(provider) { return [{ provider, id: provider === 'alpha' ? 'one' : 'vendor/two', name: 'offline default regression' }] }
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 4096 }, ...(this.cap === undefined ? {} : { defaultMaxTokens: this.cap }) } }
  async *stream(options) {
    this.calls.push(options.maxTokens)
    yield { type: 'text-delta', index: 0, text: 'bounded reply' }
    yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
async function subscription(dispatch, botId) {
  const view = await dispatch('binding.inspect', { botId })
  await dispatch('binding.save', { botId, expectedRevision: view.record.revision, settings: { ...view.record.settings,
    funding: { ...view.record.settings.funding, mode: 'subscription', pricing: null, request: null,
      dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: { dailyCalls: 10, monthlyCalls: 100 } } } })
}

for (const botId of ['a', 'b']) test(`actual AgentLoop materializes a missing subscription default for ${botId === 'a' ? 'Main' : 'worker'} before the Session header`, async () => {
  let actual
  await withProductIndependent(async ({ ctx, bind, dispatch, readRows }) => {
    await bind(botId, 'alpha', 'one'); await subscription(dispatch, botId)
    const calls = []; ctx.replaceOfflineLlmAdapter(new Adapter(undefined, calls))
    const handle = await actual.context.agents.create({ sessionId: botId, agentOptions: { provider: 'alpha', model: 'one' },
      setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
    try {
      handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'offline chat acceptance' }], source: { kind: 'user' } }), 'next-turn', true)
      await handle.agent.whenIdle()
      assert.deepEqual(calls, [1024])
      assert.equal(handle.agent.session.requestHeader().config.maxTokens, 1024)
      assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant'))
      assert.equal(readRows('router_model_calls')[0].state, 'settled')
    } finally { await handle.dispose() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
})

for (const cap of [undefined, 4096]) test(`independent subscription prepares a bounded request with adapter default ${cap}`, async () => {
  await withProductIndependent(async ({ ctx, bind, dispatch, runtime, readRows }) => {
    await bind('a', 'alpha', 'one'); await subscription(dispatch, 'a')
    const calls = []; ctx.replaceOfflineLlmAdapter(new Adapter(cap, calls))
    await runtime.move('a', 'independent')
    assert.equal((await runtime.turn({ botId: 'a', input: 'offline bounded chat' })).answer, 'bounded reply')
    assert.deepEqual(calls, [1024]); assert.equal(readRows('router_model_calls')[0].state, 'settled')
  })
})

test('settings reject a default that consumes the context before committing a new revision', async () => {
  await withProductIndependent(async ({ ctx, bind, dispatch }) => {
    await bind('a', 'alpha', 'one')
    const before = await dispatch('binding.inspect', { botId: 'a' })
    ctx.replaceOfflineLlmAdapter(new Adapter(4096, []))
    await assert.rejects(dispatch('binding.save', { botId: 'a', expectedRevision: before.record.revision, settings: before.record.settings }),
      error => error.code === 'MODEL_DEFAULT_OUTPUT_INVALID' && /maxTokens/.test(error.message) && /4096/.test(error.message))
    assert.equal((await dispatch('binding.inspect', { botId: 'a' })).record.revision, before.record.revision)
  })
})
