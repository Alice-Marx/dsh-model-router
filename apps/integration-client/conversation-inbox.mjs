const order = ['approve', 'question', 'unread']

/** Summarize the existing conversation state without copying messages or request payloads. */
export function conversationInbox(roster, work, marks, statuses, sessions) {
  if (!roster?.ready) return { known: false, rows: [] }
  const chats = new Map()
  const add = (id, sessionId, name, kind, hidden, botName) => {
    if (typeof sessionId !== 'string' || !sessionId || chats.has(sessionId)) return
    chats.set(sessionId, { id, sessionId, name, kind, hidden, botName, flags: new Set() })
  }

  for (const bot of roster.bots ?? []) {
    const hidden = bot.hidden === true && !roster.mainBotIds?.includes(bot.id)
    add(bot.id, bot.sessionId ?? bot.id, bot.name, 'bot', hidden)
    for (const thread of bot.threads ?? []) {
      if (thread.archivedAt == null) add(thread.sessionId, thread.sessionId, thread.name, 'thread', hidden, bot.name)
    }
  }
  const rooms = new Map()
  for (const room of roster.rooms ?? []) {
    const sessionId = room.sessionId ?? room.id
    add(room.id, sessionId, room.name, 'room', room.hidden === true)
    rooms.set(room.id, sessionId)
  }
  for (const approval of work?.approvals ?? []) {
    // The approval for a hidden group member is answered in the visible group.
    const destination = approval.roomId ? rooms.get(approval.roomId) : approval.sessionId
    chats.get(destination)?.flags.add('approve')
  }
  for (const chat of chats.values()) {
    const { sessionId } = chat
    const status = statuses?.get(sessionId)
    const interaction = status?.pendingInteraction?.kind
    if (interaction === 'approval' || interaction === 'plan-review') chat.flags.add('approve')
    if (interaction === 'question' || Object.hasOwn(roster.questions ?? {}, sessionId)) chat.flags.add('question')
    const active = (sessions?.byId?.[sessionId]?.retainedBy?.mainView ?? 0) > 0
    if (!chat.hidden && !active && (status?.completionUnread === true || (Object.hasOwn(marks ?? {}, chat.id) && marks[chat.id] === true))) chat.flags.add('unread')
  }
  const rows = [...chats.values()].filter(chat => chat.flags.size > 0).map(({ flags, hidden, ...chat }) => ({
    ...chat, stages: order.filter(stage => flags.has(stage)),
  }))
  rows.sort((left, right) => order.indexOf(left.stages[0]) - order.indexOf(right.stages[0]))
  return { known: true, rows }
}
