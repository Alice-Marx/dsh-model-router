import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { aiAbortable } from './ai-provider-config.mjs'

const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
const textContent = blocks => (blocks ?? []).filter(block => ['text', 'reasoning'].includes(block.type)).map(block => block.text ?? '').join('\n')
const stripReplay = value => { const { replayState: _state, ...rest } = value; return rest }
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const sdkBlock = block => block.type === 'toolCall' ? { type: 'tool-call', id: block.id, name: block.name, arguments: JSON.stringify(block.arguments) }
  : block.type === 'thinking' ? { type: 'reasoning', text: block.thinking } : { type: 'text', text: block.text }

export function aiRequestContext(options, profile) {
  const system = [options.system].filter(Boolean), messages = [], tools = options.tools ?? []
  const calls = new Map()
  for (const message of options.messages ?? []) {
    if (message.role === 'system') { system.push(textContent(message.content)); continue }
    if (message.role === 'developer') { const text = textContent(message.content); if (text) messages.push({ role: 'user', content: [{ type: 'text', text }], timestamp: 0 }); continue }
    if (message.role === 'tool') {
      const callId = message.toolCallId ?? message.source?.callId
      messages.push({ role: 'toolResult', toolCallId: callId, toolName: calls.get(callId) ?? 'tool', content: [{ type: 'text', text: textContent(message.content) }], isError: message.isError === true, timestamp: 0 }); continue
    }
    if (message.role === 'assistant') {
      const content = (message.content ?? []).flatMap(block => {
        if (block.type === 'text') return [{ type: 'text', text: block.text }]
        if (block.type === 'tool-call') {
          calls.set(block.id, block.name)
          let args
          try { args = JSON.parse(block.arguments) } catch { throw new LlmError('历史工具参数不是有效 JSON。', 'INVALID_REQUEST') }
          return [{ type: 'toolCall', id: block.id, name: block.name, arguments: args }]
        }
        return []
      })
      const replay = message.source?.replayState
      const restored = replay?.meta?.kind === 'dsh-bot-ai-v1' && message.source.provider === profile.route
        && message.source.model === options.model && replay.meta.contentHash === digest(message.content) && Array.isArray(replay.content) && replay.content.length === message.content.length
        ? replay.content : null
      messages.push({ role: 'assistant', api: profile.protocol, provider: profile.route, model: options.model,
        content: restored ?? content, usage: zeroUsage(), stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: 0 })
      continue
    }
    if (message.role === 'user') {
      if (message.content?.some(block => block.type !== 'text')) throw new LlmError('此独立 API 连接目前接收文本和工具结果。', 'UNSUPPORTED_CONTENT')
      messages.push({ role: 'user', content: message.content.map(block => ({ type: 'text', text: block.text })), timestamp: 0 })
    }
  }
  return { systemPrompt: system.join('\n\n'), messages, tools: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }
}

const APIs = Object.freeze({
  'openai-completions': () => import('@earendil-works/pi-ai/api/openai-completions'),
  'openai-responses': () => import('@earendil-works/pi-ai/api/openai-responses'),
  'anthropic-messages': () => import('@earendil-works/pi-ai/api/anthropic-messages'),
  'google-generative-ai': async () => ({ stream: (await import('./ai-provider-google.mjs')).streamGoogle }),
})

