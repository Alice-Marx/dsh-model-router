// The Host's own directory of pinned web panels: the few pages an owner keeps
// one click away (a local dashboard, a CI board). It is a Host component table
// next to the other SQLite authorities, never a browser-local preference, so a
// pinned page survives a restart and every client sees the same list.
//
// Two rules shape this file:
//
// 1. Identity is never taken from the browser. A panel is minted by the Host,
//    the caller's owner class comes from the authenticated product channel, and
//    the only origin the store is told about is the one the client reports as
//    its own embedding origin — used to refuse framing a page that would run
//    with the client's own access, never to identify anybody.
// 2. A write is only a write once it has been read back. Every mutation runs in
//    one immediate transaction guarded by a revision, and the row is re-read
//    after the commit: a store that reports a change it did not make is worse
//    than one that refuses.

import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

export const MAX_WEB_PANELS = 6
export const MAX_WEB_PANEL_NAME_CHARS = 40
export const MAX_WEB_PANEL_NAME_BYTES = 120
export const MAX_WEB_PANEL_URL_BYTES = 2048
export const WEB_PANEL_LIMITS = Object.freeze({
  maxPanels: MAX_WEB_PANELS,
  maxNameChars: MAX_WEB_PANEL_NAME_CHARS,
  maxNameBytes: MAX_WEB_PANEL_NAME_BYTES,
  maxUrlBytes: MAX_WEB_PANEL_URL_BYTES,
})

const fail = code => { throw Object.assign(new Error(code), { code }) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
// A panel name is a label in a list: control characters would break the row, and
// they carry no meaning a person can read.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const ID = /^panel-[1-9][0-9]{0,9}$/

/**
 * The closed input check. `embeddingOrigin` is the origin the client framed this
 * page from; a page on that very origin is refused because the frame keeps its
 * page's own origin and would run with the client's access.
 */
export function validateWebPanelInput(input, embeddingOrigin = '') {
  if (!plain(input) || Object.keys(input).some(key => !['name', 'url'].includes(key))) fail('WEB_PANEL_INPUT')
  if (typeof input.name !== 'string' || typeof input.url !== 'string') fail('WEB_PANEL_INPUT')
  const name = input.name.trim()
  if (!name || name.length > MAX_WEB_PANEL_NAME_CHARS || Buffer.byteLength(name, 'utf8') > MAX_WEB_PANEL_NAME_BYTES || CONTROL.test(name)) fail('WEB_PANEL_NAME')
  const raw = input.url.trim()
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_WEB_PANEL_URL_BYTES) fail('WEB_PANEL_URL')
  let url
  try { url = new URL(raw) } catch { fail('WEB_PANEL_URL') }
  // Only plain web pages. `javascript:`, `data:`, `file:` and every other scheme
  // is refused here rather than being handed to a browser to interpret.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('WEB_PANEL_URL')
  if (url.username || url.password || !url.hostname) fail('WEB_PANEL_URL')
  if (embeddingOrigin && sameOrigin(url, embeddingOrigin)) fail('WEB_PANEL_SELF_URL')
  return Object.freeze({ name, url: url.href })
}

function sameOrigin(url, origin) {
  try { return new URL(origin).origin === url.origin } catch { return false }
}

/** What a client may see. The stored URL is the owner's own input; nothing here adds a path or a secret. */
export const publicWebPanel = panel => Object.freeze({
  id: panel.id, name: panel.name, url: panel.url, host: hostOf(panel.url), position: panel.position,
})

export function hostOf(url) {
  try { return new URL(url).host } catch { return '' }
}

/** The same URL without its fragment: a fragment is for the browser, never for a probe. */
export function probeUrlOf(url) {
  try { const parsed = new URL(url); parsed.hash = ''; return parsed.href } catch { return '' }
}

