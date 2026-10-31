import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, readFile, symlink, copyFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolverAnchor } from './integration-upstream-tests.mjs'
import { combinedOverlay, isolatedHostEnvironment } from './integration-combined-host.mjs'
import { killProcessTree } from '../.dsh-plugin/shared/task-executors.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const hostArg = process.argv.indexOf('--host-root')
const hostRoot = resolve(hostArg < 0 ? join(ROOT, 'tests/fixtures/integration-host') : process.argv[hostArg + 1])
const { anchor } = await resolverAnchor(hostRoot)
await copyFile(join(ROOT, 'tests/fixtures/integration-combined/mock-plugin.mjs'), join(anchor, 'offline-model.mjs'))
await copyFile(join(ROOT, 'tests/fixtures/web-search-config/host-probe.mjs'), join(anchor, 'web-search-config-probe.mjs'))
const parent = join(ROOT, 'tmp/integration/web-search-config')
await mkdir(parent, { recursive: true })
const run = await mkdtemp(join(parent, 'run-')), home = join(run, 'home'), profile = join(home, 'profiles/web-search-config')
const workspace = join(run, '工作目录 workspace'), botHome = join(run, '自定义团队 custom home')
await mkdir(join(profile, 'node_modules/@ljwei-stak'), { recursive: true })
await mkdir(workspace)
await symlink(ROOT, join(profile, 'node_modules/@ljwei-stak/dsh-model-router'), process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'web-search-config-offline-profile', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@ljwei-stak/dsh-model-router'] } } }))
const profiles = '[{"provider":"integration-gpt-fixture","model":"gpt-fixture","fixture":true}]'
const supportingDomainsFixture=process.argv.includes('--migration-supporting-fixture')
const runtimeConfig = { home: botHome, workspace, mainName: '保留主助理', mainRole: '保留原角色', memory: supportingDomainsFixture, browser: false,
  memoryReview: false, github: false, diagnosticsFile: false, updateCheck: true, futureOption: { retained: true } }
async function overlay({ overridden = false } = {}) {
  const patches = combinedOverlay(join(anchor, 'offline-model.mjs')).filter(row => row.id !== 'bot')
  patches.push({ id: 'model-router-galgame', config: { botRuntime: runtimeConfig, modelProfilesJson: profiles,
    dailyBudgetUsd: 17, monthlyBudgetUsd: 31 } },
  { insert: [{ id: 'web-search-config-probe', name: pathToFileURL(join(anchor, 'web-search-config-probe.mjs')).href }] })
  if (overridden) patches.push({ id: 'web', config: { searchProvider: 'fixture-search', fetchProvider: 'http' } },
    { id: 'web-search-auto', name: '@ljwei-stak/dsh-model-router/web-search', disabled: true })
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(patches, null, 2))
}
const requireHost = createRequire(join(hostRoot, 'package.json'))
const manifestPath = requireHost.resolve('@deepseek-ai/dsh/package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
assert.equal(manifest.version, '0.2.1-rc.3')
const bin = resolve(dirname(manifestPath), manifest.bin.dsh)
const listener = createServer()
await new Promise(done => listener.listen(0, '127.0.0.1', done))
const port = listener.address().port
await new Promise(done => listener.close(done))
const base = `http://127.0.0.1:${port}`
let child, closed, exit, timer, chunks = [], cookie
const output = () => Buffer.concat(chunks).toString('utf8')
async function launch() {
  chunks = []; closed = false
  child = spawn(process.execPath, ['--import', pathToFileURL(join(ROOT, 'modules/bot-runtime/vendor/ds-bot/test/harness-resolve.mjs')).href,
    '--import', pathToFileURL(join(ROOT, 'tests/fixtures/integration-combined/offline-preload.mjs')).href,
    bin, '--profile', 'web-search-config', '--no-open', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: workspace, env: isolatedHostEnvironment(home, anchor), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  exit = new Promise((done, reject) => { child.once('error', reject); child.once('close', code => { closed = true; done(code) }) })
  let bytes = 0
  const capture = chunk => { bytes += chunk.length; if (bytes < 4 * 1024 * 1024) chunks.push(chunk); else killProcessTree(child) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  timer = setTimeout(() => killProcessTree(child), 60000)
  const url = await wait(() => output().match(new RegExp(`${base.replaceAll('.', '\\.')}\\/\\?token=[^\\s]+`))?.[0])
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie)
  await wait(async () => {
    const response = await fetch(`${base}/api/bot-product`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: '{"action":"snapshot"}', signal: AbortSignal.timeout(5000) })
    return response.status === 200 && (await response.json()).ok
  })
}
async function wait(read) {
  const until = Date.now() + 45000
  while (Date.now() < until) {
    if (closed) throw new Error('Owned config fixture exited; see isolated logs')
    const value = await read()
    if (value) return value
    await sleep(100)
  }
  throw new Error('Owned config fixture timed out; see isolated logs')
}
async function stop(label) {
  clearTimeout(timer)
  if (!closed) killProcessTree(child)
  let stopTimer
  try { await Promise.race([exit, new Promise((_, reject) => { stopTimer = setTimeout(() => reject(new Error('Owned config fixture did not stop')), 10000) })]) }
  finally { clearTimeout(stopTimer) }
  await writeFile(join(run, `${label}.log`), output().replace(/(\?token=)[^\s]+/g, '$1[redacted]'))
}
async function request(path, body = {}) {
  const response = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, 200, `${path}: ${response.status}`)
  return response.json()
}
async function bot(endpoint, payload = {}) {
  const result = await request('bot', { endpoint, payload })
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.value
}
const checks = []
let summary
try {
  await overlay(); await launch()
  const first = await bot('state'), main = first.bots.find(item => item.id === first.mainBotId)
  assert.equal(main.name, runtimeConfig.mainName); assert.equal(main.role, runtimeConfig.mainRole)
  assert.equal(first.memory, supportingDomainsFixture); assert.equal(first.browser, false)
  assert.equal(resolve((await bot('folders')).team), resolve(workspace))
  assert.ok((await stat(join(botHome, 'state.json'))).isFile())
  await assert.rejects(stat(join(home, 'bot/state.json')), { code: 'ENOENT' })
  checks.push(supportingDomainsFixture?'Public default apply uses custom Bot home, workspace, name/role, enabled fixture memory and disabled browser':'Public default apply uses custom Bot home, workspace, name/role and disabled memory/browser')
  if(supportingDomainsFixture){
    await request('web-search-config-probe',{remember:{sessionId:main.sessionId}})
    await request('web-search-config-probe',{remember:{sessionId:main.sessionId,topic:true}})
    await bot('capability-save',{name:'fixture-skill',kind:'skill',content:'Offline preserved migration capability'})
    await bot('bot-capability',{botId:main.id,name:'fixture-skill',attached:true})
    assert.ok((await readFile(join(botHome,'memory/journal.jsonl'),'utf8')).includes('Offline fixture preference'))
    checks.push('Actual frozen remember tool saves entry/topic/journal and owner API saves/attaches a skill without a model call')
  }
  const persisted = JSON.parse(await readFile(join(botHome, 'state.json'), 'utf8'))
  assert.ok(persisted.mainBotIds.includes(main.id))
  const diagnostic = await request('web-search-config-probe')
  assert.equal(diagnostic.runtimeHome, botHome); assert.deepEqual(diagnostic.futureOption, { retained: true })
  assert.equal(diagnostic.modelProfilesJson, profiles); assert.equal(diagnostic.dailyBudgetUsd, 17); assert.equal(diagnostic.monthlyBudgetUsd, 31)
  checks.push('Real Loader retains unknown runtime options and existing MR model/budget settings')
  assert.equal(diagnostic.routerEntries, 1); assert.equal(diagnostic.legacyBotEntries, 0); assert.equal(diagnostic.legacySearchEntries, 0)
  assert.equal(diagnostic.autoRegistered, true); assert.equal(diagnostic.searchProvider, 'auto'); assert.equal(diagnostic.fetchProvider, 'http')
  assert.equal(diagnostic.fixtureSearchCalls, 0)
  checks.push('One public product entry loads the unified auto provider into real SDK WebRuntime')
  const update = await bot('update-check')
  assert.equal(update.source, 'integrated'); assert.equal(update.available, false)
  assert.equal((await request('integration-probe')).calls.length, 0)
  checks.push('Independent DS updating stays disabled even when the saved option requests it; zero model calls')
  await stop('initial')
  runtimeConfig.mainName = '不能重建已存身份'; runtimeConfig.mainRole = '不能替换已存角色'
  await overlay({ overridden: true }); await launch()
  const restored = await bot('state'), same = restored.bots.find(item => item.id === main.id)
  assert.equal(restored.mainBotId, main.id); assert.equal(same.name, main.name); assert.equal(same.role, main.role)
  assert.equal(same.sessionId, main.sessionId)
  if(supportingDomainsFixture){assert.ok((await readFile(join(botHome,'memory/bots',main.id,'MEMORY.md'),'utf8')).includes('Offline fixture preference'));assert.ok(same.capabilities.includes('fixture-skill'))}
  checks.push('Cold restart reuses the exact saved Main ID/session and retains its name/role')
  const overridden = await request('web-search-config-probe', { search: true })
  assert.equal(overridden.autoRegistered, false); assert.equal(overridden.searchProvider, 'fixture-search'); assert.equal(overridden.fixtureSearchCalls, 1)
  assert.equal((await request('integration-probe')).calls.length, 0)
  checks.push('Cold restart honors explicit auto disable and routes a query solely to an offline user provider')
  if(process.argv.includes('--migration-audit-fixture')){
    await bot('usage',{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})
    assert.ok((await stat(join(botHome,'usage.sqlite'))).isFile())
    checks.push('Explicit audit fixture initializes frozen DS usage v2 through its read-only Usage endpoint with zero model calls')
  }
  summary = { status: 'passed', level: 'actual-rc3-host-config-offline', checks, sdkVersion: manifest.version,
    actualModelCalls: 0, externalSearchCalls: 0, fixtureSearchCalls: 1, supportingDomainsFixture,
    limitations: ['Synthetic selected paths only; no real user profile migration', 'No client rebuild, real inference, CLI or desktop operation', 'Transaction/backup/import tools remain separate work'] }
} catch (error) { summary = { status: 'failed', checks, error: error.stack }; process.exitCode = 1 }
finally { if (child) await stop('last') }
await writeFile(join(run, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(JSON.stringify({ ...summary, runDirectory: run }, null, 2) + '\n')
