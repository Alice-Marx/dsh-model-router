// Pure request projection and chunk mapping for the Claude retained-session LLM route.
//
// This module holds no process, no session and no money. It answers three questions the
// bridge in `claude-llm-adapter.mjs` must answer before it may touch a native CLI:
//
//   1. Is this request one this route can serve at all? (`assertRouteRequest`)
//      The route is a text-only Claude subscription conversation session: it accepts one
//      new user text per call and nothing else. A request naming tools, an output bound,
//      a temperature, stop sequences, an auxiliary purpose, an unknown field, or a
//      non-text block is refused with the offending names — never silently ignored.
//   2. What is the NEW input for the retained session? (`projectRetainedTurn`)
//      A retained CLI session already holds its own context. Re-sending the whole
//      transcript would duplicate it, so only the trailing new user message is dispatched.
//      Everything already delivered is verified by durable message id and by the SDK's own
//      model provenance; a changed prefix, an unseen history, a different Bot, a different
//      model, a changed persona or a repeated dispatch are refusals, not a quiet drop.
//   3. How does a native turn become SDK chunks? (`usageChunkFromTurn`,
//      `finishReasonFromTurn`) A turn the CLI did not report usage for emits no usage
//      chunk — unknown stays unknown. Exactly one finish is derived per turn, and a
//      missing, unknown or cancelled outcome is never mapped onto success.
//
// Errors are thrown as `{code, message}` errors; the adapter turns them into terminal
// `finish` chunks so the SDK's own consumer contract sees one honest outcome.

import { validTurnText } from './claude-protocol.mjs'

/** What this route accepts, stated so a caller can read it instead of guessing. */
export const CLAUDE_LLM_CAPABILITIES = Object.freeze({
  input: Object.freeze(['one new user text message per call']),
  output: Object.freeze(['assistant text', 'reasoning deltas surfaced as reasoning chunks']),
  accepts: Object.freeze(['provider', 'model', 'messages', 'system', 'signal', 'sessionId']),
  refuses: Object.freeze(['tools', 'toolHistory', 'maxTokens', 'reasoningEffort', 'temperature', 'stop', 'purpose']),
  unsupportedContent: Object.freeze(['image', 'file', 'tool-call', 'tool-addition', 'tool-removal']),
  funding: Object.freeze(['subscription']),
  notes: Object.freeze([
    'one retained native CLI session per Bot conversation, serial turns',
    'usage the CLI does not report stays unknown; no cost is estimated or invented here',
    'the model provenance of a reply proves the CLI-configured init, not the response backend',
  ]),
})

/** Request fields this route refuses outright: it cannot honour them, so it will not pretend to. */
const REFUSED_FIELDS = Object.freeze(['tools', 'toolHistory', 'maxTokens', 'reasoningEffort', 'temperature', 'stop', 'purpose'])
/** The closed GenerateOptions field set; anything else is a trust-boundary violation. */
const ALLOWED_FIELDS = Object.freeze(['provider', 'model', 'messages', 'system', 'signal', 'sessionId'])

const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }

const idOf = message => (message && typeof message.id === 'string' && message.id ? message.id : null)

/** Text of a text-only content value, or null when it carries anything else. */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  let text = ''
  for (const block of content) {
    if (!block || block.type !== 'text' || typeof block.text !== 'string') return null
    text += block.text
  }
  return text
}

/** The block types a content array carries, for a refusal that names what it saw. */
function blockTypes(content) {
  if (!Array.isArray(content)) return []
  return content.map(block => (block && typeof block.type === 'string' ? block.type : 'unknown'))
}

/** True for an assistant message this very route produced (SDK model provenance). */
const ownReply = (message, provider, model) => message?.role === 'assistant'
  && message.source?.kind === 'model'
  && message.source.provider === provider
  && message.source.model === model

/** One assistant history entry this route must be able to account for: text only. */
const assertAssistantHistory = (message, provider, model) => {
  if (!ownReply(message, provider, model)) {
    fail('CLAUDE_SESSION_HISTORY_UNSEEN',
      `这条会话里有不是本路由产生的历史（${message.source?.provider ?? 'unknown'}/${message.source?.model ?? 'unknown'}），保留会话无法安全继续，请为本路由开启新会话。`)
  }
  if (textOf(message.content) === null) {
    fail('CLAUDE_SESSION_HISTORY_UNSUPPORTED',
      `本路由的历史回复只能承载文本，实际带有：${blockTypes(message.content).join(', ')}。`)
  }
}

