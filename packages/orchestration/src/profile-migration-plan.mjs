import { createHash } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundlePatchPaths, composeEntries } from '@deepseek-ai/dsh-app-boot'
import { BotRuntimeConfig } from './bot-runtime-config.mjs'

// Use the installed SDK's parser and dialect, without adding another YAML
// implementation or invoking loadProfile/loadProfileDirectory (both can write).
const { load, JSON_SCHEMA, Type } = createRequire(import.meta.resolve('@deepseek-ai/dsh-app-boot'))('js-yaml')
// This is the rc.3 Include's entryListSchema, which is internal to app-boot.
// LOADER_EXPRESSION_SCHEMA is JSON Schema metadata, not a YAML Schema instance.
const entryListSchema = JSON_SCHEMA.extend(new Type('tag:yaml.org,2002:js', {
  kind: 'scalar', resolve: data => typeof data === 'string', construct: data => ({ __jsExpr: data }),
}))
const DEFAULT_LIMITS = Object.freeze({ maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024, maxSources: 256, maxNodes: 50000, maxDepth: 64 })
const PRODUCT = '@ljwei-stak/dsh-model-route-bot'
const MR = 'model-router-galgame'
const AUTO = 'web-search-auto'
const SEARCH = `${PRODUCT}/web-search`
const DS = 'ds-bot'
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const expr = value => record(value) && typeof value.__jsExpr === 'string'
const copy = value => structuredClone(value)
const hash = value => createHash('sha256').update(value).digest('hex')
const stable = value => JSON.stringify(value, (_key, item) => record(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const within = (path, root) => { const rest = relative(root, path); return !rest || (!rest.startsWith(`..${sep}`) && rest !== '..' && !isAbsolute(rest)) }
const groups = entry => (entry.group === true || ['cordis:group', '@deepseek-ai/cordis-plugin-group'].includes(entry.name)) && Array.isArray(entry.config)
const walk = (entries, visit, parents = []) => { for (const entry of entries) { visit(entry, parents); if (groups(entry)) walk(entry.config, visit, [...parents, entry]) } }
const dynamic = value => expr(value) || (Array.isArray(value) ? value.some(dynamic) : record(value) && Object.values(value).some(dynamic))

async function boundedRead(path, maximum) {
  const file = await open(path, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > maximum) throw Object.assign(new Error('source-limit'), { code: 'SOURCE_LIMIT' })
    const chunks = []
    let size = 0
    while (size <= maximum) {
      const bytes = Buffer.alloc(Math.min(65536, maximum + 1 - size))
      const value = await file.read(bytes, 0, bytes.length, size)
      if (!value.bytesRead) break
      size += value.bytesRead; chunks.push(bytes.subarray(0, value.bytesRead))
    }
    if (size > maximum) throw Object.assign(new Error('source-limit'), { code: 'SOURCE_LIMIT' })
    const after = await file.stat()
    return { bytes: Buffer.concat(chunks), before, changed: before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs }
  } finally { await file.close() }
}

function boundedData(value, limits, depth = 0, state = { nodes: 0, active: new Set() }) {
  if (++state.nodes > limits.maxNodes || depth > limits.maxDepth) throw new Error('data-limit')
  if (value === null || typeof value !== 'object') return
  if (state.active.has(value)) throw new Error('cyclic-data')
  state.active.add(value)
  for (const item of Object.values(value)) boundedData(item, limits, depth + 1, state)
  state.active.delete(value)
}

const ACTIONS = Object.freeze({
  NEEDS_LAUNCH_CONTEXT: 'provide-explicit-launch-context',
  SOURCE_READ_FAILED: 'select-readable-source-files', SOURCE_CHANGED: 'refresh-preview-after-source-stops-changing',
  INVALID_MANIFEST: 'repair-source-manifest', INVALID_PATCH: 'repair-source-patch',
  UNSUPPORTED_BUNDLE: 'provide-supported-bundle-mapping', BUNDLE_ORDER_MISMATCH: 'provide-the-exact-ordered-bundle-layers',
  SOURCE_LINK_OUTSIDE_ROOT: 'explicitly-select-the-linked-source-root',
  DUPLICATE_ENTRY: 'remove-conflicting-entry-definitions', DUPLICATE_RUNTIME: 'select-one-runtime-authority',
  UNSUPPORTED_RUNTIME: 'provide-explicit-runtime-option-mapping', UNSUPPORTED_SEARCH: 'provide-explicit-search-entry-mapping',
  SEARCH_PROVIDER_MISSING: 'select-a-provider-or-enable-auto', TARGET_COMPOSITION_CONFLICT: 'review-target-bundle-and-config-layers',
  PATCH_SKIPPED: 'review-skipped-source-patch', NO_PRODUCT_ENTRY: 'select-a-profile-containing-ds-or-model-router',
  SOURCE_LIMIT: 'select-smaller-bounded-config-sources', INVALID_LIMITS: 'use-supported-preview-limits',
  INVALID_INTENT: 'select-an-explicit-supported-intent', INSTALL_SOURCE_NOT_EMPTY: 'use-migration-for-an-existing-product',
  ORPHAN_ROUTER_SETTINGS_REACTIVATED: 'review-router-settings-reactivated-by-install',
  ORPHAN_LEGACY_BOT_PATCH: 'review-unmapped-legacy-bot-settings',
})

/** Only this whitelist may cross a diagnostic/evidence boundary. No config,
 * expression, path, package label, exception message, or secret is copied. */
export function summarizeProfileMigration(plan) {
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : 0
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
  const list = Array.isArray(plan.diagnostics) ? plan.diagnostics.slice(0, 256) : []
  return {
    schemaVersion: 1, status: ['ready', 'blocked', 'needs-launch-context', 'source-changed'].includes(plan.status) ? plan.status : 'blocked',
    intent: ['migration', 'install-unified-product'].includes(plan.intent) ? plan.intent : 'unknown',
    sourceCount: count(plan.sources?.length), sourceDigest: digest(plan.sourceDigest),
    planDigest: digest(plan.planDigest),
    bundleCountBefore: count(plan.bundleCountBefore),
    bundleCountAfter: count(plan.proposal?.manifest?.dsh?.profile?.bundles?.length),
    runtimeCountBefore: count(plan.counts?.runtime), searchCountBefore: count(plan.counts?.search),
    suggestedChangeCount: count(plan.proposal?.changes?.length),
    diagnostics: list.map(item => {
      const code = Object.hasOwn(ACTIONS, item?.code) ? item.code : 'UNKNOWN_DIAGNOSTIC'
      return { code, severity: ['error', 'warning', 'needs-launch-context'].includes(item?.severity) ? item.severity : 'error',
        action: ACTIONS[code] ?? 'review-private-plan' }
    }),
  }
}

/** Recheck both bytes and file identity. It does not acquire a writer lock or
 * claim a cross-domain data snapshot; this module only plans configuration. */
export async function verifyProfileMigrationSources(plan) {
  const changedSourceIndices = [], changedMissingSourceIndices = []
  if (!Array.isArray(plan.sources) || plan.sources.length > DEFAULT_LIMITS.maxSources ||
    !Array.isArray(plan.missingSources ?? []) || (plan.missingSources?.length ?? 0) > DEFAULT_LIMITS.maxSources) {
    return { unchanged: false, changedSourceIndices, changedMissingSourceIndices, invalidPlan: true }
  }
  const maximum = Math.min(DEFAULT_LIMITS.maxFileBytes, plan.limits?.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes)
  const totalMaximum = Math.min(DEFAULT_LIMITS.maxTotalBytes, plan.limits?.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes)
  let total = 0
  for (let index = 0; index < plan.sources.length; index++) {
    const source = plan.sources[index]
    try {
      const [{ bytes, before: info, changed }, canonical] = await Promise.all([boundedRead(source.path, Math.min(maximum, Math.max(0, totalMaximum - total))), realpath(source.path)])
      total += bytes.length
      if (changed || total > totalMaximum || hash(bytes) !== source.sha256 || info.dev !== source.identity.dev || info.ino !== source.identity.ino || canonical !== source.realPath) changedSourceIndices.push(index)
    } catch { changedSourceIndices.push(index) }
  }
  for (let index = 0; index < (plan.missingSources ?? []).length; index++) {
    try { await stat(plan.missingSources[index]); changedMissingSourceIndices.push(index) }
    catch (error) { if (error?.code !== 'ENOENT') changedMissingSourceIndices.push(index) }
  }
  return { unchanged: changedSourceIndices.length === 0 && changedMissingSourceIndices.length === 0, changedSourceIndices, changedMissingSourceIndices }
}

/** Read-only, deterministic configuration plan. All paths are owner-selected.
 * Required launch context:
 *   profileDir, dshHome, launchCwd: absolute paths;
 *   orderedBundleLayers: [{ packageName, packageDir }], exactly manifest order;
 *   launcherLayers: [{ path } | { patches, label? }], explicit [] means none;
 *   targetBundleLayer: { packageName: PRODUCT, packageDir }.
 * intent defaults to 'migration'. An explicit 'install-unified-product' plans
 * a new entry only when the source has no DS/MR entry; it does not prove an
 * empty data home and does not apply or activate the product.
 * launchEnvironment must explicitly contain the old relevant environment ({}
 * is valid) when no workspace config is saved. Never read process.env here.
 * expectedSources may be the sources from an earlier plan, for stale-preview
 * detection. The returned plan is PRIVATE; use summarizeProfileMigration for
 * public evidence. No apply, installer, expression evaluation or model work.
 */
export async function previewProfileMigration(options = {}) {
  const plan = { schemaVersion: 1, kind: 'configuration-only', status: 'blocked', sources: [], missingSources: [], layers: [], diagnostics: [],
    intent: options.intent === undefined ? 'migration' : ['migration', 'install-unified-product'].includes(options.intent) ? options.intent : 'unknown',
    context: {}, counts: { runtime: 0, search: 0 }, proposal: null, sourceDigest: null, planDigest: null }
  const diagnose = (code, severity = 'error', detail = {}) => {
    plan.diagnostics.push({ code, severity, ...detail })
  }
  plan.limits = { ...DEFAULT_LIMITS }
  if (plan.intent === 'unknown') diagnose('INVALID_INTENT')
  if (options.limits !== undefined && !record(options.limits)) diagnose('INVALID_LIMITS')
  else for (const [key, value] of Object.entries(options.limits ?? {})) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) diagnose('INVALID_LIMITS')
    else plan.limits[key] = value
  }
  const finish = async () => {
    const verified = await verifyProfileMigrationSources(plan)
    if (!verified.unchanged) diagnose('SOURCE_CHANGED', 'error', { sourceIndices: verified.changedSourceIndices, missingSourceIndices: verified.changedMissingSourceIndices })
    plan.sourceDigest = hash(stable({ files: plan.sources.map(({ path, sha256, realPath, identity }) => ({ path, sha256, realPath, identity })), missing: plan.missingSources }))
    plan.status = plan.diagnostics.some(item => item.code === 'SOURCE_CHANGED') ? 'source-changed'
      : plan.diagnostics.some(item => item.severity === 'error') ? 'blocked'
        : plan.diagnostics.some(item => item.severity === 'needs-launch-context') ? 'needs-launch-context' : 'ready'
    if (plan.proposal) plan.planDigest = hash(stable({ context: plan.context, sourceDigest: plan.sourceDigest, proposal: plan.proposal }))
    plan.summary = summarizeProfileMigration(plan)
    return plan
  }
  const requiredPaths = ['profileDir', 'dshHome', 'launchCwd']
  for (const key of requiredPaths) {
    if (typeof options[key] !== 'string' || !isAbsolute(options[key])) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: key })
    else plan.context[key] = resolve(options[key])
  }
  if (!Array.isArray(options.orderedBundleLayers)) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'orderedBundleLayers' })
  if (!Array.isArray(options.launcherLayers)) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'launcherLayers' })
  if (!record(options.targetBundleLayer)) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'targetBundleLayer' })
  if (plan.diagnostics.length) return finish()
  if (options.orderedBundleLayers.length > plan.limits.maxSources || options.launcherLayers.length > plan.limits.maxSources) {
    diagnose('SOURCE_LIMIT'); return finish()
  }
  plan.context.launchEnvironment = options.launchEnvironment === undefined ? null
    : { ...(typeof options.launchEnvironment?.DS_BOT_WORKSPACE === 'string' ? { DS_BOT_WORKSPACE: options.launchEnvironment.DS_BOT_WORKSPACE } : {}) }
  if (options.availableSearchProviderIds !== undefined && (!Array.isArray(options.availableSearchProviderIds) ||
    options.availableSearchProviderIds.length > plan.limits.maxSources || options.availableSearchProviderIds.some(value => typeof value !== 'string' || value.length > 256))) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'availableSearchProviderIds' })
  if (options.targetDependencySpec !== undefined && (typeof options.targetDependencySpec !== 'string' || !options.targetDependencySpec || options.targetDependencySpec.length > 4096)) diagnose('UNSUPPORTED_BUNDLE', 'error', { field: 'targetDependencySpec' })
  const seenFiles = new Map(), requestedFiles = new Set()
  let totalBytes = 0
  async function snapshot(path, root, { optional = false, missingIsContext = false } = {}) {
    path = resolve(path)
    if (seenFiles.has(path)) return seenFiles.get(path)
    if (plan.missingSources.includes(path)) return null
    if (requestedFiles.has(path)) return null
    if (requestedFiles.size >= plan.limits.maxSources) { diagnose('SOURCE_LIMIT'); return null }
    requestedFiles.add(path)
    try {
      const canonicalRoot = await realpath(root)
      const canonical = await realpath(path)
      if (!within(canonical, canonicalRoot)) { diagnose('SOURCE_LINK_OUTSIDE_ROOT', 'error', { path }); return null }
      const { bytes, before, changed } = await boundedRead(path, Math.min(plan.limits.maxFileBytes, plan.limits.maxTotalBytes - totalBytes))
      const [currentCanonical, currentInfo] = await Promise.all([realpath(path), stat(canonical)])
      if (currentCanonical !== canonical || currentInfo.dev !== before.dev || currentInfo.ino !== before.ino) {
        diagnose('SOURCE_CHANGED', 'error', { path }); return null
      }
      totalBytes += bytes.length
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const source = { path, realPath: canonical, sha256: hash(bytes), bytes: bytes.length, text,
        identity: { dev: before.dev, ino: before.ino } }
      if (changed) diagnose('SOURCE_CHANGED', 'error', { path })
      const expected = options.expectedSources?.find(item => item.path === path)
      if (expected && (expected.sha256 !== source.sha256 || expected.realPath !== source.realPath ||
        expected.identity?.dev !== source.identity.dev || expected.identity?.ino !== source.identity.ino)) diagnose('SOURCE_CHANGED', 'error', { path })
      plan.sources.push(source); seenFiles.set(path, source)
      return source
    } catch (error) {
      if (optional && error?.code === 'ENOENT') { if (!plan.missingSources.includes(path)) plan.missingSources.push(path); return null }
      if (missingIsContext && error?.code === 'ENOENT') { diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'launcher-layer', path }); return null }
      diagnose(error?.code === 'SOURCE_LIMIT' ? 'SOURCE_LIMIT' : 'SOURCE_READ_FAILED', 'error', { path })
      return null
    }
  }
  async function manifestAt(dir) {
    const source = await snapshot(join(dir, 'package.json'), dir)
    if (!source) return null
    try {
      const value = JSON.parse(source.text)
      boundedData(value, plan.limits)
      if (!record(value)) throw new Error('not-object')
      return value
    } catch { diagnose('INVALID_MANIFEST', 'error', { path: source.path }); return null }
  }
  function patchData(value, sourcePath) {
    boundedData(value, plan.limits)
    if (!Array.isArray(value) || value.some(item => !record(item))) throw new Error('not-patch-list')
    value = copy(value)
    const anchor = entry => {
      if (!record(entry)) throw new Error('not-entry')
      if (typeof entry.name === 'string' && (isAbsolute(entry.name) || entry.name.startsWith('./') || entry.name.startsWith('../'))) {
        if (!sourcePath) throw new Error('inline-relative-plugin')
        entry.name = pathToFileURL(resolve(dirname(sourcePath), entry.name)).href
      }
      if (groups(entry)) entry.config.forEach(anchor)
    }
    for (const patch of value) {
      if (patch.insert !== undefined && !Array.isArray(patch.insert)) throw new Error('not-insert-list')
      patch.insert?.forEach(anchor)
    }
    return value
  }
  async function fileLayer(path, root, kind, { optional = false, missingIsContext = false } = {}) {
    const source = await snapshot(path, root, { optional, missingIsContext })
    if (!source) return null
    try {
      const layer = { kind, path: source.path, patches: patchData(load(source.text, { schema: entryListSchema }), source.path) }
      plan.layers.push(layer)
      return layer
    } catch (error) { diagnose('INVALID_PATCH', 'error', { path: source.path, reason: error.message }); return null }
  }
  async function bundleLayer(input, kind = 'bundle') {
    if (!record(input) || typeof input.packageName !== 'string' || typeof input.packageDir !== 'string' || !isAbsolute(input.packageDir)) {
      diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'bundle-layer' }); return null
    }
    const dir = resolve(input.packageDir), manifest = await manifestAt(dir)
    if (!manifest) return null
    let files
    try { files = bundlePatchPaths(dir, manifest.dsh?.bundle) } catch { diagnose('UNSUPPORTED_BUNDLE', 'error', { packageName: input.packageName }); return null }
    if (manifest.name !== input.packageName || files.some(path => !within(resolve(path), dir))) {
      diagnose('UNSUPPORTED_BUNDLE', 'error', { packageName: input.packageName }); return null
    }
    const layers = []
    for (const path of files) {
      if (requestedFiles.size >= plan.limits.maxSources && !seenFiles.has(resolve(path))) { diagnose('SOURCE_LIMIT'); break }
      const layer = await fileLayer(path, dir, kind)
      if (layer) { layer.packageName = input.packageName; layers.push(layer) }
    }
    return { packageName: input.packageName, packageDir: dir, manifest, layers }
  }
  const manifest = await manifestAt(plan.context.profileDir)
  if (!manifest) return finish()
  plan.originalManifest = copy(manifest)
  const names = manifest.dsh?.profile?.bundles
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) { diagnose('INVALID_MANIFEST'); return finish() }
  plan.bundleCountBefore = names.length
  if (stable(names) !== stable(options.orderedBundleLayers.map(layer => layer?.packageName))) {
    diagnose('BUNDLE_ORDER_MISMATCH'); return finish()
  }
  if (new Set(names).size !== names.length) diagnose('DUPLICATE_ENTRY', 'error', { field: 'profile-bundles' })
  const bundles = []
  for (const input of options.orderedBundleLayers) { const bundle = await bundleLayer(input); if (bundle) bundles.push(bundle) }
  const sourceBundleLayers = bundles.flatMap(bundle => bundle.layers)
  const userLayers = []
  const profileLayer = await fileLayer(join(plan.context.profileDir, 'cordis.patch.yml'), plan.context.profileDir, 'profile', { optional: true })
  if (profileLayer) userLayers.push(profileLayer)
  // Home patches follow profile patches in rc.3. Both roots are selected; a
  // file in the same directory is not accidentally applied twice by inference.
  const homeLayer = await fileLayer(join(plan.context.dshHome, 'cordis.patch.yml'), plan.context.dshHome, 'home', { optional: true })
  if (homeLayer) userLayers.push(homeLayer)
  for (const input of options.launcherLayers) {
    if (record(input) && typeof input.path === 'string' && isAbsolute(input.path)) {
      const layer = await fileLayer(input.path, dirname(input.path), 'launcher', { missingIsContext: true })
      if (layer) userLayers.push(layer)
    } else if (record(input) && Array.isArray(input.patches)) {
      try {
        boundedData(input.patches, plan.limits)
        const inlineBytes = Buffer.byteLength(stable(input.patches))
        if (inlineBytes > plan.limits.maxFileBytes || totalBytes + inlineBytes > plan.limits.maxTotalBytes) {
          diagnose('SOURCE_LIMIT'); continue
        }
        totalBytes += inlineBytes
        const layer = { kind: 'launcher-inline', label: typeof input.label === 'string' ? input.label : '', patches: patchData(input.patches) }
        plan.layers.push(layer); userLayers.push(layer)
      } catch { diagnose('INVALID_PATCH', 'error', { field: 'launcher-inline' }) }
    } else diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'launcher-layer' })
  }
  const target = await bundleLayer(options.targetBundleLayer, 'target-bundle')
  if (!target || target.packageName !== PRODUCT || typeof target.manifest.version !== 'string' || !target.manifest.version) {
    diagnose('UNSUPPORTED_BUNDLE', 'error', { field: 'target-bundle' }); return finish()
  }
  if (plan.diagnostics.some(item => item.severity !== 'warning')) return finish()
  const sourceLayers = [...sourceBundleLayers, ...userLayers]
  let warnings = []
  try { plan.effectiveBefore = composeEntries(sourceLayers.map(layer => layer.patches), message => warnings.push(message)) }
  catch { diagnose('INVALID_PATCH'); return finish() }
  for (const message of warnings) diagnose('PATCH_SKIPPED', 'warning', { message })
  const originalRows = []
  walk(plan.effectiveBefore, entry => originalRows.push(entry))
  const originalBots = originalRows.filter(entry => entry.name === DS)
  const originalRouters = originalRows.filter(entry => entry.name === PRODUCT || entry.id === MR)
  const originalSearches = originalRows.filter(entry => [SEARCH, `${DS}/web-search`].includes(entry.name) || entry.id === AUTO)
  plan.sourceState = { intent: plan.intent, runtimeEntries: originalBots.length, routerEntries: originalRouters.length, searchEntries: originalSearches.length }
  let analysisEntries = plan.effectiveBefore
  if (plan.intent === 'install-unified-product') {
    // A Host explicitly requesting installation supplies a new bundle layer.
    // Compose that layer BEFORE user/home/launcher patches, just as rc.3 will;
    // this is where formerly orphaned MR settings may become effective again.
    if (originalBots.length || originalRouters.length) { diagnose('INSTALL_SOURCE_NOT_EMPTY'); return finish() }
    warnings = []
    try {
      analysisEntries = composeEntries([...sourceBundleLayers, ...target.layers, ...userLayers].map(layer => layer.patches), message => warnings.push(message))
    } catch { diagnose('TARGET_COMPOSITION_CONFLICT'); return finish() }
    plan.installCandidate = copy(analysisEntries)
    for (const message of warnings) diagnose('PATCH_SKIPPED', 'warning', { message })
    const routerOrphans = userLayers.flatMap(layer => layer.patches).filter(patch => !patch.insert && patch.id === MR && (!patch.name || patch.name === PRODUCT))
    if (routerOrphans.length) diagnose('ORPHAN_ROUTER_SETTINGS_REACTIVATED', 'warning', { patchCount: routerOrphans.length })
    const botOrphans = userLayers.flatMap(layer => layer.patches).filter(patch => !patch.insert && patch.id === 'bot')
    if (botOrphans.length) diagnose('ORPHAN_LEGACY_BOT_PATCH', 'warning', { patchCount: botOrphans.length })
  }
  const flat = [], parentsOf = new Map()
  walk(analysisEntries, (entry, parents) => {
    flat.push(entry)
    parentsOf.set(entry, parents)
    if (expr(entry.name) || expr(entry.id) || expr(entry.group) || (entry.group === true && !Array.isArray(entry.config)) ||
      ['cordis:include', '@deepseek-ai/cordis-plugin-include'].includes(entry.name)) {
      diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'dynamic-entry-or-include', entryId: entry.id })
    }
  })
  const ids = new Set()
  for (const entry of flat) {
    if (typeof entry.id === 'string') { if (ids.has(entry.id)) diagnose('DUPLICATE_ENTRY', 'error', { entryId: entry.id }); ids.add(entry.id) }
  }
  const bots = flat.filter(entry => entry.name === DS), routers = flat.filter(entry => entry.name === PRODUCT || entry.id === MR)
  const searches = flat.filter(entry => [SEARCH, `${DS}/web-search`].includes(entry.name) || entry.id === AUTO)
  plan.counts = { runtime: originalBots.length + originalRouters.filter(entry => entry.config?.botProduct === true || entry.config?.botRuntime !== undefined ||
    originalSearches.some(search => search.name === SEARCH)).length, search: originalSearches.length }
  if (bots.length > 1 || routers.length > 1) diagnose('DUPLICATE_RUNTIME')
  if (searches.length > 1) diagnose('UNSUPPORTED_SEARCH', 'error', { field: 'duplicate-search' })
  if (!bots.length && !routers.length) diagnose('NO_PRODUCT_ENTRY')
  const bot = bots[0], router = routers[0], search = searches[0]
  const disabled = entry => entry?.disabled === true || parentsOf.get(entry)?.some(parent => parent.disabled === true)
  if (router && (router.id !== MR || router.name !== PRODUCT || groups(router))) diagnose('UNSUPPORTED_RUNTIME', 'error', { field: 'router-entry' })
  if (bot && (typeof bot.id !== 'string' || Object.keys(bot).some(key => !['id', 'name', 'config', 'disabled'].includes(key)))) diagnose('UNSUPPORTED_RUNTIME', 'error', { field: 'legacy-entry-options' })
  if (search && (search.id !== AUTO || ![SEARCH, `${DS}/web-search`].includes(search.name))) diagnose('UNSUPPORTED_SEARCH')
  if (bot && router && (router.config?.botProduct === true || router.config?.botRuntime !== undefined)) diagnose('DUPLICATE_RUNTIME')
  if (bot && router && !disabled(bot) && disabled(router)) diagnose('UNSUPPORTED_RUNTIME', 'error', { field: 'independent-disabled-states' })
  for (const entry of [bot, router, search].filter(Boolean)) {
    if (parentsOf.get(entry).some(parent => Object.keys(parent).some(key => !['id', 'name', 'group', 'config', 'disabled'].includes(key)))) {
      diagnose('UNSUPPORTED_RUNTIME', 'error', { field: 'inherited-group-options', entryId: entry.id })
    }
  }
  for (const entry of [bot, router, search].filter(Boolean)) {
    if (entry.config !== undefined && (!record(entry.config) || dynamic(entry.config))) {
      diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'dynamic-runtime-config', entryId: entry.id })
    }
  }
  const web = flat.filter(entry => entry.id === 'web')
  // Other SDK rows may decide their enabled state at activation. Migration
  // does not touch those rows and must not evaluate or freeze that decision.
  // Only a changed target, or its ancestry, needs a known disabled state.
  const targetScope = new Set()
  for (const entry of [...bots, ...routers, ...searches, ...web]) {
    for (const scoped of [entry, ...parentsOf.get(entry)]) {
      targetScope.add(scoped)
      if (expr(scoped.disabled)) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'dynamic-target-disabled', entryId: scoped.id })
    }
  }
  const untouchedDynamicDisabled = flat.filter(entry => expr(entry.disabled) && !targetScope.has(entry))
  if (web.length > 1) diagnose('DUPLICATE_ENTRY', 'error', { entryId: 'web' })
  if (web[0]?.config !== undefined && (!record(web[0].config) || dynamic(web[0].config))) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'dynamic-web-config' })
  // Removing a bundle is safe only for the known DS contributions. Never drop
  // extra plugins or package-specific configuration together with it.
  for (const bundle of bundles) {
    if (![DS, PRODUCT].includes(bundle.packageName)) continue
    if (Object.keys(bundle.manifest.dsh.bundle).some(key => key !== 'patch')) diagnose('UNSUPPORTED_BUNDLE', 'error', { packageName: bundle.packageName })
    for (const layer of bundle.layers) for (const patch of layer.patches) {
      if (patch.insert) {
        const allowed = bundle.packageName === DS ? { bot: DS, [AUTO]: `${DS}/web-search` } : { [MR]: PRODUCT, [AUTO]: SEARCH }
        if (patch.id || patch.insert.some(row => allowed[row.id] !== row.name)) diagnose('UNSUPPORTED_BUNDLE', 'error', { packageName: bundle.packageName })
      } else if (patch.id !== 'web' || Object.keys(patch).some(key => !['id', 'name', 'config', 'disabled'].includes(key))) diagnose('UNSUPPORTED_BUNDLE', 'error', { packageName: bundle.packageName })
    }
  }
  if (plan.diagnostics.some(item => item.severity !== 'warning')) return finish()
  const runtimeConfig = copy(bot?.config ?? router?.config?.botRuntime ?? {})
  try { BotRuntimeConfig(copy(runtimeConfig)) } catch { diagnose('UNSUPPORTED_RUNTIME', 'error', { field: 'runtime-config-types' }) }
  if (dynamic(runtimeConfig.home) || dynamic(runtimeConfig.workspace)) { diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'runtime-path' }); return finish() }
  for (const key of ['home', 'workspace']) if (runtimeConfig[key] !== undefined && runtimeConfig[key] !== null && (typeof runtimeConfig[key] !== 'string' || runtimeConfig[key] === '')) diagnose('UNSUPPORTED_RUNTIME', 'error', { field: key })
  if (!Object.hasOwn(options, 'launchEnvironment') && runtimeConfig.workspace == null) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'launchEnvironment' })
  if (options.launchEnvironment !== undefined && !record(options.launchEnvironment)) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'launchEnvironment' })
  if (plan.diagnostics.some(item => item.severity !== 'warning')) return finish()
  const effectiveHome = resolve(plan.context.launchCwd, runtimeConfig.home ?? join(plan.context.dshHome, 'bot'))
  const configuredWorkspace = runtimeConfig.workspace ?? (typeof options.launchEnvironment?.DS_BOT_WORKSPACE === 'string' ? options.launchEnvironment.DS_BOT_WORKSPACE.trim() : '')
  plan.runtimePaths = { configuredHome: runtimeConfig.home ?? null, configuredWorkspace: runtimeConfig.workspace ?? null, effectiveHome,
    effectiveWorkspace: resolve(plan.context.launchCwd, configuredWorkspace || join(runtimeConfig.home ?? join(plan.context.dshHome, 'bot'), 'workspace')) }
  const routerConfig = { ...copy(router?.config ?? {}), botRuntime: runtimeConfig }
  // Preserve whether the old DS runtime was disabled, independently of the MR
  // body. This turns only the product-composition switch into an explicit edit.
  if (bot) routerConfig.botProduct = !disabled(bot)
  const routerOverrides = router ? copy(router) : { id: MR, name: PRODUCT }
  delete routerOverrides.group
  routerOverrides.id = MR; routerOverrides.name = PRODUCT; routerOverrides.config = routerConfig
  if (router && disabled(router)) routerOverrides.disabled = true
  const finalOverrides = [routerOverrides]
  if (search) finalOverrides.push({ ...copy(search), id: AUTO, name: SEARCH, ...(disabled(search) ? { disabled: true } : {}) })
  if (web[0]) finalOverrides.push(copy(web[0]))

  // These are proposed edits, not writes. Remove retired entry declarations
  // and fold their final effective config into one trailing compatibility
  // layer. Keeping the old raw text in sources is mandatory for review/backup.
  const retiredIds = new Set([bot?.id, MR].filter(Boolean))
  function rewriteEntries(entries) {
    return entries.filter(entry => !retiredIds.has(entry.id) && !(entry.id === AUTO && entry.name === `${DS}/web-search`)).map(entry => {
      const result = copy(entry)
      if (groups(result)) result.config = rewriteEntries(result.config)
      return result
    })
  }
  function rewritePatches(patches) {
    const result = []
    for (const input of patches) {
      const patch = copy(input)
      if (patch.insert) { patch.insert = rewriteEntries(patch.insert); if (patch.insert.length) result.push(patch); continue }
      if (bot && patch.id === bot.id) continue
      if (search?.name === `${DS}/web-search` && patch.id === AUTO && patch.name === `${DS}/web-search`) patch.name = SEARCH
      result.push(patch)
    }
    return result
  }
  const targetLayers = [], targetNames = []
  let inserted = false
  for (const bundle of bundles) {
    if (bundle.packageName === DS) continue
    if (bundle.packageName === PRODUCT) {
      targetLayers.push(...target.layers.map(layer => ({ ...copy(layer), kind: 'replacement-bundle' }))); targetNames.push(PRODUCT); inserted = true
    } else { targetLayers.push(...copy(bundle.layers)); targetNames.push(bundle.packageName) }
  }
  if (!inserted) { targetLayers.push(...copy(target.layers)); targetNames.push(PRODUCT) }
  const proposedUserLayers = userLayers.map(layer => ({ ...copy(layer), patches: rewritePatches(layer.patches) }))
  targetLayers.push(...proposedUserLayers, { kind: 'compatibility-final', patches: finalOverrides })
  warnings = []
  let effectiveAfter
  try { effectiveAfter = composeEntries(targetLayers.map(layer => layer.patches), message => warnings.push(message)) }
  catch { diagnose('TARGET_COMPOSITION_CONFLICT'); return finish() }
  const after = []
  walk(effectiveAfter, entry => after.push(entry))
  // A digest multiset also handles untouched rows without a saved id, without
  // inventing an id or relying on their activation-time disabled expression.
  const beforeDisabledHashes = untouchedDynamicDisabled.map(entry => hash(stable(entry))).sort()
  const afterCounts = new Map()
  for (const entry of after.filter(entry => expr(entry.disabled))) {
    const digest = hash(stable(entry))
    afterCounts.set(digest, (afterCounts.get(digest) ?? 0) + 1)
  }
  const afterDisabledHashes = beforeDisabledHashes.map(digest => {
    const count = afterCounts.get(digest) ?? 0
    if (count) { afterCounts.set(digest, count - 1); return digest }
    return null
  })
  const preservedDynamicDisabled = { entryCount: beforeDisabledHashes.length,
    beforeDigest: hash(stable(beforeDisabledHashes)), afterDigest: hash(stable(afterDisabledHashes)),
    equal: stable(beforeDisabledHashes) === stable(afterDisabledHashes) }
  if (!preservedDynamicDisabled.equal) diagnose('TARGET_COMPOSITION_CONFLICT', 'error', { field: 'untouched-dynamic-disabled' })
  if (after.filter(entry => entry.id === MR && entry.name === PRODUCT).length !== 1 || after.some(entry => entry.name === DS) ||
    after.filter(entry => entry.id === AUTO).length !== 1) diagnose('TARGET_COMPOSITION_CONFLICT')
  const targetAuto = after.find(entry => entry.id === AUTO), targetWeb = after.find(entry => entry.id === 'web')
  // No web row means the selected composition cannot consume this provider.
  if (!targetWeb || (targetWeb.disabled !== true && targetWeb.config?.searchProvider === 'auto' && targetAuto?.disabled === true)) diagnose('SEARCH_PROVIDER_MISSING')
  if (targetWeb?.disabled !== true && typeof targetWeb?.config?.searchProvider === 'string' && targetWeb.config.searchProvider !== 'auto') {
    if (!Array.isArray(options.availableSearchProviderIds)) diagnose('NEEDS_LAUNCH_CONTEXT', 'needs-launch-context', { field: 'availableSearchProviderIds' })
    else if (!options.availableSearchProviderIds.includes(targetWeb.config.searchProvider)) diagnose('SEARCH_PROVIDER_MISSING')
  }
  const newManifest = copy(manifest)
  newManifest.dsh.profile.bundles = targetNames
  const removedDependencies = []
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (Object.hasOwn(newManifest[field] ?? {}, DS)) { delete newManifest[field][DS]; removedDependencies.push(field) }
  }
  // Installation verification belongs to the later installer. This records
  // the explicitly selected target artifact version; it does not run npm.
  const productDependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies'].filter(field => Object.hasOwn(newManifest[field] ?? {}, PRODUCT))
  if (productDependencyFields.length > 1) diagnose('TARGET_COMPOSITION_CONFLICT', 'error', { field: 'duplicate-product-dependencies' })
  const dependencyField = productDependencyFields[0] ?? 'dependencies'
  newManifest[dependencyField] = { ...newManifest[dependencyField], [PRODUCT]: options.targetDependencySpec ?? target.manifest.version }
  plan.proposal = { intent: plan.intent, manifest: newManifest, targetLayers, finalOverrides, effectiveEntries: effectiveAfter, preservedDynamicDisabled,
    targetArtifact: { intent: plan.intent, packageName: PRODUCT, version: target.manifest.version, dependencyField,
      dependencySpec: newManifest[dependencyField][PRODUCT] },
    requiresTrailingLayer: true, requiresInstallerVerification: true,
    changes: [...(plan.intent === 'install-unified-product' ? [{ kind: 'install-unified-product', sourceRuntimeEntries: 0, sourceRouterEntries: 0 }] : []),
      { kind: 'replace-profile-bundles', before: names, after: targetNames },
      ...removedDependencies.map(field => ({ kind: 'remove-retired-dependency', field, packageName: DS })),
      { kind: 'preserve-mr-config-and-fold-runtime', entryId: MR },
      { kind: 'rewrite-search-assertions', from: `${DS}/web-search`, to: SEARCH }],
    originalUserLayers: copy(userLayers), warnings,
  }
  return finish()
}
