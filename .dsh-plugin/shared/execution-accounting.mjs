/** API money and subscription quantities are separate dimensions. */
import { plannedPackages } from './run-ledger.mjs'
import { billingPlan } from './subscription-billing.mjs'
import { toolForProvider } from './official-tool-registry.mjs'
import { estimateAssignedPackage } from './router.mjs'

export function initialFunding(route, { billing = null, officialCli = false, toolId = null,
  loginBillingFor = () => 'unknown', apiKeyFor = () => false, forceApi = false, executionChannel = null } = {}) {
  const id = toolId ?? toolForProvider(route?.provider)?.id
  if (forceApi) return { billing: 'api', route }
  if (officialCli) return { billing: !apiKeyFor(id) && loginBillingFor(id) === 'subscription' ? 'subscription' : 'api', route }
  if (!billing) return { billing: 'api', route }
  const policy = billingPlan(route, billing.routes ?? [])
  if (policy.mode === 'subscription-only') return { billing: 'subscription', route }
  if (policy.mode === 'api-only' || billing.choice === 'api') return { billing: 'api', route: policy.apiRoute ?? route }
  const sub = policy.subscription
  if (!sub) return { billing: 'api', route }
  if (billing.quota?.status?.(sub.key)) return { billing: 'api', route: policy.apiRoute ?? route }
  if (sub.kind === 'plan-key') return { billing: 'subscription', route }
  if (billing.choice === 'subscription') return { billing: 'subscription', route }
  const login = billing.loginBillingFor?.(sub.toolId) ?? loginBillingFor(sub.toolId)
  return { billing: route?.execution === 'api' || executionChannel === 'harness-llm'
    || login !== 'subscription' ? 'api' : 'subscription', route }
}

export function attachPlanAccounting(plan, task, routes = [], context = {}) {
  const entries = plannedPackages(plan, task).map((item, index) => {
    const selected = item.manualAssignment?.kind === 'api' ? item.manualAssignment
      : { provider: item.recommendedProvider, model: item.recommendedModel }
    const route = routes.find(route => route.provider === selected.provider && route.model === selected.model) ?? selected
    const funding = initialFunding(route, { ...context, executionChannel: item.executionChannel ?? plan.executionChannel,
      ...(context.billingChoices?.[item.id] && context.billing ? { billing: { ...context.billing, choice: context.billingChoices[item.id] } } : {}),
      ...(item.manualAssignment?.kind === 'api' ? { forceApi: true } : {}),
      ...(item.manualAssignment?.kind === 'tool' ? { officialCli: true, toolId: item.manualAssignment.toolId } : {}) })
    const resource = plan.costBreakdown?.[index] ?? estimateAssignedPackage(route, item, task, plan.complexity?.band ?? 'balanced')
    const changed = funding.route?.provider !== route.provider || funding.route?.model !== route.model
    const estimate = changed || plan.subscriptionPricedRoutes?.includes(`${route.provider}/${route.model}`)
      ? estimateAssignedPackage(funding.route, item, task, plan.complexity?.band ?? 'balanced').estimatedCost
      : item.estimatedCost ?? null
    return { id: item.id, billing: funding.billing,
      apiEstimatedCostUsd: funding.billing === 'subscription' ? 0 : estimate,
      estimatedUsage: { inputTokens: resource.inputTokens ?? null, outputTokens: resource.outputTokens ?? null } }
  })
  const api = entries.filter(item => item.billing === 'api')
  plan.accounting = { packages: entries, apiExposure: api.length > 0,
    apiEstimatedCostUsd: api.some(item => !Number.isFinite(item.apiEstimatedCostUsd)) ? null
      : api.reduce((sum, item) => sum + item.apiEstimatedCostUsd, 0) }
  return plan.accounting
}

export const accountingEstimates = plan => plan.accounting.packages.map(item => ({ id: item.id,
  billing: item.billing, estimatedCostUsd: item.apiEstimatedCostUsd }))

/** Zero marginal API expense for subscription routes; never rewrite real prices. */
export function planningFundingPrices(routes, context, channelForRoute = () => null) {
  const subscriptionPricedRoutes = routes.filter(route => initialFunding(route, {
    ...context, executionChannel: channelForRoute(route),
  }).billing === 'subscription').map(route => `${route.provider}/${route.model}`)
  return { subscriptionPricedRoutes, pricing: Object.fromEntries(subscriptionPricedRoutes.map(key => [key,
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }])) }
}
