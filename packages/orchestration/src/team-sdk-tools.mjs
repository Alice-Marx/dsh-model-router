/**
 * The SDK (integrated Harness) door for the four teammate-coordination tools.
 *
 * Registered through `ctx.tools.register` exactly as the data tools are
 * (bot-data-tools.mjs), reading names, descriptions and the SDK parameter map from the
 * ONE shared contract (team-tool-contract.mjs) so the SDK and native doors cannot drift.
 *
 * Authority: the calling Bot comes from the live session through the injected
 * `botIdFor(exec)` — never from an argument, which parseTeamToolArgs has already refused
 * any `botId`/`owner`/route/session key in. The sender's Harness Session id is read from
 * the live agent so a result returns into THIS conversation and resumes it; the target's
 * own model, tools, permissions and funding are re-derived inside the target's frame, so
 * nothing here lends the caller's authority to the target.
 *
 * Note for the parent: `list_bots` already exists in the vendored roster for integrated
 * Bots. Register the NEW team tools (`coordinate_bots`, `assignment_status`,
 * `list_threads`) here and keep the vendor `list_bots`; register `list_bots` from this
 * family only on the native (independent) door, which has no roster tool of its own.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { TEAM_TOOL_ENTRIES, TEAM_CODES, parseTeamToolArgs, projectCoordinateArgs } from './team-tool-contract.mjs'
import { redactNativeToolValue } from './native-conversation-tools.mjs'

const JSON_OUTPUT = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
const safeCode = code => /^[A-Z][A-Z0-9_:-]{0,95}$/.test(code ?? '') ? code : 'TEAM_CALL_FAILED'
// Installed SDK author DSL does not support array cardinality/uniqueness. The
// shared parser enforces these bounds before any service effect; MCP keeps them.
const sdkParameters = parameters => Object.fromEntries(Object.entries(parameters).map(([key, spec]) => {
  const { minItems, maxItems, uniqueItems, minLength, maxLength, ...supported } = spec
  return [key, supported]
}))

/**
 * @param {object} ctx Host tool registry ({ tools: { register } }).
 * @param {{ service: object, botIdFor: (exec: object) => string | null, names?: string[] }} source
 * @returns {() => void} release
 */
export function registerTeamTools(ctx, { service, botIdFor, names = ['coordinate_bots', 'assignment_status', 'list_threads'], redact = text => text } = {}) {
  if (!service || typeof service.coordinateBots !== 'function') throw new TypeError('TEAM_TOOLS_REQUIRE_SERVICE')
  if (typeof botIdFor !== 'function') throw new TypeError('TEAM_TOOLS_REQUIRE_BOT_ID_FOR')
  if (!ctx || typeof ctx.tools?.register !== 'function') throw new TypeError('TEAM_TOOLS_REQUIRE_CTX')
  const offered = new Set(Array.isArray(names) ? names : TEAM_TOOL_ENTRIES.map(entry => entry.name))

  const asBot = async (exec, run) => {
    let botId = null
    try { botId = botIdFor(exec) ?? null } catch (error) {
      return { error: { code: safeCode(error?.code), message: redact(String(error?.message ?? error)) } }
    }
    if (typeof botId !== 'string' || botId === '') return { error: { code: 'unknown_subject', message: 'The calling Bot could not be identified from the live session.' } }
    const sessionId = exec?.agent?.session?.id ?? null
    try {
      exec.signal.throwIfAborted()
      if (!service.canUse(botId)) throw Object.assign(new Error('TEAM_CALLER_NOT_AUTHORIZED'), { code: 'TEAM_CALLER_NOT_AUTHORIZED' })
      const boundary = (exec.agent.ctx?.sessionProjections ?? ctx.sessionProjections)?.stateOf(exec.agent.session, 'turnBoundary')
      if (boundary?.openTurnStartSeq === null || boundary?.openTurnStartSeq === undefined || !exec.callId) throw Object.assign(new Error('TEAM_HOST_TURN_REQUIRED'), { code: 'TEAM_HOST_TURN_REQUIRED' })
      const request = { callerBotId: botId, sessionId, turnId: `sdk-${sessionId}-${boundary.openTurnStartSeq}`, callId: exec.callId, signal: exec.signal }
      const value = await run(request)
      exec.signal.throwIfAborted()
      if (botIdFor(exec) !== botId || !service.canUse(botId)) throw Object.assign(new Error('TEAM_ACCESS_CHANGED'), { code: 'TEAM_ACCESS_CHANGED' })
      service.validateResult?.(request, value)
      return redactNativeToolValue(value, redact)
    } catch (error) { return { error: { code: safeCode(error?.code), message: redact(String(error?.message ?? error)) } } }
  }

  const tools = TEAM_TOOL_ENTRIES.filter(entry => offered.has(entry.name)).map(entry => defineTool({
    name: entry.name,
    description: entry.description,
    parameters: sdkParameters(entry.parameters),
    output: JSON_OUTPUT,
    execute: (args, exec) => asBot(exec, async request => {
      const parsed = parseTeamToolArgs(entry.name, args)
      if (entry.method === 'coordinateBots') { const value = await service.coordinateBots({ ...request, args: projectCoordinateArgs(parsed) }); exec.concludeTurn?.(); return value }
      if (entry.method === 'assignmentStatus') return service.assignmentStatus({ ...request, args: parsed })
      if (entry.method === 'listBots') return service.listBots(request)
      return service.listThreads(request)
    }),
  }))

  const releases = tools.map(tool => ctx.tools.register(tool))
  return () => { for (const release of releases.reverse()) release() }
}

export { TEAM_CODES }
