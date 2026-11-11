import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

import { openWebPanelStore } from '../packages/orchestration/src/web-panel-store.mjs'
import { createWebPanelActions, WEB_PANEL_ACTIONS } from '../packages/orchestration/src/web-panel-actions.mjs'
import { PRODUCT_TOOLS, compileProductGrant } from '../packages/orchestration/src/product-composition.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const scratch = resolve('tmp/integration/web-panels/actions')
await mkdir(scratch, { recursive: true })

// The parent owns modules/bot-runtime/read-model.mjs: its ACTIONS allow-list and
// its snapshot key list are what make a product action reachable at all. This
// suite runs against the REAL channel, so until that wiring lands it materialises
// the same file with exactly the two lines the delivered patch adds — and it says
// so, rather than standing up a fake owner-only wrapper of its own.
const READ_MODEL = new URL('../modules/bot-runtime/read-model.mjs', import.meta.url)
const readModelSource = await readFile(READ_MODEL, 'utf8')
const wired = WEB_PANEL_ACTIONS.every(name => readModelSource.includes(`'${name}'`))
let channel = '../modules/bot-runtime/read-model.mjs'
if (!wired) {
  const patched = readModelSource
    .replace("  'ui.namespace',\n", "  'ui.namespace',\n  'webPanels.list', 'webPanels.probe', 'webPanels.save', 'webPanels.remove', 'webPanels.order',\n")
    .replace("  usage: blocked(", "  webPanels: blocked('宿主尚未提供固定网页面板目录。', '接入固定网页面板存储后，可在这里把常用网页固定在侧栏。'),\n  usage: blocked(")
  assert.ok(patched.includes("'webPanels.list'"), 'the allow-list insertion must apply')
  assert.ok(patched.includes('webPanels: blocked('), 'the snapshot key insertion must apply')
  const file = join(await mkdtemp(join(scratch, 'channel-')), 'read-model.mjs')
  await writeFile(file, patched)
  channel = pathToFileURL(file).href
}
const { createProductReadModel } = await import(channel)
// The untouched module, for the one check that is about the allow-list itself.
const { createProductReadModel: createUnwiredReadModel } = await import('../modules/bot-runtime/read-model.mjs')

const OWNER = { kind: 'owner', clientOrigin: 'http://127.0.0.1:5173', signal: undefined }
const BOT = { kind: 'bot', clientOrigin: 'http://127.0.0.1:5173' }
// The read model's own minimum: a projection it can read, and a lifecycle it can
// describe. Everything else in the channel is the parent's.
const runtime = { readOnly: () => undefined, load: async () => {}, state: { bots: {}, mainBotIds: [] }, chatOf: () => null }
const lifecycle = { status: () => ({ phase: 'active' }) }

async function board(over = {}) {
  const store = openWebPanelStore({ Database, file: join(await mkdtemp(join(scratch, 'case-')), 'web-panels.sqlite'), ...over })
  const service = createWebPanelActions({ store, ...over })
  const model = createProductReadModel({ runtime, lifecycle, actions: service.actions, providers: { webPanels: service.provider } })
  return { store, service, model }
}

test('the real channel reaches every web panel action for an owner, and refuses a Bot', async () => {
  const { model, store } = await board()
  const listed = await model.dispatch({ action: 'webPanels.list', payload: {} }, OWNER)
  assert.equal(listed.revision, 0)
  assert.deepEqual(listed.panels, [])
  const saved = await model.dispatch({ action: 'webPanels.save', payload: { name: 'Fleet', url: 'http://127.0.0.1:7841/', expectedRevision: 0 } }, OWNER)
  assert.equal(saved.panel.name, 'Fleet')
  const ordered = await model.dispatch({ action: 'webPanels.order', payload: { ids: [saved.panel.id], expectedRevision: saved.revision } }, OWNER)
  assert.deepEqual(ordered.panels.map(panel => panel.id), [saved.panel.id])
  for (const action of WEB_PANEL_ACTIONS) {
    // A Bot is refused at the seam, and a payload that claims to be the owner is
    // just data: the caller class comes from the authenticated context only.
    await assert.rejects(model.dispatch({ action, payload: { kind: 'owner', id: saved.panel.id, expectedRevision: 0 } }, BOT),
      { code: 'REMOTE_OWNER_REQUIRED' }, action)
    await assert.rejects(model.dispatch({ action, payload: {} }, {}), { code: 'REMOTE_OWNER_REQUIRED' }, action)
  }
  const removed = await model.dispatch({ action: 'webPanels.remove', payload: { id: saved.panel.id, expectedRevision: ordered.revision } }, OWNER)
  assert.equal(removed.removed, saved.panel.id)
  store.close()
})

test('the snapshot carries the Host directory, not a browser preference', async () => {
  const { model, store } = await board()
  await model.dispatch({ action: 'webPanels.save', payload: { name: 'Fleet', url: 'http://127.0.0.1:7841/', expectedRevision: 0 } }, OWNER)
  const snapshot = await model.snapshot({})
  assert.equal(snapshot.webPanels.status, 'available')
  assert.equal(snapshot.webPanels.revision, 1)
  assert.deepEqual(snapshot.webPanels.items.map(panel => panel.name), ['Fleet'])
  assert.equal(snapshot.webPanels.limits.maxPanels, 6)
  assert.ok(snapshot.availableActions.includes('webPanels.probe'))
  store.close()
})

