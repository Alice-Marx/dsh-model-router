import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunJobs } from '../.dsh-plugin/shared/run-jobs.mjs'
import { OfficialToolsRemoteService } from '../.dsh-plugin/official-tools-remote-service.mjs'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, OFFICIAL_TOOLS_REMOTE_NAMESPACE, parseRunJobRequest } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import { gatewayClient } from './helpers/typert-gateway.mjs'
import { unwrapRemote } from '../.dsh-plugin/client/insights-state.mjs'
import { packagePlanKey } from '../.dsh-plugin/shared/package-assignments.mjs'

// Real Host planning, execution, ledger and gateway; model streams are inert fixtures.
const home = await mkdtemp(join(tmpdir(), 'router-progress-host-'))
process.env.DSH_HOME = home
const host = await import('../.dsh-plugin/index.mjs')
after(() => rm(home, { recursive: true, force: true }))
beforeEach(() => host.routerStateStore().update(state => {
  state.runs = []; state.reviews = []; state.archivedSpending = {}; state.quota = {}; state.authFailures = {}
}))
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
const deferred = () => {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}
async function until(read, accepts) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const value = await read()
    if (accepts(value)) return value
    await tick()
  }
  assert.fail('Fixture job did not reach the expected state')
}
const task = '先分析 Python 代码中的问题，再编写修复方案并测试，最后总结交付物。'
const settings = { dynamicDataEnabled: false, reviewMode: 'off',
  modelProfilesJson: JSON.stringify([{ provider: 'fixture', model: 'small', quality: 95,
    execution: 'api', billing: 'api-only', subscription: 'none', pricing: { input: 1, output: 2 } }]) }
const planOptions = { skipToolProbe: true, installedToolIds: [], runnableToolIds: [], readiness: [], billing: false }
function context({ hold = -1, release = deferred() } = {}) {
  const calls = []
  return { calls, release, sandbox: { confine() { throw new Error('No CLI may execute') } }, llm: {
    listProviders: () => ['fixture'], listModels: async () => [{ id: 'small' }],
    resolveModelInfo: async () => ({ id: 'small' }),
    stream(request) {
      const index = calls.length
      calls.push(request)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: `fixture answer ${index}` }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
        if (index === hold) await release.promise
        yield { type: 'finish', reason: { kind: request.signal.aborted ? 'aborted' : 'stop' } }
      })()
    },
  } }
}
function fixture(t, ctx, config = settings, runOptions = { planOptions }) {
  const jobs = createRunJobs()
  t.after(() => jobs.dispose())
  const service = Object.create(OfficialToolsRemoteService.prototype)
  service.services = host.routerRemoteServices(ctx, config, { runJobs: jobs, runOptions })
  const api = gatewayClient(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, service, OFFICIAL_TOOLS_REMOTE_NAMESPACE)
  const call = async (method, request) => unwrapRemote(await api[method](request), method)
  return { jobs, call }
}
const request = extra => ({ task, workspace: home, planMode: 'team', ...extra })

test('run job requests reject extra fields and malformed IDs at the gateway boundary', async t => {
  for (const bad of [{}, { jobId: '' }, { jobId: '../other' }, { jobId: 'x', signal: true }]) {
    assert.throws(() => parseRunJobRequest(bad))
  }
  const { call } = fixture(t, context())
  await assert.rejects(call('runStatus', { jobId: 'unknown-job' }))
  await assert.rejects(call('cancelRun', { jobId: 'unknown-job' }))
  await assert.rejects(call('runStatus', { jobId: 'x', command: 'forbidden' }), /boundary validation/)
})

