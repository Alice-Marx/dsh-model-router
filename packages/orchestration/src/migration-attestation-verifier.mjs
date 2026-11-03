import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { createPrivateMigrationDirectory, hashPrivateMigrationFile, writePrivateMigrationFile } from './migration-private-files.mjs'
import { inspectMigrationCommitOperation, readOperationRecord } from './migration-commit-orchestration.mjs'
import { inspectMigrationConfigurationCommit } from './migration-configuration-commit.mjs'
import { readMigrationStartupGate } from './migration-startup-gate.mjs'
import { readVerifiedMigrationDataArchive, summarizeMigrationDataArchive } from './migration-data-archive.mjs'
import { verifyMigrationLedgerArchive } from './migration-ledger-export.mjs'
import { readMigrationFence } from './migration-fence.mjs'
import { auditMigrationFinance } from './migration-financial-audit.mjs'

const COMMON = ['Database', 'operationDirectory', 'configurationDirectory', 'dataArchive', 'ledgerArchive', 'fenceHome', 'assertExclusive', 'signal']
const OBSERVE_INPUTS = new Set(COMMON)
const CREATE_INPUTS = new Set([...COMMON, 'privateOutput', 'expected', 'attestationType', 'evidenceClass', 'declaration', 'nowMs', 'clockFloorMs', 'ttlMs', 'onBoundary'])
const VERIFY_INPUTS = new Set([...COMMON, 'privateOutput', 'expected', 'nowMs', 'clockFloorMs'])
const TYPES = new Set(['stopped-hosts', 'complete-domains', 'consistent-backups', 'artifact', 'permissions', 'money'])
const CLASSES = new Set(['automatic-observation', 'manual-declaration', 'platform-evidence'])
const CONTEXT_KEYS = ['schemaVersion', 'kind', 'operationId', 'operationDigest', 'profilePlanDigest', 'configurationPlanDigest', 'orchestrationJournalHead', 'configurationJournalHead', 'dataArchiveManifestDigest', 'ledgerArchiveManifestDigest', 'ledgerContentDigest', 'host', 'platform', 'fenceIntentDigest', 'fenceExclusiveDigest']
const DIGEST_KEYS = ['operationDigest', 'profilePlanDigest', 'configurationPlanDigest', 'orchestrationJournalHead', 'configurationJournalHead', 'dataArchiveManifestDigest', 'ledgerArchiveManifestDigest', 'ledgerContentDigest', 'fenceIntentDigest', 'fenceExclusiveDigest']
const AUTOMATIC_KEYS = ['observation', 'operationJournalEntries', 'configurationJournalEntries', 'dataSources', 'dataFiles', 'dataDirectories', 'dataBytes', 'rawSqliteFiles', 'ledgerTables', 'ledgerRows', 'dataArchiveManifestDigest', 'ledgerArchiveManifestDigest', 'ledgerContentDigest']
const COUNT_KEYS = ['operationJournalEntries', 'configurationJournalEntries', 'dataSources', 'dataFiles', 'dataDirectories', 'dataBytes', 'rawSqliteFiles', 'ledgerTables', 'ledgerRows']
const MONEY_KEYS = ['observation', 'coverage', 'financeAuditStatus', 'needsContextCodes', 'dataArchiveManifestDigest', 'ledgerArchiveManifestDigest', 'ledgerContentDigest', 'markerDigest', 'routerMigrationTableDigest', 'routerMetaTableDigest', 'ledgerTables', 'ledgerRows', 'runCount', 'holdCount', 'unassignedRunCount']
const MONEY_COUNT_KEYS = ['ledgerTables', 'ledgerRows', 'runCount', 'holdCount', 'unassignedRunCount']
const MONEY_DIGEST_KEYS = ['dataArchiveManifestDigest', 'ledgerArchiveManifestDigest', 'ledgerContentDigest', 'markerDigest', 'routerMigrationTableDigest', 'routerMetaTableDigest']
const NEEDS_CONTEXT_CODES = new Set(['ACTIVE_OR_INTERRUPTED_HOLDS', 'TIMEZONE_CONTEXT_REQUIRED', 'USAGE_EXPORT_REQUIRED'])
const BUNDLE_FILE = 'attestation.private.json'
const COMPLETE_FILE = 'completed.json'
const VERIFIER_VERSION = 'k9-artifact-observation-v1'
const MAX_BUNDLE_BYTES = 65536
const MAX_MARKER_BYTES = 1048576
const MAX_MONEY_COUNT = 100000
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const encode = value => Buffer.from(JSON.stringify(value) + '\n')
const fail = code => { throw Object.assign(new Error(code), { code }) }
const inside = (base, target) => { const part = relative(base, target); return !part || (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part)) }
const overlap = (a, b) => inside(a, b) || inside(b, a)
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const bounded = (value, maximum) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= maximum && !/[\0-\x1f\x7f]/.test(value)

function object (value, keys, code = 'MIGRATION_ATTESTATION_SCHEMA_INVALID') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(code)
  const names = Object.getOwnPropertyNames(value)
  if (Object.getOwnPropertySymbols(value).length || names.length !== keys.length || names.some(key => !keys.includes(key))) fail(code)
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(code)
  }
  return value
}

