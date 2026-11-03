import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { openSqliteRouterState } from '../packages/orchestration/src/sqlite-router-state.mjs'
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

async function scenario (t, { breakCapture = false, domainEvidence = false, domainFault = null } = {}) {
  const dir = await mkdtemp(join(parent, 'case-'))
  const home = join(dir, 'home')
  const profile = join(home, 'profiles', 'desktop')
  const bot = join(home, 'bot')
  const sessions = join(home, 'sessions')
  const attachments = join(home, 'attachments')
  const ledgerSource = join(dir, 'ledger-source')
  for (const path of [profile, bot, sessions, ...(domainEvidence ? [attachments] : []), ledgerSource]) await mkdir(path, { recursive: true })
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
  if (domainEvidence) {
    const team = { version: 1, mainBotIds: ['bot-a'], bots: { 'bot-a': { id: 'bot-a', sessionId: 'bot-a', segments: [], capabilities: [] } }, rooms: {}, agents: {}, capabilities: { items: {} } }
    await writeFile(join(bot, 'state.json'), json(team))
    await writeFile(join(bot, 'secrets.json'), json({ version: 1, secrets: [] }))
    const sessionDirectory = join(sessions, '_no-cwd', 'bot-a')
    await mkdir(sessionDirectory, { recursive: true })
    const sessionHeader = sessionFormatCatalog.encodeCurrentHeader({ version: 4, id: 'bot-a', createdAt: 1, isSeeded: false, delegationDepth: 0 }, 0)
    await writeFile(join(sessionDirectory, 'session.v4.jsonl'), json(sessionHeader))
  } else {
    await writeFile(join(bot, 'state.json'), json({ id: 'bot-stable', secret: 'SECRET-DATA' }))
    await writeFile(join(sessions, 'session-a.jsonl'), 'PRIVATE-SESSION\n')
  }
  const plan = await previewProfileMigration({ profileDir: profile, dshHome: home, launchCwd: profile, orderedBundleLayers: [base, old], launcherLayers: [], launchEnvironment: {}, targetBundleLayer: target })
  assert.equal(plan.status, 'ready')
  const markerPath = join(ledgerSource, 'state.json')
  const dbFile = join(ledgerSource, domainEvidence ? 'router.sqlite' : 'ledger.sqlite')
  if (domainEvidence && domainFault !== 'invalid-ledger') {
    const legacy = createRouterState({ file: markerPath })
    await legacy.update(() => {})
    const store = await openSqliteRouterState({ Database, file: dbFile, legacyFile: markerPath })
    const journal = store.openTaskJournal()
    journal.close()
    await store.close()
    assert.equal(JSON.parse(await readFile(markerPath, 'utf8')).version, 4)
    if (domainFault === 'missing-marker') await unlink(markerPath)
  }
  const database = new Database(dbFile)
  if (!domainEvidence || domainFault === 'invalid-ledger') {
    database.exec('CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT)')
    database.prepare('INSERT INTO audit(note) VALUES(?)').run('PRIVATE-ROW')
  }
  t.after(() => { if (database.open) database.close() })
  const selected = [
    { id: 'bot', kind: 'bot-data', root: bot },
    { id: 'sessions', kind: 'sessions', root: sessions },
    ...(domainEvidence ? [{ id: 'attachments', kind: 'attachments', root: attachments }, { id: 'router', kind: 'ledger', root: ledgerSource }] : []),
  ]
  const inventory = await inspectMigrationSources(selected)
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
    domains: selected.map(source => ({ name: source.id, roots: [source.root] })),
    privateOutput: join(dir, 'owner-private'),
    dataArchiveRoot: join(dir, 'capture-data'),
    ledgerArchiveRoot: join(dir, 'capture-ledger'),
    commitOutput: join(dir, 'commit-private'),
  }
  if (domainEvidence) {
    fixture.domainAuditInput = {
      layout: {
        team: { sourceId: 'bot', path: 'state.json' },
        router: domainFault === 'invalid-ledger' ? null : { sourceId: 'router', path: 'state.json' },
        secrets: { sourceId: 'bot', path: 'secrets.json' },
        usage: null,
        sessions: [{ sourceId: 'sessions', compression: 'none' }],
        attachments: [{ sourceId: 'attachments' }],
        workspacePolicy: 'preserve-in-place',
      },
      finance: domainFault === 'missing-timezone' ? {} : { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      limits: { maxSessions: 100 },
    }
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
  const lateDomain = {
    domainAuditInput: { layout: { team: null, router: null, secrets: null, usage: null, sessions: [], attachments: [] }, finance: { timeZone: 'UTC' }, limits: { maxSessions: 100 } },
    domainAuditRoot: join(f.dir, 'late-domain'),
  }
  await assert.rejects(begin(f.input(lateDomain)), { code: 'MIGRATION_ORCH_OPERATION_MISMATCH' })
  await assert.rejects(resume(f.input(lateDomain)), { code: 'MIGRATION_ORCH_OPERATION_MISMATCH' })
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
  assert.deepEqual(ACTIVATION_CRITERIA.find(entry => entry.id === 'C9'), { id: 'C9', ok: false, reason: 'PRODUCT_ADMISSION_PARTICIPANTS_ONLY' })
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

const domainOptions = (f, extra = {}) => ({
  domainAuditInput: f.domainAuditInput ?? {
    layout: { team: null, router: null, secrets: null, usage: null, sessions: [], attachments: [] },
    finance: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    limits: { maxSessions: 100 },
  },
  domainAuditRoot: join(f.dir, 'domain-evidence'),
  ...extra,
})

test('orchestration domain evidence: opt-in adds one independently verified capture step without granting capabilities', async t => {
  const f = await scenario(t, { domainEvidence: true })
  const options = domainOptions(f)
  const summary = await begin(f.input(options))
  assert.equal(summary.status, 'blocked-activation')
  assert.equal(summary.steps, 13)
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.deepEqual(stepNames(inspection).slice(6, 11), ['capture-started', 'capture-verified', 'domain-audit-verified', 'maintenance-started', 'maintenance-installed'])
  const row = inspection.journal.find(row => row.step === 'domain-audit-verified')
  const capture = inspection.journal.find(row => row.step === 'capture-verified')
  assert.equal(row.evidence.domainAuditStatus, 'audited')
  assert.equal(row.evidence.domainCoverage, 'captured-declared-roots-only')
  assert.equal(row.evidence.crossDomainConsistent, false)
  const operation = await readOperationRecord({ privateOutput: f.privateOutput })
  assert.equal(operation.domainLayoutDigest, sha(json(options.domainAuditInput.layout)))
  assert.equal(operation.domainAuditInputDigest, sha(json(options.domainAuditInput)))
  assert.equal(row.evidence.domainLayoutDigest, operation.domainLayoutDigest)
  assert.equal(row.evidence.domainAuditInputDigest, operation.domainAuditInputDigest)
  const artifact = JSON.parse(await readFile(join(options.domainAuditRoot, 'domain-audit.private.json'), 'utf8'))
  const captureStep = JSON.parse(await readFile(join(f.privateOutput, 'step-' + String(capture.index).padStart(5, '0') + '.json'), 'utf8'))
  assert.deepEqual(artifact.input, options.domainAuditInput)
  assert.equal(artifact.binding.operationDigest, operation.operationDigest)
  assert.equal(artifact.binding.captureJournalDigest, captureStep.digest)
  assert.equal(artifact.binding.captureManifestSha256, capture.evidence.captureManifestSha256)
  assert.equal(artifact.binding.ledgerManifestSha256, capture.evidence.ledgerManifestSha256)
  assert.equal(artifact.binding.ledgerContentDigest, capture.evidence.ledgerContentDigest)
  assert.deepEqual(artifact.binding.domains, operation.domains)
  assert.deepEqual(operation.domains.map(domain => domain.name), ['bot', 'sessions', 'attachments', 'router'])
  assert.equal(artifact.result.status, 'audited')
  assert.equal(artifact.result.financial.status, 'audited')
  assert.notEqual(artifact.result.financial.ledger, null)
  assert.equal(artifact.result.financial.ledger.contentDigest, capture.evidence.ledgerContentDigest)
  assert.ok(artifact.result.financial.ledger.rows > 0)
  assert.equal(artifact.result.applySupported, false)
  assert.equal(summary.activationSupported, false)
  assert.equal(summary.postActivationRollbackSupported, false)
  assert.ok(summary.activation.criteria.every(criterion => criterion.ok === false))

  await resumeMigrationConfigurationCommit({ privateOutput: f.commitOutput, phase: 'install' })
  await resumeMigrationConfigurationCommit({ privateOutput: f.commitOutput, phase: 'rollback', recover: true })
  assert.equal((await resume(f.input(options))).status, 'released')
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, false)
})

test('orchestration domain evidence: a complete artifact survives a pre-journal crash byte-for-byte and gains one step', async t => {
  class Pause extends Error {}
  const f = await scenario(t, { domainEvidence: true }), options = domainOptions(f)
  await assert.rejects(begin(f.input({ ...options, onBoundary: async ({ point }) => { if (point === 'domain-artifact-verified') throw new Pause('pause') } })), error => error instanceof Pause)
  const path = join(options.domainAuditRoot, 'domain-audit.private.json')
  const before = await readFile(path), metadata = await stat(path)
  assert.ok(!(await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })).journal.some(row => row.step === 'domain-audit-verified'))
  const { domainAuditInput, ...locations } = options
  assert.equal((await resume(f.input(locations))).status, 'blocked-activation')
  assert.deepEqual(await readFile(path), before)
  assert.equal((await stat(path)).mtimeMs, metadata.mtimeMs)
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(stepNames(inspection).filter(step => step === 'domain-audit-verified').length, 1)
})

