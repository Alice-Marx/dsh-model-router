// Workbench "官方工具终端": request contract, launch resolution, Host session
// manager (with a fake PTY), pipe fallback, metadata-only history, the remote
// wiring through a strict Cordis-like ctx, and the client transport.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strictCtx } from './helpers/strict-ctx.mjs'
import {
  TERMINAL_LIMITS,
  TERMINAL_LOGIN_ARGS,
  TERMINAL_TOOL_IDS,
  isAbsoluteDirectoryText,
  parseTerminalRead,
  parseTerminalResize,
  parseTerminalStart,
  parseTerminalStop,
  parseTerminalWrite,
  terminalCommandPreview,
} from '../.dsh-plugin/shared/cli-terminal-protocol.mjs'
import {
  PIPE_LIMITATION,
  createTerminalManager,
  findTerminalPackageEntry,
  loadPtyModule,
  pickWindowsExecutable,
  resolveTerminalLaunch,
  spawnPipeProcess,
  terminalEnvironment,
  utf8ConsoleLaunch,
} from '../.dsh-plugin/shared/cli-terminal.mjs'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import {
  TerminalConnection,
  TerminalInfoRefresher,
  confirmationDetails,
  endDescription,
  startProblem,
  terminalTargets,
  terminalInfoTools,
} from '../.dsh-plugin/client/cli-terminal-state.mjs'
import { LOGIN_GUIDES } from '../.dsh-plugin/shared/tool-health.mjs'
import { OFFICIAL_TOOLS, getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-terminal-'))
const host = await import('../.dsh-plugin/index.mjs')

const CWD = process.platform === 'win32' ? 'C:\\work' : '/work'
const startRequest = (extra = {}) => ({ target: 'shell', mode: 'interactive', cwd: CWD, cols: 80, rows: 24, confirmed: true, ...extra })

test('terminal start request: fixed targets only, absolute cwd, explicit confirmation', () => {
  assert.deepEqual(parseTerminalStart(startRequest({ target: 'codex', mode: 'login' })), { target: 'codex', mode: 'login', cwd: CWD, cols: 80, rows: 24, confirmed: true })
  assert.throws(() => parseTerminalStart(startRequest({ confirmed: false })), /confirmation/)
  assert.throws(() => parseTerminalStart(startRequest({ confirmed: 'yes' })), /confirmation/)
  assert.throws(() => parseTerminalStart(startRequest({ target: 'cmd.exe' })), /target/)
  for (const target of ['opencode', 'stepcode', 'zcode']) assert.equal(parseTerminalStart(startRequest({ target })).target, target)
  assert.equal(parseTerminalStart(startRequest({ target: 'zcode', mode: 'login' })).mode, 'login')
  assert.throws(() => parseTerminalStart(startRequest({ cwd: 'relative/dir' })), /absolute/)
  assert.throws(() => parseTerminalStart(startRequest({ mode: 'login' })), /no login mode/)
  assert.throws(() => parseTerminalStart(startRequest({ cols: 5000 })), /cols/)
  const parsed = parseTerminalStart(startRequest({ args: ['--dangerously-bypass'], env: { X: '1' }, file: 'evil' }))
  assert.equal('args' in parsed || 'env' in parsed || 'file' in parsed, false, 'callers cannot supply a command, arguments or environment')
  assert.equal(isAbsoluteDirectoryText('D:\\projects\\demo'), true)
  assert.equal(isAbsoluteDirectoryText('\\\\server\\share\\dir'), true)
  assert.equal(isAbsoluteDirectoryText('/home/me'), true)
  assert.equal(isAbsoluteDirectoryText('C:relative'), false)
})

test('terminal read/write/resize/stop requests are bounded', () => {
  const id = 'term-abcdef123456'
  assert.deepEqual(parseTerminalRead({ sessionId: id, cursor: 5, waitMs: 800 }), { sessionId: id, cursor: 5, waitMs: 800 })
  assert.throws(() => parseTerminalRead({ sessionId: id, waitMs: 60_000 }), /waitMs/)
  assert.throws(() => parseTerminalRead({ sessionId: '../etc' }), /sessionId/)
  assert.throws(() => parseTerminalWrite({ sessionId: id, data: '' }), /data/)
  assert.throws(() => parseTerminalWrite({ sessionId: id, data: 'x'.repeat(TERMINAL_LIMITS.writeChars + 1) }), /data/)
  assert.deepEqual(parseTerminalResize({ sessionId: id, cols: 120, rows: 40 }), { sessionId: id, cols: 120, rows: 40 })
  assert.throws(() => parseTerminalResize({ sessionId: id, cols: 1, rows: 40 }), /cols/)
  assert.deepEqual(parseTerminalStop({ sessionId: id }), { sessionId: id })
})

test('terminal remote descriptors validate with the same parsers', () => {
  const byMethod = Object.fromEntries(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.map(item => [item.method, item]))
  const start = byMethod.terminalStart.parameters[0].codec.create()
  assert.throws(() => start.parse(startRequest({ confirmed: false })), /confirmation/)
  assert.equal(start.parse(startRequest()).target, 'shell')
  assert.deepEqual(byMethod.terminalInfo.parameters, [])
  for (const method of ['terminalRead', 'terminalWrite', 'terminalResize', 'terminalStop']) {
    assert.throws(() => byMethod[method].parameters[0].codec.create().parse({ sessionId: 'nope' }), /sessionId|data|cols/, method)
  }
})

test('login commands match the documented tool login guides', () => {
  for (const id of TERMINAL_TOOL_IDS) {
    const documented = (LOGIN_GUIDES[id].command ?? '').split(' ')
    assert.deepEqual([...TERMINAL_LOGIN_ARGS[id]], documented.slice(1), id)
  }
  assert.equal(terminalCommandPreview('codex', 'login'), 'codex login')
  assert.equal(terminalCommandPreview('claude-code', 'login'), 'claude auth login')
  assert.equal(terminalCommandPreview('shell', 'interactive', 'win32'), 'powershell.exe -NoLogo')
})

test('Windows launch: native exe first, npm .cmd shims through cmd.exe, ps1 last', async () => {
  assert.equal(pickWindowsExecutable(['D:\\Claude\\claude', 'D:\\Claude\\claude.ps1', 'D:\\Claude\\claude.cmd']), 'D:\\Claude\\claude.cmd')
  assert.equal(pickWindowsExecutable(['D:\\a\\codex.cmd', 'D:\\b\\codex.exe']), 'D:\\b\\codex.exe')
  assert.equal(pickWindowsExecutable(['D:\\a\\codex']), null)
  const env = { ComSpec: 'C:\\Windows\\system32\\cmd.exe', SystemRoot: 'C:\\Windows' }
  const exe = await resolveTerminalLaunch('codex', 'login', { platform: 'win32', env, fileExists: async () => false, locate: async () => ['D:\\Program Files\\codexcli\\codex.exe'] })
  assert.deepEqual(exe, { file: 'D:\\Program Files\\codexcli\\codex.exe', args: ['login'], verbatim: false, display: 'codex login' })
  const shim = await resolveTerminalLaunch('claude-code', 'login', { platform: 'win32', env, fileExists: async () => false, locate: async () => ['D:\\Program Files\\Claude\\claude.ps1', 'D:\\Program Files\\Claude\\claude.cmd'] })
  assert.equal(shim.file, 'C:\\Windows\\system32\\cmd.exe')
  assert.equal(shim.verbatim, true)
  assert.equal(shim.args, '/d /s /c ""D:\\Program Files\\Claude\\claude.cmd" auth login"')
  const ps1 = await resolveTerminalLaunch('minimax-code', 'interactive', { platform: 'win32', env, fileExists: async () => false, locate: async () => ['D:\\mm\\mcode.ps1'] })
  assert.deepEqual(ps1.args, ['-NoLogo', '-NoProfile', '-File', 'D:\\mm\\mcode.ps1'])
  const shell = await resolveTerminalLaunch('shell', 'interactive', { platform: 'win32', env, locate: async () => { throw new Error('not used') } })
  assert.equal(shell.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  await assert.rejects(resolveTerminalLaunch('grok-build', 'interactive', { platform: 'win32', env, locate: async () => [] }), /未在 PATH 中找到 grok/)
  await assert.rejects(resolveTerminalLaunch('zcode', 'interactive', { platform: 'win32', env, discoverBundle: async () => null }), /GitHub Release SHA256/)
})

test('ZCode Windows PTY sets its own UTF-8 console before Node starts with literal arguments', () => {
  const launch = { file: "D:\\Node & tools\\node.exe", args: ["D:\\用户 %PATH% & O'Brien\\zcode.mjs", 'login'], utf8Console: true, display: 'zcode login' }
  const prepared = utf8ConsoleLaunch(launch, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } })
  assert.match(prepared.file, /WindowsPowerShell.*powershell\.exe$/)
  assert.deepEqual(prepared.args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  const script = Buffer.from(prepared.args[4], 'base64').toString('utf16le')
  assert.match(script, /InputEncoding = \[System.Text.UTF8Encoding\]::new\(\$false\)/)
  assert.match(script, /OutputEncoding = \[System.Text.UTF8Encoding\]::new\(\$false\)/)
  assert.ok(script.includes("& 'D:\\Node & tools\\node.exe' @('D:\\用户 %PATH% & O''Brien\\zcode.mjs', 'login')"))
  assert.ok(script.indexOf('OutputEncoding') < script.indexOf('& '))
  assert.ok(script.endsWith('exit $LASTEXITCODE'))
  assert.equal(utf8ConsoleLaunch(launch, { platform: 'linux', env: {} }), launch)
  const other = { ...launch, utf8Console: false }
  assert.equal(utf8ConsoleLaunch(other, { platform: 'win32', env: {} }), other)
})

test('OpenCode uses the V2 package in the selected directory when a legacy V1 copy also exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'model-router-opencode-v2-'))
  const entries = {}
  for (const [name, version] of [['opencode-ai', '1.19.3'], ['@opencode/cli', '2.0.32']]) {
    const packageRoot = join(root, 'node_modules', ...name.split('/'))
    await mkdir(join(packageRoot, 'bin'), { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version, bin: { opencode: './bin/opencode.exe' } }))
    entries[name] = join(packageRoot, 'bin', 'opencode.exe')
    await writeFile(entries[name], 'fixture-only')
  }
  const options = { platform: 'win32', env: {}, cwd: root,
    preferences: { installDir: root, methods: { opencode: 'npm' } },
    locate: async () => { throw new Error('selected installation must not use PATH') } }
  const interactive = await resolveTerminalLaunch('opencode', 'interactive', options)
  assert.equal(interactive.file, await realpath(entries['@opencode/cli']))
  assert.deepEqual(interactive.args, [])
  const login = await resolveTerminalLaunch('opencode', 'login', options)
  assert.equal(login.file, await realpath(entries['@opencode/cli']))
  assert.deepEqual(login.args, ['auth', 'login'])
})

