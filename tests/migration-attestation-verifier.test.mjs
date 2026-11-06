import test from 'node:test'
import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { openSqliteRouterState } from '../packages/orchestration/src/sqlite-router-state.mjs'
import { previewProfileMigration } from '../packages/orchestration/src/profile-migration-plan.mjs'
import { inspectMigrationSources } from '../packages/orchestration/src/migration-snapshot.mjs'
import { beginMigrationExclusive } from '../packages/orchestration/src/migration-fence.mjs'
import { beginMigrationCommitOperation } from '../packages/orchestration/src/migration-commit-orchestration.mjs'
import { createMigrationAttestationBundle, observeMigrationAttestationContext, verifyMigrationAttestationBundle } from '../packages/orchestration/src/migration-attestation-verifier.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const PRODUCT = '@ljwei-stak/dsh-model-route-bot'
const parent = resolve('tmp/integration/migration-attestation-verifier')
await mkdir(parent, { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value) + '\n'

async function scenario (t, { money = false, extraLedger = false, markerChange = null, ledgerPhase = null, withHold = false } = {}) {
  const dir = await mkdtemp(join(parent, 'case-'))
  const home = join(dir, 'home')
  const profile = join(home, 'profiles', 'desktop')
  const bot = join(home, 'bot')
  const sessions = join(home, 'sessions')
  for (const path of [profile, bot, sessions]) await mkdir(path, { recursive: true })
  async function bundle (folder, name, patch) {
    const packageDir = join(dir, folder)
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), json({ name, version: '0.26.0-preview.1', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
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
  const selected = [{ id: 'bot', kind: 'bot-data', root: bot }, { id: 'sessions', kind: 'sessions', root: sessions }]
  const ledgerSource = join(dir, 'ledger-source')
  const ledgerFile = join(ledgerSource, money ? 'router.sqlite' : 'ledger.sqlite')
  const markerPath = join(ledgerSource, 'state.json')
  await mkdir(ledgerSource)
  if (money) {
    const legacy = createRouterState({ file: markerPath })
    await legacy.update(state => {
      if (!withHold) return
      state.runs = [{ id: 'held-run', createdAt: 1, status: 'running', packages: [], reviews: [] }]
      state.budgetReservations = { 'held-run': { id: 'held-run', runId: 'held-run', ownerToken: 'SECRET-TOKEN', ownerPid: 123, status: 'interrupted', createdAt: 1, updatedAt: 1, packages: [], completedIds: [] } }
    })
    const store = await openSqliteRouterState({ Database, file: ledgerFile, legacyFile: markerPath })
    const journal = store.openTaskJournal()
    journal.close()
    await store.close()
    if (ledgerPhase) {
      const database = new Database(ledgerFile)
      database.prepare('UPDATE router_migration SET phase=?').run(ledgerPhase)
      database.close()
    }
    if (markerChange) {
      const marker = JSON.parse(await readFile(markerPath, 'utf8'))
      markerChange(marker)
      await writeFile(markerPath, json(marker))
    }
    selected.push({ id: 'router', kind: 'ledger', root: ledgerSource })
    if (extraLedger) {
      const extra = join(dir, 'ledger-extra')
      await mkdir(extra)
      await writeFile(join(extra, 'state.json'), '{}\n')
      selected.push({ id: 'extra', kind: 'ledger', root: extra })
    }
  }
  const database = new Database(ledgerFile)
  if (money) assert.equal(database.pragma('user_version', { simple: true }), 5)
  if (!money) {
    database.exec('CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT)')
    database.prepare('INSERT INTO audit(note) VALUES(?)').run('PRIVATE-ROW')
  }
  const closeLedger = () => { if (database.open) database.close() }
  t.after(closeLedger)
  const inventory = await inspectMigrationSources(selected)
  const before = Buffer.from(profilePackage)
  const changes = [{ path: join(profile, 'package.json'), beforeSha256: sha(before), maintenance: Buffer.from(json({ dsh: { profile: { bundles: [base.packageName] } } })), after: Buffer.from(json({ dsh: { profile: { bundles: [target.packageName] } } })) }]
  const operationId = randomUUID()
  const fixture = { dir, home, operationId, ledgerSource, ledgerFile, markerPath, closeLedger, privateOutput: join(dir, 'owner-private'), dataArchive: join(dir, 'capture-data'), ledgerArchive: join(dir, 'capture-ledger'), configurationDirectory: join(dir, 'commit-private') }
  const summary = await beginMigrationCommitOperation({
    home, operationId, privateOutput: fixture.privateOutput,
    domains: [{ name: 'bot', roots: [bot] }, { name: 'sessions', roots: [sessions] }],
    profilePlan: plan, configurationPlan: plan, inventory,
    dataArchiveRoot: fixture.dataArchive, ledgerArchiveRoot: fixture.ledgerArchive,
    commitOutput: fixture.configurationDirectory, commitChanges: changes,
    Database, ledgerDatabase: database, limits: { drainTimeoutMs: 5000, pollMs: 20 },
  })
  assert.equal(summary.status, 'blocked-activation')
  const fence = await beginMigrationExclusive(home, { operationId, drainTimeoutMs: 5000, pollMs: 20 })
  t.after(() => fence.release().catch(() => {}))
  fixture.common = { Database, operationDirectory: fixture.privateOutput, configurationDirectory: fixture.configurationDirectory, dataArchive: fixture.dataArchive, ledgerArchive: fixture.ledgerArchive, fenceHome: home, assertExclusive: () => fence.verify() }
  return fixture
}

async function prepared (t, options) {
  const fixture = await scenario(t, options)
  const expected = await observeMigrationAttestationContext(fixture.common)
  return { ...fixture, expected }
}

function createOptions (fixture, extra = {}) {
  return { ...fixture.common, privateOutput: join(fixture.dir, 'attestation'), expected: fixture.expected, attestationType: 'artifact', evidenceClass: 'automatic-observation', nowMs: 1000000, clockFloorMs: 999999, ttlMs: 60000, ...extra }
}

function verifyOptions (fixture, extra = {}) {
  return { ...fixture.common, privateOutput: join(fixture.dir, 'attestation'), expected: fixture.expected, nowMs: 1000001, clockFloorMs: 999999, ...extra }
}

test('attestation artifact: actual sources bind an independently fixed context and replay without renewal', async t => {
  const fixture = await prepared(t)
  assert.equal(fixture.expected.kind, 'migration-attestation-context')
  assert.equal(fixture.expected.operationId, fixture.operationId)
  assert.equal(JSON.stringify(fixture.expected).includes('ownerToken'), false)
  const created = await createMigrationAttestationBundle(createOptions(fixture))
  assert.equal(created.status, 'observed')
  assert.equal(created.replayed, false)
  assert.deepEqual([created.allowed, created.activationSupported, created.postActivationRollbackSupported, created.stopWriteProvable, created.generationAvailable], [false, false, false, false, false])
  const output = join(fixture.dir, 'attestation')
  const before = await stat(join(output, 'attestation.private.json'))
  const verified = await verifyMigrationAttestationBundle(verifyOptions(fixture))
  assert.equal(verified.status, 'observed')
  const replayed = await createMigrationAttestationBundle(createOptions(fixture))
  assert.equal(replayed.replayed, true)
  const after = await stat(join(output, 'attestation.private.json'))
  assert.equal(after.mtimeMs, before.mtimeMs)
  const persisted = JSON.parse(await readFile(join(output, 'attestation.private.json'), 'utf8'))
  assert.equal(persisted.collectedAt, 1000000)
  assert.equal(persisted.expiresAt, 1060000)
  assert.equal(persisted.generation, null)
  const publicText = JSON.stringify(created)
  for (const secret of ['SECRET-DATA', 'PRIVATE-ROW', fixture.dir, 'ownerToken']) assert.equal(publicText.includes(secret), false)
  // Same request with a later nowMs (still inside the original expiry) replays
  // the persisted bundle: original collectedAt/expiry/bytes/mtime, no renewal,
  // and no requirement to replay the original collection timestamp.
  const replayLater = await createMigrationAttestationBundle(createOptions(fixture, { nowMs: 1059999 }))
  assert.equal(replayLater.replayed, true)
  const replayAgain = await createMigrationAttestationBundle(createOptions(fixture, { nowMs: 1000001 }))
  assert.equal(replayAgain.replayed, true)
  const afterReplay = await stat(join(output, 'attestation.private.json'))
  assert.equal(afterReplay.mtimeMs, before.mtimeMs)
  const persistedReplay = JSON.parse(await readFile(join(output, 'attestation.private.json'), 'utf8'))
  assert.equal(persistedReplay.collectedAt, 1000000)
  assert.equal(persistedReplay.expiresAt, 1060000)
  // Expired replays are rejected against this call's nowMs, not renewed.
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { nowMs: 1060000 })), { code: 'MIGRATION_ATTESTATION_EXPIRED' })
  // A different ttl is a different request and conflicts without overwriting.
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { nowMs: 1000001, ttlMs: 60001 })), { code: 'MIGRATION_ATTESTATION_REQUEST_CONFLICT' })
  // A missing ttl is rejected before any output side effect.
  const noTtl = join(fixture.dir, 'attestation-no-ttl')
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: noTtl, ttlMs: undefined })), { code: 'MIGRATION_ATTESTATION_TTL_INVALID' })
  await assert.rejects(stat(noTtl), { code: 'ENOENT' })
})

