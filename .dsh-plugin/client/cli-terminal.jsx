/**
 * "官方工具终端" card: interactive sessions of the user's shell or a fixed
 * official CLI (codex, claude, kimi, mcode, mimo, grok, gemini), rendered
 * with xterm.js. The Host owns the process (PTY, or pipes as a fallback);
 * this card only shows output and forwards keystrokes.
 */
import React from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import xtermCss from '@xterm/xterm/css/xterm.css'
import {
  TerminalConnection,
  clientPlatform,
  confirmationDetails,
  endDescription,
  formatDuration,
  loadTerminalInfo,
  startProblem,
  startTerminal,
  terminalTargets,
} from './cli-terminal-state.mjs'
import { remoteErrorText } from './host-version.mjs'

const CWD_STORAGE_KEY = 'model-router.terminal.cwd'
const text = value => typeof value === 'string' ? value.trim() : ''
const errorText = (error, fallback) => remoteErrorText(text(error?.message), fallback)

function storedCwd() {
  try { return globalThis.localStorage?.getItem(CWD_STORAGE_KEY) ?? '' } catch { return '' }
}
function storeCwd(value) {
  try { globalThis.localStorage?.setItem(CWD_STORAGE_KEY, value) } catch { /* private mode */ }
}

const THEME = Object.freeze({
  background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#264f78',
})

/** One live session: an xterm instance wired to a TerminalConnection. */
function TerminalPane({ api, session, active, onEnded }) {
  const host = React.useRef(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    const term = new Terminal({
      cursorBlink: true, convertEol: false, fontSize: 13, scrollback: 5_000, theme: THEME,
      fontFamily: 'Cascadia Mono, Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", Menlo, monospace',
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    const connection = new TerminalConnection({
      api, sessionId: session.sessionId,
      onData: data => term.write(data),
      onExit: event => {
        term.write(`\r\n\x1b[90m[${endDescription(event)}]\x1b[0m\r\n`)
        onEnded(session.sessionId, event)
      },
      onError: failure => setError(errorText(failure, '终端通信失败。')),
    })
    // Ctrl+C copies when text is selected (like Windows Terminal); otherwise it interrupts.
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true
      const key = event.key.toLowerCase()
      if (event.ctrlKey && (key === 'c' && (event.shiftKey || term.hasSelection()))) {
        void globalThis.navigator?.clipboard?.writeText(term.getSelection()).catch(() => {})
        term.clearSelection()
        return false
      }
      if (event.ctrlKey && event.shiftKey && key === 'v') {
        void globalThis.navigator?.clipboard?.readText().then(value => { if (value) term.paste(value) }).catch(() => {})
        return false
      }
      return true
    })
    const input = term.onData(data => connection.send(data))
    const resized = term.onResize(({ cols, rows }) => connection.resize(cols, rows))
    const refit = () => { try { if (host.current?.offsetParent !== null) fit.fit() } catch { /* hidden */ } }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refit) : null
    observer?.observe(host.current)
    refit()
    void connection.start()
    term.focus()
    return () => {
      observer?.disconnect()
      input.dispose()
      resized.dispose()
      void connection.stop()
      term.dispose()
    }
  }, [session.sessionId])
  return (
    <div className="mr-term-pane" style={{ display: active ? 'block' : 'none' }}>
      {session.limitation && <p className="mr-caption mr-term-warning">{session.limitation}{session.ptyError ? `（${session.ptyError}）` : ''}</p>}
      {error && <p className="mr-caption mr-term-warning" role="alert">{error}</p>}
      <div className="mr-term-screen" ref={host} />
    </div>
  )
}

