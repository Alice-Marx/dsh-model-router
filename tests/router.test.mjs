import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assessComplexity,
  buildPlan,
  classifyTask,
  collectOpenCodeEndpointRepairs,
  detectTaskTypes,
  isOfficialOpenCodeEndpoint,
  modelMetadata,
  OBJECTIVE_WEIGHTS,
  selectReasoningEffort,
} from '../.dsh-plugin/shared/router.mjs'
import { fetchLiveBenchSnapshot, normalizeLiveBenchPayload, parseCsv } from '../.dsh-plugin/shared/livebench.mjs'
import { createPlanFromRoutes } from '../.dsh-plugin/shared/harness-plan.mjs'

const routes = [
  { provider: 'zen', model: 'DeepSeek V4 Flash' },
  { provider: 'zen', model: 'GPT 5.6 Sol' },
  { provider: 'zen', model: 'Qwen3.7 Plus' },
]

test('classifies simple and specialized tasks', () => {
  assert.equal(classifyTask('请把这句话翻译成英文'), 'general')
  assert.equal(classifyTask('请证明这个数学定理并给出公式'), 'math')
  assert.equal(classifyTask('请实现一个带测试的 REST API'), 'code')
  assert.equal(assessComplexity('请简要解释什么是缓存').band, 'simple')
  assert.equal(assessComplexity('请设计系统架构，拆分模块并编写测试与部署方案').band, 'complex')
  assert.equal(assessComplexity('请证明这个定理').band, 'complex')
  assert.equal(assessComplexity('请总结架构文档').band, 'simple')
})

test('scores configured routes and estimates cost only from supplied USD prices', () => {
  const available = routes.map((route, index) => ({
    ...route,
    quality: [0.82, 0.98, 0.87][index],
    pricing: { input: [0.14, 5, 0.4][index], output: [0.28, 30, 1.6][index], currency: 'USD' },
  }))
  const plan = buildPlan({ text: '请设计系统架构，拆分模块并编写测试与部署方案', available })
  assert.equal(plan.taskType, 'code')
  assert.equal(plan.complexity.band, 'complex')
  assert.equal(plan.candidates.length, 3)
  assert.ok(plan.selected)
  assert.ok(plan.estimatedCost > 0)
  assert.ok(plan.synthesizer)
  assert.equal(plan.subtasks.at(-1).purpose, 'synthesis')
  assert.equal(modelMetadata('GPT 5.6 Sol').id, 'gpt-5.6-sol')
  assert.equal(modelMetadata('gpt'), null, 'partial names cannot borrow another model score')
  assert.ok(plan.optimization.qualityFloor >= 0.78)
  assert.ok(Number.isFinite(plan.optimization.estimatedSavings))
  assert.equal(plan.optimization.pricingComplete, true)
  assert.equal(plan.optimization.qualityEvidenceComplete, true)
})

test('reasoning level is a normalized optimization objective', () => {
  for (const weights of Object.values(OBJECTIVE_WEIGHTS)) {
    assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12)
  }
  assert.equal(selectReasoningEffort(['minimal', 'medium', 'xhigh'], 'high'), 'medium')
  assert.equal(selectReasoningEffort([{ id: 'low' }, { id: 'max' }], 'xhigh'), 'max')
  assert.equal(selectReasoningEffort([], 'high'), undefined)
})

