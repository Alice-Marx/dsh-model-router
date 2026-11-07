import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { buildRouterPackage, bundleRouterClient } from '../scripts/build-router-package.mjs'
import { assertRuntimeClosure } from '../scripts/check-package.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const parent = join(ROOT, 'tmp/integration/package-editions')
await mkdir(parent, { recursive: true })
const run = await mkdtemp(join(parent, 'run-'))
process.env.DSH_HOME = join(run, 'home')
const { apply, Config, inject } = await import('../.dsh-plugin/router-only.mjs')

test('full edition declares all independent-runtime files required by its Bot entry', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@ljwei-stak/dsh-model-route-bot')
  for (const name of ['index.mjs', 'remote-tools.mjs', 'workspace-tools.mjs']) {
    const path = `modules/independent-runtime/${name}`
    assert.ok(manifest.files.some(item => path === item || item.endsWith('/') && path.startsWith(item)), `Full edition must include ${path}`)
    assert.ok((await readFile(join(ROOT, path))).length > 0)
  }
})

test('router edition builds a self-contained Host and client without DS Bot or full-product dependencies', async () => {
  const report = await buildRouterPackage({ output: join(run, 'package') })
  assert.equal(report.name, '@ljwei-stak/dsh-model-router')
  assert.ok(!report.hostInputs.some(path => /modules\/bot-runtime|apps\/integration-client|independent-runtime/.test(path)))
  assert.ok(!report.clientInputs.some(path => /modules\/bot-runtime|apps\/integration-client/.test(path)))
  const manifest = JSON.parse(await readFile(join(report.output, 'package.json'), 'utf8'))
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies }
  for (const name of ['better-sqlite3', 'playwright', 'deep-view', '@modelcontextprotocol/server']) assert.equal(dependencies[name], undefined)
  assert.ok(dependencies['@lydell/node-pty'], 'routing terminal keeps its optional PTY backend')
  assert.equal(manifest.exports['./web-search'], undefined)
  const entries = await readdir(report.output)
  assert.ok(!entries.includes('modules') && !entries.includes('apps') && !entries.includes('remote-computer-agent'))
  const files = (await readdir(report.output, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
    .map(entry => relative(report.output, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  await assertRuntimeClosure({ root: report.output, files, manifest })
})

test('router-only client exports the correct package and only mounts the routing UI', async () => {
  const { code } = await bundleRouterClient()
  let definition
  new Function('window', code)({ __ModuleLoader__: { load(value) { definition = value } } })
  assert.equal(definition.id, '@ljwei-stak/dsh-model-router')
  const require = createRequire(import.meta.url)
  const client = definition.factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(name))
  assert.equal(client.ROUTER_PACKAGE, '@ljwei-stak/dsh-model-router')
  assert.equal(client.ROUTER_NAMESPACE, 'model-router-galgame')
  assert.deepEqual(client.inject, ['remote'])
  assert.equal(typeof client.apply, 'function')
})

test('router-only Host does not create Bot services or register Bot tools even if Bot flags are supplied', () => {
  const tools = [], commands = [], provided = [], lookups = []
  const ctx = { llm: {}, tools: { register: value => tools.push(value), guard() {} },
    commands: { register: value => commands.push(value) }, on() {},
    get(name) { lookups.push(name); return undefined }, provide(name) { provided.push(name) }, effect(callback) { return callback() } }
  apply(ctx, { ...Config({}), botProduct: true, independentRuntime: { enabled: true } })
  assert.ok(tools.some(tool => tool.name === 'model_router_plan'))
  assert.ok(tools.every(tool => tool.name.startsWith('model_router_')))
  assert.ok(commands.some(command => command.name === 'router'))
  assert.deepEqual(provided, [])
  assert.ok(!lookups.includes('sessionController'))
  assert.equal(Config.dict.botProduct, undefined)
  assert.equal(Config.dict.botRuntime, undefined)
  assert.ok(!inject.includes('sessions'))
})
