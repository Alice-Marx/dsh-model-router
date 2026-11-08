// Team packages: a shareable description of a Bot team (who the Bots are, their shared
// group chats and playbooks). The package layout and the credential shapes below are
// adapted from an Apache-2.0 project's team package format and secret redaction.
//
// A package only says who the Bots are. Models, funding, approval levels, tools,
// computers, connections and credentials are never read from it: they stay with the
// Host's committed state, and every imported Bot starts with the owner's defaults.

export const TEAM_PACKAGE_MAX_BYTES = 1_000_000
export const TEAM_PACKAGE_MAX_BOTS = 12
const FORMATS = new Map([['dsh.team-package', 1], ['openmaus.package', 2]])
const DS_COLORS = new Set(['deepseek', 'blue', 'violet', 'orange', 'green', 'magenta', 'cyan', 'red', 'yellow', 'brown', 'gray', 'black', 'aurora'])
const COLOR_ALIASES = { purple: 'violet', pink: 'magenta', coral: 'orange', teal: 'cyan', grey: 'gray', indigo: 'blue', amber: 'yellow' }
const ROOM_NOTICE_MAX = 2000
const INSTRUCTIONS_MAX = 12000

const CREDENTIAL_SHAPES = [
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bxai-[A-Za-z0-9_-]{20,}/,
  /\bgsk_[A-Za-z0-9]{40,}/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bgl(?:pat|dt|rtr?)-[A-Za-z0-9_-]{20,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{20,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bnpm_[A-Za-z0-9]{20,}/,
  /\bwhsec_[A-Za-z0-9_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/,
  /\b(?:[A-Za-z0-9_-]*_)?(?:api[_-]?key|apikey|secret|token|password|passwd|auth[_-]?token|access[_-]?key|private[_-]?key)s?["']?\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i,
  /--(?:token|password|passwd|api-key|apikey|secret|access-key|auth-token)(?:=|\s+)["']?(?!-)[A-Za-z0-9._~+/=-]+/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"]+@/i,
]

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra })
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, limit) => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, limit) : ''
const line = (value, limit) => text(value, limit * 4).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
const keyOf = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : null
const list = value => Array.isArray(value) ? value : []

