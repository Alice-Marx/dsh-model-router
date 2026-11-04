import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBotLoop } from '../packages/orchestration/src/bot-loop.mjs'
import { openBotSessionStore } from '../packages/orchestration/src/bot-session-store.mjs'
import { createBudgetedProvider, createGrantedTools, createMemoryRecall } from '../packages/orchestration/src/bot-loop-bridge.mjs'

const route = { provider: 'deepseek', model: 'deepseek-v4' }
const price = { inputPerMTokUsd: 1, outputPerMTokUsd: 2 }

test('bridge: a priced call reserves first and settles the real amount', async () => {
  const events = []
  const provider = createBudgetedProvider({
    route, priceFor: () => price,
    call: async () => ({ text: 'ok', usage: { inputTokens: 1_000, outputTokens: 500 } }),
    budget: {
      reserve: (usd, used) => { events.push(['reserve', used.model, Number(usd.toFixed(6))]) },
      settle: (usd, used, usage) => { events.push(['settle', Number(usd.toFixed(6)), usage.inputTokens]) },
      release: () => { events.push(['release']) },
    },
  })
  const reply = await provider({ messages: [{ role: 'user', content: 'hello world' }] })
  assert.equal(reply.text, 'ok')
  assert.deepEqual(events[0][0], 'reserve')
  assert.deepEqual(events[1], ['settle', 0.002, 1_000])
  assert.equal(reply.cost.route, 'deepseek/deepseek-v4')
})

test('bridge: an unpriced route is refused instead of called for free', async () => {
  let called = false
  const provider = createBudgetedProvider({ route, priceFor: () => null, call: async () => { called = true; return {} } })
  await assert.rejects(provider({ messages: [] }), /ROUTE_UNPRICED/)
  assert.equal(called, false)
})

test('bridge: a failed call releases the reservation', async () => {
  const events = []
  const provider = createBudgetedProvider({
    route, priceFor: () => price,
    call: async () => { throw new Error('boom') },
    budget: { reserve: () => events.push('reserve'), release: () => events.push('release'), settle: () => events.push('settle') },
  })
  await assert.rejects(provider({ messages: [{ role: 'user', content: 'x' }] }), /boom/)
  assert.deepEqual(events, ['reserve', 'release'])
})

test('bridge: tools are limited to the grant, and a grant without an implementation is not offered', async () => {
  const tools = createGrantedTools({
    granted: ['fs_read', 'shell_exec', 'not_implemented'],
    catalog: { fs_read: async () => ({ content: 'hi' }), shell_exec: async () => ({ ok: true }) },
  })
  assert.deepEqual(tools.names, ['fs_read', 'shell_exec'])
  assert.deepEqual(await tools.call('fs_read', {}), { content: 'hi' })
  await assert.rejects(tools.call('not_implemented', {}), /TOOL_NOT_GRANTED/)
  await assert.rejects(tools.call('fs_read', null), /INVALID_TOOL_ARGS/)
})

test('bridge: memory recall returns bounded excerpts from the Bot transcript', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-recall-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = openBotSessionStore({ dir })
  store.append('b1', [{ role: 'user', content: '我们决定用 SQLite 存认证' }, { role: 'assistant', content: '好' }, { role: 'user', content: 'SQLite 也要备份' }])
  const recall = createMemoryRecall({ store, maxChars: 500 })
  const hits = recall.recall('b1', 'sqlite')
  assert.equal(hits.includes('SQLite 存认证'), true)
  assert.equal(hits.includes('SQLite 也要备份'), true)
  assert.equal(recall.recall('b1', '不存在的词'), '')
  assert.equal(recall.recall('b1', ''), '')
})

test('bridge: a full loop turn prices the call, runs a granted tool and answers', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-turn-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = openBotSessionStore({ dir })
  let step = 0
  const settled = []
  const provider = createBudgetedProvider({
    route, priceFor: () => price,
    call: async () => {
      step += 1
      if (step === 1) return { toolCalls: [{ id: 'c1', name: 'fs_read', args: { path: 'README.md' } }], usage: { inputTokens: 100, outputTokens: 20 } }
      return { text: '读完了', usage: { inputTokens: 200, outputTokens: 40 } }
    },
    budget: { settle: usd => settled.push(Number(usd.toFixed(6))) },
  })
  const tools = createGrantedTools({ granted: ['fs_read'], catalog: { fs_read: async () => ({ content: '# hi' }) } })
  const loop = createBotLoop({ store, provider, tools })
  const result = await loop.run({ botId: 'session-1', input: '读 README' })
  assert.equal(result.answer, '读完了')
  assert.deepEqual(result.toolCalls, [{ id: 'c1', name: 'fs_read' }])
  assert.equal(settled.length, 2)
  assert.deepEqual(store.get('session-1').messages.map(m => m.role), ['user', 'assistant', 'assistant', 'tool', 'assistant'])
})
