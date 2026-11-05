/** Pairing verifies the Agent; it does not itself create a usable Bot binding. */
export async function pairMainMachine({ machines, mainBotId }, input, context) {
  const paired = await machines.pair(input, context)
  const id = paired.machineId ?? paired.id ?? input.machineId
  const mainId = mainBotId()
  if (!mainId) return { ...paired, mainBinding: { status: 'blocked', code: 'MAIN_BOT_REQUIRED' } }
  try {
    const record = machines.readModel().items.find(item => item.id === id)
    if (!record) throw Object.assign(new Error('MACHINE_NOT_PAIRED'), { code: 'MACHINE_NOT_PAIRED' })
    const previous = record.bindings.find(item => item.botId === mainId)
    const result = await machines.bind({ machineId: id, botId: mainId, roots: record.roots, tools: record.tools,
      mode: 'workspace-write', expectedRevision: previous?.revision ?? 0 }, context)
    if (result.remoteRevoked !== true) throw Object.assign(new Error('REMOTE_REVOCATION_UNCONFIRMED'), { code: 'REMOTE_REVOCATION_UNCONFIRMED' })
    // The Agent's fixed Bot-ID ceiling must also allow Main; Host convenience never widens it.
    await machines.probe({ machineId: id, botId: mainId, rootId: record.roots[0] }, context)
    return { ...machines.readModel().items.find(item => item.id === id), mainBinding: { botId: mainId, status: 'available' } }
  } catch (error) {
    return { ...paired, mainBinding: { botId: mainId, status: 'blocked', code: error.code ?? 'MAIN_MACHINE_BINDING_FAILED' } }
  }
}
