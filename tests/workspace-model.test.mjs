import test from 'node:test'
import assert from 'node:assert/strict'
import { taskProgress } from '../apps/integration-client/task-progress.mjs'
import { workspaceOverview, workspaceSearch, taskBoard } from '../apps/integration-client/workspace-model.mjs'
import { workspaceNavigation } from '../apps/integration-client/workspace-navigation.mjs'

const sample = () => ({ bots: [{ id: 'a', name: '研究伙伴', role: '查找证据', model: 'fixture/precise' }, { id: 'b', name: '写作伙伴', model: 'fixture/precise' }],
  tasks: { status: 'available', truncated: true, total: 98, items: [
    { taskId: 'shared', botId: 'a', title: '研究方案', state: 'running', updatedAt: 300 },
    { taskId: 'shared', botId: 'b', title: '写作方案', state: 'failed', operationId: 'operation-original', updatedAt: 200 },
    { taskId: 'remote', botId: 'a', title: '远程写入', state: 'cancelled', result: { remote: { stopConfirmed: false, possiblyApplied: true } } },
    { taskId: 'queued', botId: 'b', state: 'queued', updatedAt: 100 },
    { taskId: 'done', botId: 'a', state: 'succeeded', updatedAt: 400 },
    { taskId: 'unknown-new-state', botId: 'b', state: 'future-state' },
  ] }, machines: { status: 'available', items: [{ id: 'online', status: 'online' }, { id: 'unknown', status: 'unknown' }, { id: 'revoked', status: 'revoked' }] } })

test('workspace links and one-use goal drafts belong to the original Host API only', () => {
  const first = workspaceNavigation({}), next = workspaceNavigation({})
  const destination = first.navigate({ section: 'tasks', taskId: 'same', botId: 'a', draft: '需要预览的目标', compose: true })
  assert.equal(next.getSnapshot(), null)
  assert.equal(first.claimDraft(destination.version + 1), null)
  assert.equal(first.claimDraft(destination.version), '需要预览的目标')
  assert.equal(first.claimDraft(destination.version), null)
  assert.equal(first.getSnapshot().taskId, 'same')
  assert.equal(first.getSnapshot().botId, 'a')
  const second = first.navigate({ section: 'tasks', draft: '第二个目标', compose: true })
  assert.equal(first.claimDraft(destination.version), null)
  assert.equal(first.claimDraft(second.version), '第二个目标')
  assert.throws(() => first.navigate({ section: '__proto__' }), TypeError)
})

test('overview retains loaded-record scope and never counts an unconfirmed terminal operation as finished', () => {
  const overview = workspaceOverview(sample())
  assert.deepEqual(overview.progress.counts, { all: 6, active: 2, attention: 2, finished: 1, other: 1 })
  assert.equal(overview.tasksTruncated, true)
  assert.equal(overview.onlineMachines, 1)
  assert.equal(overview.machines.length, 2)
  assert.equal(overview.bots[0].state, 'attention')
  assert.equal(overview.recent[0].taskId, 'done')
  assert.equal(overview.recent.at(-1).taskId, 'unknown-new-state')
  const unavailable = workspaceOverview({ tasks: { status: 'blocked', items: sample().tasks.items }, machines: { status: 'blocked', items: sample().machines.items } })
  assert.equal(unavailable.tasksAvailable, false)
  assert.equal(unavailable.progress.counts.all, 0)
  assert.equal(unavailable.machines.length, 0)
})

test('board uses committed states, preserves two Bots with the same task ID, and exposes unknown states', () => {
  const progress = taskProgress(sample()), lanes = taskBoard(progress)
  assert.deepEqual(lanes.map(lane => [lane.id, lane.items.length]), [['queued', 1], ['running', 1], ['attention', 2], ['finished', 1], ['other', 1]])
  assert.equal(lanes.find(lane => lane.id === 'attention').items.find(row => row.taskId === 'shared').botId, 'b')
  assert.equal(lanes.find(lane => lane.id === 'running').items[0].botId, 'a')
  assert.equal(lanes.find(lane => lane.id === 'finished').items.some(row => row.taskId === 'remote'), false)
})

test('search ranks names first and routes exact compound identities without inspecting secret-bearing fields', () => {
  const snapshot = sample()
  snapshot.bots[0].credentials = 'NEVER_INDEX_THIS_KEY'
  snapshot.tasks.items[0].result = { privateText: 'NEVER_INDEX_THIS_RESULT' }
  assert.equal(workspaceSearch(snapshot, '研究').items[0].kind, 'bot')
  assert.deepEqual(workspaceSearch(snapshot, 'operation-original').items[0].target, { section: 'tasks', botId: 'b', taskId: 'shared' })
  assert.equal(workspaceSearch(snapshot, '查找证据 precise').items[0].target.botId, 'a')
  assert.equal(workspaceSearch(snapshot, 'NEVER_INDEX_THIS').items.length, 0)
  const shared = workspaceSearch(snapshot, 'shared').items
  assert.equal(shared.length, 2)
  assert.notEqual(shared[0].id, shared[1].id)
  assert.equal(workspaceSearch(snapshot, 'revoked').items.length, 0)
  assert.equal(workspaceSearch(snapshot, '  不存在的词  ').total, 0)
  const limited = workspaceSearch(snapshot, '', 3)
  assert.equal(limited.items.length, 3); assert.equal(limited.truncated, true)
  assert.equal(workspaceSearch({ ...snapshot, tasks: { status: 'blocked', items: snapshot.tasks.items } }, 'operation-original').items.length, 0)
})