function optionsObject (options, allowed) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  const prototype = Object.getPrototypeOf(options)
  if (prototype !== Object.prototype && prototype !== null) fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  if (Object.getOwnPropertySymbols(options).length) fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  for (const key of Object.getOwnPropertyNames(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)
    if (!allowed.has(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  }
  return options
}

function normalizeContext (expected) {
  object(expected, CONTEXT_KEYS)
  if (expected.schemaVersion !== 1 || expected.kind !== 'migration-attestation-context') fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  for (const key of DIGEST_KEYS) if (!digest(expected[key])) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  if (!bounded(expected.operationId, 256) || !bounded(expected.host, 256) || !bounded(expected.platform, 64)) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  return Object.freeze({
    schemaVersion: 1,
    kind: 'migration-attestation-context',
    operationId: expected.operationId,
    operationDigest: expected.operationDigest,
    profilePlanDigest: expected.profilePlanDigest,
    configurationPlanDigest: expected.configurationPlanDigest,
    orchestrationJournalHead: expected.orchestrationJournalHead,
    configurationJournalHead: expected.configurationJournalHead,
    dataArchiveManifestDigest: expected.dataArchiveManifestDigest,
    ledgerArchiveManifestDigest: expected.ledgerArchiveManifestDigest,
    ledgerContentDigest: expected.ledgerContentDigest,
    host: expected.host,
    platform: expected.platform,
    fenceIntentDigest: expected.fenceIntentDigest,
    fenceExclusiveDigest: expected.fenceExclusiveDigest,
  })
}

function normalizeAutomaticPayload (payload) {
  object(payload, AUTOMATIC_KEYS)
  if (payload.observation !== 'sources-reverified') fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  for (const key of COUNT_KEYS) if (!Number.isSafeInteger(payload[key]) || payload[key] < 0) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  for (const key of ['dataArchiveManifestDigest', 'ledgerArchiveManifestDigest', 'ledgerContentDigest']) if (!digest(payload[key])) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  return {
    observation: 'sources-reverified',
    operationJournalEntries: payload.operationJournalEntries,
    configurationJournalEntries: payload.configurationJournalEntries,
    dataSources: payload.dataSources,
    dataFiles: payload.dataFiles,
    dataDirectories: payload.dataDirectories,
    dataBytes: payload.dataBytes,
    rawSqliteFiles: payload.rawSqliteFiles,
    ledgerTables: payload.ledgerTables,
    ledgerRows: payload.ledgerRows,
    dataArchiveManifestDigest: payload.dataArchiveManifestDigest,
    ledgerArchiveManifestDigest: payload.ledgerArchiveManifestDigest,
    ledgerContentDigest: payload.ledgerContentDigest,
  }
}

function normalizeMoneyPayload (payload) {
  object(payload, MONEY_KEYS)
  if (payload.observation !== 'sources-reverified' || payload.coverage !== 'captured-marker-ledger-epoch-only' || !['audited', 'needs-context'].includes(payload.financeAuditStatus)) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  if (!Array.isArray(payload.needsContextCodes) || payload.needsContextCodes.length > NEEDS_CONTEXT_CODES.size || payload.needsContextCodes.some((code, index, codes) => !NEEDS_CONTEXT_CODES.has(code) || (index > 0 && code <= codes[index - 1]))) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  if ((payload.financeAuditStatus === 'needs-context') !== (payload.needsContextCodes.length > 0)) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  for (const key of MONEY_COUNT_KEYS) if (!Number.isSafeInteger(payload[key]) || payload[key] < 0 || payload[key] > MAX_MONEY_COUNT) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  for (const key of MONEY_DIGEST_KEYS) if (!digest(payload[key])) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  return {
    observation: 'sources-reverified',
    coverage: 'captured-marker-ledger-epoch-only',
    financeAuditStatus: payload.financeAuditStatus,
    needsContextCodes: [...payload.needsContextCodes],
    dataArchiveManifestDigest: payload.dataArchiveManifestDigest,
    ledgerArchiveManifestDigest: payload.ledgerArchiveManifestDigest,
    ledgerContentDigest: payload.ledgerContentDigest,
    markerDigest: payload.markerDigest,
    routerMigrationTableDigest: payload.routerMigrationTableDigest,
    routerMetaTableDigest: payload.routerMetaTableDigest,
    ledgerTables: payload.ledgerTables,
    ledgerRows: payload.ledgerRows,
    runCount: payload.runCount,
    holdCount: payload.holdCount,
    unassignedRunCount: payload.unassignedRunCount,
  }
}

function normalizeDeclaration (declaration) {
  object(declaration, ['actorId', 'text'])
  if (!bounded(declaration.actorId, 128) || typeof declaration.text !== 'string' || !declaration.text.length || Buffer.byteLength(declaration.text) > 2048) fail('MIGRATION_ATTESTATION_DECLARATION_INVALID')
  return { actorId: declaration.actorId, text: declaration.text }
}

function normalizePayload (attestationType, evidenceClass, payload) {
  if (attestationType === 'artifact' && evidenceClass === 'automatic-observation') return normalizeAutomaticPayload(payload)
  if (attestationType === 'money' && evidenceClass === 'automatic-observation') return normalizeMoneyPayload(payload)
  if (evidenceClass === 'manual-declaration') return normalizeDeclaration(payload)
  fail('MIGRATION_ATTESTATION_UNSUPPORTED')
}

function bundleBody (bundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    kind: bundle.kind,
    verifierVersion: bundle.verifierVersion,
    attestationType: bundle.attestationType,
    evidenceClass: bundle.evidenceClass,
    binding: bundle.binding,
    generation: bundle.generation,
    collectedAt: bundle.collectedAt,
    expiresAt: bundle.expiresAt,
    payload: bundle.payload,
  }
}

