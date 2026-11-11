// Public task views contain execution identities and status evidence, never backend inputs,
// execution references, raw event details or reconciliation proofs.
const short = (value, limit = 160) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
const code = value => typeof value === 'string' && /^[A-Z0-9_:-]{1,128}$/.test(value) ? value : null
// Attribution codes are lower-case words ('failed-after-dispatch'), not error
// codes, so they get their own shape instead of being forced through `code()`.
const attributionCode = value => typeof value === 'string' && /^[a-z][a-z-]{1,40}$/.test(value) ? value : null

export function projectProductTask(task) {
  const input = task.input?.input ?? {}
  const title = short(input.task || input.text || input.prompt) || (input.relativePath ? short(`文件操作：${input.relativePath}`) : '')
  const remote = task.result?.summary
  return {
    botId: task.ownerBotId, taskId: task.taskId, packageId: task.packageId, attemptId: task.attemptId,
    state: task.state, title, backend: task.input?.backend,
    ...(task.planId ? { planId: task.planId, logicalPackageId: task.logicalPackageId } : {}),
    location: task.input?.target?.location, machineId: task.input?.target?.machineId, workspaceId: task.input?.target?.workspaceId,
    createdAt: task.createdAt, updatedAt: task.updatedAt, deadlineAt: task.deadlineAt,
    attemptNumber: task.attemptNumber, operationId: task.operationId, attempts: task.attempts.length,
    // How far the work actually got. This projection is deliberately narrow, and
    // a derived label is exactly the kind of fact it is meant to carry: it says
    // nothing about inputs, references or proofs.
    ...(task.attribution ? { attribution: { code: attributionCode(task.attribution.code), label: short(task.attribution.label, 40) } } : {}),
    legacyRunIds: task.legacyRunIds,
    result: task.result ? { code: code(task.result.code ?? remote?.code),
      ...(task.executionRef?.kind === 'remote-operation' ? { remote: {
        status: ['succeeded', 'failed', 'cancelled', 'admitted', 'running', 'cancel_pending', 'unknown'].includes(remote?.status) ? remote.status : 'unknown',
        stopConfirmed: remote?.stopConfirmed === true, possiblyApplied: remote?.possiblyApplied !== false,
        ...(/^[a-f0-9]{64}$/.test(remote?.sha256 ?? '') ? { sha256: remote.sha256 } : {}),
        ...(Number.isSafeInteger(remote?.bytes) ? { bytes: remote.bytes } : {}),
        ...(Number.isSafeInteger(remote?.exitCode) ? { exitCode: remote.exitCode } : {}),
        ...(remote?.notStarted === true ? { notStarted: true } : {}),
      } } : {}),
    } : null,
    reconciliation: task.reconciliation ? { at: task.reconciliation.at, outcome: task.reconciliation.outcome } : null,
  }
}

/** Bounded owner navigation data; never reads funding receipts or backend inputs. */
export async function readProductAttention({ runtime, journal, limit = 512 }, payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) {
    throw Object.assign(new Error('INVALID_ATTENTION_REQUEST'), { code: 'INVALID_ATTENTION_REQUEST' })
  }
  await runtime.load()
  const loaded = journal.productList(Object.values(runtime.state?.bots ?? {}).map(bot => bot.id), { limit })
  const items = loaded.items.map(task => {
    const view = projectProductTask(task)
    const remote = view.result?.remote
    return { botId: view.botId, taskId: view.taskId, state: view.state,
      ...(remote ? { result: { remote: { stopConfirmed: remote.stopConfirmed, possiblyApplied: remote.possiblyApplied,
        ...(remote.notStarted === true ? { notStarted: true } : {}) } } } : {}) }
  })
  return { schemaVersion: 1, tasks: { status: 'available', items, total: loaded.total, truncated: loaded.truncated } }
}

/** The service checks the Bot's committed task/read grant and the task's owner first. */
export function inspectProductTask({ service, journal, subject, taskId }) {
  const task = service.get(subject, { taskId })
  const history = journal.timeline(task.ownerBotId, task.taskId)
  const attempts = task.attempts.map(row => ({ attemptId: row.id, number: row.number, state: row.state,
    operationId: row.operation_id, startedAt: row.started_ms, finishedAt: row.finished_ms }))
  const byId = new Map(attempts.map(row => [row.attemptId, row]))
  return { task: projectProductTask(task), attempts, timeline: {
    total: history.total, truncated: history.truncated,
    items: history.items.map(row => {
      const detail = JSON.parse(row.detail), attempt = byId.get(row.attempt_id)
      return { seq: row.seq, kind: row.kind, at: row.at_ms, attemptId: row.attempt_id,
        attemptNumber: attempt?.number ?? null, operationId: attempt?.operationId ?? null,
        outcome: ['ready', 'running', 'succeeded', 'failed', 'cancelled', 'blocked', 'skipped', 'waiting-budget', 'needs-reconciliation', 'unknown'].includes(detail.outcome) ? detail.outcome : null,
        code: code(detail.code) }
    }),
  } }
}
