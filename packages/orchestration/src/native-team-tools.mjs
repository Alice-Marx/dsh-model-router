/**
 * The native MCP door for the four teammate-coordination tools.
 *
 * This is the independent-runtime half of the team family: it wraps the coordination
 * service (createTeamCoordination in team-bridge.mjs) in the same handler shape the
 * native conversation tools use (native-conversation-tools.mjs), reading names,
 * descriptions and schemas from the ONE shared contract (team-tool-contract.mjs) so the
 * native and SDK doors cannot drift.
 *
 * Authority: the calling Bot and its conversation are bound here from the Host-resolved
 * native identity (`callerBotId`, `conversationId`) — never from the tool arguments,
 * which parseTeamToolArgs has already refused any `botId`/`owner`/route/session key in.
 * Every call re-runs the injected `validate()` around each awaited step, exactly as the
 * other native doors do, so a subject, funding or credential that changed stops the call.
 *
 * A refusal is returned as a structured value the model can read, never a thrown crash:
 * the model is told the coded reason and, for a durable identity it already holds, what
 * to do next. An unknown outcome is never replayed from here.
 */

import { TEAM_TOOL_ENTRIES, TEAM_CODES, parseTeamToolArgs, projectCoordinateArgs } from './team-tool-contract.mjs'
import { redactNativeToolValue } from './native-conversation-tools.mjs'

const reference = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : null
const safeCode = code => /^[A-Z][A-Z0-9_:-]{0,95}$/.test(code ?? '') ? code : 'TEAM_CALL_FAILED'

/**
 * @param {{
 *   service: object,                     // createTeamCoordination()
 *   callerBotId: string,                 // Host-resolved native identity botId
 *   conversationId?: string | null,      // Host-resolved per-work-thread conversationId
 *   sessionId?: string | null,
 *   validate: () => Promise<void>,       // re-check subject/funding/credential per step
 *   redact?: (text: string) => string,
 * }} options
 */
export function createNativeTeamTools({ service, callerBotId, conversationId = null, sessionId = null, validate, redact = text => text } = {}) {
  if (!service || typeof service.coordinateBots !== 'function') throw new TypeError('NATIVE_TEAM_REQUIRES_SERVICE')
  if (typeof callerBotId !== 'string' || !callerBotId) throw new TypeError('NATIVE_TEAM_REQUIRES_CALLER')
  if (typeof validate !== 'function') throw new TypeError('NATIVE_TEAM_REQUIRES_VALIDATE')

  const handlers = TEAM_TOOL_ENTRIES.filter(() => service.canUse(callerBotId)).map(entry => ({
    definition: { name: entry.name, description: entry.description, inputSchema: entry.inputSchema },
    capability: entry.capability,
    parse: args => parseTeamToolArgs(entry.name, args),
    render: value => ({ content: [{ type: 'text', text: JSON.stringify(redactNativeToolValue(value, redact)) }], ...(value?.error ? { isError: true } : {}) }),
    async execute(args, context) {
      const turn = context.context
      if (!turn?.turnId || !turn.callId || !context.signal) throw new Error('NATIVE_TOOL_TURN_REQUIRED')
      const check = async () => { context.signal.throwIfAborted(); await validate(); context.signal.throwIfAborted(); if (!service.canUse(callerBotId)) throw Object.assign(new Error('TEAM_CALLER_NOT_AUTHORIZED'), { code: 'TEAM_CALLER_NOT_AUTHORIZED' }) }
      try {
        await check()
        const request = { callerBotId, conversationId, sessionId, turnId: turn.turnId, callId: turn.callId, signal: context.signal }
        let value
        if (entry.method === 'coordinateBots') {
          value = await service.coordinateBots({ ...request, args: projectCoordinateArgs(args) })
        }
        else if (entry.method === 'assignmentStatus') value = await service.assignmentStatus({ ...request, args })
        else if (entry.method === 'listBots') value = await service.listBots(request)
        else value = await service.listThreads(request)
        await check()
        service.validateResult?.(request, value)
        return redactNativeToolValue(value, redact)
      } catch (error) {
        try { await check() } catch (changed) { error = changed }
        const coded = safeCode(error?.code)
        return { error: { code: coded, message: redact(String(error?.message ?? error)) } }
      }
    },
  }))

  return { tools: handlers.map(handler => handler.definition.name), handlers }
}
