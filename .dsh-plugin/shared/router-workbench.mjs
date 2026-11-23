import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import { approvalReasonCodes, confirmationReasons, decisionSummary, executeOfficialTeamPlan, planOfficialTeam } from './router-team.mjs'
import { DEFAULT_ROUTER_SETTINGS } from './router.mjs'
import { errorText, finiteNumber, text, throwIfAborted, valueOf } from './router-core-utils.mjs'
import { executeConfiguredAssignment, planAssignment, reportRunProgress } from './router-planning.mjs'
import { hydrateHealth, routerStateStore, savedState } from './router-state-billing.mjs'
import { packagePlanKey } from './package-assignments.mjs'
import { parseRunRequest } from './official-tools-remote.mjs'
import { preflightOfficialWorkspace } from './official-team-runtime.mjs'
import { workbenchFingerprint, workbenchSubmissions } from './workbench-submissions.mjs'

/**
 * The workspace for a run started from the workbench: the user-typed absolute
 * directory, else the workspace of the latest recorded run. The run is
 * read-only; the directory only scopes headless CLIs.
 */
export async function workbenchWorkspace(requested, runs = []) {
  const chosen = text(requested) || text([...runs].reverse().find(run => text(run?.workspace))?.workspace)
  if (!chosen) throw new Error('请填写工作区的绝对路径（例如项目根目录）；还没有可沿用的历史运行工作区。')
  if (!isAbsolute(chosen)) throw new Error(`工作区必须是绝对路径：${chosen}`)
  let info
  try { info = await stat(chosen) } catch { throw new Error(`工作区不存在：${chosen}。请检查路径后重试。`) }
  if (!info.isDirectory()) throw new Error(`工作区不是目录：${chosen}`)
  return chosen
}

function manualRequestOptions(request) {
  return request.assignmentMode === 'manual' ? { assignmentMode: 'manual',
    packageAssignments: request.packageAssignments, packagePlanKey: request.packagePlanKey } : {}
}

/** Resolve one fresh preview and retain its exact plan for the confirmed run. */
async function prepareWorkbenchPreview(ctx, config, supplied = {}, options = {}) {
  const request = parseRunRequest(supplied)
  const saved = await savedState()
  const workspace = await workbenchWorkspace(request.workspace, saved.runs)
  if (request.executor === 'official-team') {
    const mode = request.executionMode
    let planned
    try {
      await (options.preflightWorkspace ?? preflightOfficialWorkspace)(workspace, mode, options.signal)
      planned = await planOfficialTeam(ctx, config, { ...request, mode }, {
        workspace, signal: options.signal, ...options.planOptions,
      })
    } catch (error) {
      return { request, preview: { executor: 'official-team', executionMode: mode, executionEnvironment: request.executionEnvironment ?? 'harness', workspace,
        status: 'blocked', reason: errorText(error), decision: { packages: [] }, selected: null,
        estimatedCost: null, budget: null, reasons: [], readOnly: mode === 'read-only' } }
    }
    const decision = decisionSummary(planned.plan)
    decision.packages = decision.packages.map(item => ({ ...item, channel: 'official-cli',
      channelDetail: `官方 CLI；${mode === 'workspace-write' ? '在隔离 Git 工作树中使用自己的工具' : '只读检查工程，工具集按各 CLI 只读适配限制；Claude 禁用 shell、技能及既有 MCP，并忽略用户设置'}；未配置映射时使用 CLI 默认模型；失败停止，不自动转 API。` }))
    const codes = planned.status === 'blocked' ? [] : approvalReasonCodes('model_router_team_execute', {
      mode, executionEnvironment: planned.executionEnvironment, confirmOverBudget: Boolean(planned.budget?.exceeded),
    }, config)
    return { request, planned, preview: {
      executor: 'official-team', executionMode: mode, executionEnvironment: planned.executionEnvironment, workspace, status: planned.status,
      ...(planned.reason ? { reason: planned.reason } : {}),
      decision, selected: planned.plan?.selected ?? null, routingBypassed: false,
      accounting: planned.plan?.accounting ?? null, estimatedCost: planned.plan?.accounting ? planned.plan.accounting.apiEstimatedCostUsd : planned.plan?.estimatedCost ?? null, budget: planned.budget,
      reasons: confirmationReasons(codes, { sandboxAvailable: typeof ctx.sandbox?.confine === 'function', executionEnvironment: planned.executionEnvironment }),
      readOnly: mode === 'read-only',
    } }
  }
  const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
  const planned = await planAssignment(ctx, request.task, config, {
    provider: request.provider, model: request.model, planMode: request.planMode, preset: request.preset,
    ...manualRequestOptions(request),
    budgetUsd: finiteNumber(request.budgetUsd, finiteNumber(configuredBudget, 0)), workspace, signal: options.signal, ...options.planOptions,
  })
  await hydrateHealth()
  const codes = request.assignmentMode === 'manual'
    ? planned.budget.exceeded ? ['over-budget'] : []
    : approvalReasonCodes('model_router_execute', { provider: request.provider, confirmOverBudget: Boolean(planned.budget.exceeded) }, config)
  return { request, planned, preview: {
    workspace,
    assignmentMode: request.assignmentMode ?? 'algorithm', packagePlanKey: packagePlanKey(planned.plan, request.task),
    decision: decisionSummary(planned.plan),
    selected: planned.plan.selected ?? null,
    routingBypassed: planned.plan.routingBypassed === true,
    accounting: planned.plan.accounting ?? null,
    estimatedCost: planned.plan.accounting ? planned.plan.accounting.apiEstimatedCostUsd : planned.plan.estimatedCost ?? null,
    budget: planned.budget,
    reasons: confirmationReasons(codes, { sandboxAvailable: typeof ctx.sandbox?.confine === 'function' }),
    readOnly: true,
  } }
}

