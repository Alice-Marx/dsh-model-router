import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { buildRunRecord, buildTeamRunRecord, buildToolRunRecord, mergeRerun, spending } from '../.dsh-plugin/shared/run-ledger.mjs'
import { archiveSubscriptionUsage, emptySubscriptionUsage, invalidArchivedSubscriptionUsage,
  MAX_SUBSCRIPTION_USAGE_ROUTES, sanitizeArchivedSubscriptionUsage, subscriptionUsage,
  subscriptionUsageForPackage, subscriptionUsageForRun } from '../.dsh-plugin/shared/subscription-usage.mjs'

const AT = new Date(2026, 9, 24, 12).getTime()
const OLD = new Date(2026, 8, 30, 23, 59).getTime()
const receipt = (id, usage = { inputTokens: 100, outputTokens: 20 }, extra = {}) => ({
  id, provider: 'openai', model: 'gpt-test', toolId: 'codex', channel: 'official-cli',
  billing: 'subscription', ran: true, ok: true, usage, finishedAt: AT, ...extra,
})
const run = (id, packages) => ({ id, createdAt: AT, packages, reviews: [] })
const plan = { mode: 'team', team: { workPackages: ['a', 'b'].map(id => ({ id, name: id, objective: id,
  dependsOn: [], recommendedProvider: 'openai', recommendedModel: 'gpt-test' })) } }
const api = (id, amount) => receipt(id, { inputTokens: 8, outputTokens: 2 }, { billing: 'api', costUsd: amount })
async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'router-subscription-usage-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'state.json')
  return { file, state: createRouterState({ file, now: () => AT, ...extra }) }
}

test('subscription quantities and API monetary totals remain independent', () => {
  const runs = [run('mixed', [receipt('a', { inputTokens: 100, outputTokens: 20, cacheReadTokens: 7, cacheWriteTokens: 3 },
    { referenceCostUsd: 5000, reportedCostUsd: 5000 }), api('b', 2)])]
  const usage = subscriptionUsage(runs, AT)
  assert.deepEqual(usage.today, { calls: 1, knownUsageCalls: 1, unknownUsageCalls: 0,
    inputTokens: 100, outputTokens: 20, cacheReadTokens: 7, cacheWriteTokens: 3 })
  assert.equal(usage.month.calls, 1)
  assert.equal(usage.byRoute.length, 1)
  assert.equal(usage.byRoute[0].provider, 'openai')
  assert.equal(usage.byRoute[0].toolId, 'codex')
  assert.equal(spending(runs, AT).today, 2)
  assert.equal(Object.hasOwn(usage.today, 'costUsd'), false)
})

test('missing quantities stay null, reported zero stays zero and partial evidence remains visible', () => {
  const missing = subscriptionUsageForPackage(receipt('a', null, { reportedCostUsd: 1 }))
  assert.equal(missing.unknownUsageCalls, 1)
  assert.equal(missing.inputTokens, null)
  assert.equal(missing.outputTokens, null)
  const zero = subscriptionUsageForPackage(receipt('a', { inputTokens: 0, outputTokens: 0 }))
  assert.equal(zero.knownUsageCalls, 1)
  assert.equal(zero.inputTokens, 0)
  assert.equal(zero.outputTokens, 0)
  assert.equal(zero.cacheReadTokens, null)
  const partial = subscriptionUsageForPackage(receipt('a', { inputTokens: 13, outputTokens: null, cacheReadTokens: 5 }, { usageIncomplete: true }))
  assert.equal(partial.unknownUsageCalls, 1)
  assert.equal(partial.inputTokens, 13)
  assert.equal(partial.outputTokens, null)
  assert.equal(partial.cacheReadTokens, 5)
})

test('a skipped attempt is not use, while contradictory positive usage cannot be erased by a stop marker', () => {
  const item = api('a', 0)
  item.subscriptionAttempts = [
    { provider: 'plan', notStarted: true, usage: null },
    { provider: 'plan', blocked: true, usage: { inputTokens: 0, outputTokens: 0 } },
    { provider: 'plan', notStarted: true, usage: { inputTokens: 2, outputTokens: 1 } },
  ]
  const usage = subscriptionUsageForPackage(item)
  assert.equal(usage.calls, 1)
  assert.equal(usage.inputTokens, 2)
  assert.deepEqual(subscriptionUsageForPackage(receipt('a', null, { ran: false })), emptySubscriptionUsage())
})

