/**
 * MiniMax Code 0.5.5 headless adapter.
 *
 * Source contracts:
 * https://github.com/MiniMax-AI/minimax-code/blob/v0.5.5/packages/tui/src/cli/contract.ts
 * https://github.com/MiniMax-AI/minimax-code/blob/v0.5.5/packages/tui/src/headless/events.ts
 * https://github.com/MiniMax-AI/minimax-code/blob/v0.5.5/packages/tui/src/headless/contract.ts
 *
 * The Host verifies the official npm bundle, Node runtime, account, and
 * workspace. This module never resolves a PATH shim or accepts free-form args.
 */
import { basename, isAbsolute } from 'node:path'

const TYPES = new Set([
  'exec.started', 'session.started', 'session.resumed', 'turn.started',
  'item.started', 'item.updated', 'item.completed',
  'turn.completed', 'turn.failed', 'exec.completed',
])
const STATUSES = new Set(['succeeded', 'failed', 'timeout', 'cancelled', 'limit_exceeded'])

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function id(value, maximum = 240) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0')
}

function absolute(value, label, filename) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
    throw new TypeError(label + ' must be an absolute path')
  }
  if (filename && basename(value).toLowerCase() !== filename) {
    throw new TypeError(label + ' must identify ' + filename)
  }
  return value
}

function checkedModel(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > 240 || value.includes('\0')
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*\/[A-Za-z0-9][A-Za-z0-9_.:/#-]*$/.test(value)) {
    throw new TypeError('MiniMax model must use provider/model')
  }
  return value
}

/**
 * Build the fixed invocation. The caller sends the task on stdin. MiniMax
 * headless has no read-only switch: the outer Host sandbox enforces that mode.
 * Full vendor permission is available only for a Host-approved isolated run.
 */
export function buildMiniMaxInvocation({
  nodeExecutable, cliEntry, workspace, mode = 'read-only',
  modelReference, permission = 'smart', timeoutMs, maxSteps,
}) {
  const file = absolute(nodeExecutable, 'nodeExecutable', process.platform === 'win32' ? 'node.exe' : 'node')
  const entry = absolute(cliEntry, 'cliEntry', 'cli.js')
  const cwd = absolute(workspace, 'workspace')
  if (mode !== 'read-only' && mode !== 'workspace-write') throw new TypeError('invalid execution mode')
  if (permission !== 'smart' && permission !== 'full') throw new TypeError('invalid MiniMax permission')
  if (permission === 'full' && mode !== 'workspace-write') {
    throw new TypeError('full MiniMax permission requires an isolated workspace-write run')
  }
  const model = checkedModel(modelReference)
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 86_400_000)) {
    throw new TypeError('timeoutMs must be between 1000 and 86400000')
  }
  if (maxSteps !== undefined && (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 10_000)) {
    throw new TypeError('maxSteps must be between 1 and 10000')
  }
  const args = [entry, 'exec', '--input', '-', '--cwd', cwd,
    '--permission', permission, '--output-format', 'stream-json']
  if (model) args.push('--model', model)
  if (timeoutMs !== undefined) args.push('--timeout', String(timeoutMs) + 'ms')
  if (maxSteps !== undefined) args.push('--max-steps', String(maxSteps))
  return { file, args, format: 'minimax-stream-json',
    source: 'verified-official-npm-bundle', requestedModel: model }
}

function validUsage(value) {
  return value === undefined || (object(value) && Object.values(value).every(
    field => field === undefined || (typeof field === 'number' && Number.isFinite(field) && field >= 0)))
}

function validModel(value) {
  return value === undefined || (object(value) && id(value.providerId) && id(value.modelId))
}

function validResult(value) {
  return object(value) && value.schemaVersion === 1 && value.type === 'exec.result'
    && id(value.runId) && id(value.sessionId) && id(value.turnId)
    && STATUSES.has(value.status) && Number.isFinite(value.durationMs)
    && value.durationMs >= 0 && validModel(value.model) && validUsage(value.usage)
    && (value.usageSource === undefined || [
      'completed_responses', 'analytics_fallback', 'unavailable',
    ].includes(value.usageSource))
    && (value.usageIncomplete === undefined || typeof value.usageIncomplete === 'boolean')
    && (value.error === undefined || (object(value.error)
      && ['config', 'runtime', 'internal'].includes(value.error.category)
      && typeof value.error.message === 'string'))
}

function answer(result, lastMessage) {
  if (typeof result.output === 'string') return result.output
  if (result.output !== undefined && result.output !== null) {
    try { return JSON.stringify(result.output) } catch { /* malformed vendor payload */ }
  }
  return lastMessage
}

/**
 * Call push with decoded UTF-8 stdout and finish after close. Only a valid
 * exec.completed result, matching turn terminal, and exit code 0 succeeds.
 */
