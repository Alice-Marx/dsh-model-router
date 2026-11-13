import { createRuntime, inject } from './vendor/ds-bot/index.js'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { attachDsLifecycle } from '../../packages/orchestration/src/ds-lifecycle.mjs'
import { guardDsWorkspaceReads } from '../../packages/orchestration/src/ds-workspace-privacy.mjs'
import { createProductReadModel, registerProductChannel } from './read-model.mjs'
import { needsBotPolicy } from './policy-scope.mjs'
import { createBotServing } from '../../packages/orchestration/src/bot-serving.mjs'
import { createBotThreadAdmission } from '../../packages/orchestration/src/bot-thread-admission.mjs'
import { createBotIndependentExecution } from '../../packages/orchestration/src/bot-independent-execution.mjs'
import { createPreparedModelDispatch, redactPreparedModelRequest } from '../../packages/orchestration/src/model-prepared-generation.mjs'

export { inject }
export { isAgentLoopRequest }
export const contractVersion = 1

/**
 * Compose the frozen DS runtime with the host's existing identity, policy and
 * accounting services. This module is internal: the installed MR plugin owns
 * startup, the one financial store, and final disposal of the shared services.
 */
export function createBotProduct(ctx, options = {}) {
  const { authority, directory, policy, grantFor, accountStream, onBind, authorizeRequest, now = Date.now } = options
  const optionsBeforeModelRequest = typeof options.beforeModelRequest === 'function' ? options.beforeModelRequest : async () => {}
  if (!authority || !directory || typeof policy?.modelStream !== 'function' || typeof policy?.modelIdentity !== 'function' || typeof grantFor !== 'function') {
    throw new TypeError('BOT_PRODUCT_SERVICES_REQUIRED: shared authority, directory, policy and trusted grantFor are required')
  }
  if (typeof accountStream !== 'function') throw new TypeError('BOT_PRODUCT_ACCOUNTING_REQUIRED: provide the shared accounting stream decorator')
  // An integrated module must never install/update a second ds-bot bundle.
  const rt = createRuntime(ctx, { mainName: 'Main', mainRole: '主助理', ...options.runtimeConfig, updateCheck: false })
  rt.isTextOnlyModel = route => options.isTextOnlyModel?.(route) === true
  const integratedUpdate = () => ({ available: false, phase: 'idle', source: 'integrated', name: '@ljwei-stak/dsh-model-route-bot', reason: '请通过 Bot 工作系统插件统一更新。' })
  rt.updateCheck = async () => integratedUpdate()
  rt.updateView = integratedUpdate
  rt.updateStart = () => { throw Object.assign(new Error('请在 Harness 插件管理中更新 Bot 工作系统；内置 DS 模块随同发布。'), { code: 'bot/integrated-update' }) }

  // Which runtime serves a Bot is committed state, read back through the Host's own adapter.
  // A Host that installed no switch never moved anything, so integration is the truth there; a
  // switch that cannot be read refuses the call instead of being assumed away.
  const modeOf = typeof options.modeOf === 'function' ? options.modeOf : botId => {
    const adapter = (() => { try { return ctx.get?.('botRuntimeAdapter') ?? null } catch { return null } })()
    if (!adapter || typeof adapter.modeOf !== 'function') return 'integration'
    return adapter.modeOf(botId)
  }
  const serving = (() => {
    const provided = (() => { try { return options.serving ?? ctx.get?.('botServing') ?? null } catch { return null } })()
    // A shared admission is preferred; anything that is not one is replaced rather than trusted.
    return provided && typeof provided.enter === 'function' && typeof provided.assertMode === 'function' && typeof provided.assertIdle === 'function'
      ? provided
      : createBotServing({ modeOf, rt, now })
  })()
  // The thread catalog is built after this runtime, so it is resolved per call: a guard that
  // captured a half-composed Host would either miss the service or freeze a stale one.
  const threadAdmission = createBotThreadAdmission({
    threads: options.threadHost ?? (() => { try { return ctx.get?.('botThreads') ?? null } catch { return null } }),
    nativeThreadOf: id => rt.threadOf(id),
  })
  // The admission is published before this runtime exists, so it is bound here and released on
  // disposal. Without the binding its native probe would see nothing, and a Bot mid-turn would
  // look idle to a move.
  const releaseServingRuntime = typeof serving.bindRuntime === 'function' ? serving.bindRuntime(rt) : null

  const lifecycle = attachDsLifecycle({ runtime: rt, directory, grantFor, onBind: (agent, grant) => {
    const scoped = agent.ctx.get('tools')
    let signature, release = () => {}
    const isTextOnly = selected => {
      if (typeof options.isTextOnlyModel !== 'function') return false
      const botId = authority.describe(directory.forAgent(agent)).botId
      // Main retains its multi-route grant. Its live Host selection determines
      // this step's capabilities; a saved default is not its entire route set.
      if (lifecycle.committedMainBotIds().includes(botId)) {
        const route = selected?.provider && selected?.model ? selected : agent.options
        if (route?.provider && route?.model) return options.isTextOnlyModel({ provider: route.provider, model: route.model }) === true
      }
      const ref = lifecycle.committedBot(botId)?.model ?? ''
      const at = ref.indexOf('/')
      return at > 0 && options.isTextOnlyModel({ provider: ref.slice(0, at), model: ref.slice(at + 1) }) === true
    }
    // The SDK's restrict() masks inherited tools only; DS Bot's team tools are
    // registered in the Agent's own scope. Negotiate the actual assembled request
    // through the public scoped prompt waterfall as well. The adapter still
    // independently refuses a nonempty tool request before accounting.
    const offAssembly = typeof agent.ctx.on === 'function' ? agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      refresh()
      const formed = await next()
      return isTextOnly(formed.variables) ? { ...formed, tools: [] } : formed
    }, { prepend: true }) : () => {}
    const offRequest = typeof agent.ctx.on === 'function' && typeof options.prepareLoopFunding === 'function' ? agent.ctx.on('agent/request', async (position, next) => {
      const config = await next()
      const botId = authority.describe(directory.forAgent(agent)).botId
      return options.prepareLoopFunding({ botId, sessionId: agent.session.id, signal: position.signal, config,
        previousConfig: agent.session.requestHeader?.()?.config })
    }, { prepend: true }) : () => {}
    const refresh = () => {
      const deny = ctx.tools.schemas().map(tool => tool.name)
        .filter(name => (name.startsWith('model_router_') && !grant.tools.includes(`tool/${name}`)) ||
          (name.startsWith('bot_task_') && !grant.tools.includes(`task/${({ start: 'submit', status: 'read', plan_start:'submit',plan_status:'read',plan_cancel:'cancel' })[name.slice(9)] ?? name.slice(9)}`)) ||
          (name.startsWith('data_') && !grant.tools.includes('tool/data')) ||
          (['coordinate_bots', 'assignment_status', 'list_threads'].includes(name) && !grant.tools.includes('tool/team')) ||
          (name.startsWith('remote_computer_') && name !== 'remote_computer_browser' && !grant.tools.includes(`tool/${name}`)))
        .sort()
      const next = JSON.stringify(deny)
      if (next === signature) return
      signature = next
      release()
      release = deny.length ? scoped.restrict({ deny }) : () => {}
    }
    const off = ctx.on('tools/change', refresh)
    let extra
    try { refresh(); extra = onBind?.(agent, grant) } catch (error) { off(); offAssembly(); offRequest(); release(); throw error }
    return () => { off(); offAssembly(); offRequest(); release(); extra?.() }
  } })
  // Creation may select a model before the owner has committed its binding.
  // A greeting is an automatic model call, so it waits for the same committed
  // identity, route, capability, funding and runtime used by ordinary turns.
  rt.kickoffReady = bot => {
    try {
      const saved = lifecycle.committedBot(bot?.id)
      if (!saved?.model || saved.model !== bot.model) return false
      const at = saved.model.indexOf('/')
      if (at < 1) return false
      const route = { provider: saved.model.slice(0, at), model: saved.model.slice(at + 1) }
      const subject = directory.forBot(saved.id)
      authority.assertTool(subject, 'model/infer')
      authority.assertModel(subject, route.provider, route.model)
      serving.assertMode(saved.id, 'integration')
      return typeof options.kickoffReadyFor !== 'function' || options.kickoffReadyFor(saved.id, route) === true
    } catch { return false }
  }
  const offAgent = ctx.on('agent/created', ({ agent }) => lifecycle.observeAgent(agent))
  // The independent loop's turns run in a frame only this Host can build: the committed Bot, the
  // model that Bot has saved, the Bot policy and the one money stream. It is published once, before
  // any Bot is moved, and the loop asks it per step — a Host that has not started this product has
  // no such frame, and the independent runtime then refuses to run instead of answering from a
  // global provider/model setting.
  // A Host-prepared stream binds one adapter generation (metadata + dispatch) and admits the money
  // against that same generation, so a registration replaced between admission and dispatch cannot
  // price one window and stream another. It is composed from the Host's own `llm`, a Host-owned
  // frame store and the committed funding reader; without that wiring the bridge falls back to the
  // ordinary stream, which re-resolves the model at dispatch exactly as before.
  // A funded Host that supplied this wiring must support prepareCall; it never
  // silently downgrades that request to an unprepared dispatch.
  const hostLlm = () => { try { return ctx.get?.('llm') ?? ctx.llm ?? null } catch { return ctx.llm ?? null } }
  const modelFrames = options.modelFrames ?? null
  const preparedDispatch = (options.modelFrames && typeof options.fundingFor === 'function')
    ? createPreparedModelDispatch({ llm: hostLlm, frames: options.modelFrames, fundingFor: options.fundingFor })
    : null
  const independentExecution = createBotIndependentExecution({
    policy, directory, lifecycle, serving, authority,
    ...(options.independentReadyFor===undefined?{}:{readyFor:options.independentReadyFor}),
    stream: (request, context) => {
      const llm = hostLlm()
      if (!llm || typeof llm.stream !== 'function') throw Object.assign(new Error('宿主模型服务不可用，本次请求被拒绝。'), { code: 'HOST_LLM_UNAVAILABLE' })
      // The prepared path needs the SDK's prepareCall seam. A Host wired for it with a runtime
      // that exposes it binds and admits one generation; otherwise the ordinary stream runs,
      // re-resolving the model at dispatch exactly as before.
      if (preparedDispatch) return (async function* () {
        await rt.loadSecrets?.()
        const redacted = redactPreparedModelRequest(request, rt.redactSecrets)
        if (redacted.messages !== request.messages) rt.carryUsageTag?.(request.messages, redacted.messages)
        yield* preparedDispatch.dispatch(redacted, context)
      })()
      return llm.stream(request)
    },
  })
  ctx.provide('botIndependentExecution', independentExecution)
  // Every chunk is re-decided. The policy already re-asserts the committed model route per
  // chunk; ownership, archive, revocation and the committed runtime are re-read here with it, so
  // a change made mid-turn stops the stream at the next chunk instead of letting it finish under
  // a Bot, a thread or a runtime that no longer stands.
  const serveStream = async function* (options, { botId, thread, guarded, independent }) {
    for await (const chunk of policy.modelStream(options, guarded)) {
      if (thread.kind === 'thread') threadAdmission.admit(options.sessionId)
      // An independent turn re-reads the Bot's own committed record with the mode, so a Bot that
      // was deleted, suspended or moved stops here rather than finishing on a stale one.
      if (independent) independentExecution.assertTurn(botId)
      else serving.assertMode(botId, 'integration')
      yield chunk
    }
  }
  const offStream = ctx.on('llm/stream', (options, next) => (async function* () {
    await rt.load()
    const prepared = modelFrames?.read?.(options.signal)
    if (prepared?.request && prepared.request !== options) {
      throw Object.assign(new Error('模型请求在准备后被改写，已拒绝更换调用配置；请核对原请求后重试。'), { code: 'MODEL_PREPARED_REQUEST_REWRITTEN' })
    }
    // A Bot thread is decided on the thread catalog, before the ordinary Session bypass. The
    // runtime's live owner index is not enough: an archived thread, a revoked grant, a deleted
    // Bot and a moved runtime all leave that index, and the bypass would then answer for the
    // Bot with no Bot policy, no accounting and no thread at all.
    const thread = threadAdmission.admit(options.sessionId)
    const frame = policy.activeIdentity()
    if (modelFrames && frame?.independent === true && !prepared) {
      throw Object.assign(new Error('独立模型调用缺少宿主准备记录，已拒绝未绑定的调用。'), { code: 'MODEL_PREPARED_CONTEXT_REQUIRED' })
    }
    const policed = thread.kind === 'thread'
      || needsBotPolicy({ admitted: Boolean(frame), isBotSession: id => rt.isBotSession(id), sessionId: options.sessionId })
    if (!policed) { yield* next(); return }
    // A frame this Host built for an independent turn. The committed switch — not the frame —
    // decides which runtime answers, so the admission below runs with `independent` expected: a
    // Bot still on the integration path is refused rather than answered twice, and a Bot that was
    // moved is served here instead of being rejected as a moved Bot.
    const independent = frame?.independent === true
    // The policy also understands its AsyncLocalStorage execution context.
    // Resolve identity within the guarded next() call, after policy admission.
    const guarded = async function* () {
      // Identity comes from the trusted context: the live Session when present,
      // otherwise the admitted execution frame (a direct MR call inside a tool
      // carries no sessionId of its own).
      const identity = policy.modelIdentity(options)
      await optionsBeforeModelRequest(options, identity)
      // An independent turn is the Bot's own session turn: its own transcript, its own money.
      const source = independent || (!rt.ownRequest(options) && isAgentLoopRequest(options)) ? 'bot-session' : 'bot-auxiliary'
      yield* accountStream(options, next, { ...identity, source, ownRequest:Boolean(rt.ownRequest(options)),agentLoop:isAgentLoopRequest(options), runtime: rt })
    }
    // The Bot this call speaks for comes from committed state — the thread record, the live
    // Session (a chat, a group Session or an earlier part of either), or the admitted execution
    // frame — never from the request. A group Session is a Bot's own work exactly like its chat.
    const botId = thread.kind === 'thread' ? thread.botId
      : independent ? frame?.botId ?? null
      : rt.selfOf(options.sessionId) ?? rt.groupOwners?.get(options.sessionId)?.botId ?? frame?.botId ?? null
    if (typeof botId !== 'string' || botId === '') {
      // A call the product claims but cannot attribute is refused. Falling through to the
      // ordinary bypass here would answer for a Bot with no Bot policy and no accounting.
      throw Object.assign(new Error('无法确认本次请求所属的 Bot，已拒绝。'), { code: 'PRODUCT_IDENTITY_UNRESOLVED', outcome: 'refused' })
    }
    if (frame?.owner === true) {
      // An owner frame is a person's own call, not a Bot turn: the policy and the one money
      // stream still apply, but no Bot is being served, so no lease and no runtime is chosen.
      yield* policy.modelStream(options, guarded)
      return
    }
    // One writer per Bot, on the committed runtime, for the whole stream: the lease is what a
    // move has to see, and it is released on completion, cancel, failure or exception alike.
    serving.assertMode(botId, independent ? 'independent' : 'integration')
    const lease = serving.enter(botId)
    try {
      yield* serveStream(options, { botId, thread, guarded, independent })
    } finally {
      lease.release()
    }
  })())
  const readModel = createProductReadModel({ runtime: rt, lifecycle, providers: options.readModels, actions: options.actions })
  ctx.provide('botProductReadModel', readModel)
  const releaseChannel = authorizeRequest ? registerProductChannel(ctx, readModel, authorizeRequest) : () => {}
  const releaseWorkspacePrivacy = guardDsWorkspaceReads(ctx, rt)
  let closed = false
  const dispose = () => {
    if (closed) return
    closed = true
    releaseServingRuntime?.()
    releaseWorkspacePrivacy(); releaseChannel(); offStream(); offAgent(); lifecycle.close()
  }
  ctx.effect(() => dispose, 'bot-product: composed lifecycle')
  return Object.freeze({ version: contractVersion, rt, lifecycle, readModel, dispose, serving, threadAdmission })
}
