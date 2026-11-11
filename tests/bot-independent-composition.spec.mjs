import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { startBotProduct, createDiagnosticAccountStream } from '../packages/orchestration/src/product-composition.mjs'
import { createDeferredRouterState } from '../packages/orchestration/src/deferred-router-state.mjs'
import { createPluginRuntime, runtimeSwitchPath } from '../modules/independent-runtime/index.mjs'
import { attachNativeLlm } from './helpers/product-native-llm.mjs'

// The same wiring the plugin performs, end to end, over the real composition.
//
// `startBotProduct` composes the frozen DS runtime with this plugin body: the shared authority, the
// principal directory, the Bot policy, the funding store, the one SQLite money authority and the
// `llm/stream` handler every model call goes through. The independent runtime is then mounted the
// way `.dsh-plugin/bot-product.mjs` connect() mounts it — over the real switch directory and the
// real serving admission — so a turn here is the production path, not a hand-called facade.

const Database = createRequire(import.meta.url)('better-sqlite3')
const SEED = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: 'alpha/one' },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2, model: 'beta/two' },
  },
  rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 2,
})

function makeContext() {
  const services = new Map()
  const disposers = []
  const listeners = new Map()
  const upstream = []
  return {
    services, listeners, upstream,
    state: { beforeRequest: null, chunks: [
      { type: 'text-delta', index: 0, text: 'from the model' },
      { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
    logger: { info() {}, warn() {}, error() {} },
    provide(name, value) { services.set(name, value) },
    get(name) { return services.get(name) },
    on(name, listener) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); return () => {} },
    off() {},
    emit(name, payload) { for (const listener of listeners.get(name) ?? []) if (listener.length < 2) listener(payload) },
    effect(execute) { const dispose = execute(); if (typeof dispose === 'function') disposers.push(dispose) },
    async dispose() { await Promise.allSettled(disposers.splice(0).reverse().map(dispose => dispose())) },
    tools: { register() { return () => {} }, guard() { return () => {} }, schemas: () => [], restrict: () => () => {} },
    systemPrompt: { section() { return () => {} } },
    connection: { fetch: { register() { return () => {} } }, admit: async () => null },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async () => ({ sessionId: 'w' }) },
    sessionController: {
      create: async () => ({ sessionId: 'sess' }), resolveAgent: async () => ({ agent: null }),
      selectModel: async () => ({}), cancel: async () => ({}), prompt: async () => ({}), page: async () => ({ records: [], hasMore: false }),
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, messageProjections: [] },
    llm: {
      listProviders: () => [{ id: 'alpha', name: 'alpha' }, { id: 'beta', name: 'beta' }],
      listModels: async provider => ({ alpha: [{ id: 'one' }, { id: 'three' }], beta: [{ id: 'two' }] })[provider] ?? [],
      resolveModelInfo: async () => ({}),
      // The DSH service shape: the registered listeners run as a waterfall and the base stream
      // answers. Reaching the base stream is what a refusal has to prevent.
      stream(options) {
        const base = async function* base() {
          upstream.push({ provider: options.provider, model: options.model, sessionId: options.sessionId ?? null })
          yield { type: 'text-delta', index: 0, text: 'from the model' }
          yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
        const run = index => {
          const registered = listeners.get('llm/stream') ?? []
          if (index >= registered.length) return base()
          const listener = registered[index]
          const next = () => run(index + 1)
          return listener.length >= 2 ? listener(options, next) : (listener(options), next())
        }
        return run(0)
      },
    },
  }
}

/** One isolated state home, so a boot here can never touch the person's live team or ledger. */
async function withStateHome(run) {
  const scratch = resolve('tmp/integration/bot-independent-composition')
  mkdirSync(scratch, { recursive: true })
  const home = mkdtempSync(join(scratch, 'case-'))
  const previousState = process.env.DSH_STATE_HOME
  const previousHome = process.env.DSH_HOME
  process.env.DSH_STATE_HOME = home
  process.env.DSH_HOME = home
  try {
    // The team is committed before the runtime starts, the way a real team is: the frozen runtime
    // reads it at load, and the lifecycle compiles every Bot's grant from it.
    mkdirSync(join(home, 'bot'), { recursive: true })
    writeFileSync(join(home, 'bot', 'state.json'), JSON.stringify(SEED()))
    return await run(home, join(home, 'model-router', 'orchestration.sqlite'))
  } finally {
    if (previousState === undefined) delete process.env.DSH_STATE_HOME
    else process.env.DSH_STATE_HOME = previousState
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
}

/** Mount the independent runtime exactly as the plugin's connect() does, over the real Host. */
function mountIndependentRuntime(ctx, home) {
  const runtimeDir = runtimeSwitchPath({ settings: {}, stateDir: join(home, 'independent') })
  const runtime = createPluginRuntime({
    ctx,
    settings: {
      enabled: true, dir: runtimeDir, maxSteps: 4,
      remoteInvoke: (botId, tool, args) => ctx.get('botRemoteToolInvoker').invoke(botId, tool, args),
    },
    stateDir: join(home, 'independent'),
    serving: ctx.get('botServing'),
    // The integration path is the Harness itself in a real Host; here it is the seam that proves
    // the dispatch routes a Bot nobody moved to the other runtime instead of answering for it.
    integration: async () => ({ answer: 'from-the-harness' }),
  })
  assert.ok(runtime, 'the independent runtime mounts on the real composition')
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
  return runtime
}

test('the real composition routes by the committed mode and answers an independent turn', async () => {
  await withStateHome(async (home, storageFile) => {
    const ctx = makeContext()
    const releaseLlm = await attachNativeLlm(ctx)
    const deferred=createDeferredRouterState({file:storageFile})
    const composition = startBotProduct(ctx, {
      accountStream: createDiagnosticAccountStream(), storageFile, legacyFile: join(home, 'state.json'), failClosed: false,
      deferredRouterState:deferred,mr:{executeConfiguredAssignment:async()=>({}),rerunRecordedStep:async()=>({}),routerStateStore:()=>deferred.state},
    })
    try {
      const product = await composition.boot
      assert.ok(product, 'the composition boots into a product')
      // The trusted frame the independent loop runs in is published by the product itself.
      const execution = ctx.get('botIndependentExecution')
      assert.ok(execution && typeof execution.complete === 'function', 'the product publishes its own independent execution frame')
      const runtime = mountIndependentRuntime(ctx, home)
      // Nobody moved anything: the committed mode is integration, so the dispatch routes there.
      const routed = await runtime.turn({ botId: 'a', input: 'hello' })
      assert.equal(routed.runtime, 'integration')
      assert.equal(routed.answer, 'from-the-harness')
      assert.deepEqual(ctx.upstream, [], 'the independent provider was not used')
      const dispatch=(action,payload)=>ctx.get('botProductReadModel').dispatch({action,payload},{kind:'owner'})
      let view=await dispatch('binding.inspect',{botId:'a'})
      const account=view.accounts.items.find(item=>item.provider==='alpha')
      await dispatch('funding.account.save',{scopeId:account.id,expectedRevision:account.revision,enabled:true,dailyLimitUsd:10,monthlyLimitUsd:100})
      view=await dispatch('binding.inspect',{botId:'a'})
      const machine=view.record.catalog.machines.find(item=>item.location==='local'),rootId=machine.roots[0].rootId
      await dispatch('binding.save',{botId:'a',expectedRevision:view.record.revision,settings:{...view.record.settings,enabled:true,
        model:{provider:'alpha',model:'one'},capabilities:['model-inference'],
        machineGrants:[{machineId:machine.machineId,rootId,mode:'read-only',capabilities:[]}],workspaceRef:{kind:'local',machineId:machine.machineId,rootId},
        funding:{mode:'api',scopeId:account.id,pricing:{input:1,output:2},request:{maxInputTokens:4096,maxOutputTokens:100},dailyBudgetUsd:1,monthlyBudgetUsd:10,subscription:null}}})
      // Move the Bot, and the same entry now answers on the independent runtime.
      await runtime.move('a', 'independent')
      assert.equal(runtime.describe('a').runtime, 'independent')
      const independent = await runtime.turn({ botId: 'a', input: 'hello' })
      assert.equal(independent.runtime, 'independent')
      assert.equal(independent.answer, 'from the model')
      assert.deepEqual(ctx.upstream.map(row => ({ provider: row.provider, model: row.model, sessionId: row.sessionId ?? null })), [{ provider: 'alpha', model: 'one', sessionId: null }], 'the Bot own committed model reached the provider')
      // A configured production binding uses the actual money authority, not
      // the diagnostic stream's observation list.
      const receiptDb=new Database(storageFile,{readonly:true})
      try{
        const rows=receiptDb.prepare('SELECT payload FROM router_model_calls').all().map(row=>JSON.parse(row.payload))
        assert.deepEqual(rows.map(row=>[row.botId,row.provider,row.model,row.funding,row.state]),[['a','alpha','one','api','settled']])
        assert.equal(receiptDb.prepare('SELECT count(*) AS n FROM router_runs').get().n,1)
      }finally{receiptDb.close()}
      // The Bot that was not moved still answers on the integration path.
      const other = await runtime.turn({ botId: 'b', input: 'hello' })
      assert.equal(other.runtime, 'integration')
      assert.equal(other.answer, 'from-the-harness')
      runtime.close()
    } finally {
      await composition.dispose()
      await releaseLlm()
    }
  })
})

test('the real composition refuses a moved Bot on the integration path instead of answering twice', async () => {
  await withStateHome(async (home, storageFile) => {
    const ctx = makeContext()
    const composition = startBotProduct(ctx, {
      accountStream: createDiagnosticAccountStream(), storageFile, legacyFile: join(home, 'state.json'), failClosed: false,
    })
    try {
      const product = await composition.boot
      const runtime = mountIndependentRuntime(ctx, home)
      await runtime.move('b', 'independent')
      // Bot b's own chat Session: the frozen runtime still lists it, the committed switch says the
      // independent runtime owns it, so the integration stream refuses rather than answering twice.
      await assert.rejects(() => ctx.llm.stream({ sessionId: 'b', provider: 'beta', model: 'two', messages: [] }).next(),
        error => error.code === 'RUNTIME_MODE_MISMATCH')
      assert.deepEqual(ctx.upstream, [], 'nothing reached the base stream')
      // An ordinary Harness session is still an ordinary Harness session.
      const plain = []
      for await (const chunk of ctx.llm.stream({ sessionId: 'plain', provider: 'alpha', model: 'one', messages: [] })) plain.push(chunk)
      assert.equal(plain.length, 3)
      assert.deepEqual(ctx.upstream, [{ provider: 'alpha', model: 'one', sessionId: 'plain' }])
      runtime.close()
    } finally {
      await composition.dispose()
    }
  })
})

test('the real composition refuses an independent turn for a Bot with no committed binding', async () => {
  await withStateHome(async (home, storageFile) => {
    const ctx = makeContext()
    // The one SQLite money authority, for real: a deferred router state the composition resolves.
    const deferredRouterState = createDeferredRouterState({ file: storageFile })
    const composition = startBotProduct(ctx, {
      accountStream: createDiagnosticAccountStream(),
      deferredRouterState, storageFile, legacyFile: join(home, 'state.json'), failClosed: false,
      // The managed Task seam is not exercised here; the composition only requires it to exist.
      mr: { executeConfiguredAssignment: async () => ({}), rerunRecordedStep: async () => ({}), routerStateStore: () => deferredRouterState.state },
    })
    try {
      const product = await composition.boot
      await product.rt.load()
      const runtime = mountIndependentRuntime(ctx, home)
      await runtime.move('a', 'independent')
      await runtime.move('b', 'independent')
      // No binding was saved for either Bot, so neither has a funded, granted route. The refusals
      // are exact rather than a single catch-all: the ordinary Bot holds no model route at all, and
      // Main retains every permission, but its default execution configuration is still missing.
      await assert.rejects(() => runtime.turn({ botId: 'b', input: 'hello' }), error => error.code === 'MODEL_DENIED')
      await assert.rejects(() => runtime.turn({ botId: 'a', input: 'hello' }), error => error.code === 'BOT_BINDING_UNAVAILABLE')
      assert.deepEqual(ctx.upstream, [], 'zero upstream')
      // And the real ledger holds no receipt for either.
      const db = new Database(storageFile, { readonly: true })
      try {
        assert.equal(db.prepare('SELECT count(*) AS n FROM router_model_calls').get().n, 0, 'nothing was admitted')
        assert.equal(db.prepare('SELECT count(*) AS n FROM router_runs').get().n, 0, 'and no run was opened')
      } finally { db.close() }
      runtime.close()
    } finally {
      await composition.dispose()
    }
  })
})
