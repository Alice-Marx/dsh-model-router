import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import { AppearanceControls } from './workspace-ui.jsx'
import { BotSettingsDialog } from './bot-settings-dialog.jsx'
import { botModelStatus } from './bot-model-status.mjs'
import { BotThreadHeader } from './bot-thread-header.jsx'
import { NativeActivityHeader } from './native-activity.jsx'
import { IndependentChatEntry } from './independent-chat-entry.jsx'

let threadHeaderScope = 0

const idOf = value => typeof value === 'string' && value.length > 0 ? value : null
const resources = Object.freeze([
  { section: 'notifications', label: '通知中心', icon: 'bell' },
  { section: 'bindings', label: 'Bot 团队', icon: 'team' },
  { section: 'machines', label: '远程电脑', icon: 'computer' },
  { section: 'library', label: '资料库', icon: 'folder' },
  { section: 'data', label: '数据与图表', icon: 'chart' },
  { section: 'routine', label: '例行工作', icon: 'repeat' },
  { section: 'usage', label: '费用与用量', icon: 'chart' },
])

function useUiAction(identity) {
  const [feedback, setFeedback] = useState(null)
  const current = useRef({ identity, epoch: 0, token: 0, mounted: false, pending: false })
  if (current.current.identity !== identity) {
    current.current.identity = identity
    current.current.epoch += 1
    current.current.pending = false
  }
  useEffect(() => {
    current.current.mounted = true
    return () => {
      current.current.mounted = false
      current.current.epoch += 1
      current.current.pending = false
    }
  }, [])
  const run = (label, action) => {
    const state = current.current
    if (!state.mounted || state.pending) return
    const epoch = state.epoch, token = ++state.token
    state.pending = true
    setFeedback({ identity, pending: label, error: '' })
    const finish = (error, failed = false) => {
      if (!state.mounted || state.identity !== identity || state.epoch !== epoch || state.token !== token) return
      state.pending = false
      setFeedback({ identity, pending: '', error: failed ? `${label}失败：${error?.message ?? String(error ?? '未知错误')}` : '' })
    }
    try { Promise.resolve(action()).then(() => finish(), error => finish(error, true)) }
    catch (error) { finish(error, true) }
  }
  return {
    run,
    pending: feedback?.identity === identity && Boolean(feedback.pending),
    error: feedback?.identity === identity ? feedback.error : '',
    dismiss: () => setFeedback(null),
  }
}

function ActionError({ error, onDismiss, className = '' }) {
  if (!error) return null
  return <div className={`bp-chat-action-error ${className}`} role="alert"><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={onDismiss}><UiIcon name="close" size={14} /></button></div>
}

function closeDetailsOnEscape(event) {
  if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
  const details = event.target.closest?.('details[open]')
  if (!details || !event.currentTarget.contains(details)) return
  event.preventDefault()
  event.stopPropagation()
  details.open = false
  details.querySelector('summary')?.focus()
}