function normalizeBundle (value) {
  object(value, [...Object.keys(bundleBody({})), 'bundleDigest'])
  if (value.schemaVersion !== 1 || value.kind !== 'migration-attestation-bundle' || value.verifierVersion !== VERIFIER_VERSION || !TYPES.has(value.attestationType) || !CLASSES.has(value.evidenceClass) || value.generation !== null) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  if (!Number.isSafeInteger(value.collectedAt) || value.collectedAt < 1 || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.collectedAt || value.expiresAt - value.collectedAt > 300000 || !digest(value.bundleDigest)) fail('MIGRATION_ATTESTATION_SCHEMA_INVALID')
  const bundle = {
    schemaVersion: 1,
    kind: 'migration-attestation-bundle',
    verifierVersion: VERIFIER_VERSION,
    attestationType: value.attestationType,
    evidenceClass: value.evidenceClass,
    binding: normalizeContext(value.binding),
    generation: null,
    collectedAt: value.collectedAt,
    expiresAt: value.expiresAt,
    payload: normalizePayload(value.attestationType, value.evidenceClass, value.payload),
    bundleDigest: value.bundleDigest,
  }
  if (sha(encode(bundleBody(bundle))) !== bundle.bundleDigest) fail('MIGRATION_ATTESTATION_DIGEST_MISMATCH')
  return bundle
}

function makeBundle ({ expected, attestationType, evidenceClass, payload, nowMs, ttlMs }) {
  const body = {
    schemaVersion: 1,
    kind: 'migration-attestation-bundle',
    verifierVersion: VERIFIER_VERSION,
    attestationType,
    evidenceClass,
    binding: expected,
    generation: null,
    collectedAt: nowMs,
    expiresAt: nowMs + ttlMs,
    payload,
  }
  const bundle = { ...body, bundleDigest: sha(encode(body)) }
  if (encode(bundle).length > MAX_BUNDLE_BYTES) fail('MIGRATION_ATTESTATION_BUNDLE_LIMIT')
  return bundle
}

function validateTimes (nowMs, clockFloorMs, ttlMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 1 || !Number.isSafeInteger(clockFloorMs) || clockFloorMs < 1 || nowMs < clockFloorMs) fail('MIGRATION_ATTESTATION_CLOCK_ROLLBACK')
  if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300000 || !Number.isSafeInteger(nowMs + ttlMs))) fail('MIGRATION_ATTESTATION_TTL_INVALID')
}

function validateCommon (options) {
  for (const key of ['Database', 'assertExclusive']) if (typeof options[key] !== 'function') fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  for (const key of ['operationDirectory', 'configurationDirectory', 'dataArchive', 'ledgerArchive', 'fenceHome']) if (typeof options[key] !== 'string' || !isAbsolute(options[key]) || options[key].includes('\0') || Buffer.byteLength(options[key]) > 4096) fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  if (options.signal?.aborted) fail('MIGRATION_ATTESTATION_CANCELLED')
}

async function guard (options) {
  if (options.signal?.aborted) fail('MIGRATION_ATTESTATION_CANCELLED')
  let held = false
  try { held = await options.assertExclusive() } catch {}
  if (held !== true) fail('MIGRATION_ATTESTATION_EXCLUSIVE_REQUIRED')
}

async function canonicalDirectory (path) {
  const resolved = resolve(path)
  const canonical = await realpath(resolved)
  const info = await lstat(canonical)
  if (!info.isDirectory() || info.isSymbolicLink() || canonical !== resolved) fail('MIGRATION_ATTESTATION_PATH_INVALID')
  return canonical
}

const fileIdentity = info => [info.dev, info.ino, info.nlink, info.size, info.mtimeNs, info.ctimeNs].map(String).join(':')

/**
 * Bounded single-link read: one opened handle, dev/ino/nlink/size/metadata
 * stability verified around the read. Payload reads stop at the confirmed size
 * plus one byte, within maximum + 1; the fixed scratch buffer is 64 KiB.
 * A file replaced or grown between hashes cannot cause an unbounded read.
 */
async function boundedRead (directory, name, maximum, invalidCode, changedCode, missingCode) {
  const root = await realpath(directory)
  const path = join(root, name)
  let before
  try { before = await lstat(path, { bigint: true }) } catch (error) { if (error?.code === 'ENOENT') fail(missingCode); throw error }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maximum)) fail(invalidCode)
  const handle = await open(path, 'r')
  try {
    const opened = await handle.stat({ bigint: true })
    if (fileIdentity(before) !== fileIdentity(opened)) fail(changedCode)
    const size = Number(before.size)
    const chunks = []
    const block = Buffer.alloc(65536)
    let total = 0
    while (total <= size) {
      const result = await handle.read(block, 0, Math.min(block.length, size + 1 - total), null)
      if (!result.bytesRead) break
      chunks.push(Buffer.from(block.subarray(0, result.bytesRead)))
      total += result.bytesRead
    }
    const after = await handle.stat({ bigint: true })
    const named = await lstat(path, { bigint: true })
    if (fileIdentity(before) !== fileIdentity(after) || fileIdentity(before) !== fileIdentity(named) || await realpath(path) !== path) fail(changedCode)
    if (total !== size) fail(changedCode)
    return Buffer.concat(chunks, total)
  } finally { await handle.close() }
}

