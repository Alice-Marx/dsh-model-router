import React, { useEffect, useState } from 'react'
import { ContactNavigation } from './chat-ui.jsx'
import { taskProgress } from './task-progress.mjs'

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

/** Read-only polling stops while hidden and retires every result from a replaced Host. */
export function ContactAttentionNavigation({ productApi, ...props }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    if (typeof productApi?.attention !== 'function') return undefined
    let live = true, epoch = 0, timer, request
    const publish = value => { if (live) setState({ scope: productApi, ...value }) }
    const pause = () => { epoch++; clearTimeout(timer); request?.abort(); request = undefined; publish({ value: null }) }
    const load = async () => {
      clearTimeout(timer)
      if (!live || document.hidden) return
      const current = ++epoch, controller = new AbortController()
      request?.abort(); request = controller
      const deadline = setTimeout(() => { controller.abort(); if (live && current === epoch) publish({ value: null }) }, 8000)
      const valid = () => live && current === epoch && !controller.signal.aborted
      let failed = false
      try {
        const value = await productApi.attention(controller.signal)
        if (valid()) publish({ value })
      } catch {
        failed = true
        if (live && current === epoch) publish({ value: null })
      } finally {
        clearTimeout(deadline)
        if (request === controller) request = undefined
        if (live && current === epoch && !document.hidden) timer = setTimeout(load, failed ? 15000 : 5000)
      }
    }
    const visible = () => { if (document.hidden) pause(); else void load() }
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => { live = false; epoch++; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visible) }
  }, [productApi])
  const attention = contactAttention(state?.scope === productApi ? state.value : null)
  const notifications = notificationAttention(state?.scope === productApi ? state.value : null)
  return <ContactNavigation {...props} attentionCount={attention.count} attentionPartial={attention.partial} attentionKnown={attention.known}
    notificationCount={notifications.count} notificationPartial={notifications.partial} notificationKnown={notifications.known}/>
}
