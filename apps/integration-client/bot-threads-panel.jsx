import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import { threadRequestKey } from './thread-request-key.mjs'

// The thread panel: several independent conversation threads under one Bot.
//
// It is a directory surface, never an execution surface. Every write goes to
// the Host as a structured action and takes effect only after the Host
// acknowledges it; the panel offers no send, cancel, retry, stop or approval
// control, because a thread carries no authority of its own — the Bot's
// committed model, tools and funding still decide what a turn may do. The
// browser only ever selects a thread the store already verified.
//
// Opening a thread is navigation, and it is the owner's own act: the panel asks
// the Host for the thread's real Session and only then hands that Session id to
// `onOpenSession`, which is the one thing the product shell may do with it.
// Nothing here sends a greeting, a message, a model request or a Task, and a
// late, timed-out or withdrawn answer never moves the user anywhere.

const VISIBLE_MS = 5000
const FAILED_MS = 15000
const REQUEST_MS = 8000
const MAX_NAME = 80
export const THREAD_ACTIONS = Object.freeze({
  readModel: 'threads.readModel',
  list: 'threads.list',
  create: 'threads.create',
  rename: 'threads.rename',
  switch: 'threads.switch',
  open: 'threads.open',
  recover: 'threads.recover',
  archive: 'threads.archive',
  unarchive: 'threads.unarchive',
})

