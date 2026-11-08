import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { listBotTemplates } from '../packages/orchestration/src/bot-templates.mjs'
import { defaultQuickBinding } from '../packages/orchestration/src/quick-binding.mjs'

const parent = resolve('tmp/integration/product-quick-pages'); fs.mkdirSync(parent, { recursive: true })
const dir = fs.mkdtempSync(join(parent, 'run-')), compiled = join(dir, 'page.mjs')
await build({ entryPoints: ['apps/integration-client/panels.jsx'], outfile: compiled, bundle: true, platform: 'node', format: 'esm', external: ['react'] })
const { ProductPage, ProductNavigation } = await import(pathToFileURL(compiled))
const { PRODUCT_PANELS } = await import('../apps/integration-client/api.mjs')
// React decides at load time whether native input events exist, so it must load after a window does.
const boot = new JSDOM('<div></div>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: boot.window, document: boot.window.document })
const { createRoot } = await import('react-dom/client')

const claude = {
  provider: 'engine-claude-code', toolId: 'claude-code', name: 'Claude Code（官方工具）', vendor: 'Anthropic', state: 'ready', registered: true,
  installed: true, version: '2.1.0', latestVersion: '2.1.0', updateAvailable: false, login: { state: 'ok', detail: '', command: 'claude' },
  models: [{ id: 'sonnet', name: 'Sonnet', ref: 'engine-claude-code/sonnet' }],
}
const codex = {
  ...claude, provider: 'engine-codex', toolId: 'codex', name: 'Codex（官方工具）', vendor: 'OpenAI', state: 'login', version: '0.40.0',
  login: { state: 'logged-out', detail: '未检测到登录凭据。', command: 'codex login' }, models: [{ id: 'gpt-5', name: 'GPT-5', ref: 'engine-codex/gpt-5' }],
}
const gemini = { ...claude, provider: 'engine-gemini', toolId: 'gemini', name: 'Gemini CLI（官方工具）', vendor: 'Google', state: 'missing', installed: false, version: null,
  login: { state: 'unknown', detail: '', command: 'gemini' }, models: [{ id: 'pro', name: 'Pro', ref: 'engine-gemini/pro' }] }

const fixture = (extra = {}) => ({
  schemaVersion: 1, observedAt: Date.now(),
  bots: [
    { id: 'main', name: 'Main', main: true, model: 'engine-claude-code/sonnet', sessionId: 's-main' },
    { id: 'writer', name: '写作者', model: 'fixture/gpt', sessionId: 's-writer' },
    { id: 'coder', name: '程序员', model: 'engine-codex/gpt-5', sessionId: 's-coder' },
  ],
  fundingAccounts: { status: 'blocked', items: [] },
  engines: { status: 'available', checkedAt: Date.parse('2026-11-08T02:00:00Z'), checking: false, items: [claude, codex, gemini] },
  quickBinding: {
    status: 'available', revision: 3, updatedAt: Date.parse('2026-11-08T02:00:00Z'), settings: defaultQuickBinding(),
    items: [
      { botId: 'main', model: 'engine-claude-code/sonnet', mode: 'quick', funding: 'subscription', granted: true, priced: true, pricingSource: 'subscription' },
      { botId: 'writer', model: 'fixture/gpt', mode: 'quick', funding: 'api', granted: true, priced: false, pricingSource: null },
      { botId: 'coder', model: 'engine-codex/gpt-5', mode: 'quick', funding: 'subscription', granted: true, priced: true, pricingSource: 'subscription' },
    ],
    routes: [
      { provider: 'engine-claude-code', model: 'sonnet', engine: true, profilePrice: null },
      { provider: 'engine-codex', model: 'gpt-5', engine: true, profilePrice: null },
      { provider: 'fixture', model: 'gpt', engine: false, profilePrice: null },
    ],
  },
  ...extra,
})

async function mount(element, props) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const keys = ['window', 'document', 'Element', 'HTMLElement', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys) {
    const value = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const host = dom.window.document.getElementById('root'), root = createRoot(host)
  await act(async () => { root.render(React.createElement(element, props)); await new Promise(done => setTimeout(done, 20)) })
  await act(async () => { await new Promise(done => setTimeout(done, 20)) })
  return {
    dom, host,
    find: (selector, text) => [...host.querySelectorAll(selector)].find(node => text === undefined || node.textContent.includes(text)),
    async click(node) { await act(async () => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise(done => setTimeout(done, 10)) }) },
    async type(node, value) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value').set
      await act(async () => { setter.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    },
    async submit(form) { await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await new Promise(done => setTimeout(done, 20)) }) },
    async close() {
      await act(async () => root.unmount())
      for (const key of keys) Object.defineProperty(globalThis, key, { value: original[key], configurable: true, writable: true })
      dom.window.close()
    },
  }
}

