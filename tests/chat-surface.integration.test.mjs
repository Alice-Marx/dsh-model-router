import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build, transform } from 'esbuild'

const parent = resolve('tmp/integration/chat-surface')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'components-')), output = join(directory, 'chat.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/chat-ui.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' } })
await writeFile(output, bundle.outputFiles[0].contents)
const { ContactNavigation, ContactToolbar, ConversationTools } = await import(pathToFileURL(output))

async function withDom(work) {
  const dom = new JSDOM('<!doctype html><html><body data-bot-product-ui="1"><div id="root"></div></body></html>', { url: 'http://chat.fixture/' })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client'), container = document.getElementById('root'), root = createRoot(container)
  const settle = async work => act(async () => { await work(); await new Promise(setImmediate) })
  const render = element => settle(() => root.render(element))
  const click = async selector => {
    const element = container.querySelector(selector)
    assert.ok(element, selector)
    await settle(() => element.click())
  }
  const key = async (element, name, options = {}) => settle(() => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })))
  try { await work({ container, dom, settle, render, click, key }) }
  finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

const bot = { id: 'bot-a', name: '研究伙伴', model: 'fixture/exact-model', appliedModel: 'fixture/previous' }
const roster = { models: [{ ref: 'fixture/exact-model', name: 'Fixture Exact' }], memory: true }
const originalPart = 'bot-a:original-part'
const recorder = calls => ({
  showDetails: (...args) => calls.push(['details', ...args]),
  openMemory: (...args) => calls.push(['memory', ...args]),
  openVoice: (...args) => calls.push(['voice', ...args]),
  updateBot() { throw new Error('UI navigation cannot update a Bot') },
  answerApproval() { throw new Error('UI navigation cannot approve') },
  send() { throw new Error('UI navigation cannot submit') },
})

test('the product chat header opens only the thread Session confirmed by its current Host', async () => {
  await withDom(async ({ render, container, click, settle }) => {
    const calls = [], opened = []
    const currentRoster = { ...roster, byId: { [originalPart]: bot } }
    const row = { threadId: 'thread-a', botId: bot.id, name: '实验记录', state: 'open', sessionState: 'bound', sessionId: 'host-thread-session' }
    const api = { dispatch: async (action, payload) => {
      calls.push({ action, payload })
      if (action === 'threads.list') return { botId: bot.id, threads: [row] }
      if (action === 'threads.open') return { sessionId: 'host-confirmed-session', thread: row }
      throw new Error(action)
    } }
    const view = productApi => React.createElement(ConversationTools, { sessionId: originalPart, bot, roster: currentRoster,
      actions: recorder([]), productApi, onOpenSession: id => opened.push(id), onNavigate: value => opened.push(value) })
    await render(view(api))
    await click('.bp-threads-head')
    await click('.bp-threads-menu-row:not([data-state=default])')
    assert.deepEqual(opened, ['host-confirmed-session'])
    assert.deepEqual(calls.find(row => row.action === 'threads.open').payload, { botId: bot.id, threadId: 'thread-a', create: true })
    let finish
    const old = { dispatch: async action => action === 'threads.list' ? { threads: [row] } : new Promise(resolve => { finish = resolve }) }
    await render(view(old)); await click('.bp-threads-head'); await click('.bp-threads-menu-row:not([data-state=default])')
    assert.equal(typeof finish, 'function')
    await render(view({ dispatch: async () => ({ threads: [] }) }))
    await settle(() => finish({ sessionId: 'retired-host-session' }))
    assert.deepEqual(opened, ['host-confirmed-session'], 'the keyed header rejects a retired Host navigation')
    assert.equal(container.textContent.includes('实验记录'), false)
  })
})

test('a previously loaded thread header shows a later catalog storage failure', async () => {
  await withDom(async ({ render, container, click }) => {
    let failed = false
    const api = { dispatch: async () => {
      if (failed) throw Object.assign(new Error('private storage detail'), { code: 'BOT_THREADS_STORAGE_FAILED' })
      return { threads: [] }
    } }
    await render(React.createElement(ConversationTools, { sessionId: originalPart, bot, roster: { ...roster, byId: { [originalPart]: bot } }, actions: recorder([]), productApi: api }))
    failed = true
    await click('.bp-threads-head')
    assert.match(container.querySelector('[role=alert]').textContent, /修复存储后重启宿主/)
    assert.equal(container.textContent.includes('private storage detail'), false)
  })
})

