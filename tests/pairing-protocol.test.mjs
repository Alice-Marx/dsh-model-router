import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { syncOpenmausProtocol } from '../scripts/sync-openmaus-protocol.mjs'
import { credentialHash, keyId, psk, admission, admissionHash, b64u, fromB64u, ed25519PrivateKey, ed25519RawPublicKey, mintRelayToken, verifyRelayToken,
  keyPairFromPrivate, phoneHello, computerAccept, isPublicKey, decodeFrame, encodeFrame, Mux, YamuxError, parseDescriptor, generateKeyPair, encodePayload1,
} from '../modules/openmaus-protocol/index.mjs'

const path = new URL('../modules/openmaus-protocol/vendor/companion/src/e2e/vectors/v1.json', import.meta.url)
const text = await readFile(path, 'utf8'), vectors = JSON.parse(text), bytes = value => Buffer.from(value, 'hex')
const transport = keyPairFromPrivate(bytes(vectors.inputs.transportPrivate))
const phoneEphemeral = keyPairFromPrivate(bytes(vectors.inputs.phoneEphemeralPrivate))
const computerEphemeral = keyPairFromPrivate(bytes(vectors.inputs.computerEphemeralPrivate))
const psks = Object.fromEntries(vectors.V1.credentials.map(row => [row.name, bytes(row.psk)]))
psks.other = psk(credentialHash(vectors.inputs.otherDeviceToken), keyId(transport.publicKey))
const phone = (route = 1, name = 'device', trace) => phoneHello({ remoteStatic: transport.publicKey, psk: psks[name], transport: route, ephemeral: phoneEphemeral, trace }, Buffer.from(vectors.inputs.payload1), vectors.inputs.connB64u)
const computer = (route, names, message, trace) => computerAccept({ staticKey: transport, transport: route, candidates: names.map(id => ({ id, psk: psks[id] })), ephemeral: computerEphemeral, trace }, message)
const sessions = () => { const hello = phone(), accepted = computer(1, ['device'], hello.message1); return { phone: hello.finish(accepted.message2), computer: accepted.keys } }

test('paired protocol source bytes match the fixed upstream provenance and vector digest', async () => {
  assert.equal((await syncOpenmausProtocol({ check: true })).status, 'passed')
  const [digest, name] = (await readFile(new URL('./v1.sha256', path), 'utf8')).trim().split(/\s+/)
  assert.equal(name, 'v1.json')
  assert.equal(createHash('sha256').update(text).digest('hex'), digest)
})

test('credential, transport identity and relay admission derivations match upstream vectors', () => {
  assert.equal(transport.publicKey.toString('hex'), vectors.V1.transportPublic)
  assert.equal(keyId(transport.publicKey).toString('hex'), vectors.V1.keyId)
  for (const row of vectors.V1.credentials) {
    const hash = credentialHash(row.token), adm = admission(hash, bytes(vectors.inputs.hostId))
    assert.equal(hash.toString('hex'), row.credHash)
    assert.equal(psk(hash, keyId(transport.publicKey)).toString('hex'), row.psk)
    assert.equal(adm.toString('hex'), row.adm)
    assert.equal(admissionHash(adm), row.admHash)
  }
  for (const point of vectors.V1.points) assert.equal(isPublicKey(bytes(point.hex)), point.valid, point.name)
})

for (const [name, route, credential] of [['V2', 1, 'device'], ['V3', 2, 'pairing']]) test(`Noise handshake ${name} preserves every upstream wire byte, intermediate state and directional key`, () => {
  const vector = vectors[name], initiatorTrace = [], responderTrace = []
  const hello = phone(route, credential, initiatorTrace), accepted = computer(route, ['other', credential], hello.message1, responderTrace)
  assert.equal(hello.message1.toString('hex'), vector.message1)
  assert.equal(accepted.id, credential)
  assert.equal(accepted.message2.toString('hex'), vector.message2)
  const keys = hello.finish(accepted.message2)
  for (const side of [keys, accepted.keys]) {
    assert.equal(side.kPc.toString('hex'), vector.kPc); assert.equal(side.kCp.toString('hex'), vector.kCp)
    assert.equal(side.handshakeHash.toString('hex'), vector.handshakeHash)
  }
  assert.deepEqual(initiatorTrace, vector.trace); assert.deepEqual(responderTrace, vector.trace)
})

