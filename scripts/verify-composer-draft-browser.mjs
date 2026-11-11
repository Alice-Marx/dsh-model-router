// Real-browser verification of the per-conversation composer draft against a
// synthetic Host. What this proves and what it does not:
//
//   proves  the slice runs in Chromium at 375px in light and dark; the Host
//            namespace arrives over the product API and nothing is read, written
//            or restored before it does; an unsent line survives a switch away,
//            a return and a real page reload; a Chinese IME composition
//            round-trips; a send the Host confirms clears the draft, one it
//            reports failed keeps it, and one it never answers keeps it too;
//            deleting text by hand leaves nothing to come back; two Host
//            namespaces in one origin never see each other's drafts and a late
//            namespace answer is ignored; nothing fetches.
//   does not prove anything about the real desktop Host: the composer here is a
//            stand-in that publishes the same input contract the vendored DS Bot
//            composer already reads (useInput: phase/draft/attachmentIds/queue;
//            inputActions: captureInsertion/insertText), and the namespace read
//            goes through the same productApi.dispatch shape the Host answers
//            with. The real Host's own composer, its slot props and its
//            attachment rail are not exercised, and no model, session,
//            credential or user data is touched.
//
// Artifacts land in tmp/integration/chat-drafts by default, or in the directory
// given as the first argument.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { contrastRatio } from '../apps/integration-client/chat-design.mjs'

const root = resolve(import.meta.dirname, '..')
const scratch = resolve(root, 'tmp/integration/chat-drafts')