async function assertSingleLink (directory, name, code) {
  let info
  try { info = await lstat(join(directory, name), { bigint: true }) } catch (error) { if (error?.code === 'ENOENT') fail(code); throw error }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) fail(code)
}

/** The operation record and every journal step must be unlinked private files. */
async function assertOperationFiles (directory) {
  for (const name of await readdir(directory)) {
    if (name === 'operation.private.json' || /^step-\d{5}\.json$/.test(name)) await assertSingleLink(directory, name, 'MIGRATION_ATTESTATION_OPERATION_INVALID')
  }
}

async function stableJson (directory, name, maximum) {
  const before = await hashPrivateMigrationFile(directory, name, maximum)
  const bytes = await boundedRead(directory, name, maximum, 'MIGRATION_ATTESTATION_SOURCE_INVALID', 'MIGRATION_ATTESTATION_SOURCE_CHANGED', 'MIGRATION_ATTESTATION_SOURCE_INVALID')
  const after = await hashPrivateMigrationFile(directory, name, maximum)
  if (bytes.length !== before.bytes || before.sha256 !== after.sha256 || sha(bytes) !== before.sha256) fail('MIGRATION_ATTESTATION_SOURCE_CHANGED')
  try { return { value: JSON.parse(bytes.toString('utf8')), digest: before.sha256 } } catch { fail('MIGRATION_ATTESTATION_SOURCE_INVALID') }
}

function configurationPaths (plan) {
  return [plan.context?.profileDir, plan.context?.dshHome, plan.context?.launchCwd, plan.runtimePaths?.effectiveHome, plan.runtimePaths?.effectiveWorkspace, ...(plan.sources ?? []).flatMap(source => [source.path, typeof source.path === 'string' ? dirname(source.path) : null])].filter(path => typeof path === 'string' && isAbsolute(path))
}

async function observeMoneyPayload ({ data, dataManifest, ledgerArchive, ledgerManifest, ledgerSummary }) {
  const sources = data.manifest.sources.map((source, index) => ({ source, index })).filter(({ source }) => source.kind === 'ledger')
  if (sources.length !== 1) fail('MIGRATION_ATTESTATION_MONEY_MARKER_MISSING')
  const [{ source, index }] = sources
  const entries = data.manifest.sourceInventory?.sources?.[index]?.entries?.filter(entry => entry.path === 'state.json') ?? []
  if (entries.length !== 1) fail('MIGRATION_ATTESTATION_MONEY_MARKER_MISSING')
  const entry = entries[0]
  if (entry.type !== 'file' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_MARKER_BYTES || !digest(entry.sha256)) fail('MIGRATION_ATTESTATION_MONEY_MARKER_INVALID')
  const markerDirectory = await canonicalDirectory(join(data.root, 'data', source.directory))
  const markerBytes = await boundedRead(markerDirectory, 'state.json', entry.bytes, 'MIGRATION_ATTESTATION_MONEY_MARKER_INVALID', 'MIGRATION_ATTESTATION_MONEY_MARKER_CHANGED', 'MIGRATION_ATTESTATION_MONEY_MARKER_MISSING')
  if (markerBytes.length !== entry.bytes || sha(markerBytes) !== entry.sha256) fail('MIGRATION_ATTESTATION_MONEY_MARKER_CHANGED')
  let marker
  try { marker = JSON.parse(markerBytes.toString('utf8')) } catch { fail('MIGRATION_ATTESTATION_MONEY_MARKER_INVALID') }

  const maximum = ledgerManifest.value.limits.maxExportBytes + 1024
  const exportBytes = await boundedRead(ledgerArchive, 'ledger-export.private.json', maximum, 'MIGRATION_ATTESTATION_MONEY_LEDGER_INVALID', 'MIGRATION_ATTESTATION_MONEY_LEDGER_CHANGED', 'MIGRATION_ATTESTATION_MONEY_LEDGER_INVALID')
  const recorded = ledgerManifest.value.files['ledger-export.private.json']
  if (exportBytes.length !== recorded.bytes || sha(exportBytes) !== recorded.sha256) fail('MIGRATION_ATTESTATION_MONEY_LEDGER_CHANGED')
  let ledgerExport
  try { ledgerExport = JSON.parse(exportBytes.toString('utf8')) } catch { fail('MIGRATION_ATTESTATION_MONEY_LEDGER_INVALID') }
  let result
  try { result = auditMigrationFinance({ routerState: marker, ledgerExport }) } catch { fail('MIGRATION_ATTESTATION_MONEY_AUDIT_BLOCKED') }
  if (result.diagnostics.some(diagnostic => diagnostic.severity === 'error') || !result.ledger || !result.router) fail('MIGRATION_ATTESTATION_MONEY_AUDIT_BLOCKED')
  if (result.ledger.contentDigest !== ledgerManifest.value.contentDigest) fail('MIGRATION_ATTESTATION_MONEY_DIGEST_MISMATCH')
  if (result.ledger.rows !== ledgerSummary.rows || result.ledger.tables.length !== ledgerSummary.tables) fail('MIGRATION_ATTESTATION_MONEY_LEDGER_INVALID')
  const tableDigest = name => {
    const matches = result.ledger.tables.filter(table => table.name === name)
    if (matches.length !== 1 || !digest(matches[0].digest)) fail('MIGRATION_ATTESTATION_MONEY_LEDGER_INVALID')
    return matches[0].digest
  }
  return normalizeMoneyPayload({
    observation: 'sources-reverified',
    coverage: 'captured-marker-ledger-epoch-only',
    financeAuditStatus: result.status,
    needsContextCodes: result.diagnostics.filter(diagnostic => diagnostic.severity === 'needs-context').map(diagnostic => diagnostic.code).sort(),
    dataArchiveManifestDigest: dataManifest.digest,
    ledgerArchiveManifestDigest: ledgerManifest.digest,
    ledgerContentDigest: ledgerManifest.value.contentDigest,
    markerDigest: sha(markerBytes),
    routerMigrationTableDigest: tableDigest('router_migration'),
    routerMetaTableDigest: tableDigest('router_meta'),
    ledgerTables: ledgerSummary.tables,
    ledgerRows: ledgerSummary.rows,
    runCount: result.router.runCount,
    holdCount: result.router.holdCount,
    unassignedRunCount: result.router.unassignedRunCount,
  })
}

