// -------------------------------------------------------------------------
// Small observable sources for the inject `hooks` compartment.

export function createSource(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next) {
      const resolved = typeof next === 'function' ? next(value) : next
      if (resolved === value) return
      value = resolved
      for (const listener of [...listeners]) listener()
    },
  }
}

export const EMPTY_ROSTER = { revision: -1, mainBotId: null, mainBotIds: [], bots: [], rooms: [], agents: [], exchangeTurns: {}, questions: {}, btwCards: {}, sideChats: {}, learning: {}, secrets: [], capabilities: [], capabilityStatuses: {}, secretRequests: {}, models: [], defaultModel: null, modelsKey: null, prefs: {}, byId: {}, roomsById: {}, agentsById: {}, agentOf: {}, threadsById: {}, ready: false }
// Any Main Bot holds the Main Bot powers; `mainBotId`, the first one, is the sidebar tile.
export const isMainOf = (roster, id) => id !== undefined && (roster.mainBotIds ?? []).includes(id)

// A Bot's chat is a chain of Sessions ("parts"): the Bot id is its first part's id
// and `sessionId` its current one. Every part id finds the Bot; Session state
// (running, unread, turns) is read from the current part, team state from the Bot id.
export function indexRoster(value) {
  const byId = {}
  for (const bot of value.bots) {
    for (const id of [...(bot.parts ?? []), bot.sessionId ?? bot.id, bot.id]) byId[id] = bot
  }
  // A thread is another own chat of its Bot, and it is indexed twice on
  // purpose. `threadsById` holds the thread itself — its own Session, its name,
  // its archive — so opening one opens the thread and never the Bot's default
  // chat. Its Session also resolves to its Bot in `byId`, so every surface that
  // asks "whose chat is this?" (the header, the composer's extra menu, the
  // details drawer, and with it the model, memory, computer, voice and
  // attachment controls) keeps the Bot instead of going blank inside a thread.
  // A thread never takes a Bot's own chat identity: a Session the Bot already
  // owns stays the Bot's.
  const threadsById = {}
  for (const bot of value.bots) for (const thread of bot.threads ?? []) {
    if (thread.sessionId !== undefined) threadsById[thread.sessionId] = { botId: bot.id, ...thread }
    if (thread.threadId !== undefined) threadsById[thread.threadId] = { botId: bot.id, ...thread }
    if (thread.sessionId !== undefined && byId[thread.sessionId] === undefined) byId[thread.sessionId] = bot
  }
  const roomsById = {}
  // A group's own Session is a chain of parts like a Bot's chat: `room.id` is its
  // first part's id and `sessionId` its current one; every part id finds the room.
  for (const room of value.rooms) {
    for (const id of [room.id, room.sessionId, ...(room.ownParts ?? [])]) roomsById[id] = room
  }
  // The DSH Agent is not a Bot: it indexes by its own id and by each Session it owns.
  const agentsById = {}
  const agentOf = {}
  for (const agent of value.agents ?? []) {
    agentsById[agent.id] = agent
    for (const sessionId of agent.sessions ?? []) agentOf[sessionId] = agent.id
  }
  return { ...value, agents: value.agents ?? [], byId, roomsById, agentsById, agentOf, threadsById, ready: true }
}

// Whether a Session is one of this Bot's own chats: its current part, or one of
// its threads' Sessions. A thread is another own chat of the same Bot, so the
// Bot-scoped surfaces (model choice, memory learning, secret requests, turn
// errors) belong to it exactly as they belong to the default chat. Earlier
// parts are deliberately not included: they keep the behaviour they had.
export const isOwnChatOf = (bot, sessionId) => bot !== undefined && bot !== null && typeof sessionId === 'string'
  && ((bot.sessionId ?? bot.id) === sessionId || (bot.threads ?? []).some(thread => thread.sessionId === sessionId))

// Whether a main-view Session id belongs to the team's DSH Agent: the conversation
// group then stays withdrawn while the shell keeps the sidebar. Before the roster
// arrives, the ids cached from the last pull answer.
export function isAgentSession(roster, cache, sessionId) {
  if (sessionId === undefined || sessionId === null || sessionId === '') return false
  if (roster.ready) return roster.agentOf[sessionId] !== undefined
  return cache.has(sessionId)
}

// A request can reuse a call id; question and secret ids belong to separate kinds.
export const heldCardKey = (kind, requestId) => JSON.stringify([kind, requestId])

// Per Session, how many mounted cells draw or hold each card; 0 drops the entry.
export function countCards(state, sessionId, callIds, delta) {
  const own = { ...state[sessionId] }
  for (const callId of callIds) {
    const count = (own[callId] ?? 0) + delta
    if (count > 0) own[callId] = count
    else delete own[callId]
  }
  return { ...state, [sessionId]: own }
}
