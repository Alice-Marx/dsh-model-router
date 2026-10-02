/**
 * Onboarding health check for the fixed official tool registry.
 *
 * For every registry tool: installed?, version at least the pinned registry
 * version?, and logged in? Login checks use only fixed, read-only status
 * commands (`claude auth status --json`, `codex login status`) or the
 * presence of a credential file / environment variable name (Gemini, Kimi,
 * MiMo, Grok). MiniMax is read from the `status` field of its non-secret
 * auth-state.json (the CLI refuses to persist OAuth secrets there). ZCode exposes
 * nothing and stays 'unknown'. No credential value is read or returned. Results are cached so routing can skip a tool
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
  'kimi-code': Object.freeze({ command: 'kimi login', steps: '在终端运行 kimi login（设备码登录，可加 --region mainland-cn 或 --region global），按提示在浏览器中授权 Kimi 账号；也可以设置 KIMI_API_KEY 使用 API 计费。' }),
  'minimax-code': Object.freeze({ command: 'mcode login', steps: '在终端运行 mcode login（可加 --region cn 或 --region global），在浏览器中登录 MiniMax 账号；或运行 mcode set-minimax-key / 设置 MINIMAX_API_KEY 使用 API Key。插件读取 MiniMax Code 的登录状态文件 auth-state.json（不含密钥）判断是否已登录；用 API Key 时状态显示为未知。' }),
  'mimo-code': Object.freeze({ command: 'mimo auth login', steps: '在终端运行 mimo auth login，选择 Xiaomi MiMo Platform 登录小米账号或填入 API Key；mimo auth list 可查看已保存的凭据。未登录时 MiMo Auto 免费匿名通道可能仍可用。' }),
  'grok-build': Object.freeze({ command: 'grok login', steps: '在终端运行 grok login，按浏览器提示登录 xAI 账号；无浏览器环境用 grok login --device-auth，或设置 XAI_API_KEY 使用 API 计费。' }),
  zcode: Object.freeze({ command: null, steps: '打开 ZCode 桌面版，在欢迎页选择“连接 BigModel 继续使用”或“连接 Z.ai 继续使用”完成授权；已订阅 GLM Coding Plan 时在“模型设置 → BigModel”右上角选择“编程套餐”绑定。改用 API Key 时 OpenAI 地址须填 Coding 专用端点 https://open.bigmodel.cn/api/coding/paas/v4。ZCode 没有可调用的登录状态命令。' }),
})

/** Environment variable names whose presence means a CLI can authenticate without a session. */
const KEY_ENV = Object.freeze({
  'claude-code': ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'kimi-code': ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  'minimax-code': ['MINIMAX_API_KEY'],
  'mimo-code': ['MIMO_API_KEY'],
  'grok-build': ['XAI_API_KEY'],
})

/**
 * Credential files the official CLIs write after an account login. Verified
 * against the published packages (kimi-code 2.1.1 FileTokenStorage,
 * mimocode 0.1.15 `mimo auth list`, grok 1.0.41 `~/.grok/auth.json`). Only
 * existence is checked; the file is never opened.
 */
export function credentialFileFor(toolId, { home = '', env = process.env } = {}) {
  const value = name => (typeof env?.[name] === 'string' && env[name].trim() ? env[name].trim().replace(/[\\/]+$/u, '') : '')
  const base = home ? String(home).replace(/[\\/]+$/u, '') : ''
  if (toolId === 'kimi-code') { const root = value('KIMI_CODE_HOME') || (base && `${base}/.kimi-code`); return root ? `${root}/credentials/kimi-code.json` : '' }
  if (toolId === 'mimo-code') { const root = value('XDG_DATA_HOME') || (base && `${base}/.local/share`); return root ? `${root}/mimocode/auth.json` : '' }
  if (toolId === 'grok-build') { const root = value('GROK_HOME') || (base && `${base}/.grok`); return root ? `${root}/auth.json` : '' }
  if (toolId === 'gemini') return base ? `${base}/.gemini/oauth_creds.json` : ''
  return ''
}

