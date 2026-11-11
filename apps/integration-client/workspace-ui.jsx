import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { modelName, TASK_STATES } from './api.mjs'
import { taskIdOf, taskKey, taskTitle } from './task-progress.mjs'
import { workspaceOverview, workspaceSearch } from './workspace-model.mjs'
import { UiIcon } from './ui-icons.jsx'

const APPEARANCE_KEY = 'dsh.bot.workspace.appearance.v1'
const appearanceStores = new WeakMap()
const defaults = Object.freeze({ appearance: 'host', density: 'comfortable', chatWidth: 'standard', colorUserBubbles: true, saved: true })
const normalizeAppearance = value => ({ appearance: ['host', 'light', 'dark'].includes(value?.appearance) ? value.appearance : 'host',
  density: value?.density === 'compact' ? 'compact' : 'comfortable',
  chatWidth: ['standard', 'wide', 'full'].includes(value?.chatWidth) ? value.chatWidth : 'standard',
  colorUserBubbles: value?.colorUserBubbles !== false, saved: true })

export function workspaceAppearance(win = window) {
  if (appearanceStores.has(win)) return appearanceStores.get(win)
  let value = defaults
  const read = () => { try { return normalizeAppearance(JSON.parse(win.localStorage.getItem(APPEARANCE_KEY))) } catch { return defaults } }
  value = read()
  const listeners = new Set()
  const publish = () => { for (const listener of listeners) listener() }
  const store = Object.freeze({
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(patch) {
      value = normalizeAppearance({ ...value, ...patch })
      try { win.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ appearance: value.appearance, density: value.density,
        chatWidth: value.chatWidth, colorUserBubbles: value.colorUserBubbles })) }
      catch { value = { ...value, saved: false } }
      publish()
    },
    reload() { value = read(); publish() },
  })
  appearanceStores.set(win, store)
  return store
}

export function installWorkspaceAppearance(win = window) {
  const body = win.document.body, store = workspaceAppearance(win)
  const attributes = ['data-bp-appearance', 'data-bp-density', 'data-bp-chat-width', 'data-bp-user-bubbles']
  const previous = attributes.map(name => body.getAttribute(name))
  const paint = () => {
    const value = store.getSnapshot()
    body.setAttribute(attributes[0], value.appearance); body.setAttribute(attributes[1], value.density)
    body.setAttribute(attributes[2], value.chatWidth); body.setAttribute(attributes[3], value.colorUserBubbles ? 'colored' : 'neutral')
  }
  const onStorage = event => { if (event.key === APPEARANCE_KEY || event.key === null) store.reload() }
  const unsubscribe = store.subscribe(paint)
  paint(); win.addEventListener('storage', onStorage)
  return () => {
    unsubscribe(); win.removeEventListener('storage', onStorage)
    attributes.forEach((name, index) => previous[index] === null ? body.removeAttribute(name) : body.setAttribute(name, previous[index]))
  }
}

export function AppearanceControls() {
  const store = workspaceAppearance(), value = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return <details className="bp-appearance"><summary aria-label="外观与显示" title="外观与显示"><UiIcon name="sun" size={17} /></summary>
    <div className="bp-appearance-menu"><strong>外观与显示</strong>
      <fieldset><legend>颜色</legend><div className="bp-segmented">{[['host', '跟随宿主'], ['light', '浅色'], ['dark', '深色']].map(([key, label]) => <button key={key} type="button" aria-pressed={value.appearance === key} onClick={() => store.set({ appearance: key })}>{label}</button>)}</div></fieldset>
      <fieldset><legend>信息密度</legend><div className="bp-segmented">{[['comfortable', '舒适'], ['compact', '紧凑']].map(([key, label]) => <button key={key} type="button" aria-pressed={value.density === key} onClick={() => store.set({ density: key })}>{label}</button>)}</div></fieldset>
      <fieldset><legend>聊天宽度</legend><div className="bp-segmented">{[['standard', '标准'], ['wide', '宽屏'], ['full', '铺满']].map(([key, label]) => <button key={key} type="button" aria-pressed={value.chatWidth === key} onClick={() => store.set({ chatWidth: key })}>{label}</button>)}</div></fieldset>
      <fieldset><legend>我的消息气泡</legend><div className="bp-segmented">{[[true, '彩色'], [false, '素色']].map(([enabled, label]) => <button key={label} type="button" aria-pressed={value.colorUserBubbles === enabled} onClick={() => store.set({ colorUserBubbles: enabled })}>{label}</button>)}</div></fieldset>
      {!value.saved && <p role="status">已应用到此窗口，浏览器暂不能保存偏好。</p>}
    </div>
  </details>
}

