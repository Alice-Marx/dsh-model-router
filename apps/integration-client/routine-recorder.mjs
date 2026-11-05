import { MAX_ROUTINE_STEPS, normalizeRoutine, normalizeRoutineDisplay, normalizeRoutineInput } from '../../packages/orchestration/src/bot-routine.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const fail = code => { throw Object.assign(new Error(code), { code }) }
export const ROUTINE_POINTER_SAMPLE_MS = 200
const MAX_PENDING_INPUTS = 1_024

/** A demonstration contains only inputs that this desktop connection actually acknowledged. */
export function createAcknowledgedRoutineRecorder({ now = Date.now, onChange } = {}) {
  const listeners = new Set(), pending = new Map()
  let status = 'idle', error = null, sessionId = null, display = null, startedAt = 0, steps = [], times = [], moveGroup = null, lastId = 0, inputReleased = false
  let observedInputs = 0, coalescedMoves = 0
  const snapshot = () => ({ status, error, sessionId, display: display ? { ...display } : null, startedAt,
    length: steps.length, pending: pending.size, inputReleased, observedInputs, coalescedMoves })
  const emit = () => { const value = snapshot(); onChange?.(value); for (const listener of listeners) listener(value) }
  const invalidate = code => { if (status === 'recording') { status = 'invalid'; error = code; emit() } }
  const sameSession = meta => meta?.sessionId === sessionId
  const flush = () => {
    while (pending.size) {
      const [id, item] = pending.entries().next().value
      if (!item.acknowledged) return
      const movement = item.event.type === 'pointer' && item.event.action === 'move'
      const at = Math.max(item.sentAt, times.at(-1) ?? item.sentAt)
      const continuing = movement && moveGroup?.button === item.event.button
      const bucket = continuing ? Math.floor((at - moveGroup.startedAt) / ROUTINE_POINTER_SAMPLE_MS) : 0
      // Keep a segment's first position, then the final acknowledged position in each
      // time bucket. The mutable tail always keeps its actual timestamp, so the exact
      // final position and pause before every button/key/text action survive sampling.
      const replace = continuing && moveGroup.tailIndex !== null && moveGroup.bucket === bucket
      const index = replace ? steps.length - 1 : steps.length
      if (!replace && steps.length >= MAX_ROUTINE_STEPS) { invalidate('ROUTINE_TOO_LONG'); return }
      const delayMs = index === 0 ? 0 : Math.max(0, Math.round(at - times[index - 1]))
      if (delayMs > 60_000) { invalidate('ROUTINE_PAUSE_TOO_LONG'); return }
      steps[index] = { action: 'input', event: item.event, delayMs }; times[index] = at
      if (!movement) moveGroup = null
      else if (!continuing) moveGroup = { startedAt: at, bucket: 0, tailIndex: null, button: item.event.button }
      else { moveGroup.bucket = bucket; moveGroup.tailIndex = index }
      observedInputs++; if (replace) coalescedMoves++
      pending.delete(id)
    }
  }
  return Object.freeze({
    get snapshot() { return snapshot() },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    start({ sessionId: id, mode, metadata } = {}) {
      if (status === 'recording' || pending.size) fail('ROUTINE_ALREADY_RECORDING')
      if (typeof id !== 'string' || !id || mode !== 'control') fail('ROUTINE_CONTROL_REQUIRED')
      display = normalizeRoutineDisplay(metadata); sessionId = id; status = 'recording'; error = null
      startedAt = now(); steps = []; times = []; moveGroup = null; pending.clear(); lastId = 0; inputReleased = false
      observedInputs = 0; coalescedMoves = 0; emit()
      return snapshot()
    },
    inputSent(raw, meta) {
      if (status !== 'recording') return
      if (!sameSession(meta) || !Number.isSafeInteger(meta.id) || meta.id <= lastId || !Number.isFinite(meta.sentAt)) { invalidate('ROUTINE_RECORDING_SESSION_CHANGED'); return }
      let event
      try { event = normalizeRoutineInput(raw) } catch { invalidate('ROUTINE_INPUT_UNSUPPORTED'); return }
      if (pending.size >= MAX_PENDING_INPUTS) { invalidate('ROUTINE_INPUT_PENDING_LIMIT'); return }
      if (event.type === 'pointer' && (event.x >= display.width || event.y >= display.height)) { invalidate('ROUTINE_POINT_OUTSIDE_DISPLAY'); return }
      pending.set(meta.id, { event, sentAt: meta.sentAt, acknowledged: false }); lastId = meta.id; inputReleased = false; emit()
    },
    inputAcknowledged(raw, meta) {
      if (status !== 'recording') return
      const item = pending.get(meta?.id)
      let event
      try { event = normalizeRoutineInput(raw) } catch { invalidate('ROUTINE_ACK_MISMATCH'); return }
      if (!sameSession(meta) || !item || JSON.stringify(item.event) !== JSON.stringify(event)) { invalidate('ROUTINE_ACK_MISMATCH'); return }
      item.acknowledged = true; flush(); emit()
    },
    inputFailed(_event, meta) {
      if (status !== 'recording') return
      invalidate(meta?.failure?.status === 'unknown' || meta?.failure?.possiblyApplied !== false ? 'ROUTINE_ACK_LOST' : 'ROUTINE_DEMONSTRATION_FAILED')
    },
    metadataChanged(metadata) {
      if (status !== 'recording' || !metadata?.width) return
      let next
      try { next = normalizeRoutineDisplay({ ...display, ...metadata }) } catch { invalidate('ROUTINE_DISPLAY_CHANGED'); return }
      if (['displayId', 'width', 'height', 'coordinateSpace', 'dpi'].some(field => next[field] !== display[field])) invalidate('ROUTINE_DISPLAY_CHANGED')
    },
    released(meta) {
      if (status !== 'recording') return
      if (!sameSession(meta) || meta.ok !== true || pending.size) { invalidate('ROUTINE_RELEASE_UNCONFIRMED'); return }
      inputReleased = true; emit()
    },
    invalidate,
    finish({ name, description } = {}) {
      if (status !== 'recording') fail(error ?? 'ROUTINE_NOT_RECORDING')
      if (pending.size) fail('ROUTINE_INPUT_PENDING')
      if (!inputReleased) fail('ROUTINE_RELEASE_REQUIRED')
      const value = normalizeRoutine({ name, description, steps, recording: { source: 'desktop-session', display,
        recordedAt: startedAt, durationMs: Math.max(0, now() - startedAt), acknowledgedInputs: steps.length,
        ...(coalescedMoves ? { observedInputs, pointerSampleMs: ROUTINE_POINTER_SAMPLE_MS } : {}) } })
      status = 'finished'; emit(); return clone(value)
    },
    reset() { status = 'idle'; error = null; pending.clear(); steps = []; times = []; moveGroup = null; sessionId = null; display = null; observedInputs = 0; coalescedMoves = 0; emit() },
  })
}
