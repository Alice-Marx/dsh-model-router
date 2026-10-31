import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
const writer = resolve('tests/fixtures/migration-legacy-mr-writer.mjs')
const parent = resolve('tmp/integration/migration-legacy-mr-quarantine')
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
  throw new Error('Owned legacy MR fixture did not reach the expected state')
}
async function property(name, key) {
  const { stdout } = await systemctl(['show', name, '--property=' + key, '--value'])
  return stdout.trim()
}
const tick = async path => (await json(path))?.health?.syntheticTick ?? 0

test('migration legacy MR quarantine: non-Linux platforms are explicitly unsupported', { skip: linux }, async () => {
  await assert.rejects(quarantine({ units: [] }), { code: 'MIGRATION_SYSTEMD_QUARANTINE_UNSUPPORTED' })
})

real('migration legacy MR quarantine: the real old router-state keeps writing under a pending gate until systemd stops it', async t => {
  const dir = await mkdtemp(join(parent, 'case-')), home = join(dir, 'home'), ready = join(dir, 'ready.json'), file = join(home, 'model-router', 'state.json')
  await mkdir(home)
  await writeFile(join(home, 'migration-gate.json'), JSON.stringify({ schemaVersion: 1, kind: 'profile-migration-gate', phase: 'maintenance' }))
  const name = `dsh-e86-${randomUUID()}.service`
  await execute('/usr/bin/systemd-run', ['--unit', name, '--property=Restart=always', process.execPath, writer, home, ready], { timeout: 10000 })
  t.after(async () => {
    await systemctl(['stop', name]).catch(() => {})
    await systemctl(['unmask', name]).catch(() => {})
    await systemctl(['reset-failed', name]).catch(() => {})
  })
  const observed = await wait(() => json(ready))
  assert.equal(observed.syntheticTick, 1)
  await wait(async () => (await tick(file)) > observed.syntheticTick)
  const fragmentPath = await property(name, 'FragmentPath')
  const units = [{ name, fragmentPath, fragmentSha256: createHash('sha256').update(await readFile(fragmentPath)).digest('hex') }]
  const result = await quarantine({ units })
  assert.equal(result.declaredRestartBlocked, true)
  assert.equal(result.stopWriteProvable, false)
  const stopped = await tick(file)
  await sleep(500)
  assert.equal(await tick(file), stopped, 'the real old router-state no longer writes after the OS launcher fence')
  await release({ units })
  await sleep(300)
  assert.equal(await tick(file), stopped, 'release does not restart the old writer')
})
