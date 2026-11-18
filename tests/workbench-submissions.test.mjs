import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { createRunJobs } from '../.dsh-plugin/shared/run-jobs.mjs'
import { workbenchFingerprint, workbenchSubmissions } from '../.dsh-plugin/shared/workbench-submissions.mjs'
import { parseRunJobRequest, parseRunRequest } from '../.dsh-plugin/shared/official-tools-remote.mjs'

test('an accepted workbench id survives a lost acknowledgement and Host restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-submissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'state.json')
  const state = createRouterState({ file })
  const jobs = createRunJobs()
  const primary = workbenchSubmissions(state, jobs)
  const secondary = workbenchSubmissions(createRouterState({ file }), createRunJobs())
  const requestKey = randomUUID()
  const request = parseRunRequest({ task: 'Check the offline fixture', requestKey })
  const fingerprint = workbenchFingerprint(request)
  assert.deepEqual(parseRunJobRequest({ requestKey }), { requestKey })
  assert.deepEqual(parseRunJobRequest({ jobId: 'historical-job' }), { jobId: 'historical-job' })
  assert.throws(() => parseRunJobRequest({ requestKey, jobId: 'ambiguous' }))

  const claims = await Promise.all([primary.claim(requestKey, fingerprint), secondary.claim(requestKey, fingerprint)])
  assert.equal(claims.filter(item => item.accepted).length, 1)
  const { jobId } = claims[0].entry
  assert.equal(claims[1].entry.jobId, jobId)
  let started = 0
  let release
  const finished = new Promise(resolve => { release = resolve })
  jobs.start({ jobId, async run() {
    started++
    await state.appendRun({ id: jobId, status: 'succeeded', createdAt: 1, finishedAt: 2, packages: [], reviews: [] })
    await primary.finish(requestKey, jobId, 'succeeded')
    release()
    return { status: 'succeeded', runId: jobId }
  } })

  const recovered = await primary.lookup(requestKey)
  assert.equal(recovered.jobId, jobId)
  await finished
  const afterRestart = await secondary.lookup(requestKey)
  assert.deepEqual(afterRestart.result, { status: 'succeeded', runId: jobId })
  assert.equal((await secondary.claim(requestKey, fingerprint)).accepted, false)
  await assert.rejects(secondary.claim(requestKey, workbenchFingerprint({ ...request, task: 'Different work' })), /另一份执行请求/)
  assert.equal(started, 1)
  assert.deepEqual((await state.read()).runs.map(run => run.id), [jobId])
})
