import { createHash } from 'node:crypto'
import { parseSecureInvite } from './pairing-invite.mjs'
import { connectSecureTransport, normalizeSecureTransport } from '../../../modules/openmaus-protocol/transport.mjs'
import { REMOTE_TOOLS } from './remote-machines.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const hash = value => createHash('sha256').update(value).digest('hex')
// SHA256(token) is also the Noise credential hash. A recovery check must not
// persist that reusable authentication material in the Host intent journal.
const credentialDigest = token => hash(`dsh-pairing-recovery-v1\0${token}`)
const sameScope = (a,b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

/** Durable intent/result only. Raw invite proofs remain in memory; device credentials go straight to Host secrets. */
export function openSecurePairingHost({ Database, file, saveSecret, resolveSecret, machines, pair, botExists, now = Date.now }) {
  const db = new Database(file)
  db.pragma('busy_timeout=5000'); db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL')
  db.exec(`CREATE TABLE IF NOT EXISTS secure_pairing_requests (
    request_id TEXT PRIMARY KEY,intent_hash TEXT NOT NULL,machine_id TEXT NOT NULL,client_id TEXT NOT NULL,
    config TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created_at INTEGER NOT NULL
  ); CREATE UNIQUE INDEX IF NOT EXISTS secure_pairing_intent ON secure_pairing_requests(intent_hash)`)
  if (!db.pragma('table_info(secure_pairing_requests)').some(column=>column.name==='credential_digest')) db.exec('ALTER TABLE secure_pairing_requests ADD COLUMN credential_digest TEXT')
  const inFlight = new Set()
  let closed = false
  return Object.freeze({
    async redeem(input,context) {
      if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED')
      if (closed) fail('PAIRING_SERVICE_CLOSED')
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['invite','code','requestId','probeBotId','expectedRevision'].includes(key))
        || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)
        || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code) || !botExists(input.probeBotId)
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('PAIRING_REQUEST_INVALID')
      const invite = parseSecureInvite(input.invite), transport = normalizeSecureTransport(invite.transport)
      if (invite.ceiling.tools.some(tool => !REMOTE_TOOLS.includes(tool))) fail('PAIRING_TOOLS_UNSUPPORTED')
      if (!invite.ceiling.hostManagedBots && !invite.ceiling.botIds.includes(input.probeBotId)) fail('MACHINE_BOT_DENIED')
      const { code: _printedCode, token, ...publicInvite } = invite
      const intent = hash(JSON.stringify({ invite: publicInvite, token: hash(token), code: hash(input.code), probeBotId: input.probeBotId, expectedRevision: input.expectedRevision }))
      const secretName = `REMOTE_AGENT_${hash(JSON.stringify([invite.machineId,invite.clientId])).slice(0,40).toUpperCase()}`
      const config = { machineId: invite.machineId, clientId: invite.clientId, name: invite.name, endpoint: invite.endpoint,
        transport, roots: invite.ceiling.roots, tools: invite.ceiling.tools, secretRef: `ds-secret/${secretName}`,
        probeBotId: input.probeBotId, expectedRevision: input.expectedRevision }
      let row = db.prepare('SELECT * FROM secure_pairing_requests WHERE request_id=?').get(input.requestId)
      if (row && row.intent_hash !== intent) fail('PAIRING_REQUEST_CONFLICT')
      if (!row) row = db.prepare('SELECT * FROM secure_pairing_requests WHERE intent_hash=?').get(intent)
      const requestId = row?.request_id ?? input.requestId
      if (row?.status === 'complete') {
        const result=JSON.parse(row.result), live=machines.readModel().items.find(item=>item.id===invite.machineId)
        if(!live||live.status==='revoked'||live.revision!==result.revision||live.transport?.publicKey!==transport.publicKey)fail('PAIRING_CONFIGURATION_CHANGED')
        return { ...result, recovered: true }
      }
      if (inFlight.has(requestId)) fail('PAIRING_REQUEST_PENDING')
      const existing = () => machines.readModel().items.find(item => item.id === invite.machineId)
      const current = existing()
      if (!row && (current?.revision ?? 0) !== input.expectedRevision) fail('MACHINE_CONFIG_CONFLICT')
      if (!row) {
        if (invite.expiresAt <= now() || invite.expiresAt > now() + 180_000) fail('PAIRING_WINDOW_CLOSED')
        db.prepare("INSERT INTO secure_pairing_requests(request_id,intent_hash,machine_id,client_id,config,status,result,created_at) VALUES(?,?,?,?,?,'pending',NULL,?)").run(requestId,intent,invite.machineId,invite.clientId,JSON.stringify(config),now())
        row = { status: 'pending' }
      }
      inFlight.add(requestId)
      let channel
      try {
        // The Secret service and SQLite cannot share a transaction. Persist the
        // verified credential digest first, then reconcile an already committed
        // Secret after a crash without redeeming or minting another device.
        if (row.status !== 'secret-saved' && /^[a-f0-9]{64}$/.test(row.credential_digest??'') && typeof resolveSecret==='function') {
          const saved=await resolveSecret(config.secretRef)
          if (saved!==null && saved!==undefined) {
            if (typeof saved!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(saved)||credentialDigest(saved)!==row.credential_digest) fail('PAIRING_CREDENTIAL_CHANGED')
            db.prepare("UPDATE secure_pairing_requests SET status='secret-saved' WHERE request_id=?").run(requestId)
            row.status='secret-saved'
          }
        }
        if (row.status !== 'secret-saved') {
          if (invite.expiresAt <= now()) fail('PAIRING_RESULT_UNRECOVERABLE')
          context.signal?.throwIfAborted()
          try { channel = await connectSecureTransport({ endpoint: invite.endpoint, transport, token, signal: context.signal }) }
          catch { fail('PAIRING_PEER_UNVERIFIED') }
          let response, result
          try {
            response = await channel.fetch('/pair/v2/redeem', { headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ requestId, code: input.code }), signal: AbortSignal.any([AbortSignal.timeout(15_000),...(context.signal?[context.signal]:[])]) })
            result = await response.json()
          } catch { fail('PAIRING_RESULT_UNKNOWN') }
          if (!response.ok) {
            if (result?.error?.code==='PAIRING_ALREADY_REDEEMED') fail('PAIRING_DEVICE_ALREADY_COMMITTED')
            fail(/^[A-Z][A-Z0-9_]{0,80}$/.test(result?.error?.code) ? result.error.code : 'PAIRING_REDEEM_FAILED')
          }
          if (result.machineId !== invite.machineId || result.clientId !== invite.clientId || typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.token)
            || normalizeSecureTransport(result.transport).publicKey !== transport.publicKey || !result.ceiling
            || !sameScope(result.ceiling.roots,invite.ceiling.roots) || !sameScope(result.ceiling.tools,invite.ceiling.tools)
            || !sameScope(result.ceiling.botIds??[],invite.ceiling.botIds) || (result.ceiling.hostManagedBots===true)!==(invite.ceiling.hostManagedBots===true)) fail('PAIRING_IDENTITY_MISMATCH')
          if (row.credential_digest && row.credential_digest!==credentialDigest(result.token)) fail('PAIRING_CREDENTIAL_CHANGED')
          db.prepare("UPDATE secure_pairing_requests SET status='secret-saving',credential_digest=? WHERE request_id=?").run(credentialDigest(result.token),requestId)
          await saveSecret(secretName,result.token)
          db.prepare("UPDATE secure_pairing_requests SET status='secret-saved' WHERE request_id=?").run(requestId)
        }
        context.signal?.throwIfAborted()
        const live = existing()
        let result
        if (live && live.revision === config.expectedRevision + 1 && live.secretRef === config.secretRef
          && live.endpoint === config.endpoint && live.transport?.publicKey === config.transport.publicKey
          && sameScope(live.roots,config.roots) && sameScope(live.tools,config.tools)) {
          result = { ...live, mainBinding: { status: 'blocked', code: 'PAIRING_BINDING_REVIEW_REQUIRED' } }
        } else result = await pair(config,context)
        if (closed) fail('PAIRING_SERVICE_CLOSED')
        db.prepare("UPDATE secure_pairing_requests SET status='complete',result=? WHERE request_id=?").run(JSON.stringify(result),requestId)
        return result
      } finally { channel?.close(); inFlight.delete(requestId) }
    },
    close() { if (!closed) { closed = true; db.close() } },
  })
}
