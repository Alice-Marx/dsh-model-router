import { compareReleaseVersions } from '../shared/version-order.mjs'
import { DEFAULT_NPM_REGISTRY, OFFICIAL_TOOLS } from '../shared/official-tool-registry.mjs'
import { parseInstallPreferences } from '../shared/tool-install-preferences.mjs'

const INSTALL_DEFAULTS = Object.freeze({
  toolInstallDir: '',
  toolNpmRegistry: DEFAULT_NPM_REGISTRY,
  toolScriptUrlsJson: '{}',
  toolAllowScriptInstall: true,
  zcodeInstallDir: '',
})

/** Compare the settings a command preview describes, independent of JSON order. */
export function toolInstallSettingsSignature(value = {}) {
  try {
    const preferences = parseInstallPreferences({ ...value, toolInstallDir: '', zcodeInstallDir: '' }, { tools: OFFICIAL_TOOLS })
    const sorted = map => Object.entries(map).sort(([left], [right]) => left.localeCompare(right))
    return JSON.stringify([String(value.toolInstallDir ?? '').trim(), preferences.registry, sorted(preferences.methods),
      sorted(preferences.scriptUrls), preferences.allowScriptInstall, String(value.zcodeInstallDir ?? '').trim()])
  } catch { return JSON.stringify(['invalid', value.toolInstallDir, value.toolNpmRegistry,
    value.toolInstallMethodsJson, value.toolScriptUrlsJson, value.toolAllowScriptInstall, value.zcodeInstallDir]) }
}

export function installSummaryMatchesSettings(summary, value) {
  if (!summary) return false
  return toolInstallSettingsSignature(value) === toolInstallSettingsSignature({
    toolInstallDir: summary.requestedInstallDir ?? summary.installDir ?? '', toolNpmRegistry: summary.registry || DEFAULT_NPM_REGISTRY,
    toolInstallMethodsJson: JSON.stringify(summary.methods ?? {}),
    toolScriptUrlsJson: JSON.stringify(summary.scriptUrls ?? {}),
    toolAllowScriptInstall: summary.allowScriptInstall !== false,
    zcodeInstallDir: summary.requestedZCodeInstallDir ?? summary.zcodeInstallDir ?? '',
  })
}

export function savedToolInstallMethods(value = {}) {
  try { return parseInstallPreferences({ toolInstallMethodsJson: value.toolInstallMethodsJson }, { tools: OFFICIAL_TOOLS }).methods }
  catch { return {} }
}

