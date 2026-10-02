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
import { BILLING_MODE_LABEL, billingPlan, detectQuotaExhaustion, vendorKey } from './subscription-billing.mjs'

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
        // `=` keeps these variadic flags from consuming the positional instruction.
        '--tools=Read,Glob,Grep', '--disallowedTools=mcp__*',
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

/** Variables that switch a CLI from its account login to API-key billing. */
const API_KEY_VARIABLES = Object.freeze({
  'claude-code': ['ANTHROPIC_API_KEY'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
})

/**
 * `credentialMode`: `default` injects a configured or inherited key;
 * `session-only` strips every API-key variable so the CLI uses its own
 * subscription login; `api-only` is `default` (the caller checks a key exists).
 */
function childEnvironment(adapter, credentials, credentialMode = 'default') {
  const env = {}
  const sessionOnly = credentialMode === 'session-only'
  const stripped = new Set(sessionOnly ? [...(API_KEY_VARIABLES[adapter?.id] ?? []), adapter?.apiKeyEnv].filter(Boolean) : [])
  for (const key of BASE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  for (const key of adapter?.sessionEnv ?? []) {
    if (process.env[key] !== undefined && !stripped.has(key)) env[key] = process.env[key]
  }
  if (sessionOnly) return { env, secret: '', credentialSource: 'cli-session' }
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
    // Top-level `error` events include transient "Reconnecting... n/5" notices; the turn event decides.
    if (event.type === 'turn.failed') failed = true
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

const DIAGNOSTIC_CHARS = 400

/** Shorten and scrub a CLI diagnostic before it reaches the user or the run ledger. */
export function redactDiagnostic(value, secret = '') {
  const scrubbed = redact(String(value ?? ''), secret)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)(["'\s:=]+)[^\s"',}]{6,}/gi, '$1$2[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  return scrubbed.length > DIAGNOSTIC_CHARS ? `${scrubbed.slice(0, DIAGNOSTIC_CHARS)}…` : scrubbed
}

function jsonLines(stdout) {
  const events = []
  for (const line of String(stdout ?? '').split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try { events.push(JSON.parse(trimmed)) } catch { /* not a protocol line */ }
  }
  return events
}

/**
 * The vendor's own failure text: Claude's JSON `result`, Codex's
 * `turn.failed.error.message`, Gemini's `error.message`, else a stderr tail.
 */
export function failureDetail(format, stdout = '', stderr = '', secret = '') {
  let detail = ''
  try {
    if (format === 'claude-json') {
      const result = JSON.parse(stdout)
      if (typeof result?.result === 'string' && result.result.trim()) detail = result.result
      else if (typeof result?.error === 'string') detail = result.error
    } else if (format === 'codex-jsonl') {
      let failed = ''
      let lastError = ''
      for (const event of jsonLines(stdout)) {
        if (event.type === 'turn.failed' && typeof event.error?.message === 'string') failed = event.error.message
        if (event.type === 'error' && typeof event.message === 'string' && !/^Reconnecting\.\.\./u.test(event.message)) lastError = event.message
      }
      detail = failed || lastError
    } else if (format === 'gemini-json') {
      const result = JSON.parse(stdout)
      detail = String(result?.error?.message ?? '')
    }
  } catch { /* fall through to stderr */ }
  if (!detail.trim()) {
    detail = String(stderr ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean).slice(-3).join(' | ')
  }
  return redactDiagnostic(detail, secret)
}

/** True when a diagnostic says the CLI has no usable account session or key. */
export function looksLikeLoginFailure(detail) {
  return /not logged in|please run \/login|log ?in required|unauthori[sz]ed|\b401\b|missing bearer|invalid api key|authentication (?:failed|required)/i.test(String(detail ?? ''))
}

const count = value => Number.isFinite(value) && value >= 0 ? Math.round(value) : 0

/** Token usage reported by the CLI, in the Harness TokenUsage shape (disjoint cache counts). */
export function usageFromOutput(format, stdout = '') {
  try {
    if (format === 'claude-json') {
      const result = JSON.parse(stdout)
      const usage = result?.usage
      if (!usage || typeof usage !== 'object') return null
      const reported = Number(result.total_cost_usd)
      return {
        usage: {
          inputTokens: count(usage.input_tokens),
          outputTokens: count(usage.output_tokens),
          cacheReadTokens: count(usage.cache_read_input_tokens),
          cacheWriteTokens: count(usage.cache_creation_input_tokens),
        },
        ...(Number.isFinite(reported) && reported > 0 ? { reportedCostUsd: reported } : {}),
      }
    }
    if (format === 'codex-jsonl') {
      const completed = jsonLines(stdout).filter(event => event.type === 'turn.completed' && event.usage).at(-1)
      if (!completed) return null
      const cached = count(completed.usage.cached_input_tokens)
      return { usage: {
        inputTokens: Math.max(0, count(completed.usage.input_tokens) - cached),
        outputTokens: count(completed.usage.output_tokens),
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      } }
    }
    if (format === 'gemini-json') {
      const models = JSON.parse(stdout)?.stats?.models
      if (!models || typeof models !== 'object') return null
      let input = 0
      let output = 0
      let cached = 0
      for (const entry of Object.values(models)) {
        input += count(entry?.tokens?.prompt)
        output += count(entry?.tokens?.candidates)
        cached += count(entry?.tokens?.cached)
      }
      return { usage: { inputTokens: Math.max(0, input - cached), outputTokens: output, cacheReadTokens: cached, cacheWriteTokens: 0 } }
    }
  } catch { /* usage is optional */ }
  return null
}

function captureProcess(spawnImpl, file, args, { cwd, env, stdin, timeoutMs, signal, onChunk, secret, stopGraceMs = STOP_GRACE_MS }) {
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
      // A CLI that ignores SIGTERM is force-killed so it cannot linger after the fallback.
      graceTimer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        settle()
      }, stopGraceMs)
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

async function useApi(apiFallback, { route, task, signal, reason, adapter, preference, exitCode = null, timedOut = false, detail = '', raw = '', skipped = false }) {
  const provider = String(route?.provider ?? '')
  const model = String(route?.model ?? '')
  const fallback = {
    reason,
    ...(detail ? { error: detail } : {}),
    ...(detail && looksLikeLoginFailure(detail) ? { loginRequired: true } : {}),
    ...(skipped ? { skipped: true } : {}),
  }
  if (typeof apiFallback !== 'function') {
    return {
      ok: false, provider, model, preference, channel: 'harness-llm', toolId: adapter?.id ?? null,
      answer: '', fallback, timedOut, exitCode, error: reason,
    }
  }
  try {
    const api = await apiFallback({ route, task, signal, reason, detail, raw: String(raw ?? '').slice(-40_000), toolId: adapter?.id ?? null })
    const answer = String(api?.answer ?? '').slice(0, MAX_ANSWER_CHARS)
    // A billing-aware fallback can refuse (subscription-only) or explain a switch.
    const note = api?.billingNote ?? null
    return {
      ok: api?.ok === true && answer.trim().length > 0,
      provider, model, preference, channel: api?.refused ? 'official-cli' : 'harness-llm', toolId: adapter?.id ?? null,
      answer, fallback: note?.reason ? { ...fallback, reason: note.reason } : fallback, timedOut, exitCode,
      ...(api?.usage ? { usage: api.usage } : {}),
      ...(note ? { billingSwitch: note } : {}),
      ...(api?.billing ? { billing: api.billing } : {}),
      error: api?.ok === true && answer.trim() ? undefined : (api?.error || reason),
    }
  } catch (error) {
    return {
      ok: false, provider, model, preference, channel: 'harness-llm', toolId: adapter?.id ?? null,
      answer: '', fallback, timedOut, exitCode, error: String(error?.message ?? error),
    }
  }
}

function officialSuccess({ route, adapter, preference, answer, exitCode, version, credentialSource, usage = null }) {
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
    ...(usage?.usage ? { usage: usage.usage } : {}),
    ...(usage?.reportedCostUsd ? { reportedCostUsd: usage.reportedCostUsd } : {}),
  }
}

/**
 * Run one assigned model task. `auto` and `official` try the vendor CLI first.
 * `api` skips the CLI. A missing tool or a failed process uses `apiFallback`.
 */
export async function executeAssignedTask({
  route, task, workspace, timeoutMs, signal, credentials = null, spawnImpl = spawn,
  apiFallback, runVerified = null, onChunk = null, skipOfficial = null, stopGraceMs, credentialMode = 'default',
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
  if (credentialMode === 'api-only' && !childEnvironment(adapter, credentials).secret) {
    return useApi(apiFallback, {
      route, task: prompt, signal, adapter, preference, skipped: true,
      reason: `按设置只用 API Key：${adapter.label} 没有可注入的 API Key，已使用模型目录 API，未使用订阅登录。`,
    })
  }
  // A cached health check (for example "not logged in") skips the CLI at once.
  const skipReason = typeof skipOfficial === 'function'
    ? skipOfficial({ toolId: adapter.id, hasApiKey: Boolean(childEnvironment(adapter, credentials, credentialMode).secret) })
    : null
  if (typeof skipReason === 'string' && skipReason) {
    return useApi(apiFallback, { route, task: prompt, signal, adapter, preference, reason: skipReason, skipped: true })
  }
  const cwd = await checkedWorkspace(workspace)
  const timeout = checkedTimeout(timeoutMs)
  const modelId = cliModelFor(route, adapter)
  if (typeof runVerified === 'function' && adapter.portableOnly !== true) {
    const verified = await runVerified({
      toolId: adapter.id, task: prompt, workspace: cwd, modelId, mode: 'read-only', signal, timeoutMs: timeout,
      ...(credentialMode === 'session-only' ? { sessionOnly: true } : {}),
    })
    if (verified?.status === 'succeeded' && typeof verified.finalText === 'string' && verified.finalText.trim()) {
      const { secret, credentialSource } = childEnvironment(adapter, credentials, credentialMode)
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
        detail: redactDiagnostic(verified.detail ?? verified.stderrTail ?? verified.stdoutTail ?? '', childEnvironment(adapter, credentials, credentialMode).secret),
        raw: [verified.error, verified.reason, verified.detail, verified.stderrTail, verified.stdoutTail].filter(item => typeof item === 'string').join('\n'),
      })
    }
  }
  if (!adapter.portable || !adapter.executable) {
    return useApi(apiFallback, {
      route, task: prompt, signal, adapter, preference,
      reason: `${adapter.label} 没有可用的无界面适配器，已使用模型目录 API。`,
    })
  }
  const { env, secret, credentialSource } = childEnvironment(adapter, credentials, credentialMode)
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
    ...(Number.isSafeInteger(stopGraceMs) && stopGraceMs >= 10 && stopGraceMs <= STOP_GRACE_MS ? { stopGraceMs } : {}),
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
      detail: run.timedOut ? '' : failureDetail(adapter.format, run.stdout, run.stderr, secret),
      raw: `${run.stdout.slice(-20_000)}\n${run.stderr.slice(-20_000)}`,
    })
  }
  const parsed = parseAdapterOutput(adapter.format, run.stdout)
  if (!parsed.ok) {
    return useApi(apiFallback, {
      route, task: prompt, signal, adapter, preference, exitCode: run.exitCode,
      reason: `${parsed.error} 已回退模型目录 API。`,
      detail: failureDetail(adapter.format, run.stdout, run.stderr, secret),
      raw: `${run.stdout.slice(-20_000)}\n${run.stderr.slice(-20_000)}`,
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
    usage: usageFromOutput(adapter.format, run.stdout),
  })
}

