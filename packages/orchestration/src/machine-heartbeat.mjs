/** Refresh reachability through committed Bot bindings, without holding up a page request. */
export function createMachineHeartbeat({ machines, preferredBotIds = () => [], intervalMs = 30000, timeoutMs = 2500, concurrency = 2 } = {}) {
  let timer, running, closed = false
  const controllers = new Set()
  const refresh = () => {
    if (closed) return Promise.resolve()
    if (running) return running
    running = (async () => {
      const service = machines()
      const order = preferredBotIds()
      const rows = (service?.readModel().items ?? []).filter(row => row.status !== 'revoked').slice(0, 128)
      let cursor = 0
      const worker = async () => {
        while (!closed && cursor < rows.length) {
          const row = rows[cursor++]
          const binding = [...(row.bindings ?? [])].filter(item => !item.revoked && item.tools?.includes('machine_ping') && item.roots?.length)
            .sort((a, b) => (order.includes(a.botId) ? order.indexOf(a.botId) : Infinity) - (order.includes(b.botId) ? order.indexOf(b.botId) : Infinity))[0]
          if (!binding) continue
          const controller = new AbortController(); controllers.add(controller)
          const deadline = setTimeout(() => controller.abort(new Error('MACHINE_HEARTBEAT_TIMEOUT')), timeoutMs)
          try { await service.probe({ machineId: row.id, botId: binding.botId, rootId: binding.roots[0] }, { kind: 'owner', signal: controller.signal }) }
          catch { /* An unsuccessful probe never refreshes lastSeenAt or changes authority. */ }
          finally { clearTimeout(deadline); controllers.delete(controller) }
        }
      }
      await Promise.all(Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, worker))
    })().catch(() => {}).finally(() => { running = null })
    return running
  }
  return Object.freeze({
    refresh,
    start() { if (closed || timer) return; void refresh(); timer = setInterval(() => { void refresh() }, intervalMs); timer.unref?.() },
    async close() { closed = true; clearInterval(timer); for (const controller of controllers) controller.abort(new Error('MACHINE_HEARTBEAT_CLOSED')); await running },
  })
}
