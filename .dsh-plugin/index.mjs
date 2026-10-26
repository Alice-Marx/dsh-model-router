import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { legacyPolicy, policyRequired, registerPolicyTool, registerPolicyCommand, guardLegacyTools } from './shared/legacy-policy.mjs'
import { DEFAULT_ROUTER_SETTINGS, estimateAssignedPackage, modelMetadata } from './shared/router.mjs'
import { DEFAULT_ROUTING_PRESET, normalizeRoutingPreset, routingPreset } from './shared/routing-presets.mjs'
import { HEALTH_CACHE_MS, apiKeyEnvPresent, healthCache, runHealthCheck, subscriptionLoginOf } from './shared/tool-health.mjs'
import { latestVersions } from './shared/latest-versions.mjs'
import {
  DEFAULT_COOLDOWN_MINUTES, billingOverview, billingPlan, createQuotaTracker, detectQuotaExhaustion, parseQuotaPatterns, vendorKey,
} from './shared/subscription-billing.mjs'
import { createRouterState } from './shared/router-state.mjs'
import { createRunJobs } from './shared/run-jobs.mjs'
import { createBudgetReservations, reservationSpending } from './shared/budget-reservations.mjs'
import { beginExecutionLifecycle } from './shared/execution-lifecycle.mjs'
import { attachPlanAccounting, accountingEstimates, initialFunding, planningFundingPrices } from './shared/execution-accounting.mjs'
import { subscriptionUsage } from './shared/subscription-usage.mjs'
import { applyFeedbackProfile, buildFeedbackProfile } from './shared/adaptive-feedback.mjs'
import { buildRoutingEvidence, parseRoutingEvidenceJson } from './shared/routing-evidence.mjs'
import { apiReasoningRequest } from './shared/reasoning-execution.mjs'
import { parseQualityGateJson, runQualityCascade } from './shared/quality-gates.mjs'
import { applyPricingSnapshot, createDynamicDataRefresher, dynamicDataSummary, routingData } from './shared/dynamic-data.mjs'
import { projectDynamicData } from './shared/dynamic-data-view.mjs'
import {
  budgetCheck, buildRunRecord, formatUsd, buildTeamRunRecord, buildToolRunRecord, billingOf, mergeRerun,
  spending, storedResults, actualCost, hasStartedQualityAttempts, teamExecutionResults, plannedPackages,
} from './shared/run-ledger.mjs'
import { routeBoundaries } from './shared/security-boundaries.mjs'
import { createPlanFromRoutes, channelForProvider } from './shared/harness-plan.mjs'
import { applyManualPackagePlan } from './shared/manual-plan.mjs'
import { parsePackageAssignments, packagePlanKey } from './shared/package-assignments.mjs'
import { applyModelProfiles, parseModelProfilesJson } from './shared/model-profiles.mjs'
import { registerOfficialToolsRemote } from './official-tools-remote-service.mjs'
import { parseRunRequest, parseRunJobRequest } from './shared/official-tools-remote.mjs'
import { createTerminalManager } from './shared/cli-terminal.mjs'
import {
  parseTerminalRead,
  parseTerminalResize,
  parseTerminalStart,
  parseTerminalStop,
  parseTerminalWrite,
} from './shared/cli-terminal-protocol.mjs'
import {
  OFFICIAL_TOOLS,
  getOfficialTool,
  installCommandLine,
  installCommandLineFor,
  installMethodFor,
  installMethodsFor,
  toolForProvider,
} from './shared/official-tool-registry.mjs'
import { parseInstallPreferences, resolveInstallPlan } from './shared/tool-install-preferences.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness, runOfficialTool } from './shared/official-tool-executor.mjs'
import { preflightOfficialWorkspace, runOfficialTask, runOfficialTeam, sessionWorkspace } from './shared/official-team-runtime.mjs'
import { downstreamPackageIds, executeAssignmentPlan, rerunAssignmentPackage, taskTextProblem } from './shared/task-executors.mjs'
import {
  probeAllTools,
  probeToolWith,
  startInstall,
  startRepair,
  startUninstall,
  cancelInstall,
  currentInstallOptions,
  installStatus,
  installedToolIds,
  defaultRunner,
  ensureNpmPrefixOnPath,
  installPreferences,
  planCommandLine,
  setInstallPreferences,
} from './shared/official-tools-runtime.mjs'

// Cordis plugin name, matching the profile entry id; unchanged by the 0.13.0 package rename.
export const name = 'model-router-galgame'
export const inject = ['commands', 'llm', 'tools', 'typert', 'sandboxPolicy', 'sandbox']

export const Config = z.object({
  requireBotPolicy: z.boolean().default(false),
  budgetUsd: z.number().min(0).max(1_000_000).default(DEFAULT_ROUTER_SETTINGS.budgetUsd).volatile(),
  maxConsultOutputChars: z.number().step(1).min(500).max(50_000).default(12_000).volatile(),
  modelProfilesJson: z.string().max(32_000).default('[]').volatile(),
  routingEvidenceJson: z.string().max(200_000).default('').volatile(),
  resourceLearningEnabled: z.boolean().default(true).volatile(),
  qualityEscalationEnabled: z.boolean().default(false).volatile(),
  qualityGateJson: z.string().max(8_000).default('').volatile(),
  routingPreset: z.union(['economy', 'balanced', 'quality']).default(DEFAULT_ROUTING_PRESET).volatile(),
  dailyBudgetUsd: z.number().min(0).max(1_000_000).default(0).volatile(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).default(0).volatile(),
  overBudgetAction: z.union(['downgrade', 'pause']).default('downgrade').volatile(),
  reviewMode: z.union(['off', 'sample', 'always']).default('off').volatile(),
  reviewSampleRate: z.number().min(0).max(1).default(0.2).volatile(),
  feedbackLearningEnabled: z.boolean().default(true).volatile(),
  feedbackHalfLifeDays: z.number().min(1).max(3650).default(30).volatile(),
  feedbackPriorWeight: z.number().min(1).max(1_000_000).default(3).volatile(),
  feedbackMaxAdjustment: z.number().min(0).max(0.1).default(0.04).volatile(),
  feedbackResetAt: z.number().min(0).default(0).volatile(),
  dynamicDataEnabled: z.boolean().default(false).volatile(),
  liveBenchEndpoint: z.string().max(2048).default('https://livebench.ai').volatile(),
  pricingSnapshotEndpoint: z.string().max(2048).default('').volatile(),
  dynamicDataTtlMinutes: z.number().min(1).max(10_080).default(1440).volatile(),
  allowManualReassign: z.boolean().default(true).volatile(),
  confirmUnsandboxedCli: z.boolean().default(true).volatile(),
  subscriptionCooldownMinutes: z.number().step(1).min(1).max(10_080).default(DEFAULT_COOLDOWN_MINUTES).volatile(),
  quotaPatternsJson: z.string().max(8_000).default('{}').volatile(),
  onSubscriptionFailure: z.union(['ask', 'api', 'fail']).default('ask').volatile(),
  // 官方工具安装设置：统一安装目录 + 下载源。两者都只在本机生效，不会随计划上传。
  toolInstallDir: z.string().max(4_096).default('').volatile(),
  toolNpmRegistry: z.string().max(2_048).default('https://registry.npmjs.org/').volatile(),
  toolInstallMethodsJson: z.string().max(8_000).default('{}').volatile(),
  toolScriptUrlsJson: z.string().max(8_000).default('{}').volatile(),
  toolAllowScriptInstall: z.boolean().default(true).volatile(),
})

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function valueOf(config, key, fallback) {
  const value = config?.[key]
  return value !== undefined && typeof value?.get === 'function' ? value.get() : value ?? fallback
}

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedInteger(value, fallback, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.floor(finiteNumber(value, fallback))))
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function errorText(error) {
  if (error instanceof Error && error.message) return error.message
  try { return String(error) } catch { return 'unknown error' }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('operation aborted')
}

function routeKey(route) {
  return `${route.provider}\u0000${route.model}`
}

function configuredRoutesWithProfiles(routes, config) {
  const profiles = parseModelProfilesJson(valueOf(config, 'modelProfilesJson', '[]'))
  return applyModelProfiles(routes, profiles)
}

function uniqueStrings(values) {
  return [...new Set(values.map(text).filter(Boolean))]
}

/** Read only exact provider/model routes published by the official LLM service. */
export async function discoverConfiguredRoutes(ctx, signal) {
  throwIfAborted(signal)
  let providers
  try { providers = ctx.llm.listProviders() } catch { return [] }
  const routes = new Map()
  for (const entry of Array.isArray(providers) ? providers : []) {
    const provider = text(typeof entry === 'string' ? entry : entry?.id)
    if (!provider) continue
    throwIfAborted(signal)
    let models
    try { models = await ctx.llm.listModels(provider) } catch {
      throwIfAborted(signal)
      continue
    }
    for (const listed of Array.isArray(models) ? models : []) {
      const model = text(listed?.id ?? listed?.model)
      if (!model) continue
      throwIfAborted(signal)
      let resolved = listed
      try { resolved = await ctx.llm.resolveModelInfo(provider, model, signal) } catch {
        throwIfAborted(signal)
      }
      const reasoning = resolved?.reasoning
      const route = {
        provider,
        model,
        name: text(resolved?.name ?? listed?.name) || model,
        inputModalities: uniqueStrings(Array.isArray(resolved?.inputModalities)
          ? resolved.inputModalities : Array.isArray(listed?.inputModalities) ? listed.inputModalities : []),
        reasoningKnown: reasoning !== undefined && reasoning !== null,
        reasoningEfforts: uniqueStrings(Array.isArray(reasoning?.efforts) ? reasoning.efforts.map(item => item?.id ?? item) : []),
        ...text(reasoning?.defaultEffort) ? { defaultReasoningEffort: text(reasoning.defaultEffort) } : {},
      }
      routes.set(routeKey(route), route)
    }
  }
  const listed = [...routes.values()].sort((left, right) => routeKey(left).localeCompare(routeKey(right)))
  const policy = legacyPolicy(ctx)
  return policy ? policy.filterRoutes(listed) : listed
}

// ---------------------------------------------------------------------------
// Router runtime state: health cache, run ledger, budget and ratings.

let routerState = null

/** Persistent Host state (DSH home). Tests point DSH_HOME at a temp dir before the first call. */
export function routerStateStore() {
  routerState ??= createRouterState()
  return routerState
}

async function savedState() {
  try {
    const saved = await routerStateStore().read()
    const storageAvailable = !(saved.notices ?? []).some(notice => notice.kind === 'state-recovery-pending')
    return { ...saved, storageAvailable, historyVerified: storageAvailable && saved.historyIncomplete !== true }
  } catch {
    return { onboarding: { completedAt: null }, health: null, runs: [], storageAvailable: false, historyVerified: false,
      notices: [{ kind: 'state-read-failed', at: Date.now(), message: '执行记录暂时无法读取，费用与学习摘要尚未核验；请恢复存储连接后重试。' }] }
  }
}

const NOTICE_DAYS = 7
/** Router notices (for example a corrupt state file that was backed up) from the last week. */
function recentNotices(saved, now = Date.now()) {
  return (saved?.notices ?? []).filter(item => Number.isFinite(item?.at) && now - item.at < NOTICE_DAYS * 86_400_000)
}

/**
 * Health and quota caches follow the shared state file: every call re-reads it
 * (the store caches by mtime/size/inode, so an unchanged file costs one stat)
 * and adopts marks and clears made by other processes without a restart.
 */
async function hydrateHealth() {
  const saved = await savedState()
  healthCache.sync(saved)
}

// Subscription quota: which subscriptions hit their limit, and until when.
let quotaTracker = null
function quotaStore() {
  quotaTracker ??= createQuotaTracker({ persist: (snapshot, change) => routerStateStore().saveQuota(snapshot, change) })
  return quotaTracker
}
async function hydrateQuota() {
  const saved = await savedState()
  quotaStore().sync(saved.quota)
  return quotaStore()
}

/** Current quota marks after adopting other processes' changes (workbench and tests). */
export async function currentQuotaSnapshot() {
  return (await hydrateQuota()).snapshot()
}

function quotaPatterns(config) {
  return parseQuotaPatterns(valueOf(config, 'quotaPatternsJson', '{}'))
}

function subscriptionFailureAction(config) {
  const value = valueOf(config, 'onSubscriptionFailure', 'ask')
  return value === 'api' || value === 'fail' ? value : 'ask'
}

/** Steps paused after a non-quota subscription failure, for the session model and the workbench. */
function pausedSteps(execution) {
  return (execution?.packages ?? []).filter(item => item?.paused).map(item => ({
    packageId: item.id, name: item.name, provider: item.provider, model: item.model,
    reason: item.pause?.reason ?? item.error ?? '', detail: item.pause?.detail ?? '', choices: item.pause?.choices ?? ['api', 'subscription', 'cancel'],
  }))
}

