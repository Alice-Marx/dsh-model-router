import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter } from '@deepseek-ai/dsh-llm'

// The causal harness for one prepared model generation: the real money authority over a
// real SQLite router state, the real principal authority, and the installed
// Cordis/LlmRuntime with the offline transport. The independent path's prepared dispatch
// and the accounting are the product's own code; only the provider's answers are fixtures.
//
// Each case asserts what the adapter that actually streamed received, what the ledger
// recorded, and what the store holds — never a restatement of the helper's arithmetic.

import { createAuthority } from '../../packages/capability-broker/src/authority.mjs'
import { openSqliteRouterState } from '../../packages/orchestration/src/sqlite-router-state.mjs'
import { createModelAccounting } from '../../packages/orchestration/src/model-accounting.mjs'
import { createModelFrameStore, createPreparedModelDispatch } from '../../packages/orchestration/src/model-prepared-generation.mjs'
import { createRouterState } from '../../.dsh-plugin/shared/router-state.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const root = resolve(import.meta.dirname, '../../tmp/integration/model-generation')
const NOW = 1_700_000_000_000
const PRICING = Object.freeze({ input: 1, output: 2 })
const CHUNKS = Object.freeze([
  { type: 'text-delta', index: 0, text: 'offline answer' },
  { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  { type: 'finish', reason: { kind: 'stop' } },
])

/** What the primary adapter declares. `one` is the normal route; `nodefault` has no cap. */
export const ROUTES = Object.freeze({
  one: { contextWindow: 4096, defaultMaxTokens: 64 },
  nodefault: { contextWindow: 4096 },
})

/** What the swapped-in adapter declares: a different window and a different default. */
export const SWAP_ROUTES = Object.freeze({
  one: { contextWindow: 2000, defaultMaxTokens: 16 },
  nodefault: { contextWindow: 9000 },
})

const metadataFor = (table, provider, model, tag) => {
  const entry = table[model]
  if (entry === undefined) return { provider, id: model, name: model }
  return { provider, id: model, name: model,
    ...(entry.contextWindow ? { context: { contextWindow: entry.contextWindow } } : {}),
    ...(entry.defaultMaxTokens ? { defaultMaxTokens: entry.defaultMaxTokens } : {}) }
}

/**
 * @param run - the case body, receiving the harness.
 * @param routes - the primary adapter's metadata.
 * @param swapRoutes - the swapped adapter's metadata.
 * @param funding - per-botId funding overrides merged over the default api grant.
 * @param secretsRewrite - optional `(host) => listener` that models the ds-bot secret
 *   rewrite: it rebuilds the request and re-enters `llm.stream`, exactly as the frozen
 *   vendor listener does, so a case can prove the frame survives it.
 * @param maxOutputTokens - the priced output allowance.
 */
export async function withModelGeneration(run, {
  routes = ROUTES, swapRoutes = SWAP_ROUTES, funding = {}, limits = { dailyLimitUsd: 0, monthlyLimitUsd: 0 },
  chunks = CHUNKS, beforeChunk = null, secretsRewrite = null, maxOutputTokens = 100, grant = null, maxActive = 16,
} = {}) {
  await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'case-'))
  const legacyFile = join(home, 'legacy.json')
  const legacy = createRouterState({ file: legacyFile, lockStaleMs: 1 })
  await legacy.appendRun({ id: 'seed', createdAt: NOW, finishedAt: NOW, kind: 'assign', status: 'completed', packages: [], reviews: [] })
  const storageFile = join(home, 'orchestration.sqlite')
  const store = await openSqliteRouterState({ Database, file: storageFile, legacyFile, now: () => NOW })

  const upstream = []
  const ctx = new Context()
  // The live metadata table the primary adapter answers from; a case can mutate it to model a
  // dynamic adapter whose answer changes after a call is prepared. A shallow copy, so the frozen
  // ROUTES fixture is never mutated.
  const live = { table: { ...routes } }
  class PrimaryAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'one', name: 'one' }] }
    async resolveModel(provider, model) { return metadataFor(live.table, provider, model, 'A') }
    async *stream(options) {
      upstream.push({ adapter: 'A', provider: options.provider, model: options.model, maxTokens: options.maxTokens })
      for (const [index, chunk] of chunks.entries()) { if (beforeChunk) await beforeChunk(index); options.signal?.throwIfAborted(); yield chunk }
    }
  }
  class SwapAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'one', name: 'one' }] }
    async resolveModel(provider, model) { return metadataFor(swapRoutes, provider, model, 'B') }
    async *stream(options) {
      upstream.push({ adapter: 'B', provider: options.provider, model: options.model, maxTokens: options.maxTokens })
      for (const [index, chunk] of chunks.entries()) { if (beforeChunk) await beforeChunk(index); options.signal?.throwIfAborted(); yield chunk }
    }
  }
  let llm, primaryHandle = null, swapHandle = null
  const fork = await ctx.plugin(scope => {
    llm = new LlmRuntime(scope)
    primaryHandle = llm.registerAdapter(['alpha', 'beta'], new PrimaryAdapter())
  })

  const fundingFor = async ({ botId, provider, model }) => {
    const policy = funding[botId]
    if (policy === null) return null
    if (policy?.funding === 'subscription') return { funding: 'subscription', route: { provider, model } }
    return { funding: 'api', route: { provider, model }, pricing: PRICING, maxInputTokens: 4096, maxOutputTokens, ...(policy ?? {}) }
  }

  const modelRoutes = grant ?? [{ provider: 'alpha', model: 'one' }, { provider: 'alpha', model: 'nodefault' }, { provider: 'beta', model: 'vendor/two' }]
  const authority = createAuthority({ now: () => NOW })
  const subjects = {}
  const subjectFor = botId => (subjects[botId] ??= Object.freeze({ botId }))
  const registerBot = (botId, routes_ = modelRoutes) => {
    const subject = subjectFor(botId)
    authority.register(subject, { botId, tools: ['model/infer'], modelRoutes: routes_ })
    return subject
  }
  registerBot('a')

  const frames = createModelFrameStore()
  const accounting = createModelAccounting({
    store, authority, pricingFor: fundingFor,
    modelBoundsFor: async ({ options: request, signal }) => {
      // The non-prepared fallback the frame replaces: a point read of the current registration.
      const info = await llm.resolveModelInfo(request.provider, request.model, signal ?? undefined)
      return { inputBound: info.context?.contextWindow ?? null, outputDefault: info.defaultMaxTokens ?? null }
    },
    preparedFrameFor: options => frames.read(options?.signal),
    machineId: 'machine-1', workspaceId: 'ws-1', now: () => NOW, limits, maxActive,
  })

  // Trusted test execution carries identity in an async frame, like the Host
  // policy. An AbortSignal is cancellation, never an authentication credential.
  const identities = new AsyncLocalStorage()
  // The secret rewrite registers first, so it is outer to the accounting listener exactly as the
  // frozen ds-bot module is (installed at createRuntime, before the Host listener): a redaction
  // rebuilds the request and re-enters `llm.stream`, and the accounting admits the rebuilt one once.
  if (secretsRewrite) secretsRewrite({ ctx, llm, upstream })
  ctx.on('llm/stream', (options, next) => {
    const identity = identities.getStore()
    assert.ok(identity, 'the model call must have an explicit trusted test identity')
    return accounting.stream(options, next, identity)
  })

  const dispatch = createPreparedModelDispatch({ llm: () => llm, frames, fundingFor })

  const rows = table => {
    assert.ok(['router_model_calls', 'router_runs'].includes(table), 'TEST_TABLE_NOT_ALLOWED')
    const db = new Database(storageFile, { readonly: true })
    try { return db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.payload)) }
    finally { db.close() }
  }
  const harness = {
    ctx, llm, store, authority, frames, accounting, upstream, storageFile, rows, live,
    asBot: (botId, operation) => identities.run({ subject: subjectFor(botId), botId, source: 'bot' }, operation),
    registerBot, subjectFor,
    request: (overrides = {}) => ({ provider: 'alpha', model: 'one',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'gen' }] }], signal: new AbortController().signal, ...overrides }),
    /** Bind a trusted execution identity, then run it through the prepared dispatch.
     *  `gate` runs after the call is prepared and its frame recorded, before the one-shot
     *  stream dispatches — the window in which a registration can be swapped mid-flight. */
    prepared: async (request, { botId = 'a', subject = subjectFor(botId), source = 'bot', gate = null } = {}) => identities.run({ subject, botId, source }, async () => {
      const seen = []
      for await (const chunk of dispatch.dispatch(request, { botId, subject, beforeDispatch: gate })) seen.push(chunk)
      return seen
    }),
    /** The non-prepared control: the ordinary stream, which re-resolves the model at dispatch.
     *  It runs through the same listener (one admission), proving a swap is real and that only
     *  the prepared path holds the captured generation. */
    raw: async (request, { botId = 'a', subject = subjectFor(botId), source = 'bot' } = {}) => identities.run({ subject, botId, source }, async () => {
      const seen = []
      for await (const chunk of llm.stream(request)) seen.push(chunk)
      return seen
    }),
    /** Replace the route's adapter with the swap adapter (dispose the current, register it). */
    useSwap: () => { primaryHandle?.(); primaryHandle = null; swapHandle = llm.registerAdapter(['alpha', 'beta'], new SwapAdapter()) },
    /** Restore the primary adapter. */
    usePrimary: () => { swapHandle?.(); swapHandle = null; primaryHandle = llm.registerAdapter(['alpha', 'beta'], new PrimaryAdapter()) },
    swap: function () { this.useSwap() },
    runs: () => rows('router_runs').filter(run => run.id !== 'seed'),
    receipts: async () => (await store.modelCalls({ after: 0, limit: 100 })).items,
    revoke: botId => authority.revoke(subjectFor(botId)),
    dispose: async () => { await accounting.close(); await fork.dispose(); store.close() },
  }
  try { return await run(harness) } finally { await harness.dispose() }
}

export { NOW, PRICING, CHUNKS }
