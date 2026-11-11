// ../packages/capability-broker/src/cli-stdio-bridge.mjs
import { createPublicKey, verify } from "node:crypto";
import { readFile as readFile2 } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";

// ../packages/cli-runtime/src/native-process.mjs
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { access, lstat, readFile, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// ../packages/cli-runtime/src/native-cli-output.mjs
import { createHash } from "node:crypto";
var FRAME = 262144;
var RAW_FRAME = 18 * 1024 * 1024;
var IMAGE = 6 * 1024 * 1024;
var fail = () => {
  throw new Error("CLI_FRAME_LIMIT");
};
function receipt(frame, rawBytes) {
  const results = frame?.type === "user" && frame.message?.content;
  const toolResult = Array.isArray(results) && results.length > 0 && results.every((block) => block?.type === "tool_result" && typeof block.tool_use_id === "string");
  if (!toolResult) {
    if (rawBytes > FRAME) fail();
    return frame;
  }
  let imageBytes = 0, images = 0, nodes = 0;
  const visit = (value, depth = 0) => {
    if (++nodes > 3e4 || depth > 24) fail();
    if (!value || typeof value !== "object") return value;
    if (value.type === "image") {
      const source = value.source;
      const data = source?.type === "base64" ? source.data : value.data;
      const mediaType = source?.type === "base64" ? source.media_type : value.mimeType;
      if (typeof data !== "string" || data.length > IMAGE / 3 * 4 || !["image/png", "image/jpeg", "image/webp"].includes(mediaType)) fail();
      const bytes = Buffer.from(data, "base64");
      if (!bytes.length || bytes.length > IMAGE || bytes.toString("base64") !== data || ++images > 32 || (imageBytes += bytes.length) > IMAGE * 2) fail();
      return { type: "image", mediaType, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, depth + 1)]));
  };
  const result = visit(frame);
  if (rawBytes > FRAME && !images || Buffer.byteLength(JSON.stringify(result)) > FRAME) fail();
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
      if (rawBytes > RAW_FRAME) fail();
      if (!line.trim()) continue;
      const frame = receipt(JSON.parse(line), rawBytes);
      this.#bytes += Buffer.byteLength(JSON.stringify(frame));
      if (this.#bytes > 8 * 1024 * 1024) fail();
      frames.push(frame);
    }
    if (Buffer.byteLength(this.#buffer) > RAW_FRAME) fail();
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
var rootStamp = (path) => `dsh-native-compiler-v1:${basename(path)}
`;
function compilerDirectory() {
  try {
    if (!compilerRoot) {
      if (inheritedCompilerRoot !== void 0) {
        if (!isAbsolute(inheritedCompilerRoot) || inheritedCompilerRoot.length > 140 || !/^dshc-[a-f0-9]{16}$/.test(basename(inheritedCompilerRoot))) throw compilerFailure();
        const info2 = lstatSync(inheritedCompilerRoot, { bigint: true });
        if (!info2.isDirectory() || info2.isSymbolicLink() || realpathSync(inheritedCompilerRoot) !== inheritedCompilerRoot || readFileSync(join(inheritedCompilerRoot, ".dsh-root"), "utf8") !== rootStamp(inheritedCompilerRoot)) throw compilerFailure();
        compilerRoot = { path: inheritedCompilerRoot, info: info2 };
      } else {
        const parent = realpathSync(hostTemp);
        const path2 = join(parent, `dshc-${randomBytes(8).toString("hex")}`);
        if (path2.length > 140) throw compilerFailure();
        mkdirSync(path2);
        writeFileSync(join(path2, ".dsh-root"), rootStamp(path2), { flag: "wx" });
        compilerRoot = { path: path2, info: lstatSync(path2, { bigint: true }) };
      }
    }
    if (!sameDirectory(lstatSync(compilerRoot.path, { bigint: true }), compilerRoot.info) || realpathSync(compilerRoot.path) !== compilerRoot.path) throw compilerFailure();
    const path = mkdtempSync(join(compilerRoot.path, "c-"));
    const info = lstatSync(path, { bigint: true }), owner = randomBytes(16).toString("hex");
    writeFileSync(join(path, ".dsh-owner"), owner, { flag: "wx" });
    const root = compilerRoot;
    const cleanup = async () => {
      try {
        if (dirname(path) !== root.path || !/^c-[A-Za-z0-9]{6}$/.test(basename(path))) return false;
        if (!sameDirectory(await lstat(root.path, { bigint: true }), root.info) || await realpath(root.path) !== root.path) return false;
        if (!sameDirectory(await lstat(path, { bigint: true }), info) || await realpath(path) !== path || await readFile(join(path, ".dsh-owner"), "utf8") !== owner) return false;
        const names = await readdir(path);
        if (names.length > 128) return false;
        for (const name of names) {
          const entry = await lstat(join(path, name));
          if (!entry.isFile() || entry.isSymbolicLink()) return false;
        }
        for (const name of names) await unlink(join(path, name));
        await rmdir(path);
        return true;
      } catch {
        return false;
      }
    };
    return { root: root.path, path, cleanup };
  } catch {
    throw compilerFailure();
  }
}
function privateEnvironment(home, source = process.env) {
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "appdata"),
    LOCALAPPDATA: join(home, "local"),
    CODEX_HOME: home,
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    TEMP: join(home, "tmp"),
    TMP: join(home, "tmp"),
    TMPDIR: join(home, "tmp"),
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1"
  };
  for (const key of ["SystemRoot", "windir", "ComSpec", "LANG", "LC_ALL"]) if (source[key]) env[key] = source[key];
  env.PATH = process.platform === "win32" ? join(source.SystemRoot ?? "C:\\Windows", "System32") : "/usr/bin:/bin";
  if (process.platform === "win32" && (compilerRoot?.path ?? inheritedCompilerRoot)) env[COMPILER_ROOT] = compilerRoot?.path ?? inheritedCompilerRoot;
  return env;
}
function nativeProcess(helper, mode, spec, { home, env = privateEnvironment(home) } = {}) {
  const events = new EventEmitter();
  const args = helper.platform === "win32" ? [...helper.prefix, "-Mode", mode] : [...helper.prefix, mode];
  const compiler = helper.platform === "win32" ? compilerDirectory() : null;
  const helperEnv = compiler ? Object.fromEntries(Object.entries(env).filter(([key]) => ![COMPILER_ROOT, COMPILER_SCRATCH].includes(key.toUpperCase()))) : env;
  if (compiler) {
    helperEnv[COMPILER_ROOT] = compiler.root;
    helperEnv[COMPILER_SCRATCH] = compiler.path;
  }
  const child = spawn(helper.executable, args, { cwd: home, env: helperEnv, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let tail = "", buffer = "", bytes = 0, closed = false, treeStopped = false;
  const decoder = new StringDecoder("utf8"), cliDecoder = new StringDecoder("utf8");
  const cliOutput = new NativeCliOutput();
  const frame = (value) => {
    if (mode === "supervise" && value.control === "stopped" && value.treeStopped === true) treeStopped = true;
    if (mode === "supervise" && value.type === "cli-output") {
      if (typeof value.data !== "string" || value.data.length > MAX_FRAME * 2) throw new Error("INVALID_CLI_FRAME");
      for (const message of cliOutput.push(cliDecoder.write(Buffer.from(value.data, "base64")))) events.emit("message", message);
    } else events.emit(value.control ? "control" : "message", value);
  };
  const exit = new Promise((resolve) => child.once("close", async (code, signal) => {
    closed = true;
    if (compiler && code === 0 && signal === null && (mode !== "supervise" || treeStopped)) await compiler.cleanup();
    events.emit("closed", { code, signal });
    resolve({ code, signal });
  }));
  child.on("error", (error) => events.emit("failure", error));
  child.stdin.on("error", () => {
  });
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
  const send = (value) => new Promise((resolve, reject) => {
    const wire = JSON.stringify(value) + "\n";
    if (closed || Buffer.byteLength(wire) > MAX_FRAME) {
      reject(new Error(closed ? "NATIVE_CLOSED" : "INPUT_LIMIT"));
      return;
    }
    child.stdin.write(wire, (error) => error ? reject(error) : resolve());
  });
  if (spec) void send(spec).catch((error) => events.emit("failure", error));
  function waitControl(name, timeoutMs = 15e3) {
    return new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        events.off("control", control);
        events.off("closed", ended);
        events.off("failure", failed);
      };
      const control = (value) => {
        if (value.control === name) {
          clean();
          resolve(value);
        }
      };
      const ended = () => {
        clean();
        reject(new Error(`NATIVE_${name.toUpperCase()}_FAILED: ${tail.slice(-256)}`));
      };
      const failed = (error) => {
        clean();
        reject(error);
      };
      const timer = setTimeout(() => {
        clean();
        reject(new Error(`NATIVE_${name.toUpperCase()}_TIMEOUT`));
      }, timeoutMs);
      events.on("control", control);
      events.once("closed", ended);
      events.once("failure", failed);
      if (closed) ended();
    });
  }
  return Object.freeze({ child, events, exit, send, waitControl, end: () => child.stdin.end(), get stderr() {
    return tail;
  }, get closed() {
    return closed;
  } });
}

