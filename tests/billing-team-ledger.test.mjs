import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-billing-'))
for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete process.env[name]

const {
  billingOf, billedCost, spending, buildRunRecord, teamExecutionResults, buildTeamRunRecord, buildToolRunRecord,
} = await import('../.dsh-plugin/shared/run-ledger.mjs')
const { checkLogin, apiKeyEnvPresent } = await import('../.dsh-plugin/shared/tool-health.mjs')
const { packageCost, runTotals, rerunSupport } = await import('../.dsh-plugin/client/insights-state.mjs')
const host = await import('../.dsh-plugin/index.mjs')

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'model-router-billing-ws-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

const cli = extra => ({ ok: true, channel: 'official-cli', toolId: 'claude-code', ...extra })

test('billing: API key or API path counts, a subscription CLI login does not', () => {
  assert.equal(billingOf({ ok: true, channel: 'harness-llm' }), 'api')
  assert.equal(billingOf(cli({ credentialSource: 'configured-api-key' })), 'api')
  assert.equal(billingOf(cli({ credentialSource: 'process-environment' })), 'api')
  assert.equal(billingOf(cli({ credentialSource: 'cli-session' })), 'subscription')
  assert.equal(billingOf(cli({ credentialSource: 'cli-session' }), { loginBilling: 'api-key' }), 'api', 'CLI logged in with its own API key')
  assert.equal(billingOf(cli({})), 'subscription', 'signed team runner without key variables')
  assert.equal(billingOf(cli({}), { apiKeyPresent: true }), 'api')
  assert.equal(billingOf({ blocked: true }), null)

  const subscription = billedCost(cli({ reportedCostUsd: 0.42 }), null, 'subscription')
  assert.deepEqual(subscription, { costUsd: null, costSource: 'cli-reported', billing: 'subscription', referenceCostUsd: 0.42 })
  const api = billedCost(cli({ reportedCostUsd: 0.42 }), null, 'api')
  assert.equal(api.costUsd, 0.42)
  assert.equal(api.referenceCostUsd, null)
})

test('spending keeps subscription reference cost out of budget totals', () => {
  const now = Date.now()
  const runs = [{ createdAt: now, packages: [
    { ran: true, finishedAt: now, billing: 'api', costUsd: 0.1 },
    { ran: true, finishedAt: now, billing: 'subscription', costUsd: null, referenceCostUsd: 2 },
    { ran: true, finishedAt: now, billing: 'subscription', costUsd: null, referenceCostUsd: null },
    { ran: true, finishedAt: now, costUsd: 0.05 }, // record from before billing existed
  ], reviews: [] }]
  const spent = spending(runs, now)
  assert.equal(Number(spent.today.toFixed(4)), 0.15)
  assert.equal(spent.subscriptionToday, 2)
  assert.equal(spent.subscriptionRunsMonth, 2)
  assert.equal(spent.unknownToday, 0, 'a subscription run without usage is not "price missing"')
})

test('a subscription CLI run stores the reference figure separately', () => {
  const plan = { routingBypassed: true, directRoute: { provider: 'anthropic', model: 'claude-x' }, complexity: { band: 'simple', value: 0.2 }, estimatedCost: 0.01 }
  const record = buildRunRecord({
    id: 'r1', createdAt: 1, task: 't', plan,
    execution: { status: 'completed', packages: [{ id: 'direct', ...cli({ credentialSource: 'cli-session', reportedCostUsd: 0.3, answer: 'ok' }) }] },
  })
  const pkg = record.packages[0]
  assert.equal(pkg.billing, 'subscription')
  assert.equal(pkg.costUsd, null)
  assert.equal(pkg.referenceCostUsd, 0.3)
  assert.match(packageCost(pkg).reference, /订阅参考费用 \$0\.3000（按 API 价折算）/)
  assert.equal(packageCost(pkg).budget, '不计入预算')
  assert.deepEqual(runTotals(record), { budgetUsd: 0, referenceUsd: 0.3, subscription: true })
})

test('health check reports whether a CLI login bills an API key or a subscription', async () => {
  const runner = (stdout, ok = true) => async () => ({ ok, stdout, stderr: '', timedOut: false })
  assert.equal((await checkLogin('claude-code', { runner: runner('{"loggedIn":true,"authMethod":"claude.ai"}'), env: {} })).billing, 'subscription')
  assert.equal((await checkLogin('claude-code', { runner: runner('{"loggedIn":true,"authMethod":"api_key"}'), env: {} })).billing, 'api-key')
  assert.equal((await checkLogin('claude-code', { runner: runner('{"loggedIn":true,"authMethod":"claude.ai"}'), env: { ANTHROPIC_API_KEY: 'x' } })).billing, 'api-key')
  assert.equal((await checkLogin('codex', { runner: runner('Logged in using ChatGPT'), env: {} })).billing, 'subscription')
  assert.equal((await checkLogin('codex', { runner: runner('Logged in using an API key - sk-***'), env: {} })).billing, 'api-key')
  assert.equal((await checkLogin('claude-code', { runner: runner('{"loggedIn":false}'), env: { CLAUDE_CODE_OAUTH_TOKEN: 't' } })).billing, 'subscription')
  assert.equal(apiKeyEnvPresent('codex', { OPENAI_API_KEY: ' ' }), false)
  assert.equal(apiKeyEnvPresent('codex', { CODEX_API_KEY: 'k' }), true)
})