test('the gateway returns a job before a held model finishes and reports actual package progress', async t => {
  const ctx = context({ hold: 0 })
  t.after(() => ctx.release.resolve())
  const { call } = fixture(t, ctx)
  const preview = await call('previewRun', request())
  assert.equal(ctx.calls.length, 0)
  const started = await call('startRun', request({ confirmedReasons: preview.reasons.map(item => item.code) }))
  assert.ok(started.jobId)
  assert.equal(started.status, 'running')
  const running = await until(() => call('runStatus', { jobId: started.jobId }), value => value.progress.current !== null)
  assert.equal(ctx.calls.length, 1)
  assert.ok(running.progress.total > 1)
  assert.equal(running.progress.packages[0].status, 'running')
  assert.equal(JSON.stringify(running).includes('fixture answer'), false)
  ctx.release.resolve()
  const done = await until(() => call('runStatus', { jobId: started.jobId }), value => value.status === 'completed')
  assert.equal(done.result.status, 'completed')
  assert.ok(done.result.runId)
  assert.equal(done.progress.completed, done.progress.total)
  assert.ok(done.progress.packages.every(item => item.status === 'succeeded'))
})

test('cancel waits for stream cleanup and retains previous answers, usage and spend without starting downstream work', async t => {
  const ctx = context({ hold: 1 })
  t.after(() => ctx.release.resolve())
  const { call } = fixture(t, ctx)
  const preview = await call('previewRun', request())
  const started = await call('startRun', request({ confirmedReasons: preview.reasons.map(item => item.code) }))
  await until(() => call('runStatus', { jobId: started.jobId }), value => value.progress.packages[1]?.status === 'running')
  const cancelled = await call('cancelRun', { jobId: started.jobId })
  assert.equal(cancelled.status, 'cancelling')
  assert.equal(ctx.calls[1].signal.aborted, true)
  assert.equal((await call('cancelRun', { jobId: started.jobId })).status, 'cancelling')
  ctx.release.resolve()
  const done = await until(() => call('runStatus', { jobId: started.jobId }), value => value.status === 'cancelled')
  assert.equal(ctx.calls.length, 2)
  const saved = (await host.routerStateStore().read()).runs.find(run => run.id === done.result.runId)
  assert.ok(saved)
  assert.equal(saved.status, 'cancelled')
  assert.equal(saved.packages[0].ok, true)
  assert.equal(saved.packages[0].answer, 'fixture answer 0')
  assert.equal(saved.packages[0].usage.inputTokens, 100)
  assert.ok(saved.packages[0].costUsd > 0)
  assert.equal(saved.packages[1].usage.outputTokens, 20)
  assert.ok(saved.packages.slice(2).every(item => item.ran === false))
  assert.equal((await call('cancelRun', { jobId: started.jobId })).status, 'cancelled')
})

test('fresh confirmation requirements still prevent a job or any model call', async t => {
  const ctx = context()
  const { call, jobs } = fixture(t, ctx, { ...settings, dailyBudgetUsd: 0.000001, overBudgetAction: 'pause' })
  const result = await call('startRun', request())
  assert.equal(result.status, 'needs-confirmation')
  assert.ok(result.missing.includes('over-budget'))
  assert.equal(result.jobId, undefined)
  assert.equal(ctx.calls.length, 0)
})

