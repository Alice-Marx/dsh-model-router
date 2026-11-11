import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createProductApi } from '../apps/integration-client/api.mjs'

const parent = resolve('tmp/integration/web-panel-pins'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'case-')), file = join(directory, 'pins.mjs')
const built = await build({ entryPoints: ['apps/integration-client/web-panel-pins-live.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom'], write: false })
await writeFile(file, built.outputFiles[0].contents)
const { WebPanelPinsLive } = await import(pathToFileURL(file))
const pin = name => ({ id: name, name, host: 'localhost:3000', url: 'http://localhost:3000/' })
const response = value => ({ ok: true, status: 200, json: async () => ({ ok: true, value }) })

test('sidebar pins use the narrow directory, refresh after confirmed mutations and ignore retired Host responses', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://pins.fixture/' })
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } })
  const settle = fn => act(async () => { await fn?.(); await new Promise(setImmediate) })
  let rows = [pin('A')], oldRead, hold = false
  const calls = [], selected = []
  const a = createProductApi(async (_, init) => {
    const { action } = JSON.parse(init.body); calls.push(action)
    if (action === 'webPanels.list' && hold) return new Promise(done => { oldRead = { done, signal: init.signal } })
    if (action === 'webPanels.list') return response({ panels: rows })
    if (action === 'webPanels.save') { rows = [pin('新增')]; return response({ revision: 2 }) }
    throw new Error(`unexpected ${action}`)
  })
  const render = productApi => settle(() => root.render(React.createElement(WebPanelPinsLive, { productApi, onSelect: id => selected.push(id) })))
  await render(a)
  assert.ok(document.body.textContent.includes('A'))
  await settle(() => a.dispatch('webPanels.save', {}))
  assert.ok(document.body.textContent.includes('新增'), 'the same real API notifies the sidebar after successful save')
  await settle(() => document.querySelector('button').click())
  assert.deepEqual(selected, ['新增'])
  assert.equal(calls.includes('snapshot'), false, 'mounting contacts never loads the entire money/task snapshot')
  hold = true
  await settle(() => window.dispatchEvent(new window.Event('focus')))
  assert.ok(oldRead)
  const b = createProductApi(async () => response({ panels: [pin('B')] }))
  await render(b)
  assert.equal(oldRead.signal.aborted, true)
  await settle(() => oldRead.done(response({ panels: [pin('退休宿主')] })))
  assert.ok(document.body.textContent.includes('B'))
  assert.equal(document.body.textContent.includes('退休宿主'), false)
})
