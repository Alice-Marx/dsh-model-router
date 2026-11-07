import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, readFile, symlink, copyFile, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolverAnchor } from './integration-upstream-tests.mjs'
import { combinedOverlay, isolatedHostEnvironment } from './integration-combined-host.mjs'
import { verifyProductSource } from './integration-product-source.mjs'
import { killProcessTree } from '../.dsh-plugin/shared/task-executors.mjs'
import Database from 'better-sqlite3'

const ROOT = resolve(import.meta.dirname, '..')
const hostIndex = process.argv.indexOf('--host-root')
const hostRoot = resolve(hostIndex >= 0 ? process.argv[hostIndex + 1] : join(ROOT, 'tests/fixtures/integration-host'))
const source = await verifyProductSource()
const requireHost = createRequire(join(hostRoot, 'package.json'))
const manifestPath = requireHost.resolve('@deepseek-ai/dsh/package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
assert.ok(['0.2.1-rc.3', '0.2.1-rc.4', '0.2.2-rc.1'].includes(manifest.version), `Unaudited integration Host: ${manifest.version}`)
const { anchor } = await resolverAnchor(hostRoot, { expectedVersion: manifest.version })
await copyFile(join(ROOT, 'tests/fixtures/integration-combined/mock-plugin.mjs'), join(anchor, 'offline-model.mjs'))
const parent = join(ROOT, 'tmp/integration/product-default'); await mkdir(parent, { recursive: true })
const run = await mkdtemp(join(parent, 'run-')), home = join(run, 'home'), profile = join(home, 'profiles/integration'), workspace = join(run, 'workspace')
await mkdir(join(profile, 'node_modules/@ljwei-stak'), { recursive: true }); await mkdir(workspace)
await symlink(ROOT, join(profile, 'node_modules/@ljwei-stak/dsh-model-route-bot'), process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'bot-product-default-fixture', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@ljwei-stak/dsh-model-route-bot'] } } }))
// No test fixture plugin: the shipped default entry composes the unified Bot product itself.
const overlay = combinedOverlay(join(anchor, 'offline-model.mjs')).filter(item => item.id !== 'bot')
// N09: the managed CLI backend only exists once the host declares an
// installation-verified official entry. This probe declares a fixture entry and
// a contract-level session factory, so no native executable is ever spawned and
// no real CLI turn happens; the entry itself stays a host decision.
overlay.push({ id: 'model-router-galgame', config: { taskCli: {
  entry: { executable: join(run, 'fixture-codex'), sha256: '0'.repeat(64), version: '0.163.0' },
  models: [{ provider: 'integration-gpt-fixture', model: 'gpt-fixture', cliModel: 'gpt-fixture' }],
  sessionFactory: pathToFileURL(join(ROOT, 'tests/fixtures/integration-combined/cli-session-factory.mjs')).href,
} } })
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(overlay, null, 2))
const bin = resolve(dirname(manifestPath), manifest.bin.dsh)
const listener = createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done)); const port = listener.address().port; await new Promise(done => listener.close(done))
const base = `http://127.0.0.1:${port}`
let child, exit, closed, chunks, cookie, timer
const checks = []
const launch = () => {
  chunks = []; closed = false
  child = spawn(process.execPath, ['--import', pathToFileURL(join(ROOT, 'modules/bot-runtime/vendor/ds-bot/test/harness-resolve.mjs')).href,
    '--import', pathToFileURL(join(ROOT, 'tests/fixtures/integration-combined/product-resolve.mjs')).href,
    '--import', pathToFileURL(join(ROOT, 'tests/fixtures/integration-combined/offline-preload.mjs')).href,
    bin, '--profile', 'integration', '--no-open', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: workspace, env: isolatedHostEnvironment(home, anchor), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  exit = new Promise((done, reject) => { child.once('error', reject); child.once('close', code => { closed = true; done(code) }) })
  let bytes = 0
  const capture = chunk => { bytes += chunk.length; if (bytes <= 8 * 1024 * 1024) chunks.push(chunk); else killProcessTree(child) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  timer = setTimeout(() => killProcessTree(child), 240000)
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
const product = async (action, payload = {}) => {
  const response=await fetch(`${base}/api/bot-product`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action,...payload}),signal:AbortSignal.timeout(30000)})
  assert.ok([200,400,403].includes(response.status));return response.json()
}
const quiet = async () => {
  let last = -1, at = Date.now()
  return wait(async () => { const state = await api('state'), diagnostic = await request('integration-probe'); if (diagnostic.calls.length !== last || Object.keys(state.activity).length) { last = diagnostic.calls.length; at = Date.now() }; return Date.now() - at > 900 ? { state, diagnostic } : null })
}
// The composition opens the funding and machine authorities before creating the
// DS runtime, so the Bot channel can register after the offline provider
// appears. Wait for the product channel instead of racing the first read.
const ready = async () => {
  await wait(async () => { try { await api('state'); return true } catch { return false } })
}
let summary
let remoteAgent,remoteServer,browserServer
try {
  launch(); await login(); await ready()
  await wait(async () => (await request('integration-probe')).providers.some(item => item.id === 'integration-gpt-fixture'))
  let state = await api('state'); const mainId = state.mainBotId
  await api('update-bot', { id: mainId, model: 'integration-gpt-fixture/gpt-fixture' }); await quiet()
  // N06b: an unconfigured Bot keeps no model authority. The funding scope and
  // both bindings must exist before the first synthetic model turn; the probe
  // configures them through real owner actions, never by relaxing admission.
  const preSnapshot = (await product('snapshot')).value
  const preMain = preSnapshot.botBindings.items.find(item => item.botId === mainId)
  assert.equal(preMain.status, 'blocked')
  assert.match(preMain.blockedReason, /尚未配置/)
  const fixtureScope = preSnapshot.fundingAccounts.items.find(item => item.provider === 'integration-gpt-fixture')
  assert.ok(fixtureScope, JSON.stringify(preSnapshot.fundingAccounts.items))
  assert.equal(fixtureScope.enabled, false)
  const localMachine = preSnapshot.botBindings.machines.find(item => item.location === 'local')
  assert.ok(localMachine, JSON.stringify(preSnapshot.botBindings.machines))
  const rootId = localMachine.roots[0].rootId
  const enabledAccount = await product('funding.account.save', { payload: { scopeId: fixtureScope.id, expectedRevision: 0, enabled: true, dailyLimitUsd: 10, monthlyLimitUsd: 100 } })
  assert.equal(enabledAccount.ok, true, JSON.stringify(enabledAccount))
  assert.equal(enabledAccount.value.enabled, true)
  const bindingSettings = { schemaVersion: 1, enabled: true,
    model: { provider: 'integration-gpt-fixture', model: 'gpt-fixture' },
    officialTools: [], machineGrants: [{ machineId: localMachine.machineId, rootId, mode: 'read-only', capabilities: [] }],
    capabilities: ['model-inference', 'mr-routing', 'managed-tasks'], workspaceRef: { kind: 'local', machineId: localMachine.machineId, rootId },
    funding: { mode: 'api', scopeId: fixtureScope.id, pricing: { input: 0.000001, output: 0.000002 },
      request: { maxInputTokens: 100000, maxOutputTokens: 4096 }, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, subscription: null },
    maxConcurrentTasks: 1 }
  const savedMain = await product('binding.save', { payload: { botId: mainId, expectedRevision: 0, settings: bindingSettings } })
  assert.equal(savedMain.ok, true, JSON.stringify(savedMain))
  assert.equal(savedMain.value.status, 'available')
  const admittedMain = (await product('snapshot')).value.botBindings.items.find(item => item.botId === mainId)
  assert.equal(admittedMain.status, 'available')
  assert.deepEqual(admittedMain.grant.modelRoutes, [{ provider: 'integration-gpt-fixture', model: 'gpt-fixture' }])
  checks.push('N06b: unconfigured Main stays blocked; the funding scope and Main binding are configured through real owner actions before any model turn')
  await api('send', { sessionId: mainId, text: 'integration:create-worker' }); let current = await quiet()
  const workerId = current.state.bots.find(bot => bot.name === 'IntegrationWorker')?.id
  assert.ok(workerId, JSON.stringify({ bots: Object.values(current.state.bots).map(bot => ({ id: bot.id, name: bot.name, model: bot.model })),
    activity: current.state.activity, providerCalls: current.diagnostic.calls.length,
    diagnostics: String(await api('diagnostics-log')).slice(0, 2500),
    toolResults: current.diagnostic.toolResults.map(item => ({ name: item.name, isError: item.result?.isError, text: String(item.result?.content?.[0]?.text ?? item.result?.error ?? '').slice(0, 300) })) }))
  const workerPricing = { input: 0.000003, output: 0.000004 }
  const savedWorker = await product('binding.save', { payload: { botId: workerId, expectedRevision: 0,
    settings: { ...bindingSettings, funding: { ...bindingSettings.funding, pricing: workerPricing } } } })
  assert.equal(savedWorker.ok, true, JSON.stringify(savedWorker))
  assert.equal(savedWorker.value.status, 'available')
  checks.push('N06b: worker binding is configured through a real owner action before its first prompt')
  checks.push('Default entry: migrated Main AgentLoop creates worker through the original DS create_bot tool')
  const routingSettings = await product('botRoutingInspect')
  assert.equal(routingSettings.ok, true, JSON.stringify(routingSettings))
  assert.equal(routingSettings.value.candidates.find(row => row.botId === mainId).pricePerMTokUsd,
    (bindingSettings.funding.pricing.input + bindingSettings.funding.pricing.output) / 2)
  assert.equal(routingSettings.value.candidates.find(row => row.botId === workerId).pricePerMTokUsd,
    (workerPricing.input + workerPricing.output) / 2)
  checks.push('Bot routing: two Bots sharing the same model retain their own committed funding prices in the real owner preview')
  const routingSaved = await product('botRouting.save', { payload: { expectedRevision: routingSettings.value.settingsRevision,
    settings: { enabled: true, preset: 'balanced', autoGrant: { machineTools: false, cliTools: false } } } })
  assert.equal(routingSaved.ok, true, JSON.stringify(routingSaved))
  await api('send', { sessionId: mainId, text: `integration:route-worker:${workerId}` }); current = await quiet()
  const routedCall = current.diagnostic.toolResults.find(item => item.name === 'bot_route_task' && !item.result.isError)
  assert.ok(routedCall, JSON.stringify(current.diagnostic.toolResults))
  const routedValue = routedCall.result.value
  assert.equal(routedValue.dispatched, true, JSON.stringify(routedValue))
  await wait(async () => {
    const state = await product('snapshot')
    return state.value?.tasks?.plans?.some(item => item.planId === routedValue.planId && item.state === 'succeeded')
  })
  const library = await product('library.read', { payload: { botId: workerId, relativePath: 'routed-proof.txt' } })
  assert.equal(library.ok, true, JSON.stringify(library))
  assert.equal(library.value.content, 'Routed worker wrote this through its real AgentLoop.\n')
  checks.push('Bot routing: Main model tool -> owner settings -> real worker AgentLoop -> private library write -> durable successful task')
  const ownerRoute=await product('botRouting.dispatch',{payload:{text:`integration:routed-library:${workerId}`,pinnedBotId:workerId,requesterBotId:mainId,needs:{write:true},requestKey:'fixture-owner-route'}})
  assert.equal(ownerRoute.ok,true,JSON.stringify(ownerRoute));assert.equal(ownerRoute.value.accepted,true)
  assert.equal(ownerRoute.value.botId,workerId);assert.equal(ownerRoute.value.originBotId,mainId)
  await wait(async()=>{const value=(await product('snapshot')).value;return value.tasks.plans.some(item=>item.planId===ownerRoute.value.planId&&item.state==='succeeded')})
  await quiet()
  const beforeLookup = (await request('integration-probe')).calls.length
  const originalStatus = await product('botRouting.status', { payload: { requesterBotId: mainId, requestKey: 'fixture-owner-route' } })
  assert.equal(originalStatus.ok, true, JSON.stringify(originalStatus))
  assert.equal(originalStatus.value.found, true); assert.equal(originalStatus.value.planId, ownerRoute.value.planId)
  assert.equal(originalStatus.value.planState, 'succeeded')
  assert.deepEqual(originalStatus.value.packages.map(item => item.operationId), ownerRoute.value.packages.map(item => item.operationId))
  assert.equal((await request('integration-probe')).calls.length, beforeLookup)
  checks.push('Submission observation: the owner queries the original request key and durable operations with no new model turn, grant or task')
  const routedEvidence=new Database(join(home,'model-router/orchestration.sqlite'),{readonly:true})
  try{
    for(const planId of [routedValue.planId,ownerRoute.value.planId])assert.equal(routedEvidence.prepare('SELECT state FROM bot_routed_deliveries WHERE plan_id=?').get(planId)?.state,'delivered')
  }finally{routedEvidence.close()}
  checks.push('Bot routing: authenticated owner workbench channel dispatches to the same real worker; both model and owner plans deliver terminal results to Main')
  await api('send', { sessionId: workerId, text: 'integration:router-routes' }); current = await quiet()
  assert.ok(current.diagnostic.toolResults.some(item => item.name === 'model_router_routes' && !item.result.isError))
  checks.push('Default entry: worker executes permitted MR routing with the composed Bot grant')
  // N08: a direct MR consult inside the worker's admitted frame references its
  // run's invoice instead of opening a second Bot-side receipt.
  await api('send', { sessionId: workerId, text: 'integration:consult' }); current = await quiet()
  assert.ok(current.diagnostic.toolResults.some(item => item.name === 'model_router_consult' && !item.result.isError),
    JSON.stringify(current.diagnostic.toolResults.map(item => ({ name: item.name, isError: item.result?.isError, text: String(item.result?.content?.[0]?.text ?? item.result?.error ?? '').slice(0, 300) }))))
  checks.push('Default product: the worker consults through the MR path with the composed funding admission')
  await api('send', { sessionId: mainId, text: 'integration:delegate' }); await quiet()
  const exchange = await api('exchange', { a: mainId, b: workerId })
  assert.ok(exchange.some(row => row.from === mainId && row.to === workerId)); assert.ok(exchange.some(row => row.from === workerId && row.to === mainId))
  checks.push('Default entry: original DS Bot dispatch and result return survive migration')
  // The real product channel, not a fixture probe endpoint. The Host connection
  // admission refuses an unauthenticated request (401); the read-model channel's
  // own owner check (403) is the second layer for authenticated non-owner peers.
  const unauthenticated = await fetch(`${base}/api/bot-product`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'snapshot' }), signal: AbortSignal.timeout(30000) })
  assert.equal(unauthenticated.status, 401)
  checks.push('Product channel refuses an unauthenticated snapshot at the Host connection admission')
  const snapshot = (await product('snapshot')).value
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.mainBotId, mainId)
  assert.equal(snapshot.lifecycle.healthy, true)
  assert.ok(snapshot.bots.some(bot => bot.id === mainId && bot.main))
  assert.ok(snapshot.bots.some(bot => bot.id === workerId))
  assert.deepEqual([...snapshot.availableActions].sort(), ['binding.save','funding.account.save','machine.bind','machine.pair','machine.probe','machine.reconcile','machine.revoke','machine.secret','task.inspect','task.cancel','task.plan.submit','task.plan.cancel','task.reconcile','task.retry','usage.resolve',
    'botRoutingInspect','botRoutingDecide','botRouting.dispatch','botRouting.save','botRouting.status','library.list','library.read','library.write','library.upload','library.download','library.mkdir','library.remove','library.search',
    'machine.artifact','machine.desktop.act','machine.desktop.view','machine.desktop.open','machine.desktop.renew','machine.desktop.close',
    'roles.list','routine.list','routine.save','routine.remove','routine.run','routine.history','routine.cancel','routine.resolve'].sort())
  assert.equal(snapshot.bindings.status, 'available')
  const binding = snapshot.bindings.items.find(item => item.botId === workerId)
  assert.ok(binding.tools.includes('tool/model_router_routes'))
  assert.deepEqual(binding.modelRoutes, [{ provider: 'integration-gpt-fixture', model: 'gpt-fixture' }])
  checks.push('Product read model: real Bots, compiled grants and exact model routes in one snapshot')
  const rpc=async(method,authenticated=true)=>{
    const endpoint=`modelRouterOfficialTools/${method}`
    const response=await fetch(`${base}/api/${endpoint}`,{method:'POST',headers:{'content-type':'application/json',...(authenticated?{cookie}:{})},
      body:JSON.stringify({type:'client-request',rpcId:`product-${method}`,method:endpoint,payload:{args:{}}}),signal:AbortSignal.timeout(10000)})
    return {status:response.status,body:response.status===200?await response.json():null}
  }
  const ledger=await rpc('ledger');assert.equal(ledger.status,200);assert.equal(ledger.body.result.ok,true,JSON.stringify(ledger.body));assert.equal(ledger.body.result.value.ok,true)
  const mutate=await rpc('completeOnboarding');assert.equal(mutate.status,200);assert.equal(mutate.body.result.ok,true)
  assert.ok([401,403].includes((await rpc('ledger',false)).status))
  assert.ok([401,403].includes((await rpc('completeOnboarding',false)).status))
  checks.push('Authenticated owner uses the original advanced workbench through real Gateway; unauthenticated read and mutation stay denied')
  assert.equal(snapshot.machines.status,'available');assert.equal(snapshot.machines.items.length,0)
  // N09: every product section is wired now, so no section may report a blocked
  // placeholder; the actionable blocked text stays covered by unit fixtures.
  for (const section of ['bindings','botBindings','fundingAccounts','tasks','machines','usage']) {
    assert.equal(snapshot[section].status, 'available', section)
  }
  checks.push('Every product section is wired: no read-model section reports a blocked placeholder')
  // N07: the usage projection reads the single authority's durable receipts.
  const usage = snapshot.usage
  assert.equal(usage.status, 'available')
  assert.ok(usage.items.length > 0, JSON.stringify(usage.items))
  assert.ok(usage.items.some(item => item.botId === mainId && item.source === 'bot' && item.model === 'gpt-fixture'),
    JSON.stringify(usage.items.map(item => [item.botId, item.source, item.model])))
  assert.ok(usage.items.some(item => item.source === 'aux'), 'auxiliary calls keep their own receipt')
  for (const item of usage.items) {
    assert.ok(item.amountUsd === null || (typeof item.amountUsd === 'number' && item.amountUsd > 0), JSON.stringify(item))
    assert.ok(['bot', 'aux', 'mr-api', 'cli', 'review'].includes(item.source), item.source)
    assert.equal(item.billing, 'api')
  }
  assert.ok(usage.summary && typeof usage.summary.apiUsd === 'number' && usage.summary.apiUsd > 0, JSON.stringify(usage.summary))
  assert.equal(typeof usage.summary.unknownCount, 'number')
  assert.equal(typeof usage.summary.reservedUsd, 'number')
  checks.push('N07: the usage projection shows per-source receipts with exact models and a funding summary; unknown amounts stay null')
  // N08: the direct MR consult references its run's invoice instead of opening a
  // second Bot-side receipt, so exactly one linked receipt exists and the
  // per-source receipts agree with the funding summary.
  const mrReceipts = usage.items.filter(item => item.source === 'mr-api')
  assert.equal(mrReceipts.length, 1, JSON.stringify(usage.items.map(item => [item.source, item.runId])))
  assert.equal(mrReceipts[0].inputTokens, 11)
  assert.equal(mrReceipts[0].outputTokens, 5)
  const receiptTotal = usage.items.reduce((sum, item) => sum + (item.amountUsd ?? 0), 0)
  assert.ok(Math.abs(receiptTotal - usage.summary.apiUsd) <= 1e-12 + 1e-9 * Math.abs(usage.summary.apiUsd),
    `receipts ${receiptTotal} vs summary ${usage.summary.apiUsd}`)
  checks.push('N08: the MR consult writes exactly one linked receipt; receipts and the funding summary agree without double billing')
  // N06b: the configured state is visible in the read model; the fixture scope
  // is enabled and both bindings are available with their exact model routes.
  const accounts = snapshot.fundingAccounts
  assert.equal(accounts.status, 'available')
  const fixtureAccount = accounts.items.find(item => item.provider === 'integration-gpt-fixture')
  assert.ok(fixtureAccount, JSON.stringify(accounts.items))
  assert.equal(fixtureAccount.enabled, true)
  assert.equal(fixtureAccount.revision, 1)
  assert.equal(fixtureAccount.dailyLimitUsd, 10)
  const bindingsSection = snapshot.botBindings
  assert.equal(bindingsSection.status, 'available')
  for (const botId of [mainId, workerId]) {
    const item = bindingsSection.items.find(entry => entry.botId === botId)
    assert.ok(item, botId)
    assert.equal(item.status, 'available', botId)
    assert.equal(item.revision, 1, botId)
    assert.deepEqual(item.grant.modelRoutes, [{ provider: 'integration-gpt-fixture', model: 'gpt-fixture' }], botId)
  }
  assert.ok(bindingsSection.machines.some(m => m.location === 'local' && m.roots.some(r => r.rootId === rootId)))
  assert.ok(bindingsSection.fundingScopes.some(s => s.id === fixtureScope.id))
  checks.push('N06b: configured funding scope and Bot bindings are visible with exact model routes, the local machine entry and the scope catalog')
  // N09: managed Tasks reuse the same Bot/account admission. The CLI Bot is
  // bound to the host-verified official tool entry before its first turn.
  await api('send', { sessionId: mainId, text: 'integration:create-cli' }); current = await quiet()
  const cliBotId = current.state.bots.find(bot => bot.name === 'IntegrationCli')?.id
  assert.ok(cliBotId, JSON.stringify(Object.values(current.state.bots).map(bot => bot.name)))
  const savedCli = await product('binding.save', { payload: { botId: cliBotId, expectedRevision: 0,
    settings: { ...bindingSettings, officialTools: [{ toolId: 'codex', cliModel: 'gpt-fixture', mode: 'read-only' }] } } })
  assert.equal(savedCli.ok, true, JSON.stringify(savedCli))
  assert.equal(savedCli.value.status, 'available')
  const taskSection = async () => (await product('snapshot')).value.tasks
  const latestTask = async (backend, botId) => (await taskSection()).items.filter(item => item.backend === backend && item.botId === botId).sort((a, b) => b.createdAt - a.createdAt)[0]
  const settleTask = async (taskId, state) => {
    const deadline = Date.now() + 25_000
    for (;;) {
      const task = (await taskSection()).items.find(item => item.taskId === taskId)
      if (task && task.state === state) return task
      if (Date.now() > deadline) throw new Error(`Task ${taskId} never reached ${state}: ${JSON.stringify(task)}`)
      await sleep(100)
    }
  }
  const initialTasks = await taskSection()
  assert.equal(initialTasks.status, 'available')
  assert.deepEqual(initialTasks.backends.map(item => item.id).sort(), ['codex-read', 'mr-api', 'remote-command', 'remote-write'])
  await api('send', { sessionId: workerId, text: 'integration:task-run' }); await quiet()
  const runTask = await settleTask((await latestTask('mr-api', workerId)).taskId, 'succeeded')
  assert.equal(runTask.attempts, 1)
  assert.equal(runTask.legacyRunIds.length, 1)
  checks.push('N09: a Bot submits a managed MR Task through the configured admission; it succeeds with one attempt and one linked run')
  await api('send', { sessionId: workerId, text: 'integration:task-fail' }); await quiet()
  const failedTask = await settleTask((await latestTask('mr-api', workerId)).taskId, 'failed')
  assert.equal(failedTask.attempts, 1)
  assert.equal(failedTask.legacyRunIds.length, 1, 'the failed attempt keeps its original run reference')
  await api('send', { sessionId: workerId, text: `integration:task-retry:${failedTask.taskId}` }); await quiet()
  const retriedTask = await settleTask(failedTask.taskId, 'succeeded')
  assert.equal(retriedTask.attempts, 2)
  assert.equal(retriedTask.legacyRunIds.length, 1)
  checks.push('N09: an owner/Bot retry of a failed Task adds a linked attempt and succeeds without a second invoice')
  const inspected = await product('task.inspect', { payload: { botId: workerId, taskId: retriedTask.taskId } })
  assert.equal(inspected.ok, true, JSON.stringify(inspected))
  assert.equal(inspected.value.task.operationId, retriedTask.operationId)
  assert.equal(inspected.value.attempts.length, 2)
  assert.ok(inspected.value.timeline.items.some(item => item.kind === 'settled'))
  assert.equal((await product('task.inspect', { payload: { botId: mainId, taskId: retriedTask.taskId } })).ok, false)
  const deniedInspection = await fetch(`${base}/api/bot-product`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'task.inspect', payload: { botId: workerId, taskId: retriedTask.taskId } }), signal: AbortSignal.timeout(30000) })
  assert.equal(deniedInspection.status, 401)
  checks.push('Task timeline: owner reads both durable attempts under the original Bot; wrong Bot and unauthenticated reads are refused')
  await api('send', { sessionId: workerId, text: 'integration:task-cancel' }); await quiet()
  await settleTask((await latestTask('mr-api', workerId)).taskId, 'running')
  await api('send', { sessionId: workerId, text: `integration:task-cancel-task:${(await latestTask('mr-api', workerId)).taskId}` }); await quiet()
  const cancelledTask = await settleTask((await latestTask('mr-api', workerId)).taskId, 'cancelled')
  assert.equal(cancelledTask.legacyRunIds.length, 1)
  checks.push('N09: a running managed Task stays cancellable and its terminal state keeps the original run reference')
  // A binding that raises maxConcurrentTasks runs two managed tasks at once;
  // the conservative default of one stays covered by the native suite.
  const concurrency=await product('binding.save',{payload:{botId:workerId,expectedRevision:1,settings:{...bindingSettings,maxConcurrentTasks:2}}})
  assert.equal(concurrency.ok,true,JSON.stringify(concurrency))
  assert.equal(concurrency.value.settings.maxConcurrentTasks,2)
  await api('send', { sessionId: workerId, text: 'integration:task-parallel-a' }); await quiet()
  await settleTask((await latestTask('mr-api', workerId)).taskId, 'running')
  await api('send', { sessionId: workerId, text: 'integration:task-parallel-b' }); await quiet()
  const parallelB = await settleTask((await latestTask('mr-api', workerId)).taskId, 'running')
  const parallelA = (await taskSection()).items.find(item => item.taskId !== parallelB.taskId && item.botId === workerId && item.state === 'running')
  assert.ok(parallelA, JSON.stringify((await taskSection()).items.map(item => [item.taskId, item.state])))
  assert.equal(parallelA.attempts, 1)
  assert.equal(parallelB.attempts, 1)
  checks.push('N09: a binding with maxConcurrentTasks 2 runs two managed Tasks for one Bot at the same time')
  for (const task of [parallelA, parallelB]) {
    assert.equal((await product('task.cancel', { payload: { botId: workerId, taskId: task.taskId } })).value.state, 'cancelling')
    await settleTask(task.taskId, 'cancelled')
  }
  checks.push('N09: both concurrent Tasks stay cancellable through the real owner action')
  // Dependency plans enter through the real Main AgentLoop tool. The Host fixes
  // each package backend and executes it as its target Bot, not as the planner.
  const planById=async id=>(await taskSection()).plans.find(item=>item.planId===id)
  const settlePlan=async(id,state)=>wait(async()=>{const value=await planById(id);return value?.state===state&&value})
  await api('send',{sessionId:mainId,text:`integration:plan:success:${mainId}:${workerId}`});await quiet()
  const successPlan=await settlePlan('fixture-plan-success','succeeded')
  assert.equal(successPlan.packages.length,2);assert.ok(successPlan.packages.every(item=>item.state==='succeeded'&&item.attemptNumber===1))
  const plannedRows=(await taskSection()).items.filter(item=>item.planId===successPlan.planId)
  assert.equal(plannedRows.length,2);assert.ok(plannedRows.every(item=>item.legacyRunIds.length===1))
  const planReceipts=(await product('snapshot')).value.usage.items
  for(const row of plannedRows){const receipts=planReceipts.filter(item=>item.taskId===row.taskId);assert.equal(receipts.length,1);assert.equal(receipts[0].botId,row.botId);assert.equal(receipts[0].source,'mr-api')}
  checks.push('Scheduler: Main submits a dependency plan through the real tool; target Bots each run one admitted package and the join succeeds')
  const callsBeforeReplay=(await request('integration-probe')).calls.length
  const replay=await product('task.plan.submit',{payload:{botId:mainId,requestKey:'fixture-plan-success',plan:successPlan.plan}})
  assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.value.replayed,true)
  assert.deepEqual(replay.value.packages,successPlan.packages);assert.equal((await request('integration-probe')).calls.length,callsBeforeReplay)
  checks.push('Scheduler: duplicate plan delivery returns original package/attempt/operation IDs with zero new provider dispatch')
  const forbidden=await product('task.plan.submit',{payload:{botId:workerId,requestKey:'forbidden-plan',plan:{...successPlan.plan,taskId:'forbidden-plan',origin:{kind:'private',botId:workerId,sessionId:null}}}})
  assert.equal(forbidden.ok,false);assert.match(JSON.stringify(forbidden),/TASK_PLAN_TARGET_UNKNOWN/)
  checks.push('Scheduler: Worker cannot use a plan to target Main outside its Host-owned delegation scope')
  await api('send',{sessionId:mainId,text:`integration:plan:fail:${mainId}:${workerId}`});await quiet()
  const failedPlan=await settlePlan('fixture-plan-fail','failed')
  assert.equal(failedPlan.packages.find(item=>item.id==='blocked').state,'blocked')
  assert.equal(failedPlan.packages.find(item=>item.id==='blocked').result.code,'DEPENDENCY_FAILED')
  assert.equal(failedPlan.packages.find(item=>item.id==='independent').state,'succeeded')
  assert.ok(!(await request('integration-probe')).calls.some(item=>item.marker==='integration:never-dispatch'))
  checks.push('Scheduler: dependency failure blocks its successor without dispatch; the independent branch succeeds and the parent remains failed')
  await api('send',{sessionId:mainId,text:`integration:plan:cancel:${mainId}:${workerId}`});await quiet()
  const activePlan=await wait(async()=>{const value=await planById('fixture-plan-cancel');return value?.packages.filter(item=>item.state==='running').length===2&&value})
  const cancelPlan=await product('task.plan.cancel',{payload:{botId:mainId,planId:activePlan.planId}})
  assert.equal(cancelPlan.ok,true,JSON.stringify(cancelPlan));assert.equal(cancelPlan.value.state,'cancelling')
  const stoppedPlan=await settlePlan(activePlan.planId,'cancelled')
  assert.equal(stoppedPlan.packages.find(item=>item.id==='later').state,'skipped')
  assert.ok(stoppedPlan.packages.filter(item=>item.id!=='later').every(item=>item.state==='cancelled'))
  checks.push('Scheduler: owner cancels the whole multi-Bot plan, running branches clean up and the undispatched join is skipped')
  await api('send', { sessionId: mainId, text: `integration:task-status:${runTask.taskId}` }); current = await quiet()
  const crossBot = current.diagnostic.toolResults.filter(item => item.name === 'bot_task_status').at(-1)
  assert.ok(crossBot?.result.isError, JSON.stringify(crossBot))
  assert.match(JSON.stringify(crossBot.result), /TASK_NOT_FOUND/)
  checks.push('N09: another Bot cannot read or drive a Task it does not own')
  await api('send', { sessionId: workerId, text: 'integration:cli-task' }); current = await quiet()
  const cliDenied = current.diagnostic.toolResults.filter(item => item.name === 'bot_task_start').at(-1)
  assert.ok(cliDenied?.result.isError, JSON.stringify(cliDenied))
  assert.match(JSON.stringify(cliDenied.result), /TOOL_DENIED/)
  checks.push('N09: only a Bot granted the official CLI capability may submit the CLI backend')
  // A real machine Agent and MCP HTTP transport, owned by this probe. No real endpoint or model.
  await import('../remote-computer-agent/build.mjs')
  const {Agent,serve,CONTAINER_IMAGE,TOOL_NAMES}=await import('../remote-computer-agent/dist/index.mjs')
  const {default:http}=await import('node:http')
  browserServer=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Product browser fixture</title><h1>Scoped remote browser</h1>')})
  await new Promise(resolve=>browserServer.listen(0,'127.0.0.1',resolve))
  const browserOrigin=`http://127.0.0.1:${browserServer.address().port}`
  const agentRoot=join(run,'agent-root');await mkdir(agentRoot);await writeFile(join(agentRoot,'README.md'),'owned remote product fixture')
  const docker=process.platform==='linux'&&process.env.DSH_TEST_DOCKER==='1'
  if(docker)await chmod(agentRoot,0o777)
  const agentConfig={dataDir:join(run,'agent'),roots:{project:agentRoot},browserOrigins:[browserOrigin],browserExecutablePath:process.env.DSH_REMOTE_AGENT_BROWSER,browserProfiles:{work:join(run,'browser-profiles')},...(docker?{isolation:'container',container:{dockerExecutable:'/usr/bin/docker',image:CONTAINER_IMAGE,executables:{node:'/usr/local/bin/node'}}}:{})}
  remoteAgent=new Agent(agentConfig,Database)
  const paired=remoteAgent.store.pair('integration-host',{botIds:[mainId,workerId],roots:['project'],tools:TOOL_NAMES})
  remoteServer=await serve(remoteAgent,{port:0})
  const secret=await product('machine.secret',{payload:{name:'REMOTE_AGENT_PRODUCT_TEST',value:paired.token}})
  assert.equal(secret.ok,true,JSON.stringify(secret));assert.equal(secret.value.secretRef,'ds-secret/REMOTE_AGENT_PRODUCT_TEST')
  assert.equal(JSON.stringify(secret).includes(paired.token),false)
  const sharedSecret=await request('bot',{endpoint:'secret-update',payload:{name:'REMOTE_AGENT_PRODUCT_TEST',scope:'all'}})
  assert.equal(sharedSecret.ok,false,'existing DS secret UI cannot offer machine control credentials to Bot shells')
  const saved=await product('machine.pair',{payload:{name:'Product test Agent',machineId:paired.machineId,endpoint:`http://127.0.0.1:${remoteServer.address.port}`,secretRef:secret.value.secretRef,probeBotId:workerId,roots:['project'],tools:TOOL_NAMES,expectedRevision:0}})
  assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.value.status,'online')
  assert.equal(saved.value.mainBinding?.status,'available',JSON.stringify(saved.value.mainBinding))
  const automaticMainGrant=saved.value.bindings.find(item=>item.botId===mainId)
  assert.ok(automaticMainGrant&&!automaticMainGrant.revoked&&automaticMainGrant.roots.includes('project'))
  assert.ok(TOOL_NAMES.every(tool=>automaticMainGrant.tools.includes(tool)))
  await api('send',{sessionId:mainId,text:`integration:remote-read:${paired.machineId}`});current=await quiet()
  const mainRemoteRead=current.diagnostic.toolResults.filter(item=>item.name==='remote_computer_read'&&item.agentId===mainId).at(-1)
  assert.ok(mainRemoteRead&&!mainRemoteRead.result.isError,JSON.stringify(mainRemoteRead))
  assert.match(JSON.stringify(mainRemoteRead.result),/owned remote product fixture|b3duZWQgcmVtb3RlIHByb2R1Y3QgZml4dHVyZQ/)
  checks.push('Machine pairing automatically binds Main at its own revision; Main immediately reads through its real AgentLoop without another manual grant')
  let granted=await product('machine.bind',{payload:{machineId:paired.machineId,botId:workerId,expectedRevision:0,roots:['project'],tools:['machine_ping','fs_read'],mode:'read-only'}})
  assert.equal(granted.ok,true,JSON.stringify(granted));assert.equal(granted.value.remoteRevoked,true)
  const read=await product('machine.probe',{payload:{machineId:paired.machineId,botId:workerId,rootId:'project',relativePath:'README.md'}})
  assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.value.diagnostic,'read-confirmed');assert.equal(read.value.content,undefined)
  await api('send',{sessionId:workerId,text:`integration:remote-read:${paired.machineId}`});current=await quiet()
  const remoteResult=current.diagnostic.toolResults.filter(item=>item.name==='remote_computer_read').at(-1)
  assert.ok(remoteResult&&!remoteResult.result.isError,JSON.stringify(remoteResult))
  assert.match(JSON.stringify(remoteResult.result),/owned remote product fixture|b3duZWQgcmVtb3RlIHByb2R1Y3QgZml4dHVyZQ/)
  checks.push('Default product: owner secretRef pairing and Bot-scoped real MCP read work through the real AgentLoop')
  const bound=(await product('snapshot')).value.bindings.items.find(item=>item.botId===workerId)
  assert.ok(bound.tools.includes('remote/fs_read'))
  const revoke=await product('machine.revoke',{payload:{machineId:paired.machineId,botId:workerId,expectedRevision:1}})
  assert.equal(revoke.ok,true,JSON.stringify(revoke));assert.equal(revoke.value.remoteRevoked,true)
  const denied=await product('machine.probe',{payload:{machineId:paired.machineId,botId:workerId,rootId:'project',relativePath:'README.md'}})
  assert.equal(denied.ok,false);assert.equal(denied.error.code,'MACHINE_BOT_DENIED')
  checks.push('Default product: owner revocation removes Bot grant, invalidates remote tickets and refuses further reads')
  granted=await product('machine.bind',{payload:{machineId:paired.machineId,botId:workerId,expectedRevision:2,roots:['project'],tools:['machine_ping','fs_read'],mode:'read-only'}})
  assert.equal(granted.ok,true,JSON.stringify(granted))
  const ioBefore=(await product('snapshot')).value.usage.items.filter(row=>row.source==='bot').length
  granted=await product('machine.bind',{payload:{machineId:paired.machineId,botId:workerId,expectedRevision:3,roots:['project'],tools:['machine_ping','fs_read','fs_write','operation_status','operation_cancel'],mode:'workspace-write'}})
  assert.equal(granted.ok,true,JSON.stringify(granted));assert.ok((await product('snapshot')).value.bindings.items.find(item=>item.botId===workerId).tools.includes('tool/remote_computer_write'))
  await api('send',{sessionId:workerId,text:`integration:remote-write:${paired.machineId}`});current=await quiet()
  const writeResult=current.diagnostic.toolResults.filter(item=>item.name==='remote_computer_write').at(-1);assert.ok(writeResult&&!writeResult.result.isError,JSON.stringify(writeResult))
  const fileTask=await settleTask((await latestTask('remote-write',workerId)).taskId,'succeeded');assert.equal(await readFile(join(agentRoot,'managed.txt'),'utf8'),'owned remote product fixture write');assert.equal(fileTask.machineId,paired.machineId);assert.equal(fileTask.legacyRunIds.length,0)
  checks.push('Remote write: owner explicitly grants write/status/cancel; the real AgentLoop submits a tracked scoped file Task under the actual machine/root lock')
  const ioAfter=(await product('snapshot')).value.usage.items;assert.ok(ioAfter.filter(row=>row.source==='bot').length>ioBefore);assert.equal(ioAfter.filter(row=>row.taskId===fileTask.taskId).length,0)
  checks.push('Remote write: the outer Bot model turn keeps its normal receipt while filesystem IO creates no fake model/CLI invoice')
  await api('send',{sessionId:workerId,text:`integration:remote-write:${paired.machineId}`});await quiet();const replayedFile=await latestTask('remote-write',workerId);assert.equal(replayedFile.taskId,fileTask.taskId);assert.equal(replayedFile.operationId,fileTask.operationId);assert.equal(remoteAgent.store.db.prepare("SELECT count(*) n FROM operations WHERE tool='fs_write'").get().n,1)
  checks.push('Remote write: a repeated real tool command keeps the original Task/operation and the Agent writes exactly once')
  granted=await product('machine.bind',{payload:{machineId:paired.machineId,botId:workerId,expectedRevision:4,roots:['project'],tools:TOOL_NAMES,mode:'workspace-write'}})
  assert.equal(granted.ok,true,JSON.stringify(granted))
  await api('send',{sessionId:workerId,text:`integration:remote-command:${paired.machineId}`});current=await quiet()
  const commandTaskId=await wait(async()=>(await latestTask('remote-command',workerId))?.taskId)
  const commandTask=await settleTask(commandTaskId,docker?'succeeded':'failed')
  const commandResult=commandTask.result,commandRemote=commandResult.remote
  assert.ok(commandRemote,JSON.stringify(commandTask))
  if(docker){
    assert.equal(commandRemote.exitCode,0);assert.equal(commandRemote.stopConfirmed,true);assert.equal(commandRemote.possiblyApplied,true)
    assert.equal(remoteAgent.store.db.prepare("SELECT count(*) n FROM operations WHERE tool='container_command_v1'").get().n,1)
  }else{
    assert.equal(commandResult.code,'CONTAINER_COMMAND_UNAVAILABLE');assert.equal(commandRemote.notStarted,true);assert.equal(commandRemote.possiblyApplied,false);assert.equal(commandRemote.stopConfirmed,true)
    assert.equal(remoteAgent.store.db.prepare("SELECT count(*) n FROM operations WHERE tool='container_command_v1'").get().n,1)
  }
  assert.equal(remoteAgent.workspaces.list().length,0)
  checks.push(docker?'Remote command: the default product dispatches an approved argv alias into the real container and returns bounded stop evidence':'Remote command: a non-container Agent settles never-started with no native fallback or workspace lock')
  await request('integration-probe',{action:'browser-origin',value:browserOrigin})
  await sleep(5100)
  await api('send',{sessionId:workerId,text:`integration:remote-browser:${paired.machineId}`});current=await quiet()
  const browserActions=current.diagnostic.toolResults.filter(item=>item.name==='remote_computer_browser')
  assert.equal(browserActions.length,3,JSON.stringify(browserActions));assert.ok(browserActions.every(item=>!item.result.isError&&!item.result.value.operationStatus),JSON.stringify(browserActions))
  const openedBrowser=browserActions[0].result.value,scriptedBrowser=browserActions[1].result.value,closedBrowser=browserActions[2].result.value
  assert.equal(scriptedBrowser.result,'Product browser fixture',JSON.stringify(browserActions));assert.equal(closedBrowser.closed,true)
  assert.equal(openedBrowser.taskId,scriptedBrowser.taskId);assert.equal(openedBrowser.attemptId,closedBrowser.attemptId)
  assert.equal(remoteAgent.store.db.prepare("SELECT count(*) n FROM operations WHERE tool LIKE 'browser_%'").get().n,3)
  assert.equal(remoteAgent.store.db.prepare("SELECT count(*) n FROM operations WHERE tool LIKE 'browser_%' AND status='succeeded'").get().n,3)
  checks.push('Remote browser: the default product AgentLoop opens, scripts and closes one scoped remote browser under the original task/attempt')
  const callsBeforeCredential=(await request('integration-probe')).calls.length
  await request('integration-probe',{action:'credential-outage'})
  await api('send',{sessionId:workerId,text:'integration:router-routes'});await quiet()
  const credentialFailure=await request('integration-probe')
  assert.equal(credentialFailure.calls.length,callsBeforeCredential,'a missing key produces no provider stream or fallback model')
  assert.equal(credentialFailure.credential.failures,1)
  const routeCallsBeforeRestore=credentialFailure.calls.filter(call=>call.sessionId===workerId&&call.marker==='integration:router-routes').length
  assert.match(String(await api('diagnostics-log')),/FIXTURE_CREDENTIAL_UNAVAILABLE: missing key for integration-gpt-fixture\/gpt-fixture/)
  const credentialUnresolved=(await product('snapshot')).value.usage.unresolved.filter(item=>item.botId===workerId&&item.packageId==='inference')
  assert.equal(credentialUnresolved.length,1,JSON.stringify(credentialUnresolved))
  const credentialWaived=await product('usage.resolve',{payload:{botId:workerId,runId:credentialUnresolved[0].runId,packageId:'inference',kind:'waive',note:'离线凭据故障：首字节前失败，按 fixture 零费用显式对账。'}})
  assert.equal(credentialWaived.ok,true,JSON.stringify(credentialWaived));assert.equal(credentialWaived.value.costUsd,0)
  await request('integration-probe',{action:'credential-restore'})
  await api('send',{sessionId:workerId,text:'integration:router-routes'});current=await quiet()
  const restoredRoute=current.diagnostic.toolResults.filter(item=>item.name==='model_router_routes').at(-1)
  assert.equal(restoredRoute.result.isError,false,JSON.stringify(restoredRoute))
  assert.ok(current.diagnostic.calls.filter(call=>call.sessionId===workerId&&call.marker==='integration:router-routes').length>routeCallsBeforeRestore,'credential recovery must produce a fresh original-model turn')
  assert.ok(current.diagnostic.calls.every(call=>`${call.provider}/${call.model}`==='integration-gpt-fixture/gpt-fixture'))
  checks.push('Strict model: a live missing-key failure pauses with an actionable original-route error and zero fallback; explicit receipt reconciliation plus credential recovery resumes the same model')
  // N06b: disabling the funding scope blocks the bindings; the next model turn
  // is refused with zero provider dispatch.
  const callsBefore=(await request('integration-probe')).calls.length
  const disabledAccount=await product('funding.account.save',{payload:{scopeId:fixtureScope.id,expectedRevision:1,enabled:false,dailyLimitUsd:10,monthlyLimitUsd:100}})
  assert.equal(disabledAccount.ok,true,JSON.stringify(disabledAccount))
  assert.equal(disabledAccount.value.enabled,false)
  await api('send',{sessionId:workerId,text:'integration:router-routes'});await quiet()
  assert.equal((await request('integration-probe')).calls.length,callsBefore,'a disabled funding scope refuses the model turn with zero provider dispatch')
  const blockedWorker=(await product('snapshot')).value.botBindings.items.find(item=>item.botId===workerId)
  assert.equal(blockedWorker.status,'blocked')
  checks.push('N06b: a disabled funding scope blocks the bindings and the next model turn dispatches nothing')
  // N09: the managed CLI task runs last because an unconfirmed receipt is a
  // fail-closed unknown: it blocks that Bot and its shared account scope until
  // an owner reconciles it, which is exactly the manual-review gate.
  const reEnabled=await product('funding.account.save',{payload:{scopeId:fixtureScope.id,expectedRevision:2,enabled:true,dailyLimitUsd:10,monthlyLimitUsd:100}})
  assert.equal(reEnabled.ok,true,JSON.stringify(reEnabled));assert.equal(reEnabled.value.enabled,true)
  await api('send',{sessionId:cliBotId,text:'integration:cli-task'});await quiet()
  const cliTask=await settleTask((await latestTask('codex-read',cliBotId)).taskId,'needs-reconciliation')
  assert.equal(cliTask.attempts,1)
  assert.equal(cliTask.legacyRunIds.length,1)
  assert.match(cliTask.legacyRunIds[0],/^cli-/)
  // A Bot whose receipt is unknown cannot spend again, so recovery runs through
  // the real owner action on the owning Bot's own subject.
  const reconciled=await product('task.reconcile',{payload:{botId:cliBotId,taskId:cliTask.taskId,requestKey:'cli-reconcile-1'}})
  assert.equal(reconciled.ok,true,JSON.stringify(reconciled))
  assert.equal(reconciled.value.state,'needs-reconciliation')
  assert.equal(reconciled.value.reconciliation.outcome,'unknown')
  assert.equal((await product('task.reconcile',{payload:{botId:cliBotId,taskId:cliTask.taskId,requestKey:'cli-reconcile-1'}})).value.replayed,true)
  checks.push('N09: a contract-level CLI Task writes its own linked run and stays unknown until an owner confirms it; the owner action is idempotent')
  const taskSnapshot=(await product('snapshot')).value
  const cliReceipts=taskSnapshot.usage.items.filter(item=>item.source==='cli')
  assert.equal(cliReceipts.length,1,JSON.stringify(taskSnapshot.usage.items.map(item=>[item.source,item.taskId])))
  assert.equal(cliReceipts[0].billing,'api')
  assert.equal(cliReceipts[0].status,'unknown')
  assert.equal(cliReceipts[0].inputTokens,11)
  assert.equal(cliReceipts[0].outputTokens,5)
  assert.ok(taskSnapshot.usage.items.filter(item=>item.source==='mr-api').length>=2,'managed MR dispatches keep their own linked receipts')
  assert.ok(taskSnapshot.usage.summary.unknownCount>=1,JSON.stringify(taskSnapshot.usage.summary))
  const taskReceiptTotal=taskSnapshot.usage.items.reduce((sum,item)=>sum+(item.amountUsd??0),0)
  // An unconfirmed receipt is held out of the spend total and counted as
  // unknown, so only the confirmed receipts must reconcile with the summary.
  const confirmedTotal=taskSnapshot.usage.items.filter(item=>item.status!=='unknown').reduce((sum,item)=>sum+(item.amountUsd??0),0)
  const unknownTotal=taskSnapshot.usage.items.filter(item=>item.status==='unknown').reduce((sum,item)=>sum+(item.amountUsd??0),0)
  assert.ok(unknownTotal>0,'the unconfirmed CLI receipt carries its own usage')
  assert.ok(Math.abs(confirmedTotal-taskSnapshot.usage.summary.apiUsd)<=1e-12+1e-9*Math.abs(taskSnapshot.usage.summary.apiUsd),
    `confirmed receipts ${confirmedTotal} vs summary ${taskSnapshot.usage.summary.apiUsd}`)
  assert.ok(Math.abs(taskReceiptTotal-taskSnapshot.usage.summary.apiUsd-unknownTotal)<=1e-12+1e-9*Math.abs(taskSnapshot.usage.summary.apiUsd),
    `receipts ${taskReceiptTotal} vs summary ${taskSnapshot.usage.summary.apiUsd} plus unknown ${unknownTotal}`)
  checks.push('N09: managed Task receipts land in the single funding authority; the unconfirmed CLI receipt is held out of the spend total and counted as unknown')
  // The unknown receipt blocks the CLI Bot's own model turns until an owner
  // resolves it, so its later dispatch attempt spends nothing.
  const cliCallsBefore=(await request('integration-probe')).calls.length
  await api('send',{sessionId:cliBotId,text:'integration:router-routes'});await quiet()
  assert.equal((await request('integration-probe')).calls.length,cliCallsBefore,'an unknown receipt refuses the Bot with zero provider dispatch')
  checks.push('N09: an unconfirmed receipt keeps its Bot refused with zero provider dispatch until an owner resolves it')
  // The owner resolves the unconfirmed package through the real owner action;
  // the waive is auditable on the run and unblocks the Bot's own admission.
  const resolveBefore=(await product('snapshot')).value
  const resolveTarget=resolveBefore.usage.unresolved
  assert.equal(resolveTarget.length,1,JSON.stringify(resolveTarget))
  assert.equal(resolveTarget[0].botId,cliBotId)
  assert.equal(resolveTarget[0].packageId,'cli')
  assert.equal(resolveTarget[0].billing,'api')
  const waived=await product('usage.resolve',{payload:{botId:cliBotId,runId:resolveTarget[0].runId,packageId:'cli',kind:'waive',note:'离线探针：厂商账单尚未核对，按零费用放行并留痕。'}})
  assert.equal(waived.ok,true,JSON.stringify(waived))
  assert.equal(waived.value.kind,'waive')
  assert.equal(waived.value.costUsd,0)
  const deniedResolve=await product('usage.resolve',{payload:{botId:workerId,runId:resolveTarget[0].runId,packageId:'cli',kind:'waive',note:'越权解决。'}})
  assert.equal(deniedResolve.ok,false)
  assert.equal(deniedResolve.error.code,'ROUTER_RUN_OWNER_MISMATCH')
  const repeatResolve=await product('usage.resolve',{payload:{botId:cliBotId,runId:resolveTarget[0].runId,packageId:'cli',kind:'waive',note:'重复解决。'}})
  assert.equal(repeatResolve.ok,false)
  assert.equal(repeatResolve.error.code,'ROUTER_PACKAGE_ALREADY_RESOLVED')
  const afterResolve=(await product('snapshot')).value
  assert.equal(afterResolve.usage.unresolved.length,0,JSON.stringify(afterResolve.usage.unresolved))
  assert.equal(afterResolve.usage.summary.unknownCount,0,JSON.stringify(afterResolve.usage.summary))
  const resolvedReceipt=afterResolve.usage.items.find(item=>item.source==='cli')
  assert.deepEqual(resolvedReceipt.resolution.kind,'waive')
  assert.equal(resolvedReceipt.resolution.costUsd,0)
  assert.match(resolvedReceipt.resolution.note,/离线探针/)
  const resolvedTotal=afterResolve.usage.items.reduce((sum,item)=>sum+(item.amountUsd??0),0)
  assert.ok(Math.abs(resolvedTotal-afterResolve.usage.summary.apiUsd)<=1e-12+1e-9*Math.abs(afterResolve.usage.summary.apiUsd),
    `resolved receipts ${resolvedTotal} vs summary ${afterResolve.usage.summary.apiUsd}`)
  const cliCallsAfter=(await request('integration-probe')).calls.length
  current=await api('send',{sessionId:cliBotId,text:'integration:router-routes'}).then(()=>quiet())
  const cliDispatch=(await request('integration-probe')).calls.length
  assert.ok(cliDispatch>cliCallsAfter,'a resolved unknown unblocks the Bot with a real provider dispatch')
  const cliRoute=current.diagnostic.toolResults.filter(item=>item.name==='model_router_routes').at(-1)
  assert.ok(cliRoute&&!cliRoute.result.isError,JSON.stringify(cliRoute))
  checks.push('N09: the owner resolves an unconfirmed receipt through a real owner action; the waive is auditable on the run and the Bot spends again')
  const workerBeforeRotation=current.state.bots.find(bot=>bot.id===workerId)
  const workerPrivate=join(run,'worker-private'),cliPrivate=join(run,'cli-private');await mkdir(workerPrivate);await mkdir(cliPrivate)
  await api('update-bot',{id:workerId,workDir:workerPrivate});await api('update-bot',{id:cliBotId,workDir:cliPrivate});current=await quiet()
  const workerAfterRotation=current.state.bots.find(bot=>bot.id===workerId),cliAfterRotation=current.state.bots.find(bot=>bot.id===cliBotId)
  assert.notEqual(workerAfterRotation.sessionId,workerBeforeRotation.sessionId)
  assert.equal(workerAfterRotation.model,'integration-gpt-fixture/gpt-fixture');assert.equal(cliAfterRotation.model,'integration-gpt-fixture/gpt-fixture')
  assert.equal((await product('snapshot')).value.botBindings.items.find(item=>item.botId===workerId).status,'available')
  await api('send',{sessionId:workerAfterRotation.sessionId,text:'integration:private-write'});await quiet()
  await api('send',{sessionId:workerAfterRotation.sessionId,text:'integration:private-remember'});current=await quiet()
  const remembered=current.diagnostic.toolResults.filter(item=>item.agentId===workerAfterRotation.sessionId&&item.name==='remember').at(-1)
  assert.equal(remembered.result.isError,false,JSON.stringify(remembered))
  await api('send',{sessionId:cliAfterRotation.sessionId,text:'integration:private-recall'});await quiet()
  await api('send',{sessionId:cliAfterRotation.sessionId,text:`integration:private-read-other:${join(workerPrivate,'private.md')}`});await quiet()
  await api('send',{sessionId:cliAfterRotation.sessionId,text:'integration:private-shell-read'});await quiet()
  await api('send',{sessionId:workerAfterRotation.sessionId,text:'integration:private-recall'});await quiet()
  await api('send',{sessionId:workerAfterRotation.sessionId,text:'integration:private-read-own'});current=await quiet()
  const latestTool=(name,sessionId)=>current.diagnostic.toolResults.filter(item=>item.name===name&&item.agentId===sessionId).at(-1)
  assert.match(JSON.stringify(latestTool('recall',workerAfterRotation.sessionId).result),/bot-private-memory-sentinel/)
  assert.match(latestTool('recall',cliAfterRotation.sessionId).result.value,/^Nothing in your memory and the team memory mentions/)
  assert.equal(latestTool('read',cliAfterRotation.sessionId).result.isError,true,JSON.stringify(latestTool('read',cliAfterRotation.sessionId)))
  assert.equal(latestTool('pwsh',cliAfterRotation.sessionId).result.isError,true,JSON.stringify(latestTool('pwsh',cliAfterRotation.sessionId)))
  assert.match(JSON.stringify(latestTool('pwsh',cliAfterRotation.sessionId).result),/BOT_NATIVE_EXECUTION_DENIED/)
  assert.equal(latestTool('read',workerAfterRotation.sessionId).result.isError,false,JSON.stringify(latestTool('read',workerAfterRotation.sessionId)))
  assert.equal(await readFile(join(cliPrivate,'private.md'),'utf8').catch(()=>null),null)
  checks.push('Private state: same-model non-Main Bots keep memory and files separate; no ungranted shell bypass; explicit task input remains the only shared content')
  checks.push('Session rotation: changing a Bot workspace creates a fresh Session with the same Bot/model grant and its own memory, never a shared CLI profile')
  const scheduledCalls=async()=>(await request('integration-probe')).calls.filter(call=>call.marker==='integration:scheduled-check')
  const firstSchedule=await api('schedule-create',{target:workerId,title:'one-shot-check',prompt:'integration:scheduled-check',when:{kind:'at',at:new Date(Date.now()+4000).toISOString()}})
  assert.equal(firstSchedule.available,true);assert.equal(firstSchedule.tasks.length,1)
  const rotatedWorkspace=join(run,'schedule-workspace');await mkdir(rotatedWorkspace)
  await api('update-bot',{id:workerId,workDir:rotatedWorkspace});current=await quiet()
  const scheduleOwner=current.state.bots.find(bot=>bot.id===workerId),movedSchedules=await api('schedules')
  assert.equal(movedSchedules.tasks.length,1);assert.equal(movedSchedules.tasks[0].sessionId,scheduleOwner.sessionId)
  await wait(async()=>(await scheduledCalls()).length===1)
  await sleep(2500);assert.equal((await scheduledCalls()).length,1,'one-shot schedule must not repeat on a later scheduler tick')
  checks.push('Schedules: one-shot execution follows the stable Bot through Session rotation and does not duplicate on a later tick')
  await api('schedule-create',{target:workerId,title:'budget-blocked-check',prompt:'integration:scheduled-check',when:{kind:'at',at:new Date(Date.now()+4000).toISOString()}})
  const accountBeforeBlock=(await product('snapshot')).value.fundingAccounts.items.find(item=>item.id===fixtureScope.id)
  const scheduleCallsBeforeBlock=await scheduledCalls()
  const scheduleBlocked=await product('funding.account.save',{payload:{scopeId:fixtureScope.id,expectedRevision:accountBeforeBlock.revision,enabled:false,dailyLimitUsd:10,monthlyLimitUsd:100}})
  assert.equal(scheduleBlocked.ok,true,JSON.stringify(scheduleBlocked))
  await sleep(5500);assert.equal((await scheduledCalls()).length,scheduleCallsBeforeBlock.length,'a disabled funding scope must be rechecked at execution time')
  const scheduleEnabled=await product('funding.account.save',{payload:{scopeId:fixtureScope.id,expectedRevision:accountBeforeBlock.revision+1,enabled:true,dailyLimitUsd:10,monthlyLimitUsd:100}})
  assert.equal(scheduleEnabled.ok,true,JSON.stringify(scheduleEnabled))
  await api('schedule-create',{target:workerId,title:'budget-restored-check',prompt:'integration:scheduled-check',when:{kind:'at',at:new Date(Date.now()+4000).toISOString()}})
  await wait(async()=>(await scheduledCalls()).length===1)
  checks.push('Schedules: execution rechecks model/funding authority and resumes only after explicit restoration')
  await stop('first')
  {
  const ledger=new Database(join(home,'model-router/orchestration.sqlite'),{readonly:true})
  try{
    assert.equal(ledger.pragma('user_version',{simple:true}),5)
    const admissions=ledger.prepare("SELECT i.*,a.started_ms,o.delivered_ms,p.current_attempt FROM task_admission_intents i JOIN attempts a ON a.id=i.attempt_id JOIN packages p ON p.id=a.package_id JOIN operations op ON op.attempt_id=a.id JOIN task_outbox o ON o.operation_id=op.id WHERE i.state='committed'").all()
    assert.ok(admissions.length>=3)
    assert.equal(ledger.prepare("SELECT count(*) AS n FROM attempts a JOIN packages p ON p.id=a.package_id JOIN tasks t ON t.id=p.task_id WHERE a.started_ms IS NOT NULL AND json_extract(t.payload,'$.backend') IN ('mr-api','codex-read') AND NOT EXISTS(SELECT 1 FROM task_admission_intents i WHERE i.attempt_id=a.id AND i.state='committed')").get().n,0)
    const io=ledger.prepare("SELECT t.id,op.id operation_id,o.delivered_ms,r.reference FROM tasks t JOIN packages p ON p.task_id=t.id JOIN attempts a ON a.id=p.current_attempt JOIN operations op ON op.attempt_id=a.id JOIN task_outbox o ON o.operation_id=op.id JOIN task_execution_refs r ON r.attempt_id=a.id WHERE json_extract(t.payload,'$.backend')='remote-write'").all()
    assert.equal(io.length,1);assert.equal(io[0].id,fileTask.taskId);assert.ok(io[0].delivered_ms!==null);assert.equal(JSON.parse(io[0].reference).operationId,fileTask.operationId);assert.equal(ledger.prepare('SELECT count(*) n FROM router_model_calls WHERE task_id=?').get(fileTask.taskId).n,0)
    let mrAdmissions=0,cliAdmissions=0
    for(const row of admissions){
      assert.ok(row.started_ms!==null&&row.delivered_ms!==null)
      const reference=JSON.parse(row.reference)
      assert.deepEqual(JSON.parse(ledger.prepare('SELECT reference FROM task_execution_refs WHERE attempt_id=?').get(row.attempt_id).reference),reference)
      const run=ledger.prepare('SELECT payload FROM router_runs WHERE id=?').get(reference.runId)
      assert.ok(run,reference.runId)
      // Explicit MR retries retain the same invoice/run ID and supersede its
      // current marker. Historical attempt refs remain immutable in the journal.
      if(row.current_attempt===row.attempt_id)assert.deepEqual(JSON.parse(run.payload).managedExecution,reference.marker)
      if(reference.kind==='cli-run'){
        cliAdmissions++;assert.equal(ledger.prepare('SELECT count(*) AS n FROM router_model_calls WHERE run_id=?').get(reference.runId).n,1)
      }else mrAdmissions++
    }
    assert.ok(mrAdmissions>=2&&cliAdmissions===1)
  }finally{ledger.close()}
  }
  checks.push('Atomic admission: default MR and CLI retain committed intents in journal5, matching original runs/references/outbox, and one CLI receipt after real Host execution')
  launch(); await login(); await ready(); await quiet()
  const restored = (await product('snapshot')).value
  assert.equal(restored.mainBotId, mainId)
  assert.ok(restored.bots.some(bot => bot.id === workerId))
  const coldFileTask=restored.tasks.items.find(item=>item.taskId===fileTask.taskId);assert.equal(coldFileTask.state,'succeeded');assert.equal(coldFileTask.operationId,fileTask.operationId);assert.equal(remoteAgent.store.db.prepare("SELECT count(*) n FROM operations WHERE tool='fs_write'").get().n,1)
  checks.push('Remote write: real cold Host restart retains the original successful file Task/operation without another write')
  for(const previous of [successPlan,failedPlan,stoppedPlan]){
    const next=restored.tasks.plans.find(item=>item.planId===previous.planId)
    assert.equal(next.state,previous.state);assert.deepEqual(next.packages.map(item=>[item.id,item.attemptId,item.operationId,item.dependsOn]),previous.packages.map(item=>[item.id,item.attemptId,item.operationId,item.dependsOn]))
  }
  checks.push('Scheduler: cold Host startup preserves dependency edges, terminal plans and original execution identities')
  const coldCalls=(await request('integration-probe')).calls.length
  const coldStatus = await product('botRouting.status', { payload: { requesterBotId: mainId, requestKey: 'fixture-owner-route' } })
  assert.equal(coldStatus.ok, true, JSON.stringify(coldStatus)); assert.deepEqual(coldStatus.value, originalStatus.value)
  assert.equal((await request('integration-probe')).calls.length, coldCalls)
  checks.push('Submission observation: cold Host startup finds the same original plan and operations without replaying it')
  const coldReplay=await product('task.plan.submit',{payload:{botId:mainId,requestKey:'fixture-plan-success',plan:successPlan.plan}})
  assert.equal(coldReplay.ok,true,JSON.stringify(coldReplay));assert.equal(coldReplay.value.replayed,true)
  assert.deepEqual(coldReplay.value.packages.map(item=>item.operationId),successPlan.packages.map(item=>item.operationId))
  assert.equal((await request('integration-probe')).calls.length,coldCalls)
  const forgedOrigin=await product('task.plan.submit',{payload:{botId:mainId,requestKey:'bad-cold-origin',plan:{...successPlan.plan,taskId:'bad-cold-origin',origin:{kind:'private',botId:mainId,sessionId:workerId}}}})
  assert.equal(forgedOrigin.ok,false);assert.match(JSON.stringify(forgedOrigin),/TASK_PLAN_ORIGIN_MISMATCH/)
  checks.push('Scheduler: owner cold replay preserves original operations without a live Agent or provider dispatch; a forged private origin stays denied')
  assert.equal(restored.bindings.status, 'available')
  assert.equal(restored.machines.items[0].id,paired.machineId)
  assert.ok(restored.bindings.items.find(item=>item.botId===workerId).tools.includes('remote/fs_read'))
  const afterRestart=await product('machine.probe',{payload:{machineId:paired.machineId,botId:workerId,rootId:'project'}})
  assert.equal(afterRestart.ok,true,JSON.stringify(afterRestart))
  checks.push('Fresh host reconstructs stable Bot identity and the composed product read model')
  if(process.argv.includes('--serve')){
    const url=output().match(new RegExp(`${base.replaceAll('.', '\\.')}\\/\\?token=[^\\s]+`))?.[0]
    await writeFile(join(run,'browser-access.json'),JSON.stringify({url,runDirectory:run,pid:child.pid},null,2))
    process.stdout.write(JSON.stringify({status:'ready-for-browser',runDirectory:run,url})+'\n')
    clearTimeout(timer);timer=setTimeout(()=>killProcessTree(child),15*60_000)
    const deadline=Date.now()+14*60_000
    while(Date.now()<deadline){if(await readFile(join(run,'stop'),'utf8').then(value=>value.trim()==='stop',()=>false))break;await sleep(250)}
  }
  summary = { status: 'passed', level: 'actual-host-offline-default-composition', checks, snapshotSections: Object.fromEntries(['bindings', 'botBindings', 'fundingAccounts', 'tasks', 'machines', 'usage'].map(key => [key, snapshot[key].status])),
    restored: { mainBotId: restored.mainBotId, bots: restored.bots.length, bindings: restored.bindings.status }, source, sdkVersion: manifest.version, actualModelCalls: 0,
    limitations: ['Shipped default entry composition; strict isolated fixture compositions remain separate probes',
      'The managed CLI backend runs on a contract-level fixture session factory; no native codex executable is spawned and the real entry still needs an install-verified host decision',
      'Journal5 retains shared Task/outbox/funding admission; money authority marker remains4; external provider exactly-once is not implied by the database transaction',
      'Remote execution and interactive desktop remain separate gates',
      'No default user profile migration, Electron carrier or real model inference'] }
} catch (error) {
  summary = { status: 'failed', checks, error: error.stack }; process.exitCode = 1
  if(child&&!closed){
    try{await writeFile(join(run,'failure-diagnostic.json'),JSON.stringify({state:await api('state'),diagnostic:await request('integration-probe'),log:await api('diagnostics-log')},null,2))}catch{}
  }
}
finally { if (child) await stop('last');await remoteServer?.close();await remoteAgent?.close();await new Promise(resolve=>browserServer?browserServer.close(resolve):resolve()) }
await writeFile(join(run, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(JSON.stringify({ ...summary, runDirectory: run }, null, 2) + '\n')