test('the allow-list is the gate: an unwired action is refused, not silently run', async () => {
  const { store } = await board()
  if (wired) { store.close(); return }
  const bare = createUnwiredReadModel({ runtime: { readOnly: () => undefined },
    actions: { 'webPanels.list': () => { throw new Error('must not run') } } })
  await assert.rejects(bare.dispatch({ action: 'webPanels.list', payload: {} }, OWNER), { code: 'INVALID_PRODUCT_ACTION' })
  // And a name the schema does not allow never reaches a handler either.
  await assert.rejects(bare.dispatch({ action: 'webPanels.frobnicate', payload: {} }, OWNER), { code: 'INVALID_PRODUCT_ACTION' })
  store.close()
})

test('a save is refused when the URL is the client embedding origin', async () => {
  const { model, store } = await board()
  await assert.rejects(model.dispatch({ action: 'webPanels.save',
    payload: { name: 'Me', url: 'http://127.0.0.1:5173/settings', expectedRevision: 0 } }, OWNER), { code: 'WEB_PANEL_SELF_URL' })
  assert.deepEqual(store.read().panels, [])
  // The native shell's opaque origin cannot be matched by any http page.
  const saved = await model.dispatch({ action: 'webPanels.save',
    payload: { name: 'Fleet', url: 'http://127.0.0.1:7841/', expectedRevision: 0 } }, { ...OWNER, clientOrigin: 'dsh-app://app' })
  assert.equal(saved.panel.url, 'http://127.0.0.1:7841/')
  store.close()
})

test('a probe answers a real page over a real socket, and a bad id is refused', async t => {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0]
    if (path === '/deny') res.writeHead(200, { 'x-frame-options': 'DENY' }).end('no')
    else if (path === '/slow') setTimeout(() => res.writeHead(200).end('late'), 1200)
    else res.writeHead(200).end('ok')
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = server.address().port
  const { model, store } = await board()
  const saved = await model.dispatch({ action: 'webPanels.save', payload: { name: 'Board', url: `http://127.0.0.1:${port}/`, expectedRevision: 0 } }, OWNER)
  const ok = await model.dispatch({ action: 'webPanels.probe', payload: { id: saved.panel.id } }, OWNER)
  assert.deepEqual(ok, { panelId: saved.panel.id, framing: 'allowed', reason: null, host: `127.0.0.1:${port}`, checkedAt: ok.checkedAt })
  // The URL is the stored pin: a fragment is dropped, and no query is ever echoed.
  const edited = await model.dispatch({ action: 'webPanels.save',
    payload: { id: saved.panel.id, name: 'Board', url: `http://127.0.0.1:${port}/deny?token=secret#live`, expectedRevision: saved.revision } }, OWNER)
  assert.equal(edited.panel.url, `http://127.0.0.1:${port}/deny?token=secret#live`)
  const blocked = await model.dispatch({ action: 'webPanels.probe', payload: { id: saved.panel.id } }, OWNER)
  assert.deepEqual(blocked, { panelId: saved.panel.id, framing: 'blocked', reason: null, host: `127.0.0.1:${port}`, checkedAt: blocked.checkedAt })
  assert.ok(!JSON.stringify(blocked).includes('token=secret'), 'a probe answer never carries the URL query')
  await assert.rejects(model.dispatch({ action: 'webPanels.probe', payload: { id: 'panel-99' } }, OWNER), { code: 'WEB_PANEL_NOT_FOUND' })
  await assert.rejects(model.dispatch({ action: 'webPanels.probe', payload: { id: saved.panel.id, url: 'http://127.0.0.1:1/' } }, OWNER), { code: 'WEB_PANEL_INPUT' })
  store.close()
})

test('a probe is bounded: two at a time, a short queue, and an abort ends it', async t => {
  const server = createServer((req, res) => { if (req.url === '/slow') setTimeout(() => res.writeHead(200).end('late'), 1200); else res.writeHead(200).end('ok') })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = server.address().port
  const file = join(await mkdtemp(join(scratch, 'case-')), 'web-panels.sqlite')
  const store = openWebPanelStore({ Database, file })
  let revision = 0
  const ids = []
  for (let index = 0; index < 4; index++) {
    const saved = store.save({ name: `Slow ${index}`, url: `http://127.0.0.1:${port}/slow`, expectedRevision: revision })
    revision = saved.revision
    ids.push(saved.panel.id)
  }
  const service = createWebPanelActions({ store, concurrency: 1, queue: 1 })
  const model = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: service.actions })
  const results = await Promise.allSettled(ids.map(id => model.dispatch({ action: 'webPanels.probe', payload: { id } }, OWNER)))
  const refused = results.filter(result => result.status === 'rejected').map(result => result.reason.code)
  assert.deepEqual([...new Set(refused)], ['WEB_PANEL_PROBE_BUSY'], 'a probe that cannot get a slot says so')
  assert.ok(results.filter(result => result.status === 'fulfilled').length <= 2, 'at most one probe runs and one waits')
  // A cancelled probe stops waiting on the page.
  const controller = new AbortController()
  const pending = model.dispatch({ action: 'webPanels.probe', payload: { id: ids[0] } }, { ...OWNER, signal: controller.signal })
  setTimeout(() => controller.abort(), 40)
  assert.equal((await pending).reason, 'aborted')
  store.close()
})

test('no Bot grant and no model tool carries a web panel capability', () => {
  assert.ok(!PRODUCT_TOOLS.some(tool => /web.?panel/i.test(tool)), 'the tool list must stay free of web panels')
  const grant = compileProductGrant({ id: 'bot-a', model: 'deepseek/chat' }, { routes: new Set(['deepseek/chat']), hydrated: true })
  assert.ok(!grant.tools.some(tool => /web.?panel/i.test(tool)))
  assert.ok(!Object.hasOwn(grant, 'webPanels'))
})
