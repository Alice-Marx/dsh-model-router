import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { PolicyError } from '../../capability-broker/src/authority.mjs'

const pendingExecutionFacade = new Set(['model_router_execute', 'model_router_tool_run', 'model_router_team_execute',
  'model_router_rerun_step', 'model_router_tool_install', 'model_router_tool_repair', 'model_router_tool_uninstall', 'model_router_rate'])

/** Opt-in adapter. Bot native execution remains closed until its Execution facade exists. */
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
    if (call.kind === 'remote' && call.name === 'startRun') throw new PolicyError('BACKGROUND_TASK_FACADE_REQUIRED')
    if (!who.owner && (pendingExecutionFacade.has(call.name) ||
        (call.kind === 'command' && call.name === 'tools' && /^(install|uninstall|repair|cancel)\b/i.test(call.rawInput?.trim() ?? '')))) {
      throw new PolicyError('EXECUTION_FACADE_REQUIRED')
    }
    return who
  }
  const activeSubject = () => {
    const active = current.getStore()
    if (!active) throw new PolicyError('CALL_CONTEXT_REQUIRED')
    return active.subject
  }
  return Object.freeze({
    check,
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
