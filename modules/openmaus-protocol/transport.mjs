import http from 'node:http'
import WebSocket from 'ws'
import { dial, TRANSPORT_DIRECT, credentialHash, psk, keyId, fromB64u, isPublicKey, sha256 } from './index.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }

export function normalizeSecureTransport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['kind', 'publicKey', 'fingerprint'].includes(key))
    || value.kind !== 'noise-v1' || typeof value.publicKey !== 'string') fail('PAIRING_TRANSPORT_INVALID')
  const publicKey = fromB64u(value.publicKey)
  if (!publicKey || !isPublicKey(publicKey)) fail('PAIRING_TRANSPORT_INVALID')
  const fingerprint = sha256(publicKey).toString('hex')
  if (value.fingerprint !== undefined && value.fingerprint !== fingerprint) fail('PAIRING_IDENTITY_MISMATCH')
  return { kind: 'noise-v1', publicKey: value.publicKey, fingerprint }
}

/** A pinned channel carries HTTP and desktop WebSockets; reconnection never replays an application request. */
export async function connectSecureTransport({ endpoint, transport, token, signal, timeoutMs = 10_000 }) {
  transport = normalizeSecureTransport(transport)
  let url
  try { url = new URL(endpoint) } catch { fail('INVALID_MACHINE_ENDPOINT') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('INVALID_MACHINE_ENDPOINT')
  if (typeof token !== 'string' || !/^(?:dsh_pair_)?[A-Za-z0-9_-]{43}$/.test(token)) fail('PAIRING_CREDENTIAL_INVALID')
  signal?.throwIfAborted()
  const websocketUrl = new URL('/v1/e2e', url)
  websocketUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const remoteStatic = fromB64u(transport.publicKey)
  const pending = dial({ url: websocketUrl.href, transportByte: TRANSPORT_DIRECT, remoteStatic,
    psk: psk(credentialHash(token), keyId(remoteStatic)), app: 'DSH Bot', timeoutMs })
  let aborted = false
  const cancel = () => { aborted = true }
  signal?.addEventListener('abort', cancel, { once: true })
  let session
  try { session = await pending } finally { signal?.removeEventListener('abort', cancel) }
  if (aborted || signal?.aborted) { session.shutdown(); signal?.throwIfAborted(); fail('PAIRING_CANCELLED') }
  const agent = new http.Agent({ keepAlive: true, maxSockets: 8 })
  const openStream = () => {
    const stream = session.openStream()
    return Object.assign(stream, { setTimeout() { return stream }, setNoDelay() { return stream }, setKeepAlive() { return stream }, ref() { return stream }, unref() { return stream } })
  }
  agent.createConnection = (_options, callback) => {
    try { const stream = openStream(); callback?.(null, stream); return stream }
    catch (error) { callback?.(error); return undefined }
  }
  void session.closed.then(() => agent.destroy())
  const close = () => { agent.destroy(); session.shutdown() }
  return Object.freeze({
    get state() { return session.state },
    closed: session.closed,
    close,
    async fetch(path, options = {}) {
      if (typeof path !== 'string' || !/^\/(?:control\/v1\/|desktop\/v1\/|pair\/v2\/|mcp$)/.test(path) || path.includes('?') || path.includes('#')) fail('E2E_PATH_INVALID')
      const { signal: requestSignal, headers, body, method = 'POST' } = options
      requestSignal?.throwIfAborted()
      return await new Promise((resolve, reject) => {
        const request = http.request({ host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path, method, headers, agent, signal: requestSignal }, response => {
          const chunks = []; let count = 0
          response.on('data', chunk => { count += chunk.length; if (count > 2 * 1024 * 1024) { request.destroy(); reject(Object.assign(new Error('MACHINE_RESPONSE_LIMIT'), { code: 'MACHINE_RESPONSE_LIMIT' })) } else chunks.push(chunk) })
          response.on('error', reject)
          response.on('end', () => {
            const resultHeaders = new Headers()
            for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) resultHeaders.set(key, Array.isArray(value) ? value.join(', ') : value)
            resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: resultHeaders }))
          })
        })
        request.on('error', reject); request.end(body)
      })
    },
    openWebSocket(path, { origin, autoPong = false } = {}) {
      if (path !== '/desktop/v1/socket') fail('E2E_PATH_INVALID')
      const inner = new URL(path, url); inner.protocol = 'ws:'; inner.port = url.port || (url.protocol === 'https:' ? '443' : '80')
      return new WebSocket(inner, { agent, autoPong,
        ...(origin ? { origin } : {}), perMessageDeflate: false, maxPayload: 9 * 1024 * 1024 })
    },
  })
}
