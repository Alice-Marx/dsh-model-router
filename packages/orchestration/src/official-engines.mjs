import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { MAX_TASK_BYTES, executeAssignedTask, sliceUtf8 } from '../../../.dsh-plugin/shared/task-executors.mjs'
import { runOfficialTool } from '../../../.dsh-plugin/shared/official-tool-executor.mjs'
import { ENGINE_PROVIDER_TOOLS, isEngineProvider as registeredEngine, toolForProvider } from '../../../.dsh-plugin/shared/official-tool-registry.mjs'

/**
 * Official CLI tools as model engines. A Bot that picks "Claude Code · 默认模型"
 * runs each turn through the vendor CLI the user already signed in to, the same
 * way it would run on an API route. The CLI is launched headless and read-only in
 * a Host-owned empty workspace with its own subscription login (API-key variables
 * stripped), so the engine never spends an API key and never touches user files.
 *
 * Nothing about the launch comes from the request: the provider id selects a fixed
 * registry entry, the model id selects a fixed catalog row, and the executable is
 * resolved by the registry's own probe or verified runner.
 */

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_CONTEXT_WINDOW = 200_000
const SYSTEM_SHARE_BYTES = 20_000
const TOOL_RESULT_BYTES = 2_000
const PROMPT_HEADROOM_BYTES = 1_024

const model = (id, name, cliModel, description) => Object.freeze({ id, name, cliModel, ...(description ? { description } : {}) })

/** Fixed engine catalog. `default` omits the CLI model flag and uses the CLI's own setting. */
export const OFFICIAL_ENGINES = Object.freeze([
  Object.freeze({
    provider: 'engine-claude-code', toolId: 'claude-code', name: 'Claude Code（官方工具）', vendor: 'Anthropic',
    login: 'claude', contextWindow: DEFAULT_CONTEXT_WINDOW,
    models: Object.freeze([
      model('default', '默认模型', null, '使用 Claude Code 当前登录账号与 CLI 设置里的模型'),
      model('sonnet', 'Claude Sonnet', 'sonnet'),
      model('opus', 'Claude Opus', 'opus'),
      model('haiku', 'Claude Haiku', 'haiku'),
    ]),
  }),
  Object.freeze({
    provider: 'engine-codex', toolId: 'codex', name: 'Codex（官方工具）', vendor: 'OpenAI',
    login: 'codex login', contextWindow: DEFAULT_CONTEXT_WINDOW,
    models: Object.freeze([
      model('default', '默认模型', null, '使用 Codex 当前登录账号与 CLI 设置里的模型'),
      model('gpt-5.6-sol', 'GPT-5.6 Sol', 'gpt-5.6-sol'),
      model('gpt-5.5', 'GPT-5.5', 'gpt-5.5'),
      model('gpt-5.4-mini', 'GPT-5.4 Mini', 'gpt-5.4-mini'),
    ]),
  }),
  Object.freeze({
    provider: 'engine-gemini', toolId: 'gemini', name: 'Gemini CLI（官方工具）', vendor: 'Google',
    login: 'gemini', contextWindow: DEFAULT_CONTEXT_WINDOW,
    models: Object.freeze([
      model('default', '默认模型', null, '使用 Gemini CLI 当前登录账号与 CLI 设置里的模型'),
    ]),
  }),
])

const BY_PROVIDER = new Map(OFFICIAL_ENGINES.map(engine => [engine.provider, engine]))

export const isEngineProvider = provider => registeredEngine(provider) && BY_PROVIDER.has(provider)
export const engineFor = provider => BY_PROVIDER.get(provider) ?? null
export const engineModel = (provider, modelId) => engineFor(provider)?.models.find(item => item.id === modelId) ?? null

const textOf = content => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    if (block?.type === 'text') return String(block.text ?? '')
    if (block?.type === 'image') return '[图片]'
    if (block?.type === 'file') return `[文件 ${block.attachment?.name ?? ''}]`.replace(' ]', ']')
    if (block?.type === 'tool-call') return `[调用工具 ${block.name ?? ''}]`
    return ''
  }).filter(Boolean).join('\n')
}

const ROLE_LABEL = { user: '用户', assistant: '助手', tool: '工具结果', developer: '系统说明' }

/**
 * One prompt for one CLI call: the system prompt (bounded), then the most recent
 * turns that fit the CLI prompt limit. Earlier turns are dropped first; the last
 * message always survives, truncated if it alone is too large.
 */
