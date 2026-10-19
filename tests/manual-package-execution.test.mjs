import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePackageAssignments as parse, packagePlanKey } from '../.dsh-plugin/shared/package-assignments.mjs'
import { assignmentPackages, executeAssignmentPlan, packagePrompt, rerunAssignmentPackage } from '../.dsh-plugin/shared/task-executors.mjs'
import { actualCost, buildRunRecord, storedResults } from '../.dsh-plugin/shared/run-ledger.mjs'

const routes = [
  { provider: 'p', model: 'a', execution: 'api', pricing: { input: 1, output: 2 } },
  { provider: 'q', model: 'b', execution: 'api', pricing: { input: 2, output: 3 }, reasoningEffort: 'high', reasoningEfforts: ['high'] },
]
const api = { kind: 'api', provider: 'q', model: 'b' }
const tool = { kind: 'tool', toolId: 'codex' }
const recommendation = { provider: 'p', model: 'a', executionChannel: 'harness-llm', qualitySource: 'route' }
const item = (id, dependsOn = [], target) => ({ id, name: id, objective: `complete ${id}`, type: 'code', purpose: 'execution',
  dependsOn, recommendedProvider: 'p', recommendedModel: 'a', ...(target ? {
    manualAssignment: target, selectionSource: 'manual', algorithmRecommendation: recommendation,
  } : {}) })
const planFor = packages => ({ mode: 'team', assignmentMode: 'mixed', team: { workPackages: packages } })
const apiAnswer = (answer = 'api answer') => ({ ok: true, answer, usage: { inputTokens: 100, outputTokens: 10 } })
const noCredentials = () => assert.fail('manual selections must not resolve CLI credentials')

test('package target parser is strict, bounded, normalized and does not mutate inputs', () => {
  assert.equal(parse(undefined), undefined)
  const raw = { step: { kind: 'api', provider: ' p ', model: ' a ' }, second: { kind: 'tool', toolId: ' codex ' } }
  const before = structuredClone(raw)
  const parsed = parse(raw)
  assert.deepEqual(parsed, { step: { kind: 'api', provider: 'p', model: 'a' }, second: tool })
  assert.deepEqual(raw, before)
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype)
  for (const value of [null, [], '{}', {}, { ' ': api }, { step: {} }, { step: { ...api, effort: 'high' } },
    { step: { ...tool, cliModel: 'unapproved' } }, { step: { kind: 'tool', toolId: 'not-registered' } },
    { step: { kind: 'api', provider: '', model: 'a' } }, JSON.parse('{"__proto__":{"kind":"tool","toolId":"codex"}}'),
    Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`s${index}`, api]))]) {
    assert.throws(() => parse(value), TypeError)
  }
})

test('plan key binds task decomposition but ignores routing, pricing and selections', () => {
  const plan = planFor([item('a'), item('b', ['a'])])
  const original = structuredClone(plan)
  const key = packagePlanKey(plan, ' task ')
  assert.equal(packagePlanKey(plan, 'task'), key)
  const routed = structuredClone(plan)
  routed.team.workPackages[0].recommendedModel = 'new-model'
  routed.team.workPackages[0].estimatedCost = 900
  routed.team.workPackages[0].manualAssignment = tool
  assert.equal(packagePlanKey(routed, 'task'), key)
  routed.team.workPackages[0].objective = 'different objective'
  assert.notEqual(packagePlanKey(routed, 'task'), key)
  assert.notEqual(packagePlanKey(plan, 'different task'), key)
  assert.equal(packagePlanKey({ ...plan, routingBypassed: true }, 'task'), null)
  assert.equal(packagePlanKey({ mode: 'direct' }, 'task'), null)
  assert.deepEqual(plan, original)
})