test('attestation declarations stay declaration-only and unsupported evidence never upgrades', async t => {
  const fixture = await prepared(t)
  const options = createOptions(fixture, { attestationType: 'money', evidenceClass: 'manual-declaration', declaration: { actorId: 'owner-a', text: 'Reviewed privately; not authenticated.' } })
  const created = await createMigrationAttestationBundle(options)
  assert.equal(created.status, 'declaration-only')
  assert.equal(created.allowed, false)
  assert.equal((await verifyMigrationAttestationBundle(verifyOptions(fixture))).status, 'declaration-only')
  for (const attestationType of ['stopped-hosts', 'complete-domains', 'consistent-backups', 'permissions']) {
    await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: join(fixture.dir, 'unsupported-' + attestationType), attestationType })), { code: 'MIGRATION_ATTESTATION_UNSUPPORTED' })
  }
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: join(fixture.dir, 'platform'), evidenceClass: 'platform-evidence' })), { code: 'MIGRATION_ATTESTATION_UNSUPPORTED' })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: join(fixture.dir, 'large'), evidenceClass: 'manual-declaration', declaration: { actorId: 'owner-a', text: 'x'.repeat(2049) } })), { code: 'MIGRATION_ATTESTATION_DECLARATION_INVALID' })
})

test('attestation schema rejects accessors, unknown fields, forward versions and noncanonical bytes', async t => {
  const fixture = await prepared(t)
  const getter = { ...fixture.expected }
  Object.defineProperty(getter, 'host', { enumerable: true, get () { throw new Error('getter executed') } })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { expected: getter })), { code: 'MIGRATION_ATTESTATION_SCHEMA_INVALID' })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { expected: { ...fixture.expected, extra: true } })), { code: 'MIGRATION_ATTESTATION_SCHEMA_INVALID' })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { expected: { ...fixture.expected, schemaVersion: 2 } })), { code: 'MIGRATION_ATTESTATION_SCHEMA_INVALID' })
  await createMigrationAttestationBundle(createOptions(fixture))
  const file = join(fixture.dir, 'attestation', 'attestation.private.json')
  const original = await readFile(file)
  await writeFile(file, Buffer.concat([original, Buffer.from(' ')]))
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_ATTESTATION_NONCANONICAL' })
})

