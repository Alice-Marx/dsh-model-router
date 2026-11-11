// The causal harness for one prepared auxiliary model generation.
//
// The Bot's note, checkpoint and steward calls are not conversation steps, so they cannot
// borrow the session-log frame the integrated loop reads (`model-loop-frame.mjs`) and they
// carry no loop marker. This harness puts them on the one public seam that binds metadata
// to its own dispatch and runs them through the product's own money authority:
//
//   - the real installed Cordis `Context` and `LlmRuntime`, with only the provider
//     transport offline (`LlmAdapter`, no network, no credentials);
//   - a real principal directory and authority, so `identityFor` resolves the Bot from the
//     request's Session exactly as the Host policy does — never from the request;
//   - the real `createModelAccounting` over a real SQLite router state, so every admission,
//     reservation, lease and receipt is the product's code;
//   - the real `createAuxiliaryModelStream`, the real `createPreparedModelDispatch` and the
//     real shared frame store;
//   - the frozen ds-bot secret listener's rewrite semantics (rebuild the request and
//     re-enter `llm.stream`), registered outer to the accounting listener exactly as the
//     vendor module is, and the Host listener's prepared-request rewrite refusal.
//
// Each case asserts what the adapter that actually streamed received, how many times the
// waterfall was traversed, what the ledger recorded and what the store holds — never a
// restatement of the helper's arithmetic.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter } from '@deepseek-ai/dsh-llm'

