import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strictCtx } from './helpers/strict-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-roadmap-'))

const { checkLogin, checkToolHealth, createHealthCache, versionStatus, runHealthCheck } = await import('../.dsh-plugin/shared/tool-health.mjs')
const {
  executeAssignedTask, failureDetail, usageFromOutput, redactDiagnostic, rerunAssignmentPackage, downstreamPackageIds,
} = await import('../.dsh-plugin/shared/task-executors.mjs')
const { actualCost, budgetCheck, spending, routeQualityBiases, buildRunRecord, MAX_QUALITY_BIAS } = await import('../.dsh-plugin/shared/run-ledger.mjs')
const { createPlanFromRoutes, channelForProvider } = await import('../.dsh-plugin/shared/harness-plan.mjs')
const { presetWeights, normalizeRoutingPreset } = await import('../.dsh-plugin/shared/routing-presets.mjs')
const { routeBoundaries } = await import('../.dsh-plugin/shared/security-boundaries.mjs')
const { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS } = await import('../.dsh-plugin/shared/official-tools-remote.mjs')
const { getOfficialTool } = await import('../.dsh-plugin/shared/official-tool-registry.mjs')
const host = await import('../.dsh-plugin/index.mjs')

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'model-router-ws-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

function fakeChild({ ignoreTerm = false } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end() {}, on() {} }
  child.signals = []
  child.kill = signal => {
    child.signals.push(signal)
    if (signal === 'SIGKILL' || !ignoreTerm) queueMicrotask(() => child.emit('close', null))
  }
  return child
}

function scriptedSpawn(handler) {
  const calls = []
  const spawnImpl = (file, args, options) => {
    calls.push({ file, args, options })
    const script = handler(file, args) ?? { code: 0, stdout: '' }
    const child = fakeChild(script)
    if (script.hang) { calls.at(-1).child = child; return child }
    queueMicrotask(() => {
      if (script.stdout) child.stdout.emit('data', Buffer.from(script.stdout))
      if (script.stderr) child.stderr.emit('data', Buffer.from(script.stderr))
      child.emit('close', script.code ?? 0)
    })
    return child
  }
  return { spawnImpl, calls }
}

const lines = events => `${events.map(event => JSON.stringify(event)).join('\n')}\n`

// ---------------------------------------------------------------- 1. health

test('login checks use fixed status commands and never read credential values', async () => {
  const seen = []
  const runner = async (file, args) => {
    seen.push([file, ...args].join(' '))
    if (file === 'claude') return { ok: false, code: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), stderr: '' }
    if (file === 'codex') return { ok: false, code: 1, stdout: 'Not logged in\n', stderr: '' }
    return { ok: false, code: 1, stdout: '', stderr: '' }
  }
  assert.equal((await checkLogin('claude-code', { runner, env: {} })).state, 'logged-out')
  assert.equal((await checkLogin('codex', { runner, env: {} })).state, 'logged-out')
  assert.deepEqual(seen, ['claude auth status --json', 'codex login status'])
  const withKey = await checkLogin('codex', { runner, env: { OPENAI_API_KEY: 'sk-secret-value-123' } })
  assert.equal(withKey.state, 'logged-in')
  assert.equal(JSON.stringify(withKey).includes('sk-secret'), false)
  const loggedIn = await checkLogin('claude-code', { runner: async () => ({ ok: true, code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }), env: {} })
  assert.equal(loggedIn.state, 'logged-in')
  assert.equal((await checkLogin('codex', { runner: async () => ({ ok: false, timedOut: true, stdout: '', stderr: '' }), env: {} })).state, 'unknown')
  assert.equal((await checkLogin('gemini', { env: {}, home: '/h', exists: async path => path === '/h/.gemini/oauth_creds.json' })).state, 'logged-in')
  assert.equal((await checkLogin('kimi-code', { env: {} })).state, 'unknown')
})

