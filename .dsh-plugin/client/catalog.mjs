import { createPlanFromRoutes } from '../shared/harness-plan.mjs'
import { applyModelProfiles, parseModelProfilesJson } from '../shared/model-profiles.mjs'
import { applyQualityBiases } from '../shared/run-ledger.mjs'
import { applyFeedbackProfile } from '../shared/adaptive-feedback.mjs'
import { applyPricingSnapshot } from '../shared/dynamic-data-view.mjs'

const clean = value => typeof value === 'string' ? value.trim() : ''

/** Translate the official Client model catalog into the route plan contract. */
export function routesFromModelCatalog(catalog) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : []
  const routable = new Set(Array.isArray(catalog?.routableProviders) ? catalog.routableProviders : [])
  const routes = []
  const seen = new Set()
  for (const group of groups) {
    const provider = clean(group?.id)
    if (!provider || !routable.has(provider)) continue
    for (const entry of Array.isArray(group.models) ? group.models : []) {
      const model = clean(entry?.id)
      if (!model) continue
      const key = `${provider}\u0000${model}`
      if (seen.has(key)) continue
      seen.add(key)
      const reasoning = entry?.reasoning
      const efforts = Array.isArray(reasoning?.efforts)
        ? [...new Set(reasoning.efforts.map(item => clean(item?.id ?? item)).filter(Boolean))]
        : []
      routes.push({
        provider,
        providerName: clean(group.name) || provider,
        model,
        name: clean(entry.name) || model,
        reasoningKnown: reasoning !== undefined && reasoning !== null,
        reasoningEfforts: efforts,
        ...clean(reasoning?.defaultEffort) ? { defaultReasoningEffort: clean(reasoning.defaultEffort) } : {},
        // modelCatalog deliberately omits modalities; unknown means the Host
        // must still validate image capability before a real request.
        inputModalities: [],
      })
    }
  }
  routes.sort((left, right) => `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`))
  return routes
}

/** Generate a local plan without sending the task text to an LLM. */
export function createWorkspacePlan(task, catalog, options = {}) {
  const profiled = applyModelProfiles(routesFromModelCatalog(catalog), parseModelProfilesJson(options.modelProfilesJson ?? '[]'))
  const priced = applyPricingSnapshot(profiled, options.pricingSnapshot ?? null)
  const routes = options.learning
    ? applyFeedbackProfile(priced, options.learning)
    : applyQualityBiases(priced, options.qualityBiases ?? null) // old programmatic callers only
  return createPlanFromRoutes(task, routes, options)
}
