import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { OFFICIAL_TOOLS } from '../../../.dsh-plugin/shared/official-tool-registry.mjs'

export const BOT_SETTINGS_SCHEMA = 1
export const BOT_EXECUTION_MODES = Object.freeze(['read-only', 'workspace-write', 'cli-native'])
const EMPTY_GRANT = Object.freeze({ tools: Object.freeze([]), modelRoutes: Object.freeze([]) })
const registry = new Map(OFFICIAL_TOOLS.map(tool => [tool.id, tool]))
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/.test(value)
const clone = value => structuredClone(value)
const fail = (code, message, details = {}) => { throw Object.assign(new Error(message), { code, details }) }
const keys = (value, allowed, path) => {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('BOT_SETTINGS_INVALID', `${path} 含有未知字段或格式无效。`, { field: path })
}
const list = (value, limit, path) => {
  if (!Array.isArray(value) || value.length > limit) fail('BOT_SETTINGS_INVALID', `${path} 列表格式无效或超过 ${limit} 项。`, { field: path })
  return value
}
const unique = (values, path) => { if (new Set(values).size !== values.length) fail('BOT_SETTINGS_DUPLICATE', `${path} 含有重复项。`, { field: path }) }
const count = (value, path) => { if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) fail('BOT_SETTINGS_INVALID', `${path} 必须是 0 至 1000000000 的整数。`, { field: path }); return value }
const amount = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) fail('BOT_SETTINGS_INVALID', `${path} 必须是非负有限数字。`, { field: path }); return Object.is(value, -0) ? 0 : value }
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED', '请使用已认证的宿主拥有者账号保存 Bot 绑定。') }
const sync = (value, name) => { if (value && typeof value.then === 'function') fail('BOT_SETTINGS_SYNC_REQUIRED', `${name} 必须同步返回，以免提交后仍保留旧授权。`); return value }
const hash = text => createHash('sha256').update(text).digest('hex')
const json = value => { const text = JSON.stringify(value); if (Buffer.byteLength(text) > 64 * 1024) fail('BOT_SETTINGS_LIMIT', '单个 Bot 绑定不能超过 64 KiB。'); return text }
const routeRef = value => `${value.provider}/${value.model}`

export function defaultBotSettings() {
  return { schemaVersion: 1, enabled: false, model: null, officialTools: [], machineGrants: [], capabilities: [], workspaceRef: null,
    funding: { mode: 'api', scopeId: null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null }, maxConcurrentTasks: 1 }
}

