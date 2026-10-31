import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { quarantineMigrationRemoteClients as quarantine } from '../packages/orchestration/src/migration-remote-client-quarantine.mjs'

await import('../remote-computer-agent/build.mjs')
const executeFile = promisify(execFile)
const cli = resolve('remote-computer-agent/dist/cli.mjs')
const agentFixture = resolve('tests/fixtures/migration-remote-effect-agent.mjs')
const parent = resolve('tmp/integration/migration-remote-client-recovery')
await mkdir(parent, { recursive: true })
const readJson = path => readFile(path, 'utf8').then(value => value.trim() ? JSON.parse(value) : null).catch(() => null)
const dead = pid => { try { process.kill(pid, 0); return false } catch (error) { return error.code === 'ESRCH' } }
async function wait(fn, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('Remote client recovery fixture did not become ready')
}
async function fixture(t, name) {
  const dir = await mkdtemp(join(parent, `${name}-`)), project = join(dir, 'project')
  await mkdir(project)
  const readyFile = join(dir, 'agent-ready.json')
  const child = spawn(process.execPath, [agentFixture, dir, readyFile], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(child.pid)) { try { process.kill(child.pid) } catch {} } })
  const ready = await wait(() => readJson(readyFile))
  const configPath = join(dir, 'agent-config.json')
  await writeFile(configPath, JSON.stringify({ dataDir: join(dir, 'agent') }))
  return { dir, ready, input: { configPath, machineId: ready.machineId, clientId: 'host' } }
}
function revoked(fixture) {
  const db = new Database(join(fixture.dir, 'agent/agent.sqlite'), { readonly: true })
  try { return db.prepare('SELECT revoked FROM clients WHERE id=?').get('host').revoked } finally { db.close() }
}
const options = (fixtures, execute = executeFile) => ({ Database, cli, runtime: process.execPath, clients: fixtures.map(item => item.input), execute })

test('migration remote client recovery: a real revoke is verified and reentry skips the already revoked client', async t => {
  const f = await fixture(t, 'success')
  const first = await quarantine(options([f]))
  assert.equal(first.declaredCredentialAdmissionBlocked, true)
  assert.equal(first.persistentDeclaredExclusion, true)
  assert.equal(first.stopWriteProvable, false)
  assert.equal(first.clients[0].alreadyRevoked, false)
  assert.equal(revoked(f), 1)
  let calls = 0
  const second = await quarantine(options([f], async (...args) => { calls++; return executeFile(...args) }))
  assert.equal(second.clients[0].alreadyRevoked, true)
  assert.equal(calls, 0, 'recovery reads the durable state and does not invoke another revoke')
})

test('migration remote client recovery: an offline CLI leaves the state unconfirmed and a later retry completes it', async t => {
  const f = await fixture(t, 'offline')
  await assert.rejects(quarantine(options([f], async () => { throw new Error('synthetic offline') })), error => {
    assert.equal(error.code, 'MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED')
    assert.deepEqual(error.details.completed, [])
    return true
  })
  assert.equal(revoked(f), 0)
  const recovered = await quarantine(options([f]))
  assert.equal(recovered.clients[0].revoked, true)
  assert.equal(revoked(f), 1)
})

test('migration remote client recovery: a partial two-Agent failure resumes only the unconfirmed client', async t => {
  const a = await fixture(t, 'partial-a'), b = await fixture(t, 'partial-b')
  let calls = 0
  await assert.rejects(quarantine(options([a, b], async (...args) => {
    calls++
    if (calls === 2) throw new Error('synthetic second Agent offline')
    return executeFile(...args)
  })), error => {
    assert.equal(error.code, 'MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED')
    assert.equal(error.details.machineId, b.ready.machineId)
    assert.deepEqual(error.details.completed.map(item => item.machineId), [a.ready.machineId])
    return true
  })
  assert.deepEqual([revoked(a), revoked(b)], [1, 0])
  calls = 0
  const recovered = await quarantine(options([a, b], async (...args) => { calls++; return executeFile(...args) }))
  assert.equal(calls, 1, 'the already revoked first Agent is skipped')
  assert.deepEqual(recovered.clients.map(item => item.alreadyRevoked), [true, false])
  assert.deepEqual([revoked(a), revoked(b)], [1, 1])
})

test('migration remote client recovery: identity mismatch refuses before any revoke', async t => {
  const f = await fixture(t, 'identity')
  let calls = 0
  await assert.rejects(quarantine({ Database, cli, clients: [{ ...f.input, machineId: 'machine-wrong' }], execute: async () => { calls++ } }), { code: 'MIGRATION_REMOTE_CLIENT_IDENTITY_MISMATCH' })
  assert.equal(calls, 0)
  assert.equal(revoked(f), 0)
})
