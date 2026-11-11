import test from 'node:test'
import assert from 'node:assert/strict'
import { OFFICIAL_TOOLS } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { BOT_CLI_DEFAULT_MODEL, buildBotOfficialToolsCatalog, createBotOfficialToolsCatalog } from '../packages/orchestration/src/bot-official-tools.mjs'
import { defaultBotSettings, normalizeBotSettings, validateBotSettings } from '../packages/orchestration/src/bot-settings.mjs'

const card = (catalog, id = 'codex') => catalog.find(item => item.toolId === id)
const healthy = (id = 'codex') => ({ id, installed: true, login: { state: 'logged-in' } })
const capabilities = () => [{ id: 'codex', supported: true, modes: ['read-only'] }, { id: 'claude-code', supported: true, modes: ['read-only', 'workspace-write'] }]
const readiness = () => [{ id: 'codex', supported: true, ready: true, readyModes: ['read-only'] }, { id: 'claude-code', supported: true, ready: true, readyModes: ['read-only', 'workspace-write'] }]
const catalog = (patch = {}) => buildBotOfficialToolsCatalog({ health: { tools: [healthy(), healthy('claude-code')] }, capabilities: capabilities(), readiness: readiness(), ...patch })
const scopeDenied = error => error.code === 'BOT_SETTINGS_SCOPE_DENIED'

function bindingFixture() {
  const settings = { ...defaultBotSettings(), enabled: true, model: { provider: 'chat-provider', model: 'chat-model' },
    officialTools: [{ toolId: 'claude-code', cliModel: BOT_CLI_DEFAULT_MODEL, mode: 'read-only' }],
    machineGrants: [{ machineId: 'local', rootId: 'project', mode: 'read-only', capabilities: [] }],
    workspaceRef: { kind: 'local', machineId: 'local', rootId: 'project' },
    capabilities: ['model-inference'], funding: { mode: 'api', scopeId: 'chat-funding', pricing: { input: 1, output: 1 },
      request: { maxInputTokens: 100, maxOutputTokens: 100 }, dailyBudgetUsd: 1, monthlyBudgetUsd: 2, subscription: null } }
  const host = { models: [{ provider: 'chat-provider', model: 'chat-model', cliModels: [] }], tools: catalog(),
    capabilities: [{ id: 'model-inference', tools: ['model/infer'] }],
    machines: [{ machineId: 'local', location: 'local', roots: [{ rootId: 'project', modes: ['read-only', 'workspace-write'], capabilities: [] }] }],
    fundingScopes: [{ id: 'chat-funding', modes: ['api'] }] }
  return { settings, host }
}

test('official Bot catalog projects fixed registry entries, never executable or credential data', () => {
  const result = catalog({ health: { tools: [{ ...healthy(), executable: 'C:/private/bin/codex.exe', credential: 'fixture-private', login: { state: 'logged-in', detail: 'C:/private/auth.json', token: 'fixture-private' } }] },
    readiness: [{ id: 'codex', supported: true, ready: true, readyModes: ['read-only'], executable: 'C:/private/bin/codex.exe', credentials: 'fixture-private' }] })
  assert.equal(result.length, OFFICIAL_TOOLS.length)
  assert.equal(card(result).status, 'ready')
  assert.deepEqual(card(result).identities, [{ model: 'vendor-default', label: '厂商默认模型（由 CLI 配置决定）' }])
  assert.deepEqual(card(result).grantTools, ['tool/model_router_tool_run', 'tool/model_router_tools'])
  assert.doesNotMatch(JSON.stringify(result), /private|token|auth\.json|executable/)
})

test('installation, login and trusted execution readiness are separately required', () => {
  for (const [probe, expected] of [
    [{ id: 'codex', installed: false, login: { state: 'logged-in' } }, 'not-installed'],
    [{ ...healthy(), login: { state: 'logged-out' } }, 'logged-out'],
    [{ ...healthy(), login: { state: 'unknown' } }, 'login-unknown'],
  ]) {
    const entry = card(catalog({ health: { tools: [probe] } }))
    assert.equal(entry.status, expected)
    assert.deepEqual(entry.identities, [])
    assert.deepEqual(entry.modes, [])
    assert.deepEqual(entry.grantTools, [])
  }
  const failed = card(catalog({ readiness: [{ id: 'codex', supported: true, ready: false, reason: 'C:/secret/entry.exe' }] }))
  assert.equal(failed.status, 'unavailable'); assert.deepEqual(failed.identities, []); assert.doesNotMatch(failed.reason, /secret/)
})

