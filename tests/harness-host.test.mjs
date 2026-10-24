import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Router state (run ledger, health cache) must not touch the real DSH home.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-host-'))

import {
  apply,
  consultConfiguredModel,
  createRoutePlan,
  discoverConfiguredRoutes,
  executableTeamRoutes,
  executeOfficialTeamPlan,
  planOfficialTeam,
  planToolRun,
  previewWorkbenchRun,
  startWorkbenchRun,
  routePricing,
  resolveTeamCliModelBindings,
} from '../.dsh-plugin/index.mjs'

const signal = new AbortController().signal

function asyncChunks(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function createHarnessContext({ chunks } = {}) {
  const tools = []
  const commands = []
  const events = []
  const streamCalls = []
  const defaultChunks = chunks ?? [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '独立模型的可核验结论。' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '独立模型的可核验结论。' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const modelNames = {
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'gpt-5.6-sol': 'GPT 5.6 Sol',
  }
  const ctx = {
    llm: {
      listProviders() {
        return [
          { id: 'deepseek', name: 'DeepSeek' },
          { id: 'openai', name: 'OpenAI compatible gateway' },
          { id: 'broken', name: 'Unavailable provider' },
        ]
      },
      async listModels(provider) {
        if (provider === 'deepseek') {
          return [{ provider, id: 'deepseek-v4-pro', name: modelNames['deepseek-v4-pro'] }]
        }
        if (provider === 'openai') {
          return [{ provider, id: 'gpt-5.6-sol', name: modelNames['gpt-5.6-sol'] }]
        }
        throw new Error('catalog unavailable')
      },
      async resolveModelInfo(provider, model) {
        return {
          provider,
          id: model,
          name: modelNames[model] ?? model,
          inputModalities: ['text'],
          reasoning: {
            efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
            defaultEffort: 'low',
          },
        }
      },
      stream(options) {
        streamCalls.push(options)
        return asyncChunks(defaultChunks)
      },
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    commands: {
      register(command) {
        commands.push(command)
        return () => {}
      },
    },
    on(name, handler) {
      events.push({ name, handler })
      return () => {}
    },
  }
  return { ctx, tools, commands, events, streamCalls }
}

function routerConfig(overrides = {}) {
  return {
    budgetUsd: 0,
    maxConsultOutputChars: 12_000,
    ...overrides,
  }
}

test('discovers only configured official routes and preserves exact effort ids', async () => {
  const { ctx } = createHarnessContext()
  const routes = await discoverConfiguredRoutes(ctx, signal)

  assert.deepEqual(routes.map(route => [route.provider, route.model]), [
    ['deepseek', 'deepseek-v4-pro'],
    ['openai', 'gpt-5.6-sol'],
  ])
  assert.deepEqual(routes[0].reasoningEfforts, ['low', 'high'])
  assert.equal(routes[0].defaultReasoningEffort, 'low')
  assert.equal(JSON.stringify(routes).includes('apiKey'), false)
})

test('builds a team-ready route plan from configured routes without creating a team', async () => {
  const { ctx } = createHarnessContext()
  const task = '请设计一个复杂的多模型工程方案，拆分模块、实现接口、编写测试并给出部署和验收步骤。'
  const plan = await createRoutePlan(ctx, task, routerConfig(), { mode: 'team', signal })

  assert.equal(plan.complexity.band, 'complex')
  assert.ok(plan.selected)
  assert.ok(['deepseek', 'openai'].includes(plan.selected.provider))
  assert.ok(Array.isArray(plan.subtasks))
  assert.ok(Array.isArray(plan.team.workPackages))
  assert.equal(plan.team.recommended, true)
  assert.ok(plan.team.workPackages.every(item => typeof item.id === 'string' && typeof item.recommendedProvider === 'string'))
  assert.match(plan.team.handoff, /Agent Teams/i)
  assert.equal(JSON.stringify(plan).includes('apiKey'), false)
})

test('consults one configured route through the official stream and bounds captured text', async () => {
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '1234' },
    { type: 'text-delta', index: 0, text: '5678' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const { ctx, streamCalls } = createHarnessContext({ chunks })
  const result = await consultConfiguredModel(
    ctx,
    { provider: 'openai', model: 'gpt-5.6-sol' },
    '请独立审阅这个方案。',
    5,
    signal,
  )

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'openai')
  assert.equal(result.model, 'gpt-5.6-sol')
  assert.equal(result.answer, '12345')
  assert.equal(result.truncated, true)
  assert.equal(streamCalls.length, 1)
  assert.equal(streamCalls[0].provider, 'openai')
  assert.equal(streamCalls[0].model, 'gpt-5.6-sol')
  assert.equal(Array.isArray(streamCalls[0].messages), true)
})

test('registers router tools and manual command without intercepting the main agent request', async () => {
  const { ctx, tools, commands, events, streamCalls } = createHarnessContext()
  apply(ctx, routerConfig())

  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'model_router_consult',
    'model_router_execute',
    'model_router_health',
    'model_router_plan',
    'model_router_rate',
    'model_router_rerun_step',
    'model_router_routes',
    'model_router_team_execute',
    'model_router_tool_install',
    'model_router_tool_repair',
    'model_router_tool_run',
    'model_router_tool_uninstall',
    'model_router_tools',
  ])
  assert.equal(events.some(({ name }) => String(name).startsWith('agent/')), false)
  assert.deepEqual(commands.map(command => command.name), ['router', 'tools'])
  const commandResult = await commands[0].handler({ rawInput: '请审阅实现方案', signal })
  assert.equal(commandResult.kind, 'success', JSON.stringify(commandResult))
  assert.match(commandResult.text, /推荐路线/)

  const byName = new Map(tools.map(tool => [tool.name, tool]))
  const listed = await byName.get('model_router_routes').execute({}, { signal })
  assert.deepEqual(listed.routes.map(route => route.provider), ['deepseek', 'openai'])

  const planned = await byName.get('model_router_plan').execute({
    task: '请实现一个复杂工程，拆分模块并提供测试和部署计划。',
    mode: 'team',
  }, { signal })
  assert.ok(planned.selected)
  assert.ok(Array.isArray(planned.team.workPackages))

  const consulted = await byName.get('model_router_consult').execute({
    task: '请独立复核这个实现方案。',
    provider: 'openai',
    model: 'gpt-5.6-sol',
    outputLimit: 120,
  }, { signal })
  assert.equal(consulted.ok, true)
  assert.equal(streamCalls.at(-1).provider, 'openai')
  assert.equal(streamCalls.at(-1).model, 'gpt-5.6-sol')
})

