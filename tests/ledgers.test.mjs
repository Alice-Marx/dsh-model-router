import test from 'node:test'
import assert from 'node:assert/strict'
import { ledgersIncomplete, twoLedgers } from '../.dsh-plugin/shared/ledgers.mjs'

test('two books: money and quota never merge into one total', () => {
  const { api, subscription } = twoLedgers({
    spending: { today: 1.25, month: 9.5, unknownToday: 0, unknownMonth: 2 },
    subscription: { today: { calls: 3, knownUsageCalls: 2, unknownUsageCalls: 1, inputTokens: 1200, outputTokens: 300 },
      month: { calls: 40, knownUsageCalls: 39, unknownUsageCalls: 1, inputTokens: null, outputTokens: 8000 }, byRoute: [] },
  })
  assert.equal(api.book, 'api')
  assert.equal(api.unit, 'USD')
  assert.equal(subscription.book, 'subscription')
  assert.equal(subscription.unit, 'calls')
  assert.equal(api.settled.today, 1.25)
  assert.equal(subscription.today.calls, 3)
  // No field of one book appears in the other.
  assert.equal('calls' in api.settled, false)
  assert.equal('today' in subscription && typeof subscription.today === 'object', true)
  assert.equal('settled' in subscription, false)
})

test('two books: an unpriced API call is unknown, never zero', () => {
  const { api } = twoLedgers({ spending: { today: 0, month: 4, unknownToday: 3, unknownMonth: 3 } })
  assert.equal(api.settled.today, 0)
  assert.equal(api.unknown.today, 3)
  assert.deepEqual(ledgersIncomplete({ api }), { api: true, subscription: false })
})

test('two books: a subscription token quantity that was not reported stays null', () => {
  const { subscription } = twoLedgers({
    subscription: { today: { calls: 2, knownUsageCalls: 1, unknownUsageCalls: 1, inputTokens: null, outputTokens: 10 } },
  })
  assert.equal(subscription.today.calls, 2)
  assert.equal(subscription.today.inputTokens, null)
  assert.equal(subscription.today.outputTokens, 10)
  assert.equal(subscription.incomplete, false)
})

test('two books: missing input is an empty book, not a fabricated zero-cost total', () => {
  const { api, subscription } = twoLedgers({})
  assert.equal(api.settled.today, null)
  assert.equal(api.limit.daily, null)
  assert.equal(api.unknown.today, 0)
  assert.equal(subscription.today.calls, 0)
  assert.equal(subscription.today.inputTokens, null)
})

test('two books: the budget lives in the API book only', () => {
  const { api, subscription } = twoLedgers({
    budget: { dailyLimitUsd: 5, monthlyLimitUsd: 50, exceeded: true, action: 'pause', message: '今日预算已用完。' },
  })
  assert.equal(api.budget.exceeded, true)
  assert.equal(api.budget.action, 'pause')
  assert.equal(api.limit.daily, 5)
  assert.equal('budget' in subscription, false)
})

test('two books: incomplete subscription history is stated, not smoothed over', () => {
  const books = twoLedgers({ subscriptionIncomplete: true, subscription: { today: { calls: 1 } } })
  assert.equal(books.subscription.incomplete, true)
  assert.match(books.subscription.note, /缺少用量/)
  assert.deepEqual(ledgersIncomplete(books).subscription, true)
})

test('two books: each book names what it excludes', () => {
  const { api, subscription } = twoLedgers({})
  assert.match(api.excludes, /订阅/)
  assert.match(subscription.excludes, /API 费用/)
})
