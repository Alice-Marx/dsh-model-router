import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundlePatchPaths, composeEntries } from '@deepseek-ai/dsh-app-boot'
import { readVerifiedMigrationDataArchive } from './migration-data-archive.mjs'
import { hashPrivateMigrationFile } from './migration-private-files.mjs'

// Match the pinned app-boot Include dialect. The js tag is inert AST data;
// neither this parser nor composeEntries loads plugins or runs expressions.
const { load, JSON_SCHEMA, Type } = createRequire(import.meta.resolve('@deepseek-ai/dsh-app-boot'))('js-yaml')
const schema = JSON_SCHEMA.extend(new Type('tag:yaml.org,2002:js', {
  kind: 'scalar', resolve: data => typeof data === 'string', construct: data => ({ __jsExpr: data }),
}))
const DOMAIN = '@deepseek-ai/dsh-storage-domain'
const MAX_BYTES = 64 * 1024 ** 2
const MAX_SOURCES = 256
const DIGEST = /^[a-f0-9]{64}$/
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const expression = value => record(value) && typeof value.__jsExpr === 'string'
const sha = value => createHash('sha256').update(value).digest('hex')
const stable = value => JSON.stringify(value, (_key, item) => record(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const digest = value => sha(stable(value) + '\n')
const fail = code => { throw Object.assign(new Error(code), { code }) }
const invalid = () => fail('MIGRATION_PROVIDER_CAPTURE_INVALID')
const cancelled = signal => { if (signal?.aborted) fail('MIGRATION_PROVIDER_CANCELLED') }
const within = (root, path) => { const part = relative(root, path); return !part || part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part) }
const group = entry => (entry.group === true || ['cordis:group', '@deepseek-ai/cordis-plugin-group'].includes(entry.name)) && Array.isArray(entry.config)
const dynamic = value => expression(value) || (Array.isArray(value) ? value.some(dynamic) : record(value) && Object.values(value).some(dynamic))

/** Reject executable/accessor/cyclic or excessive input before serialization.
 * Archives contain JSON; the private deterministic seam accepts only that data.
 */
function boundedJson(value) {
  let nodes = 0
  const active = new Set()
  const visit = (item, depth) => {
    if (++nodes > 500000 || depth > 64) invalid()
    if (item === null || ['string', 'boolean'].includes(typeof item)) return
    if (typeof item === 'number') { if (!Number.isFinite(item)) invalid(); return }
    if (typeof item !== 'object' || active.has(item)) invalid()
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) invalid()
    active.add(item)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
      visit(descriptor.value, depth + 1)
    }
    if (Object.getOwnPropertySymbols(item).length) invalid()
    active.delete(item)
  }
  visit(value, 0)
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > MAX_BYTES) invalid()
  return text
}

function assertBinding(expected, profileText) {
  if (!record(expected) || !DIGEST.test(expected.profilePlanDigest ?? '') ||
    profileText !== undefined && sha(profileText + '\n') !== expected.profilePlanDigest) fail('MIGRATION_PROVIDER_BINDING_INVALID')
}

