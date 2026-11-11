// Pure JSON-RPC 2.0 codec for the ACP (Agent Client Protocol) stdio wire.
//
// Ported and re-grounded from OpenMausBot server/drivers/acp/host.ts and
// rpc-error.ts at pin 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0);
// see licenses/NOTICE.md. Everything here is pure: no child process, no clock,
// no policy. Bounds are explicit so a hostile or broken peer cannot grow an
// unbounded buffer, and a message that does not match the documented shape is
// counted as malformed instead of being guessed at.

import { StringDecoder } from 'node:string_decoder'

export const JSONRPC_VERSION = '2.0'

/** Default bounds. Every one is a hard limit; none of them are advisory. */
export const DEFAULT_MAX_FRAME_BYTES = 262_144
export const DEFAULT_MAX_PENDING = 64
export const DEFAULT_MAX_BACKLOG_BYTES = 1_048_576
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000
export const DEFAULT_IDLE_TIMEOUT_MS = 180_000
export const MAX_ERROR_TEXT = 1500
export const MAX_LOG_PREVIEW = 512

/** Fixed JSON-RPC error codes. Vendor codes are never remapped onto these. */
export const RPC_PARSE_ERROR = -32700
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603

/** ACP wire constants, taken from the upstream driver at the recorded pin. */
export const ACP_PROTOCOL_VERSION = 1
export const ACP_METHODS = Object.freeze({
  initialize: 'initialize',
  authenticate: 'authenticate',
  sessionNew: 'session/new',
  sessionLoad: 'session/load',
  sessionPrompt: 'session/prompt',
  sessionCancel: 'session/cancel',
  sessionUpdate: 'session/update',
  sessionClose: 'session/close',
  sessionRequestPermission: 'session/request_permission',
  sessionSetModel: 'session/set_model',
  sessionSetConfigOption: 'session/set_config_option',
  sessionSetMode: 'session/set_mode',
  fsReadTextFile: 'fs/read_text_file',
  fsWriteTextFile: 'fs/write_text_file',
})

/** Client methods this adapter refuses for every session, in every version. */
export const CLIENT_FILE_METHODS = Object.freeze([ACP_METHODS.fsReadTextFile, ACP_METHODS.fsWriteTextFile])
export const TERMINAL_METHOD_PREFIX = 'terminal/'

/** A JSON-RPC id is a string or an integer. Floats, booleans and null are not ids. */
export function isValidMessageId(value) {
  if (typeof value === 'string') return value.length > 0 && value.length <= 128
  return Number.isInteger(value)
}

const bounded = value => (value.length > MAX_ERROR_TEXT ? `${value.slice(0, MAX_ERROR_TEXT - 1)}…` : value)

/**
 * A wire error to Error. Vendors put the actionable cause under `data`; only
 * known text fields surface, bounded, never a whole response body.
 */
export function errorFromWire(value, method) {
  const error = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const message = typeof error.message === 'string' && error.message ? error.message : 'ACP request failed'
  const data = error.data
  const detail = typeof data === 'string' && data
    ? data
    : typeof data?.details === 'string' && data.details
      ? data.details
      : typeof data?.message === 'string' && data.message
        ? data.message
        : typeof data?.error?.message === 'string' && data.error.message
          ? data.error.message
          : ''
  const context = [
    typeof method === 'string' && method ? method : '',
    typeof data?.service === 'string' && data.service ? `service: ${data.service}` : '',
    typeof data?.errorName === 'string' && data.errorName ? data.errorName : '',
  ].filter(Boolean).join(', ')
  const diagnostic = `${detail && detail !== message ? `${message}: ${detail}` : message}${context ? ` (${context})` : ''}`
  const failure = new Error(bounded(diagnostic))
  return Object.assign(failure, {
    rpcCode: typeof error.code === 'number' ? error.code : null,
    rpcData: data,
    // -32603 is JSON-RPC's internal error; invalid params, unknown methods and
    // auth refusals keep the session usable.
    acpSessionFailure: error.code === RPC_INTERNAL_ERROR,
  })
}

export function rpcErrorObject(code, message, data) {
  const error = { code, message: typeof message === 'string' ? message : 'error' }
  if (data !== undefined) error.data = data
  return error
}

/**
 * Newline-delimited JSON framing with a hard frame cap. A multi-byte character
 * split across reads is decoded as one unit; a frame over the cap is dropped as
 * a whole and reported once, never parsed in pieces.
 */
export function createFrameDecoder({ maxFrameBytes = DEFAULT_MAX_FRAME_BYTES, onFrame, onError } = {}) {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1024) throw new TypeError('ACP_FRAME_LIMIT_INVALID')
  if (typeof onFrame !== 'function') throw new TypeError('ACP_FRAME_SINK_REQUIRED')
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  let dropping = false
  let frames = 0, malformed = 0, oversize = 0, bytes = 0, blank = 0
  const reportOversize = () => {
    oversize++
    if (typeof onError === 'function') onError(Object.assign(new Error('ACP_FRAME_LIMIT'), { acpFrameLimit: true }))
  }
  return Object.freeze({
    write(chunk) {
      let text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
      if (!text) return
      bytes += Buffer.byteLength(text)
      if (dropping) {
        // An oversized frame is dropped whole: discard through its terminator.
        const end = text.indexOf('\n')
        if (end === -1) return
        text = text.slice(end + 1)
        dropping = false
        reportOversize()
      }
      buffer += text
      if (Buffer.byteLength(buffer) > maxFrameBytes) {
        const end = buffer.indexOf('\n')
        if (end === -1) { dropping = true; buffer = ''; reportOversize(); return }
        buffer = buffer.slice(end + 1)
        reportOversize()
      }
      let end
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, '')
        buffer = buffer.slice(end + 1)
        if (!line.trim()) { blank++; continue }
        if (Buffer.byteLength(line) > maxFrameBytes) { reportOversize(); continue }
        frames++
        onFrame(line)
      }
    },
    /** Feed the decoder's trailing bytes and treat a final unterminated frame as nothing said. */
    end() {
      const tail = decoder.end()
      if (tail) this.write(tail)
      buffer = ''
      dropping = false
    },
    get stats() {
      return Object.freeze({ frames, malformed, oversize, blank, bytes, pendingBytes: Buffer.byteLength(buffer) })
    },
  })
}