test('Host route plan uses saved user prices and quality only for configured routes', async () => {
  const { ctx } = createHarnessContext()
  const config = routerConfig({ modelProfilesJson: JSON.stringify([
    { provider: 'deepseek', model: 'deepseek-v4-pro', quality: 72, pricing: { input: 0.2, output: 0.6 } },
    { provider: 'openai', model: 'gpt-5.6-sol', quality: 97, pricing: { input: 5, output: 20 } },
    { provider: 'other', model: 'unconfigured', quality: 100, pricing: { input: 0, output: 0 } },
  ]) })
  const plan = await createRoutePlan(ctx, '请总结这段文字。', config,
    { skipToolProbe: true, signal })
  assert.equal(plan.availableRoutes.length, 2)
  assert.equal(plan.availableRoutes[0].pricingSource, 'user')
  assert.equal(plan.optimization.pricingComplete, true)
  assert.ok(plan.estimatedCost > 0)
  assert.ok(plan.candidates.every(item => item.pricingSource === 'user'))
})

test('manual CLI mapping overrides saved route mapping in package then tool order', () => {
  const plan = { team: { workPackages: [
    { id: 'task-a', recommendedProvider: 'kimi', recommendedModel: 'cheap' },
    { id: 'task-b', recommendedProvider: 'kimi', recommendedModel: 'strong' },
  ] } }
  const routes = [
    { provider: 'kimi', model: 'cheap', cliModel: 'profile-cheap' },
    { provider: 'kimi', model: 'strong', cliModel: 'profile-strong' },
  ]
  const bindings = resolveTeamCliModelBindings(plan, routes, {
    'kimi-code': 'manual-tool', 'task-b': 'manual-package',
  })
  assert.equal(bindings['task-a'], 'manual-tool')
  assert.equal(bindings['task-b'], 'manual-package')
  assert.equal(bindings['kimi-code'], 'manual-tool')
  assert.throws(() => resolveTeamCliModelBindings(plan, routes, []), /JSON 对象/)
})

