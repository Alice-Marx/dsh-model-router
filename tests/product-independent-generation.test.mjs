import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'

for (const facade of [false, true]) for (const redact of [false, true]) test(`whole product keeps prepared adapter A after replacement by wider B${redact ? ', including the real secrets rewrite' : ''}${facade ? ', with no caller signal' : ''}`, async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const replacementCalls = []
    class WiderAdapter extends LlmAdapter {
      async listModels(provider) { return [{ provider, id: provider === 'alpha' ? 'one' : 'vendor/two', name: 'replacement' }] }
      async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 200000 }, defaultMaxTokens: 512 } }
      async *stream(options) {
        replacementCalls.push({ model: options.model, maxTokens: options.maxTokens })
        yield { type: 'text-delta', index: 0, text: 'replacement answer' }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const prepare = ctx.llm.prepareCall.bind(ctx.llm)
    let swapped = false
    ctx.llm.prepareCall = async (...args) => {
      const captured = await prepare(...args)
      if (!swapped) { swapped = true; ctx.replaceOfflineLlmAdapter(new WiderAdapter()) }
      return captured
    }
    const secret = 'offline-generation-secret-never-a-real-credential'
    if (redact) await product.rt.secretEndpoint('secret-set', { name: 'GENERATION_FIXTURE', value: secret, scope: ['a'] })
    const input = redact ? `Redact ${secret}.` : 'Keep the prepared model generation.'
    const result = facade
      ? await ctx.get('botIndependentExecution').complete({ botId: 'a', provider: 'alpha', model: 'one', messages: [{ role: 'user', content: [{ type: 'text', text: input }] }] })
      : await runtime.turn({ botId: 'a', input })
    assert.equal(swapped, true, 'the production path must actually prepare before the replacement gate can prove generation binding')
    assert.equal(facade ? result.text : result.answer, 'model answer')
    assert.equal(ctx.upstream.length, 1)
    assert.deepEqual(replacementCalls, [])
    assert.equal(readRows('router_model_calls').length, 1)
    assert.equal(readRows('router_model_calls')[0].state, 'settled')
    if (redact) assert.equal(JSON.stringify(ctx.upstream[0].messages).includes(secret), false)
  })
})

test('a new secret committed after preparation refuses the rewritten request before provider or money, then a fresh intent works', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const value = 'late-offline-secret-never-a-real-credential'
    const prepare = ctx.llm.prepareCall.bind(ctx.llm)
    let changed = false
    ctx.llm.prepareCall = async (...args) => {
      const captured = await prepare(...args)
      if (!changed) {
        changed = true
        await product.rt.secretEndpoint('secret-set', { name: 'LATE_GENERATION_FIXTURE', value, scope: ['a'] })
      }
      return captured
    }
    await assert.rejects(runtime.turn({ botId: 'a', input: `Please protect ${value}.` }), { code: 'MODEL_PREPARED_REQUEST_REWRITTEN' })
    assert.equal(changed, true)
    assert.equal(ctx.upstream.length, 0)
    assert.equal(readRows('router_model_calls').length, 0)
    assert.equal(readRows('router_runs').length, 0)
    const result = await runtime.turn({ botId: 'a', input: 'This is a fresh explicit intent.' })
    assert.equal(result.answer, 'model answer')
    assert.equal(ctx.upstream.length, 1)
    assert.equal(readRows('router_model_calls').length, 1)
    assert.equal(JSON.stringify(ctx.upstream[0].messages).includes(value), false)
  })
})

test('the real independent facade refuses an explicit null output before preparing a model', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const prepare = ctx.llm.prepareCall.bind(ctx.llm)
    let prepared = 0
    ctx.llm.prepareCall = (...args) => { prepared++; return prepare(...args) }
    await assert.rejects(ctx.get('botIndependentExecution').complete({ botId: 'a', provider: 'alpha', model: 'one', maxTokens: null,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'invalid bound' }] }] }), { code: 'MODEL_OUTPUT_BOUNDARY_REQUIRED' })
    assert.equal(prepared, 0)
    assert.equal(ctx.upstream.length, 0)
    assert.equal(readRows('router_model_calls').length, 0)
    assert.equal(readRows('router_runs').length, 0)
  })
})

test('a funded independent Host without prepared-call support refuses instead of silently dispatching an unfenced call', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    ctx.llm.prepareCall = undefined
    await assert.rejects(runtime.turn({ botId: 'a', input: 'Requires the Host preparation API.' }), { code: 'MODEL_PREPARED_UNAVAILABLE' })
    assert.equal(ctx.upstream.length, 0)
    assert.equal(readRows('router_model_calls').length, 0)
    assert.equal(readRows('router_runs').length, 0)
  })
})

test('a Host middleware that replaces the prepared signal cannot silently re-enter an unprepared independent dispatch', async () => {
  let rewritten = false
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    await assert.rejects(runtime.turn({ botId: 'a', input: 'Keep the Host preparation record.' }), { code: 'MODEL_PREPARED_CONTEXT_REQUIRED' })
    assert.equal(rewritten, true)
    assert.equal(ctx.upstream.length, 0)
    assert.equal(readRows('router_model_calls').length, 0)
    assert.equal(readRows('router_runs').length, 0)
  }, { beforeBoot: async ({ ctx }) => {
    ctx.on('llm/stream', (options, next) => {
      if (rewritten) return next()
      rewritten = true
      return ctx.llm.stream({ ...options, signal: new AbortController().signal })
    })
  } })
})
