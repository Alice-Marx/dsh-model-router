import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { attachDsLifecycle, compileDsOwnership } from '../packages/orchestration/src/ds-lifecycle.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createBotPolicy } from '../packages/orchestration/src/bot-policy.mjs'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createBotThreadHost } from '../packages/orchestration/src/bot-thread-host.mjs'
import { needsBotPolicy } from '../modules/bot-runtime/policy-scope.mjs'

// The real Host chain, offline. The vendored runtime is read as source and
// bundled here — the same way the browser verification reads the vendored
// stylesheets — so no new importer of the pinned vendor tree appears in this
// repository. What runs is the patched vendor runtime (thread index, trusted
// thread records, part-steward fence, channel projection), the real lifecycle
// with thread ownership compiled in, the real principal directory and Bot
// policy, and the real wiring adapter. Only DSH's own services are fixtures.

const root = resolve(import.meta.dirname, '..')
const scratch = resolve(root, 'tmp/integration/bot-threads/native')
await mkdir(scratch, { recursive: true })
// The vendored update and diagnostics modules read their own manifest relative
// to the bundle; the pinned version stands in for it here.
await writeFile(resolve(root, 'tmp/integration/bot-threads/package.json'), `${JSON.stringify({ name: 'ds-bot', version: '0.2.7' })}\n`)
const directory = await mkdtemp(join(scratch, 'case-'))
const bundleFile = join(directory, 'ds-bot-runtime.mjs')
const bundle = await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'modules/bot-runtime/vendor/ds-bot/index.js')],
  bundle: true, platform: 'node', format: 'esm', outfile: bundleFile,
  external: ['@deepseek-ai/*', 'deep-view/*', 'playwright', 'playwright-core'],
  logLevel: 'silent',
})
assert.equal(bundle.errors.length, 0, 'the patched vendored runtime bundles')
const { createRuntime } = await import(pathToFileURL(bundleFile).href)

const MODEL = 'deepseek/deepseek-chat'
// One Session id space across every booted instance: a restart is a new
// process, and DSH would never hand out the same Session id twice.
let sessionsMade = 0
const grantFor = bot => ({
  tools: ['tool/model_router', 'model/infer'],
  modelRoutes: typeof bot?.model === 'string' && bot.model.includes('/') ? [{ provider: bot.model.split('/')[0], model: bot.model.split('/')[1] }] : [],
})

// A stand-in for the plugin context that records what apply() registers.
function fakeContext({ services = {} } = {}) {
  const calls = []
  const disposers = []
  const listeners = new Map()
  const sections = new Map()
  const registeredTools = new Map()
  return {
    calls, listeners, sections, registeredTools,
    logger: { warn() {}, info() {} },
    get: name => services[name],
    on(name, listener, options) { calls.push(`on ${name}${options?.prepend ? ' (prepend)' : ''}`); listeners.set(name, [...(listeners.get(name) ?? []), listener]); return () => {} },
    emit(name, payload) { for (const listener of listeners.get(name) ?? []) if (listener.length < 2) listener(payload) },
    async emitAsync(name, payload) { for (const listener of listeners.get(name) ?? []) if (listener.length < 2) await listener(payload) },
    effect(execute) { calls.push('effect'); const dispose = execute(); if (typeof dispose === 'function') disposers.push(dispose) },
    async dispose() { return Promise.allSettled(disposers.splice(0).reverse().map(dispose => dispose())) },
    tools: { register(tool) { registeredTools.set(tool.name, tool); return () => {} }, guard() { return () => {} }, schemas: () => [] },
    systemPrompt: { section(section) { sections.set(section.name, section); return () => {} } },
    connection: { fetch: { register(route) { calls.push(`route ${route.path}`); return () => {} } } },
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
  }
}

