import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'

// The panel's scope guards, in a real DOM with a mock Host: a late answer from a
// previous Host must never land in the new one, a deleted Bot must stop serving
// requests, a cancel must reach the Host, and a failed export must never be
// reported as a completed one. Synthetic data only — no real Host, no user data.

const parent = resolve('tmp/integration/data-panel-scope'); fs.mkdirSync(parent, { recursive: true })
const dir = fs.mkdtempSync(join(parent, 'run-')), compiled = join(dir, 'panel.mjs')
await build({ entryPoints: ['apps/integration-client/data-panel.jsx'], outfile: compiled, bundle: true, platform: 'node', format: 'esm', external: ['react'], absWorkingDir: process.cwd() })
const { DataPanel, DataChart } = await import(pathToFileURL(compiled).href)

const h = (type, props, ...children) => React.createElement(type, props, ...children)
const CATALOG = { tables: [{ name: 'sales', columns: [{ name: 'region', type: 'TEXT' }, { name: 'sales', type: 'INTEGER' }] }], cards: [] }
const tick = (ms = 10) => new Promise(done => setTimeout(done, ms))

/** A mock Host whose answers can be delayed, and which records every call. */
const host = (handlers = {}) => {
  const calls = []
  const transport = async (action, payload, signal) => {
    calls.push({ action, payload, signal })
    const handler = handlers[action]
    return typeof handler === 'function' ? handler(payload, signal) : (handler ?? {})
  }
  return { transport, calls }
}

const mount = async element => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const keys = ['window', 'document', 'Element', 'HTMLElement', 'HTMLTextAreaElement', 'IS_REACT_ACT_ENVIRONMENT', 'AbortController']
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  const target = dom.window.document.getElementById('root')
  const root = createRoot(target)
  await act(async () => { root.render(element) })
  const close = async () => {
    await act(async () => root.unmount())
    for (const key of keys) globalThis[key] = original[key]
    dom.window.close()
  }
  return { dom, root, element: target, close }
}

const panel = (props, snapshot) => h(DataPanel, { snapshot, ...props })
const byText = (element, text, selector = 'button') => [...element.querySelectorAll(selector)].find(entry => entry.textContent === text)

test('panel scope: a late answer from the previous Host is dropped, not applied', async () => {
  let release
  const first = host({ 'data.catalog': () => new Promise(resolve => { release = () => resolve({ tables: [{ name: 'stale_table', columns: [] }], cards: [] }) }) })
  const second = host({ 'data.catalog': () => CATALOG })
  const props = { transport: first.transport, scope: { id: 'first' }, requestTimeoutMs: 5000 }
  const view = await mount(panel(props, { bots: [{ id: 'a', name: 'A' }] }))
  try {
    await act(async () => { await tick() })
    assert.equal(first.calls.length, 1, 'the first Host was asked for its catalog')
    // The Host is replaced while the first answer is still on the wire.
    await act(async () => { view.root.render(panel({ transport: second.transport, scope: { id: 'second' }, requestTimeoutMs: 5000 }, { bots: [{ id: 'a', name: 'A' }] })) })
    await act(async () => { await tick() })
    assert.match(view.element.textContent, /sales/)
    // The stale answer finally arrives: it must not overwrite the new Host's data.
    await act(async () => { release(); await tick(20) })
    assert.ok(!view.element.textContent.includes('stale_table'), 'a late answer from the previous Host is discarded')
    assert.match(view.element.textContent, /sales/)
    assert.equal(view.element.querySelector('[role=alert]'), null)
  } finally { await view.close() }
})

test('panel scope: an in-flight request is aborted when the panel unmounts', async () => {
  let seenSignal = null
  const slow = host({ 'data.catalog': (_payload, signal) => { seenSignal = signal; return new Promise(() => {}) } })
  const view = await mount(panel({ transport: slow.transport, scope: { id: 'only' }, requestTimeoutMs: 5000 }, { bots: [{ id: 'a', name: 'A' }] }))
  await act(async () => { await tick() })
  assert.ok(seenSignal, 'the request carried an abort signal')
  assert.equal(seenSignal.aborted, false)
  await view.close()
  assert.equal(seenSignal.aborted, true, 'the request was aborted, not left running')
})

test('panel scope: a request that outlives its budget is reported as a timeout', async () => {
  const hanging = host({ 'data.catalog': () => new Promise(() => {}) })
  const view = await mount(panel({ transport: hanging.transport, scope: { id: 'x' }, requestTimeoutMs: 30 }, { bots: [{ id: 'a', name: 'A' }] }))
  try {
    await act(async () => { await tick(80) })
    assert.match(view.element.querySelector('[role=alert]').textContent, /超时/)
    assert.equal(view.element.textContent.includes('sales'), false)
  } finally { await view.close() }
})

