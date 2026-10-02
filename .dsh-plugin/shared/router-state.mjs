/**
 * Small persistent Host state for the router: onboarding flag, last health
 * check, subscription quota exhaustion, and the bounded run ledger (routing decisions, channels, fallback
 * errors, cost, review and user ratings). One JSON file under the DSH home. Never stores keys.
 *
 * Several Host processes may share one DSH home, so every update takes a
 * lock file (`state.json.lock`, exclusive create; stale locks are broken),
 * re-reads the file, applies the change to the fresh copy and writes it back
 * atomically (temp file + rename). Reads re-read the file when its mtime or
 * size changed. A file that cannot be parsed is kept as
 * `state.json.corrupt-<timestamp>` and a notice is recorded instead of
 * silently discarding the history.
 */
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

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
const LOCK_STALE_MS = 15_000
const LOCK_TIMEOUT_MS = 10_000

function emptyState() {
  return { version: STATE_VERSION, onboarding: { completedAt: null }, health: null, quota: {}, authFailures: {}, runs: [], notices: [] }
}

function sanitizeNotices(value) {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item.kind === 'string' && typeof item.message === 'string').slice(-MAX_NOTICES)
    : []
}

function sanitize(value) {
  if (!value || typeof value !== 'object' || value.version !== STATE_VERSION) return emptyState()
  return {
    version: STATE_VERSION,
    onboarding: { completedAt: Number.isFinite(value.onboarding?.completedAt) ? value.onboarding.completedAt : null },
    health: value.health && Array.isArray(value.health.tools) ? value.health : null,
    quota: value.quota && typeof value.quota === 'object' && !Array.isArray(value.quota) ? value.quota : {},
    authFailures: Object.fromEntries(Object.entries(value.authFailures && typeof value.authFailures === 'object' && !Array.isArray(value.authFailures) ? value.authFailures : {})
      .filter(([, entry]) => Number.isFinite(entry?.at))),
    runs: Array.isArray(value.runs) ? value.runs.filter(run => run && typeof run.id === 'string').slice(-MAX_RUNS) : [],
    notices: sanitizeNotices(value.notices),
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const stamp = at => new Date(at).toISOString().replace(/[:.]/g, '-')

/** Exclusive lock file; a lock older than `staleMs` (crashed holder) is broken. */
async function acquireLock(lockFile, { staleMs = LOCK_STALE_MS, timeoutMs = LOCK_TIMEOUT_MS, now = Date.now } = {}) {
  const started = now()
  for (let attempt = 0; ; attempt += 1) {
    try {
      const handle = await open(lockFile, 'wx')
      await handle.writeFile(`${process.pid} ${now()}\n`, 'utf8').catch(() => {})
      await handle.close()
      return async () => { await unlink(lockFile).catch(() => {}) }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const info = await stat(lockFile).catch(() => null)
      if (info && now() - info.mtimeMs > staleMs) {
        await unlink(lockFile).catch(() => {})
        continue
      }
      if (now() - started > timeoutMs) {
        // A live holder that never releases: break it rather than lose the write.
        await unlink(lockFile).catch(() => {})
        continue
      }
      await sleep(Math.min(5 + attempt * 5, 50) + Math.floor(Math.random() * 10))
    }
  }
}

export function createRouterState({ file = defaultStatePath(), maxRuns = MAX_RUNS, now = Date.now } = {}) {
  let cache = null
  let cacheKey = ''
  let chain = Promise.resolve()
  let pendingNotices = []
  const lockFile = `${file}.lock`
  const fileKey = async () => {
    const info = await stat(file).catch(() => null)
    return info ? `${info.mtimeMs}:${info.size}:${info.ino}` : 'missing'
  }
  /** Parse the file; keep an unparseable file as a backup and record a notice. */
  const readFresh = async () => {
    let raw
    try { raw = await readFile(file, 'utf8') }
    catch (error) {
      if (error?.code === 'ENOENT') return { state: emptyState(), corrupt: false }
      throw error
    }
    try { return { state: sanitize(JSON.parse(raw)), corrupt: false } }
    catch {
      const at = now()
      const backup = `${file}.corrupt-${stamp(at)}`
      let saved = true
      try { await rename(file, backup) } catch { saved = false }
      pendingNotices.push({
        kind: 'state-corrupt', at, backup: saved ? backup : null,
        message: saved
          ? `模型路由状态文件已损坏，无法读取，已备份为 ${backup} 并重新开始记录。执行历史、评价和订阅冷却信息需要从备份中人工恢复。`
          : '模型路由状态文件已损坏，无法读取，备份失败；已重新开始记录。',
      })
      return { state: emptyState(), corrupt: true }
    }
  }
  const load = async () => {
    const key = await fileKey()
    if (cache && key === cacheKey) return cache
    const fresh = await readFresh()
    cache = fresh.state
    cacheKey = fresh.corrupt ? '' : key
    return cache
  }
  const persist = async state => {
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    await writeFile(temp, `${JSON.stringify(state)}\n`, 'utf8')
    await rename(temp, file)
    cache = state
    cacheKey = await fileKey()
  }
  /**
   * Serialize read-modify-write updates within this process and, through the
   * lock file, across processes. `change` mutates a freshly read state.
   */
  const update = change => {
    const next = chain.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const release = await acquireLock(lockFile, { now })
      try {
        cache = null
        const state = await load()
        if (pendingNotices.length) { state.notices.push(...pendingNotices); pendingNotices = [] }
        const result = await change(state)
        state.runs = state.runs.slice(-maxRuns)
        state.notices = sanitizeNotices(state.notices)
        await persist(state)
        return result
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
    if (pendingNotices.length) {
      const notices = [...pendingNotices]
      try { await update(() => {}) } catch { return structuredClone({ ...state, notices: [...state.notices, ...notices] }) }
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
    appendRun: run => update(current => { current.runs.push(run); return run }),
    updateRun: (id, change) => update(current => {
      const run = current.runs.find(item => item.id === id)
      if (!run) throw new Error(`未找到运行记录 ${id}`)
      change(run)
      return structuredClone(run)
    }),
    /** Remove one notice (for example after the user read the corrupt-file warning). */
    dismissNotice: at => update(current => { current.notices = current.notices.filter(item => item.at !== at); return current.notices }),
  }
}