/** Closed stored schema. No executable paths, installer URLs, credentials or arbitrary roots. */
export function normalizeBotSettings(input) {
  keys(input, ['schemaVersion', 'enabled', 'model', 'officialTools', 'machineGrants', 'capabilities', 'workspaceRef', 'funding', 'maxConcurrentTasks'], 'settings')
  const value = { ...defaultBotSettings(), ...input }
  if (value.schemaVersion !== 1) fail('BOT_SETTINGS_VERSION_UNSUPPORTED', 'Bot 绑定版本不受支持，请升级宿主。')
  if (typeof value.enabled !== 'boolean') fail('BOT_SETTINGS_INVALID', 'enabled 必须是布尔值。', { field: 'enabled' })
  if (value.model !== null) {
    keys(value.model, ['provider', 'model'], 'model')
    if (!token(value.model.provider) || !token(value.model.model)) fail('BOT_SETTINGS_INVALID', '请选择目录中的准确 provider/model。', { field: 'model' })
    value.model = { provider: value.model.provider, model: value.model.model }
  }
  value.officialTools = list(value.officialTools, 12, 'officialTools').map(tool => {
    keys(tool, ['toolId', 'cliModel', 'mode'], 'officialTools')
    if (!registry.has(tool.toolId)) fail('BOT_SETTINGS_UNKNOWN_TOOL', '官方工具必须来自 MR 固定注册表。', { field: 'officialTools' })
    if (!token(tool.cliModel) || !BOT_EXECUTION_MODES.includes(tool.mode)) fail('BOT_SETTINGS_INVALID', '请选择已核验的 CLI 模型和执行模式。', { field: 'officialTools' })
    return { toolId: tool.toolId, cliModel: tool.cliModel, mode: tool.mode }
  }).sort((a, b) => a.toolId.localeCompare(b.toolId))
  unique(value.officialTools.map(tool => tool.toolId), 'officialTools')
  value.machineGrants = list(value.machineGrants, 64, 'machineGrants').map(grant => {
    keys(grant, ['machineId', 'rootId', 'capabilities', 'mode'], 'machineGrants')
    if (!ref(grant.machineId) || !ref(grant.rootId) || !['read-only', 'workspace-write'].includes(grant.mode)) fail('BOT_SETTINGS_INVALID', '机器授权必须引用已登记 machineId/rootId 和固定读写模式。', { field: 'machineGrants' })
    const capabilities = list(grant.capabilities, 64, 'machineGrants.capabilities')
    if (capabilities.some(id => !token(id))) fail('BOT_SETTINGS_INVALID', '机器能力 ID 无效。', { field: 'machineGrants.capabilities' })
    unique(capabilities, 'machineGrants.capabilities')
    return { machineId: grant.machineId, rootId: grant.rootId, mode: grant.mode, capabilities: [...capabilities].sort() }
  }).sort((a, b) => `${a.machineId}/${a.rootId}`.localeCompare(`${b.machineId}/${b.rootId}`))
  unique(value.machineGrants.map(grant => `${grant.machineId}/${grant.rootId}`), 'machineGrants')
  value.capabilities = [...list(value.capabilities, 128, 'capabilities')].sort()
  if (value.capabilities.some(id => !token(id))) fail('BOT_SETTINGS_INVALID', '能力 ID 无效。', { field: 'capabilities' })
  unique(value.capabilities, 'capabilities')
  if (value.workspaceRef !== null) {
    keys(value.workspaceRef, ['kind', 'machineId', 'rootId'], 'workspaceRef')
    if (!['local', 'remote'].includes(value.workspaceRef.kind) || !ref(value.workspaceRef.machineId) || !ref(value.workspaceRef.rootId)) fail('BOT_SETTINGS_INVALID', '工作区必须引用已登记机器和根目录。', { field: 'workspaceRef' })
    value.workspaceRef = { kind: value.workspaceRef.kind, machineId: value.workspaceRef.machineId, rootId: value.workspaceRef.rootId }
  }
  keys(value.funding, ['mode', 'scopeId', 'pricing', 'request', 'dailyBudgetUsd', 'monthlyBudgetUsd', 'subscription'], 'funding')
  const funding = { ...defaultBotSettings().funding, ...value.funding }
  if (!['api', 'subscription'].includes(funding.mode) || (funding.scopeId !== null && !ref(funding.scopeId))) fail('BOT_SETTINGS_INVALID', '请选择目录中的 API 或订阅资金范围。', { field: 'funding' })
  if (funding.pricing !== null) {
    keys(funding.pricing, ['input', 'output', 'cacheRead', 'cacheWrite'], 'funding.pricing')
    funding.pricing = Object.fromEntries(Object.entries(funding.pricing).map(([key, price]) => [key, amount(price, `funding.pricing.${key}`)]))
    if (funding.pricing.input === undefined || funding.pricing.output === undefined) fail('BOT_SETTINGS_INVALID', 'API 价格需要输入和输出单价。', { field: 'funding.pricing' })
  }
  if(funding.request!==null){
    keys(funding.request,['maxInputTokens','maxOutputTokens'],'funding.request')
    funding.request={maxInputTokens:count(funding.request.maxInputTokens,'funding.request.maxInputTokens'),maxOutputTokens:count(funding.request.maxOutputTokens,'funding.request.maxOutputTokens')}
    if(!funding.request.maxInputTokens||!funding.request.maxOutputTokens)fail('BOT_SETTINGS_INVALID','请求输入与输出上界必须大于0。',{field:'funding.request'})
  }
  for (const key of ['dailyBudgetUsd', 'monthlyBudgetUsd']) if (funding[key] !== null) funding[key] = amount(funding[key], `funding.${key}`)
  if (funding.subscription !== null) {
    keys(funding.subscription, ['dailyCalls', 'monthlyCalls'], 'funding.subscription')
    funding.subscription = { dailyCalls: count(funding.subscription.dailyCalls, 'funding.subscription.dailyCalls'), monthlyCalls: count(funding.subscription.monthlyCalls, 'funding.subscription.monthlyCalls') }
  }
  if (funding.mode === 'api' && funding.subscription !== null) fail('BOT_SETTINGS_INVALID', 'API 资金不能携带订阅次数；不会隐式切换执行渠道。', { field: 'funding.subscription' })
  value.funding = funding
  if (!Number.isSafeInteger(value.maxConcurrentTasks) || value.maxConcurrentTasks < 1 || value.maxConcurrentTasks > 32) fail('BOT_SETTINGS_INVALID', '最大并发任务数必须为 1 至 32。', { field: 'maxConcurrentTasks' })
  json(value)
  return clone(value)
}

