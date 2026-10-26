/**
 * Bounded, non-interactive execution of verified official CLI entry points.
 *
 * The Host must authorize the request and create an isolated workspace before
 * offering the write mode. The caller supplies a registry id, task text, and
 * an absolute workspace, never a command or arbitrary arguments. Write mode
 * additionally needs a trusted isolation root supplied by the Host;
 * this module rejects a workspace outside that root.
 *
 * Claude: https://code.claude.com/docs/en/headless
 *         https://code.claude.com/docs/en/cli-reference
 * Codex:  https://learn.chatgpt.com/docs/non-interactive-mode
 * Kimi's `-p` enables auto permissions:
 * https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html
 */
import { spawn } from 'node:child_process'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { getOfficialTool, installMethodFor, OFFICIAL_TOOLS } from './official-tool-registry.mjs'
import { currentInstallOptions, ensureNpmPrefixOnPath, installPreferences, preferredToolDirectories, resolvePackageJobPlan, usesConfiguredInstallPlan } from './official-tools-runtime.mjs'
import { resolveInstallPlan } from './tool-install-preferences.mjs'
import { buildMiniMaxInvocation, createMiniMaxStreamParser } from './vendor-minimax-adapter.mjs'
import { discoverZCodeBundle } from './zcode-bundle.mjs'
import { resolveZCodeNpmBundle } from './zcode-npm.mjs'
import { CODE_FILE, npmAttestor } from './npm-attestation.mjs'
import { compareReleaseVersions, isReleaseVersion } from './latest-versions.mjs'
import { resolveMiMoGrokLaunch, createMiMoGrokParser, installedModuleRoots } from './vendor-mimo-grok-adapter.mjs'
import { emptyOutputError, outputIsEmpty, redactDiagnostic, usageFromEvents, usageFromOutput } from './task-executors.mjs'

const IS_WINDOWS = process.platform === 'win32'
const MAX_TASK_BYTES = 64_000
const MAX_OUTPUT_BYTES = 32_000_000
const OUTPUT_TAIL_CHARS = 32_000
const DEFAULT_TIMEOUT_MS = 45 * 60_000
const MAX_TIMEOUT_MS = 2 * 60 * 60_000
const STOP_GRACE_MS = 5_000
const CLAUDE_MIN_RESTRICTED_VERSION = [2, 1, 259]
const CLAUDE_SIGNER = 'Anthropic, PBC'
const CODEX_SIGNER = 'OpenAI OpCo, LLC'
const CODEX_WRITE_UNSUPPORTED = 'Codex 当前仅支持只读任务：原 CODEX_HOME 需要保持可写以使用现有登录与配置；当前沙箱契约无法同时只授权独立 Git 工作区和该状态目录。可编辑团队步骤请改用已支持的其他官方工具。'
const WINDOWS_SYSTEM32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const ENVIRONMENT_KEYS = Object.freeze([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'ComSpec',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
])

const CAPABILITIES = Object.freeze({
  'claude-code': Object.freeze(IS_WINDOWS
    ? { supported: true, modes: Object.freeze(['read-only', 'workspace-write']) }
    : { supported: false, reason: 'Claude 的受限原生入口目前仅在 Windows 完成适配。' }),
  codex: Object.freeze(IS_WINDOWS
    ? { supported: true, modes: Object.freeze(['read-only']) }
    : { supported: false, reason: 'Codex 的签名原生入口目前仅在 Windows 完成适配。' }),
  'kimi-code': Object.freeze({
    supported: true, modes: Object.freeze(['workspace-write']),
  }),
  'minimax-code': Object.freeze({ supported: true, modes: Object.freeze(['workspace-write']) }),
  'mimo-code': Object.freeze(IS_WINDOWS
    ? { supported: true, modes: Object.freeze(['read-only', 'workspace-write']) }
    : { supported: false, reason: 'MiMo 原生执行入口目前仅在 Windows 完成适配。' }),
  'grok-build': Object.freeze(IS_WINDOWS
    ? { supported: true, modes: Object.freeze(['read-only', 'workspace-write']) }
    : { supported: false, reason: 'Grok 原生执行入口目前仅在 Windows 完成适配。' }),
  zcode: Object.freeze({ supported: true, modes: Object.freeze(['workspace-write']) }),
  gemini: Object.freeze({
    supported: false,
    reason: 'Gemini 由无界面适配器执行（gemini -p），不走签名沙箱入口；未安装或失败时回退模型目录 API。',
  }),
  opencode: Object.freeze({
    supported: false,
    reason: 'OpenCode 尚未完成受限执行入口核验；插件负责安装、检测与登录体检，执行仍需在终端中直接使用。',
  }),
  stepcode: Object.freeze({
    supported: false,
    reason: 'Step Code 尚未完成受限执行入口核验；插件负责安装、检测与登录体检，执行仍需在终端中直接使用。',
  }),
  hermes: Object.freeze({ supported: false, modes: Object.freeze([]), reason: 'Hermes 尚未核验托管受限执行；请在官方工具终端中交互使用。' }),
  pi: Object.freeze({ supported: false, modes: Object.freeze([]), reason: 'Pi 尚未核验托管受限执行；请在官方工具终端中交互使用。' }),
})

/** A UI/Host can show this without implying that installation means execution readiness. */
export function officialToolExecutionCapabilities({ executionEnvironment = 'harness' } = {}) {
  return OFFICIAL_TOOLS.map(tool => ({ id: tool.id, ...CAPABILITIES[tool.id],
    ...(executionEnvironment === 'cli-native' && IS_WINDOWS && tool.id === 'codex'
      ? { modes: ['read-only', 'workspace-write'] } : {}) }))
}

