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
  spawnPipeProcess({ file: 'C:/Windows/System32/cmd.exe', args: '/d /s /c ""D:/Tools Space/mcode.cmd" login"', verbatim: true }, {
    platform: 'win32', cwd: CWD, env: {}, spawnImpl: (...args) => { request = args; return child },
  })
  assert.deepEqual(request[1], ['/d /s /c ""D:/Tools Space/mcode.cmd" login"'])
  assert.equal(request[2].windowsVerbatimArguments, true)
  assert.equal(request[2].shell, false)
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
  assert.deepEqual(manager.resize({ sessionId: session.sessionId, cols: 132, rows: 43 }), { resized: true })
  assert.deepEqual(proc.sizes, [[132, 43]])

  proc.exit(0)
  output = await manager.read({ sessionId: session.sessionId, cursor: output.cursor })
  assert.equal(output.exited, true)
  assert.equal(output.exitCode, 0)
  assert.throws(() => manager.write({ sessionId: session.sessionId, data: 'x' }), /已结束/)
  assert.equal(ended.length, 1)
  assert.deepEqual(Object.keys(ended[0]).sort(), ['backend', 'cwd', 'durationMs', 'endReason', 'exitCode', 'finishedAt', 'id', 'label', 'mode', 'startedAt', 'target'])
  const serialized = JSON.stringify(ended)
  for (const leaked of ['my-secret-password', 'ABCD-1234', 'Welcome', 'SECRET_TOKEN']) assert.equal(serialized.includes(leaked), false, leaked)
})

test('manager: stop, orphan timeout, lifetime, session cap and dispose all kill the process', async () => {
  const clock = { now: 1_000 }
  const { manager, pty, ended } = managerWith({ clock, limits: { ...TERMINAL_LIMITS, maxSessions: 2 } })
  const first = await manager.start(startRequest())
  const second = await manager.start(startRequest())
  await assert.rejects(manager.start(startRequest()), /最多同时运行 2 个/)
  assert.deepEqual(manager.stop({ sessionId: first.sessionId }), { stopped: true })
  assert.equal(pty.spawned[0].killed, true)
  assert.equal(ended[0].endReason, 'stopped')
  // The panel stopped reading (closed without a stop call): the sweep ends it.
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
  await assert.rejects(manager.start(startRequest()), /卸载/)
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
  assert.deepEqual(manager.resize({ sessionId: session.sessionId, cols: 100, rows: 30 }), { resized: false })
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
  assert.deepEqual(exit, { endReason: 'exit', exitCode: 0 })
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
