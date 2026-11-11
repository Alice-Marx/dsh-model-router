import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bootServingHost, grantFor, seed } from './fixtures/bot-serving-boot.mjs'

// The serving fence at the entry a real Host uses: the `llm/stream` handler the product installs,
// over the real policy, the real lifecycle and the real thread host. Every case drives that
// handler and then asserts what did or did not reach the base stream — reaching it is the one
// thing a refusal has to prevent.

const request = (sessionId, model = 'deepseek-chat') => ({ sessionId, provider: 'deepseek', model, messages: [], signal: AbortSignal.timeout(5000) })
// The isolated scratch the fixture bundles into; a switch file a test writes lives beside it.
const bootedRoot = () => resolve(import.meta.dirname, '..', 'tmp/integration/bot-serving')

const threadFor = async (booted, botId, name) => {
  const { thread } = booted.threads.service.create({ botId, name })
  const bound = await booted.threads.service.ensureSession({ botId, threadId: thread.threadId })
  return { threadId: thread.threadId, sessionId: bound.sessionId }
}

test('an open Bot thread streams under the Bot policy, is charged to the Bot, and releases its lease', async t => {
  const accounting = []
  const booted = await bootServingHost(t, { seed: seed(), accountStream: (options, next, meta) => { accounting.push({ botId: meta?.botId ?? null, source: meta?.source ?? null }); return next() } })
  const bound = await threadFor(booted, 'b', '一线程')
  const chunks = await booted.stream(request(bound.sessionId))
  assert.ok(chunks.length > 0, 'the thread turn streams')
  assert.deepEqual(booted.upstream, [bound.sessionId])
  // The shared money decorator still sees the turn, with the Bot it belongs to.
  assert.equal(accounting.length, 1, 'the shared accounting decorator still sees the turn')
  assert.equal(accounting[0].botId, 'b')
  assert.ok(['bot-session', 'bot-auxiliary'].includes(accounting[0].source), 'the receipt source is one the ledger already accepts')
  assert.deepEqual(booted.product.serving.busyBots(), [], 'the lease is released when the stream ends')
  assert.deepEqual(booted.product.serving.leases(), [])
})

test('an archived thread is refused before the upstream call, and streams again once restored', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  const bound = await threadFor(booted, 'b', '归档')
  await booted.threads.service.archive({ botId: 'b', threadId: bound.threadId })
  // The runtime no longer lists the Session as a Bot session: this is exactly the state the
  // ordinary Harness bypass used to answer for.
  assert.equal(booted.rt.isBotSession(bound.sessionId), false)
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => error.code === 'THREAD_ARCHIVED')
  assert.deepEqual(booted.upstream, [], 'nothing reached the base stream')

  await booted.threads.service.unarchive({ botId: 'b', threadId: bound.threadId })
  assert.ok((await booted.stream(request(bound.sessionId))).length > 0)
  assert.deepEqual(booted.upstream, [bound.sessionId])
})

test('a revoked grant refuses the thread, and a deleted Bot keeps refusing it afterwards', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  const bound = await threadFor(booted, 'b', '撤销')
  booted.directory.replaceGrant('b', { tools: [], modelRoutes: [] })
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => error.code === 'BOT_GRANT_EMPTY')
  assert.deepEqual(booted.upstream, [])
  booted.directory.replaceGrant('b', grantFor(seed().bots.b))
  assert.ok((await booted.stream(request(bound.sessionId))).length > 0)

  // A deleted Bot leaves its thread record in place: the catalog refuses the write instead of
  // letting the Session fall through to the ordinary bypass.
  await booted.rt.deleteBot('b')
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => error.code === 'BOT_NOT_COMMITTED')
  assert.deepEqual(booted.upstream, [bound.sessionId], 'only the live turn reached the base stream')
})

test('a thread archived mid-stream is refused at the next chunk, not at the end of the turn', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  const bound = await threadFor(booted, 'b', '中途')
  booted.state.beforeChunk = index => (index === 1 ? booted.threads.service.archive({ botId: 'b', threadId: bound.threadId }) : undefined)
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => error.code === 'THREAD_ARCHIVED')
  assert.deepEqual(booted.upstream, [bound.sessionId], 'the stream had started, and then stopped')
  assert.deepEqual(booted.product.serving.busyBots(), [], 'a refused stream releases its lease')
})

