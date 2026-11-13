import { createNativeRpcEngine } from './native-rpc-engine.mjs'

const bad = code => { throw Object.assign(new Error(code), { code }) }
const count = value => Number.isSafeInteger(value) && value >= 0
const modelId = value => value && typeof value.provider === 'string' && typeof value.id === 'string' ? `${value.provider}/${value.id}` : null

/** Pi RPC uses command acknowledgements plus uncorrelated session events.
 * agent_end is not enough: only agent_settled proves automatic work has ended.
 */
export function createPiProtocol({ id = 'pi', args, allowedCredentialEnvNames } = {}) {
  const accept = (ctx, frame) => {
    const turn = ctx.turn
    if (!turn || turn.settling) return
    if (frame.type === 'agent_start') { turn.agentStarted = true; return }
    if (!turn.agentStarted) return
    if (frame.type === 'message_update') {
      const event = frame.assistantMessageEvent
      if (event?.type === 'text_delta' && typeof event.delta === 'string') ctx.delta('assistant_text', event.delta)
      else if (event?.type === 'thinking_delta' && typeof event.delta === 'string') ctx.delta('reasoning_text', event.delta)
    }
    if (frame.type === 'tool_execution_start') { ctx.fail('PI_CHAT_UNEXPECTED_TOOL_EXECUTION'); return }
    if (frame.type === 'message_end' && frame.message?.role === 'assistant') {
      const message = frame.message, usage = message.usage
      if (message.provider && message.model && `${message.provider}/${message.model}` !== ctx.options.requestedModel) { ctx.fail('NATIVE_CHAT_MODEL_IDENTITY_MISMATCH'); return }
      if (usage && count(usage.input) && count(usage.output)) {
        const previous = turn.usage ?? { input: 0, output: 0, cachedInput: 0 }
        turn.usage = { input: previous.input + usage.input + (count(usage.cacheRead) ? usage.cacheRead : 0) + (count(usage.cacheWrite) ? usage.cacheWrite : 0),
          output: previous.output + usage.output, cachedInput: (previous.cachedInput ?? 0) + (count(usage.cacheRead) ? usage.cacheRead : 0) }
      }
      turn.lastStopReason = message.stopReason
      if (message.errorMessage) turn.failed = true
    }
    if (frame.type === 'turn_end') {
      turn.lastStopReason = frame.message?.stopReason ?? turn.lastStopReason
      if (frame.message?.errorMessage) turn.failed = true
    }
    if (frame.type === 'agent_settled') {
      if (frame.failure) turn.failed = true
      const cancelled = ['aborted', 'cancelled'].includes(turn.lastStopReason)
      const ok = !turn.failed && ['stop', 'end_turn', 'completed'].includes(turn.lastStopReason)
      void ctx.complete({ ok, outcome: ok ? 'succeeded' : 'unknown', stopReason: ok ? 'completed' : cancelled ? 'cancelled' : 'failed', cancelled, usage: turn.usage,
        ...(!ok ? { errorCode: 'PI_CHAT_TURN_FAILED' } : {}) })
    }
  }
  return Object.freeze({ id, allowedCredentialEnvNames: allowedCredentialEnvNames ?? ['PI_CODING_AGENT_DIR', 'PI_CONFIG_DIR', 'PI_AGENT_DIR'],
    args: args ?? (options => ['--mode', 'rpc', '--no-session', '--no-tools', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files',
      ...(options.systemPrompt ? ['--system-prompt', options.systemPrompt] : [])]),
    encodeRequest: ({ id, method, params }) => ({ id, type: method, ...params }),
    encodeNotify: ({ method, params }) => ({ type: method, ...params }),
    response: frame => frame.type === 'response' ? { id: frame.id, method: frame.command, result: frame.data, error: frame.success === true ? null : true } : null,
    async start(ctx) {
      const slash = ctx.options.requestedModel.indexOf('/')
      if (slash < 1 || slash === ctx.options.requestedModel.length - 1) bad('PI_CHAT_PROVIDER_MODEL_REQUIRED')
      const opened = await ctx.request('new_session', {})
      const selected = await ctx.request('set_model', { provider: ctx.options.requestedModel.slice(0, slash), modelId: ctx.options.requestedModel.slice(slash + 1) })
      if (modelId(selected) !== ctx.options.requestedModel) bad('NATIVE_CHAT_MODEL_IDENTITY_MISMATCH')
      const state = await ctx.request('get_state', {})
      if (modelId(state?.model) !== ctx.options.requestedModel || state.isStreaming === true) bad('PI_CHAT_MODEL_NOT_CONFIRMED')
      return { sessionId: opened?.sessionId ?? state.sessionId, model: modelId(state.model) }
    },
    async dispatch(ctx, turn, text) {
      turn.earlyFrames = []; turn.awaitingAck = true; turn.agentStarted = false; turn.dispatched = true
      const reply = await ctx.request('prompt', { message: text })
      // A handled slash command is not a completed model turn.
      if (reply?.disposition === 'handled') bad('PI_CHAT_PROMPT_HANDLED_WITHOUT_RUN')
      turn.awaitingAck = false
      for (const frame of turn.earlyFrames) accept(ctx, frame)
      turn.earlyFrames = []
    },
    onMessage(ctx, frame) {
      if (frame.type === 'extension_ui_request') {
        if (typeof frame.id === 'string' && ['select', 'input', 'confirm'].includes(frame.method)) void ctx.send({ type: 'extension_ui_response', id: frame.id, cancelled: true, confirmed: false }).catch(() => {})
        return
      }
      if (typeof frame.type !== 'string') bad('PI_CHAT_FRAME_INVALID')
      if (ctx.turn?.awaitingAck) {
        if (ctx.turn.earlyFrames.length >= 128) bad('PI_CHAT_EARLY_FRAME_LIMIT')
        ctx.turn.earlyFrames.push(frame); return
      }
      accept(ctx, frame)
    },
  })
}

export function createPiEngine(options) { return createNativeRpcEngine(options, createPiProtocol()) }
