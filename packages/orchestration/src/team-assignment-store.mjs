import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { TEAM_CODES } from './team-tool-contract.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const hash = value => createHash('sha256').update(value).digest('hex')
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' } }
const terminal = row => ['settled', 'cancelled', 'unknown'].includes(row.state)
export const computeBriefHash = (mode, message, doneWhen, consult) => hash(JSON.stringify([mode, message, doneWhen ?? null, consult === true]))
export const standingThreadKey = (parent, target, origin = '') => `standing-${hash(JSON.stringify([parent, target, origin])).slice(0, 40)}`
export const workThreadConversationKey = (target, thread) => hash(JSON.stringify([target, thread])).slice(0, 48)
export const assertNoCycle = (lineage, target) => { if (lineage.includes(target)) fail(TEAM_CODES.CYCLE) }
// Upstream's depth is the number of delegation edges, not the root Bot itself.
export const assertDepth = (lineage, maxDepth) => { if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) fail('TEAM_DEPTH_LIMIT_INVALID'); if (lineage.length > maxDepth) fail(TEAM_CODES.TOO_DEEP) }

/** Durable outbox, with one live Host owner. State writes never prove execution.
 * The exact target request receipt is the only way to settle a dispatched row.
 * A new schema leaves the original, unreleased Step journal intact for inspection.
 */
