/**
 * Host-side probe and install runtime for the official tool registry.
 *
 * The DeepSeek Harness plugin host runs as a full Node module, so probing and
 * installing official CLIs uses node:child_process directly. Every command is
 * built exclusively from the fixed registry: callers supply a tool id, never
 * a package name, executable or argument. Installs are serialized (npm global
 * state must not interleave), output is kept as a bounded tail, and success is
 * always confirmed by a fresh probe rather than the installer's exit code.
 * When a newer release is known, a probe that is still older fails the job
 * instead of reporting success.
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { getOfficialTool, installCommandLine, OFFICIAL_TOOLS } from './official-tool-registry.mjs'
import { discoverZCodeBundle, unverifiedZCodeInstalls } from './zcode-bundle.mjs'
import { openZCodeInstaller } from './zcode-installer.mjs'
import { compareReleaseVersions, latestVersions } from './latest-versions.mjs'
import { versionStillOlder } from './version-order.mjs'

const PROBE_TIMEOUT_MS = 8_000
const INSTALL_TIMEOUT_MS = 900_000
const OUTPUT_LINE_CAP = 120
const IS_WINDOWS = process.platform === 'win32'
const CREATE_NO_WINDOW = 0x0800_0000
const MINIMAX_INSTALLER_URL = 'https://filecdn.minimax.chat/public/install.ps1'
const MAX_INSTALLER_BYTES = 200_000
/** Windows ships where.exe in System32; POSIX which is ubiquitous. */
const LOCATOR = IS_WINDOWS ? 'where' : 'which'
/** Cached probe results keep plan generation fast; installs invalidate them. */
const probeCache = new Map()
const PROBE_CACHE_MS = 60_000
const installJobs = new Map()
let installChain = Promise.resolve()
const CLAUDE_UPDATE_TIMEOUT_MS = 180_000

/** Non-interactive updater for a native Claude Code install. npm does not move that copy. */
export const CLAUDE_UPDATE_ARGS = Object.freeze(['update'])

/**
 * Quote a fixed registry command for `shell: true`.
 * Node concatenates shell arguments without escaping; Windows cmd would otherwise
 * split on characters inside package specs such as `@scope/pkg@latest`.
 */
export function shellCommandLine(executable, args, platform = process.platform) {
  const quote = value => {
    const text = String(value)
    if (text.includes('\0') || /[\r\n]/.test(text)) throw new Error('命令参数含有非法字符。')
    if (platform === 'win32') return `"${text.replace(/"/g, '""')}"`
    return `'${text.replace(/'/g, `'"'"'`)}'`
  }
  return [executable, ...(args ?? [])].map(quote).join(' ')
}

/** Visible failure when the installer exited cleanly but the probed copy is still older. */
export function staleInstallMessage(label, installedVersion, latestVersion) {
  return `${label} 的更新没有生效：检测到的版本仍是 ${installedVersion}，低于最新 ${latestVersion}。PATH 上可能有另一份更早的安装。请查看本行安装日志。`
}

/**
 * Which updater to run. `order` is compareReleaseVersions(installed, latest):
 * -1 older, 0 same, 1 newer, null when either version is unknown.
 */
export function officialUpdatePlan({ toolId, installed, order, platform }) {
  if (installed && order === 1) return 'refuse-downgrade'
  if (installed && order === 0) return 'already-current'
  if (installed && order === -1 && toolId === 'claude-code') return 'claude-update-then-registry'
  if (installed && (order === -1 || order === null) && toolId === 'minimax-code' && platform === 'win32') {
    return 'minimax-official-installer'
  }
  return 'registry-install'
}

async function trustedExecutionReadiness(toolId) {
  // Loaded only during an install to avoid coupling fast version probes to
  // the executor. The executor itself uses this runtime for PATH discovery.
  const { officialToolReadiness } = await import('./official-tool-executor.mjs')
  return officialToolReadiness(toolId)
}

