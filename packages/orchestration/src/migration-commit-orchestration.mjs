import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { createPrivateMigrationDirectory, hashPrivateMigrationFile, writePrivateMigrationFile } from './migration-private-files.mjs'
import { beginMigrationExclusive, readMigrationFence } from './migration-fence.mjs'
import { readMigrationStartupGate } from './migration-startup-gate.mjs'
import { inspectMigrationConfigurationCommit, prepareMigrationConfigurationCommit, resumeMigrationConfigurationCommit } from './migration-configuration-commit.mjs'
import { inventoryMigrationWriters } from './migration-writer-inventory.mjs'
import { createMigrationDataArchive, verifyMigrationDataArchive } from './migration-data-archive.mjs'
import { createMigrationLedgerArchive, verifyMigrationLedgerArchive } from './migration-ledger-export.mjs'
import { quarantineMigrationRemoteClients } from './migration-remote-client-quarantine.mjs'
import { assertMigrationRemoteOperationsSettled } from './migration-remote-operation-drain.mjs'

const fail = (code, details) => { throw Object.assign(new Error(code), { code, ...(details ? { details } : {}) }) }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const encode = value => Buffer.from(JSON.stringify(value) + '\n')

const PHASES = Object.freeze(['inspect', 'intent', 'drain', 'capture', 'maintenance', 'activate', 'release'])
const PHASE_AT = new Map(PHASES.map((phase, index) => [phase, index]))
// The fixed step vocabulary of section 3 of the orchestration design. An
// unknown string is a journal defect, never a forward step.
const FORWARD_STEPS = new Map(Object.entries({
  'plan-recorded': 'inspect',
  'fence-intent-requested': 'intent',
  'fence-intent-persisted': 'intent',
  'drain-started': 'drain',
  'drain-completed': 'drain',
  'exclusive-acquired': 'drain',
  'remote-revoke-requested': 'drain',
  'remote-revoke-completed': 'drain',
  'remote-operation-drain-requested': 'drain',
  'remote-operation-drain-completed': 'drain',
  'capture-started': 'capture',
  'capture-verified': 'capture',
  'maintenance-started': 'maintenance',
  'maintenance-installed': 'maintenance',
  'activation-evaluated': 'activate',
  'activation-refused': 'activate',
  'release-requested': 'release',
  'released': 'release',
}))
const BLOCKED_STEPS = new Map(Object.entries({
  'blocked-inspect': 'inspect',
  'blocked-owner': 'intent',
  'blocked-drain': 'drain',
  'blocked-capture': 'capture',
  'blocked-maintenance': 'maintenance',
  'blocked-activation': 'activate',
  'blocked-release': 'release',
}))
const CANCELLED_STEPS = new Set(['cancelled', 'cancelled-fence-held'])
const STEP_PHASE = new Map([...FORWARD_STEPS, ...BLOCKED_STEPS])
// The intent phase's blocked verdict is named blocked-owner; every other phase
// mirrors its own name.
const blockedStepFor = phase => phase === 'intent' ? 'blocked-owner' : 'blocked-' + phase
const FENCE_STEPS = new Set(['fence-intent-persisted', 'drain-started', 'drain-completed', 'exclusive-acquired'])

const OPERATION_FILE = 'operation.private.json'
const OPERATION_KIND = 'migration-commit-operation'
const MAX_STEPS = 1000
const MAX_OPERATION_BYTES = 16 * 1024
const MAX_STEP_BYTES = 16 * 1024
const MAX_CAPTURE_MANIFEST = 128 * 1024 * 1024
const MAX_LEDGER_MANIFEST = 1024 * 1024
const EVIDENCE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
// The gate reader accepts only a UUID v4 operation id, so the single id shared
// by fence intent, fence exclusive, plan.id and gate.operationId must be one.
const OPERATION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const DEFAULTS = Object.freeze({ drainTimeoutMs: 60000, pollMs: 50 })
const LIMIT_BOUNDS = Object.freeze({ drainTimeoutMs: [1, 600000], pollMs: [1, 10000] })
const stepFile = index => 'step-' + String(index).padStart(5, '0') + '.json'

function ownIdentity () {
  if (process.platform !== 'linux') return Promise.resolve({ pid: process.pid, startTicks: null, platform: process.platform })
  return readFile('/proc/' + process.pid + '/stat', 'utf8')
    .then(value => Number(value.slice(value.lastIndexOf(')') + 1).trim().split(/\s+/)[19]))
    .then(value => ({ pid: process.pid, startTicks: Number.isFinite(value) ? value : null, platform: process.platform }))
    .catch(() => ({ pid: process.pid, startTicks: null, platform: process.platform }))
}

const criterion = (id, reason) => Object.freeze({ id, ok: false, reason })
/**
 * Section 7's fixed denial enum. Every entry is false and names missing
 * evidence; nothing in this module (or a caller) can turn one true.
 */
export const ACTIVATION_CRITERIA = Object.freeze([
  criterion('C1', 'NO_OPERATING_SYSTEM_ISOLATION_AND_OLD_WRITER_STOP'),
  criterion('C2', 'NO_CROSS_DOMAIN_CONSISTENT_CAPTURE'),
  criterion('C3', 'NO_ALL_DATABASES_CONSISTENT_BACKUP'),
  criterion('C4', 'WRITER_ENUMERATION_UNAVAILABLE'),
  criterion('C5', 'NO_FORCED_STOP_EVIDENCE'),
  criterion('C6', 'ATTESTATIONS_DECLARED_NOT_VERIFIED'),
  criterion('C7', 'NO_FUNDING_AUTHORITY_GENERATION_SWITCH'),
  criterion('C8', 'NO_POST_ACTIVATION_DATA_ROLLBACK'),
  criterion('C9', 'GATE_NOT_WIRED_TO_PRODUCT_ADMISSION'),
  criterion('C10', 'NO_NATIVE_COMMAND_SURFACE'),
])
export const ACTIVATION_SUPPORTED = false
export const POST_ACTIVATION_ROLLBACK_SUPPORTED = false
const DEFAULT_VERIFIER = () => ({ allowed: false, code: 'MIGRATION_ORCH_ACTIVATION_UNSUPPORTED' })

function boundedEvidence (evidence) {
  if (!record(evidence)) fail('MIGRATION_ORCH_INPUT_INVALID')
  for (const [key, value] of Object.entries(evidence)) {
    if (!EVIDENCE_KEY.test(key)) fail('MIGRATION_ORCH_INPUT_INVALID')
    if (value === null) continue
    if (!['string', 'number', 'boolean'].includes(typeof value)) fail('MIGRATION_ORCH_INPUT_INVALID')
    if (typeof value === 'number' && !Number.isFinite(value)) fail('MIGRATION_ORCH_INPUT_INVALID')
    if (typeof value === 'string' && value.length > 512) fail('MIGRATION_ORCH_INPUT_INVALID')
  }
  return evidence
}

async function canonicalDirectory (path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('MIGRATION_ORCH_INPUT_INVALID')
  const resolved = resolve(path)
  let canonical
  try { canonical = await realpath(resolved) } catch (error) { if (error?.code === 'ENOENT') fail('MIGRATION_ORCH_INPUT_INVALID'); throw error }
  const info = await lstat(canonical)
  if (!info.isDirectory() || info.isSymbolicLink()) fail('MIGRATION_ORCH_INPUT_INVALID')
  return canonical
}

