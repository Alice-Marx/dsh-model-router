import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { defaultBotSettings, normalizeBotSettings, openBotSettings, validateBotSettings } from '../packages/orchestration/src/bot-settings.mjs'

const catalog = {
  models: [
    { provider: 'openai', model: 'gpt-exact', label: 'gpt-exact', cliModels: [{ toolId: 'codex', model: 'gpt-5.4' }] },
    { provider: 'anthropic', model: 'claude-exact', label: 'claude-exact', cliModels: [{ toolId: 'codex', model: 'gpt-5.4' }] },
  ],
  tools: [{ toolId: 'codex', modes: ['read-only', 'workspace-write'], grantTools: ['tool/official_codex'] }],
  machines: [{ machineId: 'local-host', label: '本机', location: 'local', status: 'ready', roots: [{ rootId: 'default', label: '默认', modes: ['read-only', 'workspace-write'], capabilities: [] }] }],
  capabilities: [{ id: 'model-inference', label: '模型推理', tools: ['model/infer'] }],
  fundingScopes: [{ id: 'openai-main', label: 'openai', modes: ['api'] }],
}

const funding = { mode: 'api', scopeId: 'openai-main', pricing: { input: 1, output: 2 }, request: { maxInputTokens: 1000, maxOutputTokens: 100 }, dailyBudgetUsd: 1, monthlyBudgetUsd: 2, subscription: null }

function enabled(extra = {}) {
  return {
    schemaVersion: 1, enabled: true,
    model: { provider: 'openai', model: 'gpt-exact' },
    selection: { instanceId: 'api:openai', model: 'gpt-exact', effort: 'high', variant: null },
    fallback: [{ instanceId: 'api:anthropic', model: 'claude-exact' }],
    officialTools: [],
    machineGrants: [{ machineId: 'local-host', rootId: 'default', mode: 'read-only', capabilities: [] }],
    capabilities: ['model-inference'],
    workspaceRef: { kind: 'local', machineId: 'local-host', rootId: 'default' },
    funding, maxConcurrentTasks: 1, routing: null,
    ...extra,
  }
}

test('legacy bindings gain an empty engine selection without a new schema', () => {
  const legacy = { ...defaultBotSettings() }
  delete legacy.selection
  delete legacy.fallback
  const settings = normalizeBotSettings(legacy)
  assert.equal(settings.schemaVersion, 1)
  assert.equal(settings.selection, null)
  assert.deepEqual(settings.fallback, [])
})

test('an engine selection must name the same committed route, and a tool engine must grant that tool', () => {
  const api = validateBotSettings(enabled(), catalog)
  assert.equal(api.settings.selection.effort, 'high')
  assert.equal(api.catalog.engines.find(engine => engine.instanceId === 'tool:codex').models[0].id.includes('@'), true)
  assert.throws(() => validateBotSettings(enabled({ selection: { instanceId: 'api:openai', model: 'claude-exact' } }), catalog), { code: 'BOT_SETTINGS_SCOPE_DENIED' })
  assert.throws(() => validateBotSettings(enabled({ selection: { instanceId: 'tool:codex', model: 'gpt-5.4@openai/gpt-exact' } }), catalog), { code: 'BOT_SETTINGS_SCOPE_DENIED' })
  const tool = validateBotSettings(enabled({
    selection: { instanceId: 'tool:codex', model: 'gpt-5.4@openai/gpt-exact', effort: null, variant: 'fast' },
    officialTools: [{ toolId: 'codex', cliModel: 'gpt-5.4', mode: 'workspace-write' }],
  }), catalog)
  assert.equal(tool.settings.selection.variant, 'fast')
  assert.equal(tool.settings.model.model, 'gpt-exact')
})

test('fallback models are stored in order and are not granted as model routes', async () => {
  assert.throws(() => normalizeBotSettings(enabled({ fallback: [{ instanceId: 'api:openai', model: 'gpt-exact' }] })), { code: 'BOT_SETTINGS_DUPLICATE' })
  assert.throws(() => normalizeBotSettings(enabled({ selection: { instanceId: 'api:openai', model: 'gpt-exact', effort: 'huge' } })), { code: 'BOT_SETTINGS_INVALID' })
  const parent = resolve('tmp/integration/bot-model-selection'); mkdirSync(parent, { recursive: true })
  const file = join(mkdtempSync(join(parent, 'case-')), 'host.sqlite')
  const store = openBotSettings({ Database, file, catalogFor: () => catalog, botExists: () => true })
  try {
    const saved = await store.save({ botId: 'bot-main', expectedRevision: 0, settings: enabled() }, { kind: 'owner' })
    assert.deepEqual(saved.grant.modelRoutes, [{ provider: 'openai', model: 'gpt-exact' }])
    assert.deepEqual(saved.recoveryRoutes, [{ instanceId: 'api:anthropic', model: 'claude-exact', provider: 'anthropic', routeModel: 'claude-exact' }])
    assert.equal(store.grantFor({ id: 'bot-main', model: 'openai/gpt-exact' }).modelRoutes.length, 1)
    assert.equal(store.grantFor({ id: 'bot-main', model: 'anthropic/claude-exact' }).modelRoutes.length, 0)
  } finally { store.close() }
})
