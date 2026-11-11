import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'

const parent = resolve('tmp/integration/binding-upgrade'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'components-')), file = join(directory, 'binding-editor.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/binding-editor.jsx'], bundle: true, platform: 'node', format: 'esm',
  external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' } })
await writeFile(file, bundle.outputFiles[0].contents)
let BotBindingEditor

const bot = { id: 'writer', name: '写作 Bot', role: '整理资料', main: false, sessionId: 'session-writer', model: 'openai/gpt-5' }
const otherBot = { id: 'developer', name: '开发 Bot', role: '实现功能', main: false, sessionId: 'session-developer', model: 'anthropic/claude-sonnet-4' }
const catalog = {
  models: [
    { provider: 'openai', model: 'gpt-5', label: 'openai/gpt-5', cliModels: [{ toolId: 'codex', model: 'gpt-5-codex' }] },
    { provider: 'openai', model: 'gpt-5-mini', label: 'openai/gpt-5-mini', cliModels: [] },
    { provider: 'anthropic', model: 'claude-sonnet-4', label: 'anthropic/claude-sonnet-4', cliModels: [] },
  ],
  tools: [{ toolId: 'codex', label: 'Codex CLI', vendor: 'OpenAI', source: '厂商官方 CLI', modes: ['read-only'], grantTools: ['cli/codex', 'cli/cancel', 'cli/read', 'cli/retry'] }],
  machines: [{ machineId: 'local-host', label: '本机', location: 'local', status: 'ready',
    roots: [{ rootId: 'default', label: '默认工作区', modes: ['read-only', 'workspace-write'], capabilities: [] }] }],
  capabilities: [{ id: 'model-inference', label: '模型推理', tools: ['model/infer'] }, { id: 'task-manage', label: '任务管理', tools: ['task/read', 'task/create'] }],
  fundingScopes: [{ id: 'scope-openai', label: 'openai', modes: ['api', 'subscription'] }, { id: 'scope-anthropic', label: 'anthropic', modes: ['api', 'subscription'] }],
}
const settings = (patch = {}) => ({ schemaVersion: 1, enabled: false, model: null, officialTools: [], machineGrants: [], capabilities: [], workspaceRef: null, routing: null,
  funding: { mode: 'api', scopeId: null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null }, maxConcurrentTasks: 2, ...patch })
const record = (patch = {}) => ({ botId: 'writer', revision: 7, settings: settings(), catalog, status: 'blocked', blockedReason: '此 Bot 尚未配置执行绑定。', nextAction: '选择目录中的模型、工作区及资金范围。', ...patch })
const accounts = { status: 'available', items: [
  { id: 'scope-openai', provider: 'openai', revision: 4, enabled: true, dailyLimitUsd: 10, monthlyLimitUsd: 100, mode: 'api' },
  { id: 'scope-anthropic', provider: 'anthropic', revision: 2, enabled: false, dailyLimitUsd: null, monthlyLimitUsd: null, mode: 'api' },
] }
/** Both scopes enabled, for a save that must carry the newly chosen provider. */
const accountsReady = { status: 'available', items: accounts.items.map(item => ({ ...item, enabled: true, dailyLimitUsd: 10, monthlyLimitUsd: 100 })) }
/** A complete, enabled binding: the shape a save must reproduce exactly. */
const readyRecord = (patch = {}) => record({ status: 'available', settings: settings({ enabled: true, model: { provider: 'openai', model: 'gpt-5' },
  workspaceRef: { kind: 'local', machineId: 'local-host', rootId: 'default' },
  machineGrants: [{ machineId: 'local-host', rootId: 'default', mode: 'read-only', capabilities: [] }],
  capabilities: ['model-inference'],
  funding: { mode: 'api', scopeId: 'scope-openai', pricing: { input: 1, output: 2 }, request: { maxInputTokens: 100000, maxOutputTokens: 4096 }, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, subscription: null } }), ...patch })

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(handler) {
  const calls = []
  return { calls, dispatch: async (action, payload) => {
    calls.push({ action, payload: structuredClone(payload) })
    if (handler) { const result = handler(action, payload); if (result !== undefined) return result }
    if (action === 'binding.save') return { botId: payload.botId, revision: (payload.expectedRevision ?? 0) + 1, status: 'available' }
    if (action === 'funding.account.save') return { id: payload.scopeId, revision: (payload.expectedRevision ?? 0) + 1, enabled: true }
    throw new Error(`Unexpected fixture action: ${action}`)
  } }
}

