/**
 * Pure view helpers for the workbench insight cards (health check, budget,
 * run DAG). Kept free of React so the test suite can import them directly.
 */
import { budgetCheck, formatUsd as sharedFormatUsd, sanitizeArchivedSpending } from '../shared/run-ledger.mjs'
import { OFFICIAL_TOOLS } from '../shared/official-tool-registry.mjs'
import { parsePackageAssignments } from '../shared/package-assignments.mjs'

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
export const VERSION_LABEL = Object.freeze({ latest: '已是最新版', 'update-available': '有新版本', unknown: '最新版本未知' })
/** Shown wherever versions appear: the plugin follows each vendor's latest release. */
export const UNTESTED_VERSION_NOTE = '插件不再固定官方工具版本，安装和更新都取各厂商的最新版；新版本未经插件测试，输出格式变化时插件会尽量兼容，遇到问题请反馈。'

/** "已安装 1.2.3 · 最新 1.2.4（有新版本）" for one health entry. */
export function versionLine(entry) {
  if (!entry?.installed) return ''
  const installed = entry.version ? `已安装 ${entry.version}` : '已安装（版本未知）'
  if (!entry.latestVersion) return `${installed} · ${VERSION_LABEL.unknown}`
  return entry.versionStatus === 'update-available'
    ? `${installed} · 最新 ${entry.latestVersion}（有新版本，可在下方更新）`
    : `${installed} · ${VERSION_LABEL.latest}`
}

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
    updates: installed.filter(item => item.versionStatus === 'update-available').length,
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
  if (inner && typeof inner === 'object' && 'ok' in inner && !inner.ok) {
    const error = inner.error
    throw new Error(String((error && typeof error === 'object' ? error.message : error) ?? '') || fallback)
  }
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

/** Earlier attempts retain monthly totals; daily entries describe the same spend. */
export function priorAttemptTotals(run) {
  const months = sanitizeArchivedSpending(run?.priorAttemptSpending).months
  const totals = { budgetUsd: 0, referenceUsd: 0, unknownCalls: 0, subscriptionRuns: 0 }
  for (const period of Object.values(months)) {
    totals.budgetUsd += period.costUsd
    totals.referenceUsd += period.subscriptionUsd
    totals.unknownCalls += period.unknown
    totals.subscriptionRuns += period.subscriptionRuns
  }
  return totals
}

/** Run totals include prior attempts while keeping subscriptions outside budgets. */
export function runTotals(run) {
  const items = [...(run?.packages ?? []), ...(run?.reviews ?? [])]
  const prior = priorAttemptTotals(run)
  let budgetUsd = prior.budgetUsd
  let referenceUsd = prior.referenceUsd
  let subscription = prior.subscriptionRuns > 0
  for (const item of items) {
    if (item.billing === 'subscription') {
      subscription = true
      if (typeof item.referenceCostUsd === 'number') referenceUsd += item.referenceCostUsd
    } else if (typeof item.costUsd === 'number') budgetUsd += item.costUsd
  }
  return { budgetUsd, referenceUsd, subscription }
}

/** Whether one step can be re-run from the workbench, and why not. */
/**
 * Mirror of the Host's rerun rules for the workbench buttons.
 * - tool runs: a failed call is repeated as a new linked run (no reassignment);
 * - editable team runs: only one that stopped at a failed step, with its
 *   isolated worktree and base commit recorded, continues in a fresh worktree;
 * - everything else re-runs the failed step and its unfinished downstream steps.
 * `writes` means the rerun edits files and needs an explicit confirmation.
 */
