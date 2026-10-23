/**
 * Durable execution holds. Every transition uses router-state's one file-lock
 * transaction, so another Host cannot approve against an out-of-date balance.
 * A hold is a remaining estimate, never an invoice or proof of a zero charge.
 */
import { randomUUID } from 'node:crypto'
import { budgetCheck, spending } from './run-ledger.mjs'

export const MAX_EXECUTION_RESERVATIONS = 100
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value)
const timestamp = value => amount(value) && Number.isFinite(new Date(value).getTime())

/** Unknown/corrupt holds make history incomplete; silently losing them is unsafe. */
export function sanitizeBudgetReservations(value) {
  if (value === undefined) return { reservations: {}, invalid: false }
  if (!record(value)) return { reservations: {}, invalid: true }
  const reservations = {}
  let invalid = false
  for (const [key, entry] of Object.entries(value)) {
    if (!identifier(key) || !record(entry) || entry.id !== key || entry.runId !== key
      || !identifier(entry.ownerToken) || !Number.isSafeInteger(entry.ownerPid) || entry.ownerPid < 1
      || !['active', 'interrupted'].includes(entry.status) || !timestamp(entry.createdAt) || !timestamp(entry.updatedAt)
      || !Array.isArray(entry.packages) || !Array.isArray(entry.completedIds)
      || entry.completedIds.some(id => !identifier(id))
      || entry.packages.some(item => !record(item) || !identifier(item.id)
        || (item.estimatedCostUsd !== null && !amount(item.estimatedCostUsd)) || typeof item.started !== 'boolean')
      || new Set(entry.packages.map(item => item.id)).size !== entry.packages.length
      || entry.packages.some(item => entry.completedIds.includes(item.id))) {
      invalid = true
      continue
    }
    reservations[key] = {
      id: key, runId: key, ownerToken: entry.ownerToken, ownerPid: entry.ownerPid,
      status: entry.status, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
      ...(timestamp(entry.interruptedAt) ? { interruptedAt: entry.interruptedAt } : {}),
      packages: entry.packages.map(item => ({ id: item.id, estimatedCostUsd: item.estimatedCostUsd, started: item.started })),
      completedIds: [...new Set(entry.completedIds)],
    }
  }
  return { reservations, invalid }
}

/** Live and unreconciled interrupted work occupies today's and this month's room. */
export function reservationSpending(state, { excludeReservationId = null } = {}) {
  let reservedUsd = 0
  let unknownReservations = 0
  for (const entry of Object.values(state?.budgetReservations ?? {})) {
    if (!record(entry) || entry.id === excludeReservationId) continue
    for (const item of Array.isArray(entry.packages) ? entry.packages : []) {
      if (amount(item.estimatedCostUsd)) reservedUsd += item.estimatedCostUsd
      if (!amount(item.estimatedCostUsd) || (entry.status === 'interrupted' && item.started)) unknownReservations += 1
    }
  }
  return { today: reservedUsd, month: reservedUsd, unknownToday: unknownReservations,
    unknownMonth: unknownReservations, reservedUsd, unknownReservations }
}

function normalizedEstimates(value, run) {
  const values = value ?? (run?.packages ?? []).map(item => ({ id: item.id, estimatedCostUsd: item.estimatedCost ?? null }))
  if (!Array.isArray(values) || values.some(item => !record(item) || !identifier(item.id))) {
    throw new TypeError('工作包预占必须包含有效的工作包 ID。')
  }
  const seen = new Set()
  return values.map(item => {
    if (seen.has(item.id)) throw new TypeError('工作包预占 ID 不能重复。')
    seen.add(item.id)
    const estimatedCostUsd = Object.hasOwn(item, 'estimatedCostUsd') ? item.estimatedCostUsd : item.estimatedCost ?? null
    if (estimatedCostUsd !== null && !amount(estimatedCostUsd)) throw new TypeError('工作包预估费用必须是非负有限数字或 null。')
    return { id: item.id, estimatedCostUsd, started: item.started === true }
  })
}

function checkedRun(run, id = run?.id) {
  if (!record(run) || !identifier(id) || run.id !== id || !Array.isArray(run.packages)) {
    throw new TypeError('执行检查点必须包含对应的完整运行记录。')
  }
  return structuredClone(run)
}

function upsertRun(current, run) {
  const index = current.runs.findIndex(item => item.id === run.id)
  if (index < 0) current.runs.push(run)
  else current.runs[index] = run
}

function ownedReservation(current, reservationId, ownerToken) {
  const entry = current.budgetReservations?.[reservationId]
  if (!entry || entry.ownerToken !== ownerToken || entry.status !== 'active') {
    const error = new Error('执行预占不存在、已中断或属于其他执行；原记录未修改。')
    error.code = 'ROUTER_RESERVATION_OWNERSHIP'
    throw error
  }
  return entry
}

