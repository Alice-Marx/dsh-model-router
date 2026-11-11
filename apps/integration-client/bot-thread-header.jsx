import React, { useCallback, useEffect, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import { THREAD_ACTIONS, formatThreadAt, isArchivedThread, sortedThreads, threadLabel } from './bot-threads-panel.jsx'
import { threadRequestKey } from './thread-request-key.mjs'

// The chat-header control for a Bot's threads.
//
// It answers two questions the native header cannot: which thread of this Bot
// is open, and what the Bot's other threads are. Everything else about the
// conversation — the Bot's model, its computer, its memory, its tasks — stays
// where the product already puts it, so this is one control, not a second
// toolbar.
//
// It owns no authority. Opening a thread asks the Host for that thread's real
// Session and only then hands the id to `onOpenSession` (the native
// `actions.openSession` by default); creating one is the same, after an
// explicit create. Nothing here sends a greeting, a message, a model request
// or a Task, and no thread parameter ever carries a model, a route, a folder
// or a credential — the Bot's committed grant decides what a turn may do.
//
// The Host is read through the product API with an abort, a deadline and an
// epoch per read: a late or withdrawn answer never rewrites the list, and the
// list is read for one Bot on a change or while the menu is open, never as a
// repeated full snapshot.

const REQUEST_MS = 8000
const MENU_MS = 2500
const MAX_NAME = 80

// An IME composition is not a submission: Enter that confirms a candidate must
// never create a thread.
const submits = event => event.key === 'Enter' && event.nativeEvent?.isComposing !== true && event.keyCode !== 229

function abortable(work, signal) {
  let cancel
  const interrupted = new Promise((_resolve, reject) => {
    cancel = () => reject(new Error('THREAD_REQUEST_ABORTED'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
  return Promise.race([Promise.resolve().then(work), interrupted]).finally(() => signal.removeEventListener('abort', cancel))
}

/** The same Bot-scoped refusals the directory panel reports, in the owner's words. */
export function headerThreadNote(error) {
  switch (error?.code) {
    case 'BOT_THREADS_STORAGE_FAILED': return '线程目录无法读取，已停止写入与发送。请修复存储后重启宿主。'
    case 'THREAD_ARCHIVED': return '这个线程已归档，只能只读打开。'
    case 'SESSION_UNKNOWN': return '这个线程的会话建立结果未知，请在线程目录中核对后恢复。'
    case 'SESSION_NOT_OWNED': return '宿主没有确认这个线程会话的归属。'
    case 'BOT_GRANT_EMPTY': return '这个 Bot 的授权已被撤销或停用。'
    case 'BOT_NOT_COMMITTED': return '这个 Bot 已不在已提交状态。'
    case 'RUNTIME_MODE_MISMATCH': return '这个 Bot 已由另一个运行时提供服务。'
    case 'THREAD_REQUEST_ABORTED': return '宿主没有在约定时间内回答。'
    default: return '操作未得到宿主确认。'
  }
}

export function BotThreadHeader({ sessionId, roster, productApi, actions, onOpenSession, onOpenPanel, className }) {
  // The thread that is open, and the Bot it belongs to. The roster indexes a
  // thread Session under its Bot, so both identities are known here.
  const thread = roster?.threadsById?.[sessionId] ?? null
  const bot = roster?.byId?.[sessionId] ?? null
  const botId = thread?.botId ?? bot?.id ?? null
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState('')
  const [place, setPlace] = useState(null)
  const live = useRef({ mounted: false, requests: new Set(), queue: Promise.resolve(), loaded: false, inflight: null })
  const root = useRef(null)
  const chip = useRef(null)
  // Two epochs, one per kind of read: only the newest open may navigate, and
  // only the newest list may rewrite the rows.
  const opening = useRef(0)
  const reading = useRef(0)
  // One create intent, one key, held until the Host answers (see createThread).
  const createKey = useRef(null)
  const navigate = id => (typeof onOpenSession === 'function' ? onOpenSession(id) : actions?.openSession?.(id))
  // Closing gives the caret back to the chip that opened the menu, so a keyboard
  // owner is never dropped on the page when the input disappears.
  const closeMenu = () => {
    setOpen(false)
    if (root.current?.contains(document.activeElement)) chip.current?.focus()
  }
  // One guarded call at a time, in the order it was made; a reply counts only
  // while this control is mounted and no newer call of the same kind began.
  const call = (action, payload, epoch) => {
    const mine = epoch === undefined ? 0 : epoch.current + 1
    if (epoch !== undefined) epoch.current = mine
    // The newest call retires the one before it, so a Host that never answers
    // cannot hold the queue.
    const idle = live.current.inflight === null
    live.current.inflight?.abort()
    const run = idle ? step(action, payload, epoch, mine) : live.current.queue.then(() => step(action, payload, epoch, mine))
    live.current.queue = run.then(() => undefined, () => undefined)
    return run
  }
  const step = async (action, payload, epoch, mine) => {
    const current = live.current
    if (!current.mounted || typeof productApi?.dispatch !== 'function') return { abandoned: true }
    const controller = new AbortController()
    current.inflight = controller
    current.requests.add(controller)
    let expired = false
    const timeout = setTimeout(() => { expired = true; controller.abort() }, REQUEST_MS)
    try {
      const result = await abortable(() => productApi.dispatch(action, payload, controller.signal), controller.signal)
      if (action === THREAD_ACTIONS.open && result?.sessionId && typeof actions?.prepareThreadNavigation === 'function') {
        await abortable(() => actions.prepareThreadNavigation(), controller.signal)
      }
      if (!current.mounted || controller.signal.aborted || (epoch !== undefined && epoch.current !== mine)) return { abandoned: true }
      return { ok: true, result }
    } catch (error) {
      if (!current.mounted || (epoch !== undefined && epoch.current !== mine)) return { abandoned: true }
      // A deadline the Host missed is reported; a call a newer one retired is not.
      if (expired) return { ok: false, error: Object.assign(new Error('宿主没有在约定时间内回答。'), { code: 'THREAD_REQUEST_ABORTED' }) }
      return controller.signal.aborted ? { abandoned: true } : { ok: false, error }
    } finally { clearTimeout(timeout); current.requests.delete(controller); if (current.inflight === controller) current.inflight = null }
  }

  const read = useCallback(async () => {
    const current = live.current
    if (!current.mounted || !botId) return
    const outcome = await call(THREAD_ACTIONS.list, { botId }, reading)
    if (outcome.ok) { current.loaded = true; setRows(sortedThreads(outcome.result?.threads)) }
    else if (outcome.error !== undefined && (!current.loaded || outcome.error.code === 'BOT_THREADS_STORAGE_FAILED')) setNote(headerThreadNote(outcome.error))
  }, [botId, productApi])

  // Read once per Bot, and again only while the menu is open: a closed control
  // pulls nothing, and an open one follows the Host without a full snapshot.
  useEffect(() => {
    const current = live.current
    current.mounted = true
    void read()
    return () => { current.mounted = false; reading.current += 1; opening.current += 1; for (const controller of current.requests) controller.abort(); current.requests.clear() }
  }, [read])
  useEffect(() => {
    if (!open) return undefined
    const timer = setInterval(() => void read(), MENU_MS)
    return () => clearInterval(timer)
  }, [open, read])
  useEffect(() => {
    if (!open) return undefined
    const away = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    // Escape closes the menu and gives the caret back to the chip that opened it,
    // so a keyboard owner is never dropped on the page.
    const key = event => {
      if (event.key !== 'Escape') return
      closeMenu()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
  }, [open])
  // The menu is placed against the control's own box, not against whatever
  // ancestor happens to be positioned: it sits in the product's chat toolbar,
  // whose layout the toolbar itself owns.
  useEffect(() => {
    if (!open) { setPlace(null); return undefined }
    const measure = () => {
      const box = root.current?.getBoundingClientRect()
      if (box === undefined) return
      const width = Math.min(300, Math.max(200, window.innerWidth - 24))
      const left = Math.min(Math.max(8, box.right - width), Math.max(8, window.innerWidth - width - 8))
      const below = box.bottom + 6, above = box.top - 6
      setPlace({ left, top: below + 320 < window.innerHeight || above < 320 ? below : undefined, bottom: below + 320 < window.innerHeight || above < 320 ? undefined : window.innerHeight - above })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [open])

  const openThread = async (threadId, { create = false } = {}) => {
    setNote('')
    setPending(true)
    const outcome = await call(THREAD_ACTIONS.open, { botId, threadId, ...(create ? { create: true } : {}) }, opening)
    setPending(false)
    if (!outcome.ok) { if (outcome.error !== undefined) setNote(headerThreadNote(outcome.error)); return }
    const id = outcome.result?.sessionId ?? null
    // Only a Session the Host confirmed is navigated to.
    if (typeof id === 'string' && id !== '') { closeMenu(); setDraft(''); navigate(id) }
    else if (create) setNote('宿主没有返回这个线程的会话。')
  }
  const createThread = async () => {
    // One intent, one key, held until the Host answers: a timeout or an unknown
    // outcome followed by another click is the same intent, so the Host answers
    // with the thread it already made instead of a second one. The key is
    // retired only when the create is confirmed or the owner abandons it.
    if (createKey.current === null) createKey.current = threadRequestKey('head')
    const requestKey = createKey.current
    const name = draft.trim().slice(0, MAX_NAME)
    setNote('')
    setPending(true)
    const made = await call(THREAD_ACTIONS.create, { botId, name: name || undefined, requestKey })
    setPending(false)
    const threadId = made.result?.thread?.threadId
    if (typeof threadId !== 'string') {
      if (made.error !== undefined) setNote(headerThreadNote(made.error))
      // Unconfirmed: the key stands, so the next attempt is the same intent.
      return
    }
    createKey.current = null
    setDraft('')
    await openThread(threadId, { create: true })
  }

  const list = rows ?? []
  const current = list.find(row => row.sessionId === sessionId || row.threadId === thread?.threadId) ?? null
  // The Bot's own default chat is not a thread and is never given a substitute
  // Session: it is listed so a thread can be left again, and opening it hands
  // the shell the Bot id it already trusts.
  const defaultChat = { threadId: null, name: `${bot?.name ?? botId} 的默认聊天`, sessionId: bot?.sessionId ?? bot?.id ?? botId, state: 'open', archivedAt: null, sessionState: 'owned', updatedAt: 0, active: current === null }
  // The thread's own name comes from the freshest source that has it: the
  // directory answer for a thread the Host has not recorded yet, the roster for
  // one it has. The Bot beside it is the identity the roster confirms.
  const label = current !== null ? threadLabel(current) : thread !== null ? threadLabel({ name: thread.name }) : (bot?.name ?? '')
  const botName = bot?.name ?? null
  const title = botName !== null ? `${label} · ${botName}` : label
  // Without a Bot there is nothing to switch: the default chat is not a
  // thread, and this control stays out of the way.
  if (botId === null) return null
  return (
    <div className={`bp-threads-head-wrap${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} ref={root}>
      <button type="button" className="bp-threads-head" ref={chip} aria-haspopup="menu" aria-expanded={open}
        aria-label={botName !== null ? `当前线程 ${label}（${botName}），打开这个 Bot 的线程列表` : `打开这个 Bot 的线程列表`}
        title={title} onClick={() => { setOpen(!open); if (!open) void read() }}>
        <UiIcon name="list" size={14} />
        <span className="bp-threads-head-name">{label}</span>
        {list.length > 0 && <span className="bp-threads-head-count">{list.length + 1}</span>}
      </button>
      {open && (
        <div className="bp-threads-menu" role="menu" aria-label={`${bot?.name ?? botId} 的会话线程`} style={place === null ? undefined : { position: 'fixed', left: `${place.left}px`, top: place.top === undefined ? undefined : `${place.top}px`, bottom: place.bottom === undefined ? undefined : `${place.bottom}px` }}>
          <p className="bp-threads-menu-title">{bot?.name ?? botId} 的会话</p>
          {note && <p className="bp-threads-note" role="alert">{note}</p>}
          {rows === null && <p className="bp-threads-note" role="status">正在读取线程目录…</p>}
          <ul className="bp-threads-menu-list">
            <li key="default">
              <button type="button" role="menuitem" data-state="default" className={`bp-threads-menu-row${current === null ? ' is-active' : ''}`}
                disabled={pending} onClick={() => { if (current !== null) { closeMenu(); navigate(defaultChat.sessionId) } }}>
                <span className="bp-threads-menu-name">{defaultChat.name}</span>
                <span className="bp-threads-menu-meta">
                  {current === null && <span className="bp-thread-badge">当前</span>}
                  <span className="bp-thread-badge is-quiet">默认聊天</span>
                </span>
              </button>
            </li>
            {list.map(row => (
              <li key={row.threadId}>
                <button type="button" role="menuitem" data-state={isArchivedThread(row) ? 'archived' : 'open'} className={`bp-threads-menu-row${current?.threadId === row.threadId ? ' is-active' : ''}`}
                  disabled={pending} onClick={() => { if (current?.threadId !== row.threadId) void openThread(row.threadId, { create: !isArchivedThread(row) }) }}>
                  <span className="bp-threads-menu-name">{threadLabel(row)}</span>
                  <span className="bp-threads-menu-meta">
                    {current?.threadId === row.threadId && <span className="bp-thread-badge">当前</span>}
                    {isArchivedThread(row) && <span className="bp-thread-badge is-quiet">归档 · 只读</span>}
                    {row.sessionState === 'unbound' && <span className="bp-thread-badge is-wait">待宿主确认</span>}
                    <span className="bp-thread-time">{formatThreadAt(row.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="bp-threads-menu-new">
            <input className="bp-threads-input" value={draft} maxLength={MAX_NAME} placeholder="新线程名称（可留空）"
              aria-label="新线程名称" onChange={event => setDraft(event.target.value)}
              onKeyDown={event => { if (submits(event) && !pending) void createThread() }} />
            <button type="button" className="bp-threads-button" disabled={pending} onClick={() => void createThread()}>
              <UiIcon name="plus" size={16} /><span>新建线程</span>
            </button>
          </div>
          {typeof onOpenPanel === 'function' && (
            <button type="button" className="bp-threads-menu-more" onClick={() => { closeMenu(); onOpenPanel() }}>在线程目录中管理归档与名称</button>
          )}
        </div>
      )}
    </div>
  )
}
