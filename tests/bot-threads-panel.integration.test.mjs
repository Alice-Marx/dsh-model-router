import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const parent = resolve('tmp/integration/bot-threads/panel'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'case-')), file = join(directory, 'ui.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/bot-threads-panel.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom'], write: false })
await (await import('node:fs/promises')).writeFile(file, bundle.outputFiles[0].contents)
const headerFile = join(directory, 'ui-header.mjs')
const headerBundle = await build({ entryPoints: ['apps/integration-client/bot-thread-header.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom'], write: false })
await (await import('node:fs/promises')).writeFile(headerFile, headerBundle.outputFiles[0].contents)
const { BotThreadsPanel, BotThreadHeaderAddon, isArchivedThread, formatThreadAt, threadLabel, sortedThreads } = await import(pathToFileURL(file))
const { BotThreadHeader, headerThreadNote } = await import(pathToFileURL(headerFile))

const thread = (threadId, over = {}) => ({
  threadId, botId: 'bot-a', name: `线程 ${threadId}`, state: 'open', archivedAt: null,
  sessionId: null, sessionState: 'none', createdAt: 1000, updatedAt: 2000, active: false, ...over,
})

const page = (threads, activeThreadId = null) => ({ botId: 'bot-a', activeThreadId, threads })

// A Host double that records every action and answers writes with the store's
// new list, exactly as the wired composition will. `open` answers with the real
// Session the catalog resolved, because navigation is the caller's own act and
// only a Host-confirmed Session id may be handed to it.
function makeApi(initial, options = {}) {
  const dispatched = []
  let threads = initial
  let made = 0
  let bound = 0
  const nextId = () => `sess-made-${++bound}`
  // `answer` is the Host double itself; `dispatch` records what reached it, so
  // a test can wrap the recording layer without changing the answers.
  const answer = (action, payload) => {
      if (action === 'threads.list') return Promise.resolve(page(threads))
      const match = threadId => threads.find(item => item.threadId === threadId)
      if (action === 'threads.open') {
        if (options.openRefusal) return Promise.reject(options.openRefusal)
        const target = match(payload.threadId)
        const created = payload.create === true
        const sessionId = target?.sessionId ?? (created ? nextId() : null)
        if (created && target && target.sessionId === null) threads = threads.map(item => item.threadId === payload.threadId ? { ...item, sessionId, sessionState: 'owned' } : item)
        threads = threads.map(item => ({ ...item, active: item.threadId === payload.threadId }))
        return Promise.resolve({ botId: 'bot-a', threadId: payload.threadId, activeThreadId: payload.threadId, sessionId, sessionState: sessionId === null ? 'none' : 'owned', created, needsSession: sessionId === null })
      }
      if (action === 'threads.switch') {
        threads = threads.map(item => ({ ...item, active: item.threadId === payload.threadId, updatedAt: 3000 }))
        return Promise.resolve(page(threads, payload.threadId))
      }
      if (action === 'threads.create') {
        made += 1
        // A replayed request key answers with the thread it already made.
        if (payload.requestKey !== undefined && threads.some(item => item.requestKey === payload.requestKey)) {
          return Promise.resolve({ botId: 'bot-a', thread: threads.find(item => item.requestKey === payload.requestKey), created: false, threads, activeThreadId: threads.find(item => item.requestKey === payload.requestKey).threadId })
        }
        const createdThread = thread(`made-${made}`, { active: true, updatedAt: 4000, requestKey: payload.requestKey })
        threads = [createdThread, ...threads.map(item => ({ ...item, active: false }))]
        return Promise.resolve({ botId: 'bot-a', thread: createdThread, created: true, threads, activeThreadId: createdThread.threadId })
      }
      if (action === 'threads.rename') {
        threads = threads.map(item => item.threadId === payload.threadId ? { ...item, name: payload.name, updatedAt: 5000 } : item)
        return Promise.resolve(page(threads))
      }
      if (action === 'threads.recover') {
        const target = match(payload.threadId)
        if (target === undefined) return Promise.reject(Object.assign(new Error('no thread'), { code: 'THREAD_NOT_FOUND' }))
        const sessionId = target.sessionId ?? nextId()
        threads = threads.map(item => item.threadId === payload.threadId ? { ...item, sessionId, sessionState: 'owned' } : item)
        return Promise.resolve({ botId: 'bot-a', threadId: payload.threadId, sessionId, sessionState: 'owned', created: false })
      }
      if (action === 'threads.archive') {
        const target = match(payload.threadId)
        threads = threads.map(item => item.threadId === payload.threadId ? { ...item, state: 'archived', archivedAt: 6000, active: false } : item)
        return Promise.resolve(page(threads, target?.active ? (threads.find(item => item.archivedAt === null)?.threadId ?? null) : undefined))
      }
      if (action === 'threads.unarchive') {
        threads = threads.map(item => item.threadId === payload.threadId ? { ...item, state: 'open', archivedAt: null, updatedAt: 7000 } : item)
        return Promise.resolve(page(threads))
      }
      return Promise.reject(Object.assign(new Error('unavailable'), { code: 'PRODUCT_ACTION_UNAVAILABLE' }))
  }
  const api = { dispatch: (action, payload) => { dispatched.push({ action, payload }); return answer(action, payload) }, answer }
  return { dispatched, api, threads: () => threads }
}

