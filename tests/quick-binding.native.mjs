import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { QUICK_PROJECT_ID, defaultQuickBinding, normalizeQuickBinding, openQuickBindingSettings, profilePrices, quickFunding, quickPriceFor } from '../packages/orchestration/src/quick-binding.mjs'
import { defaultBotSettings, normalizeBotSettings, openBotSettings } from '../packages/orchestration/src/bot-settings.mjs'
import { createModelAccounting } from '../packages/orchestration/src/model-accounting.mjs'
import { BOT_TEMPLATES, listBotTemplates, templateBotRequest } from '../packages/orchestration/src/bot-templates.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const parent = join(ROOT, 'tmp/integration/quick-binding')
await mkdir(parent, { recursive: true })
const owner = { kind: 'owner' }

test('quick policy: closed schema, sorted prices and no API price for official engines', () => {
  assert.deepEqual(normalizeQuickBinding(null), defaultQuickBinding())
  const value = normalizeQuickBinding({ prices: [
    { provider: 'zeta', model: 'b', input: 1, output: 2 },
    { provider: 'alpha', model: 'a', input: 0.5, output: 1.5, cacheRead: 0.05 },
  ] })
  assert.deepEqual(value.prices.map(row => `${row.provider}/${row.model}`), ['alpha/a', 'zeta/b'])
  assert.equal(value.prices[0].cacheRead, 0.05)
  assert.throws(() => normalizeQuickBinding({ endpoint: 'https://example.invalid' }), { code: 'QUICK_BINDING_INVALID' })
  assert.throws(() => normalizeQuickBinding({ prices: [{ provider: 'engine-codex', model: 'default', input: 1, output: 1 }] }), { code: 'QUICK_BINDING_INVALID' })
  assert.throws(() => normalizeQuickBinding({ prices: [{ provider: 'a', model: 'b', input: 1, output: 1 }, { provider: 'a', model: 'b', input: 2, output: 2 }] }), { code: 'QUICK_BINDING_INVALID' })
  assert.throws(() => normalizeQuickBinding({ botDailyUsd: -1 }), { code: 'QUICK_BINDING_INVALID' })
  assert.throws(() => normalizeQuickBinding({ maxOutputTokens: 0 }), { code: 'QUICK_BINDING_INVALID' })
})

