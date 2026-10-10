/**
 * Fixed registry of official model CLI tools, shared by the Host runtime
 * (probe + install + uninstall + repair) and the Desktop panel (display).
 * Pure data: no Node or browser APIs, so both sides and the test suite import
 * it unchanged.
 *
 * The registry is fail-closed by design: installer sources are fixed (the
 * official npm registry, the vendor's published installer script) and clients
 * can only name a registry id and one of that tool's declared install methods
 * — never an arbitrary package, URL or command. Versions are not pinned:
 * installs take each vendor's latest release (`@latest`, the vendor script's
 * own `latest`), and the executor trusts entries by publisher signature or
 * registry-attested digest rather than by version.
 *
 * Every tool declares `installMethods`: the complete, closed list of ways this
 * plugin may obtain the tool. `manager` / `installArgs` / `uninstallArgs` on the
 * tool itself stay the default (first) method, so existing callers and tests
 * keep working. Script methods are never piped straight into an interpreter:
 * the runtime downloads the vendor script, checks it still is that script, and
 * runs the staged copy (same pattern as the MiniMax Windows installer).
 */

/** npm registry every fixed npm method installs from unless the user overrides it. */
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/'

/** Shared shape of a "package manager" method: argv only, no script staging. */
function packageManagerMethod(id, label, manager, spec, { registryFlag = '--registry=' } = {}) {
  return Object.freeze({
    id,
    label,
    kind: 'package-manager',
    manager,
    spec,
    registryFlag,
    installArgs: Object.freeze(['install', '-g', spec]),
    uninstallArgs: Object.freeze(['uninstall', '-g', spec.replace(/@latest$/, '')]),
    /** npm/pnpm both accept --prefix to place a global install off the default. */
    supportsInstallDir: true,
    supportsRegistry: true,
  })
}

/** Vendor installer script run from a verified local copy. */
function scriptMethod(id, label, { shell, scriptUrl, verify, installArg = [], env = [], platforms, supportsInstallDir = false }) {
  return Object.freeze({
    id,
    label,
    kind: 'script',
    shell,
    scriptUrl,
    verify,
    /** Passed after the staged script path; empty means the script takes no argument. */
    installArgs: Object.freeze(installArg),
    /** Environment the vendor script itself documents for this install. */
    env: Object.freeze(env),
    platforms: Object.freeze(platforms),
    /** Whether the vendor script honours a caller-chosen directory at all. */
    supportsInstallDir,
    supportsRegistry: false,
  })
}

