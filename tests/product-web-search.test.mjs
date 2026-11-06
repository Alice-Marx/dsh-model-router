import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire, registerHooks } from 'node:module'
import { boot, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { resolverAnchor } from '../scripts/integration-upstream-tests.mjs'
import { legacyCombinedProfile } from '../scripts/integration-combined-host.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const PACKAGE = '@ljwei-stak/dsh-model-route-bot'
const SEARCH = `${PACKAGE}/web-search`
const bundle = loadOverlayPatches('web-search-config-test', join(ROOT, 'cordis.patch.yml'))
const fixtureHome = await mkdtemp(join(tmpdir(), 'web-search-config-'))
process.env.DSH_HOME = fixtureHome
const requireHere = createRequire(import.meta.url)
let webModule, hook
try { webModule = requireHere.resolve('@deepseek-ai/dsh-web') } catch {
  // An existing checkout can use its already-installed fixed SDK until the
  // newly declared dev dependency is installed. Clean installs use it directly.
  const { anchor } = await resolverAnchor(join(ROOT, 'tests/fixtures/integration-host'))
  webModule = createRequire(join(anchor, 'package.json')).resolve('@deepseek-ai/dsh-web')
}
const vendorUrl = pathToFileURL(join(ROOT, 'modules/bot-runtime/vendor/ds-bot')).href + '/'
hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === '@deepseek-ai/dsh-web' && context.parentURL?.startsWith(vendorUrl)
    ? pathToFileURL(webModule).href : specifier, context)
} })
const { default: WebRuntime } = await import(pathToFileURL(webModule).href)
test.after(() => hook.deregister())

// Actual rc.3 boot/Include/Loader activates the installed package export. The
// real WebRuntime registers the provider; neither network nor LLM is run.
async function mount(t, patches = []) {
  const dir = await mkdtemp(join(fixtureHome, 'profile-'))
  await mkdir(join(dir, 'node_modules/@ljwei-stak'), { recursive: true })
  await symlink(ROOT, join(dir, `node_modules/${PACKAGE}`), process.platform === 'win32' ? 'junction' : 'dir')
  const baseEntries = [{ id: 'web', name: 'cordis:web-fixture', config: { searchProvider: 'previous', fetchProvider: 'previous', discarded: true } }]
  const overlays = structuredClone([...bundle, { id: 'model-router-galgame', disabled: true }, ...patches])
  const configPath = join(dir, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(baseEntries))
  const root = await boot('web-search-config-test', configPath, overlays, async ctx => {
    ctx.loader.builtins['web-fixture'] = WebRuntime
  })
  t.after(() => root.fiber.dispose())
  const web = root.get('web')
  return { root, providers: web.searchProviders, web,
    config: () => Object.fromEntries(Object.entries(web.config).map(([key, value]) => [key, typeof value?.get === 'function' ? value.get() : value])),
    entry: id => [...root.loader.entries()].find(entry => entry.options.id === id) }
}

test('unified package publishes a precise search export and one Bot entry', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(manifest.exports['./web-search'], './modules/bot-runtime/web-search.mjs')
  assert.ok(manifest.files.includes('modules/bot-runtime/web-search.mjs'))
  assert.ok(manifest.files.includes('packages/orchestration/src/bot-runtime-config.mjs'))
  const entries = composeEntries([bundle])
  assert.equal(entries.filter(row => row.name === PACKAGE).length, 1)
  assert.equal(entries.filter(row => row.name === SEARCH).length, 1)
  assert.equal(entries.filter(row => row.name === 'ds-bot').length, 0)
})