test('health report covers every registry tool with version status and a login guide', async () => {
  const probes = [{ id: 'codex', installed: true, version: '0.160.0', status: 'installed' }, { id: 'claude-code', installed: true, version: '2.1.200', status: 'installed' }]
  const runner = async file => file === 'codex' ? { ok: true, code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' } : { ok: false, code: 1, stdout: '{"loggedIn":false}', stderr: '' }
  const report = await runHealthCheck(probes, { runner, env: {}, now: () => 42 })
  assert.equal(report.checkedAt, 42)
  assert.equal(report.tools.length, 8)
  const codex = report.tools.find(item => item.id === 'codex')
  assert.equal(codex.versionStatus, 'ok')
  assert.equal(codex.login.state, 'logged-in')
  assert.equal(codex.ready, true)
  const claude = report.tools.find(item => item.id === 'claude-code')
  assert.equal(claude.versionStatus, 'older')
  assert.equal(claude.ready, false)
  assert.equal(claude.login.command, 'claude auth login')
  assert.equal(report.tools.find(item => item.id === 'gemini').installed, false)
  assert.equal(versionStatus(getOfficialTool('codex'), null), 'unknown')
  assert.equal((await checkToolHealth({ id: 'zcode', installed: false })).login.state, 'unknown')
})

test('health cache skips logged-out tools until it expires, unless an API key is configured', () => {
  let clock = 1_000
  const cache = createHealthCache({ ttlMs: 500, now: () => clock })
  cache.remember({ checkedAt: clock, tools: [{ id: 'codex', installed: true, login: { state: 'logged-out' } }, { id: 'claude-code', installed: true, login: { state: 'unknown' } }] })
  assert.match(cache.skipReason({ toolId: 'codex' }), /未登录/)
  assert.equal(cache.skipReason({ toolId: 'codex', hasApiKey: true }), null)
  assert.equal(cache.skipReason({ toolId: 'claude-code' }), null)
  cache.markLoggedOut('claude-code', 'Not logged in')
  assert.match(cache.skipReason({ toolId: 'claude-code' }), /未登录/)
  clock += 600
  assert.equal(cache.skipReason({ toolId: 'codex' }), null)
})

test('a cached logged-out tool falls back to the API without spawning the CLI', async t => {
  const cwd = await workspace(t)
  const { spawnImpl, calls } = scriptedSpawn(() => ({ code: 0 }))
  const result = await executeAssignedTask({
    route: { provider: 'openai', model: 'gpt-5' }, task: '回答 OK', workspace: cwd, spawnImpl,
    skipOfficial: ({ toolId }) => toolId === 'codex' ? 'Codex CLI 未登录' : null,
    apiFallback: async () => ({ ok: true, answer: 'api' }),
  })
  assert.equal(calls.length, 0)
  assert.equal(result.channel, 'harness-llm')
  assert.equal(result.fallback.skipped, true)
  assert.equal(result.fallback.reason, 'Codex CLI 未登录')
})

test('planner marks logged-out CLI routes as API channel', () => {
  const channel = channelForProvider('openai', ['codex'], [], null, ['codex'])
  assert.equal(channel.kind, 'harness-llm')
  assert.equal(channel.loginRequired, true)
  assert.equal(channelForProvider('openai', ['codex'], [], null, []).kind, 'official-cli')
})

// ------------------------------------------------- 2. real fallback errors

test('fallback reports the vendor error text, redacted', async t => {
  assert.equal(failureDetail('claude-json', JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' })), 'Not logged in · Please run /login')
  assert.equal(failureDetail('codex-jsonl', lines([
    { type: 'error', message: 'Reconnecting... 1/5 (401)' },
    { type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } },
  ])), 'unexpected status 401 Unauthorized')
  assert.equal(failureDetail('gemini-json', '{}', 'line one\nboom: quota exceeded\n'), 'line one | boom: quota exceeded')
  assert.equal(redactDiagnostic('key sk-abcdefghijklmnop and Bearer abcdefghijklmnop api_key=supersecretvalue'), 'key sk-[redacted] and Bearer [redacted] api_key=[redacted]')
  assert.equal(failureDetail('claude-json', '', 'token mysecret-token-1 failed', 'mysecret-token-1').includes('mysecret'), false)

  const cwd = await workspace(t)
  const { spawnImpl } = scriptedSpawn((file, args) => args[0] === '--version'
    ? { code: 0, stdout: '2.1.287\n' }
    : { code: 1, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }) })
  const result = await executeAssignedTask({
    route: { provider: 'anthropic', model: 'claude-sonnet' }, task: '回答 OK', workspace: cwd, spawnImpl,
    apiFallback: async () => ({ ok: true, answer: 'api' }),
  })
  assert.equal(result.channel, 'harness-llm')
  assert.equal(result.fallback.error, 'Not logged in · Please run /login')
  assert.equal(result.fallback.loginRequired, true)
})

// --------------------------------------------------------- 3. usage, cost

