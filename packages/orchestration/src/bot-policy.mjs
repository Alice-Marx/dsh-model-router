import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { PolicyError } from '../../capability-broker/src/authority.mjs'

/** One policy for model-originated tools and authenticated human RPC. */
export function createBotPolicy({ authority, directory, machineId, workspaceId, ownerGrant = { tools: [] }, ttlMs = 120_000 }) {
  const owner = Object.freeze({})
  authority.register(owner, { ...ownerGrant, botId: 'host-owner' })
  const current = new AsyncLocalStorage()
  const actor = call => {
    if (call.kind === 'remote') {
      if (call.invocation?.peer?.principal?.kind !== 'owner') throw new PolicyError('REMOTE_OWNER_REQUIRED')
      return { subject: owner, owner: true }
    }
    return { subject: directory.forAgent(call.agent), owner: false }
  }
  const capability = call => `${call.kind}/${call.name}`
  const check = call => {
    const who = actor(call)
    authority.assertTool(who.subject, capability(call))
    return who
  }
  const activeSubject = () => {
    const active = current.getStore()
    if (!active) throw new PolicyError('CALL_CONTEXT_REQUIRED')
    return active.subject
  }
  return Object.freeze({
    check,
    replaceOwnerGrant(grant) { authority.replaceGrant(owner,grant) },
    activeIdentity() {
      const frame=current.getStore()
      return frame?{subject:frame.subject,botId:authority.describe(frame.subject).botId,owner:frame.owner}:null
    },
    bindFinancialRun(binding) {
      const frame=current.getStore()
      if(!frame||frame.owner||frame.financial?.active())throw new PolicyError('FINANCIAL_CALL_CONTEXT_REQUIRED')
      frame.financial=Object.freeze({...binding})
    },
    financialRunActive() { return Boolean(current.getStore()?.financial?.active()) },
    financialRun() {
      const frame=current.getStore(),binding=frame?.financial
      if(!binding||!binding.active())return null
      frame.signal?.throwIfAborted()
      const packageId=binding.packageId()
      if(!packageId)throw new PolicyError('FINANCIAL_PACKAGE_NOT_STARTED')
      return {...binding,packageId,botId:authority.describe(frame.subject).botId}
    },
    modelIdentity(options) {
      const active=current.getStore(),subject=active?.subject??directory.forSession(options.sessionId)
      if(active&&options.sessionId&&directory.forSession(options.sessionId)!==subject)throw new PolicyError('SUBJECT_MISMATCH')
      authority.assertModel(subject,options.provider,options.model)
      return {subject,botId:authority.describe(subject).botId,sessionId:options.sessionId??null}
    },
    executionContext(subject, signal, operation) {
      authority.assertTool(subject, 'task/execute')
      return current.run({ subject, owner: false, signal }, operation)
    },
    async run(call, operation) {
      const who = check(call)
      const binding = { taskId: `legacy-${randomUUID()}`, attemptId: 'attempt-1', machineId, workspaceId, location: 'local' }
      const { token } = authority.issue(who.subject, { binding, tools: [capability(call)], ttlMs })
      const incoming = [call.signal, call.invocation?.signal, call.invocation?.peer?.signal].filter(Boolean)
      const signal = incoming.length ? AbortSignal.any(incoming) : undefined
      try {
        return await authority.run(token, binding, capability(call), ({ signal }) =>
          current.run({ ...who, signal }, () => operation(signal)), { signal })
      } finally { authority.release(token) }
    },
    filterRoutes(routes) {
      const subject = activeSubject()
      return routes.filter(route => {
        try { authority.assertModel(subject, route.provider, route.model); return true } catch { return false }
      })
    },
    modelStream(options, next) {
      const active = current.getStore()
      const subject = active?.subject ?? directory.forSession(options.sessionId)
      // If both metadata forms exist they must agree; a nested call cannot select another Bot.
      if (active && options.sessionId && directory.forSession(options.sessionId) !== subject) throw new PolicyError('SUBJECT_MISMATCH')
      authority.assertModel(subject, options.provider, options.model)
      const signal = active?.signal ? AbortSignal.any([options.signal, active.signal]) : options.signal
      return (async function* () {
        signal.throwIfAborted()
        authority.assertModel(subject, options.provider, options.model)
        for await (const chunk of next()) {
          signal.throwIfAborted()
          authority.assertModel(subject, options.provider, options.model)
          yield chunk
        }
      })()
    },
  })
}
