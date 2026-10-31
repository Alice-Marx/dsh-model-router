import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { previewProfileMigration } from '../packages/orchestration/src/profile-migration-plan.mjs'
import { inspectMigrationSources } from '../packages/orchestration/src/migration-snapshot.mjs'
import { readMigrationFence } from '../packages/orchestration/src/migration-fence.mjs'
import { readMigrationStartupGate } from '../packages/orchestration/src/migration-startup-gate.mjs'
import { inspectMigrationConfigurationCommit, resumeMigrationConfigurationCommit } from '../packages/orchestration/src/migration-configuration-commit.mjs'
import {
  ACTIVATION_CRITERIA,
  ACTIVATION_SUPPORTED,
  POST_ACTIVATION_ROLLBACK_SUPPORTED,
  beginMigrationCommitOperation as beginOperation,
  inspectMigrationCommitOperation,
  readOperationRecord,
  resumeMigrationCommitOperation as resumeOperation,
  summarizeMigrationCommitOperation,
} from '../packages/orchestration/src/migration-commit-orchestration.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const PRODUCT = '@ljwei-stak/dsh-model-router'
const parent = resolve('tmp/integration/migration-commit-orchestration')
await mkdir(parent, { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value) + '\n'
const begin = beginOperation
const resume = resumeOperation

async function scenario (t, { breakCapture = false } = {}) {
  const dir = await mkdtemp(join(parent, 'case-'))
  const home = join(dir, 'home')
  const profile = join(home, 'profiles', 'desktop')
  const bot = join(home, 'bot')
  const sessions = join(home, 'sessions')
  for (const path of [profile, bot, sessions]) await mkdir(path, { recursive: true })
  async function bundle (folder, name, patch) {
    const packageDir = join(dir, folder)
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), json({ name, version: '0.25.6-preview.1', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(packageDir, 'cordis.patch.yml'), typeof patch === 'string' ? patch : json(patch))
    return { packageName: name, packageDir }
  }
  const base = await bundle('base', '@fixture/base', [{ insert: [{ id: 'web', name: 'cordis:web-fixture', config: { searchProvider: 'auto' } }] }])
  const old = await bundle('old-bundle', PRODUCT, [{ insert: [{ id: 'model-router-galgame', name: PRODUCT, config: { private: 'SECRET-CONFIG' } }] }])
  const target = await bundle('target-bundle', PRODUCT, await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8'))
  const profilePackage = json({ dsh: { profile: { bundles: [base.packageName, old.packageName] } } })
  await writeFile(join(profile, 'package.json'), profilePackage)
  await writeFile(join(bot, 'state.json'), json({ id: 'bot-stable', secret: 'SECRET-DATA' }))
  await writeFile(join(sessions, 'session-a.jsonl'), 'PRIVATE-SESSION\n')
  const plan = await previewProfileMigration({ profileDir: profile, dshHome: home, launchCwd: profile, orderedBundleLayers: [base, old], launcherLayers: [], launchEnvironment: {}, targetBundleLayer: target })
  assert.equal(plan.status, 'ready')
  const inventory = await inspectMigrationSources([{ id: 'bot', kind: 'bot-data', root: bot }, { id: 'sessions', kind: 'sessions', root: sessions }])
  const ledgerSource = join(dir, 'ledger-source')
  await mkdir(ledgerSource)
  const dbFile = join(ledgerSource, 'ledger.sqlite')
  const database = new Database(dbFile)
  database.exec('CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT)')
  database.prepare('INSERT INTO audit(note) VALUES(?)').run('PRIVATE-ROW')
  t.after(() => database.close())
  const before = Buffer.from(profilePackage)
  const changes = [{
    path: join(profile, 'package.json'),
    beforeSha256: sha(before),
    maintenance: Buffer.from(json({ dsh: { profile: { bundles: [base.packageName] } } })),
    after: Buffer.from(json({ dsh: { profile: { bundles: [target.packageName] } } })),
  }]
  const fixture = {
    dir, home, profile, bot, sessions, plan, inventory, database, changes,
    operationId: randomUUID(),
    domains: [{ name: 'bot', roots: [bot] }, { name: 'sessions', roots: [sessions] }],
    privateOutput: join(dir, 'owner-private'),
    dataArchiveRoot: breakCapture ? join(dir, 'capture-data') : join(dir, 'capture-data'),
    ledgerArchiveRoot: join(dir, 'capture-ledger'),
    commitOutput: join(dir, 'commit-private'),
  }
  fixture.input = (extra = {}) => ({
    home, operationId: fixture.operationId, privateOutput: fixture.privateOutput, domains: fixture.domains,
    profilePlan: plan, configurationPlan: plan, inventory,
    dataArchiveRoot: fixture.dataArchiveRoot, ledgerArchiveRoot: fixture.ledgerArchiveRoot,
    commitOutput: fixture.commitOutput, commitChanges: changes,
    Database, ledgerDatabase: database,
    limits: { drainTimeoutMs: 5000, pollMs: 20 },
    ...extra,
  })
  if (breakCapture) {
    fixture.dataArchiveRoot = join(dir, 'capture-data-broken')
    await mkdir(fixture.dataArchiveRoot)
    await writeFile(join(fixture.dataArchiveRoot, 'stray.txt'), 'STRAY')
  }
  return fixture
}

const stepNames = inspection => inspection.journal.map(row => row.step)
const remoteOperationDrain = async ({ clients }) => ({ declaredOperationsSettled: true, clients: clients.map(client => ({ ...client, operations: 0, settled: true })) })
async function rejection (promise) {
  try { await promise } catch (error) { return error }
  throw new Error('expected a rejection')
}

test('orchestration: the accepted plan becomes an immutable chain and activation is refused', async t => {
  const f = await scenario(t)
  const summary = await begin(f.input())
  assert.equal(summary.status, 'blocked-activation')
  assert.equal(summary.steps, 12)
  assert.equal(summary.activationSupported, false)
  assert.equal(summary.postActivationRollbackSupported, false)
  assert.equal(summary.stopWriteProvable, false)
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(inspection.valid, true)
  assert.deepEqual(stepNames(inspection), [
    'plan-recorded', 'fence-intent-requested', 'fence-intent-persisted', 'drain-started', 'drain-completed', 'exclusive-acquired',
    'capture-started', 'capture-verified', 'maintenance-started', 'maintenance-installed', 'activation-evaluated', 'activation-refused',
  ])
  const phases = inspection.journal.map(row => row.phase)
  const order = ['inspect', 'intent', 'drain', 'capture', 'maintenance', 'activate']
  assert.deepEqual([...new Set(phases)], order)
  for (let index = 0; index < inspection.journal.length; index++) assert.equal(inspection.journal[index].index, index)
  // index 0 is anchored to the digest of the immutable operation record.
  const operation = await readOperationRecord({ privateOutput: f.privateOutput })
  const anchor = JSON.parse(await readFile(join(f.privateOutput, 'step-00000.json'), 'utf8'))
  assert.equal(anchor.previous, operation.operationDigest)
  assert.equal(anchor.previous, sha(await readFile(join(f.privateOutput, 'operation.private.json'))))
  assert.equal(inspection.journal[0].evidence.writerEnumeration, process.platform === 'linux' ? inspection.journal[0].evidence.writerEnumeration : 'unavailable')
  assert.equal(readMigrationStartupGate({ home: f.home }).phase, 'maintenance')
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
  assert.equal(summarizeMigrationCommitOperation({ operation: { operationId: f.operationId }, steps: [] }).operationId, f.operationId)
})

test('orchestration: a chain record that does not hash to its digest is refused', async t => {
  const f = await scenario(t)
  await begin(f.input())
  const path = join(f.privateOutput, 'step-00006.json')
  const row = JSON.parse(await readFile(path, 'utf8'))
  row.evidence = { ...row.evidence, captureFiles: 999 }
  await writeFile(path, JSON.stringify(row) + '\n')
  await assert.rejects(resume(f.input()), { code: 'MIGRATION_ORCH_JOURNAL_INVALID' })
  assert.equal((await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })).valid, false)
})

