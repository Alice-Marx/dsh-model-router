import { lstat, mkdir, open, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { renameMigrationFile } from './migration-atomic-rename.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const ID = /^[A-Za-z0-9_.-]{1,128}$/
const EVIDENCE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const RECORD_LIMIT = 64 * 1024
const AUDIT_LIMIT = 1024 * 1024
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/**
 * Single-machine migration admission/exclusive fence (stop-fence slice 2).
 * Coordinates protocol-participating processes on one synthetic home; never
 * a stop-write proof for non-participants. See
 * docs/integration/plan/20261031_migration_fence.md for the layout.
 */
const fenceRoot = home => join(home, 'fence')
const paths = home => { const root = fenceRoot(home); return { root, guard: join(root, 'guard'), owner: join(root, 'guard', 'owner'), intent: join(root, 'intent.json'), shared: join(root, 'shared'), exclusive: join(root, 'exclusive.json'), audit: join(root, 'abandoned-intents.jsonl') } }

async function ownIdentity() {
  const pid = process.pid
  if (process.platform !== 'linux') return { pid, startTicks: null, platform: process.platform }
  const value = await readFile(`/proc/${pid}/stat`, 'utf8').then(s => Number(s.slice(s.lastIndexOf(')') + 1).trim().split(/\s+/)[19])).catch(() => null)
  return { pid, startTicks: Number.isFinite(value) ? value : null, platform: process.platform }
}
async function identityOf(pid) {
  if (process.platform !== 'linux') return { pid, startTicks: null }
  const value = await readFile(`/proc/${pid}/stat`, 'utf8').then(s => Number(s.slice(s.lastIndexOf(')') + 1).trim().split(/\s+/)[19])).catch(() => null)
  return { pid, startTicks: Number.isFinite(value) ? value : null }
}
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' } }
async function sameProcess(recorded) {
  if (!record(recorded) || !Number.isSafeInteger(recorded.pid) || recorded.pid <= 0) return false
  if (!alive(recorded.pid)) return false
  if (process.platform !== 'linux' || recorded.startTicks == null) return true
  const current = await identityOf(recorded.pid)
  return current.startTicks != null && current.startTicks === recorded.startTicks
}
/** A verified live owner that is not this process: the same operation id is already taken. */
const foreignLive = async recorded => recorded?.pid !== process.pid && await sameProcess(recorded)

async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null } }

/**
 * A durable fence record is either absent (ENOENT) or one complete JSON object.
 * Anything else — a half-written or truncated file, a non-object, an oversized
 * or unreadable file — fails closed with the caller's code instead of being
 * read as "no maintenance recorded", which would release a live fence.
 */
async function readJsonStrict(path, code) {
  let raw
  try { raw = await readFile(path) } catch (error) { if (error?.code === 'ENOENT') return null; fail(code) }
  if (raw.length > RECORD_LIMIT) fail(code)
  let value
  try { value = JSON.parse(raw.toString('utf8')) } catch { fail(code) }
  if (!record(value)) fail(code)
  return value
}
/** Sequential so the reported code is deterministic when both records are damaged. */
async function readState(p) {
  const intent = await readJsonStrict(p.intent, 'MIGRATION_FENCE_INTENT_UNREADABLE')
  const exclusive = await readJsonStrict(p.exclusive, 'MIGRATION_FENCE_EXCLUSIVE_UNREADABLE')
  return { intent, exclusive }
}
/** Owner tokens are capabilities; diagnostic views never republish them. */
const withoutToken = value => { if (!value) return value; const { ownerToken, ...rest } = value; return rest }
const ownedBy = (value, operationId, ownerToken) => Boolean(value) && value.operationId === operationId && value.ownerToken === ownerToken

// Directory fsync has no win32 equivalent, so it is skipped there (unchanged
// convention): the rename itself is atomic, only the directory entry is not
// durably flushed.
async function syncDirectory(path) { if (process.platform === 'win32') return; const handle = await open(path, 'r'); try { await handle.sync() } finally { await handle.close() } }
/** Temp file + fsync + rename: a reader never observes a partially written record. */
async function atomicJson(path, value) {
  const temp = join(dirname(path), `.migration-fence-${randomUUID()}.tmp`), handle = await open(temp, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
  try { await renameMigrationFile(temp, path); await syncDirectory(dirname(path)) } finally { await unlink(temp).catch(() => {}) }
}

/** Claimed-directory mutex with dead-owner reclamation and identity verification. */
async function withGuard(home, work, { timeoutMs = 10000, signal } = {}) {
  const { guard, owner } = paths(home)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (signal?.aborted) fail('MIGRATION_FENCE_CANCELLED')
    try { await mkdir(guard); await writeFile(owner, JSON.stringify(await ownIdentity())); break }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const holder = await readJson(owner)
      // Reclaim a verifiably dead owner's guard, and also our own residue:
      // withGuard is never re-entered recursively, so a guard owned by this
      // process is stale cleanup failure (for example a transient Windows
      // directory lock), not a live holder.
      if (holder?.pid === process.pid || holder && !await sameProcess(holder)) {
        await rm(guard, { recursive: true, force: true }).catch(() => {})
      }
      if (Date.now() > deadline) fail('MIGRATION_FENCE_GUARD_TIMEOUT')
      await sleep(20)
    }
  }
  try { return await work() } finally { for (let n = 0; n < 10; n++) { if (await rm(guard, { recursive: true, force: true }).then(() => true, () => false)) break; await sleep(20) } }
}

