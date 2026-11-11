/**
 * The five data tools a Bot can call: data_load, data_describe, data_sql,
 * data_show, data_export. They are the model-facing half of the loop; the
 * panel's owner actions (bot-data-actions.mjs) are the other half.
 *
 * Authority: the calling Bot's id comes from the live session through the
 * injected `botIdFor(exec)` — never from an argument. A Bot only ever reaches
 * its own database; it cannot name another Bot, an OS path, a program, a
 * database file or a URL. Data enters only from a bounded controlled library
 * read or bounded inline content. Every failure is a structured DataError the
 * model can read, never a silent success.
 *
 * `botIdFor` is the Host's grant check (see data-product-access.mjs): a Bot
 * without the `tool/data` grant, or one whose configuration is not committed,
 * gets `unauthorized` with the Host's own reason instead of a vague refusal.
 *
 * Names, descriptions, the SDK parameter map and the business projection all
 * come from the shared contract (data-tool-contract.mjs), which the native MCP
 * door (native-data-tools.mjs) reads too: the two doors cannot drift apart, and
 * a model-supplied `botId` is projected away rather than accepted as authority.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { DataFailure, sanitizeDataMessage } from './bot-data-surface.mjs'
import { DATA_TOOL_ENTRIES, invokeDataTool } from './data-tool-contract.mjs'

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

const errorOf = error => (error instanceof DataFailure ? error.error : { code: 'engine_unavailable', message: String(error?.message ?? error) })

/**
 * @param {object} ctx Host tool registry ({ tools: { register } }).
 * @param {{ engine: object, botIdFor: (exec: object) => string | null }} source
 * @returns {() => void} release
 */
export function registerDataTools(ctx, { engine, botIdFor } = {}) {
  if (!engine || typeof engine.forBot !== 'function') throw new TypeError('DATA_TOOLS_REQUIRE_ENGINE')
  if (typeof botIdFor !== 'function') throw new TypeError('DATA_TOOLS_REQUIRE_BOT_ID_FOR')
  if (!ctx || typeof ctx.tools?.register !== 'function') throw new TypeError('DATA_TOOLS_REQUIRE_CTX')

  const asBot = async (exec, run) => {
    let botId = null
    // A Bot without the data grant, or one whose configuration is not committed
    // yet, is refused HERE with the Host's own reason — not as a vague
    // "unknown subject".
    try { botId = botIdFor(exec) ?? null } catch (error) {
      return { error: { code: 'unauthorized', message: sanitizeDataMessage(error?.message ?? error) } }
    }
    if (typeof botId !== 'string' || botId === '') return { error: { code: 'unknown_subject', message: 'The calling Bot could not be identified from the live session.' } }
    try { return await run(engine.forBot(botId), botId) } catch (error) { return { error: errorOf(error) } }
  }

  const tools = DATA_TOOL_ENTRIES.map(entry => defineTool({
    name: entry.name,
    description: entry.description,
    parameters: entry.parameters,
    output: JSON_OUTPUT,
    // Business arguments only: the projection drops anything the model added,
    // including a botId, so it can never be read as authority.
    execute: (args, exec) => asBot(exec, (bot, botId) => invokeDataTool(bot, entry.name, args)),
  }))

  const releases = tools.map(tool => ctx.tools.register(tool))
  return () => { for (const release of releases.reverse()) release() }
}
