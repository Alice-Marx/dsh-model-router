import { redactNativeToolValue } from './native-conversation-tools.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const runSchema = { type: 'object', additionalProperties: false, properties: {
  tool: { type: 'string', maxLength: 80 }, task: { type: 'string', minLength: 1, maxLength: 32000 },
  cliModel: { type: 'string', maxLength: 128 }, mode: { type: 'string', enum: ['read-only', 'workspace-write'] },
}, required: ['tool', 'task'] }
const parse = (name, value) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_TOOL_ARGS')
  if (name === 'model_router_tools') { if (Object.keys(value).length) fail('INVALID_TOOL_ARGS'); return value }
  if (Object.keys(value).some(key => !Object.hasOwn(runSchema.properties, key)) || typeof value.tool !== 'string' || !value.tool || value.tool.length > 80
    || typeof value.task !== 'string' || !value.task.trim() || value.task.length > 32000
    || value.cliModel !== undefined && (typeof value.cliModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/.test(value.cliModel))
    || value.mode !== undefined && !runSchema.properties.mode.enum.includes(value.mode)) fail('INVALID_TOOL_ARGS')
  return value
}

/** Native MCP and independent API loops reuse the same CLI runner and authority. */
export function createNativeOfficialTools({ access, botId, validate, run, within, redact = text => text }) {
  if (!access.snapshotFor(botId).length) return { tools: [], handlers: [] }
  const handlers = ['model_router_tools', 'model_router_tool_run'].map(name => ({
    definition: { name, description: name === 'model_router_tools' ? 'List this Bot’s configured official CLIs, live readiness and allowed modes.'
      : 'Run an explicitly authorized official CLI in this Bot’s Host-selected workspace. Use vendor-default for the CLI’s own configured model. Cannot choose paths, credentials or executables. Write tasks require Host approval and a clean Git workspace; failures never fall back to an API.',
    inputSchema: name === 'model_router_tools' ? { type: 'object', properties: {}, required: [], additionalProperties: false } : runSchema },
    capability: `tool/${name}`, parse: args => parse(name, args),
    render: value => ({ content: [{ type: 'text', text: JSON.stringify(redactNativeToolValue(value, redact)) }], ...(value?.error ? { isError: true } : {}) }),
    async execute(args, context) {
      const turn = context?.context
      if (!turn?.turnId || !turn.callId || !context.signal) fail('NATIVE_TOOL_TURN_REQUIRED')
      context.signal.throwIfAborted(); await validate(); context.signal.throwIfAborted()
      const value = await within(context.signal, async () => {
        access.assertCapability(botId, name)
        const result = name === 'model_router_tools' ? { tools: access.snapshotFor(botId) } : await run(args, { signal: context.signal })
        context.signal.throwIfAborted()
        access.assertCapability(botId, name)
        return result
      })
      context.signal.throwIfAborted(); await validate(); context.signal.throwIfAborted()
      return redactNativeToolValue(value, redact)
    },
  }))
  return { tools: handlers.map(handler => handler.definition.name), handlers }
}