function abortable(work, signal) {
  let cancel
  const interrupted = new Promise((_resolve, reject) => {
    cancel = () => reject(new Error('THREAD_REQUEST_ABORTED'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
  return Promise.race([Promise.resolve().then(work), interrupted]).finally(() => signal.removeEventListener('abort', cancel))
}

/** Present, not truthy: a thread stored with archivedAt 0 is archived. */
export function isArchivedThread(thread) {
  return thread?.archivedAt !== undefined && thread.archivedAt !== null
}

export function formatThreadAt(at, now = Date.now()) {
  if (!Number.isSafeInteger(at) || at < 0) return ''
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return '刚刚'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

export function threadLabel(thread) {
  const name = typeof thread?.name === 'string' ? thread.name.trim() : ''
  return name || '新线程'
}

/** The same order the store keeps: active first, open before archived, newest first. */
export function sortedThreads(threads) {
  return [...(Array.isArray(threads) ? threads : [])].sort((left, right) => {
    if (Boolean(left.active) !== Boolean(right.active)) return left.active ? -1 : 1
    if (isArchivedThread(left) !== isArchivedThread(right)) return isArchivedThread(left) ? 1 : -1
    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  })
}

/** Why the Host refused, in the owner's words. A code the panel does not know is not guessed at. */
export function threadFailure(error) {
  switch (error?.code) {
    case 'BOT_THREADS_STORAGE_FAILED': return '线程目录无法读取，已停止写入与发送。请修复存储后重启宿主。'
    case 'THREAD_ARCHIVED': return '这个线程已归档，只能只读打开；恢复后才能继续对话。'
    case 'SESSION_UNKNOWN': return '这个线程的会话建立结果未知，请核对后由所有者确认恢复，不要自动重试。'
    case 'SESSION_NOT_OWNED': return '宿主没有确认这个线程会话的归属，暂时不能打开。'
    case 'BOT_GRANT_EMPTY': return '这个 Bot 的授权已被撤销或停用，线程暂不可写入。'
    case 'BOT_NOT_COMMITTED': return '这个 Bot 已不在已提交状态，线程暂时不可用。'
    case 'RUNTIME_MODE_MISMATCH': return '这个 Bot 已切到另一个运行时，集成路径不能为它建立线程会话。'
    case 'THREAD_REQUEST_ABORTED': return '宿主没有在约定时间内回答，本次打开已取消。'
    default: return '操作未得到宿主确认，请重试。'
  }
}

// An IME composition is not a submission: Enter that confirms a candidate must
// never create a thread or commit a rename.
const submits = event => event.key === 'Enter' && event.nativeEvent?.isComposing !== true && event.keyCode !== 229

let scopeKey = 0
export function BotThreadsPanel(props) {
  const key = useMemo(() => ++scopeKey, [props.productApi, props.available, props.botId])
  return <ThreadPanel key={key} {...props} />
}

function ThreadPanel({ productApi, botId, available = true, onOpenSession }) {
  const [view, setView] = useState(null)
  const [status, setStatus] = useState(available ? 'loading' : 'unavailable')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [recover, setRecover] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [draft, setDraft] = useState('')
  const session = useRef({ live: false, epoch: 0, busy: false, requests: new Set() })
  // The poll loop lives in the effect; a write that returns no list asks it to
  // re-read immediately instead of waiting for the next tick.
  const reloadRef = useRef(null)
  // Navigation has its own epoch: only the newest open may move the user, so a
  // late reply, a timeout or a Host that switched this Bot away cannot land the
  // owner on a Session they did not ask for.
  const opening = useRef(0)
  // One create intent, one request key. A reply that never arrives reuses the
  // key, so a retry is answered with the thread the first attempt already made
  // instead of a second one; a new intent mints a new key.
  const createKey = useRef(null)
  const navigate = id => { if (typeof onOpenSession === 'function') onOpenSession(id) }

  // Each write is retired with its Host: a thread only changes after the store
  // acknowledges it, and a stale or aborted reply never rewrites the list. The
  // calls run in the order the owner made them, so a reply always belongs to
  // the call that is being answered; `epoch` is the one that lets the newest
  // navigation win over an older one that is still in flight.
  const queue = useRef(Promise.resolve())
  const inflight = useRef(null)
  const call = (action, payload, epoch) => {
    const mine = epoch === undefined ? 0 : epoch.current + 1
    if (epoch !== undefined) epoch.current = mine
    // The newest call retires the one before it: a Host that never answers must
    // not hold the queue, and the owner's latest intent is the one that counts.
    const idle = inflight.current === null
    inflight.current?.abort()
    // Nothing in flight: answer at once, so an owner's click is not held behind a
    // turn of the event loop for nothing.
    const run = idle ? step(action, payload, epoch, mine) : queue.current.then(() => step(action, payload, epoch, mine))
    queue.current = run.then(() => undefined, () => undefined)
    return run
  }
  const step = async (action, payload, epoch, mine) => {
    const current = session.current
    if (!current.live || typeof productApi?.dispatch !== 'function') return { abandoned: true }
    current.busy = true
    // A write retires the reads that started before it, so an older list can
    // never land on top of a newer one.
    current.epoch += 1
    const controller = new AbortController()
    inflight.current = controller
    current.requests.add(controller)
    setPending(true)
    let expired = false
    const timeout = setTimeout(() => { expired = true; controller.abort() }, REQUEST_MS)
    try {
      const result = await abortable(() => productApi.dispatch(action, payload, controller.signal), controller.signal)
      if (!current.live || controller.signal.aborted || (epoch !== undefined && epoch.current !== mine)) return { abandoned: true }
      return { ok: true, result }
    } catch (error) {
      if (!current.live || (epoch !== undefined && epoch.current !== mine)) return { abandoned: true }
      // A deadline the Host missed is reported; a call a newer one retired is not.
      if (expired) return { ok: false, error: Object.assign(new Error('宿主没有在约定时间内回答。'), { code: 'THREAD_REQUEST_ABORTED' }) }
      return controller.signal.aborted ? { abandoned: true } : { ok: false, error }
    } finally {
      clearTimeout(timeout); current.requests.delete(controller); if (inflight.current === controller) inflight.current = null
      current.busy = false
      if (current.live) setPending(false)
    }
  }
  // A write the Host confirmed is applied; one it refused is reported with the
  // reason it gave, and an unknown create outcome offers the owner's explicit
  // recovery instead of a silent retry.
  const write = async (action, payload) => {
    setFeedback(''); setRecover(null)
    const outcome = await call(action, payload)
    if (outcome.ok) { refresh(outcome.result); return outcome.result }
    if (outcome.error !== undefined) {
      setFeedback(threadFailure(outcome.error))
      if (outcome.error.code === 'SESSION_UNKNOWN') setRecover(payload.threadId ?? null)
    }
    return null
  }

  useEffect(() => {
    if (!available || typeof productApi?.dispatch !== 'function' || !botId) { setStatus('unavailable'); return undefined }
    let live = true, epoch = 0, timer, request
    const currentSession = session.current
    currentSession.live = true
    const schedule = delay => { clearTimeout(timer); if (live && !document.hidden) timer = setTimeout(load, delay) }
    const load = async () => {
      clearTimeout(timer)
      if (!live || document.hidden) return
      if (currentSession.busy) { schedule(VISIBLE_MS); return }
      const current = ++epoch, controller = new AbortController()
      const revision = currentSession.epoch
      request?.abort(); request = controller
      currentSession.requests.add(controller)
      const deadline = setTimeout(() => controller.abort(), REQUEST_MS)
      const valid = () => live && current === epoch && revision === currentSession.epoch && !controller.signal.aborted
      let failed = false
      try {
        const page = await abortable(() => productApi.dispatch(THREAD_ACTIONS.list, { botId }, controller.signal), controller.signal)
        if (!valid()) return
        setView({ threads: sortedThreads(page?.threads), activeThreadId: page?.activeThreadId ?? null })
        setStatus('ready')
      } catch {
        failed = true
        // A transient failure keeps the rows on screen; only a first load that
        // never succeeded reports an error state.
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
    reloadRef.current = load
    void load()
    return () => { live = false; currentSession.live = false; reloadRef.current = null; epoch++; clearTimeout(timer); for (const controller of currentSession.requests) controller.abort(); document.removeEventListener('visibilitychange', visible) }
  }, [productApi, available, botId])

  const threads = view?.threads ?? []
  const active = threads.find(thread => thread.active) ?? null
  const openCount = threads.filter(thread => !isArchivedThread(thread)).length
  const archivedCount = threads.length - openCount
  // A write reply carries the new list when the store chose to return one; when
  // it does not, the panel re-reads through the same guarded loop — it never
  // invents a state the Host did not confirm.
  const refresh = result => {
    if (Array.isArray(result?.threads)) {
      setView({ threads: sortedThreads(result.threads), activeThreadId: result.activeThreadId ?? null })
      return
    }
    reloadRef.current?.()
  }
  const createThread = async () => {
    const name = draft.trim().slice(0, MAX_NAME)
    if (createKey.current === null) createKey.current = threadRequestKey('panel')
    const requestKey = createKey.current
    const made = await write(THREAD_ACTIONS.create, { botId, name: name || undefined, requestKey })
    const threadId = made?.thread?.threadId
    // Only a Host-confirmed thread clears the composer and retires the key: an
    // unconfirmed attempt keeps both, so the next one is the same intent and
    // the Host answers it with the thread it already made.
    if (typeof threadId !== 'string') return
    setDraft('')
    createKey.current = null
    // A new thread is opened as itself: the Host makes or confirms its real
    // Session, and only that id is navigated to. No greeting, no message.
    await openThread(threadId, { create: true })
  }
  // Opening is navigation with a confirmed Session. `create` is the explicit
  // owner act that may make one; an archived thread is opened read-only, with
  // the Session the Host kept for it.
  const openThread = async (threadId, { create = false } = {}) => {
    setFeedback(''); setRecover(null)
    const outcome = await call(THREAD_ACTIONS.open, { botId, threadId, ...(create ? { create: true } : {}) }, opening)
    if (outcome.ok) {
      refresh(outcome.result)
      const sessionId = outcome.result?.sessionId ?? null
      if (typeof sessionId === 'string' && sessionId !== '') navigate(sessionId)
      else if (create) setFeedback('宿主没有返回这个线程的会话，暂时没有打开。')
      return outcome.result
    }
    if (outcome.error !== undefined) {
      setFeedback(threadFailure(outcome.error))
      if (outcome.error.code === 'SESSION_UNKNOWN') setRecover(threadId)
    }
    return null
  }
  const switchTo = thread => { if (!thread.active) void openThread(thread.threadId, { create: !isArchivedThread(thread) }) }
  const recoverThread = async threadId => {
    const result = await write(THREAD_ACTIONS.recover, { botId, threadId })
    const sessionId = result?.sessionId ?? null
    if (typeof sessionId === 'string' && sessionId !== '') navigate(sessionId)
  }
  const renameThread = thread => {
    const name = draft.trim().slice(0, MAX_NAME)
    setRenaming(null); setDraft('')
    if (!name) return
    void write(THREAD_ACTIONS.rename, { botId, threadId: thread.threadId, name })
  }
  const archiveThread = thread => void write(THREAD_ACTIONS.archive, { botId, threadId: thread.threadId })
  const unarchiveThread = thread => void write(THREAD_ACTIONS.unarchive, { botId, threadId: thread.threadId })

  return (
    <section className="bp-threads" aria-label="会话线程">
      <header className="bp-threads-bar">
        <h2 className="bp-threads-title">会话线程</h2>
        <span className="bp-threads-count" aria-label={`${openCount} 条进行中，${archivedCount} 条已归档`}>{openCount} 进行中 · {archivedCount} 归档</span>
      </header>
      {feedback && <p className="bp-threads-note" role="alert">{feedback}</p>}
      {recover && (
        <div className="bp-threads-recover">
          <p className="bp-threads-note">这个线程上一次建立会话的结果未知：可能已经创建但未能记录。核对后由所有者确认恢复，宿主确认后才能继续对话。</p>
          <button type="button" className="bp-threads-button" onClick={() => recoverThread(recover)} disabled={pending}>
            <UiIcon name="refresh" size={16} /><span>核对并恢复这个线程</span>
          </button>
        </div>
      )}
      {status === 'unavailable' && <p className="bp-threads-note">当前连接暂不支持线程目录。宿主接入线程服务后，可在这里为同一个 Bot 建立多条独立会话。</p>}
      {status === 'loading' && <p className="bp-threads-note" role="status">正在读取线程目录…</p>}
      {status === 'error' && <p className="bp-threads-note" role="status">线程目录暂时没有更新，稍后会自动重试。</p>}
      {status === 'ready' && threads.length === 0 && <p className="bp-threads-note">这个 Bot 还没有线程。新建的线程使用 Bot 已保存的模型与权限，互不串上下文。</p>}
      {status === 'ready' && (
        <>
          <div className="bp-threads-new">
            <input className="bp-threads-input" value={draft} maxLength={MAX_NAME} placeholder="新线程名称（可留空）"
              aria-label="新线程名称" onChange={event => setDraft(event.target.value)}
              onKeyDown={event => { if (submits(event)) void createThread() }} />
            <button type="button" className="bp-threads-button" onClick={() => void createThread()} disabled={pending || renaming !== null}>
              <UiIcon name="plus" size={16} /><span>新建线程</span>
            </button>
          </div>
          <ul className="bp-threads-list">
            {threads.map(thread => (
              <li key={thread.threadId} className={`bp-thread${thread.active ? ' is-active' : ''}${isArchivedThread(thread) ? ' is-archived' : ''}`} data-thread={thread.threadId} data-state={isArchivedThread(thread) ? 'archived' : 'open'}>
                {renaming === thread.threadId ? (
                  <div className="bp-thread-rename">
                    <input className="bp-threads-input" value={draft} maxLength={MAX_NAME} aria-label="线程名称"
                      onChange={event => setDraft(event.target.value)}
                      onKeyDown={event => { if (submits(event)) renameThread(thread); if (event.key === 'Escape') { setRenaming(null); setDraft('') } }} />
                    <button type="button" className="bp-threads-button" onClick={() => renameThread(thread)} disabled={pending}>保存</button>
                    <button type="button" className="bp-threads-button is-quiet" onClick={() => { setRenaming(null); setDraft('') }}>取消</button>
                  </div>
                ) : (
                  <button type="button" className="bp-thread-open" onClick={() => switchTo(thread)} disabled={thread.active} aria-current={thread.active ? 'true' : undefined} aria-busy={pending ? 'true' : undefined}>
                    <span className="bp-thread-name">{threadLabel(thread)}</span>
                    <span className="bp-thread-meta">
                      {thread.active && <span className="bp-thread-badge">当前</span>}
                      {isArchivedThread(thread) && <span className="bp-thread-badge is-quiet">已归档 · 只读</span>}
                      {thread.sessionState === 'unbound' && <span className="bp-thread-badge is-wait">等待宿主确认归属</span>}
                      {thread.sessionState === 'unknown' && <span className="bp-thread-badge is-wait">建立结果未知</span>}
                      <span className="bp-thread-time">{formatThreadAt(thread.updatedAt)}</span>
                    </span>
                  </button>
                )}
                <div className="bp-thread-actions">
                  <button type="button" className="bp-threads-icon" onClick={() => { setRenaming(thread.threadId); setDraft(threadLabel(thread)) }} disabled={pending} aria-label="重命名线程"><UiIcon name="settings" size={16} /></button>                  {isArchivedThread(thread)
                    ? <button type="button" className="bp-threads-icon" onClick={() => unarchiveThread(thread)} disabled={pending} aria-label="恢复线程"><UiIcon name="refresh" size={16} /></button>
                    : <button type="button" className="bp-threads-icon" onClick={() => archiveThread(thread)} disabled={pending} aria-label="归档线程"><UiIcon name="folder" size={16} /></button>}
                </div>
              </li>
            ))}
          </ul>
          {active?.sessionState === 'unbound' && (
            <p className="bp-threads-note">当前线程的会话尚未得到宿主归属确认，暂时不能继续对话；这不影响新建、切换与归档。</p>
          )}
          {active?.sessionState === 'missing' && (
            <p className="bp-threads-note">当前线程的宿主会话已不存在，下次打开这个线程时会重新建立。</p>
          )}
          {isArchivedThread(active) && (
            <p className="bp-threads-note">已归档的线程可以只读打开，历史记录都还在；恢复之后才重新获得这个 Bot 的写入授权。</p>
          )}
        </>
      )}
    </section>
  )
}

/**
 * The chat-title addon: the active thread's name, with the counts needed to
 * decide whether to open the panel. It owns no state and dispatches nothing.
 */
export function BotThreadHeaderAddon({ thread, openCount = 0, archivedCount = 0, onOpen }) {
  if (!thread) return null
  return (
    <button type="button" className="bp-threads-head" onClick={onOpen} aria-label={`当前线程 ${threadLabel(thread)}，打开线程目录`}>
      <UiIcon name="list" size={14} />
      <span className="bp-threads-head-name">{threadLabel(thread)}</span>
      {openCount + archivedCount > 1 && <span className="bp-threads-head-count">{openCount + archivedCount}</span>}
    </button>
  )
}
