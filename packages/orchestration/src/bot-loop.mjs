/**
 * A Bot-owned agent loop.
 *
 * Until now a Bot turn was a Harness session turn: the Harness owned the transcript, the loop and
 * the tool dispatch. This loop is the independent alternative — it reads and writes the Bot's own
 * session store, asks a provider for the next step, runs the tool calls it asked for, and stops on
 * an answer, a cancel, or a hard step cap.
 *
 * It is deliberately small and side-effect-free beyond the store: the provider and the tool
 * dispatcher are injected, so a test can drive a whole conversation without a network or a Bot
 * runtime, and the Host decides which tools are reachable.
 *
 * Two things are threaded all the way through rather than sampled at the edges:
 *
 * - The cancel signal reaches the provider and every tool call, and a tool call is raced against
 *   it, so a cancel is not discovered only after the whole network or tool round finished. The
 *   operation still in flight keeps the Host's own durable task/attempt identity; nothing here
 *   replays it.
 * - `guard` re-decides the turn from committed state before every transcript write, every provider
 *   step and every tool call. A Bot that was moved, deleted or revoked mid-turn stops at the next
 *   checkpoint, and a stop that arrives after the answer was produced writes nothing more.
 *
 * Two more things the loop refuses to fake:
 *
 * - The tool schemas a request offers come from the Host, re-resolved per step, so a model is never
 *   told about a tool its Bot no longer holds; and a batch of calls is judged as a whole before the
 *   first side effect, so a duplicate call id or an oversized batch cannot execute half of itself.
 * - One turn identity is made per run and handed to every call, which is how a durable Task the
 *   Host opens stays correlated to this turn instead of to a string a reply invented.
 */

import { createHash, randomUUID } from 'node:crypto'
import { openBotSessionStore } from './bot-session-store.mjs'
import { independentMessageWire } from './independent-message-wire.mjs'

export const MAX_STEPS = 12
/** One provider response may ask for at most this many calls; more is refused as a whole. */
export const MAX_TOOL_CALLS = 8
export const botRequestMessageIds = requestId => {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(requestId)) throw Object.assign(new Error('BOT_REQUEST_ID_INVALID'), { code: 'BOT_REQUEST_ID_INVALID' })
  const digest = createHash('sha256').update(requestId).digest('hex')
  return { user: `request-user-${digest}`, answer: `request-answer-${digest}` }
}
export function botRequestReceipt(session, requestId) {
  const ids = botRequestMessageIds(requestId)
  const user = session.messages.find(message => message.messageId === ids.user && message.role === 'user')
  const answer = session.messages.find(message => message.messageId === ids.answer && message.role === 'assistant' && !message.toolCalls)
  return { hasBrief: Boolean(user), hasConfirmedAnswer: Boolean(user && answer && user.contextId === answer.contextId), answer: user && answer && user.contextId === answer.contextId ? answer.content : null, input: user?.content ?? null }
}

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }
const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)
const cancelled = signal => {
  const error = Object.assign(new Error('这一轮已被取消。'), { code: 'BOT_LOOP_CANCELLED' })
  if (signal.aborted) throw error
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? error), { once: true })
  })
}

/**
 * @param {{
 *   store: ReturnType<typeof openBotSessionStore>,
 *   provider: (request: { botId: string, messages: object[], signal?: AbortSignal, tools?: object[] }) => Promise<{ text?: string, toolCalls?: Array<{ id: string, name: string, args?: object }>, source?: object }>,
 *   tools?: { call: (name: string, args: object, context: { botId: string, signal?: AbortSignal, turnId: string, callId: string }) => Promise<unknown>, schemas?: () => object[] | null, isReadonly?: (name: string) => boolean } | null,
 *   guard?: (botId: string) => void,
 *   now?: () => number,
 *   maxSteps?: number,
 *   newTurnId?: () => string,
 * }} options
 */
