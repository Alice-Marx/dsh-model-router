import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { previewProfileMigration, summarizeProfileMigration, verifyProfileMigrationSources } from '../packages/orchestration/src/profile-migration-plan.mjs'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const PRODUCT = '@ljwei-stak/dsh-model-route-bot', MR = 'model-router-galgame', AUTO = 'web-search-auto'
const json = value => JSON.stringify(value, null, 2) + '\n'
const ROOT = resolve(import.meta.dirname, '..')
const find = (entries, id) => {
  for (const entry of entries) {
    if (entry.id === id) return entry
    if (Array.isArray(entry.config)) { const nested = find(entry.config, id); if (nested) return nested }
  }
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'profile-migration-plan-'))
  const home = join(dir, 'home'), profile = join(home, 'profiles/test'), cwd = join(dir, '原 cwd')
  await mkdir(profile, { recursive: true }); await mkdir(cwd)
  async function bundle(folder, packageName, patches, extra = {}) {
    const packageDir = join(dir, folder)
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), json({ name: packageName, version: '0.25.6-preview.1', dsh: { bundle: { patch: './cordis.patch.yml' } }, ...extra }))
    await writeFile(join(packageDir, 'cordis.patch.yml'), typeof patches === 'string' ? patches : json(patches))
    return { packageName, packageDir }
  }
  const base = await bundle('base', '@fixture/base', [{ insert: [{ id: 'web', name: 'cordis:web-fixture', config: { searchProvider: 'http-fixture', fetchProvider: 'http' } }] }])
  const ds = await bundle('ds', 'ds-bot', await readFile(join(ROOT, 'modules/bot-runtime/vendor/ds-bot/cordis.patch.yml'), 'utf8'))
  const mr = await bundle('mr-old', PRODUCT, [{ insert: [{ id: MR, name: PRODUCT }] }])
  const target = await bundle('target', PRODUCT, await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8'))
  const runtime = { home: './自定义团队 ~', workspace: './旧 workspace', mainName: '旧名字', mainRole: '旧角色', browser: false,
    memory: false, github: false, future: { secret: 'mock-PRIVATE-CREDENTIAL' } }
  const mrConfig = { dailyBudgetUsd: 17, modelProfilesJson: '[{"model":"fixture/exact"}]', privateExtension: 'mock-MR-SECRET' }
  const patches = [{ id: 'bot', name: 'ds-bot', config: runtime }, { id: MR, name: PRODUCT, config: mrConfig },
    { id: AUTO, name: 'ds-bot/web-search', config: { native: false, fallback: false, custom: 'mock-SEARCH' } }]
  const options = { profileDir: profile, dshHome: home, launchCwd: cwd, orderedBundleLayers: [base, ds, mr],
    launcherLayers: [], launchEnvironment: {}, targetBundleLayer: target }
  const manifestPath = join(profile, 'package.json'), patchPath = join(profile, 'cordis.patch.yml')
  await writeFile(manifestPath, json({ name: 'private-profile', dependencies: { 'ds-bot': '0.2.2', [PRODUCT]: '0.1.0', keep: '1' },
    dsh: { profile: { bundles: options.orderedBundleLayers.map(item => item.packageName) } } }))
  await writeFile(patchPath, json(patches))
  return { dir, home, profile, cwd, options, base, ds, mr, target, runtime, mrConfig, patches, manifestPath, patchPath,
    async save() { await writeFile(patchPath, json(patches)) } }
}

async function installationFixture() {
  const f = await fixture()
  f.options.orderedBundleLayers = [f.base]
  f.options.intent = 'install-unified-product'
  const manifest = JSON.parse(await readFile(f.manifestPath, 'utf8'))
  manifest.dsh.profile.bundles = [f.base.packageName]
  delete manifest.dependencies['ds-bot']; delete manifest.dependencies[PRODUCT]
  await writeFile(f.manifestPath, json(manifest))
  f.patches.length = 0
  await f.save()
  return f
}

