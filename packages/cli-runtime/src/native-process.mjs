import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, toNamespacedPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NativeCliOutput } from './native-cli-output.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const MAX_FRAME = 262_144
const COMPILER_ROOT = 'DSH_NATIVE_COMPILER_ROOT'
const COMPILER_SCRATCH = 'DSH_NATIVE_COMPILER_SCRATCH'
// Capture only the trusted Host launch environment, never a model's spec or an
// env argument. A packaged bridge inherits this one non-secret root hint so its
// compiler does not start a new root beneath an ever-deeper private TEMP.
const inheritedCompilerRoot = process.platform === 'win32' ? process.env[COMPILER_ROOT] : undefined
const hostTemp = process.platform === 'win32' ? tmpdir() : null
let compilerRoot = null
const compilerFailure = () => Object.assign(new Error('NATIVE_COMPILER_SCRATCH_UNAVAILABLE'), { code: 'NATIVE_COMPILER_SCRATCH_UNAVAILABLE' })
const sameDirectory = (info, expected) => info.isDirectory() && !info.isSymbolicLink() && info.dev === expected.dev && info.ino === expected.ino
const rootStamp = path => `dsh-native-compiler-v1:${basename(path)}\n`

/** Session homes are transient. Keep Windows profiles short even when installed deeply.
 * Callers must still protect the fresh home before writing account credentials.
 */
export async function createPrivateProfileHome(root, name, { recursive = false } = {}) {
  const candidate = join(await realpath(root), name)
  if (process.platform === 'win32' && candidate.length > 210) {
    const parent = await realpath(hostTemp)
    if (parent.length > 140) throw Object.assign(new Error('NATIVE_PROFILE_HOME_UNAVAILABLE'), { code: 'NATIVE_PROFILE_HOME_UNAVAILABLE' })
    return mkdtemp(join(parent, 'dshp-'))
  }
  await mkdir(candidate, { recursive, mode: 0o700 })
  return candidate
}

function compilerDirectory() {
  try {
    if (!compilerRoot) {
      if (inheritedCompilerRoot !== undefined) {
        if (!isAbsolute(inheritedCompilerRoot) || inheritedCompilerRoot.length > 140 || !/^dshc-[a-f0-9]{16}$/.test(basename(inheritedCompilerRoot))) throw compilerFailure()
        const info = lstatSync(inheritedCompilerRoot, { bigint: true })
        if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(inheritedCompilerRoot) !== inheritedCompilerRoot || readFileSync(join(inheritedCompilerRoot, '.dsh-root'), 'utf8') !== rootStamp(inheritedCompilerRoot)) throw compilerFailure()
        compilerRoot = { path: inheritedCompilerRoot, info }
      } else {
        const parent = realpathSync(hostTemp)
        const path = join(parent, `dshc-${randomBytes(8).toString('hex')}`)
        if (path.length > 140) throw compilerFailure()
        mkdirSync(path)
        writeFileSync(join(path, '.dsh-root'), rootStamp(path), { flag: 'wx' })
        compilerRoot = { path, info: lstatSync(path, { bigint: true }) }
      }
    }
    if (!sameDirectory(lstatSync(compilerRoot.path, { bigint: true }), compilerRoot.info) || realpathSync(compilerRoot.path) !== compilerRoot.path) throw compilerFailure()
    const path = mkdtempSync(join(compilerRoot.path, 'c-'))
    const info = lstatSync(path, { bigint: true }), owner = randomBytes(16).toString('hex')
    writeFileSync(join(path, '.dsh-owner'), owner, { flag: 'wx' })
    const root = compilerRoot
    // Never recursively remove a path obtained from the environment. Only this
    // allocated child, after confirmed helper exit, with unchanged filesystem
    // identity and no links/subdirectories, is eligible for flat cleanup.
    const cleanup = async () => {
      try {
        if (dirname(path) !== root.path || !/^c-[A-Za-z0-9]{6}$/.test(basename(path))) return false
        if (!sameDirectory(await lstat(root.path, { bigint: true }), root.info) || await realpath(root.path) !== root.path) return false
        if (!sameDirectory(await lstat(path, { bigint: true }), info) || await realpath(path) !== path || await readFile(join(path, '.dsh-owner'), 'utf8') !== owner) return false
        const names = await readdir(path)
        if (names.length > 128) return false
        for (const name of names) { const entry = await lstat(join(path, name)); if (!entry.isFile() || entry.isSymbolicLink()) return false }
        for (const name of names) await unlink(join(path, name))
        await rmdir(path)
        return true
      } catch { return false } // Busy, replaced or unknown resources remain.
    }
    return { root: root.path, path, cleanup }
  } catch { throw compilerFailure() }
}