test('Bot tools open native views and read-only destinations using the original part and Bot identities', async () => {
  await withDom(async ({ render, container, click }) => {
    const calls = []
    await render(React.createElement(ConversationTools, { sessionId: originalPart, bot, roster, actions: recorder(calls), running: true, onNavigate: target => calls.push(['navigate', target]) }))
    assert.equal(calls.length, 0)
    assert.match(container.querySelector('[data-chat-command=model]').textContent, /Fixture Exact/)
    assert.match(container.querySelector('[data-chat-command=model]').title, /fixture\/exact-model/)
    assert.match(container.querySelector('[data-chat-command=model]').title, /最近应用：fixture\/previous/)
    assert.ok(container.querySelector('[data-chat-command=model]').hasAttribute('data-model-different'))
    assert.ok(container.querySelector('[role=status][aria-label="正在处理"]'))
    for (const command of ['model', 'desktop', 'library', 'data', 'memory', 'tasks', 'voice']) {
      const prefix = ['model', 'desktop'].includes(command) ? '' : '.bp-conversation-shortcuts '
      await click(`${prefix}[data-chat-command=${command}]`)
    }
    assert.deepEqual(calls, [
      ['navigate', { section: 'bindings', botId: 'bot-a', compose: true }], ['details', originalPart, 'desktop'],
      ['navigate', { section: 'library', botId: 'bot-a' }], ['navigate', { section: 'data', botId: 'bot-a' }], ['memory', 'bot-a'],
      ['navigate', { section: 'tasks', botId: 'bot-a' }], ['voice', originalPart],
    ])
  })
})

test('group tools expose group details and memory without inventing a single Bot model or computer', async () => {
  await withDom(async ({ render, container, click }) => {
    const calls = [], room = { id: 'room-original', name: '研究小组', members: ['bot-a', 'bot-b'] }
    await render(React.createElement(ConversationTools, { sessionId: 'room:part-3', room, roster, actions: recorder(calls), onNavigate: target => calls.push(['navigate', target]) }))
    assert.equal(container.querySelector('[data-bot-id]'), null)
    assert.equal(container.querySelector('[data-chat-command=model]'), null)
    assert.equal(container.querySelector('[data-chat-command=desktop]'), null)
    assert.equal(container.querySelector('[data-chat-command=voice]'), null)
    assert.doesNotMatch(container.textContent, /Fixture Exact/)
    assert.match(container.querySelector('[data-chat-command=members]').textContent, /2 位成员/)
    await click('[data-chat-command=members]')
    await click('.bp-conversation-shortcuts [data-chat-command=memory]')
    await click('.bp-conversation-shortcuts [data-chat-command=tasks]')
    await click('.bp-conversation-shortcuts [data-chat-command=library]')
    assert.deepEqual(calls, [
      ['details', 'room:part-3', 'details'], ['memory', 'room-original'],
      ['navigate', { section: 'tasks' }], ['navigate', { section: 'library' }],
    ])
  })
})

test('the model badge reflects the Host applied record without treating a default or an unreported value as a fallback', async () => {
  await withDom(async ({ render, container }) => {
    const calls = [], actions = recorder(calls)
    const paint = current => render(React.createElement(ConversationTools, { sessionId: originalPart, bot: current, roster, actions }))
    await paint({ ...bot, appliedModel: bot.model })
    assert.equal(container.querySelector('[data-model-different]'), null)
    await paint({ id: bot.id, name: bot.name, appliedModel: 'fixture/exact-model' })
    assert.match(container.querySelector('[data-chat-command=model]').textContent, /Fixture Exact/)
    assert.match(container.querySelector('[data-chat-command=model]').title, /宿主未指定单独模型/)
    assert.equal(container.querySelector('[data-model-different]'), null)
    await paint({ id: bot.id, name: bot.name })
    assert.match(container.querySelector('[data-chat-command=model]').title, /尚未报告应用记录/)
    assert.deepEqual(calls, [], 'observing applied state never selects a model, saves or invokes')
  })
})

test('unavailable native actions and disabled memory leave no inert shortcuts', async () => {
  await withDom(async ({ render, container }) => {
    await render(React.createElement(ConversationTools, { sessionId: originalPart, bot, roster: { memory: false }, actions: {} }))
    assert.equal(container.querySelectorAll('button, summary').length, 0)
    await render(React.createElement(ConversationTools, { sessionId: 'outside-session', roster, actions: recorder([]) }))
    assert.equal(container.childElementCount, 0)
    await render(React.createElement(ConversationTools, { sessionId: 'ambiguous-session', bot, room: { id: 'room' }, roster, actions: recorder([]) }))
    assert.equal(container.childElementCount, 0)
    await render(React.createElement(ConversationTools, { sessionId: originalPart, bot: { ...bot, model: null, appliedModel: 'fixture/last-applied' }, roster, actions: recorder([]) }))
    assert.match(container.querySelector('[data-chat-command=model]').textContent, /fixture\/last-applied/)
    assert.equal(container.querySelector('[data-chat-command=library]'), null)
  })
})

