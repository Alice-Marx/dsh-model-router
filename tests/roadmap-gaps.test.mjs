import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strictCtx } from './helpers/strict-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-gaps-'))
for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'MINIMAX_API_KEY', 'MIMO_API_KEY', 'XAI_API_KEY']) delete process.env[name]

const { checkLogin, credentialFileFor, createHealthCache, LOGIN_GUIDES, minimaxAuthStateFiles, subscriptionLoginOf } = await import('../.dsh-plugin/shared/tool-health.mjs')
const { createQuotaTracker } = await import('../.dsh-plugin/shared/subscription-billing.mjs')
const { createRouterState } = await import('../.dsh-plugin/shared/router-state.mjs')
const { usageFromEvents } = await import('../.dsh-plugin/shared/task-executors.mjs')
const { createMiMoGrokParser } = await import('../.dsh-plugin/shared/vendor-mimo-grok-adapter.mjs')
const { runOfficialTeam } = await import('../.dsh-plugin/shared/official-team-runtime.mjs')
const { parseRunRequest, OFFICIAL_TOOLS_REMOTE_DESCRIPTORS } = await import('../.dsh-plugin/shared/official-tools-remote.mjs')
const { launchRequest, rerunConfirmations } = await import('../.dsh-plugin/client/insights-state.mjs')
const host = await import('../.dsh-plugin/index.mjs')

const tempDir = async (t, prefix = 'model-router-gaps-ws-') => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

// ---------------------------------------------------------------- item 4
test('Kimi, MiMo and Grok login comes from their verified credential files (existence only)', async () => {
  const home = '/home/u'
  assert.equal(credentialFileFor('kimi-code', { home, env: {} }), '/home/u/.kimi-code/credentials/kimi-code.json')
  assert.equal(credentialFileFor('kimi-code', { home, env: { KIMI_CODE_HOME: '/opt/kimi/' } }), '/opt/kimi/credentials/kimi-code.json')
  assert.equal(credentialFileFor('mimo-code', { home, env: {} }), '/home/u/.local/share/mimocode/auth.json')
  assert.equal(credentialFileFor('mimo-code', { home, env: { XDG_DATA_HOME: '/data' } }), '/data/mimocode/auth.json')
  assert.equal(credentialFileFor('grok-build', { home, env: {} }), '/home/u/.grok/auth.json')
  assert.equal(credentialFileFor('grok-build', { home, env: { GROK_HOME: '/g' } }), '/g/auth.json')
  const seen = []
  const present = path => { seen.push(path); return true }
  const kimi = await checkLogin('kimi-code', { home, env: {}, exists: present })
  assert.equal(kimi.state, 'logged-in')
  assert.equal(kimi.source, 'file')
  assert.equal(subscriptionLoginOf(kimi), 'subscription')
  const grok = await checkLogin('grok-build', { home, env: {}, exists: present })
  assert.equal(grok.state, 'logged-in')
  const mimo = await checkLogin('mimo-code', { home, env: {}, exists: present })
  assert.equal(mimo.state, 'logged-in')
  assert.equal(subscriptionLoginOf(mimo), 'unknown', 'MiMo auth.json may hold only provider API keys')
  assert.deepEqual(seen, ['/home/u/.kimi-code/credentials/kimi-code.json', '/home/u/.grok/auth.json', '/home/u/.local/share/mimocode/auth.json'])
  for (const toolId of ['kimi-code', 'grok-build', 'mimo-code']) {
    const missing = await checkLogin(toolId, { home, env: {}, exists: () => false })
    assert.equal(missing.state, 'unknown', `${toolId}: a missing file is not proof of logout (custom providers / free channel)`)
    assert.ok(missing.detail.length > 10)
  }
})

