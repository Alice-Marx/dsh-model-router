import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { composerDraftKey } from '../apps/integration-client/composer-draft.mjs'

// The namespace comes from the Host, over the product API, and nothing else. The
// RPC here is a controlled stand-in on the same shape the Host answers with:
// dispatch('ui.namespace', {}, signal) -> { schemaVersion: 1, hostId }.
const HOST_A = 'host-aaaaaaaaaaaaaaaa'
const HOST_B = 'host-bbbbbbbbbbbbbbbb'

const parent = resolve('tmp/integration/chat-drafts')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'namespace-')), output = join(directory, 'composer-draft-host.mjs')
const bundle = await build({
  entryPoints: ['apps/integration-client/composer-draft-host.jsx'], bundle: true, platform: 'node', format: 'esm',
  external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' }, logLevel: 'silent',
})
await (await import('node:fs/promises')).writeFile(output, bundle.outputFiles[0].contents)
const { ComposerDraftHost, withComposerDraft, validateNamespace } = await import(pathToFileURL(output))
const session = await build({
  entryPoints: ['apps/integration-client/composer-draft-session.jsx'], bundle: true, platform: 'node', format: 'esm',
  external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' }, logLevel: 'silent',
})
await (await import('node:fs/promises')).writeFile(join(directory, 'session.mjs'), session.outputFiles[0].contents)
const { ComposerDraft } = await import(pathToFileURL(join(directory, 'session.mjs')))

const source = initial => {
  let state = initial
  const listeners = new Set()
  const api = {
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => state,
    set: patch => { state = typeof patch === 'function' ? patch(state) : { ...state, ...patch }; for (const listener of [...listeners]) listener() },
    use: select => React.useSyncExternalStore(api.subscribe, () => select(api.getSnapshot()), () => select(api.getSnapshot())),
  }
  return api
}

const wait = () => new Promise(done => setTimeout(done, 5))

/** A productApi whose ui.namespace read the test drives by hand. */
function controlledApi({ hostIds = [HOST_A], hang = [], fail = new Set() } = {}) {
  const calls = []
  const api = {
    calls,
    dispatch: async (action, payload, signal) => {
      if (action !== 'ui.namespace') throw new Error(`unexpected action ${action}`)
      const index = calls.length
      calls.push({ action, payload, aborted: false })
      const current = calls[index]
      signal?.addEventListener?.('abort', () => { current.aborted = true })
      if (hang.includes(index)) await new Promise(() => {})
      if (fail.has(index)) throw Object.assign(new Error('宿主暂时读不到界面存储标识。'), { code: 'UI_NAMESPACE_UNAVAILABLE' })
      const hostId = hostIds[Math.min(index, hostIds.length - 1)]
      return { schemaVersion: 1, hostId }
    },
  }
  return api
}

const BOTS = { 'bot-a': { id: 'bot-a', name: '研究伙伴' }, 'bot-b': { id: 'bot-b', name: '写手' } }
const ROOMS = { 'room-x': { id: 'room-x', name: '研究小组' } }

