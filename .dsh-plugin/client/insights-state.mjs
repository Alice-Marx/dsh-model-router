/**
 * Pure view helpers for the workbench insight cards (health check, budget,
 * run DAG). Kept free of React so the test suite can import them directly.
 */
import { budgetCheck, formatUsd as sharedFormatUsd } from '../shared/run-ledger.mjs'

export const PACKAGE_STATUS = Object.freeze({
  pending: Object.freeze({ label: '待执行', tone: 'pending' }),
  succeeded: Object.freeze({ label: '官方 CLI 完成', tone: 'ok' }),
  fallback: Object.freeze({ label: '已回退 API 完成', tone: 'warn' }),
  failed: Object.freeze({ label: '失败', tone: 'error' }),
  blocked: Object.freeze({ label: '依赖未完成', tone: 'blocked' }),
  cancelled: Object.freeze({ label: '已取消', tone: 'blocked' }),
  paused: Object.freeze({ label: '等待确认', tone: 'warn' }),
  waiting: Object.freeze({ label: '等待上游确认', tone: 'blocked' }),
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

// Same four-decimal format as the Host budget messages.
const money = sharedFormatUsd
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

export const RUN_KIND_LABEL = Object.freeze({ assign: '路由执行', team: '团队执行', tool: '单工具调用' })
export const RUN_STATUS_LABEL = Object.freeze({
  completed: '完成', partial: '部分完成', failed: '失败', 'cli-completed': '完成',
  incomplete: '未完成', paused: '等待确认', 'integration-pending': '待整合', blocked: '被阻止', cancelled: '已取消', pending: '待执行',
})

/**
 * Cost text for one stored package. Budget spend (API key / API path) and the
 * subscription reference (API-equivalent figure, not counted) are kept apart.
 */
export function packageCost(item) {
  if (item?.billing === 'subscription') {
    return {
      budget: '不计入预算',
      reference: item.referenceCostUsd !== null && item.referenceCostUsd !== undefined
        ? `订阅参考费用 ${money(item.referenceCostUsd)}（按 API 价折算）` : '订阅登录，未回报可折算的用量',
    }
  }
  if (item?.costUsd !== null && item?.costUsd !== undefined) {
    return { budget: `${money(item.costUsd)}${item.costSource === 'cli-reported' ? '（CLI 自报）' : ''}`, reference: null }
  }
  return { budget: item?.ran ? '费用未知' : '—', reference: null }
}

/** Run totals: budget-counted spend and the subscription reference figure. */
export function runTotals(run) {
  const items = [...(run?.packages ?? []), ...(run?.reviews ?? [])]
  let budgetUsd = 0
  let referenceUsd = 0
  let subscription = false
  for (const item of items) {
    if (item.billing === 'subscription') {
      subscription = true
      if (typeof item.referenceCostUsd === 'number') referenceUsd += item.referenceCostUsd
    } else if (typeof item.costUsd === 'number') budgetUsd += item.costUsd
  }
  return { budgetUsd, referenceUsd, subscription }
}

/** Whether one step can be re-run from the workbench, and why not. */
export function rerunSupport(run) {
  if (run?.kind === 'tool') return { supported: false, reason: '单工具调用没有可单独重跑的步骤；请在会话中再次调用 model_router_tool_run。' }
  if (run?.kind === 'team' && run.executionMode !== 'read-only') return { supported: false, reason: '可编辑团队运行不支持单步重跑：改动在独立 Git 工作树中。请在会话中重新调用 model_router_team_execute。' }
  return { supported: true, reason: '' }
}

const pad2 = value => String(value).padStart(2, '0')
/** Local "M-D HH:MM" for reset times (the Host and the UI share the user's machine). */
export function formatResetTime(at) {
  if (!Number.isFinite(at)) return ''
  const date = new Date(at)
  return `${date.getMonth() + 1}-${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export const BILLING_CHANNEL_LABEL = Object.freeze({ subscription: '订阅', api: 'API Key' })

/** Health-check billing rows in display form. */
export function billingRows(billing) {
  return (billing?.providers ?? []).map(row => {
    const sub = row.subscription ?? {}
    const subscription = sub.kind === 'plan-key'
      ? `编程套餐 Key${sub.planRoute ? `（${sub.planRoute.provider}/${sub.planRoute.model}）` : ''}`
      : sub.kind === 'cli-login' ? `官方 CLI 账号登录 · ${sub.toolId}` : '无订阅'
    const state = sub.state === 'exhausted'
      ? `${sub.exhaustedKind === 'rate-limit' ? '限流中' : '额度已用尽'}，预计 ${formatResetTime(sub.exhaustedUntil)} 恢复${sub.resetReported ? '' : '（厂商未给出时间，按冷却时间估算）'}`
      : sub.stateLabel ?? '—'
    const api = row.mode === 'subscription-only' ? '不回退（只用订阅）'
      : row.api?.available ? `可用${row.api.route ? `：${row.api.route.provider}/${row.api.route.model}` : ''}${row.api.cliKeyEnv ? ' · CLI 环境变量也有 Key' : ''}`
        : '未配置回退的 API 路线'
    return {
      key: `${row.provider}\u0000${sub.key ?? 'none'}\u0000${row.mode}`,
      provider: row.provider,
      models: (row.models ?? []).join('、'),
      mode: row.modeLabel ?? row.mode,
      subscription,
      state,
      exhausted: sub.state === 'exhausted',
      api,
      apiAvailable: row.api?.available === true,
    }
  })
}

/** One line for a step that switched channel, or null. */
export function billingSwitchText(item) {
  const note = item?.billingSwitch
  if (!note?.reason) return null
  return note.reason
}
