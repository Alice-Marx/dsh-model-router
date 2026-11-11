import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const parent = resolve('tmp/integration/notifications/panel'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'case-')), file = join(directory, 'ui.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/notifications-panel.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom'], write: false })
await (await import('node:fs/promises')).writeFile(file, bundle.outputFiles[0].contents)
const { NotificationsPanel, formatAt } = await import(pathToFileURL(file))

const item = (seq, over = {}) => ({ seq, kind: 'settled', category: 'succeeded', tone: 'ok', at: 1000, botId: 'bot-a', botName: '小助手', taskId: `task-${seq}`, attemptId: `attempt-${seq}`, outcome: 'succeeded', code: null, read: false, isNew: true, text: '小助手 的任务已完成', ...over })
const page = (items, over = {}) => ({ schemaVersion: 1, items, nextBefore: null, maxSeq: items[0]?.seq ?? 0, unreadCount: items.filter(i => !i.read).length, cursorSeq: 0, baselineSeq: 0, ...over })
// A Host double that records every action the panel dispatches and lets a test swap the list result.
const makeApi = list => {
  const dispatched = []
  return { dispatched, api: { dispatch: (action, payload, signal) => {
    dispatched.push({ action, payload })
    if (action === 'notifications.list') return list(payload, signal)
    if (action === 'notifications.read') return Promise.resolve({ schemaVersion: 1, status: 'available', unreadCount: 0 })
    if (action === 'notifications.markAll') return Promise.resolve({ schemaVersion: 1, status: 'available', unreadCount: 0, cursorSeq: 3 })
    return Promise.reject(Object.assign(new Error('unavailable'), { code: 'PRODUCT_ACTION_UNAVAILABLE' }))
  } } }
}

async function fixture(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://notifications.fixture/', pretendToBeVisual: true })
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'))
  const settle = fn => act(async () => { await fn(); await new Promise(setImmediate) })
  const navigated = []
  const render = props => settle(() => root.render(React.createElement(NotificationsPanel, { onNavigate: input => navigated.push(input), ...props })))
  const hidden = value => settle(() => { Object.defineProperty(document, 'hidden', { value, configurable: true }); document.dispatchEvent(new dom.window.Event('visibilitychange')) })
  const q = selector => document.querySelector(selector)
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [key, value] of Object.entries(previous)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] } })
  return { render, settle, hidden, navigated, q, doc: dom.window.document }
}

test('the panel shows the unread count, opens the original detail, and gives read feedback', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi(() => Promise.resolve(page([item(3, { read: false }), item(2, { read: true }), item(1, { read: true })], { unreadCount: 1 })))
  await f.render({ productApi: api, available: true })
  assert.equal(f.q('.bp-notifications-badge')?.textContent, '1')
  assert.equal(f.doc.querySelectorAll('.bp-notification').length, 3)
  assert.ok(dispatched.some(d => d.action === 'notifications.list'))
  await f.settle(() => f.q('.bp-notification[data-seq="3"] .bp-notification-open').click())
  assert.deepEqual(f.navigated, [{ section: 'tasks', botId: 'bot-a', taskId: 'task-3', attemptId: 'attempt-3' }])
  await f.settle(() => f.q('.bp-notification[data-seq="3"] .bp-notification-read').click())
  assert.ok(dispatched.some(d => d.action === 'notifications.read' && d.payload.seq === 3))
  assert.equal(f.q('.bp-notifications-badge'), null, 'the badge clears once nothing is unread')
  assert.equal(f.q('.bp-notification[data-seq="3"] .bp-notification-read'), null, 'a read row drops its read button')
})

test('mark-all read clears every unread through one Host action', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi(() => Promise.resolve(page([item(3, { read: false }), item(2, { read: false })], { unreadCount: 2 })))
  await f.render({ productApi: api, available: true })
  assert.equal(f.q('.bp-notifications-badge')?.textContent, '2')
  await f.settle(() => f.q('.bp-notifications-markall').click())
  assert.ok(dispatched.some(d => d.action === 'notifications.markAll'))
  assert.equal(f.q('.bp-notifications-badge'), null)
  assert.equal(f.doc.querySelectorAll('.bp-notification-read').length, 0)
})

test('replacing the Host aborts its pending read and a late result cannot change the new feed', async t => {
  const f = await fixture(t)
  let oldSignal, finish
  const oldApi = { dispatch: (action, payload, signal) => action === 'notifications.list' ? (oldSignal = signal, new Promise(resolve => { finish = resolve })) : Promise.reject(new Error('x')) }
  await f.render({ productApi: oldApi, available: true })
  const newApi = { dispatch: action => action === 'notifications.list' ? Promise.resolve(page([item(9, { read: false })], { unreadCount: 1 })) : Promise.reject(new Error('x')) }
  await f.render({ productApi: newApi, available: true })
  assert.equal(oldSignal.aborted, true)
  assert.equal(f.q('.bp-notifications-badge')?.textContent, '1')
  await f.settle(() => finish(page([item(99, { read: false }), item(98, { read: false })], { unreadCount: 2 })))
  assert.equal(f.q('.bp-notifications-badge')?.textContent, '1', 'the discarded Host result cannot overwrite the new feed')
  assert.equal(f.q('.bp-notification[data-seq="99"]'), null)
})

