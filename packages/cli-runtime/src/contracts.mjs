const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null

/** Unknown stays null. Cached/reasoning counts are components, never added twice. */
export function usageBreakdown(value) {
  return Object.freeze({ inputTokens: count(value?.inputTokens), outputTokens: count(value?.outputTokens),
    cachedInputTokens: count(value?.cachedInputTokens), cacheWriteInputTokens: count(value?.cacheWriteInputTokens),
    reasoningOutputTokens: count(value?.reasoningOutputTokens), totalTokens: count(value?.totalTokens) })
}

export function createCodexEvidence({ binding, operationId, botId, requestedModel, catalogModel = requestedModel, catalogProvider = 'openai', entry, billing = 'subscription' }) {
  if (!['subscription', 'api', 'unknown'].includes(billing)) throw new TypeError('INVALID_CLI_BILLING')
  let threadId = null, turnId = null, reportedModel = null, reportedProvider = null
  let usage = usageBreakdown(), seenUsage = false, mismatch = false, finished = null, finalText = '', failure = null
  const reroutes = []
  return Object.freeze({
    bindThread(result) {
      threadId = result?.thread?.id ?? null
      reportedModel = typeof result?.model === 'string' ? result.model : null
      reportedProvider = typeof result?.modelProvider === 'string' ? result.modelProvider : null
      mismatch = reportedModel !== requestedModel || reportedProvider !== 'openai'
      if (!threadId || mismatch) throw new Error('CLI_MODEL_IDENTITY_MISMATCH')
    },
    event(message) {
      const params = message?.params
      if (!params || params.threadId !== threadId) return { accepted: false }
      if (turnId && params.turnId && params.turnId !== turnId) return { accepted: false }
      if (message.method === 'turn/started') turnId = params.turn?.id ?? turnId
      if (message.method === 'thread/tokenUsage/updated') {
        turnId ??= params.turnId
        // Each notification is cumulative for a thread. Repeated snapshots do not create extra receipts.
        usage = usageBreakdown(params.tokenUsage?.total); seenUsage = true
        return { accepted: true, usageChanged: true }
      }
      if (message.method === 'model/rerouted') {
        reroutes.push({ fromModel: params.fromModel ?? null, toModel: params.toModel ?? null, reason: params.reason ?? null })
        if (params.toModel !== requestedModel) mismatch = true
      }
      if (message.method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') finalText = params.item.text
      if (message.method === 'turn/completed') {
        turnId ??= params.turn?.id
        finished = params.turn?.status ?? 'unknown'
        failure = params.turn?.error ? { code: params.turn.error.codexErrorInfo ?? null, message: String(params.turn.error.message ?? '').slice(0, 512) } : null
      }
      return { accepted: true, mismatch, completed: message.method === 'turn/completed' }
    },
    snapshot() {
      return { schemaVersion: 1, source: 'cli', toolId: 'codex', botId, ...binding, operationId,
        receiptId: threadId && turnId ? `codex:${operationId}:${threadId}:${turnId}` : null,
        threadId, turnId, entry: { path: entry.path, sha256: entry.sha256, version: entry.version },
        identity: { catalogProvider, catalogModel, requestedCliModel: requestedModel, reportedCliModel: reportedModel,
          reportedProvider, actualResponseModel: null, verification: mismatch ? 'mismatch' : reportedModel ? 'cli-configured-model' : 'unreported',
          actualResponseModelVerified: false, reroutes: [...reroutes] },
        usage: { ...usage, reported: seenUsage, status: seenUsage && Object.values(usage).every(value => value !== null) ? 'complete' : seenUsage ? 'partial' : 'unknown' },
        billing: { kind: billing, amountUsd: null, amountStatus: billing === 'subscription' ? 'not-applicable' : 'unknown' },
        terminal: mismatch ? 'identity-mismatch' : finished, finalText, failure,
        limitations: ['Codex thread/start reports the configured model; this protocol does not prove the response backend model', 'An independent profile and MCP scope do not provide OS file isolation'] }
    },
  })
}
