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
      return frame?{subject:frame.subject,botId:authority.describe(frame.subject).botId,owner:frame.owner,independent:frame.independent===true,...(frame.conversationId?{conversationId:frame.conversationId}:{}),...(frame.workThread?{workThread:frame.workThread}:{})}:null
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
    /**
     * A model turn's own frame.
     *
     * A text turn is not a Task: `executionContext` asserts `task/execute`, so a session that only
     * talks to a model would have to forge a Task to look like one. This frame carries the subject
     * the Host resolved from committed state — never anything a request carries — plus the turn's
     * signal, so `modelIdentity` and `modelStream` inside it re-decide the route and re-read the
     * cancel on every chunk. `botId` is an optional cross-check: a caller that names one Bot and
     * resolves another is refused instead of silently answered for the wrong Bot.
     */
    modelContext(subject, signal, operation, { botId = null, conversationId = null, workThread = null } = {}) {
      const who = authority.describe(subject)
      if (botId !== null && who.botId !== botId) throw new PolicyError('SUBJECT_MISMATCH')
      // A frame that already speaks for another subject cannot be re-pointed at this one: a nested
      // call must not change whose turn it is.
      const active = current.getStore()
      if (active && !active.owner && active.subject !== subject) throw new PolicyError('SUBJECT_MISMATCH')
      // An admitted financial run stays attached when it belongs to the same subject, so a nested
      // model call bills the run it is inside instead of opening a second one.
      const financial = active && active.subject === subject ? active.financial : undefined
      const signals = [...new Set([active?.signal, signal].filter(Boolean))]
      const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
      combined?.throwIfAborted()
      // Optional trusted Host metadata for a delegated work-thread turn: the per-work-thread
      // conversationId the composition surfaces as the native identity, and a small workThread
      // descriptor. Both are Host facts the dispatch boundary supplies; a model can never set
      // them, and they confer no authority — the subject above is still the only identity.
      const conversation = typeof conversationId === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(conversationId) ? conversationId : null
      const thread = workThread && typeof workThread === 'object' && !Array.isArray(workThread) ? workThread : null
      return current.run({ subject, owner: false, independent: true, signal: combined, ...(financial ? { financial } : {}), ...(conversation ? { conversationId: conversation } : {}), ...(thread ? { workThread: thread } : {}) }, operation)
    },
    /**
     * Run an operation OUTSIDE the current model-turn frame. The team dispatch and resume
     * boundaries use this so a target turn (or a resumed sender turn) never inherits the
     * calling Bot's async subject or funding: the target re-derives its own subject from
     * committed state inside its own frame. The hard guarantee remains the target's own
     * SUBJECT_MISMATCH guard; this is the explicit boundary on top of it.
     */
    runDetached(operation) { return current.exit(operation) },
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
      const signal = active?.signal ? AbortSignal.any([options.signal, active.signal].filter(Boolean)) : options.signal
      return (async function* () {
        signal?.throwIfAborted()
        authority.assertModel(subject, options.provider, options.model)
        for await (const chunk of next()) {
          signal?.throwIfAborted()
          authority.assertModel(subject, options.provider, options.model)
          yield chunk
        }
      })()
    },
  })
}
