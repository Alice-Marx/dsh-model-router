import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assignmentPackages,
  executeAssignedTask,
  executeAssignmentPlan,
  executeRouteWithBilling,
  rerunAssignmentPackage,
} from '../.dsh-plugin/shared/task-executors.mjs'
import { routeForReasoningSwitch } from '../.dsh-plugin/shared/reasoning-execution.mjs'
import { buildRunRecord, storedResults, teamExecutionResults } from '../.dsh-plugin/shared/run-ledger.mjs'
import { runOfficialTeam } from '../.dsh-plugin/shared/official-team-runtime.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-effort-'))
const { consultConfiguredModel } = await import('../.dsh-plugin/index.mjs')

const signal = new AbortController().signal

function asyncChunks(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function createLlmContext(calls) {
  const chunks = [
    { type: 'text-delta', index: 0, text: '可核验结论。' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  return {
    llm: {
      stream(options) {
        calls.push(options)
        return asyncChunks(chunks)
      },
    },
  }
}

test('exact API effort ID reaches the SDK and is reported as requested only', async () => {
  const calls = []
  const route = {
    provider: 'openai',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'vendor:slow/v2',
    reasoningEfforts: ['low', { id: 'vendor:slow/v2' }],
  }
  const result = await consultConfiguredModel(createLlmContext(calls), route, 'Task text', 12_000, signal)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].reasoningEffort, 'vendor:slow/v2')
  assert.equal(result.ok, true)
  assert.equal(result.plannedReasoningEffort, 'vendor:slow/v2')
  assert.equal(result.requestedReasoningEffort, 'vendor:slow/v2')
  assert.equal(result.reasoningEffortStatus, 'requested')
  assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0)
  const expectedMessage = `You are an independent specialist consulted by another AI agent. Give a concise, evidence-oriented answer in the task's language.\n\nTask:\nTask text`
  assert.equal(result.inputChars, expectedMessage.length)
})

test('invalid explicit API effort returns unsupported without a stream call', async () => {
  for (const bad of ['HIGH', ' high', 'high ', 'medium']) {
    const calls = []
    const route = {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      reasoningEffort: bad,
      reasoningEfforts: ['low', 'high'],
    }
    const result = await consultConfiguredModel(createLlmContext(calls), route, 'Task text', 12_000, signal)
    assert.equal(calls.length, 0)
    assert.equal(result.ok, false)
    assert.equal(result.reasoningEffortStatus, 'unsupported')
    assert.equal(result.requestedReasoningEffort, undefined)
  }
})

test('an unsupported API effort does not record a provider request or unknown spend', async () => {
  const calls = []
  const route = { provider: 'custom-api', model: 'custom-model', reasoningEfforts: ['vendor:allowed'] }
  const plan = { team: { workPackages: [{ id: 'p1', name: 'Package', recommendedProvider: route.provider,
    recommendedModel: route.model, recommendedReasoningEffort: 'vendor:rejected' }] } }
  const ctx = createLlmContext(calls)
  const execution = await executeAssignmentPlan({ plan, task: 'invalid control', routes: [route],
    apiFallback: request => consultConfiguredModel(ctx, request.route, request.task),
  })
  assert.equal(calls.length, 0)
  assert.equal(execution.packages[0].notStarted, true)
  const run = buildRunRecord({ id: 'rejected', createdAt: 1, task: 'invalid control', plan, execution })
  assert.equal(run.packages[0].ran, false)
  assert.equal(run.packages[0].costSource, 'not-run')
  assert.equal(run.packages[0].requestedReasoningEffort, undefined)
})

test('legacy API callers without effort intent omit every effort field', async () => {
  const calls = []
  const result = await consultConfiguredModel(createLlmContext(calls), {
    provider: 'openai',
    model: 'gpt-5.6-sol',
    reasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: 'high',
  }, 'Task text', 12_000, signal)
  assert.equal(result.ok, true)
  assert.equal(Object.hasOwn(calls[0], 'reasoningEffort'), false)
  assert.equal(Object.hasOwn(result, 'plannedReasoningEffort'), false)
  assert.equal(Object.hasOwn(result, 'requestedReasoningEffort'), false)
  assert.equal(Object.hasOwn(result, 'reasoningEffortStatus'), false)
})

