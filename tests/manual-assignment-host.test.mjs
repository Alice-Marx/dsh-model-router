import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { packagePlanKey } from '../.dsh-plugin/shared/package-assignments.mjs'
import { parseRunRequest } from '../.dsh-plugin/shared/official-tools-remote.mjs'

// Entirely offline fixtures: no provider accounts, CLI processes or real DSH home.
const home = await mkdtemp(join(tmpdir(), 'router-manual-host-'))
const previousHome = process.env.DSH_HOME
const previousFetch = globalThis.fetch
process.env.DSH_HOME = home
globalThis.fetch = async () => { throw new Error('Unexpected fixture network request') }
const host = await import('../.dsh-plugin/index.mjs')
after(async () => {
  globalThis.fetch = previousFetch
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  assert.equal(dirname(resolve(home)), resolve(tmpdir()))
  assert.ok(basename(home).startsWith('router-manual-host-'))
  await rm(home, { recursive: true, force: true })
})
beforeEach(async () => {
  await host.routerStateStore().update(state => {
    state.runs = []; state.archivedSpending = {}; state.quota = {}; state.authFailures = {}
    state.dynamicData = { liveBench: null, pricing: null, status: {}, revision: '' }
  })
})

const provider = 'manual-fixture'
const models = ['economy', 'strong']
const task = '请完成复杂工程分析：\n1. 分析 Python 代码的模块与错误。\n2. 根据第1步结果提出修复和验证方案。\n最后汇总交付物与验收结果。'
const settings = extra => ({ dynamicDataEnabled: false, reviewMode: 'off',
  modelProfilesJson: JSON.stringify(models.map((model, index) => ({ provider, model,
    quality: index ? 96 : 82, execution: 'api', billing: 'api-only', subscription: 'none',
    pricing: { input: index ? 10 : 1, output: index ? 20 : 2 } }))), ...extra })
const options = { skipToolProbe: true, installedToolIds: ['codex'], runnableToolIds: ['codex'],
  readiness: [{ id: 'codex', ready: true, readyModes: ['read-only'] }],
  executionCapabilities: [{ id: 'codex', modes: ['read-only'] }], workspace: home, billing: false, planMode: 'team' }
function context(answer = 'API_RESULT') {
  const calls = []
  return { calls, sandbox: { confine() { throw new Error('No real CLI permitted') } }, llm: {
    listProviders: () => [provider], listModels: async () => models.map(id => ({ id })),
    resolveModelInfo: async (_, model) => ({ id: model, reasoning: { efforts: ['low', 'high'], defaultEffort: 'low' } }),
    stream(request) {
      calls.push(request)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: answer }
        yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 100 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  } }
}
async function manual(ctx, config, sourceTask = task, extra = {}) {
  const planned = await host.planAssignment(ctx, sourceTask, config, options)
  return { assignmentMode: 'manual', packagePlanKey: packagePlanKey(planned.plan, sourceTask),
    packageAssignments: Object.fromEntries(planned.plan.team.workPackages.map(item => [item.id,
      { kind: 'api', provider, model: 'economy' }])), ...extra }
}

test('remote manual contract preserves targets and rejects incompatible or incomplete requests', async () => {
  const ctx = context()
  const binding = await manual(ctx, settings())
  const request = { task, planMode: 'team', ...binding }
  assert.deepEqual(parseRunRequest(request).packageAssignments, binding.packageAssignments)
  assert.equal(parseRunRequest(request).assignmentMode, 'manual')
  assert.deepEqual(parseRunRequest({ task }), { task, confirmedReasons: [] })
  for (const broken of [
    { ...request, assignmentMode: 'algorithm' }, { ...request, packagePlanKey: '' },
    { ...request, executor: 'official-team' }, { ...request, provider, model: 'economy' },
    { ...request, packageAssignments: {} },
  ]) assert.throws(() => parseRunRequest(broken))
  assert.equal(ctx.calls.length, 0)
})