export function createTeamAssignmentStore({ Database, file, now = Date.now, maxRows = 65536, isProcessAlive = alive, ownerId = randomUUID() } = {}) {
  if (typeof Database !== 'function' || typeof file !== 'string' || !file) fail('TEAM_STORE_HOST_REQUIRED')
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) fail('TEAM_STORE_INVALID_LIMIT')
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  let closed = false
  try {
    db.pragma('busy_timeout=5000'); db.pragma('synchronous=FULL')
    if (file !== ':memory:' && db.pragma('journal_mode=WAL', { simple: true }) !== 'wal') fail('TEAM_STORE_WAL_REQUIRED')
    db.exec(`CREATE TABLE IF NOT EXISTS bot_team_owner_v2 (slot INTEGER PRIMARY KEY CHECK(slot=1), token TEXT, pid INTEGER, active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_team_rows_v2 (id TEXT PRIMARY KEY, parent TEXT NOT NULL, origin TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bot_team_rows_parent_v2 ON bot_team_rows_v2(parent,origin,created);
      CREATE TABLE IF NOT EXISTS bot_team_batches_v2 (parent TEXT NOT NULL, origin TEXT NOT NULL, request TEXT NOT NULL, hash TEXT NOT NULL, ids TEXT NOT NULL, PRIMARY KEY(parent,origin,request));`)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bot_team_assignments'").get() && db.prepare('SELECT count(*) n FROM bot_team_assignments').get().n) fail('TEAM_LEGACY_JOURNAL_RECONCILIATION_REQUIRED')
    db.transaction(() => {
      const owner = db.prepare('SELECT * FROM bot_team_owner_v2 WHERE slot=1').get()
      if (owner?.active && isProcessAlive(owner.pid)) fail('TEAM_STORE_ALREADY_OWNED')
      db.prepare('INSERT OR REPLACE INTO bot_team_owner_v2(slot,token,pid,active) VALUES(1,?,?,1)').run(ownerId, process.pid)
    }).immediate()
  } catch (error) { db.close(); throw error }
  const assertOpen = () => {
    if (closed) fail('TEAM_STORE_CLOSED')
    if (db.prepare('SELECT token FROM bot_team_owner_v2 WHERE slot=1 AND active=1').get()?.token !== ownerId) fail('TEAM_STORE_OWNER_LOST')
  }
  const read = id => { const row = db.prepare('SELECT data FROM bot_team_rows_v2 WHERE id=?').get(id); return row ? JSON.parse(row.data) : null }
  const all = () => { assertOpen(); return db.prepare('SELECT data FROM bot_team_rows_v2 ORDER BY created,id').all().map(row => JSON.parse(row.data)) }
  const save = row => db.prepare('INSERT OR REPLACE INTO bot_team_rows_v2(id,parent,origin,state,created,data) VALUES(?,?,?,?,?,?)').run(row.assignmentId, row.parentBot, row.originKey, row.state, row.createdAt, JSON.stringify(row))
  const mutate = (id, predicate, change) => {
    assertOpen()
    return db.transaction(() => { assertOpen(); const row = read(id); if (!row || !predicate(row)) return null; change(row); row.updatedAt = now(); save(row); return row }).immediate()
  }
  const createBatch = (specs, { parentBot = specs[0]?.parentBot, originKey = specs[0]?.originKey ?? '', requestKey, payloadHash } = {}) => {
    assertOpen()
    if (!Array.isArray(specs) || !specs.length || specs.length > 4 || !requestKey) fail(TEAM_CODES.INVALID_ARGS)
    const identity = payloadHash ?? hash(JSON.stringify(specs.map(({ workThreadKey, ...spec }) => ({ ...spec, thread: spec.requestedThread ?? workThreadKey }))))
    return db.transaction(() => {
      assertOpen()
      const batch = db.prepare('SELECT * FROM bot_team_batches_v2 WHERE parent=? AND origin=? AND request=?').get(parentBot, originKey, requestKey)
      if (batch) return batch.hash === identity ? { status: 'replayed', assignments: JSON.parse(batch.ids).map(read) } : { status: 'conflict' }
      if (db.prepare('SELECT count(*) n FROM bot_team_rows_v2').get().n + specs.length > maxRows) fail('TEAM_STORE_ROW_LIMIT')
      const rows = all()
      const decisions = specs.map(spec => {
        const match = rows.slice().reverse().find(row => row.parentBot === parentBot && row.originKey === originKey && row.targetBot === spec.targetBot && row.workThreadKey === spec.workThreadKey && row.mode === spec.mode && (spec.rework || row.briefHash === spec.briefHash && (row.parentAssignmentId ?? row.createdByTurn) === (spec.parentAssignmentId ?? spec.createdByTurn)))
        if (match && spec.rework && !terminal(match) && !match.outcome) fail(TEAM_CODES.REWORK_NOT_TERMINAL)
        if (match && !spec.rework) return { row: match, duplicate: true }
        const timestamp = now()
        const assignmentId = `assign_${randomUUID()}`
        return { row: { ...spec, requestKey, originKey, assignmentId, rootAssignmentId: spec.rootAssignmentId ?? assignmentId, reworkOf: match?.assignmentId ?? null, state: 'queued', outcome: null, resultText: null, resultCode: null, targetRef: null, targetRequestId: null, resumeState: spec.reply === 'none' ? 'none' : 'waiting', cancelRequestedAt: null, createdAt: timestamp, updatedAt: timestamp } }
      })
      // All decisions, including rework validity, are complete before the first insert.
      for (const { row, duplicate } of decisions) if (!duplicate) save(row)
      db.prepare('INSERT INTO bot_team_batches_v2(parent,origin,request,hash,ids) VALUES(?,?,?,?,?)').run(parentBot, originKey, requestKey, identity, JSON.stringify(decisions.map(({ row }) => row.assignmentId)))
      return { status: 'created', assignments: decisions.map(({ row, duplicate }) => ({ ...row, ...(duplicate ? { duplicate: true } : {}) })) }
    }).immediate()
  }
  const create = spec => { const result = createBatch([spec], { requestKey: spec.requestKey }); return { status: result.status, assignment: result.assignments?.[0] } }
  return Object.freeze({
    ready: true, create, createBatch,
    get(id) { assertOpen(); return read(id) },
    byRequestKey(parent, request, origin = '') { assertOpen(); const batch = db.prepare('SELECT ids FROM bot_team_batches_v2 WHERE parent=? AND origin=? AND request=?').get(parent, origin, request); return batch ? read(JSON.parse(batch.ids)[0]) : null },
    listByParent: (parent, { includeTerminal = false, originKey } = {}) => all().filter(row => row.parentBot === parent && (originKey === undefined || row.originKey === originKey) && (includeTerminal || !terminal(row))),
    threadsByParent(parent, originKey) { const seen = new Map(); for (const row of all().reverse().filter(row => row.parentBot === parent && (originKey === undefined || row.originKey === originKey))) if (!seen.has(row.workThreadKey)) seen.set(row.workThreadKey, row); return [...seen.values()] },
    activeFor(botId, origin) {
      const rows = all(), matches = ref => origin.sessionId ? ref?.sessionId === origin.sessionId : ref?.conversationId === origin.conversationId
      const running = rows.find(row => row.state === 'running' && row.targetBot === botId && matches(row.targetRef))
      if (running) return running
      const uncertain = rows.find(row => row.targetActive === true && row.targetBot === botId && matches(row.targetRef))
      if (uncertain) return uncertain
      // A child result resumes its caller's old work request, even if that
      // request already settled. This frame is durable across awaits and is
      // independent of delivery state: a stop must not erase the execution gate.
      const resume = rows.find(row => row.parentBot === botId && row.resumeActive === true && matches(row.origin))
      if (!resume) return null
      const parent = resume.parentAssignmentId ? read(resume.parentAssignmentId) : null
      return { ...(parent ?? { targetBot: botId, parentBot: botId, lineage: [botId], rootBot: botId, depth: 0, mode: 'work', origin: resume.origin }),
        resumeAssignmentId: resume.assignmentId, cancelRequestedAt: resume.cancelRequestedAt ?? parent?.cancelRequestedAt ?? null }
    },
    dispatchable: () => all().filter(row => row.state === 'queued'),
    rowsForReconcile: () => all().filter(row => row.state === 'running'),
    resumeDue: () => all().filter(row => row.state === 'waiting' && row.resumeState === 'waiting' && row.cancelRequestedAt === null),
    all,
    admit: id => mutate(id, row => row.state === 'queued', row => { row.state = 'admitting' }),
    beginDispatch: (id, ref, requestId) => mutate(id, row => row.state === 'admitting' && !row.cancelRequestedAt, row => { row.state = 'running'; row.targetRef = ref; row.targetRequestId = requestId; row.targetActive = true }),
    settle: (id, { outcome, resultText = null, resultCode = null }) => mutate(id, row => row.state === 'running', row => { row.state = row.reply === 'none' || row.cancelRequestedAt !== null ? 'settled' : 'waiting'; row.outcome = outcome; row.resultText = resultText; row.resultCode = resultCode; row.targetActive = false; if (row.cancelRequestedAt !== null) row.resumeState = 'withheld' }),
    markResumeSending: id => Boolean(mutate(id, row => row.state === 'waiting' && row.resumeState === 'waiting' && row.cancelRequestedAt === null, row => { row.resumeState = 'sending'; row.resumeActive = true })),
    completeResume: (id, state, { executionFinished = true } = {}) => mutate(id, row => row.state === 'waiting' && row.resumeActive === true, row => {
      row.state = 'settled'; row.resumeState = row.cancelRequestedAt !== null ? 'withheld' : state
      row.resumeActive = !executionFinished
      if (!executionFinished) row.cancelRequestedAt ??= now()
    }),
    rewarmResume: id => Boolean(mutate(id, row => row.state === 'waiting' && row.resumeState === 'sending' && row.cancelRequestedAt === null, row => { row.resumeState = 'waiting'; row.resumeActive = false })),
    rewarm: id => mutate(id, row => row.state === 'running' && row.cancelRequestedAt === null, row => { row.state = 'queued'; row.targetRequestId = null; row.targetRef = null; row.targetActive = false }),
    cancel: (id, { resultCode = null } = {}) => mutate(id, row => ['queued', 'admitting'].includes(row.state), row => { row.state = 'cancelled'; row.outcome = 'cancelled'; row.resultCode = resultCode; row.resumeState = 'withheld' }),
    requestCancel: id => mutate(id, row => !terminal(row), row => { row.cancelRequestedAt ??= now(); if (['queued', 'admitting'].includes(row.state)) { row.state = 'cancelled'; row.outcome = 'cancelled' }; row.resumeState = 'withheld' }),
    fenceUnknown: (id, code, { executionFinished = false } = {}) => mutate(id, row => ['admitting', 'running'].includes(row.state), row => { row.state = 'unknown'; row.outcome = 'unknown'; row.resultCode = code ?? TEAM_CODES.OUTCOME_UNKNOWN; row.resumeState = 'withheld'; row.targetActive = row.targetActive === true && !executionFinished; if (row.targetActive) row.cancelRequestedAt ??= now() }),
    recover() { let fenced = 0; for (const row of all()) { if (row.state === 'admitting') { this.fenceUnknown(row.assignmentId, 'TEAM_ADMISSION_INTERRUPTED'); fenced++ } else if (row.resumeActive === true) { mutate(row.assignmentId, () => true, current => { current.resumeActive = false; if (current.state === 'waiting') { current.state = 'settled'; current.resumeState = current.cancelRequestedAt !== null ? 'withheld' : 'uncertain' } }); fenced++ } }; return { fenced } },
    close() { if (closed) return; try { db.prepare('UPDATE bot_team_owner_v2 SET active=0 WHERE slot=1 AND token=?').run(ownerId) } finally { closed = true; db.close() } },
  })
}
export { STATE_UNKNOWN as TEAM_STATE_UNKNOWN } from './team-tool-contract.mjs'
