/**
 * Tools for a Bot's own library.
 *
 * Two gates, in this order:
 *  1. the policy wrapper every other owner tool uses (`registerPolicyTool`) authorises the turn;
 *  2. this module decides *which* library — the caller's own Bot when the Host can say which one
 *     that is, and otherwise only when the operator passthrough is on, so a Bot can never reach
 *     another Bot's library by naming it.
 *
 * Paths stay relative and bounded: the library module does the resolution and refuses escapes.
 */

import { join } from 'node:path'

const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const fail = code => { const error = new Error(code); error.code = code; throw error }

/**
 * @param {{
 *   ctx: object, config: object, defineTool: Function, registerPolicyTool: Function,
 *   stateDir: string, library: object,
 * }} host
 */
export function registerLibraryTools({ ctx, config, defineTool, registerPolicyTool, library, jsonOutput, jsonValue, stateDir }) {
  if (!library) return false
  const target = {
    botId: { type: 'string', required: true },
    relativePath: { type: 'string' },
  }

  const libraryFor = exec => {
    const asked = exec?.arguments?.botId
    if (typeof asked !== 'string' || !BOT_ID.test(asked)) fail('LIBRARY_BOT_ID_INVALID')
    // The Host may know which Bot is talking; then that Bot's id is the only one allowed.
    let callerBotId = null
    try { callerBotId = ctx.get?.('botIdForAgent')?.(exec.agent) ?? null } catch { callerBotId = null }
    if (typeof callerBotId === 'string' && callerBotId !== '') {
      if (callerBotId !== asked) fail('LIBRARY_BOT_MISMATCH')
      return asked
    }
    // A session that is not a Bot may reach any library only when the operator allowed that.
    if (config?.operatorPassthrough?.enabled === false) fail('LIBRARY_OPERATOR_DISABLED')
    return asked
  }

  const register = (name, description, parameters, execute) => registerPolicyTool(ctx, config, defineTool({
    name, description, parameters, output: jsonOutput, execute,
  }))

  register('bot_library_list', 'List one directory of a Bot\'s own library. Names, kinds and sizes only — never file contents.', target,
    async (args, exec) => jsonValue({ entries: library.list(libraryFor({ ...exec, arguments: args }), args.relativePath ?? '') }))

  register('bot_library_read', 'Read one UTF-8 file from a Bot\'s own library. Bounded to 1 MiB.', target,
    async (args, exec) => jsonValue({ content: library.read(libraryFor({ ...exec, arguments: args }), args.relativePath ?? '') }))

  register('bot_library_write', 'Write one UTF-8 file into a Bot\'s own library. Bounded to 1 MiB.', target,
    async (args, exec) => jsonValue(library.write(libraryFor({ ...exec, arguments: args }), args.relativePath ?? '', args.content ?? '')))

  return true
}

/** The directory the libraries live in, next to the router state. */
export function libraryRoot(stateDir) {
  return join(stateDir, 'bot-library')
}