test('CLI usage is read in the Harness TokenUsage shape', () => {
  const claude = usageFromOutput('claude-json', JSON.stringify({ type: 'result', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 }, total_cost_usd: 0.0123 }))
  assert.deepEqual(claude, { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 7 }, reportedCostUsd: 0.0123 })
  const codex = usageFromOutput('codex-jsonl', lines([{ type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 1000, output_tokens: 30 } }]))
  assert.deepEqual(codex.usage, { inputTokens: 200, outputTokens: 30, cacheReadTokens: 1000, cacheWriteTokens: 0 })
  assert.equal(usageFromOutput('codex-jsonl', 'not json'), null)
})

test('actual cost prefers a CLI-reported cost, else usage × price', () => {
  assert.deepEqual(actualCost({ reportedCostUsd: 0.5 }, null), { costUsd: 0.5, costSource: 'cli-reported' })
  const cost = actualCost({ usage: { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 1_000_000 } }, { input: 1, output: 4, cacheRead: 0.1 })
  assert.equal(cost.costSource, 'usage')
  assert.ok(Math.abs(cost.costUsd - 3.1) < 1e-9)
  assert.equal(actualCost({ usage: { inputTokens: 1 } }, null).costUsd, null)
})

test('spending and budget decisions use local day and month', () => {
  const now = new Date(2026, 9, 2, 15).getTime()
  const yesterday = new Date(2026, 9, 1, 15).getTime()
  const lastMonth = new Date(2026, 8, 30, 15).getTime()
  const runs = [
    { createdAt: now, packages: [{ costUsd: 0.4, ran: true }, { costUsd: null, ran: true }], reviews: [{ costUsd: 0.1, ran: true }] },
    { createdAt: yesterday, packages: [{ costUsd: 1, ran: true }] },
    { createdAt: lastMonth, packages: [{ costUsd: 9, ran: true }] },
  ]
  const spent = spending(runs, now)
  assert.ok(Math.abs(spent.today - 0.5) < 1e-9)
  assert.ok(Math.abs(spent.month - 1.5) < 1e-9)
  assert.equal(spent.unknownToday, 1)
  const over = budgetCheck({ estimateUsd: 0.6, spent, dailyLimitUsd: 1, monthlyLimitUsd: 10 })
  assert.equal(over.exceeded, 'daily')
  assert.ok(Math.abs(over.remainingUsd - 0.5) < 1e-9)
  assert.equal(budgetCheck({ estimateUsd: 0.2, spent, dailyLimitUsd: 1 }).exceeded, null)
  assert.equal(budgetCheck({ estimateUsd: null, spent, dailyLimitUsd: 1 }).exceeded, null)
  assert.equal(budgetCheck({ estimateUsd: null, spent: { today: 1, month: 1 }, dailyLimitUsd: 1 }).exceeded, 'daily')
  assert.equal(budgetCheck({ estimateUsd: 5, spent }).limited, false)
})

// ------------------------------------------------------------ 4. presets

const PRESET_ROUTES = [
  { provider: 'cheap', model: 'flash', quality: 0.8, qualitySource: 'user', pricing: { input: 0.1, output: 0.2 }, pricingSource: 'user' },
  { provider: 'strong', model: 'pro', quality: 0.95, qualitySource: 'user', pricing: { input: 5, output: 25 }, pricingSource: 'user' },
]

test('presets tilt routing between cost and quality; balanced is the default', () => {
  assert.equal(normalizeRoutingPreset('nope'), 'balanced')
  const weights = { quality: 0.4, cost: 0.3, latency: 0.3 }
  const economy = presetWeights(weights, 'economy')
  assert.ok(economy.cost > weights.cost && economy.quality < weights.quality)
  assert.ok(Math.abs(Object.values(economy).reduce((a, b) => a + b, 0) - 1) < 1e-9)
  assert.equal(presetWeights(weights, 'balanced'), weights)
  const task = '请分析这个中等复杂度的接口设计，并给出改进建议和测试要点。'
  const balanced = createPlanFromRoutes(task, PRESET_ROUTES)
  assert.equal(balanced.preset, 'balanced')
  const cheap = createPlanFromRoutes(task, PRESET_ROUTES, { preset: 'economy' })
  const strong = createPlanFromRoutes(task, PRESET_ROUTES, { preset: 'quality' })
  assert.equal(cheap.selected.provider, 'cheap')
  assert.equal(strong.selected.provider, 'strong')
  assert.ok(cheap.estimatedCost <= strong.estimatedCost)
})

