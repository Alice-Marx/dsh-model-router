import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'

const execute = promisify(execFile)
const fail = (code, diagnostic) => { throw Object.assign(new Error(code), { code, ...(diagnostic ? { diagnostic } : {}) }) }
const UNIT = /^[A-Za-z0-9_.@-]{1,120}\.service$/
const DIGEST = /^[a-f0-9]{64}$/

async function command(systemctl, args, { allow = [0], signal } = {}) {
  try {
    const { stdout, stderr } = await execute(systemctl, args, { timeout: 10000, windowsHide: true, maxBuffer: 65536, signal })
    return { code: 0, stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (error) {
    if (Number.isSafeInteger(error.code) && allow.includes(error.code)) return { code: error.code, stdout: error.stdout?.trim() ?? '', stderr: error.stderr?.trim() ?? '' }
    throw error
  }
}

async function maskState(name) {
  for (const root of ['/etc/systemd/system', '/run/systemd/system']) {
    try { if (await readlink(join(root, name)) === '/dev/null') return true }
    catch (error) { if (!['ENOENT', 'EINVAL'].includes(error?.code)) throw error }
  }
  return false
}

async function state(systemctl, name, signal) {
  const [enabled, active] = await Promise.all([
    maskState(name),
    command(systemctl, ['is-active', name], { allow: [0, 3, 4], signal }),
  ])
  return { enabled: enabled ? 'masked' : 'unmasked', active: active.stdout || (active.code === 4 ? 'inactive' : active.stdout) }
}

async function readFragment(path, name) {
  const canonical = await realpath(path).catch(() => null)
  if (!canonical || canonical !== path) return null
  const info = await lstat(canonical).catch(() => null)
  if (!info || !info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return null
  return { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') }
}

async function fragment(systemctl, name, signal) {
  const shown = await command(systemctl, ['show', name, '--property=FragmentPath', '--value'], { signal })
  const candidates = [...new Set([shown.stdout, `/run/systemd/transient/${name}`, `/run/systemd/system/${name}`, `/etc/systemd/system/${name}`, `/usr/lib/systemd/system/${name}`, `/lib/systemd/system/${name}`])]
  for (const path of candidates) {
    if (!isAbsolute(path)) continue
    const value = await readFragment(path, name)
    if (value) return value
  }
  fail('MIGRATION_SYSTEMD_UNIT_INVALID', { name, field: 'FragmentPath' })
}

async function input(systemctl, units) {
  if (process.platform !== 'linux') fail('MIGRATION_SYSTEMD_QUARANTINE_UNSUPPORTED')
  if (typeof systemctl !== 'string' || !isAbsolute(systemctl) || !Array.isArray(units) || units.length < 1 || units.length > 16) fail('MIGRATION_SYSTEMD_INPUT_INVALID')
  const canonical = await realpath(systemctl).catch(() => fail('MIGRATION_SYSTEMD_INPUT_INVALID'))
  const info = await lstat(canonical).catch(() => fail('MIGRATION_SYSTEMD_INPUT_INVALID'))
  if (!info.isFile() || info.isSymbolicLink()) fail('MIGRATION_SYSTEMD_INPUT_INVALID')
  const seen = new Set()
  for (const unit of units) {
    if (!unit || Object.keys(unit).some(key => !['name', 'fragmentSha256', 'fragmentPath'].includes(key)) || !UNIT.test(unit.name) || !DIGEST.test(unit.fragmentSha256) || (unit.fragmentPath !== undefined && !isAbsolute(unit.fragmentPath)) || seen.has(unit.name)) fail('MIGRATION_SYSTEMD_INPUT_INVALID')
    seen.add(unit.name)
  }
  return canonical
}

async function inspected(systemctl, units, signal, allowMissing = false) {
  const rows = []
  for (const unit of units) {
    let current
    try { current = await fragment(systemctl, unit.name, signal) }
    catch (error) {
      if (!allowMissing || error?.code !== 'MIGRATION_SYSTEMD_UNIT_INVALID' || !unit.fragmentPath) throw error
      current = { path: unit.fragmentPath, sha256: unit.fragmentSha256, missing: true }
    }
    if (current.sha256 !== unit.fragmentSha256) fail('MIGRATION_SYSTEMD_UNIT_CHANGED', { name: unit.name, expected: unit.fragmentSha256, actual: current.sha256 })
    rows.push({ ...unit, path: current.path })
  }
  return rows
}

export async function quarantineSystemdLaunchers({ systemctl = '/usr/bin/systemctl', units, signal } = {}) {
  const executable = await input(systemctl, units)
  const rows = await inspected(executable, units, signal)
  const quarantined = []
  try {
    for (const row of rows) {
      if (signal?.aborted) fail('MIGRATION_SYSTEMD_CANCELLED', { name: row.name })
      let current = await state(executable, row.name, signal)
      if (current.enabled !== 'masked') await command(executable, ['mask', row.name], { signal })
      current = await state(executable, row.name, signal)
      if (current.enabled !== 'masked') fail('MIGRATION_SYSTEMD_MASK_UNVERIFIED', { name: row.name, actual: current.enabled })
      if (current.active !== 'inactive') await command(executable, ['stop', row.name], { signal })
      const deadline = Date.now() + 10000
      do {
        current = await state(executable, row.name, signal)
        if (current.active === 'inactive') break
        if (Date.now() >= deadline) fail('MIGRATION_SYSTEMD_STOP_UNKNOWN', { name: row.name, actual: current.active })
        await sleep(50)
      } while (true)
      if (current.enabled !== 'masked') fail('MIGRATION_SYSTEMD_MASK_UNVERIFIED', { name: row.name, actual: current.enabled })
      quarantined.push({ name: row.name, fragmentSha256: row.fragmentSha256, fragmentPath: row.path, masked: true, inactive: true })
    }
  } catch (error) {
    if (!error.diagnostic) error.diagnostic = {}
    error.diagnostic.quarantined = quarantined
    throw error
  }
  return Object.freeze({ schemaVersion: 1, units: quarantined, declaredRestartBlocked: true, persistentDeclaredExclusion: true, externalRestartBlocked: false, persistentExternalExclusion: false, stopWriteProvable: false })
}

export async function releaseSystemdLaunchers({ systemctl = '/usr/bin/systemctl', units, signal } = {}) {
  const executable = await input(systemctl, units)
  const rows = await inspected(executable, units, signal, true)
  for (const row of rows) {
    const current = await state(executable, row.name, signal)
    if (current.enabled !== 'masked' || current.active !== 'inactive') fail('MIGRATION_SYSTEMD_RELEASE_BLOCKED', { name: row.name, ...current })
  }
  const released = []
  for (const row of rows) {
    await command(executable, ['unmask', row.name], { signal })
    const current = await state(executable, row.name, signal)
    if (current.enabled === 'masked') fail('MIGRATION_SYSTEMD_RELEASE_UNKNOWN', { name: row.name, released })
    released.push({ name: row.name, fragmentSha256: row.fragmentSha256, started: false })
  }
  return Object.freeze({ schemaVersion: 1, units: released, started: false, externalRestartBlocked: false, persistentExternalExclusion: false, stopWriteProvable: false })
}
