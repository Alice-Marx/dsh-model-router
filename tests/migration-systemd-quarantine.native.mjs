import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
const worker = resolve('tests/fixtures/migration-systemd-writer.mjs')
const parentProgram = resolve('tests/fixtures/migration-systemd-quarantine-parent.mjs')
const parent = resolve('tmp/integration/migration-systemd-quarantine')
await mkdir(parent, { recursive: true })
const run = (command, args) => execute(command, args, { timeout: 10000 })
const systemctl = args => run('/usr/bin/systemctl', args)
const json = path => readFile(path, 'utf8').then(value => value.trim() ? JSON.parse(value) : null).catch(() => null)
async function wait(fn, ms = 12000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(50)
  }
  throw new Error('Owned systemd fixture did not reach the expected state')
}
async function property(name, key) {
  const { stdout } = await systemctl(['show', name, '--property=' + key, '--value'])
  return stdout.trim()
}
async function state(name) {
  const [enabled, active] = await Promise.all([
    readlink(join('/etc/systemd/system', name)).then(value => value === '/dev/null' ? 'masked' : 'unmasked', error => ['ENOENT', 'EINVAL'].includes(error.code) ? 'unmasked' : Promise.reject(error)),
    systemctl(['is-active', name]).then(result => result.stdout.trim(), error => error.stdout?.trim() ?? ''),
  ])
  return { enabled, active }
}
async function fixture(t) {
  const dir = await mkdtemp(join(parent, 'case-')), name = `dsh-e84-${randomUUID()}.service`, ready = join(dir, 'ready.json'), heartbeat = join(dir, 'heartbeat')
  await run('/usr/bin/systemd-run', ['--unit', name, '--property=Restart=always', process.execPath, worker, ready, heartbeat])
  t.after(async () => {
    await systemctl(['stop', name]).catch(() => {})
    await systemctl(['unmask', name]).catch(() => {})
    await systemctl(['reset-failed', name]).catch(() => {})
  })
  await wait(() => json(ready))
  const fragmentPath = await property(name, 'FragmentPath')
  const fragmentSha256 = (await import('node:crypto')).createHash('sha256').update(await readFile(fragmentPath)).digest('hex')
  return { dir, name, ready, heartbeat, units: [{ name, fragmentSha256, fragmentPath }] }
}
const heartbeat = path => readFile(path, 'utf8').catch(() => '')

test('migration systemd quarantine: non-Linux platforms are explicitly unsupported', { skip: linux }, async () => {
  await assert.rejects(quarantine({ units: [] }), { code: 'MIGRATION_SYSTEMD_QUARANTINE_UNSUPPORTED' })
})

real('migration systemd quarantine: a real restarting writer stays masked and stopped until explicit release', async t => {
  const f = await fixture(t)
  const firstPid = Number(await property(f.name, 'MainPID'))
  await wait(async () => (await heartbeat(f.heartbeat)).length > 0)
  await systemctl(['kill', '--kill-whom=main', '--signal=SIGKILL', f.name])
  await wait(async () => {
    const pid = Number(await property(f.name, 'MainPID'))
    return pid > 0 && pid !== firstPid && (await heartbeat(f.heartbeat)).includes(`${pid}:`)
  })
  const result = await quarantine({ units: f.units })
  assert.equal(result.declaredRestartBlocked, true)
  assert.equal(result.persistentDeclaredExclusion, true)
  assert.deepEqual([result.externalRestartBlocked, result.persistentExternalExclusion, result.stopWriteProvable], [false, false, false])
  assert.deepEqual(await state(f.name), { enabled: 'masked', active: 'inactive' })
  const before = await heartbeat(f.heartbeat)
  await assert.rejects(systemctl(['start', f.name]))
  await sleep(400)
  assert.equal(await heartbeat(f.heartbeat), before, 'no new writer or restart can append after quarantine')
  const released = await release({ units: f.units })
  assert.equal(released.started, false)
  assert.equal(released.units[0].started, false)
  assert.equal((await state(f.name)).active, 'inactive')
  assert.notEqual((await state(f.name)).enabled, 'masked')
  await sleep(300)
  assert.equal(await heartbeat(f.heartbeat), before, 'release never starts the old writer')
})

real('migration systemd quarantine: coordinator death preserves the declared restart fence', async t => {
  const f = await fixture(t), requestPath = join(f.dir, 'request.json')
  await writeFile(requestPath, JSON.stringify({ units: f.units }))
  const coordinator = spawn(process.execPath, [parentProgram, f.dir, requestPath], { cwd: f.dir, stdio: 'ignore' })
  const exited = new Promise(resolve => coordinator.once('close', resolve))
  t.after(() => { if (coordinator.exitCode === null && coordinator.signalCode === null) coordinator.kill('SIGKILL') })
  await wait(() => json(join(f.dir, 'parent-ready.json')))
  coordinator.kill('SIGKILL')
  await exited
  assert.deepEqual(await state(f.name), { enabled: 'masked', active: 'inactive' })
  const before = await heartbeat(f.heartbeat)
  await assert.rejects(systemctl(['start', f.name]))
  await sleep(300)
  assert.equal(await heartbeat(f.heartbeat), before)
  await release({ units: f.units })
})

real('migration systemd quarantine: release refuses a unit that has become active', async t => {
  const f = await fixture(t)
  await quarantine({ units: f.units })
  await systemctl(['unmask', f.name])
  await run('/usr/bin/systemd-run', ['--unit', f.name, '--property=Restart=always', process.execPath, worker, f.ready, f.heartbeat])
  await wait(async () => (await state(f.name)).active === 'active')
  await assert.rejects(release({ units: f.units }), { code: 'MIGRATION_SYSTEMD_RELEASE_BLOCKED' })
  await systemctl(['stop', f.name])
  await systemctl(['mask', f.name])
  await release({ units: f.units })
})

real('migration systemd quarantine: fragment mismatch refuses before any stop or mask', async t => {
  const f = await fixture(t)
  const before = await state(f.name)
  await assert.rejects(quarantine({ units: [{ name: f.name, fragmentSha256: '0'.repeat(64) }] }), { code: 'MIGRATION_SYSTEMD_UNIT_CHANGED' })
  assert.deepEqual(await state(f.name), before)
})
