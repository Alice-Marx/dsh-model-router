#!/usr/bin/env node
/**
 * verify-data-panel-fixture.mjs — render the REAL data panel in a real headless
 * Chromium at 375px in light and dark themes, prove an injected cell is escaped
 * (never executed) in the live DOM, prove a negative bar is drawn from the ZERO
 * baseline, and save screenshots.
 *
 * These screenshots are FIXTURE renders of synthetic data — they are NOT real
 * model execution and contain no user data. Run:
 *   node scripts/verify-data-panel-fixture.mjs
 *
 * The hardening run writes `hardening-panel-*.png` next to the first delivery's
 * `data-panel-*.png`; the earlier screenshots are left untouched.
 */

import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = fileURLToPath(import.meta.url)
const repo = resolve(dirname(here), '..')
const tmp = join(repo, 'tmp', 'integration', 'data-tools')
const outDir = resolve(repo, '..', 'output', 'data-tools-migration-20261108')
const bundlePath = join(tmp, 'data-fixture.bundle.js')
const htmlPath = join(tmp, 'data-fixture.html')

const THEME_VARS = `
html body[data-bot-product-ui]{--bp-bg:#fcfcfd;--bp-surface:#fff;--bp-sidebar:#f4f4f5;--bp-subtle:#f6f6f7;--bp-hover:#ededf0;--bp-border:#e6e6e9;--bp-ink:#242427;--bp-muted:#76767e;--bp-quiet:#a1a1a9;--bp-solid:#242427;--bp-on-solid:#fff;--bp-focus:#617b9f;--bp-danger:#b33c42;--bp-font:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
html body[data-bot-product-ui][data-ds-dark-theme]{--bp-bg:#151517;--bp-surface:#1c1c1f;--bp-sidebar:#19191c;--bp-subtle:#232326;--bp-hover:#2b2b30;--bp-border:#303035;--bp-ink:#ededf0;--bp-muted:#a0a0a9;--bp-quiet:#72727c;--bp-solid:#ededf0;--bp-on-solid:#1b1b1e;--bp-focus:#95b0d6;--bp-danger:#f09b9e}
.bp-page{box-sizing:border-box;min-height:100%;padding:16px;background:var(--bp-bg);color:var(--bp-ink);font-family:var(--bp-font);font-size:14px;line-height:1.65}
.bp-page *{box-sizing:border-box}
.bp-page-inner{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.bp-card{background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:12px;padding:16px}
.bp-card-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.bp-card-title h2{font-size:15px;margin:0}
.bp-muted{color:var(--bp-muted);font-size:13px}
.bp-error{color:var(--bp-danger);font-size:13px}
.bp-button-primary{color:var(--bp-on-solid);background:var(--bp-solid);border:1px solid var(--bp-solid);border-radius:8px;padding:7px 12px;font:inherit;font-size:13px;cursor:pointer}
.bp-text-button{background:transparent;border:0;padding:0;color:var(--bp-ink);font:inherit;cursor:pointer;text-align:left}
button{font:inherit}
`

await build({ entryPoints: [join(tmp, 'data-fixture-entry.jsx')], bundle: true, format: 'iife', jsx: 'automatic', write: true, outfile: bundlePath, absWorkingDir: repo })
const dataCss = await readFile(join(repo, 'apps', 'integration-client', 'data.css'), 'utf8')
const bundle = await readFile(bundlePath, 'utf8')
await writeFile(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=375, initial-scale=1"><style>${THEME_VARS}\n${dataCss}</style></head><body data-bot-product-ui="1"><div id="root"></div><script>${bundle}</script></body></html>`, 'utf8')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const problems = []
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 } })
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`) })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  const url = pathToFileURL(htmlPath).href
  await page.goto(url)
  await page.waitForSelector('.bp-data-table svg, .bp-data-chart svg', { timeout: 8000 })

  // The injected payload must be a text node, never a live element.
  const injection = await page.evaluate(() => ({
    liveImages: document.querySelectorAll('#root img[onerror]').length,
    liveScripts: document.querySelectorAll('#root script').length,
    escapedText: document.body.innerHTML.includes('&lt;img') || [...document.querySelectorAll('#root td')].some(td => td.textContent.includes('<img src=x')),
  }))
  const escapedOk = injection.liveImages === 0 && injection.liveScripts === 0 && injection.escapedText

  // A negative bar must start ON the zero baseline and grow downwards; a positive
  // one must start above it. The zero baseline is the "0" tick label's line.
  const baseline = await page.evaluate(() => {
    const chart = document.querySelector('svg[aria-label*="delta"]')
    if (!chart) return null
    const label = [...chart.querySelectorAll('text.bp-data-axis')].find(entry => entry.textContent.trim() === '0')
    if (!label) return null
    const zeroY = Number(label.getAttribute('y')) - 4
    const bars = [...chart.querySelectorAll('rect')].map(rect => ({ y: rect.y.baseVal.value, height: rect.height.baseVal.value }))
    return { zeroY, bars }
  })
  const baselineOk = Boolean(baseline) && baseline.bars.some(bar => Math.abs(bar.y - baseline.zeroY) < 0.6 && bar.height > 1)
    && baseline.bars.some(bar => bar.y < baseline.zeroY - 1)

  await page.screenshot({ path: `${outDir}/hardening-panel-375-light.png`, fullPage: true })
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await page.screenshot({ path: `${outDir}/hardening-panel-375-dark.png`, fullPage: true })

  const wide = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await wide.goto(url)
  await wide.waitForSelector('.bp-data-chart svg', { timeout: 8000 })
  await wide.screenshot({ path: `${outDir}/hardening-panel-desktop-light.png`, fullPage: true })
  await wide.close()

  console.log(`${escapedOk ? 'PASS' : 'FAIL'}  injected cell is escaped in the live DOM (no live img/script; text present)`)
  console.log(`${baselineOk ? 'PASS' : 'FAIL'}  a negative bar is drawn from the zero baseline (${baseline ? JSON.stringify(baseline) : 'chart not found'})`)
  console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  no console/page errors during render${problems.length ? ` — ${problems.join('; ')}` : ''}`)
  console.log('screenshots:')
  for (const name of ['hardening-panel-375-light.png', 'hardening-panel-375-dark.png', 'hardening-panel-desktop-light.png']) console.log(`  ${outDir}/${name}`)
  if (!escapedOk || problems.length || !baselineOk) { console.log(JSON.stringify(injection)); process.exit(1) }
  console.log('PANEL FIXTURE OK')
} finally {
  await browser.close()
}