/** A URL safe to write to a log or a share card: origin and path, never the query. */
export function redactWebPanelUrl(url) {
  try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}` } catch { return '(unreadable url)' }
}

export function openWebPanelStore({ Database, file, now = Date.now }) {
  if (typeof Database !== 'function') throw new TypeError('WEB_PANEL_DATABASE_REQUIRED')
  if (typeof file !== 'string' || !file) throw new TypeError('WEB_PANEL_FILE_REQUIRED')
  if (file !== ':memory:') { file = resolve(file); mkdirSync(dirname(file), { recursive: true }) }
  const db = new Database(file)
  db.pragma('busy_timeout=5000')
  db.pragma('journal_mode=WAL')
  db.pragma('synchronous=FULL')
  db.exec(`CREATE TABLE IF NOT EXISTS web_panel_component(component TEXT PRIMARY KEY,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_panel_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,next_seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_panels(id TEXT PRIMARY KEY,position INTEGER NOT NULL,name TEXT NOT NULL,url TEXT NOT NULL,created_at_ms INTEGER NOT NULL,updated_at_ms INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS web_panels_position ON web_panels(position);`)
  const version = db.prepare('SELECT version FROM web_panel_component WHERE component=?').get('web-panels')
  if (version && version.version !== 1) { db.close(); fail('WEB_PANEL_DATABASE_VERSION_UNSUPPORTED') }
  db.prepare('INSERT OR IGNORE INTO web_panel_component VALUES(?,1)').run('web-panels')
  db.prepare('INSERT OR IGNORE INTO web_panel_meta VALUES(1,0,1)').run()

  let closed = false
  const alive = () => { if (closed) fail('WEB_PANEL_STORE_CLOSED') }
  const rowOf = id => db.prepare('SELECT * FROM web_panels WHERE id=?').get(id)
  const revisionOf = () => db.prepare('SELECT revision FROM web_panel_meta WHERE singleton=1').get().revision
  const ordered = () => db.prepare('SELECT * FROM web_panels ORDER BY position').all()

  // One immediate transaction, so two writers cannot both believe they hold the
  // list. The busy timeout is what keeps a second Host waiting instead of
  // failing while this one commits.
  const transact = work => {
    db.exec('BEGIN IMMEDIATE')
    try { const value = work(); db.exec('COMMIT'); return value } catch (error) { db.exec('ROLLBACK'); throw error }
  }

  const claim = expected => {
    const current = revisionOf()
    if (!Number.isSafeInteger(expected) || expected !== current) fail('WEB_PANEL_REVISION_CONFLICT')
    db.prepare('UPDATE web_panel_meta SET revision=? WHERE singleton=1').run(current + 1)
    return current + 1
  }

  // The commit is the claim; this is the proof. A row that does not read back as
  // written fails the call instead of letting the panel believe it was saved.
  const readback = (revision, panels) => {
    const after = ordered()
    const same = after.length === panels.length
      && after.every((row, index) => row.id === panels[index].id && row.name === panels[index].name
        && row.url === panels[index].url && row.position === panels[index].position)
    if (!same || revisionOf() !== revision) fail('WEB_PANEL_READBACK_MISMATCH')
    return after
  }

  const read = () => { alive(); return { revision: revisionOf(), panels: ordered().map(publicWebPanel), limits: WEB_PANEL_LIMITS } }

  const save = ({ id = null, name, url, expectedRevision, embeddingOrigin = '' }) => {
    alive()
    if (id !== null && (typeof id !== 'string' || !ID.test(id))) fail('WEB_PANEL_INPUT')
    if (!Number.isSafeInteger(expectedRevision)) fail('WEB_PANEL_INPUT')
    const next = validateWebPanelInput({ name, url }, embeddingOrigin)
    const at = now()
    const committed = transact(() => {
      const revision = claim(expectedRevision)
      const existing = id === null ? undefined : rowOf(id)
      if (id !== null && !existing) fail('WEB_PANEL_NOT_FOUND')
      const count = db.prepare('SELECT COUNT(*) AS n FROM web_panels').get().n
      let row
      if (existing) {
        db.prepare('UPDATE web_panels SET name=?,url=?,updated_at_ms=? WHERE id=?').run(next.name, next.url, at, id)
        row = { ...rowOf(id) }
      } else {
        if (count >= MAX_WEB_PANELS) fail('WEB_PANEL_LIMIT')
        const seq = db.prepare('SELECT next_seq FROM web_panel_meta WHERE singleton=1').get().next_seq
        const fresh = `panel-${seq}`
        db.prepare('UPDATE web_panel_meta SET next_seq=? WHERE singleton=1').run(seq + 1)
        db.prepare('INSERT INTO web_panels VALUES(?,?,?,?,?,?)').run(fresh, count + 1, next.name, next.url, at, at)
        row = { ...rowOf(fresh) }
      }
      readback(revision, ordered())
      return row
    })
    return { revision: revisionOf(), panel: publicWebPanel(committed) }
  }

  const remove = ({ id, expectedRevision }) => {
    alive()
    if (typeof id !== 'string' || !ID.test(id) || !Number.isSafeInteger(expectedRevision)) fail('WEB_PANEL_INPUT')
    const committed = transact(() => {
      const revision = claim(expectedRevision)
      const existing = rowOf(id)
      if (!existing) fail('WEB_PANEL_NOT_FOUND')
      db.prepare('DELETE FROM web_panels WHERE id=?').run(id)
      // Positions stay dense: a gap would let a later insert land in the middle.
      const at = now()
      const rest = ordered()
      for (const [index, row] of rest.entries()) db.prepare('UPDATE web_panels SET position=?,updated_at_ms=? WHERE id=?').run(index + 1, at, row.id)
      readback(revision, ordered())
      return existing
    })
    return { revision: revisionOf(), removed: committed.id }
  }

  const order = ({ ids, expectedRevision }) => {
    alive()
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && ID.test(id)) || !Number.isSafeInteger(expectedRevision)) fail('WEB_PANEL_INPUT')
    if (new Set(ids).size !== ids.length || ids.length > MAX_WEB_PANELS) fail('WEB_PANEL_ORDER_INVALID')
    const committed = transact(() => {
      const revision = claim(expectedRevision)
      const current = ordered()
      // The request must be the whole list in a new order, never a partial edit
      // that would silently drop whatever it left out.
      if (current.length !== ids.length || [...ids].sort().join() !== current.map(row => row.id).sort().join()) fail('WEB_PANEL_ORDER_INVALID')
      const at = now()
      // Two passes: an arbitrary permutation cannot be written in place without
      // tripping the unique position index, so the rows step aside first.
      for (const [index, id] of ids.entries()) db.prepare('UPDATE web_panels SET position=? WHERE id=?').run(-(index + 1), id)
      for (const [index, id] of ids.entries()) db.prepare('UPDATE web_panels SET position=?,updated_at_ms=? WHERE id=?').run(index + 1, at, id)
      readback(revision, ordered())
      return ordered()
    })
    return { revision: revisionOf(), panels: committed.map(publicWebPanel) }
  }

  const close = () => { closed = true; db.close() }

  return Object.freeze({ kind: 'web-panel-store', limits: WEB_PANEL_LIMITS, read, save, remove, order, close })
}
