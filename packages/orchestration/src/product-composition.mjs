import { createBotRoutingService } from './bot-routing-service.mjs'
import { openBotRoutingSettings } from './bot-routing-settings.mjs'
import { createWorkerBindingCommitter } from './bot-routing-dispatch.mjs'
import { createBotTurnBackends } from './bot-routing-runtime.mjs'
import { createRoutineExecutionService } from './routine-execution.mjs'
import { createMachineHeartbeat } from './machine-heartbeat.mjs'
import { pairMainMachine } from './pair-main-machine.mjs'
import { assertHandoffAllowed, buildHandoff, createHandoffLedger } from './bot-handoff.mjs'
import { listRoles } from './bot-roles.mjs'
import { hostname } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defaultStatePath, resolveStateHome } from '../../../.dsh-plugin/shared/router-state.mjs'
import { actualCost } from '../../../.dsh-plugin/shared/run-ledger.mjs'
import { reservationSpending } from '../../../.dsh-plugin/shared/budget-reservations.mjs'
import { openProductFunding } from './product-funding.mjs'
import { createAuthority } from '../../capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from './principals.mjs'
import { createBotPolicy } from './bot-policy.mjs'
import { createBotProduct } from '../../../modules/bot-runtime/index.mjs'
import { openRemoteMachines } from './remote-machines.mjs'
import { guardMachineSecrets } from './machine-secrets.mjs'
import { openBotSettings } from './bot-settings.mjs'
import { openFundingAccounts } from './funding-accounts.mjs'
import { createModelAccounting } from './model-accounting.mjs'
import { createTaskService } from './task-service.mjs'
import { inspectProductTask, projectProductTask } from './task-product.mjs'
import { createDesktopActions } from './desktop-actions.mjs'
import { registerTaskTools } from './task-tools.mjs'
import { createMrReadBackend } from './mr-read-backend.mjs'
import { createCliReadBackend } from './cli-execution.mjs'
import { createRemoteWriteBackend } from './remote-execution.mjs'
import { createRemoteCommandBackend } from './remote-command-execution.mjs'
import { createRemoteCliReadBackend } from './remote-cli-execution.mjs'
import { canonicalTaskJson, parseRemoteTaskCli, taskHash } from './task-contract.mjs'
import { acquireMigrationShared } from './migration-fence.mjs'
import { assertMigrationStartupAllowed } from './migration-startup-gate.mjs'
import { registerRemoteComputerTools } from './remote-computer-tools.mjs'

// The default Bot grant exposes the complete router through the same policy.
// Exact model routes and side-effect approvals remain independently enforced.
export const PRODUCT_TOOLS = Object.freeze(['model/infer',
  'tool/model_router_routes', 'tool/model_router_plan', 'tool/model_router_consult', 'tool/model_router_health', 'tool/model_router_tools',
  'tool/model_router_execute', 'tool/model_router_team_execute', 'tool/model_router_tool_run', 'tool/model_router_rerun_step',
  'tool/model_router_tool_install', 'tool/model_router_tool_repair', 'tool/model_router_tool_uninstall', 'tool/model_router_rate',
  'command/router', 'tool/bot_library_list', 'tool/bot_library_read', 'tool/bot_library_write', 'tool/bot_library_search', 'tool/bot_route_task',
  'tool/bot_routine_list', 'tool/bot_routine_save', 'tool/bot_routine_run'])
export const PRODUCT_OWNER_READ_METHODS = Object.freeze(['list','installSettings','status','health','ledger','boundaries','previewRun','runStatus','terminalInfo','terminalRead'])
export const PRODUCT_OWNER_WRITE_METHODS = Object.freeze(['completeOnboarding','rateResult','rerunStep','startRun','cancelRun','installTool','uninstallTool','repairTool','cancel','terminalStart','terminalWrite','terminalResize','terminalStop'])
// The Bot runtime reports descriptive call origins; the durable receipt schema
// keeps its closed vocabulary. The adapter is explicit: an unmapped origin is
// refused by the accounting layer instead of being invented.
const RECEIPT_SOURCE = Object.freeze({ 'bot-session': 'bot', 'bot-auxiliary': 'aux' })
const ROUTE_REFRESH_MS = 30_000
const ROUTE_REFRESH_DEBOUNCE_MS = 2_000
const INITIAL_ROUTE_TIMEOUT_MS = 5_000
const OBSERVATION_LIMIT = 256
const validPolicy = value => Boolean(value) && ['run', 'check', 'filterRoutes'].every(key => typeof value[key] === 'function')
// N09: one managed Task runner over the same SQLite authority. A crashed Host
// cannot release its runner lease, so the next boot waits for it to expire
// instead of silently dropping every managed task.
const TASK_RUNNER_TTL_MS = 10_000
const TASK_RUNNER_CLAIM_MS = 12_000
// Frequent enough that a stopped runner is rebuilt inside one lease period,
// rare enough that a healthy Host only reads one row every five seconds.
const TASK_RUNNER_WATCHDOG_MS = 5_000
const TASK_TTL_MS = 120_000
const TASK_BACKEND_LIMIT = 64
const TASK_READ_LIMIT = 512
const CLI_DEADLINE_MS = 120_000
const CLI_MODEL = /^gpt-[A-Za-z0-9_.-]+$/
const CLI_ENTRY_VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/
const TASK_TOOLS = Object.freeze(['task/execute', 'task/submit', 'task/read', 'task/cancel', 'task/retry', 'task/reconcile'])
const TASK_CAPABILITY = Object.freeze({ id: 'managed-tasks', label: '托管任务',
  tools: Object.freeze([...TASK_TOOLS, 'execution/mr-api', 'execution/mr-retry', 'execution/mr-observe',
    'execution/bot-turn', 'execution/bot-turn-retry', 'execution/bot-turn-observe']) })
const CLI_GRANT_TOOLS = Object.freeze(['cli/codex', 'cli/cancel', 'cli/read', 'cli/retry'])
const MR_BACKEND = Object.freeze({ id: 'mr-api', version: 'mr-read-product-v1',
  capability: 'execution/mr-api', retryCapability: 'execution/mr-retry', reconcileCapability: 'execution/mr-observe' })
const CLI_BACKEND = Object.freeze({ id: 'codex-read', version: 'cli-read-product-v1',
  capability: 'cli/codex', retryCapability: 'cli/retry', reconcileCapability: 'cli/read' })

/**
 * Compile one Bot's authority from its committed configuration. A Bot whose
 * exact provider/model is not a configured route keeps no model authority:
 * the strict rule pauses it instead of silently switching models.
 */
export function compileProductGrant(bot, { routes, hydrated }) {
  const key = typeof bot?.model === 'string' ? bot.model : ''
  const slash = key.indexOf('/')
  const provider = slash > 0 ? key.slice(0, slash) : ''
  const model = slash > 0 ? key.slice(slash + 1) : ''
  return { tools: [...PRODUCT_TOOLS],
    modelRoutes: hydrated && provider && model && routes.has(key) ? [{ provider, model }] : [] }
}

/**
 * An action that is only meaningful for a signed-in person says so at its own
 * entry. The authorization seam decides who may call, but a route that forgets to
 * declare its caller class inherits whatever the seam defaults to, and a later
 * change there would hand a non-owner somebody's console.
 */
const ownerOnly = fn => (payload, context) => {
  if (context?.kind !== 'owner') throw Object.assign(new Error('OWNER_ONLY'), { code: 'OWNER_ONLY' })
  return fn(payload, context)
}

/** Subscription usage is not API spend; missing token evidence stays unknown. */
export function projectModelCallAmount(receipt, resolution = null) {
  if (resolution) return resolution.costUsd
  if (receipt.funding === 'subscription') return 0
  return actualCost({ usage: receipt.usage, usageIncomplete: !receipt.usageComplete,
    reportedCostUsd: receipt.reportedCostUsd }, receipt.pricing).costUsd
}

const taskInput = input => {
  const value = JSON.parse(canonicalTaskJson(input))
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1
    || typeof value.task !== 'string' || !value.task.trim() || Buffer.byteLength(value.task) > 2000) {
    throw Object.assign(new Error('INVALID_TASK_INPUT'), { code: 'INVALID_TASK_INPUT' })
  }
  return value
}

/**
 * Host-configured official CLI entry. The executable, digest and version come
 * from installation verification (`pinCodexExecutable` re-pins them at probe
 * time); neither a Bot nor a Task input can supply an entry.
 */