function inside(parent, child) {
  const part = relative(parent, child)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

async function checkedWorkspace(workspace) {
  if (typeof workspace !== 'string' || !isAbsolute(workspace) || workspace.includes('\0')) {
    throw new TypeError('workspace must be an absolute directory path')
  }
  const canonical = await realpath(workspace)
  if (!(await stat(canonical)).isDirectory()) throw new TypeError('workspace must be a directory')
  if (resolve(canonical) === resolve(canonical, '..')) {
    throw new TypeError('a filesystem root is not an acceptable workspace')
  }
  return canonical
}

async function checkedWriteWorkspace(workspace, isolatedRoot) {
  if (typeof isolatedRoot !== 'string' || !isAbsolute(isolatedRoot)) {
    throw new TypeError('workspace-write requires a trusted absolute isolatedRoot')
  }
  const root = await checkedWorkspace(isolatedRoot)
  if (!inside(root, workspace)) {
    throw new TypeError('workspace-write is allowed only inside isolatedRoot')
  }
}

function checkedMode(mode) {
  if (mode !== 'read-only' && mode !== 'workspace-write') {
    throw new TypeError('mode must be read-only or workspace-write')
  }
  return mode
}

function checkedTask(task) {
  if (typeof task !== 'string' || !task.trim() || task.includes('\0') || Buffer.byteLength(task, 'utf8') > MAX_TASK_BYTES) {
    throw new TypeError(`task must be nonempty text of at most ${MAX_TASK_BYTES} UTF-8 bytes`)
  }
  return task
}

function checkedModel(modelId) {
  if (modelId === undefined || modelId === null || modelId === '') return null
  if (typeof modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(modelId)) {
    throw new TypeError('modelId must be a bounded model identifier')
  }
  return modelId
}

function checkedTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}`)
  }
  return timeoutMs
}

/** API-key variables removed when a run must use the CLI's own subscription login. */
const API_KEY_VARIABLES = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'KIMI_API_KEY',
  'MOONSHOT_API_KEY', 'MINIMAX_API_KEY', 'MIMO_API_KEY', 'XAI_API_KEY', 'ZAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'])

export function executionEnvironment(toolId, { sessionOnly = false, env: source = process.env } = {}) {
  const vendorKeys = {
    'claude-code': ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR'],
    codex: ['CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_HOME'],
    'kimi-code': ['KIMI_CODE_HOME', 'KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    'minimax-code': ['MINIMAX_API_KEY', 'MINIMAX_BASE_URL'],
    'mimo-code': ['MIMO_API_KEY'],
    'grok-build': ['XAI_API_KEY', 'GROK_HOME'],
    zcode: ['ZCODE_DATA_BASE_DIR', 'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE', 'ZCODE_STORAGE_DIR',
      'ZCODE_SESSION_DB_PATH', 'ZCODE_LOG_DIR', 'ZCODE_HTTP_PROXY', 'ZCODE_NO_PROXY', 'ZCODE_AGENT_CA_CERT'],
  }
  const keys = [...ENVIRONMENT_KEYS, ...(vendorKeys[toolId] ?? [])]
    .filter(key => !sessionOnly || !API_KEY_VARIABLES.includes(key))
  const env = {}
  for (const key of keys) {
    if (source[key] !== undefined) env[key] = source[key]
  }
  return env
}

function pathDirectories() {
  const value = process.env.PATH ?? process.env.Path ?? ''
  return [...new Set(value.split(delimiter).map(part => part.trim().replace(/^"|"$/g, '')).filter(Boolean))]
}

/** The configured install location is authoritative even if another copy is newer. */
export function officialToolEntrySelection(toolId, { preferences = installPreferences(), plan: selectedPlan, preferredDirs } = {}) {
  const tool = getOfficialTool(toolId)
  if (!tool) return { directories: pathDirectories(), plan: null, configured: false }
  // A saved script choice stays usable after future script installs are
  // disabled. Automatic selection still follows the same switch as installation.
  const selectedScript = installMethodFor(tool, preferences.methods?.[toolId])?.kind === 'script'
  const discoveryPreferences = selectedScript ? { ...preferences, allowScriptInstall: true } : preferences
  const plan = selectedPlan ?? resolveInstallPlan(tool, undefined, discoveryPreferences, currentInstallOptions())
  const preferred = preferredDirs ?? (selectedPlan ? (selectedPlan.binDir ? [selectedPlan.binDir] : [])
    : preferredToolDirectories(toolId, discoveryPreferences))
  return { directories: Array.isArray(preferredDirs) || preferred.length ? [...preferred] : pathDirectories(), plan,
    configured: Boolean(selectedPlan) || usesConfiguredInstallPlan(toolId, preferences),
    preferred: Array.isArray(preferredDirs) || preferred.length > 0, directoryOverride: Array.isArray(preferredDirs) }
}

function versionAtLeast(value, minimum) {
  const found = /^(\d+)\.(\d+)\.(\d+)(?:$|-)/.exec(String(value ?? ''))
  if (!found) return false
  for (let index = 0; index < 3; index += 1) {
    const difference = Number(found[index + 1]) - minimum[index]
    if (difference !== 0) return difference > 0
  }
  return true
}

/** Relative bin path inside a package. Reject `..` and empty segments. */
export function normalizeRelativeBin(value) {
  const text = String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!text || text.split('/').some(part => part === '' || part === '..')) return ''
  return text
}

/**
 * Official entry files to try, declared bin first. `./dist/main.mjs` matches
 * the pinned `dist/main.mjs`. A package whose bin moved still resolves when
 * the file stays inside that package.
 */
export function packageBinCandidates(binField, binName, expectedBin) {
  const declared = normalizeRelativeBin(binField && typeof binField === 'object' ? binField[binName] : binField)
  const expected = normalizeRelativeBin(expectedBin)
  return [...new Set([declared, expected].filter(Boolean))]
}

async function readPackageEntry(packageDirectory, packageName, binName, expectedBin, workspace, seen) {
  try {
    const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
    if (manifest.name !== packageName) return null
    const packageRoot = await realpath(packageDirectory)
    if (packageRoot === workspace || inside(workspace, packageRoot) || seen.has(packageRoot)) return null
    for (const relativeBin of packageBinCandidates(manifest.bin, binName, expectedBin)) {
      try {
        const entry = await realpath(join(packageRoot, relativeBin))
        if (!inside(packageRoot, entry) || !(await stat(entry)).isFile()) continue
        seen.add(packageRoot)
        return { entry, packageRoot, version: manifest.version, source: 'verified-npm-package' }
      } catch { /* try the package's other bin candidate */ }
    }
  } catch { /* this directory is not the requested package */ }
  return null
}

/** Resolve the package's real `bin` file, never its Windows .cmd shim. */
export async function findGlobalPackageEntries(packageName, binName, expectedBin, workspace, { directories, manager = null, moduleRoots, selection: selectedSelection } = {}) {
  const tool = OFFICIAL_TOOLS.find(item => item.package === packageName)
  const selection = selectedSelection ?? (directories || Array.isArray(moduleRoots) ? null : officialToolEntrySelection(tool?.id))
  const exactRoots = Array.isArray(moduleRoots) ? moduleRoots : selection?.plan?.packageModuleRoots
  if (!Array.isArray(exactRoots) && !directories && !selection?.preferred) await ensureNpmPrefixOnPath()
  const targets = directories ?? (selection?.preferred ? selection.directories : pathDirectories())
  const selectedManager = manager ?? selection?.plan?.manager ?? null
  const packageParts = packageName.split('/')
  const found = []
  const seen = new Set()
  const roots = Array.isArray(exactRoots) ? exactRoots : await installedModuleRoots(targets, { manager: selectedManager })
  const candidates = roots.map(modules => join(modules, ...packageParts))
  // Native npm installs can put their package/bin directory directly on PATH.
  if (!Array.isArray(exactRoots) && selectedManager !== 'pnpm') candidates.push(...targets.flatMap(directory => [directory, resolve(directory, '..')]))
  for (const packageDirectory of candidates) {
    const entry = await readPackageEntry(packageDirectory, packageName, binName, expectedBin, workspace, seen)
    if (entry) found.push(entry)
  }
  return found
}

/** Official Windows repairs use a distinct directory key for the same npm version. */
export function miniMaxReleaseVersion(releaseKey) {
  const repair = /^(\d{1,6}\.\d{1,6}\.\d{1,6})-repair-[1-9]\d{0,9}-[0-9a-f]{32}$/i.exec(String(releaseKey ?? ''))
  if (repair) return repair[1]
  if (String(releaseKey ?? '').includes('-repair-')) return null
  return isReleaseVersion(releaseKey) ? releaseKey : null
}

/**
 * The official MiniMax Windows installer uses a versioned releases tree rather
 * than npm -g. Any release named by its `current` file is accepted, but every
 * code file of that release must equal the official npm tarball of the same
 * version (MiniMax does not sign its CLI, so the npm registry is the authority).
 */
export async function findManagedMiniMaxEntry(workspace,
  directories = pathDirectories().flatMap(directory => [directory, join(directory, '.minimax-code')]),
  attestor = npmAttestor) {
  if (!IS_WINDOWS) return null
  for (const directory of directories) {
    try {
      const root = await realpath(directory)
      if (root === workspace || inside(workspace, root)) continue
      if (!(await stat(join(root, 'mcode.cmd'))).isFile()) continue
      const releaseKey = (await readFile(join(root, 'current'), 'utf8')).trim()
      const version = miniMaxReleaseVersion(releaseKey)
      if (!version) continue
      const releasesRoot = await realpath(join(root, 'releases'))
      if (!inside(root, releasesRoot)) continue
      const releaseRoot = await realpath(join(releasesRoot, releaseKey))
      if (!inside(releasesRoot, releaseRoot)) continue
      const packageRoot = await realpath(join(releaseRoot, 'node_modules', '@minimax-ai', 'code'))
      if (!inside(releaseRoot, packageRoot)) continue
      const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      if (manifest.name !== '@minimax-ai/code' || manifest.version !== version
        || String(manifest.bin?.mcode).replace(/^\.\//, '') !== 'cli.js') continue
      const entry = await realpath(join(packageRoot, 'cli.js'))
      if (!inside(packageRoot, entry) || !(await stat(entry)).isFile()) continue
      const attested = await attestor.matchesPackage(packageRoot, '@minimax-ai/code', version)
      if (!attested.ok) continue
      const native = await realpath(join(packageRoot, 'node_modules', 'better-sqlite3',
        'build', 'Release', 'better_sqlite3.node'))
      if (!inside(packageRoot, native) || !(await stat(native)).isFile()) continue
      return { entry, packageRoot, version, installDir: root, binDir: root, source: 'official-windows-installer-npm-attested' }
    } catch { /* inspect the next PATH directory */ }
  }
  return null
}

/** Newest installed copy first; versions are not pinned. */
function newestFirst(entries) {
  return [...entries].sort((left, right) => (compareReleaseVersions(right.version, left.version) ?? 0))
}

/** Native launches cannot trust unsigned npm code or a locally changed bin map. */
async function attestNativeNpmEntry(found, tool, selectionOptions) {
  if (selectionOptions.executionEnvironment !== 'cli-native') return found
  const attestor = selectionOptions.attestor ?? npmAttestor
  try {
    const include = new RegExp(`${CODE_FILE.source}|(?:^|/)package\\.json$`, 'i')
    const checked = await attestor.matchesPackage(found.packageRoot, tool.package, found.version, include)
    if (!checked.ok) return { unsupported: `${tool.label} 安装文件未通过官方 npm 摘要核验：${redactDiagnostic(checked.reason)}；拒绝启动所选副本，不改用其他安装位置。` }
    const member = relative(found.packageRoot, found.entry).split(sep).join('/')
    const entry = await attestor.matches(found.entry, tool.package, found.version, member)
    if (!entry.ok) return { unsupported: `${tool.label} 入口未通过官方 npm 摘要核验：${redactDiagnostic(entry.reason)}；拒绝启动所选副本，不改用其他安装位置。` }
    return { ...found, source: 'official-npm-registry-attested' }
  } catch (error) {
    return { unsupported: `${tool.label} 官方 npm 摘要核验不可用：${redactDiagnostic(error?.message ?? error)}；拒绝启动所选副本，不改用其他安装位置。` }
  }
}

async function findSignedNativeExecutable(toolId, workspace, signer, selection = officialToolEntrySelection(toolId)) {
  if (!selection.preferred) await ensureNpmPrefixOnPath()
  const command = toolId === 'claude-code' ? 'claude' : toolId
  const filename = IS_WINDOWS ? `${command}.exe` : command
  for (const directory of selection.preferred ? selection.directories : pathDirectories()) {
    try {
      const pathRoot = await realpath(directory)
      if (pathRoot === workspace || inside(workspace, pathRoot)) continue
      const entry = await realpath(join(directory, filename))
      if (inside(workspace, entry) || !(await stat(entry)).isFile()) continue
      await access(entry, IS_WINDOWS ? constants.F_OK : constants.X_OK)
      if (IS_WINDOWS && !(await hasOfficialWindowsSignature(entry, signer))) continue
      return { entry, source: IS_WINDOWS ? 'signed-native-executable' : 'path-native-executable' }
    } catch { /* try the next PATH entry */ }
  }
  return null
}

function nodeVersion(entry, pattern = /^v(\d+\.\d+\.\d+)/) {
  return new Promise(resolveVersion => {
    let child
    try { child = spawn(entry, ['--version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }) }
    catch { resolveVersion(null); return }
    let output = ''
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveVersion(value)
    }
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(null) }, 4_000)
    child.stdout.on('data', bytes => { output = tail(output, String(bytes)) })
    child.on('error', () => finish(null))
    child.on('close', code => finish(code === 0 ? pattern.exec(output.trim())?.[1] ?? null : null))
  })
}

export async function findNodeExecutable(workspace, minimum = [22, 19, 0], acceptedVersion = () => true) {
  await ensureNpmPrefixOnPath()
  const candidates = [process.execPath, ...pathDirectories().map(directory => join(directory, IS_WINDOWS ? 'node.exe' : 'node'))]
  for (const candidate of candidates) {
    if (basename(candidate).toLowerCase() !== (IS_WINDOWS ? 'node.exe' : 'node')) continue
    try {
      const entry = await realpath(candidate)
      if (inside(workspace, entry) || !(await stat(entry)).isFile()) continue
      await access(entry, IS_WINDOWS ? constants.F_OK : constants.X_OK)
      if (IS_WINDOWS && !(await hasOfficialWindowsSignature(entry, 'OpenJS Foundation'))) continue
      const version = await nodeVersion(entry)
      if (!versionAtLeast(version, minimum) || !acceptedVersion(version)) continue
      return entry
    } catch { /* inspect next candidate */ }
  }
  return null
}

/** Resolve the signed native binary carried by the official npm wrapper. */
export async function findSignedPackagedCodex(packageRoot, workspace, {
  installDir = '', manager = null, moduleRoots = [], verifySignature = hasOfficialWindowsSignature,
} = {}) {
  if (!IS_WINDOWS) return null
  const target = process.arch === 'arm64' ? ['codex-win32-arm64', 'aarch64-pc-windows-msvc']
    : process.arch === 'x64' ? ['codex-win32-x64', 'x86_64-pc-windows-msvc'] : null
  if (!target) return null
  try {
    const wrapperRoot = await realpath(packageRoot)
    if (wrapperRoot === workspace || inside(workspace, wrapperRoot)) return null
    const wrapper = JSON.parse(await readFile(join(wrapperRoot, 'package.json'), 'utf8'))
    const nativeName = `@openai/${target[0]}`
    const dependency = wrapper.optionalDependencies?.[nativeName]
    const alias = /^npm:(@openai\/[A-Za-z0-9-]+)@(.+)$/.exec(String(dependency ?? ''))
    const expectedName = alias ? alias[1] : nativeName
    const expectedVersion = alias ? alias[2] : dependency
    if (wrapper.name !== '@openai/codex' || !isReleaseVersion(wrapper.version)
      || !['@openai/codex', nativeName].includes(expectedName) || !isReleaseVersion(expectedVersion)) return null
    let virtualStore = null
    for (let directory = wrapperRoot; directory !== resolve(directory, '..'); directory = resolve(directory, '..')) {
      if (basename(directory) === '.pnpm') { virtualStore = directory; break }
    }
    // pnpm's optional platform package is a sibling symlink in its virtual
    // store. A configured prefix confines both wrapper and native package to
    // that prefix's global tree, never another store or arbitrary directory.
    const boundary = manager === 'pnpm' && installDir
      ? await realpath(join(installDir, '.pnpm', 'global'))
      : virtualStore ?? await realpath(resolve(wrapperRoot, '..', '..'))
    if (!inside(boundary, wrapperRoot)) return null
    const nativePackages = [
      join(wrapperRoot, 'node_modules', '@openai', target[0]),
      resolve(wrapperRoot, '..', target[0]),
      ...moduleRoots.map(modules => join(modules, '@openai', target[0])),
    ]
    for (const nativePackage of nativePackages) {
      try {
        const nativeRoot = await realpath(nativePackage)
        if (!inside(boundary, nativeRoot) || inside(workspace, nativeRoot)) continue
        const manifest = JSON.parse(await readFile(join(nativeRoot, 'package.json'), 'utf8'))
        if (manifest.name !== expectedName || manifest.version !== expectedVersion) continue
        const entry = await realpath(join(nativeRoot, 'vendor', target[1], 'bin', 'codex.exe'))
        if (!inside(nativeRoot, entry) || inside(workspace, entry) || !(await stat(entry)).isFile()) continue
        if (!(await verifySignature(entry, CODEX_SIGNER))) continue
        return { entry, source: 'signed-official-npm-native' }
      } catch { /* try the wrapper's other official optional-package location */ }
    }
    return null
  } catch { return null }
}

/**
 * Publisher-only acceptance: a valid Authenticode signature whose signer is the
 * vendor. No version or file hash is involved, so newer releases are accepted.
 */
export function signatureAccepted(signature, expectedSigner) {
  return signature?.status === 'Valid' && typeof expectedSigner === 'string' && expectedSigner.length > 0
    && String(signature.subject ?? '').includes(expectedSigner)
}

export const OFFICIAL_SIGNERS = Object.freeze({ codex: CODEX_SIGNER, 'claude-code': CLAUDE_SIGNER })

/** PATH or package metadata alone is insufficient: verify the Windows EXE publisher. */
function hasOfficialWindowsSignature(entry, expectedSigner) {
  // Some launch environments inherit a PowerShell module path where the
  // built-in Security module does not autoload. Import its fixed system path
  // explicitly, and fail closed if that import or the signature check fails.
  const modulePath = join(WINDOWS_SYSTEM32, 'WindowsPowerShell', 'v1.0', 'Modules',
    'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Security.psd1')
  const script = '$ErrorActionPreference="Stop"; '
    + 'Import-Module -Name $env:MODEL_ROUTER_SECURITY_MODULE -ErrorAction Stop; '
    + '$s=Get-AuthenticodeSignature -LiteralPath $env:MODEL_ROUTER_VERIFY_PATH; '
    + '@{status=[string]$s.Status;subject=[string]$s.SignerCertificate.Subject} | ConvertTo-Json -Compress'
  const powershell = join(WINDOWS_SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise(resolveSignature => {
    let child
    try {
      child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, MODEL_ROUTER_VERIFY_PATH: entry,
          MODEL_ROUTER_SECURITY_MODULE: modulePath },
      })
    } catch { resolveSignature(false); return }
    let output = ''
    let done = false
    const settle = valid => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveSignature(valid)
    }
    const timer = setTimeout(() => { child.kill('SIGTERM'); settle(false) }, 8_000)
    child.stdout.on('data', bytes => { output = tail(output, String(bytes)).slice(-4_096) })
    child.on('error', () => settle(false))
    child.on('close', code => {
      if (code !== 0) { settle(false); return }
      try {
        const signature = JSON.parse(output.trim().replace(/^\uFEFF/, ''))
        settle(signatureAccepted(signature, expectedSigner))
      } catch { settle(false) }
    })
  })
}

async function launchSpec(toolId, workspace, mode, modelId, task = 'Check readiness.', selectionOptions = {}) {
  if (toolId === 'claude-code') {
    const selection = officialToolEntrySelection(toolId, selectionOptions)
    const native = selection.plan.kind === 'script'
      ? await findSignedNativeExecutable(toolId, workspace, CLAUDE_SIGNER, selection) : null
    if (native) native.version = await nodeVersion(native.entry, /(?:^|\s)(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)
    const entries = selection.plan.kind === 'script' ? (native ? [native] : [])
      : await findGlobalPackageEntries('@anthropic-ai/claude-code', 'claude', 'bin/claude.exe', workspace, { selection })
    const compatible = entries.filter(entry => versionAtLeast(entry.version, CLAUDE_MIN_RESTRICTED_VERSION))
    let found = null
    for (const entry of compatible) {
      if (entry === native || !IS_WINDOWS || await hasOfficialWindowsSignature(entry.entry, CLAUDE_SIGNER)) {
        found = entry
        break
      }
    }
    if (!found) return { unsupported: compatible.length > 0
      ? '未找到具有有效 Anthropic 签名的 claude.exe。'
      : entries.length > 0 ? 'Claude Code 版本过旧，受限执行所需参数要求 >= 2.1.259。'
        : '未找到官方 @anthropic-ai/claude-code 包的原生 claude.exe；不会调用 .cmd 包装器。' }
    return {
      file: found.entry,
      args: [
        '--no-session-persistence',
        ...(mode === 'read-only' ? [
          '--restricted', '--disable-slash-commands', '--strict-mcp-config',
          '--tools', 'Read,Glob,Grep', '--disallowedTools', 'mcp__*',
        ] : []),
        '--permission-mode', mode === 'workspace-write' ? 'bypassPermissions' : 'dontAsk',
        ...(modelId ? ['--model', modelId] : []),
        '-p', '--output-format', 'json',
        mode === 'workspace-write'
          ? 'Carry out the task supplied on standard input. Work inside this isolated Git workspace. You may use your normal official tools, including shell, skills and configured MCP. Report what changed, commands run, and what still needs verification.'
          : 'Read the task supplied on standard input. Analyze the workspace without changing files and give a clear final answer.',
      ],
      format: 'claude-json',
      source: found.source,
    }
  }
  if (toolId === 'codex') {
    if (!IS_WINDOWS) return { unsupported: CAPABILITIES.codex.reason }
    const selection = officialToolEntrySelection(toolId, selectionOptions)
    const packages = selection.plan.kind === 'script' ? []
      : await findGlobalPackageEntries('@openai/codex', 'codex', 'bin/codex.js', workspace, { selection })
    const moduleRoots = selection.plan.packageModuleRoots ?? (packages.length
      ? await installedModuleRoots(selection.preferred ? selection.directories : pathDirectories(), { manager: selection.plan.manager }) : [])
    let found = null
    for (const entry of packages) {
      found = await findSignedPackagedCodex(entry.packageRoot, workspace,
        { installDir: selection.plan.installDir, manager: selection.plan.manager, moduleRoots })
      if (found) break
    }
    if (!found && selection.plan.kind === 'script') {
      found = await findSignedNativeExecutable(toolId, workspace, CODEX_SIGNER, selection)
    }
    if (!found) return { unsupported: '未找到具有 OpenAI 有效签名的 codex.exe。' }
    return {
      file: found.entry,
      args: codexExecArgs(mode, modelId),
      format: 'codex-jsonl',
      source: found.source,
    }
  }
  if (toolId === 'kimi-code') {
    const selection = officialToolEntrySelection(toolId, selectionOptions)
    if (selection.plan.kind === 'script') return { unsupported: '所选 Kimi 原生脚本安装没有可核验的 npm 执行入口；不会改用其他安装目录中的 Kimi。' }
    const tool = getOfficialTool(toolId)
    const entries = await findGlobalPackageEntries(tool.package, 'kimi', 'dist/main.mjs', workspace, { selection })
    let found = newestFirst(entries)[0]
    if (!found) return { unsupported: `未找到官方 npm 包 ${tool.package} 的 kimi 入口（dist/main.mjs）。` }
    found = await attestNativeNpmEntry(found, tool, selectionOptions)
    if (found.unsupported) return found
    const nodeExecutable = await findNodeExecutable(workspace)
    if (!nodeExecutable) return { unsupported: '未找到工作区外的 Node.js 可执行文件。' }
    if (Buffer.byteLength(task, 'utf8') > 16_000) {
      return { unsupported: 'Kimi 单次 -p 参数超过 16 KB；请先拆分任务。' }
    }
    return {
      file: nodeExecutable,
      args: [found.entry, ...(modelId ? ['--model', modelId] : []),
        '--prompt', task, '--output-format', 'stream-json'],
      format: 'kimi-stream-json', source: found.source, stdinTask: false,
    }
  }
  if (toolId === 'minimax-code') {
    const tool = getOfficialTool(toolId)
    const selection = officialToolEntrySelection(toolId, selectionOptions)
    const managed = selection.plan.kind === 'script' || selection.directoryOverride
      ? await findManagedMiniMaxEntry(workspace, selection.directories)
      : !selection.configured ? await findManagedMiniMaxEntry(workspace) : null
    const entries = selection.plan.kind === 'script' ? [] : await findGlobalPackageEntries(tool.package, 'mcode', 'cli.js', workspace, { selection })
    let found = managed ?? newestFirst(entries)[0]
    if (!found) return { unsupported: `未找到官方 npm 包 ${tool.package} 的 mcode 入口（cli.js）。` }
    // Managed Windows releases were already attested while resolving them.
    if (!managed) found = await attestNativeNpmEntry(found, tool, selectionOptions)
    if (found.unsupported) return found
    const nodeExecutable = await findNodeExecutable(workspace, [22, 19, 0], version => {
      const major = Number(String(version).split('.')[0])
      return major === 22 || (major >= 24 && major < 27)
    })
    if (!nodeExecutable) return { unsupported: '未找到工作区外的 Node.js 可执行文件。' }
    if (modelId && !modelId.includes('/')) {
      return { unsupported: 'MiniMax CLI 要求 provider/model；当前模型目录 ID 不能直接传入，请在 MiniMax 中配置别名。' }
    }
    return { ...buildMiniMaxInvocation({
      nodeExecutable, cliEntry: found.entry, workspace, mode,
      modelReference: modelId, permission: mode === 'workspace-write' ? 'full' : 'smart',
    }), source: found.source }
  }
  if (toolId === 'mimo-code' || toolId === 'grok-build') {
    try {
      const selection = officialToolEntrySelection(toolId, selectionOptions)
      if (selection.plan.kind === 'script') return { unsupported: `所选 ${getOfficialTool(toolId).label} 原生脚本安装没有可核验的 npm 元数据；不会改用其他安装目录中的工具。` }
      return await resolveMiMoGrokLaunch({ toolId, workspace, mode, modelId, task,
        directories: selection.preferred ? selection.directories : undefined,
        moduleRoots: selection.plan.packageModuleRoots,
        manager: selection.plan.manager })
    } catch (error) {
      return { unsupported: `官方原生入口校验失败：${String(error?.message ?? error).slice(0, 240)}` }
    }
  }
  if (toolId === 'zcode') {
    const selection = officialToolEntrySelection(toolId, selectionOptions)
    if (selection.plan.kind === 'package-manager') {
      try {
        const tool = getOfficialTool(toolId)
        const plan = selection.plan.installDir || Array.isArray(selection.plan.packageModuleRoots) ? selection.plan
          : await resolvePackageJobPlan(tool, selection.plan, selectionOptions.preferences ?? installPreferences())
        const bound = { ...selection, plan, preferred: true, directories: plan.binDir ? [plan.binDir] : selection.directories }
        const moduleRoots = plan.packageModuleRoots ?? [IS_WINDOWS ? join(plan.installDir, 'node_modules') : join(plan.installDir, 'lib', 'node_modules')]
        const entries = await findGlobalPackageEntries(tool.package, 'zcode', 'bin/zcode.mjs', workspace, { selection: bound, moduleRoots })
        const entry = newestFirst(entries)[0]
        if (!entry) return { unsupported: '未在所选 npm 安装目录中找到 @ljwei-stak/zcode-cli；请安装或修复该方式，不会改用 GitHub 安装副本。' }
        const bundle = await resolveZCodeNpmBundle(entry)
        return resolveZCodeLaunch(workspace, mode, task, { modelId, discoverBundle: async () => bundle })
      } catch (error) {
        return { unsupported: `ZCode CLI npm 入口核验失败：${redactDiagnostic(error?.message ?? error).slice(0, 240)}` }
      }
    }
    return resolveZCodeLaunch(workspace, mode, task, { installDir: selection.plan.installDir, modelId })
  }
  return { unsupported: CAPABILITIES[toolId]?.reason ?? '此官方工具尚无已核验的安全执行适配器。' }
}

/** Launch the verified standalone distribution; never use a desktop or PATH shim. */
export async function resolveZCodeLaunch(workspace, mode, task, {
  installDir, modelId = null, discoverBundle = discoverZCodeBundle, findNode = findNodeExecutable,
} = {}) {
  const found = await discoverBundle({ installDir })
  if (!found) return { unsupported: '未找到通过 GitHub Release SHA256 核验的 ZCode CLI；请在官方工具中安装或修复。' }
  if (inside(workspace, found.cliEntry) || resolve(workspace) === resolve(found.root)) {
    return { unsupported: 'ZCode CLI 的执行入口必须位于任务工作区之外。' }
  }
  const nodeExecutable = await findNode(workspace, [24, 14, 0], version =>
    Number(String(version).split('.')[0]) === 24)
  if (!nodeExecutable) return { unsupported: 'ZCode CLI 需要工作区外的 Node.js 24.14.0 或更新的 Node 24。' }
  if (Buffer.byteLength(task, 'utf8') > 16_000) {
    return { unsupported: 'ZCode 单次 --prompt 参数超过 16 KB；请先拆分任务。' }
  }
  return {
    file: nodeExecutable,
    args: [found.cliEntry, '--prompt', task, '--cwd', workspace,
      '--mode', mode === 'workspace-write' ? 'yolo' : 'plan', '--workflow-mode', 'disabled',
      '--disallowed-tools', 'AskUserQuestion EnterPlanMode ExitPlanMode', '--output-format', 'stream-json', '--no-color'],
    format: 'zcode-stream-json', source: found.source, stdinTask: false,
    requestedModel: null,
    modelNotice: modelId
      ? 'ZCode CLI 没有 --model 参数；本次使用其已配置的默认模型，不能保证与 Harness 建议模型一致。'
      : '本次使用 ZCode CLI 已配置的默认模型。',
  }
}

/**
 * Codex `exec` argv for the signed runner. `--skip-git-repo-check` is required:
 * without it Codex refuses any workspace that is not a Git repository or a
 * directory trusted in the user's config ("Not inside a trusted directory and
 * --skip-git-repo-check was not specified.", exit 1). The workbench lets the user
 * pick any absolute directory, and read-only runs are still confined by
 * `--sandbox read-only` and the Harness process sandbox; write runs use an
 * isolated Git worktree, so the flag changes nothing there.
 */
export function codexExecArgs(mode, modelId = null) {
  return [
    '--ask-for-approval', 'never', 'exec', '--skip-git-repo-check',
    ...(modelId ? ['--model', modelId] : []),
    '--sandbox', mode, '--json', '-',
  ]
}

/** Failure text when Codex exits without a successful turn; names the cause when it is known. */
export function codexIncompleteError(eventCount, stderr = '') {
  const text = String(stderr ?? '')
  if (/not inside a trusted directory/i.test(text)) {
    return 'Codex 拒绝在非 Git 仓库/未信任目录中运行（Not inside a trusted directory）。'
  }
  if (!eventCount) {
    const last = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).at(-1)
    return `Codex 未输出任何 JSON 事件就退出了（未开始回合，没有调用模型）。${last ? `CLI 输出：${last.slice(0, 300)}` : '未收到 CLI 输出。'}`
  }
  return 'Codex 未返回完整成功终态和回答。'
}

/**
 * Extra environment the Harness sandbox runner itself needs. On Desktop the
 * runner prefix is `[process.execPath, …/runner.js]` and process.execPath is
 * the Electron app (DeepSeek Harness.exe). Harness starts such Node-mode
 * children with ELECTRON_RUN_AS_NODE=1; without it the executable boots the
 * GUI, loses the single-instance lock and exits 0 with no output, so the
 * wrapped CLI never runs. The minimal CLI environment must therefore carry it
 * whenever the confined argv starts with this Electron executable.
 */
export function runnerEnvironment(argv0, { execPath = process.execPath, electron = process.versions?.electron, platform = process.platform } = {}) {
  if (!electron || typeof argv0 !== 'string' || typeof execPath !== 'string') return {}
  const normalize = value => {
    const resolved = resolve(value)
    return platform === 'win32' ? resolved.replace(/\//g, '\\').toLowerCase() : resolved
  }
  return normalize(argv0) === normalize(execPath) ? { ELECTRON_RUN_AS_NODE: '1' } : {}
}

/**
 * Codex's native read-only mode still needs its own state writable. Keep its
 * existing home (auth, config, skills, MCP and token refresh) under the outer
 * ACL boundary, while giving the project no write SID. No credential cloning
 * or home relocation is needed. The current one-root SDK cannot also grant
 * an independent Git worktree, so editable Codex runs fail closed.
 */
export function harnessSandboxBlocker(toolId, platform = process.platform, mode = 'read-only') {
  if (toolId === 'codex' && platform === 'win32' && mode !== 'read-only') return CODEX_WRITE_UNSUPPORTED
  return null
}

/** The only outer writable root is the user's exact, existing Codex home. */
export async function codexReadOnlyPolicy(workspace, home = process.env.CODEX_HOME ?? join(homedir(), '.codex')) {
  const project = await checkedWorkspace(workspace)
  const stateHome = await checkedWorkspace(home)
  if (project === stateHome || inside(project, stateHome) || inside(stateHome, project)) {
    throw new TypeError('Codex 的 CODEX_HOME 与项目工作区必须互不包含；拒绝向只读项目授予写权限。')
  }
  return { mode: 'workspace-write', workspaceRoot: stateHome }
}

/** Require the reviewed Windows ACL runner to preserve the exact argv/policy. */
export function codexStateSandboxContract(confined, requestedArgv, policy) {
  const argv = confined?.argv
  if (!Array.isArray(argv) || !argv.every(value => typeof value === 'string')) return false
  const boundary = argv.indexOf('--')
  if (boundary < 2 || argv.length - boundary - 1 !== requestedArgv.length
    || requestedArgv.some((value, index) => argv[boundary + 1 + index] !== value)) return false
  const runnerIndex = argv.findIndex(value => /(?:^|[\\/])@deepseek-ai[\\/]dsh-sandbox-windows-acl[\\/]lib[\\/]runner\.js$/i.test(value))
  if (runnerIndex < 1 || runnerIndex >= boundary) return false
  const flags = new Map()
  for (let index = runnerIndex + 1; index < boundary; index += 2) {
    const key = argv[index]
    if (!['--workspace', '--temp', '--mode', '--write-sid', '--temp-write-sid'].includes(key)
      || flags.has(key) || index + 1 >= boundary) return false
    flags.set(key, argv[index + 1])
  }
  return policy.mode === 'workspace-write' && flags.get('--mode') === policy.mode
    && flags.get('--workspace') === policy.workspaceRoot && isAbsolute(flags.get('--temp') ?? '')
    && flags.has('--write-sid') === flags.has('--temp-write-sid')
}

/** Check the actual trusted launch entry without starting an account call. */
export async function officialToolReadiness(toolId, workspace = process.cwd(), selectionOptions = {}) {
  const tool = getOfficialTool(toolId)
  if (!tool) return { id: String(toolId), supported: false, ready: false, readyModes: [], reason: '工具不在固定官方注册表中。' }
  const environment = selectionOptions.executionEnvironment ?? 'harness'
  if (!['harness', 'cli-native'].includes(environment)) throw new TypeError('unknown CLI execution environment')
  const capability = officialToolExecutionCapabilities({ executionEnvironment: environment }).find(item => item.id === tool.id)
  if (!capability?.supported) return { id: tool.id, supported: false, ready: false, readyModes: [], reason: capability?.reason ?? '当前平台不支持托管执行。' }
  try {
    const directory = await checkedWorkspace(workspace)
    if (tool.id === 'codex' && environment === 'harness') await codexReadOnlyPolicy(directory)
    const spec = await launchSpec(tool.id, directory, capability.modes[0], null, undefined, selectionOptions)
    return spec.unsupported
      ? { id: tool.id, supported: true, ready: false, readyModes: [], reason: spec.unsupported }
      : { id: tool.id, supported: true, ready: true, source: spec.source, modes: capability.modes,
        readyModes: capability.modes,
        ...(tool.id === 'codex' && environment === 'harness' ? { runtimeState: 'existing-codex-home',
          executionRequirements: ['harness-windows-acl', 'codex-home-state-write'],
          modeReasons: { 'workspace-write': CODEX_WRITE_UNSUPPORTED } } : {}) }
  } catch (error) {
    return { id: tool.id, supported: true, ready: false, readyModes: [], reason: String(error?.message ?? error).slice(0, 300) }
  }
}

function tail(current, addition) {
  const next = current + addition
  return next.length > OUTPUT_TAIL_CHARS ? next.slice(-OUTPUT_TAIL_CHARS) : next
}

function stopProcessTree(child) {
  if (child.pid === undefined) return null
  if (IS_WINDOWS) {
    try {
      const killer = spawn(join(WINDOWS_SYSTEM32, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
        shell: false, windowsHide: true, stdio: 'ignore',
      })
      killer.on('error', () => { try { child.kill('SIGTERM') } catch { /* gone */ } })
      killer.on('close', code => {
        if (code !== 0) try { child.kill('SIGTERM') } catch { /* gone */ }
      })
    } catch { try { child.kill('SIGTERM') } catch { /* gone */ } }
    return null
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* gone */ } }
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ }
    }, 2_000)
    return timer
  }
}

/** Parse the complete Claude terminal JSON even when its process exits nonzero. */
export function parseClaudeProcessOutput(stdout, exitCode, { secrets = [] } = {}) {
  let result
  try { result = JSON.parse(stdout) } catch {
    return { status: 'failed', exitCode, error: 'Claude 未返回有效的结果 JSON。' }
  }
  const validResult = result && typeof result === 'object' && !Array.isArray(result)
    && result.type === 'result'
    && (result.is_error === undefined || typeof result.is_error === 'boolean')
  const succeeded = validResult && result.subtype === 'success' && result.is_error !== true
    && typeof result.result === 'string' && result.result.trim().length > 0
  const failed = validResult && (result.is_error === true
    || (typeof result.subtype === 'string' && /^error(?:_|$)/.test(result.subtype)))
  const evidence = {}
  // A parsed object or a partial usage map does not establish zero usage. Only
  // a recognizable terminal result with both required counters can report it.
  if (succeeded || failed) {
    const usage = result.usage
    const validCount = value => Number.isSafeInteger(value) && value >= 0
    if (usage && typeof usage === 'object' && !Array.isArray(usage)
      && validCount(usage.input_tokens) && validCount(usage.output_tokens)
      && ['cache_read_input_tokens', 'cache_creation_input_tokens']
        .every(key => usage[key] === undefined || validCount(usage[key]))) {
      const reported = usageFromOutput('claude-json', stdout)
      if (reported?.usage) evidence.usage = reported.usage
      if (reported?.reportedModel) evidence.reportedModel = reported.reportedModel
    }
    if (Number.isFinite(result.total_cost_usd) && result.total_cost_usd >= 0) {
      evidence.reportedCostUsd = result.total_cost_usd
    }
  }
  if (exitCode === 0 && succeeded) {
    return { status: 'succeeded', exitCode, terminalEvent: 'completed', finalText: result.result, ...evidence }
  }
  const message = value => typeof value === 'string' ? value
    : typeof value?.message === 'string' ? value.message
      : typeof value?.error === 'string' ? value.error
        : typeof value?.error?.message === 'string' ? value.error.message : ''
  const details = validResult ? [
    ...(Array.isArray(result.errors) ? result.errors.slice(0, 32).map(message) : []),
    message(result.error),
    typeof result.result === 'string' ? result.result : '',
  ].filter(value => value.trim()) : []
  let detail = [...new Set(details)].join(' | ')
  for (const secret of Array.isArray(secrets) ? secrets : []) {
    if (typeof secret === 'string' && secret) detail = detail.split(secret).join('[redacted]')
  }
  detail = redactDiagnostic(detail, '', 2_000)
  const error = exitCode !== 0 ? '官方 CLI 退出码非零。' : 'Claude 未返回成功终态。'
  return { status: 'failed', exitCode, ...(failed ? { terminalEvent: 'failed' } : {}),
    error: detail ? `${error}${detail}` : error, ...(detail ? { detail } : {}), ...evidence }
}

const tokenCount = value => Number.isSafeInteger(value) && value >= 0
const usageObject = value => value && typeof value === 'object' && !Array.isArray(value)
const validCounts = (value, required, optional = []) => usageObject(value)
  && required.every(key => tokenCount(value[key]))
  && optional.every(key => value[key] === undefined || tokenCount(value[key]))

/** Accept accounting only from a complete terminal event, never a partial map. */
export function officialToolTerminalEvidence(format, value) {
  if (!usageObject(value)) return {}
  if (format === 'codex-jsonl') {
    if (value.type !== 'turn.completed' || !validCounts(value.usage,
      ['input_tokens', 'output_tokens'], ['cached_input_tokens'])
      || (value.usage.cached_input_tokens ?? 0) > value.usage.input_tokens) return {}
    return usageFromOutput('codex-jsonl', JSON.stringify(value)) ?? {}
  }
  if (format === 'grok-jsonl') {
    if (value.type !== 'end' || typeof value.sessionId !== 'string' || !value.sessionId
      || typeof value.stopReason !== 'string' || !value.stopReason
      || (value.cost_is_partial !== undefined && typeof value.cost_is_partial !== 'boolean')) return {}
    const evidence = {}
    if (validCounts(value.usage, ['input_tokens', 'output_tokens'],
      ['cache_read_input_tokens', 'cache_creation_input_tokens'])) {
      evidence.usage = usageFromEvents('grok-end', value)?.usage
    }
    if (value.cost_is_partial !== true && Number.isFinite(value.total_cost_usd) && value.total_cost_usd >= 0) {
      evidence.reportedCostUsd = value.total_cost_usd
    }
    return evidence
  }
  if (format === 'mimo-jsonl') {
    const part = value.part
    if (value.type !== 'step_finish' || typeof value.sessionID !== 'string' || !value.sessionID
      || part?.type !== 'step-finish' || typeof part.reason !== 'string' || !part.reason
      || !validCounts(part.tokens, ['input', 'output'], ['reasoning'])
      || (part.tokens.cache !== undefined && !validCounts(part.tokens.cache, [], ['read', 'write']))) return {}
    return usageFromEvents('mimo-steps', [part]) ?? {}
  }
  if (format === 'minimax-stream-json') {
    // `value` is produced only by the schema/sequence/session-validating parser.
    if (!['turn.completed', 'turn.failed'].includes(value.terminalEvent)
      || !['succeeded', 'failed', 'timeout', 'cancelled', 'limit_exceeded'].includes(value.vendorStatus)
      || ['runId', 'sessionId', 'turnId'].some(key => typeof value[key] !== 'string' || !value[key])
      || value.usageSource === 'unavailable'
      || !validCounts(value.usage, ['inputTokens', 'outputTokens'],
        ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'])) return {}
    return usageFromEvents('minimax-result', value) ?? {}
  }
  return {}
}

/** Keep verified completed-turn accounting independently of process success. */
export function createOfficialToolEvidenceCollector(format) {
  let evidence = {}
  let pending = false
  let incomplete = false
  let terminalSeen = false
  let sessionId = null
  let rejected = false
  const add = next => {
    if (next.usage) {
      const previous = evidence.usage
      evidence.usage = Object.fromEntries(Object.entries(next.usage)
        .map(([key, value]) => [key, (previous?.[key] ?? 0) + value]))
    }
    if (!terminalSeen) evidence.reportedCostUsd = next.reportedCostUsd
    else if (Number.isFinite(evidence.reportedCostUsd) && Number.isFinite(next.reportedCostUsd)) {
      evidence.reportedCostUsd = Number((evidence.reportedCostUsd + next.reportedCostUsd).toFixed(8))
    } else delete evidence.reportedCostUsd
  }
  return {
    push(event) {
      if (rejected || !usageObject(event)) return
      if (format === 'codex-jsonl') {
        if (event.type === 'turn.started') pending = true
        else if (event.type === 'turn.failed') { pending = true; incomplete = true }
        else if (event.type === 'turn.completed') {
          const next = officialToolTerminalEvidence(format, event)
          if (!next.usage) { incomplete = true; return }
          if (terminalSeen && !pending) { incomplete = true; return }
          add(next)
          terminalSeen = true
          pending = false
        }
      } else if (format === 'grok-jsonl') {
        if (event.type !== 'end') return
        if (terminalSeen) { rejected = true; return }
        evidence = officialToolTerminalEvidence(format, event)
        terminalSeen = true
      } else if (format === 'mimo-jsonl') {
        if (typeof event.sessionID !== 'string' || !event.sessionID
          || (sessionId && sessionId !== event.sessionID)) { rejected = true; return }
        sessionId = event.sessionID
        if (event.type === 'step_start') pending = true
        else if (event.type === 'error') { pending = true; incomplete = true }
        else if (event.type === 'step_finish') {
          const next = officialToolTerminalEvidence(format, event)
          if (!next.usage) { incomplete = true; return }
          if (terminalSeen && !pending) { incomplete = true; return }
          add(next)
          terminalSeen = true
          pending = event.part.reason !== 'stop'
        }
      }
    },
    snapshot() {
      if (rejected) return {}
      const result = { ...evidence }
      if (pending || incomplete) {
        delete result.reportedCostUsd
        if (result.usage) result.usageIncomplete = true
      }
      return result
    },
  }
}

/** Accounting cannot change a failed, cancelled or timed-out process outcome. */
export function finalizeOfficialProcessResult(result, evidence = {}) {
  const { usage: discardedUsage, reportedCostUsd: discardedCost, usageIncomplete: discardedIncomplete, ...outcome } = result
  const usage = evidence?.usage
  if (validCounts(usage, ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'])) {
    outcome.usage = usage
    if (evidence.usageIncomplete === true) outcome.usageIncomplete = true
  }
  if (Number.isFinite(evidence?.reportedCostUsd) && evidence.reportedCostUsd >= 0) {
    outcome.reportedCostUsd = evidence.reportedCostUsd
  }
  return outcome
}

function captureProcess(spec, task, workspace, signal, timeoutMs, toolId, sessionOnly = false, extraEnv = {}) {
  return new Promise(resolveResult => {
    let child
    const childEnvironment = { ...executionEnvironment(toolId, { sessionOnly }), ...extraEnv }
    try {
      child = spawn(spec.file, spec.args, {
        cwd: workspace,
        shell: false,
        windowsHide: true,
        detached: !IS_WINDOWS,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnvironment,
      })
    } catch (error) {
      resolveResult({ status: 'failed', error: String(error?.message ?? error), exitCode: null })
      return
    }

    let finished = false
    let stopReason = null
    let stdout = ''
    let stdoutTail = ''
    let stderrTail = ''
    let outputBytes = 0
    let jsonlBuffer = ''
    let codexEvents = 0
    const accounting = createOfficialToolEvidenceCollector(spec.format)
    let terminal = null
    let failedEvent = false
    let finalText = ''
    let protocolError = null
    let zcodeResult = null
    let zcodeSession = null
    const zcodeStarted = new Set()
    const zcodeCompleted = new Set()
    const miniMaxParser = spec.format === 'minimax-stream-json' ? createMiniMaxStreamParser() : null
    const nativeParser = spec.format === 'mimo-jsonl' || spec.format === 'grok-jsonl'
      ? createMiMoGrokParser(toolId) : null
    let kimiAssistant = false
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    const readJsonlLine = line => {
      if (!line.trim()) return
      if (nativeParser) nativeParser.push(line)
      try {
        const event = JSON.parse(line)
        accounting.push(event)
        if (nativeParser) return
        if (spec.format === 'zcode-stream-json') {
          if (!event || typeof event !== 'object' || Array.isArray(event)
            || typeof event.type !== 'string' || typeof event.sessionId !== 'string'
            || !event.sessionId) {
            protocolError = 'ZCode 返回了无效事件。'
            return
          }
          if (zcodeResult) {
            protocolError = 'ZCode 在最终结果之后仍返回事件。'
            return
          }
          if (zcodeSession && zcodeSession !== event.sessionId) {
            protocolError = 'ZCode 混入了其他会话的事件。'
            return
          }
          zcodeSession = event.sessionId
          if (event.type === 'result') {
            zcodeResult = event
            return
          }
          if (event.type === 'turn.failed') failedEvent = true
          if (event.type === 'turn.started' || event.type === 'turn.completed') {
            if (typeof event.turnId !== 'string' || !event.turnId) {
              protocolError = 'ZCode 回合事件缺少 turnId。'
              return
            }
            if (event.type === 'turn.started') zcodeStarted.add(event.turnId)
            else if (event.payload?.resultType === 'success') zcodeCompleted.add(event.turnId)
            else failedEvent = true
          }
          return
        }
        if (spec.format === 'kimi-stream-json') {
          if (event.role === 'meta' && /error|failed/i.test(String(event.type ?? ''))) failedEvent = true
          if (event.role === 'assistant' && !event.tool_calls?.length) {
            const content = typeof event.content === 'string' ? event.content
              : Array.isArray(event.content) ? event.content.filter(part => part?.type === 'text')
                .map(part => String(part.text ?? '')).join('') : ''
            if (content.trim()) { finalText = content; kimiAssistant = true }
          }
          return
        }
        codexEvents += 1
        if (event.type === 'turn.completed' && !failedEvent) terminal = 'completed'
        // Top-level `error` events include transient reconnect notices; only turn.failed is terminal.
        if (event.type === 'turn.failed') {
          failedEvent = true
          terminal = 'failed'
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message'
          && typeof event.item.text === 'string') finalText = event.item.text
      } catch { protocolError = `${toolId} 输出了无效 JSONL。` }
    }
    const readJsonl = chunk => {
      jsonlBuffer += chunk
      for (;;) {
        const newline = jsonlBuffer.indexOf('\n')
        if (newline < 0) break
        readJsonlLine(jsonlBuffer.slice(0, newline))
        jsonlBuffer = jsonlBuffer.slice(newline + 1)
      }
      if (jsonlBuffer.length > 4_000_000) protocolError = `${toolId} JSONL 单行超过限制。`
    }

    let timeoutTimer
    let graceTimer
    let escalationTimer
    const onAbort = () => requestStop('cancelled')
    const settle = result => {
      if (finished) return
      finished = true
      clearTimeout(timeoutTimer)
      clearTimeout(graceTimer)
      clearTimeout(escalationTimer)
      signal?.removeEventListener('abort', onAbort)
      if (jsonlBuffer.trim()) {
        readJsonlLine(jsonlBuffer)
        jsonlBuffer = ''
      }
      let evidence = accounting.snapshot()
      if (spec.format === 'claude-json') {
        evidence = parseClaudeProcessOutput(stdout, result.exitCode, {
          secrets: [...API_KEY_VARIABLES, 'CLAUDE_CODE_OAUTH_TOKEN'].map(key => childEnvironment[key]),
        })
      } else if (miniMaxParser) {
        evidence = officialToolTerminalEvidence(spec.format, miniMaxParser.finish(result.exitCode))
      }
      resolveResult({ stdoutTail, stderrTail, terminalEvent: terminal, finalText,
        ...finalizeOfficialProcessResult(result, evidence) })
    }
    function requestStop(reason) {
      if (finished || stopReason) return
      stopReason = reason
      escalationTimer = stopProcessTree(child)
      graceTimer = setTimeout(() => settle({ status: reason, exitCode: null, error: '进程终止等待超时。' }), STOP_GRACE_MS)
      graceTimer.unref?.()
    }

    child.stdout.on('data', bytes => {
      if (finished || stopReason) return
      outputBytes += bytes.length
      const chunk = stdoutDecoder.write(bytes)
      stdoutTail = tail(stdoutTail, chunk)
      if (spec.format === 'claude-json') stdout += chunk
      else if (miniMaxParser) miniMaxParser.push(chunk)
      else readJsonl(chunk)
      if (outputBytes > MAX_OUTPUT_BYTES) requestStop('output-limit')
    })
    child.stderr.on('data', bytes => {
      if (finished || stopReason) return
      outputBytes += bytes.length
      stderrTail = tail(stderrTail, stderrDecoder.write(bytes))
      if (outputBytes > MAX_OUTPUT_BYTES) requestStop('output-limit')
    })
    child.stdin.on('error', () => { /* a process can exit before reading stdin */ })
    child.on('error', error => settle({ status: stopReason ?? 'failed', exitCode: null, error: error.message }))
    child.on('close', (code, exitSignal) => {
      if (finished) return
      const finalStdout = stdoutDecoder.end()
      if (finalStdout) {
        stdoutTail = tail(stdoutTail, finalStdout)
        if (spec.format === 'claude-json') stdout += finalStdout
        else if (miniMaxParser) miniMaxParser.push(finalStdout)
        else readJsonl(finalStdout)
      }
      stderrTail = tail(stderrTail, stderrDecoder.end())
      if (jsonlBuffer.trim()) { readJsonlLine(jsonlBuffer); jsonlBuffer = '' }
      if (stopReason) {
        settle({ status: stopReason, exitCode: code, exitSignal })
        return
      }
      if (outputIsEmpty(stdoutTail, stderrTail)) {
        settle({ status: 'failed', exitCode: code, exitSignal, emptyOutput: true,
          error: emptyOutputError(getOfficialTool(toolId)?.label ?? toolId, code) })
        return
      }
      if (miniMaxParser) {
        const outcome = miniMaxParser.finish(code)
        settle(outcome)
        return
      }
      if (nativeParser) {
        settle({ exitCode: code, ...nativeParser.finish(code) })
        return
      }
      if (spec.format === 'claude-json') {
        settle({ ...parseClaudeProcessOutput(stdout, code, {
          secrets: [...API_KEY_VARIABLES, 'CLAUDE_CODE_OAUTH_TOKEN'].map(key => childEnvironment[key]),
        }), exitSignal })
        return
      }
      if (code !== 0) {
        settle({ status: 'failed', exitCode: code, exitSignal, error: '官方 CLI 退出码非零。' })
        return
      }
      if (spec.format === 'zcode-stream-json') {
        const turnId = zcodeResult?.turnId
        if (protocolError || failedEvent || !zcodeResult || typeof turnId !== 'string'
          || !turnId || !zcodeStarted.has(turnId) || !zcodeCompleted.has(turnId)
          || zcodeResult.projection?.status !== 'idle'
          || typeof zcodeResult.response !== 'string' || !zcodeResult.response.trim()) {
          settle({ status: 'failed', exitCode: code,
            error: protocolError ?? 'ZCode 未返回匹配回合的成功终态和最终答复。' })
          return
        }
        terminal = 'completed'
        finalText = zcodeResult.response
      } else if (spec.format === 'kimi-stream-json') {
        if (protocolError || failedEvent || !kimiAssistant) {
          settle({ status: 'failed', exitCode: code, error: protocolError ?? 'Kimi 未返回完整的助手答复。' })
          return
        }
        terminal = 'completed'
      } else if (protocolError || terminal !== 'completed' || !finalText.trim()) {
        settle({ status: 'failed', exitCode: code, error: protocolError ?? codexIncompleteError(codexEvents, stderrTail) })
        return
      }
      settle({ status: 'succeeded', exitCode: code })
    })

    timeoutTimer = setTimeout(() => requestStop('timed-out'), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) requestStop('cancelled')
    if (!stopReason) child.stdin.end(spec.stdinTask === false ? '' : task, 'utf8')
  })
}

/**
 * Run one official CLI. The Host must authorize `workspace` against its
 * session; for write mode, it must supply its own isolated workspace root and
 * obtain the appropriate approval before calling this function. No arbitrary
 * executable, shell command, or CLI flag can be supplied by the caller.
 */
export async function runOfficialTool({
  toolId, task, workspace, mode = 'read-only', isolatedRoot, modelId, signal, sandbox, timeoutMs = DEFAULT_TIMEOUT_MS,
  sessionOnly = false, executionEnvironment: environment = 'harness',
}) {
  const tool = getOfficialTool(toolId)
  if (!tool) return { toolId, status: 'unsupported', reason: '未知的官方工具注册表 ID。' }
  if (!['harness', 'cli-native'].includes(environment)) throw new TypeError('unknown CLI execution environment')
  const capability = officialToolExecutionCapabilities({ executionEnvironment: environment }).find(item => item.id === tool.id)
  if (!capability?.supported) return { toolId: tool.id, status: 'unsupported', reason: capability?.reason ?? '尚无执行适配器。' }
  const prompt = checkedTask(task)
  const requestedModel = checkedModel(modelId)
  const cwd = await checkedWorkspace(workspace)
  const executionMode = checkedMode(mode)
  if (environment === 'cli-native' && executionMode !== 'workspace-write') {
    return { toolId: tool.id, status: 'unsupported', reason: '厂商 CLI 正常环境仅用于明确确认的隔离工作树编辑任务。' }
  }
  if (!capability.modes.includes(executionMode)) {
    return { toolId: tool.id, status: 'unsupported', reason: tool.id === 'codex' ? CODEX_WRITE_UNSUPPORTED
      : `${tool.label} 的无界面模式会自动执行工具；当前仅允许经审批的独立 Git 工作区可编辑执行。` }
  }
  if (executionMode === 'workspace-write') await checkedWriteWorkspace(cwd, isolatedRoot)
  const timeout = checkedTimeout(timeoutMs)
  if (signal?.aborted) return { toolId: tool.id, status: 'cancelled', workspace: cwd }
  if (environment === 'cli-native') {
    // Explicit Host-authorized environment, never an automatic retry. Keep
    // entry attestation, bounded argv, process-tree cancellation and Git gates.
    const spec = await launchSpec(tool.id, cwd, executionMode, requestedModel, prompt, { executionEnvironment: environment })
    if (spec.unsupported) return { toolId: tool.id, status: 'unsupported', reason: spec.unsupported }
    const startedAt = Date.now()
    const outcome = await captureProcess(spec, prompt, cwd, signal, timeout, tool.id, sessionOnly === true)
    return { toolId: tool.id, mode: executionMode, executionEnvironment: environment,
      requestedModel: spec.requestedModel === undefined ? requestedModel : spec.requestedModel,
      ...(spec.modelNotice ? { modelNotice: spec.modelNotice } : {}), workspace: cwd,
      source: spec.source, sandboxEnforcement: 'none', startedAt, finishedAt: Date.now(), ...outcome }
  }
  const blocker = harnessSandboxBlocker(tool.id, process.platform, executionMode)
  if (blocker) return { toolId: tool.id, status: 'unsupported', reason: blocker }
  if (typeof sandbox?.confine !== 'function') {
    return { toolId: tool.id, status: 'unsupported', reason: '官方 Harness 进程沙箱不可用，拒绝直接启动 CLI。' }
  }
  let policy
  try {
    policy = tool.id === 'codex' ? await codexReadOnlyPolicy(cwd)
      : { mode: executionMode, workspaceRoot: cwd }
  } catch (error) {
    return { toolId: tool.id, status: 'unsupported', reason: String(error?.message ?? error).slice(0, 300) }
  }
  const spec = await launchSpec(tool.id, cwd, executionMode, requestedModel, prompt)
  if (spec.unsupported) return { toolId: tool.id, status: 'unsupported', reason: spec.unsupported }
  let confined
  try {
    confined = await sandbox.confine([spec.file, ...spec.args], policy, signal)
  } catch (error) {
    return { toolId: tool.id, status: 'unsupported', reason: `官方进程沙箱拒绝启动：${String(error?.message ?? error).slice(0, 300)}` }
  }
  if (!Array.isArray(confined?.argv) || confined.argv.length < 2 || !['full', 'partial'].includes(confined.enforcement)) {
    return { toolId: tool.id, status: 'unsupported', reason: '官方进程沙箱未返回有效的受限启动参数。' }
  }
  if (tool.id === 'codex' && !codexStateSandboxContract(confined, [spec.file, ...spec.args], policy)) {
    return { toolId: tool.id, status: 'unsupported', reason: 'Codex 的只读任务需要已核验的 Harness Windows ACL 状态目录沙箱；当前 runner 契约不匹配，拒绝直接或不受限启动。' }
  }
  const startedAt = Date.now()
  const outcome = await captureProcess({ ...spec, file: confined.argv[0], args: confined.argv.slice(1) },
    prompt, cwd, signal, timeout, tool.id, sessionOnly === true,
    { ...runnerEnvironment(confined.argv[0]), ...(tool.id === 'codex' ? { CODEX_HOME: policy.workspaceRoot } : {}) })
  return {
    toolId: tool.id,
    mode: executionMode,
    executionEnvironment: environment,
    requestedModel: spec.requestedModel === undefined ? requestedModel : spec.requestedModel,
    ...(spec.modelNotice ? { modelNotice: spec.modelNotice } : {}),
    workspace: cwd,
    source: spec.source,
    sandboxEnforcement: confined.enforcement,
    ...(tool.id === 'codex' ? { runtimeState: 'existing-codex-home' } : {}),
    startedAt,
    finishedAt: Date.now(),
    ...outcome,
  }
}

export const runOfficialToolTask = runOfficialTool
