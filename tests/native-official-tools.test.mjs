import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createBotOfficialAccess } from '../packages/orchestration/src/bot-official-access.mjs'
import { createNativeOfficialTools } from '../packages/orchestration/src/native-official-tools.mjs'
import { runOfficialTask } from '../.dsh-plugin/shared/official-team-runtime.mjs'

// Real handlers, principal authority, per-call admission and JSON checkpoints.
// Only CLI readiness/output are offline doubles. No SQLite, spawned process,
// account, model request, API fallback or user DSH data is used by this suite.
const parent = resolve('tmp/integration/native-official-tools')
await mkdir(parent, { recursive: true })
const home = await mkdtemp(join(parent, 'case-')), workspace = join(home, 'workspace')
await mkdir(workspace)
const priorHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const core = await import('../.dsh-plugin/router-core.mjs')
test.after(async () => {
  if (priorHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = priorHome
  assert.ok(resolve(home).startsWith(parent + sep))
  await rm(home, { recursive: true, force: true })
})

const LIST = 'model_router_tools', RUN = 'model_router_tool_run'
const CAPABILITIES = [`tool/${LIST}`, `tool/${RUN}`]
const context = (signal = new AbortController().signal, extra = {}) => ({ signal, context: { turnId: 'turn-native-1', callId: 'call-native-1', ...extra } })
const readyTool = () => ({ toolId: 'codex', label: 'Codex CLI', source: '厂商官方 CLI', vendor: 'OpenAI', installed: true,
  loginState: 'logged-in', status: 'ready', reason: '受限执行入口已就绪。', modes: ['read-only'],
  identities: [{ model: 'vendor-default', label: '厂商默认模型（由 CLI 配置决定）' }] })
const result = { status: 'succeeded', finalText: 'offline native official result', requestedModel: null,
  reportedModel: 'fixture-vendor-reported-model', usage: { inputTokens: 2, outputTokens: 3 }, exitCode: 0 }
const failure = code => Object.assign(new Error(code), { code })

function fixture({ capabilities = CAPABILITIES, owner = false, bound = true, status = 'ready', cliModel = 'vendor-default', withinBotId = 'bot-a' } = {}) {
  const events = [], frames = new AsyncLocalStorage(), authority = createAuthority(), directory = createPrincipalDirectory(authority)
  directory.register('bot-a', { tools: capabilities, modelRoutes: [] })
  directory.register('bot-b', { tools: CAPABILITIES, modelRoutes: [] })
  const subject = directory.forBot('bot-a')
  const state = { tools: [{ ...readyTool(), status, ...(status === 'ready' ? {} : { modes: [], identities: [], reason: 'CLI 已退出登录，请重新登录。' }) }],
    row: { botId: 'bot-a', revision: 1, status: 'available', settings: { enabled: bound,
      model: { provider: 'unrelated-chat-provider', model: 'chat-model' },
      officialTools: [{ toolId: 'codex', cliModel, mode: 'read-only' }],
      workspaceRef: { kind: 'local', machineId: 'local', rootId: 'project' },
      machineGrants: [{ machineId: 'local', rootId: 'project', mode: 'read-only' }] } },
    validations: 0, launches: [], runs: [], refreshes: 0, onRefresh: null, onValidate: null, onRun: null }
  const catalog = { snapshot: () => structuredClone(state.tools), refresh: async () => {
    state.refreshes++; events.push('refresh')
    await state.onRefresh?.(frames.getStore())
    return structuredClone(state.tools)
  } }
  const access = createBotOfficialAccess({ catalog, identityFor: () => frames.getStore()?.identity,
    settingsFor: botId => botId === 'bot-a' ? structuredClone(state.row) : null, isMainBot: () => false,
    assertTool: (principal, capability) => authority.assertTool(principal, capability) })
  const ctx = { get: key => key === 'botOfficialTools' ? access : key === 'botIntegrationPolicy'
    ? { activeIdentity: () => frames.getStore()?.identity } : null,
    sandbox: { confine() { throw new Error('No native process may be started in this pure test') } } }
  const validate = async () => {
    events.push('validate'); state.validations++
    await state.onValidate?.(state.validations)
  }
  const within = async (signal, work) => frames.run({ identity: { subject: directory.forBot(withinBotId), botId: withinBotId, owner }, signal }, async () => {
    events.push('within'); signal.throwIfAborted(); return work()
  })
  const run = async (args, options) => {
    events.push('run'); state.runs.push({ args: structuredClone(args), options, identity: frames.getStore()?.identity })
    await state.onRun?.(frames.getStore())
    return core.executeBotOfficialTool(ctx, {}, args, { ...options, cwd: workspace, root: workspace,
      runTask: request => runOfficialTask({ ...request, runtime: {
        readiness: async id => ({ id, ready: true, readyModes: ['read-only'] }),
        runTool: async request => { state.launches.push(request); return result },
      } }) })
  }
  const native = createNativeOfficialTools({ access, botId: 'bot-a', validate, within, run })
  const handler = name => native.handlers.find(entry => entry.definition.name === name)
  const invoke = (name, args = name === LIST ? {} : { tool: 'codex', task: 'Read the offline workspace' }, call = context()) => {
    const entry = handler(name)
    return entry.execute(entry.parse(args), call)
  }
  return { events, frames, authority, directory, subject, state, access, native, handler, invoke, validate, within, run }
}

test('native official contract: separate discovery/execution capabilities and closed business-only argument schemas', () => {
  const f = fixture()
  assert.deepEqual(f.native.tools, [LIST, RUN])
  for (const name of [LIST, RUN]) {
    const entry = f.handler(name)
    assert.equal(entry.capability, `tool/${name}`)
    assert.equal(entry.definition.inputSchema.additionalProperties, false)
  }
  assert.deepEqual(Object.keys(f.handler(RUN).definition.inputSchema.properties), ['tool', 'task', 'cliModel', 'mode'])
  assert.deepEqual(f.handler(RUN).definition.inputSchema.required, ['tool', 'task'])
  assert.deepEqual(f.handler(LIST).parse({}), {})
  for (const key of ['botId', 'subject', 'path', 'cwd', 'root', 'endpoint', 'executable', 'argv', 'credentials', 'within', 'signal']) {
    assert.throws(() => f.handler(RUN).parse({ tool: 'codex', task: 'read', [key]: 'forged' }), { code: 'INVALID_TOOL_ARGS' }, key)
    assert.throws(() => f.handler(LIST).parse({ [key]: 'forged' }), { code: 'INVALID_TOOL_ARGS' }, key)
  }
  const invalid = [null, [], 'x', 7, Object.create(null), { tool: '', task: 'read' }, { tool: 'codex', task: '   ' },
    { tool: 'codex', task: 'x'.repeat(32001) }, { tool: 'codex', task: 'read', cliModel: '--forged' },
    { tool: 'codex', task: 'read', mode: 'cli-native' }, { tool: 'codex', task: 'read', cliModel: {} }]
  for (const args of invalid) assert.throws(() => f.handler(RUN).parse(args), { code: 'INVALID_TOOL_ARGS' })
  assert.equal(f.state.runs.length, 0)
  assert.equal(f.state.launches.length, 0)
})

test('native official registration offers no tools for an absent or disabled saved Bot', () => {
  const f = fixture({ bound: false })
  assert.deepEqual(f.native, { tools: [], handlers: [] })
  assert.deepEqual(f.events, [])
})

test('native official list/run enforce their own distinct live grants, independently of the bridge', async () => {
  const listOnly = fixture({ capabilities: [`tool/${LIST}`] })
  assert.equal((await listOnly.invoke(LIST)).tools[0].toolId, 'codex')
  await assert.rejects(listOnly.invoke(RUN), { code: 'TOOL_DENIED' })
  assert.equal(listOnly.state.runs.length, 0)
  const runOnly = fixture({ capabilities: [`tool/${RUN}`] })
  await assert.rejects(runOnly.invoke(LIST), { code: 'TOOL_DENIED' })
  assert.equal((await runOnly.invoke(RUN)).status, 'succeeded')
  assert.equal(runOnly.state.launches.length, 1)
  const revoked = fixture(), retained = revoked.handler(RUN)
  revoked.authority.replaceGrant(revoked.subject, { tools: [], modelRoutes: [] })
  await assert.rejects(retained.execute(retained.parse({ tool: 'codex', task: 'read' }), context()), { code: 'TOOL_DENIED' })
  assert.equal(revoked.state.runs.length, 0)
})

test('native official authority always comes from the Host within scope, never model/turn metadata or an owner frame', async () => {
  const f = fixture()
  await f.invoke(LIST, {}, context(undefined, { botId: 'bot-b', owner: true, subject: f.directory.forBot('bot-b') }))
  assert.equal(f.state.runs.length, 0)
  for (const options of [{ withinBotId: 'bot-b' }, { owner: true }]) {
    const forged = fixture(options)
    await assert.rejects(forged.invoke(RUN), { code: 'OFFICIAL_SUBJECT_CHANGED' })
    assert.equal(forged.state.runs.length, 0)
    assert.equal(forged.state.launches.length, 0)
  }
})

test('native official handlers require a live turn and check cancellation before validation, within and output', async () => {
  const missing = fixture()
  for (const call of [{}, { signal: new AbortController().signal, context: { turnId: 'x' } }, { context: { turnId: 'x', callId: 'y' } }]) {
    await assert.rejects(missing.handler(RUN).execute({ tool: 'codex', task: 'read' }, call), { code: 'NATIVE_TOOL_TURN_REQUIRED' })
  }
  assert.deepEqual(missing.events, [])
  const before = fixture(), cancelled = new AbortController(); cancelled.abort(failure('HOST_CANCELLED'))
  await assert.rejects(before.invoke(RUN, undefined, context(cancelled.signal)), { code: 'HOST_CANCELLED' })
  assert.deepEqual(before.events, [])
  const duringValidation = fixture(), controller = new AbortController()
  duringValidation.state.onValidate = () => controller.abort(failure('HOST_CANCELLED'))
  await assert.rejects(duringValidation.invoke(RUN, undefined, context(controller.signal)), { code: 'HOST_CANCELLED' })
  assert.deepEqual(duringValidation.events, ['validate'])
  const after = fixture(), finishing = new AbortController()
  after.state.onRun = () => finishing.abort(failure('HOST_CANCELLED'))
  await assert.rejects(after.invoke(RUN, undefined, context(finishing.signal)), { code: 'HOST_CANCELLED' })
  assert.equal(after.state.launches.length, 0)
})

test('native official validation fences both sides and grant revocation before output is rejected', async () => {
  const before = fixture()
  before.state.onValidate = () => { throw failure('HOST_CONTEXT_CHANGED') }
  await assert.rejects(before.invoke(RUN), { code: 'HOST_CONTEXT_CHANGED' })
  assert.equal(before.state.runs.length, 0)
  const after = fixture()
  after.state.onValidate = count => { if (count === 2) throw failure('HOST_CONTEXT_CHANGED') }
  await assert.rejects(after.invoke(LIST), { code: 'HOST_CONTEXT_CHANGED' })
  assert.deepEqual(after.events, ['validate', 'within', 'validate'])
  const revoked = fixture()
  revoked.state.onRun = () => revoked.authority.replaceGrant(revoked.subject, { tools: [], modelRoutes: [] })
  await assert.rejects(revoked.invoke(RUN), { code: 'TOOL_DENIED' })
  assert.equal(revoked.state.launches.length, 0)
})

test('native official list can explain an unavailable CLI, but the same retained run handler launches nothing', async () => {
  const f = fixture({ status: 'logged-out' })
  const rows = (await f.invoke(LIST)).tools
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'logged-out')
  assert.match(rows[0].reason, /重新登录/)
  await assert.rejects(f.invoke(RUN), { code: 'OFFICIAL_TOOL_NOT_READY' })
  assert.equal(f.state.launches.length, 0)
})

