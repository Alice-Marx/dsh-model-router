import { isAbsolute } from 'node:path'
import { AgentError, canonical, fail, identifier, type Context } from './protocol.js'
import type { Store } from './store.js'
import type { WorkspaceIdentity } from './workspace-identity.js'

export type { WorkspaceIdentity }
export type WorkspacePlatform = WorkspaceIdentity['platform']
export type WorkspaceAdmission = {
  operationId: string
  tool: string
  rootKey: string
  path: string
  platform: WorkspacePlatform
  ancestors: string[]
  clientId: string
  botId: string
  taskId: string
  attemptId: string
  acquiredAt: number
}
export type WorkspaceRelease = {
  operationId: string
  status: string | null
  released: boolean
  reason: string | null
}

const IDENTITY_KEYS = ['key', 'ancestors', 'path', 'platform']
const HEX64 = /^[a-f0-9]{64}$/
const MAX_ANCESTORS = 128
const MAX_PATH = 4096
const PLATFORMS = new Set<string>(['linux', 'win32'])
/** Tools whose original operation mutates one physical root and therefore needs exclusion. */
export const ROOT_WRITING_TOOLS: readonly string[] = ['fs_write', 'shell_exec', 'container_command_v1']
/** Tools whose stop evidence is only proven by a supervisor receipt. */
const STOP_EVIDENCE_TOOLS = new Set<string>(['shell_exec'])
/** Upper bound on simultaneously active admissions; nothing is ever evicted to stay under it. */
const MAX_ACTIVE_ADMISSIONS = 4096
const TERMINAL = new Set<string>(['succeeded', 'failed', 'cancelled'])
const LIVE = new Set<string>(['admitted', 'running'])

/**
 * Durable mutual exclusion over actual physical workspace roots.
 *
 * The lock lives in the Store database, so it survives controller restarts, is
 * visible to every connection, and is released only by a persisted terminal
 * receipt for the original operation. It never expires by itself.
 */
