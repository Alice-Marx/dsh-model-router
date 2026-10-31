import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { previewProfileMigration } from '../packages/orchestration/src/profile-migration-plan.mjs'
import { inspectMigrationSources } from '../packages/orchestration/src/migration-snapshot.mjs'
import { abandonMigrationIntent, acquireMigrationShared, beginMigrationExclusive, readMigrationFence } from '../packages/orchestration/src/migration-fence.mjs'
import { readMigrationStartupGate } from '../packages/orchestration/src/migration-startup-gate.mjs'
import { inspectMigrationConfigurationCommit, resumeMigrationConfigurationCommit } from '../packages/orchestration/src/migration-configuration-commit.mjs'
import {
  beginMigrationCommitOperation as beginOperation,
  inspectMigrationCommitOperation,
  resumeMigrationCommitOperation as resumeOperation,
} from '../packages/orchestration/src/migration-commit-orchestration.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CWD = resolve('.')
const PRODUCT = '@ljwei-stak/dsh-model-router'
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'migration-commit-orchestration-crash.mjs')
const parent = resolve('tmp/integration/migration-commit-orchestration')
await mkdir(parent, { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value) + '\n'
const begin = beginOperation
const resume = resumeOperation

async function scenario (t) {
  const dir = await mkdtemp(join(parent, 'crash-'))
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
  const changes = [{
    path: join(profile, 'package.json'),
    beforeSha256: sha(Buffer.from(profilePackage)),
    maintenance: Buffer.from(json({ dsh: { profile: { bundles: [base.packageName] } } })),
    after: Buffer.from(json({ dsh: { profile: { bundles: [target.packageName] } } })),
  }]
  const fixture = {
    dir, home, profile, plan, inventory, database, dbFile, changes,
    operationId: randomUUID(),
    domains: [{ name: 'bot', roots: [bot] }, { name: 'sessions', roots: [sessions] }],
    privateOutput: join(dir, 'owner-private'),
    dataArchiveRoot: join(dir, 'capture-data'),
    ledgerArchiveRoot: join(dir, 'capture-ledger'),
    commitOutput: join(dir, 'commit-private'),
    flag: join(dir, 'release.flag'),
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
  return fixture
}

async function payloadFor (f, options) {
  const path = join(f.dir, 'payload-' + randomUUID() + '.json')
  await writeFile(path, JSON.stringify({
    mode: options.mode,
    home: f.home, operationId: f.operationId, privateOutput: f.privateOutput, domains: f.domains,
    configurationPlan: f.plan, inventory: f.inventory,
    dataArchiveRoot: f.dataArchiveRoot, ledgerArchiveRoot: f.ledgerArchiveRoot, commitOutput: f.commitOutput,
    dbFile: f.dbFile,
    changes: f.changes.map(change => ({ path: change.path, beforeSha256: change.beforeSha256, maintenanceB64: change.maintenance.toString('base64'), afterB64: change.after.toString('base64') })),
    drainTimeoutMs: options.drainTimeoutMs ?? 5000,
    crashAt: options.crashAt ?? null,
    commitBoundary: options.commitBoundary ?? null,
    holdMs: options.holdMs ?? 0,
  }))
  return path
}

async function crash (f, options = {}) {
  const mode = options.mode ?? 'begin'
  const payload = await payloadFor(f, { ...options, mode })
  const result = spawnSync(process.execPath, [FIXTURE, mode, payload], { cwd: CWD, encoding: 'utf8', windowsHide: true, timeout: 60000 })
  assert.equal(result.status, 86, 'crash injection must exit after the boundary: ' + (result.stderr ?? ''))
}

async function holder (t, mode, f, operationId) {
  const child = spawn(process.execPath, [FIXTURE, mode, f.home, f.flag, operationId ?? ''], { cwd: CWD, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let failure = null
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { failure = (failure ?? '') + chunk })
  await new Promise((resolveHeld, rejectHeld) => {
    const timer = setTimeout(() => rejectHeld(new Error('holder did not start: ' + output + (failure ?? ''))), 30000)
    const poll = setInterval(() => {
      if (output.includes('HELD')) { clearInterval(poll); clearTimeout(timer); resolveHeld() }
    }, 20)
    child.on('exit', code => { clearInterval(poll); clearTimeout(timer); rejectHeld(new Error('holder exited early ' + code + ' ' + (failure ?? ''))) })
  })
  t.after(() => child.kill())
  return {
    child,
    async release () {
      await writeFile(f.flag, 'release')
      await new Promise(resolveExit => child.on('exit', resolveExit))
    },
  }
}

const steps = async f => (await inspectMigrationCommitOperation({ privateOutput: f.privateOutput })).journal.map(row => row.step)
const stateOf = async f => (await inspectMigrationCommitOperation({ privateOutput: f.privateOutput }))

test('crash 1: an operation record without the first step replays a read-only inspect and creates no fence', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'operation-written' })
  const after = await stateOf(f)
  assert.deepEqual(after.journal, [])
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, false)
  class Pause extends Error {}
  await assert.rejects(resume(f.input({ onBoundary: async ({ point }) => { if (point === 'after-step:plan-recorded') throw new Pause('pause') } })), error => error instanceof Pause)
  assert.deepEqual(await steps(f), ['plan-recorded'])
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, false)
  assert.equal(readMigrationStartupGate({ home: f.home }), null)
  assert.equal((await resume(f.input())).status, 'blocked-activation')
})

