import './helpers/ui-dom-bootstrap.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'

const parent = resolve('tmp/integration/task-workspace'); await mkdir(parent, { recursive: true })
const dir = await mkdtemp(join(parent, 'ui-')), file = join(dir, 'panels.mjs')
const compiled = await build({ entryPoints: ['apps/integration-client/panels.jsx'], bundle: true, format: 'esm', platform: 'node', external: ['react', 'react-dom', 'react-dom/*'], write: false , loader: { '.css': 'text' } })
await writeFile(file, compiled.outputFiles[0].contents)
const { Tasks, ProductPage } = await import(pathToFileURL(file))
const snapshot = items => ({ schemaVersion: 1, observedAt: '2026-11-07T00:00:00Z', readOnly: null,
  bots: [{ id: 'a', name: '研究 Bot', sessionId: 'session-a' }, { id: 'b', name: '执行 Bot', sessionId: 'session-b' }],
  availableActions: [], tasks: { status: 'available', items } })
const task = (id, state = 'failed', botId = 'a') => ({ taskId: id, botId, state, title: `工作 ${id}`, updatedAt: 100, attempts: 1 })
const detail = row => ({ task: row, attempts: [{ attemptId: 'original-attempt', number: 1, operationId: 'original-operation', state: row.state }],
  timeline: { total: 1, truncated: false, items: [{ seq: 1, at: 100, kind: 'cancel-requested', attemptNumber: 1 }] } })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

