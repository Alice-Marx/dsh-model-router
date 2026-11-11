import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fundingForMainRoute, materializeMainRouteDefault, normalizeMainModelRoutes, preserveMainModelRoutes,
} from '../packages/orchestration/src/main-model-routes.mjs'
import { defaultBotSettings, normalizeBotSettings } from '../packages/orchestration/src/bot-settings.mjs'

// The helper delegates every amount / token-bound / mode / cross-channel rule to
// the Host's own legacy funding normalizer; the default injection is exactly the
// bot-settings result the task names. No real model, account or price is used.
const normalizeFunding = funding => normalizeBotSettings({ ...defaultBotSettings(), funding }).funding
const norm = value => normalizeMainModelRoutes(value, { normalizeFunding })
const mat = settings => materializeMainRouteDefault(settings, { normalizeFunding })

const settings = (patch = {}) => ({ schemaVersion: 1, enabled: false, model: null, officialTools: [], machineGrants: [], capabilities: [], workspaceRef: null, routing: null,
  funding: { mode: 'api', scopeId: null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null }, maxConcurrentTasks: 1, ...patch })
const route = (provider, model, funding, enabled = true) => ({ provider, model, enabled, funding })
const apiFunding = (patch = {}) => ({ mode: 'api', scopeId: 'scope-openai', pricing: { input: 1.5, output: 3 }, request: { maxInputTokens: 100000, maxOutputTokens: 4096 }, ...patch })
const subFunding = (patch = {}) => ({ mode: 'subscription', scopeId: 'scope-anthropic', ...patch })
const mainRoutes = (routes, limits = { api: { dailyBudgetUsd: 10, monthlyBudgetUsd: 100 }, subscription: { dailyCalls: 50, monthlyCalls: 500 } }) => ({ schemaVersion: 1, limits, routes })
const codeOf = fn => { try { fn(); return null } catch (error) { return error.code } }

test('normalize: null and absent values collapse to null; a non-function normalizer is a programmer error', () => {
  assert.equal(norm(null), null)
  assert.equal(norm(undefined), null)
  assert.throws(() => normalizeMainModelRoutes(mainRoutes([])), error => error instanceof TypeError)
})

test('two API routes keep distinct prices and scopes but share one global budget', () => {
  const collection = norm(mainRoutes([
    route('openai', 'gpt-5', apiFunding({ scopeId: 'scope-openai', pricing: { input: 1.25, output: 10 } })),
    route('anthropic', 'claude-sonnet-4', apiFunding({ scopeId: 'scope-anthropic', pricing: { input: 3, output: 15 } })),
  ]))
  const openai = fundingForMainRoute(collection, { provider: 'openai', model: 'gpt-5' })
  const anthropic = fundingForMainRoute(collection, { provider: 'anthropic', model: 'claude-sonnet-4' })
  assert.deepEqual(openai.pricing, { input: 1.25, output: 10 })
  assert.equal(openai.scopeId, 'scope-openai')
  assert.deepEqual(anthropic.pricing, { input: 3, output: 15 })
  assert.equal(anthropic.scopeId, 'scope-anthropic')
  // Same shared global budget on both routes; no per-route counter is created.
  assert.deepEqual([openai.dailyBudgetUsd, openai.monthlyBudgetUsd], [10, 100])
  assert.deepEqual([anthropic.dailyBudgetUsd, anthropic.monthlyBudgetUsd], [10, 100])
  assert.equal(openai.subscription, null)
  assert.equal(anthropic.subscription, null)
})

test('an API route and a subscription route coexist, each on its own channel', () => {
  const collection = norm(mainRoutes([route('openai', 'gpt-5', apiFunding()), route('anthropic', 'claude-sonnet-4', subFunding())]))
  const api = fundingForMainRoute(collection, { provider: 'openai', model: 'gpt-5' })
  const sub = fundingForMainRoute(collection, { provider: 'anthropic', model: 'claude-sonnet-4' })
  assert.equal(api.mode, 'api')
  assert.equal(api.subscription, null)
  assert.deepEqual(api.pricing, { input: 1.5, output: 3 })
  assert.equal(sub.mode, 'subscription')
  assert.equal(sub.pricing, null)
  assert.equal(sub.request, null)
  assert.equal(sub.dailyBudgetUsd, null)
  assert.deepEqual(sub.subscription, { dailyCalls: 50, monthlyCalls: 500 })
})

