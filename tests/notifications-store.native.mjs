import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { createBotNotifications } from '../packages/orchestration/src/bot-notifications.mjs'

const payload = botId => ({ backend: 'fixture', input: { task: `INPUT-SENTINEL-${botId}`, private: 'x' }, target: { location: 'local' } })

async function fixture(t) {
  const parent = resolve('tmp/integration/notifications/store'); await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'case-'))
  const jpath = join(dir, 'tasks.sqlite'), npath = join(dir, 'notifications.sqlite')
  const j = openTaskJournal(Database, jpath)
  t.after(() => j.close())
  return { dir, jpath, npath, j, f: j.claimRunner('runner', 60_000, 0) }
}
const scope = ids => ({ ids })
const store = (npath, j, holder, names = {}) => createBotNotifications({ Database, file: npath, journal: j, botIds: () => holder.ids, botNames: names, limit: 50 })

// Drive one task through a full lifecycle and return the settled view.
const succeed = (j, f, owner, key, now) => { const r = j.submit(f, owner, key, key, payload(owner), now + 1_000_000, now); j.claim(f, owner, r.taskId, now + 1); return j.finish(f, owner, r.taskId, r.attemptId, 'succeeded', { summary: { secret: 'RESULT-SENTINEL' } }, now + 2) }
const fail = (j, f, owner, key, now) => { const r = j.submit(f, owner, key, key, payload(owner), now + 1_000_000, now); j.claim(f, owner, r.taskId, now + 1); return j.finish(f, owner, r.taskId, r.attemptId, 'failed', { code: 'EXPECTED_FAILURE' }, now + 2) }
const reconcileTask = (j, f, owner, key, now) => { const r = j.submit(f, owner, key, key, payload(owner), now + 1_000_000, now); j.claim(f, owner, r.taskId, now + 1); j.finish(f, owner, r.taskId, r.attemptId, 'unknown', {}, now + 2); return r }

test('the feed is a read-only second projection: it never mutates task state and exposes no execution surface', async t => {
  const { j, f, npath } = await fixture(t)
  succeed(j, f, 'bot-a', 'k1', 1)
  const before = JSON.stringify(j.get('bot-a', j.list('bot-a')[0].taskId)), beforeEvents = JSON.stringify(j.events('bot-a', j.list('bot-a')[0].taskId))
  const s = store(npath, j, scope(['bot-a']))
  s.readModel(); s.list(); s.read(s.list().items[0].seq); s.markAll()
  const taskId = j.list('bot-a')[0].taskId
  assert.equal(JSON.stringify(j.get('bot-a', taskId)), before)
  assert.equal(JSON.stringify(j.events('bot-a', taskId)), beforeEvents)
  for (const forbidden of ['cancel', 'retry', 'reconcile', 'approve', 'submit', 'dispatch', 'stop']) assert.equal(typeof s[forbidden], 'undefined', `store must not expose ${forbidden}`)
  s.close()
})

test('notifications are derived from real journal events and never leak input, execution refs, raw detail or secrets', async t => {
  const { j, f, npath } = await fixture(t)
  succeed(j, f, 'bot-a', 'ok', 1)
  fail(j, f, 'bot-a', 'bad', 10)
  reconcileTask(j, f, 'bot-a', 'unk', 20)
  const s = store(npath, j, scope(['bot-a']), { 'bot-a': '小助手' })
  const feed = s.list()
  const text = JSON.stringify(feed)
  assert.equal(feed.items.length, 3)
  assert.doesNotMatch(text, /INPUT-SENTINEL|RESULT-SENTINEL|EXPECTED_FAILURE|executionRef|referenceHash|evidenceHash|operationId|"detail"/)
  // Every line is structured state + Bot name, never a model's own words.
  const byCat = Object.fromEntries(feed.items.map(i => [i.category, i]))
  assert.equal(byCat.succeeded.text, '小助手 的任务已完成')
  assert.equal(byCat.failed.text, '小助手 的任务失败')
  assert.equal(byCat.reconcile.text, '小助手 的执行需要核对收据：结果未知，不会自动重试')
  assert.doesNotMatch(byCat.reconcile.text, /已停止/)
  for (const item of feed.items) {
    assert.ok(Number.isSafeInteger(item.seq) && item.seq >= 1)
    assert.equal(item.botId, 'bot-a'); assert.equal(typeof item.taskId, 'string'); assert.equal(typeof item.attemptId, 'string')
  }
  s.close()
})

