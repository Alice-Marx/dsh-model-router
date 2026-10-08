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
    available: Boolean(learning && typeof learning === 'object' && !Array.isArray(learning)),
    // Current settings govern the next plan; a failed refresh must not make an
    // older profile claim that a newly disabled policy is still enabled.
    enabled: adaptiveSettingValue(settings, 'feedbackLearningEnabled') !== false,
    feedbackCount: nonnegative(learning?.feedbackCount),
    ignoredCount: nonnegative(learning?.ignoredCount),
    effectiveWeight: nonnegative(learning?.effectiveWeight),
    policyVersion: typeof learning?.policyVersion === 'string' ? learning.policyVersion.slice(0, 100) : null,
    resetAt: nonnegative(adaptiveSettingValue(settings, 'feedbackResetAt')),
  }
}

/** Host evidence only: never turn missing metadata into inferred ratings. */
export function learningEvidenceRows(learning, limit = 12) {
  const cells = learning?.cellStats
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) return { rows: [], total: 0 }
  const rows = []
  for (const [key, domains] of Object.entries(cells)) {
    const identity = key.split('\u0000')
    if (identity.length !== 2 || identity.some(part => !part.trim()) || !domains || typeof domains !== 'object' || Array.isArray(domains)) continue
    for (const [domain, cell] of Object.entries(domains)) {
      if (!domain.trim() || !cell || typeof cell !== 'object' || Array.isArray(cell)
        || !Number.isFinite(cell.adjustment) || Math.abs(cell.adjustment) > 0.1
        || ['feedbackCount', 'positiveCount', 'negativeCount', 'effectiveWeight', 'effectiveSampleSize'].some(name => !Number.isFinite(cell[name]) || cell[name] < 0)
        || !Number.isFinite(cell.shrinkage) || cell.shrinkage < 0 || cell.shrinkage > 1) continue
      rows.push({ id: JSON.stringify([key, domain]), route: identity.map(part => part.slice(0, 100)).join('/'), domain: domain.slice(0, 80),
        feedbackCount: nonnegative(cell.feedbackCount), positiveCount: nonnegative(cell.positiveCount), negativeCount: nonnegative(cell.negativeCount),
        effectiveWeight: nonnegative(cell.effectiveWeight), effectiveSampleSize: nonnegative(cell.effectiveSampleSize),
        shrinkage: Number.isFinite(cell.shrinkage) && cell.shrinkage >= 0 && cell.shrinkage <= 1 ? cell.shrinkage : 0,
        adjustment: cell.adjustment })
    }
  }
  rows.sort((left, right) => left.route === right.route ? left.domain.localeCompare(right.domain) : left.route.localeCompare(right.route))
  const count = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 12
  return { rows: rows.slice(0, count), total: rows.length }
}

const EXCLUSION_LABELS = Object.freeze({
  'unrated': '尚未评价（不是不满意）', 'not-successful': '没有成功执行结果',
  'cli-model-unverified': 'CLI 实际模型未核验', 'before-reset': '结果早于学习起点',
  'superseded': '已被同一结果的新记录替代', 'missing-identity': '缺少运行或步骤标识',
  'invalid-route': '路线标识无效', 'invalid-time': '结果或评价时间无效', 'future-time': '时间晚于当前时刻',
})

export function learningExclusionRows(learning) {
  return Object.entries(EXCLUSION_LABELS).flatMap(([reason, label]) => {
    const count = nonnegative(learning?.exclusionReasons?.[reason])
    return count > 0 ? [{ reason, label, count }] : []
  })
}

const STATUS_LABEL = Object.freeze({ disabled: '未启用', missing: '尚无快照', fresh: '快照有效', stale: '快照过期', error: '更新失败' })
const PUBLIC_ERROR_CODES = new Set(['refresh-failed', 'snapshot-rollback-rejected', 'storage-failed', 'refresh-interrupted'])
const positiveTime = value => Number.isFinite(value) && value > 0 ? value : null
export function dynamicSourceView(source, enabled = true) {
  const status = enabled === false ? 'disabled' : Object.hasOwn(STATUS_LABEL, source?.status ?? '') ? source.status : 'missing'
  let publicSource = ''
  if (enabled !== false && typeof source?.source === 'string') publicSource = publicEndpointDraft('pricingSnapshotEndpoint', source.source)
  return {
    status,
    label: STATUS_LABEL[status],
    source: publicSource,
    version: enabled !== false && typeof source?.version === 'string' ? source.version.slice(0, 160) : null,
    verifiedAt: enabled !== false && Number.isFinite(source?.verifiedAt) && source.verifiedAt > 0 ? source.verifiedAt : null,
    count: enabled === false ? 0 : nonnegative(source?.modelCount ?? source?.rowCount),
    refreshing: enabled !== false && source?.refreshing === true,
    pending: enabled !== false && source?.pending === true,
    lastAttemptAt: enabled === false ? null : positiveTime(source?.lastAttemptAt),
    lastSuccessAt: enabled === false ? null : positiveTime(source?.lastSuccessAt),
    errorCode: enabled !== false && PUBLIC_ERROR_CODES.has(source?.error) ? source.error : '',
    endpoint: enabled === false ? '' : publicEndpointDraft('pricingSnapshotEndpoint', source?.configuredEndpoint ?? source?.endpoint ?? ''),
    lastGoodEndpoint: enabled === false ? '' : publicEndpointDraft('pricingSnapshotEndpoint', source?.lastGoodEndpoint ?? ''),
  }
}
