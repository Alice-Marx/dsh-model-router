// Offline verification for the per-Bot thread slice. It drives the real
// catalog, the real wiring adapter against a factory-fixture Host, and the real
// bundled panel, under tmp/integration/bot-threads — no user profile, no real
// Bot, no model, no desktop, no network.
//
// The Host double implements the same facade shapes the composition injects
// (lifecycle, authority probe, principal-directory ownership, the runtime's
// thread records) and runs in two modes:
//   patched   — the Host records thread Sessions and owns them, so a thread
//               becomes sendable;
//   current   — it does not (a Host without the thread records), so the service
//               must refuse the send with a precise reason.
// The real Host chain is proven in tests/bot-thread-host.native.mjs, which boots
// the patched vendored runtime; this script is the offline summary of the same
// contract.
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBotThreads } from '../packages/orchestration/src/bot-threads.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'tmp/integration/bot-threads/verify')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok, detail: detail ?? null }); if (!ok) process.exitCode = 1 }
const codeOf = async work => { try { await (typeof work === 'function' ? work() : work); return null } catch (error) { return error.code ?? error.message } }

function hostFixture({ patched }) {
  const bots = new Map([
    ['bot-a', { id: 'bot-a', name: '甲 Bot', model: 'deepseek/deepseek-chat', workDir: 'C:/fixture/a', sessionId: 'root-a' }],
    ['bot-b', { id: 'bot-b', name: '乙 Bot', model: 'deepseek/deepseek-reasoner', workDir: 'C:/fixture/b', sessionId: 'root-b' }],
  ])
  const grants = new Map([['bot-a', { tools: ['tool/model_router'], modelRoutes: [{ provider: 'deepseek', model: 'deepseek-chat' }] }], ['bot-b', { tools: [], modelRoutes: [] }]])
  const hostThreads = new Map()
  const sessions = new Map()
  let created = 0
  return {
    healthy: true,
    created: () => created,
    committedBot: botId => (bots.has(botId) ? structuredClone(bots.get(botId)) : null),
    lifecycleStatus: () => ({ healthy: true, closed: false, revision: 1 }),
    botAuthorized: botId => {
      const grant = grants.get(botId)
      if (!grant) return null
      return grant.tools.length > 0 || grant.modelRoutes.length > 0
    },
    ownsSession: (botId, sessionId) => patched && sessions.get(sessionId)?.botId === botId,
    inspectSession: sessionId => sessions.has(sessionId),
    committedThreads: botId => structuredClone(hostThreads.get(botId) ?? []),
    createSession: async ({ botId, threadId, title, dir }) => {
      created += 1
      const sessionId = `sess-${created}`
      if (patched) {
        sessions.set(sessionId, { botId, threadId, title, dir })
        const records = hostThreads.get(botId) ?? []
        if (!records.some(record => record.threadId === threadId)) records.push({ threadId, sessionId, createdAt: 1_700_000_000_000 })
        hostThreads.set(botId, records)
      }
      return sessionId
    },
    setThreadArchived: async ({ botId, threadId, archivedAt }) => {
      const records = hostThreads.get(botId) ?? []
      const record = records.find(entry => entry.threadId === threadId)
      if (record === undefined) return null
      if (archivedAt === undefined || archivedAt === null) delete record.archivedAt
      else record.archivedAt = archivedAt
      if (record.archivedAt !== undefined) sessions.delete(record.sessionId)
      else sessions.set(record.sessionId, { botId, threadId })
      return { ...record }
    },
  }
}

const open = (host, file) => createBotThreads({
  file,
  committedBot: host.committedBot,
  lifecycleStatus: host.lifecycleStatus,
  botAuthorized: host.botAuthorized,
  ownsSession: host.ownsSession,
  committedThreads: host.committedThreads,
  createSession: host.createSession,
  setThreadArchived: host.setThreadArchived,
  inspectSession: host.inspectSession,
  now: () => 1_700_000_000_000,
})

const dir = await mkdtemp(join(output, 'case-'))
const host = hostFixture({ patched: true })
const file = join(dir, 'bot-threads.json')
const threads = open(host, file)

