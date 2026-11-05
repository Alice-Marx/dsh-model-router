import React, { useCallback, useEffect, useRef, useState } from 'react'
import { framePoint } from '../../packages/orchestration/src/desktop-contract.mjs'
import { connectDesktopStream } from './desktop-stream.mjs'
import { createAcknowledgedRoutineRecorder } from './routine-recorder.mjs'
import { RoutineCaptureControls } from './routines-panel.jsx'

const rootOf = machine => typeof machine?.roots?.[0] === 'string' ? machine.roots[0] : machine?.rootId ?? machine?.roots?.[0]?.id ?? ''
const STATUS = { idle: '未连接', connecting: '连接中', authenticating: '验证中', connected: '已连接', releasing: '归还控制中', disconnected: '已断开', error: '连接异常' }

export function DesktopViewer({ botId, machines, openSession, renewSession, closeSession, saveRoutine }) {
  const [machineId, setMachineId] = useState(machines[0]?.machineId ?? machines[0]?.id ?? '')
  const [displayId, setDisplayId] = useState('')
  const [displays, setDisplays] = useState([])
  const [state, setState] = useState({ status: 'idle', mode: 'watch' })
  const [expanded, setExpanded] = useState(false)
  const [stats, setStats] = useState({ fps: 0, width: 0, height: 0 })
  const [text, setText] = useState('')
  const [metadata, setMetadata] = useState({})
  const recorderRef = useRef(null)
  if (!recorderRef.current) recorderRef.current = createAcknowledgedRoutineRecorder()
  const recorder = recorderRef.current
  const canvasRef = useRef(null), largeRef = useRef(null), streamRef = useRef(null), ticketRef = useRef(null)
  const generation = useRef(0), pendingFrame = useRef(null), drawing = useRef(false)
  const surface = useRef(null)
  const size = useRef({ width: 0, height: 0 }), rate = useRef({ at: performance.now(), count: 0 })
  const renewTimer = useRef(null), moveTimer = useRef(null), pendingMove = useRef(null)
  const [canControl, setCanControl] = useState(false)
  const closeRef = useRef(closeSession)
  closeRef.current = closeSession
  useEffect(() => { if (!machineId && machines[0]) setMachineId(machines[0].machineId ?? machines[0].id) }, [machines, machineId])
  const release = useCallback(() => { pendingMove.current = null; void streamRef.current?.releaseInput()?.catch(() => {}) }, [])
  const stop = useCallback(async () => {
    recorder.invalidate('ROUTINE_DESKTOP_DISCONNECTED')
    generation.current++; clearTimeout(renewTimer.current); renewTimer.current = null
    if (moveTimer.current !== null) cancelAnimationFrame(moveTimer.current)
    moveTimer.current = null; pendingMove.current = null; pendingFrame.current = null
    size.current = { width: 0, height: 0 }
    streamRef.current?.close(); streamRef.current = null
    const ticket = ticketRef.current; ticketRef.current = null
    if (ticket) {
      try { return await closeRef.current(botId, ticket.sessionId) }
      catch { return { stopConfirmed: false } }
    }
    return { stopConfirmed: true }
  }, [botId])
  const draw = useCallback(async (bytes, info) => {
    const queue = pendingFrame.current ?? []
    // Patches depend on their predecessors; only a complete keyframe can replace the queue.
    if (info?.keyframe === true) queue.length = 0
    queue.push({ bytes, info })
    pendingFrame.current = queue
    if (queue.length > 16) { streamRef.current?.close(); setState({ status: 'error', mode: 'watch', error: '画面解码跟不上，请重新连接。' }); return }
    if (drawing.current) return
    drawing.current = true
    const active = generation.current
    try {
      while (pendingFrame.current?.length && active === generation.current) {
        const frame = pendingFrame.current.shift()
        const bitmap = await createImageBitmap(new Blob([frame.bytes], { type: 'image/jpeg' }))
        try {
          if (active !== generation.current) break
          // The JPEG may shrink to fit the network. Input and recording always use the
          // selected monitor's physical geometry supplied by the authenticated session.
          if (!size.current.width || !size.current.height) size.current = { width: bitmap.width, height: bitmap.height }
          const width = frame.info?.frameWidth ?? bitmap.width, height = frame.info?.frameHeight ?? bitmap.height
          const region = frame.info?.region
          if (!surface.current) surface.current = document.createElement('canvas')
          const base = surface.current
          if (base.width !== width || base.height !== height) {
            if (region && frame.info?.keyframe !== true) throw new Error('缺少完整起始帧')
            base.width = width; base.height = height
          }
          if (region && (!Number.isInteger(region.x) || !Number.isInteger(region.y) || region.x < 0 || region.y < 0 || region.width !== bitmap.width
            || region.height !== bitmap.height || region.x + region.width > width || region.y + region.height > height)) throw new Error('画面区域无效')
          base.getContext('2d')?.drawImage(bitmap, region?.x ?? 0, region?.y ?? 0)
          for (const canvas of [canvasRef.current, largeRef.current]) if (canvas) {
            if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
            canvas.getContext('2d')?.drawImage(base, 0, 0)
          }
          rate.current.count++
          const at = performance.now(), elapsed = at - rate.current.at
          if (elapsed >= 1000) { setStats({ ...size.current, frameWidth: width, frameHeight: height,
            fps: Math.round(rate.current.count * 1000 / elapsed) }); rate.current = { at, count: 0 } }
        } finally { bitmap.close() }
      }
    } catch (failure) { setState(before => ({ ...before, error: `画面解码失败：${failure.message}` })) }
    finally { drawing.current = false }
  }, [])
  const connect = useCallback(async () => {
    await stop()
    const active = generation.current
    setState({ status: 'connecting', mode: 'watch' }); setStats({ fps: 0, width: 0, height: 0 })
    try {
      const ticket = await openSession(botId, machineId, { ...(displayId ? { displayId } : {}), mode: 'watch', fps: 15 })
      if (active !== generation.current) { await closeSession(botId, ticket.sessionId); return }
      ticketRef.current = ticket; setCanControl(ticket.canControl === true)
      if (ticket.displays?.length) setDisplays(ticket.displays)
      streamRef.current = connectDesktopStream({ ticket, onFrame: draw,
        onBeforeInput: (event, meta) => recorder.inputSent(event, meta),
        onInputAcknowledged: (event, meta) => recorder.inputAcknowledged(event, meta),
        onInputFailure: (event, meta) => recorder.inputFailed(event, meta),
        onMetadata: value => {
          if (active !== generation.current) return
          if (value.displays) setDisplays(value.displays)
          if (value.width && value.height) size.current = { width: value.width, height: value.height }
          setMetadata(before => { const next = { ...before, ...value }; recorder.metadataChanged(next); return next })
        },
        onState: value => {
          if (active !== generation.current) return
          if (['error', 'disconnected'].includes(value.status)) recorder.invalidate('ROUTINE_DESKTOP_DISCONNECTED')
          setState(before => ({ ...before, error: '', ...value }))
        },
      })
      const renew = () => {
        renewTimer.current = setTimeout(async () => {
          if (active !== generation.current || !ticketRef.current) return
          try { ticketRef.current = await renewSession(botId, ticket.sessionId); renew() }
          catch (failure) { recorder.invalidate('ROUTINE_DESKTOP_DISCONNECTED'); streamRef.current?.close(); setState({ status: 'error', mode: 'watch', error: `桌面授权续期失败：${failure.message}` }) }
        }, Math.max(1000, (ticketRef.current?.expiresAt ?? Date.now() + 60000) - Date.now() - 15000))
      }
      renew()
    } catch (failure) { if (active === generation.current) setState({ status: 'error', mode: 'watch', error: String(failure?.message ?? failure) }) }
  }, [stop, botId, machineId, displayId, openSession, closeSession, renewSession, draw])
  useEffect(() => { return () => { void stop() } }, [stop])
  useEffect(() => {
    const lost = () => release()
    window.addEventListener('blur', lost); document.addEventListener('visibilitychange', lost)
    return () => { window.removeEventListener('blur', lost); document.removeEventListener('visibilitychange', lost) }
  }, [release])
  const point = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    try { return framePoint({ clientX: event.clientX - rect.left, clientY: event.clientY - rect.top, rect, frame: size.current }) }
    catch { return null }
  }
  const pointer = (event, action) => {
    if (state.mode !== 'control') return
    const position = point(event); if (!position) return
    event.preventDefault()
    const packet = { type: 'pointer', action, ...position, button: ['left', 'middle', 'right'][event.button] ?? 'left' }
    if (action === 'move') {
      pendingMove.current = packet
      if (moveTimer.current === null) moveTimer.current = requestAnimationFrame(() => { moveTimer.current = null; if (pendingMove.current) streamRef.current?.input(pendingMove.current); pendingMove.current = null })
    } else {
      if (action === 'down') { event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId) }
      streamRef.current?.input(packet)
    }
  }
  const keyboard = (event, action) => {
    if (state.mode !== 'control' || event.isComposing) return
    event.preventDefault(); event.stopPropagation()
    streamRef.current?.input({ type: 'key', action, code: event.code, key: event.key })
  }
  const screen = (ref, big = false) => <canvas ref={ref} tabIndex={0} aria-label="远程桌面，取得控制权后可用鼠标键盘操作" className={big ? 'bp-stream-canvas bp-stream-large' : 'bp-stream-canvas'}
    onPointerMove={event => pointer(event, 'move')} onPointerDown={event => pointer(event, 'down')} onPointerUp={event => pointer(event, 'up')}
    onPointerCancel={release} onLostPointerCapture={event => { if (event.buttons) release() }} onBlur={release} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => keyboard(event, 'down')} onKeyUp={event => keyboard(event, 'up')}
    onPaste={event => { if (state.mode === 'control') { event.preventDefault(); streamRef.current?.input({ type: 'text', text: event.clipboardData.getData('text/plain') }) } }}
    onWheel={event => { if (state.mode === 'control') { event.preventDefault(); streamRef.current?.input({ type: 'wheel', deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) }) } }} />
  const controls = <div className="bp-actions">
    <button disabled={state.status !== 'connected' || state.mode === 'watch'} onClick={() => { release(); streamRef.current?.setMode('watch') }}>仅观看</button>
    <button disabled={state.status !== 'connected' || state.mode === 'control' || !canControl} onClick={() => streamRef.current?.setMode('control')}>取得控制权</button>
    <span role="status">{state.mode === 'control' ? '你正在控制这台电脑' : '仅观看'}</span></div>
  return <section className="bp-desktop-viewer"><div className="bp-card-title"><h3>远程桌面</h3><span>{STATUS[state.status] ?? state.status}</span></div>
    <div className="bp-actions"><select aria-label="远程桌面电脑" value={machineId} onChange={event => { void stop(); setMachineId(event.target.value); setDisplayId(''); setState({ status: 'idle', mode: 'watch' }) }}>
      {machines.map(item => <option key={item.machineId ?? item.id} value={item.machineId ?? item.id}>{item.label ?? item.name ?? item.machineId ?? item.id}</option>)}</select>
      {displays.length > 1 && <select aria-label="远程显示器" value={displayId} onChange={event => { void stop(); setDisplayId(event.target.value); setState({ status: 'idle', mode: 'watch' }) }}>
        <option value="">主显示器</option>{displays.map(display => <option key={display.id ?? display.displayId} value={display.id ?? display.displayId}>{display.name ?? display.id ?? display.displayId}</option>)}</select>}
      <button disabled={!machineId || !botId || ['connecting', 'authenticating'].includes(state.status)} onClick={() => { void connect() }}>{state.status === 'connected' ? '重新连接' : '连接桌面'}</button>
      <button disabled={!ticketRef.current} onClick={() => { void stop().then(result => setState(result?.stopConfirmed === true ? { status: 'idle', mode: 'watch' }
        : { status: 'error', mode: 'watch', error: '画面连接已关闭，但远端尚未确认释放输入，请检查远程电脑。' })) }}>断开</button></div>
    {state.error && <p className="bp-error" role="alert">{state.error}</p>}{controls}
    <div className="bp-stream-screen" onDoubleClick={() => { if (state.mode === 'watch') setExpanded(true) }}>{screen(canvasRef)}</div>
    <div className="bp-actions"><small>{stats.width ? `${stats.width} × ${stats.height} · ${stats.fps} 帧/秒${stats.frameWidth && stats.frameWidth !== stats.width ? ` · 传输 ${stats.frameWidth} × ${stats.frameHeight}` : ''}` : '连接后显示整台电脑的桌面。'}</small><button onClick={() => setExpanded(true)}>放大</button></div>
    {state.mode === 'control' && <div className="bp-actions"><input aria-label="发送到远程电脑的文字" value={text} onChange={event => setText(event.target.value)} placeholder="中文或多行文字" />
      <button disabled={!text} onClick={() => { if (streamRef.current?.input({ type: 'text', text })) setText('') }}>发送文字</button></div>}
    {typeof saveRoutine === 'function' && <RoutineCaptureControls recorder={recorder} sessionId={ticketRef.current?.sessionId} metadata={metadata}
      mode={state.mode} connected={state.status === 'connected'} drainInputs={() => streamRef.current?.drain()}
      releaseInput={() => streamRef.current?.releaseInput()} saveRoutine={routine => saveRoutine(botId, routine)} />}
    {expanded && <div className="bp-stream-overlay" role="dialog" aria-modal="true" aria-label="远程桌面放大"><div className="bp-stream-dialog"><div className="bp-actions">{controls}
      <button onClick={() => { release(); setExpanded(false) }}>关闭放大</button></div>{screen(largeRef, true)}</div></div>}
  </section>
}