test('panel scope: a deleted Bot stops serving requests and says so', async () => {
  const h1 = host({ 'data.catalog': () => CATALOG })
  const props = { transport: h1.transport, scope: { id: 'x' }, requestTimeoutMs: 5000 }
  const view = await mount(panel(props, { bots: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }))
  try {
    await act(async () => { await tick() })
    assert.equal(h1.calls[0].payload.botId, 'a')
    h1.calls.length = 0
    // Bot "a" is gone from the team.
    await act(async () => { view.root.render(panel(props, { bots: [{ id: 'b', name: 'B' }] })) })
    await act(async () => { await tick() })
    assert.ok(h1.calls.every(call => call.payload.botId === 'b'), 'no request is sent for the removed Bot')
    assert.match(view.element.textContent, /已不在团队中/)
    assert.equal(view.element.querySelector('select[aria-label="数据 Bot"]').value, 'b')
  } finally { await view.close() }
})

test('panel scope: cancelling reaches the Host as a stop request', async () => {
  let releaseQuery
  const h1 = host({
    'data.catalog': () => CATALOG,
    'data.sql': () => new Promise(resolve => { releaseQuery = resolve }),
    'data.cancel': () => ({ cancelled: true }),
  })
  const view = await mount(panel({ transport: h1.transport, scope: { id: 'x' }, requestTimeoutMs: 5000 }, { bots: [{ id: 'a', name: 'A' }] }))
  try {
    await act(async () => { await tick() })
    await act(async () => { byText(view.element, '查询').click() })
    await act(async () => { await tick() })
    assert.ok(h1.calls.some(call => call.action === 'data.sql'), 'the query reached the Host')
    // The user cancels while the answer is still missing.
    await act(async () => { byText(view.element, '取消执行').click() })
    await act(async () => { await tick() })
    assert.ok(h1.calls.some(call => call.action === 'data.cancel'), 'the cancel was dispatched to the Host')
    // The answer arrives afterwards: it must be dropped.
    await act(async () => { releaseQuery({ columns: [], rows: [], rowCount: 0 }); await tick(20) })
    assert.equal(view.element.textContent.includes('0 行'), false, 'the late query result is discarded')
    assert.match(view.element.textContent, /已请求取消/)
  } finally { await view.close() }
})

test('panel scope: a failed export is reported as a failure, never as a completed export', async () => {
  const h1 = host({
    'data.catalog': () => CATALOG,
    'data.export': () => ({ error: { code: 'output_too_large', message: '导出超过资料库单文件上限。' } }),
  })
  const view = await mount(panel({ transport: h1.transport, scope: { id: 'x' }, requestTimeoutMs: 5000 }, { bots: [{ id: 'a', name: 'A' }] }))
  try {
    await act(async () => { await tick() })
    await act(async () => { byText(view.element, '导出 CSV').click() })
    await act(async () => { await tick(20) })
    assert.match(view.element.querySelector('[role=alert]').textContent, /资料库单文件上限/)
    assert.ok(!view.element.textContent.includes('已导出'), 'a failed export is never described as exported')
  } finally { await view.close() }
})

test('panel scope: a completed export reports the rows written and the source total', async () => {
  const h1 = host({
    'data.catalog': () => CATALOG,
    'data.export': () => ({ path: 'exports/sales.csv', rowCount: 4, sourceRowCount: 5, bytes: 96, truncated: true }),
  })
  const view = await mount(panel({ transport: h1.transport, scope: { id: 'x' }, requestTimeoutMs: 5000 }, { bots: [{ id: 'a', name: 'A' }] }))
  try {
    await act(async () => { await tick() })
    await act(async () => { byText(view.element, '导出 CSV').click() })
    await act(async () => { await tick(20) })
    const status = view.element.querySelector('[role=status]').textContent
    assert.match(status, /已导出 4 行/)
    assert.match(status, /源共 5 行/)
    assert.match(status, /已截断/)
    assert.match(status, /exports\/sales\.csv/)
  } finally { await view.close() }
})