test('POSIX launch uses the absolute path which printed and the login shell', async () => {
  const launch = await resolveTerminalLaunch('kimi-code', 'login', { platform: 'linux', env: {}, locate: async () => ['/usr/local/bin/kimi'] })
  assert.deepEqual(launch, { file: '/usr/local/bin/kimi', args: ['login'], verbatim: false, display: 'kimi login' })
  const shell = await resolveTerminalLaunch('shell', 'interactive', { platform: 'linux', env: { SHELL: '/bin/zsh' } })
  assert.deepEqual(shell.args, ['-l'])
  assert.equal(shell.file, '/bin/zsh')
})

test('terminal targets follow every installed registry tool, including Step, OpenCode and standalone ZCode CLI', () => {
  const tools = OFFICIAL_TOOLS.map(tool => ({ id: tool.id, installed: true }))
  assert.deepEqual(terminalTargets(tools).map(item => item.id), ['shell', ...TERMINAL_TOOL_IDS])
  assert.equal(terminalTargets(tools).find(item => item.id === 'stepcode').canLogin, true)
  assert.equal(terminalTargets(tools).find(item => item.id === 'opencode').canLogin, true)
  assert.equal(terminalTargets(tools).find(item => item.id === 'zcode').canLogin, true)
  assert.equal(terminalCommandPreview('zcode'), 'zcode')
  assert.equal(terminalCommandPreview('zcode', 'login'), 'zcode login')
})

test('configured npm and pnpm terminal launches use their actual package entries instead of a stale shared shim', async () => {
  const root = mkdtempSync(join(tmpdir(), 'router-terminal-entry-'))
  const tool = getOfficialTool('gemini')
  const npmRoot = join(root, 'node_modules', '@google', 'gemini-cli')
  const pnpmRoot = join(root, '.pnpm', 'global', '5', 'node_modules', '@google', 'gemini-cli')
  for (const [directory, version] of [[npmRoot, '0.63.0'], [pnpmRoot, '0.64.0']]) {
    await mkdir(join(directory, 'bundle'), { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: tool.package, version, bin: { gemini: './bundle/gemini.js' } }))
    await writeFile(join(directory, 'bundle', 'gemini.js'), '// fixture only\n')
  }
  await writeFile(join(root, 'gemini.cmd'), '@echo stale pnpm shim')
  const common = { platform: 'win32', env: {}, preferences: { installDir: root, methods: { gemini: 'npm' } },
    locate: async () => { throw new Error('configured launch must never consult PATH') }, findNode: async () => process.execPath }
  const npm = await resolveTerminalLaunch('gemini', 'interactive', common)
  assert.equal(npm.file, process.execPath)
  assert.deepEqual(npm.args, [await realpath(join(npmRoot, 'bundle', 'gemini.js'))])
  const pnpm = await resolveTerminalLaunch('gemini', 'interactive', { ...common,
    preferences: { installDir: root, methods: { gemini: 'pnpm' } } })
  assert.deepEqual(pnpm.args, [await realpath(join(pnpmRoot, 'bundle', 'gemini.js'))])
  await assert.rejects(resolveTerminalLaunch('claude-code', 'interactive', common), /真实命令入口/,
    'a different PATH copy cannot satisfy a missing selected package')
})

test('terminal selected package metadata and bin cannot escape the configured installation tree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'router-terminal-boundary-'))
  const outside = mkdtempSync(join(tmpdir(), 'router-terminal-outside-'))
  const tool = getOfficialTool('gemini')
  await mkdir(join(root, 'node_modules', '@google'), { recursive: true })
  await mkdir(join(outside, 'bundle'), { recursive: true })
  await writeFile(join(outside, 'package.json'), JSON.stringify({ name: tool.package, version: '0.63.0', bin: { gemini: 'bundle/gemini.js' } }))
  await writeFile(join(outside, 'bundle', 'gemini.js'), '// outside fixture\n')
  await symlink(outside, join(root, 'node_modules', '@google', 'gemini-cli'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(await findTerminalPackageEntry(tool, { installDir: root, manager: 'npm' }, { platform: 'win32' }), null)
})

test('Step terminal resolves its private install directory and refuses an old shared PATH copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'router-terminal-step-'))
  await mkdir(join(root, 'stepcode'), { recursive: true })
  await writeFile(join(root, 'stepcode', 'step.exe'), 'fixture')
  const options = { platform: 'win32', env: {}, preferences: { installDir: root, methods: { stepcode: 'script-powershell' } },
    locate: async () => { throw new Error('must use private directory') } }
  const launch = await resolveTerminalLaunch('stepcode', 'login', options)
  assert.equal(launch.file, join(root, 'stepcode', 'step.exe'))
  assert.deepEqual(launch.args, ['login'])
  await assert.rejects(resolveTerminalLaunch('stepcode', 'interactive', { ...options,
    fileExists: async () => false, locate: async () => [join(root, 'step.exe')] }), /所选安装目录/)
})

