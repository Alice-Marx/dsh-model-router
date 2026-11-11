/**
 * Unsent composer drafts: the text a person typed and did not send.
 *
 * What this is and nothing more. No attachment bytes, no OS paths, no Blob URLs,
 * no credentials, and no send: restoring a draft only fills the Host composer's
 * input, it never submits, starts a turn, calls a model or answers an approval.
 *
 * Why a store of its own: the Host composer keeps its draft only while its
 * session stays mounted, so switching conversations or reloading the window loses
 * what was typed. The client surface the product injects (sessions,
 * uiConversation, slots, theme, layout) exposes no draft state of its own, so the
 * product keeps the text here instead of reading the composer's DOM — a hashed
 * class selector or a global contenteditable query would be a guess about the
 * Host's markup, and this store only uses identities the Host already publishes.
 *
 * Host scope: several Hosts can share one origin (dsh-app://app), so a plain
 * origin store would let one Host read another's drafts. Every blob carries the
 * Host namespace that wrote it, and a store refuses to read, write or adopt a
 * blob from a different namespace or from an older replay of its own. A session
 * is only reachable once the Host surface has put it in the saved directory, and
 * the identity always comes from the mounted conversation's own roster row, never
 * from an argument a model could supply.
 *
 * The namespace itself is the Host's: it arrives from the Host's own
 * `ui.namespace` read (see composer-draft-host.jsx). `resolveHostId` below is a
 * fixture helper for tests and the offline browser preview; the production
 * wiring never imports it.
 */

export const COMPOSER_DRAFT_KEY = 'bot-product:composer-drafts'
export const COMPOSER_DRAFT_HOST_KEY = 'bot-product:composer-draft-host'

/**
 * One Host's blob lives under its own key. Two Hosts in one origin then cannot
 * overwrite each other, whatever their epochs say; the namespace inside the blob
 * is the second lock on the same door.
 */
export const composerDraftKey = hostId => `${COMPOSER_DRAFT_KEY}:${hostId}`
/** Per-conversation text and per-Host totals. A refusal names its reason. */
export const COMPOSER_DRAFT_LIMITS = Object.freeze({
  maxSessions: 48,
  maxTextChars: 20000,
  maxTextBytes: 65536,
  maxTotalBytes: 262144,
  maxDirectory: 512,
  saveDelayMs: 500,
})

const KINDS = new Set(['bot', 'room'])
const HOST_PATTERN = /^host-[0-9a-f]{16}$/
/** The threadId shape the Host's own thread directory accepts. */
const THREAD_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : undefined

/** UTF-8 length, so a Chinese draft is budgeted by what it costs to store. */
export const textBytes = text => (encoder ? encoder.encode(text).length : String(text).length)

/**
 * The storage identity of one conversation: a Bot or a group, never a part. A
 * Bot's chat spans numbered parts, and an unsent line survives a part rotation
 * because it belongs to the conversation, not to the session that was open.
 *
 * A thread is a separate conversation under the same Bot: each `threadId` gets
 * its own draft, so two threads of one Bot never share text. The threadId comes
 * from the Host's own thread directory mapped through the trusted roster, never
 * from a model argument.
 */
export function conversationKey({ kind, ownerId, threadId } = {}) {
  if (!KINDS.has(kind)) return ''
  const owner = typeof ownerId === 'string' ? ownerId.trim() : ''
  if (!owner || /[\s:/]/.test(owner)) return ''
  const thread = typeof threadId === 'string' ? threadId.trim() : ''
  if (!thread) return `${kind}:${owner}`
  if (!THREAD_PATTERN.test(thread)) return ''
  return `${kind}:${owner}:thread:${thread}`
}

/** The key for a mounted session, read from the Host roster it came with. */
export function ownerKeyFromRoster(sessionId, roster) {
  const id = typeof sessionId === 'string' ? sessionId : ''
  if (!id || !roster) return ''
  const thread = roster.threadsById?.[id]
  if (thread) return conversationKey({ kind: 'bot', ownerId: thread.botId, threadId: thread.threadId })
  const bot = roster.byId?.[id]
  if (bot) return conversationKey({ kind: 'bot', ownerId: bot.id ?? id })
  const room = roster.roomsById?.[id]
  if (room) return conversationKey({ kind: 'room', ownerId: room.id ?? id })
  return ''
}

/**
 * The key for a mounted session inside one thread of a Bot. `threadOf` maps the
 * mounted session to the stable threadId the Host directory gave it; a session
 * the mapping does not name is the Bot's default conversation, which every part
 * of that Bot shares.
 */
