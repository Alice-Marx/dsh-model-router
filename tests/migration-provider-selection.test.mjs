import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { previewProfileMigration } from '../packages/orchestration/src/profile-migration-plan.mjs'
import { createMigrationDataArchive } from '../packages/orchestration/src/migration-data-archive.mjs'
import { inspectMigrationSources } from '../packages/orchestration/src/migration-snapshot.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const PARENT = join(ROOT, 'tmp/integration/migration-provider-selection')
const PRODUCT = '@ljwei-stak/dsh-model-router'
const DOMAIN = '@deepseek-ai/dsh-storage-domain'
const json = value => JSON.stringify(value) + '\n'
const sha = value => createHash('sha256').update(value).digest('hex')
const sdk = () => import('../packages/orchestration/src/migration-provider-selection.mjs')
const declared = (config = { backend: 'fixture-json', routes: {} }, options = {}) => ({ id: 'domain', name: DOMAIN, config, ...options })
const expected = plan => ({ profilePlanDigest: sha(json(plan)) })
const observe = async plan => (await sdk()).observeCapturedMigrationProviderSelection({ configurationPlan: plan, expected: expected(plan) })

async function fixture(t, { entries = [declared()], profilePatches = [], homePatches = [], launcherLayers = [], targetEntries = [] } = {}) {
  await mkdir(PARENT, { recursive: true })
  const dir = await mkdtemp(join(PARENT, 'case-')), home = join(dir, 'home'), profile = join(home, 'profiles/test')
  await mkdir(profile, { recursive: true })
  t.after(async () => {
    const part = relative(PARENT, dir)
    assert.ok(part && !isAbsolute(part) && !part.startsWith('..'))
    await rm(dir, { recursive: true, force: true })
  })
  async function bundle(folder, name, insert) {
    const packageDir = join(dir, folder)
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), json({ name, version: '0.26.0-preview.1', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(packageDir, 'cordis.patch.yml'), json([{ insert }]))
    return { packageName: name, packageDir }
  }
  const base = await bundle('base', '@fixture/base', [{ id: 'web', name: 'fixture-web', config: { searchProvider: 'auto' } }, ...entries])
  const old = await bundle('old', PRODUCT, [{ id: 'model-router-galgame', name: PRODUCT }])
  const target = await bundle('target', PRODUCT, [
    { id: 'model-router-galgame', name: PRODUCT }, { id: 'web-search-auto', name: `${PRODUCT}/web-search` }, ...targetEntries,
  ])
  await writeFile(join(profile, 'package.json'), json({ dsh: { profile: { bundles: [base.packageName, old.packageName] } } }))
  if (profilePatches.length) await writeFile(join(profile, 'cordis.patch.yml'), json(profilePatches))
  if (homePatches.length) await writeFile(join(home, 'cordis.patch.yml'), json(homePatches))
  const options = { profileDir: profile, dshHome: home, launchCwd: profile, orderedBundleLayers: [base, old], launcherLayers, launchEnvironment: {}, targetBundleLayer: target }
  const plan = await previewProfileMigration(options)
  assert.ok(['ready', 'needs-launch-context'].includes(plan.status), json(plan.summary))
  return { dir, home, profile, plan, options, base, old, target }
}

function bounded(result) {
  assert.equal(result.coverage, 'captured-configuration-selections-only')
  assert.equal(result.complete, false)
  assert.equal(result.providerIdentityVerified, false)
  assert.equal(result.providerPathAuthority, false)
  assert.equal(result.providerGenerationAvailable, false)
  assert.equal(result.captureEpochStatus, 'unproven')
  assert.equal(result.applySupported, false)
  assert.equal(result.activationSupported, false)
  assert.equal(result.rollbackSupported, false)
  assert.equal(result.stopWriteSupported, false)
  assert.deepEqual(result.providers.map(row => [row.domain, row.state]), [['sessions', 'unknown'], ['attachments', 'unknown'], ['workspace', 'unknown']])
}

test('provider selection: exact source SDK composition reports selector only and excludes proposed target', async t => {
  const f = await fixture(t, { entries: [declared({ backend: 'default', routes: { workspace: 'routed' } })], targetEntries: [{ id: 'target-decoy', name: 'fixture-secret-provider' }] })
  const before = json(f.plan), result = await observe(f.plan)
  bounded(result)
  assert.equal(json(f.plan), before)
  assert.equal(result.workspaceSelectors.length, 1)
  assert.deepEqual(result.workspaceSelectors[0], { ordinal: 1, selector: 'routed', via: 'route', scope: 'configured-selector-only' })
  assert.equal(result.entries.some(row => row.id === 'target-decoy'), false)
  assert.equal(result.entries.length, f.plan.effectiveBefore.length)
})