export function normalizeTaskCli(value) {
  if (value === undefined || value === null) return null
  const entry = value.entry
  const remote = (Array.isArray(value.remote) ? value.remote : []).map(profile => {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)
      || Object.keys(profile).some(key => !['machineId','rootId','profileId','profileRevision','entry'].includes(key))
      || !['machineId','rootId','profileId'].every(key => typeof profile[key] === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(profile[key]))
      || !Number.isSafeInteger(profile.profileRevision) || profile.profileRevision < 1
      || !profile.entry || Object.keys(profile.entry).some(key => !['sha256','version'].includes(key))
      || !/^[a-f0-9]{64}$/.test(profile.entry.sha256 ?? '') || !CLI_ENTRY_VERSION.test(profile.entry.version ?? '')) throw new TypeError('TASK_CLI_REMOTE_PROFILE_INVALID')
    return Object.freeze({ machineId: profile.machineId, rootId: profile.rootId, profileId: profile.profileId, profileRevision: profile.profileRevision,
      entry: Object.freeze({ sha256: profile.entry.sha256, version: profile.entry.version }) })
  })
  if (new Set(remote.map(profile => `${profile.machineId}/${profile.rootId}`)).size !== remote.length) throw new TypeError('TASK_CLI_REMOTE_PROFILE_DUPLICATE')
  if (!entry && !remote.length) throw new TypeError('TASK_CLI_ENTRY_REQUIRED')
  if (entry && (typeof entry.executable !== 'string' || !isAbsolute(entry.executable)
    || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
    || typeof entry.version !== 'string' || !CLI_ENTRY_VERSION.test(entry.version))) throw new TypeError('TASK_CLI_ENTRY_REQUIRED')
  const models = (Array.isArray(value.models) ? value.models : []).map(model => {
    if (!model || typeof model.provider !== 'string' || typeof model.model !== 'string'
      || typeof model.cliModel !== 'string' || !CLI_MODEL.test(model.cliModel)) throw new TypeError('TASK_CLI_MODEL_REQUIRED')
    return { provider: model.provider, model: model.model, cliModel: model.cliModel }
  })
  if (new Set(models.map(model => `${model.provider}/${model.model}/${model.cliModel}`)).size !== models.length) throw new TypeError('TASK_CLI_MODEL_DUPLICATE')
  if (value.sessionFactory !== undefined && typeof value.sessionFactory !== 'string') throw new TypeError('TASK_CLI_SESSION_FACTORY_REQUIRED')
  return Object.freeze({ entry: entry ? Object.freeze({ executable: entry.executable, sha256: entry.sha256, version: entry.version }) : null,
    models: Object.freeze(models), remote: Object.freeze(remote), sessionFactory: value.sessionFactory ?? null })
}

/**
 * Stable managed Task backends for the default product.
 *
 * The durable target contract (id, version, effect, location, capabilities)
 * is fixed per backend kind, while the execution target, model and money are
 * resolved at run time from the submitting Bot's committed binding. A binding
 * change therefore never rewrites a persisted target hash: retries and
 * reconciliations of older tasks stay admissible, and each Bot is charged at
 * its own configured price. The Bot binding is the single source of truth for
 * both the grant and the money, so no service-level model check is needed.
 */
export function createTaskBackends({ ctx, mr, authority, directory, store, machineId, workspaceId, workspace, runtimeRoot, bindingFor, cli = null }) {
  if (typeof bindingFor !== 'function' || typeof directory?.forBot !== 'function') throw new TypeError('TASK_BACKEND_SERVICES_REQUIRED')
  if (store?.kind !== 'sqlite-router-state') throw new TypeError('TASK_BACKEND_STORE_REQUIRED')
  const inners = new Map()
  const innerFor = (kind, botId, build) => {
    const key = taskHash({ kind, botId, ...build.key })
    const cached = inners.get(key)
    if (cached) return cached
    if (inners.size >= TASK_BACKEND_LIMIT) return null
    const value = build.create()
    inners.set(key, value)
    return value
  }
  const mrInnerFor = botId => {
    const binding = bindingFor(botId)
    const settings = binding?.status === 'available' ? binding.settings : null
    const funding = settings?.funding ?? null
    if (!settings?.model?.provider || !settings.model.model || funding?.mode !== 'api'
      || !funding.pricing || !funding.request || funding.dailyBudgetUsd === null) return null
    const model = { provider: settings.model.provider, model: settings.model.model }
    const pricing = funding.pricing, dailyBudgetUsd = funding.dailyBudgetUsd
    return innerFor('mr', botId, { key: { model, pricing, dailyBudgetUsd },
      create: () => createMrReadBackend({ ctx, mr, model, workspace, machineId, workspaceId, pricing, dailyBudgetUsd }) })
  }
  const cliInnerFor = botId => {
    if (!cli) return null
    const binding = bindingFor(botId)
    const settings = binding?.status === 'available' ? binding.settings : null
    const funding = settings?.funding ?? null
    const tool = settings?.officialTools?.find(item => item.toolId === 'codex' && item.mode === 'read-only')
    if (!settings?.model?.provider || !settings.model.model || !tool || !funding?.scopeId) return null
    if (funding.mode === 'api' && (!funding.pricing || !funding.request)) return null
    if (funding.mode === 'subscription' && !(funding.subscription?.dailyCalls >= 1)) return null
    const model = { provider: settings.model.provider, model: settings.model.model }
    const billing = funding.mode
    const pricing = billing === 'api' ? funding.pricing : null
    const estimatedCostUsd = billing === 'api'
      ? (funding.request.maxInputTokens * pricing.input + funding.request.maxOutputTokens * pricing.output) / 1e6 : null
    const dailyLimitUsd = funding.dailyBudgetUsd ?? 0, monthlyLimitUsd = funding.monthlyBudgetUsd ?? 0
    const subscriptionMaxCalls = billing === 'subscription' ? funding.subscription.dailyCalls : null
    return innerFor('cli', botId, { key: { model, cliModel: tool.cliModel, billing, pricing, dailyLimitUsd, monthlyLimitUsd, subscriptionMaxCalls },
      create: () => createCliReadBackend({ store, authority, directory, entry: cli.entry, runtimeRoot, workspace, machineId, workspaceId,
        model, requestedModel: tool.cliModel, billing, pricing, estimatedCostUsd, dailyLimitUsd, monthlyLimitUsd,
        subscriptionMaxCalls, deadlineMs: CLI_DEADLINE_MS, tools: [], handlers: [], sessionFactory: cli.sessionFactory }) })
  }
  const backend = (spec, resolve) => Object.freeze({
    id: spec.id, version: spec.version, effect: 'read', machineId, workspaceId, location: 'local',atomicAdmission:true,
    capability: spec.capability, retryCapability: spec.retryCapability, reconcileCapability: spec.reconcileCapability,
    parse: taskInput,
    run: context => { const inner = resolve(context.ownerBotId); return inner ? inner.run(context) : { outcome: 'failed', summary: { code: 'TASK_BINDING_UNAVAILABLE' } } },
    reconcile: context => { const inner = resolve(context.ownerBotId); return inner ? inner.reconcile(context) : { outcome: 'unknown', reason: 'TASK_BINDING_UNAVAILABLE' } },
  })
  const backends = [backend(MR_BACKEND, mrInnerFor)]
  if (cli) backends.push(backend(CLI_BACKEND, cliInnerFor))
  return Object.freeze({ backends: Object.freeze(backends),
    catalog: () => backends.map((item, index) => ({ id: item.id, version: item.version, effect: item.effect, location: item.location,
      capability: item.capability, label: index === 0 ? '模型路由只读任务' : '官方 CLI 只读任务' })) })
}