test('a Bot moved to the other runtime is refused before the stream and again mid-stream', async t => {
  // The adapter's own words: this Bot is served by the independent loop.
  let mode = 'integration'
  const booted = await bootServingHost(t, { seed: seed(), modeOf: () => mode })
  const bound = await threadFor(booted, 'b', '移模式')
  mode = 'independent'
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.deepEqual(booted.upstream, [])

  // A move that happens while the stream is open stops it at the next chunk.
  mode = 'integration'
  const second = await threadFor(booted, 'b', '移模式二')
  booted.state.beforeChunk = index => { if (index === 1) mode = 'independent' }
  await assert.rejects(() => booted.stream(request(second.sessionId)), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.deepEqual(booted.upstream, [second.sessionId])
})

test('a switch that cannot be read refuses instead of assuming the integration path', async t => {
  const booted = await bootServingHost(t, { seed: seed(), modeOf: () => { throw Object.assign(new Error('RUNTIME_SWITCH_SCHEMA'), { code: 'RUNTIME_SWITCH_SCHEMA' }) } })
  const bound = await threadFor(booted, 'b', '损坏')
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => error.code === 'SERVING_MODE_UNKNOWN')
  assert.deepEqual(booted.upstream, [])
  // The Bot's own chat is refused for the same reason: an unreadable decision is not a default.
  await assert.rejects(() => booted.stream(request('b')), error => error.code === 'SERVING_MODE_UNKNOWN')
})

test('an ordinary Harness session still streams untouched', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  // The user's own chat and another plugin's session: no Bot owns them, so the product must not
  // refuse them and must not police them either.
  assert.ok((await booted.stream(request('plain-user-chat'))).length > 0)
  assert.ok((await booted.stream({ provider: 'deepseek', model: 'deepseek-chat', messages: [] })).length > 0, 'a call with no session at all is still an ordinary one')
  assert.deepEqual(booted.upstream, ['plain-user-chat', null])
  // And the Bot's own default chat keeps working: it is policed, not refused. Opening it is what
  // binds its Agent to the Bot's principal, exactly as a composer does.
  await booted.rt.resolveAgent('b')
  assert.ok((await booted.stream(request('b'))).length > 0)
  assert.deepEqual(booted.upstream, ['plain-user-chat', null, 'b'])
})

test('a thread create whose reply was lost is never replayed by the model entry', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  const original = booted.product.rt.addThreadSession
  booted.product.rt.addThreadSession = async () => { throw Object.assign(new Error('lost the reply'), { outcome: 'unknown' }) }
  const { thread } = booted.threads.service.create({ botId: 'b', name: '丢失' })
  await assert.rejects(() => booted.threads.service.ensureSession({ botId: 'b', threadId: thread.threadId }), /lost the reply/)
  booted.product.rt.addThreadSession = original
  assert.equal(booted.host.created.length, 1, 'one Session was made, and no second one is invented')

  // The orphan Session belongs to nobody: the entry neither adopts it nor re-runs the create.
  const orphan = booted.host.created[0].sessionId
  assert.equal(booted.rt.threadOf(orphan), undefined)
  assert.equal(booted.threads.service.threadBySession(orphan), null)
  assert.ok((await booted.stream(request(orphan))).length > 0, 'an unclaimed Session is an ordinary Harness session')
  assert.equal(booted.host.created.length, 1)

  // And the thread itself stays unanswerable until an owner settles it.
  const settled = booted.threads.service.reconcile()
  assert.ok(settled.pending + settled.unknown >= 1, 'the interrupted create is reported, not replayed')
  assert.throws(() => booted.threads.service.assertSendable({ botId: 'b', threadId: thread.threadId }), error => error.code === 'SESSION_UNKNOWN')
})

test('a stale session identity is refused and never becomes another Bot or the owner', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  const bound = await threadFor(booted, 'b', '归属')
  // The Host retires the Bot: its principal is revoked and every Session binding goes with it.
  booted.directory.retire('b')
  assert.throws(() => booted.directory.forSession(bound.sessionId), /UNKNOWN_SUBJECT/)
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => ['BOT_GRANT_EMPTY', 'BOT_GRANT_UNKNOWN', 'SESSION_NOT_OWNED'].includes(error.code))
  assert.deepEqual(booted.upstream, [], 'nothing reached the base stream')
  assert.equal(booted.threads.service.threadBySession(bound.sessionId)?.botId, 'b', 'the record still names its own Bot, not Main or the owner')
})

