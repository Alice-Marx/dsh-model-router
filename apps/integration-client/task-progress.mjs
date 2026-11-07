import { deriveBotAttention } from './bot-attention.mjs'

export const taskIdOf = row => row.taskId ?? row.id
export const taskKey = row => JSON.stringify([row.botId ?? '', taskIdOf(row)])
export const taskTitle = row => row.title || row.input?.task || taskIdOf(row) || '未命名任务'
export const TASK_FILTERS = Object.freeze([['all', '全部'], ['active', '进行中'], ['attention', '待处理'], ['finished', '已结束']])
const active = new Set(['queued', 'ready', 'running', 'admitting', 'cancelling'])
const ended = new Set(['succeeded', 'cancelled', 'skipped'])

/** Counts describe only the loaded, committed records. A truncated view says so in the UI. */
export function taskProgress(snapshot) {
  const items = snapshot?.tasks?.status === 'available' && Array.isArray(snapshot.tasks.items) ? snapshot.tasks.items : []
  const attention = deriveBotAttention({ ...snapshot, tasks: { items } }, { limit: Infinity })
  const attentionKeys = new Set(attention.map(row => taskKey(row)))
  const category = row => attentionKeys.has(taskKey(row)) ? 'attention' : active.has(row.state) ? 'active' : ended.has(row.state) ? 'finished' : 'other'
  const bots = new Map((snapshot?.bots ?? []).map(bot => [bot.id, { botId: bot.id, name: bot.name, all: 0, active: 0, attention: 0, finished: 0, other: 0 }]))
  const counts = { all: items.length, active: 0, attention: 0, finished: 0, other: 0 }
  for (const row of items) {
    const kind = category(row); counts[kind]++
    if (!bots.has(row.botId)) bots.set(row.botId, { botId: row.botId, name: row.botId || '未取得归属', all: 0, active: 0, attention: 0, finished: 0, other: 0 })
    const bot = bots.get(row.botId); bot.all++; bot[kind]++
  }
  return { items, attention, counts, bots: [...bots.values()], category }
}

export function filterTasks(progress, { botId = '', status = 'all', query = '' } = {}) {
  const names = new Map(progress.bots.map(bot => [bot.botId, bot.name]))
  const text = query.trim().toLocaleLowerCase()
  return progress.items.filter(row => (!botId || row.botId === botId) && (status === 'all' || progress.category(row) === status)
    && (!text || [taskTitle(row), row.botId, names.get(row.botId), taskIdOf(row), row.planId, row.operationId, row.attemptId]
      .some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(text))))
}

export const TASK_EVENTS = Object.freeze({
  queued: '任务已排队', dispatched: '开始执行', 'admission-prepared': '开始资金准入',
  'admission-reference-prepared': '执行引用已保存', 'financial-admission-committed': '资金准入已提交',
  'execution-linked-before-admission': '已关联原执行记录', settled: '本次尝试已结算',
  'cancel-requested': '已请求停止，等待确认', 'cancel-requested-unconfirmed': '已请求停止，原操作仍待核对',
  'plan-cancel-requested': '已请求停止整个计划', 'cancelled-before-dispatch': '启动前已停止',
  'cancelled-while-waiting-budget': '等待预算期间已停止', 'dependency-blocked': '前置任务失败，尚未执行',
  interrupted: '宿主中断，执行结果待核对', reconciled: '已核对原执行记录', blocked: '任务受阻',
  deadline: '已到任务期限', 'budget-wait-expired': '预算等待已到期', 'retry-fenced': '重试已被拦截',
  'admission-conflict': '资金准入记录冲突，需核对', 'dispatch-closed-before-entry': '启动前已阻止派发',
  'admission-closed-not-dispatched': '已确认未派发', 'admission-recovered-cancelled': '恢复时确认启动前已停止',
  'admission-recovered-not-dispatched': '恢复时确认原操作未派发',
})
