import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { approvalReasons, chooseConsultRoute, combinedAsk, commandText, decisionSummary, executeOfficialTeamPlan, explicitRoute, planOfficialTeam, securityBoundaries } from './shared/router-team.mjs'
import { botOfficialToolSnapshot } from './shared/bot-official-execution.mjs'
import { cancelInstall, currentInstallOptions, defaultRunner, ensureNpmPrefixOnPath, installPreferences, installStatus, planCommandLine, probeAllTools, probeToolWith, setInstallPreferences, startInstall, startRepair, startUninstall } from './shared/official-tools-runtime.mjs'
import { createRoutePlan, executeConfiguredAssignment } from './shared/router-planning.mjs'
import { createRunJobs } from './shared/run-jobs.mjs'
import { createTerminalManager, defaultLocate } from './shared/cli-terminal.mjs'
import { createTuiPromptRunner } from './shared/tui-executor.mjs'
import { DEFAULT_COOLDOWN_MINUTES } from './shared/subscription-billing.mjs'
import { DEFAULT_ROUTER_SETTINGS } from './shared/router.mjs'
import { DEFAULT_ROUTING_PRESET, routingPreset } from './shared/routing-presets.mjs'
import { executeBotOfficialTool, ledgerSummary, rateRecordedResult, rerunRecordedStep, rerunSupport } from './shared/router-runs.mjs'
import { guardLegacyTools, legacyPolicy, policyRequired, registerPolicyCommand, registerPolicyTool } from './shared/legacy-policy.mjs'
import { JSON_OUTPUT, boundedInteger, errorText, finiteNumber, jsonValue, routeKey, text, throwIfAborted, uniqueStrings, valueOf } from './shared/router-core-utils.mjs'
import { launchWorkbenchRun, previewWorkbenchRun } from './shared/router-workbench.mjs'
import { OFFICIAL_TOOLS, getOfficialTool, installCommandLine, installMethodFor, installMethodsFor } from './shared/official-tool-registry.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness } from './shared/official-tool-executor.mjs'
import { packagePlanKey, parsePackageAssignments } from './shared/package-assignments.mjs'
import { parseInstallPreferences, resolveInstallPlan } from './shared/tool-install-preferences.mjs'
import { parseRunJobRequest } from './shared/official-tools-remote.mjs'
import { parseTerminalRead, parseTerminalResize, parseTerminalStart, parseTerminalStop, parseTerminalWrite } from './shared/cli-terminal-protocol.mjs'
import { registerOfficialToolsRemote } from './official-tools-remote-service.mjs'
import { sessionWorkspace } from './shared/official-team-runtime.mjs'
import { SUBSCRIPTION_PAUSE_NOTICE, billingHealth, executeBudgetedConsult, installRouterStateStore, recentNotices, routerStateStore, savedState, toolHealthReport } from './shared/router-state-billing.mjs'
import { workbenchSubmissions } from './shared/workbench-submissions.mjs'

// Cordis plugin name, matching the profile entry id; unchanged by the 0.13.0 package rename.
export const name = 'model-router-galgame'
export const inject = ['commands', 'llm', 'tools', 'typert', 'sandboxPolicy', 'sandbox']

export function createRouterConfig(productFields = {}) {
  return z.object({
  requireBotPolicy: z.boolean().default(false),
  budgetUsd: z.number().min(0).max(1_000_000).default(DEFAULT_ROUTER_SETTINGS.budgetUsd).volatile(),
  maxConsultOutputChars: z.number().step(1).min(500).max(50_000).default(12_000).volatile(),
  modelProfilesJson: z.string().max(32_000).default('[]').volatile(),
  routingEvidenceJson: z.string().max(200_000).default('').volatile(),
  resourceLearningEnabled: z.boolean().default(true).volatile(),
  qualityEscalationEnabled: z.boolean().default(false).volatile(),
  qualityGateJson: z.string().max(8_000).default('').volatile(),
  routingPreset: z.union(['economy', 'balanced', 'quality']).default(DEFAULT_ROUTING_PRESET).volatile(),
  dailyBudgetUsd: z.number().min(0).max(1_000_000).default(0).volatile(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).default(0).volatile(),
  overBudgetAction: z.union(['downgrade', 'pause']).default('downgrade').volatile(),
  reviewMode: z.union(['off', 'sample', 'always']).default('off').volatile(),
  reviewSampleRate: z.number().min(0).max(1).default(0.2).volatile(),
  feedbackLearningEnabled: z.boolean().default(true).volatile(),
  feedbackHalfLifeDays: z.number().min(1).max(3650).default(30).volatile(),
  feedbackPriorWeight: z.number().min(1).max(1_000_000).default(3).volatile(),
  feedbackMaxAdjustment: z.number().min(0).max(0.1).default(0.04).volatile(),
  feedbackResetAt: z.number().min(0).default(0).volatile(),
  dynamicDataEnabled: z.boolean().default(false).volatile(),
  liveBenchEndpoint: z.string().max(2048).default('https://livebench.ai').volatile(),
  pricingSnapshotEndpoint: z.string().max(2048).default('').volatile(),
  dynamicDataTtlMinutes: z.number().min(1).max(10_080).default(1440).volatile(),
  allowManualReassign: z.boolean().default(true).volatile(),
  confirmUnsandboxedCli: z.boolean().default(true).volatile(),
  subscriptionCooldownMinutes: z.number().step(1).min(1).max(10_080).default(DEFAULT_COOLDOWN_MINUTES).volatile(),
  quotaPatternsJson: z.string().max(8_000).default('{}').volatile(),
  onSubscriptionFailure: z.union(['ask', 'api', 'fail']).default('ask').volatile(),
  // 官方工具安装设置：统一安装目录 + 下载源。两者都只在本机生效，不会随计划上传。
  toolInstallDir: z.string().max(4_096).default('').volatile(),
  toolNpmRegistry: z.string().max(2_048).default('https://registry.npmjs.org/').volatile(),
  toolInstallMethodsJson: z.string().max(8_000).default('{}').volatile(),
  toolScriptUrlsJson: z.string().max(8_000).default('{}').volatile(),
  toolAllowScriptInstall: z.boolean().default(true).volatile(),

  ...productFields,
  })
}
export const Config = createRouterConfig()

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
  const listed = [...routes.values()].sort((left, right) => routeKey(left).localeCompare(routeKey(right)))
  const policy = legacyPolicy(ctx)
  return policy ? policy.filterRoutes(listed) : listed
}

