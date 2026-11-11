import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createBotPolicy } from '../packages/orchestration/src/bot-policy.mjs'
import { createBotOfficialAccess } from '../packages/orchestration/src/bot-official-access.mjs'
import { buildBotOfficialToolsCatalog, createBotOfficialToolsCatalog } from '../packages/orchestration/src/bot-official-tools.mjs'
import { compileBotSettingsGrant } from '../packages/orchestration/src/bot-settings.mjs'
import { createNativeOfficialTools } from '../packages/orchestration/src/native-official-tools.mjs'

const RUN = 'tool/model_router_tool_run', LIST = 'tool/model_router_tools'
const DEFAULT = 'vendor-default'
const request = () => ({ toolId: 'claude-code', cliModel: DEFAULT, mode: 'read-only' })
const code = expected => error => (Array.isArray(expected) ? expected : [expected]).includes(error.code)
const selected = () => ({ toolId: 'claude-code', cliModel: DEFAULT, mode: 'read-only' })
const health = () => ({ tools: ['claude-code', 'codex'].map(id => ({ id, installed: true, login: { state: 'logged-in' } })) })
const capabilities = () => ['claude-code', 'codex'].map(id => ({ id, supported: true, modes: ['read-only', 'workspace-write'] }))
const ready = id => ({ id, supported: true, ready: true, readyModes: ['read-only', 'workspace-write'] })

async function fixture(t, { main = false, ownerGrant = ['remote/probe', 'remote/startRun'] } = {}) {
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  const grant = { tools: ['model/infer', RUN, LIST], modelRoutes: [{ provider: 'unrelated-chat-provider', model: 'chat-model' }] }
  directory.register('worker', grant); directory.register('other', grant)
  const agent = { session: { id: 'worker-session' } }; directory.bind('worker', agent)
  const policy = createBotPolicy({ authority, directory, machineId: 'local', workspaceId: 'project', ownerGrant: { tools: ownerGrant } })
  const state = { clock: 100, report: health(), readiness: ready, probe: null, overrideIdentity: null, calls: 0,
    row: { revision: 1, status: 'available', settings: { enabled: true, model: grant.modelRoutes[0], officialTools: main ? [] : [selected()],
      workspaceRef: { kind: 'local', machineId: 'local', rootId: 'project' }, machineGrants: [{ machineId: 'local', rootId: 'project', mode: 'read-only', capabilities: [] }] } } }
  const catalog = createBotOfficialToolsCatalog({ probeHealth: async () => { state.calls++; await state.probe?.(); return state.report },
    probeCapabilities: capabilities, probeReadiness: async id => state.readiness(id), now: () => state.clock, ttlMs: 20,
    legacyModels: [{ toolId: 'claude-code', cliModel: 'known-exact-model' }] })
  await catalog.refresh()
  const access = createBotOfficialAccess({ catalog, identityFor: () => state.overrideIdentity ?? policy.activeIdentity(),
    settingsFor: () => structuredClone(state.row), isMainBot: () => main, assertTool: (subject, name) => authority.assertTool(subject, name) })
  const within = work => policy.modelContext(directory.forBot('worker'), new AbortController().signal, work, { botId: 'worker' })
  const run = work => policy.run({ kind: 'tool', name: 'model_router_tool_run', agent }, work)
  t.after(() => authority.dispose())
  return { authority, directory, policy, state, catalog, access, within, run, agent }
}

test('saved vendor-default grants retain discovery/run but not legacy exact-model CLI task powers', () => {
  const host = { models: [{ provider: 'chat', model: 'one', cliModels: [] }], capabilities: [{ id: 'infer', tools: ['model/infer'] }],
    tools: buildBotOfficialToolsCatalog({ health: health(), capabilities: capabilities(), readiness: [ready('codex')],
      legacyModels: [{ cliModel: 'old-exact' }], legacyTools: [{ toolId: 'codex', grantTools: ['cli/codex', 'cli/cancel', 'cli/read', 'cli/retry'] }] }) }
  const settings = { enabled: true, model: { provider: 'chat', model: 'one' }, capabilities: ['infer'], machineGrants: [],
    officialTools: [{ toolId: 'codex', cliModel: DEFAULT, mode: 'read-only' }] }
  assert.deepEqual(compileBotSettingsGrant(settings, host).tools, ['model/infer', LIST, RUN].sort())
  settings.officialTools[0].cliModel = 'old-exact'
  assert.ok(compileBotSettingsGrant(settings, host).tools.includes('cli/codex'))
  host.tools.find(tool => tool.toolId === 'codex').status = 'logged-out'
  assert.deepEqual(compileBotSettingsGrant(settings, host), { tools: ['model/infer'], modelRoutes: [{ provider: 'chat', model: 'one' }] })
})

