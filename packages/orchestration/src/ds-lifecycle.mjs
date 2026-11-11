import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PolicyError } from '../../capability-broker/src/authority.mjs'

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const table = value => value && typeof value === 'object' && !Array.isArray(value)
const fail = code => { throw new PolicyError(code) }
// The same ceiling the vendor roster enforces when it records a thread.
export const MAX_THREADS_PER_BOT = 64

function normalizeGrant(grant) {
  if (!table(grant) || !Array.isArray(grant.tools) || !Array.isArray(grant.modelRoutes)) fail('INVALID_GRANT')
  if (grant.tools.some(name => typeof name !== 'string' || !name || name.length > 256)) fail('INVALID_GRANT')
  const routes = grant.modelRoutes.map(route => {
    if (!table(route) || ['provider','model'].some(key => typeof route[key] !== 'string' || !route[key] || route[key].length > 256)) fail('INVALID_GRANT')
    return { provider:route.provider, model:route.model }
  }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return { tools:[...new Set(grant.tools)].sort(), modelRoutes:routes }
}

/** Compile only active own/group Sessions; archived parts never gain authority. */
export function compileDsOwnership(saved, grantFor) {
  if (!table(saved) || saved.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 0 || !table(saved.bots) || !table(saved.rooms)) fail('INVALID_DS_STATE')
  const mainBotIds = saved.mainBotIds ?? []
  if (!Array.isArray(mainBotIds)) fail('INVALID_DS_MAIN_BOT')
  const bots = new Map(), sessions = new Map(),botRecords=new Map()
  const add = (sessionId, botId) => {
    if (!id(sessionId) || sessions.has(sessionId)) fail('AMBIGUOUS_SESSION_OWNER')
    sessions.set(sessionId,botId)
  }
  for (const [botId,bot] of Object.entries(saved.bots)) {
    if (!id(botId) || !table(bot) || bot.id !== botId) fail('INVALID_DS_BOT')
    bots.set(botId,normalizeGrant(grantFor(structuredClone(bot), { main: mainBotIds.includes(botId) })))
    botRecords.set(botId,structuredClone(bot))
    add(bot.sessionId ?? botId,botId)
    // A Bot's threads are further own chats of the same Bot, so a thread Session
    // is authority-bearing exactly like the Bot's own chat is — same grant, same
    // money, same tools. Only committed state can say so: nothing here reads a
    // model argument, a request body or a client-supplied id. `add` already
    // refuses a Session two Bots claim, and `commit` refuses one that moves
    // between Bots, so a restored thread can only ever be its own Bot's again.
    // An archived thread keeps its record and its readable history and gains no
    // authority at all.
    if (bot.threads !== undefined) {
      if (!Array.isArray(bot.threads) || bot.threads.length > MAX_THREADS_PER_BOT) fail('INVALID_DS_BOT_THREADS')
      const seenThreads = new Set(), seenSessions = new Set()
      for (const thread of bot.threads) {
        if (!table(thread) || !id(thread.threadId) || !id(thread.sessionId)) fail('INVALID_DS_BOT_THREAD')
        if (seenThreads.has(thread.threadId) || seenSessions.has(thread.sessionId)) fail('AMBIGUOUS_THREAD_IDENTITY')
        if (thread.archivedAt !== undefined && thread.archivedAt !== null && !Number.isSafeInteger(thread.archivedAt)) fail('INVALID_DS_BOT_THREAD')
        seenThreads.add(thread.threadId)
        seenSessions.add(thread.sessionId)
        if (thread.archivedAt === undefined || thread.archivedAt === null) add(thread.sessionId,botId)
      }
    }
  }
  for (const room of Object.values(saved.rooms)) {
    if (!table(room) || !Array.isArray(room.members) || !table(room.sessions ?? {})) fail('INVALID_DS_ROOM')
    for (const [botId,sessionId] of Object.entries(room.sessions ?? {})) {
      if (!bots.has(botId) || !room.members.includes(botId)) fail('INVALID_GROUP_OWNER')
      add(sessionId,botId)
    }
  }
  if (bots.size > 4096 || sessions.size > 16384) fail('DS_STATE_LIMIT')
  if(mainBotIds.some(botId=>!bots.has(botId)))fail('INVALID_DS_MAIN_BOT')
  return { revision:saved.revision,bots,sessions,botRecords,mainBotIds:[...mainBotIds],sourceStamp:createHash('sha256').update(JSON.stringify(saved)).digest('hex') }
}

const empty = () => ({version:1,revision:0,bots:{},rooms:{}})
async function readCommitted(path) {
  try {
    if ((await stat(path)).size > 32 * 1024 * 1024) fail('DS_STATE_LIMIT')
    const bytes = await readFile(path)
    if (bytes.length > 32 * 1024 * 1024) fail('DS_STATE_LIMIT')
    return JSON.parse(bytes.toString('utf8'))
  } catch(error) { if (error.code === 'ENOENT') return null; throw error }
}

/** Wrap the frozen runtime's exported lifecycle, without patching DS or SDK source. */
export function attachDsLifecycle({ runtime, directory, grantFor, readSaved = () => readCommitted(runtime.statePath), onBind = () => () => {} }) {
  for (const name of ['load','save','refresh','resolveAgent']) if (typeof runtime[name] !== 'function') fail('DS_LIFECYCLE_UNAVAILABLE')
  const originals = Object.fromEntries(['load','save','refresh','resolveAgent'].map(key=>[key,runtime[key]]))
  const records = new Map(), knownAgents = new Map(), bindings = new Map(), history = new Map()
  let ownership = new Map(),committedBots=new Map(),committedMainBotIds=[], healthy = true, closed = false, revision = -1, stamp, hydrated
  const detach = sessionId => {
    const binding = bindings.get(sessionId)
    if (!binding) return
    bindings.delete(sessionId)
    try { binding.unbind() } finally { binding.release() }
  }
  const bindKnown = () => {
    for (const [sessionId,binding] of bindings) {
      if (!healthy || ownership.get(sessionId) !== binding.botId || knownAgents.get(sessionId) !== binding.agent) detach(sessionId)
    }
    if (!healthy || closed) return
    for (const [sessionId,botId] of ownership) {
      const agent = knownAgents.get(sessionId)
      if (!agent || bindings.has(sessionId)) continue
      const unbind = directory.bind(botId,agent)
      try {
        const release = onBind(agent,records.get(botId).grant)
        if (typeof release !== 'function') fail('DS_SCOPE_DISPOSER_REQUIRED')
        bindings.set(sessionId,{botId,agent,unbind,release})
      }
      catch(error) { unbind(); throw error }
    }
  }
  const suspend = () => {
    if (closed) return
    healthy = false
    for (const [botId,record] of records) {
      directory.replaceGrant(botId,{tools:[],modelRoutes:[]})
      record.key = undefined
    }
    bindKnown()
  }
  const commit = compiled => {
    if (closed) fail('DS_LIFECYCLE_CLOSED')
    // A stale concurrent read cannot restore an older grant or resurrect a Bot.
    if (compiled.revision < revision) return
    // DS state revisions fence DS state. Host-owned machine/budget catalogs have
    // their own revisions and may legitimately recompile a grant at the same DS revision.
    const nextStamp = compiled.sourceStamp
    if (compiled.revision === revision && stamp !== nextStamp) fail('DS_REVISION_CONFLICT')
    for (const [sessionId,botId] of compiled.sessions) {
      if (history.has(sessionId) && history.get(sessionId) !== botId) fail('SESSION_OWNER_CHANGED')
    }
    if (history.size + [...compiled.sessions.keys()].filter(key=>!history.has(key)).length > 16384) fail('DS_STATE_LIMIT')
    for (const botId of records.keys()) if (!compiled.bots.has(botId)) {
      for (const [sessionId,binding] of bindings) if (binding.botId === botId) detach(sessionId)
      directory.retire(botId); records.delete(botId)
    }
    for (const [botId,grant] of compiled.bots) {
      const key = JSON.stringify(grant)
      const previous = records.get(botId)
      if (!previous) { directory.register(botId,grant); records.set(botId,{key,grant}) }
      else if (previous.key !== key) {
        directory.replaceGrant(botId,grant)
        previous.key = key; previous.grant = grant
        for (const [sessionId,binding] of bindings) if (binding.botId === botId) detach(sessionId)
      }
    }
    for (const entry of compiled.sessions) history.set(...entry)
    ownership = compiled.sessions
    committedBots=compiled.botRecords
    committedMainBotIds=compiled.mainBotIds
    revision = compiled.revision; stamp = nextStamp; healthy = true
    bindKnown()
  }
  const adopt = saved => { try { commit(compileDsOwnership(saved,grantFor)) } catch(error) { suspend(); throw error } }
  const adoptDisk = saved => {
    if (saved === null) {
      if (revision > 0 || records.size > 0) fail('DS_COMMITTED_STATE_MISSING')
      saved = empty()
    }
    adopt(saved)
  }
  const observeAgent = agent => {
    if (closed) fail('DS_LIFECYCLE_CLOSED')
    const sessionId = agent?.session?.id
    if (!id(sessionId)) fail('INVALID_AGENT')
    if (knownAgents.size >= 16384 && !knownAgents.has(sessionId)) fail('DS_STATE_LIMIT')
    knownAgents.set(sessionId,agent)
    bindKnown()
  }
  const wrapped = {
    async load(...args) {
      try {
        const result = await originals.load.apply(runtime,args)
        hydrated ??= readSaved().then(adoptDisk)
        await hydrated
        return result
      } catch(error) { hydrated = undefined; suspend(); throw error }
    },
    async refresh(...args) {
      try { const result = await originals.refresh.apply(runtime,args); adoptDisk(await readSaved()); return result }
      catch(error) { suspend(); throw error }
    },
    async save(options = {}) {
      let pending
      try {
        // required=true prevents DS's read-only/no-write success path from granting memory-only changes.
        pending = originals.save.call(runtime,{...options,required:true})
        const result = await pending
        // Current DS may queue several saves from one revision. Commit the bytes
        // that actually landed, not a stale pre-call snapshot with that revision.
        adoptDisk(await readSaved())
        return result
      } catch(error) { suspend(); if (pending) await Promise.resolve(pending).catch(()=>{}); throw error }
    },
    async resolveAgent(...args) {
      const agent = await originals.resolveAgent.apply(runtime,args)
      observeAgent(agent)
      return agent
    },
  }
  Object.assign(runtime,wrapped)
  return Object.freeze({
    observeAgent,
    committedBot(botId) { return healthy&&!closed&&committedBots.has(botId)?structuredClone(committedBots.get(botId)):null },
    committedGrant(botId) { return healthy&&!closed&&records.has(botId)?structuredClone(records.get(botId).grant):null },
    committedBots() { return healthy&&!closed?[...committedBots.values()].map(bot=>structuredClone(bot)):[] },
    committedMainBotIds() { return healthy&&!closed?[...committedMainBotIds]:[] },
    async refreshGrants() {
      try { adoptDisk(await readSaved()) }
      catch (cause) { suspend(); throw cause }
    },
    status:()=>({healthy,closed,revision,bots:records.size,activeSessions:ownership.size,boundAgents:bindings.size}),
    close() {
      if (closed) return
      suspend(); closed = true
      for (const name of Object.keys(wrapped)) if (runtime[name] === wrapped[name]) runtime[name] = originals[name]
      knownAgents.clear(); ownership.clear()
    },
  })
}
