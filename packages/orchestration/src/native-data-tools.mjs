/**
 * The native MCP half of the five Bot data tools.
 *
 * This is a bridge to the existing Bot data service (one SQLite database per
 * Bot, in the fixed worker of bot-data-engine.mjs) — not a claim of DuckDB or
 * upstream parity. It offers the model exactly the tools the shared contract
 * (data-tool-contract.mjs) describes, with a real nested chart schema, and it
 * runs every call under the same Host authority the SDK door uses.
 *
 * What this module refuses to do, and why:
 *  - It never opens an engine for a Bot that has no grant or no committed
 *    configuration: an absent authority yields NO tools, not tools that fail
 *    later. That is decided once, at catalog construction, from committed state.
 *  - It never accepts a Bot, a path, an endpoint, a credential or an operation
 *    identity from the model. The Bot is re-derived from the same Host subject
 *    on every execute, before the engine is touched and again after the awaited
 *    work, so a revocation or a Bot change that lands mid-call withholds the
 *    result instead of returning data the Host no longer stands behind.
 *  - It never retries. A timed-out, cancelled or failed engine call is reported
 *    as it happened: a write whose outcome is unknown is not repeated, and a
 *    cancelled call's result is withheld without claiming the write never ran.
 *  - It never invents a second database, a Task authority or a request
 *    identity. The data engine owns the child lifecycle and the writes; the
 *    turn/call identity comes from the Host turn context, not from the model.
 */

import { DataFailure, sanitizeDataMessage } from './bot-data-surface.mjs'
import { redactNativeToolValue } from './native-conversation-tools.mjs'
import { DATA_TOOL_ENTRIES, invokeDataTool, parseDataToolArgs } from './data-tool-contract.mjs'

/** A structured failure the model can read; never a silent success. */
const errorOf = error => {
  if (error instanceof DataFailure) {
    // The engine already collapses paths and stack frames; sanitising again is
    // cheap and keeps a library-reader message from leaking a Host path.
    return { ...error.error, message: sanitizeDataMessage(error.error?.message ?? error.message) }
  }
  return { code: 'engine_unavailable', message: sanitizeDataMessage(error?.message ?? error) }
}

/**
 * @param {{ access: object, subject: object, botId: string, validate: () => Promise<void>|void,
 *   redact?: (text: string) => string }} options
 * @returns {{ tools: string[], handlers: object[] }} native MCP tool names and handlers
 */
export function createNativeDataTools({ access, subject, botId, validate, redact = text => text } = {}) {
  if (!access || typeof access.botIdForSubject !== 'function' || typeof access.forSubject !== 'function') {
    throw new TypeError('NATIVE_DATA_TOOLS_REQUIRE_ACCESS')
  }
  if (typeof botId !== 'string' || botId === '') throw new TypeError('NATIVE_DATA_TOOLS_REQUIRE_BOT_ID')
  if (typeof validate !== 'function') throw new TypeError('NATIVE_DATA_TOOLS_REQUIRE_VALIDATE')

  // The catalog is decided from committed authority, and it opens no engine to
  // find out: a Bot without the grant, without a committed configuration, or a
  // subject that does not own this Bot is simply offered nothing.
  let admitted = false
  try { admitted = access.botIdForSubject(subject) === botId } catch { admitted = false }
  if (!admitted) return { tools: [], handlers: [] }

  /** Re-derive this call's Bot from the same Host subject; throws when it changed. */
  const liveBotId = () => {
    const current = access.botIdForSubject(subject)
    if (current !== botId) {
      throw Object.assign(new Error('The calling Bot changed while this data call was running, so its result is withheld.'), { code: 'DATA_TOOL_BOT_CHANGED' })
    }
    return current
  }

  const handlers = DATA_TOOL_ENTRIES.map(entry => ({
    definition: { name: entry.name, description: entry.description, inputSchema: entry.inputSchema },
    capability: entry.capability,
    parse: args => parseDataToolArgs(entry.name, args),
    async execute(args, context) {
      const turn = context?.context
      if (!turn?.turnId || !turn.callId || !context?.signal) throw new Error('NATIVE_TOOL_TURN_REQUIRED')
      const { signal } = context
      // An aborted or un-admitted call reaches no engine at all.
      signal.throwIfAborted()
      await validate()
      signal.throwIfAborted()
      liveBotId()
      const bot = access.forSubject(subject, { signal })
      let value
      try { value = await invokeDataTool(bot, entry.name, args) } catch (error) { value = { error: errorOf(error) } }
      // The work is done, so its outcome may be unknown: withhold the result
      // rather than assert either that it happened or that it never ran.
      signal.throwIfAborted()
      await validate()
      signal.throwIfAborted()
      liveBotId()
      return redactNativeToolValue(value, redact)
    },
    render: value => ({
      content: [{ type: 'text', text: JSON.stringify(redactNativeToolValue(value, redact)) }],
      ...(value && typeof value === 'object' && value.error ? { isError: true } : {}),
    }),
  }))

  return { tools: handlers.map(handler => handler.definition.name), handlers }
}
