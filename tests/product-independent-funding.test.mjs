import test from 'node:test'
import assert from 'node:assert/strict'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { beginExecutionLifecycle } from '../.dsh-plugin/shared/execution-lifecycle.mjs'
import { createRunJobs } from '../.dsh-plugin/shared/run-jobs.mjs'

test('an authenticated workbench job uses its durable budget and records one run across the RPC boundary', async () => {
  await withProductIndependent(async ({ ctx, readRows, routerState }) => {
    const policy = ctx.get('botIntegrationPolicy')
    const invoke = (name, operation) => policy.run({ kind: 'remote', name,
      invocation: { peer: { principal: { kind: 'owner' } } } }, operation)
    const packageEstimates = [{ id: 'fixture', billing: 'api', estimatedCostUsd: 1 }]
    await assert.rejects(invoke('previewRun', () => routerState.prepareExecutionFunding({ packageEstimates })),
      { code: 'OWNER_EXECUTION_FACADE_REQUIRED' })
    const buildRun = id => ({ status, results }) => ({
      id, status, createdAt: Date.now(), finishedAt: Date.now(), packages: results, reviews: [],
    })
    const blocked = await invoke('startRun', () => beginExecutionLifecycle({
      state: routerState, packageEstimates, settings: { dailyLimitUsd: 0.5 }, buildRun: buildRun('blocked-workbench'),
    }))
    assert.equal(blocked.accepted, false)
    assert.equal(ctx.upstream.length, 0)
    assert.equal(readRows('router_runs').length, 0)

    const jobs = createRunJobs()
    try {
      let enterWorker
      const afterResponse = new Promise(resolve => { enterWorker = resolve })
      const started = await invoke('startRun', () => jobs.start({ run: async ({ signal }) => {
        await afterResponse
        const lifecycle = await beginExecutionLifecycle({
          state: routerState, packageEstimates, settings: { dailyLimitUsd: 5 }, buildRun: buildRun('owner-workbench'),
        })
        assert.equal(lifecycle.accepted, true)
        await lifecycle.onCheckpointStart({ id: 'fixture', provider: 'alpha', model: 'one' })
        let answer = ''
        for await (const chunk of ctx.llm.stream({ provider: 'alpha', model: 'one', messages: [
          { role: 'user', content: [{ type: 'text', text: 'offline workbench fixture' }] },
        ], signal })) {
          if (chunk.type === 'text-delta') answer += chunk.text
        }
        await lifecycle.onCheckpointResult({ id: 'fixture', provider: 'alpha', model: 'one', ok: true, ran: true, answer })
        await lifecycle.finish(lifecycle.current('completed'))
        return { status: 'completed', runId: lifecycle.id, answer }
      } }))
      enterWorker()
      let settled
      for (let i = 0; i < 200; i++) {
        settled = jobs.status(started.jobId)
        if (settled.status !== 'running') break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.deepEqual(settled.result, { status: 'completed', runId: 'owner-workbench', answer: 'model answer' })
      assert.equal(ctx.upstream.length, 1)
      assert.deepEqual(readRows('router_runs').map(row => row.id), ['owner-workbench'])
      assert.equal(readRows('router_model_calls').length, 0, 'the workbench receipt is its existing run and package')
    } finally { jobs.dispose() }
  })
})

test('real composition owner binding admits two Bot models and settles one funded receipt per call', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await bind('b', 'beta', 'vendor/two')
    await runtime.move('a', 'independent')
    await runtime.move('b', 'independent')
    assert.equal((await runtime.turn({ botId: 'a', input: 'first funded turn' })).answer, 'model answer')
    assert.equal((await runtime.turn({ botId: 'b', input: 'second funded turn' })).answer, 'model answer')
    const receipts = readRows('router_model_calls')
    assert.deepEqual(receipts.map(row => [row.botId, row.provider, row.model, row.source, row.state, row.outcome]), [
      ['a', 'alpha', 'one', 'bot', 'settled', 'succeeded'], ['b', 'beta', 'vendor/two', 'bot', 'settled', 'succeeded'],
    ])
    const runs = readRows('router_runs')
    assert.equal(runs.length, 2)
    for (const run of runs) {
      assert.equal(run.status, 'completed')
      assert.ok(Math.abs(run.packages[0].costUsd - 0.000025) < 1e-12)
    }
    assert.deepEqual(ctx.upstream.map(row => `${row.provider}/${row.model}`), ['alpha/one', 'beta/vendor/two'])
  })
})

test('production construction before composition readiness can use the later published execution service', async () => {
  await withProductIndependent(async ({ runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    assert.equal((await runtime.turn({ botId: 'a', input: 'after startup' })).answer, 'model answer')
    assert.equal(readRows('router_model_calls').length, 1)
  }, { beforeBoot: async ({ ctx }) => { assert.equal(ctx.get('botIndependentExecution'), undefined) } })
})

test('the real secrets rewrite reaches the SDK adapter once and records one receipt', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const fixtureValue = 'offline-fixture-value-never-a-real-credential-19281'
    await product.rt.secretEndpoint('secret-set', { name: 'FIXTURE_REDACTION', value: fixtureValue, scope: ['a'] })
    await runtime.turn({ botId: 'a', input: `Please redact ${fixtureValue} before sending` })
    assert.equal(ctx.upstream.length, 1)
    const sent = JSON.stringify(ctx.upstream[0].messages)
    assert.equal(sent.includes(fixtureValue), false)
    assert.match(sent, /\[secret:FIXTURE_REDACTION\]/)
    assert.equal(readRows('router_model_calls').length, 1)
    assert.equal(readRows('router_runs').length, 1)
  }, { nativeLlm: true })
})

test('two identical logical requests remain two receipts after the secrets rewrite', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const fixtureValue = 'offline-repeat-fixture-value-not-a-credential-19282'
    await product.rt.secretEndpoint('secret-set', { name: 'FIXTURE_REPEAT', value: fixtureValue, scope: ['a'] })
    const execution = ctx.get('botIndependentExecution')
    const request = () => ({ botId: 'a', provider: 'alpha', model: 'one', messages: [{ role: 'user', content: [{ type: 'text', text: fixtureValue }] }] })
    await execution.complete(request())
    await execution.complete(request())
    const rows = readRows('router_model_calls')
    assert.equal(ctx.upstream.length, 2)
    assert.equal(rows.length, 2)
    assert.notEqual(rows[0].id, rows[1].id)
    assert.notEqual(rows[0].runId, rows[1].runId)
    assert.equal(JSON.stringify(ctx.upstream).includes(fixtureValue), false)
  }, { nativeLlm: true })
})
