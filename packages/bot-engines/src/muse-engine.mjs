import { randomBytes } from 'node:crypto'
import { createNativeRpcEngine } from './native-rpc-engine.mjs'

// Muse Session Protocol (MSP), not ACP. Methods and command identity follow the
// public meta-models/muse-code-sdk 1.4.6 wire contract. No SDK-owned child spawn,
// command retry or independent money ledger is used here.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
const count = value => Number.isSafeInteger(value) && value >= 0
const error = code => Object.assign(new Error(code), { code })
const commandId = () => {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Date.now(), 0, 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
async function command(ctx, method, params, id = commandId()) {
  const result = await ctx.request(method, { ...params, commandId: id })
  if (!record(result) || result.commandId !== undefined && result.commandId !== id) throw error('MUSE_COMMAND_ID_MISMATCH')
  return result
}
const usage = value => record(value) && count(value.inputTokens) && count(value.outputTokens)
  ? { input: value.inputTokens, output: value.outputTokens, ...(count(value.cachedTokens) ? { cachedInput: value.cachedTokens } : {}) } : null

export function createMuseProtocol() {
  // Item state is per retained engine and reset for every new native turn.
  const items = new Map(), streamed = new Map(), handledAsks = new Set(), usedItems = new Set()
  let personaSent = false
  return Object.freeze({
    id: 'museCode',
    allowedCredentialEnvNames: ['MUSE_NO_AUTO_UPDATE'],
    args: () => ['serve', '--disable-shell', '--disable-write', '--no-session-log'],
    encodeRequest: ({ id, method, params }) => ({ jsonrpc: '2.0', id, method, params }),
    encodeNotify: ({ method, params }) => ({ jsonrpc: '2.0', method, params }),
    response(frame) {
      if (frame.jsonrpc !== '2.0') throw error('MUSE_RPC_VERSION_INVALID')
      if (frame.method === undefined && (typeof frame.id === 'string' || typeof frame.id === 'number')
        && (Object.hasOwn(frame, 'result') !== Object.hasOwn(frame, 'error'))) return { id: frame.id, result: frame.result, error: frame.error }
      return null
    },
    async start(ctx) {
      const initialized = await ctx.request('initialize', {
        clientInfo: { name: 'dsh-model-router', title: 'DSH Bot', version: '1' },
        capabilities: { requestedCapabilities: [] },
      })
      if (!record(initialized)) throw error('MUSE_INITIALIZE_INVALID')
      await ctx.notify('initialized', {})
      const started = await command(ctx, 'session/start', { workspaceRoot: ctx.workspace, providerId: 'meta',
        approvalMode: 'promptUnmatched', modelId: ctx.options.requestedModel })
      const session = started.session
      if (!record(session) || !identifier(session.sessionId) || session.modelId !== ctx.options.requestedModel) throw error('MUSE_MODEL_IDENTITY_MISMATCH')
      return { sessionId: session.sessionId, model: session.modelId }
    },
    async dispatch(ctx, turn, text) {
      items.clear(); streamed.clear(); handledAsks.clear()
      // The peer can complete before acknowledging turn/start: reserve its id
      // before the single write, never resend an uncertain command.
      turn.nativeTurnId = commandId()
      const persona = typeof ctx.options.systemPrompt === 'string' ? ctx.options.systemPrompt : typeof ctx.options.persona === 'string' ? ctx.options.persona
        : typeof ctx.options.roleInstructions === 'string' ? ctx.options.roleInstructions : ''
      const input = persona && !personaSent ? `${persona}\n\n${text}` : text
      personaSent = true
      turn.dispatched = true
      await command(ctx, 'turn/start', { sessionId: ctx.session.id, input: [{ type: 'text', text: input }] }, turn.nativeTurnId)
    },
    async onMessage(ctx, frame) {
      if (frame.jsonrpc !== '2.0' || typeof frame.method !== 'string' || !record(frame.params ?? {})) throw error('MUSE_MESSAGE_INVALID')
      const params = frame.params ?? {}, turn = ctx.turn, session = ctx.session
      if (frame.id !== undefined) {
        // These requests are receipts; the subsequent notification carries the
        // explicit approval/question command. Every other method is refused.
        if (frame.method === 'approval/request' || frame.method === 'userInput/request') {
          await ctx.send({ jsonrpc: '2.0', id: frame.id, result: {} })
        } else await ctx.send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Host method unavailable' } })
        return
      }
      if (!turn || !turn.dispatched || turn.settling || !session || params.sessionId !== session.id) return
      const matches = params.turnId === turn.nativeTurnId
      if (['item/started', 'item/updated', 'item/completed'].includes(frame.method)) {
        const item = params.item
        if (!record(item) || item.turnId !== turn.nativeTurnId || !identifier(item.itemId)) return
        if (!items.has(item.itemId)) {
          if (usedItems.has(item.itemId)) throw error('MUSE_ITEM_ID_REUSED')
          if (items.size >= 2048 || usedItems.size >= 8192) throw error('MUSE_ITEM_LIMIT')
          usedItems.add(item.itemId)
        }
        if (item.retracted === true) throw error('MUSE_ITEM_RETRACTED')
        items.set(item.itemId, { kind: item.kind, turnId: item.turnId })
        if (item.kind === 'agentMessage' && item.status === 'completed' && typeof item.text === 'string') {
          const prior = streamed.get(item.itemId) ?? ''
          if (!item.text.startsWith(prior)) throw error('MUSE_TEXT_REWRITE')
          if (item.text.length > prior.length) ctx.delta('assistant_text', item.text.slice(prior.length))
          streamed.set(item.itemId, item.text)
        }
      } else if (frame.method === 'item/delta') {
        const item = items.get(params.itemId)
        if (!item || item.turnId !== turn.nativeTurnId || typeof params.delta !== 'string' || params.turnId !== undefined && !matches) return
        if (item.kind === 'agentMessage' && (params.field === undefined || params.field === 'text')) {
          const prior = streamed.get(params.itemId) ?? ''
          if (Buffer.byteLength(prior) + Buffer.byteLength(params.delta) > 64_000) throw error('MUSE_TEXT_LIMIT')
          streamed.set(params.itemId, prior + params.delta); ctx.delta('assistant_text', params.delta)
        } else if (item.kind === 'reasoning') ctx.delta('reasoning_text', params.delta)
      } else if (frame.method === 'turn/completed' && matches) {
        const reported = usage(params.usage)
        await ctx.complete({ ok: params.terminal === 'completed', stopReason: params.terminal === 'completed' ? 'completed'
          : params.terminal === 'cancelled' ? 'cancelled' : 'failed', cancelled: params.terminal === 'cancelled', usage: reported,
          ...(params.terminal !== 'completed' && params.terminal !== 'cancelled' ? { outcome: 'unknown', errorCode: 'MUSE_TURN_FAILED' } : {}) })
      } else if (frame.method === 'approval/requested' && (matches || params.turnId === undefined)) {
        if (!identifier(params.approvalId) || handledAsks.has(params.approvalId)) throw error('MUSE_APPROVAL_ID_INVALID')
        if (handledAsks.size >= 2048) throw error('MUSE_APPROVAL_LIMIT')
        handledAsks.add(params.approvalId)
        const choice = Array.isArray(params.availableChoices) && (params.availableChoices.find(value => value?.decision === 'denied')
          ?? params.availableChoices.find(value => value?.decision === 'abort'))
        if (!choice || !identifier(choice.choiceId)) throw error('MUSE_PERMISSION_DENY_UNAVAILABLE')
        await command(ctx, 'approval/decide', { sessionId: session.id, approvalId: params.approvalId,
          requirementId: params.currentRequirementId, choiceId: choice.choiceId })
      } else if (frame.method === 'userInput/requested' && (matches || params.turnId === undefined)) {
        if (!identifier(params.userInputId) || handledAsks.has(params.userInputId)) throw error('MUSE_INPUT_ID_INVALID')
        if (handledAsks.size >= 2048) throw error('MUSE_APPROVAL_LIMIT')
        handledAsks.add(params.userInputId)
        await command(ctx, 'userInput/cancel', { sessionId: session.id, userInputId: params.userInputId,
          reason: 'This text-only Host route has no interactive question handler.' })
      }
    },
  })
}

export const createMuseEngine = options => createNativeRpcEngine(options, createMuseProtocol())
