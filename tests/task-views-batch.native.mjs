import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'

// A product list is a page, not N single reads. The per-task view used to cost
// about nine statements, so a 512-row list spent roughly 4,600 inside the same
// process that must renew its runner lease every few seconds. These tests pin
// both halves: the batched read is cheap, and it says exactly what the single
// read says.

assert.ok(process.env.DSH_TASK_DRIVER, 'Run through integration-task-probe.mjs with the verified native driver')
const {default: Database} = await import(process.env.DSH_TASK_DRIVER)
const parent = resolve('tmp/integration/task-native')
await mkdir(parent, {recursive: true})
const fresh = async () => join(await mkdtemp(join(parent, 'db-')), 'orchestration.sqlite')

/** Count statement preparations, which is one per query in better-sqlite3. */
function counted(db) {
  const stats = {prepare: 0, exec: 0}
  const proxy = new Proxy(db, {
    get(target, key) {
      const value = target[key]
      if (key === 'prepare') return (...args) => { stats.prepare++; return target.prepare(...args) }
      if (key === 'exec') return (...args) => { stats.exec++; return target.exec(...args) }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return {proxy, stats}
}

const payload = (backend = 'fixture') => ({backend, input: {text: 'fixture'}, target: {fixture: true}})

async function seeded(t, {tasks = 40, bots = 2} = {}) {
  const path = await fresh()
  const raw = new Database(path)
  t.after(() => { try { raw.close() } catch {} })
  const {proxy, stats} = counted(raw)
  const journal = openTaskJournal(Database, path, {database: proxy})
  t.after(() => journal.close())
  // A lease far in the future: these tests read, they never run.
  const fence = journal.claimRunner('runner-a', 60_000, 0)
  let clock = 1000
  const owners = []
  for (let bot = 0; bot < bots; bot++) owners.push(`bot-${bot}`)
  for (let i = 0; i < tasks; i++) {
    const owner = owners[i % bots]
    const task = journal.submit(fence, owner, `request-${i}`, `hash-${i}`, payload(), clock + 3_600_000, clock++)
    if (i % 4 === 0) {
      journal.claim(fence, owner, task.taskId, clock++)
      journal.finish(fence, owner, task.taskId, task.attemptId, 'failed', {code: 'FIXTURE_FAILED'}, clock++)
    } else if (i % 4 === 1) {
      journal.claim(fence, owner, task.taskId, clock++)
      // No finish: the attempt stays running, which is its own read path.
    }
  }
  return {journal, stats, owners, tasks}
}

test('task views/native: one page costs a bounded number of statements', async (t) => {
  const {journal, stats, owners, tasks} = await seeded(t, {tasks: 40, bots: 2})
  stats.prepare = 0
  const page = journal.productList(owners, {limit: 512})
  assert.equal(page.items.length, tasks)
  const perTask = stats.prepare / page.items.length
  assert.ok(perTask < 3, `a page of ${page.items.length} tasks must not cost ${perTask.toFixed(1)} statements each (total ${stats.prepare})`)
  // The pre-change implementation measured about nine statements per task; this
  // keeps a clear floor so a future refactor cannot quietly reintroduce it.
  assert.ok(stats.prepare < 3 * page.items.length, `expected under ${3 * page.items.length} statements, got ${stats.prepare}`)
})

test('task views/native: list() is bounded and matches the single read exactly', async (t) => {
  const {journal, stats, owners} = await seeded(t, {tasks: 24, bots: 2})
  for (const owner of owners) {
    stats.prepare = 0
    const listed = journal.list(owner)
    assert.ok(listed.length > 0)
    assert.ok(stats.prepare < 3 * listed.length + 8, `list(${owner}) prepared ${stats.prepare} statements for ${listed.length} tasks`)
    for (const item of listed) {
      const single = journal.get(owner, item.taskId)
      assert.deepEqual(item, single, `the page row for ${item.taskId} must equal its single read`)
    }
  }
})

test('task views/native: a page never mixes one task\'s attempts or plans into another', async (t) => {
  const {journal, owners} = await seeded(t, {tasks: 16, bots: 2})
  const page = journal.productList(owners, {limit: 512})
  const seen = new Set()
  for (const item of page.items) {
    assert.equal(seen.has(item.taskId), false, 'a task must appear once in a page')
    seen.add(item.taskId)
    for (const attempt of item.attempts) {
      assert.ok(attempt.operation_id)
      assert.equal(attempt.package_id, item.packageId, 'attempts belong to the row\'s own package')
    }
  }
  assert.equal(seen.size, page.items.length)
})

test('task views/native: an unknown owner is refused, an empty page is not an error', async (t) => {
  const {journal} = await seeded(t, {tasks: 4, bots: 1})
  assert.deepEqual(journal.productList(['nobody'], {limit: 10}), {items: [], total: 0, truncated: false})
  assert.throws(() => journal.get('nobody', journal.productList(['bot-0'], {limit: 1}).items[0].taskId), /TASK_NOT_FOUND/)
})
