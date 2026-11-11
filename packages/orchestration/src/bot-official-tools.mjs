import { OFFICIAL_TOOLS } from '../../../.dsh-plugin/shared/official-tool-registry.mjs'

/** A stored choice, never a vendor model name or a --model argument. */
export const BOT_CLI_DEFAULT_MODEL = 'vendor-default'
export const BOT_OFFICIAL_TOOLS_TTL_MS = 2 * 60_000
export const BOT_OFFICIAL_TOOLS_TIMEOUT_MS = 12_000
export const BOT_OFFICIAL_TOOL_STATUSES = Object.freeze([
  'checking', 'not-installed', 'logged-out', 'login-unknown', 'terminal-only', 'unavailable', 'ready',
])

const modes = new Set(['read-only', 'workspace-write', 'cli-native'])
const legacyGrantTools = new Set(['cli/codex', 'cli/cancel', 'cli/read', 'cli/retry'])
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/.test(value)
const sourceOf = tool => ['opencode', 'pi', 'hermes'].includes(tool.id) ? '开源第三方工具' : tool.id === 'zcode' ? '社区发行版' : '厂商官方 CLI'
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.tools) ? value.tools : []
const copy = value => structuredClone(value)

/**
 * Project only non-secret facts from Host probes. A ready executable is not a
 * verified model identity: vendor-default explicitly follows the CLI's own
 * configuration, independently of the Bot's chat route. No probe launch data,
 * credential hints, environment, or raw diagnostics cross this boundary.
 */
export function buildBotOfficialToolsCatalog({ health = null, capabilities = [], readiness = [], legacyModels = [], legacyTools = [], status = null } = {}) {
  const installed = new Map(rows(health).map(item => [item.id, item]))
  const supported = new Map(rows(capabilities).map(item => [item.id, item]))
  const checked = new Map(rows(readiness).map(item => [item.id, item]))
  return OFFICIAL_TOOLS.map(tool => {
    const probe = installed.get(tool.id), capability = supported.get(tool.id), entry = checked.get(tool.id)
    const loginState = ['logged-in', 'logged-out'].includes(probe?.login?.state) ? probe.login.state : 'unknown'
    const result = { toolId: tool.id, label: tool.label, vendor: tool.vendor, source: sourceOf(tool),
      installed: probe?.installed === true, loginState, status: 'checking', reason: '正在检测安装、账号状态与执行入口。',
      modes: [], grantTools: [], identities: [] }
    if (status === 'checking' || !probe) return result
    if (status === 'unavailable') return { ...result, status, reason: '官方工具检测失败，请重新检测后再授权。' }
    if (!result.installed) return { ...result, status: 'not-installed', reason: 'CLI 尚未安装或版本检测失败，请先安装或修复。' }
    if (capability?.supported === false || entry?.supported === false) {
      return { ...result, status: 'terminal-only', reason: '仅终端交互：此工具当前没有可用的 Bot 托管执行入口。' }
    }
    if (loginState === 'logged-out') return { ...result, status: 'logged-out', reason: 'CLI 尚未登录，请完成登录后重新检测。' }
    if (loginState !== 'logged-in') return { ...result, status: 'login-unknown', reason: '尚无法确认 CLI 的账号状态，请登录并重新检测；仍未知时可在终端交互使用。' }
    const readyModes = capability?.supported === true && entry?.ready === true
      ? [...new Set((entry.readyModes ?? entry.modes ?? []).filter(mode => modes.has(mode) && capability.modes?.includes(mode)))] : []
    if (!readyModes.length) return { ...result, status: 'unavailable', reason: '执行入口尚未通过核验，请在“安装与登录”页面查看诊断并修复。' }
    const exact = rows(legacyModels).filter(item => (item.toolId ?? 'codex') === tool.id && token(item.cliModel ?? item.model))
      .map(item => ({ model: item.cliModel ?? item.model, label: item.cliModel ?? item.model }))
      .filter(item => item.model !== BOT_CLI_DEFAULT_MODEL)
    const unique = new Map(exact.map(item => [item.model, item]))
    const old = rows(legacyTools).find(item => item.toolId === tool.id)
    return { ...result, status: 'ready', reason: '已检测安装、账号状态与可用执行入口；可为此 Bot 配置。', modes: readyModes,
      grantTools: ['tool/model_router_tool_run', 'tool/model_router_tools', ...(tool.id === 'codex' ? old?.grantTools ?? [] : []).filter(name => legacyGrantTools.has(name))],
      identities: [{ model: BOT_CLI_DEFAULT_MODEL, label: '厂商默认模型（由 CLI 配置决定）' }, ...unique.values()] }
  })
}

