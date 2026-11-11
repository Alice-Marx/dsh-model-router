import './helpers/ui-dom-bootstrap.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createBotLibrary } from '../packages/orchestration/src/bot-library.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

const parent = resolve('tmp/integration/product-library-sequence'); fs.mkdirSync(parent, { recursive: true })
const dir = fs.mkdtempSync(join(parent, 'run-')), compiled = join(dir, 'page.mjs')
await build({ entryPoints: ['apps/integration-client/panels.jsx'], outfile: compiled, bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-dom/*'] , loader: { '.css': 'text' } })
const { ProductPage, ProductNavigation } = await import(pathToFileURL(compiled))
const { PRODUCT_PANELS } = await import('../apps/integration-client/api.mjs')

test('a product page permits a successful upload to immediately refresh its library through the same owner dispatcher', async () => {
  const library = createBotLibrary({ root: join(dir, 'files'), fs }), calls = []
  const channel = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: {
    'library.list': value => library.list(value.botId, value.relativePath),
    'library.upload': value => library.upload(value.botId, value.relativePath, value.contentBase64),
  } })
  const api = { snapshot: async () => ({ schemaVersion: 1, bots: [{ id: 'main', name: 'Main' }], observedAt: Date.now() }),
    dispatch: async (action, payload) => { calls.push(action); return channel.dispatch({ action, payload }, { kind: 'owner' }) } }
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' }), keys = ['window','document','Element','HTMLElement','File','FileReader','IS_REACT_ACT_ENVIRONMENT']
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  const element = dom.window.document.getElementById('root'), root = createRoot(element)
  try {
    await act(async () => root.render(React.createElement(ProductPage, { section: 'library', productApi: api })))
    const file = new dom.window.File(['confirmed upload'], 'sequence.txt', { type: 'text/plain' }), input = element.querySelector('input[type=file]')
    assert.equal(input.disabled, false)
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await new Promise(done => setTimeout(done, 40)) })
    assert.equal(library.read('main', 'sequence.txt'), 'confirmed upload')
    assert.match(element.textContent, /sequence.txt/)
    assert.deepEqual(calls, ['library.list','library.upload','library.list'])
    assert.equal(element.querySelector('[role=alert]'), null)
  } finally { await act(async () => root.unmount()); for (const key of keys) globalThis[key] = original[key]; dom.window.close() }
})

test('binding page reads optional catalog once and stays writable after a snapshot refresh', async () => {
  const calls = [], api = { snapshot: async () => ({ schemaVersion: 1, bots: [], availableActions: ['roles.list'], observedAt: Date.now() }),
    dispatch: async action => { calls.push(action); return [] } }
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' }), keys = ['window','document','Element','HTMLElement','IS_REACT_ACT_ENVIRONMENT']
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  const element = dom.window.document.getElementById('root'), root = createRoot(element)
  try {
    await act(async () => { root.render(React.createElement(ProductPage, { section: 'bindings', productApi: api })); await new Promise(done => setTimeout(done, 20)) })
    await act(async () => { await new Promise(done => setTimeout(done, 20)) })
    const refresh = element.querySelector('button.bp-refresh')
    assert.deepEqual(calls, ['roles.list'])
    assert.equal(refresh.disabled, false)
    await act(async () => refresh.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    assert.deepEqual(calls, ['roles.list'])
    assert.equal(refresh.disabled, false)
    assert.equal(element.querySelector('[role=alert]'), null)
  } finally { await act(async () => root.unmount()); for (const key of keys) globalThis[key] = original[key]; dom.window.close() }
})

test('workspace navigation retains the selected page when the Host remounts its sidebar', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' }), keys = ['window','document','IS_REACT_ACT_ENVIRONMENT']
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  const element = dom.window.document.getElementById('root'), root = createRoot(element), opened = []
  const props = { panels: PRODUCT_PANELS, openPanel: id => opened.push(id) }
  try {
    await act(async () => root.render(React.createElement(ProductNavigation, { ...props, key: 'first' })))
    await act(async () => element.querySelector('button[aria-label="任务"]').click())
    await act(async () => root.render(React.createElement(ProductNavigation, { ...props, key: 'second' })))
    assert.deepEqual(opened, [PRODUCT_PANELS.tasks])
    assert.equal(element.querySelector('button[aria-label="任务"]').getAttribute('aria-current'), 'page')
    assert.equal(element.querySelectorAll('button[aria-current=page]').length, 1)
  } finally { await act(async () => root.unmount()); for (const key of keys) globalThis[key] = original[key]; dom.window.close() }
})
