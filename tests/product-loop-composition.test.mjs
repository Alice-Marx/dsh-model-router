import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmAdapter, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, canonicalHeader } from '@deepseek-ai/dsh-session'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'

for (const allowanceCovers of [false, true, 'unsupported']) test('whole integrated composition reads the prepared Session capacity after a registration swap: ' + (allowanceCovers === true ? 'admit A' : allowanceCovers === false ? 'refuse A' : 'refuse unsupported Host'), async () => {
  await withProductIndependent(async ({ ctx, product, bind, readRows }) => {
    const calls = []
    class Adapter extends LlmAdapter {
      constructor(tag, window) { super(); this.tag = tag; this.window = window }
      async listModels(provider) { return [{ provider, id: provider === 'alpha' ? 'one' : 'vendor/two', name: 'Offline frame fixture' }] }
      async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: this.window }, defaultMaxTokens: 64 } }
      async *stream() {
        calls.push(this.tag)
        yield { type: 'text-delta', index: 0, text: this.tag }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.replaceOfflineLlmAdapter(new Adapter('A', allowanceCovers ? 4096 : 6144))
    await bind('a', 'alpha', 'one')
    const session = Session.create(SessionId('a'))
    let reads = 0
    ctx.sessions.get = id => { reads++; if (allowanceCovers === 'unsupported') throw new Error('offline session lookup failure'); return id === session.id ? session : undefined }
    ctx.provide('sessions', ctx.sessions)
    product.lifecycle.observeAgent({ session, ctx: { get: name => name === 'tools' ? ctx.tools : undefined } })
    const prepared = await ctx.llm.prepareCall({ provider: 'alpha', model: 'one' })
    const header = canonicalHeader({ config: prepared.config, adapterDefaults: prepared.adapterDefaults })
    session.append('request/header', { header, reason: 'initial' })
    session.append('request/context', { provider: 'alpha', model: 'one', contextWindow: prepared.context.contextWindow })
    const request = markAgentLoopRequest(Object.freeze({ ...prepared.config, sessionId: session.id, signal: new AbortController().signal,
      messages: Object.freeze([Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: 'actual product loop seam' }]) })]),
      toolHistory: session.toolHistory() }))
    ctx.replaceOfflineLlmAdapter(new Adapter('B', 1024))
    reads = 0
    const drain = async () => { const chunks = []; for await (const chunk of prepared.stream(request)) chunks.push(chunk); return chunks }
    if (allowanceCovers === true) {
      const chunks = await drain()
      assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'A'))
      assert.deepEqual(calls, ['A'])
      assert.equal(readRows('router_model_calls').length, 1)
    } else {
      await assert.rejects(drain(), { code: allowanceCovers === false ? 'MODEL_INPUT_BOUNDARY_REQUIRED' : 'MODEL_LOOP_FRAME_UNSUPPORTED' })
      assert.deepEqual(calls, [])
      assert.equal(readRows('router_model_calls').length, 0)
      assert.equal(readRows('router_runs').length, 0)
    }
    assert.ok(reads > 0, 'the actual composition must read the logged frame; standalone resolver tests cannot prove this glue')
  })
})

