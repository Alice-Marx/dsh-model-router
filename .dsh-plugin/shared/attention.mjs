/**
 * Workbench attention: what waits for a person, in the order a person should act on it.
 *
 * One rule decides this list: a healthy state takes no space. The panel answers "does
 * anything need me now?" before anything else, and every row names the person's next
 * action instead of an internal status code. Rows are derived from committed Host state
 * (health, ledger, probes) — never from a model's own claim that it needs help.
 */

/** Stages ordered by who is blocked: money and interrupted work first, then failures, then login. */
export const ATTENTION_STAGES = Object.freeze(['blocked', 'failed', 'answer', 'login'])

const STAGE_ORDER = new Map(ATTENTION_STAGES.map((stage, index) => [stage, index]))

const short = (value, limit = 90) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/**
 * @param {{
 *   budget?: { exceeded?: boolean, action?: string, message?: string } | null,
 *   reserved?: { interruptedCount?: number } | null,
 *   probes?: Array<{ id?: string, label?: string, status?: string, detail?: string }>,
 *   health?: Array<{ id?: string, label?: string, installed?: boolean, login?: { state?: string, detail?: string } }>,
 *   runs?: Array<{ id?: string, task?: string, status?: string, error?: string }>,
 *   limit?: number,
 * }} source
 * @returns {Array<{ key: string, stage: string, title: string, detail: string, target: string }>}
 */
export function deriveAttention({ budget = null, reserved = null, probes = [], health = [], runs = [], limit = 5 } = {}) {
  const rows = []
  const add = (stage, key, title, detail, target) => { rows.push({ key, stage, title, detail: short(detail, 160), target }) }

  // 1. A budget that pauses execution stops everything: the person decides whether to raise it.
  if (budget?.exceeded === true && budget?.action === 'pause') {
    add('blocked', 'budget', '预算已用完，新的执行会先暂停',
      budget.message || '调高预算，或把超预算动作改为“自动降级”。', 'controls')
  }
  // 2. An interrupted execution already started, so its cost is an estimate until someone checks.
  const interrupted = Number(reserved?.interruptedCount)
  if (Number.isFinite(interrupted) && interrupted > 0) {
    add('blocked', 'interrupted', `${interrupted} 次执行中断，费用尚未核验`,
      '这些执行在中断前已经开始，费用按预估计入。核对后再继续。', 'controls')
  }
  // 3. A tool the check could not read is unknown, not missing: say which one and how.
  for (const probe of probes) {
    if (probe?.status !== 'probe-failed' && probe?.status !== 'probe-timeout') continue
    const name = short(probe.label ?? probe.id, 40)
    add('failed', `probe:${probe.id ?? name}`, `${name} 版本检测${probe.status === 'probe-timeout' ? '超时' : '失败'}`,
      probe.detail || '无法确认这个工具的版本；可重新体检，或在终端里手动运行一次 --version。', 'tools')
  }
  // 4. A failed run keeps its answer: retrying is a person's decision, not an automatic replay.
  for (const run of runs) {
    if (run?.status !== 'failed') continue
    const task = short(run.task, 60) || '未命名任务'
    add('failed', `run:${run.id ?? task}`, `上次执行失败：${task}`,
      run.error ? short(run.error) : '打开执行记录查看每一步的结果，确认后再重试。', 'history')
    rows[rows.length - 1].runId = run.id ?? null
  }
  // 5. An installed tool that is logged out cannot serve a subscription channel.
  for (const tool of health) {
    if (!tool?.installed || tool?.login?.state !== 'logged-out') continue
    add('login', `login:${tool.id}`, `${short(tool.label ?? tool.id, 40)} 需要登录`,
      tool.login.detail || '已安装但未登录；订阅通道不可用，API 通道不受影响。', 'tools')
  }

  return rows
    .sort((left, right) => (STAGE_ORDER.get(left.stage) ?? ATTENTION_STAGES.length) - (STAGE_ORDER.get(right.stage) ?? ATTENTION_STAGES.length))
    .slice(0, Math.max(1, limit))
}

/** One line for a header or a status pill; empty when nothing needs a person. */
export function attentionSummary(rows = []) {
  const count = Array.isArray(rows) ? rows.length : 0
  if (count === 0) return ''
  const blocked = rows.filter(row => row.stage === 'blocked').length
  return blocked > 0 ? `${count} 项需要你处理（${blocked} 项会阻止执行）` : `${count} 项需要你处理`
}
