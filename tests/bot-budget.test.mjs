import test from 'node:test'
import assert from 'node:assert/strict'
import { createBotBudget } from '../packages/orchestration/src/bot-budget.mjs'

const code = expected => error => { assert.equal(error.code, expected, error.message); return true }
const limits = { 'bot-a': { dailyBudgetUsd: 5, monthlyBudgetUsd: 20 }, 'bot-b': { dailyBudgetUsd: null, monthlyBudgetUsd: null } }
const make = (at = Date.UTC(2026, 10, 4, 12)) => createBotBudget({ limitsFor: id => limits[id] ?? null, now: () => at })

test('budget: a spend within the ceiling is admitted, and the ceiling is per Bot', () => {
  const budget = make()
  assert.equal(budget.admit('bot-a', { usd: 4.5 }).allowed, true)
  budget.charge('bot-a', { usd: 4.5 })
  assert.equal(budget.admit('bot-a', { usd: 1 }).allowed, false)
  assert.equal(budget.admit('bot-b', { usd: 999 }).allowed, true, 'an unlimited Bot is unlimited')
})

test('budget: exceeding the daily ceiling names the daily reason, the monthly one names its own', () => {
  const budget = make()
  budget.charge('bot-a', { usd: 5 })
  const daily = budget.admit('bot-a', { usd: 0.01 })
  assert.equal(daily.allowed, false)
  assert.equal(daily.reason, 'BOT_DAILY_BUDGET_EXHAUSTED')
  assert.equal(budget.snapshot('bot-a').remainingToday, 0)
})

test('budget: the monthly ceiling denies even when the day is still fine', () => {
  const day = Date.UTC(2026, 10, 4, 12)
  const budget = createBotBudget({ limitsFor: id => ({ dailyBudgetUsd: 100, monthlyBudgetUsd: 2 }), now: () => day })
  budget.charge('bot-a', { usd: 1.5 })
  const denied = budget.admit('bot-a', { usd: 1 })
  assert.equal(denied.reason, 'BOT_MONTHLY_BUDGET_EXHAUSTED')
})

test('budget: a new day clears the daily spend but keeps the month', () => {
  let at = Date.UTC(2026, 10, 4, 12)
  const budget = createBotBudget({ limitsFor: () => ({ dailyBudgetUsd: 1, monthlyBudgetUsd: 10 }), now: () => at })
  budget.charge('bot-a', { usd: 1 })
  assert.equal(budget.admit('bot-a', { usd: 0.5 }).allowed, false)
  at = Date.UTC(2026, 10, 5, 1)
  assert.equal(budget.admit('bot-a', { usd: 0.5 }).allowed, true, 'the daily window rolled over')
  assert.equal(budget.snapshot('bot-a').spentThisMonth, 1, 'the month did not')
})

test('budget: an unpriced call is refused, never treated as free', () => {
  const budget = make()
  assert.throws(() => budget.admit('bot-a', { usd: null }), code('BUDGET_PRICE_UNKNOWN'))
  assert.throws(() => budget.admit('bot-a', {}), code('BUDGET_PRICE_UNKNOWN'))
  assert.throws(() => budget.charge('bot-a', { usd: Number.NaN }), code('BUDGET_PRICE_INVALID'))
})

test('budget: a malformed limit is refused at read time instead of silently becoming unlimited', () => {
  const budget = createBotBudget({ limitsFor: () => ({ dailyBudgetUsd: -1 }), now: () => Date.UTC(2026, 10, 4) })
  assert.throws(() => budget.snapshot('bot-a'), code('BUDGET_LIMIT_INVALID'))
})