test('subscription to API fallback retains the subscription attempt only once under its actual route', () => {
  const item = api('a', 0.4)
  item.subscriptionAttempts = [{ provider: 'coding-plan', model: 'plan-model', toolId: null,
    usage: { inputTokens: 44, outputTokens: 9 }, finishedAt: AT }]
  const runs = [run('fallback', [item])]
  const usage = subscriptionUsage(runs, AT)
  assert.equal(usage.today.calls, 1)
  assert.equal(usage.today.inputTokens, 44)
  assert.equal(usage.byRoute[0].provider, 'coding-plan')
  assert.equal(usage.byRoute[0].toolId, null, 'a plan endpoint must not inherit the final API/CLI tool id')
  assert.equal(spending(runs, AT).today, 0.4)
  assert.equal(subscriptionUsageForPackage({ ...item, billing: 'subscription' }).calls, 1)
  assert.equal(subscriptionUsageForPackage({ ...item, billing: 'subscription', subscriptionAttempts: [] }).calls, 0)
})

test('each subscription attempt keeps its own date across a fallback and month rollover', () => {
  const item = api('a', 2)
  item.subscriptionAttempts = [{ provider: 'plan', usage: { inputTokens: 5, outputTokens: 1 }, finishedAt: OLD }]
  const runs = [run('fallback', [item])]
  assert.equal(subscriptionUsage(runs, OLD).today.calls, 1)
  assert.equal(subscriptionUsage(runs, AT).month.calls, 0)
  assert.equal(spending(runs, AT).today, 2)
})

test('eviction, reload and further writes retain exact quantities without counting retained rows twice', async t => {
  const { file, state } = await fixture(t, { maxRuns: 1 })
  await state.appendRun(run('a', [receipt('a')]))
  await state.appendRun(run('b', [receipt('b', null)]))
  await state.appendRun(run('api', [api('x', 3)]))
  const loaded = await createRouterState({ file, maxRuns: 1 }).read()
  assert.equal(loaded.runs.length, 1)
  const before = subscriptionUsage(loaded.runs, AT, loaded.archivedSubscriptionUsage)
  assert.equal(before.today.calls, 2)
  assert.equal(before.today.knownUsageCalls, 1)
  assert.equal(before.today.unknownUsageCalls, 1)
  assert.equal(before.today.inputTokens, 100)
  assert.equal(spending(loaded.runs, AT, loaded.archivedSpending).today, 3)
  await state.update(current => { current.onboarding.completedAt = AT })
  const reread = await state.read()
  assert.deepEqual(subscriptionUsage(reread.runs, AT, reread.archivedSubscriptionUsage), before)
})

test('retries preserve replaced subscription usage once and keep untouched packages live', async t => {
  const { state } = await fixture(t, { maxRuns: 1 })
  const initial = run('retry', [receipt('a'), receipt('b', { inputTokens: 50, outputTokens: 10 })])
  mergeRerun(initial, { status: 'completed', packages: [{ ...receipt('a', { inputTokens: 25, outputTokens: 5 }), answer: 'new' }] },
    { rerunIds: ['a'], billingFor: item => item.billing, finishedAt: AT })
  assert.equal(subscriptionUsageForRun(initial).calls, 3)
  assert.equal(subscriptionUsageForRun(initial).inputTokens, 175)
  await state.appendRun(initial)
  await state.appendRun(run('later', []))
  const saved = await state.read()
  const usage = subscriptionUsage(saved.runs, AT, saved.archivedSubscriptionUsage)
  assert.equal(usage.today.calls, 3)
  assert.equal(usage.today.inputTokens, 175)
})

test('v1/v2 archived counts migrate to unknown quantity without fabricating tokens or USD-based quota', async t => {
  const { file } = await fixture(t)
  for (const version of [1, 2]) {
    await writeFile(file, JSON.stringify({ version, runs: [run('current', [receipt('a')])],
      archivedSpending: { days: { '2026-10-24': { costUsd: 2, subscriptionRuns: 3, subscriptionUsd: 99 } },
        months: { '2026-10': { costUsd: 2, subscriptionRuns: 3, subscriptionUsd: 99 } } } }))
    const state = createRouterState({ file, now: () => AT })
    const saved = await state.read()
    assert.equal(saved.version, 3)
    const usage = subscriptionUsage(saved.runs, AT, saved.archivedSubscriptionUsage)
    assert.equal(usage.today.calls, 4)
    assert.equal(usage.today.unknownUsageCalls, 3)
    assert.equal(usage.today.inputTokens, 100)
    assert.equal(spending(saved.runs, AT, saved.archivedSpending).today, 2)
    assert.equal(saved.historyIncomplete, false)
    await state.update(() => {})
    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 3)
  }
})