export function DesktopPane({ bot }) {
  const api = globalThis.__dshDesktop
  const [machines, setMachines] = useState([]), [error, setError] = useState('')
  useEffect(() => { let active = true; Promise.resolve(api?.machines?.(bot.id)).then(rows => { if (active) setMachines(rows ?? []) }, failure => { if (active) setError(failure.message) }); return () => { active = false } }, [api, bot.id])
  if (!api?.open) return <p className="bp-muted">桌面通道尚未就绪。</p>
  if (error) return <p role="alert">{error}</p>
  if (!machines.length) return <p className="bp-muted">在“远程电脑”中配对电脑并为这个 Bot 授权。</p>
  return <DesktopViewer key={bot.id} botId={bot.id} machines={machines} openSession={api.open} renewSession={api.renew} closeSession={api.close} saveRoutine={api.saveRoutine} />
}

export function DesktopWorkbench({ snapshot, dispatch }) {
  const bots = snapshot.bots ?? [], [botId, setBotId] = useState(bots[0]?.id ?? '')
  const machines = (snapshot.machines?.items ?? []).filter(item => item.status !== 'revoked')
  const current = useRef({ dispatch, machines }); current.current = { dispatch, machines }
  const openSession = useCallback((id, machineId, options) => current.current.dispatch('machine.desktop.open', { botId: id, machineId, rootId: rootOf(current.current.machines.find(item => item.id === machineId)), ...options }), [])
  const renewSession = useCallback((id, sessionId) => current.current.dispatch('machine.desktop.renew', { botId: id, sessionId }), [])
  const closeSession = useCallback((id, sessionId) => current.current.dispatch('machine.desktop.close', { botId: id, sessionId }), [])
  const saveRoutine = useCallback((id, routine) => current.current.dispatch('routine.save', { botId: id, routine }), [])
  return <section className="bp-card"><label>以哪个 Bot 连接<select value={botId} onChange={event => setBotId(event.target.value)}>{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name ?? bot.id}</option>)}</select></label>
    <DesktopViewer key={botId} botId={botId} machines={machines} openSession={openSession} renewSession={renewSession} closeSession={closeSession} saveRoutine={saveRoutine} /></section>
}
