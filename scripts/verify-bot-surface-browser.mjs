// Actual Harness + real skin-center / Wallpaper Engine packages. No UI shell,
// slot, network response or model reply is replaced with a fixture.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..'), base = join(root, 'tmp/integration/actual-harness-ui')
const current = JSON.parse(await readFile(join(base, 'current.json'), 'utf8'))
const { run, home, source, harnessVersion, packageVersion, classicVisuals, seedSkin } = current
assert.equal(classicVisuals?.length, 2, 'start with --visual-profile and --skin-directory')
assert.ok(seedSkin?.id)
const connection = JSON.parse(await readFile(join(run, 'connection.private.json'), 'utf8'))
assert.equal(new URL(connection.origin).hostname, '127.0.0.1')
const output = join(base, 'bot-surface-verified'); await mkdir(output, { recursive: true })
const expectedClient = await readFile(join(source, '.dsh-plugin/client.js'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const savedSkin = await readFile(join(home, 'skin-center-active.json'), 'utf8')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
const errors = [], images = [], served = [], checks = []
page.on('pageerror', cause => errors.push(cause.message.replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]')))
page.on('response', async response => {
  if (response.status() !== 200 || !/javascript/.test(response.headers()['content-type'] ?? '')) return
  try { const bytes = await response.body(), offset = bytes.indexOf(expectedClient)
    if (offset >= 0) served.push(hash(bytes.subarray(offset, offset + expectedClient.length)))
  } catch { /* navigation can cancel unrelated resources */ }
})
const capture = async name => { const file = join(output, name + '.png'); await page.screenshot({ path: file, animations: 'disabled' }); images.push(file) }
const dismissWelcome = async () => {
  const beta = page.getByText('预览版说明', { exact: true })
  await beta.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})
  if (await beta.isVisible()) await page.getByRole('button', { name: '继续', exact: true }).click()
  const welcome = page.getByText('开始使用', { exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await welcome.isVisible()) { await page.keyboard.press('Escape'); await welcome.waitFor({ state: 'hidden' }) }
}
const botReady = async () => {
  await page.locator('.bt-leftcol .bp-workspace-shortcuts').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForFunction(() => document.documentElement.dataset.dshBotSurface === 'bot' &&
    [...document.querySelectorAll('link[rel="stylesheet"][href*="/api/skin-center/v2/skins/"]')].every(node => node.media === 'not all'))
  assert.equal(await page.locator('.bt-return:visible').count(), 0)
  const paint = await page.evaluate(() => ({
    decorations: [...document.querySelectorAll('[data-dsh-skin-layer],#dsh-wallpaper-engine-rope-dock')].map(node => getComputedStyle(node).display),
    wallpaper: [...document.querySelectorAll('style[data-plugin="dsh-wallpaper-engine"]')].map(node => node.media),
    background: getComputedStyle(document.getElementById('root')).backgroundColor,
    overflow: document.documentElement.scrollWidth > innerWidth,
    mode: localStorage.getItem('ds-bot:surface'),
  }))
  assert.ok(paint.decorations.length >= 6)
  assert.ok(paint.decorations.every(value => value === 'none'))
  assert.ok(paint.wallpaper.length >= 1 && paint.wallpaper.every(value => value === 'not all'))
  assert.notEqual(paint.background, 'rgba(0, 0, 0, 0)')
  assert.equal(paint.overflow, false)
  assert.notEqual(paint.mode, 'agent')
}
const classic = async () => {
  await page.locator('.bt-account:visible').last().click()
  await page.getByRole('menuitem', { name: '切换经典 Agent 模式', exact: true }).click()
  await page.waitForFunction(() => localStorage.getItem('ds-bot:surface') === 'agent')
  const notice = page.getByRole('button', { name: '知道了', exact: true })
  if (await notice.isVisible()) await notice.click()
  if (page.viewportSize().width < 768 && !await page.locator('.bt-return').isVisible()) {
    await page.getByRole('button', { name: '打开侧边栏', exact: true }).first().click()
  }
  await page.locator('.bt-return').waitFor()
  assert.equal(await page.locator('.bt-leftcol').count(), 0)
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-bot-product-ui')), false)
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-bp-appearance')), false)
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"][href*="/api/skin-center/v2/skins/"],style[data-plugin="dsh-wallpaper-engine"]')].every(node => node.media !== 'not all')))
}

try {
  await page.goto(connection.ownerUrl)
  await page.locator('[data-dsh-skin-layer="background"] img').waitFor({ state: 'attached', timeout: 30000 })
  await botReady(); await dismissWelcome()
  await capture('bot-isolated-initial')
  checks.push('cold Bot startup hides real skin media, ornaments and Wallpaper Engine mascot/notice; their styles are suspended')
  await classic(); await capture('classic-restored')
  await page.locator('.bt-return').click(); await botReady()
  await capture('bot-after-return')
  checks.push('the actual DS Bot return button restores the Bot sidebar and conversation, with no classic visual layers')
  await page.getByRole('button', { name: '远程电脑', exact: true }).click()
  await page.locator('.bp-workspace-toolbar').waitFor()
  const appearance = page.locator('.bp-workspace-toolbar .bp-appearance')
  for (const [name, suffix] of [['浅色', 'light'], ['深色', 'dark']]) {
    await appearance.locator('summary').click(); await appearance.getByRole('button', { name, exact: true }).click(); await appearance.locator('summary').click()
    await botReady(); await capture('bot-isolated-' + suffix)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await botReady(); await capture('bot-isolated-phone')
  await classic(); await page.locator('.bt-return').click(); await botReady()
  checks.push('light/dark palettes and a 390px viewport retain the isolated Bot workspace through a full round trip')
  await page.setViewportSize({ width: 1280, height: 850 })
  await page.reload(); await botReady(); await dismissWelcome()
  await capture('bot-after-reload')
  await classic(); await page.reload(); await page.locator('.bt-return').waitFor(); await dismissWelcome()
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-bot-product-ui')), false)
  await page.locator('.bt-return').click(); await botReady()
  checks.push('reloads preserve each chosen mode and a subsequent Bot switch reapplies isolation')
  assert.equal(await readFile(join(home, 'skin-center-active.json'), 'utf8'), savedSkin, 'mode switching must not rewrite classic settings')
  assert.ok(served.includes(hash(expectedClient)))
  assert.deepEqual(errors, [])
  const report = { status: 'passed', packageVersion, harnessVersion, actualHarnessRuntime: true, classicVisuals, seedSkin,
    apiMocks: false, syntheticUiShell: false, isolatedUserHome: true, liveUserProfileModified: false,
    nativeDesktopWindowVerified: false, paidModelCalls: 0, savedClassicSettingsUnchanged: true,
    client: { bytes: expectedClient.length, sha256: hash(expectedClient), exactServedBytes: true }, checks, images, pageErrors: errors }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
} catch (cause) {
  await capture('failure'); await writeFile(join(output, 'failure.txt'), String(cause.stack)); throw cause
} finally { await browser.close() }
