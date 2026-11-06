import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join, relative, dirname } from 'node:path'
import { buildRouterPackage } from './build-router-package.mjs'
import { assertRuntimeClosure } from './check-package.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const archive = process.argv[2] && resolve(process.argv[2])
if (!archive) throw new Error('Usage: node scripts/check-router-package.mjs <router-only.tgz>')
const parent = join(ROOT, 'tmp/integration/router-package-verification'); await mkdir(parent, { recursive: true })
const run = await mkdtemp(join(parent, 'run-'))
const expected = await buildRouterPackage({ output: join(run, 'expected') })
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const sources = [...new Set([...expected.hostInputs, ...expected.clientInputs,
  'scripts/build-router-package.mjs', 'packages/model-router-plugin/package.json',
  'packages/model-router-plugin/README.md', 'packages/model-router-plugin/README.zh.md',
  'packages/model-router-plugin/cordis.patch.yml', 'package.json', 'package-lock.json'])].filter(path => !path.startsWith('node_modules/'))
execFileSync('git', ['diff', '--exit-code', revision, '--', ...sources], { cwd: ROOT, stdio: 'pipe' })
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/)
assert.ok(entries.every(path => path.startsWith('package/') && !path.split(/[\\/]/).includes('..')))
execFileSync('tar', ['-xzf', archive, '-C', run])
const unpacked = join(run, 'package')
async function hashes(root) {
  const files = []
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await visit(path)
      else {
        assert.ok(entry.isFile(), 'Package contains a link or special file')
        const b = await readFile(path)
        files.push({ path: relative(root, path).replaceAll('\\', '/'), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') })
      }
    }
  }
  await visit(root)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}
const files = await hashes(unpacked)
assert.deepEqual(files, await hashes(expected.output), 'Router archive differs from a fresh source build')
assert.ok(files.every(file => !/^(?:modules\/|apps\/|remote-computer-agent\/)/.test(file.path)), 'Router archive contains the Bot product')
const manifest = JSON.parse(await readFile(join(unpacked, 'package.json'), 'utf8'))
assert.equal(manifest.name, '@ljwei-stak/dsh-model-router')
const runtime = await assertRuntimeClosure({ root: unpacked, files: files.map(file => file.path), manifest })
const b = await readFile(archive)
const result = { package: manifest.name, version: manifest.version, sourceRevision: revision, reproducibleFromSource: true,
  sourceFilesChecked: sources.length, filesVerified: files.length, runtimeFilesVerified: runtime.length,
  tarballBytes: b.length, sha256: createHash('sha256').update(b).digest('hex'), sha1: createHash('sha1').update(b).digest('hex'),
  integrity: 'sha512-' + createHash('sha512').update(b).digest('base64'), files }
await writeFile(join(dirname(archive), 'router-package-verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ ...result, files: result.files.length }))