test('normal assignment preserves the planned effort and SDK requested fields', async () => {
  const plan = {
    team: {
      workPackages: [{
        id: 'p1',
        name: 'Package',
        objective: 'Objective',
        recommendedProvider: 'test-api',
        recommendedModel: 'api-model',
        recommendedReasoningEffort: 'high',
      }],
    },
  }
  const routes = [{ provider: 'test-api', model: 'api-model', reasoningEfforts: ['low', 'high'] }]
  const seen = []
  const apiFallback = async ({ route, task }) => {
    seen.push({ ...route, task })
    return {
      ok: true,
      answer: 'done',
      plannedReasoningEffort: route.reasoningEffort,
      requestedReasoningEffort: route.reasoningEffort,
      reasoningEffortStatus: 'requested',
      durationMs: 999,
      inputChars: 1,
    }
  }
  const execution = await executeAssignmentPlan({ plan, task: 'root task', routes, apiFallback })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].reasoningEffort, 'high')
  assert.equal(execution.packages[0].requestedReasoningEffort, 'high')
  assert.equal(execution.packages[0].plannedReasoningEffort, 'high')
  assert.equal(execution.packages[0].reasoningEffortStatus, 'requested')
  assert.ok(Number.isFinite(execution.packages[0].durationMs) && execution.packages[0].durationMs >= 0)
  assert.equal(execution.packages[0].inputChars, seen[0].task.length)
})

test('manual reassignment to another model drops the original effort as unapplied', async () => {
  const plan = {
    team: {
      workPackages: [{
        id: 'p1',
        name: 'Package',
        objective: 'Objective',
        recommendedProvider: 'test-api',
        recommendedModel: 'api-model',
        recommendedReasoningEffort: 'high',
      }],
    },
  }
  const packages = assignmentPackages(plan, 'root task')
  const routes = [
    { provider: 'test-api', model: 'api-model', reasoningEfforts: ['low', 'high'] },
    { provider: 'test-api', model: 'other-model', reasoningEfforts: ['low', 'high'] },
  ]
  const seen = []
  const apiFallback = async ({ route }) => {
    seen.push(route)
    return { ok: true, answer: 'other done' }
  }
  const execution = await rerunAssignmentPackage({
    task: 'root task', packages, previous: [], packageId: 'p1', routes,
    override: { provider: 'test-api', model: 'other-model' }, apiFallback,
  })
  assert.equal(seen[0].provider, 'test-api')
  assert.equal(seen[0].model, 'other-model')
  assert.equal(Object.hasOwn(seen[0], 'reasoningEffort'), false)
  assert.equal(execution.packages[0].plannedReasoningEffort, 'high')
  assert.equal(execution.packages[0].reasoningEffortStatus, 'unapplied')
  assert.equal(execution.packages[0].requestedReasoningEffort, undefined)
  assert.ok(Number.isFinite(execution.packages[0].durationMs) && execution.packages[0].durationMs >= 0)
  assert.ok(Number.isFinite(execution.packages[0].inputChars) && execution.packages[0].inputChars >= 0)
})

test('billing route switching never carries an effort across provider/model identity', () => {
  const source = { provider: 'openai', model: 'a', reasoningEffort: 'high' }
  const crossTarget = { provider: 'openai', model: 'b', reasoningEffort: 'high', reasoningEfforts: ['high'] }
  assert.equal(Object.hasOwn(routeForReasoningSwitch(source, crossTarget), 'reasoningEffort'), false)
  const sameTarget = { provider: 'openai', model: 'a', reasoningEfforts: ['high'] }
  assert.equal(routeForReasoningSwitch(source, sameTarget).reasoningEffort, 'high')
})

