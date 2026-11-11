import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serveIndependentChatFixture } from './verify-independent-chat-browser.mjs'

const root = resolve(import.meta.dirname, '..')

/**
 * Rich-text safety/rendering regression for the independent chat page.
 * Reuses the same real React fixture bundle and the real public
 * @deepseek-ai/dsh-client-ui-primitives renderer (katex + shiki) as the
 * 15-check script; this adds Markdown/GFM, math, code, table, copy and
 * injection-safety coverage. Serial, real screenshots, offline.
 */
export async function verifyIndependentChatRichBrowser({ outputDir = resolve(root, 'tmp/integration/independent-chat-rich') } = {}) {
  const output = resolve(outputDir); await mkdir(output, { recursive: true })
  const fixture = await serveIndependentChatFixture()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const errors = [], checks = [], images = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const url = request.url(); if (/^https?:/i.test(url) && !/^https?:\/\/127\.0\.0\.1/.test(url)) external.push(url) })
  const capture = async name => { const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: false, animations: 'disabled' }); images.push(path) }
  const msg = suffix => page.locator(`[data-message-id$="rich-${suffix}"]`)
  // The OS clipboard stores text with CRLF on Windows; compare content, not the platform's line-ending storage.
  const norm = value => String(value ?? '').replace(/\r\n/g, '\n')
  try {
    await page.goto(fixture.url)
    await page.getByLabel('发消息给', { exact: false }).waitFor()
    await page.waitForFunction(() => document.querySelector('.ic-composer textarea')?.disabled === false)
    await page.locator('[data-message-id]').first().waitFor()

    assert.ok(fixture.rendererInputs.some(path => /dsh-client-ui-primitives/.test(path)), 'the real public renderer is bundled')
    assert.ok(fixture.rendererInputs.some(path => /katex/.test(path)), 'katex is bundled')
    assert.ok(fixture.rendererInputs.some(path => /shiki/.test(path)), 'shiki is bundled')
    checks.push('the bundle wires the real public @deepseek-ai/dsh-client-ui-primitives MarkdownText renderer with katex and shiki, not a stub')

    for (const width of [1360, 375]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(value => { document.body.dataset.bpAppearance = value }, theme)
      await msg('longcode').scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await page.locator('.ic-composer').evaluate(node => { const box = node.getBoundingClientRect(); return box.bottom <= innerHeight + 1 && box.left >= 0 && box.right <= innerWidth + 1 }), true)
      await capture(`rich-${width}-${theme}`)
    }
    checks.push('1360/375 light/dark: the rich transcript (code, wide table, math, tool calls) fits without horizontal page overflow and keeps the composer in view')

    await page.setViewportSize({ width: 375, height: 900 }); await page.evaluate(() => { document.body.dataset.bpAppearance = 'dark' })
    await msg('longcode').scrollIntoViewIfNeeded()
    const longCode = await msg('longcode').locator('.md-code-block pre').evaluate(node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }))
    assert.ok(longCode.scrollWidth > longCode.clientWidth, 'long code scrolls inside its own card')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    checks.push('a long single-line code block scrolls inside its own card at 375px without overflowing the page')

    await msg('table').scrollIntoViewIfNeeded()
    assert.ok(await msg('table').locator('.md-table-wide').count() >= 1, 'a 5-column table is rendered as md-table-wide')
    const table = await msg('table').locator('.md-table-wide').first().evaluate(node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }))
    assert.ok(table.scrollWidth > table.clientWidth, 'the wide table scrolls inside its own region')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    checks.push('a 5-column GFM table becomes a locally scrollable md-table-wide region at 375px without page overflow')

    await msg('math').scrollIntoViewIfNeeded()
    assert.ok(await msg('math').locator('.katex').count() >= 2, 'inline and display math render via KaTeX')
    assert.ok(await msg('math').locator('.katex-display').count() >= 1, 'a display formula renders')
    checks.push('inline and display mathematics render through KaTeX with correct surrounding CJK text')

    await msg('basics').scrollIntoViewIfNeeded()
    assert.ok(await msg('basics').locator('h2').count() >= 1, 'a heading renders')
    assert.ok(await msg('basics').locator('ol').count() >= 1, 'an ordered list renders')
    assert.ok(await msg('basics').locator('blockquote').count() >= 1, 'a blockquote renders')
    assert.ok(await msg('basics').locator('code').count() >= 1, 'inline code renders')
    assert.ok(await msg('basics').locator('strong').count() >= 1, 'bold renders')
    checks.push('headings, ordered lists, blockquotes, inline code and bold render as real GFM elements')

    await msg('links').scrollIntoViewIfNeeded()
    const links = await page.evaluate(() => {
      const bubble = document.querySelector('[data-message-id$="rich-links"] .ic-bubble')
      return { anchors: [...bubble.querySelectorAll('a')].map(a => a.getAttribute('href')), images: bubble.querySelectorAll('img').length, text: bubble.textContent }
    })
    assert.deepEqual(links.anchors, ['https://example.invalid/page'], 'only the https link becomes a navigable anchor')
    assert.ok(!links.anchors.some(href => /javascript:|data:|file:/i.test(href || '')), 'no unsafe-protocol anchor reaches the DOM')
    assert.equal(links.images, 0, 'a local image path is never loaded as an image')
    assert.ok(links.text.includes('机密图片'), 'a local image keeps only its alt text')
    await capture('rich-links-safety-dark')
    checks.push('a safe https link becomes an anchor while javascript:/data:/file: links and a local image path stay inert text/alt with no navigation or path access')

    await msg('rawhtml').scrollIntoViewIfNeeded()
    const raw = await page.evaluate(() => {
      const bubble = document.querySelector('[data-message-id$="rich-rawhtml"] .ic-bubble')
      return {
        script: bubble.querySelectorAll('script').length, image: bubble.querySelectorAll('img').length,
        onclick: bubble.querySelectorAll('[onclick]').length, onerror: bubble.querySelectorAll('[onerror]').length,
        bold: bubble.querySelectorAll('b').length,
        markers: { raw: window.__richRawHtml, image: window.__richImgOnerror, div: window.__richDivOnclick },
      }
    })
    assert.equal(raw.script, 0); assert.equal(raw.image, 0); assert.equal(raw.onclick, 0); assert.equal(raw.onerror, 0); assert.equal(raw.bold, 0)
    assert.deepEqual(raw.markers, { raw: undefined, image: undefined, div: undefined }, 'no raw-HTML side effect executed')
    await capture('rich-rawhtml-safety-dark')
    checks.push('raw HTML (script, img-onerror, div-onclick, bold) renders as inert escaped text: no live element, no event attribute, no executed side effect')

    await msg('toolcall').scrollIntoViewIfNeeded()
    const toolDetails = msg('toolcall').locator('.ic-rich-tool-calls')
    assert.ok(await toolDetails.count() >= 1, 'recorded tool calls render in a collapsible section')
    await toolDetails.locator('summary').click()
    const tool = await page.evaluate(() => {
      const section = document.querySelector('[data-message-id$="rich-toolcall"] .ic-rich-tool-calls')
      const text = section.textContent
      return {
        readId: text.includes('call-rich-read'), runId: text.includes('call-rich-run'),
        args: text.includes('C:/notes/secret.md'),
        inertArg: section.querySelectorAll('script').length === 0 && [...section.querySelectorAll('pre')].some(pre => pre.textContent.includes('<script>alert(1)</script>')),
        result: text.includes('命令被拒绝'), errorResult: text.includes('记录为错误结果'),
        controls: [...section.querySelectorAll('button')].map(button => button.textContent.trim()),
      }
    })
    assert.ok(tool.readId && tool.runId, 'real call ids are shown')
    assert.ok(tool.args, 'real arguments are shown')
    assert.ok(tool.inertArg, 'a dangerous argument is shown as inert text, never executed')
    assert.ok(tool.result && tool.errorResult, 'real results and the error marker are shown')
    assert.ok(!tool.controls.some(label => /执行|重试|run|retry/i.test(label)), 'no execute or retry control is offered')
    await capture('rich-tool-calls-dark')
    checks.push('expanded tool calls reveal the real id/name/args/result as inert text with no execute or retry control; a result record is not claimed as completion')

    await msg('code').scrollIntoViewIfNeeded()
    const jsBlock = msg('code').locator('.md-code-block').filter({ has: page.locator('[data-code-block-banner]', { hasText: /^js/ }) })
    const codeText = await jsBlock.locator('[data-code-block-content] pre').textContent()
    assert.ok((codeText ?? '').includes('const raw'), 'the code body is present for copy')
    await jsBlock.locator('[data-code-block-banner] button').click()
    await jsBlock.locator('.ic-rich-code-feedback[data-copy-ok="true"]').waitFor()
    const codeClipboard = await page.evaluate(() => navigator.clipboard.readText())
    assert.equal(norm(codeClipboard), norm(codeText), 'the code copy writes the exact rendered code to the clipboard')
    assert.equal(await jsBlock.locator('.ic-rich-code-feedback').textContent(), '代码已复制')
    checks.push('the public code-card copy is captured and uses the real clipboard helper, reporting success only after the exact code is written')

    const original = await msg('basics').locator('.ic-rich-raw textarea').inputValue()
    await msg('basics').locator('button[aria-label="复制消息原文"]').click()
    await msg('basics').locator('.ic-rich-message-actions span[data-copy-ok="true"]').waitFor()
    const messageClipboard = await page.evaluate(() => navigator.clipboard.readText())
    assert.equal(norm(messageClipboard), norm(original), 'copying the message writes the exact original Markdown source')
    assert.equal(await msg('basics').locator('.ic-rich-message-actions span[data-copy-ok]').textContent(), '消息原文已复制')
    checks.push('the whole-message copy writes the exact original Markdown source and reports success only after the real clipboard write')

    const userMessage = page.locator('[data-message-id$="history-52"]')
    await userMessage.scrollIntoViewIfNeeded()
    const userOriginal = await userMessage.locator('.ic-rich-raw textarea').inputValue()
    await userMessage.locator('button[aria-label="复制消息原文"]').click()
    await userMessage.locator('.ic-rich-message-actions span[data-copy-ok="true"]').waitFor()
    assert.equal(norm(await page.evaluate(() => navigator.clipboard.readText())), norm(userOriginal), 'a user message copies its own original text')
    checks.push('a user message also exposes the whole-original copy and writes its exact original text')

    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('clipboard denied')), readText: () => Promise.resolve('') } }) })
    await msg('math').locator('button[aria-label="复制消息原文"]').click()
    await msg('math').locator('.ic-rich-message-actions span[data-copy-ok="false"]').waitFor()
    assert.match(await msg('math').locator('.ic-rich-message-actions span[data-copy-ok]').textContent(), /复制失败/)
    checks.push('a denied clipboard write surfaces an explicit failure message instead of claiming success')

    assert.deepEqual(external, [], 'no real external network request is made')
    assert.deepEqual(errors, [])
    const report = { status: 'passed', checks, images, pageErrors: errors, externalRequests: external, rendererInputs: fixture.rendererInputs,
      limitation: 'Real React + real public renderer (katex/shiki), synthetic owner API and offline. Native owner/SQLite/SDK chain is covered separately.' }
    await writeFile(join(output, 'rich-browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); return report
  } finally { await context.close(); await browser.close(); await fixture.close() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyIndependentChatRichBrowser()
