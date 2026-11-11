import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { UiIcon } from './ui-icons.jsx'
import nativeActivityCss from './native-activity.css'
import {
  NATIVE_ACTIVITY_LABELS, NATIVE_ACTIVITY_STATES,
  NATIVE_ACTIVITY_ACTION,
  createNativeActivityController, formatActivityAt, nativeActivityLatest, nativeActivityOutcomeWord,
  nativeActivityRecordingNote, nativeActivityScopeKey, nativeActivityState, nativeActivitySummary, nativeActivityTool,
} from './native-activity.mjs'
export { NATIVE_ACTIVITY_LABELS, NATIVE_ACTIVITY_STATES }

// The shared activity surface.
//
// One React surface serves both entry modes: the integrated chat header shows a
// compact chip with an anchored detail dialog, the independent transcript shows a
// compact card that expands in place. Both read the same owner action
// `nativeActivity.list`, through the same controller, and both show the same four
// honest states.
//
// What this surface cannot do is deliberate. There is no send, no stop, no
// retry, no approval and no task mutation anywhere in it: a cancel request and a
// confirmed stop are displayed as the two separate facts they are, and nothing
// here executes a tool. A tool's parameters and its result are not part of the
// observation, so the expanded detail shows provenance — record, turn, times,
// reported name — and says plainly that the command body is not available.

/** The stylesheet rides with the surface, so no other file has to import it. Two
 * mounted surfaces share one tag: the last one out removes it. */
function useNativeActivityStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const release = style => {
      const users = Math.max(0, Number(style.dataset.botNativeActivityUsers ?? '1') - 1)
      style.dataset.botNativeActivityUsers = String(users)
      if (users === 0) style.remove()
    }
    const existing = document.head.querySelector('style[data-bot-native-activity]')
    if (existing) {
      const users = Number(existing.dataset.botNativeActivityUsers ?? '1') + 1
      existing.dataset.botNativeActivityUsers = String(users)
      return () => release(existing)
    }
    const style = document.createElement('style')
    style.dataset.botNativeActivity = '1'
    style.dataset.botNativeActivityUsers = '1'
    style.textContent = nativeActivityCss
    document.head.append(style)
    return () => release(style)
  }, [])
}

const noopSubscribe = () => () => {}
const emptySnapshot = () => null

// Independent chat already owns a directory snapshot and supplies the flag.
// The integrated header has no directory state: read availability once per API,
// never start an activity poll against an older Host that did not advertise it.
function useAdvertisedActivity(productApi, enabled) {
  const [known, setKnown] = useState({ api: null, available: false })
  useEffect(() => {
    if (enabled !== undefined || typeof productApi?.snapshot !== 'function') return undefined
    let live = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    void Promise.resolve().then(() => productApi.snapshot(controller.signal)).then(value => {
      if (live && !controller.signal.aborted) setKnown({ api: productApi,
        available: value?.schemaVersion === 1 && Array.isArray(value.availableActions) && value.availableActions.includes(NATIVE_ACTIVITY_ACTION) })
    }, () => { if (live) setKnown({ api: productApi, available: false }) }).finally(() => clearTimeout(timer))
    return () => { live = false; clearTimeout(timer); controller.abort() }
  }, [productApi, enabled])
  return enabled === undefined ? known.api === productApi && known.available : enabled === true
}

/**
 * One controller for one mounted scope. A different API instance, Bot, mode,
 * session or context is a new scope: the previous controller is disposed (timer
 * cleared, in-flight read aborted) before the next one starts, so a retired
 * answer can never land in a new conversation.
 */
export function useNativeActivity({ productApi, botId, mode, sessionId, contextId, pollMs, limit, enabled } = {}) {
  const scopeKey = useMemo(() => {
    try { return nativeActivityScopeKey({ botId, mode, sessionId, contextId }) } catch { return null }
  }, [botId, mode, sessionId, contextId])
  const available = useAdvertisedActivity(productApi, scopeKey === null ? false : enabled)
  const controller = useMemo(() => {
    if (scopeKey === null || !available) return null
    try { return createNativeActivityController({ api: productApi, botId, mode, sessionId, contextId, pollMs, limit }) } catch { return null }
  }, [scopeKey, productApi, pollMs, limit, available])
  useEffect(() => {
    if (!controller) return undefined
    controller.start()
    return () => controller.dispose()
  }, [controller])
  const activity = useSyncExternalStore(controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : emptySnapshot, emptySnapshot)
  return { activity, controller }
}

/** Only a real observation is a surface: an unrecorded session shows nothing at all. */
const surfaceVisible = activity => activity !== null
  && (activity.items.length > 0 || activity.recording.status === 'degraded' || activity.error !== '')