import { createAuthority } from '../../packages/capability-broker/src/authority.mjs'
import { openSqliteRouterState } from '../../packages/orchestration/src/sqlite-router-state.mjs'
import { createModelAccounting } from '../../packages/orchestration/src/model-accounting.mjs'
import { createModelFrameStore } from '../../packages/orchestration/src/model-prepared-generation.mjs'
import { createAuxiliaryModelStream } from '../../packages/orchestration/src/model-auxiliary-dispatch.mjs'
import { createRouterState } from '../../.dsh-plugin/shared/router-state.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const root = resolve(import.meta.dirname, '../../tmp/integration/auxiliary-prepared-20261109/generation')
const NOW = 1_700_000_000_000
const PRICING = Object.freeze({ input: 1, output: 2 })
const CHUNKS = Object.freeze([
  { type: 'text-delta', index: 0, text: 'offline auxiliary answer' },
  { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  { type: 'finish', reason: { kind: 'stop' } },
])

/** Generation A: a window, a per-request cap, and a model that can be told to think less. */
export const GENERATION_A = Object.freeze({
  contextWindow: 4096, defaultMaxTokens: 64,
  reasoning: Object.freeze({ efforts: Object.freeze([Object.freeze({ id: 'off', name: 'Off' }), Object.freeze({ id: 'high', name: 'High' })]), defaultEffort: 'high' }),
})

/** Generation B: a smaller window, a different cap, and no reasoning control at all. */
export const GENERATION_B = Object.freeze({ contextWindow: 2000, defaultMaxTokens: 16 })

/** A wider replacement, for the case that shows what a point read of the route would price. */
export const GENERATION_WIDER = Object.freeze({ contextWindow: 9000, defaultMaxTokens: 512 })

const metadataFor = (generation, provider, model) => ({ provider, id: model, name: model,
  ...(generation.contextWindow ? { context: { contextWindow: generation.contextWindow } } : {}),
  ...(generation.defaultMaxTokens ? { defaultMaxTokens: generation.defaultMaxTokens } : {}),
  ...(generation.reasoning ? { reasoning: generation.reasoning } : {}) })

/**
 * @param run - the case body, receiving the harness.
 * @param options.a / options.b - the two generations, so a case can prove which one ran.
 * @param options.funding - per-botId funding overrides merged over the default api grant.
 * @param options.maxOutputTokens - the priced output allowance.
 * @param options.secretsRewrite - optional `(host) => listener` that models the frozen ds-bot
 *   secret rewrite: it rebuilds the request and re-enters `llm.stream`, exactly as the
 *   vendor listener does, so a case can prove the frame survives it or is refused.
 * @param options.auxiliary - overrides for the auxiliary service under test.
 */
export async function withAuxiliaryGeneration(run, {
  a = GENERATION_A, b = GENERATION_B, funding = {}, limits = { dailyLimitUsd: 0, monthlyLimitUsd: 0 },
  chunks = CHUNKS, beforeChunk = null, secretsRewrite = null, maxOutputTokens = 100, auxiliary = {},
} = {}) {
  await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'case-'))
  const legacyFile = join(home, 'legacy.json')
  const legacy = createRouterState({ file: legacyFile, lockStaleMs: 1 })
  await legacy.appendRun({ id: 'seed', createdAt: NOW, finishedAt: NOW, kind: 'assign', status: 'completed', packages: [], reviews: [] })
  const storageFile = join(home, 'orchestration.sqlite')
  const store = await openSqliteRouterState({ Database, file: storageFile, legacyFile, now: () => NOW })

  // Everything that reached the base adapter, in order. `signal` is the object the adapter
  // itself was handed, so a per-call signal and a linked cancellation are observations.
  const upstream = []
  const ctx = new Context()
  const live = { table: { a: { ...a }, b: { ...b } } }
  class GenerationAdapter extends LlmAdapter {
    constructor(generation) { super(); this.generation = generation }
    async listModels(provider) { return [{ provider, id: 'one', name: 'one' }] }
    async resolveModel(provider, model) { return metadataFor(this.generation, provider, model) }
    async *stream(options) {
      upstream.push({ generation: this.generation === a ? 'A' : 'B', provider: options.provider, model: options.model,
        maxTokens: options.maxTokens, reasoningEffort: options.reasoningEffort, purpose: options.purpose,
        sessionId: options.sessionId, system: options.system, toolCount: (options.tools ?? []).length,
        toolHistoryCount: (options.toolHistory ?? []).length, signal: options.signal, messages: options.messages })
      for (const [index, chunk] of chunks.entries()) { if (beforeChunk) await beforeChunk(index); options.signal?.throwIfAborted(); yield chunk }
    }
  }
  let llm, primaryHandle = null, swapHandle = null
  const fork = await ctx.plugin(scope => {
    llm = new LlmRuntime(scope)
    primaryHandle = llm.registerAdapter(['alpha', 'beta'], new GenerationAdapter(a))
  })

  const fundingFor = async ({ botId, provider, model }) => {
    const policy = funding[botId]
    if (policy === null) return null
    if (policy?.funding === 'subscription') return { funding: 'subscription', route: { provider, model } }
    return { funding: 'api', route: { provider, model }, pricing: PRICING, maxInputTokens: 4096, maxOutputTokens, ...(policy ?? {}) }
  }

  const authority = createAuthority({ now: () => NOW })
  const subjects = {}
  const subjectFor = botId => (subjects[botId] ??= Object.freeze({ botId }))
  const registerBot = (botId, routes = [{ provider: 'alpha', model: 'one' }]) => {
    authority.register(subjectFor(botId), { botId, tools: ['model/infer'], modelRoutes: routes })
    return subjectFor(botId)
  }
  registerBot('a')
  registerBot('b')

  // The trusted Host identity read: the principal directory answers for the request's own
  // Session, and the authority decides the route. Nothing a request carries is consulted.
  const sessions = new Map([['sa', 'a'], ['sb', 'b']])
  const directory = {
    forSession(sessionId) {
      const botId = sessions.get(sessionId)
      if (botId === undefined) throw Object.assign(new Error('UNKNOWN_SUBJECT'), { code: 'UNKNOWN_SUBJECT' })
      return subjectFor(botId)
    },
  }
  const identityFor = request => {
    const subject = directory.forSession(request.sessionId)
    authority.assertModel(subject, request.provider, request.model)
    return { subject, botId: authority.describe(subject).botId, sessionId: request.sessionId ?? null, source: 'aux' }
  }

  const frames = createModelFrameStore()
  const accounting = createModelAccounting({
    store, authority, pricingFor: fundingFor,
    modelBoundsFor: async ({ options: request, signal }) => {
      // The non-prepared fallback the frame replaces: a point read of the current registration.
      const info = await llm.resolveModelInfo(request.provider, request.model, signal ?? undefined)
      return { inputBound: info.context?.contextWindow ?? null, outputDefault: info.defaultMaxTokens ?? null }
    },
    preparedFrameFor: options => frames.read(options?.signal),
    machineId: 'machine-1', workspaceId: 'ws-1', now: () => NOW, limits, maxActive: 16,
  })

  // The Host's own redactor and the runtime's own usage-tag carry: both are Host state, and
  // a case may commit a secret after a call has been prepared.
  const secrets = new Map()
  const redact = text => typeof text === 'string' ? text.replaceAll(secrets.get('live') ?? '\u0000nothing', '[secret:fixture]') : text
  const usageTags = new WeakMap()
  const tagUsage = (messages, tag) => { if (messages && typeof messages === 'object') usageTags.set(messages, tag); return messages }
  const carryUsageTag = (from, to) => { const tag = from && typeof from === 'object' ? usageTags.get(from) : undefined; if (tag !== undefined) tagUsage(to, tag) }

  // How many times the `llm/stream` waterfall was traversed, and how many admissions ran.
  const traversals = { count: 0 }
  let admissions = 0
  if (secretsRewrite) secretsRewrite({ ctx, llm, upstream, redact })
  ctx.on('llm/stream', (options, next) => {
    traversals.count += 1
    const identity = identityFor(options)
    // The Host listener's prepared-request refusal, verbatim in shape: a request object the
    // prepared frame does not own is refused before any provider call or money effect.
    const prepared = frames.read(options.signal)
    if (prepared?.request && prepared.request !== options) {
      throw Object.assign(new Error('模型请求在准备后被改写，已拒绝更换调用配置；请核对原请求后重试。'), { code: 'MODEL_PREPARED_REQUEST_REWRITTEN' })
    }
    admissions += 1
    return accounting.stream(options, next, identity)
  })

  // The gate the tests use to act in the window between preparation and dispatch. It wraps
  // the runtime the auxiliary service prepares through, so the real `prepareCall` still
  // captures the registration and the real one-shot stream still dispatches it.
  const gate = { afterPrepare: null }
  const auxService = createAuxiliaryModelStream({
    llm: () => {
      if (typeof gate.afterPrepare !== 'function') return llm
      const decorated = Object.create(llm)
      Object.defineProperty(decorated, 'prepareCall', {
        value: async (config, signal, configure) => {
          const prepared = await llm.prepareCall(config, signal, configure)
          await gate.afterPrepare({ prepared, config })
          return prepared
        },
        writable: true, configurable: true, enumerable: false,
      })
      return decorated
    },
    frames, fundingFor, identityFor, redact, carryUsageTag, ...auxiliary,
  })

  const rows = table => {
    assert.ok(['router_model_calls', 'router_runs'].includes(table), 'TEST_TABLE_NOT_ALLOWED')
    const db = new Database(storageFile, { readonly: true })
    try { return db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.payload)) }
    finally { db.close() }
  }
  const harness = {
    ctx, llm, store, authority, frames, accounting, upstream, storageFile, rows, live, gate,
    directory, identityFor, fundingFor, auxService, traversals, redact, tagUsage,
    admissions: () => admissions,
    bindSession: (sessionId, botId) => { sessions.set(sessionId, botId); return sessionId },
    commitSecret: value => secrets.set('live', value),
    clearSecrets: () => secrets.delete('live'),
    usageTagOf: messages => usageTags.get(messages),
    request: (overrides = {}) => ({ provider: 'alpha', model: 'one',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'write the note' }] }],
      sessionId: 'sa', purpose: 'compaction', signal: new AbortController().signal, ...overrides }),
    /** The auxiliary stream under test, in the shape the Bot's own call sites use. */
    aux: async (request, context) => {
      const seen = []
      for await (const chunk of auxService(request, context)) seen.push(chunk)
      return seen
    },
    /** The non-prepared control: the ordinary stream, which re-resolves the model at dispatch. */
    raw: async (request, { identity = identityFor(request) } = {}) => {
      const seen = []
      for await (const chunk of llm.stream(request)) seen.push(chunk)
      return seen
    },
    useSwap: () => { primaryHandle?.(); primaryHandle = null; swapHandle = llm.registerAdapter(['alpha', 'beta'], new GenerationAdapter(b)) },
    usePrimary: () => { swapHandle?.(); swapHandle = null; primaryHandle = llm.registerAdapter(['alpha', 'beta'], new GenerationAdapter(a)) },
    runs: () => rows('router_runs').filter(run => run.id !== 'seed'),
    receipts: async () => (await store.modelCalls({ after: 0, limit: 100 })).items,
    revoke: botId => authority.revoke(subjectFor(botId)),
    dispose: async () => { await accounting.close(); await fork.dispose(); store.close() },
  }
  try { return await run(harness) } finally { await harness.dispose() }
}

