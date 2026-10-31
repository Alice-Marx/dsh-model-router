import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { launchMigrationProcessTree as launch } from '../packages/orchestration/src/migration-os-quarantine.mjs'

const enabled = process.platform === 'win32'
const real = (name, fn) => test(name, { skip: !enabled, timeout: 45000 }, fn)
const worker = resolve('tests/fixtures/windows-process-job-worker.mjs')
const parentProgram = resolve('tests/fixtures/migration-os-quarantine-parent.mjs')
const parent = resolve('tmp/integration/migration-os-quarantine')
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
async function fixture(t) {
  const { runner } = await compiled()
  const dir = await mkdtemp(join(parent, 'case-'))
  const handles = []
  t.after(async () => {
    for (const handle of handles) if (!handle.snapshot().wrapperClosed) await handle.stop().catch(() => {})
  })
  const start = async request => {
    const handle = await launch({ runner, executable: process.execPath, cwd: dir, operationId: 'op-quarantine', ...request })
    handles.push(handle)
    return handle
  }
  return { runner, dir, start }
}
const json = path => readFile(path, 'utf8').then(value => value.trim() ? JSON.parse(value) : null).catch(() => null)
async function wait(fn, ms = 12000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('Owned quarantine fixture did not reach the expected state')
}
const request = (mode, args = []) => ({ args: [worker, mode, ...args] })

test('migration OS quarantine: non-Windows platforms are explicitly unsupported', { skip: enabled }, async () => {
  await assert.rejects(launch({ operationId: 'op-unsupported' }), { code: 'MIGRATION_OS_QUARANTINE_UNSUPPORTED' })
})

real('migration OS quarantine: launch input is closed, absolute and bounded', async t => {
  const f = await fixture(t)
  for (const patch of [
    { operationId: 'bad id' }, { args: 'not-an-array' }, { args: Array(65).fill('x') }, { args: ['bad\0arg'] },
    { stopTimeoutMs: 0 }, { runner: 'relative.exe' }, { executable: 'node.exe' }, { cwd: 'relative' },
  ]) await assert.rejects(launch({ runner: f.runner, executable: process.execPath, args: [], cwd: f.dir, operationId: 'op-input', ...patch }), { code: /MIGRATION_OS_QUARANTINE_(INPUT|PATH)_INVALID/ })
  await assert.rejects(launch({ runner: f.runner, executable: process.execPath, args: ['x'.repeat(70000)], cwd: f.dir, operationId: 'op-input' }), { code: 'MIGRATION_OS_QUARANTINE_INPUT_INVALID' })
})

real('migration OS quarantine: active stop closes the whole owned tree before its delayed write', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late')
  const handle = await f.start(request('tree', [ready, marker]))
  const info = await wait(() => json(ready))
  assert.ok(info.descendantPid > 0)
  const result = await handle.stop()
  assert.equal(result.treeStopped, true)
  assert.equal(result.stopEvidence, 'windows-job-close')
  assert.deepEqual([result.externalRestartBlocked, result.persistentExternalExclusion, result.stopWriteProvable], [false, false, false])
  assert.equal(handle.snapshot().wrapperClosed, true)
  await sleep(1100)
  assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
  assert.deepEqual(await handle.stop(), result, 'stop is idempotent and returns the original close observation')
})

real('migration OS quarantine: direct-child exit also closes a surviving descendant', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late')
  const handle = await f.start(request('exit-with-child', [ready, marker]))
  const result = await handle.closed
  assert.equal(result.code, 0, handle.stderr)
  assert.equal(result.treeStopped, true)
  await wait(() => json(ready))
  await sleep(1100)
  assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
})

real('migration OS quarantine: coordinator death closes the tree and never claims external restart exclusion', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late'), requestPath = join(f.dir, 'request.json')
  await writeFile(requestPath, JSON.stringify({ runner: f.runner, executable: process.execPath, cwd: f.dir, operationId: 'op-parent-death', ...request('tree', [ready, marker]) }))
  const coordinator = spawn(process.execPath, [parentProgram, f.dir, requestPath], { cwd: f.dir, windowsHide: true, stdio: 'ignore' })
  const exited = new Promise(resolve => coordinator.once('close', resolve))
  t.after(() => { if (coordinator.exitCode === null && coordinator.signalCode === null) coordinator.kill('SIGKILL') })
  await wait(() => json(join(f.dir, 'parent-ready.json')))
  await wait(() => json(ready))
  coordinator.kill('SIGKILL')
  await exited
  await sleep(1100)
  assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
  assert.equal(await json(join(f.dir, 'parent-result.json')), null, 'a killed coordinator cannot fabricate a close receipt')
})

real('migration OS quarantine: a missing target is refused before launch without a synthetic write', async t => {
  const f = await fixture(t), marker = join(f.dir, 'unexpected')
  await assert.rejects(f.start({ executable: join(f.dir, 'missing.exe'), args: [worker, 'hold', marker] }), { code: 'MIGRATION_OS_QUARANTINE_PATH_INVALID' })
  assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
})

real('migration OS quarantine: a runner that cannot start is rejected without a Job stop receipt', async t => {
  const f = await fixture(t)
  await assert.rejects(f.start({ runner: worker, ...request('hold') }), { code: 'MIGRATION_OS_QUARANTINE_RUNNER_UNAVAILABLE' })
})