test('Bot 与模型: quick mode names each Bot model and funding, and an unpriced API model is priced in place', async () => {
  const calls = [], snapshot = fixture({ availableActions: ['quickBinding.save', 'binding.quick'] })
  const api = { snapshot: async () => snapshot, dispatch: async (action, payload) => { calls.push([action, payload]); return { revision: 4 } } }
  const page = await mount(ProductPage, { section: 'bindings', productApi: api, openSession: () => {} })
  try {
    assert.match(page.host.querySelector('h1').textContent, /Bot 与模型/)
    const list = page.host.querySelector('.bp-bot-list')
    assert.match(list.textContent, /Claude Code · Sonnet/)
    assert.match(list.textContent, /快速 · 官方工具/)
    assert.match(list.textContent, /需要价格/)
    assert.match(page.host.querySelector('.bp-quick').textContent, /0 \/ 1 个已知/)
    assert.equal(calls.length, 0, 'the policy card and the Bot list read the snapshot only')

    await page.click(page.find('.bp-bot-list button', '写作者'))
    const form = page.host.querySelector('.bp-inline-price')
    assert.ok(form, 'an unpriced quick API model offers its price form')
    const [input, output] = form.querySelectorAll('input')
    await page.type(input, '1.5'); await page.type(output, '6')
    await page.submit(form)
    assert.deepEqual(calls.map(([action]) => action), ['quickBinding.save'])
    const [, payload] = calls[0]
    assert.equal(payload.expectedRevision, 3)
    assert.deepEqual(payload.settings.prices, [{ provider: 'fixture', model: 'gpt', input: 1.5, output: 6 }])
    assert.equal(payload.settings.botDailyUsd, 5, 'saving one price keeps the committed caps')
  } finally { await page.close() }
})

test('现成 Bot: the template gallery replaces the role catalog and a created Bot opens its chat', async () => {
  const calls = [], opened = [], catalog = listBotTemplates()
  const snapshot = fixture({ availableActions: ['roles.list', 'templates.list', 'bot.template.create'] })
  const api = {
    snapshot: async () => snapshot,
    dispatch: async (action, payload) => {
      calls.push([action, payload])
      if (action === 'templates.list') return catalog
      if (action === 'bot.template.create') return { botId: 'bot-new', name: payload.name, sessionId: 's-new' }
      return []
    },
  }
  const page = await mount(ProductPage, { section: 'bindings', productApi: api, openSession: id => opened.push(id) })
  try {
    assert.deepEqual(calls.map(([action]) => action), ['templates.list'], 'the gallery is read once and the role catalog is not')
    const gallery = page.host.querySelector('section[aria-label="现成 Bot"]')
    assert.equal(gallery.querySelectorAll('.bp-template').length, catalog.items.length)
    assert.doesNotMatch(gallery.textContent, /maus/i)

    await page.click(page.find('.bp-segmented button', '写作'))
    const writing = catalog.items.filter(item => item.category === 'writing').length
    assert.equal(gallery.querySelectorAll('.bp-template').length, writing)
    await page.click(page.find('.bp-segmented button', '全部'))

    const first = gallery.querySelector('.bp-template')
    await page.click(page.find('.bp-template button', '用这个模板创建'))
    const form = first.querySelector('form')
    const [name] = form.querySelectorAll('input'), select = form.querySelector('select')
    assert.deepEqual([...select.options].map(option => option.value), ['', 'engine-claude-code/sonnet', 'engine-codex/gpt-5', 'fixture/gpt'])
    assert.match(select.textContent, /Claude Code · Sonnet/)
    await page.type(name, '我的助理')
    await act(async () => {
      Object.getOwnPropertyDescriptor(page.dom.window.HTMLSelectElement.prototype, 'value').set.call(select, 'engine-claude-code/sonnet')
      select.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }))
    })
    await page.submit(form)
    const created = calls.find(([action]) => action === 'bot.template.create')
    assert.deepEqual(created[1], { templateId: catalog.items[0].id, name: '我的助理', model: 'engine-claude-code/sonnet' })
    assert.deepEqual(opened, ['s-new'])
  } finally { await page.close() }
})