test('ZCode standalone terminal uses the shared directory and a compatible Node runtime on every platform', async () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const prefix = platform === 'win32' ? 'D:/AI/tools' : '/opt/ai-tools'
    const bundle = { root: `${prefix}/zcode-cli`, cliEntry: `${prefix}/zcode-cli/bin/zcode.mjs` }
    const env = { PATH: 'test' }, home = platform === 'win32' ? 'C:/Users/test' : '/home/test'
    const preferences = { installDir: prefix, zcodeInstallDir: 'D:/legacy/ZCode' }
    let discovery
    const options = { platform, cwd: CWD, env, home, preferences,
      locate: async () => { throw new Error('ZCode PATH shim must not be trusted') },
      discoverBundle: async request => { discovery = request; return bundle },
      findNode: async (_workspace, minimum, accepted) => {
        assert.deepEqual(minimum, [24, 14, 0])
        assert.equal(accepted('24.14.0'), true)
        assert.equal(accepted('25.0.0'), false)
        return '/trusted/node'
      } }
    const node = await resolveTerminalLaunch('zcode', 'interactive', options)
    assert.equal(node.utf8Console, true)
    assert.equal(discovery.installDir.replaceAll('\\', '/'), bundle.root)
    assert.deepEqual({ env: discovery.env, platform: discovery.platform, home: discovery.home }, { env, platform, home })
    assert.equal(node.file, '/trusted/node')
    assert.deepEqual(node.args, [bundle.cliEntry])
    assert.equal(node.env, undefined)
    assert.deepEqual((await resolveTerminalLaunch('zcode', 'login', options)).args, [bundle.cliEntry, 'login'])
    await assert.rejects(resolveTerminalLaunch('zcode', 'interactive', { ...options, findNode: async () => null }), /Node.js 24.14.0/)
    await assert.rejects(resolveTerminalLaunch('zcode', 'interactive', { ...options, discoverBundle: async () => null }), /GitHub Release SHA256/)
  }
})

test('ZCode npm terminal binds the selected package and never substitutes an archive copy', async () => {
  const entry = { packageRoot: '/selected/node_modules/@ljwei-stak/zcode-cli', entry: '/selected/node_modules/@ljwei-stak/zcode-cli/bin/zcode.mjs', version: '3.16.2' }
  const verified = { root: '/verified/npm-runtime', cliEntry: '/verified/npm-runtime/bin/zcode.mjs', source: 'npm-registry-sha256' }
  const preferences = { installDir: '/selected', methods: { zcode: 'npm' } }
  const calls = []
  const options = { platform: 'linux', env: {}, home: '/home/test', cwd: '/workspace', preferences,
    packageEntry: async (tool, plan) => { calls.push({ tool: tool.id, kind: plan.kind, installDir: plan.installDir }); return entry },
    npmBundle: async found => { assert.equal(found, entry); return verified },
    discoverBundle: async () => assert.fail('npm selection cannot use the GitHub archive'),
    findNode: async (_cwd, minimum, accepted) => {
      assert.deepEqual(minimum, [24, 14, 0]); assert.equal(accepted('25.0.0'), false); return '/node24'
    } }
  const launch = await resolveTerminalLaunch('zcode', 'interactive', options)
  assert.equal(launch.utf8Console, true)
  assert.deepEqual(calls, [{ tool: 'zcode', kind: 'package-manager', installDir: '/selected' }])
  assert.equal(launch.file, '/node24')
  assert.deepEqual(launch.args, [verified.cliEntry])
  assert.deepEqual((await resolveTerminalLaunch('zcode', 'login', options)).args, [verified.cliEntry, 'login'])
  await assert.rejects(resolveTerminalLaunch('zcode', 'interactive', { ...options, packageEntry: async () => null }), /所选 npm.*不会改用 GitHub/)
  await assert.rejects(resolveTerminalLaunch('zcode', 'interactive', { ...options, npmBundle: async () => { throw new Error('payload mismatch') } }), /payload mismatch/)
})

test('terminal environment is the login environment minus ELECTRON_RUN_AS_NODE', () => {
  const env = terminalEnvironment({ PATH: '/bin', OPENAI_API_KEY: 'sk-test', HTTPS_PROXY: 'http://proxy', ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1' })
  assert.equal(env.PATH, '/bin')
  assert.equal(env.OPENAI_API_KEY, 'sk-test', 'CLI API keys and logins pass through, unlike the sandbox allow-list')
  assert.equal(env.HTTPS_PROXY, 'http://proxy')
  assert.equal('ELECTRON_RUN_AS_NODE' in env || 'electron_run_as_node' in env, false)
  assert.equal(env.TERM, 'xterm-256color')
})

test('Windows pipe fallback preserves a cmd shim command line in node spawn argument array', () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write() {} }
  let request
  const proc = spawnPipeProcess({ file: 'C:/Windows/System32/cmd.exe', args: '/d /s /c ""D:/Tools Space/mcode.cmd" login"', verbatim: true }, {
    platform: 'win32', cwd: CWD, env: {}, spawnImpl: (...args) => { request = args; return child },
  })
  assert.deepEqual(request[1], ['/d /s /c ""D:/Tools Space/mcode.cmd" login"'])
  assert.equal(request[2].windowsVerbatimArguments, true)
  assert.equal(request[2].shell, false)
  let exit = null
  proc.onExit(event => { exit = event })
  proc.kill()
  assert.equal(exit, null, 'pipe kill/taskkill acceptance is not a host exit event')
})

test('Windows pipe fallback never kills a reused PID after the child exits before stdio closes', () => {
  const child = new EventEmitter()
  child.pid = 4242
  child.exitCode = 0
  child.signalCode = null
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write() {} }
  let killCount = 0
  child.kill = () => { killCount += 1 }
  const spawns = []
  const proc = spawnPipeProcess({ file: 'fixture.exe', args: [], verbatim: false }, {
    platform: 'win32', cwd: CWD, env: {}, spawnImpl: (...args) => { spawns.push(args); return child },
  })
  let exit = null
  proc.onExit(event => { exit = event })
  proc.kill()
  assert.equal(spawns.length, 1, 'an exited child must not spawn taskkill for its old PID')
  assert.equal(killCount, 0, 'an exited child must not be killed again while stdio remains open')
  assert.equal(exit, null, 'an exited parent with open stdio does not confirm the descendant tree')
})

/** A scriptable stand-in for @lydell/node-pty. */
function fakePty() {
  const spawned = []
  return {
    spawned,
    module: {
      spawn(file, args, options) {
        const proc = { file, args, options, written: [], sizes: [], killed: false, dataListeners: [], exitListeners: [], pid: 4242 }
        proc.emit = data => proc.dataListeners.forEach(listener => listener(data))
        proc.exit = (exitCode = 0) => proc.exitListeners.forEach(listener => listener({ exitCode, signal: 0 }))
        spawned.push(proc)
        return {
          pid: proc.pid,
          onData: listener => { proc.dataListeners.push(listener); return { dispose() {} } },
          onExit: listener => { proc.exitListeners.push(listener); return { dispose() {} } },
          write: data => proc.written.push(data),
          resize: (cols, rows) => proc.sizes.push([cols, rows]),
          kill: () => { proc.killed = true; proc.exit(null) },
        }
      },
    },
  }
}

function managerWith({ pty = fakePty(), ptyOk = true, clock = { now: 1_000 }, ended = [], ...options } = {}) {
  const manager = createTerminalManager({
    loadPty: () => ptyOk ? { ok: true, pty: pty.module, package: '@lydell/node-pty' } : { ok: false, error: 'Cannot find module', package: '@lydell/node-pty' },
    resolveLaunch: async (target, mode) => ({ file: `/bin/${target}`, args: mode === 'login' ? ['login'] : [], verbatim: false, display: `${target}${mode === 'login' ? ' login' : ''}` }),
    statPath: async path => ({ isDirectory: () => path === CWD }),
    environment: () => ({ PATH: '/bin', SECRET_TOKEN: 'abc' }),
    onSessionEnd: record => ended.push(record),
    now: () => clock.now,
    setRepeating: () => ({ unref() {} }),
    clearRepeating: () => {},
    ...options,
  })
  return { manager, pty, clock, ended }
}