test('plans an exact supported reasoning effort for every collaboration stage', () => {
  const available = routes.map(route => ({
    ...route,
    reasoningKnown: true,
    reasoningEfforts: route.model === 'Qwen3.7 Plus' ? ['low', 'medium'] : ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
  }))
  const plan = buildPlan({
    text: '请设计一个复杂工程架构，拆分模块，编写代码和测试，并给出部署方案与最终验证。',
    available,
  })
  assert.equal(plan.complexity.band, 'complex')
  assert.ok(plan.subtasks.length >= 4)
  for (const task of plan.subtasks) {
    const route = available.find(item => item.provider === task.recommendedProvider && item.model === task.recommended)
    assert.ok(route)
    assert.ok(route.reasoningEfforts.includes(task.recommendedReasoningEffort))
    assert.ok(task.reasoningFit > 0)
  }
  assert.equal(plan.subtasks[0].preferredReasoningEffort, 'medium')
  assert.equal(plan.subtasks.at(-1).preferredReasoningEffort, 'xhigh')
  assert.equal(plan.synthesizer.reasoningEffort, plan.subtasks.at(-1).recommendedReasoningEffort)
  assert.ok(plan.costBreakdown.every(row => row.reasoningOutputMultiplier >= 0.9))
})

test('omits stale reasoning for a route that confirms no selectable efforts', () => {
  const plan = buildPlan({
    text: '请简要解释缓存',
    available: [{ provider: 'plain', model: 'Plain Model', reasoningKnown: true, reasoningEfforts: [] }],
  })
  assert.equal(plan.selected.reasoningEffort, undefined)
  assert.equal(plan.subtasks[0].recommendedReasoningEffort, undefined)
  assert.equal(plan.costBreakdown[0].reasoningEffort, undefined)
})

test('splits a mixed complex request into separate business directions', () => {
  const text = '请研究相关论文，证明核心数学结论，设计并实现代码接口，最后分析截图中的结果并给出完整报告。'
  const types = detectTaskTypes(text)
  assert.ok(types.includes('research'))
  assert.ok(types.includes('math'))
  assert.ok(types.includes('code'))
  assert.ok(types.includes('vision'))
  const plan = buildPlan({ text, available: routes })
  const executionTypes = plan.subtasks.filter(task => task.purpose === 'execution').map(task => task.type)
  assert.ok(executionTypes.includes('research'))
  assert.ok(executionTypes.includes('math'))
  assert.ok(executionTypes.includes('code'))
  assert.ok(executionTypes.includes('vision'))
  assert.ok(plan.taskTypes.length >= 4)
})

test('applies user pricing overrides and task-specific LiveBench scores', () => {
  const liveBench = normalizeLiveBenchPayload({ models: [
    { model: 'GPT 5.6 Sol', overall: 99, code: 98, math: 91 },
    { model: 'Qwen3.7 Plus', overall: 88, code: 84, math: 90 },
  ] }, 1700000000000)
  const plan = buildPlan({
    text: '请实现一个简单的代码格式转换器',
    available: routes,
    pricing: {
      'GPT 5.6 Sol': { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, currency: 'USD' },
      'Qwen3.7 Plus': { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, currency: 'USD' },
    },
    liveBench,
  })
  const gpt = plan.candidates.find(candidate => candidate.model === 'GPT 5.6 Sol')
  assert.equal(gpt.quality, 0.98)
  assert.equal(gpt.inputPrice, 100)
  assert.ok(plan.estimatedCost < 1)
  assert.ok(plan.optimization.liveBench.fetchedAt)

  const routeSpecific = buildPlan({
    text: '请实现一个简单的代码格式转换器',
    available: routes,
    pricing: {
      'GPT 5.6 Sol': { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, currency: 'USD' },
      'zen/GPT 5.6 Sol': { input: 77, output: 88, cacheRead: 0, cacheWrite: 0, currency: 'USD' },
    },
    liveBench,
  })
  assert.equal(routeSpecific.candidates.find(candidate => candidate.model === 'GPT 5.6 Sol').inputPrice, 77)
})

test('budget fallback lowers low-criticality stage cost without violating quality floor', () => {
  const plan = buildPlan({
    text: '请设计一个复杂工程架构，拆分模块，编写代码和测试，并给出部署方案',
    available: routes.map((route, index) => ({
      ...route,
      quality: [0.82, 0.98, 0.87][index],
      pricing: { input: [0.14, 5, 0.4][index], output: [0.28, 30, 1.6][index] },
    })),
    budgetUsd: 0.001,
  })
  assert.equal(plan.optimization.budgetUsd, 0.001)
  assert.ok(plan.estimatedCost > 0)
  assert.ok(plan.subtasks.every(task => task.qualityFloor >= 0.78 || plan.optimization.constraintRelaxed))
  assert.ok(plan.optimization.budgetExceeded || plan.estimatedCost <= 0.001)
})