// ../packages/capability-broker/src/cli-stdio-bridge.mjs
import { dirname as dirname2, isAbsolute as isAbsolute2 } from "node:path";

// ../packages/capability-broker/src/cli-bridge-response.mjs
import { createHash as createHash2 } from "node:crypto";
var CHUNK_BYTES = 128 * 1024;
var MAX_RESPONSE = 9 * 1024 * 1024;
var MAX_BUFFERED = 16 * 1024 * 1024;
var fail2 = () => {
  throw new Error("INVALID_BRIDGE_RESPONSE");
};
var sha = (bytes) => createHash2("sha256").update(bytes).digest("hex");
var BridgeResponseReader = class {
  #parts = /* @__PURE__ */ new Map();
  #buffered = 0;
  drop(id) {
    const state = this.#parts.get(id);
    if (state) this.#buffered -= state.size;
    this.#parts.delete(id);
  }
  clear() {
    this.#parts.clear();
    this.#buffered = 0;
  }
  accept(frame) {
    if (!Number.isSafeInteger(frame?.id) || frame.id < 1) fail2();
    if (frame.type === "response") {
      this.drop(frame.id);
      return frame;
    }
    if (frame.type === "response-start") {
      if (this.#parts.has(frame.id) || this.#parts.size >= 16 || !Number.isSafeInteger(frame.bytes) || frame.bytes <= CHUNK_BYTES || frame.bytes > MAX_RESPONSE) fail2();
      this.#parts.set(frame.id, { expected: frame.bytes, size: 0, chunks: [] });
      return null;
    }
    const state = this.#parts.get(frame.id);
    if (!state) fail2();
    if (frame.type === "response-chunk") {
      if (frame.index !== state.chunks.length || typeof frame.data !== "string" || frame.data.length > Math.ceil(CHUNK_BYTES / 3) * 4) fail2();
      const bytes2 = Buffer.from(frame.data, "base64");
      if (!bytes2.length || bytes2.length > CHUNK_BYTES || bytes2.toString("base64") !== frame.data || state.size + bytes2.length > state.expected || this.#buffered + bytes2.length > MAX_BUFFERED) fail2();
      state.chunks.push(bytes2);
      state.size += bytes2.length;
      this.#buffered += bytes2.length;
      return null;
    }
    if (frame.type !== "response-end" || state.size !== state.expected) fail2();
    const bytes = Buffer.concat(state.chunks);
    this.drop(frame.id);
    if (frame.sha256 !== sha(bytes)) fail2();
    const value = JSON.parse(bytes.toString("utf8"));
    if (value.type !== "response" || value.id !== frame.id) fail2();
    return value;
  }
};

// ../packages/capability-broker/src/cli-stdio-bridge.mjs
var relay;
var handle;
var pending = /* @__PURE__ */ new Map();
var responses = new BridgeResponseReader();
var sequence = 0;
var finish = () => {
  for (const value of pending.values()) value.reject(new Error("BROKER_CLOSED"));
  pending.clear();
  responses.clear();
  relay?.end();
};
try {
  const [path, publicSpki] = process.argv.slice(2);
  if (process.argv.length !== 4 || !isAbsolute2(path) || !/^[A-Za-z0-9_-]{40,256}$/.test(publicSpki)) throw new Error("PRIVATE_BOOTSTRAP_REQUIRED");
  let descriptor;
  const deadline = Date.now() + 15e3;
  while (!descriptor && Date.now() < deadline) {
    try {
      const wire = await readFile2(path);
      if (wire.length > 32768) throw new Error("DESCRIPTOR_LIMIT");
      descriptor = JSON.parse(wire);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await delay(50);
    }
  }
  if (!descriptor || typeof descriptor.payload !== "string" || typeof descriptor.signature !== "string") throw new Error("INVALID_BOOTSTRAP");
  const key = createPublicKey({ key: Buffer.from(publicSpki, "base64url"), format: "der", type: "spki" });
  if (!verify(null, Buffer.from(descriptor.payload), key, Buffer.from(descriptor.signature, "base64url"))) throw new Error("BOOTSTRAP_SIGNATURE");
  const spec = JSON.parse(descriptor.payload);
  const handoffRemaining = Math.floor(spec.expiresAt - Date.now());
  const remaining = Math.floor(spec.sessionExpiresAt - Date.now());
  if (spec.version !== 1 || handoffRemaining < 1 || handoffRemaining > 15e3 || remaining < 1 || remaining > 72e5) throw new Error("BOOTSTRAP_EXPIRED");
  relay = nativeProcess(
    spec.helper,
    "client",
    { endpoint: spec.endpoint, serverPid: spec.serverPid, serverStart: spec.serverStart, ttlMs: remaining },
    { home: dirname2(path), env: privateEnvironment(dirname2(path)) }
  );
  const ask = (op, payload, signal) => new Promise((resolve, reject) => {
    if (relay.closed || pending.size >= 16) {
      reject(new Error("BROKER_UNAVAILABLE"));
      return;
    }
    const id = ++sequence;
    const abort = () => {
      const value = pending.get(id);
      pending.delete(id);
      responses.drop(id);
      void relay.send({ type: "cancel", id }).catch(() => {
      });
      value?.reject(new Error("REQUEST_CANCELLED"));
    };
    if (signal?.aborted) {
      reject(new Error("REQUEST_CANCELLED"));
      return;
    }
    const timer2 = setTimeout(abort, Math.min(remaining, 3e4));
    signal?.addEventListener("abort", abort, { once: true });
    const settle = (fn) => (value) => {
      clearTimeout(timer2);
      signal?.removeEventListener("abort", abort);
      fn(value);
    };
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
    void relay.send({ type: "request", id, op, ...payload }).catch(() => {
      const value = pending.get(id);
      pending.delete(id);
      responses.drop(id);
      value?.reject(new Error("BROKER_CLOSED"));
    });
  });
  relay.events.on("message", (message) => {
    if (!Number.isSafeInteger(message?.id) || !pending.has(message.id)) return;
    try {
      const response = responses.accept(message);
      if (!response) return;
      const value = pending.get(response.id);
      pending.delete(response.id);
      if (response.ok) value?.resolve(response);
      else value?.reject(new Error(response.code ?? "BROKER_REFUSED"));
    } catch {
      const value = pending.get(message.id);
      pending.delete(message.id);
      responses.drop(message.id);
      value?.reject(new Error("INVALID_BRIDGE_RESPONSE"));
    }
  });
  relay.events.on("failure", () => {
    finish();
    void handle?.close();
  });
  relay.events.once("closed", () => {
    finish();
    void handle?.close();
  });
  handle = serveStdio(() => {
    const server = new Server({ name: "dsh-task-capability-bridge", version: "0.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler("tools/list", async (_request, ctx) => ({ tools: (await ask("list", {}, ctx.mcpReq.signal)).value }));
    server.setRequestHandler("tools/call", async (request, ctx) => {
      try {
        const response = await ask("call", { name: request.params.name, args: request.params.arguments ?? {} }, ctx.mcpReq.signal);
        return response.mcpResult ?? { content: [{ type: "text", text: JSON.stringify(response.value) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
    });
    server.onclose = finish;
    return server;
  }, { transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 262144 }) });
  const timer = setTimeout(() => {
    finish();
    void handle.close();
  }, remaining);
  timer.unref();
  process.stdin.once("end", () => {
    clearTimeout(timer);
    finish();
    void handle.close();
  });
} catch (error) {
  process.stderr.write(`Private broker bootstrap refused: ${error.message}
`);
  finish();
  process.exitCode = 2;
}
//# sourceMappingURL=cli-stdio-bridge.mjs.map