/** A not-yet-created owner directory under a canonical parent. */
async function canonicalNewPath (path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('MIGRATION_ORCH_INPUT_INVALID')
  const resolved = resolve(path)
  const parent = await canonicalDirectory(dirname(resolved))
  return join(parent, basename(resolved))
}

const inside = (base, target) => { const path = relative(base, target); return !path || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)) }

function validateLimits (limits) {
  if (!record(limits)) fail('MIGRATION_ORCH_INPUT_INVALID')
  const out = {}
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULTS, key)) fail('MIGRATION_ORCH_INPUT_INVALID')
    const bounds = LIMIT_BOUNDS[key]
    if (!Number.isSafeInteger(value) || value < bounds[0] || value > bounds[1]) fail('MIGRATION_ORCH_INPUT_INVALID')
    out[key] = value
  }
  return { ...DEFAULTS, ...out }
}

function validateDomains (domains) {
  if (!Array.isArray(domains) || domains.length < 1 || domains.length > 32) fail('MIGRATION_ORCH_INPUT_INVALID')
  const names = new Set()
  return domains.map(domain => {
    if (!record(domain) || Object.keys(domain).some(key => !['name', 'roots'].includes(key))) fail('MIGRATION_ORCH_INPUT_INVALID')
    if (typeof domain.name !== 'string' || !domain.name.length || domain.name.length > 128 || /[\0-\x1f\x7f]/.test(domain.name) || names.has(domain.name)) fail('MIGRATION_ORCH_INPUT_INVALID')
    names.add(domain.name)
    if (!Array.isArray(domain.roots) || domain.roots.length < 1 || domain.roots.length > 64) fail('MIGRATION_ORCH_INPUT_INVALID')
    const roots = domain.roots.map(root => {
      if (typeof root !== 'string' || !isAbsolute(root) || root.length > 4096 || root.includes('\0')) fail('MIGRATION_ORCH_INPUT_INVALID')
      return resolve(root)
    })
    return { name: domain.name, roots }
  })
}

function validateRemoteClients (clients) {
  if (!Array.isArray(clients) || clients.length > 64) fail('MIGRATION_ORCH_INPUT_INVALID')
  const seen = new Set()
  return clients.map(client => {
    if (!record(client) || Object.keys(client).some(key => !['configPath', 'machineId', 'clientId'].includes(key))) fail('MIGRATION_ORCH_INPUT_INVALID')
    if (typeof client.configPath !== 'string' || !isAbsolute(client.configPath) || client.configPath.length > 4096 || client.configPath.includes('\0')) fail('MIGRATION_ORCH_INPUT_INVALID')
    if (!/^[-A-Za-z0-9_.]{1,128}$/.test(client.machineId ?? '') || !/^[-A-Za-z0-9_.]{1,128}$/.test(client.clientId ?? '')) fail('MIGRATION_ORCH_INPUT_INVALID')
    const key = `${client.machineId}\0${client.clientId}`
    if (seen.has(key)) fail('MIGRATION_ORCH_INPUT_INVALID')
    seen.add(key)
    return { configPath: resolve(client.configPath), machineId: client.machineId, clientId: client.clientId }
  })
}

function validateOperation (operation) {
  if (!record(operation)) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (operation.schemaVersion !== 1 || operation.kind !== OPERATION_KIND) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (typeof operation.operationId !== 'string' || !OPERATION_ID.test(operation.operationId)) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (operation.remoteClients !== undefined || operation.remoteClientsDigest !== undefined) {
    if (operation.remoteClientsDigest !== sha(encode(validateRemoteClients(operation.remoteClients)))) fail('MIGRATION_ORCH_OPERATION_INVALID')
  }
  for (const key of ['home', 'privateOutput']) if (typeof operation[key] !== 'string' || !isAbsolute(operation[key])) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (!Array.isArray(operation.domains) || !operation.domains.length || operation.domains.length > 32) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (operation.domainsDigest !== sha(encode(operation.domains))) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (typeof operation.profilePlanDigest !== 'string' || !/^[a-f0-9]{64}$/.test(operation.profilePlanDigest)) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (operation.profilePlanStatus !== 'ready') fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (!record(operation.limits) || Object.keys(operation.limits).some(key => !Object.hasOwn(DEFAULTS, key))) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (Object.values(operation.limits).some(value => !Number.isSafeInteger(value) || value < 1)) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (!Number.isSafeInteger(operation.createdAt) || operation.createdAt < 1) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (typeof operation.host !== 'string' || !operation.host.length || operation.host.length > 256) fail('MIGRATION_ORCH_OPERATION_INVALID')
  // A record that claims activation support is treated as damaged, never obeyed.
  if (operation.activationSupported !== false || operation.postActivationRollbackSupported !== false) fail('MIGRATION_ORCH_OPERATION_INVALID')
}

async function readOperation (root) {
  let info
  try { info = await hashPrivateMigrationFile(root, OPERATION_FILE, MAX_OPERATION_BYTES) }
  catch (error) {
    if (error?.code === 'ENOENT') fail('MIGRATION_ORCH_OPERATION_MISSING')
    if (String(error?.code ?? '').startsWith('MIGRATION_PRIVATE_')) fail('MIGRATION_ORCH_OPERATION_INVALID')
    throw error
  }
  const bytes = await readFile(join(root, OPERATION_FILE))
  if (bytes.length !== info.bytes || sha(bytes) !== info.sha256) fail('MIGRATION_ORCH_OPERATION_INVALID')
  let operation
  try { operation = JSON.parse(bytes.toString('utf8')) } catch { fail('MIGRATION_ORCH_OPERATION_INVALID') }
  validateOperation(operation)
  if (await realpath(operation.home) !== operation.home) fail('MIGRATION_ORCH_OPERATION_INVALID')
  if (operation.privateOutput !== root) fail('MIGRATION_ORCH_OPERATION_INVALID')
  return { operation, digest: info.sha256 }
}

function validateStepRow (row, index, previous, operation, previousRow) {
  if (!record(row)) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  if (row.index !== index || row.previous !== previous || row.operationId !== operation.operationId) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  if (typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest)) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  const body = {}
  for (const [key, value] of Object.entries(row)) if (key !== 'digest') body[key] = value
  if (sha(encode(body)) !== row.digest) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  if (!STEP_PHASE.has(row.step) && !CANCELLED_STEPS.has(row.step)) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  if (!PHASES.includes(row.phase)) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  if (STEP_PHASE.has(row.step) && STEP_PHASE.get(row.step) !== row.phase) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  if (previousRow && PHASE_AT.get(row.phase) < PHASE_AT.get(previousRow.phase)) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  if (typeof row.at !== 'number' || !Number.isFinite(row.at)) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  boundedEvidence(row.evidence)
}