test('read-only preview preserves runtime, MR settings and source bytes while planning a single product', async () => {
  const f = await fixture(), originalManifest = await readFile(f.manifestPath), originalPatch = await readFile(f.patchPath)
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.deepEqual(find(plan.proposal.effectiveEntries, MR).config.botRuntime, f.runtime)
  assert.deepEqual(find(plan.proposal.effectiveEntries, MR).config, { ...f.mrConfig, botRuntime: f.runtime, botProduct: true })
  assert.equal(find(plan.proposal.effectiveEntries, MR).id, MR)
  assert.equal(find(plan.proposal.effectiveEntries, 'bot'), undefined)
  assert.equal(find(plan.proposal.effectiveEntries, AUTO).name, `${PRODUCT}/web-search`)
  assert.deepEqual(find(plan.proposal.effectiveEntries, AUTO).config, f.patches[2].config)
  assert.deepEqual(plan.proposal.manifest.dsh.profile.bundles, ['@fixture/base', PRODUCT])
  assert.equal(plan.proposal.manifest.dependencies['ds-bot'], undefined)
  assert.equal(plan.proposal.manifest.dependencies.keep, '1')
  assert.equal(plan.proposal.manifest.dependencies[PRODUCT], '0.25.6-preview.1')
  assert.deepEqual(await readFile(f.manifestPath), originalManifest)
  assert.deepEqual(await readFile(f.patchPath), originalPatch)
  assert.equal((await verifyProfileMigrationSources(plan)).unchanged, true)
  assert.equal(plan.proposal.requiresTrailingLayer, true)
  assert.equal(plan.proposal.requiresInstallerVerification, true)
})

test('actual SDK whole-config replacement and name assertions determine the folded runtime', async () => {
  const f = await fixture()
  f.patches.push({ id: 'bot', config: { home: './replacement', memory: false } },
    { id: 'bot', name: 'wrong-name', config: { home: './must-not-win', browser: true } })
  await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.deepEqual(find(plan.proposal.effectiveEntries, MR).config.botRuntime, { home: './replacement', memory: false })
  assert.ok(plan.diagnostics.some(item => item.code === 'PATCH_SKIPPED'))
})

test('nested group patch targets use the SDK recursion and retain unrelated entries', async () => {
  const f = await fixture()
  await writeFile(join(f.ds.packageDir, 'cordis.patch.yml'), json([{ insert: [{ id: AUTO, name: 'ds-bot/web-search' }] },
    { id: 'web', config: { searchProvider: 'auto', fetchProvider: 'http' } }]))
  f.patches.unshift({ insert: [{ id: 'nested', name: 'cordis:group', group: true, config: [
    { id: 'bot', name: 'ds-bot' }, { id: 'untouched', name: 'fixture-plugin', config: { preserved: 7 } },
  ] }] })
  await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.deepEqual(find(plan.proposal.effectiveEntries, MR).config.botRuntime, f.runtime)
  assert.deepEqual(find(plan.proposal.effectiveEntries, 'untouched').config, { preserved: 7 })
  assert.equal(find(plan.proposal.effectiveEntries, 'nested').config.length, 1)
})

test('disabled group ancestry does not reactivate a retired runtime in the plan', async () => {
  const f = await fixture()
  await writeFile(join(f.ds.packageDir, 'cordis.patch.yml'), json([{ insert: [{ id: AUTO, name: 'ds-bot/web-search' }] },
    { id: 'web', config: { searchProvider: 'auto', fetchProvider: 'http' } }]))
  f.patches.unshift({ insert: [{ id: 'nested', name: 'cordis:group', group: true, disabled: true, config: [{ id: 'bot', name: 'ds-bot' }] }] })
  await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.equal(find(plan.proposal.effectiveEntries, MR).config.botProduct, false)
  const other = await fixture()
  await writeFile(join(other.mr.packageDir, 'cordis.patch.yml'), '[]\n')
  other.patches[0].disabled = true
  other.patches.unshift({ insert: [{ id: 'disabled-mr-parent', name: 'cordis:group', group: true, disabled: true,
    config: [{ id: MR, name: PRODUCT }] }] })
  await other.save()
  const mrDisabled = await previewProfileMigration(other.options)
  assert.equal(mrDisabled.status, 'ready', json(mrDisabled.diagnostics))
  assert.equal(find(mrDisabled.proposal.effectiveEntries, MR).disabled, true, 'disabled MR parent is preserved on the final MR root')
  assert.equal(find(mrDisabled.proposal.effectiveEntries, MR).config.botProduct, false)
})

