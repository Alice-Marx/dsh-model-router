import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_DRIVER = 'tmp/integration/probes/sqlite/node_modules/better-sqlite3/lib/index.js'

/** Native driver/transaction probe only; these fixture tables are not the product schema. */
export async function probeSqlite(driverFile = resolve(ROOT, DEFAULT_DRIVER)) {
  const { default: Database } = await import(pathToFileURL(driverFile).href)
  const driverRoot = resolve(dirname(driverFile), '..')
  const manifest = JSON.parse(await readFile(join(driverRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'better-sqlite3')
  assert.equal(manifest.version, '13.0.3')
  const runRoot = join(ROOT, 'tmp/integration/probes/sqlite/runs')
  await mkdir(runRoot, { recursive: true })
  const run = await mkdtemp(join(runRoot, 'native-'))
  const dbFile = join(run, 'probe.sqlite')
  let a = new Database(dbFile)
  let b
  try {
    assert.equal(a.pragma('journal_mode = WAL', { simple: true }), 'wal')
    a.pragma('synchronous = FULL')
    a.exec(`CREATE TABLE operations(id TEXT PRIMARY KEY, request_hash TEXT NOT NULL);
      CREATE TABLE budget(id INTEGER PRIMARY KEY, ceiling INTEGER NOT NULL, reserved INTEGER NOT NULL);
      INSERT INTO budget VALUES (1, 1000, 0);`)
    assert.throws(a.transaction(() => {
      a.prepare('INSERT INTO operations VALUES (?, ?)').run('rolled-back', 'hash')
      a.prepare('UPDATE budget SET reserved = 999 WHERE id = 1').run()
      throw new Error('simulated interruption')
    }), /simulated interruption/)
    assert.equal(a.prepare('SELECT COUNT(*) AS n FROM operations').get().n, 0)
    assert.equal(a.prepare('SELECT reserved FROM budget').get().reserved, 0)
    b = new Database(dbFile)
    const reserve = db => db.transaction((id, hash, amount) => {
      const previous = db.prepare('SELECT request_hash FROM operations WHERE id = ?').get(id)
      if (previous) {
        assert.equal(previous.request_hash, hash, 'same operation id with changed content is refused')
        return 'replay'
      }
      const changed = db.prepare('UPDATE budget SET reserved = reserved + ? WHERE id = 1 AND reserved + ? <= ceiling').run(amount, amount)
      if (changed.changes !== 1) throw new Error('budget unavailable')
      db.prepare('INSERT INTO operations VALUES (?, ?)').run(id, hash)
      return 'admitted'
    })
    const ra = reserve(a)
    const rb = reserve(b)
    assert.equal(ra('op-1', 'hash-1', 700), 'admitted')
    assert.throws(() => rb('op-2', 'hash-2', 600), /budget unavailable/)
    assert.equal(rb('op-1', 'hash-1', 700), 'replay')
    assert.throws(() => rb('op-1', 'other-content', 1), /changed content/)
    assert.equal(a.prepare('SELECT reserved FROM budget').get().reserved, 700)
    b.close(); b = null
    a.close(); a = null

    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--crash-child', driverFile, dbFile], {
      cwd: ROOT, encoding: 'utf8', timeout: 15_000, windowsHide: true,
    })
    assert.equal(child.status, 23, `crash fixture did not reach expected exit: ${child.stderr}`)
    a = new Database(dbFile)
    assert.equal(a.prepare('SELECT COUNT(*) AS n FROM operations WHERE id = ?').get('uncommitted').n, 0)
    assert.equal(a.prepare('SELECT reserved FROM budget').get().reserved, 700)
    assert.equal(a.prepare('SELECT COUNT(*) AS n FROM operations').get().n, 1)
    const native = join(driverRoot, 'prebuilds', `${process.platform}-${process.arch}.node`)
    return {
      status: 'passed', driver: manifest.name, version: manifest.version,
      platform: process.platform, arch: process.arch, node: process.version, nodeAbi: process.versions.modules,
      nativeSha256: createHash('sha256').update(await readFile(native)).digest('hex'),
      checks: ['native module loads', 'WAL', 'atomic rollback', 'two connections enforce budget', 'idempotent admission', 'changed-content conflict', 'reopen after process interruption'],
      limitations: ['Windows current Node runtime only', 'No Node 22/Electron ABI or Linux installation checked', 'Fixture tables, not the product ledger or migration', 'No paid call or external machine'],
    }
  } finally {
    b?.close()
    a?.close()
  }
}

if (process.argv[2] === '--crash-child') {
  const { default: Database } = await import(pathToFileURL(process.argv[3]).href)
  const db = new Database(process.argv[4])
  db.exec("BEGIN IMMEDIATE; INSERT INTO operations VALUES ('uncommitted', 'hash'); UPDATE budget SET reserved = 999 WHERE id = 1;")
  // Deliberately omit close/COMMIT to test process interruption recovery.
  process.exit(23)
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  probeSqlite(process.argv[2] ? resolve(process.argv[2]) : undefined)
    .then(result => process.stdout.write(JSON.stringify(result, null, 2)+'\n'))
    .catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
}