export const OFFICIAL_TOOLS = Object.freeze([
  Object.freeze({
    id: 'kimi-code',
    label: 'Kimi Code · Node',
    vendor: 'Moonshot AI',
    purpose: 'Kimi 官方编程 CLI，提供 kimi 命令与 ACP 会话。',
    package: '@moonshot-ai/kimi-code',
    manager: 'npm',
    installArgs: ['install', '-g', '@moonshot-ai/kimi-code@latest', '--registry=https://registry.npmjs.org/'],
    uninstallArgs: ['uninstall', '-g', '@moonshot-ai/kimi-code'],
    probeExecutables: ['kimi'],
    probeNote: 'kimi 与旧 Python 版 kimi-cli 同名；请核对可执行文件来源和版本。',
    providerHints: ['moonshot', 'kimi'],
    installMethods: Object.freeze([
      packageManagerMethod('npm', 'npm', 'npm', '@moonshot-ai/kimi-code@latest'),
      packageManagerMethod('pnpm', 'pnpm', 'pnpm', '@moonshot-ai/kimi-code@latest'),
    ]),
  }),
  Object.freeze({
    id: 'claude-code',
    label: 'Claude Code',
    vendor: 'Anthropic',
    purpose: 'Anthropic 官方编程 CLI，提供 claude 命令。',
    package: '@anthropic-ai/claude-code',
    manager: 'npm',
    installArgs: ['install', '-g', '@anthropic-ai/claude-code@latest', '--registry=https://registry.npmjs.org/'],
    uninstallArgs: ['uninstall', '-g', '@anthropic-ai/claude-code'],
    probeExecutables: ['claude'],
    providerHints: ['anthropic', 'claude'],
    installMethods: Object.freeze([
      packageManagerMethod('npm', 'npm', 'npm', '@anthropic-ai/claude-code@latest'),
      packageManagerMethod('pnpm', 'pnpm', 'pnpm', '@anthropic-ai/claude-code@latest'),
    ]),
  }),
  Object.freeze({
    id: 'codex',
    label: 'Codex CLI',
    vendor: 'OpenAI',
    purpose: 'OpenAI 官方编程 CLI，提供 codex 命令。',
    package: '@openai/codex',
    manager: 'npm',
    installArgs: ['install', '-g', '@openai/codex@latest', '--registry=https://registry.npmjs.org/'],
    uninstallArgs: ['uninstall', '-g', '@openai/codex'],
    probeExecutables: ['codex'],
    probeNote: 'Codex 版本横幅由适配层宽匹配；安装时取 npm 最新版。',
    providerHints: ['openai', 'gpt', 'codex'],
    installMethods: Object.freeze([
      packageManagerMethod('npm', 'npm', 'npm', '@openai/codex@latest'),
      packageManagerMethod('pnpm', 'pnpm', 'pnpm', '@openai/codex@latest'),
    ]),
  }),
  Object.freeze({
    id: 'minimax-code',
    label: 'MiniMax Code',
    vendor: 'MiniMax',
    purpose: 'MiniMax 官方编程 CLI，提供 mcode 命令。',
    package: '@minimax-ai/code',
    manager: 'npm',
    installArgs: ['install', '-g', '@minimax-ai/code@latest', '--registry=https://registry.npmjs.org/', '--ignore-scripts=false', '--include=optional', '--allow-scripts=@minimax-ai/code,better-sqlite3'],
    uninstallArgs: ['uninstall', '-g', '@minimax-ai/code'],
    probeExecutables: ['mcode'],
    providerHints: ['minimax'],
    installMethods: Object.freeze([
      packageManagerMethod('npm', 'npm', 'npm', '@minimax-ai/code@latest'),
      packageManagerMethod('pnpm', 'pnpm', 'pnpm', '@minimax-ai/code@latest'),
    ]),
  }),
  Object.freeze({
    id: 'mimo-code',
    label: 'MiMo Code',
    vendor: 'XiaoMi',
    purpose: '小米 MiMo 官方编程 CLI，提供 mimo 命令。',
    package: '@mimo-ai/cli',
    manager: 'npm',
    installArgs: ['install', '-g', '@mimo-ai/cli@latest', '--registry=https://registry.npmjs.org/'],
    uninstallArgs: ['uninstall', '-g', '@mimo-ai/cli'],
    probeExecutables: ['mimo'],
    providerHints: ['mimo', 'xiaomi'],
    installMethods: Object.freeze([
      packageManagerMethod('npm', 'npm', 'npm', '@mimo-ai/cli@latest'),
      packageManagerMethod('pnpm', 'pnpm', 'pnpm', '@mimo-ai/cli@latest'),
    ]),
  }),
  Object.freeze({
    id: 'grok-build',
    label: 'Grok Build',
    vendor: 'xAI',
    purpose: 'xAI 官方编程 CLI，提供 grok 命令与 ACP 会话。',
    package: '@xai-official/grok',
    manager: 'npm',
    installArgs: ['install', '-g', '@xai-official/grok@latest', '--registry=https://registry.npmjs.org/'],
    uninstallArgs: ['uninstall', '-g', '@xai-official/grok'],
    probeExecutables: ['grok'],
    providerHints: ['xai', 'grok'],
    installMethods: Object.freeze([
      packageManagerMethod('npm', 'npm', 'npm', '@xai-official/grok@latest'),
      packageManagerMethod('pnpm', 'pnpm', 'pnpm', '@xai-official/grok@latest'),
    ]),
  }),
  Object.freeze({
    id: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Google',
    purpose: 'Google 官方 Gemini CLI，无界面模式使用 gemini -p。',
    package: '@google/gemini-cli',
    manager: 'npm',
    installArgs: ['install', '-g', '@google/gemini-cli@latest', '--registry=https://registry.npmjs.org/'],
    uninstallArgs: ['uninstall', '-g', '@google/gemini-cli'],
    probeExecutables: ['gemini'],
    providerHints: ['gemini', 'google'],
    // Headless runs go through the task adapter. The signed sandbox runner does
    // not launch this CLI; a missing or failed process falls back to the API.
    headlessAdapter: true,
    installMethods: Object.freeze([
      packageManagerMethod('npm', 'npm', 'npm', '@google/gemini-cli@latest'),
      packageManagerMethod('pnpm', 'pnpm', 'pnpm', '@google/gemini-cli@latest'),
    ]),
  }),
  Object.freeze({
    id: 'opencode',
    label: 'OpenCode',
    vendor: 'anomalyco / SST',
    purpose: '开源终端编程代理，提供 opencode 命令；可用 npm/pnpm 或官方安装脚本获取。',
    package: 'opencode-ai',
    manager: 'npm',
    installArgs: ['install', '-g', 'opencode-ai@latest', '--registry=https://registry.npmjs.org/'],
    uninstallArgs: ['uninstall', '-g', 'opencode-ai'],
    probeExecutables: ['opencode'],
    probeNote: 'opencode 命令由 npm 全局包或官方脚本安装的二进制提供；脚本安装固定落在 ~/.opencode/bin。',
    providerHints: ['opencode', 'anomalyco'],
    /** File an uninstall may delete, when the copy came from a script install. */
    scriptBinaryNames: Object.freeze(['opencode', 'opencode.exe']),
    /** Where the vendor script puts the binary when the user sets no directory. */
    defaultScriptInstallDir: '.opencode/bin',
    installMethods: Object.freeze([
      packageManagerMethod('npm', 'npm', 'npm', 'opencode-ai@latest'),
      packageManagerMethod('pnpm', 'pnpm', 'pnpm', 'opencode-ai@latest'),
      // The published script hardcodes $HOME/.opencode/bin, so it cannot honour
      // a custom install directory; the npm/pnpm methods above can.
      scriptMethod('script-bash', 'curl | bash', {
        shell: 'bash',
        scriptUrl: 'https://opencode.ai/install',
        platforms: ['linux', 'darwin'],
        // The published script hardcodes $HOME/.opencode/bin, so it cannot honour
        // a custom install directory; the npm/pnpm methods above can.
        supportsInstallDir: false,
        verify: Object.freeze({
          mustInclude: ['anomalyco/opencode', 'opencode.ai'],
          mustNotInclude: ['static-openapi.stepfun.com'],
        }),
      }),
    ]),
  }),
  Object.freeze({
    id: 'stepcode',
    label: 'Step Code',
    vendor: 'StepFun 阶跃星辰',
    purpose: '阶跃星辰开源终端编程代理，提供 step 命令；官方只发布安装脚本，没有 npm 包。',
    manager: 'script-installer',
    installArgs: [],
    uninstallArgs: [],
    probeExecutables: ['step'],
    probeNote: 'step 命令来自阶跃官方安装脚本，校验和写入 ~/.stepcode；配置与凭据同在该目录，卸载只删除可执行文件。',
    providerHints: ['stepfun', 'stepcode'],
    scriptBinaryNames: Object.freeze(['step', 'step.exe']),
    defaultScriptInstallDir: '.stepcode/bin',
    /** The vendor installer writes this marked block into the shell profile. */
    pathProfileMarkers: Object.freeze(['# stepcode']),
    installMethods: Object.freeze([
      scriptMethod('script-bash', 'curl | bash', {
        shell: 'bash',
        scriptUrl: 'https://static-openapi.stepfun.com/stepcode/install.sh',
        platforms: ['linux', 'darwin'],
        installArg: ['--install-dir'],
        env: ['STEP_INSTALL_DIR', 'STEP_RELEASE_BASE_URL'],
        supportsInstallDir: true,
        verify: Object.freeze({
          mustInclude: ['static-openapi.stepfun.com', 'stepcode installer'],
          mustNotInclude: ['anomalyco/opencode'],
        }),
      }),
      scriptMethod('script-powershell', 'irm | iex', {
        shell: 'powershell',
        scriptUrl: 'https://static-openapi.stepfun.com/stepcode/install.ps1',
        platforms: ['win32'],
        installArg: ['-InstallDir'],
        env: ['STEP_INSTALL_DIR', 'STEP_RELEASE_BASE_URL'],
        supportsInstallDir: true,
        verify: Object.freeze({
          mustInclude: ['static-openapi.stepfun.com', 'stepcode'],
          mustNotInclude: ['anomalyco/opencode'],
        }),
      }),
    ]),
  }),
  Object.freeze({
    id: 'zcode',
    label: 'ZCode',
    vendor: 'Z.ai',
    purpose: '智谱官方 ZCode 桌面版，内含 GLM 编程代理。Windows 安装器可选择 D 盘目录。',
    manager: 'signed-windows-installer',
    installArgs: [],
    uninstallArgs: [],
    probeExecutables: [],
    probeNote: '检测经过有效签名的 ZCode.exe 和同目录 GLM 资源；桌面安装器需人工选择安装位置。',
    providerHints: ['zai', 'z.ai', 'zcode', 'glm', 'zhipu', 'bigmodel'],
  }),
])

