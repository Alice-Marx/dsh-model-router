import { build } from 'esbuild'
import { randomUUID } from 'node:crypto'
import { mkdir, lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve, relative } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('.', import.meta.url))
const output = resolve(root, 'dist')
assert.equal(relative(resolve(root), output), 'dist', 'Build output must remain in the Agent dist directory')
async function checkOutput() {
  const previous = await lstat(output).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  assert.ok(!previous?.isSymbolicLink(), 'Refusing to replace a linked build output')
  assert.ok(!previous || previous.isDirectory(), 'Agent build output must be a directory')
}
await checkOutput()

// Compile everything before touching the published build. Native tests run separate builders
// while other processes import or launch these entry points; deleting dist creates an ENOENT race.
const options = { absWorkingDir: root, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', sourcemap: true, write: false }
const main = await build({ ...options, entryPoints: ['src/index.ts', 'src/cli.ts'], outbase: 'src', outdir: 'dist', outExtension: { '.js': '.mjs' } })
const bridge = await build({ ...options, entryPoints: ['../packages/capability-broker/src/cli-stdio-bridge.mjs'], outfile: 'dist/cli-stdio-bridge.mjs' })
const files = [...main.outputFiles, ...bridge.outputFiles]
for (const helper of ['native-peer.ps1', 'native-peer.py']) {
  files.push({ path: join(output, helper), contents: await readFile(resolve(root, '../packages/cli-runtime/src', helper)) })
}
for (const [source, name] of [['vendor/LICENSE','OPENMAUSBOT_LICENSE'],['NOTICE','OPENMAUSBOT_NOTICE'],['SOURCE.json','OPENMAUSBOT_SOURCE.json']]) {
  files.push({ path: join(output, name), contents: await readFile(resolve(root, '../modules/openmaus-protocol', source)) })
}
for (const file of files) assert.equal(dirname(resolve(file.path)), output, 'Agent build files must remain directly inside dist')
await checkOutput()
await mkdir(output, { recursive: true })
const previousFiles = await readdir(output, { withFileTypes: true })
assert.ok(previousFiles.every(file => !file.isDirectory()), 'Unexpected directory in flat Agent build output')
for (const file of files) {
  const bytes = Buffer.from(file.contents)
  const previous = await readFile(file.path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (previous?.equals(bytes)) continue
  // Temporary files stay outside dist so another builder cannot prune or package them.
  const temporary = join(root, `.agent-build-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: bytes.subarray(0, 2).toString() === '#!' ? 0o755 : 0o644 })
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file.path); break }
      catch (error) {
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
        await sleep(50)
      }
    }
  } finally { await rm(temporary, { force: true }) }
}
const names = new Set(files.map(file => basename(file.path)))
for (const file of previousFiles) if (!names.has(file.name)) await rm(join(output, file.name), { force: true })
