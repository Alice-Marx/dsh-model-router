import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inspectMigrationRemoteClient } from './migration-remote-client-quarantine.mjs'
import { canonicalTaskJson, taskHash } from './task-contract.mjs'

const fail = (code, details) => { throw Object.assign(new Error(code), { code, ...(details ? { details } : {}) }) }
const ID = /^[-A-Za-z0-9_.]{1,128}$/
const DIGEST = /^[a-f0-9]{64}$/
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => { const part = relative(root, path); return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }

async function fileEvidence(rootPath, relativePath) {
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath) || typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0') || isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) fail('MIGRATION_REMOTE_RECONCILIATION_INPUT')
  const root = await realpath(rootPath).catch(() => fail('MIGRATION_REMOTE_RECONCILIATION_INPUT'))
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('MIGRATION_REMOTE_RECONCILIATION_INPUT')
  const path = await realpath(join(root, relativePath)).catch(() => fail('MIGRATION_REMOTE_RECONCILIATION_MISMATCH'))
  if (!inside(root, path)) fail('MIGRATION_REMOTE_RECONCILIATION_MISMATCH')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) fail('MIGRATION_REMOTE_RECONCILIATION_MISMATCH')
  const bytes = await readFile(path)
  return { rootPath: root, relativePath, sha256: sha(bytes), size: bytes.length, bytes }
}

function proofFields(proof) {
  return proof && proof.schemaVersion === 1 && proof.kind === 'migration-remote-file-resolution' && ID.test(proof.operationId ?? '') && DIGEST.test(proof.operationDigest ?? '') && ID.test(proof.machineId ?? '') && ID.test(proof.clientId ?? '') && DIGEST.test(proof.sha256 ?? '') && Number.isSafeInteger(proof.size) && proof.size >= 0 && proof.size <= 1048576 && Number.isSafeInteger(proof.resolvedAt) && proof.resolvedAt > 0
}

export async function verifyMigrationRemoteFileResolution(db, operation, client) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migration_operation_resolutions'").get()
  if (!table) return false
  const saved = db.prepare('SELECT proof FROM migration_operation_resolutions WHERE operation_id=?').get(operation.id)
  if (!saved) return false
  let proof
  try { proof = JSON.parse(saved.proof) } catch { return false }
  if (!proofFields(proof) || proof.operationId !== operation.id || proof.operationDigest !== operation.digest || proof.machineId !== client.machineId || proof.clientId !== client.clientId) return false
  try {
    const current = await fileEvidence(proof.rootPath, proof.relativePath)
    return current.sha256 === proof.sha256 && current.size === proof.size
  } catch { return false }
}

export async function reconcileMigrationRemoteFileEffect({ Database, client, operationId, botId, taskId, attemptId, args, rootPath } = {}) {
  if (typeof Database !== 'function') fail('MIGRATION_REMOTE_RECONCILIATION_SERVICES')
  if (![operationId, botId, taskId, attemptId].every(value => ID.test(value ?? '')) || !args || Object.keys(args).some(key => !['rootId', 'relativePath', 'content', 'encoding', 'expectedHash'].includes(key))) fail('MIGRATION_REMOTE_RECONCILIATION_INPUT')
  if (!ID.test(args.rootId ?? '') || args.encoding !== 'utf8' || args.expectedHash !== null || typeof args.content !== 'string' || Buffer.byteLength(args.content) > 1048576) fail('MIGRATION_REMOTE_RECONCILIATION_INPUT')
  const declared = await inspectMigrationRemoteClient(client, Database)
  if (!declared.alreadyRevoked) fail('MIGRATION_REMOTE_RECONCILIATION_AUTHORITY_ACTIVE')
  const current = await fileEvidence(rootPath, args.relativePath)
  const expected = Buffer.from(args.content, 'utf8')
  if (!current.bytes.equals(expected)) fail('MIGRATION_REMOTE_RECONCILIATION_MISMATCH', { operationId })
  const operationDigest = taskHash({ clientId: client.clientId, botId, taskId, attemptId, tool: 'fs_write', args: JSON.parse(canonicalTaskJson(args)) })
  const db = new Database(join(declared.dataDir, 'agent.sqlite'))
  try {
    db.pragma('busy_timeout=5000')
    const operation = db.prepare('SELECT * FROM operations WHERE id=?').get(operationId)
    const context = operation ? JSON.parse(operation.context) : null
    if (!operation || operation.status !== 'unknown' || operation.tool !== 'fs_write' || operation.digest !== operationDigest || context?.clientId !== client.clientId || context?.botId !== botId || context?.taskId !== taskId || context?.attemptId !== attemptId) fail('MIGRATION_REMOTE_RECONCILIATION_OPERATION_MISMATCH', { operationId })
    const proof = { schemaVersion: 1, kind: 'migration-remote-file-resolution', operationId, operationDigest, machineId: client.machineId, clientId: client.clientId, rootPath: current.rootPath, relativePath: current.relativePath, sha256: current.sha256, size: current.size, resolvedAt: Date.now() }
    db.exec('CREATE TABLE IF NOT EXISTS migration_operation_resolutions(operation_id TEXT PRIMARY KEY REFERENCES operations(id),proof TEXT NOT NULL)')
    const existing = db.prepare('SELECT proof FROM migration_operation_resolutions WHERE operation_id=?').get(operationId)
    if (existing) {
      const saved = JSON.parse(existing.proof)
      for (const key of Object.keys(proof)) if (key !== 'resolvedAt' && JSON.stringify(saved[key]) !== JSON.stringify(proof[key])) fail('MIGRATION_REMOTE_RECONCILIATION_CONFLICT', { operationId })
    } else {
      db.prepare('INSERT INTO migration_operation_resolutions VALUES(?,?)').run(operationId, JSON.stringify(proof))
    }
    if (!await verifyMigrationRemoteFileResolution(db, operation, client)) fail('MIGRATION_REMOTE_RECONCILIATION_UNCONFIRMED', { operationId })
    return Object.freeze({ schemaVersion: 1, kind: 'migration-remote-file-resolution', operationId, operationDigest, sha256: current.sha256, size: current.size, resolved: true, originalOperationStatus: 'unknown', stopWriteProvable: false })
  } finally { db.close() }
}
