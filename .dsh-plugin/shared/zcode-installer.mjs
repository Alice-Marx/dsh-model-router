/**
 * Fetch and open the pinned official ZCode Windows installer.
 *
 * This module does not perform an unattended install. The visible vendor
 * installer owns the destination picker and any UAC prompt. A successful
 * return means only that the verified installer process was opened.
 */
import { spawn, execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import {
  ZCODE_SIGNER, ZCODE_SUPPORTED_VERSION,
  ZCODE_WINDOWS_INSTALLER_SHA256, ZCODE_WINDOWS_INSTALLER_URL,
} from './zcode-bundle.mjs'

const execFileAsync = promisify(execFile)
const INSTALLER_NAME = `ZCode-${ZCODE_SUPPORTED_VERSION}-win-x64.exe`
const DOWNLOAD_ENV_VAR = 'MODEL_ROUTER_ZCODE_DOWNLOAD_DIR'
const MAX_DOWNLOAD_BYTES = 2_000_000_000
const MAX_REDIRECTS = 4

function drive(path) {
  if (typeof path !== 'string' || path.includes('\0')) return null
  const local = path.startsWith('\\\\?\\') ? path.slice(4) : path
  const match = /^([A-Za-z]):[\\/]/.exec(local)
  return match ? match[1].toUpperCase() : null
}

function nonCAbsolute(path) {
  return typeof path === 'string' && isAbsolute(path)
    && drive(path) !== null && drive(path) !== 'C'
}

function inside(root, child) {
  const part = relative(root, child)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

/**
 * Select a cache on a non-C local drive. The explicit download directory wins;
 * otherwise the caller's npm prefix drive is preferred, then a non-C TEMP.
 */
export async function resolveZCodeDownloadDirectory({
  downloadDir, npmPrefix, env = process.env,
} = {}) {
  if (process.platform !== 'win32') throw new Error('ZCode 安装器仅支持 Windows。')
  const explicit = downloadDir ?? env[DOWNLOAD_ENV_VAR]
  if (explicit != null && !nonCAbsolute(explicit)) {
    throw new TypeError(`${DOWNLOAD_ENV_VAR} 必须是非 C 盘的本地绝对目录。`)
  }
  const candidates = explicit != null
    ? [{ path: explicit, source: 'operator-selected' }]
    : [
      { path: npmPrefix, source: 'npm-prefix' },
      { path: env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX, source: 'npm-prefix-env' },
      { path: env.TEMP, source: 'system-temp' },
      { path: env.TMP, source: 'system-temp' },
      { path: tmpdir(), source: 'system-temp' },
    ].filter(candidate => nonCAbsolute(candidate.path))
  for (const candidate of candidates) {
    try {
      let ancestor = candidate.path
      for (;;) {
        try { await stat(ancestor); break } catch (error) {
          if (error?.code !== 'ENOENT') throw error
          const next = dirname(ancestor)
          if (next === ancestor) throw error
          ancestor = next
        }
      }
      if (!nonCAbsolute(await realpath(ancestor))) continue
      await mkdir(candidate.path, { recursive: true })
      const parent = await realpath(candidate.path)
      if (!nonCAbsolute(parent)) continue
      const cache = join(parent, 'model-router-zcode', ZCODE_SUPPORTED_VERSION)
      await mkdir(cache, { recursive: true })
      const canonical = await realpath(cache)
      if (!nonCAbsolute(canonical) || !inside(parent, canonical)) continue
      return { directory: canonical, source: candidate.source }
    } catch {
      // An unavailable prefix can fall back to another non-C directory.
    }
  }
  throw new Error(`没有可写的非 C 盘下载目录；请设置 ${DOWNLOAD_ENV_VAR}。`)
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex').toUpperCase()
}

async function verifyInstallerSignature(path, env) {
  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); '
    + '$s=Get-AuthenticodeSignature -LiteralPath $env:MODEL_ROUTER_ZCODE_INSTALLER_PATH; '
    + '@{status=[string]$s.Status;subject=[string]$s.SignerCertificate.Subject} '
    + '| ConvertTo-Json -Compress'
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    const { stdout } = await execFileAsync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
    ], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16_384,
      env: { ...env, MODEL_ROUTER_ZCODE_INSTALLER_PATH: path },
    })
    const signature = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''))
    return signature.status === 'Valid'
      && typeof signature.subject === 'string'
      && signature.subject.includes(ZCODE_SIGNER)
  } catch { return false }
}

