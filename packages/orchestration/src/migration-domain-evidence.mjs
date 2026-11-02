import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createPrivateMigrationDirectory, writePrivateMigrationFile } from './migration-private-files.mjs'
import { readVerifiedMigrationDataArchive } from './migration-data-archive.mjs'
import { exportMigrationLedger, verifyMigrationLedgerArchive } from './migration-ledger-export.mjs'
import { auditMigrationDataDomains } from './migration-domain-audit.mjs'
import { observeCapturedMigrationDomainInventory } from './migration-domain-inventory.mjs'

const ARTIFACT_FILE = 'domain-audit.private.json'
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024
const MAX_LEDGER_MANIFEST = 1024 * 1024
const MAX_DEPTH = 64
const MAX_NODES = 500000
const COVERAGE = 'captured-declared-roots-only'
const DIGEST = /^[a-f0-9]{64}$/
const LIMITS = Object.freeze({ maxFileBytes: 32 * 1024 ** 2, maxTotalBytes: 256 * 1024 ** 2, maxDecodedBytes: 256 * 1024 ** 2, maxSessions: 10000, maxDiagnostics: 256, maxJsonDepth: 64, maxJsonNodes: 500000 })
const BINDING_KEYS = ['operationId', 'operationDigest', 'domains', 'domainsDigest', 'profilePlanDigest', 'captureManifestSha256', 'captureJournalDigest', 'ledgerManifestSha256', 'ledgerContentDigest', 'domainLayoutDigest', 'domainAuditInputDigest']
const INPUT_KEYS = ['layout', 'finance', 'limits']
// Exactly the layout fields migration-domain-audit.mjs consumes. A field outside
// this set is context this module cannot verify, so it is refused rather than
// silently ignored.
const LAYOUT_KEYS = ['team', 'router', 'secrets', 'usage', 'sessions', 'attachments', 'workspacePolicy', 'workspaceRegistry', 'supportingDomains']
const ARTIFACT_KEYS = ['schemaVersion', 'kind', 'binding', 'input', 'result', 'coverage', 'crossDomainConsistent', 'databaseConsistent', 'requiresCompleteDomainReview', 'requiresStopProof', 'applySupported', 'activationSupported', 'postActivationRollbackSupported', 'stopWriteProvable', 'permissionsRestored']
const execute = promisify(execFile)

const fail = (code, details) => { throw Object.assign(new Error(code), { code, ...(details ? { details } : {}) }) }
const encode = value => Buffer.from(JSON.stringify(value) + '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const same = (left, right) => Buffer.from(JSON.stringify(left)).equals(Buffer.from(JSON.stringify(right)))
const stableValue = value => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  return value
}
const sameStable = (left, right) => JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
const inside = (base, target) => { const part = relative(base, target); return !part || (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part)) }
const abort = signal => { if (signal?.aborted) fail('MIGRATION_DOMAIN_CANCELLED') }

/** Canonical physical path: symlinked components resolve, missing leaves fall back
 *  to their closest existing ancestor, so a moved domain is never required to exist. */
const actual = async path => {
  try { return await realpath(path) } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
    const parent = dirname(path)
    if (parent === path) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
    return join(await actual(parent), path.slice(parent.length).replace(/^[/\\]/, ''))
  }
}

function checkKeys (value, keys, code) {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(code)
}

function jsonSafe (value, { maxBytes = MAX_INPUT_BYTES, maxNodes = MAX_NODES, code = 'MIGRATION_DOMAIN_ARTIFACT_INVALID', limitCode = 'MIGRATION_DOMAIN_ARTIFACT_LIMIT' } = {}) {
  const pending = [[value, 0]]
  let nodes = 0
  while (pending.length) {
    const [item, depth] = pending.pop()
    if (++nodes > maxNodes || depth > MAX_DEPTH) fail(limitCode)
    if (nodes % 1024 === 0) abort()
    if (item === null || typeof item === 'boolean' || typeof item === 'string') continue
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0)) fail(code)
      continue
    }
    if (typeof item !== 'object') fail(code)
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype || Object.getOwnPropertySymbols(item).length) fail(code)
      const descriptors = Object.getOwnPropertyDescriptors(item)
      for (const key of Reflect.ownKeys(descriptors)) {
        if (key === 'length') continue
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length || descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable) fail(code)
      }
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index)) fail(code)
        pending.push([item[index], depth + 1])
      }
      continue
    }
    const prototype = Object.getPrototypeOf(item)
    if (prototype !== Object.prototype && prototype !== null) fail(code)
    if (Object.getOwnPropertySymbols(item).length) fail(code)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (descriptor.get || descriptor.set || !descriptor.enumerable) fail(code)
      pending.push([descriptor.value, depth + 1])
    }
  }
  let bytes
  try { bytes = encode(value) } catch { fail(code) }
  if (bytes.length > maxBytes) fail(limitCode)
  return bytes
}

