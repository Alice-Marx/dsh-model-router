import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertServing, openRuntimeSwitch, SWITCH_SCHEMA } from '../packages/orchestration/src/bot-runtime-switch.mjs'

const temp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-switch-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'switch.json')
}

test('switch: a Bot nobody moved stays on the integration path', (t) => {
  const api = openRuntimeSwitch({ file: temp(t) })
  assert.equal(api.modeOf('session-1'), 'integration')
  assert.deepEqual(api.list(), [])
})

test('switch: moving is recorded once and reads back through a fresh handle', async (t) => {
  const file = temp(t)
  const api = openRuntimeSwitch({ file, now: () => 1_700_000_000_000 })
  const moved = await api.move('session-1', 'independent')
  assert.equal(moved.changed, true)
  assert.equal(moved.previous, 'integration')
  const reopened = openRuntimeSwitch({ file })
  assert.equal(reopened.modeOf('session-1'), 'independent')
  assert.deepEqual(reopened.list(), [{ botId: 'session-1', mode: 'independent', changedAt: 1_700_000_000_000 }])
})

test('switch: moving to the same mode changes nothing', async (t) => {
  const api = openRuntimeSwitch({ file: temp(t) })
  await api.move('b1', 'independent')
  assert.equal((await api.move('b1', 'independent')).changed, false)
})

test('switch: a busy Bot is never moved', async (t) => {
  const api = openRuntimeSwitch({ file: temp(t) })
  await assert.rejects(api.move('b1', 'independent', { isBusy: () => true }), /正在一轮对话中/)
  assert.equal(api.modeOf('b1'), 'integration')
  // An async busy check is awaited, not treated as false.
  await assert.rejects(api.move('b1', 'independent', { isBusy: async () => true }), /BOT_BUSY|正在一轮对话中/)
  assert.equal(api.modeOf('b1'), 'integration')
})

test('switch: only two modes exist and an unknown Bot id is refused', async (t) => {
  const api = openRuntimeSwitch({ file: temp(t) })
  await assert.rejects(api.move('b1', 'harness'), /INVALID_RUNTIME_MODE/)
  await assert.rejects(api.move('bad id', 'independent'), /INVALID_BOT_ID/)
  assert.equal(api.modeOf('b1'), 'integration')
})

test('switch: a stale caller cannot serve a moved Bot', async (t) => {
  const api = openRuntimeSwitch({ file: temp(t) })
  await api.move('b1', 'independent')
  assert.equal(assertServing(api, 'b1', 'independent'), 'independent')
  assert.throws(() => assertServing(api, 'b1', 'integration'), /运行时已切换/)
})

test('switch: a wrong schema is refused instead of guessed at', (t) => {
  const file = temp(t)
  writeFileSync(file, JSON.stringify({ schemaVersion: SWITCH_SCHEMA + 1, bots: {} }))
  assert.throws(() => openRuntimeSwitch({ file }).modeOf('b1'), /RUNTIME_SWITCH_SCHEMA/)
})

test('switch: reset returns a Bot to the default path', async (t) => {
  const api = openRuntimeSwitch({ file: temp(t) })
  await api.move('b1', 'independent')
  assert.equal(api.reset('b1').changed, true)
  assert.equal(api.modeOf('b1'), 'integration')
  assert.equal(api.reset('b1').changed, false)
})
