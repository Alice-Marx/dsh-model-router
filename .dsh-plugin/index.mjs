import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_ROUTER_SETTINGS } from './shared/router.mjs'
import { createPlanFromRoutes } from './shared/harness-plan.mjs'
import { registerOfficialToolsRemote } from './official-tools-remote-service.mjs'
import {
  getOfficialTool,
  installCommandLine,
  toolForProvider,
} from './shared/official-tool-registry.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness } from './shared/official-tool-executor.mjs'
import { runOfficialTask, runOfficialTeam, sessionWorkspace } from './shared/official-team-runtime.mjs'
import {
  probeAllTools,
  probeToolWith,
  startInstall,
  cancelInstall,
  installStatus,
  installedToolIds,
  defaultRunner,
} from './shared/official-tools-runtime.mjs'

export const name = 'model-router-galgame'
export const inject = ['commands', 'llm', 'tools', 'typert', 'sandboxPolicy', 'sandbox']

export const Config = z.object({
  budgetUsd: z.number().min(0).max(1_000_000).default(DEFAULT_ROUTER_SETTINGS.budgetUsd).volatile(),
  maxConsultOutputChars: z.number().step(1).min(500).max(50_000).default(12_000).volatile(),
})

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function valueOf(config, key, fallback) {
  const value = config?.[key]
  return value !== undefined && typeof value?.get === 'function' ? value.get() : value ?? fallback
}

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedInteger(value, fallback, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.floor(finiteNumber(value, fallback))))
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function errorText(error) {
  if (error instanceof Error && error.message) return error.message
  try { return String(error) } catch { return 'unknown error' }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('operation aborted')
}

function routeKey(route) {
  return `${route.provider}\u0000${route.model}`
}

function uniqueStrings(values) {
  return [...new Set(values.map(text).filter(Boolean))]
}

/** Read only exact provider/model routes published by the official LLM service. */
export async function discoverConfiguredRoutes(ctx, signal) {
  throwIfAborted(signal)
  let providers
  try { providers = ctx.llm.listProviders() } catch { return [] }
  const routes = new Map()
  for (const entry of Array.isArray(providers) ? providers : []) {
    const provider = text(typeof entry === 'string' ? entry : entry?.id)
    if (!provider) continue
    throwIfAborted(signal)
    let models
    try { models = await ctx.llm.listModels(provider) } catch {
      throwIfAborted(signal)
      continue
    }
    for (const listed of Array.isArray(models) ? models : []) {
      const model = text(listed?.id ?? listed?.model)
      if (!model) continue
      throwIfAborted(signal)
      let resolved = listed
      try { resolved = await ctx.llm.resolveModelInfo(provider, model, signal) } catch {
        throwIfAborted(signal)
      }
      const reasoning = resolved?.reasoning
      const route = {
        provider,
        model,
        name: text(resolved?.name ?? listed?.name) || model,
        inputModalities: uniqueStrings(Array.isArray(resolved?.inputModalities)
          ? resolved.inputModalities : Array.isArray(listed?.inputModalities) ? listed.inputModalities : []),
        reasoningKnown: reasoning !== undefined && reasoning !== null,
        reasoningEfforts: uniqueStrings(Array.isArray(reasoning?.efforts) ? reasoning.efforts.map(item => item?.id ?? item) : []),
        ...text(reasoning?.defaultEffort) ? { defaultReasoningEffort: text(reasoning.defaultEffort) } : {},
      }
      routes.set(routeKey(route), route)
    }
  }
  return [...routes.values()].sort((left, right) => routeKey(left).localeCompare(routeKey(right)))
}

