import test from 'node:test'
import assert from 'node:assert/strict'
import { createAcknowledgedRoutineRecorder } from '../apps/integration-client/routine-recorder.mjs'

const display = { displayId: 'screen-a', width: 800, height: 600, dpi: 96, coordinateSpace: 'display-physical-pixels' }
const event = { type: 'text', text: 'actual human input' }
const meta = { id: 1, sessionId: 'desktop-a', sentAt: 20 }
const make = () => {
  const recorder = createAcknowledgedRoutineRecorder({ now: () => 100 })
  recorder.start({ sessionId: 'desktop-a', mode: 'control', metadata: display })
  return recorder
}
const code = expected => failure => failure.code === expected

test('demonstration cannot save a sent input until its native ACK and release are confirmed', () => {
  const recorder = make()
  recorder.inputSent(event, meta)
  assert.equal(recorder.snapshot.length, 0)
  assert.throws(() => recorder.finish({ name: 'draft' }), code('ROUTINE_INPUT_PENDING'))
  recorder.inputAcknowledged(event, { ...meta, acknowledgedAt: 25 })
  assert.throws(() => recorder.finish({ name: 'draft' }), code('ROUTINE_RELEASE_REQUIRED'))
  recorder.released({ sessionId: meta.sessionId, ok: true })
  const routine = recorder.finish({ name: 'confirmed' })
  assert.deepEqual(routine.steps, [{ action: 'input', event, delayMs: 0 }])
  assert.equal(routine.recording.acknowledgedInputs, 1)
})

test('demonstration lost ACK invalidates the recording rather than saving a partial successful tape', () => {
  const recorder = make()
  recorder.inputSent(event, meta); recorder.inputAcknowledged(event, meta)
  const second = { ...meta, id: 2, sentAt: 30 }
  recorder.inputSent(event, second)
  recorder.inputFailed(event, { ...second, failure: { status: 'unknown', possiblyApplied: true } })
  assert.equal(recorder.snapshot.status, 'invalid')
  assert.throws(() => recorder.finish({ name: 'partial' }), code('ROUTINE_ACK_LOST'))
})

test('demonstration preserves acknowledged send order and timing even if ACK callbacks arrive out of order', () => {
  const recorder = make(), second = { ...meta, id: 2, sentAt: 70 }
  recorder.inputSent(event, meta); recorder.inputSent({ ...event, text: 'next' }, second)
  recorder.inputAcknowledged({ ...event, text: 'next' }, second)
  assert.equal(recorder.snapshot.length, 0)
  recorder.inputAcknowledged(event, meta); recorder.released({ sessionId: meta.sessionId, ok: true })
  assert.deepEqual(recorder.finish({ name: 'ordered' }).steps.map(step => step.delayMs), [0, 50])
})

test('demonstration refuses a changed session or display and never treats watch mode as control', () => {
  const recorder = make()
  recorder.metadataChanged({ ...display, width: 1_024 })
  assert.equal(recorder.snapshot.error, 'ROUTINE_DISPLAY_CHANGED')
  recorder.reset()
  assert.throws(() => recorder.start({ sessionId: 'desktop-a', mode: 'watch', metadata: display }), code('ROUTINE_CONTROL_REQUIRED'))
  recorder.start({ sessionId: 'desktop-a', mode: 'control', metadata: display })
  recorder.inputSent(event, { ...meta, sessionId: 'another' })
  assert.equal(recorder.snapshot.error, 'ROUTINE_RECORDING_SESSION_CHANGED')
})

test('hundreds of 60 Hz mouse ACKs become timed waypoints while every button/key/text and drag endpoint survives', () => {
  let at = 0, id = 0
  const recorder = createAcknowledgedRoutineRecorder({ now: () => at }), observed = []
  recorder.start({ sessionId: 'desktop-a', mode: 'control', metadata: display })
  const feed = event => {
    at += 16
    const meta = { id: ++id, sessionId: 'desktop-a', sentAt: at }
    observed.push({ event, at }); recorder.inputSent(event, meta); recorder.inputAcknowledged(event, meta)
  }
  const move = (x, y) => ({ type: 'pointer', action: 'move', x, y, button: 'left' })
  for (let index = 0; index < 300; index++) feed(move(index, 100))
  feed({ type: 'pointer', action: 'down', x: 299, y: 100, button: 'left' })
  for (let index = 0; index < 300; index++) feed(move(300 + index, 100 + index % 200))
  feed({ type: 'pointer', action: 'up', x: 599, y: 199, button: 'left' })
  feed({ type: 'text', text: 'after drag' })
  feed({ type: 'key', action: 'down', code: 'Enter', key: 'Enter' }); feed({ type: 'key', action: 'up', code: 'Enter', key: 'Enter' })
  recorder.released({ sessionId: 'desktop-a', ok: true })
  const saved = recorder.finish({ name: 'sampled mouse' }), moving = event => event.type === 'pointer' && event.action === 'move'
  assert.ok(saved.steps.length < 100); assert.equal(saved.recording.observedInputs, 605); assert.equal(saved.recording.pointerSampleMs, 200)
  let elapsed = 0
  const timeline = saved.steps.map(step => ({ event: step.event, at: elapsed += step.delayMs }))
  assert.deepEqual(timeline.filter(item => !moving(item.event)), observed.filter(item => !moving(item.event)).map(item => ({ ...item, at: item.at - observed[0].at })))
  const down = saved.steps.findIndex(step => step.event.action === 'down' && step.event.type === 'pointer')
  const up = saved.steps.findIndex(step => step.event.action === 'up' && step.event.type === 'pointer')
  assert.deepEqual(saved.steps[down - 1].event, move(299, 100)); assert.deepEqual(saved.steps[up - 1].event, move(599, 199))
  assert.equal(elapsed, observed.at(-1).at - observed[0].at, 'sampling preserves the total demonstrated input timing')
})

test('more than 200 non-coalescible acknowledged actions still invalidate the whole demonstration', () => {
  const recorder = make()
  for (let id = 1; id <= 201; id++) {
    const current = { ...meta, id, sentAt: id }
    recorder.inputSent(event, current); recorder.inputAcknowledged(event, current)
  }
  assert.equal(recorder.snapshot.status, 'invalid'); assert.equal(recorder.snapshot.error, 'ROUTINE_TOO_LONG')
  assert.throws(() => recorder.finish({ name: 'cannot truncate text' }), code('ROUTINE_TOO_LONG'))
})