/** Bound a broken settings transport without treating a late answer as a new save. */
export async function mutateToolInstallSettings(scope, operations, revision, { timeoutMs = 15_000, onSettled } = {}) {
  let timer
  try {
    const writing = Promise.resolve().then(() => scope.mutate(operations, revision)).then(accepted => {
      onSettled?.({ accepted })
      return accepted
    }, error => {
      onSettled?.({ accepted: false, error })
      throw error
    })
    return await Promise.race([
      writing,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('安装设置保存未收到确认，请在连接恢复后重试；迟到结果会按实际已保存设置显示。')), timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}

/** Validate drafts with the same boundary used by the Host installer. */
export function validateToolInstallSetting(key, value) {
  try {
    parseInstallPreferences({ [key]: value }, { tools: OFFICIAL_TOOLS })
    return ''
  } catch (error) {
    return error?.message || '安装设置无效。'
  }
}

/** An unrelated config update must not erase another field the user is typing. */
export function retainToolInstallDrafts(drafts, values = {}) {
  return Object.fromEntries(Object.entries(drafts).filter(([key, value]) =>
    value !== (values[key] ?? INSTALL_DEFAULTS[key])))
}

/**
 * Install-button state. Versions are not pinned: the button installs the
 * vendor's latest release. `latestVersion` comes from the cheap latest-version
 * lookup and may be null (offline); then the button still offers the latest.
 *
 * `refreshing` keeps the previous probe, so the update button stays usable.
 * The first load (`loading`, no probe yet) stays disabled.
 */
export function toolInstallAction({ tool, probe, readiness, job, probeStatus, latestVersion = null }) {
  const running = job?.status === 'running'
  const installed = probe?.installed === true
  const order = installed && latestVersion ? compareReleaseVersions(probe.version, latestVersion) : null
  const desktop = tool.manager === 'signed-windows-installer'
  if (desktop) return {
    label: running ? '桌面安装处理中…' : installed ? '检查并更新桌面版' : job?.status === 'failed' ? '重试桌面安装' : '安装 ZCode 桌面版',
    disabled: !(probeStatus === 'ready' || probeStatus === 'refreshing') || running,
  }
  const noRunner = desktop || tool.headlessAdapter === true
  // A CLI that is already the latest release stays on “已是最新版本”.
  // A missing hosted entry is explained on the row; it must not turn the card
  // into a reinstall that runs against every other tool's shared npm path.
  const repair = installed && !noRunner && readiness?.ready === false && order !== 0
  const label = running ? '安装中…'
    : !installed ? job?.status === 'failed' ? '重试安装' : desktop ? '下载最新安装器' : '一键安装最新版'
      : order === -1 ? `更新到最新版 ${latestVersion}`
        : order === 1 ? '已高于最新正式版'
          : repair ? '修复官方执行入口'
            : order === 0 ? '已是最新版本'
              : '安装最新版'
  const current = order === 0
  const interactive = probeStatus === 'ready' || probeStatus === 'refreshing'
  return {
    label,
    disabled: !interactive || running || (installed && (order === 1 || current)),
  }
}

/**
 * Repair and uninstall are separate destructive-ish actions, so they get their
 * own labels and gates: repair is offered whenever a copy exists, uninstall
 * only once one is actually installed. Both wait for the probe to settle, and
 * neither is offered for the interactive signed desktop installer.
 */
export function toolMaintenanceActions({ tool, probe, job, probeStatus, summary }) {
  const running = job?.status === 'running'
  const installed = probe?.installed === true
  const interactive = probeStatus === 'ready' || probeStatus === 'refreshing'
  const desktop = tool.manager === 'signed-windows-installer'
  const busy = running || !interactive
  return {
    repair: {
      label: desktop ? '重新安装桌面版' : '一键修复',
      title: desktop ? '打开已核验的官方桌面安装器；完成安装后重新体检，刷新内置 TUI' : '用同一条固定官方安装命令重新安装一遍，修复损坏或不完整的安装',
      disabled: busy || summary?.installable === false,
    },
    uninstall: {
      label: '一键卸载',
      title: '只删除程序本身；配置、登录信息和历史记录保留',
      disabled: busy || desktop || !installed || summary?.removable === false,
    },
  }
}

/** Non-empty when a click must not start another install. The caller shows this text. */
export function installClickRefusal({ tool, submitting = false, running = false, operation = 'install', pendingSettings = false, installError = '' } = {}) {
  if (!tool) return '未知官方工具，无法开始安装。'
  if (tool.unsupported) return String(tool.unsupportedReason ?? '').trim() || '此工具暂不支持一键安装。'
  if (tool.manager === 'signed-windows-installer' && operation === 'uninstall') {
    return `${tool.label} 由官方签名桌面安装器安装，请在系统“应用”中卸载它。`
  }
  if (submitting || running) {
    return operation === 'uninstall' ? '该工具正在卸载，请等待当前任务结束。'
      : operation === 'repair' ? '该工具正在修复，请等待当前任务结束。'
        : '该工具正在安装，请等待当前任务结束。'
  }
  if (pendingSettings) return '请先保存或放弃安装设置更改，并等待安装命令刷新。'
  if (installError) return installError
  return ''
}

function payloadError(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim()
  const message = payload.error?.message
  if (typeof message === 'string' && message.trim()) return message.trim()
  return fallback
}

/**
 * Accept either the gateway envelope `{ ok, value }` or one extra settled
 * envelope around `{ accepted, job }`. A refusal returns the error string.
 */
export function acceptedInstallJob(response) {
  const fallback = '安装任务未被接受。'
  if (!response || typeof response !== 'object') return { job: null, error: fallback }
  let payload = response
  if (payload.ok === false) return { job: null, error: payloadError(payload, fallback) }
  if (payload.ok === true && payload.value && typeof payload.value === 'object') {
    payload = payload.value
    if (payload.ok === false) return { job: null, error: payloadError(payload, fallback) }
    if (payload.ok === true && payload.value && typeof payload.value === 'object') payload = payload.value
  }
  if (payload.accepted === true && payload.job && typeof payload.job === 'object') return { job: payload.job, error: '' }
  return { job: null, error: payloadError(payload, fallback) }
}

/**
 * A status poll must not replace the click that just started.
 * Ignore a remote job whose startedAt is strictly older; accept a missing
 * timestamp or a job that started at the same time or later.
 */
export function shouldApplyInstallStatus(localJob, remoteJob) {
  if (!remoteJob || typeof remoteJob !== 'object') return false
  const localStarted = typeof localJob?.startedAt === 'string' ? localJob.startedAt : ''
  const remoteStarted = typeof remoteJob.startedAt === 'string' ? remoteJob.startedAt : ''
  if (!localStarted || !remoteStarted) return true
  return remoteStarted >= localStarted
}
