/** Structural output checks only: passing these checks does not establish semantic correctness. */
const TYPES = new Set(['string', 'number', 'boolean', 'object', 'array', 'null'])
const FIELDS = new Set(['kind', 'requiredKeys', 'fieldTypes'])
const STRUCTURE_ERROR = '输出未满足配置的结构验收要求。'
const plainObject = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const safeKey = key => typeof key === 'string' && key.length > 0 && key.length <= 128
  && key.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(key)
  && !['__proto__', 'prototype', 'constructor'].includes(key)

function normalizeGate(value) {
  if (!plainObject(value)) throw new TypeError('Quality gate must be a JSON object')
  const keys = Object.keys(value)
  if (!keys.length) return null
  if (keys.some(key => !FIELDS.has(key)) || value.kind !== 'json-object') {
    throw new TypeError('Unsupported quality gate field or kind')
  }
  const requiredKeys = Object.hasOwn(value, 'requiredKeys') ? value.requiredKeys : []
  if (!Array.isArray(requiredKeys) || requiredKeys.length > 32 || requiredKeys.some(key => !safeKey(key))) {
    throw new TypeError('requiredKeys must contain at most 32 safe keys')
  }
  const fieldTypes = Object.hasOwn(value, 'fieldTypes') ? value.fieldTypes : {}
  if (!plainObject(fieldTypes) || Object.keys(fieldTypes).length > 32
    || Object.entries(fieldTypes).some(([key, type]) => !safeKey(key) || !TYPES.has(type))) {
    throw new TypeError('fieldTypes must map safe keys to supported JSON types')
  }
  return { kind: 'json-object', requiredKeys: [...requiredKeys], fieldTypes: { ...fieldTypes } }
}

export function parseQualityGateJson(text = '') {
  if (typeof text !== 'string') throw new TypeError('Quality gate JSON must be a string')
  if (!text.trim()) return null
  let value
  try { value = JSON.parse(text) } catch { throw new TypeError('Quality gate must be valid JSON') }
  return normalizeGate(value)
}

function matchesType(value, type) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return plainObject(value)
  return typeof value === type && (type !== 'number' || Number.isFinite(value))
}

export function validateAnswer(answer, gate) {
  if (gate == null) return { ok: true, kind: null, errors: [] }
  const rule = normalizeGate(gate)
  if (!rule) return { ok: true, kind: null, errors: [] }
  const errors = []
  let object
  try {
    if (typeof answer !== 'string') throw new TypeError('text required')
    object = JSON.parse(answer)
    if (!plainObject(object)) throw new TypeError('object required')
  } catch {
    return { ok: false, kind: rule.kind, errors: ['Expected one complete JSON object.'] }
  }
  // JSON.parse accepts overflows such as 1e999; reject them even in nested data.
  const pending = [object]
  while (pending.length) {
    const value = pending.pop()
    if (typeof value === 'number' && !Number.isFinite(value)) {
      errors.push('JSON numbers must be finite.')
      break
    }
    if (value !== null && typeof value === 'object') for (const child of Object.values(value)) pending.push(child)
  }
  for (const key of rule.requiredKeys) {
    if (!Object.hasOwn(object, key)) errors.push(`Missing required key: ${key}`)
  }
  for (const [key, type] of Object.entries(rule.fieldTypes)) {
    if (Object.hasOwn(object, key) && !matchesType(object[key], type)) errors.push(`Invalid type for ${key}: expected ${type}`)
  }
  return { ok: errors.length === 0, kind: rule.kind, errors }
}

