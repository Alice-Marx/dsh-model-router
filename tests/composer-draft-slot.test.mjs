import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'

// The wiring mounts the draft beside the vendor's own composer extra in the
// Host's `conversation.input.left` slot, so both must survive the same props and
// the same mount. This test goes through the real wiring contract — the
// `withComposerDraft` wrapper the patch installs — against a Host slot surface
// that behaves like the one the vendor registers into, instead of a hand-written
// fragment that only looks wired.
//
// The vendored composer is read as text and bundled here, the same way the
// browser verification reads the vendored stylesheets: no new importer of the
// pinned vendor tree appears in this repository.

const root = resolve(import.meta.dirname, '..')
const scratch = resolve(root, 'tmp/integration/chat-drafts')
await mkdir(scratch, { recursive: true })
const directory = await mkdtemp(join(scratch, 'vendor-slot-'))
// The shell's primitives module is stubbed: this render never shows the shell's
// own components, and its dependency tree is not installed.
const stub = resolve(directory, 'ui-primitives-stub.mjs')
await writeFile(stub, 'export default {}\n')
const vendored = await build({
  absWorkingDir: root,
  stdin: {
    contents: await readFile(resolve(root, 'modules/bot-runtime/vendor/ds-bot/src/client/composer.js'), 'utf8'),
    resolveDir: resolve(root, 'modules/bot-runtime/vendor/ds-bot/src/client'), loader: 'js', sourcefile: 'composer.js',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: resolve(directory, 'vendor-composer.mjs'),
  external: ['react', 'react-dom', 'react-dom/*'], alias: { '@deepseek-ai/dsh-client-ui-primitives': stub }, logLevel: 'silent',
})
assert.equal(vendored.errors.length, 0, 'the vendored composer bundles against the installed React')
const { ComposerPlus } = await import(pathToFileURL(resolve(directory, 'vendor-composer.mjs')).href)
const load = async (entry, name) => {
  const built = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' }, logLevel: 'silent' })
  await writeFile(join(directory, name), built.outputFiles[0].contents)
  return import(pathToFileURL(join(directory, name)).href)
}
const { withComposerDraft } = await load('apps/integration-client/composer-draft-host.jsx', 'composer-draft-host.mjs')
const { createProductSlots } = await load('apps/integration-client/product-slots.jsx', 'product-slots.mjs')

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

const wait = () => new Promise(done => setTimeout(done, 20))

test('composer drafts: the wrapper the wiring installs keeps the slot component and shares its props', async () => {
  const dom = new JSDOM('<!doctype html><html><body data-bot-product-ui="1"><div id="root"></div></body></html>', { url: 'http://dsh.fixture/app', pretendToBeVisual: true })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  // One same-origin storage, and one Host that answers with its own namespace.
  const storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const roster = source({ byId: { 'bot-a': { id: 'bot-a', name: '研究伙伴' }, 'bot-b': { id: 'bot-b', name: '写手' } }, roomsById: {} })
  const input = source({ draft: '', phase: 'plain', attachmentIds: [], queue: [] })
  const session = source({ pendingSubmissions: [], promptError: null }), events = source({ entries: [] }), inbox = source(undefined)
  session.projections = { faceOf: () => inbox }
  const inserts = []
  const notes = []
  const actions = {
    captureInsertion: () => ({ caret: input.getSnapshot().draft.length }),
    insertText: text => { inserts.push(text); input.set(state => ({ ...state, draft: `${state.draft}${text}` })); return true },
  }
  const productApi = { dispatch: async action => (action === 'ui.namespace' ? { schemaVersion: 1, hostId: 'host-0123456789abcdef' } : Promise.reject(new Error(action))) }
  // The Host's slot registry: it keeps whatever the plugin registered and hands
  // the slot's props to it later, exactly as the real one does.
  const registered = []
  const slots = { register: (options, component) => { registered.push({ options, component }); return () => {} } }
  const productSlots = createProductSlots(slots, () => {}, productApi, () => null,
    { sessionBindingOf: id => id === 'bot-a' ? { session, eventSource: events } : undefined })
  productSlots.register({ name: 'conversation.input.left', id: 'bot-plus', order: -100, inject: () => ({}) }, ComposerPlus)
  assert.equal(registered[0].component.composerDraftOriginal, ComposerPlus, 'the original component keeps its identity')
  assert.equal(registered.length, 1)
  const view = { sessionId: 'bot-a' }
  const element = () => React.createElement(registered[0].component, {
    sessionId: view.sessionId, useRoster: roster.use, useInput: input.use, inputActions: actions,
    actions: { canReferenceChat: () => false, steerQueued: async () => 'done', openVoice: () => {} },
  })
  const settle = async job => { await act(async () => { job?.(); await wait() }) }
  try {
    await settle(() => root.render(element()))
    // The vendor's own composer extra still renders, with the props it registered with.
    assert.equal(document.querySelector('.bt-plus') !== null, true, 'the vendor composer extra renders')
    assert.equal(document.querySelector('[role=menu]'), null, 'the vendor menu stays closed')
    await settle(() => input.set({ draft: '同一插槽里的一段草稿' }))
    // The store debounces its write; the slot waits for it like a real window.
    await act(async () => { await new Promise(done => setTimeout(done, 600)) })
    // Leaving the conversation empties the Host composer, as it does.
    view.sessionId = 'bot-b'
    await settle(() => { input.set({ draft: '', phase: 'plain' }); root.render(element()) })
    await settle()
    assert.equal(inserts.length, 0, 'nothing was restored yet')
    // Coming back: the same conversation, the slot still mounted beside the extra.
    view.sessionId = 'bot-a'
    await settle(() => root.render(element()))
    assert.equal(input.getSnapshot().draft, '同一插槽里的一段草稿', 'the draft is restored beside the vendor extra')
    assert.equal(document.querySelector('.bt-plus') !== null, true, 'the vendor composer extra still renders after a restore')
    const record = () => Object.values(JSON.parse([...storage.values()][0]).sessions)[0]
    // The exact adapter installed by createProductSlots reads the public live
    // binding. The echo may retire before React next renders the empty input.
    await settle(() => {
      session.set({ pendingSubmissions: [{ requestId: 'sent-1', text: input.getSnapshot().draft, time: Date.now() }] })
      input.set({ draft: '', phase: 'plain' })
      events.set({ entries: [{ type: 'event', event: { type: 'user/message', data: { source: { kind: 'user', rpcId: 'sent-1' } } } }] })
      session.set({ pendingSubmissions: [] })
    })
    await act(async () => { await new Promise(done => setTimeout(done, 550)) })
    assert.equal(record(), undefined, 'durable acceptance clears the draft through the production slot')
    await settle(() => input.set({ draft: '再次发送的相同内容' }))
    await settle(() => {
      session.set({ pendingSubmissions: [{ requestId: 'sent-2', text: '再次发送的相同内容', time: Date.now() }] })
      input.set({ draft: '', phase: 'plain' })
      session.set({ pendingSubmissions: [], promptError: { op: 'send', error: { code: 'offline' } } })
    })
    await act(async () => { await new Promise(done => setTimeout(done, 550)) })
    assert.equal(record().pendingRequestId, 'sent-2')
    assert.ok(document.body.textContent.includes('发送结果待确认'))
    await settle(() => [...document.querySelectorAll('button')].find(button => button.textContent === '清除草稿').click())
    await settle(() => input.set({ draft: '运行期间手动删掉', phase: 'claimed' }))
    await settle(() => input.set({ draft: '', phase: 'claimed' }))
    await settle()
    await act(async () => { await new Promise(done => setTimeout(done, 550)) })
    assert.equal(record(), undefined, 'an old running phase and old echoes cannot turn manual deletion into a new send')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
