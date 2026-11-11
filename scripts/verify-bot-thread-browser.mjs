import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// The thread surface in a real browser: the bundled panel and chat-title addon,
// both themes, 375px, every state, and a Host that answers late or not at all.
// No live profile, model, Bot or desktop: every answer comes from the fixture.
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'tmp/integration/bot-threads-browser')
await mkdir(output, { recursive: true })
const bundle = await build({
  absWorkingDir: root, entryPoints: ['tests/fixtures/bot-threads-preview.jsx'], bundle: true, write: false,
  platform: 'browser', format: 'iife', loader: { '.css': 'text' }, logLevel: 'silent',
})
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const server = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html;charset=utf-8'); res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].contents : html) })
await new Promise(done => server.listen(0, '127.0.0.1', done))
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [], checks = [], images = []
page.on('pageerror', error => errors.push(error.message)); page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
const capture = async name => { const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); images.push(path) }
const dispatched = action => page.evaluate(name => window.__threadFixture.calls.some(call => call.action === name), action)
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('.bp-thread').first().waitFor()
  assert.equal(await page.locator('.bp-thread').count(), 3)
  assert.equal(await page.locator('.bp-thread.is-active').getAttribute('data-thread'), 't-1')
  assert.equal(await page.locator('.bp-threads-head-name').textContent(), '排查线索甲')
  assert.equal(await page.locator('.bp-threads-count').textContent(), '2 进行中 · 1 归档')
  await capture('threads-wide')
  checks.push('the panel renders the store-verified threads, active first, and the header control names the active one')

  await page.locator('.bp-thread[data-thread="t-2"] .bp-thread-open').click()
  assert.deepEqual(await page.evaluate(() => window.__threadFixture.openedSessions.slice()), ['sess-2'], 'only the Session the Host confirmed is navigated to')
  await capture('threads-switched')
  checks.push('opening a thread asks the Host for its real Session and only then navigates')

  // The header control: the Bot it belongs to and the thread that is open, the
  // same Bot's other threads one click away, and a create that is the same owner
  // act — never a model, memory, computer or task control of its own.
  await page.locator('.bp-threads-head').first().click()
  assert.match(await page.locator('.bp-threads-head').first().getAttribute('aria-label') ?? '', /当前线程 排查线索乙（甲 Bot）/)
  assert.equal(await page.locator('.bp-threads-menu-row.is-active .bp-threads-menu-name').textContent(), '排查线索乙')
  assert.match(await page.locator('.bp-threads-menu-row[data-state="default"] .bp-threads-menu-name').textContent(), /默认聊天/, 'the Bot default chat is listed so a thread can be left again')
  await page.locator('.bp-threads-menu-row[data-state="archived"]').click()
  assert.equal((await page.evaluate(() => window.__threadFixture.openedSessions)).at(-1), 'sess-3', 'an archived thread opens the history it kept, read-only')
  assert.equal(await page.locator('.bp-conversation-tools').count(), 0, 'the header control is not a second toolbar')
  await capture('threads-header-switch')
  checks.push('the header control names the Bot and its thread and switches through a confirmed Session')
  await page.locator('.bp-threads-input').fill('新的排查线索')
  await page.locator('.bp-threads-button').first().click()
  const created = await page.evaluate(() => window.__threadFixture.calls.find(call => call.action === 'threads.create'))
  assert.equal(created.payload.name, '新的排查线索')
  assert.match(created.payload.requestKey, /^panel-bot-a-\d+$/)
  await page.locator('.bp-thread[data-thread="t-3"] [aria-label="恢复线程"]').click()
  assert.ok(await dispatched('threads.unarchive'))
  await capture('threads-created')
  checks.push('create carries a requestKey and archive/unarchive are one Host action each')

  // The late Host: the same threads, but the Host no longer confirms the open
  // thread's Session. The panel keeps the rows and says so instead of
  // pretending it can send.
  await page.locator('.bp-thread[data-thread="t-2"] .bp-thread-open').click()
  await page.evaluate(() => window.__threadFixture.lateHost())
  await page.waitForFunction(() => document.querySelector('.bp-thread[data-thread="t-2"] .bp-thread-badge.is-wait'), undefined, { timeout: 9000 })
  await page.waitForFunction(() => document.body.textContent.includes('尚未得到宿主归属确认'), undefined, { timeout: 9000 })
  await capture('threads-late-host')
  checks.push('a late Host answer that withdraws the open thread Session shows the pending state without inventing a send')

  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'dark'))
  await capture('threads-dark')
  await page.setViewportSize({ width: 375, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await capture('threads-phone')
  checks.push('both themes render from body attributes and the 375px layout has no page overflow')

  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'light'))
  await page.setViewportSize({ width: 1280, height: 900 })
  // An un-wired Host: the integration note, no thread control, nothing dispatched.
  const before = await page.evaluate(() => window.__threadFixture.calls.length)
  await page.evaluate(() => window.__threadFixture.setAvailable(false))
  await page.waitForFunction(() => document.body.textContent.includes('暂不支持线程目录'))
  assert.equal(await page.locator('.bp-threads-button').count(), 0)
  assert.equal(await page.evaluate(() => window.__threadFixture.calls.length), before)
  await capture('threads-unavailable')
  checks.push('an un-wired Host shows the integration note and offers no thread control')

  // No execution control is ever rendered, in any state.
  assert.equal(await page.locator('button').filter({ hasText: /取消|停止|重试|审批|发送/ }).count(), 0)
  assert.deepEqual(errors, [])
  const report = { status: 'passed', checks, images, pageErrors: errors, limitation: 'Actual product components with isolated synthetic Host responses; no live profile, model, Bot or desktop.' }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
} finally { await browser.close(); await new Promise(done => server.close(done)) }
