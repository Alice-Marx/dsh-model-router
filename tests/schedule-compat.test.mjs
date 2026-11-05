import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptScheduleService } from '../modules/bot-runtime/schedule-compat.mjs'

test('existing session-scoped Schedule APIs pass through unchanged', () => {
  const old = { create() {}, delete() {} }
  assert.equal(adaptScheduleService(old), old)
})

test('Host-wide schedules retain the exact Session target, timing and delete revision', async () => {
  const calls = [], rows = [{ id: 'a', target: { kind: 'session', sessionId: 'worker' }, status: 'active', updatedAt: 'v1' },
    { id: 'b', target: { kind: 'session', sessionId: 'other' }, status: 'active' }, { id: 'c', target: { kind: 'new_once' }, status: 'active' },
    { id: 'd', target: { kind: 'session', sessionId: 'worker' }, status: 'ended' }]
  const modern = { catalog: async () => rows, view: async ({ id }) => rows.find(row => row.id === id) ?? { code: 'schedule_not_found' },
    edit: async value => { calls.push(value); return { deleted: true } }, create: async value => { calls.push(value); return { ...value, status: 'active', id: 'new' } } }
  const compat = adaptScheduleService(modern)
  assert.deepEqual((await compat.list({ sessionId: 'worker' })).map(row => row.id), ['a'])
  const created = await compat.create('worker', { title: 'Check', prompt: 'Do work', at: '2026-12-01T00:00:00Z' })
  assert.equal(created.sessionId, 'worker')
  assert.deepEqual(calls[0], { title: 'Check', prompt: 'Do work', timing: { kind: 'at', at: '2026-12-01T00:00:00Z' }, target: { kind: 'session', sessionId: 'worker' } })
  assert.equal((await compat.delete({ sessionId: 'worker', id: 'b' })).deleted, false)
  assert.equal(calls.length, 1, 'another Session task is never deleted')
  await compat.delete({ sessionId: 'worker', id: 'a' })
  assert.deepEqual(calls[1], { id: 'a', action: 'delete', expectedUpdatedAt: 'v1' })
  await assert.rejects(compat.create('worker', { title: 'Invalid', at: 'now', every_seconds: 60 }), /BOT_SCHEDULE_TIMING_INVALID/)
})
