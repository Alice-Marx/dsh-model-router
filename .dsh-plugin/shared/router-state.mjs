/**
 * Small persistent Host state for the router: onboarding flag, last health
 * check, subscription quota exhaustion, and the bounded run ledger (routing decisions, channels, fallback
 * errors, cost, review and user ratings). One JSON file under the DSH home. Never stores keys.
 *
 * Several Host processes may share one DSH home, so every update takes a
 * lock file (`state.json.lock`, exclusive create; only stale dead-owner locks
 * are recovered). A busy live owner causes a bounded, explicit timeout,
 * re-reads the file, applies the change to the fresh copy and writes it back
 * atomically (temp file + rename). Reads re-read the file when its mtime or
 * size changed. A file that cannot be parsed is kept as
 * `state.json.corrupt-<timestamp>` and a notice is recorded instead of
 * silently discarding the history.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { archiveSpending, sanitizeArchivedSpending } from './run-ledger.mjs'

export const MAX_RUNS = 200
const STATE_VERSION = 1

/** Same DSH home rule as the Host: DSH_HOME (with ~ expansion) or ~/.dsh. */
export function resolveStateHome(env = process.env, home = homedir(), cwd = process.cwd()) {
  const configured = String(env.DSH_HOME ?? '').trim()
  if (configured === '') return join(home, '.dsh')
  const expanded = configured === '~' ? home
    : configured.startsWith('~/') || configured.startsWith('~\\') ? join(home, configured.slice(2)) : configured
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

export function defaultStatePath(env = process.env) {
  return join(resolveStateHome(env), 'model-router', 'state.json')
}

export const MAX_NOTICES = 10
/** Interactive terminal sessions kept as metadata only (no input or output). */
export const MAX_TERMINAL_SESSIONS = 50
const LOCK_STALE_MS = 15_000
const LOCK_TIMEOUT_MS = 10_000

function emptyState() {
  return { version: STATE_VERSION, historyIncomplete: false, onboarding: { completedAt: null }, health: null, quota: {}, authFailures: {}, runs: [], dynamicData: { liveBench: null, pricing: null, status: {}, revision: '' }, archivedSpending: sanitizeArchivedSpending(), notices: [], terminalSessions: [] }
}

function sanitizeNotices(value) {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item.kind === 'string' && typeof item.message === 'string').slice(-MAX_NOTICES)
    : []
}