// 1. The catalog: create, name, switch, archive — no Session, no model.
const first = threads.create({ botId: 'bot-a', name: '排查一', requestKey: 'verify-1' })
const replay = threads.create({ botId: 'bot-a', requestKey: 'verify-1' })
const second = threads.create({ botId: 'bot-a', name: '排查二' })
check('create is idempotent per requestKey', replay.created === false && replay.thread.threadId === first.thread.threadId)
check('create/switch touch no Session or model', host.created() === 0 && first.thread.sessionId === null && second.thread.sessionId === null)
threads.switchThread({ botId: 'bot-a', threadId: first.thread.threadId })
check('switch only moves the selection', threads.list('bot-a').activeThreadId === first.thread.threadId)
for (let round = 0; round < 200; round += 1) threads.switchThread({ botId: 'bot-a', threadId: second.thread.threadId })
check('rapid switching settles deterministically', threads.list('bot-a').activeThreadId === second.thread.threadId)
check('cross-Bot use is refused by name', await codeOf(() => threads.assertSendable({ botId: 'bot-b', threadId: first.thread.threadId })) === 'THREAD_FOREIGN_BOT')
check('a closed field set refuses a model, folder or credential', await codeOf(() => threads.create({ botId: 'bot-a', model: 'deepseek/evil' })) === 'INVALID_THREAD_REQUEST')

// 2. Opening a thread only navigates until the caller asks for the Session.
const navigated = threads.openThread({ botId: 'bot-a', threadId: second.thread.threadId })
check('openThread navigates without a Session', navigated.needsSession === true && navigated.sessionId === null && host.created() === 0)
const opened = await threads.openThread({ botId: 'bot-a', threadId: second.thread.threadId, create: true })
check('an explicit open returns the real Session id', typeof opened.sessionId === 'string' && opened.created === true && host.created() === 1)

// 3. Persistence across a restart, then archive/restore keeps the Session.
const archived = await threads.archive({ botId: 'bot-a', threadId: second.thread.threadId })
threads.close()
const reopened = open(host, file)
const restored = reopened.list('bot-a')
check('the catalog survives a restart', restored.threads.length === 2 && restored.threads.some(thread => thread.name === '排查一'))
check('archive hides without deleting', restored.threads.find(thread => thread.threadId === second.thread.threadId)?.state === 'archived')
check('the Host holds the archive too', host.committedThreads('bot-a').find(record => record.threadId === second.thread.threadId).archivedAt === archived.thread.archivedAt)
await reopened.unarchive({ botId: 'bot-a', threadId: second.thread.threadId })
check('archive is recoverable', reopened.resolve({ botId: 'bot-a', threadId: second.thread.threadId }).state === 'open')

// 4. The unpatched Host (a build without the thread records): the send is
// refused, never faked.
const currentDir = await mkdtemp(join(output, 'current-'))
const currentHost = hostFixture({ patched: false })
const current = open(currentHost, join(currentDir, 'bot-threads.json'))
const pending = current.create({ botId: 'bot-a', name: '等待归属' }).thread
check('an unowned Session is refused with the missing-hook reason', await codeOf(() => current.ensureSession({ botId: 'bot-a', threadId: pending.threadId })) === 'SESSION_NOT_OWNED')
check('the unowned Session is kept, never duplicated', currentHost.created() === 1 && current.resolve({ botId: 'bot-a', threadId: pending.threadId }).sessionState === 'unbound')
check('a send on an unowned Session is refused before any policy decision', await codeOf(() => current.assertSendable({ botId: 'bot-a', threadId: pending.threadId })) === 'SESSION_NOT_OWNED')
check('the read model reports the pending binding', current.readModel({ botId: 'bot-a' }).status === 'available')