function validatedInput (input) {
  if (!record(input) || Object.keys(input).some(key => !INPUT_KEYS.includes(key)) || !Object.hasOwn(input, 'layout')) fail('MIGRATION_DOMAIN_INPUT_INVALID')
  jsonSafe(input, { code: 'MIGRATION_DOMAIN_INPUT_INVALID', limitCode: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  if (!record(input.layout) || Object.keys(input.layout).some(key => !LAYOUT_KEYS.includes(key))) fail('MIGRATION_DOMAIN_INPUT_INVALID')
  if (input.finance !== undefined) {
    if (!record(input.finance) || Object.keys(input.finance).some(key => key !== 'timeZone')) fail('MIGRATION_DOMAIN_INPUT_INVALID')
    if (input.finance.timeZone !== undefined && (typeof input.finance.timeZone !== 'string' || !input.finance.timeZone.length || input.finance.timeZone.length > 256)) fail('MIGRATION_DOMAIN_INPUT_INVALID')
  }
  if (input.limits !== undefined) {
    if (!record(input.limits)) fail('MIGRATION_DOMAIN_INPUT_INVALID')
    for (const [key, value] of Object.entries(input.limits)) if (!Object.hasOwn(LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > LIMITS[key]) fail('MIGRATION_DOMAIN_INPUT_INVALID')
  }
  return input
}

export function migrationDomainAuditInputDigests (input) {
  validatedInput(input)
  return { domainLayoutDigest: sha(encode(input.layout)), domainAuditInputDigest: sha(encode(input)) }
}

function validateBinding (binding) {
  jsonSafe(binding, { code: 'MIGRATION_DOMAIN_OPERATION_MISMATCH', limitCode: 'MIGRATION_DOMAIN_OPERATION_MISMATCH' })
  checkKeys(binding, BINDING_KEYS, 'MIGRATION_DOMAIN_OPERATION_MISMATCH')
  for (const key of ['operationDigest', 'domainsDigest', 'profilePlanDigest', 'captureManifestSha256', 'captureJournalDigest', 'ledgerManifestSha256', 'ledgerContentDigest', 'domainLayoutDigest', 'domainAuditInputDigest']) if (typeof binding[key] !== 'string' || !DIGEST.test(binding[key])) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
  if (typeof binding.operationId !== 'string' || !binding.operationId.length || binding.operationId.length > 512) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
  if (!Array.isArray(binding.domains) || !binding.domains.length || binding.domains.length > 32) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
  const domains = binding.domains.map(domain => {
    checkKeys(domain, ['name', 'roots'], 'MIGRATION_DOMAIN_OPERATION_MISMATCH')
    return { name: domain.name, roots: domain.roots }
  })
  if (sha(encode(domains)) !== binding.domainsDigest) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
  const roots = []
  for (const domain of domains) {
    checkKeys(domain, ['name', 'roots'], 'MIGRATION_DOMAIN_OPERATION_MISMATCH')
    if (typeof domain.name !== 'string' || !Array.isArray(domain.roots) || !domain.roots.length) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
    for (const root of domain.roots) {
      if (typeof root !== 'string' || !isAbsolute(root) || root !== resolve(root)) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
      roots.push(root)
    }
  }
  if (new Set(roots).size !== roots.length) fail('MIGRATION_DOMAIN_ROOT_COVERAGE_MISMATCH')
  return roots
}

function identity (stat) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].map(key => String(stat[key])).join(':')
}

async function stableFile (root, name, maximum, codes) {
  let before
  const path = join(root, name)
  try { before = await lstat(path, { bigint: true }) } catch (error) { if (error?.code === 'ENOENT') fail(codes.missing); fail(codes.invalid) }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || await realpath(path) !== path) fail(codes.invalid)
  if (before.size > BigInt(maximum)) fail(codes.limit)
  let handle
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)) } catch (error) { if (error?.code === 'ENOENT') fail(codes.missing); fail(codes.invalid) }
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n || identity(before) !== identity(opened)) fail(codes.changed)
    const buffer = Buffer.alloc(Number(before.size) + 1)
    let size = 0
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, null)
      if (!read.bytesRead) break
      size += read.bytesRead
      if (size > maximum) fail(codes.limit)
    }
    const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true })
    const bytes = buffer.subarray(0, size)
    if (size !== Number(before.size) || identity(before) !== identity(after) || identity(before) !== identity(named) || named.nlink !== 1n || await realpath(path) !== path) fail(codes.changed)
    return { bytes, sha256: sha(bytes) }
  } finally { await handle.close() }
}

