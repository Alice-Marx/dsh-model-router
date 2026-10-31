import { join } from 'node:path'
import { inspectMigrationRemoteClient } from './migration-remote-client-quarantine.mjs'

const fail = (code, details) => { throw Object.assign(new Error(code), { code, ...(details ? { details } : {}) }) }

export async function assertMigrationRemoteOperationsSettled({ Database, clients, signal } = {}) {
  if (typeof Database !== 'function') fail('MIGRATION_REMOTE_OPERATION_SERVICES_REQUIRED')
  if (!Array.isArray(clients) || clients.length < 1 || clients.length > 64) fail('MIGRATION_REMOTE_OPERATION_INPUT_INVALID')
  if (signal?.aborted) fail('MIGRATION_REMOTE_OPERATION_CANCELLED')
  const rows = []
  for (const client of clients) rows.push(await inspectMigrationRemoteClient(client, Database))
  const settled = []
  for (const row of rows) {
    if (signal?.aborted) fail('MIGRATION_REMOTE_OPERATION_CANCELLED')
    if (!row.alreadyRevoked) fail('MIGRATION_REMOTE_OPERATION_AUTHORITY_ACTIVE', { machineId: row.machineId, clientId: row.clientId })
    const db = new Database(join(row.dataDir, 'agent.sqlite'), { readonly: true, fileMustExist: true })
    try {
      db.pragma('busy_timeout=5000')
      const pending = db.prepare("SELECT id,status FROM operations WHERE json_extract(context,'$.clientId')=? AND status IN ('admitted','running','cancel_pending','unknown') ORDER BY id LIMIT 9").all(row.clientId)
      if (pending.length) {
        const unknown = pending.some(operation => operation.status === 'unknown')
        fail(unknown ? 'MIGRATION_REMOTE_OPERATION_UNRESOLVED' : 'MIGRATION_REMOTE_OPERATION_ACTIVE', { machineId: row.machineId, clientId: row.clientId, pendingIds: pending.map(operation => operation.id).slice(0, 8), truncated: pending.length > 8 })
      }
      const operations = db.prepare("SELECT count(*) AS n FROM operations WHERE json_extract(context,'$.clientId')=?").get(row.clientId).n
      settled.push({ machineId: row.machineId, clientId: row.clientId, operations, settled: true })
    } finally { db.close() }
  }
  return Object.freeze({ schemaVersion: 1, clients: settled, declaredOperationsSettled: true, stopWriteProvable: false })
}
