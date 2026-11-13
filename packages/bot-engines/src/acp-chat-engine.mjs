import { createAcpAdapter } from '../../bot-acp/src/acp-adapter.mjs'
import { acpChatArgs, cliDriver } from './cli-driver-specs.mjs'

const normalize = result => ({ ...result, ...(result.usage?.reported ? { usage: {
  input: result.usage.inputTokens, output: result.usage.outputTokens, cachedInput: result.usage.cachedInputTokens,
} } : { usage: null }) })
const safeError = error => Object.assign(new Error('原生 ACP 聊天失败，请核对该连接的账号、模型和 CLI 版本。'),
  { code: /^[A-Z][A-Z0-9_]{2,80}$/.test(error?.code ?? '') ? error.code : /^([A-Z][A-Z0-9_]{2,80})/.exec(error?.message ?? '')?.[1] ?? 'ACP_CHAT_FAILED' })

/** A genuine retained ACP session behind the common public LLM bridge. */
export async function createAcpChatEngine(profile, options) {
  const driver = cliDriver(profile.driver)
  if (!driver?.implemented || !driver.available || driver.transport !== 'acp') throw Object.assign(new Error(driver?.reason ?? 'ACP 驱动不可用。'), { code: 'CLI_CHAT_DRIVER_UNAVAILABLE' })
  if (options.tools?.length || options.handlers?.length) throw Object.assign(new Error('此驱动当前提供原生文本聊天，请另行配置官方工具。'), { code: 'CLI_CHAT_HOST_TOOLS_UNSUPPORTED' })
  const hooks = options.hooks ?? {}
  let environment = {}
  const adapter = await createAcpAdapter({ ...options, hooks: { ...hooks,
    ...(hooks.onSettle ? { onSettle: result => hooks.onSettle(normalize(result)) } : {}) },
    spawnArgs: acpChatArgs(profile.driver, profile.model),
    expectedModelId: profile.model, requireModelSelection: true,
    provisionCredentials: async home => { const provisioned = await options.provisionCredentials?.(home); environment = provisioned?.env ?? {}; return provisioned },
    auth: { pickMethod: methods => {
      const preferred = profile.driver === 'grokAgent' ? ['cached_token'] : profile.driver === 'geminiAgent' ? ['oauth-personal']
        : profile.driver === 'clineAgent' ? [environment.CLINE_PROVIDER] : []
      return preferred.find(id => typeof id === 'string' && methods.some(method => method.id === id)) ?? null
    } },
    ...(profile.driver === 'cursorAgent' ? { clientCapabilities: { meta: { parameterizedModelPicker: true } } } : {}),
    // The CLI's own permission system must ask; absent granted native tools every ask denies.
    onPermissionRequest: () => ({ behavior: 'deny' }), operationTool: () => null,
  })
  let personaSent = false
  return Object.freeze({ ...adapter, events: adapter.events,
    get closed() { return adapter.closed }, get busy() { return adapter.busy },
    submitTurn(input) {
      if (!input || Object.keys(input).some(key => key !== 'text') || typeof input.text !== 'string') return Promise.reject(safeError({ code: 'ACP_TURN_INPUT' }))
      const text = !personaSent && options.systemPrompt
        ? `[Host conversation instructions]\n${options.systemPrompt}\n[/Host conversation instructions]\n\n${input.text}` : input.text
      // No await before the core reserves its single turn slot.
      return adapter.submitTurn({ text }).then(result => {
        if (result.dispatched) personaSent = true
        return normalize({ ...result, errorText: result.errorText ? '原生 ACP 会话未正常完成。' : null })
      }, error => { throw safeError(error) })
    },
  })
}
