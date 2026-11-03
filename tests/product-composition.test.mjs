import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PRODUCT_TOOLS, PRODUCT_OWNER_READ_METHODS, compileProductGrant, createDiagnosticAccountStream, startBotProduct,
  normalizeTaskCli, createTaskBackends } from '../packages/orchestration/src/product-composition.mjs'
import { createDeferredRouterState } from '../packages/orchestration/src/deferred-router-state.mjs'
import { beginMigrationExclusive, readMigrationFence } from '../packages/orchestration/src/migration-fence.mjs'

process.env.DSH_HOME ??= join(await mkdtemp(join(tmpdir(), 'product-composition-')), 'home')

const accountStream = () => createDiagnosticAccountStream()

function mockCtx() {
  const provided = new Map()
  return {
    provided,
    get: name => provided.get(name),
    provide: (name, value) => { provided.set(name, value) },
    effect: () => () => {},
    on: () => () => {},
    connection: { fetch: { register: () => () => {} }, admit: () => ({ rejection: 401 }) },
  }
}

function mockCtxWithCatalog(providers) {
  const ctx = mockCtx()
  ctx.llm = { listProviders: () => providers.map(id => ({ id })), listModels: async provider => ({ fixture: [{ id: 'gpt-test' }, { id: 'gpt-other' }] })[provider] ?? [] }
  return ctx
}

test('product grant: only a configured exact route earns model authority', () => {
  const routes = new Set(['fixture/gpt-test'])
  assert.deepEqual(compileProductGrant({ id: 'bot-a', model: 'fixture/gpt-test' }, { routes, hydrated: true }),
    { tools: [...PRODUCT_TOOLS], modelRoutes: [{ provider: 'fixture', model: 'gpt-test' }] })
  // An unconfigured or malformed model keeps no model authority: the strict rule pauses instead of switching.
  for (const model of ['other/model', 'fixture', '', 'fixture/gpt-test/extra', null]) {
    assert.deepEqual(compileProductGrant({ id: 'bot-a', model }, { routes, hydrated: true }).modelRoutes, [], String(model))
  }
  // A cache that never hydrated grants no model routes even for a matching string.
  assert.deepEqual(compileProductGrant({ id: 'bot-a', model: 'fixture/gpt-test' }, { routes: new Set(), hydrated: false }).modelRoutes, [])
  assert.deepEqual(compileProductGrant({ id: 'bot-a', model: 'fixture/gpt-test' }, { routes, hydrated: true }).tools, [...PRODUCT_TOOLS])
})

test('diagnostic decorator: bounded identity observations, passthrough, never money', async () => {
  const stream = createDiagnosticAccountStream({ limit: 2, now: () => 42 })
  const next = () => (async function* () { yield { type: 'text-delta', text: 'ok' } })()
  const seen = []
  for await (const chunk of stream({ provider: 'fixture', model: 'gpt-test' }, next, { subject: {}, source: 'bot-session', sessionId: 'session-a', botId: 'bot-a' })) seen.push(chunk)
  assert.deepEqual(seen, [{ type: 'text-delta', text: 'ok' }])
  const [first] = stream.observations()
  assert.equal(first.resolved, true)
  assert.equal(first.botId, 'bot-a')
  assert.equal(first.source, 'bot-session')
  assert.equal(first.sessionId, 'session-a')
  assert.equal(first.provider, 'fixture')
  assert.equal(first.at, 42)
  assert.ok(!JSON.stringify(stream.observations()).match(/cost|usd|amount/i), 'the diagnostic decorator never claims money')
  stream({}, next, {}); stream({}, next, {}); stream({}, next, {})
  assert.equal(stream.observations().length, 2, 'the observation ring is bounded')
})

test('startBotProduct validates its required services', () => {
  assert.throws(() => startBotProduct(mockCtx(), {}), /BOT_PRODUCT_ACCOUNTING_REQUIRED/)
  assert.throws(() => startBotProduct(mockCtx(), { accountStream: accountStream(), discoverRoutes: 'nope' }), /BOT_PRODUCT_ROUTES_REQUIRED/)
})

test('startBotProduct defers to a valid provided policy and refuses an invalid one', () => {
  const ctx = mockCtx()
  ctx.provide('botIntegrationPolicy', { run() {}, check() {}, filterRoutes() {} })
  assert.equal(startBotProduct(ctx, { discoverRoutes: async () => [], accountStream: accountStream() }), null)
  const broken = mockCtx()
  broken.provide('botIntegrationPolicy', { run() {} })
  assert.throws(() => startBotProduct(broken, { discoverRoutes: async () => [], accountStream: accountStream() }), /BOT_PRODUCT_POLICY_CONFLICT/)
})

