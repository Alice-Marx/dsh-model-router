/** A version banner alone does not establish a trusted executable entry. */
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

export function toolInstallAction({ tool, probe, readiness, job, probeStatus }) {
  const running = job?.status === 'running'
  const versionOrder = probe?.installed ? stableVersionOrder(probe.version, tool.version) : null
  const currentAndReady = versionOrder === 0 && readiness?.ready === true
  const repairable = versionOrder === 0 && readiness?.ready === false
  const newerOrUncertain = probe?.installed && (versionOrder === null || versionOrder > 0)
  const label = running ? '安装中…'
    : currentAndReady ? '已是目标版本'
      : repairable ? '修复官方执行入口'
        : newerOrUncertain ? '请人工核对版本'
          : probe?.installed ? '更新到目标版本'
            : job?.status === 'failed' ? '重试安装'
              : tool.manager === 'signed-windows-installer' ? '下载安装器' : '下载安装'
  return {
    label,
    disabled: probeStatus !== 'ready' || running || currentAndReady || newerOrUncertain,
  }
}