async function fixture(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://threads.fixture/', pretendToBeVisual: true })
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'))
  const settle = fn => act(async () => { await fn(); await new Promise(setImmediate) })
  const opened = []
  const render = props => settle(() => root.render(React.createElement(BotThreadsPanel, { botId: 'bot-a', available: true, ...props })))
  const renderHeader = props => settle(() => root.render(React.createElement(BotThreadHeader, { botId: 'bot-a', ...props })))
  const renderAddon = props => settle(() => root.render(React.createElement(BotThreadHeaderAddon, { onOpen: () => opened.push(true), ...props })))
  const q = selector => document.querySelector(selector)
  const all = selector => [...document.querySelectorAll(selector)]
  // React owns the input value: set it through the native setter, then let the
  // browser dispatch the event the component listens for.
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setter.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  }
  // A key press the way a browser reports one: `composing` is what an IME sets
  // while a candidate is being confirmed, and Enter then must not submit.
  const press = (element, key, composing = false) => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: composing, keyCode: composing ? 229 : 0 }))
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [key, value] of Object.entries(previous)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] } })
  return { render, renderHeader, renderAddon, settle, opened, q, all, setValue, press, unmount: () => act(() => root.unmount()), doc: dom.window.document }
}

test('the panel renders the store-verified threads with the active one first', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-2', { active: true }), thread('t-1'), thread('t-0', { state: 'archived', archivedAt: 6000 })])
  await f.render({ productApi: api })
  assert.ok(dispatched.some(entry => entry.action === 'threads.list' && entry.payload.botId === 'bot-a'))
  assert.deepEqual(f.all('.bp-thread').map(row => row.getAttribute('data-thread')), ['t-2', 't-1', 't-0'])
  assert.equal(f.q('.bp-thread.is-active .bp-thread-badge')?.textContent, '当前')
  assert.match(f.q('.bp-thread[data-state="archived"] .bp-thread-badge')?.textContent ?? '', /已归档 · 只读/)
  assert.equal(f.q('.bp-threads-count')?.textContent, '2 进行中 · 1 归档')
})