/**
 * Async Host probes feed a synchronous fail-closed catalog for settings commits.
 * Call refresh before binding.inspect and runtime admission; snapshot never
 * returns expired grants, and invalidate prevents an old in-flight refresh
 * from reintroducing a revoked installation/account selection.
 */
export function createBotOfficialToolsCatalog({ probeHealth, probeCapabilities, probeReadiness, legacyModels = [], legacyTools = [],
  now = Date.now, ttlMs = BOT_OFFICIAL_TOOLS_TTL_MS, timeoutMs = BOT_OFFICIAL_TOOLS_TIMEOUT_MS, onChanged = () => {} } = {}) {
  for (const [name, fn] of Object.entries({ probeHealth, probeCapabilities, probeReadiness, now, onChanged })) {
    if (typeof fn !== 'function') throw new TypeError(`${name} must be a function`)
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be positive')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive')
  const legacy = { legacyModels, legacyTools }
  let value = buildBotOfficialToolsCatalog(), checkedAt = null, pending = null, epoch = 0
  const current = () => checkedAt !== null && now() >= checkedAt && now() - checkedAt < ttlMs
  const snapshot = () => copy(current() ? value : buildBotOfficialToolsCatalog())
  return Object.freeze({
    snapshot,
    invalidate() { epoch++; checkedAt = null; value = buildBotOfficialToolsCatalog(); const previous = pending; pending = null; previous?.controller.abort(new Error('OFFICIAL_DETECTION_INVALIDATED')) },
    refresh({ fresh = false } = {}) {
      if (pending) return pending.promise
      if (!fresh && current()) return Promise.resolve(snapshot())
      const generation = epoch
      const wasCurrent = current()
      const controller = new AbortController(), run = { controller, promise: null }
      let abort
      const stopped = new Promise((_resolve, reject) => {
        abort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', abort, { once: true })
      })
      const timer = setTimeout(() => controller.abort(Object.assign(new Error('OFFICIAL_DETECTION_TIMEOUT'), { code: 'OFFICIAL_DETECTION_TIMEOUT' })), timeoutMs)
      const unavailable = error => buildBotOfficialToolsCatalog({ health: { tools: OFFICIAL_TOOLS.map(tool => ({ id: tool.id })) }, status: 'unavailable' })
        .map(tool => error?.code === 'OFFICIAL_DETECTION_TIMEOUT' ? { ...tool, reason: '官方工具检测超时，请重新检测；模型与聊天设置仍可使用。' } : tool)
      run.promise = (async () => {
        let next
        try {
          next = await Promise.race([stopped, (async () => {
            const [health, capabilities] = await Promise.all([
              probeHealth({ fresh, signal: controller.signal }),
              probeCapabilities({ signal: controller.signal }),
            ])
            controller.signal.throwIfAborted()
            const readiness = await Promise.all(rows(health).filter(item => item.installed === true)
              .map(async item => {
                try { return { ...(await probeReadiness(item.id, { signal: controller.signal })), id: item.id } }
                catch { return { id: item.id, ready: false, readyModes: [] } }
              }))
            controller.signal.throwIfAborted()
            return buildBotOfficialToolsCatalog({ health, capabilities, readiness, ...legacy })
          })()])
        } catch (error) { next = unavailable(error) }
        if (generation !== epoch) return snapshot()
        const changed = !wasCurrent || JSON.stringify(next) !== JSON.stringify(value)
        value = next; checkedAt = now()
        if (changed) {
          try {
            // A timed-out probe still publishes the closed catalog, without
            // allowing a hung notification to retain the shared pending slot.
            const notification = Promise.resolve().then(() => onChanged(snapshot()))
            await Promise.race([notification, stopped])
          }
          catch (error) {
            value = unavailable(error)
            checkedAt = now()
            if (error?.code !== 'OFFICIAL_DETECTION_TIMEOUT') throw error
          }
        }
        return snapshot()
      })().finally(() => {
        clearTimeout(timer); controller.signal.removeEventListener('abort', abort)
        if (pending === run) pending = null
      })
      pending = run
      return run.promise
    },
  })
}
