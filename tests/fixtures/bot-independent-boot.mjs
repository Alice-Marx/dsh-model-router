import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

// The real Host chain for the independent runtime, offline.
//
// What runs here is the product's own entry: `createBotProduct` installs the `llm/stream` handler
// that every model call in a real Host goes through, over the real principal directory, the real
// Bot policy, the real lifecycle with committed ownership, and the real thread host. The
// independent runtime is mounted the way the plugin mounts it — `createPluginRuntime` over
// `createIndependentRuntime` — and the one money authority is the real `createModelAccounting`
// over a real SQLite router state in this case's own directory. Only DSH's own services are
// fixtures.
//
// The pinned vendor runtime is read as source and bundled here, exactly as
// tests/bot-thread-host.native.mjs and tests/fixtures/bot-serving-boot.mjs do it, so this tree
// gains no importer of the vendored tree.

const root = resolve(import.meta.dirname, '..', '..')
const scratch = resolve(root, 'tmp/integration/bot-independent')
await mkdir(resolve(scratch, 'native'), { recursive: true })
await writeFile(resolve(scratch, 'package.json'), `${JSON.stringify({ name: 'ds-bot', version: '0.2.7' })}\n`)
const bundleDir = await mkdtemp(join(scratch, 'native', 'case-'))
const bundleFile = join(bundleDir, 'ds-bot-runtime.mjs')
const bundle = await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'modules/bot-runtime/vendor/ds-bot/index.js')],
  bundle: true, platform: 'node', format: 'esm', outfile: bundleFile,
  external: ['@deepseek-ai/*', 'deep-view/*', 'playwright', 'playwright-core'],
  logLevel: 'silent',
})
assert.equal(bundle.errors.length, 0, 'the patched vendored runtime bundles')
const { createRuntime } = await import(pathToFileURL(bundleFile).href)

const { createBotProduct } = await import('../../modules/bot-runtime/index.mjs')
const { createPrincipalDirectory } = await import('../../packages/orchestration/src/principals.mjs')
const { createBotPolicy } = await import('../../packages/orchestration/src/bot-policy.mjs')
const { createAuthority } = await import('../../packages/capability-broker/src/authority.mjs')
const { attachDsLifecycle } = await import('../../packages/orchestration/src/ds-lifecycle.mjs')
const { createBotThreadHost } = await import('../../packages/orchestration/src/bot-thread-host.mjs')
const { createBotServing } = await import('../../packages/orchestration/src/bot-serving.mjs')
const { runtimeModeOf } = await import('../../.dsh-plugin/bot-product.mjs')
const { createPluginRuntime } = await import('../../modules/independent-runtime/index.mjs')
const { createModelAccounting } = await import('../../packages/orchestration/src/model-accounting.mjs')
const { openSqliteRouterState } = await import('../../packages/orchestration/src/sqlite-router-state.mjs')
const { createRouterState } = await import('../../.dsh-plugin/shared/router-state.mjs')
const Database = createRequire(import.meta.url)('better-sqlite3')

export const NOW = 1_700_000_000_000
// The receipt vocabulary the durable schema keeps; the composition maps descriptive origins onto
// it, and an unmapped origin is passed through rather than invented.
const RECEIPT_SOURCE = Object.freeze({ 'bot-session': 'bot', 'bot-auxiliary': 'aux' })
export const PRICING = Object.freeze({ input: 0.002, output: 0.004 })

let sessionsMade = 0

/** A grant per Bot: the saved model route, unless a case withholds it on purpose. */
export const grantFor = (bot, options = {}) => {
  // The same first-slash split the product uses: a model remainder may carry a namespace of its own.
  const saved = typeof bot?.model === 'string' ? bot.model : ''
  const at = saved.indexOf('/')
  const route = at > 0 && at < saved.length - 1 ? { provider: saved.slice(0, at), model: saved.slice(at + 1) } : null
  return {
    tools: ['tool/model_router', 'model/infer'],
    modelRoutes: options.denyModel || !route ? [] : [route],
  }
}

