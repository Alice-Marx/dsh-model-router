import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OFFICIAL_TOOLS,
  getOfficialTool,
  toolForProvider,
  installCommandLine,
} from '../.dsh-plugin/shared/official-tool-registry.mjs'
import {
  versionFromBanner,
  probeToolWith,
  startInstall,
  installStatus,
  resetForTests,
} from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import { createPlanFromRoutes, channelForProvider } from '../.dsh-plugin/shared/harness-plan.mjs'

test('registry stays fail-closed and internally consistent', () => {
  const ids = OFFICIAL_TOOLS.map(tool => tool.id)
  assert.equal(new Set(ids).size, ids.length, 'tool ids must be unique')
  for (const tool of OFFICIAL_TOOLS) {
    if (tool.unsupported) {
      assert.ok(tool.unsupportedReason.length > 10, `${tool.id} needs an actionable reason`)
      assert.equal(installCommandLine(tool), null, `${tool.id} must not expose an install command`)
    } else {
      assert.ok(tool.package && tool.installArgs.length > 0, `${tool.id} needs a fixed install`)
      assert.ok(Array.isArray(tool.probeExecutables) && tool.probeExecutables.length > 0, `${tool.id} needs probe executables`)
      assert.equal(installCommandLine(tool).split(/\s+/)[0], tool.manager)
    }
  }
  assert.equal(getOfficialTool('does-not-exist'), null)
})

test('registry pins the verified official npm distributions', () => {
  assert.equal(getOfficialTool('kimi-code').version, '2.1.1')
  assert.equal(getOfficialTool('claude-code').version, '2.1.283')
  assert.equal(getOfficialTool('minimax-code').version, '0.5.5')
  assert.equal(getOfficialTool('minimax-code').package, '@minimax-ai/code')
  assert.equal(getOfficialTool('mimo-code').version, '0.1.15')
  assert.equal(getOfficialTool('codex').version, '0.157.1')
  assert.equal(getOfficialTool('grok-build').version, '1.0.41')
  assert.ok(getOfficialTool('kimi-code').installArgs.includes('@moonshot-ai/kimi-code@2.1.1'))
})

test('provider keywords map conservatively to registry tools', () => {
  assert.equal(toolForProvider('moonshot-main').id, 'kimi-code')
  assert.equal(toolForProvider('kimi-account').id, 'kimi-code')
  assert.equal(toolForProvider('anthropic').id, 'claude-code')
  assert.equal(toolForProvider('openai').id, 'codex')
  assert.equal(toolForProvider('minimax-account').id, 'minimax-code')
  assert.equal(toolForProvider('mimo-cloud').id, 'mimo-code')
  assert.equal(toolForProvider('xai').id, 'grok-build')
  assert.equal(toolForProvider('deepseek-account'), null, 'DeepSeek is the host itself')
  assert.equal(toolForProvider('unknown-vendor'), null)
  assert.equal(toolForProvider(''), null)
})

test('channel annotation reflects probe truth and never invents tools', () => {
  const installed = channelForProvider('moonshot-main', ['kimi-code'])
  assert.equal(installed.kind, 'harness-llm', 'installed alone does not prove a runnable adapter')
  assert.equal(installed.tool, 'kimi-code')
  const runnable = channelForProvider('anthropic', ['claude-code'], ['claude-code'])
  assert.equal(runnable.kind, 'official-cli')
  const missing = channelForProvider('moonshot-main', [])
  assert.equal(missing.kind, 'harness-llm')
  assert.match(missing.detail, /tools install kimi-code/)
  const grok = channelForProvider('xai', [])
  assert.equal(grok.kind, 'harness-llm')
  assert.equal(grok.tool, 'grok-build')
  const deepseek = channelForProvider('deepseek-account', [])
  assert.equal(deepseek.kind, 'harness-llm')
  assert.equal(deepseek.tool, undefined)
})