/** Supporting navigation below the native Bot contact list. Destinations only change UI focus. */
export function ContactNavigation({ onNavigate, onOpenAdvanced, compact = false, activeSection, attentionCount, attentionPartial = false, attentionKnown = true, notificationCount = 0, notificationPartial = false, notificationKnown = false }) {
  const [announcedSection, setAnnouncedSection] = useState(null)
  const menu = useRef(null)
  const action = useUiAction('contact-navigation')
  useEffect(() => {
    const change = event => {
      const id = event.detail?.id
      setAnnouncedSection(typeof id === 'string' && id.startsWith('bot-product-') ? id.slice('bot-product-'.length) : id === 'model-router-galgame' ? 'advanced' : null)
    }
    document.addEventListener('bot-product:navigation', change)
    return () => document.removeEventListener('bot-product:navigation', change)
  }, [])
  const active = activeSection === undefined ? announcedSection : activeSection
  const count = Number.isFinite(attentionCount) && attentionCount > 0 ? Math.floor(attentionCount) : 0
  const attentionLabel = !attentionKnown ? '任务待办，状态尚未更新' : count ? `任务待办，${attentionPartial ? '至少 ' : ''}${count} 项需要处理${attentionPartial ? '，仅统计已加载任务' : ''}` : '任务待办'
  const unread = notificationKnown && Number.isSafeInteger(notificationCount) && notificationCount > 0 ? notificationCount : 0
  const unreadLabel = unread ? `${notificationPartial ? '至少 ' : ''}${unread} 条未读通知` : notificationKnown && notificationPartial ? '较早通知的未读状态尚未完整统计' : ''
  const navigate = section => {
    if (typeof onNavigate !== 'function') return
    if (menu.current) menu.current.open = false
    action.run('打开页面', () => onNavigate({ section }))
  }
  return <nav className={`bp-contact-nav${compact ? ' bp-contact-nav-compact' : ''}`} aria-label="聊天辅助导航" onKeyDown={closeDetailsOnEscape}>
    <div className="bp-contact-nav-row">
      {typeof onNavigate === 'function' && <>
        <button type="button" className="bp-contact-nav-button" data-contact-nav="inbox" title={attentionLabel} aria-label={attentionLabel} aria-current={active === 'inbox' || active === 'tasks' ? 'page' : undefined} disabled={action.pending} onClick={() => navigate('inbox')}><UiIcon name="inbox" size={17} /><span className="bp-contact-nav-label">待办</span>{count > 0 && <span className="bp-contact-attention" aria-hidden="true">{count > 99 ? '99+' : `${count}${attentionPartial ? '+' : ''}`}</span>}</button>
        <button type="button" className="bp-contact-nav-button" data-contact-nav="home" title="工作空间" aria-label="工作空间" aria-current={active === 'home' ? 'page' : undefined} disabled={action.pending} onClick={() => navigate('home')}><UiIcon name="home" size={17} /><span className="bp-contact-nav-label">总览</span></button>
        <details ref={menu} className="bp-contact-resources"><summary title={`资源与管理${unreadLabel ? `，${unreadLabel}` : ''}`} aria-label={`资源与管理${unreadLabel ? `，${unreadLabel}` : ''}`} data-active={resources.some(row => row.section === active) || active === 'advanced' ? '' : undefined}><UiIcon name="folder" size={17} /><span className="bp-contact-nav-label">资源</span>{unreadLabel && <span className="bp-contact-unread-dot" aria-hidden="true" />}</summary><div className="bp-contact-resources-menu" role="group" aria-label="资源与管理">
          {resources.map(({ section, label, icon }) => <button type="button" key={section} aria-label={section === 'notifications' && unreadLabel ? `${label}，${unreadLabel}` : undefined} aria-current={active === section ? 'page' : undefined} disabled={action.pending} onClick={() => navigate(section)}><UiIcon name={icon} size={17} /><span>{label}</span>{section === 'notifications' && unread > 0 ? <small className="bp-contact-unread-count">{unread > 99 ? '99+' : `${unread}${notificationPartial ? '+' : ''}`}</small> : <UiIcon name="chevron" size={12} />}</button>)}
          {typeof onOpenAdvanced === 'function' && <button type="button" className="bp-contact-advanced" aria-current={active === 'advanced' ? 'page' : undefined} disabled={action.pending} onClick={() => {
            if (menu.current) menu.current.open = false
            action.run('打开高级工作台', () => onOpenAdvanced())
          }}><UiIcon name="settings" size={17} /><span>高级工作台</span><UiIcon name="chevron" size={12} /></button>}
        </div></details>
      </>}
      <AppearanceControls />
    </div>
    <ActionError error={action.error} onDismiss={action.dismiss} />
  </nav>
}

/** Optional replacement for the sidebar's native search/new controls, using their existing dialogs. */
export function ContactToolbar({ actions, compact = false }) {
  const action = useUiAction('contact-toolbar')
  const search = actions?.openPalette, create = actions?.openNewChat
  return <div className={`bp-contact-toolbar${compact ? ' bp-contact-toolbar-compact' : ''}`}>
    {!compact && <strong>Bot 伙伴</strong>}
    <div className="bp-contact-toolbar-actions">
      {typeof search === 'function' && <button type="button" title="搜索聊天" aria-label="搜索聊天" disabled={action.pending} onClick={() => action.run('打开聊天搜索', () => search(''))}><UiIcon name="search" size={18} /></button>}
      {typeof create === 'function' && <button type="button" title="新建聊天" aria-label="新建聊天" disabled={action.pending} onClick={() => action.run('打开新建聊天', () => create('new'))}><UiIcon name="plus" size={19} /></button>}
    </div>
    <ActionError error={action.error} onDismiss={action.dismiss} />
  </div>
}

