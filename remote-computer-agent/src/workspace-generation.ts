import { resolve } from 'node:path'
import { canonical, sha } from './protocol.js'

export const ROOTS_GENERATION_META_KEY = 'workspaceRootsGeneration'

/**
 * Deterministic digest of the configured roots map: which physical trees the
 * rootIds denote. Only the mapping participates — a different dataDir is a
 * different database, and executables/shell settings do not change what the
 * roots point at. Sorted by rootId so key insertion order never matters;
 * `resolve()` normalizes without touching the filesystem.
 */
export function rootsGeneration(roots: Record<string, string> = {}): string {
  const entries = Object.entries(roots).map(([id, value]) => [id, resolve(value)] as const)
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return sha(canonical(entries))
}

/**
 * Record the current roots generation and fence surviving admissions when the
 * configuration changed since the previous run.
 *
 * The fence deliberately reuses the legacy-fence liveness predicate: an
 * operation counts as unsettled when its status is
 * admitted/running/cancel_pending/unknown, or it is a shell operation whose
 * stop evidence has not settled. Fenced operations never auto-roll-back;
 * reconciliation happens through the existing terminal-with-evidence paths,
 * after which the fence goes inert.
 *
 * A first run on a database that predates generations only records the
 * digest: without an observed change there is nothing to invalidate, and
 * fencing on every upgrade would turn a routine update into a global write
 * outage. Returns the generation now in effect and whether it changed.
 */
export function reconcileRootsGeneration(db: any, generation: string): { changed: boolean } {
  db.exec('CREATE TABLE IF NOT EXISTS workspace_generation_fences(operation_id TEXT PRIMARY KEY)')
  const saved = db.prepare('SELECT value FROM meta WHERE key=?').get(ROOTS_GENERATION_META_KEY)?.value
  if (saved === generation) return { changed: false }
  if (saved === undefined) {
    db.prepare('INSERT INTO meta VALUES (?,?)').run(ROOTS_GENERATION_META_KEY, generation)
    return { changed: false }
  }
  const fenced = db.prepare(`INSERT OR IGNORE INTO workspace_generation_fences
    SELECT a.operation_id FROM workspace_admissions a JOIN operations o ON o.id=a.operation_id
    WHERE o.status IN ('admitted','running','cancel_pending','unknown')
       OR (o.tool='shell_exec' AND NOT (o.status IN ('succeeded','failed','cancelled')
           AND (coalesce(json_type(o.result,'$.stopConfirmed'),'null')='true'
             OR coalesce(json_type(o.result,'$.notStarted'),'null')='true')))`).run().changes
  db.prepare('UPDATE meta SET value=? WHERE key=?').run(generation, ROOTS_GENERATION_META_KEY)
  return { changed: true, fenced }
}