function NativeActivityRow({ record, open, onToggle }) {
  const tool = nativeActivityTool(record), state = nativeActivityState(record), toggle = useRef(null)
  const close = useCallback(() => { onToggle(null); toggle.current?.focus() }, [onToggle])
  return <li className="bp-na-row" data-state={state} data-call-key={record.callKey}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !open || event.nativeEvent?.isComposing === true) return
      event.preventDefault(); event.stopPropagation(); close()
    }}>
    <span className="bp-na-row-icon"><UiIcon name={tool.icon} size={14} /></span>
    <span className="bp-na-row-body">
      <span className="bp-na-row-title">{tool.label}</span>
      <span className="bp-na-row-meta">
        <span className="bp-na-state" data-state={state}>{NATIVE_ACTIVITY_LABELS[state]}</span>
        <span>{formatActivityAt(record.startedAt)}</span>
      </span>
      {record.cancelRequested && !record.stopConfirmed && <span className="bp-na-row-note">已请求停止会话，进程停止尚未确认</span>}
      {record.stopConfirmed && <span className="bp-na-row-note">会话进程已停止</span>}
      {state === 'turn-unconfirmed' && record.lateCliReturn && <span className="bp-na-row-note">命令返回较晚，结果仍待核对</span>}
    </span>
    <button ref={toggle} type="button" className="bp-na-row-more" aria-expanded={open}
      aria-label={`${tool.label} 的记录详情`} onClick={() => onToggle(open ? null : record.callKey)}>{open ? '收起' : '详情'}</button>
    {open && <dl className="bp-na-detail">
      <dt>记录编号</dt><dd>{record.callKey}</dd>
      {record.turnId && <><dt>回合编号</dt><dd>{record.turnId}</dd></>}
      {record.callId && <><dt>调用编号</dt><dd>{record.callId}</dd></>}
      {record.toolName && <><dt>宿主报告的名称</dt><dd>{record.toolName}</dd></>}
      <dt>开始时间</dt><dd>{formatActivityAt(record.startedAt)}</dd>
      <dt>结束时间</dt><dd>{record.endedAt === null ? '尚未记录' : formatActivityAt(record.endedAt)}</dd>
      <dt>工具返回</dt><dd>{record.cliOk === true ? '已返回' : record.cliOk === false ? '返回错误' : '尚未记录'}</dd>
      <dt>回合结果</dt><dd>{record.turnOutcome === null ? '宿主未记录结果' : nativeActivityOutcomeWord(record.turnOutcome)}</dd>
      <dt>停止请求</dt><dd>{record.cancelRequested ? '已请求' : '未请求'}</dd>
      <dt>进程停止确认</dt><dd>{record.stopConfirmed ? '已确认' : '尚未确认'}</dd>
      <dd className="bp-na-detail-limit">这里不显示命令内容与返回内容；工具已返回或会话进程已停止，都不能证明远程操作已完成或停止。</dd>
    </dl>}
  </li>
}

/** The loaded records: latest4 as a view crop, older pages on an explicit read. */
function NativeActivityList({ activity, controller, shown = 4 }) {
  const [openKey, setOpenKey] = useState(null), [showAll, setShowAll] = useState(false)
  useEffect(() => { setOpenKey(null); setShowAll(false) }, [controller])
  const rows = showAll ? activity.items : nativeActivityLatest(activity.items, shown)
  const older = activity.items.length - rows.length
  return <>
    <p className="bp-na-scope">只显示当前已经读到的 {activity.items.length} 条记录，不是全部历史。</p>
    <ul className="bp-na-list">
      {rows.map(record => <NativeActivityRow key={record.callKey} record={record} open={openKey === record.callKey} onToggle={setOpenKey} />)}
    </ul>
    {activity.items.length > shown && <p className="bp-na-actions"><button type="button" onClick={() => setShowAll(value => !value)}>{showAll ? `只看最近 ${shown} 条` : `查看已读取的 ${activity.items.length} 条`}</button></p>}
    {older > 0 && <p className="bp-na-scope">还有 {older} 条更早的记录已经读到，可展开查看。</p>}
    {activity.truncated && <p className="bp-na-note">更早的记录没有全部载入，已停止继续读取。</p>}
    {activity.nextCursor !== null && <p className="bp-na-actions"><button type="button" disabled={activity.loadingOlder || activity.loading} onClick={() => { setShowAll(true); void controller?.older() }}>{activity.loadingOlder ? '正在读取…' : '读取更早的记录'}</button></p>}
    {activity.loadingOlder && <p className="bp-na-scope" role="status">正在读取更早的记录…</p>}
  </>
}

/** A read failure or a degraded recorder is always visible: it must never look like no work. */
function NativeActivityFlags({ activity }) {
  const error = activity.error !== '' ? activity.error : ''
  const degraded = nativeActivityRecordingNote(activity.recording)
  if (error === '' && degraded === '') return null
  return <>
    {error !== '' && <span className="bp-na-note" data-kind="failed" title={error}>{error}</span>}
    {degraded !== '' && <span className="bp-na-note" title={degraded}>{degraded}</span>}
  </>
}

