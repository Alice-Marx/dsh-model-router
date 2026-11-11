export function installDesktopBridge(api, renderPane) {
  const before = globalThis.__dshDesktop
  const rows = async () => (await api.snapshot()).machines?.items?.filter(item => item.status !== 'revoked') ?? []
  const rootId = machine => typeof machine?.roots?.[0] === 'string' ? machine.roots[0] : machine?.roots?.[0]?.id ?? ''
  const target = async machineId => {
    const machine = (await rows()).find(item => item.id === machineId)
    if (!machine) throw new Error('电脑未配对或授权已撤销。')
    return { machineId, rootId: rootId(machine) }
  }
  const bridge = Object.freeze({
    renderPane,
    machines: async botId => (await rows()).filter(item => !botId || item.bindings?.some(binding => binding.botId === botId && !binding.revoked))
      .map(item => ({ machineId: item.id, label: item.name ?? item.id, rootId: rootId(item) })),
    open: async (botId, machineId, options) => api.dispatch('machine.desktop.open', { botId, ...await target(machineId), ...options }),
    renew: (botId, sessionId) => api.dispatch('machine.desktop.renew', { botId, sessionId }),
    close: (botId, sessionId) => api.dispatch('machine.desktop.close', { botId, sessionId }),
    transport: (action,payload,signal) => api.dispatch(action,payload,signal),
    saveRoutine: (botId, routine) => api.dispatch('routine.save', { botId, routine }),
    view: async (botId, machineId) => api.dispatch('machine.desktop.view', { botId, ...await target(machineId) }),
    act: async (botId, machineId, screenshotId, action) => api.dispatch('machine.desktop.act', { botId, ...await target(machineId), screenshotId, action }),
  })
  globalThis.__dshDesktop = bridge
  return () => { if (globalThis.__dshDesktop === bridge) { if (before === undefined) delete globalThis.__dshDesktop; else globalThis.__dshDesktop = before } }
}