/**
 * Re-assert owner-only confidentiality of a private artifact path before it is
 * trusted again. POSIX checks the group/other bits; Windows reads the ACL with
 * a read-only icacls/whoami pair (argument arrays, never an interpolated shell
 * string) and refuses any principal that is not the running owner. Nothing here
 * rewrites an ACL or a permission bit.
 */
async function assertOwnerOnly (path) {
  let stat
  try { stat = await lstat(path) } catch (error) { if (error?.code === 'ENOENT') fail('MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE'); fail('MIGRATION_DOMAIN_ARTIFACT_INVALID') }
  if (stat.isSymbolicLink()) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
  if (process.platform === 'win32') {
    const system = join(process.env.SystemRoot ?? 'C:/Windows', 'System32')
    const who = await execute(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000, maxBuffer: 65536 }).catch(() => null)
    const owner = String(who?.stdout ?? '').split(/\r?\n/)[0].split(',')[0].trim().replace(/^"|"$/g, '')
    if (!owner) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
    const acl = await execute(join(system, 'icacls.exe'), [path], { windowsHide: true, timeout: 10000, maxBuffer: 65536 }).catch(() => null)
    // Locale-independent filter: only lines carrying an ACE survive, so a
    // localized "Successfully processed" summary is never read as a grant.
    const grants = String(acl?.stdout ?? '').split(/\r?\n/).map(line => line.trim()).filter(line => line.includes(':('))
    if (!grants.length) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
    const expected = owner.slice(owner.lastIndexOf('\\') + 1)
    for (const grant of grants) {
      // icacls echoes the queried path before the first ACE and indents the
      // rest; the principal is always the last token before its permission
      // list, and a Windows account name never contains whitespace.
      const principal = grant.slice(0, grant.indexOf(':(')).trim().split(/\s+/).pop()
      if (!principal || (principal.toLowerCase() !== owner.toLowerCase()
        && principal.slice(principal.lastIndexOf('\\') + 1).toLowerCase() !== expected.toLowerCase())) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
    }
  } else if (stat.mode & 0o077) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
}

const artifactCodes = { missing: 'MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE', invalid: 'MIGRATION_DOMAIN_ARTIFACT_INVALID', changed: 'MIGRATION_DOMAIN_ARTIFACT_CHANGED', limit: 'MIGRATION_DOMAIN_ARTIFACT_LIMIT' }
const captureCodes = { missing: 'MIGRATION_DOMAIN_CAPTURE_MISMATCH', invalid: 'MIGRATION_DOMAIN_CAPTURE_MISMATCH', changed: 'MIGRATION_DOMAIN_CAPTURE_MISMATCH', limit: 'MIGRATION_DOMAIN_CAPTURE_MISMATCH' }

async function canonicalNewPath (path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('MIGRATION_PRIVATE_OUTPUT_ABSOLUTE_REQUIRED')
  const resolved = resolve(path)
  try { return join(await realpath(dirname(resolved)), basename(resolved)) } catch { fail('MIGRATION_DOMAIN_ARTIFACT_INVALID') }
}

