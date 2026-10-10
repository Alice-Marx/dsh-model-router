/**
 * Turns the user's plugin settings into one concrete, reviewable install plan.
 *
 * Two separate "addresses" are configurable, and both stay on the Host: a
 * unified install directory and a set of download sources (an npm registry plus
 * per-tool installer-script URLs). The client never sends either — the RPC
 * carries only a registry id and a method id, so a hostile client cannot point
 * this plugin at an arbitrary package or URL. Everything here is Host config
 * the user typed into their own settings form.
 *
 * Script installs are never piped into an interpreter. A plan carries the
 * vendor URL plus the markers that still identify that vendor's script; the
 * runtime downloads it with a size cap, checks the markers, stages a copy and
 * runs that. So a mirror may serve different bytes, but it may not serve a
 * different program.
 *
 * This module is imported by the browser bundle too, so it must stay free of
 * Node built-ins: paths are handled with plain string rules, and the Host passes
 * the home directory in when it needs one.
 */
import {
  DEFAULT_NPM_REGISTRY,
  defaultInstallMethod,
  installMethodBlockReason,
  installMethodFor,
  installMethodsFor,
  methodHonoursInstallDir,
} from './official-tool-registry.mjs'

export const MAX_INSTALL_DIR_CHARS = 4_096
export const MAX_SOURCE_URL_CHARS = 2_048
export const MAX_OVERRIDES = 64

/** Windows drive paths, UNC paths, or anything rooted at `/`. */
export function isAbsolutePath(value) {
  const raw = String(value ?? '')
  if (!raw) return false
  if (raw.startsWith('/')) return true
  if (/^[A-Za-z]:[\\/]/.test(raw)) return true
  return /^\\\\[^\\]+\\[^\\]+/.test(raw)
}

/** Join path segments with the separator the first absolute segment already uses. */
export function joinPath(base, ...segments) {
  const separator = String(base ?? '').includes('\\') && !String(base ?? '').includes('/') ? '\\' : '/'
  const parts = [String(base ?? '').replace(/[\\/]+$/, ''), ...segments.map(item => String(item ?? '').replace(/^[\\/]+|[\\/]+$/g, ''))]
  return parts.filter(Boolean).join(separator) || separator
}

/** Expand `~` and environment references the way a shell would on this host. */
export function expandInstallDir(value, { home = '', env = {} } = {}) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw.includes('\0')) throw new Error('安装目录包含无效字符。')
  let expanded = raw
  const userHome = String(home ?? '')
  if (expanded === '~') expanded = userHome
  else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) expanded = joinPath(userHome, expanded.slice(2))
  // `%VAR%` on Windows, `$VAR` elsewhere — both forms the vendor scripts accept.
  expanded = expanded
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name) => env[name] ?? match)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => env[name] ?? match)
  if (expanded.length > MAX_INSTALL_DIR_CHARS) throw new Error('安装目录过长。')
  if (!isAbsolutePath(expanded)) throw new Error('安装目录必须是绝对路径。')
  // A bare root ("/", "D:\\", "\\\\server\\share") would take the machine with it.
  const withoutTrailing = expanded.replace(/[\\/]+$/, '')
  if (!withoutTrailing) throw new Error('安装目录不能是文件系统根目录。')
  if (/^[A-Za-z]:$/.test(withoutTrailing)) throw new Error('安装目录不能是文件系统根目录。')
  if (/^\\\\[^\\]+\\[^\\]+$/.test(withoutTrailing)) throw new Error('安装目录不能是网络共享根目录。')
  return expanded
}

/** Only https mirrors are accepted; a plain-http script source can be tampered with in transit. */
export function normalizeSourceUrl(value, subject) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw.length > MAX_SOURCE_URL_CHARS) throw new Error(`${subject}地址过长。`)
  let url
  try { url = new URL(raw) } catch { throw new Error(`${subject}不是有效网址。`) }
  if (url.protocol !== 'https:') throw new Error(`${subject}必须使用 https。`)
  if (url.username || url.password) throw new Error(`${subject}不能包含账号密码。`)
  return url.toString()
}

