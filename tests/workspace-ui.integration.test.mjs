import './helpers/ui-dom-bootstrap.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { chatSettingsFixture } from './fixtures/chat-settings-data.mjs'

const parent = resolve('tmp/integration/workspace-upgrade'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'components-')), output = join(directory, 'workspace.mjs')
const bundle = await build({ stdin: { contents: "export * from './apps/integration-client/panels.jsx'; export * from './apps/integration-client/workspace-ui.jsx'; export * from './apps/integration-client/workspace-navigation.mjs'", resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-dom/*'], write: false , loader: { '.css': 'text' } })
await writeFile(output, bundle.outputFiles[0].contents)
const { ProductPage, Tasks, workspaceNavigation, workspaceAppearance, installWorkspaceAppearance } = await import(pathToFileURL(output))

test('the registered product page owns its compact toolbar and opens only the current Host committed Bot settings',async()=>{
  await withDom(async({render,container,click})=>{
    const snapshot=sample();snapshot.mainBotId='a';snapshot.availableActions=['binding.inspect']
    const binding=chatSettingsFixture(snapshot.bots[0]),opened=[]
    const api={snapshot:async()=>snapshot,dispatch:binding.dispatch}
    await render(React.createElement(ProductPage,{section:'machines',productApi:api,openPanel:id=>opened.push(id)}))
    assert.equal(container.querySelectorAll('h1').length,1)
    assert.equal(container.querySelector('h1').textContent,'电脑')
    assert.equal(container.querySelectorAll('.bp-page-header,.preview-shell').length,0)
    assert.equal(binding.calls.length,0,'opening a product page cannot change a binding')
    await click('Bot 设置')
    assert.ok(document.querySelector('.bp-bot-settings-dialog'))
    assert.ok(binding.calls.every(call=>call.action==='binding.inspect'&&call.payload.botId==='a'))
    await render(React.createElement(ProductPage,{section:'machines',productApi:{snapshot:async()=>snapshot,dispatch:async()=>assert.fail('a stale dialog must not call a replacement Host')},openPanel:id=>opened.push(id)}))
    assert.equal(document.querySelector('.bp-bot-settings-dialog'),null)
    assert.ok(binding.calls.every(call=>call.action==='binding.inspect'))
  })
})

const sample = () => ({ schemaVersion: 1, observedAt: '2026-11-07T12:00:00Z', readOnly: null,
  bots: [{ id: 'a', name: '研究伙伴', main: true, role: '查找证据', model: 'fixture/exact', sessionId: 'session-a' }, { id: 'b', name: '写作伙伴', role: '整理文字', model: 'fixture/exact', sessionId: 'session-b' }],
  tasks: { status: 'available', truncated: true, total: 20, items: [
    { taskId: 'same', botId: 'a', title: '研究当前方案', state: 'running', updatedAt: 100 },
    { taskId: 'same', botId: 'b', title: '写作待核对', state: 'needs-reconciliation', operationId: 'operation-b', updatedAt: 200 },
    { taskId: 'approval', botId: 'a', title: '审批原始任务', state: 'waiting-approval', updatedAt: 300 },
  ] }, machines: { status: 'available', items: [] }, availableActions: [] })

async function withDom(work) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://workspace.fixture/' })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client'), container = document.getElementById('root'), root = createRoot(container)
  const settle = async work => act(async () => { await work(); await new Promise(setImmediate) })
  const render = element => settle(() => root.render(element))
  const button = label => [...container.querySelectorAll('button')].find(element => element.textContent.trim() === label || element.getAttribute('aria-label') === label)
  const click = async label => { const element = button(label); assert.ok(element, label); await settle(() => element.click()) }
  const type = async (selector, text) => settle(() => {
    const element = container.querySelector(selector); assert.ok(element, selector)
    const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const key = async (element, name, options = {}) => settle(() => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })))
  try { await work({ container, root, dom, settle, render, button, click, type, key }) }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } }
}

test('home and inbox use loaded records and opening the original approval conversation performs no mutation', async () => {
  await withDom(async ({ render, container, click }) => {
    const snapshot = sample(), calls = [], sessions = []
    const api = { snapshot: async () => snapshot, dispatch: async (...args) => calls.push(args) }
    const props = { productApi: api, openSession: id => sessions.push(id), openPanel() {} }
    await render(React.createElement(ProductPage, { ...props, section: 'home' }))
    assert.match(container.textContent, /已加载的 3 \/ 20/)
    assert.match(container.textContent, /写作待核对/)
    assert.equal(calls.length, 0)
    await click('打开审批会话')
    assert.deepEqual(sessions, ['session-a']); assert.equal(calls.length, 0)
    await render(React.createElement(ProductPage, { ...props, section: 'inbox' }))
    await click('收据待核对 1')
    assert.equal(container.querySelectorAll('.bp-inbox-item').length, 1)
    assert.match(container.querySelector('.bp-inbox-item').textContent, /写作待核对/)
    assert.equal(calls.length, 0)
  })
})

test('a home goal reaches the preview composer once without creating work, including after remount', async () => {
  await withDom(async ({ render, container, click, type, settle }) => {
    const snapshot = sample(), calls = [], opened = []
    snapshot.availableActions = ['botRoutingInspect']
    const api = { snapshot: async () => snapshot, dispatch: async (action, payload) => {
      calls.push({ action, payload })
      if (action === 'botRoutingInspect') return { enabled: true, preset: 'balanced', candidates: [{ botId: 'a', name: '研究伙伴' }], settingsRevision: 1 }
      throw new Error('Unexpected mutation')
    } }
    const props = { productApi: api, openPanel: id => opened.push(id), openSession() {} }
    await render(React.createElement(ProductPage, { ...props, section: 'home' }))
    await type('#bp-workspace-goal', '只在确认后执行的新目标')
    await click('准备任务')
    assert.deepEqual(opened, ['bot-product-tasks']); assert.equal(calls.length, 0)
    await render(React.createElement(ProductPage, { ...props, section: 'tasks' }))
    assert.equal(container.querySelector('.bp-task-composer textarea').value, '只在确认后执行的新目标')
    assert.equal(document.activeElement, container.querySelector('.bp-task-composer textarea'))
    assert.deepEqual(calls.map(row => row.action), ['botRoutingInspect'])
    await settle(() => container.querySelector('textarea').focus())
    await type('.bp-task-composer textarea', '用户继续修改过的目标')
    await render(null)
    await render(React.createElement(ProductPage, { ...props, section: 'tasks' }))
    assert.equal(container.querySelector('.bp-task-composer textarea').value, '用户继续修改过的目标', 'same-Host navigation retains the edited draft without replaying the home transfer')
    assert.equal(calls.some(row => row.action === 'botRouting.dispatch'), false)
  })
})

test('search handles Chinese IME, focus trapping, Escape restoration and the exact selected task', async () => {
  await withDom(async ({ render, container, click, type, key }) => {
    const api = { snapshot: async () => sample(), dispatch: async () => { throw new Error('Search cannot mutate') } }, opened = []
    const props = { productApi: api, openPanel: id => opened.push(id), openSession() {} }
    await render(React.createElement(ProductPage, { ...props, section: 'home' }))
    const trigger = container.querySelector('button[aria-label="搜索工作空间"]'); trigger.focus()
    await click('搜索工作空间')
    const input = container.querySelector('input[role=combobox]')
    assert.equal(document.activeElement, input)
    await type('input[role=combobox]', 'operation-b')
    await key(input, 'Enter', { isComposing: true })
    assert.ok(container.querySelector('.bp-palette')); assert.equal(opened.length, 0)
    await key(input, 'Tab'); assert.equal(document.activeElement.getAttribute('aria-label'), '关闭搜索')
    await key(document.activeElement, 'Tab'); assert.equal(document.activeElement, input)
    await key(input, 'Escape'); assert.equal(container.querySelector('.bp-palette'), null); assert.equal(document.activeElement, trigger)
    await key(trigger, 'k', { ctrlKey: true })
    await type('input[role=combobox]', 'operation-b')
    await key(container.querySelector('input[role=combobox]'), 'Enter')
    assert.deepEqual(opened, ['bot-product-tasks'])
    await render(React.createElement(ProductPage, { ...props, section: 'tasks' }))
    const detail = container.querySelector('[aria-label="任务详情"]')
    assert.match(detail.textContent, /写作待核对/); assert.match(detail.textContent, /operation-b/)
    assert.doesNotMatch(detail.textContent, /研究当前方案/)
  })
})

test('workspace search leaves keyboard shortcuts with a controlled remote canvas',async()=>{
  await withDom(async({render,container,key})=>{
    await render(React.createElement(ProductPage,{section:'home',productApi:{snapshot:async()=>sample(),dispatch:async()=>assert.fail('keyboard navigation cannot execute tasks')}}))
    const canvas=document.createElement('canvas');canvas.className='bp-stream-canvas';canvas.dataset.control='true';canvas.tabIndex=0
    container.querySelector('.bp-page-body').append(canvas);let received=0
    canvas.addEventListener('keydown',event=>{if(!event.defaultPrevented)received++})
    await key(canvas,'k',{ctrlKey:true});assert.equal(received,1);assert.equal(container.querySelector('.bp-palette'),null)
    canvas.dataset.control='false';await key(canvas,'k',{ctrlKey:true});assert.ok(container.querySelector('.bp-palette'));assert.equal(received,1)
  })
})

test('board shares filters and cannot retry an operation whose stop is unconfirmed', async () => {
  await withDom(async ({ render, container, click, settle }) => {
    const snapshot = sample(), calls = []
    snapshot.tasks.items[1] = { ...snapshot.tasks.items[1], state: 'failed', result: { remote: { stopConfirmed: false, possiblyApplied: true } } }
    snapshot.availableActions = ['task.retry']
    await render(React.createElement(Tasks, { snapshot, dispatch: (...args) => calls.push(args), scope: {} }))
    await click('看板')
    const uncertain = container.querySelector('[data-lane=attention] .bp-board-card')
    assert.match(uncertain.textContent, /写作待核对/)
    const retry = [...uncertain.querySelectorAll('button')].find(element => element.textContent === '重试')
    assert.equal(retry.disabled, true)
    await click('写作待核对'); assert.match(container.querySelector('[aria-label="任务详情"]').textContent, /operation-b/)
    assert.equal(calls.length, 0)
    await settle(() => [...container.querySelectorAll('[aria-label="按状态筛选任务"] button')].find(element => element.textContent.endsWith('进行中')).click())
    assert.equal(container.querySelectorAll('.bp-board-card').length, 1)
    assert.match(container.querySelector('.bp-board-card').textContent, /研究当前方案/)
  })
})

test('Host replacement cannot carry a previous task address or goal into a different Host', async () => {
  await withDom(async ({ render, container }) => {
    const first = { snapshot: async () => sample(), dispatch: async () => {} }, second = { snapshot: async () => sample(), dispatch: async () => {} }
    workspaceNavigation(first).navigate({ section: 'tasks', taskId: 'same', botId: 'b', compose: true, draft: '原宿主私有目标' })
    await render(React.createElement(ProductPage, { section: 'tasks', productApi: first }))
    assert.ok(container.querySelector('[aria-label="任务详情"]'))
    await render(React.createElement(ProductPage, { section: 'tasks', productApi: second }))
    assert.equal(container.querySelector('[aria-label="任务详情"]'), null)
    assert.equal(workspaceNavigation(second).getSnapshot(), null)
    assert.doesNotMatch(container.textContent, /原宿主私有目标/)
  })
})

test('appearance stores only display preferences and restores the body on plugin disposal', async () => {
  await withDom(async ({ dom }) => {
    document.body.setAttribute('data-bp-density', 'existing')
    document.body.setAttribute('data-bp-chat-width', 'existing-width')
    const dispose = installWorkspaceAppearance(dom.window), store = workspaceAppearance(dom.window)
    store.set({ appearance: 'dark', density: 'compact', chatWidth: 'full', colorUserBubbles: false, task: 'must not persist' })
    assert.equal(document.body.getAttribute('data-bp-appearance'), 'dark')
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('dsh.bot.workspace.appearance.v1')), { appearance: 'dark', density: 'compact', chatWidth: 'full', colorUserBubbles: false })
    assert.equal(document.body.getAttribute('data-bp-chat-width'), 'full')
    assert.equal(document.body.getAttribute('data-bp-user-bubbles'), 'neutral')
    dom.window.localStorage.setItem('dsh.bot.workspace.appearance.v1', '{broken')
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'dsh.bot.workspace.appearance.v1' }))
    assert.equal(document.body.getAttribute('data-bp-appearance'), 'host')
    assert.equal(document.body.getAttribute('data-bp-chat-width'), 'standard')
    dom.window.localStorage.setItem('dsh.bot.workspace.appearance.v1', JSON.stringify({ appearance: 'dark', density: 'compact' }))
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'dsh.bot.workspace.appearance.v1' }))
    assert.equal(document.body.getAttribute('data-bp-appearance'), 'dark', 'legacy display preferences keep their theme')
    assert.equal(document.body.getAttribute('data-bp-density'), 'compact')
    assert.equal(document.body.getAttribute('data-bp-chat-width'), 'standard')
    assert.equal(document.body.getAttribute('data-bp-user-bubbles'), 'colored')
    dispose()
    assert.equal(document.body.hasAttribute('data-bp-appearance'), false)
    assert.equal(document.body.getAttribute('data-bp-density'), 'existing')
    assert.equal(document.body.getAttribute('data-bp-chat-width'), 'existing-width')
    assert.equal(document.body.hasAttribute('data-bp-user-bubbles'), false)
  })
})
