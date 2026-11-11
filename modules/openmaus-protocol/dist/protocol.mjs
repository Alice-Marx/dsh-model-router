// Generated from frozen OpenMausBot protocol sources; Apache-2.0; see ../SOURCE.json, ../NOTICE and ../vendor/LICENSE.
// modules/openmaus-protocol/vendor/companion/src/e2e/noise.ts
import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

// modules/openmaus-protocol/vendor/companion/src/e2e/credentials.ts
import { createHash, createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from "node:crypto";
var B64U = /^[A-Za-z0-9_-]*$/;
var b64u = (bytes) => Buffer.from(bytes).toString("base64url");
function fromB64u(text) {
  if (!B64U.test(text) || text.length % 4 === 1) return null;
  const bytes = Buffer.from(text, "base64url");
  return bytes.toString("base64url") === text ? bytes : null;
}
var sha256 = (bytes) => createHash("sha256").update(bytes).digest();
var hmacSha256 = (key, message) => createHmac("sha256", key).update(message).digest();
function sameBytes(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}
var KEY_ID_BYTES = 16;
var HOST_ID_BYTES = 16;
var PSK_LABEL = Buffer.from("omb-e2e psk v1", "utf8");
var ADMISSION_LABEL = Buffer.from("omb-relay admission v1", "utf8");
var credentialHash = (token) => sha256(Buffer.from(token, "utf8"));
function credentialHashFromHex(hex) {
  return /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
}
var keyId = (transportPublicKey) => sha256(transportPublicKey).subarray(0, KEY_ID_BYTES);
var psk = (credHash, transportKeyId) => hmacSha256(credHash, Buffer.concat([PSK_LABEL, transportKeyId]));
var admission = (credHash, hostId) => hmacSha256(credHash, Buffer.concat([ADMISSION_LABEL, hostId]));
var admissionHash = (adm) => b64u(sha256(adm));
var RELAY_TOKEN_TTL_S = 12 * 60 * 60;
var RELAY_TOKEN_MAX_CHARS = 2048;
var KID = /^k[0-9]{1,3}$/;
function ed25519PrivateKey(seed) {
  if (seed.length !== 32) throw new Error("an Ed25519 seed is 32 bytes");
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}
function ed25519PublicKey(raw) {
  if (raw.length !== 32) throw new Error("an Ed25519 public key is 32 bytes");
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}
var ed25519RawPublicKey = (key) => Buffer.from(createPublicKey(key).export({ format: "der", type: "spki" })).subarray(-32);
function mintRelayToken(claims, signingKey) {
  const body = b64u(Buffer.from(JSON.stringify({
    v: claims.v,
    kid: claims.kid,
    hid: claims.hid,
    iid: claims.iid,
    iat: claims.iat,
    exp: claims.exp
  }), "utf8"));
  return `${body}.${b64u(sign(null, Buffer.from(body, "ascii"), signingKey))}`;
}
var isSeconds = (value) => Number.isSafeInteger(value) && value > 0;
function verifyRelayToken(token, keys, nowS, expectHid) {
  const fail = (error) => ({ ok: false, error });
  if (typeof token !== "string" || token.length > RELAY_TOKEN_MAX_CHARS) return fail("malformed");
  const parts = token.split(".");
  if (parts.length !== 2) return fail("malformed");
  const [body, signatureText] = parts;
  const payload = fromB64u(body);
  const signature = fromB64u(signatureText);
  if (!payload || !signature || signature.length !== 64) return fail("malformed");
  let claims;
  try {
    const parsed = JSON.parse(payload.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("malformed");
    claims = parsed;
  } catch {
    return fail("malformed");
  }
  if (claims.v !== 1 || typeof claims.kid !== "string" || !KID.test(claims.kid)) return fail("malformed");
  const raw = keys.get(claims.kid);
  if (!raw) return fail("kid");
  if (!verify(null, Buffer.from(body, "ascii"), ed25519PublicKey(raw), signature)) return fail("signature");
  const hid = typeof claims.hid === "string" ? fromB64u(claims.hid) : null;
  if (!hid || hid.length !== HOST_ID_BYTES) return fail("malformed");
  if (typeof claims.iid !== "string" || claims.iid.length === 0 || claims.iid.length > 64) return fail("malformed");
  if (!isSeconds(claims.iat) || !isSeconds(claims.exp) || claims.exp <= claims.iat) return fail("malformed");
  if (claims.exp - claims.iat > RELAY_TOKEN_TTL_S) return fail("malformed");
  if (nowS >= claims.exp) return fail("expired");
  if (expectHid !== void 0 && claims.hid !== expectHid) return fail("hid");
  return { ok: true, claims };
}

// modules/openmaus-protocol/vendor/companion/src/e2e/noise.ts
var PROTOCOL_NAME = "Noise_NKpsk0_P256_AESGCM_SHA256";
var PUBLIC_KEY_BYTES = 65;
var TAG_BYTES = 16;
var MAX_RECORD_BYTES = 65535;
var MAX_RECORD_PLAINTEXT = MAX_RECORD_BYTES - TAG_BYTES;
var MAX_HANDSHAKE_PAYLOAD = 512;
var MAX_HANDSHAKE_MESSAGE = PUBLIC_KEY_BYTES + MAX_HANDSHAKE_PAYLOAD + TAG_BYTES;
var CONN_BYTES = 16;
var MAX_APP_CHARS = 40;
var NONCE_LIMIT = 2 ** 32;
var HANDSHAKE_DEADLINE_MS = 1e4;
var TRANSPORT_RELAY = 1;
var TRANSPORT_DIRECT = 2;
var CLOSE = {
  normal: 1e3,
  goingAway: 1001,
  protocol: 4e3,
  rejected: 4001,
  deadline: 4002
};
var NoiseError = class extends Error {
  reason;
  constructor(reason) {
    super(`e2e: ${reason}`);
    this.reason = reason;
  }
};
function prologue(transport) {
  return Buffer.concat([Buffer.from("omb-e2e/1", "utf8"), Buffer.from([0, transport])]);
}
var ecdh = (privateKey) => {
  const curve = createECDH("prime256v1");
  if (privateKey) curve.setPrivateKey(privateKey);
  else curve.generateKeys();
  return curve;
};
function keyPairFromPrivate(privateKey) {
  if (privateKey.length !== 32) throw new NoiseError("bad_private_key");
  return { privateKey: Buffer.from(privateKey), publicKey: ecdh(privateKey).getPublicKey(null, "uncompressed") };
}
function generateKeyPair() {
  const curve = ecdh();
  const raw = curve.getPrivateKey();
  return { privateKey: Buffer.concat([Buffer.alloc(32 - raw.length), raw]), publicKey: curve.getPublicKey(null, "uncompressed") };
}
function dh(privateKey, publicKey) {
  if (publicKey.length !== PUBLIC_KEY_BYTES || publicKey[0] !== 4) throw new NoiseError("bad_point");
  try {
    return ecdh(privateKey).computeSecret(publicKey);
  } catch {
    throw new NoiseError("bad_point");
  }
}
var CHECK_SCALAR = Buffer.alloc(32, 1);
function isPublicKey(bytes) {
  try {
    dh(CHECK_SCALAR, bytes);
    return true;
  } catch {
    return false;
  }
}
function hkdf(chainingKey, ikm, outputs) {
  const out = Buffer.from(hkdfSync("sha256", ikm, chainingKey, Buffer.alloc(0), 32 * outputs));
  return Array.from({ length: outputs }, (_, index) => out.subarray(index * 32, index * 32 + 32));
}
function nonceBytes(n) {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(BigInt(n), 4);
  return nonce;
}
function aeadSeal(key, n, ad, plaintext) {
  const cipher = createCipheriv("aes-256-gcm", key, nonceBytes(n), { authTagLength: TAG_BYTES });
  cipher.setAAD(ad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}
function aeadOpen(key, n, ad, ciphertext) {
  if (ciphertext.length < TAG_BYTES) throw new NoiseError("short_ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, nonceBytes(n), { authTagLength: TAG_BYTES });
  decipher.setAAD(ad);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new NoiseError("aead");
  }
}
var CipherState = class {
  #key;
  #n;
  /** `n` other than 0 is for tests of the counter limit. */
  constructor(key = null, n = 0) {
    this.#key = key;
    this.#n = n;
  }
  get hasKey() {
    return this.#key !== null;
  }
  get nonce() {
    return this.#n;
  }
  /** Test-only view of the key, for the vectors. */
  get keyBytes() {
    return this.#key;
  }
  encryptWithAd(ad, plaintext) {
    if (!this.#key) return Buffer.from(plaintext);
    if (this.#n >= NONCE_LIMIT) throw new NoiseError("nonce_exhausted");
    const out = aeadSeal(this.#key, this.#n, ad, plaintext);
    this.#n += 1;
    return out;
  }
  /** The counter moves only on success; any failure ends the session anyway. */
  decryptWithAd(ad, ciphertext) {
    if (!this.#key) return Buffer.from(ciphertext);
    if (this.#n >= NONCE_LIMIT) throw new NoiseError("nonce_exhausted");
    const out = aeadOpen(this.#key, this.#n, ad, ciphertext);
    this.#n += 1;
    return out;
  }
};
var SymmetricState = class _SymmetricState {
  ck;
  h;
  cipher = new CipherState();
  trace;
  constructor(h, ck, trace) {
    this.h = h;
    this.ck = ck;
    this.trace = trace;
  }
  static initialize(trace = null) {
    const name = Buffer.from(PROTOCOL_NAME, "utf8");
    const h = name.length <= 32 ? Buffer.concat([name, Buffer.alloc(32 - name.length)]) : sha256(name);
    return new _SymmetricState(h, Buffer.from(h), trace);
  }
  clone() {
    const copy = new _SymmetricState(Buffer.from(this.h), Buffer.from(this.ck), this.trace ? [...this.trace] : null);
    copy.cipher = this.cipher;
    return copy;
  }
  mark(step) {
    this.trace?.push({ step, h: this.h.toString("hex"), ck: this.ck.toString("hex"), k: this.cipher.keyBytes?.toString("hex") ?? null });
  }
  mixHash(data) {
    this.h = sha256(Buffer.concat([this.h, data]));
  }
  mixKey(ikm) {
    const [ck, key] = hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.cipher = new CipherState(key);
  }
  mixKeyAndHash(ikm) {
    const [ck, tempH, key] = hkdf(this.ck, ikm, 3);
    this.ck = ck;
    this.mixHash(tempH);
    this.cipher = new CipherState(key);
  }
  encryptAndHash(plaintext) {
    const out = this.cipher.encryptWithAd(this.h, plaintext);
    this.mixHash(out);
    return out;
  }
  decryptAndHash(ciphertext) {
    const out = this.cipher.decryptWithAd(this.h, ciphertext);
    this.mixHash(ciphertext);
    return out;
  }
  /** k_pc then k_cp. */
  split() {
    const [first, second] = hkdf(this.ck, Buffer.alloc(0), 2);
    return [new CipherState(first), new CipherState(second)];
  }
};
function initialized(transport, responderStatic, trace) {
  const state = SymmetricState.initialize(trace);
  state.mark("init");
  state.mixHash(prologue(transport));
  state.mark("prologue");
  state.mixHash(responderStatic);
  state.mark("s");
  return state;
}
var RecordCipher = class {
  #state;
  constructor(state) {
    this.#state = state;
  }
  get nonce() {
    return this.#state.nonce;
  }
  seal(plaintext) {
    if (plaintext.length > MAX_RECORD_PLAINTEXT) throw new NoiseError("record_too_large");
    return this.#state.encryptWithAd(Buffer.alloc(0), plaintext);
  }
  open(record) {
    if (record.length > MAX_RECORD_BYTES) throw new NoiseError("record_too_large");
    return this.#state.decryptWithAd(Buffer.alloc(0), record);
  }
};
function sessionKeys(state, side) {
  const [pc, cp] = state.split();
  const kPc = pc.keyBytes;
  const kCp = cp.keyBytes;
  return side === "phone" ? { send: new RecordCipher(pc), receive: new RecordCipher(cp), handshakeHash: state.h, kPc, kCp } : { send: new RecordCipher(cp), receive: new RecordCipher(pc), handshakeHash: state.h, kPc, kCp };
}
function encodePayload1(conn, app) {
  return Buffer.from(JSON.stringify({ v: 1, conn: b64u(conn), app }), "utf8");
}
function encodePayload2(conn) {
  return Buffer.from(JSON.stringify({ v: 1, conn }), "utf8");
}
function jsonObject(bytes) {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
var isConn = (value) => typeof value === "string" && fromB64u(value)?.length === CONN_BYTES;
function parsePayload1(bytes) {
  if (bytes.length > MAX_HANDSHAKE_PAYLOAD) return null;
  const value = jsonObject(bytes);
  if (!value || value.v !== 1 || !isConn(value.conn)) return null;
  if (value.app !== void 0 && (typeof value.app !== "string" || value.app.length > MAX_APP_CHARS)) return null;
  return { v: 1, conn: value.conn, ...typeof value.app === "string" ? { app: value.app } : {} };
}
function checkPayload2(bytes, conn) {
  const value = bytes.length <= MAX_HANDSHAKE_PAYLOAD ? jsonObject(bytes) : null;
  if (!value || value.v !== 1) return "version";
  return value.conn === conn ? "ok" : "conn";
}
function phoneHello(options, payload1, conn) {
  if (!isPublicKey(options.remoteStatic)) throw new NoiseError("bad_point");
  if (options.psk.length !== 32) throw new NoiseError("bad_psk");
  if (payload1.length > MAX_HANDSHAKE_PAYLOAD) throw new NoiseError("payload_too_large");
  const state = initialized(options.transport, options.remoteStatic, options.trace ?? null);
  state.mixKeyAndHash(options.psk);
  state.mark("msg1.psk");
  const e = options.ephemeral ?? generateKeyPair();
  state.mixHash(e.publicKey);
  state.mixKey(e.publicKey);
  state.mark("msg1.e");
  state.mixKey(dh(e.privateKey, options.remoteStatic));
  state.mark("msg1.es");
  const message1 = Buffer.concat([e.publicKey, state.encryptAndHash(payload1)]);
  state.mark("msg1.payload");
  let done = false;
  return {
    message1,
    finish(message2) {
      if (done) throw new NoiseError("finished");
      done = true;
      if (message2.length < PUBLIC_KEY_BYTES + TAG_BYTES || message2.length > MAX_HANDSHAKE_MESSAGE) throw new NoiseError("message2_size");
      const re = message2.subarray(0, PUBLIC_KEY_BYTES);
      const ee = dh(e.privateKey, re);
      state.mixHash(re);
      state.mixKey(re);
      state.mark("msg2.e");
      state.mixKey(ee);
      state.mark("msg2.ee");
      const payload2 = state.decryptAndHash(message2.subarray(PUBLIC_KEY_BYTES));
      state.mark("msg2.payload");
      const check = checkPayload2(payload2, conn);
      if (check !== "ok") throw new NoiseError(`payload2_${check}`);
      return sessionKeys(state, "phone");
    }
  };
}
function computerAccept(options, message1) {
  if (message1.length < PUBLIC_KEY_BYTES + TAG_BYTES || message1.length > MAX_HANDSHAKE_MESSAGE) return null;
  const re = message1.subarray(0, PUBLIC_KEY_BYTES);
  let es;
  try {
    es = dh(options.staticKey.privateKey, re);
  } catch {
    return null;
  }
  const base = initialized(options.transport, options.staticKey.publicKey, options.trace ?? null);
  let match = null;
  for (const candidate of options.candidates) {
    if (candidate.psk.length !== 32) continue;
    const state2 = base.clone();
    state2.mixKeyAndHash(candidate.psk);
    state2.mark("msg1.psk");
    state2.mixHash(re);
    state2.mixKey(re);
    state2.mark("msg1.e");
    state2.mixKey(es);
    state2.mark("msg1.es");
    try {
      const payload = state2.decryptAndHash(message1.subarray(PUBLIC_KEY_BYTES));
      state2.mark("msg1.payload");
      match ??= { id: candidate.id, state: state2, payload };
    } catch {
    }
  }
  if (!match) return null;
  const payload1 = parsePayload1(match.payload);
  if (!payload1) return null;
  const { state } = match;
  const e = options.ephemeral ?? generateKeyPair();
  state.mixHash(e.publicKey);
  state.mixKey(e.publicKey);
  state.mark("msg2.e");
  state.mixKey(dh(e.privateKey, re));
  state.mark("msg2.ee");
  const payload2 = options.payload2 ? options.payload2(payload1) : encodePayload2(payload1.conn);
  const message2 = Buffer.concat([e.publicKey, state.encryptAndHash(payload2)]);
  state.mark("msg2.payload");
  if (options.trace && state.trace) options.trace.splice(0, options.trace.length, ...state.trace);
  return { id: match.id, payload1, message2, keys: sessionKeys(state, "computer") };
}
var newConn = () => randomBytes(CONN_BYTES);

// modules/openmaus-protocol/vendor/companion/src/e2e/descriptor.ts
var DESCRIPTOR_VERSION = 1;
var MAX_DESCRIPTOR_CHARS = 1024;
var MAX_RELAY_NODES = 4;
var RELAY_HOST = /^relay[1-9][0-9]?\.openmausbot\.com$/;
function encodeDescriptor(descriptor) {
  const relay = descriptor.h && descriptor.r ? { h: descriptor.h, r: descriptor.r } : {};
  const json = JSON.stringify({ v: 1, k: descriptor.k, ...relay, ...descriptor.routes ? { routes: descriptor.routes } : {} });
  return b64u(Buffer.from(json, "utf8"));
}
function descriptorFor(transportPublicKey, relay, routes) {
  const base = relay && relay.nodes.length > 0 ? { v: 1, k: b64u(transportPublicKey), h: b64u(relay.hostId), r: [...relay.nodes] } : { v: 1, k: b64u(transportPublicKey) };
  return routes === "local" ? { ...base, routes: "local" } : base;
}
function parseDescriptor(input) {
  const reject = (reason) => ({ outcome: "reject", reason });
  let value = input;
  if (typeof input === "string") {
    if (input.length > MAX_DESCRIPTOR_CHARS) return reject("too_long");
    const bytes = fromB64u(input);
    if (!bytes) return reject("base64");
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      return reject("json");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject("json");
  const fields = value;
  if (!Number.isSafeInteger(fields.v) || fields.v < 1) return reject("version");
  if (fields.v > DESCRIPTOR_VERSION) return { outcome: "update" };
  const transportKey = typeof fields.k === "string" ? fromB64u(fields.k) : null;
  if (!transportKey || transportKey.length !== PUBLIC_KEY_BYTES || !isPublicKey(transportKey)) return reject("key");
  const hasHost = fields.h !== void 0;
  const hasRelays = fields.r !== void 0;
  if (hasHost !== hasRelays) return reject("relay_pair");
  if (fields.routes !== void 0 && fields.routes !== "any" && fields.routes !== "local") return reject("routes");
  const routes = fields.routes === void 0 ? {} : { routes: fields.routes };
  if (!hasHost) return { outcome: "ok", descriptor: { v: 1, k: fields.k, ...routes }, transportKey, hostId: null };
  const hostId = typeof fields.h === "string" ? fromB64u(fields.h) : null;
  if (!hostId || hostId.length !== HOST_ID_BYTES) return reject("host_id");
  const relays = fields.r;
  if (!Array.isArray(relays) || relays.length < 1 || relays.length > MAX_RELAY_NODES) return reject("relays");
  if (!relays.every((host) => typeof host === "string" && RELAY_HOST.test(host))) return reject("relay_host");
  return { outcome: "ok", descriptor: { v: 1, k: fields.k, h: fields.h, r: [...relays], ...routes }, transportKey, hostId };
}

// modules/openmaus-protocol/vendor/companion/src/e2e/yamux.ts
var VERSION = 0;
var TYPE = { data: 0, windowUpdate: 1, ping: 2, goAway: 3 };
var FLAG = { syn: 1, ack: 2, fin: 4, rst: 8 };
var KNOWN_FLAGS = 15;
var GO_AWAY = { normal: 0, protocol: 1, internal: 2, removed: 3 };
var HEADER_BYTES = 12;
var MAX_DATA_PAYLOAD = 65507;
var INITIAL_WINDOW = 256 * 1024;
var STREAM_WINDOW = 2 * 1024 * 1024;
var OPEN_WINDOW_DELTA = STREAM_WINDOW - INITIAL_WINDOW;
var WINDOW_UPDATE_AFTER = 1024 * 1024;
var MAX_STREAMS = 64;
var MAX_STREAM_ID = 2 ** 31 - 1;
var PING_INTERVAL_MS = 2e4;
var PING_TIMEOUT_MS = 1e4;
var YamuxError = class extends Error {
  reason;
  constructor(reason) {
    super(`yamux: ${reason}`);
    this.reason = reason;
  }
};
function encodeFrame(frame) {
  const payload = frame.type === TYPE.data ? frame.data ?? new Uint8Array(0) : new Uint8Array(0);
  if (frame.type === TYPE.data && payload.length !== frame.length) throw new YamuxError("data_length");
  if (payload.length > MAX_DATA_PAYLOAD) throw new YamuxError("data_too_large");
  const out = Buffer.alloc(HEADER_BYTES + payload.length);
  out.writeUInt8(VERSION, 0);
  out.writeUInt8(frame.type, 1);
  out.writeUInt16BE(frame.flags, 2);
  out.writeUInt32BE(frame.streamId, 4);
  out.writeUInt32BE(frame.length, 8);
  out.set(payload, HEADER_BYTES);
  return out;
}
function decodeFrame(bytes) {
  if (bytes.length < HEADER_BYTES) throw new YamuxError("short_frame");
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.readUInt8(0) !== VERSION) throw new YamuxError("version");
  const type = view.readUInt8(1);
  if (type > TYPE.goAway) throw new YamuxError("type");
  const flags = view.readUInt16BE(2);
  if ((flags & ~KNOWN_FLAGS) !== 0) throw new YamuxError("flags");
  const streamId = view.readUInt32BE(4);
  const length = view.readUInt32BE(8);
  if (type === TYPE.data) {
    if (length > MAX_DATA_PAYLOAD) throw new YamuxError("data_too_large");
    if (bytes.length !== HEADER_BYTES + length) throw new YamuxError("data_length");
    if (streamId === 0) throw new YamuxError("stream_zero");
    return { type, flags, streamId, length, data: view.subarray(HEADER_BYTES) };
  }
  if (bytes.length !== HEADER_BYTES) throw new YamuxError("trailing_bytes");
  if (type === TYPE.windowUpdate) {
    if (streamId === 0) throw new YamuxError("stream_zero");
  } else {
    if (streamId !== 0) throw new YamuxError("session_frame_stream");
    if (type === TYPE.ping && flags !== FLAG.syn && flags !== FLAG.ack) throw new YamuxError("ping_flags");
    if (type === TYPE.goAway && flags !== 0) throw new YamuxError("goaway_flags");
  }
  return { type, flags, streamId, length };
}
var openFrame = (streamId) => ({ type: TYPE.windowUpdate, flags: FLAG.syn, streamId, length: OPEN_WINDOW_DELTA });
var acceptFrame = (streamId) => ({ type: TYPE.windowUpdate, flags: FLAG.ack, streamId, length: OPEN_WINDOW_DELTA });
var resetFrame = (streamId) => ({ type: TYPE.windowUpdate, flags: FLAG.rst, streamId, length: 0 });
var finFrame = (streamId) => ({ type: TYPE.windowUpdate, flags: FLAG.fin, streamId, length: 0 });
var windowFrame = (streamId, delta) => ({ type: TYPE.windowUpdate, flags: 0, streamId, length: delta });
var dataFrame = (streamId, data, flags = 0) => ({ type: TYPE.data, flags, streamId, length: data.length, data });
var pingFrame = (value, flags = FLAG.syn) => ({ type: TYPE.ping, flags, streamId: 0, length: value >>> 0 });
var goAwayFrame = (code) => ({ type: TYPE.goAway, flags: 0, streamId: 0, length: code });
var Mux = class {
  role;
  #events;
  #streams = /* @__PURE__ */ new Map();
  /** The highest ID the phone has opened. */
  #highestId = 0;
  #peerGoneAway = false;
  #localGoneAway = false;
  constructor(role, events) {
    this.role = role;
    this.#events = events;
  }
  get activeStreams() {
    return this.#streams.size;
  }
  get peerGoneAway() {
    return this.#peerGoneAway;
  }
  has(streamId) {
    return this.#streams.has(streamId);
  }
  sendWindow(streamId) {
    return this.#streams.get(streamId)?.sendWindow ?? 0;
  }
  /** The phone side. Data may follow at once, within the first 256 KiB. */
  open() {
    if (this.role !== "phone") throw new YamuxError("computer_open");
    if (this.#localGoneAway || this.#peerGoneAway) throw new YamuxError("gone_away");
    if (this.#streams.size >= MAX_STREAMS) throw new YamuxError("too_many_streams");
    const streamId = this.#highestId === 0 ? 1 : this.#highestId + 2;
    if (streamId > MAX_STREAM_ID) throw new YamuxError("ids_exhausted");
    this.#highestId = streamId;
    this.#streams.set(streamId, {
      established: false,
      receiveWindow: INITIAL_WINDOW + OPEN_WINDOW_DELTA,
      sendWindow: INITIAL_WINDOW,
      uncredited: 0,
      localFin: false,
      remoteFin: false
    });
    this.#events.send(openFrame(streamId));
    return streamId;
  }
  /** The computer side, once the origin socket is connected. */
  accept(streamId) {
    const stream = this.#streams.get(streamId);
    if (!stream || stream.established || this.role !== "computer") return;
    stream.established = true;
    stream.receiveWindow += OPEN_WINDOW_DELTA;
    this.#events.send(acceptFrame(streamId));
  }
  /** Sends up to the window and the frame cap; returns the bytes taken. */
  write(streamId, data) {
    const stream = this.#streams.get(streamId);
    if (!stream || stream.localFin || this.role === "computer" && !stream.established) return 0;
    const size = Math.min(data.length, stream.sendWindow, MAX_DATA_PAYLOAD);
    if (size === 0) return 0;
    stream.sendWindow -= size;
    this.#events.send(dataFrame(streamId, data.subarray(0, size)));
    return size;
  }
  finish(streamId) {
    const stream = this.#streams.get(streamId);
    if (!stream || stream.localFin) return;
    stream.localFin = true;
    this.#events.send(finFrame(streamId));
    this.#closeIfDone(streamId, stream);
  }
  reset(streamId) {
    if (!this.#streams.delete(streamId)) return;
    this.#events.send(resetFrame(streamId));
    this.#events.reset(streamId);
  }
  /** The receiver handed `bytes` on (to the origin socket, or the HTTP stack). Grants them back in 1 MiB steps. */
  consumed(streamId, bytes) {
    const stream = this.#streams.get(streamId);
    if (!stream || stream.remoteFin) return;
    stream.uncredited += bytes;
    if (stream.uncredited < WINDOW_UPDATE_AFTER) return;
    const delta = stream.uncredited;
    stream.uncredited = 0;
    stream.receiveWindow += delta;
    this.#events.send(windowFrame(streamId, delta));
  }
  ping(value) {
    this.#events.send(pingFrame(value));
  }
  goAway(code = GO_AWAY.normal) {
    this.#localGoneAway = true;
    this.#events.send(goAwayFrame(code));
  }
  /** Sends GoAway(1); the caller closes with 4000. */
  protocolError() {
    this.goAway(GO_AWAY.protocol);
    this.closeAll();
  }
  closeAll() {
    const ids = [...this.#streams.keys()];
    this.#streams.clear();
    for (const id of ids) this.#events.reset(id);
  }
  receive(frame) {
    if (frame.type === TYPE.ping) {
      if (frame.flags === FLAG.syn) this.#events.send(pingFrame(frame.length, FLAG.ack));
      else this.#events.pong?.(frame.length);
      return;
    }
    if (frame.type === TYPE.goAway) {
      this.#peerGoneAway = true;
      this.#events.goAway?.(frame.length);
      return;
    }
    if (frame.flags & FLAG.syn) {
      this.#receiveOpen(frame);
      return;
    }
    if (frame.flags & FLAG.ack) {
      this.#receiveAck(frame);
      return;
    }
    const stream = this.#known(frame.streamId);
    if (!stream) return;
    this.#receiveOnStream(frame.streamId, stream, frame);
  }
  /** A stream that ended is ignored: an RST and the peer's last frames cross. An ID never opened is an error. */
  #known(streamId) {
    if (streamId % 2 === 0 || streamId > this.#highestId) throw new YamuxError("unknown_stream");
    return this.#streams.get(streamId) ?? null;
  }
  #receiveOpen(frame) {
    if (this.role === "phone") throw new YamuxError("computer_opened_stream");
    if (frame.type !== TYPE.windowUpdate || frame.flags !== FLAG.syn) throw new YamuxError("open_flags");
    if (frame.streamId % 2 === 0) throw new YamuxError("even_stream");
    if (frame.streamId <= this.#highestId) throw new YamuxError("stream_reused");
    this.#highestId = frame.streamId;
    if (this.#localGoneAway || this.#streams.size >= MAX_STREAMS) {
      this.#events.send(resetFrame(frame.streamId));
      return;
    }
    this.#streams.set(frame.streamId, {
      established: false,
      receiveWindow: INITIAL_WINDOW,
      sendWindow: INITIAL_WINDOW + frame.length,
      uncredited: 0,
      localFin: false,
      remoteFin: false
    });
    this.#events.opened?.(frame.streamId);
  }
  #receiveAck(frame) {
    if (this.role === "computer") throw new YamuxError("phone_ack");
    if (frame.type !== TYPE.windowUpdate || (frame.flags & ~(FLAG.ack | FLAG.fin | FLAG.rst)) !== 0) throw new YamuxError("ack_flags");
    const stream = this.#known(frame.streamId);
    if (!stream) return;
    if (stream.established) throw new YamuxError("duplicate_ack");
    stream.established = true;
    this.#events.accepted?.(frame.streamId);
    this.#receiveOnStream(frame.streamId, stream, { ...frame, flags: frame.flags & ~FLAG.ack });
  }
  #receiveOnStream(streamId, stream, frame) {
    if (frame.flags & FLAG.rst) {
      this.#streams.delete(streamId);
      this.#events.reset(streamId);
      return;
    }
    if (frame.type === TYPE.data) {
      if (stream.remoteFin && (frame.length > 0 || frame.flags & FLAG.fin)) throw new YamuxError("data_after_fin");
      if (frame.length > stream.receiveWindow) throw new YamuxError("window_exceeded");
      stream.receiveWindow -= frame.length;
      if (frame.length > 0) this.#events.data(streamId, frame.data);
    } else if (frame.length > 0) {
      stream.sendWindow += frame.length;
      this.#events.writable(streamId);
    }
    if (frame.flags & FLAG.fin) {
      if (stream.remoteFin) throw new YamuxError("data_after_fin");
      stream.remoteFin = true;
      this.#events.ended(streamId);
      this.#closeIfDone(streamId, stream);
    }
  }
  #closeIfDone(streamId, stream) {
    if (stream.localFin && stream.remoteFin) this.#streams.delete(streamId);
  }
};

// modules/openmaus-protocol/vendor/companion/src/e2e/session.ts
import { Duplex } from "node:stream";
var SEND_BUFFER_HIGH = 1024 * 1024;
var SessionClosed = class extends Error {
  code;
  constructor(code) {
    super(`e2e session closed (${code})`);
    this.code = code;
  }
};
var noop = () => {
};
var MuxStream = class extends Duplex {
  streamId;
  #session;
  #pending = null;
  #pendingDone = null;
  #ungranted = 0;
  constructor(session, streamId) {
    super({ allowHalfOpen: true, readableHighWaterMark: 256 * 1024 });
    this.#session = session;
    this.streamId = streamId;
    this.on("error", noop);
  }
  _write(chunk, _encoding, done) {
    this.#pending = chunk;
    this.#pendingDone = done;
    this.flush();
  }
  _final(done) {
    this.#session.mux?.finish(this.streamId);
    done();
  }
  _read() {
    if (this.#ungranted === 0) return;
    const bytes = this.#ungranted;
    this.#ungranted = 0;
    this.#session.mux?.consumed(this.streamId, bytes);
  }
  _destroy(error, done) {
    const mux = this.#session.mux;
    if (mux?.has(this.streamId)) mux.reset(this.streamId);
    this.#session.forget(this.streamId);
    const pendingDone = this.#pendingDone;
    this.#pending = null;
    this.#pendingDone = null;
    pendingDone?.(error ?? new Error("stream reset"));
    done(error);
  }
  /** Granted back as the reader takes it, so a slow reader slows the sender. */
  deliver(data) {
    if (this.push(data)) this.#session.mux?.consumed(this.streamId, data.length);
    else this.#ungranted += data.length;
  }
  remoteEnded() {
    this.push(null);
  }
  remoteReset() {
    if (!this.destroyed) this.destroy(new Error("stream reset"));
  }
  flush() {
    const mux = this.#session.mux;
    while (this.#pending && this.#pending.length > 0) {
      if (!mux || !mux.has(this.streamId)) return void this.destroy(new Error("stream reset"));
      if (this.#session.congested) return this.#session.whenDrained(() => this.flush());
      const taken = mux.write(this.streamId, this.#pending);
      if (taken === 0) return;
      this.#pending = this.#pending.subarray(taken);
    }
    const done = this.#pendingDone;
    this.#pending = null;
    this.#pendingDone = null;
    done?.();
  }
};
var E2ESession = class _E2ESession {
  role;
  #transport;
  #streams = /* @__PURE__ */ new Map();
  #timers;
  #state = "handshake";
  #keys = null;
  #mux = null;
  #accept = null;
  #deadline = null;
  #pingTimer = null;
  #pongTimer = null;
  #awaitingPong = null;
  #pingCounter = 0;
  #drainWaiters = [];
  #settleReady;
  #settleClosed;
  #connectOrigin = null;
  #removed = false;
  /** The computer side: which device (or pairing window) this is. */
  peer = null;
  ready;
  closed;
  constructor(role, transport, timers) {
    this.role = role;
    this.#transport = transport;
    this.#timers = {
      pingIntervalMs: timers.pingIntervalMs ?? PING_INTERVAL_MS,
      pingTimeoutMs: timers.pingTimeoutMs ?? PING_TIMEOUT_MS,
      handshakeDeadlineMs: timers.handshakeDeadlineMs ?? HANDSHAKE_DEADLINE_MS
    };
    this.ready = new Promise((resolve, reject) => {
      this.#settleReady = (error) => error ? reject(error) : resolve();
    });
    this.ready.catch(noop);
    this.closed = new Promise((resolve) => {
      this.#settleClosed = resolve;
    });
    this.#deadline = setTimeout(() => this.close(CLOSE.deadline), this.#timers.handshakeDeadlineMs);
    this.#deadline.unref?.();
  }
  /** Waits for message 1. Anything wrong with it closes 4001 and nothing else is sent. */
  static computer(options) {
    const session = new _E2ESession("computer", options.transport, options);
    session.#connectOrigin = options.connectOrigin;
    session.#accept = (message) => {
      const accepted = computerAccept({ staticKey: options.staticKey, transport: options.transportByte, candidates: options.candidates() }, message);
      if (!accepted) return session.close(CLOSE.rejected);
      options.transport.send(accepted.message2);
      session.peer = accepted.id;
      session.#start(accepted.keys);
      options.opened?.(accepted.id, accepted.payload1);
    };
    return session;
  }
  /** Sends message 1 now. `ready` rejects with a NoiseError when the computer can't be verified: a hard stop. */
  static phone(options) {
    const session = new _E2ESession("phone", options.transport, options);
    const conn = newConn();
    const hello = phoneHello(
      { remoteStatic: options.remoteStatic, psk: options.psk, transport: options.transportByte, ephemeral: options.ephemeral },
      encodePayload1(conn, options.app),
      b64u(conn)
    );
    session.#accept = (message) => {
      let keys;
      try {
        keys = hello.finish(message);
      } catch (error) {
        session.#settleReady(error);
        return session.close(CLOSE.protocol);
      }
      session.#start(keys);
    };
    options.transport.send(hello.message1);
    return session;
  }
  get mux() {
    return this.#mux;
  }
  /** The phone side: the computer said, inside the encryption, that this device was removed. Only this, or a 4001 on
   * a direct route, means "pair again"; a bare 4001 through the relay may be the relay's own and means "keep trying". */
  get removed() {
    return this.#removed;
  }
  get state() {
    return this.#state;
  }
  /** Records each way so far, for diagnostics. */
  get records() {
    return { sent: this.#keys?.send.nonce ?? 0, received: this.#keys?.receive.nonce ?? 0 };
  }
  get congested() {
    return this.#transport.bufferedAmount > SEND_BUFFER_HIGH;
  }
  get activeStreams() {
    return this.#streams.size;
  }
  whenDrained(listener) {
    this.#drainWaiters.push(listener);
    if (this.#drainWaiters.length > 1) return;
    this.#transport.onceDrained(() => {
      const waiters = this.#drainWaiters;
      this.#drainWaiters = [];
      for (const waiter of waiters) waiter();
    });
  }
  forget(streamId) {
    this.#streams.delete(streamId);
  }
  /** Every message the transport receives, in order. */
  receive(message, binary) {
    if (this.#state === "closed") return;
    if (this.#state === "handshake") {
      const accept = this.#accept;
      this.#accept = null;
      if (!binary || !accept) return this.close(this.role === "computer" ? CLOSE.rejected : CLOSE.protocol);
      return accept(Buffer.from(message));
    }
    if (!binary) return this.close(CLOSE.protocol);
    let plaintext;
    try {
      plaintext = this.#keys.receive.open(message);
    } catch {
      return this.close(CLOSE.protocol);
    }
    try {
      this.#mux.receive(decodeFrame(plaintext));
    } catch (error) {
      if (!(error instanceof YamuxError)) throw error;
      this.#mux?.protocolError();
      this.close(CLOSE.protocol);
    }
  }
  /** The phone side. */
  openStream() {
    if (this.#state !== "open" || !this.#mux) throw new SessionClosed(CLOSE.normal);
    const streamId = this.#mux.open();
    const stream = new MuxStream(this, streamId);
    this.#streams.set(streamId, stream);
    return stream;
  }
  /** The computer side: the device was removed. The phone hears it authenticated, then the 4001 close. */
  remove() {
    if (this.#state === "open") this.#mux?.goAway(GO_AWAY.removed);
    this.close(CLOSE.rejected);
  }
  /** A planned close (quit, sleep, restart): GoAway first, so the peer knows it isn't an error. */
  shutdown() {
    if (this.#state === "open") this.#mux?.goAway(GO_AWAY.normal);
    this.close(CLOSE.normal);
  }
  close(code, reason) {
    if (this.#state === "closed") return;
    this.#transport.close(code, reason);
    this.#end(code);
  }
  /** The transport closed under us. */
  transportClosed(code) {
    this.#end(code);
  }
  #end(code) {
    if (this.#state === "closed") return;
    const wasHandshake = this.#state === "handshake";
    this.#state = "closed";
    for (const timer of [this.#deadline, this.#pongTimer]) if (timer) clearTimeout(timer);
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#mux?.closeAll();
    for (const stream of this.#streams.values()) stream.remoteReset();
    this.#streams.clear();
    const waiters = this.#drainWaiters;
    this.#drainWaiters = [];
    for (const waiter of waiters) waiter();
    if (wasHandshake) this.#settleReady(new SessionClosed(code));
    this.#settleClosed(code);
  }
  #start(keys) {
    if (this.#deadline) clearTimeout(this.#deadline);
    this.#keys = keys;
    this.#state = "open";
    this.#mux = new Mux(this.role, {
      send: (frame) => this.#send(frame),
      opened: (streamId) => this.#openOrigin(streamId),
      data: (streamId, data) => this.#streams.get(streamId)?.deliver(Buffer.from(data.buffer, data.byteOffset, data.byteLength)),
      ended: (streamId) => this.#streams.get(streamId)?.remoteEnded(),
      reset: (streamId) => {
        const stream = this.#streams.get(streamId);
        this.#streams.delete(streamId);
        stream?.remoteReset();
      },
      writable: (streamId) => this.#streams.get(streamId)?.flush(),
      goAway: (code) => {
        if (code === GO_AWAY.removed && this.role === "phone") this.#removed = true;
        else if (code !== GO_AWAY.normal) this.close(CLOSE.protocol);
      },
      pong: (value) => {
        if (value !== this.#awaitingPong) return;
        this.#awaitingPong = null;
        if (this.#pongTimer) clearTimeout(this.#pongTimer);
      }
    });
    this.#pingTimer = setInterval(() => this.#ping(), this.#timers.pingIntervalMs);
    this.#pingTimer.unref?.();
    this.#settleReady();
  }
  #ping() {
    if (this.#awaitingPong !== null || !this.#mux) return;
    this.#pingCounter = this.#pingCounter + 1 >>> 0;
    this.#awaitingPong = this.#pingCounter;
    this.#mux.ping(this.#pingCounter);
    this.#pongTimer = setTimeout(() => this.close(CLOSE.goingAway), this.#timers.pingTimeoutMs);
    this.#pongTimer.unref?.();
  }
  #send(frame) {
    if (this.#state !== "open" || !this.#keys) return;
    let record;
    try {
      record = this.#keys.send.seal(encodeFrame(frame));
    } catch (error) {
      if (error instanceof NoiseError) return this.close(CLOSE.normal);
      throw error;
    }
    this.#transport.send(record);
    if (this.#keys.send.nonce >= NONCE_LIMIT - 1024) queueMicrotask(() => this.close(CLOSE.normal));
  }
  #openOrigin(streamId) {
    const stream = new MuxStream(this, streamId);
    this.#streams.set(streamId, stream);
    const connect = this.#connectOrigin;
    if (!connect) return void stream.destroy();
    connect().then(
      (socket) => {
        if (stream.destroyed || this.#state !== "open") return void socket.destroy();
        this.#mux?.accept(streamId);
        socket.on("error", () => stream.destroy());
        socket.on("close", () => {
          if (!socket.readableEnded) stream.destroy();
        });
        stream.on("close", () => socket.destroy());
        stream.pipe(socket);
        socket.pipe(stream);
      },
      () => stream.destroy()
    );
  }
};

// modules/openmaus-protocol/vendor/companion/src/e2e/phone.ts
var DIRECT_PROTOCOL = "omb-e2e.v1";
var RELAY_PROTOCOL = "omb-relay.v1";
var DRAIN_POLL_MS = 5;
var sendable = (code) => code === 1e3 || code >= 3e3 && code <= 4999;
function webSocketTransport(socket) {
  return {
    send: (message) => socket.send(message),
    close: (code, reason) => sendable(code) ? socket.close(code, reason) : socket.close(),
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    // The built-in client has no drain event.
    onceDrained(listener) {
      const check = () => {
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount <= SEND_BUFFER_HIGH / 4) listener();
        else setTimeout(check, DRAIN_POLL_MS);
      };
      check();
    }
  };
}
function dial(options) {
  const relayed = Boolean(options.relay);
  if (relayed && options.transportByte !== TRANSPORT_RELAY) throw new Error("the relay route uses the relay prologue");
  const socket = new WebSocket(options.url, [relayed ? RELAY_PROTOCOL : DIRECT_PROTOCOL]);
  socket.binaryType = "arraybuffer";
  const transport = webSocketTransport(socket);
  return new Promise((resolve, reject) => {
    let session = null;
    const timer = setTimeout(() => {
      reject(new SessionClosed(4002));
      socket.close();
    }, (options.timeoutMs ?? HANDSHAKE_DEADLINE_MS) + (relayed ? 1e4 : 0));
    const start = () => {
      session = E2ESession.phone({ ...options, transport });
      session.ready.then(
        () => {
          clearTimeout(timer);
          resolve(session);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    };
    socket.onopen = () => {
      if (!options.relay) return start();
      socket.send(JSON.stringify({ t: "phone", v: 1, hid: b64u(options.relay.hostId), adm: b64u(options.relay.adm) }));
    };
    socket.onmessage = (event) => {
      const binary = typeof event.data !== "string";
      const data = binary ? new Uint8Array(event.data) : Buffer.from(event.data, "utf8");
      if (session) return session.receive(data, binary);
      let ready = false;
      try {
        ready = !binary && JSON.parse(String(event.data)).t === "ready";
      } catch {
        ready = false;
      }
      if (!ready) {
        clearTimeout(timer);
        reject(new SessionClosed(4400));
        return socket.close();
      }
      start();
    };
    socket.onclose = (event) => {
      clearTimeout(timer);
      if (session) session.transportClosed(event.code);
      else reject(new SessionClosed(event.code));
    };
    socket.onerror = () => {
    };
  });
}
export {
  CLOSE,
  CONN_BYTES,
  CipherState,
  DESCRIPTOR_VERSION,
  DIRECT_PROTOCOL,
  E2ESession,
  FLAG,
  GO_AWAY,
  HANDSHAKE_DEADLINE_MS,
  HEADER_BYTES,
  HOST_ID_BYTES,
  INITIAL_WINDOW,
  KEY_ID_BYTES,
  MAX_APP_CHARS,
  MAX_DATA_PAYLOAD,
  MAX_DESCRIPTOR_CHARS,
  MAX_HANDSHAKE_MESSAGE,
  MAX_HANDSHAKE_PAYLOAD,
  MAX_RECORD_BYTES,
  MAX_RECORD_PLAINTEXT,
  MAX_RELAY_NODES,
  MAX_STREAMS,
  MAX_STREAM_ID,
  Mux,
  MuxStream,
  NONCE_LIMIT,
  NoiseError,
  OPEN_WINDOW_DELTA,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  PROTOCOL_NAME,
  PUBLIC_KEY_BYTES,
  RELAY_HOST,
  RELAY_PROTOCOL,
  RELAY_TOKEN_MAX_CHARS,
  RELAY_TOKEN_TTL_S,
  RecordCipher,
  SEND_BUFFER_HIGH,
  STREAM_WINDOW,
  SessionClosed,
  SymmetricState,
  TAG_BYTES,
  TRANSPORT_DIRECT,
  TRANSPORT_RELAY,
  TYPE,
  VERSION,
  WINDOW_UPDATE_AFTER,
  YamuxError,
  acceptFrame,
  admission,
  admissionHash,
  aeadOpen,
  aeadSeal,
  b64u,
  checkPayload2,
  computerAccept,
  credentialHash,
  credentialHashFromHex,
  dataFrame,
  decodeFrame,
  descriptorFor,
  dh,
  dial,
  ed25519PrivateKey,
  ed25519PublicKey,
  ed25519RawPublicKey,
  encodeDescriptor,
  encodeFrame,
  encodePayload1,
  encodePayload2,
  finFrame,
  fromB64u,
  generateKeyPair,
  goAwayFrame,
  hkdf,
  hmacSha256,
  isPublicKey,
  keyId,
  keyPairFromPrivate,
  mintRelayToken,
  newConn,
  nonceBytes,
  openFrame,
  parseDescriptor,
  parsePayload1,
  phoneHello,
  pingFrame,
  prologue,
  psk,
  resetFrame,
  sameBytes,
  sha256,
  verifyRelayToken,
  webSocketTransport,
  windowFrame
};
