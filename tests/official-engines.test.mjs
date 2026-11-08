import test from 'node:test'
import assert from 'node:assert/strict'
import { projectOfficialEngines } from '../.dsh-plugin/shared/official-engines.mjs'
import { OFFICIAL_TOOLS } from '../.dsh-plugin/shared/official-tool-registry.mjs'

const NOW = 1_800_000_000_000

test('official engines: every registry tool is listed once, unchecked before the first health report', () => {
  const view = projectOfficialEngines({ report: null, capabilities: [], now: NOW })
  assert.equal(view.status, 'available')
  assert.equal(view.checkedAt, null)
  assert.equal(view.stale, true)
  assert.deepEqual(view.items.map(row => row.id).sort(), OFFICIAL_TOOLS.map(tool => tool.id).sort())
  assert.ok(view.items.every(row => row.status === 'unchecked' && row.installed === false && row.version === null))
  assert.ok(view.items.every(row => row.execution.supported === false && row.execution.reason))
})

test('official engines: install, login and managed execution are separate facts', () => {
  const report = { checkedAt: NOW - 1_000, tools: [
    { id: 'kimi-code', installed: true, version: '2.1.1', latestVersion: '2.2.0', updateAvailable: true, login: { state: 'logged-in', billing: 'subscription', command: 'kimi login', detail: '已登录' } },
    { id: 'codex', installed: true, version: '0.80.0', login: { state: 'logged-out', billing: 'unknown', command: 'codex login' } },
    { id: 'gemini', installed: false, version: null, login: { state: 'unknown' } },
  ] }
  const capabilities = [
    { id: 'kimi-code', supported: true, modes: ['workspace-write', 'shell-anything'] },
    { id: 'codex', supported: false, reason: 'Codex 的签名原生入口目前仅在 Windows 完成适配。' },
  ]
  const view = projectOfficialEngines({ report, capabilities, now: NOW })
  const row = id => view.items.find(item => item.id === id)
  assert.equal(view.stale, false)
  assert.equal(view.items[0].id, 'kimi-code', 'tools the Host can run managed come first')
  assert.deepEqual(row('kimi-code'), {
    id: 'kimi-code', label: 'Kimi Code · Node', vendor: 'Moonshot AI', providerHints: ['moonshot', 'kimi'], status: 'ready', installed: true,
    version: '2.1.1', latestVersion: '2.2.0', updateAvailable: true,
    login: { state: 'logged-in', billing: 'subscription', command: 'kimi login', detail: '已登录' },
    execution: { supported: true, modes: ['workspace-write'] },
  })
  assert.equal(row('codex').status, 'needs-login')
  assert.equal(row('codex').login.billing, null, 'an unknown billing reading is not reported as a plan')
  assert.match(row('codex').execution.reason, /Windows/)
  assert.equal(row('gemini').status, 'needs-install')
  assert.equal(row('gemini').version, null)
})

test('official engines: a stale report is flagged and unknown fields never pass through', () => {
  const report = { checkedAt: NOW - 11 * 60_000, tools: [{ id: 'claude-code', installed: true, version: '2.1.300', executable: '/secret/path/claude',
    login: { state: 'weird', command: 'claude auth login', token: 'sk-should-not-leak' } }] }
  const view = projectOfficialEngines({ report, capabilities: [], now: NOW })
  const row = view.items.find(item => item.id === 'claude-code')
  assert.equal(view.stale, true)
  assert.equal(row.status, 'ready', 'an unreadable login state is unknown, not logged out')
  assert.equal(row.login.state, 'unknown')
  assert.doesNotMatch(JSON.stringify(view), /secret|sk-should-not-leak|executable|token/)
})
