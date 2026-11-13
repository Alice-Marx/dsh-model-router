import React, { useCallback, useEffect, useRef, useState } from 'react'
import { framePoint, desktopKeyboardInput } from '../../packages/orchestration/src/desktop-contract.mjs'
import { connectDesktopStream } from './desktop-stream.mjs'
import { createAcknowledgedRoutineRecorder } from './routine-recorder.mjs'
import { RoutineCaptureControls } from './routines-panel.jsx'
import { UiIcon } from './ui-icons.jsx'
import { DesktopTools } from './desktop-tools.jsx'
import { sendDesktopKeys, sendDesktopText } from './desktop-keyboard.mjs'
import { createDesktopTouchTracker } from './desktop-touch.mjs'

const rootOf = machine => typeof machine?.roots?.[0] === 'string' ? machine.roots[0] : machine?.rootId ?? machine?.roots?.[0]?.id ?? ''
const STATUS = { idle: '未连接', connecting: '连接中', authenticating: '验证中', connected: '已连接', releasing: '归还控制中', disconnected: '已断开', error: '连接异常' }

export function DesktopViewer({ botId, machines, openSession, renewSession, closeSession, saveRoutine, transport }) {
  const [machineId, setMachineId] = useState(machines[0]?.machineId ?? machines[0]?.id ?? '')
  const [displayId, setDisplayId] = useState('')
  const [displays, setDisplays] = useState([])
  const [state, setState] = useState({ status: 'idle', mode: 'watch' })
  const [expanded, setExpanded] = useState(false)
  const [stats, setStats] = useState({ fps: 0, width: 0, height: 0 })
  const [text, setText] = useState('')
  const [toolsOpen,setToolsOpen]=useState(false),[keyboardBusy,setKeyboardBusy]=useState(false),[keyboardError,setKeyboardError]=useState('')
  const [fit,setFit]=useState(true),[fullscreen,setFullscreen]=useState(false)
  const [metadata, setMetadata] = useState({})
  const recorderRef = useRef(null)
  if (!recorderRef.current) recorderRef.current = createAcknowledgedRoutineRecorder()
  const recorder = recorderRef.current
  const canvasRef = useRef(null), largeRef = useRef(null), streamRef = useRef(null), ticketRef = useRef(null)
  const pendingStop=useRef(null),stopAttempt=useRef(null)
  const connecting=useRef(false)
  const generation = useRef(0), pendingFrame = useRef(null), drawing = useRef(false)
  const surface = useRef(null)
  const size = useRef({ width: 0, height: 0 }), rate = useRef({ at: performance.now(), count: 0 })
  const renewTimer = useRef(null), moveTimer = useRef(null), pendingMove = useRef(null)
  const [canControl, setCanControl] = useState(false)
  const touches=useRef(null);if(!touches.current)touches.current=createDesktopTouchTracker()
  const viewerRef=useRef(null),dialogRef=useRef(null),expandButton=useRef(null),toolsButton=useRef(null),keyboardPending=useRef(false),stateRef=useRef(state)
  stateRef.current=state
  const closeRef = useRef(closeSession)
  closeRef.current = closeSession
  useEffect(() => { if (!machineId && machines[0]) setMachineId(machines[0].machineId ?? machines[0].id) }, [machines, machineId])
  const release = useCallback((options={}) => {if(!options.keepTouches)touches.current.clear(); pendingMove.current = null; void streamRef.current?.releaseInput()?.catch(() => {}) }, [])
  const stop = useCallback(async () => {
    recorder.invalidate('ROUTINE_DESKTOP_DISCONNECTED')
    generation.current++; clearTimeout(renewTimer.current); renewTimer.current = null
    setKeyboardBusy(false);keyboardPending.current=false
    if (moveTimer.current !== null) cancelAnimationFrame(moveTimer.current)
    moveTimer.current = null; pendingMove.current = null; pendingFrame.current = null
    touches.current.clear()
    size.current = { width: 0, height: 0 }
    streamRef.current?.close(); streamRef.current = null
    const ticket = ticketRef.current; ticketRef.current = null
    if(ticket)pendingStop.current={botId,sessionId:ticket.sessionId,close:closeRef.current}
    if(pendingStop.current){
      if(stopAttempt.current)return stopAttempt.current
      const target=pendingStop.current
      const attempt=(async()=>{try{const result=await target.close(target.botId,target.sessionId);if(result?.stopConfirmed===true&&pendingStop.current===target)pendingStop.current=null;return result}catch{return {stopConfirmed:false}}})()
      stopAttempt.current=attempt
      try{return await attempt}finally{if(stopAttempt.current===attempt)stopAttempt.current=null}
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
    if(connecting.current)return
    connecting.current=true
    try{
    const stopped=await stop()
    if(stopped?.stopConfirmed!==true){setState({status:'error',mode:'watch',error:'上一桌面尚未确认释放输入。请点击“断开”核对原会话，再连接电脑。'});return}
    const active = generation.current
    setState({ status: 'connecting', mode: 'watch' }); setStats({ fps: 0, width: 0, height: 0 })
    try {
      const ticket = await openSession(botId, machineId, { ...(displayId ? { displayId } : {}), mode: 'watch', fps: 15 })
      if (active !== generation.current) {pendingStop.current={botId,sessionId:ticket.sessionId,close:closeSession};const closed=await stop();if(closed?.stopConfirmed!==true)setState({status:'error',mode:'watch',error:'已取消连接，远端释放尚未确认，请核对原会话。'});return }
      ticketRef.current = ticket; setCanControl(ticket.canControl === true)
      if (ticket.displays?.length) setDisplays(ticket.displays)
      streamRef.current = connectDesktopStream({ ticket, botId, transport, onFrame: draw,
        onBeforeInput: (event, meta) => recorder.inputSent(event, meta),
        onInputAcknowledged: (event, meta) => recorder.inputAcknowledged(event, meta),
        onInputFailure: (event, meta) => recorder.inputFailed(event, meta),
        onBeforeRelease: meta=>recorder.releaseSent(meta),
        onReleaseAcknowledged: meta=>recorder.releaseAcknowledged(meta),
        onReleaseFailure: meta=>recorder.releaseFailed(meta),
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
    }finally{connecting.current=false}
  }, [stop, botId, machineId, displayId, openSession, closeSession, renewSession, draw, transport])
  useEffect(() => { return () => { void stop() } }, [stop])
  useEffect(()=>{const update=()=>setFullscreen(Boolean(document.fullscreenElement&&viewerRef.current?.contains(document.fullscreenElement)));document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update)},[])
  useEffect(()=>{
    if(!expanded)return
    if(surface.current&&largeRef.current){largeRef.current.width=surface.current.width;largeRef.current.height=surface.current.height;largeRef.current.getContext('2d')?.drawImage(surface.current,0,0)}
    const previous=document.activeElement,overflow=document.body.style.overflow
    document.body.style.overflow='hidden';dialogRef.current?.querySelector('button')?.focus()
    return()=>{if(document.body.style.overflow==='hidden')document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()}
  },[expanded])
  useEffect(() => {
    const lost = () => release()
    window.addEventListener('blur', lost); document.addEventListener('visibilitychange', lost)
    return () => { window.removeEventListener('blur', lost); document.removeEventListener('visibilitychange', lost) }
  }, [release])
  useEffect(()=>{
    const wheel=event=>{
      if(stateRef.current.mode!=='control')return
      event.preventDefault()
      const scale=event.deltaMode===1?16:event.deltaMode===2?window.innerHeight:1
      const deltaX=Math.max(-4800,Math.min(4800,Math.round(event.deltaX*scale))),deltaY=Math.max(-4800,Math.min(4800,Math.round(event.deltaY*scale)))
      if(deltaX||deltaY)streamRef.current?.input({type:'wheel',deltaX,deltaY})
    }
    const canvases=[canvasRef.current,largeRef.current].filter(Boolean)
    for(const canvas of canvases)canvas.addEventListener('wheel',wheel,{passive:false})
    return()=>{for(const canvas of canvases)canvas.removeEventListener('wheel',wheel)}
  },[expanded])
  const point = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    try { return framePoint({ clientX: event.clientX - rect.left, clientY: event.clientY - rect.top, rect, frame: size.current }) }
    catch { return null }
  }
  const pointer = (event, action) => {
    if (state.mode !== 'control') return
    if(action==='down'&&event.pointerType==='touch')try{event.currentTarget.setPointerCapture?.(event.pointerId)}catch{}
    const gesture=touches.current.handle(action,event)
    if(gesture.handled){event.preventDefault();if(gesture.release)release({keepTouches:true});if(gesture.wheel)streamRef.current?.input(gesture.wheel);return}
    const position = point(event); if (!position) {if(action==='up'){event.preventDefault();release()};return}
    event.preventDefault()
    const packet = { type: 'pointer', action, ...position, button: ['left', 'middle', 'right'][event.button] ?? 'left' }
    if (action === 'move') {
      pendingMove.current = packet
      if (moveTimer.current === null) moveTimer.current = requestAnimationFrame(() => { moveTimer.current = null; if (pendingMove.current) streamRef.current?.input(pendingMove.current); pendingMove.current = null })
    } else {
      if(moveTimer.current!==null){cancelAnimationFrame(moveTimer.current);moveTimer.current=null;if(pendingMove.current)streamRef.current?.input(pendingMove.current);pendingMove.current=null}
      if (action === 'down') { event.currentTarget.focus({ preventScroll: true });try{event.currentTarget.setPointerCapture?.(event.pointerId)}catch{} }
      streamRef.current?.input(packet)
    }
  }
  const keyboard = (event, action) => {
    if (state.mode !== 'control' || event.isComposing || event.nativeEvent?.isComposing || event.keyCode===229) return
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v'){event.stopPropagation();return}
    event.preventDefault(); event.stopPropagation()
    const input = desktopKeyboardInput(event, action)
    if (input) streamRef.current?.input(input)
  }
  const keyboardAction=async work=>{
    if(keyboardPending.current||stateRef.current.status!=='connected'||stateRef.current.mode!=='control')return
    const stream=streamRef.current,active=generation.current;keyboardPending.current=true;setKeyboardBusy(true);setKeyboardError('')
    const current=()=>active===generation.current&&stream===streamRef.current&&stateRef.current.mode==='control'
    try{await work(stream,current)}catch(failure){if(active===generation.current)setKeyboardError(`远端尚未确认这次输入：${failure.message}。请检查电脑，不会自动重发。`)}
    finally{if(active===generation.current){keyboardPending.current=false;setKeyboardBusy(false)}}
  }
  const submitText=()=>{const value=text;void keyboardAction(async(stream,current)=>{await sendDesktopText(stream,value,current);if(current())setText(before=>before===value?'':before)})}
  const localPaste=async()=>{const active=generation.current;try{if(!navigator.clipboard?.readText)throw new Error('请直接粘贴到上方文本框。');const value=await navigator.clipboard.readText();if(active!==generation.current)return;if(value.length>8192)throw new Error('本机文字超过 8192 字，请分段粘贴。');setText(value);setKeyboardError('')}catch(failure){if(active===generation.current)setKeyboardError(`无法读取本机剪贴板：${failure.message}`)}}
  const closeTools=()=>{setToolsOpen(false);toolsButton.current?.focus()}
  const toggleFullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await (dialogRef.current??viewerRef.current).requestFullscreen()}catch{setKeyboardError('无法进入系统全屏，请使用放大视图。');setToolsOpen(true)}}
  const tools=<DesktopTools open={toolsOpen} onClose={closeTools} connected={state.status==='connected'} canInput={state.mode==='control'} text={text} onText={setText} onSend={submitText} onPaste={()=>{void localPaste()}}
    onShortcut={keys=>{void keyboardAction((stream,current)=>sendDesktopKeys(stream,keys,current))}} working={keyboardBusy} error={keyboardError}/>
  const screen = (ref, big = false) => <canvas ref={ref} tabIndex={0} aria-label="远程桌面，取得控制权后可用鼠标键盘操作" data-control={state.mode==='control'} className={big ? 'bp-stream-canvas bp-stream-large' : 'bp-stream-canvas'}
    style={!fit&&size.current.width?{width:size.current.width,maxWidth:'none',maxHeight:'none'}:undefined}
    onPointerMove={event => pointer(event, 'move')} onPointerDown={event => pointer(event, 'down')} onPointerUp={event => pointer(event, 'up')}
    onPointerCancel={release} onLostPointerCapture={event => { if (event.buttons) release() }} onBlur={release} onContextMenu={event => event.preventDefault()}
    onPointerLeave={event=>{if(event.buttons&&!event.currentTarget.hasPointerCapture?.(event.pointerId))release()}}
    onKeyDown={event => keyboard(event, 'down')} onKeyUp={event => keyboard(event, 'up')}
    onPaste={event => { if (state.mode === 'control') { event.preventDefault();const value=event.clipboardData.getData('text/plain');void keyboardAction((stream,current)=>sendDesktopText(stream,value,current)) } }}
    />
  const controls = <div className="bp-actions">
    <button disabled={state.status !== 'connected' || state.mode === 'watch'} onClick={() => { release(); streamRef.current?.setMode('watch') }}>仅观看</button>
    <button className={state.mode==='control'?'':'bp-button-primary'} disabled={state.status !== 'connected' || state.mode === 'control' || !canControl} onClick={() => streamRef.current?.setMode('control')}>取得控制权</button>
    <span className="bp-desktop-control-status" data-mode={state.mode} role="status">{state.mode === 'control' ? '你正在控制这台电脑' : '仅观看'}</span></div>
  const toolbar=<div className="bp-desktop-toolbar">{controls}<div className="bp-desktop-view-tools"><button ref={toolsButton} type="button" aria-label="键盘与文字" aria-expanded={toolsOpen} onClick={()=>{release();setToolsOpen(value=>!value)}}><UiIcon name="keyboard"/></button>
    <button type="button" aria-label={fit?'原始尺寸':'适应窗口'} title={fit?'原始尺寸':'适应窗口'} aria-pressed={!fit} onClick={()=>setFit(value=>!value)}><UiIcon name="fit"/></button>
    {typeof document.documentElement.requestFullscreen==='function'&&<button type="button" aria-label={fullscreen?'退出系统全屏':'系统全屏'} title={fullscreen?'退出系统全屏':'系统全屏'} onClick={()=>{void toggleFullscreen()}}><UiIcon name="expand"/></button>}</div></div>
  return <section ref={viewerRef} className="bp-desktop-viewer"><div className="bp-card-title"><h3><UiIcon name="computer" size={16} /> 远程桌面</h3><span className="bp-desktop-status" data-connected={state.status === 'connected'}>{STATUS[state.status] ?? state.status}</span></div>
    <div className="bp-actions"><select aria-label="远程桌面电脑" value={machineId} onChange={event => { void stop(); setMachineId(event.target.value);setText('');setToolsOpen(false);setKeyboardError(''); setDisplayId(''); setState({ status: 'idle', mode: 'watch' }) }}>
      {machines.map(item => <option key={item.machineId ?? item.id} value={item.machineId ?? item.id}>{item.label ?? item.name ?? item.machineId ?? item.id}</option>)}</select>
      {displays.length > 1 && <select aria-label="远程显示器" value={displayId} onChange={event => { void stop(); setDisplayId(event.target.value); setState({ status: 'idle', mode: 'watch' }) }}>
        <option value="">主显示器</option>{displays.map(display => <option key={display.id ?? display.displayId} value={display.id ?? display.displayId}>{display.name ?? display.id ?? display.displayId}</option>)}</select>}
      <button className="bp-button-primary" disabled={!machineId || !botId || ['connecting', 'authenticating'].includes(state.status)} onClick={() => { void connect() }}>{state.status === 'connected' ? '重新连接' : '连接桌面'}</button>
      <button disabled={!ticketRef.current&&!pendingStop.current} onClick={() => { void stop().then(result => setState(result?.stopConfirmed === true ? { status: 'idle', mode: 'watch' }
        : { status: 'error', mode: 'watch', error: '画面连接已关闭，但远端尚未确认释放输入，请检查远程电脑。' })) }}>断开</button></div>
    {state.error && <p className="bp-error" role="alert">{state.error}</p>}{!expanded&&toolbar}
    <div className="bp-stream-screen" data-fit={fit} data-connected={state.status === 'connected'} onDoubleClick={() => { if (state.mode === 'watch') setExpanded(true) }}>{screen(canvasRef)}
      {state.status !== 'connected' && <div className="bp-desktop-idle"><UiIcon name="computer" size={34} /><strong>{['connecting', 'authenticating'].includes(state.status) ? '正在连接你的电脑…' : '你的电脑，就在这里'}</strong><span>连接后查看实时桌面，或取得鼠标键盘控制权</span></div>}
    </div>
    <div className="bp-actions"><small>{stats.width ? `${stats.width} × ${stats.height} · ${stats.fps} 帧/秒${stats.frameWidth && stats.frameWidth !== stats.width ? ` · 传输 ${stats.frameWidth} × ${stats.frameHeight}` : ''}` : '连接后显示整台电脑的桌面。'}</small><button ref={expandButton} onClick={() => setExpanded(true)}><UiIcon name="expand" size={15}/>放大</button></div>
    {state.mode==='control'&&<p className="bp-desktop-touch-hint">手机单指操作，双指滚动；离开画面会释放按键和鼠标。</p>}
    {!expanded&&tools}
    {typeof saveRoutine === 'function' && <RoutineCaptureControls recorder={recorder} sessionId={ticketRef.current?.sessionId} metadata={metadata}
      mode={state.mode} connected={state.status === 'connected'} drainInputs={() => streamRef.current?.drain()}
      releaseInput={() => streamRef.current?.releaseInput()} saveRoutine={routine => saveRoutine(botId, routine)} />}
    {expanded && <div className="bp-stream-overlay" role="dialog" aria-modal="true" aria-label="远程桌面放大" ref={dialogRef} onKeyDown={event=>{
      if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();release();setToolsOpen(false);setExpanded(false)}
      if(event.key==='Tab'){const focusable=[...dialogRef.current.querySelectorAll('button:not(:disabled),textarea,canvas,[tabindex="0"]')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }}><div className="bp-stream-dialog"><header className="bp-desktop-expanded-header"><strong><UiIcon name="computer"/>{machines.find(item=>(item.machineId??item.id)===machineId)?.label??'远程电脑'}</strong><span className="bp-desktop-status" data-connected={state.status==='connected'}>{STATUS[state.status]??state.status}</span><button onClick={() => { release();setToolsOpen(false);setExpanded(false) }}>关闭放大</button></header>{toolbar}<div className="bp-desktop-expanded-stage" data-fit={fit}>{screen(largeRef, true)}{tools}</div></div></div>}
  </section>
}

export function DesktopPane({ bot }) {
  const api = globalThis.__dshDesktop
  const [machines, setMachines] = useState([]), [error, setError] = useState('')
  useEffect(() => { let active = true; Promise.resolve(api?.machines?.(bot.id)).then(rows => { if (active) setMachines(rows ?? []) }, failure => { if (active) setError(failure.message) }); return () => { active = false } }, [api, bot.id])
  if (!api?.open) return <p className="bp-muted">桌面通道尚未就绪。</p>
  if (error) return <p role="alert">{error}</p>
  if (!machines.length) return <p className="bp-muted">在“远程电脑”中配对电脑并为这个 Bot 授权。</p>
  return <DesktopViewer key={bot.id} botId={bot.id} machines={machines} openSession={api.open} renewSession={api.renew} closeSession={api.close} saveRoutine={api.saveRoutine} transport={api.transport} />
}

export function DesktopWorkbench({ snapshot, dispatch, transport }) {
  const bots = snapshot.bots ?? [], [botId, setBotId] = useState(bots[0]?.id ?? '')
  const machines = (snapshot.machines?.items ?? []).filter(item => item.status !== 'revoked')
  const current = useRef({ dispatch, machines }); current.current = { dispatch, machines }
  const openSession = useCallback((id, machineId, options) => current.current.dispatch('machine.desktop.open', { botId: id, machineId, rootId: rootOf(current.current.machines.find(item => item.id === machineId)), ...options }), [])
  const renewSession = useCallback((id, sessionId) => current.current.dispatch('machine.desktop.renew', { botId: id, sessionId }), [])
  const closeSession = useCallback((id, sessionId) => current.current.dispatch('machine.desktop.close', { botId: id, sessionId }), [])
  const saveRoutine = useCallback((id, routine) => current.current.dispatch('routine.save', { botId: id, routine }), [])
  if (!machines.length) return <section className="bp-card"><div className="bp-empty-state"><span className="bp-empty-icon"><UiIcon name="computer" size={29} /></span><strong>连接你的第一台电脑</strong><p>在另一台电脑的 Bot 插件中开启远程访问，再导入邀请，即可在这里连接共享文件和桌面。</p><div className="bp-actions"><button className="bp-button-primary" onClick={() => { const setup = document.querySelector('.bp-secure-pairing'); if (setup) { setup.open = true; setup.scrollIntoView({ block: 'start', behavior: 'smooth' }) } }}>配对另一台电脑</button></div></div></section>
  return <section className="bp-card"><div className="bp-actions" style={{ marginBottom: 20 }}><label>连接身份<select value={botId} onChange={event => setBotId(event.target.value)}>{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name ?? bot.id}</option>)}</select></label></div>
    <DesktopViewer key={botId} botId={botId} machines={machines} openSession={openSession} renewSession={renewSession} closeSession={closeSession} saveRoutine={saveRoutine} transport={transport} /></section>
}
