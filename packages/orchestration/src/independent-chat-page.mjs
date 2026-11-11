import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { openBotSessionStore } from './bot-session-store.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }

/** Read-through view of the runtime's own transcript; one get is one snapshot. */
export function createIndependentConversationReader({ dir, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (typeof dir !== 'string' || !dir || !Number.isSafeInteger(maxBytes) || maxBytes < 256) fail('INDEPENDENT_CHAT_READER_INVALID')
  const store = openBotSessionStore({ dir: join(dir, 'sessions') })
  return (botId, { cursor = null, limit = 40 } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 256)) fail('INDEPENDENT_CHAT_PAGE_INVALID')
    const snapshot = store.get(botId), messages = snapshot.messages
    const ids = messages.map(row => row.messageId)
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) fail('INDEPENDENT_CHAT_MESSAGE_ID_INVALID')
    const end = cursor === null ? messages.length : ids.indexOf(cursor)
    if (end < 0) fail('INDEPENDENT_CHAT_CURSOR_EXPIRED')
    const items = []
    let bytes = 0, start = end
    while (start > 0 && items.length < limit) {
      const row = messages[start - 1]
      const item = { messageId: row.messageId, role: row.role, content: row.content, at: row.at,
        ...(row.contextId ? { contextId: row.contextId } : {}),
        ...(row.name ? { name: row.name } : {}),
        ...(row.modelSource ? { modelSource: row.modelSource } : {}),
        ...(row.toolCalls ? { toolCalls: row.toolCalls } : row.toolCall ? { toolCalls: [row.toolCall] } : {}),
        ...(row.toolCallId || row.role === 'tool' && row.toolCall?.id ? { toolCallId: row.toolCallId ?? row.toolCall.id } : {}) }
      const size = Buffer.byteLength(JSON.stringify(item))
      if (bytes + size > maxBytes) {
        if (!items.length) fail('INDEPENDENT_CHAT_MESSAGE_TOO_LARGE')
        break
      }
      items.unshift(item); bytes += size; start--
    }
    return { schemaVersion: 1, botId, items, nextCursor: start > 0 ? ids[start] : null,
      snapshotId: createHash('sha256').update(JSON.stringify([ids, snapshot.turns, snapshot.updatedAt])).digest('hex'),
      truncated: snapshot.truncated, turns: snapshot.turns }
  }
}
