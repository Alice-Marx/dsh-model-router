// End-to-end verification of the notification centre against a real isolated
// SQLite journal. It drives genuine journal events and exercises the four owner
// actions through the product's actual owner gate and action whitelist.
// Run: node scripts/verify-notifications.mjs
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { createBotNotifications } from '../packages/orchestration/src/bot-notifications.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

const results = []
const check = (name, fn) => { try { fn(); results.push(['PASS', name]) } catch (error) { results.push(['FAIL', `${name} — ${error.message}`]) } }


const parent = resolve('tmp/integration/notifications/verify'); await mkdir(parent, { recursive: true })
const dir = await mkdtemp(join(parent, 'run-'))
const journal = openTaskJournal(Database, join(dir, 'tasks.sqlite'))
const runner = journal.claimRunner('verify-runner', 60_000, 0)
const notifications = createBotNotifications({
  Database, file: join(dir, 'notifications.sqlite'), journal,
  botIds: () => ['bot-a', 'bot-b'],
  botNames: () => ({ 'bot-a': '小助手', 'bot-b': '搭档' }),
})
notifications.readModel() // arm the boot watermark, as the parent does after the Bot directory loads

let readOnly
const model = createProductReadModel({ runtime: { readOnly: () => readOnly }, actions: {
  'notifications.readModel': () => notifications.readModel(),
  'notifications.list': p => notifications.list(p ?? {}),
  'notifications.read': p => notifications.read(p?.seq),
  'notifications.markAll': () => notifications.markAll(),
} })
const dispatch = (request, context) => model.dispatch(request, context)

const payload = botId => ({ backend: 'fixture', input: { task: `INPUT-SENTINEL-${botId}` }, target: { location: 'local' } })
const succeed = (owner, key, now) => { const r = journal.submit(runner, owner, key, key, payload(owner), now + 1_000_000, now); journal.claim(runner, owner, r.taskId, now + 1); return journal.finish(runner, owner, r.taskId, r.attemptId, 'succeeded', { summary: { secret: 'RESULT-SENTINEL' } }, now + 2) }
const unknown = (owner, key, now) => { const r = journal.submit(runner, owner, key, key, payload(owner), now + 1_000_000, now); journal.claim(runner, owner, r.taskId, now + 1); return journal.finish(runner, owner, r.taskId, r.attemptId, 'unknown', {}, now + 2) }

succeed('bot-a', 'a1', 1)
unknown('bot-b', 'b1', 10)

;(async () => {
  const owner = { kind: 'owner' }, bot = { kind: 'bot' }
  // Owner gate.
  await assert.rejects(dispatch({ action: 'notifications.readModel', payload: {} }, bot), { code: 'REMOTE_OWNER_REQUIRED' })
  await assert.rejects(dispatch({ action: 'notifications.fake', payload: {} }, owner), { code: 'INVALID_PRODUCT_ACTION' })
  readOnly = 'fixture read-only Host'
  await assert.rejects(dispatch({ action: 'notifications.markAll', payload: {} }, owner), { code: 'PRODUCT_READ_ONLY' })
  readOnly = undefined
  results.push(['PASS', 'actual product boundary refuses non-owner, unknown actions and read-only Host mutations'])

  const model = await dispatch({ action: 'notifications.readModel', payload: {} }, owner)
  assert.equal(model.unreadCount, 2)
  assert.equal(model.status, 'available')
  results.push(['PASS', `owner readModel reports unreadCount=${model.unreadCount} from real journal events`])

  const feed = await dispatch({ action: 'notifications.list', payload: { limit: 10 } }, owner)
  assert.equal(feed.items.length, 2)
  const serialized = JSON.stringify(feed)
  assert.doesNotMatch(serialized, /INPUT-SENTINEL|RESULT-SENTINEL|executionRef|referenceHash|evidenceHash|"detail"/)
  const reconcile = feed.items.find(i => i.category === 'reconcile')
  assert.ok(reconcile, 'an unknown-outcome finish surfaces as a reconcile row')
  assert.doesNotMatch(reconcile.text, /已停止/)
  results.push(['PASS', 'owner list is structured, private, and an unknown outcome reads as reconcile not stopped'])

  // Per-item read narrows the unread set; a foreign/unknown seq is refused.
  const target = feed.items[0].seq
  const afterRead = await dispatch({ action: 'notifications.read', payload: { seq: target } }, owner)
  assert.equal(afterRead.unreadCount, 1)
  await assert.rejects(dispatch({ action: 'notifications.read', payload: { seq: 9_999_999 } }, owner), { code: 'NOTIFICATION_NOT_FOUND' })
  results.push(['PASS', 'per-item read narrows unread and an unknown seq is refused'])

  const afterAll = await dispatch({ action: 'notifications.markAll', payload: {} }, owner)
  assert.equal(afterAll.unreadCount, 0)
  results.push(['PASS', 'mark-all clears the unread set'])

  // A newer event after mark-all is unread again (the watermark only moves on an explicit action).
  succeed('bot-a', 'a2', 100)
  const later = await dispatch({ action: 'notifications.readModel', payload: {} }, owner)
  assert.equal(later.unreadCount, 1)
  results.push(['PASS', 'a newer event after mark-all is unread again'])

  notifications.close(); journal.close()

  const failed = results.filter(([status]) => status === 'FAIL')
  for (const [status, name] of results) process.stdout.write(`${status === 'PASS' ? '✔' : '✖'} ${name}\n`)
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
  if (failed.length) process.exitCode = 1
})().catch(error => { process.stdout.write(`✖ verification crashed — ${error.stack}\n`); process.exitCode = 1 })
