import { isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { name } from '../router-core.mjs'
import { accountingContext, billingContext, billingForResult, budgetFor, budgetSettings, checkpointSubscription, fileExists, noteCliQuota, packageEstimates, pausedExecutionBudget, pausedSteps, reserveChangedApiRoute, routePricing, routerStateStore, routingPresetOf, savedState, stopExecutionLifecycle } from './router-state-billing.mjs'
import { accountingEstimates, attachPlanAccounting, initialFunding } from './execution-accounting.mjs'
import { beginExecutionLifecycle } from './execution-lifecycle.mjs'
import { billingPlan } from './subscription-billing.mjs'
import { boundedInteger, text, valueOf } from './router-core-utils.mjs'
import { buildTeamRunRecord, buildToolRunRecord, mergeRerun, spending, storedResults, teamExecutionResults } from './run-ledger.mjs'
import { consultConfiguredModel, consultWithQualityGate, dynamicOptions, executionHooks, officialExecutionFor, officialTeamFunding, planDataOptions, routesWithLearning, routingSavedState, validateManualTools } from './router-planning.mjs'
import { createBudgetReservations, reservationSpending } from './budget-reservations.mjs'
import { createPlanFromRoutes } from './harness-plan.mjs'
import { DEFAULT_OFFICIAL_MODEL, authorizeOfficialRequest, officialAdmissionAvailable } from './bot-official-execution.mjs'
import { DEFAULT_ROUTING_PRESET } from './routing-presets.mjs'
import { downstreamPackageIds, rerunAssignmentPackage, taskTextProblem } from './task-executors.mjs'
import { dynamicDataSummary, routingData } from './dynamic-data.mjs'
import { estimateAssignedPackage } from './router.mjs'
import { getOfficialTool, toolForProvider } from './official-tool-registry.mjs'
import { installedToolIds } from './official-tools-runtime.mjs'
import { parsePackageAssignments } from './package-assignments.mjs'
import { parseQualityGateJson } from './quality-gates.mjs'
import { resolveTeamCliModelBindings, teamExecutionEnvironment } from './router-team.mjs'
import { runOfficialTask, runOfficialTeam } from './official-team-runtime.mjs'
import { subscriptionUsage } from './subscription-usage.mjs'
import { twoLedgers } from './ledgers.mjs'

async function storedRun(runId) {
  const saved = await savedState()
  const run = saved.runs.find(item => item.id === text(runId))
  if (!run) throw new Error(`未找到运行记录 ${text(runId)}`)
  return { run, saved }
}

/** Re-run one failed (or, with a new route, any) step and its unfinished downstream steps. */
/**
 * Whether a recorded run can be re-run and whether that rerun edits files.
 * Editable team reruns continue on a fresh worktree seeded with the earlier,
 * never integrated worktree; they need a recorded base commit and an
 * incomplete (not integrated) run.
 */
export function rerunSupport(run) {
  if (!run) return { ok: false, reason: '未找到运行记录。' }
  if (run.kind === 'tool') {
    const toolId = run.toolRun?.toolId ?? run.packages?.[0]?.toolId
    if (!toolId) return { ok: false, reason: '该单次调用记录缺少官方工具 ID，无法重跑；请直接再次调用 model_router_tool_run。' }
    return { ok: true, kind: 'tool', writes: run.executionMode === 'workspace-write' }
  }
  if (run.kind === 'team' && run.executionMode === 'workspace-write') {
    if (!['incomplete', 'cancelled'].includes(run.status)) {
      return { ok: false, reason: run.status === 'integration-pending'
        ? '该可编辑团队运行的改动尚待人工整合（独立工作区已保留）；请先核对并整合，再重新执行整个团队任务。'
        : '该可编辑团队运行的改动已整合到工作区；单步重跑会重复套用改动。如需重做请重新调用 model_router_team_execute。' }
    }
    if (!run.isolatedWorkspace || !run.baseCommit) {
      return { ok: false, reason: '该可编辑团队运行没有记录独立工作区或 Git 基线（旧版本记录），无法安全续跑；请重新调用 model_router_team_execute。' }
    }
    return { ok: true, kind: 'team-write', writes: true }
  }
  return { ok: true, kind: run.kind === 'team' ? 'team' : 'assign', writes: false }
}

/** Estimate exactly the packages a retry will start, retaining unknown prices. */
function rerunEstimates(run, ids, targetId, override, routes, dataOptions) {
  const estimates = new Map()
  for (const item of run.packages.filter(item => ids.has(item.id))) {
    const assigned = item.id === targetId ? override : null
    const provider = assigned?.provider ?? item.provider ?? item.recommendedProvider
    const model = assigned?.model ?? item.model ?? item.recommendedModel
    const changedRoute = provider !== item.recommendedProvider || model !== item.recommendedModel
    const reassignsRoute = assigned && (assigned.provider !== (item.provider ?? item.recommendedProvider)
      || assigned.model !== (item.model ?? item.recommendedModel))
    let estimate = item.estimatedCost
    // An unchanged route can retain its planned effort; changing identity uses
    // the new adapter's default effort, just like rerunAssignmentPackage.
    if (reassignsRoute || changedRoute) {
      const route = routes.find(route => route.provider === provider && route.model === model)
      estimate = route ? estimateAssignedPackage(route, item, run.task,
        run.decision?.complexity?.band ?? 'balanced', dataOptions).estimatedCost : null
    }
    estimates.set(item.id, Number.isFinite(estimate) && estimate >= 0 ? estimate : null)
  }
  const values = [...estimates.values()]
  const total = values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null
  return { byId: estimates, total: Number.isFinite(total) ? total : null }
}

export async function rerunRecordedStep(ctx, config = {}, { runId, packageId, provider, model, confirmOverBudget = false, confirmWrite = false, confirmUnsandboxed = false, subscriptionChoice = null, workspace, root, signal, ...options } = {}) {
  const { run, saved } = await storedRun(runId)
  if(run.kind==='model-call')throw new Error('模型调用收据不能作为旧工作包重跑，请在原对话中重试。')
  if(run.kind==='cli-task')throw new Error('CLI任务必须由原Task创建新attempt重试，不能通过旧工作包入口重放。')
  if (saved.budgetReservations?.[run.id]) throw new Error('该运行仍在执行或费用待核对，请先核对原任务与厂商账单，不能直接重跑。')
  const target = run.packages.find(item => item.id === text(packageId))
  if (!target) throw new Error(`运行记录中没有工作包 ${text(packageId)}`)
  const choice = text(subscriptionChoice) || null
  if (choice && !['api', 'subscription', 'cancel'].includes(choice)) throw new Error('subscriptionChoice 只能是 api、subscription 或 cancel')
  if (choice && !target.paused) throw new Error('该步骤没有在等待订阅失败的确认；直接重跑即可。')
  if (choice === 'cancel') return { run: await cancelPausedStep(run.id, target.id), execution: null, budget: null, cancelled: true }
  const refreshed = await routingSavedState(config)
  const routes = await routesWithLearning(ctx, config, signal, refreshed.runs, refreshed.dynamicData, refreshed.routingLearning)
  let override = null
  if (text(provider) || text(model)) {
    if (!text(provider) || !text(model)) throw new Error('改派需要同时提供 provider 和 model')
    if (valueOf(config, 'allowManualReassign', true) === false) throw new Error('设置中已关闭手动改派。')
    if (!routes.some(route => route.provider === text(provider) && route.model === text(model))) {
      throw new Error(`路线 ${text(provider)}/${text(model)} 不在 Harness 模型目录中；请在官方“模型”页添加后重试，或选择列表中的其他路线。`)
    }
    override = { provider: text(provider), model: text(model) }
  } else if (target.ok) {
    throw new Error('该步骤已成功；如需换模型重做，请指定改派的 provider/model。')
  }
  if (choice && run.kind !== 'assign' && run.kind !== undefined) throw new Error('只有路由执行的步骤会因订阅失败暂停。')
  const support = rerunSupport(run)
  if (!support.ok) throw new Error(support.reason)
  if (support.kind === 'tool') {
    if (override) throw new Error('单次调用的重跑沿用原工具和模型；如需换模型请直接调用 model_router_tool_run。')
    return rerunToolRun(ctx, config, { run, confirmOverBudget, confirmWrite, workspace, root, signal, options })
  }
  if (support.kind === 'team-write' && target.ok) {
    throw new Error('可编辑团队运行只能续跑失败或未完成的步骤：已成功步骤的改动已在原独立工作区中，重跑会重复套用。如需重做请重新调用 model_router_team_execute。')
  }
  const missingConfirmations = []
  if (support.writes && confirmWrite !== true) missingConfirmations.push('workspace-write')
  if (run.kind === 'team' && run.executionEnvironment === 'cli-native' && confirmUnsandboxed !== true) missingConfirmations.push('unsandboxed')
  if (missingConfirmations.length) {
    return { paused: true, needsConfirmation: missingConfirmations, run,
      budget: null, message: '请确认续跑所需的文件修改与执行环境权限后继续；厂商 CLI 正常环境以当前用户权限运行，独立 Git 工作树不是操作系统读写边界。' }
  }
  const retryIds = new Set([target.id, ...downstreamPackageIds(run.packages, target.id)
    .filter(id => run.packages.find(item => item.id === id)?.ok !== true)])
  const estimates = rerunEstimates(run, retryIds, target.id, override, routes, planDataOptions(refreshed, config))
  const retryBilling = await billingContext(config, options)
  const retryPlan = teamPlanFromRun(run, [...retryIds], override, target.id, estimates.byId)
  if (run.kind !== 'team') for (const item of retryPlan.team.workPackages) {
    const previous = run.packages.find(entry => entry.id === item.id)
    if (!override || item.id !== target.id) { item.recommendedProvider = previous.provider ?? previous.recommendedProvider; item.recommendedModel = previous.model ?? previous.recommendedModel }
  }
  const retryContext = accountingContext(retryBilling, routes, run.kind === 'team')
  retryContext.billingChoices = choice ? { [target.id]: choice } : {}
  attachPlanAccounting(retryPlan, run.task, routes, retryContext)
  estimates.reservations = accountingEstimates(retryPlan)
  const budget = budgetFor(config, saved, retryPlan.accounting.apiEstimatedCostUsd, { apiExposure: retryPlan.accounting.apiExposure })
  if (budget.exceeded && confirmOverBudget !== true) {
    return { paused: true, budget: { ...budget, paused: true, message: `${budget.message} 已暂停重跑，请确认后再试。` }, run }
  }
  const cwd = text(workspace) || run.workspace
  if (!cwd || !(await fileExists(cwd))) throw new Error(`原运行的工作区 ${cwd || '(未记录)'} 不可用，无法重跑该步骤；请恢复该目录，或在原工作区的会话中调用 model_router_rerun_step。`)
  if (run.kind === 'team') return rerunTeamStep(ctx, { run, target, override, routes, budget,
    ids: [...retryIds], estimates: estimates.byId, reservations: estimates.reservations, confirmOverBudget, cwd, root: text(root) || cwd, signal, options, config })
  const manualRetries = Object.fromEntries(run.packages.filter(item => retryIds.has(item.id) && item.manualAssignment)
    .map(item => [item.id, item.id === target.id && override ? { kind: 'api', ...override } : item.manualAssignment]))
  if (Object.keys(manualRetries).length) {
    for (const [id, assignment] of Object.entries(parsePackageAssignments(manualRetries))) {
      if (assignment.kind !== 'api') continue
      const route = routes.find(item => item.provider === assignment.provider && item.model === assignment.model)
      if (!route) throw new Error('重跑所选的模型已不在官方目录中，请重新分配。')
      const policy = billingPlan(route, routes)
      if (policy.mode === 'subscription-only' || policy.subscription?.kind === 'plan-key') throw new Error('该模型使用订阅策略，不能作为手动 API 目标重跑。')
      const item = run.packages.find(entry => entry.id === id)
      if (item?.type === 'vision' && Array.isArray(route.inputModalities) && route.inputModalities.length
        && !route.inputModalities.some(value => String(value).toLowerCase() === 'image')) {
        throw new Error(`工作包 ${id} 需要图像模型，所选重跑目标仅声明其他输入能力。`)
      }
    }
    await validateManualTools(ctx, manualRetries, { ...options, workspace: cwd })
  }
  const limit = boundedInteger(valueOf(config, 'maxConsultOutputChars', 12_000), 12_000, 500, 50_000)
  const retryGate = parseQualityGateJson(valueOf(config, 'qualityGateJson', ''))
  const buildRetry = ({ status, results }) => {
    const next = structuredClone(run)
    mergeRerun(next, { status, packages: results }, { rerunIds: [...retryIds], pricingFor: item => routePricing(routes, item), billingFor: billingForResult })
    for (const item of next.packages) if (retryIds.has(item.id)) item.estimatedCost = estimates.byId.get(item.id) ?? null
    return next
  }
  const lifecycle = await beginExecutionLifecycle({ state: routerStateStore(), buildRun: buildRetry,
    packageEstimates: estimates.reservations,
    managedExecution: options.managedExecution,
    settings: budgetSettings(config), confirmOverBudget })
  if (!lifecycle.accepted) return { paused: true, run, budget: pausedExecutionBudget(lifecycle) }
  let execution
  try { execution = await rerunAssignmentPackage({
    task: run.task,
    packages: run.packages.map(item => ({
      id: item.id, name: item.name, objective: item.objective, dependsOn: item.dependsOn,
      type: item.type, purpose: item.purpose,
      ...(item.manualAssignment ? { manualAssignment: item.manualAssignment, selectionSource: 'manual',
        algorithmRecommendation: item.algorithmRecommendation } : {}),
      recommendedProvider: item.provider ?? item.recommendedProvider, recommendedModel: item.model ?? item.recommendedModel,
      ...(item.plannedReasoningEffort && item.provider === item.recommendedProvider && item.model === item.recommendedModel
        ? { recommendedReasoningEffort: item.plannedReasoningEffort } : {}),
    })),
    previous: storedResults(run),
    packageId: target.id,
    routingBypassed: run.routingBypassed,
    routes,
    override,
    workspace: cwd,
    signal,
    ...(choice ? { subscriptionChoice: choice } : {}),
    ...executionHooks(ctx, options),
    onCheckpointStart: item => lifecycle.onCheckpointStart(item),
    onCheckpointResult: result => lifecycle.onCheckpointResult(result),
    onSubscriptionResult: event => checkpointSubscription(lifecycle, event),
    billing: retryBilling,
    apiFallback: async ({ route, task: packageTask, signal: callSignal, subscription }) => {
      if (subscription) return consultConfiguredModel(ctx, route, packageTask, limit, callSignal)
      const id = lifecycle.activePackageId()
      const previous = run.packages.find(item => item.id === id)
      const expected = override && id === target.id ? override
        : { provider: previous?.provider ?? previous?.recommendedProvider, model: previous?.model ?? previous?.recommendedModel }
      const denied = await reserveChangedApiRoute(lifecycle, expected, route, packageTask, config, confirmOverBudget)
      return denied ?? consultWithQualityGate(ctx, route, packageTask, limit, callSignal, { gate: retryGate })
    },
  }) } catch (error) { await stopExecutionLifecycle(lifecycle, error); throw error }
  const updated = buildRetry({ status: execution.status, results: execution.packages })
  try { await lifecycle.finish(updated) } catch (error) { await lifecycle.interrupt(updated); throw error }
  const awaiting = pausedSteps(execution)
  return { run: updated, execution, budget, ...(awaiting.length ? { awaitingConfirmation: awaiting } : {}) }
}

/** The user cancelled a paused step: it and the steps waiting on it stop. */
async function cancelPausedStep(runId, packageId) {
  return routerStateStore().updateRun(runId, current => {
    const waiting = new Set(downstreamPackageIds(current.packages, packageId))
    for (const item of current.packages) {
      if (item.id === packageId) {
        Object.assign(item, { status: 'cancelled', cancelled: true, paused: false, ok: false,
          error: `已取消：${item.pause?.reason ?? item.error ?? ''}`.slice(0, 2_000) })
        delete item.pause
      } else if (waiting.has(item.id) && !item.ok) {
        Object.assign(item, { status: 'blocked', waiting: false, blocked: true, error: `上游步骤 ${packageId} 已取消。` })
      }
    }
    current.status = current.packages.some(item => item.paused) ? 'paused'
      : current.packages.some(item => item.ok) ? 'partial' : 'cancelled'
    current.finishedAt = Date.now()
  })
}

/** Stored team packages in plan shape; `override` reassigns the retried package. */
function teamPlanFromRun(run, ids, override, targetId, estimates) {
  const workPackages = run.packages.filter(item => ids.includes(item.id)).map(item => ({
    id: item.id, name: item.name, objective: item.objective, dependsOn: item.dependsOn ?? [],
    type: item.type ?? 'general', purpose: item.purpose ?? 'execution',
    verificationChecklist: item.verificationChecklist ?? [],
    recommendedProvider: item.id === targetId && override ? override.provider : item.recommendedProvider,
    recommendedModel: item.id === targetId && override ? override.model : item.recommendedModel,
    ...(item.plannedReasoningEffort && !(item.id === targetId && override
      && (override.provider !== item.recommendedProvider || override.model !== item.recommendedModel))
      ? { recommendedReasoningEffort: item.plannedReasoningEffort } : {}),
    estimatedCost: estimates.get(item.id) ?? null,
  }))
  return { mode: 'team', team: { workPackages } }
}

/**
 * Read-only team retry: the failed step plus downstream steps that had not
 * succeeded run through the same signed runner; earlier answers are context.
 */
async function rerunTeamStep(ctx, { run, target, override, routes, budget, ids, estimates, reservations, confirmOverBudget, cwd, root, signal, options, config = {} }) {
  const mode = run.executionMode === 'workspace-write' ? 'workspace-write' : 'read-only'
  const executionEnvironment = teamExecutionEnvironment(run.executionEnvironment, mode)
  const plan = teamPlanFromRun(run, ids, override, target.id, estimates)
  const cliModels = Object.fromEntries(Object.entries(run.cliModels ?? {}).filter(([key]) => ids.includes(key) && !(override && key === target.id)))
  if (override) {
    const reassignedPlan = { team: { workPackages: plan.team.workPackages.filter(item => item.id === target.id) } }
    Object.assign(cliModels, resolveTeamCliModelBindings(reassignedPlan, routes))
  }
  const previous = run.packages.filter(item => item.ok && !ids.includes(item.id))
    .map(item => ({ id: item.id, name: item.name, finalText: item.answer }))
  const runTeam = options.runTeam ?? runOfficialTeam
  const installed = Array.isArray(options.installedToolIds) ? options.installedToolIds : await installedToolIds()
  const buildRetry = ({ status, results, workspace = {} }) => {
    const next = structuredClone(run)
    const converted = teamExecutionResults(plan, { status, results })
    if (override) {
      const item = converted.packages.find(item => item.id === target.id)
      if (item) item.reassigned = true
    }
    mergeRerun(next, converted, { rerunIds: ids, pricingFor: item => routePricing(routes, item), billingFor: billingForResult })
    for (const item of next.packages) if (ids.includes(item.id)) item.estimatedCost = estimates.get(item.id) ?? null
    next.executionEnvironment = executionEnvironment
    if (mode === 'workspace-write' && workspace.workspace) next.isolatedWorkspace = workspace.workspace
    if (workspace.baseCommit) next.baseCommit = workspace.baseCommit
    return next
  }
  const lifecycle = await beginExecutionLifecycle({ state: routerStateStore(), buildRun: buildRetry,
    officialExecution: officialTeamFunding(ctx, plan, cliModels, mode, executionEnvironment),
    packageEstimates: reservations, settings: budgetSettings(config), confirmOverBudget })
  if (!lifecycle.accepted) return { paused: true, run, budget: pausedExecutionBudget(lifecycle) }
  let execution
  try { execution = await runTeam({ plan, task: run.task, workspace: cwd, allowedRoot: root ?? cwd, mode, executionEnvironment,
    authorizeOfficial: request => authorizeOfficialRequest(ctx, request),
    installedIds: installed, cliModels, signal, sandbox: ctx.sandbox, previous, onlyIds: ids,
    onCheckpointStart: item => lifecycle.onCheckpointStart(item), onCheckpointResult: result => lifecycle.onCheckpointResult(result),
    onWorkspace: value => lifecycle.onWorkspace(value),
    ...(mode === 'workspace-write' ? { seedFrom: { workspace: run.isolatedWorkspace, baseCommit: run.baseCommit } } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {}) }) }
  catch (error) { await stopExecutionLifecycle(lifecycle, error); throw error }
  const converted = teamExecutionResults(plan, execution)
  if (override) {
    const entry = converted.packages.find(item => item.id === target.id)
    if (entry) entry.reassigned = true
  }
  const quotaNotes = []
  for (const result of Array.isArray(execution?.results) ? execution.results : []) {
    if (result?.status === 'succeeded' || !result?.toolId) continue
    const note = await noteCliQuota(config, result.toolId, `${result.error ?? ''}\n${result.outputTail ?? ''}`)
    if (note) quotaNotes.push([result.id, note])
  }
  const updated = buildRetry({ status: execution.status, results: execution.results,
    workspace: { workspace: execution.workspace, baseCommit: execution.baseCommit } })
  const current = updated
    for (const item of current.packages) {
      if (ids.includes(item.id)) item.estimatedCost = estimates.get(item.id) ?? null
    }
    for (const [id, note] of quotaNotes) {
      const stored = current.packages.find(item => item.id === id)
      if (stored) stored.billingSwitch = note
    }
    current.status = execution?.status ?? current.status
    current.executionEnvironment = executionEnvironment
    if (mode === 'workspace-write' && execution?.workspace && execution.status !== 'blocked') {
      current.isolatedWorkspace = String(execution.workspace)
      if (typeof execution.baseCommit === 'string') current.baseCommit = execution.baseCommit
      if (execution.integration) current.integration = { ignoredArtifacts: execution.integration.ignoredArtifacts ?? 0 }
    }
    if (override) {
      const stored = current.packages.find(item => item.id === target.id)
      if (stored) { stored.recommendedProvider = override.provider; stored.recommendedModel = override.model }
      const bindings = { ...(current.cliModels ?? {}) }
      delete bindings[target.id]
      if (cliModels[target.id]) bindings[target.id] = cliModels[target.id]
      current.cliModels = bindings
    }
  try { await lifecycle.finish(updated) } catch (error) { await lifecycle.interrupt(updated); throw error }
  return { run: updated, execution: { ...converted, ranIds: ids, raw: execution }, budget }
}

/**
 * Repeat a recorded model_router_tool_run call as a new run linked by
 * `rerunOf`. An editable call starts from a fresh worktree of the current
 * checkout (the earlier, failed attempt is left in its own worktree).
 */
async function rerunToolRun(ctx, config, { run, confirmOverBudget, confirmWrite, workspace, root, signal, options = {} }) {
  if (run.packages?.[0]?.ok) throw new Error('该单次调用已成功；如需重做请直接再次调用 model_router_tool_run。')
  const meta = run.toolRun ?? { toolId: run.packages?.[0]?.toolId, provider: null, model: null, cliModel: null }
  const mode = run.executionMode === 'workspace-write' ? 'workspace-write' : 'read-only'
  const planned = await (options.planToolRun ?? planToolRun)(ctx, config, {
    tool: meta.toolId, task: run.task, mode, provider: meta.provider ?? undefined, model: meta.model ?? undefined, cliModel: meta.cliModel ?? undefined,
  }, { signal })
  if (planned.budget.exceeded && confirmOverBudget !== true) {
    return { paused: true, run, budget: { ...planned.budget, paused: true, message: `${planned.budget.message} 已暂停重跑，请确认后再试。` } }
  }
  if (mode === 'workspace-write' && confirmWrite !== true) {
    return { paused: true, needsConfirmation: ['workspace-write'], run, budget: planned.budget,
      message: '重跑可编辑单次调用会在新的独立 Git 工作树中修改文件并整合回工作区，需要先确认。' }
  }
  const cwd = text(workspace) || run.workspace
  if (!cwd || !(await fileExists(cwd))) throw new Error('原运行的工作区不可用，无法重跑；请在原工作区的会话中重试。')
  const { result, recorded } = await runPlannedTool(ctx, config, planned, { cwd, root: text(root) || cwd, signal, rerunOf: run.id,
    confirmOverBudget,
    ...(options.runTask ? { runTask: options.runTask } : {}) })
  const execution = { status: result.status, packages: recorded?.packages ?? [], ranIds: ['direct'], raw: result }
  return { run: recorded ?? run, execution, budget: planned.budget, rerunOf: run.id, newRunId: recorded?.id ?? null }
}

/** Ledger record for model_router_team_execute; storage failures never fail the run. */
/** Attach a recorded quota hit to the stored package of a CLI-only run. */
export async function annotateCliQuota(run, config, failures) {
  for (const failure of failures) {
    const note = await noteCliQuota(config, failure.toolId, failure.text)
    const stored = note ? run.packages.find(item => item.id === failure.id) : null
    if (stored) stored.billingSwitch = note
  }
}

export async function recordTeamRun({ task, plan, execution, mode, executionEnvironment = 'harness', workspace, routes, cliModels, budget, startedAt, preset, config = {} }) {
  const run = buildTeamRunRecord({
    id: randomUUID(), createdAt: startedAt, finishedAt: Date.now(), task, plan, execution, mode, workspace,
    preset: plan?.preset ?? preset ?? DEFAULT_ROUTING_PRESET,
    pricingFor: item => routePricing(routes, item), billingFor: billingForResult,
    budget: budget ? { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: false, confirmed: budget.exceeded ? true : undefined } : null,
  })
  run.executionEnvironment = teamExecutionEnvironment(executionEnvironment, mode ?? 'read-only')
  const bindings = Object.fromEntries(Object.entries(cliModels ?? {}).filter(([, value]) => typeof value === 'string' && value))
  if (Object.keys(bindings).length) run.cliModels = bindings
  await annotateCliQuota(run, config, (Array.isArray(execution?.results) ? execution.results : [])
    .filter(result => result?.status !== 'succeeded' && result?.toolId)
    .map(result => ({ id: result.id, toolId: result.toolId, text: `${result.error ?? ''}\n${result.outputTail ?? ''}` })))
  try { await routerStateStore().appendRun(run); return run } catch { return null }
}

/**
 * Validate a model_router_tool_run request and estimate it. The estimate uses
 * the configured price of the named provider/model route; without a route (CLI
 * default model) the cost is unknown and only already-exceeded budgets pause.
 */
export async function planToolRun(ctx, config, args = {}, { signal } = {}) {
  const toolId = text(args.tool)
  const tool = getOfficialTool(toolId)
  if (!tool) throw new Error(`未知的官方工具 ${toolId || '(空)'}；可用 ID 见 model_router_tools。`)
  const taskText = text(args.task)
  const problem = taskTextProblem(taskText)
  if (problem) throw new Error(problem)
  const mode = args.mode === 'workspace-write' ? 'workspace-write' : 'read-only'
  let modelId = null
  let route = null
  let routes = []
  if (text(args.provider) || text(args.model)) {
    if (!text(args.provider) || !text(args.model)) throw new Error('provider 和 model 必须同时提供')
    if (toolForProvider(args.provider)?.id !== toolId) throw new Error('所选模型供应商与官方 CLI 工具不匹配')
    const refreshed = await routingSavedState(config)
    routes = await routesWithLearning(ctx, config, signal, refreshed.runs, refreshed.dynamicData, refreshed.routingLearning)
    route = routes.find(item => item.provider === text(args.provider) && item.model === text(args.model)) ?? null
    if (!route) throw new Error('所选 provider/model 不在官方模型目录中')
    modelId = route.cliModel && toolId !== 'zcode' ? route.cliModel : null
  }
  if (text(args.cliModel) === DEFAULT_OFFICIAL_MODEL) modelId = null
  else if (text(args.cliModel)) {
    if (!route && !officialAdmissionAvailable(ctx)) throw new Error('cliModel 需要同时提供已配置的 provider 和 model 路线')
    if (toolId === 'zcode') throw new Error('ZCode CLI 不支持在单次调用中指定模型')
    modelId = text(args.cliModel)
  }
  const admission = await authorizeOfficialRequest(ctx, { toolId, mode, executionEnvironment: 'harness',
    ...(text(args.cliModel) ? { cliModel: text(args.cliModel) } : modelId ? { cliModel: modelId } : {}) })
  modelId = admission.modelId
  const estimate = route ? createPlanFromRoutes(taskText, routes, { mode: 'direct', directProvider: route.provider, directModel: route.model }).estimatedCost : null
  const funding = initialFunding(route ?? {}, { ...accountingContext(null, routes, true), toolId })
  const apiEstimate = funding.billing === 'subscription' ? 0 : estimate
  const budget = budgetFor(config, await savedState(), apiEstimate, { apiExposure: funding.billing === 'api' })
  const resources = route ? estimateAssignedPackage(route, { id: 'direct', objective: taskText, type: 'general' }, taskText) : null
  const accounting = { apiEstimatedCostUsd: apiEstimate, apiExposure: funding.billing === 'api', packages: [{ id: 'direct', billing: funding.billing,
    apiEstimatedCostUsd: apiEstimate, estimatedUsage: { inputTokens: resources?.inputTokens ?? null, outputTokens: resources?.outputTokens ?? null } }] }
  return { toolId, tool, taskText, mode, modelId, route, routes, accounting, funding: funding.billing, apiEstimate, estimate: Number.isFinite(estimate) ? estimate : null, budget,
    provider: route?.provider ?? '', model: route?.model ?? '', cliModel: admission.cliModel }
}

/** Run a planned tool call and record it; `rerunOf` links a rerun to the original run. */
async function runPlannedTool(ctx, config, planned, { cwd, root, signal, rerunOf = null, confirmOverBudget = false, runTask = runOfficialTask }) {
  const startedAt = Date.now()
  const runId = randomUUID()
  const makeToolRecord = (result, location = {}) => {
    const run = buildToolRunRecord({ id: runId, createdAt: startedAt, finishedAt: Date.now(),
      toolId: planned.toolId, toolLabel: planned.tool?.label ?? planned.toolId, task: planned.taskText,
      provider: planned.provider, model: planned.model, cliModel: planned.modelId,
      mode: planned.mode, workspace: cwd, result, estimatedCost: planned.estimate, rerunOf,
      pricingFor: item => routePricing(planned.routes, item), billingFor: billingForResult, budget: planned.budget })
    // Replay retains the selected identity, while the receipt above records
    // null for a default CLI model rather than inventing an actual model ID.
    run.toolRun.cliModel = planned.cliModel
    if (location.isolatedWorkspace) run.isolatedWorkspace = location.isolatedWorkspace
    if (location.baseCommit) run.baseCommit = location.baseCommit
    return run
  }
  const lifecycle = await beginExecutionLifecycle({ state: routerStateStore(), settings: budgetSettings(config), confirmOverBudget,
    officialExecution: officialExecutionFor(ctx, [{ packageId: 'direct', toolId: planned.toolId,
      cliModel: planned.cliModel ?? DEFAULT_OFFICIAL_MODEL, mode: planned.mode, executionEnvironment: 'harness' }]),
    packageEstimates: [{ id: 'direct', billing: planned.funding ?? 'api', estimatedCostUsd: planned.apiEstimate ?? planned.estimate ?? null }],
    buildRun: ({ status, results, workspace }) => makeToolRecord(results[0] ?? { status, notStarted: true }, workspace) })
  if (!lifecycle.accepted) {
    planned.budget = pausedExecutionBudget(lifecycle)
    return { result: { status: 'paused-budget', budget: planned.budget }, recorded: null }
  }
  let result
  try {
    result = await runTask({ toolId: planned.toolId, task: planned.taskText, modelId: planned.modelId, workspace: cwd, allowedRoot: root ?? cwd,
      authorizeOfficial: request => authorizeOfficialRequest(ctx, { ...request, cliModel: request.cliModel ?? planned.cliModel }),
      mode: planned.mode, signal, sandbox: ctx.sandbox,
      onCheckpointStart: item => lifecycle.onCheckpointStart(item), onCheckpointResult: item => lifecycle.onCheckpointResult(item),
      onWorkspace: value => lifecycle.onWorkspace(value) })
  } catch (error) { await stopExecutionLifecycle(lifecycle, error); throw error }
  const recorded = makeToolRecord(result, { isolatedWorkspace: result.isolatedWorkspace, baseCommit: result.baseCommit })
  try {
    if (result.status !== 'succeeded') await annotateCliQuota(recorded, config,
      [{ id: 'direct', toolId: planned.toolId, text: `${result.error ?? result.reason ?? ''}\n${result.outputTail ?? ''}` }])
    await lifecycle.finish(recorded)
  } catch (error) { await lifecycle.interrupt(recorded); throw error }
  return { result, recorded: result.status === 'unsupported' ? null : recorded }
}

/**
 * Shared native/integration Bot entry. Workspace and confirmation evidence are
 * Host arguments, separate from the model request. The same admission, budget
 * lifecycle, checkpoints and immutable ledger are used by the SDK tool below.
 */
export async function executeBotOfficialTool(ctx, config, args, { signal, cwd, root = cwd,
  sandboxMode = 'read-only', confirmOverBudget = false, runTask } = {}) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || typeof root !== 'string' || !isAbsolute(root)) {
    throw new TypeError('A trusted absolute CLI workspace is required')
  }
  const planned = await planToolRun(ctx, config, args, { signal })
  if (planned.mode === 'workspace-write' && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能请求可编辑 CLI 执行')
  if (planned.budget.exceeded && confirmOverBudget !== true) {
    return { status: 'paused-budget', budget: { ...planned.budget, paused: true },
      estimateUsd: planned.apiEstimate ?? (planned.funding === 'subscription' ? 0 : planned.estimate), accounting: planned.accounting ?? null,
      notice: `${planned.budget.message} 已暂停，未启动 ${planned.tool.label}。请先取得用户确认。` }
  }
  const { result, recorded } = await runPlannedTool(ctx, config, planned, { cwd, root, signal, confirmOverBudget,
    ...(runTask ? { runTask } : {}) })
  return { ...result, runId: recorded?.id ?? null,
    estimateUsd: planned.apiEstimate ?? (planned.funding === 'subscription' ? 0 : planned.estimate), accounting: planned.accounting ?? null,
    budget: planned.budget,
    ...(!planned.modelId ? { modelNotice: result.modelNotice ?? '本次使用厂商 CLI 当前配置的默认模型；实际模型以厂商回报为准。' } : {}),
    ...(planned.funding === 'subscription' ? { costNotice: '订阅单独统计用量，不占用 API 金额预算；厂商未回报的用量保持未知。' }
      : planned.estimate === null ? { costNotice: '实际计费方式或 API 单价未知，请先核对后确认。' } : {}) }
}

