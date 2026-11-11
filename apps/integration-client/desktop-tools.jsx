import React,{useEffect,useRef} from 'react'
import {DESKTOP_SHORTCUTS} from './desktop-keyboard.mjs'
import {UiIcon} from './ui-icons.jsx'

export function DesktopTools({open,onClose,connected,canInput,text,onText,onSend,onPaste,onShortcut,working,error}){
  const panel=useRef(null)
  useEffect(()=>{if(open)panel.current?.querySelector('textarea')?.focus()},[open])
  if(!open)return null
  return <section className="bp-desktop-tools-panel" ref={panel} aria-label="远程键盘与文字" onKeyDown={event=>{
    if(event.key==='Escape'&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){event.preventDefault();event.stopPropagation();onClose()}
  }}><header><strong><UiIcon name="keyboard" size={17}/>键盘与文字</strong><button type="button" onClick={onClose} aria-label="关闭键盘面板"><UiIcon name="close"/></button></header>
    <label>发送到远程电脑<textarea rows={4} maxLength={8192} value={text} onChange={event=>onText(event.target.value)} placeholder="中文、多行文字或本机复制的内容" autoComplete="off" spellCheck={false}/></label>
    <div className="bp-actions"><button type="button" className="bp-button-primary" disabled={!connected||!canInput||!text||working} onClick={onSend}>{working?'等待远端确认…':'发送文字'}</button><button type="button" disabled={working} onClick={onPaste}>读取本机剪贴板</button></div>
    {!canInput&&<p className="bp-muted">取得控制权后可以发送文字和快捷键。</p>}
    {error&&<p className="bp-error" role="alert">{error}</p>}
    <div className="bp-desktop-shortcuts" role="group" aria-label="远程快捷键">{DESKTOP_SHORTCUTS.map(row=><button key={row.label} type="button" disabled={!connected||!canInput||working} onClick={()=>onShortcut(row.keys)}>{row.label}</button>)}</div>
    <p className="bp-muted">本机文字会以键盘输入发送；快捷键“复制 / 粘贴”操作的是远端剪贴板。</p>
  </section>
}