// A synthetic Host: one composer, a roster of Bots and one group, a session face
// that publishes the submission identity the real contract mints, a send the
// caller can pass or fail or leave unanswered, and two persisted Host namespaces
// over one origin. The imports sit on one line so this file's own import graph
// stays honest.
const FIXTURE = `import React, { useMemo, useRef, useState } from 'react'; import { createRoot } from 'react-dom/client'; import { ComposerDraftHost } from './apps/integration-client/composer-draft-host.jsx';
const CONVERSATIONS = [{ kind: 'bot', id: 'bot-a', name: '研究伙伴' }, { kind: 'bot', id: 'bot-b', name: '写手' }, { kind: 'room', id: 'room-x', name: '研究小组' }]
const rosterOf = ids => ({ byId: Object.fromEntries(CONVERSATIONS.filter(row => row.kind === 'bot' && ids.includes(row.id)).map(row => [row.id, row])), roomsById: Object.fromEntries(CONVERSATIONS.filter(row => row.kind === 'room' && ids.includes(row.id)).map(row => [row.id, row])) })
const source = initial => {
  let state = initial
  const listeners = new Set()
  const api = { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }, getSnapshot: () => state,
    set: patch => { state = typeof patch === 'function' ? patch(state) : { ...state, ...patch }; for (const listener of [...listeners]) listener() },
    use: select => React.useSyncExternalStore(api.subscribe, () => select(api.getSnapshot()), () => select(api.getSnapshot())) }
  return api
}
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('')
// Each Host keeps its own persisted namespace, so a reload stays the same Host.
const HOST_KEY = 'fixture:composer-draft-host:'
const hostOf = index => {
  const key = HOST_KEY + index
  const found = localStorage.getItem(key)
  if (found) return found
  const minted = 'host-' + hex()
  localStorage.setItem(key, minted)
  return minted
}
const HOSTS = [hostOf(0), hostOf(1)]

function Fixture() {
  const [at, setAt] = useState(0)
  const hostId = HOSTS[at]
  const [view, setView] = useState('bot-a')
  const [notes, setNotes] = useState([])
  const [sent, setSent] = useState([])
  const [outcome, setOutcome] = useState('unknown')
  const outcomeRef = useRef(outcome)
  outcomeRef.current = outcome
  const roster = useMemo(() => source(rosterOf(['bot-a', 'bot-b', 'room-x'])), [])
  const input = useMemo(() => source({ draft: '', phase: 'plain', attachmentIds: [], queue: [] }), [])
  const session = useMemo(() => source({ pendingSubmissions: [], promptError: null }), [])
  // The durable conversation: the only evidence that a send was accepted.
  const durable = useMemo(() => source({ entries: [] }), [])
  const inbox = useMemo(() => source(undefined), [])
  const binding = useMemo(() => { session.projections = { faceOf: () => inbox }; return { session, eventSource: durable } }, [session, durable, inbox])
  const sequence = useRef(0)
  // The Host's namespace read, over the product API. A Host replacement is
  // answered late on purpose, so the adapter has to ignore the stale answer.
  const late = useRef(location.hash === '#slow' ? 0 : -1)
  const productApi = useMemo(() => ({ dispatch: async (action, payload, signal) => {
    if (action !== 'ui.namespace') throw new Error('unexpected action ' + action)
    const mine = at
    if (late.current === mine) await new Promise(() => {})
    await new Promise(done => setTimeout(done, late.current === mine ? 0 : 60))
    if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { code: 'ABORTED' })
    return { schemaVersion: 1, hostId: HOSTS[mine] }
  } }), [at])
  const draft = input.use(state => state.draft)
  const note = value => setNotes(list => [...list, value])
  const row = CONVERSATIONS.find(entry => entry.id === view)
  // The Host's own insertion face, kept as one object for the component's mount.
  const inputActions = useMemo(() => ({
    captureInsertion: () => ({ caret: input.getSnapshot().draft.length }),
    insertText: text => { input.set(state => ({ ...state, draft: state.draft + text })); return true },
  }), [input])
  const send = () => {
    const text = input.getSnapshot().draft.trim()
    if (!text) return
    const requestId = 'rpc-' + (sequence.current += 1)
    // The Host registers the echo of this submission, then takes the text.
    session.set({ pendingSubmissions: [{ requestId, placement: 'transcript', time: Date.now(), text, attachments: [] }], promptError: null })
    input.set(state => ({ ...state, phase: 'submitting', draft: '' }))
    if (outcomeRef.current === 'failed') {
      // The Host reports the failure first, then gives the text back.
      setTimeout(() => { session.set({ pendingSubmissions: [], promptError: { op: 'send', error: { code: 'offline' } } }) }, 250)
      setTimeout(() => { input.set(state => ({ ...state, phase: 'plain', draft: text })) }, 600)
      return
    }
    if (outcomeRef.current === 'sent') {
      setTimeout(() => {
        session.set({ pendingSubmissions: [], promptError: null })
        durable.set({ entries: [...durable.getSnapshot().entries, { type: 'event', event: { type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } } }] })
        setSent(list => [...list, text])
      }, 250)
      return
    }
    // Unknown: the Host never says what became of it.
  }
  const api = {
    status: () => notes[notes.length - 1] ?? '',
    notes: () => notes.slice(),
    composer: () => input.getSnapshot().draft,
    record: () => (store === null ? '' : store.read({ kind: row.kind, ownerId: row.id })?.text ?? ''),
    host: () => hostId,
    hosts: () => HOSTS.slice(),
    open: id => { setView(id); input.set({ draft: '', phase: 'plain' }); session.set({ pendingSubmissions: [], promptError: null }) },
    sent: () => sent.slice(),
    outcome: value => setOutcome(value),
    switchHost: () => setAt(value => (value + 1) % HOSTS.length),
    lateHost: index => { late.current = index },
    type: text => input.set(state => ({ ...state, draft: text })),
    composing: (active, data) => {
      const box = document.querySelector('[data-composer-input]')
      if (box) { box.textContent = data ?? box.textContent; box.toggleAttribute('data-composing', active) }
      input.set(state => ({ ...state, draft: box?.textContent ?? '' }))
    },
  }
  let store = null
  React.useEffect(() => { window.__draft = api }, [notes.length, view, hostId, sent.length])
  React.useEffect(() => { document.body.setAttribute('data-bot-product-ui', '1') }, [])
  return <div className="fixture-shell">
    <aside className="fixture-sidebar"><div className="bt-side"><div className="bt-side-top"><span className="bt-brand">DSH Bot</span></div>
      <div className="bt-list" role="region" aria-label="Bot list">{CONVERSATIONS.map(entry => <button type="button" key={entry.id} className="bt-row" data-bot-id={entry.kind === 'bot' ? entry.id : undefined} data-room-id={entry.kind === 'room' ? entry.id : undefined} aria-current={entry.id === view ? 'page' : undefined} onClick={() => api.open(entry.id)}><span className="bt-row-body"><span className="bt-row-name">{entry.name}</span></span></button>)}</div>
    </div></aside>
    <main className="fixture-main"><div className="fixture-conversation">
      <header className="_header_fixture"><div className="bt-head"><span className="bt-pill"><span className="bt-pill-name">{row.name}</span></span>
        <span className="fixture-state" role="status">宿主 {at + 1}/2 · 上一动作：{api.status() || '无'}</span></div></header>
      <div className="_scroll_fixture"><div className="_column_fixture">
        <div className="bt-umsg"><div className="bt-ustack"><div className="bt-ubody">这是一条已有的用户消息。</div></div></div>
        {sent.map((text, index) => <div className="bt-umsg" key={index}><div className="bt-ustack"><div className="bt-ubody">{text}</div></div></div>)}
      </div></div>
      <div className="_root_fixture"><div data-composer-card>
        <div data-input-scroll><div data-composer-input role="textbox" contentEditable suppressContentEditableWarning className="fixture-input"
          onInput={event => input.set(state => ({ ...state, draft: event.currentTarget.textContent ?? '' }))}
          onCompositionStart={event => event.currentTarget.toggleAttribute('data-composing', true)}
          onCompositionEnd={event => { event.currentTarget.toggleAttribute('data-composing', false); input.set(state => ({ ...state, draft: event.currentTarget.textContent ?? '' })) }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send() } }} /></div>
        <div className="_trailing_fixture">
          <button type="button" className="fixture-button" data-testid="outcome-sent" aria-pressed={outcome === 'sent'} onClick={() => setOutcome('sent')}>发送成功</button>
          <button type="button" className="fixture-button" data-testid="outcome-failed" aria-pressed={outcome === 'failed'} onClick={() => setOutcome('failed')}>发送失败</button>
          <button type="button" className="fixture-button" data-testid="outcome-unknown" aria-pressed={outcome === 'unknown'} onClick={() => setOutcome('unknown')}>没有回音</button>
          <button type="button" className="_primary_fixture" data-testid="composer-send" disabled={!draft.trim()} onClick={send}>发</button>
          <button type="button" className="fixture-button" data-testid="switch-host" onClick={() => api.switchHost()}>切宿主</button>
        </div>
      </div></div>
      <ComposerDraftHost productApi={productApi} sessionId={view} sessionBinding={binding} useRoster={roster.use} useInput={input.use} inputActions={inputActions} onNote={note} onStore={value => { store = value }} />
    </div></main>
    <span className="fixture-note">本地验证 · 合成宿主 · 未发布改动</span>
  </div>
}
createRoot(document.getElementById('root')).render(<Fixture />)
`

