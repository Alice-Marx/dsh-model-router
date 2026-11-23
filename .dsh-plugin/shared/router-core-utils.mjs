import { applyModelProfiles, parseModelProfilesJson } from './model-profiles.mjs'

export const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export function jsonValue(value) {
  return JSON.parse(JSON.stringify(value))
}

export function valueOf(config, key, fallback) {
  const value = config?.[key]
  return value !== undefined && typeof value?.get === 'function' ? value.get() : value ?? fallback
}

export function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function boundedInteger(value, fallback, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.floor(finiteNumber(value, fallback))))
}

export function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function errorText(error) {
  if (error instanceof Error && error.message) return error.message
  try { return String(error) } catch { return 'unknown error' }
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('operation aborted')
}

export function routeKey(route) {
  return `${route.provider}\u0000${route.model}`
}

export function configuredRoutesWithProfiles(routes, config) {
  const profiles = parseModelProfilesJson(valueOf(config, 'modelProfilesJson', '[]'))
  return applyModelProfiles(routes, profiles)
}

export function uniqueStrings(values) {
  return [...new Set(values.map(text).filter(Boolean))]
}