test('switching, creating, renaming and archiving each go through one Host action and only take effect on its reply', async t => {
  const f = await fixture(t)
  const { api, dispatched, threads } = makeApi([thread('t-1'), thread('t-2')])
  const opened = []
  await f.render({ productApi: api, onOpenSession: id => opened.push(id) })
  // Opening a thread is navigation with a confirmed Session: the panel asks the
  // Host for the real Session and only then hands that id to the shell.
  await f.settle(() => f.q('.bp-thread[data-thread="t-2"] .bp-thread-open').click())
  const switched = dispatched.find(entry => entry.action === 'threads.open')
  assert.deepEqual(switched.payload, { botId: 'bot-a', threadId: 't-2', create: true })
  assert.deepEqual(opened, ['sess-made-1'])
  assert.equal(f.q('.bp-thread.is-active')?.getAttribute('data-thread'), 't-2')

  await f.settle(() => f.setValue(f.q('.bp-threads-input'), '新的线索'))
  await f.settle(() => f.q('.bp-threads-button').click())
  const created = dispatched.filter(entry => entry.action === 'threads.create')
  assert.equal(created.length, 1)
  assert.equal(created[0].payload.botId, 'bot-a')
  assert.equal(created[0].payload.name, '新的线索')
  assert.match(created[0].payload.requestKey, /^panel-bot-a-\d+$/)
  assert.equal(f.q('.bp-threads-input').value, '', 'the composer clears once the Host confirms')
  assert.equal(f.q('.bp-thread.is-active')?.getAttribute('data-thread'), 'made-1')
  // The new thread is opened as itself, with the Session the Host made for it.
  assert.deepEqual(opened, ['sess-made-1', 'sess-made-2'])
  assert.equal(f.q('.bp-thread.is-active .bp-thread-badge')?.textContent, '当前')

  await f.settle(() => f.q('.bp-thread[data-thread="made-1"] [aria-label="重命名线程"]').click())
  await f.settle(() => f.setValue(f.q('.bp-thread-rename .bp-threads-input'), '改名后'))
  await f.settle(() => f.press(f.q('.bp-thread-rename .bp-threads-input'), 'Enter'))
  const renamed = dispatched.find(entry => entry.action === 'threads.rename')
  assert.deepEqual(renamed.payload, { botId: 'bot-a', threadId: 'made-1', name: '改名后' })
  assert.equal(threads().find(item => item.threadId === 'made-1').name, '改名后')

  await f.settle(() => f.q('.bp-thread[data-thread="t-1"] [aria-label="归档线程"]').click())
  const archived = dispatched.find(entry => entry.action === 'threads.archive')
  assert.deepEqual(archived.payload, { botId: 'bot-a', threadId: 't-1' })
  assert.equal(f.q('.bp-thread[data-thread="t-1"]')?.getAttribute('data-state'), 'archived')
  await f.settle(() => f.q('.bp-thread[data-thread="t-1"] [aria-label="恢复线程"]').click())
  assert.ok(dispatched.some(entry => entry.action === 'threads.unarchive' && entry.payload.threadId === 't-1'))
  assert.equal(f.q('.bp-thread[data-thread="t-1"]')?.getAttribute('data-state'), 'open')
})

test('a rejected write keeps the rows on screen and reports that the Host did not confirm it', async t => {
  const f = await fixture(t)
  const api = { dispatch: action => action === 'threads.list'
    ? Promise.resolve(page([thread('t-1', { active: true })]))
    : Promise.reject(Object.assign(new Error('read only'), { code: 'PRODUCT_READ_ONLY' })) }
  await f.render({ productApi: api })
  await f.settle(() => f.q('.bp-thread[data-thread="t-1"] [aria-label="归档线程"]').click())
  assert.match(f.q('.bp-threads-note[role="alert"]')?.textContent ?? '', /未得到宿主确认/)
  assert.equal(f.q('.bp-thread[data-thread="t-1"]')?.getAttribute('data-state'), 'open', 'nothing changed without the Host')
})

test('an un-wired Host shows the integration note and offers no thread control', async t => {
  const f = await fixture(t)
  const dispatched = []
  await f.render({ productApi: { dispatch: (action, payload) => { dispatched.push({ action, payload }); return Promise.reject(new Error('nope')) } }, available: false })
  assert.match(f.q('.bp-threads-note')?.textContent ?? '', /暂不支持线程目录/)
  assert.equal(f.q('.bp-threads-button'), null)
  assert.equal(dispatched.length, 0)
  // No execution control is ever rendered, wired or not.
  assert.equal(f.all('button').filter(button => /取消|停止|重试|审批/.test(button.getAttribute('aria-label') ?? '')).length, 0)
})

