/**
 * Bot identity and personality: the owner's own view of what a committed Bot
 * actually persists.
 *
 * The frozen DS roster stores a Bot's name, its one-line role and its standing
 * instructions, and nothing else about who it is. There is no soul file, no
 * reply-style enum and no separate personality column behind this Host, so this
 * service writes exactly those three fields — and only through the Host's
 * trusted `runtime.updateBotProfile` seam. Instructions are text the system
 * prompt reads every turn; they are not a grant, so this service never touches a
 * model, a thinking level, a permission preset, browser grants, a working
 * directory or an avatar, and it never chooses a Bot, a credential or an
 * executable path from its arguments.
 *
 * Two Host facts shape the design:
 *
 *   1. The native `updateBot` answers a role or instructions change with an
 *      `update` notice delivered into the Bot's own chat, and a delivered notice
 *      opens a turn: an owner edit would start an unsolicited model turn. The
 *      seam is the Host's own answer to that — it mutates once and emits no
 *      notice — so this service never wraps, patches or re-routes `deliver`, and
 *      never impersonates a Bot actor to reuse the native self-edit exception.
 *      A Host without the seam refuses the save with BOT_PROFILE_SEAM_UNAVAILABLE
 *      instead of falling back to global interception.
 *   2. `updateBot` awaits several times before its final save, so a revision
 *      read before those awaits fences nothing. The fence therefore lives inside
 *      the seam: it compares `base` against the live Bot and runs this service's
 *      `check` at the same synchronous boundary, immediately before the one
 *      multi-field mutation. The revision read here is an early exit only; the
 *      commit guarantee is the seam's, and it is reported as such.
 */

export const BOT_PROFILE_SCHEMA = 1
export const BOT_PROFILE_LIMITS = Object.freeze({ name: 40, role: 24, instructions: 4000 })
const FIELDS = Object.freeze(['name', 'role', 'instructions'])
const EVERYONE = Object.freeze(['all', 'everyone', '所有人', '全体'])
const STANDS_FOR_USER = Object.freeze(['user', 'you'])

const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const fail = (code, message, details = {}) => { throw Object.assign(new Error(message), { code, details }) }
const keys = (value, allowed, path) => {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('BOT_PROFILE_INVALID', `${path} 含有未知字段或格式无效。`, { field: path })
}
const text = (value, limit, path) => {
  if (typeof value !== 'string') fail('BOT_PROFILE_INVALID', `${path} 必须是文本。`, { field: path })
  const next = value.trim()
  if (next.length > limit) fail('BOT_PROFILE_LIMIT', `${path} 不能超过 ${limit} 个字符。`, { field: path })
  return next
}
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED', '请使用已认证的宿主拥有者账号修改 Bot 身份。') }