function fakeManaged() {
  const spawned = []
  const createManaged = async options => {
    const listeners = { data: [], exit: [], tree: [], output: [], dropped: [], lost: [] }
    let close
    const proc = {
      options, pid: 4242 + spawned.length, startIdentity: String(100 + spawned.length), containment: 'windows-job', treeTracking: true,
      resumeCalls: 0, killCalls: 0, writes: [], sizes: [], closed: new Promise(resolve => { close = resolve }),
      onData: listener => { listeners.data.push(listener) },
      onExit: listener => { listeners.exit.push(listener) },
      onTreeClosed: listener => { listeners.tree.push(listener) },
      onOutputClosed: listener => { listeners.output.push(listener) },
      onOutputDropped: listener => { listeners.dropped.push(listener) },
      onControlLost: listener => { listeners.lost.push(listener) },
      resume: async () => { proc.resumeCalls += 1; return { started: true } },
      kill: async () => { proc.killCalls += 1; return true },
      write: data => { proc.writes.push(data); return true },
      resize: async (cols, rows) => { proc.sizes.push([cols, rows]); return true },
      emit: data => listeners.data.forEach(listener => listener(data)),
      exit: (exitCode = 0) => listeners.exit.forEach(listener => listener({ exitCode, signal: null })),
      closeTree: () => listeners.tree.forEach(listener => listener({ proof: 'windows-job-active-process-zero', activeProcesses: 0 })),
      dropOutput: bytesDropped => listeners.dropped.forEach(listener => listener({ bytesDropped })),
      loseControl: (code = 'NATIVE_TERMINAL_CONTROL_LOST') => listeners.lost.forEach(listener => listener({ code })),
      closeOutput: (event = {}) => listeners.output.forEach(listener => listener({ outputTruncated: false, bytesDropped: 0, ...event })),
      resolveClosed: (event = {}) => close({ code: 0, signal: null, runtimeCleaned: true, outputTruncated: false, bytesDropped: 0, ...event }),
    }
    spawned.push(proc)
    return proc
  }
  return { spawned, createManaged }
}

const managedOptions = managed => ({
  platform: 'win32', useManaged: true, createManaged: managed.createManaged,
  allocateOutputParent: async () => ({ path: 'D:/isolated/owned-parent' }),
  releaseOutputParent: async () => {},
})

test('terminal manager reads current preferences after prepare and merges only fixed launch environment', async () => {
  const selections = []
  let preferences = { installDir: 'D:/AI/tools' }
  const { manager, pty } = managerWith({
    prepare: async () => { preferences = { installDir: 'D:/AI/new-tools' } },
    preferences: () => preferences, launchOptions: () => ({ home: 'C:/Users/test' }),
    resolveLaunch: async (target, mode, options) => { selections.push(options); return { file: '/signed/ZCode.exe', args: ['/verified/zcode.cjs'], display: 'ZCode TUI', env: { ELECTRON_RUN_AS_NODE: '1' } } },
  })
  await manager.start(startRequest({ target: 'zcode' }))
  assert.deepEqual(selections[0].preferences, { installDir: 'D:/AI/new-tools' })
  assert.equal(selections[0].home, 'C:/Users/test')
  assert.equal(selections[0].cwd, CWD)
  assert.equal(pty.spawned[0].options.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(pty.spawned[0].options.env.SECRET_TOKEN, 'abc')
  manager.disposeAll()
})

test('manager: PTY session streams output by cursor, forwards input and resize, records metadata only', async () => {
  const { manager, pty, ended } = managerWith()
  assert.equal(manager.info().backend, 'pty')
  await assert.rejects(manager.start(startRequest({ confirmed: false })), /确认/)
  await assert.rejects(manager.start(startRequest({ cwd: process.platform === 'win32' ? 'C:\\missing' : '/missing' })), /工作目录不存在/)
  const session = await manager.start(startRequest({ target: 'codex', mode: 'login' }))
  assert.equal(session.backend, 'pty')
  assert.equal(session.display, 'codex login')
  const proc = pty.spawned[0]
  assert.equal(proc.file, '/bin/codex')
  assert.deepEqual(proc.options, { name: 'xterm-256color', cols: 80, rows: 24, cwd: CWD, env: { PATH: '/bin', SECRET_TOKEN: 'abc' } })

  proc.emit('Welcome\r\n')
  let output = await manager.read({ sessionId: session.sessionId, cursor: 0 })
  assert.equal(output.data, 'Welcome\r\n')
  // A long-poll read wakes as soon as output arrives.
  const pending = manager.read({ sessionId: session.sessionId, cursor: output.cursor, waitMs: 1_000 })
  setTimeout(() => proc.emit('code: ABCD-1234\r\n'), 5)
  output = await pending
  assert.equal(output.data, 'code: ABCD-1234\r\n')

  manager.write({ sessionId: session.sessionId, data: 'my-secret-password\r' })
  assert.deepEqual(proc.written, ['my-secret-password\r'])
  assert.deepEqual(await manager.resize({ sessionId: session.sessionId, cols: 132, rows: 43 }), { resized: true })
  assert.deepEqual(proc.sizes, [[132, 43]])

  proc.exit(0)
  output = await manager.read({ sessionId: session.sessionId, cursor: output.cursor })
  assert.equal(output.exited, true)
  assert.equal(output.exitCode, 0)
  assert.throws(() => manager.write({ sessionId: session.sessionId, data: 'x' }), /已结束/)
  assert.equal(ended.length, 1)
  assert.deepEqual(Object.keys(ended[0]).sort(), ['backend', 'bytesDropped', 'containment', 'controlError', 'controlLost', 'cwd', 'durationMs', 'endReason', 'exitCode', 'exited', 'finishedAt', 'id', 'label', 'mode', 'outputClosed', 'outputTruncated', 'startedAt', 'stopConfirmed', 'stopRequested', 'target', 'treeClosed', 'treeTracking'])
  assert.deepEqual({ stopRequested: ended[0].stopRequested, stopConfirmed: ended[0].stopConfirmed }, { stopRequested: false, stopConfirmed: false })
  const serialized = JSON.stringify(ended)
  for (const leaked of ['my-secret-password', 'ABCD-1234', 'Welcome', 'SECRET_TOKEN']) assert.equal(serialized.includes(leaked), false, leaked)
})

test('manager: stop, orphan timeout, lifetime, session cap and dispose all kill the process', async () => {
  const clock = { now: 1_000 }
  const { manager, pty, ended } = managerWith({ clock, limits: { ...TERMINAL_LIMITS, maxSessions: 2 } })
  const first = await manager.start(startRequest())
  const second = await manager.start(startRequest())
  await assert.rejects(manager.start(startRequest()), /最多同时运行 2 个/)
  assert.deepEqual(manager.stop({ sessionId: first.sessionId }), {
    stopped: false, stopRequested: true, stopConfirmed: false, exited: true, endReason: 'stopped',
  })
  assert.equal(pty.spawned[0].killed, true)
  assert.equal(ended[0].endReason, 'stopped')
  // The panel stopped reading (closed without a stop call): the sweep requests a stop.
  clock.now += TERMINAL_LIMITS.orphanTimeoutMs + 1
  manager.sweep()
  assert.equal(pty.spawned[1].killed, true)
  assert.equal(ended[1].endReason, 'orphan')
  assert.equal(ended[1].id, second.sessionId)
  const third = await manager.start(startRequest())
  clock.now += 1_000
  await manager.read({ sessionId: third.sessionId, cursor: 0 })
  manager.disposeAll()
  assert.equal(pty.spawned[2].killed, true)
  assert.equal(ended[2].endReason, 'dispose')
  assert.ok(ended.every(record => record.stopRequested === true && record.stopConfirmed === false))
  await assert.rejects(manager.start(startRequest()), /卸载/)
})

function withoutExitOnKill(pty) {
  const spawn = pty.module.spawn
  pty.module.spawn = (...args) => {
    const native = spawn(...args)
    const proc = pty.spawned.at(-1)
    proc.killCount = 0
    return { ...native, kill: () => { proc.killed = true; proc.killCount += 1 } }
  }
  return pty
}

test('manager: a kill without an exit event does not invent a terminal after five seconds', async () => {
  const pty = withoutExitOnKill(fakePty())
  const timers = []
  const { manager, ended } = managerWith({
    pty,
    setTimer: (callback, ms) => { const timer = { callback, ms, unref() {} }; timers.push(timer); return timer },
    clearTimer: () => {},
  })
  const session = await manager.start(startRequest())
  const stopped = manager.stop({ sessionId: session.sessionId })
  const pending = manager.read({ sessionId: session.sessionId, cursor: 0, waitMs: 1_000 })
  for (const timer of timers.filter(item => item.ms === 5_000)) timer.callback()
  const output = await pending
  const current = manager.info().sessions.find(item => item.sessionId === session.sessionId)
  assert.equal(pty.spawned[0].killed, true)
  assert.equal(current.exited, false, 'a timeout is not a backend exit event')
  assert.equal(current.stopRequested, true)
  assert.equal(current.stopConfirmed, false)
  assert.deepEqual({ exited: output.exited, stopRequested: output.stopRequested, stopConfirmed: output.stopConfirmed },
    { exited: false, stopRequested: true, stopConfirmed: false })
  assert.equal(ended.length, 0, 'no history may be written without a real host exit')
  assert.deepEqual(stopped, { stopped: false, stopRequested: true, stopConfirmed: false, exited: false, endReason: 'stopped' })

  assert.deepEqual(manager.stop({ sessionId: session.sessionId }),
    { stopped: false, stopRequested: true, stopConfirmed: false, exited: false, endReason: 'stopped' })
  assert.equal(pty.spawned[0].killCount, 1, 'a repeated stop is idempotent')
  assert.equal(timers.filter(item => item.ms === 5_000).length, 1)
  pty.spawned[0].exit(7)
  pty.spawned[0].exit(0)
  assert.equal(ended.length, 1, 'only the first real host exit records history')
  assert.deepEqual({ exitCode: ended[0].exitCode, endReason: ended[0].endReason, stopRequested: ended[0].stopRequested, stopConfirmed: ended[0].stopConfirmed },
    { exitCode: 7, endReason: 'stopped', stopRequested: true, stopConfirmed: false })
  const afterExit = await manager.read({ sessionId: session.sessionId, cursor: output.cursor })
  assert.deepEqual({ exited: afterExit.exited, exitCode: afterExit.exitCode, stopRequested: afterExit.stopRequested, stopConfirmed: afterExit.stopConfirmed },
    { exited: true, exitCode: 7, stopRequested: true, stopConfirmed: false })
  assert.deepEqual(manager.stop({ sessionId: session.sessionId }), {
    stopped: false, alreadyEnded: true, stopRequested: true, stopConfirmed: false, exited: true, endReason: 'stopped',
  })
})

test('manager: disposeAll waits for a real exit instead of manufacturing history', async () => {
  const pty = withoutExitOnKill(fakePty())
  const { manager, ended } = managerWith({ pty })
  const session = await manager.start(startRequest())
  manager.disposeAll()
  const current = manager.info().sessions.find(item => item.sessionId === session.sessionId)
  assert.equal(pty.spawned[0].killed, true)
  assert.equal(current.exited, false)
  assert.equal(current.stopRequested, true)
  assert.equal(current.stopConfirmed, false)
  assert.equal(current.endReason, 'dispose')
  assert.equal(ended.length, 0)
  await assert.rejects(manager.start(startRequest()), /卸载/)
  pty.spawned[0].exit(0)
  assert.equal(ended.length, 1)
  assert.deepEqual({ endReason: ended[0].endReason, stopRequested: ended[0].stopRequested, stopConfirmed: ended[0].stopConfirmed },
    { endReason: 'dispose', stopRequested: true, stopConfirmed: false })
})

test('manager: orphan and lifetime timeouts stay unconfirmed until their real exit events', async () => {
  for (const reason of ['orphan', 'lifetime']) {
    const pty = withoutExitOnKill(fakePty())
    const timers = []
    const clock = { now: 1_000 }
    const { manager, ended } = managerWith({
      pty, clock,
      limits: { ...TERMINAL_LIMITS, orphanTimeoutMs: reason === 'lifetime' ? TERMINAL_LIMITS.maxLifetimeMs + 10_000 : TERMINAL_LIMITS.orphanTimeoutMs },
      setTimer: (callback, ms) => { const timer = { callback, ms, unref() {} }; timers.push(timer); return timer },
      clearTimer: () => {},
    })
    const session = await manager.start(startRequest())
    clock.now += (reason === 'lifetime' ? TERMINAL_LIMITS.maxLifetimeMs : TERMINAL_LIMITS.orphanTimeoutMs) + 1
    manager.sweep()
    for (const timer of timers.filter(item => item.ms === 5_000)) timer.callback()
    const current = manager.info().sessions.find(item => item.sessionId === session.sessionId)
    assert.deepEqual({ exited: current.exited, endReason: current.endReason, stopRequested: current.stopRequested, stopConfirmed: current.stopConfirmed },
      { exited: false, endReason: reason, stopRequested: true, stopConfirmed: false })
    assert.equal(ended.length, 0)
    pty.spawned[0].exit(0)
    assert.equal(ended.length, 1)
    assert.equal(ended[0].stopConfirmed, false)
  }
})

test('terminal manager reserves pending slots across concurrent starts', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let preparing = 0
  const { manager, pty } = managerWith({
    limits: { ...TERMINAL_LIMITS, maxSessions: 4 },
    prepare: async () => { preparing += 1; await gate },
  })
  const starts = Array.from({ length: 5 }, () => manager.start(startRequest()))
  const settled = Promise.allSettled(starts)
  await new Promise(resolve => setImmediate(resolve))
  release()
  const results = await settled
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  assert.match(results.find(result => result.status === 'rejected').reason.message, /最多同时运行 4 个/)
  assert.equal(preparing, 4)
  assert.equal(pty.spawned.length, 4)
  manager.disposeAll()
})