/** Ledger record for model_router_tool_run. */
export async function recordToolRun({ toolId, task, provider, model, cliModel = null, mode, workspace, result, routes = [], startedAt, config = {}, estimatedCost = null, budget = null, rerunOf = null }) {
  const run = buildToolRunRecord({
    id: randomUUID(), createdAt: startedAt, finishedAt: Date.now(), task, workspace,
    toolId, toolLabel: getOfficialTool(toolId)?.label ?? toolId, provider, model, cliModel, mode, result, estimatedCost, rerunOf,
    pricingFor: item => routePricing(routes, item), billingFor: billingForResult,
    budget: budget ? { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: false, confirmed: budget.exceeded ? true : undefined } : null,
  })
  if (result && result.status !== 'succeeded') {
    await annotateCliQuota(run, config, [{ id: 'direct', toolId, text: `${result.error ?? result.reason ?? ''}\n${result.outputTail ?? ''}` }])
  }
  try { await routerStateStore().appendRun(run); return run } catch { return null }
}

/** Store a user rating (+1 useful, -1 not useful, 0 clears) for one result. */
export async function rateRecordedResult({ runId, packageId, rating, expectedFinishedAt } = {}, { origin = 'local-explicit-input' } = {}) {
  const value = rating === 'up' || rating === 1 ? 1 : rating === 'down' || rating === -1 ? -1 : rating === 'clear' || rating === 0 ? null : undefined
  if (value === undefined) throw new Error('rating 只能是 up、down 或 clear')
  return routerStateStore().updateRun(text(runId), current => {
    const item = current.packages.find(entry => entry.id === text(packageId))
    if (!item) throw new Error(`运行记录中没有工作包 ${text(packageId)}`)
    if (expectedFinishedAt !== undefined && (!Number.isFinite(expectedFinishedAt) || expectedFinishedAt !== item.finishedAt)) {
      throw new Error('结果已更新，请刷新执行记录后再评价。')
    }
    if (value !== null && (item.ran !== true || item.ok !== true || item.paused || item.waiting || item.blocked)) {
      throw new Error('只能评价已成功执行的结果；失败和暂停不自动视为不满意。')
    }
    item.rating = value
    item.ratedAt = Date.now()
    item.feedbackPolicyVersion = 'subjective-utility-v1'
    item.feedbackOrigin = ['desktop-ui', 'approved-tool'].includes(origin) ? origin : 'local-explicit-input'
  })
}

