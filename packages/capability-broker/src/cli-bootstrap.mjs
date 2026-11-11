import { generateKeyPairSync, sign, randomBytes } from 'node:crypto'
import { mkdir, writeFile, mkdtemp, chmod, lstat, realpath, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { PolicyError } from './authority.mjs'
import { bridgeResponseFrames, normalizeBridgeMcpResult } from './cli-bridge-response.mjs'
import { nativeProcess, resolveNativeHelper } from '../../cli-runtime/src/native-process.mjs'

const BRIDGE = fileURLToPath(new URL('./cli-stdio-bridge.mjs', import.meta.url))
const MAX_BYTES = 262_144
const REQUEST_KEYS = ['type', 'id', 'op', 'name', 'args']

/**
 * A trusted handler may run under an authority name that differs from the MCP
 * tool name the native client sees. The wire name never reaches the lease, and
 * a handler without one is exactly its definition name.
 */
const capabilityOf = handler => {
  const value = handler.capability ?? handler.definition.name
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 256) throw new TypeError('INVALID_HANDLER_CAPABILITY')
  return value
}

/** CLI-grandchild handoff: public signed locator, OS peer identity, host-only capability lease. */
export async function createCliBootstrap({ authority, subject, binding, tools, handlers, home, ttlMs = 30_000, helper, contextFor = null }) {
  if (!isAbsolute(home)) throw new TypeError('An isolated absolute home is required')
  // Host-owned per-turn context. The Host, never the native client, decides
  // whether this receiver is inside a live turn.
  if (contextFor !== null && typeof contextFor !== 'function') throw new TypeError('INVALID_HOST_CONTEXT_CALLBACK')
  const ownedBinding = Object.freeze({ ...binding })
  const registry = new Map(handlers.map(handler => [handler.definition.name, handler]))
  if (registry.size !== handlers.length || tools.some(name => !registry.has(name))) throw new TypeError('Unknown or duplicate bridge handler')
  // Selected wire names, each paired with the authority name it runs under.
  // Unselected handlers stay inert: no capability, no definition, no execution.
  const selected = new Map(tools.map(name => [name, { handler: registry.get(name), capability: capabilityOf(registry.get(name)) }]))
  const leaseTools = [...new Set([...selected.values()].map(entry => entry.capability))]
  const byCapability = new Map()
  for (const entry of selected.values()) {
    const sharing = byCapability.get(entry.capability)
    if (sharing) sharing.push(entry.handler)
    else byCapability.set(entry.capability, [entry.handler])
  }
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
  try{lease=authority.issue(subject,{binding:ownedBinding,tools:leaseTools,ttlMs:leaseTtlMs})}
  catch(error){if(socketDirectory)await rmdir(socketDirectory);throw error}
  let relay, closed = false, bound = false, connected = false, closing
  let accepted, rejected = 0, requests = 0, replies = 0, highestRequestId = 0
  const active = new Map()
  const release = () => { authority.release(lease.token); for (const controller of active.values()) controller.abort(new Error('BRIDGE_CLOSED')) }
  const reply = async (id, value, signal) => {
    if (!relay || relay.closed) return
    replies++
    for (const frame of bridgeResponseFrames(id, value)) {
      signal?.throwIfAborted()
      await relay.send(frame)
    }
  }
  /**
   * Host turn context, read synchronously after the structural and replay
   * guards. The Host owns the returned object; nothing in it can widen the
   * binding, the lease or the final signal the handler observes.
   */
  const hostContext = (op, name, id) => {
    if (!contextFor) return null
    let value
    try { value = contextFor({ op, name, id }) }
    catch (error) { throw error instanceof PolicyError ? error : new PolicyError('CONTEXT_UNAVAILABLE', { gate: 'host-context' }) }
    if (!value || typeof value !== 'object' || typeof value.then === 'function') throw new PolicyError('CONTEXT_UNAVAILABLE', { gate: 'host-context' })
    return value
  }
  /** The receiver's own cancel signal combined with the Host turn signal. */
  const requestSignal = (controller, context) => {
    const signal = context?.signal ?? null
    if (signal !== null && !(signal instanceof AbortSignal)) throw new PolicyError('CONTEXT_UNAVAILABLE', { gate: 'host-signal' })
    return signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  }
  async function request(message) {
    requests++
    if (!message || !Number.isSafeInteger(message.id) || message.id < 1) return
    if (message.type === 'cancel') { active.get(message.id)?.abort(new Error('REQUEST_CANCELLED')); return }
    if (message.type !== 'request') return
    const id = message.id
    // One bounded receiver-side counter instead of a set of seen ids: a bridge
    // client numbers its requests strictly upward, so anything at or below the
    // highest one already ran or is running and is never run again. The check
    // sits before every await, so same-tick and out-of-order replays are
    // refused before a handler starts. A cancel may still name an active id.
    if (id <= highestRequestId) { void reply(id, { ok: false, code: 'DUPLICATE_REQUEST' }).catch(() => {}); return }
    highestRequestId = id
    try {
      if (closed) throw new PolicyError('BRIDGE_CLOSED')
      if (Buffer.byteLength(JSON.stringify(message)) > MAX_BYTES || Object.keys(message).some(key => !REQUEST_KEYS.includes(key))) throw new PolicyError('INVALID_REQUEST')
      // The replay guard already refuses an id that is at or below the highest
      // one, so an active id can never re-enter here.
      if (active.size >= 16) throw new PolicyError('BUSY')
      if (message.op === 'list') {
        const context = hostContext('list', null, id)
        requestSignal(new AbortController(), context).throwIfAborted()
        await reply(id, { ok: true, value: authority.list(lease.token, ownedBinding).flatMap(capability => byCapability.get(capability) ?? []).map(handler => handler.definition) })
        return
      }
      if (message.op !== 'call') throw new PolicyError('INVALID_REQUEST')
      const entry = selected.get(message.name)
      if (!entry) throw new PolicyError('TOOL_DENIED')
      const context = hostContext('call', message.name, id)
      const controller = new AbortController()
      const signal = requestSignal(controller, context)
      active.set(id, controller)
      try {
        signal.throwIfAborted()
        const value = await authority.run(lease.token, ownedBinding, entry.capability, ({ signal: authoritySignal }) => {
          authoritySignal.throwIfAborted()
          return entry.handler.execute(entry.handler.parse(message.args), { signal: authoritySignal, binding: ownedBinding, context })
        }, { signal })
        signal.throwIfAborted()
        const mcpResult = entry.handler.render ? normalizeBridgeMcpResult(await entry.handler.render(value)) : null
        signal.throwIfAborted()
        await reply(id, { ok: true, ...(mcpResult ? { mcpResult } : { value }) }, signal)
      } finally { active.delete(id) }
    } catch (error) { await reply(id, { ok: false, code: error instanceof PolicyError ? error.code : 'HANDLER_REFUSED' }).catch(() => {}) }
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