test('terminal manager releases a pending slot after every start failure boundary', async () => {
  for (const boundary of ['stat', 'prepare', 'resolve', 'spawn']) {
    const pty = fakePty()
    const spawn = pty.module.spawn
    let shouldFail = true
    pty.module.spawn = (...args) => {
      if (shouldFail) { shouldFail = false; throw new Error('injected spawn failure') }
      return spawn(...args)
    }
    const { manager } = managerWith({
      pty,
      limits: { ...TERMINAL_LIMITS, maxSessions: 1 },
      statPath: async () => {
        if (boundary === 'stat' && shouldFail) { shouldFail = false; throw new Error('injected stat failure') }
        return { isDirectory: () => true }
      },
      prepare: async () => {
        if (boundary === 'prepare' && shouldFail) { shouldFail = false; throw new Error('injected prepare failure') }
      },
      resolveLaunch: async () => {
        if (boundary === 'resolve' && shouldFail) { shouldFail = false; throw new Error('injected resolve failure') }
        return { file: '/bin/shell', args: [], display: 'shell' }
      },
    })
    await assert.rejects(manager.start(startRequest()), boundary === 'stat' ? /工作目录不存在/ : new RegExp(`injected ${boundary} failure`))
    const session = await manager.start(startRequest())
    assert.equal(session.backend, 'pty', `${boundary} failure releases its reservation`)
    manager.disposeAll()
  }
})

test('terminal manager refuses pending starts disposed during prepare or resolve', async () => {
  for (const boundary of ['prepare', 'resolve']) {
    let enter
    const entered = new Promise(resolve => { enter = resolve })
    let release
    const gate = new Promise(resolve => { release = resolve })
    const launch = async () => ({ file: '/bin/shell', args: [], display: 'shell' })
    const { manager, pty } = managerWith({
      prepare: boundary === 'prepare' ? async () => { enter(); await gate } : async () => {},
      resolveLaunch: boundary === 'resolve' ? async () => { enter(); await gate; return launch() } : launch,
    })
    const pending = manager.start(startRequest())
    await entered
    manager.disposeAll()
    release()
    await assert.rejects(pending, /卸载/)
    assert.equal(pty.spawned.length, 0, `${boundary} continuation cannot spawn after disposeAll`)
  }
})

