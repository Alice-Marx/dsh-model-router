import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { openSubscriptionAccounts } from '../packages/orchestration/src/subscription-accounts.mjs'
import { subscriptionFixture } from './helpers/subscription-account-fixture.mjs'
const Database = createRequire(import.meta.url)('better-sqlite3')

test('one provider click prepares the subscription connection, completes a login, and syncs models without exposing credentials', async () => {
  const base = resolve('tmp/integration/subscription-account-ui'); await mkdir(base, { recursive: true }); const directory = await mkdtemp(join(base, 'case-'))
  const built = await build({ entryPoints: ['apps/integration-client/subscription-accounts.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-dom/*'], loader: { '.css': 'text' }, write: false })
  await writeFile(join(directory, 'ui.mjs'), built.outputFiles[0].contents)
  const { SubscriptionAccounts } = await import(pathToFileURL(join(directory, 'ui.mjs')))
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://fixture.invalid/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const prior = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'))
  const fixture = await subscriptionFixture(directory)
  const service = openSubscriptionAccounts({ Database, file: join(directory, 'state.sqlite'), backend: fixture.backend })
  const dispatched = [], productApi = { dispatch(action, payload, signal) { dispatched.push(action); const name = action.split('.')[1], context = { kind: 'owner', signal }; return name === 'list' ? service.list(context) : service[name](payload, context) } }
  const settle = async work => act(async () => { await work(); await new Promise(done => setTimeout(done, 20)) })
  const click = async text => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text || item.textContent.includes(text)); assert.ok(button, text); assert.equal(button.disabled, false, text); await settle(() => button.click()) }
  const waitFor = async predicate => { for (let i = 0; i < 120; i++) { if (predicate()) return; await settle(() => new Promise(done => setTimeout(done, 30))) } assert.fail('UI state did not settle: ' + document.body.textContent.slice(0, 500)) }
  let bindings = 0
  try {
    await settle(() => root.render(React.createElement(SubscriptionAccounts, { productApi, onOpenBindings: () => bindings++ })))
    await waitFor(() => [...document.querySelectorAll('.bp-sub-providers button')].some(button => !button.disabled))
    assert.ok(!document.body.textContent.includes('启动登录服务'))
    await click('ChatGPT / Codex')
    await waitFor(() => Boolean(document.querySelector('a[target="_blank"]')))
    assert.ok(!dispatched.includes('subscriptions.enable'))
    assert.equal(new URL(document.querySelector('a[target="_blank"]').href).hostname, 'auth.openai.com')
    await fixture.complete()
    await waitFor(() => Boolean(document.querySelector('[data-subscription-account]')))
    assert.ok(document.body.textContent.includes('1 个可用模型')); assert.ok(document.body.textContent.includes('待验证对话'))
    assert.doesNotMatch(document.documentElement.outerHTML, /fixture-private-oauth-token|fixture-subscription-.*key|managementKey|access_token/)
    await click('为 Bot 选择订阅模型'); assert.equal(bindings, 1)
    await click('退出账户'); await waitFor(() => !document.querySelector('[data-subscription-account]'))
    assert.ok(dispatched.includes('subscriptions.login')); assert.ok(dispatched.includes('subscriptions.loginStatus')); assert.ok(dispatched.includes('subscriptions.remove'))
  } finally {
    await act(async () => root.unmount()); await service.close(); dom.window.close()
    for (const [key, descriptor] of Object.entries(prior)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
})