// One boot of the real runtime over a seeded team, wired to the real product
// services. `again` boots a second process-shaped instance over the same home.
async function boot(t, seed) {
  const home = await mkdtemp(join(directory, 'home-'))
  await writeFile(join(home, 'state.json'), JSON.stringify(seed))
  const started = []
  const start = async () => {
    const ctx = fakeContext()
    const agents = new Map()
    const agentOf = sessionId => {
      if (!agents.has(sessionId)) {
        const calls = []
        agents.set(sessionId, {
          session: { id: sessionId, requestHeader: () => undefined, deriveMessages: () => [] },
          id: sessionId,
          calls,
          status: 'idle',
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
    const host = {
      created: [],
      selected: [],
      cancelled: [],
      prompts: [],
      titles: [],
    }
    Object.assign(ctx, {      llm: {
        listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}),
        stream: (options) => runStream(ctx, options),
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
      sessionTitle: { rename: async (session, title) => { host.titles.push([session?.id, title]) } },
      sessions: { flush: async () => {}, messageProjections: [] },
    })
    let route
    const register = ctx.connection.fetch.register
    ctx.connection.fetch.register = options => { route = options; return register(options) }
    const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false, mainName: 'Chief', mainRole: '主助理' })    // The product's own services, real ones.
    const authority = createAuthority({ now: () => 0 })
    const directory = createPrincipalDirectory(authority)
    const policy = createBotPolicy({ authority, directory, machineId: 'machine-1', workspaceId: 'ws-1' })
    const lifecycle = attachDsLifecycle({ runtime: rt, directory, grantFor })
    ctx.on('agent/created', ({ agent }) => lifecycle.observeAgent(agent))
    // The product's model guard, exactly as modules/bot-runtime/index.mjs runs
    // it: only Bot Sessions are policed, and the policy resolves their identity
    // from the bound principal.
    ctx.on('llm/stream', (options, next) => (async function* () {
      await rt.load()
      if (!needsBotPolicy({ admitted: Boolean(policy.activeIdentity()), isBotSession: id => rt.isBotSession(id), sessionId: options.sessionId })) {
        policed.push(['unpoliced', options.sessionId])
        yield* next()
        return
      }
      policed.push(['policed', options.sessionId])
      yield* policy.modelStream(options, () => next())
    })())
    await rt.load()
    started.push({ ctx, rt, authority, directory, policy, lifecycle, host, agents, agentOf, home, route })
    return started.at(-1)
  }
  const policed = []
  // The DSH service shape: the registered llm/stream listeners run as a
  // waterfall, and the base stream answers.
  const runStream = (ctx, options) => {
    const listeners = ctx.listeners.get('llm/stream') ?? []
    const base = async function* base() { yield { type: 'text-delta', index: 0, text: 'ok' }; yield { type: 'finish', reason: { kind: 'stop' } } }
    const run = index => {
      if (index >= listeners.length) return base()
      const listener = listeners[index]
      const next = () => run(index + 1)
      return listener.length >= 2 ? listener(options, next) : (listener(options), next())
    }
    return run(0)
  }
  const call = async (instance, endpoint, payload) => {
    if (instance.route === undefined) throw new Error('the channel route was not registered')
    const response = await instance.route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const first = await start()
  t.after(async () => { for (const instance of started) await instance.ctx.dispose().catch(() => {}); await rm(first.home, { recursive: true, force: true }) })
  return { ...first, start, again: async () => await start(), call, policed, started }
}

const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: MODEL },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2, model: MODEL, workDir: process.cwd() },
  },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})

test('two threads are two real Sessions under one committed Bot, and neither disturbs the default chat', async t => {
  const booted = await boot(t, seed())
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file: join(booted.home, 'bot-threads.json'), now: () => 1_700_000_000_000,
  })
  assert.equal(host.ready, true, 'the patched runtime exposes every hook the catalog needs')
  const one = host.service.create({ botId: 'b', name: '线索一' }).thread
  const two = host.service.create({ botId: 'b', name: '线索二' }).thread
  const first = await host.service.ensureSession({ botId: 'b', threadId: one.threadId })
  const second = await host.service.ensureSession({ botId: 'b', threadId: two.threadId })
  assert.notEqual(first.sessionId, second.sessionId)
  assert.equal(booted.host.created.length, 2)

  // One Bot authority, two Sessions: the same principal answers for both.
  const principal = booted.directory.forBot('b')
  assert.equal(booted.authority.describe(booted.directory.forSession(first.sessionId)).botId, 'b')
  assert.equal(booted.directory.forSession(second.sessionId), principal)
  // And the committed grant is what authorizes a turn on either.
  booted.authority.assertModel(principal, 'deepseek', 'deepseek-chat')
  assert.throws(() => booted.authority.assertModel(principal, 'deepseek', 'deepseek-reasoner'), /MODEL_DENIED/)

  // Independent contexts: each Session has its own inbox, and the Bot's own
  // chat is untouched by either.
  await booted.call(booted, 'send', { sessionId: first.sessionId, text: '给一线程' })
  await booted.call(booted, 'send', { sessionId: second.sessionId, text: '给二线程' })
  const inbox = sessionId => booted.agents.get(sessionId)?.calls ?? []
  assert.equal(inbox(first.sessionId).length, 0, 'a send prompts the Session, it does not inject')
  assert.deepEqual(booted.host.prompts.map(entry => entry.sessionId), [first.sessionId, second.sessionId])
  assert.equal(inbox('b').length, 0, 'the Bot default chat is not written by a thread')
  assert.equal(booted.rt.isBotSession(first.sessionId), true)
  assert.equal(booted.rt.isBotSession(second.sessionId), true)
  assert.equal(booted.rt.selfOf(first.sessionId), 'b')
  // chatOf stays the default chat: a thread is a different thing.
  assert.equal(booted.rt.chatOf('b'), 'b')
  assert.notEqual(booted.rt.chatOf('b'), first.sessionId)
})