test('startup history is read while only later events are new and unread, and the boundary never moves on its own', async t => {
  const { j, f, npath } = await fixture(t)
  succeed(j, f, 'bot-a', 'old', 1)
  const s = store(npath, j, scope(['bot-a']))
  const first = s.readModel()
  assert.equal(first.unreadCount, 0, 'pre-existing events are history, not unread')
  assert.equal(first.baselineSeq, first.maxSeq)
  const old = s.list().items[0]
  assert.equal(old.read, true); assert.equal(old.isNew, false)
  succeed(j, f, 'bot-a', 'new', 100)
  const second = s.readModel()
  assert.equal(second.unreadCount, 1, 'a later event is new and unread')
  assert.equal(second.baselineSeq, first.baselineSeq, 'the baseline is fixed once')
  const fresh = s.list().items[0]
  assert.equal(fresh.read, false); assert.equal(fresh.isNew, true)
  s.close()
})

test('the same event never becomes two notifications and repeated reads are idempotent', async t => {
  const { j, f, npath } = await fixture(t)
  succeed(j, f, 'bot-a', 'k', 1)
  const s = store(npath, j, scope(['bot-a']))
  const seqs = () => s.list({ limit: 200 }).items.map(i => i.seq)
  const a = seqs(); const b = seqs()
  assert.deepEqual(a, b); assert.equal(new Set(a).size, a.length, 'no duplicate seq within a feed')
  s.read(a[0]); s.read(a[0])
  assert.deepEqual(seqs(), a, 'reading does not change the set of events')
  s.markAll(); s.markAll()
  assert.equal(s.readModel().unreadCount, 0)
  s.close()
})

test('keyset pagination walks every event once with no overlap or gap, and the incremental cursor only surfaces newer events', async t => {
  const { j, f, npath } = await fixture(t)
  for (let i = 0; i < 7; i++) succeed(j, f, 'bot-a', `k${i}`, i * 10 + 1)
  const s = store(npath, j, scope(['bot-a']))
  const seen = []; let before = null, pages = 0
  for (;;) {
    const page = s.list({ before, limit: 3 }); pages++
    seen.push(...page.items.map(i => i.seq))
    if (page.nextBefore === null) break
    assert.equal(page.items.length, 3); before = page.nextBefore
    if (pages > 20) assert.fail('pagination did not terminate')
  }
  assert.equal(seen.length, 7)
  assert.deepEqual(seen, [...seen].sort((x, y) => y - x), 'newest first, strictly descending')
  assert.equal(new Set(seen).size, 7, 'pages do not overlap')
  // Incremental: the highest seq already seen is the polling cursor.
  const top = seen[0]
  succeed(j, f, 'bot-a', 'later', 500)
  const model = s.readModel()
  assert.ok(model.maxSeq > top, 'maxSeq advances for a newer event')
  const newest = s.list({ limit: 3 }).items
  assert.ok(newest.some(i => i.seq > top), 'a newer event is now visible')
  s.close()
})

test('the feed spans the owner Bots and honours the live owner filter across delete and restore', async t => {
  const { j, f, npath } = await fixture(t)
  succeed(j, f, 'bot-a', 'a', 1)
  succeed(j, f, 'bot-b', 'b', 10)
  const holder = scope(['bot-a', 'bot-b'])
  const s = store(npath, j, holder)
  assert.deepEqual(s.list({ limit: 50 }).items.map(i => i.botId).sort(), ['bot-a', 'bot-b'], 'cross-Bot feed')
  holder.ids = ['bot-a']
  assert.deepEqual(s.list({ limit: 50 }).items.map(i => i.botId), ['bot-a'], 'a deleted Bot leaves the feed')
  assert.equal(s.readModel().unreadCount, 0)
  holder.ids = ['bot-a', 'bot-b']
  assert.deepEqual(s.list({ limit: 50 }).items.map(i => i.botId).sort(), ['bot-a', 'bot-b'], 'a restored Bot returns')
  s.close()
})

