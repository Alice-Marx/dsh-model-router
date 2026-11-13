import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

test('plugin CLI connection serves actual Main and independent Bot through the public SDK with durable SQLite receipts', async () => {
  const values = new Map(); let actual
  await withProductIndependent(async ({ ctx, product, bind, dispatch, runtime, readRows }) => {
    const errors = []; ctx.on('agent/error', event => errors.push(event.error?.stack ?? event.error?.message))
    await assert.rejects(ctx.get('botProductReadModel').dispatch({ action: 'cliProviders.list', payload: {} }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
    const saved = await dispatch('cliProviders.save', { expectedRevision: 0, driver: 'codex', name: 'Codex offline account', model: 'gpt-fixture', enabled: true,
      entry: { executable: process.execPath, version: '1.0.0', script: resolve('tests/fixtures/native-chat-protocol-fixture.mjs') },
      credentialJson: JSON.stringify({ schemaVersion: 1, billing: 'subscription', files: { 'auth.json': { tokens: { access_token: 'fixture-only-account', refresh_token: 'fixture-only-refresh' } } }, env: {} }) })
    const view = await dispatch('binding.inspect', { botId: 'a' })
    assert.ok(view.record.catalog.models.some(model => model.provider === saved.provider && model.label.includes('Codex offline account') && model.fundingModes.includes('subscription')))
    assert.doesNotMatch(JSON.stringify(await dispatch('cliProviders.list', {})), /fixture-only-account|credentialRef/)
    await bind('a', saved.provider, 'gpt-fixture')
    const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: saved.provider, model: 'gpt-fixture' }, setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
    try {
      handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'main first' }], source: { kind: 'user' } }), 'next-turn', true)
      await handle.agent.whenIdle()
      assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant' && message.content.some(block => block.text?.includes('main first'))), JSON.stringify(errors))
    } finally { await handle.dispose() }
    await bind('b', saved.provider, 'gpt-fixture'); await runtime.move('b', 'independent')
    assert.match((await runtime.turn({ botId: 'b', input: 'worker first' })).answer, /worker first/)
    assert.equal(readRows('router_model_calls').length, 2); assert.ok(readRows('router_model_calls').every(row => row.state === 'settled'))
    assert.equal((await dispatch('cliProviders.list', {})).profiles[0].state, 'ready')
    await assert.rejects(dispatch('cliProviders.remove', { id: saved.id, expectedRevision: saved.revision }), { code: 'CLI_CHAT_IN_USE' })
    assert.ok(product.lifecycle.committedBot('a').model.startsWith(saved.provider + '/'))
  }, { beforeProduct: async ({ ctx }) => {
    ctx.provide('credentials', { async set(name, value) { values.set(name, value) }, async resolve(name) { return values.has(name) ? { value: values.get(name) } : undefined }, async describe(name) { return { configured: values.has(name) } }, async unset(name) { values.delete(name) } })
    actual = await attachActualAgentLoop(ctx); return () => actual.close()
  } })
})
