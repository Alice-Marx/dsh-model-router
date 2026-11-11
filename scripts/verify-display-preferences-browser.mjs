import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { serveChatFixture } from './verify-chat-design-browser.mjs'

const output = resolve('tmp/integration/display-preferences')
await mkdir(output, { recursive: true })
const fixture = await serveChatFixture(), browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
const errors = [], requests = [], checks = [], images = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
page.on('request', request => requests.push(request.url()))
const summary = () => page.locator('.bp-contact-nav .bp-appearance > summary')
const menu = () => page.locator('.bp-contact-nav .bp-appearance-menu')
const open = async () => { if (!(await menu().isVisible())) await summary().click() }
const choose = async name => { await open(); await menu().getByRole('button', { name, exact: true }).click() }
const capture = async name => { const path = join(output, `${name}.png`); await page.screenshot({ path, animations: 'disabled' }); images.push(path) }
const colorContrast = async () => page.locator('.bt-ubody').first().evaluate(node => {
  const style = getComputedStyle(node)
  const luminance = color => {
    const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
  }
  const a = luminance(style.color), b = luminance(style.backgroundColor)
  return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), background: style.backgroundColor }
})
try {
  await page.goto(fixture.url)
  await page.waitForFunction(() => document.body.getAttribute('data-bp-chat-width') === 'standard')
  // The shell itself is not installed. This isolated layout probe uses the
  // pinned vendor's actual body/scrollBody token contract and loaded CSS; it
  // does not replace the product control with another implementation.
  await page.evaluate(() => {
    const body = document.createElement('div'), scroll = document.createElement('div'), column = document.createElement('div')
    body.className = '_body_display_probe'; body.style.cssText = 'position:absolute;left:-10000px;top:0;width:2000px;'
    scroll.className = '_scrollBody_display_probe'
    column.id = 'display-width-probe'; column.style.cssText = 'width:100%;max-width:var(--dsh-chat-content-width);height:1px;'
    scroll.append(column); body.append(scroll); document.body.append(body)
  })
  const width = () => page.locator('#display-width-probe').evaluate(node => node.getBoundingClientRect().width)
  assert.equal(await width(), 960)
  await choose('宽屏'); assert.equal(await width(), 1280)
  await choose('铺满'); assert.equal(await width(), 2000)
  await choose('标准'); assert.equal(await width(), 960)
  checks.push('actual appearance controls drive the pinned conversation width token: standard 960px, wide 1280px, full available width')

  const colored = await colorContrast()
  await choose('素色')
  const neutral = await colorContrast()
  assert.notEqual(neutral.background, colored.background); assert.ok(neutral.ratio >= 4.5)
  await capture('display-light')
  await choose('深色'); assert.ok((await colorContrast()).ratio >= 4.5)
  await choose('彩色'); assert.ok((await colorContrast()).ratio >= 4.5)
  await choose('素色'); await choose('宽屏')
  checks.push('colored and neutral user bubbles use the actual product palette; body text clears 4.5:1 in both appearances')

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh.bot.workspace.appearance.v1')))
  assert.deepEqual(stored, { appearance: 'dark', density: 'comfortable', chatWidth: 'wide', colorUserBubbles: false })
  assert.deepEqual(await page.evaluate(() => window.__chatSettingsFixture.calls), [])
  await page.reload()
  await page.waitForFunction(() => document.body.getAttribute('data-bp-chat-width') === 'wide' && document.body.getAttribute('data-bp-user-bubbles') === 'neutral')
  assert.equal(await page.locator('body').getAttribute('data-bp-appearance'), 'dark')
  checks.push('a real reload restores display preferences without any owner model/settings RPC or model call')

  await page.setViewportSize({ width: 375, height: 600 }); await open()
  const box = await menu().boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 375 && box.y >= 0 && box.y + box.height <= 600)
  await menu().getByRole('button', { name: '铺满', exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await capture('display-phone-dark')
  await choose('浅色'); assert.ok((await colorContrast()).ratio >= 4.5)
  await capture('display-phone-light')
  checks.push('the 375px display menu stays within the viewport, can scroll, and both appearances remain readable without page overflow')
  await page.keyboard.press('Escape')
  assert.equal(await menu().isVisible(), false)
  assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith(fixture.url)))
  const report = { status: 'passed', checks, images, pageErrors: errors,
    limitation: 'Actual product controls/CSS and reload on a synthetic conversation. Width uses the pinned shell token contract, not a live installed Host.' }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close(); await fixture.close() }
