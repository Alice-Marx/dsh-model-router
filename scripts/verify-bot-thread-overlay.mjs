// Verifies the thread overlay is coherent without touching the vendor tree:
// every recorded patch applies to its recorded upstream base and reproduces the
// vendored file, the product's own seams survive, and the thread hooks the
// adapter needs are present. The byte-level gate against the pinned upstream is
// `node scripts/sync-ds-bot.mjs --check --source ../DS-Bot-upstream
// --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a`.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { applyPatchText } from './sync-ds-bot.mjs'

const root = resolve(import.meta.dirname, '..')
const overlay = join(root, 'modules/bot-runtime/product-overlay')
const vendor = join(root, 'modules/bot-runtime/vendor/ds-bot')
const COMMIT = '71d344bf193f3f18185f25de3d8e5c483046910a'
const lines = text => text.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))

const manifest = JSON.parse(await readFile(join(overlay, 'OVERLAY.json'), 'utf8'))
const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok, detail: detail ?? null }); if (!ok) process.exitCode = 1 }

// The files the thread slice owns, and what each must still contain.
const owned = {
  'src/host/store.js': ['threadOwners', 'threadsOf', 'threadOf', 'threadSessionOf', 'sessionsOfBot', 'chatOwners.set(thread.sessionId, bot.id)'],
  'src/host/roster.js': ['updateBotProfile', 'addThreadSession', 'renameThread', 'setThreadArchived', 'BOT_THREAD_SESSION_TAKEN'],
  'src/host/parts.js': ['rt.threadOf(sessionId) === undefined ? { botId } : undefined'],
  'src/host/models.js': ['rt.threadsOf(bot.id).map(thread => thread.sessionId)'],
  'src/host/usage.js': ['rt.sessionsOfBot(bot.id)'],
  'src/host/privacy.js': ['rt.sessionsOfBot(bot.id)'],
  'src/host/memory.js': ['rt.sessionsOfBot(botId)'],
  'src/host/channel.js': ['threads:', 'bot/archived'],
  'src/client/sources.js': ['threadsById', 'isOwnChatOf', 'byId[thread.sessionId] = bot'],
  'src/client/index.js': ['snapshot.threadsById?.[id]', 'snapshot.threadsById?.[main]'],
  'src/client/header.js': ['conversationAddon', 'threadsById?.[sessionId]', 'threadName'],
  'src/client/details-drawer.js': ['DesktopPane', 'threadsById?.[sessionId]', 'threadName'],
  'src/client/model-menu.js': ['isOwnChatOf'],
  'src/client/learning-card.js': ['isOwnChatOf'],
  'src/client/secret-card.js': ['isOwnChatOf'],
  'src/client/turn-error.js': ['isOwnChatOf'],
}

for (const [path, needles] of Object.entries(owned)) {
  const entry = manifest.entries.find(row => row.path === path)
  check(`${path} is a recorded overlay entry`, entry?.kind === 'patched' && entry.base?.commit === COMMIT)
  if (!entry) continue
  const base = await readFile(join(overlay, 'base', ...path.split('/')), 'utf8')
  const patch = await readFile(join(overlay, 'patches', `${path}.patch`), 'utf8')
  const applied = applyPatchText(base, patch)
  check(`${path} patch applies to its recorded base`, applied.ok === true)
  if (!applied.ok) continue
  const vendored = await readFile(join(vendor, ...path.split('/')), 'utf8')
  check(`${path} patch reproduces the vendored file`, lines(applied.text).join('\n') === lines(vendored).join('\n'))
  for (const needle of needles) check(`${path} still carries ${needle.slice(0, 44)}`, applied.text.includes(needle))
}

// The parent's own product seam is preserved, not replaced.
const roster = await readFile(join(vendor, 'src/host/roster.js'), 'utf8')
check('the roster keeps the parent profile commit seam', roster.includes('async function updateBotProfile'))
const addThread = roster.slice(roster.indexOf('async function addThreadSession'), roster.indexOf('async function renameThread'))
check('the roster records a thread Session in committed state in one save', addThread.includes('(bot.threads ??= []).push(record)') && addThread.includes('await rt.save()'))
check('the roster refuses a Session another thread already holds', addThread.includes('BOT_THREAD_SESSION_TAKEN'))
check('the roster applies the Bot model and preset to the thread Session', addThread.includes('rt.selectSessionModel') && addThread.includes('rt.applyPermission'))
// The pinned runtime manifest agrees with the overlay's commit.
const source = JSON.parse(await readFile(join(root, 'modules/bot-runtime/SOURCE.json'), 'utf8'))
check('SOURCE.json records the pinned commit and every overlay row', source.commit === COMMIT && source.overlays.length === manifest.entries.length)

// The roster contract a thread depends on: a thread Session resolves to its Bot
// without ever taking a Bot's own chat identity, and partFor still prefers the
// thread itself. A thread that could redirect to the default chat, or that lost
// the Bot's model, memory, computer, voice and attachment controls, would pass
// the structural checks above and still be broken.
const sources = await readFile(join(vendor, 'src/client/sources.js'), 'utf8')
check('a thread Session resolves to its Bot in byId', sources.includes('byId[thread.sessionId] = bot'))
check('a thread never takes a Bot own chat identity', sources.includes('byId[thread.sessionId] === undefined'))
check('a thread is indexed by its thread id too', sources.includes('threadsById[thread.threadId]'))
const client = await readFile(join(vendor, 'src/client/index.js'), 'utf8')
const partFor = client.slice(client.indexOf('const partFor = (id) =>'), client.indexOf('const agentSessions ='))
check('partFor resolves the thread before the Bot', partFor.indexOf('threadsById?.[id]') < partFor.indexOf('byId[id]'))
for (const path of ['src/client/model-menu.js', 'src/client/learning-card.js', 'src/client/secret-card.js', 'src/client/turn-error.js']) {
  const text = await readFile(join(vendor, ...path.split('/')), 'utf8')
  check(`${path} keeps the Bot-scoped surface inside a thread`, text.includes('isOwnChatOf') && !/currentPart\(bot\) === sessionId/.test(text))
}

const failed = checks.filter(entry => !entry.ok)
const report = { status: failed.length ? 'failed' : 'passed', checks, limitation: 'Structural overlay verification; the byte-level gate is sync-ds-bot.mjs --check --source ../DS-Bot-upstream.' }
for (const entry of checks) console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}`)
console.log(`\n${report.status}: ${checks.length - failed.length}/${checks.length} checks`)
if (failed.length) process.exitCode = 1
