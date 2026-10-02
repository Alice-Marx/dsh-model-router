// Regressions from the 2026-10-02 test pass (H1, M1–M4, L1–L5).
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, existsSync, readdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strictCtx } from './helpers/strict-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-regressions-'))
const host = await import('../.dsh-plugin/index.mjs')
const executors = await import('../.dsh-plugin/shared/task-executors.mjs')
const { createRouterState } = await import('../.dsh-plugin/shared/router-state.mjs')
const { createHealthCache } = await import('../.dsh-plugin/shared/tool-health.mjs')
const { buildPlan, explicitStepReferences } = await import('../.dsh-plugin/shared/router.mjs')
const { budgetCheck, formatUsd, buildRunRecord } = await import('../.dsh-plugin/shared/run-ledger.mjs')
const { formatUsd: clientFormatUsd } = await import('../.dsh-plugin/client/insights-state.mjs')

const STATE = join(process.env.DSH_HOME, 'model-router', 'state.json')
const readState = async () => JSON.parse(await readFile(STATE, 'utf8'))
const CJK = n => '测'.repeat(n)

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'model-router-regressions-ws-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

function llmCtx({ providers = { deepseek: ['deepseek-chat'] }, answer = () => 'API 回答', onStream = null } = {}) {
  const calls = []
  return strictCtx({
    calls,
    llm: {
      listProviders: () => Object.keys(providers).map(id => ({ id })),
      listModels: async provider => (providers[provider] ?? []).map(id => ({ id })),
      resolveModelInfo: async (provider, model) => ({ provider, id: model }),
      stream(options) {
        calls.push(options)
        onStream?.(options)
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: answer(options) }
          yield { type: 'usage', usage: { inputTokens: 1_000, outputTokens: 1_000 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  }, { testOnly: ['calls'] })
}
const profiles = list => ({ modelProfilesJson: JSON.stringify(list) })
const LONG_TEAM_TASK = steps => `目标：完成一个大型重构。\n1. 分析现有模块结构并列出问题。\n2. 设计新的模块接口，依赖第 1 步。\n3. 实现新接口并编写测试，依赖第 2 步。\n背景资料：\n${CJK(steps)}`

// ---------------------------------------------------------------- H1 / L3
test('H1: package prompts always fit the CLI/API limit, truncating the task and dependency answers', () => {
  const task = CJK(21_000)
  const completed = ['a', 'b', 'c'].map(id => ({ id, name: `步骤 ${id}`, answer: CJK(3_000) }))
  const prompt = executors.packagePrompt(task, { name: '整合', objective: '汇总三个结果', dependsOn: ['a', 'b', 'c'] }, completed)
  assert.ok(Buffer.byteLength(prompt, 'utf8') <= executors.MAX_TASK_BYTES)
  assert.match(prompt, /（已截断）/)
  for (const id of ['a', 'b', 'c']) assert.match(prompt, new RegExp(`步骤 ${id}:\\n测`))
  // Small inputs are untouched.
  const small = executors.packagePrompt('短任务', { name: 'x', dependsOn: ['a'] }, [{ id: 'a', name: 'A', answer: '答案' }])
  assert.match(small, /总任务：\n短任务/)
  assert.match(small, /A:\n答案/)
  assert.doesNotMatch(small, /已截断/)
})

test('H1: a long routed team task runs every package without throwing and is recorded', async t => {
  const cwd = await workspace(t)
  const ctx = llmCtx({ answer: () => CJK(3_000) })
  const result = await host.executeConfiguredAssignment(ctx, LONG_TEAM_TASK(20_000),
    profiles([{ provider: 'deepseek', model: 'deepseek-chat', quality: 85, pricing: { input: 1, output: 1 } }]),
    { workspace: cwd, skipToolProbe: true, planMode: 'team' })
  assert.ok(result.run.packages.length >= 4)
  assert.equal(result.execution.status, 'completed')
  for (const call of ctx.calls) {
    const promptText = call.messages?.map?.(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('') ?? ''
    assert.ok(Buffer.byteLength(promptText, 'utf8') < executors.MAX_TASK_BYTES + 4_000)
  }
  const state = await readState()
  assert.ok(state.runs.some(run => run.id === result.runId))
})

test('H1/L3: an over-long task is refused up front in Chinese, before any paid call', async t => {
  const cwd = await workspace(t)
  const ctx = llmCtx()
  await assert.rejects(() => host.executeConfiguredAssignment(ctx, CJK(22_000),
    profiles([{ provider: 'deepseek', model: 'deepseek-chat', quality: 85, pricing: { input: 1, output: 1 } }]),
    { workspace: cwd, skipToolProbe: true }), /任务内容过长：22000 个字符（UTF-8 66000 字节），上限 64000 字节（约 21333 个中文字符或 64000 个英文字符）/)
  assert.equal(ctx.calls.length, 0)
  assert.equal(executors.taskTextProblem('a'.repeat(64_000)), null)
  assert.equal(executors.taskTextProblem(CJK(21_333)), null)
  assert.match(executors.taskTextProblem(' '), /任务内容为空/)
  assert.match(executors.taskTextProblem('a\0b'), /空字符/)
  assert.equal(executors.sliceUtf8('测试😀', 7), '测试')
  assert.equal(executors.sliceUtf8('测试😀', 10), '测试😀')
})

test('H1: a run that throws after paid steps is still recorded with their spend', async t => {
  const cwd = await workspace(t)
  const ctx = llmCtx({ providers: { anthropic: ['claude-sonnet-4-5'] } })
  let checks = 0
  const before = existsSync(STATE) ? (await readState()).runs.length : 0
  await assert.rejects(() => host.executeConfiguredAssignment(ctx, LONG_TEAM_TASK(10),
    profiles([{ provider: 'anthropic', model: 'claude-sonnet-4-5', quality: 90, pricing: { input: 1, output: 1 } }]),
    {
      workspace: cwd, skipToolProbe: true, planMode: 'team',
      skipOfficial: () => { checks += 1; if (checks === 2) throw new Error('模拟的中途异常'); return '测试：跳过 CLI。' },
    }), error => {
    assert.match(error.message, /模拟的中途异常（已完成 1 个步骤，已记录到运行 .+，费用计入预算）/)
    assert.ok(error.runId)
    return true
  })
  assert.equal(ctx.calls.length, 1, 'one paid API call before the throw')
  const state = await readState()
  assert.equal(state.runs.length, before + 1)
  const run = state.runs.at(-1)
  assert.equal(run.status, 'failed')
  assert.match(run.error, /模拟的中途异常/)
  const paid = run.packages.filter(item => item.ran)
  assert.equal(paid.length, 1)
  assert.equal(paid[0].costUsd, 0.002)
})

// ---------------------------------------------------------------- M1
test('M1: cancelling a CLI kills its whole process tree quickly', { skip: process.platform === 'win32' }, async t => {
  const cwd = await workspace(t)
  const bin = await mkdtemp(join(tmpdir(), 'model-router-fakebin-'))
  t.after(async () => { await rm(bin, { recursive: true, force: true }) })
  const pidFile = join(bin, 'grandchild.pid')
  const script = join(bin, 'claude')
  await writeFile(script, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "1.0.0 (Claude Code)"; exit 0; fi\ncat >/dev/null\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`)
  chmodSync(script, 0o755)
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath}`
  t.after(() => { process.env.PATH = oldPath })
  const controller = new AbortController()
  const started = Date.now()
  const timer = setInterval(() => { if (existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim()) { clearInterval(timer); controller.abort() } }, 20)
  const result = await executors.executeAssignedTask({
    route: { provider: 'anthropic', model: 'claude-sonnet-4-5', execution: 'official' }, task: '回答', workspace: cwd, signal: controller.signal,
    apiFallback: () => { throw new Error('api must not run on cancel') },
  })
  clearInterval(timer)
  assert.equal(result.cancelled, true)
  assert.ok(Date.now() - started < 4_000, `cancel took ${Date.now() - started} ms`)
  const grandchild = Number(readFileSync(pidFile, 'utf8').trim())
  await new Promise(resolve => setTimeout(resolve, 200))
  let alive = true
  try { process.kill(grandchild, 0) } catch { alive = false }
  if (alive) process.kill(grandchild, 'SIGKILL')
  assert.equal(alive, false, 'the CLI subprocess must not be orphaned')
})

test('M1: killProcessTree signals the POSIX group, uses System32 taskkill /T on Windows, and leaves fakes alone', () => {
  const kills = []
  const child = { pid: 4242, kill: signal => kills.push(['child', signal]) }
  executors.killProcessTree(child, 'SIGTERM', { platform: 'linux', killImpl: (pid, signal) => kills.push([pid, signal]) })
  assert.deepEqual(kills, [[-4242, 'SIGTERM']])
  kills.length = 0
  const spawned = []
  executors.killProcessTree(child, 'SIGKILL', { platform: 'win32', spawnTaskkill: (file, args) => { spawned.push([file, args]); return new EventEmitter() } })
  assert.match(spawned[0][0], /System32[\\/]taskkill\.exe$/i)
  assert.deepEqual(spawned[0][1], ['/PID', '4242', '/T', '/F'])
  executors.killProcessTree(child, 'SIGTERM', { tree: false, killImpl: () => { throw new Error('no group kill for fakes') } })
  assert.deepEqual(kills, [['child', 'SIGTERM']])
})

// ---------------------------------------------------------------- M2 / L1
test('M2: several processes appending runs to one state file lose nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-router-state-multi-'))
  const file = join(dir, 'state.json')
  const moduleUrl = new URL('../.dsh-plugin/shared/router-state.mjs', import.meta.url).href
  const code = `const { createRouterState } = await import(${JSON.stringify(moduleUrl)})
const store = createRouterState({ file: ${JSON.stringify(file)} })
await Promise.all(Array.from({ length: 10 }, (_, i) => store.appendRun({ id: process.pid + '-' + i, packages: [] })))
await store.updateRun(process.pid + '-3', run => { run.rated = true })`
  const runOne = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'inherit' })
    child.on('exit', status => status === 0 ? resolve() : reject(new Error(`exit ${status}`)))
  })
  await Promise.all([runOne(), runOne(), runOne(), runOne()])
  const state = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(state.runs.length, 40)
  assert.equal(state.runs.filter(run => run.rated).length, 4)
  assert.equal(existsSync(`${file}.lock`), false)
  // A reader in another store sees the other process's writes (no stale cache).
  const a = createRouterState({ file })
  const b = createRouterState({ file })
  assert.equal((await a.read()).runs.length, 40)
  await b.appendRun({ id: 'from-b', packages: [] })
  assert.equal((await a.read()).runs.length, 41)
  await rm(dir, { recursive: true, force: true })
})