export function WorkspaceToolbar({ title, onHome, onSearch }) {
  return <div className="bp-workspace-bar"><div className="bp-workspace-location"><button type="button" className="bp-workspace-brand" onClick={onHome} aria-label="返回工作空间总览"><UiIcon name="spark" size={18} /><span>DSH WORKSPACE</span></button><span className="bp-workspace-divider" aria-hidden="true">/</span><span className="bp-workspace-current">{title}</span></div>
    <div className="bp-workspace-bar-actions"><button type="button" className="bp-workspace-search" onClick={onSearch} aria-label="搜索工作空间"><UiIcon name="search" size={16} /><span>查找任务、伙伴、电脑</span><kbd>Ctrl K</kbd></button><AppearanceControls /></div>
  </div>
}

export function WorkspaceCommandPalette({ open, onClose, snapshot, onNavigate, openSession }) {
  const [query, setQuery] = useState(''), [cursor, setCursor] = useState(0)
  const input = useRef(null), close = useRef(null), selected = useRef(null)
  const listId = useId(), titleId = useId()
  const results = useMemo(() => workspaceSearch(snapshot, query), [snapshot, query])
  const position = results.items.length ? Math.min(cursor, results.items.length - 1) : 0
  useLayoutEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    setQuery(''); setCursor(0); input.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [open])
  useEffect(() => { selected.current?.scrollIntoView?.({ block: 'nearest' }) }, [position, query, open])
  if (!open) return null
  const activate = row => {
    onClose()
    if (row.kind === 'bot' && row.sessionId && typeof openSession === 'function') openSession(row.sessionId)
    else onNavigate(row.target)
  }
  const onKeyDown = event => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const length = results.items.length
      setCursor(length ? (position + (event.key === 'ArrowDown' ? 1 : -1) + length) % length : 0)
    } else if (event.key === 'Enter' && event.target !== close.current) {
      event.preventDefault(); if (results.items[position]) activate(results.items[position])
    } else if (event.key === 'Tab') {
      event.preventDefault(); if (document.activeElement === input.current) close.current?.focus(); else input.current?.focus()
    }
  }
  return <div className="bp-palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} onKeyDown={onKeyDown}>
    <section className="bp-palette" role="dialog" aria-modal="true" aria-labelledby={titleId}><h2 id={titleId} className="bp-sr-only">搜索工作空间</h2>
      <div className="bp-palette-input"><UiIcon name="search" size={20} /><input ref={input} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={results.items.length ? `${listId}-${position}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setCursor(0) }} placeholder="搜索任务、Bot、模型或操作编号…" aria-label="搜索任务、Bot 和电脑" autoComplete="off" /><button ref={close} type="button" aria-label="关闭搜索" onClick={onClose}><UiIcon name="close" size={18} /></button></div>
      <p className="bp-palette-caption">当前工作空间 · 仅搜索已加载记录{snapshot?.tasks?.truncated ? `（任务已加载 ${snapshot.tasks.items?.length ?? 0} / ${snapshot.tasks.total ?? '未知'} 条）` : ''}</p>
      <div className="bp-palette-results" id={listId} role="listbox" aria-label="搜索结果">{results.items.map((row, index) => <button key={row.id} id={`${listId}-${index}`} role="option" aria-selected={index === position} tabIndex={-1} type="button" ref={index === position ? selected : undefined} onMouseMove={() => setCursor(index)} onClick={() => activate(row)}>
        <span className="bp-result-icon"><UiIcon name={row.icon} size={19} /></span><span className="bp-result-copy"><strong>{row.label}</strong><small>{row.detail}</small></span><span className="bp-result-kind">{{ page: '页面', bot: 'Bot', task: '任务', machine: '电脑' }[row.kind]}</span><UiIcon name="chevron" size={14} />
      </button>)}{!results.items.length && <p className="bp-search-empty">没有匹配的记录。试试名称、模型或完整任务编号。</p>}</div>
      <footer className="bp-palette-footer"><span><kbd>↑ ↓</kbd> 选择 <kbd>Enter</kbd> 打开 <kbd>Esc</kbd> 关闭</span><span role="status">{results.total} 项{results.truncated ? `，显示前 ${results.items.length} 项` : ''}</span></footer>
    </section>
  </div>
}

const STAGES = { reconcile: ['收据待核对', 'clock'], approve: ['等待审批', 'lock'], 'remote-unknown': ['结果待确认', 'clock'], budget: ['等待预算', 'chart'], failed: ['执行失败', 'activity'], blocked: ['需要协助', 'inbox'] }
const when = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未提供'
const destinationFor = row => ({ section: 'tasks', botId: row.botId, taskId: taskIdOf(row) })

export function WorkspaceInbox({ snapshot, onNavigate, openSession, preview = false }) {
  const { progress, tasksAvailable } = useMemo(() => workspaceOverview(snapshot), [snapshot])
  const [stage, setStage] = useState('all')
  const rows = progress.attention.filter(row => stage === 'all' || row.stage === stage)
  const visible = preview ? rows.slice(0, 4) : rows
  return <section className={`bp-inbox${preview ? ' bp-inbox-preview' : ''}`} aria-label="任务待办">
    <div className="bp-section-heading"><div><p className="bp-section-kicker">NEEDS YOUR ATTENTION</p><h2>需要你处理 <span className="bp-count">{tasksAvailable ? progress.attention.length : '—'}</span></h2></div>{preview && progress.attention.length > 0 && <button className="bp-text-button" type="button" onClick={() => onNavigate({ section: 'inbox' })}>查看全部<UiIcon name="chevron" size={14} /></button>}</div>
    {!tasksAvailable ? <div className="bp-empty-work"><UiIcon name="inbox" size={28} /><p>{snapshot.tasks?.reason ?? '任务状态暂不可用。'}</p>{snapshot.tasks?.nextAction && <small>{snapshot.tasks.nextAction}</small>}</div> : <>
      {snapshot.tasks.truncated && <p className="bp-muted">待办来自已加载的 {progress.items.length} / {snapshot.tasks.total ?? '未知'} 条任务。</p>}
      {!preview && progress.attention.length > 0 && <div className="bp-inbox-filters" aria-label="按待办类型筛选"><button type="button" aria-pressed={stage === 'all'} onClick={() => setStage('all')}>全部 {progress.attention.length}</button>{Object.entries(STAGES).filter(([key]) => progress.attention.some(row => row.stage === key)).map(([key, [label]]) => <button type="button" key={key} aria-pressed={stage === key} onClick={() => setStage(key)}>{label} {progress.attention.filter(row => row.stage === key).length}</button>)}</div>}
      {!progress.attention.length ? <div className="bp-empty-work"><span className="bp-calm-mark"><UiIcon name="check" size={26} /></span><h3>暂时没有需要你介入的任务</h3><p>团队的任务进展会在这里汇集。</p><button type="button" onClick={() => onNavigate({ section: 'tasks' })}>查看团队任务<UiIcon name="arrow" size={14} /></button></div> : <div className="bp-inbox-rows">{visible.map(row => {
        const task = progress.items.find(item => taskKey(item) === taskKey(row))
        const bot = snapshot.bots?.find(item => item.id === row.botId)
        const [label, icon] = STAGES[row.stage] ?? ['需要处理', 'inbox']
        return <article key={taskKey(row)} className="bp-inbox-item" data-stage={row.stage}><span className="bp-inbox-icon"><UiIcon name={icon} size={18} /></span><div className="bp-inbox-copy"><span className="bp-state-label">{label}</span><h3><button type="button" className="bp-text-button" onClick={() => onNavigate(destinationFor(row))}>{task ? taskTitle(task) : row.title}</button></h3><p>{row.detail}</p><small>{bot?.name ?? row.botId ?? '归属未提供'}</small></div><div className="bp-inbox-actions"><button type="button" onClick={() => onNavigate(destinationFor(row))}>查看任务<UiIcon name="chevron" size={13} /></button>{row.stage === 'approve' && bot?.sessionId && openSession && <button type="button" onClick={() => openSession(bot.sessionId)}>打开审批会话</button>}</div></article>
      })}{!visible.length && <p className="bp-muted">该类型暂无待办。</p>}</div>}
    </>}
  </section>
}

export function WorkspaceHome({ snapshot, onNavigate, openSession, disabled }) {
  const overview = useMemo(() => workspaceOverview(snapshot), [snapshot])
  const [goal, setGoal] = useState('')
  const { progress, bots, machines, recent, tasksAvailable } = overview
  const canCompose = snapshot.availableActions?.includes('botRoutingInspect')
  const main = bots.find(bot => bot.main)
  const submit = event => { event.preventDefault(); if (!goal.trim() || disabled) return; onNavigate({ section: 'tasks', compose: true, draft: goal.trim() }); setGoal('') }
  return <div className="bp-home">
    <section className="bp-home-intro"><div><p className="bp-section-kicker">YOUR TEAM, IN MOTION</p><h1>下一件事，<br /><span>和团队一起完成。</span></h1><p>{bots.length ? `${bots.length} 位 Bot 伙伴，与目标、资料和工具在一个工作空间里。` : '从第一位 Bot 开始，组建适合你的工作团队。'}</p></div><div className="bp-home-orbit" aria-hidden="true"><span><UiIcon name="bot" size={35} /></span><i className="bp-orbit-node bp-orbit-one"><UiIcon name="file" size={20} /></i><i className="bp-orbit-node bp-orbit-two"><UiIcon name="computer" size={20} /></i><i className="bp-orbit-node bp-orbit-three"><UiIcon name="check" size={20} /></i></div></section>
    <div className="bp-home-stats" aria-label="已加载任务概览">{[['active', '进行中的任务', 'activity'], ['attention', '需要你处理', 'inbox'], ['finished', '已结束的任务', 'check']].map(([filter, label, icon]) => <button key={filter} type="button" onClick={() => onNavigate({ section: filter === 'attention' ? 'inbox' : 'tasks', filter })}><span className="bp-stat-icon"><UiIcon name={icon} size={18} /></span><span><strong>{tasksAvailable ? progress.counts[filter] : '—'}</strong><small>{label}</small></span><UiIcon name="arrow" size={15} /></button>)}<button type="button" onClick={() => onNavigate({ section: 'machines' })}><span className="bp-stat-icon"><UiIcon name="computer" size={18} /></span><span><strong>{snapshot.machines?.status === 'available' ? overview.onlineMachines : '—'}<em> / {snapshot.machines?.status === 'available' ? machines.length : '—'}</em></strong><small>在线电脑</small></span><UiIcon name="arrow" size={15} /></button></div>
    {overview.tasksTruncated && <p className="bp-loaded-note">任务统计仅包含已加载的 {progress.items.length} / {snapshot.tasks.total ?? '未知'} 条记录。</p>}
    <div className="bp-home-main"><div className="bp-home-primary"><section className="bp-goal-card"><div className="bp-section-heading"><div><p className="bp-section-kicker">START SOMETHING</p><h2>你想完成什么？</h2></div><span className="bp-goal-symbol"><UiIcon name="spark" size={21} /></span></div>
      {canCompose ? <form onSubmit={submit}><label className="bp-sr-only" htmlFor="bp-workspace-goal">任务目标</label><textarea id="bp-workspace-goal" value={goal} onChange={event => setGoal(event.target.value)} maxLength={20_000} rows={3} placeholder="描述你的目标，例如：检查这个项目，整理需要改进的地方…" /><div className="bp-goal-footer"><span><UiIcon name="lock" size={13} />先预览方案，再确认执行</span><button className="bp-button-primary" type="submit" disabled={disabled || !goal.trim()}>准备任务<UiIcon name="arrow" size={15} /></button></div></form> : <div className="bp-start-chat"><p>把目标告诉团队协调 Bot，或者在任务页查看已有工作。</p>{main?.sessionId && openSession ? <button className="bp-button-primary" type="button" onClick={() => openSession(main.sessionId)}>和 {main.name} 聊聊<UiIcon name="arrow" size={15} /></button> : <button type="button" onClick={() => onNavigate({ section: 'bindings' })}>查看团队<UiIcon name="arrow" size={15} /></button>}</div>}
    </section><WorkspaceInbox snapshot={snapshot} onNavigate={onNavigate} openSession={openSession} preview /></div>
    <aside className="bp-home-secondary"><section className="bp-recent"><div className="bp-section-heading"><div><p className="bp-section-kicker">RECENT WORK</p><h2>最近的工作</h2></div><button className="bp-text-button" type="button" onClick={() => onNavigate({ section: 'tasks' })} aria-label="查看全部任务"><UiIcon name="arrow" size={16} /></button></div>
      {!tasksAvailable ? <p className="bp-muted">任务记录暂不可用。</p> : recent.length ? <ol className="bp-recent-list">{recent.map(task => <li key={taskKey(task)}><span className="bp-recent-dot" data-state={progress.category(task)} aria-hidden="true" /><button type="button" className="bp-text-button" onClick={() => onNavigate(destinationFor(task))}><strong>{taskTitle(task)}</strong><small>{snapshot.bots?.find(bot => bot.id === task.botId)?.name ?? task.botId} · {TASK_STATES[task.state] ?? task.state}</small><time>{when(task.updatedAt ?? task.createdAt)}</time></button></li>)}</ol> : <div className="bp-empty-work"><UiIcon name="tasks" size={25} /><p>新的任务会出现在这里。</p></div>}
    </section><section className="bp-resource-links"><p className="bp-section-kicker">MAKE IT YOURS</p>{[['library', 'folder', '准备好资料', '把背景文件交给你的 Bot'], ['routine', 'repeat', '少做一次重复工作', '保存演示过的操作步骤']].map(([section, icon, title, detail]) => <button type="button" key={section} onClick={() => onNavigate({ section })}><UiIcon name={icon} size={19} /><span><strong>{title}</strong><small>{detail}</small></span><UiIcon name="chevron" size={14} /></button>)}</section></aside></div>
    <section className="bp-home-team"><div className="bp-section-heading"><div><p className="bp-section-kicker">PEOPLE TO WORK WITH</p><h2>你的 Bot 团队</h2></div><button type="button" className="bp-text-button" onClick={() => onNavigate({ section: 'bindings' })}>管理团队<UiIcon name="chevron" size={14} /></button></div>
      {bots.length ? <div className="bp-home-team-grid">{bots.slice(0, 8).map(bot => <button type="button" className="bp-home-person" key={bot.id} onClick={() => onNavigate({ section: 'bindings', botId: bot.id })}><span className="bp-team-avatar"><UiIcon name={bot.main ? 'spark' : 'bot'} size={24} /></span><span className="bp-home-person-copy"><strong>{bot.name}{bot.main && <span className="bp-main-label">协调</span>}</strong><small>{bot.role || '尚未填写职责'}</small><span className="bp-person-state" data-state={bot.state}>{bot.state === 'attention' ? `${bot.work.attention} 项待处理` : bot.state === 'active' ? `${bot.work.active} 项进行中` : '暂无进行中任务'}</span></span><UiIcon name="chevron" size={14} /></button>)}</div> : <p className="bp-muted">在侧栏新建 Bot 后，可在这里管理团队与工作配置。</p>}
      {bots.length > 8 && <button className="bp-text-button" type="button" onClick={() => onNavigate({ section: 'bindings' })}>查看全部 {bots.length} 位伙伴</button>}
    </section>
  </div>
}

export function TeamDirectory({ snapshot, selected, onSelect }) {
  const [query, setQuery] = useState('')
  const { bots } = useMemo(() => workspaceOverview(snapshot), [snapshot])
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  const rows = bots.filter(bot => terms.every(term => `${bot.name} ${bot.role ?? ''} ${modelName(bot.model)}`.toLocaleLowerCase().includes(term)))
  return <section className="bp-team-directory" aria-label="Bot 列表"><label className="bp-team-search"><UiIcon name="search" size={16} /><input aria-label="搜索团队成员" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索伙伴、职责、模型" type="search" /></label><div className="bp-team-directory-count">{rows.length} 位伙伴</div><div className="bp-team-directory-list">{rows.map(bot => <button type="button" key={bot.id} className="bp-team-member" aria-current={selected === bot.id ? 'true' : undefined} onClick={() => onSelect(bot.id)}><span className="bp-team-avatar"><UiIcon name={bot.main ? 'spark' : 'bot'} size={22} /></span><span><strong>{bot.name}{bot.main && <span className="bp-main-label">协调</span>}</strong><small>{bot.role || '尚未填写职责'}</small><span className="bp-team-model">{modelName(bot.model)}</span><span className="bp-person-state" data-state={bot.state}>{bot.state === 'attention' ? `${bot.work.attention} 项待处理` : bot.state === 'active' ? `${bot.work.active} 项进行中` : '暂无进行中任务'}</span></span></button>)}</div>{!rows.length && <p className="bp-muted">没有匹配的团队成员。</p>}</section>
}
