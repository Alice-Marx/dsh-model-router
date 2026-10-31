import { isAbsolute, resolve } from 'node:path'
import { exportMigrationLedger, verifyMigrationLedgerArchive } from './migration-ledger-export.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
/** Order-insensitive deep comparison form for private export documents. */
const stable = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
}
const TERMINAL_TASK = new Set(['succeeded', 'failed', 'cancelled', 'skipped'])
const TERMINAL_OPERATION = new Set(['succeeded', 'failed', 'cancelled'])
const ID_LIMIT = 16

/**
 * PRIVATE owner-only read-only rollback-readiness diagnostic (stop-fence
 * slice 3). Answers one question honestly: may the LATEST new-generation data
 * be handed back right now, or do task/journal/funding states or a missing
 * backup binding still block it? It changes nothing — both databases are
 * opened read-only — and it does not relax or bypass any existing money
 * rollback guard: unknown outcomes, open holds, retryable blocked tasks and
 * unsettled work are reported as blockers for an operator to resolve, never
 * auto-turned into success.
 */
export async function diagnoseMigrationRollbackReadiness({ Database, journalFile, routerFile, privateOutput, signal } = {}) {
  if (typeof Database !== 'function') fail('MIGRATION_READINESS_DRIVER_REQUIRED')
  for (const [key, value] of Object.entries({ journalFile, routerFile, privateOutput })) if (typeof value !== 'string' || !value || value.includes('\0') || !isAbsolute(value)) fail('MIGRATION_READINESS_INPUT_INVALID')
  if (signal?.aborted) fail('MIGRATION_READINESS_CANCELLED')

  const blockers = [], advisories = [], checks = []
  const blocker = (code, taskIds) => blockers.push({ code, count: taskIds.length, ...(taskIds.length ? { ids: taskIds.slice(0, ID_LIMIT) } : {}) })

  const journal = new Database(resolve(journalFile), { readonly: true, fileMustExist: true })
  try {
    journal.pragma('query_only = ON')
    const tables = new Set(journal.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name))
    for (const name of ['tasks', 'packages', 'attempts', 'operations', 'task_outbox']) if (!tables.has(name)) fail('MIGRATION_READINESS_JOURNAL_SCHEMA_UNRECOGNIZED')

    const rows = journal.prepare('SELECT t.id AS id, t.state AS state, a.started_ms AS started_ms, a.result AS result FROM tasks t LEFT JOIN packages p ON p.task_id = t.id LEFT JOIN attempts a ON a.id = p.current_attempt').all()
    const active = [], unknown = [], retryable = [], skippedStarted = [], skippedNotStarted = []
    for (const row of rows) {
      if (['ready', 'admitting', 'running', 'cancelling', 'waiting-budget'].includes(row.state)) active.push(row.id)
      else if (row.state === 'needs-reconciliation') unknown.push(row.id)
      else if (row.state === 'blocked') retryable.push(row.id)
      else if (row.state === 'skipped') {
        // A skipped entry is only advisory when its own attempt provably never
        // started; anything else still needs an operator decision.
        let notStarted = false
        try { notStarted = row.started_ms === null && JSON.parse(row.result ?? '{}')?.notStarted === true } catch {}
        ;(notStarted ? skippedNotStarted : skippedStarted).push(row.id)
      }
    }
    if (active.length) blocker('ACTIVE_TASK', active)
    if (unknown.length) blocker('UNKNOWN_TASK_OUTCOME', unknown)
    if (retryable.length) blocker('RETRYABLE_BLOCKED_TASK', retryable)
    if (skippedStarted.length) blocker('SKIPPED_WITH_STARTED_ATTEMPT', skippedStarted)
    if (skippedNotStarted.length) advisories.push({ code: 'SKIPPED_NOT_STARTED', count: skippedNotStarted.length, ids: skippedNotStarted.slice(0, ID_LIMIT) })
    checks.push({ check: 'task-states', ok: active.length + unknown.length + retryable.length + skippedStarted.length === 0, tasks: rows.length })

    const unsettled = journal.prepare('SELECT id FROM operations WHERE state NOT IN (?,?,?)').all(...[...TERMINAL_OPERATION]).map(row => row.id)
    if (unsettled.length) blocker('UNSETTLED_OPERATION', unsettled)
    checks.push({ check: 'operations-terminal', ok: unsettled.length === 0 })

    const undelivered = journal.prepare('SELECT operation_id AS id FROM task_outbox WHERE delivered_ms IS NULL').all().map(row => row.id)
    if (undelivered.length) blocker('UNDELIVERED_OUTBOX', undelivered)
    checks.push({ check: 'outbox-delivered', ok: undelivered.length === 0 })
  } finally { journal.close() }

  const router = new Database(resolve(routerFile), { readonly: true, fileMustExist: true })
  let live
  try {
    router.pragma('query_only = ON')
    const tables = new Set(router.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name))
    if (!tables.has('router_holds') || !tables.has('router_runs')) fail('MIGRATION_READINESS_ROUTER_SCHEMA_UNRECOGNIZED')
    const holds = router.prepare('SELECT id FROM router_holds').all().map(row => row.id)
    if (holds.length) blocker('OPEN_HOLD', holds)
    checks.push({ check: 'no-open-holds', ok: holds.length === 0 })
    // The live export is the binding side: its content digest must equal the
    // archive's, otherwise the backup predates current data.
    live = exportMigrationLedger(router, { signal })
  } finally { router.close() }

  let archive = null
  try {
    archive = await verifyMigrationLedgerArchive({ Database, privateOutput, signal })
    checks.push({ check: 'archive-verifiable', ok: true })
    // The verifier returns a redacted summary, so the live binding compares the
    // private export document itself: the live export must equal the archive's
    // full export, otherwise the backup predates current data.
    const { readFile, stat } = await import('node:fs/promises')
    const exportPath = resolve(privateOutput, 'ledger-export.private.json')
    const size = (await stat(exportPath)).size
    if (size > 16 * 1024 * 1024) fail('MIGRATION_READINESS_BACKUP_BINDING_INVALID')
    const saved = JSON.parse(await readFile(exportPath, 'utf8'))
    if (stable(live) !== stable(saved)) {
      blockers.push({ code: 'BACKUP_BINDING_STALE', count: 1 })
      checks.push({ check: 'archive-bound-to-live', ok: false })
    } else checks.push({ check: 'archive-bound-to-live', ok: true })
  } catch (error) {
    if (error?.code === 'BACKUP_BINDING_STALE') throw error
    blockers.push({ code: 'MIGRATION_READINESS_BACKUP_BINDING_INVALID', count: 1, reason: String(error?.code ?? error?.message ?? '').slice(0, 128) })
    checks.push({ check: 'archive-verifiable', ok: false })
    checks.push({ check: 'archive-bound-to-live', ok: false })
  }

  return {
    schemaVersion: 1,
    ready: blockers.length === 0,
    blockers, advisories, checks,
    postActivationRollbackSupported: false,
    moneyRollbackGuardUntouched: true,
    notes: ['Read-only diagnostic: no database or archive byte was modified.', 'Ready means no blocking state was observed; it is not an activation proof and does not relax the money rollback guard.'],
  }
}
