import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

/**
 * Real-Chromium layout and behaviour check for the Bot binding editor.
 *
 * The fixture mounts the real component against a synthetic trusted catalog and a
 * dispatch that only records what the panel asks the Host to do: no Host, no model
 * call, no credential and no real desktop input are involved. Screenshots and the
 * report land in tmp/integration/binding-upgrade/.
 */
const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'tmp/integration/binding-upgrade')
const fixtures = resolve(out, 'fixtures')

const FIXTURE_SOURCE = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BotBindingEditor } from '../../../../apps/integration-client/binding-editor.jsx'
import productCss from '../../../../apps/integration-client/product.css'
import workspaceCss from '../../../../apps/integration-client/workspace.css'
import bindingCss from '../../../../apps/integration-client/binding.css'

const bot = { id: 'writer', name: '写作 Bot', role: '整理资料，完成清楚的表达', main: new URLSearchParams(location.search).get('role') === 'main', sessionId: 'session-writer', model: 'openai/gpt-5' }
const catalog = {
  models: [
    { provider: 'openai', model: 'gpt-5', label: 'openai/gpt-5', cliModels: [{ toolId: 'codex', model: 'gpt-5-codex' }] },
    { provider: 'openai', model: 'gpt-5-mini', label: 'openai/gpt-5-mini', cliModels: [] },
    { provider: 'anthropic', model: 'claude-sonnet-4', label: 'anthropic/claude-sonnet-4', cliModels: [] },
    { provider: 'native-claude', model: 'fixture-model-a', label: 'Claude（订阅会话）', cliModels: [], fundingModes: ['subscription'] },
  ],
  tools: [{ toolId: 'codex', label: 'Codex CLI', vendor: 'OpenAI', source: '厂商官方 CLI', modes: ['read-only'], grantTools: ['cli/codex', 'cli/cancel', 'cli/read', 'cli/retry'] }],
  machines: [{ machineId: 'local-host', label: '本机', location: 'local', status: 'ready', roots: [{ rootId: 'default', label: '默认工作区', modes: ['read-only', 'workspace-write'], capabilities: [] }] }],
  capabilities: [{ id: 'model-inference', label: '模型推理', tools: ['model/infer'] }, { id: 'task-manage', label: '任务管理', tools: ['task/read', 'task/create'] }],
  fundingScopes: [{ id: 'scope-openai', label: 'openai', modes: ['api', 'subscription'] }, { id: 'scope-anthropic', label: 'anthropic', modes: ['api', 'subscription'] }, { id: 'scope-native', label: 'native-claude', modes: ['subscription'] }],
}
const accounts = { status: 'available', items: [
  { id: 'scope-openai', provider: 'openai', revision: 4, enabled: true, dailyLimitUsd: 10, monthlyLimitUsd: 100, mode: 'api' },
  { id: 'scope-anthropic', provider: 'anthropic', revision: 2, enabled: true, dailyLimitUsd: 8, monthlyLimitUsd: 80, mode: 'api' },
  { id: 'scope-native', provider: 'native-claude', revision: 1, enabled: true, dailyLimitUsd: 0, monthlyLimitUsd: 0, mode: 'subscription' },
] }
const record = { botId: 'writer', revision: 7, status: 'blocked', blockedReason: '此 Bot 尚未配置执行绑定。', nextAction: '选择目录中的模型、工作区及资金范围，确认后启用。',
  settings: { schemaVersion: 1, enabled: false, model: null, officialTools: [], machineGrants: [], capabilities: [], workspaceRef: null, routing: null,
    funding: { mode: 'api', scopeId: null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null }, maxConcurrentTasks: 2 },
  catalog, grant: { tools: [], modelRoutes: [] } }
