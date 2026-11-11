import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')

export async function serveWorkspaceFixture() {
  const themeSource = await readFile(resolve(root,'modules/bot-runtime/vendor/ds-bot/src/client/themes.js'),'utf8')
  const themeBundle=await build({stdin:{contents:themeSource,resolveDir:resolve(root,'modules/bot-runtime/vendor/ds-bot/src/client'),loader:'js'},bundle:true,platform:'node',format:'esm',write:false})
  const {themeCss} = await import(`data:text/javascript;base64,${Buffer.from(themeBundle.outputFiles[0].contents).toString('base64')}`)
  const inheritedCss=themeCss({ light: { bg:'#fff',sidebar:'#eee',bubble:'#f0f0f0',card:'#fff',text:'#111',user:'#111',userText:'#fff',accent:'#4d6bfe' },dark:{bg:'#111',sidebar:'#222',bubble:'#333',card:'#222',text:'#eee',user:'#eee',userText:'#111',accent:'#5b7bff'} })
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/fixtures/workspace-preview.jsx'], bundle: true, write: false,
    format: 'iife', platform: 'browser', target: 'es2022', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' } })
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工作空间 · 本地离线验证</title></head><body><div id="root"></div><script>window.__fixtureInheritedCss=${JSON.stringify(inheritedCss).replace(/</g,'\\u003c')}</script><script src="/fixture.js"></script></body></html>`
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
    if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html) }
    else if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(bundle.outputFiles[0].contents) }
    else { response.writeHead(404); response.end() }
  })
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(yes => server.close(yes)) }
}

async function verify() {
  const fixture = await serveWorkspaceFixture(), screenshots = resolve(root, 'tmp/integration/workspace-browser')
  await mkdir(screenshots, { recursive: true })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
  const failures = [], checks = []
  page.on('pageerror', error => failures.push(error.message))
  const capture = async name => { const path = resolve(screenshots, `${name}.png`); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); return path }
  const images = []
  const themeContrast = async () => page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.cssText = 'background:var(--bt-bubble);color:var(--bt-ink);position:fixed;visibility:hidden'
    document.body.append(probe)
    const styles = getComputedStyle(probe)
    const luminance = color => {
      const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const ink = luminance(styles.color), background = luminance(styles.backgroundColor)
    const result = { appearance: document.body.getAttribute('data-bp-appearance'), ink: styles.color, background: styles.backgroundColor, contrast: (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) }
    probe.remove(); return result
  })
  const contrast = []
  try {
    await page.goto(fixture.url)
    await page.getByRole('heading', { name: '你想完成什么？' }).waitFor()
    contrast.push(await themeContrast()); assert.ok(contrast.at(-1).contrast >= 4.5)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    images.push(await capture('workspace-home-light'))
    await page.getByLabel('任务目标', { exact: true }).fill('在预览中准备一个项目检查目标')
    await page.getByRole('button', { name: '准备任务', exact: true }).click()
    await page.locator('.bp-task-composer textarea').waitFor()
    assert.equal(await page.locator('.bp-task-composer textarea').inputValue(), '在预览中准备一个项目检查目标')
    assert.equal(await page.evaluate(() => window.__workspaceFixture.calls.some(row => row.action === 'botRouting.dispatch')), false)
    checks.push('goal moves into the real preview composer without execution')
    await page.getByRole('button', { name: '看板', exact: true }).click()
    await page.locator('.bp-page').evaluate(element => { element.scrollTop = 0 })
    images.push(await capture('workspace-task-board'))
    assert.equal(await page.locator('.bp-board-card').count(), 6)
    assert.equal(await page.locator('[data-lane=attention] .bp-board-card').count(), 2)
    const boardPath = resolve(screenshots, 'workspace-board-detail.png')
    await page.locator('.bp-task-records').screenshot({ path: boardPath, animations: 'disabled' }); images.push(boardPath)
    checks.push('board groups six original tasks with two attention records')
    await page.getByRole('button', { name: '团队', exact: true }).click()
    await page.getByLabel('搜索团队成员').fill('清楚的表达')
    await page.locator('.bp-team-member').filter({ hasText: '写作伙伴' }).waitFor()
    assert.equal(await page.locator('.bp-team-member').count(), 1)
    await page.getByLabel('搜索团队成员').fill('')
    images.push(await capture('workspace-team'))
    checks.push('team search matches role text')
    await page.locator('.bp-model-picker-trigger').click()
    await page.getByRole('dialog', { name: '选择 Bot 模型' }).waitFor()
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForFunction(() => { const rect = document.querySelector('.bp-model-popover').getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    images.push(await capture('workspace-team-mobile-picker'))
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1360, height: 900 })
    checks.push('the actual Bot settings page and compact model popover fit 375px without horizontal overflow')
    await page.getByRole('button', { name: '搜索工作空间', exact: true }).last().click()
    await page.getByRole('combobox').fill('fixture-operation-original')
    await page.waitForFunction(() => document.querySelectorAll('.bp-palette [role=option]').length === 1)
    assert.equal(await page.locator('.bp-palette').getByRole('option').count(), 1)
    images.push(await capture('workspace-search'))
    await page.keyboard.press('Enter')
    await page.getByLabel('任务详情', { exact: true }).waitFor()
    await page.getByText('原任务与操作编号', { exact: true }).click()
    assert.match(await page.getByLabel('任务详情', { exact: true }).innerText(), /fixture-operation-original/)
    checks.push('search opens the exact original task and operation')
    await page.getByRole('button', { name: '总览', exact: true }).click()

    // The two sections wired after the display work: per-Bot threads and pinned
    // web pages. Both read the Host's own directory and must name what they
    // found rather than show an empty surface.
    await page.getByRole('button', { name: '线程', exact: true }).click()
    await page.locator('.bp-thread').first().waitFor()
    assert.equal(await page.locator('.bp-thread').count(), 2, 'the thread panel lists the threads the Host confirmed')
    assert.equal(await page.locator('.bp-thread.is-active').getAttribute('data-thread'), 't-1')
    images.push(await capture('workspace-threads'))
    checks.push('the thread section renders the Host-confirmed threads with the active one marked')

    await page.getByRole('button', { name: '网页面板', exact: true }).click()
    await page.locator('.bp-webpanel-pin').first().waitFor()
    assert.equal(await page.locator('.bp-webpanel-pin').count(), 2, 'the pinned pages the Host stored are listed')
    assert.match(await page.locator('.bp-webpanel-pin').first().innerText(), /本地仪表盘/)
    images.push(await capture('workspace-webpanels'))
    checks.push("the web panel section lists the owner's pinned pages from the Host directory")

    await page.getByRole('button', { name: '总览', exact: true }).click()
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await page.getByLabel('外观与显示', { exact: true }).click()
    assert.equal(await page.locator('body').getAttribute('data-bp-appearance'), 'dark')
    contrast.push(await themeContrast()); assert.ok(contrast.at(-1).contrast >= 4.5)
    images.push(await capture('workspace-home-dark'))
    await page.reload(); await page.getByRole('heading', { name: '你想完成什么？' }).waitFor()
    assert.equal(await page.locator('body').getAttribute('data-bp-appearance'), 'dark')
    checks.push('appearance survives a real browser reload')
    checks.push('conversation tokens retain AA contrast against a later-inserted DS Bot theme in light and dark modes')
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.getByRole('button', { name: '浅色', exact: true }).click()
    await page.getByLabel('外观与显示', { exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(await page.locator('.bp-page').evaluate(element => element.scrollWidth > element.clientWidth), false)
    images.push(await capture('workspace-home-mobile'))
    checks.push('390px home has no document or content overflow')
    assert.deepEqual(failures, [])
    const report = { status: 'passed', localFixture: true, checks, contrast, images, pageErrors: failures }
    await writeFile(resolve(screenshots, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    await capture('workspace-failure')
    await writeFile(resolve(screenshots, 'failure.json'), JSON.stringify({ message: error.message, pageErrors: failures }, null, 2))
    throw error
  } finally { await browser.close(); await fixture.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--serve')) {
    const fixture = await serveWorkspaceFixture(); console.log(JSON.stringify({ url: fixture.url, localFixture: true }))
    const close = async () => { await fixture.close(); process.exit(0) }
    process.on('SIGINT', close); process.on('SIGTERM', close)
  } else await verify()
}
