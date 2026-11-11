/**
 * Routines: show a Bot a workflow once, and it can run it again.
 *
 * A routine is a bounded, validated list of steps against a machine — never a script, never a path.
 * Three rules keep it honest:
 *
 *  - every step is one of a closed set of actions with validated arguments, so a recorded routine
 *    cannot smuggle in a shell command;
 *  - recording and replaying are separate objects: recording only appends, replaying only acts;
 *  - a replay stops at the first failed step and reports where it stopped, so a half-run routine is
 *    never mistaken for a finished one.
 */

export const ROUTINE_ACTIONS = Object.freeze(['click', 'type', 'key', 'scroll', 'wait', 'input', 'release-input'])
export const MAX_ROUTINE_STEPS = 200
export const MAX_TYPE_LENGTH = 2000
export const MAX_RECORDED_TEXT_LENGTH = 8192

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }
const finiteInt = value => typeof value === 'number' && Number.isSafeInteger(value)
const clone = value => JSON.parse(JSON.stringify(value))
const closed = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('ROUTINE_INPUT_INVALID')
}

/** The same physical-display input that the desktop session accepts; never executable code. */
export function normalizeRoutineInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ROUTINE_INPUT_INVALID')
  const { type } = value
  if (type === 'pointer') {
    closed(value, ['type', 'action', 'x', 'y', 'button'])
    if (!['move', 'down', 'up'].includes(value.action) || !finiteInt(value.x) || !finiteInt(value.y)
      || value.x < 0 || value.y < 0 || value.x > 100_000 || value.y > 100_000
      || value.button !== undefined && !['left', 'middle', 'right'].includes(value.button)) fail('ROUTINE_INPUT_INVALID')
    return { type, action: value.action, x: value.x, y: value.y, button: value.button ?? 'left' }
  }
  if (type === 'key') {
    closed(value, ['type', 'action', 'code', 'key'])
    if (!['down', 'up'].includes(value.action) || typeof value.code !== 'string'
      || !/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal)|Enter|Tab|Escape|Backspace|Delete|Insert|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Space|(?:Control|Alt|Shift|Meta)(?:Left|Right)|CapsLock|NumLock|ScrollLock|PrintScreen|Pause|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen|ContextMenu)$/u.test(value.code)
      || typeof value.key !== 'string' || !value.key || value.key.length > 64 || /[\u0000-\u001f\u007f]/u.test(value.key)) fail('ROUTINE_INPUT_INVALID')
    return { type, action: value.action, code: value.code, key: value.key }
  }
  if (type === 'wheel') {
    closed(value, ['type', 'deltaX', 'deltaY'])
    if (!finiteInt(value.deltaX) || !finiteInt(value.deltaY) || Math.abs(value.deltaX) > 4_800 || Math.abs(value.deltaY) > 4_800
      || value.deltaX === 0 && value.deltaY === 0) fail('ROUTINE_INPUT_INVALID')
    return { type, deltaX: value.deltaX, deltaY: value.deltaY }
  }
  if (type === 'text') {
    closed(value, ['type', 'text'])
    if (typeof value.text !== 'string' || !value.text || value.text.length > MAX_RECORDED_TEXT_LENGTH || value.text.includes('\u0000')) fail('ROUTINE_INPUT_INVALID')
    return { type, text: value.text }
  }
  fail('ROUTINE_INPUT_INVALID')
}

export function normalizeRoutineDisplay(value) {
  if (!value || typeof value !== 'object' || !finiteInt(value.width) || !finiteInt(value.height)
    || value.width < 1 || value.height < 1 || value.width > 100_000 || value.height > 100_000
    || typeof value.displayId !== 'string' || !value.displayId || value.displayId.length > 128 || /[\u0000-\u001f]/u.test(value.displayId)
    || value.coordinateSpace !== 'display-physical-pixels') fail('ROUTINE_DISPLAY_INVALID')
  if (value.dpi !== undefined && (!Number.isFinite(value.dpi) || value.dpi < 24 || value.dpi > 1_920)) fail('ROUTINE_DISPLAY_INVALID')
  return { displayId: value.displayId, width: value.width, height: value.height, coordinateSpace: value.coordinateSpace,
    ...(value.dpi !== undefined ? { dpi: value.dpi } : {}) }
}

