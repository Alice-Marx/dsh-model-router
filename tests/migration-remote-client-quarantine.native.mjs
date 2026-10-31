import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'

await import('../remote-computer-agent/build.mjs')
const execFileAsync = promisify(execFile)
const agentFixture = resolve('tests/fixtures/migration-remote-effect-agent.mjs')
const outsideWriter = resolve('tests/fixtures/migration-remote-effect-outside-writer.mjs')
const cli = resolve('remote-computer-agent/dist/cli.mjs')
const parent = resolve('tmp/integration/migration-remote-client-quarantine')
await mkdir(parent, { recursive: true })
const readJson = path => readFile(path, 'utf8').then(value => value.trim() ? JSON.parse(value) : null).catch(() => null)
const dead = pid => { try { process.kill(pid, 0); return false } catch (error) { return error.code === 'ESRCH' } }
async function wait(fn, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('Remote client quarantine fixture did not reach the expected state')
}
async function operations(dir) {
  const db = new Database(join(dir, 'agent/agent.sqlite'), { readonly: true })
  try { return db.prepare('SELECT id,tool,status FROM operations ORDER BY id').all() } finally { db.close() }
}
async function grant(agent, identity = { taskId: 'task-existing', attemptId: 'attempt-existing' }) {
  const response = await fetch(`http://127.0.0.1:${agent.port}/control/v1/grants`, {
    method: 'POST', headers: { Authorization: `Bearer ${agent.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ botId: 'bot-a', ...identity, roots: ['project.v1'], tools: ['fs_write'], ttlMs: 60000 }),
  })
  assert.equal(response.status, 200)
  return response.json()
}

test('migration remote client quarantine: the real admin revoke blocks an outside Host and an already-issued grant without killing the Agent', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(parent, 'case-')), project = join(dir, 'project')
  await mkdir(project)
  const agentReady = join(dir, 'agent-ready.json')
  const agent = spawn(process.execPath, [agentFixture, dir, agentReady], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(agent.pid)) { try { process.kill(agent.pid) } catch {} } })
  const started = await wait(() => readJson(agentReady))

  const beforeDir = join(dir, 'before'), beforeReceipt = join(dir, 'before-receipt.json')
  const before = spawn(process.execPath, [outsideWriter, beforeDir, agentReady, beforeReceipt, 'before-revoke.txt', 'before revoke\n'], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(before.pid)) { try { process.kill(before.pid) } catch {} } })
  const first = await wait(() => readJson(beforeReceipt))
  assert.equal(first.state, 'succeeded')
  assert.equal(await readFile(join(project, 'before-revoke.txt'), 'utf8'), 'before revoke\n')
  const existing = await grant(started)
  assert.equal((await operations(dir)).length, 1)

  const config = join(dir, 'agent-config.json')
  await writeFile(config, JSON.stringify({ dataDir: join(dir, 'agent') }))
  const revoked = await execFileAsync(process.execPath, [cli, 'revoke', config, 'host'], { cwd: dir, windowsHide: true })
  assert.deepEqual(JSON.parse(revoked.stdout), { revoked: true })
  assert.equal(dead(started.pid), false, 'authority revocation does not require an OS process stop')

  const blocked = await fetch(`http://127.0.0.1:${started.port}/mcp`, {
    method: 'POST', headers: { Authorization: `Bearer ${existing.grantToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fs_write', arguments: { rootId: 'project.v1', relativePath: 'existing-grant.txt', content: 'must not appear\n', expectedHash: null }, _meta: { 'dsh/operationId': 'existing-grant-effect' } } }),
  })
  assert.equal(blocked.status, 401)
  assert.equal((await blocked.json()).error.code, 'AUTH_INVALID')
  await assert.rejects(readFile(join(project, 'existing-grant.txt')), { code: 'ENOENT' })

  const afterDir = join(dir, 'after'), afterReceipt = join(dir, 'after-receipt.json')
  const after = spawn(process.execPath, [outsideWriter, afterDir, agentReady, afterReceipt, 'after-revoke.txt', 'after revoke\n'], { cwd: dir, stdio: 'ignore', windowsHide: true })
  t.after(() => { if (!dead(after.pid)) { try { process.kill(after.pid) } catch {} } })
  const failure = await wait(() => readFile(join(afterDir, 'outside-writer-error.json'), 'utf8').catch(() => null))
  assert.match(failure, /AUTH_INVALID/)
  assert.equal(await readJson(afterReceipt), null, 'a new outside Host cannot pair with the revoked long-lived secret')
  await assert.rejects(readFile(join(project, 'after-revoke.txt')), { code: 'ENOENT' })
  assert.deepEqual(await operations(dir), [{ id: first.operationId, tool: 'fs_write', status: 'succeeded' }], 'neither blocked request reaches operation admission or changes the original receipt')
  assert.equal(dead(started.pid), false)
  t.diagnostic(`Agent ${started.pid} remains alive; client revoke preserves the first real write and blocks both later write paths`)
})