// This is deliberately a replay of captured data, not a read of source paths.
// In particular, bundlePatchPaths only maps manifest metadata to path strings.
function sourceComposition(plan) {
  if (plan.schemaVersion !== 1 || plan.kind !== 'configuration-only' || !['ready', 'needs-launch-context'].includes(plan.status) ||
    !['migration', 'install-unified-product'].includes(plan.intent) || !record(plan.context) ||
    !['profileDir', 'dshHome', 'launchCwd'].every(key => typeof plan.context[key] === 'string' && isAbsolute(plan.context[key])) ||
    !Array.isArray(plan.sources) || plan.sources.length > MAX_SOURCES || !Array.isArray(plan.layers) || plan.layers.length > 2 * MAX_SOURCES ||
    !Array.isArray(plan.missingSources) || plan.missingSources.length > MAX_SOURCES || !Array.isArray(plan.effectiveBefore)) invalid()
  const sources = new Map(), manifests = []
  for (const source of plan.sources) {
    if (!record(source) || typeof source.path !== 'string' || !isAbsolute(source.path) || typeof source.realPath !== 'string' || !isAbsolute(source.realPath) ||
      !record(source.identity) || typeof source.text !== 'string' || !DIGEST.test(source.sha256 ?? '') || sources.has(source.path)) invalid()
    const bytes = Buffer.from(source.text, 'utf8')
    // TextDecoder in the planner consumes an optional UTF-8 BOM. Preserve its
    // original byte digest instead of silently normalizing the captured source.
    const original = source.bytes === bytes.length ? bytes : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])
    if (original.length !== source.bytes || source.bytes > 2 * 1024 ** 2 || sha(original) !== source.sha256) invalid()
    sources.set(source.path, source)
    if (basename(source.path) === 'package.json') {
      let manifest
      try { manifest = JSON.parse(source.text) } catch { invalid() }
      if (!record(manifest)) invalid()
      manifests.push({ source, manifest })
    }
  }
  if (plan.missingSources.some(path => typeof path !== 'string' || !isAbsolute(path) || sources.has(path)) || new Set(plan.missingSources).size !== plan.missingSources.length) invalid()
  const sourceDigest = sha(stable({ files: plan.sources.map(({ path, sha256, realPath, identity }) => ({ path, sha256, realPath, identity })), missing: plan.missingSources }))
  if (sourceDigest !== plan.sourceDigest) invalid()
  if (plan.proposal && sha(stable({ context: plan.context, sourceDigest: plan.sourceDigest, proposal: plan.proposal })) !== plan.planDigest) invalid()
  const profile = manifests.find(row => row.source.path === join(plan.context.profileDir, 'package.json'))
  if (!profile || stable(profile.manifest) !== stable(plan.originalManifest)) invalid()
  const names = profile.manifest.dsh?.profile?.bundles
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string') || new Set(names).size !== names.length) invalid()
  const allowed = ['bundle', 'profile', 'home', 'launcher', 'launcher-inline', 'target-bundle']
  let proposed = false
  for (const layer of plan.layers) {
    if (!record(layer) || !allowed.includes(layer.kind) || !Array.isArray(layer.patches)) invalid()
    if (layer.kind === 'target-bundle') proposed = true
    else if (proposed) invalid()
  }
  const layers = plan.layers.filter(layer => layer.kind !== 'target-bundle')
  const bundleLayers = layers.filter(layer => layer.kind === 'bundle')
  let cursor = 0
  for (const name of names) {
    const candidates = []
    for (const row of manifests.filter(row => row.manifest.name === name)) {
      const root = dirname(row.source.path)
      let paths
      try { paths = bundlePatchPaths(root, row.manifest.dsh?.bundle) } catch { continue }
      if (!paths.length || paths.some(path => !within(root, resolve(path)))) continue
      if (paths.every((path, index) => bundleLayers[cursor + index]?.path === path && bundleLayers[cursor + index]?.packageName === name)) candidates.push(paths)
    }
    if (candidates.length !== 1) invalid()
    cursor += candidates[0].length
  }
  if (cursor !== bundleLayers.length || layers.slice(0, cursor).some(layer => layer.kind !== 'bundle')) invalid()
  const tail = layers.slice(cursor)
  const expectedTail = []
  for (const [kind, root] of [['profile', plan.context.profileDir], ['home', plan.context.dshHome]]) {
    const path = join(root, 'cordis.patch.yml')
    if (sources.has(path)) expectedTail.push({ kind, path })
    else if (!plan.missingSources.includes(path)) invalid()
  }
  for (let index = 0; index < expectedTail.length; index++) {
    if (tail[index]?.kind !== expectedTail[index].kind || tail[index]?.path !== expectedTail[index].path) invalid()
  }
  if (tail.slice(expectedTail.length).some(layer => !['launcher', 'launcher-inline'].includes(layer.kind))) invalid()
  const sourceLayerPaths = new Set()
  for (const layer of layers) {
    if (layer.kind === 'launcher-inline') {
      if (Object.hasOwn(layer, 'path')) invalid()
      continue // owner-pinned inline input has no independent source file
    }
    const source = sources.get(layer.path)
    if (!source) invalid()
    sourceLayerPaths.add(layer.path)
    let parsed
    try {
      parsed = load(source.text, { schema })
      boundedJson(parsed)
      if (!Array.isArray(parsed) || parsed.some(patch => !record(patch))) invalid()
      const anchor = entry => {
        if (!record(entry)) invalid()
        if (typeof entry.name === 'string' && (isAbsolute(entry.name) || entry.name.startsWith('./') || entry.name.startsWith('../'))) {
          entry.name = pathToFileURL(resolve(dirname(source.path), entry.name)).href
        }
        if (group(entry)) entry.config.forEach(anchor)
      }
      for (const patch of parsed) {
        if (patch.insert !== undefined && !Array.isArray(patch.insert)) invalid()
        patch.insert?.forEach(anchor)
      }
    } catch { invalid() }
    if (stable(parsed) !== stable(layer.patches)) invalid()
  }
  // An omitted file-backed layer must not disappear behind effectiveBefore.
  // Target layers are accounted separately but never used as source authority.
  const targetPaths = new Set(plan.layers.filter(layer => layer.kind === 'target-bundle').map(layer => layer.path))
  for (const source of plan.sources) if (basename(source.path) !== 'package.json' && !sourceLayerPaths.has(source.path) && !targetPaths.has(source.path)) invalid()
  let entries, warnings = 0
  try { entries = composeEntries(layers.map(layer => structuredClone(layer.patches)), () => { warnings++ }) } catch { invalid() }
  boundedJson(entries)
  if (stable(entries) !== stable(plan.effectiveBefore)) invalid()
  return { entries, layers, warnings }
}

