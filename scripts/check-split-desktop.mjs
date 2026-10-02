import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// Use an installed Playwright package; no package installation or account login is performed.
const require = createRequire(process.env.PLAYWRIGHT_ANCHOR || new URL('../package.json', import.meta.url))
const { chromium } = require('playwright')
const root = resolve(process.argv[2] || 'test-artifacts/plugin-split')
const names = process.argv.slice(3)
if (!names.length) throw new Error('Usage: check-split-desktop.mjs <logs-directory> router-only gal-only together')
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE, headless: true })
const results = []
await mkdir(root, { recursive: true })
try {
  for (const name of names) {
    const router = name !== 'gal-only'
    const gal = name !== 'router-only'
    const log = await readFile(join(root, `${name}.log`), 'utf8')
    const url = log.match(/dsh web:\s*(http:\/\/\S+)/)?.[1]
    assert.ok(url, `${name} failed to start`)
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    const welcome = page.getByRole('button', { name: '继续', exact: true })
    try { await welcome.waitFor({ timeout: 5000 }); await welcome.click() } catch { /* Welcome already acknowledged by this isolated profile. */ }
    const later = page.getByRole('button', { name: '稍后配置', exact: true })
    try { await later.waitFor({ timeout: 3000 }); await later.click() } catch { /* Credential onboarding already dismissed. */ }
    await page.getByRole('button', { name: '插件', exact: true }).waitFor()
    if (router) {
      await page.getByRole('button', { name: '模型路由', exact: true }).click()
      await page.getByRole('heading', { name: '模型路由工作台', exact: true }).waitFor()
      await page.getByRole('heading', { name: '官方工具', exact: false }).waitFor()
      await page.locator('#mr-task').fill('分析项目架构，修复接口问题，编写测试并交付文档')
      await page.getByRole('button', { name: '团队分工', exact: true }).click()
      await page.getByRole('button', { name: '生成路由建议', exact: true }).click({ timeout: 60_000 })
      await page.locator('.mr-results').waitFor()
      await page.screenshot({ path: join(root, `${name}-router.png`), fullPage: true })
    } else {
      assert.equal(await page.getByRole('button', { name: '模型路由', exact: true }).count(), 0)
    }
    if (gal) {
      await page.getByRole('button', { name: 'Gal 模块', exact: true }).click()
      await page.locator('.gm-title-menu').waitFor()
      const episode = page.locator('.gm-title-menu select')
      const values = await episode.locator('option').evaluateAll(items => items.map(item => item.value))
      assert.deepEqual(values, ['echo-chronicle', 'legacy'])
      await page.getByRole('button', { name: /开始新故事/ }).click()
      await page.locator('.gm-stage').waitFor()
      await page.locator('.gm-stage-art').evaluate(async element => {
        const image = new Image()
        image.src = getComputedStyle(element).backgroundImage.slice(5, -2)
        await image.decode()
      })
      await page.getByRole('button', { name: 'Gal 设置', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      await page.getByRole('dialog').locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
      const range = page.getByRole('dialog').locator('input[type=range]').first()
      const oldScale = Number(await range.inputValue())
      await range.press('ArrowLeft')
      assert.equal(Number(await range.inputValue()), oldScale - 1)
      await range.press('ArrowRight')
      await page.screenshot({ path: join(root, `${name}-gal-settings.png`), fullPage: true })
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await page.screenshot({ path: join(root, `${name}-gal.png`), fullPage: true })
      const save = await page.evaluate(() => localStorage.getItem('model-router:gal-story:v1:episode:echo-chronicle'))
      assert.ok(save, 'GAL retains the combined-plugin story key')
      await page.reload()
      await page.getByRole('button', { name: 'Gal 模块', exact: true }).click()
      await page.getByRole('button', { name: /继续阅读/ }).click()
      await page.locator('.gm-stage').waitFor()
      assert.equal(await page.evaluate(() => localStorage.getItem('model-router:gal-story:v1:episode:echo-chronicle')), save)
    } else {
      assert.equal(await page.getByRole('button', { name: 'Gal 模块', exact: true }).count(), 0)
    }
    assert.deepEqual(errors, [], `${name} client runtime errors`)
    results.push({ profile: name, router, gal, runtimeErrors: errors.length })
    await page.close()
  }
  await writeFile(join(root, 'split-result.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close() }