test('API-key variables count for Kimi/MiniMax/MiMo/Grok; MiniMax without a state file and ZCode stay unknown with official login steps', async () => {
  const viaKey = await checkLogin('kimi-code', { home: '/h', env: { KIMI_API_KEY: 'x' }, exists: () => false })
  assert.equal(viaKey.state, 'logged-in')
  assert.equal(viaKey.billing, 'api-key')
  assert.equal(subscriptionLoginOf(viaKey), 'api-key')
  assert.equal((await checkLogin('minimax-code', { env: { MINIMAX_API_KEY: 'k' } })).billing, 'api-key')
  const minimax = await checkLogin('minimax-code', { home: '/h', env: {} })
  assert.equal(minimax.state, 'unknown')
  assert.match(minimax.detail, /未找到 MiniMax Code 登录状态文件/)
  const zcode = await checkLogin('zcode', { home: '/h', env: {} })
  assert.equal(zcode.state, 'unknown')
  assert.equal(LOGIN_GUIDES['kimi-code'].command, 'kimi login')
  assert.equal(LOGIN_GUIDES['minimax-code'].command, 'mcode login')
  assert.equal(LOGIN_GUIDES['mimo-code'].command, 'mimo auth login')
  assert.equal(LOGIN_GUIDES['grok-build'].command, 'grok login')
  assert.match(LOGIN_GUIDES.zcode.steps, /连接 BigModel|编程套餐/)
  assert.match(LOGIN_GUIDES.zcode.steps, /coding\/paas\/v4/)
})

test('MiniMax login comes from the status field of its non-secret auth-state.json (per region)', async () => {
  assert.deepEqual(minimaxAuthStateFiles({ home: 'C:\\Users\\u', env: {} }).map(item => item.path),
    ['C:\\Users\\u/.minimax/auth/prod/cn/mcode-public/auth-state.json', 'C:\\Users\\u/.minimax/auth/prod/global/mcode-public/auth-state.json'])
  assert.equal(minimaxAuthStateFiles({ home: '/h', env: { MINIMAX_DATA_DIR: '/data/mm/' } })[0].path, '/data/mm/auth/prod/cn/mcode-public/auth-state.json')
  const states = map => async path => map[path.includes('/cn/') ? 'cn' : 'global'] ?? null
  const signedIn = await checkLogin('minimax-code', { home: '/h', env: {}, readAuthState: states({ cn: { status: 'authenticated', storeKind: 'file' } }) })
  assert.equal(signedIn.state, 'logged-in')
  assert.match(signedIn.detail, /国内站/)
  assert.equal(subscriptionLoginOf(signedIn), 'subscription')
  const anonymous = await checkLogin('minimax-code', { home: '/h', env: {}, readAuthState: states({ cn: { status: 'anonymous' }, global: { status: 'anonymous' } }) })
  assert.equal(anonymous.state, 'unknown', 'a saved API key (mcode set-minimax-key) still works without OAuth')
  assert.match(anonymous.detail, /账号未登录.*mcode login/)
  const broken = await checkLogin('minimax-code', { home: '/h', env: {}, readAuthState: async () => { throw new Error('EACCES') } })
  assert.equal(broken.state, 'unknown')
  const keyed = await checkLogin('minimax-code', { home: '/h', env: { MINIMAX_API_KEY: 'k' }, readAuthState: states({ global: { status: 'refreshing' } }) })
  assert.equal(keyed.state, 'logged-in')
  assert.equal(keyed.billing, 'api-key', 'an API-key variable still decides billing')
})

test('Grok login hints name the relocated GROK_HOME the plugin uses on Windows', async () => {
  const missing = await checkLogin('grok-build', { home: 'C:\\Users\\u', env: { GROK_HOME: 'D:\\npm\\.model-router-grok' }, exists: () => false })
  assert.equal(missing.state, 'unknown')
  assert.match(missing.detail, /D:\\npm\\\.model-router-grok\/auth\.json/)
  assert.match(missing.detail, /\$env:GROK_HOME='D:\\npm\\\.model-router-grok'; grok login/)
  const plain = await checkLogin('grok-build', { home: '/h', env: {}, exists: () => false })
  assert.doesNotMatch(plain.detail, /GROK_HOME=/)
  assert.match(plain.detail, /\/h\/\.grok\/auth\.json/)
})

