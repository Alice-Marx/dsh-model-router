import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { discoverConfiguredRoutes, name } from '../router-core.mjs'
import { accountingContext, billingForResult, budgetFor, budgetSettings, packageEstimates, pausedExecutionBudget, routePricing, routerStateStore, routingPresetOf, savedState, stopExecutionLifecycle } from './router-state-billing.mjs'
import { annotateCliQuota, rerunSupport } from './router-runs.mjs'
import { attachPlanAccounting, planningFundingPrices } from './execution-accounting.mjs'
import { authorizeOfficialRequest } from './bot-official-execution.mjs'
import { beginExecutionLifecycle } from './execution-lifecycle.mjs'
import { buildTeamRunRecord } from './run-ledger.mjs'
import { configuredRoutesWithProfiles, finiteNumber, routeKey, text, throwIfAborted, valueOf } from './router-core-utils.mjs'
import { createPlanFromRoutes } from './harness-plan.mjs'
import { DEFAULT_ROUTER_SETTINGS } from './router.mjs'
import { DEFAULT_ROUTING_PRESET, routingPreset } from './routing-presets.mjs'
import { getOfficialTool, toolForProvider } from './official-tool-registry.mjs'
import { healthCache } from './tool-health.mjs'
import { installedToolIds } from './official-tools-runtime.mjs'
import { officialTeamFunding, planDataOptions, reportRunProgress, routesWithLearning, routingSavedState } from './router-planning.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness } from './official-tool-executor.mjs'
import { routeBoundaries } from './security-boundaries.mjs'
import { runOfficialTeam } from './official-team-runtime.mjs'
import { taskTextProblem } from './task-executors.mjs'
import { WORKBENCH_RUN_ID } from './router-workbench.mjs'

/** Per-route read/write boundaries for the security card. */
export async function securityBoundaries(ctx, config = {}) {
  const routes = configuredRoutesWithProfiles(await discoverConfiguredRoutes(ctx), config)
  const readiness = await Promise.all(['claude-code', 'codex'].map(id => officialToolReadiness(id).catch(() => ({ id, ready: false }))))
  const sandboxedToolIds = readiness.filter(item => item.ready && typeof ctx.sandbox?.confine === 'function').map(item => item.id)
  return { platform: process.platform, sandboxAvailable: typeof ctx.sandbox?.confine === 'function', boundaries: routeBoundaries(routes, { sandboxedToolIds, platform: process.platform }) }
}

export function explicitRoute(args, routes) {
  const provider = text(args.provider)
  const model = text(args.model)
  if (Boolean(provider) !== Boolean(model)) throw new Error('provider 和 model 必须同时提供。')
  if (!provider) return null
  const route = routes.find(item => item.provider === provider && item.model === model)
  if (!route) throw new Error(`路线 ${provider}/${model} 不在 Harness 模型目录中；可先调用 model_router_routes 查看可用路线。`)
  return route
}

function currentAgentRoute(agent) {
  try {
    const config = agent?.session?.requestHeader?.()?.config
    if (text(config?.provider) && text(config?.model)) return { provider: config.provider, model: config.model }
  } catch { /* background tools need not have a session-backed agent */ }
  return null
}

export function chooseConsultRoute(plan, routes, agent) {
  const current = currentAgentRoute(agent)
  const differs = route => current === null || routeKey(route) !== routeKey(current)
  const preferred = routes.find(route => route.provider === plan.selected?.provider && route.model === plan.selected?.model)
  if (preferred && differs(preferred)) return preferred
  return routes.find(differs) ?? preferred ?? routes[0]
}

/** Manual package > manual tool > saved route mapping > CLI default. */
export function resolveTeamCliModelBindings(plan, routes, requested = {}) {
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
    throw new Error('cliModelsJson 必须是以工作包或官方工具 ID 为键的 JSON 对象')
  }
  const byRoute = new Map(routes.map(route => [routeKey(route), route]))
  const bindings = Object.create(null)
  for (const item of plan.team.workPackages) {
    const toolId = toolForProvider(item.recommendedProvider)?.id
    const profile = byRoute.get(`${item.recommendedProvider}\u0000${item.recommendedModel}`)
    if (profile?.cliModel && toolId !== 'zcode') bindings[item.id] = profile.cliModel
    if (Object.hasOwn(requested, toolId)) bindings[item.id] = requested[toolId]
    if (Object.hasOwn(requested, item.id)) bindings[item.id] = requested[item.id]
  }
  // Keep the supplied keys so the runtime can reject unknown tool/package IDs.
  return { ...bindings, ...Object.fromEntries(Object.entries(requested)
    .filter(([key]) => !Object.hasOwn(bindings, key))) }
}

