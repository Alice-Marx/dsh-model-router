import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Config, discoverConfiguredRoutes, inject, name } from '../router-core.mjs'
import { accountingContext, billingContext, billingForResult, budgetFor, budgetSettings, checkpointSubscription, currentHealth, loggedOutIds, packageEstimates, pausedExecutionBudget, pausedSteps, reserveChangedApiRoute, routePricing, routerStateStore, routingPresetOf, savedState, stopExecutionLifecycle } from './router-state-billing.mjs'
import { actualCost, buildRunRecord, formatUsd, hasStartedQualityAttempts, plannedPackages, spending } from './run-ledger.mjs'
import { apiReasoningRequest } from './reasoning-execution.mjs'
import { applyFeedbackProfile, buildFeedbackProfile } from './adaptive-feedback.mjs'
import { applyManualPackagePlan } from './manual-plan.mjs'
import { applyPricingSnapshot, createDynamicDataRefresher, routingData } from './dynamic-data.mjs'
import { attachPlanAccounting, planningFundingPrices } from './execution-accounting.mjs'
import { beginExecutionLifecycle } from './execution-lifecycle.mjs'
import { billingPlan } from './subscription-billing.mjs'
import { boundedInteger, configuredRoutesWithProfiles, errorText, finiteNumber, routeKey, text, throwIfAborted, valueOf } from './router-core-utils.mjs'
import { buildRoutingEvidence, parseRoutingEvidenceJson } from './routing-evidence.mjs'
import { channelForProvider, createPlanFromRoutes } from './harness-plan.mjs'
import { DEFAULT_OFFICIAL_MODEL, authorizeOfficialRequest } from './bot-official-execution.mjs'
import { DEFAULT_ROUTER_SETTINGS, modelMetadata } from './router.mjs'
import { executeAssignmentPlan, taskTextProblem } from './task-executors.mjs'
import { healthCache } from './tool-health.mjs'
import { installedToolIds } from './official-tools-runtime.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness, runOfficialTool } from './official-tool-executor.mjs'
import { packagePlanKey, parsePackageAssignments } from './package-assignments.mjs'
import { parseQualityGateJson, runQualityCascade } from './quality-gates.mjs'
import { projectDynamicData } from './dynamic-data-view.mjs'
import { toolForProvider } from './official-tool-registry.mjs'
import { WORKBENCH_RUN_ID } from './router-workbench.mjs'

function feedbackOptions(config) {
  return {
    enabled: valueOf(config, 'feedbackLearningEnabled', true) !== false,
    halfLifeDays: valueOf(config, 'feedbackHalfLifeDays', 30),
    priorWeight: valueOf(config, 'feedbackPriorWeight', 3),
    maxAdjustment: valueOf(config, 'feedbackMaxAdjustment', 0.04),
    resetAt: valueOf(config, 'feedbackResetAt', 0),
  }
}

export function dynamicOptions(config) {
  return {
    enabled: valueOf(config, 'dynamicDataEnabled', false) === true,
    liveBenchEndpoint: valueOf(config, 'liveBenchEndpoint', 'https://livebench.ai'),
    pricingSnapshotEndpoint: valueOf(config, 'pricingSnapshotEndpoint', ''),
    ttlMs: boundedInteger(valueOf(config, 'dynamicDataTtlMinutes', 1440), 1440, 1, 10_080) * 60_000,
  }
}