test('a background refresh that prepends a newer row keeps the owner focused on the same durable row', async t => {
  const f = await fixture(t)
  let list = () => Promise.resolve(page([item(5, { read: false })], { unreadCount: 1 }))
  await f.render({ productApi: { dispatch: action => action === 'notifications.list' ? list() : Promise.reject(new Error('x')) }, available: true })
  const readButton = f.q('.bp-notification[data-seq="5"] .bp-notification-read')
  readButton.focus()
  assert.equal(f.doc.activeElement, readButton)
  list = () => Promise.resolve(page([item(8, { read: false }), item(5, { read: false })], { unreadCount: 2 }))
  await f.hidden(true); await f.hidden(false)
  assert.equal(f.doc.activeElement.closest('.bp-notification')?.getAttribute('data-seq'), '5', 'focus stays on the same durable row across a refresh')
  assert.ok(f.q('.bp-notification[data-seq="8"]'), 'the newer row was prepended without dropping focus')
})

test('an un-wired host degrades to a note, and an empty feed has its own message', async t => {
  const f = await fixture(t)
  await f.render({ productApi: { dispatch: () => Promise.reject(new Error('x')) }, available: false })
  assert.match(f.q('.bp-notifications-note')?.textContent ?? '', /暂时无法读取通知/)
  assert.equal(f.doc.querySelectorAll('.bp-notification').length, 0)
})

test('a loaded but empty feed invites the owner instead of showing a blank panel', async t => {
  const f = await fixture(t)
  await f.render({ productApi: { dispatch: action => action === 'notifications.list' ? Promise.resolve(page([], { unreadCount: 0 })) : Promise.reject(new Error('x')) }, available: true })
  assert.match(f.q('.bp-notifications-note')?.textContent ?? '', /暂无通知/)
})

test('relative time is derived from structured state and needs no client clock to be trusted', () => {
  assert.equal(formatAt(1000, 1000), '刚刚')
  assert.equal(formatAt(1000, 1000 + 5 * 60_000), '5 分钟前')
  assert.equal(formatAt(1000, 1000 + 3 * 3_600_000), '3 小时前')
  assert.equal(formatAt(1000, 1000 + 2 * 86_400_000), '2 天前')
  assert.equal(formatAt(Number.NaN, 1000), '')
})

test('replacing a loaded Host clears its rows while the new Host is pending, including late older-page results', async t => {
  const f = await fixture(t)
  let finishMore, oldSignal
  await f.render({ productApi: { dispatch: (_action, payload, signal) => payload.before
    ? (oldSignal = signal, new Promise(resolve => { finishMore = resolve }))
    : Promise.resolve(page([item(5)], { nextBefore: 5 })) } })
  assert.ok(f.q('.bp-notification[data-seq="5"]'))
  await f.settle(() => f.q('.bp-notifications-more').click())
  await f.render({ productApi: { dispatch: () => new Promise(() => {}) } })
  assert.equal(oldSignal.aborted, true)
  assert.equal(f.doc.querySelectorAll('.bp-notification').length, 0)
  await f.settle(() => finishMore(page([item(2)])))
  assert.equal(f.doc.querySelectorAll('.bp-notification').length, 0)
})

test('a rejected read does not claim success or remove its retry control', async t => {
  const f = await fixture(t)
  await f.render({ productApi: { dispatch: action => action === 'notifications.list' ? Promise.resolve(page([item(7)])) : Promise.reject(new Error('private diagnostic')) } })
  await f.settle(() => f.q('.bp-notification-read').click())
  assert.equal(f.q('.bp-notifications-badge')?.textContent, '1')
  assert.ok(f.q('.bp-notification-read'))
  assert.match(f.q('[role="alert"]').textContent, /未确认/)
  assert.doesNotMatch(f.doc.body.textContent, /private diagnostic/)
})

test('an exhausted unread window never claims all history is read and still permits mark-all', async t => {
  const f = await fixture(t)
  await f.render({ productApi: { dispatch: action => action === 'notifications.list'
    ? Promise.resolve(page([item(9, { read: true })], { unreadCount: 0, truncated: true }))
    : Promise.resolve({ unreadCount: 0, truncated: false, cursorSeq: 9 }) } })
  assert.match(f.q('.bp-notifications-badge').getAttribute('aria-label'), /尚未完整统计/)
  assert.equal(f.q('.bp-notifications-markall').disabled, false)
  await f.settle(() => f.q('.bp-notifications-markall').click())
  assert.equal(f.q('.bp-notifications-badge'), null)
})

test('mark-all uses the acknowledged Host cursor and preserves a later unread event', async t => {
  const f = await fixture(t)
  await f.render({ productApi: { dispatch: action => action === 'notifications.list'
    ? Promise.resolve(page([item(8), item(6)], { unreadCount: 2, truncated: true }))
    : Promise.resolve({ unreadCount: 1, cursorSeq: 6, truncated: false }) } })
  assert.match(f.q('.bp-notifications-badge').getAttribute('aria-label'), /至少/)
  await f.settle(() => f.q('.bp-notifications-markall').click())
  assert.equal(f.q('.bp-notification[data-seq="6"] .bp-notification-read'), null)
  assert.ok(f.q('.bp-notification[data-seq="8"] .bp-notification-read'))
  assert.equal(f.q('.bp-notifications-badge')?.textContent, '1')
})

test('the stylesheet carries light and dark token blocks, a narrow-screen rule and touch targets', async () => {
  const css = await readFile(new URL('../apps/integration-client/notifications.css', import.meta.url), 'utf8')
  assert.match(css, /--bp-notif-canvas:/)
  assert.match(css, /data-bp-appearance="dark"/)
  assert.match(css, /data-ds-dark-theme/)
  assert.match(css, /@media \(max-width: 640px\)/)
  assert.match(css, /pointer: coarse/)
  assert.doesNotMatch(css, /cancel|retry|stop|approve/, 'the panel never offers an execution control')
})