const SUBSCRIPTION_PAUSE_NOTICE = '有步骤在订阅调用失败（非额度用尽或限流）后已暂停，下游步骤在等待，未自动改用 API Key。请把 awaitingConfirmation 中的原因和错误告诉用户，按用户选择调用 model_router_rerun_step，subscriptionChoice 为 api（改用 API 重试，会触发审批）、subscription（重试订阅）或 cancel（取消）。'

function cooldownMinutes(config) {
  return boundedInteger(valueOf(config, 'subscriptionCooldownMinutes', DEFAULT_COOLDOWN_MINUTES), DEFAULT_COOLDOWN_MINUTES, 1, 10_080)
}

/** Subscription-first billing context for the executor; `options.billing === false` disables it. */
async function billingContext(config, options = {}) {
  if (options.billing === false) return null
  const quota = await hydrateQuota()
  await hydrateHealth()
  return {
    quota,
    cooldownMinutes: cooldownMinutes(config),
    extraPatterns: quotaPatterns(config).patterns,
    onFailure: subscriptionFailureAction(config),
    loginBillingFor: toolId => subscriptionLoginOf(healthCache.loginState(toolId)),
    loginDetailFor: toolId => healthCache.loginState(toolId),
    now: Date.now,
    ...(options.billing && typeof options.billing === 'object' ? options.billing : {}),
  }
}

/** Health-check billing table: subscription state and API availability per provider. */
export async function billingHealth(ctx, config, { signal } = {}) {
  const quota = await hydrateQuota()
  await hydrateHealth()
  let routes = []
  try { routes = configuredRoutesWithProfiles(await discoverConfiguredRoutes(ctx, signal), config) } catch { routes = [] }
  const overview = billingOverview(routes, {
    quota,
    loginFor: toolId => subscriptionLoginOf(healthCache.loginState(toolId)),
    apiKeyEnvFor: toolId => apiKeyEnvPresent(toolId),
  })
  return { ...overview, cooldownMinutes: cooldownMinutes(config), quotaPatternErrors: quotaPatterns(config).errors }
}

/**
 * Team and direct CLI runs edit through the official CLI only, so a quota hit
 * there is recorded (and later steps skip that subscription) but not retried
 * on an API key automatically.
 */
async function noteCliQuota(config, toolId, textValue) {
  if (!toolId || !text(textValue)) return null
  const info = detectQuotaExhaustion(String(textValue), { vendor: vendorKey({ toolId }), extraPatterns: quotaPatterns(config).patterns })
  if (!info) return null
  const quota = await hydrateQuota()
  const entry = quota.mark(`cli:${toolId}`, { ...info, detail: String(textValue).slice(0, 300) }, { cooldownMinutes: cooldownMinutes(config) })
  const until = new Date(entry.until)
  const pad = value => String(value).padStart(2, '0')
  const at = `${until.getMonth() + 1}-${until.getDate()} ${pad(until.getHours())}:${pad(until.getMinutes())}`
  return {
    from: 'subscription', to: null, kind: info.kind, until: entry.until, source: info.source, detail: entry.detail,
    reason: `${info.kind === 'rate-limit' ? '订阅通道触发限流' : '订阅额度已用尽'}（预计 ${at} 恢复）；该运行只能通过官方 CLI 修改文件，未自动切换 API Key。`,
  }
}

const fileExists = async path => {
  try { await stat(path); return true } catch { return false }
}

/** MiniMax's non-secret auth-state.json: only `status` and `storeKind` leave this function. */
const readAuthState = async path => {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > 64 * 1024) return null
    const value = JSON.parse(await readFile(path, 'utf8'))
    return value && typeof value === 'object' ? { status: typeof value.status === 'string' ? value.status : null, storeKind: typeof value.storeKind === 'string' ? value.storeKind : null } : null
  } catch { return null }
}

/** 开箱体检: install, version and login state for every registry tool. */
export async function toolHealthReport({ fresh = false, runner = defaultRunner, latest = latestVersions, probeTools = probeAllTools } = {}) {
  // Latest-version lookups run alongside the probes; failures are non-fatal (offline-safe).
  const preferences = installPreferences()
  const [probes, latestById] = await Promise.all([
    probeTools({ fresh, preferences }),
    latest.lookupAll(OFFICIAL_TOOLS, { preferences }).catch(() => ({})),
  ])
  const report = await runHealthCheck(probes, { runner, home: homedir(), exists: fileExists, readAuthState, latest: latestById })
  healthCache.remember(report)
  try { await routerStateStore().saveHealth(report) } catch { /* the cache still serves this process */ }
  return report
}

/** A recent report, re-running the cheap checks only when the cache expired. */
async function currentHealth() {
  await hydrateHealth()
  const report = healthCache.report()
  if (report && Date.now() - report.checkedAt < HEALTH_CACHE_MS) return report
  try { return await toolHealthReport() } catch { return report }
}

function loggedOutIds(report) {
  return (report?.tools ?? []).filter(item => item.installed && healthCache.loginState(item.id)?.state === 'logged-out').map(item => item.id)
}

function routingPresetOf(config, requested) {
  return normalizeRoutingPreset(text(requested) || valueOf(config, 'routingPreset', DEFAULT_ROUTING_PRESET))
}

function budgetSettings(config) {
  return {
    dailyLimitUsd: Math.max(0, finiteNumber(valueOf(config, 'dailyBudgetUsd', 0), 0)),
    monthlyLimitUsd: Math.max(0, finiteNumber(valueOf(config, 'monthlyBudgetUsd', 0), 0)),
    action: valueOf(config, 'overBudgetAction', 'downgrade') === 'pause' ? 'pause' : 'downgrade',
  }
}

function budgetFor(config, saved, estimateUsd, { checkEstimate = true, apiExposure = true } = {}) {
  const settings = budgetSettings(config)
  if (apiExposure && (saved.storageAvailable === false || saved.historyVerified === false) && (settings.dailyLimitUsd > 0 || settings.monthlyLimitUsd > 0)) {
    throw new Error('无法读取费用历史，不能核验日/月预算；请恢复存储连接后再执行。')
  }
  const recorded = spending(saved.runs, undefined, saved.archivedSpending)
  const reserved = reservationSpending(saved)
  const spent = { ...recorded, today: recorded.today + reserved.today, month: recorded.month + reserved.month,
    unknownToday: recorded.unknownToday + reserved.unknownToday, unknownMonth: recorded.unknownMonth + reserved.unknownMonth }
  const check = budgetCheck({ estimateUsd, spent, ...settings })
  if (!apiExposure) { check.exceeded = null; check.message = '订阅按用量单独统计，不占用 API 金额预算。' }
  if (apiExposure && check.limited && (checkEstimate && !check.estimateKnown || settings.dailyLimitUsd > 0 && spent.unknownToday > 0
    || settings.monthlyLimitUsd > 0 && spent.unknownMonth > 0) && !check.exceeded) {
    check.exceeded = 'unknown'
    check.message = '存在未核对费用或缺少单价，无法核验预算；请先核对账单或明确确认继续。'
  }
  return { ...check, spent, reserved, ...settings, apiExposure }
}

function pausedExecutionBudget(lifecycle) {
  if (['history-incomplete', 'active-run', 'reservation-capacity'].includes(lifecycle.reason)) {
    throw new Error(lifecycle.reason === 'active-run' ? '该运行仍在执行或费用待核对，不能重复启动。'
      : lifecycle.reason === 'history-incomplete' ? '费用历史不完整，不能核验执行预算。' : '待核对运行过多，请先核对执行记录和费用。')
  }
  return { ...lifecycle.budget, paused: true, exceeded: lifecycle.budget?.exceeded ?? 'unknown' }
}

function accountingContext(billing = null, routes = [], officialCli = false) {
  return { billing: billing ? { ...billing, routes } : null, officialCli,
    loginBillingFor: id => subscriptionLoginOf(healthCache.loginState(id)), apiKeyFor: id => apiKeyEnvPresent(id) }
}

function packageEstimates(plan, task) {
  if (plan.accounting) return accountingEstimates(plan)
  return plannedPackages(plan, task).map(item => ({ id: item.id, estimatedCostUsd: item.estimatedCost ?? null }))
}

/** Activate API money accounting only at the actual API dispatch boundary. */
async function reserveChangedApiRoute(lifecycle, expected, route, task, config, confirmOverBudget) {
  const id = lifecycle.activePackageId()
  if (!id) throw new Error('缺少执行检查点，不能启动 API 路线。')
  const previous = lifecycle.results().find(item => item.id === id)
  const held = lifecycle.reservationFor(id)
  const unchanged = expected?.provider === route.provider && expected?.model === route.model
  const saved = await routingSavedState(config)
  const estimate = held?.billing === 'api' && unchanged ? held.estimatedCostUsd
    : createPlanFromRoutes(task, [route], { ...planDataOptions(saved, config),
      mode: 'direct', directProvider: route.provider, directModel: route.model }).estimatedCost
  const reserved = await lifecycle.reserveExtra(id, estimate, { confirmOverBudget: confirmOverBudget === true })
  if (!reserved.accepted) return { ok: false, notStarted: true,
    subscriptionAttempts: previous?.subscriptionAttempts ?? [],
    error: `实际 API 路线预算未确认，已停止调用。${reserved.budget.message}` }
  if (held?.billing === 'subscription' || previous?.billing === 'subscription') {
    await lifecycle.partialResult({ id, provider: route.provider, model: route.model, billing: 'api',
      channel: 'harness-llm', ok: false, notStarted: true, answer: '', usage: null,
      subscriptionAttempts: previous?.subscriptionAttempts ?? [] }, { checkBudget: true })
  }
  return null
}

async function checkpointSubscription(lifecycle, event) {
  await lifecycle.partialResult({ ...event, billing: 'subscription', channel: event.channel ?? 'harness-llm',
    ok: false, answer: '', subscriptionAttempts: event.subscriptionAttempts ?? [event] })
}

/** A changed budget stops before dispatch; storage failures retain their hold. */
async function stopExecutionLifecycle(lifecycle, error, run = lifecycle.current('interrupted')) {
  if (error?.code === 'ROUTER_BUDGET_CHANGED') {
    run.status = 'paused-budget'
    run.error = error.message
    run.finishedAt = Date.now()
    try { await lifecycle.finish(run); error.runId = run.id; return true }
    catch { await lifecycle.interrupt(run); return false }
  }
  await lifecycle.interrupt(run)
  return false
}

/** The independent-opinion tool uses the same durable API budget boundary. */
export async function executeBudgetedConsult(ctx, route, task, config = {}, { signal, limit = 12_000, confirmOverBudget = false, routes = [] } = {}) {
  const problem = taskTextProblem(text(task))
  if (problem) throw new Error(problem)
  const catalog = [route, ...routes.filter(item => item.provider !== route.provider || item.model !== route.model)]
  const funding = initialFunding(route, { billing: { routes: catalog }, executionChannel: 'harness-llm' })
  route = catalog.find(item => item.provider === funding.route?.provider && item.model === funding.route?.model) ?? funding.route
  const plan = createPlanFromRoutes(task, [route], { mode: 'direct', directProvider: route.provider, directModel: route.model })
  plan.accounting = { apiExposure: funding.billing === 'api', apiEstimatedCostUsd: funding.billing === 'subscription' ? 0 : plan.estimatedCost,
    packages: [{ id: 'direct', billing: funding.billing, apiEstimatedCostUsd: funding.billing === 'subscription' ? 0 : plan.estimatedCost }] }
  const id = randomUUID(), at = Date.now()
  const record = (status, results) => buildRunRecord({ id, createdAt: at, finishedAt: Date.now(), task, plan,
    execution: { status, packages: results }, workspace: process.cwd(), pricingFor: () => route.pricing ?? null, billingFor: () => funding.billing })
  const lifecycle = await beginExecutionLifecycle({ state: routerStateStore(), buildRun: ({ status, results }) => record(status, results),
    packageEstimates: packageEstimates(plan, task), settings: budgetSettings(config), confirmOverBudget })
  if (!lifecycle.accepted) return { status: 'paused-budget', paused: true, budget: pausedExecutionBudget(lifecycle), ok: false }
  let result
  try {
    await lifecycle.onCheckpointStart({ id: 'direct', provider: route.provider, model: route.model, channel: 'harness-llm' })
    result = await consultConfiguredModel(ctx, route, task, limit, signal)
    const receipt = { ...result, id: 'direct', provider: route.provider, model: route.model, channel: 'harness-llm', billing: funding.billing, finishedAt: Date.now() }
    if (funding.billing === 'subscription') receipt.subscriptionAttempts = [{ provider: route.provider, model: route.model,
      usage: result.usage ?? null, usageIncomplete: result.usageIncomplete === true, notStarted: result.notStarted === true, finishedAt: receipt.finishedAt }]
    await lifecycle.onCheckpointResult(receipt)
    await lifecycle.finish(record(result.cancelled ? 'cancelled' : result.ok ? 'completed' : 'failed', lifecycle.results()))
  } catch (error) { await stopExecutionLifecycle(lifecycle, error); throw error }
  return { ...result, billing: funding.billing, accounting: plan.accounting, runId: id }
}