async function observeOnce (options, attestationType = 'artifact') {
  const operationDirectory = await canonicalDirectory(options.operationDirectory)
  const configurationDirectory = await canonicalDirectory(options.configurationDirectory)
  const fenceHome = await canonicalDirectory(options.fenceHome)
  const inspection = await inspectMigrationCommitOperation({ privateOutput: operationDirectory })
  if (inspection.valid !== true || inspection.summary?.maintenanceInstalled !== true || !digest(inspection.summary?.journalDigest)) fail('MIGRATION_ATTESTATION_OPERATION_INVALID')
  const operation = await readOperationRecord({ privateOutput: operationDirectory })
  if (operation.operationDigest !== inspection.operationDigest || operation.operationId !== inspection.operationId || operation.home !== fenceHome || operation.privateOutput !== operationDirectory || operation.host !== hostname() || operation.activationSupported !== false || operation.postActivationRollbackSupported !== false) fail('MIGRATION_ATTESTATION_OPERATION_MISMATCH')
  await assertOperationFiles(operationDirectory)
  const configuration = await inspectMigrationConfigurationCommit({ privateOutput: configurationDirectory })
  if (configuration.phase !== 'maintenance' || configuration.recognized !== true || configuration.activationSupported !== false || configuration.postActivationRollbackSupported !== false) fail('MIGRATION_ATTESTATION_CONFIGURATION_INVALID')
  const transaction = await stableJson(configurationDirectory, 'transaction.private.json', 8 * 1024 ** 2)
  const gate = readMigrationStartupGate({ home: fenceHome })
  if (!gate || gate.operationId !== operation.operationId || gate.phase !== 'maintenance' || gate.planDigest !== transaction.digest || gate.operationDirectory !== configurationDirectory || gate.journalEvents !== configuration.events || !digest(gate.journalHead)) fail('MIGRATION_ATTESTATION_CONFIGURATION_MISMATCH')
  if (transaction.value?.id !== operation.operationId || transaction.value?.home !== fenceHome || transaction.value?.directory !== configurationDirectory || transaction.value?.attestationsRequired?.join(',') !== 'stopped-hosts,complete-domains,consistent-backups,artifact,permissions,money') fail('MIGRATION_ATTESTATION_CONFIGURATION_MISMATCH')
  // The standing maintenance-installed verdict must describe exactly the gate
  // and configuration transaction observable now, not a historical one.
  const installed = inspection.journal.filter(row => row.step === 'maintenance-installed').at(-1)
  if (!installed) fail('MIGRATION_ATTESTATION_OPERATION_INVALID')
  if (installed.evidence.gatePhase !== gate.phase || installed.evidence.gateOperationId !== gate.operationId || installed.evidence.gateJournalEvents !== gate.journalEvents || installed.evidence.gateJournalHead !== gate.journalHead || installed.evidence.recognized !== true) fail('MIGRATION_ATTESTATION_CONFIGURATION_MISMATCH')
  const data = await readVerifiedMigrationDataArchive({ privateOutput: options.dataArchive, signal: options.signal })
  if (sha(encode(data.configurationPlan)) !== operation.profilePlanDigest) fail('MIGRATION_ATTESTATION_PLAN_MISMATCH')
  const dataManifest = await stableJson(data.root, 'capture.private.json', 128 * 1024 ** 2)
  const dataSummary = summarizeMigrationDataArchive(data.manifest)
  const ledgerArchive = await canonicalDirectory(options.ledgerArchive)
  const ledgerSummary = await verifyMigrationLedgerArchive({ Database: options.Database, privateOutput: ledgerArchive, signal: options.signal })
  if (ledgerSummary.status !== 'complete') fail('MIGRATION_ATTESTATION_ARCHIVE_INVALID')
  const ledgerManifest = await stableJson(ledgerArchive, 'archive.private.json', 1048576)
  if (!digest(ledgerManifest.value?.contentDigest)) fail('MIGRATION_ATTESTATION_ARCHIVE_INVALID')
  // The archives handed in must be the ones this operation's capture-verified
  // journal record pinned: manifest digests, content digest and the resolved
  // root digests (capture-started carries the same path digests). A different,
  // individually valid archive pair can never be re-packaged as the
  // observation of this operation.
  const captureVerified = inspection.journal.filter(row => row.step === 'capture-verified').at(-1)
  const captureStarted = inspection.journal.filter(row => row.step === 'capture-started').at(-1)
  if (!captureVerified || !captureStarted) fail('MIGRATION_ATTESTATION_OPERATION_INVALID')
  const recorded = captureVerified.evidence
  for (const key of ['captureManifestSha256', 'ledgerManifestSha256', 'ledgerContentDigest', 'dataRootDigest', 'ledgerRootDigest']) if (!digest(recorded[key])) fail('MIGRATION_ATTESTATION_OPERATION_INVALID')
  if (recorded.captureManifestSha256 !== dataManifest.digest || recorded.ledgerManifestSha256 !== ledgerManifest.digest || recorded.ledgerContentDigest !== ledgerManifest.value.contentDigest) fail('MIGRATION_ATTESTATION_ARCHIVE_MISMATCH')
  if (recorded.dataRootDigest !== sha(Buffer.from(data.root)) || recorded.ledgerRootDigest !== sha(Buffer.from(ledgerArchive))) fail('MIGRATION_ATTESTATION_ARCHIVE_MISMATCH')
  if (captureStarted.evidence.dataRootDigest !== recorded.dataRootDigest || captureStarted.evidence.ledgerRootDigest !== recorded.ledgerRootDigest) fail('MIGRATION_ATTESTATION_ARCHIVE_MISMATCH')
  if (recorded.captureSources !== dataSummary.sources || recorded.captureFiles !== dataSummary.files) fail('MIGRATION_ATTESTATION_ARCHIVE_MISMATCH')
  const fence = await readMigrationFence(fenceHome)
  if (!fence.maintenanceActive || fence.stopWriteProvable !== false || fence.liveShared.length !== 0 || fence.intent?.operationId !== operation.operationId || fence.exclusive?.operationId !== operation.operationId || fence.exclusive?.holderAlive !== true || fence.intent?.platform !== process.platform || fence.exclusive?.platform !== process.platform) fail('MIGRATION_ATTESTATION_FENCE_MISMATCH')
  const fenceDirectory = join(fenceHome, 'fence')
  await assertSingleLink(fenceDirectory, 'intent.json', 'MIGRATION_ATTESTATION_FENCE_MISMATCH')
  await assertSingleLink(fenceDirectory, 'exclusive.json', 'MIGRATION_ATTESTATION_FENCE_MISMATCH')
  const intentDigest = (await hashPrivateMigrationFile(fenceDirectory, 'intent.json', 16384)).sha256
  const exclusiveDigest = (await hashPrivateMigrationFile(fenceDirectory, 'exclusive.json', 16384)).sha256
  const context = normalizeContext({
    schemaVersion: 1,
    kind: 'migration-attestation-context',
    operationId: operation.operationId,
    operationDigest: operation.operationDigest,
    profilePlanDigest: operation.profilePlanDigest,
    configurationPlanDigest: transaction.digest,
    orchestrationJournalHead: inspection.summary.journalDigest,
    configurationJournalHead: gate.journalHead,
    dataArchiveManifestDigest: dataManifest.digest,
    ledgerArchiveManifestDigest: ledgerManifest.digest,
    ledgerContentDigest: ledgerManifest.value.contentDigest,
    host: operation.host,
    platform: process.platform,
    fenceIntentDigest: intentDigest,
    fenceExclusiveDigest: exclusiveDigest,
  })
  const payload = attestationType === 'money'
    ? await observeMoneyPayload({ data, dataManifest, ledgerArchive, ledgerManifest, ledgerSummary })
    : normalizeAutomaticPayload({
      observation: 'sources-reverified',
      operationJournalEntries: inspection.journal.length,
      configurationJournalEntries: configuration.events,
      dataSources: dataSummary.sources,
      dataFiles: dataSummary.files,
      dataDirectories: dataSummary.directories,
      dataBytes: dataSummary.totalBytes,
      rawSqliteFiles: dataSummary.rawSqliteFiles,
      ledgerTables: ledgerSummary.tables,
      ledgerRows: ledgerSummary.rows,
      dataArchiveManifestDigest: dataManifest.digest,
      ledgerArchiveManifestDigest: ledgerManifest.digest,
      ledgerContentDigest: ledgerManifest.value.contentDigest,
    })
  const protectedPaths = [operation.home, operation.privateOutput, configurationDirectory, data.root, ledgerArchive, fenceHome, ...operation.domains.flatMap(domain => domain.roots), ...configurationPaths(data.configurationPlan), ...(transaction.value.changes ?? []).map(change => change.path), ...(data.manifest.sourceInventory?.sources ?? []).map(source => source.root)]
  return { context, payload, protectedPaths }
}

