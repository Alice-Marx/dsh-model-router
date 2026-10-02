import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  billingOverview, billingPlan, createQuotaTracker, detectQuotaExhaustion, exhaustedUntil, parseQuotaPatterns,
  parseResetAt, vendorKey,
} from '../.dsh-plugin/shared/subscription-billing.mjs'
import { assignmentPackages, executeAssignmentPlan, executeRouteWithBilling, rerunAssignmentPackage } from '../.dsh-plugin/shared/task-executors.mjs'
import { parseModelProfilesJson, applyModelProfiles } from '../.dsh-plugin/shared/model-profiles.mjs'
import { billingOf, buildRunRecord, spending } from '../.dsh-plugin/shared/run-ledger.mjs'
import { checkLogin, subscriptionLoginOf } from '../.dsh-plugin/shared/tool-health.mjs'
import { profileDraft, profileFromDraft } from '../.dsh-plugin/client/model-profile-editor-state.mjs'
import { billingRows, billingSwitchText } from '../.dsh-plugin/client/insights-state.mjs'

const NOW = new Date(2026, 9, 2, 14, 0, 0).getTime()

function fakeSpawn(handler) {
  const calls = []
  const spawnImpl = (file, args, options) => {
    calls.push({ file, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end() {} }
    child.pid = 42
    child.kill = () => child.emit('close', null)
    const script = handler(file, args, options) ?? { code: 0, stdout: '' }
    queueMicrotask(() => {
      if (script.stdout) child.stdout.emit('data', Buffer.from(script.stdout))
      if (script.stderr) child.stderr.emit('data', Buffer.from(script.stderr))
      child.emit('close', script.code ?? 0)
    })
    return child
  }
  return { spawnImpl, calls }
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'model-router-billing-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

const detect = (text, vendor, extra = {}) => detectQuotaExhaustion(text, { vendor, now: NOW, ...extra })

test('documented quota and rate-limit messages are recognised per vendor', () => {
  const cases = [
    ['claude-code', "You've hit your session limit · resets 3:45pm", 'quota'],
    ['claude-code', 'You’ve hit your weekly limit · resets Mon 12:00am', 'quota'],
    ['claude-code', 'Claude AI usage limit reached|1791000000', 'quota'],
    ['claude-code', 'API Error: Request rejected (429) · Server is temporarily limiting requests', 'rate-limit'],
    ['codex', '{"error":{"type":"usage_limit_reached","message":"You\'ve hit your usage limit.","resets_in_seconds":1800}}', 'quota'],
    ['codex', 'stream error: rate_limit_exceeded', 'rate-limit'],
    ['gemini', '[API Error: 429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric] retry in 30s', 'quota'],
    ['kimi-code', "403 You've reached your 5-hour usage limit. Please try again later.", 'quota'],
    ['kimi-code', "You've reached your weekly (7-day) usage limit", 'quota'],
    ['kimi-code', "We're receiving too many requests right now", 'rate-limit'],
    ['minimax-code', '{"base_resp":{"status_code":2056,"status_msg":"usage limit exceeded"}}', 'quota'],
    ['minimax-code', 'Token Plan usage limit reached', 'quota'],
    ['zcode', '{"error":{"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-10-02 18:30:00"}}', 'quota'],
    ['zcode', '已达到 5 小时的使用上限。您的限额将在 2026-10-02 18:30:00 重置。', 'quota'],
    ['zcode', '{"error":{"code":"1302","message":"Rate limit reached for requests"}}', 'rate-limit'],
    ['*', 'HTTP 429 Too Many Requests', 'rate-limit'],
  ]
  for (const [vendor, text, kind] of cases) {
    const info = detect(text, vendor)
    assert.ok(info, `${vendor}: ${text}`)
    assert.equal(info.kind, kind, `${vendor}: ${text}`)
  }
  assert.equal(detect('TypeError: cannot read properties of undefined', 'claude-code'), null)
  assert.equal(detect('{"error":{"code":"1113","message":"余额不足"}}', 'zcode'), null)
  assert.equal(detect('', 'codex'), null)
})

test('reset times are read from vendor text or fall back to the cooldown', () => {
  assert.equal(parseResetAt('"resets_in_seconds":1800', NOW), NOW + 1_800_000)
  assert.equal(parseResetAt(`"resets_at": ${Math.floor(NOW / 1000) + 600}`, NOW), (Math.floor(NOW / 1000) + 600) * 1000)
  assert.equal(parseResetAt('retry in 30s', NOW), NOW + 30_000)
  assert.equal(parseResetAt('Retry-After: 120', NOW), NOW + 120_000)
  assert.equal(parseResetAt('try again in 2 hours 5 minutes', NOW), NOW + 125 * 60_000)
  assert.equal(parseResetAt('Your limit will reset at 2026-10-02 18:30:00', NOW), new Date(2026, 9, 2, 18, 30, 0).getTime())
  assert.equal(parseResetAt('resets 3:45pm', NOW), new Date(2026, 9, 2, 15, 45, 0).getTime())
  assert.equal(parseResetAt('resets 1pm', NOW), new Date(2026, 9, 3, 13, 0, 0).getTime(), 'a past time today means tomorrow')
  const monday = parseResetAt('resets Mon 12:00am', NOW)
  assert.equal(new Date(monday).getDay(), 1)
  assert.ok(monday > NOW && monday - NOW <= 7 * 86_400_000)
  assert.equal(parseResetAt('no time here', NOW), null)
  assert.equal(parseResetAt('reset at 2020-01-01 00:00:00', NOW), null, 'past times are ignored')

  assert.equal(exhaustedUntil({ kind: 'quota', resetAt: NOW + 5_000 }, { now: NOW }), NOW + 5_000)
  assert.equal(exhaustedUntil({ kind: 'quota', resetAt: null }, { now: NOW, cooldownMinutes: 90 }), NOW + 90 * 60_000)
  assert.equal(exhaustedUntil({ kind: 'rate-limit', resetAt: null }, { now: NOW, cooldownMinutes: 90 }), NOW + 60_000)
})

test('user patterns extend detection and invalid ones are reported, not thrown', () => {
  const { patterns, errors } = parseQuotaPatterns(JSON.stringify({
    'kimi-code': { quota: ['额度已用完'] },
    'my-plan': { rateLimit: ['slow down'] },
    broken: { quota: ['('] },
    bad: 'x',
  }))
  assert.equal(errors.length, 2)
  assert.equal(detect('本周额度已用完', 'kimi-code', { extraPatterns: patterns }).kind, 'quota')
  assert.equal(detect('please slow down', '*', { provider: 'my-plan', extraPatterns: patterns }).kind, 'rate-limit')
  assert.equal(detect('please slow down', '*', { provider: 'other', extraPatterns: patterns }), null)
  assert.deepEqual(parseQuotaPatterns('not json').patterns, {})
  assert.equal(parseQuotaPatterns('[]').errors.length, 1)
  assert.deepEqual(parseQuotaPatterns('').errors, [])
})

test('quota tracker expires entries and persists snapshots', () => {
  let now = NOW
  const saved = []
  const tracker = createQuotaTracker({ now: () => now, persist: snapshot => saved.push(snapshot) })
  const entry = tracker.mark('cli:codex', { kind: 'quota', resetAt: NOW + 60_000, detail: 'limit' })
  assert.equal(entry.until, NOW + 60_000)
  assert.equal(entry.resetReported, true)
  assert.equal(tracker.status('cli:codex').kind, 'quota')
  assert.ok(saved.at(-1)['cli:codex'])
  now += 61_000
  assert.equal(tracker.status('cli:codex'), null)
  const restored = createQuotaTracker({ now: () => NOW })
  restored.load({ 'plan:glm-plan': { until: NOW + 1000, kind: 'quota' }, 'plan:old': { until: NOW - 1, kind: 'quota' } })
  assert.deepEqual(Object.keys(restored.snapshot()), ['plan:glm-plan'])
})

test('billing plan pairs plan-key routes, CLI logins and API routes', () => {
  const routes = applyModelProfiles([
    { provider: 'glm-coding-plan', model: 'glm-4.6' },
    { provider: 'zhipu', model: 'glm-4.6' },
    { provider: 'anthropic', model: 'claude-sonnet' },
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'kimi-code', model: 'kimi-for-coding' },
  ], parseModelProfilesJson(JSON.stringify([
    { provider: 'glm-coding-plan', model: 'glm-4.6', subscription: 'plan-key', apiRoute: { provider: 'zhipu', model: 'glm-4.6' } },
    { provider: 'deepseek', model: 'deepseek-chat', billing: 'api-only' },
  ])))
  const plan = billingPlan(routes[0], routes)
  assert.equal(plan.mode, 'subscription-first')
  assert.equal(plan.subscription.kind, 'plan-key')
  assert.equal(plan.subscription.key, 'plan:glm-coding-plan')
  assert.equal(plan.apiRoute.provider, 'zhipu')
  const api = billingPlan(routes[1], routes)
  assert.equal(api.subscription.kind, 'plan-key', 'the API route of a plan uses the plan first')
  assert.equal(api.apiRoute.provider, 'zhipu')
  const claude = billingPlan(routes[2], routes)
  assert.deepEqual([claude.subscription.kind, claude.subscription.toolId], ['cli-login', 'claude-code'])
  const deepseek = billingPlan(routes[3], routes)
  assert.equal(deepseek.subscription, null)
  assert.equal(deepseek.mode, 'api-only')
  const kimi = billingPlan(routes[4], routes)
  assert.equal(kimi.subscription.kind, 'plan-key', 'provider id hint marks a coding-plan endpoint')
  assert.equal(kimi.apiRoute, null)
  assert.equal(billingPlan({ provider: 'openai', model: 'gpt', subscription: 'none' }, []).subscription, null)
  assert.equal(vendorKey({ provider: 'glm-coding-plan' }), 'zcode')
  assert.equal(vendorKey({ provider: 'minimax-token-plan' }), 'minimax-code')
  assert.equal(vendorKey({ provider: 'kimi-code' }), 'kimi-code')
  assert.equal(vendorKey({ provider: 'bigmodel-plan' }), 'zcode')
})

test('profiles validate billing, subscription and apiRoute', () => {
  const [profile] = parseModelProfilesJson(JSON.stringify([{ provider: 'p', model: 'm', billing: 'subscription-only', subscription: 'plan-key', apiRoute: { provider: 'q', model: 'm' } }]))
  assert.equal(profile.billing, 'subscription-only')
  assert.throws(() => parseModelProfilesJson(JSON.stringify([{ provider: 'p', model: 'm', billing: 'cheap' }])), /billing/)
  assert.throws(() => parseModelProfilesJson(JSON.stringify([{ provider: 'p', model: 'm', subscription: 'oauth' }])), /subscription/)
  assert.throws(() => parseModelProfilesJson(JSON.stringify([{ provider: 'p', model: 'm', apiRoute: { provider: 'q', model: 'm' } }])), /plan-key/)
  assert.throws(() => parseModelProfilesJson(JSON.stringify([{ provider: 'p', model: 'm', subscription: 'plan-key', apiRoute: { provider: 'p', model: 'm' } }])), /自己/)

  const draft = profileDraft(profile)
  assert.deepEqual([draft.billing, draft.subscription, draft.apiRoute], ['subscription-only', 'plan-key', 'q\u0000m'])
  assert.deepEqual(profileFromDraft({ provider: 'p', model: 'm' }, draft), { provider: 'p', model: 'm', billing: 'subscription-only', subscription: 'plan-key', apiRoute: { provider: 'q', model: 'm' } })
  assert.deepEqual(profileFromDraft({ provider: 'p', model: 'm' }, profileDraft(undefined)), { provider: 'p', model: 'm' }, 'defaults add nothing')
  assert.throws(() => profileFromDraft({ provider: 'p', model: 'm' }, { ...draft, subscription: 'auto' }), /编程套餐/)
})

function billingContext(overrides = {}) {
  let now = NOW
  const quota = createQuotaTracker({ now: () => now })
  return {
    quota, cooldownMinutes: 60, extraPatterns: {}, now: () => now, loginBillingFor: () => 'subscription',
    advance: ms => { now += ms },
    ...overrides,
  }
}

const claudeRoute = { provider: 'anthropic', model: 'claude-sonnet', execution: 'official' }
const codexRoute = { provider: 'openai', model: 'gpt-5.6', execution: 'official' }
const geminiRoute = { provider: 'google-ai', model: 'gemini-flash', execution: 'official' }

const CLI_CASES = [
  { route: claudeRoute, toolId: 'claude-code', file: 'claude', keyEnv: 'ANTHROPIC_API_KEY',
    ok: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'claude ok' }),
    exhausted: { code: 1, stdout: JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: "You've hit your session limit · resets 3:45pm" }) },
    until: new Date(2026, 9, 2, 15, 45, 0).getTime() },
  { route: codexRoute, toolId: 'codex', file: 'codex', keyEnv: 'OPENAI_API_KEY',
    ok: `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'codex ok' } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`,
    exhausted: { code: 1, stdout: `${JSON.stringify({ type: 'turn.failed', error: { message: '{"type":"usage_limit_reached","message":"You\'ve hit your usage limit.","resets_in_seconds":7200}' } })}\n` },
    until: NOW + 7_200_000 },
  { route: geminiRoute, toolId: 'gemini', file: 'gemini', keyEnv: 'GEMINI_API_KEY',
    ok: JSON.stringify({ response: 'gemini ok' }),
    exhausted: { code: 1, stderr: 'Error: [429] RESOURCE_EXHAUSTED: You have exhausted your daily quota. retry in 90s' },
    until: NOW + 90_000 },
]