test('manual API-tool-API execution uses the exact choices and feeds tool output downstream', async () => {
  const ctx = context()
  const config = settings()
  const binding = await manual(ctx, config)
  const ids = Object.keys(binding.packageAssignments)
  assert.ok(ids.length >= 3)
  binding.packageAssignments[ids[1]] = { kind: 'tool', toolId: 'codex' }
  binding.packageAssignments[ids.at(-1)] = { kind: 'api', provider, model: 'strong' }
  const tools = []
  const result = await host.executeConfiguredAssignment(ctx, task, config, { ...options, ...binding,
    runVerified: async request => {
      tools.push(request)
      return { status: 'succeeded', finalText: 'TOOL_RESULT', reportedCostUsd: 0.003, reportedModel: 'fixture-cli' }
    } })
  assert.equal(tools.length, 1)
  assert.equal(tools[0].toolId, 'codex')
  assert.equal(tools[0].mode, 'read-only')
  assert.equal(ctx.calls.length, ids.length - 1)
  assert.equal(ctx.calls.at(-1).model, 'strong')
  assert.match(JSON.stringify(ctx.calls.at(-1).messages), /TOOL_RESULT/)
  assert.ok(ctx.calls.every(call => !Object.hasOwn(call, 'reasoningEffort')))
  assert.equal(result.run.assignmentMode, 'manual')
  assert.ok(result.run.packages.every(item => item.selectionSource === 'manual' && item.manualAssignment))
  const tool = result.run.packages.find(item => item.id === ids[1])
  assert.equal(tool.channel, 'official-cli')
  assert.equal(tool.toolId, 'codex')
  assert.equal(result.plan.estimatedCost, null, 'default CLI model cost cannot reuse the old API price')
  const saved = (await host.ledgerSummary(config)).runs.find(run => run.id === result.runId)
  assert.deepEqual(saved.packages.map(item => item.manualAssignment), result.run.packages.map(item => item.manualAssignment))
})

test('stale decomposition, missing model and unready later tool all refuse before the first API call', async () => {
  const ctx = context()
  const config = settings()
  const binding = await manual(ctx, config)
  const last = Object.keys(binding.packageAssignments).at(-1)
  await assert.rejects(host.executeConfiguredAssignment(ctx, task + '\n再增加性能验证。', config,
    { ...options, ...binding }), /拆分|计划|过期|stale|plan/i)
  const missing = structuredClone(binding)
  missing.packageAssignments[last] = { kind: 'api', provider, model: 'missing' }
  await assert.rejects(host.executeConfiguredAssignment(ctx, task, config, { ...options, ...missing }))
  const tool = structuredClone(binding)
  tool.packageAssignments[last] = { kind: 'tool', toolId: 'codex' }
  await assert.rejects(host.executeConfiguredAssignment(ctx, task, config,
    { ...options, ...tool, readiness: [{ id: 'codex', ready: false, reason: 'fixture not ready' }] }), /就绪/)
  assert.equal(ctx.calls.length, 0)
})

test('manual budget overrun pauses and confirmation keeps the chosen expensive model', async () => {
  const ctx = context()
  const config = settings({ overBudgetAction: 'downgrade' })
  const binding = await manual(ctx, config)
  for (const id of Object.keys(binding.packageAssignments)) binding.packageAssignments[id].model = 'strong'
  const request = { ...options, ...binding, budgetUsd: 0.000001 }
  const paused = await host.executeConfiguredAssignment(ctx, task, config, request)
  assert.equal(paused.paused, true)
  assert.equal(ctx.calls.length, 0)
  assert.ok(paused.plan.team.workPackages.every(item => item.recommendedModel === 'strong'))
  const result = await host.executeConfiguredAssignment(ctx, task, config, { ...request, confirmOverBudget: true })
  assert.ok(ctx.calls.length > 1)
  assert.ok(ctx.calls.every(call => call.model === 'strong'))
  assert.notEqual(result.budget.downgraded, true)
})

