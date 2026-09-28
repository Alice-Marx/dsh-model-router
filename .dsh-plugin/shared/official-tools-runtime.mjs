/**
 * Host-side probe and install runtime for the official tool registry.
 *
 * The DeepSeek Harness plugin host runs as a full Node module, so probing and
 * installing official CLIs uses node:child_process directly. Every command is
 * built exclusively from the fixed registry: callers supply a tool id, never
 * a package name, executable or argument. Installs are serialized (npm global
 * state must not interleave), output is kept as a bounded tail, and success is
 * always confirmed by a fresh probe rather than the installer's exit code.
 */
import { spawn } from 'node:child_process'
import { getOfficialTool, installCommandLine, OFFICIAL_TOOLS } from './official-tool-registry.mjs'

const PROBE_TIMEOUT_MS = 8_000
const INSTALL_TIMEOUT_MS = 900_000
const OUTPUT_LINE_CAP = 120
const IS_WINDOWS = process.platform === 'win32'
const CREATE_NO_WINDOW = 0x0800_0000
/** Windows ships where.exe in System32; POSIX which is ubiquitous. */
const LOCATOR = IS_WINDOWS ? 'where' : 'which'
/** Cached probe results keep plan generation fast; installs invalidate them. */
const probeCache = new Map()
const PROBE_CACHE_MS = 60_000
const installJobs = new Map()
let installChain = Promise.resolve()

function runCapture(executable, args, { timeoutMs, onOutput, useShell = false, signal } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve({ ok: false, code: null, stdout: '', stderr: '', timedOut: false, cancelled: true })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let stopReason = null
    let child
    try {
      child = spawn(executable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // Windows npm CLIs install as .cmd shims; only cmd.exe can execute
        // them. Safe here because every executable and argument comes from
        // the fixed registry — caller input never reaches this boundary.
        shell: useShell,
      })
    } catch (error) {
      resolve({ ok: false, code: null, stdout: '', stderr: String(error?.message ?? error), timedOut: false, cancelled: false })
      return
    }
    let graceTimer
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(graceTimer)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const stop = reason => {
      if (settled || stopReason) return
      stopReason = reason
      if (IS_WINDOWS && useShell && Number.isInteger(child.pid)) {
        try {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
          killer.on('error', () => { try { child.kill('SIGTERM') } catch { /* already gone */ } })
          killer.on('close', code => { if (code !== 0) try { child.kill('SIGTERM') } catch { /* already gone */ } })
        } catch { try { child.kill('SIGTERM') } catch { /* already gone */ } }
      } else {
        try { child.kill('SIGTERM') } catch { /* already gone */ }
      }
      graceTimer = setTimeout(() => finish({ ok: false, code: null, stdout, stderr,
        timedOut: reason === 'timeout', cancelled: reason === 'cancel' }), 5_000)
      graceTimer.unref?.()
    }
    const onAbort = () => stop('cancel')
    const timer = setTimeout(() => stop('timeout'), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.stdout?.on('data', data => {
      if (settled || stopReason) return
      stdout = appendBounded(stdout, String(data))
      onOutput?.(String(data))
    })
    child.stderr?.on('data', data => {
      if (settled || stopReason) return
      stderr = appendBounded(stderr, String(data))
      onOutput?.(String(data))
    })
    child.on('error', error => {
      finish({ ok: false, code: null, stdout, stderr: `${stderr}${error.message}`.trim(),
        timedOut: stopReason === 'timeout', cancelled: stopReason === 'cancel' })
    })
    child.on('close', (code, signal) => {
      finish({ ok: !stopReason && code === 0, code, stdout, stderr,
        timedOut: stopReason === 'timeout', cancelled: stopReason === 'cancel', signal })
    })
  })
}

function appendBounded(current, addition) {
  const merged = current + addition
  return merged.length > 64_000 ? merged.slice(merged.length - 32_000) : merged
}

function compareStableVersions(left, right) {
  const parse = value => /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(String(value ?? ''))
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return null
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index])
    if (difference) return Math.sign(difference)
  }
  return 0
}

