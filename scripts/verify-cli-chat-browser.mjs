import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..'), output = join(root, 'tmp/integration/cli-chat-browser')
await mkdir(output, { recursive: true })
const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/fixtures/cli-chat-preview.jsx'], bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' }, logLevel: 'silent' })
const server = createServer((request, response) => {
  if (request.url === '/client.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bundle.outputFiles[0].text) }
  else if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/client.js"></script>') }
  else { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [], checks = [], images = []
page.on('pageerror', error => errors.push(error.message))
const capture = async name => { const path = join(output, name + '.png'); await page.screenshot({ path, animations: 'disabled', fullPage: true }); images.push(path) }
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
const assertNoOverflow = async () => {
  if (await noOverflow()) return
  await capture('cli-chat-overflow-diagnostic')
  const boxes = await page.locator('*').evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect()
    return box.right > innerWidth + 1 ? [{ tag: element.tagName, class: element.className, width: box.width, right: box.right }] : []
  }).slice(0, 14))
  assert.fail('CLI editor overflows: ' + JSON.stringify(boxes))
}
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.getByRole('heading', { name: 'Codex · 合成账号', exact: true }).waitFor()
  await page.getByText('已配置 · 待验证对话', { exact: true }).waitFor()
  await capture('cli-chat-wide')
  checks.push('actual CLI chat manager renders configured text-chat profiles separately from verified conversations')
  await page.getByRole('button', { name: '管理 CLI 聊天', exact: true }).click()
  assert.equal(await page.getByLabel('CLI 登录资料 JSON', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('CLI 登录资料 JSON', { exact: true }).getAttribute('type'), 'password')
  assert.equal(await page.getByRole('button', { name: '删除 CLI 连接', exact: true }).isEnabled(), false)
  await page.getByRole('button', { name: '核验安装入口', exact: true }).click()
  await page.getByText('安装入口与版本已核验。保存后请实际发起对话，验证账号与模型是否可用。', { exact: true }).waitFor()
  checks.push('saved credentials are not read back, a used profile cannot be deleted, and version inspection does not claim verified inference')
  await page.setViewportSize({ width: 375, height: 900 }); await assertNoOverflow()
  await capture('cli-chat-editor-phone-light')
  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'dark')); assert.equal(await noOverflow(), true)
  await capture('cli-chat-editor-phone-dark')
  checks.push('375px light and dark editor has no horizontal overflow')
  await page.getByLabel('CLI 登录资料 JSON', { exact: true }).fill('{"env":{"TOKEN":"synthetic-fixture-only"}}')
  await page.getByLabel('使用本机已登录账号', { exact: true }).check()
  assert.equal(await page.getByLabel('CLI 登录资料 JSON', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('CLI 登录资料 JSON', { exact: true }).isEnabled(), false)
  await page.getByRole('button', { name: '保存 CLI 聊天连接', exact: true }).click()
  await page.getByRole('heading', { name: 'Codex · 合成账号', exact: true }).waitFor()
  const saved = await page.evaluate(() => globalThis.__cliChatFixture.calls.find(call => call.action === 'cliProviders.save').payload)
  assert.equal(saved.importLocalAccount, true); assert.equal(Object.hasOwn(saved, 'credentialJson'), false); assert.equal(saved.expectedRevision, 7)
  checks.push('local-account import is explicit and sends only the import choice, with no pasted secret or read-back credentials')
  await page.getByRole('button', { name: '管理 CLI 聊天', exact: true }).click()
  await page.evaluate(() => { globalThis.__cliChatFixture.state.hungInspection = true })
  await page.getByRole('button', { name: '核验安装入口', exact: true }).click()
  await page.getByLabel('CLI 连接名称', { exact: true }).fill('检查期间未保存的草稿')
  await page.getByRole('button', { name: '返回 CLI 连接', exact: true }).click()
  assert.ok(await page.evaluate(() => globalThis.__cliChatFixture.state.aborted > 0))
  await page.getByRole('heading', { name: 'Codex · 合成账号', exact: true }).waitFor()
  checks.push('a version probe that ignores cancellation cannot freeze editing or prevent leaving the editor')
  await page.getByRole('button', { name: '管理 CLI 聊天', exact: true }).click()
  await page.getByLabel('CLI 登录资料 JSON', { exact: true }).fill('unsaved-fixture-only')
  await page.getByRole('button', { name: '切换验收连接', exact: true }).click()
  await page.getByText('还没有 CLI 聊天连接', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('CLI 登录资料 JSON', { exact: true }).count(), 0)
  assert.equal(await noOverflow(), true)
  await capture('cli-chat-empty-phone-dark')
  checks.push('changing Host API drops unsaved credentials and renders only the newly selected Host profiles')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ status: 'passed', syntheticDataOnly: true, fixtureBackend: true, realVendorCalls: 0, checks, images }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, output }))
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