test('bidirectional transport records match the pinned nonce sequence and ciphertext', () => {
  const pair = sessions()
  for (const row of vectors.V4.records) {
    const [sender, receiver] = row.direction === 'pc' ? [pair.phone, pair.computer] : [pair.computer, pair.phone]
    assert.equal(sender.send.nonce, row.n)
    assert.equal(sender.send.seal(bytes(row.frame)).toString('hex'), row.record)
    assert.equal(receiver.receive.open(bytes(row.record)).toString('hex'), row.frame)
  }
})

for (const row of vectors.V6.handshake) test(`pairing rejects malformed or mismatched handshake: ${row.name}`, () => {
  if (row.side === 'computer') assert.equal(computer(row.transport, row.candidates, bytes(row.message1)), null)
  else assert.throws(() => phone().finish(bytes(row.message2)))
})
for (const row of vectors.V6.records) test(`encrypted stream rejects tampering or replay: ${row.name}`, () => {
  const pair = sessions(), receiver = row.receiver === 'computer' ? pair.computer.receive : pair.phone.receive
  let failedAt = -1
  for (const [index, record] of row.records.entries()) { try { receiver.open(bytes(record)) } catch { failedAt = index; break } }
  assert.equal(failedAt, row.failsAt)
})

test('yamux frame encoding retains upstream interoperability', () => {
  for (const row of vectors.V5) {
    const frame = decodeFrame(bytes(row.hex))
    assert.deepEqual({ type: frame.type, flags: frame.flags, streamId: frame.streamId, length: frame.length }, { type: row.type, flags: row.flags, streamId: row.streamId, length: row.length })
    assert.equal(encodeFrame(frame).toString('hex'), row.hex)
  }
})
for (const row of vectors.V6.frames) test(`yamux rejects malformed frame: ${row.name}`, () => assert.throws(() => decodeFrame(bytes(row.hex)), YamuxError))

function runScript(role, accept, steps) {
  const sent = [], mux = new Mux(role, { send: frame => sent.push(encodeFrame(frame).toString('hex')), opened: id => { if (accept !== 'never') mux.accept(id) }, data() {}, ended() {}, reset() {}, writable() {} })
  for (const [index, step] of steps.entries()) {
    try {
      if (step.open) mux.open()
      else if (step.consume) mux.consumed(step.consume.stream, step.consume.bytes)
      else { const header = bytes(step.in.header), length = header.readUInt32BE(8); mux.receive(decodeFrame(Buffer.concat([header, step.in.fill === undefined ? bytes(step.in.payload ?? '') : Buffer.alloc(length, step.in.fill)]))) }
    } catch (error) { if (!(error instanceof YamuxError)) throw error; return { errorAt: index } }
  }
  return { sent }
}
for (const row of vectors.V6.sessions) test(`multiplexed session state: ${row.name}`, () => assert.deepEqual(runScript(row.role, row.accept, row.steps), row.expect))
for (const row of vectors.V7.valid) test(`pairing descriptor accepts canonical pinned identity: ${row.name}`, () => {
  const result = parseDescriptor(row.value); assert.equal(result.outcome, 'ok'); assert.deepEqual(result.descriptor, row.parsed)
})
for (const row of vectors.V7.invalid) test(`pairing descriptor fails closed: ${row.name}`, () => assert.equal(parseDescriptor(row.value).outcome, row.outcome))

test('relay host signatures match upstream and stay distinct from device authentication', () => {
  const key = ed25519PrivateKey(bytes(vectors.V8.seed))
  assert.equal(ed25519RawPublicKey(key).toString('hex'), vectors.V8.publicKey)
  assert.equal(mintRelayToken(vectors.V8.claims, key), vectors.V8.token)
})
for (const row of vectors.V8.verify) test(`relay authentication: ${row.name}`, () => {
  const result = verifyRelayToken(row.token, new Map(Object.entries(row.keys).map(([id, raw]) => [id, fromB64u(raw)])), row.now, row.expectHid)
  assert.equal(result.ok, row.ok); if (!result.ok) assert.equal(result.error, row.error)
})

test('a substituted computer identity never accepts the original pinned pairing credential', () => {
  const pinned = generateKeyPair(), impostor = generateKeyPair(), conn = randomBytes(16), token = `fixture-${b64u(randomBytes(32))}`
  const derived = psk(credentialHash(token), keyId(pinned.publicKey))
  const hello = phoneHello({ remoteStatic: pinned.publicKey, psk: derived, transport: 2 }, encodePayload1(conn, 'dsh-fixture/1'), b64u(conn))
  assert.equal(computerAccept({ staticKey: impostor, transport: 2, candidates: [{ id: 'impostor', psk: derived }] }, hello.message1), null)
})