async function observe (options, attestationType = 'artifact') {
  await guard(options)
  const first = await observeOnce(options, attestationType)
  await guard(options)
  const second = await observeOnce(options, attestationType)
  await guard(options)
  if (JSON.stringify(first.context) !== JSON.stringify(second.context) || JSON.stringify(first.payload) !== JSON.stringify(second.payload)) fail('MIGRATION_ATTESTATION_SOURCE_CHANGED')
  return second
}

function commonOptions (options) {
  return Object.fromEntries(COMMON.filter(key => Object.hasOwn(options, key)).map(key => [key, options[key]]))
}

function sameContext (a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('MIGRATION_ATTESTATION_BINDING_MISMATCH')
}

/** The persisted automatic payload must equal the current real observation. */
function samePayload (a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('MIGRATION_ATTESTATION_PAYLOAD_MISMATCH')
}

function summary (bundle, replayed) {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'migration-attestation-summary',
    status: bundle.evidenceClass === 'automatic-observation' ? 'observed' : 'declaration-only',
    attestationType: bundle.attestationType,
    evidenceClass: bundle.evidenceClass,
    observations: 1,
    replayed,
    allowed: false,
    activationSupported: false,
    postActivationRollbackSupported: false,
    stopWriteProvable: false,
    generationAvailable: false,
  })
}

