/**
 * The Bot-routing service the workbench and the Main Bot both call.
 *
 * It answers two questions and keeps them apart:
 *
 *  - `inspect` / `decide` — "who should take this task, and why". A preview. It reads committed
 *    state, scores it and returns the whole decision, including the binding the worker would need.
 *    It dispatches nothing, binds nothing and spends nothing.
 *  - `dispatch` — the same decision carried through to a real task. It only exists when the Host
 *    injected the plan submission and the subject directory, so a service that cannot dispatch
 *    refuses instead of pretending.
 *
 * Nothing here sends a message, binds a machine or spends money on its own: the same decision
 * object is what a real dispatch later acts on, so a preview and a dispatch can never disagree.
 */

import { botRoutingCandidates, candidateMachineGrant, withMachineFact } from './bot-routing-candidates.mjs'
import { routeBot } from './bot-routing.mjs'
import { normalizeBotRouting, workerBinding } from './bot-routing-mode.mjs'
import { assertPlanAccepted, dispatchRoutedTask, pinnedMachineRefusal, workerGrantFact, routedEffectClass } from './bot-routing-dispatch.mjs'
import { canonicalTaskJson, taskRef } from './task-contract.mjs'
import { createHash } from 'node:crypto'
const fail = code => { const error = new Error(code); error.code = code; throw error }
const submittedPlanId = (originBotId, requestKey) => `route_${createHash('sha256').update(`${originBotId}:${requestKey}`).digest('hex').slice(0, 48)}`

/**
 * @param {{
 *   bots: () => Array<object>,
 *   settingsFor: (botId: string) => object | null,
 *   machineHealth?: (machineId: string) => { online?: boolean } | null,
 *   priceFor?: (route: object, botId: string) => number | null,
 *   qualityFor?: (botId: string) => number | null,
 *   loadFor?: (botId: string) => number | null,
 *   busyFor?: (botId: string) => boolean,
 *   routing?: object | (() => object),
 *   mainBotIds?: string[] | (() => string[]),
 *   submitPlan?: (subject: unknown, request: object, caller?: object) => Promise<unknown> | unknown,
 *   subjectFor?: (botId: string) => unknown,
 *   bindWorker?: (binding: object) => Promise<unknown> | unknown,
 *   newTaskId?: () => string,
 *   readSubmittedPlan?: (originBotId: string, planId: string) => object | Promise<object>,
 * }} source
 */
