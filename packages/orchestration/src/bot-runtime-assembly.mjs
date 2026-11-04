/**
 * Assemble the independent runtime from pieces the Host already owns.
 *
 * The plugin's apply() should not learn how a session store, a loop, a switch and a dispatch fit
 * together. It hands this module its directories and two factories, and gets back one object with
 * `turn`, `move`, `describe` and `close`. Nothing here reaches into the Harness: the integration
 * handler is whatever the caller passes, so the product keeps working exactly as before until a
 * Bot is moved.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createBotLoop } from './bot-loop.mjs'
import { openBotSessionStore } from './bot-session-store.mjs'
import { createBotDispatch } from './bot-runtime-dispatch.mjs'
import { openRuntimeSwitch } from './bot-runtime-switch.mjs'

const fail = code => { const error = new Error(code); error.code = code; throw error }

/**
 * @param {{
 *   dir: string,
 *   integration: (request: object) => Promise<object>,
 *   providerFor: (botId: string) => ((request: object) => Promise<object>) | null,
 *   toolsFor?: (botId: string) => { names?: string[], call: Function } | null,
 *   isBusy?: (botId: string) => boolean | Promise<boolean>,
 *   now?: () => number,
 *   maxSteps?: number,
 * }} options
 */
export function createIndependentRuntime({
  dir, integration, providerFor, toolsFor = () => null, isBusy = () => false, now = Date.now, maxSteps,
} = {}) {
  if (typeof dir !== 'string' || dir === '') throw new TypeError('RUNTIME_DIR_REQUIRED')
  if (typeof integration !== 'function') throw new TypeError('RUNTIME_REQUIRES_INTEGRATION')
  if (typeof providerFor !== 'function') throw new TypeError('RUNTIME_REQUIRES_PROVIDER_FACTORY')
  mkdirSync(dir, { recursive: true })
  const store = openBotSessionStore({ dir: join(dir, 'sessions'), now })
  const switchApi = openRuntimeSwitch({ file: join(dir, 'runtime-switch.json'), now })
  const loops = new Map()

  // One loop per Bot: it holds no state beyond the store, but caching keeps a
  // provider factory from being called twice in one turn.
  const loopFor = botId => {
    const existing = loops.get(botId)
    if (existing) return existing
    const provider = providerFor(botId)
    if (typeof provider !== 'function') fail('RUNTIME_PROVIDER_UNAVAILABLE')
    const loop = createBotLoop({ store, provider, tools: toolsFor(botId) ?? null, now, ...(maxSteps ? { maxSteps } : {}) })
    loops.set(botId, loop)
    return loop
  }

  const dispatch = createBotDispatch({
    switchApi,
    integration,
    independent: async request => {
      const result = await loopFor(request.botId).run({ botId: request.botId, input: request.input, signal: request.signal })
      return { answer: result.answer, steps: result.steps, toolCalls: result.toolCalls, turns: result.turns }
    },
    now,
  })

  return Object.freeze({
    /** Serve one turn on the committed runtime. */
    turn: request => dispatch.turn(request),
    /** Which runtime a Bot is on. */
    describe: botId => dispatch.describe(botId),
    /** Move a Bot between runtimes; refused while it is busy. */
    move: async (botId, mode) => {
      const before = store.list([botId])[0] ?? null
      const result = await switchApi.move(botId, mode, {
        isBusy,
        snapshot: before ? { turns: before.turns, messages: before.messages, at: now() } : null,
      })
      // A moved Bot must not keep a loop remembering an older provider or grant.
      loops.delete(botId)
      return result
    },
    /** Which Bots were moved, in the switch's own words. */
    list: () => switchApi.list(),

    /**
     * A bounded, redacted view of one Bot transcript: role, time, size and a short preview.
     * Bodies never leave this module; a caller shows previews instead of the full text.
     */
    history(botId, { limit = 20, previewChars = 120 } = {}) {
      const messages = store.get(botId).messages
      const take = Math.min(Math.max(1, limit), 100)
      const chars = Math.min(Math.max(0, previewChars), 400)
      return messages.slice(-take).map(message => {
        const body = String(message.content ?? '')
        return {
          role: message.role,
          at: message.at ?? null,
          chars: body.length,
          preview: chars === 0 ? '' : body.slice(0, chars),
          ...(message.name ? { name: message.name } : {}),
        }
      })
    },

    /** Inventory for a panel: runtime plus transcript size, never message bodies. */
    inventory: botIds => {
      const rows = store.list(Array.isArray(botIds) ? botIds : [])
      return rows.map(row => ({ ...row, ...dispatch.describe(row.botId) }))
    },
    /** Drop cached loops when the plugin unloads. */
    close() { loops.clear() },
  })
}
