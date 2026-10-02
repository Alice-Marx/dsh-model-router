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
import { isAbsolute, win32 } from 'node:path'
import { toolForProvider } from './official-tool-registry.mjs'
import { normalizeExecutionPreference } from './model-profiles.mjs'
import { BILLING_MODE_LABEL, billingPlan, detectQuotaExhaustion, vendorKey } from './subscription-billing.mjs'

export const MAX_TASK_BYTES = 64_000
const MAX_ANSWER_CHARS = 48_000
const MAX_OUTPUT_BYTES = 2_000_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const MAX_TIMEOUT_MS = 45 * 60_000
const PROBE_TIMEOUT_MS = 8_000
const STOP_GRACE_MS = 5_000
const CANCEL_GRACE_MS = 1_500
const IS_WINDOWS = process.platform === 'win32'

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

/**
 * Why a task text cannot be sent to a CLI or the catalog API, in Chinese, or
 * null. The limit is in UTF-8 bytes (CLI standard input), so the message also
 * gives the character count: about 21,000 Chinese or 64,000 ASCII characters.
 */
export function taskTextProblem(task) {
  if (typeof task !== 'string' || !task.trim()) return '任务内容为空，请先描述任务。'
  if (task.includes('\0')) return '任务内容包含不可见的空字符（\\0），请删除后重试。'
  const bytes = Buffer.byteLength(task, 'utf8')
  if (bytes > MAX_TASK_BYTES) {
    return `任务内容过长：${[...task].length} 个字符（UTF-8 ${bytes} 字节），上限 ${MAX_TASK_BYTES} 字节（约 ${Math.floor(MAX_TASK_BYTES / 3)} 个中文字符或 ${MAX_TASK_BYTES} 个英文字符）。请精简任务，或把长资料放进工作区文件并在任务中引用路径。`
  }
  return null
}

function checkedTask(task) {
  const problem = taskTextProblem(task)
  if (problem) throw new TypeError(problem)
  return task
}

/** Longest prefix of `value` within `maxBytes` UTF-8 bytes, never splitting a character. */
export function sliceUtf8(value, maxBytes) {
  const textValue = String(value ?? '')
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(textValue, 'utf8') <= maxBytes) return textValue
  let low = 0
  let high = textValue.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(textValue.slice(0, mid), 'utf8') <= maxBytes) low = mid
    else high = mid - 1
  }
  let end = low
  const code = textValue.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return textValue.slice(0, end)
}

const TRUNCATED = '…（已截断）'