test('a thread whose Session the Host has not confirmed says so instead of pretending it can send', async t => {
  const f = await fixture(t)
  const { api } = makeApi([thread('t-1', { active: true, sessionId: 's-1', sessionState: 'unbound' })])
  await f.render({ productApi: api })
  assert.equal(f.q('.bp-thread.is-active .bp-thread-badge.is-wait')?.textContent, '等待宿主确认归属')
  assert.match([...f.all('.bp-threads-note')].map(node => node.textContent).join(''), /尚未得到宿主归属确认/)
  assert.equal(f.all('button').filter(button => /发送|继续对话/.test(button.textContent)).length, 0)
})

test('the chat-title addon names the active thread and opens the directory', async t => {
  const f = await fixture(t)
  await f.renderAddon({ thread: thread('t-9', { name: '排查线索', active: true }) })
  assert.equal(f.q('.bp-threads-head-name')?.textContent, '排查线索')
  await f.settle(() => f.q('.bp-threads-head').click())
  assert.deepEqual(f.opened, [true])
  await f.renderAddon({ thread: null })
  assert.equal(f.q('.bp-threads-head'), null)
})

test('an IME Enter never creates a thread and never commits a rename', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-1')])
  await f.render({ productApi: api })
  await f.settle(() => f.setValue(f.q('.bp-threads-input'), '候选中'))
  await f.settle(() => f.press(f.q('.bp-threads-input'), 'Enter', true))
  assert.equal(dispatched.filter(entry => entry.action === 'threads.create').length, 0, 'an IME Enter is not a submission')
  await f.settle(() => f.press(f.q('.bp-threads-input'), 'Enter'))
  assert.equal(dispatched.filter(entry => entry.action === 'threads.create').length, 1)

  await f.settle(() => f.q('.bp-thread[data-thread="t-1"] [aria-label="重命名线程"]').click())
  await f.settle(() => f.setValue(f.q('.bp-thread-rename .bp-threads-input'), '改名中'))
  await f.settle(() => f.press(f.q('.bp-thread-rename .bp-threads-input'), 'Enter', true))
  assert.equal(dispatched.filter(entry => entry.action === 'threads.rename').length, 0)
  await f.settle(() => f.press(f.q('.bp-thread-rename .bp-threads-input'), 'Enter'))
  assert.equal(dispatched.filter(entry => entry.action === 'threads.rename').length, 1)
})

test('a lost create reply keeps one request key, so a retry is the same thread and not a second one', async t => {
  const f = await fixture(t)
  const { api, dispatched, threads } = makeApi([thread('t-1')])
  // The Host refuses the first create: nothing is confirmed, so the composer and
  // the request key both stay.
  const original = api.answer
  let failed = false
  api.dispatch = (action, payload) => {
    dispatched.push({ action, payload })
    if (action === 'threads.create' && !failed) { failed = true; return Promise.reject(Object.assign(new Error('read only'), { code: 'PRODUCT_READ_ONLY' })) }
    return original(action, payload)
  }
  await f.render({ productApi: api })
  await f.settle(() => f.setValue(f.q('.bp-threads-input'), '重试的线索'))
  await f.settle(() => f.q('.bp-threads-button').click())
  assert.match(f.q('.bp-threads-note[role="alert"]')?.textContent ?? '', /宿主/)
  assert.equal(f.q('.bp-threads-input').value, '重试的线索', 'an unconfirmed create keeps the draft')
  // The retry reuses the same key, so the Host answers with the thread the first
  // attempt already made instead of a second one.
  await f.settle(() => f.q('.bp-threads-button').click())
  const creates = dispatched.filter(entry => entry.action === 'threads.create')
  assert.equal(creates.length, 2)
  assert.equal(creates[1].payload.requestKey, creates[0].payload.requestKey, 'one intent, one key')
  assert.equal(threads().filter(item => item.requestKey === creates[0].payload.requestKey).length, 1)
  assert.equal(f.q('.bp-threads-input').value, '')
})

