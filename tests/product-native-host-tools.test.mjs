import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { startFixtureAgent } from './fixtures/independent-tool-host.mjs'

const owner = { kind: 'owner', peer: { principal: { kind: 'owner' } }, clientOrigin: 'http://127.0.0.1' }
const script = fileURLToPath(new URL('./fixtures/bot-engine-claude-fixture.mjs', import.meta.url))
const profileOf = async () => ({ id: 'native-tools', driver: 'claude', provider: 'native-tools', model: 'fixture-model-a', hostTools: true,
  entry: { executable: process.execPath, sha256: createHash('sha256').update(await readFile(process.execPath)).digest('hex'), version: process.versions.node,
    script, scriptSha256: createHash('sha256').update(await readFile(script)).digest('hex') },
  credentialRef: 'ds-secret/NATIVE_TOOLS_AUTH', deadlineMs: 180000 })

for (const mode of ['integrated', 'independent', 'wire', 'cancel']) test(`native MCP tools use real Noise/Task services in ${mode} chat`, { timeout: 180000 }, async t => {
  const independent = mode === 'independent'
  const remote = await startFixtureAgent(t, { botIds: ['a', 'b'] })
  let actual
  try {
    await writeFile(remote.rootOf('project', 'notes.txt'), 'read from the actual paired Agent')
    await withProductIndependent(async ({ ctx, product, runtime, bind, dispatch, home, readRows }) => {
      await product.rt.secretEndpoint('secret-set', { name: 'NATIVE_TOOLS_AUTH', value: '{"offlineFixture":true}', scope: [] })
      await product.rt.secretEndpoint('secret-set', { name: 'REMOTE_TOOLS_AUTH', value: remote.credential.token, scope: [] })
      await bind('a', 'native-tools', 'fixture-model-a')
      await bind('b', 'beta', 'vendor/two')
      const machines = ctx.get('botRemoteMachines')
      await machines.pair({ machineId: remote.machineId, clientId: 'host-a', name: 'Offline native tools', endpoint: remote.endpoint,
        transport: remote.agent.store.pairing.identity(), secretRef: 'ds-secret/REMOTE_TOOLS_AUTH',
        roots: remote.roots, tools: remote.tools, probeBotId: 'a', expectedRevision: 0 }, owner)
      await product.rt.load()
      assert.deepEqual(machines.scopes('b'), [])
      const workerNative = ctx.get('botIndependentToolHost').forBot('b', { nativeRoute: { provider: 'native-tools', model: 'fixture-model-a' } })
      await assert.rejects(workerNative.call('bot_fs_read', { relativePath: 'notes.txt' }), { code: 'TOOL_NOT_GRANTED' })
      const errors = []
      ctx.on('agent/error', event => { errors.push(event.error?.stack ?? event.error?.message) })
      if (independent) await runtime.move('a', 'independent')
      const handle = independent ? null : await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'native-tools', model: 'fixture-model-a' } })
      const evidencePath = join(home, 'model-router/conversation-engines/native-tools/workspace/fixture-evidence.json')
      const evidence = async () => {
        try { return JSON.parse(await readFile(evidencePath, 'utf8')) }
        catch (error) { assert.fail(JSON.stringify({ error: error.code, errors })) }
      }
      const send = async (key, calls, idleCall) => {
        const input = `${mode === 'wire' ? 'host-wire' : 'host-tools'}:${JSON.stringify({ calls, ...(idleCall ? { idleCall } : {}) })}`
        if (independent) {
          await dispatch('independentChat.send', { botId: 'a', requestKey: key, input })
          await ctx.get('botIndependentChat').whenIdle()
          const result = await dispatch('independentChat.inspect', { botId: 'a', requestKey: key })
          return result.state
        } else {
          handle.agent.send(createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } }), 'next-turn', true)
          await handle.agent.whenIdle()
          return handle.agent.session.log.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind
        }
      }
      try {
        if (mode === 'cancel') {
          const service = ctx.get('botIndependentToolHost')
          let announce, toolSignal
          const started = new Promise(resolve => { announce = resolve })
          ctx.provide('botIndependentToolHost', { forBot(botId, options) {
            const view = service.forBot(botId, options)
            return { ...view, async call(_name, _args, context) {
              toolSignal = context.signal
              announce()
              await new Promise((_resolve, reject) => {
                const abort = () => reject(context.signal.reason)
                if (context.signal.aborted) abort()
                else context.signal.addEventListener('abort', abort, { once: true })
              })
            } }
          } })
          // Establish the actual CLI and MCP transport with the instrumented
          // Host before timing in-flight cancellation. Startup has its own bound.
          assert.equal(await send('native-cancel-warmup', []), 'completed', JSON.stringify(errors))
          const receiptsBefore = readRows('router_model_calls').length
          assert.equal(receiptsBefore, 1)
          const callsBefore = remote.audits('TOOL_RESULT').length
          const sending = send('native-cancel-tool', [{ name: 'bot_fs_read', arguments: { relativePath: 'notes.txt' } }])
          let timer
          try {
            await Promise.race([started, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('native tool never entered Host service')), 45000) })])
          } finally { clearTimeout(timer) }
          assert.equal(toolSignal.aborted, false)
          const pid = (await evidence()).pid
          handle.agent.cancel({ kind: 'user' })
          await sending
          assert.equal(toolSignal.aborted, true, 'Host cancellation reaches the actual MCP handler signal')
          assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
          assert.equal(remote.audits('TOOL_RESULT').length, callsBefore)
          assert.equal(readRows('router_model_calls').length, receiptsBefore + 1)
          assert.notEqual(readRows('router_model_calls').at(-1).outcome, 'succeeded')
          return
        }
        if (mode === 'wire') {
          await send('native-wire-write', [{ name: 'bot_fs_write', arguments: { relativePath: 'native-wire.txt', content: 'one write for one bridge request', expectedHash: null } }])
          const proof = await evidence()
          assert.equal(proof.wireResults.first.ok, true, JSON.stringify(proof.wireResults))
          assert.ok(proof.wireResults.listed.value.some(tool => tool.name === 'bot_fs_write'))
          assert.equal(proof.wireResults.repeated.code, 'DUPLICATE_REQUEST')
          assert.equal(proof.wireResults.lateId.code, 'DUPLICATE_REQUEST')
          assert.equal(proof.wireResults.sameTick.filter(row => row.ok === true).length, 1)
          assert.equal(proof.wireResults.sameTick.filter(row => row.code === 'DUPLICATE_REQUEST').length, 1)
          assert.equal(remote.operations().filter(row => row.tool === 'fs_write').length, 2, 'one write per unique bridge id')
          for (let count = 0; count < 100 && !(await evidence()).idleWireResult; count++) await new Promise(resolve => setTimeout(resolve, 10))
          assert.equal((await evidence()).idleWireResult.code, 'CONTEXT_UNAVAILABLE', 'list has the same active-turn fence as call')
          assert.equal(await readFile(remote.rootOf('project', 'native-wire.txt'), 'utf8'), 'one write for one bridge request')
          assert.equal(readRows('router_model_calls').length, 1)
          return
        }
        const readState = await send('native-real-read', [{ name: 'bot_fs_read', arguments: { relativePath: 'notes.txt' } },
          { name: 'bot_fs_read', arguments: { relativePath: 'notes.txt', botId: 'b' } },
          { name: 'bot_fs_read', arguments: { relativePath: '../outside.txt' } }],
        { name: 'bot_fs_read', arguments: { relativePath: 'notes.txt' } })
        assert.equal(readState, independent ? 'succeeded' : 'completed', JSON.stringify(errors))
        const first = await evidence()
        assert.equal(first.mcp.bridgeMounted, true)
        assert.ok(Number.isSafeInteger(first.mcpPid))
        assert.ok(first.hostToolNames.includes('bot_fs_write'))
        assert.equal(first.hostToolResults[0].isError ?? false, false, JSON.stringify(first.hostToolResults))
        assert.match(Buffer.from(JSON.parse(first.hostToolResults[0].content[0].text).content, 'base64').toString(), /actual paired Agent/)
        assert.equal(first.hostToolResults[1].isError, true)
        assert.equal(first.hostToolResults[2].isError, true)
        for (let count = 0; count < 100 && !(await evidence()).idleToolResult; count++) await new Promise(resolve => setTimeout(resolve, 10))
        assert.equal((await evidence()).idleToolResult.isError, true, 'a retained child cannot read between Host turns')
        const before = remote.operations().length
        const writeState = await send('native-real-write', [{ name: 'bot_fs_write', arguments: { relativePath: 'native.txt', content: 'durable native write', expectedHash: null } }])
        assert.equal(writeState, independent ? 'succeeded' : 'completed', JSON.stringify(errors))
        const second = await evidence()
        assert.equal(second.pid, first.pid)
        assert.equal(second.mcpPid, first.mcpPid)
        assert.equal(second.hostToolResults[0].isError ?? false, false, JSON.stringify(second.hostToolResults))
        const result = JSON.parse(second.hostToolResults[0].content[0].text)
        assert.ok(result.taskId)
        assert.ok(result.attemptId)
        assert.equal(await readFile(remote.rootOf('project', 'native.txt'), 'utf8'), 'durable native write')
        const operation = remote.operations().find(row => row.operation_id === result.operationId || row.id === result.operationId)
        assert.ok(remote.operations().length > before)
        assert.ok(operation, JSON.stringify(remote.operations().map(row => Object.keys(row))))
        assert.equal(readRows('router_model_calls').length, 2)
        assert.ok(readRows('router_model_calls').every(row => row.funding === 'subscription' && row.state === 'settled'))
        assert.equal(ctx.upstream.length, 0)
        const callAgent = remote.agent.call.bind(remote.agent)
        remote.agent.call = async (name, args, ...rest) => {
          const response = await callAgent(name, args, ...rest)
          if (name === 'fs_write' && args.relativePath === 'unknown.txt') throw Object.assign(new Error('offline response loss after Agent write'), { code: 'MACHINE_CONNECTION_FAILED' })
          return response
        }
        try {
          await send('native-unknown-write', [{ name: 'bot_fs_write', arguments: { relativePath: 'unknown.txt', content: 'one unknown write', expectedHash: null } }])
        } finally { remote.agent.call = callAgent }
        const unknown = JSON.parse((await evidence()).hostToolResults[0].content[0].text)
        assert.equal(unknown.outcome, 'needs-reconciliation', JSON.stringify(unknown))
        assert.equal(unknown.code, 'TASK_OUTCOME_UNKNOWN')
        assert.ok(unknown.taskId)
        assert.match(unknown.nextAction, /original Task/)
        assert.equal(await readFile(remote.rootOf('project', 'unknown.txt'), 'utf8'), 'one unknown write')
        const operationCount = remote.operations().length
        await send('native-inspect-unknown', [{ name: 'bot_task_status', arguments: { taskId: unknown.taskId } }])
        const originalTask = JSON.parse((await evidence()).hostToolResults[0].content[0].text)
        assert.equal(originalTask.taskId ?? originalTask.id, unknown.taskId)
        assert.equal(originalTask.state, 'needs-reconciliation')
        assert.equal(remote.operations().length, operationCount, 'inspecting the original Task never replays its write')
        assert.equal(readRows('router_model_calls').length, 4)
        const audits = remote.audits('TOOL_RESULT').length
        await machines.revoke({ machineId: remote.machineId, expectedRevision: 1 }, owner)
        const revokedState = await send('native-after-revoke', [{ name: 'bot_fs_read', arguments: { relativePath: 'notes.txt' } }])
        assert.ok(!['succeeded', 'completed'].includes(revokedState))
        assert.equal((await evidence()).turns.length, 4, 'the changed authority retires the retained process before another prompt')
        assert.equal(remote.audits('TOOL_RESULT').length, audits)
      } finally { await handle?.dispose() }
    }, { conversationEngines: [await profileOf()], runtimeConfig: { memoryReview: false }, beforeProduct: async ({ ctx }) => {
      actual = await attachActualAgentLoop(ctx)
      return () => actual.close()
    } })
  } finally { await remote.close() }
})