test('terminal-only tools remain discoverable without pretending to support Bot execution', () => {
  const result = catalog({ health: { tools: [healthy('opencode')] }, capabilities: [{ id: 'opencode', supported: false }], readiness: [{ id: 'opencode', supported: false, ready: false }] })
  assert.equal(card(result, 'opencode').status, 'terminal-only')
  assert.match(card(result, 'opencode').reason, /仅终端交互/)
  assert.deepEqual(card(result, 'opencode').identities, []); assert.deepEqual(card(result, 'opencode').modes, [])
  assert.equal(card(buildBotOfficialToolsCatalog()).status, 'checking')
})

test('only intersected ready modes and explicit legacy configuration enter the catalog', () => {
  const entry = card(catalog({ readiness: [{ id: 'codex', supported: true, ready: true, readyModes: ['read-only', 'workspace-write', 'arbitrary'] }],
    legacyModels: [{ provider: 'chat-provider', model: 'chat-model', cliModel: 'known-codex-model' }],
    legacyTools: [{ toolId: 'codex', grantTools: ['cli/codex', 'cli/cancel', 'cli/read', 'cli/retry', 'tool/arbitrary'] }] }))
  assert.deepEqual(entry.modes, ['read-only'])
  assert.deepEqual(entry.identities.map(item => item.model), ['vendor-default', 'known-codex-model'])
  assert.deepEqual(entry.grantTools, ['tool/model_router_tool_run', 'tool/model_router_tools', 'cli/codex', 'cli/cancel', 'cli/read', 'cli/retry'])
})

test('a ready CLI is grantable independently from the Bot chat provider and model', () => {
  const f = bindingFixture()
  const saved = validateBotSettings(f.settings, f.host)
  assert.equal(saved.settings.model.provider, 'chat-provider')
  assert.equal(saved.settings.officialTools[0].toolId, 'claude-code')
  assert.equal(saved.settings.officialTools[0].cliModel, 'vendor-default')
  assert.equal(card(saved.catalog.tools, 'claude-code').status, 'ready')
  f.host.models.push({ provider: 'another-chat-provider', model: 'another-chat-model', cliModels: [] })
  f.settings.model = { provider: 'another-chat-provider', model: 'another-chat-model' }
  assert.doesNotThrow(() => validateBotSettings(f.settings, f.host))
})

test('new identity revocations cannot fall back to an old chat-model mapping', () => {
  for (const status of ['not-installed', 'logged-out', 'login-unknown', 'terminal-only', 'unavailable', 'checking']) {
    const f = bindingFixture(), entry = card(f.host.tools, 'claude-code')
    f.host.models[0].cliModels = [{ toolId: 'claude-code', model: 'vendor-default' }]
    entry.status = status; entry.identities = []
    assert.throws(() => validateBotSettings(f.settings, f.host), scopeDenied)
  }
})

test('new catalogs reject forged CLI identity or a wider execution mode', () => {
  const f = bindingFixture()
  f.settings.officialTools[0].cliModel = 'invented-model'
  assert.throws(() => validateBotSettings(f.settings, f.host), scopeDenied)
  f.settings.officialTools = [{ toolId: 'codex', cliModel: 'vendor-default', mode: 'workspace-write' }]
  assert.throws(() => validateBotSettings(f.settings, f.host), scopeDenied)
  f.settings.officialTools = [{ toolId: 'claude-code', cliModel: 'vendor-default', mode: 'read-only', executable: 'C:/untrusted.exe' }]
  assert.throws(() => normalizeBotSettings(f.settings), error => error.code === 'BOT_SETTINGS_INVALID')
})

