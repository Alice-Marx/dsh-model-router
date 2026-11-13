// Google's official ACP runtime is a pair: the ACP server and local harness.
// Account/config isolation follows OpenMausBot antigravity-acp.ts at the recorded
// Apache-2.0 upstream pin; credentials remain exclusively with the Host store.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { DEFAULT_LAUNCHER, launchAcpProcess } from '../../bot-acp/src/native-launch.mjs'

// Fixed release from the official ACP registry, verified on 2026-11-13:
// https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json
export const ANTIGRAVITY_RELEASE_VERSION = '1.5.0'
export const ANTIGRAVITY_RELEASES = Object.freeze({
  'win32-x64': Object.freeze({ url: 'https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.5.0-windows-x86_64.zip', sha256: '6163f6b59b381bae419652dbae167bc8cda0ef29d665c0ba8af3d8c7fddd8867' }),
  'win32-arm64': Object.freeze({ url: 'https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.5.0-windows-arm64.zip', sha256: '340092b8af6dafc71eb15f4a8ec54b4d1f0bce16d1fa4d163b562c50b905f8f4' }),
  'darwin-arm64': Object.freeze({ url: 'https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.5.0-darwin-arm64.zip', sha256: 'c82ecb4ef476bfc35cbe5b2745cdddef873b99c9f5bd7fd11e5ca1fc1667a3fc' }),
  'darwin-x64': Object.freeze({ url: 'https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.5.0-darwin-x86_64.zip', sha256: '86a94e33b25d4a38ff30526ad844546860aa9ed98698498d9e87d30eb794426e' }),
  'linux-x64': Object.freeze({ url: 'https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.5.0-linux-x86_64.zip', sha256: '36f373e8948edf1727b39c7d62b5722d6a4474bdfd72b04ad3d6def571808c9f' }),
  'linux-arm64': Object.freeze({ url: 'https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.5.0-linux-arm64.zip', sha256: '1e184f439477b54138e94440056b26a78c0a8075a8fd2ffda637ec31267c6459' }),
})
const failure = code => Object.assign(new Error(code), { code })
const digest = async path => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const version = value => typeof value === 'string' && /^[0-9][A-Za-z0-9.+_-]{0,31}$/.test(value)
const verifiedVersions = new Set()

/** Validate both immutable, owner-selected files before every native session. */
export async function verifyAntigravityEntry(entry) {
  if (!entry || !isAbsolute(entry.executable ?? '') || !isAbsolute(entry.harness ?? '')
    || !sha256(entry.sha256) || !sha256(entry.harnessSha256) || !version(entry.version)
    || entry.script !== undefined || entry.scriptSha256 !== undefined) throw failure('ANTIGRAVITY_ENTRY_INVALID')
  const executable = await realpath(entry.executable), harness = await realpath(entry.harness)
  if (!/^agy_acp_server\.(?:exe|par)$/.test(basename(executable))
    || !/^localharness_external(?:\.exe)?$/.test(basename(harness))) throw failure('ANTIGRAVITY_ENTRY_INVALID')
  for (const path of [executable, harness]) {
    const info = await stat(path)
    if (!info.isFile() || info.size < 1 || info.size > 1_500_000_000) throw failure('ANTIGRAVITY_ENTRY_INVALID')
  }
  if (await digest(executable) !== entry.sha256 || await digest(harness) !== entry.harnessSha256) throw failure('ANTIGRAVITY_ENTRY_CHANGED')
  return Object.freeze({ ...entry, executable, harness })
}

/** No ambient discovery: the owner must choose the server and its harness. */
export async function inspectAntigravityEntry(input, { signal, root } = {}) {
  if (!input || !isAbsolute(input.executable ?? '') || !isAbsolute(input.harness ?? '') || !version(input.version)
    || input.script !== undefined || !isAbsolute(root ?? '')) throw failure('ANTIGRAVITY_ENTRY_INVALID')
  signal?.throwIfAborted()
  const executable = await realpath(input.executable), harness = await realpath(input.harness)
  const entry = await verifyAntigravityEntry({ executable, harness, version: input.version,
    sha256: await digest(executable), harnessSha256: await digest(harness) })
  await mkdir(root, { recursive: true, mode: 0o700 })
  const { mkdtemp } = await import('node:fs/promises')
  const home = await mkdtemp(join(root, 'agy-entry-'))
  await probeAntigravityVersion(entry, home, { signal })
  return entry
}