/**
 * The whole-product auxiliary chain, offline.
 *
 * This boots the real product the way the plugin does — the bundled patched vendored DS Bot
 * runtime, the real `createBotProduct`, the real principal directory, the real Bot policy and
 * the real `createModelAccounting` over a real SQLite router state — then provides the
 * auxiliary stream on the runtime's own context and drives one note-shaped call through it.
 *
 * The prepared fence is the installed SDK's own: a real `LlmRuntime` over a real Cordis
 * context whose `llm/stream` listeners are the ones the product actually installed, replayed
 * in registration order, so `prepareCall` and its one-shot dispatch are the SDK's code and the
 * Host's own stack is what admits.
 *
 * What this harness does NOT prove, and why: the accounting
 * `tests/fixtures/bot-independent-boot.mjs` builds takes no `preparedFrameFor`, so it cannot
 * admit against a captured frame. Same-generation admission is proven by
 * `withAuxiliaryGeneration` above. Sharing one frame store between `createBotProduct` and the
 * auxiliary stream is the parent's composition change.
 */
export async function withAuxiliaryHost(t, run, {
  chunks = [
    { type: 'text-delta', index: 0, text: '## Goals\n- keep the note\n' },
    { type: 'usage', usage: { inputTokens: 21, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
  funding = {}, bounds = { contextWindow: 4096, defaultMaxTokens: 64 },
} = {}) {
  const { bootIndependentHost, seed } = await import('../fixtures/bot-independent-boot.mjs')
  const { Context } = await import('@deepseek-ai/cordis')
  const { LlmRuntime, LlmAdapter } = await import('@deepseek-ai/dsh-llm')
  const frames = createModelFrameStore()
  const framesAtSet = []
  // A recording view of the shared store: what a prepared dispatch records, in order. The
  // store itself stays the product's own, so nothing about the frame's ownership changes.
  const observedFrames = Object.freeze({
    set: (signal, frame) => { framesAtSet.push(frame); frames.set(signal, frame) },
    read: signal => frames.read(signal),
    delete: signal => frames.delete(signal),
  })
  const host = await bootIndependentHost(t, { seed: seed(), chunks, funding })
  const upstream = []
  const bridge = new Context()
  // Replay, in registration order, every llm/stream listener the product and the vendored
  // runtime installed, so the SDK's waterfall runs exactly the Host's own stack.
  for (const listener of host.ctx.listeners.get('llm/stream') ?? []) bridge.on('llm/stream', listener)
  let llm
  const fork = await bridge.plugin(scope => {
    llm = new LlmRuntime(scope)
    class OfflineAdapter extends LlmAdapter {
      async listModels(provider) { return [{ provider, id: 'one', name: 'one' }] }
      async resolveModel(provider, model) {
        return { provider, id: model, name: model,
          ...(bounds.contextWindow ? { context: { contextWindow: bounds.contextWindow } } : {}),
          ...(bounds.defaultMaxTokens ? { defaultMaxTokens: bounds.defaultMaxTokens } : {}),
          ...(bounds.reasoning ? { reasoning: bounds.reasoning } : {}) }
      }
      async *stream(options) {
        upstream.push({ provider: options.provider, model: options.model, maxTokens: options.maxTokens,          reasoningEffort: options.reasoningEffort, purpose: options.purpose, sessionId: options.sessionId,
          system: options.system, toolCount: (options.tools ?? []).length,
          toolHistoryCount: (options.toolHistory ?? []).length, signal: options.signal, messages: options.messages })
        for (const chunk of chunks) yield chunk
      }
    }
    llm.registerAdapter(['alpha'], new OfflineAdapter())
  })
  const harness = {
    host, ctx: host.ctx, rt: host.rt, policy: host.policy, directory: host.directory, llm, frames: observedFrames,
    upstream, framesAtSet, receipts: botId => host.money.receipts(botId),
    // The Bot's own chat Session, which is what a note, a checkpoint and the steward speak for.
    bindChatSession: botId => host.lifecycle.observeAgent(host.agentOf(botId)),
    provide: service => host.ctx.provide('botAuxiliaryModelStream', service),
    secretName: 'AUX_FIXTURE',
  }
  try { return await run(harness) } finally { await fork.dispose().catch(() => {}) }
}

export { NOW, PRICING, CHUNKS, GENERATION_A as A, GENERATION_B as B }