/** One recorded step, or a refusal that names the field. */
export function normalizeStep(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('ROUTINE_STEP_INVALID', '步骤必须是对象。')
  const action = input.action
  if (!ROUTINE_ACTIONS.includes(action)) fail('ROUTINE_ACTION_UNKNOWN', `未知动作：${String(action)}`)
  if (action === 'input' || action === 'release-input') {
    const delayMs = input.delayMs ?? 0
    if (!finiteInt(delayMs) || delayMs < 0 || delayMs > 60_000) fail('ROUTINE_STEP_INVALID')
    return action === 'release-input' ? { action, delayMs } : { action, event: normalizeRoutineInput(input.event), delayMs }
  }
  if (action === 'click') {
    if (!finiteInt(input.x) || !finiteInt(input.y) || input.x < 0 || input.y < 0) fail('ROUTINE_STEP_INVALID', 'click 需要非负整数坐标。')
    return { action, x: input.x, y: input.y, ...(input.button === 'right' ? { button: 'right' } : {}) }
  }
  if (action === 'type') {
    const text = String(input.text ?? '')
    if (text.length === 0) fail('ROUTINE_STEP_INVALID', 'type 需要内容。')
    if (text.length > MAX_TYPE_LENGTH) fail('ROUTINE_STEP_INVALID', `type 内容不能超过 ${MAX_TYPE_LENGTH} 字符。`)
    return { action, text }
  }
  if (action === 'key') {
    const key = String(input.key ?? '')
    if (!/^(Enter|Tab|Escape|Backspace|Delete|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Space)$/u.test(key)) fail('ROUTINE_STEP_INVALID', `不支持的按键：${key}`)
    return { action, key, ...(Array.isArray(input.modifiers) && input.modifiers.length > 0 ? { modifiers: input.modifiers.filter(name => ['ctrl', 'alt', 'shift'].includes(name)) } : {}) }
  }
  if (action === 'scroll') {
    if (!finiteInt(input.delta) || input.delta === 0) fail('ROUTINE_STEP_INVALID', 'scroll 需要非零整数 delta。')
    return { action, delta: input.delta }
  }
  // wait: a pause between steps, bounded so a routine cannot stall for hours.
  const ms = input.ms
  if (!finiteInt(ms) || ms < 0 || ms > 60_000) fail('ROUTINE_STEP_INVALID', 'wait 需要 0..60000 毫秒。')
  return { action: 'wait', ms }
}

/** A complete routine: a name and its steps, bounded and validated. */
export function normalizeRoutine(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('ROUTINE_INVALID')
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 120) fail('ROUTINE_NAME_INVALID')
  if (!Array.isArray(input.steps)) fail('ROUTINE_STEPS_INVALID')
  if (input.steps.length === 0) fail('ROUTINE_EMPTY')
  if (input.steps.length > MAX_ROUTINE_STEPS) fail('ROUTINE_TOO_LONG', `最多 ${MAX_ROUTINE_STEPS} 步。`)
  const recorded = input.recording
  if (recorded !== undefined && (!recorded || recorded.source !== 'desktop-session' || !finiteInt(recorded.recordedAt) || recorded.recordedAt < 0
    || !finiteInt(recorded.durationMs) || recorded.durationMs < 0 || recorded.durationMs > 12_000_000
    || !finiteInt(recorded.acknowledgedInputs) || recorded.acknowledgedInputs !== input.steps.filter(step => step.action === 'input').length)) fail('ROUTINE_RECORDING_INVALID')
  if (recorded?.observedInputs !== undefined && (!finiteInt(recorded.observedInputs) || recorded.observedInputs < recorded.acknowledgedInputs
    || recorded.observedInputs > 1_000_000 || recorded.pointerSampleMs !== 200)
    || recorded?.pointerSampleMs !== undefined && (recorded.pointerSampleMs !== 200 || recorded.observedInputs === undefined)) fail('ROUTINE_RECORDING_INVALID')
  const recording = recorded === undefined ? null : { source: 'desktop-session', display: normalizeRoutineDisplay(recorded.display),
    recordedAt: recorded.recordedAt, durationMs: recorded.durationMs, acknowledgedInputs: recorded.acknowledgedInputs,
    ...(recorded.observedInputs !== undefined ? { observedInputs: recorded.observedInputs, pointerSampleMs: recorded.pointerSampleMs } : {}) }
  return {
    schemaVersion: recording || input.steps.some(step => ['input','release-input'].includes(step.action)) ? 2 : 1,
    name,
    ...(typeof input.description === 'string' && input.description.trim() ? { description: input.description.trim().slice(0, 500) } : {}),
    steps: input.steps.map(normalizeStep),
    ...(recording ? { recording } : {}),
  }
}

