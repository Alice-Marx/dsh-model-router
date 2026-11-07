import { PolicyError } from '../../capability-broker/src/authority.mjs'

export function taskStage({ state, needsReconciliation = false }) {
  if (needsReconciliation || state === 'needs-reconciliation') return 'person/reconciliation'
  if (state === 'ready') return 'working/queued'
  if (state === 'running' || state === 'admitting') return 'working'
  if (state === 'cancelling') return 'working/cancelling'
  if (state === 'waiting-budget') return 'working/budget'
  if (state === 'blocked') return 'person/blocked'
  if (state === 'failed') return 'person/failed'
  if (state === 'succeeded') return 'person/review'
  if (state === 'cancelled' || state === 'skipped') return 'idle'
  throw new PolicyError('TASK_STAGE_INVALID')
}

/**
 * How far a task actually got, in words a person can act on.
 *
 * A row that says "failed" answers the wrong question: the useful one is whether
 * anything ran. Three cases look identical in the state column and are completely
 * different to a user — refused before dispatch, dispatched with no confirmation,
 * and dispatched and failed. `carriedOut` comes from the checkpoint trail; where
 * that is absent (older rows, a cancelled attempt) the absence of `notStarted` is
 * not proof that something ran, so the answer stays unconfirmed.
 */
export function taskAttribution(view = {}) {
  const state = view.state
  const result = view.result ?? null
  const carriedOut = result?.authorization?.carriedOut
  const notStarted = result?.notStarted === true
  if (state === 'needs-reconciliation') return {code: 'unconfirmed', label: '已执行，结果未确认'}
  if (state === 'succeeded') return {code: 'succeeded', label: '已完成'}
  if (state === 'cancelled' || state === 'skipped') {
    return carriedOut === true
      ? {code: 'cancelled-after-dispatch', label: '已取消，执行已开始'}
      : {code: 'cancelled', label: '已取消，未执行'}
  }
  if (state === 'blocked') {
    return notStarted || carriedOut === false
      ? {code: 'not-executed', label: '未执行：检查未通过'}
      : {code: 'blocked', label: '被拦下'}
  }
  if (state === 'failed') {
    if (notStarted || carriedOut === false) return {code: 'not-executed', label: '未执行：执行前失败'}
    if (carriedOut === true) return {code: 'failed-after-dispatch', label: '已执行，执行后失败'}
    return {code: 'unconfirmed', label: '失败，是否执行过未确认'}
  }
  if (state === 'waiting-budget') return {code: 'waiting', label: '等待预算'}
  return {code: 'pending', label: '进行中'}
}
