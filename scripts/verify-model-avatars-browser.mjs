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
const checkGaze = async (form, id) => {
  const selector = motionSelector(id), avatar = form.locator(selector)
  await page.waitForFunction(selector => {
    const root = document.querySelector(selector)
    return root?.hasAttribute('data-portrait-breathing') && root.querySelector('img').naturalWidth === 256 &&
      !root.querySelector('.bt-portrait-art').hidden
  }, selector)
  const { width, height } = await avatar.boundingBox()
  const shifts = []
  for (const direction of [-1, 1]) {
    await avatar.hover({ position: { x: Math.round(width * (.5 + direction * .36)), y: Math.floor(height * .5) } })
    const sample = await page.waitForFunction(({ selector, eyes, direction }) => {
      const node = document.querySelector(selector)
      const canvas = node?.querySelector('.bt-portrait-eyes')
      if (!canvas || canvas.hidden) return false
      const original = document.createElement('canvas')
      original.width = original.height = canvas.width
      const source = original.getContext('2d')
      source.drawImage(node.querySelector('img'), 0, 0)
      const painted = canvas.getContext('2d')
      const measured = eyes.map(([left, top, right, bottom]) => {
        const width = right - left, height = bottom - top
        const before = source.getImageData(left, top, width, height).data
        const after = painted.getImageData(left, top, width, height).data
        let best = { shift: 0, error: Infinity }
        // Compare both parts of the painted eye against horizontal translations of the original pixels.
        for (let shift = -5; shift <= 5; shift++) {
          let error = 0
          for (let y = Math.ceil(height * .36); y < height * .76; y++) {
            for (let x = Math.ceil(width * .27); x < width * .73; x++) {
              const moved = (y * width + x) * 4, start = (y * width + x - shift) * 4
              for (let channel = 0; channel < 3; channel++) error += (after[moved + channel] - before[start + channel]) ** 2
            }
          }
          if (error < best.error) best = { shift, error }
        }
        return best.shift
      })
      return measured.every(pixels => pixels * direction >= 2) && measured
    }, { selector, eyes: PORTRAIT_RIGS[id].eyes, direction }, { polling: 'raf', timeout: 2000 })
    shifts.push(await sample.jsonValue())
    await sample.dispose()
  }
  await page.mouse.move(1, 1)
  await page.waitForFunction(selector => {
    const node = document.querySelector(selector)
    return node?.querySelector('.bt-portrait-eyes').hidden
  }, selector, { polling: 'raf', timeout: 3000 })
  return shifts
}
const checkMotion = async (form, id) => {
  const selector = motionSelector(id)
  const avatar = form.locator(selector)
  await avatar.waitFor()
  await page.waitForFunction(selector => document.querySelector(selector)?.hasAttribute('data-portrait-motion'), selector)
  await page.waitForFunction(selector => document.querySelector(selector + ' img')?.naturalWidth === 256, selector)
  const sample = await avatar.evaluateHandle((node, eyes) => ({ ready: new Promise(resolve => {
    const eyelids = node.querySelector('.bt-portrait-eyes')
    const art = node.querySelector('.bt-portrait-art')
    const original = document.createElement('canvas')
    original.width = eyelids.width
    original.height = eyelids.height
    const source = original.getContext('2d', { willReadFrequently: true })
    source.drawImage(node.querySelector('img'), 0, 0)
    const panels = [[62, 43, 130, 56], [62, 189, 130, 42]]
    const eyeBoxes = eyes.map(([left, top, right, bottom]) => [left, top, right - left, bottom - top])
    const originalEyes = eyeBoxes.map(box => source.getImageData(...box).data)
    node.addEventListener('click', () => {
      const render = art.getContext('2d')
      const paint = eyelids.getContext('2d')
      const initial = panels.map(box => (art.hidden ? source : render).getImageData(...box).data)
      const scratch = document.createElement('canvas')
      scratch.width = scratch.height = original.width
      const read = scratch.getContext('2d', { willReadFrequently: true })
      const start = performance.now()
      const frames = [], blink = [0, 0]
      let last = 0
      const capture = time => {
        const elapsed = time - start
        if (elapsed - last >= 24) {
          last = elapsed
          read.drawImage(art.hidden ? original : art, 0, 0)
          const motion = panels.map((box, index) => {
            const current = read.getImageData(...box).data, before = initial[index]
            let difference = 0
            for (let i = 0; i < current.length; i += 4) {
              difference += Math.abs(current[i] - before[i]) + Math.abs(current[i + 1] - before[i + 1]) +
                Math.abs(current[i + 2] - before[i + 2])
            }
            return difference / (current.length * .75)
          })
          frames.push({ elapsed, head: motion[0], torso: motion[1] })
          if (!eyelids.hidden) eyeBoxes.forEach((box, index) => {
            const current = paint.getImageData(...box).data, before = originalEyes[index]
            let changed = 0
            for (let i = 0; i < current.length; i += 4) {
              if (current[i + 3] && Math.abs(current[i] - before[i]) + Math.abs(current[i + 1] - before[i + 1]) +
                Math.abs(current[i + 2] - before[i + 2]) > 30) changed++
            }
            blink[index] = Math.max(blink[index], changed)
          })
        }
        if (elapsed < 1590) requestAnimationFrame(capture)
        else resolve({ frames, blink })
      }
      requestAnimationFrame(capture)
    }, { once: true })
  }) }), PORTRAIT_RIGS[id].eyes)
  await avatar.click()
  const { frames, blink } = await sample.evaluate(handle => handle.ready)
  await sample.dispose()
  const peak = region => frames.reduce((best, frame) => frame[region] > best[region] ? frame : best)
  const head = peak('head'), torso = peak('torso')
  assert.ok(head.head > 2.5 && torso.torso > .9, id + ' must move both the head and chest in the rendered art')
  assert.ok(blink.every(pixels => pixels > 145), id + ' must close both eyes during its greeting')
  return { id, headMotion: head.head, torsoMotion: torso.torso, torsoDelayMs: Math.round(torso.elapsed - head.elapsed),
    blinkChangedPixels: blink }
}
const checkReducedMotion = async (form, id) => {
  const selector = motionSelector(id)
  const avatar = form.locator(selector)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(selector => {
    const node = document.querySelector(selector)
    return node && !node.hasAttribute('data-portrait-motion') &&
      [...node.querySelectorAll('canvas')].every(canvas => canvas.hidden)
  }, selector, { polling: 'raf', timeout: 2000 })
  await avatar.click()
  assert.equal(await avatar.locator('canvas:visible').count(), 0)
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
  assert.ok(motions.filter(({ torsoDelayMs }) => torsoDelayMs >= 55).length >= 15,
    'shoulders should usually reach their peak well after the head in the rendered greetings')
  checks.push('all 19 real previews blink on greeting and deform at both the head and shoulders; the shoulder movement trails the head')
  await pickDraft(form, 'deepseek')
  const gazePixels = await checkGaze(form, 'deepseek')
  await checkMotion(form, 'deepseek')
  await checkReducedMotion(form, 'deepseek')
  checks.push('the preview has a breathing cycle, both eyes track the pointer in either direction and recenter, and reduced motion stops the breathing, gesture and blink')
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
    avatars: MODEL_AVATARS.length, motions, gazePixels, client: { bytes: expectedClient.length, sha256: hash(expectedClient), exactServedBytes: true }, checks, images, pageErrors: errors }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report))
} catch (cause) {
  await capture('failure'); throw cause
} finally { await browser.close() }
