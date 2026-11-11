/**
 * Main Bot per-exact-route execution/funding profiles.
 *
 * A pure, I/O-free helper that lives beside the closed `bot_settings` schema.
 * It stores an optional `settings.mainRoutes` collection (schema version 1) in
 * the same `bot_settings_records` revision, coexisting with the existing
 * default-model binding. It never builds a second funding, price or receipt
 * ledger, never opens SQLite and never invents a catalog: every amount, token
 * bound, mode and cross-channel rule is delegated to the Host's own legacy
 * funding normalizer, which the parent injects so the old rules are not copied
 * into a second place.
 *
 * Roles, accounts, credentials, endpoints and paths are never read here. The
 * Host commits the Main role, the exact model existence, the funding scope and
 * the price facts; this helper only normalizes the declared shape, assembles a
 * complete legacy funding record from a profile plus the unified global limits,
 * and refuses anything it cannot prove.
 */

const MAIN_ROUTES_SCHEMA = 1
const MAX_ROUTES = 64
const MAX_BYTES = 64 * 1024

// Legacy shapes, mirrored so this module stays free of a bot-settings import
// (and therefore free of the circular dependency the closed schema would add).
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
// A binary tuple key, never a joined string: a model may itself contain "/", so
// `provider/model` would let `a/b`+`c` collide with `a`+`b/c`.
const routeKey = (provider, model) => `${provider}\u0000${model}`

const requireNormalizer = options => {
  const normalizeFunding = options?.normalizeFunding
  if (typeof normalizeFunding !== 'function') throw new TypeError('normalizeMainModelRoutes/materializeMainRouteDefault require an injected legacy funding normalizer { normalizeFunding }')
  return normalizeFunding
}

const normalizeApiLimit = (value, normalizeFunding) => {
  if (value === null || value === undefined) return null
  keys(value, ['dailyBudgetUsd', 'monthlyBudgetUsd'], 'mainRoutes.limits.api')
  // Reuse the legacy amount bound and field checks instead of restating them.
  const funding = normalizeFunding({ mode: 'api', scopeId: null, pricing: null, request: null, dailyBudgetUsd: value.dailyBudgetUsd, monthlyBudgetUsd: value.monthlyBudgetUsd, subscription: null })
  // The group as a whole is either configured (both numbers, 0 included) or left
  // null for "not configured"; a null inside a present group is never stored.
  if (funding.dailyBudgetUsd === null || funding.monthlyBudgetUsd === null) fail('BOT_SETTINGS_INVALID', 'API 每日与每月预算必须同时填写；整组留空表示未配置，0 表示禁止付费。', { field: 'mainRoutes.limits.api' })
  return { dailyBudgetUsd: funding.dailyBudgetUsd, monthlyBudgetUsd: funding.monthlyBudgetUsd }
}

const normalizeSubscriptionLimit = (value, normalizeFunding) => {
  if (value === null || value === undefined) return null
  keys(value, ['dailyCalls', 'monthlyCalls'], 'mainRoutes.limits.subscription')
  // Reuse the legacy integer-call bound and field checks.
  const funding = normalizeFunding({ mode: 'subscription', scopeId: null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: { dailyCalls: value.dailyCalls, monthlyCalls: value.monthlyCalls } })
  return { dailyCalls: funding.subscription.dailyCalls, monthlyCalls: funding.subscription.monthlyCalls }
}

const normalizeRouteFunding = (value, normalizeFunding) => {
  keys(value, ['mode', 'scopeId', 'pricing', 'request'], 'mainRoutes.routes.funding')
  const mode = value.mode
  if (mode !== 'api' && mode !== 'subscription') fail('BOT_SETTINGS_INVALID', '路线资金渠道必须是 api 或 subscription。', { field: 'mainRoutes.routes.funding.mode' })
  // A subscription profile never carries API price or request bounds, and an API
  // profile never carries a subscription group (an extra key is already refused
  // by the closed field list). These are refused, not silently dropped.
  if (mode === 'subscription' && ((value.pricing ?? null) !== null || (value.request ?? null) !== null)) fail('BOT_SETTINGS_INVALID', '订阅路线不能夹带 API 价格或请求上界；不会隐式切换渠道。', { field: 'mainRoutes.routes.funding' })
  const funding = normalizeFunding(mode === 'api'
    ? { mode, scopeId: value.scopeId ?? null, pricing: value.pricing ?? null, request: value.request ?? null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null }
    : { mode, scopeId: value.scopeId ?? null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null })
  return { mode: funding.mode, scopeId: funding.scopeId, pricing: funding.pricing, request: funding.request }
}

