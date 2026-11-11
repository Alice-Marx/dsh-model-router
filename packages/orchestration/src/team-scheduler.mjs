import { randomUUID } from 'node:crypto'

const safeCode = error => /^[A-Z][A-Z0-9_:-]{0,95}$/.test(error?.code ?? '') ? error.code : 'TEAM_OUTCOME_UNKNOWN'
const known = receipt => ['succeeded', 'failed', 'cancelled'].includes(receipt?.outcome)

/** Persist intent before effects. Running requests are read, never dispatched again.
 * Sending resumes that lack a durable transport receipt are uncertain, never resent.
 */
export function createTeamScheduler({ store, bridge, checks, policy = null, pollMs = 200 } = {}) {
  if (!store?.dispatchable || !bridge?.dispatchTarget || !checks?.accessAllowed) throw new TypeError('TEAM_SCHEDULER_DEPENDENCIES_REQUIRED')
  if (!Number.isSafeInteger(pollMs) || pollMs < 5) throw new TypeError('TEAM_SCHEDULER_POLL_INVALID')
  const inflight = new Map(), pending = new Set()
  let closed = false, timer = null
  const detached = operation => policy ? policy.runDetached(operation) : operation()
  const allowed = row => !closed && row.cancelRequestedAt === null && checks.committedBot(row.parentBot) && checks.committedBot(row.targetBot) && checks.accessAllowed(row)
  const launch = (row, kind, operation) => {
    if (inflight.has(row.assignmentId) || closed) return
    const controller = new AbortController()
    inflight.set(row.assignmentId, { controller, kind })
    const task = Promise.resolve().then(() => operation(controller.signal)).catch(() => {}).finally(() => { inflight.delete(row.assignmentId); pending.delete(task) })
    pending.add(task)
  }
  const settle = (row, receipt) => {
    if (closed) return
    if (!known(receipt)) store.fenceUnknown(row.assignmentId, receipt?.code ?? 'TEAM_OUTCOME_UNKNOWN', { executionFinished: receipt?.executionFinished === true })
    else store.settle(row.assignmentId, { outcome: receipt.outcome, resultText: receipt.text ?? null, resultCode: receipt.code ?? null })
  }
  const dispatch = async (row, signal) => {
    if (!allowed(row)) { store.cancel(row.assignmentId, { resultCode: 'TEAM_ACCESS_CHANGED' }); return }
    if (bridge.isBusy(row.targetBot)) return
    if (!store.admit(row.assignmentId)) return
    try {
      const targetRef = await detached(() => bridge.resolveTargetRef(row))
      const current = store.get(row.assignmentId)
      if (signal.aborted || !allowed(current)) { store.cancel(row.assignmentId, { resultCode: 'TEAM_ACCESS_CHANGED' }); return }
      const requestId = `teamreq_${randomUUID()}`
      if (!store.beginDispatch(row.assignmentId, targetRef, requestId)) return
      const receipt = await detached(() => bridge.dispatchTarget({ ...row, targetRef, requestId, signal, validate: () => { const current = store.get(row.assignmentId); if (signal.aborted || !allowed(current)) throw Object.assign(new Error('TEAM_ACCESS_CHANGED'), { code: 'TEAM_ACCESS_CHANGED' }) } }))
      if (closed) return
      if (receipt?.started === false) {
        if (store.get(row.assignmentId).cancelRequestedAt === null) store.rewarm(row.assignmentId)
        else store.fenceUnknown(row.assignmentId, 'TEAM_STOP_BEFORE_DISPATCH')
      } else settle(row, receipt)
    } catch (error) { if (!closed) store.fenceUnknown(row.assignmentId, safeCode(error), { executionFinished: error?.executionFinished === true }) }
  }
  const reconcile = async row => {
    try { settle(row, await detached(() => bridge.readTarget({ ...row, requestId: row.targetRequestId }))) }
    catch (error) { if (!closed) store.fenceUnknown(row.assignmentId, safeCode(error)) }
  }
  const resume = async (row, signal) => {
    if (!allowed(row) || checks.originAllowed?.(row) === false) return
    if (bridge.isBusy(row.parentBot) || !store.markResumeSending(row.assignmentId)) return
    try {
      const result = await detached(() => bridge.resumeSender({ ...row, signal, validate: () => { if (signal.aborted || !allowed(store.get(row.assignmentId)) || checks.originAllowed?.(row) === false) throw Object.assign(new Error('TEAM_ACCESS_CHANGED'), { code: 'TEAM_ACCESS_CHANGED', started: false, retired: true }) } }))
      if (closed) return
      if (result?.started === false) {
        if (result.retired) store.completeResume(row.assignmentId, 'withheld')
        else store.rewarmResume(row.assignmentId)
      } else store.completeResume(row.assignmentId, result?.executionFinished === false ? 'uncertain' : 'delivered', { executionFinished: result?.executionFinished !== false })
    } catch (error) {
      if (closed) return
      if (error?.started === false && !error.retired) store.rewarmResume(row.assignmentId)
      else store.completeResume(row.assignmentId, error?.retired ? 'withheld' : 'uncertain', { executionFinished: error?.executionFinished === true || error?.started === false })
    }
  }
  const tick = () => {
    if (closed) return
    for (const row of store.rowsForReconcile()) launch(row, 'reconcile', () => reconcile(row))
    for (const row of store.dispatchable()) launch(row, 'dispatch', signal => dispatch(row, signal))
    for (const row of store.resumeDue()) launch(row, 'resume', signal => resume(row, signal))
  }
  return Object.freeze({
    tick,
    async whenIdle() { while (pending.size) await Promise.allSettled([...pending]) },
    stop(botId) {
      const rows = store.all().filter(row => !['settled', 'unknown', 'cancelled'].includes(row.state) && (row.lineage.includes(botId) || row.parentBot === botId))
      for (const row of rows) { store.requestCancel(row.assignmentId); inflight.get(row.assignmentId)?.controller.abort(Object.assign(new Error('TEAM_SUBTREE_STOPPED'), { code: 'TEAM_SUBTREE_STOPPED' })); if (row.targetRef) Promise.resolve(detached(() => bridge.cancelTarget(row))).catch(() => {}) }
      return { stopped: rows.map(row => row.assignmentId) }
    },
    start({ auto = true } = {}) { store.recover(); tick(); if (auto && !closed && !timer) { timer = setInterval(tick, pollMs); timer.unref?.() }; return this },
    close() { if (closed) return; closed = true; clearInterval(timer); for (const { controller } of inflight.values()) controller.abort(Object.assign(new Error('TEAM_SCHEDULER_CLOSED'), { code: 'TEAM_SCHEDULER_CLOSED' })) },
  })
}