/**
 * Parse one frame. Returns null for anything that is not a single JSON-RPC
 * object: batches, arrays, scalars and parse failures are all malformed.
 */
export function parseFrame(line) {
  if (typeof line !== 'string' || !line.trim()) return null
  let value
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

/**
 * Classify a parsed message. A response carries an id and neither method; a
 * server request carries both; a notification carries a method and no id.
 * Anything else is `invalid` and must be counted, not acted on.
 */
export function classifyMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { kind: 'invalid', reason: 'not-an-object' }
  if (message.jsonrpc !== undefined && message.jsonrpc !== JSONRPC_VERSION) return { kind: 'invalid', reason: 'bad-jsonrpc' }
  const hasId = Object.hasOwn(message, 'id') && message.id !== null && message.id !== undefined
  const hasMethod = Object.hasOwn(message, 'method') && typeof message.method === 'string' && message.method
  if (hasId && !isValidMessageId(message.id)) return { kind: 'invalid', reason: 'bad-id' }
  if (hasMethod && hasId) {
    return { kind: 'request', id: message.id, method: message.method, params: message.params, raw: message }
  }
  if (hasMethod) {
    return { kind: 'notification', method: message.method, params: message.params, raw: message }
  }
  if (hasId) {
    const hasResult = Object.hasOwn(message, 'result')
    const hasError = Object.hasOwn(message, 'error') && message.error !== undefined && message.error !== null
    if (hasError) return { kind: 'response', id: message.id, error: message.error, raw: message }
    if (hasResult) return { kind: 'response', id: message.id, result: message.result, raw: message }
    return { kind: 'invalid', reason: 'response-without-result-or-error' }
  }
  return { kind: 'invalid', reason: 'no-method-no-id' }
}

/** Bounded preview for diagnostic logs: never a whole tool payload or credential. */
export function previewMessage(message) {
  try {
    const text = JSON.stringify(message) ?? ''
    return text.length > MAX_LOG_PREVIEW ? `${text.slice(0, MAX_LOG_PREVIEW - 1)}…` : text
  } catch {
    return '[unserializable]'
  }
}

/** True when the agent is asking the client to touch the local filesystem. */
export function isClientFileMethod(method) {
  return CLIENT_FILE_METHODS.includes(method)
}

/** True when the agent is asking the client to run a local terminal. */
export function isTerminalMethod(method) {
  return typeof method === 'string' && method.startsWith(TERMINAL_METHOD_PREFIX)
}

/**
 * Client capabilities sent on initialize. File and terminal access are off
 * unless the Host explicitly turns them on; a hand-written prompt is never the
 * security boundary, so the capability and the method refusal agree.
 */
export function clientCapabilities({ fileSystem = false, terminal = false, meta } = {}) {
  const allow = fileSystem === true
  return Object.freeze({
    fs: { readTextFile: allow, writeTextFile: allow },
    terminal: terminal === true,
    ...(meta && typeof meta === 'object' ? { _meta: meta } : {}),
  })
}

/** ACP advertises optional operations as capability objects; older runtimes send booleans. */
const advertised = value => value === true || (typeof value === 'object' && value !== null && !Array.isArray(value))

/**
 * Read the initialize result against the fixed schema. Unknown fields are kept
 * verbatim under `raw` for diagnostics and never interpreted.
 */
export function readAgentCapabilities(initializeResult) {
  const result = initializeResult && typeof initializeResult === 'object' && !Array.isArray(initializeResult) ? initializeResult : {}
  const agent = result.agentCapabilities && typeof result.agentCapabilities === 'object' && !Array.isArray(result.agentCapabilities) ? result.agentCapabilities : {}
  const session = agent.sessionCapabilities && typeof agent.sessionCapabilities === 'object' && !Array.isArray(agent.sessionCapabilities) ? agent.sessionCapabilities : {}
  const prompt = agent.promptCapabilities && typeof agent.promptCapabilities === 'object' && !Array.isArray(agent.promptCapabilities) ? agent.promptCapabilities : {}
  const mcp = agent.mcpCapabilities && typeof agent.mcpCapabilities === 'object' && !Array.isArray(agent.mcpCapabilities) ? agent.mcpCapabilities : {}
  const auth = agent.auth && typeof agent.auth === 'object' && !Array.isArray(agent.auth) ? agent.auth : {}
  const info = result.agentInfo && typeof result.agentInfo === 'object' && !Array.isArray(result.agentInfo) ? result.agentInfo : {}
  return Object.freeze({
    protocolVersion: typeof result.protocolVersion === 'number' ? result.protocolVersion : null,
    agentName: typeof info.name === 'string' ? info.name : null,
    agentVersion: typeof info.version === 'string' ? info.version : null,
    authMethods: Array.isArray(result.authMethods) ? result.authMethods : [],
    loadSession: agent.loadSession === true,
    sessionResume: advertised(session.resume),
    sessionClose: advertised(session.close),
    authLogout: advertised(auth.logout),
    promptImage: prompt.image === true,
    mcpHttp: mcp.http === true,
    mcpSse: mcp.sse === true,
    raw: result,
  })
}
