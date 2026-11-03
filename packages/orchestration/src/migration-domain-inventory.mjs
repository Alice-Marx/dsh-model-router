import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const UNKNOWN_DOMAINS = Object.freeze(['sessions', 'attachments', 'workspace', 'usage', 'router', 'funding', 'remote-agent', 'cli-state', 'external-connectors', 'permissions'])
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const stable = value => Array.isArray(value) ? value.map(stable) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const digest = value => createHash('sha256').update(JSON.stringify(stable(value)) + '\n').digest('hex')
const within = (root, path) => { const rest = relative(root, path); return !rest || (rest !== '..' && !rest.startsWith('..' + sep) && !isAbsolute(rest)) }

/** PRIVATE deterministic seam, only after archive reverification and comparison
 * with the owner's independently expected binding. Not an attestation or live
 * scan. Reads no configuration, source or secret files; layout is not authority.
 */
export function observeCapturedMigrationDomainInventory ({ archive, configurationPlan: plan, input, binding }) {
  const diagnostics = [], domains = []
  const add = (code, domain, severity = 'needs-context') => diagnostics.push({ code, domain, severity })
  const sources = archive.sourceInventory.sources, context = plan.context, paths = plan.runtimePaths
  let home = null
  if (plan.kind === 'configuration-only' && plan.status === 'ready' && plan.intent === 'migration' && record(context) && record(paths) &&
      ['dshHome', 'launchCwd'].every(key => typeof context[key] === 'string' && isAbsolute(context[key])) &&
      (paths.configuredHome === null || (typeof paths.configuredHome === 'string' && paths.configuredHome.length > 0)) &&
      typeof paths.effectiveHome === 'string' && isAbsolute(paths.effectiveHome)) {
    const derived = resolve(context.launchCwd, paths.configuredHome ?? join(context.dshHome, 'bot'))
    if (derived === paths.effectiveHome) home = derived
  }
  function locate (domain, path, type, required) {
    const row = { domain, required, state: 'unknown', location: null }
    domains.push(row)
    if (!path) { add('CONFIGURATION_PATH_AUTHORITY_UNAVAILABLE', domain); return row }
    const matches = sources.filter(source => within(source.root, path))
    if (matches.length !== 1) {
      add(matches.length ? 'CAPTURE_ROOT_AMBIGUOUS' : 'REQUIRED_CAPTURE_ROOT_MISSING', domain, 'error')
      return row
    }
    const source = matches[0], part = relative(source.root, path).split(sep).join('/')
    row.location = { sourceId: source.id, path: part }
    const entries = source.entries.filter(entry => entry.path === part)
    if (entries.length > 1) { add('CAPTURE_ENTRY_AMBIGUOUS', domain, 'error'); return row }
    if (!entries.length) {
      row.state = 'absent'
      if (required) add('REQUIRED_DOMAIN_ENTRY_MISSING', domain, 'error')
    } else if (entries[0].type !== type) add('DOMAIN_ENTRY_TYPE_MISMATCH', domain, 'error')
    else row.state = 'observed'
    return row
  }
  locate('bot-data', home, 'directory', true)
  const team = locate('team', home && join(home, 'state.json'), 'file', true)
  const secrets = locate('secrets', home && join(home, 'secrets.json'), 'file', false)
  const memory = locate('memory', home && join(home, 'memory'), 'directory', false)
  for (const row of [team, secrets]) {
    const ref = input.layout[row.domain]
    if (row.location && (row.state === 'observed' || ref != null) &&
        (!record(ref) || ref.sourceId !== row.location.sourceId || ref.path !== row.location.path)) add('FIXED_DOMAIN_LAYOUT_MISMATCH', row.domain, 'error')
  }
  const selection = input.layout.supportingDomains?.memory
  if (memory.state === 'observed') {
    if (!Array.isArray(selection) || !selection.length) add('REQUIRED_MEMORY_SELECTION_MISSING', 'memory')
    else if (selection.length !== 1 || !record(selection[0]) || selection[0].sourceId !== memory.location.sourceId ||
      (selection[0].prefix ?? '') !== memory.location.path) add('FIXED_DOMAIN_LAYOUT_MISMATCH', 'memory', 'error')
  } else if (memory.state === 'absent' && Array.isArray(selection) && selection.length) add('FIXED_DOMAIN_LAYOUT_MISMATCH', 'memory', 'error')
  for (const domain of UNKNOWN_DOMAINS) {
    domains.push({ domain, required: true, state: 'unknown', location: null })
    add('PROVIDER_PATH_AUTHORITY_UNAVAILABLE', domain)
  }
  const mapped = new Set(domains.flatMap(row => row.location ? [row.location.sourceId] : []))
  for (const source of sources) if (!mapped.has(source.id)) add('ADDITIONAL_CAPTURE_ROOT_UNCLASSIFIED', 'inventory')
  return {
    schemaVersion: 1, kind: 'private-captured-domain-inventory-observation',
    coverage: 'configuration-derived-captured-obligations-only',
    status: diagnostics.some(row => row.severity === 'error') ? 'blocked' : 'needs-context',
    domains, diagnostics, captureFingerprint: archive.sourceInventory.fingerprint,
    epochBindingDigest: digest(binding), captureEpochStatus: 'unproven', complete: false,
    crossDomainConsistent: false, databaseConsistent: false, requiresStopProof: true,
    applySupported: false, activationSupported: false, postActivationRollbackSupported: false,
    stopWriteProvable: false, permissionsRestored: false,
  }
}