test('导入团队包: a pasted package is previewed with what it skips, then imported with the chosen model', async () => {
  const { parseTeamPackage, teamPreview } = await import('../packages/orchestration/src/team-package.mjs')
  const text = JSON.stringify({ format: 'dsh.team-package', version: 1, package: { name: '研究小组', team: { leader: 'a' },
    agents: [{ key: 'a', name: '甲', title: '负责人', approval: 'full' }, { key: 'b', name: '乙', title: '研究员' }],
    rooms: [{ key: 'r', name: '研究室', members: ['a', 'b'] }], routines: [{ name: '早报', agent: 'a', prompt: '整理早报' }] } })
  const calls = [], opened = []
  const api = {
    snapshot: async () => fixture({ availableActions: ['team.preview', 'team.import'] }),
    dispatch: async (action, payload) => {
      calls.push([action, payload])
      if (action === 'team.preview') return teamPreview(parseTeamPackage(payload.text))
      return { bots: [{ key: 'a', botId: 'bot-a', name: '甲', sessionId: 's-a' }, { key: 'b', botId: 'bot-b', name: '乙', sessionId: 's-b' }],
        rooms: [{ key: 'r', roomId: 'room-r', name: '研究室' }], skipped: [], routines: [{ name: '早报' }] }
    },
  }
  const page = await mount(ProductPage, { section: 'bindings', productApi: api, openSession: id => opened.push(id) })
  try {
    const card = page.host.querySelector('section[aria-label="导入团队包"]')
    assert.ok(card)
    assert.equal(page.find('section[aria-label="导入团队包"] button', '预览').disabled, true)
    await page.type(card.querySelector('textarea'), text)
    await page.click(page.find('section[aria-label="导入团队包"] button', '预览'))
    assert.deepEqual(calls.map(([action]) => action), ['team.preview'])
    const preview = card.querySelector('.bp-team-preview')
    assert.match(preview.textContent, /甲负责人/)
    assert.match(preview.textContent, /研究室/)
    assert.match(preview.textContent, /审批级别/)
    assert.match(preview.textContent, /早报/)
    const select = preview.querySelector('select')
    await act(async () => {
      Object.getOwnPropertyDescriptor(page.dom.window.HTMLSelectElement.prototype, 'value').set.call(select, 'engine-claude-code/sonnet')
      select.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }))
    })
    await page.click(page.find('.bp-team-preview button', '导入 2 个 Bot'))
    assert.deepEqual(calls[1], ['team.import', { text, model: 'engine-claude-code/sonnet' }])
    assert.match(card.textContent, /已添加 2 个 Bot、1 个群聊/)
    await page.click(page.find('.bp-team-result button', '乙'))
    assert.deepEqual(opened, ['s-b'])
  } finally { await page.close() }
})