function runCapture(executable, args, { timeoutMs, onOutput, useShell = false, signal, env } = {}) {
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
      // One pre-quoted command string so Node's shell wrapper cannot split
      // `@scope/pkg@latest`. PowerShell keeps useShell false and an args array.
      const command = useShell ? shellCommandLine(executable, args) : executable
      child = spawn(command, useShell ? [] : args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // Windows npm CLIs install as .cmd shims; only cmd.exe can execute
        // them. Safe here because every executable and argument comes from
        // the fixed registry — caller input never reaches this boundary.
        shell: useShell,
        ...(env ? { env } : {}),
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

/**
 * MiniMax's official Windows installer script is run as published (it installs
 * `@minimax-ai/code@latest`). Only structural sanity is checked: it must be the
 * MiniMax Code installer, not an HTML error page or another script.
 */
export function officialMiniMaxInstaller(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source)
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
  if (!text.includes('@minimax-ai/code') || /^\s*</.test(text)) {
    throw new Error('下载内容不是 MiniMax Code 官方 Windows 安装脚本，已拒绝执行。')
  }
  return text
}

async function fetchOfficialMiniMaxInstaller(signal) {
  const response = await fetch(MINIMAX_INSTALLER_URL, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  })
  if (!response.ok || !response.body) throw new Error(`官方脚本下载失败：HTTP ${response.status}`)
  const chunks = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > MAX_INSTALLER_BYTES) throw new Error('官方安装脚本超过大小上限。')
    chunks.push(chunk)
  }
  return officialMiniMaxInstaller(Buffer.concat(chunks))
}