const formatReset = at => {
  if (!Number.isFinite(at)) return ''
  const date = new Date(at)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}-${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function switchReason(info, until) {
  const reset = until ? `（预计 ${formatReset(until)} 恢复）` : ''
  return info?.kind === 'rate-limit' ? `订阅通道触发限流${reset}，已切换 API Key。` : `订阅额度已用尽${reset}，已切换 API Key。`
}

/**
 * Subscription-first execution of one route. `billing` supplies:
 * `quota` (tracker), `cooldownMinutes`, `extraPatterns`, `routes`,
 * `loginBillingFor(toolId)` ('subscription' | 'api-key' | 'logged-out' |
 * 'unknown'), and `now`. Without `billing` this is `executeAssignedTask`.
 *
 * - subscription-first: use the subscription (CLI account login without any
 *   API key, or a coding-plan key route). On quota / rate limit, mark it
 *   exhausted and retry the same step on the API-key route at once.
 * - subscription-only: never fall back to an API key.
 * - api-only: never use the subscription.
 */
export async function executeRouteWithBilling({ route, billing = null, apiFallback, ...options } = {}) {
  if (!billing) return executeAssignedTask({ ...options, route, apiFallback })
  const plan = billingPlan(route, billing.routes ?? [])
  const now = typeof billing.now === 'function' ? billing.now : Date.now
  const sub = plan.subscription
  const apiRoute = plan.apiRoute
  const label = BILLING_MODE_LABEL[plan.mode]
  const provider = String(route?.provider ?? '')
  const model = String(route?.model ?? '')
  const base = { provider, model, billingMode: plan.mode }
  const refuse = (error, extra = {}) => ({
    ok: false, ...base, preference: executionPreference(route), channel: sub?.kind === 'plan-key' ? 'harness-llm' : 'official-cli',
    toolId: sub?.toolId ?? null, answer: '', fallback: null, error, ...extra,
  })
  const viaApi = async (reason, note, skipped = false) => {
    if (!apiRoute || (sub?.kind === 'plan-key' && apiRoute.provider === sub.route.provider && apiRoute.model === sub.route.model)) {
      return refuse(`${reason.replace(/，?已切换 API Key。$/u, '。')}没有配置可回退的 API 路线（apiRoute）。`, note ? { billingSwitch: { ...note, to: null } } : {})
    }
    const result = await useApiRoute(apiFallback, { route: apiRoute, task: options.task, signal: options.signal, reason, skipped })
    // Keep the API route that actually ran (pricing); the plan route is recorded separately.
    return {
      ...base, ...result, billingMode: plan.mode, billing: 'api',
      ...(note ? { billingSwitch: { ...note, to: 'api' } } : {}),
      ...(sub?.kind === 'plan-key' ? { subscriptionRoute: { ...sub.route } } : {}),
    }
  }
  const classify = (text, vendor) => detectQuotaExhaustion(text, { vendor, provider: sub?.kind === 'plan-key' ? sub.route.provider : provider, extraPatterns: billing.extraPatterns ?? {}, now: now() })
  const markExhausted = (info, detail) => billing.quota?.mark?.(sub.key, { ...info, detail }, { cooldownMinutes: billing.cooldownMinutes }) ?? null

  if (!sub) {
    if (plan.mode === 'subscription-only') return refuse(`${label}：该路线没有可用的订阅（CLI 账号登录或编程套餐路线）。`)
    return executeAssignedTask({ ...options, route, apiFallback })
  }
  if (plan.mode === 'api-only') {
    if (sub.kind === 'plan-key') return viaApi('按设置只用 API Key，未使用编程套餐。', null, true)
    return executeAssignedTask({ ...options, route, apiFallback, credentialMode: 'api-only' })
  }
  const exhausted = billing.quota?.status?.(sub.key) ?? null
  if (exhausted) {
    const reason = `订阅额度已用尽（预计 ${formatReset(exhausted.until)} 恢复），已直接使用 API Key。`
    const note = { from: 'subscription', reason, kind: exhausted.kind, until: exhausted.until, detail: exhausted.detail ?? '', skippedSubscription: true }
    if (plan.mode === 'subscription-only') return refuse(`订阅额度已用尽（预计 ${formatReset(exhausted.until)} 恢复）；按设置只用订阅，未使用 API Key。`, { billingSwitch: { ...note, to: null } })
    return viaApi(reason, note, true)
  }

  if (sub.kind === 'plan-key') {
    let attempt
    try { attempt = await apiFallback({ route: sub.route, task: options.task, signal: options.signal, reason: '编程套餐（订阅）', subscription: true }) }
    catch (error) { attempt = { ok: false, error: String(error?.message ?? error) } }
    if (attempt?.ok === true && String(attempt.answer ?? '').trim()) {
      return {
        ok: true, ...base, preference: executionPreference(route), channel: 'harness-llm', toolId: null,
        answer: String(attempt.answer).slice(0, MAX_ANSWER_CHARS), fallback: null,
        billing: 'subscription', subscriptionRoute: { ...sub.route },
        ...(attempt.usage ? { usage: attempt.usage } : {}),
      }
    }
    const detail = redactDiagnostic(attempt?.error ?? '')
    const info = classify(String(attempt?.error ?? ''), vendorKey({ provider: sub.route.provider }))
    if (options.signal?.aborted) return refuse('执行已取消。', { cancelled: true })
    if (info) {
      const entry = markExhausted(info, detail)
      const reason = switchReason(info, entry?.until)
      const note = { from: 'subscription', reason, kind: info.kind, until: entry?.until ?? null, detail, source: info.source }
      if (plan.mode === 'subscription-only') return refuse(reason.replace('已切换 API Key。', '按设置只用订阅，未使用 API Key。'), { billingSwitch: { ...note, to: null }, subscriptionRoute: { ...sub.route } })
      return viaApi(reason, note)
    }
    if (plan.mode === 'subscription-only') return refuse(`编程套餐路线调用失败：${detail || '未知错误'}`, { subscriptionRoute: { ...sub.route } })
    return viaApi('编程套餐路线调用失败，已改用 API Key。', { from: 'subscription', reason: '编程套餐路线调用失败，已改用 API Key。', kind: 'error', until: null, detail })
  }

  // CLI account login.
  const login = typeof billing.loginBillingFor === 'function' ? billing.loginBillingFor(sub.toolId) : 'unknown'
  if (login === 'api-key' || login === 'logged-out') {
    if (plan.mode === 'subscription-only') {
      return refuse(login === 'logged-out' ? `${label}：官方 CLI 未登录订阅账号。` : `${label}：官方 CLI 当前以 API Key 计费，没有订阅登录。`)
    }
    // No subscription login: the existing CLI-with-key / catalog API behaviour.
    return executeAssignedTask({ ...options, route, apiFallback })
  }
  const guarded = async args => {
    const vendor = vendorKey({ toolId: args?.toolId ?? sub.toolId })
    const info = classify(`${args?.detail ?? ''}
${args?.raw ?? ''}`, vendor)
    if (info) {
      const entry = markExhausted(info, args?.detail ?? '')
      const reason = switchReason(info, entry?.until)
      const note = { from: 'subscription', reason, kind: info.kind, until: entry?.until ?? null, detail: args?.detail ?? '', source: info.source }
      if (plan.mode === 'subscription-only') {
        return { ok: false, refused: true, error: reason.replace('已切换 API Key。', '按设置只用订阅，未使用 API Key。'), billingNote: { ...note, to: null } }
      }
      const api = await apiFallback({ ...args, route: apiRoute ?? args.route })
      return { ...api, billing: 'api', billingNote: { ...note, to: 'api' } }
    }
    if (plan.mode === 'subscription-only') return { ok: false, refused: true, error: `${args?.reason ?? '官方 CLI 执行失败。'}（按设置只用订阅，未回退 API）` }
    return apiFallback(args)
  }
  const result = await executeAssignedTask({ ...options, route, apiFallback: guarded, credentialMode: 'session-only' })
  return {
    ...result,
    billingMode: plan.mode,
    ...(result.ok && result.channel === 'official-cli' ? { billing: 'subscription' } : {}),
  }
}

/** API-key run of `route` on the catalog API, in executor result shape. */
function useApiRoute(apiFallback, { route, task, signal: abort, reason, skipped }) {
  return useApi(apiFallback, { route, task, signal: abort, reason, skipped, preference: executionPreference(route) })
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

function aggregateOf(results) {
  const aggregate = results.map(item => [
    `## ${item.name} (${item.provider}/${item.model}, ${item.channel === 'official-cli' ? '官方 CLI' : '模型目录 API'})`,
    item.answer || item.error || '',
  ].join('\n')).join('\n\n')
  const status = results.length > 0 && results.every(item => item.ok) ? 'completed'
    : results.some(item => item.ok) ? 'partial' : 'failed'
  return { status, packages: results, aggregate }
}

/**
 * Run `targets` (all packages when null) in plan order. Packages outside the
 * target set keep their previous results, so a single failed step can be
 * retried without re-running finished work.
 */
async function runPackages({ packages, task, routingBypassed, routes, previous = [], targets = null, overrides = {}, options }) {
  const routeList = Array.isArray(routes) ? routes : []
  const { credentialsFor, onPackage, billing, ...runOptions } = options
  const results = []
  const ranIds = []
  for (const item of packages) {
    const kept = previous.find(result => result.id === item.id)
    if (targets && !targets.has(item.id) && kept) {
      results.push(kept)
      continue
    }
    const override = overrides[item.id]
    const provider = override?.provider ?? item.recommendedProvider
    const model = override?.model ?? item.recommendedModel
    const unmet = (item.dependsOn ?? []).filter(id => results.find(result => result.id === id)?.ok !== true)
    if (unmet.length > 0) {
      const blocked = {
        id: item.id, name: item.name, ok: false, provider, model,
        channel: 'harness-llm', answer: '', fallback: null, blocked: true, error: `依赖未完成：${unmet.join('、')}`,
      }
      results.push(blocked)
      ranIds.push(item.id)
      if (typeof onPackage === 'function') await onPackage(blocked)
      continue
    }
    const route = routeList.find(candidate => candidate.provider === provider && candidate.model === model)
      ?? { provider, model }
    const credentials = typeof credentialsFor === 'function' ? await credentialsFor(route) : runOptions.credentials ?? null
    const result = await executeRouteWithBilling({
      ...runOptions,
      billing: billing ? { ...billing, routes: billing.routes ?? routeList } : null,
      credentials,
      route,
      task: routingBypassed ? checkedTask(task) : packagePrompt(task, item, results),
    })
    const entry = { id: item.id, name: item.name, ...(override ? { reassigned: true } : {}), ...result }
    results.push(entry)
    ranIds.push(item.id)
    if (typeof onPackage === 'function') await onPackage(entry)
  }
  return { ...aggregateOf(results), ranIds }
}

/** Run packages in plan order and return one aggregate the router can keep. */
export async function executeAssignmentPlan({ plan, task, routes, ...options }) {
  return runPackages({
    packages: assignmentPackages(plan, task),
    task,
    routingBypassed: plan?.routingBypassed === true,
    routes,
    options,
  })
}

/** Package ids downstream of `packageId`, in plan order. */
export function downstreamPackageIds(packages, packageId) {
  const found = new Set([packageId])
  for (const item of packages) {
    if ((item.dependsOn ?? []).some(id => found.has(id))) found.add(item.id)
  }
  found.delete(packageId)
  return packages.map(item => item.id).filter(id => found.has(id))
}

/**
 * Retry one stored package, optionally on a manually chosen route, and then
 * any downstream package that had not succeeded. Finished packages keep their
 * stored answers, which also feed the retried package's dependency context.
 */
export async function rerunAssignmentPackage({
  task, packages, previous, packageId, routingBypassed = false, routes, override = null, cascade = true, ...options
}) {
  const list = Array.isArray(packages) ? packages : []
  if (!list.some(item => item.id === packageId)) throw new TypeError(`unknown work package ${packageId}`)
  const prior = Array.isArray(previous) ? previous : []
  const targets = new Set([packageId])
  if (cascade) {
    for (const id of downstreamPackageIds(list, packageId)) {
      if (prior.find(result => result.id === id)?.ok !== true) targets.add(id)
    }
  }
  const overrides = override?.provider && override?.model ? { [packageId]: { provider: override.provider, model: override.model } } : {}
  return runPackages({ packages: list, task, routingBypassed, routes, previous: prior, targets, overrides, options })
}
