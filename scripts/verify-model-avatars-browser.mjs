// Exercises the real plugin in an isolated, installed Harness. Start it with
// scripts/start-harness-ui-check.mjs; no shell, RPC or model response is mocked.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { MODEL_AVATARS } from '../modules/bot-runtime/vendor/ds-bot/src/client/model-avatar-catalog.js'

const root = resolve(import.meta.dirname, '..'), base = join(root, 'tmp/integration/actual-harness-ui')
const { run, home, source, harnessVersion, packageVersion } = JSON.parse(await readFile(join(base, 'current.json'), 'utf8'))
const connection = JSON.parse(await readFile(join(run, 'connection.private.json'), 'utf8'))
assert.equal(new URL(connection.origin).hostname, '127.0.0.1')
const output = join(base, 'model-avatars-verified'); await mkdir(output, { recursive: true })
const expectedClient = await readFile(join(source, '.dsh-plugin/client.js'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
const errors = [], images = [], served = [], checks = []
page.on('pageerror', cause => errors.push(cause.message.replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]')))
page.on('response', async response => {
  if (response.status() !== 200 || !/javascript/.test(response.headers()['content-type'] ?? '')) return
  try { const bytes = await response.body(), offset = bytes.indexOf(expectedClient)
    if (offset >= 0) served.push(hash(bytes.subarray(offset, offset + expectedClient.length)))
  } catch { /* navigations may cancel unrelated responses */ }
})
const capture = async name => { const file = join(output, name + '.png'); await page.screenshot({ path: file, animations: 'disabled' }); images.push(file) }
const noOverflow = async () => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const box = await page.locator('.bt-avedit').boundingBox(), width = page.viewportSize().width
  assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'avatar popover must remain within the viewport')
  assert.equal(await page.locator('.bt-model-avatars').evaluate(node => node.scrollWidth > node.clientWidth + 1), false)
}
const openSettings = async () => {
  if (await page.locator('.bt-avatar-trigger').isVisible()) return
  const edit = page.getByRole('button', { name: '编辑 Bot', exact: true })
  if (!await edit.isVisible()) await page.getByRole('button', { name: '查看对话详情', exact: true }).click()
  await edit.click(); await page.locator('.bt-avatar-trigger').waitFor()
}
const openEditor = async () => {
  await openSettings()
  if (!await page.locator('.bt-avedit').isVisible()) await page.locator('.bt-avatar-trigger').click()
}
const dismissWelcome = async () => {
  const welcome = page.getByText('开始使用', { exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await welcome.isVisible()) { await page.keyboard.press('Escape'); await welcome.waitFor({ state: 'hidden' }) }
}
const choose = async id => {
  const entry = MODEL_AVATARS.find(item => item.id === id)
  await page.locator(`[data-model-avatar="${id}"]`).click()
  await page.waitForFunction(image => document.querySelector('.bt-avatar-trigger img')?.getAttribute('src') === image, entry.image)
  assert.equal(await page.locator(`[data-model-avatar="${id}"]`).getAttribute('aria-pressed'), 'true')
  // Read committed Host bytes, not just the optimistic browser projection.
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = JSON.parse(await readFile(join(home, 'bot/state.json'), 'utf8'))
    const bots = Array.isArray(state.bots) ? state.bots : Object.values(state.bots ?? {})
    if (bots.some(bot => bot.avatar?.image === entry.image)) return entry
    await new Promise(yes => setTimeout(yes, 100))
  }
  throw new Error(`Host did not persist the ${id} avatar`)
}

try {
  await page.goto(connection.ownerUrl)
  await page.locator('.bp-workspace-shortcuts').waitFor({ state: 'attached', timeout: 30000 })
  const beta = page.getByText('预览版说明', { exact: true })
  await beta.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})
  if (await beta.isVisible()) await page.getByRole('button', { name: '继续', exact: true }).click()
  await dismissWelcome()
  await openEditor()
  await page.getByRole('tab', { name: '模型角色', exact: true }).click()
  assert.equal(await page.locator('.bt-model-avatar').count(), 19)
  await page.waitForFunction(() => [...document.querySelectorAll('.bt-model-avatar img')].every(image => image.complete && image.naturalWidth === 256 && image.naturalHeight === 256))
  await choose('deepseek'); await noOverflow(); await capture('avatars-light')
  await choose('rwkv')
  checks.push('all 19 embedded WebP images decode at 256×256; the first and last rows select real Host-persisted avatars')
  await page.keyboard.press('Escape'); await openEditor()
  assert.equal(await page.getByRole('tab', { name: '模型角色', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator('[data-model-avatar="rwkv"]').getAttribute('aria-pressed'), 'true')
  await page.getByRole('tab', { name: '上传', exact: true }).click()
  assert.equal(await page.locator('.bt-dropzone img').getAttribute('src'), MODEL_AVATARS.find(item => item.id === 'rwkv').image)
  await page.getByRole('tab', { name: '头像库', exact: true }).click(); await page.locator('.bt-lib').waitFor()
  await page.getByRole('tab', { name: 'Bot', exact: true }).click(); await page.locator('.bt-shape').first().click()
  await page.waitForFunction(() => !document.querySelector('.bt-avatar-trigger img'))
  await page.getByRole('tab', { name: '模型角色', exact: true }).click(); await choose('deepseek')
  await page.locator('.bt-avedit-reset').click(); await page.waitForFunction(() => !document.querySelector('.bt-avatar-trigger img'))
  await choose('deepseek')
  checks.push('saved presets reopen on Personas; upload/library/shape tabs and reset retain their existing behavior')
  await page.reload(); await page.locator('.bp-workspace-shortcuts').waitFor({ state: 'attached' })
  await dismissWelcome()
  await openEditor()
  assert.equal(await page.getByRole('tab', { name: '模型角色', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator('[data-model-avatar="deepseek"]').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.bt-tile img').first().getAttribute('src'), MODEL_AVATARS.find(item => item.id === 'deepseek').image)
  checks.push('a complete browser reload reads the committed portrait in the sidebar, editor and selection ring')
  await page.keyboard.press('Escape')
  const appearance = page.locator('.bp-appearance').first()
  await appearance.locator('summary').click(); await appearance.getByRole('button', { name: '深色', exact: true }).click(); await appearance.locator('summary').click()
  await openEditor(); await noOverflow(); await capture('avatars-dark')
  // Harness collapses the conversation details column on phones. Use the real
  // full-screen Bot settings entry that remains available from the account menu.
  await page.setViewportSize({ width: 390, height: 844 }); await page.keyboard.press('Escape')
  await page.locator('.bt-account:visible').last().click()
  await page.getByRole('menuitem', { name: 'Bot 设置', exact: true }).click()
  await page.locator('.bt-settings-nav').getByRole('button', { name: 'Bot', exact: true }).click()
  await page.locator('.bt-settings .bt-set-row:has(.bt-row-title)').first().click()
  await page.locator('.bt-settings .bt-avatar-trigger').click()
  assert.equal(await page.getByRole('tab', { name: '模型角色', exact: true }).getAttribute('aria-selected'), 'true')
  await noOverflow(); await capture('avatars-phone')
  checks.push('the actual desktop details picker fits light/dark; the actual full-screen Bot settings picker fits a 390px phone viewport')
  assert.ok(served.includes(hash(expectedClient)), 'the real Host must serve the exact generated client bytes')
  assert.deepEqual(errors, [])
  const report = { status: 'passed', buildLabel: 'local model-avatar verification build', packageVersion, actualHarnessRuntime: true, harnessVersion,
    apiMocks: false, syntheticUiShell: false, isolatedUserHome: true, nativeDesktopWindowVerified: false, paidModelCalls: 0,
    avatars: MODEL_AVATARS.length, client: { bytes: expectedClient.length, sha256: hash(expectedClient), exactServedBytes: true }, checks, images, pageErrors: errors }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report))
} catch (cause) {
  await capture('failure'); throw cause
} finally { await browser.close() }