// Split into domain modules; the public surface below is unchanged.
export { billingForResult, billingHealth, currentQuotaSnapshot, executeBudgetedConsult, installRouterStateStore, routePricing, routerStateStore, toolHealthReport } from './shared/router-state-billing.mjs'
export { consultConfiguredModel, createRoutePlan, executeConfiguredAssignment, optionalService, planAssignment, reviewRunPackages, reviewerRoute } from './shared/router-planning.mjs'
export { executeBotOfficialTool, ledgerSummary, planToolRun, rateRecordedResult, recordTeamRun, recordToolRun, rerunRecordedStep, rerunSupport } from './shared/router-runs.mjs'
export { approvalReasonCodes, combinedAsk, confirmationReasons, decisionSummary, executableTeamRoutes, executeOfficialTeamPlan, planOfficialTeam, resolveTeamCliModelBindings, securityBoundaries } from './shared/router-team.mjs'
export { dryRunOutcome, launchWorkbenchRun, previewWorkbenchRun, startWorkbenchRun, workbenchWorkspace } from './shared/router-workbench.mjs'

/** Host operations behind the workbench RPC; the client never supplies commands or paths. */
/**
 * One terminal manager per Host plugin fiber. Sessions run outside the
 * Harness sandbox with the Host's login environment; only metadata is kept.
 */
export function createRouterTerminals(options = {}) {
  return createTerminalManager({
    prepare: () => ensureNpmPrefixOnPath(),
    preferences: () => installPreferences(),
    launchOptions: () => currentInstallOptions(),
    onSessionEnd: record => { void routerStateStore().appendTerminalSession(record).catch(() => {}) },
    onSessionUpdate: record => { void routerStateStore().appendTerminalSession(record).catch(() => {}) },
    ...options,
  })
}

async function terminalHistory(limit = 20) {
  const saved = await savedState()
  return (saved.terminalSessions ?? []).slice(-limit).reverse()
}

function terminalServices(terminals, assertPreferences = () => {}) {
  if (!terminals) return {}
  return {
    terminalInfo: async () => {
      const tools = await probeAllTools({ fresh: true })
      return { ...terminals.info(), tools, toolsCheckedAt: Date.now(), history: await terminalHistory() }
    },
    terminalStart: async request => { assertPreferences(); return terminals.start(parseTerminalStart(request)) },
    terminalRead: async request => terminals.read(parseTerminalRead(request)),
    terminalWrite: async request => terminals.write(parseTerminalWrite(request)),
    terminalResize: async request => terminals.resize(parseTerminalResize(request)),
    terminalStop: async request => terminals.stop(parseTerminalStop(request)),
  }
}