const ATTEMPT_FIELDS = [
  'ok', 'answer', 'error', 'usage', 'usageIncomplete', 'reportedCostUsd', 'channel', 'billing', 'billingMode',
  'actualModel', 'reportedModel', 'source', 'cancelled', 'blocked', 'paused', 'truncated', 'timedOut',
  'notStarted', 'ran', 'status', 'finishReason', 'reasoningEffort', 'plannedReasoningEffort', 'requestedReasoningEffort', 'reasoningEffortStatus', 'inputChars',
]
function copyEvidence(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value
  if (!Array.isArray(value) && !plainObject(value)) return undefined
  if (seen.has(value)) return undefined
  const copy = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  for (const key of Object.keys(value)) {
    if (key === 'attempts' || key === '__proto__') continue
    copy[key] = copyEvidence(value[key], seen)
  }
  return copy
}
function attemptRecord(result, route, startedAt, finishedAt) {
  const attempt = {}
  for (const key of ATTEMPT_FIELDS) if (Object.hasOwn(result, key)) attempt[key] = copyEvidence(result[key])
  return { ...attempt, provider: result.provider ?? route.provider, model: result.model ?? route.model,
    pricingSnapshot: plainObject(route.pricing) ? { ...route.pricing } : null,
    startedAt, finishedAt, durationMs: Math.max(0, finishedAt - startedAt) }
}
const cancelledResult = result => ({ ...result, ok: false, cancelled: true, error: '执行已取消。' })
const stopped = result => ['cancelled', 'blocked', 'paused', 'truncated', 'timedOut', 'notStarted']
  .find(key => result[key] === true || result.status === key)
const configuredRoute = route => plainObject(route) && typeof route.provider === 'string'
  && route.provider.trim().length > 0 && typeof route.model === 'string' && route.model.trim().length > 0

/** At most two externally supplied API calls. approveUpgrade owns budget and billing authorization. */
export async function runQualityCascade({ route, task, gate = null, call, alternatives = [], approveUpgrade, signal } = {}) {
  if (!configuredRoute(route) || typeof call !== 'function') throw new TypeError('A configured route and call function are required')
  const rule = gate == null ? null : normalizeGate(gate)
  const attempts = []
  const check = result => validateAnswer(result?.answer, rule)
  if (signal?.aborted) {
    const result = cancelledResult({ answer: '', notStarted: true })
    return { result, attempts, validation: check(result) }
  }
  async function invoke(selected) {
    const startedAt = Date.now()
    let result
    try {
      result = await call({ route: selected, task, signal })
      if (!plainObject(result)) result = { ok: false, error: 'API未返回有效结果。', ran: 'unknown', usageIncomplete: true }
    } catch (error) {
      result = { ok: false, error: 'API调用失败。', ran: 'unknown', usageIncomplete: true,
        ...(signal?.aborted || error?.name === 'AbortError' ? { cancelled: true } : {}) }
    }
    attempts.push(attemptRecord(result, selected, startedAt, Date.now()))
    return result
  }
  const first = await invoke(route)
  let validation = check(first)
  if (!rule || first.ok !== true) return { result: first, attempts, validation }
  let result = first
  let escalated = false
  let upgradeReason = validation.ok ? 'passed' : 'no-alternative'
  const stop = stopped(first)
  if (!validation.ok && stop) upgradeReason = stop
  else if (!validation.ok && signal?.aborted) {
    result = cancelledResult(first)
    upgradeReason = 'cancelled'
  } else if (!validation.ok) {
    const alternative = (Array.isArray(alternatives) ? alternatives : []).find(candidate => configuredRoute(candidate)
      && (candidate.provider !== route.provider || candidate.model !== route.model))
    if (alternative) {
      if (typeof approveUpgrade !== 'function') upgradeReason = 'approval-required'
      else {
        let approved = false
        try {
          // Pass snapshots so a callback cannot erase already incurred attempt evidence.
          approved = await approveUpgrade({ from: copyEvidence(route), to: copyEvidence(alternative),
            attempts: attempts.map(item => copyEvidence(item)) })
          upgradeReason = approved === true ? 'approved' : 'approval-denied'
        } catch { upgradeReason = 'approval-error' }
        if (signal?.aborted) {
          result = cancelledResult(first)
          upgradeReason = 'cancelled'
        } else if (approved === true) {
          escalated = true
          result = await invoke(alternative)
          validation = check(result)
          upgradeReason = validation.ok && result.ok === true && !stopped(result) ? 'passed-after-upgrade' : 'upgrade-failed'
        }
      }
    }
  }
  const qualityValidation = { ...validation, escalated, upgradeReason }
  if (!validation.ok && !result.cancelled) result = { ...result, ok: false, error: STRUCTURE_ERROR }
  return { result: { ...result, qualityValidation }, attempts, validation }
}