async function loadChain (root, operation, operationDigest) {
  const names = await readdir(root)
  for (const name of names) if (name.startsWith('step') && !/^step-\d{5}\.json$/.test(name)) fail('MIGRATION_ORCH_JOURNAL_INVALID')
  const stepNames = names.filter(name => /^step-\d{5}\.json$/.test(name)).sort()
  if (stepNames.length > MAX_STEPS) fail('MIGRATION_ORCH_JOURNAL_LIMIT')
  const rows = []
  let previous = operationDigest
  for (let index = 0; index < stepNames.length; index++) {
    if (stepNames[index] !== stepFile(index)) fail('MIGRATION_ORCH_JOURNAL_INVALID')
    let info
    try { info = await hashPrivateMigrationFile(root, stepNames[index], MAX_STEP_BYTES) }
    catch (error) { fail('MIGRATION_ORCH_JOURNAL_INVALID') }
    const bytes = await readFile(join(root, stepNames[index]))
    if (bytes.length !== info.bytes || sha(bytes) !== info.sha256) fail('MIGRATION_ORCH_JOURNAL_INVALID')
    let row
    try { row = JSON.parse(bytes.toString('utf8')) } catch { fail('MIGRATION_ORCH_JOURNAL_INVALID') }
    validateStepRow(row, index, previous, operation, rows[index - 1])
    rows.push(row)
    previous = row.digest
  }
  return rows
}

async function appendStep (ctx, phase, step, evidence = {}) {
  const index = ctx.steps.length
  if (index >= MAX_STEPS) fail('MIGRATION_ORCH_JOURNAL_LIMIT')
  const previousRow = ctx.steps[index - 1]
  if (!PHASES.includes(phase)) fail('MIGRATION_ORCH_STATE_INVALID')
  if (previousRow && PHASE_AT.get(phase) < PHASE_AT.get(previousRow.phase)) fail('MIGRATION_ORCH_STATE_INVALID')
  const body = {
    index,
    phase,
    step,
    previous: index === 0 ? ctx.operationDigest : previousRow.digest,
    operationId: ctx.operation.operationId,
    at: Date.now(),
    evidence: boundedEvidence(evidence),
  }
  const complete = { ...body, digest: sha(encode(body)) }
  const bytes = encode(complete)
  if (bytes.length > MAX_STEP_BYTES) fail('MIGRATION_ORCH_JOURNAL_LIMIT')
  try { await writePrivateMigrationFile(ctx.root, stepFile(index), bytes) }
  catch (error) { if (error?.code === 'EEXIST') fail('MIGRATION_ORCH_JOURNAL_CONFLICT'); throw error }
  ctx.steps.push(complete)
  await ctx.boundary({ point: 'after-step:' + step, step, index })
  return complete
}

/** A phase may not append a record whose phase is already behind the chain. */
const canAppend = (ctx, phase) => {
  const last = ctx.steps.at(-1)
  return !last || PHASE_AT.get(phase) >= PHASE_AT.get(last.phase)
}

function deriveState (steps) {
  const last = steps.at(-1) ?? null
  const phase = last?.phase ?? 'inspect'
  if (!last) return { status: 'idle', phase, last, count: 0 }
  if (last.step === 'released') return { status: 'released', phase, last, count: steps.length }
  if (CANCELLED_STEPS.has(last.step)) return { status: 'cancelled', phase, last, count: steps.length, fenceHeld: last.step === 'cancelled-fence-held' }
  if (BLOCKED_STEPS.has(last.step)) return { status: 'blocked', phase, last, count: steps.length, blockedPhase: BLOCKED_STEPS.get(last.step) }
  return { status: 'active', phase, last, count: steps.length }
}

/**
 * Section 4.6 step 3: the only forward action the chain permits next. A blocked
 * record is re-attempted by the phase that produced it, so one verdict is never
 * silently replaced by another.
 */
function nextAction (state) {
  if (state.status === 'idle') return 'inspect'
  if (state.status === 'released' || state.status === 'cancelled') return null
  if (state.status === 'blocked') {
    switch (state.blockedPhase) {
      case 'inspect': return null
      case 'intent':
      case 'drain': return 'fence'
      case 'capture': return 'capture'
      case 'maintenance': return 'maintenance'
      case 'activate':
      case 'release': return 'release'
      default: return null
    }
  }
  switch (state.last.step) {
    case 'plan-recorded':
    case 'fence-intent-requested':
    case 'fence-intent-persisted':
    case 'drain-started':
    case 'drain-completed':
    case 'remote-revoke-requested':
    case 'remote-operation-drain-requested': return 'fence'
    case 'exclusive-acquired':
    case 'remote-revoke-completed':
    case 'remote-operation-drain-completed':
    case 'capture-started': return 'capture'
    case 'capture-verified':
    case 'maintenance-started': return 'maintenance'
    case 'maintenance-installed':
    case 'activation-evaluated': return 'activate'
    case 'activation-refused':
    case 'release-requested': return 'release'
    default: return null
  }
}

const statusOf = state => {
  if (state.status === 'idle') return 'inspect-pending'
  if (state.status === 'released') return 'released'
  if (state.status === 'cancelled') return state.fenceHeld ? 'cancelled-fence-held' : 'cancelled'
  if (state.status === 'blocked') return blockedStepFor(state.blockedPhase)
  if (state.last?.step === 'activation-refused') return 'blocked-activation'
  return 'active'
}

function summarizeState (operation, steps, state) {
  const last = state.last
  const status = statusOf(state)
  return Object.freeze({
    schemaVersion: 1,
    kind: 'migration-commit-operation-summary',
    operationId: operation.operationId,
    status,
    phase: state.phase,
    step: last?.step ?? null,
    steps: steps.length,
    journalDigest: last?.digest ?? null,
    released: status === 'released',
    cancelled: status === 'cancelled' || status === 'cancelled-fence-held',
    blocked: status.startsWith('blocked-'),
    terminal: ['released', 'cancelled', 'cancelled-fence-held'].includes(status) || status.startsWith('blocked-'),
    fenceEstablished: steps.some(row => FENCE_STEPS.has(row.step)),
    captureVerified: steps.some(row => row.step === 'capture-verified'),
    maintenanceInstalled: steps.some(row => row.step === 'maintenance-installed'),
    activation: Object.freeze({
      criteria: Object.freeze(ACTIVATION_CRITERIA.map(({ id, ok }) => Object.freeze({ id, ok }))),
      deniedBy: ACTIVATION_CRITERIA.find(entry => !entry.ok)?.id ?? null,
      supported: false,
    }),
    activationSupported: ACTIVATION_SUPPORTED,
    postActivationRollbackSupported: POST_ACTIVATION_ROLLBACK_SUPPORTED,
    stopWriteProvable: false,
    requiresStopProof: true,
    crossDomainConsistent: false,
    databaseConsistent: false,
  })
}

async function observeWorld (operation) {
  const fence = await readMigrationFence(operation.home)
  const gate = readMigrationStartupGate({ home: operation.home })
  return Object.freeze({
    gatePhase: gate?.phase ?? null,
    gateOperationId: gate?.operationId ?? null,
    gateMatchesOperation: gate === null || gate.operationId === operation.operationId,
    maintenanceActive: fence.maintenanceActive,
    liveShared: fence.liveShared.length,
    intent: fence.intent !== null,
    exclusive: fence.exclusive !== null,
    stopWriteProvable: false,
  })
}