function estimateTotal(packages) {
  if (packages.some(item => item.estimatedCostUsd === null)) return null
  const total = packages.reduce((sum, item) => sum + item.estimatedCostUsd, 0)
  return Number.isFinite(total) ? total : null
}

function currentBudget(current, at, packages, options, excludeReservationId = null) {
  const recorded = spending(current.runs, at, current.archivedSpending)
  const holds = reservationSpending(current, { excludeReservationId })
  const spent = { ...recorded, today: recorded.today + holds.today, month: recorded.month + holds.month,
    unknownToday: recorded.unknownToday + holds.unknownToday, unknownMonth: recorded.unknownMonth + holds.unknownMonth }
  const budget = budgetCheck({ estimateUsd: estimateTotal(packages), spent,
    dailyLimitUsd: options.dailyLimitUsd, monthlyLimitUsd: options.monthlyLimitUsd })
  const unknownBudget = budget.limited && (!budget.estimateKnown
    || (options.dailyLimitUsd > 0 && spent.unknownToday > 0)
    || (options.monthlyLimitUsd > 0 && spent.unknownMonth > 0))
  if (unknownBudget && !budget.exceeded) budget.message = '存在未核对费用或缺少单价，无法保证本次执行符合预算；请先核对账单或明确确认继续。'
  return { budget, spent, recorded, unknownBudget, ...holds }
}

/** false means definitely dead; permission failures and PID reuse stay conservative. */
function processAlive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { return error?.code === 'ESRCH' ? false : null }
}

