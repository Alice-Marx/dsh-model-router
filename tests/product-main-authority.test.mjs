import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { compileDsOwnership } from '../packages/orchestration/src/ds-lifecycle.mjs'

test('already-live private and group member sessions can use their committed grants on the first turn', async () => {
  let actual, home
  const handles = []
  await withProductIndependent(async ({ ctx, product, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await bind('b', 'beta', 'vendor/two')
    // The native controller can return a cached Agent without replaying the creation
    // event. Do not let a background roster lookup warm it before the test turn.
    product.rt.resolveAgent = async sessionId => {
      const { agent, error } = await ctx.sessionController.resolveAgent(sessionId)
      if (error) throw new Error(error.message)
      return agent
    }
    for (const [index, route] of [['alpha', 'one'], ['beta', 'vendor/two']].entries()) {
      const { agent } = handles[index]
      const [provider, model] = route
      assert.throws(() => ctx.get('botIntegrationPolicy').modelIdentity({ sessionId: agent.session.id, provider, model }), { code: 'UNKNOWN_SUBJECT' }, 'the Agent was already live when the product attached')
      agent.send(createUserMessage({ content: [{ type: 'text', text: 'Reply once to this restored session' }], source: { kind: 'user' } }), 'next-turn', true)
      await agent.whenIdle()
      const end = agent.session.log.findLast(event => event.type === 'turn/end')
      assert.equal(end?.data.reason.kind, 'completed', JSON.stringify(end?.data.reason))
    }
    assert.deepEqual(readRows('router_model_calls').map(row => [row.botId, row.provider, row.model, row.state]), [
      ['a', 'alpha', 'one', 'settled'], ['b', 'beta', 'vendor/two', 'settled'],
    ])
  }, { runtimeConfig: { memoryReview: false }, beforeProduct: async ({ ctx, home: isolatedHome }) => {
    home = isolatedHome
    ctx.on = (...args) => ctx.nativeLlmContext.on(...args)
    actual = await attachActualAgentLoop(ctx)
    for (const [sessionId, provider, model] of [['a', 'alpha', 'one'], ['old-group-member', 'beta', 'vendor/two']]) {
      handles.push(await actual.context.agents.create({ sessionId, agentOptions: { provider, model } }))
    }
    return () => actual.close()
  }, beforeBoot: async () => {
    const path = join(home, 'bot', 'state.json')
    const state = JSON.parse(await readFile(path, 'utf8'))
    state.rooms['old-room'] = { id: 'old-room', name: 'Existing group', named: true, mode: 'admin', admin: 'b', members: ['a', 'b'],
      sessions: { b: 'old-group-member' }, createdAt: 1, seen: {}, seq: 0, log: [] }
    await writeFile(path, JSON.stringify(state))
  } })
})

test('an executor already registered in the Agent scope does not prevent Bot binding or activity reads', async () => {
  let actual
  await withProductIndependent(async ({ ctx, bind, dispatch }) => {
    await bind('a', 'alpha', 'one')
    const executor = { describe: () => ({ schemas: [] }), execute: async () => { throw new Error('unexpected tool execution') } }
    const handle = await actual.context.agents.create({
      sessionId: 'a', agentOptions: { provider: 'alpha', model: 'one' },
      setup: scope => { scope.tools.setExecutor(executor) },
    })
    try {
      assert.equal(handle.agent.ctx.tools.selectExecutor(handle.agent), executor)
      assert.equal(ctx.get('botIntegrationPolicy').modelIdentity({ sessionId: 'a', provider: 'alpha', model: 'one' }).botId, 'a')
      const page = await dispatch('nativeActivity.list', { botId: 'a', mode: 'integration', sessionId: 'a' })
      assert.deepEqual(page.items, [])
      assert.equal(page.recording.status, 'ready')
    } finally { await handle.dispose() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
})

test('committed Main gets all Host routes and tools while a worker retains its explicit scope', async () => {
  let actual
  await withProductIndependent(async ({ ctx, product, bind, dispatch }) => {
    await bind('a', 'alpha', 'one')
    await bind('b', 'beta', 'vendor/two')
    const main = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'alpha', model: 'one' } })
    const worker = await actual.context.agents.create({ sessionId: 'b', agentOptions: { provider: 'beta', model: 'vendor/two' } })
    try {
      const policy = ctx.get('botIntegrationPolicy')
      assert.equal(policy.modelIdentity({ sessionId: 'a', provider: 'beta', model: 'vendor/two' }).botId, 'a')
      assert.throws(() => policy.modelIdentity({ sessionId: 'b', provider: 'alpha', model: 'one' }))
      for (const [kind, name] of [['task', 'execute'], ['task', 'submit'], ['tool', 'data'], ['tool', 'bot_dispatch']]) {
        assert.equal(await policy.run({ kind, name, agent: main.agent }, async () => 'allowed'), 'allowed')
        await assert.rejects(policy.run({ kind, name, agent: worker.agent }, async () => 'must not run'))
      }
      const mainTools = main.agent.ctx.tools.schemas(main.agent).map(tool => tool.name)
      const workerTools = worker.agent.ctx.tools.schemas(worker.agent).map(tool => tool.name)
      assert.ok(mainTools.includes('data_sql') && mainTools.includes('bot_task_start'))
      assert.ok(!workerTools.includes('data_sql') && !workerTools.includes('bot_task_start'))
      const binding = await dispatch('binding.inspect', { botId: 'a' })
      assert.equal(binding.bot.main, true)
      assert.deepEqual(binding.record.settings.capabilities, ['model-inference'], 'worker-style saved checkboxes do not narrow Main authority')
      assert.deepEqual(product.lifecycle.committedMainBotIds(), ['a'])
      const routing=()=>ctx.get('botRouting').inspect()
      assert.equal(routing().requesterBotId,'a')
      assert.ok(routing().candidates.find(bot=>bot.botId==='a').tools.includes('task/execute'))
      product.rt.state.mainBotIds = ['b']
      await product.lifecycle.refreshGrants()
      assert.deepEqual(product.lifecycle.committedMainBotIds(), ['a'], 'an uncommitted role edit grants no authority')
      assert.equal(routing().requesterBotId,'a','routing uses the committed Main, not the edited roster')
      assert.equal(ctx.get('operatorSubject')(),policy.modelIdentity({sessionId:'a',provider:'alpha',model:'one'}).subject)
      assert.equal(routing().candidates.find(bot=>bot.botId==='b').main,false)
      await assert.rejects(policy.run({ kind: 'task', name: 'execute', agent: worker.agent }, async () => 'must not run'))
      await product.rt.save()
      assert.deepEqual(product.lifecycle.committedMainBotIds(), ['b'])
      assert.equal(routing().requesterBotId,'b')
      assert.equal(ctx.get('operatorSubject')(),policy.modelIdentity({sessionId:'b',provider:'beta',model:'vendor/two'}).subject)
      assert.equal(routing().candidates.find(bot=>bot.botId==='a').main,false)
      assert.equal(await policy.run({ kind: 'task', name: 'execute', agent: worker.agent }, async () => 'new Main'), 'new Main')
      await assert.rejects(policy.run({ kind: 'task', name: 'execute', agent: main.agent }, async () => 'demoted Main must be scoped'))
    } finally { await worker.dispose(); await main.dispose() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
})

test('Main authority metadata comes from the committed role list, never a Bot-supplied main flag', () => {
  const seen = []
  compileDsOwnership({ version: 1, revision: 1, mainBotIds: ['a'], bots: {
    a: { id: 'a', sessionId: 'a' }, b: { id: 'b', sessionId: 'b', main: true },
  }, rooms: {} }, (bot, role) => { seen.push([bot.id, role.main]); return { tools: [], modelRoutes: [] } })
  assert.deepEqual(seen, [['a', true], ['b', false]])
})
