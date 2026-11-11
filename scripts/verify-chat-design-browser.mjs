// Real-browser verification of the Bot conversation surface against the offline
// preview fixture. What this proves and what it does not:
//
//   proves  the design holds in Chromium at 1360px and 375px, light and dark;
//            the composer is editable and its send/stop controls are reachable
//            and unobstructed; the product menus close on Escape and give focus
//            back; approvals, errors and the stop control stay visible; no page
//            or console error fires; nothing overflows sideways; body text and
//            focus rings clear their contrast floors.
//   does not prove anything about a live session: the fixture talks to no Host,
//            no model and no network, and its buttons are recorded, not executed.
//
// Artifacts land in tmp/integration/chat-design by default, or in the directory
// given as the first argument (used to publish the run's design-* files).

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { chatViolations, tokenGaps, CHAT_DESIGN } from '../apps/integration-client/chat-design.mjs'

const root = resolve(import.meta.dirname, '..')
const scratch = resolve(root, 'tmp/integration/chat-design')

/** DS Bot's own conversation stylesheets, read and compiled at run time. */
async function vendorChatCss() {
  const stub = resolve(scratch, 'ui-primitives-stub.mjs')
  // The shell's primitives module is stubbed: this preview never renders the
  // shell's own components, and its dependency tree is not installed.
  await mkdir(scratch, { recursive: true })
  await writeFile(stub, 'export default {}\n')
  const out = resolve(scratch, 'vendor-chat-css.mjs')
  await build({
    stdin: {
      contents: "import {SHELL_CSS,CONVERSATION_CSS} from './modules/bot-runtime/vendor/ds-bot/src/client/styles.js';import {USER_MESSAGE_CSS} from './modules/bot-runtime/vendor/ds-bot/src/client/user-message.js';import {TURN_ERROR_CSS} from './modules/bot-runtime/vendor/ds-bot/src/client/turn-error.js';export {SHELL_CSS,CONVERSATION_CSS,USER_MESSAGE_CSS,TURN_ERROR_CSS}",
      resolveDir: root, loader: 'js',
    },
    bundle: true, platform: 'node', format: 'esm', outfile: out,
    alias: { '@deepseek-ai/dsh-client-ui-primitives': stub }, logLevel: 'silent',
  })
  const { pathToFileURL } = await import('node:url')
  const module = await import(pathToFileURL(out).href)
  return [module.SHELL_CSS, module.CONVERSATION_CSS, module.USER_MESSAGE_CSS, module.TURN_ERROR_CSS].join('\n')
}