test('!!js remains an AST node and dynamic home requires launch context without evaluation', async () => {
  const f = await fixture()
  await writeFile(f.patchPath, '- id: bot\n  config:\n    home: !!js "(() => { throw new Error(\'mock-NEVER-RUN\') })()"\n')
  const before = await readFile(f.patchPath), plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'needs-launch-context')
  assert.match(find(plan.effectiveBefore, 'bot').config.home.__jsExpr, /mock-NEVER-RUN/)
  assert.deepEqual(await readFile(f.patchPath), before)
  assert.equal(plan.proposal, null)
})

test('frozen home semantics use the explicit old cwd, with literal tilde and explicit workspace env', async () => {
  const f = await fixture()
  f.patches[0].config = { home: '~literal-home' }
  await f.save()
  f.options.launchEnvironment = { DS_BOT_WORKSPACE: '  ./env workspace  ' }
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready')
  assert.equal(plan.runtimePaths.effectiveHome, resolve(f.cwd, '~literal-home'))
  assert.equal(plan.runtimePaths.effectiveWorkspace, resolve(f.cwd, './env workspace'))
  assert.equal(find(plan.proposal.effectiveEntries, MR).config.botRuntime.home, '~literal-home')
  delete f.options.launchEnvironment
  assert.equal((await previewProfileMigration(f.options)).status, 'needs-launch-context')
})

test('search name/disabled and complete user web config survive an explicit provider selection', async () => {
  const f = await fixture(), web = { searchProvider: 'chosen-provider', fetchProvider: 'chosen-fetch', privateOption: 'mock-WEB' }
  f.patches[2].disabled = true
  f.patches.push({ id: 'web', config: web })
  f.options.availableSearchProviderIds = ['chosen-provider']
  await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.deepEqual(find(plan.proposal.effectiveEntries, 'web').config, web)
  assert.equal(find(plan.proposal.effectiveEntries, AUTO).disabled, true)
  assert.equal(plan.proposal.targetLayers.find(layer => layer.kind === 'profile').patches.find(row => row.id === AUTO).name, `${PRODUCT}/web-search`)
})

test('disabled auto selected as provider is blocked rather than implicitly enabled or replaced', async () => {
  const f = await fixture()
  f.patches[2].disabled = true; await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'blocked')
  assert.ok(plan.diagnostics.some(item => item.code === 'SEARCH_PROVIDER_MISSING'))
})

test('unknown custom provider requires inventory, and known-missing provider is rejected', async () => {
  const f = await fixture()
  f.patches.push({ id: 'web', config: { searchProvider: 'chosen-provider', fetchProvider: 'http' } }); await f.save()
  assert.equal((await previewProfileMigration(f.options)).status, 'needs-launch-context')
  f.options.availableSearchProviderIds = []
  assert.equal((await previewProfileMigration(f.options)).status, 'blocked')
})

test('unknown includes and dynamic plugin names are never read/imported or guessed', async () => {
  const f = await fixture()
  f.patches.push({ insert: [{ id: 'external', name: 'cordis:include', config: { path: '../unselected-secret.yml' } }] })
  await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'needs-launch-context')
  assert.ok(!plan.sources.some(source => source.path.endsWith('unselected-secret.yml')))
  f.patches.at(-1).insert[0] = { id: 'external', name: { __jsExpr: '"ds-bot"' } }; await f.save()
  assert.equal((await previewProfileMigration(f.options)).status, 'needs-launch-context')
})

test('duplicate runtime and unsupported legacy bundle contributions cannot be dropped', async () => {
  const f = await fixture()
  f.patches.push({ insert: [{ id: 'second-bot', name: 'ds-bot' }] }); await f.save()
  const duplicate = await previewProfileMigration(f.options)
  assert.equal(duplicate.status, 'blocked')
  assert.ok(duplicate.diagnostics.some(item => item.code === 'DUPLICATE_RUNTIME'))
  f.patches.pop(); await f.save()
  const dsPath = join(f.ds.packageDir, 'cordis.patch.yml')
  await writeFile(dsPath, (await readFile(dsPath, 'utf8')) + '\n- insert:\n    - id: extra\n      name: private-plugin\n')
  const unsupported = await previewProfileMigration(f.options)
  assert.equal(unsupported.status, 'blocked')
  assert.ok(unsupported.diagnostics.some(item => item.code === 'UNSUPPORTED_BUNDLE'))
})