/** Produce a route recommendation and work packages compatible with official Agent Teams. */
export async function createRoutePlan(ctx, task, config = {}, options = {}) {
  const taskText = text(task)
  if (!taskText) throw new Error('task must contain text')
  const mode = options.mode === 'team' ? 'team' : 'single'
  const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
  const budgetUsd = Math.max(0, finiteNumber(options.budgetUsd, finiteNumber(configuredBudget, 0)))
  const [availableRoutes, installed] = await Promise.all([
    discoverConfiguredRoutes(ctx, options.signal),
    options.skipToolProbe === true
      ? Promise.resolve(Array.isArray(options.installedToolIds) ? options.installedToolIds : [])
      : installedToolIds(),
  ])
  const readiness = options.skipToolProbe === true ? []
    : await Promise.all(installed.map(id => officialToolReadiness(id, options.workspace ?? process.cwd())))
  const executable = new Set(Array.isArray(options.runnableToolIds)
    ? options.runnableToolIds : readiness.filter(item => item.ready).map(item => item.id))
  return createPlanFromRoutes(taskText, availableRoutes, {
    mode, budgetUsd, installedToolIds: installed,
    runnableToolIds: installed.filter(id => executable.has(id)),
  })
}

/** One bounded, independent call through the same official LLM service. */
export async function consultConfiguredModel(ctx, route, task, outputLimit = 12_000, signal) {
  const provider = text(route?.provider)
  const model = text(route?.model)
  const taskText = text(task)
  if (!provider || !model) throw new Error('a configured provider and model are required')
  if (!taskText) throw new Error('task must contain text')
  throwIfAborted(signal)
  const limit = boundedInteger(outputLimit, 12_000, 1, 50_000)
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  let answer = ''
  let characterLimitReached = false
  let finish = { kind: 'unknown' }
  try {
    const stream = ctx.llm.stream({
      provider,
      model,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `You are an independent specialist consulted by another AI agent. Give a concise, evidence-oriented answer in the task's language.\n\nTask:\n${taskText}`,
        }],
      }],
      maxTokens: Math.min(4_096, Math.max(256, Math.ceil(limit / 2))),
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        const remaining = limit - answer.length
        if (remaining > 0) answer += chunk.text.slice(0, remaining)
        if (chunk.text.length > remaining) {
          characterLimitReached = true
          controller.abort(new Error('consultation output limit reached'))
          break
        }
      } else if (chunk?.type === 'finish') {
        const reason = chunk.reason
        finish = { kind: text(reason?.kind) || 'unknown' }
        if (finish.kind === 'error' || finish.kind === 'aborted') {
          finish.error = text(reason?.failure?.message) || 'model request failed'
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  throwIfAborted(signal)
  const tokenLimitReached = finish.kind === 'max-tokens'
  const truncated = characterLimitReached || tokenLimitReached
  if (!characterLimitReached && (finish.kind === 'error' || finish.kind === 'aborted')) {
    return { ok: false, provider, model, answer, truncated, finish, error: finish.error }
  }
  if (!answer.trim()) {
    return { ok: false, provider, model, answer, truncated, finish, error: 'model returned no text' }
  }
  return {
    ok: true, provider, model, answer, truncated, finish,
    ...(tokenLimitReached
      ? { truncationReason: 'model-token-limit', notice: '模型达到本次调用的输出 token 上限，回答可能不完整。' }
      : characterLimitReached
        ? { truncationReason: 'output-character-limit', notice: '回答达到字符上限，后续内容已截断。' }
        : {}),
  }
}

function explicitRoute(args, routes) {
  const provider = text(args.provider)
  const model = text(args.model)
  if (Boolean(provider) !== Boolean(model)) throw new Error('provider and model must be supplied together')
  if (!provider) return null
  const route = routes.find(item => item.provider === provider && item.model === model)
  if (!route) throw new Error(`route ${provider}/${model} is not configured in DeepSeek Harness`)
  return route
}

function currentAgentRoute(agent) {
  try {
    const config = agent?.session?.requestHeader?.()?.config
    if (text(config?.provider) && text(config?.model)) return { provider: config.provider, model: config.model }
  } catch { /* background tools need not have a session-backed agent */ }
  return null
}

function chooseConsultRoute(plan, routes, agent) {
  const current = currentAgentRoute(agent)
  const differs = route => current === null || routeKey(route) !== routeKey(current)
  const preferred = routes.find(route => route.provider === plan.selected?.provider && route.model === plan.selected?.model)
  if (preferred && differs(preferred)) return preferred
  return routes.find(differs) ?? preferred ?? routes[0]
}

function commandText(plan) {
  const selected = plan.selected ? `${plan.selected.provider}/${plan.selected.model}` : '没有可用路线'
  const channel = plan.executionChannel === 'official-cli'
    ? `官方 CLI（${plan.channelLabel ?? plan.channelTool}）`
    : '官方模型目录 API'
  return [
    `推荐路线：${selected}`,
    `复杂度：${plan.complexity.band}；任务类型：${plan.taskType}`,
    `执行渠道：${channel}；估算成本：$${plan.estimatedCost.toFixed(6)}（仅估算）`,
    `工作包：${plan.subtasks.map(item => `${item.name} → ${item.recommendedProvider}/${item.recommended}`).join('；')}`,
    plan.team.handoff,
  ].join('\n')
}

/** Register model-facing tools and the human /router command. */
export function apply(ctx, config = {}) {
  // The official Host injects typert; direct lightweight uses of apply may
  // supply only the model/command services and do not expose the Desktop RPC.
  if (ctx.typert) registerOfficialToolsRemote(ctx)
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name === 'model_router_tool_install') {
      const requested = getOfficialTool(text(exec.arguments?.tool))
      const label = requested?.label ?? '官方 CLI'
      const desktopInstaller = requested?.manager === 'signed-windows-installer'
      return {
        kind: 'ask',
        reason: desktopInstaller
          ? `Download and open the verified official ${label} desktop installer`
          : `Install ${label} globally with the plugin's fixed official command`,
        displayReason: {
          en: desktopInstaller
            ? `Download and open the verified ${label} installer? You can select the installation directory in its window.`
            : `Install ${label} globally using the fixed official package?`,
          zh: desktopInstaller
            ? `下载并打开已验签的 ${label} 安装器？安装窗口中可选择非 C 盘目录。`
            : `使用插件固定的官方软件包，在本机全局安装 ${label}？`,
        },
      }
    }
    if ((exec.name === 'model_router_tool_run' || exec.name === 'model_router_team_execute')
      && exec.arguments?.mode === 'workspace-write') {
      return {
        kind: 'ask',
        reason: 'Official CLI models will use their normal tools in an isolated Git worktree and integrate their patch into the current workspace',
        displayReason: {
          en: 'Allow the official CLI model to use shell, skills, configured MCP and other normal tools in an isolated Git worktree, then apply its patch to this workspace?',
          zh: '允许官方 CLI 模型在独立 Git 工作区使用终端、技能、已配置 MCP 等工具，并将改动补丁应用回当前工作区？',
        },
      }
    }
    return decision
  })
  registerOfficialToolModels(ctx, config)
  ctx.tools.register(defineTool({
    name: 'model_router_routes',
    description: 'List provider/model routes registered in the official DeepSeek Harness model directory. Credential and network availability are not verified. No API keys or endpoints are returned.',
    parameters: {},
    output: JSON_OUTPUT,
    async execute(_args, exec) {
      const routes = await discoverConfiguredRoutes(ctx, exec.signal)
      return jsonValue({ routes, count: routes.length, availabilityNotice: '目录记录不证明账号凭据和网络当前可用。' })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_plan',
    description: 'Recommend configured Harness model routes for a task and optionally produce work packages for official Agent Teams. Costs are local estimates.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task to analyze.' },
      mode: { type: 'string', enum: ['single', 'team'], description: 'Use team to produce Agent Teams work packages.' },
      budgetUsd: { type: 'number', description: 'Optional local estimated cost ceiling in USD.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      return jsonValue(await createRoutePlan(ctx, args.task, config, { mode: args.mode, budgetUsd: args.budgetUsd, signal: exec.signal }))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_consult',
    description: 'Ask one already configured Harness model for an independent opinion. Supply both provider and model for an explicit route, or omit both for a recommended route different from the current model when available.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task or question for the consulted model.' },
      provider: { type: 'string', description: 'Configured provider id; pair with model.' },
      model: { type: 'string', description: 'Configured model id; pair with provider.' },
      outputLimit: { type: 'number', description: 'Maximum returned characters, from 500 to 50000.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const routes = await discoverConfiguredRoutes(ctx, exec.signal)
      if (routes.length === 0) throw new Error('no configured model routes are available')
      const requested = explicitRoute(args, routes)
      const plan = requested ? null : await createRoutePlan(ctx, args.task, config, { signal: exec.signal })
      const route = requested ?? chooseConsultRoute(plan, routes, exec.agent)
      const fallback = valueOf(config, 'maxConsultOutputChars', 12_000)
      const limit = boundedInteger(args.outputLimit, finiteNumber(fallback, 12_000), 500, 50_000)
      return jsonValue(await consultConfiguredModel(ctx, route, args.task, limit, exec.signal))
    },
  }))
  ctx.commands.register({
    name: 'router',
    description: 'Show an official-model route recommendation for a task.',
    input: { hint: 'Describe the task to plan' },
    async handler({ rawInput, signal }) {
      if (!text(rawInput)) return { kind: 'error', text: '用法：/router <需要规划的任务>' }
      try {
        const plan = await createRoutePlan(ctx, rawInput, config, { signal })
        return { kind: 'success', text: commandText(plan) }
      } catch (error) {
        return { kind: 'error', text: `无法生成路由计划：${errorText(error)}` }
      }
    },
  })
  ctx.commands.register({
    name: 'tools',
    description: 'Show official model CLI install status, or install one registry tool.',
    input: { hint: '留空查看状态；或输入 install/cancel <工具id>' },
    async handler({ rawInput, signal }) {
      const input = text(rawInput)
      const installMatch = input.match(/^install\s+([A-Za-z0-9_-]+)$/i)
      const cancelMatch = input.match(/^cancel\s+([A-Za-z0-9_-]+)$/i)
      if (cancelMatch) {
        try { return { kind: 'success', text: `已请求取消 ${cancelInstall(cancelMatch[1]).tool} 的安装；请使用 /tools 查看最新状态。` } }
        catch (error) { return { kind: 'error', text: `无法取消安装：${errorText(error)}` } }
      }
      if (!installMatch) {
        if (input) return { kind: 'error', text: '用法：/tools 查看状态，或 /tools install/cancel <工具id>' }
        try {
          const probes = await probeAllTools({ fresh: true })
          const lines = probes.map(probe => {
            const tool = getOfficialTool(probe.id)
            const command = installCommandLine(tool)
            const status = probe.status === 'installed'
              ? `已安装 ${probe.version ?? ''}`
              : probe.status === 'unsupported'
                ? '不支持一键安装'
                : '未安装'
            return `• ${tool.label}（${probe.id}）：${status}${command && probe.status === 'not-installed' ? `\n  安装：/tools install ${probe.id}（即 ${command}）` : ''}`
          })
          return { kind: 'success', text: `官方工具状态：\n${lines.join('\n')}` }
        } catch (error) {
          return { kind: 'error', text: `探测失败：${errorText(error)}` }
        }
      }
      try {
        const job = startInstall(installMatch[1])
        const tool = getOfficialTool(installMatch[1])
        const settled = await waitForInstall(job.tool, signal)
        if (settled.status === 'succeeded') {
          const probe = await probeToolWith(tool, defaultRunner)
          return { kind: 'success', text: `${tool.label} 安装完成${probe.version ? `，探测版本 ${probe.version}` : ''}。` }
        }
        if (settled.status === 'installer-opened') {
          return { kind: 'success', text: `${tool.label} 官方安装器已验证并打开。请在安装窗口选择非 C 盘目录并完成安装，然后运行 /tools 重新检测；当前尚未确认安装完成。` }
        }
        return { kind: 'error', text: `${tool.label} 安装失败：${settled.error ?? '未知原因'}\n${settled.outputTail.slice(-6).join('\n')}` }
      } catch (error) {
        return { kind: 'error', text: `无法开始安装：${errorText(error)}` }
      }
    },
  })
}

