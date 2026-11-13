import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'

const parent = resolve('tmp/integration/cli-chat-ui'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'components-')), file = join(directory, 'cli-chat-providers.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/cli-chat-providers.jsx'], bundle: true, platform: 'node', format: 'esm',
  external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' } })
await writeFile(file, bundle.outputFiles[0].contents)

const drivers = [
  { id: 'codex', name: 'Codex', transport: 'app-server', implemented: true, hostTools: false, credentialHint: '使用自己的 CLI 账号。', credentialTemplate: { files: { 'auth.json': { placeholder: '填写本机账号资料' } } } },
  { id: 'cursorAgent', name: 'Cursor', transport: 'acp', implemented: true, hostTools: false },
  { id: 'deepseekAgent', name: 'DeepSeek Harness', transport: 'acp', implemented: true, available: false, reason: '此驱动没有可用的订阅路线。', hostTools: false },
]
const profile = { id: 'fixture-cli', revision: 7, driver: 'codex', name: 'Codex 个人账号', provider: 'bot-cli-fixture', model: 'gpt-fixture', enabled: true,
  entry: { executable: 'C:\\Tools\\codex.exe', version: '1.2.3' }, credentialConfigured: true, usedBy: [], state: 'configured' }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture({ profiles = [profile], handler } = {}) {
  let saved = structuredClone(profiles)
  const calls = []
  return { calls, dispatch: async (action, payload, signal) => {
    calls.push({ action, payload: structuredClone(payload), signal })
    if (handler) { const value = handler(action, payload, signal); if (value !== undefined) return value }
    if (action === 'cliProviders.list') return { schemaVersion: 1, profiles: structuredClone(saved), drivers: structuredClone(drivers) }
    if (action === 'cliProviders.inspect') return { versionVerified: true, entry: payload.entry }
    if (action === 'cliProviders.save') {
      const item = { ...payload, id: payload.id ?? 'new-cli', revision: payload.expectedRevision + 1, credentialConfigured: true, state: 'configured', usedBy: [] }
      delete item.credentialJson; delete item.clearCredential; delete item.importLocalAccount
      saved = [item]; return { id: item.id, revision: item.revision }
    }
    if (action === 'cliProviders.remove') { saved = []; return { removed: true } }
    throw new Error('Unexpected action: ' + action)
  } }
}
async function withDom(work) {
  const dom = new JSDOM('<!doctype html><html><body data-bot-product-ui="1"><div class="bp-ai" id="root"></div></body></html>', { url: 'http://cli-chat.fixture/' })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { CliChatProviders } = await import(pathToFileURL(file)), { createRoot } = await import('react-dom/client')
  const container = document.getElementById('root'), root = createRoot(container)
  const render = async props => act(async () => { root.render(React.createElement(CliChatProviders, props)); await new Promise(setImmediate) })
  const field = label => container.querySelector(`[aria-label="${label}"]`)
  const button = text => [...container.querySelectorAll('button')].find(item => item.textContent.trim() === text)
  const click = async text => {
    const item = button(text); assert.ok(item, 'button: ' + text); assert.equal(item.disabled, false, 'button enabled: ' + text)
    await act(async () => { item.click(); await new Promise(setImmediate) })
  }
  const fill = async (label, value) => act(async () => {
    const input = field(label); assert.ok(input, 'input: ' + label)
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await new Promise(setImmediate)
  })
  const toggle = async label => act(async () => { const input = field(label); assert.ok(input); input.click(); await new Promise(setImmediate) })
  const flush = async () => act(async () => { await new Promise(setImmediate) })
  try { await work({ dom, container, render, field, button, click, fill, toggle, flush }) }
  finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
}

test('CLI chat settings show configured versus verified and editing never reads back saved credentials', async () => {
  await withDom(async ({ container, render, field, click, fill }) => {
    const api = fixture(); await render({ productApi: api })
    assert.match(container.textContent, /已配置 · 待验证对话/)
    assert.match(container.textContent, /原生文本聊天/)
    assert.doesNotMatch(container.textContent, /就绪 · 已验证对话/)
    await click('管理 CLI 聊天')
    const secret = field('CLI 登录资料 JSON')
    assert.equal(secret.type, 'password'); assert.equal(secret.value, '')
    assert.equal(secret.autocomplete, 'new-password')
    await fill('CLI 连接名称', 'Codex 新名称'); await click('保存 CLI 聊天连接')
    const save = api.calls.find(call => call.action === 'cliProviders.save').payload
    assert.equal(save.expectedRevision, 7); assert.equal(save.id, profile.id)
    assert.equal(save.name, 'Codex 新名称')
    assert.equal(Object.hasOwn(save, 'credentialJson'), false)
    assert.equal(Object.hasOwn(save, 'importLocalAccount'), false)
    assert.deepEqual(save.entry, profile.entry)
    assert.equal(Object.hasOwn(save.entry, 'sha256'), false)
    assert.match(container.textContent, /CLI 聊天连接已保存/)
  })
})

test('CLI chat save uses the new credential once and a later edit leaves the password input blank', async () => {
  await withDom(async ({ render, field, click, fill }) => {
    const api = fixture(); await render({ productApi: api }); await click('管理 CLI 聊天')
    await fill('CLI 登录资料 JSON', '{"files":{"auth.json":{"token":"synthetic-only"}}}')
    await click('保存 CLI 聊天连接')
    const save = api.calls.find(call => call.action === 'cliProviders.save').payload
    assert.equal(save.credentialJson, '{"files":{"auth.json":{"token":"synthetic-only"}}}')
    assert.equal(Object.hasOwn(save, 'clearCredential'), false)
    await click('管理 CLI 聊天'); assert.equal(field('CLI 登录资料 JSON').value, '')
  })
})

