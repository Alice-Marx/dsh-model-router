import { createRuntime, inject } from './vendor/ds-bot/index.js'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { attachDsLifecycle } from '../../packages/orchestration/src/ds-lifecycle.mjs'
import { guardDsWorkspaceReads } from '../../packages/orchestration/src/ds-workspace-privacy.mjs'
import { createProductReadModel, registerProductChannel } from './read-model.mjs'
import { needsBotPolicy } from './policy-scope.mjs'

export { inject }
export const contractVersion = 1

/**
 * Compose the frozen DS runtime with the host's existing identity, policy and
 * accounting services. This module is internal: the installed MR plugin owns
 * startup, the one financial store, and final disposal of the shared services.
 */
export function createBotProduct(ctx, options = {}) {
  const { authority, directory, policy, grantFor, accountStream, onBind, authorizeRequest } = options
  if (!authority || !directory || typeof policy?.modelStream !== 'function' || typeof policy?.modelIdentity !== 'function' || typeof grantFor !== 'function') {
    throw new TypeError('BOT_PRODUCT_SERVICES_REQUIRED: shared authority, directory, policy and trusted grantFor are required')
  }
  if (typeof accountStream !== 'function') throw new TypeError('BOT_PRODUCT_ACCOUNTING_REQUIRED: provide the shared accounting stream decorator')
  // An integrated module must never install/update a second ds-bot bundle.
  const rt = createRuntime(ctx, { mainName: 'Main', mainRole: '主助理', ...options.runtimeConfig, updateCheck: false })
  const integratedUpdate = () => ({ available: false, phase: 'idle', source: 'integrated', name: '@ljwei-stak/dsh-model-router', reason: '请通过 Bot 工作系统插件统一更新。' })
  rt.updateCheck = async () => integratedUpdate()
  rt.updateView = integratedUpdate
  rt.updateStart = () => { throw Object.assign(new Error('请在 Harness 插件管理中更新 Bot 工作系统；内置 DS 模块随同发布。'), { code: 'bot/integrated-update' }) }

  const lifecycle = attachDsLifecycle({ runtime: rt, directory, grantFor, onBind: (agent, grant) => {
    const scoped = agent.ctx.get('tools')
    let signature, release = () => {}
    const refresh = () => {
      const deny = ctx.tools.schemas().map(tool => tool.name)
        .filter(name => (name.startsWith('model_router_') && !grant.tools.includes(`tool/${name}`)) ||
          (name.startsWith('bot_task_') && !grant.tools.includes(`task/${({ start: 'submit', status: 'read', plan_start:'submit',plan_status:'read',plan_cancel:'cancel' })[name.slice(9)] ?? name.slice(9)}`)) ||
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
    try { refresh(); extra = onBind?.(agent, grant) } catch (error) { off(); release(); throw error }
    return () => { off(); release(); extra?.() }
  } })
  const offAgent = ctx.on('agent/created', ({ agent }) => lifecycle.observeAgent(agent))
  const offStream = ctx.on('llm/stream', (options, next) => (async function* () {
    await rt.load()
    // Only Bot turns belong to this product. An ordinary Harness session (the user's own chat,
    // another plugin) has no committed Bot grant, so policing it would refuse the call with
    // UNKNOWN_SUBJECT instead of letting the Harness answer. An admitted MR frame is always the
    // product's own work, whatever Session it carries.
    if (!needsBotPolicy({ admitted: Boolean(policy.activeIdentity()), isBotSession: id => rt.isBotSession(id), sessionId: options.sessionId })) { yield* next(); return }
    // The policy also understands its AsyncLocalStorage execution context.
    // Resolve identity within the guarded next() call, after policy admission.
    const guarded = () => {
      // Identity comes from the trusted context: the live Session when present,
      // otherwise the admitted execution frame (a direct MR call inside a tool
      // carries no sessionId of its own).
      const identity = policy.modelIdentity(options)
      const source = !rt.ownRequest(options) && isAgentLoopRequest(options) ? 'bot-session' : 'bot-auxiliary'
      return accountStream(options, next, { ...identity, source, ownRequest:Boolean(rt.ownRequest(options)),agentLoop:isAgentLoopRequest(options), runtime: rt })
    }
    yield* policy.modelStream(options, guarded)
  })())
  const readModel = createProductReadModel({ runtime: rt, lifecycle, providers: options.readModels, actions: options.actions })
  ctx.provide('botProductReadModel', readModel)
  const releaseChannel = authorizeRequest ? registerProductChannel(ctx, readModel, authorizeRequest) : () => {}
  const releaseWorkspacePrivacy = guardDsWorkspaceReads(ctx, rt)
  let closed = false
  const dispose = () => {
    if (closed) return
    closed = true
    releaseWorkspacePrivacy(); releaseChannel(); offStream(); offAgent(); lifecycle.close()
  }
  ctx.effect(() => dispose, 'bot-product: composed lifecycle')
  return Object.freeze({ version: contractVersion, rt, lifecycle, readModel, dispose })
}
