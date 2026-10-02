/**
 * Subscription-first billing: which channel a route uses first (a vendor CLI
 * account login or a coding-plan key endpoint), how quota / rate-limit
 * exhaustion is recognised in vendor errors, and how long an exhausted
 * subscription is skipped. Pure logic; the Host persists the quota state.
 */
import { toolForProvider } from './official-tool-registry.mjs'

export const BILLING_MODES = Object.freeze(['subscription-first', 'api-only', 'subscription-only'])
export const DEFAULT_BILLING_MODE = 'subscription-first'
export const DEFAULT_COOLDOWN_MINUTES = 60
/** Transient throttling (concurrency, overload) is skipped only briefly. */
export const RATE_LIMIT_COOLDOWN_MS = 60_000
const MAX_COOLDOWN_MS = 31 * 24 * 60 * 60_000

export const BILLING_MODE_LABEL = Object.freeze({
  'subscription-first': '订阅优先',
  'api-only': '只用 API Key',
  'subscription-only': '只用订阅',
})

/**
 * Documented exhaustion messages per vendor key (registry tool id). `quota`
 * means a plan window is used up; `rate-limit` is a short throttle. Sources
 * are listed so unverified entries are visible.
 */
export const VENDOR_QUOTA_PATTERNS = Object.freeze({
  'claude-code': Object.freeze([
    { kind: 'quota', source: 'code.claude.com/docs/en/errors', re: /you['’]?ve hit your [a-z0-9 -]{0,24}limit/i },
    { kind: 'quota', source: '旧版 CLI 文本（未核验）', re: /claude ai usage limit reached|usage limit reached\|\d{10}/i },
    { kind: 'rate-limit', source: 'code.claude.com/docs/en/errors', re: /server is temporarily limiting requests|request rejected \(429\)/i },
  ]),
  codex: Object.freeze([
    { kind: 'quota', source: 'Codex usage_limit_reached（社区记录的 API 返回）', re: /usage_limit_reached|you['’]?ve hit your usage limit|usage limit has been reached/i },
    { kind: 'rate-limit', source: 'OpenAI 429（通用）', re: /rate_limit_exceeded|rate limit reached for/i },
  ]),
  gemini: Object.freeze([
    { kind: 'quota', source: 'Google API RESOURCE_EXHAUSTED', re: /RESOURCE_EXHAUSTED|quota exceeded|exhausted your (?:daily )?quota|usage limit reached for all/i },
  ]),
  'kimi-code': Object.freeze([
    { kind: 'quota', source: 'kimi.com/code/docs 错误参考', re: /you['’]?ve reached your (?:5-hour|weekly \(7-day\)|monthly) usage limit/i },
    { kind: 'rate-limit', source: 'kimi.com/code/docs 错误参考', re: /you['’]?ve reached your concurrent request limit|we['’]?re receiving too many requests|engine is currently overloaded/i },
  ]),
  'minimax-code': Object.freeze([
    { kind: 'quota', source: 'platform.minimax.io 错误码 2056', re: /(?:\bcode\b["'\s:=]*|\[)2056\b|usage limit exceeded|token plan usage limit reached/i },
    { kind: 'rate-limit', source: 'platform.minimax.io 错误码 2045', re: /(?:\bcode\b["'\s:=]*|\[)2045\b|rate growth limit/i },
  ]),
  zcode: Object.freeze([
    { kind: 'quota', source: 'docs.z.ai / docs.bigmodel.cn 错误码 1308–1321', re: /(?:\bcode\b["'\s:=]*|\[)13(?:08|09|10|1[6-9]|2[01])\b|usage limit reached for|weekly\/monthly limit exhausted|已达到.{0,20}使用上限|套餐已到期|每周\/每月使用上限/i },
    { kind: 'rate-limit', source: 'docs.z.ai 错误码 1302/1305', re: /(?:\bcode\b["'\s:=]*|\[)130[25]\b|rate limit reached for requests|速率限制|访问量过大/i },
  ]),
  '*': Object.freeze([
    { kind: 'rate-limit', source: 'HTTP 429（通用）', re: /\b429\b|too many requests|rate[_ ]limit/i },
  ]),
})

const clean = value => typeof value === 'string' ? value.trim() : ''

/** Vendor key for a route or tool: the registry tool id, else '*'. */
export function vendorKey({ toolId = null, provider = '' } = {}) {
  return clean(toolId) || toolForProvider(provider)?.id || '*'
}

/**
 * Parse `quotaPatternsJson`: `{ "<tool id | provider | *>": { "quota": [regex], "rateLimit": [regex] } }`.
 * Invalid entries are dropped and reported, never thrown, so one bad regex
 * does not stop execution.
 */
export function parseQuotaPatterns(value) {
  const patterns = {}
  const errors = []
  if (value === undefined || value === null || clean(value) === '') return { patterns, errors }
  let input
  try { input = JSON.parse(value) } catch { return { patterns, errors: ['quotaPatternsJson 不是有效的 JSON'] } }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { patterns, errors: ['quotaPatternsJson 必须是对象'] }
  for (const [key, entry] of Object.entries(input).slice(0, 40)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${key}: 必须是对象`); continue }
    const list = []
    for (const [field, kind] of [['quota', 'quota'], ['rateLimit', 'rate-limit']]) {
      const values = entry[field]
      if (values === undefined) continue
      if (!Array.isArray(values)) { errors.push(`${key}.${field}: 必须是数组`); continue }
      for (const source of values.slice(0, 20)) {
        if (typeof source !== 'string' || !source || source.length > 200) { errors.push(`${key}.${field}: 每项必须是 1–200 字符的正则`); continue }
        try { list.push({ kind, source: '用户配置', re: new RegExp(source, 'i') }) } catch { errors.push(`${key}.${field}: 无效正则 ${source.slice(0, 40)}`) }
      }
    }
    if (list.length) patterns[key] = list
  }
  return { patterns, errors }
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Reset time from vendor text, as epoch ms in the future, or null. */
export function parseResetAt(text, now = Date.now()) {
  const value = String(text ?? '')
  const future = at => Number.isFinite(at) && at > now && at - now <= MAX_COOLDOWN_MS ? at : null
  let match = /"?resets_at"?\s*[:=]\s*(\d{10})\b/i.exec(value)
  if (match && future(Number(match[1]) * 1000)) return Number(match[1]) * 1000
  match = /"?resets_in_seconds"?\s*[:=]\s*(\d{1,8})\b/i.exec(value)
  if (match && Number(match[1]) > 0) return future(now + Number(match[1]) * 1000)
  match = /usage limit reached\|(\d{10})\b/i.exec(value)
  if (match) return future(Number(match[1]) * 1000)
  match = /retry[- ]after\s*[:=]?\s*(\d{1,6})\b/i.exec(value) ?? /retry in (\d+(?:\.\d+)?)\s*s\b/i.exec(value)
  if (match) return future(now + Math.ceil(Number(match[1]) * 1000))
  match = /try again in\s+(?:(\d+)\s*hours?)?[\s,]*(?:(\d+)\s*min(?:ute)?s?)?/i.exec(value)
  if (match && (match[1] || match[2])) return future(now + ((Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0)) * 60_000)
  // GLM: "reset at 2026-10-02 18:30:00" / "将在 2026-10-02 18:30:00 重置" (host local time).
  match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (match && /reset|重置|resets/i.test(value)) {
    const [, y, mo, d, h, mi, s] = match
    return future(new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)).getTime())
  }
  // Claude: "resets 3:45pm", "resets Mon 12:00am" (host local time).
  match = /resets\s+(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(value)
  if (match) {
    const [, day, hourText, minuteText, meridiem] = match
    let hour = Number(hourText) % 12
    if (meridiem.toLowerCase() === 'pm') hour += 12
    const at = new Date(now)
    at.setHours(hour, Number(minuteText ?? 0), 0, 0)
    if (day) {
      const target = WEEKDAYS.indexOf(day.toLowerCase().slice(0, 3))
      let offset = (target - at.getDay() + 7) % 7
      if (offset === 0 && at.getTime() <= now) offset = 7
      at.setDate(at.getDate() + offset)
    } else if (at.getTime() <= now) at.setDate(at.getDate() + 1)
    return future(at.getTime())
  }
  return null
}

/**
 * Classify a vendor failure. Returns null when it is not a quota or rate
 * limit, else `{ kind, resetAt, source }`. Vendor patterns win over the
 * generic 429 rule; user patterns are checked first.
 */
export function detectQuotaExhaustion(text, { vendor = '*', provider = '', extraPatterns = {}, now = Date.now() } = {}) {
  const value = String(text ?? '')
  if (!value.trim()) return null
  const lists = [
    extraPatterns[provider] ?? [], extraPatterns[vendor] ?? [], extraPatterns['*'] ?? [],
    VENDOR_QUOTA_PATTERNS[vendor] ?? [], VENDOR_QUOTA_PATTERNS['*'],
  ]
  for (const list of lists) {
    for (const pattern of list) {
      if (pattern.re.test(value)) return { kind: pattern.kind, resetAt: parseResetAt(value, now), source: pattern.source }
    }
  }
  return null
}

/** Until when an exhausted subscription is skipped. */
export function exhaustedUntil(info, { now = Date.now(), cooldownMinutes = DEFAULT_COOLDOWN_MINUTES } = {}) {
  if (Number.isFinite(info?.resetAt) && info.resetAt > now) return info.resetAt
  if (info?.kind === 'rate-limit') return now + RATE_LIMIT_COOLDOWN_MS
  const minutes = Number.isFinite(cooldownMinutes) && cooldownMinutes > 0 ? cooldownMinutes : DEFAULT_COOLDOWN_MINUTES
  return now + Math.min(MAX_COOLDOWN_MS, minutes * 60_000)
}

/** In-memory quota state with an optional persistence callback. Keys: `cli:<tool>` or `plan:<provider>`. */
export function createQuotaTracker({ now = Date.now, persist = null } = {}) {
  const entries = new Map()
  // `removed` lets a shared store merge this snapshot with other processes' entries.
  const save = (removed = []) => { if (typeof persist === 'function') Promise.resolve(persist(Object.fromEntries(entries), { removed })).catch(() => {}) }
  return {
    load(saved) {
      for (const [key, entry] of Object.entries(saved ?? {})) {
        if (entry && Number.isFinite(entry.until) && entry.until > now()) entries.set(key, entry)
      }
    },
    mark(key, info, { cooldownMinutes } = {}) {
      const at = now()
      const entry = {
        until: exhaustedUntil(info, { now: at, cooldownMinutes }),
        kind: info?.kind ?? 'quota',
        resetReported: Number.isFinite(info?.resetAt) && info.resetAt > at,
        detail: clean(info?.detail).slice(0, 300),
        source: clean(info?.source).slice(0, 120),
        markedAt: at,
      }
      entries.set(key, entry)
      save()
      return entry
    },
    status(key) {
      const entry = entries.get(key)
      if (!entry) return null
      if (entry.until <= now()) { entries.delete(key); save([key]); return null }
      return { ...entry }
    },
    clear(key) { if (entries.delete(key)) save([key]) },
    snapshot() {
      const at = now()
      return Object.fromEntries([...entries].filter(([, entry]) => entry.until > at).map(([key, entry]) => [key, { ...entry }]))
    },
  }
}

export const routeKeyOf = (provider, model) => `${clean(provider)}\u0000${clean(model)}`

/**
 * The subscription channel for a route and the API-key route behind it.
 * - plan-key: a Harness catalog route whose provider is a coding-plan
 *   endpoint (profile `subscription: 'plan-key'`, optional `apiRoute`).
 *   An API route named as another plan route's `apiRoute` uses that plan first.
 * - cli-login: a vendor CLI signed in to its own subscription account.
 */
/**
 * Provider ids that look like a coding-plan endpoint (e.g. "glm-coding-plan",
 * "kimi-code", "minimax-token-plan"). Used only when the profile does not say
 * `subscription`; a heuristic, so the profile setting always wins.
 */
export const PLAN_PROVIDER_HINT = /coding[-_ ]?plan|token[-_ ]?plan|kimi[-_ ]?(?:for[-_ ]?)?coding|kimi[-_ ]?code|glm[-_ ]?coding|(?:^|[-_])plan$/i

const subscriptionOf = route => ['plan-key', 'cli-login', 'none'].includes(route?.subscription) ? route.subscription
  : PLAN_PROVIDER_HINT.test(clean(route?.provider)) ? 'plan-key' : null

export function billingPlan(route, routes = []) {
  const list = Array.isArray(routes) ? routes : []
  const key = routeKeyOf(route?.provider, route?.model)
  const self = list.find(item => routeKeyOf(item.provider, item.model) === key) ?? route
  const mode = BILLING_MODES.includes(self?.billing) ? self.billing : DEFAULT_BILLING_MODE
  const find = target => target ? list.find(item => routeKeyOf(item.provider, item.model) === routeKeyOf(target.provider, target.model)) ?? target : null
  if (subscriptionOf(self) === 'plan-key') {
    return {
      mode,
      subscription: { kind: 'plan-key', key: `plan:${self.provider}`, route: { provider: self.provider, model: self.model } },
      apiRoute: self.apiRoute ? find(self.apiRoute) : null,
    }
  }
  const planFor = list.find(item => subscriptionOf(item) === 'plan-key' && item.apiRoute
    && routeKeyOf(item.apiRoute.provider, item.apiRoute.model) === key)
  if (planFor) {
    const planMode = BILLING_MODES.includes(self?.billing) ? self.billing : BILLING_MODES.includes(planFor.billing) ? planFor.billing : DEFAULT_BILLING_MODE
    return {
      mode: planMode,
      subscription: { kind: 'plan-key', key: `plan:${planFor.provider}`, route: { provider: planFor.provider, model: planFor.model } },
      apiRoute: self,
    }
  }
  const tool = subscriptionOf(self) === 'none' ? null : toolForProvider(self?.provider)
  return {
    mode,
    subscription: tool ? { kind: 'cli-login', key: `cli:${tool.id}`, toolId: tool.id } : null,
    apiRoute: self,
  }
}

export const SUBSCRIPTION_STATE_LABEL = Object.freeze({
  'logged-in': '已登录订阅账号',
  'plan-key': '编程套餐 Key 路线',
  'api-key-only': '仅 API Key 登录',
  'logged-out': '未登录',
  exhausted: '额度已用尽',
  unknown: '登录状态未知',
  none: '无订阅',
})

/**
 * Per-provider billing overview for the health check. `loginFor(toolId)`
 * returns 'subscription' | 'api-key' | 'logged-out' | 'unknown';
 * `apiKeyEnvFor(toolId)` is true when the CLI's API-key variable is set.
 * Rows are grouped by provider and subscription; never reads key values.
 */
export function billingOverview(routes, { quota = null, loginFor = () => 'unknown', apiKeyEnvFor = () => false, now = Date.now } = {}) {
  const list = Array.isArray(routes) ? routes : []
  const rows = new Map()
  for (const route of list) {
    const plan = billingPlan(route, list)
    const sub = plan.subscription
    const id = `${clean(route.provider)}\u0000${sub?.key ?? 'none'}\u0000${plan.mode}`
    const existing = rows.get(id)
    if (existing) {
      if (!existing.models.includes(route.model)) existing.models.push(route.model)
      continue
    }
    const exhausted = sub ? quota?.status?.(sub.key) ?? null : null
    const login = sub?.kind === 'cli-login' ? loginFor(sub.toolId) : null
    const state = !sub ? 'none'
      : exhausted ? 'exhausted'
        : sub.kind === 'plan-key' ? 'plan-key'
          : login === 'subscription' ? 'logged-in'
            : login === 'api-key' ? 'api-key-only'
              : login === 'logged-out' ? 'logged-out' : 'unknown'
    const apiRoute = plan.apiRoute && !(sub?.kind === 'plan-key' && routeKeyOf(plan.apiRoute.provider, plan.apiRoute.model) === routeKeyOf(sub.route.provider, sub.route.model))
      ? { provider: clean(plan.apiRoute.provider), model: clean(plan.apiRoute.model) } : null
    rows.set(id, {
      provider: clean(route.provider),
      models: [route.model],
      mode: plan.mode,
      modeLabel: BILLING_MODE_LABEL[plan.mode],
      subscription: {
        kind: sub?.kind ?? 'none',
        key: sub?.key ?? null,
        toolId: sub?.toolId ?? null,
        planRoute: sub?.kind === 'plan-key' ? { ...sub.route } : null,
        state,
        stateLabel: SUBSCRIPTION_STATE_LABEL[state],
        exhaustedUntil: exhausted?.until ?? null,
        exhaustedKind: exhausted?.kind ?? null,
        resetReported: exhausted?.resetReported === true,
        detail: exhausted?.detail ?? '',
      },
      api: {
        available: plan.mode !== 'subscription-only' && apiRoute !== null,
        route: apiRoute,
        cliKeyEnv: sub?.kind === 'cli-login' ? apiKeyEnvFor(sub.toolId) === true : false,
      },
    })
  }
  return { checkedAt: now(), providers: [...rows.values()] }
}