/** A stand-in for the plugin context that records what apply() registers. */
function fakeContext() {
  const services = new Map()
  const disposers = []
  const listeners = new Map()
  return {
    services, listeners,
    logger: { warn() {}, info() {} },
    get: name => services.get(name),
    provide(name, value) { services.set(name, value) },
    on(name, listener) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); return () => {} },
    emit(name, payload) { for (const listener of listeners.get(name) ?? []) if (listener.length < 2) listener(payload) },
    effect(execute) { const dispose = execute(); if (typeof dispose === 'function') disposers.push(dispose) },
    async dispose() { return Promise.allSettled(disposers.splice(0).reverse().map(dispose => dispose())) },
    tools: { register() { return () => {} }, guard() { return () => {} }, schemas: () => [], restrict: () => () => {} },
    systemPrompt: { section() { return () => {} } },
    connection: { fetch: { register() { return () => {} } } },
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
  }
}

/** The Host's own stream vocabulary: text, usage and a terminal finish. */
export const textChunks = (text = 'one two', usage = { inputTokens: 12, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }) => [
  { type: 'text-delta', index: 0, text },
  ...(usage ? [{ type: 'usage', usage }] : []),
  { type: 'finish', reason: { kind: 'stop' } },
]

/**
 * One boot of the real product over a seeded team, with the independent runtime mounted on it.
 *
 * `stream(options)` runs the DSH waterfall over the handlers the product actually installed, so a
 * test exercises the entry a real Host uses rather than a gate called by hand. `upstream` records
 * every call that reached the base stream, which is what "refused before the upstream call" means.
 *
 * `funding` is the per-Bot binding the one money authority prices from; a Bot without one is
 * refused by that authority instead of being answered for free.
 */
