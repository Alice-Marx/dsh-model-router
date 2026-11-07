// The native task specs run on plain Node with one verified dependency: a pinned
// better-sqlite3 in tmp/, kept out of the package on purpose. A fresh clone does
// not have it, so preparing it is an explicit, idempotent step rather than a
// surprise download in the middle of a test run.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DRIVER_DIR = join(ROOT, 'tmp/integration/probes/sqlite')
export const DRIVER_MANIFEST = join(DRIVER_DIR, 'node_modules/better-sqlite3/package.json')
export const DRIVER_ENTRY = join(DRIVER_DIR, 'node_modules/better-sqlite3/lib/index.js')
const PINNED = '13.0.3'

export function driverState() {
  if (!existsSync(DRIVER_MANIFEST)) return { present: false, version: null }
  try {
    const manifest = JSON.parse(readFileSync(DRIVER_MANIFEST, 'utf8'))
    return { present: manifest.name === 'better-sqlite3', version: manifest.version ?? null }
  } catch { return { present: false, version: null } }
}

/** What a person should type when the driver is missing; used by the probe's error. */
export function prepareHint() {
  return `The verified native driver is missing (${DRIVER_MANIFEST}).\nPrepare it once with:\n  node scripts/prepare-native-driver.mjs`
}

export function prepareNativeDriver({ force = false } = {}) {
  const state = driverState()
  if (state.present && state.version === PINNED && !force) return { status: 'unchanged', version: state.version, entry: DRIVER_ENTRY }
  mkdirSync(DRIVER_DIR, { recursive: true })
  execFileSync(process.execPath, [resolve(ROOT, 'node_modules/npm/bin/npm-cli.js'), 'install',
    `better-sqlite3@${PINNED}`, '--no-save', '--no-audit', '--no-fund', '--prefix', DRIVER_DIR], {
    cwd: DRIVER_DIR, stdio: 'inherit', windowsHide: true,
  })
  const after = driverState()
  if (!after.present || after.version !== PINNED) throw new Error(`prepared driver is ${after.version ?? 'absent'}, expected ${PINNED}`)
  return { status: 'installed', version: after.version, entry: DRIVER_ENTRY }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareNativeDriver({ force: process.argv.includes('--force') })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
