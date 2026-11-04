/**
 * Remote tools for the independent loop.
 *
 * The plugin does not own a machine: the Host does. So this adapter owns no authority either — it
 * takes an `invoke` function the Host builds from its machine service and the Bot's committed
 * grant, and exposes the same tool names the model-facing path uses. A name outside the allowed set
 * never reaches `invoke`, so a reply cannot invent a tool.
 *
 * `invoke(tool, args)` must already bind machine, root, Bot, task and operation identity. Nothing
 * here passes an endpoint, a path outside the root, or an operation id.
 */

export const REMOTE_TOOL_NAMES = Object.freeze([
  'machine_ping', 'fs_list', 'fs_read', 'fs_write', 'shell_exec',
  'operation_status', 'artifact_stat', 'artifact_read',
])

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

/**
 * @param {{ invoke: (tool: string, args: object) => Promise<unknown>, names?: string[], origin?: string }} options
 */
export function createRemoteTools({ invoke, names = REMOTE_TOOL_NAMES, origin = '远程电脑' } = {}) {
  if (typeof invoke !== 'function') throw new TypeError('REMOTE_TOOLS_REQUIRE_INVOKE')
  if (!Array.isArray(names) || names.length === 0) throw new TypeError('REMOTE_TOOLS_REQUIRE_NAMES')
  const allowed = names.filter(name => REMOTE_TOOL_NAMES.includes(name))
  if (allowed.length === 0) throw new TypeError('REMOTE_TOOLS_EMPTY_GRANT')

  return Object.freeze({
    names: [...allowed].sort(),
    origin,
    async call(name, args = {}) {
      if (typeof name !== 'string' || !allowed.includes(name)) fail('TOOL_NOT_GRANTED')
      if (!args || typeof args !== 'object' || Array.isArray(args)) fail('INVALID_TOOL_ARGS')
      // The Host owns identity; a reply must not smuggle it into the arguments.
      for (const key of ['machineId', 'rootId', 'botId', 'taskId', 'attemptId', 'operationId', 'endpoint', 'secretRef']) {
        if (Object.hasOwn(args, key)) fail(`TOOL_ARG_FORBIDDEN:${key}`)
      }
      return invoke(name, args)
    },
  })
}
