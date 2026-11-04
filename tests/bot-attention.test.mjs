import test from 'node:test'
import assert from 'node:assert/strict'
import { botAttentionSummary, deriveBotAttention } from '../apps/integration-client/bot-attention.mjs'

const bot = { id: 'session-1', name: 'Chief' }
const snapshot = tasks => ({ bots: [bot], tasks: { status: 'available', items: tasks } })

test('bot attention: a healthy team asks for nothing', () => {
  const rows = deriveBotAttention(snapshot([
    { id: 't1', botId: 'session-1', state: 'succeeded' },
    { id: 't2', botId: 'session-1', state: 'running' },
    { id: 't3', botId: 'session-1', state: 'cancelled', result: { remote: { stopConfirmed: true } } },
  ]))
  assert.deepEqual(rows, [])
  assert.equal(botAttentionSummary(rows), '')
})

test('bot attention: an unconfirmed remote effect outranks everything else', () => {
  const rows = deriveBotAttention(snapshot([
    { id: 't1', botId: 'session-1', state: 'failed' },
    { id: 't2', botId: 'session-1', state: 'succeeded', result: { remote: { stopConfirmed: false, possiblyApplied: true } } },
  ]))
  assert.equal(rows[0].stage, 'remote-unknown')
  assert.equal(rows[0].taskId, 't2')
  assert.match(rows[0].detail, /停止或写入没有确认回执/)
  assert.equal(rows[1].stage, 'failed')
})

test('bot attention: reconciliation, approval and budget each name their action', () => {
  const rows = deriveBotAttention(snapshot([
    { id: 'a', botId: 'session-1', state: 'needs-reconciliation', title: '写入配置' },
    { id: 'b', botId: 'session-1', state: 'waiting-approval', title: '执行命令', blockedReason: '需要 workspace-write 审批' },
    { id: 'c', botId: 'session-1', state: 'waiting-budget', title: '长任务' },
  ]))
  assert.deepEqual(rows.map(row => row.action), ['reconcile', 'approve', 'budget'])
  assert.deepEqual(rows.map(row => row.stage), ['reconcile', 'approve', 'budget'])
  assert.match(rows[0].title, /Chief/)
  assert.equal(rows[1].detail, '需要 workspace-write 审批')
  assert.match(botAttentionSummary(rows), /3 项需要你处理（2 项卡在确认上）/)
})

test('bot attention: a terminal state with a confirmed stop is quiet', () => {
  const rows = deriveBotAttention(snapshot([
    { id: 't1', botId: 'session-1', state: 'succeeded', result: { remote: { stopConfirmed: true, status: 'succeeded' } } },
    { id: 't2', botId: 'session-1', state: 'succeeded', result: { remote: { notStarted: true } } },
  ]))
  assert.deepEqual(rows, [])
})

test('bot attention: a blocked task is reported once, with its reason', () => {
  const rows = deriveBotAttention(snapshot([
    { id: 't1', botId: 'session-1', state: 'blocked', blockedReason: '依赖任务未完成' },
  ]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].stage, 'blocked')
  assert.equal(rows[0].detail, '依赖任务未完成')
})

test('bot attention: an unknown bot id still produces a readable row', () => {
  const rows = deriveBotAttention(snapshot([{ id: 't1', botId: 'ghost', state: 'failed' }]))
  assert.match(rows[0].title, /ghost/)
})

test('bot attention: the list is capped but keeps the most urgent rows', () => {
  const rows = deriveBotAttention(snapshot([
    ...Array.from({ length: 5 }, (_, index) => ({ id: `f${index}`, state: 'failed' })),
    { id: 'r', state: 'needs-reconciliation' },
  ]), { limit: 3 })
  assert.equal(rows.length, 3)
  assert.equal(rows[0].stage, 'reconcile')
})

test('bot attention: a missing snapshot is quiet instead of throwing', () => {
  assert.deepEqual(deriveBotAttention(null), [])
  assert.deepEqual(deriveBotAttention({}), [])
  assert.deepEqual(deriveBotAttention({ tasks: { status: 'blocked' } }), [])
})

test('attention: contradictory stop evidence is a reconciliation, not a retry', () => {
  const snapshot = {
    bots: [{ id: 'bot-1', name: 'Chief', main: true, sessionId: 'session-1' }],
    tasks: { status: 'available', items: [
      // Says it never started and also that it may have applied: the only safe reading is "not proven".
      { taskId: 't1', botId: 'bot-1', state: 'failed', title: '写文件', result: { remote: { status: 'failed', notStarted: true, possiblyApplied: true } } },
      // Genuinely never started: nothing to reconcile.
      { taskId: 't2', botId: 'bot-1', state: 'failed', title: '读文件', result: { remote: { status: 'failed', notStarted: true } } },
    ] },
  }
  const rows = deriveBotAttention(snapshot)
  const first = rows.find(row => row.taskId === 't1')
  assert.equal(first.stage, 'remote-unknown')
  assert.equal(first.action, 'reconcile')
  const second = rows.find(row => row.taskId === 't2')
  assert.equal(second.action, 'retry')
})
