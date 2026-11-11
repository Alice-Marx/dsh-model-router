import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const parent = resolve('tmp/integration/web-panels/panel')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'case-')), file = join(directory, 'web-panel-page.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/web-panel-page.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom'], write: false })
await writeFile(file, bundle.outputFiles[0].contents)
const { WebPanelsPanel, WebPanelPins } = await import(pathToFileURL(file))

const panel = (id, name, url, position = 1) => ({ id, name, url, host: new URL(url).host, position })
const snapshot = (items, over = {}) => ({ schemaVersion: 1, observedAt: '2026-11-08T00:00:00.000Z', bots: [], readOnly: null,
  webPanels: { status: 'available', revision: over.revision ?? items.length, items, limits: { maxPanels: 6, maxNameChars: 40, maxNameBytes: 120, maxUrlBytes: 2048 } },
  ...over })

/** A Host double: every action the panel dispatches is recorded, and a test decides the answer. */
function hostDouble(items, answers = {}) {
  const dispatched = []
  const opened = []
  let panels = items, revision = items.length
  const api = {
    snapshot: async () => snapshot(panels, { revision }),
    dispatch: async (action, payload, signal) => {
      dispatched.push({ action, payload })
      if (answers[action]) return answers[action](payload, signal)
      if (action === 'webPanels.list') return { revision, panels, limits: { maxPanels: 6 } }
      if (action === 'webPanels.save') { revision += 1; const saved = { ...payload, id: payload.id ?? `panel-${revision}`, position: panels.length + 1 }; panels = [...panels, saved]; return { revision, panel: saved } }
      if (action === 'webPanels.remove') { revision += 1; panels = panels.filter(entry => entry.id !== payload.id); return { revision, removed: payload.id } }
      if (action === 'webPanels.order') { revision += 1; panels = payload.ids.map((id, index) => ({ ...panels.find(entry => entry.id === id), position: index + 1 })); return { revision, panels } }
      if (action === 'webPanels.probe') return { panelId: payload.id, framing: 'allowed', reason: null, host: '127.0.0.1:7841', checkedAt: 1 }
      throw Object.assign(new Error('unavailable'), { code: 'PRODUCT_ACTION_UNAVAILABLE' })
    },
  }
  return { api, dispatched, panels: () => panels, opened }
}

async function fixture(t) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://webpanel.fixture/', pretendToBeVisual: true })
  const values = { window: dom.window, document: dom.window.document, location: dom.window.location, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  const opened = []
  // The panel opens a page through the global open, which is what a browser
  // exposes; the double records the exact call so the test can assert the
  // features the product relies on.
  const previousOpen = globalThis.open
  globalThis.open = (url, target, features) => { opened.push({ url, target, features }); return {} }
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'))
  const settle = fn => act(async () => { await fn(); await new Promise(setImmediate) })
  const render = props => settle(() => root.render(React.createElement(WebPanelsPanel, { available: true, ...props })))
  const view = dom.window
  const q = selector => document.querySelector(selector)
  // A controlled input only reports a change through the prototype setter: React
  // tracks the value it wrote, and a plain assignment looks like nothing at all.
  const fill = (element, value) => act(async () => {
    Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set.call(element, value)
    element.dispatchEvent(new view.Event('input', { bubbles: true }))
    await new Promise(setImmediate)
  })
  t.after(async () => { await act(() => root.unmount()); view.close(); if (previousOpen === undefined) delete globalThis.open; else globalThis.open = previousOpen; for (const [key, value] of Object.entries(previous)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] } })
  return { render, settle, q, fill, dom: view.document, opened, view }
}