test('Host tool planning leaves catalog model IDs out of CLI arguments and retains saved bindings for reruns', async () => {
  const { ctx } = createHarnessContext()
  const args = { tool: 'codex', provider: 'openai', model: 'gpt-5.6-sol', task: 'Read the fixture' }
  const defaults = await planToolRun(ctx, routerConfig(), args, { signal })
  assert.equal(defaults.model, 'gpt-5.6-sol')
  assert.equal(defaults.modelId, null)
  assert.equal(defaults.cliModel, null)
  const config = routerConfig({ modelProfilesJson: JSON.stringify([
    { provider: 'openai', model: 'gpt-5.6-sol', cliModel: 'saved-cli-alias' },
  ]) })
  const saved = await planToolRun(ctx, config, args, { signal })
  assert.equal(saved.modelId, 'saved-cli-alias')
  assert.equal(saved.cliModel, 'saved-cli-alias', 'reruns retain the effective mapping')
  const manual = await planToolRun(ctx, config, { ...args, cliModel: 'manual-cli-alias' }, { signal })
  assert.equal(manual.modelId, 'manual-cli-alias')
  assert.equal(manual.cliModel, 'manual-cli-alias')
  const plan = { team: { workPackages: [{ id: 'step', recommendedProvider: 'openai', recommendedModel: 'gpt-5.6-sol' }] } }
  assert.deepEqual(resolveTeamCliModelBindings(plan, [{ provider: 'openai', model: 'gpt-5.6-sol' }]), {})
})

test('Host team planning filters readiness for the requested execution mode', () => {
  const routes = [{ provider: 'openai', model: 'catalog-codex' }, { provider: 'anthropic', model: 'catalog-claude' }]
  const installed = ['codex', 'claude-code']
  const capabilities = installed.map(id => ({ id, modes: ['read-only', 'workspace-write'] }))
  const readiness = [
    { id: 'codex', ready: true, modes: ['read-only', 'workspace-write'], readyModes: ['read-only'] },
    { id: 'claude-code', ready: true, modes: ['read-only', 'workspace-write'], readyModes: ['workspace-write'] },
  ]
  assert.deepEqual(executableTeamRoutes(routes, installed, readiness, 'read-only', capabilities), [routes[0]])
  assert.deepEqual(executableTeamRoutes(routes, installed, readiness, 'workspace-write', capabilities), [routes[1]])
  assert.deepEqual(executableTeamRoutes(routes, ['codex'], readiness, 'workspace-write', capabilities), [])
  assert.deepEqual(executableTeamRoutes(routes, installed, [{ id: 'codex', ready: true, readyModes: [] }], 'read-only', capabilities), [])
  assert.deepEqual(executableTeamRoutes(routes, installed, [{ id: 'codex', ready: true, modes: ['read-only'] }], 'read-only', capabilities), [routes[0]], 'legacy readiness modes remain supported')
})

test('official team helpers share mode planning, CLI bindings and execution recording without an API fallback', async t => {
  const { ctx, streamCalls } = createHarnessContext()
  ctx.sandbox = { confine() { throw new Error('the injected team runner does not spawn') } }
  const config = routerConfig({ modelProfilesJson: JSON.stringify([
    { provider: 'openai', model: 'gpt-5.6-sol', cliModel: 'cli-alias', execution: 'api', quality: 90, pricing: { input: 1, output: 2 } },
  ]) })
  const options = { workspace: process.cwd(), installedToolIds: ['codex'],
    readiness: [{ id: 'codex', ready: true, readyModes: ['read-only'] }],
    executionCapabilities: [{ id: 'codex', modes: ['read-only', 'workspace-write'] }] }
  const task = '请设计复杂工程方案，拆分模块并给出测试和部署验证步骤。'
  const blocked = await planOfficialTeam(ctx, config, { task, mode: 'workspace-write' }, options)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.plan, null)
  assert.deepEqual(blocked.routes, [])
  assert.match(blocked.reason, /workspace-write/)
  const planned = await planOfficialTeam(ctx, config, { task, mode: 'read-only' }, options)
  assert.equal(planned.status, 'planned')
  assert.ok(planned.plan.team.workPackages.length > 1)
  assert.ok(planned.plan.team.workPackages.every(pkg => pkg.recommendedProvider === 'openai'))
  assert.equal(planned.plan.executionChannel, 'official-cli')
  assert.ok(planned.plan.team.workPackages.every(pkg => pkg.executionChannel === 'official-cli'
    && pkg.recommendedReasoningEffort === undefined))
  assert.ok(Object.values(planned.cliModels).every(value => value === 'cli-alias'))
  const calls = []
  const result = await executeOfficialTeamPlan(ctx, config, planned, { root: process.cwd(), runTeam: async request => {
    calls.push(request)
    return { status: 'cli-completed', results: request.plan.team.workPackages.map(pkg => ({ id: pkg.id,
      status: 'succeeded', provider: pkg.recommendedProvider, recommendedModel: pkg.recommendedModel,
      toolId: 'codex', requestedCliModel: request.cliModels[pkg.id], actualModel: null, finalText: 'fixture result' })) }
  } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].mode, 'read-only')
  assert.equal(calls[0].sandbox, ctx.sandbox)
  assert.equal(calls[0].allowedRoot, process.cwd())
  assert.equal(result.status, 'cli-completed')
  assert.ok(result.runId)
  assert.equal(result.run.kind, 'team')
  assert.ok(result.run.packages.every(pkg => pkg.channel === 'official-cli'))
  assert.equal(streamCalls.length, 0)
  const { healthCache } = await import('../.dsh-plugin/shared/tool-health.mjs')
  const previousHealth = healthCache.report()
  healthCache.remember({ checkedAt: Date.now(), tools: [{ id: 'codex', installed: true, login: { state: 'logged-in', billing: 'api-key', accountLogin: false } }] })
  t.after(() => healthCache.remember(previousHealth ?? { checkedAt: 0, tools: [] }))
  const budgetConfig = { ...config, dailyBudgetUsd: 0.000001 }
  const paused = await executeOfficialTeamPlan(ctx, budgetConfig, planned, {
    runTeam() { throw new Error('over-budget teams must not start') },
  })
  assert.equal(paused.status, 'paused-budget')
  const noSandbox = await planOfficialTeam({ ...ctx, sandbox: null }, config, { task }, options)
  assert.equal(noSandbox.status, 'blocked')
  assert.match(noSandbox.reason, /沙箱/)
})