/** The integrated header: a compact chip plus an anchored, dismissible detail dialog. */
export function NativeActivityHeader({ productApi, botId, sessionId, pollMs, limit, className, enabled }) {
  const { activity, controller } = useNativeActivity({ productApi, botId, mode: 'integration', sessionId, pollMs, limit, enabled })
  useNativeActivityStyles()
  const [open, setOpen] = useState(false), [place, setPlace] = useState(null)
  const root = useRef(null), chip = useRef(null), dialog = useRef(null)
  const close = useCallback(() => {
    setOpen(false)
    if (dialog.current?.contains(document.activeElement)) chip.current?.focus()
  }, [])
  useEffect(() => { setOpen(false) }, [controller])
  useEffect(() => {
    if (!open) { setPlace(null); return undefined }
    const measure = () => {
      const box = chip.current?.getBoundingClientRect()
      if (box === undefined) return
      const width = Math.min(360, Math.max(240, window.innerWidth - 24))
      const left = Math.min(Math.max(8, box.right - width), Math.max(8, window.innerWidth - width - 8))
      const below = box.bottom + 6, above = box.top - 6
      const room = Math.min(420, window.innerHeight - 32)
      setPlace({ left, ...(below + room < window.innerHeight || above < room ? { top: below } : { bottom: window.innerHeight - above }) })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    dialog.current?.focus()
    const away = event => { if (!dialog.current?.contains(event.target) && !root.current?.contains(event.target)) setOpen(false) }
    const key = event => {
      if (event.key === 'Escape' && event.nativeEvent?.isComposing !== true) { event.preventDefault(); close(); return }
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll('button:not([disabled]),[href],summary,[tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
  }, [open, close])
  if (!surfaceVisible(activity)) return null
  const summary = nativeActivitySummary(activity.items)
  const text = summary === null ? '工具记录读取异常' : summary.text
  const state = summary === null ? 'turn-unconfirmed' : summary.state
  const label = summary === null ? `${text}，打开工具记录详情` : `${text}，已读到 ${activity.items.length} 条，打开工具记录详情`
  return <span className={`bp-na-header${className ? ` ${className}` : ''}`} ref={root}>
    <button ref={chip} type="button" className="bp-na-chip" data-state={state} aria-haspopup="dialog" aria-expanded={open}
      title={label} aria-label={label} onClick={() => setOpen(value => !value)}>
      <UiIcon name={summary === null ? 'clock' : summary.icon} size={14} />
      <span className="bp-na-chip-text">{text}</span>
      {activity.items.length > 0 && <span className="bp-na-chip-count" aria-hidden="true">{activity.items.length}</span>}
    </button>
    <span className="bp-na-sr-only" role="status">{summary === null ? text : `${text}，共 ${activity.items.length} 条已读到`}</span>
    <NativeActivityFlags activity={activity} />
    {open && <div ref={dialog} className="bp-na-dialog" role="dialog" aria-modal="true" aria-label="工具记录" tabIndex={-1}
      style={place === null ? undefined : { left: `${place.left}px`, top: place.top === undefined ? undefined : `${place.top}px`, bottom: place.bottom === undefined ? undefined : `${place.bottom}px` }}>
      <header><strong>工具记录</strong><button type="button" aria-label="关闭工具记录" onClick={close}><UiIcon name="close" size={14} /></button></header>
      <div className="bp-na-dialog-body">
        <NativeActivityList activity={activity} controller={controller} />
      </div>
    </div>}
  </span>
}

/** The independent transcript: a compact card that expands in place, never a modal.
 *
 * The transcript is already one polite live region, so the card inside it adds no
 * second announcer: `announce` stays false there and true for a standalone card. */
export function NativeActivityCardView({ activity, controller, className, announce = true }) {
  useNativeActivityStyles()
  const [open, setOpen] = useState(false)
  const toggle = useRef(null)
  useEffect(() => { setOpen(false) }, [controller])
  if (!surfaceVisible(activity)) return null
  const summary = nativeActivitySummary(activity.items)
  const text = summary === null ? '工具记录读取异常' : summary.text
  const state = summary === null ? 'turn-unconfirmed' : summary.state
  const label = `${text}，${open ? '收起' : '展开'}工具记录`
  return <section className={`bp-na-card${className ? ` ${className}` : ''}`} data-state={state} aria-label="工具记录">
    <button ref={toggle} type="button" className="bp-na-card-toggle" aria-expanded={open} title={label} aria-label={label}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !open || event.nativeEvent?.isComposing === true) return
        event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus()
      }}
      onClick={() => setOpen(value => !value)}>
      <UiIcon name={summary === null ? 'clock' : summary.icon} size={14} />
      <span className="bp-na-chip-text">{text}</span>
      {activity.items.length > 0 && <span className="bp-na-card-count">已读到 {activity.items.length} 条</span>}
      <UiIcon name="chevron" size={13} style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
    </button>
    {announce && <span className="bp-na-sr-only" role="status">{summary === null ? text : `${text}，共 ${activity.items.length} 条已读到`}</span>}
    <NativeActivityFlags activity={activity} />
    {open && <div className="bp-na-card-body">
      <NativeActivityList activity={activity} controller={controller} />
    </div>}
  </section>
}

/** Self-contained card, for a caller that owns no controller of its own. */
export function NativeActivityCard({ productApi, botId, contextId, pollMs, limit, className, enabled }) {
  const owned = useNativeActivity({ productApi, botId, mode: 'independent', contextId, pollMs, limit, enabled })
  return <NativeActivityCardView activity={owned.activity} controller={owned.controller} className={className} />
}
