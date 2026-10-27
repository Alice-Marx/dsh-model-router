import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, symlink, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolverAnchor } from './integration-upstream-tests.mjs'
import { killProcessTree } from '../.dsh-plugin/shared/task-executors.mjs'
import {DEFAULT_TASK_DRIVER,verifyTaskDriver} from './integration-task-probe.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execute = promisify(execFile)
const FIXTURE_ROUTE = 'integration-gpt-fixture/gpt-fixture'

export function isolatedHostEnvironment(home, anchor, source = process.env) {
  const env = { DSH_HOME: home, DSH_HARNESS: anchor, DSH_TELEMETRY_MODE: 'OFF',
    HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata') }
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) {
    if (source[key]) env[key] = source[key]
  }
  return env
}

export function combinedOverlay(mockPlugin) {
  return [
    { id: 'bot', config: { updateCheck: false } },
    { id: 'agent-default-model', config: { provider: 'integration-gpt-fixture', model: 'gpt-fixture' } },
    ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-telemetry-otel', 'session-title-llm',
      'desktop-product-telemetry', 'product-analytics'].map(id => ({ id, disabled: true })),
    { insert: [{ id: 'integration-offline', name: pathToFileURL(mockPlugin).href }] },
  ]
}

async function unusedPort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
  const port = server.address().port
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}

