/**
 * The official tools as Bot "engines": one public row per registry tool for the Bot binding
 * picker. It joins three Host facts and nothing else: the cached health report (installed,
 * version, login state), the execution capability table (whether the Host can run the tool
 * headless, and in which modes) and the registry itself (label, vendor, provider hints).
 *
 * A row never carries a path, a credential, an environment value or a command the Bot could
 * choose: the login command is the fixed display text from LOGIN_GUIDES.
 */
import { OFFICIAL_TOOLS } from './official-tool-registry.mjs'

const LOGIN_STATES = new Set(['logged-in', 'logged-out', 'unknown'])
const short = (value, limit = 200) => (typeof value === 'string' ? value.slice(0, limit) : '')

/** Stable display order: tools that can run managed first, then by registry order. */
const order = rows => rows
  .map((row, index) => ({ row, index }))
  .sort((a, b) => Number(b.row.execution.supported) - Number(a.row.execution.supported) || a.index - b.index)
  .map(item => item.row)

/**
 * @param {{ report?: { checkedAt?: number, tools?: object[] } | null, capabilities?: object[], tools?: readonly object[], now?: number, ttlMs?: number }} input
 */
export function projectOfficialEngines({ report = null, capabilities = [], tools = OFFICIAL_TOOLS, now = Date.now(), ttlMs = 10 * 60_000 } = {}) {
  const health = new Map((Array.isArray(report?.tools) ? report.tools : []).map(item => [item?.id, item]))
  const capability = new Map((Array.isArray(capabilities) ? capabilities : []).map(item => [item?.id, item]))
  const checkedAt = Number.isFinite(report?.checkedAt) ? report.checkedAt : null
  const rows = tools.map(tool => {
    const entry = health.get(tool.id) ?? null
    const can = capability.get(tool.id) ?? null
    const loginState = LOGIN_STATES.has(entry?.login?.state) ? entry.login.state : 'unknown'
    const installed = entry?.installed === true
    const modes = Array.isArray(can?.modes) ? can.modes.filter(mode => mode === 'read-only' || mode === 'workspace-write') : []
    const status = !entry ? 'unchecked' : !installed ? 'needs-install' : loginState === 'logged-out' ? 'needs-login' : 'ready'
    return {
      id: tool.id,
      label: tool.label,
      vendor: tool.vendor ?? '',
      providerHints: Array.isArray(tool.providerHints) ? [...tool.providerHints] : [],
      status,
      installed,
      version: installed && typeof entry?.version === 'string' ? entry.version : null,
      latestVersion: typeof entry?.latestVersion === 'string' ? entry.latestVersion : null,
      updateAvailable: entry?.updateAvailable === true,
      login: {
        state: loginState,
        billing: entry?.login?.billing === 'subscription' || entry?.login?.billing === 'api-key' ? entry.login.billing : null,
        command: short(entry?.login?.command, 120),
        detail: short(entry?.login?.detail),
      },
      execution: can?.supported === true
        ? { supported: true, modes }
        : { supported: false, modes: [], reason: short(can?.reason) || '宿主尚未为此工具核验托管执行入口。' },
    }
  })
  return {
    status: 'available',
    checkedAt,
    stale: checkedAt === null || now - checkedAt >= ttlMs,
    items: order(rows),
  }
}