test('managed manager: host exit retains capacity and stop until late tree/output proof updates the same record', async () => {
  const managed = fakeManaged()
  const updates = []
  const clock = { now: 1_000 }
  const { manager, ended } = managerWith({
    ...managedOptions(managed), clock, limits: { ...TERMINAL_LIMITS, maxSessions: 1 },
    onSessionUpdate: record => updates.push(record),
  })
  const session = await manager.start(startRequest())
  const proc = managed.spawned[0]
  assert.equal(proc.resumeCalls, 1)
  assert.equal(session.containment, 'windows-job')
  proc.emit('host output')
  proc.exit(0)
  assert.equal(ended.length, 1)
  let output = await manager.read({ sessionId: session.sessionId, cursor: 0 })
  assert.deepEqual({ data: output.data, exited: output.exited, closed: output.closed, treeClosed: output.treeClosed },
    { data: 'host output', exited: true, closed: false, treeClosed: false })
  await assert.rejects(manager.start(startRequest()), /最多同时运行 1 个/)
  const stopped = manager.stop({ sessionId: session.sessionId })
  assert.deepEqual({ stopped: stopped.stopped, stopRequested: stopped.stopRequested, stopConfirmed: stopped.stopConfirmed, exited: stopped.exited },
    { stopped: false, stopRequested: true, stopConfirmed: false, exited: true })
  manager.stop({ sessionId: session.sessionId })
  assert.equal(proc.killCalls, 1)
  clock.now += 61_000
  manager.sweep()
  assert.ok(manager.info().sessions.some(item => item.sessionId === session.sessionId), 'host exit alone never sweeps a live tree')
  proc.closeTree()
  proc.dropOutput(9)
  proc.closeOutput({ outputTruncated: true, bytesDropped: 9 })
  proc.resolveClosed({ outputTruncated: true, bytesDropped: 9 })
  await new Promise(resolve => setImmediate(resolve))
  output = await manager.read({ sessionId: session.sessionId, cursor: output.cursor })
  assert.deepEqual({ closed: output.closed, treeClosed: output.treeClosed, outputClosed: output.outputClosed,
    stopConfirmed: output.stopConfirmed, outputTruncated: output.outputTruncated, bytesDropped: output.bytesDropped },
    { closed: true, treeClosed: true, outputClosed: true, stopConfirmed: true, outputTruncated: true, bytesDropped: 9 })
  assert.equal(ended.length, 1, 'late proof events never repeat the host-end callback')
  assert.ok(updates.length >= 3)
  assert.ok(updates.every(record => record.id === session.sessionId))
  assert.equal(updates.at(-1).treeClosed, true)
  assert.equal(updates.at(-1).outputTruncated, true)
  const next = await manager.start(startRequest())
  assert.equal(next.backend, 'managed', 'tree proof releases capacity even though the prior host already exited')
  manager.disposeAll()
  assert.equal(managed.spawned[1].killCalls, 1)
})

test('managed manager: control loss and kill acceptance never manufacture tree confirmation', async () => {
  const managed = fakeManaged()
  const { manager, ended } = managerWith(managedOptions(managed))
  const session = await manager.start(startRequest())
  const stopped = manager.stop({ sessionId: session.sessionId })
  assert.equal(stopped.stopRequested, true)
  assert.equal(stopped.stopConfirmed, false)
  managed.spawned[0].loseControl('NATIVE_TERMINAL_STOP_TIMEOUT')
  const output = await manager.read({ sessionId: session.sessionId, cursor: 0 })
  assert.deepEqual({ exited: output.exited, controlLost: output.controlLost, controlError: output.controlError,
    stopRequested: output.stopRequested, stopConfirmed: output.stopConfirmed, treeClosed: output.treeClosed },
    { exited: false, controlLost: true, controlError: 'NATIVE_TERMINAL_STOP_TIMEOUT', stopRequested: true, stopConfirmed: false, treeClosed: false })
  assert.equal(ended.length, 0)
})

test('managed manager: startup failure is explicit and never falls back to legacy PTY', async () => {
  const managed = fakeManaged()
  const { manager, pty } = managerWith({ ...managedOptions(managed),
    createManaged: async () => { throw new Error('NATIVE_TERMINAL_UNSUPPORTED') } })
  assert.equal(manager.info().backend, 'managed')
  await assert.rejects(manager.start(startRequest()), /NATIVE_TERMINAL_UNSUPPORTED/)
  assert.equal(pty.spawned.length, 0)
})

test('managed manager: orphan and dispose still stop the tree after host exit', async () => {
  for (const reason of ['orphan', 'dispose']) {
    const managed = fakeManaged()
    const clock = { now: 1_000 }
    const { manager } = managerWith({ ...managedOptions(managed), clock })
    const session = await manager.start(startRequest())
    managed.spawned[0].exit(0)
    if (reason === 'orphan') {
      clock.now += TERMINAL_LIMITS.orphanTimeoutMs + 1
      manager.sweep()
    } else manager.disposeAll()
    assert.equal(managed.spawned[0].killCalls, 1)
    const current = manager.info().sessions.find(item => item.sessionId === session.sessionId)
    assert.deepEqual({ exited: current.exited, stopRequested: current.stopRequested, stopConfirmed: current.stopConfirmed },
      { exited: true, stopRequested: true, stopConfirmed: false })
  }
})

test('managed manager: listeners are installed before resume so immediate exit and closure are not lost', async () => {
  const managed = fakeManaged()
  const createManaged = async options => {
    const proc = await managed.createManaged(options)
    proc.resume = async () => {
      proc.resumeCalls += 1
      proc.exit(0)
      proc.closeTree()
      proc.closeOutput()
      proc.resolveClosed()
    }
    return proc
  }
  const { manager, ended } = managerWith({ ...managedOptions(managed), createManaged })
  const session = await manager.start(startRequest())
  assert.equal(managed.spawned[0].resumeCalls, 1)
  assert.equal(ended.length, 1)
  const output = await manager.read({ sessionId: session.sessionId, cursor: 0 })
  assert.deepEqual({ exited: output.exited, treeClosed: output.treeClosed, outputClosed: output.outputClosed, closed: output.closed },
    { exited: true, treeClosed: true, outputClosed: true, closed: true })
  assert.equal(session.exitCode, 0)
})

test('managed manager: dispose during async factory prevents resume and cleans the owned start', async () => {
  const managed = fakeManaged()
  let enter
  const entered = new Promise(resolve => { enter = resolve })
  let release
  const gate = new Promise(resolve => { release = resolve })
  const createManaged = async options => {
    enter()
    await gate
    const proc = await managed.createManaged(options)
    proc.resolveClosed()
    return proc
  }
  const { manager } = managerWith({ ...managedOptions(managed), createManaged })
  const pending = manager.start(startRequest())
  await entered
  manager.disposeAll()
  release()
  await assert.rejects(pending, /卸载/)
  assert.equal(managed.spawned[0].resumeCalls, 0)
  assert.equal(managed.spawned[0].killCalls, 1)
  assert.equal(manager.info().sessions.length, 0)
})

test('managed manager: pending resume slots are reserved exactly once', async () => {
  const managed = fakeManaged()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const createManaged = async options => {
    const proc = await managed.createManaged(options)
    proc.resume = async () => { proc.resumeCalls += 1; await gate }
    return proc
  }
  const { manager } = managerWith({ ...managedOptions(managed), createManaged,
    limits: { ...TERMINAL_LIMITS, maxSessions: 4 } })
  const starts = Array.from({ length: 5 }, () => manager.start(startRequest()))
  const settled = Promise.allSettled(starts)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(managed.spawned.length, 4)
  release()
  const results = await settled
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  assert.match(results.find(result => result.status === 'rejected').reason.message, /最多同时运行 4 个/)
  manager.disposeAll()
})

test('manager: lifetime cap and bounded output buffer', async () => {
  const clock = { now: 1_000 }
  const { manager, pty, ended } = managerWith({ clock, limits: { ...TERMINAL_LIMITS, bufferChars: 10, readChars: 4 } })
  const session = await manager.start(startRequest())
  pty.spawned[0].emit('0123456789abcdef')
  const output = await manager.read({ sessionId: session.sessionId, cursor: 0 })
  assert.equal(output.dropped, true, 'the client is told that early output was discarded')
  assert.equal(output.data, '6789')
  assert.equal(output.cursor, 10)
  clock.now += TERMINAL_LIMITS.maxLifetimeMs + 1
  manager.sweep()
  // The read above refreshed lastReadAt at 1_000, so the orphan check fires first; either way the process ends.
  assert.equal(pty.spawned[0].killed, true)
  assert.ok(['lifetime', 'orphan'].includes(ended[0].endReason))
})

test('manager falls back to pipes with a clear limitation when the PTY cannot load', async () => {
  const pipes = []
  const { manager } = managerWith({
    ptyOk: false,
    spawnPipe: (launch, options) => {
      pipes.push({ launch, options })
      return { pid: 1, onData() {}, onExit() {}, write() {}, resize: () => false, kill() {} }
    },
  })
  const info = manager.info()
  assert.equal(info.backend, 'pipe')
  assert.equal(info.limitation, PIPE_LIMITATION)
  assert.match(info.ptyError, /Cannot find module/)
  const session = await manager.start(startRequest({ target: 'codex', mode: 'login' }))
  assert.equal(session.backend, 'pipe')
  assert.match(session.limitation, /管道模式/)
  assert.equal(pipes[0].launch.file, '/bin/codex')
  assert.deepEqual(await manager.resize({ sessionId: session.sessionId, cols: 100, rows: 30 }), { resized: false })
})