export async function runCombinedHost({ dsRoot, hostRoot, serve = false, security = false, legacyPolicy = false, lifecycle = false, tasks = false }) {
  lifecycle ||= tasks
  assert.ok(!(lifecycle && legacyPolicy), 'Lifecycle and temporary legacy-policy probes use separate compositions')
  const baseline = JSON.parse(await readFile(join(ROOT, 'docs/integration/baseline.json'), 'utf8'))
  const revision = (await execute('git', ['-C', dsRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })).stdout.trim()
  assert.equal(revision, baseline.repositories.DS.commit, 'DS must be the frozen source')
  const changes = (await execute('git', ['-C', dsRoot, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', windowsHide: true })).stdout.trim()
  assert.ok(!changes, `Frozen DS tracked sources must be unchanged (${changes ? changes.split('\n').length : 0} changed entries)`)
  const { anchor } = await resolverAnchor(hostRoot)
  const mockPlugin = join(anchor, 'offline-model.mjs')
  await copyFile(join(ROOT, 'tests/fixtures/integration-combined/mock-plugin.mjs'), mockPlugin)
  const parent = join(ROOT, 'tmp/integration/combined-host')
  await mkdir(parent, { recursive: true })
  const run = await mkdtemp(join(parent, 'run-'))
  const home = join(run, 'home')
  const profile = join(home, 'profiles/integration')
  const workspace = join(run, 'workspace')
  await mkdir(join(profile, 'node_modules/@ljwei-stak'), { recursive: true })
  await mkdir(workspace)
  await symlink(ROOT, join(profile, 'node_modules/@ljwei-stak/dsh-model-router'), process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(join(dsRoot, 'ds-bot'), join(profile, 'node_modules/ds-bot'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'integration-combined-profile', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'ds-bot', '@ljwei-stak/dsh-model-router'] } } }, null, 2))
  const overlay = combinedOverlay(mockPlugin)
  if (security) {
    const plugin = join(anchor, 'security-probe.mjs')
    await copyFile(join(ROOT, 'tests/fixtures/integration-combined/security-plugin.mjs'), plugin)
    overlay.push({ insert: [{ id: 'integration-security', name: pathToFileURL(plugin).href,
      config: { authorityModule: pathToFileURL(join(ROOT, 'packages/capability-broker/src/authority.mjs')).href } }] })
  }
  if (legacyPolicy) {
    const plugin = join(anchor, 'legacy-policy-probe.mjs')
    await copyFile(join(ROOT, 'tests/fixtures/integration-combined/legacy-policy-plugin.mjs'), plugin)
    const localModule = path => pathToFileURL(join(ROOT, path)).href
    overlay.push({ insert: [{ id: 'integration-legacy-policy', name: pathToFileURL(plugin).href, config: {
      authorityModule: localModule('packages/capability-broker/src/authority.mjs'),
      principalsModule: localModule('packages/orchestration/src/principals.mjs'),
      policyModule: localModule('packages/orchestration/src/bot-policy.mjs'),
      remoteContractModule: localModule('.dsh-plugin/shared/official-tools-remote.mjs'),
    } }] })
  }
  if (lifecycle) {
    const plugin = join(anchor, 'lifecycle-probe.mjs')
    await copyFile(join(ROOT, 'tests/fixtures/integration-combined/lifecycle-plugin.mjs'), plugin)
    const localModule = path => pathToFileURL(join(ROOT, path)).href
    overlay.push({ id: 'bot', disabled: true }, { id: 'model-router-galgame', config: { requireBotPolicy: true } },
      { insert: [{ id: 'integration-owned-ds', name: pathToFileURL(plugin).href, config: {
        dsEntry: pathToFileURL(join(dsRoot, 'ds-bot/index.js')).href,
        authorityModule: localModule('packages/capability-broker/src/authority.mjs'),
        principalsModule: localModule('packages/orchestration/src/principals.mjs'),
        policyModule: localModule('packages/orchestration/src/bot-policy.mjs'),
        lifecycleModule: localModule('packages/orchestration/src/ds-lifecycle.mjs'),
        enableTasks:tasks,
      } }] })
  }
  if(tasks){
    await verifyTaskDriver(DEFAULT_TASK_DRIVER)
    const plugin=join(anchor,'tasks-probe.mjs')
    await copyFile(join(ROOT,'tests/fixtures/integration-combined/tasks-plugin.mjs'),plugin)
    const localModule=path=>pathToFileURL(join(ROOT,path)).href
    overlay.push({insert:[{id:'integration-managed-tasks',name:pathToFileURL(plugin).href,config:{
      driver:DEFAULT_TASK_DRIVER,driverModule:localModule('scripts/integration-task-probe.mjs'),
      journalModule:localModule('packages/orchestration/src/task-journal.mjs'),serviceModule:localModule('packages/orchestration/src/task-service.mjs'),
      toolsModule:localModule('packages/orchestration/src/task-tools.mjs'),contractModule:localModule('packages/orchestration/src/task-contract.mjs'),mrModule:localModule('.dsh-plugin/index.mjs'),
    }}]})
  }
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(overlay, null, 2))
  const requireHost = createRequire(join(hostRoot, 'package.json'))
  const manifestPath = requireHost.resolve('@deepseek-ai/dsh/package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.version, '0.2.1-rc.3')
  const bin = resolve(dirname(manifestPath), manifest.bin.dsh)
  assert.ok(!relative(dirname(manifestPath), bin).startsWith('..'), 'Public bin must stay inside its package')
  const port = await unusedPort()
  const base = `http://127.0.0.1:${port}`
  const logs = []
  let bytes = 0
  let child, closed, exit, timer
  const checks = []
  const record = (name, condition) => { assert.ok(condition, name); checks.push(name) }
  const launch = () => {
    logs.length = 0
    bytes = 0
    child = spawn(process.execPath, ['--import', pathToFileURL(join(dsRoot, 'ds-bot/test/harness-resolve.mjs')).href,
      '--import', pathToFileURL(join(ROOT, 'tests/fixtures/integration-combined/offline-preload.mjs')).href,
      bin, '--profile', 'integration', '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: workspace, env: isolatedHostEnvironment(home, anchor), windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    })
    closed = false
    exit = new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('close', code => { closed = true; resolveExit(code) })
    })
    const capture = chunk => {
      bytes += chunk.length
      if (bytes <= 8 * 1024 * 1024) logs.push(chunk)
      else killProcessTree(child)
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    timer = setTimeout(() => killProcessTree(child), serve ? 15 * 60_000 : 150_000)
  }
  const text = () => Buffer.concat(logs).toString('utf8')
  const stop = async (label,{crash=false}={}) => {
    clearTimeout(timer)
    if (!closed) {
      // Only the detached process group created by this runner; SIGTERM permits
      // graceful shutdown and therefore cannot exercise unknown crash recovery.
      if(crash&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL')
      else killProcessTree(child)
    }
    await Promise.race([exit, sleep(10_000).then(() => { throw new Error('Owned host process did not exit') })])
    await writeFile(join(run, `${label}.log`), text().replace(/(\?token=)[^\s]+/g, '$1[redacted]'))
  }
  let cookie
  const waitUntil = async (label, predicate, timeout = 45_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (closed) throw new Error(`Host exited while waiting for ${label}; see isolated logs`)
      const result = await predicate()
      if (result) return result
      await sleep(150)
    }
    throw new Error(`Timed out waiting for ${label}; see isolated logs`)
  }
  const login = async () => {
    const url = await waitUntil('official authenticated web startup', async () => text().match(new RegExp(`${base.replaceAll('.', '\\.')}\\/\\?token=[^\\s]+`))?.[0])
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.ok(cookie, 'Official web login issued a session cookie')
    return url
  }
  const request = async (path, body = {}) => {
    const response = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(35_000) })
    assert.equal(response.status, 200, `Authenticated ${path}`)
    return response.json()
  }
  const api = async (endpoint, payload = {}) => {
    const result = await request('bot', { endpoint, payload })
    assert.equal(result.ok, true, `${endpoint}: ${result.error?.message ?? 'ok'}`)
    return result.value
  }
  const quiet = async () => {
    let since = Date.now()
    let count = -1
    return waitUntil('all real Session turns to finish', async () => {
      const state = await api('state')
      const diagnostic = await request('integration-probe')
      if (diagnostic.calls.length !== count || Object.keys(state.activity).length > 0) {
        since = Date.now(); count = diagnostic.calls.length
      }
      return Date.now() - since >= 900 ? { state, diagnostic } : undefined
    })
  }
  let summary
  try {
    launch()
    let loginUrl = await login()
    const diagnostic = await waitUntil('fixture model registration', async () => {
      const value = await request('integration-probe')
      return value.providers.some(provider => provider.id === 'integration-gpt-fixture') ? value : undefined
    })
    record('MR and DS tools registered in one official rc.3 profile', ['model_router_routes', 'model_router_execute', 'create_bot', 'message_bot'].every(name => diagnostic.registeredTools.includes(name)))
    let state = await api('state')
    const main = state.bots.find(bot => bot.id === state.mainBotId)
    record('Main Bot created on a real DSH Session and fixture model advertised', main?.sessionId && state.models.some(model => model.ref === FIXTURE_ROUTE))
    await api('update-bot', { id: main.id, model: FIXTURE_ROUTE })
    await quiet()
    await api('send', { sessionId: main.id, text: 'integration:create-worker' })
    let result = await quiet()
    const worker = result.state.bots.find(bot => bot.name === 'IntegrationWorker')
    record('Main AgentLoop creates worker using the actual create_bot tool', worker?.createdBy === main.id && worker.model === FIXTURE_ROUTE && result.diagnostic.toolResults.some(tool => tool.name === 'create_bot' && !tool.result.isError))
    await api('send', { sessionId: worker.id, text: 'integration:router-routes' })
    result = await quiet()
    const routeTool = result.diagnostic.toolResults.find(tool => tool.name === 'model_router_routes' && tool.agentId === worker.id)
    record('Worker AgentLoop calls MR route tool through real DSH registry', routeTool && !routeTool.result.isError && JSON.stringify(routeTool.result).includes('integration-gpt-fixture'))
    await api('send', { sessionId: main.id, text: 'integration:delegate' })
    result = await quiet()
    const exchange = await api('exchange', { a: main.id, b: worker.id })
    record('Main message_bot dispatch reaches worker and its reply returns', result.diagnostic.toolResults.some(tool => tool.name === 'message_bot' && !tool.result.isError) && exchange.some(item => item.from === main.id && item.to === worker.id) && exchange.some(item => item.from === worker.id && item.to === main.id))
    record('Main and worker use real AgentLoops; every call keeps the exact offline route', [main.id, worker.id].every(id => result.diagnostic.calls.some(call => call.sessionId === id && call.agentLoop)) && result.diagnostic.calls.every(call => `${call.provider}/${call.model}` === FIXTURE_ROUTE))
    const usage = await api('usage')
    record('DS usage projection attributes positive mock token usage to both Bots', [main.id, worker.id].every(id => {
      const ownerIndex = usage.owners.findIndex(owner => owner.id === id)
      return ownerIndex >= 0 && usage.rows.some(row => row[1] === ownerIndex && row[4] >= 11 && row[7] >= 5 && row[8] >= 1)
    }))
    const details = { ...result.diagnostic, usage, exchange }
    await writeFile(join(run, 'diagnostics.json'), JSON.stringify(details, null, 2))
    const workerCall = result.diagnostic.calls.find(call => call.sessionId === worker.id)
    summary = { status: 'passed', level: 'host-integration-offline', sdkVersion: manifest.version,
      node: process.version, platform: process.platform, arch: process.arch, frozenDsCommit: revision,
      checks, actualModelCalls: 0, mockAdapterDispatches: result.diagnostic.calls.length,
      auxiliaryModelCalls: result.diagnostic.calls.filter(call => !call.agentLoop).length,
      observedLegacyExposure: workerCall.tools.filter(name => /^model_router_/.test(name)),
      limitations: ['No actual model provider request', 'No browser or Desktop UI assertion in this command',
        'No product Bot policy, unified task ledger or CLI bridge installed', 'Legacy MR tools remain visible to an ordinary DS Bot; authorization integration remains required'],
      diagnosticSha256: createHash('sha256').update(await readFile(join(run, 'diagnostics.json'))).digest('hex') }
    if (security) {
      summary.security = await request('integration-security', { mainId: main.id, workerId: worker.id })
      await writeFile(join(run, 'security.json'), JSON.stringify(summary.security, null, 2))
      assert.equal(summary.security.status, 'passed-for-described-checks', summary.security.error)
    }
    if (legacyPolicy) {
      summary.legacyPolicy = await request('integration-legacy-policy', { mainId: main.id, workerId: worker.id })
      await writeFile(join(run, 'legacy-policy.json'), JSON.stringify(summary.legacyPolicy, null, 2))
      assert.equal(summary.legacyPolicy.status, 'passed-for-described-checks', summary.legacyPolicy.error)
    }
    if (lifecycle) {
      const rpc = async (method, authenticated = true) => {
        const endpoint = `modelRouterOfficialTools/${method}`
        const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST', redirect: 'manual',
          headers: { 'content-type': 'application/json', ...(authenticated ? { cookie } : {}) },
          body: JSON.stringify({ type: 'client-request', rpcId: `lifecycle-${method}`, method: endpoint, payload: { args: {} } }),
          signal: AbortSignal.timeout(10_000) })
        return { status: response.status, body: response.status === 200 ? await response.json() : null }
      }
      const allowedRpc = await rpc('boundaries')
      assert.equal(allowedRpc.status, 200)
      assert.equal(allowedRpc.body.result.ok, true, JSON.stringify(allowedRpc.body))
      assert.equal(allowedRpc.body.result.value.ok, true, JSON.stringify(allowedRpc.body))
      const deniedRpc = await rpc('ledger')
      assert.equal(deniedRpc.status, 200)
      assert.equal(deniedRpc.body.result.ok, false, JSON.stringify(deniedRpc.body))
      assert.match(JSON.stringify(deniedRpc.body), /TOOL_DENIED/)
      const unauthenticatedRpc = await rpc('boundaries', false)
      assert.ok([401, 403].includes(unauthenticatedRpc.status), `Unauthenticated RPC status ${unauthenticatedRpc.status}`)
      summary.gateway = { status: 'passed', checks: ['Authenticated owner reaches an explicitly granted actual Gateway RPC',
        'Authenticated owner cannot call an ungranted RPC', 'Missing browser authentication cannot acquire owner RPC authority'],
        actualModelCalls: 0 }
      await writeFile(join(run, 'gateway.json'), JSON.stringify(summary.gateway, null, 2))
    }
    if (lifecycle) {
      summary.lifecycle = await request('integration-lifecycle', { action: 'probe', mainId: main.id, workerId: worker.id })
      await writeFile(join(run, 'lifecycle.json'), JSON.stringify(summary.lifecycle, null, 2))
      assert.equal(summary.lifecycle.status, 'passed-for-described-checks', summary.lifecycle.error)
      summary.level = 'strict-host-lifecycle-offline'
      summary.limitations = ['Strict isolated fixture composition, not a default product migration', 'No live model, persisted Task/receipt facade, CLI bootstrap or OS worker']
      const finalDiagnostic = await request('integration-probe')
      summary.mockAdapterDispatches = finalDiagnostic.calls.length
      summary.auxiliaryModelCalls = finalDiagnostic.calls.filter(call => !call.agentLoop).length
      await writeFile(join(run, 'diagnostics-final.json'), JSON.stringify(finalDiagnostic, null, 2))
      summary.finalDiagnosticSha256 = createHash('sha256').update(await readFile(join(run, 'diagnostics-final.json'))).digest('hex')
    }
    if(tasks){
      summary.tasks=await request('integration-tasks',{action:'probe',mainId:main.id,workerId:worker.id})
      await writeFile(join(run,'tasks.json'),JSON.stringify(summary.tasks,null,2))
      assert.equal(summary.tasks.status,'passed',summary.tasks.error)
      summary.level='strict-host-managed-tasks-offline'
      summary.limitations=summary.tasks.limitations
      const diagnostic=await request('integration-probe')
      summary.mockAdapterDispatches=diagnostic.calls.length
      summary.auxiliaryModelCalls=diagnostic.calls.filter(call=>!call.agentLoop).length
      await writeFile(join(run,'diagnostics-final.json'),JSON.stringify(diagnostic,null,2))
      summary.finalDiagnosticSha256=createHash('sha256').update(await readFile(join(run,'diagnostics-final.json'))).digest('hex')
    }
    await stop('host-before-restart',{crash:tasks})
    if(tasks)await sleep(5200)
    launch()
    loginUrl = await login()
    state = await api('state')
    const restoredExchange = await api('exchange', { a: main.id, b: worker.id })
    record('Fresh host process restores Bot identities, exact models and exchange history', state.mainBotId === main.id && state.bots.length === 2 && state.bots.every(bot => bot.model === FIXTURE_ROUTE) && state.bots.some(bot => bot.id === worker.id) && restoredExchange.length === exchange.length)
    if (lifecycle) {
      summary.lifecycleAfterRestart = await request('integration-lifecycle', { action: 'restored', mainId: main.id, workerId: worker.id })
      await writeFile(join(run, 'lifecycle-restored.json'), JSON.stringify(summary.lifecycleAfterRestart, null, 2))
      assert.equal(summary.lifecycleAfterRestart.status, 'passed-for-described-checks', summary.lifecycleAfterRestart.error)
    }
    if(tasks){
      summary.tasksAfterRestart=await request('integration-tasks',{action:'restored',mainId:main.id,workerId:worker.id,recoveryTaskId:summary.tasks.recoveryTaskId,operationId:summary.tasks.operationId})
      await writeFile(join(run,'tasks-restored.json'),JSON.stringify(summary.tasksAfterRestart,null,2))
      assert.equal(summary.tasksAfterRestart.status,'passed',summary.tasksAfterRestart.error)
    }
    if (serve) {
      await writeFile(join(run, 'browser-access.json'), JSON.stringify({ base, loginUrl, home, pid: child.pid }))
      process.stdout.write(JSON.stringify({ status: 'ready-for-browser', run: relative(ROOT, run), checks: checks.length }) + '\n')
      await waitUntil('browser stop marker', async () => {
        try { return (await readFile(join(run, 'stop'), 'utf8')).trim() === 'stop' } catch (error) { if (error.code === 'ENOENT') return false; throw error }
      }, 14 * 60_000)
    }
    await stop('host')
    record('Owned host process exited and test state stays in isolated DSH_HOME', closed && relative(ROOT, home).startsWith('tmp'))
    summary.checks = checks
  } catch (error) {
    if (cookie && !closed) {
      try { await writeFile(join(run, 'diagnostics-failed.json'), JSON.stringify(await request('integration-probe'), null, 2)) } catch { /* original failure retained */ }
    }
    summary = { status: 'failed', checks, error: error.message, actualModelCalls: 0 }
    throw error
  } finally {
    if (!closed) await stop('host-failed')
    if (summary) await writeFile(join(run, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  }
  return { ...summary, rawEvidence: relative(ROOT, run).replaceAll('\\', '/') }
}

async function main(args) {
  const tasks=args.includes('--tasks')
  args=args.filter(arg=>arg!=='--tasks')
  const lifecycle = args.includes('--lifecycle')
  args = args.filter(arg => arg !== '--lifecycle')
  const legacyPolicy = args.includes('--legacy-policy')
  args = args.filter(arg => arg !== '--legacy-policy')
  const security = args.includes('--security')
  args = args.filter(arg => arg !== '--security')
  const serve = args.at(-1) === '--serve'
  if (serve) args = args.slice(0, -1)
  if (args.length !== 4 || args[0] !== '--ds-root' || args[2] !== '--host-root') throw new Error('Usage: node scripts/integration-combined-host.mjs --ds-root <frozen-DS-checkout> --host-root <installed-fixture> [--security] [--legacy-policy | --lifecycle | --tasks] [--serve]')
  const result = await runCombinedHost({ dsRoot: resolve(args[1]), hostRoot: resolve(args[3]), serve, security, legacyPolicy, lifecycle, tasks })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