test('same-model plan-key requests retain allowed effort IDs while cross-model billing strips stale IDs', async () => {
  const route = { provider: 'custom-plan', model: 'plan-model', subscription: 'plan-key',
    apiRoute: { provider: 'custom-api', model: 'api-model' }, reasoningEffort: 'vendor:precise', reasoningEfforts: ['vendor:precise'] }
  const target = { provider: 'custom-api', model: 'api-model', reasoningEffort: 'stale-target', reasoningEfforts: ['target-only'] }
  const calls = []
  const ctx = createLlmContext(calls)
  const result = await executeRouteWithBilling({ route, task: 'billing test',
    billing: { routes: [route, target], onFailure: 'api' },
    apiFallback: request => {
      if (request.subscription) {
        assert.equal(request.route.reasoningEffort, 'vendor:precise')
        assert.deepEqual(request.route.reasoningEfforts, ['vendor:precise'])
        throw new Error('non-quota subscription failure')
      }
      assert.equal(request.route.provider, 'custom-api')
      assert.equal(Object.hasOwn(request.route, 'reasoningEffort'), false)
      return consultConfiguredModel(ctx, request.route, request.task)
    },
  })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(Object.hasOwn(calls[0], 'reasoningEffort'), false)
  assert.equal(result.plannedReasoningEffort, 'vendor:precise')
  assert.equal(result.reasoningEffortStatus, 'unapplied')
  assert.equal(result.requestedReasoningEffort, undefined)

  const same = await executeRouteWithBilling({ route, task: 'same identity',
    billing: { routes: [route, target] },
    apiFallback: request => consultConfiguredModel(ctx, request.route, request.task),
  })
  assert.equal(same.ok, true)
  assert.equal(same.requestedReasoningEffort, 'vendor:precise')
  assert.equal(same.reasoningEffortStatus, 'requested')
})

test('a CLI quota fallback keeps the exact same-model effort despite the catalog route replacing it', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'effort-quota-'))
  const catalog = { provider: 'openai', model: 'catalog-model', execution: 'official', reasoningEfforts: ['vendor:slow/v2'] }
  const calls = []
  const ctx = createLlmContext(calls)
  const result = await executeRouteWithBilling({ route: { ...catalog, reasoningEffort: 'vendor:slow/v2' },
    task: 'quota fallback', workspace,
    billing: { routes: [catalog], loginBillingFor: () => 'subscription' },
    runVerified: async () => ({ status: 'failed', error: "You've hit your usage limit.", exitCode: 1 }),
    apiFallback: request => consultConfiguredModel(ctx, request.route, request.task),
  })
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'harness-llm')
  assert.equal(result.billing, 'api')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].reasoningEffort, 'vendor:slow/v2')
  assert.equal(result.requestedReasoningEffort, 'vendor:slow/v2')
  assert.equal(result.reasoningEffortStatus, 'requested')
})

test('team CLI execution records unsupported effort without passing it to its runner', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'effort-team-'))
  const item = { id: 'p1', name: 'Package', type: 'code', purpose: 'execution', dependsOn: [],
    recommendedProvider: 'openai', recommendedModel: 'catalog-model', recommendedReasoningEffort: 'vendor:precise' }
  const calls = []
  const execution = await runOfficialTeam({ plan: { team: { workPackages: [item] } }, task: 'team test', workspace,
    mode: 'read-only', installedIds: ['codex'], sandbox: { confine() { throw new Error('runner must be inert') } },
    runtime: { readiness: async id => ({ id, ready: true, readyModes: ['read-only'] }), runTool: async args => {
      calls.push(args)
      return { status: 'succeeded', finalText: 'team done' }
    } },
  })
  assert.equal(execution.status, 'cli-completed')
  assert.equal(calls.length, 1)
  assert.equal(Object.hasOwn(calls[0], 'reasoningEffort'), false)
  const result = execution.results[0]
  assert.equal(result.plannedReasoningEffort, 'vendor:precise')
  assert.equal(result.reasoningEffortStatus, 'unsupported')
  assert.equal(result.requestedReasoningEffort, undefined)
  assert.equal(result.actualModel, null)
  assert.equal(result.inputChars, calls[0].task.length)
  assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0)
})

test('ordinary CLI success reports unsupported reasoning and no inferred actual model', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'effort-cli-'))
  const verified = []
  const result = await executeAssignedTask({
    route: {
      provider: 'openai',
      model: 'codex-mini',
      executionPreference: 'official',
      reasoningEffort: 'high',
      reasoningEfforts: ['low', 'high'],
    },
    task: 'cli prompt',
    workspace,
    signal,
    runVerified: async args => {
      verified.push(args)
      return { status: 'succeeded', finalText: 'cli ok', exitCode: 0 }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'official-cli')
  assert.equal(result.plannedReasoningEffort, 'high')
  assert.equal(result.reasoningEffortStatus, 'unsupported')
  assert.equal(result.requestedReasoningEffort, undefined)
  assert.equal(result.actualModel, null)
  assert.equal(verified[0].task, 'cli prompt')
})

