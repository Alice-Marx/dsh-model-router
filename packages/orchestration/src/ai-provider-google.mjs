import { randomUUID } from 'node:crypto'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { convertMessages, convertTools } from '@earendil-works/pi-ai/api/google-shared'
import { aiAbortable } from './ai-provider-config.mjs'

async function* sse(response, signal) {
  const reader = response.body?.getReader()
  if (!reader) throw new LlmError('Gemini 未返回事件流。', 'PROVIDER_ERROR')
  const decoder = new TextDecoder(); let buffer = '', total = 0
  try {
    for (;;) {
      const part = await aiAbortable(() => reader.read(), signal)
      if (part.done) break
      total += part.value.length
      if (total > 32_000_000) throw new LlmError('Gemini 响应超出请求读取上限。', 'PROVIDER_ERROR')
      buffer = (buffer + decoder.decode(part.value, { stream: true })).replaceAll('\r\n', '\n')
      if (buffer.length > 2_000_000) throw new LlmError('Gemini 事件过大。', 'PROVIDER_ERROR')
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        const payload = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (payload && payload !== '[DONE]') yield JSON.parse(payload)
      }
    }
    if (buffer.trim()) throw new LlmError('Gemini 事件流未完整结束。', 'PROVIDER_ERROR')
  } finally { void reader.cancel().catch(() => {}) }
}

/** Gemini REST keeps the same explicit credential, redirect and cap fence as other APIs. */
export async function* streamGoogle(model, context, options) {
  const generationConfig = { maxOutputTokens: options.maxTokens, ...(options.temperature === undefined ? {} : { temperature: options.temperature }) }
  if (options.thinking) generationConfig.thinkingConfig = options.thinking.level ? { thinkingLevel: options.thinking.level, includeThoughts: true } : { thinkingBudget: options.thinking.budgetTokens, includeThoughts: true }
  const tools = convertTools(context.tools ?? [])
  const body = { contents: convertMessages(model, context), generationConfig,
    ...(context.systemPrompt ? { systemInstruction: { parts: [{ text: context.systemPrompt }] } } : {}), ...(tools?.length ? { tools } : {}) }
  const base = model.baseUrl.replace(/\/v1(?:beta)?$/, '')
  const url = `${base}/v1beta/models/${encodeURIComponent(model.id.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`
  const response = await options.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey }, body: JSON.stringify(body), signal: options.signal, redirect: 'error' })
  options.onResponse?.({ status: response.status })
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new LlmError(response.status === 401 || response.status === 403 ? 'Gemini 拒绝了此连接的 API Key。' : 'Gemini 请求失败，请检查连接设置。', [401, 403].includes(response.status) ? 'AUTH' : 'PROVIDER_ERROR') }
  const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() }
  let stopped = false, current = null
  const closeBlock = () => current ? { type: current.type === 'thinking' ? 'thinking_end' : 'text_end', contentIndex: message.content.length - 1, content: current.type === 'thinking' ? current.thinking : current.text, partial: message } : null
  for await (const frame of sse(response, options.signal)) {
    if (frame.error || frame.promptFeedback?.blockReason) throw new LlmError('Gemini 拒绝或过滤了此请求。', 'PROVIDER_ERROR')
    const candidate = frame.candidates?.[0]
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === 'string') {
        const type = part.thought === true ? 'thinking' : 'text'
        // A thought signature belongs to its original part; never move it to a later part.
        if (!current || current.type !== type || (type === 'thinking' ? current.thinkingSignature : current.textSignature)) {
          const end = closeBlock(); if (end) yield end
          current = type === 'thinking' ? { type, thinking: '' } : { type, text: '' }; message.content.push(current)
          yield { type: type === 'thinking' ? 'thinking_start' : 'text_start', contentIndex: message.content.length - 1, partial: message }
        }
        if (type === 'thinking') { current.thinking += part.text; if (part.thoughtSignature) current.thinkingSignature = part.thoughtSignature }
        else { current.text += part.text; if (part.thoughtSignature) current.textSignature = part.thoughtSignature }
        yield { type: type === 'thinking' ? 'thinking_delta' : 'text_delta', contentIndex: message.content.length - 1, delta: part.text, partial: message }
      }
      if (part.functionCall) {
        const end = closeBlock(); if (end) yield end; current = null
        const supplied = part.functionCall.id
        const block = { type: 'toolCall', id: supplied && !message.content.some(item => item.id === supplied) ? supplied : `gemini_${randomUUID().replaceAll('-', '')}`,
          name: part.functionCall.name, arguments: part.functionCall.args ?? {}, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) }
        message.content.push(block)
        yield { type: 'toolcall_start', contentIndex: message.content.length - 1, partial: message }
        yield { type: 'toolcall_delta', contentIndex: message.content.length - 1, delta: JSON.stringify(block.arguments), partial: message }
        yield { type: 'toolcall_end', contentIndex: message.content.length - 1, toolCall: block, partial: message }
      }
    }
    if (frame.usageMetadata) {
      const usage = frame.usageMetadata
      message.usage = { ...message.usage, input: Math.max(0, (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0) - (usage.cachedContentTokenCount ?? 0)),
        output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0), cacheRead: usage.cachedContentTokenCount ?? 0, totalTokens: usage.totalTokenCount ?? 0 }
    }
    if (candidate?.finishReason) {
      if (!['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) throw new LlmError('Gemini 未正常完成此回复。', 'PROVIDER_ERROR')
      stopped = true; message.stopReason = candidate.finishReason === 'MAX_TOKENS' ? 'length' : message.content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop'
    }
  }
  const end = closeBlock(); if (end) yield end
  if (!stopped) throw new LlmError('Gemini 流结束前没有完成标记。', 'PROVIDER_ERROR')
  yield { type: 'done', reason: message.stopReason, message }
}
