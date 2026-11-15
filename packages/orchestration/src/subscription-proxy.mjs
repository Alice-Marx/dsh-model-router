import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AiProviderAdapter } from './ai-provider-adapter.mjs'
import { createCliProxyRuntime } from './cli-proxy-runtime.mjs'

export const SUBSCRIPTION_PROVIDERS = Object.freeze([
  { id: 'codex', name: 'ChatGPT / Codex', domains: ['openai.com', 'chatgpt.com'] },
  { id: 'claude', name: 'Claude', domains: ['claude.ai', 'anthropic.com'] },
  { id: 'antigravity', name: 'Google Antigravity', domains: ['google.com'] },
  { id: 'kimi', name: 'Kimi Code（中国站）', domains: ['kimi.com', 'moonshot.cn'] },
  { id: 'kimi-ai', name: 'Kimi Code（国际站）', domains: ['kimi.ai', 'kimi.com'] },
  { id: 'xai', name: 'Grok Build', domains: ['x.ai', 'grok.com'] },
  { id: 'meta', name: 'Muse Code', domains: ['meta.com', 'facebook.com'] },
  { id: 'devin', name: 'Devin', domains: ['devin.ai'] },
])
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 32)
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(value)
const safeText = (value, max = 160) => typeof value === 'string' && value.length <= max && !/[\p{Cc}]/u.test(value) ? value : ''
const aliases = { anthropic: 'claude', 'gemini-cli': 'gemini', 'kimi-code': 'kimi', 'kimi-cn': 'kimi', 'kimi-global': 'kimi-ai', grok: 'xai', 'muse-code': 'meta' }
const kindOf = value => aliases[String(value).toLowerCase()] ?? String(value).toLowerCase()
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED', '请以宿主拥有者身份管理订阅账户。'); context.signal?.throwIfAborted() }
const payloadKeys = (payload, keys) => { if (!plain(payload) || Object.keys(payload).some(key => !keys.includes(key))) fail('SUBSCRIPTION_INVALID', '订阅账户请求格式无效。') }
const entryId = payload => { if (!/^[a-f0-9]{32}$/.test(payload?.id)) fail('SUBSCRIPTION_INVALID', '请选择已有订阅账户。'); return payload.id }
export function subscriptionAuthUrl(raw, provider) {
  let url; try { url = new URL(raw) } catch { fail('SUBSCRIPTION_AUTH_URL', '订阅服务没有返回有效的授权页面。') }
  if (url.protocol !== 'https:' || url.username || url.password || !provider.domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) fail('SUBSCRIPTION_AUTH_URL', '订阅服务返回的授权页面不属于所选提供方。')
  return url.href
}
function callbackDestination(authUrl) {
  try {
    const uri = new URL(new URL(authUrl).searchParams.get('redirect_uri'))
    if (uri.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname) && !uri.username && !uri.password && !uri.search && !uri.hash) return uri.href
  } catch {}
  return null
}
export function subscriptionModels(entries, definitions, prefix) {
  const known = new Map((Array.isArray(definitions) ? definitions : []).map(info => [String(info.id ?? info.name ?? '').replace(/^models\//, ''), info]))
  const models = [], missing = []
  for (const advertised of entries) {
    if (typeof advertised?.id !== 'string' || !advertised.id.startsWith(prefix + '/') || !token(advertised.id)) continue
    const base = advertised.id.slice(prefix.length + 1), info = known.get(base) ?? advertised
    const contextWindow = info.context_length ?? info.inputTokenLimit, output = info.max_completion_tokens ?? info.outputTokenLimit
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 2 || contextWindow > 100_000_000 || !Number.isSafeInteger(output) || output < 1) { missing.push({ id: advertised.id, name: safeText(info.display_name) || base }); continue }
    const reasoningEfforts = (Array.isArray(info.thinking?.levels) ? info.thinking.levels : []).filter(value => ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value))
    models.push({ id: advertised.id, name: safeText(info.display_name) || base, contextWindow, maxTokens: Math.min(output, contextWindow - 1), reasoning: reasoningEfforts.length > 0,
      ...(reasoningEfforts.length ? { reasoningEfforts: [...new Set(reasoningEfforts)] } : {}) })
  }
  if (models.length + missing.length > 100) fail('SUBSCRIPTION_MODEL_LIMIT', '此账户返回的模型数量超出支持范围。')
  return { models, missing }
}

/** Only this managed, OAuth-only gateway can mint subscription-only model routes.
 * No RPC accepts a route URL, credential file, API-key upstream or billing label. */
export function openSubscriptionProxy({ Database, file, root, llm, runtime: suppliedRuntime, usedBy = () => [], onChanged = async () => {}, now = Date.now } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  if (!suppliedRuntime && !root) fail('SUBSCRIPTION_STORAGE_REQUIRED', '订阅账户需要私有存储目录。')
  const db = new Database(file), mounted = new Map(), flights = new Set(), sessions = new Map(), owned = new Set()
  db.exec('CREATE TABLE IF NOT EXISTS bot_subscription_accounts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, health TEXT)')
  let queue = Promise.resolve(), closed = false, runtime
  const serial = work => { const result = queue.then(() => { if (closed) fail('SUBSCRIPTION_CLOSED', '订阅账户服务已关闭。'); return work() }); queue = result.catch(() => {}); return result }
  const decode = row => {
    if (!row) return null
    try {
      const value = JSON.parse(row.payload)
      if (value.id !== row.id || value.route !== 'bot-sub-' + value.id || !/^[a-f0-9]{32}$/.test(value.id) || typeof value.authName !== 'string' || value.prefix !== 'dsh-' + value.id.slice(0, 16)
        || digest(value.authName) !== value.id || !SUBSCRIPTION_PROVIDERS.some(item => item.id === value.kind) || !Array.isArray(value.models) || value.models.length > 100 || !Array.isArray(value.missing)
        || typeof value.enabled !== 'boolean' || typeof value.unavailable !== 'boolean' || !Number.isSafeInteger(row.revision) || row.revision < 1
        || value.models.some(model => !token(model.id) || !model.id.startsWith(value.prefix + '/') || !safeText(model.name) || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 2
          || !Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1 || model.maxTokens >= model.contextWindow || typeof model.reasoning !== 'boolean'
          || model.reasoningEfforts !== undefined && (!Array.isArray(model.reasoningEfforts) || model.reasoningEfforts.some(level => !['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level))))) throw Error('shape')
      return { ...value, revision: row.revision, health: row.health ? JSON.parse(row.health) : null }
    } catch { fail('SUBSCRIPTION_STORE_INVALID', '订阅账户记录无效，请检查数据备份。') }
  }
  const rows = () => { if (closed) fail('SUBSCRIPTION_CLOSED', '订阅账户服务已关闭。'); return db.prepare('SELECT * FROM bot_subscription_accounts ORDER BY rowid').all().map(decode) }
  const read = id => decode(db.prepare('SELECT * FROM bot_subscription_accounts WHERE id=?').get(id))
  const usable = account => runtime.status().phase === 'ready' && account.enabled && !account.unavailable && account.models.length > 0
  const publish = async () => { await onChanged() }
  const currentLease = async profile => {
    const current = read(profile.id), connection = runtime.connection()
    if (closed || !current || current.revision !== profile.revision || !usable(current) || profile.generation !== connection.generation) fail('AI_PROVIDER_CHANGED', '此订阅账户已修改、退出或断开，请重新检查。')
    const controller = new AbortController(), item = { id: profile.id, revision: profile.revision, generation: connection.generation, controller }; flights.add(item)
    return { key: connection.apiKey, signal: controller.signal, release: () => flights.delete(item) }
  }
  const markResult = (profile, health) => {
    if (closed || read(profile.id)?.revision !== profile.revision) return
    db.prepare('UPDATE bot_subscription_accounts SET health=? WHERE id=? AND revision=?').run(JSON.stringify({ kind: health.kind, ...(health.kind === 'error' ? { code: health.code } : {}), checkedAt: now(), ...(health.kind === 'verified' ? { verifiedAt: now() } : {}) }), profile.id, profile.revision)
  }
  const syncAdapters = () => {
    if (closed) return
    const active = new Set(), connection = runtime.status().phase === 'ready' ? runtime.connection() : null
    for (const account of rows()) {
      owned.add(account.route)
      if (!usable(account) || !connection) continue
      active.add(account.id)
      const generation = account.revision + ':' + connection.generation
      if (mounted.get(account.id)?.generation === generation) continue
      mounted.get(account.id)?.release()
      const profile = { ...account, generation: connection.generation, protocol: 'openai-completions', baseUrl: connection.endpoint + '/v1' }
      const adapter = new AiProviderAdapter({ profile, acquire: currentLease, onResult: markResult,
        ...(runtime.fetchInference ? { fetcher: (input, init) => runtime.fetchInference(input, init) } : {}) })
      mounted.set(account.id, { generation, release: llm.registerAdapter([account.route], adapter) })
    }
    for (const [id, value] of mounted) if (!active.has(id)) { value.release(); mounted.delete(id) }
    for (const item of flights) if (!active.has(item.id) || read(item.id)?.revision !== item.revision || connection?.generation !== item.generation) item.controller.abort()
  }
  const accountView = account => ({ id: account.id, revision: account.revision, provider: account.route, kind: account.kind, name: account.name, email: account.email,
    enabled: account.enabled, models: account.models.map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens })), missingModels: account.missing,
    state: !account.enabled ? 'disabled' : runtime.status().phase !== 'ready' ? 'offline' : account.unavailable ? 'needs-login' : !account.models.length ? 'needs-models' : account.health?.kind === 'verified' ? 'ready' : 'configured',
    usedBy: usedBy(account.route), ...(account.health?.verifiedAt ? { verifiedAt: account.health.verifiedAt } : {}) })
  const synchronize = async context => {
    context?.signal?.throwIfAborted()
    if (runtime.status().phase !== 'ready') { syncAdapters(); await publish(); return }
    const result = await runtime.request('/v8/management/credentials?page=1&page_size=200', { signal: context?.signal })
    if (!Array.isArray(result.files) || result.has_more) fail('SUBSCRIPTION_PROXY_RESPONSE', '订阅服务返回的账户列表不完整，请重试。')
    const accounts = result.files.filter(row => plain(row) && row.runtime_only !== true && row.source !== 'config' && SUBSCRIPTION_PROVIDERS.some(provider => provider.id === kindOf(row.provider ?? row.type)))
    if (accounts.length > 32) fail('SUBSCRIPTION_ACCOUNT_LIMIT', '订阅账户最多32个，请先退出不使用的账户。')
    const discovered = []
    for (const row of accounts) {
      const authName = safeText(row.name || row.id, 512), kind = kindOf(row.provider ?? row.type)
      if (!authName) fail('SUBSCRIPTION_PROXY_RESPONSE', '订阅服务返回了无效账户。')
      const id = digest(authName), existing = read(id), prefix = 'dsh-' + id.slice(0, 16)
      // Prefix ownership gives every account a distinct inference route. Unprefixed
      // and config/API-key models are never published as subscription routes.
      if (!existing) await runtime.request('/v8/management/credentials/fields', { method: 'PATCH', body: { name: authName, prefix }, signal: context?.signal })
      discovered.push({ row, id, authName, kind, prefix, existing })
    }
    const catalog = await runtime.request('/v1/models', { signal: context?.signal })
    if (!Array.isArray(catalog.data)) fail('SUBSCRIPTION_PROXY_RESPONSE', '订阅服务没有返回有效的模型列表。')
    const definitions = new Map()
    for (const kind of new Set(discovered.map(item => item.kind))) {
      try { const result = await runtime.request('/v8/management/routing/model-definitions/' + encodeURIComponent(kind), { signal: context?.signal }); definitions.set(kind, result.models ?? []) }
      catch (error) { context?.signal?.throwIfAborted(); if (error.code !== 'SUBSCRIPTION_PROXY_HTTP') throw error; definitions.set(kind, []) }
    }
    context?.signal?.throwIfAborted()
    const retained = new Set()
    db.transaction(() => {
      for (const { row, id, authName, kind, prefix, existing } of discovered) {
        const parsed = subscriptionModels(catalog.data, definitions.get(kind), prefix), provider = SUBSCRIPTION_PROVIDERS.find(item => item.id === kind)
        const account = { id, route: 'bot-sub-' + id, authName, kind, prefix, name: existing?.name ?? provider.name + ' 订阅 · ' + id.slice(0, 4),
          email: safeText(row.email), enabled: row.disabled !== true, unavailable: row.disabled === true || row.unavailable === true || ['error', 'disabled'].includes(row.status), models: parsed.models, missing: parsed.missing }
        retained.add(id)
        const prior = existing && (({ revision, health, ...rest }) => rest)(existing)
        if (JSON.stringify(account) === JSON.stringify(prior)) continue
        db.prepare('INSERT INTO bot_subscription_accounts(id,revision,payload,health) VALUES(?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,health=NULL').run(id, (existing?.revision ?? 0) + 1, JSON.stringify(account))
      }
      for (const old of rows()) if (!retained.has(old.id)) db.prepare('DELETE FROM bot_subscription_accounts WHERE id=?').run(old.id)
    }).immediate()
    syncAdapters(); await publish()
  }
  const stateChanged = () => { if (!closed) void serial(async () => { if (runtime.status().phase === 'ready') await synchronize(); else { syncAdapters(); await publish() } }).catch(() => {}) }
  runtime = suppliedRuntime ?? createCliProxyRuntime({ root, onState: stateChanged })
  for (const row of rows()) owned.add(row.route)
  const list = context => { owner(context); syncAdapters(); return { schemaVersion: 1, service: runtime.status(), providers: SUBSCRIPTION_PROVIDERS.map(({ id, name }) => ({ id, name })), accounts: rows().map(accountView),
    pendingLogins: [...sessions].filter(([, session]) => session.expiresAt > now()).map(([loginId, session]) => ({ loginId, provider: session.provider, url: session.url, expiresAt: session.expiresAt, supportsCallback: Boolean(session.callbackUri), ...(session.userCode ? { userCode: session.userCode } : {}) })) } }
  const loginEntry = (payload, keys = ['loginId']) => { payloadKeys(payload, keys); const session = sessions.get(payload.loginId); if (!session || session.expiresAt <= now()) fail('SUBSCRIPTION_LOGIN_EXPIRED', '此登录已过期，请重新发起授权。'); return session }
  const timer = setInterval(() => {
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id)
    if (!closed && runtime.status().phase === 'ready' && !sessions.size) void serial(() => synchronize()).catch(() => {})
  }, 60_000); timer.unref?.()
  return Object.freeze({
    list,
    initialize: () => runtime.initialize(),
    enable(payload, context) { owner(context); payloadKeys(payload, ['proxyUrl']); if (payload.proxyUrl !== undefined && typeof payload.proxyUrl !== 'string') fail('SUBSCRIPTION_INVALID', '网络代理地址无效。'); return runtime.enable(payload) },
    stop: (payload, context) => serial(async () => { owner(context); payloadKeys(payload, []); await runtime.stop(); sessions.clear(); syncAdapters(); await publish(); return list(context) }),
    refresh: (payload, context) => serial(async () => { owner(context); payloadKeys(payload, []); await synchronize(context); return list(context) }),
    login: (payload, context) => serial(async () => {
      owner(context); payloadKeys(payload, ['provider'])
      const provider = SUBSCRIPTION_PROVIDERS.find(item => item.id === payload.provider)
      if (!provider) fail('SUBSCRIPTION_INVALID', '请选择支持的订阅提供方。')
      for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id)
      if (sessions.size >= 8) fail('SUBSCRIPTION_LOGIN_LIMIT', '请先完成或取消已有的登录。')
      let started
      // Once accepted, retain the session even if the owner page closes. A later
      // owner view can resume it; abandoning an HTTP response must not lose PKCE state.
      try { started = await runtime.request('/v8/management/oauth/auth-url', { method: 'POST', body: { provider: provider.id, is_webui: true }, timeout: 45_000 }) }
      catch (error) { if (error.status === 404) fail('SUBSCRIPTION_PROVIDER_UNAVAILABLE', '当前登录组件尚未启用此提供方。请检查 CLIProxyAPI 插件或使用官方 CLI 连接。'); throw error }
      if (typeof started.state !== 'string' || !/^[A-Za-z0-9._~-]{8,512}$/.test(started.state)) fail('SUBSCRIPTION_PROXY_RESPONSE', '订阅服务没有返回有效的登录状态。')
      let url
      try { url = subscriptionAuthUrl(started.url, provider) }
      catch (error) { await runtime.request('/v8/management/oauth/session?state=' + encodeURIComponent(started.state), { method: 'DELETE' }).catch(() => {}); throw error }
      const loginId = randomUUID().replaceAll('-', ''), expiresAt = now() + 5 * 60_000
      const callbackUri = callbackDestination(url)
      sessions.set(loginId, { provider: provider.id, state: started.state, expiresAt, generation: runtime.connection().generation, url, callbackUri, userCode: safeText(started.user_code, 80) })
      return { loginId, provider: provider.id, url, expiresAt, supportsCallback: Boolean(callbackUri), ...(safeText(started.user_code, 80) ? { userCode: started.user_code } : {}) }
    }),
    loginStatus: (payload, context) => serial(async () => {
      owner(context); const session = loginEntry(payload)
      if (runtime.connection().generation !== session.generation) { sessions.delete(payload.loginId); fail('SUBSCRIPTION_LOGIN_EXPIRED', '订阅服务已重新启动，请重新登录。') }
      const result = await runtime.request('/v8/management/oauth/status?state=' + encodeURIComponent(session.state), { signal: context.signal })
      if (result.status === 'wait') return { status: 'pending' }
      if (result.status === 'error') { sessions.delete(payload.loginId); return { status: 'error', message: '授权未完成或已过期，请重新登录。' } }
      if (result.status !== 'ok') fail('SUBSCRIPTION_PROXY_RESPONSE', '订阅服务返回了未知授权状态。')
      await synchronize(context); sessions.delete(payload.loginId)
      return { status: 'complete', view: list(context) }
    }),
    callback: (payload, context) => serial(async () => {
      owner(context); const session = loginEntry(payload, ['loginId', 'callbackUrl'])
      if (runtime.connection().generation !== session.generation) fail('SUBSCRIPTION_LOGIN_EXPIRED', '订阅服务已重新启动，请重新登录。')
      if (session.callbackSubmitted) fail('SUBSCRIPTION_CALLBACK_SUBMITTED', '已提交授权结果，请等待登录完成。')
      let callback, expected
      try {
        if (!session.callbackUri || typeof payload.callbackUrl !== 'string' || payload.callbackUrl.length > 8192) throw Error('shape')
        callback = new URL(payload.callbackUrl.trim()); expected = new URL(session.callbackUri)
        if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.username || callback.password || callback.hash
          || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== session.state
          || callback.searchParams.getAll('code').length !== 1 || !callback.searchParams.get('code')?.trim() || callback.searchParams.has('error')) throw Error('shape')
      } catch { fail('SUBSCRIPTION_CALLBACK_INVALID', '请粘贴本次授权返回的完整地址，包含 code 和 state。') }
      // Never navigate/fetch the pasted URL. Only relay the code to the owned
      // local service, bound to its original provider, PKCE session and generation.
      const result = await runtime.request('/v8/management/oauth/callback', { method: 'POST', body: { provider: session.provider, state: session.state, code: callback.searchParams.get('code') } })
      if (result.status !== 'ok') fail('SUBSCRIPTION_PROXY_RESPONSE', '授权结果尚未接受，请重试。')
      session.callbackSubmitted = true
      return { accepted: true }
    }),
    cancelLogin: (payload, context) => serial(async () => { owner(context); const session = loginEntry(payload); await runtime.request('/v8/management/oauth/session?state=' + encodeURIComponent(session.state), { method: 'DELETE', signal: context.signal }); sessions.delete(payload.loginId); return { cancelled: true } }),
    remove: (payload, context) => serial(async () => {
      owner(context); payloadKeys(payload, ['id', 'expectedRevision']); const account = read(entryId(payload))
      if (!account) fail('SUBSCRIPTION_NOT_FOUND', '此订阅账户已退出，请刷新。')
      if (account.revision !== payload.expectedRevision) fail('SUBSCRIPTION_CONFLICT', '此账户已修改，请刷新后重试。')
      if (usedBy(account.route).length) fail('SUBSCRIPTION_IN_USE', '仍有 Bot 使用此账户，请先为这些 Bot 切换模型。')
      await runtime.request('/v8/management/credentials?name=' + encodeURIComponent(account.authName), { method: 'DELETE', signal: context.signal })
      db.prepare('DELETE FROM bot_subscription_accounts WHERE id=? AND revision=?').run(account.id, account.revision)
      syncAdapters(); await publish(); return { removed: true }
    }),
    owns: provider => owned.has(provider),
    metadata: provider => { const account = rows().find(row => row.route === provider); return account ? { name: account.name, id: account.id, enabled: usable(account), fundingModes: ['subscription'] } : null },
    routes: () => rows().filter(usable).flatMap(account => account.models.map(model => ({ provider: account.route, model: model.id }))),
    sync: syncAdapters,
    async close() { if (closed) return; clearInterval(timer); closed = true; for (const item of flights) item.controller.abort(); flights.clear(); for (const value of mounted.values()) value.release(); mounted.clear(); sessions.clear(); await runtime.close(); await queue.catch(() => {}); db.close() },
  })
}
