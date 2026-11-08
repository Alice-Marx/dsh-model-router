import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { isEngineProvider } from '../../../.dsh-plugin/shared/official-tool-registry.mjs'
import { parseModelProfilesJson } from '../../../.dsh-plugin/shared/model-profiles.mjs'

/**
 * Quick binding: a Bot runs on the model picked in its chat, the way a person
 * expects after choosing a model, without first filling in an advanced binding.
 *
 * Authority still comes only from committed Host state: the Bot's committed model,
 * the Host model catalog and this owner-saved policy. Official CLI engines are
 * funded by their own subscription login; API routes need a known price and stay
 * under this policy's per-Bot and total caps. An enabled advanced binding always
 * takes precedence, and a Bot whose binding says `quickBinding: false` gets none.
 */

export const QUICK_PROJECT_ID = 'quick-binding'
const MAX_PRICES = 200
const LIMIT = 1_000_000

export function defaultQuickBinding() {
  return { enabled: true, botDailyUsd: 5, botMonthlyUsd: 50, totalDailyUsd: 20, totalMonthlyUsd: 200,
    maxInputTokens: 128_000, maxOutputTokens: 8_192, prices: [] }
}

const fail = (code, message, field) => { throw Object.assign(new Error(message ?? code), { code, ...(field ? { details: { field } } : {}) }) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/.test(value)
const money = (value, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMIT) fail('QUICK_BINDING_INVALID', `${field} 必须是 0 至 ${LIMIT} 的数字。`, field)
  return Object.is(value, -0) ? 0 : value
}
const tokens = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000_000) fail('QUICK_BINDING_INVALID', `${field} 必须是 1 至 10000000 的整数。`, field)
  return value
}

