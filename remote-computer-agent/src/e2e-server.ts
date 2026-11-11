import http from 'node:http'
import { duplexPair } from 'node:stream'
import { WebSocketServer } from 'ws'
import { E2ESession, TRANSPORT_DIRECT, DIRECT_PROTOCOL, SEND_BUFFER_HIGH } from '../../modules/openmaus-protocol/index.mjs'
import { fail } from './protocol.js'
import type { SecurePairing } from './secure-pairing.js'

type Peer = Parameters<SecurePairing['validPeer']>[0]

/** Inner requests arrive only on a successfully authenticated Noise stream, never a public TCP port. */
export function secureTransport(pairing: SecurePairing,
  handler: (req: http.IncomingMessage, res: http.ServerResponse, peer: Peer) => void,
  upgrade: (req: http.IncomingMessage, socket: any, head: Buffer, peer: Peer) => void) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65535, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(DIRECT_PROTOCOL) ? DIRECT_PROTOCOL : false })
  const sessions = new Set<any>(), attempts = new Map<string, { start: number; count: number }>()
  let windowStart = 0, windowCount = 0, closing = false
  const sweep = setInterval(() => {
    for (const session of sessions) if (session.peer && !pairing.validPeer(session.peer)) session.remove()
  }, 500)
  sweep.unref()
  return {
    accept(req: http.IncomingMessage, socket: any, head: Buffer) {
      if (closing || sockets.clients.size >= 16) fail('E2E_CONNECTION_LIMIT', 429)
      if (req.headers.origin !== undefined || req.headers['sec-websocket-protocol'] !== DIRECT_PROTOCOL) fail('E2E_CLIENT_REQUIRED', 403)
      const now = Date.now(), source = req.socket.remoteAddress ?? 'unknown'
      if (now - windowStart >= 60_000 || now < windowStart) { windowStart = now; windowCount = 0 }
      const previous = attempts.get(source), row = previous && now - previous.start < 60_000 && now >= previous.start ? previous : { start: now, count: 0 }
      if (++row.count > 30 || ++windowCount > 120) fail('E2E_CONNECTION_RATE_LIMIT', 429)
      attempts.delete(source); attempts.set(source, row)
      while (attempts.size > 256) attempts.delete(attempts.keys().next().value!)
      sockets.handleUpgrade(req, socket, head, ws => {
        sockets.emit('connection', ws, req)
        const streams = new Set<any>()
        let session: any
        const origin = http.createServer((request, response) => {
          if (!session.peer || !pairing.validPeer(session.peer)) { response.writeHead(403); response.end(); return }
          handler(request, response, session.peer)
        })
        origin.requestTimeout = 30_000; origin.headersTimeout = 10_000
        origin.on('upgrade', (request, connection, bytes) => {
          if (!session.peer || !pairing.validPeer(session.peer)) return connection.destroy()
          upgrade(request, connection, bytes, session.peer)
        })
        const transport = {
          send: (message: Uint8Array) => { if (ws.readyState === 1) ws.send(message) },
          close: (code: number) => { if (ws.readyState < 2) ws.close(code === 1000 || code >= 3000 && code <= 4999 ? code : 1000) },
          get bufferedAmount() { return ws.bufferedAmount },
          onceDrained(listener: () => void) {
            const check = () => { if (ws.readyState !== 1 || ws.bufferedAmount <= SEND_BUFFER_HIGH / 4) listener(); else { const timer = setTimeout(check, 5); timer.unref() } }
            check()
          },
        }
        session = E2ESession.computer({ transport, transportByte: TRANSPORT_DIRECT, staticKey: pairing.transportKey,
          candidates: () => pairing.candidates(),
          async connectOrigin() {
            if (!session.peer || !pairing.validPeer(session.peer)) throw new Error('Peer removed')
            const [client, server] = duplexPair()
            Object.assign(server, { setTimeout() { return server }, setNoDelay() { return server }, setKeepAlive() { return server }, remoteAddress: source })
            client.on('error', () => {}); server.on('error', () => {})
            client.once('close', () => server.destroy()); server.once('close', () => client.destroy())
            streams.add(server); server.once('close', () => streams.delete(server))
            origin.emit('connection', server)
            return client
          },
        })
        sessions.add(session)
        ws.on('message', (data, binary) => { try { session.receive(Buffer.from(data as Buffer), binary) } catch { session.close(4000) } })
        ws.on('error', () => session.close(4000))
        ws.once('close', code => session.transportClosed(code))
        void session.closed.then(() => { sessions.delete(session); for (const stream of streams) stream.destroy(); origin.close() })
      })
    },
    async close() {
      closing = true; clearInterval(sweep)
      for (const session of sessions) session.shutdown()
      for (const socket of sockets.clients) socket.terminate()
      await new Promise<void>(resolve => sockets.close(() => resolve()))
    },
  }
}