test('read-only source verification detects changed bytes and an originally absent home patch', async () => {
  const f = await fixture(), plan = await previewProfileMigration(f.options)
  await writeFile(f.patchPath, json([...f.patches, { id: MR, config: { changed: true } }]))
  assert.equal((await verifyProfileMigrationSources(plan)).unchanged, false)
  assert.equal((await previewProfileMigration({ ...f.options, expectedSources: plan.sources })).status, 'source-changed')
  const other = await fixture(), untouched = await previewProfileMigration(other.options)
  await writeFile(join(other.home, 'cordis.patch.yml'), '[]\n')
  const checked = await verifyProfileMigrationSources(untouched)
  assert.equal(checked.unchanged, false)
  assert.equal(checked.changedMissingSourceIndices.length, 1)
})

test('two previews are deterministic and public summaries contain only whitelisted non-secret facts', async () => {
  const f = await fixture(), first = await previewProfileMigration(f.options), second = await previewProfileMigration(f.options)
  assert.deepEqual(second, first)
  const summary = summarizeProfileMigration(first), encoded = JSON.stringify(summary)
  for (const secret of ['SENTINEL', f.dir, f.profile, f.runtime.mainName, 'secret', 'privateExtension', 'home']) assert.ok(!encoded.includes(secret), secret)
  assert.deepEqual(Object.keys(summary).sort(), ['schemaVersion', 'status', 'sourceCount', 'sourceDigest', 'planDigest', 'bundleCountBefore', 'bundleCountAfter',
    'runtimeCountBefore', 'searchCountBefore', 'suggestedChangeCount', 'diagnostics', 'intent'].sort())
  assert.deepEqual(first.summary, summary)
  assert.ok(first.sources.some(source => source.text.includes('mock-MR-SECRET')), 'raw source exists only in private plan')
})

test('missing launch layers/cwd and mismatched bundle order yield actionable diagnostics', async () => {
  const f = await fixture()
  const missing = { ...f.options }; delete missing.launcherLayers; delete missing.launchCwd
  assert.equal((await previewProfileMigration(missing)).status, 'needs-launch-context')
  const mismatch = await previewProfileMigration({ ...f.options, orderedBundleLayers: [...f.options.orderedBundleLayers].reverse() })
  assert.equal(mismatch.status, 'blocked')
  assert.ok(mismatch.summary.diagnostics.some(item => item.code === 'BUNDLE_ORDER_MISMATCH' && item.action))
})

test('home and ordered launcher layers override profile config in actual SDK order', async () => {
  const f = await fixture(), path = join(f.dir, 'launcher.patch.yml')
  await writeFile(join(f.home, 'cordis.patch.yml'), json([{ id: 'bot', config: { home: './home-layer' } }]))
  await writeFile(path, json([{ id: 'bot', config: { home: './file-launcher' } }]))
  f.options.launcherLayers = [{ path }, { label: 'explicit CLI flag', patches: [{ id: 'bot', config: { home: './last-inline', memory: false } }] }]
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.deepEqual(find(plan.proposal.effectiveEntries, MR).config.botRuntime, { home: './last-inline', memory: false })
})

test('selected bundle symlink cannot read a patch outside its explicitly selected root', async t => {
  const f = await fixture(), external = join(f.dir, 'external.patch.yml')
  await writeFile(external, json([{ id: 'bot', config: { token: 'mock-UNSELECTED' } }]))
  const linked = join(f.ds.packageDir, 'linked.patch.yml')
  try { await symlink(external, linked, 'file') } catch (error) {
    if (error.code === 'EPERM') { t.skip('This host does not permit creating a file symlink'); return }
    throw error
  }
  const manifestFile = join(f.ds.packageDir, 'package.json'), manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  manifest.dsh.bundle.patch = './linked.patch.yml'; await writeFile(manifestFile, json(manifest))
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'blocked')
  assert.ok(plan.diagnostics.some(item => item.code === 'SOURCE_LINK_OUTSIDE_ROOT'))
  assert.ok(!plan.sources.some(source => source.text.includes('mock-UNSELECTED')))
})

test('captured-byte YAML dialect agrees with the actual rc.3 SDK parser without evaluating !!js', async () => {
  const f = await fixture()
  await writeFile(f.patchPath, '- insert:\n    - id: relative-plugin\n      name: ./not-imported.mjs\n      config:\n        future: !!js "(() => { throw new Error(\'not executed\') })()"\n')
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.deepEqual(plan.layers.find(layer => layer.kind === 'profile').patches, loadOverlayPatches('fixture', f.patchPath))
})

