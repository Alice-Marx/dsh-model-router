import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { discoverConfiguredRoutes, name } from '../router-core.mjs'
import { accountingEstimates, initialFunding } from './execution-accounting.mjs'
import { beginExecutionLifecycle } from './execution-lifecycle.mjs'
import { billingOf, budgetCheck, buildRunRecord, plannedPackages, spending } from './run-ledger.mjs'
import { boundedInteger, configuredRoutesWithProfiles, finiteNumber, text, valueOf } from './router-core-utils.mjs'
import { consultConfiguredModel, planDataOptions, routingSavedState } from './router-planning.mjs'
import { createPlanFromRoutes } from './harness-plan.mjs'
import { createRouterState } from './router-state.mjs'
import { DEFAULT_COOLDOWN_MINUTES, billingOverview, createQuotaTracker, detectQuotaExhaustion, parseQuotaPatterns, vendorKey } from './subscription-billing.mjs'
import { DEFAULT_ROUTING_PRESET, normalizeRoutingPreset, routingPreset } from './routing-presets.mjs'
import { defaultRunner, installPreferences, probeAllTools } from './official-tools-runtime.mjs'
import { HEALTH_CACHE_MS, apiKeyEnvPresent, healthCache, runHealthCheck, subscriptionLoginOf } from './tool-health.mjs'
import { latestVersions } from './latest-versions.mjs'
import { OFFICIAL_TOOLS } from './official-tool-registry.mjs'
import { reservationSpending } from './budget-reservations.mjs'
import { taskTextProblem } from './task-executors.mjs'

// ---------------------------------------------------------------------------
// Router runtime state: health cache, run ledger, budget and ratings.

let routerState = null
let stateAuthorityInstalled = false

/** Trusted bootstrap migration only; never accepts a store from a wire request. */
export function installRouterStateStore(store) {
  if(stateAuthorityInstalled||store?.kind!=='sqlite-router-state'||!['read','update','saveQuota','saveHealth','appendRun','updateRun'].every(key=>typeof store[key]==='function'))throw new Error('ROUTER_STATE_AUTHORITY_ALREADY_SET_OR_INVALID')
  routerState=store;stateAuthorityInstalled=true
}

/** Persistent Host state (DSH home). Tests point DSH_HOME at a temp dir before the first call. */
export function routerStateStore() {
  routerState ??= createRouterState()
  return routerState
}

export async function savedState() {
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
export function recentNotices(saved, now = Date.now()) {
  return (saved?.notices ?? []).filter(item => Number.isFinite(item?.at) && now - item.at < NOTICE_DAYS * 86_400_000)
}

/**
 * Health and quota caches follow the shared state file: every call re-reads it
 * (the store caches by mtime/size/inode, so an unchanged file costs one stat)
 * and adopts marks and clears made by other processes without a restart.
 */
export async function hydrateHealth() {
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
export function pausedSteps(execution) {
  return (execution?.packages ?? []).filter(item => item?.paused).map(item => ({
    packageId: item.id, name: item.name, provider: item.provider, model: item.model,
    reason: item.pause?.reason ?? item.error ?? '', detail: item.pause?.detail ?? '', choices: item.pause?.choices ?? ['api', 'subscription', 'cancel'],
  }))
}

export const SUBSCRIPTION_PAUSE_NOTICE = '有步骤在订阅调用失败（非额度用尽或限流）后已暂停，下游步骤在等待，未自动改用 API Key。请把 awaitingConfirmation 中的原因和错误告诉用户，按用户选择调用 model_router_rerun_step，subscriptionChoice 为 api（改用 API 重试，会触发审批）、subscription（重试订阅）或 cancel（取消）。'

function cooldownMinutes(config) {
  return boundedInteger(valueOf(config, 'subscriptionCooldownMinutes', DEFAULT_COOLDOWN_MINUTES), DEFAULT_COOLDOWN_MINUTES, 1, 10_080)
}

/** Subscription-first billing context for the executor; `options.billing === false` disables it. */
export async function billingContext(config, options = {}) {
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
export async function noteCliQuota(config, toolId, textValue) {
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

export const fileExists = async path => {
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
export async function currentHealth() {
  await hydrateHealth()
  const report = healthCache.report()
  if (report && Date.now() - report.checkedAt < HEALTH_CACHE_MS) return report
  try { return await toolHealthReport() } catch { return report }
}

export function loggedOutIds(report) {
  return (report?.tools ?? []).filter(item => item.installed && healthCache.loginState(item.id)?.state === 'logged-out').map(item => item.id)
}

export function routingPresetOf(config, requested) {
  return normalizeRoutingPreset(text(requested) || valueOf(config, 'routingPreset', DEFAULT_ROUTING_PRESET))
}

export function budgetSettings(config) {
  return {
    dailyLimitUsd: Math.max(0, finiteNumber(valueOf(config, 'dailyBudgetUsd', 0), 0)),
    monthlyLimitUsd: Math.max(0, finiteNumber(valueOf(config, 'monthlyBudgetUsd', 0), 0)),
    action: valueOf(config, 'overBudgetAction', 'downgrade') === 'pause' ? 'pause' : 'downgrade',
  }
}

export function budgetFor(config, saved, estimateUsd, { checkEstimate = true, apiExposure = true } = {}) {
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

export function pausedExecutionBudget(lifecycle) {
  if (['history-incomplete', 'active-run', 'reservation-capacity'].includes(lifecycle.reason)) {
    throw new Error(lifecycle.reason === 'active-run' ? '该运行仍在执行或费用待核对，不能重复启动。'
      : lifecycle.reason === 'history-incomplete' ? '费用历史不完整，不能核验执行预算。' : '待核对运行过多，请先核对执行记录和费用。')
  }
  return { ...lifecycle.budget, paused: true, exceeded: lifecycle.budget?.exceeded ?? 'unknown' }
}

export function accountingContext(billing = null, routes = [], officialCli = false) {
  return { billing: billing ? { ...billing, routes } : null, officialCli,
    loginBillingFor: id => subscriptionLoginOf(healthCache.loginState(id)), apiKeyFor: id => apiKeyEnvPresent(id) }
}

export function packageEstimates(plan, task) {
  if (plan.accounting) return accountingEstimates(plan)
  return plannedPackages(plan, task).map(item => ({ id: item.id, estimatedCostUsd: item.estimatedCost ?? null }))
}

/** Activate API money accounting only at the actual API dispatch boundary. */
export async function reserveChangedApiRoute(lifecycle, expected, route, task, config, confirmOverBudget) {
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

export async function checkpointSubscription(lifecycle, event) {
  await lifecycle.partialResult({ ...event, billing: 'subscription', channel: event.channel ?? 'harness-llm',
    ok: false, answer: '', subscriptionAttempts: event.subscriptionAttempts ?? [event] })
}

/** A changed budget stops before dispatch; storage failures retain their hold. */
export async function stopExecutionLifecycle(lifecycle, error, run = lifecycle.current('interrupted')) {
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
  const fundingAdapter=typeof ctx.get==='function'?ctx.get('botFunding'):null
  if(fundingAdapter){const projected=await fundingAdapter.routeProfiles([route,...routes]);route=projected[0];routes=projected.slice(1)}
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
