import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The composition is the only place that assembles the thread host and the web
// panel store. Both are optional surfaces: a Host without the thread overlay
// reports `ready === false`, and a Host without a SQLite file still has to
// boot. This spec starts the real composition against an isolated state
// directory, so a wiring mistake surfaces as a boot failure rather than as a
// surface that looks wired and is not.

const { startBotProduct } = await import('../packages/orchestration/src/product-composition.mjs')

const accountStream = async (options, next) => next(options)

function makeContext(provided = {}) {
  const services = new Map(Object.entries(provided))
  const disposers = []
  const listeners = new Map()
  return {
    logger: { info() {}, warn() {}, error() {} },
    provide(name, value) { services.set(name, value) },
    get(name) { return services.get(name) },
    on(name, listener) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); return () => {} },
    off() {},
    emit(name, payload) { for (const listener of listeners.get(name) ?? []) listener(payload) },
    // The Host's effect scope: a disposer runs when the effect is torn down.
    effect(execute) { const dispose = execute(); if (typeof dispose === 'function') disposers.push(dispose) },
    async dispose() { await Promise.allSettled(disposers.splice(0).reverse().map(dispose => dispose())) },
    // The tools surface the DS Bot runtime installs its guard and schemas on.
    tools: { register() { return () => {} }, guard() { return () => {} }, schemas: () => [] },
    systemPrompt: { section() { return () => {} } },
    connection: { fetch: { register() { return () => {} } }, admit: async () => null },
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
  }
}

async function withStateHome(run) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-boot-'))
  const previousState = process.env.DSH_STATE_HOME
  const previousHome = process.env.DSH_HOME
  // DS Bot resolves its own team directory from DSH_HOME. The composition must
  // never open the person's live team: the spec points it at an isolated
  // directory so a boot here cannot take the lock the real desktop holds.
  process.env.DSH_STATE_HOME = home
  process.env.DSH_HOME = home
  try {
    return await run(join(home, 'model-router', 'orchestration.sqlite'))
  } finally {
    if (previousState === undefined) delete process.env.DSH_STATE_HOME
    else process.env.DSH_STATE_HOME = previousState
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
}

test('the composition boots with the thread host and the web panel store', async () => {
  await withStateHome(async storageFile => {
    const ctx = makeContext()
    const composition = startBotProduct(ctx, { accountStream, storageFile, failClosed: false })
    try {
      // `boot` is the async half: it creates the runtime, the thread host and
      // the panel store, then publishes the read model.
      const product = await composition.boot
      assert.ok(product, 'the composition boots into a product')
      const readModel = ctx.get('botProductReadModel')
      assert.ok(readModel, 'the composition publishes its read model')

      const snapshot = await readModel.snapshot()
      assert.ok(snapshot, 'the read model answers with a projection')

      // The pinned page section is always present. Without the store it must
      // say why instead of looking like an empty list.
      const webPanels = snapshot.webPanels
      assert.ok(webPanels, 'the pinned page section is always present in the projection')
      assert.ok(['available', 'blocked'].includes(webPanels.status), 'the section reports one of its two honest states')
      if (webPanels.status === 'blocked') {
        assert.ok(webPanels.reason && webPanels.reason.length > 0, 'a blocked section states its reason')
        assert.ok(webPanels.nextAction && webPanels.nextAction.length > 0, 'a blocked section states the next action')
      }

      const threads = snapshot.threads
      assert.equal(threads.status, 'available', 'the bundled overlay must expose its real thread service')
      assert.deepEqual(threads.items, [])
      for (const name of ['readModel', 'list', 'create', 'rename', 'switch', 'open', 'archive', 'unarchive', 'ensure', 'recover', 'reconcile']) {
        assert.ok(snapshot.availableActions.includes(`threads.${name}`), `threads.${name} is callable after boot`)
      }
      // Exercise the installed handler, not just an advertised action name.
      const projection = await readModel.dispatch({ action: 'threads.readModel', payload: { botId: 'absent-bot' } }, { kind: 'owner' })
      assert.equal(projection.status, 'blocked')
      assert.deepEqual(await readModel.dispatch({ action: 'threads.list', payload: { botId: 'absent-bot' } }, { kind: 'owner' }), { botId: 'absent-bot', activeThreadId: null, threads: [] })
      await assert.rejects(readModel.dispatch({ action: 'threads.create', payload: { botId: 'absent-bot' } }, { kind: 'owner' }), { code: 'BOT_NOT_COMMITTED' })
      await assert.rejects(readModel.dispatch({ action: 'threads.reconcile', payload: {} }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
      const reconciled = await readModel.dispatch({ action: 'threads.reconcile', payload: {} }, { kind: 'owner' })
      assert.ok(reconciled, 'the owner reaches the real thread reconciliation service')
    } finally {
      await composition.dispose()
    }
  })
})

test('the composition boots, then tears the new stores down without throwing', async () => {
  await withStateHome(async storageFile => {
    const ctx = makeContext()
    const composition = startBotProduct(ctx, { accountStream, storageFile, failClosed: false })
    await composition.boot
    // Disposing twice must stay quiet: the teardown list closes the panel store
    // and the thread catalog, and a second pass must not reach into a closed
    // handle.
    await composition.dispose()
    await composition.dispose()
  })
})
