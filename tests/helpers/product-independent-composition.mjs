import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { startBotProduct, createDiagnosticAccountStream } from '../../packages/orchestration/src/product-composition.mjs'
import { createDeferredRouterState } from '../../packages/orchestration/src/deferred-router-state.mjs'
import { createPluginRuntime, runtimeSwitchPath } from '../../modules/independent-runtime/index.mjs'
import { attachNativeLlm, offlineModelInfo } from './product-native-llm.mjs'
import { createIndependentConversationReader } from '../../packages/orchestration/src/independent-chat-page.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const root = resolve(import.meta.dirname, '../../tmp/integration/independent-product')
const team = () => ({ version: 1, mainBotIds: ['a'], bots: {
  a: { id: 'a', name: 'Chief', role: 'Research', sessionId: 'a', model: 'alpha/one', createdAt: 1 },
  b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', model: 'beta/vendor/two', createdAt: 2 },
}, rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 2 })

export function productContext() {
  const services = new Map(), listeners = new Map(), disposers = [], upstream = []
  const state = { chunks: [
    { type: 'text-delta', index: 0, text: 'model answer' },
    { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ], beforeRequest: null }
  const ctx = {
    services, listeners, state, upstream,
    logger: { info() {}, warn() {}, error() {} },
    provide: (name, value) => services.set(name, value), get: name => services.get(name),
    on(name, listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener])
      return () => listeners.set(name, (listeners.get(name) ?? []).filter(item => item !== listener))
    },
    off(name, listener) { listeners.set(name, (listeners.get(name) ?? []).filter(item => item !== listener)) },
    emit(name, value) { for (const listener of listeners.get(name) ?? []) if (listener.length < 2) listener(value) },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    dispose: async () => Promise.allSettled(disposers.splice(0).reverse().map(fn => fn())),
    tools: { register() { return () => {} }, guard() { return () => {} }, schemas: () => [], restrict: () => () => {} },
    systemPrompt: { section() { return () => {} } },
    connection: { fetch: { register() { return () => {} } }, admit: async () => null },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async () => ({ sessionId: 'workspace' }) },
    sessionController: { create: async () => ({ sessionId: 'new-session' }), resolveAgent: async () => ({ agent: null }),
      selectModel: async () => ({}), cancel: async () => ({}), prompt: async () => ({}), page: async () => ({ records: [], hasMore: false }) },
    sessionTitle: { rename: async () => {} }, sessions: { flush: async () => {}, messageProjections: [] },
    llm: {
      listProviders: () => [{ id: 'alpha' }, { id: 'beta' }],
      listModels: async provider => provider === 'alpha' ? [{ id: 'one' }] : [{ id: 'vendor/two' }],
      // The same exact-route metadata the installed SDK's offline adapter
      // declares: the admission prices a request against it, so the stub answers
      // with a real window and a real per-request cap instead of an empty object.
      resolveModelInfo: async (provider, model) => offlineModelInfo(provider, model),
      stream(options) {
        const base = async function* () {
          await state.beforeRequest?.(options)
          upstream.push(structuredClone({ provider: options.provider, model: options.model, messages: options.messages, tools: options.tools }))
          for (const chunk of state.chunks) yield chunk
        }
        const run = index => {
          const listener = (listeners.get('llm/stream') ?? [])[index]
          if (!listener) return base()
          return listener(options, () => run(index + 1))
        }
        return run(0)
      },
    },
  }
  return ctx
}

