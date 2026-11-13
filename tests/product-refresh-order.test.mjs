import './helpers/ui-dom-bootstrap.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { build } from 'esbuild'

const rootDir = resolve(import.meta.dirname, '..')
const fixtureRequire = createRequire(join(rootDir, 'tests/fixtures/integration-host/package.json'))
const { JSDOM } = fixtureRequire('jsdom')
const parent = join(rootDir, 'tmp/integration/product-refresh-order'); await mkdir(parent, { recursive: true })
const dir = await mkdtemp(join(parent, 'components-'))
const bundle = await build({ absWorkingDir: rootDir, entryPoints: ['apps/integration-client/panels.jsx'], bundle: true, format: 'esm', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/*'], write: false , loader: { '.css': 'text' } })
const file = join(dir, 'panels.mjs'); await writeFile(file, bundle.outputFiles[0].text)
const { ProductPage } = await import(pathToFileURL(file))

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function apiFixture() {
  const requests = [], actions = []
  return { requests, actions, api: {
    snapshot() { const request = deferred(); requests.push(request); return request.promise },
    dispatch(action, payload) { const request = deferred(); actions.push({ action, payload, request }); return request.promise },
  } }
}
const sample = title => ({ schemaVersion: 1, observedAt: '2026-10-30T00:00:00Z', readOnly: null,
  bots: [{ id: 'bot-a', name: 'Bot A' }], availableActions: ['task.cancel', 'task.retry'],
  tasks: { status: 'available', items: [{ taskId: 'task-a', botId: 'bot-a', state: 'failed', title }] } })
const page = api => React.createElement(ProductPage, { section: 'tasks', productApi: api, openSession() {}, openPanel() {} })

async function withDom(work) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  const previous = Object.fromEntries(['window', 'document', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  const container = dom.window.document.getElementById('root')
  let root = createRoot(container)
  const mount = async api => act(async () => root.render(page(api)))
  const unmount = async () => { if (root) { const old = root; root = null; await act(async () => old.unmount()) } }
  const remount = async api => { root = createRoot(container); await mount(api) }
  const click = async text => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === (text === '刷新' ? '刷新当前页面' : text))
    assert.ok(button, `button not found: ${text}`)
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  }
  const settle = async (request, method, value) => act(async () => { request[method](value); await Promise.resolve() })
  try { await work({ container, mount, unmount, remount, click, settle }) }
  finally { await unmount(); dom.window.close(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } }
}

test('a delayed older success and failure cannot replace the newest successful snapshot', async () => {
  await withDom(async ({ container, mount, click, settle }) => {
    const f = apiFixture(); await mount(f.api)
    await settle(f.requests[0], 'resolve', sample('初始记录'))
    await click('刷新'); await click('刷新')
    await settle(f.requests[2], 'resolve', sample('较新记录'))
    await settle(f.requests[1], 'resolve', sample('过期记录'))
    assert.match(container.textContent, /较新记录/); assert.doesNotMatch(container.textContent, /过期记录/)
    await click('刷新'); await click('刷新')
    await settle(f.requests[4], 'resolve', sample('最终记录'))
    await settle(f.requests[3], 'reject', new Error('过期失败'))
    assert.match(container.textContent, /最终记录/); assert.doesNotMatch(container.textContent, /过期失败/)
    assert.equal(f.actions.length, 0)
  })
})

test('a newest failed refresh keeps the old view disabled until a later successful read', async () => {
  await withDom(async ({ container, mount, click, settle }) => {
    const f = apiFixture(); await mount(f.api)
    await settle(f.requests[0], 'resolve', sample('已保存视图'))
    await click('刷新'); await click('刷新')
    await settle(f.requests[2], 'reject', new Error('离线'))
    await settle(f.requests[1], 'resolve', sample('过期成功'))
    assert.match(container.textContent, /离线/); assert.match(container.textContent, /已保存视图/)
    assert.doesNotMatch(container.textContent, /过期成功/)
    assert.equal([...container.querySelectorAll('button')].find(item => item.textContent === '重试').disabled, true)
    await click('刷新'); await settle(f.requests[3], 'resolve', sample('已重连'))
    assert.match(container.textContent, /已重连/); assert.doesNotMatch(container.textContent, /离线/)
    assert.equal([...container.querySelectorAll('button')].find(item => item.textContent === '重试').disabled, false)
    assert.equal(f.actions.length, 0)
  })
})

test('unmount and remount discard an old snapshot and never dispatch on their own', async () => {
  await withDom(async ({ container, mount, unmount, remount, settle }) => {
    const old = apiFixture(), next = apiFixture(); await mount(old.api)
    await unmount(); await remount(next.api)
    await settle(next.requests[0], 'resolve', sample('新实例'))
    await settle(old.requests[0], 'resolve', sample('已卸载实例'))
    assert.match(container.textContent, /新实例/); assert.doesNotMatch(container.textContent, /已卸载实例/)
    assert.equal(old.actions.length + next.actions.length, 0)
  })
})

test('a user action finishing after unmount does not refresh the retired instance', async () => {
  await withDom(async ({ mount, unmount, click, settle }) => {
    const f = apiFixture(); await mount(f.api)
    await settle(f.requests[0], 'resolve', sample('可重试'))
    await click('重试'); assert.equal(f.actions.length, 1)
    await unmount(); await settle(f.actions[0].request, 'resolve', {})
    assert.equal(f.requests.length, 1, 'retired instances must not start a post-action refresh')
    assert.equal(f.actions.length, 1)
  })
})

test('an older refresh cannot restore a pre-action snapshot after the action refresh', async () => {
  await withDom(async ({ container, mount, click, settle }) => {
    const f = apiFixture(); await mount(f.api)
    await settle(f.requests[0], 'resolve', sample('原状态'))
    await click('刷新')
    await click('重试'); assert.equal(f.actions.length, 1)
    await settle(f.actions[0].request, 'resolve', {})
    assert.equal(f.requests.length, 3, 'the completed action requests one fresh snapshot')
    await settle(f.requests[2], 'resolve', sample('操作后状态'))
    await settle(f.requests[1], 'resolve', sample('旧的操作前状态'))
    assert.match(container.textContent, /操作后状态/); assert.doesNotMatch(container.textContent, /旧的操作前状态/)
    assert.equal(f.actions.length, 1)
  })
})

test('changing the product API disables the old view and retires its in-flight action', async () => {
  await withDom(async ({ container, mount, click, settle }) => {
    const old = apiFixture(), next = apiFixture(); await mount(old.api)
    await settle(old.requests[0], 'resolve', sample('旧宿主'))
    await click('重试'); assert.equal(old.actions.length, 1)
    await mount(next.api)
    assert.equal([...container.querySelectorAll('button')].find(item => item.textContent === '重试').disabled, true)
    await settle(old.actions[0].request, 'resolve', {})
    assert.equal(old.requests.length, 1, 'an action from the old API cannot refresh it after replacement')
    await settle(next.requests[0], 'resolve', sample('新宿主'))
    assert.match(container.textContent, /新宿主/)
    assert.equal([...container.querySelectorAll('button')].find(item => item.textContent === '重试').disabled, false)
    assert.equal(next.actions.length, 0)
  })
})

test('an action rejection or lost response disables old controls without automatic replay until a fresh read', async () => {
  await withDom(async ({ container, mount, click, settle }) => {
    const f = apiFixture(); await mount(f.api)
    await settle(f.requests[0], 'resolve', sample('操作前'))
    await click('刷新')
    await click('重试'); assert.equal(f.actions.length, 1)
    await settle(f.actions[0].request, 'reject', new Error('响应丢失'))
    await settle(f.requests[1], 'resolve', sample('动作前的迟到快照'))
    assert.match(container.textContent, /响应丢失/)
    assert.doesNotMatch(container.textContent, /动作前的迟到快照/)
    const retry = [...container.querySelectorAll('button')].find(item => item.textContent === '重试')
    assert.equal(retry.disabled, true)
    assert.equal(f.requests.length, 2, 'an action failure does not silently repeat or refresh')
    assert.equal(f.actions.length, 1)
    await click('刷新'); await settle(f.requests[2], 'resolve', sample('重新读取'))
    assert.match(container.textContent, /重新读取/); assert.doesNotMatch(container.textContent, /响应丢失/)
    assert.equal([...container.querySelectorAll('button')].find(item => item.textContent === '重试').disabled, false)
    assert.equal(f.actions.length, 1, 'reconnection only reads and never resends the operation')
  })
})
