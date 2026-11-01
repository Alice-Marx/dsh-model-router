import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'

const execute = promisify(execFile)
const fail = (code, details) => { throw Object.assign(new Error(code), { code, ...(details ? { details } : {}) }) }
const NAME = /^[A-Za-z0-9_.-]{1,120}$/
const DIGEST = /^[a-f0-9]{64}$/

async function command(powershell, script, signal) {
  return execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, signal })
}
async function input(powershell, tasks) {
  if (process.platform !== 'win32') fail('MIGRATION_WINDOWS_LAUNCHER_UNSUPPORTED')
  if (typeof powershell !== 'string' || !isAbsolute(powershell) || !Array.isArray(tasks) || tasks.length < 1 || tasks.length > 32) fail('MIGRATION_WINDOWS_LAUNCHER_INPUT')
  const executable = await realpath(powershell).catch(() => fail('MIGRATION_WINDOWS_LAUNCHER_INPUT'))
  const info = await lstat(executable).catch(() => fail('MIGRATION_WINDOWS_LAUNCHER_INPUT'))
  if (!info.isFile() || info.isSymbolicLink()) fail('MIGRATION_WINDOWS_LAUNCHER_INPUT')
  const seen = new Set()
  for (const task of tasks) {
    if (!task || Object.keys(task).some(key => !['name', 'xmlSha256'].includes(key)) || !NAME.test(task.name ?? '') || !DIGEST.test(task.xmlSha256 ?? '') || seen.has(task.name)) fail('MIGRATION_WINDOWS_LAUNCHER_INPUT')
    seen.add(task.name)
  }
  return executable
}
async function inspect(powershell, task, signal, checkDigest = true) {
  const { stdout } = await command(powershell, `$t=Get-ScheduledTask -TaskName '${task.name}' -ErrorAction Stop; $x=Export-ScheduledTask -TaskName '${task.name}' -ErrorAction Stop; [pscustomobject]@{state=[string]$t.State;xml=$x} | ConvertTo-Json -Compress`, signal)
  let current
  try { current = JSON.parse(stdout) } catch { fail('MIGRATION_WINDOWS_LAUNCHER_STATE_INVALID', { name: task.name }) }
  if (typeof current.state !== 'string' || typeof current.xml !== 'string') fail('MIGRATION_WINDOWS_LAUNCHER_STATE_INVALID', { name: task.name })
  const xmlSha256 = createHash('sha256').update(current.xml).digest('hex')
  if (checkDigest && xmlSha256 !== task.xmlSha256) fail('MIGRATION_WINDOWS_LAUNCHER_CHANGED', { name: task.name, expected: task.xmlSha256, actual: xmlSha256 })
  return { name: task.name, state: current.state, xmlSha256 }
}
async function inspected(powershell, tasks, signal) {
  const rows = []
  for (const task of tasks) rows.push(await inspect(powershell, task, signal))
  return rows
}

export async function quarantineWindowsLaunchers({ powershell = joinSystemPowerShell(), tasks, signal } = {}) {
  const executable = await input(powershell, tasks)
  const rows = await inspected(executable, tasks, signal)
  const quarantined = []
  for (const row of rows) {
    if (signal?.aborted) fail('MIGRATION_WINDOWS_LAUNCHER_CANCELLED', { quarantined })
    if (row.state !== 'Disabled') await command(executable, `Disable-ScheduledTask -TaskName '${row.name}' -ErrorAction Stop | Out-Null`, signal)
    let current = await inspect(executable, row, signal, false)
    if (current.state === 'Running') await command(executable, `Stop-ScheduledTask -TaskName '${row.name}' -ErrorAction Stop`, signal)
    const deadline = Date.now() + 10000
    do {
      current = await inspect(executable, row, signal, false)
      if (current.state === 'Disabled') break
      if (Date.now() >= deadline) fail('MIGRATION_WINDOWS_LAUNCHER_STOP_UNKNOWN', { name: row.name, state: current.state, quarantined })
      await sleep(50)
    } while (true)
    quarantined.push({ name: row.name, xmlSha256: row.xmlSha256, disabled: true, stopped: true })
  }
  return Object.freeze({ schemaVersion: 1, tasks: quarantined, declaredRestartBlocked: true, persistentDeclaredExclusion: true, externalRestartBlocked: false, persistentExternalExclusion: false, stopWriteProvable: false })
}

export async function releaseWindowsLaunchers({ powershell = joinSystemPowerShell(), tasks, signal } = {}) {
  const executable = await input(powershell, tasks)
  const rows = await inspected(executable, tasks, signal)
  for (const row of rows) if (row.state !== 'Disabled') fail('MIGRATION_WINDOWS_LAUNCHER_RELEASE_BLOCKED', { name: row.name, state: row.state })
  const released = []
  for (const row of rows) {
    await command(executable, `Enable-ScheduledTask -TaskName '${row.name}' -ErrorAction Stop | Out-Null`, signal)
    const current = await inspect(executable, row, signal, false)
    if (current.state === 'Disabled') fail('MIGRATION_WINDOWS_LAUNCHER_RELEASE_UNKNOWN', { name: row.name, released })
    released.push({ name: row.name, xmlSha256: row.xmlSha256, started: false })
  }
  return Object.freeze({ schemaVersion: 1, tasks: released, started: false, externalRestartBlocked: false, persistentExternalExclusion: false, stopWriteProvable: false })
}

function joinSystemPowerShell() {
  return process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
}
