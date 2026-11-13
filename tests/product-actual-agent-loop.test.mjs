import test from 'node:test'
import assert from 'node:assert/strict'
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

test('actual public AgentLoop constructs the marked frozen request and settles through production accounting', async () => {
  let actual
  await withProductIndependent(async ({ ctx, product, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    const requests = []
    const errors = []
    ctx.on('agent/error', event => { errors.push(event.error?.stack ?? event.error?.message) })
    ctx.on('llm/stream', (request, next) => { requests.push(request); return next() })
    const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'alpha', model: 'one' },
      setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
    try {
      handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'run the actual installed public loop' }], source: { kind: 'user' } }), 'next-turn', true)
      await handle.agent.whenIdle()
      assert.equal(requests.length, 1, JSON.stringify(errors))
      assert.equal(isAgentLoopRequest(requests[0]), true)
      assert.equal(Object.isFrozen(requests[0]), true)
      assert.equal(ctx.upstream.length, 1)
      assert.equal(readRows('router_model_calls').length, 1)
      assert.equal(readRows('router_model_calls')[0].state, 'settled')
      assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant'))
      assert.ok(product.lifecycle.committedBot('a'))
    } finally { await handle.dispose() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
}, { timeout: 30000 })

test('actual public AgentLoop executes a product tool through the selected native executor', async () => {
  let actual
  await withProductIndependent(async ({ ctx, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    const errors = []
    ctx.on('agent/error', event => { errors.push(event.error?.stack ?? event.error?.message) })
    ctx.state.beforeRequest = () => {
      ctx.state.chunks = ctx.upstream.length === 0 ? [
        { type: 'tool-call-delta', index: 0, id: 'sdk-native-executor-probe', name: 'list_bots', argumentsDelta: '{}' },
        { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ] : [
        { type: 'text-delta', index: 0, text: 'SDK native tool returned' },
        { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]
    }
    const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'alpha', model: 'one' } })
    try {
      handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'List the configured Bots, then confirm.' }], source: { kind: 'user' } }), 'next-turn', true)
      await handle.agent.whenIdle()
      assert.deepEqual(errors, [])
      assert.equal(ctx.upstream.length, 2)
      const result = ctx.upstream[1].messages.find(message => message.role === 'tool' && message.toolCallId === 'sdk-native-executor-probe')
      assert.ok(result, 'the actual executor must return the product tool result to the next model step')
      assert.equal(result.isError ?? false, false, JSON.stringify(result))
      assert.match(JSON.stringify(result.content), /Chief/)
      assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant' && message.content.some(block => block.text === 'SDK native tool returned')))
      assert.equal(readRows('router_model_calls').length, 2)
      assert.ok(readRows('router_model_calls').every(row => row.state === 'settled' && row.outcome === 'succeeded'))
    } finally { await handle.dispose() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
}, { timeout: 30000 })
