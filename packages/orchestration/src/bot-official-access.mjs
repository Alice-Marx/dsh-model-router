/** Per-call official CLI admission. Identity comes only from the Host policy. */
export const DEFAULT_CLI_MODEL = 'vendor-default'
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }

export function createBotOfficialAccess({ catalog, identityFor, settingsFor, isMainBot, assertTool }) {
  const current = () => {
    const identity = identityFor()
    if (!identity?.subject || !identity.botId) fail('OFFICIAL_CALL_CONTEXT_REQUIRED', '官方工具调用缺少可信的宿主身份。')
    return identity
  }
  const binding = (identity, { admit = true } = {}) => {
    const value = settingsFor(identity.botId)
    if (!value?.settings?.enabled || value.retired || admit && value.status !== 'available') fail('OFFICIAL_BINDING_UNAVAILABLE', '此 Bot 的已保存绑定当前不可用，请重新检查模型与官方工具设置。')
    if (admit) assertTool(identity.subject, 'tool/model_router_tool_run')
    return value
  }
  const same = identity => {
    const latest = current()
    if (identity.subject !== latest.subject || identity.botId !== latest.botId || identity.owner !== latest.owner) fail('OFFICIAL_SUBJECT_CHANGED', '官方工具调用期间宿主身份发生变化。')
  }
  const allowed = (identity, row, request) => {
    const main = !identity.owner && isMainBot(identity.botId)
    const saved = row?.settings.officialTools.find(tool => tool.toolId === request.toolId)
    if (!identity.owner && !main && !saved) fail('OFFICIAL_TOOL_NOT_GRANTED', '此 Bot 尚未获授该官方工具，请先保存授权。')
    const cliModel = request.cliModel || saved?.cliModel || DEFAULT_CLI_MODEL
    if (!identity.owner && !main && (cliModel !== saved.cliModel || request.mode !== saved.mode)) fail('OFFICIAL_TOOL_SCOPE_DENIED', '请求的 CLI 模型或执行模式与此 Bot 的已保存授权不一致。')
    if (!identity.owner && request.executionEnvironment !== 'harness') fail('OFFICIAL_ENVIRONMENT_DENIED', 'Bot 的官方工具必须通过宿主受限执行入口。')
    if (!identity.owner && !main && request.mode === 'workspace-write') {
      const ref = row.settings.workspaceRef
      if (!row.settings.machineGrants.some(grant => grant.machineId === ref?.machineId && grant.rootId === ref?.rootId && grant.mode === 'workspace-write')) fail('OFFICIAL_WORKSPACE_READ_ONLY', '此 Bot 的工作区尚未授予写入权限。')
    }
    return cliModel
  }
  return Object.freeze({
    assertCapability(botId, toolName) {
      if (!['model_router_tools', 'model_router_tool_run'].includes(toolName)) fail('OFFICIAL_TOOL_SCOPE_DENIED', '未知的官方工具能力。')
      const identity = current()
      if (identity.owner || identity.botId !== botId) fail('OFFICIAL_SUBJECT_CHANGED', '官方工具能力与当前 Bot 身份不一致。')
      assertTool(identity.subject, `tool/${toolName}`)
    },
    snapshotFor(botId) {
      const row = settingsFor(botId), main = isMainBot(botId)
      if (!row?.settings?.enabled || row.retired) return []
      return (catalog?.snapshot() ?? []).filter(tool => main || row.settings.officialTools.some(grant => grant.toolId === tool.toolId))
        .map(tool => {
          const grant = row.settings.officialTools.find(grant => grant.toolId === tool.toolId) ?? null
          if (main) return { ...tool, grant }
          if (row.status !== 'available') return { ...tool, grant, modes: [], identities: [],
            ...(tool.status === 'ready' ? { status: 'unavailable', reason: '此 Bot 的已保存绑定当前不可用，请先修复绑定。' } : {}) }
          return { ...tool, grant, modes: tool.modes.filter(mode => mode === grant.mode),
            identities: tool.identities.filter(identity => identity.model === grant.cliModel) }
        })
    },
    async authorize(request = {}) {
      const identity = current()
      // Human workbench execution keeps its established platform/CLI checks,
      // approvals and cli-native support; it cannot borrow a Bot's authority.
      if (identity.owner) {
        assertTool(identity.subject, 'remote/startRun')
        return { cliModel: request.cliModel || DEFAULT_CLI_MODEL }
      }
      if (!catalog) fail('OFFICIAL_CATALOG_UNAVAILABLE', '官方工具检测服务尚未配置，请更新宿主插件。')
      // Reading a saved choice is not admission. A stale catalog may have
      // closed the grant, so refresh must precede the live capability check.
      // Disabled/missing bindings and unselected tools are refused immediately.
      const before = binding(identity, { admit: false })
      const mode = request.mode ?? 'read-only', executionEnvironment = request.executionEnvironment ?? 'harness'
      if (!['read-only', 'workspace-write'].includes(mode)) fail('OFFICIAL_MODE_UNSUPPORTED', '该官方工具执行模式未受支持。')
      const selected = allowed(identity, before, { ...request, mode, executionEnvironment })
      await catalog.refresh({ fresh: true })
      same(identity)
      const after = binding(identity)
      if (before && (before.revision !== after.revision || JSON.stringify(before.settings) !== JSON.stringify(after.settings))) fail('OFFICIAL_BINDING_CHANGED', '官方工具调用期间 Bot 配置已变化，请按最新配置重新发起任务。')
      if (allowed(identity, after, { ...request, mode, executionEnvironment }) !== selected) fail('OFFICIAL_BINDING_CHANGED', '官方工具的默认模型配置已变化。')
      const tool = catalog.snapshot().find(item => item.toolId === request.toolId)
      if (!tool || tool.status !== 'ready' || !tool.modes.includes(mode) || !tool.identities.some(item => item.model === selected)) fail('OFFICIAL_TOOL_NOT_READY', tool?.reason || '所选官方工具、模型或执行模式尚未就绪。')
      return { cliModel: selected }
    },
  })
}
