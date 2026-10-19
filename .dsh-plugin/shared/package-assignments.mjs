import { getOfficialTool } from './official-tool-registry.mjs'

const plain = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const safeText = (value, limit) => typeof value === 'string' && value.trim().length > 0
  && value.trim().length <= limit && !/[\u0000-\u001f\u007f]/u.test(value)
const safeKey = key => typeof key === 'string' && key === key.trim() && safeText(key, 128)
  && !['__proto__', 'constructor', 'prototype'].includes(key)

/** Explicit package targets only; callers must separately match the current plan and catalog. */
export function parsePackageAssignments(value) {
  if (value === undefined) return undefined
  if (!plain(value)) throw new TypeError('packageAssignments must be an object')
  const keys = Reflect.ownKeys(value)
  if (!keys.length || keys.length > 32 || keys.some(key => !safeKey(key))) {
    throw new TypeError('packageAssignments requires 1..32 safe package ids')
  }
  const result = {}
  for (const id of keys) {
    const target = value[id]
    if (!plain(target)) throw new TypeError(`Invalid package assignment: ${id}`)
    const allowed = target.kind === 'api' ? ['kind', 'provider', 'model']
      : target.kind === 'tool' ? ['kind', 'toolId'] : null
    if (!allowed || Reflect.ownKeys(target).some(key => !allowed.includes(key))) {
      throw new TypeError(`Unsupported package assignment fields: ${id}`)
    }
    if (target.kind === 'api') {
      if (!safeText(target.provider, 160) || !safeText(target.model, 240)) {
        throw new TypeError(`API assignment requires provider and model: ${id}`)
      }
      result[id] = { kind: 'api', provider: target.provider.trim(), model: target.model.trim() }
    } else {
      if (!safeText(target.toolId, 64) || !getOfficialTool(target.toolId.trim())) {
        throw new TypeError(`Unknown official tool assignment: ${id}`)
      }
      result[id] = { kind: 'tool', toolId: target.toolId.trim() }
    }
  }
  return result
}

/** Bounded intent metadata shared by execution, storage and retries. */
export function packageSelectionFields(item) {
  if (item?.manualAssignment === undefined) return {}
  const target = parsePackageAssignments({ target: item.manualAssignment }).target
  const recommendation = {}
  for (const key of ['provider', 'model', 'reasoningEffort', 'channel', 'executionChannel', 'qualitySource',
    'recommendedProvider', 'recommendedModel', 'recommendedReasoningEffort']) {
    const value = item.algorithmRecommendation?.[key]
    if (safeText(value, 240)) recommendation[key] = value.trim()
  }
  return { manualAssignment: target, selectionSource: 'manual',
    ...(Object.keys(recommendation).length ? { algorithmRecommendation: recommendation } : {}) }
}

/** Browser/Host identity for the task decomposition, not an authentication signature. */
export function packagePlanKey(plan, task = '') {
  const packages = plan?.team?.workPackages
  if (plan?.routingBypassed || plan?.mode === 'direct' || !Array.isArray(packages) || !packages.length) return null
  const fields = packages.map(item => [item?.id ?? '', item?.name ?? '', item?.objective ?? '',
    item?.type ?? '', item?.purpose ?? '', Array.isArray(item?.dependsOn) ? [...item.dependsOn] : []])
  const text = JSON.stringify([String(task ?? '').trim(), fields])
  let first = 2166136261
  let second = 2246822507
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619) >>> 0
    second = Math.imul(second ^ code, 3266489909) >>> 0
  }
  return `package-plan-v1-${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}
