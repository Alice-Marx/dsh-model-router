/**
 * Framework-free logic for the "官方工具终端" card: launch-target choices,
 * confirmation copy, and the client side of the long-poll transport.
 * Kept out of the JSX so the test suite can exercise it without a DOM.
 */
import {
  TERMINAL_SHELL_ID,
  TERMINAL_TOOL_IDS,
  isAbsoluteDirectoryText,
  terminalCommandPreview,
  terminalTargetLabel,
} from '../shared/cli-terminal-protocol.mjs'

const text = value => typeof value === 'string' ? value.trim() : ''

/** Guess the client platform for display (the Host builds the real command). */
export function clientPlatform(nav = globalThis.navigator) {
  const value = `${nav?.userAgentData?.platform ?? ''} ${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`
  return /win/i.test(value) ? 'win32' : /mac/i.test(value) ? 'darwin' : 'linux'
}

/**
 * The shell is always offered; an official CLI only when the health check
 * reported it installed.
 */
export function terminalTargets(healthTools = [], platform = 'win32') {
  const installed = new Set((Array.isArray(healthTools) ? healthTools : []).filter(item => item?.installed).map(item => item.id))
  return [
    { id: TERMINAL_SHELL_ID, label: platform === 'win32' ? 'PowerShell（系统终端）' : 'Shell（系统终端）', canLogin: false },
    ...TERMINAL_TOOL_IDS.filter(id => installed.has(id)).map(id => ({ id, label: terminalTargetLabel(id), canLogin: id !== 'gemini' })),
  ]
}

/** Problems that keep the start button disabled. */
export function startProblem({ target, cwd, targets }) {
  if (!targets.some(item => item.id === target)) return '请选择要启动的终端。'
  if (!text(cwd)) return '请填写工作目录（绝对路径）。'
  if (!isAbsoluteDirectoryText(cwd)) return '工作目录必须是绝对路径，例如 D:\\projects\\demo 或 /home/me/project。'
  return ''
}

/** What the user confirms before a session starts. */
export function confirmationDetails({ target, mode = 'interactive', cwd, platform = 'win32' }) {
  const label = target === TERMINAL_SHELL_ID ? (platform === 'win32' ? 'PowerShell' : '系统 Shell') : terminalTargetLabel(target)
  return {
    title: `启动 ${label}${mode === 'login' ? ' 登录' : ''}？`,
    command: terminalCommandPreview(target, mode, platform),
    cwd: text(cwd),
    points: [
      '该终端不经过 Harness 进程沙箱：它和你自己打开的终端一样，能读写你账号可访问的所有文件、运行任何命令。',
      target === TERMINAL_SHELL_ID
        ? '使用你的登录环境变量（PATH、代理、API Key 等）。'
        : '使用你自己的 CLI 登录状态和环境变量（PATH、代理、API Key 等）；产生的费用按该 CLI 的账号或套餐计费。',
      '输入和输出不会被记录；执行历史只保存工具、工作目录、开始/结束时间和退出码。',
      '关闭工作台面板、结束会话或长时间无人查看（约 2 分钟）时，终端进程会被结束。',
    ],
  }
}

export function endDescription({ endReason, exitCode }) {
  const code = exitCode === null || exitCode === undefined ? '' : `，退出码 ${exitCode}`
  switch (endReason) {
    case 'stopped': return `已由你结束${code}。`
    case 'orphan': return '长时间没有面板读取输出，已自动结束。'
    case 'lifetime': return '会话达到最长时长（6 小时），已自动结束。'
    case 'dispose': return '插件已卸载或重新加载，会话已结束。'
    default: return `进程已退出${code}。`
  }
}

export const formatDuration = ms => {
  if (!Number.isFinite(ms)) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

const unwrap = (response, fallback) => {
  if (response?.ok) return response.value
  throw new Error(text(response?.error?.message) || text(response?.error) || fallback)
}

/**
 * Client end of one session: a single long-poll read loop, ordered input
 * writes (coalesced while one is in flight) and debounced resizes.
 */
export class TerminalConnection {
  constructor({ api, sessionId, onData, onExit, onError, waitMs = 800, retryMs = 1_000, resizeDelayMs = 120, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { api, sessionId, onData, onExit, onError, waitMs, retryMs, resizeDelayMs })
    // Browser timer functions throw "Illegal invocation" when called as a
    // method of another object, so never call them through `this`.
    this.setTimer = (callback, ms) => setTimer(callback, ms)
    this.clearTimer = id => clearTimer(id)
    this.cursor = 0
    this.closed = false
    this.pendingInput = ''
    this.writing = null
    this.resizeTimer = null
    this.failures = 0
  }

  start() {
    this.loop = this.readLoop()
    return this.loop
  }

  async readLoop() {
    while (!this.closed) {
      let output
      try {
        output = unwrap(await this.api.terminalRead({ sessionId: this.sessionId, cursor: this.cursor, waitMs: this.waitMs }), '读取终端输出失败。')
        this.failures = 0
      } catch (error) {
        if (this.closed) return
        this.failures += 1
        this.onError?.(error)
        if (this.failures >= 5) { this.closed = true; this.onExit?.({ endReason: 'lost', exitCode: null }); return }
        await new Promise(resolve => this.setTimer(resolve, this.retryMs))
        continue
      }
      if (this.closed) return
      if (output.dropped) this.onData?.('\r\n[部分较早的输出已丢弃]\r\n')
      if (output.data) this.onData?.(output.data)
      this.cursor = output.cursor
      if (output.exited) { this.closed = true; this.onExit?.({ endReason: output.endReason, exitCode: output.exitCode }); return }
    }
  }

  send(data) {
    if (this.closed || !data) return
    this.pendingInput += data
    if (!this.writing) this.writing = this.flush()
  }

  async flush() {
    try {
      while (this.pendingInput && !this.closed) {
        const chunk = this.pendingInput.slice(0, 60_000)
        this.pendingInput = this.pendingInput.slice(chunk.length)
        try { unwrap(await this.api.terminalWrite({ sessionId: this.sessionId, data: chunk }), '发送输入失败。') }
        catch (error) { this.onError?.(error) }
      }
    } finally {
      this.writing = null
    }
  }

  resize(cols, rows) {
    if (this.closed) return
    if (this.resizeTimer) this.clearTimer(this.resizeTimer)
    this.resizeTimer = this.setTimer(() => {
      this.resizeTimer = null
      void Promise.resolve(this.api.terminalResize({ sessionId: this.sessionId, cols, rows })).catch(() => {})
    }, this.resizeDelayMs)
  }

  /** Stop reading and ask the Host to kill the process. Safe to call twice. */
  async stop() {
    const wasOpen = !this.closed
    this.closed = true
    if (this.resizeTimer) this.clearTimer(this.resizeTimer)
    if (wasOpen) {
      try { await this.api.terminalStop({ sessionId: this.sessionId }) } catch { /* the Host orphan timeout still ends it */ }
    }
  }
}