test('pipe process echoes input, maps Enter and turns Ctrl+C into a kill', { skip: process.platform === 'win32' }, async () => {
  const proc = spawnPipeProcess({ file: process.execPath, args: ['-e', 'process.stdin.on("data", d => process.stdout.write("got:" + d))'], verbatim: false },
    { cwd: tmpdir(), env: process.env, platform: 'linux' })
  let output = ''
  const exited = new Promise(resolve => proc.onExit(resolve))
  proc.onData(data => { output += data })
  proc.write('hello\r')
  await new Promise(resolve => { const timer = setInterval(() => { if (output.includes('got:hello')) { clearInterval(timer); resolve() } }, 10) })
  assert.match(output, /^hello\r\n/, 'local echo of the typed line')
  assert.match(output, /got:hello\r\n/, 'Enter reaches the child as a newline; output newlines become CRLF')
  proc.write('\x03')
  const event = await exited
  assert.equal(event.exitCode === 0, false)
})

test('the bundled PTY loads and runs a real shell when available', { skip: !loadPtyModule().ok || process.platform === 'win32' }, async () => {
  const manager = createTerminalManager({ setRepeating: () => ({ unref() {} }), clearRepeating: () => {} })
  const session = await manager.start({ target: 'shell', mode: 'interactive', cwd: tmpdir(), cols: 90, rows: 20, confirmed: true })
  assert.equal(session.backend, 'pty')
  manager.write({ sessionId: session.sessionId, data: 'stty size; exit 3\r' })
  let cursor = 0
  let text = ''
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const output = await manager.read({ sessionId: session.sessionId, cursor, waitMs: 500 })
    cursor = output.cursor
    text += output.data
    if (output.exited) { assert.equal(output.exitCode, 3); break }
  }
  assert.match(text, /20 90/)
  manager.disposeAll()
})

test('Host remote services re-validate terminal requests and keep metadata-only history', async () => {
  const ended = []
  const { manager, pty } = managerWith({ ended })
  const terminals = host.createRouterTerminals({
    loadPty: () => ({ ok: true, pty: pty.module, package: '@lydell/node-pty' }),
    resolveLaunch: async () => ({ file: '/bin/sh', args: [], verbatim: false, display: 'sh' }),
    statPath: async () => ({ isDirectory: () => true }),
    prepare: async () => {},
    environment: () => ({ PATH: '/bin' }),
    setRepeating: () => ({ unref() {} }),
    clearRepeating: () => {},
  })
  const ctx = strictCtx({ typert: {}, sandbox: {}, sandboxPolicy: {}, commands: {}, llm: {}, tools: {} })
  const services = host.routerRemoteServices(ctx, {}, { terminals })
  await assert.rejects(services.terminalStart(startRequest({ confirmed: false })), /confirmation/)
  await assert.rejects(services.terminalStart(startRequest({ target: 'C:\\Windows\\System32\\cmd.exe' })), /target/)
  const session = await services.terminalStart(startRequest())
  pty.spawned.at(-1).emit('$ ')
  assert.equal((await services.terminalRead({ sessionId: session.sessionId, cursor: 0 })).data, '$ ')
  await services.terminalWrite({ sessionId: session.sessionId, data: 'typed-secret\r' })
  await services.terminalStop({ sessionId: session.sessionId })
  // History is written asynchronously after the process ends.
  let info
  for (let attempt = 0; attempt < 50; attempt += 1) {
    info = await services.terminalInfo()
    if (info.history.some(item => item.id === session.sessionId)) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const record = info.history.find(item => item.id === session.sessionId)
  assert.equal(record.endReason, 'stopped')
  assert.equal(record.target, 'shell')
  const stateText = await readFile(host.routerStateStore().file, 'utf8')
  assert.equal(stateText.includes('typed-secret'), false, 'keystrokes never reach the state file')
  assert.equal(JSON.parse(stateText).terminalSessions.length >= 1, true)
  terminals.disposeAll()
  manager.disposeAll()
  // Without a terminal manager the services are simply absent (old callers).
  assert.equal(host.routerRemoteServices(ctx, {}).terminalStart, undefined)
})

test('apply registers the terminal manager under the plugin fiber and disposes it on unload', () => {
  const effects = []
  const ctx = strictCtx({
    typert: { register: () => () => {} },
    effect: (factory, label) => { effects.push({ label, dispose: factory() }) },
    on: () => {}, tools: { register: () => {} }, commands: { register: () => {} }, llm: {}, sandbox: {}, sandboxPolicy: {},
    get: () => undefined, provide: () => {}, set: () => {}, accessor: () => {}, root: { reflect: { props: {} }, accessor: () => {} },
  })
  try { host.apply(ctx, {}) } catch { /* only the effect registration matters here */ }
  const terminal = effects.find(item => item.label === 'model-router-galgame: interactive terminals')
  assert.ok(terminal, 'terminal lifetime is tied to the plugin fiber')
  terminal.dispose()
})

test('client: launch choices come from the health check; confirmation states the sandbox boundary', () => {
  const targets = terminalTargets([{ id: 'codex', installed: true }, { id: 'claude-code', installed: false }, { id: 'zcode', installed: true }, { id: 'gemini', installed: true }], 'win32')
  assert.deepEqual(targets.map(item => item.id), ['shell', ...OFFICIAL_TOOLS.filter(item => ['codex', 'gemini', 'zcode'].includes(item.id)).map(item => item.id)])
  assert.equal(targets.find(item => item.id === 'gemini').canLogin, false)
  assert.equal(startProblem({ target: 'codex', cwd: 'demo', targets }), '工作目录必须是绝对路径，例如 D:\\projects\\demo 或 /home/me/project。')
  assert.equal(startProblem({ target: 'claude-code', cwd: 'D:\\x', targets }), '请选择要启动的终端。')
  assert.equal(startProblem({ target: 'codex', cwd: 'D:\\x', targets }), '')
  const details = confirmationDetails({ target: 'codex', mode: 'login', cwd: 'D:\\x', platform: 'win32' })
  assert.equal(details.command, 'codex login')
  assert.match(details.points.join('\n'), /不经过 Harness 进程沙箱/)
  assert.match(details.points.join('\n'), /自己的 CLI 登录/)
  assert.match(details.points.join('\n'), /不会被记录/)
  assert.match(endDescription({ endReason: 'exit', exitCode: 2 }), /退出码 2/)
  const stopping = endDescription({ endReason: 'stopped', stopRequested: true, stopConfirmed: false, exited: false })
  assert.match(stopping, /正在停止/)
  assert.match(stopping, /尚未确认/)
  assert.doesNotMatch(stopping, /已由你结束|已自动结束|会话已结束/)
  const exitedWithoutTreeProof = endDescription({ endReason: 'stopped', exitCode: 7, stopRequested: true, stopConfirmed: false, exited: true })
  assert.match(exitedWithoutTreeProof, /会话已退出，退出码 7，但派生进程停止尚未确认/)
  assert.doesNotMatch(exitedWithoutTreeProof, /已由你结束/)
  assert.match(endDescription({ endReason: 'lost', exitCode: null }), /状态未知/)
})

test('terminal refresh ignores an earlier directory response arriving after a newer refresh', async () => {
  const refresher = new TerminalInfoRefresher()
  let resolveEarlier
  const earlier = refresher.load({ terminalInfo: () => new Promise(resolve => { resolveEarlier = resolve }) })
  const currentTools = [{ id: 'zcode', installed: true }, { id: 'stepcode', installed: true }]
  const newer = await refresher.load({ terminalInfo: async () => ({ ok: true, value: { backend: 'pty', tools: currentTools } }) })
  resolveEarlier({ ok: true, value: { backend: 'pty', tools: [{ id: 'codex', installed: true }] } })
  assert.equal(await earlier, null)
  assert.deepEqual(terminalInfoTools(newer.value), currentTools)
  assert.deepEqual(terminalInfoTools({ tools: [] }, [{ id: 'codex', installed: true }]), [],
    'an empty fresh Host list also wins over stale cached health')
  let rejectEarlier
  const invalidated = refresher.load({ terminalInfo: () => new Promise((resolve, reject) => { rejectEarlier = reject }) })
  refresher.invalidate()
  rejectEarlier(new Error('stale settings failure'))
  assert.equal(await invalidated, null)
  assert.deepEqual(terminalInfoTools({}, currentTools), currentTools, 'old Hosts without a tools projection retain health compatibility')
})

test('client transport: ordered coalesced input, long-poll output, single stop', async () => {
  const calls = []
  const outputs = [
    { ok: true, value: { data: 'hello ', cursor: 6, exited: false } },
    { ok: true, value: { data: 'world', cursor: 11, exited: false } },
    { ok: true, value: { data: '', cursor: 11, exited: true, exitCode: 0, endReason: 'exit' } },
  ]
  let release
  const gate = new Promise(resolve => { release = resolve })
  const api = {
    terminalRead: async request => { calls.push(['read', request.cursor]); if (request.cursor === 11) await gate; return outputs.shift() },
    terminalWrite: async request => { calls.push(['write', request.data]); await new Promise(resolve => setTimeout(resolve, 5)); return { ok: true, value: { written: request.data.length } } },
    terminalResize: async request => { calls.push(['resize', request.cols, request.rows]); return { ok: true, value: { resized: true } } },
    terminalStop: async () => { calls.push(['stop']); return { ok: true, value: { stopped: true } } },
  }
  let screen = ''
  let exit = null
  // Browsers throw "Illegal invocation" when window.setTimeout/clearTimeout run with a foreign `this`.
  function browserSetTimeout(callback, ms) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); return setTimeout(callback, ms) }
  function browserClearTimeout(id) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); return clearTimeout(id) }
  const connection = new TerminalConnection({ api, sessionId: 'term-abcdef123456', onData: data => { screen += data }, onExit: event => { exit = event }, resizeDelayMs: 1, setTimer: browserSetTimeout, clearTimer: browserClearTimeout })
  const loop = connection.start()
  connection.send('a')
  connection.send('b')
  connection.send('c')
  connection.resize(100, 30)
  connection.resize(120, 40)
  await new Promise(resolve => setTimeout(resolve, 30))
  release()
  await loop
  assert.equal(screen, 'hello world')
  assert.deepEqual(exit, { endReason: 'exit', exitCode: 0, stopRequested: false, stopConfirmed: false, exited: true })
  assert.deepEqual(calls.filter(call => call[0] === 'write'), [['write', 'a'], ['write', 'bc']], 'input order is kept; keys typed during a write are batched')
  assert.deepEqual(calls.filter(call => call[0] === 'resize'), [['resize', 120, 40]], 'resizes are debounced')
  await connection.stop()
  assert.equal(calls.filter(call => call[0] === 'stop').length, 0, 'an exited session needs no stop')

  const live = new TerminalConnection({ api: { ...api, terminalRead: () => new Promise(() => {}) }, sessionId: 'term-abcdef123456' })
  void live.start()
  await live.stop()
  await live.stop()
  assert.equal(calls.filter(call => call[0] === 'stop').length, 1, 'closing the panel stops the session once')
})

