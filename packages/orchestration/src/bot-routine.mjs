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

export const ROUTINE_ACTIONS = Object.freeze(['click', 'type', 'key', 'scroll', 'wait'])
export const MAX_ROUTINE_STEPS = 200
export const MAX_TYPE_LENGTH = 2000

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }
const finiteInt = value => typeof value === 'number' && Number.isSafeInteger(value)

/** One recorded step, or a refusal that names the field. */
export function normalizeStep(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('ROUTINE_STEP_INVALID', '步骤必须是对象。')
  const action = input.action
  if (!ROUTINE_ACTIONS.includes(action)) fail('ROUTINE_ACTION_UNKNOWN', `未知动作：${String(action)}`)
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
  return {
    schemaVersion: 1,
    name,
    ...(typeof input.description === 'string' && input.description.trim() ? { description: input.description.trim().slice(0, 500) } : {}),
    steps: input.steps.map(normalizeStep),
  }
}

/** Records steps as a person demonstrates them. The recorder refuses what the routine format refuses. */
export function createRoutineRecorder({ now = Date.now } = {}) {
  let steps = []
  let started = now()
  return Object.freeze({
    get length() { return steps.length },
    get steps() { return steps.map(step => ({ ...step })) },
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
      if (step.action === 'wait') await new Promise(resolve => setTimeout(resolve, step.ms))
      else await act(step, index)
      done.push(index)
      if (typeof onStep === 'function') onStep(step, index)
    } catch (failure) {
      return { status: 'failed', steps: done, stoppedAt: index, error: String(failure?.message ?? failure) }
    }
  }
  return { status: 'succeeded', steps: done, stoppedAt: null }
}