function createRemoteCliTaskBackend({machines,directory,store,authority,profiles,bindingFor}){
 const inners=new Map()
 const resolve=botId=>{
  const binding=bindingFor(botId),settings=binding?.status==='available'?binding.settings:null,funding=settings?.funding??null
  const tool=settings?.officialTools?.find(item=>item.toolId==='codex'&&item.mode==='read-only')
  if(!settings?.model?.provider||!settings.model.model||!tool||!funding?.scopeId)return null
  if(funding.mode==='api'&&(!funding.pricing||!funding.request))return null
  if(funding.mode==='subscription'&&!(funding.subscription?.dailyCalls>=1))return null
  const model={provider:settings.model.provider,model:settings.model.model},billing=funding.mode,pricing=billing==='api'?funding.pricing:null
  const estimatedCostUsd=billing==='api'?(funding.request.maxInputTokens*pricing.input+funding.request.maxOutputTokens*pricing.output)/1e6:null
  const dailyLimitUsd=funding.dailyBudgetUsd??0,monthlyLimitUsd=funding.monthlyBudgetUsd??0,subscriptionMaxCalls=billing==='subscription'?funding.subscription.dailyCalls:null
  const key=taskHash({botId,model,cliModel:tool.cliModel,billing,pricing,dailyLimitUsd,monthlyLimitUsd,subscriptionMaxCalls})
  if(inners.has(key))return inners.get(key)
  if(inners.size>=TASK_BACKEND_LIMIT)return null
  const inner=createRemoteCliReadBackend({machines,directory,store,authority,profiles,model,requestedModel:tool.cliModel,billing,pricing,estimatedCostUsd,dailyLimitUsd,monthlyLimitUsd,subscriptionMaxCalls,deadlineMs:CLI_DEADLINE_MS})
  inners.set(key,inner);return inner
 }
 const forSubject=subject=>resolve(authority.describe(subject).botId)
 const unavailable=()=>{throw Object.assign(new Error('TASK_BINDING_UNAVAILABLE'),{code:'TASK_BINDING_UNAVAILABLE'})}
 return Object.freeze({id:'remote-codex-read',version:'remote-cli-read-product-v1',effect:'read',location:'remote',atomicAdmission:true,requiresExecutionInput:true,
  machineId:'remote-target',workspaceId:'remote-root',capability:'remote/cli_task_v1',retryCapability:'remote/cli_task_v1',reconcileCapability:'remote/operation_status',parse:parseRemoteTaskCli,
  targetFor(subject,input){return (forSubject(subject)??unavailable()).targetFor(subject,input)},
  canObserve(subject,target,input){return forSubject(subject)?.canObserve(subject,target,input)??false},
  run(context){const inner=resolve(context.ownerBotId);return inner?inner.run(context):{outcome:'failed',summary:{code:'TASK_BINDING_UNAVAILABLE'}}},
  reconcile(context){const inner=resolve(context.ownerBotId);return inner?inner.reconcile(context):{outcome:'unknown',reason:'TASK_BINDING_UNAVAILABLE'}},
  probe(subject,input){const inner=forSubject(subject);if(!inner)unavailable();return inner.probe(subject,input)},
  async close(){await Promise.allSettled([...inners.values()].map(inner=>inner.close()))},
 })
}

/**
 * Compose the frozen DS Bot runtime with the MR plugin body inside one Host.
 * The synchronous segment creates the shared authority/directory/policy and
 * provides `botIntegrationPolicy` before this function first returns, so every
 * legacy MR tool, command and RPC receiver resolves the same policy at call
 * time. The DS runtime itself is created after a bounded initial route
 * snapshot, because grant compilation is synchronous.
 *
 * When another trusted Host component already provides a valid
 * `botIntegrationPolicy` (isolated test fixtures), this composition defers to
 * it instead of installing a second runtime or a duplicate service.
 *
 * `accountStream` is the shared money decorator. M1 passes a clearly labeled
 * diagnostic decorator: it records bounded identity/source observations and
 * never claims a monetary amount. Per-source receipts and budget admission
 * arrive with the unified SQLite money authority.
 */