test('native official fresh admission refuses readiness, saved-identity and policy-identity changes before any CLI launch', async () => {
  for (const change of ['readiness', 'binding', 'identity']) {
    const f = fixture()
    f.state.onRefresh = frame => {
      if (change === 'readiness') f.state.tools = [{ ...readyTool(), status: 'logged-out', identities: [], modes: [] }]
      if (change === 'binding') { f.state.row.revision++; f.state.row.settings.officialTools[0].cliModel = 'changed-model' }
      if (change === 'identity') frame.identity = { subject: f.directory.forBot('bot-b'), botId: 'bot-b', owner: false }
    }
    const code = { readiness: 'OFFICIAL_TOOL_NOT_READY', binding: 'OFFICIAL_BINDING_CHANGED', identity: 'OFFICIAL_SUBJECT_CHANGED' }[change]
    await assert.rejects(f.invoke(RUN), { code }, change)
    assert.equal(f.state.launches.length, 0, change)
    assert.equal(f.state.runs[0].identity.botId, 'bot-a', 'the trusted run scope starts with the captured Host Bot')
  }
})

test('native official default identity reaches the actual shared execute/ledger path but never the CLI model argument', async () => {
  const f = fixture(), response = await f.invoke(RUN, { tool: 'codex', task: 'Read the offline workspace', cliModel: 'vendor-default', mode: 'read-only' }, context(undefined, { botId: 'forged-bot' }))
  assert.equal(response.status, 'succeeded')
  assert.equal(f.state.validations, 2)
  assert.equal(f.state.runs.length, 1)
  assert.equal(f.state.runs[0].identity.botId, 'bot-a')
  assert.equal(f.state.launches.length, 1)
  assert.equal(f.state.launches[0].modelId, null, 'vendor-default is never sent as a --model value')
  assert.equal(f.state.launches[0].workspace, workspace, 'the final workspace is a Host argument')
  assert.equal(f.state.runs[0].options.signal instanceof AbortSignal, true)
  const ledger = await core.routerStateStore().read(), recorded = ledger.runs.find(run => run.id === response.runId)
  assert.ok(recorded)
  assert.equal(recorded.toolRun.cliModel, 'vendor-default')
  assert.equal(recorded.packages[0].requestedCliModel, null)
  assert.equal(recorded.packages[0].actualModel, 'fixture-vendor-reported-model')
  assert.equal(f.events[0], 'validate'); assert.equal(f.events[1], 'within'); assert.equal(f.events.at(-1), 'validate')
})

test('native official rendering redacts nested result strings without changing JSON types', async () => {
  const f = fixture(), native = createNativeOfficialTools({ access: f.access, botId: 'bot-a', validate: f.validate, within: f.within,
    run: async () => ({ status: 'succeeded', detail: 'private-fixture-secret', nested: ['private-fixture-secret', 7, true], count: 1 }),
    redact: value => value.replaceAll('private-fixture-secret', '[redacted]') })
  const handler = native.handlers.find(entry => entry.definition.name === RUN)
  const value = await handler.execute(handler.parse({ tool: 'codex', task: 'read' }), context())
  assert.equal(value.detail, '[redacted]')
  assert.deepEqual(value.nested, ['[redacted]', 7, true])
  assert.equal(value.count, 1)
  assert.equal(handler.render(value).content[0].type, 'text')
  assert.doesNotMatch(handler.render(value).content[0].text, /private-fixture-secret/)
})
