/**
 * Candidates for Bot routing, read from committed state.
 *
 * The router scores facts, so this module's whole job is to turn committed state into those
 * facts without inventing any: a Bot with no price is `null` (unknown), a machine that was never
 * seen is offline, and a Bot that is not enabled never becomes a candidate at all.
 *
 * A candidate carries every machine grant it holds (`machineGrants`), because the ceiling is per
 * machine: `candidateMachineGrant` is the only way a caller may read one, and an unnamed machine
 * resolves to the Bot's own first grant rather than to a guess.
 *
 * Quality is a fraction between 0 and 1. Everything is injected — bots, their saved settings,
 * machine health — so the same function runs in the Host and in a test without a database or a live machine.
 */

import { workerBinding } from './bot-routing-mode.mjs'

const finite = (value, max = Infinity) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null)
const list = value => (Array.isArray(value) ? value : [])

/** Tools a Bot may actually use, from its compiled grant rather than from its own claims. */
const toolsOf = settings => list(settings?.grant?.tools ?? settings?.tools)
const facade = tool => ({ machine_ping: 'remote_computer_ping', fs_list: 'remote_computer_list', fs_read: 'remote_computer_read', fs_write: 'remote_computer_write', container_command_v1: 'remote_computer_command' })[tool]
  ?? (tool.startsWith('desktop_') ? 'remote_computer_desktop' : tool.startsWith('browser_') ? 'remote_computer_browser' : ['operation_status', 'operation_cancel'].includes(tool) ? 'remote_computer_operation' : null)

/**
 * Score the fact the task is actually about.
 *
 * A Bot may hold grants for several machines, so "is its machine online" only means something once
 * the task says which machine. Without this the router would refuse a Bot whose named machine is
 * reachable because a different grant of the same Bot is offline.
 *
 * @param {Array<object>} candidates
 * @param {{ machineId?: string }} task
 */
export function withMachineFact(candidates, task = {}) {
  const asked = typeof task?.machineId === 'string' ? task.machineId.trim() : ''
  return candidates.map(candidate => {
    if (task.requiresMachine !== true && asked === '') return candidate
    const grant = candidateMachineGrant(candidate, asked, task.rootId)
    return { ...candidate,
      machineOnline: grant ? (typeof candidate.machineOnlineFor === 'function' ? candidate.machineOnlineFor(grant.machineId) === true : candidate.machineOnline === true) : false,
      routingRefusal: task.requiresMachine === true && grant && !workerBinding({ botId: candidate.botId, ...grant, needs: task.needs ?? {} }) ? 'BOT_ROUTING_WORKER_CEILING_INSUFFICIENT' : null,
      // Pending tools remain bounded by the exact saved machine/root ceiling. This lets a Main
      // Bot prepare a worker binding without treating an arbitrary tool name as authority.
      tools: [...new Set([...list(candidate.tools), ...list(grant?.ceiling).flatMap(tool => [tool, `remote/${tool}`, ...(facade(tool) ? [facade(tool), `tool/${facade(tool)}`] : [])])])],
    }
  })
}

/**
 * Every machine this Bot holds a committed grant for, with the ceiling that grant offers.
 *
 * A Bot may hold several grants, and the ceiling is per machine: taking only the first one meant a
 * task aimed at the second machine was granted the first machine's tools, or a machine the Bot was
 * never granted at all.
 */
const machineGrantsOf = settings => list(settings?.machineGrants)
  .map(grant => ({ machineId: typeof grant?.machineId === 'string' && grant.machineId !== '' ? grant.machineId : null, ceiling: list(grant?.capabilities),
    ...(typeof grant?.rootId === 'string' && grant.rootId !== '' ? { rootId: grant.rootId } : {}),
    ...(['read-only', 'workspace-write'].includes(grant?.mode) ? { mode: grant.mode } : {}) }))
  .filter(grant => grant.machineId !== null)
  .sort((left, right) => {
    const preferred = grant => grant.machineId === settings?.workspaceRef?.machineId && grant.rootId === settings?.workspaceRef?.rootId ? 0 : 1
    return preferred(left) - preferred(right) || `${left.machineId}/${left.rootId ?? ''}`.localeCompare(`${right.machineId}/${right.rootId ?? ''}`)
  })