/**
 * Refuse a request this route cannot serve, before any session or process exists.
 *
 * @param {object} options a GenerateOptions as the SDK passes it to an adapter
 * @param {{provider: string, model: string, persona: string|null}} route the captured route snapshot
 * @returns {{persona: string|null, messages: object[]}} the persona this call confirmed and the conversation messages
 */
export function assertRouteRequest(options, route) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('CLAUDE_TURN_REQUEST_REQUIRED', '请求缺失。')
  const refused = REFUSED_FIELDS.filter(field => options[field] !== undefined && !(field === 'maxTokens' && route.metered))
  if (refused.length) {
    fail('CLAUDE_ROUTE_CAPABILITY_REFUSED',
      `本路由无法兑现这些能力，已拒绝而不是忽略：${refused.join(', ')}。接受的能力：${CLAUDE_LLM_CAPABILITIES.input.join('; ')}。`)
  }
  if (route.metered && options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > route.metered.maxOutputTokens)) fail('CLI_METERED_OUTPUT_LIMIT', '输出上限超出此 CLI 连接的固定容量。')
  const unknown = Object.keys(options).filter(key => !ALLOWED_FIELDS.includes(key) && !(key === 'maxTokens' && route.metered))
  if (unknown.length) {
    fail('CLAUDE_ROUTE_UNKNOWN_REQUEST_FIELD',
      `请求带有本路由不接受的身份、路径、命令、凭据或引擎配置字段：${unknown.join(', ')}。`)
  }
  if (typeof options.provider !== 'string' || options.provider !== route.provider) fail('CLAUDE_ROUTE_PROVIDER_MISMATCH', 'provider 与已登记路由不一致。')
  if (typeof options.model !== 'string' || options.model !== route.model) fail('CLAUDE_ROUTE_MODEL_MISMATCH', 'model 与已提交路由不一致。')
  if (options.sessionId !== undefined && (typeof options.sessionId !== 'string' || !options.sessionId)) fail('CLAUDE_SESSION_ID_INVALID', 'sessionId 必须是非空字符串。')

  // The persona seam: a leading system message is the loop's own projection of the
  // Host-confirmed persona. It is compared, never invented, and never re-sent as a
  // fake system authority — the engine has no system slot in this port.
  let persona = null
  let messages = options.messages
  if (!Array.isArray(messages)) fail('CLAUDE_TURN_MESSAGES_REQUIRED', 'messages 缺失。')
  if (messages.length && messages[0]?.role === 'system') {
    persona = textOf(messages[0].content)
    if (persona === null) fail('CLAUDE_PERSONA_UNSUPPORTED', `system 消息只能承载文本，实际带有：${blockTypes(messages[0].content).join(', ')}。`)
    if (route.persona === null || route.persona === undefined) {
      fail('CLAUDE_PERSONA_UNCONFIRMED', '宿主未确认本路由的人格设定，拒绝把请求里的 system 消息当作权威。')
    }
    if (persona !== route.persona) fail('CLAUDE_PERSONA_MISMATCH', '请求中的人格设定与宿主确认的不一致。')
    messages = messages.slice(1)
  }
  if (options.system !== undefined) {
    if (typeof options.system !== 'string') fail('CLAUDE_PERSONA_UNSUPPORTED', 'system 只能是字符串。')
    if (route.persona === null || route.persona === undefined) fail('CLAUDE_PERSONA_UNCONFIRMED', '宿主未确认本路由的人格设定。')
    if (options.system !== route.persona) fail('CLAUDE_PERSONA_MISMATCH', '请求中的 system 与宿主确认的人格设定不一致。')
    persona = options.system
  }
  for (const message of messages) {
    if (message?.role !== 'user' && message?.role !== 'assistant') {
      fail('CLAUDE_ROUTE_CAPABILITY_REFUSED', `本路由不接受 ${String(message?.role)} 角色消息（工具更新等开发者消息无法兑现）。`)
    }
  }
  return { persona, messages }
}

/** The empty projection state of a session that has dispatched nothing yet. */
export const emptyTurnState = () => Object.freeze({ sent: Object.freeze([]) })