test('plan annotates selected route and work packages with channels', () => {
  const routes = [
    { provider: 'moonshot', model: 'kimi-k3', name: 'Kimi K3', inputModalities: [] },
    { provider: 'deepseek-account', model: 'deepseek-v4', name: 'DeepSeek V4', inputModalities: [] },
    { provider: 'anthropic', model: 'claude-x', name: 'Claude', inputModalities: [] },
  ]
  const plan = createPlanFromRoutes('简单的日常问答', routes, { mode: 'team', installedToolIds: ['kimi-code'] })
  const packages = plan.team.workPackages
  assert.ok(packages.length > 0)
  for (const item of packages) {
    if (item.recommendedProvider === 'moonshot') {
      assert.equal(item.executionChannel, 'harness-llm')
      assert.equal(item.channelTool, 'kimi-code')
    } else {
      assert.equal(item.executionChannel, 'harness-llm')
    }
  }
  assert.ok(plan.toolNotice.includes('official-cli'))
})

test('probe classifies not-installed, installed and broken CLIs', async () => {
  resetForTests()
  const tool = getOfficialTool('kimi-code')
  const now = () => Date.now()
  const missingRunner = async (executable) => {
    if (executable === 'where') return { ok: false, code: 1, stdout: '', stderr: 'INFO: Could not find', timedOut: false }
    throw new Error(`--version must not run before ${executable} is located`)
  }
  const missing = await probeToolWith(tool, missingRunner, { cache: new Map(), now })
  assert.equal(missing.status, 'not-installed')
  assert.equal(missing.installed, false)

  const okRunner = async (executable, args) => {
    if (executable === 'where') return { ok: true, code: 0, stdout: 'C:\\cli\\kimi.cmd\n', stderr: '', timedOut: false }
    if (executable === 'kimi' && args[0] === '--version') return { ok: true, code: 0, stdout: '2.0.2\n', stderr: '', timedOut: false }
    throw new Error('unexpected invocation')
  }
  const installed = await probeToolWith(tool, okRunner, { cache: new Map(), now })
  assert.equal(installed.status, 'installed')
  assert.equal(installed.version, '2.0.2')

  const brokenRunner = async (executable, args) => {
    if (executable === 'where') return { ok: true, code: 0, stdout: 'C:\\cli\\kimi.cmd\n', stderr: '', timedOut: false }
    return { ok: false, code: 1, stdout: '', stderr: 'Cannot find module', timedOut: false }
  }
  const broken = await probeToolWith(tool, brokenRunner, { cache: new Map(), now })
  assert.equal(broken.status, 'probe-failed')
})

test('probe cache prevents duplicate spawns and expires', async () => {
  resetForTests()
  const tool = getOfficialTool('kimi-code')
  let spawns = 0
  let clock = 1_000
  const runner = async (executable) => {
    spawns += 1
    if (executable === 'where') return { ok: true, code: 0, stdout: 'C:\\cli\\kimi.cmd\n', stderr: '', timedOut: false }
    return { ok: true, code: 0, stdout: '2.0.2\n', stderr: '', timedOut: false }
  }
  const cache = new Map()
  const now = () => clock
  await probeToolWith(tool, runner, { cache, now })
  await probeToolWith(tool, runner, { cache, now })
  assert.equal(spawns, 2, 'locator + one --version, then cache hit')
  clock += 61_000
  await probeToolWith(tool, runner, { cache, now })
  assert.equal(spawns, 4, 'cache expired, probe runs again')
})

test('installer refuses unknown tools outright', () => {
  resetForTests()
  assert.throws(() => startInstall('not-a-tool'), /未知工具/)
  assert.equal(installStatus('kimi-code'), null)
  assert.equal(installStatus(''), null)
})

test('version banners are parsed leniently but bounded', () => {
  assert.equal(versionFromBanner('kimi version 2.0.2'), '2.0.2')
  assert.equal(versionFromBanner('claude 2.1.282 (Claude Code)'), '2.1.282')
  assert.equal(versionFromBanner('1.2.3-beta.1 ready'), '1.2.3-beta.1')
  assert.equal(versionFromBanner('no version here'), null)
  assert.equal(versionFromBanner(''), null)
})