test('CLI subscription success runs without API keys and is billed as subscription', async t => {
  const cwd = await workspace(t)
  for (const item of CLI_CASES) {
    const { spawnImpl, calls } = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : { code: 0, stdout: item.ok })
    const result = await executeRouteWithBilling({
      route: item.route, task: '回答问题', workspace: cwd, credentials: { apiKey: 'sk-secret-value' }, spawnImpl,
      billing: billingContext({ routes: [item.route] }),
      apiFallback: () => { throw new Error('api must not run') },
    })
    assert.equal(result.ok, true, item.toolId)
    assert.equal(result.channel, 'official-cli')
    assert.equal(result.billing, 'subscription')
    assert.equal(result.billingMode, 'subscription-first')
    assert.equal(calls.at(-1).options.env[item.keyEnv], undefined, `${item.toolId}: no API key in subscription mode`)
    assert.equal(billingOf(result), 'subscription')
  }
})

test('CLI quota exhaustion switches the same step to the API key and records why', async t => {
  const cwd = await workspace(t)
  for (const item of CLI_CASES) {
    const billing = billingContext({ routes: [item.route] })
    const { spawnImpl } = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : item.exhausted)
    const apiCalls = []
    const result = await executeRouteWithBilling({
      route: item.route, task: '回答问题', workspace: cwd, spawnImpl, billing,
      apiFallback: request => { apiCalls.push(request); return { ok: true, answer: 'api answer' } },
    })
    assert.equal(result.ok, true, item.toolId)
    assert.equal(result.channel, 'harness-llm')
    assert.equal(result.answer, 'api answer')
    assert.equal(result.billing, 'api')
    assert.equal(apiCalls.length, 1)
    assert.equal(apiCalls[0].route.provider, item.route.provider)
    assert.match(result.billingSwitch.reason, /订阅(额度已用尽|通道触发限流).*已切换 API Key/)
    assert.equal(result.billingSwitch.to, 'api')
    assert.equal(result.fallback.reason, result.billingSwitch.reason)
    const status = billing.quota.status(`cli:${item.toolId}`)
    assert.ok(status, item.toolId)
    assert.equal(status.until, item.until, item.toolId)
    assert.equal(billingOf(result), 'api')

    // While exhausted, the next step skips the CLI and goes straight to the API key.
    const second = fakeSpawn(() => { throw new Error('CLI must be skipped') })
    const next = await executeRouteWithBilling({
      route: item.route, task: '下一步', workspace: cwd, spawnImpl: second.spawnImpl, billing,
      apiFallback: () => ({ ok: true, answer: 'api again' }),
    })
    assert.equal(next.ok, true)
    assert.equal(next.billing, 'api')
    assert.equal(next.billingSwitch.skippedSubscription, true)
    assert.match(next.billingSwitch.reason, /订阅额度已用尽（预计 .* 恢复），已直接使用 API Key/)
    assert.equal(second.calls.length, 0)
  }
})