/** Addon for HeaderPill. Native details/model/desktop/voice views retain ownership of their workflows. */
export function ConversationTools({ sessionId, bot, room, roster, actions, running = false, onNavigate, productApi, onOpenTools, onOpenSession, onOpenIndependentChat }) {
  const session = idOf(sessionId), botId = idOf(bot?.id), roomId = idOf(room?.id)
  const isBot = botId !== null && !room, isRoom = roomId !== null && !bot
  const ownerId = isBot ? botId : isRoom ? roomId : null
  const identity = JSON.stringify([session, isBot ? botId : null, isRoom ? roomId : null])
  const action = useUiAction(identity)
  const threadKey = useMemo(() => ++threadHeaderScope, [session, productApi])
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => { setSettingsOpen(false) }, [identity, productApi])
  const overflow = useRef(null)
  const details = actions?.showDetails, memory = actions?.openMemory, voice = actions?.openVoice
  if (!session || !ownerId) return null
  const name = (isBot ? bot.name : room.name) || (isBot ? 'Bot' : '群聊')
  const modelState = botModelStatus(isBot ? bot : null, roster?.models)
  const modelName = modelState.label
  const members = isRoom && Array.isArray(room.members) ? room.members.length : null
  const canDetails = typeof details === 'function'
  const buttons = [
    ...(typeof onNavigate === 'function' ? [{ key: 'library', label: isBot ? `${name} 的资料` : '团队资料库', short: '资料库', icon: 'folder', run: () => onNavigate({ section: 'library', ...(isBot ? { botId } : {}) }) }] : []),
    ...(isBot && typeof onNavigate === 'function' ? [{ key: 'data', label: `${name} 的数据与图表`, short: '数据', icon: 'chart', run: () => onNavigate({ section: 'data', botId }) }] : []),
    ...(typeof memory === 'function' && roster?.memory !== false ? [{ key: 'memory', label: isBot ? `${name} 的记忆` : `${name} 的群聊记忆`, short: '记忆', icon: 'memory', run: () => memory(ownerId) }] : []),
    ...(typeof onNavigate === 'function' ? [{ key: 'tasks', label: isBot ? `${name} 的任务` : '团队任务', short: '任务', icon: 'tasks', run: () => onNavigate({ section: 'tasks', ...(isBot ? { botId } : {}) }) }] : []),
    ...(isBot && typeof voice === 'function' ? [{ key: 'voice', label: `和 ${name} 语音聊天`, short: '语音聊天', icon: 'voice', run: () => voice(session) }] : []),
  ]
  if (!canDetails && !buttons.length && !running) return null
  const activate = row => {
    if (overflow.current) overflow.current.open = false
    action.run(`打开${row.short}`, row.run)
  }
  const shortcut = (row, menu = false) => <button type="button" key={row.key} data-chat-command={row.key} aria-label={row.label} title={row.label} disabled={action.pending} onClick={() => activate(row)}><UiIcon name={row.icon} size={17} />{menu && <span>{row.short}</span>}</button>
  return <div className="bp-conversation-tools" data-conversation-kind={isBot ? 'bot' : 'room'} data-running={running ? '' : undefined} data-bot-id={isBot ? botId : undefined} data-room-id={isRoom ? roomId : undefined} role="group" aria-label={`${name} 的聊天工具`} onKeyDown={closeDetailsOnEscape}>
    {isBot && typeof onOpenIndependentChat === 'function' && <IndependentChatEntry productApi={productApi} botId={botId} onOpen={onOpenIndependentChat}/>}
    {isBot && typeof productApi?.dispatch === 'function' && <BotThreadHeader key={threadKey} sessionId={session} roster={roster} productApi={productApi} actions={actions} onOpenSession={onOpenSession} onOpenPanel={typeof onNavigate === 'function' ? () => onNavigate({ section: 'threads', botId }) : undefined}/>}
    {canDetails && (isBot ? <button type="button" className="bp-conversation-model" data-chat-command="model" data-model-different={modelState.different ? '' : undefined} aria-label={`${name} 的模型：${modelName}，${modelState.title}，打开模型与官方工具设置`} title={`${modelState.title} · 模型与官方工具`} disabled={action.pending} onClick={() => action.run('打开模型设置', () => typeof productApi?.dispatch === 'function' ? setSettingsOpen(true) : typeof onNavigate === 'function' ? onNavigate({ section: 'bindings', botId, compose: true }) : details(session, 'details'))}><UiIcon name="spark" size={15} /><span className="bp-conversation-model-name">{modelName}</span>{modelState.different && <span className="bp-conversation-model-different" aria-hidden="true"/>}<UiIcon name="chevron" size={11} /></button>
      : <button type="button" className="bp-conversation-members" data-chat-command="members" aria-label={`查看 ${name} 的群聊详情`} title="群聊详情" disabled={action.pending} onClick={() => action.run('打开群聊详情', () => details(session, 'details'))}><UiIcon name="team" size={16} /><span>{members === null ? '群聊详情' : `${members} 位成员`}</span></button>)}
    {isBot && <NativeActivityHeader key={`native-activity-${session}-${botId}`} productApi={productApi} botId={botId} sessionId={session}/>}
    {running && <span className="bp-conversation-live" role="status" aria-label="正在处理" title="正在处理"><span aria-hidden="true" /></span>}
    {isBot && canDetails && <button type="button" className="bp-conversation-computer" data-chat-command="desktop" aria-label={`查看 ${name} 的电脑`} title="电脑与桌面" disabled={action.pending} onClick={() => action.run('打开电脑', () => details(session, 'desktop'))}><UiIcon name="computer" size={18} /></button>}
    {buttons.length > 0 && <><div className="bp-conversation-shortcuts">{buttons.map(row => shortcut(row))}</div><details ref={overflow} className="bp-conversation-overflow"><summary title="更多聊天工具" aria-label="更多聊天工具"><UiIcon name="settings" size={18} /></summary><div className="bp-conversation-menu" role="group" aria-label="更多聊天工具">{buttons.map(row => shortcut(row, true))}</div></details></>}
    <ActionError error={action.error} onDismiss={action.dismiss} />
    {settingsOpen && isBot && <BotSettingsDialog productApi={productApi} botId={botId} onClose={() => setSettingsOpen(false)} onOpenTools={typeof onOpenTools === 'function' ? async () => { await onOpenTools(); setSettingsOpen(false) } : undefined}/>}
  </div>
}
