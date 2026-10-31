import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { createMigrationLedgerArchive } from '../packages/orchestration/src/migration-ledger-export.mjs'
import { diagnoseMigrationRollbackReadiness } from '../packages/orchestration/src/migration-rollback-readiness.mjs'

const parent = resolve('tmp/integration/migration-rollback-readiness'); await mkdir(parent, { recursive: true })
const ROUTER_DDL = `CREATE TABLE IF NOT EXISTS router_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS router_runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS router_holds(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES router_runs(id),payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS router_migration(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL,source TEXT NOT NULL,phase TEXT NOT NULL,source_hash TEXT NOT NULL,backup TEXT NOT NULL,rollback_payload TEXT);
  CREATE TABLE IF NOT EXISTS router_commits(revision INTEGER PRIMARY KEY,at_ms INTEGER NOT NULL,digest TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS router_model_calls(id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,task_id TEXT,run_id TEXT NOT NULL,identity_hash TEXT NOT NULL,payload TEXT NOT NULL);`

async function fixture() {
  const dir = await mkdtemp(join(parent, 'case-')), data = join(dir, 'data'), archiveRoot = join(dir, 'archive')
  await mkdir(data); await mkdir(archiveRoot)
  const journalFile = join(data, 'tasks.sqlite'), routerFile = join(data, 'router.sqlite'), privateOutput = join(archiveRoot, 'ledger-archive')
  const journal = openTaskJournal(Database, journalFile)
  journal.close()
  const router = new Database(routerFile)
  router.exec(ROUTER_DDL)
  router.prepare("INSERT INTO router_meta VALUES(1,2,0,'{}')").run()
  router.close()
  return { dir, journalFile, routerFile, privateOutput }
}
const addTask = (journalFile, id, state, { started = null, result = null, attemptState = 'succeeded', operationState = 'succeeded', delivered = true } = {}) => {
  const db = new Database(journalFile)
  try {
    db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?)').run(id, 'bot-a', '{}', state, Date.now() + 60000, Date.now(), Date.now())
    db.prepare('INSERT INTO packages VALUES(?,?,?,?)').run(`pkg-${id}`, id, `att-${id}`, state === 'skipped' ? 'skipped' : state)
    db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)').run(`att-${id}`, `pkg-${id}`, 1, null, attemptState, 1, started, started === null ? null : Date.now(), result === null ? null : JSON.stringify(result))
    db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(`op-${id}`, `att-${id}`, operationState, 1, Date.now(), Date.now())
    db.prepare('INSERT INTO task_outbox VALUES(?,?)').run(`op-${id}`, delivered ? Date.now() : null)
  } finally { db.close() }
}
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const diagnose = (f, extra = {}) => diagnoseMigrationRollbackReadiness({ Database, journalFile: f.journalFile, routerFile: f.routerFile, privateOutput: f.privateOutput, ...extra })
const codes = result => result.blockers.map(blocker => blocker.code)

test('readiness: terminal tasks, no holds and a bound archive are ready', async () => {
  const f = await fixture()
  addTask(f.journalFile, 'task-ok', 'succeeded', { started: 1 })
  addTask(f.journalFile, 'task-failed', 'failed', { started: 1, attemptState: 'failed', operationState: 'failed' })
  const router = new Database(f.routerFile)
  const archive = await createMigrationLedgerArchive({ Database, database: router, privateOutput: f.privateOutput })
  router.close()
  const result = await diagnose(f)
  assert.equal(result.ready, true)
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(codes(result), [])
  assert.equal(result.postActivationRollbackSupported, false, 'the readiness gate stays closed')
  assert.ok(archive.status === 'complete')
})

test('readiness: active, unknown, retryable-blocked and started-skipped tasks block', async () => {
  const f = await fixture()
  addTask(f.journalFile, 'task-running', 'running')
  addTask(f.journalFile, 'task-unknown', 'needs-reconciliation')
  addTask(f.journalFile, 'task-blocked', 'blocked')
  addTask(f.journalFile, 'task-skipped-started', 'skipped', { started: 1 })
  const router = new Database(f.routerFile)
  await createMigrationLedgerArchive({ Database, database: router, privateOutput: f.privateOutput })
  router.close()
  const result = await diagnose(f)
  assert.equal(result.ready, false)
  for (const code of ['ACTIVE_TASK', 'UNKNOWN_TASK_OUTCOME', 'RETRYABLE_BLOCKED_TASK', 'SKIPPED_WITH_STARTED_ATTEMPT']) assert.ok(codes(result).includes(code), code)
})