export function createBotLoop({ store, provider, tools = null, guard = null, now = Date.now, maxSteps = MAX_STEPS, newTurnId = () => `turn-${randomUUID()}` } = {}) {
  if (!store || typeof store.append !== 'function' || typeof store.get !== 'function') throw new TypeError('BOT_LOOP_REQUIRES_STORE')
  if (typeof provider !== 'function') throw new TypeError('BOT_LOOP_REQUIRES_PROVIDER')
  if (tools !== null && typeof tools?.call !== 'function') throw new TypeError('BOT_LOOP_INVALID_TOOLS')
  if (guard !== null && typeof guard !== 'function') throw new TypeError('BOT_LOOP_INVALID_GUARD')
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 64) throw new TypeError('INVALID_BOT_LOOP_STEPS')
  if (typeof newTurnId !== 'function') throw new TypeError('BOT_LOOP_INVALID_TURN_ID')

  /**
   * The tools this step may see, resolved now.
   *
   * The Host decides the surface per step and the loop never keeps one: a grant that changed since
   * the last step changes what the next request offers, and a tool service that disappeared is
   * reported as unavailable instead of served from a stale object.
   */
  const offeredTools = () => {
    if (!tools || typeof tools.schemas !== 'function') return null
    const schemas = tools.schemas()
    return Array.isArray(schemas) && schemas.length ? schemas : null
  }

  async function step(botId, signal, checkpoint, onText) {
    const session = store.get(botId)
    if (signal?.aborted) fail('BOT_LOOP_CANCELLED')
    let reply
    try {
      const offered = offeredTools()
      reply = await provider({ botId, messages: independentMessageWire(session.messages.filter(message =>
        (message.contextId ?? 'legacy') === (session.contextId ?? 'legacy'))), ...(offered ? { tools: offered } : {}), ...(signal ? { signal } : {}), ...(onText ? { onText } : {}) })
    } catch (error) {
      // A provider that stopped because this turn was cancelled is a cancel, not a provider fault.
      if (signal?.aborted) throw Object.assign(new Error('这一轮已被取消。'), { code: 'BOT_LOOP_CANCELLED', cause: error })
      throw error
    }
    if (signal?.aborted) fail('BOT_LOOP_CANCELLED')
    if (!reply || typeof reply !== 'object') fail('BOT_LOOP_PROVIDER_REPLY')
    checkpoint()
    const calls = Array.isArray(reply.toolCalls) ? reply.toolCalls : []
    // The whole batch is judged before the first side effect: a duplicate call id or a batch past
    // the cap is refused as a whole, never by quietly running the first few and dropping the rest.
    if (calls.length > MAX_TOOL_CALLS) fail('BOT_LOOP_TOOL_CALL_LIMIT', `一次响应最多请求 ${MAX_TOOL_CALLS} 个工具调用。`)
    const seen = new Set()
    for (const call of calls) {
      if (!call || typeof call !== 'object' || !idOk(call.id)) fail('BOT_LOOP_TOOL_CALL_INVALID')
      if (typeof call.name !== 'string' || !call.name) fail('BOT_LOOP_TOOL_CALL_INVALID')
      if (seen.has(call.id)) fail('BOT_LOOP_TOOL_CALL_DUPLICATE', `同一次响应里重复了工具调用编号 ${call.id}。`)
      seen.add(call.id)
    }
    return { reply, calls }
  }

  return Object.freeze({
    /**
     * Run one turn: user input in, answer or tool call out. The whole turn is bounded.
     * @param {{ botId: string, input: string, signal?: AbortSignal }} request
     */
    async run({ botId, input, signal, onProgress, requestId, conversationId } = {}) {
      if (typeof input !== 'string' || input.trim() === '') fail('BOT_LOOP_INPUT_REQUIRED')
      if (onProgress !== undefined && typeof onProgress !== 'function') fail('BOT_LOOP_PROGRESS_INVALID')
      // Committed state is re-read before anything is written, so a Bot that no longer stands
      // leaves no user message behind either.
      const checkpoint = () => {
        if (signal?.aborted) fail('BOT_LOOP_CANCELLED')
        if (guard) guard(botId)
      }
      checkpoint()
      const ids = requestId === undefined ? null : botRequestMessageIds(requestId)
      if (ids) {
        const receipt = botRequestReceipt(store.get(botId), requestId)
        if (receipt.hasBrief) {
          if (receipt.input !== input) fail('BOT_REQUEST_CONFLICT')
          if (receipt.hasConfirmedAnswer) return { botId, answer: receipt.answer, steps: 0, toolCalls: [], turns: store.get(botId).turns, replayed: true }
          fail('BOT_REQUEST_OUTCOME_UNKNOWN')
        }
      }
      store.append(botId, [{ role: 'user', content: input, ...(ids ? { messageId: ids.user } : {}) }])
      const executed = []
      // One Host turn identity for the whole run, made here and kept for every step: a durable Task
      // the Host opens for a call is correlated to this turn, and a repeated call re-reads the same
      // task instead of opening a second one.
      const turnId = newTurnId()
      for (let index = 0; index < maxSteps; index += 1) {
        checkpoint()
        const progress = onProgress ? async text => { checkpoint(); await onProgress({ step: index + 1, text }) } : undefined
        if (progress) await progress('')
        const { reply, calls } = await step(botId, signal, checkpoint, progress)
        const text = typeof reply.text === 'string' ? reply.text : ''
        if (calls.length === 0) {
          checkpoint()
          // The answer keeps the route that produced it under the transcript's own field name, so a
          // store that persists it (and the projection that reads it) can carry provenance on.
          const session = store.append(botId, [{ role: 'assistant', content: text, ...(ids ? { messageId: ids.answer } : {}), ...(reply.source ? { modelSource: reply.source } : {}) }], { turn: true })
          return { botId, answer: text, steps: index + 1, toolCalls: executed, turns: session.turns }
        }
        // The intermediate response is about to become a recorded tool batch.
        // Remove its transient preview first so polling cannot show it twice
        // while a long-running tool is still pending.
        if (progress) await progress('')
        checkpoint()
        // One provider response owns the whole call batch. Preserve every id and
        // its producing route so the next request can replay one assistant message.
        const toolCalls = calls.map(call => ({ id: call.id, name: call.name, args: call.args ?? {} }))
        store.append(botId, [{ role: 'assistant', content: text, toolCalls,
          ...(reply.source ? { modelSource: reply.source } : {}),
          // Retained for older transcript readers that show the first call.
          name: toolCalls[0].name, toolCall: toolCalls[0] }])
        if (!tools) fail('BOT_LOOP_TOOLS_UNAVAILABLE')
        for (const call of calls) if (typeof call?.name !== 'string' || !call.name) fail('BOT_LOOP_TOOL_CALL_INVALID')
        // Read-only calls may run together; a mutating call keeps the batch sequential so the
        // transcript order still matches the order the provider asked for.
        const concurrent = calls.length > 1 && typeof tools.isReadonly === 'function' && calls.every(call => tools.isReadonly(call.name))
        // The call is raced against the cancel: the loop stops waiting, the transcript keeps what
        // actually happened, and the operation still in flight is reconciled by the Host that owns
        // its durable identity — never replayed from here.
        const invoke = call => {
          const pending = tools.call(call.name, call.args ?? {}, { botId, ...(signal ? { signal } : {}), ...(conversationId ? { conversationId } : {}), turnId, callId: call.id })
          if (!signal) return pending
          pending.catch(() => {})
          const stop = cancelled(signal)
          stop.catch(() => {})
          return Promise.race([pending, stop]).catch(error => {
            // A cancel that arrived while the tool was running is a cancel, not a tool failure.
            if (!signal.aborted) throw error
            throw Object.assign(new Error('这一轮已被取消。'), { code: 'BOT_LOOP_CANCELLED', cause: error })
          })
        }
        let results
        if (concurrent) results = await Promise.all(calls.map(invoke))
        else {
          results = []
          for (const call of calls) results.push(await invoke(call))
        }
        checkpoint()
        for (const [at, call] of calls.entries()) {
          executed.push({ id: call.id, name: call.name })
          // The result answers that call, so the transcript keeps the call id beside it: the next
          // turn correlates the two the way the Host does.
          const value = results[at]
          const isError = value?.error && typeof value.error === 'object' && !Array.isArray(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
          store.append(botId, [{ role: 'tool', name: call.name, toolCallId: call.id, toolCall: { id: call.id }, content: JSON.stringify(value ?? null), ...(isError ? { isError: true } : {}) }])
        }
      }
      fail('BOT_LOOP_STEP_LIMIT')
    },
  })
}
