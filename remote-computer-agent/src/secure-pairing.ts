import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { generateKeyPair, keyPairFromPrivate, keyId, psk, b64u, credentialHashFromHex } from '../../modules/openmaus-protocol/index.mjs'
import { canonical, fail, identifier, secret, sha } from './protocol.js'

export const PAIRING_TTL_MS = 120_000
export const PAIRING_ATTEMPTS = 5
export const MAX_PAIRED_CLIENTS = 128
const MAX_INVITES = 20
const digestEqual = (a: string, b: string) => /^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
const nameOf = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) || 'DSH Host'
type Approval = { botIds: string[]; roots: string[]; tools: string[]; hostManagedBots?: boolean }
type Peer = { kind: 'invite'; id: string; digest: string } | { kind: 'client'; id: string; digest: string; revision: number }
type Outcome = { clientId: string; token: string; machineId: string; secretRef: string; hostManagedBots: boolean }

/** An invite fixes the remote owner's ceiling; redemption never accepts replacement roots or tools. */
export class SecurePairing {
  private replay = new Map<string, { proof: string; requestId: string; expiresAt: number; result: Outcome }>()
  readonly transportKey: { privateKey: Buffer; publicKey: Buffer }
  constructor(private db: any, private machineId: string, private commitClient: (id: string, ceiling: Approval) => Outcome, private now = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS pairing_invites (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, token_digest TEXT NOT NULL, code_digest TEXT NOT NULL,
      expires_at INTEGER NOT NULL, attempts_left INTEGER NOT NULL, ceiling TEXT NOT NULL, name TEXT NOT NULL,
      consumed_request TEXT, consumed_at INTEGER
    ); CREATE INDEX IF NOT EXISTS pairing_invite_expiry ON pairing_invites(expires_at);`)
    const generated = generateKeyPair()
    db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('e2eTransportPrivateKey', b64u(generated.privateKey))
    const stored = db.prepare('SELECT value FROM meta WHERE key=?').get('e2eTransportPrivateKey')?.value
    if (typeof stored !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(stored)) fail('PAIRING_IDENTITY_INVALID')
    try { this.transportKey = keyPairFromPrivate(Buffer.from(stored, 'base64url')) } catch { fail('PAIRING_IDENTITY_INVALID') }
  }

  identity() { return { kind: 'noise-v1', publicKey: b64u(this.transportKey.publicKey), fingerprint: sha(this.transportKey.publicKey) } }

  create(clientId: string, ceiling: Approval, options: { endpoint: string; name?: string }) {
    identifier(clientId)
    let endpoint: URL
    try { endpoint = new URL(options.endpoint) } catch { fail('PAIRING_ENDPOINT_INVALID') }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.href.length > 1024) fail('PAIRING_ENDPOINT_INVALID')
    const now = this.now(), token = `dsh_pair_${secret()}`, code = String(randomInt(1_000_000)).padStart(6, '0'), id = `invite-${randomUUID()}`
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM pairing_invites WHERE expires_at<=?').run(now - PAIRING_TTL_MS)
      if (this.db.prepare('SELECT 1 FROM clients WHERE id=? AND revoked=0').get(clientId)) fail('CLIENT_ALREADY_PAIRED', 409)
      if (this.db.prepare('SELECT count(*) AS n FROM clients WHERE revoked=0').get().n >= MAX_PAIRED_CLIENTS) fail('PAIRING_DEVICE_LIMIT', 429)
      this.db.prepare('UPDATE pairing_invites SET attempts_left=0 WHERE client_id=? AND consumed_request IS NULL').run(clientId)
      if (this.db.prepare('SELECT count(*) AS n FROM pairing_invites WHERE expires_at>? AND attempts_left>0 AND consumed_request IS NULL').get(now).n >= MAX_INVITES) fail('PAIRING_WINDOW_LIMIT', 429)
      this.db.prepare('INSERT INTO pairing_invites VALUES (?,?,?,?,?,?,?,?,NULL,NULL)').run(id, clientId, sha(token), sha(code), now + PAIRING_TTL_MS, PAIRING_ATTEMPTS, canonical(ceiling), nameOf(options.name))
      return { format: 'dsh-pairing-invite', version: 2, inviteId: id, machineId: this.machineId, clientId, name: nameOf(options.name),
        endpoint: endpoint.origin, expiresAt: now + PAIRING_TTL_MS, token, code, transport: this.identity(),
        ceiling: structuredClone(ceiling) }
    }).immediate()
  }

  candidates() {
    const now = this.now(), transportId = keyId(this.transportKey.publicKey)
    for (const [id, row] of this.replay) if (row.expiresAt <= now) this.replay.delete(id)
    const invites = this.db.prepare('SELECT id,token_digest FROM pairing_invites WHERE expires_at>? AND attempts_left>0').all(now)
      .map((row: any) => ({ id: { kind: 'invite', id: row.id, digest: row.token_digest } as Peer, hash: row.token_digest }))
    const clients = this.db.prepare('SELECT id,digest,revision FROM clients WHERE revoked=0').all()
      .map((row: any) => ({ id: { kind: 'client', id: row.id, digest: row.digest, revision: row.revision } as Peer, hash: row.digest }))
    if (clients.length > MAX_PAIRED_CLIENTS) fail('PAIRING_DEVICE_LIMIT', 429)
    return [...invites, ...clients].map(row => ({ id: row.id, psk: psk(credentialHashFromHex(row.hash)!, transportId) }))
  }

  validPeer(peer: Peer) {
    if (peer.kind === 'client') {
      const client = this.db.prepare('SELECT digest,revision,revoked FROM clients WHERE id=?').get(peer.id)
      return Boolean(client && !client.revoked && client.revision === peer.revision && digestEqual(client.digest, peer.digest))
    }
    const invite = this.db.prepare('SELECT token_digest,expires_at,attempts_left FROM pairing_invites WHERE id=?').get(peer.id)
    return Boolean(invite && invite.expires_at > this.now() && invite.attempts_left > 0 && digestEqual(invite.token_digest, peer.digest))
  }

  redeem(peer: Peer, input: any) {
    if (peer.kind !== 'invite' || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestId', 'code'].includes(key))
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) fail('PAIRING_REQUEST_INVALID')
    const now = this.now()
    const decision = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM pairing_invites WHERE id=?').get(peer.id)
      if (!row || !digestEqual(row.token_digest, peer.digest) || row.expires_at <= now || row.attempts_left <= 0) return { error: 'PAIRING_WINDOW_CLOSED' }
      if (!digestEqual(row.code_digest, sha(input.code))) {
        this.db.prepare('UPDATE pairing_invites SET attempts_left=attempts_left-1 WHERE id=?').run(peer.id)
        return { error: 'PAIRING_CODE_INVALID' }
      }
      if (row.consumed_request !== null) {
        const cached = this.replay.get(row.id), client = this.db.prepare('SELECT digest,revoked FROM clients WHERE id=?').get(row.client_id)
        if (row.consumed_request !== input.requestId || !cached || cached.expiresAt <= now || cached.proof !== peer.digest || cached.requestId !== input.requestId) return { error: 'PAIRING_ALREADY_REDEEMED' }
        if (!client || client.revoked || !digestEqual(client.digest, sha(cached.result.token))) return { error: 'PAIRING_DEVICE_CHANGED' }
        return { result: structuredClone(cached.result), ceiling: JSON.parse(row.ceiling), recovered: true }
      }
      const result = this.commitClient(row.client_id, JSON.parse(row.ceiling))
      this.db.prepare('UPDATE pairing_invites SET consumed_request=?,consumed_at=? WHERE id=?').run(input.requestId, now, row.id)
      this.replay.set(row.id, { proof: peer.digest, requestId: input.requestId, expiresAt: row.expires_at, result: structuredClone(result) })
      return { result, ceiling: JSON.parse(row.ceiling), recovered: false }
    }).immediate()
    if (decision.error) fail(decision.error, 403)
    return { ...decision.result, transport: this.identity(), ceiling: decision.ceiling, recovered: decision.recovered }
  }

  invalidate(clientId: string) {
    this.db.prepare('UPDATE pairing_invites SET attempts_left=0 WHERE client_id=?').run(clientId)
    for (const [id, row] of this.replay) if (row.result.clientId === clientId) this.replay.delete(id)
  }

  close() { this.replay.clear() }
}
