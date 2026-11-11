import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { composerDraftKey, createComposerDraftStore } from '../apps/integration-client/composer-draft.mjs'

// The Host's own composer state, as a composer slot receives it: one input
// source (`useInput`) and one insertion face (`inputActions`). The shapes are the
// ones the vendored DS Bot composer already reads — see vendor/ds-bot/src/client/
// enter-steer.js:8 (phase, draft, attachmentIds, queue) and enter-key.js:18
// (captureInsertion, insertText). Nothing here talks to a real Host, a model or a
// network; it is a stand-in with the same contract.
const HOST = 'host-0123456789abcdef'
const BOTS = { 'bot-a': { id: 'bot-a', name: '研究伙伴' }, 'bot-b': { id: 'bot-b', name: '写手' } }
const ROOMS = { 'room-x': { id: 'room-x', name: '研究小组' } }

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

const parent = resolve('tmp/integration/chat-drafts')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'session-')), output = join(directory, 'composer-draft-session.mjs')
const bundle = await build({
  entryPoints: ['apps/integration-client/composer-draft-session.jsx'], bundle: true, platform: 'node', format: 'esm',
  external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' }, logLevel: 'silent',
})
await (await import('node:fs/promises')).writeFile(output, bundle.outputFiles[0].contents)
const { ComposerDraft } = await import(pathToFileURL(output))

const wait = () => new Promise(done => setTimeout(done, 5))

/** One window: a Host composer, a roster, a session face, and the mounted conversation. */
async function withHost(work) {
  const dom = new JSDOM('<!doctype html><html><body data-bot-product-ui="1"><div id="root"></div></body></html>', { url: 'http://dsh.fixture/app', pretendToBeVisual: true })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const storage = new Map()
  const makeStore = () => createComposerDraftStore({
    storage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)) },
    hostId: HOST, schedule: run => run(),
  })
  const store = makeStore()
  const roster = source({ byId: BOTS, roomsById: ROOMS })
  const input = source({ draft: '', phase: 'plain', attachmentIds: [], queue: [] })
  const session = source({ pendingSubmissions: [], promptError: null })
  const notes = []
  const inserts = []
  let refuseInsert = false
  let witness = () => undefined
  let threads = {}
  const view = { sessionId: 'bot-a' }
  const actions = {
    captureInsertion: () => ({ caret: input.getSnapshot().draft.length }),
    insertText: (text) => {
      if (refuseInsert) return false
      inserts.push(text)
      input.set(state => ({ ...state, draft: `${state.draft}${text}` }))
      return true
    },
  }
  const settle = async job => { await act(async () => { job?.(); await wait() }) }
  // One store per window, as the wiring has; a test may swap it (a reload, or
  // another Host namespace) and the swap sticks for later renders.
  const current = { store }
  const mount = (props = {}) => {
    if (props.store) current.store = props.store
    return React.createElement(ComposerDraft, {
      store: current.store, sessionId: view.sessionId, useRoster: roster.use, useInput: input.use, useSubmissions: session.use,
      inputActions: actions, onNote: value => notes.push(value),
      witness: context => witness(context), threadOf: id => threads[id], ...props,
    })
  }
  const render = (props = {}) => settle(() => root.render(mount(props)))
  // The Host keeps one composer: leaving a conversation empties it. That is the
  // gap this slice fills, so the stand-in reproduces it.
  const open = async sessionId => {
    view.sessionId = sessionId
    await settle(() => { input.set({ draft: '', phase: 'plain' }); session.set({ pendingSubmissions: [], promptError: null }); root.render(mount()) })
    // A second tick lets a deferred attribution (a deletion this conversation can
    // be held to) land before a test reads the store.
    await settle()
  }
  const type = async text => { await settle(() => input.set(state => ({ ...state, draft: text }))) }
  // A Host that keeps its composer across a switch: the session changes, the text
  // stays. The draft must not claim text it never saw typed here.
  const carry = async sessionId => {
    view.sessionId = sessionId
    await settle(() => root.render(mount()))
  }
  // The Host takes the text: the composer empties, the phase goes busy, and the
  // session registers the echo of this exact submission.
  const send = async ({ text, requestId = 'rpc-1', phase = 'submitting', queue = [] } = {}) => {
    await settle(() => {
      const at = Date.now()
      input.set({ draft: '', phase, queue })
      session.set({ pendingSubmissions: [{ requestId, placement: 'transcript', time: at, text, attachments: [] }], promptError: null })
    })
  }
  const settleSend = async outcome => {
    await settle(() => {
      if (outcome === 'accepted') session.set({ pendingSubmissions: [], promptError: null })
      else session.set({ pendingSubmissions: [], promptError: { op: 'send', error: { code: 'offline' } } })
    })
  }
  const record = (kind, ownerId, threadId) => {
    try {
      const blob = JSON.parse(storage.get(composerDraftKey(HOST)) ?? 'null')
      const row = blob?.sessions?.[`${kind}:${ownerId}${threadId ? `:thread:${threadId}` : ''}`]
      return row ? { ...row } : null
    } catch { return null }
  }
  try {
    await work({
      store, storage, roster, input, session, notes, inserts, render, open, carry, type, send, settleSend, record, settle,
      composer: () => input.getSnapshot().draft,
      phase: () => input.getSnapshot().phase,
      setWitness: value => { witness = value },
      setThreads: value => { threads = value },
      refuseInsert: () => { refuseInsert = true },
      reopen: makeStore,
    })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

test('composer drafts: an unsent line survives a switch away, a return and a reload', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('把第三章的图换成柱状图')
    // Leaving the conversation empties the Host composer and takes nothing with it.
    await host.open('bot-b')
    assert.equal(host.composer(), '')
    assert.equal(host.record('bot', 'bot-b'), null)
    assert.equal(host.inserts.length, 0)
    // Coming back fills the composer, and only that conversation's.
    await host.open('bot-a')
    assert.equal(host.composer(), '把第三章的图换成柱状图')
    assert.deepEqual(host.inserts, ['把第三章的图换成柱状图'])
    assert.equal(host.notes.includes('restored'), true)
    // A reload is a new store over the same storage: the line is still there.
    await host.render({ store: host.reopen() })
    await host.open('room-x')
    assert.equal(host.composer(), '')
    await host.open('bot-a')
    assert.equal(host.composer(), '把第三章的图换成柱状图')
  })
})