/** Deliberately small environment: profiles, credentials and proxy secrets are never inherited. */
export function privateEnvironment(home, source = process.env) {
  const env = { HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'local'),
    CODEX_HOME: home, XDG_CACHE_HOME: join(home, 'cache'), XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'), TMPDIR: join(home, 'tmp'),
    NO_COLOR: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  for (const key of ['SystemRoot', 'windir', 'ComSpec', 'LANG', 'LC_ALL']) if (source[key]) env[key] = source[key]
  // Fixed executable paths remove PATH lookup from both supervisor and bridge.
  env.PATH = process.platform === 'win32' ? join(source.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin'
  if (process.platform === 'win32' && (compilerRoot?.path ?? inheritedCompilerRoot)) env[COMPILER_ROOT] = compilerRoot?.path ?? inheritedCompilerRoot
  return env
}

export async function resolveNativeHelper({ python = '/usr/bin/python3' } = {}) {
  if (process.platform === 'win32') {
    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    await access(executable)
    return Object.freeze({ executable: await realpath(executable), prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'native-peer.ps1')], platform: 'win32' })
  }
  if (process.platform !== 'linux' || !isAbsolute(python)) throw new Error('NATIVE_PEER_UNAVAILABLE')
  await access(python)
  return Object.freeze({ executable: await realpath(python), prefix: ['-u', join(HERE, 'native-peer.py')], platform: 'linux' })
}

