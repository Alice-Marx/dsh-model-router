import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorizeOfficialRequest, admittedOfficialModel, officialModelId } from '../.dsh-plugin/shared/bot-official-execution.mjs'
import { executeAssignedTask, executeAssignmentPlan } from '../.dsh-plugin/shared/task-executors.mjs'
import { runOfficialTask, runOfficialTeam } from '../.dsh-plugin/shared/official-team-runtime.mjs'

const base = fileURLToPath(new URL('../tmp/integration/', import.meta.url))
await mkdir(base, { recursive: true })
const home = await mkdtemp(join(base, 'bot-official-execution-'))
const beforeHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const workspace = join(home, 'workspace')
await mkdir(workspace)
const core = await import('../.dsh-plugin/router-core.mjs')
test.after(async () => {
  if (beforeHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = beforeHome
  assert.ok(resolve(home).startsWith(resolve(base) + sep))
  await rm(home, { recursive: true, force: true })
})
const ctxFor = authorize => ({ get: key => key === 'botOfficialTools' ? { authorize } : key === 'botIntegrationPolicy' ? { activeIdentity: () => ({ owner: true, botId: 'test-owner' }) } : null })
const admitted = request => ({ cliModel: request.cliModel ?? 'vendor-default' })
const denied = () => { throw Object.assign(new Error('BOT_OFFICIAL_TOOL_DENIED'), { code: 'BOT_OFFICIAL_TOOL_DENIED', notStarted: true }) }
const ready = async id => ({ id, ready: true, readyModes: ['read-only'] })
const sandbox = { confine() { throw new Error('The offline runtime must never start a sandbox process') } }
const outcome = { status: 'succeeded', finalText: 'offline fixture answer', requestedModel: null, reportedModel: 'reported-vendor-model', usage: { inputTokens: 2, outputTokens: 3 }, exitCode: 0 }

test('an authorized Gemini Bot route reaches the Host runner and cannot skip it for a portable-only adapter',async()=>{
 let calls=0
 const result=await executeAssignedTask({route:{provider:'google',model:'chat-model'},task:'read fixture',workspace,
  authorizeOfficial:request=>({...admitted(request),botScoped:true}),
  runVerified:async request=>{calls++;assert.equal(request.toolId,'gemini');assert.equal(request.mode,'read-only');return outcome},
  resolvePortableLaunch:()=>{throw Error('unexpected portable launch')},apiFallback:()=>{throw Error('unexpected API fallback')}})
 assert.equal(calls,1);assert.equal(result.ok,true);assert.equal(result.answer,outcome.finalText)
})

test('default identity is an authorization sentinel, never a CLI model argument', async () => {
  assert.equal(officialModelId('vendor-default'), null)
  assert.equal(officialModelId('provider/model'), 'provider/model')
  assert.throws(() => officialModelId('--model=forged'))
  const seen = []
  const value = await authorizeOfficialRequest(ctxFor(request => { seen.push(request); return admitted(request) }),
    { toolId: 'claude-code', cliModel: 'vendor-default', mode: 'read-only' })
  assert.equal(value.modelId, null)
  assert.equal(value.cliModel, 'vendor-default')
  assert.equal(seen[0].cliModel, 'vendor-default')
  assert.equal(Object.hasOwn(seen[0], 'botId'), false)
})

test('product policy without its admission service fails closed; standalone router stays compatible', async () => {
  await assert.rejects(authorizeOfficialRequest({ get: () => ({}) }, { toolId: 'codex' }), /BOT_OFFICIAL_TOOLS_UNAVAILABLE/)
  assert.equal((await authorizeOfficialRequest({}, { toolId: 'codex' })).modelId, null)
})

test('concurrent calls preserve the Host policy frame and cannot supply a different Bot identity', async () => {
  const frames = new AsyncLocalStorage()
  const ctx = ctxFor(async request => {
    const bot = frames.getStore()
    await new Promise(resolve => setTimeout(resolve, bot === 'a' ? 8 : 1))
    assert.equal(frames.getStore(), bot)
    assert.equal(request.botId, undefined)
    return { cliModel: bot === 'a' ? 'a-model' : 'b-model' }
  })
  const result = await Promise.all(['a', 'b'].map(bot => frames.run(bot, () => authorizeOfficialRequest(ctx, { toolId: 'codex', botId: 'forged' }))))
  assert.deepEqual(result.map(item => item.modelId), ['a-model', 'b-model'])
})

test('admission rejection is marked not started before any official CLI or API fallback', async () => {
  let spawned = 0, fallback = 0
  await assert.rejects(executeAssignedTask({ route: { provider: 'anthropic', model: 'chat-model' }, task: 'Read fixture', workspace,
    authorizeOfficial: async request => authorizeOfficialRequest(ctxFor(denied), request),
    runVerified: async () => { spawned++; return outcome }, apiFallback: async () => { fallback++ } }), /BOT_OFFICIAL_TOOL_DENIED/)
  assert.equal(spawned, 0)
  assert.equal(fallback, 0)
  await assert.rejects(authorizeOfficialRequest(ctxFor(() => { throw new Error('logged out') }), { toolId: 'codex' }), error => error.notStarted === true)
})

test('a lost product call frame never becomes an owner or portable execution', async () => {
  const ctx = { get: key => key === 'botOfficialTools' ? { authorize: admitted }
    : key === 'botIntegrationPolicy' ? { activeIdentity: () => null } : null }
  await assert.rejects(authorizeOfficialRequest(ctx, { toolId: 'codex' }), /BOT_OFFICIAL_CALL_CONTEXT_REQUIRED/)
})

for (const status of ['unsupported', 'failed', 'timed-out']) test(`Bot-scoped ${status} cannot fall back to portable CLI or API`, async () => {
  let portable = 0, api = 0
  const result = await executeAssignedTask({ route: { provider: 'anthropic', model: 'chat-model' }, task: 'read fixture', workspace,
    authorizeOfficial: request => ({ ...admitted(request), botScoped: true }),
    runVerified: async () => ({ status, reason: status === 'failed' ? 'Authentication failed' : 'fixture failure', usage: { inputTokens: 4, outputTokens: 0 } }),
    resolvePortableLaunch: async () => { portable++; return { reason: 'must not happen' } },
    apiFallback: async () => { api++; return { ok: true, answer: 'must not happen' } } })
  assert.equal(result.ok, false)
  assert.equal(result.noApiFallback, true)
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 0 })
  assert.equal(portable, 0)
  assert.equal(api, 0)
})

