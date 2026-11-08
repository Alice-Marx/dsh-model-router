import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultToolGrant, engineRail, officialToolCards, patchOfficialTool, toggleOfficialTool } from '../apps/integration-client/engine-binding.mjs'

const claude = { provider: 'anthropic', model: 'claude-sonnet', label: 'Claude Sonnet', cliModels: [{ toolId: 'claude-code', model: 'claude-sonnet' }] }
const gpt = { provider: 'openai', model: 'gpt-exact', label: 'GPT', cliModels: [] }
const tools = [
  { toolId: 'claude-code', label: 'Claude Code', vendor: 'Anthropic', source: '厂商官方 CLI', modes: ['read-only', 'workspace-write'] },
  { toolId: 'codex', label: 'Codex CLI', vendor: 'OpenAI', source: '厂商官方 CLI', modes: ['read-only'] },
  { toolId: 'kimi-code', label: 'Kimi Code', vendor: 'Moonshot AI', source: '厂商官方 CLI', modes: [] },
]

test('engine rail groups host catalog models and filters without inventing providers', () => {
  assert.deepEqual(engineRail([claude, gpt, { provider: '', model: 'x' }]).map(group => group.id), ['anthropic', 'openai'])
  assert.deepEqual(engineRail([claude, gpt], 'gpt').map(group => [group.id, group.models.map(model => model.model)]), [['openai', ['gpt-exact']]])
  assert.deepEqual(engineRail([claude], 'missing'), [])
})

test('official tools stay closed until the host verified the current brain', () => {
  const closed = officialToolCards({ tools, model: null, selected: [] })
  assert.equal(closed.every(card => card.status === 'needs-brain'), true)
  const cards = officialToolCards({ tools, model: claude, selected: [] })
  assert.equal(cards.find(card => card.toolId === 'claude-code').status, 'ready')
  assert.equal(cards.find(card => card.toolId === 'codex').status, 'unverified')
  assert.equal(cards.find(card => card.toolId === 'kimi-code').status, 'closed')
  assert.equal(defaultToolGrant(cards.find(card => card.toolId === 'codex')), null)
  assert.deepEqual(defaultToolGrant(cards.find(card => card.toolId === 'claude-code')), { toolId: 'claude-code', cliModel: 'claude-sonnet', mode: 'read-only' })
})

test('turning a verified tool on and realigning a stale grant keeps the host identity', () => {
  const ready = officialToolCards({ tools, model: claude, selected: [] }).find(card => card.toolId === 'claude-code')
  const selected = toggleOfficialTool([], ready, true)
  assert.deepEqual(selected, [{ toolId: 'claude-code', cliModel: 'claude-sonnet', mode: 'read-only' }])
  const patched = patchOfficialTool(selected, 'claude-code', { mode: 'workspace-write' })
  assert.equal(officialToolCards({ tools, model: claude, selected: patched }).find(card => card.toolId === 'claude-code').status, 'on')
  const stale = officialToolCards({ tools, model: claude, selected: [{ toolId: 'claude-code', cliModel: 'other', mode: 'read-only' }] })
  assert.equal(stale.find(card => card.toolId === 'claude-code').status, 'stale')
  assert.deepEqual(toggleOfficialTool([], ready, false), [])
})
