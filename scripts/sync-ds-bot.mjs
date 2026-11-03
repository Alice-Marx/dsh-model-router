import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(import.meta.dirname, '..')
// Inside the DS Bot repository the sibling checkout is the source of truth. This package also
// ships on its own (its own git repository, no ../ds-bot): there the vendored tree and its
// recorded SOURCE.json are the source, and only their integrity can be checked.
const REPOSITORY = (() => {
  try { return execFileSync('git', ['-C', PROJECT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim() }
  catch { return resolve(PROJECT, '..') }
})()
const SOURCE = join(REPOSITORY, 'ds-bot')
const SOURCE_FILE = join(PROJECT, 'modules/bot-runtime/SOURCE.json')
const RUNTIME = join(PROJECT, 'modules/bot-runtime')
const VENDOR = join(RUNTIME, 'vendor/ds-bot')
const excluded = new Set(['node_modules', 'harness'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

async function files(root, base = root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await files(path, base))
    else if (entry.isFile()) result.push(relative(base, path).replaceAll('\\', '/'))
  }
  return result.sort()
}

const hasSource = () => existsSync(join(SOURCE, 'package.json'))
const recorded = async () => JSON.parse(await readFile(SOURCE_FILE, 'utf8'))

async function manifest(commitOverride) {
  const commit = commitOverride ?? (hasSource()
    ? execFileSync('git', ['-C', REPOSITORY, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    : (await recorded()).commit)
  const records = []
  for (const path of await files(VENDOR)) {
    const bytes = await readFile(join(VENDOR, path))
    const sourcePath = path === 'UPSTREAM_LICENSE' ? 'LICENSE' : path === 'UPSTREAM_NOTICE' ? 'NOTICE' : `ds-bot/${path}`
    records.push({ path: `vendor/ds-bot/${path}`, sourcePath, sha256: digest(bytes), gitBlob: blob(bytes) })
  }
  return { schemaVersion: 1, repository: 'https://github.com/Fei2411/DS-Bot', commit, license: 'Apache-2.0', files: records }
}

export async function syncDsBot({ check = false } = {}) {
  if (!check && hasSource()) {
    const temporary = `${VENDOR}.next`
    await rm(temporary, { recursive: true, force: true })
    await mkdir(dirname(temporary), { recursive: true })
    await cp(SOURCE, temporary, { recursive: true, filter: source => ![...excluded].some(name => source.split(/[\\/]/).includes(name)) })
    await cp(join(SOURCE, 'LICENSE'), join(temporary, 'UPSTREAM_LICENSE'))
    await cp(join(REPOSITORY, 'NOTICE'), join(temporary, 'UPSTREAM_NOTICE'))
    await rm(VENDOR, { recursive: true, force: true })
    await cp(temporary, VENDOR, { recursive: true })
    await rm(temporary, { recursive: true, force: true })
  }
  const current = await recorded()
  const next = await manifest(current.commit)
  if (check) {
    assert.deepEqual(current, next, 'The vendored DS Bot source or SOURCE.json is stale')
    for (const file of next.files) {
      if (!hasSource()) break
      if (file.sourcePath === 'LICENSE' || file.sourcePath === 'NOTICE') continue
      const source = await readFile(join(REPOSITORY, file.sourcePath))
      assert.equal(digest(source), file.sha256, `DS Bot source is stale: ${file.sourcePath}`)
    }
    return { status: 'passed', files: next.files.length, commit: next.commit }
  }
  await writeFile(join(RUNTIME, 'SOURCE.json'), `${JSON.stringify(next, null, 2)}\n`)
  return { status: 'synced', files: next.files.length, commit: next.commit }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await syncDsBot({ check: process.argv.includes('--check') })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
