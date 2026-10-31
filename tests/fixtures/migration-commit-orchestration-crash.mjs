import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beginMigrationExclusive, acquireMigrationShared } from '../../packages/orchestration/src/migration-fence.mjs'
import { beginMigrationCommitOperation, resumeMigrationCommitOperation } from '../../packages/orchestration/src/migration-commit-orchestration.mjs'

// Real-process crash injection for the commit orchestration: the process exits
// after the named journal boundary, so recovery always faces a truly dead owner
// and bytes the crashed run left behind. Nothing here simulates a crash by
// calling an internal recovery function.
const [mode, ...rest] = process.argv.slice(2)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor (flag) {
  for (;;) {
    if (await access(flag).then(() => true, () => false)) return
    await sleep(20)
  }
}

if (mode === 'hold-shared' || mode === 'hold-exclusive') {
  const [home, flag, operationId] = rest
  const handle = mode === 'hold-shared'
    ? await acquireMigrationShared(home)
    : await beginMigrationExclusive(home, { operationId })
  process.stdout.write('HELD\n')
  await waitFor(flag)
  await handle.release()
  process.exit(0)
}

const payload = JSON.parse(await readFile(rest[0], 'utf8'))
const database = payload.dbFile ? new Database(payload.dbFile) : null
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
  commitChanges: (payload.changes ?? []).map(change => ({
    path: change.path,
    beforeSha256: change.beforeSha256,
    maintenance: Buffer.from(change.maintenanceB64, 'base64'),
    after: Buffer.from(change.afterB64, 'base64'),
  })),
  Database: database ? Database : undefined,
  ledgerDatabase: database ?? undefined,
  remoteClients: payload.remoteClients ?? [],
  remoteClientQuarantine: async ({ clients }) => ({ declaredCredentialAdmissionBlocked: true, persistentDeclaredExclusion: true, clients: clients.map(client => ({ ...client, revoked: true })) }),
  remoteOperationDrain: async ({ clients }) => ({ declaredOperationsSettled: true, clients: clients.map(client => ({ ...client, operations: 0, settled: true })) }),
  limits: { drainTimeoutMs: payload.drainTimeoutMs ?? 60000, pollMs: payload.pollMs ?? 50 },
  onBoundary: async ({ point }) => { if (payload.crashAt && payload.crashAt === point) process.exit(86) },
  onCommitStep: async (step, index) => {
    if (payload.commitBoundary && step === payload.commitBoundary && (index === 0 || index === -1)) process.exit(86)
  },
}
if (payload.mode === 'begin') await beginMigrationCommitOperation(options)
else await resumeMigrationCommitOperation(options)
if (payload.holdMs) await sleep(payload.holdMs)
database?.close()
process.exitCode = 87
