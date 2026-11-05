// ../packages/capability-broker/src/cli-stdio-bridge.mjs
import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";

// ../packages/cli-runtime/src/native-process.mjs
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
var HERE = fileURLToPath(new URL(".", import.meta.url));
var MAX_FRAME = 262144;
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
  return env;
}
function nativeProcess(helper, mode, spec, { home, env = privateEnvironment(home) } = {}) {
  const events = new EventEmitter();
  const args = helper.platform === "win32" ? [...helper.prefix, "-Mode", mode] : [...helper.prefix, mode];
  const child = spawn(helper.executable, args, { cwd: home, env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let tail = "", buffer = "", bytes = 0, closed = false;
  const decoder = new StringDecoder("utf8"), cliDecoder = new StringDecoder("utf8");
  let cliBuffer = "";
  const frame = (value) => {
    if (mode === "supervise" && value.type === "cli-output") {
      if (typeof value.data !== "string" || value.data.length > MAX_FRAME * 2) throw new Error("INVALID_CLI_FRAME");
      cliBuffer += cliDecoder.write(Buffer.from(value.data, "base64"));
      if (Buffer.byteLength(cliBuffer) > MAX_FRAME) throw new Error("CLI_FRAME_LIMIT");
      let end;
      while ((end = cliBuffer.indexOf("\n")) >= 0) {
        const line = cliBuffer.slice(0, end);
        cliBuffer = cliBuffer.slice(end + 1);
        if (line.trim()) events.emit("message", JSON.parse(line));
      }
    } else events.emit(value.control ? "control" : "message", value);
  };
  const exit = new Promise((resolve) => child.once("close", (code, signal) => {
    closed = true;
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
    if (bytes > 8 * 1024 * 1024 || Buffer.byteLength(buffer) > MAX_FRAME) {
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
import { dirname, isAbsolute as isAbsolute2 } from "node:path";
var relay;
var handle;
var pending = /* @__PURE__ */ new Map();
var sequence = 0;
var finish = () => {
  for (const value of pending.values()) value.reject(new Error("BROKER_CLOSED"));
  pending.clear();
  relay?.end();
};
try {
  const [path, publicSpki] = process.argv.slice(2);
  if (process.argv.length !== 4 || !isAbsolute2(path) || !/^[A-Za-z0-9_-]{40,256}$/.test(publicSpki)) throw new Error("PRIVATE_BOOTSTRAP_REQUIRED");
  let descriptor;
  const deadline = Date.now() + 15e3;
  while (!descriptor && Date.now() < deadline) {
    try {
      const wire = await readFile(path);
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
    { home: dirname(path), env: privateEnvironment(dirname(path)) }
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
      value?.reject(new Error("BROKER_CLOSED"));
    });
  });
  relay.events.on("message", (message) => {
    if (message?.type !== "response" || !Number.isSafeInteger(message.id)) return;
    const value = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) value?.resolve(message.value);
    else value?.reject(new Error(message.code ?? "BROKER_REFUSED"));
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
    server.setRequestHandler("tools/list", async (_request, ctx) => ({ tools: await ask("list", {}, ctx.mcpReq.signal) }));
    server.setRequestHandler("tools/call", async (request, ctx) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await ask("call", { name: request.params.name, args: request.params.arguments ?? {} }, ctx.mcpReq.signal)) }] };
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
