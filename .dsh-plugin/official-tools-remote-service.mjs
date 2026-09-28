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
    this.pendingGalReplies = new Map()
    ctx.effect(() => () => {
      for (const controller of this.pendingGalReplies.values()) controller.abort(new Error('Gal 面板已卸载'))
      this.pendingGalReplies.clear()
    }, 'model-router-galgame: cancel active Gal replies on unload')
  }

  /** Re-probe the local fixed registry; the caller cannot supply a command. */
  async list() {
    const tools = await probeAllTools()
    const executionReadiness = await Promise.all(tools.map(tool => tool.installed
      ? officialToolReadiness(tool.id)
      : Promise.resolve({ id: tool.id, ready: false, reason: 'CLI 尚未安装或版本检测失败。' })))
    return { tools, executionCapabilities: officialToolExecutionCapabilities(), executionReadiness }
  }

  /** Start one serialized fixed-registry install; return immediately for UI polling. */
  async install(toolId) {
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

  /** One real free-mode turn through a route already configured in Harness. */
  async galReply(request) {
    const requestId = String(request?.requestId ?? '')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      return { ok: false, error: 'Gal 请求缺少有效的随机 ID。' }
    }
    if (this.pendingGalReplies.has(requestId)) return { ok: false, error: '该 Gal 请求已经在运行。' }
    const controller = new AbortController()
    this.pendingGalReplies.set(requestId, controller)
    const timeout = setTimeout(() => controller.abort(new Error('Gal 对话超时')), 120_000)
    try {
      const provider = String(request?.provider ?? '').trim()
      const model = String(request?.model ?? '').trim()
      const providers = this.ctx.llm.listProviders()
      if (!Array.isArray(providers) || !providers.some(item => (typeof item === 'string' ? item : item?.id) === provider)) {
        return { ok: false, error: '所选供应商不在官方模型目录中。' }
      }
      const models = await this.ctx.llm.listModels(provider)
      if (!Array.isArray(models) || !models.some(item => (item?.id ?? item?.model) === model)) {
        return { ok: false, error: '所选模型不在官方模型目录中。' }
      }
      if (controller.signal.aborted) return { ok: false, error: errorText(controller.signal.reason).slice(0, 300) }
      let reply = ''
      let finish = 'unknown'
      let characterLimitReached = false
      const stream = this.ctx.llm.stream({
        provider, model,
        messages: [
          { role: 'user', content: [{ type: 'text', text: String(request.persona) }] },
          ...request.messages.map(item => ({ role: item.role, content: [{ type: 'text', text: item.text }] })),
        ],
        maxTokens: 1_500,
        signal: controller.signal,
      })
      try {
        for await (const chunk of stream) {
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
            const remaining = 8_000 - reply.length
            reply += chunk.text.slice(0, Math.max(0, remaining))
            if (chunk.text.length > remaining || reply.length >= 8_000) {
              characterLimitReached = true
              controller.abort(new Error('Gal 回复长度达到上限'))
              break
            }
          } else if (chunk?.type === 'finish') {
            finish = String(chunk.reason?.kind ?? 'unknown')
            if (finish === 'error' || finish === 'aborted') {
              return { ok: false, error: String(chunk.reason?.failure?.message ?? '模型请求未完成').slice(0, 300) }
            }
          }
        }
      } catch (error) {
        if (!characterLimitReached) throw error
      }
      if (!characterLimitReached && controller.signal.aborted) {
        return { ok: false, error: errorText(controller.signal.reason).slice(0, 300) }
      }
      if (!reply.trim()) return { ok: false, error: '模型没有返回可显示的文字。请检查账号与网络。' }
      return { ok: true, text: reply, provider, model, truncated: finish === 'max-tokens' || characterLimitReached }
    } catch (error) {
      return { ok: false, error: errorText(controller.signal.aborted ? controller.signal.reason : error).slice(0, 300) }
    } finally {
      clearTimeout(timeout)
      this.pendingGalReplies.delete(requestId)
    }
  }

  /** A random request ID only controls its matching in-flight Gal turn. */
  cancelGalReply(requestId) {
    const controller = this.pendingGalReplies.get(requestId)
    if (!controller) return { cancelled: false }
    controller.abort(new Error('Gal 对话已取消'))
    return { cancelled: true }
  }
}

/** Registration follows the Host plugin fiber; unload withdraws all endpoints. */
export function registerOfficialToolsRemote(ctx) {
  new OfficialToolsRemoteService(ctx)
  ctx.effect(() => ctx.typert.register(OFFICIAL_TOOLS_HOST_TYPERT), 'model-router-galgame: official tools remote descriptors')
}
