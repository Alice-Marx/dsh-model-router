import './helpers/ui-dom-bootstrap.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
const parent = resolve('tmp/integration/bot-settings-dialog'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'case-')), file = join(directory, 'ui.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/bot-settings-dialog.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' } })
await writeFile(file, bundle.outputFiles[0].contents)
const { BotSettingsDialog } = await import(pathToFileURL(file))
const data = (name = '研究伙伴', botId = 'bot-a') => ({ schemaVersion: 1, bot: { id: botId, name, model: 'fixture/one' }, record: {
  botId, revision: 1, status: 'blocked', settings: { schemaVersion: 1, enabled: false, model: { provider: 'fixture', model: 'one' }, officialTools: [], machineGrants: [], capabilities: [], workspaceRef: null,
    funding: { mode: 'api', scopeId: null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null }, maxConcurrentTasks: 1, routing: null },
  catalog: { models: [{ provider: 'fixture', model: 'one', cliModels: [] }, { provider: 'fixture', model: 'two', cliModels: [] }], tools: [], machines: [], capabilities: [], fundingScopes: [] },
}, accounts: { status: 'available', items: [] }, availableActions: ['binding.save'] })
function api(value = data()) {
  const calls = []
  return { calls, dispatch: async (action, payload, signal) => {
    calls.push({ action, payload, signal })
    if (action === 'binding.inspect') return structuredClone(value)
    if (action === 'binding.save') { value.record.settings = payload.settings; value.record.revision++; return { revision: value.record.revision, botId: payload.botId } }
    throw new Error('not allowed')
  }, snapshot: () => { throw new Error('settings must not read all task receipts') } }
}
async function fixture(t) {
  const dom = new JSDOM('<button id="chat-model">聊天模型</button><div id="root"></div>', { url: 'http://bot-settings.fixture/', pretendToBeVisual: true })
  const values = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }, prior = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'))
  const settle = work => act(async () => { await work(); await new Promise(setImmediate) })
  const q = selector => document.querySelector(selector), closed = []
  q('#chat-model').focus()
  const render = props => settle(() => root.render(React.createElement(BotSettingsDialog, { botId: 'bot-a', onClose: () => { closed.push(true); root.render(null) }, ...props })))
  const click = selector => settle(() => q(selector).click())
  const key = (target, value) => settle(() => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [name, value] of Object.entries(prior)) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name] } })
  return { render, settle, q, click, key, closed }
}
test('chat settings read only the selected Bot, keep a model choice as a draft, and refresh the committed receipt after saving', async t => {
  const f = await fixture(t), source = api()
  await f.render({ productApi: source })
  assert.match(f.q('[role="dialog"]').getAttribute('aria-label'), /研究伙伴/)
  assert.deepEqual(source.calls.map(call => call.action), ['binding.inspect', 'binding.inspect'])
  assert.deepEqual(source.calls[0].payload, { botId: 'bot-a' })
  assert.deepEqual(source.calls[1].payload, { botId: 'bot-a', refreshOfficialTools: true })
  await f.click('.bp-model-picker-trigger'); await f.click('[data-model-choice="fixture/two"]')
  assert.equal(source.calls.length, 2, 'choosing a model does not save or execute')
  await f.click('button[type="submit"]')
  assert.deepEqual(source.calls.map(call => call.action), ['binding.inspect', 'binding.inspect', 'binding.save', 'binding.inspect'])
  assert.deepEqual(source.calls[2].payload.settings.model, { provider: 'fixture', model: 'two' })
  assert.match(f.q('.bb-feedback').textContent, /设置已保存/)
})
test('a nested model popover handles Escape before its chat settings dialog, which restores the chat trigger', async t => {
  const f = await fixture(t); await f.render({ productApi: api() })
  await f.click('.bp-model-picker-trigger')
  await f.key(f.q('.bp-model-search input'), 'Escape')
  assert.equal(f.q('.bp-model-popover'), null); assert.ok(f.q('.bp-bot-settings-dialog'))
  await f.key(f.q('.bp-model-picker-trigger'), 'Escape')
  assert.equal(f.q('.bp-bot-settings-dialog'), null); assert.equal(f.closed.length, 1)
  assert.ok(document.activeElement === f.q('#chat-model'))
})
test('Host replacement retires a pending read and cannot show its late Bot configuration', async t => {
  const f = await fixture(t); let finish, signal
  await f.render({ productApi: { dispatch: (_action, _payload, incoming) => { signal = incoming; return new Promise(resolve => { finish = resolve }) } } })
  await f.render({ productApi: api(data('新宿主伙伴')) })
  assert.equal(signal.aborted, true)
  await f.settle(() => finish(data('旧宿主隐私')))
  assert.match(f.q('.bp-bot-settings-header').textContent, /新宿主伙伴/)
  assert.doesNotMatch(document.body.textContent, /旧宿主隐私/)
})
test('a wrong Bot projection and an unavailable Host never expose another Bot or fake a settings form', async t => {
  const f = await fixture(t)
  await f.render({ productApi: api(data('不应显示', 'bot-b')) })
  assert.equal(f.q('.bb-root'), null); assert.doesNotMatch(document.body.textContent, /不应显示/)
  await f.render({ productApi: { dispatch: () => Promise.reject({ code: 'PRODUCT_ACTION_UNAVAILABLE' }) } })
  assert.match(f.q('[role="alert"]').textContent, /请更新完整插件/)
})
test('a lost settings read can be retried explicitly without replaying a save', async t => {
  const f = await fixture(t), source = api(); let attempts = 0
  const connection = { dispatch: (action, ...args) => ++attempts === 1 ? Promise.reject(new Error('private diagnostic')) : source.dispatch(action, ...args) }
  await f.render({ productApi: connection })
  assert.match(f.q('[role="alert"]').textContent, /重新读取/); assert.doesNotMatch(document.body.textContent, /private diagnostic/)
  await f.click('.bp-bot-settings-error button')
  assert.ok(f.q('.bb-root')); assert.deepEqual(source.calls.map(call => call.action), ['binding.inspect', 'binding.inspect'])
})