async function describe (ctx) {
  const state = deriveState(ctx.steps)
  const summary = summarizeState(ctx.operation, ctx.steps, state)
  let world
  try { world = await observeWorld(ctx.operation) } catch (error) { world = Object.freeze({ error: error?.code ?? 'MIGRATION_ORCH_WORLD_UNREADABLE' }) }
  return Object.freeze({ ...summary, world })
}

/**
 * N1 lock order: fence (exclusive) -> commit (migration-gate.lock). The reverse
 * order is forbidden: nothing here takes the configuration lock without holding
 * a verified exclusive, so a commit lock can never be observed while a writer
 * could still be admitted.
 */
async function assertFenceHeld (ctx) {
  if (!ctx.fence) fail('MIGRATION_ORCH_FENCE_NOT_HELD')
  if (!await ctx.fence.verify()) fail('MIGRATION_ORCH_FENCE_NOT_HELD')
}

/**
 * Section 4.6 step 7: re-check ownership of the live fence before every effect.
 * Consistency is the live exclusive's operation id plus a chain that really
 * established the fence. The pid recorded in the chain is deliberately not
 * compared: a takeover by a new process is legitimate, and a stale recorded pid
 * that is still alive is not evidence of a second owner - the fence refuses a
 * live foreign owner when the exclusive is taken.
 */
async function assertOwnerAndFence (ctx) {
  await assertFenceHeld(ctx)
  const state = await readMigrationFence(ctx.operation.home)
  if (state.exclusive?.operationId !== ctx.operation.operationId) fail('MIGRATION_ORCH_OWNER_UNCERTAIN')
  if (!ctx.steps.some(row => FENCE_STEPS.has(row.step))) fail('MIGRATION_ORCH_OWNER_UNCERTAIN')
  return state
}

/**
 * Records a verdict. Returns false when the same verdict (or any other standing
 * blocked verdict) is already the chain head, so repeated recovery attempts
 * never grow the journal by repeating themselves.
 */
async function block (ctx, phase, step, reason, extra = {}) {
  const last = ctx.steps.at(-1)
  if (last && last.step === step && last.evidence.reason === reason) return false
  if (last && BLOCKED_STEPS.has(last.step) && last.step !== step) return false
  await appendStep(ctx, phase, step, { reason, ...extra })
  return true
}

async function cancel (ctx, inFence) {
  const state = deriveState(ctx.steps)
  const phase = inFence && PHASE_AT.get(state.phase) < PHASE_AT.get('intent') ? 'intent' : state.phase
  const step = inFence ? 'cancelled-fence-held' : 'cancelled'
  const last = ctx.steps.at(-1)
  if (last && last.step === step) return
  await appendStep(ctx, phase, step, { reason: 'MIGRATION_ORCH_CANCELLED' })
}

const requireInputs = (ctx, names) => {
  const missing = names.filter(name => ctx.options[name] === undefined || ctx.options[name] === null)
  if (missing.length) fail('MIGRATION_ORCH_INPUT_REQUIRED', { missing })
}

async function observeGate (ctx, phase) {
  const gate = readMigrationStartupGate({ home: ctx.operation.home })
  if (gate && gate.operationId !== ctx.operation.operationId) {
    await block(ctx, phase, blockedStepFor(phase), 'gate-operation-id-mismatch', {})
    fail('MIGRATION_ORCH_GATE_MISMATCH')
  }
  return gate
}

async function writerObservation (ctx) {
  try {
    const writers = await inventoryMigrationWriters({ domains: ctx.operation.domains, signal: ctx.signal })
    const holders = Array.isArray(writers?.domains) ? writers.domains.reduce((sum, domain) => sum + (Array.isArray(domain.accessors) ? domain.accessors.length : 0), 0) : 0
    return { mode: writers?.enumeration?.mode ?? 'unknown', holders, stopWriteProvable: false }
  } catch (error) {
    return { mode: error?.code === 'MIGRATION_WRITER_CANCELLED' ? 'cancelled' : 'unavailable', holders: 0, stopWriteProvable: false }
  }
}

/** inspect: read-only plan binding plus the first journal record. */
async function inspectPhase (ctx) {
  if (ctx.steps.length > 0) fail('MIGRATION_ORCH_STATE_INVALID')
  const operation = ctx.operation
  const writers = await inventoryMigrationWriters({ domains: operation.domains, signal: ctx.signal })
  await appendStep(ctx, 'inspect', 'plan-recorded', {
    domainsDigest: operation.domainsDigest,
    profilePlanDigest: operation.profilePlanDigest,
    writerObservationDigest: sha(encode(writers)),
    writerEnumeration: writers?.enumeration?.mode ?? 'unknown',
    stopWriteProvable: false,
  })
}

const OWNER_CODES = new Set(['MIGRATION_FENCE_BUSY', 'MIGRATION_FENCE_OWNER_CONFLICT', 'MIGRATION_FENCE_GUARD_TIMEOUT'])
const UNREADABLE_CODES = new Set(['MIGRATION_FENCE_INTENT_UNREADABLE', 'MIGRATION_FENCE_EXCLUSIVE_UNREADABLE'])
const reasonOf = code => code.toLowerCase().replace(/^migration_fence_/, '').replaceAll('_', '-')

/** Maps a fence refusal onto a journalled verdict; a live foreign owner is owner uncertainty. */
async function fenceFailure (ctx, phase, error) {
  const code = error?.code ?? 'MIGRATION_ORCH_FENCE_FAILED'
  if (code === 'MIGRATION_FENCE_CANCELLED' || ctx.signal?.aborted) { await cancel(ctx, true); fail('MIGRATION_ORCH_CANCELLED') }
  const blockedPhase = code === 'MIGRATION_FENCE_DRAIN_TIMEOUT' ? 'drain' : (PHASE_AT.get(phase) < PHASE_AT.get('intent') ? 'intent' : phase)
  if (code === 'MIGRATION_FENCE_DRAIN_TIMEOUT' || OWNER_CODES.has(code) || UNREADABLE_CODES.has(code)) {
    await block(ctx, blockedPhase, blockedStepFor(blockedPhase), reasonOf(code), { observedHolders: ctx.observedHolders })
  }
  if (OWNER_CODES.has(code)) fail('MIGRATION_ORCH_OWNER_UNCERTAIN', { cause: code })
  throw error
}

/**
 * Every phase that changes something re-establishes the exclusive after a crash
 * first; a takeover of a live foreign owner is refused, never forced.
 */
async function acquireFence (ctx, phase) {
  if (ctx.fence && await ctx.fence.verify()) return ctx.fence
  try { return await ensureFence(ctx) } catch (error) { await fenceFailure(ctx, phase, error) }
}

/**
 * intent and drain. The fence offers no intent-only entry point, so the durable
 * intent, the drain and the exclusive are one delegated transaction
 * (beginMigrationExclusive). The fence-intent-requested record is the
 * intent-before-effect record for that whole transaction; the five later
 * records are its observations.
 */
