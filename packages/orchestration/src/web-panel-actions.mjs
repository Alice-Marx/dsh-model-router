// The owner-only product-channel surface for pinned web panels: what the panel
// list reads, what a person may change, and the one probe that asks a page
// whether it can be framed.
//
// Every entry here is a console operation, not a Bot capability. Nothing is
// registered as a model tool, so a Bot cannot ask this Host to fetch a page, and
// the caller's owner class comes from the authenticated channel context — a
// payload that claims `kind: 'owner'` is data, and is ignored as such. The only
// origin used is the one the channel reports as the client's embedding origin.
//
// A probe names a stored panel by id. The URL is the owner's own pin, never a
// string a client hands over on the side, so there is no "fetch this address"
// door here at all.

import { checkFraming, PROBE_TIMEOUT_MS } from './web-panel-framing.mjs'
import { probeUrlOf } from './web-panel-store.mjs'

export const WEB_PANEL_ACTIONS = Object.freeze([
  'webPanels.list', 'webPanels.probe', 'webPanels.save', 'webPanels.remove', 'webPanels.order',
])

const fail = code => { throw Object.assign(new Error(code), { code }) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const payloadOf = (payload, allowed) => {
  if (!plain(payload) || Object.keys(payload).some(key => !allowed.includes(key))) fail('WEB_PANEL_INPUT')
  return payload
}
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED') }

export function createWebPanelActions({ store, probe = checkFraming, now = Date.now, concurrency = 2, queue = 8, logger = () => {} }) {
  if (!store || typeof store.save !== 'function' || typeof store.read !== 'function') throw new TypeError('WEB_PANEL_STORE_REQUIRED')
  const limit = Number.isSafeInteger(concurrency) && concurrency > 0 ? concurrency : 2
  const waiting = Number.isSafeInteger(queue) && queue >= 0 ? queue : 8
  let active = 0
  const pending = []

  // Bounded by two gates: only `limit` probes run at once, and only `waiting`
  // may wait behind them. A Host is not a scanner, and a panel that cannot get a
  // slot says so instead of piling requests up behind a slow page.
  const release = () => {
    active--
    const next = pending.shift()
    if (next) { active++; next() }
  }
  const slot = work => new Promise((resolve, reject) => {
    const start = () => { work().then(resolve, reject).finally(release) }
    if (active < limit) { active++; start(); return }
    if (pending.length >= waiting) { reject(Object.assign(new Error('WEB_PANEL_PROBE_BUSY'), { code: 'WEB_PANEL_PROBE_BUSY' })); return }
    pending.push(start)
  })

  const list = () => {
    const { revision, panels, limits } = store.read()
    return { revision, panels, limits }
  }

  const provider = async () => {
    const value = list()
    // The read model's contract: a status and an items array, never a bare list.
    return { status: 'available', items: value.panels, revision: value.revision, limits: value.limits }
  }

  const actions = {
    'webPanels.list': (payload, context) => { owner(context); payloadOf(payload ?? {}, []); return list() },
    'webPanels.save': (payload, context) => {
      owner(context)
      const request = payloadOf(payload, ['id', 'name', 'url', 'expectedRevision'])
      const saved = store.save({ id: request.id ?? null, name: request.name, url: request.url,
        expectedRevision: request.expectedRevision, embeddingOrigin: context.clientOrigin ?? '' })
      // The readback is the store's own; this is the channel's confirmation that
      // the row a client is about to be shown is the row that was written.
      const after = store.read()
      if (after.revision !== saved.revision || !after.panels.some(panel => panel.id === saved.panel.id
        && panel.name === saved.panel.name && panel.url === saved.panel.url)) fail('WEB_PANEL_READBACK_MISMATCH')
      return { revision: saved.revision, panel: saved.panel }
    },
    'webPanels.remove': (payload, context) => {
      owner(context)
      const request = payloadOf(payload, ['id', 'expectedRevision'])
      return store.remove({ id: request.id, expectedRevision: request.expectedRevision })
    },
    'webPanels.order': (payload, context) => {
      owner(context)
      const request = payloadOf(payload, ['ids', 'expectedRevision'])
      return store.order({ ids: request.ids, expectedRevision: request.expectedRevision })
    },
    'webPanels.probe': async (payload, context) => {
      owner(context)
      const request = payloadOf(payload, ['id'])
      const panel = store.read().panels.find(entry => entry.id === request.id)
      if (!panel) fail('WEB_PANEL_NOT_FOUND')
      const started = now()
      const result = await slot(() => probe(probeUrlOf(panel.url), context.clientOrigin ?? '',
        { signal: context.signal, timeoutMs: PROBE_TIMEOUT_MS, maxBytes: 1, maxRedirects: 0 }))
      // A URL's query is the owner's business and never a log line; the origin is
      // enough to recognise the page in a diagnostic.
      logger('web-panel-probe', { panelId: panel.id, host: result.host, framing: result.framing, reason: result.reason, ms: now() - started })
      return { panelId: panel.id, framing: result.framing, reason: result.reason, host: result.host, checkedAt: now() }
    },
  }

  return Object.freeze({ actions, provider, list })
}