test('identity is loaded on demand, keyboard tabs work, and switching settings tabs preserves unsaved identity text', async t => {
  const f = await fixture(t), source = api(), calls = []
  const connection = { dispatch: (action, payload, signal) => {
    calls.push(action)
    if (action === 'botProfile.inspect') return { schemaVersion: 1, bot: { id: 'bot-a', name: '研究伙伴', role: '整理', instructions: '先给依据' }, revision: 1 }
    return source.dispatch(action, payload, signal)
  } }
  await f.render({ productApi: connection })
  assert.deepEqual(calls, ['binding.inspect', 'binding.inspect'])
  await f.click('[data-settings-tab="binding"]')
  await f.key(f.q('[data-settings-tab="binding"]'), 'ArrowRight')
  assert.equal(f.q('[data-settings-tab="identity"]').getAttribute('aria-selected'), 'true')
  assert.ok(document.activeElement === f.q('[data-settings-tab="identity"]'))
  assert.deepEqual(calls, ['binding.inspect', 'binding.inspect', 'botProfile.inspect'])
  const input = f.q('#bp-profile-bot-a-role')
  await f.settle(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '尚未保存的职责')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await f.click('[data-settings-tab="binding"]')
  assert.equal(f.q('.bp-profile').closest('[role="tabpanel"]').hidden, true)
  await f.click('[data-settings-tab="identity"]')
  assert.equal(f.q('#bp-profile-bot-a-role').value, '尚未保存的职责')
  assert.match(f.q('.bp-profile-save').textContent, /有未保存修改/)
  assert.deepEqual(calls, ['binding.inspect', 'binding.inspect', 'botProfile.inspect'], 'tab switching never saves, starts a turn or rereads over the draft')
})