/** The exact Host prefix carried in a new process's private reference context. */
export function seedTurnState(messages, prefixLength) {
  if (!Number.isSafeInteger(prefixLength) || prefixLength < 1 || prefixLength >= messages.length) fail('CLAUDE_HOST_ROUTE_CONTEXT_INVALID', '宿主历史范围无效。')
  return { sent: messages.slice(0, prefixLength).map(message => {
    const id = idOf(message), text = textOf(message.content)
    if (!id || text === null || !['user', 'assistant'].includes(message.role)) fail('CLAUDE_HOST_ROUTE_CONTEXT_INVALID', '原生切换只支持已确认的文本历史。')
    return { id, text: message.role === 'user' ? text : null }
  }) }
}

/**
 * What the retained session has NOT already seen: only the trailing new user text.
 *
 * Continuity is proved per delivered message: the durable id, and for a dispatched user
 * message also its exact text. An id that survives an edit, a shortened history or a
 * message this route never produced are refusals — a retained CLI session must never be
 * continued on a history it did not actually see.
 *
 * @param {object} input
 * @param {object[]} input.messages conversation messages (the persona system message already removed)
 * @param {string} input.provider this route's provider id
 * @param {string} input.model this route's committed model id
 * @param {{sent: readonly {id: string|null, text: string|null}[]}} input.state what this session already delivered
 * @returns {{text: string, state: {sent: {id: string|null, text: string|null}[]}}}
 */
export function projectRetainedTurn({ messages, provider, model, state }) {
  if (!Array.isArray(messages)) fail('CLAUDE_TURN_MESSAGES_REQUIRED', 'messages 缺失。')
  const previous = state ?? emptyTurnState()
  if (messages.length < previous.sent.length) {
    fail('CLAUDE_SESSION_HISTORY_CHANGED', '会话历史比本会话已交付的更短：历史被改写，拒绝继续而不是重放。')
  }
  for (let index = 0; index < previous.sent.length; index++) {
    // Durable ids are the only honest continuity proof; a positional hole is a change.
    if (idOf(messages[index]) !== previous.sent[index].id) {
      fail('CLAUDE_SESSION_HISTORY_CHANGED', `会话历史第 ${index + 1} 条与已交付的不一致：历史被改写，拒绝继续而不是重放。`)
    }
    // A user message we dispatched verbatim must still carry the text we dispatched.
    if (previous.sent[index].text !== null && textOf(messages[index].content) !== previous.sent[index].text) {
      fail('CLAUDE_SESSION_HISTORY_CHANGED', `会话历史第 ${index + 1} 条的用户文本已被改写，保留会话里的原文与它不再一致，拒绝继续而不是重放。`)
    }
  }
  let cursor = previous.sent.length
  while (cursor < messages.length && messages[cursor]?.role === 'assistant') {
    assertAssistantHistory(messages[cursor], provider, model)
    cursor++
  }
  const fresh = messages.slice(cursor)
  if (fresh.length === 0) {
    fail('CLAUDE_TURN_ALREADY_DISPATCHED', '这次提交没有新的用户输入：同一请求不重复投递给保留会话。')
  }
  if (fresh.length > 1) {
    // Extra entries this session never delivered are unseen history, not a multi-message
    // turn: the retained CLI cannot be told about them and must not be replayed into.
    if (fresh.slice(0, -1).some(message => message.role !== 'user')) {
      fail('CLAUDE_SESSION_HISTORY_UNSEEN',
        '这条会话里有本路由没有交付过的历史，保留会话无法安全继续，请为本路由开启新会话。')
    }
    fail('CLAUDE_TURN_INPUT_UNSUPPORTED', `一次调用只能携带一条新的用户消息，实际有 ${fresh.length} 条。`)
  }
  const incoming = fresh[0]
  if (incoming.role !== 'user') {
    fail('CLAUDE_TURN_INPUT_UNSUPPORTED', `新的输入必须是 user 消息，实际是 ${String(incoming.role)}。`)
  }
  const text = textOf(incoming.content)
  if (text === null) {
    fail('CLAUDE_TURN_INPUT_UNSUPPORTED', `本路由只接受文本输入，实际带有：${blockTypes(incoming.content).join(', ')}。`)
  }
  if (!validTurnText(text)) fail('CLAUDE_TURN_TEXT_INVALID', '输入文本为空、含 NUL 或超过 64000 字节。')
  return {
    text,
    state: {
      sent: messages.map(message => (message.role === 'user'
        ? { id: idOf(message), text: textOf(message.content) }
        : { id: idOf(message), text: null })),
    },
  }
}