test('non-quota CLI failures pause for the user by default; api / fail settings are honoured', async t => {
  const cwd = await workspace(t)
  const failures = [
    ['non-zero exit', { code: 2, stderr: 'segfault' }],
    ['parse failure', { code: 0, stdout: 'not json at all' }],
    ['auth error', { code: 1, stderr: 'Error: Invalid API key · Please run /login' }],
  ]
  for (const [label, script] of failures) {
    const billing = billingContext({ routes: [claudeRoute] })
    const { spawnImpl } = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : script)
    const result = await executeRouteWithBilling({ route: claudeRoute, task: 'x', workspace: cwd, spawnImpl, billing,
      apiFallback: () => { throw new Error(`${label}: api must not run`) } })
    assert.equal(result.ok, false, label)
    assert.equal(result.paused, true, label)
    assert.equal(result.pause.kind, 'subscription-failure')
    assert.deepEqual(result.pause.choices, ['api', 'subscription', 'cancel'])
    assert.match(result.pause.reason, /不是额度用尽或限流，已暂停/)
    assert.equal(result.fallback, null)
    assert.equal(billing.quota.status('cli:claude-code'), null, `${label}: not marked exhausted`)
    if (label === 'auth error') assert.equal(result.pause.loginRequired, true)
  }

  const crash = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : { code: 2, stderr: 'segfault' })
  const viaApi = await executeRouteWithBilling({ route: claudeRoute, task: 'x', workspace: cwd, spawnImpl: crash.spawnImpl,
    billing: billingContext({ routes: [claudeRoute], onFailure: 'api' }), apiFallback: () => ({ ok: true, answer: 'api' }) })
  assert.equal(viaApi.ok, true)
  assert.equal(viaApi.paused, undefined)
  assert.equal(billingOf(viaApi), 'api')
  const failed = await executeRouteWithBilling({ route: claudeRoute, task: 'x', workspace: cwd, spawnImpl: crash.spawnImpl,
    billing: billingContext({ routes: [claudeRoute], onFailure: 'fail' }), apiFallback: () => { throw new Error('no') } })
  assert.equal(failed.ok, false)
  assert.equal(failed.paused, undefined)
  assert.match(failed.error, /按设置不自动改用 API Key/)

  // A CLI that is not installed was never attempted: the API is used as before.
  const missing = fakeSpawn(() => ({ code: 127 }))
  const notInstalled = await executeRouteWithBilling({ route: claudeRoute, task: 'x', workspace: cwd, spawnImpl: missing.spawnImpl,
    billing: billingContext({ routes: [claudeRoute] }), apiFallback: () => ({ ok: true, answer: 'api' }) })
  assert.equal(notInstalled.ok, true)
  assert.equal(notInstalled.channel, 'harness-llm')

  // The user's "改用 API 重试" goes straight to the API key and says why.
  const confirmed = await executeRouteWithBilling({ route: claudeRoute, task: 'x', workspace: cwd, spawnImpl: fakeSpawn(() => { throw new Error('CLI skipped') }).spawnImpl,
    billing: billingContext({ routes: [claudeRoute], choice: 'api' }), apiFallback: () => ({ ok: true, answer: 'api ok' }) })
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.billing, 'api')
  assert.equal(confirmed.billingSwitch.kind, 'user-confirmed')
  assert.match(confirmed.billingSwitch.reason, /按你的确认改用 API Key/)
})

