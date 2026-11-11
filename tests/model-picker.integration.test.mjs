import './helpers/ui-dom-bootstrap.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
const parent = resolve('tmp/integration/model-picker'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'case-')), file = join(directory, 'ui.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/model-picker.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' } })
await writeFile(file, bundle.outputFiles[0].contents)
const { BotModelPicker } = await import(pathToFileURL(file))
const models = [{ provider: 'first', model: 'precise', label: '精确模型' }, { provider: 'second', model: 'writer', label: '写作模型' }]
async function fixture(t) {
  const dom = new JSDOM('<div id="root"></div><button id="outside">其他控件</button>', { url: 'http://model-picker.fixture/', pretendToBeVisual: true })
  // react-dom is imported with the component before this isolated document;
  // its legacy input-event detection therefore needs the fixture shims.
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }, prior = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'))
  const settle = work => act(async () => { await work(); await new Promise(setImmediate) }), choices = []
  const render = props => settle(() => root.render(React.createElement(BotModelPicker, { models, value: 'first/precise', onSelect: model => choices.push(model), ...props })))
  const q = selector => document.querySelector(selector), click = selector => settle(() => q(selector).click())
  const key = (target, value, extras = {}) => settle(() => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extras })))
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [name, value] of Object.entries(prior)) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name] } })
  return { render, settle, q, click, key, choices }
}
test('provider browsing changes no binding until an exact model is selected, then restores trigger focus', async t => {
  const f = await fixture(t); await f.render()
  await f.click('.bp-model-picker-trigger'); await f.click('[data-provider="second"]')
  assert.deepEqual(f.choices, [])
  assert.equal(f.q('[data-model-choice="first/precise"]'), null)
  await f.click('[data-model-choice="second/writer"]')
  assert.deepEqual(f.choices, [models[1]])
  assert.equal(f.q('[role="dialog"]'), null)
  assert.ok(document.activeElement === f.q('.bp-model-picker-trigger'), 'selection restores the trigger')
})
test('keyboard navigation, IME Escape, dismissal and focus trap work in the actual popover', async t => {
  const f = await fixture(t); await f.render(); await f.click('.bp-model-picker-trigger')
  const input = f.q('input')
  assert.ok(document.activeElement === input, 'the search receives focus')
  await f.key(input, 'Escape', { isComposing: true }); assert.ok(f.q('[role="dialog"]'))
  await f.key(input, 'ArrowDown'); assert.equal(document.activeElement.getAttribute('data-model-choice'), 'first/precise')
  await f.key(document.activeElement, 'End')
  await f.key(document.activeElement, 'Tab'); assert.ok(document.activeElement === input, 'last model wraps to the first control')
  await f.key(input, 'Escape'); assert.equal(f.q('[role="dialog"]'), null)
  await f.click('.bp-model-picker-trigger')
  await f.settle(() => f.q('#outside').dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
  assert.equal(f.q('[role="dialog"]'), null); assert.deepEqual(f.choices, [])
})
test('unavailable saved selection remains explicit, and disabling a picker retires its open menu', async t => {
  const f = await fixture(t); await f.render({ value: 'removed/model' })
  assert.match(f.q('[role="status"]').textContent, /重新选择或恢复连接/)
  assert.match(f.q('.bp-model-current').textContent, /removed\/model/)
  await f.click('.bp-model-picker-trigger'); await f.render({ disabled: true })
  assert.equal(f.q('[role="dialog"]'), null); assert.deepEqual(f.choices, [])
  await f.render({ models: [] }); assert.equal(f.q('.bp-model-picker-trigger').disabled, true)
})
