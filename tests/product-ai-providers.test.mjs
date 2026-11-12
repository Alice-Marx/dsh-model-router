import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

test('plugin-owned connection serves actual integrated and independent Bots with real SQLite receipts', async () => {
  const sent = [], values = new Map()
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw || '{}'); sent.push({ url: request.url, key: request.headers.authorization, body })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'offline-chat', choices: [{ index: 0, delta: { role: 'assistant', content: 'PLUGIN-AI-BOT-OK' }, finish_reason: null }] })}\n\n`)
    response.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'offline-chat', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 18, completion_tokens: 5, total_tokens: 23 } })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let actual
  try {
    await withProductIndependent(async ({ ctx, product, bind, dispatch, runtime, readRows }) => {
      const readModel = ctx.get('botProductReadModel')
      await assert.rejects(readModel.dispatch({ action: 'aiProviders.list', payload: {} }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
      const saved = await dispatch('aiProviders.save', { expectedRevision: 0, preset: 'custom', name: '插件自己的 API', protocol: 'openai-completions',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, enabled: true, auth: 'key', apiKey: 'fixture-independent-api-key',
        models: [{ id: 'offline-chat', name: '独立模型', contextWindow: 4096, maxTokens: 64, reasoning: false }] })
      const view = await dispatch('binding.inspect', { botId: 'a' })
      assert.ok(view.record.catalog.models.some(model => model.provider === saved.route && model.source === 'plugin' && model.label.includes('插件自己的 API')))
      assert.doesNotMatch(JSON.stringify(await dispatch('aiProviders.list', {})), /fixture-independent-api-key|secretRef/)
      await bind('a', saved.route, 'offline-chat')
      const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: saved.route, model: 'offline-chat' },
        setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
      try {
        handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'Use the plugin connection.' }], source: { kind: 'user' } }), 'next-turn', true)
        await handle.agent.whenIdle()
        assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant' && message.content.some(block => block.text === 'PLUGIN-AI-BOT-OK')))
        assert.equal(handle.agent.session.requestHeader().config.maxTokens, 64)
      } finally { await handle.dispose() }
      await bind('b', saved.route, 'offline-chat'); await runtime.move('b', 'independent')
      assert.equal((await runtime.turn({ botId: 'b', input: 'Use the independent connection too.' })).answer, 'PLUGIN-AI-BOT-OK')
      assert.equal(readRows('router_model_calls').length, 2)
      assert.ok(readRows('router_model_calls').every(row => row.state === 'settled'))
      assert.equal(sent.length, 2)
      assert.ok(sent.every(request => request.key === 'Bearer fixture-independent-api-key' && (request.body.max_tokens ?? request.body.max_completion_tokens) === 64))
      assert.ok(product.lifecycle.committedBot('a').model.startsWith(saved.route + '/'))
      await assert.rejects(dispatch('aiProviders.remove', { id: saved.id, expectedRevision: saved.revision }), { code: 'AI_PROVIDER_IN_USE' })
    }, { beforeProduct: async ({ ctx }) => {
      ctx.provide('credentials', { async set(name, value) { values.set(name, value) }, async resolve(name) { return values.has(name) ? { value: values.get(name) } : undefined }, async describe(name) { return { configured: values.has(name) } }, async unset(name) { values.delete(name) } })
      actual = await attachActualAgentLoop(ctx); return () => actual.close()
    } })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('independent connection configuration does not wait for an unrelated hung Harness model directory', async () => {
  await withProductIndependent(async ({ ctx, dispatch }) => {
    const original = ctx.llm.listModels.bind(ctx.llm)
    ctx.llm.listModels = () => new Promise(() => {})
    try {
      const saved = await Promise.race([dispatch('aiProviders.save', { expectedRevision: 0, preset: 'custom', name: '独立目录', protocol: 'openai-completions',
        baseUrl: 'http://127.0.0.1:9999/v1', enabled: true, auth: 'none', models: [{ id: 'offline', name: '独立', contextWindow: 4096, maxTokens: 64, reasoning: false }] }),
        new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('configuration blocked by Host catalog')), 1000); timer.unref() })])
      const view = await dispatch('binding.inspect', { botId: 'a' })
      assert.ok(view.record.catalog.models.some(model => model.provider === saved.route))
    } finally { ctx.llm.listModels = original }
  })
})
