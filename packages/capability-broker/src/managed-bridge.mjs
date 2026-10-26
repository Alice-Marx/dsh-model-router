import { fork } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { PolicyError } from './authority.mjs'

const BRIDGE = fileURLToPath(new URL('./stdio-bridge.mjs', import.meta.url))
const MAX_BYTES = 262_144

/** Prototype transport: private parent IPC, MCP stdio; no machine credential enters the child. */
export function openManagedBridge({ authority, subject, binding, tools, ttlMs = 30_000, handlers, home }) {
  if (!isAbsolute(home)) throw new TypeError('An isolated absolute home is required')
  const ownedBinding = Object.freeze({ ...binding })
  const registry = new Map(handlers.map(handler => [handler.definition.name, handler]))
  if (registry.size !== handlers.length || tools.some(name => !registry.has(name))) throw new TypeError('Unknown or duplicate bridge handler')
  const lease = authority.issue(subject, { binding: ownedBinding, tools, ttlMs })
  const env = { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }
  for (const key of ['PATH', 'Path', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) if (process.env[key]) env[key] = process.env[key]
  const child = fork(BRIDGE, [], { cwd: home, env, execArgv: [], windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
  let closed = false
  let forcedTermination = false
  let stderr = ''
  const active = new Map()
  const exit = new Promise(resolve => child.once('close', code => { closed = true; resolve(code) }))
  const release = () => {
    authority.release(lease.token)
    for (const controller of active.values()) controller.abort(new Error('BRIDGE_CLOSED'))
  }
  child.once('close', release)
  child.on('error', release)
  child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString('utf8') })
  const reply = (id, value) => {
    const bytes = Buffer.byteLength(JSON.stringify(value))
    if (child.connected) child.send(bytes > MAX_BYTES ? { type: 'response', id, ok: false, code: 'OUTPUT_LIMIT' } : { type: 'response', id, ...value })
  }
  child.on('message', async message => {
    if (!message || typeof message !== 'object' || !Number.isSafeInteger(message.id) || message.id < 1) return
    if (message.type === 'cancel') { active.get(message.id)?.abort(new Error('REQUEST_CANCELLED')); return }
    if (message.type !== 'request') return
    const id = message.id
    try {
      if (Buffer.byteLength(JSON.stringify(message)) > MAX_BYTES || Object.keys(message).some(key => !['type', 'id', 'op', 'name', 'args'].includes(key))) throw new PolicyError('INVALID_REQUEST')
      if (active.has(id) || active.size >= 16) throw new PolicyError('BUSY')
      if (message.op === 'list') {
        const visible = authority.list(lease.token, ownedBinding)
        reply(id, { ok: true, value: visible.map(name => registry.get(name).definition) })
        return
      }
      if (message.op !== 'call') throw new PolicyError('INVALID_REQUEST')
      const controller = new AbortController()
      active.set(id, controller)
      try {
        const value = await authority.run(lease.token, ownedBinding, message.name, ({ signal }) => {
          const handler = registry.get(message.name)
          const args = handler.parse(message.args)
          return handler.execute(args, { signal, binding: ownedBinding })
        }, { signal: controller.signal })
        reply(id, { ok: true, value })
      } finally { active.delete(id) }
    } catch (error) { reply(id, { ok: false, code: error instanceof PolicyError ? error.code : 'HANDLER_REFUSED' }) }
  })
  let closing
  const close = () => {
    if (closing) return closing
    release()
    if (child.connected) child.send({ type: 'shutdown' })
    child.stdin.end()
    closing = (async () => {
      const code = await Promise.race([exit, sleep(3000, 'timeout', { ref: false })])
      if (code === 'timeout') { forcedTermination = true; child.kill() }
      await exit
    })()
    return closing
  }
  const expiry = setTimeout(() => { void close() }, ttlMs)
  expiry.unref()
  child.once('close', () => clearTimeout(expiry))
  const decoder = new StringDecoder('utf8')
  let buffered = ''
  let negotiatedProtocol
  const transport = {
    async start() {
      child.stdout.on('data', chunk => {
        buffered += decoder.write(chunk)
        if (Buffer.byteLength(buffered) > MAX_BYTES) { this.onerror?.(new Error('OUTPUT_LIMIT')); void close(); return }
        let end
        while ((end = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, end); buffered = buffered.slice(end + 1)
          if (!line.trim()) continue
          try { this.onmessage?.(JSON.parse(line)) } catch { this.onerror?.(new Error('INVALID_MCP_OUTPUT')); void close() }
        }
      })
      child.once('close', () => this.onclose?.())
      child.once('error', error => this.onerror?.(error))
    },
    async send(message) {
      if (closed) throw new Error('BRIDGE_CLOSED')
      const wire = JSON.stringify(message)+'\n'
      if (Buffer.byteLength(wire) > MAX_BYTES) throw new Error('INPUT_LIMIT')
      await new Promise((resolveWrite, reject) => child.stdin.write(wire, error => error ? reject(error) : resolveWrite()))
    },
    setProtocolVersion(version) { negotiatedProtocol = version },
    close,
  }
  return Object.freeze({ transport, close, get closed() { return closed }, get forcedTermination() { return forcedTermination }, get protocolVersion() { return negotiatedProtocol }, get stderr() { return stderr } })
}