test('attestation binding rejects cross operation, host, plan, journal and owner changes even with a recomputed self hash', async t => {
  const fixture = await prepared(t)
  await createMigrationAttestationBundle(createOptions(fixture))
  for (const [key, value] of [['operationId', randomUUID()], ['host', 'other-host'], ['profilePlanDigest', '0'.repeat(64)], ['orchestrationJournalHead', '1'.repeat(64)], ['fenceExclusiveDigest', '2'.repeat(64)]]) {
    await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture, { expected: { ...fixture.expected, [key]: value } })), { code: 'MIGRATION_ATTESTATION_BINDING_MISMATCH' })
  }
  const file = join(fixture.dir, 'attestation', 'attestation.private.json')
  const bundle = JSON.parse(await readFile(file, 'utf8'))
  bundle.binding = { ...bundle.binding, fenceExclusiveDigest: '3'.repeat(64) }
  const { bundleDigest, ...body } = bundle
  bundle.bundleDigest = sha(Buffer.from(JSON.stringify(body) + '\n'))
  await writeFile(file, JSON.stringify(bundle) + '\n')
  await writeFile(join(fixture.dir, 'attestation', 'completed.json'), json({ schemaVersion: 1, kind: 'migration-attestation-complete', bundleDigest: bundle.bundleDigest }))
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_ATTESTATION_BINDING_MISMATCH' })
  await fixture.common.assertExclusive()
})