test('readiness: a provably not-started skipped task is advisory only', async () => {
  const f = await fixture()
  addTask(f.journalFile, 'task-skipped-clean', 'skipped', { result: { notStarted: true } })
  const router = new Database(f.routerFile)
  await createMigrationLedgerArchive({ Database, database: router, privateOutput: f.privateOutput })
  router.close()
  const result = await diagnose(f)
  assert.equal(result.ready, true, 'not-started skipped does not block')
  assert.deepEqual(result.advisories.map(entry => entry.code), ['SKIPPED_NOT_STARTED'])
})

test('readiness: open holds, unsettled operations and undelivered outbox block', async () => {
  const f = await fixture()
  addTask(f.journalFile, 'task-hold', 'succeeded', { started: 1 })
  addTask(f.journalFile, 'task-op', 'succeeded', { started: 1, operationState: 'running' })
  addTask(f.journalFile, 'task-out', 'succeeded', { started: 1, delivered: false })
  const router = new Database(f.routerFile)
  router.prepare("INSERT INTO router_runs VALUES('run-1','{}')").run()
  router.prepare("INSERT INTO router_holds VALUES('hold-1','run-1','{}')").run()
  await createMigrationLedgerArchive({ Database, database: router, privateOutput: f.privateOutput })
  router.close()
  const result = await diagnose(f)
  for (const code of ['OPEN_HOLD', 'UNSETTLED_OPERATION', 'UNDELIVERED_OUTBOX']) assert.ok(codes(result).includes(code), code)
})

test('readiness: a missing archive and a stale binding block', async () => {
  const f = await fixture()
  addTask(f.journalFile, 'task-ok', 'succeeded', { started: 1 })
  const missing = await diagnose(f)
  assert.equal(missing.ready, false)
  assert.ok(codes(missing).includes('MIGRATION_READINESS_BACKUP_BINDING_INVALID'))

  const f2 = await fixture()
  addTask(f2.journalFile, 'task-ok', 'succeeded', { started: 1 })
  const router = new Database(f2.routerFile)
  await createMigrationLedgerArchive({ Database, database: router, privateOutput: f2.privateOutput })
  router.close()
  // New data after the archive: the live export digest diverges.
  const later = new Database(f2.routerFile)
  later.prepare("INSERT INTO router_runs VALUES('run-late','{}')").run()
  later.close()
  const stale = await diagnose(f2)
  assert.equal(stale.ready, false)
  assert.ok(codes(stale).includes('BACKUP_BINDING_STALE'))
})

test('readiness: the diagnosis is read-only and the input shape is bounded', async () => {
  const f = await fixture()
  addTask(f.journalFile, 'task-ok', 'succeeded', { started: 1 })
  const router = new Database(f.routerFile)
  await createMigrationLedgerArchive({ Database, database: router, privateOutput: f.privateOutput })
  router.close()
  const beforeJournal = await digest(f.journalFile), beforeRouter = await digest(f.routerFile)
  const result = await diagnose(f)
  assert.equal(result.ready, true)
  assert.equal(await digest(f.journalFile), beforeJournal, 'the journal file is byte-identical')
  assert.equal(await digest(f.routerFile), beforeRouter, 'the router file is byte-identical')
  for (const bad of [{ journalFile: 'relative', routerFile: f.routerFile, privateOutput: f.privateOutput }, { journalFile: f.journalFile, routerFile: '', privateOutput: f.privateOutput }, { journalFile: f.journalFile, routerFile: f.routerFile, privateOutput: 'nope/relative' }])
    await assert.rejects(diagnoseMigrationRollbackReadiness({ Database, ...bad }), /MIGRATION_READINESS_INPUT_INVALID/)
})
