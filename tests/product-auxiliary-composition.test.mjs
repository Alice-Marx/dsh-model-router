import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

for (const admit of [false, true]) test(`production auxiliary captures A capacity and dispatch when the exact route changes to B: ${admit ? 'admit A' : 'refuse A'}`, async () => {
  let actual
  await withProductIndependent(async ({ ctx, product, bind, readRows }) => {
    const calls = []
    let swapped = false
    class Adapter extends LlmAdapter {
      constructor(tag, window) { super(); this.tag = tag; this.window = window }
      async listModels(provider) { return [{ provider, id: provider === 'alpha' ? 'one' : 'vendor/two', name: 'Auxiliary causal fixture' }] }
      async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: this.window }, defaultMaxTokens: 64 } }
      async prepareCall(provider, model) {
        const resolved = await this.resolveModel(provider, model)
        if (this.tag === 'A') { swapped = true; ctx.replaceOfflineLlmAdapter(new Adapter('B', admit ? 6144 : 2048)) }
        return { model: resolved, stream: options => this.stream(options) }
      }
      async *stream(options) {
        calls.push({ tag: this.tag, output: options.maxTokens, messages: options.messages })
        yield { type: 'text-delta', index: 0, text: 'prepared auxiliary A' }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    await bind('a', 'alpha', 'one')
    const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'alpha', model: 'one' } })
    try {
      const value = 'offline-auxiliary-secret-value'
      await product.rt.secretEndpoint('secret-set', { name: 'AUX_COMPOSITION', value, scope: [] })
      ctx.replaceOfflineLlmAdapter(new Adapter('A', admit ? 4096 : 6144))
      const stream = ctx.get('botAuxiliaryModelStream')
      assert.equal(typeof stream, 'function')
      const request = { provider: 'alpha', model: 'one', sessionId: 'a', purpose: 'compaction', maxTokens: 500,
        messages: [{ role: 'user', content: [{ type: 'text', text: `Summarize without exposing ${value}` }] }] }
      const collect = async () => { const chunks = []; for await (const chunk of stream(request)) chunks.push(chunk); return chunks }
      if (admit) {
        assert.equal((await collect()).at(-1).reason.kind, 'stop')
        assert.equal(calls.length, 1)
        assert.equal(calls[0].tag, 'A')
        assert.equal(calls[0].output, 100)
        assert.equal(JSON.stringify(calls[0].messages).includes(value), false)
        const rows = readRows('router_model_calls')
        assert.equal(rows.length, 1)
        assert.equal(rows[0].state, 'settled')
        assert.equal(rows[0].source, 'aux')
      } else {
        await assert.rejects(collect(), { code: 'MODEL_INPUT_BOUNDARY_REQUIRED' })
        assert.equal(calls.length, 0)
        assert.equal(readRows('router_model_calls').length, 0)
        assert.equal(readRows('router_runs').length, 0)
      }
      assert.equal(swapped, true, 'the causal preparation path was actually entered')
      assert.equal((await ctx.llm.resolveModelInfo('alpha', 'one')).context.contextWindow, admit ? 6144 : 2048)
    } finally { await handle.dispose() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
})