const normalizeRoute = (value, normalizeFunding) => {
  keys(value, ['provider', 'model', 'enabled', 'funding'], 'mainRoutes.routes')
  if (!token(value.provider) || !token(value.model)) fail('BOT_SETTINGS_INVALID', '路线需要准确的 provider/model。', { field: 'mainRoutes.routes' })
  if (typeof value.enabled !== 'boolean') fail('BOT_SETTINGS_INVALID', 'enabled 必须是布尔值。', { field: 'mainRoutes.routes.enabled' })
  return { provider: value.provider, model: value.model, enabled: value.enabled, funding: normalizeRouteFunding(value.funding, normalizeFunding) }
}

/**
 * Normalize an optional `settings.mainRoutes` value. Returns `null` for the
 * absent/null case (old records keep their shape). Otherwise returns the closed
 * `{ schemaVersion, limits, routes }` collection: at most 64 routes, stably
 * sorted by exact provider/model, no duplicate tuple, total JSON <= 64 KiB.
 * Every amount, token bound, mode and cross-channel rule is checked by the
 * injected legacy normalizer.
 */
export function normalizeMainModelRoutes(value, options = {}) {
  const normalizeFunding = requireNormalizer(options)
  if (value === null || value === undefined) return null
  keys(value, ['schemaVersion', 'limits', 'routes'], 'mainRoutes')
  if (value.schemaVersion !== MAIN_ROUTES_SCHEMA) fail('BOT_SETTINGS_VERSION_UNSUPPORTED', '多路线配置版本不受支持，请升级宿主。', { field: 'mainRoutes.schemaVersion' })
  keys(value.limits, ['api', 'subscription'], 'mainRoutes.limits')
  const limits = {
    api: normalizeApiLimit(value.limits.api, normalizeFunding),
    subscription: normalizeSubscriptionLimit(value.limits.subscription, normalizeFunding),
  }
  const routes = list(value.routes, MAX_ROUTES, 'mainRoutes.routes').map(route => normalizeRoute(route, normalizeFunding))
  const seen = new Set()
  for (const route of routes) {
    const key = routeKey(route.provider, route.model)
    if (seen.has(key)) fail('BOT_SETTINGS_DUPLICATE', `路线 ${route.provider}/${route.model} 重复。`, { field: 'mainRoutes.routes' })
    seen.add(key)
  }
  routes.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
  const collection = { schemaVersion: MAIN_ROUTES_SCHEMA, limits, routes }
  if (Buffer.byteLength(JSON.stringify(collection)) > MAX_BYTES) fail('BOT_SETTINGS_LIMIT', '多路线配置不能超过 64 KiB。', { field: 'mainRoutes' })
  return collection
}

/**
 * The complete legacy funding record for one exact, enabled route, or `null`.
 *
 * `null` means the route is absent, disabled, or not ready: the required global
 * limit group, the API price/request bounds, or the funding scope is missing.
 * The result is a deep copy, so a caller cannot mutate the normalized profile.
 *
 * Every API route draws on the same global `limits.api` budget and every
 * subscription route on the same global `limits.subscription` quota; no per-route
 * counter is created, so the Host's aggregate ceilings keep applying across all
 * routes. This helper does not run the ledger, so it cannot claim the aggregate
 * was actually enforced.
 */
