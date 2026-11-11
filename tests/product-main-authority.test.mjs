import test from 'node:test'
import assert from 'node:assert/strict'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { compileDsOwnership } from '../packages/orchestration/src/ds-lifecycle.mjs'

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