test('identity save rejects a wrong-owner acknowledgement without losing the unsaved edit or retrying', async t => {
  const f = await fixture(t), binding = api(), calls = []
  const connection = { dispatch: async (action, payload, signal) => {
    calls.push(action)
    const bot = { id: 'bot-a', name: '研究伙伴', role: '整理', instructions: '先给依据' }
    if (action === 'botProfile.inspect') return { schemaVersion: 1, bot, revision: 1 }
    if (action === 'botProfile.save') return { schemaVersion: 1, botId: 'bot-a', bot: { ...bot, id: 'other-bot', role: payload.profile.role }, revision: 2, saved: ['role'] }
    return binding.dispatch(action, payload, signal)
  } }
  await f.render({ productApi: connection }); await f.click('[data-settings-tab="identity"]')
  await f.settle(() => {
    const input = f.q('#bp-profile-bot-a-role')
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '保留这个修改')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await f.click('.bp-profile-save button')
  assert.match(f.q('.bp-profile-feedback').textContent, /尚未确认|未确认/)
  assert.equal(f.q('.bp-profile-feedback').dataset.kind, 'error')
  assert.equal(f.q('#bp-profile-bot-a-role').value, '保留这个修改')
  assert.match(f.q('.bp-profile-save').textContent, /有未保存修改/)
  assert.deepEqual(calls, ['binding.inspect', 'binding.inspect', 'botProfile.inspect', 'botProfile.save'])
})

test('confirmed identity saves use canonical values and refresh the drawer name without turning untouched changes into a new edit', async t => {
  const f = await fixture(t), binding = api()
  const connection = { dispatch: async (action, payload, signal) => {
    const bot = { id: 'bot-a', name: '研究伙伴', role: '原职责', instructions: '先给依据' }
    if (action === 'botProfile.inspect') return { schemaVersion: 1, bot, revision: 1 }
    if (action === 'botProfile.save') return { schemaVersion: 1, botId: 'bot-a', bot: { ...bot, name: payload.profile.name.trim(), role: '他处更新的职责' }, revision: 3, saved: ['name'] }
    return binding.dispatch(action, payload, signal)
  } }
  await f.render({ productApi: connection }); await f.click('[data-settings-tab="identity"]')
  await f.settle(() => {
    const input = f.q('#bp-profile-bot-a-name')
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, ' 新名称 ')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await f.click('.bp-profile-save button')
  assert.equal(f.q('#bp-profile-bot-a-name').value, '新名称')
  assert.equal(f.q('#bp-profile-bot-a-role').value, '他处更新的职责')
  assert.match(f.q('.bp-profile-save').textContent, /与宿主一致/)
  assert.match(f.q('.bp-bot-settings-header h2').textContent, /新名称/)
})

test('a malformed identity projection cannot become an editable profile', async t => {
  const f = await fixture(t), binding = api()
  const connection = { dispatch: (action, payload, signal) => action === 'botProfile.inspect'
    ? { schemaVersion: 1, bot: { id: 'bot-a', name: { privateDiagnostic: 'do not display' }, role: '', instructions: '' }, revision: 1 }
    : binding.dispatch(action, payload, signal) }
  await f.render({ productApi: connection }); await f.click('[data-settings-tab="identity"]')
  assert.equal(f.q('.bp-profile-save'), null)
  assert.match(f.q('.bp-profile-error').textContent, /暂时无法读取/)
  assert.doesNotMatch(document.body.textContent, /privateDiagnostic|do not display/)
})

test('the settings dialog rechecks trusted CLI identities while retaining its unsaved model and authorization draft', async t => {
  const f = await fixture(t), value = data(), calls = []
  const tool = { toolId: 'codex', label: 'Codex CLI', modes: ['read-only'], identities: [{ model: 'vendor-default', label: '厂商默认模型（由 CLI 配置决定）' }], status: 'ready', installed: true, loginState: 'logged-in' }
  value.record.catalog.tools = [tool]
  const source = api(value)
  const connection = { dispatch: async (action, payload, signal) => {
    calls.push({ action, payload })
    return source.dispatch(action, payload, signal)
  } }
  await f.render({ productApi: connection })
  await f.click('.bp-model-picker-trigger'); await f.click('[data-model-choice="fixture/two"]')
  await f.click('[data-tool-id="codex"] input[type=checkbox]')
  value.record.catalog.tools[0].reason = '刚刚核验完成。'
  await f.settle(() => [...document.querySelectorAll('button')].find(button => button.textContent === '重新检测').click())
  assert.deepEqual(calls.map(call => call.action), ['binding.inspect', 'binding.inspect', 'binding.inspect'])
  assert.deepEqual(calls[2].payload, { botId: 'bot-a', refreshOfficialTools: true })
  assert.match(f.q('.bp-model-picker-trigger').textContent, /two/)
  assert.equal(f.q('[data-tool-id="codex"] input[type=checkbox]').checked, true)
  assert.match(f.q('.bb-tool-readiness').textContent, /刚刚核验完成/)
  await f.click('button[type="submit"]')
  const saved = calls.find(call => call.action === 'binding.save').payload.settings
  assert.deepEqual(saved.model, { provider: 'fixture', model: 'two' })
  assert.deepEqual(saved.officialTools, [{ toolId: 'codex', cliModel: 'vendor-default', mode: 'read-only' }])
})

test('a CLI detection that never returns cannot hide the model editor or identity tab, and its UI timeout is recoverable', async t => {
  const f = await fixture(t), source = api(), calls = []
  let finishDetection, detectionSignal
  const connection = { dispatch: (action, payload, signal) => {
    calls.push({ action, payload })
    if (payload?.refreshOfficialTools) { detectionSignal = signal; return new Promise(resolve => { finishDetection = resolve }) }
    if (action === 'botProfile.inspect') return { schemaVersion: 1, bot: { id: 'bot-a', name: '研究伙伴', role: '', instructions: '' }, revision: 1 }
    return source.dispatch(action, payload, signal)
  } }
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await f.render({ productApi: connection })
  assert.ok(f.q('.bb-root'), 'the first settings read does not await any CLI')
  assert.match(document.body.textContent, /后台检测/)
  assert.equal(f.q('button[type=submit]').disabled, false)
  await f.click('.bp-model-picker-trigger'); await f.click('[data-model-choice="fixture/two"]')
  await f.click('[data-settings-tab="identity"]')
  assert.ok(f.q('.bp-profile'))
  await f.click('[data-settings-tab="binding"]')
  await f.settle(() => t.mock.timers.tick(15001))
  assert.equal(detectionSignal.aborted, true)
  assert.match(document.body.textContent, /可继续编辑设置/)
  assert.match(f.q('.bp-model-picker-trigger').textContent, /two/)
  await f.settle(() => finishDetection(data('过期的工具结果')))
  assert.doesNotMatch(document.body.textContent, /过期的工具结果/)
  await f.click('button[type=submit]')
  assert.deepEqual(source.calls.find(call => call.action === 'binding.save').payload.settings.model, { provider: 'fixture', model: 'two' })
  assert.equal(calls.filter(call => call.payload?.refreshOfficialTools).length, 1)
})