function truncatedTo(value, maxBytes) {
  const textValue = String(value ?? '')
  if (Buffer.byteLength(textValue, 'utf8') <= maxBytes) return textValue
  return `${sliceUtf8(textValue, Math.max(0, maxBytes - Buffer.byteLength(TRUNCATED, 'utf8')))}${TRUNCATED}`
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

/** First non-empty diagnostic from a signed-runner result (an empty stderr must not hide stdout). */
export function verifiedDiagnostic(verified) {
  for (const value of [verified?.detail, verified?.stderrTail, verified?.stdoutTail]) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
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

/**
 * Usage already parsed from vendor events (no JSON text):
 * - 'grok-end': the `end`/`result` spend fields of `grok -p --output-format
 *   streaming-json` (input_tokens is uncached; total_cost_usd only when the
 *   server reported a complete cost, never with cost_is_partial);
 * - 'mimo-steps': the `step-finish` parts of `mimo run --format json`
 *   (tokens.input/output/cache.read/cache.write, cost in USD), summed;
 * - 'minimax-result': `exec.result.usage` of `mcode exec` (camelCase counts),
 *   ignored when usageSource is 'unavailable'.
 */
export function usageFromEvents(format, value) {
  if (format === 'grok-end') {
    const usage = value?.usage
    if (!usage || typeof usage !== 'object') return null
    const reported = Number(value.total_cost_usd)
    return {
      usage: {
        inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens),
        cacheReadTokens: count(usage.cache_read_input_tokens), cacheWriteTokens: count(usage.cache_creation_input_tokens),
      },
      ...(value.cost_is_partial !== true && Number.isFinite(reported) && reported > 0 ? { reportedCostUsd: reported } : {}),
    }
  }
  if (format === 'mimo-steps') {
    const parts = (Array.isArray(value) ? value : []).filter(part => part?.tokens && typeof part.tokens === 'object')
    if (!parts.length) return null
    const sum = pick => parts.reduce((total, part) => total + count(pick(part)), 0)
    const cost = parts.reduce((total, part) => total + (Number.isFinite(part.cost) && part.cost > 0 ? part.cost : 0), 0)
    return {
      usage: {
        inputTokens: sum(part => part.tokens.input), outputTokens: sum(part => part.tokens.output) + sum(part => part.tokens.reasoning),
        cacheReadTokens: sum(part => part.tokens.cache?.read), cacheWriteTokens: sum(part => part.tokens.cache?.write),
      },
      ...(cost > 0 ? { reportedCostUsd: Number(cost.toFixed(8)) } : {}),
    }
  }
  if (format === 'minimax-result') {
    if (!value?.usage || typeof value.usage !== 'object' || value.usageSource === 'unavailable') return null
    const usage = value.usage
    return { usage: {
      inputTokens: count(usage.inputTokens), outputTokens: count(usage.outputTokens) + count(usage.reasoningTokens),
      cacheReadTokens: count(usage.cacheReadTokens), cacheWriteTokens: count(usage.cacheWriteTokens),
    }, ...(value.usageIncomplete === true ? { usageIncomplete: true } : {}) }
  }
  return null
}

/**
 * Signal a CLI and every process it started. POSIX: the child leads its own
 * process group (spawned detached), so the group is signalled. Windows:
 * `taskkill /T /F` ends the process tree. Falls back to the child alone.
 */
export function killProcessTree(child, signal = 'SIGTERM', { tree = true, platform = process.platform, killImpl = process.kill.bind(process), spawnTaskkill = spawn } = {}) {
  const pid = tree && Number.isSafeInteger(child?.pid) && child.pid > 0 ? child.pid : null
  if (pid && platform === 'win32') {
    try {
      // Absolute System32 path, like the signed runner: a PATH entry cannot shadow taskkill.
      const taskkill = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
      const killer = spawnTaskkill(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' })
      killer?.on?.('error', () => { try { child.kill(signal) } catch { /* already gone */ } })
      return true
    } catch { /* fall through */ }
  } else if (pid) {
    try { killImpl(-pid, signal); return true } catch { /* not a group leader, or already gone */ }
  }
  try { child?.kill?.(signal) } catch { /* already gone */ }
  return false
}

function captureProcess(spawnImpl, file, args, { cwd, env, stdin, timeoutMs, signal, onChunk, secret, stopGraceMs = STOP_GRACE_MS }) {
  return new Promise(resolve => {
    let child
    // Only a real child process has a process group / tree to signal (tests inject fakes).
    const tree = spawnImpl === spawn
    try {
      // Own process group on POSIX so a stop also reaches the CLI's tool subprocesses.
      child = spawnImpl(file, args, {
        cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: tree && !IS_WINDOWS,
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
      killProcessTree(child, 'SIGTERM', { tree })
      // A CLI that ignores SIGTERM is force-killed so it cannot linger after the fallback.
      // A user cancel waits less than a timeout or output-limit stop.
      graceTimer = setTimeout(() => {
        killProcessTree(child, 'SIGKILL', { tree })
        settle()
      }, reason === 'cancelled' ? Math.min(stopGraceMs, CANCEL_GRACE_MS) : stopGraceMs)
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
    child.on('exit', () => {
      // The CLI is gone: stop whatever it left behind in its group after a stop.
      if (stopReason) killProcessTree(child, 'SIGKILL', { tree })
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

async function useApi(apiFallback, { route, task, signal, reason, adapter, preference, exitCode = null, timedOut = false, detail = '', raw = '', skipped = false, attempted = false }) {
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
    const api = await apiFallback({ route, task, signal, reason, detail, raw: String(raw ?? '').slice(-40_000), toolId: adapter?.id ?? null, attempted, timedOut, exitCode })
    // A billing-aware fallback can pause the step for the user's decision.
    if (api?.paused) {
      return {
        ok: false, provider, model, preference, channel: 'official-cli', toolId: adapter?.id ?? null, answer: '',
        fallback: null, timedOut, exitCode, paused: true,
        pause: { ...api.pause, ...(detail ? { detail } : {}), ...(fallback.loginRequired ? { loginRequired: true } : {}) },
        error: api.error,
      }
    }
    const answer = String(api?.answer ?? '').slice(0, MAX_ANSWER_CHARS)
    if (signal?.aborted && !(api?.ok === true && answer.trim())) {
      return {
        ok: false, provider, model, preference, channel: 'harness-llm', toolId: adapter?.id ?? null,
        answer: '', fallback, timedOut, exitCode, error: '执行已取消。', cancelled: true,
        ...(api?.usage ? { usage: api.usage } : {}),
      }
    }
    // A billing-aware fallback can refuse (subscription-only) or explain a switch.
    const note = api?.billingNote ?? null
    return {
      ok: api?.ok === true && answer.trim().length > 0,
      provider, model, preference, channel: api?.refused ? 'official-cli' : 'harness-llm', toolId: adapter?.id ?? null,
      answer, fallback: note?.reason ? { ...fallback, reason: note.reason } : api?.refused ? { ...fallback, reason: api.error } : fallback, timedOut, exitCode,
      ...(api?.usage ? { usage: api.usage } : {}),
      ...(note ? { billingSwitch: note } : {}),
      ...(api?.billing ? { billing: api.billing } : {}),
      error: api?.ok === true && answer.trim() ? undefined : (api?.error || reason),
    }
  } catch (error) {
    if (signal?.aborted) {
      return {
        ok: false, provider, model, preference, channel: 'harness-llm', toolId: adapter?.id ?? null,
        answer: '', fallback, timedOut, exitCode, error: '执行已取消。', cancelled: true,
      }
    }
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
        timedOut: verified.status === 'timed-out', attempted: true,
        reason: verified.error || verified.reason || '官方 CLI 执行失败，已回退模型目录 API。',
        detail: redactDiagnostic(verifiedDiagnostic(verified), childEnvironment(adapter, credentials, credentialMode).secret),
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
      route, task: prompt, signal, adapter, preference, exitCode: run.exitCode, timedOut: run.timedOut, attempted: true,
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
      route, task: prompt, signal, adapter, preference, exitCode: run.exitCode, attempted: true,
      reason: `${parsed.error} 已回退模型目录 API。`,
      detail: failureDetail(adapter.format, run.stdout, run.stderr, secret),
      raw: `${run.stdout.slice(-20_000)}\n${run.stderr.slice(-20_000)}`,
    })
  }
  const answer = redact(parsed.answer, secret)
  if (!answer.trim()) {
    return useApi(apiFallback, { route, task: prompt, signal, adapter, preference, exitCode: run.exitCode, attempted: true, reason: '官方 CLI 没有返回文本，已回退模型目录 API。' })
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

/** What a subscription-first step does after a failure that is not quota / rate-limit exhaustion. */
export const SUBSCRIPTION_FAILURE_ACTIONS = Object.freeze(['ask', 'api', 'fail'])
export const DEFAULT_SUBSCRIPTION_FAILURE_ACTION = 'ask'
export const SUBSCRIPTION_CHOICES = Object.freeze(['api', 'subscription', 'cancel'])

const failureAction = billing => SUBSCRIPTION_FAILURE_ACTIONS.includes(billing?.onFailure) ? billing.onFailure : DEFAULT_SUBSCRIPTION_FAILURE_ACTION

function pauseFor(summary, detail, extra = {}) {
  return {
    kind: 'subscription-failure',
    reason: `${summary} 这不是额度用尽或限流，已暂停此步骤等待你决定：改用 API 重试、重试订阅或取消。`,
    detail: String(detail ?? '').slice(0, 2_000),
    choices: [...SUBSCRIPTION_CHOICES],
    ...extra,
  }
}

const failureSummary = text => `${String(text ?? '').replace(/，?已(?:回退模型目录 API|改用 API Key)。?$/u, '').replace(/[。.]$/u, '') || '订阅调用失败'}。`

/**
 * Subscription-first execution of one route. `billing` supplies:
 * `quota` (tracker), `cooldownMinutes`, `extraPatterns`, `routes`,
 * `loginBillingFor(toolId)` ('subscription' | 'api-key' | 'logged-out' |
 * 'unknown'), and `now`. Without `billing` this is `executeAssignedTask`.
 *
 * - subscription-first: use the subscription (CLI account login without any
 *   API key, or a coding-plan key route). On quota / rate limit, mark it
 *   exhausted and retry the same step on the API-key route at once.
 * - A failure that is not exhaustion (timeout, crash, parse error, non-zero
 *   exit, auth error) follows `billing.onFailure`: 'ask' (default) pauses the
 *   step for the user, 'api' falls back to the API key, 'fail' stops.
 *   `billing.choice` 'api' is the user's confirmation to use the API key.
 * - subscription-only: never fall back to an API key.
 * - api-only: never use the subscription.
 */
export async function executeRouteWithBilling({ route, billing = null, apiFallback, ...options } = {}) {
  const plan = billingPlan(route, billing?.routes ?? [])
  // Every result names the billing mode it ran under, whichever branch produced it.
  const result = await routeWithBilling(plan, { route, billing, apiFallback, ...options })
  return { ...result, billingMode: result?.billingMode ?? plan.mode }
}

async function routeWithBilling(plan, { route, billing = null, apiFallback, ...options } = {}) {
  if (!billing) return executeAssignedTask({ ...options, route, apiFallback })
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
  if (billing.choice === 'api') {
    const reason = '已按你的确认改用 API Key 重试此步骤。'
    if (plan.mode === 'subscription-only') return refuse('按设置只用订阅，不能改用 API Key。')
    return viaApi(reason, { from: 'subscription', reason, kind: 'user-confirmed', until: null, detail: '' }, true)
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
    const action = failureAction(billing)
    if (action === 'fail') return refuse(`编程套餐路线调用失败：${detail || '未知错误'}。按设置不自动改用 API Key。`, { subscriptionRoute: { ...sub.route } })
    if (action === 'ask') {
      const pause = pauseFor(`编程套餐路线调用失败：${detail || '未知错误'}。`, detail)
      return refuse(pause.reason, { paused: true, pause, subscriptionRoute: { ...sub.route } })
    }
    return viaApi('编程套餐路线调用失败，已改用 API Key。', { from: 'subscription', reason: '编程套餐路线调用失败，已改用 API Key。', kind: 'error', until: null, detail })
  }

  // CLI account login. "Retry subscription" means the user signed in again: ignore a cached logged-out state.
  const retrySubscription = billing.choice === 'subscription'
  const login = retrySubscription ? 'unknown'
    : typeof billing.loginBillingFor === 'function' ? billing.loginBillingFor(sub.toolId) : 'unknown'
  if (login === 'api-key' || login === 'logged-out') {
    if (plan.mode === 'subscription-only') {
      return refuse(login === 'logged-out' ? `${label}：官方 CLI 未登录订阅账号。` : `${label}：官方 CLI 当前以 API Key 计费，没有订阅登录。`)
    }
    // The user has this subscription (the CLI failed authentication while running on it, or
    // the profile names a subscription billing mode): ask instead of silently paying by API key.
    const loginInfo = typeof billing.loginDetailFor === 'function' ? billing.loginDetailFor(sub.toolId) : null
    const action = failureAction(billing)
    if (login === 'logged-out' && action !== 'api' && (loginInfo?.source === 'runtime-auth' || subscriptionDeclared(route, billing.routes))) {
      const name = adapterForProvider(provider)?.label ?? sub.toolId
      const why = loginInfo?.source === 'runtime-auth'
        ? `${name} 的订阅登录已失效（上次运行报认证错误）`
        : `${name} 未登录订阅账号（该路线配置为“${label}”）`
      if (action === 'fail') return refuse(`${why}，按设置不自动改用 API Key。请在终端登录后点“重新体检”。`, { loginRequired: true })
      const pause = {
        kind: 'subscription-login',
        reason: `${why}，未自动改用 API Key，已暂停此步骤：请先在终端登录再选“重试订阅”，或选“改用 API 重试”、“取消”。`,
        detail: String(loginInfo?.detail ?? '').slice(0, 2_000),
        choices: [...SUBSCRIPTION_CHOICES],
        loginRequired: true,
      }
      return refuse(pause.reason, { paused: true, pause })
    }
    // No subscription login: the existing CLI-with-key / catalog API behaviour.
    return executeAssignedTask({ ...options, route, apiFallback })
  }
  if (retrySubscription) options = { ...options, skipOfficial: null }
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
    // The subscription really ran and failed for another reason: do not spend API money silently.
    const action = failureAction(billing)
    if (args?.attempted === true && action !== 'api') {
      const summary = failureSummary(args?.reason)
      if (action === 'fail') return { ok: false, refused: true, error: `${summary}按设置不自动改用 API Key。` }
      const pause = pauseFor(summary, args?.detail ?? '', { timedOut: args?.timedOut === true, exitCode: args?.exitCode ?? null })
      return { ok: false, paused: true, pause, error: pause.reason }
    }
    return apiFallback(args)
  }
  const result = await executeAssignedTask({ ...options, route, apiFallback: guarded, credentialMode: 'session-only' })
  return {
    ...result,
    billingMode: plan.mode,
    ...(result.ok && result.channel === 'official-cli' ? { billing: 'subscription' } : {}),
  }
}

/** The profile names a subscription billing mode for this route (not just the default). */
function subscriptionDeclared(route, routes = []) {
  const key = `${route?.provider}\u0000${route?.model}`
  const self = (Array.isArray(routes) ? routes : []).find(item => `${item.provider}\u0000${item.model}` === key) ?? route
  return self?.billing === 'subscription-first' || self?.billing === 'subscription-only'
}

/** API-key run of `route` on the catalog API, in executor result shape. */
function useApiRoute(apiFallback, { route, task, signal: abort, reason, skipped }) {
  return useApi(apiFallback, { route, task, signal: abort, reason, skipped, preference: executionPreference(route) })
}

const PROMPT_HEADROOM_BYTES = 512
const MIN_TASK_SHARE_BYTES = 8_000
const DEPENDENCY_ANSWER_BYTES = 7_500

/**
 * The prompt for one work package, always within MAX_TASK_BYTES: the objective
 * is capped first, dependency answers share what the task leaves (each at most
 * DEPENDENCY_ANSWER_BYTES, the remainder split evenly), and the total task is
 * truncated last. Truncated parts end with “（已截断）”.
 */
export function packagePrompt(task, item, completed, maxBytes = MAX_TASK_BYTES) {
  const dependencies = (item.dependsOn ?? []).map(id => completed.find(result => result.id === id)).filter(Boolean)
  const name = truncatedTo(item.name, 300)
  const closing = '只完成当前工作包，并给出可汇总的结果。'
  const budget = maxBytes - PROMPT_HEADROOM_BYTES
  const bytes = value => Buffer.byteLength(value, 'utf8')
  const objective = item.objective ? truncatedTo(item.objective, Math.floor(budget / 4)) : ''
  const fixed = bytes(`总任务：\n\n\n当前工作包：${name}\n\n${objective ? `具体目标：\n${objective}\n\n` : ''}已完成的依赖结果：\n\n\n${closing}`)
    + dependencies.reduce((sum, dep) => sum + bytes(`${truncatedTo(dep.name, 200)}:\n\n\n`), 0)
  const taskBytes = bytes(String(task))
  const free = Math.max(0, budget - fixed)
  // Dependencies get what they need up to their cap, but never squeeze the task below its share.
  const wantDeps = dependencies.reduce((sum, dep) => sum + Math.min(bytes(String(dep.answer ?? '')), DEPENDENCY_ANSWER_BYTES), 0)
  const depBudget = Math.max(0, Math.min(wantDeps, free - Math.min(taskBytes, MIN_TASK_SHARE_BYTES)))
  let remaining = depBudget
  const depTexts = dependencies.map((dep, index) => {
    const share = Math.floor(remaining / (dependencies.length - index))
    const answer = truncatedTo(String(dep.answer ?? ''), Math.min(DEPENDENCY_ANSWER_BYTES, share))
    remaining -= bytes(answer)
    return `${truncatedTo(dep.name, 200)}:\n${answer}`
  })
  const taskText = truncatedTo(String(task), Math.max(0, free - (depBudget - remaining)))
  const prompt = [
    `总任务：\n${taskText}`,
    `当前工作包：${name}`,
    objective ? `具体目标：\n${objective}` : '',
    dependencies.length ? `已完成的依赖结果：\n${depTexts.join('\n\n')}` : '当前工作包无前置依赖。',
    closing,
  ].filter(Boolean).join('\n\n')
  return bytes(prompt) <= maxBytes ? prompt : sliceUtf8(prompt, maxBytes)
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
    : results.some(item => item.paused) ? 'paused'
      : results.some(item => item.cancelled) ? 'cancelled'
        : results.some(item => item.ok) ? 'partial' : 'failed'
  return { status, packages: results, aggregate }
}

/**
 * Run `targets` (all packages when null) in plan order. Packages outside the
 * target set keep their previous results, so a single failed step can be
 * retried without re-running finished work.
 */
async function runPackages({ packages, task, routingBypassed, routes, previous = [], targets = null, overrides = {}, choices = {}, options }) {
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
    if (runOptions.signal?.aborted) {
      // Cancelled: later packages are not started (no CLI process, no API spend).
      const cancelled = { id: item.id, name: item.name, ok: false, provider, model, channel: 'harness-llm', answer: '', fallback: null, cancelled: true, notStarted: true, error: '执行已取消，此步骤未开始。' }
      results.push(cancelled)
      ranIds.push(item.id)
      if (typeof onPackage === 'function') await onPackage(cancelled)
      continue
    }
    const unmet = (item.dependsOn ?? []).filter(id => results.find(result => result.id === id)?.ok !== true)
    if (unmet.length > 0) {
      // Waiting behind a paused step (the user decides), or blocked by a failure.
      const waitingOn = unmet.filter(id => { const dep = results.find(result => result.id === id); return dep?.paused || dep?.waiting })
      const blocked = {
        id: item.id, name: item.name, ok: false, provider, model,
        channel: 'harness-llm', answer: '', fallback: null, blocked: true,
        ...(waitingOn.length ? { waiting: true } : {}),
        error: waitingOn.length ? `等待上游步骤确认：${waitingOn.join('、')}` : `依赖未完成：${unmet.join('、')}`,
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
      billing: billing ? { ...billing, routes: billing.routes ?? routeList, ...(choices[item.id] ? { choice: choices[item.id] } : {}) } : null,
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
  task, packages, previous, packageId, routingBypassed = false, routes, override = null, cascade = true, subscriptionChoice = null, ...options
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
  const choices = subscriptionChoice === 'api' || subscriptionChoice === 'subscription' ? { [packageId]: subscriptionChoice } : {}
  return runPackages({ packages: list, task, routingBypassed, routes, previous: prior, targets, overrides, choices, options })
}
