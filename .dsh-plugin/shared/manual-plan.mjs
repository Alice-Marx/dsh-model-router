import { estimateAssignedPackage } from './router.mjs'
import { getOfficialTool } from './official-tool-registry.mjs'
import { billingPlan } from './subscription-billing.mjs'
import { parsePackageAssignments, packagePlanKey } from './package-assignments.mjs'

const allocatedFields = [
  'recommendedReasoningEffort', 'preferredReasoningEffort', 'reasoningEffort',
  'plannedReasoningEffort', 'requestedReasoningEffort', 'reasoningFit',
  'reasoningOutputMultiplier', 'reasoningExecutionNotice', 'channelTool',
  'channelLabel', 'channelDetail', 'loginRequired', 'executionPreference',
  'executionChannel', 'estimatedCost', 'quality', 'qualitySource', 'pricingSource',
]

function withoutAllocation(value) {
  const result = { ...value }
  for (const key of allocatedFields) delete result[key]
  if (Array.isArray(result.dependsOn)) result.dependsOn = [...result.dependsOn]
  return result
}

function annotation(target, tool) {
  return target.kind === 'api' ? {
    executionChannel: 'harness-llm',
    channelDetail: '用户指定该模型目录 API；使用适配器默认推理档位。',
    reasoningExecutionNotice: '手动分配使用适配器默认推理档位。',
  } : {
    executionChannel: 'official-cli', channelTool: tool.id, channelLabel: tool.label,
    channelDetail: `${tool.label} 使用厂商工具自身配置的默认模型，不代表模型目录中的特定模型。`,
    reasoningExecutionNotice: '使用厂商官方工具默认模型与默认推理档位。',
  }
}