/**
 * The committed grant for one machine, or null when this Bot holds none for it.
 *
 * `machineId` empty means "the Bot's own first grant", which is what a task that does not name a
 * machine gets. The ceiling always comes from committed state; a caller can never widen it.
 *
 * @param {object} candidate
 * @param {string} [machineId]
 * @returns {{ machineId: string, ceiling: string[] } | null}
 */
export function candidateMachineGrant(candidate, machineId = '', rootId = '') {
  // `machine` is the same first grant in its legacy single shape; a hand-built candidate that
  // carries only it still resolves, so no caller has to know which shape the Host used.
  const grants = list(candidate?.machineGrants).length > 0 || !candidate?.machine?.machineId
    ? list(candidate?.machineGrants)
    : [candidate.machine]
  const copy = grant => ({ machineId: grant.machineId, ceiling: list(grant.ceiling), ...(grant.rootId ? { rootId: grant.rootId } : {}), ...(grant.mode ? { mode: grant.mode } : {}) })
  if (typeof machineId === 'string' && machineId !== '') {
    const named = grants.find(grant => grant?.machineId === machineId && (!rootId || grant.rootId === rootId))
    return named ? copy(named) : null
  }
  const first = rootId ? grants.find(grant => grant.rootId === rootId) : grants[0]
  return first ? copy(first) : null
}

/**
 * @param {{
 *   bots: Array<{ id: string, name?: string, model?: object, main?: boolean }>,
 *   settingsFor: (botId: string) => { enabled?: boolean, model?: object, grant?: { tools?: string[] }, capabilities?: string[], machineGrants?: Array<object> } | null,
 *   machineHealth?: (machineId: string) => { online?: boolean } | null,
 *   qualityFor?: (botId: string) => number | null,
 *   priceFor?: (route: { provider: string, model: string }, botId: string) => number | null,
 *   loadFor?: (botId: string) => number | null,
 *   busyFor?: (botId: string) => boolean,
 * }} source
 */
export function botRoutingCandidates({ bots = [], settingsFor, machineHealth = () => null, qualityFor = () => null, priceFor = () => null, loadFor = () => null, busyFor = () => false } = {}) {
  if (typeof settingsFor !== 'function') throw new TypeError('BOT_ROUTING_SETTINGS_REQUIRED')
  const candidates = []
  for (const bot of list(bots)) {
    if (!bot || typeof bot.id !== 'string' || !bot.id) continue
    const settings = settingsFor(bot.id)
    // A Bot that is off is not a candidate; it stays out rather than scoring last.
    if (!settings || settings.enabled === false || settings.status && settings.status !== 'available') continue
    const model = settings.model ?? bot.model ?? null
    const price = model ? priceFor(model, bot.id) : null
    // Machine grants name the machine and the tools that machine offers this Bot. Reachability is
    // asked per machine, so a Bot with two grants reports the one the task is about.
    const machineGrants = machineGrantsOf(settings)
    const reachable = machineId => machineGrants.some(grant => grant.machineId === machineId) && machineHealth(machineId)?.online === true
    const primary = machineGrants[0] ?? null
    candidates.push({
      botId: bot.id,
      name: typeof bot.name === 'string' ? bot.name : bot.id,
      main: bot.main === true,
      enabled: true,
      model: model ? { provider: model.provider, model: model.model } : null,
      // Unknown price and unknown quality stay null: the router treats them as unknown, not as
      // zero or best, and never as "free".
      pricePerMTokUsd: finite(price),
      quality: finite(qualityFor(bot.id), 1),
      load: finite(loadFor(bot.id)) ?? 0,
      busy: busyFor(bot.id) === true,
      tools: toolsOf(settings),
      capabilities: list(settings.capabilities),
      machineGrants,
      machineOnline: primary ? reachable(primary.machineId) : false,
      machine: primary ? { ...primary } : null,
      machineOnlineFor: reachable,
    })
  }
  return candidates
}