/** The product's own conversation styles, so the 375px check means something. */
async function productCss() {
  return await readFile(resolve(root, 'apps/integration-client/chat.css'), 'utf8') + '\n' + await readFile(resolve(root, 'apps/integration-client/composer-draft.css'), 'utf8') + `
/* Fixture layout only; the actual draft widget uses the stylesheet above. */
*{box-sizing:border-box}html,body,#root{min-height:100%;margin:0}body{font:14px/1.5 system-ui,sans-serif;background:var(--bp-chat-canvas);color:var(--bp-chat-ink)}button{font:inherit}
.fixture-shell{max-width:900px;margin:0 auto;padding:16px;display:grid;gap:16px}.fixture-sidebar{border:1px solid var(--bp-chat-line);border-radius:14px;padding:12px;background:var(--bp-chat-sidebar)}.bt-list{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.bt-row{padding:8px 12px;background:var(--bp-chat-surface);color:var(--bp-chat-ink);border:1px solid var(--bp-chat-line);border-radius:10px}.bt-row[aria-current=page]{border-color:var(--bp-chat-accent)}.fixture-conversation{display:grid;gap:14px;min-width:0}.fixture-state{font-size:11px;color:var(--bp-chat-muted);display:block}.bt-ubody{padding:12px;border-radius:12px;background:var(--bp-chat-inset);color:var(--bp-chat-ink)}[data-composer-card]{padding:12px;background:var(--bp-chat-surface);border:1px solid var(--bp-chat-line);border-radius:16px}.fixture-input{min-height:82px;outline:none;white-space:pre-wrap;overflow-wrap:anywhere}.fixture-button,._primary_fixture{border:1px solid var(--bp-chat-line);border-radius:8px;min-height:36px;padding:6px;background:var(--bp-chat-inset);color:var(--bp-chat-ink)}._trailing_fixture{display:flex;gap:4px;flex-wrap:wrap}.fixture-note{display:block;margin:16px;font-size:11px;color:var(--bp-chat-muted)}
`
}

