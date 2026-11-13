import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, dirname } from 'node:path'
import { cliDriver } from './cli-driver-specs.mjs'
import { provisionAntigravityRuntime } from './antigravity-runtime.mjs'
import { provisionDeepSeekRuntime } from './deepseek-runtime.mjs'

const fail = message => { throw Object.assign(new Error(message), { code: 'CLI_CHAT_CREDENTIAL_INVALID' }) }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const files = Object.freeze({
  claude: ['.claude/.credentials.json'], codex: ['auth.json'], pi: ['.pi/agent/auth.json'], museCode: ['config/muse/auth.json'],
  grokAgent: ['.grok/auth.json'], geminiAgent: ['.gemini/oauth_creds.json'], kimiAgent: ['.kimi-code/credentials/kimi-code.json'],
  droidAgent: ['.factory/auth.v2.file'], cursorAgent: [], opencodeGo: ['data/opencode/auth.json'], qwenAgent: ['.qwen/oauth_creds.json'],
  hermesAgent: ['.hermes/auth.json'], clineAgent: ['.cline/data/settings/providers.json'], copilotAgent: [], commandCodeAgent: ['.commandcode/auth.json'], customAcp: [],
  antigravityAgent: ['.gemini/antigravity-acp/acp_token.json'], deepseekAgent: [], stepAgent: ['.stepcode/auth.json'],
})
const envNames = Object.freeze({ cursorAgent: ['CURSOR_AUTH_TOKEN'], copilotAgent: ['COPILOT_GITHUB_TOKEN'], deepseekAgent: ['DEEPSEEK_API_KEY'] })
function inspect(value, driver, depth = 0) {
  if (depth > 12) fail('认证资料嵌套过深。')
  if (typeof value === 'string' && (value.length > 64_000 || value.includes('\0'))) fail('认证字段过长或含无效字符。')
  if (value === null || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:__proto__|constructor|prototype|hooks?|mcpServers|mcp_servers|plugins?|extensions?|endpoint|base_?url|command|args|env|config|settings)$/i.test(key)) fail('只接受账号认证资料，不接受运行配置、端点或扩展。')
    if ((/api.?key/i.test(key) && nested || key === 'key' && nested || key === 'type' && nested === 'api') && driver !== 'commandCodeAgent') fail('此原生聊天通道使用账号套餐，请把按量 API Key 配置到 API 连接中。')
    inspect(nested, driver, depth + 1)
  }
}
export function normalizeCliCredential(driverId, raw) {
  const driver = cliDriver(driverId)
  if (!driver?.available || typeof raw !== 'string' || Buffer.byteLength(raw) > 128_000) fail('请选择已适配驱动，并提供有效的认证 JSON。')
  let value
  try { value = JSON.parse(raw) } catch { fail('认证资料需要有效 JSON。') }
  if (!plain(value) || Object.keys(value).some(key => !['schemaVersion', 'billing', 'files', 'env'].includes(key))
    || value.schemaVersion !== 1 || value.billing !== (driverId === 'customAcp' ? 'local' : driverId === 'deepseekAgent' ? 'api' : 'subscription')
    || !plain(value.files) || !plain(value.env)) fail('认证资料须包含 schemaVersion、billing、files 和 env。')
  if (Object.keys(value.files).length + Object.keys(value.env).length > 8) fail('每个连接仅保存所需的账号资料。')
  for (const [path, content] of Object.entries(value.files)) {
    if (!files[driverId]?.includes(path) || !plain(content) || !Object.keys(content).length) fail('认证文件不是该驱动允许的账号文件。')
    if (driverId === 'clineAgent') {
      const selected = content.lastUsedProvider, settings = content.providers?.[selected]?.settings
      if (content.version !== 1 || Object.keys(content).some(key => !['version', 'lastUsedProvider', 'providers'].includes(key))
        || !['cline', 'cline-pass', 'openai-codex'].includes(selected) || !plain(content.providers) || Object.keys(content.providers).length !== 1
        || !plain(settings) || settings.provider !== selected || Object.keys(settings).some(key => !['provider', 'model', 'auth'].includes(key))
        || typeof settings.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(settings.model)
        || !plain(settings.auth) || typeof settings.auth.accessToken !== 'string' || !settings.auth.accessToken
        || Object.keys(settings.auth).some(key => !['accessToken', 'refreshToken', 'expiresAt'].includes(key))) fail('Cline 只接受选定 OAuth 提供方的最小账号与模型配置。')
      inspect(settings.auth, driverId)
    } else if (driverId === 'stepAgent') {
      const account=content.step
      const legacy=typeof content.apiKey==='string'&&content.apiKey&&['step_plan','step_plan_oversea'].includes(content.profile)
        &&Object.keys(content).every(key=>['apiKey','profile','uid'].includes(key))
      if(!legacy&&(Object.keys(content).length!==1 || !plain(account) || account.type!=='oauth'
        || !['step_plan','step_plan_oversea'].includes(account.profile) || typeof account.access!=='string' || !account.access
        || Object.keys(account).some(key=>!['type','access','refresh','expires','profile','uid'].includes(key)))) fail('Step Code 需要带 Step Plan 区域标记的 OAuth 账号；不接受按量平台账号。')
      inspect(legacy?{access:content.apiKey,profile:content.profile,uid:content.uid}:account,driverId)
    } else inspect(content, driverId)
    if (driverId === 'opencodeGo' || driverId === 'pi') {
      if (Object.values(content).some(account => !plain(account) || account.type !== 'oauth')) fail('只接受明确标为 OAuth 的套餐账号。')
    }
    if (driverId === 'codex' && (!plain(content.tokens) || !content.tokens.access_token || !content.tokens.refresh_token)) fail('Codex 需要 ChatGPT 账号 token，不能以 API Key 代替。')
    if (driverId === 'claude' && !plain(content.claudeAiOauth)) fail('Claude 需要 claudeAiOauth 账号认证资料。')
  }
  for (const [key, secret] of Object.entries(value.env)) {
    if (!envNames[driverId]?.includes(key) || typeof secret !== 'string' || !secret || secret.length > 64_000 || /[\x00-\x20]/.test(secret)) fail('该环境字段不是此驱动允许的账号 token。')
  }
  if (driverId !== 'customAcp' && !Object.keys(value.files).length && !Object.keys(value.env).length) fail('请保存本连接的账号认证资料。')
  return JSON.stringify(value)
}
export function cliCredentialTemplate(driver) {
  const path = files[driver]?.[0]
  let account = { access_token: 'YOUR_ACCOUNT_ACCESS_TOKEN', refresh_token: 'YOUR_ACCOUNT_REFRESH_TOKEN' }
  if (driver === 'claude') account = { claudeAiOauth: { accessToken: 'YOUR_ACCOUNT_ACCESS_TOKEN', refreshToken: 'YOUR_ACCOUNT_REFRESH_TOKEN', expiresAt: 0 } }
  if (driver === 'codex') account = { tokens: { access_token: 'YOUR_ACCOUNT_ACCESS_TOKEN', refresh_token: 'YOUR_ACCOUNT_REFRESH_TOKEN', account_id: 'YOUR_ACCOUNT_ID' } }
  if (driver === 'opencodeGo' || driver === 'pi') account = { provider: { type: 'oauth', access: 'YOUR_ACCOUNT_ACCESS_TOKEN', refresh: 'YOUR_ACCOUNT_REFRESH_TOKEN', expires: 0 } }
  if (driver === 'stepAgent') account = { step: { type: 'oauth', access: 'YOUR_ACCOUNT_ACCESS_TOKEN', refresh: 'YOUR_ACCOUNT_REFRESH_TOKEN', expires: 0, profile: 'step_plan' } }
  if (driver === 'clineAgent') account = { version: 1, lastUsedProvider: 'cline', providers: { cline: { settings: { provider: 'cline', model: 'YOUR_NATIVE_MODEL_ID', auth: { accessToken: 'YOUR_ACCOUNT_ACCESS_TOKEN' } } } } }
  return { schemaVersion: 1, billing: driver === 'customAcp' ? 'local' : driver === 'deepseekAgent' ? 'api' : 'subscription', files: path ? { [path]: account } : {},
    env: Object.fromEntries((envNames[driver] ?? []).map(name => [name, 'YOUR_ACCOUNT_TOKEN'])) }
}
export async function provisionCliCredential(home, profile, resolveSecret) {
  if (!isAbsolute(home)) fail('原生会话私有目录无效。')
  const value = JSON.parse(normalizeCliCredential(profile.driver, await resolveSecret(profile.credentialRef, profile)))
  for (const [path, content] of Object.entries(value.files)) {
    const target = join(home, ...path.split('/')); await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, JSON.stringify(content), { flag: 'wx', mode: 0o600 })
  }
  const env = { ...value.env }
  const directories = { grokAgent: ['GROK_HOME', '.grok'], kimiAgent: ['KIMI_CODE_HOME', '.kimi-code'],
    cursorAgent: ['CURSOR_CONFIG_DIR', '.cursor'], pi: ['PI_CODING_AGENT_DIR', '.pi/agent'],
    hermesAgent: ['HERMES_HOME', '.hermes'], clineAgent: ['CLINE_DIR', '.cline'], stepAgent: ['STEP_CODING_AGENT_DIR', '.stepcode/agent'] }
  const directory = directories[profile.driver]
  if (directory) { env[directory[0]] = join(home, ...directory[1].split('/')); await mkdir(env[directory[0]], { recursive: true, mode: 0o700 }) }
  if (profile.driver === 'stepAgent') env.STEPCODE_AUTH_PATH=join(home,'.stepcode/auth.json')
  if (profile.driver === 'geminiAgent') {
    const target = join(home, '.gemini/settings.json'); await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } }, tools: { approvalMode: 'default' } }), { mode: 0o600 })
    env.GEMINI_CLI_NO_RELAUNCH = '1'
  }
  if (profile.driver === 'kimiAgent') {
    const model = profile.model?.replace(/^kimi-code\//, '')
    if (!['kimi-for-coding', 'kimi-for-coding-highspeed', 'k3', 'k3-256k', 'k3.1-pro', 'k3.1-pro-highspeed'].includes(model)) fail('请使用 Kimi Code 官方模型 ID（kimi-code/模型名）。')
    const config = `default_model = ${JSON.stringify(profile.model)}\n[providers.\"managed:kimi-code\"]\ntype = \"kimi\"\nbase_url = \"https://api.kimi.com/coding/v1\"\napi_key = \"\"\n[providers.\"managed:kimi-code\".oauth]\nstorage = \"file\"\nkey = \"oauth/kimi-code\"\n[models.${JSON.stringify(profile.model)}]\nprovider = \"managed:kimi-code\"\nmodel = ${JSON.stringify(model)}\nmax_context_size = 262144\ncapabilities = [\"thinking\", \"tool_use\"]\n`
    await writeFile(join(home, '.kimi-code/config.toml'), config, { mode: 0o600 })
  }
  if (profile.driver === 'museCode') env.MUSE_NO_AUTO_UPDATE = '1'
  if (profile.driver === 'antigravityAgent') Object.assign(env, (await provisionAntigravityRuntime(home, profile)).env)
  if (profile.driver === 'deepseekAgent') Object.assign(env, (await provisionDeepSeekRuntime(home, profile)).env)
  if (profile.driver === 'clineAgent') {
    const settings = value.files['.cline/data/settings/providers.json'], provider = settings.lastUsedProvider
    if (settings.providers[provider].settings.model !== profile.model) fail('Cline 认证资料中的模型必须与此连接的模型 ID 一致。')
    env.CLINE_PROVIDER = provider; env.CLINE_MODEL = profile.model; env.CLINE_DATA_DIR = join(home, '.cline/data')
  }
  return { env }
}
/** Called only after the owner explicitly selected importLocalAccount on save. */
export async function importCliAccount(driver, { userHome = homedir() } = {}) {
  const paths = files[driver]
  if (!paths?.length) fail('此驱动请通过认证 JSON 单独保存账号 token。')
  const relative = driver === 'codex' ? '.codex/auth.json' : driver === 'opencodeGo' ? '.local/share/opencode/auth.json' : driver === 'museCode' ? '.config/muse/auth.json' : paths[0]
  let content
  try { const raw = await readFile(join(userHome, ...relative.split('/'))); if (raw.length > 128_000) fail('账号文件过大。'); content = JSON.parse(raw.toString('utf8')) }
  catch { fail('未找到可导入的账号文件，请先在官方 CLI 登录，或手动提供此连接的认证资料。') }
  if(driver==='stepAgent') {
    // Older Step builds stored the plan bearer token as apiKey. Preserve that
    // vendor shape for Step's own migration; a platform profile cannot pass.
    if(content.step) content={step:content.step}
  }
  return normalizeCliCredential(driver, JSON.stringify({ schemaVersion: 1, billing: driver === 'customAcp' ? 'local' : 'subscription', files: { [paths[0]]: content }, env: {} }))
}
