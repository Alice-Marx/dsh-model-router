/**
 * Drive an interactive terminal tool with one prompt.
 *
 * Some registry tools are terminal applications, not headless CLIs: dsh-TUI launches the
 * Harness under its own profile and only answers through its TUI. There is no `-p` mode to
 * call, so the only faithful way to use one from the Host is to run it in the managed terminal
 * and type the prompt, then collect what it renders until the screen goes quiet.
 *
 * The result is terminal text, not a protocol: it is reported as rendered output and callers
 * must not treat it as structured JSON. Every run owns one session and always closes it.
 */

/** Remove ANSI/OSC sequences so a caller reads the words, not the drawing commands. */
export function stripAnsi(value) {
  return String(value ?? '')
    // OSC ... BEL/ST (window titles, hyperlinks, notifications)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    // CSI ... final byte (colors, cursor movement, erase)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    // Two-character escapes and bare control bytes left over
    .replace(/\u001b[@-_]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** The prompt is typed into the TUI, so every line break becomes the Enter key. */
const typed = prompt => `${prompt.replace(/\r\n?/g, '\n').replace(/\n/g, '\r')}\r`

/**
 * @param {{
 *   terminals: { start: Function, read: Function, write: Function, stop: Function },
 *   locate?: (executable: string, options: { platform: string, env: object }) => Promise<string | null> | string | null,
 *   env?: object, platform?: string, now?: () => number,
 *   bootMs?: number, idleMs?: number, timeoutMs?: number, readMs?: number, cols?: number, rows?: number,
 * }} options
 */
export function createTuiPromptRunner({
  terminals, locate = null, env = process.env, platform = process.platform, now = Date.now,
  bootMs = 20_000, idleMs = 3_000, timeoutMs = 180_000, readMs = 400, cols = 120, rows = 40,
} = {}) {
  if (!terminals || typeof terminals.start !== 'function' || typeof terminals.read !== 'function'
    || typeof terminals.write !== 'function' || typeof terminals.stop !== 'function') {
    throw new TypeError('TUI_RUNNER_REQUIRES_TERMINAL')
  }
  const executableOf = async tool => {
    const candidates = Array.isArray(tool?.probeExecutables) ? tool.probeExecutables : []
    if (typeof locate !== 'function') return candidates[0] ?? tool?.id ?? null
    for (const name of candidates.length > 0 ? candidates : [tool?.id]) {
      const found = await locate(name, { platform, env })
      if (found) return found
    }
    return null
  }

  return Object.freeze({
    /**
     * Type `prompt` into `tool` running in a fresh terminal session and return what it renders.
     * @param {{ tool: object, prompt: string, cwd?: string, signal?: AbortSignal }} request
     * @returns {Promise<{ text: string, bytes: number, durationMs: number, sessionId: string }>}
     */
    async run({ tool, prompt, cwd, signal } = {}) {
      if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error('TUI_PROMPT_REQUIRED')
      const executable = await executableOf(tool)
      if (!executable) throw new Error('TUI_TOOL_NOT_FOUND')
      signal?.throwIfAborted()
      const started = now()
      const session = await terminals.start({ tool: tool?.id ?? 'tui', executable, cwd, cols, rows, env })
      const sessionId = session?.sessionId ?? session?.id
      if (typeof sessionId !== 'string') throw new Error('TUI_SESSION_REQUIRED')
      let cursor = 0
      let buffer = ''
      const pull = async waitMs => {
        const page = await terminals.read({ sessionId, cursor, waitMs })
        cursor = page?.cursor ?? cursor
        if (page?.data) buffer += page.data
        return page
      }
      try {
        // Wait for the application to draw its first screen before typing into it.
        let quietSince = now()
        for (;;) {
          signal?.throwIfAborted()
          const before = buffer.length
          const page = await pull(readMs)
          if (buffer.length > before) quietSince = now()
          if (page?.exited || page?.closed) break
          if (now() - quietSince >= 1_500) break
          if (now() - started >= bootMs) break
        }
        terminals.write({ sessionId, data: typed(prompt) })
        const afterPrompt = now()
        let lastGrowth = afterPrompt
        for (;;) {
          signal?.throwIfAborted()
          const before = buffer.length
          const page = await pull(readMs)
          if (buffer.length > before) lastGrowth = now()
          if (page?.exited || page?.closed) break
          // The TUI keeps a cursor ticking on some terminals; a quiet screen is the only
          // completion signal it offers, so require a margin after the prompt was typed.
          if (now() - lastGrowth >= idleMs && now() - afterPrompt >= idleMs) break
          if (now() - started >= timeoutMs) throw new Error('TUI_TIMEOUT')
        }
        const text = stripAnsi(buffer).trim()
        return { text, bytes: buffer.length, durationMs: now() - started, sessionId }
      } finally {
        try { await terminals.stop({ sessionId }) } catch { /* already gone */ }
      }
    },
  })
}