test('decomposes a compound task and assigns affordable and strong models by stage difficulty', () => {
  const available = [
    { provider: 'cheap-provider', model: 'Flash Custom', quality: 0.79, qualitySource: 'user', specialties: ['summarization'], pricing: { input: 0.1, output: 0.2 }, pricingSource: 'user' },
    { provider: 'strong-provider', model: 'Reasoning Custom', quality: 0.97, qualitySource: 'user', specialties: ['reasoning', 'code'], pricing: { input: 5, output: 25 }, pricingSource: 'user' },
  ]
  const plan = buildPlan({
    text: '请处理项目。\n- 请提取关键词\n- 请设计复杂系统架构\n- 最后验证架构安全性',
    available,
    mode: 'team',
  })
  const extraction = plan.subtasks.find(task => task.objective === '请提取关键词')
  const design = plan.subtasks.find(task => task.objective === '请设计复杂系统架构')
  const verification = plan.subtasks.find(task => task.objective === '最后验证架构安全性')
  assert.equal(plan.compound, true)
  assert.equal(plan.complexity.band, 'complex')
  assert.equal(extraction.difficulty, 'simple')
  assert.equal(extraction.recommended, 'Flash Custom')
  assert.equal(extraction.qualitySource, 'user')
  assert.equal(extraction.pricingSource, 'user')
  assert.equal(design.difficulty, 'complex')
  assert.equal(design.recommended, 'Reasoning Custom')
  assert.equal(verification.recommended, 'Reasoning Custom')
  assert.ok(verification.dependsOn.includes(design.id))
  assert.ok(plan.estimatedCost < plan.optimization.baselineAllStrongCost)
  assert.ok(plan.optimization.estimatedSavings > 0)
})

test('plain bullet examples are not treated as executable work packages', () => {
  const plan = buildPlan({
    text: '请总结这段清单：\n- 一级缓存\n- 二级缓存',
    available: [{ provider: 'mine', model: 'Summarizer', quality: 0.85, pricing: { input: 0.1, output: 0.2 } }],
  })
  assert.equal(plan.compound, false)
  assert.equal(plan.subtasks.length, 1)
  const quotedRequirements = buildPlan({
    text: '请总结以下需求：\n- 实现登录\n- 验证权限\n- 部署服务',
    available: [{ provider: 'mine', model: 'Summarizer', quality: 0.85, pricing: { input: 0.1, output: 0.2 } }],
  })
  assert.equal(quotedRequirements.compound, false)
  assert.ok(quotedRequirements.subtasks.every(task => !task.objective || !/实现登录|部署服务/.test(task.objective)))
})

test('unknown model metadata does not become a fictional zero-dollar saving or quality score', () => {
  const plan = buildPlan({
    text: '请简要解释缓存',
    available: [{ provider: 'custom', model: 'Private Model' }],
    budgetUsd: 0.001,
  })
  assert.equal(plan.selected.model, 'Private Model')
  assert.equal(plan.selected.estimatedCost, null)
  assert.equal(plan.candidates[0].quality, null)
  assert.equal(plan.candidates[0].inputPrice, null)
  assert.equal(plan.estimatedCost, null)
  assert.equal(plan.optimization.estimatedSavings, null)
  assert.equal(plan.optimization.pricingComplete, false)
  assert.equal(plan.optimization.budgetFeasible, false)
  assert.equal(plan.optimization.constraintRelaxed, true)
})

