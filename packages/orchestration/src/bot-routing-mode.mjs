/**
 * Bot routing mode.
 *
 * One switch decides whether a message that reaches the Main Bot may be handed to another Bot.
 * When it is on, three things must stay true:
 *
 *  - the Main Bot keeps every permission it already had (it is the operator's own assistant);
 *  - a worker Bot that is handed machine work gets exactly the machine tools that work needs,
 *    recorded as a committed binding — never a temporary widening;
 *  - a Bot that is not eligible is refused with a reason, instead of receiving work it cannot do.
 *
 * This module owns the policy and the binding it produces; the routing decision itself lives in
 * bot-routing.mjs, and the Host applies the binding.
 */

export const BOT_ROUTING_DEFAULTS = Object.freeze({
  enabled: false,
  preset: 'balanced',
  autoGrant: Object.freeze({ machineTools: true, cliTools: false }),
})

/** Tools a worker needs to actually use a machine, in the order they are granted. */
export const MACHINE_WORKER_TOOLS = Object.freeze([
  'machine_ping', 'fs_list', 'fs_read', 'fs_write', 'shell_exec',
  'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read',
])

export const MACHINE_DESKTOP_TOOLS = Object.freeze([
  'desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll',
])

const fail = code => { const error = new Error(code); error.code = code; throw error }
const isPlain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Read the switch from configuration. Unknown keys are refused: a typo must not silently
 * disable (or enable) something this consequential.
 */
export function normalizeBotRouting(value) {
  if (value === undefined || value === null) return { ...BOT_ROUTING_DEFAULTS, autoGrant: { ...BOT_ROUTING_DEFAULTS.autoGrant } }
  if (!isPlain(value)) fail('INVALID_BOT_ROUTING')
  for (const key of Object.keys(value)) if (!['enabled', 'preset', 'autoGrant'].includes(key)) fail(`INVALID_BOT_ROUTING:${key}`)
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') fail('INVALID_BOT_ROUTING:enabled')
  if (value.preset !== undefined && !['economy', 'balanced', 'quality'].includes(value.preset)) fail('INVALID_BOT_ROUTING:preset')
  const autoGrant = value.autoGrant === undefined ? { ...BOT_ROUTING_DEFAULTS.autoGrant } : value.autoGrant
  if (!isPlain(autoGrant)) fail('INVALID_BOT_ROUTING:autoGrant')
  for (const key of Object.keys(autoGrant)) if (!['machineTools', 'cliTools'].includes(key)) fail(`INVALID_BOT_ROUTING:autoGrant.${key}`)
  for (const key of ['machineTools', 'cliTools']) {
    if (autoGrant[key] !== undefined && typeof autoGrant[key] !== 'boolean') fail(`INVALID_BOT_ROUTING:autoGrant.${key}`)
  }
  return {
    enabled: value.enabled ?? BOT_ROUTING_DEFAULTS.enabled,
    preset: value.preset ?? BOT_ROUTING_DEFAULTS.preset,
    autoGrant: {
      machineTools: autoGrant.machineTools ?? BOT_ROUTING_DEFAULTS.autoGrant.machineTools,
      cliTools: autoGrant.cliTools ?? BOT_ROUTING_DEFAULTS.autoGrant.cliTools,
    },
  }
}

/**
 * The binding a worker Bot needs for the work it was handed.
 *
 * `needs` names what the task actually touches; the result is the smallest binding that covers it,
 * so a read-only job does not receive `shell_exec` just because the machine could offer it.
 *
 * @param {{ botId: string, machineId: string, ceiling: string[], needs?: { desktop?: boolean, shell?: boolean, write?: boolean } }} request
 * @returns {{ machineId: string, botId: string, tools: string[], mode: 'read-only'|'workspace-write' } | null}
 */
export function workerBinding({ botId, machineId, ceiling = [], needs = {} } = {}) {
  if (typeof botId !== 'string' || !botId) fail('INVALID_WORKER_BOT')
  if (typeof machineId !== 'string' || !machineId) fail('INVALID_WORKER_MACHINE')
  const offered = new Set(Array.isArray(ceiling) ? ceiling : [])
  const wanted = ['machine_ping', 'fs_list', 'fs_read']
  if (needs.write === true) wanted.push('fs_write')
  if (needs.shell === true) wanted.push('shell_exec')
  wanted.push('operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read')
  if (needs.desktop === true) wanted.push(...MACHINE_DESKTOP_TOOLS)
  const tools = wanted.filter(tool => offered.has(tool))
  // Without a read tool the binding would be decorative: refuse instead of granting nothing.
  if (!tools.includes('fs_read') && !tools.includes('machine_ping')) return null
  // Desktop work needs a writable binding: the compiler only grants desktop tools in that mode.
  const mode = needs.desktop === true || needs.write === true || needs.shell === true ? 'workspace-write' : 'read-only'
  return { machineId, botId, tools: [...new Set(tools)], mode }
}

/** The Main Bot keeps its own binding untouched; this only reports whether it needs one. */
export function mainBotKeepsFullAccess(botId, mainBotIds = []) {
  return Array.isArray(mainBotIds) && mainBotIds.includes(botId)
}
