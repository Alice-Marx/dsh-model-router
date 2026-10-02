/**
 * Onboarding health check for the fixed official tool registry.
 *
 * For every registry tool: installed?, version at least the pinned registry
 * version?, and logged in? Login checks use only fixed, read-only status
 * commands (`claude auth status --json`, `codex login status`) or the
 * presence of a credential file / environment variable name. No credential
 * value is read or returned. Results are cached so routing can skip a tool
 * that is known to be logged out instead of waiting for its CLI to fail.
 */
import { OFFICIAL_TOOLS, getOfficialTool } from './official-tool-registry.mjs'

export const LOGIN_CHECK_TIMEOUT_MS = 5_000
export const HEALTH_CACHE_MS = 10 * 60_000

/** How to log in. Commands are display-only; the plugin never starts an interactive login. */
export const LOGIN_GUIDES = Object.freeze({
  'claude-code': Object.freeze({ command: 'claude auth login', steps: '在终端运行 claude auth login（或启动 claude 后输入 /login），按浏览器提示登录 Anthropic 账号。也可以在 Harness 模型页为 Anthropic 配置 API Key，插件只把它传给该 CLI 进程。' }),
  codex: Object.freeze({ command: 'codex login', steps: '在终端运行 codex login，按浏览器提示登录 ChatGPT 账号；或设置 OPENAI_API_KEY 后运行 codex login --with-api-key。' }),
  gemini: Object.freeze({ command: 'gemini', steps: '在终端运行 gemini，选择 “Login with Google” 完成登录；或在环境变量中设置 GEMINI_API_KEY。' }),
  'kimi-code': Object.freeze({ command: 'kimi', steps: '在终端运行 kimi，按官方提示（如 /login）登录 Moonshot 账号。' }),
  'minimax-code': Object.freeze({ command: 'mcode', steps: '在终端运行 mcode，按官方提示登录 MiniMax 账号或配置 API Key。' }),
  'mimo-code': Object.freeze({ command: 'mimo', steps: '在终端运行 mimo，按官方提示登录小米 MiMo 账号。' }),
  'grok-build': Object.freeze({ command: 'grok', steps: '在终端运行 grok，按官方提示登录 xAI 账号。' }),
  zcode: Object.freeze({ command: null, steps: '打开 ZCode 桌面版并登录智谱账号。' }),
})

/** Environment variable names whose presence means a CLI can authenticate without a session. */
const KEY_ENV = Object.freeze({
  'claude-code': ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
})

