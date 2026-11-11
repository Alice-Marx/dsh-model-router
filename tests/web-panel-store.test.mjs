import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

import {
  MAX_WEB_PANELS, MAX_WEB_PANEL_NAME_CHARS, MAX_WEB_PANEL_URL_BYTES, openWebPanelStore, probeUrlOf, redactWebPanelUrl, validateWebPanelInput,
} from '../packages/orchestration/src/web-panel-store.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const parent = resolve('tmp/integration/web-panels/store')
await mkdir(parent, { recursive: true })
const scratch = async () => join(await mkdtemp(join(parent, 'case-')), 'web-panels.sqlite')
const open = (file, over = {}) => openWebPanelStore({ Database, file, ...over })

test('the input check is closed: schemes, credentials, sizes and names', () => {
  assert.deepEqual(validateWebPanelInput({ name: '  Fleet board ', url: 'http://127.0.0.1:7841/' }),
    { name: 'Fleet board', url: 'http://127.0.0.1:7841/' })
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/hosts', '/relative', '', 'ftp://example.com',
    'https://user:secret@example.com/', 'https://user@example.com/', `https://example.com/${'a'.repeat(MAX_WEB_PANEL_URL_BYTES)}`]) {
    assert.throws(() => validateWebPanelInput({ name: 'x', url }), { code: 'WEB_PANEL_URL' }, url)
  }
  for (const name of ['', '   ', 'a'.repeat(MAX_WEB_PANEL_NAME_CHARS + 1), 'two\nlines']) {
    assert.throws(() => validateWebPanelInput({ name, url: 'https://a.example/' }), { code: 'WEB_PANEL_NAME' }, JSON.stringify(name))
  }
  assert.throws(() => validateWebPanelInput({ name: 'x' }), { code: 'WEB_PANEL_INPUT' })
  assert.throws(() => validateWebPanelInput({ name: 'x', url: 'https://a.example/', extra: 1 }), { code: 'WEB_PANEL_INPUT' })
  // A page on the client's own embedding origin is refused: the frame would keep
  // that page's origin and run with the client's access.
  assert.throws(() => validateWebPanelInput({ name: 'x', url: 'http://127.0.0.1:5173/settings' }, 'http://127.0.0.1:5173'),
    { code: 'WEB_PANEL_SELF_URL' })
  assert.deepEqual(validateWebPanelInput({ name: 'x', url: 'http://127.0.0.1:7841/' }, 'http://127.0.0.1:5173').url, 'http://127.0.0.1:7841/')
  // The native shell's origin is not an http origin, so no http page can match it.
  assert.deepEqual(validateWebPanelInput({ name: 'x', url: 'http://127.0.0.1:7841/' }, 'dsh-app://app').url, 'http://127.0.0.1:7841/')
})

test('a URL is logged and shared without its query, and probed without its fragment', () => {
  assert.equal(redactWebPanelUrl('https://board.example.com/runs?token=secret&x=1#live'), 'https://board.example.com/runs')
  assert.equal(redactWebPanelUrl('not a url'), '(unreadable url)')
  assert.equal(probeUrlOf('https://board.example.com/runs?x=1#live'), 'https://board.example.com/runs?x=1')
  assert.equal(probeUrlOf('https://board.example.com/#only'), 'https://board.example.com/')
})

test('create, rename, change the URL, reorder and unpin, each confirmed by a readback', async () => {
  const store = open(await scratch())
  const created = store.save({ name: 'Fleet board', url: 'http://127.0.0.1:7841/', expectedRevision: 0 })
  assert.deepEqual(created.panel, { id: 'panel-1', name: 'Fleet board', url: 'http://127.0.0.1:7841/', host: '127.0.0.1:7841', position: 1 })
  const second = store.save({ name: 'CI', url: 'https://ci.example.com/runs?x=1', expectedRevision: created.revision })
  assert.equal(second.panel.position, 2)
  const renamed = store.save({ id: created.panel.id, name: 'Fleet', url: 'http://127.0.0.1:7841/#live', expectedRevision: second.revision })
  assert.equal(renamed.panel.name, 'Fleet')
  assert.equal(renamed.panel.url, 'http://127.0.0.1:7841/#live')
  const ordered = store.order({ ids: [second.panel.id, created.panel.id], expectedRevision: renamed.revision })
  assert.deepEqual(ordered.panels.map(panel => [panel.id, panel.position]), [[second.panel.id, 1], [created.panel.id, 2]])
  const removed = store.remove({ id: second.panel.id, expectedRevision: ordered.revision })
  assert.equal(removed.removed, second.panel.id)
  // Positions stay dense, and a later insert lands at the end rather than in a gap.
  const fresh = store.save({ name: 'New', url: 'https://new.example/', expectedRevision: removed.revision })
  assert.deepEqual(store.read().panels.map(panel => panel.position), [1, 2])
  assert.equal(fresh.panel.position, 2)
  assert.equal(fresh.panel.id, 'panel-3')
  store.close()
})

