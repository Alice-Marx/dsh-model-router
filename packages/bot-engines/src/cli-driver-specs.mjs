/** Fixed native chat protocols. Owner configuration selects a pinned entry, never a shell command. */
const spec = (id, name, transport, executable, credentialHint, extra = {}) => Object.freeze({ id, name, transport, executable,
  implemented: true, available: true, hostTools: false, credentialHint, ...extra })
export const CLI_CHAT_DRIVERS = Object.freeze([
  spec('claude', 'Claude Code', 'stream-json', 'claude', '单独保存 Claude 订阅的 OAuth 认证资料。'),
  spec('codex', 'Codex CLI', 'app-server', 'codex', '使用 ChatGPT 账号的 auth.json；不接受按量 OpenAI API Key。'),
  spec('pi', 'Pi', 'rpc', 'pi', '模型 ID 使用 provider/model；认证资料仅接受该提供方的 OAuth 账号。'),
  spec('museCode', 'Muse Code', 'msp', 'muse', '需要已安装、已核验的 Muse CLI 和自己的账号资料。'),
  spec('antigravityAgent', 'Google Gemini · Antigravity', 'acp', 'antigravity-acp', '需要额外核验受管理的运行时与 harness 文件。',
    { implemented: false, available: false, reason: '尚未接入包含 harness 摘要的受管理运行时安装。普通命令别名不能作为已核验的聊天驱动。' }),
  spec('grokAgent', 'Grok Build', 'acp', 'grok', '使用 Grok 账号的 .grok/auth.json；不接受 XAI_API_KEY。'),
  spec('geminiAgent', 'Gemini CLI', 'acp', 'gemini', '使用支持该 CLI 的 OAuth 账号；不把 Gemini API Key 或 Vertex 计费标记成订阅。'),
  spec('kimiAgent', 'Kimi Code', 'acp', 'kimi', '导入 Kimi Code 账号凭据；不接受 Moonshot 按量 API Key。'),
  spec('droidAgent', 'Droid', 'acp', 'droid', '使用 Factory/Droid 账号资料。'),
  spec('cursorAgent', 'Cursor Agent', 'acp', 'cursor-agent', '保存本连接的 Cursor 账号 token；Cursor 登录仍在官方 CLI 完成。'),
  spec('opencodeGo', 'OpenCode', 'acp', 'opencode', '使用 OpenCode OAuth 账号；按量 API 连接请在 API 区配置。'),
  spec('qwenAgent', 'Qwen Code', 'acp', 'qwen', '使用 Qwen OAuth 账号资料，不继承环境中的 API Key。'),
  spec('hermesAgent', 'Hermes Agent', 'acp', 'hermes', '使用 Hermes 账号池的 OAuth 资料；模型 ID 应为 provider:model。'),
  spec('clineAgent', 'Cline', 'acp', 'cline', '需要本连接可用的 Cline 账号；模型使用原生确认的 ID。'),
  spec('copilotAgent', 'GitHub Copilot CLI', 'acp', 'copilot', '单独保存具有 Copilot 访问权的 GitHub 账号 token。'),
  spec('commandCodeAgent', 'Command Code', 'acp', 'command-code', '使用 Command Code 产品账号，不继承其他厂商的密钥。'),
  spec('customAcp', '自定义 ACP', 'acp', '', '仅用于无外部按量计费的本机实例。选择已核验的 ACP 包装程序，通过标准输入输出提供协议；不接受命令串。'),
  spec('deepseekAgent', 'DeepSeek Harness ACP', 'acp', 'dsh', '该通道依赖按量 API Key。',
    { available: false, reason: '此 CLI 的按量调用不能证明单次输出与费用上限，不能作为订阅路线。请在 API 连接中配置有明确模型容量的 DeepSeek 路线。' }),
])
export const cliDriver = id => CLI_CHAT_DRIVERS.find(driver => driver.id === id)
export function acpChatArgs(driver, model) {
  switch (driver) {
    case 'grokAgent': return ['--permission-mode', 'default', 'agent', '-m', model, 'stdio']
    case 'geminiAgent': return ['--acp', '-m', model]
    case 'kimiAgent': return ['-m', model, 'acp']
    case 'droidAgent': return ['exec', '-o', 'acp']
    case 'cursorAgent': return ['--model', model, 'acp']
    case 'opencodeGo': case 'hermesAgent': case 'commandCodeAgent': return ['acp']
    case 'qwenAgent': return ['--acp']
    case 'clineAgent': return ['--acp', '--auto-approve', 'false']
    case 'copilotAgent': return ['--acp', '--stdio']
    case 'customAcp': return []
    case 'deepseekAgent': return ['--profile', 'acp']
    default: throw Object.assign(new Error('此驱动尚无可用的 ACP 启动协议。'), { code: 'CLI_CHAT_DRIVER_UNAVAILABLE' })
  }
}
