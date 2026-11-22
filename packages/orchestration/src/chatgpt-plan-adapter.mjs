import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { CHATGPT_RESOURCE, planError } from './chatgpt-plan-oauth.mjs'
import { aiAbortable } from './ai-provider-config.mjs'

const formatRequest = options => {
  const input = []
  for (const message of options.messages ?? []) {
    if (!['system', 'developer', 'user', 'assistant'].includes(message.role)
        || (message.content ?? []).some(part => part.type !== 'text' && !(part.type === 'reasoning' && message.role === 'assistant'))) {
      throw new LlmError('ChatGPT 套餐连接当前支持纯文本对话。', 'UNSUPPORTED_CONTENT')
    }
    const content = (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n')
    if (content) input.push({ role: message.role === 'system' ? 'developer' : message.role, content })
  }
  if (!input.length) throw new LlmError('请发送文本消息。', 'INVALID_REQUEST')
  return { model: options.model, input, ...(options.system ? { instructions: options.system } : {}),
    store: false, stream: true }
}

function responseError(status, shape, requestId) {
  const code = typeof shape?.code === 'string' && /^[\w-]{1,100}$/.test(shape.code) ? shape.code : undefined
  const messages = {
    subscription_sharing_usage_limit_exceeded: '已达到 ChatGPT 套餐使用上限，请在 ChatGPT 设置中查看用量。',
    subscription_sharing_user_not_eligible: '当前 ChatGPT 账户或工作区无法使用套餐推理。',
    subscription_sharing_usage_unavailable: '暂时无法检查 ChatGPT 套餐用量，请稍后重试。',
    subscription_sharing_unsupported_capability: '此 ChatGPT 套餐请求包含目前不支持的功能。',
  }
  const message = messages[code] ?? (status === 401 ? 'ChatGPT 授权未被接受，请重新登录。'
    : status === 403 ? 'ChatGPT 拒绝了此账户或工作区的套餐请求。' : 'ChatGPT 套餐请求失败，请检查账户后重试。')
  const id = /^[\w-]{1,128}$/.test(requestId ?? '') ? requestId : undefined
  return Object.assign(new LlmError(message + (id ? ' 请求编号 ' + id : ''), code ?? (status === 401 ? 'AUTH' : 'PROVIDER_ERROR')),
    { status, requestId: id })
}

export async function chatGptPlanModels(accessToken, fetcher, signal) {
  const response = await fetcher(CHATGPT_RESOURCE + '/models', {
    headers: { authorization: 'Bearer ' + accessToken, accept: 'application/json' }, redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw responseError(response.status, body?.error, response.headers.get('x-request-id'))
  if (!Array.isArray(body?.models)) throw planError('MODELS_UNAVAILABLE', 'ChatGPT 未返回账户的模型目录。')
  const models = new Map()
  for (const model of body.models) {
    if (model?.visibility !== 'list' || typeof model.slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,239}$/.test(model.slug)) continue
    if (Array.isArray(model.input_modalities) && !model.input_modalities.includes('text')) continue
    const name = typeof model.display_name === 'string' ? model.display_name.trim() : ''
    models.set(model.slug, { id: model.slug, name: name && name.length <= 240 && !/\p{Cc}/u.test(name) ? name : model.slug })
  }
  return [...models.values()].slice(0, 64)
}

async function* readEvents(body, signal, touch) {
  if (!body) throw new LlmError('ChatGPT 未返回响应流。', 'PROVIDER_ERROR')
  const reader = body.getReader(), decoder = new TextDecoder()
  let buffer = '', data = ''
  try {
    for (;;) {
      const { done, value } = await aiAbortable(() => reader.read(), signal)
      if (done) break
      touch()
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length + data.length > 8 * 1024 * 1024) throw new LlmError('ChatGPT 响应事件过大。', 'PROVIDER_ERROR')
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '')
        if (!line && data) {
          const payload = data
          data = ''
          if (payload !== '[DONE]') yield JSON.parse(payload)
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export class ChatGptPlanAdapter extends LlmAdapter {
  constructor({ model, provider, name, acquire, markVerified, fetcher = globalThis.fetch }) {
    super()
    Object.assign(this, { model, provider, name, acquire, markVerified, fetcher })
  }

  providerInfo() { return { id: this.provider, name: this.name } }
  async listModels(provider) { return provider === this.provider ? [await this.resolveModel(provider, this.model.id)] : [] }
  async resolveModel(provider, model) {
    if (provider !== this.provider || model !== this.model.id) throw new LlmError('ChatGPT 账户模型不存在。', 'NO_MODEL')
    return { provider, id: model, name: this.model.name, inputModalities: ['text'] }
  }

  async *stream(options) {
    await this.resolveModel(options.provider, options.model)
    if (options.tools?.length || options.stop !== undefined) throw new LlmError('ChatGPT 套餐连接当前支持纯文本对话。', 'UNSUPPORTED_OPTION')
    const request = formatRequest(options)
    const timeout = new AbortController()
    let timer, lease
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => timeout.abort(), 120_000); timer.unref?.() }
    touch()
    try {
      lease = await this.acquire(options.signal)
      const signal = AbortSignal.any([lease.signal, timeout.signal, ...(options.signal ? [options.signal] : [])])
      signal.throwIfAborted()
      const response = await this.fetcher(CHATGPT_RESOURCE + '/responses', { method: 'POST', redirect: 'error',
        headers: { authorization: 'Bearer ' + lease.token, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(request), signal })
      const requestId = response.headers.get('x-request-id')
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw responseError(response.status, error?.error, requestId)
      }
      let started = false, text = ''
      for await (const event of readEvents(response.body, signal, touch)) {
        if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) {
          throw responseError(response.status, event.response?.error ?? event.error ?? event, requestId)
        }
        if ((event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') && typeof event.delta === 'string') {
          if (!started) {
            started = true
            yield { type: 'block-start', index: 0, blockType: 'text' }
          }
          text += event.delta
          yield { type: 'text-delta', index: 0, text: event.delta }
        }
        if (event.type !== 'response.completed') continue
        if (!started) {
          text = (event.response?.output ?? []).filter(item => item.type === 'message').flatMap(item => item.content ?? [])
            .map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '').join('')
          if (text) {
            started = true
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text }
          }
        }
        if (started) yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        const usage = event.response?.usage
        if (Number.isSafeInteger(usage?.input_tokens) && Number.isSafeInteger(usage?.output_tokens)) {
          const cached = usage.input_tokens_details?.cached_tokens
          const cacheReadTokens = Number.isSafeInteger(cached) && cached >= 0 && cached <= usage.input_tokens ? cached : 0
          yield { type: 'usage', usage: { inputTokens: usage.input_tokens - cacheReadTokens,
            outputTokens: usage.output_tokens, cacheReadTokens } }
        }
        this.markVerified()
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      throw new LlmError('ChatGPT 响应流在完成前断开。', 'PROVIDER_ERROR')
    } catch (error) {
      if (timeout.signal.aborted) throw new LlmError('等待 ChatGPT 响应超时。', 'TIMEOUT')
      if (lease?.signal.aborted || options.signal?.aborted) throw new LlmError('ChatGPT 请求已取消。', 'ABORTED')
      if (error instanceof LlmError) throw error
      throw new LlmError(error?.code === 'SUBSCRIPTION_AUTH_REQUIRED' ? 'ChatGPT 授权已失效，请重新登录。'
        : 'ChatGPT 套餐连接失败，请检查账户后重试。', error?.code === 'SUBSCRIPTION_AUTH_REQUIRED' ? 'AUTH' : 'PROVIDER_ERROR')
    } finally {
      clearTimeout(timer)
      lease?.release()
    }
  }
}