async function outputPath (path, protectedPaths) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || Buffer.byteLength(path) > 4096) fail('MIGRATION_ATTESTATION_OUTPUT_INVALID')
  const resolved = resolve(path)
  let output
  let info = await lstat(resolved).catch(error => { if (error?.code === 'ENOENT') return null; throw error })
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink()) fail('MIGRATION_ATTESTATION_OUTPUT_CONFLICT')
    output = await realpath(resolved)
    if (output !== resolved) fail('MIGRATION_ATTESTATION_OUTPUT_CONFLICT')
  } else {
    const parent = await canonicalDirectory(dirname(resolved))
    output = join(parent, basename(resolved))
  }
  const sources = []
  for (const path of new Set(protectedPaths.filter(path => typeof path === 'string' && isAbsolute(path)))) {
    const source = await realpath(resolve(path)).catch(error => { if (['ENOENT', 'ENOTDIR'].includes(error?.code)) return resolve(path); throw error })
    sources.push(source)
    if (overlap(output, source)) fail('MIGRATION_ATTESTATION_OUTPUT_OVERLAP')
  }
  if (info) {
    const targetIdentity = await stat(output, { bigint: true })
    for (const source of sources) {
      const identity = await stat(source, { bigint: true }).catch(error => { if (['ENOENT', 'ENOTDIR'].includes(error?.code)) return null; throw error })
      if (identity && String(identity.dev) === String(targetIdentity.dev) && String(identity.ino) === String(targetIdentity.ino)) fail('MIGRATION_ATTESTATION_OUTPUT_OVERLAP')
    }
  }
  return { output, exists: info !== null }
}

async function stableOutput (output, name, maximum) {
  return boundedRead(output, name, maximum, 'MIGRATION_ATTESTATION_OUTPUT_INVALID', 'MIGRATION_ATTESTATION_OUTPUT_CHANGED', 'MIGRATION_ATTESTATION_OUTPUT_INCOMPLETE')
}

async function readBundle (output) {
  const bytes = await stableOutput(output, BUNDLE_FILE, MAX_BUNDLE_BYTES)
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch { fail('MIGRATION_ATTESTATION_BUNDLE_INVALID') }
  const bundle = normalizeBundle(value)
  if (!bytes.equals(encode(bundle))) fail('MIGRATION_ATTESTATION_NONCANONICAL')
  return bundle
}

async function readCompletion (output, bundleDigest) {
  const bytes = await stableOutput(output, COMPLETE_FILE, 4096)
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch { fail('MIGRATION_ATTESTATION_COMPLETION_INVALID') }
  object(value, ['schemaVersion', 'kind', 'bundleDigest'], 'MIGRATION_ATTESTATION_COMPLETION_INVALID')
  if (value.schemaVersion !== 1 || value.kind !== 'migration-attestation-complete' || value.bundleDigest !== bundleDigest || !bytes.equals(encode({ schemaVersion: 1, kind: 'migration-attestation-complete', bundleDigest: value.bundleDigest }))) fail('MIGRATION_ATTESTATION_COMPLETION_INVALID')
}

async function publishCompletion (output, bundle) {
  const bytes = encode({ schemaVersion: 1, kind: 'migration-attestation-complete', bundleDigest: bundle.bundleDigest })
  try { await writePrivateMigrationFile(output, COMPLETE_FILE, bytes) } catch (error) { if (error?.code !== 'EEXIST') throw error }
  await readCompletion(output, bundle.bundleDigest)
}

async function recheck (options, expected, payload, attestationType = 'artifact') {
  const current = await observe(commonOptions(options), attestationType)
  sameContext(current.context, expected)
  if (payload) samePayload(payload, current.payload)
  return current
}

export async function observeMigrationAttestationContext (options = {}) {
  optionsObject(options, OBSERVE_INPUTS)
  validateCommon(options)
  return (await observe(options)).context
}