test('explicit local-account import is mutually exclusive with pasted credentials and clearing', async () => {
  await withDom(async ({ render, field, click, fill, toggle }) => {
    const api = fixture(); await render({ productApi: api }); await click('管理 CLI 聊天')
    await fill('CLI 登录资料 JSON', '{"env":{"TOKEN":"fixture-only"}}')
    await toggle('使用本机已登录账号')
    assert.equal(field('CLI 登录资料 JSON').disabled, true); assert.equal(field('CLI 登录资料 JSON').value, '')
    assert.equal(field('清除此 CLI 连接的登录资料').checked, false)
    await click('保存 CLI 聊天连接')
    const payload = api.calls.find(call => call.action === 'cliProviders.save').payload
    assert.equal(payload.importLocalAccount, true)
    assert.equal(Object.hasOwn(payload, 'credentialJson'), false); assert.equal(Object.hasOwn(payload, 'clearCredential'), false)
    assert.equal(api.calls.some(call => call.action === 'cliProviders.importAccount'), false)
  })
})

test('a connection used by a Bot cannot be deleted in the CLI editor', async () => {
  await withDom(async ({ render, button, click, container }) => {
    const api = fixture({ profiles: [{ ...profile, usedBy: [{ id: 'chief', name: 'Chief' }] }] })
    await render({ productApi: api }); await click('管理 CLI 聊天')
    assert.equal(button('删除 CLI 连接').disabled, true)
    assert.match(container.textContent, /正在使用：Chief/)
    assert.equal(api.calls.some(call => call.action === 'cliProviders.remove'), false)
  })
})

test('an unused CLI connection deletes only its own id and committed revision', async () => {
  await withDom(async ({ render, click, container }) => {
    const api = fixture(); await render({ productApi: api }); await click('管理 CLI 聊天'); await click('删除 CLI 连接')
    assert.deepEqual(api.calls.find(call => call.action === 'cliProviders.remove').payload, { id: profile.id, expectedRevision: profile.revision })
    assert.match(container.textContent, /还没有 CLI 聊天连接/)
  })
})

test('a hung entry check remains closable and its late result cannot verify a changed or closed draft', async () => {
  await withDom(async ({ render, click, fill, field, container, flush }) => {
    const pending = deferred(), api = fixture({ handler: action => action === 'cliProviders.inspect' ? pending.promise : undefined })
    await render({ productApi: api }); await click('管理 CLI 聊天'); await click('核验安装入口')
    assert.equal(field('CLI 连接名称').disabled, false)
    await fill('CLI 连接名称', '仍可编辑')
    await click('返回 CLI 连接')
    assert.equal(api.calls.find(call => call.action === 'cliProviders.inspect').signal.aborted, true)
    pending.resolve({ entry: profile.entry, versionVerified: true }); await flush()
    assert.doesNotMatch(container.textContent, /安装入口与版本已核验/)
    assert.equal(container.querySelector('[role="alert"]'), null)
    assert.match(container.textContent, /Codex 个人账号/)
  })
})

test('changing Host API drops the old secret draft and ignores a late old save result', async () => {
  await withDom(async ({ render, click, fill, container, field, flush }) => {
    const pending = deferred(), old = fixture({ handler: action => action === 'cliProviders.save' ? pending.promise : undefined }), current = fixture({ profiles: [] })
    await render({ productApi: old }); await click('管理 CLI 聊天'); await fill('CLI 登录资料 JSON', 'old-unsaved-fixture-only')
    await click('保存 CLI 聊天连接'); await render({ productApi: current })
    assert.equal(old.calls.find(call => call.action === 'cliProviders.save').signal.aborted, true)
    assert.equal(field('CLI 登录资料 JSON'), null)
    pending.resolve({ id: 'old', revision: 8 }); await flush()
    assert.match(container.textContent, /还没有 CLI 聊天连接/)
    assert.doesNotMatch(container.textContent, /CLI 聊天连接已保存/)
    assert.equal(current.calls.some(call => call.action === 'cliProviders.save'), false)
  })
})

test('an implemented driver with no supported funding route is visible but cannot be added', async () => {
  await withDom(async ({ render, click, field, fill }) => {
    const api = fixture({ profiles: [] }); await render({ productApi: api }); await click('添加 CLI 聊天')
    const unavailable = [...field('CLI 聊天驱动').options].find(option => option.value === 'deepseekAgent')
    assert.equal(unavailable.disabled, true); assert.match(unavailable.textContent, /当前不可用/)
    await fill('CLI 连接名称', '新的聊天连接'); await fill('CLI 模型 ID', 'gpt-fixture')
    await fill('CLI 可执行文件路径', 'C:\\Tools\\codex.exe'); await fill('CLI 版本', '1.2.3')
    await click('保存 CLI 聊天连接')
    const payload = api.calls.find(call => call.action === 'cliProviders.save').payload
    assert.equal(payload.driver, 'codex'); assert.equal(payload.expectedRevision, 0); assert.equal(Object.hasOwn(payload, 'id'), false)
  })
})
