import { buildPlan, detectTaskTypes } from './router.mjs'
import { OFFICIAL_TOOLS, toolForProvider } from './official-tool-registry.mjs'
import { normalizeExecutionPreference } from './model-profiles.mjs'

const clean = value => typeof value === 'string' ? value.trim() : ''

const HEADLESS_TOOL_IDS = new Set(['claude-code', 'codex', 'gemini'])

/**
 * Resolve the intended execution channel for one provider without touching
 * the filesystem: `official-cli` when the provider maps to a registry tool
 * that the caller reports as installed, `harness-llm` otherwise. The probe
 * snapshot comes from the Host caller, which owns the real process boundary.
 */
export function channelForProvider(provider, installedToolIds = [], runnableToolIds = [], route = null, loggedOutToolIds = []) {
  const preference = normalizeExecutionPreference(route?.execution)
  const tool = toolForProvider(provider)
  if (preference === 'api') {
    return {
      kind: 'harness-llm', preference,
      ...(tool ? { tool: tool.id, label: tool.label } : {}),
      detail: '该模型配置为只使用模型目录 API。',
    }
  }
  if (!tool || tool.unsupported) {
    return { kind: 'harness-llm', preference, detail: '通过官方模型目录 API 调用。' }
  }
  const installed = Array.isArray(installedToolIds) && installedToolIds.includes(tool.id)
  if (installed && Array.isArray(loggedOutToolIds) && loggedOutToolIds.includes(tool.id)) {
    return {
      kind: 'harness-llm', preference, tool: tool.id, label: tool.label, loginRequired: true,
      detail: `${tool.label} 已安装但未登录（开箱体检结果）；实际调用直接使用模型目录 API，不等待 CLI 失败。`,
    }
  }
  const runnable = installed && Array.isArray(runnableToolIds) && runnableToolIds.includes(tool.id)
  const headless = installed && HEADLESS_TOOL_IDS.has(tool.id)
  if (runnable || headless) {
    return {
      kind: 'official-cli', preference, tool: tool.id, label: tool.label,
      detail: tool.id === 'zcode'
        ? 'ZCode 已安装，插件可调用其官方编程代理；其 CLI 使用自身配置的默认模型，不能保证与 Harness 建议模型一致。'
        : headless && !runnable
          ? `${tool.label} 已安装。分配到该模型的任务会先走官方无界面命令；命令缺失或失败时回退模型目录 API。`
          : `${tool.label} 已安装，插件可托管调用其官方 CLI；Harness 模型目录与厂商 CLI 名称可能不同，团队无法确认映射时使用 CLI 默认模型，实际模型仍须核对运行记录。`,
    }
  }
  return {
    kind: 'harness-llm',
    preference,
    tool: tool.id,
    label: tool.label,
    detail: installed
      ? `${tool.label} 已安装，但当前平台缺少经核验的托管执行适配器；实际调用使用官方模型目录 API。`
      : `${tool.label} 未安装；实际调用使用官方模型目录 API。可在工作台一键安装，或运行 /tools install ${tool.id}。`,
  }
}

function annotate(channel) {
  return {
    executionChannel: channel.kind,
    ...channel.tool ? { channelTool: channel.tool } : {},
    ...channel.label ? { channelLabel: channel.label } : {},
    ...channel.preference ? { executionPreference: channel.preference } : {},
    ...channel.loginRequired ? { loginRequired: true } : {},
    channelDetail: channel.detail,
  }
}

/**
 * The same deterministic planning projection is used by the Host tool and
 * by the Desktop panel. Model discovery stays on the official side of each
 * runtime and only the public provider/model directory crosses this boundary.
 */
