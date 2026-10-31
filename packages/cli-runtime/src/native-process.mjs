import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import { access, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const MAX_FRAME = 262_144

/** Deliberately small environment: profiles, credentials and proxy secrets are never inherited. */
export function privateEnvironment(home, source = process.env) {
  const env = { HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'local'),
    CODEX_HOME: home, XDG_CACHE_HOME: join(home, 'cache'), XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'), TMPDIR: join(home, 'tmp'),
    NO_COLOR: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  for (const key of ['SystemRoot', 'windir', 'ComSpec', 'LANG', 'LC_ALL']) if (source[key]) env[key] = source[key]
  // Fixed executable paths remove PATH lookup from both supervisor and bridge.
  env.PATH = process.platform === 'win32' ? join(source.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin'
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
  const events = new EventEmitter()
  const args = helper.platform === 'win32' ? [...helper.prefix, '-Mode', mode] : [...helper.prefix, mode]
  const child = spawn(helper.executable, args, { cwd: home, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  let tail = '', buffer = '', bytes = 0, closed = false
  const decoder = new StringDecoder('utf8'), cliDecoder = new StringDecoder('utf8')
  let cliBuffer = ''
  const frame = value => {
    if (mode === 'supervise' && value.type === 'cli-output') {
      if (typeof value.data !== 'string' || value.data.length > MAX_FRAME * 2) throw new Error('INVALID_CLI_FRAME')
      cliBuffer += cliDecoder.write(Buffer.from(value.data, 'base64'))
      if (Buffer.byteLength(cliBuffer) > MAX_FRAME) throw new Error('CLI_FRAME_LIMIT')
      let end
      while ((end = cliBuffer.indexOf('\n')) >= 0) {
        const line = cliBuffer.slice(0, end); cliBuffer = cliBuffer.slice(end + 1)
        if (line.trim()) events.emit('message', JSON.parse(line))
      }
    } else events.emit(value.control ? 'control' : 'message', value)
  }
  const exit = new Promise(resolve => child.once('close', (code, signal) => { closed = true; events.emit('closed', { code, signal }); resolve({ code, signal }) }))
  child.on('error', error => events.emit('failure', error))
  child.stdin.on('error', () => {})
  child.stderr.on('data', data => { tail = (tail + data.toString('utf8')).slice(-4096) })
  child.stdout.on('data', chunk => {
    bytes += chunk.length
    buffer += decoder.write(chunk)
    if (bytes > 8 * 1024 * 1024 || Buffer.byteLength(buffer) > MAX_FRAME) { events.emit('failure', new Error('OUTPUT_LIMIT')); child.stdin.end(); return }
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
  if (spec) void send(spec).catch(error => events.emit('failure', error))
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