/** Only plan team packages on an installed CLI that is ready in this mode. */
export function executableTeamRoutes(routes, installed, readiness, mode, capabilities = officialToolExecutionCapabilities()) {
  const available = new Set(installed)
  const ready = new Map(readiness.map(item => [item.id, item]))
  const supported = new Map(capabilities.map(item => [item.id, item]))
  return routes.filter(route => {
    const id = toolForProvider(route.provider)?.id
    const state = ready.get(id)
    const capability = supported.get(id)
    const readyModes = state?.readyModes ?? state?.modes ?? capability?.modes ?? []
    return available.has(id) && state?.ready === true && capability?.modes?.includes(mode)
      && readyModes.includes(mode)
  })
}

export function teamExecutionEnvironment(value = 'harness', mode = 'read-only') {
  if (!['harness', 'cli-native'].includes(value)) throw new Error('团队执行环境必须是 harness 或 cli-native')
  if (value === 'cli-native' && mode !== 'workspace-write') throw new Error('厂商 CLI 正常环境仅支持官方团队的 workspace-write 模式')
  return value
}

/** Plan a CLI-only team without starting a provider request or changing files. */
export async function planOfficialTeam(ctx, config = {}, args = {}, options = {}) {
  const taskText = text(args.task)
  const problem = taskTextProblem(taskText)
  if (problem) throw new Error(problem)
  const mode = args.mode ?? args.executionMode ?? 'read-only'
  if (!['read-only', 'workspace-write'].includes(mode)) throw new Error('团队执行模式必须是 read-only 或 workspace-write')
  const executionEnvironment = teamExecutionEnvironment(args.executionEnvironment, mode)
  const workspace = options.workspace ?? process.cwd()
  throwIfAborted(options.signal)
  const saved = await routingSavedState(config)
  const [routes, installed] = await Promise.all([
    routesWithLearning(ctx, config, options.signal, saved.runs, saved.dynamicData, saved.routingLearning),
    Array.isArray(options.installedToolIds) ? options.installedToolIds : installedToolIds(),
  ])
  const readiness = Array.isArray(options.readiness) ? options.readiness
    : await Promise.all(installed.map(id => (options.readinessFor ?? officialToolReadiness)(id, workspace, { executionEnvironment })))
  const capabilities = options.executionCapabilities ?? (options.capabilitiesFor ?? officialToolExecutionCapabilities)({ executionEnvironment })
  const executableRoutes = executableTeamRoutes(routes, installed, readiness, mode, capabilities)
  const base = { taskText, workspace, mode, executionEnvironment, plan: null, routes: executableRoutes, installed, readiness,
    executionCapabilities: capabilities, executionReadiness: readiness, cliModels: {}, budget: null }
  if (executionEnvironment === 'harness' && typeof ctx.sandbox?.confine !== 'function') {
    return { ...base, status: 'blocked', reason: '官方 Harness 进程沙箱不可用，不能执行官方 CLI 团队。' }
  }
  if (executableRoutes.length === 0) return { ...base, status: 'blocked',
    reason: `官方模型目录中没有同时满足已配置路线、已安装 CLI、托管执行适配器与 ${mode} 模式的供应商。请检查该模式下的 CLI 执行就绪状态。` }
  const supported = new Set(executableRoutes.map(route => toolForProvider(route.provider).id))
  const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
  const budgetUsd = Math.max(0, finiteNumber(args.budgetUsd, finiteNumber(configuredBudget, 0)))
  const fundingPrices = planningFundingPrices(executableRoutes, accountingContext(null, executableRoutes, true))
  const plan = createPlanFromRoutes(taskText, executableRoutes, {
    ...planDataOptions(saved, config), pricing: fundingPrices.pricing, mode: 'team', budgetUsd, installedToolIds: installed, forceOfficialCli: true,
    runnableToolIds: installed.filter(id => supported.has(id)), preset: routingPresetOf(config, args.preset),
  })
  plan.subscriptionPricedRoutes = fundingPrices.subscriptionPricedRoutes
  const bindingsText = text(args.cliModelsJson)
  if (bindingsText.length > 4_000) throw new Error('cliModelsJson 超过 4000 字符上限')
  let requestedModels = {}
  if (bindingsText) {
    try { requestedModels = JSON.parse(bindingsText) }
    catch { throw new Error('cliModelsJson 不是有效的 JSON 对象') }
  }
  const cliModels = resolveTeamCliModelBindings(plan, executableRoutes, requestedModels)
  attachPlanAccounting(plan, taskText, executableRoutes, accountingContext(null, executableRoutes, true))
  const budget = budgetFor(config, await savedState(), plan.accounting.apiEstimatedCostUsd, { apiExposure: plan.accounting.apiExposure })
  return { ...base, status: 'planned', plan, cliModels, budget }
}

