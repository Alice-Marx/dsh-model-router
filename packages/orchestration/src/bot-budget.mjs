/**
 * Per-Bot budgets.
 *
 * A routing policy may give one Bot a daily or monthly ceiling. This module is the arithmetic of
 * admission — "may this Bot spend this much right now" — kept separate from the ledger that records
 * what was actually spent, so a preview can ask the question without moving money.
 *
 * Two rules matter:
 *
 *  - a window rolls over on its own boundary, so yesterday's spend never denies today's work;
 *  - an unknown price is not free: a Bot with a zero remaining budget admits nothing that costs
 *    anything, and a caller that cannot price a call must say so instead of passing 0.
 */

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

const dayKey = at => { const date = new Date(at); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}` }
const monthKey = at => { const date = new Date(at); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` }

const cleanLimit = (value, field) => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail('BUDGET_LIMIT_INVALID', `${field} 必须是非负数字或 null。`)
  return value
}

/**
 * @param {{ limitsFor: (botId: string) => { dailyBudgetUsd?: number|null, monthlyBudgetUsd?: number|null } | null, now?: () => number }} options
 */
export function createBotBudget({ limitsFor, now = Date.now } = {}) {
  if (typeof limitsFor !== 'function') throw new TypeError('BUDGET_REQUIRE_LIMITS')
  /** botId -> { day: {key, spent}, month: {key, spent} } */
  const books = new Map()

  const bookOf = (botId, at) => {
    const day = dayKey(at)
    const month = monthKey(at)
    const current = books.get(botId) ?? {}
    const next = {
      day: current.day?.key === day ? current.day : { key: day, spent: 0 },
      month: current.month?.key === month ? current.month : { key: month, spent: 0 },
    }
    books.set(botId, next)
    return next
  }

  const limitsOf = botId => {
    const raw = limitsFor(botId) ?? {}
    return { daily: cleanLimit(raw.dailyBudgetUsd, 'dailyBudgetUsd'), monthly: cleanLimit(raw.monthlyBudgetUsd, 'monthlyBudgetUsd') }
  }

  const snapshot = (botId, at = now()) => {
    const book = bookOf(botId, at)
    const limits = limitsOf(botId)
    return {
      botId,
      day: book.day.key,
      month: book.month.key,
      spentToday: book.day.spent,
      spentThisMonth: book.month.spent,
      dailyBudgetUsd: limits.daily,
      monthlyBudgetUsd: limits.monthly,
      remainingToday: limits.daily === null ? null : Math.max(0, limits.daily - book.day.spent),
      remainingThisMonth: limits.monthly === null ? null : Math.max(0, limits.monthly - book.month.spent),
    }
  }

  return Object.freeze({
    snapshot,

    /**
     * Whether this Bot may spend `usd` now. A null price is refused rather than treated as free,
     * because an unpriced call is exactly the case a ceiling must not wave through.
     */
    admit(botId, { usd, at } = {}) {
      if (typeof botId !== 'string' || botId === '') fail('BUDGET_BOT_INVALID')
      if (usd === null || usd === undefined) fail('BUDGET_PRICE_UNKNOWN', '无法定价的调用不能通过预算校验。')
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) fail('BUDGET_PRICE_INVALID')
      const moment = at ?? now()
      const view = snapshot(botId, moment)
      if (view.dailyBudgetUsd !== null && view.spentToday + usd > view.dailyBudgetUsd) {
        return { allowed: false, reason: 'BOT_DAILY_BUDGET_EXHAUSTED', snapshot: view }
      }
      if (view.monthlyBudgetUsd !== null && view.spentThisMonth + usd > view.monthlyBudgetUsd) {
        return { allowed: false, reason: 'BOT_MONTHLY_BUDGET_EXHAUSTED', snapshot: view }
      }
      return { allowed: true, reason: null, snapshot: view }
    },

    /** Record spend that already happened; unknown prices are refused here too. */
    charge(botId, { usd, at } = {}) {
      if (typeof botId !== 'string' || botId === '') fail('BUDGET_BOT_INVALID')
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) fail('BUDGET_PRICE_INVALID')
      const moment = at ?? now()
      const book = bookOf(botId, moment)
      book.day.spent += usd
      book.month.spent += usd
      return snapshot(botId, moment)
    },
  })
}
