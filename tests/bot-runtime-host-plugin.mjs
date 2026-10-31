import assert from 'node:assert/strict'
import { createBotProduct } from '../modules/bot-runtime/index.mjs'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createBotPolicy } from '../packages/orchestration/src/bot-policy.mjs'

export const name = 'bot-product-host-fixture'
export const inject = ['llm', 'tools', 'systemPrompt', 'sessionController', 'sessions', 'sessionTitle', 'workspaceRegistry', 'connection']
export function apply(ctx) {
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  const policy = createBotPolicy({ authority, directory, machineId: 'fixture-host', workspaceId: 'fixture-workspace' })
  ctx.provide('botIntegrationPolicy', policy)
  const metered = []
  const product = createBotProduct(ctx, { authority, directory, policy,
    grantFor: bot => ({ tools: ['tool/model_router_routes', 'command/router'], modelRoutes: bot.model === 'integration-gpt-fixture/gpt-fixture' ? [{ provider: 'integration-gpt-fixture', model: 'gpt-fixture' }] : [] }),
    // Offline-only diagnostic decorator, intentionally no funding claim.
    accountStream(options, next, { source, sessionId, subject }) {
      assert.ok(subject, 'Resolved real Session identity reaches accounting decorator')
      metered.push({ source, sessionId, provider: options.provider, model: options.model, purpose: options.purpose ?? null })
      return next()
    },
  })
  ctx.effect(() => () => { product.dispose(); authority.dispose() }, 'bot-product: fixture cleanup')
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/bot-product-probe', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    const checks = []
    try {
      const { mainId, workerId, exercise } = await request.json()
      const rt = product.rt
      await rt.load()
      const main = await rt.resolveAgent(rt.chatOf(mainId)), worker = await rt.resolveAgent(rt.chatOf(workerId))
      assert.notEqual(directory.forAgent(main), directory.forAgent(worker))
      checks.push('Migrated DS factory automatically binds two real SDK Agent objects to distinct stable Bots')
      const visible = ctx.tools.schemas(worker).filter(tool => tool.name.startsWith('model_router_')).map(tool => tool.name)
      assert.deepEqual(visible, ['model_router_routes'])
      checks.push('Unified product factory hides ungranted old MR execution tools')
      if (exercise) {
        const created = await rt.createBot({ name: 'ProductLifecycle', model: 'integration-gpt-fixture/gpt-fixture' })
        const agent = await rt.resolveAgent(rt.chatOf(created.id)); assert.ok(directory.forAgent(agent))
        await rt.deleteBot(created.id)
        assert.throws(() => directory.forAgent(agent), /UNKNOWN_SUBJECT/)
        checks.push('Migrated runtime create/delete commits automatically grant and revoke current Session ownership')
      }
      const snapshot = await ctx.botProductReadModel.snapshot()
      assert.equal(snapshot.schemaVersion, 1)
      assert.equal(snapshot.bots.find(bot => bot.id === workerId)?.model, 'integration-gpt-fixture/gpt-fixture')
      assert.equal(snapshot.usage.status, 'blocked')
      checks.push('Versioned product projection reads actual persisted Bot model and explicitly blocks absent finance adapter')
      if (exercise) {
        assert.ok(metered.some(row => row.sessionId === worker.session.id && row.source === 'bot-session'))
        checks.push('Real Bot model stream traverses the injected accounting decorator with trusted identity')
      }
      assert.throws(() => rt.updateStart(), /统一|内置 DS/)
      checks.push('Embedded DS updater cannot install a second plugin')
      return Response.json({ status: 'passed', checks, metered, actualModelCalls: 0, lifecycle: product.lifecycle.status() })
    } catch (error) { return Response.json({ status: 'failed', checks, metered, error: error.stack }) }
  } }), 'bot-product: verification route')
}