/** Plan preview: no model calls, workspace changes or worktree creation. */
export async function previewWorkbenchRun(ctx, config, request = {}, options = {}) {
  return (await prepareWorkbenchPreview(ctx, config, request, options)).preview
}

/** Execute from the workbench; refuses until every current reason is in confirmedReasons. */
export async function startWorkbenchRun(ctx, config, supplied = {}, options = {}) {
  const prepared = await prepareWorkbenchPreview(ctx, config, supplied, options)
  return refusedWorkbenchStart(prepared) ?? executePreparedWorkbenchRun(ctx, config, prepared, options)
}

function refusedWorkbenchStart({ preview, request }) {
  if (preview.status === 'blocked') return preview
  const confirmed = new Set(request.confirmedReasons ?? [])
  const missing = preview.reasons.filter(item => !confirmed.has(item.code))
  return missing.length ? { ...preview, status: 'needs-confirmation', reasons: preview.reasons,
    missing: missing.map(item => item.code) } : null
}

/**
 * A rehearsal reports the work it would have handed out, without calling a model or a tool.
 * Every field comes from the already-computed preview, so nothing new is decided here.
 */
export function dryRunOutcome(prepared = {}) {
  const packages = Array.isArray(prepared?.preview?.decision?.packages) ? prepared.preview.decision.packages : []
  const planned = packages.map((item, index) => ({
    ...item,
    dryRun: true,
    wouldCall: item?.provider && item?.model ? `${item.provider}/${item.model}` : item?.toolId ?? '未分配',
    order: index + 1,
  }))
  return {
    status: 'planned',
    dryRun: true,
    runId: null,
    workspace: prepared?.preview?.workspace ?? null,
    decision: prepared?.preview?.decision ?? null,
    budget: prepared?.preview?.budget ?? null,
    planned,
    notice: `演练：本应执行 ${planned.length} 个工作包，没有调用任何模型或工具，也没有产生费用。每个工作包的预计费用见计划。`,
  }
}

export const WORKBENCH_RUN_ID = Symbol('Host workbench run identity')