test('short dependency receipts remain intact when their combined context fits', () => {
  const completed = [{ id: 'tool', name: 'tool', answer: 'TOOL_RESULT' },
    { id: 'api1', name: 'api1', answer: 'API_RESULT' }, { id: 'api2', name: 'api2', answer: 'API_RESULT' }]
  const prompt = packagePrompt('task', item('join', completed.map(result => result.id)), completed)
  assert.match(prompt, /TOOL_RESULT/)
  assert.equal(prompt.match(/API_RESULT/g)?.length, 2)
  assert.doesNotMatch(prompt, /已截断/)
})

test('long or tiny dependency shares respect the total UTF-8 budget without overrunning it with markers', () => {
  const completed = Array.from({ length: 3 }, (_, index) => ({ id: `d${index}`, name: `d${index}`,
    answer: `RECEIPT_${index}_` + '研究😀'.repeat(10000) }))
  for (const budget of [730, 1000, 4096, 64000]) {
    const prompt = packagePrompt('task', item('join', completed.map(result => result.id)), completed, budget)
    assert.ok(Buffer.byteLength(prompt, 'utf8') <= budget)
    assert.doesNotMatch(prompt, /\ufffd/)
    assert.match(prompt, /只完成当前工作包/)
    for (const result of completed) assert.match(prompt, new RegExp(`${result.name}:`))
  }
})

test('manual API, exact tool, and automatic API packages share dependency context', async () => {
  const plan = planFor([item('a', [], api), item('b', ['a'], tool), item('c', ['b'])])
  const original = structuredClone(plan)
  const apiCalls = []
  const toolCalls = []
  const execution = await executeAssignmentPlan({ plan, task: 'task', routes, workspace: 'fixture-workspace',
    apiFallback: async request => { apiCalls.push(request); return apiAnswer(apiCalls.length === 1 ? 'first receipt' : 'final receipt') },
    runVerified: async request => { toolCalls.push(request); return { status: 'succeeded', finalText: 'tool receipt',
      reportedModel: 'cli-default', credentialSource: 'cli-session', usage: { inputTokens: 20, outputTokens: 2 }, reportedCostUsd: 0.004 } },
  })
  assert.equal(execution.status, 'completed')
  assert.equal(apiCalls.length, 2)
  assert.equal(apiCalls[0].route.manualPinned, true)
  assert.equal(apiCalls[0].route.execution, 'api')
  assert.equal(Object.hasOwn(apiCalls[0].route, 'reasoningEffort'), false)
  assert.match(toolCalls[0].task, /first receipt/)
  assert.match(apiCalls[1].task, /tool receipt/)
  assert.deepEqual(Object.keys(toolCalls[0]).sort(), ['mode', 'signal', 'task', 'toolId', 'workspace'])
  assert.equal(toolCalls[0].toolId, 'codex')
  assert.equal(toolCalls[0].mode, 'read-only')
  const result = execution.packages[1]
  assert.equal(result.provider, 'official-tool')
  assert.equal(result.model, 'codex')
  assert.equal(result.toolId, 'codex')
  assert.equal(result.channel, 'official-cli')
  assert.equal(result.actualModel, 'cli-default')
  assert.equal(result.requestedCliModel, null)
  assert.equal(result.reportedCostUsd, 0.004)
  assert.deepEqual(result.manualAssignment, tool)
  assert.deepEqual(assignmentPackages(plan, 'task')[0].algorithmRecommendation, recommendation)
  assert.equal(assignmentPackages(plan, 'task')[0].type, 'code')
  assert.deepEqual(plan, original)
})

test('manual API bypasses original CLI, billing and effort controls', async () => {
  const originalRoute = { ...routes[1], execution: 'official' }
  const selected = { ...item('a', [], api), recommendedReasoningEffort: 'high' }
  let calls = 0
  const result = await executeAssignmentPlan({ plan: planFor([selected]), task: 'task', routes: [routes[0], originalRoute],
    credentialsFor: noCredentials, billing: { loginBillingFor: noCredentials }, runVerified: noCredentials,
    apiFallback: async request => {
      calls++
      assert.equal(request.route.provider, 'q')
      assert.equal(request.route.model, 'b')
      assert.equal(request.route.manualPinned, true)
      assert.equal(Object.hasOwn(request.route, 'reasoningEffort'), false)
      return apiAnswer()
    } })
  assert.equal(calls, 1)
  assert.equal(result.packages[0].reasoningEffortStatus, 'unapplied')
  assert.equal(result.packages[0].plannedReasoningEffort, 'high')
})

