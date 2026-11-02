import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { taskHash } from '../packages/orchestration/src/task-contract.mjs'
import { resolverAnchor } from '../scripts/integration-upstream-tests.mjs'
import { combinedOverlay, isolatedHostEnvironment } from '../scripts/integration-combined-host.mjs'
import { killProcessTree } from '../.dsh-plugin/shared/task-executors.mjs'

await import('../remote-computer-agent/build.mjs')
const { Agent, Store, serve } = await import('../remote-computer-agent/dist/index.mjs')
const real = (name, fn, timeoutMs = 180_000) => test(name, { skip: process.platform !== 'win32' ? 'requires the actual Windows native launcher' : false, timeout: timeoutMs, concurrency: 1 }, fn)
const root = resolve('tmp/integration/codex-takeover-k42/runtime')

async function launcherFor(dir) {
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const source = await readFile(resolve('tests/fixtures/remote-codex-launcher.cs'), 'utf8')
  const literal = value => value.replaceAll('"', '""')
  const launcher = join(dir, 'remote-codex-launcher.exe'), csharp = join(dir, 'remote-codex-launcher.cs')
  await writeFile(csharp, source.replace('__NODE__', literal(process.execPath)).replace('__FIXTURE__', literal(resolve('tests/fixtures/remote-codex-cli.mjs'))))
  execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${launcher}`, csharp], { windowsHide: true })
  return { launcher, entry: { sha256: createHash('sha256').update(await readFile(launcher)).digest('hex'), version: '1.2.3' } }
}

async function nativeFixture(t, options = {}) {
  await mkdir(root, { recursive: true })
  const dir = options.dir ?? await mkdtemp(join(root, 'case-')), agentRoot = join(dir, 'agent-root'), work = join(agentRoot, 'work'), dataDir = options.dataDir ?? join(dir, 'agent-data'), botId = options.botId ?? 'bot-a'
  await mkdir(work, { recursive: true })
  const { launcher, entry } = options.pinned ?? await launcherFor(dir)
  const credentialRef = join(dir, `dummy-credential-${botId}.json`), canary = `dummy-canary-${createHash('sha256').update(dir + botId).digest('hex')}`
  await writeFile(credentialRef, JSON.stringify({ fixtureCredential: canary }), { mode: 0o600 })
  const agent = options.agent ?? new Agent({ dataDir, roots: { project: agentRoot }, cliProfiles: [{ profileId: 'codex-profile', rootId: 'project', profileRevision: 3,
    executable: launcher, runtimeRoot: join(dataDir, 'cli-runtime'), entry, bots: { [botId]: { credentialRef } } }] }, Database)
  const pair = options.pair ?? agent.store.pair('host', { botIds: [botId], roots: ['project'], tools: ['machine_ping','cli_probe_v1','cli_task_v1','operation_status','operation_cancel'] })
  const grant = agent.store.issue(agent.store.client(pair.token), { botId, taskId: 'task-a', attemptId: 'attempt-a', roots: ['project'], tools: ['cli_probe_v1','cli_task_v1','operation_status','operation_cancel'], ttlMs: 300000 })
  const context = agent.store.grant(grant.grantToken), workspaceId = 'remote_' + taskHash({ rootId: 'project', workspaceRelativePath: 'work', profileId: 'codex-profile', profileRevision: 3, entrySha256: entry.sha256, entryVersion: entry.version })
  const args = { rootId: 'project', workspaceRef: { kind: 'remote', machineId: agent.store.machineId, rootId: 'project', relativePath: 'work', workspaceId },
    profileId: 'codex-profile', profileRevision: 3, entry, requestedModel: 'gpt-fixture', catalogProvider: 'integration-gpt-fixture', catalogModel: 'gpt-fixture', billing: 'subscription', deadlineMs: 30000 }
  if (!options.agent) t.after(async () => { await agent.close() })
  return { dir, agentRoot, work, dataDir, agent, pair, context, args, entry, credentialRef, canary, launcher }
}

const settled = async (f, operationId, expected = ['succeeded','failed','cancelled','unknown']) => {
  let value
  for (let n = 0; n < 2800; n++) {
    value = await f.agent.call('operation_status', { operationId }, { ...f.context, tools: ['operation_status'] }, operationId)
    if (expected.includes(value.status)) return value
    await sleep(25)
  }
  throw new Error(`Remote CLI operation did not settle: ${JSON.stringify(value)}`)
}

real('Agent native runtime: probe and task use the pinned launcher, isolated home and actual process receipt', async t => {
  const f = await nativeFixture(t)
  const probe = await f.agent.call('cli_probe_v1', f.args, f.context, 'probe-native')
  assert.equal(probe.location, 'remote'); assert.equal(probe.loginStatus, 'unknown'); assert.equal(probe.workspaceIdentity.path, f.work)
  const version = JSON.parse(await readFile(join(probe.home, 'fixture-version.json'), 'utf8'))
  assert.equal(version.cwd, probe.home); assert.equal(version.home, probe.home)
  const submitted = await f.agent.call('cli_task_v1', { ...f.args, task: 'fixture:tree' }, f.context, 'operation-native')
  assert.ok(['admitted','running'].includes(submitted.status))
  const done = await settled(f, 'operation-native')
  assert.equal(done.status, 'succeeded', JSON.stringify(done)); assert.equal(done.result.stopConfirmed, true); assert.equal(done.result.stopEvidence.treeStopped, true)
  assert.equal(done.result.stopEvidence.exitCode, 0); assert.equal(done.result.stopEvidence.reason, 'exited')
  assert.equal(done.result.receipt.terminal, 'completed'); assert.equal(done.result.receipt.cliTurnRequestsDispatched, 1)
  assert.match(done.result.receipt.finalText, new RegExp(f.work.replaceAll('\\', '\\\\')))
  assert.equal(done.result.receipt.remote.profileRevision, 3); assert.equal(done.result.receipt.entry.sha256, f.entry.sha256)
  const marker = JSON.parse(await readFile(join(f.dataDir, 'cli-runtime', 'h-operation-native', 'fixture-task.json'), 'utf8'))
  assert.equal(marker.cwd, f.work); assert.ok(marker.descendantPid)
  assert.throws(() => process.kill(marker.descendantPid, 0), 'native descendant must be gone')
  assert.equal(JSON.parse(await readFile(join(f.dataDir, 'cli-runtime', 'h-operation-native', 'auth.json'), 'utf8')).fixtureCredential, f.canary)
  assert.equal(JSON.stringify(done).includes(f.canary), false)
})

async function writeOfflinePlugin(anchor) {
  let source = await readFile(resolve('tests/fixtures/integration-combined/mock-plugin.mjs'), 'utf8')
  const needle = "      } else if (userText.trim() === 'integration:task-run') {"
  const branches = `      } else if (/^integration:remote-cli-probe:machine-[A-Za-z0-9-]+$/.test(userText.trim())) {
        name = 'remote_computer_cli_probe'
        args = { machineId: userText.trim().slice('integration:remote-cli-probe:'.length), rootId: 'project', workspaceRelativePath: 'work' }
      } else if (/^integration:remote-cli-start:machine-[A-Za-z0-9-]+:(success|exit7|long|drop|no-usage|mismatch)$/.test(userText.trim())) {
        const rest = userText.trim().slice('integration:remote-cli-start:'.length), separator = rest.lastIndexOf(':'), machineId = rest.slice(0, separator), mode = rest.slice(separator + 1)
        const task = mode === 'exit7' ? 'fixture:exit7' : mode === 'long' ? 'fixture:long' : mode === 'no-usage' ? 'fixture:no-usage' : 'fixture:tree'
        name = 'bot_task_start'
        args = { backend: 'remote-codex-read', requestKey: 'remote-cli-' + mode, input: { machineId, rootId: 'project', workspaceRelativePath: 'work', task } }
      } else if (userText.trim() === 'integration:task-run') {`
  assert.ok(source.includes(needle)); source = source.replace(needle, branches)
  source = source.replace("'remote_computer_read','remote_computer_write'", "'remote_computer_read','remote_computer_cli_probe','remote_computer_write'")
  const file = join(anchor, 'offline-model.mjs'); await writeFile(file, source); return file
}

real('default product: real gateway/Agent/SQLite/native CLI success, cancellation, recovery and no fallback', async t => {
  const dir = await mkdtemp(join(root, 'product-')), home = join(dir, 'home'), profileHome = join(home, 'profiles/integration'), hostWorkspace = join(dir, 'host-workspace'), dataDir = join(dir, 'agent-data')
  await mkdir(join(profileHome, 'node_modules/@ljwei-stak'), { recursive: true }); await mkdir(hostWorkspace)
  const pinned = await launcherFor(dir), seed = new Store(dataDir, Database, { admin: true }), machineId = seed.machineId; seed.close()
  await symlink(resolve('.'), join(profileHome, 'node_modules/@ljwei-stak/dsh-model-router'), 'junction')
  await writeFile(join(profileHome, 'package.json'), JSON.stringify({ name: 'remote-cli-product-fixture', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@ljwei-stak/dsh-model-router'] } } }))
  const { anchor } = await resolverAnchor(resolve('tests/fixtures/integration-host')), offline = await writeOfflinePlugin(anchor)
  const overlay = combinedOverlay(offline).filter(item => item.id !== 'bot')
  overlay.push({ id: 'model-router-galgame', config: { taskCli: { remote: [{ machineId, rootId: 'project', profileId: 'codex-profile', profileRevision: 3, entry: pinned.entry }], models: [{ provider: 'integration-gpt-fixture', model: 'gpt-fixture', cliModel: 'gpt-fixture' }] } } })
  await writeFile(join(profileHome, 'cordis.patch.yml'), JSON.stringify(overlay, null, 2))
  const requireHost = createRequire(join(resolve('tests/fixtures/integration-host'), 'package.json')), manifestPath = requireHost.resolve('@deepseek-ai/dsh/package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), bin = resolve(dirname(manifestPath), manifest.bin.dsh)
  const listener = createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done)); const port = listener.address().port; await new Promise(done => listener.close(done))
  const base = `http://127.0.0.1:${port}`, logs = []
  let child, exit, cookie, agent, server, proxy
  const output = () => Buffer.concat(logs).toString('utf8')
  const redactedOutput = () => output().replace(/([?&]token=)[^\s&]+/g, '$1[redacted]')
  const wait = async (predicate, timeoutMs = 60000) => { const deadline = Date.now() + timeoutMs; for (;;) { const value = await predicate(); if (value) return value; if (Date.now() > deadline) throw new Error(`product fixture timeout: ${redactedOutput().slice(-1000)}`); await sleep(100) } }
  const launch = () => {
    logs.length = 0
    child = spawn(process.execPath, ['--import', pathToFileURL(resolve('modules/bot-runtime/vendor/ds-bot/test/harness-resolve.mjs')).href,
      '--import', pathToFileURL(resolve('tests/fixtures/integration-combined/offline-preload.mjs')).href, bin, '--profile', 'integration', '--no-open', '--host', '127.0.0.1', '--port', String(port)],
      { cwd: hostWorkspace, env: isolatedHostEnvironment(home, anchor), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    exit = new Promise(done => { child.once('error', () => done(-1)); child.once('close', done) })
    const capture = chunk => { logs.push(chunk); if (Buffer.concat(logs).length > 8 * 1024 * 1024) killProcessTree(child) }
    child.stdout.on('data', capture); child.stderr.on('data', capture)
  }
  const login = async () => { const url = await wait(() => output().match(new RegExp(`${base.replaceAll('.', '\\.')}\\/\\?token=[^\\s]+`))?.[0]); const response = await fetch(url, { redirect: 'manual' }); cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); assert.ok(cookie) }
  const request = async (path, body = {}) => { const response = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200); return response.json() }
  const api = async (endpoint, payload = {}) => { const result = await request('bot', { endpoint, payload }); assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
  const product = async (action, payload = {}) => { const response = await fetch(`${base}/api/bot-product`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }), signal: AbortSignal.timeout(30000) }); return response.json() }
  const ready = async () => { await wait(async () => { try { await api('state'); return true } catch { return false } }) }
  const quiet = async () => { let last = -1, at = Date.now(); return wait(async () => { const state = await api('state'), diagnostic = await request('integration-probe'); if (diagnostic.calls.length !== last || Object.keys(state.activity).length) { last = diagnostic.calls.length; at = Date.now() }; return Date.now() - at > 900 ? { state, diagnostic } : null }) }
  const stopHost = async () => { if (child && child.exitCode === null && child.signalCode === null) killProcessTree(child); if (exit) await Promise.race([exit, sleep(10000).then(() => { throw new Error('Host did not stop') })]) }
  t.after(async () => { await stopHost().catch(() => {}); if (proxy) await new Promise(done => proxy.close(done)); if (server) await server.close(); if (agent) await agent.close() })
  try {
    launch(); await login(); await ready(); await wait(async () => (await request('integration-probe')).providers.some(item => item.id === 'integration-gpt-fixture'))
    let state = await api('state'); const botId = state.mainBotId
    await api('update-bot', { id: botId, model: 'integration-gpt-fixture/gpt-fixture' }); await quiet()
    agent = new Agent({ dataDir, roots: { project: join(dir, 'agent-root') }, cliProfiles: [{ profileId: 'codex-profile', rootId: 'project', profileRevision: 3,
      executable: pinned.launcher, runtimeRoot: join(dataDir, 'cli-runtime'), entry: pinned.entry, bots: { [botId]: { credentialRef: join(dir, `dummy-credential-${botId}.json`) } } }] }, Database)
    const pair = agent.store.pair('host', { botIds: [botId], roots: ['project'], tools: ['machine_ping','cli_probe_v1','cli_task_v1','operation_status','operation_cancel'] })
    const f = await nativeFixture(t, { dir, dataDir, botId, agent, pair, pinned }); server = await serve(agent, { port: 0 })
    const bodies = []; let dropNext = false
    proxy = http.createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks); bodies.push(body.toString('utf8'))
      const forward = http.request({ host: '127.0.0.1', port: server.address.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${server.address.port}` } }, response => {
        const responseChunks = []; response.on('data', chunk => responseChunks.push(chunk)); response.on('end', () => {
          const payload = Buffer.concat(responseChunks)
          if (dropNext && body.toString('utf8').includes('"name":"cli_task_v1"')) { dropNext = false; res.destroy(); return }
          res.writeHead(response.statusCode, response.headers); res.end(payload)
        })
      })
      forward.on('error', error => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'FIXTURE_PROXY_ERROR', message: error.code } })) }); forward.end(body)
    })
    await new Promise(done => proxy.listen(0, '127.0.0.1', done))
    const secret = await product('machine.secret', { payload: { name: 'REMOTE_AGENT_K42', value: pair.token } }); assert.equal(secret.ok, true, JSON.stringify(secret))
    const paired = await product('machine.pair', { payload: { name: 'K42 Agent', machineId, endpoint: `http://127.0.0.1:${proxy.address().port}`, secretRef: secret.value.secretRef, probeBotId: botId, roots: ['project'], tools: ['machine_ping','cli_probe_v1','cli_task_v1','operation_status','operation_cancel'], expectedRevision: 0 } })
    assert.equal(paired.ok, true, JSON.stringify(paired))
    const bound = await product('machine.bind', { payload: { machineId, botId, expectedRevision: 0, roots: ['project'], tools: ['machine_ping','cli_probe_v1','cli_task_v1','operation_status','operation_cancel'], mode: 'read-only' } })
    assert.equal(bound.ok, true, JSON.stringify(bound))
    assert.equal(bound.value.remoteRevoked, true, 'rebinding must revoke prior Agent tickets before granting the read-only CLI scope')
    let snapshot = (await product('snapshot')).value, account = snapshot.fundingAccounts.items.find(item => item.provider === 'integration-gpt-fixture')
    assert.ok(account); const enabled = await product('funding.account.save', { payload: { scopeId: account.id, expectedRevision: 0, enabled: true, dailyLimitUsd: 10, monthlyLimitUsd: 100 } }); assert.equal(enabled.ok, true)
    const settings = { schemaVersion: 1, enabled: true, model: { provider: 'integration-gpt-fixture', model: 'gpt-fixture' }, officialTools: [{ toolId: 'codex', cliModel: 'gpt-fixture', mode: 'read-only' }],
      machineGrants: [{ machineId, rootId: 'project', mode: 'read-only', capabilities: [] }], capabilities: ['model-inference','mr-routing','managed-tasks'], workspaceRef: { kind: 'remote', machineId, rootId: 'project' },
      funding: { mode: 'subscription', scopeId: account.id, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: { dailyCalls: 100, monthlyCalls: 1000 } }, maxConcurrentTasks: 1 }
    const saved = await product('binding.save', { payload: { botId, expectedRevision: 0, settings } }); assert.equal(saved.ok, true, JSON.stringify(saved))
    await wait(async () => (await product('snapshot')).value.bindings.items.find(item => item.botId === botId)?.tools.includes('remote/cli_task_v1'))
    snapshot = (await product('snapshot')).value
    assert.ok(snapshot.tasks.backends.some(item => item.id === 'remote-codex-read')); assert.equal(snapshot.tasks.backends.some(item => item.id === 'codex-read'), false)
    const send = async text => { await api('send', { sessionId: botId, text }); return quiet() }
    const latestResult = (diagnostic, name) => diagnostic.toolResults.filter(item => item.name === name).at(-1)
    const tasks = async () => (await product('snapshot')).value.tasks.items
    const settle = async (taskId, expected, timeoutMs = 150000) => wait(async () => {
      const row = (await tasks()).find(item => item.taskId === taskId)
      if (row?.state === expected) return row
      if (['succeeded','failed','cancelled','needs-reconciliation'].includes(row?.state)) {
        const hostDb = new Database(join(home, 'model-router/orchestration.sqlite'), { readonly: true })
        try {
          const attempts = hostDb.prepare('SELECT payload FROM router_runs WHERE id=?').get(`cli-${row.operationId}`)
          const run = attempts ? JSON.parse(attempts.payload) : null
          const remote = agent.store.db.prepare('SELECT status,error FROM operations WHERE id=?').get(row.operationId)
          const attempt = hostDb.prepare('SELECT a.result FROM attempts a JOIN packages p ON p.current_attempt=a.id WHERE p.task_id=?').get(taskId)
          const detail = attempt?.result ? JSON.parse(attempt.result) : null
          assert.fail(JSON.stringify({ taskId, expected, state: row.state, result: row.result, remote,
            failureCode: detail?.summary?.failureCode ?? detail?.code ?? null,
            cli: run ? { status: run.status, stopConfirmed: run.cliExecution?.stopConfirmed, dispatched: run.cliExecution?.cliTurnRequestsDispatched } : null }))
        } finally { hostDb.close() }
      }
      return null
    }, timeoutMs)
    const start = async mode => { const current = await send(`integration:remote-cli-start:${machineId}:${mode}`), result = latestResult(current.diagnostic, 'bot_task_start'); assert.ok(result && !result.result.isError, JSON.stringify(result)); return result.result.value }
    const status = async taskId => { const current = await send(`integration:task-status:${taskId}`), result = latestResult(current.diagnostic, 'bot_task_status'); assert.ok(result && !result.result.isError, JSON.stringify(result)); return result.result.value }
    const probeRun = await send(`integration:remote-cli-probe:${machineId}`), probeResult = latestResult(probeRun.diagnostic, 'remote_computer_cli_probe')
    assert.ok(probeResult && !probeResult.result.isError, JSON.stringify(probeResult)); assert.equal(probeResult.result.value.loginStatus, 'unknown'); assert.equal(probeResult.result.value.machineId, machineId); assert.equal(probeResult.result.value.workspaceIdentity.path, f.work)
    const success = await start('success'); await settle(success.taskId, 'succeeded')
    const successStatus = await status(success.taskId); assert.match(successStatus.result.summary.finalText, /remote-cli ok cwd=/); assert.equal(successStatus.result.summary.stopConfirmed, true); assert.equal(successStatus.result.summary.exitCode, 0)
    const replay = await start('success'); assert.equal(replay.taskId, success.taskId); assert.equal(replay.operationId, success.operationId)
    assert.equal(agent.store.db.prepare("SELECT count(*) n FROM operations WHERE tool='cli_task_v1' AND id=?").get(success.operationId).n, 1)
    const exit7 = await start('exit7'); await settle(exit7.taskId, 'failed'); assert.equal((await status(exit7.taskId)).result.summary.exitCode, 7)
    const noUsage = await start('no-usage'); await settle(noUsage.taskId, 'succeeded')
    const usageRows = (await product('snapshot')).value.usage.items.filter(item => item.source === 'cli'), noUsageReceipt = usageRows.find(item => item.taskId === noUsage.taskId)
    assert.equal(noUsageReceipt.inputTokens, null); assert.equal(noUsageReceipt.outputTokens, null); assert.equal(noUsageReceipt.amountUsd, 0)
    const long = await start('long'); await wait(() => readFile(join(dataDir, 'cli-runtime', `h-${long.operationId}`, 'fixture-task.json'), 'utf8').then(JSON.parse).catch(() => null))
    const longMarker = JSON.parse(await readFile(join(dataDir, 'cli-runtime', `h-${long.operationId}`, 'fixture-task.json'), 'utf8'))
    await send(`integration:task-cancel-task:${long.taskId}`); await settle(long.taskId, 'cancelled'); assert.equal((await status(long.taskId)).result.summary.stopConfirmed, true)
    assert.throws(() => process.kill(longMarker.pid, 0)); assert.throws(() => process.kill(longMarker.descendantPid, 0))
    dropNext = true; const dropped = await start('drop'); await settle(dropped.taskId, 'needs-reconciliation')
    await wait(() => ['succeeded','failed','cancelled'].includes(agent.store.db.prepare('SELECT status FROM operations WHERE id=?').get(dropped.operationId)?.status) || null)
    await stopHost(); launch(); await login(); await ready()
    const reconciledRun = await send(`integration:task-reconcile:${dropped.taskId}`), reconciledResult = latestResult(reconciledRun.diagnostic, 'bot_task_reconcile')
    assert.ok(reconciledResult && !reconciledResult.result.isError, JSON.stringify(reconciledResult)); assert.equal(reconciledResult.result.value.state, 'succeeded')
    assert.equal(agent.store.db.prepare("SELECT count(*) n FROM operations WHERE tool='cli_task_v1' AND id=?").get(dropped.operationId).n, 1)
    await writeFile(join(f.work, 'fixture-mode.txt'), 'model-mismatch'); const mismatch = await start('mismatch'); await settle(mismatch.taskId, 'needs-reconciliation'); await writeFile(join(f.work, 'fixture-mode.txt'), '')
    const finalTasks = [success, exit7, noUsage, long, dropped, mismatch], receipts = (await product('snapshot')).value.usage.items.filter(item => item.source === 'cli')
    for (const task of finalTasks) assert.equal(receipts.filter(item => item.taskId === task.taskId).length, 1, task.taskId)
    assert.equal(receipts.length, finalTasks.length); assert.equal(receipts.filter(item => item.taskId === dropped.taskId)[0].status, 'settled')
    const operations = agent.store.db.prepare('SELECT tool,context,result FROM operations').all()
    assert.equal(operations.some(row => ['shell_exec','container_command_v1','fs_write'].includes(row.tool)), false)
    const serialized = JSON.stringify({ bodies, operations, receipts, logs: output() }); assert.equal(serialized.includes(f.canary), false)
    assert.equal(await readFile(join(home, 'model-router/managed/cli-runtime', `h-${success.operationId}`, 'auth.json'), 'utf8').catch(() => null), null)
    console.log(JSON.stringify({ kind: 'K42_REMOTE_CLI_PRODUCT', platform: process.platform, hostHome: home, agentData: dataDir, machineId,
      taskCount: finalTasks.length, receiptCount: receipts.length, agentOperations: operations.length, fallbackOperations: 0,
      cancelledProcessStopped: true, droppedOperationReconciled: true, canaryLeaked: false, remoteVendorLogin: 'not-run', t35: 'not_run' }))
  } catch (error) {
    throw Object.assign(error, { message: `${error.message}\nHost log: ${redactedOutput().slice(-4000)}` })
  }
}, 600000)
