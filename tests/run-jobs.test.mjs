import test from 'node:test'
import assert from 'node:assert/strict'
import { createRunJobs } from '../.dsh-plugin/shared/run-jobs.mjs'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('run jobs: start returns a JSON snapshot immediately, before a delayed worker starts', async () => {
  const worker = deferred()
  let called = false
  let at = 100
  const jobs = createRunJobs({ now: () => at })
  const started = jobs.start({ packages: [{ id: 'first', name: 'First' }], run: async () => {
    called = true
    return worker.promise
  } })
  assert.equal(called, false)
  assert.equal(started.status, 'running')
  assert.equal(started.startedAt, 100)
  assert.equal(started.finishedAt, null)
  assert.equal(started.result, null)
  assert.deepEqual(JSON.parse(JSON.stringify(started)), started)
  await flush()
  assert.equal(called, true)
  assert.equal(jobs.status(started.jobId).status, 'running')
  at = 200
  worker.resolve({ ok: true, answer: 'final answer' })
  await flush()
  const done = jobs.status(started.jobId)
  assert.equal(done.status, 'completed')
  assert.equal(done.finishedAt, 200)
  assert.deepEqual(done.result, { ok: true, answer: 'final answer' })
  assert.equal(done.progress.packages[0].status, 'skipped')
})

test('run jobs: progress projects only metadata, counts packages once, and ignores late events', async () => {
  const worker = deferred()
  let progress
  const packages = [{ id: 'a', name: 'Plan', task: 'secret task', credentials: { key: 'secret' } }, { id: 'b', name: 'Write' }]
  const jobs = createRunJobs()
  const started = jobs.start({ packages, run: async ({ onProgress }) => { progress = onProgress; return worker.promise } })
  packages[0].name = 'mutated input'
  await flush()
  progress({ type: 'stage', stage: 'preparing', answer: 'secret' })
  assert.equal(jobs.status(started.jobId).progress.stage, 'preparing')
  progress({ type: 'package-start', package: { ...packages[0], answer: 'secret', diagnostics: { key: 'secret' } } })
  assert.deepEqual(jobs.status(started.jobId).progress, {
    total: 2, completed: 0, current: { id: 'a', name: 'Plan' }, stage: 'preparing',
    packages: [{ id: 'a', name: 'Plan', status: 'running' }, { id: 'b', name: 'Write', status: 'pending' }],
  })
  progress({ type: 'package-complete', package: { id: 'a', ok: true, answer: 'secret' } })
  progress({ type: 'package-complete', package: { id: 'a', ok: false } })
  progress({ type: 'package-start', package: { id: 'a' } })
  assert.equal(jobs.status(started.jobId).progress.completed, 1)
  assert.equal(jobs.status(started.jobId).progress.packages[0].status, 'succeeded')
  assert.equal(jobs.status(started.jobId).progress.current, null)
  progress({ type: 'package-start', package: { id: 'b' } })
  progress({ type: 'package-complete', package: { id: 'b', ok: false } })
  assert.equal(jobs.status(started.jobId).progress.completed, 2)
  assert.doesNotMatch(JSON.stringify(jobs.status(started.jobId).progress), /secret|answer|task|credentials|diagnostics/)
  worker.resolve({ ok: false })
  await flush()
  const done = jobs.status(started.jobId)
  progress({ type: 'stage', stage: 'late' })
  progress({ type: 'package-start', package: { id: 'late' } })
  assert.deepEqual(jobs.status(started.jobId), done)
})

test('run jobs: terminal package flags retain cancelled, blocked, skipped, and failed outcomes', async () => {
  const jobs = createRunJobs()
  const result = jobs.start({ run: async ({ onProgress }) => {
    for (const item of [
      { id: 'cancelled', cancelled: true, notStarted: true },
      { id: 'blocked', blocked: true, ok: false },
      { id: 'skipped', notStarted: true },
      { id: 'failed', status: 'timeout', ok: false },
      { id: 'succeeded', status: 'succeeded' },
    ]) onProgress({ type: 'package-complete', package: item })
    return { ok: false }
  } })
  await flush()
  const done = jobs.status(result.jobId)
  assert.equal(done.status, 'completed', 'a resolved workbench failure still has its real result')
  assert.equal(done.progress.total, 5)
  assert.equal(done.progress.completed, 5)
  assert.deepEqual(done.progress.packages.map(item => item.status), ['cancelled', 'blocked', 'skipped', 'failed', 'succeeded'])
})

