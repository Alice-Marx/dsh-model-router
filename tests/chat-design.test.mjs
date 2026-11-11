import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'
import { CHAT_DESIGN, chatContrast, chatTokens, cssBlocks, chatViolations, darkTokenGaps, selectorList, tokenGaps } from '../apps/integration-client/chat-design.mjs'

// The chat surface's own contract: what the stylesheet promises about colour,
// scope, touch and narrow layout. Behaviour of the components that live in it is
// covered by tests/chat-surface.integration.test.mjs; the browser run
// (scripts/verify-chat-design-browser.mjs) checks what only a real engine can.

const css = await readFile(new URL('../apps/integration-client/chat.css', import.meta.url), 'utf8')
const blocks = cssBlocks(css)
const ruleText = blocks.filter(block => !block.atRule).map(block => block.selectors).join('\n')

test('chat stylesheet parses without CSS warnings', async () => {
  const result = await transform(css, { loader: 'css', minify: true })
  assert.deepEqual(result.warnings, [])
})

test('both appearances declare the same chat tokens, and every pair clears its floor', () => {
  assert.deepEqual(tokenGaps(css), [])
  assert.deepEqual(darkTokenGaps(css), [], 'the dark block names every token itself instead of inheriting a light one')
  assert.deepEqual(chatViolations(css), [])
  const rows = chatContrast(css)
  assert.ok(rows.length >= 20, `the palette is checked across both appearances (${rows.length} pairs)`)
  for (const row of rows) {
    assert.ok(row.ratio >= row.minimum, `${row.mode}: ${row.ink} on ${row.on} is ${row.ratio.toFixed(2)}:1, under ${row.minimum}:1`)
  }
  const text = rows.filter(row => row.kind === 'text')
  assert.ok(text.every(row => row.ratio >= CHAT_DESIGN.bodyMinContrast), 'every text pair clears 4.5:1')
  const ui = rows.filter(row => row.kind === 'ui')
  assert.ok(ui.every(row => row.ratio >= CHAT_DESIGN.uiMinContrast), 'every ring and border pair clears 3:1')
})