test('ratings and reviews nudge quality by a bounded, shrunk amount', () => {
  const biases = routeQualityBiases([{ packages: [
    { provider: 'cheap', model: 'flash', rating: 1 },
    { provider: 'cheap', model: 'flash', rating: 1 },
    { provider: 'strong', model: 'pro', rating: -1, review: { score: 1 } },
  ] }])
  assert.ok(biases['cheap\u0000flash'] > 0 && biases['cheap\u0000flash'] < MAX_QUALITY_BIAS)
  assert.ok(biases['strong\u0000pro'] < 0 && biases['strong\u0000pro'] >= -MAX_QUALITY_BIAS)
  const many = routeQualityBiases([{ packages: Array.from({ length: 200 }, () => ({ provider: 'a', model: 'b', rating: 1 })) }])
  assert.ok(many['a\u0000b'] <= MAX_QUALITY_BIAS)
})

// ------------------------------------------------- 5. DAG retry, SIGKILL

test('rerunning one failed step keeps finished work and continues blocked dependents', async t => {
  const cwd = await workspace(t)
  const packages = [
    { id: 'a', name: 'A', objective: 'a', dependsOn: [], recommendedProvider: 'deepseek', recommendedModel: 'chat' },
    { id: 'b', name: 'B', objective: 'b', dependsOn: ['a'], recommendedProvider: 'deepseek', recommendedModel: 'chat' },
    { id: 'c', name: 'C', objective: 'c', dependsOn: ['b'], recommendedProvider: 'deepseek', recommendedModel: 'chat' },
    { id: 'd', name: 'D', objective: 'd', dependsOn: [], recommendedProvider: 'deepseek', recommendedModel: 'chat' },
  ]
  assert.deepEqual(downstreamPackageIds(packages, 'a'), ['b', 'c'])
  const previous = [
    { id: 'a', name: 'A', ok: true, answer: 'A done', provider: 'deepseek', model: 'chat', channel: 'harness-llm' },
    { id: 'b', name: 'B', ok: false, answer: '', error: 'boom', provider: 'deepseek', model: 'chat', channel: 'harness-llm' },
    { id: 'c', name: 'C', ok: false, blocked: true, answer: '', error: '依赖未完成：b' },
    { id: 'd', name: 'D', ok: true, answer: 'D done', provider: 'deepseek', model: 'chat', channel: 'harness-llm' },
  ]
  const asked = []
  const result = await rerunAssignmentPackage({
    task: '总任务', packages, previous, packageId: 'b', workspace: cwd,
    override: { provider: 'deepseek', model: 'reasoner' },
    apiFallback: async ({ route, task }) => { asked.push({ route: `${route.provider}/${route.model}`, task }); return { ok: true, answer: `${route.model} ok` } },
  })
  assert.deepEqual(asked.map(item => item.route), ['deepseek/reasoner', 'deepseek/chat'])
  assert.match(asked[0].task, /A done/)
  assert.deepEqual(result.ranIds, ['b', 'c'])
  assert.equal(result.status, 'completed')
  assert.equal(result.packages.find(item => item.id === 'b').reassigned, true)
  assert.equal(result.packages.find(item => item.id === 'a').answer, 'A done')
})

test('a CLI that ignores SIGTERM is force-killed after the grace period', async t => {
  const cwd = await workspace(t)
  // A real child process keeps the event loop alive; the fake one does not.
  const keepAlive = setInterval(() => {}, 1_000)
  t.after(() => clearInterval(keepAlive))
  const { spawnImpl, calls } = scriptedSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : { hang: true, ignoreTerm: true })
  const result = await executeAssignedTask({
    route: { provider: 'openai', model: 'gpt-5' }, task: '回答 OK', workspace: cwd, spawnImpl,
    timeoutMs: 1_000, stopGraceMs: 50, apiFallback: async () => ({ ok: true, answer: 'api' }),
  })
  assert.equal(result.timedOut, true)
  assert.deepEqual(calls.at(-1).child.signals, ['SIGTERM', 'SIGKILL'])
})

// --------------------------------------------- 6. security, remote codecs

test('boundaries name what each channel can read and write', () => {
  const rows = routeBoundaries([
    { provider: 'openai', model: 'gpt-5' }, { provider: 'deepseek', model: 'chat' }, { provider: 'google', model: 'gemini-pro' },
  ], { sandboxedToolIds: [], platform: 'linux' })
  assert.equal(rows[0].readOnly.direct, true)
  assert.match(rows[0].readOnly.readable, /全部文件/)
  assert.equal(rows[0].write.requiresApproval, true)
  assert.equal(rows[1].toolId, null)
  assert.match(rows[1].readOnly.readable, /无本机文件访问/)
  assert.equal(rows[2].write, null)
  assert.equal(routeBoundaries([{ provider: 'openai', model: 'gpt-5' }], { sandboxedToolIds: ['codex'], platform: 'win32' })[0].readOnly.direct, false)
})