test('orchestration domain evidence: only a missing artifact requires input and partial bytes are never overwritten', async t => {
  class Pause extends Error {}
  const missing = await scenario(t, { domainEvidence: true }), missingOptions = domainOptions(missing)
  await assert.rejects(begin(missing.input({ ...missingOptions, onBoundary: async ({ point }) => { if (point === 'after-step:capture-verified') throw new Pause('pause') } })), error => error instanceof Pause)
  const { domainAuditInput, ...missingLocations } = missingOptions
  await assert.rejects(resume(missing.input(missingLocations)), { code: 'MIGRATION_ORCH_INPUT_REQUIRED' })
  await assert.rejects(stat(join(missingOptions.domainAuditRoot, 'domain-audit.private.json')), { code: 'ENOENT' })
  assert.equal((await resume(missing.input(missingOptions))).status, 'blocked-activation')

  const partial = await scenario(t, { domainEvidence: true }), partialOptions = domainOptions(partial)
  await assert.rejects(begin(partial.input({ ...partialOptions, onBoundary: async ({ point }) => { if (point === 'domain-artifact-verified') throw new Pause('pause') } })), error => error instanceof Pause)
  const path = join(partialOptions.domainAuditRoot, 'domain-audit.private.json'), original = await readFile(path), bytes = original.subarray(0, 61)
  await writeFile(path, bytes)
  const { domainAuditInput: fixedInput, ...partialLocations } = partialOptions
  await assert.rejects(resume(partial.input(partialLocations)), { code: 'MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE' })
  assert.deepEqual(await readFile(path), bytes)
  const rebuilt = { ...partialLocations, domainAuditRoot: join(partial.dir, 'explicit-new-domain-evidence') }
  await assert.rejects(resume(partial.input(rebuilt)), { code: 'MIGRATION_ORCH_INPUT_REQUIRED' })
  assert.deepEqual(await readFile(path), bytes)
  assert.equal((await resume(partial.input({ ...rebuilt, domainAuditInput: fixedInput }))).status, 'blocked-activation')
  assert.deepEqual(await readFile(path), bytes)
})