/** Variables that make the CLI bill an API account rather than a subscription login. */
const API_KEY_ENV = Object.freeze({
  'claude-code': ['ANTHROPIC_API_KEY'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'kimi-code': ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  'minimax-code': ['MINIMAX_API_KEY'],
  'mimo-code': ['MIMO_API_KEY'],
  'grok-build': ['XAI_API_KEY'],
  zcode: ['ZAI_API_KEY'],
})

/** True when an API-key variable for this CLI is set in `env` (names only, values are never read out). */
export function apiKeyEnvPresent(toolId, env = process.env) {
  return (API_KEY_ENV[toolId] ?? []).some(name => typeof env?.[name] === 'string' && env[name].trim() !== '')
}

export function compareVersions(left, right) {
  const parts = value => String(value ?? '').split(/[-+]/u)[0].split('.').map(item => Number.parseInt(item, 10) || 0)
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export function versionStatus(tool, version) {
  if (!version || !tool?.version) return 'unknown'
  return compareVersions(version, tool.version) >= 0 ? 'ok' : 'older'
}

function guide(toolId) {
  return LOGIN_GUIDES[toolId] ?? { command: null, steps: '请按厂商官方文档完成登录。' }
}

/**
 * Login state for one installed tool: 'logged-in', 'logged-out', or 'unknown'.
 * `runner(executable, args, { timeoutMs })` resolves { ok, code, stdout, stderr, timedOut }.
 */
export async function checkLogin(toolId, { runner, env = process.env, exists = async () => false, home = '' } = {}) {
  const keyNames = (KEY_ENV[toolId] ?? []).filter(name => typeof env?.[name] === 'string' && env[name].trim())
  const viaKey = keyNames.length > 0 ? { state: 'logged-in', detail: `检测到环境变量 ${keyNames.join('、')}（未验证有效性）。`, source: 'environment',
    billing: apiKeyEnvPresent(toolId, env) ? 'api-key' : 'subscription' } : null
  const keyBilling = apiKeyEnvPresent(toolId, env) ? 'api-key' : null
  if (toolId === 'claude-code' && typeof runner === 'function') {
    const outcome = await runner('claude', ['auth', 'status', '--json'], { timeoutMs: LOGIN_CHECK_TIMEOUT_MS })
    if (outcome.timedOut) return viaKey ?? { state: 'unknown', detail: '登录状态检测超时。' }
    try {
      const status = JSON.parse(outcome.stdout)
      if (status?.loggedIn === true) return { state: 'logged-in', detail: `已登录（${String(status.authMethod ?? 'account')}）。`, source: 'cli',
        billing: keyBilling ?? (/api[_-]?key/i.test(String(status.authMethod ?? '')) ? 'api-key' : 'subscription') }
      if (status?.loggedIn === false) return viaKey ?? { state: 'logged-out', detail: 'claude auth status 报告未登录。', source: 'cli' }
    } catch { /* older CLI without JSON status */ }
    return viaKey ?? { state: 'unknown', detail: '无法解析 claude auth status 输出。' }
  }
  if (toolId === 'codex' && typeof runner === 'function') {
    const outcome = await runner('codex', ['login', 'status'], { timeoutMs: LOGIN_CHECK_TIMEOUT_MS })
    if (outcome.timedOut) return viaKey ?? { state: 'unknown', detail: '登录状态检测超时。' }
    const output = `${outcome.stdout}\n${outcome.stderr}`
    if (/not logged in/i.test(output)) return viaKey ?? { state: 'logged-out', detail: 'codex login status 报告未登录。', source: 'cli' }
    if (outcome.ok) return { state: 'logged-in', detail: output.split(/\r?\n/u).map(line => line.trim()).find(Boolean)?.slice(0, 120) || '已登录。', source: 'cli',
      billing: keyBilling ?? (/api key/i.test(output) ? 'api-key' : /chatgpt/i.test(output) ? 'subscription' : 'unknown') }
    return viaKey ?? { state: 'unknown', detail: 'codex login status 未给出明确结果。' }
  }
  if (toolId === 'gemini') {
    if (viaKey) return viaKey
    const credentialFile = home ? `${home}/.gemini/oauth_creds.json` : ''
    if (credentialFile && await exists(credentialFile)) return { state: 'logged-in', detail: '检测到 Gemini CLI 登录凭据文件（未验证是否过期）。', source: 'file', billing: 'subscription' }
    return { state: 'unknown', detail: 'Gemini CLI 没有登录状态命令；首次运行时会提示登录。' }
  }
  return viaKey ?? { state: 'unknown', detail: '该 CLI 没有可安全调用的登录状态命令；首次运行时以实际结果为准。' }
}

/** Combine one probe with its login state. */
export async function checkToolHealth(probe, options = {}) {
  const tool = getOfficialTool(probe?.id)
  if (!tool) throw new TypeError('unknown official tool')
  const installed = probe.installed === true
  const login = installed ? await checkLogin(tool.id, options) : { state: 'unknown', detail: '尚未安装。' }
  const { command, steps } = guide(tool.id)
  return {
    id: tool.id,
    label: tool.label,
    installed,
    installStatus: probe.status ?? (installed ? 'installed' : 'not-installed'),
    version: probe.version ?? null,
    pinnedVersion: tool.version ?? null,
    versionStatus: installed ? versionStatus(tool, probe.version) : 'unknown',
    login: { ...login, command, steps },
    ready: installed && login.state !== 'logged-out',
  }
}

/** Run the whole health check; individual failures become 'unknown' rather than errors. */
export async function runHealthCheck(probes, options = {}) {
  const now = options.now ?? Date.now
  const byId = new Map((Array.isArray(probes) ? probes : []).map(probe => [probe.id, probe]))
  const tools = await Promise.all(OFFICIAL_TOOLS.map(async tool => {
    const probe = byId.get(tool.id) ?? { id: tool.id, installed: false, status: 'not-installed' }
    try { return await checkToolHealth(probe, options) }
    catch (error) {
      return { id: tool.id, label: tool.label, installed: probe.installed === true, version: probe.version ?? null,
        pinnedVersion: tool.version ?? null, versionStatus: 'unknown', ready: probe.installed === true,
        login: { state: 'unknown', detail: String(error?.message ?? error).slice(0, 200), ...guide(tool.id) } }
    }
  }))
  return { checkedAt: now(), tools }
}

/** In-process readiness cache shared by planning and execution. */
export function createHealthCache({ ttlMs = HEALTH_CACHE_MS, now = Date.now } = {}) {
  let report = null
  const overrides = new Map()
  return {
    remember(next) {
      if (next && Array.isArray(next.tools)) {
        report = next
        overrides.clear()
      }
      return report
    },
    report() { return report },
    /** Mark one tool logged out after its CLI reported an authentication failure. */
    markLoggedOut(toolId, detail) {
      overrides.set(toolId, { at: now(), state: 'logged-out', detail: String(detail ?? '').slice(0, 200) })
    },
    loginState(toolId) {
      const override = overrides.get(toolId)
      if (override && now() - override.at < ttlMs) return override
      if (!report || now() - report.checkedAt >= ttlMs) return null
      const entry = report.tools.find(item => item.id === toolId)
      return entry?.installed ? { state: entry.login?.state ?? 'unknown', detail: entry.login?.detail ?? '', billing: entry.login?.billing ?? null } : null
    },
    /** Reason to skip the CLI, or null. A configured API key still lets the CLI authenticate. */
    skipReason({ toolId, hasApiKey = false }) {
      if (hasApiKey) return null
      const state = this.loginState(toolId)
      if (state?.state !== 'logged-out') return null
      const label = getOfficialTool(toolId)?.label ?? toolId
      return `${label} 未登录（开箱体检结果），已直接使用模型目录 API。登录后在工作台点“重新体检”即可恢复官方 CLI。`
    },
  }
}

export const healthCache = createHealthCache()
