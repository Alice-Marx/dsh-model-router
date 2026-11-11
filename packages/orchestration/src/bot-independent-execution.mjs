/**
 * The trusted frame an independent Bot turn runs in.
 *
 * The independent loop owns a transcript, not an identity. Before it may ask a provider for
 * anything, a Host — and only a Host — has to say which committed Bot this turn is, which model
 * that Bot has saved, and that the Bot is still committed, unrevoked and on the independent
 * runtime. This module is that say: the Bot product composes it from its own directory,
 * lifecycle, policy and serving admission, publishes it once, and the loop asks it per step.
 *
 * Three rules are load-bearing:
 *
 * 1. Nothing here accepts an identity from a request. The Bot comes from the argument the
 *    dispatch already validated, the subject from the principal directory, the model from the
 *    Bot's own committed record, and the runtime from the committed switch. A caller that names
 *    a route the Bot has not saved is refused, so a step that started under one model cannot be
 *    finished under another.
 * 2. This module holds no money. The stream it returns is the Host's own `llm/stream` entry, so
 *    the product's model listener — the same one an integrated turn goes through — applies the
 *    Bot policy, re-decides the route per chunk and records the one receipt. A second ledger, or
 *    a token-estimated "actual" bill, would be a second authority; there is none here.
 * 3. An outcome the provider did not state is not an answer. A stream that ends without a
 *    finish, or with an error, throws: the loop then writes no assistant message and the
 *    transcript keeps the honest state instead of a confident-looking reply.
 */

import { collectAnswer } from './bot-independent-stream.mjs'
import { independentSystemMessage } from './independent-message-wire.mjs'

const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

/**
 * `provider/model`, or null when the Bot has not committed to a route at all.
 *
 * The split is at the **first** slash only: a Host catalog legitimately serves refs whose model
 * remainder carries a namespace of its own (`openrouter/anthropic/claude-3`), and dropping that
 * remainder would ask for a model nobody committed to.
 */
export const routeOf = value => {
  if (typeof value !== 'string') return null
  const at = value.indexOf('/')
  if (at <= 0 || at === value.length - 1) return null
  const provider = value.slice(0, at)
  const model = value.slice(at + 1)
  return provider && model ? { provider, model } : null
}

/** What the operator is told when a stream cannot be turned into an answer. */
const REPLY_REFUSAL = Object.freeze({
  MODEL_STREAM_UNFINISHED: '模型没有给出结束状态，这一轮不写入回答。',
  MODEL_STREAM_ERROR: '模型调用失败，这一轮不写入回答。',
  MODEL_STREAM_ABORTED: '模型调用被中止，这一轮不写入回答。',
  MODEL_STREAM_TRUNCATED: '模型回答被上界截断，未当作完整回答写入。',
  MODEL_STREAM_REASON_UNKNOWN: '模型结束状态无法识别，这一轮不写入回答。',
  MODEL_TOOL_CALL_ID_MISSING: '模型请求的工具没有调用编号，已拒绝。',
  MODEL_TOOL_CALL_NAME_MISSING: '模型请求了一个没有名称的工具，已拒绝。',
  MODEL_TOOL_CALL_ARGS_INVALID: '模型请求的工具参数不是合法 JSON，已拒绝。',
})

/** The closed request shape: nothing here names a session, a runtime or an identity. `conversationId` is the one trusted Host-supplied work-thread correlation the dispatch boundary injects; it is never a model field. */
const REQUEST_FIELDS = Object.freeze(['botId', 'provider', 'model', 'messages', 'signal', 'system', 'tools', 'maxTokens', 'reasoningEffort', 'onText', 'conversationId'])

/**
 * @param {{
 *   policy: { modelContext: Function },
 *   directory: { forBot: (botId: string) => object },
 *   lifecycle: { committedBot: (botId: string) => object | null },
 *   serving: { assertMode: (botId: string, mode: string) => string },
 *   authority: { assertModel: Function, assertTool: Function },
 *   stream: (options: object, context: { botId: string, subject: object }) => AsyncIterable<object>,
 *   readyFor?: (botId: string) => boolean,
 * }} options
 */
