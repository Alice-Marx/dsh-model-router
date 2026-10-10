import { compareReleaseVersions } from '../shared/version-order.mjs'

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
      label: '一键修复',
      title: '用同一条固定官方安装命令重新安装一遍，修复损坏或不完整的安装',
      disabled: busy || desktop || summary?.installable === false,
    },
    uninstall: {
      label: '一键卸载',
      title: '只删除程序本身；配置、登录信息和历史记录保留',
      disabled: busy || desktop || !installed || summary?.removable === false,
    },
  }
}

/** Non-empty when a click must not start another install. The caller shows this text. */
export function installClickRefusal({ tool, submitting = false, running = false, operation = 'install' } = {}) {
  if (!tool) return '未知官方工具，无法开始安装。'
  if (tool.unsupported) return String(tool.unsupportedReason ?? '').trim() || '此工具暂不支持一键安装。'
  if (tool.manager === 'signed-windows-installer' && operation !== 'install') {
    return `${tool.label} 由官方签名桌面安装器安装，请在系统“应用”中卸载它。`
  }
  if (submitting || running) {
    return operation === 'uninstall' ? '该工具正在卸载，请等待当前任务结束。'
      : operation === 'repair' ? '该工具正在修复，请等待当前任务结束。'
        : '该工具正在安装，请等待当前任务结束。'
  }
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
