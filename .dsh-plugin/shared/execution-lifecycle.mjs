/** Required durable execution state, independent of advisory UI observers. */
import { randomUUID } from 'node:crypto'
import { createBudgetReservations } from './budget-reservations.mjs'

const receiptTimestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Number.isFinite(new Date(value).getTime())

export async function beginExecutionLifecycle({ state, buildRun, packageEstimates, settings = {}, confirmOverBudget = false, managedExecution }) {
  // Host-only seam. Wire commands never accept this binding or callback.
  const managed=prepareManagedExecution(managedExecution)
  const ownerToken = randomUUID()
  const manager = createBudgetReservations({ state })
  await manager.recoverInterruptedExecutions()
  const started = new Map(), results = new Map(), completed = new Set()
  const estimates = new Map(packageEstimates.map(item => [item.id, { estimatedCostUsd: item.estimatedCostUsd ?? item.estimatedCost ?? null, billing: item.billing ?? 'api' }]))
  let workspace = {}, poisoned = null, closed = false
  const current = (status = 'running') => {
    const receipts = [...started].map(([id, item]) => results.get(id) ?? {
      ...item, id, ok: false, notStarted: true, answer: '', channel: item.channel ?? null,
    })
    for (const [id, result] of results) if (!started.has(id)) receipts.push(result)
    const run = managed.stamp(buildRun({ status, results: receipts, workspace }))
    if (status === 'running' || status === 'interrupted') {
      run.status = status
      if (status === 'running') run.finishedAt = null
      for (const item of run.packages ?? []) {
        if (!started.has(item.id) || completed.has(item.id)) continue
        item.status = 'running'; item.inFlight = true
        if (!results.has(item.id) || results.get(item.id)?.notStarted) item.billing = estimates.get(item.id)?.billing ?? 'api'
        if (!results.has(item.id)) Object.assign(item, { ran: false, costUsd: null, costSource: 'pending-receipt' })
      }
    }
    run.checkpoint = { at: Date.now(), completedIds: [...completed], startedIds: [...started.keys()] }
    return run
  }
  const initial = current()
  await managed.prepared(initial.id)
  const accepted = await manager.beginExecution({ run: initial, packageEstimates, ownerToken, ...settings, confirmOverBudget })
  if (!accepted.accepted) return accepted
  const identity = { reservationId: accepted.reservationId, ownerToken }
  const rejectBudget = changed => {
    const error = new Error(changed.budget?.message || '费用或预占已变化，已暂停启动后续步骤，请重新核对预算。')
    error.code = 'ROUTER_BUDGET_CHANGED'
    error.budget = { ...changed.budget, paused: true, exceeded: changed.budget?.exceeded ?? 'unknown' }
    error.runId = initial.id
    error.reason = changed.reason
    throw error
  }
  const required = async operation => {
    if (poisoned) throw poisoned
    try { return await operation() }
    catch (cause) {
      poisoned = new Error('执行检查点保存失败，已停止启动后续步骤；请核对历史记录与费用。', { cause })
      poisoned.code = 'ROUTER_CHECKPOINT_FAILED'
      throw poisoned
    }
  }
  const save = run => required(() => manager.checkpointExecution({ ...identity, run,
    completedIds: [...completed], startedIds: [...started.keys()] }))
  const preserveReceiptTimes = run => {
    for (const item of run.packages ?? []) {
      const receipt = results.get(item.id)
      if (receiptTimestamp(receipt?.finishedAt)) item.finishedAt = receipt.finishedAt
    }
    return run
  }
  return {
    ...accepted,
    id: initial.id,
    current,
    results: () => [...results.values()],
    reservationFor: id => estimates.get(id),
    activePackageId: () => [...started.keys()].findLast(id => !completed.has(id)),
    async onCheckpointStart(item) {
      const previous = started.get(item.id)
      const alreadyStarted = started.has(item.id)
      started.set(item.id, item)
      const changed = await required(() => manager.checkpointExecution({ ...identity, run: current(),
        completedIds: [...completed], startedIds: [...started.keys()], checkBudget: true, ...settings, confirmOverBudget }))
      if (changed.accepted === false) {
        if (alreadyStarted) started.set(item.id, previous)
        else started.delete(item.id)
        rejectBudget(changed)
      }
    },
    async onCheckpointResult(result) {
      // Mutate the executor's receipt so later aggregate/final builds use the
      // same observed settlement time, even after another day or month starts.
      if (!receiptTimestamp(result.finishedAt)) result.finishedAt = Date.now()
      results.set(result.id, result); completed.add(result.id); await save(current())
    },
    async onWorkspace(value) { workspace = { ...workspace, ...value }; await save(current()) },
    async partialResult(result, { checkBudget = false } = {}) {
      // The next attempt's unknown receipt is durable dispatch evidence, not
      // an already-observed unknown invoice. Authorize against the previous
      // observed receipt plus its newly reserved estimate, then save both in
      // the same locked transaction before starting that attempt.
      const budgetRun = checkBudget ? current() : undefined
      const hadResult = results.has(result.id), previous = results.get(result.id)
      if (!receiptTimestamp(result.finishedAt)) result.finishedAt = Date.now()
      results.set(result.id, result)
      const changed = await required(() => manager.checkpointExecution({ ...identity, run: current(), budgetRun,
        completedIds: [...completed], startedIds: [...started.keys()], checkBudget, ...settings, confirmOverBudget: false }))
      if (changed.accepted === false) {
        if (hadResult) results.set(result.id, previous)
        else results.delete(result.id)
        rejectBudget(changed)
      }
    },
    async saveRun(run, { completedIds = [], startedIds = [] } = {}) {
      managed.stamp(run)
      const previousCompleted = new Set(completed), previousStarted = new Map(started)
      for (const id of completedIds) completed.add(id)
      for (const id of startedIds) if (!started.has(id)) started.set(id, { id })
      const changed = await required(() => manager.checkpointExecution({ ...identity, run,
        completedIds: [...completed], startedIds: [...started.keys()], checkBudget: startedIds.length > 0,
        ...settings, confirmOverBudget: false }))
      if (changed.accepted === false) {
        completed.clear(); for (const id of previousCompleted) completed.add(id)
        started.clear(); for (const [id, item] of previousStarted) started.set(id, item)
        rejectBudget(changed)
      }
    },
    async reserveExtra(id, estimatedCostUsd, { confirmOverBudget: extraConfirmation = false } = {}) {
      return required(async () => {
        const next = new Map(estimates); next.set(id, { estimatedCostUsd, billing: 'api' })
        const changed = await manager.resizeExecution({ ...identity,
          packageEstimates: [...next].filter(([key]) => !completed.has(key)).map(([key, value]) => ({ id: key, ...value })),
          ...settings, confirmOverBudget: extraConfirmation === true })
        if (changed.accepted) { estimates.clear(); for (const [key, value] of next) estimates.set(key, value) }
        return changed
      })
    },
    async finish(run) {
      if (poisoned) throw poisoned
      managed.stamp(run)
      const value = await required(() => manager.finishExecution({ ...identity, run: preserveReceiptTimes(run) }))
      closed = true
      return value
    },
    async interrupt(run) {
      if (closed) return
      managed.stamp(run)
      // Keep the reservation when storage itself remains unavailable. It is
      // never safe to turn an unconfirmed paid receipt into free capacity.
      try { await manager.interruptExecution({ ...identity, run: preserveReceiptTimes(run) }) } catch { /* original hold stays durable */ }
    },
  }
}

export function prepareManagedExecution(value) {
  if(value===undefined)return {stamp:run=>run,prepared:async()=>{}}
  const binding=value?.binding
  const keys=['taskId','attemptId','operationId','targetHash']
  if(!binding||Object.keys(binding).length!==keys.length||keys.some(key=>typeof binding[key]!=='string')
    ||keys.slice(0,3).some(key=>!/^[A-Za-z0-9_-]{1,128}$/.test(binding[key]))
    ||!/^([a-f0-9]{64})$/.test(binding.targetHash)||typeof value.onPrepared!=='function')throw new Error('INVALID_MANAGED_EXECUTION')
  const marker=Object.freeze({schemaVersion:1,...Object.fromEntries(keys.map(key=>[key,binding[key]]))})
  const onPrepared=value.onPrepared
  return {stamp:run=>{run.managedExecution={...marker};return run},prepared:runId=>onPrepared({kind:'mr-run',runId,marker:{...marker}})}
}
