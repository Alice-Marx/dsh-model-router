/**
 * Host session manager for the workbench "官方工具终端".
 *
 * Starts the user's own shell or one fixed registry CLI in a pseudo terminal
 * (prebuilt @lydell/node-pty, N-API, no build tools), outside the Harness
 * process sandbox and with the Host's full login environment so the CLI's own
 * account login works exactly as in the user's terminal. When the native PTY
 * cannot load, sessions fall back to plain pipes with documented limits.
 *
 * Output is buffered per session for the client's long-poll reads; input is
 * forwarded verbatim and never logged or persisted. Only session metadata
 * (target, directory, duration, exit code) is recorded.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { StringDecoder } from 'node:string_decoder'
import { extname } from 'node:path'
import { getOfficialTool } from './official-tool-registry.mjs'
import {
  TERMINAL_LIMITS,
  TERMINAL_LOGIN_ARGS,
  TERMINAL_SHELL_ID,
  TERMINAL_TOOL_IDS,
  terminalTargetLabel,
} from './cli-terminal-protocol.mjs'

export const PTY_PACKAGE = '@lydell/node-pty'
export const PIPE_LIMITATION = '未能加载伪终端（PTY）组件，已改用管道模式：程序看不到真实终端，全屏界面（如 codex、claude 的交互界面）可能无法显示或拒绝启动，窗口大小不会同步，方向键等按键可能无效，输入由插件回显。登录命令（如 codex login）、普通命令行和 PowerShell 一般可用。'

const REMOVE_EXITED_AFTER_MS = 60_000
const SWEEP_INTERVAL_MS = 10_000
const LOCATE_TIMEOUT_MS = 8_000

let cachedPty = null

/**
 * Load the prebuilt PTY once. Returns { ok, pty } or { ok: false, error }.
 * `requireFrom` is injectable for tests.
 */
export function loadPtyModule({ requireFrom = createRequire(import.meta.url), fresh = false } = {}) {
  if (cachedPty && !fresh) return cachedPty
  try {
    const pty = requireFrom(PTY_PACKAGE)
    if (typeof pty?.spawn !== 'function') throw new Error(`${PTY_PACKAGE} 没有 spawn()`)
    cachedPty = { ok: true, pty, package: PTY_PACKAGE }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    cachedPty = { ok: false, error: message.split('\n')[0].slice(0, 400), package: PTY_PACKAGE }
  }
  return cachedPty
}

/**
 * Environment for an interactive session: the Host's own (the user's login
 * environment, including any npm prefix the plugin put on PATH), not the
 * sandbox's allow-listed minimum. ELECTRON_RUN_AS_NODE is removed so Electron
 * apps started from the terminal (for example `code`) open normally.
 */
export function terminalEnvironment(env = process.env) {
  const result = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') continue
    result[key] = value
  }
  result.TERM = 'xterm-256color'
  result.COLORTERM = 'truecolor'
  return result
}

const WINDOWS_PREFERENCE = ['.exe', '.com', '.cmd', '.bat', '.ps1']

/** Pick the executable Windows would run, preferring native binaries over shims. */
export function pickWindowsExecutable(candidates) {
  const usable = candidates.map(item => String(item).trim()).filter(Boolean)
  for (const extension of WINDOWS_PREFERENCE) {
    const found = usable.find(item => extname(item).toLowerCase() === extension)
    if (found) return found
  }
  return null
}

const quoteWindows = path => `"${String(path).replace(/"/g, '')}"`

/**
 * Build the fixed launch for one target. `locate(executable)` returns the
 * candidate paths `where`/`which` printed. Returns
 * { file, args, verbatim, display } where `verbatim` means `args` is one
 * pre-quoted Windows command-line tail.
 */