export function createPlanFromRoutes(task, availableRoutes, {
  mode = 'single', budgetUsd = 0, installedToolIds = [], runnableToolIds = [],
  pricing = {}, liveBench = null, cacheReadRatio = 0, cacheWriteRatio = 0,
  directProvider = '', directModel = '', preset = 'balanced', loggedOutToolIds = [],
} = {}) {
  const taskText = clean(task)
  if (!taskText) throw new Error('task must contain text')
  const requestedDirect = mode === 'direct' || clean(directProvider) !== '' || clean(directModel) !== ''
  const selectedMode = mode === 'team' ? 'team' : 'single'
  let routes = Array.isArray(availableRoutes) ? availableRoutes : []
  let directRoute = null
  if (requestedDirect) {
    const provider = clean(directProvider)
    const model = clean(directModel)
    if (!provider || !model) throw new Error('指定单一模型需要同时提供 provider 和 model')
    const match = routes.filter(route => route.provider === provider && route.model === model)
    if (match.length !== 1) throw new Error(`指定模型 ${provider}/${model} 不在当前模型目录中`)
    routes = match
    directRoute = { provider, model }
  }
  const installedIds = Array.isArray(installedToolIds) ? installedToolIds.filter(Boolean) : []
  const channelCache = new Map()
  const channelOf = (provider, model) => {
    const route = routes.find(item => item.provider === provider && item.model === model)
    const key = `${String(provider ?? '')}\0${String(model ?? '')}\0${route?.execution ?? ''}`
    if (!channelCache.has(key)) channelCache.set(key, channelForProvider(provider, installedIds, runnableToolIds, route, loggedOutToolIds))
    return channelCache.get(key)
  }
  const needsImage = detectTaskTypes(taskText).includes('vision')
  const plan = buildPlan({
    text: taskText,
    available: routes,
    mode: directRoute ? 'single' : selectedMode,
    budgetUsd: Math.max(0, Number.isFinite(budgetUsd) ? budgetUsd : 0),
    pricing,
    liveBench,
    cacheReadRatio,
    cacheWriteRatio,
    preset,
  })
  const selectedChannel = plan.selected ? channelOf(plan.selected.provider, plan.selected.model) : null
  return {
    ...plan,
    mode: directRoute ? 'direct' : plan.mode,
    routingBypassed: directRoute !== null,
    directRoute,
    ...(directRoute ? { reason: `已指定 ${directRoute.provider}/${directRoute.model}，不与其他已配置模型比较。复杂度仍按任务文本估计。` } : {}),
    contractVersion: 2,
    availableRoutes: routes,
    ...(selectedChannel ? annotate(selectedChannel) : {}),
    availabilityNotice: '模型目录列出的路线尚未验证当前凭据和网络；实际可用性以官方适配器调用结果为准。',
    pricingNotice: plan.estimatedCost === null
      ? '部分路线尚未配置该供应商的美元输入/输出单价，无法计算可靠的总费用与节省比例；请在模型价格设置中补齐。'
      : '费用按已提供的美元单价和估计 token 数计算，不是供应商账单，也不是硬性支出上限。',
    qualityNotice: plan.optimization.qualityEvidenceComplete
      ? '模型质量使用已提供评分或基准数据估计，仍需实际任务验证。'
      : '部分模型质量缺少可核验评分；目录启发式只供选择参考，质量门槛和节省比例无法保证。',
    modalityNotice: needsImage
      ? plan.unassignableTasks.length > 0
        ? '图像工作包没有可确认支持图像输入的路线，当前计划无法完整分配；请在官方模型目录配置支持图像的模型。'
        : routes.some(route => !Array.isArray(route.inputModalities) || route.inputModalities.length === 0)
          ? '图像工作包只分给已声明图像能力或未声明输入能力的模型；未声明能力的模型仍需实际验证。其他文本工作包可继续使用经济型文本模型。'
          : '图像工作包只分给明确支持图像输入的模型；其他文本工作包可继续使用经济型文本模型。'
      : null,
    toolNotice: '执行渠道按官方工具注册表和已核验适配器标注：official-cli 表示该厂商官方 CLI 已安装且可托管执行；harness-llm 表示通过官方模型目录调用。可在工作台查看安装与执行支持状态。',
    team: {
      requested: selectedMode === 'team',
      recommended: selectedMode === 'team' && plan.complexity.band === 'complex' && plan.subtasks.length > 1,
      handoff: '可在官方会话调用 model_router_team_execute 托管执行当前平台支持的官方 CLI 工作包；官方 Agent Teams 可协作管理任务，但成员模型由宿主配置，不能直接按本计划逐个切换。',
      workPackages: plan.subtasks.map((item, index) => ({
        id: item.id,
        name: item.name,
        ...(item.objective ? { objective: item.objective } : {}),
        type: item.type,
        purpose: item.purpose,
        difficulty: item.difficulty,
        qualitySource: item.qualitySource,
        pricingSource: item.pricingSource,
        dependsOn: item.dependsOn,
        recommendedProvider: item.recommendedProvider,
        recommendedModel: item.recommended,
        estimatedCost: plan.costBreakdown[index]?.estimatedCost ?? null,
        ...item.recommendedReasoningEffort ? { recommendedReasoningEffort: item.recommendedReasoningEffort } : {},
        ...annotate(channelOf(item.recommendedProvider, item.recommended)),
        verificationChecklist: item.purpose === 'synthesis'
          ? ['核对各工作包交付物与依赖', '记录冲突、未解决事项和最终验收结果']
          : item.type === 'code'
            ? ['说明改动文件与接口', '运行与改动相关的验证并记录结果', '列出尚未完成的边界情况']
            : item.type === 'research'
              ? ['列出来源、日期和可核对的结论', '标出推断与不确定事项']
              : ['列出交付内容和验收依据', '标出未完成事项'],
      })),
    },
  }
}

/** Registry summary for tools that a plan or panel may want to display. */
export function officialToolSummaries() {
  return OFFICIAL_TOOLS.map(tool => ({
    id: tool.id,
    label: tool.label,
    vendor: tool.vendor,
    purpose: tool.purpose,
    unsupported: tool.unsupported === true,
  }))
}
