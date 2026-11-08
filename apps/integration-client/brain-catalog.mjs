/**
 * The Bot binding picker, as data. The layout follows OpenMausBot's model picker: a rail of
 * engines on the left, the selected engine's models on the right. Two rail groups:
 *
 * - 官方工具: the registry CLIs with the Host's readiness (installed, version, login). A Bot uses
 *   them as hands, never as its brain: through managed delegation, where the Host verified a CLI
 *   model for the Bot's exact route, or through the model-router capability.
 * - API 模型: the exact Harness routes this Bot may bind, one engine per provider. Picking one is
 *   the Bot's brain.
 *
 * Everything offered here comes from the Host's committed catalog; the picker only rearranges it,
 * and the binding is still validated by the Host when it is saved.
 */

export const ROUTER_CAPABILITY = 'mr-routing'
export const SUGGESTED_LIMIT = 5
export const SEARCH_THRESHOLD = 5

export const routeOf = model => (model?.provider && model?.model ? `${model.provider}/${model.model}` : '')

const IDENTITY = ['#009957', '#377fe6', '#d94b52', '#e78531', '#8d69ce', '#0ea5c6', '#d84f8b', '#d8a729', '#01a492', '#e5634e']

// Monograms rather than vendor logos: the rail must tell similar names apart (MiniMax and MiMo,
// Claude Code and Codex) without shipping anyone's trademark artwork.
const TOOL_MARKS = Object.freeze({
  'claude-code': 'Cl', codex: 'Cx', 'kimi-code': 'Ki', 'minimax-code': 'MM', 'mimo-code': 'Mi', 'grok-build': 'Gk',
  gemini: 'Ge', opencode: 'OC', stepcode: 'St', pi: 'Pi', hermes: 'He', zcode: 'Z', 'dsh-tui': 'DS',
})

const TOOL_LABELS = Object.freeze({
  'claude-code': 'Claude Code', codex: 'Codex CLI', 'kimi-code': 'Kimi Code', 'minimax-code': 'MiniMax Code', 'mimo-code': 'MiMo Code',
  'grok-build': 'Grok Build', gemini: 'Gemini CLI', opencode: 'OpenCode', stepcode: 'Step Code', pi: 'Pi', hermes: 'Hermes Agent',
  zcode: 'ZCode CLI', 'dsh-tui': 'dsh-TUI',
})
export const toolLabel = toolId => TOOL_LABELS[toolId] ?? toolId

/** A stable colour and up to two letters for an engine. */
export function engineMark(label, toolId = '') {
  const text = String(label ?? '').trim()
  const word = text.split(/[\s·/_-]+/u).find(Boolean) ?? '?'
  const chars = [...word]
  const letters = TOOL_MARKS[toolId] ?? (chars[0].toUpperCase() + (chars[1] ?? '').toLowerCase())
  let hash = 0
  for (const char of toolId || text) hash = (hash * 31 + char.codePointAt(0)) >>> 0
  return { letters, color: IDENTITY[hash % IDENTITY.length] }
}

const unique = items => items.filter((item, index) => items.findIndex(other => other.toolId === item.toolId && other.model === item.model) === index)

/** One engine per provider, its models in catalog order. */
export function apiEngines(catalog) {
  const byProvider = new Map()
  for (const model of catalog?.models ?? []) {
    const ref = routeOf(model)
    if (!ref) continue
    if (!byProvider.has(model.provider)) byProvider.set(model.provider, [])
    byProvider.get(model.provider).push({ ref, provider: model.provider, model: model.model, label: model.model,
      cliTools: unique(model.cliModels ?? []).map(item => item.toolId) })
  }
  return [...byProvider.entries()].map(([provider, models]) => ({ id: `api:${provider}`, kind: 'api', provider, label: provider, models }))
}

/**
 * One engine per registry tool. `delegations` are the Host-verified CLI models for this tool,
 * each tied to the exact route it was verified for.
 */
export function officialEngines(engineView, catalog) {
  const offered = new Map((catalog?.tools ?? []).map(tool => [tool.toolId, tool]))
  const providers = new Set((catalog?.models ?? []).map(model => model.provider))
  return (engineView?.items ?? []).map(row => {
    const tool = offered.get(row.id)
    const delegations = tool ? (catalog?.models ?? []).flatMap(model => unique(model.cliModels ?? [])
      .filter(item => item.toolId === row.id)
      .map(item => ({ ref: routeOf(model), cliModel: item.model, modes: [...(tool.modes ?? [])] }))) : []
    return { id: `tool:${row.id}`, kind: 'official', toolId: row.id, label: row.label, vendor: row.vendor, row, delegations,
      relatedProviders: row.providerHints.filter(hint => providers.has(hint)) }
  })
}