export async function resolveTerminalLaunch(target, mode = 'interactive', {
  platform = process.platform, env = process.env, locate = defaultLocate,
} = {}) {
  if (target === TERMINAL_SHELL_ID) {
    if (platform === 'win32') {
      const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows'
      const file = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      return { file, args: ['-NoLogo'], verbatim: false, display: 'powershell.exe -NoLogo' }
    }
    const shell = env.SHELL && env.SHELL.startsWith('/') ? env.SHELL : '/bin/bash'
    return { file: shell, args: ['-l'], verbatim: false, display: `${shell} -l` }
  }
  if (!TERMINAL_TOOL_IDS.includes(target)) throw new Error('只能启动系统终端或固定注册表中的官方 CLI。')
  const tool = getOfficialTool(target)
  const executable = tool.probeExecutables[0]
  const args = mode === 'login' ? [...(TERMINAL_LOGIN_ARGS[target] ?? [])] : []
  const display = [executable, ...args].join(' ')
  const candidates = await locate(executable, { platform, env })
  if (platform !== 'win32') {
    const file = candidates.map(item => String(item).trim()).find(item => item.startsWith('/'))
    if (!file) throw new Error(`未在 PATH 中找到 ${executable}；请先在“官方工具 · 体检”中安装 ${tool.label}。`)
    return { file, args, verbatim: false, display }
  }
  const file = pickWindowsExecutable(candidates)
  if (!file) throw new Error(`未在 PATH 中找到 ${executable}；请先在“官方工具 · 体检”中安装 ${tool.label}。`)
  const extension = extname(file).toLowerCase()
  if (extension === '.cmd' || extension === '.bat') {
    // npm shims only run under cmd.exe. Every token is fixed by the registry.
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe'
    const tail = `/d /s /c "${[quoteWindows(file), ...args].join(' ')}"`
    return { file: comspec, args: tail, verbatim: true, display }
  }
  if (extension === '.ps1') {
    const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
    return { file: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: ['-NoLogo', '-NoProfile', '-File', file, ...args], verbatim: false, display }
  }
  return { file, args, verbatim: false, display }
}

/** Locate an executable with where.exe / which (fixed registry names only). */
export function defaultLocate(executable, { platform = process.platform, env = process.env } = {}) {
  return new Promise(resolve => {
    let stdout = ''
    let child
    try {
      child = spawn(platform === 'win32' ? 'where' : 'which', platform === 'win32' ? [executable] : ['-a', executable], {
        stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env, shell: false,
      })
    } catch { resolve([]); return }
    const timer = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, LOCATE_TIMEOUT_MS)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.on('error', () => { clearTimeout(timer); resolve([]) })
    child.on('close', () => { clearTimeout(timer); resolve(stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) })
  })
}

/** PTY-backed process adapter. */
function spawnPtyProcess(pty, launch, { cwd, cols, rows, env }) {
  const proc = pty.spawn(launch.file, launch.args, { name: 'xterm-256color', cols, rows, cwd, env })
  return {
    pid: proc.pid,
    onData: listener => { proc.onData(listener) },
    onExit: listener => { proc.onExit(event => listener({ exitCode: event?.exitCode ?? null, signal: event?.signal ?? null })) },
    write: data => { proc.write(data) },
    resize: (nextCols, nextRows) => { proc.resize(nextCols, nextRows); return true },
    kill: () => { proc.kill() },
  }
}

/** Pipe fallback: no TTY; the Host echoes input and maps Enter/Ctrl+C. */
export function spawnPipeProcess(launch, { cwd, env, platform = process.platform, spawnImpl = spawn }) {
  const child = spawnImpl(launch.file, launch.args, {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
    windowsVerbatimArguments: launch.verbatim === true,
  })
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  const listeners = { data: [], exit: [] }
  let exited = false
  const emit = text => { if (text) for (const listener of listeners.data) listener(text.replace(/(?<!\r)\n/g, '\r\n')) }
  child.stdout?.on('data', chunk => emit(stdoutDecoder.write(chunk)))
  child.stderr?.on('data', chunk => emit(stderrDecoder.write(chunk)))
  const finish = (exitCode, signal) => {
    if (exited) return
    exited = true
    emit(stdoutDecoder.end())
    emit(stderrDecoder.end())
    for (const listener of listeners.exit) listener({ exitCode, signal })
  }
  child.on('error', error => { emit(`\r\n[启动失败] ${error?.message ?? error}\r\n`); finish(null, null) })
  child.on('close', (code, signal) => finish(code, signal))
  const newline = platform === 'win32' ? '\r\n' : '\n'
  const kill = () => {
    if (exited) return
    if (platform === 'win32' && child.pid) {
      try { spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* fall through */ }
    }
    try { child.kill() } catch { /* gone */ }
  }
  return {
    pid: child.pid,
    onData: listener => { listeners.data.push(listener) },
    onExit: listener => { listeners.exit.push(listener) },
    write: data => {
      if (data === '\x03') { emit('^C\n'); kill(); return }
      const text = data.replace(/\r\n?/g, '\n')
      // Local echo: the child has no terminal to echo the line for us.
      emit(data.replace(/\x7f/g, '\b \b').replace(/\r(?!\n)/g, '\n'))
      try { child.stdin?.write(text.replace(/\n/g, newline)) } catch { /* closed */ }
    },
    resize: () => false,
    kill,
  }
}

