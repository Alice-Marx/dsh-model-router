import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  OFFICIAL_TOOLS,
  getOfficialTool,
  toolForProvider,
  installCommandLine,
  installCommandLineFor,
  installMethodBlockReason,
  installMethodFor,
  installMethodsFor,
} from '../.dsh-plugin/shared/official-tool-registry.mjs'
import {
  resolveInstallPlan,
  resolveUninstallPlan,
} from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import {
  versionFromBanner,
  probeToolWith,
  startInstall,
  installStatus,
  resetForTests,
  installPreferences,
  officialMiniMaxInstaller,
  stripPathBlock,
  defaultRunner,
  shellSpawnSpec,
  decodeProcessOutput,
  locatorPaths,
  probeToolSafely,
  staleInstallMessage,
  officialUpdatePlan,
  vendorScriptInvocation,
  verifiedVendorScript,
  CLAUDE_UPDATE_ARGS,
  finishVerifiedInstall,
} from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import { createPlanFromRoutes, channelForProvider } from '../.dsh-plugin/shared/harness-plan.mjs'
import { codexExecArgs, codexIncompleteError, codexReadOnlyPolicy, codexStateSandboxContract, executionEnvironment, findManagedMiniMaxEntry, harnessSandboxBlocker, officialToolExecutionCapabilities, officialToolReadiness, packageBinCandidates, runOfficialTool, runnerEnvironment } from '../.dsh-plugin/shared/official-tool-executor.mjs'
import { emptyOutputError, outputIsEmpty, usageFromOutput, verifiedDiagnostic } from '../.dsh-plugin/shared/task-executors.mjs'

test('managed CLI retains vendor connection settings and proxies without unrelated secrets or agent injection variables', () => {
  const env = { PATH: 'path', ANTHROPIC_AUTH_TOKEN: 'private', ANTHROPIC_BASE_URL: 'https://example.test',
    ANTHROPIC_MODEL: 'configured-model', ALL_PROXY: 'http://127.0.0.1:7897', OPENAI_API_KEY: 'other-vendor',
    NODE_OPTIONS: '--import=untrusted', UNRELATED_SECRET: 'private' }
  const actual = executionEnvironment('claude-code', { env })
  assert.equal(actual.ANTHROPIC_AUTH_TOKEN, 'private')
  assert.equal(actual.ANTHROPIC_BASE_URL, 'https://example.test')
  assert.equal(actual.ANTHROPIC_MODEL, 'configured-model')
  assert.equal(actual.ALL_PROXY, env.ALL_PROXY)
  assert.equal(actual.OPENAI_API_KEY, undefined)
  assert.equal(actual.NODE_OPTIONS, undefined)
  assert.equal(actual.UNRELATED_SECRET, undefined)
  assert.equal(executionEnvironment('claude-code', { env, sessionOnly: true }).ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(executionEnvironment('codex', { env }).ANTHROPIC_AUTH_TOKEN, undefined)
})

function verificationJob(toolId, preferences = {}) {
  return {
    tool: getOfficialTool(toolId), preferences, configured: true,
    status: 'running', cancelRequested: false, error: null, outputTail: [],
  }
}

test('installed Gemini and OpenCode succeed without pretending a restricted runner is ready', async () => {
  for (const toolId of ['gemini', 'opencode', 'stepcode', 'hermes', 'pi']) {
    const job = verificationJob(toolId)
    const probe = { id: toolId, installed: true, version: '1.0.0' }
    await finishVerifiedInstall(job, probe, { lookupLatest: async () => ({ version: '1.0.0' }) })
    assert.equal(job.status, 'succeeded', toolId)
    assert.equal(job.error, null)
    assert.equal(job.postInstallProbe, probe)
    assert.equal(job.executionReadiness.supported, false)
    assert.equal(job.executionReadiness.ready, false, 'successful installation cannot authorize restricted execution')
    assert.match(job.outputTail.at(-1), /版本探测已通过；受限执行未启用/)
    assert.equal((await officialToolReadiness(toolId)).ready, false)
  }
})

test('an installed version still fails when a supported Kimi execution entry is missing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'router-install-readiness-'))
  t.after(async () => {
    if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
  })
  const preferences = { installDir: root, methods: { 'kimi-code': 'npm' }, scriptUrls: {}, allowScriptInstall: true }
  const job = verificationJob('kimi-code', preferences)
  await finishVerifiedInstall(job, { installed: true, version: '1.0.0' }, { lookupLatest: async () => ({ version: '1.0.0' }) })
  assert.equal(job.status, 'failed')
  assert.equal(job.executionReadiness.supported, true)
  assert.equal(job.executionReadiness.ready, false)
  assert.match(job.error, /官方执行入口未就绪.*未找到官方 npm 包/)
})