export async function withProductIndependent(run, { beforeBoot, beforeProduct, nativeLlm = true, runtimeSettings = {}, runtimeConfig, productConfig = {}, productModules = {}, conversationEngines = [], officialTools } = {}) {
  // Packaging probes use the extracted artifact's real runtime modules with
  // this same offline owner/SDK harness, so checkout imports cannot mask a
  // missing or stale production dependency in the archive.
  const { startBotProduct: startProduct = startBotProduct,
    createDiagnosticAccountStream: diagnosticStream = createDiagnosticAccountStream,
    createDeferredRouterState: deferredState = createDeferredRouterState,
    createPluginRuntime: pluginRuntime = createPluginRuntime,
    runtimeSwitchPath: switchPath = runtimeSwitchPath,
    createIndependentConversationReader: conversationReader = createIndependentConversationReader } = productModules
  await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'case-'))
  const previous = { DSH_HOME: process.env.DSH_HOME, DSH_STATE_HOME: process.env.DSH_STATE_HOME }
  process.env.DSH_HOME = home; process.env.DSH_STATE_HOME = home
  let composition, runtime, releaseLlm, releaseBeforeProduct
  const ctx = productContext()
  try {
    if (nativeLlm) releaseLlm = await attachNativeLlm(ctx)
    if (beforeProduct) releaseBeforeProduct = await beforeProduct({ ctx, home })
    await mkdir(join(home, 'bot'), { recursive: true })
    await writeFile(join(home, 'bot/state.json'), JSON.stringify(team()))
    const storageFile = join(home, 'model-router/orchestration.sqlite')
    const deferred = deferredState({ file: storageFile })
    composition = startProduct(ctx, { machineId: 'local-fixture', workspaceId: 'default',
      accountStream: diagnosticStream(), deferredRouterState: deferred, storageFile, conversationEngines, officialTools, runtimeConfig, config: productConfig,
      legacyFile: join(home, 'legacy.json'), failClosed: false,
      mr: { executeConfiguredAssignment: async () => ({}), rerunRecordedStep: async () => ({}), routerStateStore: () => deferred.state },
    })
    const dir = switchPath({ settings: {}, stateDir: join(home, 'independent') })
    const mount = () => {
      runtime = pluginRuntime({ ctx, settings: { ...runtimeSettings, enabled: true, dir }, stateDir: join(home, 'independent'),
        serving: ctx.get('botServing'), integration: async () => ({ answer: 'integrated' }) })
      ctx.provide('botRuntimeAdapter', { turn: request => runtime.turn(request),
        workThreadTurn: request => runtime.workThreadTurn(request),
        workThreadRead: (...args) => runtime.workThreadRead(...args),
        captureTeamOrigin: request => runtime.captureTeamOrigin(request),
        teamOriginCurrent: (...args) => runtime.teamOriginCurrent(...args),
        resumeTeamTurn: request => runtime.resumeTeamTurn(request),
        contextOf: botId => runtime.contextOf?.(botId) ?? null,
        newConversation: (botId, options) => runtime.newConversation(botId, options),
        reconcileConversation: (botId, options) => runtime.reconcileConversation(botId, options),
        conversationPage: conversationReader({ dir }),
        modeOf: botId => runtime.describe(botId)?.runtime ?? null, busyBots: () => runtime.busyBots() })
      ctx.provide('botRuntimeSwitchFile', join(dir, 'runtime-switch.json'))
    }
    if (beforeBoot) { mount(); await beforeBoot({ ctx, runtime }) }
    const product = await composition.boot
    if (!runtime) mount()
    const readModel = ctx.get('botProductReadModel')
    const dispatch = (action, payload) => readModel.dispatch({ action, payload }, { kind: 'owner' })
    const readRows = table => {
      if (!['router_model_calls', 'router_runs'].includes(table)) throw new Error('TEST_TABLE_NOT_ALLOWED')
      const db = new Database(storageFile, { readonly: true })
      try { return db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.payload)) }
      finally { db.close() }
    }
    const bind = async (botId, provider, model) => {
      let view = await dispatch('binding.inspect', { botId })
      const scope = view.accounts.items.find(account => account.provider === provider)
      await dispatch('funding.account.save', { scopeId: scope.id, expectedRevision: scope.revision, enabled: true, dailyLimitUsd: 10, monthlyLimitUsd: 100 })
      view = await dispatch('binding.inspect', { botId })
      const machine = view.record.catalog.machines.find(item => item.location === 'local')
      const rootId = machine.roots[0].rootId
      const fundingMode = view.record.catalog.models.find(item => item.provider === provider && item.model === model)?.fundingModes?.[0] ?? 'api'
      const settings = { ...view.record.settings, enabled: true, model: { provider, model },
        capabilities: ['model-inference'], machineGrants: [{ machineId: machine.machineId, rootId, mode: 'read-only', capabilities: [] }],
        workspaceRef: { kind: 'local', machineId: machine.machineId, rootId },
        funding: fundingMode === 'subscription' ? { mode: 'subscription', scopeId: scope.id, pricing: null, request: null,
          dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: { dailyCalls: 10, monthlyCalls: 100 } } : { mode: 'api', scopeId: scope.id, pricing: { input: 1, output: 2 },
          request: { maxInputTokens: 4096, maxOutputTokens: 100 }, dailyBudgetUsd: 1, monthlyBudgetUsd: 10, subscription: null } }
      const saved = await dispatch('binding.save', { botId, expectedRevision: view.record.revision, settings })
      return saved
    }
    return await run({ ctx, product, composition, runtime, bind, dispatch, storageFile, readRows, home, runtimeDir: dir })
  } finally {
    runtime?.close()
    await releaseBeforeProduct?.()
    await composition?.dispose()
    await ctx.dispose()
    await releaseLlm?.()
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
}