export function threadKeyFromRoster(sessionId, roster, threadOf) {
  const id = typeof sessionId === 'string' ? sessionId : ''
  if (!id || !roster) return ''
  const thread = roster.threadsById?.[id]
  if (thread) return conversationKey({ kind: 'bot', ownerId: thread.botId, threadId: thread.threadId })
  const bot = roster.byId?.[id]
  if (bot) return conversationKey({ kind: 'bot', ownerId: bot.id ?? id, threadId: threadOf?.(id) })
  const room = roster.roomsById?.[id]
  if (room) return conversationKey({ kind: 'room', ownerId: room.id ?? id })
  return ''
}

const mintHostId = random => {
  const raw = typeof random === 'function' ? String(random() ?? '') : ''
  const hex = raw.replace(/[^0-9a-f]/gi, '').slice(0, 16)
  // A namespace that silently collides would hand one Host another's drafts.
  if (hex.length !== 16) throw new Error('composer-draft: the Host namespace needs 16 hex characters')
  return `host-${hex.toLowerCase()}`
}

/**
 * The persisted Host namespace. Generated once and kept, so a reload reads the
 * same drafts; a blocked storage keeps it for this window only.
 *
 * FIXTURE HELPER. This is a browser-origin id, not a Host identity: two Hosts
 * sharing the `dsh-app://app` origin would mint and read the same value, which
 * is exactly the boundary the production path must not have. The production
 * namespace comes from the Host's own `ui.namespace` read through the product
 * API (composer-draft-host.jsx); nothing in the production wiring imports this.
 */
export function resolveHostId({ storage, key = COMPOSER_DRAFT_HOST_KEY, random } = {}) {
  const read = () => {
    try { return storage?.getItem?.(key) ?? '' } catch { return '' }
  }
  const found = read()
  if (HOST_PATTERN.test(found)) return found
  const minted = mintHostId(random)
  try { storage?.setItem?.(key, minted) } catch { /* a blocked store keeps this window's namespace */ }
  return minted
}