async function artifactRoot (privateOutput, create) {
  if (!create) {
    try {
      if (typeof privateOutput !== 'string' || !isAbsolute(privateOutput) || (await lstat(privateOutput)).isSymbolicLink()) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
      const root = await realpath(privateOutput)
      if (!(await lstat(root)).isDirectory()) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
      return root
    } catch (error) {
      if (error?.code === 'MIGRATION_DOMAIN_ARTIFACT_INVALID' || error?.code === 'MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE') throw error
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') fail('MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE')
      fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
    }
  }
  return canonicalNewPath(privateOutput)
}

/** Evidence must never be written into a source. Physical (realpath) comparison
 *  replaces literal resolve, while a moved domain still resolves through its
 *  surviving ancestors, so verification never needs a live original root. */
async function assertSeparate (root, dataArchive, ledgerArchive, configurationPlan, declaredRoots) {
  const paths = [dataArchive, ledgerArchive, ...declaredRoots]
  for (const key of ['profileDir', 'dshHome', 'launchCwd']) if (typeof configurationPlan.context?.[key] === 'string') paths.push(configurationPlan.context[key])
  for (const key of ['effectiveHome', 'effectiveWorkspace']) if (typeof configurationPlan.runtimePaths?.[key] === 'string') paths.push(configurationPlan.runtimePaths[key])
  for (const source of configurationPlan.sources ?? []) if (typeof source.path === 'string') paths.push(dirname(source.path))
  const evidence = await actual(resolve(root))
  for (const path of paths) {
    if (typeof path !== 'string' || !isAbsolute(path)) continue
    const resolved = await actual(resolve(path))
    if (inside(resolved, evidence) || inside(evidence, resolved)) fail('MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE')
  }
}

async function readSources ({ dataArchive, ledgerArchive, Database, binding, signal }) {
  let archive, configurationPlan, manifestBytes
  try {
    const verified = await readVerifiedMigrationDataArchive({ privateOutput: dataArchive, signal })
    archive = verified.manifest
    configurationPlan = verified.configurationPlan
    const manifest = await stableFile(await realpath(dataArchive), 'capture.private.json', MAX_ARTIFACT_BYTES, captureCodes)
    manifestBytes = manifest.bytes
    if (manifest.sha256 !== binding.captureManifestSha256 || !manifestBytes.equals(encode(archive))) fail('MIGRATION_DOMAIN_CAPTURE_MISMATCH')
  } catch (error) {
    if (error?.code === 'MIGRATION_DOMAIN_CAPTURE_MISMATCH') throw error
    fail('MIGRATION_DOMAIN_CAPTURE_MISMATCH', { cause: error?.code ?? 'unknown' })
  }
  if (sha(encode(configurationPlan)) !== binding.profilePlanDigest) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
  const capturedRoots = archive.sourceInventory.sources.map(source => source.root)
  const declaredRoots = validateBinding(binding)
  if (capturedRoots.length !== declaredRoots.length || new Set(capturedRoots).size !== capturedRoots.length || capturedRoots.some(root => !declaredRoots.includes(root))) fail('MIGRATION_DOMAIN_ROOT_COVERAGE_MISMATCH')

  let ledgerExport
  try {
    await verifyMigrationLedgerArchive({ Database, privateOutput: ledgerArchive, signal })
    const root = await realpath(ledgerArchive)
    const saved = await stableFile(root, 'archive.private.json', MAX_LEDGER_MANIFEST, captureCodes)
    if (saved.sha256 !== binding.ledgerManifestSha256) fail('MIGRATION_DOMAIN_CAPTURE_MISMATCH')
    const ledgerManifest = JSON.parse(saved.bytes.toString('utf8'))
    if (ledgerManifest.contentDigest !== binding.ledgerContentDigest) fail('MIGRATION_DOMAIN_CAPTURE_MISMATCH')
    const database = new Database(join(root, 'ledger.sqlite'), { readonly: true, fileMustExist: true })
    try {
      database.pragma('query_only=ON')
      ledgerExport = exportMigrationLedger(database, { limits: ledgerManifest.limits, signal })
    } finally { database.close() }
    if (ledgerExport.contentDigest !== binding.ledgerContentDigest) fail('MIGRATION_DOMAIN_CAPTURE_MISMATCH')
  } catch (error) {
    if (error?.code === 'MIGRATION_DOMAIN_OPERATION_MISMATCH' || error?.code === 'MIGRATION_DOMAIN_CAPTURE_MISMATCH') throw error
    fail('MIGRATION_DOMAIN_CAPTURE_MISMATCH', { cause: error?.code ?? 'unknown' })
  }
  return { archive, configurationPlan, declaredRoots, ledgerExport }
}

