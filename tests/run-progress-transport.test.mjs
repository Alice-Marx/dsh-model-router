import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as registry from '@deepseek-ai/dsh-typert-registry/client'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import { createRunJobs } from '../.dsh-plugin/shared/run-jobs.mjs'
import {
  OFFICIAL_TOOLS_REMOTE_DESCRIPTORS,
  OFFICIAL_TOOLS_REMOTE_NAMESPACE,
  OFFICIAL_TOOLS_REMOTE_PACKAGE,
} from '../.dsh-plugin/shared/official-tools-remote.mjs'

// Use the actual SDK namespace proxy and argument preparation. Only the
// Connection carrier is inert: no browser, network, model or CLI is started.
async function mountedClient(t, call) {
  const root = new Context()
  root.provide('connection', {
    interactions: 'none',
    rpc: {
      call,
      open() { throw new Error('This unary fixture must not open a stream') },
    },
  })
  const registryFiber = root.plugin(registry)
  await registryFiber
  const gatewayFiber = root.plugin(gateway)
  await gatewayFiber
  const remote = root.get('remote')
  const unmount = await remote.$mount({
    package: OFFICIAL_TOOLS_REMOTE_PACKAGE,
    descriptors: OFFICIAL_TOOLS_REMOTE_DESCRIPTORS,
  })
  t.after(async () => {
    await unmount()
    await gatewayFiber.dispose()
    await registryFiber.dispose()
  })
  return remote[OFFICIAL_TOOLS_REMOTE_NAMESPACE]
}

const jobRequest = Object.freeze({ jobId: 'fixture-job' })
const previewRequest = Object.freeze({ task: 'Inspect fixture input', workspace: 'F:/fixture', planMode: 'single' })
const requests = { runStatus: jobRequest, cancelRun: jobRequest, previewRun: previewRequest }

for (const method of Object.keys(requests)) {
  test(`the real SDK sends ${method}'s caller signal to transport, outside business JSON`, async t => {
    const calls = []
    const api = await mountedClient(t, async (channel, endpoint, payload, signal) => {
      calls.push({ channel, endpoint, payload, signal })
      return { ok: true, value: { status: 'fixture' } }
    })
    const controller = new AbortController()
    const request = requests[method]
    assert.equal((await api[method](request, controller.signal)).ok, true)
    assert.equal(calls.length, 1)
    const [call] = calls
    assert.equal(call.channel, '/api')
    assert.equal(call.endpoint, `${OFFICIAL_TOOLS_REMOTE_NAMESPACE}/${method}`)
    assert.ok(call.signal instanceof AbortSignal)
    assert.equal(call.signal.aborted, false)
    assert.deepEqual(JSON.parse(JSON.stringify(call.payload)), { args: { request } })
    assert.deepEqual(Reflect.ownKeys(call.payload), ['args'])
    assert.deepEqual(Reflect.ownKeys(call.payload.args), ['request'])
    assert.equal(Object.hasOwn(call.payload.args.request, 'signal'), false)
    controller.abort()
    assert.equal(call.signal.aborted, true, 'the joined transport lifetime follows the caller')
  })
}

test('all bounded workbench methods retain their legacy single-argument SDK calls', async t => {
  const calls = []
  const api = await mountedClient(t, async (channel, endpoint, payload, signal) => {
    calls.push({ endpoint, payload, signal })
    return { ok: true, value: { status: 'fixture' } }
  })
  for (const [method, request] of Object.entries(requests)) {
    assert.equal((await api[method](request)).ok, true)
  }
  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.ok(call.signal instanceof AbortSignal)
    assert.equal(call.signal.aborted, false)
    assert.deepEqual(Object.keys(call.payload.args), ['request'])
  }
})

for (const method of ['runStatus', 'cancelRun']) {
  test(`aborting an undelivered ${method} transport neither restarts nor cancels its Host job`, async t => {
    let release, workerSignal
    const held = new Promise(resolve => { release = resolve })
    const jobs = createRunJobs()
    const job = jobs.start({ run: async ({ signal }) => {
      workerSignal = signal
      await held
      return { status: 'completed' }
    } })
    t.after(() => { jobs.dispose(); release() })
    const calls = []
    const api = await mountedClient(t, (channel, endpoint, payload, signal) => {
      // Simulate a request stalled before reaching Host dispatch. Cancelling
      // this HTTP lifetime must not synthesize a business cancel/start call.
      calls.push({ endpoint, payload, signal })
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason)
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      })
    })
    const controller = new AbortController()
    const pending = api[method]({ jobId: job.jobId }, controller.signal)
    assert.equal(calls.length, 1)
    controller.abort(new Error('Fixture request deadline'))
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'gateway/cancelled')
    assert.deepEqual(calls.map(call => call.endpoint), [`${OFFICIAL_TOOLS_REMOTE_NAMESPACE}/${method}`])
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)), { args: { request: { jobId: job.jobId } } })
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(jobs.status(job.jobId).status, 'running')
    assert.equal(jobs.status(job.jobId).cancelRequested, false)
    assert.equal(workerSignal.aborted, false)
  })
}
