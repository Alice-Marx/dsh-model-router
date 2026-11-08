import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'

// The picker ships as a product overlay file inside the vendored DS Bot client; the menu
// that opens it is the overlay's patched model-menu.js. Both are exercised as shipped.
const client = resolve('modules/bot-runtime/vendor/ds-bot/src/client')
const parent = resolve('tmp/integration/engine-picker'); fs.mkdirSync(parent, { recursive: true })
const dir = fs.mkdtempSync(join(parent, 'run-')), entry = join(dir, 'entry.mjs'), compiled = join(dir, 'picker.mjs')
fs.writeFileSync(entry, [
  `export { EnginePicker, providerGroups, railOf, suggestedModels, shortProvider } from ${JSON.stringify(join(client, 'engine-picker.js'))}`,
  `export { ModelMenu } from ${JSON.stringify(join(client, 'model-menu.js'))}`,
  `export { installLocale } from ${JSON.stringify(join(client, 'i18n.js'))}`,
].join('\n'))
await build({ entryPoints: [entry], outfile: compiled, bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom'] })
const boot = new JSDOM('<div></div>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: boot.window, document: boot.window.document })
const { createRoot } = await import('react-dom/client')
const picker = await import(pathToFileURL(compiled))

const model = (provider, providerName, id, name = id, extra = {}) => ({ ref: `${provider}/${id}`, provider, providerName, id, name, ...extra })
const roster = {
  defaultModel: 'openrouter/gpt-4.1',
  models: [
    model('openrouter', 'OpenRouter', 'gpt-4.1', 'GPT-4.1'),
    ...Array.from({ length: 9 }, (_, index) => model('openrouter', 'OpenRouter', `model-${index}`, `Model ${index}`)),
    model('engine-claude-code', 'Claude Code（官方工具）', 'sonnet', 'Sonnet'),
    model('engine-claude-code', 'Claude Code（官方工具）', 'opus', 'Opus'),
    model('engine-codex', 'Codex（官方工具）', 'gpt-5', 'GPT-5'),
    model('ollama-local', 'Ollama', 'qwen3', 'Qwen3'),
    model('deepseek', 'DeepSeek', 'deepseek-chat', 'DeepSeek Chat', { needsKey: true }),
  ],
}

async function mount(element, props) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const keys = ['window', 'document', 'Element', 'HTMLElement', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys) Object.defineProperty(globalThis, key, { value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key], configurable: true, writable: true })
  const host = dom.window.document.getElementById('root'), root = createRoot(host)
  await act(async () => root.render(React.createElement(element, props)))
  const body = dom.window.document.body
  return {
    dom, body,
    rows: () => [...body.querySelectorAll('[data-ep-row]')].map(node => node.querySelector('.bt-ep-row-name').textContent),
    find: (selector, text) => [...body.querySelectorAll(selector)].find(node => text === undefined || node.textContent.includes(text)),
    async click(node) { await act(async () => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) },
    async type(node, value) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value)
        node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    },
    async close() {
      await act(async () => root.unmount())
      for (const key of keys) Object.defineProperty(globalThis, key, { value: original[key], configurable: true, writable: true })
      dom.window.close()
    },
  }
}

test('providers are grouped as official tools, API and local, in that order', () => {
  const groups = picker.providerGroups(roster.models)
  assert.deepEqual(groups.map(group => [group.id, group.rail]), [
    ['engine-claude-code', 'tools'], ['engine-codex', 'tools'], ['openrouter', 'api'], ['deepseek', 'api'], ['ollama-local', 'local'],
  ])
  assert.equal(groups[0].name, 'Claude Code')
  assert.equal(groups.find(group => group.id === 'deepseek').needsKey, true)
  assert.equal(picker.railOf('lmstudio'), 'local')
  assert.equal(picker.railOf('anthropic'), 'api')
})

test('the suggested list keeps the current and default models within five, in catalog order', () => {
  const list = roster.models.filter(item => item.provider === 'openrouter')
  const short = picker.suggestedModels(list, { current: 'openrouter/model-8', defaultRef: 'openrouter/gpt-4.1' })
  assert.deepEqual(short.map(item => item.id), ['gpt-4.1', 'model-0', 'model-1', 'model-2', 'model-8'])
  assert.equal(picker.suggestedModels(list.slice(0, 3), {}).length, 3)
})