/** Closed schema: limits and per-route prices only. No credentials, endpoints or paths. */
export function normalizeQuickBinding(input) {
  const base = defaultQuickBinding()
  if (input === null || input === undefined) return base
  if (!plain(input)) fail('QUICK_BINDING_INVALID', '快速绑定设置格式无效。')
  const allowed = Object.keys(base)
  const unknown = Object.keys(input).find(key => !allowed.includes(key))
  if (unknown) fail('QUICK_BINDING_INVALID', `快速绑定设置含有未知字段 ${unknown}。`, unknown)
  const value = { ...base, ...input }
  if (typeof value.enabled !== 'boolean') fail('QUICK_BINDING_INVALID', 'enabled 必须是布尔值。', 'enabled')
  for (const field of ['botDailyUsd', 'botMonthlyUsd', 'totalDailyUsd', 'totalMonthlyUsd']) value[field] = money(value[field], field)
  value.maxInputTokens = tokens(value.maxInputTokens, 'maxInputTokens')
  value.maxOutputTokens = tokens(value.maxOutputTokens, 'maxOutputTokens')
  if (!Array.isArray(value.prices) || value.prices.length > MAX_PRICES) fail('QUICK_BINDING_INVALID', `价格表最多 ${MAX_PRICES} 项。`, 'prices')
  const seen = new Set()
  value.prices = value.prices.map(entry => {
    if (!plain(entry) || Object.keys(entry).some(key => !['provider', 'model', 'input', 'output', 'cacheRead', 'cacheWrite'].includes(key))) {
      fail('QUICK_BINDING_INVALID', '价格项只能包含 provider、model、input、output、cacheRead、cacheWrite。', 'prices')
    }
    if (!token(entry.provider) || !token(entry.model)) fail('QUICK_BINDING_INVALID', '价格项需要模型目录中的准确 provider/model。', 'prices')
    if (isEngineProvider(entry.provider)) fail('QUICK_BINDING_INVALID', '官方工具引擎使用订阅登录，不需要填写 API 价格。', 'prices')
    const key = `${entry.provider}/${entry.model}`
    if (seen.has(key)) fail('QUICK_BINDING_INVALID', `价格表中 ${key} 重复。`, 'prices')
    seen.add(key)
    return { provider: entry.provider, model: entry.model, input: money(entry.input, 'prices.input'), output: money(entry.output, 'prices.output'),
      ...(entry.cacheRead !== undefined ? { cacheRead: money(entry.cacheRead, 'prices.cacheRead') } : {}),
      ...(entry.cacheWrite !== undefined ? { cacheWrite: money(entry.cacheWrite, 'prices.cacheWrite') } : {}) }
  }).sort((a, b) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`))
  return value
}

/** Owner-saved quick binding policy beside the other product components. */
export function openQuickBindingSettings({ Database, file, initial = null, now = Date.now }) {
  if (typeof Database !== 'function' || typeof file !== 'string' || !file) throw new TypeError('Database constructor and explicit file are required')
  if (file !== ':memory:') { file = resolve(file); mkdirSync(dirname(file), { recursive: true }) }
  const db = new Database(file)
  db.pragma('busy_timeout=5000'); db.pragma('synchronous=FULL')
  if (file !== ':memory:') db.pragma('journal_mode=WAL')
  db.exec('CREATE TABLE IF NOT EXISTS quick_binding_settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,settings TEXT NOT NULL,updated_at INTEGER NOT NULL)')
  const fallback = () => {
    try { return normalizeQuickBinding(typeof initial === 'function' ? initial() : initial) } catch { return defaultQuickBinding() }
  }
  const read = () => {
    const row = db.prepare('SELECT * FROM quick_binding_settings WHERE id=1').get()
    return row ? { revision: row.revision, settings: normalizeQuickBinding(JSON.parse(row.settings)), updatedAt: row.updated_at }
      : { revision: 0, settings: fallback(), updatedAt: null }
  }
  return Object.freeze({
    get: read,
    save(input, context) {
      if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED', '请使用已认证的宿主拥有者账号保存快速绑定设置。')
      if (!plain(input) || Object.keys(input).some(key => !['expectedRevision', 'settings'].includes(key))
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('QUICK_BINDING_INVALID', '保存请求格式无效。')
      const settings = normalizeQuickBinding(input.settings)
      return db.transaction(() => {
        const current = read()
        if (input.expectedRevision !== current.revision) fail('QUICK_BINDING_CONFLICT', '快速绑定设置已在另一窗口修改，请刷新后再保存。')
        db.prepare('INSERT INTO quick_binding_settings VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,settings=excluded.settings,updated_at=excluded.updated_at')
          .run(current.revision + 1, JSON.stringify(settings), now())
        return read()
      }).immediate()
    },
    close: () => db.close(),
  })
}

/** User-supplied prices from the router's model profiles, the same source MR routing uses. */
export function profilePrices(modelProfilesJson) {
  let profiles = []
  try { profiles = parseModelProfilesJson(typeof modelProfilesJson === 'string' ? modelProfilesJson : '[]') } catch { return new Map() }
  return new Map(profiles.filter(profile => profile.pricing).map(profile => [`${profile.provider}/${profile.model}`, { ...profile.pricing }]))
}

/** The price quick mode bills a route at: the policy's own row, else the router profile. */
export function quickPriceFor(policy, route, profiles = new Map()) {
  const key = `${route.provider}/${route.model}`
  const own = policy.prices.find(entry => `${entry.provider}/${entry.model}` === key)
  const picked = own ?? profiles.get(key)
  if (!picked || !Number.isFinite(picked.input) || !Number.isFinite(picked.output)) return null
  const price = { input: picked.input, output: picked.output }
  for (const field of ['cacheRead', 'cacheWrite']) if (Number.isFinite(picked[field])) price[field] = picked[field]
  return { pricing: price, source: own ? 'quick-binding' : 'model-profile' }
}

/**
 * The funding configuration the accounting layer admits a quick-bound call with.
 * Engine routes are subscription calls (cost 0, counted); API routes carry the
 * price and the caps, or no price so the accounting layer refuses with
 * MODEL_PRICE_REQUIRED instead of guessing.
 */
export function quickFunding(policy, route, { profiles = new Map(), contextWindow = null } = {}) {
  if (!policy?.enabled || !route?.provider || !route?.model) return null
  if (isEngineProvider(route.provider)) {
    return { funding: 'subscription', quick: true, route: { provider: route.provider, model: route.model }, scopeId: null,
      subscriptionMaxCalls: null, subscriptionMonthlyCalls: null }
  }
  const priced = quickPriceFor(policy, route, profiles)
  const window = Number.isSafeInteger(contextWindow) && contextWindow > 0 ? contextWindow : null
  return { funding: 'api', quick: true, route: { provider: route.provider, model: route.model }, scopeId: null, projectId: QUICK_PROJECT_ID,
    pricing: priced?.pricing ?? null, pricingSource: priced?.source ?? null,
    maxInputTokens: window ? Math.min(policy.maxInputTokens, window) : policy.maxInputTokens,
    maxOutputTokens: policy.maxOutputTokens,
    botDailyLimitUsd: policy.botDailyUsd, botMonthlyLimitUsd: policy.botMonthlyUsd,
    projectDailyLimitUsd: policy.totalDailyUsd, projectMonthlyLimitUsd: policy.totalMonthlyUsd }
}