test('read state is per-item, all-at-once and scoped: unknown, future and foreign seqs are refused', async t => {
  const { j, f, npath } = await fixture(t)
  const s = store(npath, j, scope(['bot-a']))
  s.readModel() // arm the boot watermark before the events, so they arrive as new
  succeed(j, f, 'bot-a', 'a', 1)
  succeed(j, f, 'bot-a', 'b', 10)
  succeed(j, f, 'bot-a', 'c', 20)
  const [newest, middle, oldest] = s.list({ limit: 50 }).items.map(i => i.seq)
  s.read(middle)
  let model = s.readModel()
  assert.equal(model.unreadCount, 2, 'one read leaves the others unread')
  assert.equal(s.list({ limit: 50 }).items.find(i => i.seq === middle).read, true)
  assert.equal(s.list({ limit: 50 }).items.find(i => i.seq === newest).read, false)
  // Refusals: not a real event, and a seq belonging to a Bot that is not the owner's.
  assert.throws(() => s.read(999999), /NOTIFICATION_NOT_FOUND/)
  assert.throws(() => s.read(0), /INVALID_NOTIFICATION_SEQ/)
  succeed(j, f, 'stranger', 'x', 30)
  const strangerSeq = j.notificationEvents(['stranger'], s.kinds, {}).items[0].seq
  assert.throws(() => s.read(strangerSeq), /NOTIFICATION_NOT_FOUND/, 'a foreign Bot event cannot be marked read through this owner')
  s.markAll()
  model = s.readModel()
  assert.equal(model.unreadCount, 0, 'mark-all clears every unread')
  assert.equal(model.cursorSeq, model.maxSeq)
  s.close()
})

test('read state and the history boundary survive a cold restart of both journal and store', async t => {
  const { jpath, npath, j, f } = await fixture(t)
  succeed(j, f, 'bot-a', 'a', 1)
  const s1 = store(npath, j, scope(['bot-a']))
  const baseline = s1.readModel().baselineSeq
  succeed(j, f, 'bot-a', 'b', 10)
  s1.read(s1.list({ limit: 50 }).items[0].seq)
  const before = s1.readModel()
  s1.close(); j.close()
  const j2 = openTaskJournal(Database, jpath); t.after(() => j2.close())
  const s2 = store(npath, j2, scope(['bot-a']))
  const after = s2.readModel()
  assert.equal(after.baselineSeq, baseline, 'the history boundary is durable')
  assert.equal(after.cursorSeq, before.cursorSeq, 'the read watermark is durable')
  assert.equal(after.unreadCount, before.unreadCount)
  succeed(j2, j2.claimRunner('runner', 60_000, 100_000), 'bot-a', 'c', 100_000)
  assert.equal(s2.readModel().unreadCount, before.unreadCount + 1, 'the reopened feed keeps counting new events')
  s2.close()
})

test('empty owners and invalid arguments degrade to an empty, available feed', async t => {
  const { j, f, npath } = await fixture(t)
  succeed(j, f, 'bot-a', 'a', 1)
  const s = store(npath, j, scope([]))
  const model = s.readModel()
  assert.equal(model.status, 'available'); assert.equal(model.unreadCount, 0); assert.equal(model.maxSeq, 0)
  assert.deepEqual(s.list().items, [])
  assert.throws(() => createBotNotifications({ Database, file: npath, journal: {}, botIds: () => [] }), /BOT_NOTIFICATIONS_JOURNAL_REQUIRED/)
  s.close()
})