test('team CLI conversion reports unsupported reasoning and finite timing', () => {
  const plan = {
    team: {
      workPackages: [{
        id: 'p1',
        name: 'Package',
        recommendedProvider: 'openai',
        recommendedModel: 'codex-mini',
        recommendedReasoningEffort: 'high',
      }],
    },
  }
  const execution = {
    status: 'cli-completed',
    results: [{
      id: 'p1',
      status: 'succeeded',
      provider: 'openai',
      recommendedModel: 'codex-mini',
      recommendedReasoningEffort: 'high',
      requestedCliModel: 'codex-mini',
      actualModel: null,
      durationMs: 7,
      inputChars: 11,
      finalText: 'ok',
    }],
  }
  const converted = teamExecutionResults(plan, execution)
  assert.equal(converted.packages[0].plannedReasoningEffort, 'high')
  assert.equal(converted.packages[0].reasoningEffortStatus, 'unsupported')
  assert.equal(converted.packages[0].requestedReasoningEffort, undefined)
  assert.equal(converted.packages[0].durationMs, 7)
  assert.equal(converted.packages[0].inputChars, 11)
  assert.equal(converted.packages[0].actualModel, null)
})

test('ledger and retry results carry effort and finite timing fields', () => {
  const plan = {
    team: {
      workPackages: [{
        id: 'p1',
        name: 'Package',
        objective: 'Objective',
        recommendedProvider: 'test-api',
        recommendedModel: 'api-model',
        recommendedReasoningEffort: 'high',
      }],
    },
  }
  const execution = {
    status: 'completed',
    packages: [{
      id: 'p1',
      name: 'Package',
      ok: true,
      provider: 'test-api',
      model: 'api-model',
      channel: 'harness-llm',
      answer: 'done',
      plannedReasoningEffort: 'high',
      requestedReasoningEffort: 'high',
      reasoningEffortStatus: 'requested',
      durationMs: 12,
      inputChars: 34,
    }],
  }
  const run = buildRunRecord({
    id: 'run-1',
    createdAt: new Date().toISOString(),
    task: 'root task',
    plan,
    execution,
    pricingFor: () => null,
  })
  const stored = run.packages[0]
  assert.equal(stored.plannedReasoningEffort, 'high')
  assert.equal(stored.requestedReasoningEffort, 'high')
  assert.equal(stored.reasoningEffortStatus, 'requested')
  assert.equal(stored.durationMs, 12)
  assert.equal(stored.inputChars, 34)
  const retried = storedResults(run)
  assert.equal(retried[0].plannedReasoningEffort, 'high')
  assert.equal(retried[0].requestedReasoningEffort, 'high')
  assert.equal(retried[0].reasoningEffortStatus, 'requested')
  assert.equal(retried[0].durationMs, 12)
  assert.equal(retried[0].inputChars, 34)
})

test('legacy ledger records omit effort and invalid timing evidence', () => {
  const plan = {
    team: {
      workPackages: [{
        id: 'p1',
        name: 'Package',
        objective: 'Objective',
        recommendedProvider: 'test-api',
        recommendedModel: 'api-model',
      }],
    },
  }
  const execution = {
    status: 'completed',
    packages: [{
      id: 'p1',
      name: 'Package',
      ok: true,
      provider: 'test-api',
      model: 'api-model',
      channel: 'harness-llm',
      answer: 'done',
      durationMs: -1,
      inputChars: 'not-a-number',
    }],
  }
  const run = buildRunRecord({
    id: 'run-legacy',
    createdAt: new Date().toISOString(),
    task: 'root task',
    plan,
    execution,
    pricingFor: () => null,
  })
  const stored = run.packages[0]
  assert.equal(Object.hasOwn(stored, 'plannedReasoningEffort'), false)
  assert.equal(Object.hasOwn(stored, 'requestedReasoningEffort'), false)
  assert.equal(Object.hasOwn(stored, 'reasoningEffortStatus'), false)
  assert.equal(Object.hasOwn(stored, 'durationMs'), false)
  assert.equal(Object.hasOwn(stored, 'inputChars'), false)
})
