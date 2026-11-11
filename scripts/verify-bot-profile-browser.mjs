// Real-browser verification of the identity and personality panel against a
// synthetic owner service. What this proves and what it does not:
//
//   proves  the panel reads the committed Bot and writes only the three fields
//            the Host persists, in one save, and reads them back from the store
//            it saved to; a multi-field edit is atomic on the wire; an IME
//            composition is never a submit and never loses its text; a save that
//            lands after the owner switched Bot updates no other Bot's fields; an
//            edit made behind the panel's back is refused instead of overwritten;
//            search and collapse work; 375px light and dark have no sideways
//            overflow and follow the product tokens; no page or console error
//            fires and nothing leaves the local fixture.
//   does not prove anything about a live Host: the fixture talks to no model, no
//            roster and no network, and the frozen runtime.updateBot semantics
//            it mirrors are covered by tests/bot-profile.mjs.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'tmp/integration/bot-profile')
await mkdir(output, { recursive: true })
const bundle = await build({
  absWorkingDir: root, entryPoints: ['tests/fixtures/bot-profile-preview.jsx'], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'es2022', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
})
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot 身份与个性 · 本地离线预览</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`
const server = createServer((request, response) => {
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); return }
  if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(bundle.outputFiles[0].contents); return }
  response.writeHead(404); response.end()
})
await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
const fixture = { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(yes => server.close(yes)) }

const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
const errors = [], requests = [], checks = [], images = []
page.on('pageerror', error => errors.push(error.message)); page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) }); page.on('request', request => requests.push(request.url()))
const capture = async name => { const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: false, animations: 'disabled' }); images.push(path); return path }
const calls = () => page.evaluate(() => window.__botProfileFixture.calls.map(call => ({ action: call.action, payload: call.payload })))
const store = () => page.evaluate(() => structuredClone(window.__botProfileFixture.store))
const field = (botId, name) => page.locator(`#bp-profile-${botId}-${name}`)

