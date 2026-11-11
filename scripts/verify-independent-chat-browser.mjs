import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
export async function serveIndependentChatFixture({ handleApi, native = false } = {}) {
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/fixtures/independent-chat-preview.jsx'], bundle: true, write: false,
    outdir: resolve(root, 'tmp/integration/independent-chat-rich/bundle'), entryNames: 'fixture',
    alias: { react: resolve(root, 'node_modules/react'), 'react-dom': resolve(root, 'node_modules/react-dom') }, metafile: true,
    format: 'iife', platform: 'browser', target: 'es2022', loader: { '.css': 'text', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    plugins: [{ name: 'real-host-markdown-styles', setup(builder) {
      builder.onLoad({ filter: /\.module\.css$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'local-css' }))
      builder.onLoad({ filter: /[\\/]katex(?:\.min)?\.css$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'css' }))
    } }], define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')), stylesheet = bundle.outputFiles.find(file => file.path.endsWith('.css'))
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${stylesheet ? '<link rel="stylesheet" href="/fixture.css">' : ''}<title>独立聊天 · 离线验证</title></head><body><div id="root"></div><script>window.__independentChatNative=${JSON.stringify(native)}</script><script src="/fixture.js"></script></body></html>`
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/bot-product' && handleApi) { try { await handleApi(request, response) } catch (error) { response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: false, error: { code: error.code ?? 'FIXTURE_ERROR', message: error.message } })) }; return }
    if (request.url === '/' && request.method === 'GET') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(native ? { 'set-cookie': 'independent-fixture-owner=isolated; Path=/; SameSite=Strict' } : {}) }); response.end(html) }
    else if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' }); response.end(javascript.contents) }
    else if (request.url === '/fixture.css' && stylesheet) { response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }); response.end(stylesheet.contents) }
    else { response.writeHead(404); response.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}/`, rendererInputs: Object.keys(bundle.metafile.inputs).filter(path => /dsh-client-ui-primitives|katex|shiki/.test(path)), close: () => new Promise(resolve => server.close(resolve)) }
}

