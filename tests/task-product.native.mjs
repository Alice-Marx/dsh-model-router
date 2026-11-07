import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { createTaskService } from '../packages/orchestration/src/task-service.mjs'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { inspectProductTask } from '../packages/orchestration/src/task-product.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

const payload = { backend: 'fixture', input: { task: '核对结果', private: 'input-sentinel' }, target: { location: 'local' } }
async function fixture(t) {
  const parent = resolve('tmp/integration/task-product'); await mkdir(parent, { recursive: true })
  const path = join(await mkdtemp(join(parent, 'case-')), 'tasks.sqlite'), j = openTaskJournal(Database, path)
  t.after(() => j.close())
  return { j, path, f: j.claimRunner('test-runner', 60_000, 0) }
}

test('product tasks include new records after 128 old successes and prioritize another Bot before truncating', async t => {
  const { j, f } = await fixture(t)
  for (let i = 0; i < 130; i++) {
    const row = j.submit(f, 'bot-a', `request-${i}`, `hash-${i}`, payload, 50_000, i * 3)
    j.claim(f, 'bot-a', row.taskId, i * 3 + 1); j.finish(f, 'bot-a', row.taskId, row.attemptId, 'succeeded', {}, i * 3 + 2)
  }
  const current = j.submit(f, 'bot-b', 'request-new', 'hash-new', payload, 50_000, 400)
  j.submit(f, 'deleted-bot', 'hidden', 'hidden', payload, 50_000, 401)
  const all = j.productList(['bot-a', 'bot-b', 'bot-a'])
  assert.equal(all.items.length, 131); assert.equal(all.total, 131); assert.equal(all.truncated, false)
  assert.equal(all.items[0].taskId, current.taskId)
  assert.equal(all.items[1].input.input.task, '核对结果')
  assert.equal(all.items[1].createdAt, 129 * 3, 'newer history is visible before older history')
  const limited = j.productList(['bot-a', 'bot-b'], { limit: 1 })
  assert.equal(limited.total, 131); assert.equal(limited.truncated, true); assert.equal(limited.items[0].taskId, current.taskId)
  assert.deepEqual(j.productList([]), { items: [], total: 0, truncated: false })
  assert.throws(() => j.productList(['bot-a'], { limit: 513 }), /INVALID_TASK_LIST/)
})

test('task history preserves retry identities, bounded chronological events and ownership across restart', async t => {
  const { j, f, path } = await fixture(t)
  let row = j.submit(f, 'bot-a', 'original', 'hash', payload, 50_000, 1)
  const original = row
  j.claim(f, 'bot-a', row.taskId, 2); j.finish(f, 'bot-a', row.taskId, row.attemptId, 'failed', {}, 3)
  row = j.retry(f, 'bot-a', row.taskId, 'retry', 'retry-hash', 4)
  j.claim(f, 'bot-a', row.taskId, 5); j.finish(f, 'bot-a', row.taskId, row.attemptId, 'succeeded', {}, 6)
  const all = j.events('bot-a', row.taskId), latest = j.timeline('bot-a', row.taskId, { limit: 2 })
  assert.deepEqual(latest.items, all.slice(-2)); assert.equal(latest.total, all.length); assert.equal(latest.truncated, true)
  assert.throws(() => j.timeline('bot-b', row.taskId), /TASK_NOT_FOUND/)
  assert.throws(() => j.timeline('bot-a', row.taskId, { limit: 201 }), /INVALID_TASK_HISTORY_LIMIT/)
  j.close()
  const cold = openTaskJournal(Database, path); t.after(() => cold.close())
  assert.equal(cold.get('bot-a', row.taskId).attempts.length, 2)
  assert.equal(cold.timeline('bot-a', row.taskId).items[0].attempt_id, original.attemptId)
  assert.deepEqual(cold.timeline('bot-a', row.taskId).items, all)
})

test('task inspection is owner authenticated, committed-grant scoped, read-only and excludes raw backend data', async t => {
  const { j, f } = await fixture(t), authority = createAuthority(), directory = createPrincipalDirectory(authority)
  t.after(() => authority.dispose())
  directory.register('bot-a', { tools: ['task/read'], modelRoutes: [] })
  directory.register('bot-b', { tools: ['task/read'], modelRoutes: [] })
  const service = createTaskService({ journal: j, authority, directory, backends: [] })
  const row = j.submit(f, 'bot-a', 'original', 'hash', payload, 50_000, 1)
  j.claim(f, 'bot-a', row.taskId, 2)
  j.finish(f, 'bot-a', row.taskId, row.attemptId, 'failed', { code: 'EXPECTED_FAILURE', secret: 'result-sentinel' }, 3)
  const model = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: {
    'task.inspect': request => inspectProductTask({ service, journal: j, subject: directory.forBot(request.botId), taskId: request.taskId }),
  } })
  const request = { action: 'task.inspect', payload: { botId: 'bot-a', taskId: row.taskId } }
  const before = JSON.stringify(j.get('bot-a', row.taskId)), beforeEvents = j.events('bot-a', row.taskId)
  const detail = await model.dispatch(request, { kind: 'owner' })
  assert.equal(detail.task.title, '核对结果'); assert.equal(detail.task.operationId, row.operationId)
  assert.equal(detail.task.result.code, 'EXPECTED_FAILURE'); assert.equal(detail.attempts[0].attemptId, row.attemptId)
  assert.equal(detail.timeline.items.at(-1).outcome, 'failed')
  assert.doesNotMatch(JSON.stringify(detail), /input-sentinel|result-sentinel|executionRef|evidenceHash|"detail"/)
  assert.equal(JSON.stringify(j.get('bot-a', row.taskId)), before); assert.deepEqual(j.events('bot-a', row.taskId), beforeEvents)
  await assert.rejects(model.dispatch(request, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  await assert.rejects(model.dispatch({ ...request, payload: { ...request.payload, botId: 'bot-b' } }, { kind: 'owner' }), /TASK_NOT_FOUND/)
  directory.replaceGrant('bot-a', { tools: [], modelRoutes: [] })
  await assert.rejects(model.dispatch(request, { kind: 'owner' }), /TOOL_DENIED/)
})