export function enginePrompt(options, { maxBytes = MAX_TASK_BYTES - PROMPT_HEADROOM_BYTES } = {}) {
  const messages = Array.isArray(options?.messages) ? options.messages : []
  const systemParts = [typeof options?.system === 'string' ? options.system : '',
    ...messages.filter(message => message?.role === 'system').map(message => textOf(message.content))].filter(Boolean)
  const system = systemParts.length ? sliceUtf8(systemParts.join('\n\n'), SYSTEM_SHARE_BYTES) : ''
  const lines = messages.filter(message => message?.role !== 'system').map(message => {
    let body = textOf(message?.content).trim()
    if (message?.role === 'tool') body = sliceUtf8(body, TOOL_RESULT_BYTES)
    return body ? `【${ROLE_LABEL[message?.role] ?? '消息'}】\n${body}` : ''
  }).filter(Boolean)
  const head = [
    system ? `<system>\n${system}\n</system>` : '',
    '以下是到目前为止的对话。请以“助手”的身份只回复最后一条消息；不要修改任何文件，不要声称执行了你没有执行的操作。',
  ].filter(Boolean).join('\n\n')
  const budget = maxBytes - Buffer.byteLength(head, 'utf8') - 4
  const kept = []
  let used = 0
  for (let index = lines.length - 1; index >= 0; index--) {
    const size = Buffer.byteLength(lines[index], 'utf8') + 2
    if (used + size > budget) {
      if (kept.length === 0) kept.unshift(sliceUtf8(lines[index], Math.max(0, budget - 2)))
      break
    }
    kept.unshift(lines[index])
    used += size
  }
  const dropped = lines.length - kept.length
  const notice = dropped > 0 ? `（较早的 ${dropped} 条消息因长度限制未包含）\n\n` : ''
  return sliceUtf8(`${head}\n\n${notice}${kept.join('\n\n')}`, maxBytes)
}

/** Failure text without the router's "fell back to the API" wording: an engine never falls back. */
export function engineFailureText(engine, result) {
  const raw = String(result?.error || result?.fallback?.reason || '').trim()
  const cleaned = raw
    .replace(/[，,；;]?\s*已(?:回退|使用)模型目录\s*API[。.]?/g, '。')
    .replace(/。+/g, '。')
    .trim()
  const login = result?.fallback?.loginRequired || /not logged in|login|unauthori[sz]ed|sign in|未登录|登录/i.test(`${raw} ${result?.fallback?.error ?? ''}`)
  if (login) return `${engine.name}尚未登录或登录已过期。请在终端运行 \`${engine.login}\` 完成官方账号登录后重试。`
  if (/未安装|无法启动|not found|ENOENT/i.test(cleaned)) return `${engine.name}未安装或无法启动。请在“官方工具”页安装后重试。`
  return cleaned || `${engine.name}没有返回结果。`
}

const failure = (message, code) => ({ type: 'finish', reason: { kind: 'error', failure: { message, code } } })

/**
 * The adapter. `execute` runs one prompt through one engine and resolves to the
 * router's task result shape (`ok`, `answer`, `usage`, `error`, `cancelled`).
 */
