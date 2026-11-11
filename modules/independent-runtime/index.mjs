import { createRemoteTools } from './remote-tools.mjs'
import { INDEPENDENT_TOOL_NAMES, independentToolEntry } from '../../packages/orchestration/src/independent-tool-catalog.mjs'
/**
 * Mount the independent Bot runtime as this plugin's own path.
 *
 * This plugin does not have to borrow the Harness delivery pipeline: it owns a session store, a
 * loop and a dispatch point, so a turn is just "input in, answer out" through the Host's model
 * service. The provider below asks the Host's own trusted execution frame for that answer — the
 * committed Bot, the model that Bot has saved, the Bot policy and the one money stream — and the
 * assembly module keeps the two runtimes from ever serving one Bot.
 *
 * Everything is opt-in: without `enabled` the runtime is never constructed, and nothing about the
 * existing Bot integration changes.
 */

import { join } from 'node:path'
import { createIndependentRuntime } from '../../packages/orchestration/src/bot-runtime-assembly.mjs'
import { collectAnswer } from '../../packages/orchestration/src/bot-independent-stream.mjs'

const fail = code => { const error = new Error(code); error.code = code; throw error }

export { collectAnswer }

/**
 * Where this Bot's runtime switch lives. The path is published even when the independent runtime
 * is switched off, because a Bot that was moved before it was switched off still has a committed
 * mode on disk: a Host that cannot read that back has to refuse, not assume integration.
 */
export function runtimeSwitchPath({ settings = {}, stateDir } = {}) {
  if (typeof stateDir !== 'string' || stateDir === '') throw new TypeError('RUNTIME_STATE_DIR_REQUIRED')
  return settings.dir ? String(settings.dir) : join(stateDir, 'independent-runtime')
}

/**
 * @param {{
 *   ctx: { get: (name: string) => unknown, llm?: object, logger?: object },
 *   settings?: { enabled?: boolean, dir?: string, maxSteps?: number,
 *     remoteInvoke?: (botId: string, tool: string, args: object) => Promise<unknown>,
 *     remoteTools?: string[], toolsFor?: (botId: string) => object | null },
 *   stateDir: string,
 *   integration?: (request: object) => Promise<object>,
 *   serving?: object | null,
 *   now?: () => number,
 * }} options
 */