/** Extract the first version-looking token from a CLI banner. */
export function versionFromBanner(banner) {
  const match = String(banner ?? '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/)
  return match ? match[0] : null
}

/**
 * Probe one registry tool. `runner` is injectable for offline tests and must
 * return { ok, code, stdout, stderr, timedOut }.
 */
export async function probeToolWith(tool, runner, { cache = probeCache, cacheMs = PROBE_CACHE_MS, now = Date.now } = {}) {
  const cached = cache.get(tool.id)
  if (cached && now() - cached.at < cacheMs) return cached.value
  const probe = await probeUncached(tool, runner)
  cache.set(tool.id, { at: now(), value: probe })
  return probe
}

async function probeUncached(tool, runner) {
  if (tool.unsupported) {
    return { id: tool.id, installed: false, version: null, status: 'unsupported', detail: tool.unsupportedReason }
  }
  for (const executable of tool.probeExecutables) {
    // Existence check first: a missing command is indistinguishable from a
    // broken one by exit code alone once a shell is involved.
    const located = await runner(LOCATOR, [executable], { timeoutMs: PROBE_TIMEOUT_MS })
    if (located.timedOut) {
      return { id: tool.id, installed: false, version: null, status: 'probe-timeout', detail: `定位 ${executable} 超时（${PROBE_TIMEOUT_MS / 1000}s）` }
    }
    if (!located.ok || !located.stdout.trim()) {
      continue
    }
    const attempt = await runner(executable, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS })
    if (attempt.timedOut) {
      return { id: tool.id, installed: false, version: null, status: 'probe-timeout', detail: `${executable} --version 超时（${PROBE_TIMEOUT_MS / 1000}s）` }
    }
    if (attempt.ok) {
      const banner = `${attempt.stdout}\n${attempt.stderr}`.trim()
      return {
        id: tool.id,
        installed: true,
        version: versionFromBanner(banner),
        status: 'installed',
        detail: tool.probeNote ?? '',
        bannerLine: banner.split('\n').find(Boolean)?.slice(0, 200) ?? '',
      }
    }
    return {
      id: tool.id,
      installed: false,
      version: null,
      status: 'probe-failed',
      detail: `${executable} --version 退出码 ${attempt.code ?? '信号终止'}；程序可能损坏或版本过旧。${attempt.stderr.split('\n').find(Boolean)?.slice(0, 120) ?? ''}`,
    }
  }
  return { id: tool.id, installed: false, version: null, status: 'not-installed', detail: '未在 PATH 中找到官方命令。' }
}

/** Default runner: real spawn with the platform's shell for .cmd shims. */
export const defaultRunner = (executable, args, options = {}) =>
  runCapture(executable, args, { ...options, useShell: IS_WINDOWS })

let prefixPromise = null

/**
 * Users frequently move the npm global prefix off the default location (for
 * example to save C-drive space), so globally installed CLIs are missing from
 * PATH. Resolve the real prefix once and append it to this process's PATH so
 * probes and installs see the user's actual tools. Best effort: any failure
 * leaves the environment untouched.
 */
export function ensureNpmPrefixOnPath() {
  if (prefixPromise === null) {
    prefixPromise = (async () => {
      try {
        const outcome = await runCapture('npm', ['config', 'get', 'prefix'], {
          timeoutMs: 5_000,
          useShell: IS_WINDOWS,
        })
        if (!outcome.ok) return
        let prefix = outcome.stdout.trim()
        if (!prefix) return
        if (prefix.startsWith('\\\\?\\')) prefix = prefix.slice(4)
        const current = process.env.PATH ?? ''
        if (current.split(IS_WINDOWS ? ';' : ':').includes(prefix)) return
        process.env.PATH = current ? `${current}${IS_WINDOWS ? ';' : ':'}${prefix}` : prefix
      } catch { /* environment stays untouched */ }
    })()
  }
  return prefixPromise
}

