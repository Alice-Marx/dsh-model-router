/**
 * Read one Host model stream into the small reply shape the independent loop expects.
 *
 * The chunk vocabulary is the Host's own (`text-delta`, `tool-call-delta`, `usage`, `finish`), so
 * an independent turn sees exactly what an integrated one sees. Two older spellings are accepted
 * as well because a fixture or a narrow adapter may emit them; nothing else is invented.
 *
 * The outcome is read, not assumed: a stream that ends without a finish, or with an error or an
 * abort, is reported as failed so the caller writes no answer. Usage is deliberately not read
 * here — the one money authority observes it on the same stream.
 */

/**
 * The Host's finish vocabulary. It is merge-extensible, so a kind this module has not been taught
 * is a refusal rather than an answer: an outcome that cannot be read is not a completed turn.
 */
const FINISH_KINDS = Object.freeze({
  stop: null,
  'tool-calls': null,
  'max-tokens': 'MODEL_STREAM_TRUNCATED',
  aborted: 'MODEL_STREAM_ABORTED',
  error: 'MODEL_STREAM_ERROR',
})

const finishFailed = reason => {
  const kind = reason?.kind
  if (typeof kind !== 'string' || !Object.hasOwn(FINISH_KINDS, kind)) return 'MODEL_STREAM_REASON_UNKNOWN'
  return FINISH_KINDS[kind]
}

/**
 * @param {AsyncIterable<object> | Iterable<object>} stream
 * @returns {Promise<{ text: string, toolCalls: object[], failed: string | null }>}
 */
export async function collectAnswer(stream, { onText } = {}) {
  let text = ''
  const calls = new Map()
  let finished = false
  let failed = null
  for await (const chunk of stream) {
    if (typeof chunk === 'string') { text += chunk; if (onText) await onText(text); continue }
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' || chunk.type === 'text' || chunk.type === 'delta') {
      if (typeof chunk.text === 'string') { text += chunk.text; if (onText) await onText(text) }
      continue
    }
    if (chunk.type === 'tool-call-delta') {
      const id = typeof chunk.id === 'string' && chunk.id ? chunk.id : null
      if (!id) { failed ??= 'MODEL_TOOL_CALL_ID_MISSING'; continue }
      const call = calls.get(id) ?? { id, name: '', args: '' }
      if (typeof chunk.name === 'string' && chunk.name) call.name = chunk.name
      if (typeof chunk.argumentsDelta === 'string') call.args += chunk.argumentsDelta
      calls.set(id, call)
      continue
    }
    if (chunk.type === 'usage') continue
    if (chunk.type === 'finish') {
      finished = true
      failed ??= finishFailed(chunk.reason)
    }
  }
  if (!finished && failed === null) failed = 'MODEL_STREAM_UNFINISHED'
  const toolCalls = []
  for (const call of calls.values()) {
    if (failed === null && !call.name) failed = 'MODEL_TOOL_CALL_NAME_MISSING'
    let args = {}
    if (call.args) {
      try { args = JSON.parse(call.args) } catch { if (failed === null) failed = 'MODEL_TOOL_CALL_ARGS_INVALID' }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) { if (failed === null) failed = 'MODEL_TOOL_CALL_ARGS_INVALID'; args = {} }
    toolCalls.push({ id: call.id, name: call.name, args })
  }
  return { text, toolCalls, failed }
}