const readBlob = (storage, key) => {
  try {
    const raw = storage?.getItem?.(key)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

const writeBlob = (storage, key, blob) => {
  try { storage?.setItem?.(key, JSON.stringify(blob)); return true } catch { return false }
}

const cleanId = value => (typeof value === 'string' && value.length <= 200 ? value : '')

const bytesOf = sessions => Object.values(sessions).reduce((sum, row) => sum + (row?.bytes ?? 0), 0)

/**
 * One Host's draft store. Every entry point refuses instead of guessing: an
 * unknown conversation, a foreign or replayed blob, an over-budget text and a
 * stale revision all return `{ ok: false, reason }` and change nothing.
 */
export function createComposerDraftStore({ storage, hostId, limits = {}, now, schedule } = {}) {
  const bound = { ...COMPOSER_DRAFT_LIMITS, ...limits }
  const clock = typeof now === 'function' ? now : () => Date.now()
  const later = typeof schedule === 'function' ? schedule : run => setTimeout(run, bound.saveDelayMs)
  const namespace = typeof hostId === 'string' && HOST_PATTERN.test(hostId) ? hostId : ''
  if (!namespace) throw new Error('composer-draft: a store needs a persisted Host namespace')
  const blobKey = composerDraftKey(namespace)

  let state = { epoch: 0, directory: {}, sessions: {} }
  let written = 0
  let loaded = false
  let scheduled = false
  let dirty = false

  const refuse = reason => ({ ok: false, reason })

  const load = () => {
    if (loaded) return
    loaded = true
    const blob = readBlob(storage, blobKey)
    if (!blob) return
    // Another Host's blob, or an older replay of this one, is not adopted.
    if (blob.hostId !== namespace) return
    if (!Number.isInteger(blob.epoch) || blob.epoch < written) return
    state = {
      epoch: blob.epoch,
      directory: blob.directory && typeof blob.directory === 'object' ? blob.directory : {},
      sessions: blob.sessions && typeof blob.sessions === 'object' ? blob.sessions : {},
    }
    written = blob.epoch
  }

  const commit = () => {
    if (!dirty) return
    state.epoch += 1
    if (writeBlob(storage, blobKey, { version: 1, hostId: namespace, epoch: state.epoch, directory: state.directory, sessions: state.sessions })) written = state.epoch
    dirty = false
  }

  const soon = () => {
    dirty = true
    if (scheduled) return
    scheduled = true
    later(() => { scheduled = false; load(); commit() })
  }

  /** Drops drafts the Host no longer serves, then the oldest over budget. */
  const prune = keep => {
    if (keep !== undefined) {
      const live = keep instanceof Set ? keep : new Set(keep ?? [])
      for (const key of Object.keys(state.directory)) if (!live.has(key)) delete state.directory[key]
      for (const key of Object.keys(state.sessions)) if (!live.has(key)) delete state.sessions[key]
    }
    const order = Object.entries(state.sessions).sort((left, right) => (left[1]?.updatedAt ?? 0) - (right[1]?.updatedAt ?? 0))
    while (order.length > bound.maxSessions) {
      const [key] = order.shift()
      delete state.sessions[key]
    }
    for (const [key, row] of order) {
      if (bytesOf(state.sessions) <= bound.maxTotalBytes) break
      delete state.sessions[key]
    }
    const seen = Object.entries(state.directory).sort((left, right) => (left[1]?.seenAt ?? 0) - (right[1]?.seenAt ?? 0))
    while (seen.length > bound.maxDirectory) delete state.directory[seen.shift()[0]]
  }

  /**
   * The key of a conversation the saved Host directory knows, or null. A
   * conversation the Host is not serving has no draft to read or write.
   */
  const served = key => {
    load()
    if (!key || !state.directory[key]) return null
    return key
  }

  return {
    hostId: namespace,
    limits: bound,

    /** Records that the Host surface is serving this conversation right now. */
    see({ kind, ownerId, threadId, sessionId } = {}) {
      const key = conversationKey({ kind, ownerId, threadId })
      if (!key) return false
      load()
      const previous = state.directory[key] ?? {}
      state.directory[key] = { sessionId: cleanId(sessionId) || previous.sessionId || '', seenAt: clock() }
      prune()
      soon()
      return true
    },

    /** Keeps only the conversations the Host still lists. */
    reconcile(keys) {
      load()
      prune(keys)
      soon()
      return Object.keys(state.sessions).length
    },

    /** The saved draft, or null. Never a draft from another Host. */
    read({ kind, ownerId, threadId } = {}) {
      const key = served(conversationKey({ kind, ownerId, threadId }))
      if (key === null) return null
      const row = state.sessions[key]
      return row ? { ...row, key } : null
    },

    /** Stores one draft. A stale revision is dropped, never written over. */
    save({ kind, ownerId, threadId, sessionId, text, revision, pendingAt, pendingRequestId } = {}) {
      const key = served(conversationKey({ kind, ownerId, threadId }))
      if (key === null) return refuse('unknown-conversation')
      const body = typeof text === 'string' ? text : ''
      if (!body) return refuse('empty-draft')
      if (body.length > bound.maxTextChars) return refuse('too-long')
      const bytes = textBytes(body)
      if (bytes > bound.maxTextBytes) return refuse('too-large')
      const previous = state.sessions[key]
      if (!Number.isInteger(revision) || revision <= (previous?.revision ?? 0)) return refuse('stale-revision')
      const others = bytesOf(state.sessions) - (previous?.bytes ?? 0)
      if (others + bytes > bound.maxTotalBytes) return refuse('over-budget')
      state.sessions[key] = {
        text: body, bytes, revision, sessionId: cleanId(sessionId), updatedAt: clock(),
        // A send that took this text and has not been answered yet, so the next
        // mount asks the witness before showing it back.
        pendingAt: Number.isFinite(pendingAt) && pendingAt > 0 ? Math.floor(pendingAt) : 0,
        pendingRequestId: typeof pendingRequestId === 'string' && pendingRequestId.length <= 256 ? pendingRequestId : '',
      }
      prune()
      soon()
      return { ok: true }
    },

    /** Drops one draft. Only a revision at least as new as the saved one may. */
    clear({ kind, ownerId, threadId, revision } = {}) {
      const key = served(conversationKey({ kind, ownerId, threadId }))
      if (key === null) return refuse('unknown-conversation')
      const previous = state.sessions[key]
      if (!previous) return { ok: true }
      if (!Number.isInteger(revision) || revision <= previous.revision) return refuse('stale-revision')
      delete state.sessions[key]
      soon()
      return { ok: true }
    },

    /** Writes the pending change now, before a window goes away. */
    flush() {
      scheduled = false
      load()
      commit()
      return { ok: true }
    },

    snapshot() {
      load()
      return {
        hostId: namespace,
        epoch: state.epoch,
        sessions: Object.fromEntries(Object.entries(state.sessions).map(([key, row]) => [key, { ...row }])),
        directory: Object.fromEntries(Object.entries(state.directory).map(([key, row]) => [key, { ...row }])),
      }
    },
  }
}