test('a paused step makes downstream steps wait and the run status paused', async t => {
  const cwd = await workspace(t)
  const plan = { mode: 'team', team: { workPackages: [
    { id: 'a', name: 'A', recommendedProvider: 'anthropic', recommendedModel: 'claude-sonnet' },
    { id: 'b', name: 'B', dependsOn: ['a'], recommendedProvider: 'deepseek', recommendedModel: 'chat' },
  ] } }
  const routes = [{ ...claudeRoute }, { provider: 'deepseek', model: 'chat' }]
  const { spawnImpl } = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : { code: 0, stdout: '' })
  const execution = await executeAssignmentPlan({ plan, task: '任务', routes, workspace: cwd, spawnImpl,
    billing: billingContext({ routes }), apiFallback: () => { throw new Error('api must not run') } })
  assert.equal(execution.status, 'paused')
  const [a, b] = execution.packages
  assert.equal(a.paused, true)
  assert.equal(b.waiting, true)
  assert.match(b.error, /等待上游步骤确认：a/)
  const record = buildRunRecord({ id: 'p', createdAt: NOW, finishedAt: NOW, task: '任务', plan, execution })
  assert.deepEqual(record.packages.map(item => item.status), ['paused', 'waiting'])
  assert.equal(record.status, 'paused')
  assert.match(record.packages[0].pause.reason, /已暂停/)

  // Choosing the API for the paused step re-runs it and the waiting step.
  const resumed = await rerunAssignmentPackage({ task: '任务', packages: assignmentPackages(plan, '任务'), previous: execution.packages,
    packageId: 'a', routes, workspace: cwd, spawnImpl, subscriptionChoice: 'api',
    billing: billingContext({ routes }), apiFallback: ({ route }) => ({ ok: true, answer: `${route.provider} 完成` }) })
  assert.equal(resumed.status, 'completed')
  assert.deepEqual(resumed.ranIds, ['a', 'b'])
  assert.equal(resumed.packages[0].billingSwitch.kind, 'user-confirmed')
})