test('preview rejects file, total source, inline layer and data depth limits without unbounded reads', async () => {
  const f = await fixture()
  for (const limits of [{ maxFileBytes: 32 }, { maxTotalBytes: 256 }, { maxSources: 1 }]) {
    const plan = await previewProfileMigration({ ...f.options, limits })
    assert.equal(plan.status, 'blocked')
    assert.ok(plan.diagnostics.some(item => item.code === 'SOURCE_LIMIT'))
  }
  const invalid = await previewProfileMigration({ ...f.options, limits: { maxFileBytes: 10 ** 12 } })
  assert.ok(invalid.diagnostics.some(item => item.code === 'INVALID_LIMITS'))
  const nested = { item: null }; let at = nested
  for (let index = 0; index < 70; index++) { at.item = { item: null }; at = at.item }
  await writeFile(f.patchPath, json([{ id: MR, config: nested }]))
  const deep = await previewProfileMigration(f.options)
  assert.equal(deep.status, 'blocked')
  assert.ok(deep.diagnostics.some(item => item.code === 'INVALID_PATCH'))
  const fresh = await fixture()
  fresh.options.launcherLayers = [{ patches: [{ id: MR, config: { tooLarge: 'a'.repeat(2 * 1024 * 1024 + 1) } }] }]
  assert.ok((await previewProfileMigration(fresh.options)).diagnostics.some(item => item.code === 'SOURCE_LIMIT'))
})

test('public status, diagnostic values and hashes are also whitelisted for tampered saved plans', () => {
  const summary = summarizeProfileMigration({ status: 'mock-STATUS', sources: [], sourceDigest: 'mock-DIGEST', planDigest: 'mock-PLAN',
    diagnostics: [{ code: 'mock-CODE', severity: 'mock-SEVERITY', path: 'mock-PATH' }] })
  assert.equal(summary.status, 'blocked')
  assert.deepEqual(summary.diagnostics, [{ code: 'UNKNOWN_DIAGNOSTIC', severity: 'error', action: 'review-private-plan' }])
  assert.equal(summary.sourceDigest, null); assert.equal(summary.planDigest, null)
  assert.ok(!JSON.stringify(summary).includes('SENTINEL'))
})

test('unsupported MR bundle additions and inherited group scopes are rejected instead of discarded', async () => {
  const f = await fixture(), path = join(f.mr.packageDir, 'cordis.patch.yml')
  await writeFile(path, json([{ insert: [{ id: MR, name: PRODUCT }, { id: 'important-extra', name: 'keep-this-plugin' }] }]))
  const unsupported = await previewProfileMigration(f.options)
  assert.equal(unsupported.status, 'blocked')
  assert.ok(unsupported.diagnostics.some(item => item.code === 'UNSUPPORTED_BUNDLE'))
  const other = await fixture()
  await writeFile(join(other.ds.packageDir, 'cordis.patch.yml'), json([{ insert: [{ id: AUTO, name: 'ds-bot/web-search' }] },
    { id: 'web', config: { searchProvider: 'auto', fetchProvider: 'http' } }]))
  other.patches.unshift({ insert: [{ id: 'scoped', name: 'cordis:group', group: true, isolate: ['tools'], config: [{ id: 'bot', name: 'ds-bot' }] }] })
  await other.save()
  assert.ok((await previewProfileMigration(other.options)).diagnostics.some(item => item.field === 'inherited-group-options'))
})

test('a missing explicitly selected launcher layer requests launch context', async () => {
  const f = await fixture()
  f.options.launcherLayers = [{ path: join(f.dir, 'missing-launcher.yml') }]
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'needs-launch-context')
  assert.ok(plan.diagnostics.some(item => item.field === 'launcher-layer'))
})

