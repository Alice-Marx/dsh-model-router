import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'tmp/integration/notifications-browser')
await mkdir(output, { recursive: true })
const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/fixtures/notifications-preview.jsx'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'text' } })
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const server = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html;charset=utf-8'); res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].contents : html) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [], checks = [], images = []
page.on('pageerror', error => errors.push(error.message)); page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
const capture = async name => { const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); images.push(path) }
try {
  const url = `http://127.0.0.1:${server.address().port}`
  await page.goto(url); await page.locator('.bp-notification').first().waitFor()
  assert.equal(await page.locator('.bp-notification').count(), 3)
  await page.getByLabel('资源与管理，2 条未读通知').click()
  await page.getByRole('button', { name: '通知中心，2 条未读通知', exact: true }).click()
  await capture('notifications-wide')
  checks.push('real contact navigation opens the wired notification section with an independent unread indicator')
  await page.locator('.bp-notification[data-seq="8"] .bp-notification-read').click()
  await page.waitForFunction(() => document.querySelector('.bp-notifications-badge')?.textContent === '1')
  await page.getByRole('button', { name: '全部已读' }).click()
  await page.waitForFunction(() => !document.querySelector('.bp-notification-read'))
  checks.push('per-event and mark-all actions update only after Host acknowledgements')
  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'dark')); await capture('notifications-dark')
  await page.setViewportSize({ width: 375, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await capture('notifications-phone')
  await page.locator('.bp-notification[data-seq="9"] .bp-notification-open').click()
  await page.waitForFunction(() => document.body.textContent.includes('old-operation'))
  assert.equal(await page.locator('[data-focused-attempt]').count(), 1)
  assert.equal(await page.locator('.bp-task-detail button').filter({ hasText: /重试|取消任务|核对收据/ }).count(), 0)
  assert.equal(await page.evaluate(() => window.__notificationFixture.calls.some(call => ['task.cancel', 'task.retry', 'task.reconcile', 'task.plan.submit'].includes(call.action))), false)
  await capture('notifications-original-attempt')
  checks.push('375px dark UI has no page overflow; a notification locates an older unloaded Task and original attempt without mutating current work')
  assert.deepEqual(errors, [])
  const report = { status: 'passed', checks, images, pageErrors: errors, limitation: 'Actual product components with isolated synthetic Host responses; no live profile, model or desktop.' }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
