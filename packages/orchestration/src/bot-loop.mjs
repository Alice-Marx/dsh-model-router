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
 */

import { openBotSessionStore } from './bot-session-store.mjs'

export const MAX_STEPS = 12

const fail = code => { const error = new Error(code); error.code = code; throw error }

/**
 * @param {{
 *   store: ReturnType<typeof openBotSessionStore>,
 *   provider: (request: { botId: string, messages: object[] }) => Promise<{ text?: string, toolCalls?: Array<{ id: string, name: string, args?: object }> }>,
 *   tools?: { call: (name: string, args: object, context: { botId: string }) => Promise<unknown> } | null,
 *   now?: () => number,
 *   maxSteps?: number,
 * }} options
 */
export function createBotLoop({ store, provider, tools = null, now = Date.now, maxSteps = MAX_STEPS } = {}) {
  if (!store || typeof store.append !== 'function' || typeof store.get !== 'function') throw new TypeError('BOT_LOOP_REQUIRES_STORE')
  if (typeof provider !== 'function') throw new TypeError('BOT_LOOP_REQUIRES_PROVIDER')
  if (tools !== null && typeof tools?.call !== 'function') throw new TypeError('BOT_LOOP_INVALID_TOOLS')
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 64) throw new TypeError('INVALID_BOT_LOOP_STEPS')

  async function step(botId, signal) {
    const session = store.get(botId)
    if (signal?.aborted) fail('BOT_LOOP_CANCELLED')
    const reply = await provider({ botId, messages: session.messages.map(({ role, content, name }) => ({ role, content, ...(name ? { name } : {}) })) })
    if (signal?.aborted) fail('BOT_LOOP_CANCELLED')
    if (!reply || typeof reply !== 'object') fail('BOT_LOOP_PROVIDER_REPLY')
    const calls = Array.isArray(reply.toolCalls) ? reply.toolCalls.slice(0, 8) : []
    return { reply, calls }
  }

  return Object.freeze({
    /**
     * Run one turn: user input in, answer or tool call out. The whole turn is bounded.
     * @param {{ botId: string, input: string, signal?: AbortSignal }} request
     */
    async run({ botId, input, signal } = {}) {
      if (typeof input !== 'string' || input.trim() === '') fail('BOT_LOOP_INPUT_REQUIRED')
      store.append(botId, [{ role: 'user', content: input }])
      const executed = []
      for (let index = 0; index < maxSteps; index += 1) {
        const { reply, calls } = await step(botId, signal)
        const text = typeof reply.text === 'string' ? reply.text : ''
        if (calls.length === 0) {
          const session = store.append(botId, [{ role: 'assistant', content: text }], { turn: true })
          return { botId, answer: text, steps: index + 1, toolCalls: executed, turns: session.turns }
        }
        store.append(botId, [
          { role: 'assistant', content: text },
          ...calls.map(call => ({ role: 'assistant', content: '', name: call.name, toolCall: { id: call.id, name: call.name, args: call.args ?? {} } })),
        ])
        if (!tools) fail('BOT_LOOP_TOOLS_UNAVAILABLE')
        for (const call of calls) {
          if (typeof call?.name !== 'string' || !call.name) fail('BOT_LOOP_TOOL_CALL_INVALID')
          const result = await tools.call(call.name, call.args ?? {}, { botId })
          executed.push({ id: call.id, name: call.name })
          store.append(botId, [{ role: 'tool', name: call.name, content: JSON.stringify(result ?? null) }])
        }
      }
      fail('BOT_LOOP_STEP_LIMIT')
    },
  })
}