export function createMiniMaxStreamParser({ maxLineChars = 4_000_000 } = {}) {
  if (!Number.isSafeInteger(maxLineChars) || maxLineChars < 1024 || maxLineChars > 16_000_000) {
    throw new TypeError('maxLineChars is out of range')
  }
  let pending = ''
  let error = null
  let sequence = 0
  let identity = null
  let stage = 'initial'
  let terminal = null
  let terminalStatus = null
  let result = null
  let lastMessage = ''

  function reject(message) { error ??= message }

  function accept(line) {
    if (error || !line.trim()) return
    let event
    try { event = JSON.parse(line) } catch { reject('MiniMax 输出了无效 JSONL。'); return }
    if (!object(event) || event.schemaVersion !== 1 || !TYPES.has(event.type)
      || !Number.isSafeInteger(event.sequence) || event.sequence !== sequence + 1
      || !Number.isFinite(event.timestampMs) || event.timestampMs < 0
      || !id(event.runId) || !id(event.sessionId) || !id(event.turnId)) {
      reject('MiniMax JSONL 事件结构或顺序无效。')
      return
    }
    sequence = event.sequence
    const current = { runId: event.runId, sessionId: event.sessionId, turnId: event.turnId }
    if (identity && Object.keys(current).some(key => current[key] !== identity[key])) {
      reject('MiniMax 会话身份在运行中改变。')
      return
    }
    identity ??= current
    if (stage === 'finished' || (terminal && event.type !== 'exec.completed')) {
      reject('MiniMax 在终态后继续输出事件。')
      return
    }
    if (stage === 'initial') {
      if (event.type === 'exec.started') stage = 'started'
      else reject('MiniMax 缺少 exec.started 起始事件。')
      return
    }
    if (event.type === 'session.started' || event.type === 'session.resumed') {
      if (stage === 'started') stage = 'session'
      else reject('MiniMax 会话起始事件顺序无效。')
      return
    }
    if (event.type === 'turn.started') {
      if (stage === 'session') stage = 'turn'
      else reject('MiniMax turn.started 事件顺序无效。')
      return
    }
    if (stage !== 'turn') { reject('MiniMax 缺少会话或任务起始事件。'); return }
    if (event.type.startsWith('item.')) {
      if (!object(event.item) || !id(event.item.id, 500)
        || !['agent_message', 'reasoning', 'tool_call'].includes(event.item.type)) {
        reject('MiniMax item 事件结构无效。')
      } else if (event.type === 'item.completed' && event.item.type === 'agent_message'
        && typeof event.item.content === 'string') {
        lastMessage = event.item.content
      }
      return
    }
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      if (!Number.isFinite(event.durationMs) || event.durationMs < 0
        || (event.type === 'turn.failed'
          && (!STATUSES.has(event.status) || event.status === 'succeeded'))) {
        reject('MiniMax turn 终态结构无效。')
      } else {
        terminal = event.type
        terminalStatus = event.type === 'turn.completed' ? 'succeeded' : event.status
      }
      return
    }
    if (event.type === 'exec.completed') {
      if (!terminal || !validResult(event.result)
        || Object.keys(identity).some(key => event.result[key] !== identity[key])
        || event.result.status !== terminalStatus) {
        reject('MiniMax exec.completed 与任务终态不一致。')
      } else {
        result = event.result
        stage = 'finished'
      }
      return
    }
    reject('MiniMax JSONL 出现意外事件。')
  }

  return {
    push(chunk) {
      if (typeof chunk !== 'string') throw new TypeError('push expects decoded UTF-8 text')
      if (error) return { events: sequence, protocolError: error }
      pending += chunk
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline < 0) break
        const line = pending.slice(0, newline).replace(/\r$/, '')
        pending = pending.slice(newline + 1)
        if (line.length > maxLineChars) { reject('MiniMax JSONL 单行超出限制。'); break }
        accept(line)
        if (error) break
      }
      if (!error && pending.length > maxLineChars) reject('MiniMax JSONL 单行超出限制。')
      if (error) pending = ''
      return { events: sequence, protocolError: error }
    },
    finish(exitCode) {
      if (!error && pending.trim()) accept(pending.replace(/\r$/, ''))
      pending = ''
      if (error) return { status: 'failed', exitCode, error, terminalEvent: terminal }
      if (!result || !terminal || stage !== 'finished') {
        return { status: 'failed', exitCode, error: 'MiniMax 未返回完整的 exec.completed 结果。', terminalEvent: terminal }
      }
      const finalText = answer(result, lastMessage)
      const details = {
        exitCode, vendorStatus: result.status, terminalEvent: terminal,
        runId: result.runId, sessionId: result.sessionId, turnId: result.turnId,
        reportedModel: result.model ?? null, usage: result.usage ?? null,
        usageSource: result.usageSource ?? null,
        usageIncomplete: result.usageIncomplete ?? null,
        durationMs: result.durationMs, finalText,
      }
      if (exitCode !== 0) return { ...details, status: 'failed', error: 'MiniMax CLI 退出码非零。' }
      if (result.status !== 'succeeded') {
        return { ...details, status: 'failed',
          error: String(result.error?.message ?? result.status).slice(0, 500) }
      }
      return { ...details, status: 'succeeded' }
    },
  }
}
