import { createHash, randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export class PolicyError extends Error {
  constructor(code) { super(`Capability refused: ${code}`); this.name = 'PolicyError'; this.code = code }
}

const refuse = code => { throw new PolicyError(code) }
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const names = values => {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value || value.length > 256)) refuse('INVALID_GRANT')
  return new Set(values)
}
const digest = value => createHash('sha256').update(value).digest('hex')
const routeKey = (provider, model) => JSON.stringify([provider, model])
const routes = values => {
  if (!Array.isArray(values)) refuse('INVALID_GRANT')
  return new Set(values.map(value => {
    if (!value || Object.keys(value).some(key => !['provider', 'model'].includes(key)) ||
        typeof value.provider !== 'string' || !value.provider || value.provider.length > 256 ||
        typeof value.model !== 'string' || !value.model || value.model.length > 256) refuse('INVALID_GRANT')
    return routeKey(value.provider, value.model)
  }))
}

function bindingOf(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) refuse('INVALID_BINDING')
  if (Object.keys(input).some(key => !['taskId', 'attemptId', 'machineId', 'workspaceId', 'location'].includes(key))) refuse('INVALID_BINDING')
  for (const key of ['taskId', 'attemptId', 'machineId', 'workspaceId']) if (!identifier(input[key])) refuse('INVALID_BINDING')
  if (!['local', 'remote'].includes(input.location)) refuse('INVALID_BINDING')
  return JSON.stringify([input.taskId, input.attemptId, input.machineId, input.workspaceId, input.location])
}

/** Experimental in-memory authority. Host-owned object identities never come from JSON. */
export function createAuthority({ now = () => performance.now(), maxTtlMs = 300_000, maxLeases = 256 } = {}) {
  if (!Number.isSafeInteger(maxTtlMs) || maxTtlMs < 1 || maxTtlMs > 300_000) refuse('INVALID_TTL')
  if (!Number.isSafeInteger(maxLeases) || maxLeases < 1 || maxLeases > 4096) refuse('INVALID_LIMIT')
  const subjects = new WeakMap()
  const botIds = new Set()
  const leases = new Map()
  let disposed = false

  const subjectOf = subject => {
    if (disposed) refuse('AUTHORITY_CLOSED')
    const value = subject && typeof subject === 'object' ? subjects.get(subject) : undefined
    if (!value) refuse('UNKNOWN_SUBJECT')
    if (value.revoked) refuse('SUBJECT_REVOKED')
    return value
  }
  const cancel = (lease, code) => {
    for (const controller of lease.active) controller.abort(new PolicyError(code))
    leases.delete(lease.key)
  }
  const validLease = (token, binding) => {
    if (disposed) refuse('AUTHORITY_CLOSED')
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) refuse('UNKNOWN_LEASE')
    const lease = leases.get(digest(token))
    if (!lease) refuse('UNKNOWN_LEASE')
    if (now() >= lease.expiresAt) { cancel(lease, 'LEASE_EXPIRED'); refuse('LEASE_EXPIRED') }
    const principal = subjectOf(lease.subject)
    if (principal.revision !== lease.revision) { cancel(lease, 'GRANT_CHANGED'); refuse('GRANT_CHANGED') }
    if (bindingOf(binding) !== lease.binding) refuse('BINDING_MISMATCH')
    return lease
  }
  const invalidateSubject = (subject, code) => {
    for (const lease of [...leases.values()]) if (lease.subject === subject) cancel(lease, code)
  }

  return Object.freeze({
    register(subject, { botId, tools = [], modelRoutes = [] }) {
      if (disposed) refuse('AUTHORITY_CLOSED')
      if (!subject || typeof subject !== 'object' || !identifier(botId)) refuse('INVALID_SUBJECT')
      if (subjects.has(subject) || botIds.has(botId)) refuse('DUPLICATE_SUBJECT')
      const state = { botId, tools: names(tools), models: routes(modelRoutes), revision: 1, revoked: false }
      subjects.set(subject, state)
      botIds.add(botId)
    },
    assertTool(subject, name) {
      if (!subjectOf(subject).tools.has(name)) refuse('TOOL_DENIED')
    },
    assertModel(subject, provider, model) {
      if (typeof provider !== 'string' || typeof model !== 'string' || !subjectOf(subject).models.has(routeKey(provider, model))) refuse('MODEL_DENIED')
    },
    replaceGrant(subject, { tools = [], modelRoutes = [] }) {
      const state = subjectOf(subject)
      const nextTools = names(tools)
      const nextModels = routes(modelRoutes)
      state.tools = nextTools
      state.models = nextModels
      state.revision++
      invalidateSubject(subject, 'GRANT_CHANGED')
    },
    revoke(subject) {
      const state = subjectOf(subject)
      state.revoked = true
      state.revision++
      invalidateSubject(subject, 'SUBJECT_REVOKED')
    },
    issue(subject, { binding, tools, ttlMs = 30_000 }) {
      const principal = subjectOf(subject)
      const encoded = bindingOf(binding)
      const selected = names(tools)
      if ([...selected].some(name => !principal.tools.has(name))) refuse('TOOL_DENIED')
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > maxTtlMs) refuse('INVALID_TTL')
      for (const lease of [...leases.values()]) if (now() >= lease.expiresAt) cancel(lease, 'LEASE_EXPIRED')
      if (leases.size >= maxLeases) refuse('LEASE_LIMIT')
      const token = randomBytes(32).toString('base64url')
      const key = digest(token)
      leases.set(key, { key, subject, revision: principal.revision, binding: encoded,
        tools: selected, expiresAt: now() + ttlMs, active: new Set() })
      return Object.freeze({ token, ttlMs })
    },
    list(token, binding) { return [...validLease(token, binding).tools].sort() },
    async run(token, binding, toolName, execute, { signal } = {}) {
      const lease = validLease(token, binding)
      if (!lease.tools.has(toolName)) refuse('TOOL_DENIED')
      if (typeof execute !== 'function') refuse('INVALID_HANDLER')
      const controller = new AbortController()
      lease.active.add(controller)
      const timer = setTimeout(() => {
        cancel(lease, 'LEASE_EXPIRED')
        controller.abort(new PolicyError('LEASE_EXPIRED'))
      }, Math.max(1, Math.ceil(lease.expiresAt - now())))
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      try {
        combined.throwIfAborted()
        const value = await execute({ signal: combined })
        combined.throwIfAborted()
        validLease(token, binding)
        return value
      } finally {
        clearTimeout(timer)
        lease.active.delete(controller)
      }
    },
    release(token) {
      if (typeof token !== 'string') return
      const lease = leases.get(digest(token))
      if (lease) cancel(lease, 'LEASE_RELEASED')
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const lease of [...leases.values()]) cancel(lease, 'AUTHORITY_CLOSED')
    },
  })
}
