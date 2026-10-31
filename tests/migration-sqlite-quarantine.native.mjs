import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { launchMigrationProcessTree as launch } from '../packages/orchestration/src/migration-os-quarantine.mjs'

const enabled = process.platform === 'win32'
const real = (name, fn) => test(name, { skip: !enabled, timeout: 45000 }, fn)
const writer = resolve('tests/fixtures/migration-sqlite-writer.mjs')
const parent = resolve('tmp/integration/migration-sqlite-quarantine')
await mkdir(parent, { recursive: true })
let build
async function compiled() {
  if (build) return build
  const dir = await mkdtemp(join(parent, 'build-'))
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const runner = join(dir, 'process-job.exe')
  execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', '/out:' + runner, '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll', resolve('native/windows-desktop/ProcessJob.cs')], { windowsHide: true })
  build = { runner }
  return build
}
const json = path => readFile(path, 'utf8').then(value => value.trim() ? JSON.parse(value) : null).catch(() => null)
async function wait(fn, ms = 12000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(50)
  }
  throw new Error('Owned SQLite fixture did not reach the expected state')
}
function revision(file) {
  const db = new Database(file, { readonly: true })
  try {
    const row = db.prepare('SELECT revision,payload FROM router_meta WHERE singleton=1').get()
    return { revision: row.revision, syntheticTick: JSON.parse(row.payload).health?.syntheticTick ?? 0 }
  } finally { db.close() }
}

test('migration SQLite quarantine: non-Windows platforms are explicitly unsupported', { skip: enabled }, async () => {
  await assert.rejects(launch({ operationId: 'op-unsupported' }), { code: 'MIGRATION_OS_QUARANTINE_UNSUPPORTED' })
})

real('migration SQLite quarantine: the real WAL writer keeps committing under a pending gate until the Job closes it', async t => {
  const { runner } = await compiled(), dir = await mkdtemp(join(parent, 'case-')), ready = join(dir, 'ready.json'), file = join(dir, 'orchestration.sqlite')
  await writeFile(join(dir, 'migration-gate.json'), JSON.stringify({ schemaVersion: 1, kind: 'profile-migration-gate', phase: 'maintenance' }))
  const handle = await launch({ runner, executable: process.execPath, args: [writer, dir, ready], cwd: dir, operationId: 'op-sqlite-writer' })
  t.after(async () => { if (!handle.snapshot().wrapperClosed) await handle.stop().catch(() => {}) })
  const observed = await wait(() => json(ready))
  await wait(async () => (await revision(file)).syntheticTick > observed.syntheticTick)
  const result = await handle.stop()
  assert.equal(result.treeStopped, true)
  assert.equal(result.stopWriteProvable, false)
  const stopped = await revision(file)
  await sleep(500)
  assert.deepEqual(await revision(file), stopped, 'no new SQLite commit or metadata revision appears after the process and handles close')
})
