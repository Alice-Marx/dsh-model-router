/**
 * Pure state for the Bot binding editor.
 *
 * The Host's committed catalog is the only source of providers, models, machines,
 * capabilities, official tools and funding scopes: nothing here invents a route,
 * a workspace, a capability or an execution mode the Host never offered. A blank
 * number stays blank (null), never 0, so "0 表示禁止付费" keeps its meaning and an
 * unfinished field is never silently completed with a default.
 *
 * No React and no DOM, so the integration specs exercise the same rules the
 * component renders.
 */

export const BOT_BINDING_SCHEMA = 1

/** Execution modes the stored schema accepts, least privileged first. */
export const EXECUTION_MODES = Object.freeze(['read-only', 'workspace-write', 'cli-native'])
export const MODE_LABEL = Object.freeze({
  'read-only': '只读执行',
  'workspace-write': '可写工作区',
  'cli-native': 'CLI 自身权限',
})
export const MODE_HELP = Object.freeze({
  'read-only': 'CLI 只能读取已授权内容，不写工作区。',
  'workspace-write': 'CLI 可写入此 Bot 已授权的工作区。',
  'cli-native': '沿用 CLI 自己的权限设置，宿主不再额外收紧。',
})

export const FUNDING_MODES = Object.freeze([
  { value: 'api', label: 'API（按金额）', help: '按 Token 计价，需要单价、请求上界与每日/每月预算。' },
  { value: 'subscription', label: '订阅（按次数）', help: '按调用次数计数，不会自动回退到 API。' },
])
export const ROUTING_PRESETS = Object.freeze([
  { value: '', label: '沿用全局预设' },
  { value: 'economy', label: '省钱优先' },
  { value: 'balanced', label: '均衡' },
  { value: 'quality', label: '效果优先' },
])

export const routeOf = model => (model && model.provider && model.model ? `${model.provider}/${model.model}` : '')

export const splitRoute = route => {
  const text = typeof route === 'string' ? route : ''
  const at = text.indexOf('/')
  return at < 0 ? { provider: '', model: '' } : { provider: text.slice(0, at), model: text.slice(at + 1) }
}

export const findModel = (catalog, route) => (catalog?.models ?? []).find(item => routeOf(item) === route) ?? null

