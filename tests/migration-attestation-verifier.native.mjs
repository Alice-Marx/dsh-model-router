import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
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
const PRODUCT = '@ljwei-stak/dsh-model-router'
const parent = resolve('tmp/integration/migration-attestation-verifier-native')
await mkdir(parent, { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value) + '\n'
let sequence = 0

async function scenario (t, { holdFence = true, money = false } = {}) {
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
  await mkdir(ledgerSource)
  if (money) {
    const markerPath = join(ledgerSource, 'state.json')
    await createRouterState({ file: markerPath }).saveHealth(null)
    const store = await openSqliteRouterState({ Database, file: ledgerFile, legacyFile: markerPath })
    const journal = store.openTaskJournal()
    journal.close()
    await store.close()
    selected.push({ id: 'router', kind: 'ledger', root: ledgerSource })
  }
  const database = new Database(ledgerFile)
  if (money) assert.equal(database.pragma('user_version', { simple: true }), 5)
  if (!money) {
    database.exec('CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT)')
    database.prepare('INSERT INTO audit(note) VALUES(?)').run('PRIVATE-ROW')
  }
  t.after(() => { if (database.open) database.close() })
  const inventory = await inspectMigrationSources(selected)
  const before = Buffer.from(profilePackage)
  const changes = [{ path: join(profile, 'package.json'), beforeSha256: sha(before), maintenance: Buffer.from(json({ dsh: { profile: { bundles: [base.packageName] } } })), after: Buffer.from(json({ dsh: { profile: { bundles: [target.packageName] } } })) }]
  const operationId = randomUUID()
  const fixture = { dir, home, operationId, privateOutput: join(dir, 'owner-private'), dataArchive: join(dir, 'capture-data'), ledgerArchive: join(dir, 'capture-ledger'), configurationDirectory: join(dir, 'commit-private') }
  const summary = await beginMigrationCommitOperation({
    home, operationId, privateOutput: fixture.privateOutput,
    domains: [{ name: 'bot', roots: [bot] }, { name: 'sessions', roots: [sessions] }],
    profilePlan: plan, configurationPlan: plan, inventory,
    dataArchiveRoot: fixture.dataArchive, ledgerArchiveRoot: fixture.ledgerArchive,
    commitOutput: fixture.configurationDirectory, commitChanges: changes,
    Database, ledgerDatabase: database, limits: { drainTimeoutMs: 5000, pollMs: 20 },
  })
  assert.equal(summary.status, 'blocked-activation')
  if (holdFence) {
    const fence = await beginMigrationExclusive(home, { operationId, drainTimeoutMs: 5000, pollMs: 20 })
    t.after(() => fence.release().catch(() => {}))
    fixture.common = { Database, operationDirectory: fixture.privateOutput, configurationDirectory: fixture.configurationDirectory, dataArchive: fixture.dataArchive, ledgerArchive: fixture.ledgerArchive, fenceHome: home, assertExclusive: () => fence.verify() }
  } else {
    // beginMigrationCommitOperation leaves the fence held by this process at
    // blocked-activation; the dying child must be the only owner, so take the
    // records over once and release them before spawning it.
    const held = await beginMigrationExclusive(home, { operationId, drainTimeoutMs: 5000, pollMs: 20 })
    await held.release()
    fixture.common = { Database, operationDirectory: fixture.privateOutput, configurationDirectory: fixture.configurationDirectory, dataArchive: fixture.dataArchive, ledgerArchive: fixture.ledgerArchive, fenceHome: home, assertExclusive: async () => false }
  }
  return fixture
}

async function prepared (t, options) {
  const fixture = await scenario(t, options)
  const expected = await observeMigrationAttestationContext(fixture.common)
  return { ...fixture, expected }
}

async function run (request) {
  const file = join(request.dir, `child-${++sequence}.json`)
  await writeFile(file, json(request))
  const child = spawn(process.execPath, [join(ROOT, 'tests/fixtures/migration-attestation-verifier-crash.mjs'), file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(120000) })
  const output = []
  child.stdout.on('data', bytes => output.push(bytes))
  child.stderr.on('data', bytes => output.push(bytes))
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
  return { code, text: Buffer.concat(output).toString('utf8') }
}

function request (fixture, extra = {}) {
  return { dir: fixture.dir, fenceHome: fixture.home, operationDirectory: fixture.privateOutput, configurationDirectory: fixture.configurationDirectory, dataArchive: fixture.dataArchive, ledgerArchive: fixture.ledgerArchive, operationId: fixture.operationId, parentPid: process.pid, nowMs: 1000000, clockFloorMs: 999999, ttlMs: 60000, ...extra }
}

function createOptions (fixture, extra = {}) {
  return { ...fixture.common, privateOutput: join(fixture.dir, 'attestation'), expected: fixture.expected, attestationType: 'artifact', evidenceClass: 'automatic-observation', nowMs: 1000000, clockFloorMs: 999999, ttlMs: 60000, ...extra }
}

function parse (text) {
  return JSON.parse(text.trim().split('\n').at(-1))
}

test('attestation publish: real child crash after bundle-written resumes under the same living parent owner', async t => {
  const fixture = await prepared(t)
  const output = join(fixture.dir, 'attestation')
  // The delegated guard writes only under the parent owner the expected pinned.
  const rejected = await run(request(fixture, { mode: 'guard-reject', privateOutput: join(fixture.dir, 'attestation-guard'), expected: fixture.expected }))
  assert.equal(rejected.code, 0, rejected.text)
  assert.equal(parse(rejected.text).code, 'MIGRATION_ATTESTATION_EXCLUSIVE_REQUIRED')
  await assert.rejects(stat(join(fixture.dir, 'attestation-guard')), { code: 'ENOENT' })
  // Real crash between bundle persistence and the completion record.
  const crashed = await run(request(fixture, { mode: 'crash-after-bundle', privateOutput: output, expected: fixture.expected }))
  assert.equal(crashed.code, 86, crashed.text)
  assert.equal((await stat(join(output, 'attestation.private.json'))).isFile(), true)
  await assert.rejects(stat(join(output, 'completed.json')), { code: 'ENOENT' })
  const before = await stat(join(output, 'attestation.private.json'))
  const bytes = await readFile(join(output, 'attestation.private.json'))
  // A new writer process in the same owner/context first sees verify reject
  // the incomplete package, then completes it without rewriting the bundle.
  const resumed = await run(request(fixture, { mode: 'resume', privateOutput: output, expected: fixture.expected }))
  assert.equal(resumed.code, 0, resumed.text)
  const result = parse(resumed.text)
  assert.equal(result.verifyFailed, 'MIGRATION_ATTESTATION_OUTPUT_INCOMPLETE')
  assert.equal(result.created.replayed, true)
  assert.equal(result.created.status, 'observed')
  const after = await stat(join(output, 'attestation.private.json'))
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal((await readFile(join(output, 'attestation.private.json'))).equals(bytes), true)
  // Cold verification from another process and from the parent both pass.
  const cold = await run(request(fixture, { mode: 'cold-verify', privateOutput: output, expected: fixture.expected }))
  assert.equal(cold.code, 0, cold.text)
  assert.equal(parse(cold.text).verified.status, 'observed')
  assert.equal((await verifyMigrationAttestationBundle({ ...fixture.common, privateOutput: output, expected: fixture.expected, nowMs: 1000001, clockFloorMs: 999999 })).status, 'observed')
})

test('attestation owner death: old expected and old package die, a new owner needs a new expected and a new directory', async t => {
  const fixture = await scenario(t, { holdFence: false })
  const output = join(fixture.dir, 'attestation-old')
  const expectedFile = join(fixture.dir, 'old-expected.json')
  const died = await run(request(fixture, { mode: 'owner-die', privateOutput: output, expectedFile }))
  assert.equal(died.code, 86, died.text)
  const oldExpected = JSON.parse(await readFile(expectedFile, 'utf8'))
  assert.equal((await stat(join(output, 'attestation.private.json'))).isFile(), true)
  await assert.rejects(stat(join(output, 'completed.json')), { code: 'ENOENT' })
  // A new owner takes the dead owner's fence over and must re-observe.
  const fence = await beginMigrationExclusive(fixture.home, { operationId: fixture.operationId, drainTimeoutMs: 5000, pollMs: 20 })
  t.after(() => fence.release().catch(() => {}))
  const common = { ...fixture.common, assertExclusive: () => fence.verify() }
  const current = await observeMigrationAttestationContext(common)
  assert.notEqual(current.fenceIntentDigest, oldExpected.fenceIntentDigest)
  assert.notEqual(current.fenceExclusiveDigest, oldExpected.fenceExclusiveDigest)
  // The old expected context no longer describes the current owner.
  await assert.rejects(verifyMigrationAttestationBundle({ ...common, privateOutput: output, expected: oldExpected, nowMs: 1000001, clockFloorMs: 999999 }), { code: 'MIGRATION_ATTESTATION_BINDING_MISMATCH' })
  await assert.rejects(createMigrationAttestationBundle({ ...common, privateOutput: output, expected: oldExpected, attestationType: 'artifact', evidenceClass: 'automatic-observation', nowMs: 1000001, clockFloorMs: 999999, ttlMs: 60000 }), { code: 'MIGRATION_ATTESTATION_BINDING_MISMATCH' })
  // Completing the old package as the new owner is an explicit conflict; the
  // unfinished old package is preserved byte for byte.
  const oldBytes = await readFile(join(output, 'attestation.private.json'))
  const oldStat = await stat(join(output, 'attestation.private.json'))
  await assert.rejects(createMigrationAttestationBundle({ ...common, privateOutput: output, expected: current, attestationType: 'artifact', evidenceClass: 'automatic-observation', nowMs: 1000001, clockFloorMs: 999999, ttlMs: 60000 }), { code: 'MIGRATION_ATTESTATION_BINDING_MISMATCH' })
  assert.equal((await readFile(join(output, 'attestation.private.json'))).equals(oldBytes), true)
  assert.equal((await stat(join(output, 'attestation.private.json'))).mtimeMs, oldStat.mtimeMs)
  await assert.rejects(stat(join(output, 'completed.json')), { code: 'ENOENT' })
  // A new package under the new expected goes to an explicit new directory.
  const fresh = join(fixture.dir, 'attestation-new')
  const created = await createMigrationAttestationBundle({ ...common, privateOutput: fresh, expected: current, attestationType: 'artifact', evidenceClass: 'automatic-observation', nowMs: 1000002, clockFloorMs: 999999, ttlMs: 60000 })
  assert.equal(created.replayed, false)
  assert.equal(created.status, 'observed')
  assert.equal((await verifyMigrationAttestationBundle({ ...common, privateOutput: fresh, expected: current, nowMs: 1000003, clockFloorMs: 999999 })).status, 'observed')
})

test('attestation concurrency: same-directory requests leave one bundle and one completion record without overwrites', async t => {
  const fixture = await prepared(t)
  const output = join(fixture.dir, 'attestation')
  const options = createOptions(fixture, { privateOutput: output })
  const settled = await Promise.allSettled(Array.from({ length: 4 }, () => createMigrationAttestationBundle(options)))
  const fulfilled = settled.filter(result => result.status === 'fulfilled').map(result => result.value)
  const rejected = settled.filter(result => result.status === 'rejected').map(result => result.reason)
  assert.equal(fulfilled.length >= 1, true)
  for (const error of rejected) assert.equal(error?.code, 'MIGRATION_ATTESTATION_OUTPUT_CONFLICT')
  for (const value of fulfilled) {
    assert.equal(value.status, 'observed')
    assert.deepEqual([value.allowed, value.activationSupported, value.postActivationRollbackSupported, value.stopWriteProvable, value.generationAvailable], [false, false, false, false, false])
  }
  assert.deepEqual([...new Set(fulfilled.map(value => JSON.stringify({ ...value, replayed: false })))].length, 1)
  const names = (await readdir(output)).sort()
  assert.deepEqual(names, ['attestation.private.json', 'completed.json'])
  const bundle = JSON.parse(await readFile(join(output, 'attestation.private.json'), 'utf8'))
  const completion = JSON.parse(await readFile(join(output, 'completed.json'), 'utf8'))
  assert.equal(completion.bundleDigest, bundle.bundleDigest)
  // A conflicting request still refuses to overwrite the persisted package.
  const bytes = await readFile(join(output, 'attestation.private.json'))
  await assert.rejects(createMigrationAttestationBundle(createOptions(fixture, { privateOutput: output, ttlMs: 60001 })), { code: 'MIGRATION_ATTESTATION_REQUEST_CONFLICT' })
  assert.equal((await readFile(join(output, 'attestation.private.json'))).equals(bytes), true)
})

test('attestation money publish: real child exit resumes under the same owner without rewriting', async t => {
  const fixture = await prepared(t, { money: true })
  const output = join(fixture.dir, 'attestation')
  const crashed = await run(request(fixture, { mode: 'crash-after-bundle', attestationType: 'money', privateOutput: output, expected: fixture.expected }))
  assert.equal(crashed.code, 86, crashed.text)
  const file = join(output, 'attestation.private.json')
  const before = await stat(file)
  const bytes = await readFile(file)
  assert.equal(JSON.parse(bytes).payload.coverage, 'captured-marker-ledger-epoch-only')
  await assert.rejects(stat(join(output, 'completed.json')), { code: 'ENOENT' })
  const resumed = await run(request(fixture, { mode: 'resume', attestationType: 'money', privateOutput: output, expected: fixture.expected }))
  assert.equal(resumed.code, 0, resumed.text)
  const result = parse(resumed.text)
  assert.equal(result.verifyFailed, 'MIGRATION_ATTESTATION_OUTPUT_INCOMPLETE')
  assert.equal(result.created.replayed, true)
  assert.equal(result.created.status, 'observed')
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs)
  assert.equal((await readFile(file)).equals(bytes), true)
  const cold = await run(request(fixture, { mode: 'cold-verify', attestationType: 'money', privateOutput: output, expected: fixture.expected }))
  assert.equal(cold.code, 0, cold.text)
  assert.equal(parse(cold.text).verified.status, 'observed')
  assert.equal((await verifyMigrationAttestationBundle({ ...fixture.common, privateOutput: output, expected: fixture.expected, nowMs: 1000001, clockFloorMs: 999999 })).status, 'observed')
})