export function createBotRoutingService({ bots, settingsFor, machineHealth, priceFor, qualityFor, loadFor, busyFor, routing, mainBotIds = [], submitPlan = null, subjectFor = null, bindWorker = null, newTaskId = null, readSubmittedPlan = null, executionBackendFor = null, settle = null, deliver = null, onAccepted = null }) {
  if (typeof bots !== 'function') fail('BOT_ROUTING_REQUIRES_BOTS')
  if (typeof settingsFor !== 'function') fail('BOT_ROUTING_REQUIRES_SETTINGS')

  const readSettings = () => normalizeBotRouting(typeof routing === 'function' ? routing() : routing)
  // The Main Bot is the operator's own assistant: routing must never re-grant or narrow it.
  const readMainBotIds = () => (typeof mainBotIds === 'function' ? mainBotIds() : mainBotIds) ?? []
  // DS Bot persists its roster as an id-keyed object; tests/workbench providers may use a list.
  const readBots = () => {
    const roster = bots()
    return (Array.isArray(roster) ? roster : roster && typeof roster === 'object' ? Object.values(roster) : [])
      .map(bot => ({ ...bot, main: bot?.main === true || readMainBotIds().includes(bot?.id) }))
  }

  const candidates = () => botRoutingCandidates({
    bots: readBots(),
    settingsFor,
    machineHealth: machineHealth ?? (() => null),
    priceFor: priceFor ?? (() => null),
    qualityFor: qualityFor ?? (() => null),
    loadFor: loadFor ?? (() => null),
    busyFor: busyFor ?? (() => false),
  })

  const service = {
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
        machineIds: candidate.machineGrants.map(grant => grant.machineId),
        machineOnline: candidate.machineOnline,
        pricePerMTokUsd: candidate.pricePerMTokUsd,
        quality: candidate.quality,
        busy: candidate.busy,
      }))
      return { enabled: settings.enabled, preset: settings.preset, autoGrant: settings.autoGrant, requesterBotId: readMainBotIds()[0] ?? null, candidates: rows }
    },

    /**
     * Decide for one task. A pinned Bot is honoured but still checked, and the whole decision is
     * returned so the workbench can show the losers and their reasons.
     */
    decide({ text, requiredTools = [], requiresMachine = false, machineId = '', rootId = '', needs = {}, pinnedBotId = '', requesterBotId = '' } = {}) {
      if (typeof text !== 'string' || text.trim() === '') fail('BOT_ROUTING_REQUIRES_TASK')
      const settings = readSettings()
      if (settings.enabled !== true) fail('BOT_ROUTING_DISABLED')
      // A Bot's own policy wins for the work it hands out; the global preset is the fallback.
      let preset = settings.preset
      if (typeof requesterBotId === 'string' && requesterBotId !== '') {
        try { preset = settingsFor(requesterBotId)?.routing?.preset ?? preset } catch { /* keep the global preset */ }
      }
      needs = routingNeeds({ requiredTools, needs })
      requiresMachine = routingRequiresMachine({ requiredTools, requiresMachine, machineId, rootId })
      const task = { requiredTools, requiresMachine, machineId, rootId, needs }
      const all = withMachineFact(candidates(), task)
      if (typeof pinnedBotId === 'string' && pinnedBotId !== '') {
        const pinned = all.find(candidate => candidate.botId === pinnedBotId)
        // A Bot that exists but is off, unbound or unreachable is named as such: "unknown" would
        // send a person looking for a Bot that is right there in the list.
        if (!pinned) fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}:${pinnedReason(readBots(), settingsFor, pinnedBotId)}`)
        const machineRefusal = pinnedMachineRefusal(pinned, task)
        if (machineRefusal) fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}:${machineRefusal}`)
        const probe = routeBot({ task, candidates: [pinned], preset })
        if (!probe.chosen) fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}:${probe.rejected[0]?.reason ?? 'UNKNOWN'}`)
        const grant = candidateMachineGrant(pinned, typeof machineId === 'string' ? machineId : '', rootId)
        if (requiresMachine === true && !grant) fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}:BOT_ROUTING_WORKER_MACHINE_NOT_GRANTED`)
        const binding = readMainBotIds().includes(pinned.botId) ? null : bindingFor(pinned, grant, task, needs)
        if (requiresMachine === true && !binding && !readMainBotIds().includes(pinned.botId)) fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}:BOT_ROUTING_WORKER_CEILING_INSUFFICIENT`)
        return { chosen: { botId: pinned.botId, name: pinned.name }, preset, pinned: true, binding, grant: workerGrantFact(binding, settings.autoGrant.machineTools), ranked: [], rejected: [] }
      }
      const decision = routeBot({ task, candidates: all, preset })
      const chosen = decision.chosen ? all.find(candidate => candidate.botId === decision.chosen.botId) : null
      const binding = chosen && !readMainBotIds().includes(chosen.botId) ? bindingFor(chosen, candidateMachineGrant(chosen, typeof machineId === 'string' ? machineId : '', rootId), task, needs) : null
      if (chosen && requiresMachine === true && !binding && !readMainBotIds().includes(chosen.botId)) fail('BOT_ROUTING_WORKER_CEILING_INSUFFICIENT')
      return {
        chosen: decision.chosen ? { botId: decision.chosen.botId, name: chosen?.name ?? decision.chosen.botId, score: decision.chosen.score } : null,
        preset,
        pinned: false,
        ranked: decision.ranked,
        rejected: decision.rejected,
        reason: decision.reason,
        binding,
        grant: workerGrantFact(binding, settings.autoGrant.machineTools),
      }
    },

    /** Owner-only observation: no candidate reads, grant changes, runner or routing switch needed. */
    async submissionStatus(payload, context = {}) {
      if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED')
      const value = JSON.parse(canonicalTaskJson(payload))
      if (!value || Array.isArray(value) || Object.keys(value).some(key => !['requestKey', 'requesterBotId'].includes(key))) fail('INVALID_TASK_REQUEST')
      const requestKey = taskRef(value.requestKey), originBotId = taskRef(value.requesterBotId)
      if (typeof readSubmittedPlan !== 'function') fail('BOT_ROUTING_STATUS_UNAVAILABLE')
      const planId = submittedPlanId(originBotId, requestKey)
      let plan
      try { plan = await readSubmittedPlan(originBotId, planId) }
      catch (error) {
        if (error?.code !== 'TASK_PLAN_NOT_FOUND') throw error
        // This is a point-in-time read. An original request may still commit later.
        return { found: false, planId, originBotId, planState: null, packages: [] }
      }
      if (plan?.planId !== planId || plan?.ownerBotId !== originBotId) fail('BOT_ROUTING_SUBMISSION_IDENTITY_MISMATCH')
      const accepted = assertPlanAccepted(plan)
      return { found: true, accepted: true, planId, originBotId, planState: accepted.state,
        packages: accepted.packages.map(({ id, targetBotId, taskId, attemptId, operationId, state }) => ({ id, targetBotId, taskId, attemptId, operationId, state })) }
    },

    /**
     * Dispatch for real. The Host injects plan submission and the subject directory; without them
     * this refuses, because a dispatch that cannot create a task must not look like one.
     */
    async dispatch(payload = {}, context = {}) {
      if (typeof submitPlan !== 'function') fail('BOT_ROUTING_DISPATCH_UNAVAILABLE')
      if (typeof subjectFor !== 'function') fail('BOT_ROUTING_DISPATCH_UNAVAILABLE')
      const settings = readSettings()
      if (settings.enabled !== true) fail('BOT_ROUTING_DISABLED')
      const owner = context?.kind === 'owner'
      if (!owner && context?.kind !== 'bot') fail('BOT_ROUTING_AUTHENTICATED_CALLER_REQUIRED')
      const requesterBotId = owner
        ? (typeof payload.requesterBotId === 'string' && payload.requesterBotId !== '' ? payload.requesterBotId : readMainBotIds()[0] ?? '')
        : (typeof context.botId === 'string' ? context.botId : '')
      const originBotId = requesterBotId
      // The journal refuses a plan whose origin is not its submitter, so the submitting principal
      // must exist before anything is built; a session with no Bot of its own is refused.
      if (originBotId === '') fail('BOT_ROUTING_ORIGIN_REQUIRED')
      if (!subjectFor(originBotId)) fail('ROUTING_SUBJECT_UNKNOWN')
      if (!owner && !readMainBotIds().includes(requesterBotId)) fail(`BOT_ROUTING_DISPATCH_DENIED:${requesterBotId}`)
      if (!owner && (typeof context.sessionId !== 'string' || context.sessionId === '')) fail('BOT_ROUTING_SESSION_REQUIRED')
      if (payload.requestKey !== undefined && payload.requestKey !== '') taskRef(payload.requestKey)
      const needs = routingNeeds(payload)
      const decision = service.decide({ ...payload, needs, requesterBotId })
      if (!decision.chosen) fail(`BOT_ROUTING_NO_ELIGIBLE:${decision.rejected.map(row => row.reason).join(',') || 'none'}`)
      const report = await dispatchRoutedTask({
        routing: { ...settings, preset: decision.preset },
        mainBotIds: readMainBotIds(),
        requesterBotId,
        originBotId,
        pinnedBotId: typeof payload.pinnedBotId === 'string' ? payload.pinnedBotId : '',
        task: {
          text: payload.text,
          requiredTools: Array.isArray(payload.requiredTools) ? payload.requiredTools : [],
          requiresMachine: routingRequiresMachine(payload),
          machineId: typeof payload.machineId === 'string' ? payload.machineId : '',
          rootId: typeof payload.rootId === 'string' ? payload.rootId : '',
          needs,
          effectClass: payload.effectClass,
          acceptance: Array.isArray(payload.acceptance) ? payload.acceptance : [],
          sessionId: owner ? null : context.sessionId,
        },
        candidatesFor: () => candidates(),
        bindWorker: bindWorker ?? null,
        submitPlan,
        subjectFor,
        requestKey: typeof payload.requestKey === 'string' ? payload.requestKey : '',
        caller: owner ? { owner: true } : { sessionId: context.sessionId },
        grantContext: { owner, requesterBotId, originBotId, signal: context.signal },
        executionBackend: typeof executionBackendFor === 'function' ? executionBackendFor(routedEffectClass({ ...payload, needs })) : null,
        settle: typeof settle === 'function' ? report => settle(report, context) : null,
        deliver: typeof deliver === 'function' ? report => deliver(report, context) : null,
        newTaskId: typeof payload.requestKey === 'string' && payload.requestKey !== ''
          ? () => submittedPlanId(originBotId, payload.requestKey)
          : typeof newTaskId === 'function' ? newTaskId : undefined,
      })
      if (typeof onAccepted === 'function') await onAccepted(report, context)
      return report
    },
  }
  return Object.freeze(service)
}

/** Why a named Bot is not a candidate: off, unconfigured, or simply not in the committed list. */
function pinnedReason(bots, settingsFor, botId) {
  const bot = (Array.isArray(bots) ? bots : []).find(item => item?.id === botId)
  if (!bot) return 'BOT_ROUTING_PINNED_UNKNOWN'
  let settings = null
  try { settings = settingsFor(botId) } catch { settings = null }
  if (!settings) return 'BOT_NOT_CONFIGURED'
  if (settings.enabled === false) return 'BOT_DISABLED'
  if (settings.status && settings.status !== 'available') return 'BOT_BINDING_UNAVAILABLE'
  const model = settings.model ?? bot.model ?? null
  if (!model?.provider || !model?.model) return 'BOT_MODEL_UNBOUND'
  return 'BOT_NOT_ELIGIBLE'
}

/** What the chosen Bot would need before it could do this work; null when nothing is needed. */
function bindingFor(candidate, grant, task, needs) {
  if (task.requiresMachine !== true) return null
  if (!grant) return null
  return workerBinding({ botId: candidate.botId, ...grant, needs })
}

/** Tool names describe required effects; a caller cannot disguise a write by omitting needs. */
export function routingNeeds(payload = {}) {
  const tools = Array.isArray(payload.requiredTools) ? payload.requiredTools.map(name => String(name).replace(/^(tool|remote)\//u, '')) : []
  return {
    write: payload.needs?.write === true || tools.some(name => ['fs_write', 'remote_computer_write', 'remote-write', 'bot_library_write', 'write', 'edit', 'apply_patch'].includes(name)),
    shell: payload.needs?.shell === true || tools.some(name => ['shell_exec', 'container_command_v1', 'remote_computer_command', 'remote-command'].includes(name)),
    desktop: payload.needs?.desktop === true || tools.some(name => name.startsWith('desktop_') || name === 'remote_computer_desktop'),
    browser: payload.needs?.browser === true || tools.some(name => name.startsWith('browser_') || name === 'remote_computer_browser'),
  }
}

export function routingRequiresMachine(payload = {}) {
  const tools = Array.isArray(payload.requiredTools) ? payload.requiredTools : []
  return payload.requiresMachine === true || Boolean(payload.machineId) || Boolean(payload.rootId) || tools.some(tool => typeof tool === 'string' && /^(?:tool\/)?remote_computer_|^(?:remote\/)?(?:fs_|machine_ping|desktop_|browser_|container_command_v1)/u.test(tool))
}
