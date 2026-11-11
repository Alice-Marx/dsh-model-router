// The chat surface's display model: the numbers the design commits to, plus the
// checks that read them back out of chat.css. chat.css stays the single source of
// truth for colour values; this module holds the rules those values must satisfy,
// so a palette edit that drops below AA fails a test instead of a person's eyes.
//
// Nothing here touches the DOM: the node test runs it directly, and the browser
// verification script imports the same rules so both report one verdict.

/** WCAG 2.1 relative luminance of an sRGB colour. */
export function luminance(color) {
  const channels = channelsOf(color)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

/** WCAG 2.1 contrast ratio, 1:1 through 21:1. */
export function contrastRatio(a, b) {
  const first = luminance(a), second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** The design's own numbers. Every value is one a reader can argue with. */
export const CHAT_DESIGN = Object.freeze({
  /** Body copy is 14px and up, so the bar is the normal-text 4.5:1. */
  bodyMinContrast: 4.5,
  /** Focus rings, hairlines and control borders: WCAG 1.4.11 wants 3:1. */
  uiMinContrast: 3,
  /** Pointer targets stay legible and tappable without becoming furniture. */
  minTouchTarget: 24,
  coarseTouchTarget: 40,
  menuRowHeight: 36,
  focusRingWidth: 2,
  focusRingOffset: 2,
  /** A bubble never takes the whole column: the reply keeps a readable measure. */
  bubbleShare: 0.78,
  /** The narrow layout has to hold on the smallest phone we support. */
  narrowViewport: 375,
  wideViewport: 1360,
  /** Radius ladder, from the composer card down to a badge. */
  radius: Object.freeze({ card: 20, bubble: 16, control: 10, menu: 12, badge: 6 }),
})

// Token pairs the palette must clear, per mode. `on` is what the ink sits on;
// the minimum comes from CHAT_DESIGN. A pair only exists when both tokens are
// declared, so adding a surface never breaks an older mode.
const TEXT_PAIRS = [
  ['--bp-chat-ink', '--bp-chat-canvas'],
  ['--bp-chat-ink', '--bp-chat-surface'],
  ['--bp-chat-ink', '--bp-chat-sidebar'],
  ['--bp-chat-ink', '--bp-chat-inset'],
  ['--bp-chat-muted', '--bp-chat-surface'],
  ['--bp-chat-muted', '--bp-chat-canvas'],
  ['--bp-chat-muted', '--bp-chat-sidebar'],
  ['--bp-chat-muted', '--bp-chat-inset'],
  ['--bp-chat-on-user', '--bp-chat-user'],
  ['--bp-chat-danger', '--bp-chat-surface'],
  ['--bp-chat-danger', '--bp-chat-canvas'],
  ['--bp-chat-danger', '--bp-chat-danger-bg'],
  ['--bp-chat-warning', '--bp-chat-warning-bg'],
  ['--bp-chat-on-accent', '--bp-chat-accent'],
]
const UI_PAIRS = [
  ['--bp-chat-accent', '--bp-chat-surface'],
  ['--bp-chat-accent', '--bp-chat-canvas'],
  ['--bp-chat-accent', '--bp-chat-sidebar'],
  ['--bp-chat-focus', '--bp-chat-surface'],
  ['--bp-chat-focus', '--bp-chat-canvas'],
]
// A hairline is decoration, not a control boundary: WCAG 1.4.11 does not reach it.
// It still has to be visible, so the floor is a line you can see on its surface.
const HAIRLINE_MIN = 1.2
const HAIRLINE_PAIRS = [
  ['--bp-chat-line', '--bp-chat-surface'],
  ['--bp-chat-line', '--bp-chat-canvas'],
  ['--bp-chat-line', '--bp-chat-sidebar'],
]

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function channelsOf(color) {
  const value = String(color).trim()
  if (HEX.test(value)) {
    const digits = value.slice(1)
    const wide = digits.length <= 4 ? [...digits].map(digit => digit + digit) : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)]
    return wide.slice(0, 3).map(pair => parseInt(pair, 16) / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  }
  const numbers = value.match(/-?\d*\.?\d+/g)
  if (!numbers) throw new Error(`chat design: cannot read a colour out of ${value}`)
  return numbers.slice(0, 3).map(Number).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
}

/** Splits CSS text into `{ selectors, declarations, atRule }` blocks, nested ones included. */
export function cssBlocks(text) {
  const blocks = []
  const walk = (start, end, atRule) => {
    let cursor = start
    while (cursor < end) {
      const open = text.indexOf('{', cursor)
      if (open < 0 || open >= end) break
      const close = matchBrace(text, open, end)
      // The prelude carries the comments that sat between this rule and the last one.
      const prelude = text.slice(cursor, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
      if (prelude.startsWith('@keyframes')) { cursor = close + 1; continue }
      if (prelude.startsWith('@')) walk(open + 1, close, prelude)
      else if (prelude) {
        blocks.push({ selectors: prelude, body: text.slice(open + 1, close), atRule })
        walk(open + 1, close, atRule)
      }
      cursor = close + 1
    }
  }
  walk(0, text.length, null)
  return blocks
}

function matchBrace(text, open, end) {
  let depth = 0
  for (let at = open; at < end; at += 1) {
    if (text[at] === '{') depth += 1
    else if (text[at] === '}') { depth -= 1; if (depth === 0) return at }
  }
  throw new Error('chat design: unbalanced braces in the chat stylesheet')
}

function declarationsOf(body) {
  const found = new Map()
  for (const statement of body.split(';')) {
    const at = statement.indexOf(':')
    if (at < 0) continue
    const name = statement.slice(0, at).trim()
    const value = statement.slice(at + 1).trim()
    if (name.startsWith('--')) found.set(name, value)
  }
  return found
}

/** A selector list split on its top-level commas, so `:not([a=x])` stays one selector. */
export function selectorList(selectors) {
  const list = []
  let depth = 0, start = 0
  for (let at = 0; at < selectors.length; at += 1) {
    const character = selectors[at]
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ',' && depth === 0) { list.push(selectors.slice(start, at).trim()); start = at + 1 }
  }
  list.push(selectors.slice(start).trim())
  return list.filter(Boolean)
}

/**
 * A selector with its guards taken out. `:not([data-bp-appearance=light])` is a
 * condition on when the rule applies, never an appearance of its own, so reading
 * the raw text would file a dark rule under the light one.
 */
function withoutGuards(selector) {
  let text = selector
  for (let guard = /:(?:not|has|is|where|matches)\(([^()]*)\)/; guard.test(text);) text = text.replace(guard, '')
  return text
}

const isDarkSelector = selector => /data-ds-dark-theme|data-bp-appearance=dark/.test(withoutGuards(selector))
const isLightSelector = selector => /data-bp-appearance=light/.test(withoutGuards(selector))

/** Which appearance a rule paints: `dark`, `light` or `default` (the light values). */
export function ruleMode(selectors) {
  const list = selectorList(selectors)
  if (list.some(isDarkSelector)) return 'dark'
  if (list.some(isLightSelector)) return 'light'
  return 'default'
}

/**
 * The `--bp-chat-*` tokens chat.css declares, per mode. The dark mode inherits
 * anything the light mode declares and it does not, which is what the stylesheet
 * itself does, so a missing dark token is a real gap rather than a parse artifact.
 */
export function chatTokens(css) {
  const light = new Map(), dark = new Map()
  for (const block of cssBlocks(css)) {
    if (block.atRule || !/data-bot-product-ui/.test(block.selectors)) continue
    const declarations = declarationsOf(block.body)
    const names = [...declarations.keys()].filter(name => name.startsWith('--bp-chat-'))
    if (!names.length) continue
    // One selector list can paint both appearances at once (the default block names
    // the dark theme as one of its selectors), so each selector is read on its own.
    const targets = new Map()
    for (const selector of selectorList(block.selectors)) {
      const modes = isDarkSelector(selector) ? ['dark'] : isLightSelector(selector) ? ['light'] : ['light', 'dark']
      for (const mode of modes) targets.set(mode, mode === 'dark' ? dark : light)
    }
    for (const [name, value] of declarations) for (const target of targets.values()) if (targets.size) target.set(name, value)
  }
  for (const [name, value] of light) if (!dark.has(name)) dark.set(name, value)
  return { light, dark }
}

/**
 * Every contrast pair the palette declares, with the ratio it actually reaches.
 * `minimum` is 4.5:1 for text and 3:1 for rings and borders.
 */
export function chatContrast(css) {
  const tokens = chatTokens(css)
  const rows = []
  for (const [mode, values] of [['light', tokens.light], ['dark', tokens.dark]]) {
    for (const [ink, on] of TEXT_PAIRS) {
      if (!values.has(ink) || !values.has(on)) continue
      rows.push({ mode, ink, on, ratio: contrastRatio(values.get(ink), values.get(on)), minimum: CHAT_DESIGN.bodyMinContrast, kind: 'text' })
    }
    for (const [ink, on] of UI_PAIRS) {
      if (!values.has(ink) || !values.has(on)) continue
      rows.push({ mode, ink, on, ratio: contrastRatio(values.get(ink), values.get(on)), minimum: CHAT_DESIGN.uiMinContrast, kind: 'ui' })
    }
    for (const [ink, on] of HAIRLINE_PAIRS) {
      if (!values.has(ink) || !values.has(on)) continue
      rows.push({ mode, ink, on, ratio: contrastRatio(values.get(ink), values.get(on)), minimum: HAIRLINE_MIN, kind: 'hairline' })
    }
  }
  return rows
}

/** The pairs that fall short, as readable lines. */
export function chatViolations(css) {
  return chatContrast(css)
    .filter(row => row.ratio < row.minimum)
    .map(row => `${row.mode}: ${row.ink} on ${row.on} is ${row.ratio.toFixed(2)}:1, under ${row.minimum}:1`)
}

/**
 * Tokens the dark block has to name for itself. A dark appearance that simply
 * inherits a light token still parses and still computes — it just reads wrong on
 * a dark canvas (a hairline that disappears, a border that turns to mud), which is
 * exactly the kind of regression a contrast check on the inherited value misses.
 */
export function darkTokenGaps(css) {
  const lightNames = new Set(), darkNames = new Set()
  for (const block of cssBlocks(css)) {
    if (block.atRule || !/data-bot-product-ui/.test(block.selectors)) continue
    const selectors = selectorList(block.selectors)
    const darkOnly = selectors.length > 0 && selectors.every(isDarkSelector)
    const names = [...declarationsOf(block.body).keys()].filter(name => name.startsWith('--bp-chat-'))
    for (const name of names) (darkOnly ? darkNames : lightNames).add(name)
  }
  return [...lightNames].filter(name => !darkNames.has(name)).map(name => `${name} has no dark declaration`)
}

/** Both modes must name the same tokens, or one appearance silently loses a surface. */
export function tokenGaps(css) {
  const { light, dark } = chatTokens(css)
  return [...light.keys()].filter(name => !dark.has(name)).map(name => `${name} has no dark value`)
}