/** Called after the private home ACL and selected Host credential are installed. */
export async function provisionAntigravityRuntime(home, profile, { requireCredential = true } = {}) {
  if (!isAbsolute(home ?? '')) throw failure('ANTIGRAVITY_PROFILE_INVALID')
  const entry = await verifyAntigravityEntry(profile.entry)
  const directory = join(home, '.gemini'), acp = join(directory, 'antigravity-acp')
  await mkdir(acp, { recursive: true, mode: 0o700 })
  if (requireCredential) {
    const token = await stat(join(acp, 'acp_token.json')).catch(() => null)
    if (!token?.isFile() || token.size < 1 || token.size > 128_000) throw failure('ANTIGRAVITY_ACCOUNT_REQUIRED')
  }
  await writeFile(join(acp, 'settings.json'), JSON.stringify({ auth: { type: 'oauth-personal' } }), { mode: 0o600 })
  const env = { GEMINI_HOME: directory, AGY_ACP_FORCE_FILE_STORAGE: '1', ANTIGRAVITY_HARNESS_PATH: entry.harness,
    PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1',
    // Authentication failure must not open a browser from a model turn.
    BROWSER: `"${process.execPath.replaceAll('\\', '/')}" -e "process.exit(1)" -- %s` }
  if (typeof profile.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(profile.model)) env.AGY_ACP_DEFAULT_MODEL = profile.model
  return { env }
}

export function isAntigravityInitializeResult(value, expectedVersion) {
  return value?.protocolVersion === 1 && ['antigravity-acp', 'Google Antigravity'].includes(value.agentInfo?.name)
    && typeof value.agentInfo?.version === 'string' && value.agentInfo.version.replace(/^agy_acp_server_/, '').trim() === expectedVersion
    && Array.isArray(value.authMethods) && value.authMethods.some(method => method?.id === 'oauth-personal')
}

/** Version proof uses ACP initialize only: no authenticate/session/prompt/model call. */
export async function probeAntigravityVersion(entry, home, { signal, launcher = DEFAULT_LAUNCHER, timeoutMs = 300_000 } = {}) {
  signal?.throwIfAborted()
  const checked = await verifyAntigravityEntry(entry)
  const identity = `${checked.executable}:${checked.sha256}:${checked.harness}:${checked.harnessSha256}:${checked.version}`
  // Digest proof is repeated, but a successful initialize need not cold-unpack
  // the same Google release twice during one Host lifetime.
  if (launcher === DEFAULT_LAUNCHER && verifiedVersions.has(identity)) return `antigravity-acp ${checked.version}`
  for (const folder of ['tmp', 'cache', 'config', 'data', 'appdata', 'local']) await mkdir(join(home, folder), { recursive: true, mode: 0o700 })
  const { env } = await provisionAntigravityRuntime(home, { entry: checked }, { requireCredential: false })
  const probe = await launcher.probe({ home })
  if (!probe?.available) throw failure('NATIVE_PEER_UNAVAILABLE')
  await launcher.protect(probe.helper, home)
  const launched = await launchAcpProcess({ entry: { path: checked.executable, sha256: checked.sha256 },
    args: process.platform === 'linux' ? ['--uid='] : [], cwd: home, home, ttlMs: timeoutMs + 10_000, launcher, probe, environment: env })
  const supervisor = launched.supervisor
  let stopEvidence = null
  const observeStop = value => { if (value?.control === 'stopped') stopEvidence = value }
  supervisor.events.on('control', observeStop)
  let proved = false
  try {
    const result = await new Promise((resolve, reject) => {
      let timer
      const cleanup = () => { clearTimeout(timer); supervisor.events.off('message', onMessage); supervisor.events.off('failure', onFailure); supervisor.events.off('closed', onClose); signal?.removeEventListener('abort', onAbort) }
      const finish = (error, value) => { cleanup(); error ? reject(error) : resolve(value) }
      const onFailure = () => finish(failure('ANTIGRAVITY_VERSION_FAILED'))
      const onClose = () => finish(failure('ANTIGRAVITY_VERSION_FAILED'))
      const onAbort = () => finish(failure('ANTIGRAVITY_VERSION_ABORTED'))
      const onMessage = frame => { if (frame?.id === 'agy-version') frame.error ? finish(failure('ANTIGRAVITY_VERSION_FAILED')) : finish(null, frame.result) }
      supervisor.events.on('message', onMessage); supervisor.events.once('failure', onFailure); supervisor.events.once('closed', onClose)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) { onAbort(); return }
      timer = setTimeout(() => finish(failure('ANTIGRAVITY_VERSION_TIMEOUT')), timeoutMs)
      void supervisor.send({ jsonrpc: '2.0', id: 'agy-version', method: 'initialize', params: { protocolVersion: 1,
        clientInfo: { name: 'dsh-model-router-entry-check', version: '1' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } } }).catch(onFailure)
    })
    if (!isAntigravityInitializeResult(result, checked.version)) throw failure('ANTIGRAVITY_VERSION_MISMATCH')
    proved = true
    return `antigravity-acp ${checked.version}`
  } finally {
    // The native supervisor owns the child tree; EOF requests orderly shutdown.
    // Wait for its observed stop before allowing an entry check to succeed.
    supervisor.end()
    const stopped = stopEvidence ?? await supervisor.waitControl('stopped').catch(() => null)
    supervisor.events.off('control', observeStop)
    if (stopped?.treeStopped !== true && stopped?.notStarted !== true) throw failure('ANTIGRAVITY_VERSION_STOP_UNCONFIRMED')
    if (proved && launcher === DEFAULT_LAUNCHER) verifiedVersions.add(identity)
  }
}