test('a pinned page is framed, and clicking another pin shows that page instead', async t => {
  const f = await fixture(t)
  const items = [panel('panel-1', 'Fleet board', 'http://127.0.0.1:7841/'), panel('panel-2', 'CI', 'https://ci.example.com/runs')]
  const host = hostDouble(items)
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot(items), onLeave: () => {} })
  const frame = f.q('.bp-webpanel-frame')
  assert.equal(frame.getAttribute('src'), 'http://127.0.0.1:7841/')
  assert.equal(frame.getAttribute('sandbox').includes('allow-top-navigation'), false, 'the frame never gets top-level navigation')
  assert.equal(frame.getAttribute('sandbox').includes('allow-same-origin'), true, 'a page keeps its own origin, or most dashboards break')
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer')
  await f.settle(() => f.q('.bp-webpanel-list li:nth-child(2) .bp-webpanel-pin').click())
  assert.equal(f.q('.bp-webpanel-frame').getAttribute('src'), 'https://ci.example.com/runs')
  assert.equal(f.q('.bp-webpanel-stage-name').textContent, 'CI')
  assert.equal(host.dispatched.some(call => call.action === 'webPanels.probe' && call.payload.id === 'panel-2'), true)
})

test('a page the Host says refuses framing is answered with the reason, and never framed', async t => {
  const f = await fixture(t)
  const items = [panel('panel-1', 'Globo', 'https://www.globo.com/')]
  const host = hostDouble(items, { 'webPanels.probe': async () => ({ panelId: 'panel-1', framing: 'blocked', reason: null, host: 'www.globo.com', checkedAt: 1 }) })
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot(items), onLeave: () => {} })
  assert.equal(f.q('.bp-webpanel-frame'), null)
  assert.match(f.q(".bp-webpanel-refused-body").textContent, /拒绝了被其他应用嵌入/)
  assert.match(f.q('.bp-webpanel-verdict').textContent, /www\.globo\.com/)
  await f.settle(() => f.q('.bp-webpanel-refused button').click())
  assert.deepEqual(f.opened[0], { url: 'https://www.globo.com/', target: '_blank', features: 'noopener,noreferrer' })
})

test('a page on this app own origin is never framed', async t => {
  const f = await fixture(t)
  const items = [panel('panel-1', 'Me', 'http://webpanel.fixture/settings')]
  const host = hostDouble(items)
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot(items), onLeave: () => {} })
  assert.equal(f.q('.bp-webpanel-frame'), null)
  assert.match(f.q('.bp-webpanel-refused-title').textContent, /不能显示应用自身的页面/)
})

test('typing a URL sends nothing; only an explicit save reaches the Host', async t => {
  const f = await fixture(t)
  const host = hostDouble([])
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot([]), onLeave: () => {} })
  await f.settle(() => f.q('.bp-webpanel-bar .bp-webpanel-button').click())
  const name = f.q('#bp-webpanel-draft-name'), url = f.q('#bp-webpanel-draft-url')
  await f.fill(name, 'Local board')
  await f.fill(url, 'http://127.0.0.1:7841/')
  host.dispatched.length = 0
  await f.settle(() => f.q(".bp-webpanel-editor .bp-webpanel-button-primary").click())
  assert.deepEqual(host.dispatched, [{ action: 'webPanels.save', payload: { name: 'Local board', url: 'http://127.0.0.1:7841/', expectedRevision: 0 } }])
  assert.match(f.q('.bp-webpanel-note-ok').textContent, /已固定该页面/)
  assert.equal(f.q('.bp-webpanel-editor'), null, 'the editor closes once the Host confirms')
})

test('a draft that is not a plain web page is refused locally, with the Host rule named', async t => {
  const f = await fixture(t)
  const host = hostDouble([])
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot([]), onLeave: () => {} })
  await f.settle(() => f.q('.bp-webpanel-bar .bp-webpanel-button').click())
  const name = f.q('#bp-webpanel-draft-name'), url = f.q('#bp-webpanel-draft-url')
  await f.fill(name, 'Board')
  await f.fill(url, 'javascript:alert(1)')
  host.dispatched.length = 0
  await f.settle(() => f.q(".bp-webpanel-editor .bp-webpanel-button-primary").click())
  assert.deepEqual(host.dispatched, [])
  assert.match(f.q('.bp-webpanel-editor [role=alert]').textContent, /http\/https/)
})

