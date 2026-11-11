// Pure Claude Code stream-json protocol helpers for the conversation-session adapter.
//
// Adapted from OpenMausBot server/drivers/claude.ts at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
// These functions are side-effect free so they can be tested without any child process.

/** Turn text bounds mirror the target's CLI turn validation. */
export function validTurnText(text) {
  return typeof text === 'string' && text.trim() !== '' && !text.includes('\0') && Buffer.byteLength(text) <= 64_000
}

/** A stdin user message. The prompt rides stdin, never argv. */
export function claudeUserMessage(text) {
  return { type: 'user', message: { role: 'user', content: text } }
}

const firstText = content => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('')
}

/** What an error `result` says failed: its errors list, else its result text, else its kind. */
export function claudeResultError(frame) {
  const errors = Array.isArray(frame.errors) ? frame.errors.filter(value => typeof value === 'string' && value.trim() !== '') : []
  if (errors.length) return errors.join('; ')
  if (typeof frame.result === 'string' && frame.result.trim()) return frame.result
  return `Claude ended the turn with an error (${String((frame.subtype !== 'success' && frame.subtype) || frame.terminal_reason || 'unknown')}).`
}

/** A turn's cost from total_cost_usd, which is the process's running total: the growth
 * since `previous`, or the whole figure when the start is unknown or the total went down.
 * Anything the CLI did not report as a finite number is not a cost: it stays null. */
export function turnCostFromRunningTotal(total, previous) {
  if (typeof total !== 'number' || !Number.isFinite(total)) return null
  if (previous === null || total < previous) return total
  return Number((total - previous).toFixed(10))
}

/** total_cost_usd and per-model modelUsage [input, cache read, cache write, output] from a
 * `result`; both cover the whole session, including what --resume restored. */
export function claudeCostSnapshot(total, modelUsage) {
  if (typeof total !== 'number' || !Number.isFinite(total)) return null
  const count = value => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const models = {}
  if (modelUsage && typeof modelUsage === 'object' && !Array.isArray(modelUsage)) {
    for (const [model, raw] of Object.entries(modelUsage)) {
      if (!raw || typeof raw !== 'object') continue
      models[model] = [count(raw.inputTokens), count(raw.cacheReadInputTokens), count(raw.cacheCreationInputTokens), count(raw.outputTokens)]
    }
  }
  return { total, models }
}

/** One native `result` frame. */
export function nativeTurnResult(frame) {
  const usage = frame.usage && typeof frame.usage === 'object' ? frame.usage : null
  return {
    ok: frame.is_error !== true,
    stopReason: frame.is_error === true
      ? frame.terminal_reason ?? (typeof frame.subtype === 'string' && frame.subtype !== 'success' ? frame.subtype : null) ?? frame.stop_reason ?? null
      : frame.stop_reason ?? frame.terminal_reason ?? null,
    cost: typeof frame.total_cost_usd === 'number' && Number.isFinite(frame.total_cost_usd) ? frame.total_cost_usd : null,
    ...(usage ? { usage: resultUsage(usage) } : {}),
  }
}

/** result.usage is per turn "in streaming-input sessions" even on a retained process;
 * input components (fresh + cache read + cache write) are summed, cachedInput reported
 * separately, and anything missing stays null instead of being invented. */
export function resultUsage(usage) {
  const nonNegative = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)
  const input = nonNegative(usage.input_tokens)
  const cacheRead = nonNegative(usage.cache_read_input_tokens)
  const cacheWrite = nonNegative(usage.cache_creation_input_tokens)
  const output = nonNegative(usage.output_tokens)
  if (input === null && cacheRead === null && cacheWrite === null && output === null) return null
  const parts = [input, cacheRead, cacheWrite].filter(value => value !== null)
  return {
    input: parts.length ? parts.reduce((sum, value) => sum + value, 0) : null,
    output,
    ...(cacheRead !== null ? { cachedInput: cacheRead } : {}),
  }
}

/** Merges native turns into one logical turn. Cost takes the latest figure: total_cost_usd
 * is cumulative and the latest result is read rather than summed. */
