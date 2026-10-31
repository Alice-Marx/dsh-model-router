import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rmdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { launchMigrationLinuxProcessTree as launch } from '../packages/orchestration/src/migration-linux-quarantine.mjs'

const linux = process.platform === 'linux'
const cgroupRoot = process.env.DSH_MIGRATION_CGROUP_ROOT ?? '/sys/fs/cgroup'
let capable = false
if (linux) {
  const probe = join(cgroupRoot, `dsh-capability-${process.pid}`)
  try {
    await mkdir(probe)
    await access(join(probe, 'cgroup.kill'), constants.W_OK)
    capable = true
    await rmdir(probe)
  } catch { await rmdir(probe).catch(() => {}) }
}
const real = (name, fn) => test(name, { skip: !capable, timeout: 45000 }, fn)
const worker = resolve('tests/fixtures/windows-process-job-worker.mjs')
const parentProgram = resolve('tests/fixtures/migration-linux-quarantine-parent.mjs')
const parent = resolve('tmp/integration/migration-linux-quarantine')
await mkdir(parent, { recursive: true })
async function fixture(t) {
  const dir = await mkdtemp(join(parent, 'case-'))
  const handles = []
  t.after(async () => { for (const handle of handles) if (!handle.snapshot().wrapperClosed) await handle.stop().catch(() => {}) })
  const start = async request => {
    const handle = await launch({ executable: process.execPath, cwd: dir, operationId: `op-${randomUUID()}`, cgroupRoot, ...request })
    handles.push(handle)
    return handle
  }
  return { dir, start }
}
const json = path => readFile(path, 'utf8').then(value => value.trim() ? JSON.parse(value) : null).catch(() => null)
async function wait(fn, ms = 12000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('Owned Linux quarantine fixture did not reach the expected state')
}
const request = (mode, args = []) => ({ args: [worker, mode, ...args] })

test('migration Linux quarantine: non-Linux platforms are explicitly unsupported', { skip: linux }, async () => {
  await assert.rejects(launch({ operationId: 'op-unsupported' }), { code: 'MIGRATION_LINUX_QUARANTINE_UNSUPPORTED' })
})

real('migration Linux quarantine: launch input is closed, absolute and bounded', async t => {
  const f = await fixture(t)
  for (const patch of [
    { operationId: 'bad id' }, { args: 'not-an-array' }, { args: Array(65).fill('x') }, { args: ['bad\0arg'] },
    { stopTimeoutMs: 0 }, { python: 'relative' }, { executable: 'node' }, { cwd: 'relative' }, { cgroupRoot: 'relative' },
  ]) await assert.rejects(launch({ executable: process.execPath, args: [], cwd: f.dir, operationId: 'op-input', ...patch }), { code: /MIGRATION_LINUX_QUARANTINE_(INPUT|PATH)_INVALID/ })
  await assert.rejects(launch({ executable: join(f.dir, 'missing'), args: [], cwd: f.dir, operationId: 'op-missing' }), { code: 'MIGRATION_LINUX_QUARANTINE_PATH_INVALID' })
  if (process.getuid() !== 0) await assert.rejects(launch({ executable: process.execPath, args: [], cwd: f.dir, operationId: 'op-untrusted', cgroupRoot: '/sys/fs/cgroup' }), { code: 'MIGRATION_LINUX_QUARANTINE_CGROUP_UNTRUSTED' })
})

real('migration Linux quarantine: active stop kills the cgroup before its delayed write', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late')
  const handle = await f.start(request('tree', [ready, marker]))
  const info = await wait(() => json(ready))
  for (const pid of [info.pid, info.descendantPid]) {
    const membership = await readFile(`/proc/${pid}/cgroup`, 'utf8')
    assert.ok(membership.includes(`dsh-migration-${handle.operationId}`), `pid ${pid} is inside the operation cgroup`)
  }
  const result = await handle.stop()
  assert.equal(result.treeStopped, true)
  assert.equal(result.cgroupRemoved, true)
  assert.equal(result.stopEvidence, 'linux-cgroup-v2-kill')
  assert.equal(result.reason, 'stop-requested')
  assert.deepEqual([result.externalRestartBlocked, result.persistentExternalExclusion, result.stopWriteProvable], [false, false, false])
  await sleep(1100)
  assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
  assert.deepEqual(await handle.stop(), result)
})

real('migration Linux quarantine: direct-child exit also kills a surviving descendant', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late')
  const handle = await f.start(request('exit-with-child', [ready, marker]))
  const result = await handle.closed
  assert.equal(result.code, 0, `${handle.stdout}\n${handle.stderr}`)
  assert.equal(result.treeStopped, true)
  assert.equal(result.cgroupRemoved, true)
  await wait(() => json(ready))
  await sleep(1100)
  assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
})

real('migration Linux quarantine: coordinator death kills the cgroup without an external-exclusion claim', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late'), requestPath = join(f.dir, 'request.json')
  await writeFile(requestPath, JSON.stringify({ executable: process.execPath, cwd: f.dir, operationId: `op-${randomUUID()}`, cgroupRoot, ...request('tree', [ready, marker]) }))
  const coordinator = spawn(process.execPath, [parentProgram, f.dir, requestPath], { cwd: f.dir, stdio: 'ignore' })
  const exited = new Promise(resolve => coordinator.once('close', resolve))
  t.after(() => { if (coordinator.exitCode === null && coordinator.signalCode === null) coordinator.kill('SIGKILL') })
  await wait(() => json(join(f.dir, 'parent-ready.json')))
  await wait(() => json(ready))
  coordinator.kill('SIGKILL')
  await exited
  await sleep(1100)
  assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
  assert.equal(await json(join(f.dir, 'parent-result.json')), null)
})
