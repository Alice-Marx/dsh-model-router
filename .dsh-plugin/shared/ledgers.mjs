/**
 * Two books, never one total.
 *
 * API calls and subscription calls are not the same currency, so they are not the same
 * ledger:
 *
 * - The **API book** is money. A call is priced before it runs, reserved while it runs and
 *   settled after it; a budget can pause it. Its numbers are USD.
 * - The **subscription book** is quota evidence. A call is counted, with the token quantities
 *   the vendor reported, and costs nothing here; whether it may continue is decided by the
 *   vendor's own window, which this product never guesses.
 *
 * Adding the two would produce a number that means nothing: a subscription call has no price,
 * and an API call consumes no subscription quota. Every field below therefore stays inside its
 * own book, and an unknown quantity stays `null` instead of becoming a zero.
 */

const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0)
const money = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

const COUNTS = ['calls', 'knownUsageCalls', 'unknownUsageCalls']
const TOKENS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/** Copy exactly the reported quantities; anything missing stays null. */
function subscriptionPeriod(value) {
  const period = {}
  for (const field of COUNTS) period[field] = count(value?.[field])
  for (const field of TOKENS) {
    period[field] = Number.isSafeInteger(value?.[field]) && value[field] >= 0 ? value[field] : null
  }
  return period
}

/**
 * @param {{
 *   spending?: { today?: number, month?: number, unknownToday?: number, unknownMonth?: number } | null,
 *   subscription?: { today?: object, month?: object, byRoute?: object[] } | null,
 *   budget?: { dailyLimitUsd?: number, monthlyLimitUsd?: number, exceeded?: boolean, action?: string, message?: string } | null,
 *   reserved?: { today?: number, activeCount?: number, interruptedCount?: number } | null,
 *   subscriptionIncomplete?: boolean,
 * }} source
 */
export function twoLedgers({ spending = null, subscription = null, budget = null, reserved = null, subscriptionIncomplete = false } = {}) {
  return {
    api: {
      book: 'api',
      label: 'API 调用费用账本',
      unit: 'USD',
      settled: { today: money(spending?.today), month: money(spending?.month) },
      // A call whose price was never learned is unknown, not free.
      unknown: { today: count(spending?.unknownToday), month: count(spending?.unknownMonth) },
      reserved: {
        today: money(reserved?.today),
        activeCount: count(reserved?.activeCount),
        interruptedCount: count(reserved?.interruptedCount),
      },
      limit: { daily: money(budget?.dailyLimitUsd), monthly: money(budget?.monthlyLimitUsd) },
      budget: {
        exceeded: budget?.exceeded === true,
        action: typeof budget?.action === 'string' ? budget.action : null,
        message: typeof budget?.message === 'string' ? budget.message : '',
      },
      excludes: '订阅调用（不产生费用，也不占用预算）',
    },
    subscription: {
      book: 'subscription',
      label: '订阅额度账本',
      unit: 'calls',
      today: subscriptionPeriod(subscription?.today),
      month: subscriptionPeriod(subscription?.month),
      byRoute: Array.isArray(subscription?.byRoute) ? subscription.byRoute : [],
      incomplete: subscriptionIncomplete === true,
      excludes: 'API 费用（订阅调用不产生美元费用）',
      note: subscriptionIncomplete === true
        ? '部分订阅记录缺少用量，只统计已知数量；未知数量保持未知。剩余额度以厂商界面为准。'
        : '只记录调用次数与厂商回报的 token 数量；剩余额度以厂商界面为准，产品不会估算。',
    },
  }
}

/** True when either book cannot be trusted as complete history. */
export function ledgersIncomplete(books) {
  return {
    api: count(books?.api?.unknown?.today) > 0 || count(books?.api?.unknown?.month) > 0,
    subscription: books?.subscription?.incomplete === true,
  }
}
