import { PolicyError } from '../../capability-broker/src/authority.mjs'

/** Only trusted host lifecycle code may register Bots or bind live Agent objects. */
export function createPrincipalDirectory(authority) {
  const bots = new Map()
  const agents = new WeakMap()
  const sessions = new Map()
  const record = botId => {
    const value = bots.get(botId)
    if (!value || value.retired) throw new PolicyError('UNKNOWN_BOT')
    return value
  }
  const subject = binding => {
    if (!binding || binding.record.retired) throw new PolicyError('UNKNOWN_SUBJECT')
    return binding.record.subject
  }
  return Object.freeze({
    register(botId, grant) {
      if (bots.has(botId)) throw new PolicyError('DUPLICATE_SUBJECT')
      const principal = Object.freeze({})
      authority.register(principal, { ...grant, botId })
      bots.set(botId, { subject: principal, retired: false, bindings: new Set() })
    },
    bind(botId, agent) {
      const owner = record(botId)
      // The host supplies a resolved Agent; a matching string id never resolves one.
      const sessionId = agent?.session?.id
      if (!agent || typeof agent !== 'object' || typeof sessionId !== 'string' || !sessionId) throw new PolicyError('INVALID_AGENT')
      if (agents.has(agent) || sessions.has(sessionId)) throw new PolicyError('SESSION_ALREADY_BOUND')
      const binding = { record: owner, agent, sessionId }
      agents.set(agent, binding)
      sessions.set(sessionId, binding)
      owner.bindings.add(binding)
      let detached = false
      return () => {
        if (detached) return
        detached = true
        agents.delete(agent)
        owner.bindings.delete(binding)
        if (sessions.get(sessionId) === binding) sessions.delete(sessionId)
      }
    },
    forAgent(agent) { return subject(agent && typeof agent === 'object' ? agents.get(agent) : undefined) },
    forBot(botId) { return record(botId).subject },
    // This lookup is for trusted LlmRuntime auxiliary-call metadata, never JSON RPC arguments.
    forSession(sessionId) { return subject(sessions.get(sessionId)) },
    replaceGrant(botId, grant) { authority.replaceGrant(record(botId).subject, grant) },
    retire(botId) {
      const value = record(botId)
      authority.revoke(value.subject)
      value.retired = true
      for (const binding of value.bindings) { agents.delete(binding.agent); sessions.delete(binding.sessionId) }
      value.bindings.clear()
    },
  })
}
