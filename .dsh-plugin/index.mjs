import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_ROUTER_SETTINGS, modelMetadata } from './shared/router.mjs'
import { DEFAULT_ROUTING_PRESET, normalizeRoutingPreset, routingPreset } from './shared/routing-presets.mjs'
import { HEALTH_CACHE_MS, apiKeyEnvPresent, healthCache, runHealthCheck, subscriptionLoginOf } from './shared/tool-health.mjs'
import {
  DEFAULT_COOLDOWN_MINUTES, billingOverview, createQuotaTracker, detectQuotaExhaustion, parseQuotaPatterns, vendorKey,
} from './shared/subscription-billing.mjs'
import { createRouterState } from './shared/router-state.mjs'
import {
  applyQualityBiases, budgetCheck, buildRunRecord, formatUsd, buildTeamRunRecord, buildToolRunRecord, billingOf, mergeRerun,
  routeQualityBiases, spending, storedResults, actualCost, teamExecutionResults,
} from './shared/run-ledger.mjs'
import { routeBoundaries } from './shared/security-boundaries.mjs'
import { createPlanFromRoutes } from './shared/harness-plan.mjs'
import { applyModelProfiles, parseModelProfilesJson } from './shared/model-profiles.mjs'
import { registerOfficialToolsRemote } from './official-tools-remote-service.mjs'
import {
  getOfficialTool,
  installCommandLine,
  toolForProvider,
} from './shared/official-tool-registry.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness, runOfficialTool } from './shared/official-tool-executor.mjs'
import { runOfficialTask, runOfficialTeam, sessionWorkspace } from './shared/official-team-runtime.mjs'
import { downstreamPackageIds, executeAssignmentPlan, rerunAssignmentPackage, taskTextProblem } from './shared/task-executors.mjs'
import {
  probeAllTools,
  probeToolWith,
  startInstall,
  cancelInstall,
  installStatus,
  installedToolIds,
  defaultRunner,
} from './shared/official-tools-runtime.mjs'

export const name = 'model-router-galgame'
export const inject = ['commands', 'llm', 'tools', 'typert', 'sandboxPolicy', 'sandbox']

