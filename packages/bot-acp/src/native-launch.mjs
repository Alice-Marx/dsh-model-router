// Native process launch and entry proof for ACP agent CLIs.
//
// This module reuses the repository's own trusted launcher seam instead of
// inventing one: packages/cli-runtime/src/native-process.mjs provides the
// private HOME, the profile ACL and the Windows job-object supervisor whose
// `stopped` control is the only real tree-stop evidence. The entry-pinning
// discipline mirrors packages/bot-engines/src/claude-engine.mjs
// (pinClaudeEntry): an absolute, digest-pinned executable, an actual version
// probe, and no PATH or shell guessing. bot-engines is not edited and its
// Claude-shaped pin is not reused here, because an ACP CLI's version flag is
// Host state, not a constant.

import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, toNamespacedPath } from 'node:path'

import { classifyMessage, parseFrame, previewMessage } from './rpc-codec.mjs'
import { capabilityProbe, nativeProcess, privateEnvironment, protectProfile } from '../../cli-runtime/src/native-process.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
export const DEFAULT_LAUNCHER = Object.freeze({ probe: capabilityProbe, protect: protectProfile, supervise: nativeProcess })

/**
 * Prove a pinned native entry: absolute path, exact digest, and a real version
 * answer. `versionArgs` is Host state (most CLIs take `--version`); nothing here
 * resolves a command from PATH, from a model payload or from a shell.
 */
export async function pinAcpEntry({ executable, sha256, version, script, scriptSha256 } = {}, home, { versionArgs = ['--version'] } = {}) {
  if (!isAbsolute(executable ?? '') || !/^[a-f0-9]{64}$/.test(sha256 ?? '') || typeof version !== 'string' || !/^[0-9][A-Za-z0-9.+_-]{0,31}$/.test(version)) {
    throw new TypeError('PINNED_ACP_ENTRY_REQUIRED')
  }
  if (script !== undefined && (!isAbsolute(script) || !/^[a-f0-9]{64}$/.test(scriptSha256 ?? ''))) throw new TypeError('PINNED_ACP_SCRIPT_REQUIRED')
  if (!Array.isArray(versionArgs) || versionArgs.some(arg => typeof arg !== 'string')) throw new TypeError('ACP_VERSION_ARGS_INVALID')
  const path = await realpath(executable)
  if (!(await stat(path)).isFile() || (process.platform === 'win32' && !path.toLowerCase().endsWith('.exe'))) throw new Error('ACP_ENTRY_REQUIRED')
  if (digest(await readFile(path)) !== sha256) throw new Error('ACP_ENTRY_CHANGED')
  let scriptPath = null
  if (script !== undefined) {
    scriptPath = await realpath(script)
    if (!(await stat(scriptPath)).isFile() || digest(await readFile(scriptPath)) !== scriptSha256) throw new Error('ACP_ENTRY_SCRIPT_CHANGED')
  }
  const reported = await new Promise((resolve, reject) => {
    const child = spawn(path, scriptPath ? [scriptPath, ...versionArgs] : versionArgs, { cwd: process.platform === 'win32' && home.length >= 260 ? toNamespacedPath(home) : home, env: privateEnvironment(home), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('ACP_VERSION_TIMEOUT')) }, 15_000)
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 1024) child.kill() })
    child.stderr.on('data', chunk => { error = (error + chunk.toString('utf8')).slice(-1024) })
    child.once('error', failure => { clearTimeout(timer); reject(failure) })
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else reject(new Error(`ACP_VERSION_FAILED: ${error.slice(0, 128)}`)) })
  })
  if (!reported.includes(version)) throw new Error(`ACP_VERSION_MISMATCH: expected ${version} in ${JSON.stringify(reported.slice(0, 80))}`)
  return Object.freeze({ path, sha256, version, versionOutput: reported, versionArgs: [...versionArgs], script: scriptPath, scriptSha256: script !== undefined ? scriptSha256 : null })
}

/** Isolated private home for one agent process; credentials are never inherited. */
export const acpProcessHome = home => privateEnvironment(home)

