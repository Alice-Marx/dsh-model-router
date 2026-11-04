/**
 * Handing work between Bots.
 *
 * "Connect the Bots" is the risky half of collaboration: once a Bot may pass work to another, a pair
 * of them can ping-pong a task forever. This module is the guard rail — a small ledger of who has
 * held a task, and three rules that are checked before any handoff is allowed:
 *
 *  1. a Bot cannot hand work to itself;
 *  2. a task cannot revisit a Bot it already passed through (that is how loops form);
 *  3. a chain is bounded, so an unbounded delegation cannot be built one hop at a time.
 *
 * The ledger is in memory and per process: a handoff plan is something the Host acts on right away,
 * and a durable record belongs in the task journal where the rest of the history lives.
 */

export const MAX_HANDOFF_DEPTH = 3

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }
const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

const assertBot = (id, field) => {
  if (typeof id !== 'string' || !BOT_ID.test(id)) fail('HANDOFF_BOT_INVALID', `${field} 不是合法的 Bot id。`)
  return id
}

export function createHandoffLedger() {
  /** taskId -> [botId, …] in the order they held it. */
  const chains = new Map()
  return Object.freeze({
    /** Who has held this task, oldest first. */
    chainOf(taskId) { return [...(chains.get(taskId) ?? [])] },

    /** Record that a Bot took the task; idempotent for the same holder. */
    held(taskId, botId) {
      const chain = chains.get(taskId) ?? []
      if (chain[chain.length - 1] !== botId) chains.set(taskId, [...chain, botId])
      return this.chainOf(taskId)
    },

    /** Drop a finished task so the map does not grow without bound. */
    forget(taskId) { chains.delete(taskId) },

    get size() { return chains.size },
  })
}

/**
 * Whether one Bot may hand a task to another, given what the ledger already knows.
 *
 * @returns {{ allowed: true, chain: string[] }} or throws a coded refusal.
 */
export function assertHandoffAllowed({ taskId, fromBotId, toBotId, ledger, maxDepth = MAX_HANDOFF_DEPTH }) {
  if (typeof taskId !== 'string' || taskId === '') fail('HANDOFF_TASK_INVALID')
  assertBot(fromBotId, 'fromBotId')
  assertBot(toBotId, 'toBotId')
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) fail('HANDOFF_DEPTH_INVALID')
  if (fromBotId === toBotId) fail('HANDOFF_SELF', '一个 Bot 不能把任务交给自己。')
  const chain = ledger?.chainOf(taskId) ?? []
  if (chain.includes(toBotId)) fail('HANDOFF_CYCLE', `任务已经到过 ${toBotId}，不能再交回去。`)
  if (chain.length + 1 > maxDepth) fail('HANDOFF_TOO_DEEP', `交接最多 ${maxDepth} 层。`)
  return { allowed: true, chain: [...chain, toBotId] }
}

/**
 * A handoff as a plan package: the target owns it, the origin names the sender, and the objective
 * keeps the wording the sender used so the receiving Bot is not guessing what was asked.
 */
export function buildHandoff({ taskId, fromBotId, toBotId, objective, packageId = 'p1', acceptance = [] } = {}) {
  if (typeof objective !== 'string' || objective.trim() === '') fail('HANDOFF_OBJECTIVE_INVALID')
  assertBot(fromBotId, 'fromBotId')
  assertBot(toBotId, 'toBotId')
  return {
    plan: {
      schemaVersion: 1,
      taskId,
      origin: { kind: 'handoff', botId: fromBotId, sessionId: null },
      planRevision: 1,
      packages: [{
        id: packageId,
        targetBotId: toBotId,
        objective: objective.trim(),
        dependsOn: [],
        acceptance: Array.isArray(acceptance) ? acceptance : [],
        effectClass: 'read',
      }],
    },
  }
}
