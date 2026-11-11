import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// The real Host chain for the serving fence, offline.
//
// What runs here is the product's own entry: `createBotProduct` installs the `llm/stream` handler
// that every model call in a real Host goes through, over the real principal directory, the real
// Bot policy, the real lifecycle with committed ownership, and the real thread host. Only DSH's
// own services are fixtures.
//
// The pinned vendor runtime is read as source and bundled here, exactly as
// tests/bot-thread-host.native.mjs does it, so this tree gains no importer of the vendored tree.

const root = resolve(import.meta.dirname, '..', '..')
const scratch = resolve(root, 'tmp/integration/bot-serving')
// The bundle sits one directory deeper than the scratch root, because the vendored update and
// diagnostics modules read their own manifest two levels up; the pinned version stands in for it.
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
// The production mode reader: which runtime serves a Bot, read back from committed state.
const { runtimeModeOf } = await import('../../.dsh-plugin/bot-product.mjs')

export const MODEL = 'deepseek/deepseek-chat'
let sessionsMade = 0

export const grantFor = bot => ({
  tools: ['tool/model_router', 'model/infer'],
  modelRoutes: typeof bot?.model === 'string' && bot.model.includes('/') ? [{ provider: bot.model.split('/')[0], model: bot.model.split('/')[1] }] : [],
})

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

/**
 * One boot of the real product over a seeded team.
 *
 * `stream(options)` runs the DSH waterfall over the handlers the product actually installed, so a
 * test exercises the entry a real Host uses rather than a gate called by hand. `upstream` records
 * every call that reached the base stream, which is what "refused before the upstream call" means.
 *
 * `sharedServing` reproduces the production construction order: the admission is published before
 * the runtime exists, so the product has to bind the runtime to it rather than build its own.
 * `switchFile` reproduces a Host with no adapter but a persisted switch on disk.
 */
export async function bootServingHost(t, { seed, modeOf = null, accountStream = null, sharedServing = null, switchFile = null } = {}) {
  const home = await mkdtemp(join(bundleDir, 'home-'))
  await writeFile(join(home, 'state.json'), JSON.stringify(seed))
  const upstream = []
  const chunks = [
    { type: 'text-delta', index: 0, text: 'one' },
    { type: 'text-delta', index: 1, text: 'two' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const state = { beforeChunk: null }
  const ctx = fakeContext()
  const agents = new Map()
  const agentOf = sessionId => {
    if (!agents.has(sessionId)) {
      const calls = []
      agents.set(sessionId, {
        // The runtime asks an Agent for its own scope; the Host hands back the tools surface.
        ctx: { get: name => (name === 'tools' ? { restrict: () => () => {} } : undefined) },
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
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}), stream: options => runStream(options) },
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
      upstream.push(options.sessionId ?? null)
      for (let index = 0; index < chunks.length; index += 1) {
        if (state.beforeChunk) await state.beforeChunk(index)
        yield chunks[index]
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
  const policy = createBotPolicy({ authority, directory, machineId: 'machine-1', workspaceId: 'ws-1' })
  const accounting = accountStream ?? ((options, next) => next())
  // The production order: the admission is published first, with the production mode reader, and
  // the runtime is composed after it — so the product has to bind the runtime to the shared object
  // exactly as the plugin does. A fixture that built its own admission afterwards would prove
  // nothing about the real construction order.
  ctx.provide('botServing', sharedServing ?? createBotServing({ modeOf: modeOf ?? runtimeModeOf(ctx) }))
  if (typeof switchFile === 'string' && switchFile) ctx.provide('botRuntimeSwitchFile', switchFile)
  const product = createBotProduct(ctx, {
    authority, directory, policy, grantFor, accountStream: accounting,
    runtimeConfig: { home, github: false, diagnosticsFile: false },
    ...(modeOf ? { modeOf } : {}),
  })
  await product.rt.load()
  const threads = createBotThreadHost({
    rt: product.rt, lifecycle: product.lifecycle, authority, directory,
    file: join(home, 'bot-threads.json'), now: () => 1_700_000_000_000,
  })
  ctx.provide('botThreads', threads)

  // One full pass over the product's own handler. A caller that stops early still closes the
  // generator, which is the path a cancelled turn takes.
  const stream = async (options, collect = true) => {
    const seen = []
    for await (const chunk of ctx.llm.stream(options)) if (collect) seen.push(chunk)
    return seen
  }
  t.after(async () => { await ctx.dispose().catch(() => {}); threads.close() })
  return { ctx, rt: product.rt, lifecycle: product.lifecycle, authority, directory, policy, product, threads, host, agents, agentOf, upstream, chunks, state, stream, home }
}

export const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: MODEL },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2, model: MODEL },
  },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})