const TOOL_BY_ID = new Map(OFFICIAL_TOOLS.map(tool => [tool.id, tool]))

export function getOfficialTool(id) {
  return TOOL_BY_ID.get(String(id ?? '').trim()) ?? null
}

/** Conservative keyword mapping from a catalog provider id/name to a tool. */
export function toolForProvider(provider) {
  const value = String(provider ?? '').trim().toLowerCase()
  if (!value) return null
  for (const tool of OFFICIAL_TOOLS) {
    if (tool.providerHints.some(hint => value.includes(hint))) return tool
  }
  return null
}

/** Every install method a tool declares, or an empty list for the desktop installer. */
export function installMethodsFor(tool) {
  return Array.isArray(tool?.installMethods) ? tool.installMethods : []
}

/** One closed method id of one tool; null when the tool does not offer it. */
export function installMethodFor(tool, methodId) {
  const wanted = String(methodId ?? '').trim()
  if (!wanted) return null
  return installMethodsFor(tool).find(method => method.id === wanted) ?? null
}

/** The tool's default method, kept identical to `manager` / `installArgs`. */
export function defaultInstallMethod(tool) {
  return installMethodsFor(tool)[0] ?? null
}

/** Why a method cannot run here, or null when the current platform can run it. */
export function installMethodBlockReason(method, platform = 'linux') {
  if (!method?.platforms) return null
  return method.platforms.includes(platform) ? null : `此安装方式仅支持 ${method.platforms.join(' / ')}。`
}

