// src/agent.ts
import { readFile as readFile9, writeFile as writeFile5, mkdir as mkdir7, rename, unlink as unlink5, stat as stat7, realpath as realpath7 } from "node:fs/promises";
import { join as join8, dirname as dirname2, resolve as resolve3 } from "node:path";
import { randomUUID as randomUUID7 } from "node:crypto";
import { spawn as spawn4, execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// src/protocol.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
var AGENT_VERSION = "0.1.3";
var AGENT_API_MAJOR = 1;
var AgentError = class extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
  code;
  status;
};
var fail = (code, status = 400) => {
  throw new AgentError(code, status);
};
var secret = () => randomBytes(32).toString("base64url");
var sha = (value) => createHash("sha256").update(value).digest("hex");
var matches = (value, digest2) => {
  const a = Buffer.from(sha(value), "hex"), b = Buffer.from(digest2, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}
function identifier(v) {
  if (typeof v !== "string" || !/^[-a-zA-Z0-9_.]{1,128}$/.test(v)) fail("INVALID_ID");
  return v;
}
function integer(v, min, max, defaultValue) {
  const n = v ?? defaultValue;
  if (!Number.isSafeInteger(n) || n < min || n > max) fail("INVALID_ARGUMENT");
  return n;
}
var CATALOG = Object.freeze([
  ["machine_ping", false],
  ["fs_list", false],
  ["fs_read", false],
  ["fs_write", true],
  ["shell_exec", true],
  // Versioned container-command Task backend. A distinct name means an older
  // Agent answers before any work instead of silently running a native shell.
  ["container_command_v1", true],
  ["cli_probe_v1", false],
  ["cli_task_v1", true],
  ["operation_status", false],
  ["operation_cancel", true],
  ["artifact_stat", false],
  ["artifact_read", false],
  ["worktree_create", true],
  ["worktree_diff", false],
  ["worktree_integrate", true],
  ["browser_open", true],
  ["browser_snapshot", false],
  ["browser_click", true],
  ["browser_type", true],
  ["browser_script", true],
  ["browser_upload", true],
  ["browser_download", true],
  ["browser_close", true],
  ["desktop_screenshot", true],
  ["desktop_click", true],
  ["desktop_type", true],
  ["desktop_key", true],
  ["desktop_scroll", true]
].map(([name, mutating]) => ({ name: String(name), mutating: Boolean(mutating), inputSchema: { type: "object", additionalProperties: true } })));
var TOOL_NAMES = CATALOG.map((x) => x.name);
var isMutating = (name) => CATALOG.find((x) => x.name === name)?.mutating ?? false;

// src/store.ts
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, unlinkSync, chmodSync, fstatSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { randomUUID as randomUUID2 } from "node:crypto";

// src/secure-pairing.ts
import { randomInt, randomUUID, timingSafeEqual as timingSafeEqual3 } from "node:crypto";

// ../modules/openmaus-protocol/dist/protocol.mjs
import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes as randomBytes2 } from "node:crypto";
import { createHash as createHash2, createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual as timingSafeEqual2, verify } from "node:crypto";
import { Duplex } from "node:stream";
var B64U = /^[A-Za-z0-9_-]*$/;
var b64u = (bytes) => Buffer.from(bytes).toString("base64url");
function fromB64u(text) {
  if (!B64U.test(text) || text.length % 4 === 1) return null;
  const bytes = Buffer.from(text, "base64url");
  return bytes.toString("base64url") === text ? bytes : null;
}
var sha256 = (bytes) => createHash2("sha256").update(bytes).digest();
var hmacSha256 = (key2, message) => createHmac("sha256", key2).update(message).digest();
var KEY_ID_BYTES = 16;
var PSK_LABEL = Buffer.from("omb-e2e psk v1", "utf8");
var ADMISSION_LABEL = Buffer.from("omb-relay admission v1", "utf8");
function credentialHashFromHex(hex) {
  return /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
}
var keyId = (transportPublicKey) => sha256(transportPublicKey).subarray(0, KEY_ID_BYTES);
var psk = (credHash, transportKeyId) => hmacSha256(credHash, Buffer.concat([PSK_LABEL, transportKeyId]));
var RELAY_TOKEN_TTL_S = 12 * 60 * 60;
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
function aeadSeal(key2, n, ad, plaintext) {
  const cipher = createCipheriv("aes-256-gcm", key2, nonceBytes(n), { authTagLength: TAG_BYTES });
  cipher.setAAD(ad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}
function aeadOpen(key2, n, ad, ciphertext) {
  if (ciphertext.length < TAG_BYTES) throw new NoiseError("short_ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key2, nonceBytes(n), { authTagLength: TAG_BYTES });
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
  constructor(key2 = null, n = 0) {
    this.#key = key2;
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
    const [ck, key2] = hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.cipher = new CipherState(key2);
  }
  mixKeyAndHash(ikm) {
    const [ck, tempH, key2] = hkdf(this.ck, ikm, 3);
    this.ck = ck;
    this.mixHash(tempH);
    this.cipher = new CipherState(key2);
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
var newConn = () => randomBytes2(CONN_BYTES);
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
    for (const id2 of ids) this.#events.reset(id2);
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
  _destroy(error2, done) {
    const mux = this.#session.mux;
    if (mux?.has(this.streamId)) mux.reset(this.streamId);
    this.#session.forget(this.streamId);
    const pendingDone = this.#pendingDone;
    this.#pending = null;
    this.#pendingDone = null;
    pendingDone?.(error2 ?? new Error("stream reset"));
    done(error2);
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
    this.ready = new Promise((resolve4, reject) => {
      this.#settleReady = (error2) => error2 ? reject(error2) : resolve4();
    });
    this.ready.catch(noop);
    this.closed = new Promise((resolve4) => {
      this.#settleClosed = resolve4;
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
      } catch (error2) {
        session.#settleReady(error2);
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
    } catch (error2) {
      if (!(error2 instanceof YamuxError)) throw error2;
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
    } catch (error2) {
      if (error2 instanceof NoiseError) return this.close(CLOSE.normal);
      throw error2;
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
var DIRECT_PROTOCOL = "omb-e2e.v1";

// src/secure-pairing.ts
var PAIRING_TTL_MS = 12e4;
var PAIRING_ATTEMPTS = 5;
var MAX_PAIRED_CLIENTS = 128;
var MAX_INVITES = 20;
var digestEqual = (a, b) => /^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{64}$/.test(b) && timingSafeEqual3(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
var nameOf = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60) || "DSH Host";
var SecurePairing = class {
  constructor(db, machineId, commitClient, now = Date.now) {
    this.db = db;
    this.machineId = machineId;
    this.commitClient = commitClient;
    this.now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS pairing_invites (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, token_digest TEXT NOT NULL, code_digest TEXT NOT NULL,
      expires_at INTEGER NOT NULL, attempts_left INTEGER NOT NULL, ceiling TEXT NOT NULL, name TEXT NOT NULL,
      consumed_request TEXT, consumed_at INTEGER
    ); CREATE INDEX IF NOT EXISTS pairing_invite_expiry ON pairing_invites(expires_at);`);
    const generated = generateKeyPair();
    db.prepare("INSERT OR IGNORE INTO meta VALUES (?,?)").run("e2eTransportPrivateKey", b64u(generated.privateKey));
    const stored = db.prepare("SELECT value FROM meta WHERE key=?").get("e2eTransportPrivateKey")?.value;
    if (typeof stored !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(stored)) fail("PAIRING_IDENTITY_INVALID");
    try {
      this.transportKey = keyPairFromPrivate(Buffer.from(stored, "base64url"));
    } catch {
      fail("PAIRING_IDENTITY_INVALID");
    }
  }
  db;
  machineId;
  commitClient;
  now;
  replay = /* @__PURE__ */ new Map();
  transportKey;
  identity() {
    return { kind: "noise-v1", publicKey: b64u(this.transportKey.publicKey), fingerprint: sha(this.transportKey.publicKey) };
  }
  create(clientId, ceiling, options) {
    identifier(clientId);
    let endpoint;
    try {
      endpoint = new URL(options.endpoint);
    } catch {
      fail("PAIRING_ENDPOINT_INVALID");
    }
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.href.length > 1024) fail("PAIRING_ENDPOINT_INVALID");
    const now = this.now(), token = `dsh_pair_${secret()}`, code = String(randomInt(1e6)).padStart(6, "0"), id2 = `invite-${randomUUID()}`;
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM pairing_invites WHERE expires_at<=?").run(now - PAIRING_TTL_MS);
      if (this.db.prepare("SELECT 1 FROM clients WHERE id=? AND revoked=0").get(clientId)) fail("CLIENT_ALREADY_PAIRED", 409);
      if (this.db.prepare("SELECT count(*) AS n FROM clients WHERE revoked=0").get().n >= MAX_PAIRED_CLIENTS) fail("PAIRING_DEVICE_LIMIT", 429);
      this.db.prepare("UPDATE pairing_invites SET attempts_left=0 WHERE client_id=? AND consumed_request IS NULL").run(clientId);
      if (this.db.prepare("SELECT count(*) AS n FROM pairing_invites WHERE expires_at>? AND attempts_left>0 AND consumed_request IS NULL").get(now).n >= MAX_INVITES) fail("PAIRING_WINDOW_LIMIT", 429);
      this.db.prepare("INSERT INTO pairing_invites VALUES (?,?,?,?,?,?,?,?,NULL,NULL)").run(id2, clientId, sha(token), sha(code), now + PAIRING_TTL_MS, PAIRING_ATTEMPTS, canonical(ceiling), nameOf(options.name));
      return {
        format: "dsh-pairing-invite",
        version: 2,
        inviteId: id2,
        machineId: this.machineId,
        clientId,
        name: nameOf(options.name),
        endpoint: endpoint.origin,
        expiresAt: now + PAIRING_TTL_MS,
        token,
        code,
        transport: this.identity(),
        ceiling: structuredClone(ceiling)
      };
    }).immediate();
  }
  candidates() {
    const now = this.now(), transportId = keyId(this.transportKey.publicKey);
    for (const [id2, row] of this.replay) if (row.expiresAt <= now) this.replay.delete(id2);
    const invites = this.db.prepare("SELECT id,token_digest FROM pairing_invites WHERE expires_at>? AND attempts_left>0").all(now).map((row) => ({ id: { kind: "invite", id: row.id, digest: row.token_digest }, hash: row.token_digest }));
    const clients = this.db.prepare("SELECT id,digest,revision FROM clients WHERE revoked=0").all().map((row) => ({ id: { kind: "client", id: row.id, digest: row.digest, revision: row.revision }, hash: row.digest }));
    if (clients.length > MAX_PAIRED_CLIENTS) fail("PAIRING_DEVICE_LIMIT", 429);
    return [...invites, ...clients].map((row) => ({ id: row.id, psk: psk(credentialHashFromHex(row.hash), transportId) }));
  }
  validPeer(peer) {
    if (peer.kind === "client") {
      const client = this.db.prepare("SELECT digest,revision,revoked FROM clients WHERE id=?").get(peer.id);
      return Boolean(client && !client.revoked && client.revision === peer.revision && digestEqual(client.digest, peer.digest));
    }
    const invite = this.db.prepare("SELECT token_digest,expires_at,attempts_left FROM pairing_invites WHERE id=?").get(peer.id);
    return Boolean(invite && invite.expires_at > this.now() && invite.attempts_left > 0 && digestEqual(invite.token_digest, peer.digest));
  }
  redeem(peer, input) {
    if (peer.kind !== "invite" || !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key2) => !["requestId", "code"].includes(key2)) || typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) fail("PAIRING_REQUEST_INVALID");
    const now = this.now();
    const decision = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM pairing_invites WHERE id=?").get(peer.id);
      if (!row || !digestEqual(row.token_digest, peer.digest) || row.expires_at <= now || row.attempts_left <= 0) return { error: "PAIRING_WINDOW_CLOSED" };
      if (!digestEqual(row.code_digest, sha(input.code))) {
        this.db.prepare("UPDATE pairing_invites SET attempts_left=attempts_left-1 WHERE id=?").run(peer.id);
        return { error: "PAIRING_CODE_INVALID" };
      }
      if (row.consumed_request !== null) {
        const cached = this.replay.get(row.id), client = this.db.prepare("SELECT digest,revoked FROM clients WHERE id=?").get(row.client_id);
        if (row.consumed_request !== input.requestId || !cached || cached.expiresAt <= now || cached.proof !== peer.digest || cached.requestId !== input.requestId) return { error: "PAIRING_ALREADY_REDEEMED" };
        if (!client || client.revoked || !digestEqual(client.digest, sha(cached.result.token))) return { error: "PAIRING_DEVICE_CHANGED" };
        return { result: structuredClone(cached.result), ceiling: JSON.parse(row.ceiling), recovered: true };
      }
      const result = this.commitClient(row.client_id, JSON.parse(row.ceiling));
      this.db.prepare("UPDATE pairing_invites SET consumed_request=?,consumed_at=? WHERE id=?").run(input.requestId, now, row.id);
      this.replay.set(row.id, { proof: peer.digest, requestId: input.requestId, expiresAt: row.expires_at, result: structuredClone(result) });
      return { result, ceiling: JSON.parse(row.ceiling), recovered: false };
    }).immediate();
    if (decision.error) fail(decision.error, 403);
    return { ...decision.result, transport: this.identity(), ceiling: decision.ceiling, recovered: decision.recovered };
  }
  invalidate(clientId) {
    this.db.prepare("UPDATE pairing_invites SET attempts_left=0 WHERE client_id=?").run(clientId);
    for (const [id2, row] of this.replay) if (row.result.clientId === clientId) this.replay.delete(id2);
  }
  close() {
    this.replay.clear();
  }
};

// src/store.ts
var Store = class {
  constructor(dataDir, Database, options = {}) {
    this.dataDir = dataDir;
    this.admin = options.admin === true;
    mkdirSync(dataDir, { recursive: true, mode: 448 });
    chmodSync(dataDir, 448);
    this.lockPath = join(dataDir, "agent.lock");
    try {
      const Driver = Database ?? createRequire(import.meta.url)("better-sqlite3");
      if (!options.admin) {
        const guardPath = join(dataDir, "agent-instance.sqlite");
        try {
          const s = lstatSync(guardPath);
          if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) fail("AGENT_LOCKED");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        this.controllerGuard = new Driver(guardPath);
        this.controllerGuard.pragma("busy_timeout = 0");
        try {
          this.controllerGuard.exec("BEGIN IMMEDIATE");
        } catch (e) {
          if (e.code?.startsWith("SQLITE_BUSY") || e.code?.startsWith("SQLITE_LOCKED")) fail("AGENT_LOCKED");
          throw e;
        }
        try {
          this.lockFd = openSync(this.lockPath, "wx", 384);
        } catch {
          let old;
          try {
            old = JSON.parse(readFileSync(this.lockPath, "utf8"));
          } catch {
            fail("AGENT_LOCKED");
          }
          if (!Number.isSafeInteger(old?.pid) || old.pid <= 0 || typeof old.instanceId !== "string" || !old.instanceId) fail("AGENT_LOCKED");
          try {
            process.kill(old.pid, 0);
            fail("AGENT_LOCKED");
          } catch (e) {
            if (e.code !== "ESRCH") throw e;
          }
          unlinkSync(this.lockPath);
          this.lockFd = openSync(this.lockPath, "wx", 384);
        }
        writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid, instanceId: randomUUID2() }));
      }
      this.db = new Driver(join(dataDir, "agent.sqlite"));
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = FULL");
      this.db.pragma("busy_timeout = 5000");
      this.db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,digest TEXT NOT NULL,revision INTEGER NOT NULL,revoked INTEGER NOT NULL,ceiling TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS grants(digest TEXT PRIMARY KEY,context TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS grants_identity ON grants(json_extract(context,'$.grantId'));
        CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,digest TEXT NOT NULL,context TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER,result TEXT,error TEXT);
        CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,context TEXT NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL,media TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS worktrees(id TEXT PRIMARY KEY,context TEXT NOT NULL,root TEXT NOT NULL,path TEXT NOT NULL,head TEXT NOT NULL,source TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time INTEGER NOT NULL,code TEXT NOT NULL,actor TEXT,operation TEXT);`);
      this.db.prepare("INSERT OR IGNORE INTO meta VALUES (?,?)").run("machineId", `machine-${randomUUID2()}`);
      this.machineId = this.db.prepare("SELECT value FROM meta WHERE key=?").get("machineId").value;
      this.pairing = new SecurePairing(this.db, this.machineId, (id2, ceiling) => this.commitClient(id2, ceiling));
      if (!options.admin) this.db.prepare("UPDATE operations SET status='unknown',error='OUTCOME_UNKNOWN' WHERE status IN ('admitted','running','cancel_pending')").run();
      if (!options.admin) this.db.prepare("DELETE FROM grants").run();
    } catch (e) {
      try {
        this.db?.close();
      } catch {
      }
      ;
      this.releaseController();
      throw e;
    }
  }
  dataDir;
  pairing;
  db;
  machineId;
  lockFd;
  lockPath;
  controllerGuard;
  closed = false;
  admin = false;
  releaseController() {
    try {
      if (this.lockFd !== void 0) {
        let same = false;
        try {
          const fd = fstatSync(this.lockFd), named = lstatSync(this.lockPath);
          same = fd.dev === named.dev && fd.ino === named.ino && !named.isSymbolicLink();
        } catch {
        }
        closeSync(this.lockFd);
        this.lockFd = void 0;
        if (same) try {
          unlinkSync(this.lockPath);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
    } finally {
      if (this.controllerGuard) {
        try {
          this.controllerGuard.exec("ROLLBACK");
        } catch {
        }
        ;
        this.controllerGuard.close();
        this.controllerGuard = void 0;
      }
    }
  }
  approvedCeiling(id2, ceiling) {
    identifier(id2);
    if (!ceiling || ceiling.hostManagedBots !== void 0 && typeof ceiling.hostManagedBots !== "boolean" || !Array.isArray(ceiling.botIds ?? []) || !Array.isArray(ceiling.roots) || !ceiling.roots.length || !Array.isArray(ceiling.tools) || !ceiling.tools.length || ceiling.tools.some((x) => !TOOL_NAMES.includes(x))) fail("INVALID_CEILING");
    const managed = ceiling.hostManagedBots === true, botIds = ceiling.botIds ?? [];
    if (managed && !this.admin) fail("ADMIN_REQUIRED", 403);
    if (!managed && !botIds.length) fail("INVALID_CEILING");
    botIds.forEach(identifier);
    ceiling.roots.forEach(identifier);
    const saved = { botIds, roots: ceiling.roots, tools: ceiling.tools, ...managed ? { hostManagedBots: true } : {} };
    return saved;
  }
  commitClient(id2, ceiling) {
    return this.db.transaction(() => {
      const previous = this.db.prepare("SELECT revoked FROM clients WHERE id=?").get(id2);
      if (previous && !previous.revoked) fail("CLIENT_ALREADY_PAIRED", 409);
      if (this.db.prepare("SELECT count(*) AS n FROM clients WHERE revoked=0").get().n >= MAX_PAIRED_CLIENTS) fail("PAIRING_DEVICE_LIMIT", 429);
      const token = secret();
      if (previous) this.db.prepare("UPDATE clients SET digest=?,revision=revision+1,revoked=0,ceiling=? WHERE id=? AND revoked=1").run(sha(token), canonical(ceiling), id2);
      else this.db.prepare("INSERT INTO clients VALUES (?,?,1,0,?)").run(id2, sha(token), canonical(ceiling));
      return { clientId: id2, token, machineId: this.machineId, secretRef: `remote-agent/${this.machineId}/${id2}`, hostManagedBots: ceiling.hostManagedBots === true };
    }).immediate();
  }
  pair(id2, ceiling) {
    return this.commitClient(id2, this.approvedCeiling(id2, ceiling));
  }
  invite(id2, ceiling, options) {
    if (!this.admin) fail("ADMIN_REQUIRED", 403);
    return this.pairing.create(id2, this.approvedCeiling(id2, ceiling), options);
  }
  client(token) {
    if (typeof token !== "string" || token.length > 256) fail("AUTH_INVALID", 401);
    const row = this.db.prepare("SELECT * FROM clients WHERE digest=?").get(sha(token));
    const verified = matches(token, row?.digest ?? "0".repeat(64));
    if (!verified || !row || row.revoked) fail("AUTH_INVALID", 401);
    return row;
  }
  rotate(id2) {
    return this.db.transaction(() => {
      identifier(id2);
      const row = this.db.prepare("SELECT revoked FROM clients WHERE id=?").get(id2);
      if (!row) fail("AUTH_INVALID", 401);
      if (row.revoked && this.db.prepare("SELECT count(*) AS n FROM clients WHERE revoked=0").get().n >= MAX_PAIRED_CLIENTS) fail("PAIRING_DEVICE_LIMIT", 429);
      const token = secret();
      this.db.prepare("UPDATE clients SET digest=?,revision=revision+1,revoked=0 WHERE id=?").run(sha(token), id2);
      this.pairing.invalidate(id2);
      return { clientId: id2, token };
    }).immediate();
  }
  revoke(id2) {
    this.db.prepare("UPDATE clients SET revoked=1,revision=revision+1 WHERE id=?").run(identifier(id2));
    this.pairing.invalidate(id2);
  }
  currentClient(client) {
    const row = this.db.prepare("SELECT * FROM clients WHERE id=?").get(client?.id);
    if (!row || row.revoked || row.revision !== client.revision || row.digest !== client.digest) fail("AUTH_INVALID", 401);
    return row;
  }
  issue(client, request) {
    client = this.currentClient(client);
    const ceiling = JSON.parse(client.ceiling);
    for (const key2 of ["botId", "taskId", "attemptId"]) identifier(request[key2]);
    if (ceiling.hostManagedBots !== true && !ceiling.botIds.includes(request.botId) || !Array.isArray(request.roots) || !Array.isArray(request.tools) || request.roots.some((x) => !ceiling.roots.includes(x)) || request.tools.some((x) => !ceiling.tools.includes(x))) fail("SCOPE_DENIED", 403);
    const ttl = request.ttlMs ?? 3e5;
    if (!Number.isSafeInteger(ttl) || ttl < 1e3 || ttl > 3e5) fail("INVALID_ARGUMENT");
    this.db.prepare("DELETE FROM grants WHERE json_extract(context,'$.expiresAt')<=?").run(Date.now());
    if (this.db.prepare("SELECT count(*) AS count FROM grants").get().count >= 4096) fail("GRANT_LIMIT", 429);
    const context = { clientId: client.id, botId: request.botId, taskId: request.taskId, attemptId: request.attemptId, roots: request.roots, tools: request.tools, expiresAt: Date.now() + ttl, revision: client.revision, grantId: randomUUID2() };
    const token = secret();
    this.db.prepare("INSERT INTO grants VALUES (?,?)").run(sha(token), canonical(context));
    return { grantToken: token, machineId: this.machineId, agentApiMajor: 1, ...context };
  }
  grant(token) {
    if (typeof token !== "string" || token.length > 256) fail("AUTH_INVALID", 401);
    const row = this.db.prepare("SELECT digest,context FROM grants WHERE digest=?").get(sha(token));
    const verified = matches(token, row?.digest ?? "0".repeat(64));
    if (!verified || !row) fail("AUTH_INVALID", 401);
    const context = JSON.parse(row.context);
    this.validate(context);
    return context;
  }
  validate(c) {
    const row = this.db.prepare("SELECT revision,revoked FROM clients WHERE id=?").get(c.clientId);
    if (!row || row.revoked || row.revision !== c.revision || c.expiresAt <= Date.now() || !c.grantId || !this.db.prepare("SELECT 1 FROM grants WHERE json_extract(context,'$.grantId')=?").get(c.grantId)) fail("GRANT_REVOKED", 403);
  }
  revokeGrants(client, request) {
    client = this.currentClient(client);
    identifier(request.botId);
    const ceiling = JSON.parse(client.ceiling);
    if (ceiling.hostManagedBots !== true && !ceiling.botIds.includes(request.botId)) fail("SCOPE_DENIED", 403);
    const result = this.db.prepare("DELETE FROM grants WHERE json_extract(context,'$.clientId')=? AND json_extract(context,'$.botId')=?").run(client.id, request.botId);
    return { machineId: this.machineId, agentApiMajor: 1, revoked: result.changes, botId: request.botId };
  }
  admit(id2, context, tool, args) {
    identifier(id2);
    const digest2 = sha(canonical({ clientId: context.clientId, botId: context.botId, taskId: context.taskId, attemptId: context.attemptId, tool, args }));
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM operations WHERE id=?").get(id2);
      if (row) {
        if (row.digest !== digest2) fail("OPERATION_CONFLICT", 409);
        return { fresh: false, operation: this.decode(row) };
      }
      this.db.prepare("INSERT INTO operations(id,digest,context,tool,status,started) VALUES (?,?,?,?,'admitted',?)").run(id2, digest2, canonical(context), tool, Date.now());
      return { fresh: true, operation: this.status(id2, context) };
    })();
  }
  own(saved, c) {
    const v = JSON.parse(saved);
    if (v.clientId !== c.clientId || v.botId !== c.botId || v.taskId !== c.taskId || v.attemptId !== c.attemptId) fail("SCOPE_DENIED", 403);
  }
  status(id2, c) {
    const row = this.db.prepare("SELECT * FROM operations WHERE id=?").get(identifier(id2));
    if (!row) fail("OPERATION_NOT_FOUND", 404);
    this.own(row.context, c);
    return this.decode(row);
  }
  decode(row) {
    return { schemaVersion: 1, machineId: this.machineId, operationId: row.id, tool: row.tool, status: row.status, startedAt: new Date(row.started).toISOString(), finishedAt: row.finished ? new Date(row.finished).toISOString() : null, result: row.result ? JSON.parse(row.result) : null, error: row.error ? { code: row.error } : null };
  }
  finish(id2, status, result = null, error2 = null) {
    this.db.prepare("UPDATE operations SET status=?,result=?,error=?,finished=? WHERE id=?").run(status, result === null ? null : canonical(result), error2, Date.now(), id2);
  }
  running(id2) {
    this.db.prepare("UPDATE operations SET status='running' WHERE id=? AND status='admitted'").run(id2);
  }
  audit(code, actor = null, operation = null) {
    this.db.prepare("INSERT INTO audit(time,code,actor,operation) VALUES (?,?,?,?)").run(Date.now(), code, actor, operation);
    this.db.prepare("DELETE FROM audit WHERE id < (SELECT max(id)-10000 FROM audit)").run();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.pairing?.close();
    try {
      this.db.close();
    } finally {
      this.releaseController();
    }
  }
};

// src/scope.ts
import { constants } from "node:fs";
import { lstat, realpath, open, stat, readdir } from "node:fs/promises";
import path from "node:path";
var Roots = class {
  constructor(roots, options = {}) {
    this.roots = roots;
    this.protectedPaths = (options.protectedPaths ?? []).map((p) => path.resolve(p));
    this.identityScanLimit = options.identityScanLimit ?? 8192;
    if (!Number.isSafeInteger(this.identityScanLimit) || this.identityScanLimit < 1 || this.identityScanLimit > 65536) throw new Error("Invalid identity scan limit");
  }
  roots;
  protectedPaths;
  identityScanLimit;
  inside(base, target) {
    const rel = path.relative(base, target);
    return rel === "" || !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
  }
  async actual(p) {
    try {
      return await realpath(p);
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
      const parent = path.dirname(p);
      if (parent === p) throw e;
      return path.join(await this.actual(parent), path.basename(p));
    }
  }
  async reserved() {
    const entries = new Set(this.protectedPaths);
    for (const p of this.protectedPaths) entries.add(await this.actual(p));
    return [...entries];
  }
  identity(s) {
    return `${s.dev}:${s.ino}`;
  }
  async privateIdentity(s) {
    if (!s.isFile() || s.nlink < 2 || !this.protectedPaths.length) return false;
    const wanted = this.identity(s), seen = /* @__PURE__ */ new Set(), stack = [...this.protectedPaths];
    let count2 = 0;
    while (stack.length) {
      if (++count2 > this.identityScanLimit) fail("PRIVATE_PATH_UNVERIFIED", 403);
      const p = stack.pop();
      let item;
      try {
        item = await stat(p);
      } catch (e) {
        if (e.code === "ENOENT" || e.code === "ENOTDIR") continue;
        fail("PRIVATE_PATH_UNVERIFIED", 403);
      }
      const id2 = this.identity(item);
      if (id2 === wanted) return true;
      if (seen.has(id2)) continue;
      seen.add(id2);
      if (item.isDirectory()) {
        let names;
        try {
          names = await readdir(p);
        } catch {
          fail("PRIVATE_PATH_UNVERIFIED", 403);
        }
        if (names.length + count2 + stack.length > this.identityScanLimit) fail("PRIVATE_PATH_UNVERIFIED", 403);
        for (const name of names) stack.push(path.join(p, name));
      }
    }
    return false;
  }
  async allowed(target, create = false, descriptor) {
    const actual = await this.actual(target), reserved = await this.reserved();
    if (reserved.some((p) => this.inside(p, target) || this.inside(p, actual) || create && (this.inside(target, p) || this.inside(actual, p)))) fail("WORKSPACE_PRIVATE_PATH", 403);
    let s = descriptor;
    if (!s) try {
      s = await stat(target);
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
    }
    if (s && await this.privateIdentity(s)) fail("WORKSPACE_PRIVATE_PATH", 403);
  }
  async assertPublicTree(target) {
    await this.allowed(target, true);
  }
  async assertContainerTree(target) {
    const stack = [target];
    let count2 = 0;
    while (stack.length) {
      if (++count2 > this.identityScanLimit) fail("PRIVATE_PATH_UNVERIFIED", 403);
      const current = stack.pop(), before = await lstat(current);
      if (before.isSymbolicLink()) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
      await this.allowed(current, true, before);
      if (before.isDirectory()) {
        const names = await readdir(current);
        if (names.length + count2 + stack.length > this.identityScanLimit) fail("PRIVATE_PATH_UNVERIFIED", 403);
        for (const name of names) stack.push(path.join(current, name));
      } else if (!before.isFile()) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
    }
  }
  async resolve(rootId, relativePath = "", create = false) {
    const configured = Object.hasOwn(this.roots, rootId) ? this.roots[rootId] : void 0;
    if (!configured || typeof relativePath !== "string" || relativePath.includes("\0") || path.isAbsolute(relativePath) || /^[a-zA-Z]:|^[/\\]{2}|[:]/.test(relativePath)) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
    const base = await realpath(configured);
    const parts = relativePath.split(/[\\/]/).filter(Boolean);
    if (parts.some((x) => x === ".." || x === "." || /[. ]$/.test(x))) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
    let target = base;
    for (let i = 0; i < parts.length; i++) {
      target = path.join(target, parts[i]);
      try {
        const s = await lstat(target);
        if (s.isSymbolicLink()) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
        const actual = await realpath(target);
        if (!this.inside(base, actual)) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
      } catch (e) {
        if (e.code === "ENOENT" && create && i === parts.length - 1) break;
        throw e;
      }
    }
    if (!this.inside(base, target)) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
    await this.allowed(target, create);
    return target;
  }
  async read(root, relative2, offset, length) {
    const target = await this.resolve(root, relative2);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile()) fail("NOT_A_FILE");
      const resolved = await this.resolve(root, relative2), after = await stat(resolved);
      if (before.ino !== after.ino || before.dev !== after.dev) fail("FILE_CHANGED", 409);
      await this.allowed(resolved, false, before);
      if (process.platform === "linux") {
        const actual = await realpath(`/proc/self/fd/${handle.fd}`), base = await realpath(this.roots[root]);
        if (!this.inside(base, actual)) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
        await this.allowed(actual, false, before);
      }
      const data = Buffer.alloc(Math.min(length, Math.max(0, before.size - offset)));
      const { bytesRead } = await handle.read(data, 0, data.length, offset);
      return { data: data.subarray(0, bytesRead), size: before.size };
    } finally {
      await handle.close();
    }
  }
  async list(root, relative2) {
    const target = await this.resolve(root, relative2), entries = await readdir(target, { withFileTypes: true }), visible = [];
    for (const entry of entries) {
      try {
        await this.allowed(path.join(target, entry.name));
        visible.push(entry);
      } catch (e) {
        if (!["WORKSPACE_PRIVATE_PATH", "PRIVATE_PATH_UNVERIFIED"].includes(e.code)) throw e;
      }
    }
    return visible;
  }
};

// src/browser.ts
import { randomUUID as randomUUID3, createHash as createHash3 } from "node:crypto";
import { access, mkdir, readFile, stat as stat2, unlink } from "node:fs/promises";
import { join as join2 } from "node:path";
var BrowserTools = class {
  constructor(origins, executablePath, loader = () => import("playwright"), profileRoots = {}) {
    this.origins = origins;
    this.executablePath = executablePath;
    this.loader = loader;
    this.profileRoots = profileRoots;
  }
  origins;
  executablePath;
  loader;
  profileRoots;
  browser;
  sessions = /* @__PURE__ */ new Map();
  profiles = /* @__PURE__ */ new Map();
  async probe() {
    try {
      await this.loader();
      if (this.executablePath) await access(this.executablePath);
      return { status: this.browser?.isConnected() ? "ready" : "dependency-ready", launchStatus: this.browser?.isConnected() ? "verified" : "unverified", engine: "chromium", isolation: "browser-context", allowedOrigins: this.origins, persistentProfiles: Object.keys(this.profileRoots).sort() };
    } catch {
      return { status: "unavailable", code: "TOOL_NOT_READY" };
    }
  }
  allowed(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      fail("URL_OUTSIDE_SCOPE", 403);
    }
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || !this.origins.includes(u.origin)) fail("URL_OUTSIDE_SCOPE", 403);
  }
  async run(name, a, c) {
    if (name === "browser_open") {
      this.allowed(a.url);
      if (this.sessions.size >= 16) fail("BROWSER_LIMIT", 429);
      let pw;
      try {
        pw = await this.loader();
      } catch {
        fail("TOOL_NOT_READY", 503);
      }
      let context, persistent = false, profileId = null;
      if (a.profileId !== void 0) {
        const root = this.profileRoots[a.profileId];
        if (!root) fail("BROWSER_PROFILE_DENIED", 403);
        const owner = JSON.stringify([c.clientId, c.botId, a.profileId]), key2 = createHash3("sha256").update(owner).digest("hex");
        try {
          context = this.profiles.get(key2);
          if (!context) {
            const dataDir = join2(root, key2);
            await mkdir(dataDir, { recursive: true, mode: 448 });
            context = await pw.chromium.launchPersistentContext(dataDir, { headless: true, executablePath: this.executablePath, acceptDownloads: true, serviceWorkers: "block" });
            this.profiles.set(key2, context);
          }
          persistent = true;
          profileId = a.profileId;
        } catch {
          fail("BROWSER_PROFILE_UNAVAILABLE", 503);
        }
      } else {
        try {
          this.browser ??= await pw.chromium.launch({ headless: true, executablePath: this.executablePath });
          context = await this.browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
        } catch {
          fail("TOOL_NOT_READY", 503);
        }
      }
      await context.route("**/*", async (route) => {
        try {
          this.allowed(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      const page = await context.newPage();
      page.on("popup", (p) => void p.close());
      const id2 = `browser-${randomUUID3()}`, downloads = /* @__PURE__ */ new Map();
      page.on("download", (download2) => {
        const downloadId2 = `download-${randomUUID3()}`;
        downloads.set(downloadId2, { download: download2, path: download2.path(), suggestedFilename: download2.suggestedFilename() });
      });
      this.sessions.set(id2, { context, page, owner: JSON.stringify([c.clientId, c.botId, c.taskId, c.attemptId]), revision: null, persistent, profileId, downloads });
      try {
        await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 3e4 });
        return { browserSessionId: id2, url: page.url(), browserVersion: this.browser?.version() ?? "chromium", persistent, profileId };
      } catch {
        this.sessions.delete(id2);
        persistent ? await page.close() : await context.close();
        fail("BROWSER_NAVIGATION_FAILED");
      }
    }
    const session = this.sessions.get(a.browserSessionId);
    if (!session) fail("BROWSER_SESSION_NOT_FOUND", 404);
    if (session.owner !== JSON.stringify([c.clientId, c.botId, c.taskId, c.attemptId])) fail("SCOPE_DENIED", 403);
    if (name === "browser_close") {
      session.persistent ? await session.page.close() : await session.context.close();
      this.sessions.delete(a.browserSessionId);
      return { closed: true, persistent: session.persistent };
    }
    if (name === "browser_download") {
      const item = session.downloads.get(a.downloadId);
      if (!item) fail("BROWSER_DOWNLOAD_NOT_FOUND", 404);
      const path4 = await item.path, info = await stat2(path4);
      if (info.size > 1048576) fail("BROWSER_DOWNLOAD_TOO_LARGE", 413);
      const data = await readFile(path4);
      await unlink(path4);
      session.downloads.delete(a.downloadId);
      return { downloadId: a.downloadId, filename: item.suggestedFilename, encoding: "base64", content: data.toString("base64"), sha256: sha(data), size: data.length };
    }
    if (name === "browser_script") {
      if (typeof a.script !== "string" || !a.script.trim() || a.script.length > 16384 || a.script.includes("\0")) fail("INVALID_ARGUMENT");
      let value;
      try {
        value = await session.page.evaluate(a.script);
      } catch {
        fail("BROWSER_SCRIPT_FAILED", 400);
      }
      let text;
      try {
        text = JSON.stringify(value ?? null);
      } catch {
        fail("BROWSER_SCRIPT_RESULT_LIMIT", 413);
      }
      if (text.length > 1e5) fail("BROWSER_SCRIPT_RESULT_LIMIT", 413);
      return { completed: true, url: session.page.url(), result: value ?? null };
    }
    if (name === "browser_snapshot") {
      session.revision = `snapshot-${randomUUID3()}`;
      const nodes = await session.page.locator('a,button,input,textarea,select,[role="button"]').evaluateAll((elements) => elements.slice(0, 300).map((el, i) => {
        el.setAttribute("data-dsh-agent-ref", String(i));
        return { ref: String(i), tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute("aria-label") || "").slice(0, 300) };
      }));
      return { browserSessionId: a.browserSessionId, snapshotId: session.revision, url: session.page.url(), text: (await session.page.locator("body").innerText()).slice(0, 1e5), nodes };
    }
    if (a.snapshotId !== session.revision || !/^\d{1,3}$/.test(a.ref)) fail("TARGET_STALE", 409);
    const node = session.page.locator(`[data-dsh-agent-ref="${a.ref}"]`);
    if (await node.count() !== 1) fail("TARGET_STALE", 409);
    session.revision = null;
    if (name === "browser_type" && (typeof a.text !== "string" || a.text.length > 65536)) fail("INVALID_ARGUMENT");
    let upload;
    if (name === "browser_upload") {
      if (typeof a.filename !== "string" || !a.filename || a.filename.length > 128 || /[\0/\\]/.test(a.filename) || typeof a.contentBase64 !== "string") fail("INVALID_ARGUMENT");
      const data = Buffer.from(a.contentBase64, "base64");
      if (data.toString("base64") !== a.contentBase64 || data.length > 1048576) fail("BROWSER_UPLOAD_LIMIT", 413);
      if (a.mimeType !== void 0 && (typeof a.mimeType !== "string" || !/^[-\w.+]+\/[-\w.+]+$/.test(a.mimeType))) fail("INVALID_ARGUMENT");
      upload = { name: a.filename, mimeType: a.mimeType ?? "text/plain", buffer: data };
    }
    const pendingDownload = name === "browser_click" ? session.page.waitForEvent("download", { timeout: 1e3 }).catch(() => null) : null;
    try {
      if (name === "browser_click") await node.click({ timeout: 1e4 });
      else if (name === "browser_type") await node.fill(a.text, { timeout: 1e4 });
      else if (name === "browser_upload") await node.setInputFiles(upload, { timeout: 1e4 });
      else fail("TOOL_NOT_READY", 503);
    } catch {
      fail("OUTCOME_UNKNOWN", 409);
    }
    const download = await pendingDownload, downloadId = download ? [...session.downloads.entries()].find(([, item]) => item.download === download)?.[0] : void 0;
    return { completed: true, url: session.page.url(), ...downloadId ? { downloadId } : {} };
  }
  async close() {
    for (const s of this.sessions.values()) s.persistent ? await s.page.close() : await s.context.close();
    this.sessions.clear();
    for (const context of this.profiles.values()) await context.close();
    this.profiles.clear();
    await this.browser?.close();
  }
};

// src/desktop.ts
import net from "node:net";
import { readFile as readFile2 } from "node:fs/promises";
import { randomUUID as randomUUID4 } from "node:crypto";
var error = (code, possiblyApplied = false, stopConfirmed = false) => Object.assign(new AgentError(code, 409), { possiblyApplied, stopConfirmed });
var DesktopTools = class {
  constructor(config, options = {}) {
    this.config = config;
    this.options = options;
  }
  config;
  options;
  nonce = randomUUID4();
  owners = /* @__PURE__ */ new Map();
  closing = new AbortController();
  active = /* @__PURE__ */ new Set();
  tag(c) {
    return sha(canonical({ agent: this.nonce, client: c.clientId, bot: c.botId, task: c.taskId, attempt: c.attemptId, revision: c.revision }));
  }
  owner(c) {
    const now = Date.now();
    for (const [tag2, row2] of this.owners) if (!row2.active && !row2.uncertain && row2.expiresAt + 1e4 < now) this.owners.delete(tag2);
    const tag = this.tag(c);
    let row = this.owners.get(tag);
    if (!row) {
      if (this.owners.size >= 4096) fail("DESKTOP_LEASE_LIMIT", 429);
      row = { tag, expiresAt: c.expiresAt, blocked: false, active: 0, idleAt: 0, uncertain: 0, stopAttempts: 0 };
      this.owners.set(tag, row);
    }
    row.expiresAt = Math.max(row.expiresAt, c.expiresAt);
    return row;
  }
  async rpc(control2, packet, beforeWrite = () => {
  }) {
    const name = this.config.pipeName + (control2 ? "-control" : "");
    return new Promise((resolve4, reject) => {
      const socket = (this.options.connect ?? net.createConnection)(`\\\\.\\pipe\\${name}`), chunks = [];
      let bytes = 0, sent = false, settled = false;
      const finish = (value, e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (e) reject(e);
        else resolve4(value);
      };
      const timer = setTimeout(() => finish(null, error(sent ? "OUTCOME_UNKNOWN" : "DESKTOP_UNAVAILABLE", !control2 && sent)), this.options.timeoutMs ?? 1e4);
      socket.once("connect", () => {
        try {
          beforeWrite();
          sent = true;
          socket.write(JSON.stringify({ ...packet, protocolVersion: 2 }) + "\n");
        } catch (e) {
          finish(null, e);
        }
      });
      socket.on("data", (chunk) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += data.length;
        if (bytes > 24e6) {
          finish(null, error("OUTCOME_UNKNOWN", !control2 && sent));
          return;
        }
        chunks.push(data);
        if (data.includes(10)) try {
          const all = Buffer.concat(chunks), end = all.indexOf(10);
          if (all.subarray(end + 1).toString("utf8").trim()) throw Error();
          finish(JSON.parse(all.subarray(0, end).toString("utf8")));
        } catch {
          finish(null, error("OUTCOME_UNKNOWN", !control2 && sent));
        }
      });
      socket.once("error", () => finish(null, error(sent ? "OUTCOME_UNKNOWN" : "DESKTOP_UNAVAILABLE", !control2 && sent)));
      socket.once("close", () => finish(null, error(sent ? "OUTCOME_UNKNOWN" : "DESKTOP_UNAVAILABLE", !control2 && sent)));
    });
  }
  checkResponse(result, possiblyApplied = false) {
    if (result?.protocolVersion !== 2) throw error("DESKTOP_PROTOCOL_UNSUPPORTED", possiblyApplied);
    return result;
  }
  async stop(row, retry = false) {
    row.blocked = true;
    if (!row.helper || !row.token) return !row.uncertain;
    if (row.stop && retry) {
      const previous = row.stop, stopped = await previous;
      if (stopped || row.stopAttempts >= 2) return stopped;
      if (row.stop === previous) row.stop = void 0;
    }
    if (!row.stop) {
      row.stopAttempts++;
      row.stop = (async () => {
        try {
          const result = this.checkResponse(await this.rpc(true, { token: row.token, name: "cancel", owner: row.tag, helperInstanceId: row.helper }));
          const stopped = result.ok === true && result.result?.helperInstanceId === row.helper && result.result?.stopConfirmed === true;
          if (stopped) {
            row.uncertain = 0;
            row.idleAt = 0;
          }
          return stopped;
        } catch {
          return false;
        }
      })();
    }
    return row.stop;
  }
  async cancel(c) {
    const row = this.owners.get(this.tag(c));
    return { stopConfirmed: row ? await this.stop(row, true) : true };
  }
  async run(name, args, c, external) {
    if (process.platform !== "win32" && !this.options.connect || !this.config) fail("DESKTOP_UNAVAILABLE", 503);
    if (!/^dsh-desktop-[-a-zA-Z0-9]{1,64}$/.test(this.config.pipeName)) fail("DESKTOP_UNAVAILABLE", 503);
    const row = this.owner(c), signal = AbortSignal.any([this.closing.signal, ...external ? [external] : []]);
    if (name === "desktop_screenshot" && row.blocked && !this.closing.signal.aborted) {
      row.blocked = false;
      row.stop = void 0;
      row.stopAttempts = 0;
    }
    const check = () => {
      if (signal.aborted || row.blocked) throw error("DESKTOP_CANCELLED", false, true);
      if (!Number.isSafeInteger(c.expiresAt) || c.expiresAt <= Date.now()) throw error("GRANT_REVOKED");
      this.options.validate?.(c);
    };
    const work = (async () => {
      let sent = false, notApplied = false;
      const abort = () => {
        void this.stop(row);
      };
      signal.addEventListener("abort", abort, { once: true });
      row.active++;
      try {
        check();
        const token = (await readFile2(this.config.secretFile, "utf8")).trim();
        check();
        const probe = this.checkResponse(await this.rpc(true, { token, name: "probe" }));
        if (!probe.ok) throw error(probe.code ?? "DESKTOP_UNAVAILABLE");
        if (probe.result?.protocolVersion !== 2 || !/^[a-f0-9]{32}$/.test(probe.result?.helperInstanceId ?? "")) throw error("DESKTOP_PROTOCOL_UNSUPPORTED");
        check();
        row.helper = probe.result.helperInstanceId;
        row.token = token;
        const response = this.checkResponse(await this.rpc(false, { token, name, args, owner: row.tag, expiresAt: c.expiresAt, helperInstanceId: row.helper }, () => {
          check();
          sent = true;
          row.uncertain++;
        }), true);
        row.uncertain = Math.max(0, row.uncertain - 1);
        row.idleAt = Date.now();
        notApplied = response.effect === "not-applied";
        if (signal.aborted || row.blocked) throw error("DESKTOP_CANCELLED", sent && !notApplied);
        this.options.validate?.(c);
        if (!response.ok) throw error(response.code ?? "DESKTOP_UNAVAILABLE", response.effect === "possibly-applied", response.stopConfirmed === true);
        row.idleAt = Date.now();
        return response.result;
      } catch (e) {
        if (e.code === "GRANT_REVOKED") row.blocked = true;
        if (signal.aborted || row.blocked) {
          const stopped = await this.stop(row, true);
          throw error(stopped ? "DESKTOP_CANCELLED" : "OUTCOME_UNKNOWN", sent && !notApplied, stopped);
        }
        if (!sent) e.stopConfirmed = true;
        throw e;
      } finally {
        row.active--;
        signal.removeEventListener("abort", abort);
      }
    })();
    this.active.add(work);
    try {
      return await work;
    } finally {
      this.active.delete(work);
    }
  }
  async close() {
    this.closing.abort(error("DESKTOP_HOST_STOPPED"));
    const relevant = [...this.owners.values()].filter((row) => row.active || row.uncertain || row.idleAt + 15e3 > Date.now());
    const stopped = await Promise.all(relevant.map((row) => this.stop(row, true)));
    await Promise.allSettled([...this.active]);
    return { stopConfirmed: stopped.every(Boolean) };
  }
};

// src/desktop-session.ts
import net2 from "node:net";
import { readFile as readFile3 } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { randomUUID as randomUUID5 } from "node:crypto";
var inputTools = ["desktop_click", "desktop_type", "desktop_key", "desktop_scroll"];
var unknown = () => Object.assign(new AgentError("OUTCOME_UNKNOWN", 409), { possiblyApplied: true, stopConfirmed: false });
var safeOrigin = (value) => {
  if (value === "dsh-app://app") return value;
  if (typeof value !== "string") fail("INVALID_ORIGIN");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) fail("INVALID_ORIGIN");
    return value;
  } catch {
    fail("INVALID_ORIGIN");
  }
};
var ownerIdentity = (c) => canonical({ client: c.clientId, bot: c.botId, task: c.taskId, attempt: c.attemptId, revision: c.revision, roots: [...c.roots].sort() });
var NativeDesktopPipe = class _NativeDesktopPipe extends EventEmitter {
  metadata;
  frameMetadata;
  socket;
  buffer = Buffer.alloc(0);
  nextId = 0;
  ended = false;
  stopConfirmed = false;
  pending = /* @__PURE__ */ new Map();
  opening = Promise.withResolvers();
  openTimer;
  stopping;
  constructor(config, request, token) {
    super();
    this.socket = net2.createConnection(`\\\\.\\pipe\\${config.pipeName}-stream`);
    this.openTimer = setTimeout(() => this.finish(new AgentError("DESKTOP_UNAVAILABLE", 503)), 5e3);
    this.socket.once("connect", () => this.write({ ...request, streamVersion: 1, token }));
    this.socket.on("data", (chunk) => {
      try {
        this.receive(chunk);
      } catch {
        this.finish(unknown());
      }
    });
    this.socket.once("error", () => this.finish(new AgentError(this.metadata ? "OUTCOME_UNKNOWN" : "DESKTOP_UNAVAILABLE", 503)));
    this.socket.once("close", () => this.finish(unknown()));
  }
  static async open(config, request) {
    if (process.platform !== "win32" || !/^dsh-desktop-[-a-zA-Z0-9]{1,64}$/.test(config.pipeName)) fail("DESKTOP_UNAVAILABLE", 503);
    const token = (await readFile3(config.secretFile, "utf8")).trim(), pipe = new _NativeDesktopPipe(config, request, token);
    await pipe.opening.promise;
    return pipe;
  }
  write(value) {
    if (this.ended) throw unknown();
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > 65535) fail("INPUT_LIMIT");
    const packet = Buffer.allocUnsafe(body.length + 5);
    packet.writeUInt32LE(body.length + 1);
    packet[4] = 74;
    body.copy(packet, 5);
    this.socket.write(packet);
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 8388613 + 65536) throw unknown();
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length < 1 || length > 8388609) throw unknown();
      if (this.buffer.length < length + 4) return;
      const tag = this.buffer[4], body = this.buffer.subarray(5, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      if (tag === 70) {
        if (!this.metadata) throw unknown();
        this.emit("frame", body, this.frameMetadata);
        continue;
      }
      if (tag !== 74 || body.length > 65536) throw unknown();
      const value = JSON.parse(body.toString("utf8"));
      if (value.t === "opened") {
        if (this.metadata) throw unknown();
        if (value.ok !== true) {
          this.finish(new AgentError(value.code ?? "DESKTOP_UNAVAILABLE", 503));
          return;
        }
        if (value.streamVersion !== 1 || !Number.isSafeInteger(value.width) || value.width < 1 || !Number.isSafeInteger(value.height) || value.height < 1 || !Array.isArray(value.displays) || typeof value.displayId !== "string") throw unknown();
        this.metadata = value;
        clearTimeout(this.openTimer);
        this.opening.resolve(value);
      } else if (value.t === "frame-meta") {
        this.frameMetadata = value;
      } else if (value.t === "ack") {
        const pending = this.pending.get(value.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(value.id);
        pending.resolve(value);
      } else if (value.t === "ended") {
        this.stopConfirmed = value.stopConfirmed === true;
        this.emit("ended", { code: value.code ?? "DESKTOP_STOPPED", stopConfirmed: this.stopConfirmed });
      } else throw unknown();
    }
  }
  finish(error2) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.openTimer);
    this.socket.destroy();
    this.buffer = Buffer.alloc(0);
    this.opening.reject(error2);
    for (const row of this.pending.values()) {
      clearTimeout(row.timer);
      row.reject(unknown());
    }
    this.pending.clear();
    this.emit("ended", { code: error2?.code ?? "DESKTOP_DISCONNECTED", stopConfirmed: this.stopConfirmed });
  }
  request(message) {
    if (this.ended) return Promise.reject(unknown());
    if (this.pending.size >= 64) return Promise.reject(new AgentError("DESKTOP_INPUT_LIMIT", 429));
    const id2 = ++this.nextId;
    return new Promise((resolve4, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id2);
        reject(unknown());
        this.finish(unknown());
      }, 6500);
      this.pending.set(id2, { resolve: resolve4, reject, timer });
      try {
        this.write({ ...message, id: id2 });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id2);
        reject(e);
      }
    });
  }
  frame(keyframe = false) {
    try {
      this.write({ t: "frame", ...keyframe ? { keyframe: true } : {} });
    } catch {
      this.finish(unknown());
    }
  }
  close() {
    if (!this.stopping) this.stopping = (async () => {
      if (this.ended) return { stopConfirmed: this.stopConfirmed };
      try {
        const ack = await this.request({ t: "close" });
        this.stopConfirmed = ack.ok === true && ack.stopConfirmed === true;
        return { stopConfirmed: this.stopConfirmed };
      } catch {
        return { stopConfirmed: this.stopConfirmed };
      } finally {
        this.finish(unknown());
      }
    })();
    return this.stopping;
  }
};
var videoProfiles = [{ scalePercent: 100, quality: 70 }, { scalePercent: 75, quality: 60 }, { scalePercent: 60, quality: 50 }, { scalePercent: 50, quality: 45 }, { scalePercent: 40, quality: 35 }, { scalePercent: 35, quality: 30 }];
var DesktopSessions = class {
  constructor(config, authority, options = {}) {
    this.config = config;
    this.authority = authority;
    this.options = options;
    this.timer = setInterval(() => void this.sweep(), options.sweepMs ?? 100);
    this.timer.unref();
  }
  config;
  authority;
  options;
  forceKeyframes = /* @__PURE__ */ new Set();
  flights = /* @__PURE__ */ new WeakMap();
  sessions = /* @__PURE__ */ new Map();
  nonce = randomUUID5();
  closing = false;
  timer;
  sockets = /* @__PURE__ */ new Set();
  opening = 0;
  check(c) {
    if (this.closing) fail("DESKTOP_HOST_STOPPED", 503);
    this.authority.validate(c);
    if (!c.tools.includes("desktop_screenshot")) fail("SCOPE_DENIED", 403);
    if (!Number.isSafeInteger(c.expiresAt) || c.expiresAt <= Date.now()) fail("GRANT_REVOKED", 403);
  }
  audit(row, kind, extra = {}) {
    row.events.push({ at: Date.now(), kind, sessionId: row.id, taskId: row.context.taskId, attemptId: row.context.attemptId, ...extra });
    if (row.events.length > 128) row.events.shift();
    if (!["input", "frame-drop"].includes(kind)) this.authority.audit?.(`DESKTOP_SESSION_${kind.toUpperCase().replaceAll("-", "_")}`, row.context.botId, `${row.context.taskId}/${row.context.attemptId}/${row.id}`);
  }
  ticket(row) {
    return { sessionId: row.id, token: row.token, expiresAt: row.context.expiresAt, path: "/desktop/v1/socket", displayId: row.native.metadata.displayId, displays: row.native.metadata.displays, width: row.native.metadata.width, height: row.native.metadata.height, mode: row.mode, controlAllowed: row.controlAllowed };
  }
  own(c, id2) {
    this.check(c);
    const row = this.sessions.get(id2);
    if (!row) fail("DESKTOP_SESSION_NOT_FOUND", 404);
    if (ownerIdentity(c) !== ownerIdentity(row.context)) fail("SCOPE_DENIED", 403);
    return row;
  }
  async open(c, request) {
    this.check(c);
    if (!this.config) fail("DESKTOP_UNAVAILABLE", 503);
    if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some((k) => !["mode", "fps", "displayId", "origin"].includes(k))) fail("INVALID_ARGUMENT");
    const mode = request.mode ?? "watch";
    if (!["watch", "control"].includes(mode)) fail("INVALID_ARGUMENT");
    const fps = integer(request.fps, 1, 30, 15);
    if (request.displayId !== void 0 && (typeof request.displayId !== "string" || request.displayId.length > 128)) fail("INVALID_ARGUMENT");
    const origin = request.origin === void 0 ? void 0 : safeOrigin(request.origin), controlAllowed = inputTools.every((tool) => c.tools.includes(tool));
    if (mode === "control" && !controlAllowed) fail("SCOPE_DENIED", 403);
    await this.sweep();
    if (this.opening + [...this.sessions.values()].filter((s) => !s.closed).length >= 4 || this.sessions.size >= 256) fail("DESKTOP_SESSION_LIMIT", 429);
    const id2 = `desktop-${randomUUID5()}`, token = secret();
    this.opening++;
    let native;
    try {
      native = await (this.options.nativeFactory ?? NativeDesktopPipe.open)(this.config, { owner: sha(canonical({ agent: this.nonce, session: id2, identity: ownerIdentity(c) })), expiresAt: c.expiresAt, fps, controlAllowed, ...request.displayId ? { displayId: request.displayId } : {} });
    } finally {
      this.opening--;
    }
    try {
      this.check(c);
    } catch (e) {
      await native.close();
      throw e;
    }
    const row = { id: id2, token, digest: sha(token), context: structuredClone(c), origin, native, mode: "watch", requestedControl: mode === "control", controlAllowed, used: false, closed: false, stopped: false, queue: Promise.resolve(), queued: 0, renewing: false, sending: false, lastInputId: 0, events: [], fps, profile: 0, appliedProfile: 0, fastFrames: 0, baselineRtt: 0, pingStarted: 0, frameSequence: 0, frameRequested: false };
    this.sessions.set(id2, row);
    native.on("frame", (jpeg, metadata) => {
      row.frameRequested = false;
      this.frame(row, jpeg, metadata);
    });
    native.on("ended", (value) => {
      row.stopped = value.stopConfirmed === true;
      if (!row.closed) {
        row.closed = true;
        row.closedAt = Date.now();
        clearTimeout(row.frameTimer);
        clearTimeout(row.ackTimer);
        row.pendingFrame = void 0;
        this.send(row, { type: "status", status: "disconnected", mode: "watch", code: value.code, stopConfirmed: row.stopped });
        row.socket?.close(1e3, "Desktop session ended");
        this.audit(row, "ended", { code: value.code, stopConfirmed: row.stopped });
      }
    });
    this.audit(row, "opened");
    return this.ticket(row);
  }
  async renew(c, request) {
    const row = this.own(c, request?.sessionId);
    if (row.closed) fail("DESKTOP_SESSION_CLOSED", 409);
    if (request.origin !== void 0 && safeOrigin(request.origin) !== row.origin) fail("ORIGIN_DENIED", 403);
    if (!row.context.tools.every((tool) => c.tools.includes(tool))) fail("SCOPE_DENIED", 403);
    if (row.renewing) fail("DESKTOP_RENEW_PENDING", 409);
    row.renewing = true;
    try {
      this.check(c);
      const ack = await row.native.request({ t: "renew", expiresAt: c.expiresAt });
      if (ack.ok !== true) fail(ack.code ?? "DESKTOP_RENEW_FAILED", 409);
      this.check(c);
      if (row.closed) fail("DESKTOP_SESSION_CLOSED", 409);
      row.context = structuredClone(c);
      this.audit(row, "renewed");
      return this.ticket(row);
    } catch (e) {
      await this.stop(row, "DESKTOP_RENEW_FAILED");
      throw e;
    } finally {
      row.renewing = false;
    }
  }
  async closeSession(c, request) {
    const row = this.own(c, request?.sessionId);
    return this.stop(row, "SESSION_CLOSED");
  }
  async closeClientSession(clientId, request) {
    if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some((key2) => !["sessionId", "botId", "taskId", "attemptId"].includes(key2))) fail("INVALID_ARGUMENT");
    for (const key2 of ["sessionId", "botId", "taskId", "attemptId"]) identifier(request[key2]);
    const row = this.sessions.get(request.sessionId);
    if (!row || row.context.clientId !== clientId || row.context.botId !== request.botId || row.context.taskId !== request.taskId || row.context.attemptId !== request.attemptId) fail("SCOPE_DENIED", 403);
    return this.stop(row, "SESSION_CLOSED");
  }
  hasOrigin(origin) {
    return [...this.sessions.values()].some((row) => !row.closed && row.origin === origin && row.context.expiresAt > Date.now());
  }
  send(row, message) {
    if (row.socket?.readyState === 1) row.socket.send(JSON.stringify(message));
  }
  nextFrame(row, delay = 0) {
    if (row.closed || row.frameRequested || row.pendingFrame || !row.socket || row.socket.readyState !== 1) return;
    clearTimeout(row.frameTimer);
    row.frameRequested = true;
    row.frameTimer = setTimeout(() => void (async () => {
      if (row.closed) return;
      this.check(row.context);
      if (row.profile !== row.appliedProfile) {
        const ack = await row.native.request({ t: "video", ...videoProfiles[row.profile] });
        if (!ack.ok) throw new AgentError(ack.code ?? "DESKTOP_VIDEO_FAILED");
        row.appliedProfile = row.profile;
      }
      if (!row.closed) row.native.frame(this.forceKeyframes.delete(row));
    })().catch(() => this.stop(row, "DESKTOP_VIDEO_FAILED")), delay);
    row.frameTimer.unref();
  }
  framePing(row, baseline = false, sequence = row.frameSequence) {
    if (row.closed || row.socket?.readyState !== 1) return;
    const tag = baseline ? "baseline" : `frame:${sequence}`;
    if (baseline) {
      row.pingTag = tag;
      row.pingStarted = performance.now();
    }
    clearTimeout(row.ackTimer);
    row.ackTimer = setTimeout(() => void this.stop(row, "DESKTOP_FRAME_ACK_TIMEOUT"), 15e3);
    row.ackTimer.unref();
    row.socket.ping(tag, void 0, (error2) => {
      if (error2) void this.stop(row, "DESKTOP_DISCONNECTED");
    });
  }
  frame(row, jpeg, metadata) {
    if (row.closed || !row.socket || row.socket.readyState !== 1) return;
    try {
      this.check(row.context);
    } catch {
      void this.stop(row, "GRANT_REVOKED");
      return;
    }
    const socket = row.socket;
    if (!Buffer.isBuffer(jpeg) || jpeg.length > 8388608) {
      void this.stop(row, "CAPTURE_LIMIT");
      return;
    }
    const flights = this.flights.get(row) ?? /* @__PURE__ */ new Map();
    this.flights.set(row, flights);
    const small = metadata?.region && metadata.region.width * metadata.region.height <= row.native.metadata.width * row.native.metadata.height * 0.15 && jpeg.length <= 65536;
    if (flights.size >= (small ? 2 : 1)) {
      if (row.pendingFrame) {
        this.audit(row, "frame-drop");
        this.forceKeyframes.add(row);
      }
      row.pendingFrame = { jpeg, metadata };
      return;
    }
    if (socket.bufferedAmount > (this.options.maxBufferedAmount ?? 524288)) {
      this.audit(row, "frame-drop");
      this.forceKeyframes.add(row);
      this.nextFrame(row, 100);
      return;
    }
    row.sending = true;
    row.pingStarted = performance.now();
    row.frameSequence++;
    flights.set(`frame:${row.frameSequence}`, { started: row.pingStarted, keyframe: metadata?.keyframe === true });
    this.send(row, { type: "frame", width: row.native.metadata.width, height: row.native.metadata.height, frameWidth: metadata?.frameWidth ?? row.native.metadata.width, frameHeight: metadata?.frameHeight ?? row.native.metadata.height, ...metadata?.region ? { region: metadata.region, keyframe: metadata.keyframe === true } : {}, quality: metadata?.quality ?? 70, scalePercent: metadata?.scalePercent ?? 100, sequence: row.frameSequence, captureMs: metadata?.captureMs, encodeMs: metadata?.encodeMs });
    const sequence = row.frameSequence;
    socket.send(jpeg, { binary: true }, (error2) => {
      if (error2) void this.stop(row, "DESKTOP_DISCONNECTED");
      else {
        this.framePing(row, false, sequence);
        this.nextFrame(row);
      }
    });
  }
  enqueue(row, work) {
    if (row.queued >= 64) {
      this.send(row, { type: "error", code: "DESKTOP_INPUT_LIMIT" });
      return;
    }
    row.queued++;
    row.queue = row.queue.then(async () => {
      if (row.closed) return;
      try {
        this.check(row.context);
        await work();
      } catch (e) {
        this.send(row, { type: "error", code: e?.code ?? "DESKTOP_SESSION_FAILED" });
        await this.stop(row, e?.code ?? "DESKTOP_SESSION_FAILED");
      }
    }).finally(() => row.queued--);
  }
  input(event, row) {
    if (!event || typeof event !== "object" || Array.isArray(event)) fail("INVALID_ARGUMENT");
    if (event.type === "pointer") {
      if (!["move", "down", "up"].includes(event.action) || !["left", "middle", "right"].includes(event.button ?? "left")) fail("INVALID_ARGUMENT");
      return { kind: "pointer", action: event.action, button: event.button ?? "left", x: integer(event.x, 0, row.native.metadata.width - 1), y: integer(event.y, 0, row.native.metadata.height - 1) };
    }
    if (event.type === "key") {
      if (!["down", "up"].includes(event.action) || typeof event.code !== "string" || !event.code || event.code.length > 64 || typeof event.key !== "string" || event.key.length > 64) fail("INVALID_ARGUMENT");
      return { kind: "key", action: event.action, code: event.code, key: event.key };
    }
    if (event.type === "wheel") return { kind: "wheel", deltaX: integer(event.deltaX, -4800, 4800), deltaY: integer(event.deltaY, -4800, 4800) };
    if (event.type === "text") {
      if (typeof event.text !== "string" || event.text.length > 8192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(event.text)) fail("INPUT_LIMIT");
      return { kind: "text", text: event.text };
    }
    fail("INVALID_ARGUMENT");
  }
  /** Called only after the HTTP server validates Host/network/TLS on upgrade. */
  accept(socket, origin, allowedOrigins = [], peerClientId) {
    this.sockets.add(socket);
    let row, authenticating = false, alive2 = true;
    const authTimer = setTimeout(() => socket.close(1008, "Desktop authentication required"), this.options.authTimeoutMs ?? 5e3);
    authTimer.unref();
    const heartbeat = setInterval(() => {
      if (!alive2) {
        socket.terminate();
        return;
      }
      alive2 = false;
      socket.ping();
    }, 15e3);
    heartbeat.unref();
    socket.on("pong", (data) => {
      alive2 = true;
      if (!row) return;
      const tag = data.toString(), baseline = tag === "baseline" && row.pingTag === "baseline";
      const flights = this.flights.get(row), flight = flights?.get(tag);
      if (!baseline && !flight) return;
      clearTimeout(row.ackTimer);
      const elapsed = performance.now() - (baseline ? row.pingStarted : flight.started);
      if (baseline) {
        row.pingTag = void 0;
        row.baselineRtt = elapsed;
        this.nextFrame(row);
        return;
      }
      flights.delete(tag);
      row.sending = false;
      const target = 1e3 / row.fps, transfer = Math.max(1, elapsed - row.baselineRtt);
      if (!flight.keyframe && transfer > target * 1.35 && row.profile < videoProfiles.length - 1) {
        row.profile = Math.min(videoProfiles.length - 1, row.profile + (transfer > target * 4 ? 2 : 1));
        row.fastFrames = 0;
      } else if (transfer < target * 0.55 && row.profile > 0 && ++row.fastFrames >= 20) {
        row.profile--;
        row.fastFrames = 0;
      } else if (transfer >= target * 0.55) row.fastFrames = 0;
      if (row.pendingFrame) {
        const pending = row.pendingFrame;
        row.pendingFrame = void 0;
        this.frame(row, pending.jpeg, pending.metadata);
      } else this.nextFrame(row);
    });
    const reject = (code) => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "error", code }));
      socket.close(1008, code);
    };
    socket.on("message", (data, isBinary) => {
      let message;
      try {
        if (isBinary || data.length > 65536) fail("INVALID_ARGUMENT");
        message = JSON.parse(data.toString());
        if (!message || typeof message !== "object" || Array.isArray(message)) fail("INVALID_ARGUMENT");
      } catch {
        reject("INVALID_ARGUMENT");
        return;
      }
      if (!row) {
        if (authenticating) {
          reject("AUTH_INVALID");
          return;
        }
        try {
          const candidate = this.sessions.get(message.sessionId);
          if (message.type !== "auth" || typeof message.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(message.token) || !candidate || !matches(message.token, candidate.digest)) fail("AUTH_INVALID", 401);
          if (peerClientId !== void 0 && candidate.context.clientId !== peerClientId) fail("AUTH_INVALID", 401);
          if (candidate.closed || candidate.used) fail("DESKTOP_SESSION_CLOSED", 409);
          this.check(candidate.context);
          if (origin !== void 0 && (candidate.origin ? origin !== candidate.origin : !allowedOrigins.includes(origin))) fail("ORIGIN_DENIED", 403);
          if (candidate.origin && origin === void 0) {
          }
          row = candidate;
          row.used = true;
          row.socket = socket;
          authenticating = true;
          clearTimeout(authTimer);
          this.enqueue(row, async () => {
            if (row.requestedControl) {
              const ack = await row.native.request({ t: "control", action: "acquire" });
              if (!ack.ok) fail(ack.code ?? "CONTROL_NOT_GRANTED", 409);
              row.mode = "control";
            }
            const { t, ok, sessionId: physicalSessionId, ...metadata } = row.native.metadata;
            this.send(row, { ...metadata, type: "ready", sessionId: row.id, nativeSessionId: physicalSessionId, mode: row.mode, expiresAt: row.context.expiresAt, controlAllowed: row.controlAllowed });
            this.audit(row, "authenticated");
            this.framePing(row, true);
          });
        } catch (e) {
          reject(e.code ?? "AUTH_INVALID");
        }
        return;
      }
      const current = row;
      if (message.type === "close") {
        void this.stop(current, "SESSION_CLOSED");
        return;
      }
      this.enqueue(current, async () => {
        if (message.type === "control") {
          if (!["acquire", "release"].includes(message.action)) fail("INVALID_ARGUMENT");
          if (message.action === "acquire" && !current.controlAllowed) {
            this.send(current, { type: "control", mode: "watch", ok: false, code: "SCOPE_DENIED", ...message.id !== void 0 ? { id: message.id } : {} });
            return;
          }
          let ack;
          try {
            ack = await current.native.request({ t: "control", action: message.action });
          } catch (e) {
            this.send(current, { type: "control", mode: "watch", ok: false, code: e.code ?? "OUTCOME_UNKNOWN", possiblyApplied: true, ...message.id !== void 0 ? { id: message.id } : {} });
            await this.stop(current, "OUTCOME_UNKNOWN");
            return;
          }
          if (ack.ok !== true) {
            this.send(current, { type: "control", mode: current.mode, ok: false, code: ack.code ?? "CONTROL_NOT_GRANTED", ...message.id !== void 0 ? { id: message.id } : {} });
            if (message.action === "release") await this.stop(current, "INPUT_RELEASE_UNCONFIRMED");
            return;
          }
          current.mode = ack.mode === "control" ? "control" : "watch";
          this.send(current, { type: "control", mode: current.mode, ok: true, ...message.id !== void 0 ? { id: message.id } : {} });
          this.audit(current, "control", { mode: current.mode });
        } else if (message.type === "input") {
          let event;
          try {
            integer(message.id, 1, Number.MAX_SAFE_INTEGER);
            if (message.id <= current.lastInputId) fail("DESKTOP_INPUT_REPLAY", 409);
            current.lastInputId = message.id;
            if (current.mode !== "control") fail("CONTROL_NOT_GRANTED", 403);
            event = this.input(message.event, current);
          } catch (e) {
            this.send(current, { type: "input", id: message.id, ok: false, code: e.code ?? "INVALID_ARGUMENT", possiblyApplied: false });
            return;
          }
          let ack;
          try {
            ack = await current.native.request({ t: "input", ...event });
          } catch (e) {
            this.send(current, { type: "input", id: message.id, ok: false, code: e.code ?? "OUTCOME_UNKNOWN", possiblyApplied: true });
            await this.stop(current, "OUTCOME_UNKNOWN");
            return;
          }
          this.send(current, { type: "input", id: message.id, ok: ack.ok === true, ...ack.ok ? {} : { code: ack.code ?? "INPUT_REJECTED", possiblyApplied: ack.possiblyApplied === true } });
          this.audit(current, "input", { id: message.id, event: event.kind, ok: ack.ok === true });
        } else if (message.type === "release-input") {
          let ack;
          try {
            ack = await current.native.request({ t: "release-input" });
          } catch (e) {
            this.send(current, { type: "release-input", ...message.id !== void 0 ? { id: message.id } : {}, ok: false, code: e.code ?? "OUTCOME_UNKNOWN", possiblyApplied: true });
            await this.stop(current, "OUTCOME_UNKNOWN");
            return;
          }
          this.send(current, { type: "release-input", ...message.id !== void 0 ? { id: message.id } : {}, ok: ack.ok === true, ...ack.ok ? {} : { code: ack.code ?? "INPUT_RELEASE_UNCONFIRMED", possiblyApplied: true } });
          this.audit(current, "release-input");
          if (!ack.ok) await this.stop(current, "INPUT_RELEASE_UNCONFIRMED");
        } else fail("INVALID_ARGUMENT");
      });
    });
    socket.on("error", () => {
      if (row) void this.stop(row, "DESKTOP_DISCONNECTED");
    });
    socket.once("close", () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      this.sockets.delete(socket);
      if (row) void this.stop(row, "DESKTOP_DISCONNECTED");
    });
  }
  stop(row, reason) {
    this.forceKeyframes.delete(row);
    if (row.stop) return row.stopped ? Promise.resolve({ stopConfirmed: true }) : row.stop;
    row.closed = true;
    row.closedAt = Date.now();
    clearTimeout(row.frameTimer);
    clearTimeout(row.ackTimer);
    row.pendingFrame = void 0;
    row.stop = (async () => {
      const result = await row.native.close().catch(() => ({ stopConfirmed: false }));
      row.stopped = result.stopConfirmed === true;
      row.mode = "watch";
      this.send(row, { type: "status", status: "disconnected", mode: "watch", code: reason, stopConfirmed: row.stopped });
      row.socket?.close(1e3, "Desktop session closed");
      this.audit(row, "closed", { reason, stopConfirmed: row.stopped });
      return { stopConfirmed: row.stopped };
    })();
    return row.stop;
  }
  async sweep() {
    const pending = [];
    for (const [id2, row] of this.sessions) {
      if (row.closed) {
        if (row.closedAt + 3e4 < Date.now()) this.sessions.delete(id2);
        continue;
      }
      if (row.renewing) continue;
      try {
        this.check(row.context);
      } catch {
        pending.push(this.stop(row, "GRANT_REVOKED"));
      }
    }
    await Promise.all(pending);
  }
  sessionAudit(c, id2) {
    return structuredClone(this.own(c, id2).events);
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    const result = await Promise.all([...this.sessions.values()].map((row) => this.stop(row, "DESKTOP_HOST_STOPPED")));
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    return { stopConfirmed: result.every((r) => r.stopConfirmed) };
  }
};

