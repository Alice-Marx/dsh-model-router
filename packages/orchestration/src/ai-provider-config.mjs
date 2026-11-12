import { randomUUID } from 'node:crypto'

export const AI_PROTOCOLS = Object.freeze(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
export const AI_PRESETS = Object.freeze([
  { id: 'xai', name: 'Grok', mark: 'G', protocol: 'openai-completions', baseUrl: 'https://api.x.ai/v1', catalog: 'xai' },
  { id: 'moonshotai-cn', name: 'Kimi', mark: 'K', protocol: 'openai-completions', baseUrl: 'https://api.moonshot.cn/v1', catalog: 'moonshotai-cn' },
  { id: 'anthropic', name: 'Claude API', mark: '✳', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', catalog: 'anthropic' },
  { id: 'openai', name: 'OpenAI API', mark: 'O', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', catalog: 'openai' },
  { id: 'google', name: 'Google Gemini API', mark: '✦', protocol: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com', catalog: 'google' },
  { id: 'deepseek', name: 'DeepSeek API', mark: 'D', protocol: 'openai-completions', baseUrl: 'https://api.deepseek.com/v1', catalog: 'deepseek' },
  { id: 'stepfun', name: 'StepFun', mark: 'S', protocol: 'openai-completions', baseUrl: 'https://api.stepfun.com/v1', catalog: null },
  { id: 'openrouter', name: 'OpenRouter', mark: 'R', protocol: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', catalog: 'openrouter' },
  { id: 'custom', name: '自定义 / 本地服务', mark: '+', protocol: 'openai-completions', baseUrl: '', catalog: null },
])
export const aiProviderRoute = id => `bot-ai-${id}`
export const aiProviderCredentialRef = id => `DSH_BOT_AI_${id.toUpperCase()}_API_KEY`
export const aiFail = (code, message) => { throw Object.assign(new Error(message), { code }) }
export const aiPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export async function aiAbortable(operation, signal) {
  signal.throwIfAborted()
  let cancel
  const pending = Promise.resolve().then(() => { signal.throwIfAborted(); return operation() })
  try { return await Promise.race([pending, new Promise((_resolve, reject) => { cancel = () => reject(signal.reason); signal.addEventListener('abort', cancel, { once: true }) })]) }
  finally { signal.removeEventListener('abort', cancel); void pending.then(value => { if (signal.aborted) void value?.body?.cancel().catch(() => {}) }, () => {}) }
}
const text = (value, size) => typeof value === 'string' && value.trim().length > 0 && value.length <= size && !/[\p{Cc}]/u.test(value)
export const aiLoopback = hostname => /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/.test(hostname)
export function aiEndpoint(raw) {
  let url
  try { url = new URL(raw) } catch { aiFail('AI_PROVIDER_ENDPOINT_INVALID', '请输入完整的服务地址。') }
  if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && aiLoopback(url.hostname))) {
    aiFail('AI_PROVIDER_ENDPOINT_INVALID', '服务地址须使用 HTTPS，本机服务可使用 HTTP；地址中不能包含账号、密钥、查询参数或片段。')
  }
  return url.href.replace(/\/+$/, '')
}
export function normalizeAiProvider(input, current = null) {
  if (!aiPlain(input) || Object.keys(input).some(key => !['id', 'expectedRevision', 'preset', 'name', 'protocol', 'baseUrl', 'models', 'enabled', 'auth', 'apiKey', 'clearApiKey'].includes(key))) aiFail('AI_PROVIDER_INVALID', '提供方配置包含不支持的字段。')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !text(input.name, 100)
    || !AI_PRESETS.some(item => item.id === input.preset) || !AI_PROTOCOLS.includes(input.protocol) || typeof input.enabled !== 'boolean'
    || !['key', 'none'].includes(input.auth) || !Array.isArray(input.models) || input.models.length > 100 || input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean') aiFail('AI_PROVIDER_INVALID', '请填写名称、协议、认证方式和模型。')
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 8192 || input.apiKey && !/^[\x21-\x7e]+$/.test(input.apiKey))) aiFail('AI_PROVIDER_KEY_INVALID', '请只粘贴 API Key，不含空格、引号或环境变量名称。')
  const baseUrl = aiEndpoint(input.baseUrl)
  if (input.auth === 'none' && !aiLoopback(new URL(baseUrl).hostname)) aiFail('AI_PROVIDER_KEY_REQUIRED', '远程服务需要单独配置 API Key；免密连接用于本机服务。')
  const models = input.models.map(model => {
    if (!aiPlain(model) || Object.keys(model).some(key => !['id', 'name', 'contextWindow', 'maxTokens', 'reasoning'].includes(key)) || !text(model.id, 240) || !/^[A-Za-z0-9][A-Za-z0-9._:/@#-]*$/.test(model.id)
      || !text(model.name, 160) || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 2 || model.contextWindow > 100_000_000
      || !Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1 || model.maxTokens >= model.contextWindow || typeof model.reasoning !== 'boolean') aiFail('AI_PROVIDER_MODEL_INVALID', '每个模型都需要准确的模型 ID、上下文容量和小于上下文的输出上限。')
    return { ...model, id: model.id.trim(), name: model.name.trim() }
  })
  if (new Set(models.map(model => model.id)).size !== models.length) aiFail('AI_PROVIDER_MODEL_DUPLICATE', '同一连接的模型 ID 不能重复。')
  if (input.id !== undefined && input.id !== null && (!current || input.id !== current.id)) aiFail('AI_PROVIDER_NOT_FOUND', '提供方连接不存在，请刷新。')
  const id = current?.id ?? randomUUID().replaceAll('-', '')
  return { id, route: aiProviderRoute(id), preset: input.preset, name: input.name.trim(), protocol: input.protocol, baseUrl, models, enabled: input.enabled, auth: input.auth }
}
