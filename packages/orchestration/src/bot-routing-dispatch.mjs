/**
 * Hand a task to the Bot that should own it.
 *
 * Both entry points — the Main Bot deciding after a message (mode A), and a person choosing
 * "自动路由" in the workbench (mode B) — end here, so the decision and the permission grant can
 * never disagree.
 *
 * Three layers live in this file and must not be confused:
 *
 *  1. `routeTaskToBot` — the decision and a confirmed worker binding. A trusted Host callback may
 *     commit a saved grant here; this is an admission step, not the side-effect-free preview.
 *  2. `dispatchRoutedTask` — the real thing. It commits the binding first, submits the plan as the
 *     originating Bot, and then proves the journal actually accepted the work.
 *  3. `buildRoutedPlan` — the plan shape the task service accepts.
 *
 * Order matters and is deliberate:
 *  1. read the candidates from committed state (never from the caller),
 *  2. refuse when routing is off or no Bot is eligible,
 *  3. grant the worker exactly what the task touches (a committed binding, not a widening),
 *  4. only then submit the plan and check what the journal really created.
 *
 * The Main Bot keeps its own access; it is never narrowed by routing.
 */

import { randomUUID } from 'node:crypto'
import { routeBot, botRejection } from './bot-routing.mjs'
import { candidateMachineGrant, withMachineFact } from './bot-routing-candidates.mjs'
import { normalizeBotRouting, workerBinding, mainBotKeepsFullAccess } from './bot-routing-mode.mjs'

const fail = code => { const error = new Error(code); error.code = code; throw error }
const text = value => (typeof value === 'string' ? value.trim() : '')

/** Task states that prove the journal accepted a package and is holding it — not a plan id alone. */
export const ROUTED_ACCEPTED_STATES = Object.freeze(['ready', 'admitting', 'running', 'waiting-budget', 'cancelling', 'needs-reconciliation'])
/** Task states that prove the worker ran to a conclusion; anything else is still open. */
export const ROUTED_TERMINAL_STATES = Object.freeze(['succeeded', 'failed', 'cancelled', 'skipped'])
const ROUTED_FAILED_STATES = Object.freeze(['failed', 'cancelled', 'skipped', 'blocked'])

/**
 * What a routed task actually touches, expressed as the plan's effect class.
 *
 * This is a property of the work, never of the grant toggle: a task that writes or drives a desktop
 * is a workspace-write whether or not the Host was asked to apply the binding, so flipping
 * autoGrant can never silently turn a write into a read.
 */
export function routedEffectClass(task = {}) {
  const needs = task.needs ?? {}
  if (needs.write === true || needs.shell === true || needs.desktop === true || needs.browser === true) return 'workspace-write'
  return task.effectClass === 'workspace-write' ? 'workspace-write' : 'read'
}

/**
 * The committed machine grant a worker would use for this task.
 *
 * The ceiling always comes from the Bot's own committed grant for the machine the task names. A
 * machine the Bot was never granted is refused instead of being answered with another machine's
 * ceiling, and a machine nobody vouched for is offline.
 *
 * @returns {{ machineId: string, ceiling: string[] } | { refused: string } | null}
 */
export function workerMachineGrant(candidate, task = {}) {
  if (task.requiresMachine !== true) return null
  const asked = text(task.machineId)
  const grant = candidateMachineGrant(candidate, asked, task.rootId)
  if (!grant) return { refused: asked === '' ? 'BOT_ROUTING_WORKER_MACHINE_UNBOUND' : `BOT_ROUTING_WORKER_MACHINE_NOT_GRANTED:${asked}` }
  if (asked !== '' && asked !== grant.machineId) return { refused: `BOT_ROUTING_WORKER_MACHINE_NOT_GRANTED:${asked}` }
  const online = typeof candidate.machineOnlineFor === 'function'
    ? candidate.machineOnlineFor(grant.machineId) === true
    : candidate.machineOnline === true
  if (online !== true) return { refused: 'BOT_ROUTING_WORKER_MACHINE_OFFLINE' }
  return grant
}

