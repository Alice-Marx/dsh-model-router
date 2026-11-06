import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'

test('templates and remounts keep the draft without starting work; attention opens its exact execution record', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://workbench.fixture/' })
  const replacements = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client')
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../.dsh-plugin/client/router-main.jsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', external: ['react'], loader: { '.css': 'text' }, write: false, logLevel: 'silent' })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const { RouterMainPage } = module.exports
  const ok = value => ({ ok: true, value })
  const value = { budgetUsd: 0, routingPreset: 'balanced' }
  const ledger = { runs: [{ id: 'first', task: 'first fixture', status: 'failed', packages: [], reviews: [], createdAt: 1 },
    { id: 'second', task: 'second fixture', status: 'failed', packages: [], reviews: [], createdAt: 2 }],
    spent: { today: 0, month: 0 }, reserved: {}, budget: {}, settings: {} }
  let previews = 0, starts = 0, root
  const props = { settingsScope: { getSnapshot: () => ({ value, writable: false }), subscribe: () => () => {} },
    loadCatalog: async () => ok({ groups: [{ id: 'fixture', models: [{ id: 'route' }] }], routableProviders: ['fixture'] }),
    toolHealth: async () => ok({ tools: [], onboarding: { completedAt: 1 } }), loadLedger: async () => ok(ledger), loadBoundaries: async () => ok({}),
    listOfficialTools: async () => ok({ probes: [], readiness: [], capabilities: [] }),
    previewRun: async () => { previews++; return ok({}) }, startRun: async () => { starts++; return ok({}) } }
  const host = document.getElementById('root')
  const mount = async () => { root = createRoot(host); await act(async () => { root.render(React.createElement(RouterMainPage, props)); await new Promise(setImmediate) }) }
  const click = async text => {
    const button = [...host.querySelectorAll('button')].find(button => button.textContent.trim() === text)
    assert.ok(button, `button exists: ${text}`)
    await act(async () => { button.click(); await new Promise(setImmediate) })
  }
  t.after(async () => {
    if (root) await act(() => root.unmount())
    dom.window.close()
    for (const key of Object.keys(replacements)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]
    }
  })
  await mount()
  await click('项目检查')
  const original = host.querySelector('#mr-task').value
  assert.match(original, /只读检查/)
  await click('整理说明')
  assert.notEqual(host.querySelector('#mr-task').value, original)
  await click('撤销模板')
  assert.equal(host.querySelector('#mr-task').value, original)
  assert.equal(previews, 0); assert.equal(starts, 0)
  await act(() => root.unmount()); root = null
  await mount()
  assert.equal(host.querySelector('#mr-task').value, original, 'task survives page remount')
  assert.equal(host.querySelector('.mr-launch-preview'), null, 'an old execution preview is never restored')
  const attentionButtons = [...host.querySelectorAll('button')].filter(button => button.textContent === '查看执行记录')
  assert.equal(attentionButtons.length, 2)
  await act(async () => { attentionButtons[1].click(); await new Promise(setImmediate) })
  assert.equal(host.querySelector('#mr-panel-history').hidden, false)
  assert.equal(host.querySelector('#mr-tab-history').getAttribute('aria-selected'), 'true')
  assert.equal(host.querySelector('#mr-run-select').value, 'second', 'attention selects the clicked run')
  assert.equal(previews, 0); assert.equal(starts, 0)
})
