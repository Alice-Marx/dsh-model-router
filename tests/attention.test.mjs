import test from 'node:test'
import assert from 'node:assert/strict'
import { attentionSummary, deriveAttention } from '../.dsh-plugin/shared/attention.mjs'

test('attention: a healthy workbench asks for nothing', () => {
  const rows = deriveAttention({
    budget: { exceeded: false, action: 'downgrade' },
    reserved: { interruptedCount: 0 },
    probes: [{ id: 'codex', status: 'installed' }],
    health: [{ id: 'codex', installed: true, login: { state: 'logged-in' } }],
    runs: [{ id: 'r1', status: 'succeeded' }],
  })
  assert.deepEqual(rows, [])
  assert.equal(attentionSummary(rows), '')
})

test('attention: a paused budget comes before failures and names the decision', () => {
  const rows = deriveAttention({
    budget: { exceeded: true, action: 'pause', message: '今日预算已用完。' },
    probes: [{ id: 'codex', label: 'Codex CLI', status: 'probe-timeout', detail: 'codex --version 超时。' }],
    health: [{ id: 'gemini', installed: true, login: { state: 'logged-out' } }],
  })
  assert.equal(rows[0].stage, 'blocked')
  assert.equal(rows[0].key, 'budget')
  assert.equal(rows[0].target, 'controls')
  assert.match(rows[0].detail, /预算已用完/)
  assert.equal(rows[1].stage, 'failed')
  assert.equal(rows[2].stage, 'login')
  assert.match(attentionSummary(rows), /3 项需要你处理（1 项会阻止执行）/)
})

test('attention: a downgrade budget is not a person’s decision and stays quiet', () => {
  const rows = deriveAttention({ budget: { exceeded: true, action: 'downgrade' } })
  assert.deepEqual(rows, [])
})

test('attention: interrupted executions are reported with their count', () => {
  const rows = deriveAttention({ reserved: { interruptedCount: 2 } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].stage, 'blocked')
  assert.match(rows[0].title, /2 次执行中断/)
})

test('attention: a failed run keeps a readable task name and its error', () => {
  const rows = deriveAttention({
    runs: [
      { id: 'r2', status: 'failed', task: '修复登录流程并补充测试', error: 'MODEL_DENIED' },
      { id: 'r1', status: 'succeeded', task: '整理文档' },
    ],
  })
  assert.equal(rows.length, 1)
  assert.match(rows[0].title, /修复登录流程/)
  assert.equal(rows[0].detail, 'MODEL_DENIED')
  assert.equal(rows[0].target, 'history')
  assert.equal(rows[0].runId, 'r2')
})

test('attention: only logged-out installed tools are a login row', () => {
  const rows = deriveAttention({
    health: [
      { id: 'a', label: 'A', installed: false, login: { state: 'logged-out' } },
      { id: 'b', label: 'B', installed: true, login: { state: 'unknown' } },
      { id: 'c', label: 'C', installed: true, login: { state: 'logged-out', detail: '运行 c login' } },
    ],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].key, 'login:c')
  assert.equal(rows[0].detail, '运行 c login')
})

test('attention: the list is capped and keeps the most blocking rows', () => {
  const rows = deriveAttention({
    probes: Array.from({ length: 8 }, (_, index) => ({ id: `t${index}`, status: 'probe-failed' })),
    budget: { exceeded: true, action: 'pause' },
    limit: 3,
  })
  assert.equal(rows.length, 3)
  assert.equal(rows[0].key, 'budget')
})
