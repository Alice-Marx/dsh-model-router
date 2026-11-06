export const WORKSPACE_VIEWS = Object.freeze([
  { id: 'plan', label: '任务与执行', number: '01' },
  { id: 'models', label: '模型配置', number: '02' },
  { id: 'tools', label: '官方工具', number: '03' },
  { id: 'controls', label: '预算与安全', number: '04' },
  { id: 'history', label: '执行记录', number: '05' },
])

export const validWorkbenchView = value => WORKSPACE_VIEWS.some(view => view.id === value) ? value : 'plan'
const VIEW_KEY = 'dsh-model-router.workbench.view'
export function savedWorkbenchView() {
  try { return validWorkbenchView(globalThis.localStorage?.getItem(VIEW_KEY)) } catch { return 'plan' }
}
export function rememberWorkbenchView(value) {
  try { globalThis.localStorage?.setItem(VIEW_KEY, validWorkbenchView(value)) } catch { /* storage may be disabled */ }
}

// Draft text stays in this window's memory, never in localStorage or a run record.
// Decisions, previews, permissions and execution identities are not restored.
let draft = { task: '', mode: 'single', directKey: '', budget: undefined }
export const workbenchDraft = () => ({ ...draft })
export function rememberWorkbenchDraft(value) {
  draft = { task: value.task, mode: value.mode, directKey: value.directKey, budget: value.budget }
}

export const TASK_TEMPLATES = Object.freeze([
  { id: 'review', label: '项目检查', mode: 'team', task: '目标：只读检查当前工作区的项目，找出影响使用的问题。\n1. 梳理主要模块、入口和运行方式。\n2. 检查关键流程，按影响排序列出问题及代码位置。\n3. 给出修复建议和验证步骤。\n要求：保留现有文件；区分已验证的问题与待验证的判断；不要把建议当作已完成的修改。' },
  { id: 'explain', label: '整理说明', mode: 'single', task: '目标：根据当前工作区已有资料，整理一份清晰的使用说明。\n交付：用途、准备条件、操作步骤、常见问题。\n要求：说明依据来自哪些文件；缺少依据的内容明确标注；只读分析，不修改文件。' },
  { id: 'compare', label: '方案比较', mode: 'team', task: '目标：比较当前项目可行的改进方案，帮助我选择下一步。\n1. 根据现有资料梳理需求与限制。\n2. 提出可行方案，比较效果、实施成本、依赖和风险。\n3. 给出建议、理由和验收标准。\n要求：只读分析；区分事实与假设；不编造已完成的工作或测试结果。' },
])