test('official workbench teams recheck permissions, execute the confirmed CLI plan and never use the routed fallback', async () => {
  const { ctx, streamCalls } = createHarnessContext()
  ctx.sandbox = { confine() { throw new Error('inert test') } }
  ctx.llm.listProviders = () => [{ id: 'anthropic', name: 'Claude' }]
  ctx.llm.listModels = async () => [{ id: 'catalog-claude' }]
  const config = routerConfig({ modelProfilesJson: JSON.stringify([
    { provider: 'anthropic', model: 'catalog-claude', quality: 95, pricing: { input: 1, output: 2 } },
  ]) })
  const request = { executor: 'official-team', executionMode: 'workspace-write', planMode: 'team',
    task: '1. 分析需求；2. 实现模块；3. 验证结果并汇总。', workspace: process.cwd() }
  let executed = 0
  const options = { preflightWorkspace: async () => process.cwd(),
    planOptions: { installedToolIds: ['claude-code'],
      readiness: [{ id: 'claude-code', ready: true, readyModes: ['read-only', 'workspace-write'] }],
      executionCapabilities: [{ id: 'claude-code', modes: ['read-only', 'workspace-write'] }] },
    execute() { throw new Error('official teams must never use routed API fallback') },
    executeOfficialTeam: async (_ctx, _config, planned, args) => {
      executed += 1
      assert.equal(planned.mode, 'workspace-write')
      assert.equal(args.root, request.workspace)
      assert.ok(planned.plan.team.workPackages.length > 1)
      return { status: 'cli-completed', runId: 'official-cli-team', budget: planned.budget }
    } }
  const preview = await previewWorkbenchRun(ctx, config, request, options)
  assert.equal(preview.readOnly, false)
  assert.ok(preview.decision.packages.every(item => item.channel === 'official-cli'))
  assert.deepEqual(preview.reasons.map(item => item.code), ['workspace-write'])
  const refused = await startWorkbenchRun(ctx, config, request, options)
  assert.equal(refused.status, 'needs-confirmation')
  assert.equal(executed, 0)
  const result = await startWorkbenchRun(ctx, config, { ...request, confirmedReasons: ['workspace-write'] }, options)
  assert.equal(result.status, 'cli-completed')
  assert.equal(result.runId, 'official-cli-team')
  assert.equal(executed, 1)
  assert.equal(streamCalls.length, 0)
  const blocked = await startWorkbenchRun(ctx, config, { ...request, confirmedReasons: ['workspace-write'] }, {
    ...options, preflightWorkspace: async () => { throw new Error('原工作区有未提交改动') },
  })
  assert.equal(blocked.status, 'blocked')
  assert.match(blocked.reason, /未提交/)
  assert.equal(executed, 1, 'invalid workspaces are blocked before starting any CLI')
})

test('CLI price matching refuses conflicting catalog aliases and unknown actual models', () => {
  const routes = [
    { provider: 'anthropic', model: 'catalog-a', cliModel: 'same-alias', pricing: { input: 1, output: 2 } },
    { provider: 'anthropic', model: 'catalog-b', cliModel: 'same-alias', pricing: { input: 3, output: 4 } },
  ]
  const result = { provider: 'anthropic', model: 'catalog-a', actualModel: 'same-alias', channel: 'official-cli' }
  assert.equal(routePricing(routes, result), null)
  assert.equal(routePricing(routes, { ...result, actualModel: null }), null)
  assert.equal(routePricing(routes.slice(0, 1), result).input, 1)
  assert.equal(routePricing(routes, { ...result, channel: 'harness-llm' }).input, 1)
})