test('real policy frame admits the saved CLI independently of the Bot chat route', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.run(() => f.access.authorize(request())), { cliModel: DEFAULT })
  assert.equal(f.policy.activeIdentity(), null)
  await assert.rejects(f.access.authorize(request()), code('OFFICIAL_CALL_CONTEXT_REQUIRED'))
})

test('unselected tools and disabled bindings are refused before probes', async t => {
  const f = await fixture(t), count = f.state.calls
  await assert.rejects(f.within(() => f.access.authorize({ ...request(), toolId: 'codex' })), code('OFFICIAL_TOOL_NOT_GRANTED'))
  f.state.row.settings.enabled = false
  await assert.rejects(f.within(() => f.access.authorize(request())), code('OFFICIAL_BINDING_UNAVAILABLE'))
  assert.equal(f.state.calls, count)
})

test('a Bot cannot change its selected CLI model, widen its mode or opt into cli-native', async t => {
  const f = await fixture(t)
  for (const extra of [{ cliModel: 'known-exact-model' }, { mode: 'workspace-write' }, { executionEnvironment: 'cli-native' }, { mode: 'cli-native' }]) {
    await assert.rejects(f.run(() => f.access.authorize({ ...request(), ...extra })), code(['OFFICIAL_TOOL_SCOPE_DENIED', 'OFFICIAL_ENVIRONMENT_DENIED', 'OFFICIAL_MODE_UNSUPPORTED']))
  }
})

test('CLI uninstall, logout, unknown login and bad launch readiness cannot start a call', async t => {
  for (const condition of ['uninstalled', 'logged-out', 'unknown', 'bad-entry']) {
    const f = await fixture(t)
    const entry = f.state.report.tools.find(item => item.id === 'claude-code')
    if (condition === 'uninstalled') entry.installed = false
    else if (condition === 'bad-entry') f.state.readiness = id => ({ id, supported: true, ready: false, reason: 'private executable path' })
    else entry.login.state = condition
    await assert.rejects(f.run(() => f.access.authorize(request())), code('OFFICIAL_TOOL_NOT_READY'))
    const row = f.access.snapshotFor('worker')[0]
    assert.deepEqual(row.modes, []); assert.deepEqual(row.identities, [])
    assert.doesNotMatch(JSON.stringify(row), /private executable path/)
  }
})

test('expiry may refresh a saved choice before checking the live CLI grant', async t => {
  const f = await fixture(t)
  f.state.clock += 20
  f.state.row.status = 'blocked'
  f.state.probe = () => { f.state.row.status = 'available' }
  assert.deepEqual(await f.within(() => f.access.authorize(request())), { cliModel: DEFAULT })
})

test('fresh unchanged catalogs do not republish grants; expired unchanged catalogs do', async () => {
  let at = 1, changes = 0
  const service = createBotOfficialToolsCatalog({ probeHealth: async () => health(), probeCapabilities: capabilities,
    probeReadiness: async id => ready(id), now: () => at, ttlMs: 10, onChanged: () => { changes++ } })
  await service.refresh(); assert.equal(changes, 1)
  await service.refresh({ fresh: true }); assert.equal(changes, 1)
  at += 10; await service.refresh({ fresh: true }); assert.equal(changes, 2)
})

test('revision changes, revocation and subject replacement during refresh all refuse admission', async t => {
  for (const change of ['revision', 'disabled', 'unselected', 'subject']) {
    const f = await fixture(t)
    f.state.probe = () => {
      if (change === 'revision') f.state.row.revision++
      else if (change === 'disabled') f.state.row.settings.enabled = false
      else if (change === 'unselected') f.state.row.settings.officialTools = []
      else f.state.overrideIdentity = { subject: f.directory.forBot('other'), botId: 'other', owner: false }
    }
    await assert.rejects(f.run(() => f.access.authorize(request())), code(['OFFICIAL_BINDING_CHANGED', 'OFFICIAL_BINDING_UNAVAILABLE', 'OFFICIAL_SUBJECT_CHANGED']))
  }
})

test('live capability revocation is checked after asynchronous refresh', async t => {
  const f = await fixture(t)
  f.state.probe = () => { f.directory.replaceGrant('worker', { tools: [], modelRoutes: [] }) }
  await assert.rejects(f.run(() => f.access.authorize(request())), code(['TOOL_DENIED', 'GRANT_CHANGED']))
})

