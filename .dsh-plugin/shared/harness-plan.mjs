import { buildPlan, detectTaskTypes } from './router.mjs'
import { OFFICIAL_TOOLS, toolForProvider } from './official-tool-registry.mjs'

const clean = value => typeof value === 'string' ? value.trim() : ''

/**
 * Resolve the intended execution channel for one provider without touching
 * the filesystem: `official-cli` when the provider maps to a registry tool
 * that the caller reports as installed, `harness-llm` otherwise. The probe
 * snapshot comes from the Host caller, which owns the real process boundary.
 */
export function channelForProvider(provider, installedToolIds = []) {
  const tool = toolForProvider(provider)
  if (!tool || tool.unsupported) {
    return { kind: 'harness-llm', detail: '通过官方模型目录 API 调用。' }
  }
  const installed = Array.isArray(installedToolIds) && installedToolIds.includes(tool.id)
  return installed
    ? { kind: 'official-cli', tool: tool.id, label: tool.label, detail: `${tool.label} 已安装，可由官方 CLI 直接执行任务。` }
    : {
      kind: 'harness-llm',
      tool: tool.id,
      label: tool.label,
      detail: `${tool.label} 未安装；回退为官方模型目录 API 调用。可在会话中运行 /tools install ${tool.id}，或让 Agent 调用 model_router_tool_install。`,
    }
}

function annotate(channel) {
  return {
    executionChannel: channel.kind,
    ...channel.tool ? { channelTool: channel.tool } : {},
    ...channel.label ? { channelLabel: channel.label } : {},
    channelDetail: channel.detail,
  }
}

/**
 * The same deterministic planning projection is used by the Host tool and
 * by the Desktop panel. Model discovery stays on the official side of each
 * runtime and only the public provider/model directory crosses this boundary.
 */
export function createPlanFromRoutes(task, availableRoutes, { mode = 'single', budgetUsd = 0, installedToolIds = [] } = {}) {
  const taskText = clean(task)
  if (!taskText) throw new Error('task must contain text')
  const selectedMode = mode === 'team' ? 'team' : 'single'
  const routes = Array.isArray(availableRoutes) ? availableRoutes : []
  const installedIds = Array.isArray(installedToolIds) ? installedToolIds.filter(Boolean) : []
  const channelCache = new Map()
  const channelOf = provider => {
    const key = String(provider ?? '')
    if (!channelCache.has(key)) channelCache.set(key, channelForProvider(key, installedIds))
    return channelCache.get(key)
  }
  const needsImage = detectTaskTypes(taskText).includes('vision')
  const eligibleRoutes = needsImage
    ? routes.filter(route => !Array.isArray(route.inputModalities)
      || route.inputModalities.length === 0
      || route.inputModalities.includes('image'))
    : routes
  const plan = buildPlan({
    text: taskText,
    available: eligibleRoutes,
    mode: selectedMode,
    budgetUsd: Math.max(0, Number.isFinite(budgetUsd) ? budgetUsd : 0),
  })
  const selectedChannel = plan.selected ? channelOf(plan.selected.provider) : null
  return {
    ...plan,
    contractVersion: 2,
    availableRoutes: routes,
    ...(selectedChannel ? annotate(selectedChannel) : {}),
    availabilityNotice: '模型目录列出的路线尚未验证当前凭据和网络；实际可用性以官方适配器调用结果为准。',
    pricingNotice: '费用是本地估算，不是供应商账单，也不是硬性支出上限。',
    modalityNotice: needsImage && eligibleRoutes.length < routes.length
      ? '图像任务已排除明确声明不接受图像输入的模型；未声明能力的模型仍需人工验证。'
      : null,
    toolNotice: '执行渠道按官方工具注册表标注：official-cli 表示该厂商官方 CLI 已安装，harness-llm 表示经官方模型目录调用。可用 /tools 或 model_router_tools 查看安装状态。',
    team: {
      requested: selectedMode === 'team',
      recommended: selectedMode === 'team' && plan.complexity.band === 'complex' && plan.subtasks.length > 1,
      handoff: '工作包可交给官方 Agent Teams 的 spawn_teammate、team_task_*、send_message 和 wait_agent 工具执行。',
      workPackages: plan.subtasks.map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        purpose: item.purpose,
        dependsOn: item.dependsOn,
        recommendedProvider: item.recommendedProvider,
        recommendedModel: item.recommended,
        ...item.recommendedReasoningEffort ? { recommendedReasoningEffort: item.recommendedReasoningEffort } : {},
        ...annotate(channelOf(item.recommendedProvider)),
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