export function routerRemoteServices(ctx, config, { terminals = null, assertPreferences, runJobs = createRunJobs(), runOptions = {}, botRuntime = null, botRouting = null } = {}) {
  // Terminal tools (dsh-TUI) have no headless mode: the Host types into the managed PTY and
  // returns what it rendered. Built once, reused by every call of this Host fiber.
  const tuiRunner = terminals ? createTuiPromptRunner({ terminals, locate: (name, options) => defaultLocate(name, options) }) : null
  return {
    ...terminalServices(terminals, assertPreferences),
    ...(tuiRunner ? { tuiPrompt: request => tuiRunner.run({ tool: getOfficialTool(request.tool), prompt: request.prompt }) } : {}),
    // The independent Bot runtime is opt-in; without it these stay empty instead of pretending.
    ...(botRouting ? {
      botRoutingInspect: async () => botRouting.inspect(),
      botRoutingDecide: async request => botRouting.decide(request),
    } : {}),
    ...(botRuntime ? {
      botRuntimeStatus: async () => botRuntime.list(),
      botRuntimeMove: async request => botRuntime.move(request.botId, request.mode),
      botRuntimeHistory: async request => botRuntime.history(request.botId, { limit: request.limit }),
      // Full text is a separate, opt-in permission: the same call that shows previews must not
      // quietly return bodies when the operator never asked for that.
      botRuntimeMessage: async request => {
        if (valueOf(config, 'independentRuntime.fullTextHistory', false) !== true) throw new Error('HISTORY_FULLTEXT_DISABLED')
        return botRuntime.readMessage(request.botId, request.index)
      },
    } : {}),
    health: async fresh => {
      const report = await toolHealthReport({ fresh: fresh === true })
      const saved = await savedState()
      return { ...report, onboarding: saved.onboarding, notices: recentNotices(saved), billing: await billingHealth(ctx, config) }
    },
    completeOnboarding: async () => routerStateStore().completeOnboarding(Date.now()),
    ledger: () => ledgerSummary(config),
    rate: request => rateRecordedResult(request, { origin: 'desktop-ui' }),
    rerun: request => rerunRecordedStep(ctx, config, {
      runId: request?.runId, packageId: request?.packageId, provider: request?.provider, model: request?.model,
      confirmOverBudget: request?.confirmOverBudget === true, confirmWrite: request?.confirmWrite === true,
      confirmUnsandboxed: request?.confirmUnsandboxed === true,
      ...(request?.subscriptionChoice ? { subscriptionChoice: request.subscriptionChoice } : {}),
    }),
    boundaries: () => securityBoundaries(ctx, config),
    previewRun: request => previewWorkbenchRun(ctx, config, request, runOptions),
    startRun: request => launchWorkbenchRun(ctx, config, request, { ...runOptions, runJobs }),
    async runStatus(request) {
      const { jobId, requestKey } = parseRunJobRequest(request)
      if (!requestKey) return runJobs.status(jobId)
      return (await workbenchSubmissions(routerStateStore(), runJobs).lookup(requestKey)) ?? { status: 'not-found' }
    },
    async cancelRun(request) {
      const { jobId, requestKey } = parseRunJobRequest(request)
      if (!requestKey) return runJobs.cancel(jobId)
      const original = await workbenchSubmissions(routerStateStore(), runJobs).lookup(requestKey)
      if (!original) throw new Error('Unknown run job id.')
      return runJobs.lookup(original.jobId) ? runJobs.cancel(original.jobId) : original
    },
  }
}

