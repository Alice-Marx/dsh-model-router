// Pure helpers for the pinned web panel surface: the same closed input check the
// Host applies, the wording for every framing verdict, and the messages for every
// way a Host can refuse. Kept free of React so both the panel and the sidebar pin
// list — and their tests — read one definition.
//
// The client check is a mirror, never the authority: it exists so a typo is
// answered while the person is still typing, and the Host re-validates every save
// with the caller's real embedding origin.

export const MAX_WEB_PANELS = 6
export const MAX_WEB_PANEL_NAME_CHARS = 40
export const MAX_WEB_PANEL_NAME_BYTES = 120
export const MAX_WEB_PANEL_URL_BYTES = 2048

// The frame keeps its page's own origin, so it may run scripts and use its own
// storage. What it never gets is a way out: no top-level navigation, no pointer
// lock, no presentation. `allow-popups` stays because a dashboard's sign-in very
// often opens one.
export const WEB_PANEL_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
export const WEB_PANEL_REFERRER_POLICY = 'no-referrer'
export const WEB_PANEL_LOAD_TIMEOUT_MS = 10_000

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

// The client bundle has no Buffer, and the byte count is only a fast "this is
// absurdly long" answer for a person still typing; the Host measures for real.
const byteLength = text => {
  let size = 0
  for (let index = 0; index < text.length; index++) {
    const point = text.codePointAt(index)
    if (point < 0x80) size += 1
    else if (point < 0x800) size += 2
    else if (point < 0x10000) size += 3
    else { size += 4; index++ }
  }
  return size
}

/** Mirrors `validateWebPanelInput` on the Host. */
export function validateWebPanelDraft(input, embeddingOrigin = '') {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const raw = typeof input?.url === 'string' ? input.url.trim() : ''
  if (!name || name.length > MAX_WEB_PANEL_NAME_CHARS || CONTROL.test(name)) return { ok: false, error: 'name' }
  let url
  try { url = new URL(raw) } catch { return { ok: false, error: 'url' } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'url' }
  if (url.username || url.password || !url.hostname) return { ok: false, error: 'url' }
  if (byteLength(raw) > MAX_WEB_PANEL_URL_BYTES) return { ok: false, error: 'url' }
  if (embeddingOrigin && sameOrigin(url, embeddingOrigin)) return { ok: false, error: 'self' }
  return { ok: true, name, url: url.href }
}

function sameOrigin(url, origin) {
  try { return new URL(origin).origin === url.origin } catch { return false }
}

export function panelHost(url) {
  try { return new URL(url).host } catch { return '' }
}

/** The client's own embedding origin: the native shell's, or the browser's. */
export function clientOrigin(location = globalThis.location) {
  try { return location?.origin ?? '' } catch { return '' }
}

/** A panel framed from this app's own origin would run with the app's access. */
export function isSelfOrigin(url, origin) {
  if (!origin) return false
  try { return new URL(url).origin === new URL(origin).origin } catch { return false }
}

export function panelsOf(snapshot) {
  const section = snapshot?.webPanels
  if (!section || section.status !== 'available' || !Array.isArray(section.items)) {
    return { status: section?.status === 'blocked' ? 'blocked' : 'unavailable', items: [], revision: 0, limits: null, reason: section?.reason ?? '', nextAction: section?.nextAction ?? '' }
  }
  const items = section.items
    .filter(panel => panel && typeof panel.id === 'string' && typeof panel.url === 'string')
    .map((panel, index) => ({ id: panel.id, name: typeof panel.name === 'string' ? panel.name : panel.id,
      url: panel.url, host: panelHost(panel.url), position: Number.isSafeInteger(panel.position) ? panel.position : index + 1 }))
    .sort((left, right) => left.position - right.position)
  return { status: 'available', items, revision: Number.isSafeInteger(section.revision) ? section.revision : 0,
    limits: section.limits ?? null, reason: '', nextAction: '' }
}

/** The list in a new order after moving one panel by `delta`. */
export function movedOrder(panels, id, delta) {
  const index = panels.findIndex(panel => panel.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= panels.length) return null
  const ids = panels.map(panel => panel.id)
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  return ids
}

/** What a probe verdict means, in the words the panel shows. Never a server's own text. */
export function framingMessage(result) {
  if (!result || result.state === 'checking') return { tone: 'idle', text: '正在向宿主确认该页面是否允许显示…' }
  if (result.framing === 'blocked') return { tone: 'blocked', text: `${result.host || '该网站'} 不允许在其他应用中显示它。可以在浏览器中打开，或换一个允许嵌入的页面。` }
  if (result.framing === 'allowed') return { tone: 'ok', text: '宿主确认该页面允许在此显示。浏览器仍可能因其他设置拒绝渲染。' }
  const reason = result.reason
  if (reason === 'timeout') return { tone: 'unknown', text: '无法确认：该页面响应超时。仍会尝试显示，浏览器可能可以打开它。' }
  if (reason === 'redirect') return { tone: 'unknown', text: '无法确认：该页面会跳转，可能是浏览器先登录后才看到的页面。' }
  if (reason === 'bad-status') return { tone: 'unknown', text: '无法确认：该页面没有返回可显示的内容。' }
  if (reason === 'unreachable') return { tone: 'unknown', text: '无法确认：宿主暂时连不上该页面。仍会尝试显示。' }
  if (reason === 'aborted') return { tone: 'idle', text: '' }
  if (['invalid-url', 'unsupported-scheme', 'credentials-in-url'].includes(reason)) return { tone: 'blocked', text: '该地址不能作为网页面板：只支持不带登录信息的 http/https 地址。' }
  return { tone: 'unknown', text: '无法确认该页面是否允许显示。仍会尝试显示。' }
}

/** A Host refusal, in the words the panel shows. Codes are the contract, not the text. */
export function actionError(error) {
  const code = error?.code ?? ''
  const text = ({
    WEB_PANEL_NAME: '名称需为 1–40 个字符。',
    WEB_PANEL_URL: '请填写完整的 http/https 地址，且不要带登录信息。',
    WEB_PANEL_SELF_URL: '不能固定应用自身的页面。',
    WEB_PANEL_LIMIT: `最多固定 ${MAX_WEB_PANELS} 个网页面板。`,
    WEB_PANEL_NOT_FOUND: '该固定页面已不存在，列表已刷新。',
    WEB_PANEL_REVISION_CONFLICT: '列表刚刚在别处被改过，已刷新；请重新操作。',
    WEB_PANEL_ORDER_INVALID: '排序与当前列表不一致，已刷新；请重新排序。',
    WEB_PANEL_INPUT: '请求格式不正确。',
    WEB_PANEL_READBACK_MISMATCH: '宿主未确认这次修改，请刷新后重试。',
    WEB_PANEL_PROBE_BUSY: '正在检测其他页面，请稍候再试。',
    WEB_PANEL_STORE_CLOSED: '宿主正在关闭，请刷新后重试。',
    REMOTE_OWNER_REQUIRED: '请重新登录宿主拥有者账号。',
    PRODUCT_READ_ONLY: '宿主目前处于只读状态，暂不能修改。',
    PRODUCT_ACTION_UNAVAILABLE: '当前宿主尚未接入固定网页面板，请更新宿主。',
  })[code]
  return { code, text: text ?? '宿主请求未完成，请刷新后重试。' }
}

/**
 * Open a page in the user's own browser. Only ever called from a click, in a new
 * browsing context, with no handle back to this window and no referrer sent.
 */
export function openExternally(url, open = globalThis.open) {
  if (typeof open !== 'function') return false
  try { return open(url, '_blank', 'noopener,noreferrer') !== null } catch { return false }
}