test('M2: quota snapshots merge across processes instead of overwriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-router-state-quota-'))
  const file = join(dir, 'state.json')
  const a = createRouterState({ file })
  const b = createRouterState({ file })
  const until = Date.now() + 3_600_000
  await a.saveQuota({ 'cli:claude-code': { until } })
  await b.saveQuota({ 'cli:codex': { until } })
  assert.deepEqual(Object.keys((await a.read()).quota).sort(), ['cli:claude-code', 'cli:codex'])
  await b.saveQuota({}, { removed: ['cli:claude-code'] })
  assert.deepEqual(Object.keys((await a.read()).quota), ['cli:codex'])
  await rm(dir, { recursive: true, force: true })
})

test('L1: a corrupt state file is backed up and a notice is recorded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-router-state-corrupt-'))
  const file = join(dir, 'state.json')
  await writeFile(file, '{"version":1,"runs":[{"id":"x"', 'utf8')
  const store = createRouterState({ file })
  const state = await store.read()
  assert.equal(state.runs.length, 0)
  assert.equal(state.notices.length, 1)
  assert.equal(state.notices[0].kind, 'state-corrupt')
  assert.match(state.notices[0].message, /已损坏.*已备份为/)
  const backups = readdirSync(dir).filter(name => name.startsWith('state.json.corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), '{"version":1,"runs":[{"id":"x"')
  // The rewritten file is valid and keeps the notice for the workbench.
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.notices[0].backup, join(dir, backups[0]))
  await store.appendRun({ id: 'after', packages: [] })
  assert.equal((await createRouterState({ file }).read()).notices.length, 1)
  await rm(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------- M3 / L5
const claudeRoute = { provider: 'anthropic', model: 'claude-sonnet-4-5', execution: 'official' }
function fakeSpawn(handler) {
  const calls = []
  const spawnImpl = (file, args, options) => {
    calls.push({ file, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = { end() {} }
    child.kill = () => child.emit('close', null)
    const script = handler(file, args) ?? { code: 0, stdout: '' }
    queueMicrotask(() => { if (script.stdout) child.stdout.emit('data', Buffer.from(script.stdout)); child.emit('close', script.code ?? 0) })
    return child
  }
  return { spawnImpl, calls }
}
const loggedOutBilling = (source, extra = {}) => ({
  routes: [claudeRoute], onFailure: 'ask',
  loginBillingFor: () => 'logged-out',
  loginDetailFor: () => ({ state: 'logged-out', source, detail: 'Invalid API key · Please run /login' }),
  ...extra,
})

test('M3: a CLI that failed authentication on its subscription pauses instead of silently using the API', async t => {
  const cwd = await workspace(t)
  const api = []
  const paused = await executors.executeRouteWithBilling({
    route: claudeRoute, task: '回答', workspace: cwd, billing: loggedOutBilling('runtime-auth'),
    apiFallback: request => { api.push(request); return { ok: true, answer: 'api' } },
  })
  assert.equal(paused.paused, true)
  assert.equal(paused.pause.loginRequired, true)
  assert.deepEqual(paused.pause.choices, ['api', 'subscription', 'cancel'])
  assert.match(paused.error, /订阅登录已失效.*未自动改用 API Key/)
  assert.equal(paused.billingMode, 'subscription-first')
  assert.equal(api.length, 0)

  // onSubscriptionFailure=fail refuses; =api keeps the old automatic API behaviour.
  const failed = await executors.executeRouteWithBilling({ route: claudeRoute, task: '回答', workspace: cwd,
    billing: loggedOutBilling('runtime-auth', { onFailure: 'fail' }), apiFallback: () => { throw new Error('no api') } })
  assert.equal(failed.ok, false)
  assert.match(failed.error, /按设置不自动改用 API Key/)
  const viaApi = await executors.executeRouteWithBilling({ route: claudeRoute, task: '回答', workspace: cwd,
    billing: loggedOutBilling('runtime-auth', { onFailure: 'api' }), skipOfficial: () => '未登录，跳过。',
    apiFallback: () => ({ ok: true, answer: 'api' }) })
  assert.equal(viaApi.ok, true)
  assert.equal(viaApi.channel, 'harness-llm')

  // Retry subscription ignores the cached logged-out state and really runs the CLI.
  const { spawnImpl, calls } = fakeSpawn((file, args) => args[0] === '--version' ? { stdout: '1.0.0\n' }
    : { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '订阅回答' }) })
  const retried = await executors.executeRouteWithBilling({ route: claudeRoute, task: '回答', workspace: cwd, spawnImpl,
    billing: loggedOutBilling('runtime-auth', { choice: 'subscription' }), skipOfficial: () => '未登录，跳过。',
    apiFallback: () => { throw new Error('no api') } })
  assert.equal(retried.ok, true)
  assert.equal(retried.billing, 'subscription')
  assert.equal(calls.length, 2)
})

test('M3: a declared subscription route asks; a plain logged-out CLI still uses the API (unchanged)', async t => {
  const cwd = await workspace(t)
  const declared = { ...claudeRoute, billing: 'subscription-first' }
  const asked = await executors.executeRouteWithBilling({ route: declared, task: '回答', workspace: cwd,
    billing: loggedOutBilling('status', { routes: [declared] }), apiFallback: () => { throw new Error('no api') } })
  assert.equal(asked.paused, true)
  assert.match(asked.error, /未登录订阅账号（该路线配置为“订阅优先”）/)
  const plain = await executors.executeRouteWithBilling({ route: claudeRoute, task: '回答', workspace: cwd,
    billing: loggedOutBilling('status'), skipOfficial: () => 'Claude Code 未登录（开箱体检结果），已直接使用模型目录 API。',
    apiFallback: () => ({ ok: true, answer: 'api' }) })
  assert.equal(plain.ok, true)
  assert.equal(plain.channel, 'harness-llm')
  assert.equal(plain.billingMode, 'subscription-first', 'L5: billingMode on the logged-out path')
})

test('L5: billingMode is present on every executeRouteWithBilling result', async t => {
  const cwd = await workspace(t)
  const noBilling = await executors.executeRouteWithBilling({ route: { provider: 'deepseek', model: 'deepseek-chat' }, task: '回答', workspace: cwd,
    apiFallback: () => ({ ok: true, answer: 'api' }) })
  assert.equal(noBilling.billingMode, 'subscription-first')
  const noSub = await executors.executeRouteWithBilling({ route: { provider: 'deepseek', model: 'deepseek-chat', billing: 'api-only' }, task: '回答', workspace: cwd,
    billing: { routes: [] }, apiFallback: () => ({ ok: true, answer: 'api' }) })
  assert.equal(noSub.billingMode, 'api-only')
})

test('M3: the runtime authentication failure survives a fresh check that still says logged out, and persists', async () => {
  let now = 1_000
  const cache = createHealthCache({ ttlMs: 60_000, now: () => now })
  const report = state => ({ checkedAt: now, tools: [{ id: 'claude-code', installed: true, login: { state } }] })
  cache.markLoggedOut('claude-code', '401')
  cache.remember(report('logged-out'))
  assert.equal(cache.loginState('claude-code').source, 'runtime-auth')
  now += 120_000
  cache.remember(report('logged-out'))
  assert.equal(cache.loginState('claude-code').source, 'runtime-auth', 'still known after the TTL while logged out')
  cache.remember(report('logged-in'))
  assert.equal(cache.loginState('claude-code').state, 'logged-in')
  cache.markLoggedOut('claude-code', '401')
  assert.equal(cache.clearLoggedOut('claude-code'), true)

  const dir = await mkdtemp(join(tmpdir(), 'model-router-auth-'))
  const store = createRouterState({ file: join(dir, 'state.json') })
  await store.saveAuthFailure('claude-code', { at: 5, detail: '401' })
  assert.deepEqual((await createRouterState({ file: join(dir, 'state.json') }).read()).authFailures, { 'claude-code': { at: 5, detail: '401' } })
  await store.saveAuthFailure('claude-code', null)
  assert.deepEqual((await store.read()).authFailures, {})
  await rm(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------- M4
test('M4: explicit step references become team DAG edges', () => {
  assert.deepEqual(explicitStepReferences('设计新接口，依赖第 1 步'), [1])
  assert.deepEqual(explicitStepReferences('基于第1、2步写文档'), [1, 2])
  assert.deepEqual(explicitStepReferences('在第 3 步完成后部署'), [3])
  assert.deepEqual(explicitStepReferences('第二步之后汇总'), [2])
  assert.deepEqual(explicitStepReferences('合并，依赖第 1-3 步'), [1, 2, 3])
  assert.deepEqual(explicitStepReferences('Write docs; depends on step 2'), [2])
  assert.deepEqual(explicitStepReferences('After steps 1 and 3, deploy'), [1, 3])
  assert.deepEqual(explicitStepReferences('修改 3 个文件'), [])
  const available = [{ name: 'Flash', provider: 'p', model: 'flash', quality: 0.8, pricing: { input: 0.1, output: 0.4 } }]
  const plan = buildPlan({ mode: 'team', available, text: `目标：重构登录模块。
1. 分析现有代码。
2. 设计新接口，依赖第 1 步。
3. 实现并测试，依赖第 2 步。
4. 编写文档，基于第 2、3 步。
5. 修复样式问题，第 9 步之后（无效的前向引用被忽略）。` })
  const deps = Object.fromEntries(plan.subtasks.filter(item => item.id.startsWith('execution-')).map(item => [item.id, item.dependsOn]))
  assert.deepEqual(deps['execution-1'], ['analysis'])
  assert.deepEqual(deps['execution-2'], ['analysis', 'execution-1'])
  assert.deepEqual(deps['execution-3'], ['analysis', 'execution-2'])
  assert.deepEqual(deps['execution-4'], ['analysis', 'execution-2', 'execution-3'])
  assert.deepEqual(deps['execution-5'], ['analysis'])
})

// ---------------------------------------------------------------- L2 / L4
test('L2: cancelling mid-run stores a cancelled run and does not start later packages', async t => {
  const cwd = await workspace(t)
  const controller = new AbortController()
  const api = []
  const plan = { team: { workPackages: [
    { id: 'one', name: '一', dependsOn: [], recommendedProvider: 'deepseek', recommendedModel: 'deepseek-chat' },
    { id: 'two', name: '二', dependsOn: [], recommendedProvider: 'deepseek', recommendedModel: 'deepseek-chat' },
  ] } }
  const execution = await executors.executeAssignmentPlan({
    plan, task: '任务', workspace: cwd, signal: controller.signal, routes: [],
    apiFallback: async ({ route }) => { api.push(route); controller.abort(); throw new Error('aborted') },
  })
  assert.equal(execution.status, 'cancelled')
  assert.equal(api.length, 1)
  assert.equal(execution.packages[0].cancelled, true)
  assert.equal(execution.packages[1].notStarted, true)
  const run = buildRunRecord({ id: 'r', createdAt: 1, task: '任务', plan, execution })
  assert.equal(run.status, 'cancelled')
  assert.deepEqual(run.packages.map(item => item.status), ['cancelled', 'cancelled'])
  assert.equal(run.packages[1].ran, false)
  assert.equal(run.packages[1].costUsd, null)
})

test('L4: budget messages and the workbench use the same four-decimal USD format', () => {
  const check = budgetCheck({ estimateUsd: 0.5, spent: { today: 4.7, month: 4.7 }, dailyLimitUsd: 5 })
  assert.equal(check.message, '今日预算 $5.0000，已用 $4.7000，本次预估 $0.5000，将超出上限。')
  assert.equal(formatUsd(0.0336), '$0.0336')
  assert.equal(clientFormatUsd(5), '$5.0000')
  assert.equal(formatUsd(null), '—')
})
