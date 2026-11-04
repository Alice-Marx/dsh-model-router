/**
 * Mount the independent Bot runtime as this plugin's own path.
 *
 * This plugin does not have to borrow the Harness delivery pipeline: it owns a session store, a
 * loop and a dispatch point, so a turn is just "input in, answer out" through the Host's model
 * service. The provider below turns that service's stream into the small reply shape the loop
 * expects, and the assembly module keeps the two runtimes from ever serving one Bot.
 *
 * Everything is opt-in: without `enabled` the runtime is never constructed, and nothing about the
 * existing Bot integration changes.
 */

import { join } from 'node:path'
import { createWorkspaceTools } from './workspace-tools.mjs'
import { createIndependentRuntime } from '../../packages/orchestration/src/bot-runtime-assembly.mjs'

const fail = code => { const error = new Error(code); error.code = code; throw error }

/** Collect one streamed answer into `{ text }`. Tool calls are not inferred from text. */
export async function collectAnswer(stream) {
  let text = ''
  for await (const chunk of stream) {
    if (typeof chunk === 'string') { text += chunk; continue }
    if (chunk?.type === 'text' && typeof chunk.text === 'string') { text += chunk.text; continue }
    if (chunk?.type === 'delta' && typeof chunk.text === 'string') { text += chunk.text }
  }
  return { text }
}

/**
 * @param {{
 *   ctx: { get: (name: string) => unknown, llm?: object, logger?: object },
 *   settings?: { enabled?: boolean, dir?: string, provider?: string, model?: string, maxSteps?: number },
 *   stateDir: string,
 *   integration?: (request: object) => Promise<object>,
 *   now?: () => number,
 * }} options
 */
export function createPluginRuntime({ ctx, settings = {}, stateDir, integration, now = Date.now } = {}) {
  if (settings.enabled !== true) return null
  if (!ctx || typeof ctx.get !== 'function') throw new TypeError('PLUGIN_RUNTIME_REQUIRES_CONTEXT')
  const llm = ctx.get('llm') ?? ctx.llm
  if (!llm || typeof llm.stream !== 'function') throw new TypeError('PLUGIN_RUNTIME_REQUIRES_LLM')
  const provider = settings.provider
  const model = settings.model
  if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) fail('PLUGIN_RUNTIME_REQUIRES_MODEL')

  const providerFor = () => async ({ messages }) => collectAnswer(llm.stream({ provider, model, messages }))
  // Tools are opt-in too: without a workspace root the loop answers and calls nothing.
  const tools = typeof settings.workspaceRoot === 'string' && settings.workspaceRoot ? createWorkspaceTools({ root: settings.workspaceRoot }) : null
  return createIndependentRuntime({
    dir: settings.dir ? String(settings.dir) : join(stateDir, 'independent-runtime'),
    integration: typeof integration === 'function' ? integration : async () => fail('INDEPENDENT_RUNTIME_NO_INTEGRATION'),
    providerFor,
    toolsFor: () => tools,
    now,
    ...(Number.isSafeInteger(settings.maxSteps) ? { maxSteps: settings.maxSteps } : {}),
  })
}
