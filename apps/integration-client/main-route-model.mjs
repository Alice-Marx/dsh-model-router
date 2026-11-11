import { accountFor, findModel, numberOrNull, routeOf, scopeAllows, textOf } from './binding-model.mjs'

export const MAIN_LIMIT_FIELDS = {
  api: [['dailyBudgetUsd', '共享每日 API 预算（USD）'], ['monthlyBudgetUsd', '共享每月 API 预算（USD）']],
  subscription: [['dailyCalls', '共享每日订阅次数'], ['monthlyCalls', '共享每月订阅次数']],
}

const pair = (value, first, second) => {
  const a = numberOrNull(value?.[first]), b = numberOrNull(value?.[second])
  return a === null || b === null ? null : { [first]: a, [second]: b }
}

function routeDraft(model, account, funding = null, enabled = false) {
  return {
    provider: model.provider, model: model.model, enabled,
    funding: {
      mode: funding?.mode ?? model.fundingModes?.[0] ?? 'api',
      scopeId: funding?.scopeId ?? account?.id ?? null,
      pricing: funding ? funding.pricing ?? null : model.pricing ?? null,
      request: funding?.request ?? null,
    },
  }
}

export const newMainRoute = (model, accounts) => routeDraft(model, accountFor(accounts, model.provider))

export function startMainRoutes(form, model, account, savedFunding) {
  const pricing = pair(form, 'input', 'output')
  const savedPrice = savedFunding?.pricing
  const exactPrice = pricing && savedPrice?.input === pricing.input && savedPrice?.output === pricing.output ? savedPrice : pricing
  return {
    schemaVersion: 1,
    limits: {
      api: { dailyBudgetUsd: form.daily, monthlyBudgetUsd: form.monthly },
      subscription: { dailyCalls: form.dailyCalls, monthlyCalls: form.monthlyCalls },
    },
    routes: model ? [routeDraft(model, account, {
      mode: form.fundingMode, scopeId: account?.id,
      pricing: form.fundingMode === 'api' ? exactPrice : null,
      request: form.fundingMode === 'api' ? pair(form, 'maxInputTokens', 'maxOutputTokens') : null,
    }, form.enabled && Boolean(account?.enabled))] : [],
  }
}

export function mainRoutePayload(draft) {
  if (!draft) return draft
  return {
    schemaVersion: 1,
    limits: Object.fromEntries(Object.entries(MAIN_LIMIT_FIELDS).map(([mode, [[first], [second]]]) => [mode, pair(draft.limits[mode], first, second)])),
    routes: draft.routes.map(route => {
      const funding = route.funding
      const pricing = funding.mode === 'api' ? pair(funding.pricing, 'input', 'output') : null
      if (pricing) for (const key of ['cacheRead', 'cacheWrite']) {
        const value = numberOrNull(funding.pricing[key])
        if (value !== null) pricing[key] = value
      }
      return { ...route, funding: { mode: funding.mode, scopeId: funding.scopeId, pricing,
        request: funding.mode === 'api' ? pair(funding.request, 'maxInputTokens', 'maxOutputTokens') : null } }
    }),
  }
}

export function mainDefaultFields(draft, routeId) {
  const route = draft.routes.find(item => routeOf(item) === routeId)
  if (!route) return {}
  return {
    fundingMode: route.funding.mode, input: textOf(route.funding.pricing?.input), output: textOf(route.funding.pricing?.output),
    maxInputTokens: textOf(route.funding.request?.maxInputTokens), maxOutputTokens: textOf(route.funding.request?.maxOutputTokens),
    daily: textOf(draft.limits.api?.dailyBudgetUsd), monthly: textOf(draft.limits.api?.monthlyBudgetUsd),
    dailyCalls: textOf(draft.limits.subscription?.dailyCalls), monthlyCalls: textOf(draft.limits.subscription?.monthlyCalls),
  }
}

export function mainRouteProblems(draft, { defaultRoute, enabled, catalog, accounts }) {
  const settings = mainRoutePayload(draft)
  const problems = []
  const valid = (value, minimum = 0, integer = false) => Number.isFinite(value) && value >= minimum && (!integer || Number.isSafeInteger(value))
  if (enabled && !settings.routes.some(route => route.enabled && routeOf(route) === defaultRoute)) problems.push('请从已启用的路线中选择默认模型。')
  for (const [mode, fields] of Object.entries(MAIN_LIMIT_FIELDS)) {
    const values = fields.map(([key]) => numberOrNull(draft.limits[mode]?.[key]))
    if (values.some(value => value !== null) && !values.every(value => valid(value, 0, mode === 'subscription'))) {
      problems.push(`${mode === 'api' ? 'API 预算' : '订阅次数'}的每日与每月限额需同时填写。`)
    }
  }
  for (const route of settings.routes) {
    if (!route.enabled) continue
    const id = routeOf(route), model = findModel(catalog, id), { mode, scopeId, pricing, request } = route.funding
    const account = accountFor(accounts, route.provider)
    const scope = (catalog?.fundingScopes ?? []).find(item => item.id === scopeId)
    if (!model || (model.fundingModes && !model.fundingModes.includes(mode)) || account?.id !== scopeId || !account?.enabled || !scopeAllows(scope, mode, id)) {
      problems.push(`${id} 需要有效的模型、渠道和已启用的资金范围。`)
    }
    if (!settings.limits[mode]) problems.push(`${id} 需要填写共享${mode === 'api' ? ' API 预算' : '订阅次数'}。`)
    if (mode === 'api' && (!(pricing ?? model?.pricing) || !Object.values(pricing ?? model.pricing).every(value => valid(value))
      || !valid(request?.maxInputTokens, 1, true) || !valid(request?.maxOutputTokens, 1, true))) {
      problems.push(`${id} 需要准确价格与正整数请求上界。`)
    }
  }
  return problems
}