test('a stale revision is refused instead of overwriting the list', async () => {
  const store = open(await scratch())
  const first = store.save({ name: 'One', url: 'https://one.example/', expectedRevision: 0 })
  assert.throws(() => store.save({ name: 'Two', url: 'https://two.example/', expectedRevision: 0 }), { code: 'WEB_PANEL_REVISION_CONFLICT' })
  assert.throws(() => store.remove({ id: first.panel.id, expectedRevision: 0 }), { code: 'WEB_PANEL_REVISION_CONFLICT' })
  assert.throws(() => store.order({ ids: [first.panel.id], expectedRevision: 0 }), { code: 'WEB_PANEL_REVISION_CONFLICT' })
  assert.deepEqual(store.read().panels.map(panel => panel.name), ['One'])
  // An unknown panel and a partial order are refusals, not silent edits.
  assert.throws(() => store.save({ id: 'panel-9', name: 'x', url: 'https://x.example/', expectedRevision: first.revision }), { code: 'WEB_PANEL_NOT_FOUND' })
  assert.throws(() => store.remove({ id: 'panel-9', expectedRevision: first.revision }), { code: 'WEB_PANEL_NOT_FOUND' })
  assert.throws(() => store.order({ ids: [], expectedRevision: first.revision }), { code: 'WEB_PANEL_ORDER_INVALID' })
  assert.throws(() => store.order({ ids: ['panel-1', 'panel-1'], expectedRevision: first.revision }), { code: 'WEB_PANEL_ORDER_INVALID' })
  store.close()
})

test('the list is bounded in count, and the bounds are the published ones', async () => {
  const store = open(await scratch())
  let revision = 0
  for (let index = 0; index < MAX_WEB_PANELS; index++) {
    revision = store.save({ name: `P${index}`, url: `https://p${index}.example/`, expectedRevision: revision }).revision
  }
  assert.equal(store.read().panels.length, MAX_WEB_PANELS)
  assert.throws(() => store.save({ name: 'Seven', url: 'https://p7.example/', expectedRevision: revision }), { code: 'WEB_PANEL_LIMIT' })
  assert.deepEqual(store.read().limits, { maxPanels: MAX_WEB_PANELS, maxNameChars: MAX_WEB_PANEL_NAME_CHARS,
    maxNameBytes: 120, maxUrlBytes: MAX_WEB_PANEL_URL_BYTES })
  store.close()
})

test('a panel survives a real restart, and a closed store refuses', async () => {
  const file = await scratch()
  const first = open(file)
  const saved = first.save({ name: 'Fleet', url: 'http://127.0.0.1:7841/', expectedRevision: 0 })
  first.close()
  const second = open(file)
  assert.deepEqual(second.read(), { revision: saved.revision,
    panels: [{ id: 'panel-1', name: 'Fleet', url: 'http://127.0.0.1:7841/', host: '127.0.0.1:7841', position: 1 }],
    limits: second.read().limits })
  second.close()
  assert.throws(() => second.read(), { code: 'WEB_PANEL_STORE_CLOSED' })
  assert.throws(() => second.save({ name: 'x', url: 'https://x.example/', expectedRevision: 0 }), { code: 'WEB_PANEL_STORE_CLOSED' })
})

test('two Hosts on one directory: the second sees the first, and a stale writer is refused', async () => {
  const file = await scratch()
  const host = open(file)
  const companion = open(file)
  const created = host.save({ name: 'Shared', url: 'http://127.0.0.1:7841/', expectedRevision: 0 })
  assert.deepEqual(companion.read().panels.map(panel => panel.id), ['panel-1'])
  // The companion read the old revision, so its write loses instead of clobbering.
  assert.throws(() => companion.save({ name: 'Mine', url: 'http://127.0.0.1:7841/other', expectedRevision: 0 }),
    { code: 'WEB_PANEL_REVISION_CONFLICT' })
  const own = companion.save({ name: 'Mine', url: 'http://127.0.0.1:7841/other', expectedRevision: created.revision })
  assert.equal(host.read().revision, own.revision)
  assert.deepEqual(host.read().panels.map(panel => panel.name), ['Shared', 'Mine'])
  companion.close(); host.close()
  await rm(file, { force: true }); await rm(`${file}-wal`, { force: true }); await rm(`${file}-shm`, { force: true })
})

test('an in-memory store works for callers without a file', () => {
  const store = open(':memory:')
  assert.deepEqual(store.read(), { revision: 0, panels: [], limits: store.limits })
  store.close()
})
