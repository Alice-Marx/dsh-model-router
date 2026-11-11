import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { once } from 'node:events'
import { Store, serve } from '../remote-computer-agent/dist/index.mjs'
import { connectSecureTransport } from '../modules/openmaus-protocol/transport.mjs'
import { generateKeyPair, b64u } from '../modules/openmaus-protocol/index.mjs'

const ceiling = { botIds: ['bot-a'], roots: ['project'], tools: ['machine_ping'] }
const requestId = 'pair-request-original'
const expectCode = (fn, code) => assert.throws(fn, error => error.code === code)
async function fixture(t) {
  const parent = resolve('tmp/integration/secure-pairing'); await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'case-'))
  const store = new Store(directory, Database, { admin: true })
  t.after(() => store.close())
  return { store, directory }
}
const peerFor = (store, invite) => store.pairing.candidates().find(candidate => candidate.id.id === invite.inviteId).id

test('short invite pins identity and owner ceiling; durable storage contains no redeemable raw token or code', async t => {
  const { store, directory } = await fixture(t)
  const invite = store.invite('host-a', ceiling, { endpoint: 'http://127.0.0.1:9701', name: 'My computer' })
  assert.equal(invite.expiresAt > Date.now(), true)
  assert.equal(invite.expiresAt <= Date.now() + 120_000, true)
  assert.match(invite.token, /^dsh_pair_[A-Za-z0-9_-]{43}$/)
  assert.match(invite.code, /^\d{6}$/)
  const row = store.db.prepare('SELECT * FROM pairing_invites').get()
  assert.equal(JSON.stringify(row).includes(invite.token), false); assert.equal(JSON.stringify(row).includes(invite.code), false)
  const peer = peerFor(store, invite)
  expectCode(() => store.pairing.redeem(peer, { requestId, code: invite.code, roots: ['elsewhere'] }), 'PAIRING_REQUEST_INVALID')
  const result = store.pairing.redeem(peer, { requestId, code: invite.code })
  assert.deepEqual(result.ceiling, ceiling); assert.deepEqual(result.transport, invite.transport)
  const firstToken = result.token
  assert.equal(store.client(firstToken).id, 'host-a')
  assert.deepEqual(store.pairing.redeem(peer, { requestId, code: invite.code }), { ...result, recovered: true })
  expectCode(() => store.pairing.redeem(peer, { requestId: 'different-request-id', code: invite.code }), 'PAIRING_ALREADY_REDEEMED')
  store.close()
  const cold = new Store(directory, Database, { admin: true }); t.after(() => cold.close())
  assert.deepEqual(cold.pairing.identity(), invite.transport)
  expectCode(() => cold.pairing.redeem(peer, { requestId, code: invite.code }), 'PAIRING_ALREADY_REDEEMED')
  assert.equal(cold.client(firstToken).id, 'host-a')
  assert.equal((await readFile(join(directory, 'agent.sqlite'))).includes(Buffer.from(firstToken)), false)
})

test('five wrong codes close the window; rotation and revocation invalidate proof and replay', async t => {
  const { store } = await fixture(t)
  const invite = store.invite('host-a', ceiling, { endpoint: 'http://127.0.0.1:9701' }), peer = peerFor(store, invite)
  const wrong = invite.code === '000000' ? '999999' : '000000'
  for (let i = 0; i < 5; i++) expectCode(() => store.pairing.redeem(peer, { requestId, code: wrong }), 'PAIRING_CODE_INVALID')
  assert.equal(store.pairing.validPeer(peer), false)
  expectCode(() => store.pairing.redeem(peer, { requestId, code: invite.code }), 'PAIRING_WINDOW_CLOSED')
  const fresh = store.invite('host-a', ceiling, { endpoint: 'http://127.0.0.1:9701' }), freshPeer = peerFor(store, fresh)
  const result = store.pairing.redeem(freshPeer, { requestId, code: fresh.code })
  const clientPeer = store.pairing.candidates().find(candidate => candidate.id.kind === 'client').id
  store.rotate('host-a')
  assert.equal(store.pairing.validPeer(freshPeer), false); assert.equal(store.pairing.validPeer(clientPeer), false)
  expectCode(() => store.client(result.token), 'AUTH_INVALID')
  expectCode(() => store.pairing.redeem(freshPeer, { requestId, code: fresh.code }), 'PAIRING_WINDOW_CLOSED')
  store.revoke('host-a')
  assert.equal(store.pairing.candidates().filter(candidate => candidate.id.kind === 'client').length, 0)
})

test('expired and replaced invites cannot redeem, and an ordinary runtime cannot create owner invitations', async t => {
  const { store, directory } = await fixture(t)
  const first = store.invite('host-a', ceiling, { endpoint: 'http://127.0.0.1:9701' }), firstPeer = peerFor(store, first)
  const second = store.invite('host-a', ceiling, { endpoint: 'http://127.0.0.1:9701' }), secondPeer = peerFor(store, second)
  assert.equal(store.pairing.validPeer(firstPeer), false)
  store.db.prepare('UPDATE pairing_invites SET expires_at=? WHERE id=?').run(Date.now() - 1, second.inviteId)
  assert.equal(store.pairing.validPeer(secondPeer), false)
  expectCode(() => store.pairing.redeem(secondPeer, { requestId, code: second.code }), 'PAIRING_WINDOW_CLOSED')
  store.close()
  const runtime = new Store(directory, Database); t.after(() => runtime.close())
  expectCode(() => runtime.invite('host-b', ceiling, { endpoint: 'http://127.0.0.1:9701' }), 'ADMIN_REQUIRED')
})

