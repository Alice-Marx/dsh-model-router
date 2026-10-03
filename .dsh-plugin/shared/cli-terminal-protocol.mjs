/**
 * Request contract for the workbench "官方工具终端" (interactive official CLI
 * terminal). Pure data and validation: imported by the Host session manager,
 * the Typert descriptors and the Desktop client.
 *
 * A client may only name a fixed launch target: the user's own shell or one
 * registry CLI, optionally in its fixed login mode. It never supplies an
 * executable, argument vector or environment. Everything the user types goes
 * into that interactive process, exactly as in their own terminal, so a
 * session starts only after an explicit confirmation.
 */
import { getOfficialTool } from './official-tool-registry.mjs'

/** Registry CLIs that have an interactive terminal UI (ZCode is a desktop app). */
export const TERMINAL_TOOL_IDS = Object.freeze(['codex', 'claude-code', 'kimi-code', 'minimax-code', 'mimo-code', 'grok-build', 'gemini'])
export const TERMINAL_SHELL_ID = 'shell'
export const TERMINAL_TARGETS = Object.freeze([TERMINAL_SHELL_ID, ...TERMINAL_TOOL_IDS])
export const TERMINAL_MODES = Object.freeze(['interactive', 'login'])

export const TERMINAL_LIMITS = Object.freeze({
  maxSessions: 4,
  /** A session nobody reads (panel closed, client gone) is killed after this. */
  orphanTimeoutMs: 120_000,
  /** Hard lifetime of one session. */
  maxLifetimeMs: 6 * 60 * 60_000,
  /** Output kept per session for the client to catch up. */
  bufferChars: 1_000_000,
  /** Largest output slice returned by one read. */
  readChars: 256_000,
  /** Longest long-poll wait for new output. */
  maxWaitMs: 1_000,
  /** Largest single input write (a paste). */
  writeChars: 65_536,
  minCols: 10, maxCols: 500, minRows: 3, maxRows: 300,
})

/**
 * Fixed login commands, derived from the documented tool login commands
 * (LOGIN_GUIDES in tool-health.mjs). Gemini signs in from its interactive UI.
 */
export const TERMINAL_LOGIN_ARGS = Object.freeze({
  codex: Object.freeze(['login']),
  'claude-code': Object.freeze(['auth', 'login']),
  'kimi-code': Object.freeze(['login']),
  'minimax-code': Object.freeze(['login']),
  'mimo-code': Object.freeze(['auth', 'login']),
  'grok-build': Object.freeze(['login']),
  gemini: Object.freeze([]),
})

const SESSION_ID = /^term-[a-z0-9]{6,40}$/

function plainObject(value, subject) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${subject} must be an object`)
  return value
}

function sessionIdOf(value) {
  if (typeof value !== 'string' || !SESSION_ID.test(value)) throw new TypeError('sessionId is invalid')
  return value
}

function boundedInteger(value, min, max, subject) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${subject} must be an integer from ${min} to ${max}`)
  return value
}

/** Absolute path on either platform; the Host checks that it exists. */
export function isAbsoluteDirectoryText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4_096 || value.includes('\0')) return false
  const path = value.trim()
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path)
}

/** Display label of a launch target. */
export function terminalTargetLabel(target) {
  if (target === TERMINAL_SHELL_ID) return '系统终端'
  return getOfficialTool(target)?.label ?? String(target)
}

/** Command shown to the user before starting (display only; the Host builds the real launch). */
export function terminalCommandPreview(target, mode = 'interactive', platform = 'win32') {
  if (target === TERMINAL_SHELL_ID) return platform === 'win32' ? 'powershell.exe -NoLogo' : '$SHELL -l'
  const tool = getOfficialTool(target)
  const executable = tool?.probeExecutables?.[0] ?? String(target)
  const args = mode === 'login' ? TERMINAL_LOGIN_ARGS[target] ?? [] : []
  return [executable, ...args].join(' ')
}

export function parseTerminalStart(value) {
  const request = plainObject(value, 'terminal start request')
  if (!TERMINAL_TARGETS.includes(request.target)) throw new TypeError('target must be the shell or a fixed official CLI')
  const mode = request.mode === undefined ? 'interactive' : request.mode
  if (!TERMINAL_MODES.includes(mode)) throw new TypeError('mode must be interactive or login')
  if (mode === 'login' && request.target === TERMINAL_SHELL_ID) throw new TypeError('the shell has no login mode')
  if (!isAbsoluteDirectoryText(request.cwd)) throw new TypeError('cwd must be an absolute directory path')
  if (request.confirmed !== true) throw new TypeError('starting a terminal requires the user\'s confirmation')
  return {
    target: request.target,
    mode,
    cwd: request.cwd.trim(),
    cols: boundedInteger(request.cols ?? 100, TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.maxCols, 'cols'),
    rows: boundedInteger(request.rows ?? 30, TERMINAL_LIMITS.minRows, TERMINAL_LIMITS.maxRows, 'rows'),
    confirmed: true,
  }
}

export function parseTerminalRead(value) {
  const request = plainObject(value, 'terminal read request')
  const cursor = request.cursor ?? 0
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError('cursor must be a non-negative integer')
  const waitMs = request.waitMs ?? 0
  return { sessionId: sessionIdOf(request.sessionId), cursor, waitMs: boundedInteger(waitMs, 0, TERMINAL_LIMITS.maxWaitMs, 'waitMs') }
}

export function parseTerminalWrite(value) {
  const request = plainObject(value, 'terminal write request')
  if (typeof request.data !== 'string' || request.data.length === 0 || request.data.length > TERMINAL_LIMITS.writeChars) {
    throw new TypeError(`data must be 1 to ${TERMINAL_LIMITS.writeChars} characters`)
  }
  return { sessionId: sessionIdOf(request.sessionId), data: request.data }
}

export function parseTerminalResize(value) {
  const request = plainObject(value, 'terminal resize request')
  return {
    sessionId: sessionIdOf(request.sessionId),
    cols: boundedInteger(request.cols, TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.maxCols, 'cols'),
    rows: boundedInteger(request.rows, TERMINAL_LIMITS.minRows, TERMINAL_LIMITS.maxRows, 'rows'),
  }
}

export function parseTerminalStop(value) {
  const request = plainObject(value, 'terminal stop request')
  return { sessionId: sessionIdOf(request.sessionId) }
}

export const isTerminalSessionId = value => typeof value === 'string' && SESSION_ID.test(value)