test('crash 2: after fence-intent-requested the intent is replayed, never released', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:fence-intent-requested' })
  assert.deepEqual(await steps(f), ['plan-recorded', 'fence-intent-requested'])
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, false)
  assert.equal((await resume(f.input())).status, 'blocked-activation')
  assert.ok((await steps(f)).includes('fence-intent-persisted'))
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
})

test('crash 3: after the exclusive was taken but before drain-started the intent survives and resume re-drains', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'fence-acquired' })
  const fence = await readMigrationFence(f.home)
  assert.equal(fence.maintenanceActive, true)
  assert.notEqual(fence.intent, null)
  assert.deepEqual(await steps(f), ['plan-recorded', 'fence-intent-requested'])
  assert.equal((await resume(f.input())).status, 'blocked-activation')
  const drained = (await stateOf(f)).journal.filter(row => row.step === 'drain-completed')
  assert.equal(drained.length, 1)
  assert.equal(drained[0].evidence.liveShared, 0)
  assert.equal((await readMigrationFence(f.home)).intent.operationId, f.operationId)
})

test('crash 4: a live shared holder stops the drain and the next owner re-drains instead of reusing the observation', async t => {
  const f = await scenario(t)
  const shared = await holder(t, 'hold-shared', f)
  const timedOut = await (async () => { try { await begin(f.input({ limits: { drainTimeoutMs: 300, pollMs: 20 } })) } catch (error) { return error } })()
  assert.equal(timedOut.code, 'MIGRATION_FENCE_DRAIN_TIMEOUT')
  const blocked = await stateOf(f)
  assert.equal(blocked.summary.status, 'blocked-drain')
  assert.ok(blocked.journal.at(-1).evidence.observedHolders >= 1)
  const held = await readMigrationFence(f.home)
  assert.equal(held.maintenanceActive, true)
  assert.equal(held.exclusive, null)
  await shared.release()
  assert.equal((await resume(f.input())).status, 'blocked-activation')
  const drained = (await stateOf(f)).journal.filter(row => row.step === 'drain-completed').at(-1)
  assert.equal(drained.evidence.observedHolders, 0)
  assert.equal(drained.evidence.liveShared, 0)
})