test('the picker opens on the current provider, searches every model, and picks a route', async () => {
  const picked = [], efforts = []
  const page = await mount(picker.EnginePicker, {
    roster, current: 'openrouter/model-8', onPick: ref => picked.push(ref),
    efforts: [{ effort: undefined, label: 'Default' }, { effort: 'high', label: 'High' }], effort: 'high', onPickEffort: value => efforts.push(value),
  })
  try {
    const rail = [...page.body.querySelectorAll('.bt-ep-rail-label')].map(node => node.textContent)
    assert.deepEqual(rail, ['Official tools', 'API', 'Local'])
    assert.equal(page.find('.bt-ep-rail-item[aria-selected=true]').getAttribute('aria-label'), 'OpenRouter')
    assert.ok(page.find('.bt-ep-rail-item[aria-label=DeepSeek] .bt-ep-dot'), 'a provider without its key is flagged on the rail')
    assert.match(page.find('.bt-model-group').textContent, /Suggested/)
    assert.deepEqual(page.rows(), ['GPT-4.1', 'Model 0', 'Model 1', 'Model 2', 'Model 8'])
    assert.match(page.find('[data-ep-row]', 'GPT-4.1').textContent, /Default/)
    assert.equal(page.find('[data-ep-row][aria-checked=true]').textContent.includes('Model 8'), true)

    await page.click(page.find('.bt-ep-more'))
    assert.equal(page.rows().length, 10)
    assert.match(page.find('.bt-ep-more').textContent, /Show suggested only/)

    await page.click(page.find('.bt-ep-rail-item[aria-label="Claude Code"]'))
    assert.deepEqual(page.rows(), ['Sonnet', 'Opus'])
    assert.match(page.find('.bt-ep-status').textContent, /Your subscription/)
    assert.match(page.find('.bt-ep-note').textContent, /read-only/)

    await page.type(page.find('.bt-ep-search input'), 'gpt')
    assert.deepEqual(page.rows(), ['GPT-4.1', 'GPT-5'])
    assert.match(page.find('.bt-ep-title').textContent, /Search results/)
    await page.click(page.find('[data-ep-row]', 'GPT-5'))
    assert.deepEqual(picked, ['engine-codex/gpt-5'])

    assert.equal(page.find('.bt-ep-pill[aria-checked=true]').textContent, 'High')
    await page.click(page.find('.bt-ep-pill', 'Default'))
    assert.deepEqual(efforts, [undefined])
  } finally { await page.close() }
})

test('the picker speaks Chinese when DSH does', async () => {
  const off = picker.installLocale({ register: () => () => {}, bind: () => key => key, getLocale: () => ({ active: 'zh-CN' }) })
  const page = await mount(picker.EnginePicker, { roster, current: 'engine-claude-code/sonnet', onPick: () => {}, manage: () => {} })
  try {
    assert.deepEqual([...page.body.querySelectorAll('.bt-ep-rail-label')].map(node => node.textContent), ['官方工具', 'API', '本地'])
    assert.match(page.find('.bt-ep-status').textContent, /使用你的订阅/)
    assert.equal(page.find('.bt-ep-search input').getAttribute('placeholder'), '搜索模型')
    assert.match(page.find('.bt-ep-foot').textContent, /模型与供应商/)
  } finally { await page.close(); off() }
})

test('the Bot model menu opens the picker and saves the picked route on the Bot', async () => {
  const updates = []
  const actions = { updateBot: (id, patch) => { updates.push([id, patch]); return Promise.resolve() }, refreshModels: () => {} }
  const bot = { id: 'bot-a', name: 'Writer', model: 'openrouter/gpt-4.1' }
  const page = await mount(picker.ModelMenu, { bot, roster, actions, run: value => value })
  try {
    await page.click(page.find('.bt-model-trigger'))
    const menu = page.find('.bt-menu.bt-ep-menu')
    assert.ok(menu, 'the menu renders the rail-and-list picker')
    assert.equal(menu.getAttribute('role'), 'menu')
    await page.click(page.find('.bt-ep-rail-item[aria-label="Claude Code"]'))
    await page.click(page.find('[data-ep-row]', 'Opus'))
    assert.deepEqual(updates, [['bot-a', { model: 'engine-claude-code/opus' }]])
  } finally { await page.close() }
})