const FILE_LOGIN = Object.freeze({
  'kimi-code': { found: path => `检测到 Kimi Code 登录凭据文件 ${path}（未验证是否过期）。`, missing: path => `未找到 Kimi Code 登录凭据文件 ${path}（也可能通过 config.toml 中的自定义供应商认证），登录状态未知；如未登录请运行 kimi login。`, missingState: 'unknown' },
  'mimo-code': { found: path => `检测到 MiMo Code 凭据文件 ${path}（未验证是否有效，也可能只含 API Key）。`, missing: path => `未找到 MiMo Code 凭据文件 ${path}；MiMo Auto 免费匿名通道可能仍可用，订阅/账号状态未知。`, missingState: 'unknown' },
  'grok-build': { found: path => `检测到 Grok 登录凭据文件 ${path}（未验证是否过期）。`, missing: path => `未找到 Grok 登录凭据文件 ${path}，登录状态未知；如未登录请运行 grok login。`, missingState: 'unknown' },
})

/**
 * MiniMax Code 0.5.5 keeps OAuth state per region in
 * `<MINIMAX_DATA_DIR or ~/.minimax>/auth/prod/<cn|global>/mcode-public/auth-state.json`.
 * That file is the CLI's non-secret state record (`status`: anonymous /
 * authorizing / refreshing / authenticated / logging_out); the token itself
 * lives in auth.json next to it or in the OS keyring and is never opened.
 */
export function minimaxAuthStateFiles({ home = '', env = process.env } = {}) {
  const configured = typeof env?.MINIMAX_DATA_DIR === 'string' ? env.MINIMAX_DATA_DIR.trim().replace(/[\\/]+$/u, '') : ''
  const base = configured || (home ? `${String(home).replace(/[\\/]+$/u, '')}/.minimax` : '')
  if (!base) return []
  return ['cn', 'global'].map(region => ({ region, path: `${base}/auth/prod/${region}/mcode-public/auth-state.json` }))
}

/** Grok runs launched by the plugin may use a relocated GROK_HOME (see ensureNpmPrefixOnPath). */
function grokHomeHint(env) {
  const configured = typeof env?.GROK_HOME === 'string' ? env.GROK_HOME.trim() : ''
  return configured ? `插件启动 Grok 时使用 GROK_HOME=${configured}；请在设置了同样 GROK_HOME 的终端中运行 grok login（PowerShell：$env:GROK_HOME='${configured}'; grok login），否则插件里的 Grok 读不到登录。` : ''
}

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