test('composer drafts: a Bot and a group never share a draft', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('私聊里的内容')
    await host.open('room-x')
    await host.type('群里的内容')
    assert.equal(host.record('bot', 'bot-a').text, '私聊里的内容')
    assert.equal(host.record('room', 'room-x').text, '群里的内容')
    await host.open('bot-a')
    assert.equal(host.composer(), '私聊里的内容')
    await host.open('room-x')
    assert.equal(host.composer(), '群里的内容')
  })
})

test('composer drafts: two threads of one Bot never share a draft', async () => {
  await withHost(async host => {
    host.setThreads({ 'bot-a:t1': 't-1', 'bot-a:t2': 't-2' })
    host.roster.set(state => ({ ...state, byId: { ...state.byId, 'bot-a:t1': { id: 'bot-a' }, 'bot-a:t2': { id: 'bot-a' } } }))
    await host.render()
    await host.type('默认会话的一段')
    await host.open('bot-a:t1')
    await host.type('线程一的一段')
    await host.open('bot-a:t2')
    await host.type('线程二的一段')
    assert.equal(host.record('bot', 'bot-a').text, '默认会话的一段')
    assert.equal(host.record('bot', 'bot-a', 't-1').text, '线程一的一段')
    assert.equal(host.record('bot', 'bot-a', 't-2').text, '线程二的一段')
    // Each thread's own line comes back to its own composer.
    await host.open('bot-a:t1')
    assert.equal(host.composer(), '线程一的一段')
    await host.open('bot-a:t2')
    assert.equal(host.composer(), '线程二的一段')
    await host.open('bot-a')
    assert.equal(host.composer(), '默认会话的一段')
  })
})

test('composer drafts: a part rotation carries the line into the fresh part and sends nothing', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('换到新 part 也要留住')
    // The Bot's chat moves to a fresh part: the same conversation, a new session.
    await host.settle(() => host.roster.set(state => ({ ...state, byId: { ...state.byId, 'bot-a:p2': { id: 'bot-a' } } })))
    await host.open('bot-a:p2')
    assert.equal(host.composer(), '换到新 part 也要留住')
    assert.equal(host.record('bot', 'bot-a').sessionId, 'bot-a:p2')
    // Restoring fills the input; no submit, no turn, no model, no approval.
    assert.deepEqual(host.inserts, ['换到新 part 也要留住'])
  })
})

test('composer drafts: what the person already typed wins over a stored read', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('旧的一段')
    // A reload while the Host still holds the text: the stored read loses.
    await host.render({ store: host.reopen() })
    assert.equal(host.composer(), '旧的一段')
    assert.equal(host.inserts.length, 0)
    assert.equal(host.notes.includes('kept-typing'), true)
    await host.type('旧的一段，再加一句')
    assert.equal(host.record('bot', 'bot-a').text, '旧的一段，再加一句')
  })
})

