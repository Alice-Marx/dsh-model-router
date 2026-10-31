import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function verifyProductSource(root = resolve(import.meta.dirname, '../modules/bot-runtime')) {
  const manifest = JSON.parse(await readFile(join(root, 'SOURCE.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.commit, 'de55888a93983fc51c94f7d22bc94b4f8293205d')
  const expected = new Set(manifest.files.map(file => file.path))
  const walk = async path => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const item = join(path, entry.name)
      if (entry.isDirectory()) await walk(item)
      else assert.ok(expected.has(relative(root, item).replaceAll('\\', '/')), `Untracked vendor file: ${item}`)
    }
  }
  await walk(join(root, 'vendor'))
  for (const file of manifest.files) {
    assert.ok(file.path.startsWith('vendor/ds-bot/') && !file.path.includes('..'))
    const bytes = await readFile(join(root, file.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Frozen source changed: ${file.path}`)
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), file.gitBlob, `Frozen Git blob changed: ${file.path}`)
  }
  return { status: 'passed', files: manifest.files.length, frozenCommit: manifest.commit }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await verifyProductSource())}\n`)
}