test('a coding-plan route pauses on a non-quota failure instead of spending the API key', async () => {
  const routes = [
    { provider: 'glm-coding-plan', model: 'glm-4.6', subscription: 'plan-key', apiRoute: { provider: 'zhipu', model: 'glm-4.6' } },
    { provider: 'zhipu', model: 'glm-4.6' },
  ]
  const calls = []
  const result = await executeRouteWithBilling({ route: routes[0], task: 'x', billing: billingContext({ routes }),
    apiFallback: request => { calls.push(request.route.provider); throw new Error('500 Internal Server Error') } })
  assert.equal(result.paused, true)
  assert.match(result.pause.detail, /500/)
  assert.deepEqual(calls, ['glm-coding-plan'])
  const api = await executeRouteWithBilling({ route: routes[0], task: 'x', billing: billingContext({ routes, onFailure: 'api' }),
    apiFallback: request => { if (request.subscription) throw new Error('500'); return { ok: true, answer: 'api' } } })
  assert.equal(api.ok, true)
  assert.equal(api.provider, 'zhipu')
})

test('subscription-only never uses an API key; api-only never uses the subscription', async t => {
  const cwd = await workspace(t)
  const only = { ...claudeRoute, billing: 'subscription-only' }
  const billing = billingContext({ routes: [only] })
  const { spawnImpl } = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : CLI_CASES[0].exhausted)
  const refused = await executeRouteWithBilling({ route: only, task: 'x', workspace: cwd, spawnImpl, billing,
    apiFallback: () => { throw new Error('api must not run') } })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /按设置只用订阅，未使用 API Key/)
  assert.ok(billing.quota.status('cli:claude-code'))
  const again = await executeRouteWithBilling({ route: only, task: 'x', workspace: cwd, spawnImpl, billing,
    apiFallback: () => { throw new Error('api must not run') } })
  assert.equal(again.ok, false)
  assert.equal(again.billingSwitch.to, null)

  const loggedOut = await executeRouteWithBilling({ route: only, task: 'x', workspace: cwd, spawnImpl,
    billing: billingContext({ routes: [only], loginBillingFor: () => 'logged-out' }), apiFallback: () => { throw new Error('no') } })
  assert.equal(loggedOut.ok, false)
  assert.match(loggedOut.error, /未登录订阅账号/)

  const apiOnly = { ...claudeRoute, billing: 'api-only' }
  const keyed = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : { code: 0, stdout: CLI_CASES[0].ok })
  const withKey = await executeRouteWithBilling({ route: apiOnly, task: 'x', workspace: cwd, spawnImpl: keyed.spawnImpl,
    credentials: { apiKey: 'sk-secret-value' }, billing: billingContext({ routes: [apiOnly] }), apiFallback: () => { throw new Error('no') } })
  assert.equal(withKey.ok, true)
  assert.equal(withKey.credentialSource, 'configured-api-key')
  assert.equal(keyed.calls.at(-1).options.env.ANTHROPIC_API_KEY, 'sk-secret-value')
  assert.equal(billingOf(withKey), 'api')
  const noKey = await executeRouteWithBilling({ route: apiOnly, task: 'x', workspace: cwd, spawnImpl: fakeSpawn(() => { throw new Error('no CLI') }).spawnImpl,
    billing: billingContext({ routes: [apiOnly] }), apiFallback: () => ({ ok: true, answer: 'api' }) })
  assert.equal(noKey.channel, 'harness-llm')
  assert.match(noKey.fallback.reason, /只用 API Key/)
})