test('manual API pin prevents configured automatic quality escalation', async () => {
  const ctx = context('{}')
  const config = settings({ qualityEscalationEnabled: true,
    qualityGateJson: JSON.stringify({ kind: 'json-object', requiredKeys: ['answer'] }) })
  const binding = await manual(ctx, config)
  const result = await host.executeConfiguredAssignment(ctx, task, config, { ...options, ...binding })
  assert.ok(ctx.calls.length >= 1)
  assert.ok(ctx.calls.every(call => call.model === 'economy'))
  assert.ok(result.run.packages.filter(item => item.qualityAttempts).every(item => item.qualityAttempts.length === 1))
})

test('workbench executes its prepared manual plan and returns actual assigned channels', async () => {
  const ctx = context()
  const config = settings()
  const binding = await manual(ctx, config)
  const request = { task, workspace: home, planMode: 'team', ...binding }
  const preview = await host.previewWorkbenchRun(ctx, config, request, { planOptions: options })
  assert.equal(preview.assignmentMode, 'manual')
  assert.equal(preview.packagePlanKey, binding.packagePlanKey)
  assert.ok(preview.decision.packages.every(item => item.channel === 'harness-llm' && item.selectionSource === 'manual'))
  const result = await host.startWorkbenchRun(ctx, config, { ...request,
    confirmedReasons: preview.reasons.map(item => item.code) }, { planOptions: options })
  assert.equal(result.status, 'completed')
  assert.ok(ctx.calls.length >= 1)
  assert.ok(ctx.calls.every(call => call.model === 'economy'))
})

test('a recorded manual tool failure reruns the same tool and retains earlier charges', async () => {
  const ctx = context()
  const config = settings()
  const binding = await manual(ctx, config)
  const first = Object.keys(binding.packageAssignments)[0]
  binding.packageAssignments[first] = { kind: 'tool', toolId: 'codex' }
  const tools = []
  const runVerified = async request => {
    tools.push(request)
    return tools.length === 1 ? { status: 'failed', error: 'fixture tool failure', reportedCostUsd: 0.003, credentialSource: 'configured-api-key' }
      : { status: 'succeeded', finalText: 'TOOL_RETRY_RESULT', reportedCostUsd: 0.004, credentialSource: 'configured-api-key' }
  }
  const initial = await host.executeConfiguredAssignment(ctx, task, config, { ...options, ...binding, runVerified })
  assert.equal(tools.length, 1)
  assert.equal(initial.run.packages[0].ok, false)
  assert.deepEqual(initial.run.packages[0].manualAssignment, { kind: 'tool', toolId: 'codex' })
  const retried = await host.rerunRecordedStep(ctx, config, { ...options, runId: initial.runId, packageId: first, runVerified })
  assert.equal(tools.length, 2)
  assert.ok(tools.every(request => request.toolId === 'codex'))
  assert.equal(retried.run.packages[0].channel, 'official-cli')
  assert.deepEqual(retried.run.packages[0].manualAssignment, { kind: 'tool', toolId: 'codex' })
  assert.ok((await host.ledgerSummary(config)).spent.today >= 0.007 - 1e-12)
})

test('manual vision packages cannot be reassigned to a known text-only model on rerun', async () => {
  const ctx = context()
  const originalInfo = ctx.llm.resolveModelInfo
  ctx.llm.resolveModelInfo = async (id, model) => ({ ...await originalInfo(id, model),
    inputModalities: model === 'economy' ? ['text', 'image'] : ['text'] })
  const config = settings()
  const visualTask = '请完成以下任务：\n1. 分析图片截图，识别图像里的问题。\n2. 根据第1步结果编写总结。'
  const binding = await manual(ctx, config, visualTask)
  const initial = await host.executeConfiguredAssignment(ctx, visualTask, config, { ...options, ...binding })
  const target = initial.run.packages.find(item => item.type === 'vision')
  assert.ok(target)
  const callsBeforeRerun = ctx.calls.length
  await assert.rejects(host.rerunRecordedStep(ctx, config, { ...options, runId: initial.runId,
    packageId: target.id, provider, model: 'strong' }), /图像模型/)
  assert.equal(ctx.calls.length, callsBeforeRerun)
})