test('an authenticated owner keeps the established explicit fallback policy', async () => {
  let portable = 0, api = 0
  const result = await executeAssignedTask({ route: { provider: 'anthropic', model: 'chat-model' }, task: 'read fixture', workspace,
    authorizeOfficial: admitted, runVerified: async () => ({ status: 'unsupported' }),
    resolvePortableLaunch: async () => { portable++; return { reason: 'offline missing CLI' } },
    apiFallback: async () => { api++; return { ok: true, answer: 'offline API fixture' } } })
  assert.equal(result.ok, true)
  assert.equal(portable, 1)
  assert.equal(api, 1)
})

test('actual routed adapter receives null for a saved vendor-default identity', async () => {
  const requests = []
  const result = await executeAssignedTask({ route: { provider: 'anthropic', model: 'independent-chat-model', cliModel: 'vendor-default' },
    task: 'Read fixture', workspace, authorizeOfficial: admitted,
    runVerified: async request => { requests.push(request); return outcome }, apiFallback: async () => { throw new Error('Unexpected API fallback') } })
  assert.equal(result.ok, true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].modelId, null)
})

test('manual package authorization failure cannot execute or silently use API', async () => {
  let launched = 0
  const execution = await executeAssignmentPlan({
    plan: { team: { workPackages: [{ id: 'one', name: 'read', dependsOn: [], recommendedProvider: 'official-tool', recommendedModel: 'codex',
      manualAssignment: { kind: 'tool', toolId: 'codex' } }] } }, task: 'read fixture', routes: [], workspace,
    authorizeOfficial: denied, runVerified: async () => { launched++; return outcome }, apiFallback: async () => { throw new Error('Unexpected API fallback') },
  })
  assert.equal(launched, 0)
  assert.equal(execution.packages[0].ok, false)
  assert.equal(execution.packages[0].notStarted, true)
})

test('single-task runtime rechecks saved identity after its durable start checkpoint', async () => {
  let valid = true, launched = 0
  const authorizeOfficial = request => { if (!valid) return denied(); return admitted(request) }
  const result = await runOfficialTask({ toolId: 'codex', task: 'read fixture', modelId: 'vendor-default', workspace, allowedRoot: workspace,
    sandbox, authorizeOfficial, runtime: { readiness: ready, runTool: async () => { launched++; return outcome } },
    onCheckpointStart: () => { valid = false } })
  assert.equal(launched, 0)
  assert.equal(result.status, 'failed')
  assert.equal(result.notStarted, true)
  assert.match(result.error, /BOT_OFFICIAL_TOOL_DENIED/)
})

test('team runtime preflights every tool and prevents partial unauthorized execution', async () => {
  let launched = 0
  const plan = { team: { workPackages: [
    { id: 'a', name: 'one', dependsOn: [], recommendedProvider: 'anthropic', recommendedModel: 'chat-a' },
    { id: 'b', name: 'two', dependsOn: ['a'], recommendedProvider: 'openai', recommendedModel: 'chat-b' },
  ] } }
  await assert.rejects(runOfficialTeam({ plan, task: 'read fixture', workspace, allowedRoot: workspace, installedIds: ['claude-code', 'codex'],
    sandbox, authorizeOfficial: request => request.toolId === 'codex' ? denied() : admitted(request),
    runtime: { capabilities: [{ id: 'claude-code', supported: true, modes: ['read-only'] }, { id: 'codex', supported: true, modes: ['read-only'] }],
      readiness: ready, runTool: async () => { launched++; return outcome } } }), /BOT_OFFICIAL_TOOL_DENIED/)
  assert.equal(launched, 0)
})

test('shared native entry uses the real task/checkpoint/ledger path and default CLI model', async () => {
  let launched = 0, admissions = 0
  const ctx = { ...ctxFor(request => { admissions++; return admitted(request) }), sandbox }
  const result = await core.executeBotOfficialTool(ctx, {}, { tool: 'codex', task: 'read fixture', cliModel: 'vendor-default' },
    { cwd: workspace, root: workspace, runTask: request => runOfficialTask({ ...request,
      runtime: { readiness: ready, runTool: async request => { launched++; assert.equal(request.modelId, null); return outcome } } }) })
  assert.equal(result.status, 'succeeded')
  assert.equal(launched, 1)
  assert.ok(admissions >= 3)
  assert.equal(result.modelNotice.includes('默认模型'), true)
  const state = await core.routerStateStore().read()
  const run = state.runs.find(item => item.id === result.runId)
  assert.ok(run)
  assert.equal(run.toolRun.cliModel, 'vendor-default')
  assert.equal(run.packages[0].requestedCliModel, null)
  assert.equal(run.packages[0].actualModel, 'reported-vendor-model')
})
