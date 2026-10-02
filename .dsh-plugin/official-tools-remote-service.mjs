/** Host receiver for the official desktop's typed one-click installer RPC. */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getOfficialTool } from './shared/official-tool-registry.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness } from './shared/official-tool-executor.mjs'
import {
  defaultRunner,
  cancelInstall,
  ensureNpmPrefixOnPath,
  installStatus,
  probeAllTools,
  probeToolWith,
  startInstall,
} from './shared/official-tools-runtime.mjs'
import {
  OFFICIAL_TOOLS_HOST_TYPERT,
  OFFICIAL_TOOLS_REMOTE_NAMESPACE,
} from './shared/official-tools-remote.mjs'

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

export class OfficialToolsRemoteService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, OFFICIAL_TOOLS_REMOTE_NAMESPACE)

  }

  /** Re-probe the local fixed registry; the caller cannot supply a command. */
  async list() {
    const tools = await probeAllTools({ fresh: true })
    const executionReadiness = await Promise.all(tools.map(tool => tool.installed
      ? officialToolReadiness(tool.id)
      : Promise.resolve({ id: tool.id, ready: false, reason: 'CLI 尚未安装或版本检测失败。' })))
    return { tools, executionCapabilities: officialToolExecutionCapabilities(), executionReadiness }
  }

  /** Start one serialized fixed-registry install; return immediately for UI polling. */
  async installTool(toolId) {
    try {
      await ensureNpmPrefixOnPath()
      return { accepted: true, job: startInstall(toolId) }
    } catch (error) {
      return { accepted: false, error: errorText(error) }
    }
  }

  /** Stop a queued or running npm install, retaining its bounded job log. */
  cancel(toolId) {
    try {
      return { accepted: true, job: cancelInstall(toolId) }
    } catch (error) {
      return { accepted: false, error: errorText(error) }
    }
  }

  /** Read bounded progress; after command success, verify that the CLI resolves. */
  async status(toolId) {
    const job = installStatus(toolId)
    if (job?.status !== 'succeeded') return { job }
    await ensureNpmPrefixOnPath()
    const tool = getOfficialTool(toolId)
    const postInstallProbe = tool === null ? null
      : await probeToolWith(tool, defaultRunner, { cacheMs: 0 })
    return { job, postInstallProbe }
  }


}

/** Registration follows the Host plugin fiber; unload withdraws all endpoints. */
export function registerOfficialToolsRemote(ctx) {
  new OfficialToolsRemoteService(ctx)
  ctx.effect(() => ctx.typert.register(OFFICIAL_TOOLS_HOST_TYPERT), 'model-router-galgame: official tools remote descriptors')
}
