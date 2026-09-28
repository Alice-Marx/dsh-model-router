/**
 * Locate the pinned ZCode desktop bundle on Windows without trusting PATH.
 *
 * Discovery accepts a deliberate operator override, Windows uninstall records,
 * and the conventional installation directories. An install is usable only if
 * its canonical ZCode.exe has a valid signature from the expected publisher,
 * its signed product version is 3.14.3, and the bundled GLM entry remains
 * inside that same canonical installation root.
 */
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, isAbsolute, join, relative, sep, win32 } from 'node:path'

const execFileAsync = promisify(execFile)

export const ZCODE_SUPPORTED_VERSION = '3.14.3'
export const ZCODE_SIGNER = '北京智谱华章科技股份有限公司'
export const ZCODE_INSTALL_ENV_VAR = 'MODEL_ROUTER_ZCODE_HOME'
export const ZCODE_WINDOWS_INSTALLER_URL =
  'https://cdn-zcode.z.ai/zcode/electron/releases/3.14.3/windows-x64/ZCode-3.14.3-win-x64.exe'
export const ZCODE_WINDOWS_INSTALLER_SHA256 =
  '404895B46DD1E3066B10A9AB9C187CA07F3082AFC8E108A9D02D86B87186CB93'
// Extracted from the hash-checked, Authenticode-valid pinned Windows installer.
// The Desktop EXE signature alone does not authenticate this mutable JS file.
export const ZCODE_CLI_SHA256 =
  'B1DF2EF3E5BD76C4AF3ECB296BC003A10D3F13191A26610BD0BA940FEADAD529'
const ZCODE_CLI_SIZE = 14_820_819

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

async function verifiedCliEntry(path) {
  if ((await stat(path)).size !== ZCODE_CLI_SIZE) return false
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex').toUpperCase() === ZCODE_CLI_SHA256
}

async function signedExecutable(executable, env) {
  const script = `$s = Get-AuthenticodeSignature -LiteralPath $env:MODEL_ROUTER_ZCODE_VERIFY_PATH;
    $v = (Get-Item -LiteralPath $env:MODEL_ROUTER_ZCODE_VERIFY_PATH).VersionInfo;
    [pscustomobject]@{
      signatureStatus = [string]$s.Status
      signerSubject = [string]$s.SignerCertificate.Subject
      productVersion = [string]$v.ProductVersion
      fileVersion = [string]$v.FileVersion
    } | ConvertTo-Json -Compress`
  const value = await powershellJson(script, env, { MODEL_ROUTER_ZCODE_VERIFY_PATH: executable })
  if (!value || value.signatureStatus !== 'Valid'
    || typeof value.signerSubject !== 'string'
    || !value.signerSubject.includes(ZCODE_SIGNER)) return null
  const buildVersion = String(value.productVersion || value.fileVersion || '')
  if (!new RegExp(`^${ZCODE_SUPPORTED_VERSION.replaceAll('.', '\\.')}(?:\\.|$)`).test(buildVersion)) return null
  return { buildVersion, fileVersion: String(value.fileVersion || ''), publisher: value.signerSubject }
}

async function checkedBundle(candidate, env) {
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
    if (!signature || !(await verifiedCliEntry(cliEntry))) return null
    return Object.freeze({
      id: 'zcode',
      version: ZCODE_SUPPORTED_VERSION,
      buildVersion: signature.buildVersion,
      fileVersion: signature.fileVersion,
      registryVersion: candidate.registryVersion,
      root,
      executable,
      cliEntry,
      cliSha256: ZCODE_CLI_SHA256,
      publisher: signature.publisher,
      signatureStatus: 'Valid',
      source: candidate.source,
    })
  } catch {
    return null
  }
}

/** Return the first verified local 3.14.3 bundle, or null when none is usable. */
export async function discoverZCodeBundle({ env = process.env } = {}) {
  if (process.platform !== 'win32') return null
  const records = await uninstallRecords(env)
  const seen = new Set()
  for (const candidate of candidateRoots(env, records)) {
    const key = win32.normalize(candidate.path).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const bundle = await checkedBundle(candidate, env)
    if (bundle) return bundle
  }
  return null
}