test('provider selection: home overrides profile through actual whole-config replacement', async t => {
  const f = await fixture(t, { profilePatches: [{ id: 'domain', config: { backend: 'profile', routes: { workspace: 'profile-route' } } }], homePatches: [{ id: 'domain', config: { backend: 'home' } }] })
  const result = await observe(f.plan)
  assert.deepEqual(result.workspaceSelectors[0], { ordinal: 1, selector: 'home', via: 'default', scope: 'configured-selector-only' })
  assert.equal(result.sourceLayerCount, 4)
  bounded(result)
})

test('provider selection: unknown and backend-looking entries cannot turn config paths into roots', async t => {
  const rows = [declared(), { id: 'session-persistence', name: '@fixture/session-persistence-jsonl', config: { root: '/looks/complete', complete: true } }, { id: 'attachments', name: '@fixture/attachment-remote', config: { url: 'https://invalid.example/private', root: 'X:/not-authority' } }]
  const f = await fixture(t, { entries: rows }), result = await observe(f.plan)
  assert.deepEqual(result.entries.slice(1, 4).map(row => row.id), rows.map(row => row.id))
  assert.equal(result.entries.find(row => row.id === 'attachments').classification, 'unclassified-declaration')
  assert.equal(JSON.stringify(result).includes('looks/complete'), false)
  assert.equal(JSON.stringify(result).includes('invalid.example'), false)
  bounded(result)
})

test('provider selection: absent facilities and service-name aliases remain unresolved', async t => {
  for (const entries of [[], [{ id: 'domain', name: 'storage-domain', config: { backend: 'fake' } }]]) {
    const f = await fixture(t, { entries }), result = await observe(f.plan)
    assert.deepEqual(result.workspaceSelectors, [])
    bounded(result)
  }
})

test('provider selection: disabled ancestors and expression-disabled entries remain explicit', async t => {
  const f = await fixture(t, { entries: [
    { id: 'group', name: 'cordis:group', config: [declared()], disabled: true },
    declared({ backend: 'not-run' }, { id: 'dynamic-disabled', disabled: { __jsExpr: 'globalThis.__c6ProviderExecuted = true' } }),
  ] })
  const result = await observe(f.plan)
  assert.equal(result.entries.find(row => row.id === 'domain').declaredEnabledState, 'disabled')
  assert.equal(result.entries.find(row => row.id === 'dynamic-disabled').declaredEnabledState, 'unknown')
  assert.deepEqual(result.entries.find(row => row.id === 'domain').ancestry, [1])
  assert.deepEqual(result.workspaceSelectors, [])
  assert.equal(globalThis.__c6ProviderExecuted, undefined)
  bounded(result)
})

test('provider selection: dynamic names and includes are retained without evaluating or following them', async t => {
  for (const entry of [
    { id: 'dynamic-name', name: { __jsExpr: 'globalThis.__c6ProviderExecuted = true' }, config: {} },
    { id: 'include', name: 'cordis:include', config: { path: 'X:/must-not-read.yml' } },
  ]) {
    const f = await fixture(t, { entries: [entry] }), result = await observe(f.plan)
    assert.ok(result.entries.find(row => row.id === entry.id).issues.length)
    assert.deepEqual(result.workspaceSelectors, [])
    bounded(result)
  }
  assert.equal(globalThis.__c6ProviderExecuted, undefined)
})

test('provider selection: dynamic configuration and inherited scope options do not produce selectors', async t => {
  for (const entry of [
    declared({ backend: { __jsExpr: 'globalThis.__c6ProviderExecuted = true' } }),
    declared({ backend: 'a', routes: { workspace: { __jsExpr: 'throw new Error("never")' } } }),
    declared({ backend: 'a' }, { inject: { storage: 'other-scope' } }),
    { id: 'scoped', name: 'cordis:group', isolate: ['storage'], config: [declared()] },
  ]) {
    const f = await fixture(t, { entries: [entry] }), result = await observe(f.plan)
    assert.deepEqual(result.workspaceSelectors, [])
    bounded(result)
  }
  assert.equal(globalThis.__c6ProviderExecuted, undefined)
})

test('provider selection: inline launcher input is owner-declared and not observed launcher authority', async t => {
  const f = await fixture(t, { launcherLayers: [{ label: 'fixture', patches: [{ id: 'domain', config: { backend: 'inline' } }] }] })
  const result = await observe(f.plan)
  assert.equal(result.launcherAuthority, 'owner-declared-captured-input-only')
  assert.equal(result.inlineLauncherLayers, 1)
  assert.equal(result.workspaceSelectors[0].selector, 'inline')
  bounded(result)
})