/** Register model-facing tools and the human /router command. */
export function apply(ctx, config = {}, product = null) {
  product?.start?.(ctx, config, { installRouterStateStore, executeConfiguredAssignment, rerunRecordedStep, routerStateStore })
  guardLegacyTools(ctx, config)
  // Install addresses (directory, npm source, per-tool method and script source)
  // are volatile refs: Loader changes them without re-applying the plugin.
  // Read them after the owning fiber's live update, before a saved view is sent.
  let installPreferenceError = null
  const syncInstallPreferences = () => {
    try {
      const next = parseInstallPreferences(config, { tools: OFFICIAL_TOOLS, ...currentInstallOptions() })
      setInstallPreferences(next)
      installPreferenceError = null
    } catch (error) { installPreferenceError = errorText(error) }
  }
  const installFields = new Set(['toolInstallDir', 'toolNpmRegistry', 'toolInstallMethodsJson', 'toolScriptUrlsJson', 'toolAllowScriptInstall'])
  syncInstallPreferences()
  // Loader scopes this event to the fiber whose refs were committed.
  ctx.on('loader/volatile-update', paths => {
    if (Array.isArray(paths) && paths.some(path => installFields.has(path?.[0]))) syncInstallPreferences()
  })
  const assertInstallPreferences = () => {
    if (installPreferenceError) throw new Error(`官方工具安装设置无效：${installPreferenceError}`)
  }
  // The official Host injects typert; direct lightweight uses of apply may
  // supply only the model/command services and do not expose the Desktop RPC.
  if (ctx.typert) {
    const terminals = createRouterTerminals()
    const runJobs = createRunJobs()
    // Plugin unload or patch reload kills every interactive session.
    ctx.effect(() => {
      const onExit = () => { terminals.disposeAll('dispose'); runJobs.dispose() }
      process.once('exit', onExit)
      return () => { process.off('exit', onExit); terminals.disposeAll('dispose'); runJobs.dispose() }
    }, 'model-router-galgame: interactive terminals')
    const { botRuntime = null, botRouting = null } = product?.connect?.(ctx, config, { stateDir: dirname(routerStateStore().file), valueOf }) ?? {}
    registerOfficialToolsRemote(ctx, {
      ...routerRemoteServices(ctx, config, { terminals, runJobs, assertPreferences: assertInstallPreferences, botRuntime, botRouting }),
      requireBotPolicy: () => policyRequired(config),
      installSettingsError: () => installPreferenceError,
      installRequestedDirectory: () => valueOf(config, 'toolInstallDir', ''),
    })
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    // Refuse before installation/write approval prompts; the monotonic guard and
    // body wrapper repeat this check after asynchronous admission.
    if (exec.name.startsWith('model_router_')) {
      try { legacyPolicy(ctx, policyRequired(config))?.check({ kind: 'tool', name: exec.name, agent: exec.agent }) }
      catch (error) { return { kind: 'deny', reason: error.message } }
    }
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name === 'model_router_rate') {
      return { kind: 'ask', reason: 'Confirm the user\'s subjective rating; agents must not self-rate their results',
        displayReason: { en: 'Save this as your rating and adjust future recommendations?', zh: '确认这是你对该结果的评价，并用于调整以后的推荐？Agent 不能代替你给自己评分。' } }
    }
    if (exec.name === 'model_router_tool_install' || exec.name === 'model_router_tool_uninstall' || exec.name === 'model_router_tool_repair') {
      const requested = getOfficialTool(text(exec.arguments?.tool))
      const label = requested?.label ?? '官方 CLI'
      const method = installMethodFor(requested, text(exec.arguments?.method))
      const how = method ? `（${method.label}）` : ''
      const uninstalling = exec.name === 'model_router_tool_uninstall'
      const repairing = exec.name === 'model_router_tool_repair'
      const verb = uninstalling ? 'Uninstall' : repairing ? 'Reinstall to repair' : 'Install'
      return {
        kind: 'ask',
        reason: `${verb} ${label}${how} on this machine`,
        displayReason: {
          en: uninstalling
              ? `Uninstall ${label}${how}? Its settings, login and history are kept; only the program is removed.`
              : repairing
                ? `Reinstall ${label}${how} to repair a broken install?`
                : `Install ${label}${how} using the plugin's fixed source?`,
          zh: uninstalling
              ? `卸载 ${label}${how}？配置、登录信息和历史记录都会保留，只删除程序本身。`
              : repairing
                ? `重新安装 ${label}${how} 以修复损坏的安装？`
                : `使用插件固定的来源，在本机安装 ${label}${how}？`,
        },
      }
    }
    let rerunRun = null
    if (exec.name === 'model_router_rerun_step') {
      try { rerunRun = (await savedState()).runs.find(item => item.id === text(exec.arguments?.runId)) ?? null } catch { rerunRun = null }
    }
    const reasons = approvalReasons(exec.name, exec.arguments ?? {}, config, { sandboxAvailable: typeof ctx.sandbox?.confine === 'function', rerunRun })
    if (reasons.length) return combinedAsk(reasons)
    return decision
  })
  // A Bot's own library: same policy gate as every other owner tool, its own directory per Bot.
  product?.provideLibraries?.(ctx, config, { stateFile: routerStateStore().file, defineTool, registerPolicyTool, JSON_OUTPUT, jsonValue })
  registerOfficialToolModels(ctx, config, assertInstallPreferences)
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_routes',
    description: 'List provider/model routes registered in the official DeepSeek Harness model directory. Credential and network availability are not verified. No API keys or endpoints are returned.',
    parameters: {},
    output: JSON_OUTPUT,
    async execute(_args, exec) {
      const routes = await discoverConfiguredRoutes(ctx, exec.signal)
      return jsonValue({ routes, count: routes.length, availabilityNotice: '目录记录不证明账号凭据和网络当前可用。' })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_plan',
    description: 'Analyze task difficulty, recommend only configured Harness model routes, and optionally split compound work into dependent packages. Cost estimates require user-supplied USD prices for the exact routes.',
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
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_consult',
    description: 'Ask one already configured Harness model for an independent opinion. Supply both provider and model for an explicit route, or omit both for a recommended route different from the current model when available.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task or question for the consulted model.' },
      provider: { type: 'string', description: 'Configured provider id; pair with model.' },
      model: { type: 'string', description: 'Configured model id; pair with provider.' },
      outputLimit: { type: 'number', description: 'Maximum returned characters, from 500 to 50000.' },
      confirmOverBudget: { type: 'boolean', description: 'Only after explicit user approval when the API budget is exceeded or unverified.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const routes = await discoverConfiguredRoutes(ctx, exec.signal)
      if (routes.length === 0) throw new Error('Harness 模型目录中没有可用路线；请先在官方“模型”页添加模型。')
      const requested = explicitRoute(args, routes)
      const plan = requested ? null : await createRoutePlan(ctx, args.task, config, { signal: exec.signal })
      const route = requested ?? chooseConsultRoute(plan, routes, exec.agent)
      const fallback = valueOf(config, 'maxConsultOutputChars', 12_000)
      const limit = boundedInteger(args.outputLimit, finiteNumber(fallback, 12_000), 500, 50_000)
      return jsonValue(await executeBudgetedConsult(ctx, route, args.task, config, { routes, limit, signal: exec.signal, confirmOverBudget: args.confirmOverBudget === true }))
    },
  }))
  registerPolicyCommand(ctx, config, {
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
  registerPolicyCommand(ctx, config, {
    name: 'tools',
    description: 'Show official model CLI install status, or install/uninstall/repair one registry tool.',
    input: { hint: '留空查看状态；或输入 install/cancel/uninstall/repair/method <工具id> [安装方式]' },
    async handler({ rawInput, signal }) {
      const input = text(rawInput)
      const matched = input.match(/^(install|uninstall|repair|cancel|method)\s+([A-Za-z0-9_-]+)(?:\s+([A-Za-z0-9-]+))?$/i)
      if (!matched && input) {
        return { kind: 'error', text: '用法：/tools 查看状态，或 /tools install/uninstall/repair/cancel/method <工具id> [安装方式]' }
      }
      if (matched && matched[1].toLowerCase() === 'cancel') {
        try { return { kind: 'success', text: `已请求取消 ${cancelInstall(matched[2]).tool} 的安装；请使用 /tools 查看最新状态。` } }
        catch (error) { return { kind: 'error', text: `无法取消安装：${errorText(error)}` } }
      }
      if (matched && matched[1].toLowerCase() === 'method') {
        // Printing the methods is a read-only answer; persisting one is a config
        // change and stays in the settings form / workbench panel.
        const tool = getOfficialTool(matched[2])
        if (!tool) return { kind: 'error', text: `未知工具：${matched[2]}。` }
        const lines = installMethodsFor(tool).map(method => `• ${method.id}：${method.label}`)
        return {
          kind: 'success',
          text: lines.length
            ? `${tool.label} 可用的安装方式：\n${lines.join('\n')}\n在“模型路由工作台 → 官方工具”里切换，或在插件设置里固定默认方式。`
            : `${tool.label} 没有可切换的安装方式（不支持）。`,
        }
      }
      if (!matched) {
        try {
          const probes = await probeAllTools({ fresh: true })
          const lines = probes.map(probe => {
            const tool = getOfficialTool(probe.id)
            let command = null
            try { command = planCommandLine(resolveInstallPlan(tool, undefined, installPreferences(), currentInstallOptions())) }
            catch { command = installCommandLine(tool) }
            const status = probe.status === 'installed'
              ? `已安装 ${probe.version ?? ''}`
              : probe.status === 'unsupported'
                ? '不支持一键安装'
                : '未安装'
            const methods = installMethodsFor(tool).map(method => method.id).join(' / ')
            return `• ${tool.label}（${probe.id}）：${status}${methods ? `［${methods}］` : ''}`
              + `${command && probe.status === 'not-installed' ? `\n  安装：/tools install ${probe.id}（即 ${command}）` : ''}`
          })
          const header = installPreferenceError ? `⚠ 官方工具安装设置无效：${installPreferenceError}\n` : ''
          return { kind: 'success', text: `${header}官方工具状态：\n${lines.join('\n')}` }
        } catch (error) {
          return { kind: 'error', text: `探测失败：${errorText(error)}` }
        }
      }
      const action = matched[1].toLowerCase()
      const toolId = matched[2]
      const method = matched[3]
      try {
        assertInstallPreferences()
        const job = action === 'uninstall' ? startUninstall(toolId, { method })
          : action === 'repair' ? startRepair(toolId, { method })
            : startInstall(toolId, { method })
        const tool = getOfficialTool(toolId)
        const settled = await waitForInstall(job.tool, signal)
        const done = { uninstall: '卸载完成', repair: '修复完成', install: '安装完成' }[action]
        if (settled.status === 'succeeded') {
          const probe = await probeToolWith(tool, defaultRunner, { cacheMs: 0 })
          const suffix = probe.version ? `，探测版本 ${probe.version}` : ''
          if (settled.error) return { kind: 'success', text: `${tool.label} ${done}${suffix}。${settled.error}` }
          return { kind: 'success', text: `${tool.label} ${done}${suffix}。` }
        }
        return { kind: 'error', text: `${tool.label} ${action === 'uninstall' ? '卸载' : action === 'repair' ? '修复' : '安装'}失败：${settled.error ?? '未知原因'}\n${settled.outputTail.slice(-6).join('\n')}` }
      } catch (error) {
        return { kind: 'error', text: `无法开始${action === 'uninstall' ? '卸载' : '安装'}：${errorText(error)}` }
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
function registerOfficialToolModels(ctx, config, assertInstallPreferences) {
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tools',
    description: 'Probe the fixed registry of official model tools (Kimi Code, Claude Code, Codex, MiniMax Code, MiMo Code, Grok Build, Gemini CLI, OpenCode, Step Code, ZCode CLI) and report which are installed with their versions, plus each tool\'s available install methods and the effective install directory and npm source. Never reads credentials.',
    parameters: {},
    output: JSON_OUTPUT,
    async execute(_args, exec) {
      throwIfAborted(exec.signal)
      const botTools = await botOfficialToolSnapshot(ctx)
      if (botTools !== null) return jsonValue({ tools: botTools, source: 'bot-authorized-catalog',
        notice: '仅列出此 Bot 的工具目录；modes 是入口支持的模式，普通 Bot 仍受已保存 grant 限制，执行前会重新检测与核验。' })
      const probes = await probeAllTools()
      return jsonValue({
        tools: probes,
        executionCapabilities: officialToolExecutionCapabilities(),
        executionReadiness: await Promise.all(probes.map(probe => probe.installed
          ? officialToolReadiness(probe.id)
          : Promise.resolve({ id: probe.id, ready: false, reason: 'CLI 尚未安装或版本检测失败。' }))),
        installMethods: Object.fromEntries(OFFICIAL_TOOLS.map(tool => [tool.id, installMethodsFor(tool).map(method => ({
          id: method.id, label: method.label, kind: method.kind,
        }))])),
        installHint: '未安装的工具可由 model_router_tool_install 按注册表固定命令安装，损坏的用 model_router_tool_repair 修复，多余的用 model_router_tool_uninstall 卸载；安装目录与下载源来自用户设置，版本与包名不接受自定义。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tool_install',
    description: 'Install one official model tool by registry id from its fixed source at the latest release, using one of that tool\'s declared install methods (npm, pnpm, vendor installer script or verified GitHub release archive). ZCode CLI offers the fixed @ljwei-stak/zcode-cli npm package (complete runtime, no separate GitHub download) and the default community-maintained Alice-Marx/zcode-cli GitHub Release archive; each uses the selected method and saved directory/source settings. Recognized legacy ZCode desktop launchers are backed up before npm installation; unrecognized conflicting files are preserved without --force. Only registry ids and declared method ids are accepted; arbitrary packages, URLs or executables are refused. The install directory and download sources come from the user\'s own plugin settings.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Registry tool id, e.g. kimi-code.' },
      method: { type: 'string', description: 'Install method id for this tool, e.g. npm, pnpm, script-bash, script-powershell or github-release. Omit to use the user\'s configured default.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      assertInstallPreferences()
      const job = startInstall(args.tool, { method: text(args.method) || undefined })
      const settled = await waitForInstall(job.tool, exec.signal)
      const tool = getOfficialTool(args.tool)
      const probe = settled.status === 'succeeded'
        ? await probeToolWith(tool, defaultRunner, { cacheMs: 0 })
        : null
      return jsonValue({
        ...settled,
        postInstallProbe: probe,
        notice: '安装命令完全来自服务端注册表与用户设置；实际版本以探测横幅为准。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tool_repair',
    description: 'Reinstall one official model tool by registry id, even when it already reports the latest version, to repair a broken or incomplete install. Settings and login are kept. Only registry ids and declared method ids are accepted.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Registry tool id, e.g. codex.' },
      method: { type: 'string', description: 'Install method id for this tool. Omit to use the user\'s configured default.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      assertInstallPreferences()
      const job = startRepair(args.tool, { method: text(args.method) || undefined })
      const settled = await waitForInstall(job.tool, exec.signal)
      const tool = getOfficialTool(args.tool)
      const probe = settled.status === 'succeeded'
        ? await probeToolWith(tool, defaultRunner, { cacheMs: 0 })
        : null
      return jsonValue({
        ...settled,
        postInstallProbe: probe,
        notice: '修复会重新执行同一条固定官方安装命令；工具的配置与登录信息不受影响。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tool_uninstall',
    description: 'Remove one official model tool by registry id. Package-manager installs are removed with the same manager; vendor-script installs delete only the executable the vendor installer placed, plus that install\'s own PATH entry in the shell profile. Configuration, credentials and session history are always kept. Only registry ids and declared method ids are accepted.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Registry tool id, e.g. opencode.' },
      method: { type: 'string', description: 'The install method it was installed with, so the matching removal runs. Omit to use the user\'s configured default.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      assertInstallPreferences()
      const job = startUninstall(args.tool, { method: text(args.method) || undefined })
      const settled = await waitForInstall(job.tool, exec.signal)
      const tool = getOfficialTool(args.tool)
      return jsonValue({
        ...settled,
        notice: '卸载只删除程序本身；工具的配置、登录信息和历史记录保留，重新安装后仍在。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_tool_run',
    description: 'Run one authorized official CLI in the Host-selected workspace, independently of the Bot chat model. Omit cliModel to use its saved CLI selection, or use vendor-default for the CLI configuration. Exact names require a matching Host-authorized identity. Optional provider/model are a configured vendor route for pricing, not the Bot chat route. Write mode needs approval and a clean Git repository. Unavailable Bot tools do not fall back to portable CLIs or APIs.',
    parameters: {
      tool: { type: 'string', required: true, description: 'Fixed registry tool id, e.g. claude-code or codex.' },
      task: { type: 'string', required: true, description: 'Concrete task for the official CLI model.' },
      provider: { type: 'string', description: 'Optional configured provider, paired with model.' },
      model: { type: 'string', description: 'Optional model ID from the Harness directory, paired with provider. This ID is advisory for CLIs except Claude/Codex.' },
      cliModel: { type: 'string', description: 'Optional Host-authorized CLI identity. vendor-default follows the CLI configuration and is never passed as a real model name. Omit to use the saved selection. Exact names without provider/model require the Host Bot authorization service. ZCode cannot switch models per call.' },
      mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default is read-only. Kimi, MiniMax and ZCode require workspace-write. Write mode requires official approval and a clean Git repository.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      return jsonValue(await executeBotOfficialTool(ctx, config, args, { signal: exec.signal, cwd, root, sandboxMode,
        confirmOverBudget: args.confirmOverBudget === true }))
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_execute',
    description: 'Run a task on configured models and aggregate the results. Omit provider and model to route first. Supply both to use that one model and skip routing. With assignmentMode manual, use the packagePlanKey from model_router_plan and packageAssignmentsJson to pin each package to an exact API route or registered official tool. Manual tool failures do not fall back to API. Automatic profiles retain CLI/API billing policy. This call is read-only and does not apply file edits.',
    parameters: {
      task: { type: 'string', required: true, description: 'Task to execute.' },
      provider: { type: 'string', description: 'Configured provider. Pair with model to bypass routing.' },
      model: { type: 'string', description: 'Configured model. Pair with provider to bypass routing.' },
      planMode: { type: 'string', enum: ['single', 'team'], description: 'Used only when provider and model are omitted.' },
      assignmentMode: { type: 'string', enum: ['algorithm', 'manual'], description: 'Use algorithm recommendations, or pin every decomposed package to the user-selected API model or official tool.' },
      packagePlanKey: { type: 'string', description: 'Required for manual mode: the current decomposition key returned by model_router_plan for the same task and mode.' },
      packageAssignmentsJson: { type: 'string', description: 'Required for manual mode: JSON object keyed by every package id, values {kind:"api",provider,model} or {kind:"tool",toolId}. Tools use their configured default model. No commands or arguments.' },
      budgetUsd: { type: 'number', description: 'Optional local estimate ceiling when routing. Not a vendor billing cap.' },
      preset: { type: 'string', enum: ['economy', 'balanced', 'quality'], description: 'Optional routing preset for this call; defaults to the saved setting.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd } = await sessionWorkspace(ctx, exec)
      const configuredBudget = valueOf(config, 'budgetUsd', DEFAULT_ROUTER_SETTINGS.budgetUsd)
      let assignments
      if (args.packageAssignmentsJson !== undefined) {
        if (typeof args.packageAssignmentsJson !== 'string' || args.packageAssignmentsJson.length > 32_000) throw new Error('工作包分配 JSON 超出限制。')
        try { assignments = parsePackageAssignments(JSON.parse(args.packageAssignmentsJson)) }
        catch { throw new Error('工作包分配 JSON 无效；请按包 ID 提供模型 API 或官方工具目标。') }
      }
      const result = await executeConfiguredAssignment(ctx, args.task, config, {
        provider: args.provider,
        model: args.model,
        planMode: args.planMode,
        assignmentMode: args.assignmentMode,
        ...(assignments === undefined ? {} : { packageAssignments: assignments }),
        ...(args.packagePlanKey === undefined ? {} : { packagePlanKey: args.packagePlanKey }),
        preset: args.preset,
        budgetUsd: finiteNumber(args.budgetUsd, finiteNumber(configuredBudget, 0)),
        confirmOverBudget: args.confirmOverBudget === true,
        workspace: cwd,
        signal: exec.signal,
      })
      return jsonValue({
        routingBypassed: result.plan.routingBypassed === true,
        selected: result.plan.selected,
        decision: decisionSummary(result.plan),
        budget: result.budget,
        ...(result.paused ? { status: 'paused-budget' } : result.awaitingConfirmation ? { status: 'paused-subscription-failure', awaitingConfirmation: result.awaitingConfirmation } : {}),
        execution: result.execution,
        runId: result.runId ?? null,
        reviews: result.reviews ?? [],
        notice: result.paused
          ? '已因预算暂停，未启动任何模型。请向用户说明预估费用，用户同意后再以 confirmOverBudget: true 调用。'
          : result.awaitingConfirmation ? SUBSCRIPTION_PAUSE_NOTICE
          : result.plan.assignmentMode === 'manual' ? '已按手动分配执行只读工作包；API 模型和官方工具目标固定，工具使用厂商默认模型，失败不会自动改派。可用 model_router_rerun_step 按保存的目标重跑。'
          : '官方 CLI 以只读无界面方式运行。可编辑改动仍使用 model_router_tool_run 或 model_router_team_execute。未安装、未登录、失败或配置为 api 的模型走模型目录 API；回退原因与 CLI 原始错误见 fallback。可用 model_router_rerun_step 重跑失败步骤，model_router_rate 记录评价。',
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_health',
    description: 'Onboarding health check: for each official CLI in the fixed registry, report installed version, the latest published version when it can be looked up cheaply (update hint only), and login state (cheap status commands only; never starts a login), plus a per-provider billing table: billing mode (subscription-first by default), subscription state (logged in / coding-plan key route / exhausted until a time) and whether an API-key route is available for fallback. Logged-out tools are skipped by routing until re-checked.',
    parameters: {
      fresh: { type: 'boolean', description: 'Re-probe instead of using the 60s probe cache.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      throwIfAborted(exec.signal)
      const report = await toolHealthReport({ fresh: args.fresh === true })
      return jsonValue({ ...report, notices: recentNotices(await savedState()), billing: await billingHealth(ctx, config, { signal: exec.signal }) })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_rerun_step',
    description: 'Re-run one failed work package of a recorded model_router_execute or model_router_team_execute run without restarting finished packages; unfinished downstream packages follow. An editable (workspace-write) team run that stopped at a failed step continues in a fresh isolated Git worktree seeded with the earlier changes (needs approval, a clean repository at the same commit). A failed model_router_tool_run call (packageId "direct") is repeated as a new linked run. Supply provider and model to reassign a routed or team package to another configured route (if the user allows manual reassignment).',
    parameters: {
      runId: { type: 'string', required: true, description: 'runId returned by model_router_execute.' },
      packageId: { type: 'string', required: true, description: 'Work package id to re-run.' },
      provider: { type: 'string', description: 'Optional configured provider to reassign to; pair with model.' },
      model: { type: 'string', description: 'Optional configured model to reassign to; pair with provider.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the budget. Triggers an approval prompt.' },
      subscriptionChoice: { type: 'string', enum: ['api', 'subscription', 'cancel'], description: 'Only for a step paused after a non-quota subscription failure, and only with the user\'s decision: api = retry on the API key (approval prompt), subscription = retry the subscription, cancel = stop the step and its waiting downstream steps.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const stored = (await savedState()).runs.find(item => item.id === text(args.runId))
      if (stored && rerunSupport(stored).writes && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能重跑可编辑的运行')
      // The pre-execute hook already asked the user about file edits for editable reruns.
      const result = await rerunRecordedStep(ctx, config, {
        runId: args.runId, packageId: args.packageId, provider: args.provider, model: args.model,
        confirmOverBudget: args.confirmOverBudget === true, confirmWrite: true, confirmUnsandboxed: stored?.executionEnvironment === 'cli-native', workspace: cwd, root, signal: exec.signal,
        ...(text(args.subscriptionChoice) ? { subscriptionChoice: text(args.subscriptionChoice) } : {}),
      })
      return jsonValue({
        ...(result.paused ? { status: 'paused-budget' } : result.cancelled ? { status: 'cancelled' } : result.awaitingConfirmation ? { status: 'paused-subscription-failure', awaitingConfirmation: result.awaitingConfirmation, notice: SUBSCRIPTION_PAUSE_NOTICE } : {}),
        budget: result.budget, execution: result.execution ?? null, runId: result.run?.id ?? args.runId,
        ...(result.rerunOf ? { rerunOf: result.rerunOf, newRunId: result.newRunId } : {}),
      })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_rate',
    description: 'Record only the user\'s explicitly stated rating of one recorded result (up, down, clear). Requires approval; never self-rate. Feedback adjusts bounded local subjective utility, not objective quality.',
    parameters: {
      runId: { type: 'string', required: true, description: 'runId returned by model_router_execute.' },
      packageId: { type: 'string', required: true, description: 'Work package id.' },
      rating: { type: 'string', required: true, enum: ['up', 'down', 'clear'], description: 'The user\'s rating.' },
      expectedFinishedAt: { type: 'number', description: 'Completion timestamp of the displayed result; rejects stale feedback after a rerun.' },
    },
    output: JSON_OUTPUT,
    async execute(args) {
      const run = await rateRecordedResult(args, { origin: 'approved-tool' })
      return jsonValue({ ok: true, runId: run.id, packageId: args.packageId, rating: args.rating })
    },
  }))
  registerPolicyTool(ctx, config, defineTool({
    name: 'model_router_team_execute',
    description: 'Plan a complex task into dependent work packages, route among configured providers with ready official CLIs, and run each package sequentially. Every CLI uses its own default unless a saved cliModel mapping or cliModelsJson supplies exact CLI names. Editable runs use one isolated Git worktree and integrate source changes after CLI success. Confirm the actual model from vendor records.',
    parameters: {
      task: { type: 'string', required: true, description: 'Full task to plan, distribute and execute.' },
      mode: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default read-only; workspace-write needs a clean Git repository and approval.' },
      executionEnvironment: { type: 'string', enum: ['harness', 'cli-native'], description: 'Default harness. cli-native requires workspace-write and separate approval: normal vendor tools run with current user permissions outside Harness sandbox; Git isolation only collects changes.' },
      budgetUsd: { type: 'number', description: 'Estimated planning ceiling only, not a vendor billing limit.' },
      cliModelsJson: { type: 'string', description: 'Optional JSON object mapping official tool IDs or work package IDs to exact model names configured in those CLIs. MiniMax/MiMo require provider/model; ZCode cannot switch per call.' },
      confirmOverBudget: { type: 'boolean', description: 'Set only after the user agreed to exceed the daily/monthly budget. Triggers an approval prompt.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { cwd, root, sandboxMode } = await sessionWorkspace(ctx, exec)
      const mode = args.mode === 'workspace-write' ? 'workspace-write' : 'read-only'
      if (mode === 'workspace-write' && sandboxMode === 'read-only') throw new Error('当前 Harness 会话为只读模式，不能请求可编辑团队执行')
      const planned = await planOfficialTeam(ctx, config, { ...args, mode }, { workspace: cwd, signal: exec.signal })
      return jsonValue(await executeOfficialTeamPlan(ctx, config, planned, {
        workspace: cwd, root, signal: exec.signal, confirmOverBudget: args.confirmOverBudget === true,
        confirmUnsandboxed: args.executionEnvironment === 'cli-native',
      }))
    },
  }))
}