async function freshAudit ({ dataArchive, input, ledgerExport, signal }) {
  // The re-exported ledger is the only ledger evidence this module has, so it
  // always reaches the unchanged financial audit. What a table set proves is
  // decided there, never by a second table-name gate here.
  return auditMigrationDataDomains({ privateOutput: dataArchive, layout: input.layout, finance: { ...(input.finance ?? {}), ledgerExport }, limits: input.limits, signal })
}

function publicSummary (result, inventoryObservation) {
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : 0
  return Object.freeze({
    schemaVersion: 1,
    kind: 'migration-domain-audit-evidence',
    status: result.status,
    diagnostics: count(result.diagnostics.length),
    sessions: count(result.sessions.length),
    generations: count(result.generations.length),
    references: count(result.references.length),
    attachments: count(result.attachments.referenced),
    resolvedAttachments: count(result.attachments.resolved),
    coverage: COVERAGE,
    ...(inventoryObservation ? {
      inventoryCoverage: inventoryObservation.coverage,
      inventoryStatus: inventoryObservation.status,
      inventoryComplete: false,
      captureEpochStatus: 'unproven',
    } : {}),
    crossDomainConsistent: false,
    databaseConsistent: false,
    requiresCompleteDomainReview: true,
    requiresStopProof: true,
    applySupported: false,
    activationSupported: false,
    postActivationRollbackSupported: false,
    stopWriteProvable: false,
    permissionsRestored: false,
  })
}

async function readArtifact (root) {
  const saved = await stableFile(root, ARTIFACT_FILE, MAX_ARTIFACT_BYTES, artifactCodes)
  await assertOwnerOnly(join(root, ARTIFACT_FILE))
  let artifact
  try { artifact = JSON.parse(saved.bytes.toString('utf8')) } catch { fail('MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE') }
  jsonSafe(artifact, { maxBytes: MAX_ARTIFACT_BYTES })
  if (!saved.bytes.equals(encode(artifact))) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
  if (!record(artifact)) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
  checkKeys(artifact, artifact.schemaVersion === 2 ? [...ARTIFACT_KEYS, 'inventoryObservation'] : ARTIFACT_KEYS, 'MIGRATION_DOMAIN_ARTIFACT_INVALID')
  if (![1, 2].includes(artifact.schemaVersion) || artifact.kind !== 'private-migration-domain-audit-artifact' || artifact.coverage !== COVERAGE || artifact.crossDomainConsistent !== false || artifact.databaseConsistent !== false || artifact.requiresCompleteDomainReview !== true || artifact.requiresStopProof !== true || artifact.applySupported !== false || artifact.activationSupported !== false || artifact.postActivationRollbackSupported !== false || artifact.stopWriteProvable !== false || artifact.permissionsRestored !== false) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
  validatedInput(artifact.input)
  if (!record(artifact.result) || !['audited', 'needs-context', 'blocked'].includes(artifact.result.status)) fail('MIGRATION_DOMAIN_ARTIFACT_INVALID')
  return artifact
}

function compareBinding (actual, expected) {
  if (!sameStable(actual, expected)) {
    const captureKeys = ['captureManifestSha256', 'captureJournalDigest', 'ledgerManifestSha256', 'ledgerContentDigest']
    if (captureKeys.some(key => actual?.[key] !== expected[key]) && BINDING_KEYS.filter(key => !captureKeys.includes(key)).every(key => sameStable(actual?.[key], expected[key]))) fail('MIGRATION_DOMAIN_CAPTURE_MISMATCH')
    fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
  }
}