test('crash 5: after exclusive-acquired the capture is replayed into fresh private directories', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:exclusive-acquired' })
  await assert.rejects(stat(f.dataArchiveRoot), { code: 'ENOENT' })
  assert.equal((await resume(f.input())).status, 'blocked-activation')
  assert.ok((await steps(f)).includes('capture-verified'))
  assert.equal((await stat(join(f.dataArchiveRoot, 'capture.private.json'))).isFile(), true)
  assert.equal((await stat(join(f.ledgerArchiveRoot, 'archive.private.json'))).isFile(), true)
})

test('crash 6: a half-written capture directory blocks instead of entering maintenance', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:capture-started' })
  await mkdir(f.dataArchiveRoot)
  await writeFile(join(f.dataArchiveRoot, 'stray.txt'), 'STRAY')
  const blocked = await (async () => { try { await resume(f.input()) } catch (error) { return error } })()
  assert.match(blocked.code, /^(MIGRATION_(PRIVATE|CAPTURE)_|EEXIST)$/)
  const after = await stateOf(f)
  assert.equal(after.summary.status, 'blocked-capture')
  assert.ok(!after.journal.some(row => row.step === 'maintenance-started'))
  assert.equal(readMigrationStartupGate({ home: f.home }), null)
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
})

test('crash 7: after capture-verified the maintenance replay leaves the gate non-terminal', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:capture-verified' })
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
  assert.equal(readMigrationStartupGate({ home: f.home }), null)
  assert.equal((await resume(f.input())).status, 'blocked-activation')
  const gate = readMigrationStartupGate({ home: f.home })
  assert.equal(gate.phase, 'maintenance')
  assert.notEqual(gate.phase, 'committed')
})

test('crash 8: every configuration transaction boundary recovers without a half activation', async t => {
  for (const boundary of ['phase', 'intent', 'before-retire', 'retired', 'linked', 'published', 'written', 'phase-complete']) {
    const f = await scenario(t)
    await crash(f, { commitBoundary: boundary })
    assert.notEqual(readMigrationStartupGate({ home: f.home })?.phase ?? 'none', 'committed', boundary)
    assert.equal((await resume(f.input())).status, 'blocked-activation', boundary)
    const inspect = await inspectMigrationConfigurationCommit({ privateOutput: f.commitOutput })
    assert.equal(inspect.recognized, true, boundary)
    assert.equal(readMigrationStartupGate({ home: f.home }).phase, 'maintenance', boundary)
  }
})

test('crash 9: after activation-evaluated the evaluation replays and is still refused', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:activation-evaluated' })
  assert.ok((await steps(f)).includes('activation-evaluated'))
  assert.ok(!(await steps(f)).includes('activation-refused'))
  const summary = await resume(f.input())
  assert.equal(summary.status, 'blocked-activation')
  assert.ok((await steps(f)).includes('activation-refused'))
  assert.equal(readMigrationStartupGate({ home: f.home }).phase, 'maintenance')
})

test('crash 10: after release-requested the release replays with recomputed preconditions', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:activation-refused' })
  await resumeMigrationConfigurationCommit({ privateOutput: f.commitOutput, phase: 'install', recover: true })
  await resumeMigrationConfigurationCommit({ privateOutput: f.commitOutput, phase: 'rollback', recover: true })
  await crash(f, { mode: 'resume', crashAt: 'after-step:release-requested' })
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, true)
  assert.ok(!(await steps(f)).includes('released'))
  const summary = await resume(f.input())
  assert.equal(summary.status, 'released')
  assert.equal(summary.released, true)
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, false)
})

test('crash 11: after fence.release() the released record is appended from observation', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:activation-refused' })
  await resumeMigrationConfigurationCommit({ privateOutput: f.commitOutput, phase: 'install', recover: true })
  await resumeMigrationConfigurationCommit({ privateOutput: f.commitOutput, phase: 'rollback', recover: true })
  await crash(f, { mode: 'resume', crashAt: 'release-done' })
  const crashed = await readMigrationFence(f.home)
  assert.equal(crashed.maintenanceActive, false)
  assert.equal(crashed.intent, null)
  assert.equal(crashed.exclusive, null)
  assert.ok(!(await steps(f)).includes('released'))
  const summary = await resume(f.input())
  assert.equal(summary.status, 'released')
  assert.equal((await stateOf(f)).journal.at(-1).evidence.observed, true)
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, false)
})