/** Poll an install job until it settles or the signal aborts. */
async function waitForInstall(toolId, signal) {
  for (;;) {
    if (signal?.aborted) {
      try { cancelInstall(toolId) } catch { /* install may already have finished */ }
      throw new Error('已请求取消安装；请重新检测实际安装状态。')
    }
    const job = installStatus(toolId)
    if (!job) throw new Error('安装任务丢失。')
    if (job.status !== 'running') return job
    await new Promise(resolve => setTimeout(resolve, 1_500))
  }
}

/** Register the model-facing official-tool probes and installer. */
function registerOfficialToolModels(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'model_router_tools',
    description: 'Probe the fixed registry of official model tools (Kimi Code, Claude Code, Codex, MiniMax Code, MiMo Code, Grok Build, ZCode) and report which are installed with their versions. Never reads credentials.',
    parameters: {},
    output: JSON_OUTPUT,
    async execute(_args, exec) {
      throwIfAborted(exec.signal)
      const probes = await probeAllTools()
      return jsonValue({
        tools: probes,
        executionCapabilities: officialToolExecutionCapabilities(),
        executionReadiness: await Promise.all(probes.map(probe => probe.installed
          ? officialToolReadiness(probe.id)
          : Promise.resolve({ id: probe.id, ready: false, reason: 'CLI 尚未安装或版本检测失败。' }))),
        installHint: '未安装的工具可由 model_router_tool_install 按注册表固定命令安装；版本与包名不接受自定义。',
      })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_tool_install',
    description: 'Install one official model tool by registry id using its pinned official source. ZCode opens a verified interactive desktop installer with a directory picker. Only registry ids are accepted; arbitrary packages or executables are refused.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Registry tool id, e.g. kimi-code.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const job = startInstall(args.tool)
      const settled = await waitForInstall(job.tool, exec.signal)
      const tool = getOfficialTool(args.tool)
      const probe = settled.status === 'succeeded'
        ? await probeToolWith(tool, defaultRunner)
        : null
      return jsonValue({
        ...settled,
        postInstallProbe: probe,
        notice: settled.status === 'installer-opened'
          ? '已打开 ZCode 官方安装窗口，请选择安装目录并完成安装，之后重新检测；此状态不代表安装完成。'
          : '安装命令完全来自服务端注册表；实际版本以探测横幅为准。',
      })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_tool_run',
    description: 'Run one supported official model CLI in the current Harness session workspace. Claude, Codex, MiMo and Grok support read-only; Kimi, MiniMax and ZCode require workspace-write. Write mode needs approval and a clean Git repository. Optional provider/model must match a configured Harness route and selected vendor; cliModel can specify that vendor CLI’s own configured model name. Without cliModel, Kimi, MiniMax, MiMo, Grok and ZCode use the CLI default.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Fixed registry tool id, e.g. claude-code or codex.' },
      task: { type: 'string', required: true, description: 'Concrete task for the official CLI model.' },
      provider: { type: 'string', description: 'Optional configured provider, paired with model.' },
      model: { type: 'string', description: 'Optional model ID from the Harness directory, paired with provider. This ID is advisory for CLIs except Claude/Codex.' },
      cliModel: { type: 'string', description: 'Optional model name already configured in this vendor CLI; requires provider and model. MiniMax/MiMo require provider/model format. ZCode 3.14.3 cannot switch models per call.' },
      mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default is read-only. Kimi, MiniMax and ZCode require workspace-write. Write mode requires official approval and a clean Git repository.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const mode = args.mode === 'workspace-write' ? 'workspace-write' : 'read-only'
      if (mode === 'workspace-write' && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能请求可编辑 CLI 执行')
      let modelId = null
      if (text(args.provider) || text(args.model)) {
        if (!text(args.provider) || !text(args.model)) throw new Error('provider 和 model 必须同时提供')
        const tool = toolForProvider(args.provider)
        if (tool?.id !== args.tool) throw new Error('所选模型供应商与官方 CLI 工具不匹配')
        const routes = await discoverConfiguredRoutes(ctx, exec.signal)
        if (!routes.some(route => route.provider === args.provider && route.model === args.model)) throw new Error('所选 provider/model 不在官方模型目录中')
        modelId = args.tool === 'claude-code' || args.tool === 'codex' ? args.model : null
      }
      if (text(args.cliModel)) {
        if (!text(args.provider) || !text(args.model)) throw new Error('cliModel 需要同时提供已配置的 provider 和 model 路线')
        if (args.tool === 'zcode') throw new Error('ZCode 3.14.3 不支持在单次调用中指定 CLI 模型')
        modelId = args.cliModel
      }
      const result = await runOfficialTask({ toolId: args.tool, task: args.task, modelId, workspace: cwd, allowedRoot: root, mode, signal: exec.signal, sandbox: ctx.sandbox })
      return jsonValue({ ...result,
        ...(!modelId && text(args.model) ? { modelNotice: result.modelNotice
          ?? 'Harness 模型 ID 未经此厂商 CLI 验证；本次使用厂商 CLI 已配置的默认模型。' } : {}),
      })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'model_router_team_execute',
    description: 'Plan a complex task into dependent work packages, route among configured providers with ready official CLIs, and run each package sequentially. Claude/Codex request the planned model ID; other CLIs use their configured default unless cliModelsJson supplies exact CLI names. Editable runs use one isolated Git worktree and integrate source changes after CLI success. Confirm the actual model from vendor records.',
    parameters: {
      task: { type: 'string', required: true, description: 'Full task to plan, distribute and execute.' },
      mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default read-only; workspace-write needs a clean Git repository and approval.' },
      budgetUsd: { type: 'number', description: 'Estimated planning ceiling only, not a vendor billing limit.' },
      cliModelsJson: { type: 'string', description: 'Optional JSON object mapping official tool IDs or work package IDs to exact model names configured in those CLIs. MiniMax/MiMo require provider/model; ZCode 3.14.3 cannot switch per call.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const mode = args.mode === 'workspace-write' ? 'workspace-write' : 'read-only'
      if (mode === 'workspace-write' && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能请求可编辑团队执行')
      const [routes, installed] = await Promise.all([discoverConfiguredRoutes(ctx, exec.signal), installedToolIds()])
      const readiness = await Promise.all(installed.map(id => officialToolReadiness(id, cwd)))
      const supported = new Set(readiness.filter(item => item.ready).map(item => item.id))
      const capabilities = new Map(officialToolExecutionCapabilities().map(item => [item.id, item]))
      const executableRoutes = routes.filter(route => {
        const tool = toolForProvider(route.provider)
        return tool && installed.includes(tool.id) && supported.has(tool.id)
          && capabilities.get(tool.id)?.modes?.includes(mode)
      })
      if (executableRoutes.length === 0) return jsonValue({ status: 'blocked',
        reason: `官方模型目录中没有同时满足已配置路线、已安装 CLI、托管执行适配器与 ${mode} 模式的供应商；Kimi、MiniMax、ZCode 仅支持经审批的 workspace-write。`,
        installed, executionCapabilities: officialToolExecutionCapabilities(), executionReadiness: readiness })
      const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
      const budgetUsd = Math.max(0, finiteNumber(args.budgetUsd, finiteNumber(configuredBudget, 0)))
      const plan = createPlanFromRoutes(args.task, executableRoutes, {
        mode: 'team', budgetUsd, installedToolIds: installed,
        runnableToolIds: installed.filter(id => supported.has(id)),
      })
      const bindingsText = text(args.cliModelsJson)
      if (bindingsText.length > 4_000) throw new Error('cliModelsJson 超过 4000 字符上限')
      let cliModels = null
      if (bindingsText) {
        try { cliModels = JSON.parse(bindingsText) }
        catch { throw new Error('cliModelsJson 不是有效的 JSON 对象') }
      }
      const execution = await runOfficialTeam({ plan, task: args.task, workspace: cwd,
        allowedRoot: root, mode, installedIds: installed, cliModels, signal: exec.signal, sandbox: ctx.sandbox })
      return jsonValue({ plan, execution,
        modelNotice: '团队向 Claude/Codex 请求 Harness 推荐模型 ID；其他厂商默认使用 CLI 已配置模型。cliModelsJson 可按工具或工作包指定准确 CLI 模型名。实际模型须以各厂商记录核对。',
        billingNotice: 'budgetUsd 仅影响估算与路由，无法限制官方 CLI 账号实际费用。' })
    },
  }))
}