export class WorkspaceAdmissions {
  /** Maximum number of simultaneously active admissions; explicit and closed. */
  readonly MAX_ACTIVE_ADMISSIONS = MAX_ACTIVE_ADMISSIONS
  constructor(private store: Store, private generation: string = '') {
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS workspace_admissions(
        operation_id TEXT PRIMARY KEY REFERENCES operations(id),
        tool TEXT NOT NULL,
        root_key TEXT NOT NULL,
        path TEXT NOT NULL,
        platform TEXT NOT NULL,
        ancestors TEXT NOT NULL,
        ancestor_count INTEGER NOT NULL,
        context TEXT NOT NULL,
        acquired_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS workspace_admissions_root ON workspace_admissions(root_key);
      DROP TRIGGER IF EXISTS workspace_admissions_receipt;
      CREATE TRIGGER workspace_admissions_receipt
        AFTER UPDATE OF status ON operations
        FOR EACH ROW
        WHEN NEW.status IN ('succeeded','failed','cancelled')
        BEGIN
          DELETE FROM workspace_admissions WHERE operation_id = NEW.id AND (
            NEW.tool <> 'shell_exec'
            OR (json_valid(NEW.result) AND json_type(NEW.result,'$.stopConfirmed') = 'true')
            OR (json_valid(NEW.result) AND json_type(NEW.result,'$.notStarted') = 'true'));
        END;`)
    // Admissions predating roots-generation binding keep '' as an explicit
    // unknown generation; replay never depends on this column.
    if(!this.store.db.pragma('table_info(workspace_admissions)').some((column: any) => column.name==='roots_generation'))
      this.store.db.exec("ALTER TABLE workspace_admissions ADD COLUMN roots_generation TEXT NOT NULL DEFAULT ''")
  }
  /** Acquire the physical root for a live original operation; replay is idempotent. */
  admit(operationId: string, context: Context, identity: any) {
    identifier(operationId)
    const root = this.verify(identity)
    return this.immediate(() => {
      this.store.validate(context)
      const operation = this.store.db.prepare('SELECT * FROM operations WHERE id=?').get(operationId)
      if (!operation) fail('OPERATION_NOT_FOUND', 404)
      this.store.own(operation.context, context)
      if (!ROOT_WRITING_TOOLS.includes(operation.tool)) fail('WORKSPACE_TOOL_NOT_SUPPORTED')
      if (!LIVE.has(operation.status)) fail('OPERATION_CONFLICT', 409)
      const saved = this.store.db.prepare('SELECT * FROM workspace_admissions WHERE operation_id=?').get(operationId)
      if (saved) {
        this.store.own(saved.context, context)
        if (saved.root_key !== root.key || saved.path !== root.path || saved.platform !== root.platform || saved.ancestors !== canonical(root.ancestors)) fail('WORKSPACE_CONFLICT', 409)
        return { fresh: false, admission: this.decode(saved) }
      }
      const holder = this.holder(root, operationId)
      if (holder) fail('WORKSPACE_BUSY', 409)
      const active = this.store.db.prepare('SELECT count(*) AS count FROM workspace_admissions').get()
      if (active.count >= MAX_ACTIVE_ADMISSIONS) fail('WORKSPACE_ADMISSION_LIMIT', 429)
      this.store.db.prepare('INSERT INTO workspace_admissions(operation_id,tool,root_key,path,platform,ancestors,ancestor_count,context,acquired_at,roots_generation) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(operationId, operation.tool, root.key, root.path, root.platform, canonical(root.ancestors), root.ancestors.length, canonical(context), Date.now(), this.generation)
      return { fresh: true, admission: this.decode(this.store.db.prepare('SELECT * FROM workspace_admissions WHERE operation_id=?').get(operationId)) }
    })
  }
  /** Read-side check: no other admitted operation may overlap this physical root. */
  assertAvailable(identity: any, exceptOperationId?: string) {
    const root = this.verify(identity)
    if (exceptOperationId !== undefined) identifier(exceptOperationId)
    this.immediate(() => { if (this.holder(root, exceptOperationId ?? '')) fail('WORKSPACE_BUSY', 409) })
  }
  /** Release only on a persisted terminal receipt; the receipt commit and the release share one transaction. */
  releaseIfTerminal(operationId: string, context: Context): WorkspaceRelease {
    identifier(operationId)
    return this.immediate(() => {
      this.store.validate(context)
      const admission = this.store.db.prepare('SELECT * FROM workspace_admissions WHERE operation_id=?').get(operationId)
      const operation = this.store.db.prepare('SELECT * FROM operations WHERE id=?').get(operationId)
      // Whether or not the lock is still held, the original operation must belong to the caller.
      if (admission) this.store.own(admission.context, context)
      if (operation) this.store.own(operation.context, context)
      if (!operation) return { operationId, status: null, released: false, reason: 'OPERATION_NOT_FOUND' }
      if (!admission) return { operationId, status: operation.status, released: TERMINAL.has(operation.status) && this.stopped(operation), reason: TERMINAL.has(operation.status) && this.stopped(operation) ? 'ALREADY_RELEASED' : 'NOT_ADMITTED' }
      if (!TERMINAL.has(operation.status)) return { operationId, status: operation.status, released: false, reason: 'NON_TERMINAL' }
      if (!this.stopped(operation)) return { operationId, status: operation.status, released: false, reason: 'STOP_UNCONFIRMED' }
      return { operationId, status: operation.status, released: this.store.db.prepare('DELETE FROM workspace_admissions WHERE operation_id=?').run(operationId).changes > 0, reason: null }
    })
  }
  /** Active admissions, optionally narrowed to one grant subject. */
  list(context?: Context) {
    return this.immediate(() => {
      if (context !== undefined) this.store.validate(context)
      return this.store.db.prepare('SELECT * FROM workspace_admissions ORDER BY acquired_at,operation_id').all().map((row: any) => this.decode(row))
        .filter((a: WorkspaceAdmission) => context === undefined || (a.clientId === context.clientId && a.botId === context.botId && a.taskId === context.taskId && a.attemptId === context.attemptId))
    })
  }
  private verify(value: any): WorkspaceIdentity {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_WORKSPACE_IDENTITY')
    const keys = Object.keys(value)
    if (keys.length !== IDENTITY_KEYS.length || !keys.every(k => IDENTITY_KEYS.includes(k))) fail('INVALID_WORKSPACE_IDENTITY')
    const { key, ancestors, path, platform } = value
    if (typeof key !== 'string' || !HEX64.test(key)) fail('INVALID_WORKSPACE_IDENTITY')
    if (!Array.isArray(ancestors) || !ancestors.length || ancestors.length > MAX_ANCESTORS || ancestors.some((x: any) => typeof x !== 'string' || !HEX64.test(x))) fail('INVALID_WORKSPACE_IDENTITY')
    const chain = [...new Set(ancestors as string[])]
    if (!chain.includes(key)) fail('INVALID_WORKSPACE_IDENTITY')
    if (typeof path !== 'string' || !path.length || path.length > MAX_PATH || path.includes('\0') || !isAbsolute(path)) fail('INVALID_WORKSPACE_IDENTITY')
    if (typeof platform !== 'string' || !PLATFORMS.has(platform)) fail('INVALID_WORKSPACE_IDENTITY')
    return { key, ancestors: chain, path, platform: platform as WorkspacePlatform }
  }
  /** Same physical root (alias) or an overlapping parent/child branch conflicts. */
  private holder(root: WorkspaceIdentity, exceptOperationId: string) {
    return this.store.db.prepare(`SELECT operation_id,path,root_key FROM workspace_admissions
      WHERE operation_id <> @except AND (root_key = @key
        OR EXISTS (SELECT 1 FROM json_each(ancestors) WHERE value = @key)
        OR EXISTS (SELECT 1 FROM json_each(@ancestors) WHERE value = root_key))
      ORDER BY acquired_at,operation_id LIMIT 1`).get({ except: exceptOperationId, key: root.key, ancestors: canonical(root.ancestors) }) ?? null
  }
  private decode(row: any): WorkspaceAdmission {
    const context = JSON.parse(row.context)
    return { operationId: row.operation_id, tool: row.tool, rootKey: row.root_key, path: row.path, platform: row.platform, ancestors: JSON.parse(row.ancestors), clientId: context.clientId, botId: context.botId, taskId: context.taskId, attemptId: context.attemptId, acquiredAt: row.acquired_at }
  }
  /** A supervisor receipt must prove the stop before a shell lock is dropped. */
  private stopped(operation: any) {
    if (!TERMINAL.has(operation.status)) return false
    if (!STOP_EVIDENCE_TOOLS.has(operation.tool)) return true
    let result: any = null
    try { result = operation.result ? JSON.parse(operation.result) : null } catch { return false }
    return result?.stopConfirmed === true || result?.notStarted === true
  }
  private immediate<T>(fn: () => T): T {
    const db = this.store.db
    if (db.inTransaction) return fn()
    try { db.exec('BEGIN IMMEDIATE') } catch (e: any) { throw this.busy(e) }
    try { const value = fn(); db.exec('COMMIT'); return value } catch (e) { try { db.exec('ROLLBACK') } catch {}; throw this.busy(e) }
  }
  private busy(e: any) {
    if (e instanceof AgentError) return e
    if (typeof e?.code === 'string' && (e.code.startsWith('SQLITE_BUSY') || e.code === 'SQLITE_LOCKED')) return new AgentError('DATABASE_BUSY', 503)
    return e
  }
}
