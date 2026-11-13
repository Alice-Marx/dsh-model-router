import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createNativeRpcEngine } from './native-rpc-engine.mjs'

const bad = code => { throw Object.assign(new Error(code), { code }) }
const number = value => Number.isSafeInteger(value) && value >= 0
const modelOf = ctx => ctx.options.requestedModel

/** The actual Codex App Server wire, retaining one thread in one native process.
 * Only text chat is enabled: no inherited MCP servers, shell, web, plugins, or agents.
 */
export function createCodexProtocol() {
  let usageBase = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }
  const accept = (ctx, frame) => {
    const turn = ctx.turn, params = frame.params
    if (!turn || turn.settling || !params || params.threadId !== ctx.session?.id) return
    if (frame.method === 'model/rerouted' && params.toModel !== modelOf(ctx)) { ctx.fail('NATIVE_CHAT_MODEL_IDENTITY_MISMATCH'); return }
    const id = params.turnId ?? params.turn?.id
    if (typeof id !== 'string' || id !== turn.nativeTurnId) return
    if (frame.method === 'item/agentMessage/delta' && typeof params.delta === 'string') ctx.delta('assistant_text', params.delta)
    if (['item/reasoning/textDelta', 'item/reasoning/summaryTextDelta'].includes(frame.method) && typeof params.delta === 'string') ctx.delta('reasoning_text', params.delta)
    if (frame.method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string' && !turn.text) ctx.delta('assistant_text', params.item.text)
    if (frame.method === 'thread/tokenUsage/updated') {
      const total = params.tokenUsage?.total
      if (total && number(total.inputTokens) && number(total.outputTokens)) turn.usageTotal = total
    }
    if (frame.method === 'turn/completed') {
      const total = turn.usageTotal
      let usage = null
      if (total && usageBase && total.inputTokens >= usageBase.inputTokens && total.outputTokens >= usageBase.outputTokens) {
        usage = { input: total.inputTokens - usageBase.inputTokens, output: total.outputTokens - usageBase.outputTokens,
          ...(number(total.cachedInputTokens) && total.cachedInputTokens >= usageBase.cachedInputTokens ? { cachedInput: total.cachedInputTokens - usageBase.cachedInputTokens } : {}) }
      }
      usageBase = total ? { inputTokens: total.inputTokens, outputTokens: total.outputTokens, cachedInputTokens: total.cachedInputTokens ?? 0 } : null
      const completed = params.turn?.status === 'completed'
      void ctx.complete({ ok: completed, outcome: completed ? 'succeeded' : 'unknown', stopReason: completed ? 'completed' : params.turn?.status === 'interrupted' ? 'cancelled' : 'failed',
        cancelled: params.turn?.status === 'interrupted', usage, ...(!completed ? { errorCode: 'CODEX_CHAT_TURN_FAILED' } : {}) })
    }
  }
  return Object.freeze({ id: 'codex', allowedCredentialEnvNames: ['CODEX_HOME'],
    args: () => ['app-server', '--listen', 'stdio://'],
    async prepareHome({ home, options }) {
      const config = [`model = ${JSON.stringify(options.requestedModel)}`, 'model_provider = "openai"', 'approval_policy = "never"', 'sandbox_mode = "read-only"',
        'web_search = "disabled"', 'cli_auth_credentials_store = "file"', '[features]', 'shell_tool = false', 'multi_agent = false', 'memories = false',
        '[analytics]', 'enabled = false', '[mcp_servers]'].join('\n') + '\n'
      await writeFile(join(home, 'config.toml'), config, { flag: 'wx', mode: 0o600 })
    },
    response: frame => frame.id !== undefined && frame.method === undefined ? { id: frame.id, result: frame.result, error: frame.error } : null,
    async start(ctx) {
      await ctx.request('initialize', { clientInfo: { name: 'dsh_bot_chat', title: 'DSH Bot Chat', version: '1.0.0' }, capabilities: { experimentalApi: true } })
      await ctx.notify('initialized', {})
      const { config } = await ctx.request('config/read', { cwd: ctx.workspace, includeLayers: false })
      if (!config || config.model !== modelOf(ctx) || config.model_provider !== 'openai' || config.approval_policy !== 'never' || config.sandbox_mode !== 'read-only'
        || config.web_search !== 'disabled' || config.features?.shell_tool !== false || config.features?.multi_agent !== false || config.features?.memories !== false
        || Object.keys(config.mcp_servers ?? {}).length) bad('CODEX_CHAT_EFFECTIVE_PROFILE_MISMATCH')
      const opened = await ctx.request('thread/start', { model: modelOf(ctx), modelProvider: 'openai', allowProviderModelFallback: false, cwd: ctx.workspace,
        approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
        ...(ctx.options.systemPrompt ? { developerInstructions: ctx.options.systemPrompt } : {}) })
      if (opened.model !== modelOf(ctx) || opened.modelProvider !== 'openai') bad('NATIVE_CHAT_MODEL_IDENTITY_MISMATCH')
      return { sessionId: opened.thread?.id, model: opened.model }
    },
    async dispatch(ctx, turn, text) {
      turn.earlyFrames = []; turn.awaitingAck = true; turn.dispatched = true
      const reply = await ctx.request('turn/start', { threadId: ctx.session.id, input: [{ type: 'text', text, text_elements: [] }], model: modelOf(ctx) })
      if (typeof reply?.turn?.id !== 'string' || !reply.turn.id) bad('CODEX_CHAT_TURN_ID_MISSING')
      turn.nativeTurnId = reply.turn.id; turn.awaitingAck = false
      for (const frame of turn.earlyFrames) accept(ctx, frame)
      turn.earlyFrames = []
    },
    onMessage(ctx, frame) {
      if (frame.id !== undefined && typeof frame.method === 'string') {
        void ctx.send({ id: frame.id, error: { code: -32601, message: 'Host callback is not authorized' } }).catch(() => {}); return
      }
      if (typeof frame.method !== 'string') bad('CODEX_CHAT_FRAME_INVALID')
      if (ctx.turn?.awaitingAck) {
        if (ctx.turn.earlyFrames.length >= 128) bad('CODEX_CHAT_EARLY_FRAME_LIMIT')
        ctx.turn.earlyFrames.push(frame); return
      }
      accept(ctx, frame)
    },
  })
}

export function createCodexEngine(options) { return createNativeRpcEngine(options, createCodexProtocol()) }
