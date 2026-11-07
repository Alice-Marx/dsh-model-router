/**
 * What a Bot team needs a person to do, derived from committed Host state.
 *
 * The rule is the same one the workbench follows: a healthy snapshot asks for nothing, and
 * every row names the person's next action instead of an internal Task state. Nothing here
 * is inferred from a Bot's own words — a Bot that says it is blocked without a Task in a
 * blocking state contributes no row.
 */

/** Ordered by who is blocked: an unconfirmed remote effect outranks an approval request. */
export const BOT_ATTENTION_STAGES = Object.freeze(['reconcile', 'approve', 'remote-unknown', 'budget', 'failed', 'blocked'])

const STAGE_ORDER = new Map(BOT_ATTENTION_STAGES.map((stage, index) => [stage, index]))
const TERMINAL = new Set(['cancelled', 'succeeded', 'failed', 'skipped'])

const short = (value, limit = 80) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/** A remote result that never confirmed its stop is unknown, not "stopped". */
export function remoteUncertain(row) {
  const remote = row?.result?.remote
  if (!remote || typeof remote !== 'object') return false
  // An operation that never started has nothing to confirm — but a receipt that also claims its
  // effects may have applied is telling two different stories, and the safe reading of that is
  // "not proven": it stays a reconciliation instead of becoming a retry.
  if (remote.notStarted === true && remote.possiblyApplied !== true) return false
  if (remote.stopConfirmed === true) return false
  return TERMINAL.has(row.state)
}

/**
 * @param {{ tasks?: { items?: object[] }, machines?: { items?: object[] } } | null} snapshot
 * @param {{ limit?: number }} [options]
 * @returns {Array<{ key: string, stage: string, title: string, detail: string, action: string, botId?: string, taskId?: string }>}
 */
export function deriveBotAttention(snapshot, { limit = 6 } = {}) {
  const tasks = Array.isArray(snapshot?.tasks?.items) ? snapshot.tasks.items : []
  const bots = Array.isArray(snapshot?.bots) ? snapshot.bots : []
  const nameOf = botId => bots.find(bot => bot.id === botId)?.name ?? botId ?? '未取得归属'
  const rows = []
  const add = (stage, key, title, detail, action, extra = {}) => {
    rows.push({ key, stage, title, detail: short(detail, 160), action, ...extra })
  }

  for (const task of tasks) {
    const id = task?.taskId ?? task?.id
    if (!id) continue
    const bot = nameOf(task.botId)
    const title = short(task.title ?? task.input?.task ?? id, 50)
    if (task.state === 'needs-reconciliation') {
      add('reconcile', `reconcile:${id}`, `${bot} 的执行需要核对收据：${title}`,
        '原操作结果未知。核对厂商与远端记录后再决定是否重试；不会自动重发。', 'reconcile', { botId: task.botId, taskId: id })
      continue
    }
    if (task.state === 'waiting-approval') {
      add('approve', `approve:${id}`, `${bot} 等待审批：${title}`,
        task.blockedReason || '此任务需要你批准后才能继续。', 'approve', { botId: task.botId, taskId: id })
      continue
    }
    if (task.state === 'waiting-budget') {
      add('budget', `budget:${id}`, `${bot} 等待预算：${title}`,
        task.blockedReason || '预算或资金准入未通过，任务已停在启动前。', 'budget', { botId: task.botId, taskId: id })
      continue
    }
    if (remoteUncertain(task)) {
      add('remote-unknown', `remote:${id}`, `${bot} 的远程操作结果未确认：${title}`,
        '停止或写入没有确认回执，文件可能已经改变。先核对原操作，再决定是否重试。', 'reconcile', { botId: task.botId, taskId: id })
      continue
    }
    if (task.state === 'failed') {
      add('failed', `failed:${id}`, `${bot} 的任务失败：${title}`,
        task.blockedReason || task.error || '打开任务详情查看每一步的结果，确认后再重试。', 'retry', { botId: task.botId, taskId: id })
      continue
    }
    if (task.state === 'blocked') {
      add('blocked', `blocked:${id}`, `${bot} 的任务受阻：${title}`,
        task.blockedReason || '依赖未满足，任务停在这里等人处理。', 'open', { botId: task.botId, taskId: id })
    }
  }

  return rows
    .sort((left, right) => (STAGE_ORDER.get(left.stage) ?? BOT_ATTENTION_STAGES.length) - (STAGE_ORDER.get(right.stage) ?? BOT_ATTENTION_STAGES.length))
    .slice(0, Math.max(1, limit))
}

/** One line for a heading; empty when nothing needs a person. */
export function botAttentionSummary(rows = []) {
  const count = Array.isArray(rows) ? rows.length : 0
  if (count === 0) return ''
  const urgent = rows.filter(row => row.stage === 'reconcile' || row.stage === 'approve').length
  return urgent > 0 ? `${count} 项需要你处理（${urgent} 项卡在确认上）` : `${count} 项需要你处理`
}