/** Execute and record a planned team through official CLIs only. */
export async function executeOfficialTeamPlan(ctx, config = {}, planned, options = {}) {
  if (planned?.status === 'blocked') return { ...planned }
  if (!planned?.plan || !['read-only', 'workspace-write'].includes(planned.mode)) throw new Error('缺少有效的官方 CLI 团队计划')
  const executionEnvironment = teamExecutionEnvironment(planned.executionEnvironment, planned.mode)
  const workspace = options.workspace ?? planned.workspace
  attachPlanAccounting(planned.plan, planned.taskText, planned.routes, accountingContext(null, planned.routes, true))
  const budget = budgetFor(config, await savedState(), planned.plan.accounting.apiEstimatedCostUsd, { apiExposure: planned.plan.accounting.apiExposure })
  const common = { plan: planned.plan, workspace, mode: planned.mode, executionEnvironment, budget }
  if (budget.exceeded && options.confirmOverBudget !== true) return { ...common, status: 'paused-budget',
    notice: `${budget.message} 已暂停团队执行。请向用户确认后再执行。` }
  if (executionEnvironment === 'cli-native' && options.confirmUnsandboxed !== true) return { ...common,
    status: 'needs-confirmation', missing: ['unsandboxed'],
    reasons: confirmationReasons(['unsandboxed'], { executionEnvironment }),
    notice: '厂商 CLI 正常环境必须明确确认后才会启动。' }
  if (executionEnvironment === 'harness' && typeof ctx.sandbox?.confine !== 'function') return { ...common, status: 'blocked',
    reason: '官方 Harness 进程沙箱不可用，不能执行官方 CLI 团队。' }
  throwIfAborted(options.signal)
  const startedAt = Date.now()
  const runId = options[WORKBENCH_RUN_ID] ?? randomUUID()
  const makeTeamRecord = (execution, location = {}) => {
    const run = buildTeamRunRecord({ id: runId, createdAt: startedAt, finishedAt: Date.now(), task: planned.taskText,
      plan: planned.plan, execution, mode: planned.mode, workspace,
      preset: planned.plan.preset ?? DEFAULT_ROUTING_PRESET, pricingFor: item => routePricing(planned.routes, item), billingFor: billingForResult,
      budget: { estimateUsd: budget.estimateUsd, confirmed: options.confirmOverBudget === true } })
    run.executionEnvironment = executionEnvironment
    run.cliModels = { ...planned.cliModels }
    if (planned.mode === 'workspace-write' && location.workspace) run.isolatedWorkspace = location.workspace
    if (location.baseCommit) run.baseCommit = location.baseCommit
    return run
  }
  const lifecycle = await beginExecutionLifecycle({ state: routerStateStore(), settings: budgetSettings(config),
    officialExecution: officialTeamFunding(ctx, planned.plan, planned.cliModels, planned.mode, executionEnvironment),
    confirmOverBudget: options.confirmOverBudget === true, packageEstimates: packageEstimates(planned.plan, planned.taskText),
    buildRun: ({ status, results, workspace: location }) => makeTeamRecord({ status, results }, location) })
  if (!lifecycle.accepted) return { ...common, status: 'paused-budget', budget: pausedExecutionBudget(lifecycle) }
  let execution
  try { execution = await (options.runTeam ?? runOfficialTeam)({ plan: planned.plan, task: planned.taskText, workspace,
    authorizeOfficial: request => authorizeOfficialRequest(ctx, request),
    allowedRoot: options.root ?? workspace, mode: planned.mode, executionEnvironment, installedIds: planned.installed,
    cliModels: planned.cliModels, signal: options.signal, sandbox: ctx.sandbox,
    onPackageStart: item => reportRunProgress(options, { type: 'package-start', package: item }),
    onPackage: item => reportRunProgress(options, { type: 'package-complete', package: item }),
    onStage: stage => reportRunProgress(options, { type: 'stage', stage }),
    onCheckpointStart: item => lifecycle.onCheckpointStart(item), onCheckpointResult: result => lifecycle.onCheckpointResult(result),
    onWorkspace: value => lifecycle.onWorkspace(value) }) }
  catch (error) { await stopExecutionLifecycle(lifecycle, error); throw error }
  await reportRunProgress(options, { type: 'stage', stage: 'saving' })
  const run = makeTeamRecord(execution, { workspace: execution.workspace, baseCommit: execution.baseCommit })
  try {
    await annotateCliQuota(run, config, (execution.results ?? []).filter(item => item.status !== 'succeeded' && item.toolId)
      .map(item => ({ id: item.id, toolId: item.toolId, text: `${item.error ?? ''}\n${item.outputTail ?? ''}` })))
    await lifecycle.finish(run)
  } catch (error) { await lifecycle.interrupt(run); throw error }
  return { ...common, status: execution.status, execution, run, runId: run?.id ?? null,
    rerunNotice: planned.mode === 'read-only'
      ? '失败的工作包可用 model_router_rerun_step 单步重跑（只重跑该步及其未完成的下游）。'
      : '若在某个步骤失败而停止，可用 model_router_rerun_step 在新的独立工作树中套用之前的改动后续跑（需审批）；已整合或待人工整合的运行不能单步重跑。',
    modelNotice: '已配置 cliModel 的路线按工作包传给官方 CLI；所有厂商无映射时使用 CLI 默认模型。请求模型、Harness 推荐模型与 CLI 回报的实际模型分别记录；未核验实际模型时不按推荐路线价格计算实际费用。',
    billingNotice: 'budgetUsd 仅影响估算与路由，无法限制官方 CLI 账号实际费用。' }
}

