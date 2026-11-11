import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { startFixtureAgent, MACHINE_TOOLS } from './fixtures/independent-tool-host.mjs'
import { nativeDesktopFixture } from './fixtures/native-desktop-helper.mjs'

const owner = { kind: 'owner', peer: { principal: { kind: 'owner' } }, clientOrigin: 'http://127.0.0.1' }
const script = fileURLToPath(new URL('./fixtures/bot-engine-claude-fixture.mjs', import.meta.url))
const sha = data => createHash('sha256').update(data).digest('hex')
const profileOf = async () => ({ id: 'native-remote', driver: 'claude', provider: 'native-remote', model: 'fixture-model-a', hostTools: true,
  entry: { executable: process.execPath, sha256: sha(await readFile(process.execPath)), version: process.versions.node,
    script, scriptSha256: sha(await readFile(script)) }, credentialRef: 'ds-secret/NATIVE_REMOTE_AUTH', deadlineMs: 180000 })
const tools = [...MACHINE_TOOLS, 'browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_close',
  'desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll']
const call = (name, args = {}) => ({ name, arguments: args })

// The actual Agent launches its own headless Chromium against our loopback page. DesktopTools is
// also the actual client, using its authenticated private pipes and the Agent's actual artifact and
// operation journals. Only the desktop peer is offscreen; no physical keyboard or display is used.
for (const mode of ['integrated', 'independent']) test(`native ${mode} browser and screenshot MCP tools reach the actual paired Agent`, { timeout: 240000 }, async t => {
  const helper = await nativeDesktopFixture(t)
  const page = createServer((_req, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><input aria-label="message"><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value;window.clicks=(window.clicks||0)+1">Apply</button><output>waiting</output>')
  })
  await new Promise(resolve => page.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => page.close(resolve)))
  const origin = `http://127.0.0.1:${page.address().port}`
  const remote = await startFixtureAgent(t, { botIds: ['a', 'b'], tools,
    agentConfig: { browserOrigins: [origin], desktop: helper.config } })
  helper.attach(remote.agent)
  let actual
  try {
    await withProductIndependent(async ({ ctx, product, runtime, bind, dispatch, home, readRows }) => {
      await product.rt.secretEndpoint('secret-set', { name: 'NATIVE_REMOTE_AUTH', value: '{"offlineFixture":true}', scope: [] })
      await product.rt.secretEndpoint('secret-set', { name: 'REMOTE_AGENT_AUTH', value: remote.credential.token, scope: [] })
      await bind('a', 'native-remote', 'fixture-model-a')
      const binding = await dispatch('binding.inspect', { botId: 'a' })
      await dispatch('binding.save', { botId: 'a', expectedRevision: binding.record.revision,
        settings: { ...binding.record.settings, funding: { ...binding.record.settings.funding, subscription: { dailyCalls: 50, monthlyCalls: 100 } } } })
      const machines = ctx.get('botRemoteMachines')
      await machines.pair({ machineId: remote.machineId, clientId: 'host-a', name: 'Offline browser and desktop', endpoint: remote.endpoint,
        transport: remote.agent.store.pairing.identity(), secretRef: 'ds-secret/REMOTE_AGENT_AUTH',
        roots: remote.roots, tools, probeBotId: 'a', expectedRevision: 0 }, owner)
      await product.rt.load()
      const independent = mode === 'independent'
      if (independent) await runtime.move('a', 'independent')
      const errors = []
      ctx.on('agent/error', event => errors.push(event.error?.stack ?? event.error?.message))
      const handle = independent ? null : await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider: 'native-remote', model: 'fixture-model-a' } })
      const evidencePath = join(home, 'model-router/conversation-engines/native-remote/workspace/fixture-evidence.json')
      const evidence = async () => JSON.parse(await readFile(evidencePath, 'utf8'))
      let turns = 0
      const send = async calls => {
        const input = `host-tools:${JSON.stringify({ calls })}`
        turns++
        if (independent) {
          const requestKey = `native-remote-request-${turns}`
          await dispatch('independentChat.send', { botId: 'a', requestKey, input })
          await ctx.get('botIndependentChat').whenIdle()
          const result = await dispatch('independentChat.inspect', { botId: 'a', requestKey })
          assert.equal(result.state, 'succeeded', JSON.stringify(result))
        } else {
          handle.agent.send(createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } }), 'next-turn', true)
          await handle.agent.whenIdle()
          assert.equal(handle.agent.session.log.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind, 'completed', JSON.stringify(errors))
        }
        return (await evidence()).hostToolResults
      }
      const resultOf = result => JSON.parse(result.content[0].text)
      const succeeded = result => {
        assert.equal(result.isError ?? false, false, JSON.stringify(result))
        const record = resultOf(result)
        assert.equal(record.status, 'succeeded', JSON.stringify(record))
        return record
      }
      try {
        const callAgent = remote.agent.call.bind(remote.agent)
        const loseReply = async (nameToLose, invoke) => {
          let lost = false
          remote.agent.call = async (name, args, ...rest) => {
            const result = await callAgent(name, args, ...rest)
            if (name === nameToLose && !lost) { lost = true; throw Object.assign(new Error('reply lost after actual Agent operation'), { code: 'MACHINE_CONNECTION_FAILED' }) }
            return result
          }
          try { return await invoke() } finally { remote.agent.call = callAgent }
        }
        const unknownOpen = resultOf((await loseReply('browser_open', () => send([call('bot_browser_open', { url: origin })])))[0])
        assert.equal(unknownOpen.status, 'unknown')
        const opened = succeeded((await send([call('bot_remote_operation_status', { operationId: unknownOpen.operationId })]))[0])
        const first = await evidence(), browserSessionId = opened.value.browserSessionId
        assert.ok(first.hostToolNames.includes('bot_remote_operation_status'), 'reconciliation must be mounted before any operation is issued')
        assert.ok(first.hostToolNames.includes('bot_desktop_screenshot'))
        const snapshot = succeeded((await send([call('bot_browser_snapshot', { browserSessionId })]))[0]).value
        const inputRef = snapshot.nodes.find(node => node.tag === 'input').ref
        succeeded((await send([call('bot_browser_type', { browserSessionId, snapshotId: snapshot.snapshotId, ref: inputRef, text: '原生浏览器已连通' })]))[0])
        const beforeClick = succeeded((await send([call('bot_browser_snapshot', { browserSessionId })]))[0]).value
        const clickArgs = { browserSessionId, snapshotId: beforeClick.snapshotId, ref: beforeClick.nodes.find(node => node.tag === 'button').ref }
        const unknown = resultOf((await loseReply('browser_click', () => send([call('bot_browser_click', clickArgs)])))[0])
        assert.equal(unknown.status, 'unknown', JSON.stringify(unknown))
        assert.ok(unknown.operationId)
        const operationCount = remote.operations().length
        const blocked = (await send([call('bot_browser_click', clickArgs)]))[0]
        assert.equal(blocked.isError, true)
        assert.match(JSON.stringify(blocked), /NATIVE_REMOTE_OPERATION_PENDING/)
        assert.equal(remote.operations().length, operationCount, 'the unresolved click cannot be replayed')
        const reconciled = succeeded((await send([call('bot_remote_operation_status', { operationId: unknown.operationId })]))[0])
        assert.equal(reconciled.operationId, unknown.operationId)
        assert.equal(remote.operations().length, operationCount, 'reconciliation only queries the original Agent record')
        const afterClick = succeeded((await send([call('bot_browser_snapshot', { browserSessionId })]))[0]).value
        assert.match(afterClick.text, /原生浏览器已连通/)
        const stale = (await send([call('bot_browser_click', clickArgs)]))[0]
        assert.equal(stale.isError, true)
        assert.match(JSON.stringify(stale), /TARGET_STALE/)
        // The Agent records a known stale-target failure. It must not leave a Host unknown fence.
        const invalidBrowser = (await send([call('bot_browser_snapshot', { browserSessionId: 'browser-foreign' })]))[0]
        assert.equal(invalidBrowser.isError, true)
        const unknownShot = resultOf((await loseReply('desktop_screenshot', () => send([call('bot_desktop_screenshot')])))[0])
        assert.equal(unknownShot.status, 'unknown')
        const recoveredShot = (await send([call('bot_remote_operation_status', { operationId: unknownShot.operationId })]))[0]
        succeeded(recoveredShot)
        assert.equal(sha(Buffer.from(recoveredShot.content.find(block => block.type === 'image').data, 'base64')), sha(helper.image))
        const shots = await send(Array.from({ length: 10 }, () => call('bot_desktop_screenshot')))
        for (const shot of shots) {
          const record = succeeded(shot), image = shot.content.find(block => block.type === 'image')
          assert.equal(image.mimeType, 'image/png')
          assert.equal(sha(Buffer.from(image.data, 'base64')), sha(helper.image), 'actual MCP image bytes match the original Agent artifact')
          assert.equal(record.value.width, 384)
          assert.equal(record.value.height, 384)
          assert.ok(record.operationId)
        }
        assert.ok(shots.reduce((sum, result) => sum + Buffer.byteLength(JSON.stringify(result)), 0) > 7 * 1024 * 1024)
        const shot = resultOf(shots.at(-1))
        succeeded((await send([call('bot_desktop_click', { screenshotId: shot.value.screenshotId, x: 12, y: 34 })]))[0])
        const actualClick = helper.calls.find(item => item.name === 'desktop_click')
        assert.deepEqual(actualClick.args, { screenshotId: shot.value.screenshotId, x: 12, y: 34 })
        assert.equal(new Set(helper.calls.map(item => item.owner)).size, 1, 'all native turns share the actual desktop owner')
        const helperCount = helper.calls.length, beforeForeign = remote.operations().length
        const foreignShot = (await send([call('bot_desktop_click', { screenshotId: 'shot-foreign', x: 1, y: 1 })]))[0]
        assert.equal(foreignShot.isError, true)
        assert.equal(remote.operations().length, beforeForeign)
        assert.equal(helper.calls.length, helperCount, 'a foreign capture is refused before reaching the helper')
        const staleShot = (await send([call('bot_desktop_click', { screenshotId: shot.value.screenshotId, x: 1, y: 1 })]))[0]
        assert.equal(staleShot.isError, true)
        assert.match(JSON.stringify(staleShot), /TARGET_STALE/)
        assert.equal(helper.calls.length, helperCount, 'the actual helper refuses a consumed frame')
        succeeded((await send([call('bot_browser_close', { browserSessionId })]))[0])
        const last = await evidence()
        assert.equal(last.pid, first.pid)
        assert.equal(last.mcpPid, first.mcpPid, 'the real MCP connection survives repeated large images')
        assert.equal(readRows('router_model_calls').length, turns)
        const mutations = remote.operations().filter(row => row.tool.startsWith('browser_') || row.tool.startsWith('desktop_'))
        const owners = mutations.map(row => JSON.parse(row.context))
        assert.equal(new Set(owners.map(row => row.taskId)).size, 1)
        assert.equal(new Set(owners.map(row => row.attemptId)).size, 1)
        assert.ok(owners.every(row => row.taskId.startsWith('nrt-') && row.attemptId.startsWith('nra-')))
      } finally { await handle?.dispose() }
    }, { conversationEngines: [await profileOf()], runtimeConfig: { memoryReview: false }, beforeProduct: async ({ ctx }) => {
      actual = await attachActualAgentLoop(ctx)
      return () => actual.close()
    } })
  } finally { await remote.close() }
})