async function runOfficialMiniMaxInstaller(job, { reason } = {}) {
  let staging = null
  let prefixRoot = null
  try {
    job.finishedAt = null
    job.error = null
    job.phase = 'downloading-and-verifying'
    pushLine(job, reason || '— npm 原生依赖未就绪；改用 MiniMax 官方 Windows 安装脚本（安装最新版）—')
    const prefixResult = await runCapture('npm', ['config', 'get', 'prefix'], {
      timeoutMs: 5_000, useShell: true, signal: job.controller.signal,
    })
    const rawPrefix = prefixResult.stdout.trim().replace(/^\\\\\?\\/, '')
    if (!prefixResult.ok || !isAbsolute(rawPrefix)) throw new Error('无法确定 npm 全局安装目录。')
    await mkdir(rawPrefix, { recursive: true })
    prefixRoot = await realpath(rawPrefix)
    const script = await fetchOfficialMiniMaxInstaller(job.controller.signal)
    staging = await mkdtemp(join(prefixRoot, '.model-router-minimax-installer-'))
    const scriptPath = join(staging, 'install.ps1')
    const tempPath = join(staging, 'temp')
    await mkdir(tempPath)
    // Windows PowerShell 5 reads a BOM-less .ps1 using the system ANSI page.
    // The upstream installer contains Unicode art, so write a UTF-8 BOM.
    await writeFile(scriptPath, `\uFEFF${script}`, 'utf8')
    const installDir = join(prefixRoot, '.minimax-code')
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32',
      'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const utilityModule = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32',
      'WindowsPowerShell', 'v1.0', 'Modules', 'Microsoft.PowerShell.Utility',
      'Microsoft.PowerShell.Utility.psd1')
    const command = '$ErrorActionPreference="Stop"; '
      + 'Import-Module -Name $env:MODEL_ROUTER_UTILITY_MODULE -ErrorAction Stop; '
      + '& $env:MODEL_ROUTER_MINIMAX_INSTALL_SCRIPT'
    job.phase = 'installing'
    const outcome = await runCapture(powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        timeoutMs: INSTALL_TIMEOUT_MS, signal: job.controller.signal,
        env: { ...process.env, MCODE_INSTALL_DIR: installDir,
          MCODE_NO_MODIFY_PATH: '1', MCODE_DOWNLOAD_MIRROR: 'global',
          MCODE_NPM_REGISTRY: 'https://registry.npmjs.org/',
          npm_config_cache: join(prefixRoot, '.model-router-npm-cache'),
          TEMP: tempPath, TMP: tempPath,
          MODEL_ROUTER_UTILITY_MODULE: utilityModule,
          MODEL_ROUTER_MINIMAX_INSTALL_SCRIPT: scriptPath },
        onOutput: chunk => {
          for (const line of chunk.split(/\r?\n/)) if (line.trim()) pushLine(job, line.slice(0, 500))
        },
      })
    if (outcome.cancelled || job.cancelRequested) { markCancelled(job); return }
    job.exitCode = outcome.code
    job.timedOut = outcome.timedOut
    if (!outcome.ok) throw new Error(outcome.timedOut
      ? '官方安装脚本超时并已终止。'
      : `官方安装脚本退出码 ${outcome.code ?? '信号终止'}。${outcome.stderr.split('\n').find(Boolean)?.slice(0, 180) ?? ''}`)
    const currentPath = process.env.PATH ?? ''
    if (!currentPath.split(';').includes(installDir)) process.env.PATH = `${currentPath};${installDir}`
    job.phase = 'verifying'
    probeCache.delete(job.tool.id)
    const probe = await probeToolWith(job.tool, defaultRunner)
    job.postInstallProbe = probe
    const readiness = await trustedExecutionReadiness(job.tool.id)
    if (!probe.installed || !readiness.ready) {
      throw new Error(`官方安装器完成，但执行入口未通过 npm registry 摘要核验：${readiness.reason ?? probe.detail}`)
    }
    const latest = await latestVersions.lookup(job.tool).catch(() => null)
    if (latest?.version && versionStillOlder(probe.version, latest.version)) {
      throw new Error(staleInstallMessage(job.tool.label, probe.version, latest.version))
    }
    job.status = 'succeeded'
    job.finishedAt = new Date().toISOString()
    pushLine(job, `— 官方安装器已完成，MiniMax Code ${probe.version ?? ''} 的执行入口已核验 —`)
  } catch (error) {
    if (job.cancelRequested || job.controller.signal.aborted) { markCancelled(job); return }
    job.status = 'failed'
    job.error = `MiniMax 官方安装兜底失败：${String(error?.message ?? error).slice(0, 300)}`
    job.finishedAt = new Date().toISOString()
  } finally {
    if (staging && prefixRoot) {
      const part = relative(prefixRoot, staging)
      if (part.startsWith('.model-router-minimax-installer-') && !part.includes(sep)) {
        await rm(staging, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}

/** Tools whose ready-check failure can be repaired by reinstalling the same version. */
const CAPABILITY_REPAIRABLE = new Set(['claude-code', 'codex', 'kimi-code', 'minimax-code', 'mimo-code', 'grok-build'])

function appendBounded(current, addition) {
  const merged = current + addition
  return merged.length > 64_000 ? merged.slice(merged.length - 32_000) : merged
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
  if (tool.manager === 'signed-windows-installer') {
    let rejected = null
    const bundle = await discoverZCodeBundle({ onRejected: value => { rejected ??= value } })
    if (bundle) return { id: tool.id, installed: true, version: bundle.version, status: 'installed',
      detail: `${tool.probeNote} 安装目录：${bundle.root}`, bannerLine: `${tool.label} ${bundle.buildVersion}` }
    if (rejected) return { id: tool.id, installed: false, version: null, status: 'not-installed', detail: `检测到已安装的 ZCode ${rejected.version}（${rejected.root}）：${rejected.rejected}` }
    const other = (await unverifiedZCodeInstalls().catch(() => []))[0]
    return { id: tool.id, installed: false, version: null, status: 'not-installed',
      detail: other
        ? `检测到已安装的 ZCode ${other.version ?? '（版本未知）'}${other.root ? `（${other.root}）` : ''}，但 ZCode.exe 未通过智谱发布者签名或 GLM 组件检查，因此不通过插件调用；可以继续直接使用 ZCode 桌面版。`
        : '未找到具有智谱有效签名的 ZCode 桌面版。' }
  }
  if (tool.id === 'minimax-code' && IS_WINDOWS) {
    // The official Windows installer keeps mcode under a versioned releases
    // directory. A partial npm install can leave a broken shim earlier on PATH;
    // prefer the checksum-verified installer release in that case.
    const { findManagedMiniMaxEntry } = await import('./official-tool-executor.mjs')
    const managed = await findManagedMiniMaxEntry(process.cwd())
    if (managed) return { id: tool.id, installed: true, version: managed.version,
      status: 'installed', detail: '已按官方 npm registry 摘要核验 MiniMax 官方 Windows 安装器中的 CLI 文件。',
      bannerLine: `MiniMax Code ${managed.version}` }
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
        if (IS_WINDOWS && !process.env.GROK_HOME && /^[D-Z]:[\\/]/i.test(prefix)) {
          // Grok's npm bootstrap otherwise expands its native binary under
          // the Windows user profile on C. Keep plugin-managed downloads on
          // the same non-C drive as this user's npm global prefix.
          process.env.GROK_HOME = join(prefix, '.model-router-grok')
        }
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
export async function probeAllTools({ fresh = false } = {}) {
  await ensureNpmPrefixOnPath()
  return Promise.all(OFFICIAL_TOOLS.map(tool => probeToolWith(tool, defaultRunner,
    fresh ? { cacheMs: 0 } : {})))
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
  const manager = tool.manager === 'npm' ? 'npm' : tool.manager === 'signed-windows-installer' ? 'signed-windows-installer' : 'uv'
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
  installChain = installChain.then(() => manager === 'signed-windows-installer'
    ? runZCodeInstallJob(job) : runInstallJob(manager, tool.installArgs, job)).catch(error => {
    if (job.status === 'cancelled') return
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.error = `安装流程失败：${String(error?.message ?? error).slice(0, 200)}`
  })
  return jobView(job)
}

function captureLines(job) {
  return chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) pushLine(job, line.slice(0, 500))
    }
  }
}

/** Mark the job succeeded only when the fresh probe is installed, ready, and not still older. */
async function finishVerifiedInstall(job, probe) {
  job.postInstallProbe = probe
  if (job.cancelRequested) { markCancelled(job); return true }
  if (!probe.installed) {
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.error = `安装命令已完成，但重探测失败：${probe.detail}`
    return true
  }
  const latest = await latestVersions.lookup(job.tool).catch(() => null)
  if (latest?.version && versionStillOlder(probe.version, latest.version)) {
    failBecauseStillOlder(job, probe, latest.version)
    return true
  }
  const readiness = await trustedExecutionReadiness(job.tool.id)
  if (job.cancelRequested) { markCancelled(job); return true }
  if (!readiness.ready) {
    if (IS_WINDOWS && job.tool.id === 'minimax-code') {
      await runOfficialMiniMaxInstaller(job)
      return true
    }
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.error = `安装命令和版本探测已成功，但官方执行入口未就绪：${readiness.reason}`
    return true
  }
  job.status = 'succeeded'
  job.finishedAt = new Date().toISOString()
  pushLine(job, `— 已安装 ${job.tool.label} ${probe.version ?? ''}，官方执行入口已核验（新版本未经插件测试）—`)
  return true
}

function failBecauseStillOlder(job, probe, latestVersion) {
  job.postInstallProbe = probe
  job.status = 'failed'
  job.finishedAt = new Date().toISOString()
  job.error = staleInstallMessage(job.tool.label, probe?.version, latestVersion)
}

/**
 * Native Claude Code lives outside the npm prefix. `claude update` is the
 * vendor's non-interactive updater; return true when the job is finished.
 */
async function tryClaudeUpdate(job, latestVersion) {
  if (job.cancelRequested) { markCancelled(job); return true }
  pushLine(job, '$ claude update')
  job.phase = 'installing'
  const outcome = await runCapture('claude', CLAUDE_UPDATE_ARGS, {
    timeoutMs: CLAUDE_UPDATE_TIMEOUT_MS,
    useShell: IS_WINDOWS,
    signal: job.controller.signal,
    onOutput: captureLines(job),
  })
  if (job.status !== 'running') return true
  if (outcome.cancelled || job.cancelRequested) { markCancelled(job); return true }
  if (!outcome.ok) {
    pushLine(job, `— claude update 未完成（退出码 ${outcome.code ?? '信号终止'}），将继续尝试注册表安装 —`)
    return false
  }
  await ensureNpmPrefixOnPath()
  probeCache.delete(job.tool.id)
  const probe = await probeToolWith(job.tool, defaultRunner)
  if (job.cancelRequested) { markCancelled(job); return true }
  if (latestVersion && versionStillOlder(probe.version, latestVersion)) {
    job.postInstallProbe = probe
    pushLine(job, `— claude update 已结束，但探测到的版本仍是 ${probe.version}，低于 ${latestVersion} —`)
    return false
  }
  return finishVerifiedInstall(job, probe)
}

async function runInstallJob(manager, args, job) {
  if (job.status !== 'running') return
  job.phase = 'preflight'
  await ensureNpmPrefixOnPath()
  if (job.cancelRequested) { markCancelled(job); return }
  probeCache.delete(job.tool.id)
  const before = await probeToolWith(job.tool, defaultRunner)
  if (job.cancelRequested) { markCancelled(job); return }
  let latest = null
  let order = null
  if (before.installed) {
    latest = await latestVersions.lookup(job.tool, { fresh: true }).catch(() => null)
    if (job.cancelRequested) { markCancelled(job); return }
    order = latest?.version ? compareReleaseVersions(before.version, latest.version) : null
    if (order === 1) {
      job.status = 'failed'
      job.finishedAt = new Date().toISOString()
      job.postInstallProbe = before
      job.error = `已安装 ${before.version}，高于 npm 最新正式版 ${latest.version}；不会自动降级。`
      return
    }
    if (order === 0) {
      const readiness = await trustedExecutionReadiness(job.tool.id)
      if (job.cancelRequested) { markCancelled(job); return }
      if (readiness.ready || !CAPABILITY_REPAIRABLE.has(job.tool.id)) {
        job.status = 'succeeded'
        job.finishedAt = new Date().toISOString()
        job.postInstallProbe = before
        pushLine(job, `— ${job.tool.label} ${before.version} 已是最新版本，无需重复安装 —`)
        return
      }
      pushLine(job, `— 已是最新版本 ${before.version}，但执行入口未就绪：${readiness.reason}；重新安装修复 —`)
    }
  }
  const plan = officialUpdatePlan({
    toolId: job.tool.id,
    installed: before.installed === true,
    order,
    platform: process.platform,
  })
  let triedClaudeUpdate = false
  if (plan === 'claude-update-then-registry') {
    triedClaudeUpdate = true
    const finished = await tryClaudeUpdate(job, latest?.version)
    if (finished || job.status !== 'running') return
  } else if (plan === 'minimax-official-installer') {
    await runOfficialMiniMaxInstaller(job, {
      reason: '— 已安装的 MiniMax Code 由官方安装目录接管；直接运行官方 Windows 安装脚本以更新到最新版 —',
    })
    return
  }
  job.phase = 'installing'
  const outcome = await runCapture(manager, args, {
    timeoutMs: INSTALL_TIMEOUT_MS,
    useShell: IS_WINDOWS,
    signal: job.controller.signal,
    onOutput: captureLines(job),
  })
  if (job.status !== 'running') return
  if (outcome.cancelled || job.cancelRequested) { markCancelled(job); return }
  job.exitCode = outcome.code
  job.timedOut = outcome.timedOut
  if (outcome.timedOut) {
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.error = `安装超时（${INSTALL_TIMEOUT_MS / 1000}s），已终止。`
    return
  }
  if (!outcome.ok) {
    if (IS_WINDOWS && job.tool.id === 'minimax-code') {
      await runOfficialMiniMaxInstaller(job)
      return
    }
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.error = `安装命令失败（退出码 ${outcome.code ?? '信号终止'}）。${outcome.stderr.split('\n').find(Boolean)?.slice(0, 200) ?? ''}`
    return
  }
  job.phase = 'verifying'
  await ensureNpmPrefixOnPath()
  probeCache.delete(job.tool.id)
  const probe = await probeToolWith(job.tool, defaultRunner)
  if (job.cancelRequested) { markCancelled(job); return }
  job.postInstallProbe = probe
  const latestAfter = (await latestVersions.lookup(job.tool).catch(() => null)) ?? latest
  const stillOlder = Boolean(latestAfter?.version && versionStillOlder(probe.version, latestAfter.version))
  if (stillOlder && job.tool.id === 'claude-code' && !triedClaudeUpdate) {
    triedClaudeUpdate = true
    const finished = await tryClaudeUpdate(job, latestAfter.version)
    if (finished || job.status !== 'running') return
    failBecauseStillOlder(job, job.postInstallProbe ?? probe, latestAfter.version)
    return
  }
  if (stillOlder && IS_WINDOWS && job.tool.id === 'minimax-code') {
    pushLine(job, `— npm 完成后 ${job.tool.label} 仍是 ${probe.version}，低于最新 ${latestAfter.version}；改用官方安装脚本 —`)
    await runOfficialMiniMaxInstaller(job)
    return
  }
  if (stillOlder) {
    pushLine(job, `— 注意：PATH 上的 ${job.tool.label} 仍是 ${probe.version}，低于最新 ${latestAfter.version} —`)
    failBecauseStillOlder(job, probe, latestAfter.version)
    return
  }
  await finishVerifiedInstall(job, probe)
}

async function runZCodeInstallJob(job) {
  if (job.status !== 'running') return
  job.phase = 'preflight'
  probeCache.delete(job.tool.id)
  const before = await probeToolWith(job.tool, defaultRunner)
  if (job.cancelRequested) { markCancelled(job); return }
  const latest = await latestVersions.lookup(job.tool, { fresh: true }).catch(() => null)
  if (job.cancelRequested) { markCancelled(job); return }
  if (before.installed && latest?.version && (compareReleaseVersions(before.version, latest.version) ?? -1) >= 0) {
    job.status = 'succeeded'
    job.phase = 'done'
    job.finishedAt = new Date().toISOString()
    job.postInstallProbe = before
    pushLine(job, `— 已找到 ZCode ${before.version}（最新 ${latest.version}），无需重复打开安装器 —`)
    return
  }
  const prefix = await runCapture('npm', ['config', 'get', 'prefix'], {
    timeoutMs: 5_000, useShell: IS_WINDOWS, signal: job.controller.signal,
  })
  if (job.cancelRequested) { markCancelled(job); return }
  job.phase = 'downloading-and-verifying'
  let lastProgress = 0
  try {
    const opened = await openZCodeInstaller({
      latest,
      npmPrefix: prefix.ok ? prefix.stdout.trim() : undefined,
      signal: job.controller.signal,
      onProgress({ receivedBytes, declaredBytes }) {
        const now = Date.now()
        if (now - lastProgress < 3_000) return
        lastProgress = now
        pushLine(job, `已下载 ${(receivedBytes / 1_000_000).toFixed(1)} MB${declaredBytes ? ` / ${(declaredBytes / 1_000_000).toFixed(1)} MB` : ''}`)
      },
    })
    if (job.cancelRequested) { markCancelled(job); return }
    job.status = opened.status
    job.phase = 'installer-opened'
    job.finishedAt = new Date().toISOString()
    probeCache.delete(job.tool.id)
    pushLine(job, `已验证发布者签名并打开 ZCode ${opened.version} 官方安装器：${opened.installerPath}`)
    pushLine(job, '请在原厂安装界面选择非 C 盘目录；完成后点击“重新检测”。')
  } catch (error) {
    if (job.cancelRequested || job.controller.signal.aborted) { markCancelled(job); return }
    job.status = 'failed'
    job.phase = 'done'
    job.finishedAt = new Date().toISOString()
    job.error = `ZCode 安装器未打开：${String(error?.message ?? error).slice(0, 300)}`
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