async function domFixture(work) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://tasks.fixture/' })
  const globals = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client'), container = document.getElementById('root'), root = createRoot(container)
  const settle = async work => act(async () => { await work(); await new Promise(setImmediate) })
  const render = async props => settle(() => root.render(React.createElement(Tasks, props)))
  const renderPage = async api => settle(() => root.render(React.createElement(ProductPage, { section: 'tasks', productApi: api })))
  const button = label => [...container.querySelectorAll('button')].find(element => element.textContent.trim() === label)
  const click = async label => { const target = button(label); assert.ok(target, label); await settle(() => target.click()) }
  const search = async value => settle(() => {
    const input = container.querySelector('input[type=search]')
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try { await work({ container, render, renderPage, click, search, button, settle }) }
  finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
}

test('workspace counts all nine pending items, expands beyond six and opens a task even without a reconcile handler', async () => {
  await domFixture(async ({ render, container, click }) => {
    const value = snapshot([task('unknown', 'needs-reconciliation'), ...Array.from({ length: 8 }, (_, i) => task(`failed-${i}`))])
    await render({ snapshot: value })
    const attention = container.querySelector('[aria-label="需要你处理"]')
    assert.match(attention.textContent, /9 项需要你处理/); assert.equal(attention.querySelectorAll('li').length, 6)
    await click('查看全部 9 项待处理'); assert.equal(attention.querySelectorAll('li').length, 9)
    const open = attention.querySelector('button'); await act(async () => open.click())
    assert.match(container.querySelector('[aria-label="任务详情"]').textContent, /unknown/)
    assert.equal(container.querySelector('[aria-label="任务详情"]'), document.activeElement)
    assert.match(container.textContent, /此宿主尚未提供任务时间线/)
  })
})

test('workspace combines status, Bot and search filters; reminders open detail outside the current table filter', async () => {
  await domFixture(async ({ render, container, click, search, settle }) => {
    const value = snapshot([task('failed'), task('current', 'running', 'b'), task('done', 'succeeded', 'b')])
    value.tasks.truncated = true; value.tasks.total = 700
    await render({ snapshot: value })
    assert.match(container.textContent, /已加载 3 \/ 700/)
    const status = container.querySelector('[aria-label="按状态筛选任务"] button:nth-child(2)'); await settle(() => status.click())
    assert.equal(container.querySelectorAll('tbody tr').length, 1)
    assert.match(container.querySelector('tbody').textContent, /工作 current/)
    await search('不存在'); assert.equal(container.querySelector('tbody'), null)
    await click('打开任务'); assert.match(container.querySelector('[aria-label="任务详情"]').textContent, /工作 failed/)
    await click('清除筛选'); assert.equal(container.querySelectorAll('tbody tr').length, 3)
    const bot = [...container.querySelectorAll('[aria-label="按 Bot 筛选任务"] button')].find(element => element.textContent.startsWith('执行 Bot'))
    await settle(() => bot.click()); assert.equal(container.querySelectorAll('tbody tr').length, 2)
  })
})

test('approval opens the original Bot conversation and an unconfirmed terminal operation offers detail without an inapplicable reconciliation call', async () => {
  await domFixture(async ({ render, click, container }) => {
    const value = snapshot([task('approval', 'waiting-approval', 'b'), { ...task('remote'), result: { remote: { stopConfirmed: false, possiblyApplied: true } } }])
    value.availableActions = ['task.reconcile', 'task.retry']
    const calls = [], sessions = []
    await render({ snapshot: value, dispatch: async (...args) => calls.push(args), openSession: id => sessions.push(id) })
    await click('打开审批会话'); assert.deepEqual(sessions, ['session-b']); assert.equal(calls.length, 0)
    const remote = [...container.querySelectorAll('.bp-attention-row')].find(element => element.textContent.includes('工作 remote'))
    assert.deepEqual([...remote.querySelectorAll('button')].map(element => element.textContent), ['打开任务'])
    assert.equal(calls.length, 0)
  })
})

test('task timeline ignores a delayed result after selecting another task and rejects a mismatched task identity', async () => {
  await domFixture(async ({ render, click, container, settle }) => {
    const a = task('a'), b = task('b', 'running', 'b'), value = snapshot([a, b]), old = deferred(), next = deferred(), calls = []
    value.availableActions = ['task.inspect']
    const inspect = (payload, signal) => { calls.push({ payload, signal }); return payload.taskId === 'a' ? old.promise : next.promise }
    await render({ snapshot: value, inspect })
    await click('工作 a'); await click('工作 b')
    assert.equal(calls[0].signal.aborted, true)
    await settle(() => next.resolve(detail(b))); await settle(() => old.resolve(detail(a)))
    const shown = container.querySelector('[aria-label="任务详情"]')
    assert.match(shown.textContent, /工作 b/); assert.match(shown.textContent, /已请求停止，等待确认/)
    assert.doesNotMatch(shown.textContent, /工作 a/)
    await render({ snapshot: value, inspect: async () => detail({ ...b, botId: 'wrong-bot' }) })
    assert.match(container.textContent, /返回记录与当前任务不一致/)
    assert.equal(container.querySelector('.bp-task-timeline'), null)
  })
})

test('product page reads history without refreshing or mutating and discards it when the Host changes', async () => {
  await domFixture(async ({ renderPage, click, container, settle }) => {
    const a = task('a'), value = snapshot([a]), pending = deferred(), calls = []
    value.availableActions = ['task.inspect']
    let snapshots = 0
    const first = { snapshot: async () => { snapshots++; return value }, dispatch: async (action, payload) => { calls.push({ action, payload }); return pending.promise } }
    await renderPage(first); await click('工作 a')
    assert.deepEqual(calls, [{ action: 'task.inspect', payload: { botId: 'a', taskId: 'a' } }]); assert.equal(snapshots, 1)
    const replacement = { snapshot: async () => snapshot([task('new-host')]), dispatch: async () => { throw new Error('must not read the old task on a new Host') } }
    await renderPage(replacement); await settle(() => pending.resolve(detail(a)))
    assert.equal(container.querySelector('[aria-label="任务详情"]'), null)
    assert.doesNotMatch(container.textContent, /original-operation/); assert.equal(calls.length, 1)
  })
})

test('a notification can read an older task outside the loaded list and locate the original attempt without offering current-attempt actions',async()=>{
  await domFixture(async({render,container})=>{
    const value=snapshot([task('other','running')]);value.tasks.total=700;value.tasks.truncated=true;value.availableActions=['task.inspect','task.retry','task.cancel']
    const original={...task('older'),attemptId:'latest-attempt'},calls=[]
    const history={task:original,attempts:[{attemptId:'original-attempt',number:1,state:'failed',operationId:'original-operation'},{attemptId:'latest-attempt',number:2,state:'failed',operationId:'latest-operation'}],
      timeline:{total:2,truncated:false,items:[{seq:1,kind:'settled',attemptId:'original-attempt',at:100},{seq:2,kind:'settled',attemptId:'latest-attempt',at:200}]}}
    await render({snapshot:value,submissionScope:{},focus:{version:1,botId:'a',taskId:'older',attemptId:'original-attempt'},inspect:async payload=>{calls.push(payload);return history},dispatch:async()=>assert.fail('opening history cannot execute an action')})
    assert.deepEqual(calls,[{botId:'a',taskId:'older'}])
    const shown=container.querySelector('[aria-label="任务详情"]');assert.match(shown.textContent,/工作 older/);assert.match(shown.textContent,/当前任务已进入后续尝试/)
    assert.match(shown.querySelector('[aria-label="所选原执行尝试"]').textContent,/original-attempt.*original-operation/)
    assert.equal(shown.querySelectorAll('li[data-focused-attempt]').length,1)
    assert.equal([...shown.querySelectorAll('button')].some(button=>['重试','停止'].includes(button.textContent)),false)
    assert.equal(container.querySelectorAll('tbody tr').length,1);assert.match(container.querySelector('tbody').textContent,/other/)
  })
})

test('an unknown attempt remains unresolved instead of silently switching to the current attempt',async()=>{
  await domFixture(async({render,container})=>{
    const row={...task('one'),attemptId:'original-attempt'},value=snapshot([row]);value.availableActions=['task.inspect','task.retry']
    await render({snapshot:value,submissionScope:{},focus:{version:1,botId:'a',taskId:'one',attemptId:'missing-attempt'},inspect:async()=>detail(row)})
    const shown=container.querySelector('[aria-label="任务详情"]');assert.match(shown.textContent,/未找到所选的原执行尝试/)
    assert.equal(shown.querySelector('[aria-label="所选原执行尝试"]'),null);assert.equal([...shown.querySelectorAll('button')].some(button=>button.textContent==='重试'),false)
  })
})

test('a late lookup outside the loaded list cannot cross a Host replacement',async()=>{
  await domFixture(async({render,container,settle})=>{
    const value=snapshot([]),pending=deferred(),signals=[];value.availableActions=['task.inspect']
    await render({snapshot:value,submissionScope:{},focus:{version:1,botId:'a',taskId:'older'},inspect:(_payload,signal)=>{signals.push(signal);return pending.promise}})
    await render({snapshot:snapshot([task('new-host')]),submissionScope:{}});assert.equal(signals[0].aborted,true)
    await settle(()=>pending.resolve(detail(task('older'))));assert.equal(container.querySelector('[aria-label="任务详情"]'),null);assert.doesNotMatch(container.textContent,/original-operation/)
  })
})