test('editing a panel is an explicit save of the whole panel', async t => {
  const f = await fixture(t)
  const items = [panel('panel-1', 'Fleet', 'http://127.0.0.1:7841/')]
  const host = hostDouble(items)
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot(items), onLeave: () => {} })
  await f.settle(() => f.q('.bp-webpanel-stage-tools button[title="修改名称或网址"]').click())
  const name = f.q('#bp-webpanel-draft-name'), url = f.q('#bp-webpanel-draft-url')
  assert.equal(name.value, 'Fleet')
  await f.fill(name, 'Fleet board')
  await f.fill(url, 'http://127.0.0.1:7842/')
  await f.settle(() => f.q(".bp-webpanel-editor .bp-webpanel-button-primary").click())
  assert.deepEqual(host.dispatched.find(call => call.action === 'webPanels.save'),
    { action: 'webPanels.save', payload: { id: 'panel-1', name: 'Fleet board', url: 'http://127.0.0.1:7842/', expectedRevision: 1 } })
  assert.equal(f.q('.bp-webpanel-editor'), null, 'the editor closes once the Host confirms')
})

test('removing the panel on screen leaves the workspace and frames nothing', async t => {
  const f = await fixture(t)
  const items = [panel('panel-1', 'Fleet', 'http://127.0.0.1:7841/')]
  const host = hostDouble(items)
  const left = []
  const props = { productApi: host.api, dispatch: host.api.dispatch, onLeave: () => left.push(1) }
  await f.render({ ...props, snapshot: snapshot(items) })
  await f.settle(() => f.q('.bp-webpanel-stage-tools .bp-webpanel-button-danger').click())
  assert.deepEqual(host.dispatched.find(call => call.action === 'webPanels.remove'),
    { action: 'webPanels.remove', payload: { id: 'panel-1', expectedRevision: 1 } })
  // The workspace re-reads the Host after the mutation, exactly as the product page does.
  await f.render({ ...props, snapshot: snapshot(host.panels()) })
  assert.deepEqual(left, [1])
  assert.equal(f.q('.bp-webpanel-frame'), null)
  assert.equal(f.q('.bp-webpanel-list'), null, 'the pin list is gone with the last panel')
  assert.match(f.dom.body.textContent, /还没有固定页面/)
})

test('moving a pin writes the whole new order, and the ends cannot move further', async t => {
  const f = await fixture(t)
  const items = [panel('panel-1', 'One', 'https://one.example/'), panel('panel-2', 'Two', 'https://two.example/')]
  const host = hostDouble(items)
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot(items), onLeave: () => {} })
  assert.equal(f.q('.bp-webpanel-list li:first-child button[title="上移"]').disabled, true)
  await f.settle(() => f.q('.bp-webpanel-list li:nth-child(2) button[title="上移"]').click())
  assert.deepEqual(host.dispatched.at(-1), { action: 'webPanels.order', payload: { ids: ['panel-2', 'panel-1'], expectedRevision: 2 } })
})

test('a Host refusal is answered with the reason, and a late answer cannot resurrect it', async t => {
  const f = await fixture(t)
  const items = [panel('panel-1', 'Fleet', 'http://127.0.0.1:7841/')]
  let release
  const host = hostDouble(items, { 'webPanels.probe': () => new Promise(resolve => { release = resolve }) })
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot(items), onLeave: () => {} })
  const failing = hostDouble(items, { 'webPanels.remove': async () => { throw Object.assign(new Error('stale'), { code: 'WEB_PANEL_REVISION_CONFLICT' }) } })
  await f.render({ productApi: failing.api, dispatch: failing.api.dispatch, snapshot: snapshot(items), onLeave: () => {} })
  await f.settle(() => f.q('.bp-webpanel-stage-tools .bp-webpanel-button-danger').click())
  assert.match(f.q('[role=alert]').textContent, /别处被改过/)
  // The first Host's answer arrives after its board is gone: nothing changes.
  release({ panelId: 'panel-1', framing: 'blocked', reason: null, host: '127.0.0.1:7841', checkedAt: 1 })
  await f.settle(() => undefined)
  assert.equal(f.q('.bp-webpanel-frame').getAttribute('src'), 'http://127.0.0.1:7841/', 'a stale verdict never replaces a live page')
})