function catalogOf(input) {
  if (!plain(input)) fail('BOT_SETTINGS_CATALOG_UNAVAILABLE', '宿主尚未提供可信模型、机器和资金目录。')
  const models = list(input.models ?? [], 4096, 'catalog.models').map(item => {
    if (!token(item.provider) || !token(item.model)) fail('BOT_SETTINGS_CATALOG_INVALID', '宿主模型目录无效。')
    return { provider: item.provider, model: item.model, label: String(item.label ?? item.model).slice(0, 256),
      cliModels: (item.cliModels ?? []).filter(mapping => registry.has(mapping.toolId) && token(mapping.model)).map(mapping => ({ toolId: mapping.toolId, model: mapping.model })) }
  })
  unique(models.map(routeRef), 'catalog.models')
  const capabilities = list(input.capabilities ?? [], 256, 'catalog.capabilities').map(item => {
    if (!token(item.id) || !Array.isArray(item.tools) || item.tools.some(name => !token(name))) fail('BOT_SETTINGS_CATALOG_INVALID', '宿主能力目录无效。')
    return { id: item.id, label: String(item.label ?? item.id).slice(0, 256), tools: [...new Set(item.tools)].sort() }
  })
  unique(capabilities.map(item => item.id), 'catalog.capabilities')
  const tools = OFFICIAL_TOOLS.map(tool => {
    const configured = (input.tools ?? []).find(item => item.toolId === tool.id)
    return { toolId: tool.id, label: tool.label, vendor: tool.vendor,
      source: ['opencode', 'pi', 'hermes'].includes(tool.id) ? '开源第三方工具' : tool.id === 'zcode' ? '社区发行版' : '厂商官方 CLI',
      modes: (configured?.modes ?? []).filter(mode => BOT_EXECUTION_MODES.includes(mode)), grantTools: [...new Set(configured?.grantTools ?? [])].filter(token).sort() }
  })
  const machines = list(input.machines ?? [], 1024, 'catalog.machines').map(machine => {
    if (!ref(machine.machineId) || !['local', 'remote'].includes(machine.location)) fail('BOT_SETTINGS_CATALOG_INVALID', '宿主机器目录无效。')
    const roots = list(machine.roots ?? [], 256, 'catalog.roots').map(root => {
      if (!ref(root.rootId)) fail('BOT_SETTINGS_CATALOG_INVALID', '宿主根目录 ID 无效。')
      return { rootId: root.rootId, label: String(root.label ?? root.rootId).slice(0, 256), modes: (root.modes ?? []).filter(mode => ['read-only', 'workspace-write'].includes(mode)),
        capabilities: (root.capabilities ?? []).filter(id => capabilities.some(capability => capability.id === id)) }
    })
    unique(roots.map(root => root.rootId), 'catalog.roots')
    return { machineId: machine.machineId, label: String(machine.label ?? machine.machineId).slice(0, 256), location: machine.location, status: String(machine.status ?? 'unknown'), roots }
  })
  unique(machines.map(machine => machine.machineId), 'catalog.machines')
  const fundingScopes = list(input.fundingScopes ?? [], 256, 'catalog.fundingScopes').map(scope => {
    if (!ref(scope.id)) fail('BOT_SETTINGS_CATALOG_INVALID', '宿主资金范围无效。')
    return { id: scope.id, label: String(scope.label ?? scope.id).slice(0, 256), modes: (scope.modes ?? []).filter(mode => ['api', 'subscription'].includes(mode)),
      ...(scope.models ? { models: scope.models.map(model => ({ provider: model.provider, model: model.model })) } : {}) }
  })
  unique(fundingScopes.map(scope => scope.id), 'catalog.fundingScopes')
  return { models, tools, machines, capabilities, fundingScopes }
}