// ---------------------------------------------------------------- item 3
test('quota tracker sync adopts marks and clears from other processes, keeps unsaved local marks', () => {
  let now = 1_000
  const tracker = createQuotaTracker({ now: () => now })
  tracker.load({ 'cli:codex': { until: 50_000, kind: 'quota', markedAt: 900 } })
  // Another process marks claude and clears codex.
  assert.equal(tracker.sync({ 'cli:claude-code': { until: 60_000, kind: 'rate-limit', markedAt: 950 } }), 2)
  assert.equal(tracker.status('cli:codex'), null)
  assert.equal(tracker.status('cli:claude-code').kind, 'rate-limit')
  // A local mark not yet on disk survives a sync that does not contain it.
  now = 2_000
  tracker.mark('cli:gemini', { kind: 'quota' }, { cooldownMinutes: 5 })
  tracker.sync({ 'cli:claude-code': { until: 60_000, kind: 'rate-limit', markedAt: 950 } })
  assert.ok(tracker.status('cli:gemini'))
  // Once seen on disk, its removal by another process is adopted.
  const saved = tracker.snapshot()
  tracker.sync(saved)
  const { 'cli:gemini': _gone, ...rest } = saved
  tracker.sync(rest)
  assert.equal(tracker.status('cli:gemini'), null)
  // A newer on-disk mark wins over the in-memory one.
  tracker.sync({ ...rest, 'cli:claude-code': { until: 90_000, kind: 'quota', markedAt: 1_500 } })
  assert.equal(tracker.status('cli:claude-code').until, 90_000)
})

test('health cache sync adopts auth failures and their removal from the shared state', () => {
  let now = 10_000
  const cache = createHealthCache({ now: () => now })
  cache.sync({ authFailures: { codex: { at: 9_000, detail: 'not logged in' } } })
  assert.equal(cache.loginState('codex').state, 'logged-out')
  cache.sync({ authFailures: {} })
  assert.equal(cache.loginState('codex'), null, 'another process saw the CLI work again')
  // A local failure that is not on disk yet is kept.
  cache.markLoggedOut('claude-code', 'expired', now)
  cache.sync({ authFailures: {} })
  assert.equal(cache.loginState('claude-code').state, 'logged-out')
  // A newer health report written by another process replaces an older one.
  cache.remember({ checkedAt: 1, tools: [] })
  cache.sync({ health: { checkedAt: 9_999, tools: [{ id: 'gemini', installed: true, login: { state: 'logged-in' } }] } })
  assert.equal(cache.report().checkedAt, 9_999)
})

test('host picks up a quota mark saved by another process without restart', async () => {
  const other = createRouterState()
  assert.deepEqual(Object.keys(await host.currentQuotaSnapshot()), [])
  await other.saveQuota({ 'cli:codex': { until: Date.now() + 60_000, kind: 'quota', markedAt: Date.now(), detail: 'limit', source: 't' } })
  assert.ok((await host.currentQuotaSnapshot())['cli:codex'], 'second process mark visible on next call')
  await other.saveQuota({}, { removed: ['cli:codex'] })
  assert.equal((await host.currentQuotaSnapshot())['cli:codex'], undefined, 'second process clear visible on next call')
})

// ---------------------------------------------------------------- item 5
test('over-budget and unsandboxed CLI reasons are combined into one approval prompt', () => {
  const codes = host.approvalReasonCodes('model_router_execute', { task: 'x', confirmOverBudget: true }, {})
  assert.deepEqual(codes, ['over-budget', 'unsandboxed'])
  const ask = host.combinedAsk(codes.map(code => ({ code, reason: code, en: `${code} en`, zh: `${code} zh` })))
  assert.equal(ask.kind, 'ask')
  assert.match(ask.displayReason.zh, /以下 2 项[\s\S]*1\. over-budget zh[\s\S]*2\. unsandboxed zh/)
  assert.deepEqual(host.approvalReasonCodes('model_router_execute', { confirmOverBudget: true }, { confirmUnsandboxedCli: false }), ['over-budget'])
  assert.deepEqual(host.approvalReasonCodes('model_router_tool_run', { mode: 'workspace-write', confirmOverBudget: true }, {}), ['workspace-write', 'over-budget'])
  assert.deepEqual(host.approvalReasonCodes('model_router_team_execute', { mode: 'read-only' }, {}), [])
  assert.deepEqual(host.approvalReasonCodes('model_router_tool_install', {}, {}), [])
  const writeRun = { kind: 'team', executionMode: 'workspace-write', status: 'incomplete', isolatedWorkspace: '/w', baseCommit: 'a'.repeat(40) }
  assert.deepEqual(host.approvalReasonCodes('model_router_rerun_step', { confirmOverBudget: true }, {}, { rerunRun: writeRun }), ['rerun-write', 'over-budget'])
})