test('a retry of a legacy run retains already archived unknown subscription attempts', () => {
  const initial = { ...run('legacy', [receipt('a')]), priorAttemptSpending: {
    days: { '2026-10-24': { subscriptionRuns: 2 } }, months: { '2026-10': { subscriptionRuns: 2 } } } }
  mergeRerun(initial, { packages: [{ ...receipt('a', { inputTokens: 5, outputTokens: 1 }) }] }, { rerunIds: ['a'], billingFor: item => item.billing })
  const usage = subscriptionUsageForRun(initial)
  assert.equal(usage.calls, 4)
  assert.equal(usage.unknownUsageCalls, 2)
  assert.equal(usage.inputTokens, 105)
})

test('usage corruption is flagged separately and does not contaminate API financial history', async t => {
  const { file } = await fixture(t)
  await writeFile(file, JSON.stringify({ version: 3, runs: [run('api', [api('a', 1)])],
    archivedSubscriptionUsage: { days: { '2026-10-24': { total: { calls: -1 }, byRoute: {} } }, months: {} } }))
  const saved = await createRouterState({ file }).read()
  assert.equal(saved.subscriptionUsageIncomplete, true)
  assert.equal(saved.historyIncomplete, false)
  assert.equal(spending(saved.runs, AT, saved.archivedSpending).today, 1)
  await writeFile(file, JSON.stringify({ version: 3, runs: [run('api', [api('a', 1)])], archivedSubscriptionUsage: null }))
  const invalidNull = await createRouterState({ file }).read()
  assert.equal(invalidNull.subscriptionUsageIncomplete, true)
  assert.equal(invalidNull.historyIncomplete, false)
})

test('API, team and tool ledger conversion preserves only whitelisted subscription receipt fields', () => {
  const subscriptionAttempts = [{ provider: 'plan', model: 'model', toolId: 'codex',
    usage: { inputTokens: 2, outputTokens: 1 }, finishedAt: AT, apiKey: 'fixture-value', answer: 'private answer' }]
  const common = { id: 'record', createdAt: AT, finishedAt: AT, task: 'fixture' }
  const records = [
    buildRunRecord({ ...common, plan, execution: { packages: [{ id: 'a', ok: true, billing: 'api', answer: 'a', subscriptionAttempts }] } }),
    buildTeamRunRecord({ ...common, plan, execution: { results: [{ id: 'a', status: 'succeeded', subscriptionAttempts }] } }),
    buildToolRunRecord({ ...common, toolId: 'codex', result: { status: 'succeeded', subscriptionAttempts } }),
  ]
  for (const record of records) {
    assert.equal(subscriptionUsageForRun(record).calls, 1)
    assert.equal(subscriptionUsageForRun(record).inputTokens, 2)
    assert.equal(Object.hasOwn(record.packages[0].subscriptionAttempts[0], 'apiKey'), false)
    assert.equal(Object.hasOwn(record.packages[0].subscriptionAttempts[0], 'answer'), false)
  }
})

test('archive periods and route labels are bounded while total quantities remain exact', () => {
  const packages = Array.from({ length: MAX_SUBSCRIPTION_USAGE_ROUTES + 10 }, (_, index) =>
    receipt(String(index), { inputTokens: 1, outputTokens: 0 }, { provider: `provider-${index}` }))
  const archived = archiveSubscriptionUsage([run('routes', packages)])
  const usage = subscriptionUsage([], AT, archived)
  assert.equal(usage.today.calls, packages.length)
  assert.equal(usage.today.inputTokens, packages.length)
  assert.equal(usage.byRoute.length, MAX_SUBSCRIPTION_USAGE_ROUTES)
  assert.equal(usage.byRoute.reduce((sum, row) => sum + row.today.calls, 0), packages.length)
  assert.equal(invalidArchivedSubscriptionUsage(archived), false)
  assert.deepEqual(sanitizeArchivedSubscriptionUsage(archived), archived)
})

test('team and tool conversion retain non-start and explicit API credential evidence', () => {
  for (const raw of [{ status: 'cancelled', notStarted: true },
    { status: 'succeeded', credentialSource: 'configured-api-key', usage: { inputTokens: 2, outputTokens: 1 } },
    { status: 'failed', blocked: true }]) {
    const team = buildTeamRunRecord({ id: 'team', createdAt: AT, task: 'fixture', plan,
      execution: { results: [{ id: 'a', ...raw }] } })
    const tool = buildToolRunRecord({ id: 'tool', createdAt: AT, task: 'fixture', toolId: 'codex', result: raw })
    assert.equal(subscriptionUsageForRun(team).calls, 0)
    assert.equal(subscriptionUsageForRun(tool).calls, 0)
    if (raw.credentialSource) {
      assert.equal(team.packages[0].billing, 'api')
      assert.equal(tool.packages[0].billing, 'api')
    }
  }
})