/** Apply explicit targets to the existing decomposition; never search or substitute targets. */
export function applyManualPackagePlan(plan, {
  task, packageAssignments, packagePlanKey: expectedKey,
} = {}, routes, dataOptions = {}) {
  const assignments = parsePackageAssignments(packageAssignments)
  if (!assignments) throw new TypeError('手动分配需要提供全部工作包目标。')
  const packages = plan?.team?.workPackages
  if (plan?.routingBypassed || plan?.mode === 'direct' || !Array.isArray(packages)
    || !packages.length || packages.length > 32) {
    throw new Error('手动分配需要当前任务的工作包计划，不能用于全局指定模型。')
  }
  const key = packagePlanKey(plan, task)
  if (!key || expectedKey !== key) throw new Error('工作包计划已变化，请重新确认分配。')
  const ids = packages.map(item => item?.id)
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id)) {
    throw new Error('工作包计划包含无效或重复标识。')
  }
  const chosenIds = Object.keys(assignments)
  if (chosenIds.length !== ids.length || chosenIds.some(id => !ids.includes(id))) {
    throw new Error('请为全部工作包分配目标，且不能添加其他工作包。')
  }
  const catalog = Array.isArray(routes) ? routes : []
  const choices = packages.map(item => {
    const target = assignments[item.id]
    if (!target) throw new Error(`工作包 ${item.id} 缺少目标。`)
    if (target.kind === 'tool') {
      const tool = getOfficialTool(target.toolId)
      if (!tool) throw new Error(`未知的官方工具：${target.toolId}`)
      return { target, tool, provider: 'official-tool', model: target.toolId }
    }
    const matches = catalog.filter(route => route.provider === target.provider && route.model === target.model)
    if (matches.length !== 1) throw new Error(`指定模型 ${target.provider}/${target.model} 不在唯一可用目录中。`)
    const route = matches[0]
    const billing = billingPlan(route, catalog)
    if (billing.mode === 'subscription-only' || billing.subscription?.kind === 'plan-key') {
      throw new Error(`模型 ${target.provider}/${target.model} 使用订阅路线，不能作为手动 API 目标。`)
    }
    if (item.type === 'vision' && Array.isArray(route.inputModalities)
      && route.inputModalities.length && !route.inputModalities.some(value => String(value).toLowerCase() === 'image')) {
      throw new Error(`工作包 ${item.id} 需要图像模型，所选模型仅声明其他输入能力。`)
    }
    return { target, route, provider: target.provider, model: target.model }
  })

  const costBreakdown = packages.map((item, index) => {
    const choice = choices[index]
    const estimate = choice.route
      ? estimateAssignedPackage(choice.route, item, task, plan.complexity?.band ?? 'balanced', dataOptions)
      : { estimatedCost: null, quality: null, qualitySource: 'unknown', pricingSource: 'unknown',
        estimateSource: 'official-tool-unknown', handoffPenalty: 0 }
    return { ...withoutAllocation(estimate), stage: index + 1, purpose: item.purpose,
      difficulty: item.difficulty, provider: choice.provider, model: choice.model,
      estimatedCost: Number.isFinite(estimate.estimatedCost) && estimate.estimatedCost >= 0 ? estimate.estimatedCost : null,
      quality: estimate.quality ?? null, qualitySource: estimate.qualitySource ?? 'unknown',
      pricingSource: estimate.pricingSource ?? 'unknown', selectionSource: 'manual',
      manualAssignment: { ...choice.target }, ...annotation(choice.target, choice.tool) }
  })
  const workPackages = packages.map((item, index) => {
    const choice = choices[index], cost = costBreakdown[index]
    return { ...withoutAllocation(item), recommendedProvider: choice.provider,
      recommendedModel: choice.model, estimatedCost: cost.estimatedCost,
      qualitySource: cost.qualitySource, pricingSource: cost.pricingSource,
      manualAssignment: { ...choice.target }, selectionSource: 'manual',
      algorithmRecommendation: { provider: item.recommendedProvider, model: item.recommendedModel,
        channel: item.executionChannel }, ...annotation(choice.target, choice.tool) }
  })
  const originalSubtasks = new Map((plan.subtasks ?? []).map(item => [item.id, item]))
  const subtasks = workPackages.map(item => ({ ...withoutAllocation(originalSubtasks.get(item.id) ?? item),
    id: item.id, name: item.name, ...(item.objective !== undefined ? { objective: item.objective } : {}),
    type: item.type, purpose: item.purpose, dependsOn: [...(item.dependsOn ?? [])],
    recommendedProvider: item.recommendedProvider, recommended: item.recommendedModel,
    estimatedCost: item.estimatedCost, qualitySource: item.qualitySource, pricingSource: item.pricingSource,
    manualAssignment: { ...item.manualAssignment }, selectionSource: 'manual',
    algorithmRecommendation: { ...item.algorithmRecommendation },
    ...annotation(item.manualAssignment, choices[ids.indexOf(item.id)].tool) }))
  // The public total stays unknown when any official-tool or API price is unknown.
  const pricingComplete = costBreakdown.every(item => item.estimatedCost !== null)
  const estimatedCost = pricingComplete ? costBreakdown.reduce((sum, item) => sum + item.estimatedCost, 0) : null
  const budget = Number(plan.optimization?.budgetUsd)
  const budgetUsd = Number.isFinite(budget) && budget > 0 ? budget : 0
  const budgetExceeded = estimatedCost === null ? null : budgetUsd > 0 ? estimatedCost > budgetUsd : false
  const selection = index => ({ provider: choices[index].provider, model: choices[index].model,
    estimatedCost: costBreakdown[index].estimatedCost, qualitySource: costBreakdown[index].qualitySource,
    pricingSource: costBreakdown[index].pricingSource, selectionSource: 'manual',
    ...annotation(choices[index].target, choices[index].tool) })
  const synthesisIndex = packages.findLastIndex(item => item.purpose === 'synthesis')
  const originalOptimization = plan.optimization ?? {}
  const clearedPlan = withoutAllocation(plan)
  return { ...clearedPlan, assignmentMode: 'manual', manualAssignments: assignments, packagePlanKey: key,
    selected: selection(0), synthesizer: plan.synthesizer ? selection(synthesisIndex >= 0 ? synthesisIndex : packages.length - 1) : null,
    subtasks, team: { ...plan.team, workPackages }, costBreakdown, estimatedCost,
    originalAlgorithmEstimate: plan.originalAlgorithmEstimate ?? plan.estimatedCost ?? null,
    unassignableTasks: [], ...annotation(choices[0].target, choices[0].tool),
    reason: '已按用户选择逐包分配模型与官方工具；执行目标不会因算法评分或预算而自动替换。',
    pricingNotice: estimatedCost === null
      ? '手动目标中有费用未知的模型或官方工具，无法确认总费用；工具费用不按原推荐模型计价。'
      : '费用按手动选择的 API、默认推理档位和估计资源重算，不是供应商账单或硬性支出上限。',
    qualityNotice: '手动分配由用户决定目标，尚未验证所选目标的任务质量；算法质量门槛不代表手动方案已经通过验证。',
    toolNotice: '官方工具使用厂商自身配置的默认模型与推理档位，执行前由 Host 核验工具是否可用。',
    optimization: { ...originalOptimization, manualAssignment: true, solver: 'manual-package-assignment',
      search: null, optimalityScope: null, budgetUsd, budgetExceeded,
      budgetFeasible: estimatedCost === null ? null : !budgetExceeded,
      pricingComplete, qualityEvidenceComplete: false, constraintRelaxed: null,
      baselineAllStrongCost: null, estimatedSavings: null, minimumFeasibleCost: null,
      jointEffortCandidates: 0, qualityEvidenceCount: 0,
      resourceEvidenceCount: costBreakdown.filter(item => item.estimateSource === 'recorded-resource-evidence').length,
      distinctRoutes: new Set(choices.map(item => JSON.stringify(item.target))).size,
      handoffCount: null, paretoPruned: 0, candidateTruncated: 0, qualityFiltered: 0,
      qualityConstraintsEnforced: false },
  }
}
