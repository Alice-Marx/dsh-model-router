import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'

class ReasoningAdapter extends LlmAdapter {
  constructor(calls, efforts = ['quick', 'deep'], defaultEffort = 'quick') { super(); this.calls = calls; this.efforts = efforts; this.defaultEffort = defaultEffort }
  async listModels(provider) { return [{ provider, id: provider === 'alpha' ? 'one' : 'vendor/two', name: 'Offline reasoning fixture' }] }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, context: { contextWindow: 4096 }, defaultMaxTokens: 64,
      reasoning: { efforts: this.efforts.map(id => ({ id, name: id })), defaultEffort: this.defaultEffort } }
  }
  async *stream(options) {
    this.calls.push({ provider: options.provider, model: options.model, effort: options.reasoningEffort })
    yield { type: 'text-delta', index: 0, text: 'reasoning answer' }
    yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

test('independent chat uses the committed Bot thinking level and observes a later owner change', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    const calls = []
    ctx.replaceOfflineLlmAdapter(new ReasoningAdapter(calls))
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    await product.rt.updateBot('a', { effort: 'deep' })
    assert.equal(product.lifecycle.committedBot('a').effort, 'deep')
    assert.equal(calls.length, 0, 'saving a thinking level must not start a model turn')
    await runtime.turn({ botId: 'a', input: 'use the saved deep level' })
    assert.equal(calls[0].effort, 'deep')
    await product.rt.updateBot('a', { effort: 'quick' })
    await runtime.turn({ botId: 'a', input: 'use the newly saved quick level' })
    assert.equal(calls[1].effort, 'quick')
    assert.equal(readRows('router_model_calls').length, 2)
    assert.equal(readRows('router_runs').length, 2)
  })
})

test('clearing the Bot level returns independent chat to the adapter default', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind }) => {
    const calls = []
    ctx.replaceOfflineLlmAdapter(new ReasoningAdapter(calls))
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    await product.rt.updateBot('a', { effort: 'deep' })
    await runtime.turn({ botId: 'a', input: 'first saved level' })
    await product.rt.updateBot('a', { effort: null })
    assert.equal(product.lifecycle.committedBot('a').effort, undefined)
    await runtime.turn({ botId: 'a', input: 'back to provider default' })
    assert.deepEqual(calls.map(call => call.effort), ['deep', 'quick'])
  })
})

test('a caller cannot override the committed Bot thinking level', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    const calls = []
    ctx.replaceOfflineLlmAdapter(new ReasoningAdapter(calls))
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    await product.rt.updateBot('a', { effort: 'deep' })
    await assert.rejects(ctx.get('botIndependentExecution').complete({
      botId: 'a', provider: 'alpha', model: 'one', reasoningEffort: 'quick',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'override saved level' }] }],
    }), { code: 'BOT_MODEL_EFFORT_MISMATCH' })
    assert.equal(calls.length, 0)
    assert.equal(readRows('router_model_calls').length, 0)
    assert.equal(readRows('router_runs').length, 0)
  })
})

test('a caller cannot introduce an explicit level when the owner saved the provider default', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    const calls = []
    ctx.replaceOfflineLlmAdapter(new ReasoningAdapter(calls))
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    await assert.rejects(ctx.get('botIndependentExecution').complete({
      botId: 'a', provider: 'alpha', model: 'one', reasoningEffort: 'deep',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'unsaved explicit level' }] }],
    }), { code: 'BOT_MODEL_EFFORT_MISMATCH' })
    assert.equal(calls.length, 0)
    assert.equal(readRows('router_model_calls').length, 0)
  })
})

test('a saved level no longer supported by a replaced adapter refuses before dispatch or money', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    const calls = []
    ctx.replaceOfflineLlmAdapter(new ReasoningAdapter(calls))
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    await product.rt.updateBot('a', { effort: 'deep' })
    ctx.replaceOfflineLlmAdapter(new ReasoningAdapter(calls, ['quick']))
    await assert.rejects(runtime.turn({ botId: 'a', input: 'the saved level must not silently disappear' }), { code: 'UNSUPPORTED_REASONING_EFFORT' })
    assert.equal(calls.length, 0)
    assert.equal(readRows('router_model_calls').length, 0)
    assert.equal(readRows('router_runs').length, 0)
  })
})

test('the actual prepared generation keeps its thinking capability after adapter replacement', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    const captured = [], replacement = []
    ctx.replaceOfflineLlmAdapter(new ReasoningAdapter(captured))
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    await product.rt.updateBot('a', { effort: 'deep' })
    const prepare = ctx.llm.prepareCall.bind(ctx.llm)
    let swapped = false
    ctx.llm.prepareCall = async (...args) => {
      const call = await prepare(...args)
      if (!swapped) { swapped = true; ctx.replaceOfflineLlmAdapter(new ReasoningAdapter(replacement, ['quick'])) }
      return call
    }
    assert.equal((await runtime.turn({ botId: 'a', input: 'keep the captured thinking capability' })).answer, 'reasoning answer')
    assert.equal(swapped, true)
    assert.deepEqual(captured.map(call => call.effort), ['deep'])
    assert.deepEqual(replacement, [])
    assert.equal(readRows('router_model_calls').length, 1)
  })
})

