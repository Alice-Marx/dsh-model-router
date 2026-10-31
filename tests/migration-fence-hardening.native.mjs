import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { abandonMigrationIntent, acquireMigrationShared, beginMigrationExclusive, readMigrationFence } from '../packages/orchestration/src/migration-fence.mjs'
import { prepareMigrationConfigurationCommit as prepare, resumeMigrationConfigurationCommit as resume } from '../packages/orchestration/src/migration-configuration-commit.mjs'
import { readMigrationStartupGate } from '../packages/orchestration/src/migration-startup-gate.mjs'

// Hardening wave: atomic fence records, strict parsing (fail-closed), owner
// tokens, evidence-backed intent abandonment and one operation id for
// fence/plan/gate. Real child processes are used wherever liveness is the point.
const parent = resolve('tmp/integration/migration-fence-hardening'); await mkdir(parent, { recursive: true })
const fenceModule = pathToFileURL(resolve('packages/orchestration/src/migration-fence.mjs')).href
const holder = resolve('tests/fixtures/migration-fence-holder.mjs')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const exited = child => child.exitCode !== null || child.signalCode !== null
  ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  : new Promise(done => child.once('exit', (code, signal) => done({ code, signal })))
// Same waiting rule as tests/migration-fence.native.mjs: a zero-byte file is an
// in-flight writeFile, never the fixture's answer.
const waitFile = async (path, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const text = await readFile(path, 'utf8').catch(() => '')
    if (text.trim().length > 0) return text
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('fixture did not reach the expected state')
}
function spawnModule(t, script) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  return { child, output: () => stderr }
}

test('fence hardening: a truncated intent never reads as an absent maintenance state', async () => {
  const home = await mkdtemp(join(parent, 'case-'))
  await mkdir(join(home, 'fence'), { recursive: true })
  const bytes = '{"schemaVersion":1,"operationId":"op-half'
  await writeFile(join(home, 'fence', 'intent.json'), bytes)
  await assert.rejects(acquireMigrationShared(home), { code: 'MIGRATION_FENCE_INTENT_UNREADABLE' })
  await assert.rejects(readMigrationFence(home), { code: 'MIGRATION_FENCE_INTENT_UNREADABLE' })
  await assert.rejects(beginMigrationExclusive(home, { operationId: 'op-half' }), { code: 'MIGRATION_FENCE_INTENT_UNREADABLE' })
  await assert.rejects(abandonMigrationIntent(home, { operationId: 'op-half', reason: 'takeover', evidence: { observed: 'unreadable-intent' } }), { code: 'MIGRATION_FENCE_INTENT_UNREADABLE' })
  assert.equal(await readFile(join(home, 'fence', 'intent.json'), 'utf8'), bytes, 'the damaged bytes are preserved for a human, never rewritten')
})

test('fence hardening: a truncated exclusive is reported truthfully, not as absent', async () => {
  const home = await mkdtemp(join(parent, 'case-'))
  await mkdir(join(home, 'fence'), { recursive: true })
  await writeFile(join(home, 'fence', 'intent.json'), JSON.stringify({ schemaVersion: 1, operationId: 'op-excl', ownerToken: 'other', pid: 2147483646, startTicks: null, createdAt: 1 }))
  await writeFile(join(home, 'fence', 'exclusive.json'), '{"schemaVersion":1,"operationId":"op-ex')
  await assert.rejects(acquireMigrationShared(home), { code: 'MIGRATION_FENCE_EXCLUSIVE_UNREADABLE' })
  await assert.rejects(readMigrationFence(home), { code: 'MIGRATION_FENCE_EXCLUSIVE_UNREADABLE' })
  await assert.rejects(beginMigrationExclusive(home, { operationId: 'op-excl' }), { code: 'MIGRATION_FENCE_EXCLUSIVE_UNREADABLE' })
})

test('fence hardening: one operation id has exactly one owner and the loser cannot release', async () => {
  const home = await mkdtemp(join(parent, 'case-'))
  const first = await beginMigrationExclusive(home, { operationId: 'op-owner' })
  const second = await beginMigrationExclusive(home, { operationId: 'op-owner' })
  assert.equal(await first.verify(), false, 'the overwritten handle no longer owns the fence')
  assert.equal(await second.verify(), true, 'only one owner verifies for one operation id')
  await assert.rejects(first.release(), { code: 'MIGRATION_FENCE_OWNER_LOST' })
  const held = await readMigrationFence(home)
  assert.equal(held.maintenanceActive, true, 'the refused release kept the fence')
  assert.equal(held.exclusive.operationId, 'op-owner')
  assert.equal(held.exclusive.ownerToken, undefined, 'the owner token is a capability and is never republished')
  await second.release()
  const freed = await readMigrationFence(home)
  assert.equal(freed.maintenanceActive, false)
  assert.equal(await second.verify(), false)
})