function parseJsonObject(value, subject) {
  const raw = String(value ?? '').trim()
  if (!raw) return {}
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error(`${subject}不是有效 JSON。`) }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${subject}必须是 JSON 对象。`)
  }
  const entries = Object.entries(parsed)
  if (entries.length > MAX_OVERRIDES) throw new Error(`${subject}条目过多。`)
  return Object.fromEntries(entries.filter(([, item]) => typeof item === 'string' && item.trim()))
}

function valueOf(config, key, fallback) {
  const value = config?.[key]
  return value !== undefined && typeof value?.get === 'function' ? value.get() : value ?? fallback
}

/** Registry entries used by the installer are the only keys an override may name. */
function keepKnownToolIds(raw, known, subject) {
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new Error(`${subject}中的 ${key} 不是官方工具 ID。`)
  }
  return raw
}

/**
 * Read the plugin settings into a normalized, already-validated shape.
 * Throws with a user-facing message on the first bad value, so the settings
 * form and the installer fail the same way.
 */
export function parseInstallPreferences(config = {}, { tools = [] } = {}) {
  const known = new Set(tools.map(tool => tool.id))
  const installDir = expandInstallDir(valueOf(config, 'toolInstallDir', ''))
  const registry = normalizeSourceUrl(valueOf(config, 'toolNpmRegistry', DEFAULT_NPM_REGISTRY), 'npm 源') || DEFAULT_NPM_REGISTRY
  const methodRaw = keepKnownToolIds(
    parseJsonObject(valueOf(config, 'toolInstallMethodsJson', '{}'), '安装方式覆盖'), known, '安装方式覆盖')
  const scriptRaw = keepKnownToolIds(
    parseJsonObject(valueOf(config, 'toolScriptUrlsJson', '{}'), '安装脚本源覆盖'), known, '安装脚本源覆盖')
  const methods = {}
  const scriptUrls = {}
  for (const [id, methodId] of Object.entries(methodRaw)) methods[id] = methodId.trim()
  for (const [id, url] of Object.entries(scriptRaw)) scriptUrls[id] = normalizeSourceUrl(url, `${id} 安装脚本源`)
  for (const [id, methodId] of Object.entries(methods)) {
    if (!installMethodFor({ id, installMethods: tools.find(tool => tool.id === id)?.installMethods }, methodId)) {
      throw new Error(`${id} 不支持安装方式 ${methodId}。`)
    }
  }
  return {
    installDir,
    registry,
    methods,
    scriptUrls,
    /** Script execution stays a deliberate act; a config file alone must not run one. */
    allowScriptInstall: valueOf(config, 'toolAllowScriptInstall', true) !== false,
  }
}

/** Where a script install puts the binary: the user's directory, else the vendor default. */
export function scriptInstallDir(tool, preferences, { home = '' } = {}) {
  if (!tool?.defaultScriptInstallDir) return ''
  return preferences?.installDir || vendorScriptDir(tool, { home })
}

/** The location the vendor script uses on its own, ignoring any configured directory. */
export function vendorScriptDir(tool, { home = '' } = {}) {
  return joinPath(home, ...String(tool?.defaultScriptInstallDir ?? '').split('/').filter(Boolean))
}

/** argv for a package-manager method, honouring the configured registry and prefix. */
export function packageManagerArgs(method, preferences, { installDir = '' } = {}) {
  const registry = preferences?.registry || DEFAULT_NPM_REGISTRY
  const args = method.installArgs.filter(arg => !arg.startsWith('--registry='))
  args.push(`--registry=${registry}`)
  if (installDir) args.push('--prefix', installDir)
  return [...args]
}

function baseUrlOf(scriptUrl) {
  try {
    const url = new URL(scriptUrl)
    return `${url.origin}${url.pathname.replace(/\/[^/]*$/, '')}`
  } catch { return '' }
}

/**
 * The method to use: the requested one, else the user's saved choice, else the
 * registry default — and if none of those run on this platform, the first
 * declared method that does, so a Windows user is not asked to pick between
 * two Unix shells.
 */
function pickMethod(tool, methodId, preferences, platform) {
  const requested = methodId ?? preferences?.methods?.[tool.id]
  if (!requested) {
    return installMethodsFor(tool).find(method => !installMethodBlockReason(method, platform)) ?? defaultInstallMethod(tool)
  }
  // A named method is never silently swapped. If the tool does not declare it,
  // or it does not run here, the caller gets the reason instead of a surprise.
  const chosen = installMethodFor(tool, requested)
  if (!chosen) throw new Error(`${tool.label} 没有名为 ${requested} 的安装方式。`)
  return chosen
}

function unsupportedMethodError(tool) {
  return tool?.manager === 'signed-windows-installer'
    ? 'ZCode 使用官方签名桌面安装器，由用户在安装窗口选择目录。'
    : `${tool?.label ?? '此工具'} 没有可用的安装方式。`
}

/**
 * One concrete plan for one tool and one method. A thrown Error means the user
 * asked for something this tool cannot do, with a reason they can act on.
 */
export function resolveInstallPlan(tool, methodId, preferences = {}, { platform = 'linux', home = '' } = {}) {
  if (!tool || tool.unsupported) throw new Error(tool?.unsupportedReason ?? '此工具不支持一键安装。')
  const method = pickMethod(tool, methodId, preferences, platform)
  if (!method) throw new Error(unsupportedMethodError(tool))
  const blocked = installMethodBlockReason(method, platform)
  if (blocked) throw new Error(`${tool.label}：${blocked}`)
  if (method.kind === 'script' && preferences?.allowScriptInstall === false) {
    throw new Error('安装脚本方式已在插件设置中关闭；请改用包管理器方式，或在设置里重新允许。')
  }
  const installDir = preferences?.installDir || ''
  if (method.kind === 'script') {
    const scriptUrl = preferences?.scriptUrls?.[tool.id] || method.scriptUrl
    const target = methodHonoursInstallDir(method) ? scriptInstallDir(tool, preferences, { home }) : ''
    return {
      toolId: tool.id,
      method,
      methodId: method.id,
      kind: 'script',
      label: method.label,
      shell: method.shell,
      scriptUrl,
      verify: method.verify,
      installArg: method.installArgs,
      installDir: target,
      env: scriptEnv(method, { installDir: target, scriptUrl }),
      notices: target ? [] : installDir
        ? [`${method.label} 无法使用自定义安装目录（官方脚本写死了安装路径），将安装到 ${vendorScriptDir(tool, { home })}。`]
        : [],
    }
  }
  return {
    toolId: tool.id,
    method,
    methodId: method.id,
    kind: 'package-manager',
    label: method.label,
    manager: method.manager,
    args: packageManagerArgs(method, preferences, { installDir }),
    installDir,
    env: {},
    notices: [],
  }
}

/** Same plan shape for removal, so a UI can show exactly what will be deleted. */
export function resolveUninstallPlan(tool, methodId, preferences = {}, options = {}) {
  const platform = options.platform ?? 'linux'
  const method = pickMethod(tool, methodId, preferences, platform)
  if (!method) throw new Error(tool?.manager === 'signed-windows-installer'
    ? 'ZCode 是桌面安装版，请在系统“应用”中卸载它。'
    : `${tool?.label ?? '此工具'} 没有可用的卸载方式。`)
  const blocked = installMethodBlockReason(method, platform)
  if (blocked) throw new Error(`${tool.label}：${blocked}`)
  if (method.kind === 'script') {
    return { toolId: tool.id, method, methodId: method.id, kind: 'script', label: method.label, ...resolveInstallLocation(tool, method, preferences, options) }
  }
  return {
    toolId: tool.id,
    method,
    methodId: method.id,
    kind: 'package-manager',
    label: method.label,
    manager: method.manager,
    args: [
      ...method.uninstallArgs,
      ...(preferences?.registry ? [`--registry=${preferences.registry}`] : []),
      ...(preferences?.installDir ? ['--prefix', preferences.installDir] : []),
    ],
    installDir: preferences?.installDir || '',
  }
}

/** Where the tool's binary lives, so a later uninstall can find it. */
export function resolveInstallLocation(tool, method, preferences = {}, { home = '' } = {}) {
  if (!method) return null
  if (method.kind === 'script') {
    // A method that cannot honour the configured directory always lands in the
    // vendor's own location, whatever the user typed.
    const dir = methodHonoursInstallDir(method)
      ? scriptInstallDir(tool, preferences, { home })
      : vendorScriptDir(tool, { home })
    return { kind: 'script', dir, binaries: [...(tool.scriptBinaryNames ?? [])] }
  }
  return { kind: 'package-manager', dir: preferences?.installDir || '', binaries: [] }
}

function scriptEnv(method, { installDir, scriptUrl }) {
  const env = {}
  if (installDir && method.env?.includes('STEP_INSTALL_DIR')) env.STEP_INSTALL_DIR = installDir
  // The step installers read their release base from this variable, so a mirror
  // URL also moves the binaries and the checksum manifest, not just the script.
  if (method.env?.includes('STEP_RELEASE_BASE_URL') && scriptUrl) {
    const base = baseUrlOf(scriptUrl)
    if (base) env.STEP_RELEASE_BASE_URL = base
  }
  return env
}