test('attestation time checks expire evidence and detect rollback only against the supplied floor', async t => {
  const fixture = await prepared(t)
  await createMigrationAttestationBundle(createOptions(fixture))
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture, { nowMs: 999998, clockFloorMs: 999999 })), { code: 'MIGRATION_ATTESTATION_CLOCK_ROLLBACK' })
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture, { nowMs: 999999 })), { code: 'MIGRATION_ATTESTATION_EXPIRED' })
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture, { nowMs: 1060000 })), { code: 'MIGRATION_ATTESTATION_EXPIRED' })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: join(fixture.dir, 'ttl'), ttlMs: 300001 })), { code: 'MIGRATION_ATTESTATION_TTL_INVALID' })
})

test('attestation source drift and lost guards fail closed', async t => {
  const fixture = await prepared(t)
  await createMigrationAttestationBundle(createOptions(fixture))
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture, { assertExclusive: async () => false })), { code: 'MIGRATION_ATTESTATION_EXCLUSIVE_REQUIRED' })
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture, { assertExclusive: async () => { throw new Error('lost') } })), { code: 'MIGRATION_ATTESTATION_EXCLUSIVE_REQUIRED' })
  const operationStep = join(fixture.privateOutput, 'step-00000.json')
  await writeFile(operationStep, '{}\n')
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_ATTESTATION_OPERATION_INVALID' })
})

test('attestation private output refuses overlap and pre-existing conflicting content', async t => {
  const fixture = await prepared(t)
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: fixture.dataArchive })), { code: 'MIGRATION_ATTESTATION_OUTPUT_OVERLAP' })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: join(fixture.privateOutput, 'child') })), { code: 'MIGRATION_ATTESTATION_OUTPUT_OVERLAP' })
  const conflict = join(fixture.dir, 'conflict')
  await mkdir(conflict)
  await writeFile(join(conflict, 'attestation.private.json'), '{}\n')
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: conflict })), { code: 'MIGRATION_ATTESTATION_OUTPUT_CONFLICT' })
  assert.equal(await readFile(join(conflict, 'attestation.private.json'), 'utf8'), '{}\n')
})

