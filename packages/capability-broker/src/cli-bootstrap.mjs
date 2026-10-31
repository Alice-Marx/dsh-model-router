import { generateKeyPairSync, sign, randomBytes } from 'node:crypto'
import { mkdir, writeFile, mkdtemp, chmod, lstat, realpath, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { PolicyError } from './authority.mjs'
import { nativeProcess, resolveNativeHelper } from '../../cli-runtime/src/native-process.mjs'

const BRIDGE = fileURLToPath(new URL('./cli-stdio-bridge.mjs', import.meta.url))
const MAX_BYTES = 262_144

/** CLI-grandchild handoff: public signed locator, OS peer identity, host-only capability lease. */
export async function createCliBootstrap({ authority, subject, binding, tools, handlers, home, ttlMs = 30_000, helper }) {
  if (!isAbsolute(home)) throw new TypeError('An isolated absolute home is required')
  const ownedBinding = Object.freeze({ ...binding })
  const registry = new Map(handlers.map(handler => [handler.definition.name, handler]))
  if (registry.size !== handlers.length || tools.some(name => !registry.has(name))) throw new TypeError('Unknown or duplicate bridge handler')
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 7_200_000 || typeof authority.renew !== 'function') throw new TypeError('BOUNDED_RENEWABLE_LEASE_REQUIRED')
  const leaseTtlMs = Math.min(30_000, ttlMs)
  const startedAt = performance.now()
  const native = helper ?? await resolveNativeHelper()
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicSpki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
  await mkdir(home, { recursive: true, mode: 0o700 })
  await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 })
  const descriptorPath = join(home, `bridge-${randomBytes(12).toString('hex')}.json`)
  // Locator has no authority. Its random name only prevents accidental collisions.
  let socketDirectory
  let endpoint = process.platform === 'win32' ? `dsh-cli-${randomBytes(18).toString('hex')}` : join(home, `p-${randomBytes(6).toString('hex')}.sock`)
  if (process.platform === 'linux' && Buffer.byteLength(endpoint) > 103) {
    // AF_UNIX limits the address length even when the private profile path is valid.
    // Keep the signed descriptor/keys in the profile; only the socket uses an
    // atomic, owner-only short directory. Peer PID/start-time/UID checks remain mandatory.
    let parent=await realpath(tmpdir())
    if(Buffer.byteLength(join(parent,'dsh-cli-XXXXXX','p.sock'))>103)parent=await realpath('/tmp')
    socketDirectory=await mkdtemp(join(parent,'dsh-cli-'))
    await chmod(socketDirectory,0o700)
    const stat=await lstat(socketDirectory)
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0){await rmdir(socketDirectory);throw new Error('PRIVATE_SOCKET_DIRECTORY_REQUIRED')}
    endpoint=join(socketDirectory,'p.sock')
    if(Buffer.byteLength(endpoint)>103){await rmdir(socketDirectory);throw new Error('PRIVATE_SOCKET_PATH_TOO_LONG')}
  }
  let lease
  try{lease=authority.issue(subject,{binding:ownedBinding,tools,ttlMs:leaseTtlMs})}
  catch(error){if(socketDirectory)await rmdir(socketDirectory);throw error}
  let relay, closed = false, bound = false, connected = false, closing
  let accepted, rejected = 0, requests = 0, replies = 0
  const active = new Map()
  const release = () => { authority.release(lease.token); for (const controller of active.values()) controller.abort(new Error('BRIDGE_CLOSED')) }
  const reply = (id, value) => {
    if (!relay || relay.closed) return
    replies++
    const wire = { type: 'response', id, ...value }
    void relay.send(Buffer.byteLength(JSON.stringify(wire)) > MAX_BYTES ? { type: 'response', id, ok: false, code: 'OUTPUT_LIMIT' } : wire).catch(() => {})
  }
  async function request(message) {
    requests++
    if (!message || !Number.isSafeInteger(message.id) || message.id < 1) return
    if (message.type === 'cancel') { active.get(message.id)?.abort(new Error('REQUEST_CANCELLED')); return }
    if (message.type !== 'request') return
    const id = message.id
    try {
      if (closed) throw new PolicyError('BRIDGE_CLOSED')
      if (Buffer.byteLength(JSON.stringify(message)) > MAX_BYTES || Object.keys(message).some(key => !['type', 'id', 'op', 'name', 'args'].includes(key))) throw new PolicyError('INVALID_REQUEST')
      if (active.has(id) || active.size >= 16) throw new PolicyError('BUSY')
      if (message.op === 'list') { reply(id, { ok: true, value: authority.list(lease.token, ownedBinding).map(name => registry.get(name).definition) }); return }
      if (message.op !== 'call') throw new PolicyError('INVALID_REQUEST')
      const controller = new AbortController(); active.set(id, controller)
      try {
        const value = await authority.run(lease.token, ownedBinding, message.name, ({ signal }) => {
          const handler = registry.get(message.name)
          return handler.execute(handler.parse(message.args), { signal, binding: ownedBinding })
        }, { signal: controller.signal })
        reply(id, { ok: true, value })
      } finally { active.delete(id) }
    } catch (error) { reply(id, { ok: false, code: error instanceof PolicyError ? error.code : 'HANDLER_REFUSED' }) }
  }
  const close = () => {
    if (closing) return closing
    closed = true; release(); clearTimeout(expiry); clearInterval(renewal)
    closing = (async () => {
      if(relay){
        relay.end()
        const stopped = await Promise.race([relay.exit.then(() => true), new Promise(resolve => { const t = setTimeout(() => resolve(false), 3000); t.unref() })])
        if (!stopped) { relay.child.kill(); await relay.exit }
      }
      // Nonrecursive cleanup only; an unexpected file is preserved for diagnosis.
      if(socketDirectory)await rmdir(socketDirectory).catch(()=>{})
    })()
    return closing
  }
  const expiry = setTimeout(() => { void close() }, ttlMs); expiry.unref()
  const renewal = setInterval(() => {
    try { if (!closed) authority.renew(lease.token, ownedBinding, { ttlMs: Math.min(leaseTtlMs, Math.max(1, Math.floor(ttlMs - (performance.now() - startedAt)))) }) }
    catch { void close() }
  }, Math.max(100, Math.floor(leaseTtlMs / 3))); renewal.unref()
  const bind = async ({ pid, start }) => {
    if (closed || bound || !Number.isSafeInteger(pid) || pid < 1 || typeof start !== 'string') throw new Error('INVALID_CLI_BINDING')
    authority.list(lease.token, ownedBinding)
    bound = true
    const remaining = Math.floor(ttlMs - (performance.now() - startedAt))
    if (remaining < 1) { await close(); throw new Error('BOOTSTRAP_EXPIRED') }
    relay = nativeProcess(native, 'server', { endpoint, rootPid: pid, rootStart: start, ttlMs: remaining }, { home })
    relay.events.on('message', message => { void request(message) })
    relay.events.on('control', value => {
      if (value.control === 'accepted') { accepted = value; connected = true }
      if (value.control === 'rejected') rejected++
    })
    relay.events.once('closed', () => { closed = true; release(); clearTimeout(expiry); clearInterval(renewal) })
    relay.events.once('failure', () => { void close() })
    const server = await relay.waitControl('listening')
    const payload = JSON.stringify({ version: 1, endpoint, serverPid: server.pid, serverStart: server.start,
      rootPid: pid, rootStart: start, expiresAt: Date.now() + Math.min(15_000, remaining), sessionExpiresAt: Date.now() + remaining, ttlMs: remaining,
      helper: native, hostPid: process.pid, binding: ownedBinding })
    const descriptor = JSON.stringify({ payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') })
    await writeFile(descriptorPath, descriptor, { flag: 'wx', mode: 0o600 })
  }
  return Object.freeze({ command: process.execPath, args: [BRIDGE, descriptorPath, publicSpki], descriptorPath,
    bind, close, get closed() { return closed }, get connected() { return connected },
    get evidence() { return { binding: ownedBinding, connected, peer: accepted ?? null, rejectedPeers: rejected, requests, replies, nativeError: relay?.stderr ?? '', bearerInArgvOrEnv: false, closed } } })
}