/**
 * API key / API path spend counts against budgets; an official CLI on its own
 * subscription login (no API key injected or inherited) is reference-only.
 */
export function billingForResult(result) {
  const toolId = result?.toolId ?? null
  if (result?.billing === 'unknown') return 'unknown'
  const login = toolId ? subscriptionLoginOf(healthCache.loginState(toolId)) : 'unknown'
  if (result?.channel === 'official-cli' && !result.billing
    && !['configured-api-key', 'process-environment'].includes(result.credentialSource)
    && !apiKeyEnvPresent(toolId) && !['api-key', 'subscription'].includes(login)) return 'unknown'
  return billingOf(result, {
    loginBilling: toolId ? healthCache.loginState(toolId)?.billing ?? null : null,
    apiKeyPresent: toolId ? apiKeyEnvPresent(toolId) : false,
  })
}

export function routePricing(routes, item) {
  const matches = routes.filter(route => {
    if (route.provider !== item?.provider) return false
    if (item?.channel !== 'official-cli') return route.model === item?.model
    // A routing recommendation cannot establish which model the CLI billed.
    return typeof item.actualModel === 'string' && [route.model, route.cliModel, `${route.provider}/${route.model}`].includes(item.actualModel)
  })
  // Different catalog routes can share a CLI alias. Conflicting prices are
  // not evidence of what the CLI actually billed.
  const prices = new Set(matches.map(route => JSON.stringify(route.pricing ?? null)))
  if (prices.size > 1) return null
  const route = matches[0]
  return route?.pricing ? { ...route.pricing, provider: route.provider, model: route.model,
    ...(route.cliModel ? { cliModel: route.cliModel } : {}),
    source: route.pricingSource ?? 'route', version: route.pricingVersion ?? null, asOf: route.snapshotAsOf ?? null } : null
}

function feedbackOptions(config) {
  return {
    enabled: valueOf(config, 'feedbackLearningEnabled', true) !== false,
    halfLifeDays: valueOf(config, 'feedbackHalfLifeDays', 30),
    priorWeight: valueOf(config, 'feedbackPriorWeight', 3),
    maxAdjustment: valueOf(config, 'feedbackMaxAdjustment', 0.04),
    resetAt: valueOf(config, 'feedbackResetAt', 0),
  }
}

function dynamicOptions(config) {
  return {
    enabled: valueOf(config, 'dynamicDataEnabled', false) === true,
    liveBenchEndpoint: valueOf(config, 'liveBenchEndpoint', 'https://livebench.ai'),
    pricingSnapshotEndpoint: valueOf(config, 'pricingSnapshotEndpoint', ''),
    ttlMs: boundedInteger(valueOf(config, 'dynamicDataTtlMinutes', 1440), 1440, 1, 10_080) * 60_000,
  }
}

let dynamicRefresher = null
async function routingSavedState(config) {
  const options = dynamicOptions(config)
  let refreshedData = null
  if (options.enabled) {
    dynamicRefresher ??= createDynamicDataRefresher({ store: routerStateStore() })
    // A public-data failure must never turn into a paid probe or prevent
    // ordinary routing. The refresher preserves last-good snapshots.
    try { refreshedData = await dynamicRefresher.refresh(options) } catch { /* state/read errors use the normal fallback */ }
  }
  const saved = await savedState()
  // Config can change while a public request is in flight. Reproject against
  // the current settings, not the options captured before awaiting refresh.
  // Cached source A must not masquerade as a newly configured source B.
  saved.dynamicData = projectDynamicData(refreshedData ?? saved.dynamicData, dynamicOptions(config))
  saved.routingLearning = buildFeedbackProfile(saved.runs, feedbackOptions(config))
  const imported = text(valueOf(config, 'routingEvidenceJson', ''))
  saved.routingEvidence = buildRoutingEvidence({
    runs: valueOf(config, 'resourceLearningEnabled', true) !== false ? saved.runs : [],
    qualityEvidence: imported ? parseRoutingEvidenceJson(imported) : null,
  })
  return saved
}

function planDataOptions(saved, config) {
  return {
    ...routingData(saved.dynamicData, dynamicOptions(config).enabled),
    learning: saved.routingLearning ?? buildFeedbackProfile(saved.runs, feedbackOptions(config)),
    routingEvidence: saved.routingEvidence ?? buildRoutingEvidence(),
  }
}

/** Manual exact-route profiles take precedence over public price snapshots.
 * Only explicit subjective feedback affects utility; reviews stay separate. */
async function routesWithLearning(ctx, config, signal, runs, dynamicData = null, feedbackProfile = null) {
  const discovered = await discoverConfiguredRoutes(ctx, signal)
  const profiled = configuredRoutesWithProfiles(discovered, config)
  const priced = applyPricingSnapshot(profiled, dynamicOptions(config).enabled ? dynamicData?.pricing : null)
  return applyFeedbackProfile(priced, feedbackProfile ?? buildFeedbackProfile(runs, feedbackOptions(config)))
}

/** Produce a route recommendation and work packages compatible with official Agent Teams. */
export async function createRoutePlan(ctx, task, config = {}, options = {}) {
  const taskText = text(task)
  if (!taskText) throw new Error('任务内容为空，请先描述任务。')
  const mode = options.mode === 'team' ? 'team' : 'single'
  const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
  const budgetUsd = Math.max(0, finiteNumber(options.budgetUsd, finiteNumber(configuredBudget, 0)))
  const saved = await routingSavedState(config)
  const [availableRoutes, installed] = await Promise.all([
    routesWithLearning(ctx, config, options.signal, saved.runs, saved.dynamicData, saved.routingLearning),
    options.skipToolProbe === true
      ? Promise.resolve(Array.isArray(options.installedToolIds) ? options.installedToolIds : [])
      : installedToolIds(),
  ])
  const readiness = Array.isArray(options.readiness) ? options.readiness : options.skipToolProbe === true ? []
    : await Promise.all(installed.map(id => officialToolReadiness(id, options.workspace ?? process.cwd())))
  const executable = new Set(Array.isArray(options.runnableToolIds)
    ? options.runnableToolIds : readiness.filter(item => item.ready && (item.readyModes ?? item.modes ?? []).includes('read-only')).map(item => item.id))
  const loggedOut = options.skipToolProbe === true
    ? (Array.isArray(options.loggedOutToolIds) ? options.loggedOutToolIds : [])
    : loggedOutIds(await currentHealth())
  const planningBilling = await billingContext(config, options)
  const context = accountingContext(planningBilling, availableRoutes)
  const fundingPrices = planningFundingPrices(availableRoutes, context, route => channelForProvider(route.provider, installed, [...executable], route, loggedOut).kind)
  const plan = createPlanFromRoutes(taskText, availableRoutes, {
    ...planDataOptions(saved, config), pricing: fundingPrices.pricing,
    mode, budgetUsd, installedToolIds: installed,
    runnableToolIds: installed.filter(id => executable.has(id)),
    preset: routingPresetOf(config, options.preset),
    loggedOutToolIds: loggedOut,
  })
  plan.subscriptionPricedRoutes = fundingPrices.subscriptionPricedRoutes
  attachPlanAccounting(plan, taskText, availableRoutes, context)
  return { ...plan, packagePlanKey: packagePlanKey(plan, taskText), budgetStatus: budgetFor(config, saved, plan.accounting.apiEstimatedCostUsd, { apiExposure: plan.accounting.apiExposure }) }
}

/** One bounded, independent call through the same official LLM service. */
export async function consultConfiguredModel(ctx, route, task, outputLimit = 12_000, signal) {
  const provider = text(route?.provider)
  const model = text(route?.model)
  const taskText = text(task)
  if (!provider || !model) throw new Error('需要提供已配置的 provider 和 model。')
  if (!taskText) throw new Error('任务内容为空，请先描述任务。')
  throwIfAborted(signal)
  const limit = boundedInteger(outputLimit, 12_000, 1, 50_000)
  const reasoning = apiReasoningRequest(route)
  if (reasoning.error) {
    return {
      ok: false, provider, model, answer: '', truncated: false, finish: { kind: 'unknown' },
      error: reasoning.error, ...reasoning.fields, notStarted: true,
    }
  }
  const messageText = `You are an independent specialist consulted by another AI agent. Give a concise, evidence-oriented answer in the task's language.\n\nTask:\n${taskText}`
  const startedAt = Date.now()
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  let answer = ''
  let characterLimitReached = false
  let finish = { kind: 'unknown' }
  let usage = null
  let usageIncomplete = false
  try {
    const stream = ctx.llm.stream({
      provider,
      model,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: messageText,
        }],
      }],
      maxTokens: Math.min(4_096, Math.max(256, Math.ceil(limit / 2))),
      signal: controller.signal,
      ...reasoning.options,
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        const remaining = limit - answer.length
        if (remaining > 0) answer += chunk.text.slice(0, remaining)
        if (chunk.text.length > remaining) {
          characterLimitReached = true
          controller.abort(new Error('consultation output limit reached'))
          break
        }
      } else if (chunk?.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') {
        usage = {}
        usageIncomplete = false
        for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
          if (typeof chunk.usage[key] === 'number' && Number.isFinite(chunk.usage[key]) && chunk.usage[key] >= 0) usage[key] = chunk.usage[key]
          else if (Object.hasOwn(chunk.usage, key) || ['inputTokens', 'outputTokens'].includes(key)) usageIncomplete = true
        }
      } else if (chunk?.type === 'finish') {
        const reason = chunk.reason
        finish = { kind: text(reason?.kind) || 'unknown' }
        if (finish.kind === 'error' || finish.kind === 'aborted') {
          finish.error = text(reason?.failure?.message) || 'model request failed'
        }
      }
    }
  } catch (error) {
    finish = { kind: signal?.aborted ? 'aborted' : 'error', error: String(error?.message ?? error).slice(0, 2_000) }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  const durationMs = Date.now() - startedAt
  const inputChars = messageText.length
  const tokenLimitReached = finish.kind === 'max-tokens'
  const truncated = characterLimitReached || tokenLimitReached
  if (signal?.aborted || !characterLimitReached && (finish.kind === 'error' || finish.kind === 'aborted')) {
    return {
      ok: false, provider, model, answer, truncated, finish,
      ...reasoning.fields,
      ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
      ...(Number.isFinite(inputChars) && inputChars >= 0 ? { inputChars } : {}),
      error: finish.error,
      ...(signal?.aborted ? { cancelled: true } : {}),
      ...(usageIncomplete ? { usageIncomplete: true } : {}),
      ...(usage ? { usage } : {}),
    }
  }
  if (!answer.trim()) {
    return {
      ok: false, provider, model, answer, truncated, finish,
      ...reasoning.fields,
      ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
      ...(Number.isFinite(inputChars) && inputChars >= 0 ? { inputChars } : {}),
      error: 'model returned no text',
      ...(usageIncomplete ? { usageIncomplete: true } : {}),
      ...(usage ? { usage } : {}),
    }
  }
  return {
    ok: true, provider, model, answer, truncated, finish,
    ...(usageIncomplete ? { usageIncomplete: true } : {}),
    ...reasoning.fields,
    ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
    ...(Number.isFinite(inputChars) && inputChars >= 0 ? { inputChars } : {}),
    ...(usage ? { usage } : {}),
    ...(tokenLimitReached
      ? { truncationReason: 'model-token-limit', notice: '模型达到本次调用的输出 token 上限，回答可能不完整。' }
      : characterLimitReached
        ? { truncationReason: 'output-character-limit', notice: '回答达到字符上限，后续内容已截断。' }
        : {}),
  }
}

/**
 * A host service this plugin may use but does not require. Cordis throws
 * `cannot get property "<name>" without inject` for any `ctx.<name>` read of a
 * service missing from `inject` (optional chaining does not help), and every
 * `inject` entry is required, so optional services are read with `ctx.get()`,
 * the same seam the Harness itself uses (for example `ctx.get("credentials")`).
 */
export function optionalService(ctx, name) {
  try { return typeof ctx?.get === 'function' ? ctx.get(name) : undefined } catch { return undefined }
}

async function credentialsForRoute(ctx, route) {
  const provider = text(route?.provider)
  if (!provider) return null
  const credentials = optionalService(ctx, 'credentials')
  const llm = ctx?.llm
  const readers = [
    typeof credentials?.getApiKey === 'function' ? key => credentials.getApiKey(key) : null,
    typeof llm?.getProviderApiKey === 'function' ? key => llm.getProviderApiKey(key) : null,
  ]
  for (const read of readers) {
    if (typeof read !== 'function') continue
    try {
      const value = await read(provider)
      const apiKey = typeof value === 'string' ? value : value?.apiKey ?? value?.key
      if (typeof apiKey === 'string' && apiKey.trim() && !apiKey.includes('\0') && apiKey.length <= 4_096) {
        return { apiKey }
      }
    } catch { /* this host build does not expose provider keys; the CLI login session remains available */ }
  }
  return null
}

