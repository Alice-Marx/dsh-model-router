/**
 * Pure view helpers for the workbench insight cards (health check, budget,
 * run DAG). Kept free of React so the test suite can import them directly.
 */
import { budgetCheck } from '../shared/run-ledger.mjs'

export const PACKAGE_STATUS = Object.freeze({
  pending: Object.freeze({ label: '待执行', tone: 'pending' }),
  succeeded: Object.freeze({ label: '官方 CLI 完成', tone: 'ok' }),
  fallback: Object.freeze({ label: '已回退 API 完成', tone: 'warn' }),
  failed: Object.freeze({ label: '失败', tone: 'error' }),
  blocked: Object.freeze({ label: '依赖未完成', tone: 'blocked' }),
  cancelled: Object.freeze({ label: '已取消', tone: 'blocked' }),
})

export function packageStatus(item) {
  if (item?.status === 'succeeded' && item.channel === 'harness-llm') return { label: 'API 完成', tone: 'ok' }
  return PACKAGE_STATUS[item?.status] ?? PACKAGE_STATUS.pending
}

/** Columns of a dependency DAG: column = 1 + deepest dependency. Cycles and unknown ids are tolerated. */
export function dagLayers(packages) {
  const list = Array.isArray(packages) ? packages : []
  const byId = new Map(list.map(item => [item.id, item]))
  const depth = new Map()
  const visit = (id, trail = new Set()) => {
    if (depth.has(id)) return depth.get(id)
    if (trail.has(id) || !byId.has(id)) return -1
    trail.add(id)
    const deps = (byId.get(id).dependsOn ?? []).map(dep => visit(dep, trail))
    const value = deps.length ? Math.max(...deps) + 1 : 0
    depth.set(id, Math.max(0, value))
    return depth.get(id)
  }
  list.forEach(item => visit(item.id))
  const layers = []
  for (const item of list) {
    const level = depth.get(item.id) ?? 0
    ;(layers[level] ??= []).push(item)
  }
  return layers.filter(Boolean)
}

export const LOGIN_LABEL = Object.freeze({ 'logged-in': '已登录', 'logged-out': '未登录', unknown: '登录状态未知' })
export const VERSION_LABEL = Object.freeze({ ok: '版本符合', older: '版本低于目标', unknown: '版本未知' })

/** Headline counts for the onboarding banner. */
export function healthSummary(tools) {
  const list = Array.isArray(tools) ? tools : []
  const installed = list.filter(item => item.installed)
  return {
    total: list.length,
    installed: installed.length,
    ready: installed.filter(item => item.login?.state === 'logged-in').length,
    loggedOut: installed.filter(item => item.login?.state === 'logged-out').length,
    unknown: installed.filter(item => item.login?.state === 'unknown').length,
    older: installed.filter(item => item.versionStatus === 'older').length,
  }
}

const money = value => typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(value >= 1 ? 2 : 4)}` : '—'
export { money as formatUsd }

/** Budget bar for one period: share used (0–1) and text. */
export function budgetMeter(spent, limit) {
  if (!(limit > 0)) return { limited: false, share: 0, text: `${money(spent)}（未设上限）` }
  const share = Math.min(1, Math.max(0, spent / limit))
  return { limited: true, share, over: spent >= limit, text: `${money(spent)} / ${money(limit)}` }
}

/** Pre-run check of a local plan against the ledger's recorded spending. */
export function planBudget(ledger, estimateUsd) {
  if (!ledger?.budget) return null
  return budgetCheck({
    estimateUsd,
    spent: ledger.spent ?? { today: 0, month: 0 },
    dailyLimitUsd: ledger.budget.dailyLimitUsd,
    monthlyLimitUsd: ledger.budget.monthlyLimitUsd,
  })
}

/** Routes with learned biases applied, for the local planner. */
export function biasForRoute(ledger, route) {
  const value = ledger?.biases?.[`${route.provider}\u0000${route.model}`]
  return typeof value === 'number' ? value : 0
}

/** Unwrap a workbench RPC response: client envelope { ok, value } around Host { ok, value | error }. */
export function unwrapRemote(response, fallback) {
  if (!response?.ok) throw new Error(String(response?.error?.message ?? '') || fallback)
  const inner = response.value
  if (inner && typeof inner === 'object' && 'ok' in inner && !inner.ok) throw new Error(String(inner.error ?? '') || fallback)
  return inner && typeof inner === 'object' && 'ok' in inner ? inner.value : inner
}
