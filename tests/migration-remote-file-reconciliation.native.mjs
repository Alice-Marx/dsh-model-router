import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { reconcileMigrationRemoteFileEffect as reconcile } from '../packages/orchestration/src/migration-remote-file-reconciliation.mjs'
import { assertMigrationRemoteOperationsSettled as settled } from '../packages/orchestration/src/migration-remote-operation-drain.mjs'

await import('../remote-computer-agent/build.mjs')
const { Agent, TOOL_NAMES } = await import('../remote-computer-agent/dist/index.mjs')
const parent = resolve('tmp/integration/migration-remote-file-reconciliation')
await mkdir(parent, { recursive: true })
async function fixture(t, content = 'synthetic effect\n') {
  const dir = await mkdtemp(join(parent, 'case-')), project = join(dir, 'project')
  await mkdir(project)
  await writeFile(join(project, 'effect.txt'), content)
  const agent = new Agent({ dataDir: join(dir, 'agent'), roots: { project } }, Database)
  t.after(() => agent.close())
  const pair = agent.store.pair('host', { botIds: ['bot-a'], roots: ['project'], tools: TOOL_NAMES })
  const configPath = join(dir, 'agent-config.json')
  await writeFile(configPath, JSON.stringify({ dataDir: join(dir, 'agent') }))
  const client = { configPath, machineId: pair.machineId, clientId: 'host' }
  const authority = agent.store.client(pair.token)
  const context = agent.store.issue(authority, { botId: 'bot-a', taskId: 'task-a', attemptId: 'attempt-a', roots: ['project'], tools: ['fs_write'] })
  const args = { rootId: 'project', relativePath: 'effect.txt', content, encoding: 'utf8', expectedHash: null }
  agent.store.admit('operation-a', context, 'fs_write', args)
  agent.store.running('operation-a')
  agent.store.finish('operation-a', 'unknown', null, 'OUTCOME_UNKNOWN')
  agent.store.revoke('host')
  return { agent, project, client, request: { Database, client, operationId: 'operation-a', botId: 'bot-a', taskId: 'task-a', attemptId: 'attempt-a', args, rootPath: project } }
}

test('migration remote file reconciliation: exact original bytes resolve unknown without rewriting it, and later tampering revokes the proof', async t => {
  const f = await fixture(t)
  const result = await reconcile(f.request)
  assert.equal(result.resolved, true)
  assert.equal(result.originalOperationStatus, 'unknown')
  assert.equal(result.stopWriteProvable, false)
  assert.equal((await settled({ Database, clients: [f.client] })).declaredOperationsSettled, true)
  assert.equal(f.agent.store.db.prepare('SELECT status FROM operations WHERE id=?').get('operation-a').status, 'unknown')
  assert.equal((await reconcile(f.request)).resolved, true, 'the same evidence is idempotent')
  await writeFile(join(f.project, 'effect.txt'), 'tampered\n')
  await assert.rejects(settled({ Database, clients: [f.client] }), { code: 'MIGRATION_REMOTE_OPERATION_UNRESOLVED' })
  await writeFile(join(f.project, 'effect.txt'), 'synthetic effect\n')
  assert.equal((await settled({ Database, clients: [f.client] })).declaredOperationsSettled, true)
})

test('migration remote file reconciliation: different bytes cannot create a resolution', async t => {
  const f = await fixture(t, 'actual\n')
  f.request.args.content = 'expected\n'
  await assert.rejects(reconcile(f.request), { code: 'MIGRATION_REMOTE_RECONCILIATION_MISMATCH' })
  await assert.rejects(settled({ Database, clients: [f.client] }), { code: 'MIGRATION_REMOTE_OPERATION_UNRESOLVED' })
})

test('migration remote file reconciliation: matching bytes cannot substitute another task or operation digest', async t => {
  const f = await fixture(t)
  f.request.attemptId = 'attempt-other'
  await assert.rejects(reconcile(f.request), { code: 'MIGRATION_REMOTE_RECONCILIATION_OPERATION_MISMATCH' })
  await assert.rejects(settled({ Database, clients: [f.client] }), { code: 'MIGRATION_REMOTE_OPERATION_UNRESOLVED' })
})