test('case 16: a half-written intent fails closed for admission and for the orchestration', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'fence-acquired' })
  const intent = join(f.home, 'fence', 'intent.json')
  const bytes = await readFile(intent)
  await writeFile(intent, bytes.subarray(0, 24))
  await assert.rejects(acquireMigrationShared(f.home), { code: 'MIGRATION_FENCE_INTENT_UNREADABLE' })
  await assert.rejects(resume(f.input()), { code: 'MIGRATION_FENCE_INTENT_UNREADABLE' })
  const after = await stateOf(f)
  assert.equal(after.summary.status, 'blocked-owner')
  assert.equal(after.journal.at(-1).evidence.reason, 'intent-unreadable')
  assert.equal(after.summary.activationSupported, false)
})

test('case 17: two recoveries of one operation id - only the live owner advances', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:exclusive-acquired' })
  const owner = await holder(t, 'hold-exclusive', f, f.operationId)
  await assert.rejects(resume(f.input()), { code: 'MIGRATION_ORCH_OWNER_UNCERTAIN' })
  const blocked = await stateOf(f)
  assert.equal(blocked.summary.status, 'blocked-capture')
  assert.equal(blocked.journal.at(-1).evidence.reason, 'owner-conflict')
  await owner.release()
  assert.equal((await resume(f.input())).status, 'blocked-activation')
})

test('case 20: a drain timeout leaves no handle, and a stale handle cannot release the fence', async t => {
  const f = await scenario(t)
  const shared = await holder(t, 'hold-shared', f)
  const timedOut = await (async () => { try { await begin(f.input({ limits: { drainTimeoutMs: 300, pollMs: 20 } })) } catch (error) { return error } })()
  assert.equal(timedOut.code, 'MIGRATION_FENCE_DRAIN_TIMEOUT')
  const stuck = await readMigrationFence(f.home)
  assert.notEqual(stuck.intent, null)
  assert.equal(stuck.exclusive, null)
  assert.equal(stuck.maintenanceActive, true)
  await shared.release()
  const abandoned = await abandonMigrationIntent(f.home, { operationId: f.operationId, reason: 'drain-timeout', evidence: { observedHolders: 1 } })
  assert.equal(abandoned.operationId, f.operationId)
  assert.equal((await readMigrationFence(f.home)).maintenanceActive, false)

  const g = await scenario(t)
  const handle = await beginMigrationExclusive(g.home, { operationId: g.operationId })
  await unlink(join(g.home, 'fence', 'exclusive.json'))
  await assert.rejects(handle.release(), { code: 'MIGRATION_FENCE_NOT_HELD' })
  assert.notEqual((await readMigrationFence(g.home)).intent, null)
})

test('N1: the maintenance stage refuses to run without a held exclusive', async t => {
  const f = await scenario(t)
  await crash(f, { crashAt: 'after-step:capture-verified' })
  const owner = await holder(t, 'hold-exclusive', f, f.operationId)
  await assert.rejects(resume(f.input()), { code: 'MIGRATION_ORCH_OWNER_UNCERTAIN' })
  const blocked = await stateOf(f)
  assert.equal(blocked.summary.status, 'blocked-maintenance')
  assert.equal(blocked.next, 'maintenance')
  assert.equal(readMigrationStartupGate({ home: f.home }), null)
  await assert.rejects(stat(f.commitOutput), { code: 'ENOENT' })
  assert.deepEqual(await readFile(f.changes[0].path), Buffer.from(json({ dsh: { profile: { bundles: ['@fixture/base', PRODUCT] } } })))
  await owner.release()
  assert.equal((await resume(f.input())).status, 'blocked-activation')
})