const PLAN_CASES = [
  { vendor: 'GLM', plan: { provider: 'glm-coding-plan', model: 'glm-4.6' }, api: { provider: 'zhipu', model: 'glm-4.6' },
    error: '429 {"error":{"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-10-02 18:30:00"}}',
    until: new Date(2026, 9, 2, 18, 30, 0).getTime() },
  { vendor: 'Kimi', plan: { provider: 'kimi-code', model: 'kimi-for-coding' }, api: { provider: 'moonshot', model: 'kimi-k2' },
    error: "403 You've reached your weekly (7-day) usage limit.", until: NOW + 60 * 60_000 },
  { vendor: 'MiniMax', plan: { provider: 'minimax-token-plan', model: 'MiniMax-M2' }, api: { provider: 'minimax', model: 'MiniMax-M2' },
    error: '{"base_resp":{"status_code":2056,"status_msg":"usage limit exceeded"}}', until: NOW + 60 * 60_000 },
]

test('coding-plan key routes fall back to their API route on quota, per provider', async () => {
  for (const item of PLAN_CASES) {
    const routes = applyModelProfiles([item.plan, item.api], parseModelProfilesJson(JSON.stringify([
      { ...item.plan, subscription: 'plan-key', apiRoute: item.api },
    ])))
    const billing = billingContext({ routes })
    const calls = []
    const apiFallback = request => {
      calls.push(request)
      if (request.subscription) throw new Error(item.error)
      return { ok: true, answer: `api via ${request.route.provider}` }
    }
    const result = await executeRouteWithBilling({ route: routes[0], task: 'x', billing, apiFallback })
    assert.equal(result.ok, true, item.vendor)
    assert.equal(result.billing, 'api')
    assert.equal(result.provider, item.api.provider, 'the API route that actually ran is recorded')
    assert.deepEqual(result.subscriptionRoute, item.plan)
    assert.match(result.billingSwitch.reason, /订阅额度已用尽.*已切换 API Key/)
    assert.deepEqual(calls.map(call => [call.route.provider, call.subscription === true]), [[item.plan.provider, true], [item.api.provider, false]])
    assert.equal(billing.quota.status(`plan:${item.plan.provider}`).until, item.until, item.vendor)

    // Routing to the API route itself still prefers the plan while it has quota.
    const fresh = billingContext({ routes })
    const viaPlan = await executeRouteWithBilling({ route: routes[1], task: 'x', billing: fresh,
      apiFallback: request => ({ ok: true, answer: request.subscription ? 'plan answer' : 'api answer' }) })
    assert.equal(viaPlan.answer, 'plan answer')
    assert.equal(viaPlan.billing, 'subscription')
    assert.equal(billingOf(viaPlan), 'subscription')
  }
})