/** What was assigned and why, per package: route, difficulty, estimated cost, channel. */
export function decisionSummary(plan) {
  const packages = plan?.routingBypassed
    ? [{ id: 'direct', name: '指定模型', recommendedProvider: plan.selected?.provider, recommendedModel: plan.selected?.model,
      difficulty: plan.complexity?.band, estimatedCost: plan.estimatedCost, executionChannel: plan.executionChannel, channelDetail: plan.channelDetail }]
    : plan?.team?.workPackages ?? []
  return {
    preset: plan?.preset ?? DEFAULT_ROUTING_PRESET,
    complexity: plan?.complexity ?? null,
    reason: plan?.reason ?? '',
    accounting: plan?.accounting ?? null,
    estimatedCost: plan?.accounting ? plan.accounting.apiEstimatedCostUsd : plan?.estimatedCost ?? null,
    packages: packages.map(item => ({
      id: item.id, name: item.name, route: `${item.recommendedProvider}/${item.recommendedModel}`,
      difficulty: item.difficulty ?? null, estimatedCost: item.estimatedCost ?? null,
      channel: item.executionChannel ?? null, channelDetail: item.channelDetail ?? '',
      dependsOn: item.dependsOn ?? [],
      ...(item.manualAssignment ? { manualAssignment: item.manualAssignment, selectionSource: 'manual',
        algorithmRecommendation: item.algorithmRecommendation ?? null,
        ...(item.manualAssignment.kind === 'tool' ? { toolId: item.manualAssignment.toolId,
          toolLabel: getOfficialTool(item.manualAssignment.toolId)?.label ?? item.manualAssignment.toolId } : {}) } : {}),
    })),
  }
}

