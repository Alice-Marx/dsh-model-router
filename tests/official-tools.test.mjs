import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
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
  pinnedMiniMaxInstaller,
} from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import { createPlanFromRoutes, channelForProvider } from '../.dsh-plugin/shared/harness-plan.mjs'
import { findManagedMiniMaxEntry } from '../.dsh-plugin/shared/official-tool-executor.mjs'

test('MiniMax official Windows installer entry requires the pinned version and CLI digest',
  { skip: process.platform !== 'win32' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'model-router-minimax-'))
    t.after(async () => {
      if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
    })
    const packageRoot = join(root, 'releases', '0.5.5', 'node_modules', '@minimax-ai', 'code')
    const nativeRoot = join(packageRoot, 'node_modules', 'better-sqlite3', 'build', 'Release')
    await mkdir(nativeRoot, { recursive: true })
    await writeFile(join(root, 'mcode.cmd'), '@ECHO off\r\n')
    await writeFile(join(root, 'current'), '0.5.5\n')
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@minimax-ai/code', version: '0.5.5', bin: { mcode: './cli.js' },
    }))
    const cli = Buffer.from('official CLI fixture')
    await writeFile(join(packageRoot, 'cli.js'), cli)
    await writeFile(join(nativeRoot, 'better_sqlite3.node'), 'native fixture')
    const digest = createHash('sha256').update(cli).digest('hex')
    const found = await findManagedMiniMaxEntry(process.cwd(), [root], digest)
    assert.equal(found?.source, 'verified-official-windows-installer-bundle')
    assert.equal(await findManagedMiniMaxEntry(process.cwd(), [root], '0'.repeat(64)), null)
    await writeFile(join(root, 'current'), '0.5.4\n')
    assert.equal(await findManagedMiniMaxEntry(process.cwd(), [root], digest), null)
    await writeFile(join(root, 'current'), '0.5.5\n')
    await writeFile(join(packageRoot, 'cli.js'), 'tampered')
    assert.equal(await findManagedMiniMaxEntry(process.cwd(), [root], digest), null)
  })

test('MiniMax installer fallback verifies source bytes and pins the npm version selector', () => {
  const source = Buffer.from('& $Npm view "$PackageName@latest" version --json\n')
  const digest = createHash('sha256').update(source).digest('hex')
  assert.match(pinnedMiniMaxInstaller(source, digest), /\$PackageName@0\.5\.5/)
  assert.throws(() => pinnedMiniMaxInstaller(Buffer.from('tampered'), digest), /哈希/)
  const noSelector = Buffer.from('Write-Step "latest"\n')
  const otherHash = createHash('sha256').update(noSelector).digest('hex')
  assert.throws(() => pinnedMiniMaxInstaller(noSelector, otherHash), /结构/)
})

test('registry stays fail-closed and internally consistent', () => {
  const ids = OFFICIAL_TOOLS.map(tool => tool.id)
  assert.equal(new Set(ids).size, ids.length, 'tool ids must be unique')
  for (const tool of OFFICIAL_TOOLS) {
    if (tool.unsupported) {
      assert.ok(tool.unsupportedReason.length > 10, `${tool.id} needs an actionable reason`)
      assert.equal(installCommandLine(tool), null, `${tool.id} must not expose an install command`)
    } else if (tool.manager === 'signed-windows-installer') {
      assert.match(tool.version, /^\d+\.\d+\.\d+$/)
      assert.deepEqual(tool.installArgs, [], `${tool.id} must not expose npm arguments`)
      assert.match(installCommandLine(tool), /官方签名安装器/)
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
  assert.equal(getOfficialTool('gemini').version, '0.62.0')
  assert.equal(getOfficialTool('gemini').package, '@google/gemini-cli')
  assert.ok(getOfficialTool('gemini').installArgs.includes('@google/gemini-cli@0.62.0'))
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
  assert.equal(toolForProvider('gemini').id, 'gemini')
  assert.equal(toolForProvider('google-ai').id, 'gemini')
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
  const headless = channelForProvider('anthropic', ['claude-code'], [])
  assert.equal(headless.kind, 'official-cli', 'an installed headless CLI is an official channel before the signed runner is ready')
  const apiOnly = channelForProvider('anthropic', ['claude-code'], ['claude-code'], { execution: 'api' })
  assert.equal(apiOnly.kind, 'harness-llm')
  assert.equal(apiOnly.preference, 'api')
  const gemini = channelForProvider('google-ai', ['gemini'], [])
  assert.equal(gemini.kind, 'official-cli')
  assert.equal(gemini.tool, 'gemini')
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
  const locator = process.platform === 'win32' ? 'where' : 'which'
  const located = process.platform === 'win32' ? 'C:\\cli\\kimi.cmd\n' : '/usr/local/bin/kimi\n'
  const missingRunner = async (executable) => {
    if (executable === locator) return { ok: false, code: 1, stdout: '', stderr: 'INFO: Could not find', timedOut: false }
    throw new Error(`--version must not run before ${executable} is located`)
  }
  const missing = await probeToolWith(tool, missingRunner, { cache: new Map(), now })
  assert.equal(missing.status, 'not-installed')
  assert.equal(missing.installed, false)

  const okRunner = async (executable, args) => {
    if (executable === locator) return { ok: true, code: 0, stdout: located, stderr: '', timedOut: false }
    if (executable === 'kimi' && args[0] === '--version') return { ok: true, code: 0, stdout: '2.0.2\n', stderr: '', timedOut: false }
    throw new Error('unexpected invocation')
  }
  const installed = await probeToolWith(tool, okRunner, { cache: new Map(), now })
  assert.equal(installed.status, 'installed')
  assert.equal(installed.version, '2.0.2')

  const brokenRunner = async (executable) => {
    if (executable === locator) return { ok: true, code: 0, stdout: located, stderr: '', timedOut: false }
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
  const locator = process.platform === 'win32' ? 'where' : 'which'
  const runner = async (executable) => {
    spawns += 1
    if (executable === locator) return { ok: true, code: 0, stdout: process.platform === 'win32' ? 'C:\\cli\\kimi.cmd\n' : '/usr/local/bin/kimi\n', stderr: '', timedOut: false }
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
