// Exercises the real plugin in an isolated, installed Harness. Start it with
// scripts/start-harness-ui-check.mjs; no shell, RPC or model response is mocked.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { MODEL_AVATARS } from '../modules/bot-runtime/vendor/ds-bot/src/client/model-avatar-catalog.js'
import { PORTRAIT_RIGS } from '../modules/bot-runtime/vendor/ds-bot/src/client/model-portrait-eyes.js'

const root = resolve(import.meta.dirname, '..'), base = process.argv[2] ? resolve(process.argv[2]) : join(root, 'tmp/integration/actual-harness-ui')
const { run, home, source, harnessVersion, packageVersion } = JSON.parse(await readFile(join(base, 'current.json'), 'utf8'))
const connection = JSON.parse(await readFile(join(run, 'connection.private.json'), 'utf8'))
assert.equal(new URL(connection.origin).hostname, '127.0.0.1')
const output = join(base, 'model-avatars-verified'); await mkdir(output, { recursive: true })
const expectedClient = await readFile(join(source, '.dsh-plugin/client.js'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
const errors = [], images = [], served = [], checks = [], motions = []
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
const bots = async () => {
  const state = JSON.parse(await readFile(join(home, 'bot/state.json'), 'utf8'))
  return Array.isArray(state.bots) ? state.bots : Object.values(state.bots ?? {})
}
const openCreate = async () => {
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  await page.getByRole('option', { name: '新建 Bot', exact: true }).click()
  await page.locator('.bt-create').waitFor()
}
const checkCreate = async form => {
  assert.equal(await form.locator('.bt-model-avatar').count(), 19, 'creation must show model portraits without visiting the edit picker')
  assert.equal(await form.getByRole('tab', { name: '模型角色', exact: true }).getAttribute('aria-selected'), 'true')
  await page.waitForFunction(() => [...document.querySelectorAll('.bt-create-card .bt-model-avatar img')].every(image => image.complete && image.naturalWidth === 256))
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const box = await form.locator('.bt-create-card').boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1)
}
const pickDraft = async (form, id) => {
  const entry = MODEL_AVATARS.find(item => item.id === id)
  await form.locator(`[data-model-avatar="${id}"]`).click()
  await page.waitForFunction(image => document.querySelector('.bt-create-preview img')?.getAttribute('src') === image, entry.image)
  assert.equal(await form.locator(`[data-model-avatar="${id}"]`).getAttribute('aria-pressed'), 'true')
  return entry
}
const motionSelector = id => '.bt-create-preview .bt-model-portrait[data-portrait="' + id + '"]'
const checkMotion = async (form, id) => {
  const selector = motionSelector(id)
  const avatar = form.locator(selector)
  await avatar.waitFor()
  await page.waitForFunction(selector => document.querySelector(selector)?.hasAttribute('data-portrait-motion'), selector)
  await page.waitForFunction(selector => document.querySelector(selector + ' img')?.naturalWidth === 256, selector)
  if (id === 'deepseek') {
    const { width, height } = await avatar.boundingBox()
    await avatar.hover({ position: { x: Math.floor(width * .85), y: Math.floor(height * .5) } })
    assert.ok(Number(await avatar.evaluate(node => node.style.getPropertyValue('--bt-portrait-x'))) > 0)
  }
  await avatar.click()
  const sample = await page.waitForFunction(({ selector, eyes }) => {
    const node = document.querySelector(selector)
    const eyelids = node?.querySelector('canvas')
    if (!eyelids || eyelids.hidden) return false
    const animation = node.querySelector('.bt-portrait-gesture').getAnimations().find(item => item.playState === 'running')
    if (!animation) return false
    const painted = eyelids.getContext('2d')
    const image = node.querySelector('img')
    const original = document.createElement('canvas')
    original.width = eyelids.width
    original.height = eyelids.height
    const source = original.getContext('2d')
    source.drawImage(image, 0, 0)
    const changes = eyes.map(([left, top, right, bottom]) => {
      const box = [left, top, right - left, bottom - top]
      const actual = painted.getImageData(...box).data
      const before = source.getImageData(...box).data
      let changed = 0
      for (let i = 0; i < actual.length; i += 4) {
        if (actual[i + 3] && Math.abs(actual[i] - before[i]) + Math.abs(actual[i + 1] - before[i + 1]) +
          Math.abs(actual[i + 2] - before[i + 2]) > 30) changed++
      }
      return changed
    })
    if (changes.some(pixels => pixels < 60)) return false
    return { frames: animation.effect.getKeyframes(), duration: animation.effect.getTiming().duration, changes }
  }, { selector, eyes: PORTRAIT_RIGS[id].eyes }, { polling: 'raf', timeout: 2000 })
  const { frames, duration, changes } = await sample.jsonValue()
  await sample.dispose()
  const heldIndex = frames.findIndex((frame, index) => {
    const previous = frames[index - 1]
    return previous && frame.transform === previous.transform && frame.offset - previous.offset >= .15
  })
  assert.ok(heldIndex > 0, id + ' must hold its main pose through several frames')
  const held = frames[heldIndex]
  const move = /translate\(([-.\d]+)%,\s*([-.\d]+)%\)/.exec(held.transform)
  const roll = Math.abs(Number(/rotate\(([-.\d]+)deg\)/.exec(held.transform)?.[1]))
  const vertical = Number(move?.[2])
  assert.ok(roll >= 5 || Math.abs(vertical) >= 3, id + ' must have a clearly visible tilt or nod')
  const holdMs = Math.round((held.offset - frames[heldIndex - 1].offset) * duration)
  return { id, roll, vertical, holdMs, blinkChangedPixels: changes }
}
const checkReducedMotion = async (form, id) => {
  const selector = motionSelector(id)
  const avatar = form.locator(selector)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(selector => {
    const node = document.querySelector(selector)
    return node && !node.hasAttribute('data-portrait-motion') && node.querySelector('canvas').hidden &&
      node.querySelector('.bt-portrait-gesture').getAnimations().length === 0
  }, selector, { polling: 'raf', timeout: 2000 })
  await avatar.click()
  assert.equal(await avatar.locator('canvas').isVisible(), false)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
}
const createPortraitBot = async (form, name, id) => {
  const entry = await pickDraft(form, id)
  await form.getByRole('textbox', { name: '名字', exact: true }).fill(name)
  await form.getByRole('button', { name: '创建', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
  for (let attempt = 0; attempt < 30; attempt++) {
    const bot = (await bots()).find(item => item.name === name)
    if (bot?.avatar?.image === entry.image) return bot
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error('Created Bot did not persist its chosen model portrait')
}

try {
  await page.goto(connection.ownerUrl)
  await page.locator('.bp-workspace-shortcuts').waitFor({ state: 'attached', timeout: 30000 })
  const beta = page.getByText('预览版说明', { exact: true })
  await beta.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})
  if (await beta.isVisible()) await page.getByRole('button', { name: '继续', exact: true }).click()
  await dismissWelcome()
  const beforeDraft = (await bots()).map(({ id, avatar }) => ({ id, avatar }))
  await openCreate()
  let form = page.locator('.bt-create')
  await checkCreate(form)
  for (const entry of MODEL_AVATARS) {
    await pickDraft(form, entry.id)
    motions.push(await checkMotion(form, entry.id))
  }
  assert.equal(new Set(motions.map(({ roll, vertical }) => JSON.stringify([roll, vertical]))).size, 4)
  checks.push('all 19 real previews change both eyelids, hold a clearly visible greeting, and render four motion styles')
  await pickDraft(form, 'deepseek')
  await checkMotion(form, 'deepseek')
  await checkReducedMotion(form, 'deepseek')
  checks.push('the preview follows the pointer and reduced motion cancels the gesture and the blink')
  await capture('create-avatars-light')
  await form.getByRole('tab', { name: 'Bot', exact: true }).click()
  await form.locator('.bt-shape').first().click()
  assert.equal(await form.locator('.bt-create-preview img').count(), 0)
  await form.getByRole('tab', { name: '模型角色', exact: true }).click()
  await pickDraft(form, 'rwkv')
  await form.getByRole('button', { name: '随机', exact: true }).click()
  assert.equal(await form.getByRole('tab', { name: 'Bot', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await form.locator('.bt-create-preview img').count(), 0)
  await form.getByRole('tab', { name: '模型角色', exact: true }).click()
  await pickDraft(form, 'rwkv')
  await form.getByRole('button', { name: '头像库', exact: true }).click()
  await form.locator('.bt-lib').waitFor()
  await pickDraft(form, 'deepseek')
  assert.equal(await form.locator('.bt-lib').count(), 0)
  assert.deepEqual((await bots()).map(({ id, avatar }) => ({ id, avatar })), beforeDraft, 'avatar browsing stays in the unsaved creation draft')
  await form.getByRole('button', { name: '关闭', exact: true }).click()
  assert.deepEqual((await bots()).map(({ id, avatar }) => ({ id, avatar })), beforeDraft, 'cancelling creates no Bot and changes no existing avatar')
  await openCreate(); form = page.locator('.bt-create')
  await createPortraitBot(form, 'Portrait Creation Check', 'rwkv')
  checks.push('the actual New Chat → Create Bot form immediately lists all 19 presets; browsing/cancelling has no Host side effects, and Create persists the selected portrait')
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
  assert.equal(await page.locator('.bt-row, .bt-tile').filter({ hasText: 'Portrait Creation Check' }).first().locator('img').getAttribute('src'), MODEL_AVATARS.find(item => item.id === 'deepseek').image)
  checks.push('a complete browser reload reads the committed portrait in the sidebar, editor and selection ring')
  await page.keyboard.press('Escape')
  const appearance = page.locator('.bp-appearance').first()
  await appearance.locator('summary').click(); await appearance.getByRole('button', { name: '深色', exact: true }).click(); await appearance.locator('summary').click()
  await openEditor(); await noOverflow(); await capture('avatars-dark')
  await page.keyboard.press('Escape'); await openCreate()
  form = page.locator('.bt-create'); await checkCreate(form)
  await pickDraft(form, 'deepseek'); await capture('create-avatars-dark')
  await form.getByRole('button', { name: '关闭', exact: true }).click()
  // Harness collapses the conversation details column on phones. Use the real
  // full-screen Bot settings entry that remains available from the account menu.
  await page.setViewportSize({ width: 390, height: 844 }); await page.keyboard.press('Escape')
  await page.locator('.bt-account:visible').last().click()
  await page.getByRole('menuitem', { name: 'Bot 设置', exact: true }).click()
  await page.locator('.bt-settings-nav').getByRole('button', { name: 'Bot', exact: true }).click()
  await page.locator('.bt-settings .bt-set-row:has(.bt-row-title)').filter({ hasText: 'Portrait Creation Check' }).first().click()
  await page.locator('.bt-settings .bt-avatar-trigger').click()
  assert.equal(await page.getByRole('tab', { name: '模型角色', exact: true }).getAttribute('aria-selected'), 'true')
  await noOverflow(); await capture('avatars-phone')
  checks.push('the actual desktop details picker fits light/dark; the actual full-screen Bot settings picker fits a 390px phone viewport')
  await page.keyboard.press('Escape')
  await page.locator('.bt-settings-nav').getByRole('button', { name: 'Bot', exact: true }).click()
  await page.locator('.bt-settings').getByRole('button', { name: '新 Bot', exact: true }).click()
  form = page.locator('.bt-create-inline'); await checkCreate(form)
  await pickDraft(form, 'doubao'); await checkMotion(form, 'doubao')
  await pickDraft(form, 'deepseek'); await capture('create-avatars-phone')
  await createPortraitBot(form, 'Phone Portrait Creation Check', 'deepseek')
  await page.reload(); await page.locator('.bp-workspace-shortcuts').waitFor({ state: 'attached' })
  const saved = await bots()
  assert.equal(saved.find(bot => bot.name === 'Portrait Creation Check').avatar.image, MODEL_AVATARS.find(item => item.id === 'deepseek').image)
  assert.equal(saved.find(bot => bot.name === 'Phone Portrait Creation Check').avatar.image, MODEL_AVATARS.find(item => item.id === 'deepseek').image)
  checks.push('the actual Settings → Bot → New Bot form lists the same 19 presets at 390px; both created Bots retain their committed portraits after reload')
  assert.ok(served.includes(hash(expectedClient)), 'the real Host must serve the exact generated client bytes')
  assert.deepEqual(errors, [])
  const report = { status: 'passed', buildLabel: 'local model-avatar verification build', packageVersion, actualHarnessRuntime: true, harnessVersion,
    apiMocks: false, syntheticUiShell: false, isolatedUserHome: true, nativeDesktopWindowVerified: false, paidModelCalls: 0,
    avatars: MODEL_AVATARS.length, motions, client: { bytes: expectedClient.length, sha256: hash(expectedClient), exactServedBytes: true }, checks, images, pageErrors: errors }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report))
} catch (cause) {
  await capture('failure'); throw cause
} finally { await browser.close() }
