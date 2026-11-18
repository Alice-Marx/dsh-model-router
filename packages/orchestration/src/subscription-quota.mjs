import { getOfficialTool } from '../../../.dsh-plugin/shared/official-tool-registry.mjs'

function quotaWindow(id, limit, count, resetAt, complete) {
  const used = Number.isSafeInteger(count) && count >= 0 ? count : null
  return { id, limit, used, resetAt, remaining: complete && used !== null ? Math.max(0, limit - used) : null }
}

function observedChannelLimits(quota, at) {
  return Object.entries(quota ?? {}).flatMap(([id, entry]) => {
    const match = /^(cli|plan):([^\u0000-\u001f\u007f]{1,128})$/u.exec(id)
    if (!match || !['quota', 'rate-limit'].includes(entry?.kind)
      || !Number.isSafeInteger(entry.until) || entry.until <= at) return []
    const [, kind, channel] = match
    return [{ id, label: kind === 'cli' ? getOfficialTool(channel)?.label ?? channel : channel,
      kind: entry.kind, until: entry.until, resetReported: entry.resetReported === true }]
  }).sort((a, b) => a.until - b.until || a.label.localeCompare(b.label))
}

/** Use the same per-Bot counts and local calendar as subscription admission. */
export function projectSubscriptionQuota({ ledger, plans, usageFor, accountQuotas = [], at }) {
  const day = new Date(at)
  const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const nextMonth = new Date(day.getFullYear(), day.getMonth() + 1, 1).getTime()
  const complete = !ledger.historyIncomplete && !ledger.subscriptionUsageIncomplete
  const bots = plans.map(({ botId, name, dailyCalls, monthlyCalls }) => {
    const usage = usageFor({ botId, at })
    const windows = [
      quotaWindow('day', dailyCalls, usage.today.calls, nextDay, complete),
      quotaWindow('month', monthlyCalls, usage.month.calls, nextMonth, complete),
    ]
    return { id: botId, name, windows }
  })
  return {
    observedAt: at, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    bots, historyIncomplete: !complete, accountQuotas, channelLimits: observedChannelLimits(ledger.quota, at),
  }
}