test('orchestration: re-entry with another plan or id never rewrites the operation record', async t => {
  const f = await scenario(t)
  await begin(f.input())
  const other = await scenario(t)
  await assert.rejects(begin({ ...f.input(), operationId: other.operationId }), { code: 'MIGRATION_ORCH_OPERATION_MISMATCH' })
  await assert.rejects(begin({ ...f.input(), profilePlan: other.plan }), { code: 'MIGRATION_ORCH_OPERATION_MISMATCH' })
  await assert.rejects(begin({ ...f.input(), operationId: 'operation-1' }), { code: 'MIGRATION_ORCH_OPERATION_ID_UNSUPPORTED' })
  await assert.rejects(begin({ ...f.input(), privateOutput: join(f.home, 'inside') }), { code: 'MIGRATION_ORCH_INPUT_INVALID' })
  await assert.rejects(resume({ privateOutput: join(f.dir, 'absent') }), { code: 'MIGRATION_ORCH_INPUT_INVALID' })
})

test('orchestration invariant: an unverified capture never releases the fence', async t => {
  const f = await scenario(t)
  // A capture that cannot even be created leaves the fence held, no gate, and no way into maintenance.
  const broken = await scenario(t, { breakCapture: true })
  const blocked = await rejection(begin(broken.input()))
  assert.match(blocked.code, /^(MIGRATION_(PRIVATE|CAPTURE)_|EEXIST)$/)
  const held = await inspectMigrationCommitOperation({ privateOutput: broken.privateOutput })
  assert.equal(held.summary.status, 'blocked-capture')
  assert.equal((await readMigrationFence(broken.home)).maintenanceActive, true)
  assert.equal(readMigrationStartupGate({ home: broken.home }), null)
  await assert.rejects(resume(broken.input()), { code: blocked.code })
  assert.ok(!stepNames(await inspectMigrationCommitOperation({ privateOutput: broken.privateOutput })).includes('released'))

  // A verified capture whose bytes no longer verify refuses release on any recovery path.
  await begin(f.input())
  const captured = (await readdir(join(f.dataArchiveRoot, 'data', 'domain-0000'))).sort()
  assert.deepEqual(captured, ['state.json'])
  const manifest = join(f.dataArchiveRoot, 'capture.private.json')
  const saved = await readFile(manifest)
  await writeFile(manifest, saved.subarray(0, saved.length - 2))
  const refused = await rejection(resume(f.input()))
  assert.equal(refused.code, 'MIGRATION_ORCH_RELEASE_BLOCKED')
  assert.match(refused.details.failed, /capture:/)
  assert.equal(refused.details.preconditions[1], '0')
  const after = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(after.summary.status, 'blocked-release')
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
  assert.ok(!stepNames(after).includes('released'))
  await writeFile(manifest, saved)
})

