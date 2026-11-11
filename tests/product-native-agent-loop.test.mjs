import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

const script = fileURLToPath(new URL('./fixtures/bot-engine-claude-fixture.mjs', import.meta.url))
const profileOf = async () => ({ id: 'actual-loop-claude', driver: 'claude', provider: 'native-loop', model: 'fixture-model-a',
  entry: { executable: process.execPath, sha256: createHash('sha256').update(await readFile(process.execPath)).digest('hex'),
    version: process.versions.node, script, scriptSha256: createHash('sha256').update(await readFile(script)).digest('hex') },
  credentialRef: 'ds-secret/ACTUAL_LOOP_AUTH', deadlineMs: 120000 })

test('actual AgentLoop retains the native process then explicitly switches Main to another tool-capable route', async () => {
  let actual
  await withProductIndependent(async ({ ctx, product, bind, readRows, home }) => {
    await product.rt.secretEndpoint('secret-set', { name: 'ACTUAL_LOOP_AUTH', value: '{"offlineFixture":true}', scope: [] })
    await bind('a', 'native-loop', 'fixture-model-a')
    const requests = []
    const errors = []
    ctx.on('agent/error', event => { errors.push(event.error?.stack ?? event.error?.message) })
    ctx.on('llm/stream', (request, next) => { requests.push(request); return next() })
    const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'native-loop', model: 'fixture-model-a' } })
    try {
      const send = async text => {
        handle.agent.send(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), 'next-turn', true)
        await handle.agent.whenIdle()
      }
      await send('first actual native loop turn')
      assert.equal(readRows('router_model_calls').length, 1, JSON.stringify({ errors,
        tools: handle.agent.ctx.tools.wireSchemas(scopeOf(handle.agent.ctx)).schemas.map(tool => tool.name),
        hasScope: Boolean(scopeOf(handle.agent.ctx)), sameTools: handle.agent.ctx.get('tools') === handle.agent.ctx.tools,
        lifecycle: product.lifecycle.status(), model: product.lifecycle.committedBot('a')?.model }))
      assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('echo: first actual native loop turn')),
        JSON.stringify({ errors, inputs: requests[0]?.messages.map(message => ({ role: message.role, source: message.source?.kind })),
          ends: handle.agent.session.log.filter(event => event.type === 'turn/end').map(event => event.data.reason) }))
      const path = join(home, 'model-router/conversation-engines/actual-loop-claude/workspace/fixture-evidence.json')
      const first = JSON.parse(await readFile(path, 'utf8'))
      await send('second actual native loop turn')
      const second = JSON.parse(await readFile(path, 'utf8'))
      assert.equal(first.pid, second.pid)
      assert.equal(second.turns.length, 2)
      assert.match(second.turns[0].text, /^first actual native loop turn/)
      assert.match(second.turns[0].text, /\[Host runtime context\]/)
      assert.match(second.turns[1].text, /^second actual native loop turn/)
      assert.equal(second.turns[1].text.includes('first actual native loop turn'), false)
      assert.equal(requests.length, 2)
      assert.ok(requests.every(request => isAgentLoopRequest(request) && Object.isFrozen(request) && request.toolHistory))
      assert.ok(requests.every(request => request.maxTokens === undefined))
      assert.equal(readRows('router_model_calls').length, 2)
      assert.ok(readRows('router_model_calls').every(row => row.provider === 'native-loop' && row.model === 'fixture-model-a' && row.funding === 'subscription' && row.state === 'settled'))
      assert.equal(ctx.upstream.length, 0)
      assert.equal(handle.agent.session.requestContext().contextWindow, undefined, 'no capacity is invented for a subscription CLI')
      await bind('a', 'alpha', 'one')
      await ctx.sessionController.selectModel({ sessionId: 'a', provider: 'alpha', model: 'one' })
      await send('Main explicitly switches to the configured API route')
      assert.equal(ctx.upstream.length, 1, 'only the explicit route switch dispatches the API transport')
      assert.ok(requests[2].tools.some(tool => tool.name === 'bot_task_start'), 'Main tool declarations return on a tool-capable route')
      assert.equal(readRows('router_model_calls').length, 3)
      assert.equal(readRows('router_model_calls')[2].provider, 'alpha')
      assert.equal(JSON.parse(await readFile(path, 'utf8')).turns.length, 2, 'the route switch never sends another turn to the native CLI')
    } finally { await handle.dispose() }
  }, { conversationEngines: [await profileOf()], runtimeConfig: { memoryReview: false }, beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
}, { timeout: 120000 })

