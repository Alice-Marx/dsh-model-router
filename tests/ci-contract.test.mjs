import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assertRuntimeClosure } from '../scripts/check-package.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'router-package-closure-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = { name: '@fixture/router', version: '1.0.0', type: 'module', main: './runtime/index.mjs',
    exports: { '.': { import: './runtime/index.mjs' }, './client': './client.js' },
    dsh: { bundle: { patch: './cordis.patch.yml' } }, files: ['runtime/index.mjs', 'client.js', 'cordis.patch.yml', 'README.md'] }
  await mkdir(join(root, 'runtime'))
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'runtime', 'index.mjs'), "import { value } from './dependency.mjs'; export { value }; export const load = () => import('./lazy.mjs')\n")
  await writeFile(join(root, 'runtime', 'dependency.mjs'), 'export const value = 42\n')
  await writeFile(join(root, 'runtime', 'lazy.mjs'), "export { value } from './dependency.mjs'\n")
  const files = ['package.json', 'runtime/index.mjs', 'runtime/dependency.mjs', 'runtime/lazy.mjs', 'client.js', 'cordis.patch.yml', 'README.md']
  return { root, manifest, files }
}

test('package closure follows static and literal dynamic imports without executing modules', async t => {
  const options = await fixture(t)
  await writeFile(join(options.root, 'runtime', 'lazy.mjs'), "throw new Error('verification must not execute runtime code'); export { value } from './dependency.mjs'\n")
  assert.deepEqual(await assertRuntimeClosure(options), ['runtime/dependency.mjs', 'runtime/index.mjs', 'runtime/lazy.mjs'])
})

test('package closure rejects an omitted transitive runtime module', async t => {
  const options = await fixture(t)
  options.files = options.files.filter(path => path !== 'runtime/dependency.mjs')
  await assert.rejects(assertRuntimeClosure(options), /missing runtime dependency: runtime\/dependency\.mjs/)
})

test('package closure rejects missing conditional exports, patch and declared documentation', async t => {
  const options = await fixture(t)
  for (const missing of ['client.js', 'cordis.patch.yml', 'README.md']) {
    await assert.rejects(assertRuntimeClosure({ ...options, files: options.files.filter(path => path !== missing) }),
      error => error.message === `Package is missing declared file: ${missing}`)
  }
})

test('package closure rejects a relative module outside the source package', async t => {
  const options = await fixture(t)
  const siblingName = `${options.root.split(/[\\/]/).at(-1)}-outside.mjs`
  const outside = join(options.root, '..', siblingName)
  t.after(() => rm(outside, { force: true }))
  await writeFile(outside, 'export const outside = 1\n')
  await writeFile(join(options.root, 'runtime', 'index.mjs'), `export { outside } from '../../${siblingName}'\n`)
  await assert.rejects(assertRuntimeClosure(options), /Runtime import is outside the package/)
})

test('package closure requires both native peer scripts when the runtime launches them', async t => {
  const options = await fixture(t)
  const dir = join(options.root, 'packages', 'cli-runtime', 'src')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'native-process.mjs'), 'export const native = true\n')
  await writeFile(join(options.root, 'runtime', 'index.mjs'), "export { native } from '../packages/cli-runtime/src/native-process.mjs'\n")
  const runtime = 'packages/cli-runtime/src/native-process.mjs'
  const peers = ['packages/cli-runtime/src/native-peer.ps1', 'packages/cli-runtime/src/native-peer.py']
  options.files.push(runtime, ...peers)
  await assertRuntimeClosure(options)
  for (const peer of peers) {
    await assert.rejects(assertRuntimeClosure({ ...options, files: options.files.filter(path => path !== peer) }),
      error => error.message === `Package is missing native runtime dependency: ${peer}`)
  }
})

async function assetFixture(t, entry, content) {
  const root = await mkdtemp(join(tmpdir(), 'router-runtime-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = { name: '@fixture/closure', version: '1.0.0', type: 'module', main: `./${entry}` }
  const files = ['package.json', entry]
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  const write = async (path, bytes, packed = true) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), bytes)
    if (packed && !files.includes(path)) files.push(path)
  }
  await write(entry, content)
  return { root, manifest, files, write }
}

test('closure rejects an omitted bootstrap-launched stdio bridge', async t => {
  const options = await assetFixture(t, 'packages/capability-broker/src/cli-bootstrap.mjs',
    "export const bridge = new URL('./cli-stdio-bridge.mjs', import.meta.url)\n")
  await options.write('packages/capability-broker/src/cli-stdio-bridge.mjs', 'export const stdio = true\n', false)
  await assert.rejects(assertRuntimeClosure(options), /missing launched runtime dependency: packages\/capability-broker\/src\/cli-stdio-bridge\.mjs/)
})

test('closure follows imports of the separately launched bridge without executing it', async t => {
  const options = await assetFixture(t, 'packages/capability-broker/src/cli-bootstrap.mjs',
    "export const bridge = new URL('./cli-stdio-bridge.mjs', import.meta.url)\n")
  await options.write('packages/capability-broker/src/cli-stdio-bridge.mjs',
    "throw Error('must not execute'); export { value } from './bridge-dependency.mjs'\n")
  await options.write('packages/capability-broker/src/bridge-dependency.mjs', 'export const value = 1\n', false)
  await assert.rejects(assertRuntimeClosure(options), /missing runtime dependency: packages\/capability-broker\/src\/bridge-dependency\.mjs/)
  options.files.push('packages/capability-broker/src/bridge-dependency.mjs')
  const closure = await assertRuntimeClosure(options)
  assert.ok(closure.includes('packages/capability-broker/src/cli-stdio-bridge.mjs'))
  assert.ok(closure.includes('packages/capability-broker/src/bridge-dependency.mjs'))
})

test('closure requires the separately launched managed-terminal helper', async t => {
  const options = await assetFixture(t, 'packages/cli-runtime/src/native-terminal.mjs', 'export const terminal = true\n')
  await options.write('packages/cli-runtime/src/native-terminal-peer.ps1', '# fixture helper\n', false)
  await assert.rejects(assertRuntimeClosure(options), /missing launched runtime dependency: packages\/cli-runtime\/src\/native-terminal-peer\.ps1/)
})

test('closure rejects dev-only bare runtime imports and accepts production peers or optionals', async t => {
  const options = await assetFixture(t, 'runtime.mjs', "import '@fixture/runtime/stdio'; export const ready = true\n")
  options.manifest.devDependencies = { '@fixture/runtime': '1.0.0' }
  await assert.rejects(assertRuntimeClosure(options), /Runtime external dependency is not declared for production: @fixture\/runtime/)
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    options.manifest[section] = { '@fixture/runtime': '1.0.0' }
    await assertRuntimeClosure(options)
    delete options.manifest[section]
  }
})

test('closure checks external dependencies imported only by the launched bridge', async t => {
  const options = await assetFixture(t, 'packages/capability-broker/src/cli-bootstrap.mjs',
    "export const bridge = new URL('./cli-stdio-bridge.mjs', import.meta.url)\n")
  await options.write('packages/capability-broker/src/cli-stdio-bridge.mjs',
    "import '@modelcontextprotocol/server/stdio'; export const stdio = true\n")
  await assert.rejects(assertRuntimeClosure(options), /Runtime external dependency is not declared for production: @modelcontextprotocol\/server/)
  options.manifest.dependencies = { '@modelcontextprotocol/server': '2.4.0' }
  await assertRuntimeClosure(options)
})
