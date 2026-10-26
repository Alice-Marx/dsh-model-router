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
    if (!exec.name.startsWith('model_router_')) return
    try { legacyPolicy(ctx, policyRequired(config))?.check({ kind: 'tool', name: exec.name, agent: exec.agent }) }
    catch (error) { return error.message }
  })
}