export async function serveDraftFixture() {
  await mkdir(scratch, { recursive: true })
  const bundle = await build({
    absWorkingDir: root, stdin: { contents: FIXTURE, resolveDir: root, loader: 'jsx', sourcefile: 'composer-draft-preview.jsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  const css = await productCss()
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>按会话保存输入草稿 · 本地离线预览</title><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
    if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset: utf-8' }); response.end(html) }
    else if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset: utf-8' }); response.end(bundle.outputFiles[0].contents) }
    else { response.writeHead(404); response.end() }
  })
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(yes => server.close(yes)) }
}

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); if (!ok) process.stdout.write(`[draft] FAIL ${name} ${detail}\n`) }

/** The page fails on any request, console error or page error it did not start. */
function watch(page, url, problems) {
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`) })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('request', request => { if (!request.url().startsWith(url) && !request.url().startsWith('data:')) problems.push(`request: ${request.url()}`) })
}

const DRAFT_TEXT = '把第三章的图换成柱状图，顺便核对一遍引用'
const settled = page => page.waitForFunction(() => window.__draft && window.__draft.record().length > 0)

async function run(theme, { slow = false } = {}) {
  const problems = []
  const { url, close } = await serveDraftFixture()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 375, height: 780 } })
  watch(page, url, problems)
  try {
    await page.goto(`${url}${slow ? '#slow' : ''}`)
    await page.waitForFunction(() => Boolean(window.__draft))
    await page.evaluate(value => document.body.setAttribute('data-bp-appearance', value), theme)
    if (slow) {
      // The namespace read never answers: nothing is read, written or restored.
      await page.click('[data-composer-input]')
      await page.keyboard.type(DRAFT_TEXT)
      await page.waitForTimeout(400)
      check(`${theme}: no draft before the Host namespace answers`, (await page.evaluate(() => window.__draft.record())) === '')
      check(`${theme}: nothing was written to storage`, (await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('composer-drafts')).length)) === 0)
      return
    }

    // Typing saves the draft; leaving the conversation takes nothing with it.
    await page.click('[data-composer-input]')
    await page.keyboard.type(DRAFT_TEXT)
    await settled(page)
    check(`${theme}: an unsent line is saved`, (await page.evaluate(() => window.__draft.record())) === DRAFT_TEXT)
    await page.evaluate(() => window.__draft.open('bot-b'))
    check(`${theme}: switching away empties the composer`, (await page.evaluate(() => window.__draft.composer())) === '')
    check(`${theme}: the other conversation has no draft`, (await page.evaluate(() => window.__draft.record())) === '')
    await page.evaluate(() => window.__draft.open('bot-a'))
    await page.waitForFunction(() => window.__draft.composer().length > 0)
    check(`${theme}: returning restores the line`, (await page.evaluate(() => window.__draft.composer())) === DRAFT_TEXT)

    // A real reload reads the same drafts back.
    await page.reload()
    await page.waitForFunction(() => Boolean(window.__draft))
    await page.evaluate(value => document.body.setAttribute('data-bp-appearance', value), theme)
    await page.waitForFunction(() => window.__draft.composer().length > 0)
    check(`${theme}: a reload restores the line`, (await page.evaluate(() => window.__draft.composer())) === DRAFT_TEXT)

    // A Chinese IME composition round-trips without corrupting the draft.
    await page.evaluate(() => window.__draft.open('bot-b'))
    await page.evaluate(() => window.__draft.type(''))
    await page.click('[data-composer-input]')
    await page.evaluate(() => window.__draft.composing(true, '明天'))
    await page.waitForFunction(() => window.__draft.record() === '明天')
    await page.evaluate(() => window.__draft.composing(false, '明天的报告'))
    await page.waitForFunction(() => window.__draft.record() === '明天的报告')
    check(`${theme}: an IME composition round-trips`, (await page.evaluate(() => window.__draft.record())) === '明天的报告')
    await page.evaluate(() => window.__draft.open('bot-a'))
    await page.waitForFunction(text => window.__draft.composer() === text, DRAFT_TEXT)
    check(`${theme}: the composing conversation keeps its own line`, (await page.evaluate(() => window.__draft.record())) === DRAFT_TEXT)

    // A send the Host reports failed gives the text back and keeps it.
    await page.click('[data-testid=outcome-failed]')
    await page.click('[data-testid=composer-send]')
    await page.waitForFunction(text => window.__draft.composer() === text, DRAFT_TEXT)
    check(`${theme}: a failed send keeps the draft`, (await page.evaluate(() => window.__draft.record())) === DRAFT_TEXT)
    // The Host gives the text back, so the composer holds it again.
    await page.waitForFunction(text => window.__draft.composer() === text, DRAFT_TEXT)
    check(`${theme}: a failed send gives the text back`, (await page.evaluate(() => window.__draft.record())) === DRAFT_TEXT)

    // A send the Host never answers keeps the draft too.
    await page.click('[data-testid=outcome-unknown]')
    await page.click('[data-testid=composer-send]')
    await page.waitForFunction(() => window.__draft.status() === 'kept-unknown')
    check(`${theme}: an unanswered send keeps the draft`, (await page.evaluate(() => window.__draft.record())) === DRAFT_TEXT)
    await page.waitForTimeout(500)
    check(`${theme}: time alone never clears a draft`, (await page.evaluate(() => window.__draft.record())) === DRAFT_TEXT)
    const recoveryBox = await page.getByRole('button', { name: '恢复草稿', exact: true }).boundingBox()
    check(`${theme}: unknown-send recovery stays reachable at 375px`, Boolean(recoveryBox) && recoveryBox.x >= 0 && recoveryBox.x + recoveryBox.width <= 376)
    const recoveryOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    check(`${theme}: the recovery notice has no sideways overflow`, recoveryOverflow)
    const recoveryColors = await page.getByRole('button', { name: '恢复草稿', exact: true }).evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }))
    check(`${theme}: recovery button text clears 4.5:1 contrast`, contrastRatio(recoveryColors.color, recoveryColors.background) >= 4.5)
    await page.screenshot({ path: resolve(scratch, `draft-recovery-${theme}.png`), fullPage: true })

    await page.evaluate(() => window.__draft.open('bot-b'))
    await page.evaluate(() => window.__draft.open('bot-a'))
    check(`${theme}: an unanswered send is not automatically prepared again`, (await page.evaluate(() => window.__draft.composer())) === '')
    await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
    await page.waitForFunction(text => window.__draft.composer() === text, DRAFT_TEXT)
    check(`${theme}: explicit recovery restores the unanswered text`, (await page.evaluate(() => window.__draft.composer())) === DRAFT_TEXT)
    // A send the Host confirms clears it through the public binding adapter.
    await settled(page)
    await page.click('[data-testid=outcome-sent]')
    await page.click('[data-testid=composer-send]')
    await page.waitForFunction(() => window.__draft.record() === '')
    check(`${theme}: a confirmed send clears the draft`, (await page.evaluate(() => window.__draft.sent()))[0] === DRAFT_TEXT)
    await page.evaluate(() => window.__draft.open('bot-b'))
    await page.evaluate(() => window.__draft.open('bot-a'))
    check(`${theme}: nothing comes back after the send`, (await page.evaluate(() => window.__draft.composer())) === '')

    // Deleting what was typed leaves nothing behind.
    await page.evaluate(() => window.__draft.type('手动删除的一段'))
    await page.waitForFunction(() => window.__draft.record() === '手动删除的一段')
    await page.evaluate(() => window.__draft.type(''))
    await page.waitForFunction(() => window.__draft.record() === '')
    await page.evaluate(() => window.__draft.open('bot-b'))
    await page.evaluate(() => window.__draft.open('bot-a'))
    check(`${theme}: a manual delete leaves no ghost`, (await page.evaluate(() => window.__draft.composer())) === '')

    // Two Host namespaces in one origin never see each other's drafts.
    const hosts = await page.evaluate(() => window.__draft.hosts())
    await page.evaluate(() => window.__draft.type('另一个宿主的一段'))
    await page.waitForFunction(() => window.__draft.record().length > 0)
    await page.evaluate(index => window.__draft.lateHost(index), 1)
    await page.click('[data-testid=switch-host]')
    // The replacement Host has not answered yet: its drafts stay switched off.
    await page.waitForTimeout(150)
    check(`${theme}: the replacement Host reads nothing before it answers`, (await page.evaluate(() => window.__draft.record())) === '')
    await page.waitForFunction(first => window.__draft.host() !== first, hosts[0])
    check(`${theme}: the other Host sees no draft`, (await page.evaluate(() => window.__draft.record())) === '')
    await page.click('[data-testid=switch-host]')
    await page.waitForFunction(first => window.__draft.host() === first, hosts[0])
    await page.waitForFunction(() => window.__draft.record().length > 0)
    check(`${theme}: the first Host still has its draft`, (await page.evaluate(() => window.__draft.record())) === '另一个宿主的一段')

    // 375px: nothing overflows sideways, and the composer stays reachable.
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
    check(`${theme}: no sideways overflow at 375px`, overflow.scroll <= overflow.width + 1, JSON.stringify(overflow))
    const box = await page.locator('[data-composer-input]').boundingBox()
    check(`${theme}: the composer is on screen at 375px`, Boolean(box) && box.width > 80 && box.x >= 0, JSON.stringify(box))
    check(`${theme}: no console or page error`, problems.length === 0, problems.join(' | '))
  } finally {
    await page.close()
    await browser.close()
    await close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = resolve(scratch, process.argv[2] ? `composer-draft-${process.argv[2]}.json` : 'composer-draft.json')
  await mkdir(scratch, { recursive: true })
  for (const theme of ['light', 'dark']) await run(theme)
  await run('light', { slow: true })
  await writeFile(artifact, `${JSON.stringify({ checkedAt: 'local synthetic Host', viewport: 375, checks }, null, 2)}\n`)
  const failed = checks.filter(entry => !entry.ok)
  process.stdout.write(`[draft] ${checks.length - failed.length}/${checks.length} checks passed → ${artifact}\n`)
  assert.deepEqual(failed, [], 'composer draft browser verification failed')
}
