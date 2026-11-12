import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ComposerDraftHost } from './composer-draft-host.jsx'
import { createIndependentChatController } from './independent-chat-controller.mjs'
import { independentChatNavigation } from './independent-chat-navigation.mjs'
import { readWithDeadline } from './independent-chat-entry.jsx'
export { IndependentChatEntry, BotConversationLink } from './independent-chat-entry.jsx'
import { BotSettingsDialog } from './bot-settings-dialog.jsx'
import { UiIcon } from './ui-icons.jsx'
import { botModelStatus } from './bot-model-status.mjs'
import { requestWorkbenchView } from '../../.dsh-plugin/client/workbench-state.mjs'
import { IndependentRichMessage } from './independent-chat-rich.jsx'
import { independentToolRelations } from './independent-chat-rich.mjs'
import { NativeActivityCardView, useNativeActivity } from './native-activity.jsx'

let nextScope = 0
export function IndependentChatPage(props) {
  const scope = useMemo(() => ++nextScope, [props.productApi])
  return <ChatDirectory key={scope} {...props}/>
}

function ChatDirectory({ productApi, openPanel, openSession }) {
  const navigation = useMemo(() => independentChatNavigation(productApi), [productApi])
  const route = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const [directory, setDirectory] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const reconnect = useCallback(() => { setDirectory(null); setAttempt(value => value + 1) }, [])
  useEffect(() => {
    let live = true, timer, controller
    const load = async () => {
      controller = new AbortController()
      try {
        const snapshot = await readWithDeadline(() => productApi.snapshot(controller.signal), controller)
        if (!live) return
        if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.bots)) throw new Error('宿主未返回 Bot 联系人。')
        setDirectory(snapshot); setError('')
      } catch (cause) { if (live) setError(String(cause?.message ?? cause)) }
      finally { if (live) timer = setTimeout(load, 4000) }
    }
    void load()
    return () => { live = false; controller?.abort(); clearTimeout(timer) }
  }, [productApi, attempt])
  const bots = directory?.bots ?? [], selected = route?.botId ?? directory?.mainBotId ?? bots[0]?.id
  const bot = bots.find(row => row.id === selected)
  return <section className="ic-shell" aria-label="独立 Bot 聊天">
    <aside className="ic-contacts"><div className="ic-contact-title"><UiIcon name="team" size={19}/><strong>Bot 伙伴</strong></div>
      <nav aria-label="独立聊天联系人">{bots.map(row => <button key={row.id} type="button" aria-current={row.id === selected ? 'page' : undefined} onClick={() => navigation.select(row.id)}><span className="ic-avatar"><UiIcon name="bot" size={21}/></span><span><strong>{row.name || row.id}</strong><small>{row.role || '和你的 Bot 一起工作'}</small></span></button>)}</nav>
      <button className="ic-team-link" type="button" onClick={() => openPanel?.('bot-product-bindings')}>管理团队<UiIcon name="chevron" size={14}/></button>
    </aside>
    <div className="ic-conversation">{error ? <div className="ic-alert" role="alert">无法读取当前宿主联系人：{error}<button type="button" onClick={() => { setDirectory(null); setAttempt(value => value + 1) }}>重试连接</button></div>
      : !directory ? <p className="ic-placeholder" role="status">正在连接 Bot 伙伴…</p>
      : !bot ? <p className="ic-placeholder" role="status">当前宿主中没有这个 Bot。请从联系人重新选择。</p>
      : <ComposerDraftHost productApi={productApi} attempt={attempt}>{({ hostId, status, error: namespaceError }) => status === 'ready'
        ? <ChatConversation key={`${hostId}:${bot.id}`} productApi={productApi} hostId={hostId} bot={bot} readOnly={directory.readOnly} nativeActivityAvailable={directory.availableActions?.includes('nativeActivity.list') === true} openSession={openSession} openPanel={openPanel} onHostChanged={reconnect}/>
        : <div className="ic-placeholder" role="status">{status === 'error' ? <>{namespaceError}<button type="button" onClick={() => setAttempt(value => value + 1)}>重试连接</button></> : '正在确认当前宿主…'}</div>}</ComposerDraftHost>}
    </div>
  </section>
}

const requestText = request => {
  if (request?.operationKind === 'new-conversation') {
    if (request.state === 'succeeded') return '新对话已开启，旧记录已保留。'
    if (['accepted', 'running'].includes(request.state)) return '正在开启新对话，核对旧会话的停止状态…'
    return '新对话结果尚未确认，请核对原操作；旧聊天记录保留。'
  }
  if (!request) return '发送结果尚未确认。请核对原请求；不会自动重发。'
  if (request.state === 'succeeded') return request.cancelRequested ? '回复已提交；之前已请求停止。' : '回复已提交。'
  if (request.cancelRequested) return request.finished ? '本地回合已结算，已请求停止；工具停止尚未确认。' : '已请求停止，正在核对回合结果；工具停止尚未确认。'
  if (request.state === 'accepted') return '消息已保存，等待 Bot 回复…'
  if (request.state === 'running') return 'Bot 正在处理…'
  if (request.state === 'unknown') return request.pending ? '原宿主的回合可能仍在运行，请核对原请求。' : '回合结果未知，请检查已有消息与工具记录后再决定是否恢复文字。'
  if (request.state === 'refused') return '宿主拒绝了这次发送，可以恢复文字后修改。'
  return '本地回合已结算，可以恢复文字；工具停止尚未确认。'
}

