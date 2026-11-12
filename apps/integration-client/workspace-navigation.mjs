export const WORKSPACE_SECTIONS = Object.freeze([
  { section: 'home', title: '工作空间', label: '总览', icon: 'home', group: '工作', description: '从一个目标开始，和你的 Bot 团队一起把事情做好。' },
  { section: 'inbox', title: '需要你处理', label: '任务待办', icon: 'inbox', group: '工作', description: '集中查看需要确认、补充条件或核对结果的任务。' },
  { section: 'notifications', title: '通知中心', label: '通知', icon: 'bell', group: '工作', description: '查看 Bot 的任务进展，回到对应的执行记录。' },
  { section: 'threads', title: '会话线程', label: '线程', icon: 'list', group: '工作', description: '在同一个 Bot 下建立多条独立会话，命名、切换与归档互不串上下文。' },
  { section: 'tasks', title: '团队任务', label: '任务', icon: 'tasks', group: '工作', description: '从目标到结果，用列表或看板跟进每一项工作。' },
  { section: 'bindings', title: '我的团队', label: '团队', icon: 'team', group: '资源', description: '认识每位伙伴的职责，配置模型、工具和工作空间。' },
  { section: 'machines', title: '电脑', label: '远程电脑', icon: 'computer', group: '资源', description: '连接你的电脑，查看工作现场，或随时接过控制权。' },
  { section: 'library', title: '资料库', label: '资料库', icon: 'folder', group: '资源', description: '把文件和知识交给合适的 Bot，让协作有据可循。' },
  { section: 'data', title: '数据', label: '数据与图表', icon: 'chart', group: '资源', description: '把资料变成可查询的数据，制作图表并导出结果。' },
  { section: 'routine', title: '例行工作', label: '例行任务', icon: 'repeat', group: '资源', description: '演示、保存、再次运行，让重复的工作少一点。' },
  { section: 'usage', title: '费用与用量', label: '费用与用量', icon: 'chart', group: '管理', description: '用真实收据了解团队使用情况和每笔费用。' },
  { section: 'ai', title: 'AI', label: 'AI 提供方', icon: 'spark', group: '管理', description: '独立管理 AI 连接、账号与模型，再为 Bot 选择合适的提供方。' },
  { section: 'webPanel', title: '常用网页', label: '网页面板', icon: 'board', group: '工作', description: '把常用的本地仪表盘或看板固定在这里，一键打开；列表保存在宿主，重启后仍在。' },
])

export const PRODUCT_PANELS = Object.freeze(Object.fromEntries(WORKSPACE_SECTIONS.map(({ section }) => [section, `bot-product-${section}`])))
export const ADVANCED_PANEL = 'model-router-galgame'
const scopes = new WeakMap()
const fallbackScope = {}
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined

/** UI focus belongs to one Host API. These addresses confer no execution authority. */
export function workspaceNavigation(scope) {
  const key = scope && ['object', 'function'].includes(typeof scope) ? scope : fallbackScope
  if (scopes.has(key)) return scopes.get(key)
  const listeners = new Set()
  let snapshot = null, version = 0, claimedDraft = 0, goalDraft = ''
  const navigation = Object.freeze({
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => snapshot,
    getGoalDraft: () => goalDraft,
    saveGoalDraft(text) { goalDraft = typeof text === 'string' ? text.slice(0, 20_000) : '' },
    navigate(destination) {
      if (!Object.hasOwn(PRODUCT_PANELS, destination?.section)) throw new TypeError('Unknown workspace section')
      snapshot = Object.freeze({
        version: ++version, section: destination.section,
        botId: identity(destination.botId), taskId: identity(destination.taskId), machineId: identity(destination.machineId),
        panelId: identity(destination.panelId),
        attemptId: identity(destination.attemptId),
        filter: ['all', 'active', 'attention', 'finished'].includes(destination.filter) ? destination.filter : undefined,
        compose: destination.compose === true,
        search: destination.search === true,
        draft: typeof destination.draft === 'string' ? destination.draft.slice(0, 20_000) : undefined,
      })
      for (const listener of listeners) listener()
      return snapshot
    },
    claimDraft(requestVersion) {
      if (!snapshot || snapshot.version !== requestVersion || claimedDraft === requestVersion || typeof snapshot.draft !== 'string') return null
      claimedDraft = requestVersion
      return snapshot.draft
    },
  })
  scopes.set(key, navigation)
  return navigation
}
