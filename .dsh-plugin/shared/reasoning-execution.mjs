// "requested" records an exact SDK control sent by the caller. It does not
// establish the provider's actual effort, which requires separate evidence.
const EFFORT_STATUSES = new Set(['requested', 'unsupported', 'unapplied'])

const nonEmptyEffort = value => (typeof value === 'string' && value.length > 0 ? value : null)

const allowedEffortIds = route => (Array.isArray(route?.reasoningEfforts)
  ? route.reasoningEfforts.map(item => {
    if (typeof item === 'string' && item.length > 0) return item
    if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.length > 0) return item.id
    return null
  }).filter(item => item !== null)
  : [])

/** Copy only trusted reasoning-effort fields; never infer actual effort. */
export function reasoningExecutionFields(value) {
  if (!value || typeof value !== 'object') return {}
  const fields = {}
  const planned = nonEmptyEffort(value.plannedReasoningEffort)
  if (planned) fields.plannedReasoningEffort = planned
  const requested = nonEmptyEffort(value.requestedReasoningEffort)
  if (requested) fields.requestedReasoningEffort = requested
  if (EFFORT_STATUSES.has(value.reasoningEffortStatus)) fields.reasoningEffortStatus = value.reasoningEffortStatus
  return fields
}

/**
 * Validate an explicit API-call effort against the route's exact allowed IDs.
 * A valid request is returned separately so the caller can spread it into the
 * SDK call only after validation. No default or aliased effort is chosen.
 */
export function apiReasoningRequest(route) {
  const source = route && typeof route === 'object' ? route : {}
  if (!Object.hasOwn(source, 'reasoningEffort') || source.reasoningEffort === undefined || source.reasoningEffort === null) {
    return { options: {}, fields: {} }
  }
  const effort = source.reasoningEffort
  const planned = nonEmptyEffort(effort)
  const fields = planned ? { plannedReasoningEffort: planned } : {}
  if (planned && allowedEffortIds(source).includes(effort)) {
    return {
      options: { reasoningEffort: effort },
      fields: { ...fields, requestedReasoningEffort: effort, reasoningEffortStatus: 'requested' },
    }
  }
  return {
    options: {},
    fields: { ...fields, reasoningEffortStatus: 'unsupported' },
    error: `不支持的推理强度 ID：${String(effort)}；请使用 route.reasoningEfforts 中的精确 ID。`,
  }
}

/** CLI mappings are not verified, so an explicit route effort stays unsupported. */
export function unsupportedCliReasoning(route) {
  const effort = nonEmptyEffort(route?.reasoningEffort)
  return effort ? { plannedReasoningEffort: effort, reasoningEffortStatus: 'unsupported' } : {}
}

/**
 * Build the execution route for one work package. The planned adapter-owned
 * effort survives only when the package keeps its planned identity. A manual
 * override on another provider/model must not inherit the original effort.
 */
export function reasoningRouteForAssignment(route, item, override) {
  const next = { ...(route && typeof route === 'object' ? route : {}) }
  delete next.reasoningEffort
  const plannedProvider = nonEmptyEffort(item?.recommendedProvider) ?? nonEmptyEffort(next.provider)
  const plannedModel = nonEmptyEffort(item?.recommendedModel) ?? nonEmptyEffort(next.model)
  const overrideProvider = nonEmptyEffort(override?.provider)
  const overrideModel = nonEmptyEffort(override?.model)
  const samePlannedIdentity = (!overrideProvider || overrideProvider === plannedProvider)
    && (!overrideModel || overrideModel === plannedModel)
  if (samePlannedIdentity) {
    const recommended = nonEmptyEffort(item?.recommendedReasoningEffort)
    if (recommended) next.reasoningEffort = recommended
  }
  const explicitOverride = nonEmptyEffort(override?.reasoningEffort)
  if (explicitOverride) next.reasoningEffort = explicitOverride
  return next
}

/** Preserve an effort across billing only for the same provider/model identity. */
export function routeForReasoningSwitch(source, target) {
  let next = { ...(target && typeof target === 'object' ? target : {}) }
  const sameIdentity = String(source?.provider ?? '') === String(next.provider ?? '')
    && String(source?.model ?? '') === String(next.model ?? '')
  if (sameIdentity) next = { ...source, ...next }
  const effort = nonEmptyEffort(source?.reasoningEffort)
  if (sameIdentity && effort) next.reasoningEffort = effort
  else delete next.reasoningEffort
  return next
}