test('client transport exposes stopping and host-exited tree-unconfirmed as distinct states', async () => {
  const outputs = [
    { data: '', cursor: 0, exited: false, endReason: 'stopped', stopRequested: true, stopConfirmed: false },
    { data: '', cursor: 0, exited: true, exitCode: 7, endReason: 'stopped', stopRequested: true, stopConfirmed: false },
  ]
  const statuses = []
  let exit = null
  const connection = new TerminalConnection({
    api: { terminalRead: async () => ({ ok: true, value: outputs.shift() }) },
    sessionId: 'term-abcdef123456', onStatus: status => statuses.push(status), onExit: event => { exit = event },
  })
  await connection.start()
  assert.deepEqual(statuses, [
    { stopRequested: true, stopConfirmed: false, exited: false, endReason: 'stopped' },
    { stopRequested: true, stopConfirmed: false, exited: true, endReason: 'stopped' },
  ])
  assert.deepEqual(exit, { stopRequested: true, stopConfirmed: false, exited: true, endReason: 'stopped', exitCode: 7 })
})

test('client transport: managed host exit keeps polling until tree/output closure and buffer drain', async () => {
  const outputs = [
    { backend: 'managed', treeTracking: true, containment: 'windows-job', data: 'tail', cursor: 4,
      exited: true, exitCode: 0, endReason: 'exit', treeClosed: false, outputClosed: false, closed: false },
    { backend: 'managed', treeTracking: true, containment: 'windows-job', data: '', cursor: 4,
      exited: true, exitCode: 0, endReason: 'exit', treeClosed: true, stopConfirmed: true, outputClosed: false, closed: false },
    { backend: 'managed', treeTracking: true, containment: 'windows-job', data: '', cursor: 4,
      exited: true, exitCode: 0, endReason: 'exit', treeClosed: true, stopConfirmed: true, outputClosed: true,
      outputTruncated: true, bytesDropped: 12, closed: true },
  ]
  const statuses = []
  const exits = []
  let screen = ''
  const connection = new TerminalConnection({
    api: { terminalRead: async () => ({ ok: true, value: outputs.shift() }) },
    sessionId: 'term-abcdef123456', onData: data => { screen += data },
    onStatus: status => statuses.push(status), onExit: event => exits.push(event),
  })
  await connection.start()
  assert.equal(screen, 'tail')
  assert.equal(statuses.length, 3)
  assert.equal(statuses[0].exited, true)
  assert.equal(statuses[0].treeClosed, false)
  assert.equal(statuses[1].outputClosed, false)
  assert.equal(exits.length, 1)
  assert.deepEqual({ treeClosed: exits[0].treeClosed, outputClosed: exits[0].outputClosed,
    outputTruncated: exits[0].outputTruncated, bytesDropped: exits[0].bytesDropped },
    { treeClosed: true, outputClosed: true, outputTruncated: true, bytesDropped: 12 })
})

test('stale Host: a 404 for a new remote method becomes restart advice; list() reports the Host version', async () => {
  const { isMissingRemoteMethod, remoteErrorText, staleHostNotice, STALE_HOST_MESSAGE } = await import('../.dsh-plugin/client/host-version.mjs')
  // Exact text the Harness client gateway produced for 0.14.0-beta.1 against a Host still running 0.13.3.
  const observed = 'client api: modelRouterOfficialTools/terminalInfo failed: transport failure for /api/modelRouterOfficialTools/terminalInfo: HTTP 404'
  assert.equal(isMissingRemoteMethod(observed), true)
  assert.equal(remoteErrorText(observed, 'x'), STALE_HOST_MESSAGE)
  assert.match(STALE_HOST_MESSAGE, /插件后台版本较旧，请完全退出并重启 Harness/)
  assert.equal(remoteErrorText('transport failure for /api/a/b: HTTP 500', 'x'), 'transport failure for /api/a/b: HTTP 500')
  assert.equal(remoteErrorText('', 'fallback'), 'fallback')
  assert.match(staleHostNotice({ hostVersion: null, clientVersion: '0.14.0-beta.2' }), /后台为更早版本/)
  assert.match(staleHostNotice({ hostVersion: '0.14.0-beta.1', clientVersion: '0.14.0-beta.2' }), /后台为 0.14.0-beta.1/)
  assert.equal(staleHostNotice({ hostVersion: '0.14.0-beta.2', clientVersion: '0.14.0-beta.2' }), '')
  assert.equal(staleHostNotice({ hostVersion: null, clientVersion: '0.14.0-beta.2', loaded: false }), '')

  // The transport turns that 404 into the same advice.
  let failure = null
  const connection = new TerminalConnection({
    api: { terminalRead: async () => ({ ok: false, error: { message: observed } }) },
    sessionId: 'term-abcdef123456', onError: error => { failure = error; connection.closed = true },
  })
  await connection.start()
  assert.equal(failure.message, STALE_HOST_MESSAGE)

  const { HOST_PLUGIN_VERSION } = await import('../.dsh-plugin/official-tools-remote-service.mjs')
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(HOST_PLUGIN_VERSION, manifest.version)
  const source = await readFile(new URL('../.dsh-plugin/official-tools-remote-service.mjs', import.meta.url), 'utf8')
  assert.match(source, /hostVersion: HOST_PLUGIN_VERSION/)
  // The bundled client carries the same version for the comparison.
  const bundle = await readFile(new URL('../.dsh-plugin/client.js', import.meta.url), 'utf8')
  assert.ok(bundle.includes(JSON.stringify(manifest.version)), 'client.js embeds its package version')
})