export async function bootIndependentHost(t, {
  seed, chunks = textChunks(), funding = {}, denyModel = false, ownerRoutes = [], accountStream = null, runtimeSettings = {},
} = {}) {
  const home = await mkdtemp(join(bundleDir, 'home-'))
  await writeFile(join(home, 'state.json'), JSON.stringify(seed))
  const moneyDir = await mkdtemp(join(scratch, 'money-'))
  const legacyFile = join(moneyDir, 'state.json')
  const legacy = createRouterState({ file: legacyFile, lockStaleMs: 1 })
  await legacy.appendRun({ id: 'seed', createdAt: NOW, finishedAt: NOW, kind: 'assign', status: 'completed', packages: [], reviews: [] })
  const store = await openSqliteRouterState({ Database, file: join(moneyDir, 'orchestration.sqlite'), legacyFile, now: () => NOW })
  const upstream = []
  const state = { beforeChunk: null, chunks }
  const ctx = fakeContext()
  const agents = new Map()
  const agentOf = sessionId => {
    if (!agents.has(sessionId)) {
      const calls = []
      agents.set(sessionId, {
        ctx: {
          // The runtime asks an Agent for its own scope; the Host hands back the tools surface.
          get: name => (name === 'tools' ? { restrict: () => () => {} } : undefined),
          effect: () => () => {},
          on: () => () => {},
          provide() {},
          logger: { warn() {}, info() {} },
        },
        session: { id: sessionId, requestHeader: () => undefined, deriveMessages: () => [] },
        id: sessionId, calls, status: 'idle',
        followup(message) { calls.push(['followup', message]) },
        steer(message) { calls.push(['steer', message]) },
        inject(message) { calls.push(['inject', message]) },
        cancel(cause) { calls.push(['cancel', cause]) },
        async whenIdle() {},
        async runMaintenance(fn) { return fn(AbortSignal.timeout(60_000)) },
        inbox: { nextStep: [], nextTurn: [], remove: () => false },
      })
    }
    return agents.get(sessionId)
  }
  const host = { created: [], prompts: [], cancelled: [], selected: [] }
  Object.assign(ctx, {
    llm: {
      // The model service as DSH serves it: a provider list and each provider's models, so the
      // runtime's own catalog can resolve a Bot's saved model and a model change.
      listProviders: () => [{ id: 'alpha', name: 'alpha' }, { id: 'beta', name: 'beta' }],
      listModels: async provider => ({ alpha: [{ id: 'one' }, { id: 'three' }], beta: [{ id: 'two' }] })[provider] ?? [],
      resolveModelInfo: async () => ({}),
      stream: options => runStream(options),
    },
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async () => ({ sessionId: `w-${++sessionsMade}` }),
      archiveSession: async sessionId => { host.cancelled.push(['archive', sessionId]) },
    },
    sessionController: {
      create: async request => { const sessionId = `sess-${++sessionsMade}`; host.created.push({ sessionId, ...request }); return { sessionId } },
      resolveAgent: async sessionId => ({ agent: agentOf(sessionId) }),
      selectModel: async request => { host.selected.push(request); return { selected: { provider: request.provider, model: request.model } } },
      cancel: async request => { host.cancelled.push(['cancel', request.sessionId]); return {} },
      prompt: async request => { host.prompts.push(request); return {} },
      page: async () => ({ records: [], hasMore: false }),
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, messageProjections: [] },
  })

  // The DSH service shape: the registered llm/stream listeners run as a waterfall, and the base
  // stream answers. Reaching the base stream is the thing a refusal has to prevent.
  const runStream = options => {
    const listeners = ctx.listeners.get('llm/stream') ?? []
    const base = async function* base() {
      upstream.push({ sessionId: options.sessionId ?? null, provider: options.provider, model: options.model, tools: options.tools ?? null, messages: options.messages })
      // Read per call: a case that changes what the provider answers between steps swaps the list.
      for (let index = 0; index < state.chunks.length; index += 1) {
        if (state.beforeChunk) await state.beforeChunk(index)
        yield state.chunks[index]
      }
    }
    const run = index => {
      if (index >= listeners.length) return base()
      const listener = listeners[index]
      const next = () => run(index + 1)
      return listener.length >= 2 ? listener(options, next) : (listener(options), next())
    }
    return run(0)
  }

  const authority = createAuthority({ now: () => 0 })
  const directory = createPrincipalDirectory(authority)
  const policy = createBotPolicy({ authority, directory, machineId: 'machine-1', workspaceId: 'ws-1', ownerGrant: { tools: ['remote/product.list', 'model/infer'], modelRoutes: ownerRoutes } })
  // The one money authority: a real admission, a real receipt, a real SQLite row.
  const modelAccounting = createModelAccounting({
    store, authority,
    pricingFor: async ({ botId, provider, model }) => {
      const binding = funding[botId]
      if (!binding) return null
      return { funding: 'api', route: { provider, model }, pricing: PRICING, maxInputTokens: 100_000, maxOutputTokens: 4_096, ...binding }
    },
    inputBoundFor: async ({ config }) => config.maxInputTokens,
    machineId: 'machine-1', workspaceId: 'ws-1', now: () => NOW,
    limits: { dailyLimitUsd: 0, monthlyLimitUsd: 0 },
  })
  // The composition's own shape: enrich with the subject's Bot, then hand the call to the unified
  // admission. A turn inside an admitted run would bind to that run's invoice; an independent
  // session turn has no such run, so it opens its own.
  const accounting = accountStream ?? ((options, next, meta) => {
    const enriched = meta?.subject ? { ...meta, botId: authority.describe(meta.subject).botId } : meta
    return modelAccounting.stream(options, next, { ...enriched, source: RECEIPT_SOURCE[enriched?.source] ?? enriched?.source })
  })
  // The production order: the admission is published first, with the production mode reader, and
  // the runtime is composed after it — so the product has to bind the runtime to the shared object
  // exactly as the plugin does.
  ctx.provide('botServing', createBotServing({ modeOf: runtimeModeOf(ctx) }))
  const product = createBotProduct(ctx, {
    authority, directory, policy, grantFor: bot => grantFor(bot, { denyModel }), accountStream: accounting,
    runtimeConfig: { home, github: false, diagnosticsFile: false },
  })
  await product.rt.load()
  const threads = createBotThreadHost({
    rt: product.rt, lifecycle: product.lifecycle, authority, directory,
    file: join(home, 'bot-threads.json'), now: () => NOW,
    // Which runtime serves a Bot, read back from committed state: a moved Bot gains no Host
    // Session here, and the catalog says so instead of inventing one.
    runtimeMode: botId => product.serving.readMode(botId),
  })
  ctx.provide('botThreads', threads)
  // The plugin's own mount: the real entry, over the real switch directory and the real admission.
  const runtimeDir = join(home, 'independent-runtime')
  const runtime = createPluginRuntime({
    ctx,
    settings: { enabled: true, dir: runtimeDir, maxSteps: 6, ...runtimeSettings },
    stateDir: home,
    serving: product.serving,
    // The integration path is the Harness itself in a real Host; here it is the seam that proves
    // the dispatch routes a Bot nobody moved to the other runtime instead of answering for it.
    integration: async () => ({ answer: 'from-the-harness' }),
  })
  assert.ok(runtime, 'the independent runtime mounts on the real product')
  // What the plugin publishes once the runtime exists: the adapter, and where the committed mode
  // lives. Both are read back on every admission, so a moved Bot is served and an unmoved one is
  // not.
  ctx.provide('botRuntimeAdapter', {
    list: async () => runtime.inventory(runtime.list().map(row => row.botId)).map(row => ({ botId: row.botId, mode: row.runtime, changedAt: row.updatedAt ?? null, turns: row.turns, messages: row.messages })),
    move: (botId, mode) => runtime.move(botId, mode),
    history: (botId, options) => runtime.history(botId, options),
    readMessage: (botId, index) => runtime.readMessage(botId, index),
    describe: botId => runtime.describe(botId),
    modeOf: botId => runtime.describe(botId)?.runtime ?? null,
    busyBots: () => runtime.busyBots(),
  })
  ctx.provide('botRuntimeSwitchFile', join(runtimeDir, 'runtime-switch.json'))

  // One full pass over the product's own handler. A caller that stops early still closes the
  // generator, which is the path a cancelled turn takes.
  const stream = async (options, collect = true) => {
    const seen = []
    for await (const chunk of ctx.llm.stream(options)) if (collect) seen.push(chunk)
    return seen
  }
  // The raw waterfall entry, for a caller that iterates the stream itself inside a policy frame.
  const rawStream = options => ctx.llm.stream(options)
  const receipts = async botId => (await store.modelCalls({ ...(botId ? { botId } : {}), after: 0, limit: 100 })).items
  t.after(async () => {
    runtime.close()
    await ctx.dispose().catch(() => {})
    threads.close()
    try { store.close() } catch { /* already closed */ }
  })
  return {
    ctx, rt: product.rt, lifecycle: product.lifecycle, authority, directory, policy, product, threads,
    host, agents, agentOf, upstream, chunks, state, stream, rawStream, home, runtime, serving: product.serving,
    money: { store, modelAccounting, receipts },
    turn: (botId, input, signal) => runtime.turn({ botId, input, ...(signal ? { signal } : {}) }),
    move: (botId, mode) => runtime.move(botId, mode),
    transcript: botId => {
      const rows = runtime.history(botId, { limit: 50, previewChars: 0 })
      return rows.map((row, at) => {
        const full = runtime.readMessage(botId, rows.length - 1 - at)
        return { ...row, ...full, content: full.content }
      })
    },
  }
}

export const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: 'alpha/one' },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2, model: 'beta/two' },
  },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})