test('attestation money owner death: old expected and old package fail after a real owner takeover', async t => {
  const fixture = await scenario(t, { holdFence: false, money: true })
  const output = join(fixture.dir, 'attestation-old')
  const expectedFile = join(fixture.dir, 'old-expected.json')
  const died = await run(request(fixture, { mode: 'owner-die', attestationType: 'money', privateOutput: output, expectedFile }))
  assert.equal(died.code, 86, died.text)
  const oldExpected = JSON.parse(await readFile(expectedFile, 'utf8'))
  const oldBytes = await readFile(join(output, 'attestation.private.json'))
  const oldStat = await stat(join(output, 'attestation.private.json'))
  const fence = await beginMigrationExclusive(fixture.home, { operationId: fixture.operationId, drainTimeoutMs: 5000, pollMs: 20 })
  t.after(() => fence.release().catch(() => {}))
  const common = { ...fixture.common, assertExclusive: () => fence.verify() }
  const current = await observeMigrationAttestationContext(common)
  await assert.rejects(verifyMigrationAttestationBundle({ ...common, privateOutput: output, expected: oldExpected, nowMs: 1000001, clockFloorMs: 999999 }), { code: 'MIGRATION_ATTESTATION_BINDING_MISMATCH' })
  await assert.rejects(createMigrationAttestationBundle({ ...common, privateOutput: output, expected: oldExpected, attestationType: 'money', evidenceClass: 'automatic-observation', nowMs: 1000001, clockFloorMs: 999999, ttlMs: 60000 }), { code: 'MIGRATION_ATTESTATION_BINDING_MISMATCH' })
  await assert.rejects(createMigrationAttestationBundle({ ...common, privateOutput: output, expected: current, attestationType: 'money', evidenceClass: 'automatic-observation', nowMs: 1000001, clockFloorMs: 999999, ttlMs: 60000 }), { code: 'MIGRATION_ATTESTATION_BINDING_MISMATCH' })
  assert.equal((await readFile(join(output, 'attestation.private.json'))).equals(oldBytes), true)
  assert.equal((await stat(join(output, 'attestation.private.json'))).mtimeMs, oldStat.mtimeMs)
  await assert.rejects(stat(join(output, 'completed.json')), { code: 'ENOENT' })
  const fresh = join(fixture.dir, 'attestation-new')
  const created = await createMigrationAttestationBundle({ ...common, privateOutput: fresh, expected: current, attestationType: 'money', evidenceClass: 'automatic-observation', nowMs: 1000002, clockFloorMs: 999999, ttlMs: 60000 })
  assert.equal(created.status, 'observed')
  assert.equal(created.replayed, false)
  assert.equal((await verifyMigrationAttestationBundle({ ...common, privateOutput: fresh, expected: current, nowMs: 1000003, clockFloorMs: 999999 })).status, 'observed')
})