test('binding editor: Main explains full Host authority and hides worker capability checkboxes', async () => {
  await withDom(async ({ container, render }) => {
    const api = fixture()
    await render({ bot: { ...bot, main: true }, record: readyRecord(), accounts: accountsReady, dispatch: api.dispatch, busy: false })
    assert.match(container.textContent, /全权限主控/)
    assert.match(container.textContent, /全部已接入模型路线与工具/)
    assert.doesNotMatch(container.textContent, /路由与任务能力/)
    assert.equal(container.querySelectorAll('.bb-capabilities input[type=checkbox]').length, 0)
    assert.deepEqual(api.calls, [], 'opening Main settings is read-only')
  })
})
async function withDom(work) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://binding.fixture/' })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  ;({ BotBindingEditor } = await import(pathToFileURL(file)))
  const { createRoot } = await import('react-dom/client'), container = document.getElementById('root'), root = createRoot(container)
  const render = async props => act(async () => { root.render(React.createElement(BotBindingEditor, props)); await new Promise(setImmediate) })
  const byText = text => [...container.querySelectorAll('button')].find(element => element.textContent.trim().includes(text))
  const click = async text => { const element = byText(text); assert.ok(element, `button exists: ${text}`); await act(async () => { element.click(); await new Promise(setImmediate) }) }
  const ensurePicker = () => { if (!document.querySelector('.bp-model-popover')) act(() => container.querySelector('.bp-model-picker-trigger').click()) }
  const option = text => { ensurePicker(); return [...document.querySelectorAll('[data-provider],[data-model-choice]')].find(element => element.getAttribute('data-provider') === text || element.getAttribute('data-model-choice') === text) }
  const pick = async text => {
    let element = option(text)
    if (!element && text.includes('/')) { await act(async () => { option(text.split('/')[0]).click(); await new Promise(setImmediate) }); element = option(text) }
    assert.ok(element, `option exists: ${text}`); await act(async () => { element.click(); await new Promise(setImmediate) })
  }
  const field = label => [...container.querySelectorAll('.bb-field')].find(element => element.querySelector('span')?.textContent.trim() === label)
  const fill = async (label, value) => act(async () => {
    const target = field(label); assert.ok(target, `field exists: ${label}`)
    const input = target.querySelector('input, select')
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const select = async (label, value) => act(async () => {
    const target = [...container.querySelectorAll('select')].find(element => element.getAttribute('aria-label') === label)
    assert.ok(target, `select exists: ${label}`)
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(target, value)
    target.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  const check = async (text, checked = true) => act(async () => {
    const target = [...container.querySelectorAll('.bb-check')].find(element => element.textContent.includes(text))
    assert.ok(target, `check row exists: ${text}`)
    const input = target.querySelector('input[type=checkbox]')
    if (input.checked !== checked) { input.click(); await new Promise(setImmediate) }
  })
  const saved = api => api.calls.filter(call => call.action === 'binding.save')
  try { await work({ container, render, click, pick, fill, select, check, saved, byText, option, submitDisabled, dom }) }
  finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
}

test('binding editor: browsing providers leaves the draft intact, and choosing a model preserves explicit tool grants', async () => {
  await withDom(async ({ container, render, option, pick, click, saved, submitDisabled }) => {
    const api = fixture()
    await render({ bot, record: readyRecord({ settings: settings({ enabled: true, model: { provider: 'openai', model: 'gpt-5-mini' },
      officialTools: [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }],
      workspaceRef: { kind: 'local', machineId: 'local-host', rootId: 'default' },
      machineGrants: [{ machineId: 'local-host', rootId: 'default', mode: 'read-only', capabilities: [] }],
      funding: { mode: 'api', scopeId: 'scope-openai', pricing: { input: 1, output: 2 }, request: { maxInputTokens: 1000, maxOutputTokens: 2000 }, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, subscription: null } }) }),
      accounts: accountsReady, dispatch: api.dispatch, busy: false })
    assert.equal(option('openai/gpt-5-mini')?.getAttribute('aria-pressed'), 'true')
    await pick('anthropic')
    // Browsing is read-only; only an explicit exact-model choice edits the draft.
    assert.equal(option('anthropic/claude-sonnet-4')?.getAttribute('aria-pressed'), 'false')
    assert.equal(option('openai/gpt-5-mini'), undefined)
    assert.match(container.textContent, /准确模型openai\/gpt-5-mini/)
    // The grant stays visible and honest: still granted, now unverified, never widened.
    assert.match(container.textContent, /授权已失效/)
    assert.match(container.textContent, /codex\/gpt-5-codex/)
    assert.equal(container.querySelectorAll('.bb-tool input[type=checkbox]:checked').length, 0)
    assert.match(container.textContent, /尚未核验/)
    // Saving is refused with the real reason instead of silently dropping the grant.
    assert.equal(submitDisabled(container), true)
    await click('移除 1 项未核验授权')
    assert.doesNotMatch(container.textContent, /codex \/ gpt-5-codex/)
    await pick('anthropic/claude-sonnet-4')
    assert.equal(submitDisabled(container), false)
    await click('保存绑定')
    const payload = saved(api).at(-1).payload.settings
    assert.deepEqual(payload.model, { provider: 'anthropic', model: 'claude-sonnet-4' })
    assert.deepEqual(payload.officialTools, [])
  })
})

test('binding editor: a saved model that left the catalog is reported, not silently replaced', async () => {
  await withDom(async ({ container, render, saved, submitDisabled }) => {
    const api = fixture()
    await render({ bot, record: record({ settings: settings({ enabled: true, model: { provider: 'openai', model: 'gpt-4' } }) }), accounts, dispatch: api.dispatch, busy: false })
    assert.match(container.textContent, /openai\/gpt-4/)
    assert.match(container.textContent, /已保存的模型暂不在可用目录中/)
    assert.match(container.textContent, /请选择目录中的准确模型/)
    assert.equal(submitDisabled(container), true)
    assert.equal(saved(api).length, 0)
  })
})

test('binding editor: the Host applied-model record stays separate from an unsaved model choice', async () => {
  await withDom(async ({ container, render, pick }) => {
    const api = fixture(), currentRecord = readyRecord()
    const props = { record: currentRecord, accounts: accountsReady, dispatch: api.dispatch, busy: false }
    await render({ ...props, bot: { ...bot, appliedModel: 'openai/gpt-5-mini' } })
    assert.match(container.querySelector('.bb-model-applied').textContent, /最近应用：openai\/gpt-5-mini.*与宿主已选模型不同/)
    await pick('anthropic/claude-sonnet-4')
    await render({ ...props, bot: { ...bot, appliedModel: 'openai/gpt-5' } })
    assert.equal(container.querySelector('.bb-model-applied').hasAttribute('data-model-different'), false)
    assert.match(container.querySelector('.bp-model-picker-trigger').textContent, /claude-sonnet-4/)
    assert.deepEqual(api.calls, [], 'the applied record neither saves nor replaces an unsaved choice')
  })
})

test('binding editor: a refused save reports the Host reason and keeps the draft', async () => {
  await withDom(async ({ container, render, option, pick, click, saved, submitDisabled }) => {
    const api = fixture(action => action === 'binding.save' ? Promise.reject(Object.assign(new Error('codex 与当前模型的 CLI 身份尚未核验。'), { code: 'BOT_SETTINGS_SCOPE_DENIED' })) : undefined)
    await render({ bot, record: readyRecord(), accounts, dispatch: api.dispatch, busy: false })
    await pick('openai/gpt-5-mini')
    await click('保存绑定')
    assert.match(container.textContent, /CLI 身份尚未核验/)
    assert.doesNotMatch(container.textContent, /设置已保存/)
    assert.equal(option('openai/gpt-5-mini')?.getAttribute('aria-pressed'), 'true')
    assert.equal(submitDisabled(container), false)
    assert.equal(saved(api).length, 1)
    assert.deepEqual(saved(api)[0].payload.settings.model, { provider: 'openai', model: 'gpt-5-mini' })
  })
})

test('binding editor: an in-flight save shows progress and submits once', async () => {
  await withDom(async ({ container, render, click, saved, submitDisabled }) => {
    const pending = deferred(), api = fixture(action => action === 'binding.save' ? pending.promise : undefined)
    await render({ bot, record: readyRecord(), accounts, dispatch: api.dispatch, busy: false })
    await act(async () => { const target = byTextOf(container, '保存绑定'); target.click(); target.click(); await new Promise(setImmediate) })
    assert.equal(saved(api).length, 1)
    assert.match(container.textContent, /正在提交到宿主校验/)
    assert.equal(submitDisabled(container), true)
    await act(async () => { pending.resolve({ revision: 8, status: 'available' }); await new Promise(setImmediate) })
    assert.match(container.textContent, /设置已保存/)
  })
})

test('binding editor: an absent Host receipt never becomes a successful save', async () => {
  await withDom(async ({ container, render, click }) => {
    const api = fixture(action => action === 'binding.save' ? Promise.resolve(undefined) : undefined)
    await render({ bot, record: readyRecord(), accounts, dispatch: api.dispatch })
    await click('保存绑定')
    assert.match(container.textContent, /尚未收到当前 Bot 的保存确认/)
    assert.doesNotMatch(container.textContent, /设置已保存/)
  })
})

test('binding editor: opening official-tool setup neither saves a binding nor starts an installer', async () => {
  await withDom(async ({ render, click }) => {
    const api = fixture(); let opened = 0
    await render({ bot, record: readyRecord(), accounts, dispatch: api.dispatch, onOpenTools: () => { opened++ } })
    await click('安装与登录')
    assert.equal(opened, 1)
    assert.deepEqual(api.calls, [])
  })
})

test('binding editor: a late Host or Bot switch cannot write its result onto the new Bot', async () => {
  await withDom(async ({ container, render, saved }) => {
    const pending = deferred(), first = fixture(action => action === 'binding.save' ? pending.promise : undefined), second = fixture()
    await render({ bot, record: readyRecord(), accounts, dispatch: first.dispatch, busy: false })
    await act(async () => { byTextOf(container, '保存绑定').click(); await new Promise(setImmediate) })
    // The operator switches Bot (and Host) before the first save answers.
    await render({ bot: otherBot, record: record({ botId: 'developer', revision: 1, settings: settings({ model: { provider: 'anthropic', model: 'claude-sonnet-4' } }) }), accounts, dispatch: second.dispatch, busy: false })
    assert.match(container.textContent, /开发 Bot/)
    assert.doesNotMatch(container.textContent, /正在提交到宿主校验/)
    await act(async () => { pending.resolve({ revision: 8, status: 'available' }); await new Promise(setImmediate) })
    assert.doesNotMatch(container.textContent, /设置已保存/)
    assert.equal(second.calls.filter(call => call.action === 'binding.save').length, 0)
    assert.equal(saved(first).length, 1)
    assert.equal(saved(first)[0].payload.botId, 'writer')
  })
})

test('binding editor: a revision refresh keeps the unsaved draft and says so', async () => {
  await withDom(async ({ container, render, option, pick }) => {
    const api = fixture()
    await render({ bot, record: readyRecord(), accounts, dispatch: api.dispatch, busy: false })
    await pick('openai/gpt-5-mini')
    assert.match(container.textContent, /有未保存修改/)
    await render({ bot, record: readyRecord({ revision: 8 }), accounts, dispatch: api.dispatch, busy: false })
    assert.equal(option('openai/gpt-5-mini')?.getAttribute('aria-pressed'), 'true')
    assert.match(container.textContent, /绑定已更新到修订号 8/)
    assert.match(container.textContent, /未保存的修改仍然保留/)
  })
})

test('binding editor: a preserved draft submits its original revision until the owner explicitly reloads', async () => {
  await withDom(async ({ container, render, pick, click, saved }) => {
    const api = fixture((action, payload) => action === 'binding.save' && payload.expectedRevision !== 8
      ? Promise.reject(new Error('绑定已更新，请重新读取。')) : undefined)
    await render({ bot, record: readyRecord(), accounts, dispatch: api.dispatch })
    await pick('openai/gpt-5-mini')
    await render({ bot, record: readyRecord({ revision: 8 }), accounts, dispatch: api.dispatch })
    await click('保存绑定')
    assert.equal(saved(api)[0].payload.expectedRevision, 7)
    assert.match(container.textContent, /绑定已更新，请重新读取/)
    assert.doesNotMatch(container.textContent, /设置已保存/)
    await click('放弃草稿并载入最新设置')
    await click('保存绑定')
    assert.equal(saved(api)[1].payload.expectedRevision, 8)
    assert.deepEqual(saved(api)[1].payload.settings.model, { provider: 'openai', model: 'gpt-5' })
  })
})

test('binding editor: replacing the Host with the same Bot id and revision retires an old save and draft', async () => {
  await withDom(async ({ container, render, pick, click }) => {
    const pending = deferred(), oldApi = fixture(action => action === 'binding.save' ? pending.promise : undefined), newApi = fixture()
    await render({ bot, record: readyRecord(), accounts, dispatch: oldApi.dispatch, hostScope: oldApi })
    await pick('openai/gpt-5-mini'); await click('保存绑定')
    await render({ bot, record: readyRecord(), accounts, dispatch: newApi.dispatch, hostScope: newApi })
    assert.match(container.querySelector('.bb-summary').textContent, /准确模型openai\/gpt-5/)
    assert.doesNotMatch(container.querySelector('.bb-summary').textContent, /gpt-5-mini/)
    await act(async () => { pending.reject(new Error('旧 Host 的结果')); await new Promise(setImmediate) })
    assert.doesNotMatch(container.textContent, /旧 Host 的结果|设置已保存/)
    assert.equal(byTextOf(container, '保存绑定').disabled, false)
  })
})

test('binding editor: a blank budget is submitted as null, never as zero', async () => {
  await withDom(async ({ container, render, fill, click, saved }) => {
    const api = fixture()
    await render({ bot, record: record(), accounts, dispatch: api.dispatch, busy: false })
    await fill('Bot 每日预算（USD）', '')
    const input = fieldInput(container, 'Bot 每日预算（USD）')
    assert.equal(input.value, '')
    await fill('Bot 每日预算（USD）', '0')
    assert.equal(fieldInput(container, 'Bot 每日预算（USD）').value, '0')
    await fill('Bot 每日预算（USD）', '')
    await click('保存绑定')
    const settings = saved(api).at(-1).payload.settings
    assert.equal(settings.funding.dailyBudgetUsd, null)
    assert.equal(settings.funding.pricing, null)
    assert.equal(settings.enabled, false)
    assert.equal(saved(api).at(-1).payload.expectedRevision, 7)
  })
})

test('binding editor: an official tool grant only offers verified identities and the offered mode', async () => {
  await withDom(async ({ container, render, check, click, select, saved, pick }) => {
    const api = fixture()
    await render({ bot, record: readyRecord(), accounts, dispatch: api.dispatch, busy: false })
    await check('codex / gpt-5-codex')
    await click('保存绑定')
    assert.deepEqual(saved(api).at(-1).payload.settings.officialTools, [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }])
    const modes = [...container.querySelectorAll('.bb-tool select option')].map(option2 => option2.textContent)
    assert.deepEqual(modes, ['只读执行'])
    await select('Codex CLI 的执行模式', 'workspace-write')
    assert.equal(container.querySelector('.bb-tool select').value, 'read-only')
    // A model with no verified CLI identity cannot be granted.
    await pick('openai/gpt-5-mini')
    assert.match(container.textContent, /当前模型没有已核验的 codex CLI 身份/)
    assert.equal(container.querySelectorAll('.bb-tool input[type=checkbox]').length, 0)
    assert.match(container.textContent, /授权已失效/)
  })
})

test('binding editor: the funding scope is enabled with its own committed revision', async () => {
  await withDom(async ({ container, render, fill, click }) => {
    const api = fixture()
    await render({ bot, record: readyRecord({ settings: settings({ model: { provider: 'anthropic', model: 'claude-sonnet-4' } }) }), accounts, dispatch: api.dispatch, busy: false })
    assert.match(container.textContent, /资金范围尚未启用/)
    assert.equal(byTextOf(container, '启用 anthropic 资金范围')?.disabled, true)
    await fill('账户每日上限（USD）', '3')
    await fill('账户每月上限（USD）', '30')
    assert.equal(byTextOf(container, '启用 anthropic 资金范围')?.disabled, false)
    await click('启用 anthropic 资金范围')
    const call = api.calls.find(entry => entry.action === 'funding.account.save')
    assert.deepEqual(call.payload, { scopeId: 'scope-anthropic', expectedRevision: 2, enabled: true, dailyLimitUsd: 3, monthlyLimitUsd: 30 })
    assert.match(container.textContent, /已启用 anthropic 资金范围/)
  })
})

test('binding editor: capabilities are never selected for the operator', async () => {
  await withDom(async ({ container, render, click, saved }) => {
    const api = fixture()
    await render({ bot, record: record(), accounts, dispatch: api.dispatch, busy: false })
    assert.equal(container.querySelectorAll('.bb-fold input[type=checkbox]:checked').length, 0)
    await click('保存绑定')
    assert.deepEqual(saved(api).at(-1).payload.settings.capabilities, [])
    await click('全选')
    await click('保存绑定')
    assert.deepEqual(saved(api).at(-1).payload.settings.capabilities, ['model-inference', 'task-manage'])
  })
})

test('binding editor: a root that lost its write mode is reported instead of granted', async () => {
  await withDom(async ({ container, render, select }) => {
    const api = fixture()
    const narrowed = { ...catalog, machines: [{ machineId: 'local-host', label: '本机', location: 'local', status: 'ready', roots: [{ rootId: 'default', label: '默认工作区', modes: ['read-only'], capabilities: [] }] }] }
    await render({ bot, record: record({ catalog: narrowed }), accounts, dispatch: api.dispatch, busy: false })
    await select('写作 Bot 的绑定工作区', 'local-host/default')
    const options = [...container.querySelectorAll('select[aria-label="写作 Bot 的工作区权限"] option')].map(item => item.value)
    assert.deepEqual(options, ['read-only'])
  })
})

test('binding editor: a Bot without a binding directory explains itself', async () => {
  await withDom(async ({ container, render }) => {
    const api = fixture()
    await render({ bot, record: null, accounts, dispatch: api.dispatch, busy: false })
    assert.match(container.textContent, /尚未取得绑定目录/)
    assert.equal(api.calls.length, 0)
  })
})

const submitDisabled = container => Boolean(container.querySelector('form button[type=submit]')?.disabled)
const byTextOf = (container, text) => [...container.querySelectorAll('button')].find(element => element.textContent.trim().includes(text))
const fieldInput = (container, label) => [...container.querySelectorAll('.bb-field')].find(element => element.querySelector('span')?.textContent.trim() === label)?.querySelector('input')
