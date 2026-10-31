import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'

await import('../remote-computer-agent/build.mjs')
const agentFixture = resolve('tests/fixtures/migration-remote-effect-agent.mjs')
const restartFixture = resolve('tests/fixtures/migration-remote-restart-agent.mjs')
const hostFixture = resolve('tests/fixtures/migration-remote-network-host.mjs')
const parent = resolve('tmp/integration/remote-network-reconnect')
await mkdir(parent, { recursive: true })
const json = path => readFile(path, 'utf8').then(value => JSON.parse(value)).catch(() => null)
const dead = pid => { try { process.kill(pid, 0); return false } catch (error) { return error.code === 'ESRCH' } }
async function wait(fn, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('Remote network fixture did not reach the expected state')
}

test('remote network reconnect: a real Agent disconnect leaves unknown and restart observes the original operation without another write', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(parent, 'case-')), project = join(dir, 'project')
  await mkdir(project)
  const agentReady = join(dir, 'agent-ready.json'), hostDir = join(dir, 'host'), receiptFile = join(dir, 'initial-receipt.json')
  const agent = spawn(process.execPath, [agentFixture, dir, agentReady], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(agent.pid)) agent.kill() })
  const started = await wait(() => json(agentReady))
  const host = spawn(process.execPath, [hostFixture, hostDir, agentReady, receiptFile, 'network-effect.txt', 'network effect\n', join(dir, 'agent-restarted.json')], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(host.pid)) host.kill() })
  await wait(() => json(join(hostDir, 'reply-held.json')))
  assert.equal(await readFile(join(project, 'network-effect.txt'), 'utf8'), 'network effect\n')
  const before = new Database(join(dir, 'agent/agent.sqlite'), { readonly: true })
  const operation = before.prepare("SELECT id,status FROM operations WHERE tool='fs_write'").get()
  before.close()
  assert.equal(operation.status, 'succeeded', 'the real effect is committed before the network is cut')
  const exited = new Promise(resolveExit => agent.once('close', resolveExit))
  agent.kill('SIGKILL')
  await exited
  await writeFile(join(hostDir, 'abort-reply.json'), 'abort')
  const initial = await wait(() => json(receiptFile))
  assert.equal(initial.state, 'needs-reconciliation')
  assert.equal(initial.result.outcome, 'unknown')

  const restartedReady = join(dir, 'agent-restarted.json')
  const restarted = spawn(process.execPath, [restartFixture, dir, restartedReady], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(restarted.pid)) restarted.kill() })
  const identity = await wait(() => json(restartedReady))
  assert.equal(identity.machineId, started.machineId)
  const final = await wait(() => json(join(hostDir, 'final-receipt.json')))
  assert.equal(final.state, 'succeeded')
  assert.equal(final.operationId, initial.operationId)
  assert.equal(final.calls.filter(name => name === 'fs_write').length, 1, 'reconnect observes but never repeats the write')
  assert.equal(await readFile(join(project, 'network-effect.txt'), 'utf8'), 'network effect\n')
  const after = new Database(join(dir, 'agent/agent.sqlite'), { readonly: true })
  assert.equal(after.prepare("SELECT count(*) AS n FROM operations WHERE tool='fs_write'").get().n, 1)
  assert.equal(after.prepare('SELECT status FROM operations WHERE id=?').get(operation.id).status, 'succeeded')
  after.close()
})