test('CLI writing requires the same committed writable workspace root', () => {
  const f = bindingFixture()
  f.settings.officialTools[0].mode = 'workspace-write'
  assert.throws(() => validateBotSettings(f.settings, f.host), scopeDenied)
  f.host.machines[0].roots.push({ rootId: 'other', modes: ['workspace-write'], capabilities: [] })
  f.settings.machineGrants.push({ machineId: 'local', rootId: 'other', mode: 'workspace-write', capabilities: [] })
  assert.throws(() => validateBotSettings(f.settings, f.host), scopeDenied)
  f.settings.machineGrants[0].mode = 'workspace-write'
  assert.doesNotThrow(() => validateBotSettings(f.settings, f.host))
})

test('legacy Host directories retain explicit exact Codex model bindings without widening', () => {
  const f = bindingFixture()
  f.host.tools = [{ toolId: 'codex', modes: ['read-only'], grantTools: ['cli/codex'] }]
  f.host.models[0].cliModels = [{ toolId: 'codex', model: 'legacy-exact-model' }]
  f.settings.officialTools = [{ toolId: 'codex', cliModel: 'legacy-exact-model', mode: 'read-only' }]
  assert.doesNotThrow(() => validateBotSettings(f.settings, f.host))
  f.settings.officialTools[0].cliModel = 'vendor-default'
  assert.throws(() => validateBotSettings(f.settings, f.host), scopeDenied)
})

function serviceFixture(extra = {}) {
  let clock = 100, health = { tools: [healthy()] }, healthCalls = 0
  const service = createBotOfficialToolsCatalog({ probeHealth: async () => { healthCalls++; return health },
    probeCapabilities: capabilities, probeReadiness: async id => readiness().find(item => item.id === id), now: () => clock, ttlMs: 20, ...extra })
  return { service, advance: value => { clock += value }, setHealth: value => { health = value }, calls: () => healthCalls }
}

test('Host catalog cache refreshes once, exposes copies, and closes expired grants', async () => {
  const f = serviceFixture()
  assert.equal(card(f.service.snapshot()).status, 'checking')
  const [first, second] = await Promise.all([f.service.refresh(), f.service.refresh()])
  assert.equal(f.calls(), 1); assert.equal(card(first).status, 'ready'); assert.deepEqual(first, second)
  card(first).identities.length = 0
  assert.equal(card(f.service.snapshot()).identities.length, 1)
  f.advance(20)
  assert.equal(card(f.service.snapshot()).status, 'checking')
  assert.deepEqual(card(f.service.snapshot()).identities, [])
  await f.service.refresh(); assert.equal(f.calls(), 2)
  f.setHealth({ tools: [{ ...healthy(), login: { state: 'logged-out' } }] })
  await f.service.refresh({ fresh: true })
  assert.equal(card(f.service.snapshot()).status, 'logged-out')
})

test('refresh failure removes previously available identities instead of serving stale grants', async () => {
  let fail = false
  const f = serviceFixture({ probeHealth: async () => { if (fail) throw new Error('private path or credential fixture'); return { tools: [healthy()] } } })
  await f.service.refresh(); fail = true
  const result = await f.service.refresh({ fresh: true })
  assert.equal(card(result).status, 'unavailable'); assert.deepEqual(card(result).identities, [])
  assert.doesNotMatch(JSON.stringify(result), /private path|credential fixture/)
})

test('invalidating a pending probe prevents its old result from regranting a tool', async () => {
  let resolveHealth
  const f = serviceFixture({ probeHealth: () => new Promise(resolve => { resolveHealth = resolve }) })
  const pending = f.service.refresh()
  f.service.invalidate()
  resolveHealth({ tools: [healthy()] })
  assert.equal(card(await pending).status, 'checking')
  assert.deepEqual(card(f.service.snapshot()).identities, [])
})

test('a failed Host change publication also closes the fresh snapshot', async () => {
  const f = serviceFixture({ onChanged: () => { throw new Error('cannot publish scope') } })
  await assert.rejects(f.service.refresh(), /cannot publish scope/)
  assert.equal(card(f.service.snapshot()).status, 'unavailable')
  assert.deepEqual(card(f.service.snapshot()).grantTools, [])
})
