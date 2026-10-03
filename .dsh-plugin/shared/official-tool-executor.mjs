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
import { getOfficialTool, OFFICIAL_TOOLS } from './official-tool-registry.mjs'
import { ensureNpmPrefixOnPath } from './official-tools-runtime.mjs'
import { buildMiniMaxInvocation, createMiniMaxStreamParser } from './vendor-minimax-adapter.mjs'
import { discoverZCodeBundle } from './zcode-bundle.mjs'
import { npmAttestor } from './npm-attestation.mjs'
import { compareReleaseVersions, isReleaseVersion } from './latest-versions.mjs'
import { resolveMiMoGrokLaunch, createMiMoGrokParser } from './vendor-mimo-grok-adapter.mjs'
import { emptyOutputError, outputIsEmpty, usageFromEvents, usageFromOutput } from './task-executors.mjs'

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
const WINDOWS_SYSTEM32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const ENVIRONMENT_KEYS = Object.freeze([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'ComSpec',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
])

const CAPABILITIES = Object.freeze({
  'claude-code': Object.freeze(IS_WINDOWS
    ? { supported: true, modes: Object.freeze(['read-only', 'workspace-write']) }
    : { supported: false, reason: 'Claude 的受限原生入口目前仅在 Windows 完成适配。' }),
  codex: Object.freeze(IS_WINDOWS
    ? { supported: true, modes: Object.freeze(['read-only', 'workspace-write']) }
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
  zcode: Object.freeze(IS_WINDOWS
    ? { supported: true, modes: Object.freeze(['workspace-write']) }
    : { supported: false, reason: 'ZCode 固定桌面发行版目前仅核验了 Windows x64。' }),
  gemini: Object.freeze({
    supported: false,
    reason: 'Gemini 由无界面适配器执行（gemini -p），不走签名沙箱入口；未安装或失败时回退模型目录 API。',
  }),
})

/** A UI/Host can show this without implying that installation means execution readiness. */
export function officialToolExecutionCapabilities() {
  return OFFICIAL_TOOLS.map(tool => ({ id: tool.id, ...CAPABILITIES[tool.id] }))
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
const API_KEY_VARIABLES = Object.freeze(['ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'KIMI_API_KEY',
  'MOONSHOT_API_KEY', 'MINIMAX_API_KEY', 'MIMO_API_KEY', 'XAI_API_KEY', 'ZAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'])

function executionEnvironment(toolId, { sessionOnly = false } = {}) {
  const vendorKeys = {
    'claude-code': ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR'],
    codex: ['CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_HOME'],
    'kimi-code': ['KIMI_CODE_HOME', 'KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    'minimax-code': ['MINIMAX_API_KEY', 'MINIMAX_BASE_URL'],
    'mimo-code': ['MIMO_API_KEY'],
    'grok-build': ['XAI_API_KEY', 'GROK_HOME'],
    zcode: ['ZAI_API_KEY', 'ZCODE_HOME'],
  }
  const keys = [...ENVIRONMENT_KEYS, ...(vendorKeys[toolId] ?? [])]
    .filter(key => !sessionOnly || !API_KEY_VARIABLES.includes(key))
  const env = {}
  for (const key of keys) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

function pathDirectories() {
  const value = process.env.PATH ?? process.env.Path ?? ''
  return [...new Set(value.split(delimiter).map(part => part.trim().replace(/^"|"$/g, '')).filter(Boolean))]
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

/** Resolve the package's real `bin` file, never its Windows .cmd shim. */
async function findGlobalPackageEntries(packageName, binName, expectedBin, workspace) {
  await ensureNpmPrefixOnPath()
  const packageParts = packageName.split('/')
  const found = []
  const seen = new Set()
  for (const directory of pathDirectories()) {
    const moduleParents = [join(directory, 'node_modules')]
    if (basename(directory).toLowerCase() === '.bin') moduleParents.push(resolve(directory, '..'))
    if (!IS_WINDOWS) moduleParents.push(resolve(directory, '..', 'lib', 'node_modules'))
    for (const modules of moduleParents) {
      const packageDirectory = join(modules, ...packageParts)
      try {
        const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
        if (manifest.name !== packageName || manifest.bin?.[binName] !== expectedBin) continue
        const packageRoot = await realpath(packageDirectory)
        if (packageRoot === workspace || inside(workspace, packageRoot)) continue
        if (seen.has(packageRoot)) continue
        const entry = await realpath(join(packageRoot, expectedBin))
        if (!inside(packageRoot, entry) || !(await stat(entry)).isFile()) continue
        seen.add(packageRoot)
        found.push({ entry, packageRoot, version: manifest.version, source: 'verified-npm-package' })
      } catch { /* this PATH entry is not the requested package */ }
    }
  }
  return found
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
      const version = (await readFile(join(root, 'current'), 'utf8')).trim()
      if (!isReleaseVersion(version)) continue
      const releaseRoot = await realpath(join(root, 'releases', version))
      if (!inside(root, releaseRoot)) continue
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
      return { entry, packageRoot, version, source: 'official-windows-installer-npm-attested' }
    } catch { /* inspect the next PATH directory */ }
  }
  return null
}

/** Newest installed copy first; versions are not pinned. */
function newestFirst(entries) {
  return [...entries].sort((left, right) => (compareReleaseVersions(right.version, left.version) ?? 0))
}

async function findCodexExecutable(workspace) {
  await ensureNpmPrefixOnPath()
  const filename = IS_WINDOWS ? 'codex.exe' : 'codex'
  for (const directory of pathDirectories()) {
    try {
      const pathRoot = await realpath(directory)
      if (pathRoot === workspace || inside(workspace, pathRoot)) continue
      const entry = await realpath(join(directory, filename))
      if (inside(workspace, entry) || !(await stat(entry)).isFile()) continue
      await access(entry, IS_WINDOWS ? constants.F_OK : constants.X_OK)
      if (IS_WINDOWS && !(await hasOfficialWindowsSignature(entry, CODEX_SIGNER))) continue
      return { entry, source: IS_WINDOWS ? 'signed-native-executable' : 'path-native-executable' }
    } catch { /* try the next PATH entry */ }
  }
  return null
}

function nodeVersion(entry) {
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
    child.on('close', code => finish(code === 0 ? /^v(\d+\.\d+\.\d+)/.exec(output.trim())?.[1] ?? null : null))
  })
}

async function findNodeExecutable(workspace, minimum = [22, 19, 0], acceptedVersion = () => true) {
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
async function findSignedPackagedCodex(packageRoot, workspace) {
  if (!IS_WINDOWS) return null
  const target = process.arch === 'arm64' ? ['codex-win32-arm64', 'aarch64-pc-windows-msvc']
    : process.arch === 'x64' ? ['codex-win32-x64', 'x86_64-pc-windows-msvc'] : null
  if (!target) return null
  const candidate = join(packageRoot, 'node_modules', '@openai', target[0], 'vendor', target[1], 'bin', 'codex.exe')
  try {
    const entry = await realpath(candidate)
    if (!inside(packageRoot, entry) || inside(workspace, entry) || !(await stat(entry)).isFile()) return null
    if (!(await hasOfficialWindowsSignature(entry, CODEX_SIGNER))) return null
    return { entry, source: 'signed-official-npm-native' }
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

async function launchSpec(toolId, workspace, mode, modelId, task = 'Check readiness.') {
  if (toolId === 'claude-code') {
    const entries = await findGlobalPackageEntries('@anthropic-ai/claude-code', 'claude', 'bin/claude.exe', workspace)
    const compatible = entries.filter(entry => versionAtLeast(entry.version, CLAUDE_MIN_RESTRICTED_VERSION))
    let found = null
    for (const entry of compatible) {
      if (!IS_WINDOWS || await hasOfficialWindowsSignature(entry.entry, CLAUDE_SIGNER)) {
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
    const packages = await findGlobalPackageEntries('@openai/codex', 'codex', 'bin/codex.js', workspace)
    let found = null
    for (const entry of packages) {
      found = await findSignedPackagedCodex(entry.packageRoot, workspace)
      if (found) break
    }
    found ??= await findCodexExecutable(workspace)
    if (!found) return { unsupported: '未找到具有 OpenAI 有效签名的 codex.exe。' }
    return {
      file: found.entry,
      args: codexExecArgs(mode, modelId),
      format: 'codex-jsonl',
      source: found.source,
    }
  }
  if (toolId === 'kimi-code') {
    const tool = getOfficialTool(toolId)
    const entries = await findGlobalPackageEntries(tool.package, 'kimi', 'dist/main.mjs', workspace)
    const found = newestFirst(entries)[0]
    if (!found) return { unsupported: `未找到官方 npm 包 ${tool.package} 的 kimi 入口（dist/main.mjs）。` }
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
    const entries = await findGlobalPackageEntries(tool.package, 'mcode', 'cli.js', workspace)
    const found = newestFirst(entries)[0] ?? await findManagedMiniMaxEntry(workspace)
    if (!found) return { unsupported: `未找到官方 npm 包 ${tool.package} 的 mcode 入口（cli.js）。` }
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
      return await resolveMiMoGrokLaunch({ toolId, workspace, mode, modelId, task })
    } catch (error) {
      return { unsupported: `官方原生入口校验失败：${String(error?.message ?? error).slice(0, 240)}` }
    }
  }
  if (toolId === 'zcode') {
    const found = await discoverZCodeBundle()
    if (!found) return { unsupported: '未找到具有智谱有效签名、且 CLI 脚本与首次核验记录一致的 ZCode 桌面版。' }
    const nodeExecutable = await findNodeExecutable(workspace, [24, 14, 0], version =>
      Number(String(version).split('.')[0]) === 24)
    if (!nodeExecutable) return { unsupported: '未找到工作区外的 Node.js 可执行文件。' }
    if (Buffer.byteLength(task, 'utf8') > 16_000) {
      return { unsupported: 'ZCode 单次 --prompt 参数超过 16 KB；请先拆分任务。' }
    }
    return {
      file: nodeExecutable,
      args: [found.cliEntry, '--prompt', task, '--cwd', workspace,
        '--mode', mode === 'workspace-write' ? 'yolo' : 'plan', '--output-format', 'stream-json'],
      format: 'zcode-stream-json', source: found.source, stdinTask: false,
      requestedModel: null,
      modelNotice: modelId
        ? 'ZCode 的 CLI 没有 --model 参数；本次使用 ZCode 已配置的默认模型，不能保证与 Harness 建议模型一致。'
        : '本次使用 ZCode 已配置的默认模型。',
    }
  }
  return { unsupported: CAPABILITIES[toolId]?.reason ?? '此官方工具尚无已核验的安全执行适配器。' }
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
 * CLIs that cannot start inside the Harness Windows ACL process sandbox.
 * Codex 0.157 must write CODEX_HOME (~/.codex: app-server state, sessions,
 * temp aliases) before its first turn; the ACL runner denies every write in
 * read-only mode and every write outside the workspace in workspace-write, so
 * Codex exits with "failed to initialize in-process app-server client: Access
 * is denied (os error 5)". Returning "unsupported" lets a read-only step use
 * the direct `codex exec --sandbox read-only` launch the user approves as
 * "unsandboxed CLI", instead of failing every time.
 */
export function harnessSandboxBlocker(toolId, platform = process.platform) {
  if (toolId === 'codex' && platform === 'win32') {
    return 'Codex 启动时必须写入 CODEX_HOME（~/.codex），Harness 的 Windows 进程沙箱会拒绝这些写入（os error 5）；改用 Codex 自带的只读沙箱直接启动。'
  }
  return null
}

/** Check the actual trusted launch entry without starting an account call. */
export async function officialToolReadiness(toolId, workspace = process.cwd()) {
  const tool = getOfficialTool(toolId)
  if (!tool) return { id: String(toolId), ready: false, reason: '工具不在固定官方注册表中。' }
  const capability = CAPABILITIES[tool.id]
  if (!capability?.supported) return { id: tool.id, ready: false, reason: capability?.reason ?? '当前平台不支持托管执行。' }
  try {
    const directory = await checkedWorkspace(workspace)
    const spec = await launchSpec(tool.id, directory, capability.modes[0], null)
    return spec.unsupported
      ? { id: tool.id, ready: false, reason: spec.unsupported }
      : { id: tool.id, ready: true, source: spec.source, modes: capability.modes }
  } catch (error) {
    return { id: tool.id, ready: false, reason: String(error?.message ?? error).slice(0, 300) }
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

function captureProcess(spec, task, workspace, signal, timeoutMs, toolId, sessionOnly = false, extraEnv = {}) {
  return new Promise(resolveResult => {
    let child
    try {
      child = spawn(spec.file, spec.args, {
        cwd: workspace,
        shell: false,
        windowsHide: true,
        detached: !IS_WINDOWS,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...executionEnvironment(toolId, { sessionOnly }), ...extraEnv },
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
    let codexUsageLine = ''
    let codexEvents = 0
    let reportedUsage = null
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
      if (nativeParser) { nativeParser.push(line); return }
      try {
        const event = JSON.parse(line)
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
        if (event.type === 'turn.completed' && event.usage) codexUsageLine = line
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
      resolveResult({ stdoutTail, stderrTail, terminalEvent: terminal, finalText, ...result })
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
      if (jsonlBuffer.trim()) readJsonlLine(jsonlBuffer)
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
        const reported = usageFromEvents('minimax-result', outcome)
        settle({ ...outcome, usage: reported?.usage ?? null })
        return
      }
      if (nativeParser) {
        settle({ exitCode: code, ...nativeParser.finish(code) })
        return
      }
      if (code !== 0) {
        settle({ status: 'failed', exitCode: code, exitSignal, error: '官方 CLI 退出码非零。' })
        return
      }
      if (spec.format === 'claude-json') {
        try {
          const result = JSON.parse(stdout)
          if (result.type !== 'result' || result.is_error === true || result.subtype !== 'success'
            || typeof result.result !== 'string') {
            settle({ status: 'failed', exitCode: code, error: 'Claude 未返回成功终态。' })
            return
          }
          terminal = 'completed'
          finalText = result.result
          reportedUsage = usageFromOutput('claude-json', stdout)
        } catch {
          settle({ status: 'failed', exitCode: code, error: 'Claude 未返回有效的结果 JSON。' })
          return
        }
      } else if (spec.format === 'zcode-stream-json') {
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
      if (!reportedUsage && codexUsageLine) reportedUsage = usageFromOutput('codex-jsonl', codexUsageLine)
      settle({ status: 'succeeded', exitCode: code,
        ...(reportedUsage?.usage ? { usage: reportedUsage.usage } : {}),
        ...(reportedUsage?.reportedCostUsd ? { reportedCostUsd: reportedUsage.reportedCostUsd } : {}) })
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
  sessionOnly = false,
}) {
  const tool = getOfficialTool(toolId)
  if (!tool) return { toolId, status: 'unsupported', reason: '未知的官方工具注册表 ID。' }
  const capability = CAPABILITIES[tool.id]
  if (!capability?.supported) return { toolId: tool.id, status: 'unsupported', reason: capability?.reason ?? '尚无执行适配器。' }
  const prompt = checkedTask(task)
  const requestedModel = checkedModel(modelId)
  const cwd = await checkedWorkspace(workspace)
  const executionMode = checkedMode(mode)
  if (!capability.modes.includes(executionMode)) {
    return { toolId: tool.id, status: 'unsupported', reason: `${tool.label} 的无界面模式会自动执行工具；当前仅允许经审批的独立 Git 工作区可编辑执行。` }
  }
  if (executionMode === 'workspace-write') await checkedWriteWorkspace(cwd, isolatedRoot)
  const timeout = checkedTimeout(timeoutMs)
  if (signal?.aborted) return { toolId: tool.id, status: 'cancelled', workspace: cwd }
  const blocker = harnessSandboxBlocker(tool.id)
  if (blocker) return { toolId: tool.id, status: 'unsupported', reason: blocker }
  const spec = await launchSpec(tool.id, cwd, executionMode, requestedModel, prompt)
  if (spec.unsupported) return { toolId: tool.id, status: 'unsupported', reason: spec.unsupported }
  if (typeof sandbox?.confine !== 'function') {
    return { toolId: tool.id, status: 'unsupported', reason: '官方 Harness 进程沙箱不可用，拒绝直接启动 CLI。' }
  }
  let confined
  try {
    confined = await sandbox.confine([spec.file, ...spec.args], {
      mode: executionMode, workspaceRoot: cwd,
    }, signal)
  } catch (error) {
    return { toolId: tool.id, status: 'unsupported', reason: `官方进程沙箱拒绝启动：${String(error?.message ?? error).slice(0, 300)}` }
  }
  if (!Array.isArray(confined?.argv) || confined.argv.length < 2 || !['full', 'partial'].includes(confined.enforcement)) {
    return { toolId: tool.id, status: 'unsupported', reason: '官方进程沙箱未返回有效的受限启动参数。' }
  }
  const startedAt = Date.now()
  const outcome = await captureProcess({ ...spec, file: confined.argv[0], args: confined.argv.slice(1) },
    prompt, cwd, signal, timeout, tool.id, sessionOnly === true, runnerEnvironment(confined.argv[0]))
  return {
    toolId: tool.id,
    mode: executionMode,
    requestedModel: spec.requestedModel === undefined ? requestedModel : spec.requestedModel,
    ...(spec.modelNotice ? { modelNotice: spec.modelNotice } : {}),
    workspace: cwd,
    source: spec.source,
    sandboxEnforcement: confined.enforcement,
    startedAt,
    finishedAt: Date.now(),
    ...outcome,
  }
}

export const runOfficialToolTask = runOfficialTool