test('attestation verify rejects an automatic payload that no longer matches the current observation', async t => {
  const fixture = await prepared(t)
  await createMigrationAttestationBundle(createOptions(fixture))
  const file = join(fixture.dir, 'attestation', 'attestation.private.json')
  const bundle = JSON.parse(await readFile(file, 'utf8'))
  // Tamper an observed count and recompute the self hash and the completion
  // record: the binding still matches, the payload no longer does.
  bundle.payload.dataFiles += 1
  bundle.payload.ledgerRows += 2
  const { bundleDigest, ...body } = bundle
  bundle.bundleDigest = sha(Buffer.from(JSON.stringify(body) + '\n'))
  await writeFile(file, JSON.stringify(bundle) + '\n')
  await writeFile(join(fixture.dir, 'attestation', 'completed.json'), json({ schemaVersion: 1, kind: 'migration-attestation-complete', bundleDigest: bundle.bundleDigest }))
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_ATTESTATION_PAYLOAD_MISMATCH' })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture)), { code: 'MIGRATION_ATTESTATION_PAYLOAD_MISMATCH' })
  const tampered = await readFile(file, 'utf8')
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_ATTESTATION_PAYLOAD_MISMATCH' })
  assert.equal(await readFile(file, 'utf8'), tampered)
})

test('attestation observation refuses individually valid archives from another operation', async t => {
  const fixture = await prepared(t)
  const other = await scenario(t)
  // Both archives of the second scenario are complete and verify on their own,
  // but they are not the archives this operation's capture-verified record
  // pinned; substituting them must fail closed instead of re-packaging them.
  await assert.rejects(observeMigrationAttestationContext({ ...fixture.common, ledgerArchive: other.ledgerArchive }), { code: 'MIGRATION_ATTESTATION_ARCHIVE_MISMATCH' })
  await assert.rejects(observeMigrationAttestationContext({ ...fixture.common, dataArchive: other.dataArchive, ledgerArchive: other.ledgerArchive }), { code: 'MIGRATION_ATTESTATION_PLAN_MISMATCH' })
  const expected = fixture.expected
  await assert.rejects(createMigrationAttestationBundle({ ...fixture.common, expected, privateOutput: join(fixture.dir, 'swapped'), attestationType: 'artifact', evidenceClass: 'automatic-observation', nowMs: 1000000, clockFloorMs: 999999, ttlMs: 60000, ledgerArchive: other.ledgerArchive }), { code: 'MIGRATION_ATTESTATION_ARCHIVE_MISMATCH' })
  await assert.rejects(stat(join(fixture.dir, 'swapped')), { code: 'ENOENT' })
})

test('attestation reads reject hardlinked physical aliases of sources and outputs', async t => {
  const fixture = await prepared(t)
  await createMigrationAttestationBundle(createOptions(fixture))
  const bundlePath = join(fixture.dir, 'attestation', 'attestation.private.json')
  const outputAlias = join(fixture.dir, 'attestation', 'bundle-alias.json')
  await link(bundlePath, outputAlias)
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_ATTESTATION_OUTPUT_INVALID' })
  await unlink(outputAlias)
  assert.equal((await verifyMigrationAttestationBundle(verifyOptions(fixture))).status, 'observed')
  const transactionAlias = join(fixture.dir, 'transaction-alias.json')
  await link(join(fixture.configurationDirectory, 'transaction.private.json'), transactionAlias)
  // The configuration commit verifier itself refuses a hardlinked transaction.
  await assert.rejects(observeMigrationAttestationContext(fixture.common), { code: 'MIGRATION_COMMIT_FILE_INVALID' })
  await unlink(transactionAlias)
  // The capture manifest is read through this module's bounded single-link
  // reader, so a physical alias of it is rejected here as well.
  const captureAlias = join(fixture.dir, 'capture-alias.json')
  await link(join(fixture.dataArchive, 'capture.private.json'), captureAlias)
  await assert.rejects(observeMigrationAttestationContext(fixture.common), { code: 'MIGRATION_ATTESTATION_SOURCE_INVALID' })
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_ATTESTATION_SOURCE_INVALID' })
  await unlink(captureAlias)
  assert.equal((await verifyMigrationAttestationBundle(verifyOptions(fixture))).status, 'observed')
})

