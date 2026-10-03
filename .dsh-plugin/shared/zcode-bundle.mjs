/**
 * Locate the ZCode desktop bundle on Windows without trusting PATH.
 *
 * Discovery accepts a deliberate operator override, Windows uninstall records,
 * and the conventional installation directories. Any ZCode version is accepted
 * (the plugin follows the vendor's latest release), but an install is usable
 * only if:
 * - its canonical ZCode.exe has a valid Authenticode signature whose signer is
 *   the expected publisher (北京智谱华章科技股份有限公司);
 * - the bundled GLM entry (resources/glm/zcode.cjs) stays inside that same
 *   canonical root and the bundle metadata names it as the electron-node entry;
 * - zcode.cjs is unchanged since it was first verified for this signed build.
 *
 * zcode.cjs is plain JavaScript: it cannot carry a signature, and ZCode ships
 * no signed manifest of it, so the signature on ZCode.exe does not cover it.
 * Earlier releases compared it with a hash compiled in for exactly 3.14.3. That
 * cannot follow new releases, so the plugin now records the script's SHA-256
 * per (install root, signed build version, signer) the first time it verifies
 * the signed executable, and refuses to run the script if it later changes
 * while the signed build stays the same (an update changes the build and is
 * recorded afresh).
 */
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, isAbsolute, join, relative, sep, win32 } from 'node:path'
import { resolveStateHome } from './router-state.mjs'

const execFileAsync = promisify(execFile)

export const ZCODE_SIGNER = '北京智谱华章科技股份有限公司'
export const ZCODE_INSTALL_ENV_VAR = 'MODEL_ROUTER_ZCODE_HOME'
/** Upper bound for the GLM CLI script (3.14.3: 14.8 MB). */
const ZCODE_CLI_MAX_SIZE = 200_000_000

const REGISTRY_PATHS = Object.freeze([
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
])

function powershellPath(env) {
  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

async function powershellJson(script, env, extraEnv = {}) {
  if (process.platform !== 'win32') return null
  const command = Buffer.from(
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
      + '$ErrorActionPreference = "Stop"; ' + script,
    'utf16le',
  ).toString('base64')
  try {
    const { stdout } = await execFileAsync(powershellPath(env), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command,
    ], {
      windowsHide: true,
      shell: false,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 256_000,
      env: { ...env, ...extraEnv },
    })
    const output = stdout.trim().replace(/^\uFEFF/, '')
    return output ? JSON.parse(output) : null
  } catch {
    return null
  }
}

async function uninstallRecords(env) {
  const paths = REGISTRY_PATHS.map(path => `'${path}'`).join(',')
  const script = `$records = @(Get-ItemProperty -Path @(${paths}) -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.DisplayName -match '^ZCode(?:\\s|$)' } |
    ForEach-Object { [pscustomobject]@{
      displayName = [string]$_.DisplayName
      displayVersion = [string]$_.DisplayVersion
      installLocation = [string]$_.InstallLocation
      displayIcon = [string]$_.DisplayIcon
      uninstallString = [string]$_.UninstallString
    } }); ConvertTo-Json -InputObject $records -Compress -Depth 3`
  const value = await powershellJson(script, env)
  return Array.isArray(value) ? value : value ? [value] : []
}

function rootFromCommand(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const quoted = /^"([^"]+)"/.exec(trimmed)
  const executable = quoted?.[1] ?? /^(.+?\.(?:exe|ico))(?=,|\s|$)/i.exec(trimmed)?.[1]
  return executable && win32.isAbsolute(executable) ? dirname(executable) : null
}

function candidateRoots(env, records) {
  const candidates = []
  const add = (path, source, registryVersion = null) => {
    if (typeof path !== 'string' || !path.trim()) return
    candidates.push({ path: path.trim().replace(/^"|"$/g, ''), source, registryVersion })
  }
  add(env[ZCODE_INSTALL_ENV_VAR], 'operator-env')
  for (const record of records) {
    const version = String(record.displayVersion || '') || null
    add(record.installLocation, 'uninstall-registry', version)
    add(rootFromCommand(record.displayIcon), 'uninstall-registry', version)
    add(rootFromCommand(record.uninstallString), 'uninstall-registry', version)
  }
  for (const parent of [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432]) {
    if (typeof parent !== 'string' || !win32.isAbsolute(parent)) continue
    add(join(parent, 'Programs', 'ZCode'), 'standard-directory')
    add(join(parent, 'ZCode'), 'standard-directory')
  }
  return candidates
}

function isWithin(root, child) {
  const part = relative(root, child)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

function localWindowsPath(path) {
  if (typeof path !== 'string' || path.includes('\0')) return false
  const local = path.startsWith('\\\\?\\') ? path.slice(4) : path
  return /^[A-Za-z]:[\\/]/.test(local)
}

async function sha256Hex(path) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex').toUpperCase()
}

export function zcodeTrustPath(env = process.env) {
  return join(resolveStateHome(env), 'model-router', 'zcode-trust.json')
}

/**
 * Trust-on-first-use record of zcode.cjs per signed build. Returns
 * { ok, sha256, firstSeen } or { ok: false, reason }.
 */
