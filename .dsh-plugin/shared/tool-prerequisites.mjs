/**
 * Per-tool prerequisites.
 *
 * Some CLIs cannot start until one or two environment variables are present — dsh-TUI needs its
 * DeepSeek key, a vendor CLI may need a home directory. Rather than teach the executor about each
 * tool, a person declares the variables once in the plugin settings and every run of that tool
 * receives them.
 *
 * What this is not: it never invents values, never reads a secret file, and never widens the
 * whitelist to the whole environment. It names variables; the Host only forwards ones that already
 * exist in its own environment, and a name that does not look like an environment variable is
 * refused instead of silently ignored.
 */

export const MAX_PREREQUISITES_PER_TOOL = 8
const TOOL_ID = /^[a-z][a-z0-9-]{1,47}$/u
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/u

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

/**
 * @param {Record<string, { env?: string[] }>} input
 * @returns {Record<string, string[]>} toolId → variable names, sorted and de-duplicated
 */
export function normalizePrerequisites(input) {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) fail('INVALID_TOOL_PREREQUISITES', '前置设置必须是对象。')
  const result = {}
  for (const [toolId, value] of Object.entries(input)) {
    if (!TOOL_ID.test(toolId)) fail('INVALID_TOOL_PREREQUISITES', `工具 id 不合法：${toolId}`)
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_TOOL_PREREQUISITES', `${toolId} 的前置设置必须是对象。`)
    for (const key of Object.keys(value)) {
      if (key !== 'env') fail('INVALID_TOOL_PREREQUISITES', `${toolId} 不支持字段：${key}`)
    }
    const names = value.env ?? []
    if (!Array.isArray(names)) fail('INVALID_TOOL_PREREQUISITES', `${toolId} 的 env 必须是数组。`)
    if (names.length > MAX_PREREQUISITES_PER_TOOL) fail('INVALID_TOOL_PREREQUISITES', `每个工具最多 ${MAX_PREREQUISITES_PER_TOOL} 个前置变量。`)
    for (const name of names) {
      if (typeof name !== 'string' || !ENV_NAME.test(name)) fail('INVALID_TOOL_PREREQUISITES', `不是合法的环境变量名：${String(name)}`)
    }
    const unique = [...new Set(names)].sort()
    if (unique.length > 0) result[toolId] = unique
  }
  return result
}

/** The extra variable names one tool should receive, from a normalised prerequisite map. */
export function prerequisiteKeysFor(prerequisites, toolId) {
  if (!prerequisites || typeof prerequisites !== 'object') return []
  const names = prerequisites[toolId]
  return Array.isArray(names) ? names : []
}

/**
 * Which declared variables are actually present, and which are missing.
 *
 * A missing prerequisite is reported rather than passed through as undefined: a CLI that starts
 * without its key fails later with a message nobody can act on.
 */
export function resolvePrerequisites(prerequisites, toolId, source = process.env) {
  const names = prerequisiteKeysFor(prerequisites, toolId)
  const env = {}
  const missing = []
  for (const name of names) {
    const value = source?.[name]
    if (typeof value === 'string' && value !== '') env[name] = value
    else missing.push(name)
  }
  return { env, missing }
}