async function boundedResponse(url, signal) {
  let current = new URL(url)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (current.protocol !== 'https:') throw new Error('ZCode 下载地址必须使用 HTTPS。')
    const response = await fetch(current, { redirect: 'manual', signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location || redirects === MAX_REDIRECTS) throw new Error('ZCode 安装器重定向过多。')
      current = new URL(location, current)
      continue
    }
    if (!response.ok || !response.body) {
      throw new Error(`ZCode 官方安装器下载失败：HTTP ${response.status}。`)
    }
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length > MAX_DOWNLOAD_BYTES) {
      await response.body.cancel()
      throw new Error('ZCode 安装器超出下载大小限制。')
    }
    return response
  }
  throw new Error('ZCode 安装器重定向过多。')
}

async function fetchVerifiedInstaller(path, { env, signal, onProgress } = {}) {
  const expected = ZCODE_WINDOWS_INSTALLER_SHA256.toUpperCase()
  try {
    const info = await stat(path)
    const canonical = await realpath(path)
    if (info.isFile() && info.size <= MAX_DOWNLOAD_BYTES
      && nonCAbsolute(canonical) && inside(dirname(path), canonical)
      && await sha256File(path) === expected
      && await verifyInstallerSignature(path, env)) return { path, reused: true }
    throw new Error('已有 ZCode 安装器缓存未通过 SHA-256 或签名校验；请处理该缓存文件后重试。')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  // Authenticode's PE SIP is selected by the .exe extension on Windows.
  const temporary = join(dirname(path), `.download-${randomUUID()}.exe`)
  let created = false
  try {
    const response = await boundedResponse(ZCODE_WINDOWS_INSTALLER_URL, signal)
    const hash = createHash('sha256')
    let receivedBytes = 0
    const declaredBytes = Number(response.headers.get('content-length')) || null
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        receivedBytes += chunk.length
        if (receivedBytes > MAX_DOWNLOAD_BYTES) {
          callback(new Error('ZCode 安装器超出下载大小限制。'))
          return
        }
        hash.update(chunk)
        try { onProgress?.({ receivedBytes, declaredBytes }) } catch { /* progress is advisory */ }
        callback(null, chunk)
      },
    })
    const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    output.once('open', () => { created = true })
    await pipeline(Readable.fromWeb(response.body), meter,
      output, { signal })
    const actual = hash.digest('hex').toUpperCase()
    if (actual !== expected) throw new Error('ZCode 安装器 SHA-256 与官方固定值不符。')
    if (!(await verifyInstallerSignature(temporary, env))) {
      throw new Error('ZCode 安装器未通过官方发布者 Authenticode 签名校验。')
    }
    const canonical = await realpath(temporary)
    if (!nonCAbsolute(canonical) || !inside(dirname(path), canonical)) {
      throw new Error('ZCode 安装器下载路径离开了非 C 盘缓存目录。')
    }
    await rename(temporary, path)
    created = false
    return { path, reused: false }
  } finally {
    if (created) await unlink(temporary).catch(() => {})
  }
}

function openVisibleInstaller(path) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(path, [], {
        shell: false,
        windowsHide: false,
        detached: true,
        stdio: 'ignore',
      })
    } catch (error) { reject(error); return }
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve(child.pid ?? null)
    })
  })
}

/**
 * Download, verify, and visibly open the vendor installer. The return value
 * intentionally does not claim that installation or sign-in has completed.
 */
export async function openZCodeInstaller({
  downloadDir, npmPrefix, env = process.env, signal, onProgress,
} = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('此固定安装包仅适用于 Windows x64。')
  }
  const cache = await resolveZCodeDownloadDirectory({ downloadDir, npmPrefix, env })
  const installerPath = join(cache.directory, INSTALLER_NAME)
  const verified = await fetchVerifiedInstaller(installerPath, { env, signal, onProgress })
  const pid = await openVisibleInstaller(verified.path)
  return {
    status: 'installer-opened',
    version: ZCODE_SUPPORTED_VERSION,
    installerPath: verified.path,
    sha256: ZCODE_WINDOWS_INSTALLER_SHA256,
    cacheSource: cache.source,
    reusedDownload: verified.reused,
    installerPid: pid,
    destinationSelection: 'visible-vendor-installer',
  }
}