test('a replaced Host mounts a fresh board, and its probe cannot name the old page', async t => {
  const f = await fixture(t)
  const first = [panel('panel-1', 'Fleet', 'http://127.0.0.1:7841/')]
  const host = hostDouble(first)
  await f.render({ productApi: host.api, dispatch: host.api.dispatch, snapshot: snapshot(first), onLeave: () => {} })
  assert.equal(f.q('.bp-webpanel-frame').getAttribute('src'), 'http://127.0.0.1:7841/')
  const second = [panel('panel-9', 'Other host', 'https://other.example/')]
  const other = hostDouble(second)
  await f.render({ productApi: other.api, dispatch: other.api.dispatch, snapshot: snapshot(second), onLeave: () => {} })
  assert.equal(f.q('.bp-webpanel-frame').getAttribute('src'), 'https://other.example/')
  assert.equal(f.q('.bp-webpanel-stage-name').textContent, 'Other host')
})

test('a Host without the panel directory says so instead of showing an empty list', async t => {
  const f = await fixture(t)
  const host = hostDouble([])
  await f.render({ productApi: host.api, dispatch: host.api.dispatch,
    snapshot: { schemaVersion: 1, webPanels: { status: 'blocked', reason: '宿主尚未提供固定网页面板目录。', nextAction: '接入固定网页面板存储。', items: [] } }, onLeave: () => {} })
  assert.match(f.q('.bp-webpanel-note').textContent, /宿主尚未提供固定网页面板目录/)
  assert.equal(f.q('.bp-webpanel-frame'), null)
})

test('a parent that drives the selection keeps the sidebar and the board in step', async t => {
  const f = await fixture(t)
  const items = [panel('panel-1', 'Fleet', 'http://127.0.0.1:7841/'), panel('panel-2', 'CI', 'https://ci.example.com/')]
  const host = hostDouble(items)
  let driven = 'panel-1'
  const props = { productApi: host.api, dispatch: host.api.dispatch, onLeave: () => {} }
  const shell = () => React.createElement('div', { className: 'bp-webpanel-shell' },
    React.createElement(WebPanelPins, { panels: items, activeId: driven, onSelect: id => { driven = id } }),
    React.createElement(WebPanelsPanel, { ...props, selectedId: driven, snapshot: snapshot(items) }))
  const { createRoot } = await import('react-dom/client')
  const holder = f.dom.createElement('div')
  f.dom.body.append(holder)
  const root = createRoot(holder)
  const rerender = () => act(async () => { root.render(shell()); await new Promise(setImmediate) })
  await rerender()
  assert.equal(f.q('.bp-webpanel-frame').getAttribute('src'), 'http://127.0.0.1:7841/')
  assert.equal(f.dom.querySelectorAll('.bp-webpanel-pins [aria-current="page"]').length, 1)
  await f.settle(() => f.dom.querySelectorAll('.bp-webpanel-pins .bp-webpanel-pin')[1].click())
  assert.equal(driven, 'panel-2')
  await rerender()
  assert.equal(f.q('.bp-webpanel-frame').getAttribute('src'), 'https://ci.example.com/')
  assert.equal(f.q('.bp-webpanel-stage-name').textContent, 'CI')
  assert.equal(f.dom.querySelector('.bp-webpanel-pins [aria-current="page"]').textContent.includes('CI'), true)
  await act(async () => { root.unmount(); await new Promise(setImmediate) })
  holder.remove()
})

test('the sidebar pin list opens a page and marks the current one', async t => {  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://webpanel.fixture/' })
  const values = { window: dom.window, document: dom.window.document, location: dom.window.location, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'))
  const chosen = []
  const items = [panel('panel-1', 'Fleet', 'http://127.0.0.1:7841/'), panel('panel-2', 'CI', 'https://ci.example.com/')]
  await act(async () => { root.render(React.createElement(WebPanelPins, { panels: items, activeId: 'panel-2', onSelect: id => chosen.push(id) })); await new Promise(setImmediate) })
  assert.equal(document.querySelectorAll('.bp-webpanel-pins .bp-webpanel-pin').length, 2)
  assert.equal(document.querySelectorAll('.bp-webpanel-pins [aria-current="page"]').length, 1)
  await act(async () => { document.querySelectorAll('.bp-webpanel-pins .bp-webpanel-pin')[0].click(); await new Promise(setImmediate) })
  assert.deepEqual(chosen, ['panel-1'])
  await act(async () => root.unmount())
  dom.window.close()
  for (const [key, value] of Object.entries(previous)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }
})