export function createPluginRuntime({ ctx, settings = {}, stateDir, integration, serving = null, now = Date.now } = {}) {
  if (settings.enabled !== true) return null
  if (!ctx || typeof ctx.get !== 'function') throw new TypeError('PLUGIN_RUNTIME_REQUIRES_CONTEXT')
  const llm = ctx.get('llm') ?? ctx.llm
  if (!llm || typeof llm.stream !== 'function') throw new TypeError('PLUGIN_RUNTIME_REQUIRES_LLM')
  // The Bot product publishes the only frame an independent turn may run in. It is resolved per
  // call, never captured at construction: the plugin starts the product synchronously and composes
  // it asynchronously, so `connect` may build this runtime before the frame exists. A turn that
  // starts before it does is refused — a Host with no committed Bot, no Bot policy and no money
  // path must not answer from a global provider/model setting.
  const executionOf = () => {
    const execution = (() => { try { return ctx.get('botIndependentExecution') ?? null } catch { return null } })()
    if (!execution || typeof execution.complete !== 'function' || typeof execution.routeFor !== 'function' || typeof execution.assertTurn !== 'function') {
      throw Object.assign(new Error('宿主尚未发布 Bot 产品的独立执行上下文，本次请求被拒绝。'), { code: 'INDEPENDENT_EXECUTION_UNAVAILABLE', outcome: 'refused' })
    }
    return execution
  }
  // Per Bot, per step: the route comes from that Bot's own committed record and the call runs in
  // the Host's frame, so one Bot can neither pick another Bot's model nor answer without policy.
  // The tool schemas travel with the request: they are the ones the Host just re-decided for this
  // step, so the model is only ever told about tools this Bot holds right now.
  const providerFor = botId => async ({ messages, signal, tools, onText, conversationId }) => {
    const execution = executionOf()
    return execution.complete({ botId, ...execution.routeFor(botId), messages, signal, ...(conversationId ? { conversationId } : {}), ...(tools ? { tools } : {}), ...(onText ? { onText } : {}) })
  }
  // Tools are per Bot and Host-bound. The order is the Host's own, decided per call:
  //
  // 1. The Host's published independent tool service (`createIndependentToolHost`), which owns the
  //    machine directory, the durable Task journal and the per-Bot catalog. This is the only path
  //    on which a write is a tracked Task.
  // 2. An explicit per-Bot resolver the Host passes in (`toolsFor`), for a Host that composes its
  //    own surface.
  // 3. The Host's own remote invoker, which carries this Bot's subject, live binding, root and a
  //    fresh task/attempt per call. Without a durable Task backend this path offers the model the
  //    read-only tools only, and names the rest as unavailable — a Host that cannot track a write
  //    must not pretend it can.
  //
  // A Host that offers none of the three offers nothing, and the loop then says so: no shared
  // workspace root is handed to every Bot as a stand-in.
  const hostFor = botId => {
    const host = (() => { try { return ctx.get('botIndependentToolHost') ?? null } catch { return null } })()
    if (host && typeof host.forBot === 'function') return host.forBot(botId) ?? null
    if (typeof settings.toolsFor === 'function') return settings.toolsFor(botId) ?? null
    if (typeof settings.remoteInvoke === 'function') return legacyToolsFor(botId)
    return null
  }
  // The Host's own remote invoker, in the vocabulary the loop speaks. Reads are offered by their
  // catalog names; the machine-tool spellings still dispatch, because a Host that wired `remoteInvoke`
  // already applies its own binding, root and task checks there.
  const legacyToolsFor = botId => {
    const inner = createRemoteTools({
      invoke: (tool, args, context) => settings.remoteInvoke(botId, tool, args, context),
      ...(Array.isArray(settings.remoteTools) ? { names: settings.remoteTools } : {}),
    })
    const granted = new Set(inner.names)
    const offered = INDEPENDENT_TOOL_NAMES.map(independentToolEntry)
      .filter(entry => entry && entry.machineTool && entry.backend === null && granted.has(entry.machineTool))
    const unavailable = INDEPENDENT_TOOL_NAMES.map(independentToolEntry)
      .filter(entry => entry && (entry.backend !== null || !granted.has(entry.machineTool)))
      .map(entry => ({ name: entry.name, code: entry.backend ? 'TASK_BACKEND_UNAVAILABLE' : 'MACHINE_TOOL_NOT_GRANTED' }))
    return {
      names: offered.map(entry => entry.name),
      origin: inner.origin,
      isReadonly: name => offered.some(entry => entry.name === name && entry.effect === 'read'),
      schemas: () => offered.map(entry => ({ name: entry.name, description: entry.description, parameters: entry.parameters })),
      unavailable: () => unavailable,
      async call(name, args = {}, context = {}) {
        const entry = offered.find(item => item.name === name)
        return inner.call(entry ? entry.machineTool : name, args, context)
      },
    }
  }
  const runtime = createIndependentRuntime({
    dir: runtimeSwitchPath({ settings, stateDir }),
    integration: typeof integration === 'function' ? integration : async () => fail('INDEPENDENT_RUNTIME_NO_INTEGRATION'),
    providerFor,
    toolsFor: hostFor,
    // The Bot product's own frame re-decides the turn before every transcript write, every
    // provider step and every tool call, so a move, a deletion, a revocation or an emptied grant
    // stops the turn at the next checkpoint instead of finishing on a state that no longer stands.
    assertTurn: botId => executionOf().assertTurn(botId),
    // Published by the Host composition; a model/owner payload can never select
    // the callback or turn a stop request into confirmed native-tree retirement.
    retireConversation: async (botId, details) => {
      const retirement = (() => { try { return ctx.get('botIndependentConversationRetirement') } catch { return null } })()
      if (typeof retirement !== 'function') throw Object.assign(new Error('INDEPENDENT_CONTEXT_RETIREMENT_UNAVAILABLE'), { code: 'INDEPENDENT_CONTEXT_RETIREMENT_UNAVAILABLE', outcome: 'refused' })
      return retirement(botId, details)
    },
    now,
    // The Host's own serving admission: the same lease the integrated stream holds, so a Bot is
    // never written by both paths and a move sees a turn this path is running.
    ...(serving ? { serving } : {}),
    ...(Number.isSafeInteger(settings.maxSteps) ? { maxSteps: settings.maxSteps } : {}),
  })
  // A Host that unloads must not leave this runtime's loops behind: a turn that never finishes would
  // otherwise sit on its lease until the lease expires. The effect is the Host's own disposal seam and
  // closing twice is a no-op. The Host's tool service is asked to close as well - this runtime is its
  // only consumer - but a Host that owns its lifecycle may close it first, which is also a no-op.
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => async () => {
      const host = (() => { try { return ctx.get('botIndependentToolHost') ?? null } catch { return null } })()
      try { host?.close?.() } catch { /* the Host owns its own lifecycle */ }
      runtime.close()
    }, 'model-router: independent Bot runtime')
  }
  return runtime
}