function routeQuality(route) {
  if (!route) return null
  const base = Number.isFinite(route.quality) ? route.quality : modelMetadata(route.model)?.quality
  return Number.isFinite(base) ? base : null
}

/** The strongest configured route by known quality, used as the reviewer. */
export function reviewerRoute(routes) {
  return routes
    .map(route => ({ route, quality: routeQuality(route) }))
    .filter(item => item.quality !== null)
    .sort((left, right) => right.quality - left.quality || routeKey(left.route).localeCompare(routeKey(right.route)))[0]?.route ?? null
}

function reviewScore(answer) {
  const match = /"score"\s*:\s*([1-5])/u.exec(answer) ?? /(?:评分|分数|score)\s*[:：]?\s*([1-5])\b/iu.exec(answer)
  return match ? Number(match[1]) : null
}

/**
 * 质量回路: a stronger configured model spot-checks answers from cheaper
 * routes. `sample` reviews a random share; `always` reviews every cheaper answer.
 */
export async function reviewRunPackages(ctx, run, routes, config, { signal, random = Math.random, lifecycle } = {}) {
  const mode = valueOf(config, 'reviewMode', 'off')
  if (mode !== 'sample' && mode !== 'always') return []
  const rate = Math.min(1, Math.max(0, finiteNumber(valueOf(config, 'reviewSampleRate', 0.2), 0.2)))
  const reviewer = reviewerRoute(routes)
  if (!reviewer) return []
  const reviewerQuality = routeQuality(reviewer)
  const reviews = []
  for (const item of run.packages) {
    if (signal?.aborted) break
    if (!item.ok || !text(item.answer)) continue
    if (item.provider === reviewer.provider && item.model === reviewer.model) continue
    const own = routeQuality(routes.find(route => route.provider === item.provider && route.model === item.model))
    if (own !== null && own >= reviewerQuality - 0.02) continue
    if (mode === 'sample' && random() >= rate) continue
    const prompt = [
      '请作为更强的审阅模型，抽查下面这个由较经济模型完成的工作包结果。',
      '只输出一行 JSON：{"score": 1-5 的整数, "summary": "不超过 80 字的主要问题或肯定"}。5 表示可直接采用，1 表示错误或不可用。',
      `总任务：\n${run.task.slice(0, 6_000)}`,
      `工作包：${item.name}\n${item.objective.slice(0, 1_500)}`,
      `待审结果：\n${item.answer.slice(0, 3_500)}`,
    ].join('\n\n')
    const reviewId = `review:${item.id}`
    let pendingReview = null
    if (lifecycle) {
      const estimate = createPlanFromRoutes(prompt, [reviewer], { mode: 'direct', directProvider: reviewer.provider,
        directModel: reviewer.model }).estimatedCost
      const reserved = await lifecycle.reserveExtra(reviewId, estimate)
      if (!reserved.accepted) { item.review = { score: null, summary: '预算未确认，已跳过额外审阅。', at: Date.now() }; continue }
      pendingReview = { id: reviewId, packageId: item.id, provider: reviewer.provider, model: reviewer.model,
        status: 'running', inFlight: true, ran: false, costUsd: null, billing: 'api', finishedAt: Date.now() }
      run.reviews.push(pendingReview)
      try { await lifecycle.saveRun(run, { startedIds: [reviewId] }) }
      catch (error) {
        if (error.code !== 'ROUTER_BUDGET_CHANGED') throw error
        run.reviews = run.reviews.filter(entry => entry !== pendingReview)
        item.review = { score: null, summary: '预算已变化，已跳过额外审阅。', at: Date.now() }
        break
      }
    }
    try {
      const result = await consultConfiguredModel(ctx, reviewer, prompt, 1_200, signal)
      const score = result.ok ? reviewScore(result.answer) : null
      let summary = ''
      try { summary = text(JSON.parse(/\{[\s\S]*\}/u.exec(result.answer)?.[0] ?? '{}').summary) } catch { /* free-form review */ }
      item.review = {
        provider: reviewer.provider, model: reviewer.model, score,
        summary: (summary || text(result.answer) || text(result.error)).slice(0, 300), at: Date.now(),
      }
      const cost = actualCost(result, reviewer.pricing ?? null)
      const entry = { packageId: item.id, provider: reviewer.provider, model: reviewer.model, ran: true, finishedAt: Date.now(), usage: result.usage ?? null, ...cost, billing: 'api', referenceCostUsd: null }
      if (pendingReview) Object.assign(pendingReview, entry, { status: 'completed', inFlight: false })
      else run.reviews.push(entry)
      reviews.push({ ...entry, score })
      if (lifecycle) await lifecycle.saveRun(run, { completedIds: [reviewId] })
    } catch (error) {
      if (error.code === 'ROUTER_CHECKPOINT_FAILED') throw error
      if (pendingReview) {
        Object.assign(pendingReview, { status: 'failed', inFlight: false, ran: true, costUsd: null, finishedAt: Date.now() })
        await lifecycle.saveRun(run, { completedIds: [reviewId] })
      }
      if (signal?.aborted) break
      item.review = { provider: reviewer.provider, model: reviewer.model, score: null, summary: `审阅失败：${errorText(error).slice(0, 200)}`, at: Date.now() }
    }
  }
  return reviews
}

async function reportRunProgress(options, event) {
  try { if (typeof options.onProgress === 'function') await options.onProgress(event) }
  catch { /* Observing progress must not discard results or incurred spend. */ }
}

function executionHooks(ctx, options) {
  return {
    onCheckpointStart: options.onCheckpointStart,
    onCheckpointResult: options.onCheckpointResult,
    onSubscriptionResult: options.onSubscriptionResult,
    skipOfficial: options.skipOfficial ?? (request => healthCache.skipReason(request)),
    onStage: stage => reportRunProgress(options, { type: 'stage', stage }),
    onPackageStart: async item => {
      await reportRunProgress(options, { type: 'package-start', package: item })
      if (typeof options.onPackageStart === 'function') await options.onPackageStart(item)
    },
    onPackage: async result => {
      // A CLI that reports "not logged in" is marked; with a subscription the router then asks instead of using the API key.
      const failed = result?.toolId && (result.fallback?.loginRequired ? result.fallback.error : result.pause?.loginRequired && result.pause.kind !== 'subscription-login' ? result.pause.detail : null)
      if (failed) {
        const at = Date.now()
        healthCache.markLoggedOut(result.toolId, failed, at)
        try { await routerStateStore().saveAuthFailure(result.toolId, { at, detail: failed }) } catch { /* the cache still serves this process */ }
      } else if (result?.ok && result.channel === 'official-cli' && result.toolId && healthCache.loginState(result.toolId)?.source === 'runtime-auth') {
        healthCache.clearLoggedOut(result.toolId)
        try { await routerStateStore().saveAuthFailure(result.toolId, null) } catch { /* the cache still serves this process */ }
      }
      await reportRunProgress(options, { type: 'package-complete', package: result })
      if (typeof options.onPackage === 'function') await options.onPackage(result)
    },
    credentialsFor: route => credentialsForRoute(ctx, route),
    runVerified: options.runVerified ?? (request => runOfficialTool({
      ...request, sandbox: ctx.sandbox, mode: 'read-only',
    })),
  }
}

/**
 * The plan and budget check model_router_execute would use, without running
 * anything: one explicit model or routing, with the automatic economy
 * downgrade when the budget would be exceeded. Shared by the workbench preview.
 */
export async function planAssignment(ctx, task, config = {}, options = {}) {
  const taskText = text(task)
  // Validate before planning or any paid call: the whole task must fit one CLI/API prompt.
  const problem = taskTextProblem(taskText)
  if (problem) throw new Error(problem)
  const direct = text(options.provider) || text(options.model)
  const manual = options.assignmentMode === 'manual'
  if (options.assignmentMode !== undefined && !['algorithm', 'manual'].includes(options.assignmentMode)) throw new Error('不支持的分配方式。')
  if (manual && direct) throw new Error('手动分配工作包不能同时指定全局单一模型。')
  if (!manual && (options.packageAssignments !== undefined || options.packagePlanKey !== undefined)) throw new Error('工作包绑定需要选择手动分配。')
  if (manual && valueOf(config, 'allowManualReassign', true) === false) throw new Error('设置中已关闭手动改派。')
  if (direct && (!text(options.provider) || !text(options.model))) throw new Error('指定模型需要同时提供 provider 和 model。')
  const saved = await routingSavedState(config)
  const routes = await routesWithLearning(ctx, config, options.signal, saved.runs, saved.dynamicData, saved.routingLearning)
  if (direct && !routes.some(route => route.provider === text(options.provider) && route.model === text(options.model))) {
    throw new Error(`模型 ${text(options.provider)}/${text(options.model)} 不在 Harness 模型目录中；请在模型页添加后重试，或改用自动路由。`)
  }
  const installed = options.skipToolProbe === true
    ? (Array.isArray(options.installedToolIds) ? options.installedToolIds : [])
    : await installedToolIds()
  const readiness = Array.isArray(options.readiness) ? options.readiness : options.skipToolProbe === true ? []
    : await Promise.all(installed.map(id => officialToolReadiness(id, options.workspace ?? process.cwd())))
  const runnableToolIds = Array.isArray(options.runnableToolIds)
    ? options.runnableToolIds
    : readiness.filter(item => item.ready && (item.readyModes ?? item.modes ?? []).includes('read-only')).map(item => item.id)
  const loggedOut = options.skipToolProbe === true
    ? (Array.isArray(options.loggedOutToolIds) ? options.loggedOutToolIds : [])
    : loggedOutIds(await currentHealth())
  const preset = routingPresetOf(config, options.preset)
  const planningBilling = await billingContext(config, options)
  const fundingPrices = planningFundingPrices(routes, accountingContext(planningBilling, routes),
    route => channelForProvider(route.provider, installed, runnableToolIds, route, loggedOut).kind)
  const buildWith = (presetId, budgetUsd) => direct
    ? createPlanFromRoutes(taskText, routes, {
      ...planDataOptions(saved, config), pricing: fundingPrices.pricing,
      mode: 'direct', directProvider: options.provider, directModel: options.model,
      installedToolIds: installed, runnableToolIds, preset: presetId, loggedOutToolIds: loggedOut,
    })
    : createPlanFromRoutes(taskText, routes, {
      ...planDataOptions(saved, config), pricing: fundingPrices.pricing,
      mode: options.planMode === 'team' ? 'team' : 'single',
      budgetUsd, installedToolIds: installed, runnableToolIds, preset: presetId, loggedOutToolIds: loggedOut,
    })
  const planWith = (...args) => { const result = buildWith(...args); result.subscriptionPricedRoutes = fundingPrices.subscriptionPricedRoutes; return result }
  let plan = planWith(preset, options.budgetUsd)
  if (manual) {
    plan = applyManualPackagePlan(plan, { task: taskText, packageAssignments: options.packageAssignments,
      packagePlanKey: options.packagePlanKey }, routes, planDataOptions(saved, config))
    await validateManualTools(ctx, plan.manualAssignments, { ...options, installedToolIds: installed, readiness })
  }
  attachPlanAccounting(plan, taskText, routes, accountingContext(planningBilling, routes))
  let budget = budgetFor(config, saved, plan.accounting.apiEstimatedCostUsd, { apiExposure: plan.accounting.apiExposure })
  const perRunLimit = Number(options.budgetUsd) || 0
  if (manual && perRunLimit > 0 && (plan.accounting.apiEstimatedCostUsd === null || plan.accounting.apiEstimatedCostUsd > perRunLimit)) {
    budget = { ...budget, exceeded: budget.exceeded || 'run', estimateUsd: plan.accounting.apiEstimatedCostUsd,
      message: plan.accounting.apiEstimatedCostUsd === null ? '手动分配包含费用未知的目标，无法确认满足本次预算。' : '手动分配的预估费用超出本次预算。' }
  }
  if (budget.exceeded && budget.action === 'downgrade' && !direct && !manual) {
    const cheaper = planWith('economy', budget.remainingUsd > 0 ? budget.remainingUsd : options.budgetUsd)
    attachPlanAccounting(cheaper, taskText, routes, accountingContext(planningBilling, routes))
    const recheck = budgetFor(config, saved, cheaper.accounting.apiEstimatedCostUsd, { apiExposure: cheaper.accounting.apiExposure })
    if (!recheck.exceeded) {
      budget = { ...recheck, downgraded: true, downgradedFrom: preset,
        message: `原方案${budget.message} 已自动降级为“省钱优先”方案（预估 ${cheaper.estimatedCost === null ? '价格待配置' : formatUsd(cheaper.estimatedCost)}）。` }
      plan = cheaper
    }
  }
  return { taskText, direct: Boolean(direct), plan, budget, routes, preset }
}

