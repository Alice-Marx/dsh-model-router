import { readFile } from 'node:fs/promises'
import Database from 'better-sqlite3'
import { beginMigrationCommitOperation, resumeMigrationCommitOperation } from '../../packages/orchestration/src/migration-commit-orchestration.mjs'

const [mode, payloadPath] = process.argv.slice(2)
const payload = JSON.parse(await readFile(payloadPath, 'utf8'))
const database = new Database(payload.dbFile)
const options = {
  home: payload.home,
  operationId: payload.operationId,
  privateOutput: payload.privateOutput,
  domains: payload.domains,
  profilePlan: payload.configurationPlan,
  configurationPlan: payload.configurationPlan,
  inventory: payload.inventory,
  dataArchiveRoot: payload.dataArchiveRoot,
  ledgerArchiveRoot: payload.ledgerArchiveRoot,
  commitOutput: payload.commitOutput,
  commitChanges: payload.changes.map(change => ({
    path: change.path,
    beforeSha256: change.beforeSha256,
    maintenance: Buffer.from(change.maintenanceB64, 'base64'),
    after: Buffer.from(change.afterB64, 'base64'),
  })),
  Database,
  ledgerDatabase: database,
  ...(payload.omitDomainAuditInput ? {} : { domainAuditInput: payload.domainAuditInput }),
  domainAuditRoot: payload.domainAuditRoot,
  limits: { drainTimeoutMs: payload.drainTimeoutMs ?? 5000, pollMs: 20 },
  onBoundary: async ({ point }) => { if (payload.crashAt === point) process.exit(86) },
}
if (mode === 'begin') await beginMigrationCommitOperation(options)
else if (mode === 'resume') await resumeMigrationCommitOperation(options)
database.close()
process.exitCode = 87