test('non-USD route price cannot silently satisfy a USD budget', () => {
  const plan = buildPlan({
    text: '请提取关键词',
    available: [{ provider: 'custom', model: 'Custom', quality: 0.9, pricing: { input: 0.01, output: 0.02, currency: 'CNY' } }],
    budgetUsd: 0.001,
  })
  assert.equal(plan.candidates[0].pricingSource, 'unknown')
  assert.equal(plan.estimatedCost, null)
  assert.equal(plan.optimization.budgetFeasible, false)
})

test('desktop plan retains configured route profiles and labels missing prices', () => {
  const provided = createPlanFromRoutes('请提取关键词', [
    { provider: 'mine', model: 'Budget', quality: 0.85, qualitySource: 'user', pricing: { input: 0.1, output: 0.2 }, pricingSource: 'user' },
  ], { mode: 'team' })
  assert.ok(provided.estimatedCost > 0)
  assert.equal(provided.team.workPackages[0].difficulty, 'simple')
  assert.equal(provided.team.workPackages[0].pricingSource, 'user')
  assert.equal(provided.team.workPackages[0].qualitySource, 'user')

  const missing = createPlanFromRoutes('请提取关键词', [{ provider: 'mine', model: 'Budget', quality: 0.85 }])
  assert.equal(missing.estimatedCost, null)
  assert.match(missing.pricingNotice, /无法计算可靠的总费用/)
})

test('only the image work package needs an image-capable model', () => {
  const routes = [
    { provider: 'text', model: 'Economy', quality: 0.8, pricing: { input: 0.1, output: 0.2 }, inputModalities: ['text'] },
    { provider: 'vision', model: 'Visual Pro', quality: 0.95, pricing: { input: 5, output: 25 }, inputModalities: ['text', 'image'] },
  ]
  const plan = createPlanFromRoutes('请处理资料。\n- 请提取关键词\n- 请分析图片中的内容\n- 最后验证输出', routes, { mode: 'team' })
  const extraction = plan.team.workPackages.find(item => item.objective === '请提取关键词')
  const imageWork = plan.team.workPackages.find(item => item.objective === '请分析图片中的内容')
  assert.equal(extraction.recommendedModel, 'Economy')
  assert.equal(imageWork.recommendedModel, 'Visual Pro')
  assert.deepEqual(plan.unassignableTasks, [])
  assert.match(plan.modalityNotice, /其他文本工作包/)

  const unsupported = createPlanFromRoutes('请分析图片中的内容', routes.slice(0, 1))
  assert.equal(unsupported.selected, null)
  assert.ok(unsupported.unassignableTasks.length > 0)
  assert.match(unsupported.modalityNotice, /无法完整分配/)
})

test('recognizes an official OpenCode website override but preserves custom routes', () => {
  assert.equal(isOfficialOpenCodeEndpoint('opencode', 'https://opencode.ai'), true)
  assert.equal(isOfficialOpenCodeEndpoint('opencode', 'https://opencode.ai/zen/v1'), true)
  assert.equal(isOfficialOpenCodeEndpoint('opencode-go', 'https://www.opencode.ai/zen/go'), true)
  assert.equal(isOfficialOpenCodeEndpoint('opencode-zen', 'https://opencode.ai/zen'), true)
  assert.equal(isOfficialOpenCodeEndpoint('opencode-go-zen', 'https://opencode.ai/zen/go/v1'), true)
  assert.equal(isOfficialOpenCodeEndpoint('opencode', 'https://gateway.example/v1'), false)
  assert.equal(isOfficialOpenCodeEndpoint('openai', 'https://opencode.ai'), false)
  assert.equal(isOfficialOpenCodeEndpoint('opencode', 'https://opencode.ai'), true)
})

