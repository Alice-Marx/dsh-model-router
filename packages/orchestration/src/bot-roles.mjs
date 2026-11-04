/**
 * The role catalog: what a Bot can be hired to do.
 *
 * A role is a starting point, never a permission. It carries a name, a short brief, and the tools it
 * would like — and every requested tool is checked against the caller's allow-list before anything is
 * created. A catalog entry that names a tool the Host does not offer is refused at instantiation
 * time, not silently dropped, because a half-equipped Bot looks like it is working when it is not.
 */

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }
const ID = /^[a-z][a-z0-9-]{1,47}$/
const BOT_NAME = /^[^\u0000-\u001f]{1,64}$/u

/** The eight jobs from the reference product, expressed as briefs rather than prompts. */
export const BOT_ROLE_CATALOG = Object.freeze([
  { id: 'chief-of-staff', name: 'Chief of Staff', brief: '整理目标、分派工作、跟踪进度，并在需要人决定时停下来。', tools: ['managed-tasks', 'model-inference', 'mr-routing'] },
  { id: 'sales-outbound', name: 'Sales Outbound', brief: '研究客户、筛选线索、起草外联内容，并留下一份待人工确认的名单。', tools: ['model-inference', 'mr-routing'] },
  { id: 'talent-scout', name: 'Talent Scout', brief: '按岗位要求筛选候选人，整理依据与待联系清单。', tools: ['model-inference', 'mr-routing'] },
  { id: 'paid-media', name: 'Paid Media', brief: '整理投放数据、指出异常，并给出可执行的调整建议。', tools: ['model-inference', 'mr-routing'] },
  { id: 'expense-manager', name: 'Expense Manager', brief: '核对报销单据与政策，标出需要人工判断的条目。', tools: ['model-inference', 'mr-routing'] },
  { id: 'product-performance', name: 'Product Performance', brief: '汇总产品指标变化，定位原因并列出待验证的假设。', tools: ['model-inference', 'mr-routing'] },
  { id: 'bug-reproduction', name: 'Bug Reproduction', brief: '复现问题、记录最小复现步骤，并附上环境信息。', tools: ['model-inference', 'mr-routing', 'managed-tasks'] },
  { id: 'account-health', name: 'Account Health', brief: '跟踪账号风险信号，整理成可执行的跟进清单。', tools: ['model-inference', 'mr-routing'] },
])

/** One entry, validated; an unknown id names the ids that do exist. */
export function findRole(id) {
  if (typeof id !== 'string' || !ID.test(id)) fail('ROLE_ID_INVALID')
  const role = BOT_ROLE_CATALOG.find(item => item.id === id)
  if (!role) fail('ROLE_NOT_FOUND', `没有这个岗位：${id}。可选：${BOT_ROLE_CATALOG.map(item => item.id).join('、')}`)
  return role
}

/**
 * What creating a Bot from a role would produce.
 *
 * `allowedTools` is the Host's answer to "what may a Bot be granted at all"; a role asking for
 * anything outside it is a catalog bug and must surface here rather than become a Bot that silently
 * cannot do its job.
 */
export function instantiateRole({ roleId, botName = null, allowedTools = [] } = {}) {
  const role = findRole(roleId)
  const allowed = new Set(Array.isArray(allowedTools) ? allowedTools : [])
  const missing = role.tools.filter(tool => !allowed.has(tool))
  if (missing.length > 0) fail('ROLE_TOOL_UNAVAILABLE', `岗位 ${role.id} 需要主机不提供的能力：${missing.join('、')}`)
  const name = botName === null ? role.name : String(botName).trim()
  // A name of spaces is empty once trimmed, and a control character never belongs in a Bot name.
  if (name === '' || !BOT_NAME.test(name)) fail('ROLE_BOT_NAME_INVALID', 'Bot 名称不能为空且不能含控制字符。')
  return {
    name,
    roleId: role.id,
    role: role.name,
    // The brief becomes the Bot's own description, never its system prompt.
    description: role.brief,
    capabilities: [...role.tools].sort(),
    officialTools: [],
  }
}

/** The catalog for a picker: ids, names and briefs, with nothing executable in it. */
export function listRoles() {
  return BOT_ROLE_CATALOG.map(role => ({ id: role.id, name: role.name, brief: role.brief, tools: [...role.tools] }))
}