export function rerunSupport(run) {
  if (run?.kind === 'tool') {
    const editable = run.executionMode === 'workspace-write'
    return { supported: true, writes: editable, reassign: false,
      reason: '', confirm: editable ? '重跑会在新的独立 Git 工作树中再次执行这次可编辑调用，成功后把改动整合回工作区（工作区须为干净的 Git 仓库）。' : '' }
  }
  if (run?.kind === 'team' && run.executionMode === 'workspace-write') {
    if (!['incomplete', 'cancelled'].includes(run.status)) {
      return { supported: false, writes: true, reassign: false, reason: run.status === 'integration-pending'
        ? '改动尚待人工整合（独立工作区已保留），不能单步重跑；请先核对并整合，再在会话中重新执行团队任务。'
        : '改动已整合到工作区，单步重跑会重复套用改动；如需重做请在会话中重新调用 model_router_team_execute。' }
    }
    if (!run.isolatedWorkspace || !run.baseCommit) {
      return { supported: false, writes: true, reassign: false, reason: '旧版本记录缺少独立工作区或 Git 基线，无法安全续跑；请在会话中重新调用 model_router_team_execute。' }
    }
    return { supported: true, writes: true, reassign: true, reason: '',
      confirm: '续跑会在新的独立 Git 工作树中先套用之前的改动，再重跑该步骤及其下游；成功后把合并补丁整合回工作区（工作区须干净且仍在原基线提交）。' }
  }
  return { supported: true, writes: false, reassign: true, reason: '', confirm: '' }
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

/** Fresh editable targets; the original algorithm plan is never changed. */
export function initialPackageAssignments(plan) {
  if (plan?.routingBypassed || plan?.mode === 'direct') return {}
  const packages = plan?.team?.workPackages ?? []
  if (!packages.length) return {}
  return parsePackageAssignments(Object.fromEntries(packages.map(item => [item.id,
    { kind: 'api', provider: item.recommendedProvider, model: item.recommendedModel }])))
}

/** Installation and known execution limits are public evidence, not a readiness guarantee. */
export function manualAssignmentOptions(routes = [], toolSnapshot = null, health = null) {
  const options = []
  const seen = new Set()
  for (const route of routes) {
    if (!route?.provider || !route?.model) continue
    const binding = { kind: 'api', provider: route.provider, model: route.model }
    const value = JSON.stringify(binding)
    if (seen.has(value)) continue
    seen.add(value)
    options.push({ value, binding, label: `${route.provider}/${route.model} · 模型 API`, disabled: false, reason: '' })
  }
  for (const tool of OFFICIAL_TOOLS) {
    const probe = toolSnapshot?.probes?.find(item => item.id === tool.id)
    const report = health?.tools?.find(item => item.id === tool.id)
    const ready = toolSnapshot?.readiness?.find(item => item.id === tool.id)
    const capability = toolSnapshot?.capabilities?.find(item => item.id === tool.id)
    const installed = probe ? probe.installed === true : report?.installed === true
    const modes = ready?.readyModes ?? ready?.modes ?? capability?.modes
    const reason = !installed ? '未安装或安装状态未知'
      : capability?.supported === false ? capability.reason || '不支持托管执行'
        : ready?.ready === false ? ready.reason || '执行入口尚未就绪'
          : Array.isArray(modes) && !modes.includes('read-only') ? '不支持只读任务'
            : report?.login?.state === 'logged-out' ? '尚未登录' : ''
    const pending = !reason && ready?.ready !== true ? ' · 待执行预览核验' : ''
    const binding = { kind: 'tool', toolId: tool.id }
    options.push({ value: JSON.stringify(binding), binding, disabled: Boolean(reason), reason,
      label: `${tool.label} · 官方工具默认模型${reason ? `（${reason}）` : pending}` })
  }
  return options
}

/** Workbench request: algorithm callers keep their original request shape. */
export function launchRequest({ task, mode, directRoute, budgetUsd, preset, workspace, executor = 'routed', executionMode = 'read-only', executionEnvironment = 'harness', assignmentMode = 'algorithm', packageAssignments, packagePlanKey } = {}) {
  if (!['algorithm', 'manual'].includes(assignmentMode)) throw new Error('不支持的分配方式。')
  let manual = null
  if (assignmentMode === 'manual') {
    if (mode === 'direct') throw new Error('指定单一模型模式不支持手动工作包分配。')
    if (typeof packagePlanKey !== 'string' || !packagePlanKey.trim() || packagePlanKey.length > 200) throw new Error('请重新生成工作包后再手动分配。')
    const assignments = parsePackageAssignments(packageAssignments)
    if (!assignments) throw new Error('请选择工作包执行目标。')
    manual = { assignmentMode: 'manual', packagePlanKey, packageAssignments: assignments }
    executor = 'routed'
    executionMode = 'read-only'
    executionEnvironment = 'harness'
  }
  if (!['routed', 'official-team'].includes(executor)) throw new Error('不支持的执行方式。')
  if (!['read-only', 'workspace-write'].includes(executionMode)) throw new Error('不支持的任务权限。')
  if (executor === 'official-team' && mode !== 'team') throw new Error('官方工具协作需要先在上方选择“团队分工”。')
  if (executor === 'routed' && executionMode !== 'read-only') throw new Error('模型路由只支持只读任务；编辑文件请使用官方工具协作。')
  if (!['harness', 'cli-native'].includes(executionEnvironment)
    || executionEnvironment === 'cli-native' && (executor !== 'official-team' || executionMode !== 'workspace-write')) throw new Error('厂商 CLI 正常环境需要官方工具协作与编辑文件权限。')
  const budget = Number(budgetUsd)
  return {
    task: typeof task === 'string' ? task : '',
    ...(executor === 'official-team' ? { executor, executionMode } : {}),
    ...(executionEnvironment === 'cli-native' ? { executionEnvironment } : {}),
    ...(mode === 'direct' && directRoute ? { provider: directRoute.provider, model: directRoute.model } : { planMode: mode === 'team' ? 'team' : 'single', preset }),
    ...(Number.isFinite(budget) && budget >= 0 ? { budgetUsd: budget } : {}),
    ...(typeof workspace === 'string' && workspace.trim() ? { workspace: workspace.trim() } : {}),
    ...(manual ?? {}),
  }
}

/**
 * Everything a workbench rerun needs confirmed, as one list for one prompt:
 * file edits, a direct (unsandboxed) CLI launch, and a likely budget overrun
 * (estimated locally from the ledger; the Host re-checks).
 */
export function rerunConfirmations({ run, item, override = null, choice = null, ledger = null, health = null, toolFor = () => null, headlessIds = new Set() } = {}) {
  const reasons = []
  const support = rerunSupport(run)
  if (support.writes) reasons.push({ code: 'workspace-write', text: support.confirm })
  if (run?.kind === 'team' && run.executionEnvironment === 'cli-native') reasons.push({ code: 'unsandboxed',
    text: '厂商 CLI 正常环境：以当前用户权限使用原登录、配置、技能及 MCP，不经 Harness 沙箱；Git 工作树仅用于改动回收，不限制工作树外资源访问。' })
  if (choice === 'api') reasons.push({ code: 'subscription-api', text: '改用 API Key 重试：会按 API 计费并计入预算。' })
  const tool = toolFor(override?.provider ?? item?.provider)
  const entry = (health?.tools ?? []).find(candidate => candidate.id === tool?.id)
  if (choice !== 'api' && choice !== 'cancel' && run?.kind !== 'team' && run?.kind !== 'tool' && ledger?.settings?.confirmUnsandboxedCli !== false
    && tool && headlessIds.has(tool.id) && entry?.installed && entry.login?.state !== 'logged-out') {
    reasons.push({ code: 'unsandboxed', text: `会直接启动 ${tool.label} 的无界面 CLI，不经过 Harness 进程沙箱，只读仅由 CLI 参数保证。` })
  }
  const estimate = override ? null : item?.estimatedCost
  const check = ledger?.budget ? budgetCheck({ estimateUsd: typeof estimate === 'number' ? estimate : null, spent: ledger.spent ?? {},
    dailyLimitUsd: ledger.budget.dailyLimitUsd, monthlyLimitUsd: ledger.budget.monthlyLimitUsd }) : null
  if (check?.exceeded) reasons.push({ code: 'over-budget', text: `超出预算：${check.message}` })
  return reasons
}