test('historical combined fixture mounts frozen DS search and explicit MR body exactly once', () => {
  const legacy = loadOverlayPatches('web-search-config-test', join(ROOT, 'modules/bot-runtime/vendor/ds-bot/cordis.patch.yml'))
  const profile = legacyCombinedProfile(join(fixtureHome, 'offline-model.mjs'))
  assert.ok(profile.bundles.includes('ds-bot'))
  assert.ok(!profile.bundles.includes(PACKAGE), 'the historical fixture does not mount a second full product bundle')
  const entries = composeEntries([[{ insert: [{ id: 'web', name: 'cordis:web-fixture' }] }], legacy, profile.patches])
  assert.equal(entries.filter(row => row.id === 'bot').length, 1)
  const router = entries.filter(row => row.id === 'model-router-galgame')
  assert.equal(router.length, 1)
  assert.equal(router[0].name, PACKAGE)
  assert.equal(router[0].config.botProduct, false)
  const searches = entries.filter(row => row.id === 'web-search-auto')
  assert.equal(searches.length, 1)
  assert.equal(searches[0].name, 'ds-bot/web-search')
  assert.equal(entries.filter(row => row.name === SEARCH).length, 0)
  assert.equal(composeEntries([legacy, bundle]).filter(row => row.id === 'web-search-auto').length, 2,
    'production layers are not silently deduplicated by this fixture change')
})

test('actual rc.3 Loader mounts unified auto search without a request or another Bot runtime', async t => {
  const value = await mount(t)
  assert.equal(value.entry('web-search-auto').fiber?.state, 2)
  assert.equal(value.providers.get('auto')?.id, 'auto')
  assert.equal(value.providers.size, 1)
  assert.deepEqual(value.config(), { searchProvider: 'auto', fetchProvider: 'http' })
  assert.equal(value.entry('model-router-galgame').fiber, undefined)
})

test('actual Loader preserves user search settings and whole-config replacement', async t => {
  const value = await mount(t, [{ id: 'web', config: { searchProvider: 'user-provider', fetchProvider: 'user-fetch', custom: true } },
    { id: 'web-search-auto', name: SEARCH, config: { native: false, fallback: false, engines: [] } }])
  assert.deepEqual(value.config(), { searchProvider: 'user-provider', fetchProvider: 'user-fetch', custom: true })
  assert.deepEqual(value.entry('web-search-auto').fiber.config, { native: false, fallback: false, engines: [] })
  assert.equal(value.providers.size, 1)
})

test('actual Loader honors explicit auto disable with a replacement search provider', async t => {
  const value = await mount(t, [{ id: 'web', config: { searchProvider: 'user-provider', fetchProvider: 'http' } },
    { id: 'web-search-auto', name: SEARCH, disabled: true }])
  assert.equal(value.providers.size, 0)
  assert.equal(value.entry('web-search-auto').fiber, undefined)
  assert.equal(value.config().searchProvider, 'user-provider')
})

test('actual Include rejects a stale legacy name assertion instead of disabling the new provider', async t => {
  const value = await mount(t, [{ id: 'web-search-auto', name: 'ds-bot/web-search', disabled: true }])
  assert.equal(value.entry('web-search-auto').fiber?.state, 2)
  assert.equal(value.providers.has('auto'), true)
})

test('disabling auto while still selecting it remains an explicit SDK error', async t => {
  const value = await mount(t, [{ id: 'web-search-auto', name: SEARCH, disabled: true }])
  await assert.rejects(value.web.search({ query: 'must not leave fixture', maxResults: 1 }), { code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  assert.equal(value.config().searchProvider, 'auto', 'no implicit provider replacement or request')
})

test('SDK name is an assertion and config replaces the whole object without mutating input', () => {
  const original = [{ insert: [{ id: 'web', name: 'cordis:web-fixture', config: { old: 1, retained: 2 } }] }]
  const before = structuredClone(original), warnings = []
  assert.deepEqual(composeEntries([original, [{ id: 'web', config: { next: 3 } }]])[0].config, { next: 3 })
  assert.deepEqual(composeEntries([original, [{ id: 'web', name: 'wrong-name', config: { next: 3 } }]], warning => warnings.push(warning))[0].config,
    { old: 1, retained: 2 })
  assert.match(warnings.join('\n'), /name|mismatch/)
  assert.deepEqual(original, before)
})

test('preview parsing preserves !!js as data and never evaluates it', async () => {
  const path = join(fixtureHome, 'expression.patch.yml')
  await writeFile(path, '- id: web\n  config:\n    future: !!js "(() => { throw new Error(\'must not run\') })()"\n')
  const value = loadOverlayPatches('web-search-config-test', path)
  assert.match(value[0].config.future.__jsExpr, /must not run/)
  const entries = composeEntries([[{ insert: [{ id: 'web', name: 'cordis:web-fixture' }] }], value])
  assert.deepEqual(entries[0].config.future, value[0].config.future)
})