test('a plan route without apiRoute reports the exhaustion instead of guessing a key', async () => {
  const route = { provider: 'kimi-code', model: 'kimi-for-coding', subscription: 'plan-key' }
  const result = await executeRouteWithBilling({ route, task: 'x', billing: billingContext({ routes: [route] }),
    apiFallback: () => { throw new Error("You've reached your 5-hour usage limit") } })
  assert.equal(result.ok, false)
  assert.match(result.error, /没有配置可回退的 API 路线/)
})

test('ledger counts API fallback runs and keeps subscription runs as reference cost', () => {
  const pricing = { input: 1, output: 2 }
  const plan = { mode: 'team', team: { workPackages: [
    { id: 'a', name: 'A', recommendedProvider: 'glm-coding-plan', recommendedModel: 'glm-4.6' },
    { id: 'b', name: 'B', recommendedProvider: 'glm-coding-plan', recommendedModel: 'glm-4.6' },
  ] } }
  const usage = { inputTokens: 1_000_000, outputTokens: 0 }
  const record = buildRunRecord({
    id: 'r', createdAt: NOW, finishedAt: NOW, task: 't', plan, pricingFor: () => pricing,
    execution: { status: 'succeeded', packages: [
      { id: 'a', ok: true, provider: 'glm-coding-plan', model: 'glm-4.6', channel: 'harness-llm', billing: 'subscription', billingMode: 'subscription-first', subscriptionRoute: { provider: 'glm-coding-plan', model: 'glm-4.6' }, answer: 'x', usage },
      { id: 'b', ok: true, provider: 'zhipu', model: 'glm-4.6', channel: 'harness-llm', billing: 'api', answer: 'y', usage,
        billingSwitch: { from: 'subscription', to: 'api', reason: '订阅额度已用尽，已切换 API Key。', kind: 'quota' } },
    ] },
  })
  const [a, b] = record.packages
  assert.equal(a.billing, 'subscription')
  assert.equal(a.costUsd, null)
  assert.equal(a.referenceCostUsd, 1)
  assert.deepEqual(a.subscriptionRoute, { provider: 'glm-coding-plan', model: 'glm-4.6' })
  assert.equal(b.billing, 'api')
  assert.equal(b.costUsd, 1)
  assert.equal(b.billingSwitch.reason, '订阅额度已用尽，已切换 API Key。')
  assert.equal(billingSwitchText(b), '订阅额度已用尽，已切换 API Key。')
  const spent = spending([record], NOW)
  assert.equal(spent.today, 1)
  assert.equal(spent.subscriptionToday, 1)
})

