import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBotSettings, normalizeBotSettings } from '../packages/orchestration/src/bot-settings.mjs'

const base = extra => ({ ...defaultBotSettings(), enabled: false, ...extra })

test('settings: routing is null by default and inherits the global policy', () => {
  assert.equal(normalizeBotSettings(base({})).routing, null)
})

test('settings: a Bot may carry its own preset and budgets', () => {
  const value = normalizeBotSettings(base({ routing: { preset: 'quality', dailyBudgetUsd: 5, monthlyBudgetUsd: 80 } }))
  assert.deepEqual(value.routing, { preset: 'quality', dailyBudgetUsd: 5, monthlyBudgetUsd: 80 })
})

test('settings: a partial routing policy keeps the rest null', () => {
  const value = normalizeBotSettings(base({ routing: { preset: 'economy' } }))
  assert.deepEqual(value.routing, { preset: 'economy', dailyBudgetUsd: null, monthlyBudgetUsd: null })
})

// The policy errors carry a code rather than a message prefix, so assert on the code.
const refuses = input => assert.throws(() => normalizeBotSettings(input), error => {
  assert.match(String(error?.code ?? ''), /^BOT_SETTINGS_/, `unexpected error: ${error?.message}`)
  return true
})

test('settings: an unknown preset or a negative budget is refused', () => {
  refuses(base({ routing: { preset: 'fastest' } }))
  refuses(base({ routing: { dailyBudgetUsd: -1 } }))
  refuses(base({ routing: { monthlyBudgetUsd: 'lots' } }))
})

test('settings: an unknown routing key is refused instead of silently dropped', () => {
  refuses(base({ routing: { preste: 'economy' } }))
})