test('a thread the Host refuses to open moves the owner nowhere, and an unknown outcome offers recovery', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-1', { active: true, sessionId: 's-1', sessionState: 'owned' }), thread('t-2')], { openRefusal: Object.assign(new Error('moved away'), { code: 'RUNTIME_MODE_MISMATCH' }) })
  const opened = []
  await f.render({ productApi: api, onOpenSession: id => opened.push(id) })
  await f.settle(() => f.q('.bp-thread[data-thread="t-2"] .bp-thread-open').click())
  assert.deepEqual(opened, [], 'a refused open navigates nowhere')
  assert.match(f.q('.bp-threads-note[role="alert"]')?.textContent ?? '', /另一个运行时/)
  assert.equal(f.q('.bp-thread.is-active')?.getAttribute('data-thread'), 't-1', 'the selection stays where the Host left it')

  // An outcome the Host never confirmed is not retried into a new Session: the
  // owner is offered the explicit recovery instead.
  const unknown = makeApi([thread('t-9')], { openRefusal: Object.assign(new Error('unknown'), { code: 'SESSION_UNKNOWN' }) })
  await f.render({ productApi: unknown.api, onOpenSession: id => opened.push(id) })
  await f.settle(() => f.q('.bp-thread[data-thread="t-9"] .bp-thread-open').click())
  assert.match(f.q('.bp-threads-recover')?.textContent ?? '', /核对/)
  assert.deepEqual(opened, [])
  await f.settle(() => f.q('.bp-threads-recover button').click())
  assert.ok(unknown.dispatched.some(entry => entry.action === 'threads.recover' && entry.payload.threadId === 't-9'))
  assert.deepEqual(opened, ['sess-made-1'], 'the recovered Session is the one navigated to')
})

test('a late open never lands the owner on the thread they moved away from', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-1'), thread('t-2')])
  const opened = []
  const original = api.dispatch
  let release
  api.dispatch = (action, payload, signal) => {
    if (action !== 'threads.open') return original(action, payload, signal)
    dispatched.push({ action, payload })
    // The first open hangs; the second answers at once. The stale reply must not
    // navigate anywhere, because a newer open already won.
    if (payload.threadId === 't-1') return new Promise(resolve => { release = () => resolve({ botId: 'bot-a', threadId: 't-1', sessionId: 'sess-late', sessionState: 'owned', created: false }) })
    return original(action, payload, signal)
  }
  await f.render({ productApi: api, onOpenSession: id => opened.push(id) })
  await f.settle(() => f.q('.bp-thread[data-thread="t-1"] .bp-thread-open').click())
  await f.settle(() => f.q('.bp-thread[data-thread="t-2"] .bp-thread-open').click())
  assert.deepEqual(opened, ['sess-made-1'])
  release()
  await f.settle(() => Promise.resolve())
  assert.deepEqual(opened, ['sess-made-1'], 'the late reply of the abandoned open navigates nowhere')
})

test('a reply that arrives after the panel is gone, or after its deadline, moves the owner nowhere', async t => {
  const f = await fixture(t)
  const { api } = makeApi([thread('t-1')])
  const opened = []
  let release
  const original = api.answer
  api.dispatch = action => {
    if (action !== 'threads.open') return original(action)
    return new Promise(resolve => { release = () => resolve({ botId: 'bot-a', threadId: 't-1', sessionId: 'sess-late', sessionState: 'owned', created: false }) })
  }
  await f.render({ productApi: api, onOpenSession: id => opened.push(id) })
  await f.settle(() => f.q('.bp-thread[data-thread="t-1"] .bp-thread-open').click())
  await f.unmount()
  release()
  await f.settle(() => Promise.resolve())
  assert.deepEqual(opened, [], 'a late reply after the panel is gone navigates nowhere')
})

