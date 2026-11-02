import { randomBytes } from 'node:crypto'
import { createCodexSessionCore, pinCodexExecutable } from './codex-session-core.mjs'

export { pinCodexExecutable }

function agentAuthority(context, validate, requestedModel, catalogProvider, catalogModel) {
  const leases = new Map()
  const subject = Object.freeze({})
  const bindingKey = value => JSON.stringify(value)
  const current = (token, binding) => {
    validate(context)
    const lease = leases.get(token)
    if (!lease || lease.binding !== bindingKey(binding) || lease.expiresAt <= Date.now()) {
      leases.delete(token)
      throw new Error('AGENT_CLI_LEASE_DENIED')
    }
    return lease
  }
  const authority = {
    describe() { validate(context); return { botId: context.botId, revision: context.revision } },
    assertModel(_subject, provider, model) {
      validate(context)
      if (provider !== catalogProvider || model !== catalogModel || requestedModel !== catalogModel) throw new Error('AGENT_CLI_MODEL_DENIED')
    },
    issue(_subject, { binding, tools, ttlMs }) {
      validate(context)
      if (binding?.location !== 'remote' || !Array.isArray(tools) || tools.length || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300000) throw new Error('AGENT_CLI_LEASE_DENIED')
      const token = randomBytes(32).toString('base64url')
      leases.set(token, { binding: bindingKey(binding), tools: new Set(tools), expiresAt: Math.min(Date.now() + ttlMs, context.expiresAt) })
      return { token }
    },
    list(token, binding) { return [...current(token, binding).tools].sort() },
    renew(token, binding, { ttlMs }) {
      const lease = current(token, binding)
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300000) throw new Error('AGENT_CLI_LEASE_DENIED')
      lease.expiresAt = Math.min(Date.now() + ttlMs, context.expiresAt)
      return { ttlMs }
    },
    async run(token, binding, tool, execute, { signal } = {}) {
      const lease = current(token, binding)
      if (!lease.tools.has(tool)) throw new Error('AGENT_CLI_TOOL_DENIED')
      validate(context)
      return execute({ signal: signal ?? new AbortController().signal })
    },
    release(token) { leases.delete(token) },
  }
  return { authority, subject, close: () => leases.clear() }
}

/** Agent-process-only entry. The binding remains remote; no Host-local fallback exists here. */
export async function createAgentCodexSession(options) {
  const { context, validate, requestedModel, catalogProvider = 'openai', catalogModel = requestedModel } = options ?? {}
  if (options?.binding?.location !== 'remote' || !context || typeof validate !== 'function') throw new Error('AGENT_CLI_REMOTE_BINDING_REQUIRED')
  if (!Array.isArray(options.tools) || options.tools.length || !Array.isArray(options.handlers) || options.handlers.length) throw new Error('AGENT_CLI_CAPABILITIES_FIXED')
  const local = agentAuthority(context, validate, requestedModel, catalogProvider, catalogModel)
  try {
    const session = await createCodexSessionCore({ ...options, authority: local.authority, subject: local.subject })
    const close = session.close
    return Object.freeze({ ...session, async close() { try { return await close() } finally { local.close() } }, async cancel() { try { return await session.cancel() } finally { local.close() } } })
  } catch (error) {
    local.close()
    throw error
  }
}