/**
 * The native supervisor's stdio relay as a pipe for createStdioRpc. The
 * supervisor decodes the child's stdout into one parsed JSON object per line
 * and enforces its own frame cap; this adapter classifies each object and
 * counts anything non-conforming instead of guessing.
 */
export function createSupervisorPipe(supervisor, { maxFrameBytes = 262_144 } = {}) {
  if (!supervisor?.events) throw new TypeError('ACP_SUPERVISOR_REQUIRED')
  const events = new EventEmitter()
  let closed = false
  let writes = 0, writeErrors = 0, dropped = 0, malformed = 0, messages = 0
  const onMessage = value => {
    messages++
    const classified = value && typeof value === 'object' && !Array.isArray(value) ? classifyMessage(value) : { kind: 'invalid', reason: 'not-an-object' }
    if (classified.kind === 'invalid') { malformed++; events.emit('malformed', { reason: classified.reason, preview: previewMessage(value) }); return }
    events.emit('message', classified)
  }
  supervisor.events.on('message', onMessage)
  supervisor.events.on('failure', error => events.emit('failure', error))
  supervisor.events.once('closed', detail => {
    if (closed) return
    closed = true
    events.emit('closed', detail ?? { code: null, signal: null })
  })
  return Object.freeze({
    events,
    write: value => supervisor.send(value).then(() => undefined, error => { writeErrors++; throw error }),
    send: value => { writes++; void supervisor.send(value).catch(() => { writeErrors++; dropped++ }) },
    end: () => supervisor.end(),
    get closed() { return closed },
    get stats() { return Object.freeze({ writes, writeErrors, dropped, malformed, messages, maxFrameBytes }) },
  })
}

/**
 * Launch one ACP agent process through the trusted supervisor and wait for its
 * spawn evidence. `args` is Host-constructed argv; a turn payload can never add
 * to it. `probe` may be supplied when the caller already probed and protected
 * this home: the profile ACL is applied once per home, not once per launch.
 */
export async function launchAcpProcess({ entry, args, cwd, home, ttlMs, launcher = DEFAULT_LAUNCHER, python, probe = null, environment = {} }) {
  if (!entry?.path || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new TypeError('ACP_LAUNCH_SPEC_INVALID')
  if (typeof cwd !== 'string' || !cwd) throw new TypeError('ACP_LAUNCH_CWD_REQUIRED')
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000) throw new TypeError('ACP_LAUNCH_TTL_INVALID')
  if (digest(await readFile(entry.path)) !== entry.sha256) throw new Error('ACP_ENTRY_CHANGED')
  if (entry.script && digest(await readFile(entry.script)) !== entry.scriptSha256) throw new Error('ACP_ENTRY_SCRIPT_CHANGED')
  const capability = probe ?? await launcher.probe({ home, python })
  if (!capability?.available) throw new Error(`NATIVE_PEER_UNAVAILABLE: ${capability?.reason ?? 'unknown'}`)
  if (!probe) await launcher.protect(capability.helper, home)
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)
    || Object.entries(environment).some(([key, value]) => !/^[A-Z_][A-Z0-9_]*$/.test(key)
      || /^(?:PATH|HOME|USERPROFILE|TEMP|TMP|NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|LD_PRELOAD|DYLD_INSERT_LIBRARIES|COMSPEC|SYSTEMROOT)$/i.test(key)
      || typeof value !== 'string' || value.includes('\0') || value.length > 128_000)) throw new TypeError('ACP_CREDENTIAL_ENVIRONMENT_INVALID')
  const supervisor = launcher.supervise(capability.helper, 'supervise', {
    executable: entry.path,
    args: entry.script ? [entry.script, ...args] : args,
    cwd,
    ttlMs,
  }, { home, env: { ...privateEnvironment(home), ...environment } })
  const spawned = await supervisor.waitControl('spawned').catch(error => {
    supervisor.end()
    throw error
  })
  return Object.freeze({ supervisor, probe, rootProcess: spawned })
}