test('a thread turn is policed by the Bot policy and charged to the Bot, and an archived thread is refused by the Host send path', async t => {
  const booted = await boot(t, seed())
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file: join(booted.home, 'bot-threads.json'), now: () => 1_700_000_000_000,
  })
  const { thread } = host.service.create({ botId: 'b', name: '策略' })
  const bound = await host.service.ensureSession({ botId: 'b', threadId: thread.threadId })

  // A model call on the thread Session reaches the Bot policy, which resolves
  // the Bot's principal and re-asserts the committed route per chunk.
  const chunks = []
  for await (const chunk of booted.ctx.llm.stream({ sessionId: bound.sessionId, provider: 'deepseek', model: 'deepseek-chat', messages: [], signal: AbortSignal.timeout(5000) })) chunks.push(chunk)
  assert.ok(chunks.length > 0)
  assert.ok(booted.policed.some(entry => entry[0] === 'policed' && entry[1] === bound.sessionId))
  // A route the Bot was never granted is refused by the policy, not by the UI.
  await assert.rejects(async () => {
    for await (const chunk of booted.ctx.llm.stream({ sessionId: bound.sessionId, provider: 'deepseek', model: 'deepseek-reasoner', messages: [], signal: AbortSignal.timeout(5000) })) void chunk
  }, /MODEL_DENIED/)

  // Archive: the Host drops the authority first, and the send path refuses the
  // archived Session instead of redirecting it to the default chat.
  await host.service.archive({ botId: 'b', threadId: thread.threadId })
  assert.equal(booted.rt.isBotSession(bound.sessionId), false)
  assert.throws(() => booted.directory.forSession(bound.sessionId), /UNKNOWN_SUBJECT/)
  const refused = await booted.call(booted, 'send', { sessionId: bound.sessionId, text: '归档后' })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'bot/archived')
  assert.equal(booted.host.prompts.length, 0)
  assert.equal(await host.service.assertSendable.length >= 0, true)
  assert.throws(() => host.service.assertSendable({ botId: 'b', threadId: thread.threadId }), error => error.code === 'THREAD_ARCHIVED')

  // Restoring brings the same Session back under the same Bot.
  await host.service.unarchive({ botId: 'b', threadId: thread.threadId })
  assert.equal(booted.rt.isBotSession(bound.sessionId), true)
  assert.equal(booted.authority.describe(booted.directory.forSession(bound.sessionId)).botId, 'b')
})

test('stopping one thread leaves the other threads and the default chat running', async t => {
  const booted = await boot(t, seed())
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file: join(booted.home, 'bot-threads.json'), now: () => 1_700_000_000_000,
  })
  const one = host.service.create({ botId: 'b', name: '一' }).thread
  const two = host.service.create({ botId: 'b', name: '二' }).thread
  const first = await host.service.ensureSession({ botId: 'b', threadId: one.threadId })
  const second = await host.service.ensureSession({ botId: 'b', threadId: two.threadId })
  await booted.ctx.sessionController.cancel({ sessionId: first.sessionId })
  assert.deepEqual(booted.host.cancelled, [['cancel', first.sessionId]])
  assert.equal(booted.rt.isBotSession(second.sessionId), true)
  assert.equal(booted.rt.isBotSession('b'), true)
  // A stopped thread still holds its identity: stopping is not deleting.
  assert.equal(host.service.resolve({ botId: 'b', threadId: one.threadId }).sessionId, first.sessionId)
})

