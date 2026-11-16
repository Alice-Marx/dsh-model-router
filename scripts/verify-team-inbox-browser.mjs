// Actual Harness registration and owner-facing capability catalog. Coordination
// behavior is tested separately with the real SDK, SQLite and offline providers.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..'), base = join(root, 'tmp/integration/actual-harness-ui')
const { run, source, home, packageVersion, harnessVersion } = JSON.parse(await readFile(join(base, 'current.json'), 'utf8'))
const connection = JSON.parse(await readFile(join(run, 'connection.private.json'), 'utf8'))
const expected = await readFile(join(source, '.dsh-plugin/client.js'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const output = join(base, 'team-inbox-verified'); await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
const served = [], errors = []
page.on('pageerror', error => errors.push(error.message.replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]')))
page.on('response', async response => {
  if (response.status() !== 200 || !/javascript/.test(response.headers()['content-type'] ?? '')) return
  try { const body = await response.body(), at = body.indexOf(expected); if (at >= 0) served.push(sha(body.subarray(at, at + expected.length))) } catch {}
})
const call = (action, payload) => page.evaluate(async ({ action, payload }) => {
  const response = await fetch('api/bot-product', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...(payload === undefined ? {} : { payload }) }) })
  const text = await response.text()
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null }
}, { action, payload })
try {
  await page.goto(connection.ownerUrl)
  await page.locator('.bp-workspace-shortcuts').waitFor({ state: 'attached', timeout: 30_000 })
  let snapshot, startupWaits = 0
  for (; startupWaits < 30; startupWaits++) {
    snapshot = await call('snapshot')
    if (snapshot.status === 200) break
    await page.waitForTimeout(500)
  }
  assert.equal(snapshot.status, 200); assert.equal(snapshot.body.ok, true)
  const bot = snapshot.body.value.bots.find(bot => bot.main) ?? snapshot.body.value.bots[0]
  assert.ok(bot)
  const inspect = await call('binding.inspect', { botId: bot.id })
  assert.equal(inspect.body.ok, true)
  const group = inspect.body.value.record.catalog.capabilities.find(group => group.id === 'team-work')
  assert.ok(group.tools.includes('tool/team_inbox'))
  assert.ok(group.tools.includes('tool/coordinate_bots'))
  const unsupported = await call('team_inbox', { botId: bot.id, action: 'list' })
  assert.equal(unsupported.body.ok, false); assert.equal(unsupported.body.error.code, 'INVALID_PRODUCT_ACTION')
  const Database = createRequire(import.meta.url)('better-sqlite3')
  let stores = 0
  const privateRoot = await realpath(home), candidates = [], folders = [home]
  for (let index = 0; index < folders.length; index++) {
    assert.ok(folders.length < 512, 'verification home directory limit')
    for (const entry of await readdir(folders[index], { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules') continue
      const file = join(folders[index], entry.name), actual = await realpath(file)
      if (!actual.startsWith(privateRoot + sep)) continue
      if (entry.isDirectory()) folders.push(file)
      else if (/\.(?:db|sqlite|sqlite3)$/.test(entry.name)) candidates.push(file)
    }
  }
  for (const file of candidates) {
    let db
    try { db = new Database(file, { readonly: true }); if (db.prepare("SELECT name FROM sqlite_master WHERE name='bot_team_inputs_v1'").get()) stores++ }
    finally { db?.close() }
  }
  assert.equal(stores, 1, 'the real Host must create the durable input-version store')
  if (startupWaits) await page.reload()
  const beta = page.getByText('预览版说明', { exact: true })
  await beta.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await beta.isVisible()) { await page.getByRole('button', { name: '继续', exact: true }).click(); await beta.waitFor({ state: 'hidden' }) }
  const welcome = page.getByText('开始使用', { exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await welcome.isVisible()) { await page.keyboard.press('Escape'); await welcome.waitFor({ state: 'hidden' }) }
  await page.locator('.bp-workspace-shortcuts').getByRole('button', { name: 'AI 提供方', exact: true }).click()
  await page.getByRole('group', { name: 'AI 连接类型' }).waitFor()
  await page.getByRole('button', { name: '官方工具', exact: true }).click()
  await page.getByRole('button', { name: '安装与登录', exact: true }).click()
  const zcode = page.locator('#mr-panel-tools .mr-tool').filter({ has: page.locator('.mr-route-name', { hasText: /^ZCode TUI$/ }) })
  await zcode.waitFor({ state: 'visible', timeout: 30_000 })
  const command = zcode.getByLabel('ZCode TUI 安装命令', { exact: true })
  assert.match(await command.innerText(), /@mbearo\/zcode@latest/)
  assert.equal(await zcode.getByText('ZCode CLI', { exact: true }).count(), 0)
  assert.ok((await zcode.innerText()).includes('智谱'))
  await zcode.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'zcode-tui-official-tools.png'), animations: 'disabled' })
  assert.ok(served.includes(sha(expected))); assert.deepEqual(errors, [])
  const report = { status: 'passed', packageVersion, harnessVersion, actualHarnessRuntime: true, apiMocks: false, syntheticUiShell: false,
    isolatedUserHome: true, liveUserProfileModified: false, nativeDesktopWindowVerified: false, paidModelCalls: 0,
    client: { bytes: expected.length, sha256: sha(expected), exactServedBytes: true }, startupWaits,
    checks: ['the actual owner API exposes team_inbox in the committed team-work capability catalog', 'model-only inbox calls are not exposed as an owner RPC accepting a supplied Bot identity', 'the real Host opens the durable team input-version SQLite table', 'the actual plugin client loads without browser errors', 'the real AI connections page opens official tools through the Host workbench', 'the ZCode TUI row shows the vendor label and @mbearo/zcode installation command'], pageErrors: errors }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report))
} catch (error) { throw new Error(String(error.message).replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]')) }
finally { await browser.close() }