async function prepare(home) {
  const p = paths(home)
  await mkdir(p.shared, { recursive: true })
  return p
}

/** Shared admission for a protocol-participating host; refuses under maintenance. */
export async function acquireMigrationShared(home, { timeoutMs = 10000, signal } = {}) {
  const p = await prepare(home)
  const identity = await ownIdentity()
  const claim = join(p.shared, `${identity.pid}-${identity.startTicks ?? 'x'}.json`)
  await withGuard(home, async () => {
    const state = await readState(p)
    if (state.intent || state.exclusive) fail('MIGRATION_MAINTENANCE_ACTIVE')
    const handle = await open(claim, 'wx').catch(error => { if (error?.code === 'EEXIST') fail('MIGRATION_FENCE_ALREADY_HELD'); throw error })
    await handle.writeFile(JSON.stringify({ ...identity, acquiredAt: Date.now() }))
    await handle.close()
  }, { timeoutMs, signal })
  return Object.freeze({
    claim,
    async release() { await unlink(claim).catch(error => { if (error?.code !== 'ENOENT') throw error }) },
  })
}

/** List live shared claims; dead owners are reclaimed by the caller of the drain. */
async function liveShared(home) {
  const p = paths(home)
  const names = await readdir(p.shared).catch(() => [])
  const live = [], stale = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const claim = join(p.shared, name), value = await readJson(claim)
    if (value && await sameProcess(value)) live.push({ claim, holder: value })
    else stale.push(claim)
  }
  return { live, stale }
}

/**
 * Coordinator exclusive: persist the durable intent (blocks all new shared
 * admissions, across coordinator death), drain live shared holders, then take
 * the exclusive claim. `onShared` observes each live holder while waiting.
 * Every record carries an `ownerToken`, so a handle whose ownership was
 * overwritten or taken over can neither verify nor release the fence.
 */
export async function beginMigrationExclusive(home, { operationId, drainTimeoutMs = 60000, pollMs = 50, onShared = () => {}, signal } = {}) {
  if (typeof operationId !== 'string' || !ID.test(operationId)) fail('MIGRATION_FENCE_INPUT_INVALID')
  const p = await prepare(home)
  const ownerToken = randomUUID()
  const identity = await ownIdentity()
  await withGuard(home, async () => {
    const state = await readState(p)
    // A live foreign coordinator (with or without its exclusive claim yet)
    // is busy; only a verifiably dead coordinator's state is taken over. The
    // same operation id is no exception: two live owners must never coexist.
    if (state.exclusive && state.exclusive.operationId !== operationId) {
      if (await sameProcess(state.exclusive)) fail('MIGRATION_FENCE_BUSY')
      await unlink(p.exclusive).catch(() => {})
    } else if (await foreignLive(state.exclusive)) fail('MIGRATION_FENCE_OWNER_CONFLICT')
    if (state.intent && state.intent.operationId !== operationId) {
      if (await sameProcess(state.intent)) fail('MIGRATION_FENCE_BUSY')
    } else if (await foreignLive(state.intent)) fail('MIGRATION_FENCE_OWNER_CONFLICT')
    await atomicJson(p.intent, { schemaVersion: 1, operationId, ownerToken, ...identity, createdAt: Date.now() })
  }, { signal })
  const deadline = Date.now() + drainTimeoutMs
  for (;;) {
    if (signal?.aborted) fail('MIGRATION_FENCE_CANCELLED')
    const { live, stale } = await liveShared(home)
    for (const claim of stale) await unlink(claim).catch(() => {})
    if (live.length === 0) break
    for (const holder of live) onShared(holder.holder)
    if (Date.now() > deadline) fail('MIGRATION_FENCE_DRAIN_TIMEOUT')
    await sleep(pollMs)
  }
  await withGuard(home, async () => {
    const state = await readState(p)
    if (!ownedBy(state.intent, operationId, ownerToken)) fail('MIGRATION_FENCE_STATE_CHANGED')
    const { live } = await liveShared(home)
    if (live.length > 0) fail('MIGRATION_FENCE_DRAIN_RACE')
    if (state.exclusive && state.exclusive.operationId !== operationId && await sameProcess(state.exclusive)) fail('MIGRATION_FENCE_BUSY')
    if (await foreignLive(state.exclusive)) fail('MIGRATION_FENCE_OWNER_CONFLICT')
    await atomicJson(p.exclusive, { schemaVersion: 1, operationId, ownerToken, ...identity, acquiredAt: Date.now() })
  }, { signal })
  return Object.freeze({
    operationId,
    async verify() {
      return ownedBy(await readJsonStrict(p.exclusive, 'MIGRATION_FENCE_EXCLUSIVE_UNREADABLE'), operationId, ownerToken)
    },
    async release() {
      await withGuard(home, async () => {
        const state = await readState(p)
        // Ownership lost to a takeover with the same id is a distinct, explicit
        // refusal: this handle must never delete another owner's fence.
        if (state.exclusive?.operationId === operationId && !ownedBy(state.exclusive, operationId, ownerToken)) fail('MIGRATION_FENCE_OWNER_LOST')
        if (state.intent?.operationId === operationId && !ownedBy(state.intent, operationId, ownerToken)) fail('MIGRATION_FENCE_OWNER_LOST')
        if (!ownedBy(state.exclusive, operationId, ownerToken) || !ownedBy(state.intent, operationId, ownerToken)) fail('MIGRATION_FENCE_NOT_HELD')
        await unlink(p.exclusive).catch(() => {})
        await unlink(p.intent).catch(() => {})
      })
    },
  })
}

