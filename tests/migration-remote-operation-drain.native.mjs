import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { assertMigrationRemoteOperationsSettled as settled } from '../packages/orchestration/src/migration-remote-operation-drain.mjs'

await import('../remote-computer-agent/build.mjs')
const { Agent, TOOL_NAMES } = await import('../remote-computer-agent/dist/index.mjs')
const parent = resolve('tmp/integration/migration-remote-operation-drain')
await mkdir(parent, { recursive: true })
async function fixture(t) {
  const dir = await mkdtemp(join(parent, 'case-')), project = join(dir, 'project')
  await mkdir(project)
  const agent = new Agent({ dataDir: join(dir, 'agent'), roots: { project } }, Database)
  t.after(() => agent.close())
  const pair = agent.store.pair('host', { botIds: ['bot-a'], roots: ['project'], tools: TOOL_NAMES })
  const configPath = join(dir, 'agent-config.json')
  await writeFile(configPath, JSON.stringify({ dataDir: join(dir, 'agent') }))
  const input = { configPath, machineId: pair.machineId, clientId: 'host' }
  const client = agent.store.client(pair.token)
  const context = agent.store.issue(client, { botId: 'bot-a', taskId: 'task-a', attemptId: 'attempt-a', roots: ['project'], tools: ['fs_write'] })
  const args = { rootId: 'project', relativePath: 'effect.txt', content: 'synthetic', expectedHash: null }
  agent.store.admit('operation-a', context, 'fs_write', args)
  agent.store.running('operation-a')
  return { agent, input }
}

test('migration remote operation drain: a revoked client with a running operation blocks until its original receipt is terminal', async t => {
  const f = await fixture(t)
  f.agent.store.revoke('host')
  await assert.rejects(settled({ Database, clients: [f.input] }), error => {
    assert.equal(error.code, 'MIGRATION_REMOTE_OPERATION_ACTIVE')
    assert.deepEqual(error.details.pendingIds, ['operation-a'])
    return true
  })
  f.agent.store.finish('operation-a', 'cancelled', { stopConfirmed: true, possiblyApplied: false }, 'CANCELLED')
  const result = await settled({ Database, clients: [f.input] })
  assert.equal(result.declaredOperationsSettled, true)
  assert.equal(result.stopWriteProvable, false)
  assert.deepEqual(result.clients, [{ machineId: f.input.machineId, clientId: 'host', operations: 1, settled: true }])
})

test('migration remote operation drain: unknown stays unresolved and an unrevoked authority cannot drain', async t => {
  const f = await fixture(t)
  f.agent.store.finish('operation-a', 'unknown', null, 'OUTCOME_UNKNOWN')
  f.agent.store.revoke('host')
  await assert.rejects(settled({ Database, clients: [f.input] }), { code: 'MIGRATION_REMOTE_OPERATION_UNRESOLVED' })
  f.agent.store.finish('operation-a', 'cancelled', { stopConfirmed: true, possiblyApplied: true }, 'CANCELLED')
  assert.equal((await settled({ Database, clients: [f.input] })).declaredOperationsSettled, true)
  const g = await fixture(t)
  await assert.rejects(settled({ Database, clients: [g.input] }), { code: 'MIGRATION_REMOTE_OPERATION_AUTHORITY_ACTIVE' })
})
