/**
 * In-memory Host workbench jobs. Only package identity and state enter progress;
 * answers and the rest of the workbench response stay in the final result.
 */
import { randomUUID } from 'node:crypto'

const ACTIVE = new Set(['running', 'cancelling'])
const PACKAGE_DONE = new Set(['succeeded', 'failed', 'cancelled', 'blocked', 'skipped'])
const FAILURE = 'Run failed. Please try again.'

const copy = value => JSON.parse(JSON.stringify(value))
const label = (value, fallback = '') => typeof value === 'string' ? value : fallback

function positiveLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer.`)
  return value
}

function completionStatus(item) {
  if (item.cancelled === true || item.status === 'cancelled') return 'cancelled'
  if (item.blocked === true || item.status === 'blocked') return 'blocked'
  if (item.notStarted === true || item.status === 'skipped') return 'skipped'
  if (item.status === 'succeeded' || item.status === 'failed') return item.status
  return item.ok === true ? 'succeeded' : 'failed'
}

/**
 * start() returns before invoking run(). Cancellation requests abort the same
 * signal given to run(), but the job remains active until run actually settles.
 * maxJobs bounds all retained jobs, and only terminal jobs may be evicted.
 */
export function createRunJobs({ now = Date.now, maxJobs = 50, maxActive = 4 } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function.')
  positiveLimit(maxJobs, 'maxJobs')
  positiveLimit(maxActive, 'maxActive')
  const jobs = new Map()
  let disposed = false

  // A clock supplied by a Host must not turn a settled worker into an unhandled
  // rejection or make a snapshot impossible to send over JSON.
  const timestamp = () => {
    try {
      const value = now()
      if (typeof value === 'number' && Number.isFinite(value)) return value
    } catch { /* retain a usable timestamp if the injected clock fails */ }
    return Date.now()
  }
  const snapshot = job => copy(job.snapshot)
  const find = jobId => {
    const job = jobs.get(jobId)
    if (!job) throw new Error('Unknown run job id.')
    return job
  }

  function refreshProgress(job) {
    const progress = job.snapshot.progress
    progress.total = progress.packages.length
    progress.completed = progress.packages.filter(item => PACKAGE_DONE.has(item.status)).length
    const current = progress.packages.findLast(item => item.status === 'running')
    progress.current = current ? { id: current.id, name: current.name } : null
  }

  function packageFor(job, value) {
    if (!value || typeof value !== 'object') return null
    const id = label(value.id)
    if (!id) return null
    let item = job.snapshot.progress.packages.find(item => item.id === id)
    if (!item) {
      item = { id, name: label(value.name, id), status: 'pending' }
      job.snapshot.progress.packages.push(item)
    }
    return item
  }

  function progressFor(job, event) {
    if (!ACTIVE.has(job.snapshot.status) || !event || typeof event !== 'object') return
    // Progress is advisory: malformed events must not break the actual worker.
    try {
      if (event.type === 'stage') {
        if (typeof event.stage === 'string') job.snapshot.progress.stage = event.stage.slice(0, 120)
        return
      }
      if (event.type !== 'package-start' && event.type !== 'package-complete') return
      const item = packageFor(job, event.package)
      if (!item || PACKAGE_DONE.has(item.status)) return
      item.status = event.type === 'package-start' ? 'running' : completionStatus(event.package)
      refreshProgress(job)
    } catch { /* progress cannot affect the final workbench response */ }
  }

  function finish(job, status, result = null) {
    if (!ACTIVE.has(job.snapshot.status)) return
    const state = job.snapshot
    state.status = status
    state.finishedAt = timestamp()
    state.result = result
    state.progress.stage = status
    for (const item of state.progress.packages) {
      if (PACKAGE_DONE.has(item.status)) continue
      // Pending packages were never observed running; once the worker settles,
      // they cannot start. An interrupted running package has a known outcome.
      item.status = status === 'cancelled' ? 'cancelled'
        : item.status === 'running' ? (status === 'failed' ? 'failed' : 'succeeded') : 'skipped'
    }
    refreshProgress(job)
    if (status === 'failed') state.error = FAILURE
  }

  function fail(job) {
    finish(job, job.controller.signal.aborted ? 'cancelled' : 'failed')
  }

  function requestCancel(job) {
    if (ACTIVE.has(job.snapshot.status) && !job.snapshot.cancelRequested) {
      job.snapshot.cancelRequested = true
      job.snapshot.status = 'cancelling'
      job.snapshot.progress.stage = 'cancelling'
      job.controller.abort()
    }
    return snapshot(job)
  }

  return {
    start({ run, packages = [] } = {}) {
      if (disposed) throw new Error('Run job manager is disposed.')
      if (typeof run !== 'function') throw new TypeError('Run job requires a run function.')
      if ([...jobs.values()].filter(job => ACTIVE.has(job.snapshot.status)).length >= maxActive) {
        throw new Error('Too many active run jobs.')
      }
      // Evict the oldest terminal snapshots first. A cancelling worker still
      // occupies capacity because its process/cleanup may still be running.
      if (jobs.size >= maxJobs) {
        const terminal = [...jobs].find(([, job]) => !ACTIVE.has(job.snapshot.status))
        if (!terminal) throw new Error('Run job capacity reached; active jobs are still running.')
        jobs.delete(terminal[0])
      }
      const job = {
        controller: new AbortController(),
        snapshot: {
          jobId: randomUUID(), status: 'running', startedAt: timestamp(), finishedAt: null,
          cancelRequested: false,
          progress: { total: 0, completed: 0, current: null, stage: 'starting', packages: [] },
          result: null,
        },
      }
      for (const item of Array.isArray(packages) ? packages : []) packageFor(job, item)
      refreshProgress(job)
      jobs.set(job.snapshot.jobId, job)
      // Both rejection paths are attached before the worker can run. Result
      // cloning also detaches the worker's mutable response from stored state.
      Promise.resolve().then(() => run({
        signal: job.controller.signal,
        onProgress: event => progressFor(job, event),
      })).then(result => {
        const value = result == null ? null : copy(result)
        const cancelled = value?.status === 'cancelled' || value?.execution?.status === 'cancelled'
        finish(job, cancelled ? 'cancelled' : 'completed', value)
      }, () => fail(job)).catch(() => fail(job))
      return snapshot(job)
    },
    status(jobId) { return snapshot(find(jobId)) },
    cancel(jobId) { return requestCancel(find(jobId)) },
    dispose() {
      if (disposed) return
      disposed = true
      for (const job of jobs.values()) requestCancel(job)
    },
  }
}