test('Main skips ordinary Bot selections but still needs a live installed CLI', async t => {
  const f = await fixture(t, { main: true })
  assert.deepEqual(await f.run(() => f.access.authorize(request())), { cliModel: DEFAULT })
  assert.ok(f.access.snapshotFor('worker').some(tool => tool.toolId === 'codex'))
  f.state.report.tools[0].installed = false
  await assert.rejects(f.run(() => f.access.authorize(request())), code('OFFICIAL_TOOL_NOT_READY'))
})

test('owner workbench checks its real remote capability without borrowing Bot bindings', async t => {
  const f = await fixture(t)
  const owner = work => f.policy.run({ kind: 'remote', name: 'probe', invocation: { peer: { principal: { kind: 'owner' } } } }, work)
  const access = createBotOfficialAccess({ catalog: null, identityFor: () => f.policy.activeIdentity(),
    settingsFor: () => { throw new Error('owner must not borrow Bot binding') }, isMainBot: () => false,
    assertTool: (subject, name) => f.authority.assertTool(subject, name) })
  assert.deepEqual(await owner(() => access.authorize({ toolId: 'codex', cliModel: 'owner-exact', mode: 'workspace-write', executionEnvironment: 'cli-native' })), { cliModel: 'owner-exact' })
  f.policy.replaceOwnerGrant({ tools: ['remote/probe'] })
  await assert.rejects(owner(() => access.authorize(request())), code('TOOL_DENIED'))
})

test('Bot discovery shows only saved modes/identity; Main retains the trusted complete catalog', async t => {
  const f = await fixture(t)
  const view = f.access.snapshotFor('worker')
  assert.equal(view.length, 1); assert.deepEqual(view[0].modes, ['read-only'])
  assert.deepEqual(view[0].identities.map(identity => identity.model), [DEFAULT])
  assert.equal(view[0].grant.cliModel, DEFAULT)
  f.state.row.status = 'blocked'
  assert.deepEqual(f.access.snapshotFor('worker')[0].modes, [])
  assert.deepEqual(f.access.snapshotFor('worker')[0].identities, [])
  const main = await fixture(t, { main: true })
  assert.deepEqual(main.access.snapshotFor('worker').find(tool => tool.toolId === 'claude-code').modes, ['read-only', 'workspace-write'])
})

test('native parser admits only task/model/mode and refuses Host authority fields', async t => {
  const f = await fixture(t)
  const family = createNativeOfficialTools({ access: f.access, botId: 'worker', validate: () => {}, run: () => {}, within: (_signal, work) => f.within(work) })
  const run = family.handlers.find(handler => handler.definition.name === 'model_router_tool_run')
  for (const field of ['botId', 'cwd', 'root', 'endpoint', 'executable', 'credentials', 'environment', 'executionEnvironment', 'provider', 'model']) {
    assert.throws(() => run.parse({ tool: 'claude-code', task: 'read the fixture', [field]: 'untrusted' }), code('INVALID_TOOL_ARGS'))
  }
  assert.throws(() => run.parse({ tool: 'claude-code', task: ' ' }), code('INVALID_TOOL_ARGS'))
  assert.throws(() => family.handlers[0].parse({ botId: 'other' }), code('INVALID_TOOL_ARGS'))
  assert.deepEqual(run.parse({ tool: 'claude-code', task: 'read fixture', cliModel: DEFAULT }), { tool: 'claude-code', task: 'read fixture', cliModel: DEFAULT })
})

test('native handlers require a live turn and validate before and after the shared runner', async t => {
  const f = await fixture(t)
  let validations = 0, runs = 0
  const family = createNativeOfficialTools({ access: f.access, botId: 'worker', validate: () => { validations++ },
    within: (_signal, work) => f.within(work), run: async args => {
      runs++; await f.access.authorize({ toolId: args.tool, cliModel: args.cliModel, mode: args.mode })
      return { answer: 'fixture-secret', modelId: null }
    }, redact: text => text.replaceAll('fixture-secret', '[redacted]') })
  const handler = family.handlers.find(entry => entry.definition.name === 'model_router_tool_run')
  const args = handler.parse({ tool: 'claude-code', task: 'read fixture', cliModel: DEFAULT })
  await assert.rejects(handler.execute(args, {}), code('NATIVE_TOOL_TURN_REQUIRED'))
  const context = { context: { turnId: 'turn-1', callId: 'call-1' }, signal: new AbortController().signal }
  const result = await handler.execute(args, context)
  assert.equal(result.answer, '[redacted]'); assert.equal(result.modelId, null)
  assert.equal(validations, 2); assert.equal(runs, 1)
  const cancel = new AbortController(); cancel.abort(new Error('turn cancelled'))
  await assert.rejects(handler.execute(args, { ...context, signal: cancel.signal }), /turn cancelled/)
  assert.equal(runs, 1)
})
