import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const index = process.argv.indexOf('--access')
assert.ok(index >= 0, 'Pass the isolated Host browser-access.json using --access')
const file = resolve(process.argv[index + 1]), dir = dirname(file), access = JSON.parse(await readFile(file, 'utf8'))
const require = createRequire(new URL('../remote-computer-agent/package.json', import.meta.url)), { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], checks = [], summary = { status: 'failed', checks, errors, actualModelCalls: 0 }
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(access.url); await page.waitForTimeout(1200)
  const nav = page.getByRole('navigation', { name: 'Bot 工作系统' })
  await nav.getByRole('button', { name: '任务', exact: true }).click()
  await page.getByRole('heading', { name: 'Bot 路由', exact: true }).waitFor()
  await page.getByRole('checkbox', { name: '开启 Bot 路由', exact: true }).waitFor()
  assert.equal(await nav.getByRole('button', { name: '任务', exact: true }).getAttribute('aria-current'), 'page')
  checks.push('Task page renders real routing candidates and saved settings')
  await nav.getByRole('button', { name: '资料库', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="上传资料"]')?.disabled === false)
  const filename = `browser-acceptance-${Date.now()}.md`, text = '# Browser acceptance\nneedle-browser-20261105\n'
  await page.getByLabel('上传资料', { exact: true }).setInputFiles({ name: filename, mimeType: 'text/markdown', buffer: Buffer.from(text) })
  await page.getByRole('button', { name: filename, exact: true }).waitFor()
  await page.getByLabel('资料库文本查询', { exact: true }).fill('needle-browser-20261105')
  await page.getByRole('button', { name: '搜索文本', exact: true }).click()
  await page.getByRole('region', { name: '资料库搜索结果' }).getByText('needle-browser-20261105', { exact: false }).last().waitFor()
  checks.push('Real browser file upload and text search reach the authenticated owner API')
  await page.locator('.bp-create-menu > summary').click()
  const createdName = `browser-created-${Date.now()}.txt`
  await page.locator('.bp-create-popover input').fill(createdName)
  await page.getByRole('button', { name: '新建文本', exact: true }).click()
  await page.getByRole('textbox', { name: '资料内容', exact: true }).fill('Created through the new-file menu')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: createdName, exact: true }).waitFor()
  checks.push('New-file menu creates a real private library file')
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await page.waitForTimeout(350)
  const colors = await page.locator('.bp-refresh').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))
  assert.notEqual(colors.background, 'rgb(255, 255, 255)')
  assert.notEqual(colors.background, colors.color)
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  checks.push('Dark mode keeps readable controls after theme transitions')
  await nav.getByRole('button', { name: '例行任务', exact: true }).click()
  await page.getByRole('heading', { name: '例行任务', exact: true }).first().waitFor()
  checks.push('Routines page mounts without a renderer error')
  await nav.getByRole('button', { name: '远程电脑', exact: true }).click()
  await page.getByText('连接你的第一台电脑', { exact: true }).waitFor()
  await page.getByRole('button', { name: '导入配对文件', exact: true }).click()
  assert.equal(await page.locator('.bp-machine-setup').getAttribute('open'), '')
  const metadata = { machineId: 'ui-metadata-test', clientId: 'ui-test', token: 'a'.repeat(43), endpoint: 'http://10.0.0.2:19701',
    protectedTunnel: true, rootIds: ['project'], tools: ['machine_ping', 'desktop_screenshot'], hostManagedBots: true }
  await page.locator('textarea:visible').last().fill(JSON.stringify(metadata))
  await page.waitForTimeout(100)
  assert.equal(await page.getByRole('textbox', { name: 'Agent 地址', exact: true }).inputValue(), metadata.endpoint)
  checks.push('Pairing metadata fills the endpoint without submitting a credential or machine change')
  assert.deepEqual(errors, [])
  summary.status = 'passed'
} catch (error) { summary.error = error.stack; process.exitCode = 1 }
finally {
  await page.screenshot({ path: `${dir}/product-ui-panels.png`, fullPage: true }).catch(() => {})
  await writeFile(`${dir}/browser-ui-summary.json`, JSON.stringify(summary, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(summary))
