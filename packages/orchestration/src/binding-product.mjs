const invalid = () => { throw Object.assign(new Error('请选择当前团队中的 Bot。'), { code: 'INVALID_BINDING_OWNER' }) }

/** A bounded owner view for chat settings; it never reads task inputs or receipts. */
export async function inspectProductBinding({ runtime, lifecycle, botSettings, fundingAccounts, signal }, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'botId') || typeof payload.botId !== 'string') invalid()
  signal?.throwIfAborted()
  await runtime.load()
  signal?.throwIfAborted()
  const bot = lifecycle.committedBot(payload.botId)
  if (!bot) invalid()
  const main = lifecycle.committedMainBotIds?.().includes(bot.id) === true
  const record=botSettings.get(bot.id)
  const grant=main?lifecycle.committedGrant?.(bot.id):null
  return { schemaVersion: 1, bot: { id: bot.id, name: bot.name, role: bot.role ?? '', model: bot.model ?? null,
    main, permissions: main ? 'full-control' : 'scoped',
    appliedModel: typeof bot.appliedModel === 'string' ? bot.appliedModel : null },
    record: grant?{...record,grant}:record, accounts: { status: 'available', items: fundingAccounts?.catalog() ?? [] },
    availableActions: ['binding.save', 'funding.account.save'] }
}