/**
 * A method able to place the tool in the user's chosen directory. npm and pnpm
 * take --prefix; the opencode script hardcodes its own path and cannot.
 */
export function methodHonoursInstallDir(method) {
  return method?.supportsInstallDir === true
}

/** Human-readable install command line for one registry entry (default method). */
export function installCommandLine(tool) {
  if (!tool || tool.unsupported) return null
  // The signed desktop installer is not a command; it is its own thing.
  if (tool.manager === 'signed-windows-installer') return '打开官方签名安装器（选择安装目录）'
  return installCommandLineFor(tool, defaultInstallMethod(tool))
}

/** Human-readable command line for one specific method of one tool. */
export function installCommandLineFor(tool, method) {
  if (!tool || tool.unsupported) return null
  if (!method) return null
  if (method.kind === 'script') {
    const piped = method.shell === 'powershell' ? `irm ${method.scriptUrl} | iex` : `curl -fsSL ${method.scriptUrl} | bash`
    return method.installArgs.length ? `${piped} ${method.installArgs[0]} <安装目录>` : piped
  }
  return `${method.manager} ${method.installArgs.join(' ')}`
}

/** Human-readable uninstall command line, or null when removal is not a command. */
export function uninstallCommandLineFor(tool, method) {
  if (!tool || tool.unsupported || !method) return null
  if (tool.manager === 'signed-windows-installer') return null
  if (method.kind === 'script') return '删除官方安装的可执行文件（保留配置与登录信息）'
  return `${method.manager} ${method.uninstallArgs.join(' ')}`
}
