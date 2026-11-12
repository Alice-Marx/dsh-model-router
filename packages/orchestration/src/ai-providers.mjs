import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { AiProviderAdapter } from './ai-provider-adapter.mjs'
import { AI_PRESETS, AI_PROTOCOLS, aiFail, aiPlain, normalizeAiProvider, aiProviderCredentialRef, aiAbortable } from './ai-provider-config.mjs'

const owner = context => { if (context?.kind !== 'owner') aiFail('REMOTE_OWNER_REQUIRED', '请以已认证的宿主拥有者身份管理 AI 提供方。'); context.signal?.throwIfAborted() }
const identity = payload => {
  if (!aiPlain(payload) || Object.keys(payload).some(key => !['id', 'expectedRevision'].includes(key)) || !/^[a-f0-9]{32}$/.test(payload.id)) aiFail('AI_PROVIDER_INVALID', '请选择已有提供方连接。')
  return payload.id
}
const withoutSecret = profile => { const { secretRef: _ref, ...view } = profile; return view }
const decode = row => {
  try {
    const profile = JSON.parse(row.payload), health = row.health ? JSON.parse(row.health) : null
    if (!aiPlain(profile) || Object.keys(profile).some(key => !['schemaVersion', 'id', 'route', 'preset', 'name', 'protocol', 'baseUrl', 'models', 'enabled', 'auth', 'secretRef', 'updatedAt'].includes(key))
      || profile.schemaVersion !== 1 || profile.id !== row.id || !/^[a-f0-9]{32}$/.test(profile.id) || profile.route !== `bot-ai-${profile.id}` || !Number.isSafeInteger(row.revision) || row.revision < 1
      || profile.secretRef !== null && (typeof profile.secretRef !== 'string' || !new RegExp('^' + aiProviderCredentialRef(profile.id) + '_[A-F0-9]{12}$').test(profile.secretRef))
      || health !== null && (!aiPlain(health) || !['catalog', 'verified', 'cancelled', 'error'].includes(health.kind) || Object.keys(health).some(key => !['kind', 'code', 'status', 'models', 'checkedAt', 'verifiedAt'].includes(key)))) throw new Error('shape')
    const selected = normalizeAiProvider({ id: profile.id, expectedRevision: row.revision, preset: profile.preset, name: profile.name, protocol: profile.protocol,
      baseUrl: profile.baseUrl, models: profile.models, enabled: profile.enabled, auth: profile.auth }, profile)
    return { ...selected, secretRef: profile.secretRef, updatedAt: profile.updatedAt, revision: row.revision, health }
  } catch { aiFail('AI_PROVIDER_STORE_INVALID', '独立 AI 连接记录无效，请检查插件数据备份。') }
}

