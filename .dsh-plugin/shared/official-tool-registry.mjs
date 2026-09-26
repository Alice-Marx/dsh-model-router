/**
 * Fixed registry of official model CLI tools, shared by the Host runtime
 * (probe + install) and the Desktop panel (display). Pure data: no Node or
 * browser APIs, so both sides and the test suite import it unchanged.
 *
 * The registry is fail-closed by design: only tools with a verified official
 * npm distribution channel are installable, versions are pinned to the
 * releases each integration was checked against, and clients can only name a
 * registry id — never an arbitrary package or command.
 */

export const OFFICIAL_TOOLS = Object.freeze([
  Object.freeze({
    id: 'kimi-code',
    label: 'Kimi Code · Node',
    vendor: 'Moonshot AI',
    purpose: 'Kimi 官方编程 CLI，提供 kimi 命令与 ACP 会话。',
    package: '@moonshot-ai/kimi-code',
    version: '2.0.2',
    manager: 'npm',
    installArgs: ['install', '-g', '@moonshot-ai/kimi-code@2.0.2'],
    probeExecutables: ['kimi'],
    probeNote: 'kimi --version 输出 2.0.2 即官方 Node 版；注意与 Python 版 kimi-cli 同名。',
    providerHints: ['moonshot', 'kimi'],
  }),
  Object.freeze({
    id: 'claude-code',
    label: 'Claude Code',
    vendor: 'Anthropic',
    purpose: 'Anthropic 官方编程 CLI，提供 claude 命令。',
    package: '@anthropic-ai/claude-code',
    version: '2.1.193',
    manager: 'npm',
    installArgs: ['install', '-g', '@anthropic-ai/claude-code@2.1.193'],
    probeExecutables: ['claude'],
    providerHints: ['anthropic', 'claude'],
  }),
  Object.freeze({
    id: 'codex',
    label: 'Codex CLI',
    vendor: 'OpenAI',
    purpose: 'OpenAI 官方编程 CLI，提供 codex 命令。',
    package: '@openai/codex',
    version: null,
    installArgs: ['install', '-g', '@openai/codex'],
    manager: 'npm',
    probeExecutables: ['codex'],
    probeNote: 'Codex 跟随上游最新版；版本横幅由适配层宽匹配。',
    providerHints: ['openai', 'gpt', 'codex'],
  }),
  Object.freeze({
    id: 'minimax-code',
    label: 'MiniMax Code',
    vendor: 'MiniMax',
    purpose: 'MiniMax 官方编程 CLI，提供 mcode 命令。',
    package: 'minimax-code',
    version: '0.5.2',
    manager: 'npm',
    installArgs: ['install', '-g', 'minimax-code@0.5.2'],
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
    installArgs: ['install', '-g', '@mimo-ai/cli@0.1.15'],
    probeExecutables: ['mimo'],
    providerHints: ['mimo', 'xiaomi'],
  }),
  Object.freeze({
    id: 'grok-build',
    label: 'Grok Build',
    vendor: 'xAI',
    purpose: 'xAI 官方编程 CLI。',
    unsupported: true,
    unsupportedReason: 'Grok Build 由 xAI 官方渠道分发，没有可核验的 npm 安装渠道；请按官方说明安装。',
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