test('the pre-execute hook asks once with every reason', async () => {
  const events = []
  const ctx = {
    on: (name, handler) => events.push({ name, handler }),
    tools: { register() {} }, commands: { register() {} },
    llm: { listProviders: () => [] },
  }
  host.apply(ctx, {})
  const gate = events.find(item => item.name === 'tools/pre-execute').handler
  const allow = async () => ({ kind: 'allow' })
  const decision = await gate({ name: 'model_router_execute', arguments: { task: 'x', confirmOverBudget: true } }, allow)
  assert.equal(decision.kind, 'ask')
  assert.deepEqual(decision.reasons, ['over-budget', 'unsandboxed'])
  assert.match(decision.displayReason.zh, /超出预算[\s\S]*不经沙箱/)
  const tool = await gate({ name: 'model_router_tool_run', arguments: { tool: 'kimi-code', task: 'x', mode: 'workspace-write', confirmOverBudget: true } }, allow)
  assert.deepEqual(tool.reasons, ['workspace-write', 'over-budget'])
})

// ---------------------------------------------------------------- item 2
test('model_router_tool_run estimates cost and pauses on an exhausted budget', async () => {
  const ctx = { llm: { listProviders: () => [] } }
  const planned = await host.planToolRun(ctx, {}, { tool: 'codex', task: '读代码' })
  assert.equal(planned.estimate, null)
  assert.equal(planned.budget.exceeded, null)
  await assert.rejects(() => host.planToolRun(ctx, {}, { tool: 'nope', task: 'x' }), /未知的官方工具/)
  await assert.rejects(() => host.planToolRun(ctx, {}, { tool: 'codex', task: 'x', provider: 'openai' }), /同时提供/)
  // Spend already at the daily limit: even an unknown estimate pauses.
  await host.routerStateStore().appendRun({ id: 'spent-1', createdAt: Date.now(), finishedAt: Date.now(), kind: 'assign', task: '已花费', workspace: '',
    packages: [{ id: 'p', name: 'p', ran: true, ok: true, finishedAt: Date.now(), billing: 'api', costUsd: 2, answer: '' }], reviews: [] })
  const over = await host.planToolRun(ctx, { dailyBudgetUsd: 1 }, { tool: 'codex', task: '读代码' })
  assert.equal(over.budget.exceeded, 'daily')
  assert.match(over.budget.message, /今日预算/)
})

// ---------------------------------------------------------------- item 1
const routeCtx = () => strictCtx({
  llm: {
    listProviders: () => ['openai'],
    listModels: async () => [{ id: 'gpt-x' }],
    resolveModelInfo: async () => ({}),
  },
})
const planOptions = { skipToolProbe: true, installedToolIds: [], runnableToolIds: [], loggedOutToolIds: [] }

test('workbench run: preview lists plan, estimate and reasons; start refuses until all are confirmed', async t => {
  const workspace = await tempDir(t)
  const request = parseRunRequest({ task: '总结这个项目', planMode: 'single', preset: 'economy', workspace })
  const preview = await host.previewWorkbenchRun(routeCtx(), {}, request, { planOptions })
  assert.equal(preview.workspace, workspace)
  assert.equal(preview.selected.provider, 'openai')
  assert.equal(preview.readOnly, true)
  assert.ok(Array.isArray(preview.decision.packages))
  assert.deepEqual(preview.reasons.map(item => item.code), ['unsandboxed'])
  assert.match(preview.reasons[0].zh, /不经沙箱/)
  let executed = null
  const execute = async (_ctx, task, _config, options) => { executed = { task, options }; return { plan: { selected: null }, runId: 'run-1', budget: { exceeded: null }, execution: { status: 'succeeded' } } }
  const refused = await host.startWorkbenchRun(routeCtx(), {}, request, { planOptions, execute })
  assert.equal(refused.status, 'needs-confirmation')
  assert.deepEqual(refused.missing, ['unsandboxed'])
  assert.equal(executed, null, 'nothing runs before confirmation')
  const started = await host.startWorkbenchRun(routeCtx(), {}, { ...request, confirmedReasons: ['unsandboxed'] }, { planOptions, execute })
  assert.equal(started.status, 'succeeded')
  assert.equal(started.runId, 'run-1')
  assert.equal(executed.options.workspace, workspace)
  assert.equal(executed.options.confirmOverBudget, false)
  assert.equal(executed.options.preset, 'economy')
  // Spend over the daily limit: the preview lists budget and unsandboxed CLI together, and start needs both.
  const tight = { dailyBudgetUsd: 0.5, overBudgetAction: 'pause' }
  const over = await host.previewWorkbenchRun(routeCtx(), tight, request, { planOptions })
  assert.deepEqual(over.reasons.map(item => item.code), ['over-budget', 'unsandboxed'])
  const partial = await host.startWorkbenchRun(routeCtx(), tight, { ...request, confirmedReasons: ['unsandboxed'] }, { planOptions, execute })
  assert.deepEqual(partial.missing, ['over-budget'])
  executed = null
  await host.startWorkbenchRun(routeCtx(), tight, { ...request, confirmedReasons: ['over-budget', 'unsandboxed'] }, { planOptions, execute })
  assert.equal(executed.options.confirmOverBudget, true)
})