function ChatConversation({ productApi, hostId, bot, readOnly, nativeActivityAvailable, openSession, openPanel, onHostChanged }) {
  const controller = useMemo(() => createIndependentChatController({ api: productApi, hostId, botId: bot.id, onHostChanged }), [productApi, hostId, bot.id, onHostChanged])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [settings, setSettings] = useState(false), [following, setFollowing] = useState(true)
  const scroll = useRef(null), input = useRef(null), composition = useRef(false), olderPosition = useRef(null)
  useEffect(() => { controller.start(); return () => controller.dispose() }, [controller])
  const pending = state.pending, request = pending?.status ?? state.lastRequest
  const progress = !state.loading && !state.error && state.view?.available && pending?.status?.state === 'running' && !pending.status.cancelRequested ? pending.status.progress : null
  const contextOperation = pending?.operationKind === 'new-conversation' || request?.operationKind === 'new-conversation'
  const knownPending = pending && ['accepted', 'running'].includes(pending.status?.state) && !pending.status.cancelRequested
  const composingNext = knownPending && !contextOperation
  const showRequest = Boolean(pending || (request && (request.state !== 'succeeded' || request.cancelRequested)))
  const model = botModelStatus(bot)
  const toolRelations = useMemo(() => independentToolRelations(state.items), [state.items])
  const canSend = state.view?.available === true && !state.loading && !readOnly && !pending && !state.sending && !state.storageError
  const context = state.view?.context
  // Native tool activity for the context that is actually open. A context change
  // retires the previous read, so another conversation's records never appear here.
  const nativeActivity = useNativeActivity({ productApi, botId: bot.id, mode: 'independent', contextId: context?.contextId, enabled: nativeActivityAvailable })
  const contextBoundary = () => <div className="ic-context-boundary" role="separator" aria-label="新对话，旧聊天记录保留"><span>新对话 · 旧记录保留</span></div>
  useLayoutEffect(() => {
    const node = scroll.current
    if (!node) return
    if (olderPosition.current !== null && !state.loadingOlder) { node.scrollTop += node.scrollHeight - olderPosition.current; olderPosition.current = null }
    else if (following) node.scrollTop = node.scrollHeight
  }, [state.items, state.loadingOlder, progress?.sequence, following, nativeActivity.activity?.revision ?? 0])
  useLayoutEffect(() => {
    const node = scroll.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (following && olderPosition.current === null) node.scrollTop = node.scrollHeight
    })
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    return () => observer.disconnect()
  }, [following])
  const submit = () => { if (canSend && !composition.current) void controller.send() }
  return <>
    <header className="ic-header"><span className="ic-avatar"><UiIcon name="bot" size={22}/></span><div className="ic-heading"><strong>{bot.name || bot.id}</strong><button type="button" className="ic-model" title={`独立聊天 · ${model.title}`} aria-label={`宿主已保存模型：${model.selected ?? '未选择'}，打开模型与工具设置`} data-model-different={model.different ? '' : undefined} onClick={() => setSettings(true)}><UiIcon name="spark" size={12}/><span>宿主已选：{model.selectedLabel ?? '未选择模型'}</span><UiIcon name="chevron" size={10}/></button></div><div className="ic-header-actions">
      {typeof state.view?.newConversationAvailable === 'boolean' && <button type="button" title="开启新对话，保留旧聊天记录" aria-label="开启新对话" disabled={!canSend || !state.view.newConversationAvailable} onClick={() => void controller.newConversation()}><UiIcon name="plus" size={18}/></button>}
      {bot.sessionId && <button type="button" title="打开此 Bot 的原生会话" aria-label="打开此 Bot 的原生会话" onClick={() => openSession?.(bot.sessionId)}><UiIcon name="list" size={18}/></button>}
      <button type="button" title="Bot 设置" aria-label="Bot 设置" onClick={() => setSettings(true)}><UiIcon name="settings" size={18}/></button>
    </div></header>
    {readOnly && <div className="ic-alert" role="alert">当前宿主为只读：{String(readOnly)}</div>}
    {state.view && !state.view.available && <div className="ic-alert" role="status">{state.view.mode === 'integration' ? '这个 Bot 使用原生会话。独立聊天记录保留为只读。' : '当前宿主未完整启用独立聊天，请检查运行时配置。'}{state.view.mode === 'integration' && bot.sessionId && <button type="button" onClick={() => openSession?.(bot.sessionId)}>回到原生会话</button>}</div>}
    <div ref={scroll} className="ic-transcript" role="log" aria-label={`${bot.name || bot.id} 的独立聊天记录`} aria-live="polite" onScroll={() => { const node = scroll.current; setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 90) }}>
      <div className="ic-message-column">{state.nextCursor && <button type="button" className="ic-load-older" disabled={state.loadingOlder} onClick={() => { olderPosition.current = scroll.current.scrollHeight; void controller.older() }}>{state.loadingOlder ? '正在读取…' : '加载较早消息'}</button>}
        {state.items.length === 0 && <div className="ic-empty"><span className="ic-avatar ic-avatar-large"><UiIcon name="bot" size={33}/></span><strong>{bot.name || bot.id}</strong><p>{state.loading ? '正在读取聊天记录…' : '告诉我你想做什么，我们一起开始。'}</p></div>}
        {state.items.map((message, index) => <React.Fragment key={message.messageId}>{index > 0 && message.contextId && message.contextId !== state.items[index - 1].contextId && contextBoundary()}<IndependentRichMessage message={message} botName={bot.name} calls={toolRelations.get(message.messageId)}/></React.Fragment>)}
        {context?.sequence > 0 && !context.resetPending && state.items.at(-1)?.contextId !== context.contextId && contextBoundary()}
        <NativeActivityCardView activity={nativeActivity.activity} controller={nativeActivity.controller} announce={false}/>
        {progress?.text && <article className="ic-streaming" aria-label="正在生成的回复" aria-busy="true"><div className="ic-streaming-caption"><span className="ic-streaming-dot"/>正在生成 · 第 {progress.step} 步 · 尚未完成</div><div className="ic-streaming-text">{progress.text}</div>{progress.truncated && <small>预览已达到显示上限，完整回复会在完成后显示。</small>}</article>}
      </div>
    </div>
    {!following && <button type="button" className="ic-scroll-latest" onClick={() => { setFollowing(true); scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }) }}>回到最新<UiIcon name="chevron" size={13}/></button>}
    <div className="ic-composer-area">
      {(state.error || state.storageError) && <div className="ic-alert" role="alert"><span>{state.storageError || state.error}</span><button type="button" onClick={() => controller.inspect()}>核对原请求</button><button type="button" onClick={() => controller.reloadMessages()}>刷新聊天记录</button></div>}
      {showRequest && <div className={`ic-request${knownPending ? ' ic-request-working' : ''}`} role="status"><span>{requestText(pending ? { ...pending.status, operationKind: pending.operationKind } : request)}</span>{!knownPending && <small>请求编号：{pending?.requestKey ?? request.requestKey}</small>}
        {pending?.status?.errorCode && <small>{pending.status.errorCode}</small>}
        <div className="ic-request-actions">{pending && !knownPending && <button type="button" onClick={() => controller.inspect()}>核对原请求</button>}
          {!contextOperation && pending?.status?.finished === true && pending.status.pending === false && <button type="button" onClick={() => { controller.restore(); input.current?.focus() }}>恢复文字到输入框</button>}
          {!contextOperation && pending?.notFound && <button type="button" onClick={() => controller.releaseNotFound()}>宿主无此请求，恢复文字</button>}
          {!contextOperation && pending?.status?.pending === true && !pending.status.cancelRequested && <button type="button" className="ic-stop" disabled={state.sending} onClick={() => { void controller.cancel() }}><UiIcon name="stop" size={13}/>请求停止</button>}
        </div></div>}
      <form className="ic-composer" onSubmit={event => { event.preventDefault(); submit() }}>
        <label className="ic-sr-only" htmlFor={`independent-message-${bot.id}`}>发消息给 {bot.name || bot.id}</label>
        <textarea ref={input} id={`independent-message-${bot.id}`} value={state.draft} placeholder={composingNext ? 'Bot 正在回复，可先写下一条…' : pending ? '原请求尚未核对，已暂停新的发送' : '发消息…'} rows={2} disabled={!state.view?.available || Boolean(readOnly)} onChange={event => controller.setDraft(event.target.value)} onCompositionStart={() => { composition.current = true }} onCompositionEnd={() => { composition.current = false }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composition.current) { event.preventDefault(); submit() } }}/>
        <div className="ic-composer-footer"><span>文字消息 · Shift + Enter 换行</span><button type="submit" aria-label="发送消息" disabled={!canSend || !state.draft.trim()}><UiIcon name="arrow" size={18}/><span>发送</span></button></div>
      </form>
      <p className="ic-capability-note">此入口发送文字；附件、语音与记忆视图请打开原生会话。<button type="button" onClick={() => openPanel?.('bot-product-machines')}>电脑</button></p>
    </div>
    {settings && <BotSettingsDialog productApi={productApi} botId={bot.id} onClose={() => setSettings(false)} onOpenAi={typeof openPanel === 'function' ? () => { setSettings(false); openPanel('bot-product-ai') } : undefined} onOpenTools={typeof openPanel === 'function' ? async () => { requestWorkbenchView('tools'); await openPanel('model-router-galgame'); setSettings(false) } : undefined}/>} 
  </>
}

