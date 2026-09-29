import test from 'node:test'
import assert from 'node:assert/strict'

import {
  apply,
  consultConfiguredModel,
  createRoutePlan,
  discoverConfiguredRoutes,
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
    'model_router_plan',
    'model_router_routes',
    'model_router_team_execute',
    'model_router_tool_install',
    'model_router_tool_run',
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