/**
 * Whether a machine grant was applied, said separately from what it would contain.
 *
 * The autoGrant toggle says whether a missing binding may be committed. Applied remains false
 * until the Host actually confirms that commit; a preview never reports a proposed grant as applied.
 *
 * @returns {{ required: boolean, applied: boolean, autoGrant: boolean, reason: string|null } | null}
 */
export function workerGrantFact(binding, autoGrant, applied = false) {
  if (!binding) return null
  return { required: true, applied: applied === true, autoGrant: autoGrant === true, reason: autoGrant === true ? null : 'BOT_ROUTING_AUTO_GRANT_OFF' }
}

/**
 * The machine reason a named Bot cannot take this task, asked before the generic eligibility.
 *
 * "This Bot holds no grant for m9" is a fact a person can act on; "its machine is offline" is not,
 * when the Bot never had that machine in the first place.
 *
 * @returns {string|null}
 */
export function pinnedMachineRefusal(candidate, task = {}) {
  if (task?.requiresMachine !== true) return null
  const grant = workerMachineGrant(candidate, task)
  return grant?.refused ?? null
}
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
  routing, mainBotIds = [], requesterBotId = '', task = {}, candidatesFor, bindWorker = null, pinnedBotId = '', grantContext = {},
} = {}) {
  if (typeof candidatesFor !== 'function') fail('ROUTING_REQUIRES_CANDIDATES')
  const settings = normalizeBotRouting(routing)
  if (settings.enabled !== true) fail('BOT_ROUTING_DISABLED')
  if (typeof task.text !== 'string' || task.text.trim() === '') fail('ROUTING_REQUIRES_TASK')

  const focus = { ...task, requiredTools: Array.isArray(task.requiredTools) ? task.requiredTools : [] }
  const eligible = await candidatesFor(focus)
  if (!Array.isArray(eligible)) fail('ROUTING_CANDIDATES_INVALID')

  // A person may pin a Bot; the pin still passes the same hard requirements as an automatic pick,
  // so a disabled, unbound or unreachable Bot is refused by name instead of receiving work.
  if (typeof pinnedBotId === 'string' && pinnedBotId !== '') {
    const pinned = eligible.find(candidate => candidate?.botId === pinnedBotId)
    // The machine question is asked first, because "no grant for this machine" is the actionable
    // answer and the generic eligibility would only report the machine as offline.
    if (pinned) {
      const machineRefusal = pinnedMachineRefusal(pinned, focus)
      if (machineRefusal) fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}:${machineRefusal}`)
    }
    const reason = pinned ? botRejection(withMachineFact([pinned], focus)[0], focus) : null
    if (!pinned || reason) {
      const refusal = routeBot({ task: focus, candidates: withMachineFact(eligible, focus), preset: settings.preset })
      const known = refusal.rejected.find(row => row.botId === pinnedBotId)?.reason ?? reason ?? 'BOT_ROUTING_PINNED_UNKNOWN'
      fail(`BOT_ROUTING_PINNED_INELIGIBLE:${pinnedBotId}:${known}`)
    }
    const grant = workerMachineGrant(pinned, focus)
    if (grant?.refused) fail(grant.refused)
    // The Main Bot keeps everything it already had, pinned or not: routing must not re-grant or
    // narrow it, so its binding is reported as nothing rather than as a new grant.
    if (mainBotKeepsFullAccess(pinned.botId, mainBotIds)) {
      return { botId: pinned.botId, preset: settings.preset, pinned: true, binding: null, granted: false, decision: { chosen: { botId: pinned.botId }, ranked: [], rejected: [], reason: 'PINNED' }, mainBot: true }
    }
    const binding = grant ? bindingFor(pinned, grant, focus) : null
    if (focus.requiresMachine === true && !binding) fail('BOT_ROUTING_WORKER_CANNOT_REACH_MACHINE')
    const confirmed = await confirmBinding(binding, bindWorker, settings, { ...grantContext, requesterBotId })
    return {
      botId: pinned.botId, preset: settings.preset, pinned: true, binding,
      granted: confirmed.applied, bindingConfirmed: confirmed.confirmed,
      grant: workerGrantFact(binding, settings.autoGrant.machineTools, confirmed.applied),
      decision: { chosen: { botId: pinned.botId }, ranked: [], rejected: [], reason: 'PINNED' },
    }
  }

  const scored = withMachineFact(eligible, focus)
  const decision = routeBot({ task: focus, candidates: scored, preset: settings.preset })
  if (!decision.chosen) fail(`BOT_ROUTING_NO_ELIGIBLE:${decision.rejected.map(row => row.reason).join(',') || 'none'}`)

  const chosen = scored.find(candidate => candidate.botId === decision.chosen.botId)
  // The Main Bot already holds everything: routing must not re-grant or narrow it.
  if (mainBotKeepsFullAccess(decision.chosen.botId, mainBotIds)) {
    return { botId: decision.chosen.botId, preset: settings.preset, pinned: false, binding: null, decision, mainBot: true }
  }
  // A Bot keeping its own work is not re-granted either; the binding is reported so the caller can
  // see what its committed machine grant already covers.
  const grant = workerMachineGrant(chosen, focus)
  if (grant?.refused) fail(grant.refused)
  const binding = grant ? bindingFor(chosen, grant, focus) : null
  if (decision.chosen.botId === requesterBotId) {
    if (focus.requiresMachine === true && !binding) fail('BOT_ROUTING_WORKER_CANNOT_REACH_MACHINE')
    const confirmed = await confirmBinding(binding, bindWorker, settings, { ...grantContext, requesterBotId, grantAllowed: false })
    return { botId: decision.chosen.botId, preset: settings.preset, pinned: false, binding, granted: false, bindingConfirmed: confirmed.confirmed, grant: workerGrantFact(binding, false), decision, sameBot: true }
  }
  // A machine task needs the worker to actually reach that machine, through its own committed grant.
  if (focus.requiresMachine === true) {
    if (!binding) fail('BOT_ROUTING_WORKER_CANNOT_REACH_MACHINE')
    const confirmed = await confirmBinding(binding, bindWorker, settings, { ...grantContext, requesterBotId })
    return { botId: decision.chosen.botId, preset: settings.preset, pinned: false, binding, granted: confirmed.applied, bindingConfirmed: confirmed.confirmed, grant: workerGrantFact(binding, settings.autoGrant.machineTools, confirmed.applied), decision }
  }

  return { botId: decision.chosen.botId, preset: settings.preset, pinned: false, binding: null, decision }
}

/** The binding one committed machine grant can support for this task, or null when it cannot. */
function bindingFor(candidate, grant, focus) {
  return workerBinding({ botId: candidate.botId, ...grant, needs: focus.needs ?? {} })
}

async function confirmBinding(binding, bindWorker, settings, context) {
  if (!binding) return { confirmed: true, applied: false }
  if (typeof bindWorker !== 'function') fail('BOT_ROUTING_WORKER_GRANT_REQUIRED')
  const confirmation = await bindWorker(binding, { ...context, grantAllowed: context.grantAllowed !== false && settings.autoGrant.machineTools === true })
  if (confirmation?.confirmed !== true || confirmation?.remoteRevoked === false) fail('BOT_ROUTING_WORKER_GRANT_UNCONFIRMED')
  return { confirmed: true, applied: confirmation.applied === true }
}

/**
 * Prove the journal really accepted the work, and hand back the durable identity it created.
 *
 * A plan id on its own proves nothing: the Host may have created a plan whose packages were all
 * refused, or packages that carry no attempt and no operation. Both are reported as the failure
 * they are instead of being returned as a submitted task.
 *
 * @param {object} submitted the plan view the task service returned
 */
export function assertPlanAccepted(submitted) {
  const packages = Array.isArray(submitted?.packages) ? submitted.packages : []
  if (!submitted?.planId || packages.length === 0) fail('ROUTING_PLAN_NOT_ACCEPTED')
  const accepted = []
  for (const item of packages) {
    if (typeof item?.taskId !== 'string' || item.taskId === '') fail('ROUTING_PLAN_NOT_ACCEPTED')
    if (typeof item.attemptId !== 'string' || item.attemptId === '') fail('ROUTING_PLAN_NOT_ACCEPTED')
    if (typeof item.operationId !== 'string' || item.operationId === '') fail('ROUTING_PLAN_NOT_ACCEPTED')
    if (!ROUTED_ACCEPTED_STATES.includes(item.state) && !ROUTED_TERMINAL_STATES.includes(item.state)) {
      fail(`ROUTING_TASK_NOT_ACCEPTED:${item.taskId}:${item.state}`)
    }
    accepted.push({
      id: item.id,
      targetBotId: item.targetBotId,
      taskId: item.taskId,
      packageId: item.packageId,
      attemptId: item.attemptId,
      operationId: item.operationId ?? null,
      state: item.state,
      result: item.result ?? null,
    })
  }
  return { planId: submitted.planId, state: submitted.state ?? null, ownerBotId: submitted.ownerBotId ?? null, packages: accepted }
}

/** What the accepted packages add up to, once they are no longer open. */
export function routedOutcome(view) {
  const packages = Array.isArray(view?.packages) ? view.packages : []
  if (packages.length === 0) return { outcome: 'unknown', reason: 'ROUTED_NO_PACKAGES', packages }
  if (packages.some(item => item.state === 'needs-reconciliation')) return { outcome: 'unknown', reason: 'ROUTED_TASK_RECONCILIATION_REQUIRED', packages }
  const failed = packages.filter(item => ROUTED_FAILED_STATES.includes(item.state) || packageFailure(item))
  if (failed.length > 0) return { outcome: 'failed', reason: packageFailure(failed[0]) ?? failed[0].state, packages }
  if (packages.every(item => item.state === 'succeeded')) return { outcome: 'succeeded', reason: null, packages }
  return { outcome: 'running', reason: packages.map(item => item.state).join(','), packages }
}

/** The coded reason a package failed, wherever the journal chose to record it. */
const packageFailure = item => item?.result?.code ?? item?.result?.summary?.code ?? null

/**
 * Host-only binding callback. Existing permissions survive a small task; expansions use the saved
 * worker ceiling and the current machine revision. A multi-root scope is a Cartesian product, so
 * every resulting tool must be authorized for every resulting root before it may be committed.
 */
export function createWorkerBindingCommitter({ machines, settingsFor, mainBotIds = [], onChanged = null }) {
  const live = () => typeof machines === 'function' ? machines() : machines
  return async (binding, context = {}) => {
    const store = live()
    if (!store || typeof store.bind !== 'function') fail('BOT_ROUTING_BINDING_UNAVAILABLE')
    if (!binding || !binding.botId || !binding.machineId || !Array.isArray(binding.tools)) fail('BOT_ROUTING_BINDING_INVALID')
    const saved = settingsFor(binding.botId)
    if (!saved || saved.enabled === false || saved.status && saved.status !== 'available') fail('BOT_ROUTING_BINDING_UNAVAILABLE')
    const grants = (saved.machineGrants ?? []).filter(grant => grant.machineId === binding.machineId)
    const rootId = binding.rootId || grants.find(grant => grant.rootId === saved.workspaceRef?.rootId)?.rootId || grants[0]?.rootId
    if (!rootId) fail('BOT_ROUTING_WORKER_ROOT_REQUIRED')
    const machine = store.readModel().items.find(item => (item.id ?? item.machineId) === binding.machineId)
    if (!machine || machine.status === 'revoked') fail('BOT_ROUTING_WORKER_MACHINE_UNBOUND')
    const old = (machine.bindings ?? []).find(item => item.botId === binding.botId)
    const covers = scope => scope && !scope.revoked && scope.roots?.includes(rootId)
      && binding.tools.every(tool => scope.tools?.includes(tool))
      && (binding.mode !== 'workspace-write' || scope.mode === 'workspace-write')
    if (covers(old)) return { confirmed: true, applied: false, binding: { ...binding, rootId } }
    if (context.grantAllowed !== true) fail('BOT_ROUTING_WORKER_GRANT_REQUIRED')
    const mains = typeof mainBotIds === 'function' ? mainBotIds() : mainBotIds
    if (context.owner !== true && !mains.includes(context.requesterBotId)) fail('BOT_ROUTING_GRANT_DENIED')
    if (mains.includes(binding.botId)) fail('BOT_ROUTING_MAIN_REGRANT_DENIED')
    const existing = old && !old.revoked ? old : null
    const roots = [...new Set([...(existing?.roots ?? []), rootId])]
    const tools = [...new Set([...(existing?.tools ?? []), ...binding.tools])]
    const mode = existing?.mode === 'workspace-write' || binding.mode === 'workspace-write' ? 'workspace-write' : 'read-only'
    for (const root of roots) {
      const ceiling = grants.find(grant => grant.rootId === root)
      if (!ceiling || mode === 'workspace-write' && ceiling.mode !== 'workspace-write' || tools.some(tool => !ceiling.capabilities?.includes(tool))) fail('BOT_ROUTING_BINDING_ROOT_CEILING')
    }
    const result = await store.bind({ machineId: binding.machineId, botId: binding.botId, roots, tools, mode, expectedRevision: old?.revision ?? 0 }, { kind: 'owner', signal: context.signal })
    if (result?.remoteRevoked !== true) fail('BOT_ROUTING_WORKER_GRANT_UNCONFIRMED')
    const actual = store.readModel().items.find(item => (item.id ?? item.machineId) === binding.machineId)?.bindings?.find(item => item.botId === binding.botId)
    if (!covers(actual)) fail('BOT_ROUTING_WORKER_GRANT_UNCONFIRMED')
    if (typeof onChanged === 'function') await onChanged(binding.botId)
    return { confirmed: true, applied: true, binding: { ...binding, rootId }, revision: actual.revision }
  }
}

/**
 * The plan a routed task becomes.
 *
 * One package, one target Bot, no dependencies: Bot routing decides *who*, and this turns that
 * decision into something the task service can accept. The acceptance list stays empty on purpose —
 * the caller supplies it when it knows what "done" means, and an invented check would pass itself.
 *
 * The origin Bot is the one that asked, because the journal refuses a plan whose origin is not its
 * submitter; the target Bot is authorised separately by the Host's own target policy.
 */
export function buildRoutedPlan({ decision, text: objective, taskId, requesterBotId = '', originBotId = '', sessionId = null, acceptance = [], effectClass = 'read', packageId = 'p1', executionBackend = null, executionTarget = null }) {
  if (!decision || typeof decision !== 'object' || !decision.chosen?.botId) fail('ROUTING_DECISION_REQUIRED')
  if (typeof objective !== 'string' || objective.trim() === '') fail('ROUTING_REQUIRES_TASK')
  if (typeof taskId !== 'string' || taskId === '') fail('ROUTING_REQUIRES_TASK_ID')
  if (!['read', 'workspace-write'].includes(effectClass)) fail('ROUTING_INVALID_EFFECT_CLASS')
  const origin = originBotId !== '' ? originBotId : (requesterBotId === '' ? decision.chosen.botId : requesterBotId)
  if (origin === '') fail('ROUTING_ORIGIN_REQUIRED')
  return {
    schemaVersion: 1,
    taskId,
    origin: { kind: 'private', botId: origin, sessionId: sessionId ?? null },
    planRevision: 1,
    packages: [{
      id: packageId,
      targetBotId: decision.chosen.botId,
      objective: objective.trim(),
      dependsOn: [],
      acceptance: Array.isArray(acceptance) ? acceptance : [],
      effectClass,
      ...(executionBackend ? { execution: { backend: executionBackend, input: { task: objective.trim(), ...(executionTarget?.machineId ? { machineId: executionTarget.machineId } : {}), ...(executionTarget?.rootId ? { rootId: executionTarget.rootId } : {}) } } } : {}),
    }],
  }
}

/**
 * Dispatch a routed task for real: commit the binding, admit the plan, prove the work exists.
 *
 * The Host supplies the four things this module must never invent — the candidates, the worker
 * binding, the submitting subject and the plan submission itself — so committed state stays the
 * only source of authority. Nothing is submitted before the grant is committed, and a plan that
 * did not produce accepted tasks is reported as the failure it is.
 *
 * @param {{
 *   routing: object,
 *   mainBotIds?: string[],
 *   requesterBotId?: string,
 *   originBotId?: string,
 *   task: { text?: string, requiredTools?: string[], requiresMachine?: boolean, machineId?: string, needs?: object, effectClass?: 'read'|'workspace-write', acceptance?: string[] },
 *   candidatesFor: (task: object) => Array<object> | Promise<Array<object>>,
 *   bindWorker?: (binding: object) => Promise<unknown> | unknown,
 *   submitPlan: (subject: unknown, request: { requestKey: string, plan: object }, caller?: object) => Promise<unknown> | unknown,
 *   subjectFor?: (botId: string) => unknown,
 *   requestKey?: string,
 *   newTaskId?: () => string,
 *   caller?: object,
 *   settle?: (report: object) => Promise<unknown> | unknown,
 *   deliver?: (report: object) => Promise<unknown> | unknown,
 *   pinnedBotId?: string,
 * }} request
 */
export async function dispatchRoutedTask({
  routing, mainBotIds = [], requesterBotId = '', originBotId = '', task = {}, candidatesFor, bindWorker = null,
  submitPlan, subjectFor = null, requestKey = '', newTaskId = () => `task-${randomUUID()}`, caller = {},
  settle = null, deliver = null, pinnedBotId = '', grantContext = {}, executionBackend = null,
} = {}) {
  if (typeof submitPlan !== 'function') fail('ROUTING_REQUIRES_SUBMIT')
  if (typeof subjectFor !== 'function') fail('ROUTING_REQUIRES_SUBJECT')
  const focus = { ...task, requiredTools: Array.isArray(task.requiredTools) ? task.requiredTools : [] }
  const effectClass = routedEffectClass(focus)

  const routed = await routeTaskToBot({ routing, mainBotIds, requesterBotId, task: focus, candidatesFor, bindWorker, pinnedBotId, grantContext })
  const targetBotId = routed.botId
  const origin = originBotId !== '' ? originBotId : (requesterBotId !== '' ? requesterBotId : targetBotId)

  // A machine task whose grant was never committed must not become a plan: the worker would be
  // asked to reach a machine it cannot reach while the plan still looks accepted.
  if (focus.requiresMachine === true && routed.mainBot !== true && routed.bindingConfirmed !== true) {
    fail('BOT_ROUTING_WORKER_GRANT_REQUIRED')
  }

  const taskId = newTaskId()
  const plan = buildRoutedPlan({
    decision: routed.decision ?? { chosen: { botId: targetBotId } },
    text: focus.text, taskId, requesterBotId, originBotId: origin, sessionId: focus.sessionId ?? null,
    acceptance: Array.isArray(focus.acceptance) ? focus.acceptance : [], effectClass, executionBackend,
    executionTarget: focus.requiresMachine ? routed.binding ?? { machineId: focus.machineId, rootId: focus.rootId } : null,
  })
  const key = typeof requestKey === 'string' && requestKey !== '' ? requestKey : `route-${taskId}`
  const submitted = await submitPlan(subjectFor(origin), { requestKey: key, plan }, caller)
  const accepted = assertPlanAccepted(submitted)
  const report = {
    dispatched: submitted.replayed !== true, replayed: submitted.replayed === true, botId: targetBotId, originBotId: origin, preset: routed.preset, pinned: routed.pinned === true,
    mainBot: routed.mainBot === true, sameBot: routed.sameBot === true,
    binding: routed.binding ?? null, granted: routed.granted === true, bindingConfirmed: routed.bindingConfirmed === true || routed.mainBot === true, effectClass,
    taskId: accepted.planId, planId: accepted.planId, planState: accepted.state, packages: accepted.packages,
    // An accepted task is not a finished one: say so instead of implying the work is done.
    accepted: true, settled: accepted.packages.every(item => ROUTED_TERMINAL_STATES.includes(item.state)), ...routedOutcome(accepted),
  }
  if (typeof settle === 'function') {
    const view = await settle(report)
    const final = assertPlanAccepted(view)
    const outcome = routedOutcome(final)
    if (final.planId !== accepted.planId) fail('ROUTING_SETTLEMENT_IDENTITY_MISMATCH')
    report.settled = outcome.outcome !== 'running' && outcome.outcome !== 'unknown'
    report.planState = final.state
    report.packages = final.packages
    report.outcome = outcome.outcome
    report.reason = outcome.reason
    if (typeof deliver === 'function') await deliver(report)
  }
  return report
}