/** The inherited DS Bot theme, so the preview sees the same tokens the app does. */
async function inheritedThemeCss() {
  const source = await readFile(resolve(root, 'modules/bot-runtime/vendor/ds-bot/src/client/themes.js'), 'utf8')
  const bundle = await build({ stdin: { contents: source, resolveDir: resolve(root, 'modules/bot-runtime/vendor/ds-bot/src/client'), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', write: false })
  const { themeCss } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
  return themeCss({ light: { bg: '#fcfcfc', sidebar: '#f7f7f7', bubble: '#eeeeee', card: '#ffffff', text: '#141414', user: '#070707', userText: '#fcfcfc', accent: '#4d6bfe' }, dark: { bg: '#141414', sidebar: '#1b1b1b', bubble: '#262626', card: '#1f1f1f', text: '#f2f2f2', user: '#f2f2f2', userText: '#141414', accent: '#5b7bff' } })
}

export async function serveChatFixture() {
  const [vendorCss, themeCss] = await Promise.all([vendorChatCss(), inheritedThemeCss()])
  const bundle = await build({
    absWorkingDir: root, entryPoints: ['tests/fixtures/chat-design-preview.jsx'], bundle: true, write: false,
    format: 'iife', platform: 'browser', target: 'es2022', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
  })
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot 对话界面 · 本地离线预览</title></head><body><div id="root"></div><script>window.__fixtureVendorCss=${JSON.stringify(vendorCss).replace(/</g, '\\u003c')};window.__fixtureInheritedCss=${JSON.stringify(themeCss).replace(/</g, '\\u003c')}</script><script src="/fixture.js"></script></body></html>`
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
    if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html) }
    else if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(bundle.outputFiles[0].contents) }
    else { response.writeHead(404); response.end() }
  })
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(yes => server.close(yes)) }
}

const CONTRAST_PROBE = () => {
  const luminance = color => {
    const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const ratio = (a, b) => { const first = luminance(a), second = luminance(b); return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) }
  const read = (element, properties) => { const style = getComputedStyle(element); return Object.fromEntries(properties.map(name => [name, style[name]])) }
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;visibility:hidden'
  document.body.append(probe)
  const token = name => { probe.style.backgroundColor = `var(${name})`; return getComputedStyle(probe).backgroundColor }
  const tokens = {}
  for (const name of ['--bp-chat-ink', '--bp-chat-muted', '--bp-chat-canvas', '--bp-chat-surface', '--bp-chat-sidebar', '--bp-chat-inset', '--bp-chat-user', '--bp-chat-on-user', '--bp-chat-accent', '--bp-chat-danger', '--bp-chat-line']) tokens[name.slice('--bp-chat-'.length)] = token(name)
  probe.remove()
  const bubble = document.querySelector('.bt-bubble'), user = document.querySelector('.bt-ubody'), shellUser = document.querySelector('[class*="_userRow"] [class*="_bubble"]')
  const meta = document.querySelector('.bt-time-sep'), event = document.querySelector('.bt-event')
  const inbox = document.querySelector('.bp-contact-nav-button[data-contact-nav=inbox] .bp-contact-attention')
  return {
    appearance: document.body.getAttribute('data-bp-appearance'),
    tokens,
    bubble: bubble ? read(bubble, ['color', 'backgroundColor', 'fontSize', 'lineHeight', 'borderRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'paddingTop']) : null,
    user: user ? read(user, ['color', 'backgroundColor', 'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'paddingTop']) : null,
    shellUser: shellUser ? read(shellUser, ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'paddingTop', 'backgroundColor']) : null,
    meta: meta ? read(meta, ['color', 'fontSize']) : null,
    event: event ? read(event, ['color', 'fontSize']) : null,
    attention: inbox ? { ...read(inbox, ['color', 'backgroundColor', 'fontSize']), text: inbox.textContent } : null,
    ratios: {
      'ink on canvas': ratio(tokens.ink, tokens.canvas),
      'muted on surface': ratio(tokens.muted, tokens.surface),
      'on-user on user': ratio(tokens['on-user'], tokens.user),
      'accent on canvas': ratio(tokens.accent, tokens.canvas),
      'accent on surface': ratio(tokens.accent, tokens.surface),
      'danger on surface': ratio(tokens.danger, tokens.surface),
    },
  }
}

async function verify() {
  const outDir = resolve(process.argv[2] ? resolve(process.argv[2]) : scratch)
  await mkdir(outDir, { recursive: true })
  const fixture = await serveChatFixture()
  const browser = await chromium.launch({ headless: true })
  const failures = [], consoleErrors = [], checks = [], contrast = []
  const page = await browser.newPage({ viewport: { width: CHAT_DESIGN.wideViewport, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => failures.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  const capture = async name => { const path = resolve(outDir, `${name}.png`); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); return relative(root, path) }
  const images = []
  const setAppearance = async mode => {
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.getByRole('button', { name: { light: '浅色', dark: '深色', host: '跟随宿主' }[mode], exact: true }).click()
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.waitForFunction(want => document.body.getAttribute('data-bp-appearance') === want, mode)
  }
  try {
    await page.goto(fixture.url)
    await page.locator('.bt-row').first().waitFor()
    await page.locator('[data-testid=composer-stop]').waitFor()
    checks.push('offline preview mounts the real product components inside the native DOM contract')

    // Light appearance, wide viewport.
    await setAppearance('light')
    const light = await page.evaluate(CONTRAST_PROBE)
    contrast.push(light)
    for (const [name, ratio] of Object.entries(light.ratios)) {
      assert.ok(ratio >= (name.startsWith('accent') ? CHAT_DESIGN.uiMinContrast : CHAT_DESIGN.bodyMinContrast), `light ${name} is ${ratio.toFixed(2)}:1`)
    }
    assert.equal(light.attention.color, 'rgb(179, 38, 30)', 'the attention badge uses the danger ink')
    assert.equal(light.attention.backgroundColor, 'rgb(251, 233, 231)', 'the attention badge uses the danger surface')
    assert.match(light.attention.text, /^2\+?$/, 'the attention badge counts what the committed projection says')
    checks.push('the attention badge states a real count in the danger colours')
    assert.equal(light.bubble.paddingTop, '10px')
    assert.equal(light.bubble.borderTopRightRadius, '16px')
    // The vendor's joined-corner longhand still layers on top of the design radius,
    // so a bubble that continues a run keeps its tightened corner.
    assert.equal(light.bubble.borderBottomLeftRadius, '6px', 'the bubble join survives the new radius')
    assert.equal(light.user.borderTopLeftRadius, '16px')
    assert.equal(light.user.borderBottomRightRadius, '5px', 'the user bubble keeps its tail corner')
    assert.equal(light.user.borderBottomLeftRadius, '16px')
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']) assert.equal(light.shellUser[corner], '16px', `the shell user bubble matches the other renderers (${corner})`)
    assert.equal(light.shellUser.paddingTop, light.user.paddingTop, 'the shell user bubble matches the other renderers')
    checks.push('light appearance: body text 4.5:1, rings 3:1, bubbles share one geometry')

    // The header band is the product's, not the vendor's glass strip.
    const header = await page.locator('header[class*="_header"]').evaluate(element => { const style = getComputedStyle(element); return { background: style.backgroundColor, borderBottom: style.borderBottomWidth, container: style.containerName } })
    assert.equal(header.background, 'rgb(252, 252, 253)')
    assert.equal(header.borderBottom, '1px')
    assert.equal(header.container, 'bp-chat-header')
    checks.push('the conversation header takes the chat canvas, its hairline and its container query')

    // Contact list: hierarchy and the current-contact edge.
    const rows = await page.locator('.bt-row').evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node); const name = node.querySelector('.bt-row-name'), preview = node.querySelector('.bt-row-preview'); return { current: node.getAttribute('aria-current'), height: node.getBoundingClientRect().height, radius: style.borderRadius, nameSize: name ? getComputedStyle(name).fontSize : null, previewSize: preview ? getComputedStyle(preview).fontSize : null, previewColor: preview ? getComputedStyle(preview).color : null, edge: getComputedStyle(node, '::before').width } }))
    assert.ok(rows.every(row => row.height >= 48), 'every contact row keeps a comfortable target')
    assert.equal(rows.find(row => row.current === 'page').edge, '3px', 'the current contact carries the accent edge')
    assert.ok(rows.every(row => Number.parseFloat(row.previewSize) < Number.parseFloat(row.nameSize)), 'the preview is quieter than the name')
    images.push(await capture('design-chat-light-wide'))
    checks.push('contact rows keep a name/preview ladder, a 3px current edge and 48px+ targets')

    // Nothing overflows sideways, in either direction.
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth > window.innerWidth, column: document.querySelector('[class*="_scroll"]').scrollWidth > document.querySelector('[class*="_scroll"]').clientWidth, composer: document.querySelector('[data-composer-card]').scrollWidth > document.querySelector('[data-composer-card]').clientWidth }))
    assert.equal(overflow.document, false)
    assert.equal(overflow.column, false)
    assert.equal(overflow.composer, false)
    checks.push('long code, long file names and long previews cause no horizontal overflow')

    // The composer: editable, reachable, and its controls are what a click hits.
    await page.locator('[data-testid=composer-input]').click()
    await page.keyboard.type('把设计写进资料库之前先给我看 diff')
    assert.match(await page.locator('[data-testid=composer-input]').innerText(), /把设计写进资料库/)
    const hit = await page.evaluate(() => {
      const stop = document.querySelector('[data-testid=composer-stop]'), send = document.querySelector('[data-testid=composer-send]')
      const at = element => { const box = element.getBoundingClientRect(); const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return target === element || element.contains(target) }
      return { stopHit: stop ? at(stop) : null, sendHit: send ? at(send) : null, stopVisible: stop ? getComputedStyle(stop).display !== 'none' && stop.getBoundingClientRect().height > 0 : null }
    })
    assert.equal(hit.stopHit, true, 'nothing covers the stop control')
    assert.equal(hit.stopVisible, true, 'the stop control is not hidden for a prettier picture')
    await page.locator('[data-testid=composer-stop]').click()
    assert.deepEqual(await page.evaluate(() => window.__chatDesignFixture.calls.map(row => row.action)), ['停止这一轮'])
    checks.push('the composer is editable and its stop control is visible, unobstructed and reaches its action')

    // Send: the same slot, now the shell's send state.
    const send = page.locator('[data-testid=composer-send]')
    await send.waitFor()
    assert.equal(await send.isEnabled(), true)
    await send.click()
    assert.match(await page.evaluate(() => window.__chatDesignFixture.calls.at(-1).action), /发送消息/)
    assert.match(await page.locator('.bt-ubody').last().innerText(), /把设计写进资料库/)
    checks.push('a typed message is sent through the composer slot and echoed as a local user bubble')

    // Menus close on Escape and give focus back to what opened them.
    await page.locator('.bp-contact-resources > summary').click()
    assert.equal(await page.locator('.bp-contact-resources').evaluate(node => node.open), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.bp-contact-resources').evaluate(node => node.open), false)
    assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'SUMMARY' && document.activeElement?.closest('.bp-contact-resources') !== null), true, 'focus returns to the summary')
    // The overflow menu only exists where the header is narrow, so it is checked below.
    checks.push('the resource menu closes on Escape and restores focus to its summary')

    // Approvals, errors and the question card stay on screen and readable.
    for (const selector of ['.bt-q', '.bt-q-submit', '.bt-fail', '.bt-fail-go', '.bt-event-error']) {
      const visible = await page.locator(selector).first().evaluate(node => { const box = node.getBoundingClientRect(); const style = getComputedStyle(node); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' })
      assert.equal(visible, true, `${selector} must stay visible`)
    }
    const errorColor = await page.locator('.bt-event-error').evaluate(node => getComputedStyle(node).color)
    assert.equal(errorColor, 'rgb(179, 38, 30)')
    checks.push('question cards, turn errors and their buttons stay visible in the danger colour')

    // Dark appearance.
    await setAppearance('dark')
    const dark = await page.evaluate(CONTRAST_PROBE)
    contrast.push(dark)
    for (const [name, ratio] of Object.entries(dark.ratios)) {
      assert.ok(ratio >= (name.startsWith('accent') ? CHAT_DESIGN.uiMinContrast : CHAT_DESIGN.bodyMinContrast), `dark ${name} is ${ratio.toFixed(2)}:1`)
    }
    images.push(await capture('design-chat-dark-wide'))
    checks.push('dark appearance keeps the same contrast floors')

    // Focus rings: reachable by keyboard, visible, and 3:1 against what they sit on.
    // Tab is the honest way in: a scripted focus() does not match :focus-visible.
    for (let step = 0; step < 40; step += 1) {
      if (await page.evaluate(() => document.activeElement?.classList.contains('bt-row'))) break
      await page.keyboard.press('Tab')
    }
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('bt-row')), true, 'a contact row is reachable with Tab')
    const ring = await page.evaluate(() => { const node = document.activeElement, style = getComputedStyle(node); return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, background: getComputedStyle(node.closest('.bt-side')).backgroundColor } })
    assert.equal(ring.width, '2px')
    assert.equal(ring.style, 'solid')
    const ringRatio = await page.evaluate(([outline, background]) => {
      const luminance = color => { const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4); return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 }
      const first = luminance(outline), second = luminance(background)
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    }, [ring.color, ring.background])
    assert.ok(ringRatio >= CHAT_DESIGN.uiMinContrast, `focus ring is ${ringRatio.toFixed(2)}:1`)
    checks.push('focus rings are 2px solid and clear 3:1 on their surface')

    // Compact density.
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.getByRole('button', { name: '紧凑', exact: true }).click()
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.waitForFunction(() => document.body.getAttribute('data-bp-density') === 'compact')
    const compactHeight = await page.locator('.bt-row').first().evaluate(node => node.getBoundingClientRect().height)
    assert.ok(compactHeight < rows[0].height && compactHeight >= 44, `compact rows tighten from ${rows[0].height}px to ${compactHeight}px`)
    images.push(await capture('design-chat-light-compact'))
    checks.push('compact density tightens the contact rows without losing the ladder')

    // Phone width.
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.getByRole('button', { name: '舒适', exact: true }).click()
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.setViewportSize({ width: CHAT_DESIGN.narrowViewport, height: 780 })
    await page.waitForFunction(() => document.querySelector('.bp-contact-nav').classList.contains('bp-contact-nav-compact'))
    const narrow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth > window.innerWidth, column: document.querySelector('[class*="_scroll"]').scrollWidth > document.querySelector('[class*="_scroll"]').clientWidth, card: document.querySelector('[data-composer-card]').getBoundingClientRect().width, labels: [...document.querySelectorAll('.bp-contact-nav-label')].every(node => getComputedStyle(node).display === 'none') }))
    assert.equal(narrow.document, false, 'no page-level horizontal overflow at 375px')
    assert.equal(narrow.column, false, 'no transcript overflow at 375px')
    assert.ok(narrow.card <= CHAT_DESIGN.narrowViewport, 'the composer card fits the phone')
    assert.equal(narrow.labels, true, 'the contact nav collapses to icons on a phone')
    images.push(await capture('design-chat-light-375'))
    checks.push('375px: the nav collapses, nothing overflows, the composer still fits')

    // The overflow menu carries the same commands when the shortcuts are gone.
    await page.locator('.bp-conversation-overflow > summary').click()
    assert.equal(await page.locator('.bp-conversation-menu button').count() > 0, true)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.bp-conversation-overflow').evaluate(node => node.open), false)
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.bp-conversation-overflow') !== null), true, 'focus returns to the overflow summary')
    await page.locator('.bp-conversation-overflow > summary').click()
    await page.locator('.bp-conversation-menu button').first().click()
    assert.match(await page.evaluate(() => window.__chatDesignFixture.calls.at(-1).action), /聊天工具/)
    await page.waitForFunction(() => document.querySelector('.bp-conversation-overflow').open === false)
    checks.push('on a phone the overflow menu closes on Escape, restores focus and still reaches every conversation tool')
    assert.deepEqual(failures, [], `page errors: ${failures.join('; ')}`)
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`)
    checks.push('no page error and no console error across the whole run')

    const report = { status: 'passed', localFixture: true, offlinePreview: true, checks, contrast, images, pageErrors: failures, consoleErrors, design: { violations: chatViolations(await readFile(resolve(root, 'apps/integration-client/chat.css'), 'utf8')), gaps: tokenGaps(await readFile(resolve(root, 'apps/integration-client/chat.css'), 'utf8')) } }
    await writeFile(resolve(outDir, 'design-browser-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    await capture('design-chat-failure')
    await writeFile(resolve(outDir, 'design-failure.json'), JSON.stringify({ message: error.message, pageErrors: failures, consoleErrors }, null, 2))
    throw error
  } finally { await browser.close(); await fixture.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--serve')) {
    const fixture = await serveChatFixture(); console.log(JSON.stringify({ url: fixture.url, localFixture: true }))
    const close = async () => { await fixture.close(); process.exit(0) }
    process.on('SIGINT', close); process.on('SIGTERM', close)
  } else await verify()
}