async function fencePhase (ctx) {
  const operation = ctx.operation
  const gate = await observeGate(ctx, 'intent')
  if (gate && !['committed', 'rolled-back'].includes(gate.phase)) fail('MIGRATION_ORCH_GATE_PENDING')
  if (!ctx.steps.some(row => row.step === 'fence-intent-requested')) {
    await appendStep(ctx, 'intent', 'fence-intent-requested', { drainTimeoutMs: ctx.limits.drainTimeoutMs, pollMs: ctx.limits.pollMs })
  }
  const started = Date.now()
  let fence
  try {
    fence = await beginMigrationExclusive(operation.home, {
      operationId: operation.operationId,
      drainTimeoutMs: ctx.limits.drainTimeoutMs,
      pollMs: ctx.limits.pollMs,
      signal: ctx.signal,
      onShared: () => { ctx.observedHolders += 1 },
    })
  } catch (error) { await fenceFailure(ctx, 'intent', error) }
  ctx.fence = fence
  await ctx.boundary({ point: 'fence-acquired', step: 'exclusive-acquired', index: null })
  const state = await readMigrationFence(operation.home)
  const exclusiveDigest = await readFile(join(operation.home, 'fence', 'exclusive.json')).then(bytes => sha(bytes), () => null)
  const identity = await ownIdentity()
  if (!ctx.steps.some(row => row.step === 'fence-intent-persisted') && canAppend(ctx, 'intent')) {
    await appendStep(ctx, 'intent', 'fence-intent-persisted', { intentOperationId: state.intent?.operationId ?? null, ownerPid: state.intent?.pid ?? null, ownerStartTicks: state.intent?.startTicks ?? null })
  }
  if (canAppend(ctx, 'drain') && !ctx.steps.some(row => row.step === 'exclusive-acquired')) {
    await appendStep(ctx, 'drain', 'drain-started', { drainTimeoutMs: ctx.limits.drainTimeoutMs, delegated: true })
    await appendStep(ctx, 'drain', 'drain-completed', { liveShared: state.liveShared.length, observedHolders: ctx.observedHolders, elapsedMs: Date.now() - started, intentOperationId: state.intent?.operationId ?? null })
    await appendStep(ctx, 'drain', 'exclusive-acquired', { ownerPid: identity.pid, ownerStartTicks: identity.startTicks ?? null, exclusiveDigest, operationId: operation.operationId })
  }
  const remoteClients = operation.remoteClients ?? []
  if (remoteClients.length && !ctx.steps.some(row => row.step === 'remote-revoke-completed')) {
    if (!ctx.steps.some(row => row.step === 'remote-revoke-requested')) {
      await appendStep(ctx, 'drain', 'remote-revoke-requested', { remoteClients: remoteClients.length, remoteClientsDigest: operation.remoteClientsDigest })
    }
    try {
      const quarantine = typeof ctx.options.remoteClientQuarantine === 'function' ? ctx.options.remoteClientQuarantine : quarantineMigrationRemoteClients
      const result = await quarantine({ Database: ctx.options.Database, cli: ctx.options.remoteClientCli, runtime: ctx.options.remoteClientRuntime, clients: remoteClients, execute: ctx.options.remoteClientExecute, signal: ctx.signal })
      if (result?.declaredCredentialAdmissionBlocked !== true || result?.persistentDeclaredExclusion !== true || !Array.isArray(result.clients) || result.clients.length !== remoteClients.length || result.clients.some((client, index) => client.revoked !== true || client.machineId !== remoteClients[index].machineId || client.clientId !== remoteClients[index].clientId)) {
        fail('MIGRATION_REMOTE_CLIENT_REVOKE_INVALID')
      }
      await appendStep(ctx, 'drain', 'remote-revoke-completed', { remoteClients: result.clients.length, remoteClientsDigest: operation.remoteClientsDigest, declaredCredentialAdmissionBlocked: true, stopWriteProvable: false })
    } catch (error) {
      const code = error?.code ?? 'MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED'
      if (!code.startsWith('MIGRATION_REMOTE_CLIENT_')) throw error
      await block(ctx, 'drain', 'blocked-drain', code, { remoteClients: remoteClients.length })
      throw error
    }
  }
  if (remoteClients.length && !ctx.steps.some(row => row.step === 'remote-operation-drain-completed')) {
    if (!ctx.steps.some(row => row.step === 'remote-operation-drain-requested')) {
      await appendStep(ctx, 'drain', 'remote-operation-drain-requested', { remoteClients: remoteClients.length, remoteClientsDigest: operation.remoteClientsDigest })
    }
    try {
      const drain = typeof ctx.options.remoteOperationDrain === 'function' ? ctx.options.remoteOperationDrain : assertMigrationRemoteOperationsSettled
      const result = await drain({ Database: ctx.options.Database, clients: remoteClients, signal: ctx.signal })
      if (result?.declaredOperationsSettled !== true || !Array.isArray(result.clients) || result.clients.length !== remoteClients.length || result.clients.some((client, index) => client.settled !== true || client.machineId !== remoteClients[index].machineId || client.clientId !== remoteClients[index].clientId)) {
        fail('MIGRATION_REMOTE_OPERATION_DRAIN_INVALID')
      }
      await appendStep(ctx, 'drain', 'remote-operation-drain-completed', { remoteClients: result.clients.length, remoteOperations: result.clients.reduce((sum, client) => sum + client.operations, 0), declaredOperationsSettled: true, stopWriteProvable: false })
    } catch (error) {
      const code = error?.code ?? 'MIGRATION_REMOTE_OPERATION_UNRESOLVED'
      if (!code.startsWith('MIGRATION_REMOTE_OPERATION_')) throw error
      await block(ctx, 'drain', 'blocked-drain', code, { remoteClients: remoteClients.length })
      throw error
    }
  }
}

async function recheckCapture (ctx) {
  const recorded = ctx.steps.find(row => row.step === 'capture-verified')
  if (!recorded) return { ok: false, reason: 'capture-missing' }
  requireInputs(ctx, ['dataArchiveRoot', 'ledgerArchiveRoot', 'Database'])
  try {
    const data = await verifyMigrationDataArchive({ privateOutput: ctx.options.dataArchiveRoot, signal: ctx.signal })
    const ledger = await verifyMigrationLedgerArchive({ Database: ctx.options.Database, privateOutput: ctx.options.ledgerArchiveRoot, signal: ctx.signal })
    const manifest = await hashPrivateMigrationFile(ctx.options.dataArchiveRoot, 'capture.private.json', MAX_CAPTURE_MANIFEST)
    const archive = await hashPrivateMigrationFile(ctx.options.ledgerArchiveRoot, 'archive.private.json', MAX_LEDGER_MANIFEST)
    if (data.status !== 'complete' || ledger.status !== 'complete') return { ok: false, reason: 'capture-incomplete' }
    if (manifest.sha256 !== recorded.evidence.captureManifestSha256 || archive.sha256 !== recorded.evidence.ledgerManifestSha256) return { ok: false, reason: 'capture-digest-mismatch' }
    return { ok: true, data, ledger }
  } catch (error) {
    return { ok: false, reason: error?.code ?? 'capture-unverifiable' }
  }
}

const CAPTURE_CODES = /^(MIGRATION_CAPTURE_|MIGRATION_LEDGER_|MIGRATION_PRIVATE_|MIGRATION_INVENTORY_|MIGRATION_SCAN_|MIGRATION_SOURCE_|MIGRATION_LINK_|MIGRATION_SPECIAL_)/