function newSessionId(random = randomBytes) {
  return `term-${random(12).toString('hex')}`
}

/**
 * Create the per-Host session manager. Every dependency is injectable so the
 * test suite never spawns a real terminal.
 */
export function createTerminalManager({
  loadPty = loadPtyModule,
  spawnPipe = spawnPipeProcess,
  resolveLaunch = resolveTerminalLaunch,
  statPath = stat,
  prepare = async () => {},
  environment = () => terminalEnvironment(process.env),
  onSessionEnd = () => {},
  now = Date.now,
  platform = process.platform,
  limits = TERMINAL_LIMITS,
  randomId = newSessionId,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setRepeating = setInterval,
  clearRepeating = clearInterval,
} = {}) {
  const sessions = new Map()
  let sweeper = null
  let disposed = false

  const backendInfo = () => {
    const loaded = loadPty()
    return loaded.ok
      ? { backend: 'pty', package: loaded.package }
      : { backend: 'pipe', package: loaded.package, ptyError: loaded.error, limitation: PIPE_LIMITATION }
  }

  const summary = session => ({
    sessionId: session.id, target: session.target, label: terminalTargetLabel(session.target), mode: session.mode,
    cwd: session.cwd, backend: session.backend, display: session.display, startedAt: session.startedAt,
    exited: session.exited, exitCode: session.exitCode, endReason: session.endReason,
  })

  const wake = session => {
    const waiters = [...session.waiters]
    session.waiters.clear()
    for (const resolve of waiters) resolve()
  }

  const append = (session, text) => {
    if (!text) return
    session.text += text
    const overflow = session.text.length - limits.bufferChars
    if (overflow > 0) {
      session.text = session.text.slice(overflow)
      session.base += overflow
    }
    wake(session)
  }

  const finish = (session, { exitCode = null, signal = null } = {}) => {
    if (session.exited) return
    session.exited = true
    session.exitCode = exitCode
    session.signal = signal
    session.finishedAt = now()
    session.endReason ??= 'exit'
    wake(session)
    try {
      onSessionEnd({
        id: session.id, target: session.target, label: terminalTargetLabel(session.target), mode: session.mode,
        cwd: session.cwd, backend: session.backend, startedAt: session.startedAt, finishedAt: session.finishedAt,
        durationMs: Math.max(0, session.finishedAt - session.startedAt), exitCode, endReason: session.endReason,
      })
    } catch { /* recording must never break the terminal */ }
  }

  const terminate = (session, reason) => {
    if (session.exited) return
    session.endReason ??= reason
    try { session.proc.kill() } catch { /* already gone */ }
    // Some processes ignore the kill; report the session as ended regardless.
    session.killTimer = setTimer(() => finish(session, { exitCode: null }), 5_000)
    session.killTimer?.unref?.()
  }

  const sweep = () => {
    const at = now()
    for (const session of sessions.values()) {
      if (!session.exited) {
        if (at - session.lastReadAt > limits.orphanTimeoutMs) terminate(session, 'orphan')
        else if (at - session.startedAt > limits.maxLifetimeMs) terminate(session, 'lifetime')
      } else if (at - session.finishedAt > REMOVE_EXITED_AFTER_MS) {
        sessions.delete(session.id)
      }
    }
    if (sessions.size === 0 && sweeper !== null) { clearRepeating(sweeper); sweeper = null }
  }

  const ensureSweeper = () => {
    if (sweeper !== null) return
    sweeper = setRepeating(sweep, SWEEP_INTERVAL_MS)
    sweeper?.unref?.()
  }

  const get = id => {
    const session = sessions.get(id)
    if (!session) throw new Error('终端会话不存在或已结束。')
    return session
  }

  return {
    info() {
      return { ...backendInfo(), platform, limits, sessions: [...sessions.values()].map(summary) }
    },

    async start(request) {
      if (disposed) throw new Error('插件正在卸载，无法启动终端。')
      if (request?.confirmed !== true) throw new Error('启动终端前需要你的确认。')
      const live = [...sessions.values()].filter(session => !session.exited).length
      if (live >= limits.maxSessions) throw new Error(`最多同时运行 ${limits.maxSessions} 个终端会话，请先结束一个。`)
      let info
      try { info = await statPath(request.cwd) } catch { info = null }
      if (!info?.isDirectory?.()) throw new Error(`工作目录不存在或不是目录：${request.cwd}`)
      await prepare()
      const launch = await resolveLaunch(request.target, request.mode, { platform })
      const env = environment()
      const backend = backendInfo()
      const options = { cwd: request.cwd, cols: request.cols, rows: request.rows, env, platform }
      let proc
      try {
        proc = backend.backend === 'pty'
          ? spawnPtyProcess(loadPty().pty, launch, options)
          : spawnPipe(launch, options)
      } catch (error) {
        throw new Error(`无法启动 ${launch.display}：${error instanceof Error ? error.message : String(error)}`)
      }
      const at = now()
      const session = {
        id: randomId(), target: request.target, mode: request.mode, cwd: request.cwd, display: launch.display,
        backend: backend.backend, proc, startedAt: at, lastReadAt: at, finishedAt: null,
        text: '', base: 0, waiters: new Set(), exited: false, exitCode: null, signal: null, endReason: null, killTimer: null,
      }
      sessions.set(session.id, session)
      proc.onData(data => append(session, data))
      proc.onExit(event => {
        if (session.killTimer) clearTimer(session.killTimer)
        finish(session, event)
      })
      ensureSweeper()
      return { ...summary(session), pid: proc.pid ?? null, ...(backend.backend === 'pipe' ? { limitation: PIPE_LIMITATION, ptyError: backend.ptyError } : {}) }
    },

    async read({ sessionId, cursor = 0, waitMs = 0 }) {
      const session = get(sessionId)
      session.lastReadAt = now()
      const end = () => session.base + session.text.length
      if (cursor >= end() && !session.exited && waitMs > 0) {
        await new Promise(resolve => {
          const timer = setTimer(() => { session.waiters.delete(done); resolve() }, waitMs)
          const done = () => { clearTimer(timer); resolve() }
          session.waiters.add(done)
        })
        session.lastReadAt = now()
      }
      const dropped = cursor < session.base
      const from = Math.min(Math.max(cursor, session.base), end())
      const slice = session.text.slice(from - session.base, from - session.base + limits.readChars)
      const next = from + slice.length
      return {
        sessionId, data: slice, cursor: next, dropped,
        exited: session.exited && next >= end(), exitCode: session.exitCode, endReason: session.endReason,
      }
    },

    write({ sessionId, data }) {
      const session = get(sessionId)
      if (session.exited) throw new Error('终端会话已结束。')
      session.proc.write(data)
      return { written: data.length }
    },

    resize({ sessionId, cols, rows }) {
      const session = get(sessionId)
      if (session.exited) return { resized: false }
      let resized = false
      try { resized = session.proc.resize(cols, rows) === true } catch { resized = false }
      return { resized }
    },

    stop({ sessionId }) {
      const session = sessions.get(sessionId)
      if (!session) return { stopped: false, alreadyEnded: true }
      terminate(session, 'stopped')
      return { stopped: true }
    },

    /** Kill every session (plugin unload, Host exit). */
    disposeAll(reason = 'dispose') {
      disposed = true
      for (const session of sessions.values()) {
        if (session.exited) continue
        session.endReason ??= reason
        try { session.proc.kill() } catch { /* gone */ }
        finish(session, { exitCode: null })
      }
      if (sweeper !== null) { clearRepeating(sweeper); sweeper = null }
    },

    /** Test hook: run the orphan/lifetime sweep now. */
    sweep,
  }
}
