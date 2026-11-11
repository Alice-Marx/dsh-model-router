import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter, markAgentLoopRequest, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, canonicalHeader } from '@deepseek-ai/dsh-session'

// The causal harness for the integrated AgentLoop's same-generation frame: the real money
// authority over a real SQLite router state, the real principal authority, the installed
// Cordis/LlmRuntime, the installed dsh-session Session the loop logs into, and the real
// accounting. Only the provider transport is offline.
//
// The loop step is a REPLAY of the installed AgentLoop's public seam
// (dsh-agent-loop lib/index.js:1175-1289 prepare/build and :1084 dispatch):
// `llm.prepareCall` -> `session.append('request/header'|'request/context')` ->
// `markAgentLoopRequest(Object.freeze({...}))` -> `prepared.stream(request)`. It is NOT a
// full AgentLoop turn: no agent, no inbox, no tool execution, no prompt assembly, because
// dsh-agent-loop is not installed in this repository (it lives in the DS-Bot app
// checkout). Everything the seam depends on is the real installed code.
//
// Each case asserts what the adapter that actually streamed received, what the ledger
// recorded, and what the store holds — never a restatement of the helper's arithmetic.

import { createAuthority } from '../../packages/capability-broker/src/authority.mjs'
import { openSqliteRouterState } from '../../packages/orchestration/src/sqlite-router-state.mjs'
import { createModelAccounting } from '../../packages/orchestration/src/model-accounting.mjs'
import { createModelFrameStore } from '../../packages/orchestration/src/model-prepared-generation.mjs'
import { createSessionLoopFrameResolver, LOOP_FRAME_VERDICT } from '../../packages/orchestration/src/model-loop-frame.mjs'
import { createRouterState } from '../../.dsh-plugin/shared/router-state.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const root = resolve(import.meta.dirname, '../../tmp/integration/model-loop-frame')
const NOW = 1_700_000_000_000
const PRICING = Object.freeze({ input: 1, output: 2 })
const CHUNKS = Object.freeze([
  { type: 'text-delta', index: 0, text: 'offline answer' },
  { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  { type: 'finish', reason: { kind: 'stop' } },
])

/**
 * The two adapter generations. A is the larger one — a wider window and a wider
 * per-request output cap — and B is the smaller one, so a read that names B while A
 * dispatches is a read that would admit a request A must refuse.
 */
export const GENERATIONS = Object.freeze({
  A: Object.freeze({ contextWindow: 4096, defaultMaxTokens: 64 }),
  B: Object.freeze({ contextWindow: 2000, defaultMaxTokens: 16 }),
})

/** One registration's generation. `prepareCall` binds it to its own dispatch closure. */
class GenerationAdapter extends LlmAdapter {
  constructor(tag, upstream) {
    super()
    this.tag = tag
    this.upstream = upstream
    this.prepared = 0
    this.dispatches = 0
  }
  async listModels(provider) { return [{ provider, id: 'one', name: 'one' }, { provider, id: 'nodefault', name: 'nodefault' }] }
  async resolveModel(provider, model) {
    // `nodefault` declares no per-request output cap, so the SDK materializes none: the
    // shape the NO_ADAPTER fallback (dsh-agent-loop lib/index.js:1084) leaves behind.
    if (model === 'nodefault') return { provider, id: model, name: model, context: { contextWindow: GENERATIONS[this.tag].contextWindow } }
    const generation = GENERATIONS[this.tag]
    return { provider, id: model, name: model,
      context: { contextWindow: generation.contextWindow }, defaultMaxTokens: generation.defaultMaxTokens }
  }
  // A dynamic adapter binds the generation it resolved at prepare time, exactly as the
  // SDK's capture-and-dispatch fence expects (dsh-llm lib/index.js:2224 capture, :2257
  // dispatch through the captured `adapterCall.stream`).
  async prepareCall(provider, model, signal) {
    this.prepared += 1
    const adapter = this
    const model_ = await this.resolveModel(provider, model, signal)
    return { model: model_, stream: options => (async function* () { yield* adapter.emit(options) })() }
  }
  // The unprepared path: the adapter registered at dispatch time answers.
  async *stream(options) { yield* this.emit(options) }
  async *emit(options) {
    this.dispatches += 1
    this.upstream.push({ adapter: this.tag, provider: options.provider, model: options.model, maxTokens: options.maxTokens })
    for (const chunk of CHUNKS) yield chunk
  }
}

/**
 * @param run - the case body, receiving the harness.
 * @param maxInputTokens - the trusted input upper bound the funding declares.
 * @param maxOutputTokens - the priced output allowance.
 * @param frameSource - `'session-loop'` (default) wires the resolver into
 *   `preparedFrameFor` exactly as the parent's glue will; `'read'` keeps today's
 *   registration read, as the control for what the frame changes.
 * @param sessionFor - override the Host session lookup, to model a throwing or
 *   answering-nothing Host. `null` (the default) reads the live session.
 * @param wireLookup - `false` models a Host that never wired the session seam at all.
 * @param rewrite - optional `({ctx, llm}) => disposer` installed BEFORE the accounting
 *   listener, exactly where the frozen ds-bot secret rewrite sits, to model a listener
 *   that rebuilds the request and re-enters `llm.stream`.
 */
export async function withModelLoopFrame(run, {
  maxInputTokens = 4096, maxOutputTokens = 100, frameSource = 'session-loop', sessionFor = null, wireLookup = true, rewrite = null,
  limits = { dailyLimitUsd: 0, monthlyLimitUsd: 0 },
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
  let llm, primaryHandle = null, swapHandle = null
  const fork = await ctx.plugin(scope => {
    llm = new LlmRuntime(scope)
    primaryHandle = llm.registerAdapter(['alpha', 'beta'], new GenerationAdapter('A', upstream))
    if (rewrite) rewrite({ ctx, llm, upstream })
  })

  // The live session the loop logs into: the real installed dsh-session, held in a
  // Host-shaped store so `sessionFor` reads it the way the composition will.
  const session = Session.create(SessionId('loop-frame-session'))
  const sessions = new Map([[session.id, session]])
  const lookup = sessionFor ?? (id => sessions.get(id))

  const fundingFor = async ({ botId, provider, model }) => ({ funding: 'api', route: { provider, model }, pricing: PRICING, maxInputTokens, maxOutputTokens })
  const authority = createAuthority({ now: () => NOW })
  const subjects = {}
  const subjectFor = botId => (subjects[botId] ??= Object.freeze({ botId }))
  const registerBot = (botId, routes_ = [{ provider: 'alpha', model: 'one' }, { provider: 'alpha', model: 'nodefault' }]) => {
    const subject = subjectFor(botId)
    authority.register(subject, { botId, tools: ['model/infer'], modelRoutes: routes_ })
    return subject
  }
  registerBot('a')

  const frames = createModelFrameStore()
  const verdicts = []
  /** Every point read of the current registration the accounting performed. */
  const reads = []
  const resolver = createSessionLoopFrameResolver({ sessionFor: wireLookup ? lookup : null, isLoopRequest: isAgentLoopRequest })
  // The glue the parent will write: the independent path's own frame first, then the
  // session-log frame for an integrated loop step. `aux` keeps the caller's existing
  // path; `unsupportedHost` keeps today's registration read and is recorded so the open
  // gap stays visible; `missing`/`invalid` refuse the funded call instead of pricing a
  // generation that will not dispatch.
  const glue = request => {
    const captured = frames.read(request.signal)
    if (captured) return captured
    const verdict = resolver(request)
    verdicts.push(verdict)
    if (verdict.kind === LOOP_FRAME_VERDICT.FRAME) return verdict.frame
    if (verdict.kind === LOOP_FRAME_VERDICT.AUX) return null
    if (verdict.kind === LOOP_FRAME_VERDICT.UNSUPPORTED_HOST) return null
    const code = verdict.kind === LOOP_FRAME_VERDICT.MISSING ? 'MODEL_LOOP_FRAME_MISSING' : 'MODEL_LOOP_FRAME_INVALID'
    throw Object.assign(new Error(code), { code, reason: verdict.reason, outcome: 'refused' })
  }
  const accounting = createModelAccounting({
    store, authority, pricingFor: fundingFor,
    modelBoundsFor: async ({ options: request, signal }) => {
      // The non-prepared fallback the frame replaces: a point read of the current
      // registration, which names the replaced generation once the route is swapped.
      const info = await llm.resolveModelInfo(request.provider, request.model, signal ?? undefined)
      const bound = { inputBound: info.context?.contextWindow ?? null, outputDefault: info.defaultMaxTokens ?? null }
      reads.push({ provider: request.provider, model: request.model, ...bound })
      return bound
    },
    preparedFrameFor: frameSource === 'session-loop' ? glue : () => null,
    machineId: 'machine-1', workspaceId: 'ws-1', now: () => NOW, limits, maxActive: 16,
  })

  // Trusted test execution carries identity in an async frame, like the Host policy. An
  // AbortSignal is cancellation, never an authentication credential.
  const identities = new AsyncLocalStorage()
  ctx.on('llm/stream', (options, next) => {
    const identity = identities.getStore()
    assert.ok(identity, 'the model call must have an explicit trusted test identity')
    return accounting.stream(options, next, identity)
  })

  const rows = table => {
    assert.ok(['router_model_calls', 'router_runs'].includes(table), 'TEST_TABLE_NOT_ALLOWED')
    const db = new Database(storageFile, { readonly: true })
    try { return db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.payload)) }
    finally { db.close() }
  }
  /** Replace the route's registration with the smaller generation (an HMR-shaped swap). */
  const useSwap = () => { primaryHandle?.(); primaryHandle = null; swapHandle = llm.registerAdapter(['alpha', 'beta'], new GenerationAdapter('B', upstream)) }
  const usePrimary = () => { swapHandle?.(); swapHandle = null; primaryHandle = llm.registerAdapter(['alpha', 'beta'], new GenerationAdapter('A', upstream)) }

  /**
   * One integrated loop step, replayed through the installed AgentLoop's public seam.
   * `gate` runs after the loop has logged its generation and before the one-shot stream
   * dispatches — the window in which a registration can be replaced.
   */
  const loopStep = async (overrides = {}, { gate = null, route = { provider: 'alpha', model: 'one' } } = {}) => {
    const prepared = await llm.prepareCall({ ...route })
    // The installed dsh-session's own canonicalHeader — the exact function
    // dsh-agent-loop lib/index.js:1217-1221 calls before it logs the header.
    const header = canonicalHeader({
      config: prepared.config,
      ...(prepared.adapterDefaults === undefined ? {} : { adapterDefaults: prepared.adapterDefaults }),
    })
    session.append('request/header', { header, reason: 'initial' })
    session.append('request/context', {
      provider: prepared.config.provider, model: prepared.config.model,
      ...(prepared.context?.contextWindow !== undefined ? { contextWindow: prepared.context.contextWindow } : {}),
    })
    const request = markAgentLoopRequest(Object.freeze({
      ...prepared.config,
      messages: Object.freeze([Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: 'loop step' }]) })]),
      toolHistory: session.toolHistory(),
      sessionId: session.id,
      signal: new AbortController().signal,
      ...overrides,
    }))
    if (gate) await gate()
    const chunks = []
    for await (const chunk of await prepared.stream(request)) chunks.push(chunk)
    return { prepared, request, chunks }
  }

  const harness = {
    ctx, llm, store, authority, frames, accounting, upstream, storageFile, session, sessions, resolver, verdicts, reads,
    asBot: (botId, operation) => identities.run({ subject: subjectFor(botId), botId, source: 'bot' }, operation),
    registerBot, subjectFor,
    /** One integrated loop step, admitted and dispatched under a trusted identity. */
    loop: (overrides, options) => harness.asBot('a', () => loopStep(overrides, options)),
    /** The ordinary, unmarked stream: an aux, or a hand-built request. */
    raw: async (request, { botId = 'a' } = {}) => harness.asBot(botId, async () => {
      const seen = []
      for await (const chunk of await llm.stream(request)) seen.push(chunk)
      return seen
    }),
    request: (overrides = {}) => ({ provider: 'alpha', model: 'one',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'aux' }] }], signal: new AbortController().signal, sessionId: session.id, ...overrides }),
    useSwap, usePrimary,
    runs: () => rows('router_runs').filter(run => run.id !== 'seed'),
    receipts: async () => (await store.modelCalls({ after: 0, limit: 100 })).items,
    /** Every durable budget hold the store still carries. */
    holds: async () => Object.keys((await store.read()).budgetReservations ?? {}),
    dispose: async () => { await accounting.close(); await fork.dispose(); store.close() },
  }
  try { return await run(harness) } finally { await harness.dispose() }
}

export { LOOP_FRAME_VERDICT, NOW, PRICING, CHUNKS }
