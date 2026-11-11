import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'tmp/integration/model-picker-browser'); await mkdir(output, { recursive: true })
const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/fixtures/model-picker-preview.jsx'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'text' } })
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const server = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html;charset=utf-8'); res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].contents : html) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1100, height: 850 } }), errors = [], checks = [], images = []
page.on('pageerror', error => errors.push(error.message)); page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
const capture = async name => { const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); images.push(path) }
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('.bp-model-picker-trigger').click(); await page.getByRole('dialog').waitFor()
  assert.equal(await page.getByLabel('搜索可用模型').evaluate(node => document.activeElement === node), true)
  await capture('model-picker-wide')
  await page.locator('[data-provider="Anthropic"]').click()
  assert.equal(await page.evaluate(() => window.__pickerFixture.value), 'OpenAI/fixture-reasoning')
  await page.locator('[data-model-choice="Anthropic/fixture-writing"]').click()
  assert.equal(await page.evaluate(() => window.__pickerFixture.value), 'Anthropic/fixture-writing')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.locator('.bp-model-picker-trigger').evaluate(node => document.activeElement === node), true)
  checks.push('provider browsing leaves the exact selection untouched; picking a model changes only the draft and restores focus')
  await page.locator('.bp-model-picker-trigger').click(); await page.locator('[data-provider=""]').count()
  await page.getByRole('button', { name: '全部提供商', exact: true }).click()
  await page.getByLabel('搜索可用模型').fill('快速')
  assert.equal(await page.locator('[data-model-choice]').count(), 1)
  await page.getByLabel('搜索可用模型').press('ArrowDown'); await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.__pickerFixture.value), 'OpenAI/fixture-fast')
  checks.push('Chinese search and keyboard selection use the actual offered model list')
  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'dark'))
  await page.locator('.bp-model-picker-trigger').click(); await capture('model-picker-dark')
  await page.setViewportSize({ width: 375, height: 800 })
  await page.waitForFunction(() => { const rect = document.querySelector('[role="dialog"]').getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await capture('model-picker-phone'); await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  checks.push('dark and 375px portal layouts stay within the viewport, and Escape restores the previous control')
  assert.deepEqual(errors, [])
  const report = { status: 'passed', checks, images, pageErrors: errors, limitation: 'Actual compact model picker with synthetic catalog; no Host account or model invocation.' }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
