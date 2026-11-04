/**
 * Hand a task to the Bot that should own it.
 *
 * Both entry points — the Main Bot deciding after a message (mode A), and a person choosing
 * "自动路由" in the workbench (mode B) — end here, so the decision and the permission grant can
 * never disagree.
 *
 * Order matters and is deliberate:
 *  1. read the candidates from committed state (never from the caller),
 *  2. refuse when routing is off or no Bot is eligible,
 *  3. grant the worker exactly what the task touches (a committed binding, not a widening),
 *  4. only then return the task to run.
 *
 * The Main Bot keeps its own access; it is never narrowed by routing.
 */

import { routeBot } from './bot-routing.mjs'
import { normalizeBotRouting, workerBinding, mainBotKeepsFullAccess } from './bot-routing-mode.mjs'

const fail = code => { const error = new Error(code); error.code = code; throw error }

/**
 * @param {{
 *   routing: object,
 *   mainBotIds?: string[],
 *   requesterBotId?: string,
 *   task: { text?: string, requiredTools?: string[], requiresMachine?: boolean, machineId?: string, needs?: object },
 *   candidatesFor: (task: object) => Array<object> | Promise<Array<object>>,
 *   bindWorker?: (binding: object) => Promise<unknown> | unknown,
 *   pinnedBotId?: string,
 * }} request
 */
export async function routeTaskToBot({
  routing, mainBotIds = [], requesterBotId = '', task = {}, candidatesFor, bindWorker = null, pinnedBotId = '',
} = {}) {
  if (typeof candidatesFor !== 'function') fail('ROUTING_REQUIRES_CANDIDATES')
  const settings = normalizeBotRouting(routing)
  if (settings.enabled !== true) fail('BOT_ROUTING_DISABLED')
  if (typeof task.text !== 'string' || task.text.trim() === '') fail('ROUTING_REQUIRES_TASK')

  const focus = { ...task, requiredTools: Array.isArray(task.requiredTools) ? task.requiredTools : [] }
  const eligible = await candidatesFor(focus)
  if (!Array.isArray(eligible)) fail('ROUTING_CANDIDATES_INVALID')

  // A person may pin a Bot; the pin is still checked against the same hard requirements.
  if (typeof pinnedBotId === 'string' && pinnedBotId !== '') {
    const pinned = eligible.find(candidate => candidate?.botId === pinnedBotId)
    if (!pinned) {
      const refusal = routeBot({ task: focus, candidates: eligible, preset: settings.preset })
      fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}${refusal.rejected.find(row => row.botId === pinnedBotId)?.reason ? `:${refusal.rejected.find(row => row.botId === pinnedBotId).reason}` : ''}`)
    }
    return { botId: pinned.botId, preset: settings.preset, pinned: true, binding: null, decision: { chosen: { botId: pinned.botId }, ranked: [], rejected: [], reason: 'PINNED' } }
  }

  const decision = routeBot({ task: focus, candidates: eligible, preset: settings.preset })
  if (!decision.chosen) fail(`BOT_ROUTING_NO_ELIGIBLE:${decision.rejected.map(row => row.reason).join(',') || 'none'}`)

  const chosen = eligible.find(candidate => candidate.botId === decision.chosen.botId)
  // The Main Bot already holds everything: routing must not re-grant or narrow it.
  if (mainBotKeepsFullAccess(decision.chosen.botId, mainBotIds)) {
    return { botId: decision.chosen.botId, preset: settings.preset, pinned: false, binding: null, decision, mainBot: true }
  }
  if (decision.chosen.botId === requesterBotId) {
    return { botId: decision.chosen.botId, preset: settings.preset, pinned: false, binding: null, decision, sameBot: true }
  }

  // A machine task needs the worker to actually reach that machine.
  if (task.requiresMachine === true) {
    const binding = workerBinding({
      botId: decision.chosen.botId,
      machineId: typeof task.machineId === 'string' ? task.machineId : chosen?.machine?.machineId ?? '',
      ceiling: Array.isArray(chosen?.machine?.ceiling) ? chosen.machine.ceiling : [],
      needs: task.needs ?? {},
    })
    if (!binding) fail('BOT_ROUTING_WORKER_CANNOT_REACH_MACHINE')
    if (settings.autoGrant.machineTools === true && typeof bindWorker === 'function') await bindWorker(binding)
    return { botId: decision.chosen.botId, preset: settings.preset, pinned: false, binding, decision, granted: settings.autoGrant.machineTools === true }
  }

  return { botId: decision.chosen.botId, preset: settings.preset, pinned: false, binding: null, decision }
}

/**
 * The plan a routed task becomes.
 *
 * One package, one target Bot, no dependencies: Bot routing decides *who*, and this turns that
 * decision into something the task service can accept. The acceptance list stays empty on purpose —
 * the caller supplies it when it knows what "done" means, and an invented check would pass itself.
 */
export function buildRoutedPlan({ decision, text, taskId, requesterBotId = '', acceptance = [], effectClass = 'read', packageId = 'p1' }) {
  if (!decision || typeof decision !== 'object' || !decision.chosen?.botId) fail('ROUTING_DECISION_REQUIRED')
  if (typeof text !== 'string' || text.trim() === '') fail('ROUTING_REQUIRES_TASK')
  if (typeof taskId !== 'string' || taskId === '') fail('ROUTING_REQUIRES_TASK_ID')
  if (!['read', 'workspace-write'].includes(effectClass)) fail('ROUTING_INVALID_EFFECT_CLASS')
  return {
    schemaVersion: 1,
    taskId,
    origin: { kind: 'private', botId: requesterBotId === '' ? decision.chosen.botId : requesterBotId, sessionId: null },
    planRevision: 1,
    packages: [{
      id: packageId,
      targetBotId: decision.chosen.botId,
      objective: text.trim(),
      dependsOn: [],
      acceptance: Array.isArray(acceptance) ? acceptance : [],
      effectClass,
    }],
  }
}