async function executePreparedWorkbenchRun(ctx, config, prepared, options = {}) {
  const { preview, request } = prepared
  // A rehearsal short-circuits every execution path, including official-team CLI runs.
  if (request?.dryRun === true) {
    await reportRunProgress(options, { type: 'stage', stage: 'dry-run' })
    return dryRunOutcome(prepared)
  }
  const confirmed = new Set(Array.isArray(request.confirmedReasons) ? request.confirmedReasons : [])
  throwIfAborted(options.signal)
  await reportRunProgress(options, { type: 'stage', stage: 'executing' })
  if (request.executor === 'official-team') {
    const result = await (options.executeOfficialTeam ?? executeOfficialTeamPlan)(ctx, config, prepared.planned, {
      confirmOverBudget: confirmed.has('over-budget'), confirmUnsandboxed: confirmed.has('unsandboxed'), ...(options.teamOptions ?? {}),
      workspace: preview.workspace, root: preview.workspace, signal: options.signal, onProgress: options.onProgress,
      [WORKBENCH_RUN_ID]: options[WORKBENCH_RUN_ID],
    })
    return { status: result.status, runId: result.runId ?? null, workspace: preview.workspace,
      executor: 'official-team', executionMode: request.executionMode, executionEnvironment: preview.executionEnvironment, decision: preview.decision,
      budget: result.budget ?? preview.budget, ...(result.reason ? { reason: result.reason } : {}),
      ...(result.notice ? { notice: result.notice } : {}) }
  }
  const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
  const result = await (options.execute ?? executeConfiguredAssignment)(ctx, request.task, config, {
    provider: request.provider, model: request.model, planMode: request.planMode, preset: request.preset,
    ...manualRequestOptions(request),
    budgetUsd: finiteNumber(request.budgetUsd, finiteNumber(configuredBudget, 0)),
    confirmOverBudget: confirmed.has('over-budget'), workspace: preview.workspace, ...options.planOptions,
    preparedAssignment: prepared.planned, signal: options.signal, onProgress: options.onProgress,
    [WORKBENCH_RUN_ID]: options[WORKBENCH_RUN_ID],
  })
  const awaiting = result.awaitingConfirmation ?? []
  return {
    status: result.paused ? 'paused-budget' : awaiting.length ? 'paused-subscription-failure' : result.execution?.status ?? 'unknown',
    runId: result.runId ?? null, workspace: preview.workspace, budget: result.budget, decision: decisionSummary(result.plan),
    ...(awaiting.length ? { awaitingConfirmation: awaiting } : {}),
  }
}

/** Desktop starts an observable job after fresh preflight and confirmation checks. */
export async function launchWorkbenchRun(ctx, config, supplied = {}, { runJobs, ...options } = {}) {
  if (!runJobs) throw new Error('工作台任务服务不可用，请重启 Harness 后重试。')
  const request = parseRunRequest(supplied)
  const key = request.requestKey
  const submissions = key ? workbenchSubmissions(routerStateStore(), runJobs) : null
  const fingerprint = key ? workbenchFingerprint(request) : null
  const original = await submissions?.lookup(key, fingerprint)
  if (original) return original
  const prepared = await prepareWorkbenchPreview(ctx, config, request, options)
  // A rehearsal changes nothing, so it needs no confirmation: the preview already lists
  // which reasons an actual run would ask for.
  const refused = prepared?.request?.dryRun === true ? null : refusedWorkbenchStart(prepared)
  if (refused) return refused
  const claim = await submissions?.claim(key, fingerprint)
  if (claim && !claim.accepted) return submissions.lookup(key, fingerprint)
  const jobId = claim?.entry.jobId
  const finish = outcome => submissions?.finish(key, jobId, outcome).catch(() => {})
  try {
    return runJobs.start({
      ...(jobId ? { jobId } : {}),
      packages: prepared.preview.decision?.packages ?? [],
      run: async ({ signal, onProgress }) => {
        let outcome = 'unknown'
        try {
          const result = await executePreparedWorkbenchRun(ctx, config, prepared, {
            ...options, signal, onProgress, [WORKBENCH_RUN_ID]: jobId,
          })
          outcome = result.status
          return result
        } catch (error) {
          if (!error?.runId) throw error
          outcome = signal.aborted ? 'cancelled' : 'failed'
          return { status: outcome, runId: error.runId, workspace: prepared.preview.workspace,
            notice: '执行未完成，已产生的结果与费用请查看执行记录。' }
        } finally {
          await finish(outcome)
        }
      },
    })
  } catch (error) {
    await finish('blocked')
    throw error
  }
}