export function CliTerminalCard({ api, health }) {
  const [info, setInfo] = React.useState({ status: 'loading', value: null, error: '' })
  const [target, setTarget] = React.useState('shell')
  const [mode, setMode] = React.useState('interactive')
  const [cwd, setCwd] = React.useState(storedCwd)
  const [confirming, setConfirming] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [startError, setStartError] = React.useState('')
  const [sessions, setSessions] = React.useState([])
  const [activeId, setActiveId] = React.useState('')
  const mounted = React.useRef(true)

  const loadInfo = React.useCallback(async () => {
    try {
      const value = await loadTerminalInfo(api)
      if (!mounted.current) return
      setInfo({ status: 'ready', value, error: '' })
    } catch (error) {
      if (mounted.current) setInfo({ status: 'error', value: null, error: errorText(error, '无法读取终端状态。') })
    }
  }, [api])

  React.useEffect(() => {
    mounted.current = true
    void loadInfo()
    return () => { mounted.current = false }
  }, [loadInfo])

  const platform = info.value?.platform ?? clientPlatform()
  const targets = terminalTargets(health?.tools ?? [], platform)
  const selected = targets.find(item => item.id === target) ?? targets[0]
  React.useEffect(() => { if (!targets.some(item => item.id === target)) setTarget('shell') }, [targets.length])
  React.useEffect(() => { if (!selected?.canLogin && mode === 'login') setMode('interactive') }, [selected?.id])
  const problem = startProblem({ target: selected?.id, cwd, targets })
  const details = confirmationDetails({ target: selected?.id, mode, cwd, platform })
  const live = sessions.filter(item => !item.ended).length
  const maxSessions = info.value?.limits?.maxSessions ?? 4

  const start = async () => {
    setStarting(true)
    setStartError('')
    try {
      const session = await startTerminal(api, { target: selected.id, mode, cwd: text(cwd), cols: 100, rows: 30 })
      storeCwd(text(cwd))
      if (!mounted.current) { void api.terminalStop({ sessionId: session.sessionId }); return }
      setSessions(previous => [...previous, { ...session, ended: null }])
      setActiveId(session.sessionId)
      setConfirming(false)
    } catch (error) {
      if (mounted.current) setStartError(errorText(error, '终端启动失败。'))
    } finally {
      if (mounted.current) setStarting(false)
    }
  }

  const onEnded = React.useCallback((sessionId, event) => {
    if (!mounted.current) return
    setSessions(previous => previous.map(item => item.sessionId === sessionId ? { ...item, ended: event } : item))
    void loadInfo()
  }, [loadInfo])

  const closeTab = sessionId => {
    setSessions(previous => {
      const next = previous.filter(item => item.sessionId !== sessionId)
      if (activeId === sessionId) setActiveId(next.at(-1)?.sessionId ?? '')
      return next
    })
  }

  const stopSession = sessionId => { void api.terminalStop({ sessionId }) }
  const active = sessions.find(item => item.sessionId === activeId)
  const history = info.value?.history ?? []

  return (
    <section className="mr-card" aria-label="官方工具终端">
      <style>{xtermCss}</style>
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">官方工具终端</h2>
        <p className="mr-card-copy">在工作台里交互式运行 PowerShell 或已安装的官方 CLI（多轮对话、实时输出，可用于 <code>codex login</code> 等登录）。终端不经过 Harness 沙箱，使用你自己的 CLI 登录和环境变量。</p>
      </div><button className="mr-button mr-button-secondary" type="button" onClick={() => { void loadInfo() }}>刷新</button></div>
      <div className="mr-card-body">
        {info.status === 'error' && <div className="mr-error" role="alert">{info.error}</div>}
        {info.value && <p className="mr-caption">{info.value.backend === 'pty'
          ? '终端组件：伪终端（PTY），支持全屏界面、颜色和窗口大小同步。'
          : `终端组件：管道模式。${info.value.limitation ?? ''}${info.value.ptyError ? `（PTY 加载失败：${info.value.ptyError}）` : ''}`}</p>}
        <div className="mr-controls">
          <div className="mr-control-group"><label className="mr-control-label" htmlFor="mr-term-target">启动</label>
            <select className="mr-input" id="mr-term-target" value={selected?.id ?? 'shell'} onChange={event => { setTarget(event.target.value); setConfirming(false) }}>
              {targets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select></div>
          {selected?.canLogin && <div className="mr-control-group"><span className="mr-control-label">方式</span><div className="mr-segment" role="group" aria-label="启动方式">
            <button type="button" aria-pressed={mode === 'interactive'} onClick={() => { setMode('interactive'); setConfirming(false) }}>交互会话</button>
            <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setConfirming(false) }}>登录</button>
          </div></div>}
          <div className="mr-control-group mr-term-cwd"><label className="mr-control-label" htmlFor="mr-term-cwd">工作目录（绝对路径）</label>
            <input className="mr-input" id="mr-term-cwd" value={cwd} spellCheck={false} placeholder={platform === 'win32' ? 'D:\\projects\\demo' : '/home/me/project'}
              onChange={event => { setCwd(event.target.value); setConfirming(false) }} /></div>
        </div>
        {targets.length === 1 && <p className="mr-caption">体检尚未发现已安装的官方 CLI；安装后点“官方工具 · 体检”的“重新体检”，这里会出现对应选项。</p>}
        {!confirming && <div className="mr-actions">
          <button className="mr-button" type="button" disabled={Boolean(problem) || live >= maxSessions || info.status !== 'ready'} onClick={() => { setStartError(''); setConfirming(true) }}>开始</button>
          <span className="mr-caption">{problem || (live >= maxSessions ? `最多同时运行 ${maxSessions} 个会话。` : `将运行：${details.command}`)}</span>
        </div>}
        {confirming && <div className="mr-term-confirm" role="dialog" aria-label="确认启动终端">
          <strong>{details.title}</strong>
          <p className="mr-caption">命令：<code>{details.command}</code><br />工作目录：<code>{details.cwd}</code></p>
          <ul>{details.points.map(point => <li key={point}>{point}</li>)}</ul>
          <div className="mr-actions">
            <button className="mr-button" type="button" disabled={starting} onClick={() => { void start() }}>{starting ? '正在启动…' : '确认启动'}</button>
            <button className="mr-button mr-button-secondary" type="button" disabled={starting} onClick={() => setConfirming(false)}>取消</button>
          </div>
        </div>}
        {startError && <p className="mr-error" role="alert">{startError}</p>}

        {sessions.length > 0 && <div className="mr-term-tabs" role="tablist" aria-label="终端会话">
          {sessions.map(item => (
            <div key={item.sessionId} className="mr-term-tab" role="tab" aria-selected={item.sessionId === activeId}>
              <button type="button" className="mr-term-tab-label" onClick={() => setActiveId(item.sessionId)} title={`${item.display} · ${item.cwd}`}>
                {item.label}{item.mode === 'login' ? ' · 登录' : ''}{item.ended ? ' · 已结束' : ''}
              </button>
              {item.ended
                ? <button type="button" className="mr-term-tab-close" aria-label="关闭标签" onClick={() => closeTab(item.sessionId)}>×</button>
                : <button type="button" className="mr-term-tab-close" aria-label="结束会话" title="结束会话" onClick={() => stopSession(item.sessionId)}>■</button>}
            </div>
          ))}
        </div>}
        {sessions.map(item => <TerminalPane key={item.sessionId} api={api} session={item} active={item.sessionId === activeId} onEnded={onEnded} />)}
        {active && <p className="mr-caption">{active.ended ? endDescription(active.ended) : `${active.display} · ${active.cwd} · 选中文字后 Ctrl+C 复制，Ctrl+Shift+V 粘贴；拖动右下角可调整高度。`}</p>}

        {history.length > 0 && <details className="mr-term-history"><summary>最近的终端会话（只记录工具、目录和时长）</summary>
          <table className="mr-term-table"><thead><tr><th>开始</th><th>工具</th><th>工作目录</th><th>时长</th><th>结果</th></tr></thead><tbody>
            {history.map(item => <tr key={item.id}>
              <td>{item.startedAt ? new Date(item.startedAt).toLocaleString() : '—'}</td>
              <td>{item.label}{item.mode === 'login' ? ' · 登录' : ''}{item.backend === 'pipe' ? ' · 管道' : ''}</td>
              <td title={item.cwd}>{item.cwd}</td>
              <td>{formatDuration(item.durationMs)}</td>
              <td>{endDescription(item)}</td>
            </tr>)}
          </tbody></table>
        </details>}
      </div>
    </section>
  )
}