export function createBudgetReservations({ state, now = Date.now, pid = process.pid, isProcessAlive = processAlive,
  maxReservations = MAX_EXECUTION_RESERVATIONS } = {}) {
  if (!state || typeof state.update !== 'function' || typeof state.read !== 'function') throw new TypeError('需要持久状态存储。')
  if (!Number.isSafeInteger(pid) || pid < 1) throw new TypeError('需要有效的执行进程 ID。')
  if (!Number.isInteger(maxReservations) || maxReservations < 1 || maxReservations > MAX_EXECUTION_RESERVATIONS) throw new RangeError('执行预占数量上限无效。')
  const snapshot = async () => reservationSpending(await state.read())
  const beginExecution = options => {
    const run = checkedRun(options?.run)
    const ownerToken = options.ownerToken ?? randomUUID()
    if (!identifier(ownerToken)) throw new TypeError('需要有效的执行所有权标记。')
    const packages = normalizedEstimates(options.packageEstimates, run)
    return state.update(current => {
      const checks = currentBudget(current, now(), packages, options)
      if (current.historyIncomplete) return { accepted: false, reason: 'history-incomplete', ...checks }
      current.budgetReservations ??= {}
      if (current.budgetReservations[run.id]) return { accepted: false, reason: 'active-run', ...checks }
      if (Object.keys(current.budgetReservations).length >= maxReservations) return { accepted: false, reason: 'reservation-capacity', ...checks }
      if (checks.budget.exceeded && options.confirmOverBudget !== true) return { accepted: false, reason: 'budget', ...checks }
      if (checks.unknownBudget && options.confirmOverBudget !== true) return { accepted: false, reason: 'budget-unknown', ...checks }
      const at = now()
      const entry = { id: run.id, runId: run.id, ownerToken, ownerPid: pid, status: 'active',
        createdAt: at, updatedAt: at, packages, completedIds: [] }
      current.budgetReservations[run.id] = entry
      upsertRun(current, run)
      return { accepted: true, reservationId: entry.id, ownerToken, run, ...checks }
    })
  }
  const checkpointExecution = ({ reservationId, ownerToken, run: nextRun, completedIds = [], startedIds = [],
    checkBudget = false, budgetRun: affordabilityRun, ...options }) => {
    const run = checkedRun(nextRun, reservationId)
    const budgetRun = affordabilityRun === undefined ? run : checkedRun(affordabilityRun, reservationId)
    if (![completedIds, startedIds].every(ids => Array.isArray(ids) && ids.every(identifier))) throw new TypeError('检查点工作包 ID 无效。')
    return state.update(current => {
      const entry = ownedReservation(current, reservationId, ownerToken)
      const completed = new Set([...entry.completedIds, ...completedIds])
      const started = new Set(startedIds)
      const known = new Set([...entry.completedIds, ...entry.packages.map(item => item.id)])
      if ([...completed, ...started].some(id => !known.has(id))) throw new TypeError('检查点包含未预占的工作包。')
      const remaining = entry.packages.filter(item => !completed.has(item.id)).map(item => ({ ...item, started: item.started || started.has(item.id) }))
      if (checkBudget) {
        // Receipts may exceed their original estimates, or another execution
        // may have settled meanwhile. Recheck the full remaining occupancy at
        // this dispatch boundary without double-counting our previous hold.
        const prospective = { ...current, runs: current.runs.map(item => item.id === run.id ? budgetRun : item) }
        const checks = currentBudget(prospective, now(), remaining, options, entry.id)
        if (current.historyIncomplete) return { accepted: false, reason: 'history-incomplete', ...checks }
        if (checks.budget.exceeded && options.confirmOverBudget !== true) return { accepted: false, reason: 'budget', ...checks }
        if (checks.unknownBudget && options.confirmOverBudget !== true) return { accepted: false, reason: 'budget-unknown', ...checks }
      }
      entry.packages = remaining
      entry.completedIds = [...completed]
      entry.updatedAt = now()
      upsertRun(current, run)
      return { accepted: true, reservationId, run, ...reservationSpending(current) }
    })
  }
  const resizeExecution = options => {
    const packages = normalizedEstimates(options.packageEstimates)
    return state.update(current => {
      const entry = ownedReservation(current, options.reservationId, options.ownerToken)
      const checks = currentBudget(current, now(), packages, options, entry.id)
      if (current.historyIncomplete) return { accepted: false, reason: 'history-incomplete', ...checks }
      if (checks.budget.exceeded && options.confirmOverBudget !== true) return { accepted: false, reason: 'budget', ...checks }
      if (checks.unknownBudget && options.confirmOverBudget !== true) return { accepted: false, reason: 'budget-unknown', ...checks }
      if (packages.some(item => entry.completedIds.includes(item.id))) throw new TypeError('已完成工作包不能重新加入剩余预占。')
      // An already-started call may still incur charges; resizing cannot erase it.
      for (const previous of entry.packages.filter(item => item.started)) {
        const next = packages.find(item => item.id === previous.id)
        if (!next) throw new TypeError('执行中的工作包必须先保存结果，才能释放其预占。')
        next.started = true
      }
      entry.packages = packages
      entry.updatedAt = now()
      return { accepted: true, reservationId: entry.id, ...checks }
    })
  }
  const finishExecution = ({ reservationId, ownerToken, run: nextRun }) => {
    const run = checkedRun(nextRun, reservationId)
    return state.update(current => {
      ownedReservation(current, reservationId, ownerToken)
      upsertRun(current, run)
      delete current.budgetReservations[reservationId]
      return { reservationId, run, ...reservationSpending(current) }
    })
  }
  const markInterrupted = (current, entry, run, at) => {
    entry.status = 'interrupted'
    entry.interruptedAt = at
    entry.updatedAt = at
    if (run) {
      run.status = 'interrupted'
      run.finishedAt = at
      for (const pending of entry.packages.filter(item => item.started)) {
        const item = [...run.packages, ...(run.reviews ?? [])].find(item => item.id === pending.id)
        if (!item || (!item.inFlight && !['pending', 'running'].includes(item.status))
          || amount(item.costUsd) || amount(item.knownCostUsd) || Array.isArray(item.qualityAttempts)) continue
        // We know a request began, but never observed its receipt. Keep that
        // uncertainty in the ledger as well as the durable estimate hold.
        item.status = 'interrupted'
        item.inFlight = false
        item.ran = true
        item.costUsd = null
        item.costSource = 'interrupted-usage-unknown'
        item.billing = item.billing === 'subscription' ? 'subscription' : 'api'
        item.finishedAt = at
      }
      run.interruption = { at, unreconciled: true, pendingPackageIds: entry.packages.map(item => item.id),
        startedPackageIds: entry.packages.filter(item => item.started).map(item => item.id) }
    } else current.historyIncomplete = true
  }
  const interruptExecution = ({ reservationId, ownerToken, run: nextRun }) => {
    const run = checkedRun(nextRun, reservationId)
    return state.update(current => {
      const entry = ownedReservation(current, reservationId, ownerToken)
      markInterrupted(current, entry, run, now())
      upsertRun(current, run)
      return { reservationId, run, ...reservationSpending(current) }
    })
  }
  const recoverInterruptedExecutions = () => state.update(async current => {
    const recovered = []
    for (const entry of Object.values(current.budgetReservations ?? {})) {
      if (entry.status !== 'active' || await isProcessAlive(entry.ownerPid) !== false) continue
      const run = current.runs.find(item => item.id === entry.runId)
      markInterrupted(current, entry, run, now())
      recovered.push({ reservationId: entry.id, runId: entry.runId, ...entry })
    }
    return { recovered, ...reservationSpending(current) }
  })
  return { beginExecution, checkpointExecution, resizeExecution, finishExecution, interruptExecution, recoverInterruptedExecutions, snapshot }
}
