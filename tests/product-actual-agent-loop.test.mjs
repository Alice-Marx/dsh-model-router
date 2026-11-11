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