test('AI 引擎: each official tool shows its state, login command and the Bots using it', async () => {
  const calls = [], opened = []
  const api = { snapshot: async () => fixture({ availableActions: ['engines.refresh'] }), dispatch: async action => { calls.push(action); return { status: 'available' } } }
  const page = await mount(ProductPage, { section: 'engines', productApi: api, openPanel: id => opened.push(id) })
  try {
    const cards = [...page.host.querySelectorAll('.bp-engine')]
    assert.deepEqual(cards.map(card => card.dataset.state), ['ready', 'login', 'missing'])
    assert.match(cards[0].textContent, /就绪/); assert.match(cards[0].textContent, /Main/)
    assert.match(cards[1].textContent, /需要登录/); assert.match(cards[1].textContent, /程序员/)
    assert.equal(cards[1].querySelector('.bp-command code').textContent, 'codex login')
    assert.match(cards[2].textContent, /未安装/)
    assert.match(page.host.textContent, /0\/1 已定价/)

    await page.click(page.find('button', '重新检测'))
    assert.deepEqual(calls, ['engines.refresh'])
    await page.click(page.find('button', '安装与登录'))
    await page.click(page.find('button', '设置价格'))
    assert.deepEqual(opened, ['model-router-galgame', PRODUCT_PANELS.bindings])
  } finally { await page.close() }
})

test('收件箱: only committed blockers are listed and each one leads to its fix', async () => {
  const opened = [], sessions = []
  const snapshot = fixture({
    usage: { status: 'available', items: [], unresolved: [{ runId: 'run-1', packageId: 'p-1', botId: 'writer', provider: 'fixture', model: 'gpt' }] },
    tasks: { status: 'available', items: [
      { taskId: 't-run', botId: 'main', state: 'running', title: '整理本周会议纪要', updatedAt: Date.parse('2026-11-08T01:00:00Z') },
      { taskId: 't-done', botId: 'writer', state: 'succeeded', title: '起草发布公告', updatedAt: Date.parse('2026-11-08T00:00:00Z') },
    ] },
  })
  snapshot.quickBinding.items.push({ botId: 'idle', model: null, mode: 'no-model', funding: null, granted: false, priced: false })
  snapshot.bots.push({ id: 'idle', name: '新同事', sessionId: 's-idle' })
  const api = { snapshot: async () => snapshot, dispatch: async () => ({}) }
  const page = await mount(ProductPage, { section: 'inbox', productApi: api, openPanel: id => opened.push(id), openSession: id => sessions.push(id) })
  try {
    const pending = page.host.querySelector('section[aria-label="待你处理"]')
    const titles = [...pending.querySelectorAll('.bp-inbox-row strong')].map(node => node.textContent)
    assert.deepEqual(titles, ['写作者 有一笔费用待核对', '写作者 的模型还没有价格', '新同事 还没有选模型', 'Codex 需要重新登录'])
    assert.ok(!titles.some(title => title.includes('Gemini')), 'an engine no Bot uses is not a blocker')
    await page.click(page.find('.bp-inbox-row button', '填写价格'))
    await page.click(page.find('.bp-inbox-row button', '打开私聊'))
    await page.click(page.find('.bp-inbox-row button', '查看引擎'))
    assert.deepEqual(opened, [PRODUCT_PANELS.bindings, PRODUCT_PANELS.engines])
    assert.deepEqual(sessions, ['s-idle'])
    assert.match(page.host.querySelector('section[aria-label="进行中"]').textContent, /整理本周会议纪要/)
    assert.match(page.host.querySelector('section[aria-label="已完成"]').textContent, /起草发布公告/)
  } finally { await page.close() }

  const calm = fixture()
  calm.quickBinding.items = calm.quickBinding.items.map(item => ({ ...item, priced: true }))
  calm.bots = calm.bots.filter(bot => bot.id !== 'coder')
  const quiet = await mount(ProductPage, { section: 'inbox', productApi: { snapshot: async () => calm, dispatch: async () => ({}) } })
  try { assert.match(quiet.host.textContent, /一切就绪/) } finally { await quiet.close() }
})

test('workspace navigation puts the inbox, Bots and engines first', async () => {
  const opened = []
  const page = await mount(ProductNavigation, { panels: PRODUCT_PANELS, openPanel: id => opened.push(id) })
  try {
    const labels = [...page.host.querySelectorAll('nav button')].map(node => node.getAttribute('aria-label'))
    assert.deepEqual(labels.slice(0, 4), ['收件箱', 'Bot 与模型', 'AI 引擎', '任务'])
    await page.click(page.host.querySelector('button[aria-label="AI 引擎"]'))
    assert.deepEqual(opened, [PRODUCT_PANELS.engines])
  } finally { await page.close() }
})
