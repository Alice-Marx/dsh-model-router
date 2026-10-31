import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, readFile, symlink, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolverAnchor } from './integration-upstream-tests.mjs'
import { combinedOverlay, isolatedHostEnvironment } from './integration-combined-host.mjs'
import { verifyProductSource } from './integration-product-source.mjs'
import { killProcessTree } from '../.dsh-plugin/shared/task-executors.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const hostIndex = process.argv.indexOf('--host-root')
const hostRoot = resolve(hostIndex >= 0 ? process.argv[hostIndex + 1] : join(ROOT, 'tests/fixtures/integration-host'))
const source = await verifyProductSource()
const { anchor } = await resolverAnchor(hostRoot)
await copyFile(join(ROOT, 'tests/fixtures/integration-combined/mock-plugin.mjs'), join(anchor, 'offline-model.mjs'))
const parent = join(ROOT, 'tmp/integration/product-host'); await mkdir(parent, { recursive: true })
const run = await mkdtemp(join(parent, 'run-')), home = join(run, 'home'), profile = join(home, 'profiles/integration'), workspace = join(run, 'workspace')
await mkdir(join(profile, 'node_modules/@ljwei-stak'), { recursive: true }); await mkdir(workspace)
await symlink(ROOT, join(profile, 'node_modules/@ljwei-stak/dsh-model-router'), process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'bot-product-host-fixture', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@ljwei-stak/dsh-model-router'] } } }))
const overlay = combinedOverlay(join(anchor, 'offline-model.mjs')).filter(item => item.id !== 'bot')
overlay.push({ id: 'model-router-galgame', config: { requireBotPolicy: true, botProduct: false } },
  { insert: [{ id: 'bot-product-fixture', name: pathToFileURL(join(ROOT, 'tests/bot-runtime-host-plugin.mjs')).href }] })
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(overlay, null, 2))
const requireHost = createRequire(join(hostRoot, 'package.json'))
const manifestPath = requireHost.resolve('@deepseek-ai/dsh/package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); assert.equal(manifest.version, '0.2.1-rc.3')
const bin = resolve(dirname(manifestPath), manifest.bin.dsh)
const listener = createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done)); const port = listener.address().port; await new Promise(done => listener.close(done))
const base = `http://127.0.0.1:${port}`
let child, exit, closed, chunks, cookie, timer
const checks = []
const launch = () => {
  chunks = []; closed = false
  child = spawn(process.execPath, ['--import', pathToFileURL(join(ROOT, 'modules/bot-runtime/vendor/ds-bot/test/harness-resolve.mjs')).href,
    '--import', pathToFileURL(join(ROOT, 'tests/fixtures/integration-combined/offline-preload.mjs')).href,
    bin, '--profile', 'integration', '--no-open', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: workspace, env: isolatedHostEnvironment(home, anchor), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  exit = new Promise((done, reject) => { child.once('error', reject); child.once('close', code => { closed = true; done(code) }) })
  let bytes = 0
  const capture = chunk => { bytes += chunk.length; if (bytes <= 8 * 1024 * 1024) chunks.push(chunk); else killProcessTree(child) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  timer = setTimeout(() => killProcessTree(child), 120000)
}
const output = () => Buffer.concat(chunks).toString('utf8')
const stop = async label => {
  clearTimeout(timer); if (!closed) killProcessTree(child)
  await Promise.race([exit, sleep(10000).then(() => { throw new Error('Owned product host did not stop') })])
  await writeFile(join(run, `${label}.log`), output().replace(/(\?token=)[^\s]+/g, '$1[redacted]'))
}
const wait = async predicate => {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) { if (closed) throw new Error('Product host exited; see isolated logs'); const value = await predicate(); if (value) return value; await sleep(120) }
  throw new Error('Product host timed out; see isolated logs')
}
const login = async () => {
  const url = await wait(() => output().match(new RegExp(`${base.replaceAll('.', '\\.')}\\/\\?token=[^\\s]+`))?.[0])
  const response = await fetch(url, { redirect: 'manual' }); cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); assert.ok(cookie)
}
const request = async (path, body = {}) => {
  const response = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200); return response.json()
}
const api = async (endpoint, payload = {}) => { const result = await request('bot', { endpoint, payload }); assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const quiet = async () => {
  let last = -1, at = Date.now()
  return wait(async () => { const state = await api('state'), diagnostic = await request('integration-probe'); if (diagnostic.calls.length !== last || Object.keys(state.activity).length) { last = diagnostic.calls.length; at = Date.now() }; return Date.now() - at > 900 ? { state, diagnostic } : null })
}
let summary
try {
  launch(); await login()
  await wait(async () => (await request('integration-probe')).providers.some(item => item.id === 'integration-gpt-fixture'))
  let state = await api('state'); const mainId = state.mainBotId
  await api('update-bot', { id: mainId, model: 'integration-gpt-fixture/gpt-fixture' }); await quiet()
  await api('send', { sessionId: mainId, text: 'integration:create-worker' }); let current = await quiet()
  const workerId = current.state.bots.find(bot => bot.name === 'IntegrationWorker')?.id; assert.ok(workerId)
  checks.push('Migrated Main AgentLoop creates worker through the original DS create_bot tool')
  await api('send', { sessionId: workerId, text: 'integration:router-routes' }); current = await quiet()
  assert.ok(current.diagnostic.toolResults.some(item => item.name === 'model_router_routes' && !item.result.isError))
  checks.push('Migrated worker executes permitted MR routing in the same actual rc.3 host')
  await api('send', { sessionId: mainId, text: 'integration:delegate' }); await quiet()
  const exchange = await api('exchange', { a: mainId, b: workerId })
  assert.ok(exchange.some(row => row.from === mainId && row.to === workerId)); assert.ok(exchange.some(row => row.from === workerId && row.to === mainId))
  checks.push('Original DS Bot dispatch and result return survive migration')
  const first = await request('bot-product-probe', { mainId, workerId, exercise: true }); assert.equal(first.status, 'passed', first.error)
  await stop('first')
  launch(); await login(); await quiet()
  const restored = await request('bot-product-probe', { mainId, workerId, exercise: false }); assert.equal(restored.status, 'passed', restored.error)
  checks.push('Fresh actual host reconstructs stable identity and accounting hook from persisted migrated Bot state')
  summary = { status: 'passed', level: 'actual-host-offline', checks, first, restored, source, sdkVersion: manifest.version, actualModelCalls: 0,
    limitations: ['Offline diagnostic accounting decorator only, no monetary debit tested here', 'No Task/remote/OS worker or default user migration acceptance', 'Client bundle/component checks are separate from this host-only probe'] }
} catch (error) { summary = { status: 'failed', checks, error: error.stack }; process.exitCode = 1 }
finally { if (child) await stop('last') }
await writeFile(join(run, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(JSON.stringify({ ...summary, runDirectory: run }, null, 2) + '\n')
