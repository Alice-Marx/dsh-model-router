/** Per-bot brain and official-tool module.
 *
 * The brain is one exact host-catalog route. Official tools are a separate
 * grant, and only a catalog entry the host has already verified can be turned on.
 * Nothing here invents a provider, a CLI identity, or a cloud subscription.
 */

export const EXECUTION_MODE_LABELS = Object.freeze({
  'read-only': '只读',
  'workspace-write': '允许写入工作区',
  'cli-native': '厂商原生',
})

export const routeRef = model => model?.provider && model?.model ? `${model.provider}/${model.model}` : ''

export function engineRail(models, query = '') {
  const needle = String(query ?? '').trim().toLowerCase()
  const groups = new Map()
  for (const model of models ?? []) {
    if (typeof model?.provider !== 'string' || typeof model?.model !== 'string' || !model.provider || !model.model) continue
    const haystack = `${model.provider} ${model.model} ${model.label ?? ''}`.toLowerCase()
    if (needle && !haystack.includes(needle)) continue
    if (!groups.has(model.provider)) groups.set(model.provider, { id: model.provider, label: model.provider, models: [] })
    groups.get(model.provider).models.push(model)
  }
  return [...groups.values()]
}

export function officialToolCards({ tools, model, selected } = {}) {
  const chosen = new Map((selected ?? []).filter(tool => tool?.toolId).map(tool => [tool.toolId, tool]))
  return (tools ?? []).filter(tool => tool?.toolId).map(tool => {
    const modes = Array.isArray(tool.modes) ? tool.modes.filter(mode => mode in EXECUTION_MODE_LABELS) : []
    const mappings = (model?.cliModels ?? []).filter(item => item?.toolId === tool.toolId && item.model)
    const current = chosen.get(tool.toolId) ?? null
    const identityOk = Boolean(current && mappings.some(item => item.model === current.cliModel) && modes.includes(current.mode))
    let status = 'ready'
    let reason = '宿主已核验此工具，可以授予这个 Bot。'
    if (!model) {
      status = 'needs-brain'
      reason = '先选定这个 Bot 的大脑。'
    } else if (!modes.length) {
      status = 'closed'
      reason = '宿主尚未开放此工具的执行模式。'
    } else if (!mappings.length) {
      status = 'unverified'
      reason = '当前大脑尚未核验此工具的 CLI 身份。'
    } else if (current && !identityOk) {
      status = 'stale'
      reason = '已保存的工具身份与当前目录不一致，请重新选择。'
    } else if (current) {
      status = 'on'
      reason = '此 Bot 可以使用这个官方工具。'
    }
    return {
      toolId: tool.toolId,
      label: tool.label || tool.toolId,
      vendor: tool.vendor || '',
      source: tool.source || '',
      modes,
      mappings,
      selected: current,
      status,
      reason,
    }
  })
}

export function defaultToolGrant(card) {
  if (!card || !['ready', 'on', 'stale'].includes(card.status)) return null
  const cliModel = card.mappings[0]?.model
  const mode = card.modes.includes('read-only') ? 'read-only' : card.modes[0]
  if (!cliModel || !mode) return null
  return { toolId: card.toolId, cliModel, mode }
}

export function toggleOfficialTool(selected, card, enabled) {
  const rest = (selected ?? []).filter(tool => tool?.toolId !== card?.toolId)
  if (!enabled) return rest
  const grant = defaultToolGrant(card)
  return grant ? [...rest, grant] : rest
}

export function patchOfficialTool(selected, toolId, patch) {
  return (selected ?? []).map(tool => tool?.toolId === toolId ? { ...tool, ...patch } : tool)
}
