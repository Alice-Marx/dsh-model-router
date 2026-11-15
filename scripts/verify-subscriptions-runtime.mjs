// Real pinned CLIProxyAPI control-plane compatibility, using an explicitly fake,
// unexpired OAuth record and a rejecting outbound proxy. No real account or model call.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { installCliProxyArtifact, createCliProxyRuntime } from '../packages/orchestration/src/cli-proxy-runtime.mjs'
import { spawnCliProxyComponent } from '../packages/orchestration/src/cli-proxy-process.mjs'
import { openSubscriptionProxy } from '../packages/orchestration/src/subscription-proxy.mjs'
const at = process.argv.indexOf('--archive')
assert.ok(at >= 0 && process.argv[at + 1], 'Pass --archive with the pinned release archive')
const base = resolve('tmp/integration/subscription-runtime-verified'); await mkdir(base, { recursive: true })
const run = await mkdtemp(join(base, 'case-')), root = join(run, 'service')
await installCliProxyArtifact(await readFile(resolve(process.argv[at + 1])), root)
await mkdir(join(root, 'accounts'), { recursive: true })
await writeFile(join(root, 'accounts/offline-fixture.json'), JSON.stringify({ type: 'codex', email: 'offline-fixture@example.test', account_id: 'offline-fixture-only',
  access_token: 'offline-fixture-access-not-a-real-token', refresh_token: 'offline-fixture-refresh-not-a-real-token', id_token: '', expired: '2099-01-01T00:00:00Z', last_refresh: '2098-01-01T00:00:00Z', plan_type: 'pro' }), { mode: 0o600 })
const deny = createServer((_request, response) => { response.writeHead(502); response.end() })
deny.on('connect', (_request, socket) => { socket.end('HTTP/1.1 502 Blocked by offline fixture\r\n\r\n') })
await new Promise(done => deny.listen(0, '127.0.0.1', done))
const mounted = new Map(), Database = createRequire(import.meta.url)('better-sqlite3'), owner = { kind: 'owner' }
const workers = [], runtime = createCliProxyRuntime({ root, spawnProcess(binary, args, options) { const worker = spawnCliProxyComponent(binary, args, options); worker.on('message', message => { if (message?.componentPid) worker.componentPid = message.componentPid }); workers.push(worker); return worker } })
const service = openSubscriptionProxy({ Database, file: join(run, 'test.sqlite'), runtime, llm: { registerAdapter(providers, adapter) { for (const provider of providers) mounted.set(provider, adapter); return () => providers.forEach(provider => mounted.delete(provider)) } } })
try {
  await service.initialize(); service.enable({ proxyUrl: `http://127.0.0.1:${deny.address().port}` }, owner)
  for (let attempt = 0; attempt < 220 && !['ready', 'error'].includes(service.list(owner).service.phase); attempt++) await new Promise(done => setTimeout(done, 150))
  assert.equal(service.list(owner).service.phase, 'ready')
  let view
  for (let attempt = 0; attempt < 20; attempt++) { view = await service.refresh({}, owner); if (view.accounts[0]?.models.length) break; await new Promise(done => setTimeout(done, 150)) }
  assert.equal(view.accounts.length, 1)
  assert.ok(view.accounts[0].models.length > 0, 'the real upstream must advertise account-prefixed models after PATCH /credentials/fields')
  assert.ok(view.accounts[0].models.every(model => /^dsh-[a-f0-9]{16}\//.test(model.id) && model.contextWindow > model.maxTokens && model.maxTokens > 0))
  assert.equal(view.accounts[0].state, 'configured', 'a catalog entry must not claim a successful subscription inference')
  assert.equal(mounted.size, 1)
  assert.doesNotMatch(JSON.stringify(view), /offline-fixture-access|offline-fixture-refresh|apiKey|managementKey/)
  const worker = workers[0]
  assert.ok(worker.componentPid > 0)
  assert.throws(() => runtime.fetchInference('https://untrusted.invalid/v1/chat/completions', { method: 'POST' }), { code: 'SUBSCRIPTION_INFERENCE_TARGET' })
  const exited = new Promise((done, reject) => { const timer = setTimeout(() => reject(new Error('component worker survived loss of Host IPC')), 6000); worker.once('exit', () => { clearTimeout(timer); done() }) })
  worker.disconnect(); await exited
  assert.throws(() => process.kill(worker.componentPid, 0), { code: 'ESRCH' })
  assert.equal(service.routes().length, 0)
  const report = { status: 'passed', cliProxyVersion: view.service.version, actualCliProxyRuntime: true, mockedControlPlane: false, offlineOAuthFixture: true,
    realSubscriptionAuthenticated: false, realModelCalls: 0, advertisedAccountModels: view.accounts[0].models.length,
    checks: ['pinned binary starts on loopback with independent credentials', 'the real v8 account fields endpoint assigns a per-account prefix',
      'the real public model catalog and static definitions join into precise model capacities', 'the provider adapter registers only account-prefixed subscription routes', 'catalog access stays configured until an inference succeeds',
      'inference cannot send a component key outside its loopback endpoint', 'loss of the Host IPC pipe stops both worker and component and withdraws its routes'] }
  await writeFile(join(base, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report))
} finally { await service.close(); deny.closeAllConnections(); await new Promise(done => deny.close(done)) }
