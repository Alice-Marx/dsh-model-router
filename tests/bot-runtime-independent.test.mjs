import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBotLoop } from '../packages/orchestration/src/bot-loop.mjs'
import { BOT_SESSION_SCHEMA, openBotSessionStore, parseSession } from '../packages/orchestration/src/bot-session-store.mjs'

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bot-session-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('bot sessions: a transcript is owned by the Bot, not by the Harness', (t) => {
  const store = openBotSessionStore({ dir: tempDir(t), now: () => 1_700_000_000_000 })
  const empty = store.get('session-1')
  assert.equal(empty.botId, 'session-1')
  assert.equal(empty.turns, 0)
  assert.deepEqual(empty.messages, [])
  const written = store.append('session-1', [{ role: 'user', content: '你好' }], { turn: true })
  assert.equal(written.turns, 1)
  assert.equal(written.messages[0].content, '你好')
  assert.equal(store.list(['session-1'])[0].turns, 1)
})

test('bot sessions: a newer schema is refused instead of guessed at', (t) => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'session-1.json'), JSON.stringify({ schemaVersion: BOT_SESSION_SCHEMA + 1, botId: 'session-1', messages: [] }))
  assert.throws(() => openBotSessionStore({ dir }).get('session-1'), /BOT_SESSION_SCHEMA_NEWER/)
  writeFileSync(join(dir, 'session-2.json'), JSON.stringify({ schemaVersion: BOT_SESSION_SCHEMA, botId: 'other', messages: [] }))
  assert.throws(() => openBotSessionStore({ dir }).get('session-2'), /BOT_SESSION_MISMATCH/)
})

test('bot sessions: the transcript is bounded and says it was truncated', (t) => {
  const store = openBotSessionStore({ dir: tempDir(t), maxMessages: 10 })
  for (let index = 0; index < 12; index += 1) store.append('b1', [{ role: 'user', content: `m${index}` }])
  const session = store.get('b1')
  assert.equal(session.messages.length, 10)
  assert.equal(session.truncated, true)
  assert.equal(session.messages.at(-1).content, 'm11')
})

test('bot loop: an answer ends the turn and is recorded', async (t) => {
  const store = openBotSessionStore({ dir: tempDir(t) })
  const loop = createBotLoop({ store, provider: async () => ({ text: '完成了' }) })
  const result = await loop.run({ botId: 'b1', input: '做点事' })
  assert.equal(result.answer, '完成了')
  assert.equal(result.turns, 1)
  assert.deepEqual(result.toolCalls, [])
  const session = store.get('b1')
  assert.deepEqual(session.messages.map(m => m.role), ['user', 'assistant'])
})

test('bot loop: tool calls are dispatched and their results return to the provider', async (t) => {
  const store = openBotSessionStore({ dir: tempDir(t) })
  const seen = []
  let call = 0
  const loop = createBotLoop({
    store,
    provider: async ({ messages }) => {
      seen.push(messages)
      call += 1
      if (call === 1) return { toolCalls: [{ id: 't1', name: 'fs_read', args: { path: 'README.md' } }] }
      return { text: '读到了' }
    },
    tools: { call: async (name, args) => { assert.equal(name, 'fs_read'); assert.equal(args.path, 'README.md'); return { content: '# hi' } } },
  })
  const result = await loop.run({ botId: 'b1', input: '读一下' })
  assert.equal(result.answer, '读到了')
  assert.deepEqual(result.toolCalls, [{ id: 't1', name: 'fs_read' }])
  assert.equal(result.steps, 2)
  // The second provider call sees the tool result in the transcript.
  assert.equal(JSON.stringify(seen[1]).includes('# hi'), true)
})

test('bot loop: a cancel, a missing tool path and a step cap are explicit failures', async (t) => {
  const store = openBotSessionStore({ dir: tempDir(t) })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(createBotLoop({ store, provider: async () => ({ text: 'x' }) }).run({ botId: 'b1', input: 'x', signal: controller.signal }), /BOT_LOOP_CANCELLED/)

  await assert.rejects(createBotLoop({ store, provider: async () => ({ toolCalls: [{ id: 't', name: 'fs_read' }] }) }).run({ botId: 'b2', input: 'x' }), /BOT_LOOP_TOOLS_UNAVAILABLE/)

  const looping = createBotLoop({
    store, maxSteps: 3,
    provider: async () => ({ toolCalls: [{ id: 't', name: 'fs_read' }] }),
    tools: { call: async () => ({ ok: true }) },
  })
  await assert.rejects(looping.run({ botId: 'b3', input: 'x' }), /BOT_LOOP_STEP_LIMIT/)
})

test('bot loop: an invalid tool call or empty input never reaches a tool', async (t) => {
  const store = openBotSessionStore({ dir: tempDir(t) })
  let called = false
  const loop = createBotLoop({
    store,
    provider: async () => ({ toolCalls: [{ id: 't', name: '' }] }),
    tools: { call: async () => { called = true } },
  })
  await assert.rejects(loop.run({ botId: 'b1', input: 'x' }), /BOT_LOOP_TOOL_CALL_INVALID/)
  assert.equal(called, false)
  await assert.rejects(loop.run({ botId: 'b1', input: '   ' }), /BOT_LOOP_INPUT_REQUIRED/)
})

test('bot sessions: parseSession keeps only known fields', () => {
  const parsed = parseSession({ schemaVersion: BOT_SESSION_SCHEMA, botId: 'b', messages: [{ role: 'user', content: 'x', extra: 'ignored' }], secret: 'nope' }, 'b')
  assert.equal(parsed.messages[0].extra, undefined)
  assert.equal('secret' in parsed, false)
})