/** Plugin-owned configuration. Credential values only cross the Host credential seam. */
export function openAiProviders({ Database, file, llm, credentials, onChanged = async () => {}, usedBy = () => [], fetcher = globalThis.fetch, now = Date.now }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file), mounted = new Map(), flights = new Set(), ownedRoutes = new Set(), metadata = new Map()
  let closed = false, queue = Promise.resolve()
  try {
    db.pragma('busy_timeout=5000'); db.pragma('synchronous=FULL')
    if (file !== ':memory:') db.pragma('journal_mode=WAL')
    db.exec('CREATE TABLE IF NOT EXISTS bot_ai_providers(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, health TEXT)')
  } catch (error) { db.close(); throw error }
  const credentialStore = () => typeof credentials === 'function' ? credentials() : credentials
  const rows = () => { if (closed) aiFail('AI_PROVIDERS_CLOSED', 'AI 提供方服务已关闭。'); return db.prepare('SELECT * FROM bot_ai_providers ORDER BY rowid').all().map(decode) }
  const read = id => { if (closed) aiFail('AI_PROVIDERS_CLOSED', 'AI 提供方服务已关闭。'); const row = db.prepare('SELECT * FROM bot_ai_providers WHERE id=?').get(id); return row ? decode(row) : null }
  const serial = run => { const result = queue.then(run); queue = result.catch(() => {}); return result }
  const result = (profile, health) => {
    if (closed) return
    const current = read(profile.id)
    const verifiedAt = health.kind === 'verified' ? now() : health.kind === 'catalog' ? current?.health?.verifiedAt : undefined
    db.prepare('UPDATE bot_ai_providers SET health=? WHERE id=? AND revision=?').run(JSON.stringify({ ...health, ...(verifiedAt ? { verifiedAt } : {}), checkedAt: now() }), profile.id, profile.revision)
  }
  const acquire = async profile => {
    const current = read(profile.id)
    if (!current?.enabled || current.revision !== profile.revision) aiFail('AI_PROVIDER_CHANGED', '此 AI 连接已修改或停用，请重新发送。')
    const key = profile.auth === 'key' && profile.secretRef ? (await credentialStore()?.resolve(profile.secretRef))?.value : ''
    if (profile.auth === 'key' && !key) aiFail('MISSING_CREDENTIAL', '请先在 AI 提供方设置中保存此连接的 API Key。')
    if (read(profile.id)?.revision !== profile.revision) aiFail('AI_PROVIDER_CHANGED', '此 AI 连接已修改，请重新发送。')
    const controller = new AbortController(), flight = { id: profile.id, revision: profile.revision, controller }
    flights.add(flight)
    return { key, signal: controller.signal, release: () => flights.delete(flight) }
  }
  const sync = () => {
    const active = new Set()
    metadata.clear()
    for (const profile of rows()) {
      ownedRoutes.add(profile.route)
      metadata.set(profile.route, { name: profile.name, id: profile.id, preset: profile.preset, enabled: profile.enabled })
      if (!profile.enabled || !profile.models.length || profile.auth === 'key' && !profile.secretRef) continue
      active.add(profile.id)
      if (mounted.get(profile.id)?.revision === profile.revision) continue
      const adapter = new AiProviderAdapter({ profile, acquire, onResult: result, fetcher })
      mounted.get(profile.id)?.release()
      const release = llm.registerAdapter([profile.route], adapter)
      mounted.set(profile.id, { revision: profile.revision, release })
    }
    for (const [id, item] of mounted) if (!active.has(id)) { item.release(); mounted.delete(id) }
    for (const flight of flights) if (read(flight.id)?.revision !== flight.revision || !read(flight.id)?.enabled) flight.controller.abort()
  }
  const view = async profile => {
    const keyConfigured = profile.auth === 'key' && Boolean(profile.secretRef && (await credentialStore()?.describe(profile.secretRef))?.configured)
    return { ...withoutSecret(profile), keyConfigured, usedBy: usedBy(profile.route),
      state: !profile.enabled ? 'disabled' : profile.auth === 'key' && !keyConfigured ? 'needs-key' : !profile.models.length ? 'needs-models'
        : profile.health?.verifiedAt && profile.health.kind !== 'error' ? 'ready' : profile.health?.kind === 'error' ? 'needs-attention' : 'configured' }
  }
  const presetModels = async preset => {
    if (!preset?.catalog) return []
    const { getBuiltinModels } = await import('@earendil-works/pi-ai/providers/all')
    return getBuiltinModels(preset.catalog).filter(model => model.type === undefined || model.type === 'chat').slice(0, 100)
      .map(model => ({ id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: Math.min(model.maxTokens, Math.floor(model.contextWindow / 2)), reasoning: model.reasoning }))
  }
  const list = async context => {
    owner(context); sync()
    return { schemaVersion: 1, scope: 'plugin', providers: await Promise.all(rows().map(view)), presets: AI_PRESETS, protocols: AI_PROTOCOLS }
  }
  const save = (input, context) => serial(async () => {
    owner(context)
    const current = input?.id ? read(input.id) : null
    const selected = normalizeAiProvider(input, current)
    if ((current?.revision ?? 0) !== input.expectedRevision) aiFail('AI_PROVIDER_CONFLICT', '连接已在其他窗口修改，请刷新后重试。')
    if (!current && rows().length >= 64) aiFail('AI_PROVIDER_LIMIT', '独立提供方连接最多64个。')
    if (rows().filter(row => row.id !== selected.id).reduce((total, row) => total + row.models.length, selected.models.length) > 4096) aiFail('AI_PROVIDER_MODEL_LIMIT', '独立连接的模型总数最多4096个，请先移除不使用的模型。')
    const store = credentialStore()
    let secretRef = input.clearApiKey ? null : current?.secretRef ?? null, written = null
    if (input.apiKey) {
      if (!store?.set || !store?.resolve || !store?.unset) aiFail('AI_PROVIDER_CREDENTIAL_STORE_UNAVAILABLE', '当前宿主未提供可写凭据存储。')
      written = `${aiProviderCredentialRef(selected.id)}_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
      await store.set(written, input.apiKey); secretRef = written
    }
    const profile = { ...selected, schemaVersion: 1, secretRef, updatedAt: now() }
    try {
      context.signal?.throwIfAborted()
      db.transaction(() => {
        if ((read(selected.id)?.revision ?? 0) !== input.expectedRevision) aiFail('AI_PROVIDER_CONFLICT', '连接已在其他窗口修改，请刷新后重试。')
        db.prepare('INSERT INTO bot_ai_providers(id,revision,payload,health) VALUES(?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,health=NULL')
          .run(selected.id, input.expectedRevision + 1, JSON.stringify(profile))
      }).immediate()
    } catch (error) { if (written) await store.unset(written).catch(() => {}); throw error }
    sync(); await onChanged()
    if (current?.secretRef && current.secretRef !== secretRef) await store?.unset(current.secretRef).catch(() => {})
    return view(read(selected.id))
  })
  const remove = (payload, context) => serial(async () => {
    owner(context); const id = identity(payload), current = read(id)
    if (!current) aiFail('AI_PROVIDER_NOT_FOUND', '此连接已删除。')
    if (usedBy(current.route).length) aiFail('AI_PROVIDER_IN_USE', '仍有 Bot 使用此连接，请先切换这些 Bot 的模型。')
    if (payload.expectedRevision !== current.revision) aiFail('AI_PROVIDER_CONFLICT', '连接已在其他窗口修改，请刷新后重试。')
    db.transaction(() => { const outcome = db.prepare('DELETE FROM bot_ai_providers WHERE id=? AND revision=?').run(id, payload.expectedRevision); if (!outcome.changes) aiFail('AI_PROVIDER_CONFLICT', '连接已修改，请刷新。') }).immediate()
    sync(); await onChanged(); if (current.secretRef) await credentialStore()?.unset(current.secretRef).catch(() => {})
    return { removed: true, id }
  })
  const probe = async (payload, context) => {
    owner(context); const id = identity(payload), profile = read(id)
    if (!profile) aiFail('AI_PROVIDER_NOT_FOUND', '此连接已删除。')
    const lease = await acquire(profile), signal = AbortSignal.any([lease.signal, AbortSignal.timeout(10_000), ...(context.signal ? [context.signal] : [])])
    let health
    try {
      let url = profile.baseUrl
      if (profile.protocol === 'anthropic-messages') url += url.endsWith('/v1') ? '/models' : '/v1/models'
      else if (profile.protocol === 'google-generative-ai') url = url.replace(/\/v1(?:beta)?$/, '') + '/v1beta/models'
      else url += '/models'
      const headers = !lease.key ? {} : profile.protocol === 'anthropic-messages' ? { 'x-api-key': lease.key, 'anthropic-version': '2023-06-01' }
        : profile.protocol === 'google-generative-ai' ? { 'x-goog-api-key': lease.key } : { authorization: `Bearer ${lease.key}` }
      const bounded = operation => aiAbortable(operation, signal)
      const response = await bounded(() => fetcher(url, { headers, signal, redirect: 'error' }))
      if (!response.ok) { void response.body?.cancel().catch(() => {}); health = { kind: 'error', code: [401, 403].includes(response.status) ? 'AUTH' : 'HTTP_ERROR', status: response.status } }
      else {
        const reader = response.body?.getReader(), chunks = []; let size = 0
        if (!reader) throw new Error('empty')
        try { for (;;) { const item = await bounded(() => reader.read()); if (item.done) break; size += item.value.length; if (size > 2_000_000) throw new Error('large'); chunks.push(item.value) } } finally { void reader.cancel().catch(() => {}) }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const entries = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : null
        if (!entries) throw new Error('shape')
        health = { kind: 'catalog', status: response.status, models: entries.map(item => ({ id: String(item.id ?? item.name ?? '').replace(/^models\//, '') })).filter(item => /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(item.id) && (!lease.key || !item.id.includes(lease.key))).slice(0, 500) }
      }
    } catch { context.signal?.throwIfAborted(); health = { kind: 'error', code: signal.aborted ? 'TIMEOUT' : 'UNREACHABLE' } }
    finally { lease.release() }
    if (read(id)?.revision !== profile.revision) aiFail('AI_PROVIDER_CHANGED', '检查期间连接已修改，请重新检查。')
    result(profile, health); return view(read(id))
  }
  sync()
  return Object.freeze({ list, save, remove, probe, sync, acquire,
    owns: route => ownedRoutes.has(route),
    routes: () => rows().filter(profile => profile.enabled && (profile.auth === 'none' || profile.secretRef)).flatMap(profile => profile.models.map(model => ({ provider: profile.route, model: model.id }))),
    metadata: route => metadata.get(route) ?? null,
    async suggestions(payload, context) { owner(context); const preset = AI_PRESETS.find(item => item.id === payload?.preset); if (!preset || Object.keys(payload).some(key => key !== 'preset')) aiFail('AI_PROVIDER_INVALID', '请选择提供方。'); return { preset: preset.id, models: await presetModels(preset) } },
    close() { if (closed) return; closed = true; for (const flight of flights) flight.controller.abort(); flights.clear(); for (const entry of mounted.values()) entry.release(); mounted.clear(); db.close() },
  })
}