test('invalid later manual targets are rejected before any paid request', async () => {
  const invalidTargets = [{ ...api, model: 'not-configured' }, { ...api, reasoningEffort: 'high' },
    { kind: 'tool', toolId: 'not-registered' }]
  for (const target of invalidTargets) {
    let calls = 0
    await assert.rejects(executeAssignmentPlan({ plan: planFor([item('a', [], api), item('b', ['a'], target)]), task: 'task', routes,
      apiFallback: async () => { calls++; return apiAnswer() }, runVerified: noCredentials }))
    assert.equal(calls, 0)
  }
  await assert.rejects(executeAssignmentPlan({ plan: planFor([item('a', [], api), item('b', ['a'], tool)]), task: 'task', routes,
    apiFallback: noCredentials }), /runVerified|tool|工具/i)
  for (const packages of [[item('a', [], api), item('a', [], api)],
    [item('a', ['b'], api), item('b', [], api)],
    Array.from({ length: 33 }, (_, index) => item(`s${index}`, [], api))]) {
    await assert.rejects(executeAssignmentPlan({ plan: planFor(packages), task: 'task', routes, apiFallback: noCredentials }))
  }
})

test('tool failures never fall back to API, block dependents, and keep unknown usage unknown', async () => {
  for (const status of ['failed', 'unsupported', 'timed-out']) {
    const execution = await executeAssignmentPlan({ plan: planFor([item('a', [], tool), item('b', ['a'], api)]), task: 'task', routes,
      credentialsFor: noCredentials, apiFallback: noCredentials,
      runVerified: async () => ({ status, error: status, outputTail: 'diagnostic is not an answer' }) })
    assert.equal(execution.packages[0].ok, false)
    assert.equal(execution.packages[0].answer, '')
    assert.equal(Object.hasOwn(execution.packages[0], 'usage'), false)
    assert.equal(execution.packages[1].blocked, true)
    if (status === 'unsupported') assert.equal(execution.packages[0].notStarted, true)
    else {
      assert.notEqual(execution.packages[0].notStarted, true)
      assert.equal(actualCost(execution.packages[0], null).costUsd, null)
    }
  }
})

test('tool exceptions and cancellation preserve preceding results without starting later calls', async () => {
  const controller = new AbortController()
  let tools = 0
  let apis = 0
  const execution = await executeAssignmentPlan({ plan: planFor([item('a', [], api), item('b', ['a'], tool), item('c', ['b'], api)]),
    task: 'task', routes, signal: controller.signal,
    apiFallback: async () => { apis++; return apiAnswer('paid first receipt') },
    runVerified: async () => { tools++; controller.abort(); throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) } })
  assert.equal(apis, 1)
  assert.equal(tools, 1)
  assert.equal(execution.packages[0].usage.inputTokens, 100)
  assert.equal(execution.packages[1].cancelled, true)
  assert.notEqual(execution.packages[1].notStarted, true)
  assert.equal(execution.packages[2].notStarted, true)
})

test('ledger saves selected intent and a reloaded tool retries the same exact tool', async () => {
  const plan = planFor([item('a', [], tool)])
  const execution = await executeAssignmentPlan({ plan, task: 'task', routes,
    apiFallback: noCredentials, runVerified: async () => ({ status: 'failed', error: 'fixture failure' }) })
  const now = Date.now()
  const run = JSON.parse(JSON.stringify(buildRunRecord({ id: 'fixture', createdAt: now - 10, finishedAt: now,
    task: 'task', plan, execution })))
  assert.equal(run.assignmentMode, 'mixed')
  assert.deepEqual(run.packages[0].manualAssignment, tool)
  assert.equal(run.packages[0].selectionSource, 'manual')
  assert.deepEqual(run.packages[0].algorithmRecommendation, recommendation)
  let toolCalls = 0
  const retried = await rerunAssignmentPackage({ task: run.task, packages: run.packages, previous: storedResults(run), packageId: 'a', routes,
    apiFallback: noCredentials, runVerified: async request => { toolCalls++; assert.equal(request.toolId, 'codex'); return { status: 'succeeded', finalText: 'retried' } } })
  assert.equal(toolCalls, 1)
  assert.deepEqual(retried.packages[0].manualAssignment, tool)
})