test('untouched non-target disabled expressions remain identical ASTs without evaluating a throw sentinel', async () => {
  const f = await fixture()
  const expression = { __jsExpr: '(() => { throw new Error("mock-DISABLED-MUST-NOT-RUN") })()' }
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: `sdk-unrelated-${index}`, name: `fixture-sdk-${index}`,
    disabled: expression, config: { preserved: index } }))
  rows.push({ id: 'unrelated-parent', name: 'cordis:group', group: true, disabled: expression,
    config: [{ id: 'unrelated-child', name: 'fixture-child', disabled: expression, config: { alsoPreserved: true } }] })
  f.patches.push({ insert: rows }); await f.save()
  const original = await readFile(f.patchPath), plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  for (const id of [...rows.map(row => row.id), 'unrelated-child']) {
    assert.deepEqual(find(plan.proposal.effectiveEntries, id), find(plan.effectiveBefore, id))
    assert.deepEqual(find(plan.proposal.effectiveEntries, id).disabled, expression)
  }
  assert.deepEqual(await readFile(f.patchPath), original)
  const proof = plan.proposal.preservedDynamicDisabled
  assert.equal(proof.entryCount, 12)
  assert.equal(proof.equal, true)
  assert.equal(proof.beforeDigest, proof.afterDigest)
})

test('target disabled expressions and target ancestry still require explicit launch context', async () => {
  const expression = { __jsExpr: '(() => { throw new Error("mock-TARGET-MUST-NOT-RUN") })()' }
  for (const id of ['bot', MR, AUTO, 'web']) {
    const f = await fixture()
    f.patches.push({ id, disabled: expression }); await f.save()
    const plan = await previewProfileMigration(f.options)
    assert.equal(plan.status, 'needs-launch-context', `${id}: ${json(plan.diagnostics)}`)
    assert.ok(plan.diagnostics.some(item => item.field === 'dynamic-target-disabled' && item.entryId === id))
    assert.equal(plan.proposal, null)
  }
  const f = await fixture()
  await writeFile(join(f.ds.packageDir, 'cordis.patch.yml'), json([{ insert: [{ id: AUTO, name: 'ds-bot/web-search' }] },
    { id: 'web', config: { searchProvider: 'auto', fetchProvider: 'http' } }]))
  f.patches.unshift({ insert: [{ id: 'dynamic-parent', name: 'cordis:group', group: true, disabled: expression,
    config: [{ id: 'bot', name: 'ds-bot' }] }] }); await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'needs-launch-context')
  assert.ok(plan.diagnostics.some(item => item.field === 'dynamic-target-disabled' && item.entryId === 'dynamic-parent'))
})

test('non-target dynamic id/name/group structure is still conservatively blocked', async () => {
  for (const field of ['id', 'name', 'group']) {
    const f = await fixture(), row = { id: 'unrelated', name: 'fixture-plugin', config: [] }
    row[field] = { __jsExpr: '(() => { throw new Error("mock-STRUCTURE") })()' }
    f.patches.push({ insert: [row] }); await f.save()
    assert.equal((await previewProfileMigration(f.options)).status, 'needs-launch-context', field)
  }
})

test('new installation requires explicit intent and preserves all unrelated bundle rows and ASTs', async () => {
  const f = await installationFixture(), expression = { __jsExpr: '(() => { throw new Error("INSTALL-SENTINEL") })()' }
  f.patches.push({ insert: [{ id: 'unchanged-sdk-row', name: 'fixture-sdk', disabled: expression, config: { retained: true } }] }); await f.save()
  const strict = { ...f.options }; delete strict.intent
  const refused = await previewProfileMigration(strict)
  assert.equal(refused.status, 'blocked')
  assert.ok(refused.diagnostics.some(item => item.code === 'NO_PRODUCT_ENTRY'))
  const before = await readFile(f.patchPath), plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.equal(plan.intent, 'install-unified-product')
  assert.equal(plan.summary.intent, 'install-unified-product')
  assert.deepEqual(plan.sourceState, { intent: 'install-unified-product', runtimeEntries: 0, routerEntries: 0, searchEntries: 0 })
  assert.equal(plan.proposal.intent, 'install-unified-product')
  assert.equal(plan.proposal.targetArtifact.intent, 'install-unified-product')
  assert.deepEqual(plan.proposal.manifest.dsh.profile.bundles, [f.base.packageName, PRODUCT])
  assert.deepEqual(find(plan.proposal.effectiveEntries, 'unchanged-sdk-row'), find(plan.effectiveBefore, 'unchanged-sdk-row'))
  assert.deepEqual(find(plan.proposal.effectiveEntries, MR).config, { botRuntime: {} })
  assert.equal(plan.runtimePaths.effectiveHome, join(f.home, 'bot'))
  assert.equal(plan.runtimePaths.effectiveWorkspace, join(f.home, 'bot/workspace'))
  assert.equal(find(plan.proposal.effectiveEntries, AUTO).name, `${PRODUCT}/web-search`)
  assert.equal(plan.proposal.preservedDynamicDisabled.equal, true)
  assert.deepEqual(await readFile(f.patchPath), before)
})