test('creates a path mutation only for user-owned catalog endpoint overrides', () => {
  assert.deepEqual(
    collectOpenCodeEndpointRepairs({
      providers: {
        opencode: { apiKeyEnv: 'OPENCODE_API_KEY', baseURL: 'https://opencode.ai/zen' },
        'opencode-zen': { baseURL: 'https://www.opencode.ai/zen/v1' },
        'opencode-go': { baseURL: 'https://gateway.example/v1' },
        openai: { baseURL: 'https://opencode.ai' },
      },
    }),
    [
      { op: 'unset', path: ['providers', 'opencode', 'baseURL'] },
      { op: 'unset', path: ['providers', 'opencode-zen', 'baseURL'] },
    ],
  )
  assert.deepEqual(
    collectOpenCodeEndpointRepairs({ providers: { opencode: { models: [{ id: 'catalog-model' }], baseURL: 'https://opencode.ai' } } }),
    [{ op: 'unset', path: ['providers', 'opencode', 'baseURL'] }],
  )
})

test('parses quoted CSV fields and normalizes an official LiveBench snapshot', async () => {
  const csv = 'model,code_generation,math_comp\n"GPT, 5.6",80,90\nDeepSeek V4 Pro,70,95\n'
  const rows = parseCsv(csv)
  assert.equal(rows[0].model, 'GPT, 5.6')
  assert.equal(rows[1].math_comp, '95')

  const responses = new Map([
    ['https://livebench.ai', '<script src="./static/js/main.test.js"></script>'],
    ['https://livebench.ai/static/js/main.test.js', 'const releases=["2025-11-25","2026-06-25"]'],
    ['https://livebench.ai/table_2026_06_25.csv', 'model,code_generation,math_comp\nDeepSeek V4 Pro,70,95\n'],
    ['https://livebench.ai/categories_2026_06_25.json', JSON.stringify({ Coding: ['code_generation'], Mathematics: ['math_comp'] })],
  ])
  const snapshot = await fetchLiveBenchSnapshot({
    endpoint: 'https://livebench.ai',
    fetchImpl: async url => {
      const body = responses.get(String(url))
      if (body === undefined) return { ok: false, status: 404, text: async () => '' }
      return { ok: true, status: 200, headers: { get: () => String(url).includes('.csv') ? 'text/csv' : 'application/json' }, text: async () => body }
    },
  })
  assert.equal(snapshot.source, 'livebench:2026-06-25')
  assert.equal(snapshot.models.deepseekv4pro.scores.code, 0.7)
  assert.equal(snapshot.models.deepseekv4pro.scores.math, 0.95)
})

test('accepts a user JSON or CSV mirror', async () => {
  const jsonSnapshot = await fetchLiveBenchSnapshot({
    endpoint: 'https://mirror.example/livebench.json',
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ models: [{ model: 'Qwen3.7 Plus', overall: 88, code: 84 }] }) }),
  })
  assert.equal(jsonSnapshot.source, 'livebench-json-mirror')
  assert.equal(jsonSnapshot.models.qwen37plus.scores.code, 0.84)

  const csvSnapshot = await fetchLiveBenchSnapshot({
    endpoint: 'https://mirror.example/livebench.csv',
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'text/csv' }, text: async () => 'model,code,math\nQwen3.7 Plus,84,90\n' }),
  })
  assert.equal(csvSnapshot.source, 'livebench-csv-mirror')
  assert.equal(csvSnapshot.models.qwen37plus.scores.math, 0.9)
})

test('includes optional cache read/write tokens in the cost model', () => {
  const base = buildPlan({
    text: '请总结这份短文',
    available: routes,
    pricing: {
      'Qwen3.7 Plus': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, currency: 'USD' },
    },
  })
  const cached = buildPlan({
    text: '请总结这份短文',
    available: routes,
    pricing: {
      'Qwen3.7 Plus': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, currency: 'USD' },
    },
    cacheReadRatio: 0.5,
    cacheWriteRatio: 0.1,
  })
  assert.ok(cached.costBreakdown[0].cacheReadTokens > 0)
  assert.ok(cached.costBreakdown[0].cacheWriteTokens > 0)
  assert.ok(cached.estimatedCost < base.estimatedCost)
})
