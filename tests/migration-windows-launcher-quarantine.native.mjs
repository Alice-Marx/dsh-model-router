import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { quarantineWindowsLaunchers as quarantine, releaseWindowsLaunchers as release } from '../packages/orchestration/src/migration-windows-launcher-quarantine.mjs'

const execute = promisify(execFile)
const enabled = process.platform === 'win32'
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
const worker = resolve('tests/fixtures/migration-windows-launcher-writer.mjs')
const parent = resolve('tmp/integration/migration-windows-launcher-quarantine')
await mkdir(parent, { recursive: true })
const quote = value => `'${value.replaceAll("'", "''")}'`
async function command(script) {
  return execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
}
async function state(name) {
  const { stdout } = await command(`Get-ScheduledTask -TaskName ${quote(name)} -ErrorAction Stop | Select-Object -ExpandProperty State`)
  return stdout.trim()
}
async function digest(name) {
  const { stdout } = await command(`Export-ScheduledTask -TaskName ${quote(name)} -ErrorAction Stop`)
  return createHash('sha256').update(stdout).digest('hex')
}
async function wait(fn, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(50)
  }
  throw new Error('Windows scheduled task fixture did not reach the expected state')
}
async function fixture(t) {
  const dir = await mkdtemp(join(parent, 'case-')), name = `DSH-Migration-${randomUUID()}`, ready = join(dir, 'ready.json'), heartbeat = join(dir, 'heartbeat.log')
  await command(`$a=New-ScheduledTaskAction -Execute ${quote(process.execPath)} -Argument ${quote(`"${worker}" "${ready}" "${heartbeat}"`)}; $t=New-ScheduledTaskTrigger -AtLogOn; $p=New-ScheduledTaskPrincipal -UserId ${quote(`${process.env.USERDOMAIN}\\${process.env.USERNAME}`)} -LogonType Interactive -RunLevel Limited; Register-ScheduledTask -TaskName ${quote(name)} -Action $a -Trigger $t -Principal $p -Force | Out-Null`)
  t.after(async () => {
    await command(`Stop-ScheduledTask -TaskName ${quote(name)} -ErrorAction SilentlyContinue`).catch(() => {})
    await command(`Unregister-ScheduledTask -TaskName ${quote(name)} -Confirm:$false -ErrorAction SilentlyContinue`).catch(() => {})
  })
  return { dir, name, ready, heartbeat, tasks: [{ name, xmlSha256: await digest(name) }] }
}
const heartbeat = path => readFile(path, 'utf8').catch(() => '')
let capable = false, capabilityError = null
if (enabled) {
  const name = `DSH-Migration-Capability-${randomUUID()}`
  try {
    await command(`$a=New-ScheduledTaskAction -Execute ${quote(process.execPath)} -Argument '--version'; $t=New-ScheduledTaskTrigger -AtLogOn; $p=New-ScheduledTaskPrincipal -UserId ${quote(`${process.env.USERDOMAIN}\\${process.env.USERNAME}`)} -LogonType Interactive -RunLevel Limited; Register-ScheduledTask -TaskName ${quote(name)} -Action $a -Trigger $t -Principal $p -Force | Out-Null`)
    capable = true
  } catch (error) { capabilityError = String(error?.stderr ?? error) }
  await command(`Unregister-ScheduledTask -TaskName ${quote(name)} -Confirm:$false -ErrorAction SilentlyContinue`).catch(() => {})
}

test('migration Windows launcher quarantine: scheduled-task capability is explicit', t => {
  t.diagnostic(capable ? 'synthetic task registration is available' : `synthetic task registration is unavailable: ${capabilityError}`)
  assert.equal(typeof capable, 'boolean')
})

test('migration Windows launcher quarantine: non-Windows is explicitly unsupported', { skip: enabled }, async () => {
  await assert.rejects(quarantine({ tasks: [] }), { code: 'MIGRATION_WINDOWS_LAUNCHER_UNSUPPORTED' })
})

test('migration Windows launcher quarantine: a real AtLogOn writer is disabled and stopped, and release does not start it', { skip: !capable, timeout: 90000 }, async t => {
  const f = await fixture(t)
  await command(`Start-ScheduledTask -TaskName ${quote(f.name)} -ErrorAction Stop`)
  await wait(async () => (await heartbeat(f.heartbeat)).length > 0)
  assert.equal(await state(f.name), 'Running')
  const result = await quarantine({ tasks: f.tasks })
  assert.equal(result.declaredRestartBlocked, true)
  assert.equal(result.persistentDeclaredExclusion, true)
  assert.equal(result.stopWriteProvable, false)
  assert.equal(await state(f.name), 'Disabled')
  const before = await heartbeat(f.heartbeat)
  await assert.rejects(command(`Start-ScheduledTask -TaskName ${quote(f.name)} -ErrorAction Stop`))
  await sleep(400)
  assert.equal(await heartbeat(f.heartbeat), before)
  const released = await release({ tasks: f.tasks })
  assert.equal(released.started, false)
  assert.notEqual(await state(f.name), 'Disabled')
  await sleep(300)
  assert.equal(await heartbeat(f.heartbeat), before, 'enabling the AtLogOn definition does not start the old writer')
})

test('migration Windows launcher quarantine: an XML fingerprint mismatch refuses before disable or stop', { skip: !capable, timeout: 90000 }, async t => {
  const f = await fixture(t)
  await command(`Start-ScheduledTask -TaskName ${quote(f.name)} -ErrorAction Stop`)
  await wait(async () => (await heartbeat(f.heartbeat)).length > 0)
  await assert.rejects(quarantine({ tasks: [{ name: f.name, xmlSha256: '0'.repeat(64) }] }), { code: 'MIGRATION_WINDOWS_LAUNCHER_CHANGED' })
  assert.equal(await state(f.name), 'Running')
})