/** Paths of the text parts that hold a credential-shaped value; never the values. */
export function credentialFindings(document) {
  const found = []
  const walk = (value, path) => {
    if (typeof value === 'string') { if (CREDENTIAL_SHAPES.some(shape => shape.test(value))) found.push(path); return }
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`)); return }
    if (plain(value)) for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key)
  }
  walk(document, '')
  return found
}

export const teamColor = value => {
  const color = typeof value === 'string' ? value.toLowerCase() : ''
  return DS_COLORS.has(color) ? color : COLOR_ALIASES[color]
}

function instructionsFor(agent, { team, playbooks }) {
  const parts = []
  const description = text(agent.description, 600)
  const soul = text(agent.soul, 6000)
  if (soul) parts.push(soul)
  else if (description) parts.push(description)
  if (soul && description) parts.push(`Role: ${description}`)
  if (team.brief) parts.push(`Team brief: ${team.brief}`)
  const own = list(agent.playbooks).map(keyOf).filter(Boolean).map(key => playbooks.get(key)).filter(Boolean)
  for (const playbook of own) {
    const head = playbook.summary ? `${playbook.name} (${playbook.summary})` : playbook.name
    parts.push(`Playbook "${head}"${playbook.triggers.length ? `, use when the request mentions ${playbook.triggers.join(', ')}` : ''}:\n${playbook.instructions}`)
  }
  return parts.join('\n\n').slice(0, INSTRUCTIONS_MAX)
}

/**
 * Reads a team package (JSON text) into an import plan, or refuses it. The plan is all the
 * import will create; `skipped` names, in words, what the package carried that is never read.
 */
export function parseTeamPackage(source) {
  if (typeof source !== 'string' || source.trim() === '') throw fail('TEAM_PACKAGE_INVALID', '请粘贴或选择一个团队包文件。')
  if (Buffer.byteLength(source, 'utf8') > TEAM_PACKAGE_MAX_BYTES) throw fail('TEAM_PACKAGE_TOO_LARGE', '团队包超过 1 MB，请移除头像等大文件后再导入。')
  let document
  try { document = JSON.parse(source) } catch { throw fail('TEAM_PACKAGE_INVALID', '团队包不是有效的 JSON。目前只支持 JSON 团队包。') }
  if (!plain(document) || !FORMATS.has(document.format)) throw fail('TEAM_PACKAGE_UNSUPPORTED', '无法识别的团队包格式。')
  if (document.version !== FORMATS.get(document.format)) throw fail('TEAM_PACKAGE_UNSUPPORTED', `不支持该团队包版本（${String(document.version)}）。`)
  const pkg = document.package
  if (!plain(pkg)) throw fail('TEAM_PACKAGE_INVALID', '团队包缺少 package 内容。')
  const findings = credentialFindings(pkg)
  if (findings.length) throw fail('TEAM_PACKAGE_SECRET', `团队包里有疑似密钥或密码（${findings.slice(0, 5).join('、')}${findings.length > 5 ? ' 等' : ''}），已拒绝导入。请删除后再试。`, { parts: findings })

  const team = { name: line(pkg.team?.name ?? pkg.name, 60), brief: text(pkg.team?.brief, 1500) }
  const playbooks = new Map()
  for (const item of list(pkg.playbooks)) {
    const key = keyOf(item?.key)
    const instructions = text(item?.instructions, 3000)
    if (!key || !instructions || playbooks.has(key)) continue
    playbooks.set(key, { key, name: line(item.name, 60) || key, summary: line(item.summary, 200), triggers: list(item.triggers).map(value => line(value, 40)).filter(Boolean).slice(0, 8), instructions })
  }

  const agents = list(pkg.agents)
  if (agents.length === 0) throw fail('TEAM_PACKAGE_INVALID', '团队包里没有 Bot。')
  if (agents.length > TEAM_PACKAGE_MAX_BOTS) throw fail('TEAM_PACKAGE_TOO_LARGE', `一个团队包最多 ${TEAM_PACKAGE_MAX_BOTS} 个 Bot。`)
  const bots = []
  for (const [index, agent] of agents.entries()) {
    if (!plain(agent)) throw fail('TEAM_PACKAGE_INVALID', `第 ${index + 1} 个 Bot 格式无效。`)
    const key = keyOf(agent.key)
    const name = line(agent.name, 40)
    if (!key || bots.some(bot => bot.key === key)) throw fail('TEAM_PACKAGE_INVALID', `第 ${index + 1} 个 Bot 缺少唯一的 key。`)
    if (!name) throw fail('TEAM_PACKAGE_INVALID', `Bot「${key}」缺少名字。`)
    bots.push({ key, name, role: line(agent.title, 24), color: teamColor(agent.appearance?.color), description: line(agent.description, 200),
      instructions: instructionsFor(agent, { team, playbooks }) })
  }
  const known = new Set(bots.map(bot => bot.key))
  const leaderKey = keyOf(pkg.team?.leader ?? pkg.chiefOfStaff)
  const leader = known.has(leaderKey) ? leaderKey : null

  const rooms = []
  for (const room of list(pkg.rooms)) {
    const key = keyOf(room?.key)
    const members = [...new Set(list(room?.members).filter(member => known.has(member)))]
    if (!key || rooms.some(item => item.key === key) || members.length < 2) continue
    const responder = room.defaultResponder
    const admin = responder?.kind === 'agent' && members.includes(responder.agent) ? responder.agent : members.includes(leader) ? leader : null
    rooms.push({ key, name: line(room.name, 60) || key, members: members.slice(0, 12), notice: text(room.bulletin, ROOM_NOTICE_MAX),
      mode: responder?.kind === 'everyone' ? 'everyone' : 'admin', admin })
  }

  const routines = list(pkg.routines).filter(plain).slice(0, 20).map(item => ({
    name: line(item.name, 60) || line(item.key, 60), bot: known.has(item.agent) ? item.agent : null, prompt: text(item.prompt, 500),
    schedule: plain(item.schedule) ? line(item.schedule.type === 'cron' ? `cron ${item.schedule.expression ?? ''}` : `${item.schedule.type ?? ''} ${item.schedule.time ?? ''}`, 60) : '',
  }))
  const skipped = []
  const avatars = agents.filter(agent => agent?.appearance?.avatar).length
  if (avatars) skipped.push(`${avatars} 个头像图片`)
  const approvals = agents.filter(agent => agent?.approval !== undefined).length
  if (approvals) skipped.push(`${approvals} 个 Bot 自带的审批级别（按你的权限设置）`)
  const connections = list(pkg.connections).length + agents.reduce((sum, agent) => sum + list(agent?.connections).length, 0)
  if (connections) skipped.push('应用连接（不含密钥，需要你自己配置）')
  const skills = list(pkg.skills?.entries).length
  if (skills) skipped.push(`${skills} 个技能（未导入）`)
  const seeds = agents.filter(agent => plain(agent?.seed)).length
  if (seeds) skipped.push(`${seeds} 个 Bot 的初始笔记`)
  if (routines.length) skipped.push(`${routines.length} 个例行任务（只作为建议列出，不会自动创建）`)
  if (list(pkg.requirements?.apps).length) skipped.push(`需要的应用：${list(pkg.requirements.apps).map(app => line(app?.label ?? app?.slug, 40)).filter(Boolean).join('、')}`)

  return {
    format: document.format, version: document.version,
    package: { name: line(pkg.name, 60) || team.name || '团队包', tagline: line(pkg.tagline, 160), summary: text(pkg.summary, 600), release: line(pkg.release, 24),
      author: line(pkg.author?.name, 60), outcomes: list(pkg.outcomes).map(item => line(item, 160)).filter(Boolean).slice(0, 8) },
    team: { name: team.name, brief: team.brief, leader },
    bots, rooms, routines, skipped,
  }
}

/** What the owner reviews before importing: the plan without the instruction bodies. */
export function teamPreview(plan) {
  return {
    package: plan.package, team: { name: plan.team.name, brief: plan.team.brief, leader: plan.team.leader },
    bots: plan.bots.map(({ instructions, ...bot }) => ({ ...bot, instructionChars: instructions.length })),
    rooms: plan.rooms.map(room => ({ key: room.key, name: room.name, members: room.members, mode: room.mode, admin: room.admin, hasNotice: room.notice !== '' })),
    routines: plan.routines, skipped: plan.skipped,
  }
}

/**
 * Creates the plan's Bots and group chats through the runtime, additively: a name already
 * taken gets a number. Any failure removes what this import made, newest first.
 */
export async function importTeamPlan(plan, { rt, model, freshName }) {
  const made = { bots: [], rooms: [] }
  const ids = new Map()
  try {
    for (const bot of plan.bots) {
      let created, attempt = 0
      for (;;) {
        const name = attempt === 0 ? bot.name : freshName(bot.name, attempt)
        try {
          created = await rt.createBot({ name, role: bot.role, instructions: bot.instructions, ...(bot.color ? { color: bot.color } : {}),
            ...(model ? { model } : { pickModel: true }), createdBy: null })
          break
        } catch (error) { if (!/already exists/.test(String(error?.message)) || ++attempt >= 9) throw error }
      }
      ids.set(bot.key, created.id)
      made.bots.push({ key: bot.key, botId: created.id, name: created.name, sessionId: rt.chatOf?.(created.id) ?? null })
    }
    for (const room of plan.rooms) {
      const members = room.members.map(key => ids.get(key)).filter(Boolean)
      let created, attempt = 0
      for (;;) {
        const name = attempt === 0 ? room.name : freshName(room.name, attempt)
        try {
          created = await rt.createRoom({ members, name, notice: room.notice, mode: room.mode, admin: room.admin ? ids.get(room.admin) ?? null : null })
          break
        } catch (error) { if (!/already called/.test(String(error?.message)) || ++attempt >= 9) throw error }
      }
      made.rooms.push({ key: room.key, roomId: created.id, name: created.name })
    }
    return made
  } catch (error) {
    const left = []
    for (const room of [...made.rooms].reverse()) await rt.deleteRoom(room.roomId).catch(() => left.push(room.name))
    for (const bot of [...made.bots].reverse()) await rt.deleteBot(bot.botId).catch(() => left.push(bot.name))
    throw fail('TEAM_PACKAGE_IMPORT_FAILED', `导入未完成，已撤回本次创建的内容${left.length ? `（未能撤回：${left.join('、')}）` : ''}：${String(error?.message ?? error)}`, { left })
  }
}