async function capturePhase (ctx) {
  const operation = ctx.operation
  if ((operation.remoteClients ?? []).length && (!ctx.steps.some(row => row.step === 'remote-revoke-completed') || !ctx.steps.some(row => row.step === 'remote-operation-drain-completed'))) return fencePhase(ctx)
  await acquireFence(ctx, 'capture')
  await assertOwnerAndFence(ctx)
  await observeGate(ctx, 'capture')
  requireInputs(ctx, ['inventory', 'configurationPlan', 'dataArchiveRoot', 'ledgerArchiveRoot', 'Database', 'ledgerDatabase'])
  const plan = ctx.options.configurationPlan
  if (!record(plan) || plan.status !== 'ready') fail('MIGRATION_ORCH_INPUT_INVALID')
  if (sha(encode(plan)) !== operation.profilePlanDigest) fail('MIGRATION_ORCH_OPERATION_MISMATCH', { field: 'configurationPlan' })
  const dataRootDigest = sha(Buffer.from(resolve(ctx.options.dataArchiveRoot)))
  const ledgerRootDigest = sha(Buffer.from(resolve(ctx.options.ledgerArchiveRoot)))
  let evidence
  if (!ctx.steps.some(row => row.step === 'capture-started')) {
    await appendStep(ctx, 'capture', 'capture-started', { dataRootDigest, ledgerRootDigest })
  }
  try {
    await createMigrationDataArchive({ inventory: ctx.options.inventory, configurationPlan: plan, privateOutput: ctx.options.dataArchiveRoot, signal: ctx.signal })
    await assertFenceHeld(ctx)
    await createMigrationLedgerArchive({ Database: ctx.options.Database, database: ctx.options.ledgerDatabase, privateOutput: ctx.options.ledgerArchiveRoot, signal: ctx.signal })
    await assertFenceHeld(ctx)
    const data = await verifyMigrationDataArchive({ privateOutput: ctx.options.dataArchiveRoot, signal: ctx.signal })
    const ledger = await verifyMigrationLedgerArchive({ Database: ctx.options.Database, privateOutput: ctx.options.ledgerArchiveRoot, signal: ctx.signal })
    const manifest = await hashPrivateMigrationFile(ctx.options.dataArchiveRoot, 'capture.private.json', MAX_CAPTURE_MANIFEST)
    const archive = await hashPrivateMigrationFile(ctx.options.ledgerArchiveRoot, 'archive.private.json', MAX_LEDGER_MANIFEST)
    const archiveBytes = await readFile(join(await realpath(ctx.options.ledgerArchiveRoot), 'archive.private.json'))
    let contentDigest = null
    try { contentDigest = JSON.parse(archiveBytes.toString('utf8'))?.contentDigest ?? null } catch { contentDigest = null }
    evidence = {
      captureManifestSha256: manifest.sha256,
      captureSources: data.sources,
      captureFiles: data.files,
      ledgerManifestSha256: archive.sha256,
      ledgerContentDigest: typeof contentDigest === 'string' ? contentDigest : 'none',
      dataRootDigest,
      ledgerRootDigest,
    }
  } catch (error) {
    // Only a captured-archive failure is a capture verdict; anything else (a
    // diagnostic hook, a programming error) must never be recorded as one.
    const code = error?.code
    if (typeof code !== 'string' || (!CAPTURE_CODES.test(code) && code !== 'EEXIST')) throw error
    await block(ctx, 'capture', 'blocked-capture', code, {})
    throw error
  }
  await appendStep(ctx, 'capture', 'capture-verified', evidence)
}

const COMMIT_CODES = /^MIGRATION_COMMIT_/

async function maintenancePhase (ctx) {
  const operation = ctx.operation
  await acquireFence(ctx, 'maintenance')
  await assertOwnerAndFence(ctx)
  const capture = await recheckCapture(ctx)
  if (!capture.ok) {
    await block(ctx, 'capture', 'blocked-capture', capture.reason, {})
    fail('MIGRATION_ORCH_CAPTURE_MISMATCH', { reason: capture.reason })
  }
  await observeGate(ctx, 'maintenance')
  requireInputs(ctx, ['commitOutput', 'commitChanges'])
  if (!ctx.steps.some(row => row.step === 'maintenance-started')) {
    await appendStep(ctx, 'maintenance', 'maintenance-started', { planDigest: operation.profilePlanDigest })
  }
  const onStep = async (step, index, phase) => {
    await assertFenceHeld(ctx)
    await ctx.onCommitStep(step, index, phase)
  }
  try {
    // N1: the configuration transaction is only ever entered while the exclusive verifies.
    await assertFenceHeld(ctx)
    let prepared = true
    try { await inspectMigrationConfigurationCommit({ privateOutput: ctx.options.commitOutput }) }
    catch (error) { if (error?.code !== 'ENOENT') throw error; prepared = false }
    if (!prepared) {
      const gate = readMigrationStartupGate({ home: operation.home })
      if (gate && !['committed', 'rolled-back'].includes(gate.phase)) fail('MIGRATION_ORCH_GATE_PENDING')
      await prepareMigrationConfigurationCommit({ home: operation.home, privateOutput: ctx.options.commitOutput, changes: ctx.options.commitChanges, operationId: operation.operationId, onStep })
    }
    await assertFenceHeld(ctx)
    await resumeMigrationConfigurationCommit({ privateOutput: ctx.options.commitOutput, phase: 'maintenance', recover: true, onStep })
  } catch (error) {
    const code = error?.code ?? 'MIGRATION_COMMIT_FAILED'
    if (code === 'MIGRATION_ORCH_GATE_PENDING') throw error
    if (!COMMIT_CODES.test(code)) throw error
    await block(ctx, 'maintenance', 'blocked-maintenance', code, {})
    throw error
  }
  const gate = await observeGate(ctx, 'maintenance')
  const inspect = await inspectMigrationConfigurationCommit({ privateOutput: ctx.options.commitOutput })
  await appendStep(ctx, 'maintenance', 'maintenance-installed', {
    gatePhase: gate?.phase ?? 'none',
    gateOperationId: gate?.operationId ?? 'none',
    gateJournalEvents: gate?.journalEvents ?? 0,
    gateJournalHead: gate?.journalHead ?? 'none',
    recognized: inspect.recognized === true,
  })
}

function evaluateActivation (verifier) {
  const list = ACTIVATION_CRITERIA.map(({ id, ok }) => ({ id, ok }))
  const denied = list.find(entry => !entry.ok)?.id ?? null
  let verifierAllowed = false
  let verifierCode = null
  try {
    const result = verifier()
    verifierAllowed = result?.allowed === true
    verifierCode = typeof result?.code === 'string' ? result.code : null
  } catch (error) { verifierCode = error?.code ?? 'MIGRATION_ORCH_VERIFIER_FAILED' }
  // Every criterion false means activation can never be allowed, whatever an
  // injected verifier answers: the verifier is a second gate, never an override.
  return { criteria: list, allOk: list.every(entry => entry.ok === true), deniedBy: denied, verifierAllowed, verifierCode }
}