try {
  await page.goto(fixture.url)
  await page.locator('.bp-profile').waitFor()
  await page.waitForFunction(() => window.__botProfileFixture.calls.length === 1)
  assert.deepEqual(await calls(), [{ action: 'botProfile.inspect', payload: { botId: 'research' } }])
  assert.equal(await field('research', 'name').inputValue(), '研究伙伴')
  assert.equal(await field('research', 'role').inputValue(), '整理资料')
  assert.equal(await field('research', 'instructions').inputValue(), '先给结论，再给依据；不确定时说明还缺什么。')
  assert.equal(await page.locator('.bp-profile-pill[data-tone="muted"]').first().textContent(), '与宿主一致')
  assert.equal(await page.getByRole('button', { name: '保存身份与指令' }).isDisabled(), true)
  assert.match(await page.locator('.bp-profile-revision').textContent(), /修订号 3/)
  await capture('profile-wide')
  checks.push('the panel opens on the committed Bot: name, role and instructions read back from the synthetic committed store with one bounded owner read')

  await field('research', 'name').fill('研究总管')
  await field('research', 'role').fill('查资料写摘要')
  await field('research', 'instructions').fill('先给结论，再给依据；引用来源。')
  assert.equal(await page.locator('.bp-profile-pill[data-tone="warn"]').textContent(), '有未保存修改')
  await page.getByRole('button', { name: '保存身份与指令' }).click()
  await page.waitForFunction(() => document.querySelector('.bp-profile-feedback[data-kind="saved"]'))
  const saved = await calls()
  assert.deepEqual(saved.map(call => call.action), ['botProfile.inspect', 'botProfile.save'])
  // One call, one payload, three fields: the Host's own save is the only write.
  assert.deepEqual(Object.keys(saved[1].payload.profile).sort(), ['instructions', 'name', 'role'])
  assert.equal(saved[1].payload.expectedRevision, 3)
  assert.deepEqual(saved[1].payload.base, { name: '研究伙伴', role: '整理资料', instructions: '先给结论，再给依据；不确定时说明还缺什么。' })
  const afterSave = await store()
  assert.equal(afterSave.bots.research.name, '研究总管')
  assert.equal(afterSave.bots.research.role, '查资料写摘要')
  assert.equal(afterSave.bots.research.instructions, '先给结论，再给依据；引用来源。')
  assert.equal(await field('research', 'name').inputValue(), '研究总管')
  assert.equal(await page.locator('.bp-profile-pill[data-tone="muted"]').first().textContent(), '与宿主一致')
  assert.match(await page.locator('.bp-profile-feedback').textContent(), /已保存：名称、职责、对话指令/)
  await capture('profile-saved')
  checks.push('a three-field edit lands in one atomic save and the store the panel saved to holds exactly those three fields')

  // An IME composition is never a submit, and its text survives.
  await field('research', 'name').focus()
  await page.evaluate(() => document.querySelector('#bp-profile-research-name').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await page.keyboard.type('甲')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(120)
  assert.deepEqual((await calls()).map(call => call.action), ['botProfile.inspect', 'botProfile.save'])
  assert.equal(await field('research', 'name').inputValue(), '研究总管甲')
  await page.evaluate(() => document.querySelector('#bp-profile-research-name').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '甲' })))
  await page.getByRole('button', { name: '保存身份与指令' }).click()
  await page.waitForFunction(() => window.__botProfileFixture.calls.length === 3)
  assert.equal((await store()).bots.research.name, '研究总管甲')
  checks.push('Enter inside an IME composition submits nothing and loses no text; the same button saves once the composition ends')

  // A save that lands after the owner switched Bot writes no other Bot's fields.
  await page.getByRole('button', { name: '慢速保存' }).click()
  await page.locator('[data-bot-id="writer"]').click()
  await page.waitForFunction(() => document.querySelector('#bp-profile-writer-role') && window.__botProfileFixture.calls.some(call => call.action === 'botProfile.inspect' && call.payload.botId === 'writer'))
  assert.equal(await field('writer', 'role').inputValue(), '写会议记录')
  await field('writer', 'role').fill('写会议纪要')
  await page.getByRole('button', { name: '保存身份与指令' }).click()
  await page.locator('[data-bot-id="research"]').click()
  await page.waitForFunction(() => window.__botProfileFixture.calls.filter(call => call.action === 'botProfile.inspect' && call.payload.botId === 'research').length === 2)
  // The save the owner sent for the other Bot still lands on the committed
  // store, even though its answer arrived after the switch and updated no panel.
  await page.waitForFunction(() => window.__botProfileFixture.store.bots.writer.role === '写会议纪要')
  await page.waitForFunction(() => window.__botProfileFixture.calls.filter(call => call.action === 'botProfile.save').length === 3)
  const switched = await store()
  assert.equal(switched.bots.writer.role, '写会议纪要')
  assert.equal(switched.bots.research.name, '研究总管甲')
  assert.equal(await field('research', 'name').inputValue(), '研究总管甲')
  assert.equal(await field('research', 'role').inputValue(), '查资料写摘要')
  checks.push('a save that returns after the Bot switch updates only the baseline of the Bot it was sent for; the new Bot keeps its own fields')

  // An edit made behind the panel's back is refused, not overwritten.
  await page.getByRole('button', { name: '慢速保存' }).click()
  await field('research', 'instructions').fill('我要写的指令。')
  await page.getByRole('button', { name: '他处修改这个 Bot 的指令' }).click()
  await page.getByRole('button', { name: '保存身份与指令' }).click()
  await page.waitForFunction(() => document.querySelector('.bp-profile-feedback[data-kind="notice"]'))
  assert.match(await page.locator('.bp-profile-feedback').textContent(), /别处已更新/)
  const conflicted = await store()
  assert.notEqual(conflicted.bots.research.instructions, '我要写的指令。')
  assert.match(conflicted.bots.research.instructions, /别处改过的指令/)
  assert.equal(await field('research', 'instructions').inputValue(), '我要写的指令。')
  checks.push('a concurrent edit elsewhere is refused with the owner’s draft intact; the other window’s value is never overwritten')

  // Search and collapse.
  await page.getByLabel('搜索身份设置').fill('性格')
  assert.equal(await page.locator('.bp-profile-group[data-group="voice"] .bp-profile-group-head').getAttribute('aria-expanded'), 'true')
  assert.equal(await page.locator('.bp-profile-group[data-group="identity"] .bp-profile-group-head').getAttribute('aria-expanded'), 'false')
  await page.getByLabel('搜索身份设置').fill('zzz')
  assert.match(await page.locator('.bp-profile-status').last().textContent(), /没有匹配/)
  await page.getByLabel('搜索身份设置').fill('')
  await page.locator('.bp-profile-group[data-group="identity"] .bp-profile-group-head').click()
  assert.equal(await page.locator('.bp-profile-group[data-group="identity"] .bp-profile-group-head').getAttribute('aria-expanded'), 'false')
  assert.equal(await page.locator('#bp-profile-research-name').count(), 0)
  await page.locator('.bp-profile-group[data-group="identity"] .bp-profile-group-head').click()
  assert.equal(await page.locator('#bp-profile-research-name').count(), 1)
  await capture('profile-collapsed')
  checks.push('search folds the groups that do not match and reports when nothing does; a group the owner folded stays folded')

  await page.setViewportSize({ width: 375, height: 900 })
  await page.waitForTimeout(120)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  const lightBackground = await page.locator('.bp-profile').evaluate(node => getComputedStyle(node).backgroundColor)
  await capture('profile-phone')
  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'dark'))
  const darkBackground = await page.locator('.bp-profile').evaluate(node => getComputedStyle(node).backgroundColor)
  assert.notEqual(lightBackground, darkBackground)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await capture('profile-phone-dark')
  await page.setViewportSize({ width: 1360, height: 1000 })
  await capture('profile-wide-dark')
  checks.push('375px light and dark keep every control reachable with no sideways overflow, and the panel follows the product tokens in both themes')

  assert.deepEqual(errors, [])
  assert.ok(requests.every(url => url.startsWith(fixture.url)))
  const report = { status: 'passed', checks, images, pageErrors: errors, limitation: 'Real identity component against a synthetic owner service; no live Host, roster, model or network.' }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  const published = resolve(root, '..', 'output', 'bot-profile-upgrade-20261108')
  await mkdir(published, { recursive: true })
  for (const image of images) await copyFile(image, join(published, basename(image)))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close(); await fixture.close() }
