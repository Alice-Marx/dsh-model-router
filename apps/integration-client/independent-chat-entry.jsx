import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import { openIndependentChat } from './independent-chat-navigation.mjs'

let nextScope = 0
export function readWithDeadline(work, controller, ms = 8000) {
  let timer, abort
  const expired = new Promise((_, reject) => {
    abort = () => reject(new Error('当前宿主没有及时回答，请重试连接。'))
    controller.signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => controller.abort(), ms)
  })
  return Promise.race([Promise.resolve().then(work), expired]).finally(() => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort) })
}

/** Native navigation remains usable without loading the independent transcript renderer. */
export function IndependentChatEntry({ productApi, botId, onOpen, openPanel }) {
  const scope = useMemo(() => ++nextScope, [productApi, botId])
  return <ChatEntry key={scope} productApi={productApi} botId={botId} onOpen={onOpen} openPanel={openPanel}/>
}
function ChatEntry({ productApi, botId, onOpen, openPanel }) {
  const [independent, setIndependent] = useState(false)
  useEffect(() => {
    if (!botId || !productApi?.dispatch) return
    let live = true, timer, controller
    const load = async () => {
      controller = new AbortController()
      try { const view = await readWithDeadline(() => productApi.dispatch('independentChat.view', { botId }, controller.signal), controller); if (live) setIndependent(view?.botId === botId && view.mode === 'independent') }
      catch { if (live) setIndependent(false) }
      finally { if (live) timer = setTimeout(load, 4000) }
    }
    void load()
    return () => { live = false; controller?.abort(); clearTimeout(timer) }
  }, [productApi, botId])
  if (!independent) return null
  return <button className="ic-native-entry" type="button" title="此 Bot 已使用独立运行时，请在独立聊天页继续发送" onClick={() => typeof onOpen === 'function' ? onOpen(botId) : openIndependentChat(productApi, openPanel, botId)}><UiIcon name="bot" size={16}/><span>打开独立聊天</span><UiIcon name="arrow" size={14}/></button>
}

export function BotConversationLink({ productApi, bot, openSession, onOpenIndependent, available }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const current = useRef({ live: false, epoch: 0, controller: null, pending: false })
  useEffect(() => { const held = current.current; held.live = true; held.epoch++; held.pending = false; setError(''); setBusy(false); return () => { held.live = false; held.epoch++; held.controller?.abort() } }, [productApi, bot.id])
  const open = async () => {
    const held = current.current, epoch = held.epoch
    if (held.pending || !held.live) return
    held.pending = true
    const controller = new AbortController(); held.controller = controller
    setBusy(true); setError('')
    try {
      if (!available) { openSession?.(bot.sessionId); return }
      const view = await readWithDeadline(() => productApi.dispatch('independentChat.view', { botId: bot.id }, controller.signal), controller)
      if (!held.live || held.epoch !== epoch) return
      if (view?.botId !== bot.id) throw new Error('宿主返回的 Bot 身份不匹配。')
      if (view.mode === 'independent') onOpenIndependent?.(bot.id)
      else if (view.mode === 'integration') openSession?.(bot.sessionId)
      else throw new Error('宿主未确认当前运行时，请检查连接后重试。')
    } catch (cause) { if (held.live && held.epoch === epoch) setError(String(cause?.message ?? cause)) }
    finally { if (held.live && held.epoch === epoch) { held.pending = false; setBusy(false) } }
  }
  return <div><button className="bp-button-primary" type="button" disabled={busy} onClick={() => { void open() }}>{busy ? '正在打开…' : '打开私聊'}<UiIcon name="arrow" size={15}/></button>{error && <p className="bp-error" role="alert">{error}</p>}</div>
}