test('cancelling an optional reviewer preserves completed packages and reviewer usage in the ledger', async t => {
  const ctx = context()
  ctx.llm.listModels = async () => [{ id: 'small' }, { id: 'strong' }]
  const config = { ...settings, reviewMode: 'always', modelProfilesJson: JSON.stringify([
    { provider: 'fixture', model: 'small', quality: 85, execution: 'api', subscription: 'none', pricing: { input: 1, output: 2 } },
    { provider: 'fixture', model: 'strong', quality: 99, execution: 'api', subscription: 'none', pricing: { input: 3, output: 5 } },
  ]) }
  const planned = await host.planAssignment(ctx, task, config, { ...planOptions, planMode: 'team', workspace: home })
  const packages = planned.plan.team.workPackages
  const release = deferred()
  t.after(() => release.resolve())
  const originalStream = ctx.llm.stream
  ctx.llm.stream = request => request.model === 'strong' ? (async function* () {
    ctx.calls.push(request)
    yield { type: 'text-delta', index: 0, text: 'partial reviewer answer' }
    yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 10 } }
    await release.promise
    yield { type: 'finish', reason: { kind: request.signal.aborted ? 'aborted' : 'stop' } }
  })() : originalStream(request)
  const supplied = request({ assignmentMode: 'manual', packagePlanKey: packagePlanKey(planned.plan, task),
    packageAssignments: Object.fromEntries(packages.map(item => [item.id, { kind: 'api', provider: 'fixture', model: 'small' }])) })
  const { call } = fixture(t, ctx, config)
  const preview = await call('previewRun', supplied)
  const started = await call('startRun', { ...supplied, confirmedReasons: preview.reasons.map(item => item.code) })
  await until(() => call('runStatus', { jobId: started.jobId }), value => value.progress.stage === 'reviewing'
    && ctx.calls.length === packages.length + 1)
  await call('cancelRun', { jobId: started.jobId })
  release.resolve()
  const done = await until(() => call('runStatus', { jobId: started.jobId }), value => value.status === 'cancelled')
  const saved = (await host.routerStateStore().read()).runs.find(run => run.id === done.result.runId)
  assert.ok(saved.packages.every(item => item.ok === true))
  assert.equal(saved.reviews.length, 1)
  assert.equal(saved.reviews[0].usage.inputTokens, 30)
  assert.ok(saved.reviews[0].costUsd > 0)
  assert.equal(ctx.calls.length, packages.length + 1)
})

test('official-team jobs receive progress and the same cancel signal and retain cancelled receipts', async t => {
  const release = deferred()
  t.after(() => release.resolve())
  let activeSignal
  const ctx = context()
  ctx.llm.listProviders = () => ['openai']
  const config = { ...settings, modelProfilesJson: JSON.stringify([{ provider: 'openai', model: 'small',
    quality: 95, subscription: 'none', pricing: { input: 1, output: 2 } }]) }
  const runOptions = { preflightWorkspace: async () => {}, planOptions: { skipToolProbe: true,
    installedToolIds: ['codex'], readiness: [{ id: 'codex', ready: true, readyModes: ['read-only'] }],
    executionCapabilities: [{ id: 'codex', modes: ['read-only'] }] }, teamOptions: {
    runTeam: async ({ plan, signal, onPackageStart, onPackage }) => {
      activeSignal = signal
      const first = plan.team.workPackages[0]
      await onPackageStart(first)
      await release.promise
      const receipt = { id: first.id, name: first.name, toolId: 'codex', status: 'cancelled',
        finalText: 'partial fixture answer', usage: { inputTokens: 3, outputTokens: 1 }, reportedCostUsd: 0.001 }
      await onPackage(receipt)
      return { status: 'cancelled', workspace: home, results: [receipt] }
    },
  } }
  const { call } = fixture(t, ctx, config, runOptions)
  const supplied = request({ executor: 'official-team', executionMode: 'read-only' })
  const preview = await call('previewRun', supplied)
  assert.notEqual(preview.status, 'blocked')
  const started = await call('startRun', { ...supplied, confirmedReasons: preview.reasons.map(item => item.code) })
  await until(() => call('runStatus', { jobId: started.jobId }), value => value.progress.current !== null)
  await call('cancelRun', { jobId: started.jobId })
  assert.equal(activeSignal.aborted, true)
  release.resolve()
  const done = await until(() => call('runStatus', { jobId: started.jobId }), value => value.status === 'cancelled')
  const saved = (await host.routerStateStore().read()).runs.find(run => run.id === done.result.runId)
  assert.ok(saved)
  assert.equal(saved.status, 'cancelled')
  assert.equal(saved.packages[0].usage.inputTokens, 3)
  assert.equal(ctx.calls.length, 0)
})
