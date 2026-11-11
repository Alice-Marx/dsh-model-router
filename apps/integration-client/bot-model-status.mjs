const ref = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value) ? value : null
const entryRef = value => value?.ref ?? (typeof value?.provider === 'string' && typeof value?.model === 'string' ? `${value.provider}/${value.model}` : null)

/** Applied is the Host's last saved selection, not proof of this turn's actual response model. */
export function botModelStatus(bot, catalog = []) {
  const selected = ref(bot?.model), applied = ref(bot?.appliedModel)
  const label = value => {
    const entry = Array.isArray(catalog) ? catalog.find(item => entryRef(item) === value) : undefined
    return typeof entry?.name === 'string' && entry.name ? entry.name : typeof entry?.label === 'string' && entry.label ? entry.label : value
  }
  const selectedLabel = selected ? label(selected) : null, appliedLabel = applied ? label(applied) : null
  const different = Boolean(selected && applied && selected !== applied)
  const setupPending = bot?.setupPending === true
  const title = [setupPending ? '问候正在等待模型、权限与资金绑定保存' : null,
    selected ? `宿主已选：${selected}` : '宿主未指定单独模型',
    applied ? `最近应用：${applied}` : '宿主尚未报告应用记录'].filter(Boolean).join('；')
  return { selected, applied, selectedLabel, appliedLabel, different, title,
    setupPending, label: setupPending ? '完成 Bot 设置' : selectedLabel ?? appliedLabel ?? '选择模型',
    appliedText: applied ? `最近应用：${appliedLabel}${different ? ' · 与宿主已选模型不同' : ''}` : '宿主尚未报告应用记录' }
}