test('startBotProduct walks the raw configured-route catalog when no discovery is injected', async () => {
  const ctx = mockCtxWithCatalog(['fixture'])
  const handle = startBotProduct(ctx, { accountStream: accountStream(), failClosed: false })
  await handle.boot.catch(() => {})
  assert.deepEqual(handle.routeStatus(), { hydrated: true, routes: ['fixture/gpt-other', 'fixture/gpt-test'] })
  assert.deepEqual(handle.grantFor({ id: 'bot-a', model: 'fixture/gpt-test' }).modelRoutes, [{ provider: 'fixture', model: 'gpt-test' }])
  await handle.dispose()
})

test('startBotProduct provides the shared policy, hydrates routes and compiles grants from committed config', async () => {
  const ctx = mockCtx()
  const handle = startBotProduct(ctx, { discoverRoutes: async () => [{ provider: 'fixture', model: 'gpt-test' }, { provider: 'fixture', model: 'gpt-other' }],
    accountStream: accountStream(), machineId: 'local-test', workspaceId: 'workspace-test', failClosed: false })
  assert.ok(handle, 'the composition started')
  // The synchronous segment provides the policy before the first await returns.
  assert.equal(typeof ctx.get('botIntegrationPolicy').modelStream, 'function')
  // The DS runtime cannot boot on a bare mock context; the bounded initial refresh still hydrates.
  await handle.boot.catch(() => {})
  assert.deepEqual(handle.routeStatus(), { hydrated: true, routes: ['fixture/gpt-other', 'fixture/gpt-test'] })
  const granted = handle.grantFor({ id: 'bot-a', model: 'fixture/gpt-test' })
  assert.deepEqual(granted.modelRoutes, [{ provider: 'fixture', model: 'gpt-test' }])
  assert.deepEqual(granted.tools, [...PRODUCT_TOOLS])
  assert.deepEqual(handle.grantFor({ id: 'bot-b', model: 'unconfigured/model' }).modelRoutes, [])
  assert.equal(handle.grants.get('bot-a').modelRoutes.length, 1)
  assert.equal(handle.machineId, 'local-test')
  await handle.dispose()
})
test('default owner read methods remain accessible without granting model-originated or owner execution bypasses',async()=>{
  const ctx=mockCtx(),handle=startBotProduct(ctx,{accountStream:accountStream(),failClosed:false})
  await handle.boot.catch(()=>{})
  const policy=ctx.get('botIntegrationPolicy'),invocation={peer:{principal:{kind:'owner'}}}
  for(const name of PRODUCT_OWNER_READ_METHODS)assert.doesNotThrow(()=>policy.check({kind:'remote',name,invocation}))
  for(const name of ['startRun','rerunStep','terminalStart','terminalWrite','installTool'])assert.doesNotThrow(()=>policy.check({kind:'remote',name,invocation}))
  assert.throws(()=>policy.check({kind:'remote',name:'ledger',invocation:{peer:{principal:{kind:'agent'}}}}),/REMOTE_OWNER_REQUIRED/)
  await handle.dispose()
})

const apiSettings = (overrides = {}) => ({ schemaVersion: 1, enabled: true,
  model: { provider: 'fixture', model: 'gpt-test' }, officialTools: [], machineGrants: [], capabilities: [], workspaceRef: null,
  funding: { mode: 'api', scopeId: null, pricing: { input: 0.000001, output: 0.000002 },
    request: { maxInputTokens: 100_000, maxOutputTokens: 4096 }, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, subscription: null },
  maxConcurrentTasks: 1, ...overrides })

async function taskBackendHarness(bindings) {
  const workspace = join(await mkdtemp(join(tmpdir(), 'task-backends-')), 'read-workspace')
  const calls = []
  const mr = { executeConfiguredAssignment: async () => { calls.push('execute'); return { stored: true } },
    rerunRecordedStep: async () => { calls.push('rerun'); return { stored: true } },
    routerStateStore: () => ({ kind: 'stub-router-state' }) }
  const set = createTaskBackends({ ctx: { llm: {} }, mr, authority: {}, directory: { forBot: id => ({ id }) },
    store: { kind: 'sqlite-router-state' }, machineId: 'local-test', workspaceId: 'workspace-test', workspace,
    runtimeRoot: join(workspace, '..', 'cli-runtime'), bindingFor: botId => bindings[botId] ?? { status: 'blocked', settings: null } })
  return { set, calls, workspace }
}