test('unsupported execution never hides a failed installation probe or stale Gemini version', async () => {
  for (const probe of [{ installed: false, detail: 'selected package is absent' }, { installed: true, version: '0.9.0' }]) {
    const job = verificationJob('gemini')
    await finishVerifiedInstall(job, probe, { lookupLatest: async () => ({ version: '1.0.0' }) })
    assert.equal(job.status, 'failed')
    assert.equal(job.executionReadiness, undefined, 'installation checks must fail before capability handling')
    assert.match(job.error, /重探测失败|版本仍是/)
  }
})

test('MiniMax official Windows installer entry: any release, but its code must match the npm registry',
  { skip: process.platform !== 'win32' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'model-router-minimax-'))
    t.after(async () => {
      if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
    })
    const packageRoot = join(root, 'releases', '0.6.2', 'node_modules', '@minimax-ai', 'code')
    const nativeRoot = join(packageRoot, 'node_modules', 'better-sqlite3', 'build', 'Release')
    await mkdir(nativeRoot, { recursive: true })
    await writeFile(join(root, 'mcode.cmd'), '@ECHO off\r\n')
    await writeFile(join(root, 'current'), '0.6.2\n')
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@minimax-ai/code', version: '0.6.2', bin: { mcode: './cli.js' },
    }))
    await writeFile(join(packageRoot, 'cli.js'), 'official CLI fixture')
    await writeFile(join(nativeRoot, 'better_sqlite3.node'), 'native fixture')
    const asked = []
    const attestor = verdict => ({ async matchesPackage(path, name, version) { asked.push([name, version]); return verdict } })
    const found = await findManagedMiniMaxEntry(process.cwd(), [root], attestor({ ok: true, files: 1 }))
    assert.equal(found?.source, 'official-windows-installer-npm-attested')
    assert.equal(found.version, '0.6.2')
    assert.deepEqual(asked.at(-1), ['@minimax-ai/code', '0.6.2'], 'the installed release, not a pinned one, is attested')
    assert.equal(await findManagedMiniMaxEntry(process.cwd(), [root], attestor({ ok: false, reason: 'tampered' })), null)
    await writeFile(join(root, 'current'), 'not-a-version\n')
    assert.equal(await findManagedMiniMaxEntry(process.cwd(), [root], attestor({ ok: true })), null)
  })

test('MiniMax installer fallback runs the official script as published (no version patching)', () => {
  const source = Buffer.from('# MiniMax Code CLI installer\n$InstallDir = $env:MCODE_INSTALL_DIR\n& $Npm install -g "@minimax-ai/code@latest"\n')
  assert.equal(officialMiniMaxInstaller(source), source.toString())
  assert.equal(officialMiniMaxInstaller(Buffer.concat([Buffer.from('\uFEFF'), source])), source.toString())
  assert.throws(() => officialMiniMaxInstaller(Buffer.from('<html>404</html>')), /官方/)
  assert.throws(() => officialMiniMaxInstaller(Buffer.from('Write-Host "something else"')), /官方/)
})

