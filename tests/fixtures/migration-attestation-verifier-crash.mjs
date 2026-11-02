import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beginMigrationExclusive, readMigrationFence } from '../../packages/orchestration/src/migration-fence.mjs'
import { hashPrivateMigrationFile } from '../../packages/orchestration/src/migration-private-files.mjs'
import { createMigrationAttestationBundle, observeMigrationAttestationContext, verifyMigrationAttestationBundle } from '../../packages/orchestration/src/migration-attestation-verifier.mjs'

/**
 * Real child-process writer for the attestation verifier. A publishing
 * subprocess does not need the fence owner to die with it: the parent keeps
 * holding the real fence, and the child may only write under a guard that
 * checks the current fence records against the independently pinned parent
 * owner - parent pid, operation id, platform, holderAlive and the exact
 * intent/exclusive record digests the expected context fixed. A guard that
 * does not bind all of those (or a bare true) is not a delegated guard.
 */

const request = JSON.parse(await readFile(process.argv[2], 'utf8'))
const json = value => JSON.stringify(value) + '\n'
const emit = value => process.stdout.write(json(value))
const common = { Database, operationDirectory: request.operationDirectory, configurationDirectory: request.configurationDirectory, dataArchive: request.dataArchive, ledgerArchive: request.ledgerArchive, fenceHome: request.fenceHome }

async function delegatedGuard ({ corrupt = false } = {}) {
  return async () => {
    const state = await readMigrationFence(request.fenceHome)
    if (!state.maintenanceActive || state.liveShared.length !== 0) return false
    if (state.intent?.operationId !== request.operationId || state.exclusive?.operationId !== request.operationId) return false
    if (state.exclusive?.holderAlive !== true) return false
    if (state.intent?.pid !== request.parentPid || state.exclusive?.pid !== request.parentPid) return false
    if (state.intent?.platform !== process.platform || state.exclusive?.platform !== process.platform) return false
    const fenceDirectory = join(request.fenceHome, 'fence')
    const intent = await hashPrivateMigrationFile(fenceDirectory, 'intent.json', 16384)
    const exclusive = await hashPrivateMigrationFile(fenceDirectory, 'exclusive.json', 16384)
    const intentWanted = corrupt ? '0'.repeat(64) : request.expected.fenceIntentDigest
    const exclusiveWanted = corrupt ? '0'.repeat(64) : request.expected.fenceExclusiveDigest
    return intent.sha256 === intentWanted && exclusive.sha256 === exclusiveWanted
  }
}

function writer (assertExclusive, { boundary = false } = {}) {
  return createMigrationAttestationBundle({
    ...common, assertExclusive, privateOutput: request.privateOutput, expected: request.expected,
    attestationType: request.attestationType ?? 'artifact', evidenceClass: 'automatic-observation',
    nowMs: request.nowMs, clockFloorMs: request.clockFloorMs, ttlMs: request.ttlMs,
    ...(boundary ? { onBoundary: async point => { if (point.point === 'bundle-written') process.exit(86) } } : {}),
  })
}

// The dying owner: acquires the real fence itself, fixes its own expected
// context, persists it for the parent, crashes after the bundle is written and
// never releases - so the fence survives as a dead owner's records.
if (request.mode === 'owner-die') {
  const fence = await beginMigrationExclusive(request.fenceHome, { operationId: request.operationId, drainTimeoutMs: 30000, pollMs: 20 })
  const assertExclusive = () => fence.verify()
  request.expected = await observeMigrationAttestationContext({ ...common, assertExclusive })
  await writeFile(request.expectedFile, json(request.expected))
  await writer(assertExclusive, { boundary: true })
  process.exit(0)
}

if (request.mode === 'crash-after-bundle') {
  await writer(await delegatedGuard(), { boundary: true })
  process.exit(0)
}

if (request.mode === 'create') {
  emit({ created: await writer(await delegatedGuard()) })
} else if (request.mode === 'resume') {
  let verifyFailed = null
  try {
    await verifyMigrationAttestationBundle({ ...common, assertExclusive: await delegatedGuard(), privateOutput: request.privateOutput, expected: request.expected, nowMs: request.nowMs + 1, clockFloorMs: request.clockFloorMs })
  } catch (error) { verifyFailed = error?.code ?? null }
  emit({ verifyFailed, created: await writer(await delegatedGuard()) })
} else if (request.mode === 'cold-verify') {
  emit({ verified: await verifyMigrationAttestationBundle({ ...common, assertExclusive: await delegatedGuard(), privateOutput: request.privateOutput, expected: request.expected, nowMs: request.nowMs + 1, clockFloorMs: request.clockFloorMs }) })
} else if (request.mode === 'guard-reject') {
  try { await writer(await delegatedGuard({ corrupt: true })); emit({ code: null }) } catch (error) { emit({ code: error?.code ?? null }) }
} else {
  process.exit(70)
}