/** Spawn a packaged native helper. It accepts one bounded JSON configuration on stdin. */
export function nativeProcess(helper, mode, spec, { home, env = privateEnvironment(home) } = {}) {
  if (helper.platform === 'win32' && home.length > 240) throw Object.assign(new Error('NATIVE_PROFILE_HOME_TOO_LONG'), { code: 'NATIVE_PROFILE_HOME_TOO_LONG' })
  const events = new EventEmitter()
  const args = helper.platform === 'win32' ? [...helper.prefix, '-Mode', mode] : [...helper.prefix, mode]
  const compiler = helper.platform === 'win32' ? compilerDirectory() : null
  const helperEnv = compiler ? Object.fromEntries(Object.entries(env).filter(([key]) => ![COMPILER_ROOT, COMPILER_SCRATCH].includes(key.toUpperCase()))) : env
  if (compiler) { helperEnv[COMPILER_ROOT] = compiler.root; helperEnv[COMPILER_SCRATCH] = compiler.path }
  // Windows PowerShell/CodeDom cannot compile from a deep current directory.
  // Use its already allocated short scratch; HOME and the CLI workspace stay private.
  const child = spawn(helper.executable, args, { cwd: compiler ? compiler.root : home, env: helperEnv, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  let tail = '', buffer = '', bytes = 0, closed = false, treeStopped = false
  const decoder = new StringDecoder('utf8'), cliDecoder = new StringDecoder('utf8')
  const cliOutput = new NativeCliOutput()
  const frame = value => {
    if (mode === 'supervise' && value.control === 'stopped' && value.treeStopped === true) treeStopped = true
    if (mode === 'supervise' && value.type === 'cli-output') {
      if (typeof value.data !== 'string' || value.data.length > MAX_FRAME * 2) throw new Error('INVALID_CLI_FRAME')
      for (const message of cliOutput.push(cliDecoder.write(Buffer.from(value.data, 'base64')))) events.emit('message', message)
    } else events.emit(value.control ? 'control' : 'message', value)
  }
  const exit = new Promise(resolve => child.once('close', async (code, signal) => {
    closed = true
    if (compiler && code === 0 && signal === null && (mode !== 'supervise' || treeStopped)) await compiler.cleanup()
    events.emit('closed', { code, signal }); resolve({ code, signal })
  }))
  child.on('error', error => events.emit('failure', error))
  child.stdin.on('error', () => {})
  child.stdout.on('error', error => events.emit('failure', error))
  child.stderr.on('error', error => events.emit('failure', error))
  child.stderr.on('data', data => { tail = (tail + data.toString('utf8')).slice(-4096) })
  child.stdout.on('data', chunk => {
    bytes += chunk.length
    buffer += decoder.write(chunk)
    // MCP responses and CLI image echoes have their own bounded readers. Their
    // retained connections can carry several screenshots without a raw lifetime cap.
    const boundedStream = mode === 'client' || mode === 'server' || mode === 'supervise'
    if (!boundedStream && bytes > 8 * 1024 * 1024 || Buffer.byteLength(buffer) > MAX_FRAME) { events.emit('failure', new Error('OUTPUT_LIMIT')); child.stdin.end(); return }
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      if (!line.trim()) continue
      try { frame(JSON.parse(line)) }
      catch { events.emit('failure', new Error('INVALID_NATIVE_FRAME')); child.stdin.end() }
    }
  })
  const send = value => new Promise((resolve, reject) => {
    const wire = JSON.stringify(value) + '\n'
    if (closed || Buffer.byteLength(wire) > MAX_FRAME) { reject(new Error(closed ? 'NATIVE_CLOSED' : 'INPUT_LIMIT')); return }
    child.stdin.write(wire, error => error ? reject(error) : resolve())
  })
  const nativeSpec = helper.platform === 'win32' && spec
    ? { ...spec, ...(mode === 'protect' && typeof spec.path === 'string' && spec.path.length >= 260 ? { path: toNamespacedPath(spec.path) } : {}),
      ...(mode === 'supervise' && typeof spec.cwd === 'string' && spec.cwd.length >= 260 ? { cwd: toNamespacedPath(spec.cwd) } : {}) } : spec
  if (nativeSpec) void send(nativeSpec).catch(error => events.emit('failure', error))
  function waitControl(name, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); events.off('control', control); events.off('closed', ended); events.off('failure', failed) }
      const control = value => { if (value.control === name) { clean(); resolve(value) } }
      const ended = () => { clean(); reject(new Error(`NATIVE_${name.toUpperCase()}_FAILED: ${tail.slice(-256)}`)) }
      const failed = error => { clean(); reject(error) }
      const timer = setTimeout(() => { clean(); reject(new Error(`NATIVE_${name.toUpperCase()}_TIMEOUT`)) }, timeoutMs)
      events.on('control', control); events.once('closed', ended); events.once('failure', failed)
      if (closed) ended()
    })
  }
  return Object.freeze({ child, events, exit, send, waitControl, end: () => child.stdin.end(), get stderr() { return tail }, get closed() { return closed } })
}

export async function capabilityProbe({ home, python } = {}) {
  let proc
  try {
    const helper = await resolveNativeHelper({ python })
    proc = nativeProcess(helper, 'probe', null, { home })
    const value = await new Promise((resolve, reject) => {
      proc.events.once('message', resolve)
      proc.events.once('failure', reject)
      proc.events.once('closed', () => reject(new Error('NATIVE_PROBE_FAILED')))
    })
    await proc.exit
    return { ...value, helper, limitations: helper.platform === 'linux' ? ['Process groups are not an OS sandbox; adversarial unobserved daemon escape requires a cgroup/container boundary'] : [] }
  } catch (error) { return { available: false, code: 'NATIVE_PEER_UNAVAILABLE', reason: error.message } }
  finally { if (proc && !proc.closed) proc.end() }
}

export async function protectProfile(helper, home) {
  if (helper.platform !== 'win32') return
  const proc = nativeProcess(helper, 'protect', { path: home }, { home })
  const protectedValue = await new Promise((resolve, reject) => {
    proc.events.once('message', resolve)
    proc.events.once('failure', reject)
    proc.events.once('closed', () => reject(new Error('PROFILE_ACL_FAILED')))
  })
  proc.end()
  const exit = await proc.exit
  if (!protectedValue.protected || exit.code !== 0) throw new Error('PROFILE_ACL_FAILED')
}