export async function createMigrationAttestationBundle (options = {}) {
  optionsObject(options, CREATE_INPUTS)
  validateCommon(options)
  if (!TYPES.has(options.attestationType) || !CLASSES.has(options.evidenceClass)) fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  if (options.evidenceClass === 'platform-evidence' || (options.evidenceClass === 'automatic-observation' && !['artifact', 'money'].includes(options.attestationType))) fail('MIGRATION_ATTESTATION_UNSUPPORTED')
  // ttlMs is part of the request identity: it must be present and valid before
  // any output side effect, because the persisted expiry is derived from it.
  if (options.ttlMs === undefined) fail('MIGRATION_ATTESTATION_TTL_INVALID')
  validateTimes(options.nowMs, options.clockFloorMs, options.ttlMs)
  if (options.onBoundary !== undefined && typeof options.onBoundary !== 'function') fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  const expected = normalizeContext(options.expected)
  if (options.evidenceClass === 'manual-declaration' && options.declaration === undefined) fail('MIGRATION_ATTESTATION_DECLARATION_INVALID')
  if (options.evidenceClass === 'automatic-observation' && options.declaration !== undefined) fail('MIGRATION_ATTESTATION_INPUT_INVALID')
  const declaration = options.evidenceClass === 'manual-declaration' ? normalizeDeclaration(options.declaration) : null
  const observed = await observe(options, options.evidenceClass === 'automatic-observation' ? options.attestationType : 'artifact')
  sameContext(observed.context, expected)
  const payload = declaration ?? observed.payload
  // Built before any output side effect so an oversized declaration cannot
  // leave a half-prepared private directory behind.
  const candidate = makeBundle({ expected, attestationType: options.attestationType, evidenceClass: options.evidenceClass, payload, nowMs: options.nowMs, ttlMs: options.ttlMs })
  const location = await outputPath(options.privateOutput, observed.protectedPaths)
  let existed = location.exists
  if (!existed) {
    try { await createPrivateMigrationDirectory(location.output) } catch (error) { if (error?.code !== 'EEXIST') throw error; existed = true }
  }
  let bundle
  if (!existed) {
    bundle = candidate
    await writePrivateMigrationFile(location.output, BUNDLE_FILE, encode(bundle))
    await readBundle(location.output)
    if (options.onBoundary) await options.onBoundary(Object.freeze({ point: 'bundle-written' }))
  } else {
    // Same-request idempotency: nowMs/clockFloorMs are not part of the request
    // identity. A later call inside the original expiry reuses the persisted
    // collectedAt/expiry/bytes/mtime instead of conflicting or renewing; an
    // expired one is rejected against this call's nowMs.
    let existing
    try { existing = await readBundle(location.output) } catch (error) { fail('MIGRATION_ATTESTATION_OUTPUT_CONFLICT') }
    if (existing.attestationType !== options.attestationType || existing.evidenceClass !== options.evidenceClass || existing.expiresAt - existing.collectedAt !== options.ttlMs) fail('MIGRATION_ATTESTATION_REQUEST_CONFLICT')
    sameContext(existing.binding, expected)
    if (declaration) {
      if (JSON.stringify(existing.payload) !== JSON.stringify(declaration)) fail('MIGRATION_ATTESTATION_REQUEST_CONFLICT')
    } else {
      samePayload(existing.payload, payload)
    }
    if (options.nowMs < existing.collectedAt || options.nowMs >= existing.expiresAt) fail('MIGRATION_ATTESTATION_EXPIRED')
    bundle = existing
  }
  await recheck(options, expected, bundle.evidenceClass === 'automatic-observation' ? bundle.payload : null, bundle.evidenceClass === 'automatic-observation' ? bundle.attestationType : 'artifact')
  await guard(options)
  await publishCompletion(location.output, bundle)
  await guard(options)
  return summary(bundle, existed)
}

export async function verifyMigrationAttestationBundle (options = {}) {
  optionsObject(options, VERIFY_INPUTS)
  validateCommon(options)
  validateTimes(options.nowMs, options.clockFloorMs)
  const expected = normalizeContext(options.expected)
  let observed = await observe(options)
  sameContext(observed.context, expected)
  const location = await outputPath(options.privateOutput, observed.protectedPaths)
  if (!location.exists) fail('MIGRATION_ATTESTATION_BUNDLE_MISSING')
  await guard(options)
  const bundle = await readBundle(location.output)
  await readCompletion(location.output, bundle.bundleDigest)
  sameContext(bundle.binding, expected)
  // A binding match alone is not acceptance: the automatic payload must equal
  // the payload re-observed from the current real sources, so recomputing the
  // self hash after editing counts or archive digests never passes.
  if (bundle.evidenceClass === 'automatic-observation') {
    if (bundle.attestationType === 'money') {
      observed = await observe(options, 'money')
      sameContext(observed.context, expected)
    }
    samePayload(bundle.payload, observed.payload)
  }
  if (options.nowMs < bundle.collectedAt || options.nowMs >= bundle.expiresAt) fail('MIGRATION_ATTESTATION_EXPIRED')
  await recheck(options, expected, bundle.evidenceClass === 'automatic-observation' ? bundle.payload : null, bundle.evidenceClass === 'automatic-observation' ? bundle.attestationType : 'artifact')
  await guard(options)
  return summary(bundle, false)
}
