/** Pure client controls. Host validation and recorded-result binding remain authoritative. */
export const ADAPTIVE_DEFAULTS = Object.freeze({
  feedbackLearningEnabled: true,
  feedbackHalfLifeDays: 30,
  feedbackPriorWeight: 3,
  feedbackMaxAdjustment: 0.04,
  feedbackResetAt: 0,
  dynamicDataEnabled: false,
  liveBenchEndpoint: 'https://livebench.ai',
  dynamicDataTtlMinutes: 1440,
  pricingSnapshotEndpoint: '',
})

export const ADAPTIVE_NUMBER_FIELDS = Object.freeze([
  Object.freeze({ key: 'feedbackHalfLifeDays', min: 1, max: 3650, step: 1 }),
  Object.freeze({ key: 'feedbackPriorWeight', min: 1, max: 1_000_000, step: 1 }),
  Object.freeze({ key: 'feedbackMaxAdjustment', min: 0, max: 0.1, step: 0.01 }),
  Object.freeze({ key: 'dynamicDataTtlMinutes', min: 1, max: 10_080, step: 1 }),
])

export function adaptiveSettingValue(settings, key) {
  return settings?.[key] ?? ADAPTIVE_DEFAULTS[key]
}

export function parseAdaptiveNumber(key, draft) {
  const field = ADAPTIVE_NUMBER_FIELDS.find(item => item.key === key)
  if (!field) throw new TypeError('Unknown numeric setting')
  if ((typeof draft !== 'string' && typeof draft !== 'number') || String(draft).trim() === '') throw new TypeError('Enter a number')
  const value = Number(draft)
  if (!Number.isFinite(value) || value < field.min || value > field.max) throw new RangeError(`Expected ${field.min}..${field.max}`)
  return value
}

/** Public source endpoints cannot carry authentication or a signed query. */
export function parsePublicEndpoint(key, draft) {
  if (!['liveBenchEndpoint', 'pricingSnapshotEndpoint'].includes(key)) throw new TypeError('Unknown endpoint setting')
  if (typeof draft !== 'string') throw new TypeError('Enter a public HTTPS URL')
  const value = draft.trim()
  if (key === 'pricingSnapshotEndpoint' && value === '') return ''
  if (!value || value.length > 2048) throw new TypeError('Enter a public HTTPS URL')
  let parsed
  try { parsed = new URL(value) } catch { throw new TypeError('Enter a public HTTPS URL') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.port && parsed.port !== '443')) {
    throw new TypeError('Use a public HTTPS URL without credentials, query or fragment')
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/iu.test(parsed.hostname)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/iu.test(parsed.hostname)) throw new TypeError('Use a public hostname')
  return value
}

/** Do not echo invalid legacy endpoint values, including secrets in URLs. */
export function publicEndpointDraft(key, value) {
  try { return parsePublicEndpoint(key, value) } catch { return '' }
}

export function feedbackRatingArguments(run, item, direction) {
  if (!['up', 'down'].includes(direction)) throw new TypeError('Unknown rating direction')
  const active = direction === 'up' ? item?.rating === 1 : item?.rating === -1
  return [run?.id, item?.id, active ? 'clear' : direction, item?.finishedAt]
}

const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : 0
export function learningView(learning, settings = {}) {
  return {
    available: Boolean(learning && typeof learning === 'object'),
    enabled: typeof learning?.enabled === 'boolean' ? learning.enabled : adaptiveSettingValue(settings, 'feedbackLearningEnabled') !== false,
    feedbackCount: nonnegative(learning?.feedbackCount),
    ignoredCount: nonnegative(learning?.ignoredCount),
    effectiveWeight: nonnegative(learning?.effectiveWeight),
    policyVersion: typeof learning?.policyVersion === 'string' ? learning.policyVersion.slice(0, 100) : null,
    resetAt: nonnegative(adaptiveSettingValue(settings, 'feedbackResetAt')),
  }
}

const STATUS_LABEL = Object.freeze({ disabled: '未启用', missing: '尚无快照', fresh: '快照有效', stale: '快照过期', error: '更新失败' })
export function dynamicSourceView(source) {
  const status = Object.hasOwn(STATUS_LABEL, source?.status ?? '') ? source.status : 'missing'
  let publicSource = ''
  if (typeof source?.source === 'string') publicSource = publicEndpointDraft('pricingSnapshotEndpoint', source.source)
  return {
    status,
    label: STATUS_LABEL[status],
    source: publicSource,
    version: typeof source?.version === 'string' ? source.version.slice(0, 160) : null,
    verifiedAt: Number.isFinite(source?.verifiedAt) && source.verifiedAt > 0 ? source.verifiedAt : null,
    count: nonnegative(source?.modelCount ?? source?.rowCount),
  }
}