test('composer drafts: an empty composer saves nothing and restores nothing', async () => {
  await withHost(async host => {
    await host.render()
    assert.equal(host.record('bot', 'bot-a'), null)
    assert.equal(host.composer(), '')
    assert.equal(host.inserts.length, 0)
    assert.equal(host.notes.includes('empty'), true)
    // Typing and deleting again by hand leaves nothing behind either.
    await host.type('一闪而过')
    await host.settle(() => input_set(host, ''))
    await host.settle()
    assert.equal(host.record('bot', 'bot-a'), null)
    await host.open('bot-b')
    assert.equal(host.composer(), '')
    assert.equal(host.record('bot', 'bot-b'), null)
  })
})

test('composer drafts: a confirmed send clears the draft and nothing comes back', async () => {
  await withHost(async host => {
    host.setWitness(context => (context.requestId === 'rpc-7' ? 'accepted' : undefined))
    await host.render()
    await host.type('这条发出去了')
    await host.send({ text: '这条发出去了', requestId: 'rpc-7' })
    assert.equal(host.record('bot', 'bot-a'), null)
    assert.equal(host.notes.includes('cleared'), true)
    await host.open('bot-b')
    await host.open('bot-a')
    assert.equal(host.composer(), '')
    assert.equal(host.inserts.length, 0)
  })
})

test('composer drafts: a send the Host reports failed keeps the draft', async () => {
  await withHost(async host => {
    host.setWitness(context => (context.requestId === 'rpc-8' ? 'failed' : undefined))
    await host.render()
    await host.type('这条没发出去')
    await host.send({ text: '这条没发出去', requestId: 'rpc-8' })
    assert.equal(host.record('bot', 'bot-a').text, '这条没发出去')
    // A failed send is settled: nothing stays pending, so a reload does not ask.
    assert.equal(host.record('bot', 'bot-a').pendingAt, 0)
    assert.equal(host.notes.includes('kept-failed'), true)
    // The Host put the text back: the composer holds it again, unsent.
    await host.type('这条没发出去')
    assert.equal(host.record('bot', 'bot-a').text, '这条没发出去')
    assert.equal(host.record('bot', 'bot-a').pendingAt, 0)
  })
})

test('composer drafts: an unobserved outcome keeps the draft, even after a reload', async () => {
  await withHost(async host => {
    // No witness at all: the Host took the text and never said what became of it.
    await host.render()
    await host.type('结果未知的一段')
    await host.send({ text: '结果未知的一段', requestId: 'rpc-9', phase: 'submitting' })
    assert.equal(host.record('bot', 'bot-a').text, '结果未知的一段')
    assert.equal(host.record('bot', 'bot-a').pendingAt > 0, true)
    assert.equal(host.notes.includes('kept-unknown'), true)
    // A reload asks again; still no answer, so the line is still there.
    await host.render({ store: host.reopen() })
    await host.open('bot-b')
    await host.open('bot-a')
    assert.equal(host.composer(), '', 'an unknown send is retained without automatically preparing a duplicate')
    assert.equal(host.record('bot', 'bot-a').pendingRequestId, 'rpc-9')
    const restore = [...document.querySelectorAll('button')].find(button => button.textContent === '恢复草稿')
    assert.ok(restore)
    await host.settle(() => restore.click())
    assert.equal(host.composer(), '结果未知的一段')
  })
})

test('composer drafts: an unknown outcome is settled the moment the durable message arrives', async () => {
  await withHost(async host => {
    let accepted = false
    host.setWitness(context => (context.requestId === 'rpc-10' && accepted ? 'accepted' : undefined))
    await host.render()
    await host.type('迟到收据的一段')
    await host.send({ text: '迟到收据的一段', requestId: 'rpc-10' })
    assert.equal(host.record('bot', 'bot-a').text, '迟到收据的一段')
    // The session publishes the durable user message for this identity.
    accepted = true
    await host.settleSend('accepted')
    await host.open('bot-b')
    await host.open('bot-a')
    assert.equal(host.composer(), '')
    assert.equal(host.record('bot', 'bot-a'), null)
  })
})

test('composer drafts: deleting what was typed leaves nothing to come back', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('手动删掉的一段')
    await host.settle(() => input_set(host, ''))
    // The deletion is attributed to this conversation on the next tick.
    await host.settle()
    assert.equal(host.record('bot', 'bot-a'), null)
    assert.equal(host.notes.includes('cleared'), true)
    await host.open('bot-b')
    await host.open('bot-a')
    assert.equal(host.composer(), '')
    assert.equal(host.inserts.length, 0)
  })
})

