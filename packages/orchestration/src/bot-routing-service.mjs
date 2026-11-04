/**
 * The Bot-routing service the workbench and the Main Bot both call.
 *
 * It answers one question — "who should take this task, and why" — and it answers it from committed
 * state only. Nothing here sends a message, binds a machine or spends money: a preview is a
 * preview, and the same decision object is what a real dispatch later acts on.
 */

import { botRoutingCandidates } from './bot-routing-candidates.mjs'
import { routeBot } from './bot-routing.mjs'
import { normalizeBotRouting, workerBinding } from './bot-routing-mode.mjs'

const fail = code => { const error = new Error(code); error.code = code; throw error }

export function createBotRoutingService({ bots, settingsFor, machineHealth, priceFor, qualityFor, loadFor, busyFor, routing }) {
  if (typeof bots !== 'function') fail('BOT_ROUTING_REQUIRES_BOTS')
  if (typeof settingsFor !== 'function') fail('BOT_ROUTING_REQUIRES_SETTINGS')

  const readSettings = () => normalizeBotRouting(typeof routing === 'function' ? routing() : routing)

  const candidates = () => botRoutingCandidates({
    bots: bots(),
    settingsFor,
    machineHealth: machineHealth ?? (() => null),
    priceFor: priceFor ?? (() => null),
    qualityFor: qualityFor ?? (() => null),
    loadFor: loadFor ?? (() => null),
    busyFor: busyFor ?? (() => false),
  })

  return Object.freeze({
    settings: readSettings,

    /** Every candidate with the facts the router would score, for a table in the UI. */
    inspect() {
      const settings = readSettings()
      const rows = candidates().map(candidate => ({
        botId: candidate.botId,
        name: candidate.name,
        main: candidate.main,
        model: candidate.model,
        tools: candidate.tools,
        machineId: candidate.machine?.machineId ?? null,
        machineOnline: candidate.machineOnline,
        pricePerMTokUsd: candidate.pricePerMTokUsd,
        quality: candidate.quality,
        busy: candidate.busy,
      }))
      return { enabled: settings.enabled, preset: settings.preset, autoGrant: settings.autoGrant, candidates: rows }
    },

    /**
     * Decide for one task. A pinned Bot is honoured but still checked, and the whole decision is
     * returned so the workbench can show the losers and their reasons.
     */
    decide({ text, requiredTools = [], requiresMachine = false, machineId = '', needs = {}, pinnedBotId = '', requesterBotId = '' } = {}) {
      if (typeof text !== 'string' || text.trim() === '') fail('BOT_ROUTING_REQUIRES_TASK')
      const settings = readSettings()
      if (settings.enabled !== true) fail('BOT_ROUTING_DISABLED')
      // A Bot's own policy wins for the work it hands out; the global preset is the fallback.
      let preset = settings.preset
      if (typeof requesterBotId === 'string' && requesterBotId !== '') {
        try { preset = settingsFor(requesterBotId)?.routing?.preset ?? preset } catch { /* keep the global preset */ }
      }
      const all = candidates()
      const task = { requiredTools, requiresMachine }
      if (typeof pinnedBotId === 'string' && pinnedBotId !== '') {
        const pinned = all.find(candidate => candidate.botId === pinnedBotId)
        if (!pinned) fail(`BOT_ROUTING_PINNED_UNKNOWN:${pinnedBotId}`)
        const probe = routeBot({ task, candidates: [pinned], preset })
        if (!probe.chosen) fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}:${probe.rejected[0]?.reason ?? 'UNKNOWN'}`)
        return { chosen: { botId: pinned.botId, name: pinned.name }, preset, pinned: true, binding: bindingFor(pinned, task, machineId, needs, settings), ranked: [], rejected: [] }
      }
      const decision = routeBot({ task, candidates: all, preset })
      const chosen = decision.chosen ? all.find(candidate => candidate.botId === decision.chosen.botId) : null
      return {
        chosen: decision.chosen ? { botId: decision.chosen.botId, name: chosen?.name ?? decision.chosen.botId, score: decision.chosen.score } : null,
        preset,
        pinned: false,
        ranked: decision.ranked,
        rejected: decision.rejected,
        reason: decision.reason,
        binding: chosen ? bindingFor(chosen, task, machineId, needs, settings) : null,
      }
    },
  })
}

/** What the chosen Bot would need before it could do this work; null when nothing is needed. */
function bindingFor(candidate, task, machineId, needs, settings) {
  if (task.requiresMachine !== true) return null
  if (settings.autoGrant.machineTools !== true) return null
  const target = typeof machineId === 'string' && machineId !== '' ? machineId : candidate.machine?.machineId ?? ''
  if (!target) return null
  return workerBinding({ botId: candidate.botId, machineId: target, ceiling: candidate.machine?.ceiling ?? [], needs })
}