export function commandText(plan) {
  const selected = plan.selected ? `${plan.selected.provider}/${plan.selected.model}` : '没有可用路线'
  const channel = plan.executionChannel === 'official-cli'
    ? `官方 CLI（${plan.channelLabel ?? plan.channelTool}）`
    : '官方模型目录 API'
  return [
    `推荐路线：${selected}`,
    `方案：${routingPreset(plan.preset).label}；复杂度：${plan.complexity.band}（难度分 ${plan.complexity.value}）；任务类型：${plan.taskType}`,
    `执行渠道：${channel}；估算成本：${plan.estimatedCost === null ? '价格资料不足' : `$${plan.estimatedCost.toFixed(6)}（仅估算）`}`,
    `工作包：${plan.subtasks.map(item => `${item.name} → ${item.recommendedProvider}/${item.recommended}`).join('；')}`,
    plan.team.handoff,
    plan.budgetStatus?.exceeded ? `预算：${plan.budgetStatus.message}` : '',
  ].filter(Boolean).join('\n')
}

const HEADLESS_CLI_IDS = new Set(['claude-code', 'codex', 'gemini'])

/** Whether a read-only execution could start a headless CLI without the Harness sandbox. */
function mayLaunchDirectCli(args = {}) {
  const provider = text(args?.provider)
  if (provider) {
    const tool = toolForProvider(provider)
    if (!tool || !HEADLESS_CLI_IDS.has(tool.id)) return false
    return healthCache.loginState(tool.id)?.state !== 'logged-out'
  }
  const report = healthCache.report()
  if (!report) return true
  return report.tools.some(item => HEADLESS_CLI_IDS.has(item.id) && item.installed && healthCache.loginState(item.id)?.state !== 'logged-out')
}

const APPROVAL_TEXT = Object.freeze({
  'workspace-write': sandbox => ({
    reason: 'Official CLI models will use their normal tools in an isolated Git worktree and integrate their patch into the current workspace',
    en: `Edit files: the official CLI model may use shell, skills, configured MCP and other normal tools in an isolated Git worktree, then its patch is applied to this workspace. ${sandbox ? 'Launches are wrapped by the Harness process sandbox.' : 'The Harness process sandbox is unavailable, so the launch will be refused.'}`,
    zh: `修改文件：官方 CLI 模型会在独立 Git 工作树中使用终端、技能、已配置 MCP 等工具，并把改动补丁应用回当前工作区；可写范围为独立工作树及补丁涉及的源文件。${sandbox ? '启动由 Harness 进程沙箱包装（Windows ACL 后端为部分强制）。' : '当前没有 Harness 进程沙箱，启动会被拒绝。'}`,
  }),
  'rerun-write': () => ({
    reason: 'Re-run an editable step on a fresh isolated Git worktree seeded with the earlier changes, then integrate the patch',
    en: 'Edit files: the step is re-run in a fresh isolated Git worktree that first receives the earlier run\'s changes; on success the combined patch is applied to this workspace (it must be a clean Git repository at the same commit).',
    zh: '修改文件：在新的独立 Git 工作树中先套用原运行的改动，再重跑该步骤及其下游；成功后把合并补丁应用回当前工作区（要求工作区干净且仍在原基线提交）。',
  }),
  'subscription-api': () => ({
    reason: 'Retry a paused step on the API key after its subscription attempt failed (not a quota limit)',
    en: 'Use the API key: the subscription attempt for this step failed for a reason other than quota; the retry is billed to the API account.',
    zh: '改用 API Key 重试：该步骤的订阅调用失败（不是额度用尽或限流），重试会按 API 计费并计入预算。',
  }),
  'over-budget': () => ({
    reason: 'Run although the configured daily or monthly model budget would be exceeded',
    en: 'Over budget: this run exceeds the configured daily or monthly budget (estimated from configured prices).',
    zh: '超出预算：本次执行会超出设置的每日或每月预算（按已配置单价估算）。',
  }),
  unsandboxed: () => ({
    reason: 'An official CLI may be started directly, outside the Harness process sandbox, in read-only headless mode',
    en: 'Unsandboxed CLI: the routed model may run its official CLI directly (claude -p / codex exec / gemini -p) without the Harness process sandbox; read-only is enforced only by the CLI flags.',
    zh: '不经沙箱启动 CLI：分配的模型可能直接启动其官方 CLI（claude -p / codex exec / gemini -p），不经过 Harness 进程沙箱；只读仅由 CLI 自身参数保证（Codex 可读取当前用户可读的文件）。可在设置中关闭此确认。',
  }),
})

/**
 * Every reason one model-facing run needs the user's approval, in a fixed
 * order: file edits, API-key billing, budget, unsandboxed CLI. Returned as
 * codes so the workbench confirm panel and the approval prompt agree.
 */
