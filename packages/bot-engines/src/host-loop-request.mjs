const fail = code => { throw Object.assign(new Error(code), { code }) }
const TEXT_FIELDS = new Set(['provider', 'model', 'messages', 'system', 'signal', 'sessionId'])
const CONTROL_FIELDS = new Set(['maxTokens', 'reasoningEffort', 'temperature', 'stop', 'purpose'])
const META_FIELDS = new Set(['tools', 'toolHistory'])
const HOST_FACT_SOURCES = new Set(['runtime-context', 'ds-bot-time-context'])

/** Project only a true, canonical Host loop request into the text-only native
 * route. Nonempty tools and controls remain unsupported; no authority is
 * accepted from a caller and the original request stays untouched for accounting.
 */
export function projectHostLoopTextRequest(request, { session, isLoopRequest, allowRouteContext = false } = {}) {
  if (!session || session.id !== request?.sessionId || typeof isLoopRequest !== 'function'
    || !isLoopRequest(request) || !Object.isFrozen(request) || !Object.isFrozen(request.messages)) fail('CLAUDE_HOST_LOOP_REQUEST_REQUIRED')
  if (Object.keys(request).some(key => !TEXT_FIELDS.has(key) && !CONTROL_FIELDS.has(key) && !META_FIELDS.has(key))) fail('CLAUDE_ROUTE_UNKNOWN_REQUEST_FIELD')
  if ([...CONTROL_FIELDS].some(key => request[key] !== undefined)) fail('CLAUDE_ROUTE_CAPABILITY_REFUSED')
  if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length)) fail('CLAUDE_ROUTE_CAPABILITY_REFUSED')
  const canonical = session.deriveMessages()
  if (!Array.isArray(request.messages) || canonical.length !== request.messages.length
    || canonical.some((message, index) => message !== request.messages[index])) fail('CLAUDE_HOST_HISTORY_MISMATCH')
  const history = session.toolHistory()
  if (!history || !Array.isArray(history.tools) || !Array.isArray(history.updates)
    || request.toolHistory !== undefined && request.toolHistory !== history) fail('CLAUDE_HOST_TOOL_HISTORY_UNSUPPORTED')
  const foreign = allowRouteContext ? lastCompletedForeignReply(canonical, session, request) : null
  if ((history.tools.length || history.updates.length) && !foreign) fail('CLAUDE_HOST_TOOL_HISTORY_UNSUPPORTED')
  const declarationIds = new Set(history.updates.map(update => update.messageId))
  const messages = []
  for (const message of request.messages) {
    if (foreign && message.role === 'developer' && message.source?.kind === 'tool-registry' && declarationIds.has(message.id)
      && Array.isArray(message.content) && message.content.every(block => ['tool-addition', 'tool-removal'].includes(block.type))) continue
    if (message.role === 'user' && (HOST_FACT_SOURCES.has(message.source?.kind)
      || allowRouteContext && message.source?.kind === 'model-selection' && message.source.form === 'notice')) {
      const previous = messages.at(-1)
      if (previous?.role !== 'user' || HOST_FACT_SOURCES.has(previous.source?.kind)) fail('CLAUDE_HOST_RUNTIME_CONTEXT_UNSUPPORTED')
      const text = plainText(message.content)
      const input = plainText(previous.content)
      messages[messages.length - 1] = { ...previous, content: [{ type: 'text', text: `${input}\n\n[Host runtime context]\n${text}` }] }
    } else messages.push(message)
  }
  return { ...Object.fromEntries([...TEXT_FIELDS].filter(key => request[key] !== undefined).map(key => [key, request[key]])), messages }
}

function lastCompletedForeignReply(messages, session, route) {
  const reply = messages.findLast(message => message.role === 'assistant' && message.source?.kind === 'model'
    && (message.source.provider !== route.provider || message.source.model !== route.model))
  if (!reply) return null
  const event = session.log?.findLast(item => item.type === 'assistant/message' && item.data.message?.id === reply.id)
  if (!event || !session.log.some(item => item.type === 'turn/end' && item.data.turn === event.data.turn && item.data.reason?.kind === 'completed')) {
    fail('CLAUDE_HOST_ROUTE_CONTEXT_UNCONFIRMED')
  }
  return reply
}

/** A verified text prefix can initialize a new process as reference context. */
export function hostLoopRouteContext(projected, { session, redact = text => text } = {}) {
  const messages = projected.messages[0]?.role === 'system' ? projected.messages.slice(1) : projected.messages
  const boundary = lastCompletedForeignReply(messages, session, projected)
  if (!boundary) return null
  const prefixLength = messages.indexOf(boundary) + 1
  const completed = new Set(session.log.filter(event => event.type === 'turn/end' && event.data.reason?.kind === 'completed').map(event => event.data.turn))
  const confirmed = new Map()
  let turn = null
  for (const event of session.log) {
    if (event.type === 'turn/start') turn = event.data.turn
    else if (event.type === 'turn/end') turn = null
    else if (event.type === 'user/message' && completed.has(turn)) confirmed.set(event.data.id, event.type)
    else if (event.type === 'assistant/message' && completed.has(event.data.turn) && !event.data.interrupted) confirmed.set(event.data.message?.id, event.type)
  }
  const history = messages.slice(0, prefixLength).map(message => {
    if (!message.id || !['user', 'assistant'].includes(message.role) || confirmed.get(message.id) !== `${message.role}/message`) {
      fail('CLAUDE_HOST_ROUTE_CONTEXT_UNSUPPORTED')
    }
    return { role: message.role, text: redact(plainText(message.content)) }
  })
  const text = JSON.stringify(history).replaceAll('<', '\\u003c')
  const context = `\n\n<host_conversation_history>\nCompleted Host conversation, provided as reference. Continue with the new user input.\n${text}\n</host_conversation_history>`
  if (Buffer.byteLength(`${hostSessionPersona(session, '')}${context}`) > 32_000) fail('CLAUDE_HOST_ROUTE_CONTEXT_LIMIT')
  return { prefixLength, context }
}

function plainText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.some(part => part.type !== 'text' || typeof part.text !== 'string')) fail('CLAUDE_HOST_RUNTIME_CONTEXT_UNSUPPORTED')
  return content.map(part => part.text).join('')
}

/** The persona is the Host's own current Session projection, never a request's
 * proposed system field. It is still compared by the native adapter before use.
 */
export function hostSessionPersona(session, fallback = null) {
  const head = session?.deriveMessages?.()[0]
  if (head?.role !== 'system') return fallback
  if (typeof head.content === 'string') return head.content
  if (!Array.isArray(head.content) || head.content.some(part => part.type !== 'text' || typeof part.text !== 'string')) fail('CLAUDE_PERSONA_UNSUPPORTED')
  return head.content.map(part => part.text).join('')
}