test('registry stays fail-closed and internally consistent', () => {
  const ids = OFFICIAL_TOOLS.map(tool => tool.id)
  assert.equal(new Set(ids).size, ids.length, 'tool ids must be unique')
  for (const tool of OFFICIAL_TOOLS) {
    const methods = installMethodsFor(tool)
    const methodIds = methods.map(method => method.id)
    assert.equal(new Set(methodIds).size, methodIds.length, `${tool.id} method ids must be unique`)
    if (tool.unsupported) {
      assert.ok(tool.unsupportedReason.length > 10, `${tool.id} needs an actionable reason`)
      assert.equal(installCommandLine(tool), null, `${tool.id} must not expose an install command`)
    } else if (tool.manager === 'signed-windows-installer') {
      assert.equal(tool.version, undefined, `${tool.id} must not pin a version`)
      assert.deepEqual(tool.installArgs, [], `${tool.id} must not expose npm arguments`)
      assert.match(installCommandLine(tool), /官方签名安装器/)
    } else if (tool.manager === 'script-installer') {
      // No npm package exists for this vendor; its installer script is the only
      // official way in, so the tool declares script methods and nothing else.
      assert.equal(tool.package, undefined, `${tool.id} must not claim a package it does not publish`)
      assert.ok(methods.length > 0, `${tool.id} needs at least one installer script`)
      assert.ok(methods.every(method => method.kind === 'script'), `${tool.id} declares only script methods`)
      assert.ok(methods.some(method => installCommandLineFor(tool, method).includes('|')), `${tool.id} shows a script command`)
    } else {
      assert.ok(tool.package && tool.installArgs.length > 0, `${tool.id} needs a fixed install`)
      assert.ok(Array.isArray(tool.probeExecutables) && tool.probeExecutables.length > 0, `${tool.id} needs probe executables`)
      assert.equal(installCommandLine(tool).split(/\s+/)[0], tool.manager)
    }
    for (const method of methods) {
      assert.ok(installCommandLineFor(tool, method), `${tool.id}/${method.id} needs a command line`)
      assert.equal(installMethodFor(tool, method.id), method, `${tool.id}/${method.id} is resolvable by id`)
      if (method.kind === 'script') {
        assert.match(method.scriptUrl, /^https:\/\//, `${tool.id}/${method.id} script must be https`)
        assert.ok(method.verify?.mustInclude?.length, `${tool.id}/${method.id} needs markers to verify the script`)
        // A custom directory must bind to the vendor's argument or environment.
        if (method.supportsInstallDir) {
          assert.ok(method.installArgs.length || method.installDirEnv, `${tool.id}/${method.id} needs its install-dir binding`)
          if (method.installDirEnv) assert.ok(method.env.includes(method.installDirEnv), `${tool.id}/${method.id} declares its directory environment`)
        }
      } else {
        assert.ok(method.uninstallArgs.length, `${tool.id}/${method.id} needs an uninstall command`)
      }
      const blocked = installMethodBlockReason(method, 'plan9')
      assert.equal(blocked, method.platforms ? `此安装方式仅支持 ${method.platforms.join(' / ')}。` : null,
        `${tool.id}/${method.id} platform gate`)
    }
  }
  assert.equal(getOfficialTool('does-not-exist'), null)
})

test('vendor-native installers supplement npm and pnpm using their actual published commands', () => {
  const vendors = [
    ['kimi-code', 'https://code.kimi.com/kimi-code/install.sh', 'https://code.kimi.com/kimi-code/install.ps1', 'bash'],
    ['claude-code', 'https://claude.ai/install.sh', 'https://claude.ai/install.ps1', 'bash'],
    ['codex', 'https://chatgpt.com/codex/install.sh', 'https://chatgpt.com/codex/install.ps1', 'sh'],
    ['minimax-code', 'https://filecdn.minimax.chat/public/install.sh', 'https://filecdn.minimax.chat/public/install.ps1', 'bash'],
    ['mimo-code', 'https://mimo.xiaomi.com/install', 'https://mimo.xiaomi.com/install.ps1', 'bash'],
    ['grok-build', 'https://x.ai/cli/install.sh', 'https://x.ai/cli/install.ps1', 'bash'],
  ]
  for (const [id, bashUrl, powershellUrl, shell] of vendors) {
    const tool = getOfficialTool(id)
    for (const manager of ['npm', 'pnpm']) assert.equal(installMethodFor(tool, manager).manager, manager)
    const unix = installMethodsFor(tool).find(method => method.shell === shell)
    const windows = installMethodFor(tool, 'script-powershell')
    assert.equal(unix.scriptUrl, bashUrl)
    assert.equal(windows.scriptUrl, powershellUrl)
    assert.equal(installCommandLineFor(tool, unix), `curl -fsSL ${bashUrl} | ${shell}`)
    assert.equal(installCommandLineFor(tool, windows), `irm ${powershellUrl} | iex`)
    assert.ok(installMethodBlockReason(unix, 'win32'))
    assert.ok(installMethodBlockReason(windows, 'darwin'))
  }
  assert.equal(installMethodsFor(getOfficialTool('gemini')).some(method => method.kind === 'script'), false)
  assert.equal(installMethodFor(getOfficialTool('stepcode'), 'npm'), null)
})

test('Codex saved script-bash choice upgrades to the official sh method without broad aliases', () => {
  const codex = getOfficialTool('codex')
  const current = installMethodFor(codex, 'script-sh')
  assert.equal(installMethodFor(codex, 'script-bash'), current)
  const preferences = { ...installPreferences(), methods: { codex: 'script-bash' } }
  const plan = resolveInstallPlan(codex, undefined, preferences, { platform: 'linux', home: '/home/user' })
  assert.equal(plan.methodId, 'script-sh')
  assert.equal(plan.shell, 'sh')
  assert.equal(installCommandLineFor(codex, plan.method), 'curl -fsSL https://chatgpt.com/codex/install.sh | sh')
  assert.ok(installMethodBlockReason(plan.method, 'win32'), 'the legacy id still obeys platform gates')
  assert.equal(installMethodFor(codex, 'script-zsh'), null)
  assert.equal(installMethodFor(getOfficialTool('gemini'), 'script-bash'), null)
  assert.equal(installMethodFor(getOfficialTool('claude-code'), 'script-sh'), null)
  assert.throws(() => resolveInstallPlan(codex, 'script-zsh', preferences, { platform: 'linux' }), /没有名为 script-zsh/)
})

test('PowerShell comment help is accepted while HTML and another vendor remain rejected', () => {
  const method = installMethodFor(getOfficialTool('minimax-code'), 'script-powershell')
  // Current MiniMax and MiMo installers begin with a PowerShell <# help block.
  const source = '<#\nZero-dependency MiniMax Code CLI installer for Windows PowerShell 5.1+.\n#>\n$InstallDir = $env:MCODE_INSTALL_DIR\n$PackageName = "@minimax-ai/code"\n'
  assert.equal(verifiedVendorScript(Buffer.from(source), method.verify), source)
  assert.equal(verifiedVendorScript(Buffer.from(`\uFEFF${source}`), method.verify), source)
  assert.equal(officialMiniMaxInstaller(Buffer.from(source)), source)
  assert.throws(() => verifiedVendorScript(Buffer.from('<html>MiniMax Code CLI @minimax-ai/code</html>'), method.verify), /HTML/)
  assert.throws(() => verifiedVendorScript(Buffer.from('# kimi-code https://code.kimi.com/kimi-code\n'), method.verify), /官方安装脚本/)
})

test('MiniMax package methods explicitly build the vendor CLI and its SQLite dependency', () => {
  const tool = getOfficialTool('minimax-code')
  assert.equal(tool.defaultMethodsByPlatform.win32, 'script-powershell')
  const npm = installMethodFor(tool, 'npm')
  assert.ok(npm.installArgs.includes('--ignore-scripts=false'))
  assert.ok(npm.installArgs.includes('--include=optional'))
  const pnpm = installMethodFor(tool, 'pnpm')
  assert.equal(pnpm.installArgs[0], 'add', 'pnpm 10 exposes --allow-build on add')
  assert.ok(pnpm.installArgs.includes('--allow-build=@minimax-ai/code'))
  assert.ok(pnpm.installArgs.includes('--allow-build=better-sqlite3'))
  assert.equal(pnpm.installArgs.some(arg => arg.startsWith('--allow-scripts=')), false)
  assert.deepEqual(installMethodFor(tool, 'script-powershell').scriptBinaryNames,
    ['mcode.cmd', 'mcode.ps1', 'mcode-tools.cmd', 'mcode-tools.ps1'])
})

test('Claude pnpm links its native binary and only official Claude methods have a download fallback', () => {
  const claude = getOfficialTool('claude-code')
  const pnpm = installMethodFor(claude, 'pnpm')
  assert.equal(pnpm.installArgs[0], 'add')
  assert.ok(pnpm.installArgs.includes('--ignore-scripts=false'))
  assert.ok(pnpm.installArgs.includes('--allow-build=@anthropic-ai/claude-code'))
  assert.deepEqual(installMethodFor(claude, 'script-bash').scriptFallbackUrls,
    ['https://downloads.claude.ai/claude-code-releases/bootstrap.sh'])
  assert.deepEqual(installMethodFor(claude, 'script-powershell').scriptFallbackUrls,
    ['https://downloads.claude.ai/claude-code-releases/bootstrap.ps1'])
  for (const tool of OFFICIAL_TOOLS.filter(tool => tool.id !== 'claude-code')) {
    assert.ok(installMethodsFor(tool).every(method => method.scriptFallbackUrls === undefined))
  }
})

test('every tool declares installation and a safe removal strategy', () => {
  for (const tool of OFFICIAL_TOOLS) {
    const methods = installMethodsFor(tool)
    if (tool.manager === 'signed-windows-installer') {
      assert.equal(installMethodFor(tool, 'npm'), null, 'the desktop installer offers no method id')
      continue
    }
    const plan = resolveInstallPlan(tool, methods[0].id, installPreferences(), { platform: methods[0].platforms?.[0] ?? 'linux' })
    assert.ok(plan.methodId, `${tool.id} resolves an install plan`)
    const remove = () => resolveUninstallPlan(tool, plan.methodId, installPreferences(), { platform: plan.method.platforms?.[0] ?? 'linux' })
    if (plan.method.uninstallUnsupportedReason) {
      assert.throws(remove, { message: plan.method.uninstallUnsupportedReason }, `${tool.id} keeps vendor-managed data outside automatic deletion`)
      continue
    }
    const removal = remove()
    assert.ok(removal.methodId, `${tool.id} resolves an uninstall plan`)
    if (removal.kind === 'script') {
      assert.ok(removal.binaries.length, `${tool.id} names the files it may delete`)
      assert.ok(removal.dir, `${tool.id} knows where it installed`)
    } else {
      assert.match(removal.args.join(' '), /^uninstall -g /, `${tool.id} uninstalls through its package manager`)
    }
  }
})

test('a mirror may rehost a vendor script but never a different program', () => {
  const stepcode = getOfficialTool('stepcode')
  const method = installMethodFor(stepcode, 'script-bash')
  assert.ok(verifiedVendorScript(Buffer.from('#!/bin/sh\n# stepcode installer: https://static-openapi.stepfun.com/stepcode\n'), method.verify))
  assert.throws(() => verifiedVendorScript(Buffer.from('<html>404</html>'), method.verify), /安装脚本/)
  assert.throws(() => verifiedVendorScript(Buffer.from('echo hi\n'), method.verify), /官方安装脚本/)
  const opencode = installMethodFor(getOfficialTool('opencode'), 'script-bash')
  // A mirror that serves the wrong vendor's script is refused, not run.
  assert.throws(() => verifiedVendorScript(Buffer.from('# stepcode installer static-openapi.stepfun.com\n'), opencode.verify), /其他厂商/)
  assert.throws(() => verifiedVendorScript(Buffer.from(''), opencode.verify), /为空/)
})

test('registry follows each vendor\'s latest release instead of pinning versions', () => {
  for (const tool of OFFICIAL_TOOLS) {
    assert.equal(tool.version, undefined, `${tool.id} must not pin a version`)
    if (tool.manager !== 'npm') continue
    const spec = tool.installArgs.find(arg => arg.startsWith(`${tool.package}@`))
    assert.equal(spec, `${tool.package}@latest`, `${tool.id} installs @latest`)
    assert.ok(tool.installArgs.includes('--registry=https://registry.npmjs.org/'), `${tool.id} uses the official registry`)
    assert.doesNotMatch(installCommandLine(tool), /@\d+\.\d+\.\d+/)
  }
  assert.equal(getOfficialTool('minimax-code').package, '@minimax-ai/code')
  assert.equal(getOfficialTool('gemini').package, '@google/gemini-cli')
  assert.match(installCommandLine(getOfficialTool('zcode')), /官方签名安装器/)
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

test('package probes classify missing entries, installed metadata and inspection failures', async () => {
  resetForTests()
  const tool = getOfficialTool('kimi-code')
  const now = () => Date.now()
  const runner = async () => { throw new Error('package probes must not execute shared command shims') }
  const missing = await probeToolWith(tool, runner, { cache: new Map(), now, packageEntries: async () => [] })
  assert.equal(missing.status, 'not-installed')
  assert.equal(missing.installed, false)

  const installed = await probeToolWith(tool, runner, { cache: new Map(), now,
    packageEntries: async () => [{ version: '2.0.2', packageRoot: '/cli/package', entry: '/cli/package/dist/main.mjs', source: 'verified-npm-package' }] })
  assert.equal(installed.status, 'installed')
  assert.equal(installed.version, '2.0.2')

  const broken = await probeToolSafely(tool, runner, { cache: new Map(), now,
    packageEntries: async () => { throw new Error('Cannot read package metadata') } })
  assert.equal(broken.status, 'probe-failed')
  assert.match(broken.detail, /Cannot read package metadata/)
})

test('package probe cache prevents duplicate inspections and expires', async () => {
  resetForTests()
  const tool = getOfficialTool('kimi-code')
  let inspections = 0
  let clock = 1_000
  const runner = async () => { throw new Error('package probes must not execute shared command shims') }
  const packageEntries = async () => {
    inspections += 1
    return [{ version: '2.0.2', packageRoot: '/cli/package', entry: '/cli/package/dist/main.mjs', source: 'verified-npm-package' }]
  }
  const cache = new Map()
  const now = () => clock
  await probeToolWith(tool, runner, { cache, now, packageEntries })
  await probeToolWith(tool, runner, { cache, now, packageEntries })
  assert.equal(inspections, 1, 'one package inspection, then cache hit')
  clock += 61_000
  await probeToolWith(tool, runner, { cache, now, packageEntries })
  assert.equal(inspections, 2, 'cache expired, package inspection runs again')
})

test('package bin lookup accepts ./dist/main.mjs and a moved entry inside the same package', () => {
  assert.deepEqual(packageBinCandidates({ kimi: './dist/main.mjs' }, 'kimi', 'dist/main.mjs'), ['dist/main.mjs'])
  assert.deepEqual(packageBinCandidates({ kimi: 'dist/index.mjs' }, 'kimi', 'dist/main.mjs'), ['dist/index.mjs', 'dist/main.mjs'])
  assert.deepEqual(packageBinCandidates({ claude: 'bin/claude.exe' }, 'claude', 'bin/claude.exe'), ['bin/claude.exe'])
  assert.deepEqual(packageBinCandidates({ kimi: '../outside.mjs' }, 'kimi', 'dist/main.mjs'), ['dist/main.mjs'])
})

test('defaultRunner keeps stdout and stderr when onOutput is omitted', async () => {
  const outcome = await defaultRunner(process.execPath, ['-e', 'process.stdout.write("probe-stdout"); process.stderr.write("probe-stderr")'], {
    timeoutMs: 10_000,
    useShell: false,
  })
  assert.equal(outcome.ok, true)
  assert.match(outcome.stdout, /probe-stdout/)
  assert.match(outcome.stderr, /probe-stderr/)
})

test('windows shell spawn keeps argv separate so cmd is not double-quoted', () => {
  const spec = shellSpawnSpec('npm', ['install', '-g', '@anthropic-ai/claude-code@latest', '--registry=https://registry.npmjs.org/'], { useShell: true })
  assert.equal(spec.file, 'npm')
  assert.equal(spec.shell, true)
  assert.deepEqual(spec.args, ['install', '-g', '@anthropic-ai/claude-code@latest', '--registry=https://registry.npmjs.org/'])
  assert.equal(spec.file.includes('"') || spec.args.some(arg => arg.includes('"')), false)
  const probed = shellSpawnSpec('claude', ['--version'], { useShell: true })
  assert.deepEqual(probed, { file: 'claude', args: ['--version'], shell: true })
})

test('probe banners decode UTF-16 and a non-zero exit with a version still counts as installed', async () => {
  const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('2.1.295 (Claude Code)\n', 'utf16le')])
  assert.match(decodeProcessOutput(utf16), /2\.1\.295/)
  const bare = Buffer.from('2.1.295\n', 'utf16le')
  assert.match(decodeProcessOutput(bare), /2\.1\.295/)
  assert.deepEqual(locatorPaths('INFO: Could not find\n"D:\\Program Files\\Claude\\claude.exe"\n'), process.platform === 'win32'
    ? ['D:\\Program Files\\Claude\\claude.exe'] : [])

  const claude = getOfficialTool('claude-code')
  // Exercise the native PATH banner fallback independently of package metadata.
  const nativePlan = { kind: 'script', methodId: 'synthetic-native', binDir: '' }
  const exe = process.platform === 'win32' ? 'D:\\Program Files\\Claude\\claude.exe' : '/opt/Claude/claude.exe'
  const locator = process.platform === 'win32' ? 'where' : 'which'
  const versionDespiteExit = await probeToolWith(claude, async (executable) => {
    if (executable === locator) return { ok: true, code: 0, stdout: `${exe}\n`, stderr: '', timedOut: false }
    return { ok: false, code: 1, stdout: '2.1.295 (Claude Code)\n', stderr: '', timedOut: false }
  }, { cache: new Map(), now: () => Date.now(), plan: nativePlan })
  assert.equal(versionDespiteExit.status, 'installed')
  assert.equal(versionDespiteExit.version, '2.1.295')

  const direct = await probeToolWith(claude, async (executable, args, options = {}) => {
    if (executable === locator) return { ok: true, code: 0, stdout: `${exe}\n`, stderr: '', timedOut: false }
    if (executable === 'claude') return { ok: false, code: 1, stdout: '', stderr: 'garbled', timedOut: false }
    assert.equal(executable, exe)
    assert.equal(options.useShell, false)
    assert.deepEqual(args, ['--version'])
    return { ok: true, code: 0, stdout: '2.1.295 (Claude Code)\n', stderr: '', timedOut: false }
  }, { cache: new Map(), now: () => Date.now(), plan: nativePlan })
  assert.equal(direct.status, 'installed')
  assert.equal(direct.version, '2.1.295')

  const isolated = await probeToolSafely(claude, async () => { throw new Error('probe exploded') }, { cache: new Map(), plan: nativePlan })
  assert.equal(isolated.status, 'probe-failed')
  assert.match(isolated.detail, /probe exploded/)
})

test('an update that leaves the probed version behind is a visible failure', () => {
  const message = staleInstallMessage('Claude Code', '2.1.282', '2.1.295')
  assert.match(message, /2\.1\.282/)
  assert.match(message, /2\.1\.295/)
  assert.match(message, /没有生效/)
})

test('installed Claude, Codex and MiniMax choose an updater instead of a silent success', () => {
  assert.deepEqual(CLAUDE_UPDATE_ARGS, ['update'])
  assert.equal(officialUpdatePlan({ toolId: 'claude-code', installed: true, order: -1, platform: 'win32' }), 'claude-update-then-registry')
  assert.equal(officialUpdatePlan({ toolId: 'codex', installed: true, order: -1, platform: 'win32' }), 'registry-install')
  assert.equal(officialUpdatePlan({ toolId: 'minimax-code', installed: true, order: -1, platform: 'win32' }), 'minimax-official-installer')
  assert.equal(officialUpdatePlan({ toolId: 'minimax-code', installed: true, order: null, platform: 'win32' }), 'minimax-official-installer')
  assert.equal(officialUpdatePlan({ toolId: 'minimax-code', installed: true, order: -1, platform: 'linux' }), 'registry-install')
  assert.equal(officialUpdatePlan({ toolId: 'minimax-code', installed: false, order: null, platform: 'win32' }), 'registry-install')
  assert.equal(officialUpdatePlan({ toolId: 'kimi-code', installed: true, order: -1, platform: 'darwin' }), 'registry-install')
  assert.equal(officialUpdatePlan({ toolId: 'gemini', installed: true, order: -1, platform: 'win32' }), 'registry-install')
  assert.equal(officialUpdatePlan({ toolId: 'claude-code', installed: true, order: 0, platform: 'win32' }), 'already-current')
  assert.equal(officialUpdatePlan({ toolId: 'codex', installed: true, order: 1, platform: 'win32' }), 'refuse-downgrade')
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


// 0.13.2 regression: on Windows the signed Codex runner omitted --skip-git-repo-check,
// so Codex 0.157.1 refused any workspace that is not a Git repository
// ("Not inside a trusted directory and --skip-git-repo-check was not specified.").
test('signed Codex runner passes --skip-git-repo-check so non-Git workspaces run', () => {
  assert.deepEqual(codexExecArgs('read-only', 'gpt-5.6-sol'), [
    '--ask-for-approval', 'never', 'exec', '--skip-git-repo-check',
    '--model', 'gpt-5.6-sol', '--sandbox', 'read-only', '--json', '-',
  ])
  const write = codexExecArgs('workspace-write', null)
  assert.deepEqual(write, ['--ask-for-approval', 'never', 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--json', '-'])
  // exec options must follow the `exec` subcommand; the global approval flag precedes it.
  assert.ok(write.indexOf('--skip-git-repo-check') > write.indexOf('exec'))
  assert.ok(write.indexOf('--ask-for-approval') < write.indexOf('exec'))
})

test('Codex failures name the cause: untrusted directory, no events, or incomplete turn', () => {
  assert.match(codexIncompleteError(0, 'Not inside a trusted directory and --skip-git-repo-check was not specified.\n'), /非 Git 仓库\/未信任目录/)
  assert.match(codexIncompleteError(0, ''), /未输出任何 JSON 事件.*未收到 CLI 输出/)
  assert.match(codexIncompleteError(0, 'line one\r\nfatal: boom\r\n'), /CLI 输出：fatal: boom/)
  assert.equal(codexIncompleteError(3, 'ERROR rmcp::transport::worker: HTTP 502'), 'Codex 未返回完整成功终态和回答。')
})

test('signed-runner failure detail skips empty strings (an empty stderr no longer hides stdout)', () => {
  assert.equal(verifiedDiagnostic({ detail: undefined, stderrTail: '', stdoutTail: 'runner said no' }), 'runner said no')
  assert.equal(verifiedDiagnostic({ detail: '  ', stderrTail: 'stderr text', stdoutTail: 'x' }), 'stderr text')
  assert.equal(verifiedDiagnostic({}), '')
  assert.equal(verifiedDiagnostic(null), '')
})

test('Codex 0.157.1 turn.completed usage from a real ChatGPT-login run is parsed', () => {
  const stream = [
    '{"type":"thread.started","thread_id":"t"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Codex is ignoring 1 unrecognized configuration setting."}}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"OK"}}',
    '{"type":"turn.completed","usage":{"input_tokens":14919,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
  ].join('\n')
  const usage = usageFromOutput('codex-jsonl', stream.split('\n').at(-1))
  assert.equal(usage?.usage?.outputTokens ?? usage?.usage?.output_tokens ?? usage?.outputTokens, 5)
})


// 0.13.3 regression: Harness Desktop's sandbox runner is `[DeepSeek Harness.exe, runner.js, …]`.
// Without ELECTRON_RUN_AS_NODE=1 that Electron executable boots the GUI, loses the
// single-instance lock and exits 0 with no output, so the wrapped CLI never ran.
test('the Harness runner prefix gets ELECTRON_RUN_AS_NODE when it is the Electron executable', () => {
  const execPath = 'D:\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'
  const win = { execPath, electron: '44.0.0', platform: 'win32' }
  if (process.platform === 'win32') {
    assert.deepEqual(runnerEnvironment('d:/programs/deepseek harness/DeepSeek Harness.exe', win), { ELECTRON_RUN_AS_NODE: '1' })
  }
  assert.deepEqual(runnerEnvironment(execPath, win), { ELECTRON_RUN_AS_NODE: '1' })
  assert.deepEqual(runnerEnvironment('/usr/bin/bwrap', win), {}, 'other runners get nothing extra')
  assert.deepEqual(runnerEnvironment(execPath, { ...win, electron: undefined }), {}, 'plain Node hosts need nothing')
  assert.deepEqual(runnerEnvironment('/opt/harness/harness', { execPath: '/opt/harness/harness', electron: '44.0.0', platform: 'linux' }), { ELECTRON_RUN_AS_NODE: '1' })
})

test('Windows Codex supports read-only with existing state and explicitly refuses editable execution', async t => {
  assert.equal(harnessSandboxBlocker('codex', 'win32'), null)
  assert.match(harnessSandboxBlocker('codex', 'win32', 'workspace-write'), /CODEX_HOME.*独立 Git/)
  assert.equal(harnessSandboxBlocker('codex', 'linux'), null)
  assert.equal(harnessSandboxBlocker('claude-code', 'win32'), null)
  if (process.platform === 'win32') {
    assert.deepEqual(officialToolExecutionCapabilities().find(item => item.id === 'codex').modes, ['read-only'])
    const cwd = await mkdtemp(join(tmpdir(), 'model-router-codex-blocker-'))
    t.after(() => rm(cwd, { recursive: true, force: true }))
    let confined = false
    const result = await runOfficialTool({ toolId: 'codex', task: 'OK', workspace: cwd,
      mode: 'workspace-write', sandbox: { confine: async () => { confined = true; return {} } } })
    assert.equal(result.status, 'unsupported')
    assert.match(result.reason, /仅支持只读任务/)
    assert.equal(confined, false, 'an unsupported edit is rejected before creating any write grant')
    const noSandbox = await runOfficialTool({ toolId: 'codex', task: 'OK', workspace: cwd })
    assert.equal(noSandbox.status, 'unsupported')
    assert.match(noSandbox.reason, /沙箱不可用.*拒绝直接启动/)
  }
})

test('Codex read-only policy grants the exact existing state home and preserves its files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'router-codex-home-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'project')
  const home = join(root, 'existing-state')
  await Promise.all([mkdir(workspace), mkdir(home)])
  await writeFile(join(home, 'auth.json'), 'synthetic login fixture')
  await writeFile(join(home, 'config.toml'), 'synthetic config fixture')
  const policy = await codexReadOnlyPolicy(workspace, home)
  assert.deepEqual(policy, { mode: 'workspace-write', workspaceRoot: await realpath(home) })
  assert.notEqual(policy.workspaceRoot, await realpath(workspace), 'the project receives no outer write capability')
  assert.equal(await readFile(join(home, 'auth.json'), 'utf8'), 'synthetic login fixture')
  assert.equal(await readFile(join(home, 'config.toml'), 'utf8'), 'synthetic config fixture')
  assert.equal(codexExecArgs('read-only').at(-3), 'read-only', 'the CLI retains its own read-only policy')
  await assert.rejects(codexReadOnlyPolicy(workspace, join(root, 'missing-state')), /ENOENT/)
  await assert.rejects(codexReadOnlyPolicy(workspace, 'relative-state'), /absolute directory/)
})

test('Codex rejects overlapping project/state roots and does not advertise them as ready', async t => {
  const root = await mkdtemp(join(tmpdir(), 'router-codex-overlap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const nested = join(root, 'nested')
  await mkdir(nested)
  for (const [workspace, home] of [[root, root], [root, nested], [nested, root]]) {
    await assert.rejects(codexReadOnlyPolicy(workspace, home), /必须互不包含/)
  }
  if (process.platform === 'win32') {
    const previous = process.env.CODEX_HOME
    process.env.CODEX_HOME = root
    try {
      const readiness = await officialToolReadiness('codex', nested)
      assert.equal(readiness.ready, false)
      assert.deepEqual(readiness.readyModes, [])
      assert.match(readiness.reason, /必须互不包含/)
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
    }
  }
})

test('Codex requires the reviewed Windows ACL state-root profile and exact CLI argv', () => {
  const home = resolve(tmpdir(), 'existing-codex-home')
  const policy = { mode: 'workspace-write', workspaceRoot: home }
  const command = ['signed-codex.exe', ...codexExecArgs('read-only')]
  const runner = join(resolve(tmpdir()), 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js')
  const prefix = ['node', runner, '--workspace', home, '--temp', resolve(tmpdir()), '--mode', 'workspace-write']
  const argv = [...prefix, '--', ...command]
  assert.equal(codexStateSandboxContract({ argv }, command, policy), true)
  const managed = [...prefix, '--write-sid', 'state-sid', '--temp-write-sid', 'temp-sid', '--', ...command]
  assert.equal(codexStateSandboxContract({ argv: managed }, command, policy), true)
  assert.equal(codexStateSandboxContract({ argv: ['unknown-runner', '--', ...command] }, command, policy), false)
  assert.equal(codexStateSandboxContract({ argv: [...prefix, '--', ...command.slice(0, -1), 'injected'] }, command, policy), false)
  assert.equal(codexStateSandboxContract({ argv }, command, { ...policy, workspaceRoot: resolve(tmpdir(), 'project') }), false)
  assert.equal(codexStateSandboxContract({ argv }, command, { ...policy, mode: 'read-only' }), false)
  assert.equal(codexStateSandboxContract({ argv: [...prefix, '--workspace', home, '--', ...command] }, command, policy), false)
  assert.equal(codexStateSandboxContract({ argv: [...prefix, '--write-sid', 'state-sid', '--', ...command] }, command, policy), false)
})

test('empty CLI output is named explicitly with the exit code', () => {
  assert.equal(emptyOutputError('Codex CLI', 0), 'Codex 退出码 0，无任何输出（stdout 与 stderr 均为空）。')
  assert.equal(emptyOutputError('Claude Code', 3), 'Claude Code 退出码 3，无任何输出（stdout 与 stderr 均为空）。')
  assert.equal(emptyOutputError('Codex CLI', null), 'Codex 退出码 未知，无任何输出（stdout 与 stderr 均为空）。')
  assert.equal(outputIsEmpty('\r\n', ''), true, 'what the Electron GUI instance printed')
  assert.equal(outputIsEmpty('', 'x'), false)
})