test('composer drafts: a new queue row marks a send in flight, so the draft is kept', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('排队发出的一段')
    // The Host took the text into the session queue: a new user-sourced row.
    await host.send({ text: '排队发出的一段', requestId: 'rpc-11', phase: 'plain', queue: [{ id: 'm1', source: { kind: 'user' } }] })
    assert.equal(host.record('bot', 'bot-a').text, '排队发出的一段')
    assert.equal(host.notes.includes('kept-unknown'), true)
  })
})

test('composer drafts: a refusal from the Host leaves the draft saved for the next mount', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('宿主这次不收')
    host.refuseInsert()
    await host.open('bot-b')
    await host.open('bot-a')
    assert.equal(host.composer(), '')
    assert.equal(host.inserts.length, 0)
    assert.equal(host.notes.includes('restore-refused'), true)
    assert.equal(host.record('bot', 'bot-a').text, '宿主这次不收')
  })
})

test('composer drafts: a Host without an insertion face touches nothing at all', async () => {
  await withHost(async host => {
    await host.render({ useInput: undefined, inputActions: undefined })
    await host.type('宿主没有输入面')
    // No read, no write, not even the conversation directory.
    assert.equal(host.record('bot', 'bot-a'), null)
    assert.equal(host.inserts.length, 0)
    assert.equal(host.notes.includes('no-input-face'), true)
    await host.open('bot-a')
    // The Host cleared its own composer on the switch; the draft added nothing.
    assert.equal(host.composer(), '')
    assert.equal(host.inserts.length, 0)
  })
})

test('composer drafts: a session the roster does not know has no draft', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('有归属的一段')
    await host.open('agent-session')
    assert.equal(host.composer(), '')
    assert.equal(host.record('bot', 'agent-session'), null)
    assert.equal(host.inserts.length, 0)
    await host.open('bot-a')
    assert.equal(host.composer(), '有归属的一段')
  })
})

test('composer drafts: another Host namespace cannot read this Host drafts', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('只属于这个宿主')
    const read = key => host.storage.get(key) ?? null
    const stranger = createComposerDraftStore({
      storage: { getItem: read, setItem: (key, value) => host.storage.set(key, String(value)) },
      hostId: 'host-fedcba9876543210', schedule: run => run(),
    })
    assert.equal(stranger.see({ kind: 'bot', ownerId: 'bot-a', sessionId: 'bot-a' }), true)
    assert.equal(stranger.read({ kind: 'bot', ownerId: 'bot-a' }), null)
    // The same window pointed at the other namespace restores nothing.
    await host.render({ store: stranger })
    assert.equal(host.inserts.length, 0)
    await host.open('bot-b')
    await host.open('bot-a')
    assert.equal(host.composer(), '')
    assert.equal(stranger.read({ kind: 'bot', ownerId: 'bot-a' }), null)
  })
})

test('composer drafts: an over-budget draft is refused and the previous one stays', async () => {
  await withHost(async host => {
    const small = createComposerDraftStore({
      storage: { getItem: key => host.storage.get(key) ?? null, setItem: (key, value) => host.storage.set(key, String(value)) },
      hostId: HOST, schedule: run => run(), limits: { maxTextChars: 6 },
    })
    await host.render({ store: small })
    await host.type('短的一句')
    await host.type('太长了的一段文字')
    assert.equal(host.record('bot', 'bot-a').text, '短的一句')
    assert.equal(host.notes.includes('refused:too-long'), true)
  })
})

test('composer drafts: another conversation text emptying does not drop ours', async () => {
  await withHost(async host => {
    await host.render()
    await host.type('我们的一段')
    // A Host that carries its composer across a switch: the text is not this
    // conversation's, so it is neither saved here nor dropped when it goes.
    await host.carry('bot-b')
    assert.equal(host.record('bot', 'bot-b'), null)
    await host.settle(() => input_set(host, ''))
    await host.settle()
    await host.settle(() => input_set(host, ''))
    assert.equal(host.record('bot', 'bot-a').text, '我们的一段', 'our draft survives a foreign empty')
    assert.equal(host.record('bot', 'bot-b'), null, 'and nothing was written for the other one')
    await host.open('bot-a')
    assert.equal(host.composer(), '我们的一段')
  })
})

/** The Host composer emptied, exactly as a person deleting their text does. */
const input_set = (host, text) => host.input.set(state => ({ ...state, draft: text, phase: 'plain' }))
