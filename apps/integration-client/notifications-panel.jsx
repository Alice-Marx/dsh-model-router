import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'

// A read-only inbox over committed Task-journal events. It opens the original
// detail and tracks what the owner has seen; it never starts, stops or retries a
// Task, and it renders only the Host's structured projection (never task input,
// execution references or raw event detail).
const PAGE = 20
const VISIBLE_MS = 5000
const FAILED_MS = 15000
const MAX_ITEMS = 200

function abortable(work, signal) {
  let cancel
  const interrupted = new Promise((_resolve, reject) => {
    cancel = () => reject(new Error('NOTIFICATION_REQUEST_ABORTED'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
  return Promise.race([Promise.resolve().then(work), interrupted]).finally(() => signal.removeEventListener('abort', cancel))
}

const CATEGORY_ICON = { succeeded: 'check', failed: 'close', reconcile: 'refresh', 'waiting-budget': 'clock', cancelled: 'close', blocked: 'lock', reconciled: 'check', update: 'activity' }

// Merge a freshly-read newest page into the rendered list. Keys are the durable
// event seq, so a row the owner is focused on keeps its DOM node across a poll.
function merge(existing, incoming) {
  const map = new Map(existing.map(item => [item.seq, item]))
  for (const item of incoming) map.set(item.seq, item)
  return [...map.values()].sort((left, right) => right.seq - left.seq).slice(0, MAX_ITEMS)
}

/** Relative time from structured journal state; `now` is injected so it stays testable. */
export function formatAt(at, now = Date.now()) {
  if (!Number.isSafeInteger(at) || at < 0) return ''
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return '刚刚'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

let scopeKey = 0
export function NotificationsPanel(props) {
  const key = useMemo(() => ++scopeKey, [props.productApi, props.available])
  return <NotificationFeed key={key} {...props} />
}

function NotificationFeed({ productApi, onNavigate, available = true, botIds }) {
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [status, setStatus] = useState(available ? 'loading' : 'unavailable')
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const session = useRef({ live: false, epoch: 0, busy: false, requests: new Set() })

  // Each operation is retired with its Host. A read acknowledgement must arrive
  // before the UI claims success; stale polls cannot overwrite that receipt.
  const requestAction = async (action, payload, apply) => {
    const current = session.current
    if (!current.live || current.busy) return
    current.busy = true; current.epoch++
    for (const controller of current.requests) controller.abort()
    const controller = new AbortController()
    current.requests.add(controller)
    setPending(true); setFeedback('')
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const result = await abortable(() => productApi.dispatch(action, payload, controller.signal), controller.signal)
      if (current.live && !controller.signal.aborted) apply(result)
    } catch {
      if (current.live) setFeedback(action === 'notifications.list' ? '较早通知暂时无法读取，请重试。' : '已读状态未确认，请重试。')
    } finally {
      clearTimeout(timeout); current.requests.delete(controller); current.busy = false
      if (current.live) { setPending(false); setLoadingMore(false) }
    }
  }

  useEffect(() => {
    if (!available || typeof productApi?.dispatch !== 'function') { setStatus('unavailable'); return undefined }
    let live = true, epoch = 0, timer, request
    const currentSession = session.current
    currentSession.live = true
    const schedule = (delay) => { clearTimeout(timer); if (live && !document.hidden) timer = setTimeout(load, delay) }
    const load = async () => {
      clearTimeout(timer)
      if (!live || document.hidden) return
      if (currentSession.busy) { schedule(VISIBLE_MS); return }
      const current = ++epoch, controller = new AbortController()
      const revision = currentSession.epoch
      request?.abort(); request = controller
      currentSession.requests.add(controller)
      const deadline = setTimeout(() => controller.abort(), 8000)
      const valid = () => live && current === epoch && revision === currentSession.epoch && !controller.signal.aborted
      let failed = false
      try {
        const page = await abortable(() => productApi.dispatch('notifications.list', { limit: PAGE }, controller.signal), controller.signal)
        if (!valid()) return
        setItems(previous => merge(previous, Array.isArray(page?.items) ? page.items : []))
        setSummary(previous => ({ unreadCount: page?.unreadCount ?? 0, truncated: page?.truncated === true,
          nextBefore: previous?.olderLoaded ? previous.nextBefore : page?.nextBefore ?? null, olderLoaded: previous?.olderLoaded ?? false, maxSeq: page?.maxSeq ?? 0 }))
        setStatus('ready')
      } catch {
        failed = true
        // A transient failure keeps the rows already on screen; only a first
        // load that never succeeded reports an error state.
        if (live && current === epoch && revision === currentSession.epoch) setStatus('error')
      } finally {
        clearTimeout(deadline)
        currentSession.requests.delete(controller)
        if (request === controller) request = undefined
        if (live && current === epoch) schedule(failed ? FAILED_MS : VISIBLE_MS)
      }
    }
    const visible = () => { if (document.hidden) { epoch++; clearTimeout(timer); request?.abort(); request = undefined } else void load() }
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => { live = false; currentSession.live = false; epoch++; clearTimeout(timer); for (const controller of currentSession.requests) controller.abort(); document.removeEventListener('visibilitychange', visible) }
  }, [productApi, available])

  const open = item => { if (typeof onNavigate === 'function') onNavigate({ section: 'tasks', botId: item.botId, taskId: item.taskId, attemptId: item.attemptId }) }
  const markRead = item => requestAction('notifications.read', { seq: item.seq }, result => {
    setItems(previous => previous.map(row => row.seq === item.seq ? { ...row, read: true } : row))
    setSummary(previous => ({ ...previous, unreadCount: result.unreadCount, truncated: result.truncated === true }))
  })
  const markAll = () => requestAction('notifications.markAll', {}, result => {
    setItems(previous => previous.map(row => row.seq <= result.cursorSeq ? { ...row, read: true } : row))
    setSummary(previous => ({ ...previous, unreadCount: result.unreadCount, truncated: result.truncated === true }))
  })
  const loadMore = async () => {
    if (loadingMore || summary?.nextBefore === null || summary?.nextBefore === undefined) return
    setLoadingMore(true)
    await requestAction('notifications.list', { before: summary.nextBefore, limit: PAGE }, page => {
      setItems(previous => merge(previous, Array.isArray(page?.items) ? page.items : []))
      setSummary(previous => ({ ...previous, nextBefore: page?.nextBefore ?? null, olderLoaded: true }))
    })
  }

  const unread = summary?.unreadCount ?? 0
  const shown = Array.isArray(botIds) ? items.filter(item => botIds.includes(item.botId)) : items
  return (
    <section className="bp-notifications" aria-label="通知中心">
      <header className="bp-notifications-bar">
        <h2 className="bp-notifications-title">通知中心</h2>
        {(unread > 0 || summary?.truncated) && <span className="bp-notifications-badge" aria-label={unread ? `${summary?.truncated ? '至少 ' : ''}${unread} 条未读` : '较早通知的未读状态尚未完整统计'}>{unread > 99 ? '99+' : unread ? `${unread}${summary?.truncated ? '+' : ''}` : '…'}</span>}
        <div className="bp-notifications-bar-actions">
          <button type="button" className="bp-notifications-markall" onClick={markAll} disabled={pending || (unread === 0 && !summary?.truncated)}>
            <UiIcon name="check" size={16} /><span>全部已读</span>
          </button>
        </div>
      </header>
      {feedback && <p className="bp-notifications-note" role="alert">{feedback}</p>}
      {summary?.truncated && <p className="bp-notifications-note">未读数量仅统计最近 512 条事件，可继续查看历史通知。</p>}
      {status === 'unavailable' && <p className="bp-notifications-note">当前连接暂时无法读取通知。恢复可用连接后，可在这里查看任务完成、失败与待核对事件。</p>}
      {status === 'loading' && <p className="bp-notifications-note" role="status">正在读取通知…</p>}
      {status === 'error' && <p className="bp-notifications-note" role="status">通知暂时没有更新，稍后会自动重试。</p>}
      {status === 'ready' && shown.length === 0 && <p className="bp-notifications-note">暂无通知。任务完成、失败或需要核对时会出现在这里。</p>}
      {shown.length > 0 && (
        <ul className="bp-notifications-list">
          {shown.map(item => (
            <li key={item.seq} className={`bp-notification bp-notification-${item.tone}${item.read ? '' : ' is-unread'}`} data-category={item.category} data-seq={item.seq}>
              <button type="button" className="bp-notification-open" onClick={() => open(item)}>
                <span className="bp-notification-icon" aria-hidden="true"><UiIcon name={CATEGORY_ICON[item.category] ?? 'activity'} size={18} /></span>
                <span className="bp-notification-body">
                  <span className="bp-notification-text">{item.text}</span>
                  <span className="bp-notification-meta">
                    {item.isNew && <span className="bp-notification-new">新</span>}
                    <span className="bp-notification-time">{formatAt(item.at)}</span>
                  </span>
                </span>
                {!item.read && <span className="bp-notification-dot" aria-label="未读" />}
              </button>
              {!item.read && <button type="button" className="bp-notification-read" disabled={pending} onClick={() => markRead(item)} aria-label="标为已读"><UiIcon name="check" size={16} /></button>}
            </li>
          ))}
        </ul>
      )}
      {summary?.nextBefore !== null && summary?.nextBefore !== undefined && items.length > 0 && (
        <button type="button" className="bp-notifications-more" onClick={loadMore} disabled={pending || loadingMore || items.length >= MAX_ITEMS}>{loadingMore ? '加载中…' : items.length >= MAX_ITEMS ? '已显示最近 200 条通知' : '加载更早'}</button>
      )}
    </section>
  )
}