test('a deadline the Host misses navigates nowhere and says so', async t => {
  const f = await fixture(t)
  const hung = makeApi([thread('t-9')])
  hung.api.dispatch = action => action === 'threads.open' ? new Promise(() => {}) : hung.api.answer(action)
  const opened = []
  const clock = t.mock.timers
  clock.enable({ apis: ['setTimeout'] })
  await f.render({ productApi: hung.api, onOpenSession: id => opened.push(id) })
  await f.settle(() => f.q('.bp-thread[data-thread="t-9"] .bp-thread-open').click())
  clock.tick(9000)
  await f.settle(() => Promise.resolve())
  assert.deepEqual(opened, [], 'a missed deadline navigates nowhere')
  assert.match(f.q('.bp-threads-note[role="alert"]')?.textContent ?? '', /约定时间/)
  clock.reset()
})
test('an archived thread opens read-only and says so', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-1', { state: 'archived', archivedAt: 6000, sessionId: 'sess-old', sessionState: 'owned' })])
  const opened = []
  await f.render({ productApi: api, onOpenSession: id => opened.push(id) })
  await f.settle(() => f.q('.bp-thread[data-thread="t-1"] .bp-thread-open').click())
  const open = dispatched.find(entry => entry.action === 'threads.open')
  assert.deepEqual(open.payload, { botId: 'bot-a', threadId: 't-1' }, 'an archived thread is opened without asking for a Session')
  assert.deepEqual(opened, ['sess-old'], 'the history it kept is what opens, read-only')
  assert.match([...f.all('.bp-threads-note')].map(node => node.textContent).join(''), /只读打开/)
})

test('the header control shows the Bot and its thread, and opens a thread only after the Host confirms the Session', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-1', { name: '排查线索甲', active: true, sessionId: 'sess-1', sessionState: 'owned' }), thread('t-2', { name: '排查线索乙', sessionId: 'sess-2', sessionState: 'owned' })])
  const opened = []
  const roster = {
    byId: { 'sess-1': { id: 'bot-a', name: '甲 Bot' }, 'sess-2': { id: 'bot-a', name: '甲 Bot' } },
    threadsById: { 'sess-1': { botId: 'bot-a', threadId: 't-1', name: '排查线索甲' }, 'sess-2': { botId: 'bot-a', threadId: 't-2', name: '排查线索乙' } },
    ready: true,
  }
  await f.renderHeader({ productApi: api, roster, sessionId: 'sess-1', onOpenSession: id => opened.push(id) })
  // Both identities are on screen: the Bot it belongs to and the thread that is open.
  assert.match(f.q('.bp-threads-head')?.getAttribute('aria-label') ?? '', /当前线程 排查线索甲（甲 Bot）/)
  assert.equal(f.q('.bp-threads-head-name')?.textContent, '排查线索甲')
  assert.equal(dispatched.filter(entry => entry.action === 'threads.list').length, 1)
  await f.settle(() => f.q('.bp-threads-head').click())
  assert.equal(f.q('.bp-threads-menu-row.is-active .bp-threads-menu-name')?.textContent, '排查线索甲')
  await f.settle(() => f.q('.bp-threads-menu-row[data-state="open"]:not(.is-active)').click())
  const open = dispatched.find(entry => entry.action === 'threads.open')
  assert.deepEqual(open.payload, { botId: 'bot-a', threadId: 't-2', create: true })
  assert.deepEqual(opened, ['sess-2'])
  // Creating from the header is the same owner act, with one key per intent.
  await f.settle(() => f.q('.bp-threads-head').click())
  await f.settle(() => f.setValue(f.q('.bp-threads-menu-new .bp-threads-input'), '新线索'))
  await f.settle(() => f.q('.bp-threads-menu-new .bp-threads-button').click())
  const created = dispatched.filter(entry => entry.action === 'threads.create')
  assert.equal(created.length, 1)
  assert.match(created[0].payload.requestKey, /^head-bot-a-\d+$/)
  assert.deepEqual(opened, ['sess-2', 'sess-made-1'])
})