test('attestation money: captured marker and schema-5 ledger produce a bounded needs-context observation', async t => {
  const fixture = await prepared(t, { money: true })
  const created = await createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money' }))
  assert.equal(created.status, 'observed')
  assert.equal(created.attestationType, 'money')
  assert.deepEqual(Object.keys(created), ['schemaVersion', 'kind', 'status', 'attestationType', 'evidenceClass', 'observations', 'replayed', 'allowed', 'activationSupported', 'postActivationRollbackSupported', 'stopWriteProvable', 'generationAvailable'])
  assert.deepEqual([created.allowed, created.activationSupported, created.postActivationRollbackSupported, created.stopWriteProvable, created.generationAvailable], [false, false, false, false, false])
  const file = join(fixture.dir, 'attestation', 'attestation.private.json')
  const bundle = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(Object.keys(bundle.payload), ['observation', 'coverage', 'financeAuditStatus', 'needsContextCodes', 'dataArchiveManifestDigest', 'ledgerArchiveManifestDigest', 'ledgerContentDigest', 'markerDigest', 'routerMigrationTableDigest', 'routerMetaTableDigest', 'ledgerTables', 'ledgerRows', 'runCount', 'holdCount', 'unassignedRunCount'])
  assert.equal(bundle.payload.coverage, 'captured-marker-ledger-epoch-only')
  assert.equal(bundle.payload.financeAuditStatus, 'needs-context')
  assert.deepEqual(bundle.payload.needsContextCodes, ['TIMEZONE_CONTEXT_REQUIRED', 'USAGE_EXPORT_REQUIRED'])
  assert.equal(bundle.payload.dataArchiveManifestDigest, fixture.expected.dataArchiveManifestDigest)
  assert.equal(bundle.payload.ledgerArchiveManifestDigest, fixture.expected.ledgerArchiveManifestDigest)
  assert.equal(bundle.payload.ledgerContentDigest, fixture.expected.ledgerContentDigest)
  for (const key of ['markerDigest', 'routerMigrationTableDigest', 'routerMetaTableDigest']) assert.match(bundle.payload[key], /^[a-f0-9]{64}$/)
  const publicText = JSON.stringify(created)
  for (const secret of [fixture.dir, fixture.operationId, bundle.payload.markerDigest, bundle.payload.ledgerContentDigest, 'runCount', 'coverage', 'epochId', 'runId', 'host', 'costUsd']) assert.equal(publicText.includes(secret), false)
  assert.equal((await verifyMigrationAttestationBundle(verifyOptions(fixture))).status, 'observed')
  const before = await stat(file)
  const replayed = await createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money', nowMs: 1059999 }))
  assert.equal(replayed.replayed, true)
  const after = await stat(file)
  assert.equal(after.mtimeMs, before.mtimeMs)
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(persisted.collectedAt, 1000000)
  assert.equal(persisted.expiresAt, 1060000)
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money', nowMs: 1060000 })), { code: 'MIGRATION_ATTESTATION_EXPIRED' })
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture, { nowMs: 1060000 })), { code: 'MIGRATION_ATTESTATION_EXPIRED' })
})

test('attestation money: old markers and another epoch are rejected', async t => {
  for (const markerChange of [marker => { marker.version = 3 }, marker => { marker.migration.id = randomUUID() }]) {
    const fixture = await prepared(t, { money: true, markerChange })
    await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money' })), { code: 'MIGRATION_ATTESTATION_MONEY_AUDIT_BLOCKED' })
    await assert.rejects(stat(join(fixture.dir, 'attestation')), { code: 'ENOENT' })
  }
})

test('attestation money: missing or multiple captured ledger sources fail closed without changing artifact observation', async t => {
  const missing = await prepared(t)
  assert.equal((await observeMigrationAttestationContext(missing.common)).operationId, missing.operationId)
  await assert.rejects(createMigrationAttestationBundle(createOptions(missing, { attestationType: 'money' })), { code: 'MIGRATION_ATTESTATION_MONEY_MARKER_MISSING' })
  assert.equal((await createMigrationAttestationBundle(createOptions(missing, { privateOutput: join(missing.dir, 'artifact-ok') }))).status, 'observed')
  const multiple = await prepared(t, { money: true, extraLedger: true })
  await assert.rejects(createMigrationAttestationBundle(createOptions(multiple, { attestationType: 'money' })), { code: 'MIGRATION_ATTESTATION_MONEY_MARKER_MISSING' })
})