function teamPlan() {
  const item = (id, provider, model, dependsOn = []) => ({ id, name: `包 ${id}`, type: 'general', purpose: 'execution', dependsOn,
    objective: `完成 ${id}`, verificationChecklist: [`检查 ${id}`], recommendedProvider: provider, recommendedModel: model, estimatedCost: 0.01 })
  return { mode: 'team', preset: 'balanced', complexity: { band: 'complex', value: 0.8 }, estimatedCost: 0.02, reason: '拆分',
    team: { workPackages: [item('a', 'anthropic', 'claude-x'), item('b', 'openai', 'gpt-x', ['a']), item('c', 'openai', 'gpt-x', ['b'])] } }
}

test('team runs map runner results to steps; unreached steps are blocked', () => {
  const converted = teamExecutionResults(teamPlan(), { status: 'incomplete', results: [
    { id: 'a', status: 'succeeded', provider: 'anthropic', recommendedModel: 'claude-x', toolId: 'claude-code', finalText: '分析', usage: { inputTokens: 10, outputTokens: 5 } },
    { id: 'b', status: 'timed-out', provider: 'openai', recommendedModel: 'gpt-x', toolId: 'codex', finalText: '', error: null, outputTail: 'stderr…' },
  ] })
  assert.deepEqual(converted.packages.map(item => [item.id, item.ok, item.blocked === true]), [['a', true, false], ['b', false, false], ['c', false, true]])
  assert.equal(converted.packages[1].error, 'timed-out')
  const record = buildTeamRunRecord({ id: 't1', createdAt: 1, task: '团队', plan: teamPlan(), execution: { status: 'incomplete', results: [] }, mode: 'read-only' })
  assert.equal(record.kind, 'team')
  assert.equal(record.executionMode, 'read-only')
  assert.deepEqual(record.packages.map(item => item.status), ['blocked', 'blocked', 'blocked'])
  assert.equal(record.packages[0].purpose, 'execution')
  const blocked = teamExecutionResults(teamPlan(), { status: 'blocked', blocking: [{ reason: '沙箱不可用' }], results: [] })
  assert.match(blocked.packages[0].error, /沙箱不可用/)
})

test('tool runs are recorded as one step; a failed one can be re-run, editable teams only when continuable', () => {
  const record = buildToolRunRecord({ id: 'x', createdAt: 1, task: '读代码', toolId: 'codex', toolLabel: 'Codex', mode: 'read-only',
    result: { status: 'succeeded', finalText: '完成', usage: { inputTokens: 1, outputTokens: 1 } } })
  assert.equal(record.kind, 'tool')
  assert.equal(record.packages.length, 1)
  assert.equal(record.packages[0].status, 'succeeded')
  assert.equal(record.packages[0].billing, 'subscription')
  assert.equal(record.packages[0].name, 'Codex 单次调用')
  assert.equal(rerunSupport(record).supported, true)
  assert.equal(rerunSupport(record).reassign, false)
  assert.equal(rerunSupport({ kind: 'tool', executionMode: 'workspace-write', toolRun: { toolId: 'kimi-code' } }).writes, true)
  assert.equal(rerunSupport({ kind: 'team', executionMode: 'workspace-write' }).supported, false)
  assert.equal(rerunSupport({ kind: 'team', executionMode: 'workspace-write', status: 'cli-completed', isolatedWorkspace: '/w', baseCommit: 'a'.repeat(40) }).supported, false)
  const continuable = rerunSupport({ kind: 'team', executionMode: 'workspace-write', status: 'incomplete', isolatedWorkspace: '/w', baseCommit: 'a'.repeat(40) })
  assert.equal(continuable.supported, true)
  assert.equal(continuable.writes, true)
  assert.equal(rerunSupport({ kind: 'team', executionMode: 'read-only' }).supported, true)
  assert.equal(rerunSupport({}).supported, true)
})

function teamCtx() {
  return {
    sandbox: { confine() { throw new Error('the injected runner never spawns') } },
    llm: {
      listProviders: () => [{ id: 'anthropic' }, { id: 'openai' }],
      listModels: async provider => provider === 'anthropic' ? [{ id: 'claude-x' }] : [{ id: 'gpt-x' }],
      resolveModelInfo: async (provider, model) => ({ provider, id: model }),
    },
  }
}

