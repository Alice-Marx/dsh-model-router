import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBotDispatch } from '../packages/orchestration/src/bot-runtime-dispatch.mjs'
import { openRuntimeSwitch } from '../packages/orchestration/src/bot-runtime-switch.mjs'

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-dispatch-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const switchApi = openRuntimeSwitch({ file: join(dir, 'switch.json') })
  const calls = []
  const dispatch = createBotDispatch({
    switchApi,
    integration: async request => { calls.push(['integration', request.botId]); return { answer: '来自 Harness 会话' } },
    independent: async request => { calls.push(['independent', request.botId]); return { answer: '来自独立循环' } },
    now: () => 1_700_000_000_000,
  })
  return { switchApi, dispatch, calls }
}

test('dispatch: an unswitched Bot is served by the integration path', async (t) => {
  const { dispatch, calls } = await setup(t)
  const result = await dispatch.turn({ botId: 'session-1', input: 'hi' })
  assert.equal(result.answer, '来自 Harness 会话')
  assert.equal(result.runtime, 'integration')
  assert.deepEqual(calls, [['integration', 'session-1']])
})

test('dispatch: a moved Bot is served by the independent path, and only that one', async (t) => {
  const { switchApi, dispatch, calls } = await setup(t)
  await switchApi.move('session-1', 'independent')
  const result = await dispatch.turn({ botId: 'session-1', input: 'hi' })
  assert.equal(result.answer, '来自独立循环')
  assert.equal(result.runtime, 'independent')
  assert.deepEqual(calls, [['independent', 'session-1']])
  assert.deepEqual(dispatch.describe('session-1'), { botId: 'session-1', runtime: 'independent' })
})

test('dispatch: a caller pinned to the other runtime is refused, and nothing runs', async (t) => {
  const { dispatch, calls } = await setup(t)
  await assert.rejects(dispatch.turn({ botId: 'session-1', input: 'hi', runtime: 'independent' }), /运行时已切换/)
  assert.deepEqual(calls, [])
})

test('dispatch: a handler error propagates instead of falling back to the other runtime', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-dispatch-err-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const switchApi = openRuntimeSwitch({ file: join(dir, 'switch.json') })
  let integrationUsed = false
  const dispatch = createBotDispatch({
    switchApi,
    integration: async () => { integrationUsed = true; return {} },
    independent: async () => { throw Object.assign(new Error('provider down'), { code: 'PROVIDER_DOWN' }) },
  })
  await switchApi.move('b1', 'independent')
  await assert.rejects(dispatch.turn({ botId: 'b1', input: 'x' }), /provider down/)
  assert.equal(integrationUsed, false, 'a failing independent turn must not fall back')
})

test('dispatch: the result names the runtime and the Bot it served', async (t) => {
  const { dispatch } = await setup(t)
  const result = await dispatch.turn({ botId: 'session-9', input: 'hi' })
  assert.equal(result.botId, 'session-9')
  assert.equal(result.startedAt, 1_700_000_000_000)
  assert.equal(result.finishedAt, 1_700_000_000_000)
})

test('dispatch: an invalid Bot id is refused before any handler', async (t) => {
  const { dispatch, calls } = await setup(t)
  await assert.rejects(dispatch.turn({ botId: 'bad id' }), /INVALID_BOT_ID/)
  assert.throws(() => dispatch.describe(''), /INVALID_BOT_ID/)
  assert.deepEqual(calls, [])
})