test('a revoked grant, a deleted Bot and a moved runtime all refuse thread writes', async t => {
  const booted = await boot(t, seed())
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file: join(booted.home, 'bot-threads.json'), now: () => 1_700_000_000_000,
  })
  const { thread } = host.service.create({ botId: 'b', name: '撤销' })
  const bound = await host.service.ensureSession({ botId: 'b', threadId: thread.threadId })
  assert.equal((await host.sendGate({ botId: 'b', threadId: thread.threadId })).sessionId, bound.sessionId)

  // A suspended Bot: the lifecycle empties the grant, and the send gate says so.
  booted.directory.replaceGrant('b', { tools: [], modelRoutes: [] })
  assert.equal(host.botAuthorized('b'), false)
  assert.throws(() => host.service.assertSendable({ botId: 'b', threadId: thread.threadId }), error => error.code === 'BOT_GRANT_EMPTY')
  booted.directory.replaceGrant('b', grantFor(seed().bots.b))
  assert.equal((await host.sendGate({ botId: 'b', threadId: thread.threadId })).sessionId, bound.sessionId)

  // A Bot moved to the independent runtime gains no Host Session here.
  const moved = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file: join(booted.home, 'bot-threads-moved.json'), runtimeMode: () => 'independent', now: () => 1_700_000_000_000,
  })
  assert.throws(() => moved.service.assertSendable({ botId: 'b', threadId: thread.threadId }), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.equal(moved.service.readModel({ botId: 'b' }).status, 'blocked')

  // A deleted Bot: the Host retires the principal, the catalog refuses writes,
  // and only then may the threads be purged.
  await booted.rt.deleteBot('b')
  assert.equal(booted.lifecycle.committedBot('b'), null)
  assert.equal(host.committedThreads('b').length, 0)
  assert.throws(() => host.service.create({ botId: 'b', name: '删除后' }), error => error.code === 'BOT_NOT_COMMITTED')
  assert.deepEqual(host.service.purgeBot('b'), { botId: 'b', removed: 1 })
})

test('a restart re-reads the Host record and re-binds the thread Sessions', async t => {
  const booted = await boot(t, seed())
  const file = join(booted.home, 'bot-threads.json')
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file, now: () => 1_700_000_000_000,
  })
  const { thread } = host.service.create({ botId: 'b', name: '重启' })
  const bound = await host.service.ensureSession({ botId: 'b', threadId: thread.threadId })
  host.service.close()

  // A second process-shaped boot over the same home: the Host state and the
  // catalog both survive. Opening the thread Session resolves its Agent, which
  // is what binds it to the Bot's principal again — exactly as a composer does.
  const again = await booted.again()
  await again.rt.resolveAgent(bound.sessionId)
  const revived = createBotThreadHost({
    rt: again.rt, lifecycle: again.lifecycle, authority: again.authority, directory: again.directory,
    file, now: () => 1_700_000_000_000,
  })
  const settled = revived.service.reconcile()
  assert.equal(settled.owned, 1)
  assert.equal(revived.service.resolve({ botId: 'b', threadId: thread.threadId }).sessionId, bound.sessionId)
  const gate = revived.service.assertSendable({ botId: 'b', threadId: thread.threadId })
  assert.equal(gate.sessionId, bound.sessionId)
  assert.equal(again.authority.describe(again.directory.forSession(bound.sessionId)).botId, 'b')
  // No second Session was made for the same thread.
  assert.equal(again.host.created.length, 0)
})

