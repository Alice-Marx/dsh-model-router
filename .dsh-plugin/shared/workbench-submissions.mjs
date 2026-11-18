import { createHash, randomUUID } from 'node:crypto'
import { workbenchRequestKey } from './workbench-request-key.mjs'

const FINGERPRINT = /^[0-9a-f]{64}$/

export function inspectWorkbenchSubmissions(value) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workbench submissions')
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    workbenchRequestKey(key)
    workbenchRequestKey(entry?.jobId)
    if (typeof entry.fingerprint !== 'string' || !FINGERPRINT.test(entry.fingerprint) || !Number.isFinite(entry.startedAt)
      || (entry.finishedAt !== undefined && (!Number.isFinite(entry.finishedAt) || typeof entry.outcome !== 'string'))) {
      throw new Error('Invalid workbench submission record')
    }
    return [key, { jobId: entry.jobId, fingerprint: entry.fingerprint, startedAt: entry.startedAt,
      ...(entry.finishedAt === undefined ? {} : { finishedAt: entry.finishedAt, outcome: entry.outcome }) }]
  }))
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]))
}

export function workbenchFingerprint(request) {
  const { requestKey: _key, confirmedReasons, ...intent } = request
  return createHash('sha256').update(JSON.stringify(ordered({
    ...intent, confirmedReasons: [...new Set(confirmedReasons ?? [])].sort(),
  }))).digest('hex')
}

function checkFingerprint(entry, fingerprint) {
  if (entry.fingerprint !== fingerprint) throw new Error('此提交编号已经绑定另一份执行请求。请核对原任务。')
  return entry
}

export function workbenchSubmissions(state, jobs, now = Date.now) {
  const existing = (snapshot, key) => snapshot.workbenchSubmissions?.[key] ?? null
  const view = (entry, snapshot) => {
    const live = jobs.lookup(entry.jobId)
    if (live) return live
    const run = snapshot.runs.find(item => item.id === entry.jobId)
    const finished = entry.finishedAt !== undefined
    return {
      jobId: entry.jobId, startedAt: entry.startedAt, finishedAt: entry.finishedAt ?? null,
      status: finished ? 'completed' : 'unconfirmed', cancelRequested: false,
      progress: { total: 0, completed: 0, current: null, stage: '', packages: [] },
      result: { status: entry.outcome ?? 'unknown', runId: run?.id ?? null },
    }
  }

  return {
    async lookup(key, fingerprint) {
      const snapshot = await state.read()
      const entry = existing(snapshot, key)
      if (!entry) return null
      if (fingerprint !== undefined) checkFingerprint(entry, fingerprint)
      return view(entry, snapshot)
    },
    async claim(key, fingerprint) {
      const proposal = { jobId: randomUUID(), startedAt: now(), fingerprint }
      return state.update(snapshot => {
        const previous = existing(snapshot, key)
        if (previous) return { accepted: false, entry: checkFingerprint(previous, fingerprint) }
        snapshot.workbenchSubmissions ??= {}
        snapshot.workbenchSubmissions[key] = proposal
        return { accepted: true, entry: proposal }
      }, { retrySafe: true })
    },
    finish(key, jobId, outcome) {
      const finishedAt = now()
      return state.update(snapshot => {
        const entry = existing(snapshot, key)
        if (entry?.jobId === jobId && entry.finishedAt === undefined) {
          entry.finishedAt = finishedAt
          entry.outcome = typeof outcome === 'string' ? outcome.slice(0, 48) : 'unknown'
        }
      }, { retrySafe: true })
    },
  }
}
