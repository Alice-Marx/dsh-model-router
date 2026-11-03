import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNoInclusionTransaction, validateIncludedIncrements, validateIncludedRegressionEvidence } from './integration-progress.mjs'

const HASH = /^[0-9a-f]{64}$/
const portable = path => typeof path === 'string' && path && !path.includes('\\')
  && !path.includes(':') && !path.split('/').some(part => !part || part === '.' || part === '..')

export async function verifyProductSource(root = resolve(import.meta.dirname, '../modules/bot-runtime')) {
  const project = resolve(root, '../..')
  await assertNoInclusionTransaction(project)
  const [baseline, inventory, includedIncrements] = await Promise.all([
    'baseline.json', 'feature-inventory.json', 'included-increments.json',
  ].map(async file => JSON.parse(await readFile(join(project, 'docs/integration', file), 'utf8'))))
  const ledger = validateIncludedIncrements({ baseline, inventory, includedIncrements })
  await validateIncludedRegressionEvidence(project, includedIncrements)
  const manifestPath = join(root, 'SOURCE.json'), info = await lstat(manifestPath)
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'DS SOURCE must be a regular non-link file')
  const manifestBytes = await readFile(manifestPath), manifest = JSON.parse(manifestBytes)
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.commit, ledger.current.DS, 'DS SOURCE commit differs from the ledgered baseline')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'DS SOURCE files must be non-empty')
  const latest = includedIncrements.increments.filter(item => item.sourceRepository === 'DS').at(-1)
  if (latest) {
    const migration = latest.review.dsMigration
    assert.ok(migration && migration.vendorSource === 'candidate'
      && ['required', 'none'].includes(migration.status), 'Ledgered DS SOURCE migration review is missing')
    for (const side of ['before', 'after']) assert.ok(HASH.test(migration[side]?.manifestSha256 ?? '')
      && Number.isInteger(migration[side]?.fileCount) && migration[side].fileCount > 0, `DS ${side} manifest binding is invalid`)
    assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), migration.after.manifestSha256, 'DS SOURCE differs from the approved after-manifest')
    assert.equal(manifest.files.length, migration.after.fileCount, 'DS SOURCE count differs from the approved after-manifest')
  }
  for (const file of manifest.files) {
    assert.ok(portable(file.path) && file.path.startsWith('vendor/ds-bot/') && portable(file.sourcePath), 'Invalid DS SOURCE path')
    const mapped = file.sourcePath === 'LICENSE' ? 'vendor/ds-bot/UPSTREAM_LICENSE'
      : file.sourcePath === 'NOTICE' ? 'vendor/ds-bot/UPSTREAM_NOTICE' : `vendor/${file.sourcePath}`
    assert.equal(file.path, mapped, 'DS SOURCE path mapping differs')
    assert.ok(HASH.test(file.sha256) && /^[0-9a-f]{40}$/.test(file.gitBlob), 'Invalid DS SOURCE hash')
  }
  const expected = new Set(manifest.files.map(file => file.path))
  assert.equal(expected.size, manifest.files.length, 'Duplicate DS SOURCE paths')
  const walk = async path => {
    const info = await lstat(path)
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), `DS vendor directory must be non-linked: ${path}`)
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const item = join(path, entry.name)
      const current = await lstat(item)
      assert.ok(!current.isSymbolicLink(), `Linked vendor entry: ${item}`)
      if (current.isDirectory()) await walk(item)
      else {
        assert.ok(current.isFile(), `Non-regular vendor entry: ${item}`)
        assert.ok(expected.has(relative(root, item).replaceAll('\\', '/')), `Untracked vendor file: ${item}`)
      }
    }
  }
  await walk(join(root, 'vendor'))
  for (const file of manifest.files) {
    const bytes = await readFile(join(root, file.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Frozen source changed: ${file.path}`)
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), file.gitBlob, `Frozen Git blob changed: ${file.path}`)
  }
  return { status: 'passed', files: manifest.files.length, frozenCommit: manifest.commit }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await verifyProductSource())}\n`)
}
