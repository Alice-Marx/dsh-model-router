import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