// 5. The bundled panel renders the real component against a recording Host double.
const bundle = await (await import('esbuild')).build({
  absWorkingDir: root, entryPoints: ['apps/integration-client/bot-threads-panel.jsx'], bundle: true, write: false,
  platform: 'node', format: 'esm', external: ['react', 'react-dom'],
})
const bundleFile = join(dir, 'panel.mjs')
await writeFile(bundleFile, bundle.outputFiles[0].contents)
const { BotThreadsPanel, BotThreadHeaderAddon } = await import(pathToFileURL(bundleFile).href)
const React = (await import('react')).default
const { act } = await import('react')
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://threads.verify/', pretendToBeVisual: true })
const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }
const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
const dispatched = []
const rows = [
  { threadId: 't-1', botId: 'bot-a', name: '排查一', state: 'open', archivedAt: null, sessionId: 'sess-1', sessionState: 'owned', createdAt: 1, updatedAt: 2, active: true },
  { threadId: 't-2', botId: 'bot-a', name: '排查二', state: 'archived', archivedAt: 3, sessionId: 'sess-2', sessionState: 'unbound', createdAt: 1, updatedAt: 3, active: false },
]
const api = { dispatch: (action, payload) => { dispatched.push({ action, payload }); return action === 'threads.list' ? Promise.resolve({ botId: 'bot-a', activeThreadId: 't-1', threads: rows }) : Promise.resolve({ botId: 'bot-a', activeThreadId: 't-1', threads: rows }) } }
const { createRoot } = await import('react-dom/client')
const mount = createRoot(document.getElementById('root'))
await act(async () => { mount.render(React.createElement(BotThreadsPanel, { productApi: api, botId: 'bot-a', available: true })); await new Promise(setImmediate) })
check('the panel renders the store-verified rows', document.querySelectorAll('.bp-thread').length === 2 && document.querySelector('.bp-thread.is-active')?.getAttribute('data-thread') === 't-1')
check('the panel lists threads through one Host action', dispatched.some(entry => entry.action === 'threads.list'))
check('the panel says a Session is awaiting Host confirmation', [...document.querySelectorAll('.bp-thread-badge.is-wait')].length === 1)
check('the panel offers no execution control', [...document.querySelectorAll('button')].every(button => !/取消|停止|重试|审批|发送/.test(button.textContent)))
await act(async () => { mount.render(React.createElement(BotThreadHeaderAddon, { thread: rows[0], openCount: 1, archivedCount: 1, onOpen: () => {} })); await new Promise(setImmediate) })
check('the chat-title addon names the active thread', document.querySelector('.bp-threads-head-name')?.textContent === '排查一')
await act(async () => mount.unmount())
dom.window.close()
for (const [key, value] of Object.entries(previous)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }

// 6. The patched vendor sources carry the thread hooks the adapter needs.
const vendor = async path => await readFile(resolve(root, `modules/bot-runtime/vendor/ds-bot/${path}`), 'utf8')
const store = await vendor('src/host/store.js')
check('the vendored session index knows threads', ['threadOwners', 'threadsOf', 'threadOf', 'threadSessionOf', 'sessionsOfBot'].every(name => store.includes(name)))
const roster = await vendor('src/host/roster.js')
check('the vendored roster keeps its product seam and adds the thread records', roster.includes('updateBotProfile') && ['addThreadSession', 'renameThread', 'setThreadArchived'].every(name => roster.includes(name)))
const parts = await vendor('src/host/parts.js')
check('the part steward stays off threads', parts.includes('rt.threadOf(sessionId) === undefined ? { botId } : undefined'))
const channel = await vendor('src/host/channel.js')
check('the channel projects threads and refuses an archived one', channel.includes('threads:') && channel.includes('bot/archived'))
const sources = await vendor('src/client/sources.js')
check('the client roster indexes threads on their own', sources.includes('threadsById'))

const failed = checks.filter(entry => !entry.ok)
const report = { status: failed.length ? 'failed' : 'passed', checks, images: [], pageErrors: [], limitation: 'Isolated factory-fixture Host and bundled panel; the real Host chain runs in tests/bot-thread-host.native.mjs.' }
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
for (const entry of checks) console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`)
console.log(`\n${report.status}: ${checks.length - failed.length}/${checks.length} checks; report at tmp/integration/bot-threads/verify/report.json`)
if (failed.length) process.exitCode = 1
