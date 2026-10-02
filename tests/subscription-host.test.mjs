import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-subscription-'))

// GLM reports the reset as local wall-clock time.
const RESET = new Date(Date.now() + 2 * 3_600_000)
RESET.setSeconds(0, 0)
const pad = value => String(value).padStart(2, '0')
const RESET_TEXT = `${RESET.getFullYear()}-${pad(RESET.getMonth() + 1)}-${pad(RESET.getDate())} ${pad(RESET.getHours())}:${pad(RESET.getMinutes())}:00`
const host = await import('../.dsh-plugin/index.mjs')

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'model-router-subscription-ws-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

function planCtx() {
  const calls = []
  return {
    calls,
    llm: {
      listProviders: () => [{ id: 'glm-coding-plan' }, { id: 'zhipu' }],
      listModels: async () => [{ id: 'glm-4.6' }],
      resolveModelInfo: async (provider, model) => ({ provider, id: model }),
      stream(options) {
        calls.push(options.provider)
        return (async function* () {
          if (options.provider === 'glm-coding-plan') {
            throw new Error(`429 {"error":{"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at ${RESET_TEXT}"}}`)
          }
          yield { type: 'text-delta', index: 0, text: 'API 回答' }
          yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 0 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  }
}

const CONFIG = {
  modelProfilesJson: JSON.stringify([
    { provider: 'glm-coding-plan', model: 'glm-4.6', subscription: 'plan-key', apiRoute: { provider: 'zhipu', model: 'glm-4.6' }, pricing: { input: 1, output: 1 } },
    { provider: 'zhipu', model: 'glm-4.6', pricing: { input: 1, output: 1 } },
  ]),
  subscriptionCooldownMinutes: 30,
}

test('a GLM coding-plan quota hit switches the step to the API route, is recorded, persisted and shown in health', async t => {
  const cwd = await workspace(t)
  const ctx = planCtx()
  const options = { workspace: cwd, skipToolProbe: true, installedToolIds: [], runnableToolIds: [], provider: 'glm-coding-plan', model: 'glm-4.6' }
  const first = await host.executeConfiguredAssignment(ctx, '解释这段代码。', CONFIG, options)
  const pkg = first.run.packages[0]
  assert.equal(pkg.ok, true)
  assert.equal(pkg.provider, 'zhipu')
  assert.equal(pkg.billing, 'api')
  assert.equal(pkg.costUsd, 1, 'the API fallback counts against the budget')
  assert.deepEqual(pkg.subscriptionRoute, { provider: 'glm-coding-plan', model: 'glm-4.6' })
  assert.match(pkg.billingSwitch.reason, /订阅额度已用尽（预计 .* 恢复），已切换 API Key/)
  assert.deepEqual(ctx.calls, ['glm-coding-plan', 'zhipu'])

  const state = JSON.parse(await readFile(join(process.env.DSH_HOME, 'model-router', 'state.json'), 'utf8'))
  assert.equal(state.quota['plan:glm-coding-plan'].until, RESET.getTime())
  assert.equal(state.quota['plan:glm-coding-plan'].resetReported, true)

  // Next step: the exhausted plan is skipped at once.
  ctx.calls.length = 0
  const second = await host.executeConfiguredAssignment(ctx, '再解释一次。', CONFIG, options)
  assert.deepEqual(ctx.calls, ['zhipu'])
  assert.equal(second.run.packages[0].billingSwitch.skippedSubscription, true)

  const health = await host.billingHealth(ctx, CONFIG)
  const row = health.providers.find(item => item.provider === 'glm-coding-plan')
  assert.equal(row.subscription.state, 'exhausted')
  assert.ok(row.subscription.exhaustedUntil > Date.now())
  assert.deepEqual(row.api.route, { provider: 'zhipu', model: 'glm-4.6' })
  assert.equal(health.cooldownMinutes, 30)
  assert.deepEqual(health.quotaPatternErrors, [])
  const broken = await host.billingHealth(ctx, { ...CONFIG, quotaPatternsJson: '{"x":{"quota":["("]}}' })
  assert.equal(broken.quotaPatternErrors.length, 1)

  const apiOnly = await host.executeConfiguredAssignment(ctx, '只用 API。', CONFIG, { ...options, billing: false })
  assert.equal(apiOnly.run.packages[0].billingSwitch, undefined, 'billing: false keeps the plain executor')
})

test('team runs record a CLI quota hit without switching to an API key', async t => {
  const cwd = await workspace(t)
  const plan = { mode: 'team', team: { workPackages: [
    { id: 'a', name: 'A', dependsOn: [], recommendedProvider: 'openai', recommendedModel: 'gpt-x' },
  ] } }
  const run = await host.recordTeamRun({ task: '团队', plan, mode: 'workspace-write', workspace: cwd, routes: [], startedAt: Date.now(), config: {},
    execution: { status: 'incomplete', results: [
      { id: 'a', status: 'failed', provider: 'openai', recommendedModel: 'gpt-x', toolId: 'codex', finalText: '',
        error: 'Codex 执行失败', outputTail: '{"type":"usage_limit_reached","message":"You\'ve hit your usage limit.","resets_in_seconds":3600}' },
    ] } })
  const note = run.packages[0].billingSwitch
  assert.equal(note.to, null)
  assert.match(note.reason, /订阅额度已用尽.*未自动切换 API Key/)
  assert.ok(Math.abs(note.until - (Date.now() + 3_600_000)) < 10_000)
  const health = await host.billingHealth({ llm: { listProviders: () => [{ id: 'openai' }], listModels: async () => [{ id: 'gpt-x' }] } }, {})
  assert.equal(health.providers[0].subscription.state, 'exhausted')
})

function flakyPlanCtx({ planFails = true } = {}) {
  const calls = []
  const state = { planFails }
  return {
    calls, state,
    llm: {
      listProviders: () => [{ id: 'kimi-code' }, { id: 'moonshot' }],
      listModels: async provider => provider === 'kimi-code' ? [{ id: 'kimi-for-coding' }] : [{ id: 'kimi-k2' }],
      resolveModelInfo: async (provider, model) => ({ provider, id: model }),
      stream(options) {
        calls.push(options.provider)
        return (async function* () {
          if (options.provider === 'kimi-code' && state.planFails) throw new Error('upstream connect error: timeout')
          yield { type: 'text-delta', index: 0, text: `${options.provider} 回答` }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  }
}

const KIMI_CONFIG = {
  modelProfilesJson: JSON.stringify([
    { provider: 'kimi-code', model: 'kimi-for-coding', subscription: 'plan-key', apiRoute: { provider: 'moonshot', model: 'kimi-k2' } },
  ]),
}

test('a non-quota subscription failure pauses the run; the user retries on API, retries the subscription, or cancels', async t => {
  const cwd = await workspace(t)
  const ctx = flakyPlanCtx()
  const options = { workspace: cwd, skipToolProbe: true, installedToolIds: [], runnableToolIds: [], provider: 'kimi-code', model: 'kimi-for-coding' }
  const first = await host.executeConfiguredAssignment(ctx, '解释。', KIMI_CONFIG, options)
  assert.deepEqual(ctx.calls, ['kimi-code'], 'no silent API spend')
  assert.equal(first.run.status, 'paused')
  assert.equal(first.run.packages[0].status, 'paused')
  assert.match(first.run.packages[0].pause.detail, /timeout/)
  assert.equal(first.awaitingConfirmation[0].packageId, 'direct')

  ctx.calls.length = 0
  const viaApi = await host.rerunRecordedStep(ctx, KIMI_CONFIG, { runId: first.runId, packageId: 'direct', subscriptionChoice: 'api', workspace: cwd, ...options })
  assert.deepEqual(ctx.calls, ['moonshot'])
  assert.equal(viaApi.run.packages[0].ok, true)
  assert.equal(viaApi.run.packages[0].billing, 'api')
  assert.match(viaApi.run.packages[0].billingSwitch.reason, /按你的确认改用 API Key/)
  await assert.rejects(() => host.rerunRecordedStep(ctx, KIMI_CONFIG, { runId: first.runId, packageId: 'direct', subscriptionChoice: 'cancel', workspace: cwd }), /没有在等待/)

  const second = await host.executeConfiguredAssignment(ctx, '再来。', KIMI_CONFIG, options)
  ctx.state.planFails = false
  ctx.calls.length = 0
  const retried = await host.rerunRecordedStep(ctx, KIMI_CONFIG, { runId: second.runId, packageId: 'direct', subscriptionChoice: 'subscription', workspace: cwd, ...options })
  assert.deepEqual(ctx.calls, ['kimi-code'])
  assert.equal(retried.run.packages[0].billing, 'subscription')

  ctx.state.planFails = true
  const third = await host.executeConfiguredAssignment(ctx, '第三次。', KIMI_CONFIG, options)
  const cancelled = await host.rerunRecordedStep(ctx, KIMI_CONFIG, { runId: third.runId, packageId: 'direct', subscriptionChoice: 'cancel', workspace: cwd })
  assert.equal(cancelled.cancelled, true)
  assert.equal(cancelled.run.packages[0].status, 'cancelled')
  assert.equal(cancelled.run.status, 'cancelled')
  await assert.rejects(() => host.rerunRecordedStep(ctx, KIMI_CONFIG, { runId: third.runId, packageId: 'direct', subscriptionChoice: 'later', workspace: cwd }), /subscriptionChoice/)

  ctx.calls.length = 0
  const auto = await host.executeConfiguredAssignment(ctx, '自动。', { ...KIMI_CONFIG, onSubscriptionFailure: 'api' }, options)
  assert.deepEqual(ctx.calls, ['kimi-code', 'moonshot'])
  assert.equal(auto.run.packages[0].ok, true)
})

test('retrying a paused step on the API key asks for host approval; the RPC codec accepts the choice', async () => {
  const handlers = []
  const ctx = { on: (name, handler) => handlers.push([name, handler]), tools: { register() {} }, commands: { register() {} }, llm: { listProviders: () => [] } }
  try { host.apply(ctx, {}) } catch { /* only the pre-execute hook matters here */ }
  const preExecute = handlers.find(([name]) => name === 'tools/pre-execute')?.[1]
  assert.ok(preExecute)
  const decision = await preExecute({ name: 'model_router_rerun_step', arguments: { runId: 'r', packageId: 'p', subscriptionChoice: 'api' } }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'ask')
  assert.match(decision.displayReason.zh, /改用 API Key 重试/)
  const { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS } = await import('../.dsh-plugin/shared/official-tools-remote.mjs')
  const codec = OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.find(item => item.method === 'rerunStep').parameters[0].codec.create()
  assert.deepEqual(codec.parse({ runId: 'r', packageId: 'p', subscriptionChoice: 'api' }), { runId: 'r', packageId: 'p', confirmOverBudget: false, confirmWrite: false, subscriptionChoice: 'api' })
  assert.deepEqual(codec.parse({ runId: 'r', packageId: 'p', subscriptionChoice: 'rm -rf' }), { runId: 'r', packageId: 'p', confirmOverBudget: false, confirmWrite: false })
})