/** Validate scope against host-owned exact catalog entries; never infer vendor from a name. */
export function validateBotSettings(input, catalogInput) {
  const settings = normalizeBotSettings(input), catalog = catalogOf(catalogInput)
  const denied = (message, field) => fail('BOT_SETTINGS_SCOPE_DENIED', message, { field })
  const model = settings.model && catalog.models.find(item => routeRef(item) === routeRef(settings.model))
  if (settings.model && !model) denied('此准确模型已不在宿主目录，请刷新后重新选择。', 'model')
  for (const tool of settings.officialTools) {
    const entry = catalog.tools.find(item => item.toolId === tool.toolId)
    if (!entry?.modes.includes(tool.mode)) denied(`${tool.toolId} 尚未获准使用该执行模式。`, 'officialTools')
    if (!model?.cliModels.some(item => item.toolId === tool.toolId && item.model === tool.cliModel)) denied(`${tool.toolId} 与当前模型的 CLI 身份尚未核验。`, 'officialTools')
  }
  for (const grant of settings.machineGrants) {
    const root = catalog.machines.find(item => item.machineId === grant.machineId)?.roots.find(item => item.rootId === grant.rootId)
    if (!root || !root.modes.includes(grant.mode) || grant.capabilities.some(id => !root.capabilities.includes(id))) denied('机器、根目录、能力或读写模式已撤回，请刷新后重新选择。', 'machineGrants')
  }
  if (settings.capabilities.some(id => !catalog.capabilities.some(item => item.id === id))) denied('所选能力已不在宿主目录。', 'capabilities')
  if (settings.workspaceRef) {
    const workspace = settings.workspaceRef, machine = catalog.machines.find(item => item.machineId === workspace.machineId)
    if (!machine || machine.location !== workspace.kind || !settings.machineGrants.some(grant => grant.machineId === workspace.machineId && grant.rootId === workspace.rootId)) denied('工作区必须对应同一机器上的有效根目录授权。', 'workspaceRef')
  }
  const funding = settings.funding
  if (funding.scopeId !== null) {
    const scope = catalog.fundingScopes.find(item => item.id === funding.scopeId)
    if (!scope?.modes.includes(funding.mode) || (scope.models && !scope.models.some(route => settings.model && routeRef(route) === routeRef(settings.model)))) denied('资金范围或准确模型不匹配，请重新选择。', 'funding.scopeId')
  }
  if (settings.enabled) {
    if (!settings.model || !settings.workspaceRef || !funding.scopeId) fail('BOT_SETTINGS_INCOMPLETE', '启用前请选择准确模型、有效工作区和资金范围。')
    if (funding.mode === 'api' && (funding.pricing === null || funding.request===null || funding.dailyBudgetUsd === null || funding.monthlyBudgetUsd === null)) fail('BOT_SETTINGS_INCOMPLETE', '启用 API 前请填写价格、请求上界、每日及每月预算；0 表示禁止付费，空值表示尚未配置。')
    if (funding.mode === 'subscription' && funding.subscription === null) fail('BOT_SETTINGS_INCOMPLETE', '启用订阅前请填写每日和每月调用次数；不会自动回退 API。')
  }
  return { settings, catalog }
}

function compiledGrant(settings, catalog) {
  if (!settings.enabled) return clone(EMPTY_GRANT)
  const selected = new Set([...settings.capabilities, ...settings.machineGrants.flatMap(grant => grant.capabilities)])
  const tools = [...catalog.capabilities.filter(item => selected.has(item.id)).flatMap(item => item.tools),
    ...settings.officialTools.flatMap(tool => catalog.tools.find(item => item.toolId === tool.toolId)?.grantTools ?? [])]
  return { tools: [...new Set(tools)].sort(), modelRoutes: [{ ...settings.model }] }
}

