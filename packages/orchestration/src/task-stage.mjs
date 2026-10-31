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
