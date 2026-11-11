import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TASK_STATES } from './api.mjs'
import { botAttentionSummary, remoteUncertain } from './bot-attention.mjs'
import { filterTasks, progressNote, taskProgress, taskIdOf, taskKey, taskTitle, TASK_FILTERS, TASK_EVENTS } from './task-progress.mjs'
import { UiIcon } from './ui-icons.jsx'
import { taskBoard } from './workspace-model.mjs'

const Tag = ({ children }) => <span className="bp-tag">{children}</span>
const date = value => value === null || value === undefined || !Number.isFinite(new Date(value).getTime()) ? '未取得' : new Date(value).toLocaleString('zh-CN')
const Value = ({ label, children }) => <div className="bp-value"><dt>{label}</dt><dd>{children ?? '未取得'}</dd></div>
const stopKnown = row => !row.result?.remote || row.result.remote.stopConfirmed === true

function TaskActions({ row, actions, dispatch, busy }) {
  const pending = useRef(false)
  const run = async action => {
    if (busy || pending.current || !dispatch || !actions.includes(action)) return
    pending.current = true
    try { await dispatch(action, { botId: row.botId, taskId: taskIdOf(row), ...(action === 'task.cancel' ? {} : { requestKey: crypto.randomUUID() }) }) }
    finally { pending.current = false }
  }
  return <>
    {actions.includes('task.cancel') && !['cancelled', 'succeeded', 'failed', 'skipped'].includes(row.state) && <button disabled={busy} onClick={() => { void run('task.cancel') }}>停止</button>}
    {actions.includes('task.retry') && ['failed', 'cancelled', 'waiting-budget'].includes(row.state) && <button disabled={busy || !stopKnown(row)} onClick={() => { if (stopKnown(row)) void run('task.retry') }}>重试</button>}
    {actions.includes('task.reconcile') && row.state === 'needs-reconciliation' && <button disabled={busy} onClick={() => { void run('task.reconcile') }}>核对原收据</button>}
  </>
}

function RemoteNotice({ row }) {
  const remote = row.result?.remote
  if (!remote) return null
  if (!stopKnown(row)) return <small role="status">写入或停止尚未确认，请核对原操作；不会自动重发，也暂不能重试。</small>
  if (remote.notStarted === true && remote.possiblyApplied !== true) return <small>原操作未启动。</small>
  if (remote.status === 'succeeded') return <small>写入已确认。{row.state === 'cancelled' ? '取消未撤销文件变更。' : ''}</small>
  return remote.possiblyApplied === true ? <small>操作已停止，文件可能已改变；重试不会撤销已有变更，请先核对产物。</small> : null
}

