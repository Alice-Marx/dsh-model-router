// Contract-level Codex session for isolated product verification. It never
// spawns a native executable, never contacts a provider and never manufactures
// an API bill: the real entry stays blocked until an install-verified codex is
// available on this host.
export function createCliSession({ requestedModel, billing, signal, onUsage, onBeforeRequest }) {
  const usage = { inputTokens: 11, outputTokens: 5, cachedInputTokens: null, cacheWriteInputTokens: null }
  let dispatched = false
  return Object.freeze({
    async run() {
      signal?.throwIfAborted()
      await onBeforeRequest()
      signal?.throwIfAborted()
      dispatched = true
      onUsage?.({ usage: { ...usage } })
    },
    snapshot() {
      return { usage: { ...usage }, terminal: dispatched ? 'completed' : 'interrupted',
        finalText: dispatched ? 'offline cli fixture reply' : '', cliTurnRequestsDispatched: dispatched ? 1 : 0,
        actualProviderRequestCount: dispatched ? 1 : 0,
        identity: { requestedCliModel: requestedModel, reportedCliModel: requestedModel,
          reportedProvider: 'openai', verification: 'verified', reroutes: [] } }
    },
    async close() { return { treeStopped: true } },
  })
}
