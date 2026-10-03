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
  officialMiniMaxInstaller,
} from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import { createPlanFromRoutes, channelForProvider } from '../.dsh-plugin/shared/harness-plan.mjs'
import { codexExecArgs, codexIncompleteError, findManagedMiniMaxEntry, harnessSandboxBlocker, runOfficialTool, runnerEnvironment } from '../.dsh-plugin/shared/official-tool-executor.mjs'
import { emptyOutputError, outputIsEmpty, usageFromOutput, verifiedDiagnostic } from '../.dsh-plugin/shared/task-executors.mjs'

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
  const source = Buffer.from('& $Npm install -g "@minimax-ai/code@latest"\n')
  assert.equal(officialMiniMaxInstaller(source), source.toString())
  assert.equal(officialMiniMaxInstaller(Buffer.concat([Buffer.from('\uFEFF'), source])), source.toString())
  assert.throws(() => officialMiniMaxInstaller(Buffer.from('<html>404</html>')), /官方/)
  assert.throws(() => officialMiniMaxInstaller(Buffer.from('Write-Host "something else"')), /官方/)
})

test('registry stays fail-closed and internally consistent', () => {
  const ids = OFFICIAL_TOOLS.map(tool => tool.id)
  assert.equal(new Set(ids).size, ids.length, 'tool ids must be unique')
  for (const tool of OFFICIAL_TOOLS) {
    if (tool.unsupported) {
      assert.ok(tool.unsupportedReason.length > 10, `${tool.id} needs an actionable reason`)
      assert.equal(installCommandLine(tool), null, `${tool.id} must not expose an install command`)
    } else if (tool.manager === 'signed-windows-installer') {
      assert.equal(tool.version, undefined, `${tool.id} must not pin a version`)
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

test('Codex is not started inside the Harness Windows ACL sandbox (it must write CODEX_HOME)', async t => {
  assert.match(harnessSandboxBlocker('codex', 'win32'), /CODEX_HOME.*os error 5/)
  assert.equal(harnessSandboxBlocker('codex', 'linux'), null)
  assert.equal(harnessSandboxBlocker('claude-code', 'win32'), null)
  if (process.platform === 'win32') {
    const cwd = await mkdtemp(join(tmpdir(), 'model-router-codex-blocker-'))
    t.after(() => rm(cwd, { recursive: true, force: true }))
    let confined = false
    const result = await runOfficialTool({ toolId: 'codex', task: 'OK', workspace: cwd, sandbox: { confine: async () => { confined = true; return {} } } })
    assert.equal(result.status, 'unsupported')
    assert.equal(confined, false, 'the sandbox runner is never asked to wrap Codex')
  }
})

test('empty CLI output is named explicitly with the exit code', () => {
  assert.equal(emptyOutputError('Codex CLI', 0), 'Codex 退出码 0，无任何输出（stdout 与 stderr 均为空）。')
  assert.equal(emptyOutputError('Claude Code', 3), 'Claude Code 退出码 3，无任何输出（stdout 与 stderr 均为空）。')
  assert.equal(emptyOutputError('Codex CLI', null), 'Codex 退出码 未知，无任何输出（stdout 与 stderr 均为空）。')
  assert.equal(outputIsEmpty('\r\n', ''), true, 'what the Electron GUI instance printed')
  assert.equal(outputIsEmpty('', 'x'), false)
})