test('a global limit of 0 is a real prohibition; a null group is unconfigured', () => {
  const zero = norm(mainRoutes([route('openai', 'gpt-5', apiFunding())], { api: { dailyBudgetUsd: 0, monthlyBudgetUsd: 0 }, subscription: null }))
  const funding = fundingForMainRoute(zero, { provider: 'openai', model: 'gpt-5' })
  assert.deepEqual([funding.dailyBudgetUsd, funding.monthlyBudgetUsd], [0, 0])
  const unconfigured = norm(mainRoutes([route('openai', 'gpt-5', apiFunding())], { api: null, subscription: null }))
  assert.equal(fundingForMainRoute(unconfigured, { provider: 'openai', model: 'gpt-5' }), null)
  const subZero = norm(mainRoutes([route('anthropic', 'claude-sonnet-4', subFunding())], { api: null, subscription: { dailyCalls: 0, monthlyCalls: 0 } }))
  assert.deepEqual(fundingForMainRoute(subZero, { provider: 'anthropic', model: 'claude-sonnet-4' }).subscription, { dailyCalls: 0, monthlyCalls: 0 })
})

test('a null field inside a present limit group is refused, not silently completed', () => {
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', apiFunding())], { api: { dailyBudgetUsd: 5, monthlyBudgetUsd: null }, subscription: null }))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('anthropic', 'claude-sonnet-4', subFunding())], { api: null, subscription: { dailyCalls: 5, monthlyCalls: null } }))), 'BOT_SETTINGS_INVALID')
})

test('a disabled route, a missing route and missing bounds all yield null funding', () => {
  const collection = norm(mainRoutes([
    route('openai', 'gpt-5', apiFunding(), false),
    route('anthropic', 'claude-sonnet-4', apiFunding({ pricing: null })),
    route('google', 'gemini-2', apiFunding({ request: null })),
    route('meta', 'llama-3', apiFunding({ scopeId: null })),
  ]))
  assert.equal(fundingForMainRoute(collection, { provider: 'openai', model: 'gpt-5' }), null)
  assert.equal(fundingForMainRoute(collection, { provider: 'anthropic', model: 'claude-sonnet-4' }), null)
  assert.equal(fundingForMainRoute(collection, { provider: 'google', model: 'gemini-2' }), null)
  assert.equal(fundingForMainRoute(collection, { provider: 'meta', model: 'llama-3' }), null)
  assert.equal(fundingForMainRoute(collection, { provider: 'mistral', model: 'large' }), null)
  // An unfinished disabled draft is still stored and never inferred as ready.
  const draft = norm(mainRoutes([route('openai', 'gpt-5', apiFunding({ scopeId: null, pricing: null, request: null }), false)]))
  assert.equal(draft.routes[0].enabled, false)
  assert.equal(fundingForMainRoute(draft, { provider: 'openai', model: 'gpt-5' }), null)
})

test('unknown and forged fields are refused at every layer', () => {
  assert.equal(codeOf(() => norm({ schemaVersion: 1, limits: { api: null, subscription: null }, routes: [], endpoint: 'https://evil' })), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([{ provider: 'openai', model: 'gpt-5', enabled: true, credential: 'sk-secret', funding: apiFunding() }]))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', { ...apiFunding(), apiKey: 'x' })]))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', { ...apiFunding(), pricing: { input: 1, output: 2, endpoint: 'https://x' } })]))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', apiFunding())], { api: { dailyBudgetUsd: 1, monthlyBudgetUsd: 1 }, subscription: null, path: 'C:/x' }))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', apiFunding({ scopeId: '../etc/passwd' }))]))), 'BOT_SETTINGS_INVALID')
})

test('a subscription profile carrying API price or request is refused, not silently dropped', () => {
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', { mode: 'subscription', scopeId: 'scope-x', pricing: { input: 1, output: 2 } })]))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', { mode: 'subscription', scopeId: 'scope-x', request: { maxInputTokens: 1, maxOutputTokens: 1 } })]))), 'BOT_SETTINGS_INVALID')
})

