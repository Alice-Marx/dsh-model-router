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
import { reconcileMigrationRemoteFileEffect } from '../packages/orchestration/src/migration-remote-file-reconciliation.mjs'
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
    remoteClients: options.remoteClients ?? [],
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

test('crash 12: remote revoke requested crashes before capture and resume completes the same drain', async t => {
  const f = await scenario(t), remoteClients = [{ configPath: join(f.dir, 'agent-config.json'), machineId: 'machine-a', clientId: 'host' }]
  await crash(f, { crashAt: 'after-step:remote-revoke-requested', remoteClients })
  const interrupted = await stateOf(f)
  assert.deepEqual(interrupted.journal.map(row => row.step).slice(-2), ['exclusive-acquired', 'remote-revoke-requested'])
  assert.equal(interrupted.journal.some(row => row.step === 'capture-started'), false)
  assert.equal(readMigrationStartupGate({ home: f.home }), null)
  let calls = 0
  const remoteClientQuarantine = async ({ clients }) => {
    calls++
    return { declaredCredentialAdmissionBlocked: true, persistentDeclaredExclusion: true, clients: clients.map(client => ({ ...client, revoked: true })) }
  }
  assert.equal((await resume(f.input({ remoteClients, remoteClientQuarantine, remoteOperationDrain: async ({ clients }) => ({ declaredOperationsSettled: true, clients: clients.map(client => ({ ...client, operations: 0, settled: true })) }) }))).status, 'blocked-activation')
  assert.equal(calls, 1)
  const recovered = await steps(f)
  assert.equal(recovered.filter(step => step === 'remote-revoke-requested').length, 1)
  assert.equal(recovered.filter(step => step === 'remote-revoke-completed').length, 1)
  assert.ok(recovered.indexOf('remote-revoke-completed') < recovered.indexOf('capture-started'))
})

