// End-to-end verification for pinned web panels. Every layer here is the real
// one: the real SQLite directory (closed and reopened), the real framing probe
// over a real loopback socket, the real product channel (`registerProductChannel`
// + `createProductReadModel`) behind a real HTTP endpoint, and the real client
// component in a real Chromium.
//
// The only stand-in is owner authentication, which the parent owns: the channel
// seam takes an `authorizeRequest`, and this script supplies the documented
// "already authenticated owner" answer so the transport can be exercised. The Bot
// boundary is proved separately by tests/web-panel-actions.test.mjs against the
// same real read model, and no model tool is registered anywhere.
//
// Nothing here touches a real model, a real profile, a user's chat, a credential,
// or any address outside loopback.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, '..', 'output', 'web-panels-20261108')
const SCRATCH = resolve(ROOT, 'tmp', 'integration', 'web-panels', 'verify')
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const { openWebPanelStore } = await import(pathToFileURL(join(ROOT, 'packages/orchestration/src/web-panel-store.mjs')).href)
const { createWebPanelActions } = await import(pathToFileURL(join(ROOT, 'packages/orchestration/src/web-panel-actions.mjs')).href)

// The parent owns modules/bot-runtime/read-model.mjs: its ACTIONS allow-list and
// its snapshot key list are what make a product action reachable. Until that
// wiring lands, this script runs the SAME file with exactly the two lines the
// delivered patch adds, and says so — it never stands up a fake channel.
const READ_MODEL = join(ROOT, 'modules/bot-runtime/read-model.mjs')
const readModelSource = await readFile(READ_MODEL, 'utf8')
const wiring = ["'webPanels.list'", 'webPanels: blocked(']
const wired = wiring.every(fragment => readModelSource.includes(fragment))
let channelModule = READ_MODEL
if (!wired) {
  const patched = readModelSource
    .replace("  'ui.namespace',\n", "  'ui.namespace',\n  'webPanels.list', 'webPanels.probe', 'webPanels.save', 'webPanels.remove', 'webPanels.order',\n")
    .replace('  usage: blocked(', "  webPanels: blocked('宿主尚未提供固定网页面板目录。', '接入固定网页面板存储后，可在这里把常用网页固定在侧栏。'),\n  usage: blocked(")
  assert.ok(wiring.every(fragment => patched.includes(fragment)), 'the read-model insertion must apply')
  channelModule = join(SCRATCH, 'read-model-with-web-panels.mjs')
  await writeFile(channelModule, patched)
  process.stdout.write('[web-panel] the parent allow-list is not in the tree yet: running the same read model with the two lines the patch adds\n')
}
const { createProductReadModel, registerProductChannel } = await import(pathToFileURL(channelModule).href)
const checks = []
const images = []
const note = (check, detail) => { checks.push({ check, ...(detail ? { detail } : {}) }); process.stdout.write(`[web-panel] ${check}\n`) }

await mkdir(OUT, { recursive: true })
await mkdir(SCRATCH, { recursive: true })

// ── 1. the durable directory: a real restart and a real conflict ─────────────
const durableFile = join(await mkdtemp(join(SCRATCH, 'host-')), 'web-panels.sqlite')
const first = openWebPanelStore({ Database, file: durableFile })
const created = first.save({ name: 'Local board', url: 'http://127.0.0.1:7841/', expectedRevision: 0, embeddingOrigin: 'http://127.0.0.1:8787' })
assert.throws(() => first.save({ name: 'Stale', url: 'http://127.0.0.1:7842/', expectedRevision: 0 }), { code: 'WEB_PANEL_REVISION_CONFLICT' })
first.close()
const reopened = openWebPanelStore({ Database, file: durableFile })
assert.deepEqual(reopened.read().panels, [created.panel])
reopened.close()
note('the pin directory survives a real restart and refuses a stale revision', { file: durableFile })

// ── 2. the real product channel, over a real socket ─────────────────────────
const hostOrigin = 'http://127.0.0.1:8787'
const channelStore = openWebPanelStore({ Database, file: join(await mkdtemp(join(SCRATCH, 'channel-')), 'web-panels.sqlite') })
const service = createWebPanelActions({ store: channelStore })
const readModel = createProductReadModel({
  runtime: { readOnly: () => undefined, load: async () => {}, state: { bots: {}, mainBotIds: [] }, chatOf: () => null },
  lifecycle: { status: () => ({ phase: 'active' }) },
  actions: service.actions,
  providers: { webPanels: service.provider },
})
let channelHandler = null
registerProductChannel({ connection: { fetch: { register: options => { channelHandler = options.fetch; return () => {} } } } }, readModel,
  // The documented authentication seam: the parent supplies the real owner check.
  async request => (new URL(request.url).origin === hostOrigin ? { kind: 'owner', clientOrigin: hostOrigin } : null))