async function activatePhase (ctx) {
  await acquireFence(ctx, 'activate')
  await assertOwnerAndFence(ctx)
  const gate = await observeGate(ctx, 'activate')
  const evaluation = evaluateActivation(ctx.verifier)
  if (!ctx.steps.some(row => row.step === 'activation-evaluated')) {
    await appendStep(ctx, 'activate', 'activation-evaluated', {
      criteria: evaluation.criteria.map(entry => entry.ok ? '1' : '0').join(''),
      deniedBy: evaluation.deniedBy ?? 'none',
      verifierAllowed: evaluation.verifierAllowed,
      verifierCode: evaluation.verifierCode ?? 'none',
      gatePhase: gate?.phase ?? 'none',
      activationSupported: false,
    })
  }
  // The gate is never written here: there is no path from activate to committed.
  if (evaluation.allOk && evaluation.verifierAllowed) fail('MIGRATION_ORCH_ACTIVATION_UNSUPPORTED')
  if (!ctx.steps.some(row => row.step === 'activation-refused')) {
    await appendStep(ctx, 'activate', 'activation-refused', { reason: 'MIGRATION_ORCH_ACTIVATION_UNSUPPORTED', deniedBy: evaluation.deniedBy ?? 'none', gatePhase: gate?.phase ?? 'none' })
  }
}

async function releasePreconditions (ctx) {
  const steps = ctx.steps
  const drained = steps.some(row => row.step === 'drain-completed')
  const capture = await recheckCapture(ctx)
  const gate = await observeGate(ctx, 'release')
  let commit = false
  let commitReason = 'commit-missing'
  if (gate?.phase === 'committed') commitReason = 'gate-committed-post-activation-rollback-unsupported'
  else if (gate?.phase !== 'rolled-back') commitReason = 'gate-not-rolled-back'
  else {
    try {
      requireInputs(ctx, ['commitOutput'])
      const inspect = await inspectMigrationConfigurationCommit({ privateOutput: ctx.options.commitOutput })
      commit = inspect.recognized === true
      commitReason = commit ? 'recognized' : 'original-bytes-not-recognized'
    } catch (error) { commitReason = error?.code ?? 'commit-unreadable' }
  }
  // A real activation would satisfy the third precondition instead; in this
  // slice every criterion is false, so it never can.
  if (!commit && evaluateActivation(DEFAULT_VERIFIER).allOk) commit = true
  let owner = false
  try { await acquireFence(ctx, 'release'); await assertOwnerAndFence(ctx); owner = true }
  catch (error) {
    if (error?.code === 'MIGRATION_ORCH_OWNER_UNCERTAIN') throw error
    if (error?.code !== 'MIGRATION_ORCH_FENCE_NOT_HELD') throw error
  }
  const writers = await writerObservation(ctx)
  const flags = [drained, capture.ok, commit, owner].map(value => value ? '1' : '0').join('')
  const failed = [
    drained ? null : 'drain',
    capture.ok ? null : 'capture:' + capture.reason,
    commit ? null : 'commit:' + commitReason,
    owner ? null : 'owner',
  ].filter(Boolean).join(',')
  return { ok: drained && capture.ok && commit && owner, flags, failed, writers }
}

async function releasePhase (ctx) {
  const operation = ctx.operation
  const requested = ctx.steps.some(row => row.step === 'release-requested')
  if (requested) {
    const state = await observeWorld(operation)
    if (!state.exclusive && !state.intent) {
      if (!ctx.steps.some(row => row.step === 'released')) await appendStep(ctx, 'release', 'released', { observed: true, exclusiveGone: true, intentGone: true })
      return
    }
    if (!state.exclusive && state.intent) {
      await block(ctx, 'release', 'blocked-release', 'intent-without-exclusive', {})
      fail('MIGRATION_ORCH_RELEASE_BLOCKED', { failed: 'intent-without-exclusive' })
    }
    await acquireFence(ctx, 'release')
    await assertOwnerAndFence(ctx)
    await ctx.fence.release()
    await ctx.boundary({ point: 'release-done', step: 'released', index: null })
    const after = await observeWorld(operation)
    if (!ctx.steps.some(row => row.step === 'released')) await appendStep(ctx, 'release', 'released', { exclusiveGone: after.exclusive === false, intentGone: after.intent === false })
    return
  }
  const checked = await releasePreconditions(ctx)
  if (!checked.ok) {
    await block(ctx, 'release', 'blocked-release', 'preconditions-unmet', { preconditions: checked.flags, failed: checked.failed, writerEnumeration: checked.writers.mode, writerHolders: checked.writers.holders })
    fail('MIGRATION_ORCH_RELEASE_BLOCKED', { preconditions: checked.flags, failed: checked.failed, standing: ctx.steps.at(-1)?.step ?? null })
  }
  await appendStep(ctx, 'release', 'release-requested', {
    preconditions: checked.flags,
    writerEnumeration: checked.writers.mode,
    writerHolders: checked.writers.holders,
    activationSupported: false,
  })
  await assertOwnerAndFence(ctx)
  await ctx.fence.release()
  await ctx.boundary({ point: 'release-done', step: 'released', index: null })
  const after = await observeWorld(operation)
  await appendStep(ctx, 'release', 'released', { exclusiveGone: after.exclusive === false, intentGone: after.intent === false })
}

async function ensureFence (ctx) {
  if (ctx.fence && await ctx.fence.verify()) return ctx.fence
  ctx.fence = null
  ctx.fence = await beginMigrationExclusive(ctx.operation.home, { operationId: ctx.operation.operationId, drainTimeoutMs: ctx.limits.drainTimeoutMs, pollMs: ctx.limits.pollMs, signal: ctx.signal, onShared: () => { ctx.observedHolders += 1 } })
  await ctx.boundary({ point: 'fence-acquired', step: 'exclusive-acquired', index: null })
  return ctx.fence
}

const ACTIONS = { inspect: inspectPhase, fence: fencePhase, capture: capturePhase, maintenance: maintenancePhase, activate: activatePhase, release: releasePhase }

async function advance (ctx) {
  for (let turn = 0; turn <= 64; turn++) {
    if (ctx.signal?.aborted) {
      const world = await observeWorld(ctx.operation).catch(() => null)
      await cancel(ctx, ctx.steps.some(row => FENCE_STEPS.has(row.step)) || Boolean(world?.maintenanceActive))
      fail('MIGRATION_ORCH_CANCELLED')
    }
    const state = deriveState(ctx.steps)
    const action = nextAction(state)
    if (!action) return
    await ACTIONS[action](ctx)
    // A refused activation is the deliberate end of the forward path: release
    // needs the configuration terminal state first, so it is never attempted in
    // the same run that produced the refusal.
    if (ctx.steps.at(-1)?.step === 'activation-refused') return
  }
  fail('MIGRATION_ORCH_STATE_INVALID')
}

async function readOperationForResume (options) {
  const root = await canonicalDirectory(options.privateOutput)
  const read = await readOperation(root)
  const steps = await loadChain(root, read.operation, read.digest)
  return { root, operation: read.operation, digest: read.digest, steps }
}

function checkOperationId (options) {
  const operationId = options.operationId ?? randomUUID()
  if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) fail('MIGRATION_ORCH_OPERATION_ID_UNSUPPORTED')
  return operationId
}

