import test from 'node:test'
import assert from 'node:assert/strict'
import { taskProgress, filterTasks } from '../apps/integration-client/task-progress.mjs'
import { deriveBotAttention } from '../apps/integration-client/bot-attention.mjs'

test('progress counts every pending task and keeps uncertain remote successes out of finished work', () => {
  const snapshot = { bots: [{ id: 'a', name: '研究 Bot' }, { id: 'b', name: '执行 Bot' }], tasks: { status: 'available', items: [
    ...Array.from({ length: 8 }, (_, i) => ({ taskId: `failed-${i}`, botId: 'a', state: 'failed' })),
    { taskId: 'unknown', botId: 'b', state: 'succeeded', result: { remote: { stopConfirmed: false, possiblyApplied: true } } },
    { taskId: 'admitting', botId: 'b', state: 'admitting' }, { taskId: 'done', botId: 'a', state: 'succeeded' },
  ] } }
  const value = taskProgress(snapshot)
  assert.equal(value.attention.length, 9); assert.deepEqual(value.counts, { all: 11, active: 1, attention: 9, finished: 1, other: 0 })
  assert.equal(value.bots.find(bot => bot.botId === 'b').active, 1)
  assert.equal(deriveBotAttention({ tasks: { items: [{ taskId: 'admitting', state: 'admitting' }] } }).length, 0)
  assert.deepEqual(filterTasks(value, { status: 'finished' }).map(row => row.taskId), ['done'])
})

test('filters combine Bot, status and task or operation identity while retaining unknown states in all', () => {
  const value = taskProgress({ bots: [{ id: 'a', name: '研究 Bot' }], tasks: { status: 'available', items: [
    { taskId: 'one', botId: 'a', state: 'running', title: '文献查证', operationId: 'OP-ORIGINAL', planId: 'plan-original' },
    { taskId: 'two', botId: 'b', state: 'brand-new-state', title: '其他工作' },
  ] } })
  assert.equal(filterTasks(value, { botId: 'a', status: 'active', query: ' op-original ' }).length, 1)
  assert.equal(filterTasks(value, { query: '研究 Bot' }).length, 1)
  assert.equal(filterTasks(value, { query: 'plan-original' }).length, 1)
  assert.equal(filterTasks(value, { botId: 'b', status: 'active' }).length, 0)
  assert.equal(filterTasks(value, { botId: 'b' })[0].state, 'brand-new-state')
  assert.equal(taskProgress({ tasks: { status: 'blocked', items: [{}] } }).items.length, 0)
})

test('progress note: says something the tag cannot, and stays quiet when it cannot', async () => {
  const { progressNote } = await import('../apps/integration-client/task-progress.mjs')
  // The tag says 已停止, which does not tell you whether any work ran.
  assert.equal(progressNote({ state: 'cancelled', attribution: { label: '已取消，未执行' } }, '已停止'), '已取消，未执行')
  assert.equal(progressNote({ state: 'failed', attribution: { label: '已执行，执行后失败' } }, '失败'), '已执行，执行后失败')
  // Repeating the tag is noise, not information.
  assert.equal(progressNote({ state: 'succeeded', attribution: { label: '已完成' } }, '已完成'), '')
  assert.equal(progressNote({ state: 'succeeded', attribution: { label: '  已完成  ' } }, '已完成'), '')
  // An older row without one, or an empty label, shows nothing.
  assert.equal(progressNote({ state: 'running' }, '进行中'), '')
  assert.equal(progressNote({ state: 'running', attribution: { label: '   ' } }, '进行中'), '')
})
