import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { serveChatFixture } from './verify-chat-design-browser.mjs'
import { contrastRatio } from '../apps/integration-client/chat-design.mjs'

const out = resolve('tmp/integration/bot-thread-header'); await mkdir(out, { recursive: true })
const fixture = await serveChatFixture(), browser = await chromium.launch({ headless: true })
const checks = [], errors = [], images = []
try {
  for (const width of [1360, 375]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
    try {
      await page.goto(`${fixture.url}#threads`)
      await page.locator('.bp-threads-head').waitFor()
      await page.evaluate(mode => document.body.setAttribute('data-bp-appearance', mode), theme)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(overflow, false, `${width}/${theme}: closed header must not overflow`)
      await page.locator('.bp-threads-head').click()
      await page.getByRole('menuitem').first().waitFor()
      const bounds = await page.locator('.bp-threads-menu').boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${width}/${theme}: thread menu stays on screen`)
      const colors = await page.locator('.bp-threads-menu').evaluate(node => ({ ink: getComputedStyle(node).color, surface: getComputedStyle(node).backgroundColor }))
      assert.ok(contrastRatio(colors.ink, colors.surface) >= 4.5, `${width}/${theme}: thread menu text stays readable`)
      images.push(resolve(out, `header-${width}-${theme}.png`))
      await page.screenshot({ path: images.at(-1), fullPage: true })
      await page.locator('.bp-threads-menu-row:not([data-state=default])').first().click()
      await page.waitForFunction(() => window.__chatDesignFixture.calls.some(row => row.action === '打开线程会话'))
      const opened = await page.evaluate(() => window.__chatDesignFixture.calls.filter(row => row.action === '打开线程会话'))
      assert.deepEqual(opened, [{ action: '打开线程会话', detail: 'thread-session-research' }])
      await page.locator('.bp-threads-head').click()
      await page.locator('.bp-threads-menu-row[data-state=default]').click()
      await page.waitForFunction(() => window.__chatDesignFixture.calls.filter(row => row.action === '打开线程会话').length === 2)
      const defaultChat = await page.evaluate(() => window.__chatDesignFixture.calls.filter(row => row.action === '打开线程会话').at(-1))
      assert.deepEqual(defaultChat, { action: '打开线程会话', detail: 'bot-research:part-3' }, 'returning uses the original Host-projected default Session')
      await page.locator('.bp-threads-head').click()
      await page.getByRole('textbox', { name: '新线程名称' }).focus()
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.bp-threads-menu').count(), 0)
      assert.equal(await page.locator('.bp-threads-head').evaluate(node => document.activeElement === node), true, 'Escape restores focus to the chip')
      const stopVisible = await page.locator('[data-testid=composer-stop]').isVisible()
      assert.equal(stopVisible, true, 'the thread control preserves the native stop control')
      const stopHit = await page.locator('[data-testid=composer-stop]').evaluate(node => {
        const box = node.getBoundingClientRect(), target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return box.top >= 0 && box.bottom <= innerHeight && (target === node || node.contains(target))
      })
      assert.equal(stopHit, true, 'the stop control stays inside the viewport and receives the pointer')
      checks.push({ width, theme, passed: true })
    } finally { await page.close() }
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ checks, errors, images, scope: 'actual chat addon and vendor DOM/style contract with offline Host responses; no live Host' }, null, 2))
  process.stdout.write(JSON.stringify({ checks: checks.length, errors: errors.length, images }, null, 2))
} finally { await browser.close(); await fixture.close() }