test('an explicit provider/model retry replaces an earlier manual tool with pinned API', async () => {
  const selected = { ...item('a', [], tool), recommendedReasoningEffort: 'high' }
  let calls = 0
  const execution = await rerunAssignmentPackage({ task: 'task', packages: [selected], previous: [], packageId: 'a', routes,
    override: { provider: 'q', model: 'b' }, credentialsFor: noCredentials, runVerified: noCredentials,
    apiFallback: async request => { calls++; assert.equal(request.route.manualPinned, true); return apiAnswer() } })
  assert.equal(calls, 1)
  assert.deepEqual(execution.packages[0].manualAssignment, api)
  assert.equal(execution.packages[0].channel, 'harness-llm')
})

test('an ordinary historical retry override retains subscription billing instead of becoming pinned API', async () => {
  const subscriptionRoute = { ...routes[1], billing: 'subscription-only', subscription: 'plan-key' }
  const configured = [routes[0], subscriptionRoute]
  let calls = 0
  const execution = await rerunAssignmentPackage({ task: 'task', packages: [item('a')], previous: [], packageId: 'a', routes: configured,
    override: { provider: 'q', model: 'b' }, billing: { routes: configured },
    apiFallback: async request => {
      calls++
      assert.equal(request.subscription, true)
      assert.notEqual(request.route.manualPinned, true)
      return apiAnswer()
    } })
  assert.equal(calls, 1)
  assert.equal(execution.packages[0].billing, 'subscription')
  assert.equal(Object.hasOwn(execution.packages[0], 'manualAssignment'), false)
})

test('retrying a current model keeps a successful upstream receipt after its old model leaves the catalog', async () => {
  const gone = { kind: 'api', provider: 'p', model: 'gone-old' }
  const current = { kind: 'api', provider: 'q', model: 'b' }
  const packages = [item('a', [], gone), item('b', ['a'], current)]
  const previous = [{ id: 'a', name: 'a', ok: true, provider: 'p', model: 'gone-old', answer: 'SAVED_UPSTREAM_RECEIPT' },
    { id: 'b', name: 'b', ok: false, provider: 'q', model: 'b', answer: '' }]
  const before = structuredClone({ packages, previous })
  const calls = []
  const execution = await rerunAssignmentPackage({ task: 'task', packages, previous, packageId: 'b', routes: [routes[1]],
    apiFallback: async request => { calls.push(request); return apiAnswer('retried current') } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].route.model, 'b')
  assert.match(calls[0].task, /SAVED_UPSTREAM_RECEIPT/)
  assert.equal(execution.packages[0], previous[0])
  assert.deepEqual(execution.ranIds, ['b'])
  assert.deepEqual({ packages, previous }, before)
})

test('a retained tool receipt needs no runner when only its downstream API is retried', async () => {
  const packages = [item('a', [], tool), item('b', ['a'], api)]
  const previous = [{ id: 'a', name: 'a', ok: true, answer: 'SAVED_TOOL_RECEIPT' }, { id: 'b', ok: false }]
  let calls = 0
  const execution = await rerunAssignmentPackage({ task: 'task', packages, previous, packageId: 'b', routes,
    apiFallback: async request => { calls++; assert.match(request.task, /SAVED_TOOL_RECEIPT/); return apiAnswer() } })
  assert.equal(calls, 1)
  assert.deepEqual(execution.ranIds, ['b'])
})
