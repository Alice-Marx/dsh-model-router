import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

/** Prefix of the private temp files the pinned writer creates. */
export const TEMP_PREFIX = '.dsh-pinned-write-'

/** Isolated workspace for this step; never touches user data. */
export const stepRoot = () => resolve('tmp/integration/step-pinned-write')

/** Create a fresh case directory under the step workspace. */
export async function caseDir(name) {
  const base = join(stepRoot(), name)
  await mkdir(base, { recursive: true })
  return await mkdtemp(join(base, 'case-'))
}

export async function names(dir) { return (await readdir(dir)).sort() }

/** Assert that a write left none of its own private temp files behind. */
export async function assertNoPinnedTemps(...dirs) {
  for (const dir of dirs) for (const name of await names(dir)) assert.ok(!name.startsWith(TEMP_PREFIX), `unexpected private temp file ${name} left in ${dir}`)
}

export async function identity(target) { const s = await stat(target); return `${s.dev}:${s.ino}` }
export const digest = data => createHash('sha256').update(data).digest('hex')

/**
 * Single-use two-way barrier.
 *
 * The hook calls `hold()` to report arrival and then blocks; the test observes
 * the parked state, performs its hostile action, and calls `release()`.
 */
export function barrier() {
  let announce = null
  const arrived = new Promise(resolve => { announce = resolve })
  let resume = null
  const proceed = new Promise(resolve => { resume = resolve })
  return {
    arrived,
    async hold() { announce(); await proceed },
    release() { resume() }
  }
}

/** Reject with a specific component error code, reporting what was received. */
export async function rejectsWith(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, code, `expected ${code} but received ${error?.code ?? error}`)
    return true
  })
}