test('attestation money: inactive ledger authority is rejected', async t => {
  const fixture = await prepared(t, { money: true, ledgerPhase: 'prepared' })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money' })), { code: 'MIGRATION_ATTESTATION_MONEY_AUDIT_BLOCKED' })
})

test('attestation money: live original marker and database drift cannot replace the pinned archives', async t => {
  const fixture = await prepared(t, { money: true })
  await createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money' }))
  const file = join(fixture.dir, 'attestation', 'attestation.private.json')
  const before = await readFile(file)
  fixture.closeLedger()
  await writeFile(fixture.markerPath, json({ version: 3, runs: [] }))
  const database = new Database(fixture.ledgerFile)
  database.prepare("UPDATE router_migration SET phase='prepared'").run()
  database.close()
  assert.equal((await verifyMigrationAttestationBundle(verifyOptions(fixture))).status, 'observed')
  assert.equal((await readFile(file)).equals(before), true)
})

test('attestation money: drift of the archived marker is rejected by archive reverification', async t => {
  const fixture = await prepared(t, { money: true })
  await createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money' }))
  const manifest = JSON.parse(await readFile(join(fixture.dataArchive, 'capture.private.json'), 'utf8'))
  const source = manifest.sources.find(source => source.kind === 'ledger')
  await writeFile(join(fixture.dataArchive, 'data', source.directory, 'state.json'), '{"version":4}\n')
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_CAPTURE_CHANGED' })
})

test('attestation money: recomputed bundle and completion digests cannot authorize a changed payload', async t => {
  const fixture = await prepared(t, { money: true })
  await createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money' }))
  const file = join(fixture.dir, 'attestation', 'attestation.private.json')
  const bundle = JSON.parse(await readFile(file, 'utf8'))
  bundle.payload.runCount += 1
  bundle.payload.needsContextCodes = ['TIMEZONE_CONTEXT_REQUIRED']
  const { bundleDigest, ...body } = bundle
  bundle.bundleDigest = sha(Buffer.from(JSON.stringify(body) + '\n'))
  await writeFile(file, JSON.stringify(bundle) + '\n')
  await writeFile(join(fixture.dir, 'attestation', 'completed.json'), json({ schemaVersion: 1, kind: 'migration-attestation-complete', bundleDigest: bundle.bundleDigest }))
  await assert.rejects(verifyMigrationAttestationBundle(verifyOptions(fixture)), { code: 'MIGRATION_ATTESTATION_PAYLOAD_MISMATCH' })
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money' })), { code: 'MIGRATION_ATTESTATION_PAYLOAD_MISMATCH' })
})

test('attestation money: interrupted holds stay explicit needs-context rather than a complete audit', async t => {
  const fixture = await prepared(t, { money: true, withHold: true })
  await createMigrationAttestationBundle(createOptions(fixture, { attestationType: 'money' }))
  const bundle = JSON.parse(await readFile(join(fixture.dir, 'attestation', 'attestation.private.json'), 'utf8'))
  assert.equal(bundle.payload.financeAuditStatus, 'needs-context')
  assert.deepEqual(bundle.payload.needsContextCodes, ['ACTIVE_OR_INTERRUPTED_HOLDS', 'TIMEZONE_CONTEXT_REQUIRED', 'USAGE_EXPORT_REQUIRED'])
  assert.equal(bundle.payload.runCount, 1)
  assert.equal(bundle.payload.holdCount, 1)
  assert.equal(bundle.payload.unassignedRunCount, 1)
  assert.equal(JSON.stringify(bundle.payload).includes('held-run'), false)
  assert.equal((await verifyMigrationAttestationBundle(verifyOptions(fixture))).status, 'observed')
})
