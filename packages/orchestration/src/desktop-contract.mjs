/**
 * The desktop-control contract, shared by the Host and the browser.
 *
 * Pure validation and geometry only: no Node APIs, so the panel and the Host agree on exactly
 * what a request means. The Host keeps the side effects in desktop-actions.mjs.
 */

const ID = /^[-A-Za-z0-9_.]{1,128}$/
const SCREENSHOT_ID = /^[A-Za-z0-9_-]{8,128}$/

const fail = code => { const error = new Error(code); error.code = code; throw error }

const closed = (value, keys, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_DESKTOP_REQUEST')
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`INVALID_DESKTOP_REQUEST:${name}:${key}`)
  return value
}

const identifier = (value, name) => {
  if (typeof value !== 'string' || !ID.test(value)) fail(`INVALID_DESKTOP_REQUEST:${name}`)
  return value
}

const ACTIONS = Object.freeze({
  click: ['screenshotId', 'x', 'y', 'button', 'clickCount'],
  type: ['screenshotId', 'text'],
  key: ['screenshotId', 'key', 'modifiers'],
  scroll: ['screenshotId', 'delta', 'x', 'y'],
})

/** One frame request: which machine and root, for which Bot. */
export function parseDesktopView(payload) {
  const value = closed(payload, ['botId', 'machineId', 'rootId'], 'view')
  return { botId: identifier(value.botId, 'botId'), machineId: identifier(value.machineId, 'machineId'), rootId: identifier(value.rootId, 'rootId') }
}

/** One action on a frame the person has already seen. */
export function parseDesktopAct(payload) {
  const value = closed(payload, ['botId', 'machineId', 'rootId', 'screenshotId', 'action'], 'act')
  const action = closed(value.action, ['tool', 'name', ...new Set(Object.values(ACTIONS).flat())], 'action')
  const tool = action.tool ?? action.name
  if (typeof tool !== 'string' || !Object.hasOwn(ACTIONS, tool)) fail('INVALID_DESKTOP_ACTION')
  for (const key of Object.keys(action)) if (!ACTIONS[tool].includes(key) && key !== 'tool' && key !== 'name') fail(`INVALID_DESKTOP_ACTION:${tool}:${key}`)
  if (typeof value.screenshotId !== 'string' || !SCREENSHOT_ID.test(value.screenshotId)) fail('INVALID_DESKTOP_FRAME')
  const args = { screenshotId: value.screenshotId, ...action }
  delete args.tool
  delete args.name
  if (tool === 'click') {
    for (const key of ['x', 'y']) if (!Number.isSafeInteger(args[key]) || args[key] < 0 || args[key] > 100_000) fail(`INVALID_DESKTOP_ACTION:click:${key}`)
    if (args.button !== undefined && !['left', 'right', 'middle'].includes(args.button)) fail('INVALID_DESKTOP_ACTION:click:button')
    if (args.clickCount !== undefined && (!Number.isSafeInteger(args.clickCount) || args.clickCount < 1 || args.clickCount > 3)) fail('INVALID_DESKTOP_ACTION:click:clickCount')
  }
  if (tool === 'type' && (typeof args.text !== 'string' || args.text.length === 0 || args.text.length > 8_000)) fail('INVALID_DESKTOP_ACTION:type:text')
  if (tool === 'key') {
    const allowed = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']
    if (!allowed.includes(args.key)) fail('INVALID_DESKTOP_ACTION:key:key')
    if (args.modifiers !== undefined && (!Array.isArray(args.modifiers) || args.modifiers.length > 3
      || args.modifiers.some(item => !['ctrl', 'alt', 'shift'].includes(item)))) fail('INVALID_DESKTOP_ACTION:key:modifiers')
  }
  if (tool === 'scroll' && (!Number.isSafeInteger(args.delta) || args.delta === 0 || Math.abs(args.delta) > 1_200)) fail('INVALID_DESKTOP_ACTION:scroll:delta')
  return {
    botId: identifier(value.botId, 'botId'), machineId: identifier(value.machineId, 'machineId'),
    rootId: identifier(value.rootId, 'rootId'), screenshotId: value.screenshotId, tool: `desktop_${tool}`, args,
  }
}

/** Map a click in the rendered box back to pixels of the original frame. */
export function framePoint({ clientX, clientY, rect, frame }) {
  if (!rect || !frame || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) fail('INVALID_FRAME_GEOMETRY')
  if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width <= 0 || frame.height <= 0) fail('INVALID_FRAME_GEOMETRY')
  const ratio = Math.min(rect.width / frame.width, rect.height / frame.height)
  if (!Number.isFinite(ratio) || ratio <= 0) fail('INVALID_FRAME_GEOMETRY')
  const offsetX = (rect.width - frame.width * ratio) / 2
  const offsetY = (rect.height - frame.height * ratio) / 2
  const x = Math.floor((clientX - offsetX) / ratio)
  const y = Math.floor((clientY - offsetY) / ratio)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= frame.width || y >= frame.height) fail('POINT_OUTSIDE_FRAME')
  return { x, y }
}