test('workbench run: single model, workspace validation and request codec', async t => {
  const workspace = await tempDir(t)
  const direct = await host.previewWorkbenchRun(routeCtx(), {}, { task: 'x', provider: 'openai', model: 'gpt-x', workspace }, { planOptions })
  assert.equal(direct.routingBypassed, true)
  await assert.rejects(() => host.previewWorkbenchRun(routeCtx(), {}, { task: 'x', provider: 'openai', model: 'missing', workspace }, { planOptions }), /不在 Harness 模型目录/)
  await assert.rejects(() => host.workbenchWorkspace('relative/path'), /绝对路径/)
  await assert.rejects(() => host.workbenchWorkspace(join(workspace, 'missing')), /不存在/)
  assert.equal(await host.workbenchWorkspace('', [{ workspace }]), workspace, 'falls back to the last run workspace')
  assert.throws(() => parseRunRequest({ task: '' }))
  assert.throws(() => parseRunRequest({ task: 'x', provider: 'openai' }))
  assert.throws(() => parseRunRequest({ task: 'x', confirmedReasons: ['rm -rf'] }))
  assert.deepEqual(parseRunRequest({ task: 'x', preset: 'weird', planMode: 'team', budgetUsd: 1 }), { task: 'x', planMode: 'team', budgetUsd: 1, confirmedReasons: [] })
  assert.ok(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.some(item => item.method === 'previewRun'))
  assert.deepEqual(launchRequest({ task: 't', mode: 'direct', directRoute: { provider: 'a', model: 'b' }, budgetUsd: '0.5', workspace: ' /w ' }),
    { task: 't', provider: 'a', model: 'b', budgetUsd: 0.5, workspace: '/w' })
})

// ---------------------------------------------------------------- item 6
function git(cwd, ...args) { return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString() }
// Git for Windows defaults to core.autocrlf=true, so checkouts and `git apply` write CRLF there.
const readText = async path => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')
const sandbox = { confine() { throw new Error('mock runner must never spawn a CLI') } }
const pkg = (id, provider, dependsOn = []) => ({ id, name: `Package ${id}`, type: 'execution', purpose: 'execution', dependsOn, objective: id, recommendedProvider: provider, recommendedModel: 'm' })