/** One immutable owner-configured generation; a saved replacement cannot dispatch it. */
export class AiProviderAdapter extends LlmAdapter {
  constructor({ profile, acquire, onResult, fetcher = globalThis.fetch }) { super(); this.profile = structuredClone(profile); this.acquire = acquire; this.onResult = onResult; this.fetcher = fetcher }
  providerInfo() { return { id: this.profile.route, name: `${this.profile.name} · 插件独立` } }
  async listModels(provider) { return this.profile.enabled ? this.profile.models.map(model => ({ provider, id: model.id, name: model.name, inputModalities: ['text'] })) : [] }
  async resolveModel(provider, model) {
    const entry = this.profile.models.find(item => item.id === model)
    if (provider !== this.profile.route || !this.profile.enabled || !entry) throw new LlmError('此独立模型连接已停用或不存在。', 'NO_MODEL')
    return { provider, id: model, name: entry.name, inputModalities: ['text'], context: { contextWindow: entry.contextWindow }, defaultMaxTokens: entry.maxTokens,
      ...(entry.reasoning ? { reasoning: { efforts: ['low', 'medium', 'high'].map(id => ({ id, name: id })) } } : {}) }
  }
  async *stream(options) {
    if (options.stop !== undefined) throw new LlmError('此独立连接尚未支持自定义停止序列。', 'UNSUPPORTED_OPTION')
    await this.resolveModel(options.provider, options.model)
    let lease
    try { lease = await this.acquire(this.profile) }
    catch (error) { throw new LlmError('此独立连接已修改、停用或缺少密钥，请重新检查 AI 提供方设置。', error?.code === 'AI_PROVIDER_CHANGED' ? 'AI_PROVIDER_CHANGED' : 'MISSING_CREDENTIAL') }
    const consumer = new AbortController(), signal = AbortSignal.any([lease.signal, consumer.signal, ...(options.signal ? [options.signal] : [])])
    let idleTimer, timedOut = false
    const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { timedOut = true; consumer.abort() }, 120_000); idleTimer.unref?.() }
    touch()
    let status
    try {
      const entry = this.profile.models.find(item => item.id === options.model)
      const baseUrl = this.profile.protocol === 'anthropic-messages' ? this.profile.baseUrl.replace(/\/v1$/, '') : this.profile.baseUrl
      const model = { ...entry, api: this.profile.protocol, provider: this.profile.route, baseUrl,
        input: ['text'], cost: zeroUsage().cost }
      const { stream } = await APIs[this.profile.protocol]()
      const context = aiRequestContext(options, this.profile)
      const cap = options.maxTokens ?? entry.maxTokens, effort = options.reasoningEffort
      let thinking = {}
      if (effort) {
        if (this.profile.protocol === 'anthropic-messages' || this.profile.protocol === 'google-generative-ai') {
          if (cap < 2048) throw new LlmError('当前输出上限不足以同时容纳思考与回答，请提高输出上限或关闭思考强度。', 'MODEL_OUTPUT_BOUNDARY_REQUIRED')
          const budget = Math.min({ low: 2048, medium: 8192, high: 16384 }[effort], cap - 1024)
          thinking = this.profile.protocol === 'anthropic-messages' ? { thinkingEnabled: true, thinkingBudgetTokens: budget, effort }
            : { thinking: { enabled: true, ...(entry.id.startsWith('gemini-3') ? { level: effort.toUpperCase() } : { budgetTokens: budget }) } }
        } else thinking = { reasoningEffort: effort }
      }
      const upstream = stream(model, context, { apiKey: lease.key || 'local-no-key', signal, ...thinking,
        maxTokens: options.maxTokens ?? entry.maxTokens, ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        sessionId: options.sessionId,
        onResponse: response => { status = response.status },
        fetch: async (input, init) => {
          const body = JSON.parse(init?.body ?? (input instanceof Request ? await input.clone().text() : '{}'))
          const bound = body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens ?? body.generationConfig?.maxOutputTokens
          if (!Number.isSafeInteger(bound) || bound < 1 || bound > (options.maxTokens ?? entry.maxTokens)) throw new LlmError('提供方 SDK 生成的输出上限与已准入请求不一致，请检查思考强度与输出配置。', 'MODEL_OUTPUT_BOUNDARY_REQUIRED')
          return aiAbortable(() => this.fetcher(input, { ...init, redirect: 'error', signal }), signal)
        },
      })
      const iterator = upstream[Symbol.asyncIterator]()
      for (;;) {
        const next = await aiAbortable(() => iterator.next(), signal)
        if (next.done) break
        const event = next.value; touch()
        const index = event.contentIndex
        if (event.type === 'text_start' || event.type === 'thinking_start') yield { type: 'block-start', index, blockType: event.type === 'text_start' ? 'text' : 'reasoning' }
        if (event.type === 'text_delta' || event.type === 'thinking_delta') yield { type: event.type === 'text_delta' ? 'text-delta' : 'reasoning-delta', index, text: event.delta }
        if (event.type === 'toolcall_start') {
          const block = event.partial.content[index]
          yield { type: 'block-start', index, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: '' }
        }
        if (event.type === 'toolcall_delta') {
          const block = event.partial.content[index]
          yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: event.delta }
        }
        if (event.type === 'text_end' || event.type === 'thinking_end') yield { type: 'block-end', index, block: { type: event.type === 'text_end' ? 'text' : 'reasoning', text: event.content } }
        if (event.type === 'toolcall_end') yield { type: 'block-end', index, block: { type: 'tool-call', id: event.toolCall.id, name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.arguments) } }
        if (event.type === 'error') {
          const auth = status === 401 || status === 403 || /\b(?:401|403)\b|authentication|invalid.{0,8}(?:key|token)/i.test(event.error.errorMessage ?? '')
          throw new LlmError(auth ? '独立提供方拒绝了此连接的 API Key，请在 AI 提供方设置中更新。' : signal.aborted ? '此模型请求已取消。' : '独立提供方调用失败，请检查服务地址、协议和模型。', auth ? 'AUTH' : signal.aborted ? 'ABORTED' : 'PROVIDER_ERROR')
        }
        if (event.type === 'done') {
          const usage = event.message.usage
          if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0) yield { type: 'usage', usage: { inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, ...(usage.totalTokens > 0 ? { totalTokens: usage.totalTokens } : {}) } }
          this.onResult(this.profile, { kind: 'verified', status: status ?? 200 })
          yield { type: 'finish', reason: { kind: event.reason === 'toolUse' ? 'tool-calls' : event.reason === 'length' ? 'max-tokens' : 'stop' },
            replayState: { meta: { kind: 'dsh-bot-ai-v1', contentHash: digest(event.message.content.map(sdkBlock)) }, content: event.message.content.map(stripReplay) } }
        }
      }
    } catch (error) {
      if (timedOut) { this.onResult(this.profile, { kind: 'error', code: 'TIMEOUT' }); throw new LlmError('提供方长时间没有返回数据，请检查连接后重试。', 'TIMEOUT') }
      this.onResult(this.profile, { kind: signal.aborted ? 'cancelled' : 'error', code: error?.code ?? 'PROVIDER_ERROR', ...(status ? { status } : {}) })
      if (error instanceof LlmError) throw error
      throw new LlmError(signal.aborted ? '此模型请求已取消。' : '无法连接独立 AI 提供方，请重新检查连接设置。', signal.aborted ? 'ABORTED' : 'PROVIDER_ERROR')
    } finally { clearTimeout(idleTimer); consumer.abort(); lease.release() }
  }
}