export function startBotProduct(ctx, options = {}) {
  const { discoverRoutes, accountStream, config = {}, actions = {}, machineId = `local-${hostname()}`, workspaceId = 'default',
    runtimeConfig, onBind, refreshIntervalMs = ROUTE_REFRESH_MS, now = Date.now, failClosed = true,
    deferredRouterState = null, legacyFile = defaultStatePath(), pricingFor = async () => null, mr = null, taskCli = null,
    Database = createRequire(import.meta.url)('better-sqlite3'), storageFile = join(resolveStateHome(), 'model-router', 'orchestration.sqlite') } = options
  if (discoverRoutes !== undefined && typeof discoverRoutes !== 'function') throw new TypeError('BOT_PRODUCT_ROUTES_REQUIRED')
  if (typeof accountStream !== 'function') throw new TypeError('BOT_PRODUCT_ACCOUNTING_REQUIRED')
  // A misconfigured official CLI entry must fail loudly at composition time
  // instead of silently degrading the managed Task surface.
  const cliConfig = normalizeTaskCli(taskCli)
  // Grant compilation needs the raw configured-route catalog. The plugin's
  // discoverConfiguredRoutes applies the per-subject policy filter, which
  // refuses outside an execution context; a filtered catalog would leave every
  // Bot without model authority.
  const catalog = async () => {
    if (typeof discoverRoutes === 'function') return discoverRoutes()
    const providers = ctx.llm?.listProviders?.() ?? []
    const routes = []
    for (const entry of Array.isArray(providers) ? providers : []) {
      const provider = typeof entry === 'string' ? entry : entry?.id
      if (!provider) continue
      let models
      try { models = await ctx.llm.listModels(provider) } catch { continue }
      for (const listed of Array.isArray(models) ? models : []) {
        const model = listed?.id ?? listed?.model
        if (model) routes.push({ provider, model })
      }
    }
    return routes
  }
  let provided
  try { provided = ctx.get?.('botIntegrationPolicy') } catch { /* absent optional service */ }
  if (provided !== undefined) {
    if (!validPolicy(provided)) throw new Error('BOT_PRODUCT_POLICY_CONFLICT: an invalid botIntegrationPolicy is already provided')
    return null
  }
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  ctx.provide('botIdForAgent', agent => {
    try { return authority.describe(directory.forAgent(agent)).botId } catch { return null }
  })
  const ownerTools=[...PRODUCT_OWNER_READ_METHODS,...PRODUCT_OWNER_WRITE_METHODS].map(name=>`remote/${name}`)
  const policy = createBotPolicy({ authority, directory, machineId, workspaceId,ownerGrant:{tools:ownerTools} })
  ctx.provide('botIntegrationPolicy', policy)
  // Bot routing reads the same committed state everything else obeys: the Bot list, each Bot's
  // saved settings, and machine reachability from health. It never invents a candidate.
  // Routines live beside the router state; the plugin owns that directory and provides the store.
  // Handing work between Bots: the ledger makes loops impossible, the plan carries the sender.
  const handoffLedger = createHandoffLedger()
  const handoffTask = async (args, context) => {
    if (context?.kind !== 'bot' || context.botId !== args.fromBotId
      || !product?.lifecycle.committedMainBotIds().includes(context.botId)) throw new Error('BOT_ROUTING_HANDOFF_DENIED')
    assertHandoffAllowed({ taskId: args.taskId, fromBotId: args.fromBotId, toBotId: args.toBotId, ledger: handoffLedger })
    const { plan } = buildHandoff({ taskId: args.taskId, fromBotId: args.fromBotId, toBotId: args.toBotId, objective: args.objective })
    if (!taskService) throw new Error('TASK_SERVICE_UNAVAILABLE')
    plan.origin.sessionId = context.sessionId
    for (const item of plan.packages) item.execution = { backend: 'bot-turn-read', input: { task: item.objective } }
    const submitted = await taskService.submitPlan(taskOwner({ botId: args.fromBotId }), { requestKey: `handoff-${args.taskId}-${args.toBotId}`, plan }, { sessionId: context.sessionId })
    turnBackends?.watchPlan({ planId: submitted.planId, botId: args.toBotId, originBotId: args.fromBotId })
    handoffLedger.held(args.taskId, args.fromBotId)
    handoffLedger.held(args.taskId, args.toBotId)
    return { plan, submitted }
  }
  const routingSettingsFor = botId => {
      try { const row = botSettings?.get(botId, { publishChange: false }); return row ? { ...row.settings, grant: row.grant, status: row.status } : null }
      catch { return null }
  }
  const commitWorkerBinding = createWorkerBindingCommitter({ machines: () => machines, settingsFor: routingSettingsFor,
    mainBotIds: () => product?.rt.state.mainBotIds ?? [] })
  const botRouting = createBotRoutingService({
    bots: () => product?.rt?.state?.bots ?? [],
    settingsFor: routingSettingsFor,
    machineHealth: machineId => {
      try { const row = machines?.readModel?.().items?.find(item => item.id === machineId); return { online: row?.status === 'online' } } catch { return null }
    },
    routing: () => routingSettings?.get().settings ?? config.botRouting,
    mainBotIds: () => product?.rt.state.mainBotIds ?? [],
    subjectFor: botId => directory.forBot(botId),
    submitPlan: (subject, request, caller) => {
      if (!taskService) throw new Error('TASK_SERVICE_UNAVAILABLE')
      return taskService.submitPlan(subject, request, caller)
    },
    readSubmittedPlan: (originBotId, planId) => {
      if (!journal) throw Object.assign(new Error('BOT_ROUTING_STATUS_UNAVAILABLE'), { code: 'BOT_ROUTING_STATUS_UNAVAILABLE' })
      // Authenticated owner observation reads durable identities even if the Bot was paused.
      return journal.getPlan(originBotId, planId)
    },
    bindWorker: (binding, context) => commitWorkerBinding(binding, context),
    executionBackendFor: effect => effect === 'read' ? 'bot-turn-read' : 'bot-turn-write',
    onAccepted: report => turnBackends?.watchPlan(report),
    busyFor: botId => product?.rt.live?.get(product.rt.chatOf(botId))?.turn !== undefined,
    priceFor: (route, botId) => {
      // Funding prices belong to the Bot binding, even when another Bot uses the same model.
      const settings = routingSettingsFor(botId)
      if (settings?.model?.provider !== route.provider || settings.model.model !== route.model) return null
      const price = settings.funding?.pricing
      if (!Number.isFinite(price?.input) || price.input < 0 || !Number.isFinite(price?.output) || price.output < 0) return null
      return (price.input + price.output) / 2
    },
  })
  ctx.provide('botRouting', botRouting)
  const describeBot = subject => { try { return authority.describe(subject).botId } catch { return null } }
  // Operator passthrough: a session that is not a Bot (the operator's own agent session) would
  // otherwise be refused as UNKNOWN_SUBJECT by every Bot-shaped tool. When the operator turns this
  // on, such a session acts with the Main Bot's authority — the same grants, the same audit trail
  // — instead of being handed a second, parallel set of permissions.
  const operatorSubject = () => {
    const settings = config?.operatorPassthrough
    // On by default: the operator's own session is the person who owns the machines.
    if (settings && settings.enabled === false) return null
    const mainId = (product?.rt.state?.mainBotIds ?? [])[0]
    if (!mainId) return null
    try { return directory.forBot(mainId) ?? null } catch { return null }
  }
  const subjectOrOperator = subject => subject ?? operatorSubject()
  ctx.provide('operatorSubject', operatorSubject)
  // Owner task management acts on the owning Bot's own subject: the Bot's
  // committed grant authorizes the operation, never the browser session.
  const taskOwner = payload => {
    const botId = payload?.botId
    if (typeof botId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(botId)) throw new Error('INVALID_TASK_OWNER')
    return directory.forBot(botId)
  }

  const grants = new Map()
  let machines, product, releaseMachineSecrets, funding, botSettings, fundingAccounts, modelAccounting, routingSettings, turnBackends, routineExecution, machineHeartbeat
  let journal, taskService, taskBackends, releaseTaskTools, cliSessionFactory, remoteCliBackend, sharedAdmission, taskRunnerWatchdog
  const committedBots = new Map()
  let ownerCatalogStamp=''
  let routes = new Set(), hydrated = false, refreshing = false, lastRefresh = 0, timer = null
  const refresh = async () => {
    if (refreshing) return
    refreshing = true
    try {
      routes = new Set((await catalog()).map(route => `${route.provider}/${route.model}`)); hydrated = true
      const ownerRoutes=[...routes].sort().map(key=>{const slash=key.indexOf('/');return {provider:key.slice(0,slash),model:key.slice(slash+1)}}).filter(route=>route.provider&&route.model)
      const stamp=JSON.stringify(ownerRoutes)
      if(stamp!==ownerCatalogStamp){policy.replaceOwnerGrant({tools:ownerTools,modelRoutes:ownerRoutes});ownerCatalogStamp=stamp}
      if(product)await product.lifecycle.refreshGrants()
    }
    catch { /* keep the last snapshot; the interval retries */ }
    finally { refreshing = false; lastRefresh = now() }
  }
  const scheduleRefresh = () => {
    if (refreshing || now() - lastRefresh < ROUTE_REFRESH_DEBOUNCE_MS) return
    void refresh()
  }
  const grantFor = bot => {
    // The DS lifecycle compiles grants from committed state; recording here keeps
    // bot-settings' botExists honest during that same synchronous compilation.
    committedBots.set(bot.id, bot)
    scheduleRefresh()
    let grant = botSettings ? botSettings.grantFor(bot) : compileProductGrant(bot, { routes, hydrated })
    // The Main Bot is the operator's own assistant: it may switch model in its panel at any time,
    // so its grant carries every hydrated route instead of only the one saved at that moment.
    if ((product?.rt.state?.mainBotIds ?? []).includes(bot.id) && hydrated && routes.size > 0) {
      grant = { ...grant, tools: [...grant.tools, 'tool/bot_dispatch', 'tool/bot_handoff_task'],
        modelRoutes: [...routes.keys()].map(key => { const at = key.indexOf('/'); return { provider: key.slice(0, at), model: key.slice(at + 1) } }) }
    }
    const names = {machine_ping:'remote_computer_ping',fs_list:'remote_computer_list',fs_read:'remote_computer_read',fs_write:'remote_computer_write'}
    // Grant compilation is synchronous and runs on every DS save/load: an
    // unavailable machine directory (not yet opened, or closed after a failed
    // boot) grants no machine access instead of suspending the lifecycle.
    let scopes = [],cliOfficial=false
    // Authorisation comes from committed state; `scopes()` only adds capabilities that are live
    // right now. Relying on scopes() alone meant a restart granted the Main Bot no remote tools
    // at all, because the directory is not open yet when grants compile.
    try { scopes = machines?.bindingsFor(bot.id) ?? [] } catch { scopes = [] }
    if (scopes.length === 0) { try { scopes = machines?.scopes(bot.id) ?? [] } catch { /* no machine access */ } }
    try { cliOfficial=botSettings?.get(bot.id,{publishChange:false}).settings?.officialTools?.some(item=>item.toolId==='codex'&&item.mode==='read-only')===true } catch {}
    for (const scope of scopes) for (const tool of scope.tools) {
      if(['operation_status','operation_cancel'].includes(tool)){grant.tools.push(`remote/${tool}`,'tool/remote_computer_operation');continue}
      if(tool==='artifact_stat'||tool==='artifact_read'){grant.tools.push(`remote/${tool}`);continue}
      if(['cli_probe_v1','cli_task_v1'].includes(tool)){
        const profile=cliConfig?.remote.find(item=>item.machineId===scope.machineId&&scope.roots.includes(item.rootId))
        if(cliOfficial&&profile&&['cli_probe_v1','cli_task_v1','operation_status','operation_cancel'].every(name=>scope.tools.includes(name)))grant.tools.push(`remote/${tool}`,...(tool==='cli_probe_v1'?['tool/remote_computer_cli_probe']:[]))
        continue
      }
      if(tool.startsWith('browser_')){if(scope.mode==='workspace-write')grant.tools.push(`remote/${tool}`,'tool/remote_computer_browser');continue}
      if(tool.startsWith('desktop_')){
        if(scope.mode==='workspace-write'&&['artifact_stat','artifact_read','operation_status','operation_cancel'].every(name=>scope.tools.includes(name)))grant.tools.push(`remote/${tool}`,'tool/remote_computer_desktop')
        continue
      }
      if(tool==='container_command_v1'){
        if(scope.mode==='workspace-write'&&['container_command_v1','operation_status','operation_cancel'].every(name=>scope.tools.includes(name)))grant.tools.push(`remote/${tool}`,'tool/remote_computer_command')
        continue
      }
      if (!names[tool]) continue
      if(tool==='fs_write'&&(scope.mode!=='workspace-write'||!['fs_write','operation_status','operation_cancel'].every(name=>scope.tools.includes(name))))continue
      grant.tools.push(`remote/${tool}`, `tool/${names[tool]}`)
    }
    grant.tools = [...new Set(grant.tools)]
    grants.set(bot.id, grant)
    return grant
  }
  const bindings = async ({ runtime, signal }) => {
    signal?.throwIfAborted()
    await runtime.load()
    const state = runtime.state ?? {}
    const items = Object.values(state.bots ?? {}).map(bot => {
      const grant = grants.get(bot.id)
      return { botId: bot.id, name: bot.name ?? '', role: bot.role ?? '', model: bot.model ?? null,
        sessionId: runtime.chatOf(bot.id), main: (state.mainBotIds ?? []).includes(bot.id),
        tools: grant?.tools ?? [], modelRoutes: grant?.modelRoutes ?? [], workspaceId, machineId }
    })
    return { status: 'available', items }
  }
  // The parent Host authenticates the browser session; absence never enables a route.
  const authorizeRequest = async request => {
    const admission = ctx.connection?.admit(request)
    if (!admission || 'rejection' in admission || admission.peer?.principal?.kind !== 'owner') return null
    return { kind: 'owner', peer: admission.peer }
  }
  // Trusted catalog for Bot binding validation: exact route models, the local
  // machine entry (an enabled binding requires a workspaceRef) and enabled
  // funding scopes. Tools and capability catalogs arrive with their facades.
  const settingsCatalog = () => {
    const models = [...routes].map(key => { const slash = key.indexOf('/'); return { provider: key.slice(0, slash), model: key.slice(slash + 1), label: key, cliModels: [] } })
    const localMachineId = machineId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 100) || 'local-host'
    // A CLI identity is only offered once the host verified it against the
    // installed official tool; an unverified route keeps no cliModels entry.
    for (const model of models) {
      for (const mapping of cliConfig?.models ?? []) {
        if (mapping.provider === model.provider && mapping.model === model.model) model.cliModels.push({ toolId: 'codex', model: mapping.cliModel })
      }
    }
    const remoteMachines=new Map()
    for(const profile of cliConfig?.remote??[]){
      if(!remoteMachines.has(profile.machineId))remoteMachines.set(profile.machineId,{machineId:profile.machineId,label:profile.machineId,location:'remote',status:'configured',roots:[]})
      remoteMachines.get(profile.machineId).roots.push({rootId:profile.rootId,label:profile.rootId,modes:['read-only'],capabilities:[]})
    }
    for(const machine of machines?.readModel().items??[]){
      if(machine.status==='revoked')continue
      const roots=machine.roots.map(rootId=>({rootId,label:rootId,modes:['read-only','workspace-write'],capabilities:[...machine.tools]}))
      remoteMachines.set(machine.id,{machineId:machine.id,label:machine.name,location:'remote',status:machine.status,roots})
    }
    return { models, tools: cliConfig ? [{ toolId: 'codex', modes: ['read-only'], grantTools: [...CLI_GRANT_TOOLS] }] : [],
      machines: [{ machineId: localMachineId, label: '本机', location: 'local', status: 'ready',
        roots: [{ rootId: 'default', label: '默认工作区', modes: ['read-only', 'workspace-write'], capabilities: [] }] },...remoteMachines.values()],
      capabilities: [
        { id: 'model-inference', label: '模型推理', tools: ['model/infer'] },
        { id: 'mr-routing', label: '模型路由', tools: PRODUCT_TOOLS.filter(name=>name!=='model/infer') },
        { ...TASK_CAPABILITY },
        ...[...new Set((machines?.readModel().items ?? []).filter(machine => machine.status !== 'revoked').flatMap(machine => machine.tools))]
          .map(tool => ({ id: tool, label: tool, tools: [`remote/${tool}`] })),
      ],
      taskBackends: taskBackends ? taskBackends.catalog() : [],
      fundingScopes: fundingAccounts ? fundingAccounts.catalog().filter(scope => scope.enabled).map(scope => ({ id: scope.id, label: scope.provider, modes: ['api','subscription'] })) : [] }
  }
  // N06b: the Bot binding is the funding source of truth for its own model
  // calls. An unconfigured, mismatched or incomplete binding yields null and
  // the accounting layer refuses the call; there is no silent fallback route.
  const bindingFunding = async ({ botId, provider, model }) => {
    if (!botSettings) return null
    const value = botSettings.get(botId, { publishChange: false })
    if (value.status !== 'available') return null
    const s = value.settings
    const route = s.model
    if (!route?.provider || !route?.model) return null
    // An explicit route must match the binding's exact model; an unspecified
    // route (the MR funding preparation) resolves from the binding itself.
    if (provider !== undefined && model !== undefined && (route.provider !== provider || route.model !== model)) return null
    if (s.funding.mode === 'subscription') {
      return { funding: 'subscription', route: { ...route }, scopeId: s.funding.scopeId,
        subscriptionMaxCalls: s.funding.subscription?.dailyCalls ?? null,
        subscriptionMonthlyCalls: s.funding.subscription?.monthlyCalls ?? null }
    }
    if (!s.funding.pricing || !s.funding.request) return null
    const account = s.funding.scopeId && fundingAccounts ? fundingAccounts.get(s.funding.scopeId) : null
    return { funding: 'api', route: { ...route }, scopeId: s.funding.scopeId, pricing: s.funding.pricing,
      maxInputTokens: s.funding.request.maxInputTokens, maxOutputTokens: s.funding.request.maxOutputTokens,
      botDailyLimitUsd: s.funding.dailyBudgetUsd, botMonthlyLimitUsd: s.funding.monthlyBudgetUsd,
      ...(account ? { accountDailyLimitUsd: account.dailyLimitUsd, accountMonthlyLimitUsd: account.monthlyLimitUsd } : {}) }
  }
  const boot = (async () => {
    try{
      await Promise.race([refresh(), new Promise(resolve => { const pending = setTimeout(resolve, INITIAL_ROUTE_TIMEOUT_MS); pending.unref() })])
      if(deferredRouterState){
        sharedAdmission=await acquireMigrationShared(resolveStateHome())
        assertMigrationStartupAllowed({home:resolveStateHome()})
        funding=await openProductFunding({Database,file:storageFile,legacyFile,policy,authority,pricingFor:bindingFunding,now})
      }

      // The independent Bot runtime may call a remote tool, but only through this: the Bot's own
      // subject, its first live machine binding, and a fresh task/attempt per call. Nothing here
      // accepts a machine, root, endpoint or operation id from the caller's arguments.
      ctx.provide?.('botRemoteToolInvoker', Object.freeze({
        async invoke(botId, tool, args = {}) {
          const subject = directory.forBot(botId)
          if (!subject) throw new Error('UNKNOWN_BOT')
          const model = machines.readModel()
          const candidates = (model?.items ?? []).filter(item => item.status !== 'revoked'
            && Array.isArray(item.bindings) && item.bindings.some(binding => binding.botId === botId && !binding.revoked))
          // A caller may name one machine; it must be one of this Bot's own live bindings.
          const wanted = typeof args?.machineId === 'string' ? args.machineId : null
          const machine = wanted ? candidates.find(item => item.id === wanted) : candidates[0]
          if (!machine) throw new Error('MACHINE_NOT_BOUND')
          const binding = machine.bindings.find(item => item.botId === botId && !item.revoked)
          const rootId = (binding.roots ?? [])[0]
          if (typeof rootId !== 'string' || !rootId) throw new Error('MACHINE_ROOT_NOT_BOUND')
          if (Array.isArray(binding.tools) && !binding.tools.includes(tool)) throw new Error('MACHINE_BOT_DENIED')
          const calls = { ...args }
          delete calls.machineId
          const stamp = String(Date.now()) + Math.random().toString(16).slice(2, 8)
          return machines.call(subject, {
            machineId: machine.id, rootId, taskId: 'bot-' + stamp, attemptId: 'bot-a-' + stamp, tool, args: calls,
          })
        },
      }))
      routingSettings = openBotRoutingSettings({ Database, file: storageFile, initial: () => config.botRouting, now })
      machines = openRemoteMachines({ Database, file:storageFile, authority, cliProfiles:cliConfig?.remote??[],
        botExists:id=>Boolean(product&&Object.hasOwn(product.rt.state?.bots??{},id)), now,
        resolveSecret:async secretRef=>{
          if(!product)throw new Error('MACHINE_SECRET_UNAVAILABLE')
          await product.rt.loadSecrets()
          const name=secretRef.slice('ds-secret/'.length)
          const view=product.rt.secretsView().find(secret=>secret.name===name)
          // A machine control-plane key must never be offered to Bot shells.
          if(!view||!Array.isArray(view.scope)||view.scope.length)throw new Error('MACHINE_SECRET_MUST_BE_HOST_ONLY')
          return product.rt.secretValue(name)
        },
        onChanged:async()=>{if(product)await product.lifecycle.refreshGrants()},
      })
      // N06b: the components own grants and admission. A published compiled grant
      // takes effect immediately and a suspension revokes it; an account change
      // re-evaluates every binding because the scope catalog follows it.
      if (deferredRouterState) {
        fundingAccounts = openFundingAccounts({ Database, file: storageFile,
          providers: () => [...new Set([...routes].map(key => key.slice(0, key.indexOf('/'))))],
          onCommitted: () => { try { botSettings?.refresh() } catch { /* the interval retries */ } },
          onSuspended: () => { try { botSettings?.refresh() } catch { /* the interval retries */ } }, now })
        botSettings = openBotSettings({ Database, file: storageFile,
          catalogFor: settingsCatalog,
          botExists: id => committedBots.has(id),
          onCommitted: value => {
            try { directory.replaceGrant(value.botId, value.grant) } catch { /* the lifecycle recompiles */ }
            if (product) void product.lifecycle.refreshGrants()
          },
          onSuspended: value => {
            try { directory.replaceGrant(value.botId, { tools: [], modelRoutes: [] }) } catch { /* the lifecycle recompiles */ }
            if (product) void product.lifecycle.refreshGrants()
          }, now })
        modelAccounting = createModelAccounting({ store: funding.store, authority,
          pricingFor: bindingFunding,
          // The configured request allowance is the Host-declared trusted bound;
          // deriving it from the pinned model's context window is a follow-up.
          inputBoundFor: async ({ config }) => config.maxInputTokens,
          machineId, workspaceId, now,
          // The scoped admission (Bot/account/project budgets) is authoritative;
          // the ledger limit stays open so no hidden global cap shadows it.
          limits: { dailyLimitUsd: 0, monthlyLimitUsd: 0 } })
        // N09: one managed Task runner over the same SQLite authority. The
        // journal, funding store and component tables share orchestration.sqlite;
        // backends stay stable per kind while each Bot's binding supplies the
        // execution target, model and money at run time.
        if (typeof mr?.executeConfiguredAssignment !== 'function' || typeof mr?.rerunRecordedStep !== 'function'
          || typeof mr?.routerStateStore !== 'function') throw new TypeError('BOT_PRODUCT_MR_SEAM_REQUIRED')
        const managedRoot = join(dirname(storageFile), 'managed')
        const managedWorkspace = join(managedRoot, 'read-workspace')
        await mkdir(managedWorkspace, { recursive: true })
        if (cliConfig?.entry&&cliConfig.sessionFactory) {
          const factory = await import(cliConfig.sessionFactory).then(module => module.createCliSession ?? module.default, () => null)
          if (typeof factory !== 'function') throw new TypeError('TASK_CLI_SESSION_FACTORY_REQUIRED')
          cliSessionFactory = factory
        }
        journal = funding.store.openTaskJournal({leaseClock:'db'})
        const modelBackends = createTaskBackends({ ctx, mr, authority, directory, store: funding.store,
          machineId, workspaceId, workspace: managedWorkspace, runtimeRoot: join(managedRoot, 'cli-runtime'),
          bindingFor: botId => botSettings.get(botId, { publishChange: false }),
          cli: cliConfig?.entry ? { entry: cliConfig.entry, sessionFactory: cliSessionFactory ?? (await import('../../cli-runtime/src/codex-runtime.mjs')).createCodexSession } : null })
        const remoteWrite=createRemoteWriteBackend({machines:()=>machines,directory})
        const remoteCommand=createRemoteCommandBackend({machines:()=>machines,directory})
        turnBackends = createBotTurnBackends({ ctx, runtime: () => product?.rt, directory, authority, Database, storeFile: storageFile,
          bindingFor: botId => botSettings.get(botId, { publishChange: false }), machines: () => machines,
          readPlan: report => taskService.getPlan(directory.forBot(report.originBotId), { planId: report.planId }), now })
        if(cliConfig?.remote.length)remoteCliBackend=createRemoteCliReadBackend({machines:()=>machines,directory,store:funding.store,authority,profiles:cliConfig.remote,bindingFor:botId=>botSettings.get(botId,{publishChange:false})})
        const remoteBackends=[remoteWrite,remoteCommand,...(remoteCliBackend?[remoteCliBackend]:[])]
        taskBackends=Object.freeze({backends:Object.freeze([...modelBackends.backends,...remoteBackends]),catalog:()=>[...modelBackends.catalog(),...remoteBackends.map(backend=>({id:backend.id,version:backend.version,effect:backend.effect,location:'remote',capability:backend.capability,label:backend.id==='remote-codex-read'?'已授权远程官方 CLI 只读任务':backend.id==='remote-write'?'已授权远程文件写入任务':'已授权容器命令任务（仅别名argv）'}))]})
        taskService = createTaskService({ journal, authority, directory, backends: [...turnBackends.backends, ...taskBackends.backends],
          within: (subject, signal, work) => policy.executionContext(subject, signal, work),
          planTargetsFor: (subject,plan,caller) => {
            const id=authority.describe(subject).botId
            const bot=product?.lifecycle.committedBot(id)
            const privateSession=product?.rt.chatOf(id)??bot?.sessionId??bot?.id
            const privateCall=caller.owner===true||bot&&caller.sessionId===privateSession
            if(caller.sessionId!==undefined&&plan.origin.kind==='private'&&!privateCall)throw Object.assign(new Error('TASK_PLAN_ORIGIN_MISMATCH'),{code:'TASK_PLAN_ORIGIN_MISMATCH'})
            if(caller.owner===true&&plan.origin.kind==='private'&&plan.origin.sessionId!==null&&plan.origin.sessionId!==privateSession)throw Object.assign(new Error('TASK_PLAN_ORIGIN_MISMATCH'),{code:'TASK_PLAN_ORIGIN_MISMATCH'})
            return privateCall&&['private','handoff'].includes(plan.origin.kind)&&product?.lifecycle.committedMainBotIds().includes(id)?product.lifecycle.committedBots().map(bot=>bot.id):[id]
          },
          runnerTtlMs: TASK_RUNNER_TTL_MS, taskTtlMs: TASK_TTL_MS,
          // Lease expiry reads the ledger's clock, not this process's: a Host
          // whose wall clock drifted must not be able to declare its own live
          // lease expired and let a second runner take the same tasks.
          leaseClock: 'db',
          // The deployment refuses a writer that cannot prove a stop, so a new
          // backend cannot be added without also teaching it how to say so.
          requireStopProof: true,
          // The committed binding's maxConcurrentTasks is the per-Bot limit; an
          // unconfigured Bot keeps the conservative single-task default.
          concurrencyFor: botId => {
            try {
              const value = botSettings?.get(botId, { publishChange: false })
              return value?.status === 'available' ? value.settings.maxConcurrentTasks ?? 1 : 1
            } catch { return 1 }
          } })
        // A previous Host that died without releasing its runner lease blocks the
        // claim until the lease expires; waiting is safer than dropping tasks.
        const claimDeadline = now() + TASK_RUNNER_CLAIM_MS
        for (;;) {
          try { taskService.start(); break } catch (error) {
            if (error?.code !== 'TASK_RUNNER_BUSY' || now() >= claimDeadline) throw error
            await new Promise(resolve => { const pending = setTimeout(resolve, 250); pending.unref() })
          }
        }
        // A runner that stops (a lease lost to a clock jump, a journal write that
        // never settled) must come back on its own, or the Host keeps accepting
        // work nobody will claim. The watchdog reports what it did instead of
        // hiding a permanent stop behind a quiet 5-second tick.
        taskRunnerWatchdog = setInterval(() => {
          try {
            const state = taskService.state()
            if (state.closed || state.running) return
            const outcome = taskService.restart({ reason: state.stopReason ?? 'TASK_RUNNER_WATCHDOG' })
            if (!outcome.accepted) ctx.logger?.('task-runner-restart-deferred', { code: outcome.code, reason: state.stopReason })
          } catch (error) { ctx.logger?.('task-runner-watchdog-failed', { code: error?.code ?? 'TASK_RUNNER_WATCHDOG_FAILED' }) }
        }, TASK_RUNNER_WATCHDOG_MS)
        taskRunnerWatchdog.unref?.()
        releaseTaskTools = registerTaskTools(ctx, defineTool, { service: taskService, directory })
      }
      const machineActions=Object.fromEntries(['pair','bind','probe','revoke','reconcile'].map(name=>[`machine.${name}`,(payload,context)=>machines[name](payload,context)]))
      machineActions['machine.pair'] = (payload, context) => pairMainMachine({ machines,
        mainBotId: () => product?.rt.state?.mainBotIds?.[0] }, payload, context)
      machineActions['machine.artifact']=(payload,context)=>machines.download(taskOwner(payload),payload,context)
      // Desktop control: a person watches one frame and acts on it. Both calls run as that
      // person's Bot, so the Bot grant and the machine ceiling decide, and the operations land
      // under that Bot instead of an anonymous console.
      const desktopActions = createDesktopActions({ machines, directory })
      for (const [action, method] of [['open', 'desktopSession'], ['renew', 'renewDesktopSession'], ['close', 'closeDesktopSession']]) {
        machineActions[`machine.desktop.${action}`] = (payload, context) => {
          if (context?.kind !== 'owner') throw new Error('REMOTE_OWNER_REQUIRED')
          if (!payload || typeof payload.botId !== 'string') throw new Error('INVALID_DESKTOP_REQUEST')
          const { botId, ...request } = payload
          return machines[method](taskOwner({ botId }), request, context)
        }
      }
      machineActions['machine.desktop.view'] = (payload, context) => {
        if (context?.kind !== 'owner') throw new Error('REMOTE_OWNER_REQUIRED')
        return desktopActions.view(payload)
      }
      machineActions['machine.desktop.act'] = (payload, context) => {
        if (context?.kind !== 'owner') throw new Error('REMOTE_OWNER_REQUIRED')
        return desktopActions.act(payload)
      }
      machineActions['machine.secret']=async(payload,context)=>{
        if(context?.kind!=='owner')throw new Error('REMOTE_OWNER_REQUIRED')
        if(!payload||Object.keys(payload).some(key=>!['name','value'].includes(key))||!/^REMOTE_AGENT_[A-Z0-9_]{1,50}$/.test(payload.name)||typeof payload.value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(payload.value))throw new Error('INVALID_MACHINE_SECRET')
        const secretRef=`ds-secret/${payload.name}`
        for(const machine of machines.readModel().items.filter(item=>item.status!=='revoked'&&item.secretRef===secretRef))await machines.revoke({machineId:machine.id,expectedRevision:machine.revision},context)
        await product.rt.secretEndpoint('secret-set',{name:payload.name,value:payload.value,scope:[],purpose:'远程电脑控制面凭据，仅供宿主使用；不得授予 Bot shell。'})
        return {secretRef,stored:true}
      }
      const botLibrary = (() => { try { return ctx.get?.('botLibrary') ?? null } catch { return null } })()
      const botRuntimeAdapter = (() => { try { return ctx.get?.('botRuntimeAdapter') ?? null } catch { return null } })()
      const routineStore = (() => { try { return ctx.get?.('routineStore') ?? null } catch { return null } })()
      if (routineStore) routineExecution = createRoutineExecutionService({ machines, store: routineStore, botIdForSubject: describeBot })
      product = createBotProduct(ctx, { authority, directory, policy, grantFor,
        accountStream: (streamOptions, next, meta) => {
          turnBackends?.tagModelRequest(streamOptions)
          const enriched = meta?.subject ? { ...meta, botId: describeBot(meta.subject) } : meta
          // N06b: the unified admission owns every Bot model call; the diagnostic
          // decorator only remains for lightweight contexts without the store.
          if (!modelAccounting) return accountStream(streamOptions, next, enriched)
          // A direct MR call inside an admitted execution frame references that
          // run's invoice instead of opening a second Bot-side one.
          funding?.funded?.bindModelRequest?.(streamOptions, { agentLoop: meta?.agentLoop === true, ownRequest: meta?.ownRequest === true })
          return modelAccounting.stream(streamOptions, next, { ...enriched, source: RECEIPT_SOURCE[enriched?.source] ?? enriched?.source })
        },
        onBind, runtimeConfig,
        readModels: { bindings, machines:()=>machines.readModel(),
          botBindings: async ({ runtime, signal }) => {
            signal?.throwIfAborted(); await runtime.load()
            const catalog = settingsCatalog()
            return { ...botSettings.readModel(Object.values(runtime.state?.bots ?? {})),
              machines: catalog.machines.map(m => ({ machineId: m.machineId, label: m.label, location: m.location, roots: m.roots.map(r => ({ rootId: r.rootId, label: r.label, modes: r.modes })) })),
              fundingScopes: catalog.fundingScopes }
          },
          fundingAccounts: async () => ({ status: 'available', items: fundingAccounts.catalog() }),
          // N09: the managed Task projection reads the durable journal through the
          // same single authority; a section without a runner stays blocked.
          ...(taskService ? { tasks: async ({ runtime, signal }) => {
            signal?.throwIfAborted(); await runtime.load()
            const loaded = journal.productList(Object.values(runtime.state?.bots ?? {}).map(bot => bot.id), { limit: TASK_READ_LIMIT })
            const items = loaded.items.map(projectProductTask)
            const plans=Object.values(runtime.state?.bots??{}).flatMap(bot=>journal.listPlans(bot.id))
            return { status: 'available', items, total: loaded.total, truncated: loaded.truncated, plans, backends: taskBackends.catalog() }
          } } : {}),
          // N07: the usage projection reads the durable source receipts and the
          // funding totals from the single authority; an unknown amount stays
          // null instead of being rendered as zero.
          ...(funding ? { usage: async ({ runtime, signal }) => {
            signal?.throwIfAborted(); await runtime.load()
            const bots = Object.values(runtime.state?.bots ?? {})
            const names = new Map(bots.map(bot => [bot.id, bot.name]))
            // An owner resolution lives on the run's package, so the receipts and
            // the spend total agree after a waive or an attested amount.
            const ledger = await funding.store.read()
            const resolutions = new Map()
            const unresolved = []
            for (const run of ledger.runs) {
              const botId = [run.modelCall, run.cliExecution, run.fundingExecution].filter(Boolean).map(value => value.botId).find(Boolean) ?? null
              for (const item of [...(run.packages ?? []), ...(run.reviews ?? [])]) {
                if (!item || item.ran !== true) continue
                const key = `${run.id}/${item.id}`
                if (item.ownerResolution) { resolutions.set(key, item.ownerResolution); continue }
                if (!botId || typeof item.costUsd === 'number' && Number.isFinite(item.costUsd)) continue
                unresolved.push({ botId, runId: run.id, packageId: item.id, provider: item.provider ?? null,
                  model: item.model ?? null, billing: item.billing ?? null, usage: item.usage ?? null,
                  finishedAt: item.finishedAt ?? null })
              }
            }
            const items = []
            for (const bot of bots) {
              let after = 0
              for (;;) {
                const page = await funding.store.modelCalls({ botId: bot.id, after, limit: 100 })
                for (const receipt of page.items) {
                  const resolution = resolutions.get(`${receipt.runId}/${receipt.packageId}`) ?? null
                  items.push({ id: receipt.id, botId: receipt.botId, botName: names.get(receipt.botId) ?? null,
                    sessionId: receipt.sessionId, taskId: receipt.taskId, runId: receipt.runId,
                    source: receipt.source, provider: receipt.provider, model: receipt.model, billing: receipt.funding,
                    amountUsd: projectModelCallAmount(receipt, resolution), status: receipt.state, sequence: receipt.sequence,
                    resolution: resolution ? { kind: resolution.kind, costUsd: resolution.costUsd, note: resolution.note, resolvedAt: resolution.resolvedAt } : null,
                    inputTokens: receipt.usage?.inputTokens ?? null, outputTokens: receipt.usage?.outputTokens ?? null })
                }
                if (!page.next) break
                after = page.next
              }
            }
            const totals = funding.store.fundingTotals({ at: now() })
            const reserved = reservationSpending(ledger)
            const subscription = funding.store.fundingSubscriptionUsage({ at: now() })
            return { status: 'available', items, unresolved,
              summary: { apiUsd: totals.today, reservedUsd: reserved.reservedUsd, unknownCount: totals.unknownToday + totals.unknownMonth,
                subscriptionSummary: { callsToday: subscription.today.calls, callsMonth: subscription.month.calls, usdToday: totals.subscriptionToday, usdMonth: totals.subscriptionMonth } } }
          } } : {}) },
        actions: { ...actions, ...machineActions,
          // The library panel reads and writes one Bot's files. The directory is chosen by the
          // library itself (the caller's Bot, or the operator's choice), never by the panel.
          // Saved routines: list what a Bot has, and run one on a machine the caller may use.
          // The role catalog is a read-only convenience: it describes jobs, it grants nothing.
          'roles.list': async () => listRoles(),
          ...(routineStore ? {
            'routine.list': async payload => routineStore.inspect(payload?.botId),
            'routine.save': async payload => routineStore.save(payload?.botId, payload?.routine),
            'routine.remove': async payload => routineStore.remove(payload?.botId, payload?.routineId),
            'routine.history': async payload => routineExecution.history(payload?.botId),
            'routine.cancel': async payload => routineExecution.cancel(payload?.botId, payload?.runId),
            'routine.resolve': async (payload, context) => routineExecution.resolve(payload?.botId, payload?.runId, payload?.note, context),
            'routine.run': async (payload, context) => routineExecution.run({ subject: taskOwner(payload),
              botId: payload?.botId, routineId: payload?.routineId, machineId: payload?.machineId, rootId: payload?.rootId,
              context, signal: context.signal }),
          } : {}),
          ...(botLibrary ? {
            'library.list': async payload => botLibrary.list(payload?.botId, payload?.relativePath ?? ''),
            'library.read': async payload => ({ content: botLibrary.read(payload?.botId, payload?.relativePath ?? '') }),
            'library.search': async payload => ({ results: botLibrary.search(payload?.botId, payload?.query) }),
            'library.write': async payload => botLibrary.write(payload?.botId, payload?.relativePath ?? '', payload?.content ?? ''),
            'library.upload': async payload => botLibrary.upload(payload?.botId, payload?.relativePath, payload?.contentBase64, payload?.overwrite),
            'library.download': async payload => botLibrary.download(payload?.botId, payload?.relativePath),
            'library.remove': async payload => botLibrary.remove(payload?.botId, payload?.relativePath),
            'library.mkdir': async payload => botLibrary.mkdir(payload?.botId, payload?.relativePath),
          } : {}),
          // The Bot runtime card is a panel: its buttons dispatch on this channel, so the same four
          // operations the owner RPC exposes must exist here as well.
          ...(botRuntimeAdapter ? {
            'botRuntimeStatus': async () => botRuntimeAdapter.list(),
            'botRuntimeMove': async payload => botRuntimeAdapter.move(payload?.botId, payload?.mode),
            'botRuntimeHistory': async payload => botRuntimeAdapter.history(payload?.botId, { limit: payload?.limit }),
            'botRuntimeMessage': async payload => {
              if (config.independentRuntime?.fullTextHistory !== true) throw new Error('HISTORY_FULLTEXT_DISABLED')
              return botRuntimeAdapter.readMessage(payload?.botId, payload?.index)
            },
          } : {}),
          // The workbench reads Bot routing through the same product channel as every other panel
          // action. Registering it here is what makes the routing card work at runtime; the owner
          // RPC methods are a second door onto the same service.
          'botRoutingInspect': async () => ({ ...botRouting.inspect(), settingsRevision: routingSettings.get().revision }),
          'botRouting.status': (payload, context) => botRouting.submissionStatus(payload, context),
          'botRouting.save': async (payload, context) => {
            const saved = routingSettings.save(payload, context)
            return { ...botRouting.inspect(), settingsRevision: saved.revision }
          },
          'botRoutingDecide': async payload => botRouting.decide({
            text: payload?.text,
            pinnedBotId: payload?.pinnedBotId ?? '',
            requiresMachine: payload?.requiresMachine === true,
            machineId: payload?.machineId ?? '',
            rootId: payload?.rootId ?? '',
            needs: payload?.needs ?? {},
            requiredTools: Array.isArray(payload?.requiredTools) ? payload.requiredTools : [],
            requesterBotId: typeof payload?.requesterBotId === 'string' ? payload.requesterBotId : '',
          }),
          ...(botSettings ? { 'binding.save': async (payload, context) => {
            // A Bot holds its greeting until its model is picked, and the model change releases it
            // immediately. Saving a binding changes both the model and its authority, so hold the
            // greeting across that change: otherwise the greeting turn runs before the compiled
            // grant carries the binding's model route and is refused as MODEL_DENIED.
            const bot = product.rt.botOf(payload.botId)
            const held = bot?.kickoff
            if (bot && held) delete bot.kickoff
            let result
            try { result = await botSettings.save(payload, context) }
            catch (error) { if (bot && held) bot.kickoff = held; throw error }
            const model = result.settings?.model
            const ref = model ? `${model.provider}/${model.model}` : null
            if (result.status === 'available' && bot && ref && bot.model !== ref) await product.rt.updateBot(payload.botId, { model: ref })
            await product.lifecycle.refreshGrants()
            if (bot && held) { bot.kickoff = held; await product.rt.updateBot(payload.botId, { model: bot.model }).catch(() => {}) }
            return result
          } } : {}),
          ...(fundingAccounts ? { 'funding.account.save': (payload, context) => fundingAccounts.save(payload, context) } : {}),
          // N09: owner task management runs on the owning Bot's own subject, so
          // the Bot's committed grant authorizes every cancel/retry/reconcile.
          ...(taskService ? {
            // Task management is the person's own console, not a Bot surface. Every
            // action here names its caller class instead of inheriting the default,
            // so a change at the authorization seam cannot quietly hand a non-owner
            // the ability to cancel, retry or reconcile somebody's work.
            'task.inspect': ownerOnly(payload => inspectProductTask({ service: taskService, journal, subject: taskOwner(payload), taskId: payload?.taskId })),
            // Bot routing turns a preview into a real package: the decision names the Bot, the
            // worker binding is committed first, and only then is the plan submitted. A failure in
            // either step leaves no half-dispatched task behind.
            'botRouting.dispatch': (payload, context) => botRouting.dispatch(payload, context),
            'task.plan.submit': ownerOnly(payload => taskService.submitPlan(taskOwner(payload),{requestKey:payload?.requestKey,plan:payload?.plan},{owner:true})),
            'task.plan.cancel': ownerOnly(payload => taskService.cancelPlan(taskOwner(payload),{planId:payload?.planId})),
            'task.cancel': ownerOnly(payload => taskService.cancel(taskOwner(payload), { taskId: payload?.taskId })),
            'task.retry': ownerOnly(payload => taskService.retry(taskOwner(payload), { taskId: payload?.taskId, requestKey: payload?.requestKey })),
            'task.reconcile': ownerOnly(payload => taskService.reconcile(taskOwner(payload), { taskId: payload?.taskId, requestKey: payload?.requestKey })),
          } : {}),
          // An unconfirmed receipt fail-closes its Bot until an owner resolves it:
          // attest the vendor-confirmed amount or waive it, with a required note.
          ...(funding ? { 'usage.resolve': (payload, context) => {
            if (context?.kind !== 'owner') throw new Error('REMOTE_OWNER_REQUIRED')
            if (!payload || typeof payload !== 'object' || Object.keys(payload).some(key => !['botId', 'runId', 'packageId', 'kind', 'costUsd', 'note'].includes(key))) {
              throw new Error('INVALID_RESOLUTION_REQUEST')
            }
            return funding.store.resolveUnknownPackage(payload)
          } } : {}) },
        authorizeRequest })
      releaseMachineSecrets=guardMachineSecrets(ctx,product.rt,machines)
      ctx.provide('botRemoteMachines', machines)
      registerRemoteComputerTools(ctx,{runtime:product.rt,directory,machines,taskService,remoteCliBackend,operatorSubject,botRouting,routineStore,routineExecution,handoffTask,
        routedExecution: turnBackends, botIdFor: exec => describeBot(directory.forAgent(exec?.agent)), routingBotIds: () => product.rt.state.mainBotIds ?? [] })
      // The MR execution paths project their routes through the same Bot
      // binding, so a consult run carries the binding price instead of an
      // unknown-cost package.
      if (funding) ctx.provide('botFunding', funding.funded)
      deferredRouterState?.resolve(funding.state)
      machineHeartbeat = createMachineHeartbeat({ machines: () => machines, preferredBotIds: () => product.rt.state.mainBotIds ?? [] })
      machineHeartbeat.start()
      timer = setInterval(() => { void refresh() }, refreshIntervalMs)
      timer.unref()
      return product
    }catch(error){
      await machineHeartbeat?.close?.()
      await routineExecution?.close?.()
      await machines?.closeDesktopSessions?.()
      for(const cleanup of [()=>product?.dispose(),()=>releaseMachineSecrets?.(),()=>releaseTaskTools?.(),()=>machines?.close(),()=>botSettings?.close(),()=>fundingAccounts?.close(),()=>modelAccounting?.close(),()=>routingSettings?.close()])try{cleanup()}catch{}
      if(taskRunnerWatchdog)clearInterval(taskRunnerWatchdog)
      if(taskService)await taskService.close().catch(()=>{})
      else journal?.close()
      turnBackends?.close()
      if(remoteCliBackend)await remoteCliBackend.close().catch(()=>{})
      if(funding)await funding.close().catch(()=>{})
      if(deferredRouterState)try{deferredRouterState.reject(error)}catch{}
      if(sharedAdmission)await sharedAdmission.release().catch(()=>{})
      throw error
    }
  })()
  if (failClosed) {
    // A half-composed product (no Bot runtime) must never look like a working Host.
    boot.catch(error => {
      process.stderr.write(`Bot product composition failed: ${error?.stack ?? error}\n`)
      setTimeout(() => { throw error }, 0)
    })
  }
  return Object.freeze({
    machineId, workspaceId, grants, grantFor,
    observations: () => accountStream.observations?.() ?? [],
    routeStatus: () => ({ hydrated, routes: [...routes].sort() }),
    boot,
    async dispose() {
      if (timer) clearInterval(timer)
      const product = await boot.then(value => value, () => null)
      try{
        await machineHeartbeat?.close?.()
        await routineExecution?.close?.()
        await machines?.closeDesktopSessions?.()
        for(const cleanup of [()=>product?.dispose(),()=>releaseMachineSecrets?.(),()=>releaseTaskTools?.(),()=>machines?.close(),()=>botSettings?.close(),()=>fundingAccounts?.close(),()=>modelAccounting?.close(),()=>routingSettings?.close()])try{cleanup()}catch{}
        if(taskRunnerWatchdog)clearInterval(taskRunnerWatchdog)
        if(taskService)await taskService.close().catch(()=>{})
        else journal?.close()
        turnBackends?.close()
        if(remoteCliBackend)await remoteCliBackend.close().catch(()=>{})
        if(funding)await funding.close()
      }finally{authority.dispose();if(sharedAdmission)await sharedAdmission.release()}
    },
  })
}

/** Bounded diagnostic decorator: identity and source only, never a monetary claim. */
export function createDiagnosticAccountStream({ limit = OBSERVATION_LIMIT, now = Date.now } = {}) {
  const ring = []
  const stream = (options, next, meta) => {
    if (ring.length >= limit) ring.shift()
    ring.push({ at: now(), source: meta?.source ?? null, sessionId: meta?.sessionId ?? null,
      botId: meta?.botId ?? null, provider: options?.provider ?? null, model: options?.model ?? null,
      resolved: Boolean(meta?.subject) })
    return next()
  }
  stream.observations = () => ring.slice()
  return stream
}