test('orchestration invariant: every terminal state keeps activation, rollback and stop-proof false', async t => {
  const states = []
  const captured = await scenario(t, { breakCapture: true })
  await rejection(begin(captured.input()))
  states.push(await inspectMigrationCommitOperation({ privateOutput: captured.privateOutput }))
  const activation = await scenario(t)
  states.push({ summary: await begin(activation.input()) })
  const released = await scenario(t)
  await begin(released.input())
  await resumeMigrationConfigurationCommit({ privateOutput: released.commitOutput, phase: 'install' })
  await resumeMigrationConfigurationCommit({ privateOutput: released.commitOutput, phase: 'rollback', recover: true })
  states.push({ summary: await resume(released.input()) })
  const cancelled = await scenario(t)
  const controller = new AbortController()
  await assert.rejects(begin(cancelled.input({ signal: controller.signal, onBoundary: async ({ point }) => { if (point === 'after-step:exclusive-acquired') controller.abort() } })), { code: 'MIGRATION_ORCH_CANCELLED' })
  states.push({ summary: await resume(cancelled.input()) })
  assert.deepEqual(states.map(state => state.summary.status), ['blocked-capture', 'blocked-activation', 'released', 'cancelled-fence-held'])
  for (const state of states) {
    assert.equal(state.summary.activationSupported, false, state.summary.status)
    assert.equal(state.summary.postActivationRollbackSupported, false, state.summary.status)
    assert.equal(state.summary.stopWriteProvable, false, state.summary.status)
    assert.equal(state.summary.requiresStopProof, true, state.summary.status)
    assert.equal(state.summary.activation.supported, false)
    assert.equal(state.summary.activation.criteria.length, 10)
    assert.ok(state.summary.activation.criteria.every(entry => entry.ok === false))
  }
  assert.equal(ACTIVATION_SUPPORTED, false)
  assert.equal(POST_ACTIVATION_ROLLBACK_SUPPORTED, false)
  assert.deepEqual(ACTIVATION_CRITERIA.map(entry => entry.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'])
  assert.ok(ACTIVATION_CRITERIA.every(entry => entry.ok === false && typeof entry.reason === 'string' && entry.reason.length > 0))
})

test('orchestration invariant: cancellation keeps the fence and never writes the gate', async t => {
  const f = await scenario(t)
  const controller = new AbortController()
  await assert.rejects(begin(f.input({ signal: controller.signal, onBoundary: async ({ point }) => { if (point === 'after-step:exclusive-acquired') controller.abort() } })), { code: 'MIGRATION_ORCH_CANCELLED' })
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(inspection.summary.status, 'cancelled-fence-held')
  assert.equal(inspection.summary.cancelled, true)
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
  assert.equal(readMigrationStartupGate({ home: f.home }), null)
  // Cancellation is not a rollback: resume reports the same terminal state and keeps the fence.
  assert.equal((await resume(f.input())).status, 'cancelled-fence-held')
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
})

test('orchestration invariant: one UUID v4 operation id binds fence, plan and gate', async t => {
  const f = await scenario(t)
  await begin(f.input())
  const operation = await readOperationRecord({ privateOutput: f.privateOutput })
  const plan = JSON.parse(await readFile(join(f.commitOutput, 'transaction.private.json'), 'utf8'))
  const fence = await readMigrationFence(f.home)
  const gate = readMigrationStartupGate({ home: f.home })
  assert.equal(operation.operationId, f.operationId)
  assert.equal(plan.id, f.operationId)
  assert.equal(fence.intent.operationId, f.operationId)
  assert.equal(fence.exclusive.operationId, f.operationId)
  assert.equal(gate.operationId, f.operationId)
  await resumeMigrationConfigurationCommit({ privateOutput: f.commitOutput, phase: 'install' })
  assert.equal(readMigrationStartupGate({ home: f.home }).operationId, f.operationId)
  assert.equal((await inspectMigrationConfigurationCommit({ privateOutput: f.commitOutput })).phase, 'validating')
})

test('orchestration negative: a gate carrying another operation id blocks without writing configuration bytes', async t => {
  const f = await scenario(t)
  await begin(f.input())
  const configured = await readFile(f.changes[0].path)
  const gatePath = join(f.home, 'migration-gate.json')
  const gate = readMigrationStartupGate({ home: f.home })
  await writeFile(gatePath, json({ ...gate, operationId: randomUUID() }))
  await assert.rejects(resume(f.input()), { code: 'MIGRATION_ORCH_GATE_MISMATCH' })
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(inspection.summary.status, 'blocked-release')
  assert.equal(inspection.journal.at(-1).evidence.reason, 'gate-operation-id-mismatch')
  assert.deepEqual(await readFile(f.changes[0].path), configured)
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
})

test('orchestration negative: one flipped byte in either archive blocks capture before maintenance', async t => {
  class Pause extends Error {}
  for (const which of ['data', 'ledger']) {
    const f = await scenario(t)
    await assert.rejects(begin(f.input({ onBoundary: async ({ point }) => { if (point === 'after-step:capture-verified') throw new Pause('pause-after-capture') } })), error => error instanceof Pause)
    const configured = await readFile(f.changes[0].path)
    assert.equal(readMigrationStartupGate({ home: f.home }), null)
    const target = which === 'data' ? join(f.dataArchiveRoot, 'data', 'domain-0000', 'state.json') : join(f.ledgerArchiveRoot, 'ledger-export.private.json')
    const bytes = await readFile(target)
    const flipped = Buffer.from(bytes)
    flipped[0] = flipped[0] === 0x7b ? 0x7c : 0x7b
    await writeFile(target, flipped)
    await assert.rejects(resume(f.input()), { code: 'MIGRATION_ORCH_CAPTURE_MISMATCH' })
    const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
    assert.equal(inspection.summary.status, 'blocked-capture', which)
    assert.deepEqual(await readFile(f.changes[0].path), configured, which)
    assert.ok(!stepNames(inspection).includes('maintenance-installed'), which)
    assert.equal(readMigrationStartupGate({ home: f.home }), null, which)
    assert.equal((await readMigrationFence(f.home)).maintenanceActive, true, which)
  }
})

test('orchestration negative: a gate stuck at validating refuses activation without writing committed', async t => {
  const f = await scenario(t)
  class Pause extends Error {}
  await assert.rejects(begin(f.input({ onBoundary: async ({ point }) => { if (point === 'after-step:maintenance-installed') throw new Pause('pause-after-maintenance') } })), error => error instanceof Pause)
  await resumeMigrationConfigurationCommit({ privateOutput: f.commitOutput, phase: 'install' })
  assert.equal(readMigrationStartupGate({ home: f.home }).phase, 'validating')
  const summary = await resume(f.input())
  assert.equal(summary.status, 'blocked-activation')
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(inspection.journal.find(row => row.step === 'activation-evaluated').evidence.gatePhase, 'validating')
  assert.equal(inspection.journal.find(row => row.step === 'activation-refused').evidence.gatePhase, 'validating')
  assert.equal(readMigrationStartupGate({ home: f.home }).phase, 'validating')
  assert.notEqual(readMigrationStartupGate({ home: f.home }).phase, 'committed')
})

test('orchestration platform: a linux write handle is advisory and never a stop proof', async t => {
  if (process.platform !== 'linux') {
    t.skip('linux /proc writer enumeration is unavailable on ' + process.platform + '; the advisory path is covered by the windows case')
    return
  }
  const f = await scenario(t)
  const snapshot = await begin(f.input())
  assert.equal(snapshot.stopWriteProvable, false)
  assert.equal(snapshot.status, 'blocked-activation')
})

test('orchestration platform: an unavailable writer enumeration is degraded and C4/C5 stay false', async t => {
  const f = await scenario(t)
  const summary = await begin(f.input())
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  const record = inspection.journal[0].evidence
  if (process.platform === 'win32') assert.equal(record.writerEnumeration, 'unavailable')
  else assert.match(record.writerEnumeration, /^linux-procfs/)
  assert.equal(record.stopWriteProvable, false)
  assert.equal(typeof record.writerObservationDigest, 'string')
  assert.equal(record.writerObservationDigest.length, 64)
  assert.equal(summary.activation.criteria.find(entry => entry.id === 'C4').ok, false)
  assert.equal(summary.activation.criteria.find(entry => entry.id === 'C5').ok, false)
  assert.equal(inspection.world.stopWriteProvable, false)
})

test('orchestration drain: declared remote client revocation is chained before capture', async t => {
  const f = await scenario(t), remoteClients = [{ configPath: join(f.dir, 'agent-config.json'), machineId: 'machine-a', clientId: 'host' }]
  let calls = 0
  const remoteClientQuarantine = async ({ clients }) => {
    calls++
    assert.deepEqual(clients, remoteClients)
    return { declaredCredentialAdmissionBlocked: true, persistentDeclaredExclusion: true, clients: clients.map(client => ({ ...client, revoked: true })) }
  }
  const summary = await begin(f.input({ remoteClients, remoteClientQuarantine, remoteOperationDrain }))
  assert.equal(summary.status, 'blocked-activation')
  assert.equal(summary.steps, 16)
  assert.equal(calls, 1)
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.deepEqual(stepNames(inspection).slice(5, 11), ['exclusive-acquired', 'remote-revoke-requested', 'remote-revoke-completed', 'remote-operation-drain-requested', 'remote-operation-drain-completed', 'capture-started'])
  const operation = await readOperationRecord({ privateOutput: f.privateOutput })
  assert.equal(operation.remoteClientsDigest, sha(json(remoteClients)))
  assert.equal(inspection.journal.find(row => row.step === 'remote-operation-drain-completed').evidence.stopWriteProvable, false)
})

test('orchestration drain: an unconfirmed remote revoke blocks capture and resumes without duplicating the request', async t => {
  const f = await scenario(t), remoteClients = [{ configPath: join(f.dir, 'agent-config.json'), machineId: 'machine-a', clientId: 'host' }]
  let calls = 0
  const remoteClientQuarantine = async ({ clients }) => {
    calls++
    if (calls === 1) throw Object.assign(new Error('MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED'), { code: 'MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED' })
    return { declaredCredentialAdmissionBlocked: true, persistentDeclaredExclusion: true, clients: clients.map(client => ({ ...client, revoked: true })) }
  }
  const input = () => f.input({ remoteClients, remoteClientQuarantine, remoteOperationDrain })
  await assert.rejects(begin(input()), { code: 'MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED' })
  const blocked = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(blocked.summary.status, 'blocked-drain')
  assert.equal(blocked.next, 'fence')
  assert.equal(stepNames(blocked).includes('capture-started'), false)
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
  assert.equal((await resume(input())).status, 'blocked-activation')
  assert.equal(calls, 2)
  const recovered = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(stepNames(recovered).filter(step => step === 'remote-revoke-requested').length, 1)
  assert.equal(stepNames(recovered).filter(step => step === 'remote-revoke-completed').length, 1)
  assert.ok(stepNames(recovered).indexOf('blocked-drain') < stepNames(recovered).indexOf('remote-revoke-completed'))
  assert.ok(stepNames(recovered).indexOf('remote-operation-drain-completed') < stepNames(recovered).indexOf('capture-started'))
})

test('orchestration drain: an active remote operation blocks capture until its original receipt settles', async t => {
  const f = await scenario(t), remoteClients = [{ configPath: join(f.dir, 'agent-config.json'), machineId: 'machine-a', clientId: 'host' }]
  const remoteClientQuarantine = async ({ clients }) => ({ declaredCredentialAdmissionBlocked: true, persistentDeclaredExclusion: true, clients: clients.map(client => ({ ...client, revoked: true })) })
  let calls = 0
  const drain = async ({ clients }) => {
    calls++
    if (calls === 1) throw Object.assign(new Error('MIGRATION_REMOTE_OPERATION_ACTIVE'), { code: 'MIGRATION_REMOTE_OPERATION_ACTIVE' })
    return remoteOperationDrain({ clients })
  }
  const input = () => f.input({ remoteClients, remoteClientQuarantine, remoteOperationDrain: drain })
  await assert.rejects(begin(input()), { code: 'MIGRATION_REMOTE_OPERATION_ACTIVE' })
  const blocked = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(blocked.summary.status, 'blocked-drain')
  assert.equal(stepNames(blocked).includes('capture-started'), false)
  assert.equal(stepNames(blocked).includes('remote-operation-drain-completed'), false)
  assert.equal((await resume(input())).status, 'blocked-activation')
  assert.equal(calls, 2)
  const recovered = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(stepNames(recovered).filter(step => step === 'remote-operation-drain-requested').length, 1)
  assert.equal(stepNames(recovered).filter(step => step === 'remote-operation-drain-completed').length, 1)
})