test('a route the Bot was never granted is still refused by the policy, not by this guard', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  const bound = await threadFor(booted, 'b', '路由')
  await assert.rejects(() => booted.stream(request(bound.sessionId, 'deepseek-reasoner')), error => error.code === 'MODEL_DENIED')
  assert.deepEqual(booted.upstream, [], 'the policy refuses before the provider is reached')
  assert.ok((await booted.stream(request(bound.sessionId))).length > 0)
})

test('a live thread the catalog cannot confirm is refused rather than handed to the bypass', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  const bound = await threadFor(booted, 'b', '无记录')
  // The thread service is gone while the runtime still reports a live thread Session: the guard
  // must refuse, because the bypass would answer for a Bot with no Bot policy.
  booted.ctx.services.set('botThreads', null)
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => error.code === 'BOT_THREAD_ADMISSION_UNAVAILABLE')
  assert.deepEqual(booted.upstream, [])
})

test('a catalog that cannot be read is a refusal, not an ordinary session', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  // A catalog whose lookup fails may still hold this call's tombstoned identity, so the failure
  // propagates: it must never be read as "unbound" and handed to the ordinary bypass.
  booted.ctx.services.set('botThreads', { service: {
    threadBySession: () => { throw Object.assign(new Error('BOT_THREADS_CLOSED'), { code: 'BOT_THREADS_CLOSED' }) },
    assertSendable: () => ({ ok: true }),
  } })
  await assert.rejects(() => booted.stream(request('plain-user-chat')), error => error.code === 'BOT_THREADS_CLOSED')
  assert.deepEqual(booted.upstream, [], 'nothing reached the base stream')
})

test('a record that answers for another Session is refused, not substituted', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  const bound = await threadFor(booted, 'b', '错配')
  booted.ctx.services.set('botThreads', { service: {
    threadBySession: () => ({ botId: 'b', threadId: bound.threadId }),
    assertSendable: ({ botId, threadId }) => ({ ok: true, botId, threadId, sessionId: 'some-other-session' }),
  } })
  await assert.rejects(() => booted.stream(request(bound.sessionId)), error => error.code === 'THREAD_SESSION_CONFLICT')
  assert.deepEqual(booted.upstream, [])
})

test('a group Session is the Bot own work, policed and leased like its chat', async t => {
  // A room where Bot b speaks in its own Session: the group owner index names the Bot, so the
  // product has to police and lease it exactly like the Bot's default chat.
  const seeded = seed()
  seeded.rooms = { r1: { id: 'r1', name: 'room', members: ['b'], sessions: { b: 'g1' } } }
  const booted = await bootServingHost(t, { seed: seeded })
  assert.equal(booted.rt.isBotSession('g1'), true)
  assert.equal(booted.rt.selfOf('g1'), 'b')
  assert.deepEqual(booted.rt.groupOwners.get('g1'), { botId: 'b', roomId: 'r1' })
  await booted.rt.resolveAgent('g1')
  assert.ok((await booted.stream(request('g1'))).length > 0, 'the group turn streams')
  assert.deepEqual(booted.upstream, ['g1'])
  assert.deepEqual(booted.product.serving.busyBots(), [], 'and its lease is released')
})

test('a product Session whose Bot cannot be resolved is refused, not bypassed', async t => {
  const booted = await bootServingHost(t, { seed: seed() })
  await booted.rt.resolveAgent('b')
  // Fault injection: the runtime still calls this a Bot Session, but no committed record names the
  // Bot. Policing claimed the call, so the ordinary bypass must not answer for it.
  booted.rt.selfOf = () => undefined
  booted.rt.groupOwners = new Map()
  await assert.rejects(() => booted.stream(request('b')), error => error.code === 'PRODUCT_IDENTITY_UNRESOLVED')
  assert.deepEqual(booted.upstream, [], 'nothing reached the base stream')
  assert.deepEqual(booted.product.serving.busyBots(), [])
})

