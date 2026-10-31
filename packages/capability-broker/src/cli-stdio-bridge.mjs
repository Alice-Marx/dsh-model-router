import { createPublicKey, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { Server } from '@modelcontextprotocol/server'
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { nativeProcess, privateEnvironment } from '../../cli-runtime/src/native-process.mjs'
import { dirname, isAbsolute } from 'node:path'

let relay, handle
const pending = new Map()
let sequence = 0
const finish = () => {
  for (const value of pending.values()) value.reject(new Error('BROKER_CLOSED'))
  pending.clear()
  relay?.end()
}
try {
  const [path, publicSpki] = process.argv.slice(2)
  if (process.argv.length !== 4 || !isAbsolute(path) || !/^[A-Za-z0-9_-]{40,256}$/.test(publicSpki)) throw new Error('PRIVATE_BOOTSTRAP_REQUIRED')
  let descriptor
  const deadline = Date.now() + 15_000
  while (!descriptor && Date.now() < deadline) {
    try { const wire = await readFile(path); if (wire.length > 32_768) throw new Error('DESCRIPTOR_LIMIT'); descriptor = JSON.parse(wire) }
    catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50) }
  }
  if (!descriptor || typeof descriptor.payload !== 'string' || typeof descriptor.signature !== 'string') throw new Error('INVALID_BOOTSTRAP')
  const key = createPublicKey({ key: Buffer.from(publicSpki, 'base64url'), format: 'der', type: 'spki' })
  if (!verify(null, Buffer.from(descriptor.payload), key, Buffer.from(descriptor.signature, 'base64url'))) throw new Error('BOOTSTRAP_SIGNATURE')
  const spec = JSON.parse(descriptor.payload)
  const handoffRemaining = Math.floor(spec.expiresAt - Date.now())
  const remaining = Math.floor(spec.sessionExpiresAt - Date.now())
  if (spec.version !== 1 || handoffRemaining < 1 || handoffRemaining > 15_000 || remaining < 1 || remaining > 7_200_000) throw new Error('BOOTSTRAP_EXPIRED')
  relay = nativeProcess(spec.helper, 'client', { endpoint: spec.endpoint, serverPid: spec.serverPid, serverStart: spec.serverStart, ttlMs: remaining },
    { home: dirname(path), env: privateEnvironment(dirname(path)) })
  const ask = (op, payload, signal) => new Promise((resolve, reject) => {
    if (relay.closed || pending.size >= 16) { reject(new Error('BROKER_UNAVAILABLE')); return }
    const id = ++sequence
    const abort = () => { const value = pending.get(id); pending.delete(id); void relay.send({ type: 'cancel', id }).catch(() => {}); value?.reject(new Error('REQUEST_CANCELLED')) }
    if (signal?.aborted) { reject(new Error('REQUEST_CANCELLED')); return }
    const timer = setTimeout(abort, Math.min(remaining, 30_000))
    signal?.addEventListener('abort', abort, { once: true })
    const settle = fn => value => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value) }
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) })
    void relay.send({ type: 'request', id, op, ...payload }).catch(() => { const value = pending.get(id); pending.delete(id); value?.reject(new Error('BROKER_CLOSED')) })
  })
  relay.events.on('message', message => {
    if (message?.type !== 'response' || !Number.isSafeInteger(message.id)) return
    const value = pending.get(message.id); pending.delete(message.id)
    if (message.ok) value?.resolve(message.value)
    else value?.reject(new Error(message.code ?? 'BROKER_REFUSED'))
  })
  relay.events.on('failure', () => { finish(); void handle?.close() })
  relay.events.once('closed', () => { finish(); void handle?.close() })
  handle = serveStdio(() => {
    const server = new Server({ name: 'dsh-task-capability-bridge', version: '0.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler('tools/list', async (_request, ctx) => ({ tools: await ask('list', {}, ctx.mcpReq.signal) }))
    server.setRequestHandler('tools/call', async (request, ctx) => {
      try { return { content: [{ type: 'text', text: JSON.stringify(await ask('call', { name: request.params.name, args: request.params.arguments ?? {} }, ctx.mcpReq.signal)) }] } }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] } }
    })
    server.onclose = finish
    return server
  }, { transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 262_144 }) })
  const timer = setTimeout(() => { finish(); void handle.close() }, remaining); timer.unref()
  process.stdin.once('end', () => { clearTimeout(timer); finish(); void handle.close() })
} catch (error) {
  process.stderr.write(`Private broker bootstrap refused: ${error.message}\n`)
  finish(); process.exitCode = 2
}