test('provider selection: uncertain ancestor identity or group control blocks nested configured selectors', async t => {
  for (const entry of [
    { id: 'outer', name: { __jsExpr: 'globalThis.__c6ProviderExecuted = true' }, group: true, config: [declared()] },
    { id: { __jsExpr: '"outer"' }, name: 'cordis:group', config: [declared()] },
    { id: 'outer', name: 'cordis:group', group: { __jsExpr: 'true' }, config: [declared()] },
  ]) {
    const f = await fixture(t, { entries: [entry] }), result = await observe(f.plan)
    assert.deepEqual(result.workspaceSelectors, [])
    assert.ok(result.entries.find(row => row.id === 'domain').issues.includes('UNRESOLVED_ANCESTRY'))
    bounded(result)
  }
  assert.equal(globalThis.__c6ProviderExecuted, undefined)
})

test('provider selection: multiple static facilities remain separate configured selectors, never one resolved provider', async t => {
  const f = await fixture(t, { entries: [declared({ backend: 'one' }), declared({ backend: 'two' }, { id: 'domain-two' })] }), result = await observe(f.plan)
  assert.deepEqual(result.workspaceSelectors.map(row => row.selector), ['one', 'two'])
  bounded(result)
})

test('provider selection: skipped patch name assertions cannot change the selected backend', async t => {
  const f = await fixture(t, { profilePatches: [{ id: 'domain', name: '@fixture/wrong', config: { backend: 'must-not-win' } }] }), result = await observe(f.plan)
  assert.equal(result.workspaceSelectors[0].selector, 'fixture-json')
  assert.equal(result.compositionWarningCount, 1)
  bounded(result)
})

test('provider selection: malformed backend or route values cannot be promoted', async t => {
  for (const config of [null, {}, { backend: '' }, { backend: 1 }, { backend: 'x', routes: [] }, { backend: 'x', routes: { workspace: null } }]) {
    const f = await fixture(t, { entries: [declared(config)] }), result = await observe(f.plan)
    assert.deepEqual(result.workspaceSelectors, [])
    assert.ok(result.entries.find(row => row.id === 'domain').issues.includes('INVALID_STATIC_SELECTOR'))
    bounded(result)
  }
})

test('provider selection: missing or stale owner binding rejects before composition', async t => {
  const f = await fixture(t), { observeCapturedMigrationProviderSelection: fn } = await sdk()
  for (const binding of [undefined, {}, { profilePlanDigest: '0'.repeat(64) }]) assert.throws(() => fn({ configurationPlan: f.plan, expected: binding }), { code: 'MIGRATION_PROVIDER_BINDING_INVALID' })
  const changed = structuredClone(f.plan)
  changed.effectiveBefore.push({ id: 'decoy', name: 'storage-json' })
  assert.throws(() => fn({ configurationPlan: changed, expected: expected(f.plan) }), { code: 'MIGRATION_PROVIDER_BINDING_INVALID' })
})

test('provider selection: source bytes layer patches omission and saved effective rows must all agree', async t => {
  const f = await fixture(t)
  const mutations = [
    p => { p.sources[0].text += ' ' },
    p => { p.layers[0].patches[0].insert.push({ id: 'decoy', name: 'storage-json' }) },
    p => { p.layers.splice(0, 1) },
    p => { p.effectiveBefore.pop() },
    p => { p.layers[0].patches[0].insert = p.layers[0].patches[0].insert.filter(row => row.id !== 'domain') },
    p => { [p.layers[0], p.layers[1]] = [p.layers[1], p.layers[0]] },
    p => { p.originalManifest.dsh.profile.bundles = [] },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(f.plan); mutate(changed)
    await assert.rejects(() => observe(changed), error => error.code === 'MIGRATION_PROVIDER_CAPTURE_INVALID')
  }
})

test('provider selection: file-backed YAML uses the fixed AST dialect without running malicious expressions', async t => {
  const f = await fixture(t)
  await writeFile(join(f.base.packageDir, 'cordis.patch.yml'), '- insert:\n  - id: web\n    name: fixture-web\n    config: { searchProvider: auto }\n  - id: domain\n    name: "@deepseek-ai/dsh-storage-domain"\n    disabled: !<tag:yaml.org,2002:js> globalThis.__c6ProviderExecuted = true\n    config: { backend: fixture }\n')
  const plan = await previewProfileMigration(f.options), result = await observe(plan)
  assert.equal(result.entries.find(row => row.id === 'domain').declaredEnabledState, 'unknown')
  assert.equal(globalThis.__c6ProviderExecuted, undefined)
  bounded(result)
})

