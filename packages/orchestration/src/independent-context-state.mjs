import { createHash } from 'node:crypto'

export const LEGACY_CONTEXT = 'legacy'
export const MAX_CONTEXTS = 64
export const contextIdOk = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(value)
export const contextRequestOk = value => typeof value === 'string' && /^[-A-Za-z0-9_]{16,128}$/.test(value)
const fail = code => { throw Object.assign(new Error(code), { code }) }

// Derived by the Host, never accepted from a model or a GenerateOptions sessionId.
export const independentContextId = (botId, requestKey) => `context-${createHash('sha256').update(JSON.stringify([botId, requestKey])).digest('hex')}`
export function contextFields(value) {
  const contextId = value.contextId ?? LEGACY_CONTEXT
  if (!contextIdOk(contextId)) fail('INVALID_BOT_CONTEXT')
  const contexts = value.contexts ?? [{ contextId: LEGACY_CONTEXT, sequence: 0, createdAt: value.createdAt ?? 0 }]
  if (!Array.isArray(contexts) || !contexts.length || contexts.length > MAX_CONTEXTS || contexts.some(row =>
    !row || !contextIdOk(row.contextId) || !Number.isSafeInteger(row.sequence) || row.sequence < 0 ||
    !Number.isSafeInteger(row.createdAt) || row.requestKey !== undefined && !contextRequestOk(row.requestKey) ||
    row.previousContextId !== undefined && !contextIdOk(row.previousContextId)) ||
    new Set(contexts.map(row => row.contextId)).size !== contexts.length || !contexts.some(row => row.contextId === contextId)) fail('INVALID_BOT_CONTEXT')
  const contextReset = value.contextReset
  if (contextReset !== undefined && (!contextReset || !contextRequestOk(contextReset.requestKey) ||
    !contextIdOk(contextReset.contextId) || contextReset.contextId === contextId ||
    contextReset.previousContextId !== contextId || !Number.isSafeInteger(contextReset.createdAt))) fail('INVALID_BOT_CONTEXT_RESET')
  return { contextId, contexts: contexts.map(row => ({ contextId: row.contextId, sequence: row.sequence, createdAt: row.createdAt,
    ...(row.requestKey ? { requestKey: row.requestKey } : {}), ...(row.previousContextId ? { previousContextId: row.previousContextId } : {}) })),
    ...(contextReset ? { contextReset: { requestKey: contextReset.requestKey, contextId: contextReset.contextId,
      previousContextId: contextReset.previousContextId, createdAt: contextReset.createdAt } } : {}),
    contextsTruncated: value.contextsTruncated === true }
}

export function contextView(session) {
  const counts = new Map()
  for (const row of session.messages) counts.set(row.contextId ?? LEGACY_CONTEXT, (counts.get(row.contextId ?? LEGACY_CONTEXT) ?? 0) + 1)
  const active = session.contexts.find(row => row.contextId === session.contextId)
  return { contextId: session.contextId, sequence: active.sequence, createdAt: active.createdAt,
    messageCount: counts.get(session.contextId) ?? 0, resetPending: Boolean(session.contextReset),
    contextsTruncated: session.contextsTruncated,
    contexts: session.contexts.map(row => ({ contextId: row.contextId, sequence: row.sequence, createdAt: row.createdAt,
      messageCount: counts.get(row.contextId) ?? 0 })) }
}

// A stop request, a timeout, or contradictory evidence cannot establish retirement.
export const retirementConfirmed = value => Boolean(value && value.treeStopped !== false && value.possiblyApplied !== true && value.unknown !== true &&
  (value.treeStopped === true || value.notStarted === true && value.possiblyApplied === false))