async function createOperation (options) {
  const home = await canonicalDirectory(options.home)
  const root = await canonicalNewPath(options.privateOutput)
  if (inside(home, root) || inside(root, home)) fail('MIGRATION_ORCH_INPUT_INVALID')
  const domains = validateDomains(options.domains), remoteClients = validateRemoteClients(options.remoteClients ?? [])
  const configurationPlan = options.profilePlan ?? options.configurationPlan
  if (!record(configurationPlan) || configurationPlan.status !== 'ready') fail('MIGRATION_ORCH_INPUT_INVALID')
  for (const domain of domains) for (const path of domain.roots) if (inside(root, path) || inside(path, root)) fail('MIGRATION_ORCH_INPUT_INVALID')
  const operation = {
    schemaVersion: 1,
    kind: OPERATION_KIND,
    operationId: checkOperationId(options),
    home,
    privateOutput: root,
    domains,
    domainsDigest: sha(encode(domains)),
    remoteClients,
    remoteClientsDigest: sha(encode(remoteClients)),
    profilePlanDigest: sha(encode(configurationPlan)),
    profilePlanStatus: 'ready',
    limits: validateLimits(options.limits ?? {}),
    createdAt: Date.now(),
    host: hostname(),
    activationSupported: false,
    postActivationRollbackSupported: false,
  }
  const bytes = encode(operation)
  if (bytes.length > MAX_OPERATION_BYTES) fail('MIGRATION_ORCH_INPUT_INVALID')
  return { root, operation, bytes }
}

function context (options, root, operation, operationDigest, steps) {
  return {
    root,
    operation,
    operationDigest,
    steps,
    limits: { drainTimeoutMs: operation.limits.drainTimeoutMs, pollMs: operation.limits.pollMs },
    signal: options.signal,
    options,
    verifier: typeof options.verifier === 'function' ? options.verifier : DEFAULT_VERIFIER,
    onCommitStep: typeof options.onCommitStep === 'function' ? options.onCommitStep : async () => {},
    boundary: typeof options.onBoundary === 'function' ? options.onBoundary : async () => {},
    observedHolders: 0,
    fence: null,
  }
}

async function ensureOperation (options) {
  const created = await createOperation(options)
  const existing = await lstat(join(created.root, OPERATION_FILE)).then(() => true, error => { if (error?.code === 'ENOENT') return false; throw error })
  if (!existing) {
    await createPrivateMigrationDirectory(created.root).catch(error => { if (error?.code !== 'MIGRATION_PRIVATE_ACL_FAILED') throw error; fail('MIGRATION_ORCH_INPUT_INVALID') })
    await writePrivateMigrationFile(created.root, OPERATION_FILE, created.bytes)
    const ctx = context(options, created.root, created.operation, sha(created.bytes), [])
    await ctx.boundary({ point: 'operation-written', step: 'operation-recorded', index: null })
    return ctx
  }
  const read = await readOperation(created.root)
  for (const key of ['operationId', 'home', 'domainsDigest', 'profilePlanDigest', 'profilePlanStatus']) {
    if (read.operation[key] !== created.operation[key]) fail('MIGRATION_ORCH_OPERATION_MISMATCH', { field: key })
  }
  for (const key of Object.keys(created.operation.limits)) {
    if (read.operation.limits[key] !== created.operation.limits[key]) fail('MIGRATION_ORCH_OPERATION_MISMATCH', { field: 'limits.' + key })
  }
  if ((read.operation.remoteClientsDigest !== undefined || created.operation.remoteClients.length > 0) && read.operation.remoteClientsDigest !== created.operation.remoteClientsDigest) fail('MIGRATION_ORCH_OPERATION_MISMATCH', { field: 'remoteClientsDigest' })
  const steps = await loadChain(created.root, read.operation, read.digest)
  return context(options, created.root, read.operation, read.digest, steps)
}

/**
 * Recoverable private commit orchestration (stop-fence slice 5). Runs
 * inspect -> intent -> drain -> capture -> maintenance -> activate -> release as
 * one journal-driven state machine. The immutable hash chain is the decision
 * authority; the fence records are action handles only. Activation stays
 * unsupported: the activate phase records its refusal and never writes the gate.
 * Not wired to any product entry point. See
 * docs/integration/plan/20261031_migration_commit_orchestration.md.
 */
export async function beginMigrationCommitOperation (options = {}) {
  const ctx = await ensureOperation(options)
  await advance(ctx)
  return describe(ctx)
}

/** Resume from any journal position: derive the state first, then observe the world. */
export async function resumeMigrationCommitOperation (options = {}) {
  const resumed = await readOperationForResume(options)
  if (options.home !== undefined) {
    const home = await canonicalDirectory(options.home)
    if (home !== resumed.operation.home) fail('MIGRATION_ORCH_OPERATION_MISMATCH', { field: 'home' })
  }
  if (options.operationId !== undefined && options.operationId !== resumed.operation.operationId) fail('MIGRATION_ORCH_OPERATION_MISMATCH', { field: 'operationId' })
  const ctx = context({ ...options, home: resumed.operation.home }, resumed.root, resumed.operation, resumed.digest, resumed.steps)
  await advance(ctx)
  return describe(ctx)
}

export async function inspectMigrationCommitOperation (options = {}) {
  let read
  try { read = await readOperationForResume(options) }
  catch (error) {
    return Object.freeze({
      schemaVersion: 1, kind: 'migration-commit-operation-inspection', valid: false, code: error?.code ?? 'MIGRATION_ORCH_OPERATION_INVALID',
      status: 'blocked-inspect', released: false, cancelled: false, blocked: true, terminal: true,
      activationSupported: ACTIVATION_SUPPORTED, postActivationRollbackSupported: POST_ACTIVATION_ROLLBACK_SUPPORTED, stopWriteProvable: false,
    })
  }
  const state = deriveState(read.steps)
  const world = await observeWorld(read.operation).catch(error => Object.freeze({ error: error?.code ?? 'MIGRATION_ORCH_WORLD_UNREADABLE' }))
  return Object.freeze({
    schemaVersion: 1,
    kind: 'migration-commit-operation-inspection',
    valid: true,
    operationId: read.operation.operationId,
    home: read.operation.home,
    privateOutput: read.operation.privateOutput,
    operationDigest: read.digest,
    journal: Object.freeze(read.steps.map(row => Object.freeze({ index: row.index, phase: row.phase, step: row.step, evidence: Object.freeze({ ...row.evidence }) }))),
    summary: summarizeState(read.operation, read.steps, state),
    next: nextAction(state),
    world,
  })
}

export function summarizeMigrationCommitOperation (input) {
  if (record(input) && record(input.operation) && Array.isArray(input.steps)) {
    if (!OPERATION_ID.test(input.operation.operationId ?? '')) fail('MIGRATION_ORCH_INPUT_INVALID')
    return summarizeState(input.operation, input.steps, deriveState(input.steps))
  }
  fail('MIGRATION_ORCH_INPUT_INVALID')
}

/** PRIVATE: the verified operation record, including the declared data roots. */
export async function readOperationRecord ({ privateOutput } = {}) {
  const root = await canonicalDirectory(privateOutput)
  const read = await readOperation(root)
  return Object.freeze({ ...read.operation, operationDigest: read.digest, activationSupported: ACTIVATION_SUPPORTED, postActivationRollbackSupported: POST_ACTIVATION_ROLLBACK_SUPPORTED })
}