test('workbench RPC codecs accept only ids and paired routes', () => {
  const codec = name => OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.find(item => item.method === name).parameters[0].codec.create()
  assert.deepEqual(codec('rateResult').parse({ runId: 'r-1', packageId: 'p1', rating: 'up' }), { runId: 'r-1', packageId: 'p1', rating: 'up' })
  assert.throws(() => codec('rateResult').parse({ runId: 'r 1', packageId: 'p', rating: 'up' }))
  assert.throws(() => codec('rerunStep').parse({ runId: 'r', packageId: 'p', provider: 'openai' }))
  assert.deepEqual(codec('rerunStep').parse({ runId: 'r', packageId: 'p', confirmOverBudget: 'yes', confirmWrite: 1 }), { runId: 'r', packageId: 'p', confirmOverBudget: false, confirmWrite: false })
  assert.throws(() => codec('health').parse('true'))
})

// ------------------------------------ 3+7. Host integration with a mock ctx

function mockCtx({ answers = {} } = {}) {
  const streamCalls = []
  return strictCtx({
    streamCalls,
    llm: {
      listProviders: () => [{ id: 'cheap' }, { id: 'strong' }],
      listModels: async provider => provider === 'cheap' ? [{ id: 'flash' }] : [{ id: 'pro' }],
      resolveModelInfo: async (provider, model) => ({ provider, id: model }),
      stream(options) {
        streamCalls.push(options)
        const text = answers[options.model] ?? `${options.model} 的回答`
        return (async function* () {
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'usage', usage: { inputTokens: 1_000, outputTokens: 500 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  }, { testOnly: ['streamCalls'] })
}

const PROFILES = JSON.stringify([
  { provider: 'cheap', model: 'flash', quality: 80, pricing: { input: 0.1, output: 0.2 } },
  { provider: 'strong', model: 'pro', quality: 95, pricing: { input: 5, output: 25 } },
])
const baseOptions = cwd => ({ workspace: cwd, skipToolProbe: true, installedToolIds: [], runnableToolIds: [] })

test('execution records decision, channel and actual cost; ratings and retries update the ledger', async t => {
  const cwd = await workspace(t)
  const ctx = mockCtx({ answers: { pro: '{"score": 4, "summary": "基本正确"}' } })
  const config = { modelProfilesJson: PROFILES, reviewMode: 'always' }
  const result = await host.executeConfiguredAssignment(ctx, '请把下面这段话翻译成英文：你好，世界。', config, baseOptions(cwd))
  assert.equal(result.paused, undefined)
  assert.equal(result.execution.status, 'completed')
  const pkg = result.run.packages[0]
  assert.equal(pkg.provider, 'cheap')
  assert.equal(pkg.channel, 'harness-llm')
  assert.ok(pkg.costUsd > 0 && pkg.costSource === 'usage')
  assert.equal(pkg.review.score, 4)
  assert.equal(result.run.reviews.length, 1)
  assert.equal(ctx.streamCalls.at(-1).model, 'pro')

  const ledger = await host.ledgerSummary(config)
  assert.equal(ledger.runs[0].id, result.runId)
  assert.ok(ledger.spent.today > 0)

  const rated = await host.rateRecordedResult({ runId: result.runId, packageId: pkg.id, rating: 'down' })
  assert.equal(rated.packages[0].rating, -1)
  await assert.rejects(() => host.rateRecordedResult({ runId: result.runId, packageId: pkg.id, rating: 'meh' }))

  await assert.rejects(() => host.rerunRecordedStep(ctx, config, { runId: result.runId, packageId: pkg.id }), /已成功/)
  const rerun = await host.rerunRecordedStep(ctx, config, { runId: result.runId, packageId: pkg.id, provider: 'strong', model: 'pro', skipOfficial: () => null })
  assert.equal(rerun.run.packages[0].provider, 'strong')
  assert.equal(rerun.run.packages[0].reassigned, true)
  assert.equal(rerun.run.packages[0].rating, null)
  await assert.rejects(() => host.rerunRecordedStep(ctx, { ...config, allowManualReassign: false }, { runId: result.runId, packageId: pkg.id, provider: 'cheap', model: 'flash' }), /关闭手动改派/)
})

test('over budget: downgrade to the economy preset when it fits, otherwise pause until confirmed', async t => {
  const cwd = await workspace(t)
  const ctx = mockCtx()
  const task = '请分析这个中等复杂度的接口设计，并给出改进建议和测试要点。'
  const quality = { modelProfilesJson: PROFILES, routingPreset: 'quality' }
  const planned = await host.executeConfiguredAssignment(ctx, task, { ...quality, dailyBudgetUsd: 1_000 }, baseOptions(cwd))
  assert.equal(planned.plan.selected.provider, 'strong')
  const estimate = planned.plan.estimatedCost
  assert.ok(estimate > 0)

  const spentNow = (await host.ledgerSummary({})).spent.today
  const downgraded = await host.executeConfiguredAssignment(ctx, task, { ...quality, dailyBudgetUsd: spentNow + estimate * 0.5 }, baseOptions(cwd))
  assert.equal(downgraded.budget.downgraded, true)
  assert.equal(downgraded.plan.selected.provider, 'cheap')
  assert.equal(downgraded.plan.preset, 'economy')
  assert.equal(downgraded.execution.status, 'completed')

  const tiny = { ...quality, dailyBudgetUsd: 0.000001, overBudgetAction: 'pause' }
  const paused = await host.executeConfiguredAssignment(ctx, task, tiny, baseOptions(cwd))
  assert.equal(paused.paused, true)
  assert.equal(paused.execution, null)
  assert.match(paused.budget.message, /confirmOverBudget/)
  const callsBefore = ctx.streamCalls.length
  const confirmed = await host.executeConfiguredAssignment(ctx, task, tiny, { ...baseOptions(cwd), confirmOverBudget: true })
  assert.equal(confirmed.execution.status, 'completed')
  assert.ok(ctx.streamCalls.length > callsBefore)
})

test('pre-execute asks before exceeding the budget and before a direct, unsandboxed CLI launch', async () => {
  const events = []
  const ctx = { ...mockCtx(), tools: { register() {} }, commands: { register() {} }, on: (name, handler) => events.push({ name, handler }) }
  host.apply(ctx, { modelProfilesJson: PROFILES })
  const gate = events.find(item => item.name === 'tools/pre-execute').handler
  const allow = async () => ({ kind: 'allow' })
  assert.equal((await gate({ name: 'model_router_execute', arguments: { task: 'x', confirmOverBudget: true } }, allow)).kind, 'ask')
  assert.equal((await gate({ name: 'model_router_execute', arguments: { task: 'x', provider: 'deepseek', model: 'chat' } }, allow)).kind, 'allow')
  const direct = await gate({ name: 'model_router_execute', arguments: { task: 'x', provider: 'openai', model: 'gpt-5' } }, allow)
  assert.equal(direct.kind, 'ask')
  assert.match(direct.displayReason.zh, /不经过 Harness 进程沙箱/)
  host.apply({ ...ctx, on: (name, handler) => events.push({ name: `${name}#2`, handler }) }, { confirmUnsandboxedCli: false })
  const relaxed = events.find(item => item.name === 'tools/pre-execute#2').handler
  assert.equal((await relaxed({ name: 'model_router_execute', arguments: { task: 'x', provider: 'openai', model: 'gpt-5' } }, allow)).kind, 'allow')
})

test('run records keep the routing reason for each package', () => {
  const plan = createPlanFromRoutes('请分析接口设计。', PRESET_ROUTES)
  const record = buildRunRecord({ id: 'r', createdAt: 1, task: 't', plan, execution: { status: 'failed', packages: [] } })
  assert.equal(record.decision.complexity.band, plan.complexity.band)
  assert.equal(record.packages[0].status, 'pending')
  assert.equal(record.preset, 'balanced')
})

test('the published file list contains every module the Host entry imports', async () => {
  const { readFileSync } = await import('node:fs')
  const { dirname, join: joinPath, relative, resolve } = await import('node:path')
  const root = resolve(import.meta.dirname, '..')
  const files = new Set(JSON.parse(readFileSync(joinPath(root, 'package.json'), 'utf8')).files)
  const seen = new Set()
  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) visit(resolve(dirname(file), match[1]))
  }
  visit(joinPath(root, '.dsh-plugin/index.mjs'))
  const missing = [...seen].map(file => relative(root, file).split('\\').join('/')).filter(file => !files.has(file))
  assert.deepEqual(missing, [])
})