/** Probe every registry tool and return the ids whose CLI is installed. */
export async function installedToolIds() {
  await ensureNpmPrefixOnPath()
  const probes = await probeAllTools()
  return probes.filter(probe => probe.installed).map(probe => probe.id)
}

/**
 * Probe every registry tool in parallel (the slowest single probe bounds the
 * wall time; the cache keeps repeat calls instant).
 */
export async function probeAllTools() {
  await ensureNpmPrefixOnPath()
  return Promise.all(OFFICIAL_TOOLS.map(tool => probeToolWith(tool, defaultRunner)))
}

export function probeSnapshot() {
  return [...probeCache.values()].map(entry => entry.value)
}

function jobView(job) {
  if (!job) return null
  return {
    tool: job.tool.id,
    command: job.command,
    status: job.status,
    phase: job.phase,
    cancelRequested: job.cancelRequested,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    timedOut: job.timedOut,
    error: job.error,
    outputTail: [...job.outputTail],
    outputTruncated: job.outputTruncated,
    postInstallProbe: job.postInstallProbe,
  }
}

function pushLine(job, line) {
  if (job.outputTail.length >= OUTPUT_LINE_CAP) {
    job.outputTail.shift()
    job.outputTruncated = true
  }
  job.outputTail.push(line)
}

/**
 * Start the fixed install for one registry tool id. Returns the job snapshot
 * synchronously; poll installStatus until status is succeeded/failed.
 */
export function startInstall(toolId) {
  const tool = getOfficialTool(toolId)
  if (!tool) throw new Error(`未知工具：${toolId}。只允许安装注册表中的官方工具。`)
  if (tool.unsupported) throw new Error(tool.unsupportedReason)
  const existing = installJobs.get(tool.id)
  if (existing?.status === 'running') throw new Error(`${tool.label} 已有安装任务正在执行。`)
  const command = installCommandLine(tool)
  if (!command) throw new Error(tool.unsupportedReason)
  // With shell mode on Windows the bare name resolves npm.cmd/uv.exe.
  const manager = tool.manager === 'npm' ? 'npm' : 'uv'
  const job = {
    tool,
    command,
    status: 'running',
    phase: 'queued',
    cancelRequested: false,
    controller: new AbortController(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    timedOut: false,
    error: null,
    outputTail: [`$ ${command}`],
    outputTruncated: false,
    postInstallProbe: null,
  }
  installJobs.set(tool.id, job)
  probeCache.delete(tool.id)
  installChain = installChain.then(() => runInstallJob(manager, tool.installArgs, job)).catch(error => {
    if (job.status === 'cancelled') return
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.error = `安装流程失败：${String(error?.message ?? error).slice(0, 200)}`
  })
  return jobView(job)
}

async function runInstallJob(manager, args, job) {
  if (job.status !== 'running') return
  job.phase = 'preflight'
  await ensureNpmPrefixOnPath()
  if (job.cancelRequested) { markCancelled(job); return }
  probeCache.delete(job.tool.id)
  const before = await probeToolWith(job.tool, defaultRunner)
  if (job.cancelRequested) { markCancelled(job); return }
  if (before.installed && job.tool.version) {
    const order = compareStableVersions(before.version, job.tool.version)
    if (order === null || order > 0) {
      job.status = 'failed'
      job.finishedAt = new Date().toISOString()
      job.postInstallProbe = before
      job.error = `已安装 ${before.version ?? '未知版本'}，无法证明升级到 ${job.tool.version} 不会降级；请先人工核对。`
      return
    }
    if (order === 0) {
      job.status = 'succeeded'
      job.finishedAt = new Date().toISOString()
      job.postInstallProbe = before
      pushLine(job, `— ${job.tool.label} ${before.version} 已安装，无需重复安装 —`)
      return
    }
  }
  job.phase = 'installing'
  const outcome = await runCapture(manager, args, {
    timeoutMs: INSTALL_TIMEOUT_MS,
    useShell: IS_WINDOWS,
    signal: job.controller.signal,
    onOutput: chunk => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) pushLine(job, line.slice(0, 500))
      }
    },
  })
  if (job.status !== 'running') return
  if (outcome.cancelled || job.cancelRequested) { markCancelled(job); return }
  job.finishedAt = new Date().toISOString()
  job.exitCode = outcome.code
  job.timedOut = outcome.timedOut
  if (outcome.timedOut) {
    job.status = 'failed'
    job.error = `安装超时（${INSTALL_TIMEOUT_MS / 1000}s），已终止。`
  } else if (outcome.ok) {
    job.phase = 'verifying'
    await ensureNpmPrefixOnPath()
    probeCache.delete(job.tool.id)
    const probe = await probeToolWith(job.tool, defaultRunner)
    if (job.cancelRequested) { markCancelled(job); return }
    job.postInstallProbe = probe
    if (!probe.installed || (job.tool.version && probe.version !== job.tool.version)) {
      job.status = 'failed'
      job.error = probe.installed
        ? `安装命令已完成，但 PATH 上读到 ${probe.version ?? '未知版本'}；预期 ${job.tool.version}。请检查重复安装。`
        : `安装命令已完成，但重探测失败：${probe.detail}`
    } else {
      job.status = 'succeeded'
      pushLine(job, '— 安装并重探测完成 —')
    }
  } else {
    job.status = 'failed'
    job.error = `安装命令失败（退出码 ${outcome.code ?? '信号终止'}）。${outcome.stderr.split('\n').find(Boolean)?.slice(0, 200) ?? ''}`
  }
}