/**
 * The usage chunk one native turn earns. A turn the CLI reported no usage for earns
 * none: the SDK consumer then records an incomplete usage instead of a fabricated one.
 */
export function usageChunkFromTurn(result) {
  const usage = result?.usage
  if (!usage || typeof usage.input !== 'number' || typeof usage.output !== 'number') return null
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    ...(typeof usage.cachedInput === 'number' ? { cacheReadTokens: usage.cachedInput } : {}),
  }
}

/** Native stop reasons mapped onto stable, provider-neutral refusal codes. */
const STOP_REASON_CODES = Object.freeze({
  'resume-refused': 'CLAUDE_SESSION_RESUME_REFUSED',
  'model-identity-mismatch': 'CLAUDE_MODEL_IDENTITY_MISMATCH',
  'grant-revoked': 'CLAUDE_GRANT_REVOKED',
  'exit-before-result': 'CLAUDE_PROCESS_EXIT_BEFORE_RESULT',
  'spawn-failed': 'CLAUDE_LAUNCH_FAILED',
  'launch-failed': 'CLAUDE_LAUNCH_FAILED',
  'stdin-write-failed': 'CLAUDE_DISPATCH_WRITE_FAILED',
  'turn-timeout': 'CLAUDE_TURN_TIMEOUT',
  'engine-stopped': 'CLAUDE_ENGINE_STOPPED',
  cancelled: 'CLAUDE_TURN_CANCELLED',
})

/**
 * Exactly one finish reason per native turn.
 *
 * A turn is a success only when the CLI completed it, the session identity was
 * confirmed by the init handshake, and the turn actually produced assistant text.
 * An `unknown` outcome (the CLI may have run), a cancelled turn, a turn with no
 * output at all and any failure are refusals — never a success with a missing answer.
 *
 * @param {object} result the engine's settled turn result
 * @param {{textChars?: number}} [observed] what the turn actually streamed
 */
export function finishReasonFromTurn(result, observed = {}) {
  if (result?.cancelled === true) {
    return { kind: 'aborted', failure: { code: 'CLAUDE_TURN_CANCELLED', message: '本轮在原生会话中被取消。' } }
  }
  if (!result || result.ok !== true) {
    const code = STOP_REASON_CODES[result?.stopReason] ?? 'CLAUDE_TURN_FAILED'
    if (result?.outcome === 'unknown') {
      return { kind: 'error', failure: { code: 'CLAUDE_TURN_OUTCOME_UNKNOWN', message: `原生会话结果未知（${String(result.stopReason)}），不当作成功。` } }
    }
    return { kind: 'error', failure: { code, message: result?.errorText ?? String(result?.stopReason ?? 'native turn failed') } }
  }
  if (result.outcome !== 'succeeded') {
    return { kind: 'error', failure: { code: 'CLAUDE_SESSION_UNCONFIRMED', message: '原生会话未通过 init 握手确认，结果不当作成功。' } }
  }
  if (!(typeof observed.textChars === 'number' && observed.textChars > 0)) {
    return { kind: 'error', failure: { code: 'CLAUDE_TURN_NO_OUTPUT', message: '原生会话本轮没有给出任何文本，不当作成功。' } }
  }
  return { kind: 'stop' }
}

/** Turn facts a bridge records for the Host; never a monetary amount. */
export function turnFacts(result) {
  return Object.freeze({
    turnId: result?.turnId ?? null,
    nativeOutcome: result?.outcome ?? null,
    nativeStopReason: result?.stopReason ?? null,
    usageStatus: result?.usageStatus ?? 'unknown',
    costStatus: 'unknown',
    note: 'usage and cost come from the native result only; this bridge holds no second ledger and issues no receipt',
  })
}

/** The session key: one retained native CLI session per Bot conversation. */
export const sessionKeyOf = (botId, sessionId) => `${botId}\u0000${typeof sessionId === 'string' && sessionId ? sessionId : '-'}`