const state = { calls: [], fail: false }
window.__bindingFixture = state
const dispatch = async (action, payload) => {
  state.calls.push({ action, payload: JSON.parse(JSON.stringify(payload ?? null)) })
  if (state.fail) return Promise.reject(Object.assign(new Error('codex 与当前模型的 CLI 身份尚未核验。'), { code: 'BOT_SETTINGS_SCOPE_DENIED' }))
  if (action === 'binding.save') return { botId: payload.botId, revision: 8, status: 'available' }
  return { ok: true }
}
const style = document.createElement('style')
style.textContent = productCss + '\\n' + workspaceCss + '\\n' + bindingCss + '\\n' + 'html,body,#root{margin:0}.fixture-note{height:26px;display:flex;align-items:center;justify-content:center;background:#24332a;color:#e5eee6;font-size:10px}.fixture-main{padding:22px 26px 34px;max-width:820px}.fixture-fail{position:fixed;right:10px;bottom:10px;z-index:20}'
document.head.append(style)
document.body.setAttribute('data-bot-product-ui', '1')

createRoot(document.getElementById('root')).render(<>
  <div className="fixture-note">本地验证 · 离线夹具目录 · 未发布改动</div>
  <main className="bp-page"><div className="bp-page-inner fixture-main">
    <BotBindingEditor bot={bot} record={record} accounts={accounts} dispatch={dispatch} busy={false} />
  </div></main>
  <button type="button" className="fixture-fail" onClick={() => { state.fail = !state.fail }}>切换失败模式</button>
</>)
`

async function serve() {
  await mkdir(fixtures, { recursive: true })
  const entry = resolve(fixtures, 'binding-preview.jsx')
  await writeFile(entry, FIXTURE_SOURCE)
  const bundle = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
    format: 'iife', platform: 'browser', target: 'es2022', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' } })
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot 绑定 · 本地离线验证</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
    if (request.url?.split('?')[0] === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html) }
    else if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(bundle.outputFiles[0].contents) }
    else { response.writeHead(404); response.end() }
  })
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(yes => server.close(yes)) }
}

async function verify() {
  const fixture = await serve()
  await mkdir(out, { recursive: true })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 })
  const failures = [], checks = [], images = []
  page.on('pageerror', error => failures.push(error.message))
  const capture = async name => { const path = resolve(out, `${name}.png`); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); images.push(path); return path }
  const calls = () => page.evaluate(() => window.__bindingFixture.calls)
  const openPicker = async () => { if (!await page.locator('.bp-model-popover').count()) await page.locator('.bb-model-card .bp-model-picker-trigger').click() }
  const provider = name => ({ click: async () => { await openPicker(); await page.locator(`[data-provider="${name}"]`).click() } })
  const route = name => ({ click: async () => {
    await openPicker()
    if (!await page.locator(`[data-model-choice="${name}"]`).count()) await page.locator(`[data-provider="${name.split('/')[0]}"]`).click()
    await page.locator(`[data-model-choice="${name}"]`).click()
  } })
  const contrast = () => page.evaluate(() => {
    const probe = document.querySelector('.bb-sub'), styles = getComputedStyle(probe)
    const page2 = getComputedStyle(document.querySelector('.bp-page'))
    const luminance = color => {
      const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const ink = luminance(styles.color), background = luminance(page2.backgroundColor)
    return { color: styles.color, background: page2.backgroundColor, contrast: (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) }
  })
  const overflow = () => page.evaluate(() => {
    const root = document.querySelector('.bb-root')
    return { document: document.documentElement.scrollWidth > window.innerWidth, card: root.scrollWidth > root.clientWidth + 1 }
  })
  try {
    await page.goto(fixture.url)
    await page.getByRole('heading', { name: '模型与工具' }).waitFor()
    assert.match(await page.locator('.bp-model-current').innerText(), /选择模型/)
    assert.equal(await page.locator('.bb-tool input[type="checkbox"]:checked').count(), 0)
    images.push(await capture('binding-light-empty'))
    checks.push('a fresh Bot shows its unselected model, workspace and tool state instead of a default')

    await provider('anthropic').click()
    await route('anthropic/claude-sonnet-4').click()
    assert.match(await page.locator('.bp-model-current').innerText(), /claude-sonnet-4/)
    await provider('openai').click()
    await page.getByLabel('搜索可用模型').fill('mini')
    assert.equal(await page.locator('[data-model-choice]').count(), 1)
    assert.equal(await page.locator('[data-model-choice]').getAttribute('data-model-choice'), 'openai/gpt-5-mini')
    await route('openai/gpt-5-mini').click()
    images.push(await capture('binding-light-model-step'))
    checks.push('compact provider rail and model list search narrow real routes without a full-page wizard')

    await route('openai/gpt-5').click()
    const tool = page.locator('.bb-tool').first()
    assert.match(await tool.innerText(), /codex \/ gpt-5-codex/)
    await tool.locator('input[type=checkbox]').check()
    assert.match(await tool.locator('.bb-pill').innerText(), /已授予/)
    assert.deepEqual(await tool.locator('select option').allInnerTexts(), ['只读执行'])
    await route('openai/gpt-5-mini').click()
    assert.match(await tool.innerText(), /授权已失效/)
    assert.match(await tool.innerText(), /尚未核验/)
    images.push(await capture('binding-light-tools'))
    checks.push('a CLI grant stays visible and unverified after a model change, and never widens itself')

    await route('openai/gpt-5').click()
    await page.locator('.bb-fold > summary').click()
    await page.getByLabel('写作 Bot 的绑定工作区').selectOption('local-host/default')
    await page.getByRole('button', { name: '保存绑定', exact: true }).click()
    await page.locator('.bb-feedback[data-kind=saved]').waitFor()
    const saved = (await calls()).filter(call => call.action === 'binding.save')
    assert.equal(saved.length, 1)
    assert.equal(saved[0].payload.expectedRevision, 7)
    assert.deepEqual(saved[0].payload.settings.model, { provider: 'openai', model: 'gpt-5' })
    assert.deepEqual(saved[0].payload.settings.workspaceRef, { kind: 'local', machineId: 'local-host', rootId: 'default' })
    assert.equal(saved[0].payload.settings.funding.pricing, null)
    assert.equal(saved[0].payload.settings.funding.dailyBudgetUsd, null)
    checks.push('a save carries the committed revision and sends blank budgets as null, not zero')

    await page.locator('.fixture-fail').click()
    await page.getByRole('button', { name: '保存绑定', exact: true }).click()
    await page.locator('.bb-feedback[data-kind=error]').waitFor()
    assert.match(await page.locator('.bb-feedback[data-kind=error]').innerText(), /CLI 身份尚未核验/)
    assert.equal(await page.locator('.bb-feedback[data-kind=saved]').count(), 0)
    images.push(await capture('binding-light-error'))
    checks.push('a refused save reports the Host reason and never claims success')

    const light = await contrast(); assert.ok(light.contrast >= 4.5, `light contrast ${light.contrast}`)
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', '1'))
    const dark = await contrast(); assert.ok(dark.contrast >= 4.5, `dark contrast ${dark.contrast}`)
    images.push(await capture('binding-dark'))
    checks.push('explanatory text keeps AA contrast in both themes')
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme'); document.body.setAttribute('data-bp-appearance', 'dark') })
    const customDark = await contrast(); assert.ok(customDark.contrast >= 4.5, `explicit dark on a light Host ${customDark.contrast}`)
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '1'); document.body.setAttribute('data-bp-appearance', 'light') })
    const customLight = await contrast(); assert.ok(customLight.contrast >= 4.5, `explicit light on a dark Host ${customLight.contrast}`)
    assert.notEqual(customDark.color, customLight.color)
    await page.evaluate(() => { document.body.removeAttribute('data-bp-appearance'); document.body.removeAttribute('data-ds-dark-theme') })
    checks.push('explicit appearance overrides preserve readable binding text when the Host uses the opposite theme')

    await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
    await page.setViewportSize({ width: 375, height: 812 })
    assert.deepEqual(await overflow(), { document: false, card: false })
    images.push(await capture('binding-mobile-375'))
    checks.push('a 375px viewport has no horizontal overflow')
    const beforeChoice = (await calls()).length
    await route('native-claude/fixture-model-a').click()
    await page.locator('.bb-budget-config').evaluate(node => { node.open = true })
    assert.equal(await page.getByRole('button', { name: 'API（按金额）', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '订阅（按次数）', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal((await calls()).length, beforeChoice, 'choosing a native model changes a draft, never calls a model or saves a binding')
    assert.deepEqual(await overflow(), { document: false, card: false })
    images.push(await capture('binding-native-subscription-mobile'))
    checks.push('a Host subscription-only conversation model selects subscription funding, disables API and stays a draft until an explicit save')
    await page.goto(fixture.url + '?role=main')
    await page.getByText('Main · 全权限主控', {exact:true}).waitFor()
    assert.match(await page.locator('.bb-root').innerText(), /全部已接入模型路线与工具/)
    assert.equal(await page.getByText('路由与任务能力', {exact:true}).count(), 0)
    assert.deepEqual(await calls(), [])
    assert.deepEqual(await overflow(), { document: false, card: false })
    images.push(await capture('binding-main-full-authority-mobile'))
    checks.push('Main displays full Host authority on a 375px screen without worker capability controls or side effects')

    await route('openai/gpt-5').click()
    await page.getByRole('button', { name: '配置多条模型路线' }).click()
    const editor = page.getByRole('region', { name: 'Main 模型路线' })
    const primary = editor.locator('[data-main-route="openai/gpt-5"]')
    await primary.locator('summary').click()
    await primary.getByLabel('输入价格（USD / 百万 Token）', { exact: true }).fill('1')
    await primary.getByLabel('输出价格（USD / 百万 Token）', { exact: true }).fill('2')
    await primary.getByLabel('最大输入 Token').fill('1000')
    await primary.getByLabel('最大输出 Token').fill('40')
    await primary.getByLabel('启用路线 openai/gpt-5').check()
    await primary.locator('summary').click()
    await editor.getByRole('button', { name: /选择添加路线/ }).click()
    await route('native-claude/fixture-model-a').click()
    const native = editor.locator('[data-main-route="native-claude/fixture-model-a"]')
    await native.locator('summary').click()
    assert.deepEqual(await native.getByLabel('资金渠道').locator('option').allInnerTexts(), ['订阅（按次数）'])
    await native.getByLabel('启用路线 native-claude/fixture-model-a').check()
    await native.getByRole('button', { name: '设为默认' }).click()
    await editor.getByText('共享预算与订阅次数', { exact: true }).click()
    for (const [label, value] of [['共享每日 API 预算（USD）', '0'], ['共享每月 API 预算（USD）', '10'], ['共享每日订阅次数', '3'], ['共享每月订阅次数', '30']]) {
      await editor.getByLabel(label, { exact: true }).fill(value)
    }
    await page.getByText('工作区与能力', { exact: false }).click()
    await page.getByLabel('写作 Bot 的绑定工作区').selectOption('local-host/default')
    await page.getByLabel('启用此绑定').check()
    assert.deepEqual(await calls(), [], 'editing routes is entirely local until save')
    assert.deepEqual(await overflow(), { document: false, card: false })
    await capture('binding-main-model-routes-mobile')
    await page.getByRole('button', { name: '保存绑定', exact: true }).click()
    await page.locator('.bb-feedback[data-kind=saved]').waitFor()
    const [committed] = await calls()
    assert.equal((await calls()).length, 1)
    assert.equal(committed.action, 'binding.save')
    assert.equal(committed.payload.expectedRevision, 7)
    assert.deepEqual(committed.payload.settings.model, { provider: 'native-claude', model: 'fixture-model-a' })
    assert.deepEqual(committed.payload.settings.mainRoutes, { schemaVersion: 1, limits: {
      api: { dailyBudgetUsd: 0, monthlyBudgetUsd: 10 }, subscription: { dailyCalls: 3, monthlyCalls: 30 },
    }, routes: [
      { provider: 'openai', model: 'gpt-5', enabled: true, funding: { mode: 'api', scopeId: 'scope-openai', pricing: { input: 1, output: 2 }, request: { maxInputTokens: 1000, maxOutputTokens: 40 } } },
      { provider: 'native-claude', model: 'fixture-model-a', enabled: true, funding: { mode: 'subscription', scopeId: 'scope-native', pricing: null, request: null } },
    ] })
    checks.push('Main edits mixed API and subscription routes at 375px, changes the default, and saves the exact profiles and shared limits in one revision')
    assert.deepEqual(failures, [])
    const report = { status: 'passed', localFixture: true, checks, contrast: { light, dark }, images, pageErrors: failures }
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    await capture('binding-failure')
    await writeFile(resolve(out, 'failure.json'), JSON.stringify({ message: error.message, pageErrors: failures }, null, 2))
    throw error
  } finally { await browser.close(); await fixture.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verify()
