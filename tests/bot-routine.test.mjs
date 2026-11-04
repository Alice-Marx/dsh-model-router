import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ROUTINE_STEPS, createRoutineRecorder, normalizeRoutine, normalizeStep, replayRoutine } from '../packages/orchestration/src/bot-routine.mjs'

const code = expected => error => { assert.equal(error.code, expected, error.message); return true }

test('routine: only the closed set of actions is accepted, with validated arguments', () => {
  assert.deepEqual(normalizeStep({ action: 'click', x: 10, y: 20 }), { action: 'click', x: 10, y: 20 })
  assert.deepEqual(normalizeStep({ action: 'key', key: 'Enter', modifiers: ['ctrl', 'nope'] }), { action: 'key', key: 'Enter', modifiers: ['ctrl'] })
  assert.throws(() => normalizeStep({ action: 'shell', command: 'rm -rf /' }), code('ROUTINE_ACTION_UNKNOWN'))
  assert.throws(() => normalizeStep({ action: 'click', x: -1, y: 0 }), code('ROUTINE_STEP_INVALID'))
  assert.throws(() => normalizeStep({ action: 'type', text: '' }), code('ROUTINE_STEP_INVALID'))
  assert.throws(() => normalizeStep({ action: 'key', key: 'F13' }), code('ROUTINE_STEP_INVALID'))
  assert.throws(() => normalizeStep({ action: 'wait', ms: 999999 }), code('ROUTINE_STEP_INVALID'))
})

test('routine: recording is bounded, undoable, and finishing clears the tape', () => {
  const recorder = createRoutineRecorder({ now: () => 1 })
  recorder.append({ action: 'click', x: 1, y: 2 })
  recorder.append({ action: 'type', text: 'hello' })
  assert.equal(recorder.length, 2)
  assert.deepEqual(recorder.undo(), { action: 'type', text: 'hello' })
  const routine = recorder.finish({ name: '打开设置' })
  assert.equal(routine.steps.length, 1)
  assert.equal(recorder.length, 0, 'finishing clears the tape')
  assert.throws(() => createRoutineRecorder().finish({ name: '空' }), code('ROUTINE_EMPTY'))
})

test('routine: an over-long routine is refused instead of truncated', () => {
  const steps = Array.from({ length: MAX_ROUTINE_STEPS + 1 }, () => ({ action: 'wait', ms: 0 }))
  assert.throws(() => normalizeRoutine({ name: 'long', steps }), code('ROUTINE_TOO_LONG'))
})

test('routine: a replay stops at the first failure and says where', async () => {
  const routine = normalizeRoutine({ name: 'r', steps: [{ action: 'click', x: 1, y: 1 }, { action: 'click', x: 2, y: 2 }, { action: 'click', x: 3, y: 3 }] })
  const seen = []
  const failed = await replayRoutine(routine, { act: step => { if (step.x === 2) throw new Error('boom'); seen.push(step.x) } })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.stoppedAt, 1)
  assert.deepEqual(failed.steps, [0])
  assert.deepEqual(seen, [1])
})

test('routine: a replay reports success in order and honours cancellation', async () => {
  const routine = normalizeRoutine({ name: 'r', steps: [{ action: 'type', text: 'a' }, { action: 'type', text: 'b' }] })
  const order = []
  const ok = await replayRoutine(routine, { act: step => { order.push(step.text) } })
  assert.equal(ok.status, 'succeeded')
  assert.deepEqual(order, ['a', 'b'])
  const controller = { aborted: true }
  const cancelled = await replayRoutine(routine, { act: () => { throw new Error('should not run') }, signal: controller })
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.stoppedAt, 0)
})

test('routine: wait steps pause without calling the machine', async () => {
  const routine = normalizeRoutine({ name: 'r', steps: [{ action: 'wait', ms: 1 }, { action: 'click', x: 1, y: 1 }] })
  let acted = 0
  const result = await replayRoutine(routine, { act: () => { acted += 1 } })
  assert.equal(result.status, 'succeeded')
  assert.equal(acted, 1, 'the wait step never reaches the machine')
})