/** PRIVATE owner seam. Selection metadata, not concrete provider authority.
 * Do not expose the raw result as a public tool: names/ids/selectors are private.
 */
export function observeCapturedMigrationProviderSelection({ configurationPlan: plan, expected } = {}) {
  const profileText = boundedJson(plan)
  assertBinding(expected, profileText)
  const { entries, layers, warnings } = sourceComposition(plan)
  const rows = [], workspaceSelectors = []
  const walk = (entries, parents = []) => {
    for (const entry of entries) {
      if (!record(entry)) invalid()
      const issues = [], ordinal = rows.length
      const ancestry = parents.map(parent => parent.ordinal)
      const scopeOptions = Object.keys(entry).some(key => !['id', 'name', 'config', 'disabled', 'group'].includes(key))
      const inheritedScopeOptions = parents.some(parent => parent.scopeOptions)
      if (typeof entry.name !== 'string') issues.push('DYNAMIC_OR_INVALID_NAME')
      if (entry.id !== undefined && typeof entry.id !== 'string') issues.push('DYNAMIC_OR_INVALID_ID')
      if (entry.group !== undefined && typeof entry.group !== 'boolean') issues.push('DYNAMIC_OR_INVALID_GROUP')
      const uncertainControl = typeof entry.name !== 'string' || entry.id !== undefined && typeof entry.id !== 'string' ||
        entry.group !== undefined && typeof entry.group !== 'boolean'
      if (parents.some(parent => parent.uncertainControl)) issues.push('UNRESOLVED_ANCESTRY')
      if (dynamic(entry.config)) issues.push('DYNAMIC_CONFIG')
      if (scopeOptions || inheritedScopeOptions) issues.push('UNRESOLVED_SCOPE_OPTIONS')
      if (['cordis:include', '@deepseek-ai/cordis-plugin-include'].includes(entry.name)) issues.push('UNEXPANDED_INCLUDE')
      const disabledValues = [entry.disabled, ...parents.map(parent => parent.disabled)]
      const enabledState = disabledValues.includes(true) ? 'disabled' : disabledValues.some(value => value !== undefined && value !== false) ? 'unknown' : 'enabled'
      if (enabledState === 'unknown') issues.push('DYNAMIC_OR_INVALID_DISABLED')
      let classification = 'unclassified-declaration'
      if (group(entry)) classification = 'group-declaration'
      else if (entry.name === DOMAIN) classification = 'storage-domain-declaration'
      else if (entry.name === '@deepseek-ai/dsh-session-persistence') classification = 'abstract-session-service-declaration'
      else if (entry.name === '@deepseek-ai/dsh-attachment') classification = 'abstract-attachment-service-declaration'
      else if (entry.name === '@deepseek-ai/dsh-storage') classification = 'storage-hub-declaration'
      else if (entry.name === '@deepseek-ai/dsh-workspace') classification = 'workspace-consumer-declaration'
      if (classification === 'storage-domain-declaration' && !dynamic(entry.config)) {
        const config = entry.config, valid = record(config) && typeof config.backend === 'string' && config.backend.length > 0 &&
          config.backend.length <= 4096 && Object.keys(config).every(key => ['backend', 'routes'].includes(key)) &&
          (config.routes === undefined || record(config.routes) && Object.values(config.routes).every(value => typeof value === 'string' && value.length > 0 && value.length <= 4096))
        if (!valid) issues.push('INVALID_STATIC_SELECTOR')
        else if (enabledState === 'enabled' && issues.length === 0) {
          const routed = Object.hasOwn(config.routes ?? {}, 'workspace')
          workspaceSelectors.push({ ordinal, selector: routed ? config.routes.workspace : config.backend, via: routed ? 'route' : 'default', scope: 'configured-selector-only' })
        }
      }
      rows.push({ ordinal, ancestry, name: typeof entry.name === 'string' ? entry.name : null, id: typeof entry.id === 'string' ? entry.id : null,
        declaredEnabledState: enabledState, classification, configDigest: digest({ present: Object.hasOwn(entry, 'config'), value: entry.config ?? null }), entryDigest: digest(entry), issues })
      if (group(entry)) walk(entry.config, [...parents, { ordinal, scopeOptions: scopeOptions || inheritedScopeOptions, disabled: entry.disabled, uncertainControl }])
    }
  }
  walk(entries)
  return { schemaVersion: 1, kind: 'private-captured-provider-selection', coverage: 'captured-configuration-selections-only',
    status: 'needs-context', profilePlanDigest: expected.profilePlanDigest, sourceDigest: plan.sourceDigest,
    sourceLayerCount: layers.length, compositionWarningCount: warnings, inlineLauncherLayers: layers.filter(layer => layer.kind === 'launcher-inline').length,
    launcherAuthority: 'owner-declared-captured-input-only', entries: rows, workspaceSelectors,
    providers: ['sessions', 'attachments', 'workspace'].map(domain => ({ domain, state: 'unknown', reason: 'INDEPENDENT_CONCRETE_PROVIDER_AUTHORITY_UNAVAILABLE' })),
    complete: false, providerIdentityVerified: false, providerPathAuthority: false, providerGenerationAvailable: false, captureEpochStatus: 'unproven',
    applySupported: false, activationSupported: false, rollbackSupported: false, stopWriteSupported: false }
}

/** PRIVATE archive-only reader. Existing schema1/2 domain artifacts are neither
 * upgraded nor rewritten. No original file, environment or Host is consulted.
 */
export async function readCapturedMigrationProviderSelection({ dataArchive, expected, signal } = {}) {
  cancelled(signal)
  assertBinding(expected)
  if (!DIGEST.test(expected.captureManifestSha256 ?? '')) fail('MIGRATION_PROVIDER_BINDING_INVALID')
  const capture = await readVerifiedMigrationDataArchive({ privateOutput: dataArchive, signal })
  const manifest = await hashPrivateMigrationFile(capture.root, 'capture.private.json', 128 * 1024 ** 2, { signal })
  const profile = await hashPrivateMigrationFile(capture.root, 'profile-plan.private.json', MAX_BYTES, { signal })
  if (manifest.sha256 !== expected.captureManifestSha256 || profile.sha256 !== expected.profilePlanDigest) fail('MIGRATION_PROVIDER_BINDING_INVALID')
  cancelled(signal)
  return observeCapturedMigrationProviderSelection({ configurationPlan: capture.configurationPlan, expected })
}