/** Everything the workbench shows: recent runs, spending, budget, learned biases and settings. */
export async function ledgerSummary(config = {}, { limit = 30 } = {}) {
  await createBudgetReservations({ state: routerStateStore() }).recoverInterruptedExecutions()
  const saved = await routingSavedState(config)
  const spent = spending(saved.runs, undefined, saved.archivedSpending)
  const settings = budgetSettings(config)
  const budgetValue = { ...budgetFor(config, saved, null, { checkEstimate: false }), historyVerified: saved.historyVerified !== false }
  const subscriptionValue = { ...subscriptionUsage(saved.runs, Date.now(), saved.archivedSubscriptionUsage), historyIncomplete: saved.subscriptionUsageIncomplete === true }
  const entries = Object.values(saved.budgetReservations ?? {})
  const reserved = { ...reservationSpending(saved), activeCount: entries.filter(item => item.status === 'active').length,
    interruptedCount: entries.filter(item => item.status === 'interrupted').length }
  return {
    runs: saved.runs.slice(-limit).reverse().map(run => ({
      ...run,
      task: text(run.task).slice(0, 2_000),
      packages: (Array.isArray(run.packages) ? run.packages : []).filter(item => item && typeof item === 'object')
        .map(item => ({ ...item, answer: text(item.answer).slice(0, 1_500) })),
    })),
    spent,
    subscriptionUsage: subscriptionValue,
    // Two books: API money and subscription quota never share a total.
    books: twoLedgers({ spending: spent, subscription: subscriptionValue, budget: budgetValue,
      reserved: { today: reserved.today, activeCount: reserved.activeCount, interruptedCount: reserved.interruptedCount },
      subscriptionIncomplete: saved.subscriptionUsageIncomplete === true }),
    reserved,
    reservations: entries.map(entry => ({ id: entry.id, runId: entry.runId, status: entry.status, updatedAt: entry.updatedAt,
      billing: entry.packages.every(item => item.billing === 'subscription') ? 'subscription' : entry.packages.some(item => item.billing === 'subscription') ? 'mixed' : 'api',
      unknown: entry.packages.some(item => item.billing !== 'subscription' && (item.estimatedCostUsd === null || entry.status === 'interrupted' && item.started)),
      remainingEstimateUsd: entry.packages.every(item => Number.isFinite(item.estimatedCostUsd))
        ? entry.packages.reduce((sum, item) => sum + item.estimatedCostUsd, 0) : null })),
    budget: budgetValue,
    storageAvailable: saved.storageAvailable !== false,
    storageNotice: saved.storageAvailable === false ? '执行记录存储暂不可用；下方费用与学习摘要尚未核验，不能当作零花费或没有反馈。'
      : saved.historyVerified === false ? '此前执行记录已损坏或不完整，当前摘要只包含可读记录；不能视为完整费用历史，请从备份恢复后再核验预算。' : '',
    // Legacy scalar quality biases are intentionally no longer learned.
    biases: {},
    learning: saved.routingLearning,
    routingEvidence: saved.routingEvidence,
    dynamicData: dynamicDataSummary(saved.dynamicData, { ...dynamicOptions(config), now: Date.now() }),
    routingData: {
      ...routingData(saved.dynamicData, dynamicOptions(config).enabled),
      pricingSnapshot: dynamicOptions(config).enabled ? saved.dynamicData?.pricing ?? null : null,
    },
    onboarding: saved.onboarding,
    settings: {
      preset: routingPresetOf(config),
      reviewMode: valueOf(config, 'reviewMode', 'off'),
      allowManualReassign: valueOf(config, 'allowManualReassign', true) !== false,
      confirmUnsandboxedCli: valueOf(config, 'confirmUnsandboxedCli', true) !== false,
    },
    storage: routerStateStore().file,
  }
}
