import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { launchMigrationProcessTree as launch } from '../packages/orchestration/src/migration-os-quarantine.mjs'

const enabled = process.platform === 'win32'
const real = (name, fn) => test(name, { skip: !enabled, timeout: 45000 }, fn)
const writer = resolve('tests/fixtures/migration-sdk-loader-writer.mjs')
const installAnchor = resolve('node_modules/@deepseek-ai/dsh-app-boot/package.json')
const parent = resolve('tmp/integration/migration-sdk-loader-quarantine')
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
  throw new Error('Owned SDK loader fixture did not reach the expected state')
}
const tick = async path => (await json(path))?.syntheticTick ?? 0

test('migration SDK loader quarantine: non-Windows platforms are explicitly unsupported', { skip: enabled }, async () => {
  await assert.rejects(launch({ operationId: 'op-unsupported' }), { code: 'MIGRATION_OS_QUARANTINE_UNSUPPORTED' })
})

real('migration SDK loader quarantine: the real profile loader rewrites a retired bundle under a pending gate until the Job stops it', async t => {
  const { runner } = await compiled(), dir = await mkdtemp(join(parent, 'case-')), ready = join(dir, 'ready.json'), manifest = join(dir, 'package.json')
  await writeFile(join(dir, 'migration-gate.json'), JSON.stringify({ schemaVersion: 1, kind: 'profile-migration-gate', phase: 'maintenance' }))
  const handle = await launch({ runner, executable: process.execPath, args: [writer, dir, ready, installAnchor], cwd: dir, operationId: 'op-sdk-loader' })
  t.after(async () => { if (!handle.snapshot().wrapperClosed) await handle.stop().catch(() => {}) })
  const observed = await wait(() => json(ready))
  assert.equal(observed.layers, 0)
  await wait(async () => (await tick(manifest)) > observed.syntheticTick)
  const result = await handle.stop()
  assert.equal(result.treeStopped, true)
  assert.equal(result.stopWriteProvable, false)
  const stopped = await tick(manifest)
  await sleep(500)
  assert.equal(await tick(manifest), stopped, 'the real SDK loader no longer rewrites the profile after the Windows Job fence')
  const saved = await json(manifest)
  assert.deepEqual(saved.dsh.profile.bundles, [], 'the real dropRetiredBundles path removed the retired bundle on every write')
})