export async function verifyIndependentChatBrowser({ outputDir = resolve(root, 'tmp/integration/independent-chat-ui') } = {}) {
  const output = resolve(outputDir); await mkdir(output, { recursive: true })
  const fixture = await serveIndependentChatFixture(), browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } }), errors = [], checks = [], images = []
  page.on('pageerror', error => errors.push(error.message))
  const capture = async name => { const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: false, animations: 'disabled' }); images.push(path) }
  const input = () => page.getByLabel('发消息给', { exact: false })
  const ready = async () => { await input().waitFor(); await page.waitForFunction(() => document.querySelector('.ic-composer textarea')?.disabled === false) }
  try {
    await page.goto(fixture.url); await ready(); await page.locator('[data-message-id]').first().waitFor()
    for (const width of [1360, 375]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(theme => { document.body.dataset.bpAppearance = theme }, theme)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await page.locator('.ic-composer').evaluate(node => { const box = node.getBoundingClientRect(); return box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth }), true)
      await capture(`chat-${width}-${theme}`)
      checks.push(`${width}px ${theme}: real React contacts, transcript and composer fit without horizontal overflow`)
    }
    await input().fill('输入法确认文字')
    await input().evaluate(node => { node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true })); node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) })
    assert.equal(await page.evaluate(() => window.__independentChatFixture.calls.filter(call => call.action === 'independentChat.send').length), 0)
    await input().press('Shift+Enter'); assert.match(await input().inputValue(), /\n/)
    checks.push('IME candidate confirmation and Shift+Enter do not send')
    await input().fill('把这项工作整理成三个步骤')
    await page.evaluate(() => { const button = document.querySelector('button[aria-label="发送消息"]'); button.click(); button.click() })
    await page.waitForFunction(() => document.querySelector('.ic-request')?.textContent.includes('消息已保存') || document.querySelector('.ic-request')?.textContent.includes('正在处理'))
    assert.equal(await input().inputValue(), '')
    assert.equal(await page.evaluate(() => window.__independentChatFixture.calls.filter(call => call.action === 'independentChat.send').length), 1)
    await page.locator('.ic-bubble').filter({ hasText: '已经核对完了。我们可以从最重要的一步开始，逐项整理。' }).first().waitFor()
    checks.push('double click produces one durable intent; acceptance clears its draft and the full answer appears from transcript polling')
    await page.evaluate(() => { window.__independentChatFixture.mode = 'hold' }); await input().fill('请运行这项长任务'); await input().press('Enter')
    await page.getByRole('button', { name: '请求停止', exact: true }).waitFor()
    await page.getByRole('article', { name: '正在生成的回复' }).waitFor()
    assert.match(await page.locator('.ic-streaming-text').textContent(), /尚未完成的回复/)
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => (localStorage.getItem(key) ?? '').includes('这是一段尚未完成的回复'))), false)
    await capture('chat-streaming-phone-dark')
    await page.reload(); await ready()
    await page.getByRole('article', { name: '正在生成的回复' }).waitFor()
    assert.equal(await page.evaluate(() => window.__independentChatFixture.calls.some(call => call.action === 'independentChat.send')), false)
    checks.push('live text is visibly unfinished, excluded from browser drafts, and restored only by inspecting the Host request after reload without resend')
    await page.locator('.ic-transcript').evaluate(node => { node.scrollTop = 0 })
    await page.getByRole('button', { name: '回到最新' }).waitFor()
    await page.setViewportSize({ width: 600, height: 812 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.ok(await page.locator('.ic-transcript').evaluate(node => node.scrollTop < 10), 'reading older content must not jump on resize')
    await page.getByRole('button', { name: '回到最新' }).click()
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForFunction(() => { const node = document.querySelector('.ic-transcript'); return node.scrollHeight - node.scrollTop - node.clientHeight < 90 })
    checks.push('window resize follows live content only while following; scrolling back preserves the reading position')
    const stop = page.getByRole('button', { name: '请求停止', exact: true })
    assert.equal(await stop.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return node === hit || node.contains(hit) }), true)
    await stop.click(); await page.getByText('已请求停止，正在核对回合结果；工具停止尚未确认。', { exact: true }).waitFor()
    assert.equal(await page.locator('.ic-streaming').count(), 0)
    assert.equal(await page.getByText('已停止', { exact: true }).count(), 0)
    await capture('chat-cancel-requested-phone-dark')
    await page.evaluate(() => window.__independentChatFixture.complete()); await page.getByText('回复已提交；之前已请求停止。', { exact: true }).waitFor()
    checks.push('the visible stop control requests cancellation without claiming stop; a late committed answer retains cancelRequested')
    await page.evaluate(() => { window.__independentChatFixture.mode = 'unknown' }); await input().fill('保留这段恢复文字'); await input().press('Enter')
    await page.getByRole('button', { name: '恢复文字到输入框' }).waitFor()
    const key = await page.locator('.ic-request>small').first().textContent()
    await page.reload(); await ready(); await page.getByRole('button', { name: '恢复文字到输入框' }).waitFor()
    assert.equal(await page.locator('.ic-request>small').first().textContent(), key)
    assert.equal(await page.evaluate(() => window.__independentChatFixture.calls.some(call => call.action === 'independentChat.send')), false)
    await capture('chat-unknown-reload-phone')
    await page.getByRole('button', { name: '恢复文字到输入框' }).click(); assert.equal(await input().inputValue(), '保留这段恢复文字')
    assert.equal(await page.evaluate(() => window.__independentChatFixture.calls.some(call => call.action === 'independentChat.send')), false)
    checks.push('reload retains the uncertain request key and only inspects; explicit recovery fills text without sending or replaying tools')
    await page.evaluate(() => { const f = window.__independentChatFixture; f.delay = 'a'; f.delayBot = 'a'; f.release = null })
    await page.waitForFunction(() => typeof window.__independentChatFixture.release === 'function')
    await page.getByRole('button', { name: '写作伙伴' }).click(); await ready()
    await page.evaluate(() => { const f = window.__independentChatFixture; f.delay = null; f.release() })
    assert.equal(await page.locator('.ic-heading strong').textContent(), '写作伙伴')
    assert.equal(await page.locator('[data-message-id^="a-a-"]').count(), 0)
    checks.push('a delayed Bot read is retired on contact change and cannot replace the new Bot transcript')
    await page.getByRole('button', { name: '研究伙伴' }).click(); await ready()
    await page.evaluate(() => { const f = window.__independentChatFixture; f.delay = 'a'; f.delayBot = 'a'; f.release = null })
    await page.waitForFunction(() => typeof window.__independentChatFixture.release === 'function')
    await page.evaluate(() => window.__independentChatFixture.setHost('b')); await ready()
    await page.evaluate(() => { const f = window.__independentChatFixture; f.delay = null; f.release() })
    assert.equal(await page.locator('.ic-heading strong').textContent(), '另一宿主伙伴')
    assert.equal(await page.locator('[data-message-id^="a-a-"]').count(), 0)
    await page.evaluate(() => window.__independentChatFixture.setHost('a')); await ready()
    checks.push('a delayed old Host response cannot restore its transcript or controls after the Host API changes')
    await input().fill('研究伙伴的草稿'); await page.getByRole('button', { name: '写作伙伴' }).click(); await ready(); assert.equal(await input().inputValue(), '')
    await input().fill('写作伙伴的草稿'); await page.getByRole('button', { name: '研究伙伴' }).click(); await ready(); assert.equal(await input().inputValue(), '研究伙伴的草稿')
    await page.evaluate(() => { window.__independentChatFixture.setHost('b') }); await ready(); await page.getByText('另一宿主伙伴', { exact: true }).first().waitFor(); assert.equal(await input().inputValue(), '')
    await input().fill('第二宿主草稿'); await page.evaluate(() => { window.__independentChatFixture.setHost('a') }); await ready(); assert.equal(await input().inputValue(), '研究伙伴的草稿')
    checks.push('Bot and validated Host namespace changes retire the old controller and isolate unsent drafts')
    await page.getByRole('button', { name: '加载较早消息', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('[data-message-id]').length >= 54)
    await page.locator('.ic-transcript').evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')) }); await page.getByRole('button', { name: '回到最新' }).click()
    await page.getByRole('button', { name: '打开此 Bot 的原生会话' }).click()
    assert.deepEqual(await page.evaluate(() => window.__independentChatFixture.nativeSessions), ['a-real-session-a'])
    checks.push('stable cursor pagination opens full messages, scroll-to-latest stays clickable, and native navigation uses the actual Host Session')
    await page.evaluate(() => { window.__independentChatFixture.setSurface('native') }); await page.getByRole('button', { name: '打开独立聊天' }).waitFor(); await page.getByRole('button', { name: '打开独立聊天' }).click(); await ready()
    assert.equal(await page.evaluate(() => window.__independentChatFixture.panels.includes('bot-product-independentChat')), true)
    checks.push('the native conversation handoff opens the real independent panel')
    await page.getByRole('button', { name: 'Bot 设置', exact: true }).click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Bot 设置', exact: true }).evaluate(node => node === document.activeElement), true)
    checks.push('the chat uses the existing Bot settings dialog and Escape restores the header focus')
    await page.getByRole('button', { name: '宿主已保存模型：fixture/research-model，打开模型与工具设置', exact: true }).click()
    await page.getByRole('button', { name: '保存绑定', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.bb-feedback[data-kind="saved"]'))
    assert.equal(await page.locator('.ic-shell').count(), 1)
    await page.getByRole('button', { name: '安装与登录', exact: true }).click()
    await page.waitForFunction(() => window.__independentChatFixture.panels.includes('model-router-galgame'))
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.locator('.ic-heading strong').textContent(), '研究伙伴')
    checks.push('the saved Host model ref opens existing settings; save keeps the chat, and official tools uses the existing workbench destination')
    assert.deepEqual(errors, [])
    const report = { status: 'passed', checks, images, pageErrors: errors, limitation: 'Real React components, synthetic owner API. Separate native owner/SQLite/SDK chain is required.' }
    await writeFile(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); return report
  } finally { await browser.close(); await fixture.close() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyIndependentChatBrowser()