// src/container-command.ts
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir as mkdir2, open as open2, readFile as readFile4, lstat as lstat2 } from "node:fs/promises";
import { isAbsolute, join as join3 } from "node:path";
import { randomUUID as randomUUID6 } from "node:crypto";

// src/container-supervisor.mjs
async function runContainerSupervisor() {
  const { spawn: spawn5 } = await import("node:child_process");
  const { stat: stat8 } = await import("node:fs/promises");
  const [deadlineText, identityText, executable, ...argv] = process.argv.slice(2), deadline = Number(deadlineText);
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now() || !executable) process.exit(124);
  let expected;
  try {
    expected = JSON.parse(identityText);
  } catch {
    process.exit(125);
  }
  if (!expected || Object.keys(expected).sort().join(",") !== "birth,dev,ino" || !["birth", "dev", "ino"].every((k) => typeof expected[k] === "string" && /^(0|[1-9][0-9]{0,39})$/.test(expected[k])) || expected.ino === "0" || expected.birth === "0") process.exit(125);
  for (const path4 of ["/workspace", "."]) {
    const s = await stat8(path4, { bigint: true });
    if (!s.isDirectory() || String(s.dev) !== expected.dev || String(s.ino) !== expected.ino || String(s.birthtimeNs) !== expected.birth) process.exit(125);
  }
  process.setgroups([]);
  let child;
  const stop = (code) => process.exit(code);
  const timer = setTimeout(() => stop(124), Math.max(1, deadline - Date.now()));
  process.once("SIGTERM", () => stop(143));
  process.once("SIGINT", () => stop(130));
  try {
    child = spawn5(executable, argv, { uid: 65532, gid: 65532, env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", HOME: "/tmp" }, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", () => stop(126));
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      stop(code ?? (signal ? 128 : 1));
    });
  } catch {
    stop(126);
  }
}
var CONTAINER_SUPERVISOR_SOURCE = `(${runContainerSupervisor.toString()})().catch(()=>process.exit(126))
`;

// src/container-command.ts
var control = promisify(execFile);
var CONTAINER_IMAGE = "node@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d";
var object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var terminal = /* @__PURE__ */ new Set(["succeeded", "failed", "cancelled"]);
var env = (directory) => ({ PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", HOME: "/nonexistent", DOCKER_CONFIG: directory });
function validateContainerCommandConfig(value) {
  if (process.platform !== "linux") fail("CONTAINER_PLATFORM_UNAVAILABLE", 503);
  if (!object(value) || Object.keys(value).some((k) => !["dockerExecutable", "image", "executables", "shell"].includes(k)) || typeof value.dockerExecutable !== "string" || !isAbsolute(value.dockerExecutable) || value.dockerExecutable.includes("\0") || value.image !== CONTAINER_IMAGE || !object(value.executables) || !Object.keys(value.executables).length || Object.entries(value.executables).some(([name, path4]) => !/^[-a-z0-9]{1,32}$/.test(name) || typeof path4 !== "string" || !/^\/(?:usr\/local\/bin|usr\/bin|bin)\/[-a-zA-Z0-9_.]+$/.test(path4)) || value.shell !== void 0 && typeof value.shell !== "boolean") fail("CONTAINER_CONFIG_INVALID");
  return value;
}
function containerArguments({ name, nonce, machineId, workspace, workspaceIdentity, config, executable, argv, deadlineAt = Date.now() + 6e4, supervisorFile = "/fixture-supervisor.mjs" }) {
  if (!/^dsh-worker-[a-f0-9]{40}$/.test(name) || !/^[-a-f0-9]{36}$/.test(nonce) || ![workspace, supervisorFile].every((p) => typeof p === "string" && isAbsolute(p) && !/[\0,\r\n]/.test(p)) || typeof workspaceIdentity !== "string" || workspaceIdentity.length > 256 || !Number.isSafeInteger(deadlineAt) || deadlineAt <= 0 || argv.some((x) => typeof x !== "string" || x.includes("\0"))) fail("CONTAINER_ARGUMENT_INVALID");
  let identity;
  try {
    identity = JSON.parse(workspaceIdentity);
  } catch {
    fail("CONTAINER_ARGUMENT_INVALID");
  }
  if (!object(identity) || Object.keys(identity).sort().join(",") !== "birth,dev,ino" || !["dev", "ino", "birth"].every((k) => typeof identity[k] === "string" && /^(0|[1-9][0-9]{0,39})$/.test(identity[k])) || identity.ino === "0" || identity.birth === "0") fail("CONTAINER_ARGUMENT_INVALID");
  return ["container", "create", "--pull=never", "--platform", "linux/amd64", "--name", name, "--label", `dsh.worker.nonce=${nonce}`, "--label", `dsh.worker.machine=${machineId}`, "--network=none", "--read-only", "--cap-drop=ALL", "--cap-add=SETUID", "--cap-add=SETGID", "--security-opt=no-new-privileges", "--user", "0:0", "--pids-limit=64", "--memory=128m", "--cpus=0.5", "--log-driver=json-file", "--log-opt=max-size=8m", "--log-opt=max-file=1", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "--mount", `type=bind,src=${workspace},dst=/workspace`, "--mount", `type=bind,src=${supervisorFile},dst=/opt/dsh-supervisor.mjs,readonly`, "--workdir", "/workspace", "--entrypoint", "/usr/local/bin/node", config.image, "/opt/dsh-supervisor.mjs", String(deadlineAt), workspaceIdentity, executable, ...argv];
}
var ContainerCommands = class {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    validateContainerCommandConfig(config);
    this.dockerEnv = env(join3(store.dataDir, "docker-client"));
    store.db.exec(`CREATE TABLE IF NOT EXISTS container_workers(operation_id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,nonce TEXT NOT NULL,context TEXT NOT NULL,root_id TEXT NOT NULL,workspace TEXT NOT NULL,input_digest TEXT NOT NULL,phase TEXT NOT NULL,cid TEXT,reason TEXT)`);
    if (!store.db.prepare("PRAGMA table_info(container_workers)").all().some((row) => row.name === "workspace_identity")) store.db.exec("ALTER TABLE container_workers ADD COLUMN workspace_identity TEXT");
  }
  store;
  config;
  dockerEnv;
  sessions = /* @__PURE__ */ new Map();
  controls = /* @__PURE__ */ new Map();
  sweeping = false;
  closing = false;
  sweepCursor = "";
  serialized(id2, fn) {
    const pending = (this.controls.get(id2) ?? Promise.resolve()).catch(() => {
    }).then(fn);
    this.controls.set(id2, pending);
    return pending.finally(() => {
      if (this.controls.get(id2) === pending) this.controls.delete(id2);
    });
  }
  async supervisor() {
    const path4 = join3(this.store.dataDir, "container-supervisor-" + sha(CONTAINER_SUPERVISOR_SOURCE) + ".mjs");
    try {
      const fd = await open2(path4, "wx", 292);
      try {
        await fd.writeFile(CONTAINER_SUPERVISOR_SOURCE);
        await fd.sync();
      } finally {
        await fd.close();
      }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const info = await lstat2(path4);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || sha(await readFile4(path4)) !== sha(CONTAINER_SUPERVISOR_SOURCE)) fail("CONTAINER_SUPERVISOR_CHANGED", 503);
    return path4;
  }
  async cli(args, timeout = 15e3) {
    await mkdir2(this.dockerEnv.DOCKER_CONFIG, { recursive: true, mode: 448 });
    try {
      return (await control(this.config.dockerExecutable, args, { env: this.dockerEnv, encoding: "utf8", timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true })).stdout.trim();
    } catch {
      fail("CONTAINER_CONTROL_UNAVAILABLE", 503);
    }
  }
  row(id2, c) {
    const row = this.store.db.prepare("SELECT * FROM container_workers WHERE operation_id=?").get(id2);
    if (!row) return null;
    this.store.own(row.context, c);
    if (!c.roots.includes(row.root_id)) fail("SCOPE_DENIED", 403);
    return row;
  }
  async inspect(row) {
    const ids = (await this.cli(["container", "ls", "-a", "--no-trunc", "--filter", `name=^/${row.name}$`, "--format", "{{.ID}}"])).split("\n").filter(Boolean);
    if (!ids.length) return null;
    if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]) || row.cid && row.cid !== ids[0]) fail("CONTAINER_IDENTITY_MISMATCH", 503);
    let value;
    try {
      value = JSON.parse(await this.cli(["container", "inspect", ids[0]]))[0];
    } catch {
      fail("CONTAINER_CONTROL_UNAVAILABLE", 503);
    }
    if (value?.Id !== ids[0] || value.Name !== "/" + row.name || value.Config?.Labels?.["dsh.worker.nonce"] !== row.nonce || value.Config?.Labels?.["dsh.worker.machine"] !== this.store.machineId) fail("CONTAINER_IDENTITY_MISMATCH", 503);
    const host = value.HostConfig, binds = (value.Mounts ?? []).filter((m) => m.Type === "bind");
    const workspace = binds.find((m) => m.Destination === "/workspace"), supervisor = binds.find((m) => m.Destination === "/opt/dsh-supervisor.mjs");
    const caps = host?.CapAdd?.map((name) => name.replace(/^CAP_/, ""));
    if (typeof row.workspace_identity !== "string" || value.Config?.Cmd?.[0] !== "/opt/dsh-supervisor.mjs" || value.Config.Cmd[2] !== row.workspace_identity || value.Config?.Entrypoint?.length !== 1 || value.Config.Entrypoint[0] !== "/usr/local/bin/node") fail("CONTAINER_POLICY_MISMATCH", 503);
    if (value.Config?.Image !== this.config.image || value.Config?.User !== "0:0" || host?.NetworkMode !== "none" || host?.ReadonlyRootfs !== true || host?.Privileged !== false || !host.CapDrop?.includes("ALL") || caps?.length !== 2 || !caps.includes("SETUID") || !caps.includes("SETGID") || !host.SecurityOpt?.includes("no-new-privileges") || binds.length !== 2 || workspace?.Source !== row.workspace || supervisor?.Source !== await this.supervisor() || supervisor?.RW !== false) fail("CONTAINER_POLICY_MISMATCH", 503);
    return value;
  }
  async probe() {
    try {
      const info = JSON.parse(await this.cli(["image", "inspect", this.config.image]))[0];
      if (info?.Architecture !== "amd64" || !info.RepoDigests?.includes(this.config.image)) fail("CONTAINER_IMAGE_MISMATCH");
      return { mode: "container", status: "dependency-ready", image: this.config.image, network: "none", filesystem: "workspace-only", user: "65532:65532", measurement: "requires-operation-check" };
    } catch {
      return { mode: "container", status: "unavailable", code: "CONTAINER_DEPENDENCY_UNAVAILABLE" };
    }
  }
  unknown(id2, code = "OUTCOME_UNKNOWN") {
    this.store.finish(id2, "unknown", { kind: "container-command", stopConfirmed: false, possiblyApplied: true }, code);
  }
  async logs(id2) {
    const child = spawn(this.config.dockerExecutable, ["container", "logs", id2], { env: this.dockerEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout = [], stderr = [];
    let bytes = 0, failed = false;
    const take = (list) => (chunk) => {
      const n = Math.min(chunk.length, Math.max(0, 8 * 1024 * 1024 - bytes));
      if (n) list.push(chunk.subarray(0, n));
      bytes += n;
    };
    child.stdout.on("data", take(stdout));
    child.stderr.on("data", take(stderr));
    const timer = setTimeout(() => {
      failed = true;
      child.kill("SIGKILL");
    }, 15e3);
    try {
      const code = await new Promise((resolve4, reject) => {
        child.once("error", reject);
        child.once("close", resolve4);
      });
      if (failed || code !== 0) fail("CONTAINER_OUTPUT_UNAVAILABLE", 503);
      return { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
    } finally {
      clearTimeout(timer);
    }
  }
  async settle(id2, c, observed, artifact, reason) {
    if (!observed || !["exited", "dead"].includes(observed.State?.Status) || observed.State?.Running !== false) {
      this.unknown(id2);
      return;
    }
    let logs;
    try {
      logs = await this.logs(observed.Id);
    } catch {
      this.unknown(id2, "CONTAINER_OUTPUT_UNAVAILABLE");
      return;
    }
    const out = await artifact(logs.stdout, c), err = await artifact(logs.stderr, c), exitCode = observed.State.ExitCode;
    const state = reason === "CANCELLED" || reason === "GRANT_REVOKED" ? "cancelled" : reason ? "failed" : exitCode === 0 ? "succeeded" : "failed";
    const result = { kind: "container-command", containerId: observed.Id, exitCode, stdoutArtifactId: out.artifactId, stderrArtifactId: err.artifactId, truncated: true, outputPolicy: "bounded-tail", stopConfirmed: true, possiblyApplied: true, isolation: { mode: "container", image: this.config.image, network: "none", user: "65532:65532" } };
    this.store.db.transaction(() => {
      this.store.finish(id2, state, result, reason ?? (state === "failed" ? "PROCESS_EXIT_NONZERO" : null));
      this.store.db.prepare("UPDATE container_workers SET phase='settled',reason=? WHERE operation_id=?").run(reason, id2);
    })();
    await this.cleanup(id2, c).catch(() => {
    });
  }
  async cleanup(id2, c) {
    const row = this.row(id2, c);
    if (!row || row.phase !== "settled" || !terminal.has(this.store.status(id2, c).status)) return;
    const value = await this.inspect(row);
    if (!value) {
      this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id2);
      return;
    }
    if (value.State?.Running !== false) fail("CONTAINER_STOP_UNCONFIRMED", 503);
    await this.cli(["container", "rm", value.Id]);
    this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id2);
  }
  async observe(id2, c, artifact) {
    return this.serialized(id2, () => this.observeOriginal(id2, c, artifact));
  }
  async observeOriginal(id2, c, artifact) {
    const row = this.row(id2, c);
    if (!row) return false;
    if (terminal.has(this.store.status(id2, c).status)) {
      await this.cleanup(id2, c).catch(() => {
      });
      return true;
    }
    if (this.sessions.has(id2)) return true;
    try {
      const value = await this.inspect(row);
      if (["prepared", "created"].includes(row.phase)) {
        if (value?.State?.Running || value && value.State?.Status !== "created") {
          this.unknown(id2);
          return true;
        }
        if (value) await this.cli(["container", "rm", value.Id]);
        this.store.db.transaction(() => {
          this.store.finish(id2, "cancelled", { kind: "container-command", notStarted: true, stopConfirmed: true, possiblyApplied: false }, "HOST_INTERRUPTED_BEFORE_START");
          this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id2);
        })();
      } else if (value) await this.settle(id2, c, value, artifact, row.reason);
      else this.unknown(id2);
    } catch {
      this.unknown(id2);
    }
    return true;
  }
  async cancel(id2, c, why = "CANCELLED") {
    const running = this.sessions.get(id2);
    if (running) {
      await running.cancel(why);
      return true;
    }
    return this.serialized(id2, () => this.cancelOriginal(id2, c, why));
  }
  async cancelOriginal(id2, c, why) {
    const row = this.row(id2, c);
    if (!row || terminal.has(this.store.status(id2, c).status)) return !!row;
    const value = await this.inspect(row);
    if (value?.State?.Running) {
      this.store.db.prepare("UPDATE container_workers SET reason=? WHERE operation_id=?").run(why, id2);
      await this.cli(["container", "kill", "--signal=KILL", value.Id], 5e3);
    } else if (value?.State?.Status === "created") {
      await this.cli(["container", "rm", value.Id]);
      this.store.db.transaction(() => {
        this.store.finish(id2, "cancelled", { kind: "container-command", stopConfirmed: true, possiblyApplied: row.phase === "starting", notStarted: row.phase !== "starting" }, why);
        this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id2);
      })();
    }
    return true;
  }
  async sweep(artifact) {
    if (this.sweeping || this.closing) return;
    this.sweeping = true;
    try {
      const rows = this.store.db.prepare("SELECT operation_id,context FROM container_workers WHERE phase!='removed' AND operation_id>? ORDER BY operation_id LIMIT 4").all(this.sweepCursor);
      if (!rows.length) this.sweepCursor = "";
      for (const row of rows) {
        if (this.closing) break;
        this.sweepCursor = row.operation_id;
        if (this.sessions.has(row.operation_id)) continue;
        const c = JSON.parse(row.context);
        let valid = true;
        try {
          this.store.validate(c);
        } catch {
          valid = false;
        }
        if (!valid) try {
          await this.cancel(row.operation_id, c, "GRANT_REVOKED");
        } catch {
        }
        if (this.closing) break;
        try {
          await this.observe(row.operation_id, c, artifact);
        } catch {
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
  async run({ id: id2, c, rootId, workspace, workspaceIdentity, executable, argv, timeout, validate, validateWorkspace, shouldCancel, artifact }) {
    const name = "dsh-worker-" + sha(canonical({ machine: this.store.machineId, id: id2 })).slice(0, 40), nonce = randomUUID6(), digest2 = sha(canonical({ rootId, workspace, workspaceIdentity, executable, argv, image: this.config.image }));
    const deadlineAt = Math.min(c.expiresAt, Date.now() + timeout), supervisorFile = await this.supervisor();
    const args = containerArguments({ name, nonce, machineId: this.store.machineId, workspace, workspaceIdentity, config: this.config, executable, argv, deadlineAt, supervisorFile });
    this.store.db.prepare("INSERT INTO container_workers(operation_id,name,nonce,context,root_id,workspace,input_digest,phase,cid,reason,workspace_identity) VALUES (?,?,?,?,?,?,?,'prepared',NULL,NULL,?)").run(id2, name, nonce, canonical(c), rootId, workspace, digest2, workspaceIdentity);
    let reason = null, child, controlLost = false, cancelling, closed2 = false;
    const cancel = (why) => {
      reason ??= why;
      this.store.db.prepare("UPDATE container_workers SET reason=? WHERE operation_id=?").run(reason, id2);
      return cancelling ??= (async () => {
        try {
          const row = this.row(id2, c), value = await this.inspect(row);
          if (value?.State?.Running) await this.cli(["container", "kill", "--signal=KILL", value.Id], 5e3);
        } catch {
          controlLost = true;
        } finally {
          if (child && !closed2) {
            const timer2 = setTimeout(() => {
              if (!closed2) {
                controlLost = true;
                try {
                  process.kill(-child.pid, "SIGKILL");
                } catch {
                }
              }
            }, 3e3);
            timer2.unref();
          }
        }
      })();
    };
    this.sessions.set(id2, { cancel });
    const timer = setTimeout(() => void cancel("PROCESS_TIMEOUT"), timeout);
    try {
      validate();
      if (shouldCancel()) reason = "CANCELLED";
      if (reason) {
        this.store.finish(id2, "cancelled", { kind: "container-command", notStarted: true, stopConfirmed: true, possiblyApplied: false }, reason);
        this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id2);
        return;
      }
      const ready = await this.probe();
      if (ready.status !== "dependency-ready") fail("CONTAINER_DEPENDENCY_UNAVAILABLE", 503);
      await validateWorkspace();
      validate();
      const cid = await this.cli(args);
      if (!/^[a-f0-9]{64}$/.test(cid)) fail("CONTAINER_CONTROL_UNAVAILABLE", 503);
      this.store.db.prepare("UPDATE container_workers SET cid=?,phase='created' WHERE operation_id=?").run(cid, id2);
      await validateWorkspace();
      validate();
      if (shouldCancel()) reason ??= "CANCELLED";
      if (reason) {
        const row = this.row(id2, c), value = await this.inspect(row);
        if (value?.State?.Status !== "created") fail("OUTCOME_UNKNOWN");
        await this.cli(["container", "rm", cid]);
        this.store.db.transaction(() => {
          this.store.finish(id2, "cancelled", { kind: "container-command", notStarted: true, stopConfirmed: true, possiblyApplied: false }, reason);
          this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id2);
        })();
        return;
      }
      this.store.db.prepare("UPDATE container_workers SET phase='starting' WHERE operation_id=?").run(id2);
      child = spawn(this.config.dockerExecutable, ["container", "start", "-a", cid], { env: this.dockerEnv, detached: true, stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
      await new Promise((resolve4, reject) => {
        child.once("error", reject);
        child.once("close", () => {
          closed2 = true;
          resolve4();
        });
      });
      await cancelling;
      if (controlLost) {
        this.unknown(id2);
        return;
      }
      await this.settle(id2, c, await this.inspect(this.row(id2, c)), artifact, reason);
    } catch (e) {
      const row = this.row(id2, c);
      if (row?.phase === "starting") {
        this.unknown(id2);
      } else {
        try {
          const value = await this.inspect(row);
          if (value?.State?.Status !== "created" && value !== null) throw Error();
          if (value) await this.cli(["container", "rm", value.Id]);
          this.store.db.transaction(() => {
            this.store.finish(id2, reason ? "cancelled" : "failed", { kind: "container-command", notStarted: true, stopConfirmed: true, possiblyApplied: false }, reason ?? (e instanceof AgentError ? e.code : "EXECUTION_FAILED"));
            this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id2);
          })();
        } catch {
          this.unknown(id2);
        }
      }
    } finally {
      clearTimeout(timer);
      this.sessions.delete(id2);
    }
  }
  async close() {
    this.closing = true;
    await Promise.all([...this.sessions.values()].map((s) => s.cancel("CANCELLED")));
    await Promise.allSettled([...this.controls.values()]);
    while (this.sweeping) await new Promise((r) => setTimeout(r, 10));
  }
};

// src/workspace-identity.ts
import { constants as constants2 } from "node:fs";
import { lstat as lstat3, mkdir as mkdir3, open as open3, readFile as readFile5, realpath as realpath2, stat as stat3, unlink as unlink2, writeFile } from "node:fs/promises";
import path2 from "node:path";
function physical(s) {
  if (!s.isDirectory() || s.ino <= 0n || s.dev < 0n || s.birthtimeNs <= 0n) fail("WORKSPACE_IDENTITY_UNAVAILABLE", 503);
  return { dev: String(s.dev), ino: String(s.ino), birth: String(s.birthtimeNs) };
}
var key = (s) => sha(canonical(physical(s)));
var ROOT_LOCK_DIRECTORY = "/tmp/dsh-agent-root-locks";
var rootLocks = /* @__PURE__ */ new Map();
var rootLockDegrades = { lastUnavailableAt: null };
var alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};
async function createRootClaim(lockPath) {
  await mkdir3(ROOT_LOCK_DIRECTORY, { recursive: true, mode: 448 }).catch(() => {
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle;
    try {
      handle = await open3(lockPath, "wx", 384);
      await writeFile(handle, JSON.stringify({ pid: process.pid }));
      return { count: 1, path: lockPath, handle };
    } catch (e) {
      await handle?.close().catch(() => {
      });
      const code = e?.code;
      if (code === "EACCES" || code === "EPERM") {
        rootLockDegrades.lastUnavailableAt = Date.now();
        return { count: 1, path: "", handle: void 0 };
      }
      if (code !== "EEXIST") throw e;
    }
    let stolen = false;
    try {
      const held = await open3(lockPath, "r"), self = await held.stat(), named = await lstat3(lockPath);
      try {
        const owner = JSON.parse(await readFile5(held, { encoding: "utf8" }));
        if (!alive(Number(owner?.pid)) && named.dev === self.dev && named.ino === self.ino && !named.isSymbolicLink()) {
          await unlink2(lockPath).catch(() => {
          });
          stolen = true;
        }
      } finally {
        await held.close();
      }
    } catch {
    }
    if (!stolen) fail("WORKSPACE_BUSY", 409);
  }
  fail("WORKSPACE_BUSY", 409);
}
async function acquireRootLock(stat8) {
  const lockKey = `${stat8.dev}:${stat8.ino}`;
  const existing = rootLocks.get(lockKey);
  if (existing) {
    const lock = await existing;
    lock.count++;
    return lock;
  }
  const pending = createRootClaim(`${ROOT_LOCK_DIRECTORY}/${lockKey}`).then((lock) => {
    rootLocks.set(lockKey, lock);
    return lock;
  });
  rootLocks.set(lockKey, pending);
  try {
    return await pending;
  } catch (e) {
    rootLocks.delete(lockKey);
    throw e;
  }
}
async function releaseRootLock(lockKey, lock) {
  if (--lock.count > 0) return;
  if (rootLocks.get(lockKey) === lock) rootLocks.delete(lockKey);
  if (!lock.handle) return;
  try {
    const self = await lock.handle.stat(), named = await lstat3(lock.path);
    if (named.dev === self.dev && named.ino === self.ino && !named.isSymbolicLink()) await unlink2(lock.path).catch(() => {
    });
  } catch {
  }
  await lock.handle.close().catch(() => {
  });
}
async function snapshot(target) {
  if (!["linux", "win32"].includes(process.platform) || typeof target !== "string" || !path2.isAbsolute(target) || target.length > 4096 || target.includes("\0")) fail("WORKSPACE_IDENTITY_UNAVAILABLE", 503);
  const actual = await realpath2(target), first = await stat3(actual, { bigint: true }), ancestors = [];
  let current = actual;
  for (let depth = 0; ; depth++) {
    if (depth >= 128) fail("WORKSPACE_IDENTITY_UNAVAILABLE", 503);
    ancestors.push(key(depth === 0 ? first : await stat3(current, { bigint: true })));
    const parent = path2.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (key(await stat3(actual, { bigint: true })) !== ancestors[0] || await realpath2(target) !== actual) fail("WORKSPACE_CHANGED", 409);
  return { identity: { key: ancestors[0], ancestors: [...new Set(ancestors)], path: actual, platform: process.platform }, physical: physical(first) };
}
var WorkspacePin = class _WorkspacePin {
  constructor(identity, mountIdentity, handle, rootLock) {
    this.identity = identity;
    this.mountIdentity = mountIdentity;
    this.handle = handle;
    this.rootLock = rootLock;
  }
  identity;
  mountIdentity;
  handle;
  rootLock;
  closed = false;
  static async capture(target) {
    const value = await snapshot(target);
    let handle, rootLock;
    try {
      if (process.platform === "linux") {
        handle = await open3(value.identity.path, constants2.O_RDONLY | constants2.O_DIRECTORY | constants2.O_NOFOLLOW);
        const held = await handle.stat({ bigint: true });
        if (key(held) !== value.identity.key) fail("WORKSPACE_CHANGED", 409);
        const stat8 = { dev: held.dev, ino: held.ino };
        rootLock = { key: `${stat8.dev}:${stat8.ino}`, lock: await acquireRootLock(stat8) };
      }
      const pin = new _WorkspacePin(Object.freeze({ ...value.identity, ancestors: Object.freeze(value.identity.ancestors) }), canonical(value.physical), handle, rootLock);
      await pin.verify();
      return pin;
    } catch (e) {
      await handle?.close();
      if (rootLock) await releaseRootLock(rootLock.key, rootLock.lock).catch(() => {
      });
      throw e;
    }
  }
  get scanPath() {
    if (this.closed) fail("WORKSPACE_PIN_CLOSED");
    return this.handle ? `/proc/${process.pid}/fd/${this.handle.fd}/.` : this.identity.path;
  }
  async verify() {
    if (this.closed) fail("WORKSPACE_PIN_CLOSED");
    const current = await snapshot(this.identity.path);
    if (canonical(current.identity) !== canonical(this.identity) || current.physical && canonical(current.physical) !== this.mountIdentity) fail("WORKSPACE_CHANGED", 409);
    if (this.handle && (key(await this.handle.stat({ bigint: true })) !== this.identity.key || await realpath2(`/proc/${process.pid}/fd/${this.handle.fd}`) !== this.identity.path)) fail("WORKSPACE_CHANGED", 409);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.rootLock) await releaseRootLock(this.rootLock.key, this.rootLock.lock).catch(() => {
    });
    await this.handle?.close();
  }
};

// src/workspace-admission.ts
import { isAbsolute as isAbsolute2 } from "node:path";
var IDENTITY_KEYS = ["key", "ancestors", "path", "platform"];
var HEX64 = /^[a-f0-9]{64}$/;
var MAX_ANCESTORS = 128;
var MAX_PATH = 4096;
var PLATFORMS = /* @__PURE__ */ new Set(["linux", "win32"]);
var ROOT_WRITING_TOOLS = ["fs_write", "shell_exec", "container_command_v1"];
var STOP_EVIDENCE_TOOLS = /* @__PURE__ */ new Set(["shell_exec"]);
var MAX_ACTIVE_ADMISSIONS = 4096;
var TERMINAL = /* @__PURE__ */ new Set(["succeeded", "failed", "cancelled"]);
var LIVE = /* @__PURE__ */ new Set(["admitted", "running"]);
var WorkspaceAdmissions = class {
  constructor(store, generation = "") {
    this.store = store;
    this.generation = generation;
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS workspace_admissions(
        operation_id TEXT PRIMARY KEY REFERENCES operations(id),
        tool TEXT NOT NULL,
        root_key TEXT NOT NULL,
        path TEXT NOT NULL,
        platform TEXT NOT NULL,
        ancestors TEXT NOT NULL,
        ancestor_count INTEGER NOT NULL,
        context TEXT NOT NULL,
        acquired_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS workspace_admissions_root ON workspace_admissions(root_key);
      DROP TRIGGER IF EXISTS workspace_admissions_receipt;
      CREATE TRIGGER workspace_admissions_receipt
        AFTER UPDATE OF status ON operations
        FOR EACH ROW
        WHEN NEW.status IN ('succeeded','failed','cancelled')
        BEGIN
          DELETE FROM workspace_admissions WHERE operation_id = NEW.id AND (
            NEW.tool <> 'shell_exec'
            OR (json_valid(NEW.result) AND json_type(NEW.result,'$.stopConfirmed') = 'true')
            OR (json_valid(NEW.result) AND json_type(NEW.result,'$.notStarted') = 'true'));
        END;`);
    if (!this.store.db.pragma("table_info(workspace_admissions)").some((column) => column.name === "roots_generation"))
      this.store.db.exec("ALTER TABLE workspace_admissions ADD COLUMN roots_generation TEXT NOT NULL DEFAULT ''");
  }
  store;
  generation;
  /** Maximum number of simultaneously active admissions; explicit and closed. */
  MAX_ACTIVE_ADMISSIONS = MAX_ACTIVE_ADMISSIONS;
  /** Acquire the physical root for a live original operation; replay is idempotent. */
  admit(operationId, context, identity) {
    identifier(operationId);
    const root = this.verify(identity);
    return this.immediate(() => {
      this.store.validate(context);
      const operation = this.store.db.prepare("SELECT * FROM operations WHERE id=?").get(operationId);
      if (!operation) fail("OPERATION_NOT_FOUND", 404);
      this.store.own(operation.context, context);
      if (!ROOT_WRITING_TOOLS.includes(operation.tool)) fail("WORKSPACE_TOOL_NOT_SUPPORTED");
      if (!LIVE.has(operation.status)) fail("OPERATION_CONFLICT", 409);
      const saved = this.store.db.prepare("SELECT * FROM workspace_admissions WHERE operation_id=?").get(operationId);
      if (saved) {
        this.store.own(saved.context, context);
        if (saved.root_key !== root.key || saved.path !== root.path || saved.platform !== root.platform || saved.ancestors !== canonical(root.ancestors)) fail("WORKSPACE_CONFLICT", 409);
        return { fresh: false, admission: this.decode(saved) };
      }
      const holder = this.holder(root, operationId);
      if (holder) fail("WORKSPACE_BUSY", 409);
      const active = this.store.db.prepare("SELECT count(*) AS count FROM workspace_admissions").get();
      if (active.count >= MAX_ACTIVE_ADMISSIONS) fail("WORKSPACE_ADMISSION_LIMIT", 429);
      this.store.db.prepare("INSERT INTO workspace_admissions(operation_id,tool,root_key,path,platform,ancestors,ancestor_count,context,acquired_at,roots_generation) VALUES (?,?,?,?,?,?,?,?,?,?)").run(operationId, operation.tool, root.key, root.path, root.platform, canonical(root.ancestors), root.ancestors.length, canonical(context), Date.now(), this.generation);
      return { fresh: true, admission: this.decode(this.store.db.prepare("SELECT * FROM workspace_admissions WHERE operation_id=?").get(operationId)) };
    });
  }
  /** Read-side check: no other admitted operation may overlap this physical root. */
  assertAvailable(identity, exceptOperationId) {
    const root = this.verify(identity);
    if (exceptOperationId !== void 0) identifier(exceptOperationId);
    this.immediate(() => {
      if (this.holder(root, exceptOperationId ?? "")) fail("WORKSPACE_BUSY", 409);
    });
  }
  /** Release only on a persisted terminal receipt; the receipt commit and the release share one transaction. */
  releaseIfTerminal(operationId, context) {
    identifier(operationId);
    return this.immediate(() => {
      this.store.validate(context);
      const admission = this.store.db.prepare("SELECT * FROM workspace_admissions WHERE operation_id=?").get(operationId);
      const operation = this.store.db.prepare("SELECT * FROM operations WHERE id=?").get(operationId);
      if (admission) this.store.own(admission.context, context);
      if (operation) this.store.own(operation.context, context);
      if (!operation) return { operationId, status: null, released: false, reason: "OPERATION_NOT_FOUND" };
      if (!admission) return { operationId, status: operation.status, released: TERMINAL.has(operation.status) && this.stopped(operation), reason: TERMINAL.has(operation.status) && this.stopped(operation) ? "ALREADY_RELEASED" : "NOT_ADMITTED" };
      if (!TERMINAL.has(operation.status)) return { operationId, status: operation.status, released: false, reason: "NON_TERMINAL" };
      if (!this.stopped(operation)) return { operationId, status: operation.status, released: false, reason: "STOP_UNCONFIRMED" };
      return { operationId, status: operation.status, released: this.store.db.prepare("DELETE FROM workspace_admissions WHERE operation_id=?").run(operationId).changes > 0, reason: null };
    });
  }
  /** Active admissions, optionally narrowed to one grant subject. */
  list(context) {
    return this.immediate(() => {
      if (context !== void 0) this.store.validate(context);
      return this.store.db.prepare("SELECT * FROM workspace_admissions ORDER BY acquired_at,operation_id").all().map((row) => this.decode(row)).filter((a) => context === void 0 || a.clientId === context.clientId && a.botId === context.botId && a.taskId === context.taskId && a.attemptId === context.attemptId);
    });
  }
  verify(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail("INVALID_WORKSPACE_IDENTITY");
    const keys = Object.keys(value);
    if (keys.length !== IDENTITY_KEYS.length || !keys.every((k) => IDENTITY_KEYS.includes(k))) fail("INVALID_WORKSPACE_IDENTITY");
    const { key: key2, ancestors, path: path4, platform } = value;
    if (typeof key2 !== "string" || !HEX64.test(key2)) fail("INVALID_WORKSPACE_IDENTITY");
    if (!Array.isArray(ancestors) || !ancestors.length || ancestors.length > MAX_ANCESTORS || ancestors.some((x) => typeof x !== "string" || !HEX64.test(x))) fail("INVALID_WORKSPACE_IDENTITY");
    const chain = [...new Set(ancestors)];
    if (!chain.includes(key2)) fail("INVALID_WORKSPACE_IDENTITY");
    if (typeof path4 !== "string" || !path4.length || path4.length > MAX_PATH || path4.includes("\0") || !isAbsolute2(path4)) fail("INVALID_WORKSPACE_IDENTITY");
    if (typeof platform !== "string" || !PLATFORMS.has(platform)) fail("INVALID_WORKSPACE_IDENTITY");
    return { key: key2, ancestors: chain, path: path4, platform };
  }
  /** Same physical root (alias) or an overlapping parent/child branch conflicts. */
  holder(root, exceptOperationId) {
    return this.store.db.prepare(`SELECT operation_id,path,root_key FROM workspace_admissions
      WHERE operation_id <> @except AND (root_key = @key
        OR EXISTS (SELECT 1 FROM json_each(ancestors) WHERE value = @key)
        OR EXISTS (SELECT 1 FROM json_each(@ancestors) WHERE value = root_key))
      ORDER BY acquired_at,operation_id LIMIT 1`).get({ except: exceptOperationId, key: root.key, ancestors: canonical(root.ancestors) }) ?? null;
  }
  decode(row) {
    const context = JSON.parse(row.context);
    return { operationId: row.operation_id, tool: row.tool, rootKey: row.root_key, path: row.path, platform: row.platform, ancestors: JSON.parse(row.ancestors), clientId: context.clientId, botId: context.botId, taskId: context.taskId, attemptId: context.attemptId, acquiredAt: row.acquired_at };
  }
  /** A supervisor receipt must prove the stop before a shell lock is dropped. */
  stopped(operation) {
    if (!TERMINAL.has(operation.status)) return false;
    if (!STOP_EVIDENCE_TOOLS.has(operation.tool)) return true;
    let result = null;
    try {
      result = operation.result ? JSON.parse(operation.result) : null;
    } catch {
      return false;
    }
    return result?.stopConfirmed === true || result?.notStarted === true;
  }
  immediate(fn) {
    const db = this.store.db;
    if (db.inTransaction) return fn();
    try {
      db.exec("BEGIN IMMEDIATE");
    } catch (e) {
      throw this.busy(e);
    }
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
      ;
      throw this.busy(e);
    }
  }
  busy(e) {
    if (e instanceof AgentError) return e;
    if (typeof e?.code === "string" && (e.code.startsWith("SQLITE_BUSY") || e.code === "SQLITE_LOCKED")) return new AgentError("DATABASE_BUSY", 503);
    return e;
  }
};

// src/workspace-generation.ts
import { resolve } from "node:path";
var ROOTS_GENERATION_META_KEY = "workspaceRootsGeneration";
function rootsGeneration(roots = {}) {
  const entries = Object.entries(roots).map(([id2, value]) => [id2, resolve(value)]);
  entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return sha(canonical(entries));
}
function reconcileRootsGeneration(db, generation) {
  db.exec("CREATE TABLE IF NOT EXISTS workspace_generation_fences(operation_id TEXT PRIMARY KEY)");
  const saved = db.prepare("SELECT value FROM meta WHERE key=?").get(ROOTS_GENERATION_META_KEY)?.value;
  if (saved === generation) return { changed: false };
  if (saved === void 0) {
    db.prepare("INSERT INTO meta VALUES (?,?)").run(ROOTS_GENERATION_META_KEY, generation);
    return { changed: false };
  }
  const fenced = db.prepare(`INSERT OR IGNORE INTO workspace_generation_fences
    SELECT a.operation_id FROM workspace_admissions a JOIN operations o ON o.id=a.operation_id
    WHERE o.status IN ('admitted','running','cancel_pending','unknown')
       OR (o.tool='shell_exec' AND NOT (o.status IN ('succeeded','failed','cancelled')
           AND (coalesce(json_type(o.result,'$.stopConfirmed'),'null')='true'
             OR coalesce(json_type(o.result,'$.notStarted'),'null')='true')))`).run().changes;
  db.prepare("UPDATE meta SET value=? WHERE key=?").run(generation, ROOTS_GENERATION_META_KEY);
  return { changed: true, fenced };
}

// src/pinned-write.ts
import { constants as constants3 } from "node:fs";
import { open as open4, lstat as lstat4, stat as stat4, realpath as realpath3, link, unlink as unlink3 } from "node:fs/promises";
import path3 from "node:path";
import { randomBytes as randomBytes3 } from "node:crypto";
var PINNED_WRITE_MAX_BYTES = 1048576;
var PINNED_WRITE_MAX_LIMIT_BYTES = 16 * 1024 * 1024;
var PINNED_WRITE_MAX_PATH_BYTES = 4096;
var PINNED_WRITE_MAX_COMPONENTS = 64;
var PINNED_WRITE_MAX_COMPONENT_BYTES = 255;
var PINNED_WRITE_TEMP_PREFIX = ".dsh-pinned-write-";
var DIRECTORY_FLAGS = constants3.O_RDONLY | constants3.O_DIRECTORY | (constants3.O_NOFOLLOW ?? 0);
var TEMP_FLAGS = constants3.O_RDWR | constants3.O_CREAT | constants3.O_EXCL;
var BIG = { bigint: true };
var failWrite = (code, status = 409, extra = {}) => {
  throw Object.assign(new AgentError(code, status), extra);
};
var failAfterPublish = (code, status = 409, extra = {}) => {
  throw Object.assign(new AgentError(code, status), { published: true, possiblyApplied: true, ...extra });
};
var annotatePublished = (e) => e instanceof AgentError ? Object.assign(e, { published: true, possiblyApplied: true }) : e;
var retireTempName = async (pinned, tempName) => {
  let code = "OK";
  try {
    await unlink3(pinned.childPath(tempName));
  } catch (e) {
    code = fsCode(e);
  }
  try {
    if (await pinned.lstatChild(tempName) === null) return { retired: true, fsCode: "OK" };
  } catch (e) {
    code = fsCode(e);
  }
  return { retired: false, fsCode: code };
};
var guard = async (work, reason) => {
  try {
    return await work();
  } catch (e) {
    if (e instanceof AgentError) throw e;
    throw Object.assign(new AgentError("PINNED_WRITE_FAILED", 500), { reason, fsCode: fsCode(e), cause: e });
  }
};
var publishedGuard = async (work, reason) => guard(work, reason).catch((e) => {
  throw annotatePublished(e);
});
var fsCode = (e) => e && typeof e === "object" && typeof e.code === "string" ? e.code : "UNKNOWN";
var identityOf = (s) => ({ dev: String(s.dev), ino: String(s.ino) });
function pinnedWriteSupported(platform = process.platform) {
  return platform === "linux";
}
var PinnedDirectory = class _PinnedDirectory {
  constructor(handle, hostPath) {
    this.handle = handle;
    this.hostPath = hostPath;
  }
  handle;
  hostPath;
  /**
   * Open `resolvedRoot` plus every `components` entry one at a time with
   * `O_DIRECTORY|O_NOFOLLOW`, so no intermediate component of the target path
   * can be a symlink or a non-directory. `resolvedRoot` must already be free of
   * symlinks (the caller resolves it once with `realpath`); resolving the whole
   * path here would silently follow a symlinked component instead of refusing.
   */
  static async pin(resolvedRoot, components = []) {
    if (!pinnedWriteSupported()) failWrite("PINNED_WRITE_UNSUPPORTED", 503, { platform: process.platform });
    if (typeof resolvedRoot !== "string" || !resolvedRoot || resolvedRoot.includes("\0") || !path3.posix.isAbsolute(resolvedRoot) || Buffer.byteLength(resolvedRoot) > PINNED_WRITE_MAX_PATH_BYTES) failWrite("INVALID_ARGUMENT", 400, { reason: "pin-root" });
    for (const part of components) if (typeof part !== "string" || !part || part.includes("\0") || part.includes("/") || part === "." || part === ".." || Buffer.byteLength(part) > PINNED_WRITE_MAX_COMPONENT_BYTES) failWrite("INVALID_ARGUMENT", 400, { reason: "pin-component" });
    const parts = [...resolvedRoot.split("/").filter(Boolean), ...components];
    let handle;
    try {
      handle = await open4("/", DIRECTORY_FLAGS);
    } catch (e) {
      throw await mapDirectoryError(e, "/", "root");
    }
    for (const part of parts) {
      const child = `${descriptorPath(handle)}/${part}`;
      let next;
      try {
        next = await open4(child, DIRECTORY_FLAGS);
      } catch (e) {
        let mapped;
        try {
          mapped = await mapDirectoryError(e, child, "component");
        } finally {
          await handle.close().catch(() => {
          });
        }
        throw mapped;
      }
      await handle.close().catch(() => {
      });
      handle = next;
    }
    return new _PinnedDirectory(handle, path3.posix.join(resolvedRoot, ...components));
  }
  get fd() {
    return this.handle.fd;
  }
  /** Descriptor path of the held directory. */
  get fdPath() {
    return descriptorPath(this.handle);
  }
  /** Scan form of the descriptor path, mirroring `WorkspacePin.scanPath`. */
  get scanPath() {
    return `${this.fdPath}/`;
  }
  /** Path of a child entry addressed through the held descriptor. */
  childPath(name) {
    return `${this.fdPath}/${name}`;
  }
  async identity() {
    return identityOf(await this.handle.stat(BIG));
  }
  /** lstat a child through the descriptor; `null` when the name does not exist. */
  async lstatChild(name) {
    try {
      return await lstat4(this.childPath(name), BIG);
    } catch (e) {
      if (fsCode(e) === "ENOENT") return null;
      throw await mapDirectoryError(e, this.childPath(name), "child");
    }
  }
  /**
   * Re-observe the host path and require that it still denotes the held inode.
   * Detects rename, replacement, deletion and mount swaps of the directory.
   */
  async verifyHostPath(expectedHostPath) {
    const actual = await realpath3(this.fdPath).catch(() => null);
    if (actual !== expectedHostPath) failWrite("DIRECTORY_CHANGED", 409, { reason: "descriptor-path", expected: expectedHostPath, actual });
    const current = await stat4(expectedHostPath, BIG).catch(() => null);
    if (!current) failWrite("DIRECTORY_CHANGED", 409, { reason: "host-path-unreadable", expected: expectedHostPath });
    const pinned = await guard(() => this.identity(), "descriptor-stat");
    if (pinned.dev !== String(current.dev) || pinned.ino !== String(current.ino)) failWrite("DIRECTORY_CHANGED", 409, { reason: "descriptor-identity", expected: identityOf(current), actual: pinned });
  }
  /** Best-effort durability of names created in this directory. */
  async sync() {
    await this.handle.sync().catch(() => {
    });
  }
  async close() {
    await this.handle.close().catch(() => {
    });
  }
};
var descriptorPath = (handle) => `/proc/${process.pid}/fd/${handle.fd}`;
async function mapDirectoryError(e, at, phase) {
  const code = fsCode(e);
  if (code === "ELOOP") return Object.assign(new AgentError("WORKSPACE_OUTSIDE_SCOPE", 403), { reason: "symlink-component", at, phase });
  if (code === "ENOTDIR") {
    const entry = await lstat4(at, BIG).catch(() => null);
    if (entry?.isSymbolicLink()) return Object.assign(new AgentError("WORKSPACE_OUTSIDE_SCOPE", 403), { reason: "symlink-component", at, phase, fsCode: code });
    return Object.assign(new AgentError("TARGET_PARENT_INVALID", 400), { reason: entry ? "non-directory-component" : "component-vanished", at, phase, fsCode: code });
  }
  if (code === "ENOENT" || code === "ENOTEMPTY") return Object.assign(new AgentError("TARGET_PARENT_INVALID", 400), { reason: "missing-component", at, phase });
  if (code === "EACCES" || code === "EPERM") return Object.assign(new AgentError("PINNED_WRITE_FAILED", 500), { reason: "permission", at, phase, fsCode: code });
  return Object.assign(new AgentError("PINNED_WRITE_FAILED", 500), { reason: "directory-open", at, phase, fsCode: code });
}
async function resolveRoot(rootPath) {
  if (typeof rootPath !== "string" || !rootPath || rootPath.includes("\0") || !path3.posix.isAbsolute(rootPath) || Buffer.byteLength(rootPath) > PINNED_WRITE_MAX_PATH_BYTES) failWrite("INVALID_ARGUMENT", 400, { reason: "root-path" });
  try {
    return await realpath3(rootPath);
  } catch (e) {
    const code = fsCode(e);
    if (code === "ENOENT" || code === "ENOTDIR") failWrite("TARGET_PARENT_INVALID", 400, { reason: "root-missing", fsCode: code });
    if (code === "ELOOP") failWrite("WORKSPACE_OUTSIDE_SCOPE", 403, { reason: "root-symlink", fsCode: code });
    failWrite("PINNED_WRITE_FAILED", 500, { reason: "root-unreadable", fsCode: code });
  }
}
function splitComponents(relativePath) {
  if (typeof relativePath !== "string" || relativePath.includes("\0") || Buffer.byteLength(relativePath) > PINNED_WRITE_MAX_PATH_BYTES) failWrite("INVALID_ARGUMENT", 400, { reason: "relative-path" });
  if (path3.posix.isAbsolute(relativePath)) failWrite("WORKSPACE_OUTSIDE_SCOPE", 403, { reason: "absolute-relative-path" });
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  if (!parts.length || parts.length > PINNED_WRITE_MAX_COMPONENTS) failWrite("INVALID_ARGUMENT", 400, { reason: "component-count", count: parts.length });
  for (const part of parts) {
    if (part === "." || part === "..") failWrite("WORKSPACE_OUTSIDE_SCOPE", 403, { reason: "dot-component", component: part });
    if (Buffer.byteLength(part) > PINNED_WRITE_MAX_COMPONENT_BYTES) failWrite("INVALID_ARGUMENT", 400, { reason: "component-too-long" });
    if (/[. ]$/.test(part)) failWrite("INVALID_ARGUMENT", 400, { reason: "component-suffix" });
    if (/[\u0000-\u001f\u007f]/.test(part)) failWrite("INVALID_ARGUMENT", 400, { reason: "component-control" });
  }
  return parts;
}
function toBuffer(content, encoding) {
  if (encoding !== void 0 && encoding !== "utf8" && encoding !== "base64") failWrite("INVALID_ARGUMENT", 400, { reason: "encoding" });
  if (typeof content === "string") {
    if (encoding === "base64") {
      const compact = content.replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) failWrite("INVALID_ARGUMENT", 400, { reason: "base64" });
      return Buffer.from(compact, "base64");
    }
    return Buffer.from(content, "utf8");
  }
  if (content instanceof Uint8Array) {
    try {
      return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    } catch {
      failWrite("INVALID_ARGUMENT", 400, { reason: "content-buffer" });
    }
  }
  failWrite("INVALID_ARGUMENT", 400, { reason: "content-type" });
}
async function writeAll(handle, data, signal) {
  let offset = 0;
  while (offset < data.byteLength) {
    if (signal?.aborted) failWrite("WRITE_CANCELLED", 409, { reason: "during-write", possiblyApplied: false });
    const written = await guard(() => handle.write(data, offset, data.byteLength - offset), "temp-write");
    if (!written.bytesWritten) failWrite("PINNED_WRITE_FAILED", 500, { reason: "short-write", offset });
    offset += written.bytesWritten;
  }
}
async function pinnedCreateNewFile(request) {
  if (!request || typeof request !== "object") failWrite("INVALID_ARGUMENT", 400, { reason: "request" });
  const { rootPath, relativePath, content, encoding, maxBytes = PINNED_WRITE_MAX_BYTES, signal, check } = request;
  if (!pinnedWriteSupported()) failWrite("PINNED_WRITE_UNSUPPORTED", 503, { platform: process.platform });
  if (check !== void 0 && typeof check !== "function") failWrite("INVALID_ARGUMENT", 400, { reason: "check" });
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > PINNED_WRITE_MAX_LIMIT_BYTES) failWrite("INVALID_ARGUMENT", 400, { reason: "max-bytes" });
  const data = toBuffer(content, encoding);
  if (data.byteLength > maxBytes) failWrite("INVALID_ARGUMENT", 400, { reason: "content-too-large", limit: maxBytes });
  const digest2 = sha(data);
  const components = splitComponents(relativePath);
  const root = await resolveRoot(rootPath);
  const targetName = components[components.length - 1];
  const directoryPath = path3.posix.join(root, ...components.slice(0, -1));
  const targetPath = path3.posix.join(directoryPath, targetName);
  const observed = await lstat4(directoryPath, BIG).catch((e) => {
    const code = fsCode(e);
    if (code === "ENOENT" || code === "ENOTDIR") failWrite("TARGET_PARENT_INVALID", 400, { reason: "parent-missing", at: directoryPath });
    if (code === "ELOOP") failWrite("WORKSPACE_OUTSIDE_SCOPE", 403, { reason: "parent-symlink", at: directoryPath });
    failWrite("PINNED_WRITE_FAILED", 500, { reason: "parent-unreadable", at: directoryPath, fsCode: code });
  });
  if (observed.isSymbolicLink()) failWrite("WORKSPACE_OUTSIDE_SCOPE", 403, { reason: "parent-symlink", at: directoryPath });
  if (!observed.isDirectory()) failWrite("TARGET_PARENT_INVALID", 400, { reason: "parent-not-directory", at: directoryPath });
  const report = (phase, temp) => ({ phase, rootPath: root, directoryPath, directory: identityOf(observed), targetPath, targetName, size: data.byteLength, sha256: digest2, ...temp ? { temp } : {} });
  if (signal?.aborted) failWrite("WRITE_CANCELLED", 409, { reason: "before-pin", possiblyApplied: false });
  if (check) await check(report("before-pin"));
  const pinned = await PinnedDirectory.pin(root, components.slice(0, -1));
  let tempName = "";
  let held;
  let tempRetired = false;
  try {
    await pinned.verifyHostPath(directoryPath);
    if (await pinned.lstatChild(targetName)) failWrite("TARGET_EXISTS", 409, { target: targetPath });
    tempName = `${PINNED_WRITE_TEMP_PREFIX}${randomBytes3(16).toString("hex")}`;
    const temp = await open4(pinned.childPath(tempName), TEMP_FLAGS, 384).catch((e) => {
      const code = fsCode(e);
      if (code === "EEXIST") failWrite("PINNED_WRITE_FAILED", 500, { reason: "temp-name-collision" });
      if (code === "EACCES" || code === "EPERM") failWrite("PINNED_WRITE_FAILED", 500, { reason: "temp-permission", fsCode: code });
      failWrite("PINNED_WRITE_FAILED", 500, { reason: "temp-create", fsCode: code });
    });
    held = temp;
    await temp.chmod(384).catch((e) => failWrite("PINNED_WRITE_FAILED", 500, { reason: "temp-chmod", fsCode: fsCode(e) }));
    let created;
    await writeAll(temp, data, signal);
    await temp.sync().catch(() => {
    });
    const verifyTemp = async (label) => {
      const current = await guard(() => temp.stat(BIG), "temp-stat");
      if (!current.isFile()) failWrite("PINNED_WRITE_TAMPERED", 409, { reason: "temp-not-regular", label });
      if (current.size !== BigInt(data.byteLength)) failWrite("PINNED_WRITE_TAMPERED", 409, { reason: "temp-size", label, size: String(current.size) });
      if ((Number(current.mode) & 511) !== 384) failWrite("PINNED_WRITE_TAMPERED", 409, { reason: "temp-mode", label, mode: Number(current.mode) & 511 });
      if (current.nlink !== 1n) failWrite("PINNED_WRITE_TAMPERED", 409, { reason: "temp-linked", label, nlink: Number(current.nlink) });
      return current;
    };
    created = await verifyTemp("written");
    if (signal?.aborted) failWrite("WRITE_CANCELLED", 409, { reason: "before-publish", possiblyApplied: false });
    if (check) await check(report("before-publish", { name: tempName, identity: identityOf(created), mode: Number(created.mode) & 511, size: Number(created.size) }));
    created = await verifyTemp("pre-publish");
    await pinned.verifyHostPath(directoryPath);
    if (await pinned.lstatChild(targetName)) failWrite("TARGET_EXISTS", 409, { target: targetPath });
    if (signal?.aborted) failWrite("WRITE_CANCELLED", 409, { reason: "before-link", possiblyApplied: false });
    await link(pinned.childPath(tempName), pinned.childPath(targetName)).catch((e) => {
      const code = fsCode(e);
      if (code === "EEXIST") failWrite("TARGET_EXISTS", 409, { target: targetPath });
      if (code === "EXDEV") failWrite("PINNED_WRITE_FAILED", 500, { reason: "cross-device", fsCode: code });
      if (code === "EACCES" || code === "EPERM") failWrite("PINNED_WRITE_FAILED", 500, { reason: "publish-permission", fsCode: code });
      failWrite("PINNED_WRITE_FAILED", 500, { reason: "publish", fsCode: code });
    });
    const published = await publishedGuard(() => pinned.lstatChild(targetName), "published-initial-stat");
    if (!published || !published.isFile() || String(published.dev) !== String(created.dev) || String(published.ino) !== String(created.ino)) failAfterPublish("PINNED_WRITE_TAMPERED", 409, { reason: "published-mismatch" });
    if (signal?.aborted) failAfterPublish("WRITE_CANCELLED", 409, { reason: "after-publish", result: { path: targetPath, size: data.byteLength, sha256: digest2 } });
    await pinned.sync();
    const retired = await retireTempName(pinned, tempName);
    if (!retired.retired) failAfterPublish("PINNED_WRITE_UNVERIFIED", 409, { reason: "temp-cleanup-failed", temp: tempName, fsCode: retired.fsCode });
    tempRetired = true;
    await pinned.sync();
    const verifyPublished = async (label, expected) => {
      const current = await publishedGuard(() => pinned.lstatChild(targetName), "published-stat");
      if (!current || !current.isFile() || String(current.dev) !== expected.dev || String(current.ino) !== expected.ino) failAfterPublish("PINNED_WRITE_UNVERIFIED", 409, { reason: "published-replaced", label, target: targetPath });
      if (current.size !== BigInt(data.byteLength)) failAfterPublish("PINNED_WRITE_UNVERIFIED", 409, { reason: "published-size", label, target: targetPath });
      if ((Number(current.mode) & 511) !== 384) failAfterPublish("PINNED_WRITE_UNVERIFIED", 409, { reason: "published-mode", label, target: targetPath });
      if (current.nlink !== 1n) failAfterPublish("PINNED_WRITE_UNVERIFIED", 409, { reason: "published-extra-links", label, target: targetPath, nlink: Number(current.nlink) });
      return current;
    };
    const final = await verifyPublished("after-cleanup", { dev: String(published.dev), ino: String(published.ino) });
    let offset = 0;
    while (offset < data.byteLength) {
      const want = Math.min(65536, data.byteLength - offset);
      const chunk = Buffer.allocUnsafe(want);
      const read = await publishedGuard(() => temp.read(chunk, 0, want, offset), "published-read");
      if (read.bytesRead !== want) failAfterPublish("PINNED_WRITE_UNVERIFIED", 409, { reason: "published-short-read", offset, expected: want, read: read.bytesRead });
      if (chunk.compare(data.subarray(offset, offset + want)) !== 0) failAfterPublish("PINNED_WRITE_UNVERIFIED", 409, { reason: "published-content", offset });
      offset += want;
    }
    if (signal?.aborted) failAfterPublish("WRITE_CANCELLED", 409, { reason: "after-publish", result: { path: targetPath, size: data.byteLength, sha256: digest2 } });
    const settled = await verifyPublished("after-read-back", { dev: String(final.dev), ino: String(final.ino) });
    const directory = await publishedGuard(() => pinned.identity(), "published-directory");
    const result = { path: targetPath, directoryPath, directory, dev: String(settled.dev), ino: String(settled.ino), nlink: Number(settled.nlink), size: Number(settled.size), sha256: digest2 };
    try {
      await pinned.verifyHostPath(directoryPath);
    } catch (e) {
      throw annotatePublished(e);
    }
    if (check) {
      const afterPublish = { ...report("after-publish"), directory };
      try {
        await check(afterPublish);
      } catch (e) {
        throw Object.assign(new AgentError("PINNED_WRITE_UNVERIFIED", 409), { possiblyApplied: true, published: true, cause: e });
      }
    }
    return result;
  } finally {
    if (tempName && !tempRetired) await unlink3(pinned.childPath(tempName)).catch(() => {
    });
    await held?.close().catch(() => {
    });
    await pinned.close();
  }
}

// src/cli-task.ts
import { readFile as readFile8, stat as stat6, writeFile as writeFile4 } from "node:fs/promises";
import { isAbsolute as isAbsolute6, join as join7, relative, resolve as resolve2 } from "node:path";

// ../packages/cli-runtime/src/agent-codex-runtime.mjs
import { randomBytes as randomBytes6 } from "node:crypto";

// ../packages/cli-runtime/src/codex-session-core.mjs
import { createHash as createHash6 } from "node:crypto";
import { readFile as readFile7, realpath as realpath6, stat as stat5, mkdir as mkdir6, writeFile as writeFile3 } from "node:fs/promises";
import { spawn as spawn3 } from "node:child_process";
import { isAbsolute as isAbsolute5, join as join6 } from "node:path";

// ../packages/cli-runtime/src/native-process.mjs
import { spawn as spawn2 } from "node:child_process";
import { EventEmitter as EventEmitter2 } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { access as access2, lstat as lstat5, mkdir as mkdir4, mkdtemp, readFile as readFile6, readdir as readdir2, realpath as realpath4, rmdir, unlink as unlink4 } from "node:fs/promises";
import { lstatSync as lstatSync2, mkdirSync as mkdirSync2, mkdtempSync, readFileSync as readFileSync2, realpathSync, writeFileSync as writeFileSync2 } from "node:fs";
import { randomBytes as randomBytes4 } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute as isAbsolute3, join as join4, toNamespacedPath } from "node:path";
import { fileURLToPath } from "node:url";

// ../packages/cli-runtime/src/native-cli-output.mjs
import { createHash as createHash4 } from "node:crypto";
var FRAME = 262144;
var RAW_FRAME = 18 * 1024 * 1024;
var IMAGE = 6 * 1024 * 1024;
var fail2 = () => {
  throw new Error("CLI_FRAME_LIMIT");
};
function receipt(frame, rawBytes) {
  const results = frame?.type === "user" && frame.message?.content;
  const toolResult = Array.isArray(results) && results.length > 0 && results.every((block) => block?.type === "tool_result" && typeof block.tool_use_id === "string");
  if (!toolResult) {
    if (rawBytes > FRAME) fail2();
    return frame;
  }
  let imageBytes = 0, images = 0, nodes = 0;
  const visit = (value, depth = 0) => {
    if (++nodes > 3e4 || depth > 24) fail2();
    if (!value || typeof value !== "object") return value;
    if (value.type === "image") {
      const source = value.source;
      const data = source?.type === "base64" ? source.data : value.data;
      const mediaType = source?.type === "base64" ? source.media_type : value.mimeType;
      if (typeof data !== "string" || data.length > IMAGE / 3 * 4 || !["image/png", "image/jpeg", "image/webp"].includes(mediaType)) fail2();
      const bytes = Buffer.from(data, "base64");
      if (!bytes.length || bytes.length > IMAGE || bytes.toString("base64") !== data || ++images > 32 || (imageBytes += bytes.length) > IMAGE * 2) fail2();
      return { type: "image", mediaType, bytes: bytes.length, sha256: createHash4("sha256").update(bytes).digest("hex") };
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key2, item]) => [key2, visit(item, depth + 1)]));
  };
  const result = visit(frame);
  if (rawBytes > FRAME && !images || Buffer.byteLength(JSON.stringify(result)) > FRAME) fail2();
  return result;
}
var NativeCliOutput = class {
  #buffer = "";
  #bytes = 0;
  push(text) {
    this.#buffer += text;
    const frames = [];
    let end;
    while ((end = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 1);
      const rawBytes = Buffer.byteLength(line);
      if (rawBytes > RAW_FRAME) fail2();
      if (!line.trim()) continue;
      const frame = receipt(JSON.parse(line), rawBytes);
      this.#bytes += Buffer.byteLength(JSON.stringify(frame));
      if (this.#bytes > 8 * 1024 * 1024) fail2();
      frames.push(frame);
    }
    if (Buffer.byteLength(this.#buffer) > RAW_FRAME) fail2();
    return frames;
  }
};

// ../packages/cli-runtime/src/native-process.mjs
var HERE = fileURLToPath(new URL(".", import.meta.url));
var MAX_FRAME = 262144;
var COMPILER_ROOT = "DSH_NATIVE_COMPILER_ROOT";
var COMPILER_SCRATCH = "DSH_NATIVE_COMPILER_SCRATCH";
var inheritedCompilerRoot = process.platform === "win32" ? process.env[COMPILER_ROOT] : void 0;
var hostTemp = process.platform === "win32" ? tmpdir() : null;
var compilerRoot = null;
var compilerFailure = () => Object.assign(new Error("NATIVE_COMPILER_SCRATCH_UNAVAILABLE"), { code: "NATIVE_COMPILER_SCRATCH_UNAVAILABLE" });
var sameDirectory = (info, expected) => info.isDirectory() && !info.isSymbolicLink() && info.dev === expected.dev && info.ino === expected.ino;
var rootStamp = (path4) => `dsh-native-compiler-v1:${basename(path4)}
`;
function compilerDirectory() {
  try {
    if (!compilerRoot) {
      if (inheritedCompilerRoot !== void 0) {
        if (!isAbsolute3(inheritedCompilerRoot) || inheritedCompilerRoot.length > 140 || !/^dshc-[a-f0-9]{16}$/.test(basename(inheritedCompilerRoot))) throw compilerFailure();
        const info2 = lstatSync2(inheritedCompilerRoot, { bigint: true });
        if (!info2.isDirectory() || info2.isSymbolicLink() || realpathSync(inheritedCompilerRoot) !== inheritedCompilerRoot || readFileSync2(join4(inheritedCompilerRoot, ".dsh-root"), "utf8") !== rootStamp(inheritedCompilerRoot)) throw compilerFailure();
        compilerRoot = { path: inheritedCompilerRoot, info: info2 };
      } else {
        const parent = realpathSync(hostTemp);
        const path5 = join4(parent, `dshc-${randomBytes4(8).toString("hex")}`);
        if (path5.length > 140) throw compilerFailure();
        mkdirSync2(path5);
        writeFileSync2(join4(path5, ".dsh-root"), rootStamp(path5), { flag: "wx" });
        compilerRoot = { path: path5, info: lstatSync2(path5, { bigint: true }) };
      }
    }
    if (!sameDirectory(lstatSync2(compilerRoot.path, { bigint: true }), compilerRoot.info) || realpathSync(compilerRoot.path) !== compilerRoot.path) throw compilerFailure();
    const path4 = mkdtempSync(join4(compilerRoot.path, "c-"));
    const info = lstatSync2(path4, { bigint: true }), owner = randomBytes4(16).toString("hex");
    writeFileSync2(join4(path4, ".dsh-owner"), owner, { flag: "wx" });
    const root = compilerRoot;
    const cleanup = async () => {
      try {
        if (dirname(path4) !== root.path || !/^c-[A-Za-z0-9]{6}$/.test(basename(path4))) return false;
        if (!sameDirectory(await lstat5(root.path, { bigint: true }), root.info) || await realpath4(root.path) !== root.path) return false;
        if (!sameDirectory(await lstat5(path4, { bigint: true }), info) || await realpath4(path4) !== path4 || await readFile6(join4(path4, ".dsh-owner"), "utf8") !== owner) return false;
        const names = await readdir2(path4);
        if (names.length > 128) return false;
        for (const name of names) {
          const entry = await lstat5(join4(path4, name));
          if (!entry.isFile() || entry.isSymbolicLink()) return false;
        }
        for (const name of names) await unlink4(join4(path4, name));
        await rmdir(path4);
        return true;
      } catch {
        return false;
      }
    };
    return { root: root.path, path: path4, cleanup };
  } catch {
    throw compilerFailure();
  }
}
function privateEnvironment(home, source = process.env) {
  const env2 = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join4(home, "appdata"),
    LOCALAPPDATA: join4(home, "local"),
    CODEX_HOME: home,
    XDG_CACHE_HOME: join4(home, "cache"),
    XDG_CONFIG_HOME: join4(home, "config"),
    XDG_DATA_HOME: join4(home, "data"),
    TEMP: join4(home, "tmp"),
    TMP: join4(home, "tmp"),
    TMPDIR: join4(home, "tmp"),
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1"
  };
  for (const key2 of ["SystemRoot", "windir", "ComSpec", "LANG", "LC_ALL"]) if (source[key2]) env2[key2] = source[key2];
  env2.PATH = process.platform === "win32" ? join4(source.SystemRoot ?? "C:\\Windows", "System32") : "/usr/bin:/bin";
  if (process.platform === "win32" && (compilerRoot?.path ?? inheritedCompilerRoot)) env2[COMPILER_ROOT] = compilerRoot?.path ?? inheritedCompilerRoot;
  return env2;
}
async function resolveNativeHelper({ python = "/usr/bin/python3" } = {}) {
  if (process.platform === "win32") {
    const executable = join4(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    await access2(executable);
    return Object.freeze({ executable: await realpath4(executable), prefix: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join4(HERE, "native-peer.ps1")], platform: "win32" });
  }
  if (process.platform !== "linux" || !isAbsolute3(python)) throw new Error("NATIVE_PEER_UNAVAILABLE");
  await access2(python);
  return Object.freeze({ executable: await realpath4(python), prefix: ["-u", join4(HERE, "native-peer.py")], platform: "linux" });
}
function nativeProcess(helper, mode, spec, { home, env: env2 = privateEnvironment(home) } = {}) {
  if (helper.platform === "win32" && home.length > 240) throw Object.assign(new Error("NATIVE_PROFILE_HOME_TOO_LONG"), { code: "NATIVE_PROFILE_HOME_TOO_LONG" });
  const events = new EventEmitter2();
  const args = helper.platform === "win32" ? [...helper.prefix, "-Mode", mode] : [...helper.prefix, mode];
  const compiler = helper.platform === "win32" ? compilerDirectory() : null;
  const helperEnv = compiler ? Object.fromEntries(Object.entries(env2).filter(([key2]) => ![COMPILER_ROOT, COMPILER_SCRATCH].includes(key2.toUpperCase()))) : env2;
  if (compiler) {
    helperEnv[COMPILER_ROOT] = compiler.root;
    helperEnv[COMPILER_SCRATCH] = compiler.path;
  }
  const child = spawn2(helper.executable, args, { cwd: compiler ? compiler.root : home, env: helperEnv, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let tail = "", buffer = "", bytes = 0, closed2 = false, treeStopped = false;
  const decoder = new StringDecoder("utf8"), cliDecoder = new StringDecoder("utf8");
  const cliOutput = new NativeCliOutput();
  const frame = (value) => {
    if (mode === "supervise" && value.control === "stopped" && value.treeStopped === true) treeStopped = true;
    if (mode === "supervise" && value.type === "cli-output") {
      if (typeof value.data !== "string" || value.data.length > MAX_FRAME * 2) throw new Error("INVALID_CLI_FRAME");
      for (const message of cliOutput.push(cliDecoder.write(Buffer.from(value.data, "base64")))) events.emit("message", message);
    } else events.emit(value.control ? "control" : "message", value);
  };
  const exit = new Promise((resolve4) => child.once("close", async (code, signal) => {
    closed2 = true;
    if (compiler && code === 0 && signal === null && (mode !== "supervise" || treeStopped)) await compiler.cleanup();
    events.emit("closed", { code, signal });
    resolve4({ code, signal });
  }));
  child.on("error", (error2) => events.emit("failure", error2));
  child.stdin.on("error", () => {
  });
  child.stdout.on("error", (error2) => events.emit("failure", error2));
  child.stderr.on("error", (error2) => events.emit("failure", error2));
  child.stderr.on("data", (data) => {
    tail = (tail + data.toString("utf8")).slice(-4096);
  });
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    buffer += decoder.write(chunk);
    const boundedStream = mode === "client" || mode === "server" || mode === "supervise";
    if (!boundedStream && bytes > 8 * 1024 * 1024 || Buffer.byteLength(buffer) > MAX_FRAME) {
      events.emit("failure", new Error("OUTPUT_LIMIT"));
      child.stdin.end();
      return;
    }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        frame(JSON.parse(line));
      } catch {
        events.emit("failure", new Error("INVALID_NATIVE_FRAME"));
        child.stdin.end();
      }
    }
  });
  const send = (value) => new Promise((resolve4, reject) => {
    const wire = JSON.stringify(value) + "\n";
    if (closed2 || Buffer.byteLength(wire) > MAX_FRAME) {
      reject(new Error(closed2 ? "NATIVE_CLOSED" : "INPUT_LIMIT"));
      return;
    }
    child.stdin.write(wire, (error2) => error2 ? reject(error2) : resolve4());
  });
  const nativeSpec = helper.platform === "win32" && spec ? {
    ...spec,
    ...mode === "protect" && typeof spec.path === "string" && spec.path.length >= 260 ? { path: toNamespacedPath(spec.path) } : {},
    ...mode === "supervise" && typeof spec.cwd === "string" && spec.cwd.length >= 260 ? { cwd: toNamespacedPath(spec.cwd) } : {}
  } : spec;
  if (nativeSpec) void send(nativeSpec).catch((error2) => events.emit("failure", error2));
  function waitControl(name, timeoutMs = 15e3) {
    return new Promise((resolve4, reject) => {
      const clean = () => {
        clearTimeout(timer);
        events.off("control", control2);
        events.off("closed", ended);
        events.off("failure", failed);
      };
      const control2 = (value) => {
        if (value.control === name) {
          clean();
          resolve4(value);
        }
      };
      const ended = () => {
        clean();
        reject(new Error(`NATIVE_${name.toUpperCase()}_FAILED: ${tail.slice(-256)}`));
      };
      const failed = (error2) => {
        clean();
        reject(error2);
      };
      const timer = setTimeout(() => {
        clean();
        reject(new Error(`NATIVE_${name.toUpperCase()}_TIMEOUT`));
      }, timeoutMs);
      events.on("control", control2);
      events.once("closed", ended);
      events.once("failure", failed);
      if (closed2) ended();
    });
  }
  return Object.freeze({ child, events, exit, send, waitControl, end: () => child.stdin.end(), get stderr() {
    return tail;
  }, get closed() {
    return closed2;
  } });
}
async function capabilityProbe({ home, python } = {}) {
  let proc;
  try {
    const helper = await resolveNativeHelper({ python });
    proc = nativeProcess(helper, "probe", null, { home });
    const value = await new Promise((resolve4, reject) => {
      proc.events.once("message", resolve4);
      proc.events.once("failure", reject);
      proc.events.once("closed", () => reject(new Error("NATIVE_PROBE_FAILED")));
    });
    await proc.exit;
    return { ...value, helper, limitations: helper.platform === "linux" ? ["Process groups are not an OS sandbox; adversarial unobserved daemon escape requires a cgroup/container boundary"] : [] };
  } catch (error2) {
    return { available: false, code: "NATIVE_PEER_UNAVAILABLE", reason: error2.message };
  } finally {
    if (proc && !proc.closed) proc.end();
  }
}
async function protectProfile(helper, home) {
  if (helper.platform !== "win32") return;
  const proc = nativeProcess(helper, "protect", { path: home }, { home });
  const protectedValue = await new Promise((resolve4, reject) => {
    proc.events.once("message", resolve4);
    proc.events.once("failure", reject);
    proc.events.once("closed", () => reject(new Error("PROFILE_ACL_FAILED")));
  });
  proc.end();
  const exit = await proc.exit;
  if (!protectedValue.protected || exit.code !== 0) throw new Error("PROFILE_ACL_FAILED");
}

// ../packages/capability-broker/src/cli-bootstrap.mjs
import { generateKeyPairSync, sign as sign2, randomBytes as randomBytes5 } from "node:crypto";
import { mkdir as mkdir5, writeFile as writeFile2, mkdtemp as mkdtemp2, chmod, lstat as lstat6, realpath as realpath5, rmdir as rmdir2 } from "node:fs/promises";
import { tmpdir as tmpdir2 } from "node:os";
import { isAbsolute as isAbsolute4, join as join5 } from "node:path";
import { performance as performance2 } from "node:perf_hooks";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// ../packages/capability-broker/src/authority.mjs
var PolicyError = class extends Error {
  /**
   * `detail.gate` names the checkpoint that refused, and `detail.rule` the rule
   * text when one matched. A refusal that only says "TOOL_DENIED" leaves the
   * reader to guess which of several gates stopped it, and support then runs on
   * pasted logs.
   */
  constructor(code, detail = {}) {
    super(`Capability refused: ${code}`);
    this.name = "PolicyError";
    this.code = code;
    if (detail && typeof detail === "object") {
      if (typeof detail.gate === "string" && detail.gate) this.gate = detail.gate;
      if (typeof detail.rule === "string" && detail.rule) this.rule = detail.rule;
    }
  }
};

// ../packages/capability-broker/src/cli-bridge-response.mjs
import { createHash as createHash5 } from "node:crypto";
var CHUNK_BYTES = 128 * 1024;
var MAX_RESPONSE = 9 * 1024 * 1024;
var MAX_BUFFERED = 16 * 1024 * 1024;
var fail3 = () => {
  throw new Error("INVALID_BRIDGE_RESPONSE");
};
var sha2 = (bytes) => createHash5("sha256").update(bytes).digest("hex");
function* bridgeResponseFrames(id2, value) {
  let bytes = Buffer.from(JSON.stringify({ type: "response", id: id2, ...value }));
  if (bytes.length > MAX_RESPONSE) bytes = Buffer.from(JSON.stringify({ type: "response", id: id2, ok: false, code: "OUTPUT_LIMIT" }));
  if (bytes.length <= CHUNK_BYTES) {
    yield JSON.parse(bytes.toString("utf8"));
    return;
  }
  yield { type: "response-start", id: id2, bytes: bytes.length };
  for (let offset = 0, index = 0; offset < bytes.length; offset += CHUNK_BYTES, index++) {
    yield { type: "response-chunk", id: id2, index, data: bytes.subarray(offset, offset + CHUNK_BYTES).toString("base64") };
  }
  yield { type: "response-end", id: id2, sha256: sha2(bytes) };
}
function normalizeBridgeMcpResult(value) {
  if (!value || !Array.isArray(value.content) || value.content.length > 32 || Object.keys(value).some((key2) => !["content", "isError"].includes(key2)) || value.isError !== void 0 && typeof value.isError !== "boolean") fail3();
  for (const block of value.content) {
    if (block?.type === "text") {
      if (Object.keys(block).some((key2) => !["type", "text"].includes(key2)) || typeof block.text !== "string") fail3();
    } else if (block?.type === "image") {
      if (Object.keys(block).some((key2) => !["type", "data", "mimeType"].includes(key2)) || !["image/png", "image/jpeg", "image/webp"].includes(block.mimeType) || typeof block.data !== "string" || block.data.length > 8 * 1024 * 1024) fail3();
      const bytes = Buffer.from(block.data, "base64");
      if (!bytes.length || bytes.toString("base64") !== block.data || bytes.length > 6 * 1024 * 1024) fail3();
    } else fail3();
  }
  return value;
}

// ../packages/capability-broker/src/cli-bootstrap.mjs
var BRIDGE = fileURLToPath2(new URL("./cli-stdio-bridge.mjs", import.meta.url));
var MAX_BYTES = 262144;
var REQUEST_KEYS = ["type", "id", "op", "name", "args"];
var capabilityOf = (handler) => {
  const value = handler.capability ?? handler.definition.name;
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 256) throw new TypeError("INVALID_HANDLER_CAPABILITY");
  return value;
};
async function createCliBootstrap({ authority, subject, binding, tools, handlers, home, ttlMs = 3e4, helper, contextFor = null }) {
  if (!isAbsolute4(home)) throw new TypeError("An isolated absolute home is required");
  if (contextFor !== null && typeof contextFor !== "function") throw new TypeError("INVALID_HOST_CONTEXT_CALLBACK");
  const ownedBinding = Object.freeze({ ...binding });
  const registry = new Map(handlers.map((handler) => [handler.definition.name, handler]));
  if (registry.size !== handlers.length || tools.some((name) => !registry.has(name))) throw new TypeError("Unknown or duplicate bridge handler");
  const selected = new Map(tools.map((name) => [name, { handler: registry.get(name), capability: capabilityOf(registry.get(name)) }]));
  const leaseTools = [...new Set([...selected.values()].map((entry) => entry.capability))];
  const byCapability = /* @__PURE__ */ new Map();
  for (const entry of selected.values()) {
    const sharing = byCapability.get(entry.capability);
    if (sharing) sharing.push(entry.handler);
    else byCapability.set(entry.capability, [entry.handler]);
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1e3 || ttlMs > 72e5 || typeof authority.renew !== "function") throw new TypeError("BOUNDED_RENEWABLE_LEASE_REQUIRED");
  const leaseTtlMs = Math.min(3e4, ttlMs);
  const startedAt = performance2.now();
  const native = helper ?? await resolveNativeHelper();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicSpki = publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  await mkdir5(home, { recursive: true, mode: 448 });
  await mkdir5(join5(home, "tmp"), { recursive: true, mode: 448 });
  const descriptorPath2 = join5(home, `bridge-${randomBytes5(12).toString("hex")}.json`);
  let socketDirectory;
  let endpoint = process.platform === "win32" ? `dsh-cli-${randomBytes5(18).toString("hex")}` : join5(home, `p-${randomBytes5(6).toString("hex")}.sock`);
  if (process.platform === "linux" && Buffer.byteLength(endpoint) > 103) {
    let parent = await realpath5(tmpdir2());
    if (Buffer.byteLength(join5(parent, "dsh-cli-XXXXXX", "p.sock")) > 103) parent = await realpath5("/tmp");
    socketDirectory = await mkdtemp2(join5(parent, "dsh-cli-"));
    await chmod(socketDirectory, 448);
    const stat8 = await lstat6(socketDirectory);
    if (!stat8.isDirectory() || stat8.isSymbolicLink() || stat8.uid !== process.getuid() || (stat8.mode & 63) !== 0) {
      await rmdir2(socketDirectory);
      throw new Error("PRIVATE_SOCKET_DIRECTORY_REQUIRED");
    }
    endpoint = join5(socketDirectory, "p.sock");
    if (Buffer.byteLength(endpoint) > 103) {
      await rmdir2(socketDirectory);
      throw new Error("PRIVATE_SOCKET_PATH_TOO_LONG");
    }
  }
  let lease;
  try {
    lease = authority.issue(subject, { binding: ownedBinding, tools: leaseTools, ttlMs: leaseTtlMs });
  } catch (error2) {
    if (socketDirectory) await rmdir2(socketDirectory);
    throw error2;
  }
  let relay, closed2 = false, bound = false, connected = false, closing;
  let accepted, rejected = 0, requests = 0, replies = 0, highestRequestId = 0;
  const active = /* @__PURE__ */ new Map();
  const release = () => {
    authority.release(lease.token);
    for (const controller of active.values()) controller.abort(new Error("BRIDGE_CLOSED"));
  };
  const reply = async (id2, value, signal) => {
    if (!relay || relay.closed) return;
    replies++;
    for (const frame of bridgeResponseFrames(id2, value)) {
      signal?.throwIfAborted();
      await relay.send(frame);
    }
  };
  const hostContext = (op, name, id2) => {
    if (!contextFor) return null;
    let value;
    try {
      value = contextFor({ op, name, id: id2 });
    } catch (error2) {
      throw error2 instanceof PolicyError ? error2 : new PolicyError("CONTEXT_UNAVAILABLE", { gate: "host-context" });
    }
    if (!value || typeof value !== "object" || typeof value.then === "function") throw new PolicyError("CONTEXT_UNAVAILABLE", { gate: "host-context" });
    return value;
  };
  const requestSignal = (controller, context) => {
    const signal = context?.signal ?? null;
    if (signal !== null && !(signal instanceof AbortSignal)) throw new PolicyError("CONTEXT_UNAVAILABLE", { gate: "host-signal" });
    return signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  };
  async function request(message) {
    requests++;
    if (!message || !Number.isSafeInteger(message.id) || message.id < 1) return;
    if (message.type === "cancel") {
      active.get(message.id)?.abort(new Error("REQUEST_CANCELLED"));
      return;
    }
    if (message.type !== "request") return;
    const id2 = message.id;
    if (id2 <= highestRequestId) {
      void reply(id2, { ok: false, code: "DUPLICATE_REQUEST" }).catch(() => {
      });
      return;
    }
    highestRequestId = id2;
    try {
      if (closed2) throw new PolicyError("BRIDGE_CLOSED");
      if (Buffer.byteLength(JSON.stringify(message)) > MAX_BYTES || Object.keys(message).some((key2) => !REQUEST_KEYS.includes(key2))) throw new PolicyError("INVALID_REQUEST");
      if (active.size >= 16) throw new PolicyError("BUSY");
      if (message.op === "list") {
        const context2 = hostContext("list", null, id2);
        requestSignal(new AbortController(), context2).throwIfAborted();
        await reply(id2, { ok: true, value: authority.list(lease.token, ownedBinding).flatMap((capability) => byCapability.get(capability) ?? []).map((handler) => handler.definition) });
        return;
      }
      if (message.op !== "call") throw new PolicyError("INVALID_REQUEST");
      const entry = selected.get(message.name);
      if (!entry) throw new PolicyError("TOOL_DENIED");
      const context = hostContext("call", message.name, id2);
      const controller = new AbortController();
      const signal = requestSignal(controller, context);
      active.set(id2, controller);
      try {
        signal.throwIfAborted();
        const value = await authority.run(lease.token, ownedBinding, entry.capability, ({ signal: authoritySignal }) => {
          authoritySignal.throwIfAborted();
          return entry.handler.execute(entry.handler.parse(message.args), { signal: authoritySignal, binding: ownedBinding, context });
        }, { signal });
        signal.throwIfAborted();
        const mcpResult = entry.handler.render ? normalizeBridgeMcpResult(await entry.handler.render(value)) : null;
        signal.throwIfAborted();
        await reply(id2, { ok: true, ...mcpResult ? { mcpResult } : { value } }, signal);
      } finally {
        active.delete(id2);
      }
    } catch (error2) {
      await reply(id2, { ok: false, code: error2 instanceof PolicyError ? error2.code : "HANDLER_REFUSED" }).catch(() => {
      });
    }
  }
  const close = () => {
    if (closing) return closing;
    closed2 = true;
    release();
    clearTimeout(expiry);
    clearInterval(renewal);
    closing = (async () => {
      if (relay) {
        relay.end();
        const stopped = await Promise.race([relay.exit.then(() => true), new Promise((resolve4) => {
          const t = setTimeout(() => resolve4(false), 3e3);
          t.unref();
        })]);
        if (!stopped) {
          relay.child.kill();
          await relay.exit;
        }
      }
      if (socketDirectory) await rmdir2(socketDirectory).catch(() => {
      });
    })();
    return closing;
  };
  const expiry = setTimeout(() => {
    void close();
  }, ttlMs);
  expiry.unref();
  const renewal = setInterval(() => {
    try {
      if (!closed2) authority.renew(lease.token, ownedBinding, { ttlMs: Math.min(leaseTtlMs, Math.max(1, Math.floor(ttlMs - (performance2.now() - startedAt)))) });
    } catch {
      void close();
    }
  }, Math.max(100, Math.floor(leaseTtlMs / 3)));
  renewal.unref();
  const bind = async ({ pid, start }) => {
    if (closed2 || bound || !Number.isSafeInteger(pid) || pid < 1 || typeof start !== "string") throw new Error("INVALID_CLI_BINDING");
    authority.list(lease.token, ownedBinding);
    bound = true;
    const remaining = Math.floor(ttlMs - (performance2.now() - startedAt));
    if (remaining < 1) {
      await close();
      throw new Error("BOOTSTRAP_EXPIRED");
    }
    relay = nativeProcess(native, "server", { endpoint, rootPid: pid, rootStart: start, ttlMs: remaining }, { home });
    relay.events.on("message", (message) => {
      void request(message);
    });
    relay.events.on("control", (value) => {
      if (value.control === "accepted") {
        accepted = value;
        connected = true;
      }
      if (value.control === "rejected") rejected++;
    });
    relay.events.once("closed", () => {
      closed2 = true;
      release();
      clearTimeout(expiry);
      clearInterval(renewal);
    });
    relay.events.once("failure", () => {
      void close();
    });
    const server = await relay.waitControl("listening");
    const payload = JSON.stringify({
      version: 1,
      endpoint,
      serverPid: server.pid,
      serverStart: server.start,
      rootPid: pid,
      rootStart: start,
      expiresAt: Date.now() + Math.min(15e3, remaining),
      sessionExpiresAt: Date.now() + remaining,
      ttlMs: remaining,
      helper: native,
      hostPid: process.pid,
      binding: ownedBinding
    });
    const descriptor = JSON.stringify({ payload, signature: sign2(null, Buffer.from(payload), privateKey).toString("base64url") });
    await writeFile2(descriptorPath2, descriptor, { flag: "wx", mode: 384 });
  };
  return Object.freeze({
    command: process.execPath,
    args: [BRIDGE, descriptorPath2, publicSpki],
    descriptorPath: descriptorPath2,
    bind,
    close,
    get closed() {
      return closed2;
    },
    get connected() {
      return connected;
    },
    get evidence() {
      return { binding: ownedBinding, connected, peer: accepted ?? null, rejectedPeers: rejected, requests, replies, nativeError: relay?.stderr ?? "", bearerInArgvOrEnv: false, closed: closed2 };
    }
  });
}

// ../packages/cli-runtime/src/contracts.mjs
var count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
function usageBreakdown(value) {
  return Object.freeze({
    inputTokens: count(value?.inputTokens),
    outputTokens: count(value?.outputTokens),
    cachedInputTokens: count(value?.cachedInputTokens),
    cacheWriteInputTokens: count(value?.cacheWriteInputTokens),
    reasoningOutputTokens: count(value?.reasoningOutputTokens),
    totalTokens: count(value?.totalTokens)
  });
}
function createCodexEvidence({ binding, operationId, botId, requestedModel, catalogModel = requestedModel, catalogProvider = "openai", entry, billing = "subscription" }) {
  if (!["subscription", "api", "unknown"].includes(billing)) throw new TypeError("INVALID_CLI_BILLING");
  let threadId = null, turnId = null, reportedModel = null, reportedProvider = null;
  let usage = usageBreakdown(), seenUsage = false, mismatch = false, finished = null, finalText = "", failure = null;
  const reroutes = [];
  return Object.freeze({
    bindThread(result) {
      threadId = result?.thread?.id ?? null;
      reportedModel = typeof result?.model === "string" ? result.model : null;
      reportedProvider = typeof result?.modelProvider === "string" ? result.modelProvider : null;
      mismatch = reportedModel !== requestedModel || reportedProvider !== "openai";
      if (!threadId || mismatch) throw new Error("CLI_MODEL_IDENTITY_MISMATCH");
    },
    event(message) {
      const params = message?.params;
      if (!params || params.threadId !== threadId) return { accepted: false };
      if (turnId && params.turnId && params.turnId !== turnId) return { accepted: false };
      if (message.method === "turn/started") turnId = params.turn?.id ?? turnId;
      if (message.method === "thread/tokenUsage/updated") {
        turnId ??= params.turnId;
        usage = usageBreakdown(params.tokenUsage?.total);
        seenUsage = true;
        return { accepted: true, usageChanged: true };
      }
      if (message.method === "model/rerouted") {
        reroutes.push({ fromModel: params.fromModel ?? null, toModel: params.toModel ?? null, reason: params.reason ?? null });
        if (params.toModel !== requestedModel) mismatch = true;
      }
      if (message.method === "item/completed" && params.item?.type === "agentMessage" && typeof params.item.text === "string") finalText = params.item.text;
      if (message.method === "turn/completed") {
        turnId ??= params.turn?.id;
        finished = params.turn?.status ?? "unknown";
        failure = params.turn?.error ? { code: params.turn.error.codexErrorInfo ?? null, message: String(params.turn.error.message ?? "").slice(0, 512) } : null;
      }
      return { accepted: true, mismatch, completed: message.method === "turn/completed" };
    },
    snapshot() {
      return {
        schemaVersion: 1,
        source: "cli",
        toolId: "codex",
        botId,
        ...binding,
        operationId,
        receiptId: threadId && turnId ? `codex:${operationId}:${threadId}:${turnId}` : null,
        threadId,
        turnId,
        entry: { path: entry.path, sha256: entry.sha256, version: entry.version },
        identity: {
          catalogProvider,
          catalogModel,
          requestedCliModel: requestedModel,
          reportedCliModel: reportedModel,
          reportedProvider,
          actualResponseModel: null,
          verification: mismatch ? "mismatch" : reportedModel ? "cli-configured-model" : "unreported",
          actualResponseModelVerified: false,
          reroutes: [...reroutes]
        },
        usage: { ...usage, reported: seenUsage, status: seenUsage && Object.values(usage).every((value) => value !== null) ? "complete" : seenUsage ? "partial" : "unknown" },
        billing: { kind: billing, amountUsd: null, amountStatus: billing === "subscription" ? "not-applicable" : "unknown" },
        terminal: mismatch ? "identity-mismatch" : finished,
        finalText,
        failure,
        limitations: ["Codex thread/start reports the configured model; this protocol does not prove the response backend model", "An independent profile and MCP scope do not provide OS file isolation"]
      };
    }
  });
}

// ../packages/cli-runtime/src/profile-policy.mjs
function providerSettings(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key2) => !["openaiBaseUrl", "chatgptBaseUrl"].includes(key2))) throw new TypeError("INVALID_PROVIDER_SETTINGS");
  const entries = [];
  for (const [source, target] of [["openaiBaseUrl", "openai_base_url"], ["chatgptBaseUrl", "chatgpt_base_url"]]) {
    if (input[source] === void 0) continue;
    let url;
    try {
      url = new URL(input[source]);
    } catch {
      throw new TypeError("INVALID_PROVIDER_ENDPOINT");
    }
    if (typeof input[source] !== "string" || input[source].length > 2048 || url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new TypeError("INVALID_PROVIDER_ENDPOINT");
    entries.push([target, input[source]]);
  }
  return Object.freeze({
    lines: entries.map(([key2, value]) => `${key2} = ${JSON.stringify(value)}`),
    configuredKeys: entries.map(([key2]) => key2),
    values: Object.fromEntries(entries)
  });
}
function assertEffectiveProfile(result, { requestedModel, bridge, home, tools, settings }) {
  const config = result?.config;
  if (!config || config.model !== requestedModel || config.model_provider !== "openai" || config.approval_policy !== "never" || config.sandbox_mode !== "read-only") throw new Error("CLI_EFFECTIVE_PROFILE_MISMATCH");
  const servers = config.mcp_servers;
  if (!servers || Object.keys(servers).length !== 1 || !servers.dsh_task) throw new Error("CLI_EXTRA_OR_MISSING_MCP");
  const server = servers.dsh_task;
  if (server.command !== bridge.command || JSON.stringify(server.args) !== JSON.stringify(bridge.args) || server.cwd !== home || server.required !== true || JSON.stringify(server.enabled_tools) !== JSON.stringify(tools)) throw new Error("CLI_EFFECTIVE_BRIDGE_MISMATCH");
  for (const [key2, value] of Object.entries(settings.values)) if (config[key2] !== value) throw new Error("CLI_PROVIDER_SETTINGS_MISMATCH");
  return { isolatedMcpServers: ["dsh_task"], explicitProviderSettingKeys: [...settings.configuredKeys] };
}

// ../packages/cli-runtime/src/codex-session-core.mjs
var digest = (value) => createHash6("sha256").update(value).digest("hex");
var id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
var validText = (value) => typeof value === "string" && value.trim() && !value.includes("\0") && Buffer.byteLength(value) <= 64e3;
async function pinCodexExecutable({ executable, sha256: sha2562, version }, home) {
  if (!isAbsolute5(executable) || !/^[a-f0-9]{64}$/.test(sha2562) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new TypeError("PINNED_NATIVE_ENTRY_REQUIRED");
  const path4 = await realpath6(executable);
  if (!(await stat5(path4)).isFile() || process.platform === "win32" && !path4.toLowerCase().endsWith(".exe")) throw new Error("NATIVE_ENTRY_REQUIRED");
  if (digest(await readFile7(path4)) !== sha2562) throw new Error("CLI_ENTRY_CHANGED");
  const reported = await new Promise((resolve4, reject) => {
    const child = spawn3(path4, ["--version"], { cwd: home, env: privateEnvironment(home), windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error2 = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("CLI_VERSION_TIMEOUT"));
    }, 1e4);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 1024) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      error2 = (error2 + chunk.toString("utf8")).slice(-1024);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve4(output.trim());
      else reject(new Error(`CLI_VERSION_FAILED: ${error2.slice(0, 128)}`));
    });
  });
  if (reported !== `codex-cli ${version}`) throw new Error("CLI_VERSION_MISMATCH");
  return Object.freeze({ path: path4, sha256: sha2562, version });
}
async function createCodexSessionCore({
  authority,
  subject,
  binding,
  operationId,
  tools = [],
  handlers = [],
  runtimeRoot,
  workspace,
  entry: suppliedEntry,
  requestedModel,
  catalogProvider = "openai",
  catalogModel = requestedModel,
  deadlineMs = 6e4,
  provisionCredentials,
  billing = "subscription",
  python,
  onUsage,
  onBeforeRequest,
  onProgress,
  signal,
  providerConfig = {},
  roleInstructions
}) {
  if (!id(operationId) || !isAbsolute5(runtimeRoot) || !isAbsolute5(workspace) || !/^gpt-[A-Za-z0-9_.-]{1,100}$/.test(requestedModel)) throw new TypeError("INVALID_CLI_TASK");
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1e3 || deadlineMs > 72e5) throw new TypeError("INVALID_CLI_DEADLINE");
  authority.assertModel(subject, catalogProvider, catalogModel);
  const { botId, revision } = authority.describe(subject);
  signal?.throwIfAborted();
  const settings = providerSettings(providerConfig);
  if (roleInstructions !== void 0 && !validText(roleInstructions)) throw new TypeError("INVALID_CLI_ROLE");
  const cwd = await realpath6(workspace);
  if (!(await stat5(cwd)).isDirectory()) throw new Error("INVALID_WORKSPACE");
  await mkdir6(runtimeRoot, { recursive: true, mode: 448 });
  const root = await realpath6(runtimeRoot);
  const home = join6(root, `h-${operationId}`);
  await mkdir6(home, { mode: 448 });
  for (const folder of ["tmp", "cache", "config", "data", "appdata", "local", "b"]) await mkdir6(join6(home, folder), { mode: 448 });
  const probe = await capabilityProbe({ home, python });
  if (!probe.available) throw new Error(`NATIVE_PEER_UNAVAILABLE: ${probe.reason}`);
  await protectProfile(probe.helper, home);
  const entry = await pinCodexExecutable(suppliedEntry, home);
  const bridge = await createCliBootstrap({ authority, subject, binding, tools, handlers, home: join6(home, "b"), ttlMs: deadlineMs, helper: probe.helper });
  const compilerRoot2 = privateEnvironment(home).DSH_NATIVE_COMPILER_ROOT;
  const config = [
    `model = ${JSON.stringify(requestedModel)}`,
    'model_provider = "openai"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    'web_search = "disabled"',
    'cli_auth_credentials_store = "file"',
    "suppress_unstable_features_warning = true",
    'model_reasoning_effort = "low"',
    ...settings.lines,
    "[features]",
    "shell_tool = false",
    "multi_agent = false",
    "memories = false",
    "[analytics]",
    "enabled = false",
    "[mcp_servers.dsh_task]",
    `command = ${JSON.stringify(bridge.command)}`,
    `args = ${JSON.stringify(bridge.args)}`,
    `cwd = ${JSON.stringify(join6(home, "b"))}`,
    "enabled = true",
    "required = true",
    `enabled_tools = ${JSON.stringify(tools)}`,
    "env_vars = []",
    "startup_timeout_sec = 20",
    "[mcp_servers.dsh_task.env]",
    `HOME = ${JSON.stringify(home)}`,
    `USERPROFILE = ${JSON.stringify(home)}`,
    `TEMP = ${JSON.stringify(join6(home, "tmp"))}`,
    `TMP = ${JSON.stringify(join6(home, "tmp"))}`,
    ...compilerRoot2 ? [`DSH_NATIVE_COMPILER_ROOT = ${JSON.stringify(compilerRoot2)}`] : []
  ].join("\n") + "\n";
  await writeFile3(join6(home, "config.toml"), config, { flag: "wx", mode: 384 });
  if (provisionCredentials) await provisionCredentials(home);
  if (digest(await readFile7(join6(home, "config.toml"))) !== digest(Buffer.from(config))) {
    await bridge.close();
    throw new Error("CLI_PROFILE_CHANGED_DURING_PROVISIONING");
  }
  if (digest(await readFile7(entry.path)) !== entry.sha256) {
    await bridge.close();
    throw new Error("CLI_ENTRY_CHANGED");
  }
  const evidence = createCodexEvidence({ binding, operationId, botId, requestedModel, catalogProvider, catalogModel, entry, billing });
  const env2 = privateEnvironment(home);
  const supervisor = nativeProcess(probe.helper, "supervise", { executable: entry.path, args: ["app-server", "--listen", "stdio://"], cwd, ttlMs: deadlineMs }, { home, env: env2 });
  const pending = /* @__PURE__ */ new Map(), notifications = /* @__PURE__ */ new Set();
  let sequence = 0, closed2 = false, rootProcess, stopEvidence = null, threadId = null, requestCount = 0, stopPromise, activeTurn = false, fatal = null, profileEvidence;
  let usageWrites = Promise.resolve();
  const failPending = (error2) => {
    for (const value of pending.values()) value.reject(error2);
    pending.clear();
  };
  const rpc = (method, params, timeoutMs = 3e4) => new Promise((resolve4, reject) => {
    if (closed2 || fatal) {
      reject(fatal ?? new Error("CLI_CLOSED"));
      return;
    }
    const id2 = ++sequence;
    const timer2 = setTimeout(() => {
      pending.delete(id2);
      reject(new Error(`CLI_RPC_TIMEOUT:${method}`));
    }, Math.min(timeoutMs, deadlineMs));
    const settle = (fn) => (value) => {
      clearTimeout(timer2);
      fn(value);
    };
    pending.set(id2, { resolve: settle(resolve4), reject: settle(reject) });
    void supervisor.send({ id: id2, method, params }).catch((error2) => {
      const value = pending.get(id2);
      pending.delete(id2);
      value?.reject(error2);
    });
  });
  const stop = () => {
    if (stopPromise) return stopPromise;
    closed2 = true;
    failPending(new Error("CLI_STOPPING"));
    clearInterval(grantGuard);
    signal?.removeEventListener("abort", onAbort);
    stopPromise = (async () => {
      await bridge.close();
      if (!fatal && !signal?.aborted && ["completed", "failed"].includes(evidence.snapshot().terminal) && !stopEvidence?.treeStopped) {
        await new Promise((resolve4) => {
          const finish = () => {
            clearTimeout(grace);
            signal?.removeEventListener("abort", finish);
            resolve4();
          };
          const grace = setTimeout(finish, 1e3);
          supervisor.exit.then(finish);
          signal?.addEventListener("abort", finish, { once: true });
          if (signal?.aborted) finish();
        });
      }
      supervisor.end();
      const result = await Promise.race([supervisor.exit, new Promise((resolve4) => {
        const t = setTimeout(() => resolve4(null), 8e3);
        t.unref();
      })]);
      if (!result) {
        if (process.platform === "linux" && rootProcess) {
          try {
            process.kill(-rootProcess.pid, "SIGKILL");
          } catch {
          }
        }
        supervisor.child.kill();
        await supervisor.exit;
      }
      if (!stopEvidence?.treeStopped) stopEvidence = { ...stopEvidence, treeStopped: false, status: "unconfirmed", forcedSupervisorStop: !result };
      return stopEvidence;
    })();
    return stopPromise;
  };
  supervisor.events.on("control", (value) => {
    if (value.control === "spawned") rootProcess = value;
    if (value.control === "stopped") stopEvidence = value;
  });
  supervisor.events.on("message", (message) => {
    if (message.id !== void 0 && !message.method) {
      const value = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) value?.reject(Object.assign(new Error(`CLI_RPC_REFUSED:${message.error.message}`), { code: message.error.code }));
      else value?.resolve(message.result);
      return;
    }
    if (message.id !== void 0) {
      void supervisor.send({ id: message.id, error: { code: -32601, message: "Host callback is not authorized" } }).catch(() => {
      });
      return;
    }
    const update = evidence.event(message);
    if (onProgress && typeof message.method === "string") onProgress({ method: message.method, errorCode: typeof message.params?.error?.codexErrorInfo === "string" ? message.params.error.codexErrorInfo : null });
    if (update.usageChanged && onUsage) {
      const snapshot2 = evidence.snapshot();
      usageWrites = usageWrites.then(() => onUsage(snapshot2));
      void usageWrites.catch((error2) => {
        fatal = error2;
        void stop();
      });
    }
    if (update.mismatch) {
      fatal = new Error("CLI_MODEL_IDENTITY_MISMATCH");
      void stop();
    }
    for (const listener of notifications) listener(message, update);
  });
  supervisor.events.on("failure", (error2) => {
    fatal = error2;
    failPending(error2);
    void stop();
  });
  supervisor.events.once("closed", () => {
    closed2 = true;
    failPending(new Error("CLI_EXITED"));
    void bridge.close();
  });
  const onAbort = () => {
    fatal = new Error("CLI_CANCELLED");
    void stop();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const grantGuard = setInterval(() => {
    try {
      if (bridge.closed) throw new Error("CLI_BRIDGE_CLOSED");
      if (authority.describe(subject).revision !== revision) throw new Error("CLI_GRANT_CHANGED");
      authority.assertModel(subject, catalogProvider, catalogModel);
    } catch {
      fatal = new Error("CLI_GRANT_REVOKED");
      void stop();
    }
  }, 100);
  grantGuard.unref();
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => {
    fatal = new Error("CLI_DEADLINE");
    void stop();
  }, deadlineMs);
  timer.unref();
  try {
    const spawned = await supervisor.waitControl("spawned");
    await bridge.bind(spawned);
    await rpc("initialize", { clientInfo: { name: "dsh_task_executor", title: "DSH Task Executor", version: "0.0.0" }, capabilities: { experimentalApi: true } });
    await supervisor.send({ method: "initialized", params: {} });
    profileEvidence = assertEffectiveProfile(await rpc("config/read", { cwd, includeLayers: false }), { requestedModel, bridge, home: join6(home, "b"), tools, settings });
    const result = await rpc("thread/start", {
      model: requestedModel,
      modelProvider: "openai",
      allowProviderModelFallback: false,
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      ...roleInstructions ? { developerInstructions: roleInstructions } : {}
    });
    evidence.bindThread(result);
    threadId = result.thread.id;
  } catch (error2) {
    clearTimeout(timer);
    await stop();
    error2.bridgeEvidence = bridge.evidence;
    error2.nativeError = supervisor.stderr.slice(-1024);
    throw error2;
  }
  return Object.freeze({
    home,
    entry,
    binding: Object.freeze({ ...binding }),
    operationId,
    async listModels() {
      return rpc("model/list", { includeHidden: false, limit: 100 });
    },
    async listCapabilities() {
      return rpc("mcpServerStatus/list", { threadId, serverName: "dsh_task", detail: "toolsAndAuthOnly", limit: 100 });
    },
    async callCapability(name, args = {}) {
      if (!tools.includes(name)) throw new Error("TOOL_DENIED");
      return rpc("mcpServer/tool/call", { threadId, server: "dsh_task", tool: name, arguments: args });
    },
    async run(prompt) {
      if (!validText(prompt) || activeTurn || requestCount) throw new Error("INVALID_OR_REPEATED_CLI_TURN");
      authority.assertModel(subject, catalogProvider, catalogModel);
      authority.describe(subject);
      if (onBeforeRequest) await onBeforeRequest({ botId, ...binding, operationId, source: "cli", toolId: "codex", requestedModel, entry });
      if (closed2 || fatal) throw fatal ?? new Error("CLI_CLOSED");
      if (authority.describe(subject).revision !== revision) throw new Error("CLI_GRANT_CHANGED");
      authority.assertModel(subject, catalogProvider, catalogModel);
      activeTurn = true;
      requestCount++;
      try {
        const completion = new Promise((resolve4, reject) => {
          const listener = (_message, update) => {
            if (update.completed) {
              notifications.delete(listener);
              resolve4(evidence.snapshot());
            }
          };
          notifications.add(listener);
          supervisor.exit.then(() => {
            notifications.delete(listener);
            reject(fatal ?? new Error("CLI_EXITED_DURING_TURN"));
          });
        });
        completion.catch(() => {
        });
        await rpc("turn/start", { threadId, input: [{ type: "text", text: prompt, text_elements: [] }], model: requestedModel });
        const result = await completion;
        await usageWrites;
        if (fatal) throw fatal;
        return { ...result, status: result.terminal === "completed" ? "succeeded" : "failed" };
      } finally {
        activeTurn = false;
      }
    },
    async cancel() {
      clearTimeout(timer);
      return stop();
    },
    async close() {
      clearTimeout(timer);
      return stop();
    },
    snapshot() {
      return {
        ...evidence.snapshot(),
        cliTurnRequestsDispatched: requestCount,
        actualProviderRequestCount: requestCount ? null : 0,
        actualProviderRequestCountStatus: requestCount ? "not-reported-by-cli" : "no-turn-dispatched",
        process: rootProcess,
        stopEvidence,
        bridge: bridge.evidence,
        profile: profileEvidence,
        enforcement: "application-scope-with-cli-read-only",
        capabilityProbe: { peer: probe.peer, supervisor: probe.supervisor, limitations: probe.limitations }
      };
    },
    get closed() {
      return closed2;
    }
  });
}

// ../packages/cli-runtime/src/agent-codex-runtime.mjs
function agentAuthority(context, validate, requestedModel, catalogProvider, catalogModel) {
  const leases = /* @__PURE__ */ new Map();
  const subject = Object.freeze({});
  const bindingKey = (value) => JSON.stringify(value);
  const current = (token, binding) => {
    validate(context);
    const lease = leases.get(token);
    if (!lease || lease.binding !== bindingKey(binding) || lease.expiresAt <= Date.now()) {
      leases.delete(token);
      throw new Error("AGENT_CLI_LEASE_DENIED");
    }
    return lease;
  };
  const authority = {
    describe() {
      validate(context);
      return { botId: context.botId, revision: context.revision };
    },
    assertModel(_subject, provider, model) {
      validate(context);
      if (provider !== catalogProvider || model !== catalogModel || requestedModel !== catalogModel) throw new Error("AGENT_CLI_MODEL_DENIED");
    },
    issue(_subject, { binding, tools, ttlMs }) {
      validate(context);
      if (binding?.location !== "remote" || !Array.isArray(tools) || tools.length || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 3e5) throw new Error("AGENT_CLI_LEASE_DENIED");
      const token = randomBytes6(32).toString("base64url");
      leases.set(token, { binding: bindingKey(binding), tools: new Set(tools), expiresAt: Math.min(Date.now() + ttlMs, context.expiresAt) });
      return { token };
    },
    list(token, binding) {
      return [...current(token, binding).tools].sort();
    },
    renew(token, binding, { ttlMs }) {
      const lease = current(token, binding);
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 3e5) throw new Error("AGENT_CLI_LEASE_DENIED");
      lease.expiresAt = Math.min(Date.now() + ttlMs, context.expiresAt);
      return { ttlMs };
    },
    async run(token, binding, tool, execute, { signal } = {}) {
      const lease = current(token, binding);
      if (!lease.tools.has(tool)) throw new Error("AGENT_CLI_TOOL_DENIED");
      validate(context);
      return execute({ signal: signal ?? new AbortController().signal });
    },
    release(token) {
      leases.delete(token);
    }
  };
  return { authority, subject, close: () => leases.clear() };
}
async function createAgentCodexSession(options) {
  const { context, validate, requestedModel, catalogProvider = "openai", catalogModel = requestedModel } = options ?? {};
  if (options?.binding?.location !== "remote" || !context || typeof validate !== "function") throw new Error("AGENT_CLI_REMOTE_BINDING_REQUIRED");
  if (!Array.isArray(options.tools) || options.tools.length || !Array.isArray(options.handlers) || options.handlers.length) throw new Error("AGENT_CLI_CAPABILITIES_FIXED");
  const local = agentAuthority(context, validate, requestedModel, catalogProvider, catalogModel);
  try {
    const session = await createCodexSessionCore({ ...options, authority: local.authority, subject: local.subject });
    const close = session.close;
    return Object.freeze({ ...session, async close() {
      try {
        return await close();
      } finally {
        local.close();
      }
    }, async cancel() {
      try {
        return await session.cancel();
      } finally {
        local.close();
      }
    } });
  } catch (error2) {
    local.close();
    throw error2;
  }
}

// src/cli-task.ts
var ref = (value) => typeof value === "string" && /^[-A-Za-z0-9_.]{1,128}$/.test(value);
var plain = (value) => value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
var closed = (value, keys) => {
  if (!plain(value) || Object.keys(value).some((key2) => !keys.includes(key2))) fail("INVALID_CLI_ARGUMENT");
  return value;
};
var inside = (parent, child) => {
  const part = relative(parent, child);
  return part !== "" && !part.startsWith("..") && !isAbsolute6(part);
};
function validateCliProfiles(value, dataDir, roots) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 64 || !["win32", "linux"].includes(process.platform)) fail("CLI_PROFILE_CONFIG_INVALID");
  const seen = /* @__PURE__ */ new Set(), runtimeRoots = /* @__PURE__ */ new Set();
  return value.map((raw) => {
    closed(raw, ["profileId", "rootId", "profileRevision", "executable", "runtimeRoot", "entry", "bots"]);
    if (!ref(raw.profileId) || !ref(raw.rootId) || !Object.hasOwn(roots, raw.rootId) || !Number.isSafeInteger(raw.profileRevision) || raw.profileRevision < 1 || !isAbsolute6(raw.executable) || !isAbsolute6(raw.runtimeRoot) || !inside(resolve2(dataDir), resolve2(raw.runtimeRoot))) fail("CLI_PROFILE_CONFIG_INVALID");
    closed(raw.entry, ["sha256", "version"]);
    if (!/^[a-f0-9]{64}$/.test(raw.entry.sha256) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(raw.entry.version)) fail("CLI_PROFILE_CONFIG_INVALID");
    if (!plain(raw.bots) || !Object.keys(raw.bots).length) fail("CLI_PROFILE_CONFIG_INVALID");
    for (const [botId, bot] of Object.entries(raw.bots)) {
      if (!ref(botId)) fail("CLI_PROFILE_CONFIG_INVALID");
      closed(bot, ["credentialRef"]);
      if (!isAbsolute6(bot.credentialRef) || bot.credentialRef.length > 4096 || bot.credentialRef.includes("\0")) fail("CLI_PROFILE_CONFIG_INVALID");
    }
    const key2 = `${raw.rootId}/${raw.profileId}`, runtime = resolve2(raw.runtimeRoot);
    if (seen.has(key2) || runtimeRoots.has(runtime)) fail("CLI_PROFILE_CONFIG_INVALID");
    seen.add(key2);
    runtimeRoots.add(runtime);
    return { profileId: raw.profileId, rootId: raw.rootId, profileRevision: raw.profileRevision, executable: resolve2(raw.executable), runtimeRoot: runtime, entry: { sha256: raw.entry.sha256, version: raw.entry.version }, bots: structuredClone(raw.bots) };
  });
}
var CliTasks = class {
  constructor(cliProfiles, store, roots) {
    this.store = store;
    this.roots = roots;
    this.profiles = new Map(cliProfiles.map((profile) => [`${profile.rootId}/${profile.profileId}`, profile]));
  }
  store;
  roots;
  profiles;
  async identity(a, c, probe) {
    const base = ["rootId", "workspaceRef", "profileId", "profileRevision", "entry", "requestedModel", "catalogProvider", "catalogModel", "billing", "deadlineMs"];
    closed(a, [...base, ...probe ? [] : ["task"]]);
    closed(a.workspaceRef, ["kind", "machineId", "rootId", "relativePath", "workspaceId"]);
    closed(a.entry, ["sha256", "version"]);
    if (!ref(a.rootId) || !c.roots.includes(a.rootId) || !ref(a.profileId) || !Number.isSafeInteger(a.profileRevision) || a.profileRevision < 1 || a.workspaceRef.kind !== "remote" || a.workspaceRef.machineId !== this.store.machineId || a.workspaceRef.rootId !== a.rootId || typeof a.workspaceRef.relativePath !== "string" || a.workspaceRef.relativePath.length > 2048 || typeof a.workspaceRef.workspaceId !== "string" || !/^[a-f0-9]{64}$/.test(a.entry.sha256) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(a.entry.version) || !/^gpt-[A-Za-z0-9_.-]{1,100}$/.test(a.requestedModel) || typeof a.catalogProvider !== "string" || !a.catalogProvider || typeof a.catalogModel !== "string" || !a.catalogModel || !["api", "subscription"].includes(a.billing) || !Number.isSafeInteger(a.deadlineMs) || a.deadlineMs < 1e3 || a.deadlineMs > 72e5) fail("INVALID_CLI_ARGUMENT");
    if (!probe && (typeof a.task !== "string" || !a.task.trim() || a.task.includes("\0") || Buffer.byteLength(a.task) > 16e3)) fail("INVALID_CLI_ARGUMENT");
    const profile = this.profiles.get(`${a.rootId}/${a.profileId}`);
    if (!profile || profile.profileRevision !== a.profileRevision || profile.entry.sha256 !== a.entry.sha256 || profile.entry.version !== a.entry.version || !Object.hasOwn(profile.bots, c.botId)) fail("CLI_PROFILE_DENIED", 403);
    const workspaceId = "remote_" + sha(canonical({ rootId: a.rootId, workspaceRelativePath: a.workspaceRef.relativePath, profileId: a.profileId, profileRevision: a.profileRevision, entrySha256: a.entry.sha256, entryVersion: a.entry.version }));
    if (a.workspaceRef.workspaceId !== workspaceId) fail("CLI_WORKSPACE_IDENTITY_MISMATCH", 403);
    const cwd = await this.roots.resolve(a.rootId, a.workspaceRef.relativePath);
    if (!(await stat6(cwd)).isDirectory()) fail("CLI_WORKSPACE_OUTSIDE_SCOPE", 403);
    const pin = await WorkspacePin.capture(cwd);
    await pin.verify();
    return { args: a, profile, workspaceId, pin };
  }
  async provision(profile, c, home) {
    const reference = profile.bots[c.botId].credentialRef;
    const bytes = await readFile8(reference);
    if (bytes.length > 65536) fail("CLI_CREDENTIAL_PROVISION_FAILED");
    await writeFile4(join7(home, "auth.json"), bytes, { flag: "wx", mode: 384 });
  }
  async session(identity, c, operationId, signal) {
    const { args, profile, workspaceId, pin } = identity;
    return createAgentCodexSession({
      context: c,
      validate: () => this.store.validate(c),
      binding: { taskId: c.taskId, attemptId: c.attemptId, machineId: this.store.machineId, workspaceId, location: "remote" },
      operationId,
      runtimeRoot: profile.runtimeRoot,
      workspace: pin.identity.path,
      entry: { executable: profile.executable, ...profile.entry },
      requestedModel: args.requestedModel,
      catalogProvider: args.catalogProvider,
      catalogModel: args.catalogModel,
      billing: args.billing,
      deadlineMs: args.deadlineMs,
      tools: [],
      handlers: [],
      signal,
      provisionCredentials: (home) => this.provision(profile, c, home)
    });
  }
  remoteReceipt(identity, snapshot2) {
    const { args, pin } = identity;
    return { ...snapshot2, remote: { rootId: args.rootId, workspaceRelativePath: args.workspaceRef.relativePath, profileId: args.profileId, profileRevision: args.profileRevision, workspaceIdentity: pin.identity } };
  }
  async probe(a, c, operationId) {
    if (!operationId) fail("OPERATION_ID_REQUIRED");
    const identity = await this.identity(a, c, true), controller = new AbortController();
    let session;
    try {
      session = await this.session(identity, c, operationId, controller.signal);
      const readiness = await session.listCapabilities(), stop = await session.close(), snapshot2 = this.remoteReceipt(identity, session.snapshot());
      if (stop?.treeStopped !== true) fail("CLI_STOP_UNCONFIRMED", 409);
      return {
        schemaVersion: 1,
        kind: "remote-cli-probe",
        status: "available",
        location: "remote",
        machineId: this.store.machineId,
        rootId: a.rootId,
        workspaceId: identity.workspaceId,
        workspaceRelativePath: a.workspaceRef.relativePath,
        workspaceIdentity: identity.pin.identity,
        profileId: a.profileId,
        profileRevision: a.profileRevision,
        entry: { sha256: a.entry.sha256, version: a.entry.version, path: session.entry.path },
        requestedModel: a.requestedModel,
        loginStatus: "unknown",
        versionStatus: "available",
        dependencyStatus: "available",
        nativeStatus: "available",
        profileStatus: "available",
        readinessStatus: "available",
        readiness,
        home: session.home,
        cwd: identity.pin.identity.path,
        stopConfirmed: true,
        stopEvidence: stop,
        capabilityProbe: snapshot2.capabilityProbe,
        profile: snapshot2.profile
      };
    } finally {
      await session?.close().catch(() => {
      });
      controller.abort();
      await identity.pin.close();
    }
  }
  async run(a, c, operationId, hooks) {
    let identity, session, stop = null, error2 = null;
    const controller = new AbortController();
    hooks.setProcess({ context: c, cancel: async () => {
      controller.abort(new Error("CANCELLED"));
      await session?.close();
    } });
    try {
      identity = await this.identity(a, c, false);
      session = await this.session(identity, c, operationId, controller.signal);
      await identity.pin.verify();
      await session.run(a.task);
      await identity.pin.verify();
    } catch (e) {
      error2 = e;
    } finally {
      try {
        stop = await session?.close();
      } catch (e) {
        error2 ??= e;
      }
      if (identity) await identity.pin.close();
      hooks.clearProcess();
    }
    const base = session?.snapshot(), receipt2 = identity && base ? this.remoteReceipt(identity, base) : null, stopConfirmed = stop?.treeStopped === true;
    if (receipt2 && stopConfirmed && controller.signal.aborted && !["completed", "failed"].includes(receipt2.terminal)) receipt2.terminal = "interrupted";
    const terminal2 = receipt2?.terminal === "completed" ? "succeeded" : receipt2?.terminal === "failed" ? "failed" : receipt2?.terminal === "interrupted" ? "cancelled" : "unknown";
    const status = !stopConfirmed ? "unknown" : error2 && terminal2 === "succeeded" ? "unknown" : terminal2;
    const code = status === "unknown" ? "OUTCOME_UNKNOWN" : status === "cancelled" ? "CANCELLED" : status === "failed" ? error2?.code ?? "CLI_TASK_FAILED" : null;
    const result = {
      kind: "remote-cli",
      schemaVersion: 1,
      receipt: receipt2,
      stopConfirmed,
      stopEvidence: stop ?? { treeStopped: false, status: "unconfirmed" },
      exitCode: Number.isSafeInteger(stop?.exitCode) ? stop.exitCode : null,
      ...receipt2?.cliTurnRequestsDispatched === 0 ? { notStarted: true, possiblyApplied: false } : {}
    };
    return { status, result, error: code };
  }
};

// src/agent.ts
var execFileAsync = promisify2(execFile2);
var ARTIFACT_QUOTA_BYTES = 256 * 1024 * 1024;
var Agent = class {
  constructor(config, Database) {
    this.config = config;
    const cliProfiles = validateCliProfiles(config.cliProfiles, config.dataDir, config.roots);
    this.store = new Store(resolve3(config.dataDir), Database);
    this.roots = new Roots(config.roots, { protectedPaths: [resolve3(config.dataDir), ...config.desktop ? [resolve3(config.desktop.secretFile)] : []] });
    this.cliTasks = new CliTasks(cliProfiles, this.store, this.roots);
    this.browser = new BrowserTools(config.browserOrigins ?? [], config.browserExecutablePath, void 0, config.browserProfiles);
    this.desktop = new DesktopTools(config.desktop, { validate: (c) => this.store.validate(c) });
    try {
      this.rootsGeneration = rootsGeneration(config.roots);
      this.workspaces = new WorkspaceAdmissions(this.store, this.rootsGeneration);
      this.store.db.exec("CREATE TABLE IF NOT EXISTS agent_stop_receipts(operation_id TEXT PRIMARY KEY REFERENCES operations(id),proof TEXT NOT NULL)");
      this.store.db.exec(`CREATE TABLE IF NOT EXISTS workspace_legacy_fences(operation_id TEXT PRIMARY KEY);
       INSERT OR IGNORE INTO workspace_legacy_fences SELECT id FROM operations WHERE tool IN ('fs_write','shell_exec','worktree_create','worktree_integrate') AND status IN ('admitted','running','cancel_pending','unknown') AND NOT EXISTS(SELECT 1 FROM workspace_admissions WHERE operation_id=operations.id);`);
      const generationChange = reconcileRootsGeneration(this.store.db, this.rootsGeneration);
      if (generationChange.changed) this.store.audit("WORKSPACE_ROOTS_GENERATION_CHANGED");
      if (config.container) {
        if (config.isolation !== "container" || Object.keys(config.executables ?? {}).length || config.shell || config.windowsJobRunner) fail("CONTAINER_CONFIG_INVALID");
        this.container = new ContainerCommands(this.store, config.container);
      } else if (config.isolation === "container") fail("CONTAINER_CONFIG_INVALID");
    } catch (e) {
      this.store.close();
      throw e;
    }
    this.desktopSessions = new DesktopSessions(config.desktop, { validate: (c) => this.store.validate(c), audit: (code, actor, operation) => this.store.audit(code, actor, operation) });
    this.authTimer = setInterval(() => {
      for (const p of [...this.processes.values(), ...this.desktopJobs.values()]) {
        try {
          this.store.validate(p.context);
        } catch {
          void p.cancel("GRANT_REVOKED");
        }
      }
      ;
      void this.container?.sweep((data, c) => this.artifact(data, c, "text/plain")).catch(() => {
      });
    }, 100);
    this.authTimer.unref();
  }
  config;
  store;
  roots;
  browser;
  desktop;
  desktopSessions;
  workspaces;
  container;
  cliTasks;
  rootsGeneration;
  processes = /* @__PURE__ */ new Map();
  jobs = /* @__PURE__ */ new Map();
  desktopJobs = /* @__PURE__ */ new Map();
  cancelRequested = /* @__PURE__ */ new Set();
  writes = /* @__PURE__ */ new Set();
  authTimer;
  async call(name, args, c, operationId) {
    this.store.validate(c);
    if (!TOOL_NAMES.includes(name) || !c.tools.includes(name)) fail("SCOPE_DENIED", 403);
    if (args?.rootId && !c.roots.includes(args.rootId)) fail("SCOPE_DENIED", 403);
    if (name === "cli_probe_v1") return this.cliTasks.probe(args, c, operationId);
    if (name === "machine_ping") return { schemaVersion: 1, machineId: this.store.machineId, agentVersion: AGENT_VERSION, agentApiMajor: AGENT_API_MAJOR, rootsGeneration: this.rootsGeneration, os: { platform: process.platform, arch: process.arch }, node: process.version, isolation: this.config.isolation ?? "application", isolationStatus: this.container ? "command-container" : "configuration-only", container: this.container ? await this.container.probe() : null, capabilities: TOOL_NAMES.filter((n) => (!n.startsWith("desktop_") || !!this.config.desktop) && (!this.container || !n.startsWith("worktree_"))), browser: await this.browser.probe(), shell: { configured: !!this.container || !!Object.keys(this.config.executables ?? {}).length || !!this.config.shell, processIsolation: this.container ? "container" : process.platform === "win32" ? this.config.windowsJobRunner ? "job-object-configured" : "unavailable" : "process-group" }, desktop: { configured: !!this.config.desktop, status: this.config.desktop ? "unverified" : "unavailable" } };
    if (name === "operation_status") {
      if (this.container) {
        await this.container.observe(args.operationId, c, (data, context) => this.artifact(data, context, "text/plain"));
        this.store.validate(c);
      }
      return this.operationStatus(args.operationId, c);
    }
    if (name === "operation_cancel") {
      this.store.status(args.operationId, c);
      const p = this.processes.get(args.operationId), desktop = this.desktopJobs.get(args.operationId), pending = this.jobs.has(args.operationId);
      let requested = !!p || !!desktop || pending;
      if (p) await p.cancel("CANCELLED");
      else if (desktop) await desktop.cancel("CANCELLED");
      else if (pending) this.cancelRequested.add(args.operationId);
      else if (this.container) requested = await this.container.cancel(args.operationId, c);
      if (this.container) {
        await this.container.observe(args.operationId, c, (data, context) => this.artifact(data, context, "text/plain"));
        this.store.validate(c);
      }
      const operation = this.operationStatus(args.operationId, c);
      const terminal2 = ["succeeded", "failed", "cancelled"].includes(operation.status);
      const inProcessWrite = operation.tool === "fs_write" && !!operation.stopProof;
      const evidence = operation.tool !== "fs_write" && (operation.result?.stopConfirmed === true || operation.result?.notStarted === true);
      const writeSettled = operation.tool !== "fs_write" || !this.jobs.has(args.operationId) && !this.processes.has(args.operationId);
      const stopConfirmed = terminal2 && writeSettled && (inProcessWrite || evidence);
      return { cancelRequested: requested, stopConfirmed, ...stopConfirmed && operation.stopProof ? { stopProof: operation.stopProof } : {}, operation };
    }
    if (!isMutating(name)) return this.execute(name, args, c);
    if (!operationId) fail("OPERATION_ID_REQUIRED");
    const admitted = this.store.admit(operationId, c, name, args);
    if (!admitted.fresh) return name === "fs_write" ? this.operationStatus(operationId, c) : admitted.operation;
    this.store.running(operationId);
    if (name === "cli_task_v1") {
      const job = (async () => {
        let settled;
        try {
          settled = await this.cliTasks.run(args, c, operationId, { setProcess: (record) => this.processes.set(operationId, record), clearProcess: () => this.processes.delete(operationId) });
        } catch (e) {
          settled = { status: "unknown", result: { kind: "remote-cli", schemaVersion: 1, receipt: null, stopConfirmed: false, stopEvidence: { treeStopped: false, status: "unconfirmed" } }, error: "OUTCOME_UNKNOWN" };
        }
        this.jobs.delete(operationId);
        this.processes.delete(operationId);
        this.cancelRequested.delete(operationId);
        this.store.finish(operationId, settled.status, settled.result, settled.error);
        return this.operationStatus(operationId, c);
      })().finally(() => {
        this.jobs.delete(operationId);
        this.processes.delete(operationId);
        this.cancelRequested.delete(operationId);
      });
      this.jobs.set(operationId, job);
      return this.store.status(operationId, c);
    }
    if (name === "shell_exec" || name === "container_command_v1") {
      const commandOnly = name === "container_command_v1";
      const job = (async () => {
        if (commandOnly) {
          if (!this.container) fail("CONTAINER_COMMAND_UNAVAILABLE", 503);
          if (args?.script !== void 0 || !args?.workspaceRef?.rootId) fail("INVALID_ARGUMENT");
        }
        return this.container ? this.withWorkspace(args.workspaceRef?.rootId, c, operationId, () => this.shell(args, c, operationId)) : this.shell(args, c, operationId);
      })().catch((e) => {
        const notStarted = commandOnly && !this.container || this.container && !this.store.db.prepare("SELECT 1 FROM container_workers WHERE operation_id=?").get(operationId);
        this.store.finish(operationId, "failed", notStarted ? { notStarted: true, stopConfirmed: true, possiblyApplied: false } : null, e instanceof AgentError ? e.code : "EXECUTION_FAILED");
      }).finally(() => {
        this.jobs.delete(operationId);
        this.cancelRequested.delete(operationId);
      });
      this.jobs.set(operationId, job);
      return this.store.status(operationId, c);
    }
    if (name === "fs_write") {
      const controller = new AbortController();
      this.processes.set(operationId, { context: c, cancel: async (why) => {
        controller.abort(new AgentError(why));
      } });
      const job = (async () => {
        try {
          const result = await this.withWorkspace(args.rootId, c, operationId, (pin) => this.execute(name, args, c, controller.signal, pin));
          this.store.finish(operationId, controller.signal.aborted ? "cancelled" : "succeeded", controller.signal.aborted ? { ...result, stopConfirmed: true, possiblyApplied: true } : { ...result, stopConfirmed: true }, controller.signal.aborted ? "CANCELLED" : null);
        } catch (e) {
          const cancelled = e?.code === "WRITE_CANCELLED", published = e?.published === true, unknown2 = !cancelled && (published || e?.code === "OUTCOME_UNKNOWN");
          const digest2 = cancelled && published && e?.result && /^[a-f0-9]{64}$/.test(e.result.sha256) && Number.isSafeInteger(e.result.size) && e.result.size >= 0 && e.result.size <= 1048576 ? { sha256: e.result.sha256, size: e.result.size } : {};
          this.store.finish(operationId, cancelled ? "cancelled" : unknown2 ? "unknown" : "failed", unknown2 ? null : { stopConfirmed: true, possiblyApplied: cancelled && e?.possiblyApplied === false ? false : true, ...digest2 }, cancelled && published ? "CANCELLED" : unknown2 ? "OUTCOME_UNKNOWN" : e instanceof AgentError ? e.code : "EXECUTION_FAILED");
        } finally {
          this.jobs.delete(operationId);
          this.processes.delete(operationId);
          this.cancelRequested.delete(operationId);
        }
        const operation = this.store.status(operationId, c);
        if (["succeeded", "failed", "cancelled"].includes(operation.status)) {
          const proof = { schemaVersion: 1, kind: "agent-stop-receipt", source: "in-process-write", machineId: this.store.machineId, taskId: c.taskId, attemptId: c.attemptId, operationId, tool: "fs_write", status: operation.status, receiptHash: sha(canonical(operation)) };
          this.store.db.prepare("INSERT OR REPLACE INTO agent_stop_receipts VALUES(?,?)").run(operationId, canonical(proof));
        }
        return this.operationStatus(operationId, c);
      })();
      this.jobs.set(operationId, job);
      return job;
    }
    if (name.startsWith("desktop_")) {
      const controller = new AbortController();
      let job;
      const cancel = async (why) => {
        controller.abort(new AgentError(why));
        await this.desktop.cancel(c);
        await job;
      };
      job = (async () => {
        try {
          const result = await this.execute(name, args, c, controller.signal);
          this.store.validate(c);
          if (controller.signal.aborted) {
            const stop = await this.desktop.cancel(c);
            throw Object.assign(new AgentError(stop.stopConfirmed ? "DESKTOP_CANCELLED" : "OUTCOME_UNKNOWN"), { stopConfirmed: stop.stopConfirmed, possiblyApplied: name !== "desktop_screenshot" });
          }
          this.store.finish(operationId, "succeeded", result);
        } catch (e) {
          if (e.code === "GRANT_REVOKED") {
            controller.abort(e);
            const stop = await this.desktop.cancel(c);
            e = Object.assign(new AgentError(stop.stopConfirmed ? "DESKTOP_CANCELLED" : "OUTCOME_UNKNOWN"), { stopConfirmed: stop.stopConfirmed, possiblyApplied: name !== "desktop_screenshot" });
          }
          const code = e instanceof AgentError ? e.code : "EXECUTION_FAILED", stopped = e.stopConfirmed === true, possiblyApplied = e.possiblyApplied === true;
          const state = code === "DESKTOP_CANCELLED" && stopped ? "cancelled" : code === "OUTCOME_UNKNOWN" || possiblyApplied ? "unknown" : "failed";
          this.store.finish(operationId, state, { stopConfirmed: stopped, possiblyApplied, cancelReason: controller.signal.aborted ? controller.signal.reason?.code ?? "CANCELLED" : null }, code);
        } finally {
          this.desktopJobs.delete(operationId);
          this.jobs.delete(operationId);
        }
        return this.store.status(operationId, c);
      })();
      this.jobs.set(operationId, job);
      this.desktopJobs.set(operationId, { context: c, cancel });
      return job;
    }
    try {
      const result = await this.execute(name, args, c);
      this.store.finish(operationId, "succeeded", result);
    } catch (e) {
      this.store.finish(operationId, e instanceof AgentError && e.code === "OUTCOME_UNKNOWN" ? "unknown" : "failed", null, e instanceof AgentError ? e.code : "EXECUTION_FAILED");
    }
    return this.store.status(operationId, c);
  }
  operationStatus(id2, c) {
    const operation = this.store.status(id2, c), saved = this.store.db.prepare("SELECT proof FROM agent_stop_receipts WHERE operation_id=?").get(id2);
    if (!saved || this.jobs.has(id2) || this.processes.has(id2)) return operation;
    const proof = JSON.parse(saved.proof);
    if (proof.schemaVersion !== 1 || proof.kind !== "agent-stop-receipt" || proof.source !== "in-process-write" || proof.machineId !== operation.machineId || proof.taskId !== c.taskId || proof.attemptId !== c.attemptId || proof.operationId !== id2 || proof.tool !== operation.tool || proof.status !== operation.status || proof.receiptHash !== sha(canonical(operation))) return operation;
    return { ...operation, stopProof: proof };
  }
  async artifact(data, c, media = "application/octet-stream") {
    if (data.length > 8 * 1024 * 1024) fail("ARTIFACT_LIMIT", 413);
    const usage = await this.evictArtifacts(data.length);
    if (usage + data.length > ARTIFACT_QUOTA_BYTES) fail("ARTIFACT_QUOTA", 507);
    const id2 = `artifact-${randomUUID7()}`;
    await mkdir7(join8(this.config.dataDir, "artifacts"), { recursive: true, mode: 448 });
    await writeFile5(join8(this.config.dataDir, "artifacts", id2), data, { flag: "wx", mode: 384 });
    this.store.db.prepare("INSERT INTO artifacts VALUES (?,?,?,?,?)").run(id2, canonical(c), sha(data), data.length, media);
    return { artifactId: id2, sha256: sha(data), size: data.length, mediaType: media };
  }
  async evictArtifacts(needed) {
    let usage = this.store.db.prepare("SELECT coalesce(sum(size),0) AS size FROM artifacts").get().size;
    if (usage + needed <= ARTIFACT_QUOTA_BYTES) return usage;
    const rows = this.store.db.prepare("SELECT id,size FROM artifacts ORDER BY rowid ASC").all();
    for (const row of rows) {
      if (usage + needed <= ARTIFACT_QUOTA_BYTES) break;
      this.store.db.prepare("DELETE FROM artifacts WHERE id=?").run(row.id);
      usage -= row.size;
      await unlink5(join8(this.config.dataDir, "artifacts", row.id)).catch(() => {
      });
    }
    return usage;
  }
  async execute(name, a, c, signal, pin) {
    if (name === "fs_list") {
      const all = await this.roots.list(a.rootId, a.relativePath ?? "");
      all.sort((x, y) => x.name.localeCompare(y.name));
      const offset = integer(a.cursor ? Number(a.cursor) : 0, 0, 1e9), limit = integer(a.limit, 1, 1e3, 100);
      return { entries: all.slice(offset, offset + limit).map((x) => ({ name: x.name, type: x.isSymbolicLink() ? "link" : x.isDirectory() ? "directory" : "file" })), cursor: offset + limit < all.length ? String(offset + limit) : null };
    }
    if (name === "fs_read") {
      const offset = integer(a.offset, 0, Number.MAX_SAFE_INTEGER, 0), length = integer(a.length, 1, 1048576, 65536);
      const { data, size } = await this.roots.read(a.rootId, a.relativePath, offset, length);
      return { encoding: "base64", content: data.toString("base64"), sha256: sha(data), offset, size, eof: offset + data.length >= size };
    }
    if (name === "fs_write") return this.write(a, c, signal, pin);
    if (name.startsWith("artifact_")) {
      const row = this.store.db.prepare("SELECT * FROM artifacts WHERE id=?").get(a.artifactId);
      if (!row) fail("ARTIFACT_NOT_FOUND", 404);
      this.store.own(row.context, c);
      if (name === "artifact_stat") return { artifactId: row.id, sha256: row.hash, size: row.size, mediaType: row.media };
      const offset = integer(a.offset, 0, Number.MAX_SAFE_INTEGER, 0), length = integer(a.length, 1, 1048576, 65536), data = await readFile9(join8(this.config.dataDir, "artifacts", row.id));
      if (sha(data) !== row.hash) fail("ARTIFACT_CORRUPT");
      return { encoding: "base64", content: data.subarray(offset, offset + length).toString("base64"), eof: offset + length >= row.size };
    }
    if (name.startsWith("browser_")) return this.browser.run(name, a, c);
    if (name.startsWith("desktop_")) {
      const result = await this.desktop.run(name, a, c, signal);
      this.store.validate(c);
      if (result.pngBase64) {
        const artifact = await this.artifact(Buffer.from(result.pngBase64, "base64"), c, "image/png");
        delete result.pngBase64;
        return { ...result, ...artifact };
      }
      return result;
    }
    if (name.startsWith("worktree_")) return this.worktree(name, a, c);
    fail("TOOL_NOT_READY", 503);
  }
  async withWorkspace(rootId, c, id2, run) {
    if (typeof rootId !== "string" || !c.roots.includes(rootId)) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
    const pin = await WorkspacePin.capture(await this.roots.resolve(rootId, ""));
    try {
      const legacy = this.store.db.prepare(`SELECT o.id FROM workspace_legacy_fences f JOIN operations o ON o.id=f.operation_id WHERE o.status IN ('admitted','running','cancel_pending','unknown') OR (o.tool='shell_exec' AND NOT (o.status IN ('succeeded','failed','cancelled') AND (coalesce(json_type(o.result,'$.stopConfirmed'),'null')='true' OR coalesce(json_type(o.result,'$.notStarted'),'null')='true'))) LIMIT 1`).get();
      if (legacy) fail("WORKSPACE_RECOVERY_REQUIRED", 409);
      const generationFenced = this.store.db.prepare(`SELECT o.id FROM workspace_generation_fences f JOIN operations o ON o.id=f.operation_id WHERE o.status IN ('admitted','running','cancel_pending','unknown') OR (o.tool='shell_exec' AND NOT (o.status IN ('succeeded','failed','cancelled') AND (coalesce(json_type(o.result,'$.stopConfirmed'),'null')='true' OR coalesce(json_type(o.result,'$.notStarted'),'null')='true'))) LIMIT 1`).get();
      if (generationFenced) fail("WORKSPACE_RECOVERY_REQUIRED", 409);
      this.workspaces.admit(id2, c, pin.identity);
      await pin.verify();
      return await run(pin);
    } finally {
      await pin.close();
    }
  }
  async write(a, c, signal, pin) {
    if (signal?.aborted) throw Object.assign(new AgentError("WRITE_CANCELLED", 409), { possiblyApplied: false });
    if (!Object.hasOwn(a, "expectedHash") || a.expectedHash !== null && !/^[a-f0-9]{64}$/.test(a.expectedHash)) fail("EXPECTED_HASH_REQUIRED");
    if (typeof a.content !== "string" || Buffer.byteLength(a.content) > 1048576 || !["utf8", "base64", void 0].includes(a.encoding)) fail("INVALID_ARGUMENT");
    const target = await this.roots.resolve(a.rootId, a.relativePath, true);
    if (this.writes.has(target)) fail("FILE_CHANGED", 409);
    this.writes.add(target);
    try {
      if (pinnedWriteSupported()) return await this.pinnedWrite(a, c, signal, target, pin);
      return await this.legacyWrite(a, c, signal, target);
    } finally {
      this.writes.delete(target);
    }
  }
  /**
   * Descriptor-pinned publication for Linux: only brand-new files. Every
   * existing target answers the public FILE_CHANGED contract, an explicit
   * hash-overwrite request is refused outright instead of falling back to the
   * rename path, and a missing target keeps the old mismatch answer.
   */
  async pinnedWrite(a, c, signal, target, pin) {
    if (a.expectedHash !== null) {
      try {
        const data = (await this.roots.read(a.rootId, a.relativePath, 0, 1048577)).data;
        if (data.length > 1048576) fail("FILE_TOO_LARGE");
        fail(sha(data) === a.expectedHash ? "OVERWRITE_UNSUPPORTED" : "FILE_CHANGED", sha(data) === a.expectedHash ? 501 : 409);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        fail("FILE_CHANGED", 409);
      }
    }
    try {
      const result = await pinnedCreateNewFile({
        rootPath: pin ? pin.identity.path : await realpath7(await this.roots.resolve(a.rootId, "")),
        relativePath: a.relativePath,
        content: a.content,
        encoding: a.encoding,
        signal,
        check: (report) => this.pinnedWritePolicy(a, c, pin, report)
      });
      return { sha256: result.sha256, size: result.size };
    } catch (e) {
      if (e instanceof AgentError && e.code === "TARGET_EXISTS") fail("FILE_CHANGED", 409);
      throw e;
    }
  }
  /** Grant, protected-path and root-identity rechecks at every pinned-write phase. */
  async pinnedWritePolicy(a, c, pin, report) {
    this.store.validate(c);
    await this.roots.assertPublicTree(report.targetPath);
    if (pin) await pin.verify();
  }
  async legacyWrite(a, c, signal, target) {
    const temp = join8(dirname2(target), `.dsh-write-${randomUUID7()}`);
    try {
      const parent = await stat7(dirname2(target));
      let previous = null;
      try {
        previous = (await this.roots.read(a.rootId, a.relativePath, 0, 1048577)).data;
        if (previous.length > 1048576) fail("FILE_TOO_LARGE");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if ((previous === null ? null : sha(previous)) !== a.expectedHash) fail("FILE_CHANGED", 409);
      const data = Buffer.from(a.content, a.encoding ?? "utf8");
      await writeFile5(temp, data, { flag: "wx", mode: 384 });
      if (signal?.aborted) throw Object.assign(new AgentError("WRITE_CANCELLED", 409), { possiblyApplied: false });
      this.store.validate(c);
      await this.roots.resolve(a.rootId, a.relativePath, true);
      const now = await stat7(dirname2(target));
      if (now.ino !== parent.ino || now.dev !== parent.dev) fail("FILE_CHANGED", 409);
      let current = null;
      try {
        current = (await this.roots.read(a.rootId, a.relativePath, 0, 1048577)).data;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if ((current === null ? null : sha(current)) !== a.expectedHash) fail("FILE_CHANGED", 409);
      if (signal?.aborted) throw Object.assign(new AgentError("WRITE_CANCELLED", 409), { possiblyApplied: false });
      await rename(temp, target);
      return { sha256: sha(data), size: data.length };
    } finally {
      await unlink5(temp).catch(() => {
      });
    }
  }
  async shell(a, c, id2) {
    if (!a.workspaceRef || a.workspaceRef.kind !== "remote" || a.workspaceRef.machineId !== this.store.machineId || !c.roots.includes(a.workspaceRef.rootId)) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
    const cwd = await this.roots.resolve(a.workspaceRef.rootId, a.workspaceRef.relativePath ?? "");
    if (!(await stat7(cwd)).isDirectory()) fail("WORKSPACE_OUTSIDE_SCOPE");
    const timeout = integer(a.timeoutMs, 1, 18e5, 6e4);
    let executable, argv;
    if (this.container) {
      if (a.argv) {
        if (!Array.isArray(a.argv) || a.argv.length < 1 || a.argv.length > 256 || a.argv.some((x) => typeof x !== "string" || x.includes("\0"))) fail("INVALID_ARGUMENT");
        executable = this.config.container.executables[a.argv[0]];
        if (!executable) fail("EXECUTABLE_NOT_ALLOWED", 403);
        argv = a.argv.slice(1);
      } else {
        if (this.config.container.shell !== true || typeof a.script !== "string" || a.script.length > 1048576) fail("SCRIPT_NOT_ALLOWED", 403);
        executable = "/bin/sh";
        argv = ["-c", a.script];
      }
      const pin = await WorkspacePin.capture(cwd);
      try {
        await this.roots.assertContainerTree(pin.scanPath);
        this.processes.set(id2, { context: c, cancel: (why) => this.container.cancel(id2, c, why) });
        await this.container.run({ id: id2, c, rootId: a.workspaceRef.rootId, workspace: pin.identity.path, workspaceIdentity: pin.mountIdentity, executable, argv, timeout, validate: () => this.store.validate(c), validateWorkspace: () => pin.verify(), shouldCancel: () => this.cancelRequested.has(id2), artifact: (data, context) => this.artifact(data, context, "text/plain") });
      } finally {
        this.processes.delete(id2);
        await pin.close();
      }
      return;
    }
    if (a.argv) {
      if (!Array.isArray(a.argv) || a.argv.length < 1 || a.argv.length > 256 || a.argv.some((x) => typeof x !== "string" || x.includes("\0"))) fail("INVALID_ARGUMENT");
      executable = this.config.executables?.[a.argv[0]];
      if (!executable) fail("EXECUTABLE_NOT_ALLOWED", 403);
      argv = a.argv.slice(1);
    } else {
      if (!this.config.shell || typeof a.script !== "string" || a.script.length > 1048576) fail("SCRIPT_NOT_ALLOWED", 403);
      executable = this.config.shell;
      argv = process.platform === "win32" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(a.script, "utf16le").toString("base64")] : ["-c", a.script];
    }
    this.store.validate(c);
    if (this.cancelRequested.has(id2)) {
      this.store.finish(id2, "cancelled", null, "CANCELLED");
      return;
    }
    if (process.platform === "win32" && !this.config.windowsJobRunner) fail("PROCESS_ISOLATION_UNAVAILABLE", 503);
    const child = spawn4(process.platform === "win32" ? this.config.windowsJobRunner : executable, process.platform === "win32" ? [] : argv, { cwd, windowsHide: true, detached: process.platform !== "win32", env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", TEMP: process.env.TEMP ?? "", TMP: process.env.TMP ?? "", LANG: "C.UTF-8" }, stdio: ["pipe", "pipe", "pipe"] });
    if (process.platform === "win32") child.stdin.end(JSON.stringify({ executable, args: argv, cwd }) + "\n");
    else child.stdin.end();
    child.stdin.on("error", () => {
    });
    let stdout = [], stderr = [], bytes = 0, truncated = false, reason = null, cancelPromise = null;
    const capture = (target) => (chunk) => {
      const remaining = 8 * 1024 * 1024 - bytes;
      if (remaining > 0) {
        target.push(chunk.subarray(0, remaining));
        bytes += Math.min(remaining, chunk.length);
      }
      if (chunk.length > remaining) truncated = true;
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    const cancel = (why) => {
      if (cancelPromise) return cancelPromise;
      reason = why;
      cancelPromise = (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (process.platform === "win32") {
          if (!child.kill("SIGKILL") && child.exitCode === null && child.signalCode === null) this.store.db.prepare("UPDATE operations SET status='cancel_pending',error='CANCEL_PENDING' WHERE id=?").run(id2);
        } else {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
          }
          await new Promise((r) => setTimeout(r, 200));
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
          }
        }
      })();
      return cancelPromise;
    };
    this.processes.set(id2, { child, context: c, cancel });
    const timer = setTimeout(() => void cancel("PROCESS_TIMEOUT"), timeout);
    try {
      const exit = await new Promise((resolve4, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve4({ exitCode: code, signal }));
      });
      await cancelPromise;
      const out = await this.artifact(Buffer.concat(stdout), c, "text/plain"), err = await this.artifact(Buffer.concat(stderr), c, "text/plain");
      this.store.finish(id2, reason === "CANCELLED" ? "cancelled" : reason ? "failed" : exit.exitCode === 0 ? "succeeded" : "failed", { ...exit, stdoutArtifactId: out.artifactId, stderrArtifactId: err.artifactId, truncated }, reason ?? (exit.exitCode === 0 ? null : "PROCESS_EXIT_NONZERO"));
    } finally {
      clearTimeout(timer);
      this.processes.delete(id2);
    }
  }
  async git(cwd, args) {
    return (await execFileAsync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, timeout: 6e4, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
  }
  async worktree(name, a, c) {
    if (this.container) fail("CONTAINER_TOOL_UNAVAILABLE", 503);
    if (name === "worktree_create") {
      const source = await this.roots.resolve(a.rootId, a.relativePath ?? "");
      await this.roots.assertPublicTree(source);
      if (await this.git(source, ["status", "--porcelain"])) fail("WORKSPACE_DIRTY", 409);
      const head = await this.git(source, ["rev-parse", "HEAD"]);
      const id2 = `worktree-${randomUUID7()}`, relative2 = a.worktreeRelativePath;
      if (typeof relative2 !== "string") fail("INVALID_ARGUMENT");
      const target = await this.roots.resolve(a.rootId, relative2, true);
      if (target === source || this.roots.inside(source, target)) fail("INVALID_WORKTREE_PATH");
      this.store.validate(c);
      await this.git(source, ["worktree", "add", "--detach", target, head]);
      this.store.db.prepare("INSERT INTO worktrees VALUES (?,?,?,?,?,?)").run(id2, canonical(c), a.rootId, target, head, source);
      return { worktreeId: id2, rootId: a.rootId, relativePath: relative2, sourceHead: head };
    }
    const row = this.store.db.prepare("SELECT * FROM worktrees WHERE id=?").get(a.worktreeId);
    if (!row) fail("WORKTREE_NOT_FOUND", 404);
    this.store.own(row.context, c);
    if (!c.roots.includes(row.root)) fail("SCOPE_DENIED", 403);
    const base = await realpath7(this.config.roots[row.root]);
    for (const p of [row.path, row.source]) {
      if (!this.roots.inside(base, await realpath7(p))) fail("WORKSPACE_OUTSIDE_SCOPE", 403);
      await this.roots.assertPublicTree(p);
    }
    const patch = await this.git(row.path, ["diff", "--binary", row.head]);
    if (name === "worktree_diff") return { sourceHead: row.head, ...await this.artifact(Buffer.from(patch + "\n"), c, "text/x-diff") };
    if (await this.git(row.path, ["rev-parse", "HEAD"]) !== row.head || await this.git(row.source, ["rev-parse", "HEAD"]) !== row.head || await this.git(row.source, ["status", "--porcelain"])) return { status: "integration-pending", reason: "SOURCE_CHANGED", worktreeId: a.worktreeId };
    const patchFile = join8(this.config.dataDir, `patch-${randomUUID7()}`);
    await writeFile5(patchFile, patch + "\n", { mode: 384 });
    try {
      if (!patch) return { status: "no-changes" };
      await this.git(row.source, ["apply", "--check", patchFile]);
      this.store.validate(c);
      await this.git(row.source, ["apply", patchFile]);
      return { status: "integrated", sourceHead: row.head, patchSha256: sha(patch) };
    } catch (e) {
      if (e instanceof AgentError) throw e;
      return { status: "integration-pending", reason: "PATCH_CONFLICT", worktreeId: a.worktreeId };
    } finally {
      await unlink5(patchFile);
    }
  }
  async close() {
    clearInterval(this.authTimer);
    const sessions = await this.desktopSessions.close();
    for (const id2 of this.jobs.keys()) this.cancelRequested.add(id2);
    await Promise.all([...this.processes.values(), ...this.desktopJobs.values()].map((p) => p.cancel("CANCELLED")));
    await this.container?.close();
    const desktop = await this.desktop.close();
    await Promise.all([...this.jobs.values()]);
    await this.browser.close();
    this.store.close();
    return { desktopStopConfirmed: desktop.stopConfirmed && sessions.stopConfirmed };
  }
};

// src/transport.ts
import http2 from "node:http";
import https from "node:https";
import { readFileSync as readFileSync3 } from "node:fs";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { Server, WebStandardStreamableHTTPServerTransport, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";

// src/auth-throttle.ts
var defaults = { windowMs: 6e4, failureThreshold: 5, baseBackoffMs: 1e3, maxBackoffMs: 3e4, maxSources: 1024, maxClients: 1024, globalFailureLimit: 128, clientRequestLimit: 120 };
function validateAuthLimits(input = {}) {
  const limits = { ...defaults, ...input };
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key2) => !Object.hasOwn(defaults, key2))) fail("INVALID_AUTH_LIMITS");
  const bounds = { windowMs: [100, 36e5], failureThreshold: [1, 100], baseBackoffMs: [10, 3e4], maxBackoffMs: [10, 3e4], maxSources: [1, 4096], maxClients: [1, 4096], globalFailureLimit: [1, 1e4], clientRequestLimit: [1, 1e4] };
  for (const key2 of Object.keys(bounds)) {
    const [min, max] = bounds[key2];
    if (!Number.isSafeInteger(limits[key2]) || limits[key2] < min || limits[key2] > max) fail("INVALID_AUTH_LIMITS");
  }
  if (limits.baseBackoffMs > limits.maxBackoffMs || limits.maxBackoffMs > limits.windowMs) fail("INVALID_AUTH_LIMITS");
  return Object.freeze(limits);
}
var AuthThrottle = class {
  constructor(options = {}, now = Date.now) {
    this.now = now;
    this.limits = validateAuthLimits(options);
  }
  now;
  sources = /* @__PURE__ */ new Map();
  clients = /* @__PURE__ */ new Map();
  global = { start: 0, failures: 0, limited: false };
  limits;
  save(map, key2, value, max) {
    map.delete(key2);
    map.set(key2, value);
    while (map.size > max) map.delete(map.keys().next().value);
  }
  failure(source) {
    const now = this.now(), p = this.limits;
    if (now - this.global.start >= p.windowMs || now < this.global.start) this.global = { start: now, failures: 0, limited: false };
    if (this.global.failures >= p.globalFailureLimit) {
      const audit = !this.global.limited;
      this.global.limited = true;
      return { status: 429, code: "AUTH_RATE_LIMIT", retryAfterMs: this.global.start + p.windowMs - now, audit };
    }
    let row = this.sources.get(source);
    if (row && now < row.start) row = void 0;
    if (row && row.until > now) return { status: 429, code: "AUTH_RATE_LIMIT", retryAfterMs: row.until - now, audit: false };
    if (!row || now - row.start >= p.windowMs || now < row.start) row = { start: now, failures: 0, until: 0 };
    this.global.failures++;
    row.failures++;
    if (row.failures >= p.failureThreshold) row.until = now + Math.min(p.maxBackoffMs, p.baseBackoffMs * 2 ** Math.min(16, row.failures - p.failureThreshold));
    this.save(this.sources, source, row, p.maxSources);
    return row.until > now ? { status: 429, code: "AUTH_RATE_LIMIT", retryAfterMs: row.until - now, audit: true } : { status: 401, code: "AUTH_INVALID", retryAfterMs: 0, audit: true };
  }
  // clientId and revision come only from Store.client/grant's checked rows.
  authenticated(clientId, revision) {
    const now = this.now(), p = this.limits;
    let row = this.clients.get(clientId);
    if (!row || row.revision !== revision || now - row.start >= p.windowMs || now < row.start) row = { start: now, requests: 0, revision, limited: false };
    if (row.requests >= p.clientRequestLimit) {
      const audit = !row.limited;
      row.limited = true;
      return { status: 429, code: "AUTH_RATE_LIMIT", retryAfterMs: row.start + p.windowMs - now, audit };
    }
    row.requests++;
    this.save(this.clients, clientId, row, p.maxClients);
    return null;
  }
  stats() {
    return { sources: this.sources.size, clients: this.clients.size, globalFailures: this.global.failures };
  }
};

// src/transport.ts
import { WebSocketServer as WebSocketServer2 } from "ws";

// src/e2e-server.ts
import http from "node:http";
import { duplexPair } from "node:stream";
import { WebSocketServer } from "ws";
function secureTransport(pairing, handler, upgrade) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 65535,
    perMessageDeflate: false,
    handleProtocols: (protocols) => protocols.has(DIRECT_PROTOCOL) ? DIRECT_PROTOCOL : false
  });
  const sessions = /* @__PURE__ */ new Set(), attempts = /* @__PURE__ */ new Map();
  let windowStart = 0, windowCount = 0, closing = false;
  const sweep = setInterval(() => {
    for (const session of sessions) if (session.peer && !pairing.validPeer(session.peer)) session.remove();
  }, 500);
  sweep.unref();
  return {
    accept(req, socket, head) {
      if (closing || sockets.clients.size >= 16) fail("E2E_CONNECTION_LIMIT", 429);
      if (req.headers.origin !== void 0 || req.headers["sec-websocket-protocol"] !== DIRECT_PROTOCOL) fail("E2E_CLIENT_REQUIRED", 403);
      const now = Date.now(), source = req.socket.remoteAddress ?? "unknown";
      if (now - windowStart >= 6e4 || now < windowStart) {
        windowStart = now;
        windowCount = 0;
      }
      const previous = attempts.get(source), row = previous && now - previous.start < 6e4 && now >= previous.start ? previous : { start: now, count: 0 };
      if (++row.count > 30 || ++windowCount > 120) fail("E2E_CONNECTION_RATE_LIMIT", 429);
      attempts.delete(source);
      attempts.set(source, row);
      while (attempts.size > 256) attempts.delete(attempts.keys().next().value);
      sockets.handleUpgrade(req, socket, head, (ws) => {
        sockets.emit("connection", ws, req);
        const streams = /* @__PURE__ */ new Set();
        let session;
        const origin = http.createServer((request, response) => {
          if (!session.peer || !pairing.validPeer(session.peer)) {
            response.writeHead(403);
            response.end();
            return;
          }
          handler(request, response, session.peer);
        });
        origin.requestTimeout = 3e4;
        origin.headersTimeout = 1e4;
        origin.on("upgrade", (request, connection, bytes) => {
          if (!session.peer || !pairing.validPeer(session.peer)) return connection.destroy();
          upgrade(request, connection, bytes, session.peer);
        });
        const transport = {
          send: (message) => {
            if (ws.readyState === 1) ws.send(message);
          },
          close: (code) => {
            if (ws.readyState < 2) ws.close(code === 1e3 || code >= 3e3 && code <= 4999 ? code : 1e3);
          },
          get bufferedAmount() {
            return ws.bufferedAmount;
          },
          onceDrained(listener) {
            const check = () => {
              if (ws.readyState !== 1 || ws.bufferedAmount <= SEND_BUFFER_HIGH / 4) listener();
              else {
                const timer = setTimeout(check, 5);
                timer.unref();
              }
            };
            check();
          }
        };
        session = E2ESession.computer({
          transport,
          transportByte: TRANSPORT_DIRECT,
          staticKey: pairing.transportKey,
          candidates: () => pairing.candidates(),
          async connectOrigin() {
            if (!session.peer || !pairing.validPeer(session.peer)) throw new Error("Peer removed");
            const [client, server] = duplexPair();
            Object.assign(server, { setTimeout() {
              return server;
            }, setNoDelay() {
              return server;
            }, setKeepAlive() {
              return server;
            }, remoteAddress: source });
            client.on("error", () => {
            });
            server.on("error", () => {
            });
            client.once("close", () => server.destroy());
            server.once("close", () => client.destroy());
            streams.add(server);
            server.once("close", () => streams.delete(server));
            origin.emit("connection", server);
            return client;
          }
        });
        sessions.add(session);
        ws.on("message", (data, binary) => {
          try {
            session.receive(Buffer.from(data), binary);
          } catch {
            session.close(4e3);
          }
        });
        ws.on("error", () => session.close(4e3));
        ws.once("close", (code) => session.transportClosed(code));
        void session.closed.then(() => {
          sessions.delete(session);
          for (const stream of streams) stream.destroy();
          origin.close();
        });
      });
    },
    async close() {
      closing = true;
      clearInterval(sweep);
      for (const session of sessions) session.shutdown();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise((resolve4) => sockets.close(() => resolve4()));
    }
  };
}

// src/transport.ts
var loopback = (host) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(host);
function validateNetwork(c) {
  const host = c.host ?? "127.0.0.1", mode = c.mode ?? "loopback";
  if (["0.0.0.0", "::", "localhost"].includes(host)) fail("BIND_ADDRESS_REQUIRED");
  if (!isIP(host) || c.port !== void 0 && (!Number.isSafeInteger(c.port) || c.port < 0 || c.port > 65535)) fail("INVALID_NETWORK_CONFIG");
  for (const key2 of ["allowedHosts", "allowedOrigins", "trustedProxies"]) if (c[key2] !== void 0 && (!Array.isArray(c[key2]) || c[key2].length > 128 || c[key2].some((value) => typeof value !== "string" || !value || value.length > 512 || /[\s\u0000-\u001f\u007f]/.test(value)))) fail("INVALID_NETWORK_CONFIG");
  if (c.trustedProxies?.some((value) => !isIP(value))) fail("INVALID_NETWORK_CONFIG");
  if (c.allowedOrigins?.some((value) => {
    try {
      const url = new URL(value);
      return !["http:", "https:"].includes(url.protocol) || url.origin !== value;
    } catch {
      return true;
    }
  })) fail("INVALID_NETWORK_CONFIG");
  if (c.allowedHosts?.some((value) => {
    try {
      const url = new URL(`http://${value}`);
      return url.host !== value.toLowerCase() || url.pathname !== "/" || !!url.username || !!url.password || !!url.search || !!url.hash;
    } catch {
      return true;
    }
  })) fail("INVALID_NETWORK_CONFIG");
  validateAuthLimits(c.authLimits);
  if (c.tls?.requireClientCertificate && !c.tls.caFile) fail("MTLS_CA_REQUIRED");
  if (mode === "loopback" && !loopback(host)) fail("TLS_REQUIRED");
  if (["wireguard", "tailscale"].includes(mode)) {
    if (!Object.values(networkInterfaces()).flat().some((x) => x?.address === host)) fail("BIND_INTERFACE_NOT_FOUND");
    if (!c.tls && !c.protectedTunnel) fail("TUNNEL_ATTESTATION_REQUIRED");
  }
  if (mode === "cloudflare-tunnel" && (!loopback(host) || !c.protectedTunnel)) fail("TUNNEL_BACKEND_MUST_BE_LOOPBACK");
  if (mode === "public-tls" && !c.tls && (!loopback(host) || !c.trustedProxies?.length)) fail("TLS_REQUIRED");
  if (!c.tls && !loopback(host) && !c.protectedTunnel && mode !== "e2e") fail("TLS_REQUIRED");
  if (!["loopback", "wireguard", "tailscale", "cloudflare-tunnel", "public-tls", "e2e"].includes(mode)) fail("INVALID_NETWORK_MODE");
}
async function serve(agent, c = {}) {
  c = structuredClone(c);
  validateNetwork(c);
  const throttle = new AuthThrottle(c.authLimits), host = c.host ?? "127.0.0.1";
  if (c.mode === "e2e" && !agent.store.pairing) fail("PAIRING_SERVICE_REQUIRED");
  const requestBoundary = (req, upgrade = false, encrypted2 = false) => {
    const address = server.address(), defaultHost = `${host.includes(":") ? `[${host}]` : host}:${address.port}`;
    if (!(c.allowedHosts ?? [defaultHost]).includes(req.headers.host ?? "")) fail("HOST_DENIED", 403);
    const origin = req.headers.origin;
    if (origin !== void 0 && !(c.allowedOrigins ?? []).includes(origin) && !(upgrade && agent.desktopSessions.hasOrigin(origin))) fail("ORIGIN_DENIED", 403);
    if (!encrypted2 && c.mode === "public-tls" && !c.tls && (!(c.trustedProxies ?? []).includes(req.socket.remoteAddress ?? "unknown") || req.headers["x-forwarded-proto"] !== "https")) fail("TLS_REQUIRED", 403);
    return defaultHost;
  };
  const handler = async (req, res, peer) => {
    let context;
    const source = req.socket.remoteAddress ?? "unknown";
    const json = (status, value) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(value));
    };
    try {
      const defaultHost = requestBoundary(req, false, !!peer);
      if (c.mode === "e2e" && !peer) fail("E2E_REQUIRED", 426);
      const url = new URL(req.url ?? "/", `http://${defaultHost}`);
      if (peer && !agent.store.pairing.validPeer(peer)) fail("AUTH_INVALID", 401);
      if (url.pathname === "/pair/v2/redeem") {
        if (!peer || peer.kind !== "invite" || req.method !== "POST" || url.search) fail("PAIRING_CHANNEL_REQUIRED", 403);
        let body2 = Buffer.alloc(0);
        for await (const chunk of req) {
          body2 = Buffer.concat([body2, chunk]);
          if (body2.length > 2048) fail("REQUEST_TOO_LARGE", 413);
        }
        let input;
        try {
          input = JSON.parse(body2.toString("utf8"));
        } catch {
          fail("INVALID_JSON");
        }
        json(200, agent.store.pairing.redeem(peer, input));
        return;
      }
      if (peer?.kind === "invite") fail("PAIRING_CHANNEL_ONLY", 403);
      const reject = (decision) => {
        if (decision.audit) agent.store.audit(decision.code);
        if (decision.retryAfterMs) res.setHeader("retry-after", String(Math.max(1, Math.ceil(decision.retryAfterMs / 1e3))));
        fail(decision.code, decision.status);
      };
      const auth = req.headers.authorization ?? "";
      if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) {
        reject(throttle.failure(source));
      }
      let client;
      const authenticate = () => {
        try {
          if (peer && !agent.store.pairing.validPeer(peer)) fail("AUTH_INVALID", 401);
          if (url.pathname.startsWith("/control/v1/")) client = agent.store.client(auth.slice(7));
          else context = agent.store.grant(auth.slice(7));
          if (peer && (client?.id ?? context?.clientId) !== peer.id) fail("AUTH_INVALID", 401);
        } catch {
          reject(throttle.failure(source));
        }
      };
      authenticate();
      const limited = throttle.authenticated(client?.id ?? context.clientId, client?.revision ?? context.revision);
      if (limited) reject(limited);
      if (req.method !== "POST") {
        json(405, { error: { code: "METHOD_NOT_ALLOWED" } });
        return;
      }
      let body = Buffer.alloc(0);
      for await (const chunk of req) {
        body = Buffer.concat([body, chunk]);
        if (body.length > 2097152) fail("REQUEST_TOO_LARGE", 413);
      }
      let parsed;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        fail("INVALID_JSON");
      }
      authenticate();
      if (url.pathname === "/control/v1/grants") {
        json(200, agent.store.issue(client, parsed));
        return;
      }
      if (url.pathname === "/control/v1/grants/revoke") {
        const result = agent.store.revokeGrants(client, parsed);
        await agent.desktopSessions.sweep();
        json(200, result);
        return;
      }
      if (url.pathname === "/control/v1/desktop/close") {
        json(200, await agent.desktopSessions.closeClientSession(client.id, parsed));
        return;
      }
      if (url.pathname === "/desktop/v1/session") {
        json(200, await agent.desktopSessions.open(context, parsed));
        return;
      }
      if (url.pathname === "/desktop/v1/session/renew") {
        json(200, await agent.desktopSessions.renew(context, parsed));
        return;
      }
      if (url.pathname === "/desktop/v1/session/close") {
        json(200, await agent.desktopSessions.closeSession(context, parsed));
        return;
      }
      if (url.pathname !== "/mcp") fail("NOT_FOUND", 404);
      const mcp = new Server({ name: "dsh-remote-computer-agent", version: AGENT_VERSION }, { capabilities: { tools: {} }, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS });
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, sessionIdGenerator: void 0, maxRequestBodySize: 2097152 });
      mcp.setRequestHandler("tools/list", async () => {
        agent.store.validate(context);
        return { tools: CATALOG.filter((x) => context.tools.includes(x.name)).map((x) => ({ name: x.name, description: `Remote ${x.name}`, inputSchema: x.inputSchema, annotations: { readOnlyHint: !x.mutating, destructiveHint: x.mutating } })) };
      });
      mcp.setRequestHandler("tools/call", async (request) => {
        try {
          const meta = request.params._meta ?? {}, args = request.params.arguments ?? {};
          if (Object.hasOwn(args, "operationId") && request.params.name !== "operation_status" && request.params.name !== "operation_cancel") fail("CONTEXT_MUST_BE_HOST_METADATA");
          const result = await agent.call(request.params.name, args, context, meta["dsh/operationId"]);
          agent.store.audit("TOOL_RESULT", context.botId, meta["dsh/operationId"] ?? null);
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (e) {
          const code = e instanceof AgentError ? e.code : "EXECUTION_FAILED";
          agent.store.audit(code, context.botId);
          return { isError: true, content: [{ type: "text", text: code }] };
        }
      });
      await mcp.connect(transport);
      try {
        const response = await transport.handleRequest(new Request(`http://${defaultHost}/mcp`, { method: "POST", headers: req.headers, body: body.toString("utf8") }), { parsedBody: parsed });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } finally {
        await mcp.close();
      }
    } catch (e) {
      json(e instanceof AgentError ? e.status : 500, { error: { code: e instanceof AgentError ? e.code : "AGENT_INTERNAL" } });
    }
  };
  const tls = c.tls ? { key: readFileSync3(c.tls.keyFile), cert: readFileSync3(c.tls.certFile), ca: c.tls.caFile ? readFileSync3(c.tls.caFile) : void 0, requestCert: !!c.tls.requireClientCertificate, rejectUnauthorized: !!c.tls.requireClientCertificate } : null;
  const publicHandler = (req, res) => void handler(req, res);
  const server = tls ? https.createServer(tls, publicHandler) : http2.createServer(publicHandler);
  server.requestTimeout = 3e4;
  server.headersTimeout = 1e4;
  server.maxConnections = 128;
  const websocket = new WebSocketServer2({ noServer: true, clientTracking: true, maxPayload: 65536, perMessageDeflate: false });
  const desktopUpgrade = (req, socket, head, peer) => {
    try {
      const defaultHost = requestBoundary(req, true, !!peer), url = new URL(req.url ?? "/", `http://${defaultHost}`);
      if (c.mode === "e2e" && !peer) fail("E2E_REQUIRED", 426);
      if (peer && (peer.kind !== "client" || !agent.store.pairing.validPeer(peer))) fail("AUTH_INVALID", 401);
      if (url.pathname !== "/desktop/v1/socket" || url.search) fail("NOT_FOUND", 404);
      if (websocket.clients.size >= 16) fail("DESKTOP_CONNECTION_LIMIT", 429);
      websocket.handleUpgrade(req, socket, head, (ws) => {
        websocket.emit("connection", ws, req);
        agent.desktopSessions.accept(ws, req.headers.origin, c.allowedOrigins ?? [], peer?.id);
      });
    } catch (e) {
      const status = e instanceof AgentError ? e.status : 500;
      socket.end(`HTTP/1.1 ${status} Rejected\r
Connection: close\r
Content-Length: 0\r
\r
`);
    }
  };
  const encrypted = agent.store.pairing ? secureTransport(agent.store.pairing, (req, res, peer) => void handler(req, res, peer), desktopUpgrade) : null;
  server.on("upgrade", (req, socket, head) => {
    try {
      const defaultHost = requestBoundary(req, true), url = new URL(req.url ?? "/", `http://${defaultHost}`);
      if (url.pathname === "/v1/e2e" && !url.search) {
        if (!encrypted) fail("NOT_FOUND", 404);
        encrypted.accept(req, socket, head);
        return;
      }
      desktopUpgrade(req, socket, head);
    } catch (e) {
      const status = e instanceof AgentError ? e.status : 500;
      socket.end(`HTTP/1.1 ${status} Rejected\r
Connection: close\r
Content-Length: 0\r
\r
`);
    }
  });
  try {
    await new Promise((resolve4, reject) => {
      server.once("error", reject);
      server.listen(c.port ?? 9701, host, () => resolve4());
    });
  } catch (error2) {
    await encrypted?.close();
    throw error2;
  }
  return { server, address: server.address(), supportedMcpVersions: SUPPORTED_PROTOCOL_VERSIONS, close: async () => {
    await agent.desktopSessions.close();
    for (const client of websocket.clients) client.terminate();
    await new Promise((resolve4) => websocket.close(() => resolve4()));
    await encrypted?.close();
    await new Promise((resolve4, reject) => server.close((e) => e ? reject(e) : resolve4()));
  } };
}

