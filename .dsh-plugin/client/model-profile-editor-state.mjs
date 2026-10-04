import { parseModelProfilesJson } from '../shared/model-profiles.mjs'
import { BILLING_MODES, DEFAULT_BILLING_MODE } from '../shared/subscription-billing.mjs'

export const PROFILE_SPECIALTY_HINT = 'code, math, research, summarization, writing, vision, reasoning'

export const profileRouteKey = route => `${String(route?.provider ?? '')}\0${String(route?.model ?? '')}`

const field = value => String(value ?? '').trim()

function nonnegativeField(value, label, max = 1_000_000) {
  const raw = field(value)
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new Error(`${label} 必须是 0 到 ${max} 的数字。`)
  return parsed
}

/** Convert one saved profile into editable, human-readable form fields. */
export function profileDraft(profile) {
  return {
    quality: profile?.quality === undefined ? '' : String(Number((profile.quality * 100).toFixed(4))),
    input: profile?.pricing?.input === undefined ? '' : String(profile.pricing.input),
    output: profile?.pricing?.output === undefined ? '' : String(profile.pricing.output),
    cacheRead: profile?.pricing?.cacheRead === undefined ? '' : String(profile.pricing.cacheRead),
    cacheWrite: profile?.pricing?.cacheWrite === undefined ? '' : String(profile.pricing.cacheWrite),
    specialties: Array.isArray(profile?.specialties) ? profile.specialties.join(', ') : '',
    cliModel: profile?.cliModel ?? '',
    benchmarkModel: profile?.benchmarkModel ?? '',
    execution: profile?.execution === 'official' || profile?.execution === 'api' ? profile.execution : 'auto',
    billing: BILLING_MODES.includes(profile?.billing) ? profile.billing : DEFAULT_BILLING_MODE,
    subscription: ['plan-key', 'cli-login', 'none'].includes(profile?.subscription) ? profile.subscription : 'auto',
    apiRoute: profile?.apiRoute ? profileRouteKey(profile.apiRoute) : '',
  }
}

/** Validate an editor draft without storing secrets or guessing prices. */
export function profileFromDraft(route, draft) {
  const provider = field(route?.provider)
  const model = field(route?.model)
  if (!provider || !model) throw new Error('请先从官方模型目录选择一条准确的模型路线。')
  const profile = { provider, model }
  const benchmarkModel = field(draft?.benchmarkModel)
  if (benchmarkModel) profile.benchmarkModel = benchmarkModel
  const quality = nonnegativeField(draft?.quality, '质量评分', 100)
  if (quality !== null) profile.quality = quality
  const input = nonnegativeField(draft?.input, '输入单价')
  const output = nonnegativeField(draft?.output, '输出单价')
  const cacheRead = nonnegativeField(draft?.cacheRead, '缓存读取单价')
  const cacheWrite = nonnegativeField(draft?.cacheWrite, '缓存写入单价')
  if ((input === null) !== (output === null)) throw new Error('输入和输出单价需要同时填写；留空表示价格未知。')
  if (input === null && (cacheRead !== null || cacheWrite !== null)) throw new Error('填写缓存单价前，请先填写输入和输出单价。')
  if (input !== null) {
    profile.pricing = { input, output, currency: 'USD' }
    if (cacheRead !== null) profile.pricing.cacheRead = cacheRead
    if (cacheWrite !== null) profile.pricing.cacheWrite = cacheWrite
  }
  const rawSpecialties = field(draft?.specialties)
  if (rawSpecialties) {
    const specialties = [...new Set(rawSpecialties.split(/[,，\s]+/u).filter(Boolean))]
    if (specialties.length > 16 || specialties.some(item => !/^[a-z][a-z0-9-]{0,39}$/.test(item))) {
      throw new Error('擅长方向最多 16 项，用英文小写标签并以逗号分隔，例如 code, research。')
    }
    profile.specialties = specialties
  }
  const cliModel = field(draft?.cliModel)
  if (cliModel) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(cliModel)) throw new Error('CLI 模型名需由字母数字开头，且只包含字母、数字、点、下划线、冒号、斜杠或连字符。')
    profile.cliModel = cliModel
  }
  const execution = field(draft?.execution) || 'auto'
  if (!['auto', 'official', 'api'].includes(execution)) throw new Error('执行方式只能是自动、官方工具或模型目录 API。')
  if (execution !== 'auto') profile.execution = execution
  const billing = field(draft?.billing) || DEFAULT_BILLING_MODE
  if (!BILLING_MODES.includes(billing)) throw new Error('计费方式只能是订阅优先、只用 API Key 或只用订阅。')
  if (billing !== DEFAULT_BILLING_MODE) profile.billing = billing
  const subscription = field(draft?.subscription) || 'auto'
  if (!['auto', 'plan-key', 'cli-login', 'none'].includes(subscription)) throw new Error('订阅来源只能是自动、编程套餐 Key、CLI 账号登录或无订阅。')
  if (subscription !== 'auto') profile.subscription = subscription
  const apiKey = String(draft?.apiRoute ?? '')
  if (apiKey) {
    if (subscription !== 'plan-key') throw new Error('只有“编程套餐 Key”路线需要选择回退的 API 路线。')
    const [apiProvider, apiModel] = apiKey.split('\0')
    if (!field(apiProvider) || !field(apiModel)) throw new Error('回退 API 路线无效，请重新选择。')
    if (field(apiProvider) === provider && field(apiModel) === model) throw new Error('回退 API 路线不能是套餐路线本身。')
    profile.apiRoute = { provider: field(apiProvider), model: field(apiModel) }
  }
  return profile
}

/** Replace or remove only the selected exact route, preserving all others. */
export function updateProfileJson(rawJson, route, draft) {
  const profiles = parseModelProfilesJson(rawJson ?? '[]')
  const candidate = draft === null ? null : profileFromDraft(route, draft)
  const selected = profileRouteKey(route)
  const others = profiles.filter(profile => profileRouteKey(profile) !== selected)
    .map(profile => ({ ...profile,
      ...(profile.quality === undefined ? {} : { quality: Number((profile.quality * 100).toFixed(6)) }),
    }))
  const next = candidate && Object.keys(candidate).length > 2 ? [...others, candidate] : others
  const json = JSON.stringify(next, null, 2)
  parseModelProfilesJson(json)
  return json
}
