/** Compare plain x.y.z versions; null when either is not one. */
function stableVersionOrder(left, right) {
  const parse = value => /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(String(value ?? ''))
  const current = parse(left)
  const target = parse(right)
  if (!current || !target) return null
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(current[index]) - Number(target[index])
    if (delta) return Math.sign(delta)
  }
  return 0
}

/**
 * Install-button state. Versions are not pinned: the button installs the
 * vendor's latest release. `latestVersion` comes from the cheap latest-version
 * lookup and may be null (offline); then the button still offers the latest.
 */
export function toolInstallAction({ tool, probe, readiness, job, probeStatus, latestVersion = null }) {
  const running = job?.status === 'running'
  const installed = probe?.installed === true
  const order = installed && latestVersion ? stableVersionOrder(probe.version, latestVersion) : null
  const ready = readiness?.ready === true
  const desktop = tool.manager === 'signed-windows-installer'
  const noRunner = desktop || tool.headlessAdapter === true
  const repair = installed && !noRunner && readiness?.ready === false
  const label = running ? '安装中…'
    : !installed ? job?.status === 'failed' ? '重试安装' : desktop ? '下载最新安装器' : '一键安装最新版'
      : order === -1 ? `更新到最新版 ${latestVersion}`
        : order === 1 ? '已高于最新正式版'
          : repair ? '修复官方执行入口'
            : order === 0 ? '已是最新版本'
              : '安装最新版'
  const current = order === 0 && (ready || noRunner)
  return {
    label,
    disabled: probeStatus !== 'ready' || running || (installed && (order === 1 || current)),
  }
}