export function sumNativeTurnResults(earlier, latest) {
  if (!earlier) return latest
  const usage = earlier.usage && latest.usage
    ? {
        input: (earlier.usage.input ?? 0) + (latest.usage.input ?? 0),
        output: (earlier.usage.output ?? 0) + (latest.usage.output ?? 0),
        ...((earlier.usage.cachedInput !== undefined || latest.usage.cachedInput !== undefined)
          ? { cachedInput: (earlier.usage.cachedInput ?? 0) + (latest.usage.cachedInput ?? 0) } : {}),
      }
    : latest.usage ?? earlier.usage
  return {
    ok: earlier.ok && latest.ok,
    stopReason: latest.stopReason ?? earlier.stopReason,
    cost: latest.cost ?? earlier.cost,
    ...(usage ? { usage } : {}),
  }
}

/**
 * Classify one parsed stdout JSON line into a typed protocol event. Anything the engine
 * does not act on is returned as { type: 'ignored', raw } rather than dropped silently.
 */
export function classifyClaudeFrame(frame) {
  if (!frame || typeof frame !== 'object') return { type: 'ignored', reason: 'not-an-object' }
  switch (frame.type) {
    case 'system':
      if (frame.subtype === 'init') {
        return {
          type: 'init',
          sessionId: typeof frame.session_id === 'string' && frame.session_id ? frame.session_id : null,
          model: typeof frame.model === 'string' && frame.model ? frame.model : null,
          permissionMode: typeof frame.permissionMode === 'string' && frame.permissionMode ? frame.permissionMode : null,
          tools: Array.isArray(frame.tools) ? frame.tools.filter(value => typeof value === 'string') : [],
        }
      }
      if (frame.subtype === 'compact_boundary') return { type: 'compacted' }
      return { type: 'ignored', reason: `system/${frame.subtype}` }
    case 'stream_event': {
      const event = frame.event ?? {}
      const delta = event.delta ?? {}
      if (frame.parent_tool_use_id) return { type: 'ignored', reason: 'subagent-narration' }
      if (event.type === 'content_block_delta') {
        if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) return { type: 'assistant-delta', delta: delta.text }
        if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) return { type: 'reasoning-delta', delta: delta.thinking }
      }
      return { type: 'ignored', reason: `stream_event/${event.type ?? 'unknown'}` }
    }
    case 'assistant': {
      const message = frame.message ?? {}
      const text = firstText(message.content)
      const out = { type: 'assistant', text }
      if (Array.isArray(message.content)) {
        const toolUses = message.content.filter(block => block?.type === 'tool_use')
        if (toolUses.length) out.toolUses = toolUses.map(block => ({ id: typeof block.id === 'string' ? block.id : null, name: typeof block.name === 'string' ? block.name : null, input: block.input ?? null }))
      }
      if (message.usage && typeof message.usage === 'object') out.usage = message.usage
      return out
    }
    case 'user': {
      if (frame.isReplay === true) return { type: 'replay' }
      const content = frame.message?.content
      if (!Array.isArray(content)) return { type: 'ignored', reason: 'user/non-tool-result' }
      const results = content.filter(block => block?.type === 'tool_result')
      if (!results.length) return { type: 'ignored', reason: 'user/non-tool-result' }
      return {
        type: 'tool-result',
        results: results.map(block => ({ toolUseId: typeof block.tool_use_id === 'string' ? block.tool_use_id : null, ok: block.is_error !== true })),
      }
    }
    case 'result':
      if (frame.origin?.kind === 'task-notification') return { type: 'ignored', reason: 'task-notification' }
      return { type: 'result', isError: frame.is_error === true, native: nativeTurnResult(frame), errors: Array.isArray(frame.errors) ? frame.errors.filter(value => typeof value === 'string') : [] }
    default:
      return { type: 'ignored', reason: `type/${String(frame.type)}` }
  }
}

/** Permission broker wire parsing (host side). A line must be {t:'ask', id, kind, tool, input}. */
export function parseBrokerAsk(message) {
  if (!message || typeof message !== 'object' || message.t !== 'ask') return null
  const id = typeof message.id === 'string' && message.id ? message.id : null
  if (!id) return null
  const kind = message.kind === 'question' ? 'question' : 'permission'
  return { id, kind, tool: typeof message.tool === 'string' && message.tool ? message.tool : 'tool', input: message.input && typeof message.input === 'object' && !Array.isArray(message.input) ? message.input : {} }
}

/** Serialize a broker answer line. */
export function brokerAnswer(id, behavior, message, source, always = false) {
  return { t: 'answer', id, behavior, message, source, ...(always ? { always: true } : {}) }
}
