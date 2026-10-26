import { Server } from '@modelcontextprotocol/server'
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio'

// The capability stays in the parent. A standalone CLI launch must not acquire one.
if (!process.send || !process.connected) {
  process.stderr.write('A private broker channel is required.\n')
  process.exitCode = 2
} else {
  const pending = new Map()
  let sequence = 0
  let handle
  const finish = () => {
    for (const entry of pending.values()) entry.reject(new Error('BROKER_CLOSED'))
    pending.clear()
    if (process.connected) process.disconnect()
  }
  const ask = (op, payload, signal) => new Promise((resolve, reject) => {
    if (!process.connected || pending.size >= 16) { reject(new Error('BROKER_UNAVAILABLE')); return }
    const id = ++sequence
    const abort = () => {
      const entry = pending.get(id)
      pending.delete(id)
      if (process.connected) process.send({ type: 'cancel', id })
      entry?.reject(new Error('REQUEST_CANCELLED'))
    }
    if (signal?.aborted) { reject(new Error('REQUEST_CANCELLED')); return }
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 30_000)
    const settle = fn => value => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value) }
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) })
    process.send({ type: 'request', id, op, ...payload }, error => {
      if (error) { const entry = pending.get(id); pending.delete(id); entry?.reject(new Error('BROKER_CLOSED')) }
    })
  })
  process.on('message', message => {
    if (message?.type === 'shutdown') { void handle.close().finally(finish); return }
    if (message?.type !== 'response' || !Number.isSafeInteger(message.id)) return
    const entry = pending.get(message.id)
    pending.delete(message.id)
    if (!entry) return
    if (message.ok) entry.resolve(message.value)
    else entry.reject(new Error(message.code ?? 'BROKER_REFUSED'))
  })
  process.on('disconnect', () => { void handle.close().finally(finish) })
  handle = serveStdio(() => {
    const server = new Server({ name: 'dsh-capability-bridge-prototype', version: '0.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler('tools/list', async (_request, ctx) => ({ tools: await ask('list', {}, ctx.mcpReq.signal) }))
    server.setRequestHandler('tools/call', async (request, ctx) => {
      try {
        const value = await ask('call', { name: request.params.name, args: request.params.arguments ?? {} }, ctx.mcpReq.signal)
        return { content: [{ type: 'text', text: JSON.stringify(value) }] }
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] } }
    })
    server.onclose = finish
    return server
  }, { transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 262_144 }) })
}