test('SDK-reactivated MR orphan config uses whole replacement and preserves disabled on new install', async () => {
  const f = await installationFixture()
  const effective = { monthlyBudgetUsd: 39, modelProfilesJson: '[{"model":"fixture/exact"}]', privateExtension: 'ORPHAN-PRIVATE',
    botRuntime: { home: './orphan-home', workspace: './orphan-workspace', memory: false } }
  f.patches.push({ id: MR, name: PRODUCT, config: { dailyBudgetUsd: 19, discarded: true } },
    { id: MR, name: PRODUCT, config: effective }, { id: MR, name: PRODUCT, disabled: true })
  await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.equal(find(plan.effectiveBefore, MR), undefined)
  assert.deepEqual(find(plan.installCandidate, MR).config, effective)
  assert.deepEqual(find(plan.proposal.effectiveEntries, MR).config, effective)
  assert.equal(find(plan.proposal.effectiveEntries, MR).disabled, true)
  assert.equal(plan.runtimePaths.effectiveHome, resolve(f.cwd, './orphan-home'))
  assert.ok(plan.diagnostics.some(item => item.code === 'ORPHAN_ROUTER_SETTINGS_REACTIVATED' && item.severity === 'warning'))
})

test('legacy Bot orphan patches are not inferred as new runtime or search configuration', async () => {
  const f = await installationFixture()
  const orphan = { id: 'bot', name: 'ds-bot', config: { home: './must-not-become-home', workspace: './old-workspace', memory: false } }
  const oldSearch = { id: AUTO, name: 'ds-bot/web-search', disabled: true }
  f.patches.push(orphan, oldSearch); await f.save()
  const plan = await previewProfileMigration(f.options)
  assert.equal(plan.status, 'ready', json(plan.diagnostics))
  assert.deepEqual(find(plan.proposal.effectiveEntries, MR).config.botRuntime, {})
  assert.equal(plan.runtimePaths.effectiveHome, join(f.home, 'bot'))
  const proposedProfile = plan.proposal.targetLayers.find(layer => layer.kind === 'profile').patches
  assert.deepEqual(proposedProfile[0], orphan)
  assert.deepEqual(proposedProfile[1], oldSearch, 'unmatched legacy search name is not silently reactivated')
  assert.notEqual(find(plan.proposal.effectiveEntries, AUTO).disabled, true)
  assert.ok(plan.diagnostics.some(item => item.code === 'ORPHAN_LEGACY_BOT_PATCH'))
})

test('install intent still blocks dynamic target conditions and requires missing environment context', async () => {
  const f = await installationFixture()
  f.patches.push({ id: MR, disabled: { __jsExpr: '(() => { throw new Error("ORPHAN-DYNAMIC") })()' } }); await f.save()
  const dynamic = await previewProfileMigration(f.options)
  assert.equal(dynamic.status, 'needs-launch-context')
  assert.ok(dynamic.diagnostics.some(item => item.field === 'dynamic-target-disabled'))
  f.patches.length = 0; await f.save(); delete f.options.launchEnvironment
  const context = await previewProfileMigration(f.options)
  assert.equal(context.status, 'needs-launch-context')
  assert.ok(context.diagnostics.some(item => item.field === 'launchEnvironment'))
})

test('install intent cannot reinterpret an existing runtime as an empty source, and intent values are bounded', async () => {
  const f = await fixture()
  const plan = await previewProfileMigration({ ...f.options, intent: 'install-unified-product' })
  assert.equal(plan.status, 'blocked')
  assert.ok(plan.diagnostics.some(item => item.code === 'INSTALL_SOURCE_NOT_EMPTY'))
  const invalid = await previewProfileMigration({ ...f.options, intent: 'PRIVATE-INVALID-INTENT' })
  assert.equal(invalid.status, 'blocked')
  assert.ok(invalid.diagnostics.some(item => item.code === 'INVALID_INTENT'))
  assert.equal(invalid.summary.intent, 'unknown')
  assert.ok(!JSON.stringify(invalid.summary).includes('PRIVATE-INVALID'))
})