test('two concurrent opens make one Session, and a lost reply is never replayed', async t => {
  const booted = await boot(t, seed())
  const file = join(booted.home, 'bot-threads.json')
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file, now: () => 1_700_000_000_000,
  })
  const { thread } = host.service.create({ botId: 'b', name: '并发' })
  const [left, right] = await Promise.all([
    host.service.ensureSession({ botId: 'b', threadId: thread.threadId }),
    host.service.ensureSession({ botId: 'b', threadId: thread.threadId }),
  ])
  assert.equal(left.sessionId, right.sessionId)
  assert.equal(booted.host.created.length, 1)
  host.service.close()

  // The Host recorded the Session but the reply was lost: the durable intent is
  // settled from the Host's own record on the next boot, never replayed.
  const lost = await booted.again()
  const original = lost.rt.addThreadSession
  lost.rt.addThreadSession = async (...args) => { const record = await original(...args); throw Object.assign(new Error('lost the reply'), { outcome: 'unknown' }) }
  const again = createBotThreadHost({
    rt: lost.rt, lifecycle: lost.lifecycle, authority: lost.authority, directory: lost.directory,
    file, now: () => 1_700_000_000_000,
  })
  const second = again.service.create({ botId: 'b', name: '丢失' }).thread
  assert.equal(await again.service.ensureSession({ botId: 'b', threadId: second.threadId }).then(() => null, error => error.message), 'lost the reply')
  again.service.close()
  const third = await booted.again()
  const settled = createBotThreadHost({
    rt: third.rt, lifecycle: third.lifecycle, authority: third.authority, directory: third.directory,
    file, now: () => 1_700_000_000_000,
  })
  const result = settled.service.reconcile()
  assert.equal(result.pending, 1)
  const adopted = settled.service.resolve({ botId: 'b', threadId: second.threadId })
  // The adopted Session is only bound once its Agent is known — the same thing
  // opening the thread in a composer does — so the catalog keeps it honest
  // until then and the send gate re-verifies rather than trusting the flag.
  await third.rt.resolveAgent(adopted.sessionId)
  assert.equal(settled.service.reconcile().owned, 1)
  assert.equal(settled.service.resolve({ botId: 'b', threadId: second.threadId }).sessionState, 'owned')
  assert.equal(third.host.created.length, 0, 'the interrupted create is adopted, not repeated')
  assert.equal(settled.service.assertSendable({ botId: 'b', threadId: second.threadId }).sessionId, adopted.sessionId)})

test('the send gate only ever makes a Session for a thread that never had one, and only when asked', async t => {
  const booted = await boot(t, seed())
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file: join(booted.home, 'bot-threads.json'), now: () => 1_700_000_000_000,
  })
  const { thread } = host.service.create({ botId: 'b', name: '门' })
  // Dispatching a model request is not a request to make a Session: the default
  // is to refuse, and nothing is created.
  const refused = await host.sendGate({ botId: 'b', threadId: thread.threadId })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'SESSION_MISSING')
  assert.equal(refused.sessionState, 'none')
  assert.equal(booted.host.created.length, 0)

  // An explicit write in this thread makes exactly one, through the same
  // single-flight ensure every other path uses.
  const opened = await host.sendGate({ botId: 'b', threadId: thread.threadId, create: true })
  assert.equal(opened.ok, true)
  assert.equal(opened.sessionId, booted.host.created[0].sessionId)
  assert.equal(booted.host.created.length, 1)
  // And a send afterwards never makes another.
  assert.equal((await host.sendGate({ botId: 'b', threadId: thread.threadId })).sessionId, opened.sessionId)
  assert.equal((await host.sendGate({ botId: 'b', threadId: thread.threadId, create: true })).sessionId, opened.sessionId)
  assert.equal(booted.host.created.length, 1)
})