let dynamicRefresher = null
export async function routingSavedState(config) {
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

export function planDataOptions(saved, config) {
  return {
    ...routingData(saved.dynamicData, dynamicOptions(config).enabled),
    learning: saved.routingLearning ?? buildFeedbackProfile(saved.runs, feedbackOptions(config)),
    routingEvidence: saved.routingEvidence ?? buildRoutingEvidence(),
  }
}

/** Manual exact-route profiles take precedence over public price snapshots.
 * Only explicit subjective feedback affects utility; reviews stay separate. */
export async function routesWithLearning(ctx, config, signal, runs, dynamicData = null, feedbackProfile = null) {
  const discovered = await discoverConfiguredRoutes(ctx, signal)
  const profiled = configuredRoutesWithProfiles(discovered, config)
  const priced = applyPricingSnapshot(profiled, dynamicOptions(config).enabled ? dynamicData?.pricing : null)
  const learned=applyFeedbackProfile(priced, feedbackProfile ?? buildFeedbackProfile(runs, feedbackOptions(config)))
  const fundingAdapter=typeof ctx.get==='function'?ctx.get('botFunding'):null
  return fundingAdapter?fundingAdapter.routeProfiles(learned):learned
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

export async function reportRunProgress(options, event) {
  try { if (typeof options.onProgress === 'function') await options.onProgress(event) }
  catch { /* Observing progress must not discard results or incurred spend. */ }
}

export function executionHooks(ctx, options) {
  return {
    authorizeOfficial: request => authorizeOfficialRequest(ctx, request),
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
    runVerified: async request => {
      const admitted = await authorizeOfficialRequest(ctx, { toolId: request.toolId,
        ...(request.modelId == null ? {} : { cliModel: request.modelId }), mode: 'read-only', executionEnvironment: 'harness' })
      return (options.runVerified ?? runOfficialTool)({ ...request, modelId: admitted.modelId, sandbox: ctx.sandbox, mode: 'read-only' })
    },
  }
}

/** Not wire data: only the Host runner can attach this admission closure. */
export function officialExecutionFor(ctx, requests) {
  return { requests, authorize: request => authorizeOfficialRequest(ctx, request) }
}

export function officialTeamFunding(ctx, plan, cliModels, mode, executionEnvironment) {
  return officialExecutionFor(ctx, plan.team.workPackages.map(item => {
    const toolId = toolForProvider(item.recommendedProvider)?.id
    return { packageId: item.id, toolId, cliModel: cliModels?.[item.id] ?? cliModels?.[toolId] ?? DEFAULT_OFFICIAL_MODEL,
      mode, executionEnvironment }
  }))
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
export async function validateManualTools(ctx, assignments, options = {}) {
  const targets = parsePackageAssignments(assignments)
  const ids = [...new Set(Object.values(targets ?? {}).filter(item => item.kind === 'tool').map(item => item.toolId))]
  if (!ids.length) return
  if (typeof ctx.sandbox?.confine !== 'function') throw new Error('手动分配的官方工具需要 Harness 进程沙箱；请检查执行环境后重新预览。')
  const installed = options.installedToolIds ?? await installedToolIds()
  const capabilities = options.executionCapabilities ?? officialToolExecutionCapabilities()
  const knownReadiness = options.manualReadiness ?? options.readiness ?? []
  for (const id of ids) {
    await authorizeOfficialRequest(ctx, { toolId: id, mode: 'read-only', executionEnvironment: 'harness' })
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
export async function consultWithQualityGate(ctx, route, task, limit, signal, { gate = null, alternatives = [], approveUpgrade } = {}) {
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
  const runId = options[WORKBENCH_RUN_ID] ?? randomUUID()
  const makeRecord = execution => buildRunRecord({ id: runId, createdAt: startedAt, finishedAt: Date.now(),
    task: taskText, plan, execution, preset: plan.preset ?? preset, workspace: options.workspace ?? '',
    pricingFor: item => routePricing(routes, item), billingFor: billingForResult,
    budget: { estimateUsd: budget.estimateUsd, exceeded: budget.exceeded, downgraded: budget.downgraded === true,
      confirmed: options.confirmOverBudget === true } })
  const lifecycle = await beginExecutionLifecycle({ state: routerStateStore(),
    packageEstimates: packageEstimates(plan, taskText), settings: budgetSettings(config),
    managedExecution: options.managedExecution,
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