export function fundingForMainRoute(collection, target) {
  if (!plain(collection) || !Array.isArray(collection.routes)) return null
  const provider = target?.provider, model = target?.model
  if (typeof provider !== 'string' || typeof model !== 'string') return null
  const route = collection.routes.find(item => item.provider === provider && item.model === model)
  if (!route || route.enabled !== true || !plain(route.funding)) return null
  const scopeId = route.funding.scopeId
  if (scopeId === null) return null
  if (route.funding.mode === 'api') {
    if (collection.limits.api === null || route.funding.pricing === null || route.funding.request === null) return null
    return clone({ mode: 'api', scopeId, pricing: route.funding.pricing, request: route.funding.request,
      dailyBudgetUsd: collection.limits.api.dailyBudgetUsd, monthlyBudgetUsd: collection.limits.api.monthlyBudgetUsd, subscription: null })
  }
  if (route.funding.mode !== 'subscription' || collection.limits.subscription === null) return null
  return clone({ mode: 'subscription', scopeId, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null,
    subscription: { dailyCalls: collection.limits.subscription.dailyCalls, monthlyCalls: collection.limits.subscription.monthlyCalls } })
}

/**
 * Derive `settings.funding` from the default exact model's route plus the
 * unified global limits, returning a clone.
 *
 * The default is the committed `settings.model`; a route is never silently
 * chosen as "the first one". When `mainRoutes` is absent/null the clone is
 * value-identical to the input (the legacy single-route case is untouched).
 * When `mainRoutes` is present and the default route is ready, `settings.funding`
 * is generated from that route plus the unified limits whether or not the Bot is
 * enabled. When the default route is not ready the call is refused only if the
 * settings are enabled; a disabled settings keeps its unfinished draft and never
 * receives a fabricated available funding.
 */
export function materializeMainRouteDefault(settings, options = {}) {
  if (!plain(settings)) throw new TypeError('materializeMainRouteDefault requires a plain settings object')
  const next = clone(settings)
  if (next.mainRoutes === null || next.mainRoutes === undefined) return next
  const collection = normalizeMainModelRoutes(next.mainRoutes, options)
  const model = plain(next.model) ? next.model : null
  const funding = model ? fundingForMainRoute(collection, { provider: model.provider, model: model.model }) : null
  if (funding !== null) next.funding = funding
  else if (next.enabled === true) fail('MAIN_ROUTE_DEFAULT_UNAVAILABLE', '启用多路线前，默认模型必须对应一条已启用且已就绪的路线；不会自动选择第一条路线。', { field: 'mainRoutes' })
  return next
}

const routeState = settings => {
  if (!plain(settings) || !Object.hasOwn(settings, 'mainRoutes') || settings.mainRoutes === undefined) return 'absent'
  return settings.mainRoutes === null ? 'exit' : 'present'
}
// Key-order-independent deep serialization, so a re-serialized legacy funding
// still compares equal.
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
const identityUnchanged = (next, previous) => canonical(next.model) === canonical(previous.model) && canonical(next.funding) === canonical(previous.funding)

/**
 * Protect a stored multi-route collection from an older client that omits the
 * field it does not know about.
 *
 * An explicit `mainRoutes` value (object or null) on `next` is always honored:
 * `null` exits multi-route, an object is the new declaration. Only a missing
 * key triggers protection: if `previous` carried a collection and neither the
 * default model nor the funding changed, the stored collection is re-attached;
 * if either changed the client must re-read, so the call is refused. A previous
 * that had no collection leaves `next` untouched.
 */
export function preserveMainModelRoutes(next, previous) {
  if (!plain(next)) throw new TypeError('preserveMainModelRoutes requires a plain next settings object')
  const previousSafe = plain(previous) ? previous : {}
  if (routeState(next) !== 'absent') return clone(next)
  if (routeState(previousSafe) === 'present') {
    if (identityUnchanged(next, previousSafe)) return { ...clone(next), mainRoutes: clone(previousSafe.mainRoutes) }
    fail('MAIN_ROUTES_RELOAD_REQUIRED', '默认模型或资金已更改，请重新读取多路线配置后再保存。', { field: 'mainRoutes' })
  }
  return clone(next)
}