export function approvalReasonCodes(name, args = {}, config = {}, { rerunRun = null } = {}) {
  const codes = []
  const runKinds = ['model_router_execute', 'model_router_rerun_step', 'model_router_team_execute', 'model_router_tool_run', 'model_router_consult']
  if (!runKinds.includes(name)) return codes
  if ((name === 'model_router_tool_run' || name === 'model_router_team_execute') && args.mode === 'workspace-write') codes.push('workspace-write')
  if (name === 'model_router_rerun_step' && rerunRun && rerunSupport(rerunRun).writes) codes.push(rerunRun.kind === 'tool' ? 'workspace-write' : 'rerun-write')
  if (name === 'model_router_rerun_step' && args.subscriptionChoice === 'api') codes.push('subscription-api')
  if (args.confirmOverBudget === true) codes.push('over-budget')
  const directRun = name === 'model_router_execute' && args.assignmentMode !== 'manual'
    || (name === 'model_router_rerun_step' && (!rerunRun || rerunSupport(rerunRun).kind === 'assign') && rerunRun?.assignmentMode !== 'manual')
  if ((name === 'model_router_team_execute' && args.executionEnvironment === 'cli-native')
    || (name === 'model_router_rerun_step' && rerunRun?.executionEnvironment === 'cli-native')) codes.push('unsandboxed')
  if (directRun && valueOf(config, 'confirmUnsandboxedCli', true) !== false && mayLaunchDirectCli(args)) codes.push('unsandboxed')
  return codes
}

function executionApprovalText(code, sandboxAvailable, executionEnvironment) {
  if (executionEnvironment === 'cli-native' && ['workspace-write', 'unsandboxed'].includes(code)) {
    return { reason: 'Run verified official CLIs with the current user permissions, outside the Harness process sandbox',
      zh: code === 'workspace-write'
        ? '修改文件：CLI 在独立 Git 工作树执行，成功后核对并整合补丁。工作树用于改动回收，不构成操作系统读写边界。'
        : '厂商 CLI 正常环境：使用原登录、配置、技能及 MCP，以当前用户权限运行，不经过 Harness 进程沙箱。工具可能访问工作树外当前用户可访问的资源；不会自动切换执行环境。',
      en: code === 'workspace-write'
        ? 'Edit in an isolated Git worktree and integrate the verified patch. The worktree collects changes; it is not an OS file-access boundary.'
        : 'Run the verified vendor CLI with its original login, configuration, skills and MCP under the current user permissions, outside the Harness process sandbox. Tools can access resources outside the worktree. This environment is never selected automatically.' }
  }
  return APPROVAL_TEXT[code](sandboxAvailable)
}

export function approvalReasons(name, args, config, { sandboxAvailable = false, rerunRun = null } = {}) {
  return approvalReasonCodes(name, args, config, { rerunRun }).map(code => ({ code,
    ...executionApprovalText(code, sandboxAvailable, rerunRun?.executionEnvironment ?? args.executionEnvironment) }))
}

/** One approval prompt listing every reason, so the user is asked once. */
export function combinedAsk(reasons) {
  if (reasons.length === 1) {
    const [only] = reasons
    return { kind: 'ask', reason: only.reason, displayReason: { en: `${only.en} Allow?`, zh: `${only.zh} 允许执行吗？` }, reasons: reasons.map(item => item.code) }
  }
  return {
    kind: 'ask',
    reason: reasons.map(item => item.reason).join('; '),
    displayReason: {
      en: `This run needs your approval for ${reasons.length} reasons:\n${reasons.map((item, index) => `${index + 1}. ${item.en}`).join('\n')}\nAllow?`,
      zh: `本次执行需要确认以下 ${reasons.length} 项：\n${reasons.map((item, index) => `${index + 1}. ${item.zh}`).join('\n')}\n全部允许并继续吗？`,
    },
    reasons: reasons.map(item => item.code),
  }
}

/** Reasons in the workbench's shape: code plus the Chinese and English text. */
export function confirmationReasons(codes, { sandboxAvailable = false, executionEnvironment = 'harness' } = {}) {
  return codes.map(code => ({ code, ...executionApprovalText(code, sandboxAvailable, executionEnvironment) }))
}