test('an asynchronous failure is visible only in its original conversation and never redirects a later Bot', async () => {
  await withDom(async ({ render, container, click, settle }) => {
    const calls = []
    let rejectOld
    const onNavigate = target => {
      calls.push(target)
      if (target.botId === 'bot-a') return new Promise((resolve, reject) => { rejectOld = reject })
      throw new Error('新窗口暂不可用')
    }
    const actions = recorder([])
    await render(React.createElement(ConversationTools, { sessionId: originalPart, bot, roster, actions, onNavigate }))
    await click('.bp-conversation-shortcuts [data-chat-command=tasks]')
    assert.ok(container.querySelector('[data-chat-command=desktop]').disabled)
    await render(React.createElement(ConversationTools, { sessionId: 'bot-b:part-9', bot: { id: 'bot-b', name: '写作伙伴' }, roster, actions, onNavigate }))
    assert.equal(container.querySelector('[data-chat-command=desktop]').disabled, false)
    await settle(() => rejectOld(new Error('旧 Bot 的失败不可出现在新 Bot')))
    assert.equal(container.querySelector('[role=alert]'), null)
    await click('.bp-conversation-shortcuts [data-chat-command=tasks]')
    assert.match(container.querySelector('[role=alert]').textContent, /新窗口暂不可用/)
    assert.doesNotMatch(container.querySelector('[role=alert]').textContent, /旧 Bot/)
    await click('button[aria-label="关闭错误提示"]')
    assert.equal(container.querySelector('[role=alert]'), null)
    assert.deepEqual(calls, [{ section: 'tasks', botId: 'bot-a' }, { section: 'tasks', botId: 'bot-b' }])
  })
})

test('compact footer keeps resource links secondary and advanced workbench uses its own callback', async () => {
  await withDom(async ({ render, container, click, settle, key }) => {
    const destinations = [], advanced = []
    await render(React.createElement(ContactNavigation, { compact: true, onNavigate: target => destinations.push(target), onOpenAdvanced: () => advanced.push('open'), attentionCount: 101 }))
    assert.equal(container.querySelectorAll('.bp-contact-nav-row > button').length, 2)
    assert.equal(container.querySelector('.bp-contact-attention').textContent, '99+')
    assert.equal(container.querySelector('.bp-contact-resources').open, false)
    await click('[data-contact-nav=inbox]')
    await click('[data-contact-nav=home]')
    await settle(() => {
      container.querySelector('.bp-contact-resources').open = true
      container.querySelector('.bp-contact-resources-menu button').focus()
    })
    await key(document.activeElement, 'Escape', { isComposing: true })
    assert.equal(container.querySelector('.bp-contact-resources').open, true)
    await key(document.activeElement, 'Escape')
    assert.equal(container.querySelector('.bp-contact-resources').open, false)
    assert.equal(document.activeElement, container.querySelector('.bp-contact-resources > summary'))
    await click('.bp-contact-resources-menu button:first-child')
    await click('.bp-contact-advanced')
    assert.deepEqual(destinations, [{ section: 'inbox' }, { section: 'home' }, { section: 'notifications' }])
    assert.deepEqual(advanced, ['open'])
    await settle(() => document.dispatchEvent(new window.CustomEvent('bot-product:navigation', { detail: { id: 'bot-product-library' } })))
    assert.ok(container.querySelector('.bp-contact-resources > summary[data-active]'))
    const appearance = container.querySelector('.bp-appearance')
    await settle(() => { appearance.open = true; appearance.querySelector('button').focus() })
    await key(document.activeElement, 'Escape')
    assert.equal(appearance.open, false)
    assert.equal(document.activeElement, appearance.querySelector('summary'))
  })
})

test('native search/new dialogs are explicit, and rejected navigation never gets replayed', async () => {
  await withDom(async ({ render, container, click }) => {
    const calls = []
    await render(React.createElement(ContactToolbar, { actions: {
      openPalette: query => calls.push(['search', query]),
      openNewChat: mode => { calls.push(['new', mode]); return Promise.reject(null) },
    } }))
    assert.equal(calls.length, 0)
    await click('button[aria-label="搜索聊天"]')
    await click('button[aria-label="新建聊天"]')
    assert.deepEqual(calls, [['search', ''], ['new', 'new']])
    assert.match(container.querySelector('[role=alert]').textContent, /打开新建聊天失败：未知错误/)
    await render(React.createElement(ContactNavigation, { onNavigate: () => { throw new Error('目标面板不可用') } }))
    assert.equal(container.querySelector('.bp-contact-advanced'), null)
    await click('[data-contact-nav=home]')
    assert.match(container.querySelector('[role=alert]').textContent, /目标面板不可用/)
    assert.deepEqual(calls, [['search', ''], ['new', 'new']])
  })
})

test('chat styling parses without CSS warnings', async () => {
  const css = await readFile('apps/integration-client/chat.css', 'utf8')
  const result = await transform(css, { loader: 'css', minify: true })
  assert.deepEqual(result.warnings, [])
})