/** Check every explicit tool before any package can incur cost. */
async function validateManualTools(ctx, assignments, options = {}) {
  const targets = parsePackageAssignments(assignments)
  const ids = [...new Set(Object.values(targets ?? {}).filter(item => item.kind === 'tool').map(item => item.toolId))]
  if (!ids.length) return
  if (typeof ctx.sandbox?.confine !== 'function') throw new Error('手动分配的官方工具需要 Harness 进程沙箱；请检查执行环境后重新预览。')
  const installed = options.installedToolIds ?? await installedToolIds()
  const capabilities = options.executionCapabilities ?? officialToolExecutionCapabilities()
  const knownReadiness = options.manualReadiness ?? options.readiness ?? []
  for (const id of ids) {
    if (!installed.includes(id)) throw new Error(`手动分配的官方工具 ${id} 尚未安装。`)
    if (!capabilities.some(item => item.id === id && item.modes?.includes('read-only'))) throw new Error(`官方工具 ${id} 不支持当前平台的只读执行。`)
    const ready = knownReadiness.find(item => item.id === id)
      ?? await (options.readinessFor ?? officialToolReadiness)(id, options.workspace ?? process.cwd())
    if (ready?.ready !== true || !(ready.readyModes ?? ready.modes ?? []).includes('read-only')) {
      throw new Error(`官方工具 ${id} 尚未就绪：${ready?.reason ?? '请检查工具安装和只读执行支持。'}`)
    }
  }
}

/** Structural validation is opt-in; each API attempt retains its own price and usage. */
async function consultWithQualityGate(ctx, route, task, limit, signal, { gate = null, alternatives = [], approveUpgrade } = {}) {
  if (!gate) return consultConfiguredModel(ctx, route, task, limit, signal)
  const checked = await runQualityCascade({
    route, task, gate, alternatives, approveUpgrade, signal,
    call: request => consultConfiguredModel(ctx, request.route, request.task, limit, request.signal),
  })
  return { ...checked.result,
    provider: checked.result.provider ?? route.provider, model: checked.result.model ?? route.model,
    ...(checked.attempts.length ? { qualityAttempts: checked.attempts } : {}),
  }
}

function apiUpgradeEligible(route, routes) {
  return (route?.billing === undefined || route.billing === 'api-only') && route?.execution !== 'official'
    && billingPlan(route, routes).subscription === null
    && (route?.execution === 'api' || !toolForProvider(route?.provider))
}