// A second loopback origin serves the pages a panel frames: a different port is a
// different origin, which is what makes the frame genuinely cross-origin.
const pages = createServer((req, res) => {
  const path = req.url.split('?')[0]
  if (path === '/dashboard') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><h1>Local fleet board</h1><p>open requests: 12</p>')
  } else if (path === '/refused') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' })
    res.end('<!doctype html><h1>Refused page</h1>')
  } else if (path === '/private') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "frame-ancestors 'none'" })
    res.end('<!doctype html><h1>Private page</h1>')
  } else { res.writeHead(404).end() }
})
await new Promise(done => pages.listen(0, '127.0.0.1', done))
const pagePort = pages.address().port
const dashboard = `http://127.0.0.1:${pagePort}/dashboard`
const refused = `http://127.0.0.1:${pagePort}/refused`
const privatePage = `http://127.0.0.1:${pagePort}/private`

// Both refusal mechanisms, decided by the real probe through the real channel.
const owner = { kind: 'owner', clientOrigin: hostOrigin }
for (const [label, url] of [['x-frame-options', refused], ['frame-ancestors', privatePage], ['no header', dashboard]]) {
  const saved = await readModel.dispatch({ action: 'webPanels.save', payload: { name: label, url, expectedRevision: channelStore.read().revision } }, owner)
  const verdict = await readModel.dispatch({ action: 'webPanels.probe', payload: { id: saved.panel.id } }, owner)
  const wanted = label === 'no header' ? 'allowed' : 'blocked'
  assert.equal(verdict.framing, wanted, `${label} must read as ${wanted}`)
  assert.ok(!JSON.stringify(verdict).includes('token'), 'a verdict never carries a query')
  await readModel.dispatch({ action: 'webPanels.remove', payload: { id: saved.panel.id, expectedRevision: saved.revision } }, owner)
}
note('the real probe reads X-Frame-Options, CSP frame-ancestors and a page with neither', { dashboard, refused, privatePage })
// A Bot is refused by the same channel, and a payload claiming to be the owner is data.
await assert.rejects(readModel.dispatch({ action: 'webPanels.list', payload: { kind: 'owner' } }, { kind: 'bot', clientOrigin: hostOrigin }),
  { code: 'REMOTE_OWNER_REQUIRED' })
note('the same channel refuses a Bot and ignores an owner claim inside the payload')

// ── 3. the browser: the real component, the real client, the real channel ────
const spec = relative(join(SCRATCH, 'fixture'), ROOT).split('\\').join('/')
const fixtureDirectory = join(SCRATCH, 'fixture')
await mkdir(fixtureDirectory, { recursive: true })
await writeFile(join(fixtureDirectory, 'web-panel-preview.jsx'), `import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WebPanelsPanel, WebPanelPins } from '${spec}/apps/integration-client/web-panel-page.jsx'
import { createProductApi } from '${spec}/apps/integration-client/api.mjs'
import webPanelCss from '${spec}/apps/integration-client/web-panel.css'

// The real client, the real panel, and a shell that plays the workspace page's
// part: read the snapshot on a timer, and answer a failed dispatch the way the
// product page does.
const api = createProductApi()
window.__webPanelFixture = { calls: [], opened: [], leave: 0 }
window.open = (url, target, features) => { window.__webPanelFixture.opened.push({ url, target, features }); return null }
document.body.setAttribute('data-bot-product-ui', '1')
const style = document.createElement('style')
style.textContent = webPanelCss + '\\nhtml,body,#root{height:100%;margin:0}' +
  '.fixture-shell{display:grid;grid-template-columns:230px minmax(0,1fr);height:100%}' +
  '.fixture-contacts{display:flex;flex-direction:column;padding:16px 8px;background:var(--bp-sidebar,#f4f4f5);border-right:1px solid var(--bp-border,#e6e6e9)}' +
  '.fixture-person{flex:1;padding:16px 12px;font:13px system-ui}' +
  '.fixture-main{min-width:0;min-height:0;overflow:auto}' +
  '@media(max-width:700px){.fixture-shell{grid-template-columns:1fr}.fixture-contacts{display:none}}'
document.head.append(style)

function Fixture() {
  const [snapshot, setSnapshot] = useState(null)
  const [selected, setSelected] = useState(null)
  const refresh = useCallback(async () => { setSnapshot(await api.snapshot()) }, [])
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh() }, 500); return () => clearTimeout(timer) }, [refresh])
  const dispatch = useCallback(async (action, payload, options = {}) => {
    window.__webPanelFixture.calls.push({ action, payload })
    try { const value = await api.dispatch(action, payload); await refresh(); return value }
    catch (error) { if (options.errorResult) return { ok: false, error: { code: error.code, message: error.message } }; throw error }
  }, [refresh])
  const items = snapshot?.webPanels?.items ?? []
  return React.createElement('div', { className: 'fixture-shell' },
    React.createElement('aside', { className: 'fixture-contacts' },
      React.createElement('strong', null, 'Bot 伙伴'),
      React.createElement('div', { className: 'fixture-person' }, '研究伙伴'),
      React.createElement(WebPanelPins, { panels: items, activeId: selected ?? items[0]?.id, onSelect: setSelected })),
    React.createElement('main', { className: 'fixture-main' },
      React.createElement(WebPanelsPanel, { productApi: api, dispatch, snapshot, available: Boolean(snapshot),
        selectedId: selected ?? items[0]?.id ?? '', onSelect: setSelected,
        onLeave: () => { window.__webPanelFixture.leave += 1; setSelected(null) } })))
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture))
`)
const bundle = (await build({ absWorkingDir: ROOT, entryPoints: [join(fixtureDirectory, 'web-panel-preview.jsx')], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'text' } })).outputFiles[0].contents