export function createOfficialEngineAdapter({ execute, timeoutMs = DEFAULT_TIMEOUT_MS, maxConcurrent = 2, engines = OFFICIAL_ENGINES } = {}) {
  if (typeof execute !== 'function') throw new TypeError('OFFICIAL_ENGINE_EXECUTOR_REQUIRED')
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8) throw new TypeError('OFFICIAL_ENGINE_CONCURRENCY_INVALID')
  const own = new Map(engines.map(engine => [engine.provider, engine]))
  let running = 0
  const waiting = []
  const acquire = signal => new Promise((resolve, reject) => {
    if (running < maxConcurrent) { running += 1; resolve(); return }
    const entry = { resolve: () => { running += 1; resolve() }, reject }
    waiting.push(entry)
    signal?.addEventListener('abort', () => {
      const at = waiting.indexOf(entry)
      if (at >= 0) { waiting.splice(at, 1); reject(signal.reason ?? new Error('aborted')) }
    }, { once: true })
  })
  const release = () => { running -= 1; waiting.shift()?.resolve() }

  class OfficialEngineAdapter extends LlmAdapter {
    providerInfo(provider) {
      const engine = own.get(provider)
      return { id: provider, name: engine?.name ?? provider }
    }

    async listModels(provider) {
      const engine = own.get(provider)
      if (!engine) return []
      return engine.models.map(item => ({ provider, id: item.id, name: item.name, ...(item.description ? { description: item.description } : {}), inputModalities: ['text'] }))
    }

    async resolveModel(provider, modelId) {
      const engine = own.get(provider)
      const item = engine?.models.find(entry => entry.id === modelId)
      return { provider, id: modelId, name: item?.name ?? modelId, inputModalities: ['text'],
        ...(engine ? { context: { contextWindow: engine.contextWindow } } : {}) }
    }

    async * stream(options) {
      const engine = own.get(options?.provider)
      const item = engine?.models.find(entry => entry.id === options?.model)
      if (!engine || !item) {
        yield failure(`官方工具引擎 ${options?.provider ?? ''}/${options?.model ?? ''} 不在固定目录中。`, 'ENGINE_MODEL_UNKNOWN')
        return
      }
      const signal = options.signal
      if (signal?.aborted) { yield { type: 'finish', reason: { kind: 'aborted', failure: { message: '已取消。', code: 'ABORTED' } } }; return }
      try { await acquire(signal) } catch {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: '已取消。', code: 'ABORTED' } } }
        return
      }
      let result
      try {
        result = await execute({ engine, model: item, prompt: enginePrompt(options), signal, timeoutMs })
      } catch (error) {
        result = { ok: false, error: String(error?.message ?? error) }
      } finally { release() }
      if (result?.cancelled || signal?.aborted) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: '已取消。', code: 'ABORTED' } } }
        return
      }
      const answer = typeof result?.answer === 'string' ? result.answer : ''
      if (result?.ok !== true || !answer.trim()) {
        yield failure(engineFailureText(engine, result), result?.fallback?.loginRequired ? 'ENGINE_LOGIN_REQUIRED' : result?.timedOut ? 'ENGINE_TIMEOUT' : 'ENGINE_FAILED')
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: answer }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
      const usage = result.usage
      if (usage && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens)) {
        yield { type: 'usage', usage: {
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
          ...(Number.isSafeInteger(usage.cacheReadTokens) ? { cacheReadTokens: usage.cacheReadTokens } : {}),
          ...(Number.isSafeInteger(usage.cacheWriteTokens) ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
        } }
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  return new OfficialEngineAdapter()
}

/**
 * The default executor: the router's own vetted CLI path, session login only, no
 * API fallback. With the Harness process sandbox present the verified runner
 * confines the CLI; without it the portable read-only adapters run instead.
 */
export function defaultEngineExecutor({ ctx, workspace, spawnImpl, resolvePortableLaunch }) {
  return async ({ engine, model, prompt, signal, timeoutMs }) => {
    await mkdir(workspace, { recursive: true })
    const sandbox = ctx?.sandbox
    return executeAssignedTask({
      route: { provider: engine.provider, model: model.id, execution: 'official', ...(model.cliModel ? { cliModel: model.cliModel } : {}) },
      task: prompt, workspace, timeoutMs, signal, credentialMode: 'session-only',
      runVerified: typeof sandbox?.confine === 'function' ? request => runOfficialTool({ ...request, sandbox, mode: 'read-only' }) : null,
      ...(spawnImpl ? { spawnImpl } : {}),
      ...(resolvePortableLaunch ? { resolvePortableLaunch } : {}),
    })
  }
}

/** Register the fixed engines with the Host model service. Returns the disposer. */
export function registerOfficialEngines(ctx, { stateDir, timeoutMs = DEFAULT_TIMEOUT_MS, execute, maxConcurrent } = {}) {
  if (typeof ctx?.llm?.registerAdapter !== 'function') return () => {}
  for (const engine of OFFICIAL_ENGINES) {
    if (toolForProvider(engine.provider)?.id !== engine.toolId || ENGINE_PROVIDER_TOOLS[engine.provider] !== engine.toolId) {
      throw new Error(`OFFICIAL_ENGINE_REGISTRY_MISMATCH: ${engine.provider}`)
    }
  }
  const workspace = join(stateDir, 'engine-workspace')
  const adapter = createOfficialEngineAdapter({
    execute: execute ?? defaultEngineExecutor({ ctx, workspace }), timeoutMs,
    ...(maxConcurrent ? { maxConcurrent } : {}),
  })
  return ctx.llm.registerAdapter(OFFICIAL_ENGINES.map(engine => engine.provider), adapter)
}