test('orchestration drain: the default adapter revokes a real Agent before capture', async t => {
  await import('../remote-computer-agent/build.mjs')
  const f = await scenario(t), agentDir = join(f.dir, 'remote-agent'), project = join(agentDir, 'project')
  await mkdir(project, { recursive: true })
  const readyFile = join(agentDir, 'agent-ready.json')
  const child = spawn(process.execPath, [resolve('tests/fixtures/migration-remote-effect-agent.mjs'), agentDir, readyFile], { cwd: agentDir, stdio: 'ignore', windowsHide: true })
  t.after(() => child.kill())
  let agent
  for (let attempt = 0; attempt < 600; attempt++) {
    agent = await readFile(readyFile, 'utf8').then(value => JSON.parse(value)).catch(() => null)
    if (agent) break
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  assert.ok(agent, 'the real Agent becomes ready')
  const configPath = join(agentDir, 'agent-config.json')
  await writeFile(configPath, JSON.stringify({ dataDir: join(agentDir, 'agent') }))
  const summary = await begin(f.input({
    remoteClients: [{ configPath, machineId: agent.machineId, clientId: 'host' }],
    remoteClientCli: resolve('remote-computer-agent/dist/cli.mjs'),
    remoteClientRuntime: process.execPath,
  }))
  assert.equal(summary.status, 'blocked-activation')
  assert.equal(summary.steps, 16)
  const db = new Database(join(agentDir, 'agent/agent.sqlite'), { readonly: true })
  try { assert.equal(db.prepare('SELECT revoked FROM clients WHERE id=?').get('host').revoked, 1) } finally { db.close() }
  const names = await steps(f)
  assert.ok(names.indexOf('remote-operation-drain-completed') < names.indexOf('capture-started'))
})

test('crash 13: remote operation drain requested crashes before capture and resume rechecks the same operations', async t => {
  const f = await scenario(t), remoteClients = [{ configPath: join(f.dir, 'agent-config.json'), machineId: 'machine-a', clientId: 'host' }]
  await crash(f, { crashAt: 'after-step:remote-operation-drain-requested', remoteClients })
  const interrupted = await stateOf(f)
  assert.equal(interrupted.journal.at(-1).step, 'remote-operation-drain-requested')
  assert.equal(interrupted.journal.some(row => row.step === 'capture-started'), false)
  let calls = 0
  const remoteOperationDrain = async ({ clients }) => {
    calls++
    return { declaredOperationsSettled: true, clients: clients.map(client => ({ ...client, operations: 0, settled: true })) }
  }
  const remoteClientQuarantine = async ({ clients }) => ({ declaredCredentialAdmissionBlocked: true, persistentDeclaredExclusion: true, clients: clients.map(client => ({ ...client, revoked: true })) })
  assert.equal((await resume(f.input({ remoteClients, remoteClientQuarantine, remoteOperationDrain }))).status, 'blocked-activation')
  assert.equal(calls, 1)
  const recovered = await steps(f)
  assert.equal(recovered.filter(step => step === 'remote-operation-drain-requested').length, 1)
  assert.equal(recovered.filter(step => step === 'remote-operation-drain-completed').length, 1)
  assert.ok(recovered.indexOf('remote-operation-drain-completed') < recovered.indexOf('capture-started'))
})

test('orchestration drain: a real landed file with a running receipt blocks capture until the original operation succeeds', async t => {
  await import('../remote-computer-agent/build.mjs')
  const f = await scenario(t), agentDir = join(f.dir, 'slow-agent'), project = join(agentDir, 'project')
  await mkdir(project, { recursive: true })
  const waitValue = async fn => {
    for (let attempt = 0; attempt < 600; attempt++) {
      const value = await fn()
      if (value) return value
      await new Promise(resolveWait => setTimeout(resolveWait, 25))
    }
    throw new Error('slow physical effect did not reach the expected state')
  }
  const jsonFile = path => readFile(path, 'utf8').then(value => JSON.parse(value)).catch(() => null)
  const agentReady = join(agentDir, 'agent-ready.json')
  const agent = spawn(process.execPath, [resolve('tests/fixtures/migration-remote-slow-effect-agent.mjs'), agentDir, agentReady], { cwd: agentDir, stdio: 'ignore', windowsHide: true })
  t.after(() => agent.kill())
  const started = await waitValue(() => jsonFile(agentReady))
  const configPath = join(agentDir, 'agent-config.json')
  await writeFile(configPath, JSON.stringify({ dataDir: join(agentDir, 'agent') }))
  const outsideDir = join(f.dir, 'slow-host'), receiptFile = join(f.dir, 'slow-receipt.json')
  const outside = spawn(process.execPath, [resolve('tests/fixtures/migration-remote-effect-outside-writer.mjs'), outsideDir, agentReady, receiptFile, 'slow.txt', 'slow physical effect\n'], { cwd: f.dir, stdio: 'ignore', windowsHide: true })
  t.after(() => outside.kill())
  await waitValue(() => jsonFile(join(agentDir, 'effect-landed.json')))
  assert.equal(await readFile(join(project, 'slow.txt'), 'utf8'), 'slow physical effect\n')
  const operationBefore = new Database(join(agentDir, 'agent/agent.sqlite'), { readonly: true })
  const running = operationBefore.prepare('SELECT id,status FROM operations').all()
  operationBefore.close()
  assert.equal(running.length, 1)
  assert.equal(running[0].status, 'running')

  const input = () => f.input({ remoteClients: [{ configPath, machineId: started.machineId, clientId: 'host' }], remoteClientCli: resolve('remote-computer-agent/dist/cli.mjs'), remoteClientRuntime: process.execPath })
  await assert.rejects(begin(input()), { code: 'MIGRATION_REMOTE_OPERATION_ACTIVE' })
  const blocked = await stateOf(f)
  assert.equal(blocked.summary.status, 'blocked-drain')
  assert.equal(blocked.journal.some(row => row.step === 'capture-started'), false)
  assert.equal(await readFile(join(project, 'slow.txt'), 'utf8'), 'slow physical effect\n', 'the real effect is present while its original receipt is still running')

  await writeFile(join(agentDir, 'release-effect'), 'release')
  const receipt = await waitValue(() => jsonFile(receiptFile))
  assert.equal(receipt.state, 'succeeded')
  const operationAfter = new Database(join(agentDir, 'agent/agent.sqlite'), { readonly: true })
  const terminal = operationAfter.prepare('SELECT id,status FROM operations WHERE id=?').get(receipt.operationId)
  operationAfter.close()
  assert.equal(terminal.status, 'succeeded')
  assert.equal((await resume(input())).status, 'blocked-activation')
  const recovered = await steps(f)
  assert.equal(recovered.filter(step => step === 'remote-operation-drain-requested').length, 1)
  assert.equal(recovered.filter(step => step === 'remote-operation-drain-completed').length, 1)
  assert.ok(recovered.indexOf('remote-operation-drain-completed') < recovered.indexOf('capture-started'))
})

test('orchestration drain: a real crashed Agent leaves a landed file unknown and never auto-resolves it into capture', async t => {
  await import('../remote-computer-agent/build.mjs')
  const f = await scenario(t), agentDir = join(f.dir, 'crash-agent'), project = join(agentDir, 'project')
  await mkdir(project, { recursive: true })
  const waitValue = async fn => {
    for (let attempt = 0; attempt < 600; attempt++) {
      const value = await fn()
      if (value) return value
      await new Promise(resolveWait => setTimeout(resolveWait, 25))
    }
    throw new Error('crashed physical effect did not reach the expected state')
  }
  const jsonFile = path => readFile(path, 'utf8').then(value => JSON.parse(value)).catch(() => null)
  const agentReady = join(agentDir, 'agent-ready.json')
  const agent = spawn(process.execPath, [resolve('tests/fixtures/migration-remote-slow-effect-agent.mjs'), agentDir, agentReady], { cwd: agentDir, stdio: 'ignore', windowsHide: true })
  t.after(() => agent.kill())
  const started = await waitValue(() => jsonFile(agentReady))
  const configPath = join(agentDir, 'agent-config.json')
  await writeFile(configPath, JSON.stringify({ dataDir: join(agentDir, 'agent') }))
  const outsideDir = join(f.dir, 'crash-host'), receiptFile = join(f.dir, 'crash-receipt.json')
  const outside = spawn(process.execPath, [resolve('tests/fixtures/migration-remote-effect-outside-writer.mjs'), outsideDir, agentReady, receiptFile, 'slow.txt', 'unknown physical effect\n'], { cwd: f.dir, stdio: 'ignore', windowsHide: true })
  t.after(() => outside.kill())
  await waitValue(() => jsonFile(join(agentDir, 'effect-landed.json')))
  assert.equal(await readFile(join(project, 'slow.txt'), 'utf8'), 'unknown physical effect\n')
  const agentExited = new Promise(resolveExit => agent.once('close', resolveExit)), outsideExited = new Promise(resolveExit => outside.once('close', resolveExit))
  agent.kill('SIGKILL')
  outside.kill('SIGKILL')
  await Promise.all([agentExited, outsideExited])

  const restartedReadyFile = join(agentDir, 'agent-restarted.json')
  const restarted = spawn(process.execPath, [resolve('tests/fixtures/migration-remote-restart-agent.mjs'), agentDir, restartedReadyFile], { cwd: agentDir, stdio: 'ignore', windowsHide: true })
  t.after(() => restarted.kill())
  const restartedIdentity = await waitValue(() => jsonFile(restartedReadyFile))
  assert.equal(restartedIdentity.machineId, started.machineId)
  const recoveredDb = new Database(join(agentDir, 'agent/agent.sqlite'), { readonly: true })
  const operation = recoveredDb.prepare('SELECT id,status,result,error FROM operations').get()
  recoveredDb.close()
  assert.equal(operation.status, 'unknown')
  assert.equal(operation.error, 'OUTCOME_UNKNOWN')
  assert.equal(operation.result, null)

  const input = () => f.input({ remoteClients: [{ configPath, machineId: started.machineId, clientId: 'host' }], remoteClientCli: resolve('remote-computer-agent/dist/cli.mjs'), remoteClientRuntime: process.execPath })
  await assert.rejects(begin(input()), { code: 'MIGRATION_REMOTE_OPERATION_UNRESOLVED' })
  const blocked = await stateOf(f)
  assert.equal(blocked.summary.status, 'blocked-drain')
  assert.equal(blocked.journal.some(row => row.step === 'capture-started'), false)
  assert.equal(blocked.journal.some(row => row.step === 'remote-operation-drain-completed'), false)
  assert.equal(await readFile(join(project, 'slow.txt'), 'utf8'), 'unknown physical effect\n')
  const count = blocked.journal.length
  await assert.rejects(resume(input()), { code: 'MIGRATION_REMOTE_OPERATION_UNRESOLVED' })
  const repeated = await stateOf(f)
  assert.equal(repeated.journal.length, count, 'repeating the same unresolved verdict does not rewrite or extend the chain')
  assert.equal(repeated.journal.some(row => row.step === 'capture-started'), false)
  const finalDb = new Database(join(agentDir, 'agent/agent.sqlite'), { readonly: true })
  const unresolved = finalDb.prepare('SELECT status,context FROM operations WHERE id=?').get(operation.id)
  assert.equal(unresolved.status, 'unknown')
  finalDb.close()
  const context = JSON.parse(unresolved.context)
  const resolution = await reconcileMigrationRemoteFileEffect({
    Database,
    client: { configPath, machineId: started.machineId, clientId: 'host' },
    operationId: operation.id,
    botId: context.botId,
    taskId: context.taskId,
    attemptId: context.attemptId,
    args: { rootId: 'project.v1', relativePath: 'slow.txt', content: 'unknown physical effect\n', encoding: 'utf8', expectedHash: null },
    rootPath: project,
  })
  assert.equal(resolution.resolved, true)
  assert.equal(resolution.originalOperationStatus, 'unknown')
  assert.equal((await resume(input())).status, 'blocked-activation')
  const settled = await steps(f)
  assert.ok(settled.indexOf('remote-operation-drain-completed') < settled.indexOf('capture-started'))
  const resolvedDb = new Database(join(agentDir, 'agent/agent.sqlite'), { readonly: true })
  assert.equal(resolvedDb.prepare('SELECT status FROM operations WHERE id=?').get(operation.id).status, 'unknown', 'reconciliation adds separate proof rather than forging an Agent success')
  assert.equal(resolvedDb.prepare('SELECT operation_id FROM migration_operation_resolutions WHERE operation_id=?').get(operation.id).operation_id, operation.id)
  resolvedDb.close()
})