test('the send gate never makes a Session for a thread the Host cannot authorize', async t => {
  const booted = await boot(t, seed())
  const file = join(booted.home, 'bot-threads.json')
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file, now: () => 1_700_000_000_000,
  })
  const kept = host.service.create({ botId: 'b', name: '保留' }).thread
  const archived = host.service.create({ botId: 'b', name: '归档' }).thread
  const foreign = host.service.create({ botId: 'b', name: '越权' }).thread
  const lost = host.service.create({ botId: 'b', name: '丢失' }).thread
  await host.service.ensureSession({ botId: 'b', threadId: kept.threadId })
  const boundArchived = await host.service.ensureSession({ botId: 'b', threadId: archived.threadId })
  await host.service.archive({ botId: 'b', threadId: archived.threadId })

  // An archived thread keeps its identity and is never given a fresh one.
  const archivedGate = await host.sendGate({ botId: 'b', threadId: archived.threadId, create: true })
  assert.equal(archivedGate.ok, false)
  assert.equal(archivedGate.code, 'THREAD_ARCHIVED')
  // A thread of another Bot is refused by name, whatever the caller asks for.
  assert.equal((await host.sendGate({ botId: 'a', threadId: foreign.threadId, create: true })).code, 'THREAD_FOREIGN_BOT')
  // A suspended Bot has no grant to inherit.
  booted.directory.replaceGrant('b', { tools: [], modelRoutes: [] })
  assert.equal((await host.sendGate({ botId: 'b', threadId: kept.threadId, create: true })).code, 'BOT_GRANT_EMPTY')
  booted.directory.replaceGrant('b', grantFor(seed().bots.b))
  // An outcome the Host never confirmed is not replayed into a new Session.
  host.service.close()
  const lostHost = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file, now: () => 1_700_000_000_000,
  })
  const realAdd = booted.rt.addThreadSession
  booted.rt.addThreadSession = async (...args) => { await realAdd(...args); throw Object.assign(new Error('lost the reply'), { outcome: 'unknown' }) }
  await assert.rejects(() => lostHost.service.ensureSession({ botId: 'b', threadId: lost.threadId }), /lost the reply/)
  booted.rt.addThreadSession = realAdd
  const unknown = await lostHost.sendGate({ botId: 'b', threadId: lost.threadId, create: true })
  assert.equal(unknown.code, 'SESSION_UNKNOWN')
  // A Bot the independent runtime serves gains no Host Session here at all.
  const moved = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file: join(booted.home, 'bot-threads-moved.json'), runtimeMode: () => 'independent', now: () => 1_700_000_000_000,
  })
  const before = booted.host.created.length
  assert.equal((await moved.sendGate({ botId: 'b', threadId: kept.threadId, create: true })).code, 'RUNTIME_MODE_MISMATCH')
  // Nothing the gate refused made a Session: the three the Host did make are the
  // two opened threads and the one interrupted create the Host recorded.
  assert.equal(before, 3)
  assert.equal(booted.host.created.length, before)
  assert.equal(lostHost.service.resolve({ botId: 'b', threadId: archived.threadId }).sessionId, boundArchived.sessionId)
})

test('a rename lands in the Host thread record, and a lost reply renames nothing', async t => {
  const booted = await boot(t, seed())
  const file = join(booted.home, 'bot-threads.json')
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file, now: () => 1_700_000_000_000,
  })
  const { thread } = host.service.create({ botId: 'b', name: '原名' })
  await host.service.ensureSession({ botId: 'b', threadId: thread.threadId })
  const renamed = await host.service.rename({ botId: 'b', threadId: thread.threadId, name: 'Host 标题' })
  assert.equal(renamed.name, 'Host 标题')
  // The committed state holds the title, so a restart reads it back from the Host.
  await booted.lifecycle.refreshGrants()
  assert.equal(booted.lifecycle.committedBot('b').threads.find(entry => entry.threadId === thread.threadId).name, 'Host 标题')
  host.service.close()
  const reopened = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file, now: () => 1_700_000_000_000,
  })
  assert.equal(reopened.service.resolve({ botId: 'b', threadId: thread.threadId }).name, 'Host 标题')
  assert.equal(reopened.service.readModel({ botId: 'b' }).renameAuthority, 'host')
  // A reply that never arrives is not a rename: the old name stands in both places.
  const real = booted.rt.renameThread
  booted.rt.renameThread = async () => { throw Object.assign(new Error('lost the reply'), { outcome: 'unknown' }) }
  await assert.rejects(() => reopened.service.rename({ botId: 'b', threadId: thread.threadId, name: '更远的名字' }), /lost the reply/)
  booted.rt.renameThread = real
  assert.equal(reopened.service.resolve({ botId: 'b', threadId: thread.threadId }).name, 'Host 标题')
  await booted.lifecycle.refreshGrants()
  assert.equal(booted.lifecycle.committedBot('b').threads.find(entry => entry.threadId === thread.threadId).name, 'Host 标题')
  // A thread with no Session has no Host record to write: its name stays in the
  // catalog and travels into the record when the Session is made.
  const fresh = reopened.service.create({ botId: 'b', name: '无会话' }).thread
  assert.equal((await reopened.service.rename({ botId: 'b', threadId: fresh.threadId, name: '还是无会话' })).name, '还是无会话')
  const bound = await reopened.service.ensureSession({ botId: 'b', threadId: fresh.threadId })
  assert.equal(bound.created, true)
  await booted.lifecycle.refreshGrants()
  assert.equal(booted.lifecycle.committedBot('b').threads.find(entry => entry.threadId === fresh.threadId).name, '还是无会话')
})