const taskContext = (botId, overrides = {}) => ({ ownerBotId: botId, input: { task: 'fixture managed task' },
  signal: new AbortController().signal, binding: { taskId: 'task-1', attemptId: 'attempt-1', machineId: 'local-test', workspaceId: 'workspace-test', location: 'local' },
  attemptNumber: 1, legacyRunIds: [], operationId: 'operation-1', targetHash: 'a'.repeat(64),
  checkpoint: () => {}, beforeRequest: () => {}, ...overrides })

test('normalizeTaskCli accepts only an installation-verified official entry', () => {
  assert.equal(normalizeTaskCli(null), null)
  assert.equal(normalizeTaskCli(undefined), null)
  const entry = { executable: join(tmpdir(), 'codex.exe'), sha256: 'a'.repeat(64), version: '0.163.0' }
  const value = normalizeTaskCli({ entry, models: [{ provider: 'fixture', model: 'gpt-test', cliModel: 'gpt-5-codex' }] })
  assert.deepEqual(value.entry, entry)
  assert.deepEqual(value.models, [{ provider: 'fixture', model: 'gpt-test', cliModel: 'gpt-5-codex' }])
  assert.equal(value.sessionFactory, null)
  for (const broken of [{}, { entry: { ...entry, sha256: 'short' } }, { entry: { ...entry, executable: 'relative/codex' } },
    { entry: { ...entry, version: '163' } }, { entry, models: [{ provider: 'fixture', model: 'gpt-test', cliModel: 'not-a-gpt' }] },
    { entry, models: [{ provider: 'fixture', model: 'gpt-test', cliModel: 'gpt-5' }, { provider: 'fixture', model: 'gpt-test', cliModel: 'gpt-5' }] },
    { entry, sessionFactory: 7 }]) {
    assert.throws(() => normalizeTaskCli(broken), TypeError, JSON.stringify(broken))
  }
})

test('task backends keep a stable target contract and dispatch per Bot binding', async () => {
  const { set, calls } = await taskBackendHarness({ 'bot-a': { status: 'available', settings: apiSettings() },
    'bot-b': { status: 'available', settings: apiSettings({ funding: { mode: 'api', scopeId: null, pricing: { input: 0.000003, output: 0.000004 },
      request: { maxInputTokens: 100_000, maxOutputTokens: 4096 }, dailyBudgetUsd: 7, monthlyBudgetUsd: 50, subscription: null } }) },
    'bot-c': { status: 'blocked', settings: null },
    'bot-d': { status: 'available', settings: apiSettings({ funding: { mode: 'api', scopeId: null, pricing: null, request: null,
      dailyBudgetUsd: 5, monthlyBudgetUsd: 50, subscription: null } }) } })
  const [mrBackend] = set.backends
  assert.equal(mrBackend.id, 'mr-api')
  assert.equal(mrBackend.version, 'mr-read-product-v1')
  assert.equal(mrBackend.effect, 'read')
  assert.equal(mrBackend.location, 'local')
  assert.equal(mrBackend.capability, 'execution/mr-api')
  assert.equal(mrBackend.retryCapability, 'execution/mr-retry')
  assert.equal(mrBackend.reconcileCapability, 'execution/mr-observe')
  // The binding is the single source of truth for model and money, so the
  // durable target carries no model of its own.
  assert.equal(Object.hasOwn(mrBackend, 'model'), false)
  assert.throws(() => mrBackend.parse({ task: '' }), /INVALID_TASK_INPUT/)
  assert.throws(() => mrBackend.parse({ task: 'ok', extra: 1 }), /INVALID_TASK_INPUT/)
  assert.deepEqual(mrBackend.parse({ task: 'ok' }), { task: 'ok' })
  assert.deepEqual(set.catalog().map(item => item.id), ['mr-api'])
  // A configured Bot dispatches into its own inner backend; a second run of the
  // same binding reuses it, and another Bot gets its own priced inner.
  const first = await mrBackend.run(taskContext('bot-a'))
  assert.equal(first.outcome, 'unknown')
  assert.equal(typeof first.summary.code, 'string')
  await mrBackend.run(taskContext('bot-a'))
  await mrBackend.run(taskContext('bot-b'))
  assert.equal(calls.filter(kind => kind === 'execute').length, 3)
  // An unconfigured or incomplete binding never dispatches.
  for (const botId of ['bot-c', 'bot-d']) {
    assert.deepEqual(await mrBackend.run(taskContext(botId)), { outcome: 'failed', summary: { code: 'TASK_BINDING_UNAVAILABLE' } })
    assert.deepEqual(await mrBackend.reconcile(taskContext(botId)), { outcome: 'unknown', reason: 'TASK_BINDING_UNAVAILABLE' })
  }
  assert.equal(calls.length, 3)
})