export function createBotIndependentExecution({ policy, directory, lifecycle, serving, authority, stream, readyFor = () => true } = {}) {
  if (!policy || typeof policy.modelContext !== 'function') throw new TypeError('INDEPENDENT_EXECUTION_REQUIRES_POLICY')
  if (!directory || typeof directory.forBot !== 'function') throw new TypeError('INDEPENDENT_EXECUTION_REQUIRES_DIRECTORY')
  if (!lifecycle || typeof lifecycle.committedBot !== 'function') throw new TypeError('INDEPENDENT_EXECUTION_REQUIRES_LIFECYCLE')
  if (!serving || typeof serving.assertMode !== 'function') throw new TypeError('INDEPENDENT_EXECUTION_REQUIRES_SERVING')
  if (!authority || typeof authority.assertModel !== 'function' || typeof authority.assertTool !== 'function') {
    throw new TypeError('INDEPENDENT_EXECUTION_REQUIRES_AUTHORITY')
  }
  if (typeof stream !== 'function') throw new TypeError('INDEPENDENT_EXECUTION_REQUIRES_STREAM')
  if (typeof readyFor !== 'function') throw new TypeError('INDEPENDENT_EXECUTION_REQUIRES_READINESS')

  /**
   * The committed Bot, or a refusal. A deleted Bot, a suspended lifecycle and an unhealthy Host
   * are all "nobody can say", and none of them is the integration path.
   */
  const committed = botId => {
    if (!idOk(botId)) fail('INVALID_BOT_ID')
    const bot = lifecycle.committedBot(botId)
    if (!bot) fail('BOT_NOT_COMMITTED', `无法确认 ${botId} 的已提交状态，本次请求被拒绝。`)
    return bot
  }

  return Object.freeze({
    /**
     * The route this turn may ask for, read from the Bot's own committed record. A Bot with no
     * saved model has no route: nothing here falls back to a global provider or a default model,
     * and a Host whose model service cannot be reached refuses rather than guessing.
     */
    routeFor(botId) {
      const bot = committed(botId)
      const route = routeOf(bot.model)
      if (!route) fail('BOT_MODEL_UNCOMMITTED', `无法确认 ${botId} 已保存的模型，本次请求被拒绝。`)
      return route
    },

    /**
     * Re-decide one independent turn before it writes anything: the committed runtime, the
     * committed Bot, a live subject and the Bot's own grant for the model it saved. The loop calls
     * this before every transcript write, every provider step and every tool call, so a Bot that
     * was moved, deleted, revoked or stripped of its grant stops at the next checkpoint instead of
     * finishing — or even writing a user message — on a state that no longer stands.
     */
    assertTurn(botId) {
      serving.assertMode(botId, 'independent')
      const bot = committed(botId)
      const route = routeOf(bot.model)
      if (!route) fail('BOT_MODEL_UNCOMMITTED', `无法确认 ${botId} 已保存的模型，本次请求被拒绝。`)
      const subject = directory.forBot(botId)
      // The grant is re-asserted here, not only when the model call later enters its own frame: an
      // emptied grant must refuse before anything is written to the transcript.
      authority.assertModel(subject, route.provider, route.model)
      authority.assertTool(subject, 'model/infer')
      if(readyFor(botId, route)!==true)fail('BOT_BINDING_UNAVAILABLE','此 Bot 尚未配置可用的默认执行绑定。')
      return true
    },

    /**
     * One model call for one independent turn, inside the Bot's own frame.
     *
     * The caller passes the route it resolved; this re-reads the committed record and refuses a
     * mismatch, so the saved route identity of one request is never swapped mid-turn. The request
     * shape is closed: a caller cannot open a new path to a session, a runtime or an identity
     * through this trusted facade.
     *
     * @param {{ botId: string, provider: string, model: string, messages: object[], signal?: AbortSignal,
     *   system?: unknown, tools?: unknown, maxTokens?: number, reasoningEffort?: string }} request
     * @returns {Promise<{ text: string, toolCalls: object[], source: object }>}
     */
    async complete(request = {}) {
      const { botId, provider, model, messages, signal, system, tools, maxTokens, reasoningEffort, onText, conversationId } = request
      const extra = Object.keys(request).filter(key => !REQUEST_FIELDS.includes(key))
      if (extra.length) fail('INDEPENDENT_REQUEST_UNKNOWN_FIELD', `本次请求带有不受支持的字段：${extra.join(', ')}`)
      if (onText !== undefined && typeof onText !== 'function') fail('INDEPENDENT_PROGRESS_INVALID')
      this.assertTurn(botId)
      const bot = committed(botId)
      const saved = routeOf(bot.model)
      if (!saved || saved.provider !== provider || saved.model !== model) {
        fail('BOT_MODEL_MISMATCH', `已保存模型与本次请求不一致：${botId} 当前为 ${bot.model ?? '未知'}，本次 ${provider}/${model} 被拒绝。`)
      }
      // The thinking level belongs to the same committed Bot choice as its
      // route. Omitting it here used to silently select the adapter default,
      // even when the owner had saved another level in the Bot's settings.
      // The actual prepared SDK generation validates capability support; a
      // stale level is refused before provider I/O, never silently replaced.
      const effort = bot.effort
      if (effort !== undefined && (typeof effort !== 'string' || !effort.trim())) fail('BOT_MODEL_EFFORT_INVALID')
      if (reasoningEffort !== undefined && reasoningEffort !== effort) {
        fail('BOT_MODEL_EFFORT_MISMATCH', '本次思考强度与 Bot 已保存的选择不一致，请先在 Bot 设置中保存。')
      }
      if (!Array.isArray(messages)) fail('BOT_TURN_MESSAGES_REQUIRED')
      for (const message of messages) {
        if (!message || !Array.isArray(message.content)) fail('BOT_TURN_MESSAGE_BLOCKS_REQUIRED')
        if (message.role === 'assistant' && (message.source?.kind !== 'model' ||
          typeof message.source.provider !== 'string' || !message.source.provider ||
          typeof message.source.model !== 'string' || !message.source.model)) fail('BOT_TURN_MESSAGE_PROVENANCE_REQUIRED')
      }
      if (signal?.aborted) fail('BOT_LOOP_CANCELLED')
      const subject = directory.forBot(botId)
      const options = {
        provider, model, messages: [independentSystemMessage(bot), ...messages],
        ...(signal ? { signal } : {}),
        ...(system === undefined ? {} : { system }),
        ...(tools === undefined ? {} : { tools }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      }
      // The whole call runs inside the frame, so the product's own model listener sees the
      // committed Bot subject and the turn's cancel — one policy decision, one receipt. The
      // turn's committed Bot and subject travel with the call so a Host-prepared stream can
      // bind the exact adapter generation and admit against it; a plain stream ignores them.
      return policy.modelContext(subject, signal, async () => {
        const reply = await collectAnswer(stream(options, { botId, subject }), { onText })
        // A stream that never finished, failed or asked for something unusable is not an answer:
        // the loop writes nothing, and the receipt keeps the unknown outcome.
        if (reply.failed) fail(reply.failed, REPLY_REFUSAL[reply.failed] ?? reply.failed)
        // The route that produced this answer travels with it, so the next turn's request is a
        // conversation the Host's own model service recognises and can replay.
        return { text: reply.text, toolCalls: reply.toolCalls, source: { kind: 'model', provider, model } }
      }, { botId, ...(typeof conversationId === 'string' ? { conversationId } : {}) })
    },
  })
}
