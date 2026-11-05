/**
 * Bot routing: pick the Bot a task should go to.
 *
 * The model router answers "which model route runs this package". Bot routing answers the same
 * question one level up — "which Bot should own this task" — with the same shape: hard
 * requirements first, then a preset that trades cost against quality, then a deterministic
 * tie-break. Nothing here calls a model or a machine; it only scores committed facts, so a plan
 * can be inspected before anything runs.
 *
 * A candidate is one Bot's committed state:
 *   { botId, enabled, model: { provider, model }, quality, pricePerMTokUsd,
 *     tools: string[], machineOnline, load, busy, capabilities: string[] }
 * Missing facts are treated as unknown, never as "free" or "best".
 */

export const BOT_ROUTING_PRESETS = Object.freeze(['economy', 'balanced', 'quality'])

const fail = code => { const error = new Error(code); error.code = code; throw error }
const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const list = value => (Array.isArray(value) ? value : [])

/** Hard requirements a Bot must satisfy before it is even scored. */
function rejection(candidate, task) {
  if (!candidate || typeof candidate !== 'object') return 'INVALID_CANDIDATE'
  if (candidate.enabled === false) return 'BOT_DISABLED'
  if (!candidate.botId) return 'MISSING_BOT_ID'
  if (!candidate.model?.provider || !candidate.model?.model) return 'BOT_MODEL_UNBOUND'
  if (candidate.routingRefusal) return candidate.routingRefusal
  // A task that names a tool can only go to a Bot whose grant carries it.
  for (const tool of list(task.requiredTools)) {
    const allowed = list(candidate.tools)
    if (!allowed.includes(tool) && !allowed.includes(`tool/${tool}`) && !allowed.includes(`remote/${tool}`)) return `BOT_MISSING_TOOL:${tool}`
  }
  // A task that needs a machine can only go to a Bot whose machine is reachable.
  if (task.requiresMachine === true && candidate.machineOnline !== true) return 'BOT_MACHINE_OFFLINE'
  if (candidate.busy === true && task.allowBusy !== true) return 'BOT_BUSY'
  for (const capability of list(task.requiredCapabilities)) {
    if (!list(candidate.capabilities).includes(capability)) return `BOT_MISSING_CAPABILITY:${capability}`
  }
  return null
}

/**
 * The single answer to "may this Bot take this task at all", or the reason it may not.
 *
 * Every entry point — an automatic pick, a person's pin, a Bot's own request — must ask this same
 * question, so a pin can never reach a Bot the router would have refused.
 *
 * @returns {string|null} null when eligible, otherwise a coded reason.
 */
export const botRejection = (candidate, task = {}) => rejection(candidate, task)

/** Lower is better. Unknown cost sorts after known cost but is never silently free. */
function score(candidate, preset, maxPrice) {
  const price = finite(candidate.pricePerMTokUsd)
  const quality = finite(candidate.quality)
  const load = finite(candidate.load) ?? 0
  // Cost is normalised against the most expensive eligible Bot, so one very expensive route
  // cannot swamp quality evidence: what matters is the ratio within this decision, not dollars.
  // An unknown price is the worst case, never zero.
  const costScore = price === null ? 1 : maxPrice > 0 ? Math.min(1, price / maxPrice) : 0
  // Quality: unknown quality sits in the middle so it can still win on price in economy.
  const qualityScore = quality === null ? 0.5 : quality
  const weighted = preset === 'economy'
    ? costScore * 0.8 + (1 - qualityScore) * 0.15 + load * 0.05
    : preset === 'quality'
      ? (1 - qualityScore) * 0.8 + costScore * 0.15 + load * 0.05
      : costScore * 0.45 + (1 - qualityScore) * 0.45 + load * 0.1
  return Number(weighted.toFixed(6))
}

/**
 * @param {{
 *   task: { requiredTools?: string[], requiredCapabilities?: string[], requiresMachine?: boolean, allowBusy?: boolean },
 *   candidates: Array<object>,
 *   preset?: 'economy'|'balanced'|'quality',
 *   limit?: number,
 * }} request
 */
export function routeBot({ task = {}, candidates = [], preset = 'balanced', limit = 8 } = {}) {
  if (!BOT_ROUTING_PRESETS.includes(preset)) fail('INVALID_BOT_ROUTING_PRESET')
  if (!Array.isArray(candidates)) fail('INVALID_BOT_CANDIDATES')
  const rejected = []
  const eligible = []
  for (const candidate of candidates) {
    const reason = rejection(candidate, task)
    if (reason) { rejected.push({ botId: candidate?.botId ?? null, reason }); continue }
    eligible.push(candidate)
  }
  const maxPrice = eligible.reduce((max, candidate) => Math.max(max, finite(candidate.pricePerMTokUsd) ?? 0), 0)
  const scored = []
  for (const candidate of eligible) {
    scored.push({ botId: candidate.botId, score: score(candidate, preset, maxPrice), model: candidate.model,
      pricePerMTokUsd: finite(candidate.pricePerMTokUsd), quality: finite(candidate.quality) })
  }
  scored.sort((left, right) => left.score - right.score || String(left.botId).localeCompare(String(right.botId)))
  const ranked = scored.slice(0, Math.max(1, limit))
  return {
    preset,
    chosen: ranked[0] ?? null,
    ranked,
    rejected,
    // An empty result is a fact about the candidates, not a routing failure to hide.
    reason: ranked.length > 0 ? 'BOT_ROUTED' : rejected.length > 0 ? 'NO_BOT_ELIGIBLE' : 'NO_BOT_CANDIDATES',
  }
}
