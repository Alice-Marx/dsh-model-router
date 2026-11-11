import { modelName, TASK_STATES } from './api.mjs'
import { taskProgress, taskIdOf, taskKey, taskTitle } from './task-progress.mjs'
import { WORKSPACE_SECTIONS } from './workspace-navigation.mjs'

const timestamp = value => value !== null && value !== undefined && value !== '' && Number.isFinite(new Date(value).getTime()) ? new Date(value).getTime() : null
const summary = (value, length = 140) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length)

export function workspaceOverview(snapshot) {
  const progress = taskProgress(snapshot)
  const bots = (snapshot?.bots ?? []).map(bot => {
    const work = progress.bots.find(row => row.botId === bot.id)
    return { ...bot, work, state: work?.attention ? 'attention' : work?.active ? 'active' : 'idle' }
  })
  const machines = snapshot?.machines?.status === 'available' ? (snapshot.machines.items ?? []).filter(row => row.status !== 'revoked') : []
  const recent = [...progress.items].sort((a, b) => (timestamp(b.updatedAt ?? b.createdAt) ?? -1) - (timestamp(a.updatedAt ?? a.createdAt) ?? -1)).slice(0, 6)
  return { progress, bots, machines, recent, onlineMachines: machines.filter(row => row.status === 'online').length,
    workingBots: bots.filter(bot => bot.state === 'active').length,
    tasksAvailable: snapshot?.tasks?.status === 'available', tasksTruncated: snapshot?.tasks?.truncated === true,
  }
}

export function taskBoard(progress, rows = progress.items) {
  const lanes = [
    { id: 'queued', title: '待开始', icon: 'clock', items: [] },
    { id: 'running', title: '进行中', icon: 'activity', items: [] },
    { id: 'attention', title: '需要处理', icon: 'inbox', items: [] },
    { id: 'finished', title: '已结束', icon: 'check', items: [] },
    { id: 'other', title: '其他状态', icon: 'tasks', items: [] },
  ]
  const byId = new Map(lanes.map(lane => [lane.id, lane]))
  for (const row of rows) {
    const category = progress.category(row)
    const id = category === 'attention' ? 'attention' : category === 'finished' ? 'finished'
      : ['running', 'cancelling'].includes(row.state) ? 'running' : ['queued', 'ready', 'admitting'].includes(row.state) ? 'queued' : 'other'
    byId.get(id).items.push(row)
  }
  return lanes.filter(lane => lane.id !== 'other' || lane.items.length > 0)
}

/** Search only the current committed projection; no transcripts or credentials enter this index. */
export function workspaceSearch(snapshot, query = '', limit = 60) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  const rows = WORKSPACE_SECTIONS.map(row => ({ id: `page:${row.section}`, kind: 'page', label: row.label, detail: row.description,
    icon: row.icon, target: { section: row.section }, keywords: row.title }))
  for (const bot of snapshot?.bots ?? []) {
    rows.push({ id: `bot:${bot.id}`, kind: 'bot', label: summary(bot.name), detail: summary(bot.role || modelName(bot.model)), icon: 'bot',
      target: { section: 'bindings', botId: bot.id }, sessionId: bot.sessionId, keywords: `${bot.id} ${modelName(bot.model)}` })
  }
  for (const task of taskProgress(snapshot).items) {
    const bot = snapshot?.bots?.find(row => row.id === task.botId)
    rows.push({ id: `task:${taskKey(task)}`, kind: 'task', label: summary(taskTitle(task)), detail: `${bot?.name ?? task.botId ?? '未取得归属'} · ${TASK_STATES[task.state] ?? task.state}`,
      icon: 'tasks', target: { section: 'tasks', botId: task.botId, taskId: taskIdOf(task) },
      keywords: [taskIdOf(task), task.operationId, task.attemptId, task.planId].filter(Boolean).join(' ') })
  }
  if (snapshot?.machines?.status === 'available') for (const machine of snapshot.machines.items ?? []) {
    if (machine.status === 'revoked') continue
    rows.push({ id: `machine:${machine.id}`, kind: 'machine', label: summary(machine.name || machine.id), detail: '电脑', icon: 'computer',
      target: { section: 'machines', machineId: machine.id }, keywords: machine.id })
  }
  const matches = rows.map((row, index) => {
    const label = row.label.toLocaleLowerCase(), haystack = `${label} ${row.detail} ${row.keywords ?? ''}`.toLocaleLowerCase()
    if (!terms.every(term => haystack.includes(term))) return null
    return { row, rank: terms.length ? terms.every(term => label.startsWith(term)) ? 0 : terms.every(term => label.includes(term)) ? 1 : 2 : 0, index }
  }).filter(Boolean).sort((a, b) => a.rank - b.rank || a.index - b.index)
  const count = Math.max(1, Math.min(120, Number.isFinite(limit) ? Math.floor(limit) : 60))
  return { items: matches.slice(0, count).map(match => match.row), total: matches.length, truncated: matches.length > count }
}
