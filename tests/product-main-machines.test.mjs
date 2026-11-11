import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { startFixtureAgent } from './fixtures/independent-tool-host.mjs'

const owner = { kind: 'owner', peer: { principal: { kind: 'owner' } }, clientOrigin: 'http://127.0.0.1' }

for (const revokeBot of [false, true]) test(`Main inherits a paired computer without a worker binding; ${revokeBot ? 'Bot' : 'machine'} revocation reaches its remote tickets`, async t => {
  const fixture = await startFixtureAgent(t, { botIds: ['a', 'b'], tools: ['machine_ping', 'fs_read'] })
  let actual
  try {
    await writeFile(fixture.rootOf('project', 'notes.txt'), 'Main computer proof')
    await withProductIndependent(async ({ ctx, product, bind }) => {
      await bind('a', 'alpha', 'one'); await bind('b', 'beta', 'vendor/two')
      const main = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'alpha', model: 'one' } })
      const worker = await actual.context.agents.create({ sessionId: 'b', agentOptions: { provider: 'beta', model: 'vendor/two' } })
      try {
        await product.rt.secretEndpoint('secret-set', { name: 'REMOTE_AGENT_FIXTURE', value: fixture.credential.token, scope: [] })
        const machines = ctx.get('botRemoteMachines')
        await machines.pair({ machineId: fixture.machineId, clientId: 'host-a', name: 'Offline Main computer', endpoint: fixture.endpoint,
          transport: fixture.agent.store.pairing.identity(), secretRef: 'ds-secret/REMOTE_AGENT_FIXTURE',
          roots: fixture.roots, tools: fixture.tools, probeBotId: 'a', expectedRevision: 0 }, owner)
        await product.rt.load()
        assert.equal(machines.readModel().items[0].bindings.length, 0, 'no worker-style binding was created')
        assert.deepEqual(machines.scopes('b'), [])
        assert.equal(machines.scopes('a')[0].inheritedMain, true)
        assert.deepEqual([...machines.scopes('a')[0].tools].sort(), [...fixture.tools].sort())
        const candidate=ctx.get('botRouting').inspect().candidates.find(bot=>bot.botId==='a')
        assert.ok(candidate.machineIds.includes(fixture.machineId),'routing sees Main inherited computers without writing a narrower binding')
        const policy = ctx.get('botIntegrationPolicy')
        const principal = id => policy.modelIdentity({ sessionId: id, provider: id === 'a' ? 'alpha' : 'beta', model: id === 'a' ? 'one' : 'vendor/two' }).subject
        const input = { machineId: fixture.machineId, rootId: 'project', taskId: 'main-read-proof', attemptId: 'main-attempt',
          tool: 'fs_read', args: { rootId: 'project', relativePath: 'notes.txt' } }
        const read = await machines.call(principal('a'), input)
        assert.equal(Buffer.from(read.content, 'base64').toString(), 'Main computer proof')
        assert.ok(fixture.grants().some(grant => grant.botId === 'a' && grant.taskId === input.taskId))
        let audits = fixture.audits('TOOL_RESULT').length
        await assert.rejects(machines.call(principal('b'), input))
        await assert.rejects(machines.call(principal('a'), { ...input, args: { ...input.args, botId: 'b' } }), { code: 'MACHINE_CONTEXT_FORGED' })
        assert.equal(fixture.audits('TOOL_RESULT').length, audits, 'refused calls never reached the remote tool')
        if(!revokeBot){
          product.rt.state.mainBotIds=['b'];await product.rt.save()
          assert.deepEqual(machines.scopes('a'), [])
          assert.equal(machines.scopes('b')[0].inheritedMain,true)
          await assert.rejects(machines.call(principal('a'),input))
          assert.equal(Buffer.from((await machines.call(principal('b'),input)).content,'base64').toString(),'Main computer proof')
          audits=fixture.audits('TOOL_RESULT').length
          product.rt.state.mainBotIds=['a'];await product.rt.save()
        }
        const revoked = await machines.revoke({ machineId: fixture.machineId, ...(revokeBot ? { botId: 'a', expectedRevision: 0 } : { expectedRevision: 1 }) }, owner)
        assert.equal(revoked.remoteRevoked, true)
        assert.deepEqual(fixture.grants().filter(grant => grant.botId === 'a'), [], 'the actual Agent invalidated Main tickets, including the pairing probe')
        if(!revokeBot)assert.deepEqual(fixture.grants(),[], 'durable grant identities include a former Main without a binding row')
        assert.deepEqual(machines.scopes('a'), [])
        assert.ok(!ctx.get('botRouting').inspect().candidates.find(bot=>bot.botId==='a').machineIds.includes(fixture.machineId))
        await assert.rejects(machines.call(principal('a'), input))
        assert.equal(fixture.audits('TOOL_RESULT').length, audits)
      } finally { await worker.dispose(); await main.dispose() }
    }, { runtimeConfig: { memoryReview: false }, beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
  } finally { await fixture.close() }
})