test('quick policy store: owner-only CAS saves survive reopening', async () => {
  const file = join(await mkdtemp(join(parent, 'store-')), 'orchestration.sqlite')
  const store = openQuickBindingSettings({ Database, file, now: () => 1000 })
  assert.equal(store.get().revision, 0)
  assert.throws(() => store.save({ expectedRevision: 0, settings: { botDailyUsd: 1 } }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  const saved = store.save({ expectedRevision: 0, settings: { botDailyUsd: 1, prices: [{ provider: 'fixture', model: 'm', input: 3, output: 15 }] } }, owner)
  assert.equal(saved.revision, 1)
  assert.throws(() => store.save({ expectedRevision: 0, settings: {} }, owner), { code: 'QUICK_BINDING_CONFLICT' })
  store.close()
  const reopened = openQuickBindingSettings({ Database, file })
  assert.equal(reopened.get().revision, 1)
  assert.equal(reopened.get().settings.botDailyUsd, 1)
  assert.deepEqual(reopened.get().settings.prices[0], { provider: 'fixture', model: 'm', input: 3, output: 15 })
  reopened.close()
})

test('quick funding: engines are subscription calls, API routes need a known price and keep both caps', () => {
  const policy = normalizeQuickBinding({ prices: [{ provider: 'fixture', model: 'priced', input: 2, output: 8 }] })
  assert.deepEqual(quickFunding(policy, { provider: 'engine-claude-code', model: 'sonnet' }), {
    funding: 'subscription', quick: true, route: { provider: 'engine-claude-code', model: 'sonnet' }, scopeId: null,
    subscriptionMaxCalls: null, subscriptionMonthlyCalls: null })
  const priced = quickFunding(policy, { provider: 'fixture', model: 'priced' })
  assert.equal(priced.funding, 'api')
  assert.deepEqual(priced.pricing, { input: 2, output: 8 })
  assert.equal(priced.pricingSource, 'quick-binding')
  assert.equal(priced.projectId, QUICK_PROJECT_ID)
  assert.equal(priced.botDailyLimitUsd, policy.botDailyUsd)
  assert.equal(priced.projectMonthlyLimitUsd, policy.totalMonthlyUsd)
  assert.equal(quickFunding(policy, { provider: 'fixture', model: 'unpriced' }).pricing, null)
  assert.equal(quickFunding(policy, { provider: 'fixture', model: 'priced' }, { contextWindow: 32_000 }).maxInputTokens, 32_000)
  assert.equal(quickFunding({ ...policy, enabled: false }, { provider: 'fixture', model: 'priced' }), null)
  const profiles = profilePrices(JSON.stringify([{ provider: 'fixture', model: 'profiled', pricing: { input: 1, output: 4 } }]))
  assert.deepEqual(quickPriceFor(policy, { provider: 'fixture', model: 'profiled' }, profiles), { pricing: { input: 1, output: 4 }, source: 'model-profile' })
  assert.equal(profilePrices('not json').size, 0)
})

test('Bot settings: quick mode defaults on, is a closed boolean and only blocks when switched off', async t => {
  assert.equal(defaultBotSettings().quickBinding, true)
  assert.equal(normalizeBotSettings({ schemaVersion: 1, enabled: false }).quickBinding, true)
  assert.throws(() => normalizeBotSettings({ schemaVersion: 1, enabled: false, quickBinding: 'yes' }), { code: 'BOT_SETTINGS_INVALID' })
  const store = openBotSettings({ Database, file: ':memory:', botExists: id => id === 'bot-a' })
  t.after(() => store.close())
  assert.match(store.get('bot-a').blockedReason, /高级绑定/)
  assert.match(store.get('bot-a').nextAction, /快速模式/)
  const off = await store.save({ botId: 'bot-a', expectedRevision: 0, settings: { ...defaultBotSettings(), quickBinding: false } }, owner)
  assert.equal(off.settings.quickBinding, false)
  assert.match(off.blockedReason, /模型调用已停用/)
  assert.deepEqual(off.grant, { tools: [], modelRoutes: [] })
})

test('model accounting: a quick route without a price is refused with an actionable message', async () => {
  const store = { kind: 'sqlite-router-state', recordModelReceipt: async () => {} }
  const authority = { assertModel() {}, assertTool() {}, describe: () => ({ botId: 'bot-a' }) }
  const policy = normalizeQuickBinding(null)
  const accounting = createModelAccounting({ store, authority, machineId: 'm', workspaceId: 'w',
    pricingFor: async ({ provider, model }) => quickFunding(policy, { provider, model }), inputBoundFor: async ({ config }) => config.maxInputTokens })
  const stream = accounting.stream({ provider: 'fixture', model: 'unpriced', messages: [] }, async function* () {}, { botId: 'bot-a', subject: {}, source: 'bot' })
  await assert.rejects(async () => { for await (const _ of stream) { /* drain */ } }, error => {
    assert.equal(error.code, 'MODEL_PRICE_REQUIRED')
    assert.match(error.message, /^MODEL_PRICE_REQUIRED：/)
    assert.match(error.message, /快速模式/)
    return true
  })
  await accounting.close()
})

test('ready-made Bots: sixteen localized templates that carry no permission, model or brand', () => {
  const view = listBotTemplates()
  assert.equal(view.items.length, 16)
  assert.equal(new Set(view.items.map(item => item.id)).size, 16)
  for (const item of view.items) assert.ok(view.categories.some(category => category.id === item.category), item.id)
  for (const template of BOT_TEMPLATES) {
    const text = JSON.stringify(template)
    assert.doesNotMatch(text, /maus/i, template.id)
    assert.ok(!('tools' in template) && !('model' in template) && !('workDir' in template), template.id)
    assert.ok(['deepseek', 'blue', 'violet', 'orange', 'green', 'magenta', 'cyan', 'red', 'yellow', 'brown', 'gray', 'black', 'aurora'].includes(template.color), template.id)
  }
  assert.deepEqual(Object.keys(templateBotRequest({ templateId: 'writer' })).sort(), ['color', 'instructions', 'name', 'role'])
  assert.equal(templateBotRequest({ templateId: 'writer', name: '  我的写手 ', model: 'fixture/m' }).name, '我的写手')
  assert.throws(() => templateBotRequest({ templateId: 'nope' }), { code: 'BOT_TEMPLATE_NOT_FOUND' })
  assert.throws(() => templateBotRequest({ templateId: 'writer', name: 'x'.repeat(41) }), { code: 'BOT_TEMPLATE_NAME_INVALID' })
  assert.throws(() => templateBotRequest({ templateId: 'writer', model: 'no-slash' }), { code: 'BOT_TEMPLATE_MODEL_INVALID' })
})