test('an editable team that stopped at a failed step continues in a fresh worktree seeded with earlier changes', async t => {
  const temporary = await tempDir(t, 'model-router-gaps-team-')
  const workspace = join(temporary, 'repo')
  await mkdir(workspace)
  git(workspace, 'init', '-q')
  await writeFile(join(workspace, 'README.md'), 'base\n')
  git(workspace, 'add', 'README.md')
  git(workspace, '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init')
  const plan = { team: { workPackages: [pkg('a', 'moonshot'), pkg('b', 'minimax', ['a'])] } }
  const common = { plan, task: 'two steps', workspace, allowedRoot: temporary, mode: 'workspace-write', installedIds: ['kimi-code', 'minimax-code'], sandbox }
  const first = await runOfficialTeam({ ...common, runtime: {
    async readiness(id) { return { id, ready: true } },
    async runTool(options) {
      if (options.toolId === 'kimi-code') { await writeFile(join(options.workspace, 'a.txt'), 'from a\n'); return { status: 'succeeded', finalText: 'a done' } }
      return { status: 'failed', error: 'b broke' }
    },
  } })
  assert.equal(first.status, 'incomplete')
  assert.match(first.baseCommit, /^[0-9a-f]{40}$/)
  await assert.rejects(readFile(join(workspace, 'a.txt')), { code: 'ENOENT' }, 'nothing integrated yet')
  await assert.rejects(runOfficialTeam({ ...common, onlyIds: ['b'] }), /seedFrom/)
  const calls = []
  const retry = await runOfficialTeam({ ...common, onlyIds: ['b'], previous: [{ id: 'a', name: 'Package a', finalText: 'a done' }],
    seedFrom: { workspace: first.workspace, baseCommit: first.baseCommit }, runtime: {
      async readiness(id) { return { id, ready: true } },
      async runTool(options) {
        calls.push(options)
        assert.notEqual(options.workspace, first.workspace, 'a fresh worktree')
        assert.equal(await readText(join(options.workspace, 'a.txt')), 'from a\n', 'earlier changes were applied first')
        await writeFile(join(options.workspace, 'b.txt'), 'from b\n')
        return { status: 'succeeded', finalText: 'b done' }
      },
    } })
  assert.equal(calls.length, 1)
  assert.match(calls[0].task, /a done/)
  assert.equal(retry.status, 'cli-completed')
  assert.deepEqual(retry.seeded.files, ['a.txt'])
  assert.equal(await readText(join(workspace, 'a.txt')), 'from a\n')
  assert.equal(await readText(join(workspace, 'b.txt')), 'from b\n')
  // A moved HEAD makes seeding unsafe: refused, nothing runs.
  git(workspace, 'add', '-A')
  git(workspace, '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'integrated')
  const moved = await runOfficialTeam({ ...common, onlyIds: ['b'], seedFrom: { workspace: first.workspace, baseCommit: first.baseCommit }, runtime: {
    async readiness(id) { return { id, ready: true } }, async runTool() { throw new Error('must not run') } } })
  assert.equal(moved.status, 'blocked')
  assert.match(moved.blocking[0].reason, /HEAD 已不是原运行的基线/)
})

test('host rerun of an editable team step needs confirmWrite and passes the recorded worktree as seed', async t => {
  const cwd = await tempDir(t)
  const plan = { mode: 'team', team: { workPackages: [pkg('a', 'moonshot'), pkg('b', 'minimax', ['a'])] } }
  const run = await host.recordTeamRun({ task: '改', plan, mode: 'workspace-write', workspace: cwd, routes: [], startedAt: Date.now(),
    execution: { status: 'incomplete', workspace: join(cwd, 'wt'), baseCommit: 'b'.repeat(40), results: [
      { id: 'a', status: 'succeeded', provider: 'moonshot', recommendedModel: 'm', toolId: 'kimi-code', finalText: 'a ok' },
      { id: 'b', status: 'failed', provider: 'minimax', recommendedModel: 'm', toolId: 'minimax-code', finalText: '', error: 'boom' }] } })
  assert.equal(run.baseCommit, 'b'.repeat(40))
  const ctx = { llm: { listProviders: () => [] }, sandbox }
  await assert.rejects(() => host.rerunRecordedStep(ctx, {}, { runId: run.id, packageId: 'a', provider: 'moonshot', model: 'm', confirmWrite: true }), /只能续跑失败|不在 Harness 模型目录/)
  const paused = await host.rerunRecordedStep(ctx, {}, { runId: run.id, packageId: 'b' })
  assert.equal(paused.paused, true)
  assert.deepEqual(paused.needsConfirmation, ['workspace-write'])
  let received = null
  const result = await host.rerunRecordedStep(ctx, {}, { runId: run.id, packageId: 'b', confirmWrite: true, installedToolIds: ['kimi-code', 'minimax-code'],
    runTeam: async options => { received = options; return { status: 'cli-completed', workspace: join(cwd, 'wt2'), baseCommit: 'b'.repeat(40),
      integration: { integrated: true, ignoredArtifacts: 0 }, results: [{ id: 'b', status: 'succeeded', provider: 'minimax', recommendedModel: 'm', toolId: 'minimax-code', finalText: 'b ok' }] } } })
  assert.equal(received.mode, 'workspace-write')
  assert.deepEqual(received.onlyIds, ['b'])
  assert.deepEqual(received.seedFrom, { workspace: join(cwd, 'wt'), baseCommit: 'b'.repeat(40) })
  assert.equal(result.run.status, 'cli-completed')
  assert.equal(result.run.isolatedWorkspace, join(cwd, 'wt2'))
  await assert.rejects(() => host.rerunRecordedStep(ctx, {}, { runId: run.id, packageId: 'b', confirmWrite: true }), /已整合|已成功/)
})

test('client rerun confirmations list every reason for one prompt', () => {
  const ledger = { settings: { confirmUnsandboxedCli: true }, spent: { today: 5, month: 5 }, budget: { dailyLimitUsd: 1, monthlyLimitUsd: 0 } }
  const health = { tools: [{ id: 'codex', installed: true, login: { state: 'logged-in' } }] }
  const reasons = rerunConfirmations({ run: { kind: 'assign' }, item: { provider: 'openai', estimatedCost: 0.1 }, ledger, health,
    toolFor: () => ({ id: 'codex', label: 'Codex' }), headlessIds: new Set(['codex']) })
  assert.deepEqual(reasons.map(item => item.code), ['unsandboxed', 'over-budget'])
  const write = rerunConfirmations({ run: { kind: 'tool', executionMode: 'workspace-write' }, item: { provider: 'moonshot' }, ledger: { settings: {} } })
  assert.deepEqual(write.map(item => item.code), ['workspace-write'])
})

// ---------------------------------------------------------------- item 7
test('usage and cost are read from Grok, MiMo and MiniMax output', () => {
  const grok = usageFromEvents('grok-end', { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 2 }, total_cost_usd: 0.0127 })
  assert.deepEqual(grok, { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 2 }, reportedCostUsd: 0.0127 })
  assert.equal(usageFromEvents('grok-end', { usage: { input_tokens: 1 }, total_cost_usd: 1, cost_is_partial: true }).reportedCostUsd, undefined)
  const mimo = usageFromEvents('mimo-steps', [
    { tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 50, write: 0 } }, cost: 0.001 },
    { tokens: { input: 20, output: 2, reasoning: 0, cache: { read: 0, write: 3 } }, cost: 0.0005 }])
  assert.deepEqual(mimo, { usage: { inputTokens: 120, outputTokens: 17, cacheReadTokens: 50, cacheWriteTokens: 3 }, reportedCostUsd: 0.0015 })
  assert.deepEqual(usageFromEvents('minimax-result', { usage: { inputTokens: 7, outputTokens: 3, reasoningTokens: 1, cacheReadTokens: 2 } }).usage,
    { inputTokens: 7, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 0 })
  assert.equal(usageFromEvents('minimax-result', { usage: { inputTokens: 7 }, usageSource: 'unavailable' }), null)

  const grokParser = createMiMoGrokParser('grok-build')
  grokParser.push(JSON.stringify({ type: 'text', data: 'hi' }))
  grokParser.push(JSON.stringify({ type: 'end', stopReason: 'end_turn', sessionId: 's', usage: { input_tokens: 3, output_tokens: 4 }, total_cost_usd: 0.002 }))
  const grokDone = grokParser.finish(0)
  assert.equal(grokDone.status, 'succeeded')
  assert.deepEqual(grokDone.usage, { inputTokens: 3, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(grokDone.reportedCostUsd, 0.002)
  const mimoParser = createMiMoGrokParser('mimo-code')
  mimoParser.push(JSON.stringify({ type: 'text', sessionID: 's', part: { type: 'text', text: 'ok', time: { end: 1 } } }))
  mimoParser.push(JSON.stringify({ type: 'step_finish', sessionID: 's', part: { type: 'step-finish', reason: 'stop', tokens: { input: 9, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.0001 } }))
  const mimoDone = mimoParser.finish(0)
  assert.equal(mimoDone.status, 'succeeded')
  assert.equal(mimoDone.usage.inputTokens, 9)
  assert.equal(mimoDone.reportedCostUsd, 0.0001)
})