test('orchestration domain evidence: fixed input and a pinned root reject re-entry drift', async t => {
  class Pause extends Error {}
  const f = await scenario(t, { domainEvidence: true }), options = domainOptions(f)
  await assert.rejects(begin(f.input({ ...options, onBoundary: async ({ point }) => { if (point === 'after-step:domain-audit-verified') throw new Pause('pause') } })), error => error instanceof Pause)
  for (const mutate of [
    input => { input.layout.sessions = [{ sourceId: 'sessions', compression: 'zstd' }] },
    input => { input.finance.timeZone = 'Pacific/Honolulu' },
    input => { input.limits.maxSessions = 99 },
  ]) {
    const changed = structuredClone(options.domainAuditInput)
    mutate(changed)
    await assert.rejects(resume(f.input({ ...options, domainAuditInput: changed })), { code: 'MIGRATION_ORCH_OPERATION_MISMATCH' })
  }
  await assert.rejects(resume(f.input({ ...options, domainAuditRoot: join(f.dir, 'other-evidence') })), { code: 'MIGRATION_ORCH_OPERATION_MISMATCH' })
  assert.equal((await resume(f.input(options))).status, 'blocked-activation')
})

test('orchestration domain evidence: maintenance and release reverify the current artifact and preserve the raw verdict', async t => {
  class Pause extends Error {}
  const f = await scenario(t, { domainEvidence: true }), options = domainOptions(f)
  await assert.rejects(begin(f.input({ ...options, onBoundary: async ({ point }) => { if (point === 'after-step:domain-audit-verified') throw new Pause('pause') } })), error => error instanceof Pause)
  const path = join(options.domainAuditRoot, 'domain-audit.private.json'), original = await readFile(path)
  const changed = JSON.parse(original)
  changed.result.status = 'needs-context'
  changed.result.fingerprint = '0'.repeat(64)
  await writeFile(path, json(changed))
  await assert.rejects(resume(f.input(options)), { code: 'MIGRATION_ORCH_CAPTURE_MISMATCH' })
  assert.ok(!stepNames(await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })).includes('maintenance-started'))
  await writeFile(path, original)
  assert.equal((await resume(f.input(options))).status, 'blocked-activation')
  assert.equal((await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })).journal.find(row => row.step === 'domain-audit-verified').evidence.domainAuditStatus, 'audited')

  const g = await scenario(t, { domainEvidence: true }), other = domainOptions(g)
  await begin(g.input(other))
  await resumeMigrationConfigurationCommit({ privateOutput: g.commitOutput, phase: 'install' })
  await resumeMigrationConfigurationCommit({ privateOutput: g.commitOutput, phase: 'rollback', recover: true })
  const releasePath = join(other.domainAuditRoot, 'domain-audit.private.json'), releaseOriginal = await readFile(releasePath), tampered = JSON.parse(releaseOriginal)
  tampered.result.status = 'blocked'
  await writeFile(releasePath, json(tampered))
  await assert.rejects(resume(g.input(other)), { code: 'MIGRATION_ORCH_RELEASE_BLOCKED' })
  assert.equal((await readMigrationFence(g.home)).maintenanceActive, true)
  assert.equal((await inspectMigrationCommitOperation({ privateOutput: g.privateOutput })).summary.activationSupported, false)
})