test('fence hardening: two live processes sharing an operation id — one owner, the other refused', async t => {
  const home = await mkdtemp(join(parent, 'case-'))
  const ready = join(home, 'ready-owner')
  const { child, output } = spawnModule(t, `
    import(${JSON.stringify(fenceModule)}).then(async ({ beginMigrationExclusive }) => {
      const fence = await beginMigrationExclusive(${JSON.stringify(home)}, { operationId: 'op-shared-id' })
      const fs = await import('node:fs/promises')
      await fs.writeFile(${JSON.stringify(ready)}, String(await fence.verify()))
      setInterval(() => {}, 1000)
    }).catch(error => { console.error(error.code ?? error.message); process.exit(1) })
  `)
  const seen = await waitFile(ready).catch(error => { throw new Error(`${error.message} | child stderr: ${output()}`) })
  assert.equal(seen, 'true', 'the first process owns and verifies the fence')
  await assert.rejects(beginMigrationExclusive(home, { operationId: 'op-shared-id' }), { code: 'MIGRATION_FENCE_OWNER_CONFLICT' })
  assert.equal((await readMigrationFence(home)).exclusive.operationId, 'op-shared-id', 'the live owner keeps its claim')
  child.kill('SIGKILL'); await exited(child)
  const takeover = await beginMigrationExclusive(home, { operationId: 'op-shared-id' })
  assert.equal(await takeover.verify(), true, 'a verifiably dead owner is still taken over')
  await takeover.release()
})

test('fence hardening: release still requires both the intent and the exclusive record', async () => {
  const one = await mkdtemp(join(parent, 'case-'))
  const first = await beginMigrationExclusive(one, { operationId: 'op-release-intent' })
  await unlink(join(one, 'fence', 'intent.json'))
  await assert.rejects(first.release(), { code: 'MIGRATION_FENCE_NOT_HELD' })
  assert.equal((await readMigrationFence(one)).exclusive.operationId, 'op-release-intent', 'a refused release removes nothing')
  const two = await mkdtemp(join(parent, 'case-'))
  const second = await beginMigrationExclusive(two, { operationId: 'op-release-exclusive' })
  await unlink(join(two, 'fence', 'exclusive.json'))
  await assert.rejects(second.release(), { code: 'MIGRATION_FENCE_NOT_HELD' })
  assert.equal((await readMigrationFence(two)).maintenanceActive, true, 'the stranded intent is not deleted by a refused release')
})

