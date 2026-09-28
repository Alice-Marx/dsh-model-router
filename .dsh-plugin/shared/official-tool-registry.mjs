/**
 * Fixed registry of official model CLI tools, shared by the Host runtime
 * (probe + install) and the Desktop panel (display). Pure data: no Node or
 * browser APIs, so both sides and the test suite import it unchanged.
 *
 * The registry is fail-closed by design: only tools with a verified official
 * npm distribution channel are installable, versions are pinned to the
 * releases checked for this registry, and clients can only name a
 * registry id — never an arbitrary package or command.
 */

export const OFFICIAL_TOOLS = Object.freeze([
  Object.freeze({
    id: 'kimi-code',
    label: 'Kimi Code · Node',
    vendor: 'Moonshot AI',
    purpose: 'Kimi 官方编程 CLI，提供 kimi 命令与 ACP 会话。',
    package: '@moonshot-ai/kimi-code',
    version: '2.1.1',
    manager: 'npm',
    installArgs: ['install', '-g', '@moonshot-ai/kimi-code@2.1.1', '--registry=https://registry.npmjs.org/'],
    probeExecutables: ['kimi'],
    probeNote: 'kimi 与旧 Python 版 kimi-cli 同名；请核对可执行文件来源和版本。',
    providerHints: ['moonshot', 'kimi'],
  }),
  Object.freeze({
    id: 'claude-code',
    label: 'Claude Code',
    vendor: 'Anthropic',
    purpose: 'Anthropic 官方编程 CLI，提供 claude 命令。',
    package: '@anthropic-ai/claude-code',
    version: '2.1.283',
    manager: 'npm',
    installArgs: ['install', '-g', '@anthropic-ai/claude-code@2.1.283', '--registry=https://registry.npmjs.org/'],
    probeExecutables: ['claude'],
    providerHints: ['anthropic', 'claude'],
  }),
  Object.freeze({
    id: 'codex',
    label: 'Codex CLI',
    vendor: 'OpenAI',
    purpose: 'OpenAI 官方编程 CLI，提供 codex 命令。',
    package: '@openai/codex',
    version: '0.157.1',
    installArgs: ['install', '-g', '@openai/codex@0.157.1', '--registry=https://registry.npmjs.org/'],
    manager: 'npm',
    probeExecutables: ['codex'],
    probeNote: 'Codex 版本横幅由适配层宽匹配；安装时固定版本。',
    providerHints: ['openai', 'gpt', 'codex'],
  }),
  Object.freeze({
    id: 'minimax-code',
    label: 'MiniMax Code',
    vendor: 'MiniMax',
    purpose: 'MiniMax 官方编程 CLI，提供 mcode 命令。',
    package: '@minimax-ai/code',
    version: '0.5.5',
    manager: 'npm',
    installArgs: ['install', '-g', '@minimax-ai/code@0.5.5', '--registry=https://registry.npmjs.org/', '--ignore-scripts=false', '--include=optional', '--allow-scripts=@minimax-ai/code,better-sqlite3'],
    probeExecutables: ['mcode'],
    providerHints: ['minimax'],
  }),
  Object.freeze({
    id: 'mimo-code',
    label: 'MiMo Code',
    vendor: 'XiaoMi',
    purpose: '小米 MiMo 官方编程 CLI，提供 mimo 命令。',
    package: '@mimo-ai/cli',
    version: '0.1.15',
    manager: 'npm',
    installArgs: ['install', '-g', '@mimo-ai/cli@0.1.15', '--registry=https://registry.npmjs.org/'],
    probeExecutables: ['mimo'],
    providerHints: ['mimo', 'xiaomi'],
  }),
  Object.freeze({
    id: 'grok-build',
    label: 'Grok Build',
    vendor: 'xAI',
    purpose: 'xAI 官方编程 CLI，提供 grok 命令与 ACP 会话。',
    package: '@xai-official/grok',
    version: '1.0.41',
    manager: 'npm',
    installArgs: ['install', '-g', '@xai-official/grok@1.0.41', '--registry=https://registry.npmjs.org/'],
    probeExecutables: ['grok'],
    providerHints: ['xai', 'grok'],
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

/** Human-readable install command line for one registry entry. */
export function installCommandLine(tool) {
  if (!tool || tool.unsupported) return null
  return tool.manager === 'npm'
    ? `npm ${tool.installArgs.join(' ')}`
    : `${tool.manager} ${tool.installArgs.join(' ')}`
}