async function verifyAtRoot ({ root, dataArchive, ledgerArchive, Database, expected, signal }) {
  abort(signal)
  await assertOwnerOnly(root)
  const declaredRoots = validateBinding(expected)
  const artifact = await readArtifact(root)
  compareBinding(artifact.binding, expected)
  if (sha(encode(artifact.input.layout)) !== expected.domainLayoutDigest || sha(encode(artifact.input)) !== expected.domainAuditInputDigest) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
  const sources = await readSources({ dataArchive, ledgerArchive, Database, binding: expected, signal })
  await assertSeparate(root, await realpath(dataArchive), await realpath(ledgerArchive), sources.configurationPlan, declaredRoots)
  const result = await freshAudit({ dataArchive, input: artifact.input, ledgerExport: sources.ledgerExport, signal })
  if (!same(artifact.result, result)) fail('MIGRATION_DOMAIN_AUDIT_MISMATCH')
  const observation = artifact.schemaVersion === 2 ? observeCapturedMigrationDomainInventory({ archive: sources.archive, configurationPlan: sources.configurationPlan, input: artifact.input, binding: expected }) : undefined
  if (observation && !same(artifact.inventoryObservation, observation)) fail('MIGRATION_DOMAIN_INVENTORY_MISMATCH')
  abort(signal)
  return publicSummary(result, observation)
}

export async function createMigrationDomainAuditArtifact ({ privateOutput, dataArchive, ledgerArchive, Database, input, binding, signal } = {}) {
  validatedInput(input)
  validateBinding(binding)
  const digests = migrationDomainAuditInputDigests(input)
  if (digests.domainLayoutDigest !== binding.domainLayoutDigest || digests.domainAuditInputDigest !== binding.domainAuditInputDigest) fail('MIGRATION_DOMAIN_OPERATION_MISMATCH')
  let root
  try { root = await artifactRoot(privateOutput, false) } catch (error) { if (error?.code !== 'MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE') throw error }
  if (root) {
    try { return await verifyAtRoot({ root, dataArchive, ledgerArchive, Database, expected: binding, signal }) } catch (error) {
      if (['MIGRATION_DOMAIN_OPERATION_MISMATCH', 'MIGRATION_DOMAIN_CAPTURE_MISMATCH'].includes(error?.code)) fail('MIGRATION_DOMAIN_ARTIFACT_CONFLICT', { cause: error.code })
      throw error
    }
  }
  root = await artifactRoot(privateOutput, true)
  const sources = await readSources({ dataArchive, ledgerArchive, Database, binding, signal })
  await assertSeparate(root, await realpath(dataArchive), await realpath(ledgerArchive), sources.configurationPlan, sources.declaredRoots)
  const result = await freshAudit({ dataArchive, input, ledgerExport: sources.ledgerExport, signal })
  const artifact = {
    schemaVersion: 2,
    kind: 'private-migration-domain-audit-artifact',
    binding,
    input,
    result,
    inventoryObservation: observeCapturedMigrationDomainInventory({ archive: sources.archive, configurationPlan: sources.configurationPlan, input, binding }),
    coverage: COVERAGE,
    crossDomainConsistent: false,
    databaseConsistent: false,
    requiresCompleteDomainReview: true,
    requiresStopProof: true,
    applySupported: false,
    activationSupported: false,
    postActivationRollbackSupported: false,
    stopWriteProvable: false,
    permissionsRestored: false,
  }
  const bytes = jsonSafe(artifact, { maxBytes: MAX_ARTIFACT_BYTES })
  try { await createPrivateMigrationDirectory(root) } catch (error) { if (error?.code === 'EEXIST') fail('MIGRATION_DOMAIN_ARTIFACT_CONFLICT'); throw error }
  try { await writePrivateMigrationFile(root, ARTIFACT_FILE, bytes) } catch (error) { if (error?.code === 'EEXIST') fail('MIGRATION_DOMAIN_ARTIFACT_CONFLICT'); throw error }
  return verifyAtRoot({ root, dataArchive, ledgerArchive, Database, expected: binding, signal })
}

export async function verifyMigrationDomainAuditArtifact ({ privateOutput, dataArchive, ledgerArchive, Database, expected, signal } = {}) {
  const root = await artifactRoot(privateOutput, false)
  return verifyAtRoot({ root, dataArchive, ledgerArchive, Database, expected, signal })
}