test('the header control reads one Bot on a change, never a repeated full snapshot', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-1', { name: '甲', active: true, sessionId: 'sess-1', sessionState: 'owned' })])
  const roster = { byId: { 'sess-1': { id: 'bot-a', name: '甲 Bot' } }, threadsById: { 'sess-1': { botId: 'bot-a', threadId: 't-1', name: '甲' } }, ready: true }
  await f.renderHeader({ productApi: api, roster, sessionId: 'sess-1' })
  assert.equal(dispatched.filter(entry => entry.action === 'threads.list').length, 1, 'a closed control pulls nothing on a timer')
  await f.settle(() => f.q('.bp-threads-head').click())
  await new Promise(done => setTimeout(done, 60))
  assert.ok(dispatched.filter(entry => entry.action === 'threads.list').length >= 2, 'an open menu follows the Host')
  for (const entry of dispatched) {
    assert.ok(entry.action.startsWith('threads.'), 'the header dispatches nothing but thread actions')
    if (entry.action === 'threads.list') assert.deepEqual(Object.keys(entry.payload), ['botId'], 'one Bot per read, never a snapshot')
  }
})

test('header notes name the Host reason instead of guessing', () => {
  assert.match(headerThreadNote({ code: 'SESSION_UNKNOWN' }), /核对/)
  assert.match(headerThreadNote({ code: 'RUNTIME_MODE_MISMATCH' }), /另一个运行时/)
  assert.match(headerThreadNote({}), /宿主/)
})

test('pure helpers: archivedAt 0 is archived, ordering follows the store, labels fall back', () => {
  assert.equal(isArchivedThread({ archivedAt: 0 }), true)
  assert.equal(isArchivedThread({ archivedAt: null }), false)
  assert.equal(isArchivedThread({}), false)
  assert.equal(threadLabel({ name: '   ' }), '新线程')
  assert.equal(threadLabel(null), '新线程')
  assert.equal(formatThreadAt(undefined), '')
  assert.equal(formatThreadAt(-1), '')
  assert.equal(formatThreadAt(1000, 61_000), '1 分钟前')
  const ordered = sortedThreads([thread('b', { updatedAt: 5 }), thread('a', { active: true, updatedAt: 1 }), thread('c', { updatedAt: 9, archivedAt: 8 })])
  assert.deepEqual(ordered.map(item => item.threadId), ['a', 'b', 'c'])
})

test('the stylesheet follows the panel conventions: tokens, both themes, 375px, touch', async t => {
  const css = await readFile(new URL('../apps/integration-client/bot-threads.css', import.meta.url), 'utf8')
  assert.match(css, /--bp-thread-canvas:/)
  assert.match(css, /data-bp-appearance="dark"/)
  assert.match(css, /data-ds-dark-theme/)
  assert.match(css, /@media \(max-width: 640px\)/)
  assert.match(css, /pointer: coarse/)
  assert.doesNotMatch(css, /cancel|retry|stop|approve/, 'the panel never offers an execution control')
  // The header control is one compact chip beside the product's own tools, not a
  // second toolbar: it carries no model, memory, computer or task control.
  assert.match(css, /\.bp-threads-menu/)
  assert.ok(!/bp-threads.*(model|memory|computer|tasks)/.test(css))
})