test('fence hardening: a drain timeout is cleared only by evidence-backed abandonment', async t => {
  const home = await mkdtemp(join(parent, 'case-'))
  const ready = join(home, 'ready-holder'), gate = join(home, 'gate-holder'), exit = join(home, 'exit-holder')
  const child = spawn(process.execPath, [holder, home, 'shared', ready, gate, exit], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; child.stderr.on('data', data => { stderr += data })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  await waitFile(ready)
  await assert.rejects(beginMigrationExclusive(home, { operationId: 'op-drain-timeout', drainTimeoutMs: 100, pollMs: 20 }), { code: 'MIGRATION_FENCE_DRAIN_TIMEOUT' })
  // G4 as it really is: the intent is stranded and no release path exists,
  // while new writers stay refused.
  await assert.rejects(acquireMigrationShared(home), { code: 'MIGRATION_MAINTENANCE_ACTIVE' })
  await assert.rejects(abandonMigrationIntent(home, { operationId: 'op-drain-timeout', reason: 'drain timed out' }), { code: 'MIGRATION_FENCE_ABANDON_INPUT_INVALID' })
  await assert.rejects(abandonMigrationIntent(home, { operationId: 'op-drain-timeout', reason: 'drain timed out', evidence: {} }), { code: 'MIGRATION_FENCE_ABANDON_INPUT_INVALID' })
  const stranded = await readFile(join(home, 'fence', 'intent.json'))
  const abandoned = await abandonMigrationIntent(home, { operationId: 'op-drain-timeout', reason: 'drain timed out with a live holder', evidence: { liveShared: 1, drainTimeoutMs: 100, observedAt: Date.now() } })
  await writeFile(exit, 'x'); await exited(child)
  const audit = (await readFile(abandoned.auditPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(audit.length, 1, `one audit record per abandonment: ${stderr}`)
  const [row] = audit
  assert.equal(row.kind, 'migration-fence-intent-abandonment')
  assert.equal(row.schemaVersion, 1)
  assert.equal(row.operationId, 'op-drain-timeout')
  assert.equal(row.reason, 'drain timed out with a live holder')
  assert.equal(row.evidence.drainTimeoutMs, 100)
  assert.equal(row.intent.operationId, 'op-drain-timeout')
  assert.equal(row.intent.ownerToken, undefined, 'the audit never republishes the dead owner token')
  assert.equal(row.intentDigest, sha(stranded), 'the audit binds the exact bytes that were removed')
  assert.equal(abandoned.intentDigest, row.intentDigest)
  const cleared = await readMigrationFence(home)
  assert.equal(cleared.maintenanceActive, false)
  assert.equal(cleared.intent, null)
  assert.equal(cleared.stopWriteProvable, false)
  const shared = await acquireMigrationShared(home)
  await shared.release()
})

test('fence hardening: abandonment refuses a live foreign owner, any exclusive, and a foreign id', async () => {
  const home = await mkdtemp(join(parent, 'case-'))
  const exclusive = await beginMigrationExclusive(home, { operationId: 'op-hold' })
  await assert.rejects(abandonMigrationIntent(home, { operationId: 'op-hold', reason: 'r', evidence: { observed: 'shared-holder' } }), { code: 'MIGRATION_FENCE_EXCLUSIVE_PRESENT' })
  await assert.rejects(abandonMigrationIntent(home, { operationId: 'op-other', reason: 'r', evidence: { observed: 'shared-holder' } }), { code: 'MIGRATION_FENCE_ABANDON_MISMATCH' })
  await exclusive.release()
  const foreign = await mkdtemp(join(parent, 'case-'))
  const sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  try {
    await new Promise(done => setTimeout(done, 200))
    await mkdir(join(foreign, 'fence'), { recursive: true })
    await writeFile(join(foreign, 'fence', 'intent.json'), JSON.stringify({ schemaVersion: 1, operationId: 'op-live-owner', ownerToken: 'held-by-child', pid: sleeper.pid, startTicks: null, createdAt: Date.now() }))
    await assert.rejects(abandonMigrationIntent(foreign, { operationId: 'op-live-owner', reason: 'r', evidence: { observed: 'takeover' } }), { code: 'MIGRATION_FENCE_BUSY' })
    assert.equal((await readMigrationFence(foreign)).maintenanceActive, true)
  } finally { if (sleeper.exitCode === null) sleeper.kill('SIGKILL') }
})

test('configuration commit: one explicit operation id binds the fence, the plan and the gate', async () => {
  const root = await mkdtemp(join(parent, 'case-')), home = join(root, 'home'), profile = join(home, 'profiles/desktop'), privateOutput = join(root, 'owner-private'), other = join(root, 'owner-private-2')
  await mkdir(profile, { recursive: true })
  const target = join(profile, 'package.json'), before = Buffer.from('PRIVATE-BEFORE\n'), maintenance = Buffer.from('PRIVATE-DISABLED\n'), after = Buffer.from('PRIVATE-AFTER\n')
  await writeFile(target, before)
  const changes = [{ path: target, beforeSha256: sha(before), maintenance, after }]
  const operationId = randomUUID()
  const prepared = await prepare({ home, privateOutput, changes, operationId })
  assert.equal(prepared.operationId, operationId, 'a caller-supplied id is echoed back')
  const plan = JSON.parse(await readFile(join(privateOutput, 'transaction.private.json'), 'utf8'))
  const gate = readMigrationStartupGate({ home })
  const fence = await beginMigrationExclusive(home, { operationId })
  const snapshot = await readMigrationFence(home)
  assert.deepEqual([snapshot.intent.operationId, snapshot.exclusive.operationId, plan.id, gate.operationId], [operationId, operationId, operationId, operationId])
  await fence.release()
  // An id the gate schema cannot read back is refused before any byte is written.
  await assert.rejects(prepare({ home, privateOutput: join(root, 'unreadable'), changes, operationId: 'not-a-uuid' }), { code: 'MIGRATION_COMMIT_OPERATION_ID_UNSUPPORTED' })
  await assert.rejects(prepare({ home, privateOutput: join(root, 'malformed'), changes, operationId: 'bad id!' }), { code: 'MIGRATION_COMMIT_INPUT_INVALID' })
  // A terminal gate that already consumed the id refuses a second plan.
  await resume({ privateOutput, phase: 'rollback' })
  assert.equal(readMigrationStartupGate({ home }).phase, 'rolled-back')
  await assert.rejects(prepare({ home, privateOutput: other, changes, operationId }), { code: 'MIGRATION_COMMIT_OPERATION_CONFLICT' })
  assert.deepEqual(await readFile(target), before, 'no configuration byte moved')
  const defaulted = await prepare({ home, privateOutput: join(root, 'owner-private-3'), changes })
  assert.match(defaulted.operationId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/, 'an omitted id still defaults to randomUUID')
})

test('fence hardening: stopWriteProvable stays false and maintenanceActive keeps its meaning', async () => {
  const home = await mkdtemp(join(parent, 'case-'))
  const empty = await readMigrationFence(home)
  assert.deepEqual([empty.stopWriteProvable, empty.maintenanceActive], [false, false])
  const shared = await acquireMigrationShared(home)
  const admitted = await readMigrationFence(home)
  assert.deepEqual([admitted.stopWriteProvable, admitted.maintenanceActive, admitted.liveShared.length], [false, false, 1], 'a shared admission is not maintenance')
  await shared.release()
  const fence = await beginMigrationExclusive(home, { operationId: 'op-semantics' })
  const held = await readMigrationFence(home)
  assert.deepEqual([held.stopWriteProvable, held.maintenanceActive], [false, true])
  await fence.release()
  const freed = await readMigrationFence(home)
  assert.deepEqual([freed.stopWriteProvable, freed.maintenanceActive], [false, false])
})