/** Copy of `env` without this CLI's API-key variables, so a status probe reports the account login itself. */
function sessionEnvironment(toolId, env) {
  const names = API_KEY_ENV[toolId] ?? []
  if (!env || names.length === 0) return undefined
  return Object.fromEntries(Object.entries(env).filter(([name]) => !names.includes(name)))
}

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
export async function checkLogin(toolId, { runner, env = process.env, exists = async () => false, home = '', readAuthState = async () => null } = {}) {
  const keyNames = (KEY_ENV[toolId] ?? []).filter(name => typeof env?.[name] === 'string' && env[name].trim())
  const viaKey = keyNames.length > 0 ? { state: 'logged-in', detail: `检测到环境变量 ${keyNames.join('、')}（未验证有效性）。`, source: 'environment',
    billing: apiKeyEnvPresent(toolId, env) ? 'api-key' : 'subscription',
    accountLogin: keyNames.some(name => !(API_KEY_ENV[toolId] ?? []).includes(name)) } : null
  const keyBilling = apiKeyEnvPresent(toolId, env) ? 'api-key' : null
  if (toolId === 'claude-code' && typeof runner === 'function') {
    const outcome = await runner('claude', ['auth', 'status', '--json'], { timeoutMs: LOGIN_CHECK_TIMEOUT_MS, env: sessionEnvironment(toolId, env) })
    if (outcome.timedOut) return viaKey ?? { state: 'unknown', detail: '登录状态检测超时。' }
    try {
      const status = JSON.parse(outcome.stdout)
      if (status?.loggedIn === true) return { state: 'logged-in', detail: `已登录（${String(status.authMethod ?? 'account')}）。`, source: 'cli',
        billing: keyBilling ?? (/api[_-]?key/i.test(String(status.authMethod ?? '')) ? 'api-key' : 'subscription'),
        accountLogin: !/api[_-]?key/i.test(String(status.authMethod ?? '')) }
      if (status?.loggedIn === false) return viaKey ?? { state: 'logged-out', detail: 'claude auth status 报告未登录。', source: 'cli' }
    } catch { /* older CLI without JSON status */ }
    return viaKey ?? { state: 'unknown', detail: '无法解析 claude auth status 输出。' }
  }
  if (toolId === 'codex' && typeof runner === 'function') {
    const outcome = await runner('codex', ['login', 'status'], { timeoutMs: LOGIN_CHECK_TIMEOUT_MS, env: sessionEnvironment(toolId, env) })
    if (outcome.timedOut) return viaKey ?? { state: 'unknown', detail: '登录状态检测超时。' }
    const output = `${outcome.stdout}\n${outcome.stderr}`
    if (/not logged in/i.test(output)) return viaKey ?? { state: 'logged-out', detail: 'codex login status 报告未登录。', source: 'cli' }
    if (outcome.ok) return { state: 'logged-in', detail: output.split(/\r?\n/u).map(line => line.trim()).find(Boolean)?.slice(0, 120) || '已登录。', source: 'cli',
      billing: keyBilling ?? (/api key/i.test(output) ? 'api-key' : /chatgpt/i.test(output) ? 'subscription' : 'unknown'),
      accountLogin: /chatgpt/i.test(output) ? true : /api key/i.test(output) ? false : null }
    return viaKey ?? { state: 'unknown', detail: 'codex login status 未给出明确结果。' }
  }
  if (toolId === 'gemini') {
    const credentialFile = credentialFileFor('gemini', { home, env })
    const hasFile = Boolean(credentialFile) && await exists(credentialFile)
    if (viaKey) return { ...viaKey, accountLogin: hasFile }
    if (hasFile) return { state: 'logged-in', detail: '检测到 Gemini CLI 登录凭据文件（未验证是否过期）。', source: 'file', billing: 'subscription', accountLogin: true }
    return { state: 'unknown', detail: 'Gemini CLI 没有登录状态命令；首次运行时会提示登录。' }
  }
  if (FILE_LOGIN[toolId]) {
    const text = FILE_LOGIN[toolId]
    const credentialFile = credentialFileFor(toolId, { home, env })
    const hasFile = Boolean(credentialFile) && await exists(credentialFile)
    if (viaKey) return { ...viaKey, accountLogin: hasFile }
    if (hasFile) return { state: 'logged-in', detail: text.found(credentialFile), source: 'file', billing: toolId === 'mimo-code' ? 'unknown' : 'subscription', accountLogin: toolId === 'mimo-code' ? null : true }
    if (!credentialFile) return { state: 'unknown', detail: '无法确定用户目录，登录状态未知。' }
    const hint = toolId === 'grok-build' ? grokHomeHint(env) : ''
    return { state: text.missingState, detail: hint ? `${text.missing(credentialFile)}${hint}` : text.missing(credentialFile), source: 'file' }
  }
  if (toolId === 'minimax-code') {
    const states = []
    for (const { region, path } of minimaxAuthStateFiles({ home, env })) {
      let record = null
      try { record = await readAuthState(path) } catch { record = null }
      const status = typeof record?.status === 'string' ? record.status : null
      if (status) states.push({ region, status })
    }
    const signedIn = states.find(item => item.status === 'authenticated' || item.status === 'refreshing')
    if (signedIn) return { state: 'logged-in', detail: `MiniMax Code 已登录（${signedIn.region === 'cn' ? '国内站' : '国际站'}，状态文件 auth-state.json 为 ${signedIn.status}，未验证令牌是否过期）。`, source: 'file',
      billing: viaKey?.billing === 'api-key' ? 'api-key' : 'subscription', accountLogin: true }
    if (viaKey) return viaKey
    if (states.length) return { state: 'unknown', source: 'file', detail: `MiniMax Code 账号未登录（auth-state.json 为 ${states.map(item => `${item.region}: ${item.status}`).join('、')}）；如果用 mcode set-minimax-key 保存了 API Key 仍可使用，否则请运行 mcode login。` }
    return { state: 'unknown', detail: '未找到 MiniMax Code 登录状态文件（~/.minimax/auth/prod/<cn|global>/mcode-public/auth-state.json），登录状态未知；如未登录请运行 mcode login。' }
  }
  if (toolId === 'zcode') return viaKey ?? { state: 'unknown', detail: 'ZCode 是桌面应用，没有可调用的登录状态命令；登录与 GLM Coding Plan 状态请在 ZCode 内查看。' }
  return viaKey ?? { state: 'unknown', detail: '该 CLI 没有可安全调用的登录状态命令；首次运行时以实际结果为准。' }
}