function TaskDetail({ task, inspect, busy, actions, dispatch, onClose, bot, openSession, focusAttemptId }) {
  const [history, setHistory] = useState(null), [failure, setFailure] = useState(''), [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const ref = useRef(null)
  const key = taskKey(task)
  useEffect(() => { ref.current?.focus({ preventScroll: true }); ref.current?.scrollIntoView?.({ block: 'nearest' }) }, [key])
  useEffect(() => {
    const controller = new AbortController()
    setHistory(null); setFailure(''); setLoading(false)
    if (!inspect || !actions.includes('task.inspect')) return () => controller.abort()
    setLoading(true)
    Promise.resolve().then(() => { if (!controller.signal.aborted) return inspect({ botId: task.botId, taskId: taskIdOf(task) }, controller.signal) }).then(value => {
      if (controller.signal.aborted) return
      if (!value?.task || taskKey(value.task) !== key || !Array.isArray(value.attempts) || !Array.isArray(value.timeline?.items)
        || (task.updatedAt != null && (!Number.isFinite(value.task.updatedAt) || value.task.updatedAt < task.updatedAt))) throw new Error('返回记录与当前任务不一致，请刷新后再次读取。')
      setHistory(value)
    }).catch(cause => { if (!controller.signal.aborted) setFailure(cause.message || '任务时间线读取失败。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [key, task.updatedAt, inspect, actions.includes('task.inspect'), reload])
  const data = history?.task ?? task
  const requestedAttempt = focusAttemptId && history?.attempts.find(item=>item.attemptId===focusAttemptId)
  const missingAttempt = Boolean(history && focusAttemptId && !requestedAttempt)
  const historical = Boolean(focusAttemptId && focusAttemptId!==data.attemptId)
  const readOnlyDetail = Boolean(task.unloaded && !history || focusAttemptId && (!history || historical || missingAttempt))
  useEffect(()=>{if(requestedAttempt)ref.current?.querySelector('[data-focused-attempt]')?.scrollIntoView?.({block:'nearest'})},[history,focusAttemptId])
  return <article className="bp-card bp-task-detail" aria-label="任务详情" ref={ref} tabIndex={-1}>
    <div className="bp-card-title"><div><h2>任务详情</h2><p>{taskTitle(data)}</p></div><button type="button" onClick={onClose}>关闭</button></div>
    <div className="bp-actions"><Tag>{TASK_STATES[data.state] ?? data.state}</Tag><span>{bot?.name ?? task.botId ?? '未取得归属'}</span>
      {bot?.sessionId && openSession && <button type="button" onClick={() => openSession(bot.sessionId)}>打开 Bot 私聊</button>}
      {!readOnlyDetail && <TaskActions row={data} actions={actions} dispatch={dispatch} busy={busy} />}</div>
    {task.unloaded && <p className="bp-muted">原任务未包含在当前列表，详情通过原 Bot 与 Task 编号单独读取。</p>}
    {missingAttempt && <p role="alert" className="bp-blocked">未找到所选的原执行尝试。请在原 Bot 会话核对执行记录。</p>}
    {requestedAttempt && <section className="bp-blocked" aria-label="所选原执行尝试"><strong>第 {requestedAttempt.number} 次尝试 · {TASK_STATES[requestedAttempt.state]??requestedAttempt.state}</strong>
      {historical && <p>此处定位历史尝试，当前任务已进入后续尝试。原记录只读。</p>}
      <p>开始 {date(requestedAttempt.startedAt)} · 结束 {date(requestedAttempt.finishedAt)}</p><small className="bp-code">{requestedAttempt.attemptId} · {requestedAttempt.operationId}</small></section>}
    <RemoteNotice row={data} />
    <dl className="bp-facts"><Value label="创建">{date(data.createdAt)}</Value><Value label="最近更新">{date(data.updatedAt)}</Value><Value label="期限">{date(data.deadlineAt)}</Value>{data.attribution?.label && <Value label="执行进度">{data.attribution.label}</Value>}</dl>
    <h3>任务时间线</h3>
    {loading && <p role="status" className="bp-muted">正在读取原任务日志…</p>}
    {failure && <p role="alert" className="bp-error">{failure}</p>}
    {inspect && actions.includes('task.inspect') && <button type="button" disabled={loading} onClick={() => setReload(value => value + 1)}>重新读取时间线</button>}
    {!actions.includes('task.inspect') && <p className="bp-muted">此宿主尚未提供任务时间线，可在下方查看现有收据依据。</p>}
    {history && <>
      <p className="bp-muted">{history.attempts.length} 次执行尝试 · {history.timeline.total} 条日志{history.timeline.truncated ? `，显示最近 ${history.timeline.items.length} 条` : ''}。停止请求需等待原操作确认。</p>
      <ol className="bp-task-timeline">{history.timeline.items.map(event => <li key={event.seq} data-focused-attempt={focusAttemptId&&event.attemptId===focusAttemptId?'':undefined}>
        <span className="bp-timeline-dot" aria-hidden="true" /><div><strong>{TASK_EVENTS[event.kind] ?? '任务状态更新'}</strong>
          <small><time>{date(event.at)}</time>{event.attemptNumber != null ? ` · 第 ${event.attemptNumber} 次尝试` : ''}{event.outcome ? ` · ${TASK_STATES[event.outcome] ?? (event.outcome === 'unknown' ? '结果未知' : event.outcome)}` : ''}</small>
          {event.code && <small className="bp-code">{event.code}</small>}</div>
      </li>)}</ol>
      {history.timeline.items.length === 0 && <p className="bp-muted">原日志中暂无事件。</p>}
      <details className="bp-technical"><summary>每次尝试的身份与时间</summary><ul className="bp-checklist">{history.attempts.map(attempt => <li key={attempt.attemptId}>
        <strong>第 {attempt.number} 次 · {TASK_STATES[attempt.state] ?? attempt.state}</strong><small>开始 {date(attempt.startedAt)} · 结束 {date(attempt.finishedAt)}</small><small className="bp-code">{attempt.attemptId} · {attempt.operationId}</small>
      </li>)}</ul></details>
    </>}
    <details className="bp-technical"><summary>原任务与操作编号</summary><dl className="bp-facts"><Value label="Task">{taskIdOf(data)}</Value><Value label="Package">{data.packageId}</Value><Value label="Attempt">{data.attemptId}</Value><Value label="Operation">{data.operationId}</Value><Value label="MR 运行">{data.legacyRunIds?.join('、')}</Value></dl></details>
    <details className="bp-technical"><summary>执行与收据依据</summary><pre>{JSON.stringify({ attempts: history?.attempts ?? task.attempts, executionRef: task.executionRef, remoteReceipt: data.result?.remote, reconciliation: data.reconciliation, packages: task.packages }, null, 2)}</pre></details>
  </article>
}

export function TaskWorkspace({ snapshot, dispatch, busy, scope, inspect, openSession, routingCard, focus }) {
  const progress = useMemo(() => taskProgress(snapshot), [snapshot])
  const [botId, setBotId] = useState(''), [status, setStatus] = useState('all'), [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false), [selection, setSelection] = useState(null)
  const [view, setView] = useState('list'), [focusMissing, setFocusMissing] = useState(false)
  useEffect(() => { setBotId(''); setStatus('all'); setQuery(''); setExpanded(false); setSelection(null); setFocusMissing(false) }, [scope])
  useEffect(() => {
    if (!focus) return
    setQuery(''); setStatus(focus.filter ?? 'all'); setBotId(focus.taskId ? '' : focus.botId ?? '')
    const target = focus.taskId ? progress.items.find(row => taskIdOf(row) === focus.taskId && row.botId === focus.botId) : null
    const canReadMissing = focus.taskId && focus.botId && inspect && snapshot.availableActions?.includes('task.inspect') && snapshot.bots?.some(bot=>bot.id===focus.botId)
    setSelection(target ? { scope, key: taskKey(target), attemptId:focus.attemptId } : canReadMissing ? {scope,key:taskKey(focus),attemptId:focus.attemptId,
      lookup:{botId:focus.botId,taskId:focus.taskId,state:'unloaded',title:'原任务',unloaded:true,attempts:0}} : null)
    setFocusMissing(Boolean(focus.taskId && !target && !canReadMissing))
  }, [focus?.version, scope, Boolean(inspect), snapshot.availableActions?.includes('task.inspect')])
  const rows = filterTasks(progress, { botId, status, query })
  const task = selection && selection.scope === scope ? progress.items.find(row => taskKey(row) === selection.key) ?? selection.lookup : null
  const actions = snapshot.availableActions ?? []
  const select = row => setSelection({ scope, key: taskKey(row) })
  const attention = expanded ? progress.attention : progress.attention.slice(0, 6)
  const [showPlans, setShowPlans] = useState(false)
  return <>
    {focusMissing && <p className="bp-blocked" role="status">所选任务不在当前已加载的记录中。请刷新记录，或返回原 Bot 会话核对。</p>}
    <section className="bp-card bp-task-overview" aria-label="多 Bot 任务总览">
      <div className="bp-card-title"><div><h2>团队任务</h2><p className="bp-muted">按 Bot 查看进展，优先处理需要你介入的任务。</p></div><Tag>{progress.items.length} 条已加载</Tag></div>
      {snapshot.tasks.truncated && <p role="status" className="bp-blocked">已加载 {progress.items.length} / {snapshot.tasks.total} 条任务，优先显示待处理与进行中的记录。下方数量与筛选仅针对已加载任务。</p>}
      <div className="bp-task-counts" aria-label="按状态筛选任务">{TASK_FILTERS.map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}><strong>{progress.counts[value]}</strong><span>{label}</span></button>)}</div>
      <div className="bp-task-bots" aria-label="按 Bot 筛选任务"><button type="button" aria-pressed={!botId} onClick={() => setBotId('')}>全部 Bot</button>{progress.bots.map(bot => <button key={bot.botId ?? ''} type="button" aria-pressed={botId === bot.botId} onClick={() => setBotId(bot.botId ?? '')}>
        <UiIcon name="bot" size={16} /><span>{bot.name}<small>{bot.active} 进行中 · {bot.attention} 待处理 · {bot.all} 条任务</small></span></button>)}</div>
    </section>
    {progress.attention.length > 0 && <section className="bp-card bp-attention" aria-label="需要你处理">
      <div className="bp-card-title"><h2>需要你处理</h2><Tag>{botAttentionSummary(progress.attention)}</Tag></div>
      <ul className="bp-attention-list">{attention.map(row => {
        const original = progress.items.find(task => taskKey(task) === taskKey(row))
        return <li key={taskKey(row)} className={`bp-attention-row bp-attention-${row.stage}`}><div><strong>{row.title}</strong><p className="bp-muted">{row.detail}</p>
          {row.stage === 'approve' && <small>打开 Bot 私聊查看原审批请求。</small>}
          {remoteUncertain(original) && <small>原操作仍待核对，请查看任务详情。</small>}</div><div className="bp-actions">
          <button type="button" onClick={() => select(original)}>打开任务</button>
          {row.stage === 'approve' && openSession && snapshot.bots?.find(bot => bot.id === row.botId)?.sessionId && <button type="button" onClick={() => openSession(snapshot.bots.find(bot => bot.id === row.botId).sessionId)}>打开审批会话</button>}
          {row.stage === 'reconcile' && actions.includes('task.reconcile') && <TaskActions row={original} actions={['task.reconcile']} dispatch={dispatch} busy={busy} />}
          {row.stage === 'failed' && actions.includes('task.retry') && <TaskActions row={original} actions={['task.retry']} dispatch={dispatch} busy={busy} />}
        </div></li>
      })}</ul>
      {progress.attention.length > 6 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起待处理事项' : `查看全部 ${progress.attention.length} 项待处理`}</button>}
    </section>}
    {task && <TaskDetail key={taskKey(task)} task={task} focusAttemptId={selection.attemptId} inspect={inspect} busy={busy} actions={actions} dispatch={dispatch} onClose={() => setSelection(null)} bot={snapshot.bots?.find(bot => bot.id === task.botId)} openSession={openSession} />}
    <section className="bp-card bp-task-records" aria-label="任务记录"><div className="bp-card-title"><div><h2>任务记录</h2><span className="bp-muted" role="status">显示 {rows.length} / {progress.items.length} 条</span></div><div className="bp-segmented" role="group" aria-label="任务显示方式"><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><UiIcon name="list" size={15} />列表</button><button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}><UiIcon name="board" size={15} />看板</button></div></div>
      <div className="bp-task-search"><label>搜索任务<input type="search" value={query} placeholder="任务名称、Bot 或任务 / 计划 / 操作编号" onChange={event => setQuery(event.target.value)} /></label>
        {(query || botId || status !== 'all') && <button type="button" onClick={() => { setQuery(''); setBotId(''); setStatus('all') }}>清除筛选</button>}</div>
      {!progress.items.length ? <p className="bp-empty">尚无持久任务。在 Main 私聊中提出目标后，可在这里查看工作包、执行尝试与收据。</p> : rows.length === 0 ? <p className="bp-empty">没有符合当前筛选的任务。可清除筛选查看其他记录。</p> : view === 'board' ? <div className="bp-board" aria-label="任务看板">{taskBoard(progress, rows).map(lane => <section key={lane.id} className="bp-board-lane" aria-label={lane.title} data-lane={lane.id}><h3><UiIcon name={lane.icon} size={15} />{lane.title}<span>{lane.items.length}</span></h3><div className="bp-board-items">{lane.items.map(row => <article key={taskKey(row)} className="bp-board-card"><span className="bp-board-state">{TASK_STATES[row.state] ?? row.state}</span><button type="button" className="bp-text-button" onClick={() => select(row)}>{taskTitle(row)}</button><p>{snapshot.bots?.find(bot => bot.id === row.botId)?.name ?? row.botId ?? '归属未提供'}</p>{row.blockedReason && <small>{row.blockedReason}</small>}<RemoteNotice row={row} /><footer><time>{date(row.updatedAt)}</time><div className="bp-actions"><TaskActions row={row} actions={actions} dispatch={dispatch} busy={busy} /></div></footer></article>)}{!lane.items.length && <p className="bp-board-empty">暂无任务</p>}</div></section>)}</div> : <div className="bp-table-wrap"><table>
        <thead><tr><th>任务</th><th>Bot</th><th>状态</th><th>执行尝试</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={taskKey(row)}>
          <td><button className="bp-text-button" onClick={() => select(row)}>{taskTitle(row)}</button><small>更新 {date(row.updatedAt)}</small></td>
          <td>{snapshot.bots?.find(bot => bot.id === row.botId)?.name ?? row.botId ?? '未取得归属'}</td><td><Tag>{TASK_STATES[row.state] ?? row.state}</Tag>{progressNote(row, TASK_STATES[row.state] ?? row.state) && <small>{progressNote(row, TASK_STATES[row.state] ?? row.state)}</small>}{row.blockedReason && <small>{row.blockedReason}</small>}<RemoteNotice row={row} /></td>
          <td>{Number.isSafeInteger(row.attempts) ? row.attempts : row.attempts?.length ?? row.attemptCount ?? '未知'}</td><td className="bp-actions"><TaskActions row={row} actions={actions} dispatch={dispatch} busy={busy} /></td>
        </tr>)}</tbody></table></div>}
    </section>
    {snapshot.tasks.plans?.length > 0 && <section className="bp-task-plans"><button type="button" aria-expanded={showPlans} onClick={() => setShowPlans(value => !value)}>{showPlans ? '收起协作计划' : `查看 ${snapshot.tasks.plans.length} 个协作计划`}</button>
      {/* Dependency and cancellation evidence stays visible even when other plans are collapsed. */}
      {snapshot.tasks.plans.filter(plan => showPlans || plan.needsReconciliation || !['succeeded', 'cancelled', 'failed'].includes(plan.state)).map((plan, index) => <article className="bp-card" key={plan.planId}>
        <div className="bp-card-title"><div><h2>协作计划 {index + 1}</h2><p className="bp-muted">{plan.packages.length} 个工作包 · {plan.packages.filter(item => item.state === 'succeeded').length} 个已完成</p></div><div className="bp-actions"><Tag>{TASK_STATES[plan.state] ?? plan.state}</Tag>
          {actions.includes('task.plan.cancel') && !['succeeded', 'cancelled'].includes(plan.state) && <button disabled={busy} onClick={() => dispatch('task.plan.cancel', { botId: plan.ownerBotId, planId: plan.planId })}>停止整个计划</button>}</div></div>
        {plan.needsReconciliation && <p role="status">有工作包停止尚未确认，请核对原收据；计划尚未完成停止。</p>}
        <ul className="bp-plan-list">{plan.packages.map((item, step) => {
          const linked = progress.items.find(row => taskIdOf(row) === item.taskId && row.botId === item.targetBotId)
          return <li key={item.id}><span className="bp-plan-step">{item.state === 'succeeded' ? <UiIcon name="check" size={13} /> : step + 1}</span><div className="bp-plan-copy">
            {linked ? <button className="bp-text-button" onClick={() => select(linked)}>{taskTitle(linked)}</button> : <strong>{plan.plan?.packages?.find(pkg => pkg.id === item.id)?.objective ?? `工作包 ${step + 1}`}</strong>}
            <small>{snapshot.bots?.find(bot => bot.id === item.targetBotId)?.name ?? item.targetBotId}{item.dependsOn.length > 0 && ` · 前置：${item.dependsOn.join('、')}`}{item.result?.code === 'DEPENDENCY_FAILED' && ' · 前置包失败，尚未执行'}</small></div><Tag>{TASK_STATES[item.state] ?? item.state}</Tag></li>
        })}</ul><details className="bp-technical bp-plan-id"><summary>计划编号</summary><p className="bp-code">{plan.planId}</p></details>
      </article>)}
    </section>}
    {routingCard}
  </>
}