/** Route, or honor one explicit model, then run each package through its adapter. */
export async function executeConfiguredAssignment(ctx, task, config = {}, options = {}) {
  const { taskText, direct, plan, budget: previewBudget, routes, preset } = options.preparedAssignment ?? await planAssignment(ctx, task, config, options)
  const billing = await billingContext(config, options)
  attachPlanAccounting(plan, taskText, routes, accountingContext(billing, routes))
  const budget = { ...previewBudget, ...budgetFor(config, await savedState(), plan.accounting.apiEstimatedCostUsd, { apiExposure: plan.accounting.apiExposure }) }
  if (plan.accounting.apiExposure && previewBudget.exceeded === 'run') Object.assign(budget, { exceeded: 'run', message: previewBudget.message })
  if (budget.exceeded && options.confirmOverBudget !== true) {
    return {
      plan, execution: null, paused: true,
      budget: { ...budget, paused: true,
        message: `${budget.message} 已暂停执行：${direct ? '指定模型无法自动降级。' : budget.action === 'pause' ? '设置为超预算时暂停。' : '降级后仍超出预算。'}请向用户确认后，以 confirmOverBudget: true 重新调用。` },
    }
  }
  const finished = []
  const hooks = executionHooks(ctx, { ...options, onPackage: async result => {
    finished.push(result)
    if (typeof options.onPackage === 'function') await options.onPackage(result)
  } })
  const limit = boundedInteger(valueOf(config, 'maxConsultOutputChars', 12_000), 12_000, 500, 50_000)
  const startedAt = Date.now()
  const runId = randomUUID()
  const makeRecord = execution => buildRunRecord({ id: runId, createdAt: startedAt, finishedAt: Date.now(),
    task: taskText, plan, execution, preset: plan.preset ?? preset, workspace: options.workspace ?? '',
    pricingFor: item => routePricing(routes, item), billingFor: billingForResult,
    budget: { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: budget.downgraded === true,
      confirmed: options.confirmOverBudget === true } })
  const lifecycle = await beginExecutionLifecycle({ state: routerStateStore(),
    packageEstimates: packageEstimates(plan, taskText), settings: budgetSettings(config),
    confirmOverBudget: options.confirmOverBudget === true,
    buildRun: ({ status, results }) => makeRecord({ status, packages: results }) })
  if (!lifecycle.accepted) return { plan, execution: null, paused: true, budget: pausedExecutionBudget(lifecycle) }
  const gate = parseQualityGateJson(valueOf(config, 'qualityGateJson', ''))
  const gatedApi = async ({ route, task: packageTask, signal, subscription }) => {
    if (subscription) return consultConfiguredModel(ctx, route, packageTask, limit, signal)
    const plannedPackage = plannedPackages(plan, taskText).find(item => item.id === lifecycle.activePackageId())
    const denied = await reserveChangedApiRoute(lifecycle, { provider: plannedPackage?.recommendedProvider,
      model: plannedPackage?.recommendedModel }, route, packageTask, config, options.confirmOverBudget)
    if (denied) return denied
    const quality = routeQuality(route)
    const alternatives = gate && !direct && route.manualPinned !== true && apiUpgradeEligible(route, routes)
      && valueOf(config, 'qualityEscalationEnabled', false) === true && quality !== null
      ? routes.filter(candidate => apiUpgradeEligible(candidate, routes) && routeQuality(candidate) !== null
        && routeQuality(candidate) > quality && (candidate.provider !== route.provider || candidate.model !== route.model))
        .slice().sort((left, right) => routeQuality(right) - routeQuality(left)
          || `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`))
      : []
    return consultWithQualityGate(ctx, route, packageTask, limit, signal, { gate, alternatives,
      approveUpgrade: async ({ to, attempts }) => {
        if (valueOf(config, 'qualityEscalationEnabled', false) !== true || direct || route.manualPinned === true
          || !apiUpgradeEligible(route, routes) || !apiUpgradeEligible(to, routes)) return false
        const saved = await routingSavedState(config)
        const limits = budgetSettings(config)
        const perRunLimit = Number(plan.optimization?.budgetUsd) || 0
        const constrained = limits.dailyLimitUsd > 0 || limits.monthlyLimitUsd > 0 || perRunLimit > 0
        const spent = spending(saved.runs, undefined, saved.archivedSpending)
        if ((limits.dailyLimitUsd > 0 && spent.unknownToday > 0) || (limits.monthlyLimitUsd > 0 && spent.unknownMonth > 0)) return false
        const estimate = createPlanFromRoutes(packageTask, [to], {
          ...planDataOptions(saved, config), mode: 'direct', directProvider: to.provider, directModel: to.model,
        }).estimatedCost
        if (!Number.isFinite(estimate) || estimate < 0) return false
        const costs = [...finished.map(result => !hasStartedQualityAttempts(result)
          && (result.blocked || result.notStarted || billingForResult(result) === 'subscription') ? { costUsd: 0 }
          : actualCost(result, routePricing(routes, result))), ...attempts.map(result => actualCost(result, result.pricingSnapshot))]
        const pending = plan.costBreakdown.slice(finished.length + 1).map(item => item.estimatedCost)
        const unknownProjection = costs.some(item => item.costUsd === null) || pending.some(value => !Number.isFinite(value))
        if (unknownProjection && constrained) return false
        const projected = unknownProjection ? null
          : costs.reduce((sum, item) => sum + item.costUsd, estimate) + pending.reduce((sum, value) => sum + value, 0)
        if (!unknownProjection && (!Number.isFinite(projected) || perRunLimit > 0 && projected > perRunLimit)) return false
        const id = lifecycle.activePackageId()
        if (!id) return false
        const subscriptionAttempts = lifecycle.results().find(item => item.id === id)?.subscriptionAttempts ?? []
        await lifecycle.partialResult({ ...attempts.at(-1), id, ok: false, subscriptionAttempts, qualityAttempts: attempts })
        if (!(await lifecycle.reserveExtra(id, estimate)).accepted) return false
        // The extra request can be charged before its receipt arrives. Persist
        // both the first receipt and the unknown second attempt before dispatch.
        await lifecycle.partialResult({ ...attempts.at(-1), id, ok: false, subscriptionAttempts, qualityAttempts: [...attempts, {
          provider: to.provider, model: to.model, channel: 'harness-llm', ok: false,
          usage: null, usageIncomplete: true, pricingSnapshot: to.pricing ?? null, finishedAt: Date.now(),
        }] }, { checkBudget: true })
        return true
      },
    })
  }
  let execution
  try {
    execution = await executeAssignmentPlan({
      plan,
      task: taskText,
      routes: plan.availableRoutes,
      workspace: options.workspace,
      signal: options.signal,
      ...hooks,
      onCheckpointStart: item => lifecycle.onCheckpointStart(item),
      onCheckpointResult: result => lifecycle.onCheckpointResult(result),
      onSubscriptionResult: event => checkpointSubscription(lifecycle, event),
      billing: billing ? { ...billing, routes } : null,
      apiFallback: gatedApi,
    })
  } catch (error) {
    // Steps that already ran (and may have been paid for) are always recorded with their spend.
    const message = String(error?.message ?? error)
    const receipts = new Map([...finished, ...lifecycle.results(), ...(error.execution?.packages ?? [])].map(item => [item.id, item]))
    const partial = { status: options.signal?.aborted ? 'cancelled' : 'failed', packages: [...receipts.values()], aggregate: '', error: message }
    const run = buildRunRecord({
      id: runId, createdAt: startedAt, finishedAt: Date.now(), task: taskText, plan, execution: partial,
      preset: plan.preset ?? preset, workspace: options.workspace ?? '',
      pricingFor: item => routePricing(routes, item), billingFor: billingForResult,
      budget: { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: budget.downgraded === true, confirmed: budget.exceeded ? true : undefined },
    })
    run.error = message.slice(0, 2_000)
    let stored = true
    try {
      if (error.code === 'ROUTER_BUDGET_CHANGED') stored = await stopExecutionLifecycle(lifecycle, error, run)
      else if (error.code === 'ROUTER_CHECKPOINT_FAILED') { await lifecycle.interrupt(run); stored = false }
      else await lifecycle.finish(run)
    } catch { stored = false; await lifecycle.interrupt(run) }
    const wrapped = new Error(`${message}${finished.length ? `（已完成 ${finished.length} 个步骤，${stored ? `已记录到运行 ${run.id}，费用计入预算` : '但运行记录保存失败'}）` : ''}`)
    wrapped.runId = stored ? run.id : null
    wrapped.cause = error
    throw wrapped
  }
  const run = buildRunRecord({
    id: runId, createdAt: startedAt, finishedAt: Date.now(), task: taskText, plan, execution,
    preset: plan.preset ?? preset, workspace: options.workspace ?? '',
    pricingFor: item => routePricing(routes, item),
    billingFor: billingForResult,
    budget: { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: budget.downgraded === true, confirmed: budget.exceeded ? true : undefined },
  })
  await reportRunProgress(options, { type: 'stage', stage: 'reviewing' })
  let reviews
  try { reviews = await reviewRunPackages(ctx, run, routes, config, { signal: options.signal, random: options.random, lifecycle }) }
  catch (error) { await lifecycle.interrupt(run); throw error }
  if (options.signal?.aborted) { run.status = 'cancelled'; execution.status = 'cancelled' }
  await reportRunProgress(options, { type: 'stage', stage: 'saving' })
  let stored = true
  try { await lifecycle.finish(run) } catch { stored = false; await lifecycle.interrupt(run) }
  const awaiting = pausedSteps(execution)
  return { plan, execution, budget, runId: run.id, run, reviews, stored, ...(awaiting.length ? { awaitingConfirmation: awaiting } : {}) }
}

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
    packageEstimates: reservations, settings: budgetSettings(config), confirmOverBudget })
  if (!lifecycle.accepted) return { paused: true, run, budget: pausedExecutionBudget(lifecycle) }
  let execution
  try { execution = await runTeam({ plan, task: run.task, workspace: cwd, allowedRoot: root ?? cwd, mode, executionEnvironment,
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
async function annotateCliQuota(run, config, failures) {
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
  if (text(args.cliModel)) {
    if (!route) throw new Error('cliModel 需要同时提供已配置的 provider 和 model 路线')
    if (toolId === 'zcode') throw new Error('ZCode CLI 不支持在单次调用中指定模型')
    modelId = text(args.cliModel)
  }
  const estimate = route ? createPlanFromRoutes(taskText, routes, { mode: 'direct', directProvider: route.provider, directModel: route.model }).estimatedCost : null
  const funding = initialFunding(route ?? {}, { ...accountingContext(null, routes, true), toolId })
  const apiEstimate = funding.billing === 'subscription' ? 0 : estimate
  const budget = budgetFor(config, await savedState(), apiEstimate, { apiExposure: funding.billing === 'api' })
  const resources = route ? estimateAssignedPackage(route, { id: 'direct', objective: taskText, type: 'general' }, taskText) : null
  const accounting = { apiEstimatedCostUsd: apiEstimate, apiExposure: funding.billing === 'api', packages: [{ id: 'direct', billing: funding.billing,
    apiEstimatedCostUsd: apiEstimate, estimatedUsage: { inputTokens: resources?.inputTokens ?? null, outputTokens: resources?.outputTokens ?? null } }] }
  return { toolId, tool, taskText, mode, modelId, route, routes, accounting, funding: funding.billing, apiEstimate, estimate: Number.isFinite(estimate) ? estimate : null, budget,
    provider: route?.provider ?? '', model: route?.model ?? '', cliModel: modelId }
}

/** Run a planned tool call and record it; `rerunOf` links a rerun to the original run. */
async function runPlannedTool(ctx, config, planned, { cwd, root, signal, rerunOf = null, confirmOverBudget = false, runTask = runOfficialTask }) {
  const startedAt = Date.now()
  const runId = randomUUID()
  const makeToolRecord = (result, location = {}) => {
    const run = buildToolRunRecord({ id: runId, createdAt: startedAt, finishedAt: Date.now(),
      toolId: planned.toolId, toolLabel: planned.tool?.label ?? planned.toolId, task: planned.taskText,
      provider: planned.provider, model: planned.model, cliModel: planned.cliModel,
      mode: planned.mode, workspace: cwd, result, estimatedCost: planned.estimate, rerunOf,
      pricingFor: item => routePricing(planned.routes, item), billingFor: billingForResult, budget: planned.budget })
    if (location.isolatedWorkspace) run.isolatedWorkspace = location.isolatedWorkspace
    if (location.baseCommit) run.baseCommit = location.baseCommit
    return run
  }
  const lifecycle = await beginExecutionLifecycle({ state: routerStateStore(), settings: budgetSettings(config), confirmOverBudget,
    packageEstimates: [{ id: 'direct', billing: planned.funding ?? 'api', estimatedCostUsd: planned.apiEstimate ?? planned.estimate ?? null }],
    buildRun: ({ status, results, workspace }) => makeToolRecord(results[0] ?? { status, notStarted: true }, workspace) })
  if (!lifecycle.accepted) {
    planned.budget = pausedExecutionBudget(lifecycle)
    return { result: { status: 'paused-budget', budget: planned.budget }, recorded: null }
  }
  let result
  try {
    result = await runTask({ toolId: planned.toolId, task: planned.taskText, modelId: planned.modelId, workspace: cwd, allowedRoot: root ?? cwd,
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
    subscriptionUsage: { ...subscriptionUsage(saved.runs, Date.now(), saved.archivedSubscriptionUsage), historyIncomplete: saved.subscriptionUsageIncomplete === true },
    reserved,
    reservations: entries.map(entry => ({ id: entry.id, runId: entry.runId, status: entry.status, updatedAt: entry.updatedAt,
      billing: entry.packages.every(item => item.billing === 'subscription') ? 'subscription' : entry.packages.some(item => item.billing === 'subscription') ? 'mixed' : 'api',
      unknown: entry.packages.some(item => item.billing !== 'subscription' && (item.estimatedCostUsd === null || entry.status === 'interrupted' && item.started)),
      remainingEstimateUsd: entry.packages.every(item => Number.isFinite(item.estimatedCostUsd))
        ? entry.packages.reduce((sum, item) => sum + item.estimatedCostUsd, 0) : null })),
    budget: { ...budgetFor(config, saved, null, { checkEstimate: false }), historyVerified: saved.historyVerified !== false },
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

/** Per-route read/write boundaries for the security card. */
export async function securityBoundaries(ctx, config = {}) {
  const routes = configuredRoutesWithProfiles(await discoverConfiguredRoutes(ctx), config)
  const readiness = await Promise.all(['claude-code', 'codex'].map(id => officialToolReadiness(id).catch(() => ({ id, ready: false }))))
  const sandboxedToolIds = readiness.filter(item => item.ready && typeof ctx.sandbox?.confine === 'function').map(item => item.id)
  return { platform: process.platform, sandboxAvailable: typeof ctx.sandbox?.confine === 'function', boundaries: routeBoundaries(routes, { sandboxedToolIds, platform: process.platform }) }
}

function explicitRoute(args, routes) {
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

function chooseConsultRoute(plan, routes, agent) {
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

function teamExecutionEnvironment(value = 'harness', mode = 'read-only') {
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
  const runId = randomUUID()
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
    confirmOverBudget: options.confirmOverBudget === true, packageEstimates: packageEstimates(planned.plan, planned.taskText),
    buildRun: ({ status, results, workspace: location }) => makeTeamRecord({ status, results }, location) })
  if (!lifecycle.accepted) return { ...common, status: 'paused-budget', budget: pausedExecutionBudget(lifecycle) }
  let execution
  try { execution = await (options.runTeam ?? runOfficialTeam)({ plan: planned.plan, task: planned.taskText, workspace,
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

function commandText(plan) {
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

function approvalReasons(name, args, config, { sandboxAvailable = false, rerunRun = null } = {}) {
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

async function executePreparedWorkbenchRun(ctx, config, prepared, options = {}) {
  const { preview, request } = prepared
  const confirmed = new Set(Array.isArray(request.confirmedReasons) ? request.confirmedReasons : [])
  throwIfAborted(options.signal)
  await reportRunProgress(options, { type: 'stage', stage: 'executing' })
  if (request.executor === 'official-team') {
    const result = await (options.executeOfficialTeam ?? executeOfficialTeamPlan)(ctx, config, prepared.planned, {
      confirmOverBudget: confirmed.has('over-budget'), confirmUnsandboxed: confirmed.has('unsandboxed'), ...(options.teamOptions ?? {}),
      workspace: preview.workspace, root: preview.workspace, signal: options.signal, onProgress: options.onProgress,
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
  const prepared = await prepareWorkbenchPreview(ctx, config, supplied, options)
  const refused = refusedWorkbenchStart(prepared)
  if (refused) return refused
  return runJobs.start({
    packages: prepared.preview.decision?.packages ?? [],
    run: async ({ signal, onProgress }) => {
      try { return await executePreparedWorkbenchRun(ctx, config, prepared, { ...options, signal, onProgress }) }
      catch (error) {
        if (error?.runId) return { status: signal.aborted ? 'cancelled' : 'failed', runId: error.runId,
          workspace: prepared.preview.workspace, notice: '执行未完成，已产生的结果与费用请查看执行记录。' }
        throw error
      }
    },
  })
}

/** Host operations behind the workbench RPC; the client never supplies commands or paths. */
/**
 * One terminal manager per Host plugin fiber. Sessions run outside the
 * Harness sandbox with the Host's login environment; only metadata is kept.
 */
export function createRouterTerminals(options = {}) {
  return createTerminalManager({
    prepare: () => ensureNpmPrefixOnPath(),
    preferences: () => installPreferences(),
    launchOptions: () => currentInstallOptions(),
    onSessionEnd: record => { void routerStateStore().appendTerminalSession(record).catch(() => {}) },
    ...options,
  })
}

async function terminalHistory(limit = 20) {
  const saved = await savedState()
  return (saved.terminalSessions ?? []).slice(-limit).reverse()
}

function terminalServices(terminals, assertPreferences = () => {}) {
  if (!terminals) return {}
  return {
    terminalInfo: async () => {
      const tools = await probeAllTools({ fresh: true })
      return { ...terminals.info(), tools, toolsCheckedAt: Date.now(), history: await terminalHistory() }
    },
    terminalStart: async request => { assertPreferences(); return terminals.start(parseTerminalStart(request)) },
    terminalRead: async request => terminals.read(parseTerminalRead(request)),
    terminalWrite: async request => terminals.write(parseTerminalWrite(request)),
    terminalResize: async request => terminals.resize(parseTerminalResize(request)),
    terminalStop: async request => terminals.stop(parseTerminalStop(request)),
  }
}

export function routerRemoteServices(ctx, config, { terminals = null, assertPreferences, runJobs = createRunJobs(), runOptions = {} } = {}) {
  return {
    ...terminalServices(terminals, assertPreferences),
    health: async fresh => {
      const report = await toolHealthReport({ fresh: fresh === true })
      const saved = await savedState()
      return { ...report, onboarding: saved.onboarding, notices: recentNotices(saved), billing: await billingHealth(ctx, config) }
    },
    completeOnboarding: async () => routerStateStore().completeOnboarding(Date.now()),
    ledger: () => ledgerSummary(config),
    rate: request => rateRecordedResult(request, { origin: 'desktop-ui' }),
    rerun: request => rerunRecordedStep(ctx, config, {
      runId: request?.runId, packageId: request?.packageId, provider: request?.provider, model: request?.model,
      confirmOverBudget: request?.confirmOverBudget === true, confirmWrite: request?.confirmWrite === true,
      confirmUnsandboxed: request?.confirmUnsandboxed === true,
      ...(request?.subscriptionChoice ? { subscriptionChoice: request.subscriptionChoice } : {}),
    }),
    boundaries: () => securityBoundaries(ctx, config),
    previewRun: request => previewWorkbenchRun(ctx, config, request, runOptions),
    startRun: request => launchWorkbenchRun(ctx, config, request, { ...runOptions, runJobs }),
    runStatus: request => runJobs.status(parseRunJobRequest(request).jobId),
    cancelRun: request => runJobs.cancel(parseRunJobRequest(request).jobId),
  }
}

/** Register model-facing tools and the human /router command. */
export function apply(ctx, config = {}) {
  guardLegacyTools(ctx, config)
  // Install addresses (directory, npm source, per-tool method and script source)
  // are volatile refs: Loader changes them without re-applying the plugin.
  // Read them after the owning fiber's live update, before a saved view is sent.
  let installPreferenceError = null
  const syncInstallPreferences = () => {
    try {
      const next = parseInstallPreferences(config, { tools: OFFICIAL_TOOLS, ...currentInstallOptions() })
      setInstallPreferences(next)
      installPreferenceError = null
    } catch (error) { installPreferenceError = errorText(error) }
  }
  const installFields = new Set(['toolInstallDir', 'toolNpmRegistry', 'toolInstallMethodsJson', 'toolScriptUrlsJson', 'toolAllowScriptInstall'])
  syncInstallPreferences()
  // Loader scopes this event to the fiber whose refs were committed.
  ctx.on('loader/volatile-update', paths => {
    if (Array.isArray(paths) && paths.some(path => installFields.has(path?.[0]))) syncInstallPreferences()
  })
  const assertInstallPreferences = () => {
    if (installPreferenceError) throw new Error(`官方工具安装设置无效：${installPreferenceError}`)
  }
  // The official Host injects typert; direct lightweight uses of apply may
  // supply only the model/command services and do not expose the Desktop RPC.
  if (ctx.typert) {
    const terminals = createRouterTerminals()
    const runJobs = createRunJobs()
    // Plugin unload or patch reload kills every interactive session.
    ctx.effect(() => {
      const onExit = () => { terminals.disposeAll('dispose'); runJobs.dispose() }
      process.once('exit', onExit)
      return () => { process.off('exit', onExit); terminals.disposeAll('dispose'); runJobs.dispose() }
    }, 'model-router-galgame: interactive terminals')
    registerOfficialToolsRemote(ctx, {
      ...routerRemoteServices(ctx, config, { terminals, runJobs, assertPreferences: assertInstallPreferences }),
      requireBotPolicy: () => policyRequired(config),
      installSettingsError: () => installPreferenceError,
      installRequestedDirectory: () => valueOf(config, 'toolInstallDir', ''),
    })
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    // Refuse before installation/write approval prompts; the monotonic guard and
    // body wrapper repeat this check after asynchronous admission.
    if (exec.name.startsWith('model_router_')) {
      try { legacyPolicy(ctx, policyRequired(config))?.check({ kind: 'tool', name: exec.name, agent: exec.agent }) }
      catch (error) { return { kind: 'deny', reason: error.message } }
    }
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name === 'model_router_rate') {
      return { kind: 'ask', reason: 'Confirm the user\'s subjective rating; agents must not self-rate their results',
        displayReason: { en: 'Save this as your rating and adjust future recommendations?', zh: '确认这是你对该结果的评价，并用于调整以后的推荐？Agent 不能代替你给自己评分。' } }
    }
    if (exec.name === 'model_router_tool_install' || exec.name === 'model_router_tool_uninstall' || exec.name === 'model_router_tool_repair') {
      const requested = getOfficialTool(text(exec.arguments?.tool))
      const label = requested?.label ?? '官方 CLI'
      const method = installMethodFor(requested, text(exec.arguments?.method))
      const how = method ? `（${method.label}）` : ''
      const uninstalling = exec.name === 'model_router_tool_uninstall'
      const repairing = exec.name === 'model_router_tool_repair'
      const verb = uninstalling ? 'Uninstall' : repairing ? 'Reinstall to repair' : 'Install'
      return {
        kind: 'ask',
        reason: `${verb} ${label}${how} on this machine`,
        displayReason: {
          en: uninstalling
              ? `Uninstall ${label}${how}? Its settings, login and history are kept; only the program is removed.`
              : repairing
                ? `Reinstall ${label}${how} to repair a broken install?`
                : `Install ${label}${how} using the plugin's fixed source?`,
          zh: uninstalling
              ? `卸载 ${label}${how}？配置、登录信息和历史记录都会保留，只删除程序本身。`
              : repairing
                ? `重新安装 ${label}${how} 以修复损坏的安装？`
                : `使用插件固定的来源，在本机安装 ${label}${how}？`,
        },
      }
    }
    let rerunRun = null
    if (exec.name === 'model_router_rerun_step') {
      try { rerunRun = (await savedState()).runs.find(item => item.id === text(exec.arguments?.runId)) ?? null } catch { rerunRun = null }
    }
    const reasons = approvalReasons(exec.name, exec.arguments ?? {}, config, { sandboxAvailable: typeof ctx.sandbox?.confine === 'function', rerunRun })
    if (reasons.length) return combinedAsk(reasons)
    return decision
  })
  registerOfficialToolModels(ctx, config, assertInstallPreferences)
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_routes',
    description: 'List provider/model routes registered in the official DeepSeek Harness model directory. Credential and network availability are not verified. No API keys or endpoints are returned.',
    parameters: {},
    output: JSON_OUTPUT,
    async execute(_args, exec) {
      const routes = await discoverConfiguredRoutes(ctx, exec.signal)
      return jsonValue({ routes, count: routes.length, availabilityNotice: '目录记录不证明账号凭据和网络当前可用。' })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_plan',
    description: 'Analyze task difficulty, recommend only configured Harness model routes, and optionally split compound work into dependent packages. Cost estimates require user-supplied USD prices for the exact routes.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task to analyze.' },
      mode: { type: 'string', enum: ['single', 'team'], description: 'Use team to produce Agent Teams work packages.' },
      budgetUsd: { type: 'number', description: 'Optional local estimated cost ceiling in USD.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      return jsonValue(await createRoutePlan(ctx, args.task, config, { mode: args.mode, budgetUsd: args.budgetUsd, signal: exec.signal }))
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_consult',
    description: 'Ask one already configured Harness model for an independent opinion. Supply both provider and model for an explicit route, or omit both for a recommended route different from the current model when available.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task or question for the consulted model.' },
      provider: { type: 'string', description: 'Configured provider id; pair with model.' },
      model: { type: 'string', description: 'Configured model id; pair with provider.' },
      outputLimit: { type: 'number', description: 'Maximum returned characters, from 500 to 50000.' },
      confirmOverBudget: { type: 'boolean', description: 'Only after explicit user approval when the API budget is exceeded or unverified.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const routes = await discoverConfiguredRoutes(ctx, exec.signal)
      if (routes.length === 0) throw new Error('Harness 模型目录中没有可用路线；请先在官方“模型”页添加模型。')
      const requested = explicitRoute(args, routes)
      const plan = requested ? null : await createRoutePlan(ctx, args.task, config, { signal: exec.signal })
      const route = requested ?? chooseConsultRoute(plan, routes, exec.agent)
      const fallback = valueOf(config, 'maxConsultOutputChars', 12_000)
      const limit = boundedInteger(args.outputLimit, finiteNumber(fallback, 12_000), 500, 50_000)
      return jsonValue(await executeBudgetedConsult(ctx, route, args.task, config, { routes, limit, signal: exec.signal, confirmOverBudget: args.confirmOverBudget === true }))
    },
  }))
  registerPolicyCommand(ctx, config, {
    name: 'router',
    description: 'Show an official-model route recommendation for a task.',
    input: { hint: 'Describe the task to plan' },
    async handler({ rawInput, signal }) {
      if (!text(rawInput)) return { kind: 'error', text: '用法：/router <需要规划的任务>' }
      try {
        const plan = await createRoutePlan(ctx, rawInput, config, { signal })
        return { kind: 'success', text: commandText(plan) }
      } catch (error) {
        return { kind: 'error', text: `无法生成路由计划：${errorText(error)}` }
      }
    },
  })
  registerPolicyCommand(ctx, config, {
    name: 'tools',
    description: 'Show official model CLI install status, or install/uninstall/repair one registry tool.',
    input: { hint: '留空查看状态；或输入 install/cancel/uninstall/repair/method <工具id> [安装方式]' },
    async handler({ rawInput, signal }) {
      const input = text(rawInput)
      const matched = input.match(/^(install|uninstall|repair|cancel|method)\s+([A-Za-z0-9_-]+)(?:\s+([A-Za-z0-9-]+))?$/i)
      if (!matched && input) {
        return { kind: 'error', text: '用法：/tools 查看状态，或 /tools install/uninstall/repair/cancel/method <工具id> [安装方式]' }
      }
      if (matched && matched[1].toLowerCase() === 'cancel') {
        try { return { kind: 'success', text: `已请求取消 ${cancelInstall(matched[2]).tool} 的安装；请使用 /tools 查看最新状态。` } }
        catch (error) { return { kind: 'error', text: `无法取消安装：${errorText(error)}` } }
      }
      if (matched && matched[1].toLowerCase() === 'method') {
        // Printing the methods is a read-only answer; persisting one is a config
        // change and stays in the settings form / workbench panel.
        const tool = getOfficialTool(matched[2])
        if (!tool) return { kind: 'error', text: `未知工具：${matched[2]}。` }
        const lines = installMethodsFor(tool).map(method => `• ${method.id}：${method.label}`)
        return {
          kind: 'success',
          text: lines.length
            ? `${tool.label} 可用的安装方式：\n${lines.join('\n')}\n在“模型路由工作台 → 官方工具”里切换，或在插件设置里固定默认方式。`
            : `${tool.label} 没有可切换的安装方式（不支持）。`,
        }
      }
      if (!matched) {
        try {
          const probes = await probeAllTools({ fresh: true })
          const lines = probes.map(probe => {
            const tool = getOfficialTool(probe.id)
            let command = null
            try { command = planCommandLine(resolveInstallPlan(tool, undefined, installPreferences(), currentInstallOptions())) }
            catch { command = installCommandLine(tool) }
            const status = probe.status === 'installed'
              ? `已安装 ${probe.version ?? ''}`
              : probe.status === 'unsupported'
                ? '不支持一键安装'
                : '未安装'
            const methods = installMethodsFor(tool).map(method => method.id).join(' / ')
            return `• ${tool.label}（${probe.id}）：${status}${methods ? `［${methods}］` : ''}`
              + `${command && probe.status === 'not-installed' ? `\n  安装：/tools install ${probe.id}（即 ${command}）` : ''}`
          })
          const header = installPreferenceError ? `⚠ 官方工具安装设置无效：${installPreferenceError}\n` : ''
          return { kind: 'success', text: `${header}官方工具状态：\n${lines.join('\n')}` }
        } catch (error) {
          return { kind: 'error', text: `探测失败：${errorText(error)}` }
        }
      }
      const action = matched[1].toLowerCase()
      const toolId = matched[2]
      const method = matched[3]
      try {
        assertInstallPreferences()
        const job = action === 'uninstall' ? startUninstall(toolId, { method })
          : action === 'repair' ? startRepair(toolId, { method })
            : startInstall(toolId, { method })
        const tool = getOfficialTool(toolId)
        const settled = await waitForInstall(job.tool, signal)
        const done = { uninstall: '卸载完成', repair: '修复完成', install: '安装完成' }[action]
        if (settled.status === 'succeeded') {
          const probe = await probeToolWith(tool, defaultRunner, { cacheMs: 0 })
          const suffix = probe.version ? `，探测版本 ${probe.version}` : ''
          if (settled.error) return { kind: 'success', text: `${tool.label} ${done}${suffix}。${settled.error}` }
          return { kind: 'success', text: `${tool.label} ${done}${suffix}。` }
        }
        return { kind: 'error', text: `${tool.label} ${action === 'uninstall' ? '卸载' : action === 'repair' ? '修复' : '安装'}失败：${settled.error ?? '未知原因'}\n${settled.outputTail.slice(-6).join('\n')}` }
      } catch (error) {
        return { kind: 'error', text: `无法开始${action === 'uninstall' ? '卸载' : '安装'}：${errorText(error)}` }
      }
    },
  })
}

/** Poll an install job until it settles or the signal aborts. */
async function waitForInstall(toolId, signal) {
  for (;;) {
    if (signal?.aborted) {
      try { cancelInstall(toolId) } catch { /* install may already have finished */ }
      throw new Error('已请求取消安装；请重新检测实际安装状态。')
    }
    const job = installStatus(toolId)
    if (!job) throw new Error('安装任务丢失。')
    if (job.status !== 'running') return job
    await new Promise(resolve => setTimeout(resolve, 1_500))
  }
}

/** Register the model-facing official-tool probes and installer. */
function registerOfficialToolModels(ctx, config, assertInstallPreferences) {
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tools',
    description: 'Probe the fixed registry of official model tools (Kimi Code, Claude Code, Codex, MiniMax Code, MiMo Code, Grok Build, Gemini CLI, OpenCode, Step Code, ZCode CLI) and report which are installed with their versions, plus each tool\'s available install methods and the effective install directory and npm source. Never reads credentials.',
    parameters: {},
    output: JSON_OUTPUT,
    async execute(_args, exec) {
      throwIfAborted(exec.signal)
      const probes = await probeAllTools()
      return jsonValue({
        tools: probes,
        executionCapabilities: officialToolExecutionCapabilities(),
        executionReadiness: await Promise.all(probes.map(probe => probe.installed
          ? officialToolReadiness(probe.id)
          : Promise.resolve({ id: probe.id, ready: false, reason: 'CLI 尚未安装或版本检测失败。' }))),
        installMethods: Object.fromEntries(OFFICIAL_TOOLS.map(tool => [tool.id, installMethodsFor(tool).map(method => ({
          id: method.id, label: method.label, kind: method.kind,
        }))])),
        installHint: '未安装的工具可由 model_router_tool_install 按注册表固定命令安装，损坏的用 model_router_tool_repair 修复，多余的用 model_router_tool_uninstall 卸载；安装目录与下载源来自用户设置，版本与包名不接受自定义。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tool_install',
    description: 'Install one official model tool by registry id from its fixed source at the latest release, using one of that tool\'s declared install methods (npm, pnpm, vendor installer script or verified GitHub release archive). ZCode CLI offers the fixed @ljwei-stak/zcode-cli npm package (complete runtime, no separate GitHub download) and the default community-maintained Alice-Marx/zcode-cli GitHub Release archive; each uses the selected method and saved directory/source settings. Recognized legacy ZCode desktop launchers are backed up before npm installation; unrecognized conflicting files are preserved without --force. Only registry ids and declared method ids are accepted; arbitrary packages, URLs or executables are refused. The install directory and download sources come from the user\'s own plugin settings.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Registry tool id, e.g. kimi-code.' },
      method: { type: 'string', description: 'Install method id for this tool, e.g. npm, pnpm, script-bash, script-powershell or github-release. Omit to use the user\'s configured default.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      assertInstallPreferences()
      const job = startInstall(args.tool, { method: text(args.method) || undefined })
      const settled = await waitForInstall(job.tool, exec.signal)
      const tool = getOfficialTool(args.tool)
      const probe = settled.status === 'succeeded'
        ? await probeToolWith(tool, defaultRunner, { cacheMs: 0 })
        : null
      return jsonValue({
        ...settled,
        postInstallProbe: probe,
        notice: '安装命令完全来自服务端注册表与用户设置；实际版本以探测横幅为准。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tool_repair',
    description: 'Reinstall one official model tool by registry id, even when it already reports the latest version, to repair a broken or incomplete install. Settings and login are kept. Only registry ids and declared method ids are accepted.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Registry tool id, e.g. codex.' },
      method: { type: 'string', description: 'Install method id for this tool. Omit to use the user\'s configured default.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      assertInstallPreferences()
      const job = startRepair(args.tool, { method: text(args.method) || undefined })
      const settled = await waitForInstall(job.tool, exec.signal)
      const tool = getOfficialTool(args.tool)
      const probe = settled.status === 'succeeded'
        ? await probeToolWith(tool, defaultRunner, { cacheMs: 0 })
        : null
      return jsonValue({
        ...settled,
        postInstallProbe: probe,
        notice: '修复会重新执行同一条固定官方安装命令；工具的配置与登录信息不受影响。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tool_uninstall',
    description: 'Remove one official model tool by registry id. Package-manager installs are removed with the same manager; vendor-script installs delete only the executable the vendor installer placed, plus that install\'s own PATH entry in the shell profile. Configuration, credentials and session history are always kept. Only registry ids and declared method ids are accepted.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Registry tool id, e.g. opencode.' },
      method: { type: 'string', description: 'The install method it was installed with, so the matching removal runs. Omit to use the user\'s configured default.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      assertInstallPreferences()
      const job = startUninstall(args.tool, { method: text(args.method) || undefined })
      const settled = await waitForInstall(job.tool, exec.signal)
      const tool = getOfficialTool(args.tool)
      return jsonValue({
        ...settled,
        notice: '卸载只删除程序本身；工具的配置、登录信息和历史记录保留，重新安装后仍在。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tool_run',
    description: 'Run one supported official model CLI in the current Harness session workspace. Claude, Codex, MiMo and Grok support read-only; Kimi, MiniMax and ZCode require workspace-write. Write mode needs approval and a clean Git repository. Optional provider/model must match a configured Harness route and selected vendor; cliModel can specify that vendor CLI’s own configured model name. Every CLI uses its own default unless an explicit cliModel or saved route mapping is configured.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Fixed registry tool id, e.g. claude-code or codex.' },
      task: { type: 'string', required: true, description: 'Concrete task for the official CLI model.' },
      provider: { type: 'string', description: 'Optional configured provider, paired with model.' },
      model: { type: 'string', description: 'Optional model ID from the Harness directory, paired with provider. This ID is advisory for CLIs except Claude/Codex.' },
      cliModel: { type: 'string', description: 'Optional model name already configured in this vendor CLI; requires provider and model. MiniMax/MiMo require provider/model format. ZCode cannot switch models per call.' },
      mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default is read-only. Kimi, MiniMax and ZCode require workspace-write. Write mode requires official approval and a clean Git repository.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const planned = await planToolRun(ctx, config, args, { signal: exec.signal })
      if (planned.mode === 'workspace-write' && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能请求可编辑 CLI 执行')
      if (planned.budget.exceeded && args.confirmOverBudget !== true) {
        return jsonValue({ status: 'paused-budget', budget: { ...planned.budget, paused: true }, estimateUsd: planned.apiEstimate ?? (planned.funding === 'subscription' ? 0 : planned.estimate), accounting: planned.accounting ?? null,
          notice: `${planned.budget.message} 已暂停，未启动 ${planned.tool.label}。请向用户说明后，以 confirmOverBudget: true 重新调用。` })
      }
      const { result, recorded } = await runPlannedTool(ctx, config, planned, { cwd, root, signal: exec.signal, confirmOverBudget: args.confirmOverBudget === true })
      return jsonValue({ ...result, runId: recorded?.id ?? null, estimateUsd: planned.apiEstimate ?? (planned.funding === 'subscription' ? 0 : planned.estimate), accounting: planned.accounting ?? null, budget: planned.budget,
        ...(!planned.modelId && planned.model ? { modelNotice: result.modelNotice
          ?? 'Harness 模型 ID 未经此厂商 CLI 验证；本次使用厂商 CLI 已配置的默认模型。' } : {}),
        ...(planned.funding === 'subscription' ? { costNotice: '订阅单独统计用量，不占用 API 金额预算；厂商未回报的用量保持未知。' } : planned.estimate === null ? { costNotice: '实际计费方式或 API 单价未知，请先核对后确认。' } : {}),
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_execute',
    description: 'Run a task on configured models and aggregate the results. Omit provider and model to route first. Supply both to use that one model and skip routing. With assignmentMode manual, use the packagePlanKey from model_router_plan and packageAssignmentsJson to pin each package to an exact API route or registered official tool. Manual tool failures do not fall back to API. Automatic profiles retain CLI/API billing policy. This call is read-only and does not apply file edits.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task to execute.' },
      provider: { type: 'string', description: 'Configured provider. Pair with model to bypass routing.' },
      model: { type: 'string', description: 'Configured model. Pair with provider to bypass routing.' },
      planMode: { type: 'string', enum: ['single', 'team'], description: 'Used only when provider and model are omitted.' },
      assignmentMode: { type: 'string', enum: ['algorithm', 'manual'], description: 'Use algorithm recommendations, or pin every decomposed package to the user-selected API model or official tool.' },
      packagePlanKey: { type: 'string', description: 'Required for manual mode: the current decomposition key returned by model_router_plan for the same task and mode.' },
      packageAssignmentsJson: { type: 'string', description: 'Required for manual mode: JSON object keyed by every package id, values {kind:"api",provider,model} or {kind:"tool",toolId}. Tools use their configured default model. No commands or arguments.' },
      budgetUsd: { type: 'number', description: 'Optional local estimate ceiling when routing. Not a vendor billing cap.' },
      preset: { type: 'string', enum: ['economy', 'balanced', 'quality'], description: 'Optional routing preset for this call; defaults to the saved setting.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd } = await sessionWorkspace(ctx, exec)
      const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
      let assignments
      if (args.packageAssignmentsJson !== undefined) {
        if (typeof args.packageAssignmentsJson !== 'string' || args.packageAssignmentsJson.length > 32_000) throw new Error('工作包分配 JSON 超出限制。')
        try { assignments = parsePackageAssignments(JSON.parse(args.packageAssignmentsJson)) }
        catch { throw new Error('工作包分配 JSON 无效；请按包 ID 提供模型 API 或官方工具目标。') }
      }
      const result = await executeConfiguredAssignment(ctx, args.task, config, {
        provider: args.provider,
        model: args.model,
        planMode: args.planMode,
        assignmentMode: args.assignmentMode,
        ...(assignments === undefined ? {} : { packageAssignments: assignments }),
        ...(args.packagePlanKey === undefined ? {} : { packagePlanKey: args.packagePlanKey }),
        preset: args.preset,
        budgetUsd: finiteNumber(args.budgetUsd, finiteNumber(configuredBudget, 0)),
        confirmOverBudget: args.confirmOverBudget === true,
        workspace: cwd,
        signal: exec.signal,
      })
      return jsonValue({
        routingBypassed: result.plan.routingBypassed === true,
        selected: result.plan.selected,
        decision: decisionSummary(result.plan),
        budget: result.budget,
        ...(result.paused ? { status: 'paused-budget' } : result.awaitingConfirmation ? { status: 'paused-subscription-failure', awaitingConfirmation: result.awaitingConfirmation } : {}),
        execution: result.execution,
        runId: result.runId ?? null,
        reviews: result.reviews ?? [],
        notice: result.paused
          ? '已因预算暂停，未启动任何模型。请向用户说明预估费用，用户同意后再以 confirmOverBudget: true 调用。'
          : result.awaitingConfirmation ? SUBSCRIPTION_PAUSE_NOTICE
          : result.plan.assignmentMode === 'manual' ? '已按手动分配执行只读工作包；API 模型和官方工具目标固定，工具使用厂商默认模型，失败不会自动改派。可用 model_router_rerun_step 按保存的目标重跑。'
          : '官方 CLI 以只读无界面方式运行。可编辑改动仍使用 model_router_tool_run 或 model_router_team_execute。未安装、未登录、失败或配置为 api 的模型走模型目录 API；回退原因与 CLI 原始错误见 fallback。可用 model_router_rerun_step 重跑失败步骤，model_router_rate 记录评价。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_health',
    description: 'Onboarding health check: for each official CLI in the fixed registry, report installed version, the latest published version when it can be looked up cheaply (update hint only), and login state (cheap status commands only; never starts a login), plus a per-provider billing table: billing mode (subscription-first by default), subscription state (logged in / coding-plan key route / exhausted until a time) and whether an API-key route is available for fallback. Logged-out tools are skipped by routing until re-checked.',
    parameters: {
      fresh: { type: 'boolean', description: 'Re-probe instead of using the 60s probe cache.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      throwIfAborted(exec.signal)
      const report = await toolHealthReport({ fresh: args.fresh === true })
      return jsonValue({ ...report, notices: recentNotices(await savedState()), billing: await billingHealth(ctx, config, { signal: exec.signal }) })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_rerun_step',
    description: 'Re-run one failed work package of a recorded model_router_execute or model_router_team_execute run without restarting finished packages; unfinished downstream packages follow. An editable (workspace-write) team run that stopped at a failed step continues in a fresh isolated Git worktree seeded with the earlier changes (needs approval, a clean repository at the same commit). A failed model_router_tool_run call (packageId "direct") is repeated as a new linked run. Supply provider and model to reassign a routed or team package to another configured route (if the user allows manual reassignment).',
    parameters: {
      runId: { type: 'string', required: true, description: 'runId returned by model_router_execute.' },
      packageId: { type: 'string', required: true, description: 'Work package id to re-run.' },
      provider: { type: 'string', description: 'Optional configured provider to reassign to; pair with model.' },
      model: { type: 'string', description: 'Optional configured model to reassign to; pair with provider.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the budget. Triggers an approval prompt.' },
      subscriptionChoice: { type: 'string', enum: ['api', 'subscription', 'cancel'], description: 'Only for a step paused after a non-quota subscription failure, and only with the user\'s decision: api = retry on the API key (approval prompt), subscription = retry the subscription, cancel = stop the step and its waiting downstream steps.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const stored = (await savedState()).runs.find(item => item.id === text(args.runId))
      if (stored && rerunSupport(stored).writes && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能重跑可编辑的运行')
      // The pre-execute hook already asked the user about file edits for editable reruns.
      const result = await rerunRecordedStep(ctx, config, {
        runId: args.runId, packageId: args.packageId, provider: args.provider, model: args.model,
        confirmOverBudget: args.confirmOverBudget === true, confirmWrite: true, confirmUnsandboxed: stored?.executionEnvironment === 'cli-native', workspace: cwd, root, signal: exec.signal,
        ...(text(args.subscriptionChoice) ? { subscriptionChoice: text(args.subscriptionChoice) } : {}),
      })
      return jsonValue({
        ...(result.paused ? { status: 'paused-budget' } : result.cancelled ? { status: 'cancelled' } : result.awaitingConfirmation ? { status: 'paused-subscription-failure', awaitingConfirmation: result.awaitingConfirmation, notice: SUBSCRIPTION_PAUSE_NOTICE } : {}),
        budget: result.budget, execution: result.execution ?? null, runId: result.run?.id ?? args.runId,
        ...(result.rerunOf ? { rerunOf: result.rerunOf, newRunId: result.newRunId } : {}),
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_rate',
    description: 'Record only the user\'s explicitly stated rating of one recorded result (up, down, clear). Requires approval; never self-rate. Feedback adjusts bounded local subjective utility, not objective quality.',
    parameters: {
      runId: { type: 'string', required: true, description: 'runId returned by model_router_execute.' },
      packageId: { type: 'string', required: true, description: 'Work package id.' },
      rating: { type: 'string', required: true, enum: ['up', 'down', 'clear'], description: 'The user\'s rating.' },
      expectedFinishedAt: { type: 'number', description: 'Completion timestamp of the displayed result; rejects stale feedback after a rerun.' },
    },
    output: JSON_OUTPUT,
    async execute(args) {
      const run = await rateRecordedResult(args, { origin: 'approved-tool' })
      return jsonValue({ ok: true, runId: run.id, packageId: args.packageId, rating: args.rating })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_team_execute',
    description: 'Plan a complex task into dependent work packages, route among configured providers with ready official CLIs, and run each package sequentially. Every CLI uses its own default unless a saved cliModel mapping or cliModelsJson supplies exact CLI names. Editable runs use one isolated Git worktree and integrate source changes after CLI success. Confirm the actual model from vendor records.',
    parameters: {
      task: { type: 'string', required: true, description: 'Full task to plan, distribute and execute.' },
      mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default read-only; workspace-write needs a clean Git repository and approval.' },
      executionEnvironment: { type: 'string', enum: ['harness', 'cli-native'], description: 'Default harness. cli-native requires workspace-write and separate approval: normal vendor tools run with current user permissions outside Harness sandbox; Git isolation only collects changes.' },
      budgetUsd: { type: 'number', description: 'Estimated planning ceiling only, not a vendor billing limit.' },
      cliModelsJson: { type: 'string', description: 'Optional JSON object mapping official tool IDs or work package IDs to exact model names configured in those CLIs. MiniMax/MiMo require provider/model; ZCode cannot switch per call.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const mode = args.mode === 'workspace-write' ? 'workspace-write' : 'read-only'
      if (mode === 'workspace-write' && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能请求可编辑团队执行')
      const planned = await planOfficialTeam(ctx, config, { ...args, mode }, { workspace: cwd, signal: exec.signal })
      return jsonValue(await executeOfficialTeamPlan(ctx, config, planned, {
        workspace: cwd, root, signal: exec.signal, confirmOverBudget: args.confirmOverBudget === true,
        confirmUnsandboxed: args.executionEnvironment === 'cli-native',
      }))
    },
  }))
}
