import { TASK_TOOL_CAPABILITIES } from '../../packages/orchestration/src/task-tools.mjs'

/** Stable optional seam; normal legacy profiles keep their existing behavior. */
export function legacyPolicy(ctx, required = false) {
  let policy
  try { policy = ctx.get?.('botIntegrationPolicy') } catch { /* absent optional service */ }
  if (policy && ['run', 'check', 'filterRoutes'].every(key => typeof policy[key] === 'function')) return policy
  if (policy || required) throw new Error('Bot integration policy is unavailable; operation refused')
  return null
}

export const policyRequired = config => {
  const value = config?.requireBotPolicy
  return (typeof value === 'function' ? value() : value) === true
}

export function registerPolicyTool(ctx, config, definition) {
  return ctx.tools.register({ ...definition, execute(args, exec) {
    const policy = legacyPolicy(ctx, policyRequired(config))
    if (!policy) return definition.execute(args, exec)
    return policy.run({ kind: 'tool', name: definition.name, agent: exec.agent, signal: exec.signal },
      signal => definition.execute(args, { ...exec, signal }))
  } })
}

export function registerPolicyCommand(ctx, config, definition) {
  return ctx.commands.register({ ...definition, async handler(invocation) {
    try {
      const policy = legacyPolicy(ctx, policyRequired(config))
      if (!policy) return await definition.handler(invocation)
      return await policy.run({ kind: 'command', name: definition.name, agent: invocation.agent, rawInput: invocation.rawInput, signal: invocation.signal },
        signal => definition.handler({ ...invocation, signal }))
    } catch (error) { return { kind: 'error', text: error.message } }
  } })
}

export function guardLegacyTools(ctx, config) {
  // Missing guard support is unsafe only for an explicitly strict profile.
  if (typeof ctx.tools.guard !== 'function') {
    if (policyRequired(config)) throw new Error('Bot policy requires monotonic host tool guards')
    return
  }
  ctx.tools.guard(exec => {
    // Every tool this plugin registers is guarded, not just the router's own prefix: the Bot library
    // and routine tools are registered through the same wrapper, so a strict profile must refuse
    // them before their body runs rather than relying on the body to notice.
    if (!exec.name.startsWith('model_router_') && !exec.name.startsWith('bot_')) return
    const taskCapability = TASK_TOOL_CAPABILITIES[exec.name]
    // Managed Task commands have their own committed task/* authority. Their tool schema name is
    // a facade, not another permission: inventing tool/bot_task_start here denied valid task/submit.
    const call = taskCapability ? { kind: 'task', name: taskCapability.slice('task/'.length), agent: exec.agent }
      : { kind: 'tool', name: exec.name, agent: exec.agent }
    try { legacyPolicy(ctx, policyRequired(config))?.check(call) }
    catch (error) { return error.message }
  })
}
