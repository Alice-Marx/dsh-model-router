import { BOT_PROFILE_LIMITS, botProfileNameProblem } from '../../packages/orchestration/src/bot-profile.mjs'

/**
 * The identity slice's own model: which fields exist, what the Host persists,
 * and the words the panel uses. The limits and the name rule come from the
 * wiring service so the panel can never offer a value the Host would refuse;
 * the Host still decides, this is only the pre-check that keeps a save from
 * being sent to fail.
 *
 * What is deliberately absent: no soul column, no reply-style enum, no
 * personality switch. The frozen roster persists name, role and instructions
 * and nothing else about who a Bot is, so a control with no field behind it
 * would be a lie the owner only discovers later.
 */
export const BOT_PROFILE_FIELDS = Object.freeze(['name', 'role', 'instructions'])

export const BOT_PROFILE_GROUPS = Object.freeze([
  { id: 'identity', label: '身份', icon: 'bot', hint: '名称与职责', fields: Object.freeze(['name', 'role']) },
  { id: 'voice', label: '对话指令与性格', icon: 'spark', hint: '每次对话都会读', fields: Object.freeze(['instructions']) },
])

export const BOT_PROFILE_FIELD_META = Object.freeze({
  name: { label: '名称', limit: BOT_PROFILE_LIMITS.name, control: 'input', placeholder: '例如：研究伙伴',
    help: '群聊与名单里显示的名字，不能与其他 Bot 同名。',
    terms: Object.freeze(['名称', '名字', '昵称', 'name']) },
  role: { label: '职责 / 描述', limit: BOT_PROFILE_LIMITS.role, control: 'input', placeholder: '例如：整理可借鉴的设计资料',
    help: '一句话说明这个 Bot 负责什么；名单与群聊成员里显示这一句。',
    terms: Object.freeze(['职责', '描述', '一句话', '定位', 'role', 'title']) },
  instructions: { label: '对话指令 / 性格', limit: BOT_PROFILE_LIMITS.instructions, control: 'textarea', placeholder: '例如：先给结论，再给依据；不确定时说明还缺什么。',
    help: '这些指令每次对话都会进入上下文，决定这个 Bot 怎么说话、怎么做事。它不授予任何工具权限：模型、工具与执行权限请在“模型与官方工具”里设置。',
    terms: Object.freeze(['指令', '性格', '对话', '人设', 'instructions', 'personality', 'persona']) },
})

/** The editable draft: exactly the three fields the Host persists, nothing more. */
export function botProfileDraft(view) {
  return { name: view?.bot?.name ?? '', role: view?.bot?.role ?? '', instructions: view?.bot?.instructions ?? '' }
}

/** Only changed fields travel, so an untouched field is never re-sent to the Host. */
export function botProfilePatch(draft, view) {
  const patch = {}
  for (const field of BOT_PROFILE_FIELDS) if (draft[field] !== (view?.bot?.[field] ?? '')) patch[field] = draft[field]
  return patch
}

export function botProfileDirty(draft, view) {
  return Object.keys(botProfilePatch(draft, view)).length > 0
}

/** Live problems that make a save pointless before it reaches the Host. */
export function botProfileProblems(draft) {
  const problems = []
  for (const field of BOT_PROFILE_FIELDS) {
    const value = draft[field]
    if (value.length > BOT_PROFILE_FIELD_META[field].limit) problems.push({ field, text: `${BOT_PROFILE_FIELD_META[field].label}不能超过 ${BOT_PROFILE_FIELD_META[field].limit} 个字符。` })
  }
  const name = botProfileNameProblem(draft.name.trim())
  if (name !== undefined) problems.push({ field: 'name', text: name })
  return problems
}

/** Group visibility for a search: a group matches its own words or any field's. */
export function botProfileSearch(query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle === '') return null
  const hit = text => String(text).toLowerCase().includes(needle)
  const groups = {}
  for (const group of BOT_PROFILE_GROUPS) {
    groups[group.id] = hit(group.label) || hit(group.hint) || group.fields.some(field => {
      const meta = BOT_PROFILE_FIELD_META[field]
      return hit(meta.label) || hit(meta.help) || hit(meta.placeholder) || meta.terms.some(hit)
    })
  }
  return { needle, groups, any: Object.values(groups).some(Boolean) }
}

export function botProfileSavedText(result) {
  const fields = Object.freeze({ name: '名称', role: '职责', instructions: '对话指令' })
  const saved = (result?.saved ?? []).map(field => fields[field] ?? field)
  if (saved.length === 0) return '与宿主一致，没有需要保存的修改。'
  return `已保存：${saved.join('、')}。`
}

/** One place that turns a Host refusal into words the owner can act on. */
export function botProfileFailure(error) {
  switch (error?.code) {
    case 'BOT_PROFILE_CONFLICT': return '这个 Bot 的身份在别处已更新。请重新读取后再保存，你未保存的修改会保留。'
    case 'BOT_PROFILE_UNKNOWN_BOT': return '这个 Bot 不在已提交的宿主目录中，无法修改它的身份。'
    case 'BOT_PROFILE_UNCONFIRMED': return '宿主尚未确认这次保存，请重新读取后核对。'
    case 'BOT_PROFILE_SEAM_UNAVAILABLE': return '当前宿主还不支持保存 Bot 身份，请更新完整插件。'
    case 'BOT_PROFILE_NAME_INVALID': case 'BOT_PROFILE_NAME_TAKEN': case 'BOT_PROFILE_LIMIT': return error.message
    case 'REMOTE_OWNER_REQUIRED': return '只有已认证的宿主拥有者可以修改 Bot 身份。'
    case 'PRODUCT_ACTION_UNAVAILABLE': case 'INVALID_PRODUCT_ACTION': return '当前连接尚不支持身份与个性设置，请更新完整插件。'
    case 'REQUEST_ABORTED': return '保存结果尚未确认，请重新读取后核对。'
    default: return '暂时无法保存，请重新读取后核对。'
  }
}