const boundedReason = value => typeof value === 'string' && value.trim().length >= 1 && value.length <= 512
function boundedEvidence(evidence) {
  if (!record(evidence)) return false
  const keys = Object.keys(evidence)
  if (keys.length < 1 || keys.length > 16) return false
  for (const key of keys) {
    if (!EVIDENCE_KEY.test(key)) return false
    const value = evidence[key]
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return false
    if (typeof value === 'string' && value.length > 512) return false
  }
  return true
}
/** Append-only audit log; never truncated or rewritten by this module. */
async function appendAudit(path, value) {
  const named = await lstat(path).catch(error => { if (error?.code === 'ENOENT') return null; throw error })
  if (named && (!named.isFile() || named.isSymbolicLink() || named.size > AUDIT_LIMIT)) fail('MIGRATION_FENCE_AUDIT_INVALID')
  const handle = await open(path, 'a', 0o600)
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync() } finally { await handle.close() }
  await syncDirectory(dirname(path))
}

/**
 * Retract a durable intent that was never followed by an exclusive claim (for
 * example a drain timeout), recording the caller's evidence first. This is not
 * release() and does not relax it: any exclusive record — live or residue —
 * refuses, because capture and maintenance only run while the exclusive is
 * held, so "no exclusive" is the in-fence form of "no verified capture and no
 * published maintenance". A corrupt intent is deliberately not abandonable:
 * it stays fail-closed until a human inspects the bytes.
 */
export async function abandonMigrationIntent(home, { operationId, reason, evidence, signal } = {}) {
  if (typeof operationId !== 'string' || !ID.test(operationId)) fail('MIGRATION_FENCE_INPUT_INVALID')
  if (!boundedReason(reason) || !boundedEvidence(evidence)) fail('MIGRATION_FENCE_ABANDON_INPUT_INVALID')
  const p = await prepare(home)
  const identity = await ownIdentity()
  let result
  await withGuard(home, async () => {
    const state = await readState(p)
    if (!state.intent || state.intent.operationId !== operationId) fail('MIGRATION_FENCE_ABANDON_MISMATCH')
    if (state.exclusive) fail('MIGRATION_FENCE_EXCLUSIVE_PRESENT')
    if (await foreignLive(state.intent)) fail('MIGRATION_FENCE_BUSY')
    const raw = await readFile(p.intent).catch(() => null)
    if (!raw) fail('MIGRATION_FENCE_ABANDON_MISMATCH')
    let intent
    try { intent = JSON.parse(raw.toString('utf8')) } catch { fail('MIGRATION_FENCE_INTENT_UNREADABLE') }
    if (!record(intent) || intent.operationId !== operationId) fail('MIGRATION_FENCE_ABANDON_MISMATCH')
    // The digest binds the exact removed bytes (including the dead owner token);
    // the readable copy is redacted so the log never republishes a capability.
    const row = { schemaVersion: 1, kind: 'migration-fence-intent-abandonment', operationId, at: Date.now(), reason: reason.trim(), evidence: { ...evidence }, intentDigest: digest(raw), intent: withoutToken(intent), abandonedBy: identity }
    await appendAudit(p.audit, row)
    await unlink(p.intent)
    result = Object.freeze({ operationId, intentDigest: row.intentDigest, auditPath: p.audit, at: row.at })
  }, { signal })
  return result
}

/**
 * Diagnostic snapshot of the fence state; never a stop-write proof. An
 * unreadable record is an error, not an empty fence: reporting
 * `maintenanceActive: false` from half-written bytes would unblock writers.
 */
export async function readMigrationFence(home) {
  const p = paths(home)
  const state = await readState(p)
  const { live } = await liveShared(home)
  return { schemaVersion: 1, stopWriteProvable: false, maintenanceActive: Boolean(state.intent || state.exclusive), intent: withoutToken(state.intent), exclusive: state.exclusive ? { ...withoutToken(state.exclusive), holderAlive: await sameProcess(state.exclusive) } : null, liveShared: live.map(entry => entry.holder) }
}