/** Isolated component tables, safe to colocate with other SQLite components. */
export function openBotSettings({ Database, file, catalogFor = () => ({}), botExists = () => false, onCommitted = () => {}, onSuspended = () => {}, now = Date.now }) {
  if (typeof Database !== 'function' || typeof file !== 'string' || !file) throw new TypeError('Database constructor and explicit file are required')
  for (const [name, callback] of Object.entries({ catalogFor, botExists, onCommitted, onSuspended })) if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`)
  if (file !== ':memory:') { file = resolve(file); mkdirSync(dirname(file), { recursive: true }) }
  const db = new Database(file)
  try {
    db.pragma('busy_timeout=5000'); db.pragma('foreign_keys=ON'); db.pragma('synchronous=FULL')
    if (file !== ':memory:' && db.pragma('journal_mode=WAL', { simple: true }) !== 'wal') fail('BOT_SETTINGS_WAL_REQUIRED', 'Bot 绑定库需要 WAL 支持。')
    db.exec('CREATE TABLE IF NOT EXISTS bot_settings_component(component TEXT PRIMARY KEY,schema_version INTEGER NOT NULL)')
    const schema = db.prepare('SELECT schema_version FROM bot_settings_component WHERE component=?').get('bot-settings')
    if (schema && schema.schema_version !== 1) fail('BOT_SETTINGS_VERSION_UNSUPPORTED', 'Bot 绑定库版本不受支持，未覆盖数据。')
    db.exec(`CREATE TABLE IF NOT EXISTS bot_settings_records(bot_id TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>0),schema_version INTEGER NOT NULL,settings_json TEXT NOT NULL,updated_ms INTEGER NOT NULL,retired INTEGER NOT NULL DEFAULT 0,migration_json TEXT);
      CREATE TABLE IF NOT EXISTS bot_settings_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,bot_id TEXT NOT NULL,revision INTEGER NOT NULL,kind TEXT NOT NULL,at_ms INTEGER NOT NULL,settings_hash TEXT NOT NULL);`)
    if (!schema) db.prepare('INSERT INTO bot_settings_component VALUES(?,1)').run('bot-settings')
  } catch (error) { db.close(); throw error }
  const cache = new Map(), published = new Map(), suspended = new Set()
  let closed = false
  const alive = () => { if (closed) fail('BOT_SETTINGS_CLOSED', 'Bot 绑定库已关闭。') }
  const botIdOf = value => { if (!ref(value)) fail('BOT_SETTINGS_INVALID', 'Bot ID 无效。'); return value }
  const load = botId => {
    alive(); botIdOf(botId)
    const row = db.prepare('SELECT * FROM bot_settings_records WHERE bot_id=?').get(botId)
    if (!row) { cache.delete(botId); return { botId, revision: 0, settings: defaultBotSettings(), updatedAt: null, retired: false, migration: null } }
    if (row.schema_version !== 1) fail('BOT_SETTINGS_VERSION_UNSUPPORTED', '此 Bot 的绑定记录版本不受支持。')
    if (Buffer.byteLength(row.settings_json) > 64 * 1024) fail('BOT_SETTINGS_CORRUPT', 'Bot 绑定记录超过大小限制。')
    const record = { botId, revision: row.revision, settings: normalizeBotSettings(JSON.parse(row.settings_json)), updatedAt: row.updated_ms, retired: Boolean(row.retired), migration: row.migration_json ? JSON.parse(row.migration_json) : null }
    cache.set(botId, record); return record
  }
  const evaluate = record => {
    try {
      if (record.retired) fail('BOT_SETTINGS_RETIRED', '此 Bot 已退休，身份不能复用。')
      if (!sync(botExists(record.botId), 'botExists')) fail('BOT_SETTINGS_UNKNOWN_BOT', '此 Bot 不在已提交的宿主目录。')
      if (suspended.has(record.botId)) fail('BOT_SETTINGS_SUSPENDED', '授权同步失败，此 Bot 已暂停。请修复宿主授权回调后刷新。')
      let settings=normalizeBotSettings(record.settings),catalog
      if(settings.enabled)({settings,catalog}=validateBotSettings(settings,sync(catalogFor(record.botId),'catalogFor')))
      else{try{catalog=catalogOf(sync(catalogFor(record.botId),'catalogFor'))}catch{catalog={models:[],tools:[],machines:[],capabilities:[],fundingScopes:[]}}}
      const grant = compiledGrant(settings, catalog)
      return { ...record, settings, catalog, grant, status: settings.enabled ? 'available' : 'blocked',
        ...(!settings.enabled ? { blockedReason: record.revision ? '此 Bot 的执行绑定已停用。' : '此 Bot 尚未配置执行绑定。', nextAction: '选择目录中的模型、工作区及资金范围，确认后启用。' } : {}) }
    } catch (error) {
      let catalog
      try { catalog = catalogOf(sync(catalogFor(record.botId), 'catalogFor')) } catch { catalog = { models: [], tools: [], machines: [], capabilities: [], fundingScopes: [] } }
      return { ...record, catalog, grant: clone(EMPTY_GRANT), status: 'blocked', blockedReason: error.message, errorCode: error.code ?? 'BOT_SETTINGS_CORRUPT', nextAction: '刷新目录、修复配置或保持停用；未恢复前不会授予执行权限。' }
    }
  }
  const publish = (value, kind) => {
    const stamp = json({ revision: value.revision, status: value.status, grant: value.grant, errorCode: value.errorCode, blockedReason: value.blockedReason, catalogHash:hash(JSON.stringify(value.catalog)) })
    if (published.get(value.botId) === stamp) return
    try {
      sync(onCommitted(clone({ ...value, kind })), 'onCommitted')
      published.set(value.botId, stamp)
    } catch (error) {
      suspended.add(value.botId); published.delete(value.botId)
      try { sync(onSuspended({ botId: value.botId, revision: value.revision, grant: clone(EMPTY_GRANT), reason: error.message }), 'onSuspended') }
      catch (failure) { throw Object.assign(new Error('Bot 绑定已提交，但授权同步与暂停回调均失败；宿主必须停止此 Bot。'), { code: 'BOT_SETTINGS_HOST_SUSPENSION_REQUIRED', committed: true, cause: failure }) }
      throw Object.assign(new Error('Bot 绑定已提交，但授权同步失败；此 Bot 已暂停，请修复宿主回调后刷新。'), { code: 'BOT_SETTINGS_PUBLISH_FAILED', committed: true, revision: value.revision, cause: error })
    }
  }
  const get = (botId, { publishChange = true } = {}) => {
    const value = evaluate(load(botId))
    if (publishChange) publish(value, 'observed')
    return clone(value)
  }
  const commit = (botId, expectedRevision, settings, { kind = 'saved', retired = false, migration = null } = {}) => {
    const text = json(settings), updatedAt = now()
    const work = db.transaction(() => {
      const old = db.prepare('SELECT revision,retired FROM bot_settings_records WHERE bot_id=?').get(botId)
      const current = old?.revision ?? 0
      if (old?.retired) fail('BOT_SETTINGS_RETIRED', '此 Bot 已退休，不能重新授予权限。')
      if (current !== expectedRevision) fail('BOT_SETTINGS_CONFLICT', '绑定已在另一窗口修改。请刷新并检查最新配置，再重新提交。', { expectedRevision, currentRevision: current })
      // Revalidate a fresh trusted catalog inside the same synchronous admission.
      if(settings.enabled)validateBotSettings(settings, sync(catalogFor(botId), 'catalogFor'))
      const revision = current + 1
      db.prepare('INSERT INTO bot_settings_records VALUES(?,?,?,?,?,?,?) ON CONFLICT(bot_id) DO UPDATE SET revision=excluded.revision,schema_version=excluded.schema_version,settings_json=excluded.settings_json,updated_ms=excluded.updated_ms,retired=excluded.retired,migration_json=excluded.migration_json')
        .run(botId, revision, 1, text, updatedAt, retired ? 1 : 0, migration ? json(migration) : null)
      db.prepare('INSERT INTO bot_settings_events(bot_id,revision,kind,at_ms,settings_hash) VALUES(?,?,?,?,?)').run(botId, revision, kind, updatedAt, hash(text))
    })
    work.immediate()
    suspended.delete(botId)
    const value = evaluate(load(botId)); publish(value, kind); return clone(value)
  }
  const store = {
    schemaVersion: 1, file,
    get,
    cached(botId) { alive(); return cache.has(botId) ? clone(cache.get(botId)) : null },
    grantFor(bot) {
      try {
        // Lifecycle compilation can precede its DS save. It must remain pure;
        // only the later committed lifecycle or an explicit settings commit may publish grants.
        const value = get(bot.id,{publishChange:false})
        if (value.status !== 'available' || bot.model !== routeRef(value.settings.model)) return clone(EMPTY_GRANT)
        return clone(value.grant)
      } catch { return clone(EMPTY_GRANT) }
    },
    async save(request, context) {
      owner(context); alive()
      keys(request, ['botId', 'expectedRevision', 'settings'], 'binding.save')
      const botId = botIdOf(request.botId)
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) fail('BOT_SETTINGS_INVALID', 'expectedRevision 必须是当前绑定修订号。')
      if (!sync(botExists(botId), 'botExists')) fail('BOT_SETTINGS_UNKNOWN_BOT', '此 Bot 不在已提交的宿主目录。')
      const normalized=normalizeBotSettings(request.settings)
      const settings=normalized.enabled?validateBotSettings(normalized,sync(catalogFor(botId),'catalogFor')).settings:normalized
      return commit(botId, request.expectedRevision, settings)
    },
    refresh() {
      alive(); const ids = db.prepare('SELECT bot_id FROM bot_settings_records ORDER BY bot_id').all().map(row => row.bot_id)
      return ids.map(botId => { suspended.delete(botId); return get(botId) })
    },
    readModel(bots) {
      alive(); const items = bots.map(bot => { const value = get(bot.id); return { ...value, model: value.settings.model, officialTools: value.settings.officialTools,
        machineGrants: value.settings.machineGrants, workspaceRef: value.settings.workspaceRef, capabilities: value.settings.capabilities,
        tools: value.grant.tools, budgetScope: value.settings.funding.scopeId, maxConcurrentTasks: value.settings.maxConcurrentTasks } })
      return { status: 'available', items }
    },
    assertScope(botId, input) {
      keys(input, ['toolId', 'cliModel', 'machineId', 'rootId', 'capability', 'mode', 'provider', 'model', 'funding'], 'scope')
      const value = get(botId)
      if (value.status !== 'available') fail('BOT_SETTINGS_SCOPE_DENIED', value.blockedReason ?? 'Bot 绑定未启用。')
      const settings = value.settings
      if (input.provider !== settings.model.provider || input.model !== settings.model.model || input.funding !== settings.funding.mode) fail('BOT_SETTINGS_SCOPE_DENIED', '准确模型或资金渠道与 Bot 绑定不同。')
      if (input.toolId && !settings.officialTools.some(tool => tool.toolId === input.toolId && tool.cliModel === input.cliModel && tool.mode === input.mode)) fail('BOT_SETTINGS_SCOPE_DENIED', '该工具、CLI 模型或执行模式未授予此 Bot。')
      if (!settings.machineGrants.some(grant => grant.machineId === input.machineId && grant.rootId === input.rootId && grant.mode === input.mode && grant.capabilities.includes(input.capability))) fail('BOT_SETTINGS_SCOPE_DENIED', '机器、根目录、能力或模式越出此 Bot 授权。')
      return { botId, revision: value.revision, settings: clone(settings) }
    },
    async migrateLegacyBots(bots, context) {
      owner(context); alive(); const result = { created: [], existing: [] }
      for (const bot of bots) {
        const botId = botIdOf(bot.id)
        if (!sync(botExists(botId), 'botExists')) fail('BOT_SETTINGS_UNKNOWN_BOT', '迁移 Bot 必须来自已提交的宿主目录。')
        if (load(botId).revision) { result.existing.push(botId); continue }
        const settings = defaultBotSettings(), warnings = []
        const catalog = catalogOf(sync(catalogFor(botId), 'catalogFor'))
        const known = catalog.models.find(model => routeRef(model) === bot.model)
        if (known) settings.model = { provider: known.provider, model: known.model }
        else if (bot.model) warnings.push('原准确模型尚未出现在可信目录，未自动授权。')
        if (bot.workDir) warnings.push('原工作目录需映射到已登记 machineId/rootId，未保存任意路径或自动授权。')
        commit(botId, 0, settings, { kind: 'legacy-migrated', migration: { source: 'ds-bot-frozen-v1', warnings } })
        result.created.push(botId)
      }
      return result
    },
    async retire(botId, expectedRevision, context) {
      owner(context); const value = load(botId)
      return commit(botId, expectedRevision, { ...value.settings, enabled: false }, { kind: 'retired', retired: true, migration: value.migration })
    },
    close() { if (!closed) { closed = true; cache.clear(); published.clear(); db.close() } },
  }
  // Hydrate committed settings synchronously; granting remains an explicit host callback.
  for (const row of db.prepare('SELECT bot_id FROM bot_settings_records').all()) load(row.bot_id)
  return Object.freeze(store)
}