test('the palette is declared as plain colours the contract can read', () => {
  const { light, dark } = chatTokens(css)
  for (const [mode, tokens] of [['light', light], ['dark', dark]]) {
    for (const [name, value] of tokens) {
      if (!name.startsWith('--bp-chat-')) continue
      // Shadows are the one token family that is not a colour.
      if (name.includes('-shadow')) continue
      assert.match(value, /^#[0-9a-f]{3,8}$/i, `${mode} ${name} must be a plain colour, not ${value}`)
    }
  }
})

test('every rule is scoped to the product UI, so other sessions keep their own styling', () => {
  const unscoped = blocks.filter(block => !block.atRule && !/data-bot-product-ui/.test(block.selectors)).map(block => block.selectors)
  assert.deepEqual(unscoped, [], `these rules reach past the Bot product: ${unscoped.join(' | ')}`)
  // The host's own chrome is only ever touched through the header that carries the
  // product's tools, and only for the properties DS Bot pins there.
  const hostSelectors = blocks.filter(block => !block.atRule && /\[class\*="/.test(block.selectors)).map(block => block.selectors)
  assert.deepEqual(hostSelectors, [
    // The conversation column carries the width token the vendor pins on this very
    // element, so the bridge has to name it: a value set on <body> would lose to
    // the vendor's own rule. It sets that one token and nothing else.
    'html body[data-bot-product-ui] [class*="_body"]:has(> [class*="_scrollBody"])',
    'body[data-bot-product-ui] header[class*="_header"]:has(.bp-conversation-tools)',
    'body[data-bot-product-ui] header[class*="_header"]:has(.bp-conversation-tools)::before',
    'body[data-bot-product-ui] :is([class*="_userRow"], [data-chat-flow-kind=question-reply], [data-chat-flow-kind=command-input]) [class*="_bubble"]',
  ])
})

test('the vendor-pinned surfaces are the only ones overridden with !important', () => {
  const pinned = []
  for (const block of blocks) {
    if (block.atRule) continue
    for (const statement of block.body.split(';')) {
      if (!statement.includes('!important')) continue
      pinned.push(block.selectors)
      break
    }
  }
  // The header band, the composer surface and the shell's own user bubble are the
  // three places DS Bot 0.2.7 pins a property this design changes. Anything else
  // must win on specificity alone, so a new !important is a decision to review.
  assert.deepEqual([...new Set(pinned)], [
    'body[data-bot-product-ui] header[class*="_header"]:has(.bp-conversation-tools)',
    'body[data-bot-product-ui] :is([class*="_userRow"], [data-chat-flow-kind=question-reply], [data-chat-flow-kind=command-input]) [class*="_bubble"]',
    'body[data-bot-product-ui] [data-composer-card]',
    'body[data-bot-product-ui] [data-composer-card]:hover',
    'body[data-bot-product-ui] [data-composer-card]:focus-within',
  ])
  // And never a layout or control property: those stay the native component's.
  // Each of the three vendor-pinned surfaces has a short list of properties it may
  // restate — exactly the ones DS Bot 0.2.7 pins — and nothing else.
  const PINNED = {
    'header[class*="_header"]': ['padding', 'background', 'border-bottom', 'box-shadow'],
    '[class*="_userRow"]': ['border-radius', 'padding', 'line-height'],
    '[data-composer-card]': ['background', 'border', 'border-color', 'border-radius', 'box-shadow', 'backdrop-filter', '-webkit-backdrop-filter'],
  }
  for (const block of blocks) {
    if (block.atRule || !block.body.includes('!important')) continue
    const allowed = Object.entries(PINNED).find(([needle]) => block.selectors.includes(needle))?.[1]
    assert.ok(allowed, `${block.selectors} uses !important without a vendor reason`)
    for (const statement of block.body.split(';')) {
      if (!statement.includes('!important')) continue
      const property = statement.slice(0, statement.indexOf(':')).trim()
      assert.ok(allowed.includes(property), `${block.selectors} pins ${property}, which the vendor does not`)
    }
  }
})

test('no rule hides an approval, an error, a stop control or the composer', () => {
  const guarded = ['.bt-q', '.bt-q-submit', '.bt-q-btn', '.bt-q-opt', '.bt-fail', '.bt-fail-go', '.bt-event-error', '.bp-conversation-live', '[data-composer-card]', '[data-composer-input]']
  for (const block of blocks) {
    if (block.atRule) continue
    for (const selector of selectorList(block.selectors)) {
      for (const name of guarded) {
        if (!selector.includes(name)) continue
        assert.doesNotMatch(block.body, /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*!?\s*(;|$)/, `${selector} hides ${name}`)
      }
    }
  }
  // The only controls the design collapses are the header's shortcut duplicates,
  // which the overflow menu carries in the same breath.
  const collapse = blocks.filter(block => !block.atRule && /display\s*:\s*none/.test(block.body)).map(block => block.selectors)
  assert.ok(collapse.every(selectors => /bp-conversation-shortcuts|bp-conversation-model-name|bp-conversation-members > span|bp-conversation-overflow|bp-contact-nav-label|svg:last-child/.test(selectors)), `unexpected collapses: ${collapse.join(' | ')}`)
  assert.match(css, /\.bp-conversation-overflow \{ display: block/, 'the overflow menu appears exactly where the shortcuts collapse')
})

test('touch, motion and narrow layout are handled, not left to the browser default', () => {
  const atRules = blocks.filter(block => block.atRule).map(block => block.atRule)
  assert.ok(atRules.some(rule => /pointer:\s*coarse/.test(rule)), 'coarse pointers get bigger targets')
  assert.ok(atRules.some(rule => /hover:\s*none/.test(rule)), 'hover-only reveals are reconsidered without hover')
  assert.ok(atRules.some(rule => /prefers-reduced-motion/.test(rule)), 'reduced motion is respected')
  assert.ok(atRules.some(rule => /bot-sidebar/.test(rule)), 'the sidebar keeps its container query')
  assert.ok(atRules.some(rule => /bp-chat-header/.test(rule)), 'the header keeps its container query')
  assert.match(css, /@media \(max-width: 640px\)/, 'the phone breakpoint is a real media query')
  assert.match(css, /data-bp-density=compact/, 'compact density is honoured')
  const coarse = blocks.filter(block => block.atRule?.includes('pointer: coarse')).map(block => block.body).join('\n')
  assert.match(coarse, /min-height: 44px/, 'menu rows reach a 44px touch target')
  assert.match(coarse, /min-width: 40px/, 'header and toolbar buttons reach a 40px touch target')
  const reduced = blocks.filter(block => block.atRule?.includes('prefers-reduced-motion')).map(block => block.body).join('\n')
  assert.match(reduced, /transition: none/, 'reduced motion removes the transitions')
  assert.match(reduced, /animation: none/, 'reduced motion removes the animations')
})

test('the transcript keeps a readable measure and never a fixed height', () => {
  assert.match(css, /--bt-msg-w: \.78/, 'a bubble takes at most its share of the column')
  for (const block of blocks) {
    if (block.atRule || !/\.bt-(bubble|ububble|ubody)|\[data-composer-card\]/.test(block.selectors)) continue
    // A control inside the card keeps its own fixed size; the surfaces do not.
    if (/\bbutton\b|\.bt-mic|\.bt-voice/.test(block.selectors)) continue
    for (const statement of block.body.split(';')) {
      const at = statement.indexOf(':')
      if (at < 0) continue
      const property = statement.slice(0, at).trim(), value = statement.slice(at + 1).trim()
      assert.notEqual(property, 'max-height', `${block.selectors} caps a height on the transcript`)
      if (property === 'height') assert.equal(value, 'auto', `${block.selectors} pins a height on the transcript`)
    }
  }
  assert.match(css, /overflow-wrap: anywhere/, 'long words break instead of widening the page')
  assert.match(css, /overscroll-behavior: contain/, 'scrolling code stays inside its box')
})

test('the focus ring contract is stated once and applied to every control', () => {
  assert.match(css, /outline: 2px solid var\(--bp-chat-focus\)/, 'the product controls use a 2px chat focus ring')
  assert.match(css, /outline-offset: 2px/, 'the ring is offset from the control')
  assert.match(css, /\[data-composer-card\] :is\(button, \[role=button\], \[contenteditable=true\]\):focus-visible/, 'the composer controls keep a ring')
})