/** What the frozen roster accepts as a name; the same rule its own create flow applies. */
export function botProfileNameProblem(name) {
  const text = String(name ?? '').trim()
  if (text === '') return 'Bot 需要一个名称。'
  if (/[@`\r\n]/.test(text)) return '名称不能包含 @、` 或换行。'
  if (EVERYONE.includes(text.toLowerCase())) return `"${text}" 在群聊里等于@所有人，不能作为 Bot 名称。`
  if (STANDS_FOR_USER.includes(text.toLowerCase())) return `"${text}" 在聊天里代表用户自己，不能作为 Bot 名称。`
  return undefined
}

const viewOf = bot => ({ id: bot.id, name: bot.name ?? '', role: bot.role ?? '', instructions: bot.instructions ?? '' })
const fieldOf = (bot, field) => (field === 'name' ? bot.name ?? '' : field === 'role' ? bot.role ?? '' : bot.instructions ?? '')

const lifecycleOf = lifecycle => {
  if (!lifecycle || typeof lifecycle.committedBot !== 'function' || typeof lifecycle.status !== 'function') fail('BOT_PROFILE_LIFECYCLE_UNAVAILABLE', '宿主未提供已提交生命周期，无法确认 Bot 身份。')
  return lifecycle
}
const committedBot = (lifecycle, botId) => {
  const bot = lifecycle.committedBot(botId)
  if (!bot) fail('BOT_PROFILE_UNKNOWN_BOT', '这个 Bot 不在已提交的宿主目录中。', { botId })
  return bot
}
const revisionOf = lifecycle => {
  const revision = lifecycle.status()?.revision
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}

/** A bounded owner read: the committed Bot's persistable identity, and nothing else. */
export async function inspectProductBotProfile({ runtime, lifecycle, signal }, payload) {
  keys(payload, ['botId'], 'botProfile.inspect')
  if (typeof payload.botId !== 'string' || payload.botId === '') fail('BOT_PROFILE_INVALID', '请选择当前团队中的 Bot。', { field: 'botId' })
  signal?.throwIfAborted()
  await runtime.load()
  signal?.throwIfAborted()
  const host = lifecycleOf(lifecycle)
  const bot = committedBot(host, payload.botId)
  return { schemaVersion: BOT_PROFILE_SCHEMA, bot: viewOf(bot), revision: revisionOf(host), limits: BOT_PROFILE_LIMITS, availableActions: ['botProfile.save'] }
}

/**
 * One atomic owner save of the identity fields. `base` carries the values the
 * editor read; when the committed revision moved since then, every field this
 * save changes must still hold its base value, so an edit made in another window
 * is refused instead of overwritten while an unrelated save (another Bot, a held
 * greeting) never blocks this one.
 *
 * The commit itself is the Host seam's: it compares `base` against the live Bot
 * and runs `check` at the same synchronous boundary, immediately before one
 * multi-field mutation that persists once and emits no notice. Nothing is
 * written until the whole patch passes, and the committed record is read back
 * before success is reported.
 */
export async function saveProductBotProfile({ runtime, lifecycle, signal }, payload, context) {
  owner(context)
  keys(payload, ['botId', 'expectedRevision', 'base', 'profile'], 'botProfile.save')
  if (typeof payload.botId !== 'string' || payload.botId === '') fail('BOT_PROFILE_INVALID', '请选择当前团队中的 Bot。', { field: 'botId' })
  if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) fail('BOT_PROFILE_INVALID', 'expectedRevision 必须是宿主已提交状态的修订号。', { field: 'expectedRevision' })
  keys(payload.base, FIELDS, 'base')
  for (const field of FIELDS) if (typeof payload.base[field] !== 'string') fail('BOT_PROFILE_INVALID', `base.${field} 必须是读取时保存的文本。`, { field: `base.${field}` })
  keys(payload.profile, FIELDS, 'profile')
  if (Object.keys(payload.profile).length === 0) fail('BOT_PROFILE_INVALID', '没有要保存的身份字段。', { field: 'profile' })
  const wanted = {}
  for (const field of FIELDS) {
    if (payload.profile[field] === undefined) continue
    wanted[field] = text(payload.profile[field], BOT_PROFILE_LIMITS[field], field)
  }
  signal?.throwIfAborted()
  const host = lifecycleOf(lifecycle)
  const before = committedBot(host, payload.botId)
  const revision = revisionOf(host)
  // An early exit, not the fence: the seam re-checks against the live Bot.
  if (payload.expectedRevision !== revision) {
    for (const field of FIELDS) {
      if (wanted[field] === undefined) continue
      const current = fieldOf(before, field)
      if (current !== payload.base[field]) fail('BOT_PROFILE_CONFLICT', '这个 Bot 的身份在别处已更新，请重新读取后再保存。', { field, current, base: payload.base[field], revision })
    }
  }
  if (wanted.name !== undefined) {
    const problem = botProfileNameProblem(wanted.name)
    if (problem !== undefined) fail('BOT_PROFILE_NAME_INVALID', problem, { field: 'name' })
    const taken = host.committedBots().some(bot => bot.id !== payload.botId && String(bot.name ?? '').trim().toLowerCase() === wanted.name.toLowerCase())
    if (taken) fail('BOT_PROFILE_NAME_TAKEN', `名称 ${wanted.name} 已被其他 Bot 占用。`, { field: 'name' })
  }
  const patch = {}
  for (const field of FIELDS) if (wanted[field] !== undefined && wanted[field] !== fieldOf(before, field)) patch[field] = wanted[field]
  if (Object.keys(patch).length === 0) {
    return { schemaVersion: BOT_PROFILE_SCHEMA, botId: payload.botId, bot: viewOf(before), revision, saved: [] }
  }
  const seam = runtime.updateBotProfile
  if (typeof seam !== 'function') {
    fail('BOT_PROFILE_SEAM_UNAVAILABLE', '这个宿主还没有 updateBotProfile 接线，身份保存已被拒绝，没有写入任何内容。请升级到提供该接线的 Host。', { required: 'runtime.updateBotProfile' })
  }
  signal?.throwIfAborted()
  // Runs inside the seam, on the live Bot, immediately before its single
  // mutation: fresh committed ownership, the caller's signal, and the live base.
  const check = bot => {
    signal?.throwIfAborted()
    const committed = lifecycle.committedBot(payload.botId)
    if (!committed || committed.id !== bot?.id) fail('BOT_PROFILE_UNKNOWN_BOT', '这个 Bot 在提交前已不在已提交的宿主目录中。', { botId: payload.botId })
    for (const field of FIELDS) {
      if (patch[field] === undefined) continue
      const live = fieldOf(bot, field)
      if (live !== payload.base[field]) fail('BOT_PROFILE_CONFLICT', '这个 Bot 的身份在别处已更新，请重新读取后再保存。', { field, current: live, base: payload.base[field] })
    }
    return true
  }
  await seam.call(runtime, payload.botId, patch, { base: payload.base, check })
  // Read the committed record, not the live one: only the committed bytes are
  // what the next turn will actually read.
  let after = committedBot(host, payload.botId)
  const unconfirmed = FIELDS.filter(field => patch[field] !== undefined && fieldOf(after, field) !== patch[field])
  if (unconfirmed.length > 0 && typeof host.refreshGrants === 'function') {
    await host.refreshGrants()
    after = committedBot(host, payload.botId)
  }
  const missing = FIELDS.filter(field => patch[field] !== undefined && fieldOf(after, field) !== patch[field])
  if (missing.length > 0) fail('BOT_PROFILE_UNCONFIRMED', '宿主尚未确认这次身份保存，请重新读取后核对。', { fields: missing, patch })
  return { schemaVersion: BOT_PROFILE_SCHEMA, botId: payload.botId, bot: viewOf(after), revision: revisionOf(host), saved: Object.keys(patch) }
}