function markCancelled(job) {
  job.status = 'cancelled'
  job.phase = 'done'
  job.finishedAt = new Date().toISOString()
  job.error = '已取消安装。若 npm 已开始写入，可能需要重新检测或修复该工具。'
  probeCache.delete(job.tool.id)
  pushLine(job, '— 安装已取消；请重新检测实际状态 —')
}

/** Cancel a queued or running install; cancellation is reflected after its process exits. */
export function cancelInstall(toolId) {
  const tool = getOfficialTool(toolId)
  if (!tool) throw new Error(`未知工具：${toolId}。`)
  const job = installJobs.get(tool.id)
  if (!job || job.status !== 'running') throw new Error(`${tool.label} 当前没有进行中的安装任务。`)
  if (!job.cancelRequested) {
    job.cancelRequested = true
    job.controller.abort()
    if (job.phase === 'queued') markCancelled(job)
  }
  return jobView(job)
}

export function installStatus(toolId) {
  const job = installJobs.get(String(toolId ?? '').trim())
  return job ? jobView(job) : null
}

/** Plan-side projection: whether each provider can run through an installed CLI. */
export async function executionChannels(providers) {
  const unique = [...new Set(providers.filter(Boolean))]
  await Promise.all(unique.map(provider => {
    const tool = OFFICIAL_TOOLS.find(entry => !entry.unsupported
      && entry.providerHints.some(hint => provider.toLowerCase().includes(hint)))
    return tool ? probeToolWith(tool, defaultRunner) : Promise.resolve(null)
  }))
  const resolved = new Map()
  for (const provider of unique) {
    const tool = OFFICIAL_TOOLS.find(entry => !entry.unsupported
      && entry.providerHints.some(hint => provider.toLowerCase().includes(hint)))
    if (!tool) {
      resolved.set(provider, { kind: 'harness-llm', detail: '通过官方模型目录 API 调用。' })
      continue
    }
    const probe = await probeToolWith(tool, defaultRunner)
    resolved.set(provider, probe.installed
      ? { kind: 'harness-llm', tool: tool.id, label: tool.label, version: probe.version, detail: 'CLI 已安装；执行入口仍须单独核验，当前使用官方模型目录 API。' }
      : { kind: 'harness-llm', tool: tool.id, label: tool.label, detail: `${tool.label} 未安装；将使用官方模型目录 API 调用。可在会话中运行 /tools install ${tool.id} 安装。` })
  }
  return resolved
}

/** Test-only: drop caches and jobs. */
export function resetForTests() {
  probeCache.clear()
  installJobs.clear()
  installChain = Promise.resolve()
}
