/**
 * Pluggable headless adapters for official vendor agent CLIs.
 *
 * A caller names a configured provider/model and a task. This module picks the
 * vendor adapter, detects the fixed executable, passes a credential only into
 * that process, runs in the given directory, and captures output under a
 * timeout. The API fallback stays outside this file: the caller supplies it.
 * No caller-supplied command, package, or argument list is accepted.
 *
 * Claude: https://code.claude.com/docs/en/headless
 * Codex:  https://learn.chatgpt.com/docs/non-interactive-mode
 * Gemini: https://google-gemini.github.io/gemini-cli/docs/cli/headless.html
 */
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { toolForProvider } from './official-tool-registry.mjs'
import { normalizeExecutionPreference } from './model-profiles.mjs'

const MAX_TASK_BYTES = 64_000
const MAX_ANSWER_CHARS = 48_000
const MAX_OUTPUT_BYTES = 2_000_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const MAX_TIMEOUT_MS = 45 * 60_000
const PROBE_TIMEOUT_MS = 8_000
const STOP_GRACE_MS = 5_000

const BASE_ENV_KEYS = Object.freeze([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'ComSpec',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
])

const READ_ONLY_INSTRUCTION = 'Read the task supplied on standard input. Answer in the task language. Do not modify files.'

/** Portable headless adapters. Registry tools without an entry here use the verified runner. */
export const TASK_ADAPTERS = Object.freeze([
  Object.freeze({
    id: 'claude-code',
    label: 'Claude Code',
    executable: 'claude',
    portable: true,
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    sessionEnv: Object.freeze(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR']),
    format: 'claude-json',
    buildArgs(modelId) {
      return [
        '-p', '--output-format', 'json', '--no-session-persistence',
        '--permission-mode', 'dontAsk',
        '--tools', 'Read,Glob,Grep', '--disallowedTools', 'mcp__*',
        ...(modelId ? ['--model', modelId] : []),
        READ_ONLY_INSTRUCTION,
      ]
    },
  }),
  Object.freeze({
    id: 'codex',
    label: 'Codex CLI',
    executable: 'codex',
    portable: true,
    apiKeyEnv: 'OPENAI_API_KEY',
    sessionEnv: Object.freeze(['CODEX_API_KEY', 'CODEX_HOME']),
    format: 'codex-jsonl',
    buildArgs(modelId) {
      return [
        'exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only',
        ...(modelId ? ['--model', modelId] : []),
        '-',
      ]
    },
  }),
  Object.freeze({
    id: 'gemini',
    label: 'Gemini CLI',
    executable: 'gemini',
    portable: true,
    portableOnly: true,
    apiKeyEnv: 'GEMINI_API_KEY',
    sessionEnv: Object.freeze(['GOOGLE_API_KEY', 'GEMINI_CONFIG_DIR']),
    format: 'gemini-json',
    buildArgs(modelId) {
      return [
        '-p', READ_ONLY_INSTRUCTION, '--output-format', 'json',
        ...(modelId ? ['-m', modelId] : []),
      ]
    },
  }),
])

const ADAPTER_BY_ID = new Map(TASK_ADAPTERS.map(adapter => [adapter.id, adapter]))

export function executionPreference(route) {
  return normalizeExecutionPreference(route?.execution)
}

export function adapterForProvider(provider) {
  const tool = toolForProvider(provider)
  if (!tool) return null
  return ADAPTER_BY_ID.get(tool.id) ?? Object.freeze({
    id: tool.id,
    label: tool.label,
    executable: null,
    portable: false,
    apiKeyEnv: null,
    sessionEnv: Object.freeze([]),
    format: null,
    buildArgs() { return [] },
  })
}

export function adapterForToolId(toolId) {
  return ADAPTER_BY_ID.get(String(toolId ?? '').trim()) ?? null
}

function checkedTask(task) {
  if (typeof task !== 'string' || !task.trim() || task.includes('\0') || Buffer.byteLength(task, 'utf8') > MAX_TASK_BYTES) {
    throw new TypeError(`task must be nonempty text of at most ${MAX_TASK_BYTES} UTF-8 bytes`)
  }
  return task
}

function checkedModel(modelId) {
  if (modelId === undefined || modelId === null || modelId === '') return null
  if (typeof modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(modelId)) return null
  return modelId
}

function checkedTimeout(timeoutMs) {
  const value = timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : timeoutMs
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}`)
  }
  return value
}

async function checkedWorkspace(workspace) {
  if (typeof workspace !== 'string' || !isAbsolute(workspace) || workspace.includes('\0')) {
    throw new TypeError('workspace must be an absolute directory path')
  }
  const canonical = await realpath(workspace)
  if (!(await stat(canonical)).isDirectory()) throw new TypeError('workspace must be a directory')
  return canonical
}

function cliModelFor(route, adapter) {
  const explicit = checkedModel(route?.cliModel)
  if (explicit) return explicit
  if (adapter?.id === 'claude-code' || adapter?.id === 'codex' || adapter?.id === 'gemini') {
    return checkedModel(route?.model)
  }
  return null
}

function childEnvironment(adapter, credentials) {
  const env = {}
  for (const key of BASE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  for (const key of adapter?.sessionEnv ?? []) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  const supplied = typeof credentials?.apiKey === 'string' ? credentials.apiKey : ''
  if (supplied && (supplied.includes('\0') || supplied.length > 4_096)) {
    throw new TypeError('apiKey is not a usable credential')
  }
  const inherited = adapter?.apiKeyEnv ? process.env[adapter.apiKeyEnv] : ''
  const apiKey = supplied || (typeof inherited === 'string' ? inherited : '')
  if (apiKey && adapter?.apiKeyEnv) env[adapter.apiKeyEnv] = apiKey
  return {
    env,
    secret: apiKey && adapter?.apiKeyEnv ? apiKey : '',
    credentialSource: supplied ? 'configured-api-key' : apiKey ? 'process-environment' : 'cli-session',
  }
}

function redact(value, secret) {
  const text = typeof value === 'string' ? value : ''
  if (!secret || !text.includes(secret)) return text
  return text.split(secret).join('[redacted]')
}

function versionFromBanner(value) {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(String(value ?? ''))
  return match ? match[1] : null
}

function parseClaude(stdout) {
  const result = JSON.parse(stdout)
  if (result.type !== 'result' || result.is_error === true || result.subtype !== 'success' || typeof result.result !== 'string') {
    return { ok: false, error: 'Claude 未返回成功终态。' }
  }
  return { ok: true, answer: result.result }
}

function parseCodex(stdout) {
  let answer = ''
  let completed = false
  let failed = false
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const event = JSON.parse(trimmed)
    if (event.type === 'turn.failed' || event.type === 'error') failed = true
    if (event.type === 'turn.completed' && !failed) completed = true
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
      answer = event.item.text
    }
  }
  if (failed || !completed || !answer.trim()) return { ok: false, error: 'Codex 未返回完整成功终态和回答。' }
  return { ok: true, answer }
}

function parseGemini(stdout) {
  const result = JSON.parse(stdout)
  if (result?.error) return { ok: false, error: String(result.error.message ?? result.error.type ?? 'Gemini CLI 返回错误。') }
  if (typeof result?.response !== 'string' || !result.response.trim()) return { ok: false, error: 'Gemini CLI 未返回 response 文本。' }
  return { ok: true, answer: result.response }
}

function parseAdapterOutput(format, stdout) {
  try {
    if (format === 'claude-json') return parseClaude(stdout)
    if (format === 'codex-jsonl') return parseCodex(stdout)
    if (format === 'gemini-json') return parseGemini(stdout)
  } catch {
    return { ok: false, error: '官方 CLI 输出无法解析。' }
  }
  return { ok: false, error: '该官方工具没有无界面输出解析器。' }
}

function captureProcess(spawnImpl, file, args, { cwd, env, stdin, timeoutMs, signal, onChunk, secret }) {
  return new Promise(resolve => {
    let child
    try {
      child = spawnImpl(file, args, {
        cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ ok: false, exitCode: null, stdout: '', stderr: '', spawnError: error?.code ?? error?.message ?? 'spawn-failed', timedOut: false, cancelled: false })
      return
    }
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let finished = false
    let stopReason = null
    let exitCode = null
    let spawnError = null
    const settle = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearTimeout(graceTimer)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        ok: !stopReason && !spawnError && exitCode === 0,
        exitCode, stdout, stderr, spawnError, timedOut: stopReason === 'timed-out',
        cancelled: stopReason === 'cancelled', outputLimit: stopReason === 'output-limit',
      })
    }
    let graceTimer
    const stop = reason => {
      if (finished || stopReason) return
      stopReason = reason
      try { child.kill('SIGTERM') } catch { /* already gone */ }
      graceTimer = setTimeout(settle, STOP_GRACE_MS)
      graceTimer.unref?.()
    }
    const onAbort = () => stop('cancelled')
    const timer = setTimeout(() => stop('timed-out'), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.stdout?.on('data', bytesIn => {
      if (finished || stopReason) return
      bytes += bytesIn.length
      const chunk = redact(stdoutDecoder.write(bytesIn), secret)
      stdout += chunk
      if (chunk && typeof onChunk === 'function') onChunk(chunk)
      if (bytes > MAX_OUTPUT_BYTES) stop('output-limit')
    })
    child.stderr?.on('data', bytesIn => {
      if (finished || stopReason) return
      bytes += bytesIn.length
      stderr += redact(stderrDecoder.write(bytesIn), secret)
      if (bytes > MAX_OUTPUT_BYTES) stop('output-limit')
    })
    if (typeof child.stdin?.on === 'function') child.stdin.on('error', () => { /* process may exit before reading */ })
    child.on('error', error => {
      spawnError = error?.code ?? error?.message ?? 'spawn-failed'
      settle()
    })
    child.on('close', code => {
      exitCode = code
      const restOut = redact(stdoutDecoder.end(), secret)
      const restErr = redact(stderrDecoder.end(), secret)
      if (restOut) {
        stdout += restOut
        if (typeof onChunk === 'function') onChunk(restOut)
      }
      stderr += restErr
      settle()
    })
    if (!stopReason) {
      try { if (typeof child.stdin?.end === 'function') child.stdin.end(stdin ?? '', 'utf8') } catch { /* stdin may already be closed */ }
    }
  })
}

async function useApi(apiFallback, { route, task, signal, reason, adapter, preference, exitCode = null, timedOut = false }) {
  const provider = String(route?.provider ?? '')
  const model = String(route?.model ?? '')
  if (typeof apiFallback !== 'function') {
    return {
      ok: false, provider, model, preference, channel: 'harness-llm', toolId: adapter?.id ?? null,
      answer: '', fallback: { reason }, timedOut, exitCode, error: reason,
    }
  }
  try {
    const api = await apiFallback({ route, task, signal, reason })
    const answer = String(api?.answer ?? '').slice(0, MAX_ANSWER_CHARS)
    return {
      ok: api?.ok === true && answer.trim().length > 0,
      provider, model, preference, channel: 'harness-llm', toolId: adapter?.id ?? null,
      answer, fallback: { reason }, timedOut, exitCode,
      error: api?.ok === true && answer.trim() ? undefined : (api?.error || reason),
    }
  } catch (error) {
    return {
      ok: false, provider, model, preference, channel: 'harness-llm', toolId: adapter?.id ?? null,
      answer: '', fallback: { reason }, timedOut, exitCode, error: String(error?.message ?? error),
    }
  }
}

function officialSuccess({ route, adapter, preference, answer, exitCode, version, credentialSource }) {
  return {
    ok: true,
    provider: route.provider,
    model: route.model,
    preference,
    channel: 'official-cli',
    toolId: adapter.id,
    toolLabel: adapter.label,
    answer: answer.slice(0, MAX_ANSWER_CHARS),
    truncated: answer.length > MAX_ANSWER_CHARS,
    fallback: null,
    timedOut: false,
    exitCode,
    version: version ?? null,
    credentialSource,
  }
}

/**
 * Run one assigned model task. `auto` and `official` try the vendor CLI first.
 * `api` skips the CLI. A missing tool or a failed process uses `apiFallback`.
 */
export async function executeAssignedTask({
  route, task, workspace, timeoutMs, signal, credentials = null, spawnImpl = spawn,
  apiFallback, runVerified = null, onChunk = null,
} = {}) {
  const prompt = checkedTask(task)
  const preference = executionPreference(route)
  const provider = String(route?.provider ?? '')
  const model = String(route?.model ?? '')
  if (!provider || !model) throw new TypeError('a configured provider and model are required')
  if (preference === 'api') {
    return useApi(apiFallback, { route, task: prompt, signal, reason: '该模型配置为只使用模型目录 API。', preference })
  }
  const adapter = adapterForProvider(provider)
  if (!adapter) {
    return useApi(apiFallback, {
      route, task: prompt, signal, preference,
      reason: '该供应商没有官方代理工具，已使用模型目录 API。',
    })
  }
  const cwd = await checkedWorkspace(workspace)
  const timeout = checkedTimeout(timeoutMs)
  const modelId = cliModelFor(route, adapter)
  if (typeof runVerified === 'function' && adapter.portableOnly !== true) {
    const verified = await runVerified({
      toolId: adapter.id, task: prompt, workspace: cwd, modelId, mode: 'read-only', signal, timeoutMs: timeout,
    })
    if (verified?.status === 'succeeded' && typeof verified.finalText === 'string' && verified.finalText.trim()) {
      const { secret, credentialSource } = childEnvironment(adapter, credentials)
      return officialSuccess({
        route, adapter, preference, answer: redact(verified.finalText, secret),
        exitCode: verified.exitCode ?? 0, version: null, credentialSource,
      })
    }
    if (verified && verified.status !== 'unsupported') {
      return useApi(apiFallback, {
        route, task: prompt, signal, adapter, preference, exitCode: verified.exitCode ?? null,
        timedOut: verified.status === 'timed-out',
        reason: verified.error || verified.reason || '官方 CLI 执行失败，已回退模型目录 API。',
      })
    }
  }
  if (!adapter.portable || !adapter.executable) {
    return useApi(apiFallback, {
      route, task: prompt, signal, adapter, preference,
      reason: `${adapter.label} 没有可用的无界面适配器，已使用模型目录 API。`,
    })
  }
  const { env, secret, credentialSource } = childEnvironment(adapter, credentials)
  const probe = await captureProcess(spawnImpl, adapter.executable, ['--version'], {
    cwd, env, stdin: '', timeoutMs: Math.min(PROBE_TIMEOUT_MS, timeout), signal, secret,
  })
  if (probe.spawnError || probe.cancelled || probe.timedOut || probe.exitCode !== 0) {
    const reason = probe.cancelled ? '执行已取消。'
      : probe.spawnError ? `${adapter.label} 未安装或无法启动，已回退模型目录 API。`
        : probe.timedOut ? `${adapter.label} 检测超时，已回退模型目录 API。`
          : `${adapter.label} 无法运行，已回退模型目录 API。`
    if (probe.cancelled) {
      return { ok: false, provider, model, preference, channel: 'official-cli', toolId: adapter.id, answer: '', fallback: null, timedOut: false, exitCode: null, error: reason, cancelled: true }
    }
    return useApi(apiFallback, { route, task: prompt, signal, adapter, preference, reason })
  }
  const args = adapter.buildArgs(modelId)
  const run = await captureProcess(spawnImpl, adapter.executable, args, {
    cwd, env, stdin: prompt, timeoutMs: timeout, signal, onChunk, secret,
  })
  if (run.cancelled) {
    return { ok: false, provider, model, preference, channel: 'official-cli', toolId: adapter.id, answer: '', fallback: null, timedOut: false, exitCode: run.exitCode, error: '执行已取消。', cancelled: true }
  }
  if (!run.ok) {
    return useApi(apiFallback, {
      route, task: prompt, signal, adapter, preference, exitCode: run.exitCode, timedOut: run.timedOut,
      reason: run.timedOut ? `${adapter.label} 执行超时，已回退模型目录 API。`
        : run.outputLimit ? `${adapter.label} 输出超过上限，已回退模型目录 API。`
          : `${adapter.label} 执行失败，已回退模型目录 API。`,
    })
  }
  const parsed = parseAdapterOutput(adapter.format, run.stdout)
  if (!parsed.ok) {
    return useApi(apiFallback, {
      route, task: prompt, signal, adapter, preference, exitCode: run.exitCode,
      reason: `${parsed.error} 已回退模型目录 API。`,
    })
  }
  const answer = redact(parsed.answer, secret)
  if (!answer.trim()) {
    return useApi(apiFallback, { route, task: prompt, signal, adapter, preference, exitCode: run.exitCode, reason: '官方 CLI 没有返回文本，已回退模型目录 API。' })
  }
  return officialSuccess({
    route, adapter, preference, answer, exitCode: run.exitCode,
    version: versionFromBanner(`${probe.stdout}\n${probe.stderr}`),
    credentialSource,
  })
}

function packagePrompt(task, item, completed) {
  const dependencies = (item.dependsOn ?? []).map(id => completed.find(result => result.id === id)).filter(Boolean)
  return [
    `总任务：\n${String(task).slice(0, 40_000)}`,
    `当前工作包：${item.name}`,
    item.objective ? `具体目标：\n${item.objective}` : '',
    dependencies.length
      ? `已完成的依赖结果：\n${dependencies.map(dep => `${dep.name}:\n${String(dep.answer ?? '').slice(0, 2_500)}`).join('\n\n')}`
      : '当前工作包无前置依赖。',
    '只完成当前工作包，并给出可汇总的结果。',
  ].filter(Boolean).join('\n\n')
}

/** One forced model receives the whole task. Routed plans keep their packages. */
export function assignmentPackages(plan, task) {
  if (plan?.routingBypassed) {
    const route = plan.directRoute
    if (!route?.provider || !route?.model) throw new TypeError('direct plan is missing its model')
    return [{
      id: 'direct',
      name: '指定模型',
      objective: String(task ?? ''),
      dependsOn: [],
      recommendedProvider: route.provider,
      recommendedModel: route.model,
    }]
  }
  const packages = plan?.team?.workPackages
  if (!Array.isArray(packages) || packages.length === 0) throw new TypeError('plan has no work packages')
  return packages.map(item => ({
    id: item.id,
    name: item.name,
    objective: item.objective ?? item.name,
    dependsOn: [...(item.dependsOn ?? [])],
    recommendedProvider: item.recommendedProvider,
    recommendedModel: item.recommendedModel,
  }))
}

/** Run packages in plan order and return one aggregate the router can keep. */
export async function executeAssignmentPlan({ plan, task, routes, ...options }) {
  const packages = assignmentPackages(plan, task)
  const routeList = Array.isArray(routes) ? routes : []
  const results = []
  for (const item of packages) {
    const unmet = (item.dependsOn ?? []).filter(id => results.find(result => result.id === id)?.ok !== true)
    if (unmet.length > 0) {
      results.push({
        id: item.id, name: item.name, ok: false, provider: item.recommendedProvider, model: item.recommendedModel,
        channel: 'harness-llm', answer: '', fallback: null, error: `依赖未完成：${unmet.join('、')}`,
      })
      continue
    }
    const route = routeList.find(candidate => candidate.provider === item.recommendedProvider && candidate.model === item.recommendedModel)
      ?? { provider: item.recommendedProvider, model: item.recommendedModel }
    const { credentialsFor, ...runOptions } = options
    const credentials = typeof credentialsFor === 'function' ? await credentialsFor(route) : runOptions.credentials ?? null
    const result = await executeAssignedTask({
      ...runOptions,
      credentials,
      route,
      task: plan?.routingBypassed ? checkedTask(task) : packagePrompt(task, item, results),
    })
    results.push({ id: item.id, name: item.name, ...result })
  }
  const aggregate = results.map(item => [
    `## ${item.name} (${item.provider}/${item.model}, ${item.channel === 'official-cli' ? '官方 CLI' : '模型目录 API'})`,
    item.answer || item.error || '',
  ].join('\n')).join('\n\n')
  const status = results.length > 0 && results.every(item => item.ok) ? 'completed'
    : results.some(item => item.ok) ? 'partial' : 'failed'
  return { status, packages: results, aggregate }
}