test('orchestration domain evidence: raw needs-context and blocked verdicts are never relabelled', async t => {
  for (const [domainFault, status] of [['missing-timezone', 'needs-context'], ['missing-marker', 'blocked'], ['invalid-ledger', 'blocked']]) {
    const f = await scenario(t, { domainEvidence: true, domainFault }), options = domainOptions(f)
    assert.equal((await begin(f.input(options))).status, 'blocked-activation')
    const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
    const row = inspection.journal.find(row => row.step === 'domain-audit-verified')
    const artifact = JSON.parse(await readFile(join(options.domainAuditRoot, 'domain-audit.private.json'), 'utf8'))
    assert.equal(artifact.result.status, status, domainFault)
    assert.equal(row.evidence.domainAuditStatus, status, domainFault)
    if (status === 'blocked') {
      assert.equal(artifact.result.financial.status, 'blocked', domainFault)
      assert.equal(artifact.result.financial.ledger, null, domainFault)
    } else {
      assert.equal(artifact.result.financial.status, 'needs-context')
      assert.notEqual(artifact.result.financial.ledger, null)
    }
  }
})

test('orchestration domain evidence: operation, capture and pinned-step authority reject substitution', async t => {
  class Pause extends Error {}
  const pause = async ({ point }) => { if (point === 'after-step:domain-audit-verified') throw new Pause('pause') }
  const f = await scenario(t, { domainEvidence: true }), options = domainOptions(f)
  const g = await scenario(t, { domainEvidence: true }), other = domainOptions(g)
  await assert.rejects(begin(f.input({ ...options, onBoundary: pause })), error => error instanceof Pause)
  await begin(g.input(other))
  const path = join(options.domainAuditRoot, 'domain-audit.private.json'), original = await readFile(path)
  const foreign = await readFile(join(other.domainAuditRoot, 'domain-audit.private.json'))
  await writeFile(path, foreign)
  const crossOperation = await rejection(resume(f.input(options)))
  assert.equal(crossOperation.code, 'MIGRATION_ORCH_CAPTURE_MISMATCH')
  assert.equal(crossOperation.details.reason, 'MIGRATION_DOMAIN_OPERATION_MISMATCH')
  assert.deepEqual(await readFile(join(other.domainAuditRoot, 'domain-audit.private.json')), foreign)
  await writeFile(path, original)

  await rename(f.dataArchiveRoot, join(f.dir, 'bound-data-archive'))
  await rename(g.dataArchiveRoot, f.dataArchiveRoot)
  const replacedArchive = await rejection(resume(f.input(options)))
  assert.equal(replacedArchive.code, 'MIGRATION_ORCH_CAPTURE_MISMATCH')
  assert.equal(replacedArchive.details.reason, 'capture-digest-mismatch')
  assert.deepEqual(await readFile(path), original)

  const h = await scenario(t, { domainEvidence: true }), pinned = domainOptions(h)
  await assert.rejects(begin(h.input({ ...pinned, onBoundary: pause })), error => error instanceof Pause)
  const inspection = await inspectMigrationCommitOperation({ privateOutput: h.privateOutput })
  const domainIndex = inspection.journal.find(row => row.step === 'domain-audit-verified').index
  const stepPath = join(h.privateOutput, 'step-' + String(domainIndex).padStart(5, '0') + '.json')
  const step = JSON.parse(await readFile(stepPath, 'utf8'))
  step.evidence.domainFingerprint = '0'.repeat(64)
  await writeFile(stepPath, json(step))
  await assert.rejects(resume(h.input(pinned)), { code: 'MIGRATION_ORCH_JOURNAL_INVALID' })
  assert.equal((await inspectMigrationCommitOperation({ privateOutput: h.privateOutput })).valid, false)
})

test('orchestration domain evidence: capture roots must equal the immutable declared roots', async t => {
  const f = await scenario(t, { domainEvidence: true }), options = domainOptions(f)
  await assert.rejects(begin(f.input({ ...options, domains: [f.domains[0]] })), { code: 'MIGRATION_DOMAIN_ROOT_COVERAGE_MISMATCH' })
  const inspection = await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })
  assert.equal(inspection.summary.status, 'blocked-capture')
  assert.ok(!stepNames(inspection).includes('maintenance-started'))
})
