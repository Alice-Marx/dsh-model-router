import { createHash } from 'node:crypto'

const block = text => ({ type: 'text', text })
const sourceOf = value => value?.kind === 'model' && typeof value.provider === 'string' && value.provider && typeof value.model === 'string' && value.model
  ? { kind: 'model', provider: value.provider, model: value.model } : null
const callsOf = row => Array.isArray(row.toolCalls) ? row.toolCalls : row.toolCall ? [row.toolCall] : []
const idOf = (row, occurrence) => row.messageId ?? `independent-${createHash('sha256').update(JSON.stringify({ role: row.role, content: row.content, at: row.at, toolCallId: row.toolCallId, toolCalls: callsOf(row), occurrence })).digest('hex')}`

/** Current committed identity is instructions for this request, never a grant. */
export function independentSystemMessage(bot) {
  const name = typeof bot.name === 'string' && bot.name.trim() ? bot.name.trim() : bot.id
  const role = typeof bot.role === 'string' ? bot.role.trim() : ''
  const instructions = typeof bot.instructions === 'string' ? bot.instructions.trim() : ''
  const text = [`You are ${name}.`, ...(role ? [`Role: ${role}`] : []), ...(instructions ? [instructions] : [])].join('\n\n')
  const id = `independent-system-${createHash('sha256').update(JSON.stringify([bot.id, text])).digest('hex')}`
  return { id, role: 'system', source: { kind: 'system-prompt' }, content: [block(text)] }
}

/**
 * Project the Bot-owned transcript to the installed dsh-llm message vocabulary.
 * This creates no Harness Session and confers no authority. Model provenance comes
 * from each saved reply, never from the Bot's currently selected model. Old rows
 * without provenance and interrupted tool batches remain clearly labeled recall;
 * they cannot become an invented assistant response or a replayable tool call.
 */
export function independentMessageWire(rows) {
  if (!Array.isArray(rows)) throw Object.assign(new Error('INDEPENDENT_TRANSCRIPT_REQUIRED'), { code: 'INDEPENDENT_TRANSCRIPT_REQUIRED' })
  const pending = new Map(), lastOwner = new Map(), results = new Map(), resultOwners = new Map(), complete = new Set(), occurrences = new Map()
  for (const row of rows) {
    if (row.role === 'assistant' && sourceOf(row.modelSource)) {
      const ids = new Set()
      results.set(row, new Map())
      for (const call of callsOf(row)) {
        if (typeof call?.id !== 'string' || !call.id || typeof call.name !== 'string' || !call.name || ids.has(call.id)) {
          throw Object.assign(new Error('INDEPENDENT_TOOL_HISTORY_INVALID'), { code: 'INDEPENDENT_TOOL_HISTORY_INVALID' })
        }
        ids.add(call.id)
        // Providers can reuse an id in a later response. Its nearest preceding
        // request owns the result; an earlier unresolved batch stays recall.
        pending.set(call.id, row)
        lastOwner.set(call.id, row)
      }
    }
    if (row.role === 'tool' && typeof row.toolCallId === 'string') {
      const owner = pending.get(row.toolCallId)
      if (owner) {
        results.get(owner).set(row.toolCallId, row)
        resultOwners.set(row, owner)
        pending.delete(row.toolCallId)
      } else if (lastOwner.has(row.toolCallId)) {
        throw Object.assign(new Error('INDEPENDENT_TOOL_HISTORY_DUPLICATE'), { code: 'INDEPENDENT_TOOL_HISTORY_DUPLICATE' })
      }
    }
  }
  for (const row of rows) {
    const calls = callsOf(row)
    if (row.role === 'assistant' && sourceOf(row.modelSource) && calls.every(call => results.get(row)?.has(call.id))) complete.add(row)
  }
  return rows.map(row => {
    const key = JSON.stringify([row.role, row.at, row.content])
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    const id = idOf(row, occurrence)
    const text = typeof row.content === 'string' ? row.content : ''
    if (row.role === 'user') return { role: 'user', content: [block(text)] }
    if (row.role === 'system') return { id, role: 'system', source: { kind: 'system-prompt' }, content: [block(text)] }
    const source = sourceOf(row.modelSource)
    const calls = callsOf(row)
    if (row.role === 'assistant' && source && complete.has(row)) return {
      id, role: 'assistant', source,
      content: [...(text ? [block(text)] : []), ...calls.map(call => ({ type: 'tool-call', id: call.id, name: call.name, arguments: JSON.stringify(call.args ?? {}) }))],
    }
    const owner = resultOwners.get(row)
    if (owner && complete.has(owner)) return {
      id, role: 'tool', source: { kind: 'tool', callId: row.toolCallId }, toolCallId: row.toolCallId,
      content: [block(text)], ...(row.isError === true ? { isError: true } : {}),
    }
    const label = row.role === 'assistant'
      ? calls.length ? 'Earlier assistant tool request; execution outcome not fully confirmed' : 'Earlier assistant message; model provenance unrecorded'
      : 'Earlier tool result; original call is outside this retained history'
    return { id, role: 'user', source: { kind: 'independent-history', form: 'recall' },
      content: [block(`[${label}]\n${text}${calls.length ? `\n${JSON.stringify(calls)}` : ''}`)] }
  })
}