test('the shared admission sees the native runtime it is bound to, in the production order', async t => {
  // The admission is published before the runtime exists, so the product binds the runtime to it.
  // A Bot mid-turn must be visible to a move through that real construction order, and the binding
  // must go away when the product is disposed.
  const { createBotServing } = await import('../packages/orchestration/src/bot-serving.mjs')
  const shared = createBotServing({})
  const booted = await bootServingHost(t, { seed: seed(), sharedServing: shared })
  assert.equal(booted.product.serving, shared, 'the product reuses the published admission')
  const bound = await threadFor(booted, 'b', 'native-busy')
  booted.product.rt.live.set(bound.sessionId, { turn: 7 })
  assert.deepEqual(shared.busyBots(), ['b'], 'the native turn record is visible before any model chunk')
  assert.throws(() => shared.assertIdle('b'), error => error.code === 'BOT_BUSY')
  // The stream itself still runs: the integrated path counts its own lease instead of refusing.
  assert.ok((await booted.stream(request(bound.sessionId))).length > 0)
  booted.product.rt.live.delete(bound.sessionId)
  assert.deepEqual(shared.busyBots(), [])

  // Disposing the product releases the binding, so a disposed runtime cannot blind a newer one.
  const bootedTwo = await bootServingHost(t, { seed: seed(), sharedServing: shared })
  await bootedTwo.product.dispose()
  assert.deepEqual(shared.busyBots(), [], 'the disposed runtime is unbound')
})

test('a persisted switch with no adapter still refuses a moved Bot', async t => {
  // A Host that restarted with the independent runtime switched off: the adapter is gone, the
  // switch file a move wrote is still there. Absence of a service is not proof that nothing moved.
  const { mkdtemp, writeFile, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(bootedRoot(), 'switch-'))
  const file = join(dir, 'runtime-switch.json')
  await writeFile(file, `${JSON.stringify({ schemaVersion: 1, bots: { b: { mode: 'independent', changedAt: 1 } } })}\n`)
  const booted = await bootServingHost(t, { seed: seed(), switchFile: file })
  await assert.rejects(() => booted.stream(request('b')), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.deepEqual(booted.upstream, [])
  // Nothing was reset or rewritten: the committed mode is still what the file says.
  assert.equal(JSON.parse(await readFile(file, 'utf8')).bots.b.mode, 'independent')
})

test('a corrupt switch file refuses, and a Host with no switch at all serves integration', async t => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(bootedRoot(), 'corrupt-'))
  const file = join(dir, 'runtime-switch.json')
  await writeFile(file, '{ not json')
  const broken = await bootServingHost(t, { seed: seed(), switchFile: file })
  await assert.rejects(() => broken.stream(request('b')), error => error.code === 'SERVING_MODE_UNKNOWN')
  assert.deepEqual(broken.upstream, [])

  // No switch file was ever written here, so integration is the truth — stated, not assumed.
  const plain = await bootServingHost(t, { seed: seed() })
  await plain.rt.resolveAgent('b')
  assert.ok((await plain.stream(request('b'))).length > 0)
  assert.deepEqual(plain.upstream, ['b'])
})

// ── the same fence through the real composition ────────────────────────────────
//
// `startBotProduct` assembles the thread host, publishes it, and hands the product's own admission
// to the thread host's runtime reader. This case drives the model entry that assembly installs,
// over the real authority, directory, policy and lifecycle — the chain a Host runs, with only
// DSH's own services faked.

const COMPOSITION_MODEL = 'deepseek/deepseek-chat'
const { startBotProduct } = await import('../packages/orchestration/src/product-composition.mjs')

function makeCompositionContext({ upstream, chunks }) {
  const services = new Map()
  const disposers = []
  const listeners = new Map()
  const ctx = {
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
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
  }
  // The DSH service shape: the registered llm/stream listeners run as a waterfall, and the base
  // stream answers. Reaching the base stream is the one thing a refusal has to prevent.
  Object.assign(ctx, {
    llm: {
      listProviders: () => ['deepseek'], listModels: async () => [{ id: 'deepseek-chat' }], resolveModelInfo: async () => ({}),
      stream: options => {
        const registered = listeners.get('llm/stream') ?? []
        const run = index => {
          if (index >= registered.length) {
            return (async function* base() {
              upstream.push(options.sessionId ?? null)
              for (const chunk of chunks) yield chunk
            })()
          }
          const listener = registered[index]
          const next = () => run(index + 1)
          return listener.length >= 2 ? listener(options, next) : (listener(options), next())
        }
        return run(0)
      },
    },
    workspaceRegistry: {
      get: () => undefined, resolveByPath: async () => undefined, create: async () => ({ sessionId: 'w-1' }), archiveSession: async () => {},
    },
    sessionController: {
      create: async request => ({ sessionId: `sess-${request.title ?? 'x'}` }),
      resolveAgent: async sessionId => ({ agent: {
        id: sessionId, session: { id: sessionId }, ctx: { get: () => ({ restrict: () => () => {} }) }, status: 'idle',
        followup() {}, steer() {}, inject() {}, cancel() {}, async whenIdle() {},
        async runMaintenance(fn) { return fn(AbortSignal.timeout(60_000)) },
        inbox: { nextStep: [], nextTurn: [], remove: () => false },
      } }),
      selectModel: async request => ({ selected: { provider: request.provider, model: request.model } }),
      cancel: async () => ({}), prompt: async () => ({}), page: async () => ({ records: [], hasMore: false }),
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, messageProjections: [] },
  })
  return ctx
}

