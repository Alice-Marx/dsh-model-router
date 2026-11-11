/**
 * Remote tools for the independent loop.
 *
 * The plugin does not own a machine: the Host does. So this adapter owns no authority either — it
 * takes an `invoke` function the Host builds from its machine service and the Bot's committed
 * grant, and exposes the same tool names the model-facing path uses. A name outside the allowed set
 * never reaches `invoke`, so a reply cannot invent a tool.
 *
 * `invoke(tool, args, context)` must already bind machine, root, Bot, task and operation identity,
 * and it receives the turn's cancel signal so a stop reaches the machine layer. Nothing here passes
 * an endpoint, a path outside the root, or an operation id.
 */

export const REMOTE_TOOL_NAMES = Object.freeze([
  'machine_ping', 'fs_list', 'fs_read', 'fs_write', 'shell_exec',
  'operation_status', 'artifact_stat', 'artifact_read',
])

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

/** Tools that only read. Everything else mutates and stays sequential. */
export const READ_ONLY_TOOLS = Object.freeze(['machine_ping', 'fs_list', 'fs_read', 'operation_status', 'artifact_stat', 'artifact_read'])

/**
 * @param {{ invoke: (tool: string, args: object, context?: { signal?: AbortSignal, botId?: string }) => Promise<unknown>, names?: string[], origin?: string }} options
 */
export function createRemoteTools({ invoke, names = REMOTE_TOOL_NAMES, machines = [], origin = '远程电脑' } = {}) {
  if (typeof invoke !== 'function') throw new TypeError('REMOTE_TOOLS_REQUIRE_INVOKE')
  if (!Array.isArray(names) || names.length === 0) throw new TypeError('REMOTE_TOOLS_REQUIRE_NAMES')
  const allowed = names.filter(name => REMOTE_TOOL_NAMES.includes(name))
  if (allowed.length === 0) throw new TypeError('REMOTE_TOOLS_EMPTY_GRANT')
  // The Bot may name a machine only from this list; the Host still re-checks the binding.
  const machinesAllowed = Array.isArray(machines) ? machines.filter(id => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(id)) : []

  return Object.freeze({
    names: [...allowed].sort(),
    machines: [...machinesAllowed].sort(),
    /** Whether a name may run beside another call in the same step. */
    isReadonly: name => allowed.includes(name) && READ_ONLY_TOOLS.includes(name),
    origin,
    async call(name, args = {}, context = {}) {
      if (typeof name !== 'string' || !allowed.includes(name)) fail('TOOL_NOT_GRANTED')
      if (!args || typeof args !== 'object' || Array.isArray(args)) fail('INVALID_TOOL_ARGS')
      if (Object.hasOwn(args, 'machineId') && !machinesAllowed.includes(args.machineId)) fail('MACHINE_NOT_ALLOWED')
      // The Host owns identity; a reply must not smuggle it into the arguments.
      for (const key of ['rootId', 'botId', 'taskId', 'attemptId', 'operationId', 'endpoint', 'secretRef']) {
        if (Object.hasOwn(args, key)) fail(`TOOL_ARG_FORBIDDEN:${key}`)
      }
      // The turn's cancel travels with the call, so a stop reaches the machine layer instead of
      // being discovered only after the whole round finished.
      return invoke(name, args, { ...(context?.signal ? { signal: context.signal } : {}), ...(context?.botId ? { botId: context.botId } : {}) })
    },
  })
}