test('run jobs: cancel aborts the original signal immediately and waits for cleanup to settle', async () => {
  const cleanup = deferred()
  let signal, aborted = 0
  const jobs = createRunJobs()
  const started = jobs.start({ packages: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], run: async options => {
    signal = options.signal
    options.onProgress({ type: 'package-start', package: { id: 'a' } })
    await new Promise(resolve => signal.addEventListener('abort', () => { aborted++; resolve() }, { once: true }))
    options.onProgress({ type: 'stage', stage: 'cleaning-up' })
    await cleanup.promise
    throw new Error('SECRET cleanup rejection')
  } })
  await flush()
  const cancelling = jobs.cancel(started.jobId)
  assert.equal(signal.aborted, true)
  assert.equal(aborted, 1)
  assert.equal(cancelling.status, 'cancelling')
  assert.equal(cancelling.cancelRequested, true)
  assert.equal(cancelling.finishedAt, null)
  assert.equal(cancelling.progress.packages[0].status, 'running')
  assert.equal(cancelling.progress.packages[1].status, 'pending')
  assert.equal(jobs.cancel(started.jobId).status, 'cancelling')
  assert.equal(aborted, 1)
  await flush()
  assert.equal(jobs.status(started.jobId).status, 'cancelling')
  assert.equal(jobs.status(started.jobId).progress.stage, 'cleaning-up')
  cleanup.resolve()
  await flush()
  const done = jobs.status(started.jobId)
  assert.equal(done.status, 'cancelled')
  assert.notEqual(done.finishedAt, null)
  assert.equal(done.progress.current, null)
  assert.deepEqual(done.progress.packages.map(item => item.status), ['cancelled', 'cancelled'])
  assert.equal(done.result, null)
  assert.doesNotMatch(JSON.stringify(done), /SECRET|rejection/)
  assert.deepEqual(jobs.cancel(started.jobId), done)
})

test('run jobs: a cancellation before the worker microtask reaches the same aborted signal', async () => {
  let signal
  const jobs = createRunJobs()
  const started = jobs.start({ run: async options => {
    signal = options.signal
    assert.equal(signal.aborted, true)
    return { status: 'cancelled', partial: 'retained' }
  } })
  assert.equal(jobs.cancel(started.jobId).status, 'cancelling')
  await flush()
  const done = jobs.status(started.jobId)
  assert.equal(signal.aborted, true)
  assert.equal(done.status, 'cancelled')
  assert.equal(done.result.partial, 'retained')
})

test('run jobs: late cancellation preserves a normal response and terminal cancel is immutable', async () => {
  const worker = deferred()
  let signal
  const jobs = createRunJobs()
  const started = jobs.start({ run: async options => { signal = options.signal; return worker.promise } })
  await flush()
  worker.resolve({ ok: true, answer: 'finished' })
  jobs.cancel(started.jobId)
  assert.equal(signal.aborted, true)
  await flush()
  const done = jobs.status(started.jobId)
  assert.equal(done.status, 'completed')
  assert.equal(done.cancelRequested, true)
  assert.equal(done.result.answer, 'finished')
  assert.deepEqual(jobs.cancel(started.jobId), done)
  const another = jobs.start({ run: async () => ({ ok: true }) })
  await flush()
  const completed = jobs.status(another.jobId)
  assert.equal(completed.cancelRequested, false)
  assert.deepEqual(jobs.cancel(another.jobId), completed)
})

test('run jobs: direct and nested execution cancellation map to cancelled with the full response', async () => {
  const jobs = createRunJobs()
  for (const result of [{ status: 'cancelled', partial: [1] }, { execution: { status: 'cancelled' }, run: { id: 'record' } }]) {
    const started = jobs.start({ run: async () => result })
    await flush()
    const done = jobs.status(started.jobId)
    assert.equal(done.status, 'cancelled')
    assert.equal(done.cancelRequested, false)
    assert.deepEqual(done.result, result)
  }
})

test('run jobs: synchronous throws, rejected workers, and unserializable responses use a generic error', async () => {
  const jobs = createRunJobs()
  for (const run of [
    () => { throw new Error('SECRET credentials api-key') },
    async () => { throw new Error('SECRET provider diagnostics') },
    async () => ({ privateValue: 1n }),
  ]) {
    const started = jobs.start({ run })
    await flush()
    const failed = jobs.status(started.jobId)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.result, null)
    assert.equal(failed.error, 'Run failed. Please try again.')
    assert.doesNotMatch(JSON.stringify(failed), /SECRET|api-key|diagnostics|privateValue/)
    assert.deepEqual(jobs.cancel(started.jobId), failed)
  }
})