test('task backends register the CLI backend only for a host-verified entry', async () => {
  const workspace = join(await mkdtemp(join(tmpdir(), 'task-backends-')), 'read-workspace')
  const base = { ctx: { llm: {} }, authority: {}, directory: { forBot: id => ({ id }) }, store: { kind: 'sqlite-router-state' },
    machineId: 'local-test', workspaceId: 'workspace-test', workspace, runtimeRoot: join(workspace, '..', 'cli-runtime'),
    bindingFor: () => ({ status: 'blocked', settings: null }) }
  assert.throws(() => createTaskBackends({ ...base, bindingFor: null }), /TASK_BACKEND_SERVICES_REQUIRED/)
  assert.throws(() => createTaskBackends({ ...base, directory: { forBot: null } }), /TASK_BACKEND_SERVICES_REQUIRED/)
  assert.throws(() => createTaskBackends({ ...base, store: { kind: 'json' } }), /TASK_BACKEND_STORE_REQUIRED/)
  const cli = { entry: { executable: join(tmpdir(), 'codex.exe'), sha256: 'b'.repeat(64), version: '0.163.0' }, sessionFactory: () => ({}) }
  const withCli = createTaskBackends({ ...base, mr: {}, cli })
  assert.deepEqual(withCli.backends.map(item => item.id), ['mr-api', 'codex-read'])
  assert.deepEqual(withCli.catalog().map(item => item.capability), ['execution/mr-api', 'cli/codex'])
  const [cliBackend] = withCli.backends.slice(1)
  assert.equal(cliBackend.reconcileCapability, 'cli/read')
  assert.deepEqual(await cliBackend.run(taskContext('bot-a')), { outcome: 'failed', summary: { code: 'TASK_BINDING_UNAVAILABLE' } })
  const withoutCli = createTaskBackends({ ...base, mr: {} })
  assert.deepEqual(withoutCli.backends.map(item => item.id), ['mr-api'])
})

async function until(value, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await value()
    if (result) return result
    if (Date.now() >= deadline) throw new Error('condition did not become true')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('product migration admission: a live writer blocks exclusive drain until dispose', async () => {
  const home = join(await mkdtemp(join(tmpdir(), 'product-migration-')), 'home')
  process.env.DSH_HOME = home
  const deferredRouterState = createDeferredRouterState({ file: join(home, 'model-router', 'orchestration.sqlite') })
  const ctx = mockCtx()
  ctx.tools = { register: () => () => {}, guard: () => () => {} }
  const handle = startBotProduct(ctx, { discoverRoutes: async () => [{ provider: 'fixture', model: 'gpt-test' }], accountStream: accountStream(), deferredRouterState, mr: { executeConfiguredAssignment: async () => ({}), rerunRecordedStep: async () => ({}), routerStateStore: () => ({}) }, failClosed: false })
  await until(async () => (await readMigrationFence(home)).liveShared.length === 1)
  await assert.rejects(beginMigrationExclusive(home, { operationId: 'op-product-drain', drainTimeoutMs: 100, pollMs: 20 }), { code: 'MIGRATION_FENCE_DRAIN_TIMEOUT' })
  await handle.dispose()
  const exclusive = await beginMigrationExclusive(home, { operationId: 'op-product-drain' })
  await exclusive.release()
})

test('product migration admission: a pending gate refuses writer creation and releases on failure', async () => {
  const home = join(await mkdtemp(join(tmpdir(), 'product-migration-gate-')), 'home')
  process.env.DSH_HOME = home
  await mkdir(home, { recursive: true })
  const operationId = randomUUID()
  await writeFile(join(home, 'migration-gate.json'), JSON.stringify({ schemaVersion: 1, kind: 'profile-migration-gate', operationId, home,
    operationDirectory: join(home, 'owner-private'), planDigest: 'a'.repeat(64), phase: 'maintenance', journalEvents: 0, journalHead: 'a'.repeat(64) }))
  const deferredRouterState = createDeferredRouterState({ file: join(home, 'model-router', 'orchestration.sqlite') })
  const handle = startBotProduct(mockCtx(), { discoverRoutes: async () => [{ provider: 'fixture', model: 'gpt-test' }], accountStream: accountStream(), deferredRouterState, mr: { executeConfiguredAssignment: async () => ({}), rerunRecordedStep: async () => ({}), routerStateStore: () => ({}) }, failClosed: false })
  await assert.rejects(handle.boot, { code: 'PROFILE_MIGRATION_PENDING' })
  await handle.dispose()
  const exclusive = await beginMigrationExclusive(home, { operationId: 'op-product-gate-failure' })
  await exclusive.release()
})
