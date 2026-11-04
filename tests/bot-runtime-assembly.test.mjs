import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIndependentRuntime } from '../packages/orchestration/src/bot-runtime-assembly.mjs'

function runtime(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-assembly-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const calls = []
  const instance = createIndependentRuntime({
    dir,
    integration: async () => { calls.push('integration'); return { answer: 'Harness' } },
    providerFor: () => async () => ({ text: '独立循环' }),
    toolsFor: () => ({ names: ['fs_read'], call: async () => ({ content: 'hi' }) }),
    ...overrides,
  })
  return { instance, calls, dir }
}

test('assembly: before any move, every turn goes through the integration handler', async (t) => {
  const { instance, calls } = runtime(t)
  const result = await instance.turn({ botId: 'b1', input: 'hi' })
  assert.equal(result.runtime, 'integration')
  assert.deepEqual(calls, ['integration'])
  assert.equal(instance.describe('b1').runtime, 'integration')
})

test('assembly: after a move, the independent loop answers and the store keeps the turns', async (t) => {
  const { instance } = runtime(t)
  await instance.move('b1', 'independent')
  const result = await instance.turn({ botId: 'b1', input: '你好' })
  assert.equal(result.runtime, 'independent')
  assert.equal(result.answer, '独立循环')
  const inventory = instance.inventory(['b1'])
  assert.equal(inventory.length, 1)
  assert.equal(inventory[0].runtime, 'independent')
  assert.equal(inventory[0].turns, 1)
  assert.equal('messages' in inventory[0], true)
})

test('assembly: moving an unknown-provider Bot is allowed but its turn fails explicitly', async (t) => {
  const { instance } = runtime(t, { providerFor: () => null })
  await instance.move('b2', 'independent')
  await assert.rejects(instance.turn({ botId: 'b2', input: 'hi' }), /RUNTIME_PROVIDER_UNAVAILABLE/)
})

test('assembly: a busy Bot cannot be moved', async (t) => {
  const { instance } = runtime(t, { isBusy: botId => botId === 'busy' })
  await assert.rejects(instance.move('busy', 'independent'), /正在一轮对话中/)
  assert.equal(instance.describe('busy').runtime, 'integration')
})

test('assembly: a moved Bot gets a fresh loop, so an old provider is not reused', async (t) => {
  let version = 1
  const { instance } = runtime(t, { providerFor: () => async () => ({ text: `v${version}` }) })
  await instance.move('b1', 'independent')
  assert.equal((await instance.turn({ botId: 'b1', input: 'x' })).answer, 'v1')
  version = 2
  await instance.move('b1', 'integration')
  await instance.move('b1', 'independent')
  assert.equal((await instance.turn({ botId: 'b1', input: 'y' })).answer, 'v2')
})

test('assembly: close drops cached loops without touching transcripts', async (t) => {
  const { instance } = runtime(t)
  await instance.move('b1', 'independent')
  await instance.turn({ botId: 'b1', input: 'x' })
  instance.close()
  assert.equal(instance.inventory(['b1'])[0].turns, 1)
})

test('assembly: a move records counts only, and history is previewed and bounded', async (t) => {
  const { instance } = runtime(t)
  await instance.move('b1', 'independent')
  await instance.turn({ botId: 'b1', input: '第一轮：记住 SQLite 方案' })
  const moved = await instance.move('b1', 'integration')
  assert.equal(moved.changed, true)
  const listed = instance.list().find(row => row.botId === 'b1')
  assert.deepEqual(listed.snapshot ? { turns: listed.snapshot.turns, messages: listed.snapshot.messages } : null, { turns: 1, messages: 2 })
  assert.equal('content' in (listed.snapshot ?? {}), false, 'a snapshot carries counts, not message bodies')
  const history = instance.history('b1', { limit: 5, previewChars: 10 })
  assert.equal(history.length, 2)
  assert.equal(history[0].role, 'user')
  assert.equal(history[0].preview.length <= 10, true)
  assert.equal(history[0].chars >= 10, true)
  assert.equal('content' in history[0], false)
  assert.equal(instance.history('b1', { limit: 1 }).length, 1)
})

test('assembly: full text is available by position, and out-of-range is refused', async (t) => {
  const { instance } = runtime(t)
  await instance.move('b1', 'independent')
  await instance.turn({ botId: 'b1', input: '记住这件事' })
  const newest = instance.readMessage('b1', 0)
  assert.equal(newest.content, '独立循环')
  assert.equal(newest.role, 'assistant')
  const oldest = instance.readMessage('b1', 1)
  assert.equal(oldest.content, '记住这件事')
  assert.throws(() => instance.readMessage('b1', 99), /MESSAGE_NOT_FOUND/)
})