test('read-only team runs are recorded and one failed step re-runs with its downstream only', async t => {
  const cwd = await workspace(t)
  const config = { modelProfilesJson: JSON.stringify([{ provider: 'openai', model: 'gpt-x', quality: 80, pricing: { input: 1, output: 2 } }]) }
  const run = await host.recordTeamRun({ task: '团队任务', plan: teamPlan(), mode: 'read-only', workspace: cwd, routes: [], startedAt: Date.now(),
    cliModels: { a: 'haiku', c: 'gpt-mini', codex: 'ignored-tool-key' },
    execution: { status: 'incomplete', workspace: cwd, results: [
      { id: 'a', status: 'succeeded', provider: 'anthropic', recommendedModel: 'claude-x', toolId: 'claude-code', finalText: '前置分析', reportedCostUsd: 0.7 },
      { id: 'b', status: 'failed', provider: 'openai', recommendedModel: 'gpt-x', toolId: 'codex', finalText: '', error: 'Codex 未返回完整成功终态和回答。' },
    ] } })
  assert.ok(run?.id)
  assert.deepEqual(run.packages.map(item => item.status), ['succeeded', 'failed', 'blocked'])
  assert.equal(run.packages[0].billing, 'subscription')
  assert.equal(run.packages[0].referenceCostUsd, 0.7)
  assert.deepEqual(run.cliModels, { a: 'haiku', c: 'gpt-mini', codex: 'ignored-tool-key' })

  await assert.rejects(() => host.rerunRecordedStep(teamCtx(), config, { runId: run.id, packageId: 'a' }), /已成功/)
  const calls = []
  const result = await host.rerunRecordedStep(teamCtx(), config, {
    runId: run.id, packageId: 'b', installedToolIds: ['claude-code', 'codex'],
    runTeam: async options => {
      calls.push(options)
      return { status: 'cli-completed', results: [
        { id: 'b', status: 'succeeded', provider: 'openai', recommendedModel: 'gpt-x', toolId: 'codex', finalText: '实现', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
        { id: 'c', status: 'succeeded', provider: 'openai', recommendedModel: 'gpt-x', toolId: 'codex', finalText: '复核' },
      ] }
    },
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].onlyIds, ['b', 'c'])
  assert.equal(calls[0].mode, 'read-only')
  assert.deepEqual(calls[0].previous, [{ id: 'a', name: '包 a', finalText: '前置分析' }])
  assert.deepEqual(calls[0].cliModels, { c: 'gpt-mini' })
  assert.deepEqual(calls[0].plan.team.workPackages.map(item => item.id), ['b', 'c'])
  assert.deepEqual(result.run.packages.map(item => item.status), ['succeeded', 'succeeded', 'succeeded'])
  assert.equal(result.run.packages[0].referenceCostUsd, 0.7, 'finished step keeps its stored result')
  assert.equal(result.run.packages[1].billing, 'subscription')
  assert.equal(result.run.packages[1].referenceCostUsd, 1, 'usage × configured price is reference-only on a subscription login')
  assert.equal(result.run.status, 'cli-completed')

  const ledger = await host.ledgerSummary(config)
  const stored = ledger.runs.find(item => item.id === run.id)
  assert.equal(stored.kind, 'team')
  assert.equal(ledger.spent.month, 0)
  assert.ok(ledger.spent.subscriptionMonth >= 1.7)
})

test('old editable team records without a base commit refuse rerun; failed tool runs rerun as a linked run', async t => {
  const cwd = await workspace(t)
  const write = await host.recordTeamRun({ task: '改代码', plan: teamPlan(), mode: 'workspace-write', workspace: cwd, routes: [], startedAt: Date.now(),
    execution: { status: 'incomplete', results: [{ id: 'a', status: 'failed', provider: 'anthropic', recommendedModel: 'claude-x', toolId: 'claude-code', finalText: '' }] } })
  await assert.rejects(() => host.rerunRecordedStep(teamCtx(), {}, { runId: write.id, packageId: 'a' }), /Git 基线|model_router_team_execute/)
  const tool = await host.recordToolRun({ toolId: 'codex', task: '读', mode: 'read-only', workspace: cwd, startedAt: Date.now(),
    result: { status: 'failed', error: 'boom', finalText: '' } })
  assert.equal(tool.packages[0].status, 'failed')
  assert.equal(tool.toolRun.toolId, 'codex')
  const calls = []
  const rerun = await host.rerunRecordedStep(teamCtx(), {}, { runId: tool.id, packageId: 'direct',
    runTask: async request => { calls.push(request); return { toolId: 'codex', status: 'succeeded', finalText: '好了' } } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].toolId, 'codex')
  assert.equal(calls[0].mode, 'read-only')
  assert.equal(calls[0].task, '读')
  assert.equal(rerun.rerunOf, tool.id)
  assert.notEqual(rerun.newRunId, tool.id)
  assert.equal(rerun.run.rerunOf, tool.id)
  assert.equal(rerun.run.packages[0].status, 'succeeded')
  await assert.rejects(() => host.rerunRecordedStep(teamCtx(), {}, { runId: rerun.newRunId, packageId: 'direct' }), /已成功/)
})

test('an API key in the environment makes CLI spend count against the budget', () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  try {
    assert.equal(host.billingForResult({ ok: true, channel: 'official-cli', toolId: 'claude-code' }), 'api')
  } finally { delete process.env.ANTHROPIC_API_KEY }
  assert.equal(host.billingForResult({ ok: true, channel: 'official-cli', toolId: 'claude-code' }), 'subscription')
})
