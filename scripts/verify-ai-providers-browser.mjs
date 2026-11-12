import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { chromium } from 'playwright'
import { openAiProviders } from '../packages/orchestration/src/ai-providers.mjs'
import { attachNativeLlm } from '../tests/helpers/product-native-llm.mjs'

const root = resolve(import.meta.dirname, '..'), output = join(root, 'tmp/integration/ai-providers-browser')
const Database = createRequire(import.meta.url)('better-sqlite3')
await mkdir(output, { recursive: true }); const home = await mkdtemp(join(output, 'home-'))
const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/fixtures/ai-providers-preview.jsx'], bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' }, logLevel: 'silent' })
const hosts = [], services = [], releases = [], credentials = [], apiResponses = [], errors = [], checks = [], images = []
let origin, hangChecks = false
const fakeKey = 'fixture-browser-secret-only'
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/fixture-hang-checks') { hangChecks = true; response.writeHead(200); response.end('{}'); return }
    if (request.url === '/client.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bundle.outputFiles[0].text); return }
    if (request.url === '/' || request.url === '/alternate/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/client.js"></script>'); return }
    if (request.url === '/mock/v1/models') {
      const authorized = request.headers.authorization !== 'Bearer bad-fixture-key'
      response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' }); response.end(JSON.stringify(authorized ? { data: [{ id: 'browser-chat' }] } : { error: { message: 'invalid fixture' } })); return
    }
    if (request.url?.endsWith('/api/bot-product')) {
      const index = request.url.startsWith('/alternate/') ? 1 : 0
      let text = ''; for await (const part of request) { text += part; if (text.length > 2_000_000) throw new Error('large fixture input') }
      const { action, payload } = JSON.parse(text)
      const service = services[index], owner = { kind: 'owner' }
      const methods = { 'aiProviders.list': () => service.list(owner), 'aiProviders.save': () => service.save(payload, owner), 'aiProviders.remove': () => service.remove(payload, owner), 'aiProviders.check': () => service.probe(payload, owner), 'aiProviders.suggestions': () => service.suggestions(payload, owner),
        'aiProviders.cliStatus': () => ({ tools: [{ toolId: 'codex', label: 'Codex CLI · 合成检测', status: 'ready' }, { toolId: 'claude-code', label: 'Claude Code · 合成检测', status: 'logged-out', reason: '请在官方 CLI 中登录。' }] }) }
      const value = await methods[action]?.()
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: true, value })); return
    }
    response.writeHead(404); response.end()
  } catch (error) { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: false, error: { code: error.code ?? 'FIXTURE_ERROR', message: error.message } })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`
for (let index = 0; index < 2; index++) {
  const host = { state: {}, upstream: [] }, values = new Map(); hosts.push(host); releases.push(await attachNativeLlm(host)); credentials.push(values)
  services.push(openAiProviders({ Database, file: join(home, `host-${index}.sqlite`), llm: host.llm,
    credentials: { async set(ref, value) { values.set(ref, value) }, async resolve(ref) { return values.has(ref) ? { value: values.get(ref) } : undefined }, async describe(ref) { return { configured: values.has(ref) } }, async unset(ref) { values.delete(ref) } },
    fetcher: (url, init) => { if (new URL(url).origin !== origin) throw new Error('Fixture refuses external network'); if (hangChecks && new URL(url).pathname === '/mock/v1/models') return new Promise(() => {}); return fetch(url, init) },
  }))
}
await services[0].save({ expectedRevision: 0, preset: 'moonshotai-cn', name: 'Kimi · 合成验收', protocol: 'openai-completions', baseUrl: origin + '/mock/v1', enabled: true, auth: 'key', apiKey: fakeKey,
  models: [{ id: 'browser-chat', name: 'Kimi · 测试模型', contextWindow: 4096, maxTokens: 64, reasoning: false }] }, { kind: 'owner' })
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('pageerror', error => errors.push(error.message))
page.on('response', async response => { if (response.url().includes('api/bot-product')) apiResponses.push(await response.text().catch(() => '')) })
const capture = async name => { const file = join(output, name + '.png'); await page.screenshot({ path: file, animations: 'disabled' }); images.push(file) }
try {
  await page.goto(origin); await page.getByRole('heading', { name: 'Kimi · 合成验收', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新检查', exact: true }).isEnabled(), true)
  assert.equal(await page.locator('.bp-ai-presets button').count(), 9)
  await capture('providers-wide'); checks.push('actual provider manager reads owner service and presents independent API connections and separate CLI status')
  await page.getByRole('button', { name: '自定义 / 本地服务', exact: true }).click()
  await page.getByLabel('连接名称', { exact: true }).fill('浏览器独立连接')
  await page.getByLabel('AI 服务地址', { exact: true }).fill(origin + '/mock/v1')
  await page.getByLabel('此连接的 API Key', { exact: true }).fill('browser-new-fixture-key')
  assert.equal(await page.getByLabel('此连接的 API Key').getAttribute('type'), 'password')
  await page.getByRole('button', { name: '添加模型', exact: true }).click()
  await page.getByLabel('模型 1 模型 ID', { exact: true }).fill('browser-chat')
  await page.getByLabel('模型 1 显示名称', { exact: true }).fill('浏览器模型')
  await page.getByLabel('模型 1 上下文容量', { exact: true }).fill('4096')
  await page.getByLabel('模型 1 默认输出上限', { exact: true }).fill('64')
  await capture('providers-create')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await page.getByRole('heading', { name: '浏览器独立连接', exact: true }).waitFor()
  const row = page.locator('.bp-ai-provider').filter({ has: page.getByRole('heading', { name: '浏览器独立连接', exact: true }) })
  await row.getByRole('button', { name: '检查', exact: true }).click()
  await row.getByText('模型目录可访问；实际推理尚未验证。', { exact: true }).waitFor()
  assert.equal(await row.locator('.bp-ai-state').getAttribute('data-state'), 'configured')
  checks.push('real owner save writes a separate credential, adds a model, and a public catalog response is not mislabeled as successful inference')
  await row.getByRole('button', { name: '管理', exact: true }).click()
  assert.equal(await page.getByLabel('此连接的 API Key').inputValue(), '')
  await page.getByLabel('此连接的 API Key').fill('bad-fixture-key')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await row.getByRole('button', { name: '检查', exact: true }).click()
  await row.getByText('认证被拒绝（401），请更新此连接的密钥。', { exact: true }).waitFor()
  const kimi = page.locator('.bp-ai-provider').filter({ has: page.getByRole('heading', { name: 'Kimi · 合成验收', exact: true }) })
  assert.equal(await kimi.getByText(/认证被拒绝/).count(), 0)
  checks.push('editing never reads the saved key back; a rejected replacement only changes that connection and its credential')
  await page.request.get(origin + '/fixture-hang-checks')
  await row.getByRole('button', { name: '检查', exact: true }).click()
  await row.getByRole('button', { name: '检查中…', exact: true }).waitFor()
  await row.getByRole('button', { name: '管理', exact: true }).click()
  assert.equal(await page.getByLabel('连接名称', { exact: true }).isEnabled(), true)
  await page.getByLabel('连接名称', { exact: true }).fill('检查期间的未保存草稿')
  await page.getByLabel('此连接的 API Key').fill('unsaved-fixture-key')
  await capture('providers-checking-draft'); checks.push('a probe that never returns cannot stop provider editing or discard an unsaved key draft')
  await page.getByRole('button', { name: '切换验收连接', exact: true }).click()
  await page.getByRole('heading', { name: '连接你的第一个 AI', exact: true }).waitFor()
  assert.equal(await page.getByLabel('此连接的 API Key').count(), 0)
  assert.equal((await services[1].list({ kind: 'owner' })).providers.length, 0)
  checks.push('changing Host API remounts the manager, discards secret drafts, and cannot reuse the previous connection identity')
  await page.getByRole('button', { name: '切换验收连接', exact: true }).click(); await row.getByRole('button', { name: '管理', exact: true }).waitFor()
  await page.setViewportSize({ width: 375, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await capture('providers-phone-light')
  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'dark')); await capture('providers-phone-dark')
  await row.getByRole('button', { name: '管理', exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await capture('providers-editor-phone-dark'); checks.push('375px light/dark provider list and editor have no horizontal overflow')
  await page.getByRole('button', { name: '返回提供方', exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.getByRole('button', { name: '插件设置', exact: true }).click()
  await page.locator('.bt-settings .bp-ai').waitFor()
  await page.locator('.bt-settings .bp-ai').getByRole('heading', { name: 'Kimi · 合成验收', exact: true }).waitFor()
  assert.equal(await page.locator('.bt-settings .bp-ai-presets button').count(), 9)
  assert.equal(await page.locator('.bt-settings .bp-ai').getByText('正在读取独立 AI 配置…', { exact: true }).count(), 0)
  await capture('providers-plugin-settings')
  await page.evaluate(() => document.body.setAttribute('data-bp-appearance', 'light'))
  await capture('providers-plugin-settings-light'); checks.push('the actual pinned DS Bot settings AI page renders the plugin manager instead of Harness shared provider controls')
  assert.ok(apiResponses.every(body => !body.includes(fakeKey) && !body.includes('browser-new-fixture-key') && !body.includes('bad-fixture-key')))
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ status: 'passed', syntheticDataOnly: true, actualOwnerService: true, actualSqlite: true, noExternalProviderRequests: true, checks, images }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, output }))
} finally { await browser.close(); for (const service of services) service.close(); for (const release of releases) await release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