export const Config = z.object({
  budgetUsd: z.number().min(0).max(1_000_000).default(DEFAULT_ROUTER_SETTINGS.budgetUsd).volatile(),
  maxConsultOutputChars: z.number().step(1).min(500).max(50_000).default(12_000).volatile(),
  modelProfilesJson: z.string().max(32_000).default('[]').volatile(),
  routingPreset: z.union(['economy', 'balanced', 'quality']).default(DEFAULT_ROUTING_PRESET).volatile(),
  dailyBudgetUsd: z.number().min(0).max(1_000_000).default(0).volatile(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).default(0).volatile(),
  overBudgetAction: z.union(['downgrade', 'pause']).default('downgrade').volatile(),
  reviewMode: z.union(['off', 'sample', 'always']).default('off').volatile(),
  reviewSampleRate: z.number().min(0).max(1).default(0.2).volatile(),
  allowManualReassign: z.boolean().default(true).volatile(),
  confirmUnsandboxedCli: z.boolean().default(true).volatile(),
  subscriptionCooldownMinutes: z.number().step(1).min(1).max(10_080).default(DEFAULT_COOLDOWN_MINUTES).volatile(),
  quotaPatternsJson: z.string().max(8_000).default('{}').volatile(),
  onSubscriptionFailure: z.union(['ask', 'api', 'fail']).default('ask').volatile(),
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
  return [...routes.values()].sort((left, right) => routeKey(left).localeCompare(routeKey(right)))
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
  try { return await routerStateStore().read() }
  catch { return { onboarding: { completedAt: null }, health: null, runs: [] } }
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
export async function toolHealthReport({ fresh = false, runner = defaultRunner } = {}) {
  const probes = await probeAllTools({ fresh })
  const report = await runHealthCheck(probes, { runner, home: homedir(), exists: fileExists, readAuthState })
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

function budgetFor(config, runs, estimateUsd) {
  const settings = budgetSettings(config)
  const spent = spending(runs)
  return { ...budgetCheck({ estimateUsd, spent, ...settings }), spent, ...settings }
}

/**
 * API key / API path spend counts against budgets; an official CLI on its own
 * subscription login (no API key injected or inherited) is reference-only.
 */
export function billingForResult(result) {
  const toolId = result?.toolId ?? null
  return billingOf(result, {
    loginBilling: toolId ? healthCache.loginState(toolId)?.billing ?? null : null,
    apiKeyPresent: toolId ? apiKeyEnvPresent(toolId) : false,
  })
}

function routePricing(routes, item) {
  return routes.find(route => route.provider === item?.provider && route.model === item?.model)?.pricing ?? null
}

/** Routes with user profiles and the gentle quality bias learned from ratings and reviews. */
async function routesWithLearning(ctx, config, signal, runs) {
  const discovered = await discoverConfiguredRoutes(ctx, signal)
  return applyQualityBiases(configuredRoutesWithProfiles(discovered, config), routeQualityBiases(runs))
}

/** Produce a route recommendation and work packages compatible with official Agent Teams. */
export async function createRoutePlan(ctx, task, config = {}, options = {}) {
  const taskText = text(task)
  if (!taskText) throw new Error('任务内容为空，请先描述任务。')
  const mode = options.mode === 'team' ? 'team' : 'single'
  const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
  const budgetUsd = Math.max(0, finiteNumber(options.budgetUsd, finiteNumber(configuredBudget, 0)))
  const saved = await savedState()
  const [availableRoutes, installed] = await Promise.all([
    routesWithLearning(ctx, config, options.signal, saved.runs),
    options.skipToolProbe === true
      ? Promise.resolve(Array.isArray(options.installedToolIds) ? options.installedToolIds : [])
      : installedToolIds(),
  ])
  const readiness = options.skipToolProbe === true ? []
    : await Promise.all(installed.map(id => officialToolReadiness(id, options.workspace ?? process.cwd())))
  const executable = new Set(Array.isArray(options.runnableToolIds)
    ? options.runnableToolIds : readiness.filter(item => item.ready).map(item => item.id))
  const loggedOut = options.skipToolProbe === true
    ? (Array.isArray(options.loggedOutToolIds) ? options.loggedOutToolIds : [])
    : loggedOutIds(await currentHealth())
  const plan = createPlanFromRoutes(taskText, availableRoutes, {
    mode, budgetUsd, installedToolIds: installed,
    runnableToolIds: installed.filter(id => executable.has(id)),
    preset: routingPresetOf(config, options.preset),
    loggedOutToolIds: loggedOut,
  })
  return { ...plan, budgetStatus: budgetFor(config, saved.runs, plan.estimatedCost) }
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
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  let answer = ''
  let characterLimitReached = false
  let finish = { kind: 'unknown' }
  let usage = null
  try {
    const stream = ctx.llm.stream({
      provider,
      model,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `You are an independent specialist consulted by another AI agent. Give a concise, evidence-oriented answer in the task's language.\n\nTask:\n${taskText}`,
        }],
      }],
      maxTokens: Math.min(4_096, Math.max(256, Math.ceil(limit / 2))),
      signal: controller.signal,
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
        usage = {
          inputTokens: finiteNumber(chunk.usage.inputTokens, 0),
          outputTokens: finiteNumber(chunk.usage.outputTokens, 0),
          cacheReadTokens: finiteNumber(chunk.usage.cacheReadTokens, 0),
          cacheWriteTokens: finiteNumber(chunk.usage.cacheWriteTokens, 0),
        }
      } else if (chunk?.type === 'finish') {
        const reason = chunk.reason
        finish = { kind: text(reason?.kind) || 'unknown' }
        if (finish.kind === 'error' || finish.kind === 'aborted') {
          finish.error = text(reason?.failure?.message) || 'model request failed'
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  throwIfAborted(signal)
  const tokenLimitReached = finish.kind === 'max-tokens'
  const truncated = characterLimitReached || tokenLimitReached
  if (!characterLimitReached && (finish.kind === 'error' || finish.kind === 'aborted')) {
    return { ok: false, provider, model, answer, truncated, finish, error: finish.error }
  }
  if (!answer.trim()) {
    return { ok: false, provider, model, answer, truncated, finish, error: 'model returned no text' }
  }
  return {
    ok: true, provider, model, answer, truncated, finish,
    ...(usage ? { usage } : {}),
    ...(tokenLimitReached
      ? { truncationReason: 'model-token-limit', notice: '模型达到本次调用的输出 token 上限，回答可能不完整。' }
      : characterLimitReached
        ? { truncationReason: 'output-character-limit', notice: '回答达到字符上限，后续内容已截断。' }
        : {}),
  }
}

async function credentialsForRoute(ctx, route) {
  const provider = text(route?.provider)
  if (!provider) return null
  const readers = [ctx?.credentials?.getApiKey, ctx?.llm?.getProviderApiKey]
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
export async function reviewRunPackages(ctx, run, routes, config, { signal, random = Math.random } = {}) {
  const mode = valueOf(config, 'reviewMode', 'off')
  if (mode !== 'sample' && mode !== 'always') return []
  const rate = Math.min(1, Math.max(0, finiteNumber(valueOf(config, 'reviewSampleRate', 0.2), 0.2)))
  const reviewer = reviewerRoute(routes)
  if (!reviewer) return []
  const reviewerQuality = routeQuality(reviewer)
  const reviews = []
  for (const item of run.packages) {
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
      run.reviews.push(entry)
      reviews.push({ ...entry, score })
    } catch (error) {
      if (signal?.aborted) throw error
      item.review = { provider: reviewer.provider, model: reviewer.model, score: null, summary: `审阅失败：${errorText(error).slice(0, 200)}`, at: Date.now() }
    }
  }
  return reviews
}

function executionHooks(ctx, options) {
  return {
    skipOfficial: options.skipOfficial ?? (request => healthCache.skipReason(request)),
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
  if (direct && (!text(options.provider) || !text(options.model))) throw new Error('指定模型需要同时提供 provider 和 model。')
  const saved = await savedState()
  const routes = await routesWithLearning(ctx, config, options.signal, saved.runs)
  if (direct && !routes.some(route => route.provider === text(options.provider) && route.model === text(options.model))) {
    throw new Error(`模型 ${text(options.provider)}/${text(options.model)} 不在 Harness 模型目录中；请在模型页添加后重试，或改用自动路由。`)
  }
  const installed = options.skipToolProbe === true
    ? (Array.isArray(options.installedToolIds) ? options.installedToolIds : [])
    : await installedToolIds()
  const readiness = options.skipToolProbe === true ? []
    : await Promise.all(installed.map(id => officialToolReadiness(id, options.workspace ?? process.cwd())))
  const runnableToolIds = Array.isArray(options.runnableToolIds)
    ? options.runnableToolIds
    : readiness.filter(item => item.ready).map(item => item.id)
  const loggedOut = options.skipToolProbe === true
    ? (Array.isArray(options.loggedOutToolIds) ? options.loggedOutToolIds : [])
    : loggedOutIds(await currentHealth())
  const preset = routingPresetOf(config, options.preset)
  const planWith = (presetId, budgetUsd) => direct
    ? createPlanFromRoutes(taskText, routes, {
      mode: 'direct', directProvider: options.provider, directModel: options.model,
      installedToolIds: installed, runnableToolIds, preset: presetId, loggedOutToolIds: loggedOut,
    })
    : createPlanFromRoutes(taskText, routes, {
      mode: options.planMode === 'team' ? 'team' : 'single',
      budgetUsd, installedToolIds: installed, runnableToolIds, preset: presetId, loggedOutToolIds: loggedOut,
    })
  let plan = planWith(preset, options.budgetUsd)
  let budget = budgetFor(config, saved.runs, plan.estimatedCost)
  if (budget.exceeded && budget.action === 'downgrade' && !direct) {
    const cheaper = planWith('economy', budget.remainingUsd > 0 ? budget.remainingUsd : options.budgetUsd)
    const recheck = budgetFor(config, saved.runs, cheaper.estimatedCost)
    if (!recheck.exceeded) {
      budget = { ...recheck, downgraded: true, downgradedFrom: preset,
        message: `原方案${budget.message} 已自动降级为“省钱优先”方案（预估 ${cheaper.estimatedCost === null ? '价格待配置' : formatUsd(cheaper.estimatedCost)}）。` }
      plan = cheaper
    }
  }
  return { taskText, direct: Boolean(direct), plan, budget, routes, preset }
}

/** Route, or honor one explicit model, then run each package through its adapter. */
export async function executeConfiguredAssignment(ctx, task, config = {}, options = {}) {
  const { taskText, direct, plan, budget, routes, preset } = await planAssignment(ctx, task, config, options)
  if (budget.exceeded && options.confirmOverBudget !== true) {
    return {
      plan, execution: null, paused: true,
      budget: { ...budget, paused: true,
        message: `${budget.message} 已暂停执行：${direct ? '指定模型无法自动降级。' : budget.action === 'pause' ? '设置为超预算时暂停。' : '降级后仍超出预算。'}请向用户确认后，以 confirmOverBudget: true 重新调用。` },
    }
  }
  const finished = []
  const hooks = executionHooks(ctx, { ...options, onPackage: result => { finished.push(result) } })
  const billing = await billingContext(config, options)
  const limit = boundedInteger(valueOf(config, 'maxConsultOutputChars', 12_000), 12_000, 500, 50_000)
  const startedAt = Date.now()
  let execution
  try {
    execution = await executeAssignmentPlan({
      plan,
      task: taskText,
      routes: plan.availableRoutes,
      workspace: options.workspace,
      signal: options.signal,
      ...hooks,
      billing,
      apiFallback: async ({ route, task: packageTask, signal }) => consultConfiguredModel(ctx, route, packageTask, limit, signal),
    })
  } catch (error) {
    // Steps that already ran (and may have been paid for) are always recorded with their spend.
    const message = String(error?.message ?? error)
    const partial = { status: options.signal?.aborted ? 'cancelled' : 'failed', packages: finished, aggregate: '', error: message }
    const run = buildRunRecord({
      id: randomUUID(), createdAt: startedAt, finishedAt: Date.now(), task: taskText, plan, execution: partial,
      preset: plan.preset ?? preset, workspace: options.workspace ?? '',
      pricingFor: item => routePricing(routes, item), billingFor: billingForResult,
      budget: { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: budget.downgraded === true, confirmed: budget.exceeded ? true : undefined },
    })
    run.error = message.slice(0, 2_000)
    let stored = true
    try { await routerStateStore().appendRun(run) } catch { stored = false }
    const wrapped = new Error(`${message}${finished.length ? `（已完成 ${finished.length} 个步骤，${stored ? `已记录到运行 ${run.id}，费用计入预算` : '但运行记录保存失败'}）` : ''}`)
    wrapped.runId = stored ? run.id : null
    wrapped.cause = error
    throw wrapped
  }
  const run = buildRunRecord({
    id: randomUUID(), createdAt: startedAt, finishedAt: Date.now(), task: taskText, plan, execution,
    preset: plan.preset ?? preset, workspace: options.workspace ?? '',
    pricingFor: item => routePricing(routes, item),
    billingFor: billingForResult,
    budget: { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: budget.downgraded === true, confirmed: budget.exceeded ? true : undefined },
  })
  const reviews = await reviewRunPackages(ctx, run, routes, config, { signal: options.signal, random: options.random })
  let stored = true
  try { await routerStateStore().appendRun(run) } catch { stored = false }
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

export async function rerunRecordedStep(ctx, config = {}, { runId, packageId, provider, model, confirmOverBudget = false, confirmWrite = false, subscriptionChoice = null, workspace, root, signal, ...options } = {}) {
  const { run, saved } = await storedRun(runId)
  const target = run.packages.find(item => item.id === text(packageId))
  if (!target) throw new Error(`运行记录中没有工作包 ${text(packageId)}`)
  const choice = text(subscriptionChoice) || null
  if (choice && !['api', 'subscription', 'cancel'].includes(choice)) throw new Error('subscriptionChoice 只能是 api、subscription 或 cancel')
  if (choice && !target.paused) throw new Error('该步骤没有在等待订阅失败的确认；直接重跑即可。')
  if (choice === 'cancel') return { run: await cancelPausedStep(run.id, target.id), execution: null, budget: null, cancelled: true }
  const routes = await routesWithLearning(ctx, config, signal, saved.runs)
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
  if (support.writes && confirmWrite !== true) {
    return { paused: true, needsConfirmation: ['workspace-write'], run,
      budget: null, message: '续跑可编辑团队步骤会在新的独立 Git 工作树中套用之前的改动并修改文件，需要先确认。' }
  }
  const sameRoute = !override || (override.provider === target.recommendedProvider && override.model === target.recommendedModel)
  const budget = budgetFor(config, saved.runs, sameRoute ? target.estimatedCost : null)
  if (budget.exceeded && confirmOverBudget !== true) {
    return { paused: true, budget: { ...budget, paused: true, message: `${budget.message} 已暂停重跑，请确认后再试。` }, run }
  }
  const cwd = text(workspace) || run.workspace
  if (!cwd || !(await fileExists(cwd))) throw new Error(`原运行的工作区 ${cwd || '(未记录)'} 不可用，无法重跑该步骤；请恢复该目录，或在原工作区的会话中调用 model_router_rerun_step。`)
  if (run.kind === 'team') return rerunTeamStep(ctx, { run, target, override, routes, budget, cwd, root: text(root) || cwd, signal, options, config })
  const limit = boundedInteger(valueOf(config, 'maxConsultOutputChars', 12_000), 12_000, 500, 50_000)
  const execution = await rerunAssignmentPackage({
    task: run.task,
    packages: run.packages.map(item => ({
      id: item.id, name: item.name, objective: item.objective, dependsOn: item.dependsOn,
      recommendedProvider: item.provider ?? item.recommendedProvider, recommendedModel: item.model ?? item.recommendedModel,
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
    billing: await billingContext(config, options),
    apiFallback: async ({ route, task: packageTask, signal: callSignal }) => consultConfiguredModel(ctx, route, packageTask, limit, callSignal),
  })
  const updated = await routerStateStore().updateRun(run.id, current => {
    mergeRerun(current, execution, { rerunIds: execution.ranIds, pricingFor: item => routePricing(routes, item), billingFor: billingForResult })
  })
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
function teamPlanFromRun(run, ids, override, targetId) {
  const workPackages = run.packages.filter(item => ids.includes(item.id)).map(item => ({
    id: item.id, name: item.name, objective: item.objective, dependsOn: item.dependsOn ?? [],
    type: item.type ?? 'general', purpose: item.purpose ?? 'execution',
    verificationChecklist: item.verificationChecklist ?? [],
    recommendedProvider: item.id === targetId && override ? override.provider : item.recommendedProvider,
    recommendedModel: item.id === targetId && override ? override.model : item.recommendedModel,
    estimatedCost: item.estimatedCost ?? null,
  }))
  return { mode: 'team', team: { workPackages } }
}

/**
 * Read-only team retry: the failed step plus downstream steps that had not
 * succeeded run through the same signed runner; earlier answers are context.
 */
async function rerunTeamStep(ctx, { run, target, override, routes, budget, cwd, root, signal, options, config = {} }) {
  const mode = run.executionMode === 'workspace-write' ? 'workspace-write' : 'read-only'
  const downstream = downstreamPackageIds(run.packages, target.id)
    .filter(id => !run.packages.find(item => item.id === id)?.ok)
  const ids = [target.id, ...downstream]
  const plan = teamPlanFromRun(run, ids, override, target.id)
  const cliModels = Object.fromEntries(Object.entries(run.cliModels ?? {}).filter(([key]) => ids.includes(key) && !(override && key === target.id)))
  const previous = run.packages.filter(item => item.ok && !ids.includes(item.id))
    .map(item => ({ id: item.id, name: item.name, finalText: item.answer }))
  const runTeam = options.runTeam ?? runOfficialTeam
  const installed = Array.isArray(options.installedToolIds) ? options.installedToolIds : await installedToolIds()
  const execution = await runTeam({ plan, task: run.task, workspace: cwd, allowedRoot: root ?? cwd, mode,
    installedIds: installed, cliModels, signal, sandbox: ctx.sandbox, previous, onlyIds: ids,
    ...(mode === 'workspace-write' ? { seedFrom: { workspace: run.isolatedWorkspace, baseCommit: run.baseCommit } } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {}) })
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
  const updated = await routerStateStore().updateRun(run.id, current => {
    mergeRerun(current, converted, { rerunIds: ids, pricingFor: item => routePricing(routes, item), billingFor: billingForResult })
    for (const [id, note] of quotaNotes) {
      const stored = current.packages.find(item => item.id === id)
      if (stored) stored.billingSwitch = note
    }
    current.status = execution?.status ?? current.status
    if (mode === 'workspace-write' && execution?.workspace && execution.status !== 'blocked') {
      current.isolatedWorkspace = String(execution.workspace)
      if (typeof execution.baseCommit === 'string') current.baseCommit = execution.baseCommit
      if (execution.integration) current.integration = { ignoredArtifacts: execution.integration.ignoredArtifacts ?? 0 }
    }
    if (override) {
      const stored = current.packages.find(item => item.id === target.id)
      if (stored) { stored.recommendedProvider = override.provider; stored.recommendedModel = override.model }
    }
  })
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

export async function recordTeamRun({ task, plan, execution, mode, workspace, routes, cliModels, budget, startedAt, preset, config = {} }) {
  const run = buildTeamRunRecord({
    id: randomUUID(), createdAt: startedAt, finishedAt: Date.now(), task, plan, execution, mode, workspace,
    preset: plan?.preset ?? preset ?? DEFAULT_ROUTING_PRESET,
    pricingFor: item => routePricing(routes, item), billingFor: billingForResult,
    budget: budget ? { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: false, confirmed: budget.exceeded ? true : undefined } : null,
  })
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
    routes = configuredRoutesWithProfiles(await discoverConfiguredRoutes(ctx, signal), config)
    route = routes.find(item => item.provider === text(args.provider) && item.model === text(args.model)) ?? null
    if (!route) throw new Error('所选 provider/model 不在官方模型目录中')
    modelId = route.cliModel && toolId !== 'zcode'
      ? route.cliModel
      : toolId === 'claude-code' || toolId === 'codex' ? route.model : null
  }
  if (text(args.cliModel)) {
    if (!route) throw new Error('cliModel 需要同时提供已配置的 provider 和 model 路线')
    if (toolId === 'zcode') throw new Error('ZCode 3.14.3 不支持在单次调用中指定 CLI 模型')
    modelId = text(args.cliModel)
  }
  const estimate = route ? createPlanFromRoutes(taskText, routes, { mode: 'direct', directProvider: route.provider, directModel: route.model }).estimatedCost : null
  const budget = budgetFor(config, (await savedState()).runs, Number.isFinite(estimate) ? estimate : null)
  return { toolId, tool, taskText, mode, modelId, route, routes, estimate: Number.isFinite(estimate) ? estimate : null, budget,
    provider: route?.provider ?? '', model: route?.model ?? '', cliModel: text(args.cliModel) || null }
}

/** Run a planned tool call and record it; `rerunOf` links a rerun to the original run. */
async function runPlannedTool(ctx, config, planned, { cwd, root, signal, rerunOf = null, runTask = runOfficialTask }) {
  const startedAt = Date.now()
  const result = await runTask({ toolId: planned.toolId, task: planned.taskText, modelId: planned.modelId, workspace: cwd, allowedRoot: root ?? cwd,
    mode: planned.mode, signal, sandbox: ctx.sandbox })
  const recorded = result.status === 'unsupported' ? null : await recordToolRun({
    toolId: planned.toolId, task: planned.taskText, provider: planned.provider, model: planned.model, cliModel: planned.cliModel,
    mode: planned.mode, workspace: cwd, result, startedAt, routes: planned.routes, config,
    estimatedCost: planned.estimate, budget: planned.budget, rerunOf,
  })
  return { result, recorded }
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
export async function rateRecordedResult({ runId, packageId, rating } = {}) {
  const value = rating === 'up' || rating === 1 ? 1 : rating === 'down' || rating === -1 ? -1 : rating === 'clear' || rating === 0 ? null : undefined
  if (value === undefined) throw new Error('rating 只能是 up、down 或 clear')
  return routerStateStore().updateRun(text(runId), current => {
    const item = current.packages.find(entry => entry.id === text(packageId))
    if (!item) throw new Error(`运行记录中没有工作包 ${text(packageId)}`)
    item.rating = value
  })
}

/** Everything the workbench shows: recent runs, spending, budget, learned biases and settings. */
export async function ledgerSummary(config = {}, { limit = 30 } = {}) {
  const saved = await savedState()
  const spent = spending(saved.runs)
  const settings = budgetSettings(config)
  return {
    runs: saved.runs.slice(-limit).reverse().map(run => ({
      ...run,
      task: run.task.slice(0, 2_000),
      packages: run.packages.map(item => ({ ...item, answer: item.answer.slice(0, 1_500) })),
    })),
    spent,
    budget: { ...settings, ...budgetCheck({ estimateUsd: null, spent, ...settings }) },
    biases: routeQualityBiases(saved.runs),
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
    estimatedCost: plan?.estimatedCost ?? null,
    packages: packages.map(item => ({
      id: item.id, name: item.name, route: `${item.recommendedProvider}/${item.recommendedModel}`,
      difficulty: item.difficulty ?? null, estimatedCost: item.estimatedCost ?? null,
      channel: item.executionChannel ?? null, channelDetail: item.channelDetail ?? '',
      dependsOn: item.dependsOn ?? [],
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
  const runKinds = ['model_router_execute', 'model_router_rerun_step', 'model_router_team_execute', 'model_router_tool_run']
  if (!runKinds.includes(name)) return codes
  if ((name === 'model_router_tool_run' || name === 'model_router_team_execute') && args.mode === 'workspace-write') codes.push('workspace-write')
  if (name === 'model_router_rerun_step' && rerunRun && rerunSupport(rerunRun).writes) codes.push(rerunRun.kind === 'tool' ? 'workspace-write' : 'rerun-write')
  if (name === 'model_router_rerun_step' && args.subscriptionChoice === 'api') codes.push('subscription-api')
  if (args.confirmOverBudget === true) codes.push('over-budget')
  const directRun = name === 'model_router_execute' || (name === 'model_router_rerun_step' && (!rerunRun || rerunSupport(rerunRun).kind === 'assign'))
  if (directRun && valueOf(config, 'confirmUnsandboxedCli', true) !== false && mayLaunchDirectCli(args)) codes.push('unsandboxed')
  return codes
}

function approvalReasons(name, args, config, { sandboxAvailable = false, rerunRun = null } = {}) {
  return approvalReasonCodes(name, args, config, { rerunRun }).map(code => ({ code, ...APPROVAL_TEXT[code](sandboxAvailable) }))
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
export function confirmationReasons(codes, { sandboxAvailable = false } = {}) {
  return codes.map(code => ({ code, zh: APPROVAL_TEXT[code](sandboxAvailable).zh, en: APPROVAL_TEXT[code](sandboxAvailable).en }))
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

/** Plan preview for the workbench: decision, estimate, budget and what needs confirming. */
export async function previewWorkbenchRun(ctx, config, request = {}, options = {}) {
  const saved = await savedState()
  const workspace = await workbenchWorkspace(request.workspace, saved.runs)
  const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
  const planned = await planAssignment(ctx, request.task, config, {
    provider: request.provider, model: request.model, planMode: request.planMode, preset: request.preset,
    budgetUsd: finiteNumber(request.budgetUsd, finiteNumber(configuredBudget, 0)), workspace, signal: options.signal, ...options.planOptions,
  })
  await hydrateHealth()
  const codes = approvalReasonCodes('model_router_execute', { provider: request.provider, confirmOverBudget: Boolean(planned.budget.exceeded) }, config)
  return {
    workspace,
    decision: decisionSummary(planned.plan),
    selected: planned.plan.selected ?? null,
    routingBypassed: planned.plan.routingBypassed === true,
    estimatedCost: planned.plan.estimatedCost ?? null,
    budget: planned.budget,
    reasons: confirmationReasons(codes, { sandboxAvailable: typeof ctx.sandbox?.confine === 'function' }),
    readOnly: true,
  }
}

/** Execute from the workbench; refuses until every current reason is in confirmedReasons. */
export async function startWorkbenchRun(ctx, config, request = {}, options = {}) {
  const preview = await previewWorkbenchRun(ctx, config, request, options)
  const confirmed = new Set(Array.isArray(request.confirmedReasons) ? request.confirmedReasons : [])
  const missing = preview.reasons.filter(item => !confirmed.has(item.code))
  if (missing.length) return { status: 'needs-confirmation', ...preview, reasons: preview.reasons, missing: missing.map(item => item.code) }
  const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
  const result = await (options.execute ?? executeConfiguredAssignment)(ctx, request.task, config, {
    provider: request.provider, model: request.model, planMode: request.planMode, preset: request.preset,
    budgetUsd: finiteNumber(request.budgetUsd, finiteNumber(configuredBudget, 0)),
    confirmOverBudget: confirmed.has('over-budget'), workspace: preview.workspace, signal: options.signal, ...options.planOptions,
  })
  const awaiting = result.awaitingConfirmation ?? []
  return {
    status: result.paused ? 'paused-budget' : awaiting.length ? 'paused-subscription-failure' : result.execution?.status ?? 'unknown',
    runId: result.runId ?? null, workspace: preview.workspace, budget: result.budget, decision: decisionSummary(result.plan),
    ...(awaiting.length ? { awaitingConfirmation: awaiting } : {}),
  }
}

/** Host operations behind the workbench RPC; the client never supplies commands or paths. */
export function routerRemoteServices(ctx, config) {
  return {
    health: async fresh => {
      const report = await toolHealthReport({ fresh: fresh === true })
      const saved = await savedState()
      return { ...report, onboarding: saved.onboarding, notices: recentNotices(saved), billing: await billingHealth(ctx, config) }
    },
    completeOnboarding: async () => routerStateStore().completeOnboarding(Date.now()),
    ledger: () => ledgerSummary(config),
    rate: request => rateRecordedResult(request),
    rerun: request => rerunRecordedStep(ctx, config, {
      runId: request?.runId, packageId: request?.packageId, provider: request?.provider, model: request?.model,
      confirmOverBudget: request?.confirmOverBudget === true, confirmWrite: request?.confirmWrite === true,
      ...(request?.subscriptionChoice ? { subscriptionChoice: request.subscriptionChoice } : {}),
    }),
    boundaries: () => securityBoundaries(ctx, config),
    previewRun: request => previewWorkbenchRun(ctx, config, request),
    startRun: request => startWorkbenchRun(ctx, config, request),
  }
}

/** Register model-facing tools and the human /router command. */
export function apply(ctx, config = {}) {
  // The official Host injects typert; direct lightweight uses of apply may
  // supply only the model/command services and do not expose the Desktop RPC.
  if (ctx.typert) registerOfficialToolsRemote(ctx, routerRemoteServices(ctx, config))
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name === 'model_router_tool_install') {
      const requested = getOfficialTool(text(exec.arguments?.tool))
      const label = requested?.label ?? '官方 CLI'
      const desktopInstaller = requested?.manager === 'signed-windows-installer'
      return {
        kind: 'ask',
        reason: desktopInstaller
          ? `Download and open the verified official ${label} desktop installer`
          : `Install ${label} globally with the plugin's fixed official command`,
        displayReason: {
          en: desktopInstaller
            ? `Download and open the verified ${label} installer? You can select the installation directory in its window.`
            : `Install ${label} globally using the fixed official package?`,
          zh: desktopInstaller
            ? `下载并打开已验签的 ${label} 安装器？安装窗口中可选择非 C 盘目录。`
            : `使用插件固定的官方软件包，在本机全局安装 ${label}？`,
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
  registerOfficialToolModels(ctx, config)
  ctx.tools.register(defineTool({
    name: 'model_router_routes',
    description: 'List provider/model routes registered in the official DeepSeek Harness model directory. Credential and network availability are not verified. No API keys or endpoints are returned.',
    parameters: {},
    output: JSON_OUTPUT,
    async execute(_args, exec) {
      const routes = await discoverConfiguredRoutes(ctx, exec.signal)
      return jsonValue({ routes, count: routes.length, availabilityNotice: '目录记录不证明账号凭据和网络当前可用。' })
    },
  }))
  ctx.tools.register(defineTool({
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
  ctx.tools.register(defineTool({
    name: 'model_router_consult',
    description: 'Ask one already configured Harness model for an independent opinion. Supply both provider and model for an explicit route, or omit both for a recommended route different from the current model when available.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task or question for the consulted model.' },
      provider: { type: 'string', description: 'Configured provider id; pair with model.' },
      model: { type: 'string', description: 'Configured model id; pair with provider.' },
      outputLimit: { type: 'number', description: 'Maximum returned characters, from 500 to 50000.' },
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
      return jsonValue(await consultConfiguredModel(ctx, route, args.task, limit, exec.signal))
    },
  }))
  ctx.commands.register({
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
  ctx.commands.register({
    name: 'tools',
    description: 'Show official model CLI install status, or install one registry tool.',
    input: { hint: '留空查看状态；或输入 install/cancel <工具id>' },
    async handler({ rawInput, signal }) {
      const input = text(rawInput)
      const installMatch = input.match(/^install\s+([A-Za-z0-9_-]+)$/i)
      const cancelMatch = input.match(/^cancel\s+([A-Za-z0-9_-]+)$/i)
      if (cancelMatch) {
        try { return { kind: 'success', text: `已请求取消 ${cancelInstall(cancelMatch[1]).tool} 的安装；请使用 /tools 查看最新状态。` } }
        catch (error) { return { kind: 'error', text: `无法取消安装：${errorText(error)}` } }
      }
      if (!installMatch) {
        if (input) return { kind: 'error', text: '用法：/tools 查看状态，或 /tools install/cancel <工具id>' }
        try {
          const probes = await probeAllTools({ fresh: true })
          const lines = probes.map(probe => {
            const tool = getOfficialTool(probe.id)
            const command = installCommandLine(tool)
            const status = probe.status === 'installed'
              ? `已安装 ${probe.version ?? ''}`
              : probe.status === 'unsupported'
                ? '不支持一键安装'
                : '未安装'
            return `• ${tool.label}（${probe.id}）：${status}${command && probe.status === 'not-installed' ? `\n  安装：/tools install ${probe.id}（即 ${command}）` : ''}`
          })
          return { kind: 'success', text: `官方工具状态：\n${lines.join('\n')}` }
        } catch (error) {
          return { kind: 'error', text: `探测失败：${errorText(error)}` }
        }
      }
      try {
        const job = startInstall(installMatch[1])
        const tool = getOfficialTool(installMatch[1])
        const settled = await waitForInstall(job.tool, signal)
        if (settled.status === 'succeeded') {
          const probe = await probeToolWith(tool, defaultRunner)
          return { kind: 'success', text: `${tool.label} 安装完成${probe.version ? `，探测版本 ${probe.version}` : ''}。` }
        }
        if (settled.status === 'installer-opened') {
          return { kind: 'success', text: `${tool.label} 官方安装器已验证并打开。请在安装窗口选择非 C 盘目录并完成安装，然后运行 /tools 重新检测；当前尚未确认安装完成。` }
        }
        return { kind: 'error', text: `${tool.label} 安装失败：${settled.error ?? '未知原因'}\n${settled.outputTail.slice(-6).join('\n')}` }
      } catch (error) {
        return { kind: 'error', text: `无法开始安装：${errorText(error)}` }
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
function registerOfficialToolModels(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'model_router_tools',
    description: 'Probe the fixed registry of official model tools (Kimi Code, Claude Code, Codex, MiniMax Code, MiMo Code, Grok Build, ZCode, Gemini CLI) and report which are installed with their versions. Never reads credentials.',
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
        installHint: '未安装的工具可由 model_router_tool_install 按注册表固定命令安装；版本与包名不接受自定义。',
      })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_tool_install',
    description: 'Install one official model tool by registry id using its pinned official source. ZCode opens a verified interactive desktop installer with a directory picker. Only registry ids are accepted; arbitrary packages or executables are refused.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Registry tool id, e.g. kimi-code.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const job = startInstall(args.tool)
      const settled = await waitForInstall(job.tool, exec.signal)
      const tool = getOfficialTool(args.tool)
      const probe = settled.status === 'succeeded'
        ? await probeToolWith(tool, defaultRunner)
        : null
      return jsonValue({
        ...settled,
        postInstallProbe: probe,
        notice: settled.status === 'installer-opened'
          ? '已打开 ZCode 官方安装窗口，请选择安装目录并完成安装，之后重新检测；此状态不代表安装完成。'
          : '安装命令完全来自服务端注册表；实际版本以探测横幅为准。',
      })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_tool_run',
    description: 'Run one supported official model CLI in the current Harness session workspace. Claude, Codex, MiMo and Grok support read-only; Kimi, MiniMax and ZCode require workspace-write. Write mode needs approval and a clean Git repository. Optional provider/model must match a configured Harness route and selected vendor; cliModel can specify that vendor CLI’s own configured model name. Without cliModel, Kimi, MiniMax, MiMo, Grok and ZCode use the CLI default.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Fixed registry tool id, e.g. claude-code or codex.' },
      task: { type: 'string', required: true, description: 'Concrete task for the official CLI model.' },
      provider: { type: 'string', description: 'Optional configured provider, paired with model.' },
      model: { type: 'string', description: 'Optional model ID from the Harness directory, paired with provider. This ID is advisory for CLIs except Claude/Codex.' },
      cliModel: { type: 'string', description: 'Optional model name already configured in this vendor CLI; requires provider and model. MiniMax/MiMo require provider/model format. ZCode 3.14.3 cannot switch models per call.' },
      mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default is read-only. Kimi, MiniMax and ZCode require workspace-write. Write mode requires official approval and a clean Git repository.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const planned = await planToolRun(ctx, config, args, { signal: exec.signal })
      if (planned.mode === 'workspace-write' && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能请求可编辑 CLI 执行')
      if (planned.budget.exceeded && args.confirmOverBudget !== true) {
        return jsonValue({ status: 'paused-budget', budget: { ...planned.budget, paused: true }, estimateUsd: planned.estimate,
          notice: `${planned.budget.message} 已暂停，未启动 ${planned.tool.label}。请向用户说明后，以 confirmOverBudget: true 重新调用。` })
      }
      const { result, recorded } = await runPlannedTool(ctx, config, planned, { cwd, root, signal: exec.signal })
      return jsonValue({ ...result, runId: recorded?.id ?? null, estimateUsd: planned.estimate, budget: planned.budget,
        ...(!planned.modelId && planned.model ? { modelNotice: result.modelNotice
          ?? 'Harness 模型 ID 未经此厂商 CLI 验证；本次使用厂商 CLI 已配置的默认模型。' } : {}),
        ...(planned.estimate === null ? { costNotice: '未指定带单价的 provider/model 路线，无法预估费用；仅在预算已用尽时暂停。' } : {}),
      })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_execute',
    description: 'Run a task on configured models and aggregate the results. Omit provider and model to route first. Supply both to use that one model and skip routing. auto/official profiles try the vendor headless CLI (claude -p, codex exec, gemini -p) and fall back to the Harness model API when the CLI is missing or fails. api profiles always use the model API. This call is read-only and does not apply file edits.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task to execute.' },
      provider: { type: 'string', description: 'Configured provider. Pair with model to bypass routing.' },
      model: { type: 'string', description: 'Configured model. Pair with provider to bypass routing.' },
      planMode: { type: 'string', enum: ['single', 'team'], description: 'Used only when provider and model are omitted.' },
      budgetUsd: { type: 'number', description: 'Optional local estimate ceiling when routing. Not a vendor billing cap.' },
      preset: { type: 'string', enum: ['economy', 'balanced', 'quality'], description: 'Optional routing preset for this call; defaults to the saved setting.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd } = await sessionWorkspace(ctx, exec)
      const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
      const result = await executeConfiguredAssignment(ctx, args.task, config, {
        provider: args.provider,
        model: args.model,
        planMode: args.planMode,
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
          : '官方 CLI 以只读无界面方式运行。可编辑改动仍使用 model_router_tool_run 或 model_router_team_execute。未安装、未登录、失败或配置为 api 的模型走模型目录 API；回退原因与 CLI 原始错误见 fallback。可用 model_router_rerun_step 重跑失败步骤，model_router_rate 记录评价。',
      })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_health',
    description: 'Onboarding health check: for each official CLI in the fixed registry, report installed, version vs pinned version, and login state (cheap status commands only; never starts a login), plus a per-provider billing table: billing mode (subscription-first by default), subscription state (logged in / coding-plan key route / exhausted until a time) and whether an API-key route is available for fallback. Logged-out tools are skipped by routing until re-checked.',
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
  ctx.tools.register(defineTool({
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
        confirmOverBudget: args.confirmOverBudget === true, confirmWrite: true, workspace: cwd, root, signal: exec.signal,
        ...(text(args.subscriptionChoice) ? { subscriptionChoice: text(args.subscriptionChoice) } : {}),
      })
      return jsonValue({
        ...(result.paused ? { status: 'paused-budget' } : result.cancelled ? { status: 'cancelled' } : result.awaitingConfirmation ? { status: 'paused-subscription-failure', awaitingConfirmation: result.awaitingConfirmation, notice: SUBSCRIPTION_PAUSE_NOTICE } : {}),
        budget: result.budget, execution: result.execution ?? null, runId: result.run?.id ?? args.runId,
        ...(result.rerunOf ? { rerunOf: result.rerunOf, newRunId: result.newRunId } : {}),
      })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_rate',
    description: 'Record the user\'s rating of one recorded result (up = useful, down = not useful, clear). Ratings gently adjust future routing for that exact provider/model.',
    parameters: {
      runId: { type: 'string', required: true, description: 'runId returned by model_router_execute.' },
      packageId: { type: 'string', required: true, description: 'Work package id.' },
      rating: { type: 'string', required: true, enum: ['up', 'down', 'clear'], description: 'The user\'s rating.' },
    },
    output: JSON_OUTPUT,
    async execute(args) {
      const run = await rateRecordedResult(args)
      return jsonValue({ ok: true, runId: run.id, packageId: args.packageId, rating: args.rating })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_team_execute',
    description: 'Plan a complex task into dependent work packages, route among configured providers with ready official CLIs, and run each package sequentially. Claude/Codex request the planned model ID; other CLIs use their configured default unless cliModelsJson supplies exact CLI names. Editable runs use one isolated Git worktree and integrate source changes after CLI success. Confirm the actual model from vendor records.',
    parameters: {
      task: { type: 'string', required: true, description: 'Full task to plan, distribute and execute.' },
      mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default read-only; workspace-write needs a clean Git repository and approval.' },
      budgetUsd: { type: 'number', description: 'Estimated planning ceiling only, not a vendor billing limit.' },
      cliModelsJson: { type: 'string', description: 'Optional JSON object mapping official tool IDs or work package IDs to exact model names configured in those CLIs. MiniMax/MiMo require provider/model; ZCode 3.14.3 cannot switch per call.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const mode = args.mode === 'workspace-write' ? 'workspace-write' : 'read-only'
      if (mode === 'workspace-write' && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能请求可编辑团队执行')
      const [discoveredRoutes, installed] = await Promise.all([discoverConfiguredRoutes(ctx, exec.signal), installedToolIds()])
      const routes = configuredRoutesWithProfiles(discoveredRoutes, config)
      const readiness = await Promise.all(installed.map(id => officialToolReadiness(id, cwd)))
      const supported = new Set(readiness.filter(item => item.ready).map(item => item.id))
      const capabilities = new Map(officialToolExecutionCapabilities().map(item => [item.id, item]))
      const executableRoutes = routes.filter(route => {
        const tool = toolForProvider(route.provider)
        return tool && installed.includes(tool.id) && supported.has(tool.id)
          && capabilities.get(tool.id)?.modes?.includes(mode)
      })
      if (executableRoutes.length === 0) return jsonValue({ status: 'blocked',
        reason: `官方模型目录中没有同时满足已配置路线、已安装 CLI、托管执行适配器与 ${mode} 模式的供应商；Kimi、MiniMax、ZCode 仅支持经审批的 workspace-write。`,
        installed, executionCapabilities: officialToolExecutionCapabilities(), executionReadiness: readiness })
      const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
      const budgetUsd = Math.max(0, finiteNumber(args.budgetUsd, finiteNumber(configuredBudget, 0)))
      const plan = createPlanFromRoutes(args.task, executableRoutes, {
        mode: 'team', budgetUsd, installedToolIds: installed,
        runnableToolIds: installed.filter(id => supported.has(id)),
        preset: routingPresetOf(config),
      })
      const budget = budgetFor(config, (await savedState()).runs, plan.estimatedCost)
      if (budget.exceeded && args.confirmOverBudget !== true) {
        return jsonValue({ status: 'paused-budget', budget, plan,
          notice: `${budget.message} 已暂停团队执行。请向用户确认后以 confirmOverBudget: true 重新调用。` })
      }
      const bindingsText = text(args.cliModelsJson)
      if (bindingsText.length > 4_000) throw new Error('cliModelsJson 超过 4000 字符上限')
      let cliModels = null
      if (bindingsText) {
        try { cliModels = JSON.parse(bindingsText) }
        catch { throw new Error('cliModelsJson 不是有效的 JSON 对象') }
      }
      cliModels = resolveTeamCliModelBindings(plan, executableRoutes, cliModels ?? {})
      const startedAt = Date.now()
      const execution = await runOfficialTeam({ plan, task: args.task, workspace: cwd,
        allowedRoot: root, mode, installedIds: installed, cliModels, signal: exec.signal, sandbox: ctx.sandbox })
      const recorded = await recordTeamRun({ task: args.task, plan, execution, mode, workspace: cwd,
        routes: executableRoutes, cliModels, budget, startedAt, config })
      return jsonValue({ plan, execution, runId: recorded?.id ?? null,
        rerunNotice: mode === 'read-only'
          ? '失败的工作包可用 model_router_rerun_step 单步重跑（只重跑该步及其未完成的下游）。'
          : '若在某个步骤失败而停止，可用 model_router_rerun_step 在新的独立工作树中套用之前的改动后续跑（需审批）；已整合或待人工整合的运行不能单步重跑。',
        modelNotice: '已配置 cliModel 的路线按工作包传给官方 CLI；Claude/Codex 在未配置映射时请求 Harness 模型 ID。其他厂商无映射时使用 CLI 默认模型。多数 CLI 尚不返回可核验的实际模型 ID，须以厂商运行记录核对。',
        billingNotice: 'budgetUsd 仅影响估算与路由，无法限制官方 CLI 账号实际费用。' })
    },
  }))
}