/** Providers with their exact routes, in the order the Host listed them. */
export function providerGroups(catalog) {
  const groups = new Map()
  for (const item of catalog?.models ?? []) {
    if (!item?.provider) continue
    if (!groups.has(item.provider)) groups.set(item.provider, { provider: item.provider, models: [] })
    groups.get(item.provider).models.push({
      route: routeOf(item), model: item.model, label: item.label ?? item.model,
      cliModels: [...(item.cliModels ?? [])],
    })
  }
  return [...groups.values()]
    .map(group => ({ ...group, models: group.models.sort((left, right) => left.route.localeCompare(right.route)) }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/** A stored blank stays blank; a stored 0 stays "0". */
export const textOf = value => (value === null || value === undefined ? '' : String(value))

export const numberOrNull = text => {
  if (text === null || text === undefined) return null
  const raw = String(text).trim()
  if (raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function workspaceOptions(catalog) {
  return (catalog?.machines ?? []).map(machine => ({
    machineId: machine.machineId, label: machine.label ?? machine.machineId,
    location: machine.location, status: machine.status ?? 'unknown',
    roots: (machine.roots ?? []).map(root => ({ rootId: root.rootId, label: root.label ?? root.rootId, modes: [...(root.modes ?? [])] })),
  }))
}

export const workspaceKey = (machineId, rootId) => `${machineId ?? ''}/${rootId ?? ''}`

export const accountFor = (accounts, provider) => (accounts?.items ?? []).find(item => item.provider === provider) ?? null

/** A funding scope only covers the modes and routes the Host published for it. */
export function scopeAllows(scope, mode, route) {
  if (!scope) return false
  if (Array.isArray(scope.modes) && scope.modes.length > 0 && !scope.modes.includes(mode)) return false
  if (Array.isArray(scope.models) && scope.models.length > 0 && route && !scope.models.some(item => routeOf(item) === route)) return false
  return true
}

/**
 * A new Host publishes each tool's identities independently of the Bot's chat
 * model. Only an older catalog without that field uses its legacy route mapping.
 * An empty identity list is authoritative and never falls back to a chat model.
 */
export function toolCards({ catalog, model, grants }) {
  return (catalog?.tools ?? []).map(tool => {
    const current = Object.hasOwn(tool, 'identities')
    const identities = current ? (Array.isArray(tool.identities) ? tool.identities : [])
      : (model?.cliModels ?? []).filter(item => item.toolId === tool.toolId)
    const grant = (grants ?? []).find(item => item.toolId === tool.toolId) ?? null
    const modes = (tool.modes ?? []).filter(mode => EXECUTION_MODES.includes(mode))
    const reported = tool.status ?? (identities.length && modes.length ? 'ready' : 'unavailable')
    const status = current && reported === 'ready' && (tool.installed !== true || tool.loginState !== 'logged-in') ? 'unavailable' : reported
    const available = status === 'ready' && identities.length > 0 && modes.length > 0
    return {
      toolId: tool.toolId, label: tool.label ?? tool.toolId, vendor: tool.vendor ?? '', source: tool.source ?? '',
      modes, grantTools: [...(tool.grantTools ?? [])], identities: available ? identities : [], grant,
      status, available, installed: tool.installed === true, loginState: tool.loginState ?? 'unknown',
      reason: tool.reason ?? (available ? '' : '宿主尚未提供此工具的可用执行身份，请重新检测或前往安装与登录。'),
      stale: Boolean(grant) && (!available || !identities.some(item => item.model === grant.cliModel) || !modes.includes(grant.mode)),
    }
  }).sort((left, right) => left.toolId.localeCompare(right.toolId))
}

export const TOOL_STATUS_LABEL = Object.freeze({
  checking: '检测中', 'not-installed': '未安装', 'logged-out': '未登录', 'login-unknown': '登录状态待确认',
  'terminal-only': '仅终端交互', unavailable: '暂不可用', ready: '已就绪',
})

/** The least privileged mode the Host offers for a tool: a grant never starts wide. */
export function defaultMode(modes) {
  const offered = (modes ?? []).filter(mode => EXECUTION_MODES.includes(mode))
  return offered.includes('read-only') ? 'read-only' : offered[0] ?? 'read-only'
}

export function seedForm(record, accounts) {
  const settings = record?.settings ?? {}, catalog = record?.catalog ?? {}
  const groups = providerGroups(catalog)
  const fundingAccount = accountFor(accounts, settings.model?.provider)
  const grants = settings.machineGrants ?? []
  const workspaceRef = settings.workspaceRef ?? grants[0] ?? null
  const machineId = workspaceRef?.machineId ?? '', rootId = workspaceRef?.rootId ?? ''
  const grant = grants.find(item => item.machineId === machineId && item.rootId === rootId) ?? null
  return {
    provider: settings.model?.provider ?? (groups.length === 1 ? groups[0].provider : ''),
    model: routeOf(settings.model),    enabled: settings.enabled === true,
    workspace: machineId && rootId ? workspaceKey(machineId, rootId) : '',
    workspaceMode: grant?.mode ?? 'read-only',
    capabilities: [...(settings.capabilities ?? [])],
    officialTools: (settings.officialTools ?? []).map(tool => ({ ...tool })),
    fundingMode: settings.funding?.mode ?? 'api',
    input: textOf(settings.funding?.pricing?.input), output: textOf(settings.funding?.pricing?.output),
    ...(settings.mainRoutes ? { mainRoutes: structuredClone(settings.mainRoutes) } : {}),
    maxInputTokens: textOf(settings.funding?.request?.maxInputTokens), maxOutputTokens: textOf(settings.funding?.request?.maxOutputTokens),
    daily: textOf(settings.funding?.dailyBudgetUsd), monthly: textOf(settings.funding?.monthlyBudgetUsd),
    dailyCalls: textOf(settings.funding?.subscription?.dailyCalls), monthlyCalls: textOf(settings.funding?.subscription?.monthlyCalls),
    maxConcurrentTasks: textOf(settings.maxConcurrentTasks),
    // The funding scope's own limits, not an invented default.
    accountDaily: textOf(fundingAccount?.dailyLimitUsd), accountMonthly: textOf(fundingAccount?.monthlyLimitUsd),
    routing: {
      preset: settings.routing?.preset ?? '',
      dailyBudgetUsd: textOf(settings.routing?.dailyBudgetUsd),
      monthlyBudgetUsd: textOf(settings.routing?.monthlyBudgetUsd),
    },
  }
}

/**
 * Build the stored payload. A blank numeric field is sent as null, never 0, and a
 * half-filled group is sent as null rather than as an object holding nulls the
 * stored schema would reject.
 */
export function buildBinding({ form, model, account, machine, root }) {
  const funding = { mode: form.fundingMode, scopeId: account?.enabled ? account.id : null,
    pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null }
  if (form.fundingMode === 'api') {
    const input = numberOrNull(form.input), output = numberOrNull(form.output)
    funding.pricing = input === null || output === null ? null : { input, output }
    const maxInputTokens = numberOrNull(form.maxInputTokens), maxOutputTokens = numberOrNull(form.maxOutputTokens)
    funding.request = maxInputTokens === null || maxOutputTokens === null ? null : { maxInputTokens, maxOutputTokens }
    funding.dailyBudgetUsd = numberOrNull(form.daily)
    funding.monthlyBudgetUsd = numberOrNull(form.monthly)
  } else {
    const dailyCalls = numberOrNull(form.dailyCalls), monthlyCalls = numberOrNull(form.monthlyCalls)
    funding.subscription = dailyCalls === null || monthlyCalls === null ? null : { dailyCalls, monthlyCalls }
  }
  const routing = {
    preset: form.routing.preset === '' ? null : form.routing.preset,
    dailyBudgetUsd: numberOrNull(form.routing.dailyBudgetUsd),
    monthlyBudgetUsd: numberOrNull(form.routing.monthlyBudgetUsd),
  }
  return {
    schemaVersion: BOT_BINDING_SCHEMA,
    enabled: form.enabled === true,
    model: model ? { provider: model.provider, model: model.model } : null,
    officialTools: (form.officialTools ?? []).map(tool => ({ toolId: tool.toolId, cliModel: tool.cliModel, mode: tool.mode }))
      .sort((left, right) => left.toolId.localeCompare(right.toolId)),
    machineGrants: machine && root ? [{ machineId: machine.machineId, rootId: root.rootId, mode: form.workspaceMode, capabilities: [] }] : [],
    capabilities: [...(form.capabilities ?? [])].sort(),
    workspaceRef: machine && root ? { kind: machine.location ?? 'local', machineId: machine.machineId, rootId: root.rootId } : null,
    funding,
    maxConcurrentTasks: numberOrNull(form.maxConcurrentTasks),
    routing: routing.preset === null && routing.dailyBudgetUsd === null && routing.monthlyBudgetUsd === null ? null : routing,
  }
}

const apiFields = [
  ['input', '输入价格（USD / 百万 Token）'], ['output', '输出价格（USD / 百万 Token）'],
  ['maxInputTokens', '最大输入 Token'], ['maxOutputTokens', '最大输出 Token'],
  ['daily', 'Bot 每日预算（USD）'], ['monthly', 'Bot 每月预算（USD）'],
]
const subscriptionFields = [['dailyCalls', '每日订阅调用次数'], ['monthlyCalls', '每月订阅调用次数']]

/**
 * What this window can already see as missing, mirrored from the Host's own
 * admission rules. The Host still validates every save; this only refuses a call
 * that could not succeed, and never widens what is sent.
 */
export function bindingProblems({ form, model, account, machine, root, catalog, scope, mainRoutes = false }) {
  const problems = []
  // The stored schema needs a usable concurrency even for a disabled binding.
  const concurrency = numberOrNull(form.maxConcurrentTasks)
  if (concurrency === null || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) problems.push('最大并发任务数必须是 1 至 32 的整数。')
  if (form.enabled !== true) return problems
  if (!model) problems.push('请选择目录中的准确模型；留空表示此绑定保持停用。')
  if (!mainRoutes && model?.fundingModes && !model.fundingModes.includes(form.fundingMode)) problems.push('此模型不支持所选资金渠道，请选择宿主列出的渠道。')
  if (!machine || !root) problems.push('请选择已登记的工作区（机器与根目录）。')
  else if (!root.modes.includes(form.workspaceMode)) problems.push(`所选根目录不再支持${form.workspaceMode === 'read-only' ? '只读' : '写入'}模式，请重新选择。`)
  if (!mainRoutes) {
    if (!account) problems.push('宿主目录里没有这个提供商的资金范围，请刷新或改选模型。')
    else if (!account.enabled) problems.push(`${account.provider} 资金范围尚未启用；它不是厂商余额，需要本地预算上限。`)
    else if (!scopeAllows(scope, form.fundingMode, routeOf(model))) problems.push('资金范围不支持所选渠道或准确模型，请重新选择。')
    for (const [key, label] of form.fundingMode === 'api' ? apiFields : subscriptionFields) {
      if (numberOrNull(form[key]) === null) problems.push(`${label}尚未填写；0 表示禁止付费/调用，空值表示未配置。`)
    }
  }
  for (const id of form.capabilities ?? []) {
    if (!(catalog?.capabilities ?? []).some(item => item.id === id)) problems.push(`能力 ${id} 已不在宿主目录，请取消勾选。`)
  }
  for (const tool of form.officialTools ?? []) {
    const entry = toolCards({ catalog, model, grants: [] }).find(item => item.toolId === tool.toolId)
    if (!entry?.available) {
      problems.push(`${entry?.label ?? tool.toolId} 暂不可授予：${entry?.reason || '宿主目录中没有可用执行入口。'}`)
    } else if (!entry.modes.includes(tool.mode)) {
      problems.push(`${tool.toolId} 尚未获准使用该执行模式，请移除或改选宿主提供的模式。`)
    } else if (!entry.identities.some(item => item.model === tool.cliModel)) {
      problems.push(`${tool.toolId} / ${tool.cliModel} 的 CLI 执行身份尚未核验，请移除后重新授予。`)
    } else if (['workspace-write', 'cli-native'].includes(tool.mode) && form.workspaceMode !== 'workspace-write') {
      problems.push(`${entry.label} 需要写入工作区，请先将工作区权限设为允许写入。`)
    }
  }
  return problems
}

const FAILURES = {
  BOT_SETTINGS_CONFLICT: '绑定已在另一窗口修改。请刷新后按最新配置重新提交。',
  MAIN_ROUTES_RELOAD_REQUIRED: 'Main 路线配置已更新。请载入宿主最新设置后再保存。',
  MAIN_ROUTE_FUNDING_UNAVAILABLE: '宿主无法核验这条路线的模型、资金范围或限额。请重新检查路线配置。',
  BOT_SETTINGS_SCOPE_DENIED: '宿主拒绝了这次授权：所选模型、工具、模式或工作区已不在有效目录内。',
  BOT_SETTINGS_INCOMPLETE: '宿主认为绑定还不完整：模型、工作区、资金范围或预算缺失。',
  BOT_SETTINGS_UNKNOWN_TOOL: '官方工具必须来自宿主固定注册表。',
  BOT_SETTINGS_RETIRED: '此 Bot 已退休，身份不能重新授予。',
  BOT_SETTINGS_UNKNOWN_BOT: '此 Bot 不在已提交的宿主目录，请刷新。',
  REMOTE_OWNER_REQUIRED: '请以已认证的宿主拥有者身份保存 Bot 绑定。',
  BOT_SETTINGS_PUBLISH_FAILED: '绑定已提交，但宿主授权同步失败；此 Bot 已暂停，请刷新。',
}

/** Host failures are shown as the Host words them, never as a success. */
export const failureText = error => {
  const code = error?.code
  const message = error?.message ? String(error.message) : ''
  // A mapped code keeps the Host's own sentence: it names the exact route, tool or
  // mode that was refused, which a generic sentence would hide.
  if (code && FAILURES[code]) return message ? `${FAILURES[code]}（宿主：${message}）` : FAILURES[code]
  return message || '保存失败，宿主没有返回原因。'
}

export const workspaceLabel = (machine, root) => `${machine?.label ?? machine?.machineId ?? '未选择'} / ${root?.label ?? root?.rootId ?? '未选择'}`

export const toolSourceLabel = source => source || '厂商官方 CLI'
