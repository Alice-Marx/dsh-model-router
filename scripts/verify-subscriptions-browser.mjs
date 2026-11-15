// Actual Harness + actual pinned CLIProxyAPI, in a fresh isolated home.
// Generates and cancels real PKCE authorization; never opens a vendor login or authenticates an account.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
const root = resolve(import.meta.dirname, '..'), base = join(root, 'tmp/integration/actual-harness-ui')
const current = JSON.parse(await readFile(join(base, 'current.json'), 'utf8'))
const { run, home, source, packageVersion, harnessVersion } = current
const connection = JSON.parse(await readFile(join(run, 'connection.private.json'), 'utf8'))
assert.equal(new URL(connection.origin).hostname, '127.0.0.1')
const output = join(base, 'subscriptions-verified'); await mkdir(output, { recursive: true })
const expected = await readFile(join(source, '.dsh-plugin/client.js')), hash = value => createHash('sha256').update(value).digest('hex')
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
const images = [], errors = [], served = [], checks = []
page.on('pageerror', error => errors.push(error.message.replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]')))
page.on('response', async response => {
  if (response.status() !== 200 || !/javascript/.test(response.headers()['content-type'] ?? '')) return
  try { const body = await response.body(), at = body.indexOf(expected); if (at >= 0) served.push(hash(body.subarray(at, at + expected.length))) } catch {}
})
const capture = async name => { const file = join(output, name + '.png'); await page.screenshot({ path: file, animations: 'disabled' }); images.push(file) }
const openAccounts = async () => {
  await page.locator('.bp-workspace-shortcuts').first().getByRole('button', { name: 'AI 提供方', exact: true }).click()
  await page.getByRole('button', { name: '订阅账户', exact: true }).click()
  await page.getByText('登录套餐账户', { exact: true }).waitFor()
}
const noOverflow = async () => {
  await page.waitForFunction(() => {
    const node = document.querySelector('.bp-subscriptions'), sidebar = document.querySelector('.bt-leftcol:not([data-leaving])')
    if (!node) return false
    const box = node.getBoundingClientRect(), left = innerWidth < 650 && sidebar ? Math.min(88, sidebar.getBoundingClientRect().right) : 0
    return document.documentElement.scrollWidth <= innerWidth && box.left >= left - 1 && box.right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1
  }, undefined, { timeout: 5000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(await page.locator('.bp-subscriptions').evaluate(node => node.scrollWidth > node.clientWidth + 1), false)
}
const dismiss = async () => {
  const beta = page.getByText('预览版说明', { exact: true }); await beta.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {})
  if (await beta.isVisible()) await page.getByRole('button', { name: '继续', exact: true }).click()
  const welcome = page.getByText('开始使用', { exact: true }); await welcome.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {})
  if (await welcome.isVisible()) { await page.keyboard.press('Escape'); await welcome.waitFor({ state: 'hidden' }) }
}
try {
  await page.goto(connection.ownerUrl)
  await page.locator('.bp-workspace-shortcuts').waitFor({ state: 'attached', timeout: 30_000 }); await dismiss()
  await openAccounts(); await noOverflow(); await capture('subscriptions-before-start')
  await page.getByRole('button', { name: '启动登录服务', exact: true }).click()
  await page.getByText('登录服务已就绪', { exact: true }).waitFor({ timeout: 45_000 })
  assert.equal(await page.locator('[data-subscription-account]').count(), 0)
  assert.equal(await page.locator('.bp-sub-providers button:enabled').count(), 8)
  await noOverflow(); await capture('subscriptions-light')
  checks.push('the real owner action starts a hash-pinned local CLIProxyAPI service; no account or model is invented before login')
  await page.getByRole('button', { name: /ChatGPT \/ Codex/ }).click()
  await page.getByRole('region', { name: '账户授权', exact: true }).waitFor({ timeout: 50_000 })
  const authorizationUrl = await page.getByRole('link', { name: '打开授权页面', exact: true }).getAttribute('href')
  const auth = new URL(authorizationUrl)
  assert.equal(auth.hostname, 'auth.openai.com'); assert.equal(auth.protocol, 'https:'); assert.ok(auth.searchParams.get('state')); assert.ok(auth.searchParams.get('code_challenge'))
  await capture('subscriptions-authorization')
  await page.getByText('授权后无法自动返回？', { exact: true }).click()
  await page.getByLabel('授权回调地址', { exact: true }).fill('http://localhost:1455/auth/callback?code=offline-invalid-code&state=wrong-session')
  await page.getByRole('button', { name: '提交授权结果', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '请粘贴本次授权返回的完整地址，包含 code 和 state。' }).waitFor()
  assert.equal(await page.getByLabel('授权回调地址', { exact: true }).inputValue(), '')
  checks.push('manual callback rejects a mismatched OAuth state locally and clears the pasted one-time code')
  await page.reload(); await page.locator('.bp-workspace-shortcuts').waitFor({ state: 'attached' }); await dismiss(); await openAccounts()
  await page.getByRole('region', { name: '账户授权', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: '打开授权页面', exact: true }).getAttribute('href'), authorizationUrl)
  await page.getByRole('button', { name: '取消登录', exact: true }).click()
  await page.getByRole('region', { name: '账户授权', exact: true }).waitFor({ state: 'hidden' })
  checks.push('the actual upstream produces a PKCE authorization URL, a browser reload resumes its Host-owned session, and Cancel reaches the real management endpoint')
  const appearance = page.locator('.bp-appearance').first()
  await appearance.locator('summary').click(); await appearance.getByRole('button', { name: '深色', exact: true }).click(); await appearance.locator('summary').click()
  await noOverflow(); await capture('subscriptions-dark')
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(); await capture('subscriptions-phone')
  checks.push('the actual product page fits light, dark and a 390px viewport')
  const local = JSON.parse(await readFile(join(home, 'model-router/subscription-proxy/private.json'), 'utf8'))
  const html = await page.content()
  assert.ok(!html.includes(local.apiKey) && !html.includes(local.managementKey))
  assert.equal((await readdir(join(home, 'model-router/subscription-proxy/accounts'))).filter(name => name.endsWith('.json')).length, 0)
  await page.locator('.bp-sub-options summary').click()
  await page.getByRole('button', { name: '停止登录服务', exact: true }).click()
  await page.getByText('尚未启用', { exact: true }).waitFor()
  assert.equal(await page.locator('.bp-sub-providers button:enabled').count(), 0)
  checks.push('management and client secrets stay outside the rendered page; Stop disables new account actions and no real subscription was authenticated')
  assert.ok(served.includes(hash(expected)), 'the Host must serve the exact client bundled for this release')
  assert.deepEqual(errors, [])
  const report = { status: 'passed', packageVersion, harnessVersion, actualHarnessRuntime: true, actualCliProxyRuntime: true, cliProxyVersion: '8.0.72',
    apiMocks: false, syntheticUiShell: false, isolatedUserHome: true, liveUserProfileModified: false, nativeDesktopWindowVerified: false,
    realSubscriptionAuthenticated: false, paidModelCalls: 0, authorizationUrlGenerated: true, authorizationCancelled: true,
    client: { bytes: expected.length, sha256: hash(expected), exactServedBytes: true }, checks, images, pageErrors: errors }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report))
} catch (error) { await capture('failure'); throw error }
finally { await browser.close() }