/**
 * Whether a CLI can run on its subscription login (with API-key variables
 * removed): 'subscription', 'api-key' (only an API key authenticates it),
 * 'logged-out', or 'unknown'.
 */
export function subscriptionLoginOf(login) {
  if (!login) return 'unknown'
  if (login.state === 'logged-out') return 'logged-out'
  if (login.accountLogin === true) return 'subscription'
  if (login.accountLogin === false) return 'api-key'
  if (login.billing === 'subscription') return 'subscription'
  return 'unknown'
}

/** Combine one probe with its login state. */
export async function checkToolHealth(probe, options = {}) {
  const tool = getOfficialTool(probe?.id)
  if (!tool) throw new TypeError('unknown official tool')
  const installed = probe.installed === true
  const login = installed ? await checkLogin(tool.id, options) : { state: 'unknown', detail: probe.status === 'not-installed' && /检测到已安装/.test(String(probe.detail ?? '')) ? String(probe.detail) : '尚未安装。' }
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
  const seenAuth = new Map()
  return {
    remember(next) {
      if (next && Array.isArray(next.tools)) {
        report = next
        // A runtime authentication failure stays known while the new check still says
        // logged out, so the router keeps asking instead of silently using the API key.
        for (const [toolId, override] of [...overrides]) {
          const entry = next.tools.find(item => item.id === toolId)
          if (override.source !== 'runtime-auth' || entry?.login?.state !== 'logged-out') overrides.delete(toolId)
        }
      }
      return report
    },
    report() { return report },
    /** Mark one tool logged out after its CLI reported an authentication failure. */
    markLoggedOut(toolId, detail, at = now()) {
      overrides.set(toolId, { at, state: 'logged-out', detail: String(detail ?? '').slice(0, 200), source: 'runtime-auth' })
    },
    /** The CLI ran on its subscription again: forget the authentication failure. */
    clearLoggedOut(toolId) { seenAuth.delete(toolId); return overrides.delete(toolId) },
    /**
     * Adopt persisted state written by other processes: a newer health report,
     * new authentication failures, and failures another process cleared.
     */
    sync(saved) {
      let changed = 0
      if (saved?.health && Array.isArray(saved.health.tools) && Number.isFinite(saved.health.checkedAt)
        && (!report || saved.health.checkedAt > report.checkedAt)) { this.remember(saved.health); changed += 1 }
      const disk = saved?.authFailures && typeof saved.authFailures === 'object' ? saved.authFailures : {}
      for (const [toolId, entry] of Object.entries(disk)) {
        const at = Number.isFinite(entry?.at) ? entry.at : 0
        const mine = overrides.get(toolId)
        if (!mine || (mine.source === 'runtime-auth' && at > mine.at)) { this.markLoggedOut(toolId, entry?.detail, at); changed += 1 }
        seenAuth.set(toolId, at)
      }
      for (const [toolId, mine] of [...overrides]) {
        if (toolId in disk || mine.source !== 'runtime-auth') continue
        if (seenAuth.has(toolId) && mine.at <= seenAuth.get(toolId)) { overrides.delete(toolId); changed += 1 }
        seenAuth.delete(toolId)
      }
      return changed
    },
    loginState(toolId) {
      const override = overrides.get(toolId)
      if (override && (now() - override.at < ttlMs || report?.tools?.find(item => item.id === toolId)?.login?.state === 'logged-out')) return override
      if (!report || now() - report.checkedAt >= ttlMs) return null
      const entry = report.tools.find(item => item.id === toolId)
      return entry?.installed ? { state: entry.login?.state ?? 'unknown', detail: entry.login?.detail ?? '', billing: entry.login?.billing ?? null,
        accountLogin: typeof entry.login?.accountLogin === 'boolean' ? entry.login.accountLogin : null } : null
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
