import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'integration-security-probe'
export const inject = ['tools', 'ptcRuntime', 'sessionController', 'connection']

export function apply(ctx, config) {
  let used = false
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/integration-security', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      try {
      if (used) return Response.json({ error: 'Probe already consumed' }, { status: 409 })
      used = true
      const { mainId, workerId } = await request.json()
      const { agent: main } = await ctx.sessionController.resolveAgent(mainId)
      const { agent: worker } = await ctx.sessionController.resolveAgent(workerId)
      assert.ok(main && worker && main !== worker)
      const scopedTools = worker.ctx.get('tools')
      const { createAuthority } = await import(config.authorityModule)
      const authority = createAuthority()
      const workerGrant = { tools: ['run_code', 'integration_public_read', 'integration_wait'], modelRoutes: [{ provider: 'integration-gpt-fixture', model: 'gpt-fixture' }] }
      authority.register(main, { botId: main.id, tools: ['integration_private_write'] })
      authority.register(worker, { botId: worker.id, ...workerGrant })
      const cleanup = []
      const checks = []
      let writes = 0
      const executions = []
      let opened
      const waitOpened = new Promise(resolve => { opened = resolve })
      let unblock
      const gate = new Promise(resolve => { unblock = resolve })
      const tool = (name, execute) => ctx.tools.register(defineTool({
        name, description: 'Isolated security fixture', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute,
      }))
      try {
        tool('integration_public_read', () => 'fixture-read')
        tool('integration_private_write', () => { writes++; return 'fixture-write' })
        tool('integration_wait', async () => { opened(); await gate; return 'released' })
        cleanup.push(scopedTools.presentAs('ptc'))
        cleanup.push(ctx.on('tools/result', (exec, result) => {
          if (exec.name.startsWith('integration_')) executions.push({ name: exec.name, nested: !!exec.parent, error: !!result.isError })
        }))
        const call = (agent, name, args = {}, signal = new AbortController().signal) => ctx.tools.execute({
          agent, name, arguments: args, callId: `security-${executions.length}`, signal,
        })
        const code = (program, signal) => call(worker, 'run_code', { code: program, description: 'Offline security boundary probe' }, signal)
        const transport = ctx.tools.get('run_code', worker)
        assert.ok(transport)
        const nativeCall = await call(worker, 'integration_private_write')
        assert.equal(nativeCall.isError, true)
        checks.push('PTC presentation blocks direct native calls')
        const allow = scopedTools.restrict({ allow: ['integration_public_read', 'integration_private_write', 'integration_wait'] })
        cleanup.push(allow)
        const read = await code('return await tools.integration_public_read({});')
        assert.notEqual(read.isError, true, JSON.stringify(read))
        assert.match(JSON.stringify(read), /fixture-read/)
        checks.push('Actual Node PTC process dispatches an allowed host binding')
        cleanup.push(scopedTools.guard(exec => {
          try { authority.assertTool(exec.agent, exec.name) } catch (error) { return error.message }
        }))
        cleanup.push(ctx.on('tools/pre-execute', async () => ({ kind: 'allow' })))
        const denied = await code('try { await tools.integration_private_write({}); return "unexpected-write"; } catch { return "policy-denied"; }')
        assert.equal(writes, 0)
        assert.match(JSON.stringify(denied), /policy-denied/)
        checks.push('PTC nested dispatch obeys guard despite permissive pre-execute hooks')
        const hide = scopedTools.restrict({ deny: ['integration_private_write'] })
        const hidden = await code('return typeof tools.integration_private_write;')
        assert.match(JSON.stringify(hidden), /undefined/)
        assert.equal(writes, 0)
        hide()
        checks.push('Hidden binding is absent inside the PTC program')
        const sibling = await call(main, 'integration_private_write')
        assert.notEqual(sibling.isError, true)
        assert.equal(writes, 1)
        checks.push('Worker restriction does not mutate sibling Main authority')
        const active = code('await tools.integration_wait({}); try { await tools.integration_public_read({}); return "unexpected-read"; } catch { return "revoked"; }')
        await Promise.race([waitOpened, new Promise((_, reject) => setTimeout(() => reject(new Error('PTC wait binding not reached')), 10_000))])
        authority.replaceGrant(worker, { ...workerGrant, tools: ['run_code', 'integration_wait'] })
        unblock()
        assert.match(JSON.stringify(await active), /revoked/)
        checks.push('Revocation affects a later binding in an already running PTC program')
        authority.replaceGrant(worker, workerGrant)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(new Error('integration cancel')), 150)
        const cancelled = await code('while (true) {}', controller.signal)
        clearTimeout(timer)
        assert.equal(cancelled.isError, true)
        checks.push('Actual PTC busy program settles after cancellation')
        const secretPath = join(process.env.DSH_HOME, 'other-bot-fixture', 'sentinel.txt')
        await mkdir(join(process.env.DSH_HOME, 'other-bot-fixture'), { recursive: true })
        await writeFile(secretPath, 'fixture-only-not-user-data')
        const file = await code(`try { const fs = await import('node:fs/promises'); return await fs.readFile(${JSON.stringify(secretPath)}, 'utf8'); } catch (e) { return 'fixture-file-blocked:' + e.code; }`)
        const outsideFileReadable = JSON.stringify(file).includes('fixture-only-not-user-data')
        assert.ok(executions.some(exec => exec.name === 'integration_public_read' && exec.nested))
        return Response.json({ status: 'passed-for-described-checks', checks, executions,
          runtime: { language: ctx.ptcRuntime.language, isolation: ctx.ptcRuntime.isolation, sandboxMode: ctx.ptcRuntime.sandboxMode },
          outsideFileReadable, outsideFileResult: file, actualModelCalls: 0,
          limitations: ['In-process tool guard prototype, not product Policy', 'Only a synthetic file was read', 'No OS-level private-state isolation claimed', 'Existing MR RPC and CLI paths still require shared authorization'] })
      } finally {
        unblock()
        authority.dispose()
        for (const dispose of cleanup.reverse()) dispose()
      }
      } catch (error) {
        return Response.json({ status: 'failed', error: error.stack }, { status: 200 })
      }
    },
  }), 'integration: security probe route')
}
