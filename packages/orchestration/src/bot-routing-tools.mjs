/**
 * The Bot-routing tool a model can call to hand work out for real.
 *
 * `bot_route_task` and its `bot_dispatch` alias dispatch by default. Explicit `preview:true` reads
 * a decision without any side effects. A dispatch confirms the worker binding first, then the plan is
 * submitted as the calling Bot, and the answer carries the durable identity the journal created.
 *
 * A refusal names its reason, and an accepted task is never reported as a finished one.
 *
 * Everything the model may say is limited to the task itself: text, which tools the work needs,
 * whether it needs a machine, and which Bot a person pinned. Models, tools, machines, funding,
 * executables, endpoints and credentials come from committed Host state; a machine the Bot holds no
 * grant for is refused rather than substituted, and the submitting principal is derived from the
 * live session rather than from an argument.
 *
 * `allowedBotIds` is the Host's answer to "which Bots may hand work out at all". The Host supplies
 * its committed Main IDs; an omitted list refuses everyone. The workbench path is authenticated separately and is not
 * gated here.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

const json = value => JSON.parse(JSON.stringify(value))

/**
 * @param {{
 *   ctx: { tools: { register: (tool: object) => () => void } },
 *   routing: { dispatch: Function },
 *   allowedBotIds?: string[] | (() => string[]),
 *   botIdFor?: (exec: object) => string | null,
 * }} source
 * @returns {() => void} release
 */
export function registerBotRoutingTools(ctx, { routing, allowedBotIds = [], botIdFor = null, beforeCall = null } = {}) {
  if (!routing || typeof routing.dispatch !== 'function') throw new TypeError('BOT_ROUTING_TOOLS_REQUIRE_DISPATCH')
  const releases = []
  for (const name of ['bot_route_task', 'bot_dispatch']) releases.push(ctx.tools.register(defineTool({
    name,
    description: [
      'Hand a task to the Bot that should own it, for real: the worker binding is committed first, then the task is submitted as you,',
      'and the answer carries the plan, task, attempt and operation ids the Host created.',
      'Set preview:true to inspect without dispatch or grant. An accepted task is not a finished one; read the plan with bot_task_plan_status.',
    ].join(' '),
    parameters: {
      text: { type: 'string', required: true },
      pinnedBotId: { type: 'string' },
      requiresMachine: { type: 'boolean' },
      machineId: { type: 'string' },
      rootId: { type: 'string' },
      needs: { type: 'json' },
      preview: { type: 'boolean' },
      requiredTools: { type: 'array', items: { type: 'string' } },
      acceptance: { type: 'array', items: { type: 'string' } },
      requestKey: { type: 'string' },
    },
    output: JSON_OUTPUT,
    execute: async (args, exec) => {
      if (typeof beforeCall === 'function') await beforeCall(exec)
      // Who is asking comes from the live session, never from an argument.
      let botId = null
      try { botId = typeof botIdFor === 'function' ? botIdFor(exec) ?? null : null } catch { botId = null }
      if (typeof botId !== 'string' || botId === '') return json({ dispatched: false, reason: 'BOT_ROUTING_DISPATCH_UNKNOWN_SUBJECT' })
      const allowed = typeof allowedBotIds === 'function' ? allowedBotIds() : allowedBotIds
      if (!Array.isArray(allowed) || !allowed.includes(botId)) return json({ dispatched: false, reason: `BOT_ROUTING_DISPATCH_DENIED:${botId}` })
      const payload = {
        text: args.text,
        pinnedBotId: args.pinnedBotId ?? '',
        requiresMachine: args.requiresMachine === true,
        machineId: args.machineId ?? '',
        rootId: args.rootId ?? '',
        needs: { write: args.needs?.write === true, shell: args.needs?.shell === true, desktop: args.needs?.desktop === true, browser: args.needs?.browser === true },
        requiredTools: Array.isArray(args.requiredTools) ? args.requiredTools : [],
        acceptance: Array.isArray(args.acceptance) ? args.acceptance : [],
        requestKey: typeof args.requestKey === 'string' ? args.requestKey : '',
        requesterBotId: botId,
      }
      if (args.preview === true) return json({ ...await routing.decide(payload), preview: true, dispatched: false })
      const sessionId = exec?.agent?.session?.id
      if (typeof sessionId !== 'string' || sessionId === '') return json({ dispatched: false, reason: 'BOT_ROUTING_SESSION_REQUIRED' })
      return json(await routing.dispatch(payload, { kind: 'bot', botId, sessionId, signal: exec?.signal }))
    },
  })))
  return () => { for (const release of releases.reverse()) release() }
}