async function withCompositionHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-serving-'))
  const previous = { state: process.env.DSH_STATE_HOME, dsh: process.env.DSH_HOME }
  // The composition resolves its own state home from the environment, so the spec points it at an
  // isolated directory: a boot here can never take the lock the real desktop holds.
  process.env.DSH_STATE_HOME = home
  process.env.DSH_HOME = home
  try {
    return await run(home)
  } finally {
    process.env.DSH_STATE_HOME = previous.state
    process.env.DSH_HOME = previous.dsh
  }
}

test('the composed product admits a Bot thread, and refuses it once the Host archives it', async () => {
  await withCompositionHome(async home => {
    await writeFile(join(home, 'state.json'), JSON.stringify(seed()))
    const upstream = []
    const chunks = [{ type: 'text-delta', index: 0, text: 'one' }, { type: 'finish', reason: { kind: 'stop' } }]
    const ctx = makeCompositionContext({ upstream, chunks })
    const composition = startBotProduct(ctx, {
      accountStream: (options, next) => next(), failClosed: false,
      storageFile: join(home, 'model-router', 'orchestration.sqlite'),
      runtimeConfig: { home, github: false, diagnosticsFile: false },
    })
    try {
      await composition.boot
      const readModel = ctx.get('botProductReadModel')
      assert.ok(readModel, 'the composition publishes its read model')
      // The composition publishes the thread catalog the model entry asks for.
      assert.equal(typeof ctx.get('botThreads')?.service?.assertSendable, 'function', 'the thread catalog is published under its service name')

      const created = await readModel.dispatch({ action: 'threads.create', payload: { botId: 'b', name: 'wiring' } }, { kind: 'owner' })
      const threadId = created.thread.threadId
      const bound = await readModel.dispatch({ action: 'threads.ensure', payload: { botId: 'b', threadId } }, { kind: 'owner' })

      // The route snapshot is asynchronous: the first grant compilation happens before the
      // provider catalog is hydrated, and the refresh that follows recompiles it. Wait for the
      // Bot's committed grant to carry its configured route rather than assuming a warm start.
      const route = () => composition.grants.get('b')?.modelRoutes ?? []
      for (let attempt = 0; attempt < 100 && route().length === 0; attempt += 1) {
        await new Promise(done => setTimeout(done, 20))
      }
      assert.ok(route().length > 0, 'the committed grant carries the configured route')

      // The real entry: a turn on the thread Session reaches the base stream, policed.
      const seen = []
      for await (const chunk of ctx.llm.stream({ sessionId: bound.sessionId, provider: 'deepseek', model: 'deepseek-chat', messages: [], signal: AbortSignal.timeout(5000) })) seen.push(chunk)
      assert.ok(seen.length > 0, 'the thread turn streams through the composed product')
      assert.deepEqual(upstream, [bound.sessionId])

      // Archive: the Host drops the authority first, and the model entry refuses the Session
      // instead of letting the ordinary Harness bypass answer for the Bot.
      await readModel.dispatch({ action: 'threads.archive', payload: { botId: 'b', threadId } }, { kind: 'owner' })
      await assert.rejects(async () => {
        for await (const chunk of ctx.llm.stream({ sessionId: bound.sessionId, provider: 'deepseek', model: 'deepseek-chat', messages: [], signal: AbortSignal.timeout(5000) })) void chunk
      }, error => error.code === 'THREAD_ARCHIVED')
      assert.deepEqual(upstream, [bound.sessionId], 'nothing reached the base stream after the archive')
    } finally {
      await composition.dispose()
    }
  })
})
