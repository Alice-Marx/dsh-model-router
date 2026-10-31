import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { quarantineSystemdLaunchers as quarantine, releaseSystemdLaunchers as release } from '../packages/orchestration/src/migration-systemd-quarantine.mjs'

const execute = promisify(execFile)
const linux = process.platform === 'linux'
let capable = false
if (linux && process.getuid() === 0) {
  try { await access('/usr/bin/systemctl', constants.X_OK); capable = true } catch {}
}
const real = (name, fn) => test(name, { skip: !capable, timeout: 45000 }, fn)
const writer = resolve('tests/fixtures/migration-legacy-ds-writer.mjs')
const parent = resolve('tmp/integration/migration-legacy-ds-quarantine')
await mkdir(parent, { recursive: true })
const systemctl = args => execute('/usr/bin/systemctl', args, { timeout: 10000 })
const json = path => readFile(path, 'utf8').then(value => value.trim() ? JSON.parse(value) : null).catch(() => null)
async function wait(fn, ms = 12000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(50)
  }
  throw new Error('Owned legacy DS fixture did not reach the expected state')
}
async function property(name, key) {
  const { stdout } = await systemctl(['show', name, '--property=' + key, '--value'])
  return stdout.trim()
}
const revision = async path => (await json(path))?.revision ?? 0

test('migration legacy DS quarantine: non-Linux platforms are explicitly unsupported', { skip: linux }, async () => {
  await assert.rejects(quarantine({ units: [] }), { code: 'MIGRATION_SYSTEMD_QUARANTINE_UNSUPPORTED' })
})

real('migration legacy DS quarantine: the real lock-broken old store ignores a pending gate until systemd stops it', async t => {
  const dir = await mkdtemp(join(parent, 'case-')), home = join(dir, 'home'), ready = join(dir, 'ready.json')
  await mkdir(home)
  await symlink('/proc/dsh-state.lock', join(home, 'state.lock'))
  await writeFile(join(home, 'migration-gate.json'), JSON.stringify({ schemaVersion: 1, kind: 'profile-migration-gate', phase: 'maintenance' }))
  const name = `dsh-e85-${randomUUID()}.service`
  await execute('/usr/bin/systemd-run', ['--unit', name, '--property=Restart=always', process.execPath, writer, home, ready], { timeout: 10000 })
  t.after(async () => {
    await systemctl(['stop', name]).catch(() => {})
    await systemctl(['unmask', name]).catch(() => {})
    await systemctl(['reset-failed', name]).catch(() => {})
  })
  const observed = await wait(() => json(ready))
  assert.ok(observed.warnings.some(value => value.includes('cannot lock')), 'the unmodified DS store reports its lock is broken')
  await wait(async () => (await revision(join(home, 'state.json'))) > observed.revision)
  const fragmentPath = await property(name, 'FragmentPath')
  const units = [{ name, fragmentPath, fragmentSha256: createHash('sha256').update(await readFile(fragmentPath)).digest('hex') }]
  const result = await quarantine({ units })
  assert.equal(result.declaredRestartBlocked, true)
  assert.equal(result.stopWriteProvable, false)
  const stopped = await revision(join(home, 'state.json'))
  await sleep(500)
  assert.equal(await revision(join(home, 'state.json')), stopped, 'the real old store no longer writes after the OS launcher fence')
  await release({ units })
  await sleep(300)
  assert.equal(await revision(join(home, 'state.json')), stopped, 'release does not restart the old writer')
})