function retainRuns(state, maxRuns) {
  const removed = Math.max(0, state.runs.length - maxRuns)
  state.archivedSpending = archiveSpending(state.runs.slice(0, removed), state.archivedSpending)
  state.runs = state.runs.slice(removed)
  return state
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
function invalidArchivedSpending(value) {
  if (value === undefined || value === null) return false // old v1 files omit it
  if (!record(value)) return true
  for (const [field, pattern] of [['days', /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u],
    ['months', /^\d{4}-(?:0[1-9]|1[0-2])$/u]]) {
    if (value[field] === undefined) continue
    if (!record(value[field])) return true
    for (const [key, totals] of Object.entries(value[field])) {
      if (!pattern.test(key) || !record(totals)) return true
      if (['costUsd', 'unknown', 'subscriptionUsd', 'subscriptionRuns'].some(name => totals[name] !== undefined
        && (!nonnegative(totals[name]) || (['unknown', 'subscriptionRuns'].includes(name) && !Number.isInteger(totals[name]))))) return true
    }
  }
  return false
}

function invalidRunSpending(run) {
  if (!record(run) || invalidArchivedSpending(run.priorAttemptSpending)) return true
  for (const field of ['packages', 'reviews']) {
    if (run[field] === undefined) continue // missing legacy fields are not fabricated
    if (!Array.isArray(run[field])) return true
    for (const item of run[field]) {
      if (!record(item) || (item.ran !== undefined && typeof item.ran !== 'boolean')) return true
      if (['costUsd', 'referenceCostUsd'].some(name => item[name] !== undefined && item[name] !== null && !nonnegative(item[name]))) return true
      if (item.ran === true || nonnegative(item.costUsd)) {
        const at = item.finishedAt ?? run.createdAt
        if (!nonnegative(at) || !Number.isFinite(new Date(at).getTime())) return true
      }
    }
  }
  return false
}

function sanitize(value, maxRuns) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== STATE_VERSION
    || !Array.isArray(value.runs)) {
    const error = new Error('模型路由状态版本或结构不受支持；原文件未修改，请先恢复或升级兼容版本。')
    error.code = 'ROUTER_STATE_UNSUPPORTED'
    throw error
  }
  const runs = value.runs.filter(run => run && typeof run.id === 'string')
  return retainRuns({
    version: STATE_VERSION,
    // Unlike bounded notices, an incomplete-history marker cannot silently
    // expire. Restoring a verified state file is required to recover budgets.
    historyIncomplete: value.historyIncomplete === true || runs.length !== value.runs.length
      || invalidArchivedSpending(value.archivedSpending) || runs.some(invalidRunSpending)
      || sanitizeNotices(value.notices).some(notice => notice.kind === 'state-corrupt'),
    onboarding: { completedAt: Number.isFinite(value.onboarding?.completedAt) ? value.onboarding.completedAt : null },
    health: value.health && Array.isArray(value.health.tools) ? value.health : null,
    quota: value.quota && typeof value.quota === 'object' && !Array.isArray(value.quota) ? value.quota : {},
    authFailures: Object.fromEntries(Object.entries(value.authFailures && typeof value.authFailures === 'object' && !Array.isArray(value.authFailures) ? value.authFailures : {})
      .filter(([, entry]) => Number.isFinite(entry?.at))),
    runs,
    dynamicData: value.dynamicData && typeof value.dynamicData === 'object' && !Array.isArray(value.dynamicData) ? value.dynamicData : { liveBench: null, pricing: null, status: {}, revision: '' },
    archivedSpending: sanitizeArchivedSpending(value.archivedSpending),
    notices: sanitizeNotices(value.notices),
    terminalSessions: sanitizeTerminalSessions(value.terminalSessions),
  }, maxRuns)
}

function sanitizeTerminalSessions(value) {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item.id === 'string' && typeof item.target === 'string' && Number.isFinite(item.startedAt)).slice(-MAX_TERMINAL_SESSIONS)
    : []
}