test('health billing overview shows subscription state and API availability per provider', () => {
  const routes = [
    { provider: 'glm-coding-plan', model: 'glm-4.6', subscription: 'plan-key', apiRoute: { provider: 'zhipu', model: 'glm-4.6' } },
    { provider: 'zhipu', model: 'glm-4.6' },
    { provider: 'anthropic', model: 'claude-sonnet' },
    { provider: 'anthropic', model: 'claude-opus' },
    { provider: 'openai', model: 'gpt-5.6' },
    { provider: 'kimi-code', model: 'kimi-for-coding', billing: 'subscription-only' },
    { provider: 'deepseek', model: 'deepseek-chat' },
  ]
  const quota = createQuotaTracker({ now: () => NOW })
  quota.mark('cli:codex', { kind: 'quota', resetAt: NOW + 3_600_000 })
  const overview = billingOverview(routes, {
    quota, now: () => NOW,
    loginFor: toolId => toolId === 'claude-code' ? 'subscription' : toolId === 'codex' ? 'subscription' : 'unknown',
    apiKeyEnvFor: toolId => toolId === 'codex',
  })
  const byProvider = Object.fromEntries(overview.providers.map(row => [row.provider, row]))
  assert.equal(byProvider['glm-coding-plan'].subscription.state, 'plan-key')
  assert.deepEqual(byProvider['glm-coding-plan'].api.route, { provider: 'zhipu', model: 'glm-4.6' })
  assert.equal(byProvider.zhipu.subscription.kind, 'plan-key')
  assert.equal(byProvider.anthropic.subscription.state, 'logged-in')
  assert.deepEqual(byProvider.anthropic.models, ['claude-sonnet', 'claude-opus'])
  assert.equal(byProvider.openai.subscription.state, 'exhausted')
  assert.equal(byProvider.openai.subscription.exhaustedUntil, NOW + 3_600_000)
  assert.equal(byProvider.openai.api.cliKeyEnv, true)
  assert.equal(byProvider['kimi-code'].api.available, false)
  assert.equal(byProvider.deepseek.subscription.state, 'none')
  assert.equal(byProvider.deepseek.api.available, true)
  const rows = billingRows(overview)
  const openai = rows.find(row => row.provider === 'openai')
  assert.match(openai.state, /额度已用尽，预计 .* 恢复/)
  assert.match(rows.find(row => row.provider === 'kimi-code').api, /只用订阅/)
})

test('login probes ignore API-key variables to find the account subscription', async () => {
  const seen = []
  const runner = async (file, args, options) => {
    seen.push(options.env)
    return { ok: true, code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
  }
  const login = await checkLogin('claude-code', { runner, env: { ANTHROPIC_API_KEY: 'sk-x', PATH: '/bin' } })
  assert.equal(seen[0].ANTHROPIC_API_KEY, undefined)
  assert.equal(seen[0].PATH, '/bin')
  assert.equal(login.billing, 'api-key', 'as launched with the key, the CLI bills the API')
  assert.equal(login.accountLogin, true)
  assert.equal(subscriptionLoginOf(login), 'subscription')
  const codex = await checkLogin('codex', { runner: async () => ({ ok: true, code: 0, stdout: 'Logged in using an API key - sk-***', stderr: '' }), env: {} })
  assert.equal(subscriptionLoginOf(codex), 'api-key')
  assert.equal(subscriptionLoginOf({ state: 'logged-out' }), 'logged-out')
  assert.equal(subscriptionLoginOf(null), 'unknown')
})