test('run jobs: start, status, cancel, and worker result cannot mutate stored snapshots', async () => {
  const worker = deferred()
  const jobs = createRunJobs()
  const started = jobs.start({ packages: [{ id: 'a', name: 'A' }], run: async () => worker.promise })
  const id = started.jobId
  started.progress.packages[0].name = 'changed'
  started.status = 'completed'
  const status = jobs.status(id)
  assert.equal(status.progress.packages[0].name, 'A')
  assert.equal(status.status, 'running')
  status.progress.packages.push({ id: 'injected' })
  const cancelling = jobs.cancel(id)
  cancelling.cancelRequested = false
  cancelling.progress.packages[0].status = 'succeeded'
  assert.equal(jobs.status(id).cancelRequested, true)
  assert.equal(jobs.status(id).progress.packages.length, 1)
  const response = { execution: { status: 'cancelled', packages: [{ answer: 'real' }] } }
  worker.resolve(response)
  await flush()
  response.execution.packages[0].answer = 'changed by worker'
  const done = jobs.status(id)
  assert.equal(done.result.execution.packages[0].answer, 'real')
  done.result.execution.packages[0].answer = 'changed by caller'
  assert.equal(jobs.status(id).result.execution.packages[0].answer, 'real')
})

test('run jobs: active capacity includes cancelling workers until they settle', async () => {
  const worker = deferred()
  const jobs = createRunJobs({ maxActive: 1 })
  const first = jobs.start({ run: async () => worker.promise })
  assert.throws(() => jobs.start({ run: async () => null }), /Too many active/)
  jobs.cancel(first.jobId)
  assert.throws(() => jobs.start({ run: async () => null }), /Too many active/)
  worker.resolve({ status: 'cancelled' })
  await flush()
  const next = jobs.start({ run: async () => ({ ok: true }) })
  assert.equal(next.status, 'running')
  await flush()
})

test('run jobs: retention evicts the oldest terminal job and never an active job', async () => {
  const worker = deferred()
  const jobs = createRunJobs({ maxJobs: 2, maxActive: 2 })
  const active = jobs.start({ run: async () => worker.promise })
  const old = jobs.start({ run: async () => ({ ok: true }) })
  await flush()
  const next = jobs.start({ run: async () => ({ ok: true }) })
  assert.equal(jobs.status(active.jobId).status, 'running')
  assert.throws(() => jobs.status(old.jobId), /Unknown run job id/)
  assert.throws(() => jobs.cancel(old.jobId), /Unknown run job id/)
  await flush()
  assert.equal(jobs.status(next.jobId).status, 'completed')
  worker.resolve({ ok: true })
  await flush()
})

test('run jobs: a full retention limit rejects starts without discarding any active job', async () => {
  const worker = deferred()
  const jobs = createRunJobs({ maxJobs: 1, maxActive: 2 })
  const active = jobs.start({ run: async () => worker.promise })
  assert.throws(() => jobs.start({ run: async () => null }), /capacity reached/)
  assert.equal(jobs.status(active.jobId).status, 'running')
  worker.resolve(null)
  await flush()
})

test('run jobs: dispose aborts all active workers, waits for their cleanup, and handles rejections', async () => {
  const cleanup = deferred()
  const signals = []
  const jobs = createRunJobs()
  const ids = [1, 2].map(() => jobs.start({ run: async ({ signal }) => {
    signals.push(signal)
    await cleanup.promise
    throw new Error('SECRET disposed worker')
  } }).jobId)
  await flush()
  jobs.dispose()
  jobs.dispose()
  assert.equal(signals.every(signal => signal.aborted), true)
  assert.equal(ids.every(id => jobs.status(id).status === 'cancelling'), true)
  assert.throws(() => jobs.start({ run: async () => null }), /disposed/)
  cleanup.resolve()
  await flush()
  assert.equal(ids.every(id => jobs.status(id).status === 'cancelled'), true)
})

test('run jobs: unknown ids, invalid settings and missing workers have clear errors', () => {
  for (const options of [{ maxJobs: 0 }, { maxJobs: 1.5 }, { maxActive: -1 }, { maxActive: Infinity }, { now: null }]) {
    assert.throws(() => createRunJobs(options), /must be/)
  }
  const jobs = createRunJobs()
  assert.throws(() => jobs.start(), /requires a run function/)
  assert.throws(() => jobs.status('unknown'), /Unknown run job id/)
  assert.throws(() => jobs.cancel('unknown'), /Unknown run job id/)
})
