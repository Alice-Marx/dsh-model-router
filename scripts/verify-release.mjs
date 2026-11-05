import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, relative } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const tarball = process.argv[2] && resolve(process.argv[2])
const revision = process.argv[3] || 'HEAD'
if (!tarball) throw new Error('Usage: node scripts/verify-release.mjs <npm-tarball.tgz> [git-revision]')
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, maxBuffer: 256 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr?.toString()}`)
  return result.stdout
}
const entries = run('tar', ['-tzf', tarball]).toString().trim().split(/\r?\n/)
assert.ok(entries.every(entry => entry.startsWith('package/') && !entry.split(/[\\/]/).includes('..')), 'Archive has unexpected paths')
const temp = await mkdtemp(join(tmpdir(), 'model-router-release-verify-'))
run('tar', ['-xzf', tarball, '-C', temp])
const packageRoot = join(temp, 'package')
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const files = []
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await visit(path)
    else {
      assert.ok(entry.isFile(), 'Package must not contain symlinks')
      const name = relative(packageRoot, path).replaceAll('\\', '/')
      const payload = await readFile(path)
      const committed = run('git', ['cat-file', 'blob', `${revision}:${name}`])
      assert.equal(sha256(payload), sha256(committed), `npm payload differs from ${revision}: ${name}`)
      files.push({ path: name, bytes: payload.length, sha256: sha256(payload) })
    }
  }
}
await visit(packageRoot)
const bytes = await readFile(tarball)
console.log(JSON.stringify({ package: manifest.name, version: manifest.version, revision, filesVerified: files.length, tarballBytes: (await stat(tarball)).size, sha1: createHash('sha1').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), files }, null, 2))