test('legacy amount, token and mode rules are reused, not re-implemented', () => {
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', apiFunding({ pricing: { input: -1, output: 2 } }))]))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', apiFunding({ pricing: { input: 1 } }))]))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', apiFunding({ request: { maxInputTokens: 0, maxOutputTokens: 5 } }))]))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', apiFunding())], { api: { dailyBudgetUsd: 2000000000, monthlyBudgetUsd: 1 }, subscription: null }))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('anthropic', 'claude-sonnet-4', subFunding())], { api: null, subscription: { dailyCalls: 1.5, monthlyCalls: 5 } }))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('anthropic', 'claude-sonnet-4', subFunding())], { api: null, subscription: { dailyCalls: -1, monthlyCalls: 5 } }))), 'BOT_SETTINGS_INVALID')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', { mode: 'prepaid', scopeId: 's' })]))), 'BOT_SETTINGS_INVALID')
})

test('routes are stably sorted, deduplicated by tuple, and a model may contain a slash', () => {
  const collection = norm(mainRoutes([
    route('openai', 'gpt-5', apiFunding()),
    route('a', 'b/c', apiFunding({ scopeId: 'scope-a' })),
  ]))
  assert.deepEqual(collection.routes.map(item => `${item.provider}/${item.model}`), ['a/b/c', 'openai/gpt-5'])
  assert.equal(fundingForMainRoute(collection, { provider: 'a', model: 'b/c' }).scopeId, 'scope-a')
  assert.equal(codeOf(() => norm(mainRoutes([route('openai', 'gpt-5', apiFunding()), route('openai', 'gpt-5', apiFunding())]))), 'BOT_SETTINGS_DUPLICATE')
  // A binary tuple, so "a"+"b/c" and "a/b"+"c" are distinct routes, not a collision.
  const distinct = norm(mainRoutes([route('a', 'b/c', apiFunding({ scopeId: 'scope-a' })), route('a/b', 'c', apiFunding({ scopeId: 'scope-2' }))]))
  assert.equal(distinct.routes.length, 2)
  assert.equal(fundingForMainRoute(distinct, { provider: 'a', model: 'b/c' }).scopeId, 'scope-a')
  assert.equal(fundingForMainRoute(distinct, { provider: 'a/b', model: 'c' }).scopeId, 'scope-2')
})

test('schema version and route-count caps are enforced', () => {
  assert.equal(codeOf(() => norm({ schemaVersion: 2, limits: { api: null, subscription: null }, routes: [] })), 'BOT_SETTINGS_VERSION_UNSUPPORTED')
  assert.equal(codeOf(() => norm(mainRoutes(Array.from({ length: 65 }, (_, index) => route('p', `m${index}`, apiFunding()))))), 'BOT_SETTINGS_INVALID')
  const full = norm(mainRoutes(Array.from({ length: 64 }, (_, index) => route('p', `m${index}`, apiFunding()))))
  assert.equal(full.routes.length, 64)
})

test('the 64 KiB cap guards the stored collection and never misfires at the schema maximum', () => {
  // The closed schema bounds a valid collection near 54 KiB, so the cap is
  // defense-in-depth aligned with bot_settings_records: verify the largest valid
  // collection is accepted and stays under the cap rather than false-triggering.
  const provider = 'p'.repeat(256), scopeId = 's'.repeat(128)
  const routes = Array.from({ length: 64 }, (_, index) => route(provider, `${'m'.repeat(250)}${String(index).padStart(3, '0')}`,
    apiFunding({ scopeId, pricing: { input: 1000000000, output: 1000000000 }, request: { maxInputTokens: 1000000000, maxOutputTokens: 1000000000 } })))
  const collection = norm(mainRoutes(routes, { api: { dailyBudgetUsd: 1000000000, monthlyBudgetUsd: 1000000000 }, subscription: null }))
  assert.equal(collection.routes.length, 64)
  assert.ok(Buffer.byteLength(JSON.stringify(collection)) < 64 * 1024)
})

test('funding results are deep copies that cannot mutate the normalized profile', () => {
  const input = mainRoutes([route('openai', 'gpt-5', apiFunding())])
  const snapshot = structuredClone(input)
  const collection = norm(input)
  assert.deepEqual(input, snapshot, 'normalize must not mutate its input')
  const first = fundingForMainRoute(collection, { provider: 'openai', model: 'gpt-5' })
  first.pricing.input = 999
  first.dailyBudgetUsd = 999
  first.subscription = { dailyCalls: 1, monthlyCalls: 1 }
  const second = fundingForMainRoute(collection, { provider: 'openai', model: 'gpt-5' })
  assert.equal(second.pricing.input, 1.5)
  assert.equal(second.dailyBudgetUsd, 10)
  assert.equal(second.subscription, null)
})

