/** Host configuration only. Endpoints are kept in the private profile, never argv, receipts or diagnostics. */
export function providerSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['openaiBaseUrl', 'chatgptBaseUrl'].includes(key))) throw new TypeError('INVALID_PROVIDER_SETTINGS')
  const entries = []
  for (const [source, target] of [['openaiBaseUrl', 'openai_base_url'], ['chatgptBaseUrl', 'chatgpt_base_url']]) {
    if (input[source] === undefined) continue
    let url
    try { url = new URL(input[source]) } catch { throw new TypeError('INVALID_PROVIDER_ENDPOINT') }
    if (typeof input[source] !== 'string' || input[source].length > 2048 || url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new TypeError('INVALID_PROVIDER_ENDPOINT')
    entries.push([target, input[source]])
  }
  return Object.freeze({ lines: entries.map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    configuredKeys: entries.map(([key]) => key), values: Object.fromEntries(entries) })
}

/** An inherited system/project config cannot add a second MCP or change our native bridge. */
export function assertEffectiveProfile(result, { requestedModel, bridge, home, tools, settings }) {
  const config = result?.config
  if (!config || config.model !== requestedModel || config.model_provider !== 'openai' || config.approval_policy !== 'never' || config.sandbox_mode !== 'read-only') throw new Error('CLI_EFFECTIVE_PROFILE_MISMATCH')
  const servers = config.mcp_servers
  if (!servers || Object.keys(servers).length !== 1 || !servers.dsh_task) throw new Error('CLI_EXTRA_OR_MISSING_MCP')
  const server = servers.dsh_task
  if (server.command !== bridge.command || JSON.stringify(server.args) !== JSON.stringify(bridge.args) ||
    server.cwd !== home || server.required !== true || JSON.stringify(server.enabled_tools) !== JSON.stringify(tools)) throw new Error('CLI_EFFECTIVE_BRIDGE_MISMATCH')
  for (const [key, value] of Object.entries(settings.values)) if (config[key] !== value) throw new Error('CLI_PROVIDER_SETTINGS_MISMATCH')
  return { isolatedMcpServers: ['dsh_task'], explicitProviderSettingKeys: [...settings.configuredKeys] }
}
