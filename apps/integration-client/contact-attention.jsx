import React from 'react'
import { ContactNavigation } from './chat-ui.jsx'
import { taskProgress } from './task-progress.mjs'
import { useConversationInbox } from './conversation-inbox.jsx'
import { useTaskAttention } from './task-attention-source.mjs'

/** The contact footer reads the same committed task projection as the inbox. */
export function contactAttention(snapshot) {
  if (snapshot?.schemaVersion !== 1 || snapshot.tasks?.status !== 'available') return { known: false, count: 0, partial: false }
  return { known: true, count: taskProgress(snapshot).attention.length, partial: snapshot.tasks.truncated === true }
}

export function notificationAttention(snapshot) {
  const value = snapshot?.schemaVersion === 1 ? snapshot.notifications : null
  if (value?.status !== 'available' || !Number.isSafeInteger(value.unreadCount) || value.unreadCount < 0) return { known: false, count: 0, partial: false }
  return { known: true, count: value.unreadCount, partial: value.truncated === true }
}

export function ContactAttentionNavigation({ productApi, inboxTeam, useSessionStatus, useSessions, ...props }) {
  const [{ value }] = useTaskAttention(productApi)
  const conversations = useConversationInbox(inboxTeam, useSessionStatus, useSessions)
  const attention = contactAttention(value)
  const notifications = notificationAttention(value)
  return <ContactNavigation {...props} attentionCount={attention.count + conversations.rows.length}
    attentionPartial={attention.partial || (Boolean(inboxTeam) && attention.known !== conversations.known)} attentionKnown={attention.known || conversations.known}
    notificationCount={notifications.count} notificationPartial={notifications.partial} notificationKnown={notifications.known}/>
}