test('fundingForMainRoute tolerates a null collection and malformed targets', () => {
  assert.equal(fundingForMainRoute(null, { provider: 'openai', model: 'gpt-5' }), null)
  assert.equal(fundingForMainRoute({ routes: 'nope' }, { provider: 'openai', model: 'gpt-5' }), null)
  const collection = norm(mainRoutes([route('openai', 'gpt-5', apiFunding())]))
  assert.equal(fundingForMainRoute(collection, {}), null)
  assert.equal(fundingForMainRoute(collection, { provider: 'openai' }), null)
  // A hand-built (non-normalized) collection cannot crash the resolver or misroute.
  assert.equal(fundingForMainRoute({ schemaVersion: 1, limits: { api: null, subscription: null }, routes: [{ provider: 'openai', model: 'gpt-5', enabled: true }] }, { provider: 'openai', model: 'gpt-5' }), null)
  assert.equal(fundingForMainRoute({ schemaVersion: 1, limits: { api: null, subscription: null }, routes: [{ provider: 'openai', model: 'gpt-5', enabled: true, funding: { mode: 'weird', scopeId: 's' } }] }, { provider: 'openai', model: 'gpt-5' }), null)
})

test('materialize: the legacy no-mainRoutes case is value-identical', () => {
  const legacy = settings({ enabled: true, model: { provider: 'openai', model: 'gpt-5' }, funding: { mode: 'api', scopeId: 'z', pricing: null, request: null, dailyBudgetUsd: 1, monthlyBudgetUsd: 2, subscription: null } })
  assert.deepEqual(mat(legacy), legacy)
  const legacyNull = settings({ mainRoutes: null, enabled: true, model: { provider: 'openai', model: 'gpt-5' }, funding: { mode: 'api', scopeId: 'z', pricing: null, request: null, dailyBudgetUsd: 1, monthlyBudgetUsd: 2, subscription: null } })
  assert.deepEqual(mat(legacyNull).funding, legacyNull.funding)
})

test('materialize: funding is generated from the committed default model, never the first route', () => {
  const declaration = mainRoutes([
    route('anthropic', 'claude-sonnet-4', subFunding()),
    route('openai', 'gpt-5', apiFunding({ scopeId: 'scope-openai', pricing: { input: 2, output: 4 } })),
  ])
  const enabled = mat(settings({ enabled: true, model: { provider: 'openai', model: 'gpt-5' }, mainRoutes: declaration }))
  assert.deepEqual(enabled.funding.pricing, { input: 2, output: 4 })
  assert.equal(enabled.funding.scopeId, 'scope-openai')
  // A ready default generates funding even while disabled, but never a fabricated one when not ready.
  const disabledReady = mat(settings({ enabled: false, model: { provider: 'openai', model: 'gpt-5' }, mainRoutes: declaration }))
  assert.deepEqual(disabledReady.funding.pricing, { input: 2, output: 4 })
})

test('materialize: enabled refuses a missing, disabled or not-ready default without auto-selecting', () => {
  const declaration = mainRoutes([route('anthropic', 'claude-sonnet-4', apiFunding({ scopeId: 'scope-anthropic' }))])
  assert.equal(codeOf(() => mat(settings({ enabled: true, model: null, mainRoutes: declaration }))), 'MAIN_ROUTE_DEFAULT_UNAVAILABLE')
  assert.equal(codeOf(() => mat(settings({ enabled: true, model: { provider: 'meta', model: 'llama' }, mainRoutes: declaration }))), 'MAIN_ROUTE_DEFAULT_UNAVAILABLE')
  const disabledDefault = mainRoutes([route('anthropic', 'claude-sonnet-4', apiFunding({ scopeId: 'scope-anthropic' }), false)])
  assert.equal(codeOf(() => mat(settings({ enabled: true, model: { provider: 'anthropic', model: 'claude-sonnet-4' }, mainRoutes: disabledDefault }))), 'MAIN_ROUTE_DEFAULT_UNAVAILABLE')
  const notReady = mainRoutes([route('anthropic', 'claude-sonnet-4', apiFunding({ scopeId: 'scope-anthropic', pricing: null }))])
  assert.equal(codeOf(() => mat(settings({ enabled: true, model: { provider: 'anthropic', model: 'claude-sonnet-4' }, mainRoutes: notReady }))), 'MAIN_ROUTE_DEFAULT_UNAVAILABLE')
})

