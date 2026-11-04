/**
 * Candidates for Bot routing, read from committed state.
 *
 * The router scores facts, so this module's whole job is to turn committed state into those
 * facts without inventing any: a Bot with no price is `null` (unknown), a machine that was never
 * seen is offline, and a Bot that is not enabled never becomes a candidate at all.
 *
 * Everything is injected — bots, their saved settings, machine health — so the same function runs
 * in the Host and in a test without a database or a live machine.
 */

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const list = value => (Array.isArray(value) ? value : [])

/** Tools a Bot may actually use, from its compiled grant rather than from its own claims. */
const toolsOf = settings => list(settings?.grant?.tools ?? settings?.tools)

/**
 * @param {{
 *   bots: Array<{ id: string, name?: string, model?: object, main?: boolean }>,
 *   settingsFor: (botId: string) => { enabled?: boolean, model?: object, grant?: { tools?: string[] }, capabilities?: string[], machineGrants?: Array<object> } | null,
 *   machineHealth?: (machineId: string) => { online?: boolean } | null,
 *   qualityFor?: (botId: string) => number | null,
 *   priceFor?: (route: { provider: string, model: string }) => number | null,
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
    if (!settings || settings.enabled === false) continue
    const model = settings.model ?? bot.model ?? null
    const price = model ? priceFor(model) : null
    // A machine grant names the machine and the tools that machine offers this Bot.
    const grant = list(settings.machineGrants)[0] ?? null
    const machineId = grant?.machineId ?? null
    const health = machineId ? machineHealth(machineId) : null
    candidates.push({
      botId: bot.id,
      name: typeof bot.name === 'string' ? bot.name : bot.id,
      main: bot.main === true,
      enabled: true,
      model: model ? { provider: model.provider, model: model.model } : null,
      // Unknown price and unknown quality stay null: the router treats them as unknown, not as
      // zero or best, and never as "free".
      pricePerMTokUsd: finite(price),
      quality: finite(qualityFor(bot.id)),
      load: finite(loadFor(bot.id)) ?? 0,
      busy: busyFor(bot.id) === true,
      tools: toolsOf(settings),
      capabilities: list(settings.capabilities),
      machineOnline: health?.online === true,
      machine: machineId ? { machineId, ceiling: list(grant?.capabilities) } : null,
    })
  }
  return candidates
}
