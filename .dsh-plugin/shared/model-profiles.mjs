/**
 * Optional, user supplied information for exact routes in the Harness model
 * directory. Harness does not publish prices or comparative quality scores.
 * This file never accepts credentials, endpoints, packages or shell commands.
 */
import { toolForProvider } from './official-tool-registry.mjs'
const MAX_TEXT = 32_000
const MAX_PROFILES = 200
const id = value => typeof value === 'string' ? value.trim() : ''

function nonnegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${label} 必须是 0 到 1000000 之间的有限数字`)
  }
  return value
}

function normalizeProfile(entry, index) {
  const label = `第 ${index + 1} 个模型`
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label} 必须是对象`)
  const allowed = new Set(['provider', 'model', 'quality', 'pricing', 'specialties', 'cliModel', 'execution'])
  const unknown = Object.keys(entry).find(key => !allowed.has(key))
  if (unknown) throw new Error(`${label} 含不支持的字段 ${unknown}；不要在这里填写密钥或命令`)
  const provider = id(entry.provider)
  const model = id(entry.model)
  if (!provider || !model || provider.length > 160 || model.length > 240) {
    throw new Error(`${label} 需要模型目录中的准确 provider 和 model`)
  }
  const profile = { provider, model }
  if (entry.quality !== undefined) {
    const value = nonnegative(entry.quality, `${label} 的 quality`)
    if (value > 100) throw new Error(`${label} 的 quality 应在 0 到 100 之间`)
    profile.quality = value / 100
  }
  if (entry.pricing !== undefined) {
    const prices = entry.pricing
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) throw new Error(`${label} 的 pricing 必须是对象`)
    const priceFields = new Set(['input', 'output', 'cacheRead', 'cacheWrite', 'currency'])
    const unknownPrice = Object.keys(prices).find(key => !priceFields.has(key))
    if (unknownPrice) throw new Error(`${label} 的 pricing 含不支持的字段 ${unknownPrice}`)
    if (prices.currency !== undefined && prices.currency !== 'USD') throw new Error(`${label} 的价格币种目前仅支持 USD`)
    profile.pricing = {
      input: nonnegative(prices.input, `${label} 的输入单价`),
      output: nonnegative(prices.output, `${label} 的输出单价`),
      currency: 'USD',
    }
    if (prices.cacheRead !== undefined) profile.pricing.cacheRead = nonnegative(prices.cacheRead, `${label} 的缓存读取单价`)
    if (prices.cacheWrite !== undefined) profile.pricing.cacheWrite = nonnegative(prices.cacheWrite, `${label} 的缓存写入单价`)
  }
  if (entry.specialties !== undefined) {
    if (!Array.isArray(entry.specialties) || entry.specialties.length > 16
      || entry.specialties.some(value => !/^[a-z][a-z0-9-]{0,39}$/.test(value))) {
      throw new Error(`${label} 的 specialties 必须是至多 16 个英文任务标签`)
    }
    profile.specialties = [...new Set(entry.specialties)]
  }
  if (entry.cliModel !== undefined) {
    const cliModel = id(entry.cliModel)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(cliModel)) throw new Error(`${label} 的 cliModel 无效`)
    if (toolForProvider(provider)?.id === 'zcode') throw new Error(`${label} 对应的 ZCode CLI 暂不支持逐次切换模型`)
    profile.cliModel = cliModel
  }
  if (entry.execution !== undefined) {
    if (entry.execution !== 'auto' && entry.execution !== 'official' && entry.execution !== 'api') {
      throw new Error(`${label} 的 execution 只能是 auto、official 或 api`)
    }
    if (entry.execution !== 'auto') profile.execution = entry.execution
  }
  if (Object.keys(profile).length === 2) throw new Error(`${label} 至少提供 quality、pricing、specialties、cliModel 或 execution 之一`)
  return profile
}

/** `auto` is the default and is not stored. `official` and `api` are explicit. */
export function normalizeExecutionPreference(value) {
  if (value === undefined || value === null || value === '' || value === 'auto') return 'auto'
  if (value === 'official' || value === 'api') return value
  throw new TypeError('execution must be auto, official, or api')
}

/** Parse a settings field; an empty value intentionally means no overrides. */
export function parseModelProfilesJson(value) {
  const source = value == null || value === '' ? '[]' : value
  if (typeof source !== 'string' || source.length > MAX_TEXT) throw new Error('模型价格与能力配置超过 32000 字符上限')
  let input
  try { input = JSON.parse(source) } catch { throw new Error('模型价格与能力配置不是有效的 JSON') }
  if (!Array.isArray(input) || input.length > MAX_PROFILES) throw new Error('模型价格与能力配置必须是最多 200 项的 JSON 数组')
  const profiles = input.map(normalizeProfile)
  const seen = new Set()
  for (const profile of profiles) {
    const key = `${profile.provider}\0${profile.model}`
    if (seen.has(key)) throw new Error(`模型 ${profile.provider}/${profile.model} 重复配置`)
    seen.add(key)
  }
  return profiles
}

/** Apply metadata only to exact routes actually returned by Harness. */
export function applyModelProfiles(routes, profiles) {
  const input = Array.isArray(routes) ? routes : []
  const values = typeof profiles === 'string' ? parseModelProfilesJson(profiles) : profiles
  if (!Array.isArray(values)) throw new Error('模型配置必须是数组')
  const byKey = new Map(values.map(profile => [`${profile.provider}\0${profile.model}`, profile]))
  return input.map(route => {
    const profile = byKey.get(`${route.provider}\0${route.model}`)
    if (!profile) return route
    return {
      ...route,
      ...(profile.quality === undefined ? {} : { quality: profile.quality, qualitySource: 'user' }),
      ...(profile.pricing === undefined ? {} : { pricing: { ...profile.pricing }, pricingSource: 'user' }),
      ...(profile.specialties === undefined ? {} : { specialties: [...profile.specialties] }),
      ...(profile.cliModel === undefined ? {} : { cliModel: profile.cliModel }),
      ...(profile.execution === undefined ? {} : { execution: profile.execution }),
    }
  })
}
