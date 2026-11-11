import { independentToolEntry } from './independent-tool-catalog.mjs'

// This fixed catalog uses nullable type arrays and numeric bounds, which the
// installed SDK's narrower JSON schema validator does not accept.
function parseToolArgs(entry, args) {
  const fail = () => { throw Object.assign(new Error('INVALID_TOOL_ARGS'), { code: 'INVALID_TOOL_ARGS' }) }
  const { properties, required } = entry.parameters
  if (!args || Object.getPrototypeOf(args) !== Object.prototype || Object.keys(args).some(key => !Object.hasOwn(properties, key))
    || required.some(key => !Object.hasOwn(args, key)) || Buffer.byteLength(JSON.stringify(args)) > 128_000) fail()
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key], types = [schema.type].flat()
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const integer = types.includes('integer') && Number.isSafeInteger(value)
    if (!types.includes(kind) && !integer) fail()
    if (schema.enum && !schema.enum.includes(value)) fail()
    if (schema.items && value.some(item => typeof item !== schema.items.type)) fail()
    if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) fail()
  }
  return args
}

const reference = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : null

/** Native MCP calls use the same Bot tool service and durable Task identities. */
export function createNativeConversationTools({ view, validate, redact = text => text, entryFor = independentToolEntry, render = null }) {
  const handlers = view.schemas().map(schema => {
    const entry = entryFor(schema.name)
    return {
      definition: { name: schema.name, description: schema.description, inputSchema: schema.parameters },
      capability: entry.capability ?? entry.grants[0],
      parse: args => parseToolArgs(entry, args),
      ...(render ? { render: value => render(value, redact) } : {}),
      async execute(args, context) {
        const turn = context.context
        if (!turn?.turnId || !turn.callId || !context.signal) throw new Error('NATIVE_TOOL_TURN_REQUIRED')
        context.signal.throwIfAborted()
        await validate()
        context.signal.throwIfAborted()
        let value
        try { value = await view.call(schema.name, args, { turnId: turn.turnId, callId: turn.callId, signal: context.signal }) }
        catch (error) {
          if (render && reference(error.operationId)) {
            value = { status: 'unknown', operationId: error.operationId, value: null,
              error: /^[A-Z_]{1,80}$/.test(error.code ?? '') ? error.code : 'NATIVE_REMOTE_OUTCOME_UNKNOWN',
              nextAction: 'Query this original operation with bot_remote_operation_status before taking further action.' }
          } else {
            if (!entry.backend || !reference(error.taskId)) throw error
            // A tracked write keeps its identity even when the result is unknown.
            // The native model can inspect that Task without submitting another.
            value = { outcome: error.code === 'TASK_OUTCOME_UNKNOWN' ? 'needs-reconciliation' : 'failed',
              code: /^[A-Z_]{1,80}$/.test(error.code ?? '') ? error.code : 'TASK_NOT_COMPLETED',
              taskId: error.taskId, attemptId: reference(error.attemptId), operationId: reference(error.operationId),
              nextAction: 'Query this original Task with bot_task_status before taking further action. An unknown write must be reconciled before it is repeated.' }
          }
        }
        context.signal.throwIfAborted()
        return render ? value : redactNativeToolValue(value, redact)
      },
    }
  })
  return { tools: handlers.map(handler => handler.definition.name), handlers }
}

/** Preserve JSON types while redacting string values from Host results. */
export function redactNativeToolValue(value, redact) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(item => redactNativeToolValue(item, redact))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactNativeToolValue(item, redact)]))
  return value ?? null
}

export function renderNativeRemoteResult(value, redact) {
  const { image, ...metadata } = value
  return { content: [
    { type: 'text', text: JSON.stringify(redactNativeToolValue(metadata, redact)) },
    ...(image ? [{ type: 'image', mimeType: image.mimeType, data: image.data }] : []),
  ], ...(value.status !== 'succeeded' || value.error ? { isError: true } : {}) }
}