test('panel scope: a saved card is re-opened by its id, so a chart card can come back', async () => {
  const chartCard = { id: 'c_1', kind: 'chart', title: '各地区销售额', rowCount: 3, chart: { kind: 'chart', type: 'bar', xLabel: 'region', yLabel: 'sales', series: [{ key: 'series', points: [{ x: 'North', y: 180 }, { x: 'South', y: 280 }] }] } }
  const h1 = host({
    'data.catalog': () => ({ tables: CATALOG.tables, cards: [{ id: 'c_1', title: '各地区销售额', kind: 'chart', rowCount: 3 }] }),
    'data.show': payload => {
      assert.equal(payload.cardId, 'c_1', 'a card is opened by its id, never as a table name')
      assert.equal(payload.table, undefined)
      return chartCard
    },
  })
  const view = await mount(panel({ transport: h1.transport, scope: { id: 'x' }, requestTimeoutMs: 5000 }, { bots: [{ id: 'a', name: 'A' }] }))
  try {
    await act(async () => { await tick() })
    await act(async () => { byText(view.element, '各地区销售额').click() })
    await act(async () => { await tick(20) })
    assert.ok(view.element.querySelector('.bp-data-chart svg'), 'the saved chart card renders again')
    assert.match(view.element.textContent, /各地区销售额/)
  } finally { await view.close() }
})

test('panel chart: a negative bar is drawn from the zero baseline and a NaN point is dropped', () => {
  // Geometry: 640x260, pad {12,12,44,52} → plot height 204. min -50, max 50, so
  // yOf(v) = 216 - (v + 50) * 2.04: yOf(0) = 114, yOf(50) = 12, yOf(-50) = 216.
  const html = renderToStaticMarkup(h(DataChart, {
    chart: { kind: 'chart', type: 'bar', xLabel: 'region', yLabel: 'delta', series: [{ key: 's', points: [{ x: 'up', y: 50 }, { x: 'down', y: -50 }, { x: 'broken', y: NaN }, { x: 'inf', y: Infinity }] }] },
  }))
  const rects = [...html.matchAll(/<rect[^>]*>/g)].map(match => match[0])
  assert.equal(rects.length, 2, 'only the two finite points become bars')
  const geometry = rects.map(rect => {
    const attrs = Object.fromEntries([...rect.matchAll(/(\w+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
    return { y: Number(attrs.y), height: Number(attrs.height), width: Number(attrs.width) }
  })
  const zero = 114
  const positive = geometry.find(entry => entry.y < zero)
  const negative = geometry.find(entry => entry.y >= zero)
  assert.deepEqual({ y: positive.y, height: positive.height }, { y: 12, height: 102 }, 'a positive bar grows up from the zero baseline')
  assert.deepEqual({ y: negative.y, height: negative.height }, { y: zero, height: 102 }, 'a negative bar starts ON the zero baseline and grows down')
  assert.ok(!/NaN|Infinity/.test(html), 'no non-finite value reaches the SVG')
  assert.ok(!html.includes('<script'))
})

test('panel chart: an area closes on the zero baseline', () => {
  const html = renderToStaticMarkup(h(DataChart, {
    chart: { kind: 'chart', type: 'area', xLabel: 'day', yLabel: 'v', series: [{ key: 's', points: [{ x: 'a', y: 10 }, { x: 'b', y: -10 }] }] },
  }))
  const area = /<path d="([^"]+)" fill="/.exec(html)[1]
  // min -10, max 10 → yOf(v) = 216 - (v + 10) * 10.2, so yOf(0) = 114.
  assert.ok(area.includes(' 114 Z'), 'the filled region closes on the zero baseline, not the plot bottom')
  assert.ok(!area.includes(' 220 Z'), 'the plot bottom is not used as the baseline')
})

test('panel wiring: the product page renders the data section and survives a Host swap', async () => {
  const pageBundle = join(dir, 'page.mjs')
  await build({ entryPoints: ['apps/integration-client/panels.jsx'], outfile: pageBundle, bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom'], loader: { '.css': 'text' } })
  const { ProductPage } = await import(pathToFileURL(pageBundle).href)
  const { createProductReadModel } = await import('../modules/bot-runtime/read-model.mjs')
  const channel = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: { 'data.catalog': () => CATALOG } })
  const apiFor = () => ({
    snapshot: async () => ({ schemaVersion: 1, bots: [{ id: 'a', name: 'A' }], availableActions: ['data.catalog'], observedAt: 1 }),
    dispatch: async (action, payload) => channel.dispatch({ action, payload }, { kind: 'owner' }),
  })
  const view = await mount(h(ProductPage, { section: 'data', productApi: apiFor() }))
  try {
    await act(async () => { await tick(30) })
    assert.match(view.element.textContent, /sales/, 'the panel is wired into the product page')
    assert.equal(view.element.querySelector('select[aria-label="数据 Bot"]').value, 'a')
    // A new Host handle: the panel re-reads instead of keeping the old data.
    await act(async () => { view.root.render(h(ProductPage, { section: 'data', productApi: apiFor() })) })
    await act(async () => { await tick(30) })
    assert.match(view.element.textContent, /sales/)
    assert.equal(view.element.querySelector('[role=alert]'), null)
  } finally { await view.close() }
})
