/** Match only the nearest preceding recorded call, including reused ids in later batches. */
export function independentToolRelations(messages = []) {
  const owners = new Map(), result = new Map()
  for (const message of messages) {
    if (message.role === 'assistant') {
      const calls = (Array.isArray(message.toolCalls) ? message.toolCalls : message.toolCall ? [message.toolCall] : []).map(call => ({ ...call, results: [] }))
      result.set(message.messageId, calls)
      for (const call of calls) if (typeof call.id === 'string' && call.id) owners.set(call.id, call)
    }
    const callId = message.toolCallId ?? message.toolCall?.id
    if (message.role === 'tool' && typeof callId === 'string') owners.get(callId)?.results.push(message)
  }
  return result
}

export function richToolArguments(call) {
  const value = call && Object.hasOwn(call, 'args') ? call.args : call?.arguments
  if (value === undefined) return '未记录参数'
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) ?? '未记录参数' } catch { return '参数无法显示' }
}

/** Success is established only by the actual clipboard operation's return value. */
export async function copyRichText(text, writer) {
  try { return await writer(text) === true } catch { return false }
}

export const INDEPENDENT_MARKDOWN_LABELS = Object.freeze({
  code: Object.freeze({ copyLabel: '复制代码', copiedLabel: '代码已复制' }), footnotes: '注释',
})