export async function checkZCodeCliRecord({ root, buildVersion, signer, sha256, size, trustPath = zcodeTrustPath(), now = Date.now }) {
  let saved = {}
  try { saved = JSON.parse(await readFile(trustPath, 'utf8'))?.entries ?? {} } catch { saved = {} }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {}
  const key = `${win32.normalize(root).toLowerCase()}|${buildVersion}|${signer}`
  const known = saved[key]
  if (known && typeof known.sha256 === 'string') {
    return known.sha256 === sha256 && known.size === size
      ? { ok: true, sha256, firstSeen: known.firstSeen ?? null }
      : { ok: false, reason: `ZCode ${buildVersion} 的 CLI 脚本与首次核验时不同（签名程序未变），已拒绝执行；重新安装 ZCode 后再试。` }
  }
  // A new build of the same install replaces the older records for that root.
  const prefix = `${win32.normalize(root).toLowerCase()}|`
  for (const name of Object.keys(saved)) if (name.startsWith(prefix)) delete saved[name]
  saved[key] = { sha256, size, firstSeen: now() }
  try {
    await mkdir(dirname(trustPath), { recursive: true })
    const temporary = `${trustPath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: 1, entries: saved }, null, 2)}\n`, 'utf8')
    await rename(temporary, trustPath)
  } catch { /* unrecorded: verified again next time */ }
  return { ok: true, sha256, firstSeen: saved[key].firstSeen, recorded: true }
}

async function bundleMetaNamesEntry(root) {
  try {
    const meta = JSON.parse(await readFile(join(root, 'resources', 'glm', '.node-bundle-meta.json'), 'utf8'))
    return meta?.entry === 'zcode.cjs' && (meta.runtime === undefined || meta.runtime === 'electron-node')
  } catch { return false }
}

async function signedExecutable(executable, env) {
  const script = `$s = Get-AuthenticodeSignature -LiteralPath $env:MODEL_ROUTER_ZCODE_VERIFY_PATH;
    $v = (Get-Item -LiteralPath $env:MODEL_ROUTER_ZCODE_VERIFY_PATH).VersionInfo;
    [pscustomobject]@{
      signatureStatus = [string]$s.Status
      signerSubject = [string]$s.SignerCertificate.Subject
      signerThumbprint = [string]$s.SignerCertificate.Thumbprint
      productVersion = [string]$v.ProductVersion
      fileVersion = [string]$v.FileVersion
    } | ConvertTo-Json -Compress`
  return zcodeSignatureVerdict(await powershellJson(script, env, { MODEL_ROUTER_ZCODE_VERIFY_PATH: executable }))
}

/**
 * Signer-only acceptance of ZCode.exe: valid Authenticode signature by Zhipu.
 * Any x.y.z build is accepted (no version gate); the version is read from the
 * signed file's version resource so it cannot be spoofed without breaking it.
 */
export function zcodeSignatureVerdict(value) {
  if (!value || value.signatureStatus !== 'Valid'
    || typeof value.signerSubject !== 'string'
    || !value.signerSubject.includes(ZCODE_SIGNER)) return null
  const buildVersion = String(value.productVersion || value.fileVersion || '')
  const version = /^(\d+\.\d+\.\d+)(?:\.\d+)?$/.exec(buildVersion)?.[1]
  if (!version) return null
  return { version, buildVersion, fileVersion: String(value.fileVersion || ''), publisher: value.signerSubject,
    thumbprint: String(value.signerThumbprint || '') }
}

async function checkedBundle(candidate, env, trustPath) {
  const input = candidate.path
  if (!localWindowsPath(input)) return null
  try {
    const initial = input.toLowerCase().endsWith('\\zcode.exe') ? dirname(input) : input
    const root = await realpath(initial)
    if (!localWindowsPath(root) || !(await stat(root)).isDirectory()) return null
    const executable = await realpath(join(root, 'ZCode.exe'))
    const cliEntry = await realpath(join(root, 'resources', 'glm', 'zcode.cjs'))
    if (!isWithin(root, executable) || !isWithin(root, cliEntry)
      || !(await stat(executable)).isFile() || !(await stat(cliEntry)).isFile()) return null
    const signature = await signedExecutable(executable, env)
    if (!signature || !(await bundleMetaNamesEntry(root))) return null
    const size = (await stat(cliEntry)).size
    if (size <= 0 || size > ZCODE_CLI_MAX_SIZE) return null
    const cliSha256 = await sha256Hex(cliEntry)
    const record = await checkZCodeCliRecord({ root, buildVersion: signature.buildVersion,
      signer: signature.thumbprint || signature.publisher, sha256: cliSha256, size, trustPath })
    if (!record.ok) return { rejected: record.reason, root, version: signature.version }
    return Object.freeze({
      id: 'zcode',
      version: signature.version,
      buildVersion: signature.buildVersion,
      fileVersion: signature.fileVersion,
      registryVersion: candidate.registryVersion,
      root,
      executable,
      cliEntry,
      cliSha256,
      cliFirstVerifiedAt: record.firstSeen,
      publisher: signature.publisher,
      signatureStatus: 'Valid',
      source: candidate.source,
    })
  } catch {
    return null
  }
}

/** Return the first verified local bundle (any version), or null when none is usable. */
export async function discoverZCodeBundle({ env = process.env, trustPath = zcodeTrustPath(env), onRejected } = {}) {
  if (process.platform !== 'win32') return null
  const records = await uninstallRecords(env)
  const seen = new Set()
  for (const candidate of candidateRoots(env, records)) {
    const key = win32.normalize(candidate.path).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const bundle = await checkedBundle(candidate, env, trustPath)
    if (bundle?.rejected) { onRejected?.(bundle); continue }
    if (bundle) return bundle
  }
  return null
}

/**
 * ZCode entries in the uninstall registry that did not pass verification (for
 * example an unsigned or modified copy). Only used to explain why the tool
 * shows as unavailable; nothing found here is ever executed.
 */
export async function unverifiedZCodeInstalls({ env = process.env } = {}) {
  if (process.platform !== 'win32') return []
  const records = await uninstallRecords(env)
  return records.map(record => ({
    version: String(record.displayVersion || '') || null,
    root: [record.installLocation, rootFromCommand(record.displayIcon), rootFromCommand(record.uninstallString)]
      .find(value => typeof value === 'string' && value.trim()) ?? null,
  }))
}
