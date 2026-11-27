import React, { useMemo, useState, useSyncExternalStore } from 'react'
import { conversationInbox } from './conversation-inbox.mjs'
import { NotificationsPanel } from './notifications-panel.jsx'
import { UiIcon } from './ui-icons.jsx'
import { WorkspaceInbox } from './workspace-ui.jsx'

const empty = () => null
const subscribeEmpty = () => () => {}
const identity = value => value
const unread = ui => ui?.unread
const approvals = work => work?.approvals

function useSource(source, select = identity) {
  return useSyncExternalStore(source?.subscribe ?? subscribeEmpty, () => select(source?.getSnapshot()))
}

export function useConversationInbox(teamSource, useSessionStatus = empty, useSessions = empty) {
  const team = useSource(teamSource)
  const roster = useSource(team?.hooks?.roster)
  const work = useSource(team?.hooks?.work, approvals)
  const marks = useSource(team?.hooks?.ui, unread)
  const statuses = useSessionStatus(identity)
  const sessions = useSessions(identity)
  const inbox = useMemo(() => conversationInbox(roster, { approvals: work }, marks, statuses, sessions), [roster, work, marks, statuses, sessions])
  return { ...inbox, openSession: team?.actions?.openSession }
}

const STAGES = { approve: ['待审批', 'lock'], question: ['待回答', 'message'], unread: ['未读', 'inbox'] }

export function ConversationInbox({ inbox }) {
  return <section className="bp-inbox bp-conversation-inbox" aria-label="会话待办">
    <div className="bp-section-heading"><h2>会话待办 <span className="bp-count">{inbox.known ? inbox.rows.length : '—'}</span></h2></div>
    {!inbox.known ? <p className="bp-muted" role="status">正在等待会话状态。</p>
      : !inbox.rows.length ? <p className="bp-muted">暂无会话待办。</p>
        : <ul className="bp-inbox-rows">{inbox.rows.map(row => (
          <li key={row.sessionId} className="bp-inbox-item" data-stage={row.stages[0]}>
            <span className="bp-inbox-icon"><UiIcon name={STAGES[row.stages[0]][1]} size={18} /></span>
            <div className="bp-inbox-copy">
              <span className="bp-state-label">{row.stages.map(stage => STAGES[stage][0]).join(' · ')}</span>
              <h3>{row.name}</h3>
              <small>{row.kind === 'room' ? '群聊' : row.kind === 'thread' ? `${row.botName} · 线程` : 'Bot 会话'}</small>
            </div>
            <div className="bp-inbox-actions"><button type="button" aria-label={`打开会话 ${row.name}`} disabled={!inbox.openSession} onClick={() => inbox.openSession(row.id)}>打开会话<UiIcon name="chevron" size={13} /></button></div>
          </li>
        ))}</ul>}
  </section>
}

export function UnifiedInbox({ teamSource, useSessionStatus, useSessions, snapshot, notificationsAvailable, productApi, onNavigate, openSession }) {
  const [showNotifications, setShowNotifications] = useState(false)
  const inbox = useConversationInbox(teamSource, useSessionStatus, useSessions)
  return <>
    <div className="bp-inbox-filters" role="group" aria-label="收件箱视图">
      <button type="button" aria-pressed={!showNotifications} onClick={() => setShowNotifications(false)}>待处理</button>
      <button type="button" aria-pressed={showNotifications} onClick={() => setShowNotifications(true)}>任务通知</button>
    </div>
    {showNotifications
      ? <NotificationsPanel productApi={productApi} botIds={snapshot?.bots.map(bot => bot.id)} available={notificationsAvailable === true} onNavigate={onNavigate} />
      : <><ConversationInbox inbox={inbox} />
        {snapshot && <WorkspaceInbox snapshot={snapshot} onNavigate={onNavigate} openSession={openSession} />}</>}
  </>
}
