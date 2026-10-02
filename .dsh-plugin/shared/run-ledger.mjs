/**
 * Pure run-ledger logic shared by the Host and the Desktop panel: actual cost
 * from reported token usage, daily/monthly spending, budget decisions, and
 * gentle routing adjustments from user ratings and reviews.
 */

export const MAX_STORED_ANSWER = 4_000
export const MAX_STORED_TASK = 20_000
/** Ratings move a route's quality by at most this much (quality is 0–1). */
export const MAX_QUALITY_BIAS = 0.04

const finite = value => typeof value === 'number' && Number.isFinite(value)
const routeKey = (provider, model) => `${String(provider ?? '')}\u0000${String(model ?? '')}`

/** USD cost of one package. Prefers a CLI-reported cost, else usage × configured price. */
export function actualCost(result, pricing) {
  if (finite(result?.reportedCostUsd) && result.reportedCostUsd >= 0) {
    return { costUsd: result.reportedCostUsd, costSource: 'cli-reported' }
  }
  const usage = result?.usage
  if (!usage || !pricing || !finite(pricing.input) || !finite(pricing.output)) {
    return { costUsd: null, costSource: usage ? 'price-missing' : 'usage-missing' }
  }
  const input = finite(usage.inputTokens) ? usage.inputTokens : 0
  const output = finite(usage.outputTokens) ? usage.outputTokens : 0
  const cacheRead = finite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0
  const cacheWrite = finite(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0
  const costUsd = (input * pricing.input
    + cacheRead * (finite(pricing.cacheRead) ? pricing.cacheRead : pricing.input)
    + cacheWrite * (finite(pricing.cacheWrite) ? pricing.cacheWrite : pricing.input)
    + output * pricing.output) / 1_000_000
  return { costUsd, costSource: 'usage' }
}

const pad = value => String(value).padStart(2, '0')
/** Local calendar keys (the Host's time zone, which is the user's machine). */
export const dayKey = at => { const date = new Date(at); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
export const monthKey = at => { const date = new Date(at); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}` }

/** Recorded spending for today and this month, plus packages whose cost is unknown. */
export function spending(runs, at = Date.now()) {
  const today = dayKey(at)
  const month = monthKey(at)
  const total = { today: 0, month: 0, unknownToday: 0, unknownMonth: 0 }
  for (const run of Array.isArray(runs) ? runs : []) {
    for (const item of [...(run.packages ?? []), ...(run.reviews ?? [])]) {
      const when = item.finishedAt ?? run.createdAt
      if (!finite(when)) continue
      const inMonth = monthKey(when) === month
      if (!inMonth) continue
      const inDay = dayKey(when) === today
      if (finite(item.costUsd)) {
        total.month += item.costUsd
        if (inDay) total.today += item.costUsd
      } else if (item.ran === true) {
        total.unknownMonth += 1
        if (inDay) total.unknownToday += 1
      }
    }
  }
  return total
}

/**
 * Decide whether a run fits the configured limits. A zero limit is off.
 * `estimateUsd` null means prices are missing; only already-exceeded limits block then.
 */
export function budgetCheck({ estimateUsd = null, spent = { today: 0, month: 0 }, dailyLimitUsd = 0, monthlyLimitUsd = 0 } = {}) {
  const limits = []
  if (finite(dailyLimitUsd) && dailyLimitUsd > 0) limits.push({ period: 'daily', label: '今日', limit: dailyLimitUsd, spent: spent.today ?? 0 })
  if (finite(monthlyLimitUsd) && monthlyLimitUsd > 0) limits.push({ period: 'monthly', label: '本月', limit: monthlyLimitUsd, spent: spent.month ?? 0 })
  const estimateKnown = finite(estimateUsd)
  const remaining = limits.length ? Math.max(0, Math.min(...limits.map(item => item.limit - item.spent))) : null
  const exceeded = limits.find(item => item.spent >= item.limit || (estimateKnown && item.spent + estimateUsd > item.limit)) ?? null
  return {
    limited: limits.length > 0,
    estimateKnown,
    estimateUsd: estimateKnown ? estimateUsd : null,
    remainingUsd: remaining,
    exceeded: exceeded ? exceeded.period : null,
    message: exceeded
      ? `${exceeded.label}预算 $${exceeded.limit.toFixed(2)}，已用 $${exceeded.spent.toFixed(4)}${estimateKnown ? `，本次预估 $${estimateUsd.toFixed(4)}` : ''}，将超出上限。`
      : limits.length && !estimateKnown ? '部分路线缺少单价，无法预估本次费用；仅在已用金额达到上限时阻止。' : '',
  }
}

/**
 * Per-route quality bias from ratings (+1/-1) and reviews (score 1–5).
 * Bayesian-shrunk toward 0 so a single rating barely moves routing.
 */
export function routeQualityBiases(runs) {
  const tally = new Map()
  for (const run of Array.isArray(runs) ? runs : []) {
    for (const item of run.packages ?? []) {
      const key = routeKey(item.provider, item.model)
      const entry = tally.get(key) ?? { sum: 0, weight: 0, ratings: 0 }
      if (item.rating === 1 || item.rating === -1) { entry.sum += item.rating; entry.weight += 1; entry.ratings += 1 }
      if (finite(item.review?.score)) { entry.sum += 0.5 * ((item.review.score - 3) / 2); entry.weight += 0.5 }
      tally.set(key, entry)
    }
  }
  const biases = {}
  for (const [key, entry] of tally) {
    if (entry.weight === 0) continue
    const bias = MAX_QUALITY_BIAS * entry.sum / (entry.weight + 3)
    biases[key] = Math.max(-MAX_QUALITY_BIAS, Math.min(MAX_QUALITY_BIAS, Number(bias.toFixed(4))))
  }
  return biases
}

/** Attach biases to exact routes; the planner adds them to estimated quality. */
export function applyQualityBiases(routes, biases) {
  if (!biases || typeof biases !== 'object') return routes
  return (Array.isArray(routes) ? routes : []).map(route => {
    const bias = biases[routeKey(route.provider, route.model)]
    return finite(bias) && bias !== 0 ? { ...route, qualityBias: bias } : route
  })
}

function storedPackage(planned, result, pricing, finishedAt) {
  const cost = result?.blocked ? { costUsd: null, costSource: 'not-run' } : actualCost(result, pricing)
  return {
    id: planned.id,
    name: planned.name,
    objective: String(planned.objective ?? '').slice(0, 2_000),
    dependsOn: [...(planned.dependsOn ?? [])],
    recommendedProvider: planned.recommendedProvider,
    recommendedModel: planned.recommendedModel,
    difficulty: planned.difficulty ?? null,
    estimatedCost: finite(planned.estimatedCost) ? planned.estimatedCost : null,
    plannedChannel: planned.executionChannel ?? null,
    provider: result?.provider ?? planned.recommendedProvider,
    model: result?.model ?? planned.recommendedModel,
    status: !result ? 'pending' : result.ok ? (result.fallback ? 'fallback' : 'succeeded') : result.blocked ? 'blocked' : result.cancelled ? 'cancelled' : 'failed',
    ok: result?.ok === true,
    ran: Boolean(result) && !result.blocked,
    blocked: result?.blocked === true,
    reassigned: result?.reassigned === true,
    channel: result?.channel ?? null,
    toolId: result?.toolId ?? null,
    fallback: result?.fallback ?? null,
    error: result?.ok ? null : (result?.error ?? null),
    answer: String(result?.answer ?? '').slice(0, MAX_STORED_ANSWER),
    answerTruncated: String(result?.answer ?? '').length > MAX_STORED_ANSWER,
    usage: result?.usage ?? null,
    ...cost,
    finishedAt,
    review: planned.review ?? null,
    rating: planned.rating ?? null,
  }
}

/** Planned packages with their routing reason, for ledger and UI. */
export function plannedPackages(plan, task) {
  if (plan?.routingBypassed) {
    const route = plan.directRoute ?? plan.selected
    return [{ id: 'direct', name: '指定模型', objective: String(task ?? ''), dependsOn: [],
      recommendedProvider: route?.provider, recommendedModel: route?.model,
      difficulty: plan.complexity?.band ?? null, estimatedCost: plan.estimatedCost ?? null,
      executionChannel: plan.executionChannel ?? null }]
  }
  return (plan?.team?.workPackages ?? []).map(item => ({ ...item }))
}

/** One ledger record for a plan and its execution. */
export function buildRunRecord({ id, createdAt, task, plan, execution, preset = 'balanced', workspace = '', pricingFor = () => null, budget = null, finishedAt = createdAt }) {
  const planned = plannedPackages(plan, task)
  const results = Array.isArray(execution?.packages) ? execution.packages : []
  return {
    id,
    createdAt,
    finishedAt,
    task: String(task ?? '').slice(0, MAX_STORED_TASK),
    workspace,
    routingBypassed: plan?.routingBypassed === true,
    mode: plan?.mode ?? 'single',
    preset,
    decision: {
      selected: plan?.selected ? { provider: plan.selected.provider, model: plan.selected.model } : null,
      reason: String(plan?.reason ?? ''),
      complexity: plan?.complexity ? { band: plan.complexity.band, value: finite(plan.complexity.value) ? Number(plan.complexity.value.toFixed(3)) : null } : null,
      estimatedCost: finite(plan?.estimatedCost) ? plan.estimatedCost : null,
      executionChannel: plan?.executionChannel ?? null,
    },
    budget,
    status: execution?.status ?? 'pending',
    packages: planned.map(item => storedPackage(item, results.find(result => result.id === item.id), pricingFor(results.find(result => result.id === item.id) ?? item), finishedAt)),
    reviews: [],
  }
}

/** Replace the retried packages (`rerunIds`) with new results; untouched ones keep ratings and reviews. */
export function mergeRerun(run, execution, { rerunIds = [], pricingFor = () => null, finishedAt = Date.now() } = {}) {
  const results = Array.isArray(execution?.packages) ? execution.packages : []
  const retried = new Set(rerunIds)
  run.packages = run.packages.map(stored => {
    const result = results.find(item => item.id === stored.id)
    if (!result || !retried.has(stored.id)) return stored
    return storedPackage({ ...stored, review: null, rating: null }, result, pricingFor(result), finishedAt)
  })
  run.status = execution?.status ?? run.status
  run.finishedAt = finishedAt
  return run
}

/** Results in executor shape, from stored packages, for a retry. */
export function storedResults(run) {
  return (run?.packages ?? []).map(item => ({
    id: item.id, name: item.name, ok: item.ok, provider: item.provider, model: item.model,
    channel: item.channel, answer: item.answer, error: item.error, fallback: item.fallback,
    blocked: item.blocked, finishedAt: item.finishedAt,
  }))
}