/** Session metadata only: never input, output or environment. */
export function terminalSessionRecord(record) {
  const finite = value => Number.isFinite(value) ? value : null
  return {
    id: String(record.id), target: String(record.target), label: String(record.label ?? record.target).slice(0, 80),
    mode: record.mode === 'login' ? 'login' : 'interactive', cwd: String(record.cwd ?? '').slice(0, 4_096),
    backend: record.backend === 'pipe' ? 'pipe' : 'pty', startedAt: finite(record.startedAt), finishedAt: finite(record.finishedAt),
    durationMs: finite(record.durationMs), exitCode: Number.isInteger(record.exitCode) ? record.exitCode : null,
    endReason: ['exit', 'stopped', 'orphan', 'lifetime', 'dispose'].includes(record.endReason) ? record.endReason : 'exit',
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const stamp = at => new Date(at).toISOString().replace(/[:.]/g, '-')

function ownerPid(raw) {
  try {
    const pid = JSON.parse(raw).pid
    if (Number.isSafeInteger(pid) && pid > 0) return pid
  } catch { /* support the previous pid/timestamp format */ }
  const pid = Number(/^(\d+)\s+\d+\s*$/u.exec(raw)?.[1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

function ownerIsDead(pid) {
  if (pid === null) return false
  try { process.kill(pid, 0); return false }
  catch (error) { return error?.code === 'ESRCH' }
}

/** Never steal a live or unknown owner's lock, even after the wait timeout. */
async function acquireLock(lockFile, { staleMs = LOCK_STALE_MS, timeoutMs = LOCK_TIMEOUT_MS, now = Date.now } = {}) {
  // Elapsed waits must not freeze or jump when wall-clock time changes.
  const started = performance.now()
  for (let attempt = 0; ; attempt += 1) {
    try {
      const handle = await open(lockFile, 'wx')
      const owner = `${JSON.stringify({ pid: process.pid, token: randomUUID(), at: now() })}\n`
      try { await handle.writeFile(owner, 'utf8') }
      catch (error) { await handle.close(); await unlink(lockFile).catch(() => {}); throw error }
      await handle.close()
      return async () => {
        if (await readFile(lockFile, 'utf8').catch(() => null) === owner) await unlink(lockFile).catch(() => {})
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const info = await stat(lockFile).catch(() => null)
      const owner = await readFile(lockFile, 'utf8').catch(() => null)
      if (info && owner !== null && now() - info.mtimeMs > staleMs && ownerIsDead(ownerPid(owner))) {
        const currentInfo = await stat(lockFile).catch(() => null)
        if (currentInfo?.ino === info.ino && currentInfo?.mtimeMs === info.mtimeMs
          && await readFile(lockFile, 'utf8').catch(() => null) === owner) {
          await unlink(lockFile).catch(() => {})
          continue
        }
      }
      if (performance.now() - started >= timeoutMs) {
        const failure = new Error('模型路由状态正在被其他操作使用，保存未完成；请稍后重试。')
        failure.code = 'ROUTER_STATE_LOCK_TIMEOUT'
        throw failure
      }
      await sleep(Math.min(5 + attempt * 5, 50) + Math.floor(Math.random() * 10))
    }
  }
}

export function createRouterState({ file = defaultStatePath(), maxRuns = MAX_RUNS, now = Date.now,
  lockTimeoutMs = LOCK_TIMEOUT_MS, lockStaleMs = LOCK_STALE_MS } = {}) {
  if (![lockTimeoutMs, lockStaleMs].every(value => Number.isFinite(value) && value >= 1 && value <= 3_600_000)) {
    throw new RangeError('Lock timing must be between 1 and 3600000 milliseconds')
  }
  const historyLimit = Number.isInteger(maxRuns) && maxRuns > 0 ? Math.min(maxRuns, MAX_RUNS) : MAX_RUNS
  let cache = null
  let cacheKey = ''
  let cacheCorrupt = false
  let chain = Promise.resolve()
  let pendingNotices = []
  const lockFile = `${file}.lock`
  const fileKey = async () => {
    const info = await stat(file).catch(() => null)
    return info ? `${info.mtimeMs}:${info.size}:${info.ino}` : 'missing'
  }
  /** Parse the file; keep an unparseable file as a backup and record a notice. */
  const readFresh = async ({ recoverCorrupt = false } = {}) => {
    let raw
    try { raw = await readFile(file, 'utf8') }
    catch (error) {
      if (error?.code === 'ENOENT') return { state: emptyState(), corrupt: false }
      throw error
    }
    let parsed
    try { parsed = JSON.parse(raw) }
    catch {
      // Readers do not rename files outside the writer lock. Recheck under the
      // lock so a concurrent valid replacement cannot be discarded as corrupt.
      if (!recoverCorrupt) return { state: emptyState(), corrupt: true }
      const at = now()
      const backup = `${file}.corrupt-${stamp(at)}-${randomUUID()}`
      await rename(file, backup)
      pendingNotices.push({
        kind: 'state-corrupt', at, backup,
        message: `模型路由状态文件已损坏，无法读取，已备份为 ${backup} 并重新开始记录。执行历史、评价和订阅冷却信息需要从备份中人工恢复。`,
      })
      return { state: { ...emptyState(), historyIncomplete: true }, corrupt: true }
    }
    // Valid JSON with an unknown schema is not corrupt: preserve it exactly,
    // and refuse both reads-as-empty and writes that would downgrade it.
    return { state: sanitize(parsed, historyLimit), corrupt: false }
  }
  const load = async () => {
    const key = await fileKey()
    if (cache && key === cacheKey) return cache
    const fresh = await readFresh()
    cache = fresh.state
    cacheKey = key
    cacheCorrupt = fresh.corrupt
    return cache
  }
  const persist = async state => {
    await mkdir(dirname(file), { recursive: true })
    const committed = structuredClone(state)
    const serialized = `${JSON.stringify(committed)}\n`
    const temp = `${file}.${process.pid}.${now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    try {
      await writeFile(temp, serialized, 'utf8')
      await rename(temp, file)
    } finally { await unlink(temp).catch(() => {}) }
    cache = committed
    cacheKey = await fileKey()
    cacheCorrupt = false
  }
  /**
   * Serialize read-modify-write updates within this process and, through the
   * lock file, across processes. `change` mutates a freshly read state.
   */
  const update = change => {
    const next = chain.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const release = await acquireLock(lockFile, { now, timeoutMs: lockTimeoutMs, staleMs: lockStaleMs })
      try {
        cache = null
        const { state } = await readFresh({ recoverCorrupt: true })
        if (pendingNotices.length) state.notices.push(...pendingNotices)
        const result = await change(state)
        const returned = result === undefined ? undefined : structuredClone(result)
        retainRuns(state, historyLimit)
        state.notices = sanitizeNotices(state.notices)
        state.terminalSessions = sanitizeTerminalSessions(state.terminalSessions)
        await persist(state)
        pendingNotices = []
        return returned
      } catch (error) {
        // A rejected callback or disk write must not leak uncommitted state
        // into the reader cache, including partial rating/budget changes.
        cache = null
        cacheKey = ''
        cacheCorrupt = false
        throw error
      } finally {
        await release()
      }
    })
    chain = next.catch(() => {})
    return next
  }
  /** A corrupt file found on read is backed up and replaced under the lock. */
  const read = async () => {
    await chain
    const state = await load()
    if (cacheCorrupt || pendingNotices.length) {
      const notices = [...pendingNotices]
      try { await update(() => {}) }
      catch {
        return structuredClone({ ...state, notices: [...state.notices, ...notices,
          { kind: 'state-recovery-pending', at: now(), message: '模型路由状态恢复未完成；原文件保留，请稍后重试。' }] })
      }
      return structuredClone(cache)
    }
    return structuredClone(state)
  }
  return {
    file,
    read,
    update,
    completeOnboarding: at => update(current => { current.onboarding.completedAt = at; return current.onboarding }),
    saveHealth: report => update(current => { current.health = report; return report }),
    /** Subscription exhaustion snapshot (`createQuotaTracker().snapshot()`). */
    saveQuota: (snapshot, { removed = [] } = {}) => update(current => {
      // Merge: keep other processes' unexpired entries, apply this process's marks and clears.
      const at = now()
      const merged = Object.fromEntries(Object.entries(current.quota ?? {}).filter(([, entry]) => Number.isFinite(entry?.until) && entry.until > at))
      Object.assign(merged, snapshot && typeof snapshot === 'object' ? snapshot : {})
      for (const key of Array.isArray(removed) ? removed : []) delete merged[key]
      current.quota = merged
      return current.quota
    }),
    /** A CLI failed authentication while running on its subscription (null clears it). */
    saveAuthFailure: (toolId, entry) => update(current => {
      if (entry) current.authFailures[toolId] = { at: entry.at, detail: String(entry.detail ?? '').slice(0, 200) }
      else delete current.authFailures[toolId]
      return current.authFailures
    }),
    appendTerminalSession: record => update(current => {
      const entry = terminalSessionRecord(record)
      current.terminalSessions = [...(current.terminalSessions ?? []), entry]
      return entry
    }),
    appendRun: run => update(current => { current.runs.push(run); return run }),
    updateRun: (id, change) => update(async current => {
      const run = current.runs.find(item => item.id === id)
      if (!run) throw new Error(`未找到运行记录 ${id}`)
      await change(run)
      return structuredClone(run)
    }),
    /** Remove one notice (for example after the user read the corrupt-file warning). */
    dismissNotice: at => update(current => { current.notices = current.notices.filter(item => item.at !== at); return current.notices }),
  }
}
