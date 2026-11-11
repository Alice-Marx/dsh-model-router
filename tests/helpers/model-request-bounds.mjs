import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter } from '@deepseek-ai/dsh-llm'

// The causal harness for request bounds: the real money authority over a real
// SQLite router state, the real principal authority, and the installed
// Cordis/LlmRuntime with the offline transport. Only the provider's answers are
// fixtures; every admission decision, receipt, reservation and dispatch is the
// product's own code.
//
// What each case asserts is what the adapter actually received, what the ledger
// actually recorded, and what the store actually holds afterwards — never a
// re-statement of the helper's own arithmetic.

import { createAuthority } from '../../packages/capability-broker/src/authority.mjs'
import { openSqliteRouterState } from '../../packages/orchestration/src/sqlite-router-state.mjs'
import { createModelAccounting } from '../../packages/orchestration/src/model-accounting.mjs'
import { createModelBoundResolver } from '../../packages/orchestration/src/model-request-bounds.mjs'
import { createRouterState } from '../../.dsh-plugin/shared/router-state.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const root = resolve(import.meta.dirname, '../../tmp/integration/model-request-bounds')
const NOW = 1_700_000_000_000
const PRICING = Object.freeze({ input: 1, output: 2 })
const CHUNKS = Object.freeze([
  { type: 'text-delta', index: 0, text: 'offline answer' },
  { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  { type: 'finish', reason: { kind: 'stop' } },
])

/**
 * What the offline adapter declares about each exact route. `one` is the normal
 * case; `vendor/two` proves a model id keeps its own namespace; `nodefault`
 * declares a window but no per-request output cap; `wide` declares a window no
 * grant covers; `bare` declares no window at all; `mislabelled` answers as
 * another route, which the installed runtime refuses itself.
 */
export const ROUTES = Object.freeze({
  one: { contextWindow: 4096, defaultMaxTokens: 64 },
  'vendor/two': { contextWindow: 8192, defaultMaxTokens: 32 },
  nodefault: { contextWindow: 4096 },
  wide: { contextWindow: 200000, defaultMaxTokens: 64 },
  bare: {},
  mislabelled: { contextWindow: 4096 },
})

/** The Host-shaped funding policy: a grant of 4096 input and 100 output tokens. */
export const GRANT = Object.freeze({ maxInputTokens: 4096, maxOutputTokens: 100 })

export async function withModelBounds(run, {
  routes = ROUTES, funding = {}, limits = { dailyLimitUsd: 0, monthlyLimitUsd: 0 },
  chunks = CHUNKS, beforeChunk = null, boundsSeam = true, inputBoundFor = null, honorSignal = true, onBounds = null, maxActive = 16, pricing = PRICING, maxOutputTokens = 100, grant = null,
} = {}) {
  await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'case-'))
  const legacyFile = join(home, 'legacy.json')
  const legacy = createRouterState({ file: legacyFile, lockStaleMs: 1 })
  await legacy.appendRun({ id: 'seed', createdAt: NOW, finishedAt: NOW, kind: 'assign', status: 'completed', packages: [], reviews: [] })
  const storageFile = join(home, 'orchestration.sqlite')
  const store = await openSqliteRouterState({ Database, file: storageFile, legacyFile, now: () => NOW })

  // Every route this case's adapter declares is granted, so a case can reach the
  // bounds decision instead of stopping at the route gate.
  const modelRoutes = grant ?? [...Object.keys(routes).map(model => ({ provider: 'alpha', model })), { provider: 'beta', model: 'vendor/two' }]
  const authority = createAuthority({ now: () => NOW })
  const subject = Object.freeze({})
  authority.register(subject, { botId: 'a', tools: ['model/infer'], modelRoutes })

  const ctx = new Context()
  const upstream = []
  class OfflineAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'one', name: 'one' }] }
    async resolveModel(provider, model) {
      const entry = routes[model]
      if (entry === undefined) return { provider, id: model, name: model }
      if (model === 'mislabelled') return { provider: 'beta', id: 'elsewhere', name: 'elsewhere' }
      return { provider, id: model, name: model,
        ...(entry.contextWindow ? { context: { contextWindow: entry.contextWindow } } : {}),
        ...(entry.defaultMaxTokens ? { defaultMaxTokens: entry.defaultMaxTokens } : {}) }
    }
    async *stream(options) {
      upstream.push({ provider: options.provider, model: options.model, maxTokens: options.maxTokens,
        hasSignal: 'signal' in options, frozen: Object.isFrozen(options), sealed: !Object.isExtensible(options) })
      for (const [index, chunk] of chunks.entries()) {
        if (beforeChunk) await beforeChunk(index)
        // An adapter honors the request's own signal, as the SDK contract requires.
        if (honorSignal) options.signal?.throwIfAborted()
        yield chunk
      }
    }
  }
  let llm
  const fork = await ctx.plugin(scope => { llm = new LlmRuntime(scope); llm.registerAdapter(['alpha', 'beta'], new OfflineAdapter()) })
  const resolver = createModelBoundResolver({ llm: () => llm })
  const accounting = createModelAccounting({
    store, authority,
    pricingFor: async ({ botId, provider, model }) => {
      const policy = funding[botId]
      if (policy === null) return null
      return { funding: 'api', route: { provider, model }, pricing, ...GRANT, maxOutputTokens, ...(policy ?? {}) }
    },
    ...(boundsSeam ? { modelBoundsFor: async ({ options: request, signal }) => {
      if (onBounds) await onBounds({ options: request, signal })
      const bounds = await resolver.bounds({ provider: request.provider, model: request.model, signal })
      return { inputBound: bounds.contextWindow, outputDefault: bounds.defaultMaxTokens }
    } } : {}),
    ...(inputBoundFor ? { inputBoundFor } : {}),
    machineId: 'machine-1', workspaceId: 'ws-1', now: () => NOW, limits, maxActive,
  })

  const identity = Object.freeze({ subject, botId: 'a', source: 'bot' })
  const rows = table => {
    assert.ok(['router_model_calls', 'router_runs'].includes(table), 'TEST_TABLE_NOT_ALLOWED')
    const db = new Database(storageFile, { readonly: true })
    try { return db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.payload)) }
    finally { db.close() }
  }
  const harness = {
    ctx, llm, store, authority, subject, accounting, upstream, storageFile, rows,
    /** Money runs this case opened; the seeded legacy run is not one of them. */
    runs: () => rows('router_runs').filter(run => run.id !== 'seed'),
    receipts: async () => (await store.modelCalls({ after: 0, limit: 100 })).items,
    request: (overrides = {}) => ({ provider: 'alpha', model: 'one',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'bounds' }] }], ...overrides }),
    call: async request => {
      const seen = []
      for await (const chunk of accounting.stream(request, () => llm.stream(request), identity)) seen.push(chunk)
      return seen
    },
    revoke: () => authority.revoke(subject),
    dispose: async () => { await accounting.close(); await fork.dispose(); store.close() },
  }
  try { return await run(harness) } finally { await harness.dispose() }
}

export { NOW, PRICING, CHUNKS }
