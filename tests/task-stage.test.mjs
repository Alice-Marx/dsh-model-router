import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { taskStage } from '../packages/orchestration/src/task-stage.mjs'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { taskHash } from '../packages/orchestration/src/task-contract.mjs'

test('task stage: queued, active, cancellation and budget are structured working states', () => {
  assert.equal(taskStage({ state: 'ready' }), 'working/queued')
  assert.equal(taskStage({ state: 'admitting' }), 'working')
  assert.equal(taskStage({ state: 'running' }), 'working')
  assert.equal(taskStage({ state: 'cancelling' }), 'working/cancelling')
  assert.equal(taskStage({ state: 'waiting-budget' }), 'working/budget')
})

test('task stage: human attention distinguishes reconciliation, blocked, failed and review', () => {
  assert.equal(taskStage({ state: 'needs-reconciliation' }), 'person/reconciliation')
  assert.equal(taskStage({ state: 'running', needsReconciliation: true }), 'person/reconciliation')
  assert.equal(taskStage({ state: 'blocked' }), 'person/blocked')
  assert.equal(taskStage({ state: 'failed' }), 'person/failed')
  assert.equal(taskStage({ state: 'succeeded' }), 'person/review')
})

test('task stage: terminal cancellation is idle and unknown states fail closed', () => {
  assert.equal(taskStage({ state: 'cancelled' }), 'idle')
  assert.equal(taskStage({ state: 'skipped' }), 'idle')
  assert.throws(() => taskStage({ state: 'unknown' }), { code: 'TASK_STAGE_INVALID' })
})

test('task stage: journal task and plan views expose the computed stage', async t => {
  const parent = resolve('tmp/integration/task-stage')
  await mkdir(parent, { recursive: true })
  const file = join(await mkdtemp(join(parent, 'case-')), 'journal.sqlite')
  const journal = openTaskJournal(Database, file)
  t.after(() => journal.close())
  const identity = journal.claimRunner('runner-a', 1000, 0)
  const target = { effect: 'read', machineId: 'machine-a', workspaceId: 'workspace-a' }
  const plan = { schemaVersion: 1, taskId: 'plan-a', origin: { kind: 'private', botId: 'bot-a', sessionId: null }, planRevision: 1,
    packages: [{ id: 'a', targetBotId: 'bot-a', objective: 'a', dependsOn: [], acceptance: ['verified'], effectClass: 'read' }] }
  const submitted = journal.submitPlan(identity, 'bot-a', 'key-a', plan, 1, {
    payloads: [{ id: 'a', payload: { backend: 'fixture', input: { task: 'a' }, target, targetHash: taskHash(target) } }], deadline: 20000,
  })
  assert.equal(journal.getPlan('bot-a', submitted.planId).stage, 'working/queued')
  const claimed = journal.claim(identity, 'bot-a', submitted.packages[0].taskId, 1)
  assert.equal(journal.get('bot-a', claimed.taskId).stage, 'working')
  journal.finish(identity, 'bot-a', claimed.taskId, claimed.attemptId, 'succeeded', {}, 2)
  assert.equal(journal.getPlan('bot-a', submitted.planId).stage, 'person/review')
})
