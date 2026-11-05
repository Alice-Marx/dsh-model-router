import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { build } from 'esbuild'
import { createBotRoutineStore } from '../packages/orchestration/src/bot-routine-store.mjs'
import { createAcknowledgedRoutineRecorder } from '../apps/integration-client/routine-recorder.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

const require = createRequire(resolve('tests/fixtures/integration-host/package.json')), { JSDOM } = require('jsdom')
const parent = resolve('tmp/integration/routines-panel'); mkdirSync(parent, { recursive: true })
const dir = mkdtempSync(join(parent, 'case-')), compiled = join(dir, 'panel.mjs')
await build({ entryPoints: ['apps/integration-client/routines-panel.jsx'], outfile: compiled, bundle: true, platform: 'node', format: 'esm', external: ['react'] })
const { RoutineCaptureControls } = await import(pathToFileURL(compiled))

test('recording controls wait for ACK/release and save the demonstrated routine through the authenticated owner channel', async () => {
  const store = createBotRoutineStore({ dir: join(dir, 'store') }), recorder = createAcknowledgedRoutineRecorder()
  const calls = [], channel = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: {
    'routine.save': input => { calls.push(input); return store.save(input.botId, input.routine) },
  } })
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const keys = ['window', 'document', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'], previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const display = { displayId: 'monitor-a', width: 800, height: 600, coordinateSpace: 'display-physical-pixels' }
  let released = false
  const button = label => [...container.querySelectorAll('button')].find(item => item.textContent === label)
  try {
    await act(async () => root.render(React.createElement(RoutineCaptureControls, { recorder, sessionId: 'desktop-a', metadata: display,
      mode: 'control', connected: true, drainInputs: async () => {}, releaseInput: async () => { released = true; return { ok: true } },
      saveRoutine: routine => channel.dispatch({ action: 'routine.save', payload: { botId: 'bot-a', routine } }, { kind: 'owner' }),
    })))
    const name = container.querySelector('input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(name, '演示保存')
      name.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => button('开始录制').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    const event = { type: 'text', text: '确认过的文字' }, meta = { id: 1, sessionId: 'desktop-a', sentAt: Date.now() }
    await act(async () => recorder.inputSent(event, meta))
    assert.equal(button('结束并保存').disabled, true, 'unacknowledged input is not a saveable demonstration')
    await act(async () => recorder.inputAcknowledged(event, { ...meta, acknowledgedAt: Date.now() }))
    assert.equal(button('结束并保存').disabled, false)
    await act(async () => button('结束并保存').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    assert.equal(released, true); assert.equal(calls.length, 1); assert.equal(store.list('bot-a').length, 1); assert.equal(store.list('bot-b').length, 0)
    assert.equal(JSON.parse(readFileSync(store.file)).bots['bot-a'][0].steps[0].event.text, event.text)
    assert.match(container.textContent, /例行任务已保存/u)
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
  }
})

test('recording controls retain the draft and show an unconfirmed save until a saved record is returned', async () => {
  const store = createBotRoutineStore({ dir: join(dir, 'unconfirmed-store') }), recorder = createAcknowledgedRoutineRecorder()
  const channel = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: { 'routine.save': input => store.save(input.botId, input.routine) } })
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const keys = ['window', 'document', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'], previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const display = { displayId: 'monitor-a', width: 800, height: 600, coordinateSpace: 'display-physical-pixels' }
  let calls = 0, releases = 0
  const button = label => [...container.querySelectorAll('button')].find(item => item.textContent === label)
  try {
    await act(async () => root.render(React.createElement(RoutineCaptureControls, { recorder, sessionId: 'desktop-a', metadata: display,
      mode: 'control', connected: true, drainInputs: async () => {}, releaseInput: async () => { releases++; return { ok: true } },
      saveRoutine: routine => ++calls === 1 ? undefined : channel.dispatch({ action: 'routine.save', payload: { botId: 'bot-a', routine } }, { kind: 'owner' }),
    })))
    const name = container.querySelector('input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(name, '确认保存')
      name.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => button('开始录制').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    const event = { type: 'text', text: '保留草稿' }, meta = { id: 1, sessionId: 'desktop-a', sentAt: Date.now() }
    await act(async () => { recorder.inputSent(event, meta); recorder.inputAcknowledged(event, meta) })
    await act(async () => button('结束并保存').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    assert.match(container.textContent, /保存尚未确认/u); assert.doesNotMatch(container.textContent, /例行任务已保存/u)
    assert.equal(store.list('bot-a').length, 0); assert.equal(recorder.snapshot.status, 'finished'); assert.ok(button('重试保存'))
    await act(async () => button('重试保存').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    assert.equal(calls, 2); assert.equal(releases, 1, 'retrying persistence does not repeat any desktop inputs or release')
    assert.equal(store.list('bot-a').length, 1); assert.match(container.textContent, /例行任务已保存/u)
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
  }
})