async function withHost(work, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body data-bot-product-ui="1"><div id="root"></div></body></html>', { url: 'http://dsh.fixture/app', pretendToBeVisual: true })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, localStorage: undefined }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  // One real same-origin storage object, shared by every Host in this window.
  const storage = new Map()
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: localStorage })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const roster = source({ byId: BOTS, roomsById: ROOMS })
  const input = source({ draft: '', phase: 'plain', attachmentIds: [], queue: [] })
  const notes = []
  const inserts = []
  const statuses = []
  const actions = {
    captureInsertion: () => ({ caret: input.getSnapshot().draft.length }),
    insertText: (text) => { inserts.push(text); input.set(state => ({ ...state, draft: `${state.draft}${text}` })); return true },
  }
  const view = { sessionId: 'bot-a' }
  // One productApi per window, as a real Host has; a Host replacement swaps it.
  const current = { api: options.api }
  const mount = (props = {}) => {
    if (props.productApi) current.api = props.productApi
    return React.createElement(ComposerDraftHost, {
      productApi: current.api, sessionId: view.sessionId, useRoster: roster.use, useInput: input.use,
      inputActions: actions, onNote: value => notes.push(value), onStatus: value => statuses.push(value), ...props,
    })
  }
  const settle = async job => { await act(async () => { job?.(); await wait() }) }
  const render = async (props = {}) => {
    const seen = statuses.length
    await settle(() => root.render(mount(props)))
    // The namespace read is the Host's to answer; a test waits for it instead of
    // guessing how long the round-trip takes.
    for (let step = 0; step < 40 && statuses.length === seen; step += 1) await settle()
    await settle()
  }
  const unmount = async () => { await act(async () => root.unmount()) }
  // The store debounces its write; a test that reads storage waits for it.
  const flushed = async () => { await act(async () => { await new Promise(done => setTimeout(done, 520)) }) }
  const open = async sessionId => {
    view.sessionId = sessionId
    await settle(() => { input.set({ draft: '', phase: 'plain' }); root.render(mount()) })
  }
  const type = async text => { await settle(() => input.set(state => ({ ...state, draft: text }))) }
  const record = (kind, ownerId, threadId) => {
    const read = hostId => {
      try {
        const blob = JSON.parse(storage.get(composerDraftKey(hostId)) ?? 'null')
        return blob?.sessions?.[`${kind}:${ownerId}${threadId ? `:thread:${threadId}` : ''}`] ?? null
      } catch { return null }
    }
    return { of: read, a: read(HOST_A), b: read(HOST_B) }
  }
  try {
    await work({ storage, localStorage, roster, input, notes, inserts, statuses, render, open, type, record, settle, wait, flushed, unmount, composer: () => input.getSnapshot().draft, status: () => notes[notes.length - 1] ?? '' })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

test('composer drafts: the namespace comes from the Host and nothing is touched before it answers', async () => {
  const api = controlledApi({ hang: [0] })
  await withHost(async host => {
    await host.render()
    // The read is in flight: no store exists, so no read, no write, no restore.
    assert.deepEqual(api.calls.map(call => call.payload), [{}])
    assert.equal(host.storage.size, 0)
    assert.equal(host.composer(), '')
    assert.equal(host.status(), '')
  }, { api })
})

test('composer drafts: a validated Host namespace switches the drafts on', async () => {
  const api = controlledApi()
  await withHost(async host => {
    await host.render()
    await host.render()
    assert.equal(host.record('bot', 'bot-a').a, null)
    await host.type('宿主命名空间里的一段')
    await host.flushed()
    assert.equal(host.record('bot', 'bot-a').a.text, '宿主命名空间里的一段')
    // Only the Host's own namespace key was ever written.
    assert.deepEqual([...host.storage.keys()], [composerDraftKey(HOST_A)])
  }, { api })
})

test('composer drafts: a Host replacement retires the old store and a late answer cannot overwrite the new Host', async () => {
  const api = controlledApi({ hostIds: [HOST_A, HOST_B] })
  await withHost(async host => {
    await host.render()
    await host.type('第一个宿主的一段')
    await host.flushed()
    assert.equal(host.record('bot', 'bot-a').a.text, '第一个宿主的一段')
    // The Host is replaced: the same window now serves Host B.
    await host.render({ productApi: controlledApi({ hostIds: [HOST_B] }) })
    assert.equal(host.record('bot', 'bot-a').b, null)
    await host.type('第二个宿主的一段')
    await host.flushed()
    // Both survive in the one same-origin storage, under their own keys.
    assert.equal(host.record('bot', 'bot-a').a.text, '第一个宿主的一段')
    assert.equal(host.record('bot', 'bot-a').b.text, '第二个宿主的一段')
    // Back to the first Host: its own drafts are what it reads, not B's.
    await host.render({ productApi: controlledApi({ hostIds: [HOST_A] }) })
    await host.open('bot-b')
    assert.equal(host.composer(), '')
    await host.open('bot-a')
    await host.flushed()
    assert.equal(host.composer(), '第一个宿主的一段')
    assert.equal(host.record('bot', 'bot-a').b.text, '第二个宿主的一段', 'the other Host kept its own draft')
  }, { api })
})

test('composer drafts: a read that fails or is aborted leaves the drafts off and says so', async () => {
  const failing = controlledApi({ fail: new Set([0]) })
  await withHost(async host => {
    await host.render({ productApi: failing })
    assert.equal(host.storage.size, 0)
    assert.equal(host.composer(), '')
  }, { api: failing })
  // An answer the Host never gives (the read hangs) is not an identity either.
  const hanging = controlledApi({ hang: [0] })
  await withHost(async host => {
    await host.render({ productApi: hanging })
    assert.equal(host.storage.size, 0)
    await host.unmount()
    assert.equal(hanging.calls[0].aborted, true, 'the unmounted read was aborted')
    assert.equal(host.storage.size, 0)
  }, { api: hanging })
})

test('composer drafts: a namespace the Host answers wrongly is refused, not guessed', () => {
  assert.throws(() => validateNamespace({ schemaVersion: 1, hostId: 'nope' }), /格式无效/)
  assert.throws(() => validateNamespace({ schemaVersion: 2, hostId: HOST_A }), /版本不被/)
  assert.throws(() => validateNamespace(undefined), /没有返回/)
  assert.throws(() => validateNamespace({ schemaVersion: 1 }), /格式无效/)
  assert.equal(validateNamespace({ schemaVersion: 1, hostId: HOST_B }), HOST_B)
})

test('composer drafts: a hanging namespace times out, rejects its late answer and can be retried', async () => {
  let finish
  const api = { dispatch: () => new Promise(resolve => { finish = resolve }) }
  await withHost(async host => {
    await host.render({ namespaceTimeoutMs: 15 })
    await host.settle(async () => {})
    await act(async () => { await new Promise(done => setTimeout(done, 30)) })
    assert.equal(host.statuses.at(-1).status, 'error')
    assert.equal(host.storage.size, 0)
    await host.settle(() => finish({ schemaVersion: 1, hostId: HOST_A }))
    assert.equal(host.statuses.at(-1).status, 'error', 'a late response cannot install a store after timeout')
    const retry = [...document.querySelectorAll('button')].find(button => button.textContent === '重试草稿恢复')
    assert.ok(retry)
    await host.settle(() => retry.click())
    await host.settle(() => finish({ schemaVersion: 1, hostId: HOST_A }))
    assert.equal(host.statuses.at(-1).status, 'ready')
  }, { api })
})

test('composer drafts: the first render of a replacement Host cannot expose the previous store', async () => {
  const first = controlledApi(), second = controlledApi({ hang: [0] }), reads = []
  await withHost(async host => {
    const children = face => { reads.push(face); return null }
    await host.render({ productApi: first, children })
    assert.ok(reads.at(-1).store)
    const at = reads.length
    await host.render({ productApi: second, children })
    assert.equal(reads[at].store, undefined)
    assert.equal(reads[at].hostId, '')
    assert.equal(reads[at].status, 'pending')
  }, { api: first })
})

test('composer drafts: the slot wrapper keeps the original component and its props', async () => {
  const api = controlledApi()
  const original = props => {
    original.props = props
    return null
  }
  const Wrapped = withComposerDraft(original, { productApi: api })
  assert.equal(Wrapped.composerDraftOriginal, original)
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://slot.fixture/' })
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => {
      root.render(React.createElement(Wrapped, { sessionId: 'bot-a', useInput: state => state?.draft ?? '' }))
      await wait()
    })
    // The Host's own component still receives exactly the props it registered with.
    assert.equal(original.props.sessionId, 'bot-a')
    assert.equal(typeof original.props.useInput, 'function')
    assert.equal(original.props.productApi, undefined, 'the draft dependencies never leak into the original')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
  }
})
