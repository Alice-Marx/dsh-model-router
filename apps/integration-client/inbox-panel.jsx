import React from 'react'
import { UiIcon } from './ui-icons.jsx'
import { deriveBotAttention } from './bot-attention.mjs'
import { modelLabel } from './models-panel.jsx'

const short = (value, limit = 90) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}
const when = value => {
  const time = typeof value === 'number' ? value : Date.parse(value ?? '')
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

/**
 * Everything waiting on a person, from committed Host state only: tasks in a blocking state,
 * unconfirmed charges, Bots whose model cannot be funded, and official tools that need a login.
 */
export function inboxRows(snapshot, panels) {
  const bots = snapshot?.bots ?? []
  const nameOf = id => bots.find(bot => bot.id === id)?.name ?? id
  const rows = deriveBotAttention(snapshot, { limit: 50 }).map(row => ({ ...row, target: panels.tasks, button: '打开任务' }))
  for (const item of snapshot?.usage?.unresolved ?? []) {
    rows.push({ key: `usage:${item.runId}/${item.packageId}`, stage: 'reconcile', title: `${nameOf(item.botId)} 有一笔费用待核对`,
      detail: `${item.provider ?? '未知'}/${item.model ?? '未知'} 没有可核验的账单；核对前此 Bot 不会发起新的付费调用。`, target: panels.usage, button: '去核对' })
  }
  for (const item of snapshot?.quickBinding?.items ?? []) {
    const bot = bots.find(row => row.id === item.botId)
    if (item.mode === 'quick' && item.funding === 'api' && !item.priced) {
      rows.push({ key: `price:${item.botId}`, stage: 'budget', title: `${bot?.name ?? item.botId} 的模型还没有价格`,
        detail: `${modelLabel(item.model, snapshot.engines)} 按 API 计费，需要先填写价格才能调用。`, target: panels.bindings, button: '填写价格' })
    } else if (item.mode === 'no-model') {
      rows.push({ key: `model:${item.botId}`, stage: 'blocked', title: `${bot?.name ?? item.botId} 还没有选模型`,
        detail: '在私聊顶部的模型菜单里选一个模型，Bot 就能开始工作。', session: bot?.sessionId, button: '打开私聊' })
    } else if (item.mode === 'blocked') {
      rows.push({ key: `binding:${item.botId}`, stage: 'blocked', title: `${bot?.name ?? item.botId} 的绑定需要修复`,
        detail: item.reason ?? '高级绑定已失效，修复前不会授予执行权限。', target: panels.bindings, button: '查看绑定' })
    }
  }
  for (const engine of snapshot?.engines?.items ?? []) {
    const users = bots.filter(bot => String(bot.model ?? '').startsWith(`${engine.provider}/`))
    if (!users.length || !['login', 'missing'].includes(engine.state)) continue
    const name = String(engine.name).replace(/（官方工具）$/, '')
    rows.push({ key: `engine:${engine.provider}`, stage: 'blocked', title: engine.state === 'login' ? `${name} 需要重新登录` : `${name} 尚未安装`,
      detail: `${users.map(bot => bot.name).join('、')} 正在用它；${engine.state === 'login' ? `在终端运行 ${engine.login?.command ?? ''} 登录。` : '安装后即可使用。'}`, target: panels.engines, button: '查看引擎' })
  }
  return rows
}

export function Inbox({ snapshot, panels, openPanel, openSession }) {
  const rows = inboxRows(snapshot, panels)
  const tasks = Array.isArray(snapshot?.tasks?.items) ? snapshot.tasks.items : []
  const stamp = task => {
    const value = task.updatedAt ?? task.createdAt
    return typeof value === 'number' ? value : Date.parse(value ?? '') || 0
  }
  const running = tasks.filter(task => ['running', 'queued', 'ready', 'admitting', 'cancelling'].includes(task.state)).sort((a, b) => stamp(b) - stamp(a)).slice(0, 6)
  const done = tasks.filter(task => task.state === 'succeeded').sort((a, b) => stamp(b) - stamp(a)).slice(0, 8)
  const nameOf = id => (snapshot?.bots ?? []).find(bot => bot.id === id)?.name ?? id ?? '未归属'
  const go = row => row.session ? openSession?.(row.session) : openPanel?.(row.target)
  return <>
    <section className="bp-card" aria-label="待你处理">
      <div className="bp-card-title"><div><h2>待你处理 <span className="bp-inline-count">{rows.length} 项</span></h2>
        <p className="bp-muted">只列出宿主已记录、确实卡在你这里的事项。Bot 自己说「卡住了」不会出现在这里。</p></div></div>
      {rows.length === 0 ? <div className="bp-empty-state"><span className="bp-empty-icon"><UiIcon name="check" size={24} /></span><strong>一切就绪</strong><p>没有需要你决定或修复的事项。</p></div>
        : <ul className="bp-inbox-list">{rows.map(row => <li key={row.key} className="bp-inbox-row" data-stage={row.stage}>
          <span className="bp-inbox-dot" aria-hidden="true" /><div className="bp-inbox-copy"><strong>{row.title}</strong><p className="bp-muted">{row.detail}</p></div>
          <button type="button" onClick={() => go(row)}>{row.button}<UiIcon name="chevron" size={13} /></button></li>)}</ul>}
    </section>
    {running.length > 0 && <section className="bp-card" aria-label="进行中">
      <div className="bp-card-title"><h2>进行中 <span className="bp-inline-count">{running.length}</span></h2><button type="button" onClick={() => openPanel?.(panels.tasks)}>全部任务</button></div>
      <ul className="bp-inbox-list">{running.map(task => <li key={task.taskId ?? task.id} className="bp-inbox-row" data-stage="running">
        <span className="bp-inbox-dot" aria-hidden="true" /><div className="bp-inbox-copy"><strong>{short(task.title ?? task.input?.task ?? task.taskId)}</strong><p className="bp-muted">{nameOf(task.botId)}{when(stamp(task)) ? ` · ${when(stamp(task))}` : ''}</p></div></li>)}</ul>
    </section>}
    <section className="bp-card" aria-label="已完成">
      <div className="bp-card-title"><h2>最近完成</h2>{done.length > 0 && <button type="button" onClick={() => openPanel?.(panels.tasks)}>全部任务</button>}</div>
      {done.length === 0 ? <p className="bp-muted">还没有完成的任务。</p> : <ul className="bp-inbox-list">{done.map(task => <li key={task.taskId ?? task.id} className="bp-inbox-row" data-stage="done">
        <span className="bp-inbox-dot" aria-hidden="true" /><div className="bp-inbox-copy"><strong>{short(task.title ?? task.input?.task ?? task.taskId)}</strong><p className="bp-muted">{nameOf(task.botId)}{when(stamp(task)) ? ` · ${when(stamp(task))}` : ''}</p></div></li>)}</ul>}
    </section>
  </>
}