test('Main returns between configured API and native routes with private reference history and no replay', async () => {
  let actual
  await withProductIndependent(async ({ ctx, product, bind, dispatch, readRows, home }) => {
    await product.rt.secretEndpoint('secret-set', { name: 'ACTUAL_LOOP_AUTH', value: '{"offlineFixture":true}', scope: [] })
    await bind('a', 'alpha', 'one')
    const view = await dispatch('binding.inspect', { botId: 'a' })
    const native = view.accounts.items.find(account => account.provider === 'native-loop')
    await dispatch('funding.account.save', { scopeId: native.id, expectedRevision: native.revision, enabled: true, dailyLimitUsd: 0, monthlyLimitUsd: 0 })
    const base = view.record.settings
    await dispatch('binding.save', { botId: 'a', expectedRevision: view.record.revision, settings: {
      ...base, mainRoutes: { schemaVersion: 1, limits: { api: { dailyBudgetUsd: 1, monthlyBudgetUsd: 10 }, subscription: { dailyCalls: 3, monthlyCalls: 10 } },
        routes: [
          { ...base.model, enabled: true, funding: { mode: 'api', scopeId: base.funding.scopeId, pricing: base.funding.pricing, request: base.funding.request } },
          { provider: 'native-loop', model: 'fixture-model-a', enabled: true, funding: { mode: 'subscription', scopeId: native.id, pricing: null, request: null } },
        ] },
    } })
    const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'alpha', model: 'one' } })
    const errors = []
    ctx.on('agent/error', event => { errors.push(event.error?.stack ?? event.error?.message) })
    const fields = []
    ctx.on('llm/stream', (request, next) => {
      fields.push({ route: request.provider, controls: Object.keys(request).filter(key => !['messages', 'toolHistory', 'tools', 'signal'].includes(key) && request[key] !== undefined), toolCount: request.tools?.length })
      return next()
    })
    const send = async (text, provider, model) => {
      if (provider) await ctx.sessionController.selectModel({ sessionId: 'a', provider, model })
      handle.agent.send(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), 'next-turn', true)
      await handle.agent.whenIdle()
    }
    const evidence = async () => {
      const session = handle.agent.session
      const path = join(home, 'model-router/conversation-engines/actual-loop-claude/workspace/fixture-evidence.json')
      try { return JSON.parse(await readFile(path, 'utf8')) }
      catch (error) {
        assert.fail(JSON.stringify({ error: error.code, errors, fields, messages: session.deriveMessages().map(message => [message.id, message.role, message.source]),
          history: session.toolHistory().updates.map(update => [update.messageId, update.type]),
          ends: session.log.filter(event => event.type === 'turn/end').map(event => event.data) }))
      }
    }
    try {
      await send('first API reference')
      await send('first native input', 'native-loop', 'fixture-model-a')
      const first = await evidence()
      assert.match(first.argv.systemPrompt, /<host_conversation_history>/)
      assert.match(first.argv.systemPrompt, /first API reference/)
      assert.equal(first.turns.length, 1)
      assert.match(first.turns[0].text, /^first native input/)
      assert.doesNotMatch(first.turns[0].text, /first API reference/)

      await send('second API reference', 'alpha', 'one')
      await send('native input after returning', 'native-loop', 'fixture-model-a')
      const returned = await evidence()
      assert.notEqual(returned.pid, first.pid, JSON.stringify(errors))
      assert.throws(() => process.kill(first.pid, 0), { code: 'ESRCH' })
      assert.match(returned.argv.systemPrompt, /first API reference/)
      assert.match(returned.argv.systemPrompt, /second API reference/)
      assert.match(returned.argv.systemPrompt, /echo: first native input/)
      assert.equal(returned.turns.length, 1)
      assert.match(returned.turns[0].text, /^native input after returning/)
      assert.doesNotMatch(returned.turns[0].text, /second API reference/)
      await send('continue the returned native session')
      const continued = await evidence()
      assert.equal(continued.pid, returned.pid)
      assert.equal(continued.turns.length, 2)
      assert.match(continued.turns[1].text, /^continue the returned native session/)
      await send('above the configured subscription quota')
      assert.equal((await evidence()).turns.length, 2)
      assert.deepEqual(readRows('router_model_calls').map(row => [row.provider, row.funding, row.state]), [
        ['alpha', 'api', 'settled'], ['native-loop', 'subscription', 'settled'], ['alpha', 'api', 'settled'],
        ['native-loop', 'subscription', 'settled'], ['native-loop', 'subscription', 'settled'],
      ])
      assert.equal(ctx.upstream.length, 2)
      assert.equal(product.lifecycle.committedBot('a').model, 'alpha/one')
    } finally { await handle.dispose() }
  }, { conversationEngines: [await profileOf()], runtimeConfig: { memoryReview: false }, beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
}, { timeout: 120000 })