/** The status pill: a version when the tool is ready, otherwise what it still needs. */
export function engineStatus(engine) {
  if (engine.kind === 'api') return engine.models.length ? { tone: 'success', text: `${engine.models.length} 个模型` } : { tone: 'muted', text: '无可用模型' }
  const { row } = engine
  if (row.status === 'unchecked') return { tone: 'muted', text: '尚未体检' }
  if (row.status === 'needs-install') return { tone: 'warning', text: '需要安装' }
  if (row.status === 'needs-login') return { tone: 'warning', text: '需要登录' }
  return { tone: 'success', text: row.version ? `v${row.version}` : '已就绪' }
}

/** What stops this engine from being used, or null. */
export function engineSetup(engine) {
  if (engine.kind !== 'official') return null
  const { row } = engine
  if (row.status === 'unchecked') return { title: '尚未体检', detail: '还没有这台电脑上的官方工具体检结果。点右上角刷新运行一次只读体检（不会安装或登录任何工具）。', command: '' }
  if (row.status === 'needs-install') return { title: `${row.label} 尚未安装`, detail: '在高级工作台的官方工具页用插件固定来源安装后，再回到这里刷新。', command: '' }
  if (row.status === 'needs-login') return { title: `${row.label} 尚未登录`, detail: row.login.detail || '在终端完成登录后刷新。插件不会代为登录，也不会读取凭据。', command: row.login.command }
  return null
}

export function filterModels(models, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return models
  return models.filter(model => `${model.label} ${model.provider}`.toLowerCase().includes(needle))
}

/** The first few models, with the selected one always among them. */
export function suggestedModels(models, selectedRef, limit = SUGGESTED_LIMIT) {
  const head = models.slice(0, limit)
  if (!selectedRef || head.some(model => model.ref === selectedRef)) return head
  const selected = models.find(model => model.ref === selectedRef)
  return selected ? [...head.slice(0, limit - 1), selected] : head
}

/** Which rail engine opens first: the brain's provider, else the first API engine. */
export function initialEngine(engines, selectedRef) {
  const provider = selectedRef ? selectedRef.slice(0, selectedRef.indexOf('/')) : ''
  return engines.find(engine => engine.kind === 'api' && engine.provider === provider)?.id
    ?? engines.find(engine => engine.kind === 'api')?.id ?? engines[0]?.id ?? ''
}

const sameTool = (a, b) => a.toolId === b.toolId && a.cliModel === b.cliModel

/** Choose the brain. Delegations verified for another route cannot follow it, so they drop. */
export function pickModel(selection, ref, catalog) {
  const model = (catalog?.models ?? []).find(item => routeOf(item) === ref)
  if (!model) return selection
  const valid = (model.cliModels ?? []).map(item => ({ toolId: item.toolId, cliModel: item.model }))
  return { ...selection, model: ref, officialTools: selection.officialTools.filter(tool => valid.some(item => sameTool(item, tool))) }
}

/**
 * Attach or detach one verified delegation. Attaching a delegation verified for another route
 * also moves the brain to that route, the way OpenMausBot picks an engine and its model together.
 */
export function toggleDelegation(selection, delegation, catalog) {
  const entry = { toolId: delegation.toolId, cliModel: delegation.cliModel, mode: delegation.mode ?? 'read-only' }
  if (selection.officialTools.some(tool => sameTool(tool, entry))) {
    return { ...selection, officialTools: selection.officialTools.filter(tool => !sameTool(tool, entry)) }
  }
  const moved = selection.model === delegation.ref ? selection : pickModel(selection, delegation.ref, catalog)
  if (moved.model !== delegation.ref) return selection
  return { ...moved, officialTools: [...moved.officialTools, entry] }
}

export function routerAccess(selection) { return selection.capabilities.includes(ROUTER_CAPABILITY) }

export function setRouterAccess(selection, enabled) {
  const rest = selection.capabilities.filter(id => id !== ROUTER_CAPABILITY)
  return { ...selection, capabilities: enabled ? [...rest, ROUTER_CAPABILITY] : rest }
}

/** The trigger's summary of the current choice. */
export function brainSummary(selection, catalog) {
  const model = (catalog?.models ?? []).find(item => routeOf(item) === selection.model) ?? null
  const tools = selection.officialTools.length
  return {
    ref: model ? routeOf(model) : '',
    title: model ? model.model : '选择大脑',
    detail: [model ? model.provider : '尚未绑定 API 模型', tools ? `官方工具 ${tools} 个` : '', routerAccess(selection) ? '可调用官方工具' : ''].filter(Boolean).join(' · '),
    mark: engineMark(model?.provider ?? '?'),
  }
}