test('provider selection: relative plugin names are anchored to captured source files without importing them', async t => {
  const f = await fixture(t, { entries: [{ id: 'relative', name: './must-not-import.mjs', config: { private: 'SENTINEL-PRIVATE' } }] }), result = await observe(f.plan)
  assert.match(result.entries.find(row => row.id === 'relative').name, /^file:/)
  assert.equal(JSON.stringify(result).includes('SENTINEL-PRIVATE'), false)
  bounded(result)
})

test('provider selection: BOM-prefixed captured YAML keeps original byte hashes', async t => {
  const f = await fixture(t), path = join(f.base.packageDir, 'cordis.patch.yml')
  await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(path)]))
  const plan = await previewProfileMigration(f.options), result = await observe(plan)
  assert.equal(result.workspaceSelectors[0].selector, 'fixture-json')
  bounded(result)
})

test('provider selection: private seam rejects accessors without invoking them', async t => {
  const f = await fixture(t), { observeCapturedMigrationProviderSelection: fn } = await sdk()
  let called = false
  Object.defineProperty(f.plan, 'accessor', { enumerable: true, get() { called = true; return 'never' } })
  assert.throws(() => fn({ configurationPlan: f.plan, expected: { profilePlanDigest: '0'.repeat(64) } }), { code: 'MIGRATION_PROVIDER_CAPTURE_INVALID' })
  assert.equal(called, false)
})

async function archiveFixture(t) {
  const f = await fixture(t), selected = join(f.dir, 'selected')
  await mkdir(selected); await writeFile(join(selected, 'note.txt'), 'fixture\n')
  f.dataArchive = join(f.dir, 'data-archive')
  await createMigrationDataArchive({ configurationPlan: f.plan, inventory: await inspectMigrationSources([{ id: 'data', kind: 'bot-data', root: selected }]), privateOutput: f.dataArchive })
  f.binding = { ...expected(f.plan), captureManifestSha256: sha(await readFile(join(f.dataArchive, 'capture.private.json'))) }
  return f
}

test('provider selection: verified archive cold read needs no original paths or source tree', async t => {
  const f = await archiveFixture(t), { readCapturedMigrationProviderSelection: read } = await sdk()
  const before = await readFile(join(f.dataArchive, 'profile-plan.private.json'))
  for (const path of [f.home, f.base.packageDir, f.old.packageDir, f.target.packageDir]) await rename(path, path + '-moved')
  const result = await read({ dataArchive: f.dataArchive, expected: f.binding })
  assert.deepEqual(result, await observe(f.plan))
  const code = `import { readCapturedMigrationProviderSelection } from './packages/orchestration/src/migration-provider-selection.mjs';
    const result = await readCapturedMigrationProviderSelection(JSON.parse(process.argv[1]));
    process.stdout.write(JSON.stringify(result));`
  const cold = execFileSync(process.execPath, ['--input-type=module', '-e', code, JSON.stringify({ dataArchive: f.dataArchive, expected: f.binding })], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 })
  assert.deepEqual(JSON.parse(cold), result)
  assert.deepEqual(await readFile(join(f.dataArchive, 'profile-plan.private.json')), before)
  bounded(result)
})

test('provider selection: archive reader rejects stale capture or profile binding and tampering', async t => {
  const f = await archiveFixture(t), { readCapturedMigrationProviderSelection: read } = await sdk()
  for (const binding of [{}, { ...f.binding, captureManifestSha256: '0'.repeat(64) }, { ...f.binding, profilePlanDigest: '0'.repeat(64) }]) await assert.rejects(() => read({ dataArchive: f.dataArchive, expected: binding }), { code: 'MIGRATION_PROVIDER_BINDING_INVALID' })
  const path = join(f.dataArchive, 'profile-plan.private.json')
  await writeFile(path, (await readFile(path, 'utf8')) + ' ')
  await assert.rejects(() => read({ dataArchive: f.dataArchive, expected: f.binding }))
})

test('provider selection: cancellation and nonbounded input fail closed', async t => {
  const f = await archiveFixture(t), { readCapturedMigrationProviderSelection: read, observeCapturedMigrationProviderSelection: fn } = await sdk()
  const controller = new AbortController(); controller.abort()
  await assert.rejects(() => read({ dataArchive: f.dataArchive, expected: f.binding, signal: controller.signal }), { code: 'MIGRATION_PROVIDER_CANCELLED' })
  const cyclic = structuredClone(f.plan); cyclic.self = cyclic
  assert.throws(() => fn({ configurationPlan: cyclic, expected: expected(f.plan) }), { code: 'MIGRATION_PROVIDER_CAPTURE_INVALID' })
})
