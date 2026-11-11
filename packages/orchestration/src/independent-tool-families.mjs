/** Add Host-selected families to the API loop without inventing a Harness Agent.
 * Native CLI routes retain their private, typed MCP doors. Families are resolved
 * again per catalog/call, and never supply model or funding authority.
 */
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }) }

export function extendIndependentToolHost({ base, familiesFor, validateCall = () => {} } = {}) {
  if (typeof base?.forBot !== 'function' || typeof familiesFor !== 'function') throw new TypeError('INDEPENDENT_FAMILIES_HOST_REQUIRED')
  let closed = false
  const lifetime = new AbortController()
  const alive = () => { if (closed) fail('TOOL_HOST_CLOSED', '宿主工具服务已关闭，本次调用被拒绝。') }
  return Object.freeze({ ...base,
    forBot(botId, options = {}) {
      const view = base.forBot(botId, options)
      // The native adapter has its own schema/parser/renderers and must never
      // convert a CLI-observed call into an SDK executable call.
      if (options.nativeRoute) return view
      const offered = context => {
        alive()
        const entries = familiesFor(botId, context) ?? []
        if (!Array.isArray(entries)) fail('INDEPENDENT_FAMILIES_INVALID')
        const names = new Set(view.schemas().map(entry => entry.name))
        for (const entry of entries) {
          const name = entry.handler?.definition?.name
          if (typeof name !== 'string' || !entry.handler.definition.inputSchema
            || typeof entry.handler.parse !== 'function' || typeof entry.handler.execute !== 'function'
            || names.has(name)) fail('INDEPENDENT_FAMILIES_INVALID')
          names.add(name)
        }
        return entries
      }
      return Object.freeze({ ...view,
        schemas: () => [...view.schemas(), ...offered().map(({ handler }) => ({ name: handler.definition.name,
          description: handler.definition.description, parameters: handler.definition.inputSchema }))],
        isReadonly: name => {
          const entry = offered().find(row => row.handler.definition.name === name)
          return entry ? entry.readonly === true : view.isReadonly(name)
        },
        async call(name, args = {}, context = {}) {
          alive()
          if (context.botId !== undefined && context.botId !== botId) fail('SUBJECT_MISMATCH')
          await validateCall(botId, context)
          alive(); context.signal?.throwIfAborted()
          const entry = offered(context).find(row => row.handler.definition.name === name)
          if (!entry) {
            const value = await view.call(name, args, context)
            alive(); context.signal?.throwIfAborted()
            await validateCall(botId, context)
            return value
          }
          if (typeof context.turnId !== 'string' || !context.turnId || typeof context.callId !== 'string' || !context.callId || !context.signal) fail('INDEPENDENT_TOOL_TURN_REQUIRED')
          const signal = AbortSignal.any([lifetime.signal, context.signal])
          signal.throwIfAborted()
          const parsed = entry.handler.parse(args)
          await entry.validate?.()
          const value = await entry.handler.execute(parsed, { context: { turnId: context.turnId, callId: context.callId,
            ...(typeof context.conversationId === 'string' ? { conversationId: context.conversationId } : {}) }, signal })
          alive(); signal.throwIfAborted()
          await entry.validate?.()
          await validateCall(botId, context)
          alive(); signal.throwIfAborted()
          return value
        },
      })
    },
    close() {
      if (closed) return
      closed = true
      lifetime.abort(new Error('TOOL_HOST_CLOSED'))
      base.close?.()
    },
  })
}