/** Records steps as a person demonstrates them. The recorder refuses what the routine format refuses. */
export function createRoutineRecorder({ now = Date.now } = {}) {
  let steps = []
  let started = now()
  return Object.freeze({
    get length() { return steps.length },
    get steps() { return clone(steps) },
    get startedAt() { return started },
    append(input) {
      if (steps.length >= MAX_ROUTINE_STEPS) fail('ROUTINE_TOO_LONG', `最多 ${MAX_ROUTINE_STEPS} 步。`)
      const step = normalizeStep(input)
      steps = [...steps, step]
      return step
    },
    undo() {
      if (!steps.length) return null
      const last = steps[steps.length - 1]
      steps = steps.slice(0, -1)
      return last
    },
    /** Freeze the recording into a routine; an empty recording is refused rather than saved. */
    finish({ name, description } = {}) {
      const routine = normalizeRoutine({ name, description, steps })
      steps = []
      started = now()
      return routine
    },
    reset() { steps = []; started = now() },
  })
}

/**
 * Replay a routine against one machine.
 *
 * `act(step)` performs one step and may throw. The replay stops there and reports the index, so the
 * caller can show "stopped at step 4" instead of pretending the workflow completed.
 */
export async function replayRoutine(routine, { act, signal, onStep = null } = {}) {
  if (typeof act !== 'function') fail('ROUTINE_REQUIRES_ACT')
  const normalized = normalizeRoutine(routine)
  const done = []
  for (let index = 0; index < normalized.steps.length; index += 1) {
    if (signal?.aborted) return { status: 'cancelled', steps: done, stoppedAt: index }
    const step = normalized.steps[index]
    try {
      if (step.action === 'wait') await routineDelay(step.ms, signal)
      else await act(step, index)
      done.push(index)
      if (typeof onStep === 'function') onStep(step, index)
    } catch (failure) {
      return { status: failure?.status === 'unknown' || failure?.possiblyApplied === true ? 'unknown'
        : signal?.aborted || failure?.code === 'ROUTINE_CANCELLED' ? 'cancelled' : 'failed',
        steps: done, stoppedAt: index, error: String(failure?.message ?? failure), ...(failure?.code ? { code: failure.code } : {}) }
    }
  }
  return { status: 'succeeded', steps: done, stoppedAt: null }
}

export function routineDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('ROUTINE_CANCELLED'), { code: 'ROUTINE_CANCELLED', status: 'cancelled' }))
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener?.('abort', abort); reject(Object.assign(new Error('ROUTINE_CANCELLED'), { code: 'ROUTINE_CANCELLED', status: 'cancelled' })) }
    const timer = setTimeout(() => { signal?.removeEventListener?.('abort', abort); resolve() }, ms)
    signal?.addEventListener?.('abort', abort, { once: true })
  })
}