test('the header control holds one create intent until the Host answers, and Enter while pending queues nothing', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-1', { name: '甲', active: true, sessionId: 'sess-1', sessionState: 'owned' })])
  const opened = []
  const roster = { byId: { 'sess-1': { id: 'bot-a', name: '甲 Bot', sessionId: 'bot-a' } }, threadsById: { 'sess-1': { botId: 'bot-a', threadId: 't-1', name: '甲' } }, ready: true }
  let release, refused = false
  const original = api.answer
  api.dispatch = (action, payload) => {
    dispatched.push({ action, payload })
    if (action === 'threads.create' && !refused) { refused = true; return Promise.reject(Object.assign(new Error('unknown'), { code: 'SESSION_UNKNOWN' })) }
    if (action === 'threads.open' && payload.threadId === 'made-1') return new Promise(resolve => { release = () => resolve({ botId: 'bot-a', threadId: 'made-1', sessionId: 'sess-open', sessionState: 'owned', created: true }) })
    return original(action, payload)
  }
  await f.renderHeader({ productApi: api, roster, sessionId: 'sess-1', onOpenSession: id => opened.push(id) })
  await f.settle(() => f.q('.bp-threads-head').click())
  await f.settle(() => f.setValue(f.q('.bp-threads-menu-new .bp-threads-input'), '第一个意图'))
  await f.settle(() => f.q('.bp-threads-menu-new .bp-threads-button').click())
  const first = dispatched.filter(entry => entry.action === 'threads.create')
  assert.equal(first.length, 1)
  assert.match(first[0].payload.requestKey, /^head-bot-a-\d+$/)
  // The refusal is reported, and the intent key stands.
  assert.match(f.q('.bp-threads-note[role="alert"]')?.textContent ?? '', /核对/)
  await f.settle(() => f.q('.bp-threads-menu-new .bp-threads-button').click())
  const second = dispatched.filter(entry => entry.action === 'threads.create')
  assert.equal(second.length, 2)
  assert.equal(second[1].payload.requestKey, first[0].payload.requestKey, 'a retry is the same intent, not a second thread')
  // While an open is in flight, Enter on the name input queues nothing.
  await f.settle(() => f.press(f.q('.bp-threads-menu-new .bp-threads-input'), 'Enter'))
  assert.equal(dispatched.filter(entry => entry.action === 'threads.create').length, 2, 'Enter while pending creates nothing')
  release()
  await f.settle(() => Promise.resolve())
  assert.deepEqual(opened, ['sess-open'])
})

test('the header menu lists the Bot default chat, and leaving a thread opens it without a substitute Session', async t => {
  const f = await fixture(t)
  const { api, dispatched } = makeApi([thread('t-1', { name: '甲', active: true, sessionId: 'sess-1', sessionState: 'owned' })])
  const opened = []
  const roster = { byId: { 'sess-1': { id: 'bot-a', name: '甲 Bot', sessionId: 'bot-a' }, 'bot-a': { id: 'bot-a', name: '甲 Bot', sessionId: 'bot-a' } }, threadsById: { 'sess-1': { botId: 'bot-a', threadId: 't-1', name: '甲' } }, ready: true }
  await f.renderHeader({ productApi: api, roster, sessionId: 'sess-1', onOpenSession: id => opened.push(id) })
  await f.settle(() => f.q('.bp-threads-head').click())
  assert.match(f.q('.bp-threads-menu-row[data-state="default"] .bp-threads-menu-name')?.textContent ?? '', /默认聊天/)
  await f.settle(() => f.q('.bp-threads-menu-row[data-state="default"]').click())
  assert.deepEqual(opened, ['bot-a'], 'the default chat opens on the Bot the roster already trusts')
  assert.equal(dispatched.filter(entry => entry.action === 'threads.open').length, 0, 'no substitute Session is ever asked for')
})

test('Escape closes the header menu and returns the caret to the chip', async t => {
  const f = await fixture(t)
  const { api } = makeApi([thread('t-1', { name: '甲', active: true, sessionId: 'sess-1', sessionState: 'owned' })])
  const roster = { byId: { 'sess-1': { id: 'bot-a', name: '甲 Bot', sessionId: 'bot-a' } }, threadsById: { 'sess-1': { botId: 'bot-a', threadId: 't-1', name: '甲' } }, ready: true }
  await f.renderHeader({ productApi: api, roster, sessionId: 'sess-1' })
  await f.settle(() => f.q('.bp-threads-head').click())
  assert.ok(f.q('.bp-threads-menu'))
  await f.settle(() => f.q('.bp-threads-menu-new .bp-threads-input').focus())
  f.doc.dispatchEvent(new (f.doc.defaultView).KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await f.settle(() => Promise.resolve())
  assert.equal(f.q('.bp-threads-menu'), null)
  assert.equal(f.doc.activeElement, f.q('.bp-threads-head'), 'the caret is back on the chip that opened the menu')
})