// src/client.ts
var RemoteAgentClient = class {
  constructor(endpoint, expectedMachineId, secretResolver, protectedTunnel = false) {
    this.endpoint = endpoint;
    this.expectedMachineId = expectedMachineId;
    this.secretResolver = secretResolver;
    this.protectedTunnel = protectedTunnel;
    const u = new URL(endpoint);
    if (u.username || u.password || u.search || u.hash || !["http:", "https:"].includes(u.protocol)) fail("INVALID_ENDPOINT");
    if (u.protocol === "http:" && !["127.0.0.1", "[::1]", "localhost"].includes(u.hostname) && !protectedTunnel) fail("TLS_REQUIRED");
  }
  endpoint;
  expectedMachineId;
  secretResolver;
  protectedTunnel;
  async request(path4, token, body) {
    const response = await fetch(new URL(path4, this.endpoint), { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify(body), signal: AbortSignal.timeout(35e3) });
    if (!response.ok) fail((await response.json()).error?.code ?? "AGENT_CONNECTION_FAILED", response.status);
    return response.json();
  }
  async grant(request) {
    const result = await this.request("/control/v1/grants", await this.secretResolver(), request);
    if (result.machineId !== this.expectedMachineId || result.agentApiMajor !== 1) fail("AGENT_VERSION_UNSUPPORTED");
    return result;
  }
  async desktopSession(grantToken, request) {
    return this.request("/desktop/v1/session", grantToken, request);
  }
  async renewDesktopSession(grantToken, request) {
    return this.request("/desktop/v1/session/renew", grantToken, request);
  }
  async closeDesktopSession(grantToken, request) {
    return this.request("/desktop/v1/session/close", grantToken, request);
  }
  async call(grantToken, name, args, operationId) {
    const result = await this.request("/mcp", grantToken, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: { "dsh/operationId": operationId } } });
    if (result.error) fail("MCP_REQUEST_FAILED");
    if (result.result?.isError) fail(result.result.content?.[0]?.text ?? "EXECUTION_FAILED");
    return result.result.structuredContent ?? JSON.parse(result.result.content[0].text);
  }
};
export {
  AGENT_API_MAJOR,
  AGENT_VERSION,
  Agent,
  AgentError,
  AuthThrottle,
  CATALOG,
  CONTAINER_IMAGE,
  ContainerCommands,
  DesktopSessions,
  NativeDesktopPipe,
  ROOTS_GENERATION_META_KEY,
  ROOT_WRITING_TOOLS,
  RemoteAgentClient,
  Roots,
  Store,
  TOOL_NAMES,
  WorkspaceAdmissions,
  WorkspacePin,
  canonical,
  containerArguments,
  fail,
  identifier,
  integer,
  isMutating,
  matches,
  reconcileRootsGeneration,
  rootLockDegrades,
  rootsGeneration,
  secret,
  serve,
  sha,
  validateAuthLimits,
  validateContainerCommandConfig,
  validateNetwork
};
//# sourceMappingURL=index.mjs.map