test('a deleted Bot keeps its thread tombstone until an explicit purge, so an old Session keeps its identity', async t => {
  const booted = await boot(t, seed())
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file: join(booted.home, 'bot-threads.json'), now: () => 1_700_000_000_000,
  })
  const { thread } = host.service.create({ botId: 'b', name: '墓碑' })
  const bound = await host.service.ensureSession({ botId: 'b', threadId: thread.threadId })
  await booted.rt.deleteBot('b')
  // Nothing purges on its own: the row stays and the Session it names still
  // resolves, so a historical turn is never mistaken for an unknown one.
  assert.equal(host.service.list('b').threads.length, 1)
  assert.deepEqual(host.service.threadBySession(bound.sessionId), { botId: 'b', threadId: thread.threadId })
  assert.equal(host.service.readModel({ botId: 'b' }).status, 'blocked')
  assert.throws(() => host.service.assertSendable({ botId: 'b', threadId: thread.threadId }), error => error.code === 'BOT_NOT_COMMITTED')
  // Only the explicit owner act removes it.
  assert.deepEqual(host.service.purgeBot('b'), { botId: 'b', removed: 1 })
  assert.deepEqual(host.service.threadBySession(bound.sessionId), null)
})

test('the lifecycle compiles thread ownership from committed state and refuses what is not committed', async t => {
  const saved = {
    version: 1, revision: 3,
    bots: {
      a: { id: 'a', name: 'A', sessionId: 'root-a', threads: [{ threadId: 't-1', sessionId: 's-1', createdAt: 1 }, { threadId: 't-2', sessionId: 's-2', archivedAt: 5 }] },
      b: { id: 'b', name: 'B', sessionId: 'root-b' },
    },
    rooms: {}, mainBotIds: ['a'],
  }
  const compiled = compileDsOwnership(saved, grantFor)
  assert.equal(compiled.sessions.get('s-1'), 'a')
  assert.equal(compiled.sessions.get('s-2'), undefined, 'an archived thread gains no authority')
  assert.equal(compiled.sessions.get('root-a'), 'a')
  assert.equal(compiled.botRecords.get('a').threads.length, 2)
  // A Session two Bots claim is refused, and a thread that moved between Bots
  // can never be recompiled under its new owner.
  assert.throws(() => compileDsOwnership({ ...saved, bots: { ...saved.bots, b: { id: 'b', name: 'B', sessionId: 'root-b', threads: [{ threadId: 'x', sessionId: 's-1' }] } } }, grantFor), /AMBIGUOUS_SESSION_OWNER/)
  assert.throws(() => compileDsOwnership({ ...saved, bots: { ...saved.bots, a: { ...saved.bots.a, threads: [{ threadId: 't-1', sessionId: 's-1' }, { threadId: 't-1', sessionId: 's-9' }] } } }, grantFor), /AMBIGUOUS_THREAD_IDENTITY/)
  assert.throws(() => compileDsOwnership({ ...saved, bots: { ...saved.bots, a: { ...saved.bots.a, threads: new Array(65).fill(0).map((_, index) => ({ threadId: `t-${index}`, sessionId: `s-${index}` })) } } }, grantFor), /INVALID_DS_BOT_THREADS/)
  assert.throws(() => compileDsOwnership({ ...saved, bots: { ...saved.bots, a: { ...saved.bots.a, threads: [{ threadId: 't-1' }] } } }, grantFor), /INVALID_DS_BOT_THREAD/)
})

test('the catalog file holds no authority, model, folder or credential', async t => {
  const booted = await boot(t, seed())
  const file = join(booted.home, 'bot-threads.json')
  const host = createBotThreadHost({
    rt: booted.rt, lifecycle: booted.lifecycle, authority: booted.authority, directory: booted.directory,
    file, now: () => 1_700_000_000_000,
  })
  const { thread } = host.service.create({ botId: 'b', name: '干净' })
  await host.service.ensureSession({ botId: 'b', threadId: thread.threadId })
  const text = await readFile(file, 'utf8')
  for (const forbidden of ['model', 'provider', 'workDir', 'credential', 'endpoint', 'grant', 'tools']) {
    assert.ok(!text.includes(forbidden), `the catalog must not carry ${forbidden}`)
  }
  assert.ok(text.includes(thread.threadId))
})
