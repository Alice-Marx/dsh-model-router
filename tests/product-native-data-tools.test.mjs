import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'
import { createBotLibrary } from '../packages/orchestration/src/bot-library.mjs'

const script = fileURLToPath(new URL('./fixtures/bot-engine-claude-fixture.mjs', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const nativeTurnDeadlineMs = 180000
const profileOf = async () => ({ id: 'native-data', driver: 'claude', provider: 'native-data', model: 'fixture-model-a', hostTools: true,
  entry: { executable: process.execPath, sha256: sha(await readFile(process.execPath)), version: process.versions.node,
    script, scriptSha256: sha(await readFile(script)) }, credentialRef: 'ds-secret/NATIVE_DATA_AUTH', deadlineMs: nativeTurnDeadlineMs })
const names = ['data_load', 'data_describe', 'data_sql', 'data_show', 'data_export']
const call = (name, args = {}) => ({ name, arguments: args })
const valueOf = result => JSON.parse(result.content[0].text)
const success = result => { assert.equal(result.isError ?? false, false, JSON.stringify(result)); return valueOf(result) }

for (const mode of ['integrated', 'independent', 'worker', 'cancel']) test(`native ${mode} data tools use the existing Bot database and library`, { timeout: nativeTurnDeadlineMs + (mode === 'cancel' ? 60000 : 0) }, async () => {
  let actual, library, releaseRead, announceRead
  const readStarted = new Promise(resolve => { announceRead = resolve })
  const readHeld = new Promise(resolve => { releaseRead = resolve })
  const botId = mode === 'worker' ? 'b' : 'a'
  await withProductIndependent(async ({ ctx, product, runtime, bind, dispatch, home, readRows }) => {
    await product.rt.secretEndpoint('secret-set', { name: 'NATIVE_DATA_AUTH', value: '{"offlineFixture":true}', scope: [] })
    await bind(botId, 'native-data', 'fixture-model-a')
    const independent = mode === 'independent'
    if (independent) await runtime.move(botId, 'independent')
    const handle = independent ? null : await actual.context.agents.create({ sessionId: botId, agentOptions: { provider: 'native-data', model: 'fixture-model-a' } })
    const evidencePath = join(home, 'model-router/conversation-engines/native-data/workspace/fixture-evidence.json')
    const evidence = async () => JSON.parse(await readFile(evidencePath, 'utf8'))
    const activity = async () => {
      const calls = readRows('router_model_calls').length
      const page = await dispatch('nativeActivity.list', { botId, mode: independent ? 'independent' : 'integration',
        ...(independent ? { contextId: ctx.get('botRuntimeAdapter').contextOf(botId).contextId } : { sessionId: botId }), limit: 50 })
      assert.equal(readRows('router_model_calls').length, calls, 'observing a tool record creates no model call or receipt')
      return page
    }
    let turns = 0
    const send = async (calls, { cancelled = false } = {}) => {
      const input = mode === 'worker' ? 'Report the available native data capabilities.' : `host-tools:${JSON.stringify({ calls })}`
      turns++
      if (independent) {
        const requestKey = `native-data-request-${turns}`
        await dispatch('independentChat.send', { botId, requestKey, input })
        await ctx.get('botIndependentChat').whenIdle()
        const receipt = await dispatch('independentChat.inspect', { botId, requestKey })
        assert.equal(receipt.state, 'succeeded', JSON.stringify(receipt))
      } else {
        handle.agent.send(createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } }), 'next-turn', true)
        await handle.agent.whenIdle()
        const kind = handle.agent.session.log.filter(row => row.type === 'turn/end').at(-1)?.data.reason.kind
        if (cancelled) assert.notEqual(kind, 'completed')
        else assert.equal(kind, 'completed')
      }
      return (await evidence()).hostToolResults
    }
    try {
      if (mode === 'worker') {
        await send([])
        const worker = await evidence()
        assert.equal(worker.mcp.bridgeMounted, false, 'a worker without grants receives no Host tool bridge')
        assert.equal(fs.existsSync(join(home, 'model-router/data/b.sqlite')), false, 'catalog construction opens no database for an ungranted worker')
        assert.deepEqual((await dispatch('data.catalog', { botId: 'b' })).tables, [])
        assert.equal(readRows('router_model_calls').length, 1)
        assert.deepEqual((await activity()).items, [], 'a native turn with no tool event has no invented steps')
        return
      }
      if (mode === 'cancel') {
        library.write('a', 'delayed.csv', 'value\n19')
        const sending = send([call('data_load', { from: 'library', path: 'delayed.csv', name: 'late_write' })], { cancelled: true })
        let timer
        // The gate is the actual library read, not an assumed CLI startup time.
        // A turn that fails before reaching it must fail immediately rather than
        // leave this test waiting for the native route's configured deadline.
        try { await Promise.race([
          readStarted,
          sending.then(() => { throw new Error('native turn ended before the held data read started') }),
          new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('native data read did not start within the native turn deadline')), nativeTurnDeadlineMs) }),
        ]) }
        finally { clearTimeout(timer) }
        const pid = (await evidence()).pid
        const running = await activity()
        assert.equal(running.items.length, 1)
        assert.equal(running.items[0].state, 'running')
        handle.agent.cancel({ kind: 'user' })
        await sending
        releaseRead()
        await new Promise(resolve => setImmediate(resolve))
        await new Promise(resolve => setImmediate(resolve))
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
        assert.equal(fs.existsSync(join(home, 'model-router/data/a.sqlite')), false, 'the cancelled native call cannot write after its delayed library read returns')
        assert.deepEqual((await dispatch('data.catalog', { botId: 'a' })).tables, [])
        assert.equal(readRows('router_model_calls').length, 1)
        assert.notEqual(readRows('router_model_calls')[0].outcome, 'succeeded')
        const stopped = await activity()
        assert.equal(stopped.items.length, 1)
        assert.equal(stopped.items[0].state, 'turn-unconfirmed')
        assert.equal(stopped.items[0].cancelRequested, true)
        assert.equal(stopped.items[0].stopConfirmed, true)
        assert.equal(stopped.items[0].cliOk, null)
        return
      }
      library.write('a', 'sales.csv', 'region,value\n华东,3\n华东,4\n华北,5')
      const result = await send([
        call('data_load', { from: 'library', path: 'sales.csv', name: 'sales' }),
        call('data_describe', { target: 'sales' }),
        call('data_sql', { sql: 'SELECT region,SUM(value) AS total FROM sales GROUP BY region ORDER BY region' }),
        call('data_show', { table: 'sales', kind: 'chart', title: '地区总量', chart: { type: 'bar', x: 'region', y: 'value', agg: 'sum', sort: 'x' } }),
        call('data_show', { table: 'sales', kind: 'table', title: '实际明细' }),
        call('data_export', { table: 'sales', filename: 'native-sales' }),
      ])
      const first = await evidence()
      assert.ok(names.every(name => first.hostToolNames.includes(name)))
      assert.equal(success(result[0]).tables[0].rowCount, 3)
      assert.equal(success(result[1]).rowCount, 3)
      assert.deepEqual(success(result[2]).rows, [['华东', 7], ['华北', 5]])
      assert.equal(typeof success(result[2]).truncated, 'boolean')
      const chart = success(result[3]), table = success(result[4]), exported = success(result[5])
      assert.deepEqual(chart.chart.series[0].points, [{ x: '华东', y: 7 }, { x: '华北', y: 5 }])
      assert.equal(chart.title, '地区总量')
      assert.equal(exported.path, 'exports/native_sales.csv')
      assert.match(library.read('a', exported.path), /华东,3/)
      assert.equal(exported.rowCount, 3)
      const catalog = await dispatch('data.catalog', { botId: 'a' })
      assert.ok(catalog.cards.some(card => card.id === chart.id))
      assert.deepEqual((await dispatch('data.show', { botId: 'a', cardId: chart.id })).chart, chart.chart)
      assert.deepEqual((await dispatch('data.page', { botId: 'a', cardId: table.id })).rows, [['华东', 3], ['华东', 4], ['华北', 5]])
      assert.deepEqual((await dispatch('data.catalog', { botId: 'b' })).tables, [])
      await dispatch('data.load', { botId: 'b', from: 'content', content: 'private\n11', name: 'private_data' })
      const foreign = await dispatch('data.show', { botId: 'b', table: 'private_data', kind: 'table' })
      const invalid = await send([
        call('data_sql', { sql: 'SELECT * FROM private_data', botId: 'b' }),
        call('data_show', { table: 'sales', kind: 'chart', chart: { type: 'bar', x: 'region', script: 'alert(1)' } }),
        call('data_sql', { sql: 'DELETE FROM sales' }),
        call('data_load', { from: 'library', path: '../outside.csv', name: 'escape' }),
        call('data_show', { kind: 'table', cardId: foreign.id }),
      ])
      assert.ok(invalid.every(item => item.isError === true), JSON.stringify(invalid))
      assert.equal(valueOf(invalid[2]).error.code, 'write_refused')
      assert.equal(valueOf(invalid[4]).error.code, 'card_not_found')
      assert.equal((await dispatch('data.describe', { botId: 'a', target: 'sales' })).rowCount, 3)
      const reread = await send([call('data_show', { kind: 'chart', cardId: chart.id }), call('data_sql', { sql: 'SELECT 1 AS number,NULL AS blank' })])
      assert.deepEqual(success(reread[0]).chart, chart.chart)
      assert.deepEqual(success(reread[1]).rows, [[1, null]])
      const final = await evidence()
      assert.equal(final.pid, first.pid)
      assert.equal(final.mcpPid, first.mcpPid)
      assert.equal(readRows('router_model_calls').length, turns)
      assert.ok(readRows('router_model_calls').every(row => row.state === 'settled' && row.funding === 'subscription'))
      assert.equal(ctx.upstream.length, 0, 'the native data turn does not fall back to an API provider')
      const observed = await activity()
      assert.equal(observed.recording.status, 'ready', JSON.stringify(observed.recording))
      assert.equal(observed.items.length, 13, 'each actual CLI tool call is displayed once')
      assert.equal(new Set(observed.items.map(row => row.callKey)).size, 13)
      assert.equal(new Set(observed.items.map(row => row.turnId)).size, 3)
      assert.equal(new Set(observed.items.map(row => row.processGeneration)).size, 1)
      assert.ok(observed.items.some(row => row.state === 'cli-ok'))
      assert.ok(observed.items.some(row => row.state === 'cli-error'))
      assert.ok(observed.items.every(row => row.botId === botId && row.conversationId === observed.scope.conversationId && row.turnSettled))
      assert.ok(observed.items.every(row => !['input', 'arguments', 'content', 'result', 'pixels'].some(key => Object.hasOwn(row, key))))
      const otherScope = await dispatch('nativeActivity.list', { botId: 'b', mode: 'integration', sessionId: 'b', limit: 50 })
      assert.deepEqual(otherScope.items, [], 'owner history selectors cannot mix activity rows between Bots')
      assert.equal(readRows('router_model_calls').length, turns)
      assert.equal((await evidence()).turns.length, turns, 'record paging never replays a CLI prompt')
    } finally { releaseRead(); await handle?.dispose() }
  }, { conversationEngines: [await profileOf()], runtimeConfig: { memoryReview: false }, beforeProduct: async ({ ctx, home }) => {
    library = createBotLibrary({ root: join(home, 'private-library'), fs })
    ctx.provide('botLibrary', { ...library, async read(botId, path) {
      if (mode === 'cancel' && path === 'delayed.csv') { announceRead(); await readHeld }
      return library.read(botId, path)
    } })
    actual = await attachActualAgentLoop(ctx)
    return () => actual.close()
  } })
})