test('real Noise channel redeems once, refuses plaintext and scope substitution, and reconnects as the exact paired client', async t => {
  const { store } = await fixture(t)
  const desktopSockets = new Set()
  const desktopSessions = { close: async () => { for (const ws of desktopSockets) ws.terminate() }, hasOrigin: () => false, sweep: async () => {},
    accept: (ws, _origin, _allowed, clientId) => { desktopSockets.add(ws); ws.on('message', value => ws.send(JSON.stringify({ clientId, value: value.toString() }))) } }
  const agent = { store, desktopSessions, call: async (name, _args, context) => ({ name, clientId: context.clientId }) }
  const listener = await serve(agent, { mode: 'e2e', host: '127.0.0.1', port: 0 })
  t.after(() => listener.close())
  const endpoint = `http://127.0.0.1:${listener.address.port}`
  const invite = store.invite('host-a', ceiling, { endpoint })
  const headers = { 'content-type': 'application/json' }
  assert.equal((await fetch(`${endpoint}/control/v1/grants`, { method: 'POST', headers, body: '{}' })).status, 426)
  const pairing = await connectSecureTransport({ endpoint, transport: invite.transport, token: invite.token }); t.after(() => pairing.close())
  const input = { requestId, code: invite.code }
  const first = await pairing.fetch('/pair/v2/redeem', { headers, body: JSON.stringify(input) })
  assert.equal(first.status, 200)
  const result = await first.json()
  assert.equal((await pairing.fetch('/mcp', { headers, body: '{}' })).status, 403)
  const replay = await (await pairing.fetch('/pair/v2/redeem', { headers, body: JSON.stringify(input) })).json()
  assert.equal(replay.recovered, true); assert.equal(replay.token, result.token)
  const channel = await connectSecureTransport({ endpoint, transport: invite.transport, token: result.token }); t.after(() => channel.close())
  const authorized = { ...headers, authorization: `Bearer ${result.token}` }
  const identity = { botId: 'bot-a', taskId: 'task-a', attemptId: 'attempt-a', roots: ['project'], tools: ['machine_ping'], ttlMs: 60_000 }
  const grantResponse = await channel.fetch('/control/v1/grants', { headers: authorized, body: JSON.stringify(identity) })
  assert.equal(grantResponse.status, 200)
  const grant = await grantResponse.json(); assert.equal(grant.clientId, 'host-a')
  const denied = await channel.fetch('/control/v1/grants', { headers: authorized, body: JSON.stringify({ ...identity, botId: 'forged-bot' }) })
  assert.equal(denied.status, 403)
  const another = store.pair('host-b', ceiling)
  assert.equal((await channel.fetch('/control/v1/grants', { headers: { ...headers, authorization: `Bearer ${another.token}` }, body: JSON.stringify(identity) })).status, 401)
  const ws = channel.openWebSocket('/desktop/v1/socket'); t.after(() => ws.terminate()); await once(ws, 'open')
  ws.send('desktop fixture'); const [message] = await once(ws, 'message')
  assert.deepEqual(JSON.parse(message), { clientId: 'host-a', value: 'desktop fixture' })
  store.revoke('host-a')
  await channel.closed
  assert.equal(channel.state, 'closed')
})

test('a substituted public key fails the handshake without plaintext fallback', async t => {
  const { store } = await fixture(t)
  const listener = await serve({ store, desktopSessions: { close: async () => {}, hasOrigin: () => false } }, { mode: 'e2e', port: 0 })
  t.after(() => listener.close())
  const endpoint = `http://127.0.0.1:${listener.address.port}`, invite = store.invite('host-a', ceiling, { endpoint })
  const wrong = { kind: 'noise-v1', publicKey: b64u(generateKeyPair().publicKey) }
  await assert.rejects(connectSecureTransport({ endpoint, transport: wrong, token: invite.token, timeoutMs: 1500 }))
  assert.equal(store.db.prepare('SELECT count(*) n FROM clients').get().n, 0)
})

test('device capacity is enforced before mutation, including pending redemption and restoration, while existing clients still connect', async t => {
  const { store } = await fixture(t)
  for (let i = 0; i < 127; i++) store.pair(`host-${i}`, ceiling)
  const invite = store.invite('host-pending', ceiling, { endpoint: 'http://127.0.0.1:9701' }), peer = peerFor(store, invite)
  store.pair('host-last', ceiling)
  expectCode(() => store.pair('host-overflow', ceiling), 'PAIRING_DEVICE_LIMIT')
  expectCode(() => store.invite('host-overflow', ceiling, { endpoint: 'http://127.0.0.1:9701' }), 'PAIRING_DEVICE_LIMIT')
  expectCode(() => store.pairing.redeem(peer, { requestId, code: invite.code }), 'PAIRING_DEVICE_LIMIT')
  assert.equal(store.db.prepare('SELECT consumed_request FROM pairing_invites WHERE id=?').get(invite.inviteId).consumed_request, null)
  const rotated = store.rotate('host-last'); assert.equal(store.client(rotated.token).id, 'host-last')
  store.revoke('host-0')
  const paired = store.pairing.redeem(peer, { requestId, code: invite.code }); assert.equal(store.client(paired.token).id, 'host-pending')
  expectCode(() => store.rotate('host-0'), 'PAIRING_DEVICE_LIMIT')
  assert.equal(store.db.prepare('SELECT revoked FROM clients WHERE id=?').get('host-0').revoked, 1)
  store.revoke('host-1'); assert.equal(store.client(store.rotate('host-0').token).id, 'host-0')
  assert.equal(store.pairing.candidates().filter(row => row.id.kind === 'client').length, 128)
})