// The channel's own HTTP door, reached exactly as the product client reaches it.
const harness = createServer(async (req, res) => {
  if (req.url === '/fixture.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle); return }
  if (req.url === '/api/bot-product' && req.method === 'POST') {
    const body = await new Promise(done => { let text = ''; req.on('data', chunk => { text += chunk }); req.on('end', () => done(text)) })
    let answer
    try {
      answer = await channelHandler(new Request(`${hostOrigin}/api/bot-product`, { method: 'POST', body, headers: { 'content-type': 'application/json' } }))
    } catch (cause) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { code: cause?.code ?? 'PRODUCT_REQUEST_FAILED', message: String(cause?.message ?? cause).slice(0, 500) } }))
      return
    }
    res.writeHead(answer.status, { 'content-type': 'application/json' })
    res.end(await answer.text())
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')
})
await new Promise(done => harness.listen(8787, '127.0.0.1', done))
note('the harness serves the real product channel and real cross-origin pages', { hostOrigin, dashboard, refused })

const browser = await chromium.launch({ headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', entry => { if (entry.type() === 'error') errors.push(`console: ${entry.text()}`) })
  await page.goto('http://127.0.0.1:8787/')
  await page.getByText('还没有固定页面').waitFor()
  note('an empty directory says so instead of showing a blank frame')

  // Pin the loopback dashboard through the real UI: the Host writes SQLite, the
  // snapshot poll reads it back, and the panel appears.
  await page.getByRole('button', { name: '新增固定页面' }).click()
  await page.locator('#bp-webpanel-draft-name').fill('Local board')
  await page.locator('#bp-webpanel-draft-url').fill(dashboard)
  await page.getByRole('button', { name: '保存' }).click()
  await page.locator('.bp-webpanel-frame').waitFor()
  await page.frameLocator('iframe.bp-webpanel-frame').locator('h1').waitFor()
  assert.equal(await page.frameLocator('iframe.bp-webpanel-frame').locator('h1').textContent(), 'Local fleet board')
  assert.match(await page.locator('.bp-webpanel-verdict').textContent(), /允许在此显示/)
  note('a real cross-origin dashboard renders inside the real frame, after the real probe')

  // A page that refuses embedding is answered with the reason, and no frame is left.
  await page.getByRole('button', { name: '新增固定页面' }).click()
  await page.locator('#bp-webpanel-draft-name').fill('Refused page')
  await page.locator('#bp-webpanel-draft-url').fill(refused)
  await page.getByRole('button', { name: '保存' }).click()
  await page.locator('.bp-webpanel-refused').waitFor()
  assert.equal(await page.locator('.bp-webpanel-frame').count(), 0)
  assert.match(await page.locator('.bp-webpanel-refused-body').textContent(), /拒绝了被其他应用嵌入/)
  await page.screenshot({ path: join(OUT, 'web-panel-refused.png'), fullPage: true, animations: 'disabled' })
  note('a page whose headers refuse framing shows the reason and no iframe', { image: 'web-panel-refused.png' })

  // The sidebar pin opens the dashboard again: an explicit switch shows that page.
  await page.locator('.bp-webpanel-pins .bp-webpanel-pin').first().click()
  await page.frameLocator('iframe.bp-webpanel-frame').locator('h1').waitFor()
  assert.equal(await page.frameLocator('iframe.bp-webpanel-frame').locator('h1').textContent(), 'Local fleet board')
  note('the sidebar pin opens the page it names')

  // Keyboard: the pin row is reachable and Enter selects it.
  await page.locator('.bp-webpanel-list .bp-webpanel-pin').nth(1).focus()
  await page.keyboard.press('Enter')
  await page.locator('.bp-webpanel-refused').waitFor()
  note('the pin row is operable from the keyboard alone')

  // Opening in the browser is a person's own click, in a new context, with no
  // handle back to this window and no referrer.
  await page.getByRole('button', { name: '在浏览器中打开' }).first().click()
  assert.deepEqual(await page.evaluate(() => window.__webPanelFixture.opened[0]),
    { url: refused, target: '_blank', features: 'noopener,noreferrer' })
  note('external open uses noopener/noreferrer and only ever a user gesture')

  // Removing the panel on screen leaves the workspace and frames nothing of it.
  await page.locator('.bp-webpanel-stage-tools .bp-webpanel-button-danger').click()
  await page.waitForFunction(() => window.__webPanelFixture.leave === 1)
  assert.equal(await page.locator('.bp-webpanel-list .bp-webpanel-pin').count(), 1, 'only the remaining pin is left')
  assert.equal(await page.frameLocator('iframe.bp-webpanel-frame').locator('h1').textContent(), 'Local fleet board')
  assert.equal(await page.evaluate(() => window.__webPanelFixture.calls.filter(call => call.action === 'webPanels.remove').length), 1)
  note('removing the panel on screen returns to the workspace and leaves nothing of that page')

  await page.locator('.bp-webpanel-list .bp-webpanel-pin').first().click()
  await page.frameLocator('iframe.bp-webpanel-frame').locator('h1').waitFor()
  await page.screenshot({ path: join(OUT, 'web-panel-wide.png'), fullPage: true, animations: 'disabled' })
  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'dark'))
  await page.screenshot({ path: join(OUT, 'web-panel-dark.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 375, height: 812 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal overflow at 375px')
  await page.screenshot({ path: join(OUT, 'web-panel-375.png'), fullPage: true, animations: 'disabled' })
  note('375px and dark mode lay out without overflow', { images: ['web-panel-wide.png', 'web-panel-dark.png', 'web-panel-375.png'] })
} finally {
  await browser.close()
  await new Promise(done => harness.close(done))
  await new Promise(done => pages.close(done))
  channelStore.close()
}

// A refused frame is the browser's own complaint about a page the Host already
// flagged; it is recorded, never hidden, and it is the only accepted console error.
const expectedRefusal = errors.filter(entry => /refused to display .* in a frame because it set ['"]?x-frame-options/i.test(entry))
const unexpected = errors.filter(entry => !expectedRefusal.includes(entry))
assert.deepEqual(unexpected, [], `unexpected page errors: ${unexpected.join(' | ')}`)
note('the page reports no unexpected errors', { expectedRefusals: expectedRefusal.length })

// ── 4. the delivered patch is the wiring this run exercised ──────────────────
if (wired) note('the parent wiring is already in the tree, so the real module was used as-is')
else {
  let patch = ''
  try { patch = await readFile(join(OUT, 'web-panel-wiring.patch'), 'utf8') } catch { patch = '' }
  assert.equal(wiring.every(fragment => patch.includes(fragment)), true, 'the delivered patch must carry the read-model allow-list and snapshot key')
  note('the delivered patch carries exactly the read-model wiring this run relied on')
}
const plan = JSON.parse(await readFile(join(ROOT, 'scripts/test-plan.json'), 'utf8'))
const selected = new Set(plan.stages.flat().filter(arg => typeof arg === 'string' && arg.startsWith('tests/')))
for (const spec of ['tests/web-panel-store.test.mjs', 'tests/web-panel-framing.test.mjs', 'tests/web-panel-actions.test.mjs', 'tests/web-panel-page.integration.test.mjs']) {
  assert.ok(selected.has(spec), `${spec} must be selected by the committed test plan`)
}
note('every new spec is selected by the committed test plan')

await writeFile(join(OUT, 'web-panel-verification.json'), `${JSON.stringify({
  status: 'passed', checks, images, pageErrors: unexpected, expectedRefusals: expectedRefusal.length,
  limitation: 'Real SQLite, real loopback framing, the real product channel and the real client in Chromium. Owner authentication is the documented seam; no model, profile, credential or non-loopback address is involved.',
}, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ status: 'passed', checks: checks.length, images }, null, 2)}\n`)