test('materialize: a disabled not-ready default keeps its draft and fabricates nothing', () => {
  const notReady = mainRoutes([route('openai', 'gpt-5', apiFunding({ pricing: null, request: null, scopeId: null }))])
  const draft = settings({ enabled: false, model: { provider: 'openai', model: 'gpt-5' }, mainRoutes: notReady })
  const result = mat(draft)
  assert.equal(result.funding.pricing, null)
  assert.equal(result.funding.dailyBudgetUsd, null)
})

test('preserve: an old client omitting the field keeps a stored collection when identity is unchanged', () => {
  const declaration = mainRoutes([route('openai', 'gpt-5', apiFunding())])
  const previous = settings({ mainRoutes: declaration, model: { provider: 'openai', model: 'gpt-5' }, funding: { mode: 'api', scopeId: 'scope-openai', pricing: { input: 1.5, output: 3 }, request: { maxInputTokens: 100000, maxOutputTokens: 4096 }, dailyBudgetUsd: 10, monthlyBudgetUsd: 100, subscription: null } })
  const next = settings({ model: { provider: 'openai', model: 'gpt-5' }, capabilities: ['model-inference'], funding: { mode: 'api', scopeId: 'scope-openai', pricing: { input: 1.5, output: 3 }, request: { maxInputTokens: 100000, maxOutputTokens: 4096 }, dailyBudgetUsd: 10, monthlyBudgetUsd: 100, subscription: null } })
  const kept = preserveMainModelRoutes(next, previous)
  assert.deepEqual(kept.mainRoutes, declaration)
  assert.deepEqual(kept.capabilities, ['model-inference'], 'an unrelated field change is preserved, not dropped')
})

test('preserve: a changed default model or funding forces an explicit re-read', () => {
  const declaration = mainRoutes([route('openai', 'gpt-5', apiFunding())])
  const base = { mode: 'api', scopeId: 'scope-openai', pricing: { input: 1.5, output: 3 }, request: { maxInputTokens: 100000, maxOutputTokens: 4096 }, dailyBudgetUsd: 10, monthlyBudgetUsd: 100, subscription: null }
  const previous = settings({ mainRoutes: declaration, model: { provider: 'openai', model: 'gpt-5' }, funding: base })
  const changedModel = settings({ model: { provider: 'anthropic', model: 'claude-sonnet-4' }, funding: base })
  assert.equal(codeOf(() => preserveMainModelRoutes(changedModel, previous)), 'MAIN_ROUTES_RELOAD_REQUIRED')
  const changedFunding = settings({ model: { provider: 'openai', model: 'gpt-5' }, funding: { ...base, dailyBudgetUsd: 999 } })
  assert.equal(codeOf(() => preserveMainModelRoutes(changedFunding, previous)), 'MAIN_ROUTES_RELOAD_REQUIRED')
})

test('preserve: an explicit null exits multi-route and a value is always honored', () => {
  const declaration = mainRoutes([route('openai', 'gpt-5', apiFunding())])
  const previous = settings({ mainRoutes: declaration, model: { provider: 'openai', model: 'gpt-5' }, funding: { mode: 'api', scopeId: 'scope-openai', pricing: { input: 1.5, output: 3 }, request: { maxInputTokens: 100000, maxOutputTokens: 4096 }, dailyBudgetUsd: 10, monthlyBudgetUsd: 100, subscription: null } })
  assert.equal(preserveMainModelRoutes(settings({ mainRoutes: null }), previous).mainRoutes, null)
  const replacement = mainRoutes([route('anthropic', 'claude-sonnet-4', subFunding())])
  assert.deepEqual(preserveMainModelRoutes(settings({ mainRoutes: replacement }), previous).mainRoutes, replacement)
})

test('preserve: ordinary old settings with no stored collection are unaffected', () => {
  const previous = settings({ model: { provider: 'openai', model: 'gpt-5' }, funding: { mode: 'api', scopeId: 'z', pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null } })
  const next = settings({ model: { provider: 'anthropic', model: 'claude-sonnet-4' }, funding: { mode: 'api', scopeId: 'z', pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null } })
  const kept = preserveMainModelRoutes(next, previous)
  assert.equal(kept.mainRoutes, undefined)
  assert.deepEqual(kept, next)
  const previousExit = settings({ mainRoutes: null })
  assert.equal(preserveMainModelRoutes(next, previousExit).mainRoutes, undefined)
})
