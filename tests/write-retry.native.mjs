import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {readDatabaseClock, sleepSync, writeTransaction} from '../packages/orchestration/src/write-retry.mjs'

// Driver-backed contention behaviour. Run through scripts/integration-task-probe.mjs,
// which supplies the verified plain-Node better-sqlite3 build.
assert.ok(process.env.DSH_TASK_DRIVER, 'Run through integration-task-probe.mjs with the verified native driver')
const {default: Database} = await import(process.env.DSH_TASK_DRIVER)
const parent = resolve('tmp/integration/task-native')
await mkdir(parent, {recursive: true})
const fresh = async () => join(await mkdtemp(join(parent, 'db-')), 'orchestration.sqlite')

test('write-retry/native: a borrowed journal handle keeps a waiting busy_timeout', async (t) => {
  const path = await fresh()
  const shared = new Database(path)
  t.after(() => shared.close())
  shared.pragma('busy_timeout=0')
  const journal = openTaskJournal(Database, path, {database: shared})
  t.after(() => journal.close())
  const timeout = shared.pragma('busy_timeout', {simple: true})
  assert.ok(timeout >= 5000, `the journal must not restore a borrowed handle to non-blocking (got ${timeout})`)
  journal.claimRunner('runner-a', 1000, 0)
  assert.ok(shared.pragma('busy_timeout', {simple: true}) >= 5000, 'the wait survives a write, not just open')
})

test('write-retry/native: a second host waits out a lock held by another process instead of failing', async (t) => {
  const {spawn} = await import('node:child_process')
  const path = await fresh()
  const db = new Database(path)
  t.after(() => { try { db.close() } catch {} })
  db.pragma('journal_mode=WAL')
  db.exec('CREATE TABLE t(k TEXT PRIMARY KEY)')
  const journal = openTaskJournal(Database, path, {database: db, writeDeadlineMs: 10_000})
  t.after(() => journal.close())

  // Another process takes the write lock for 400ms. A journal that inherited a
  // non-blocking handle would fail here on the first attempt.
  const driver = process.env.DSH_TASK_DRIVER.startsWith('file:') ? fileURLToPath(process.env.DSH_TASK_DRIVER) : resolve(process.env.DSH_TASK_DRIVER)
  const child = spawn(process.execPath, [resolve('scripts/integration-task-probe.mjs'), '--lock-child', driver, path, '400'], {stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true})
  // Wait until the other process really holds the lock, so the measurement is
  // of this writer waiting, not of node starting up.
  await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error('lock child never reported ready')), 20_000)
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('locked')) { clearTimeout(timer); resolveReady() } })
    child.once('exit', () => { clearTimeout(timer); rejectReady(new Error('lock child exited early')) })
  })
  const started = Date.now()
  const identity = journal.claimRunner('runner-b', 5000, Date.now())
  const waited = Date.now() - started
  await new Promise((resolveExit) => child.once('exit', resolveExit))
  assert.ok(identity.generation >= 1)
  assert.ok(waited >= 250, `the claim must have waited for the other process (waited ${waited}ms)`)
})

test('write-retry/native: an expired bound names its deadline instead of a bare driver error', async (t) => {
  const path = await fresh()
  const a = new Database(path), b = new Database(path)
  t.after(() => { a.close(); b.close() })
  a.pragma('journal_mode=WAL'); b.pragma('busy_timeout=0')
  a.exec('CREATE TABLE t(k TEXT PRIMARY KEY)')
  const journal = openTaskJournal(Database, path, {database: b, writeDeadlineMs: 60})
  t.after(() => journal.close())
  a.exec('BEGIN IMMEDIATE')
  try {
    assert.throws(() => journal.claimRunner('runner-b', 5000, 0), (error) => {
      assert.equal(error.code, 'SQLITE_BUSY')
      assert.equal(error.deadlineMs, 60)
      assert.equal(error.sqliteCode, 'SQLITE_BUSY')
      return true
    })
  } finally { a.exec('ROLLBACK') }
})

test('write-retry/native: the ledger clock is the lease clock when asked for', async (t) => {
  const path = await fresh()
  const db = new Database(path)
  t.after(() => db.close())
  db.pragma('journal_mode=WAL')
  const journal = openTaskJournal(Database, path, {database: db, leaseClock: 'db'})
  t.after(() => journal.close())

  // A caller whose wall clock is an hour behind must not be able to write a
  // lease that is already expired to everybody else.
  const behind = Date.now() - 3_600_000
  const identity = journal.claimRunner('runner-db-clock', 10_000, behind)
  assert.equal(identity.generation, 1)
  const row = db.prepare("SELECT until_ms FROM task_runner WHERE scope='execution'").get()
  assert.ok(row.until_ms > behind + 10_000, 'the lease is stamped from the database clock, not the caller')
  assert.ok(Math.abs(row.until_ms - (readDatabaseClock(db) + 10_000)) < 2000)
  journal.renew(identity, 10_000, behind)
  assert.doesNotThrow(() => journal.recover(identity, behind), 'the same skewed caller can still fence its own lease')

  // And an hour ahead cannot declare it expired either.
  const ahead = Date.now() + 3_600_000
  const secondHandle = new Database(path)
  t.after(() => { try { secondHandle.close() } catch {} })
  const other = openTaskJournal(Database, path, {database: secondHandle, leaseClock: 'db'})
  t.after(() => other.close())
  assert.throws(() => other.claimRunner('runner-fast-clock', 10_000, ahead), /TASK_RUNNER_BUSY/)
})

test('write-retry/native: an app-clock journal keeps the simulated clock fixtures rely on', async (t) => {
  const path = await fresh()
  const journal = openTaskJournal(Database, path)
  t.after(() => journal.close())
  const first = journal.claimRunner('runner-a', 1000, 0)
  assert.equal(first.generation, 1)
  // now=1001 is past the 1000ms lease that was written from t=0: the default
  // clock is the caller's, which is what every existing fixture assumes.
  const second = journal.claimRunner('runner-b', 1000, 1001)
  assert.equal(second.generation, 2)
})
